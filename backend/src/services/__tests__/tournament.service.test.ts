import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { TournamentService } from '../tournament.service';
import {
  notifyTournamentRegistration,
  notifyTournamentCancellation,
  notifyTournamentPromotion,
} from '../../email/notifications';
import { PackageService } from '../package.service';
import { StripeService } from '../stripe.service';
import { RefundService } from '../refund.service';

// Pas d'envoi d'email réel pendant les tests : la couche notifications est mockée.
jest.mock('../../email/notifications');

const FUTURE = new Date(Date.now() + 86_400_000); // +24h

function tournament(overrides: Record<string, unknown> = {}) {
  return { id: 't1', clubId: 'club-demo', gender: 'MEN', openToWomen: true, status: 'PUBLISHED', registrationDeadline: FUTURE, maxTeams: 8, requirePrepayment: false, entryFee: null, ...overrides };
}

/** Mocke l'éligibilité (membre ACTIVE + tél + licence + sexe) d'un binôme aux sexes choisis. */
function mockEligibleWithSexes(captainSex: 'MALE' | 'FEMALE', partnerSex: 'MALE' | 'FEMALE') {
  mockEligibleHappyPath();
  prismaMock.user.findUnique.mockImplementation((args: any) => {
    if (args.where.id === 'captain') return Promise.resolve({ id: 'captain', sex: captainSex, phone: '0600000001' }) as any;
    if (args.where.id === 'partner') return Promise.resolve({ id: 'partner', sex: partnerSex, phone: '0600000002' }) as any;
    return Promise.resolve(null) as any;
  });
}

/** Configure le chemin nominal d'éligibilité (2 hommes membres ACTIVE, tél + licence + sexe OK). */
function mockEligibleHappyPath() {
  prismaMock.user.findUnique.mockImplementation((args: any) => {
    if (args.where.id === 'captain') return Promise.resolve({ id: 'captain', sex: 'MALE', phone: '0600000001' }) as any;
    if (args.where.id === 'partner') return Promise.resolve({ id: 'partner', sex: 'MALE', phone: '0600000002' }) as any;
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
  beforeEach(() => { jest.clearAllMocks(); service = new TournamentService(); });

  it('crée une inscription CONFIRMED quand il reste des places', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(tournament({ maxTeams: 8 }) as any);
    mockEligibleHappyPath();
    prismaMock.tournamentRegistration.count.mockResolvedValue(3 as any);
    prismaMock.tournamentRegistration.create.mockResolvedValue({ id: 'r1', status: 'CONFIRMED' } as any);

    const result = await service.register('t1', 'captain', 'partner');

    expect(prismaMock.tournamentRegistration.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tournamentId: 't1', captainUserId: 'captain', partnerUserId: 'partner', status: 'CONFIRMED' }) }),
    );
    expect(result.registration.status).toBe('CONFIRMED');
  });

  it('place en WAITLISTED quand le tournoi est complet', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(tournament({ maxTeams: 8 }) as any);
    mockEligibleHappyPath();
    prismaMock.tournamentRegistration.count.mockResolvedValue(8 as any);
    prismaMock.tournamentRegistration.create.mockResolvedValue({ id: 'r1', status: 'WAITLISTED' } as any);

    await service.register('t1', 'captain', 'partner');

    expect(prismaMock.tournamentRegistration.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'WAITLISTED' }) }),
    );
  });

  it('CONFIRMED sans limite de places (maxTeams null)', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(tournament({ maxTeams: null }) as any);
    mockEligibleHappyPath();
    prismaMock.tournamentRegistration.count.mockResolvedValue(999 as any);
    prismaMock.tournamentRegistration.create.mockResolvedValue({ id: 'r1', status: 'CONFIRMED' } as any);

    await service.register('t1', 'captain', 'partner');

    expect(prismaMock.tournamentRegistration.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CONFIRMED' }) }),
    );
  });

  it('lève TOURNAMENT_NOT_OPEN si le tournoi est DRAFT', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(tournament({ status: 'DRAFT' }) as any);
    await expect(service.register('t1', 'captain', 'partner')).rejects.toThrow('TOURNAMENT_NOT_OPEN');
  });

  it('lève REGISTRATION_CLOSED après la deadline', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(tournament({ registrationDeadline: new Date(Date.now() - 1000) }) as any);
    await expect(service.register('t1', 'captain', 'partner')).rejects.toThrow('REGISTRATION_CLOSED');
  });

  it('lève PARTNER_NOT_FOUND si le coéquipier n a pas de compte', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(tournament() as any);
    prismaMock.user.findUnique.mockImplementation((args: any) =>
      (args.where.id === 'captain' ? Promise.resolve({ id: 'captain', sex: 'MALE', phone: '0600' }) : Promise.resolve(null)) as any);
    await expect(service.register('t1', 'captain', 'ghost')).rejects.toThrow('PARTNER_NOT_FOUND');
  });

  it('lève PARTNER_IS_SELF si le coéquipier est le capitaine lui-même', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(tournament() as any);
    await expect(service.register('t1', 'captain', 'captain')).rejects.toThrow('PARTNER_IS_SELF');
  });

  it('lève MEMBERSHIP_REQUIRED si le coéquipier n est pas membre', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(tournament() as any);
    prismaMock.user.findUnique.mockImplementation((args: any) => {
      if (args.where.id === 'captain') return Promise.resolve({ id: 'captain', sex: 'MALE', phone: '0600' }) as any;
      if (args.where.id === 'partner') return Promise.resolve({ id: 'partner', sex: 'MALE', phone: '0601' }) as any;
      return Promise.resolve(null) as any;
    });
    prismaMock.clubMembership.findUnique.mockImplementation((args: any) =>
      (args.where.userId_clubId.userId === 'captain' ? Promise.resolve({ status: 'ACTIVE', membershipNo: 'L1' }) : Promise.resolve(null)) as any);
    await expect(service.register('t1', 'captain', 'partner')).rejects.toThrow('MEMBERSHIP_REQUIRED');
  });

  it('lève LICENSE_REQUIRED si une licence manque', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(tournament() as any);
    mockEligibleHappyPath();
    prismaMock.clubMembership.findUnique.mockImplementation((args: any) =>
      (args.where.userId_clubId.userId === 'captain' ? Promise.resolve({ status: 'ACTIVE', membershipNo: 'L1' }) : Promise.resolve({ status: 'ACTIVE', membershipNo: null })) as any);
    await expect(service.register('t1', 'captain', 'partner')).rejects.toThrow('LICENSE_REQUIRED');
  });

  it('lève SEX_REQUIRED si le sexe d un joueur est absent', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(tournament() as any);
    mockEligibleHappyPath();
    prismaMock.user.findUnique.mockImplementation((args: any) => {
      if (args.where.id === 'captain') return Promise.resolve({ id: 'captain', sex: null, phone: '0600' }) as any;
      if (args.where.id === 'partner') return Promise.resolve({ id: 'partner', sex: 'MALE', phone: '0601' }) as any;
      return Promise.resolve(null) as any;
    });
    await expect(service.register('t1', 'captain', 'partner')).rejects.toThrow('SEX_REQUIRED');
  });

  it('lève GENDER_MISMATCH si un tournoi Mixte reçoit 2 hommes', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(tournament({ gender: 'MIXED' }) as any);
    mockEligibleHappyPath(); // 2 MALE
    await expect(service.register('t1', 'captain', 'partner')).rejects.toThrow('GENDER_MISMATCH');
  });

  it('Messieurs ouvert aux femmes : accepte un binôme 1 homme + 1 femme', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(tournament({ gender: 'MEN', openToWomen: true }) as any);
    mockEligibleWithSexes('MALE', 'FEMALE');
    prismaMock.tournamentRegistration.count.mockResolvedValue(0 as any);
    prismaMock.tournamentRegistration.create.mockResolvedValue({ id: 'r1', status: 'CONFIRMED' } as any);

    await expect(service.register('t1', 'captain', 'partner')).resolves.toMatchObject({ registration: { status: 'CONFIRMED' } });
  });

  it('Messieurs ouvert aux femmes : accepte un binôme de 2 femmes', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(tournament({ gender: 'MEN', openToWomen: true }) as any);
    mockEligibleWithSexes('FEMALE', 'FEMALE');
    prismaMock.tournamentRegistration.count.mockResolvedValue(0 as any);
    prismaMock.tournamentRegistration.create.mockResolvedValue({ id: 'r1', status: 'CONFIRMED' } as any);

    await expect(service.register('t1', 'captain', 'partner')).resolves.toMatchObject({ registration: { status: 'CONFIRMED' } });
  });

  it('Messieurs NON ouvert aux femmes : refuse un binôme mixte (GENDER_MISMATCH)', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(tournament({ gender: 'MEN', openToWomen: false }) as any);
    mockEligibleWithSexes('MALE', 'FEMALE');
    await expect(service.register('t1', 'captain', 'partner')).rejects.toThrow('GENDER_MISMATCH');
  });

  it('lève ALREADY_REGISTERED si un joueur est déjà engagé', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(tournament() as any);
    mockEligibleHappyPath();
    prismaMock.tournamentRegistration.findFirst.mockResolvedValue({ id: 'r-existing' } as any);
    await expect(service.register('t1', 'captain', 'partner')).rejects.toThrow('ALREADY_REGISTERED');
  });

  it('épreuve payante + place dispo → CONFIRMED + DUE + paymentDeadline, mode payment, pas de notif', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(tournament({ maxTeams: 8, requirePrepayment: true, entryFee: 12 }) as any);
    mockEligibleHappyPath();
    prismaMock.tournamentRegistration.count.mockResolvedValue(3 as any);
    prismaMock.tournamentRegistration.create.mockResolvedValue({ id: 'r1', status: 'CONFIRMED', paymentStatus: 'DUE' } as any);

    const res = await service.register('t1', 'captain', 'partner');

    expect(prismaMock.tournamentRegistration.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CONFIRMED', paymentStatus: 'DUE', paymentDeadline: expect.any(Date) }) }),
    );
    expect(res.payment).toEqual({ mode: 'payment' });
    expect(notifyTournamentRegistration).not.toHaveBeenCalled();
  });

  it("épreuve payante + complet → WAITLISTED + DUE (deadline null), mode setup, notif liste d'attente", async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(tournament({ maxTeams: 8, requirePrepayment: true, entryFee: 12 }) as any);
    mockEligibleHappyPath();
    prismaMock.tournamentRegistration.count.mockResolvedValue(8 as any);
    prismaMock.tournamentRegistration.create.mockResolvedValue({ id: 'r1', status: 'WAITLISTED', paymentStatus: 'DUE' } as any);

    const res = await service.register('t1', 'captain', 'partner');

    expect(prismaMock.tournamentRegistration.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'WAITLISTED', paymentStatus: 'DUE', paymentDeadline: null }) }),
    );
    expect(res.payment).toEqual({ mode: 'setup' });
    expect(notifyTournamentRegistration).toHaveBeenCalledWith('r1');
  });

  it('épreuve gratuite → payment null, notif immédiate (comportement actuel)', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(tournament({ maxTeams: 8 }) as any);
    mockEligibleHappyPath();
    prismaMock.tournamentRegistration.count.mockResolvedValue(0 as any);
    prismaMock.tournamentRegistration.create.mockResolvedValue({ id: 'r1', status: 'CONFIRMED', paymentStatus: 'NONE' } as any);

    const res = await service.register('t1', 'captain', 'partner');
    expect(res.payment).toBeNull();
    expect(notifyTournamentRegistration).toHaveBeenCalledWith('r1');
  });
});

describe('TournamentService.changePartner / cancelRegistration', () => {
  let service: TournamentService;
  beforeEach(() => { service = new TournamentService(); });

  it('change de coéquipier sans toucher au statut (update partnerUserId seul)', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(tournament() as any);
    prismaMock.tournamentRegistration.findFirst
      .mockResolvedValueOnce({ id: 'reg-1' } as any) // recherche de l'inscription du capitaine
      .mockResolvedValueOnce(null as any);            // pas de doublon
    // éligibilité du nouveau partenaire (2 hommes)
    prismaMock.user.findUnique.mockImplementation((args: any) => {
      if (args.where.id === 'captain') return Promise.resolve({ id: 'captain', sex: 'MALE', phone: '0600' }) as any;
      if (args.where.id === 'newp') return Promise.resolve({ id: 'newp', sex: 'MALE', phone: '0602' }) as any;
      return Promise.resolve(null) as any;
    });
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE', membershipNo: 'L' } as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([] as any);
    prismaMock.tournamentRegistration.update.mockResolvedValue({ id: 'reg-1', partnerUserId: 'newp' } as any);

    await service.changePartner('t1', 'captain', 'newp');

    expect(prismaMock.tournamentRegistration.update).toHaveBeenCalledWith({
      where: { id: 'reg-1' },
      data: { partnerUserId: 'newp' },
    });
  });

  it('changePartner respecte « ouvert aux femmes » : nouveau coéquipier femme accepté', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(tournament({ gender: 'MEN', openToWomen: true }) as any);
    prismaMock.tournamentRegistration.findFirst
      .mockResolvedValueOnce({ id: 'reg-1' } as any) // inscription du capitaine
      .mockResolvedValueOnce(null as any);            // pas de doublon
    prismaMock.user.findUnique.mockImplementation((args: any) => {
      if (args.where.id === 'captain') return Promise.resolve({ id: 'captain', sex: 'MALE', phone: '0600' }) as any;
      if (args.where.id === 'newp') return Promise.resolve({ id: 'newp', sex: 'FEMALE', phone: '0602' }) as any;
      return Promise.resolve(null) as any;
    });
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE', membershipNo: 'L' } as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([] as any);
    prismaMock.tournamentRegistration.update.mockResolvedValue({ id: 'reg-1', partnerUserId: 'newp' } as any);

    await expect(service.changePartner('t1', 'captain', 'newp')).resolves.toMatchObject({ partnerUserId: 'newp' });
  });

  it('lève REGISTRATION_LOCKED si on modifie après la deadline', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(tournament({ registrationDeadline: new Date(Date.now() - 1000) }) as any);
    await expect(service.changePartner('t1', 'captain', 'newp')).rejects.toThrow('REGISTRATION_LOCKED');
  });

  it('annule et promeut le 1er WAITLISTED quand une place CONFIRMED se libère', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue({ registrationDeadline: FUTURE } as any);
    prismaMock.tournamentRegistration.findFirst
      .mockResolvedValueOnce({ id: 'reg-confirmed', status: 'CONFIRMED' } as any) // l'inscription du capitaine
      .mockResolvedValueOnce({ id: 'reg-waiting' } as any);                        // le 1er en attente
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([] as any);
    prismaMock.tournamentRegistration.update.mockResolvedValue({ id: 'reg-confirmed', status: 'CANCELLED' } as any);

    await service.cancelRegistration('t1', 'captain');

    expect(prismaMock.tournamentRegistration.update).toHaveBeenCalledWith({
      where: { id: 'reg-confirmed' },
      data: { status: 'CANCELLED', cancelledAt: expect.any(Date) },
    });
    expect(prismaMock.tournamentRegistration.update).toHaveBeenCalledWith({
      where: { id: 'reg-waiting' },
      data: { status: 'CONFIRMED' },
    });
  });

  it('ne promeut personne si l inscription annulée était WAITLISTED', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue({ registrationDeadline: FUTURE } as any);
    prismaMock.tournamentRegistration.findFirst.mockResolvedValueOnce({ id: 'reg-w', status: 'WAITLISTED' } as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([] as any);
    prismaMock.tournamentRegistration.update.mockResolvedValue({ id: 'reg-w', status: 'CANCELLED' } as any);

    await service.cancelRegistration('t1', 'captain');

    // une seule update (la mise en CANCELLED), pas de promotion
    expect(prismaMock.tournamentRegistration.update).toHaveBeenCalledTimes(1);
  });

  it('lève REGISTRATION_NOT_FOUND si le capitaine n a pas d inscription active', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue({ registrationDeadline: FUTURE } as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([] as any);
    prismaMock.tournamentRegistration.findFirst.mockResolvedValueOnce(null as any);
    await expect(service.cancelRegistration('t1', 'captain')).rejects.toThrow('REGISTRATION_NOT_FOUND');
  });
});

describe('TournamentService — admin & lectures', () => {
  let service: TournamentService;
  beforeEach(() => { service = new TournamentService(); });

  it('createTournament refuse un genre invalide', async () => {
    await expect(service.createTournament('club-demo', {
      clubSportId: 'cs1', name: 'Open', category: 'P100', gender: 'XXX' as any,
      startTime: FUTURE, registrationDeadline: FUTURE,
    })).rejects.toThrow('VALIDATION_ERROR');
  });

  it('createTournament refuse un clubSport d un autre club', async () => {
    prismaMock.clubSport.findFirst.mockResolvedValue(null as any);
    await expect(service.createTournament('club-demo', {
      clubSportId: 'cs-autre', name: 'Open', category: 'P100', gender: 'MEN',
      startTime: FUTURE, registrationDeadline: FUTURE,
    })).rejects.toThrow('CLUB_SPORT_NOT_FOUND');
  });

  it('createTournament crée avec entryFee en Decimal et maxTeams entier', async () => {
    prismaMock.clubSport.findFirst.mockResolvedValue({ id: 'cs1' } as any);
    prismaMock.tournament.create.mockResolvedValue({ id: 't1' } as any);
    await service.createTournament('club-demo', {
      clubSportId: 'cs1', name: '  Open P100  ', category: 'P100', gender: 'MIXED',
      startTime: FUTURE, registrationDeadline: FUTURE, maxTeams: 16, entryFee: 20,
    });
    const arg = (prismaMock.tournament.create as jest.Mock).mock.calls[0][0];
    expect(arg.data.name).toBe('Open P100');
    expect(arg.data.maxTeams).toBe(16);
    expect(arg.data.gender).toBe('MIXED');
  });

  it('createTournament enregistre openToWomen', async () => {
    prismaMock.clubSport.findFirst.mockResolvedValue({ id: 'cs1' } as any);
    prismaMock.tournament.create.mockResolvedValue({ id: 't1' } as any);
    await service.createTournament('club-demo', {
      clubSportId: 'cs1', name: 'Open', category: 'P100', gender: 'MEN',
      startTime: FUTURE, registrationDeadline: FUTURE, openToWomen: false,
    } as any);
    const arg = (prismaMock.tournament.create as jest.Mock).mock.calls[0][0];
    expect(arg.data.openToWomen).toBe(false);
  });

  it('deleteTournament refuse si des inscriptions actives existent', async () => {
    prismaMock.tournament.findFirst.mockResolvedValue({ id: 't1' } as any);
    prismaMock.tournamentRegistration.count.mockResolvedValue(2 as any);
    await expect(service.deleteTournament('t1', 'club-demo')).rejects.toThrow('HAS_REGISTRATIONS');
  });

  it('listPublicByClubSlug attache les compteurs de places', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
    prismaMock.tournament.findMany.mockResolvedValue([{ id: 't1' }, { id: 't2' }] as any);
    (prismaMock.tournamentRegistration.groupBy as jest.Mock).mockResolvedValue([
      { tournamentId: 't1', status: 'CONFIRMED', _count: { _all: 5 } },
      { tournamentId: 't1', status: 'WAITLISTED', _count: { _all: 2 } },
    ]);

    const result = await service.listPublicByClubSlug('club-demo');

    expect(result[0]).toMatchObject({ id: 't1', confirmedCount: 5, waitlistCount: 2 });
    expect(result[1]).toMatchObject({ id: 't2', confirmedCount: 0, waitlistCount: 0 });
  });

  it("listUserRegistrations n'expose que le téléphone du membre connecté", async () => {
    prismaMock.tournamentRegistration.findMany.mockResolvedValue([
      { id: 'r1', captainUserId: 'cap', partnerUserId: 'par',
        tournament: { clubId: 'club-demo', club: { slug: 'demo' } },
        captain: { id: 'cap', firstName: 'A', lastName: 'A', email: 'a@x', phone: '0600' },
        partner: { id: 'par', firstName: 'B', lastName: 'B', email: 'b@x', phone: '0601' } },
    ] as any);
    prismaMock.clubMembership.findMany.mockResolvedValue([
      { userId: 'cap', clubId: 'club-demo', membershipNo: 'LIC-CAP' },
      { userId: 'par', clubId: 'club-demo', membershipNo: 'LIC-PAR' },
    ] as any);

    const [reg] = await service.listUserRegistrations('cap');

    expect(reg.captain.phone).toBe('0600');   // 'cap' est le membre connecté
    expect(reg.partner.phone).toBeNull();      // tél du coéquipier masqué
    expect(reg.captainLicense).toBe('LIC-CAP');
    expect(reg.partnerLicense).toBe('LIC-PAR');
  });

  it('listParticipants masque un tournoi DRAFT', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue({ status: 'DRAFT' } as any);
    await expect(service.listParticipants('t1')).rejects.toThrow('TOURNAMENT_NOT_FOUND');
  });

  it('listParticipants renvoie les binômes actifs (noms + avatar)', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue({ status: 'PUBLISHED', clubSport: { sport: { key: 'padel' } } } as any);
    prismaMock.tournamentRegistration.findMany.mockResolvedValue([
      { id: 'r1', status: 'CONFIRMED', captainUserId: 'cap1', partnerUserId: 'par1', captain: { firstName: 'A', lastName: 'A', avatarUrl: '/uploads/avatars/a.jpg' }, partner: { firstName: 'B', lastName: 'B', avatarUrl: null } },
    ] as any);
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-padel' } as any);
    prismaMock.playerRating.findMany.mockResolvedValue([] as any);
    const res = await service.listParticipants('t1');
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ status: 'CONFIRMED', captain: { firstName: 'A', avatarUrl: '/uploads/avatars/a.jpg' }, partner: { avatarUrl: null } });
    const select = (prismaMock.tournamentRegistration.findMany.mock.calls[0][0] as any).select;
    expect(select.captain.select.avatarUrl).toBe(true);
    expect(select.partner.select.avatarUrl).toBe(true);
  });

  it('listParticipants enrichit les entrées avec captainLevel et partnerLevel', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue({ status: 'PUBLISHED', clubSport: { sport: { key: 'padel' } } } as any);
    prismaMock.tournamentRegistration.findMany.mockResolvedValue([
      { id: 'r1', status: 'CONFIRMED', captainUserId: 'cap1', partnerUserId: 'par1',
        captain: { firstName: 'A', lastName: 'A', avatarUrl: null },
        partner: { firstName: 'B', lastName: 'B', avatarUrl: null } },
    ] as any);
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-padel' } as any);
    prismaMock.playerRating.findMany.mockResolvedValue([
      { userId: 'cap1', displayLevel: 4, rd: 80, isProvisional: false },
    ] as any);

    const res = await service.listParticipants('t1');

    expect(res[0].captainLevel).toEqual({ level: 4, tier: expect.any(String), isProvisional: false, reliability: 93 });
    expect(res[0].partnerLevel).toBeNull();
  });

  it('listParticipants utilise le sport du tournoi (tennis) pour les niveaux', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue({
      status: 'PUBLISHED',
      clubSport: { sport: { key: 'tennis' } },
    } as any);
    prismaMock.tournamentRegistration.findMany.mockResolvedValue([
      { id: 'r1', status: 'CONFIRMED', captainUserId: 'cap1', partnerUserId: 'par1',
        captain: { firstName: 'A', lastName: 'A', avatarUrl: null },
        partner: { firstName: 'B', lastName: 'B', avatarUrl: null } },
    ] as any);
    // sport.findUnique retourne un sport tennis
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-tennis' } as any);
    prismaMock.playerRating.findMany.mockResolvedValue([
      { userId: 'cap1', displayLevel: 5, rd: 80, isProvisional: false },
    ] as any);

    const res = await service.listParticipants('t1');

    // Le niveau doit être celui du sport tennis (displayLevel 5)
    expect(res[0].captainLevel).toEqual({ level: 5, tier: expect.any(String), isProvisional: false, reliability: 93 });
    // On vérifie que sport.findUnique a été appelé avec la clé 'tennis' (pas 'padel')
    expect(prismaMock.sport.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: 'tennis' } })
    );
  });
});

describe('TournamentService — notifications email', () => {
  let service: TournamentService;
  beforeEach(() => { jest.clearAllMocks(); service = new TournamentService(); });

  it('register déclenche la notification d inscription avec l id créé', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(tournament() as any);
    mockEligibleHappyPath();
    prismaMock.tournamentRegistration.count.mockResolvedValue(0 as any);
    prismaMock.tournamentRegistration.create.mockResolvedValue({ id: 'r-new', status: 'CONFIRMED' } as any);

    await service.register('t1', 'captain', 'partner');

    expect(notifyTournamentRegistration).toHaveBeenCalledWith('r-new');
  });

  it('cancelRegistration notifie la désinscription ET la promotion du 1er en attente', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue({ registrationDeadline: FUTURE } as any);
    prismaMock.tournamentRegistration.findFirst
      .mockResolvedValueOnce({ id: 'reg-confirmed', status: 'CONFIRMED' } as any)
      .mockResolvedValueOnce({ id: 'reg-waiting' } as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([] as any);
    prismaMock.tournamentRegistration.update.mockResolvedValue({ id: 'reg-confirmed', status: 'CANCELLED' } as any);

    await service.cancelRegistration('t1', 'captain');

    expect(notifyTournamentCancellation).toHaveBeenCalledWith('reg-confirmed');
    expect(notifyTournamentPromotion).toHaveBeenCalledWith('reg-waiting');
  });

  it('cancelRegistration d une WAITLISTED ne notifie pas de promotion', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue({ registrationDeadline: FUTURE } as any);
    prismaMock.tournamentRegistration.findFirst.mockResolvedValueOnce({ id: 'reg-w', status: 'WAITLISTED' } as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([] as any);
    prismaMock.tournamentRegistration.update.mockResolvedValue({ id: 'reg-w', status: 'CANCELLED' } as any);

    await service.cancelRegistration('t1', 'captain');

    expect(notifyTournamentCancellation).toHaveBeenCalledWith('reg-w');
    expect(notifyTournamentPromotion).not.toHaveBeenCalled();
  });

  it('une erreur d envoi d email ne fait pas échouer l inscription', async () => {
    (notifyTournamentRegistration as jest.Mock).mockRejectedValueOnce(new Error('SMTP down'));
    prismaMock.tournament.findUnique.mockResolvedValue(tournament() as any);
    mockEligibleHappyPath();
    prismaMock.tournamentRegistration.count.mockResolvedValue(0 as any);
    prismaMock.tournamentRegistration.create.mockResolvedValue({ id: 'r-new', status: 'CONFIRMED' } as any);

    // notifyTournamentRegistration est best-effort en prod ; ici le mock rejette, mais
    // comme l'inscription est déjà committée, on ne veut pas que l'appelant casse.
    await expect(service.register('t1', 'captain', 'partner')).resolves.toMatchObject({ registration: { id: 'r-new' } });
  });
});

describe('TournamentService.updateTournament — garde-fou paiement', () => {
  it('refuse requirePrepayment=true si Stripe pas ACTIVE', async () => {
    prismaMock.tournament.findFirst.mockResolvedValue({ id: 't1', status: 'PUBLISHED', entryFee: 12, requirePrepayment: false } as any);
    prismaMock.club.findUnique.mockResolvedValue({ stripeAccountStatus: 'NONE' } as any);
    await expect(new TournamentService().updateTournament('t1', 'club-demo', { requirePrepayment: true }))
      .rejects.toThrow('ONLINE_PAYMENT_NOT_ENABLED');
  });

  it('refuse requirePrepayment=true si entryFee < 0,50 €', async () => {
    prismaMock.tournament.findFirst.mockResolvedValue({ id: 't1', status: 'PUBLISHED', entryFee: 0, requirePrepayment: false } as any);
    prismaMock.club.findUnique.mockResolvedValue({ stripeAccountStatus: 'ACTIVE' } as any);
    await expect(new TournamentService().updateTournament('t1', 'club-demo', { requirePrepayment: true }))
      .rejects.toThrow('ONLINE_PAYMENT_NOT_ENABLED');
  });

  it('accepte requirePrepayment=true si Stripe ACTIVE + montant OK', async () => {
    prismaMock.tournament.findFirst.mockResolvedValue({ id: 't1', status: 'PUBLISHED', entryFee: 12, requirePrepayment: false } as any);
    prismaMock.club.findUnique.mockResolvedValue({ stripeAccountStatus: 'ACTIVE' } as any);
    prismaMock.tournament.update.mockResolvedValue({ id: 't1' } as any);
    await expect(new TournamentService().updateTournament('t1', 'club-demo', { requirePrepayment: true })).resolves.toBeTruthy();
  });
});

describe('TournamentService.confirmRegistrationPayment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(PackageService, 'nextReceiptNo').mockResolvedValue(1 as any);
  });

  it('DUE → PAID, crée un Payment ONLINE et notifie', async () => {
    prismaMock.tournamentRegistration.findUnique
      .mockResolvedValueOnce({
        id: 'r1', paymentStatus: 'DUE', captainUserId: 'captain', tournament: { clubId: 'club-demo', entryFee: 12 },
      } as any)
      .mockResolvedValueOnce({ id: 'r1', status: 'CONFIRMED', paymentStatus: 'PAID' } as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.tournamentRegistration.updateMany.mockResolvedValue({ count: 1 } as any);
    prismaMock.payment.create.mockResolvedValue({ id: 'pay1' } as any);

    await new TournamentService().confirmRegistrationPayment('r1', { stripePaymentIntentId: 'pi_1' });

    expect(prismaMock.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tournamentRegistrationId: 'r1', method: 'ONLINE', status: 'CAPTURED', stripePaymentIntentId: 'pi_1' }) }),
    );
    expect(notifyTournamentRegistration).toHaveBeenCalledWith('r1');
  });

  it('idempotent : si déjà PAID, ne recrée pas de Payment', async () => {
    prismaMock.tournamentRegistration.findUnique.mockResolvedValue({
      id: 'r1', paymentStatus: 'PAID', captainUserId: 'captain', tournament: { clubId: 'club-demo', entryFee: 12 },
    } as any);
    await new TournamentService().confirmRegistrationPayment('r1', { stripePaymentIntentId: 'pi_1' });
    expect(prismaMock.payment.create).not.toHaveBeenCalled();
  });
});

describe('TournamentService.chargePromotedRegistration', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  const reg = (over: Record<string, unknown> = {}) => ({
    id: 'r1', status: 'CONFIRMED', paymentStatus: 'DUE', captainUserId: 'captain',
    tournamentId: 't1', tournament: { clubId: 'club-demo', entryFee: 12 }, ...over,
  });

  it('débit OK → PAID + Payment + notif promotion', async () => {
    prismaMock.tournamentRegistration.findUnique.mockResolvedValue(reg() as any);
    jest.spyOn(StripeService.prototype, 'chargeRegistrationOffSession').mockResolvedValue('pi_ok');
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.tournamentRegistration.updateMany.mockResolvedValue({ count: 1 } as any);
    jest.spyOn(PackageService, 'nextReceiptNo').mockResolvedValue(1 as any);

    await new TournamentService().chargePromotedRegistration('r1');

    expect(prismaMock.payment.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tournamentRegistrationId: 'r1', stripePaymentIntentId: 'pi_ok' }) }));
    expect(notifyTournamentPromotion).toHaveBeenCalledWith('r1');
  });

  it('carte refusée → annule la place (CANCELLED, aucun Payment pour r1) et promeut le suivant', async () => {
    prismaMock.tournamentRegistration.findUnique
      .mockResolvedValueOnce(reg() as any)            // 1er appel : reg à débiter
      .mockResolvedValueOnce(reg({ id: 'r2' }) as any); // récursion sur le suivant promu
    jest.spyOn(StripeService.prototype, 'chargeRegistrationOffSession')
      .mockRejectedValueOnce(new Error('CARD_DECLINED'))
      .mockResolvedValueOnce('pi_ok');
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([] as any);
    prismaMock.tournamentRegistration.update.mockResolvedValue({ id: 'r1', status: 'CANCELLED' } as any);
    prismaMock.tournamentRegistration.findFirst.mockResolvedValue({ id: 'r2' } as any); // suivant WAITLISTED
    prismaMock.tournamentRegistration.updateMany.mockResolvedValue({ count: 1 } as any);
    jest.spyOn(PackageService, 'nextReceiptNo').mockResolvedValue(1 as any);

    await new TournamentService().chargePromotedRegistration('r1');

    // r1 (carte refusée) est passée CANCELLED…
    expect(prismaMock.tournamentRegistration.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'r1' }, data: expect.objectContaining({ status: 'CANCELLED' }) }),
    );
    // … et aucun Payment n'est persisté pour r1 (seul r2, débité avec succès, en a un).
    expect(prismaMock.payment.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tournamentRegistrationId: 'r1' }) }),
    );
    expect(prismaMock.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tournamentRegistrationId: 'r2', stripePaymentIntentId: 'pi_ok' }) }),
    );
    expect(notifyTournamentCancellation).toHaveBeenCalledWith('r1');
    // Promotion notifiée exactement une fois (pas de pré-notif avant la récursion).
    expect((notifyTournamentPromotion as jest.Mock).mock.calls).toEqual([['r2']]);
  });
});

describe('TournamentService.adminPromoteRegistration — paiement', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('place déjà promue ailleurs (updateMany count 0) → aucun débit Stripe', async () => {
    prismaMock.tournamentRegistration.findFirst.mockResolvedValue({ id: 'r1', status: 'WAITLISTED' } as any); // findClubRegistration
    prismaMock.tournament.findUnique.mockResolvedValue({ requirePrepayment: true } as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([] as any);
    prismaMock.tournamentRegistration.updateMany.mockResolvedValue({ count: 0 } as any); // une autre promotion a gagné
    prismaMock.tournamentRegistration.findUnique.mockResolvedValue({ id: 'r1', status: 'CONFIRMED', paymentStatus: 'DUE' } as any);
    const chargeSpy = jest.spyOn(StripeService.prototype, 'chargeRegistrationOffSession');

    await new TournamentService().adminPromoteRegistration('t1', 'r1', 'club-demo');

    expect(chargeSpy).not.toHaveBeenCalled();
  });

  it('promotion payante normale → débit off-session exactement une fois', async () => {
    prismaMock.tournamentRegistration.findFirst.mockResolvedValue({ id: 'r1', status: 'WAITLISTED' } as any);
    prismaMock.tournament.findUnique.mockResolvedValue({ requirePrepayment: true } as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([] as any);
    prismaMock.tournamentRegistration.updateMany.mockResolvedValue({ count: 1 } as any);
    prismaMock.tournamentRegistration.findUnique
      .mockResolvedValueOnce({ id: 'r1', status: 'CONFIRMED', paymentStatus: 'DUE', captainUserId: 'captain', tournamentId: 't1', tournament: { clubId: 'club-demo', entryFee: 12 } } as any)
      .mockResolvedValueOnce({ id: 'r1', status: 'CONFIRMED', paymentStatus: 'PAID' } as any);
    const chargeSpy = jest.spyOn(StripeService.prototype, 'chargeRegistrationOffSession').mockResolvedValue('pi_ok');
    jest.spyOn(PackageService, 'nextReceiptNo').mockResolvedValue(1 as any);

    await new TournamentService().adminPromoteRegistration('t1', 'r1', 'club-demo');

    expect(chargeSpy).toHaveBeenCalledTimes(1);
    expect(prismaMock.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tournamentRegistrationId: 'r1', stripePaymentIntentId: 'pi_ok' }) }),
    );
  });
});

describe('TournamentService.cancelRegistration — promotion payante', () => {
  beforeEach(() => { jest.clearAllMocks(); });
  afterEach(() => { jest.restoreAllMocks(); }); // ne pas laisser fuiter le spy sur chargePromotedRegistration

  function setupPaidCancel() {
    prismaMock.tournament.findUnique.mockResolvedValue({ registrationDeadline: FUTURE, clubId: 'club-demo', requirePrepayment: true } as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([] as any);
    prismaMock.tournamentRegistration.findFirst
      .mockResolvedValueOnce({ id: 'reg-confirmed', status: 'CONFIRMED' } as any) // inscription du capitaine
      .mockResolvedValueOnce({ id: 'reg-waiting' } as any);                        // 1er en attente promu
    prismaMock.tournamentRegistration.update.mockResolvedValue({ id: 'reg-confirmed', status: 'CANCELLED' } as any);
  }

  it('notifie la désinscription mais PAS la promotion (déléguée au débit, pas de doublon)', async () => {
    setupPaidCancel();
    const chargeSpy = jest.spyOn(TournamentService.prototype, 'chargePromotedRegistration').mockResolvedValue(undefined);

    await new TournamentService().cancelRegistration('t1', 'captain');

    expect(notifyTournamentCancellation).toHaveBeenCalledWith('reg-confirmed');
    expect(notifyTournamentPromotion).not.toHaveBeenCalled(); // la notif promo part du débit réussi
    expect(chargeSpy).toHaveBeenCalledWith('reg-waiting');
  });

  it('un débit qui échoue (post-commit) ne fait pas échouer la désinscription', async () => {
    setupPaidCancel();
    jest.spyOn(TournamentService.prototype, 'chargePromotedRegistration').mockRejectedValue(new Error('BOOM'));

    await expect(new TournamentService().cancelRegistration('t1', 'captain')).resolves.toMatchObject({ id: 'reg-confirmed' });
    expect(notifyTournamentCancellation).toHaveBeenCalledWith('reg-confirmed');
  });
});

describe('TournamentService.cancelRegistration — remboursement', () => {
  beforeEach(() => { jest.clearAllMocks(); });
  afterEach(() => { jest.restoreAllMocks(); });

  it('inscription PAID annulée avant clôture → RefundService.refund appelé + REFUNDED', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue({ registrationDeadline: FUTURE, clubId: 'club-demo', requirePrepayment: true } as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([] as any);
    prismaMock.tournamentRegistration.findFirst.mockResolvedValue({ id: 'r1', status: 'CONFIRMED', paymentStatus: 'PAID' } as any);
    prismaMock.tournamentRegistration.update.mockResolvedValue({ id: 'r1', status: 'CANCELLED' } as any);
    prismaMock.payment.findFirst.mockResolvedValue({ id: 'pay1', amount: 12 } as any);
    const refundSpy = jest.spyOn(RefundService.prototype, 'refund').mockResolvedValue({ id: 'rf1' } as any);

    await new TournamentService().cancelRegistration('t1', 'captain');

    expect(refundSpy).toHaveBeenCalledWith(expect.objectContaining({ paymentId: 'pay1', clubId: 'club-demo', amount: 12 }));
    expect(prismaMock.tournamentRegistration.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'r1' }, data: { paymentStatus: 'REFUNDED' } }));
  });

  it('inscription NONE (gratuite) → pas de remboursement', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue({ registrationDeadline: FUTURE, clubId: 'club-demo', requirePrepayment: false } as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([] as any);
    prismaMock.tournamentRegistration.findFirst.mockResolvedValue({ id: 'r1', status: 'CONFIRMED', paymentStatus: 'NONE' } as any);
    prismaMock.tournamentRegistration.update.mockResolvedValue({ id: 'r1', status: 'CANCELLED' } as any);
    const refundSpy = jest.spyOn(RefundService.prototype, 'refund');
    await new TournamentService().cancelRegistration('t1', 'captain');
    expect(refundSpy).not.toHaveBeenCalled();
  });
});
