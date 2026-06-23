import { DateTime } from 'luxon';
import { prisma } from '../db/prisma';
import { slotPriceCents, OffPeakHours } from './pricing';
import { resolvePreferredSportKey } from './rating/preferredSport';
import { RatingService } from './rating.service';

// Encaissements « argent réel » (les autres méthodes sont du prépayé déjà encaissé
// à la vente du carnet/porte-monnaie, ou l'abonnement). Miroir de accounting.service.ts.
const MONEY_METHODS = ['CASH', 'CARD', 'TRANSFER', 'ONLINE', 'OTHER', 'VOUCHER'];
const isMoney = (m: string) => MONEY_METHODS.includes(m);

// Au-delà de ce délai sans visite, un joueur (ayant déjà joué) est signalé « à risque ».
const RISK_THRESHOLD_DAYS = 45;

const num = (v: unknown): number => Number(v ?? 0);
const cents = (v: unknown): number => Math.round(num(v) * 100);
const euros = (c: number): string => (c / 100).toFixed(2);

export interface MemberHistoryReservation {
  id: string;
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED';
  type: 'COURT' | 'COACHING' | 'TOURNAMENT' | 'EVENT';
  startTime: string;
  endTime: string;
  cancelledAt: string | null;
  lateCancel: boolean;           // annulé après le délai du club (faute de motif stocké)
  resourceName: string;
  sportKey: string | null;
  isOrganizer: boolean;
  attributedAmount: string;      // argent net (string décimale) attribué à ce joueur sur cette résa
}

export interface MemberHistory {
  member: {
    userId: string; firstName: string; lastName: string; email: string;
    phone: string | null; avatarUrl: string | null;
    isSubscriber: boolean; membershipNo: string | null;
    status: 'ACTIVE' | 'BLOCKED';
    watch: boolean;              // drapeau « à surveiller »
    hasActivePackage: boolean;   // a un carnet/porte-monnaie encore utilisable → chip « Carnet actif »
    since: string;               // ClubMembership.createdAt = date d'adhésion
  };
  reservations: MemberHistoryReservation[];
  counts: { total: number; confirmed: number; cancelled: number; lateCancelled: number; noShow: number; upcoming: number };
  heatmap: number[][];           // [weekday 0=lundi..6=dimanche][heure 0..23] — résas confirmées
  favorites: { resource: { name: string; count: number } | null; sportKey: string | null; weekday: number | null };
  finance: {
    totalSpent: string;
    averageBasket: string;
    outstanding: string;
    paymentsByMethod: Record<string, string>;
    revenueByMonth: Array<{ month: string; net: string }>;
    prepaid: {
      balances: Array<{
        id: string; kind: 'ENTRIES' | 'WALLET'; name: string;
        creditsRemaining: number | null; amountRemaining: string | null;
        purchasedAt: string; expiresAt: string | null;
      }>;
      consumption: Array<{ at: string; method: string; amount: string; packageName: string }>;
    };
  };
  game: {
    sportKey: string;
    level: number | null; tier: string | null; isProvisional: boolean; matchesPlayed: number;
    levelPoints: Array<{ playedAt: string; level: number }>;
    wins: number; losses: number;
    frequentPartners: Array<{ userId: string; firstName: string; lastName: string; count: number }>;
  };
  loyalty: {
    firstVisitAt: string | null;
    lastVisitAt: string | null;
    daysSinceLastVisit: number | null;
    tenureDays: number;
    playsPerMonth: number;
    cancellationRate: number;    // 0..1
    atRisk: boolean;
  };
}

export class MemberStatsService {
  private rating = new RatingService();

  /** Passif d'un joueur dans un club : activité, finances, niveau, fidélité (un seul payload). */
  async getMemberHistory(clubId: string, userId: string): Promise<MemberHistory> {
    const club = await prisma.club.findUnique({
      where: { id: clubId },
      select: { timezone: true, offPeakHours: true, cancellationCutoffHours: true },
    });
    if (!club) throw new Error('CLUB_NOT_FOUND');
    const tz = club.timezone;
    const offPeak = (club.offPeakHours ?? null) as OffPeakHours | null;

    const membership = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId, clubId } },
      select: {
        createdAt: true, isSubscriber: true, membershipNo: true, status: true, watch: true,
        user: { select: { firstName: true, lastName: true, email: true, phone: true, avatarUrl: true } },
      },
    });
    if (!membership) throw new Error('MEMBER_NOT_FOUND');

    const now = new Date();

    // Une résa concerne le joueur comme organisateur (Reservation.userId) ET/OU participant.
    const reservations = await prisma.reservation.findMany({
      where: { resource: { clubId }, OR: [{ userId }, { participants: { some: { userId } } }] },
      orderBy: { startTime: 'desc' },
      select: {
        id: true, status: true, type: true, startTime: true, endTime: true,
        totalPrice: true, cancelledAt: true, userId: true,
        resource: {
          select: {
            name: true, price: true, offPeakPrice: true,
            clubSport: { select: { sport: { select: { key: true } } } },
          },
        },
        participants: { select: { id: true, userId: true, share: true, isOrganizer: true } },
        payments: {
          select: {
            amount: true, method: true, participantId: true, createdAt: true,
            refunds: { select: { amount: true, createdAt: true } },
          },
        },
      },
    });

    // --- Agrégats parcourus en une passe ---
    const methodCents: Record<string, number> = {};
    const monthCents: Record<string, number> = {};
    let totalSpentCents = 0;
    let outstandingCents = 0;
    let paidReservations = 0;
    let confirmed = 0, cancelled = 0, lateCancelled = 0, upcoming = 0, noShow = 0;
    const resourceCount: Record<string, number> = {};
    const sportCount: Record<string, number> = {};
    const weekdayCount: Record<number, number> = {};
    const heatmap: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
    let firstVisitMs: number | null = null;
    let lastVisitMs: number | null = null;

    const monthKey = (d: Date) => DateTime.fromJSDate(d).setZone(tz).toFormat('yyyy-MM');

    const rows: MemberHistoryReservation[] = reservations.map((r) => {
      const mine = r.participants.find((p) => p.userId === userId);
      const isOrganizer = mine?.isOrganizer ?? r.userId === userId;
      const sportKey = r.resource.clubSport?.sport?.key ?? null;

      // Argent net attribué au joueur sur cette résa.
      let attrCents = 0;
      for (const p of r.payments) {
        const belongs = p.participantId
          ? p.participantId === mine?.id
          : isOrganizer; // paiement « résa » global → à l'organisateur
        if (!belongs || !isMoney(p.method)) continue;
        const gross = cents(p.amount);
        const refunded = p.refunds.reduce((s, rf) => s + cents(rf.amount), 0);
        attrCents += gross - refunded;
        if (r.status !== 'CANCELLED') {
          methodCents[p.method] = (methodCents[p.method] ?? 0) + gross - refunded;
          totalSpentCents += gross - refunded;
          monthCents[monthKey(p.createdAt)] = (monthCents[monthKey(p.createdAt)] ?? 0) + gross;
          for (const rf of p.refunds) {
            monthCents[monthKey(rf.createdAt)] = (monthCents[monthKey(rf.createdAt)] ?? 0) - cents(rf.amount);
          }
        }
      }
      if (r.status !== 'CANCELLED' && attrCents > 0) paidReservations++;

      // Reste dû (part du joueur). Faute de prix : tarif du créneau (règle de la caisse).
      const dueWhole = num(r.totalPrice) > 0
        ? cents(r.totalPrice)
        : slotPriceCents(offPeak, r.startTime, r.endTime, tz, cents(r.resource.price),
            r.resource.offPeakPrice != null ? cents(r.resource.offPeakPrice) : null);
      const myDue = mine && num(mine.share) > 0 ? cents(mine.share) : (isOrganizer ? dueWhole : 0);
      if (r.status === 'CONFIRMED') outstandingCents += Math.max(0, myDue - attrCents);

      // Compteurs + habitudes (sur le passé/confirmé).
      const startMs = r.startTime.getTime();
      const lateCancel = r.status === 'CANCELLED' && r.cancelledAt != null
        && r.cancelledAt.getTime() > startMs - club.cancellationCutoffHours * 3600_000;
      if (r.status === 'CONFIRMED') {
        confirmed++;
        if (startMs > now.getTime()) upcoming++;
        else {
          const local = DateTime.fromJSDate(r.startTime).setZone(tz);
          heatmap[local.weekday - 1][local.hour]++;
          resourceCount[r.resource.name] = (resourceCount[r.resource.name] ?? 0) + 1;
          if (sportKey) sportCount[sportKey] = (sportCount[sportKey] ?? 0) + 1;
          weekdayCount[local.weekday] = (weekdayCount[local.weekday] ?? 0) + 1;
          firstVisitMs = firstVisitMs == null ? startMs : Math.min(firstVisitMs, startMs);
          lastVisitMs = lastVisitMs == null ? startMs : Math.max(lastVisitMs, startMs);
          // No-show estimé : créneau passé, facturable, jamais réglé, dont il est responsable.
          if (isOrganizer && dueWhole > 0 && attrCents === 0) noShow++;
        }
      } else if (r.status === 'CANCELLED') {
        cancelled++;
        if (lateCancel) lateCancelled++;
      }

      return {
        id: r.id, status: r.status, type: r.type,
        startTime: r.startTime.toISOString(), endTime: r.endTime.toISOString(),
        cancelledAt: r.cancelledAt ? r.cancelledAt.toISOString() : null, lateCancel,
        resourceName: r.resource.name, sportKey, isOrganizer,
        attributedAmount: euros(attrCents),
      };
    });

    // --- Prépayé (carnets / porte-monnaie) ---
    const packages = await prisma.memberPackage.findMany({
      where: { clubId, userId },
      orderBy: { purchasedAt: 'desc' },
      include: { template: { select: { name: true } } },
    });
    const pkgName = new Map(packages.map((p) => [p.id, p.template.name]));
    const isUsable = (p: { creditsRemaining: number | null; amountRemaining: unknown; expiresAt: Date | null }) =>
      (p.expiresAt == null || p.expiresAt.getTime() > now.getTime())
      && ((p.creditsRemaining ?? 0) > 0 || num(p.amountRemaining) > 0);
    const hasActivePackage = packages.some(isUsable);
    const consumptionRows = packages.length
      ? await prisma.payment.findMany({
          where: { sourcePackageId: { in: packages.map((p) => p.id) } },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true, method: true, amount: true, sourcePackageId: true },
        })
      : [];

    // --- Niveau & matchs (au club, confirmés) ---
    const sportKey = await resolvePreferredSportKey(userId);
    const [display, matchRows, levelRows] = await Promise.all([
      this.rating.getForDisplay(userId, sportKey).catch(() => null),
      prisma.matchPlayer.findMany({
        where: { userId, match: { clubId, status: 'CONFIRMED' } },
        select: {
          team: true,
          match: {
            select: {
              winningTeam: true,
              players: { select: { userId: true, team: true, user: { select: { firstName: true, lastName: true } } } },
            },
          },
        },
      }),
      prisma.matchPlayer.findMany({
        where: { userId, ratingAfter: { not: null }, match: { clubId, status: 'CONFIRMED', sport: { key: sportKey } } },
        orderBy: { match: { playedAt: 'asc' } },
        select: { ratingAfter: true, match: { select: { playedAt: true } } },
      }),
    ]);

    let wins = 0, losses = 0;
    const partners = new Map<string, { firstName: string; lastName: string; count: number }>();
    for (const mp of matchRows) {
      const wt = mp.match.winningTeam;
      if (wt != null) { if (wt === mp.team) wins++; else losses++; }
      for (const co of mp.match.players) {
        if (co.userId === userId || co.team !== mp.team) continue;
        const e = partners.get(co.userId) ?? { firstName: co.user.firstName, lastName: co.user.lastName, count: 0 };
        e.count++; partners.set(co.userId, e);
      }
    }
    const frequentPartners = [...partners.entries()]
      .map(([uid, v]) => ({ userId: uid, ...v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // --- Fidélité / risque ---
    const dayMs = 86_400_000;
    const daysSinceLastVisit = lastVisitMs == null ? null : Math.floor((now.getTime() - lastVisitMs) / dayMs);
    const tenureDays = Math.floor((now.getTime() - membership.createdAt.getTime()) / dayMs);
    const monthsActive = firstVisitMs == null ? 0 : Math.max(1, (now.getTime() - firstVisitMs) / (dayMs * 30));
    const playsPerMonth = monthsActive ? Math.round((confirmed / monthsActive) * 10) / 10 : 0;
    const cancellationRate = confirmed + cancelled > 0 ? cancelled / (confirmed + cancelled) : 0;
    const atRisk = daysSinceLastVisit != null && daysSinceLastVisit > RISK_THRESHOLD_DAYS;

    const favResource = Object.entries(resourceCount).sort((a, b) => b[1] - a[1])[0] ?? null;
    const favSport = Object.entries(sportCount).sort((a, b) => b[1] - a[1])[0] ?? null;
    const favWeekday = Object.entries(weekdayCount).sort((a, b) => b[1] - a[1])[0] ?? null;

    const paymentsByMethod: Record<string, string> = {};
    for (const [m, c] of Object.entries(methodCents)) paymentsByMethod[m] = euros(c);
    const revenueByMonth = Object.entries(monthCents)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, c]) => ({ month, net: euros(c) }));

    return {
      member: {
        userId,
        firstName: membership.user.firstName, lastName: membership.user.lastName,
        email: membership.user.email, phone: membership.user.phone, avatarUrl: membership.user.avatarUrl,
        isSubscriber: membership.isSubscriber, membershipNo: membership.membershipNo,
        status: membership.status, watch: membership.watch, hasActivePackage,
        since: membership.createdAt.toISOString(),
      },
      reservations: rows,
      counts: { total: reservations.length, confirmed, cancelled, lateCancelled, noShow, upcoming },
      heatmap,
      favorites: {
        resource: favResource ? { name: favResource[0], count: favResource[1] } : null,
        sportKey: favSport ? favSport[0] : null,
        weekday: favWeekday ? Number(favWeekday[0]) : null,
      },
      finance: {
        totalSpent: euros(totalSpentCents),
        averageBasket: euros(paidReservations ? Math.round(totalSpentCents / paidReservations) : 0),
        outstanding: euros(outstandingCents),
        paymentsByMethod,
        revenueByMonth,
        prepaid: {
          balances: packages.map((p) => ({
            id: p.id, kind: p.kind, name: p.template.name,
            creditsRemaining: p.creditsRemaining,
            amountRemaining: p.amountRemaining != null ? euros(cents(p.amountRemaining)) : null,
            purchasedAt: p.purchasedAt.toISOString(),
            expiresAt: p.expiresAt ? p.expiresAt.toISOString() : null,
          })),
          consumption: consumptionRows.map((c) => ({
            at: c.createdAt.toISOString(), method: c.method, amount: euros(cents(c.amount)),
            packageName: c.sourcePackageId ? (pkgName.get(c.sourcePackageId) ?? '—') : '—',
          })),
        },
      },
      game: {
        sportKey,
        level: display?.level ?? null, tier: display?.tier ?? null,
        isProvisional: display?.isProvisional ?? false, matchesPlayed: display?.matchesPlayed ?? 0,
        levelPoints: levelRows.map((r) => ({ playedAt: r.match.playedAt.toISOString(), level: num(r.ratingAfter) })),
        wins, losses, frequentPartners,
      },
      loyalty: {
        firstVisitAt: firstVisitMs == null ? null : new Date(firstVisitMs).toISOString(),
        lastVisitAt: lastVisitMs == null ? null : new Date(lastVisitMs).toISOString(),
        daysSinceLastVisit, tenureDays, playsPerMonth, cancellationRate, atRisk,
      },
    };
  }
}
