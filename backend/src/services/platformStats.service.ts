// Stats plateforme pour le superadmin (croissance, activité par club, revenus SaaS).
// Tout est on-demand derrière requireSuperAdmin — aucun impact sur les pages publiques.
import { DateTime } from 'luxon';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { aggregateBilling } from './platformBilling/platformBilling.service';

const ZONE = 'Europe/Paris';

/** Les `n` derniers mois au format 'YYYY-MM', ascendant, mois courant inclus (fuseau club). */
export function lastMonths(n: number, now: Date, zone = ZONE): string[] {
  const base = DateTime.fromJSDate(now, { zone }).startOf('month');
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(base.minus({ months: i }).toFormat('yyyy-LL'));
  return out;
}

/** Compte des dates par mois, aligné sur `months` (mois hors fenêtre ignorés). */
export function bucketByMonth(dates: Date[], months: string[], zone = ZONE): number[] {
  const index = new Map(months.map((m, i) => [m, i]));
  const counts = new Array(months.length).fill(0);
  for (const d of dates) {
    const key = DateTime.fromJSDate(d, { zone }).toFormat('yyyy-LL');
    const i = index.get(key);
    if (i !== undefined) counts[i]++;
  }
  return counts;
}

export interface BillingOverview {
  mrrCents: number;
  toRegularize: number;
  pastDue: number;
  byTierObserved: number[];
  byTierSubscribed: number[];
  revenueByMonth: { month: string; amountCents: number }[];
  totalCollectedCents: number;
  invoiceCount: number;
}

export interface ClubActivity {
  clubId: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'SUSPENDED';
  activeMembers: number;
  reservations30d: number;
  lastReservationAt: Date | null;
}

export interface UsageStats {
  months: string[];
  growth: { newClubs: number[]; newUsers: number[]; reservations: number[] };
  activity: ClubActivity[];
}

export class PlatformStatsService {
  /** KPIs facturation + CA encaissé mensuel (pour /superadmin/billing). */
  async billingOverview(now = new Date()): Promise<BillingOverview> {
    const months = lastMonths(12, now);
    const [clubs, paidInvoices] = await Promise.all([
      prisma.club.findMany({
        where: { status: 'ACTIVE' },
        select: {
          activeMemberCount: true, billingExempt: true,
          platformSubscription: { select: { status: true, tier: true, interval: true } },
        },
      }),
      prisma.platformInvoice.findMany({
        where: { status: 'paid' },
        select: { amountCents: true, paidAt: true, createdAt: true },
      }),
    ]);

    const agg = aggregateBilling(clubs);
    const revenueCounts = new Array(months.length).fill(0);
    const monthIndex = new Map(months.map((m, i) => [m, i]));
    let totalCollectedCents = 0;
    for (const inv of paidInvoices) {
      totalCollectedCents += inv.amountCents;
      const when = inv.paidAt ?? inv.createdAt;
      const key = DateTime.fromJSDate(when, { zone: ZONE }).toFormat('yyyy-LL');
      const i = monthIndex.get(key);
      if (i !== undefined) revenueCounts[i] += inv.amountCents;
    }

    return {
      mrrCents: agg.mrrCents,
      toRegularize: agg.toRegularize,
      pastDue: agg.pastDue,
      byTierObserved: agg.byTierObserved,
      byTierSubscribed: agg.byTierSubscribed,
      revenueByMonth: months.map((month, i) => ({ month, amountCents: revenueCounts[i] })),
      totalCollectedCents,
      invoiceCount: paidInvoices.length,
    };
  }

  /** Croissance plateforme (12 mois) + classement d'activité par club (pour /superadmin/stats). */
  async usageStats(now = new Date()): Promise<UsageStats> {
    const months = lastMonths(12, now);
    const since = new Date(`${months[0]}-01T00:00:00Z`);
    const since30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [newClubs, newUsers, reservationRows, activityRows, clubs] = await Promise.all([
      prisma.club.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
      prisma.user.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
      // Réservations CONFIRMED / mois — $queryRaw (superadmin only, on-demand).
      prisma.$queryRaw<{ month: string; count: number }[]>(Prisma.sql`
        SELECT to_char(date_trunc('month', r."created_at" AT TIME ZONE 'Europe/Paris'), 'YYYY-MM') AS month,
               COUNT(*)::int AS count
        FROM "reservations" r
        WHERE r."created_at" >= ${since} AND r."status" = 'CONFIRMED'
        GROUP BY 1
      `),
      // Activité par club : résas 30j + dernière résa (jointure resources).
      prisma.$queryRaw<{ clubId: string; reservations30d: number; lastReservationAt: Date | null }[]>(Prisma.sql`
        SELECT rs."club_id" AS "clubId",
               COUNT(*) FILTER (WHERE r."created_at" >= ${since30})::int AS "reservations30d",
               MAX(r."created_at") AS "lastReservationAt"
        FROM "reservations" r
        JOIN "resources" rs ON rs."id" = r."resource_id"
        WHERE r."status" = 'CONFIRMED'
        GROUP BY rs."club_id"
      `),
      prisma.club.findMany({
        select: { id: true, name: true, slug: true, status: true, activeMemberCount: true },
      }),
    ]);

    const reservationByMonth = new Map(reservationRows.map((r) => [r.month, Number(r.count)]));
    const activityByClub = new Map(activityRows.map((a) => [a.clubId, a]));

    const activity: ClubActivity[] = clubs
      .map((c) => {
        const a = activityByClub.get(c.id);
        return {
          clubId: c.id,
          name: c.name,
          slug: c.slug,
          status: c.status as 'ACTIVE' | 'SUSPENDED',
          activeMembers: c.activeMemberCount,
          reservations30d: a ? Number(a.reservations30d) : 0,
          lastReservationAt: a?.lastReservationAt ?? null,
        };
      })
      .sort((x, y) => y.reservations30d - x.reservations30d);

    return {
      months,
      growth: {
        newClubs: bucketByMonth(newClubs.map((c) => c.createdAt), months),
        newUsers: bucketByMonth(newUsers.map((u) => u.createdAt), months),
        reservations: months.map((m) => reservationByMonth.get(m) ?? 0),
      },
      activity,
    };
  }
}
