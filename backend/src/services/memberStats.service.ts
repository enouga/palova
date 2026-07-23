import { DateTime } from 'luxon';
import { prisma } from '../db/prisma';
import { slotPriceCents, OffPeakHours } from './pricing';
import { resolvePreferredSportKey } from './rating/preferredSport';
import { RatingService } from './rating.service';

// Encaissements « argent réel » (les autres méthodes sont du prépayé déjà encaissé
// à la vente du carnet/porte-monnaie, ou l'abonnement). Miroir de accounting.service.ts.
const MONEY_METHODS = ['CASH', 'CARD', 'TRANSFER', 'ONLINE', 'OTHER', 'VOUCHER', 'CHEQUE', 'CLUB'];
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
  dueAmount: string;             // part due par ce joueur sur cette résa (string décimale)
  participants: Array<{ userId: string; firstName: string; lastName: string; isOrganizer: boolean }>;
  match: { winningTeam: number | null; myTeam: number | null; sets: [number, number][]; competitive: boolean } | null;
}

/** Entrée fusionnée de l'agenda à venir (résa/tournoi/event/cours), tri asc, cap 5. */
export interface MemberUpcomingEntry {
  kind: 'reservation' | 'tournament' | 'event' | 'lesson';
  id: string;
  title: string;
  startTime: string;
  status: string | null; // CONFIRMED / WAITLISTED pour tournoi/event, null sinon
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
    membershipId: string;
    birthDate: string | null; sex: 'MALE' | 'FEMALE' | null;
    address: string | null; postalCode: string | null; city: string | null;
    staffRole: 'OWNER' | 'ADMIN' | 'STAFF' | null;
    isCoach: boolean; isReferee: boolean;
    note: string | null;
  };
  reservations: MemberHistoryReservation[];
  counts: { total: number; confirmed: number; cancelled: number; lateCancelled: number; noShow: number; upcoming: number; noShowCharged: number };
  noShowChargedLastAt: string | null; // dernier débit d'absence réel (Payment.noShow), distinct de l'estimation counts.noShow
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
  upcoming: MemberUpcomingEntry[];
  subscription: {
    id: string; planId: string; planName: string; expiresAt: string;
    monthlyPriceSnapshot: string; sportKeys: string[];
  } | null;
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
        id: true, createdAt: true, isSubscriber: true, membershipNo: true, status: true, watch: true,
        isReferee: true, note: true,
        user: {
          select: {
            firstName: true, lastName: true, email: true, phone: true, avatarUrl: true, isSuperAdmin: true,
            birthDate: true, sex: true, address: true, postalCode: true, city: true,
          },
        },
      },
    });
    // Le compte super-admin plateforme n'a pas de fiche joueur côté club, même par accès direct.
    if (!membership || membership.user.isSuperAdmin) throw new Error('MEMBER_NOT_FOUND');

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
        participants: {
          select: {
            id: true, userId: true, share: true, isOrganizer: true,
            user: { select: { firstName: true, lastName: true } },
          },
        },
        payments: {
          select: {
            amount: true, method: true, participantId: true, createdAt: true, noShow: true,
            refunds: { select: { amount: true, createdAt: true } },
          },
        },
        matches: {
          // Un résultat définitif seulement (comme le calcul win/loss/niveau plus bas, ~ligne 351) :
          // PENDING = score auto-déclaré non encore confirmé par les 4 joueurs, DISPUTED = contesté.
          where: { status: 'CONFIRMED' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            winningTeam: true, sets: true, competitive: true,
            players: { select: { userId: true, team: true } },
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
    let confirmed = 0, cancelled = 0, lateCancelled = 0, upcoming = 0, noShow = 0, noShowCharged = 0;
    let noShowChargedLastMs: number | null = null;
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
        // No-show réellement facturé à ce joueur (débit off-session explicite du staff) —
        // suivi de récidive indépendant de l'estimation ci-dessous (créneau jamais réglé).
        if (p.noShow) {
          noShowCharged++;
          noShowChargedLastMs = noShowChargedLastMs == null ? p.createdAt.getTime() : Math.max(noShowChargedLastMs, p.createdAt.getTime());
        }
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

      const matchRow = r.matches[0] ?? null;
      const match = matchRow ? {
        winningTeam: matchRow.winningTeam,
        myTeam: matchRow.players.find((pl) => pl.userId === userId)?.team ?? null,
        sets: matchRow.sets as unknown as [number, number][],
        competitive: matchRow.competitive,
      } : null;

      return {
        id: r.id, status: r.status, type: r.type,
        startTime: r.startTime.toISOString(), endTime: r.endTime.toISOString(),
        cancelledAt: r.cancelledAt ? r.cancelledAt.toISOString() : null, lateCancel,
        resourceName: r.resource.name, sportKey, isOrganizer,
        attributedAmount: euros(attrCents),
        dueAmount: euros(myDue),
        participants: r.participants.map((p) => ({
          userId: p.userId, firstName: p.user.firstName, lastName: p.user.lastName, isOrganizer: p.isOrganizer,
        })),
        match,
      };
    });

    // --- Prépayé + à venir (résas futures + tournois + events + cours) + abonnement + rôle/facettes
    // (fiche 360) : aucune de ces requêtes ne dépend d'une autre → un seul aller-retour DB parallèle.
    const [packages, tRegs, eRegs, lessonsByLesson, seriesEnrollments, subscription, staff, coachRow] = await Promise.all([
      prisma.memberPackage.findMany({
        where: { clubId, userId },
        orderBy: { purchasedAt: 'desc' },
        include: { template: { select: { name: true } } },
      }),
      prisma.tournamentRegistration.findMany({
        where: {
          OR: [{ captainUserId: userId }, { partnerUserId: userId }],
          status: { not: 'CANCELLED' },
          tournament: { clubId, startTime: { gt: now } },
        },
        select: { status: true, tournament: { select: { id: true, name: true, startTime: true } } },
      }),
      prisma.eventRegistration.findMany({
        where: { userId, status: { not: 'CANCELLED' }, event: { clubId, startTime: { gt: now } } },
        select: { status: true, event: { select: { id: true, name: true, startTime: true } } },
      }),
      // Inscription à une séance unique (cas simple, lessonId non-null — explicite pour documenter
      // que la branche « série » ci-dessous est traitée séparément, cf. commentaire suivant).
      prisma.lessonEnrollment.findMany({
        where: {
          userId, status: { not: 'CANCELLED' }, lessonId: { not: null },
          lesson: { clubId, reservation: { startTime: { gt: now } } },
        },
        select: {
          lesson: {
            select: { id: true, reservation: { select: { startTime: true, resource: { select: { name: true } } } } },
          },
        },
      }),
      // Inscription à une SÉRIE de cours récurrente : LessonEnrollment.lessonId est nullable
      // (lessonId: null, seriesId renseigné) — filtrer via la relation `lesson` (nullable) ferait un
      // inner join implicite et ferait disparaître ces lignes SANS erreur (cf. lesson.service.ts
      // ::listUserEnrollments, qui gère déjà ce cas pour un besoin différent : lister TOUTES les
      // occurrences futures). Ici on ne veut que les seriesId concernés ; la prochaine occurrence de
      // chacun est résolue après ce Promise.all (dépend de son résultat).
      prisma.lessonEnrollment.findMany({
        where: { userId, status: { not: 'CANCELLED' }, seriesId: { not: null } },
        select: { seriesId: true },
      }),
      prisma.subscription.findFirst({
        where: { clubId, userId, status: 'ACTIVE', expiresAt: { gt: now } },
        orderBy: { expiresAt: 'desc' },
        select: {
          id: true, planId: true, expiresAt: true, monthlyPriceSnapshot: true, sportKeys: true,
          plan: { select: { name: true } },
        },
      }),
      prisma.clubMember.findUnique({ where: { userId_clubId: { userId, clubId } }, select: { role: true } }),
      // isActive: true — un profil coach désactivé (soft delete) ne doit plus valoir la facette « coach ».
      prisma.coach.findFirst({ where: { clubId, userId, isActive: true }, select: { id: true } }),
    ]);

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

    // Prochaine occurrence (une seule, pas tout le futur de la série) par seriesId distinct trouvé
    // ci-dessus — requêtes en parallèle, mais seulement s'il y a au moins un élève inscrit à une série
    // (garde-fou : pas d'aller-retour DB supplémentaire pour le cas le plus fréquent, aucune série).
    const seriesIds = [...new Set(
      seriesEnrollments.map((e) => e.seriesId).filter((id): id is string => id != null),
    )];
    const seriesNextLessons = seriesIds.length > 0
      ? (await Promise.all(seriesIds.map((seriesId) =>
          prisma.lesson.findMany({
            where: { seriesId, clubId, reservation: { status: { not: 'CANCELLED' }, startTime: { gt: now } } },
            select: { id: true, reservation: { select: { startTime: true, resource: { select: { name: true } } } } },
            orderBy: { reservation: { startTime: 'asc' } },
            take: 1,
          }),
        ))).flat()
      : [];

    const upcomingEntries: MemberUpcomingEntry[] = [
      ...rows
        .filter((r) => r.status === 'CONFIRMED' && new Date(r.startTime).getTime() > now.getTime())
        .map((r) => ({ kind: 'reservation' as const, id: r.id, title: r.resourceName, startTime: r.startTime, status: null })),
      ...tRegs.map((t) => ({
        kind: 'tournament' as const, id: t.tournament.id, title: t.tournament.name,
        startTime: t.tournament.startTime.toISOString(), status: t.status,
      })),
      ...eRegs.map((e) => ({
        kind: 'event' as const, id: e.event.id, title: e.event.name,
        startTime: e.event.startTime.toISOString(), status: e.status,
      })),
      ...lessonsByLesson
        .filter((l) => l.lesson?.reservation)
        .map((l) => ({
          kind: 'lesson' as const, id: l.lesson!.id,
          title: `Cours · ${l.lesson!.reservation.resource.name}`,
          startTime: l.lesson!.reservation.startTime.toISOString(), status: null,
        })),
      ...seriesNextLessons.map((l) => ({
        kind: 'lesson' as const, id: l.id,
        title: `Cours · ${l.reservation.resource.name}`,
        startTime: l.reservation.startTime.toISOString(), status: null,
      })),
    ].sort((a, b) => a.startTime.localeCompare(b.startTime)).slice(0, 5);

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
        membershipId: membership.id,
        birthDate: membership.user.birthDate ? membership.user.birthDate.toISOString().slice(0, 10) : null,
        sex: membership.user.sex,
        address: membership.user.address, postalCode: membership.user.postalCode, city: membership.user.city,
        staffRole: staff?.role ?? null, isCoach: coachRow != null, isReferee: membership.isReferee,
        note: membership.note,
      },
      reservations: rows,
      counts: { total: reservations.length, confirmed, cancelled, lateCancelled, noShow, upcoming, noShowCharged },
      noShowChargedLastAt: noShowChargedLastMs == null ? null : new Date(noShowChargedLastMs).toISOString(),
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
      upcoming: upcomingEntries,
      subscription: subscription ? {
        id: subscription.id, planId: subscription.planId, planName: subscription.plan?.name ?? '',
        expiresAt: subscription.expiresAt.toISOString(),
        monthlyPriceSnapshot: subscription.monthlyPriceSnapshot.toString(),
        sportKeys: subscription.sportKeys,
      } : null,
    };
  }
}
