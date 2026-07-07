import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { PlatformStatsService, lastMonths, bucketByMonth } from '../platformStats.service';

describe('lastMonths', () => {
  it('renvoie n mois ascendants, mois courant inclus', () => {
    expect(lastMonths(3, new Date('2026-07-15T12:00:00Z'))).toEqual(['2026-05', '2026-06', '2026-07']);
  });
  it('gère le passage d année', () => {
    expect(lastMonths(3, new Date('2026-01-10T12:00:00Z'))).toEqual(['2025-11', '2025-12', '2026-01']);
  });
});

describe('bucketByMonth', () => {
  const months = ['2026-05', '2026-06', '2026-07'];
  it('compte les dates dans le bon bucket, ignore hors fenêtre', () => {
    const dates = [
      new Date('2026-05-02T10:00:00Z'),
      new Date('2026-07-01T10:00:00Z'),
      new Date('2026-07-20T10:00:00Z'),
      new Date('2026-03-01T10:00:00Z'), // hors fenêtre
    ];
    expect(bucketByMonth(dates, months)).toEqual([1, 0, 2]);
  });
});

describe('PlatformStatsService.billingOverview', () => {
  const service = new PlatformStatsService();
  const now = new Date('2026-07-15T12:00:00Z');

  it('agrège MRR/paliers et bucketise le CA encaissé', async () => {
    prismaMock.club.findMany.mockResolvedValue([
      { activeMemberCount: 200, billingExempt: false, platformSubscription: { status: 'active', tier: 2, interval: 'month' } },
      { activeMemberCount: 60, billingExempt: false, platformSubscription: null }, // à régulariser
    ] as any);
    prismaMock.platformInvoice.findMany.mockResolvedValue([
      { amountCents: 5900, paidAt: new Date('2026-07-01T10:00:00Z'), createdAt: new Date('2026-07-01T10:00:00Z') },
      { amountCents: 5900, paidAt: new Date('2026-06-01T10:00:00Z'), createdAt: new Date('2026-06-01T10:00:00Z') },
    ] as any);

    const out = await service.billingOverview(now);
    expect(out.mrrCents).toBe(5900);
    expect(out.byTierSubscribed).toEqual([0, 0, 1, 0, 0]);
    expect(out.toRegularize).toBe(1);
    expect(out.totalCollectedCents).toBe(11800);
    expect(out.invoiceCount).toBe(2);
    expect(out.revenueByMonth).toHaveLength(12);
    expect(out.revenueByMonth[11]).toEqual({ month: '2026-07', amountCents: 5900 });
    expect(out.revenueByMonth[10]).toEqual({ month: '2026-06', amountCents: 5900 });
  });
});

describe('PlatformStatsService.usageStats', () => {
  const service = new PlatformStatsService();
  const now = new Date('2026-07-15T12:00:00Z');

  it('croissance bucketée + activité fusionnée et triée', async () => {
    prismaMock.club.findMany
      .mockResolvedValueOnce([{ createdAt: new Date('2026-07-02T10:00:00Z') }] as any) // newClubs
      .mockResolvedValueOnce([ // clubs (dernier findMany)
        { id: 'club-1', name: 'Arena', slug: 'arena', status: 'ACTIVE', activeMemberCount: 200 },
        { id: 'club-2', name: 'Lyon', slug: 'lyon', status: 'ACTIVE', activeMemberCount: 50 },
      ] as any);
    prismaMock.user.findMany.mockResolvedValue([
      { createdAt: new Date('2026-06-10T10:00:00Z') },
      { createdAt: new Date('2026-07-05T10:00:00Z') },
    ] as any);
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ month: '2026-07', count: 42 }] as any) // reservations/mois
      .mockResolvedValueOnce([ // activité par club
        { clubId: 'club-1', reservations30d: 30, lastReservationAt: new Date('2026-07-10T10:00:00Z') },
      ] as any);

    const out = await service.usageStats(now);
    expect(out.months).toHaveLength(12);
    expect(out.growth.newClubs[11]).toBe(1);
    expect(out.growth.newUsers[10]).toBe(1); // juin
    expect(out.growth.newUsers[11]).toBe(1); // juillet
    expect(out.growth.reservations[11]).toBe(42);
    // club-1 (30 résas) devant club-2 (0), club-2 présent à 0/null.
    expect(out.activity.map((a) => a.clubId)).toEqual(['club-1', 'club-2']);
    expect(out.activity[0].reservations30d).toBe(30);
    expect(out.activity[1]).toMatchObject({ reservations30d: 0, lastReservationAt: null });
  });
});
