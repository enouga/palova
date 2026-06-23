import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { MemberStatsService } from '../memberStats.service';

const D = (s: string) => new Date(s);

// Socle de mocks : un membre actif, sans aucune activité. Chaque test surcharge ce qu'il teste.
function baseMocks() {
  prismaMock.club.findUnique.mockResolvedValue({
    timezone: 'Europe/Paris', offPeakHours: null, cancellationCutoffHours: 24,
  } as any);
  prismaMock.clubMembership.findUnique.mockResolvedValue({
    createdAt: D('2026-01-01T00:00:00Z'), isSubscriber: false, membershipNo: null, status: 'ACTIVE', watch: false,
    user: { firstName: 'Jean', lastName: 'Dupont', email: 'jean@d.fr', phone: null, avatarUrl: null },
  } as any);
  prismaMock.reservation.findMany.mockResolvedValue([] as any);
  prismaMock.memberPackage.findMany.mockResolvedValue([] as any);
  prismaMock.payment.findMany.mockResolvedValue([] as any);            // consommation prépayé
  prismaMock.user.findUnique.mockResolvedValue({ preferredSport: null } as any); // → 'padel'
  prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-padel' } as any);
  prismaMock.playerRating.findUnique.mockResolvedValue(null as any);
  prismaMock.matchPlayer.findMany.mockResolvedValue([] as any);
}

describe('MemberStatsService.getMemberHistory', () => {
  let service: MemberStatsService;
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(D('2026-06-23T12:00:00Z'));
    service = new MemberStatsService();
    baseMocks();
  });
  afterEach(() => jest.useRealTimers());

  it('membre inexistant → MEMBER_NOT_FOUND', async () => {
    prismaMock.clubMembership.findUnique.mockResolvedValue(null as any);
    await expect(service.getMemberHistory('club-1', 'u1')).rejects.toThrow('MEMBER_NOT_FOUND');
  });

  it('expose le drapeau watch', async () => {
    prismaMock.clubMembership.findUnique.mockResolvedValue({
      createdAt: D('2026-01-01T00:00:00Z'), isSubscriber: true, membershipNo: 'L42', status: 'ACTIVE', watch: true,
      user: { firstName: 'Jean', lastName: 'Dupont', email: 'jean@d.fr', phone: null, avatarUrl: null },
    } as any);
    const out = await service.getMemberHistory('club-1', 'u1');
    expect(out.member.watch).toBe(true);
    expect(out.member.isSubscriber).toBe(true);
  });

  it('attribue l\'argent via Reservation.userId ET via ReservationParticipant, net des remboursements', async () => {
    prismaMock.reservation.findMany.mockResolvedValue([
      {
        id: 'r1', status: 'CONFIRMED', type: 'COURT',
        startTime: D('2026-06-15T18:00:00Z'), endTime: D('2026-06-15T19:00:00Z'),
        totalPrice: 30, cancelledAt: null, userId: 'u1',
        resource: { name: 'Court 1', price: 30, offPeakPrice: null, clubSport: { sport: { key: 'padel' } } },
        participants: [{ id: 'p1a', userId: 'u1', share: 30, isOrganizer: true }],
        payments: [
          { amount: 25, method: 'CASH', participantId: 'p1a', createdAt: D('2026-06-15T19:00:00Z'), refunds: [] },
          { amount: 5,  method: 'CASH', participantId: null,  createdAt: D('2026-06-15T19:00:00Z'), refunds: [] },
        ],
      },
      {
        id: 'r2', status: 'CONFIRMED', type: 'COURT',
        startTime: D('2026-06-16T18:00:00Z'), endTime: D('2026-06-16T19:00:00Z'),
        totalPrice: 20, cancelledAt: null, userId: 'autre',
        resource: { name: 'Court 2', price: 20, offPeakPrice: null, clubSport: { sport: { key: 'padel' } } },
        participants: [
          { id: 'p2a', userId: 'u1',    share: 10, isOrganizer: false },
          { id: 'p2b', userId: 'autre', share: 10, isOrganizer: true },
        ],
        payments: [
          { amount: 10, method: 'CARD', participantId: 'p2a', createdAt: D('2026-06-16T19:00:00Z'), refunds: [{ amount: 4, createdAt: D('2026-06-17T10:00:00Z') }] },
        ],
      },
    ] as any);

    const out = await service.getMemberHistory('club-1', 'u1');
    expect(out.finance.totalSpent).toBe('36.00');        // 25 + 5 + (10 - 4)
    expect(out.finance.paymentsByMethod.CASH).toBe('30.00');
    expect(out.finance.paymentsByMethod.CARD).toBe('6.00');
    expect(out.finance.averageBasket).toBe('18.00');
    expect(out.reservations.find((r) => r.id === 'r2')!.attributedAmount).toBe('6.00');
    expect(out.counts.confirmed).toBe(2);
  });

  it('exclut PACK_CREDIT/MEMBER du total, expose soldes + consommation + hasActivePackage', async () => {
    prismaMock.reservation.findMany.mockResolvedValue([
      {
        id: 'r1', status: 'CONFIRMED', type: 'COURT',
        startTime: D('2026-06-15T18:00:00Z'), endTime: D('2026-06-15T19:00:00Z'),
        totalPrice: 20, cancelledAt: null, userId: 'u1',
        resource: { name: 'Court 1', price: 20, offPeakPrice: null, clubSport: { sport: { key: 'padel' } } },
        participants: [{ id: 'p1', userId: 'u1', share: 20, isOrganizer: true }],
        payments: [{ amount: 20, method: 'MEMBER', participantId: 'p1', createdAt: D('2026-06-15T19:00:00Z'), refunds: [] }],
      },
    ] as any);
    prismaMock.memberPackage.findMany.mockResolvedValue([
      { id: 'pk1', kind: 'ENTRIES', creditsRemaining: 8, amountRemaining: null,
        purchasedAt: D('2026-05-01T00:00:00Z'), expiresAt: null, template: { name: 'Carnet 10' } },
    ] as any);
    prismaMock.payment.findMany.mockResolvedValue([
      { createdAt: D('2026-06-10T18:00:00Z'), method: 'PACK_CREDIT', amount: 12.5, sourcePackageId: 'pk1' },
    ] as any);

    const out = await service.getMemberHistory('club-1', 'u1');
    expect(out.finance.totalSpent).toBe('0.00');
    expect(out.member.hasActivePackage).toBe(true);      // carnet avec entrées restantes, non expiré
    expect(out.finance.prepaid.balances[0].creditsRemaining).toBe(8);
    expect(out.finance.prepaid.consumption[0]).toMatchObject({ method: 'PACK_CREDIT', amount: '12.50', packageName: 'Carnet 10' });
  });

  it('compte victoires/défaites (winningTeam null ignoré) et les partenaires fréquents', async () => {
    const players = [
      { userId: 'u1', team: 1, user: { firstName: 'Jean', lastName: 'Dupont' } },
      { userId: 'bob', team: 1, user: { firstName: 'Bob', lastName: 'B' } },
      { userId: 'x', team: 2, user: { firstName: 'X', lastName: 'X' } },
      { userId: 'y', team: 2, user: { firstName: 'Y', lastName: 'Y' } },
    ];
    prismaMock.matchPlayer.findMany
      .mockResolvedValueOnce([
        { team: 1, match: { winningTeam: 1, players } },
        { team: 1, match: { winningTeam: 2, players } },
        { team: 1, match: { winningTeam: null, players } },
      ] as any)
      .mockResolvedValueOnce([] as any);

    const out = await service.getMemberHistory('club-1', 'u1');
    expect(out.game.wins).toBe(1);
    expect(out.game.losses).toBe(1);
    expect(out.game.frequentPartners[0]).toMatchObject({ userId: 'bob', count: 3 });
  });

  it('bucketise mois (CA) et heatmap au fuseau du club', async () => {
    prismaMock.reservation.findMany.mockResolvedValue([
      {
        id: 'r1', status: 'CONFIRMED', type: 'COURT',
        startTime: D('2026-06-15T18:00:00Z'), endTime: D('2026-06-15T19:00:00Z'), // Paris: lundi 20h
        totalPrice: 30, cancelledAt: null, userId: 'u1',
        resource: { name: 'Court 1', price: 30, offPeakPrice: null, clubSport: { sport: { key: 'padel' } } },
        participants: [{ id: 'p1', userId: 'u1', share: 30, isOrganizer: true }],
        payments: [{ amount: 30, method: 'CASH', participantId: 'p1', createdAt: D('2026-05-31T23:00:00Z'), refunds: [] }], // Paris: 1er juin
      },
    ] as any);

    const out = await service.getMemberHistory('club-1', 'u1');
    expect(out.heatmap[0][20]).toBe(1);
    expect(out.finance.revenueByMonth).toEqual([{ month: '2026-06', net: '30.00' }]);
  });

  it('taux d\'annulation, annulations tardives et drapeau « à risque »', async () => {
    prismaMock.reservation.findMany.mockResolvedValue([
      { id: 'c1', status: 'CONFIRMED', type: 'COURT', startTime: D('2026-04-01T18:00:00Z'), endTime: D('2026-04-01T19:00:00Z'),
        totalPrice: 0, cancelledAt: null, userId: 'u1',
        resource: { name: 'Court 1', price: 0, offPeakPrice: null, clubSport: { sport: { key: 'padel' } } },
        participants: [{ id: 'pc1', userId: 'u1', share: 0, isOrganizer: true }], payments: [] },
      // annulée TARDIVEMENT : annulée le jour même (< 24 h avant le début)
      { id: 'x1', status: 'CANCELLED', type: 'COURT', startTime: D('2026-05-01T18:00:00Z'), endTime: D('2026-05-01T19:00:00Z'),
        totalPrice: 0, cancelledAt: D('2026-05-01T12:00:00Z'), userId: 'u1',
        resource: { name: 'Court 1', price: 0, offPeakPrice: null, clubSport: { sport: { key: 'padel' } } },
        participants: [{ id: 'px1', userId: 'u1', share: 0, isOrganizer: true }], payments: [] },
    ] as any);

    const out = await service.getMemberHistory('club-1', 'u1');
    expect(out.counts.cancelled).toBe(1);
    expect(out.counts.lateCancelled).toBe(1);              // annulée < 24 h avant
    expect(out.loyalty.cancellationRate).toBeCloseTo(0.5, 5);
    expect(out.loyalty.atRisk).toBe(true);                 // dernière visite le 1er avril
  });
});
