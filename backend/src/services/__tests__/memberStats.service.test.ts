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
    id: 'mb-base', createdAt: D('2026-01-01T00:00:00Z'), isSubscriber: false, membershipNo: null,
    status: 'ACTIVE', watch: false, isReferee: false, note: null,
    user: {
      firstName: 'Jean', lastName: 'Dupont', email: 'jean@d.fr', phone: null, avatarUrl: null,
      birthDate: null, sex: null, address: null, postalCode: null, city: null,
    },
  } as any);
  prismaMock.reservation.findMany.mockResolvedValue([] as any);
  prismaMock.memberPackage.findMany.mockResolvedValue([] as any);
  prismaMock.payment.findMany.mockResolvedValue([] as any);            // consommation prépayé
  prismaMock.user.findUnique.mockResolvedValue({ preferredSport: null } as any); // → 'padel'
  prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-padel' } as any);
  prismaMock.playerRating.findUnique.mockResolvedValue(null as any);
  prismaMock.matchPlayer.findMany.mockResolvedValue([] as any);
  // Fiche 360 : à venir + abonnement + rôle/facettes — vides par défaut.
  prismaMock.tournamentRegistration.findMany.mockResolvedValue([] as any);
  prismaMock.eventRegistration.findMany.mockResolvedValue([] as any);
  prismaMock.lessonEnrollment.findMany.mockResolvedValue([] as any);
  prismaMock.subscription.findFirst.mockResolvedValue(null as any);
  prismaMock.clubMember.findUnique.mockResolvedValue(null as any);
  prismaMock.coach.findFirst.mockResolvedValue(null as any);
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

  it('compte super-admin plateforme → MEMBER_NOT_FOUND (pas de fiche côté club, même par accès direct)', async () => {
    prismaMock.clubMembership.findUnique.mockResolvedValue({
      createdAt: D('2026-01-01T00:00:00Z'), isSubscriber: false, membershipNo: null, status: 'ACTIVE', watch: false,
      user: { firstName: 'Super', lastName: 'Admin', email: 'super@palova.fr', phone: null, avatarUrl: null, isSuperAdmin: true },
    } as any);
    await expect(service.getMemberHistory('club-1', 'u-super')).rejects.toThrow('MEMBER_NOT_FOUND');
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
        participants: [{ id: 'p1a', userId: 'u1', share: 30, isOrganizer: true, user: { firstName: 'Jean', lastName: 'Dupont' } }],
        payments: [
          { amount: 25, method: 'CASH', participantId: 'p1a', createdAt: D('2026-06-15T19:00:00Z'), refunds: [] },
          { amount: 5,  method: 'CASH', participantId: null,  createdAt: D('2026-06-15T19:00:00Z'), refunds: [] },
        ],
        matches: [],
      },
      {
        id: 'r2', status: 'CONFIRMED', type: 'COURT',
        startTime: D('2026-06-16T18:00:00Z'), endTime: D('2026-06-16T19:00:00Z'),
        totalPrice: 20, cancelledAt: null, userId: 'autre',
        resource: { name: 'Court 2', price: 20, offPeakPrice: null, clubSport: { sport: { key: 'padel' } } },
        participants: [
          { id: 'p2a', userId: 'u1',    share: 10, isOrganizer: false, user: { firstName: 'Jean', lastName: 'Dupont' } },
          { id: 'p2b', userId: 'autre', share: 10, isOrganizer: true, user: { firstName: 'Autre', lastName: 'Joueur' } },
        ],
        payments: [
          { amount: 10, method: 'CARD', participantId: 'p2a', createdAt: D('2026-06-16T19:00:00Z'), refunds: [{ amount: 4, createdAt: D('2026-06-17T10:00:00Z') }] },
        ],
        matches: [],
      },
    ] as any);

    const out = await service.getMemberHistory('club-1', 'u1');
    expect(out.finance.totalSpent).toBe('36.00');        // 25 + 5 + (10 - 4)
    expect(out.finance.paymentsByMethod.CASH).toBe('30.00');
    expect(out.finance.paymentsByMethod.CARD).toBe('6.00');
    expect(out.finance.averageBasket).toBe('18.00');
    expect(out.reservations.find((r) => r.id === 'r2')!.attributedAmount).toBe('6.00');
    expect(out.reservations.find((r) => r.id === 'r2')!.dueAmount).toBe('10.00'); // part due (share) ≠ payé net
    expect(out.counts.confirmed).toBe(2);
  });

  it('compte les no-show réellement facturés (Payment.noShow), distinct de l\'estimation', async () => {
    prismaMock.reservation.findMany.mockResolvedValue([
      {
        id: 'r1', status: 'CONFIRMED', type: 'COURT',
        startTime: D('2026-06-10T18:00:00Z'), endTime: D('2026-06-10T19:00:00Z'),
        totalPrice: 25, cancelledAt: null, userId: 'u1',
        resource: { name: 'Court 1', price: 25, offPeakPrice: null, clubSport: { sport: { key: 'padel' } } },
        participants: [{ id: 'p1a', userId: 'u1', share: 25, isOrganizer: true, user: { firstName: 'Jean', lastName: 'Dupont' } }],
        payments: [
          { amount: 25, method: 'ONLINE', participantId: 'p1a', createdAt: D('2026-06-10T20:00:00Z'), refunds: [], noShow: true },
        ],
        matches: [],
      },
      {
        id: 'r2', status: 'CONFIRMED', type: 'COURT',
        startTime: D('2026-06-17T18:00:00Z'), endTime: D('2026-06-17T19:00:00Z'),
        totalPrice: 25, cancelledAt: null, userId: 'u1',
        resource: { name: 'Court 1', price: 25, offPeakPrice: null, clubSport: { sport: { key: 'padel' } } },
        participants: [{ id: 'p2a', userId: 'u1', share: 25, isOrganizer: true, user: { firstName: 'Jean', lastName: 'Dupont' } }],
        payments: [
          { amount: 25, method: 'ONLINE', participantId: 'p2a', createdAt: D('2026-06-17T20:00:00Z'), refunds: [], noShow: true },
        ],
        matches: [],
      },
    ] as any);

    const out = await service.getMemberHistory('club-1', 'u1');
    expect(out.counts.noShowCharged).toBe(2);
    expect(out.noShowChargedLastAt).toBe('2026-06-17T20:00:00.000Z');
  });

  it('counts.noShowCharged = 0 et noShowChargedLastAt = null sans débit no-show', async () => {
    const out = await service.getMemberHistory('club-1', 'u1');
    expect(out.counts.noShowCharged).toBe(0);
    expect(out.noShowChargedLastAt).toBeNull();
  });

  it('exclut PACK_CREDIT/MEMBER du total, expose soldes + consommation + hasActivePackage', async () => {
    prismaMock.reservation.findMany.mockResolvedValue([
      {
        id: 'r1', status: 'CONFIRMED', type: 'COURT',
        startTime: D('2026-06-15T18:00:00Z'), endTime: D('2026-06-15T19:00:00Z'),
        totalPrice: 20, cancelledAt: null, userId: 'u1',
        resource: { name: 'Court 1', price: 20, offPeakPrice: null, clubSport: { sport: { key: 'padel' } } },
        participants: [{ id: 'p1', userId: 'u1', share: 20, isOrganizer: true, user: { firstName: 'Jean', lastName: 'Dupont' } }],
        payments: [{ amount: 20, method: 'MEMBER', participantId: 'p1', createdAt: D('2026-06-15T19:00:00Z'), refunds: [] }],
        matches: [],
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
        participants: [{ id: 'p1', userId: 'u1', share: 30, isOrganizer: true, user: { firstName: 'Jean', lastName: 'Dupont' } }],
        payments: [{ amount: 30, method: 'CASH', participantId: 'p1', createdAt: D('2026-05-31T23:00:00Z'), refunds: [] }], // Paris: 1er juin
        matches: [],
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
        participants: [{ id: 'pc1', userId: 'u1', share: 0, isOrganizer: true, user: { firstName: 'Jean', lastName: 'Dupont' } }],
        payments: [], matches: [] },
      // annulée TARDIVEMENT : annulée le jour même (< 24 h avant le début)
      { id: 'x1', status: 'CANCELLED', type: 'COURT', startTime: D('2026-05-01T18:00:00Z'), endTime: D('2026-05-01T19:00:00Z'),
        totalPrice: 0, cancelledAt: D('2026-05-01T12:00:00Z'), userId: 'u1',
        resource: { name: 'Court 1', price: 0, offPeakPrice: null, clubSport: { sport: { key: 'padel' } } },
        participants: [{ id: 'px1', userId: 'u1', share: 0, isOrganizer: true, user: { firstName: 'Jean', lastName: 'Dupont' } }],
        payments: [], matches: [] },
    ] as any);

    const out = await service.getMemberHistory('club-1', 'u1');
    expect(out.counts.cancelled).toBe(1);
    expect(out.counts.lateCancelled).toBe(1);              // annulée < 24 h avant
    expect(out.loyalty.cancellationRate).toBeCloseTo(0.5, 5);
    expect(out.loyalty.atRisk).toBe(true);                 // dernière visite le 1er avril
  });
});

describe('getMemberHistory — enrichissements fiche 360', () => {
  let service: MemberStatsService;
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(D('2026-06-23T12:00:00Z'));
    service = new MemberStatsService();
    baseMocks();
  });
  afterEach(() => jest.useRealTimers());

  it('expose membershipId, identité complète, rôle et facettes', async () => {
    prismaMock.clubMembership.findUnique.mockResolvedValue({
      id: 'mb1', createdAt: D('2024-03-01T00:00:00Z'), isSubscriber: true, membershipNo: 'PAR1010',
      status: 'ACTIVE', watch: false, isReferee: true, note: 'VIP',
      user: {
        firstName: 'Ines', lastName: 'Andre', email: 'i@a.fr', phone: '06', avatarUrl: null,
        isSuperAdmin: false, birthDate: D('1992-09-04T00:00:00Z'), sex: 'FEMALE',
        address: '12 rue des Sports', postalCode: '31000', city: 'Toulouse', pseudo: 'SmashMaster',
      },
    } as any);
    prismaMock.clubMember.findUnique.mockResolvedValue({ role: 'STAFF' } as any);
    prismaMock.coach.findFirst.mockResolvedValue(null as any);

    const h = await service.getMemberHistory('club-demo', 'u1');
    expect(h.member).toMatchObject({
      membershipId: 'mb1', birthDate: '1992-09-04', sex: 'FEMALE',
      address: '12 rue des Sports', postalCode: '31000', city: 'Toulouse',
      staffRole: 'STAFF', isCoach: false, isReferee: true, note: 'VIP', pseudo: 'SmashMaster',
    });
  });

  it('les réservations portent participants nommés et résultat de match', async () => {
    prismaMock.reservation.findMany.mockResolvedValue([{
      id: 'r1', status: 'CONFIRMED', type: 'COURT', startTime: D('2026-07-19T16:00:00Z'),
      endTime: D('2026-07-19T17:30:00Z'), totalPrice: 25, cancelledAt: null, userId: 'u1',
      resource: { name: 'Terrain 2', price: 25, offPeakPrice: null, clubSport: { sport: { key: 'padel' } } },
      participants: [
        { id: 'p1', userId: 'u1', share: 0, isOrganizer: true, user: { firstName: 'Ines', lastName: 'Andre' } },
        { id: 'p2', userId: 'u2', share: 0, isOrganizer: false, user: { firstName: 'Lucas', lastName: 'Martin' } },
      ],
      payments: [],
      matches: [{ status: 'CONFIRMED', winningTeam: 1, sets: [[6, 3], [6, 4]], competitive: true,
        players: [{ userId: 'u1', team: 1 }] }],
    }] as any);

    const h = await service.getMemberHistory('club-demo', 'u1');
    expect(h.reservations[0].participants).toEqual([
      { userId: 'u1', firstName: 'Ines', lastName: 'Andre', isOrganizer: true },
      { userId: 'u2', firstName: 'Lucas', lastName: 'Martin', isOrganizer: false },
    ]);
    expect(h.reservations[0].match).toEqual({ winningTeam: 1, myTeam: 1, sets: [[6, 3], [6, 4]], competitive: true });
  });

  it('upcoming fusionne résas futures, tournois, events et cours (tri asc, cap 5)', async () => {
    prismaMock.tournamentRegistration.findMany.mockResolvedValue([
      { status: 'CONFIRMED', tournament: { id: 't1', name: 'P100 Dames', startTime: D('2099-07-26T08:00:00Z') } },
    ] as any);
    prismaMock.eventRegistration.findMany.mockResolvedValue([
      { status: 'WAITLISTED', event: { id: 'e1', name: 'Mêlée du soir', startTime: D('2099-07-24T18:00:00Z') } },
    ] as any);
    prismaMock.lessonEnrollment.findMany.mockResolvedValue([
      { lesson: { id: 'l1', reservation: { startTime: D('2099-07-28T10:00:00Z'), resource: { name: 'Terrain 1' } } } },
    ] as any);

    const h = await service.getMemberHistory('club-demo', 'u1');
    expect(h.upcoming.map((u) => u.kind)).toEqual(['event', 'tournament', 'lesson']);
    expect(h.upcoming[0]).toMatchObject({ kind: 'event', title: 'Mêlée du soir', status: 'WAITLISTED' });
  });

  it('expose l\'abonnement actif (ou null)', async () => {
    prismaMock.subscription.findFirst.mockResolvedValue({
      id: 's1', planId: 'pl1', expiresAt: D('2099-08-10T00:00:00Z'), monthlyPriceSnapshot: 39, sportKeys: ['padel'],
      plan: { name: 'Padel illimité' },
    } as any);

    const h = await service.getMemberHistory('club-demo', 'u1');
    expect(h.subscription).toMatchObject({ id: 's1', planName: 'Padel illimité', monthlyPriceSnapshot: '39' });
  });

  it("un match PENDING ou DISPUTED n'apparaît pas dans reservations[].match (résultat non définitif)", async () => {
    // Simule le comportement réel de Postgres/Prisma pour le `where.status` passé par le service —
    // un mock naïf (retour fixe indépendant des arguments) ne pourrait pas distinguer un filtre
    // strict `'CONFIRMED'` d'un filtre large `{ not: 'CANCELLED' }` (qui laisserait PENDING/DISPUTED
    // passer) : c'est exactement la régression que ce test doit verrouiller.
    const matchesStatusWhere = (status: string, where: unknown): boolean => {
      if (where == null) return true;
      if (typeof where === 'string') return status === where;
      const w = where as { not?: string; equals?: string };
      if (w.not != null) return status !== w.not;
      if (w.equals != null) return status === w.equals;
      return true;
    };
    const allMatches = [
      { status: 'DISPUTED', winningTeam: 2, sets: [[6, 2]], competitive: true, players: [{ userId: 'u1', team: 1 }] },
      { status: 'PENDING', winningTeam: 1, sets: [[6, 3]], competitive: true, players: [{ userId: 'u1', team: 1 }] },
    ];
    prismaMock.reservation.findMany.mockImplementation((args: any) => {
      const where = args?.select?.matches?.where?.status;
      const filtered = allMatches.filter((m) => matchesStatusWhere(m.status, where));
      return Promise.resolve([{
        id: 'r1', status: 'CONFIRMED', type: 'COURT', startTime: D('2026-06-15T18:00:00Z'), endTime: D('2026-06-15T19:00:00Z'),
        totalPrice: 20, cancelledAt: null, userId: 'u1',
        resource: { name: 'Court 1', price: 20, offPeakPrice: null, clubSport: { sport: { key: 'padel' } } },
        participants: [{ id: 'p1', userId: 'u1', share: 20, isOrganizer: true, user: { firstName: 'Jean', lastName: 'Dupont' } }],
        payments: [], matches: filtered,
      }] as any) as any;
    });

    const h = await service.getMemberHistory('club-demo', 'u1');
    expect(h.reservations[0].match).toBeNull();
  });

  it("une inscription à une série de cours (lessonId null, seriesId renseigné) apparaît dans upcoming avec la prochaine occurrence", async () => {
    // LessonEnrollment.lessonId est nullable — une série récurrente n'a pas de `lessonId` unique.
    // Le service fait deux appels à lessonEnrollment.findMany (branche lesson / branche série) ;
    // on distingue les deux ici via le `where` reçu, comme pour la simulation ci-dessus.
    prismaMock.lessonEnrollment.findMany.mockImplementation((args: any) => {
      if (args?.where?.seriesId) return Promise.resolve([{ seriesId: 'serie-1' }] as any) as any;
      return Promise.resolve([] as any) as any; // pas d'inscription lessonId non-null dans ce test
    });
    prismaMock.lesson.findMany.mockResolvedValue([
      { id: 'lnext', reservation: { startTime: D('2099-09-01T09:00:00Z'), resource: { name: 'Terrain 3' } } },
    ] as any);

    const h = await service.getMemberHistory('club-demo', 'u1');
    expect(h.upcoming).toEqual([
      { kind: 'lesson', id: 'lnext', title: 'Cours · Terrain 3', startTime: '2099-09-01T09:00:00.000Z', status: null },
    ]);
    expect(prismaMock.lesson.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ seriesId: 'serie-1' }),
      take: 1,
    }));
  });
});
