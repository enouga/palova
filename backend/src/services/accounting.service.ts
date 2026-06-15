import { Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import { prisma } from '../db/prisma';

export class AccountingService {
  /** Récap mensuel net des remboursements, fuseau du club. */
  async monthlySummary(clubId: string, year: number, month: number) {
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) throw new Error('VALIDATION_ERROR');
    const club = await prisma.club.findUnique({ where: { id: clubId }, select: { timezone: true } });
    if (!club) throw new Error('CLUB_NOT_FOUND');
    const start = DateTime.fromObject({ year, month, day: 1 }, { zone: club.timezone }).startOf('month');
    if (!start.isValid) throw new Error('VALIDATION_ERROR');
    const end = start.plus({ months: 1 });

    const [payments, refunds] = await Promise.all([
      prisma.payment.findMany({
        where: { clubId, createdAt: { gte: start.toJSDate(), lt: end.toJSDate() } },
        select: { amount: true, method: true, createdAt: true },
      }),
      prisma.refund.findMany({
        where: { clubId, createdAt: { gte: start.toJSDate(), lt: end.toJSDate() } },
        select: { amount: true, method: true, createdAt: true },
      }),
    ]);

    const totals: Record<string, Prisma.Decimal> = {};
    let collected = new Prisma.Decimal(0);
    let refunded = new Prisma.Decimal(0);
    const byDay: Record<string, Prisma.Decimal> = {};
    const dayKey = (d: Date) => DateTime.fromJSDate(d).setZone(club.timezone).toISODate()!;

    for (const p of payments) {
      totals[p.method] = (totals[p.method] ?? new Prisma.Decimal(0)).plus(p.amount);
      collected = collected.plus(p.amount);
      byDay[dayKey(p.createdAt)] = (byDay[dayKey(p.createdAt)] ?? new Prisma.Decimal(0)).plus(p.amount);
    }
    for (const r of refunds) {
      totals[r.method] = (totals[r.method] ?? new Prisma.Decimal(0)).minus(r.amount);
      collected = collected.minus(r.amount);
      refunded = refunded.plus(r.amount);
      byDay[dayKey(r.createdAt)] = (byDay[dayKey(r.createdAt)] ?? new Prisma.Decimal(0)).minus(r.amount);
    }

    const totalsByMethod: Record<string, string> = {};
    for (const [m, v] of Object.entries(totals)) totalsByMethod[m] = v.toFixed(2);
    const byDayArr = Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, net: v.toFixed(2) }));

    return { year, month, totalsByMethod, collected: collected.toFixed(2), refunded: refunded.toFixed(2), byDay: byDayArr };
  }

  /** Export CSV des encaissements sur [from, to] inclus, fuseau club. */
  async exportCsv(clubId: string, from: string, to: string): Promise<string> {
    const club = await prisma.club.findUnique({ where: { id: clubId }, select: { timezone: true } });
    if (!club) throw new Error('CLUB_NOT_FOUND');
    const start = DateTime.fromISO(from, { zone: club.timezone }).startOf('day');
    const end = DateTime.fromISO(to, { zone: club.timezone }).endOf('day');
    if (!start.isValid || !end.isValid) throw new Error('VALIDATION_ERROR');

    const payments = await prisma.payment.findMany({
      where: { clubId, createdAt: { gte: start.toJSDate(), lt: end.plus({ milliseconds: 1 }).toJSDate() } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true, receiptNo: true, method: true, amount: true, payerName: true, refundedAmount: true },
    });

    const esc = (v: unknown) => {
      const s = String(v ?? '');
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const fmtDate = (d: Date) => DateTime.fromJSDate(d).setZone(club.timezone).toFormat('yyyy-MM-dd HH:mm');
    const header = ['Date', 'Recu', 'Methode', 'Montant', 'Rembourse', 'Payeur'];
    const lines = payments.map((p) =>
      [
        fmtDate(p.createdAt),
        p.receiptNo ?? '',
        p.method,
        Number(p.amount).toFixed(2),
        Number(p.refundedAmount).toFixed(2),
        p.payerName ?? '',
      ]
        .map(esc)
        .join(','),
    );
    return [header.join(','), ...lines].join('\n');
  }
}
