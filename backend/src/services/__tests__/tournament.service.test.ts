import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { TournamentService } from '../tournament.service';

const FUTURE = new Date(Date.now() + 86_400_000); // +24h

function tournament(overrides: Record<string, unknown> = {}) {
  return { id: 't1', clubId: 'club-demo', gender: 'MEN', status: 'PUBLISHED', registrationDeadline: FUTURE, maxTeams: 8, ...overrides };
}

/** Configure le chemin nominal d'éligibilité (2 hommes membres ACTIVE, tél + licence + sexe OK). */
function mockEligibleHappyPath() {
  prismaMock.user.findUnique.mockImplementation((args: any) => {
    if (args.where.id === 'captain') return Promise.resolve({ id: 'captain', sex: 'MALE', phone: '0600000001' }) as any;
    if (args.where.email === 'partner@x.fr') return Promise.resolve({ id: 'partner', sex: 'MALE', phone: '0600000002' }) as any;
    return Promise.resolve(null) as any;
  });
  prismaMock.clubMembership.findUnique.mockImplementation((args: any) => {
    const uid = args.where.userId_clubId.userId;
    return Promise.resolve({ status: 'ACTIVE', membershipNo: uid === 'captain' ? 'LIC-1' : 'LIC-2' }) as any;
  });
  prismaMock.tournamentRegistration.findFirst.mockResolvedValue(null as any);
  prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
  prismaMock.$queryRaw.mockResolvedValue([] as any);
}

describe('TournamentService.register', () => {
  let service: TournamentService;
  beforeEach(() => { service = new TournamentService(); });

  it('crée une inscription CONFIRMED quand il reste des places', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(tournament({ maxTeams: 8 }) as any);
    mockEligibleHappyPath();
    prismaMock.tournamentRegistration.count.mockResolvedValue(3 as any);
    prismaMock.tournamentRegistration.create.mockResolvedValue({ id: 'r1', status: 'CONFIRMED' } as any);

    const result = await service.register('t1', 'captain', 'partner@x.fr');

    expect(prismaMock.tournamentRegistration.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tournamentId: 't1', captainUserId: 'captain', partnerUserId: 'partner', status: 'CONFIRMED' }) }),
    );
    expect(result.status).toBe('CONFIRMED');
  });

  it('place en WAITLISTED quand le tournoi est complet', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(tournament({ maxTeams: 8 }) as any);
    mockEligibleHappyPath();
    prismaMock.tournamentRegistration.count.mockResolvedValue(8 as any);
    prismaMock.tournamentRegistration.create.mockResolvedValue({ id: 'r1', status: 'WAITLISTED' } as any);

    await service.register('t1', 'captain', 'partner@x.fr');

    expect(prismaMock.tournamentRegistration.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'WAITLISTED' }) }),
    );
  });

  it('CONFIRMED sans limite de places (maxTeams null)', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(tournament({ maxTeams: null }) as any);
    mockEligibleHappyPath();
    prismaMock.tournamentRegistration.count.mockResolvedValue(999 as any);
    prismaMock.tournamentRegistration.create.mockResolvedValue({ id: 'r1', status: 'CONFIRMED' } as any);

    await service.register('t1', 'captain', 'partner@x.fr');

    expect(prismaMock.tournamentRegistration.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CONFIRMED' }) }),
    );
  });

  it('lève TOURNAMENT_NOT_OPEN si le tournoi est DRAFT', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(tournament({ status: 'DRAFT' }) as any);
    await expect(service.register('t1', 'captain', 'partner@x.fr')).rejects.toThrow('TOURNAMENT_NOT_OPEN');
  });

  it('lève REGISTRATION_CLOSED après la deadline', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(tournament({ registrationDeadline: new Date(Date.now() - 1000) }) as any);
    await expect(service.register('t1', 'captain', 'partner@x.fr')).rejects.toThrow('REGISTRATION_CLOSED');
  });

  it('lève PARTNER_NOT_FOUND si le coéquipier n a pas de compte', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(tournament() as any);
    prismaMock.user.findUnique.mockImplementation((args: any) =>
      (args.where.id === 'captain' ? Promise.resolve({ id: 'captain', sex: 'MALE', phone: '0600' }) : Promise.resolve(null)) as any);
    await expect(service.register('t1', 'captain', 'ghost@x.fr')).rejects.toThrow('PARTNER_NOT_FOUND');
  });

  it('lève MEMBERSHIP_REQUIRED si le coéquipier n est pas membre', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(tournament() as any);
    prismaMock.user.findUnique.mockImplementation((args: any) => {
      if (args.where.id === 'captain') return Promise.resolve({ id: 'captain', sex: 'MALE', phone: '0600' }) as any;
      if (args.where.email === 'partner@x.fr') return Promise.resolve({ id: 'partner', sex: 'MALE', phone: '0601' }) as any;
      return Promise.resolve(null) as any;
    });
    prismaMock.clubMembership.findUnique.mockImplementation((args: any) =>
      (args.where.userId_clubId.userId === 'captain' ? Promise.resolve({ status: 'ACTIVE', membershipNo: 'L1' }) : Promise.resolve(null)) as any);
    await expect(service.register('t1', 'captain', 'partner@x.fr')).rejects.toThrow('MEMBERSHIP_REQUIRED');
  });

  it('lève LICENSE_REQUIRED si une licence manque', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(tournament() as any);
    mockEligibleHappyPath();
    prismaMock.clubMembership.findUnique.mockImplementation((args: any) =>
      (args.where.userId_clubId.userId === 'captain' ? Promise.resolve({ status: 'ACTIVE', membershipNo: 'L1' }) : Promise.resolve({ status: 'ACTIVE', membershipNo: null })) as any);
    await expect(service.register('t1', 'captain', 'partner@x.fr')).rejects.toThrow('LICENSE_REQUIRED');
  });

  it('lève SEX_REQUIRED si le sexe d un joueur est absent', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(tournament() as any);
    mockEligibleHappyPath();
    prismaMock.user.findUnique.mockImplementation((args: any) => {
      if (args.where.id === 'captain') return Promise.resolve({ id: 'captain', sex: null, phone: '0600' }) as any;
      if (args.where.email === 'partner@x.fr') return Promise.resolve({ id: 'partner', sex: 'MALE', phone: '0601' }) as any;
      return Promise.resolve(null) as any;
    });
    await expect(service.register('t1', 'captain', 'partner@x.fr')).rejects.toThrow('SEX_REQUIRED');
  });

  it('lève GENDER_MISMATCH si un tournoi Mixte reçoit 2 hommes', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(tournament({ gender: 'MIXED' }) as any);
    mockEligibleHappyPath(); // 2 MALE
    await expect(service.register('t1', 'captain', 'partner@x.fr')).rejects.toThrow('GENDER_MISMATCH');
  });

  it('lève ALREADY_REGISTERED si un joueur est déjà engagé', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(tournament() as any);
    mockEligibleHappyPath();
    prismaMock.tournamentRegistration.findFirst.mockResolvedValue({ id: 'r-existing' } as any);
    await expect(service.register('t1', 'captain', 'partner@x.fr')).rejects.toThrow('ALREADY_REGISTERED');
  });
});
