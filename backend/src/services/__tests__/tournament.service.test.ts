import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { TournamentService } from '../tournament.service';
import {
  notifyTournamentRegistration,
  notifyTournamentCancellation,
  notifyTournamentPromotion,
  notifyTournamentReplacement,
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

  it('listPublicByClubSlug expose le sport (aplati depuis clubSport)', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
    prismaMock.tournament.findMany.mockResolvedValue([
      { id: 't1', clubSport: { sport: { key: 'padel', name: 'Padel' } } },
    ] as any);
    (prismaMock.tournamentRegistration.groupBy as jest.Mock).mockResolvedValue([]);

    const [t] = await service.listPublicByClubSlug('club-demo');

    expect(t.sport).toEqual({ key: 'padel', name: 'Padel' });
    expect((t as Record<string, unknown>).clubSport).toBeUndefined(); // aplati, pas de fuite de forme
  });

  it("listUserRegistrations n'expose que le téléphone du membre connecté", async () => {
    prismaMock.tournamentRegistration.findMany.mockResolvedValue([
      { id: 'r1', captainUserId: 'cap', partnerUserId: 'par',
        tournament: { clubId: 'club-demo', club: { slug: 'demo' }, clubSport: { sport: { key: 'padel', name: 'Padel' } } },
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
    expect(reg.tournament.sport).toEqual({ key: 'padel', name: 'Padel' });
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
    // userId additif (entrée « Envoyer un message » côté front)
    expect(res[0].captainUserId).toBe('cap1');
    expect(res[0].partnerUserId).toBe('par1');
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

describe('TournamentService.listNationalTournaments', () => {
  let svc: TournamentService;
  beforeEach(() => { jest.clearAllMocks(); svc = new TournamentService(); });

  it('filtre PUBLISHED + à venir + club ACTIVE & opt-in ; renvoie club + compteurs', async () => {
    prismaMock.tournament.findMany.mockResolvedValue([
      { id: 't1', name: 'GP Paris', category: 'P500', gender: 'MEN', startTime: FUTURE, maxTeams: 16,
        club: { slug: 'paris', name: 'Padel Paris', city: 'Paris', department: 'Paris', departmentCode: '75', timezone: 'Europe/Paris', accentColor: '#5e93da', logoUrl: null, latitude: 48.85, longitude: 2.35 },
        clubSport: { sport: { key: 'padel', name: 'Padel' } } },
    ] as any);
    (prismaMock.tournamentRegistration.groupBy as jest.Mock).mockResolvedValue([
      { tournamentId: 't1', status: 'CONFIRMED', _count: { _all: 3 } },
    ] as any);

    const res = await svc.listNationalTournaments();

    const where = (prismaMock.tournament.findMany.mock.calls[0][0] as any).where;
    expect(where.status).toBe('PUBLISHED');
    expect(where.club).toEqual({ status: 'ACTIVE', listTournamentsNationally: true });
    expect(where.startTime.gte).toBeInstanceOf(Date);
    expect(where.startTime.lte).toBeInstanceOf(Date);
    expect(res[0]).toMatchObject({ id: 't1', confirmedCount: 3, waitlistCount: 0, club: { departmentCode: '75', timezone: 'Europe/Paris' }, sport: { key: 'padel', name: 'Padel' } });
  });

  it('liste vide si aucun tournoi', async () => {
    prismaMock.tournament.findMany.mockResolvedValue([] as any);
    const res = await svc.listNationalTournaments();
    expect(res).toEqual([]);
  });
});

describe('espace J/A — gate', () => {
  let svc: TournamentService;
  beforeEach(() => { jest.clearAllMocks(); svc = new TournamentService(); });

  it('resolveReferee : vrai pour un membre ACTIVE avec la facette', async () => {
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE', isReferee: true } as any);
    await expect(svc.resolveReferee('club-1', 'u1')).resolves.toBe(true);
    expect(prismaMock.clubMembership.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId_clubId: { userId: 'u1', clubId: 'club-1' } } }),
    );
  });

  it('resolveReferee : faux si la facette est décochée', async () => {
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE', isReferee: false } as any);
    await expect(svc.resolveReferee('club-1', 'u1')).resolves.toBe(false);
  });

  it('resolveReferee : faux si le membre est BLOCKED, même J/A', async () => {
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'BLOCKED', isReferee: true } as any);
    await expect(svc.resolveReferee('club-1', 'u1')).resolves.toBe(false);
  });

  it('resolveReferee : faux si aucune adhésion', async () => {
    prismaMock.clubMembership.findUnique.mockResolvedValue(null as any);
    await expect(svc.resolveReferee('club-1', 'u1')).resolves.toBe(false);
  });

  it('assertRefereeOwnsTournament : TOURNAMENT_NOT_YOURS pour un autre J/A', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue({ clubId: 'club-1', refereeUserId: 'autre' } as any);
    await expect(svc.refereeListRegistrations('club-1', 'u1', 't1')).rejects.toThrow('TOURNAMENT_NOT_YOURS');
    expect(prismaMock.tournamentRegistration.findMany).not.toHaveBeenCalled();
  });

  it('assertRefereeOwnsTournament : TOURNAMENT_NOT_FOUND si le tournoi est d’un autre club', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue({ clubId: 'club-2', refereeUserId: 'u1' } as any);
    await expect(svc.refereeListRegistrations('club-1', 'u1', 't1')).rejects.toThrow('TOURNAMENT_NOT_FOUND');
  });

  it('assertRefereeOwnsTournament : TOURNAMENT_NOT_FOUND si le tournoi n’existe pas', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(null as any);
    await expect(svc.refereeListRegistrations('club-1', 'u1', 't1')).rejects.toThrow('TOURNAMENT_NOT_FOUND');
  });
});

const YESTERDAY = new Date(Date.now() - 86_400_000);
const TOMORROW = new Date(Date.now() + 86_400_000);

/**
 * Mini-évaluateur du fragment `where` de scope : applique la clause Prisma produite par
 * listRefereeTournaments à une fixture, pour verrouiller la RÈGLE (« fini » = endTime ?? startTime)
 * et pas seulement la forme. Une clause d'une autre forme ne matche rien → le test tombe (fail-safe).
 */
function scopeMatches(where: any, t: { startTime: Date; endTime: Date | null }): boolean {
  const cmp = (cond: any, value: Date | null): boolean => {
    if (cond === null) return value === null;
    if (cond?.gte instanceof Date) return value !== null && value >= cond.gte;
    if (cond?.lt instanceof Date) return value !== null && value < cond.lt;
    return false;
  };
  const branchMatches = (branch: any) =>
    Object.entries(branch).every(([field, cond]) => cmp(cond, field === 'endTime' ? t.endTime : t.startTime));
  return Array.isArray(where?.OR) && where.OR.some(branchMatches);
}

/** Renvoie la clause `where` passée à tournament.findMany pour un scope donné. */
async function scopeWhere(svc: TournamentService, scope: 'upcoming' | 'past') {
  jest.clearAllMocks();
  prismaMock.tournament.findMany.mockResolvedValue([] as any);
  await svc.listRefereeTournaments('club-1', 'u1', scope);
  return (prismaMock.tournament.findMany.mock.calls[0][0] as any).where;
}

describe('espace J/A — lecture', () => {
  let svc: TournamentService;
  beforeEach(() => { jest.clearAllMocks(); svc = new TournamentService(); });

  it('listRefereeTournaments : filtre sur refereeUserId et le scope à venir', async () => {
    prismaMock.tournament.findMany.mockResolvedValue([] as any);
    await svc.listRefereeTournaments('club-1', 'u1', 'upcoming');
    const arg = prismaMock.tournament.findMany.mock.calls[0][0] as any;
    expect(arg.where.clubId).toBe('club-1');
    expect(arg.where.refereeUserId).toBe('u1');
    expect(arg.orderBy).toEqual({ startTime: 'asc' });
    expect(arg.take).toBeUndefined();
  });

  it('listRefereeTournaments : scope passé = desc, cap 30', async () => {
    prismaMock.tournament.findMany.mockResolvedValue([] as any);
    await svc.listRefereeTournaments('club-1', 'u1', 'past');
    const arg = prismaMock.tournament.findMany.mock.calls[0][0] as any;
    expect(arg.where.refereeUserId).toBe('u1');
    expect(arg.orderBy).toEqual({ startTime: 'desc' });
    expect(arg.take).toBe(30);
  });

  // Règle : « fini » = endTime ?? startTime. Garde anti-régression — quiconque « simplifie »
  // ce filtre en startTime seul remet le tournoi du jour J sous « Passés » et fait tomber ceci.
  it('listRefereeTournaments : un tournoi en cours (commencé hier, fini demain) est « à venir », jamais « passé »', async () => {
    const enCours = { startTime: YESTERDAY, endTime: TOMORROW };
    expect(scopeMatches(await scopeWhere(svc, 'upcoming'), enCours)).toBe(true);
    expect(scopeMatches(await scopeWhere(svc, 'past'), enCours)).toBe(false);
  });

  it('listRefereeTournaments : sans endTime, le scope bascule sur startTime (hier → passé)', async () => {
    const hierSansFin = { startTime: YESTERDAY, endTime: null };
    expect(scopeMatches(await scopeWhere(svc, 'past'), hierSansFin)).toBe(true);
    expect(scopeMatches(await scopeWhere(svc, 'upcoming'), hierSansFin)).toBe(false);
  });

  it('listRefereeTournaments : ni trou ni doublon — tout tournoi tombe dans exactement un scope', async () => {
    const upcoming = await scopeWhere(svc, 'upcoming');
    const past = await scopeWhere(svc, 'past');
    const fixtures = [
      { startTime: TOMORROW, endTime: null },       // à venir, sans fin
      { startTime: TOMORROW, endTime: TOMORROW },   // à venir, avec fin
      { startTime: YESTERDAY, endTime: TOMORROW },  // en cours
      { startTime: YESTERDAY, endTime: null },      // passé, sans fin
      { startTime: YESTERDAY, endTime: YESTERDAY }, // passé, avec fin
    ];
    for (const t of fixtures) {
      expect([scopeMatches(upcoming, t), scopeMatches(past, t)].filter(Boolean)).toHaveLength(1);
    }
  });

  it('listRefereeTournaments : hydrate les compteurs confirmés / attente', async () => {
    prismaMock.tournament.findMany.mockResolvedValue([
      { id: 't1', name: 'GP du club', category: 'P100', gender: 'MEN', status: 'PUBLISHED', startTime: FUTURE, endTime: null, registrationDeadline: FUTURE, maxTeams: 8 },
    ] as any);
    (prismaMock.tournamentRegistration.groupBy as jest.Mock).mockResolvedValue([
      { tournamentId: 't1', status: 'CONFIRMED', _count: { _all: 5 } },
      { tournamentId: 't1', status: 'WAITLISTED', _count: { _all: 2 } },
    ] as any);

    const rows = await svc.listRefereeTournaments('club-1', 'u1', 'upcoming');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 't1', name: 'GP du club', maxTeams: 8, confirmedCount: 5, waitlistCount: 2 });
  });

  it('refereeListRegistrations : expose licence + téléphone, jamais userId', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue({ clubId: 'club-1', refereeUserId: 'u1' } as any);
    prismaMock.tournamentRegistration.findMany.mockResolvedValue([
      {
        id: 'r1', status: 'CONFIRMED', paymentStatus: 'PAID',
        captainUserId: 'c1', partnerUserId: 'p1',
        captain: { firstName: 'Léa', lastName: 'Girard', avatarUrl: null, phone: '0600000001' },
        partner: { firstName: 'Zoé', lastName: 'Marin', avatarUrl: null, phone: null },
      },
      {
        id: 'r2', status: 'WAITLISTED', paymentStatus: 'NONE',
        captainUserId: 'c2', partnerUserId: 'p2',
        captain: { firstName: 'Tom', lastName: 'Roy', avatarUrl: null, phone: null },
        partner: { firstName: 'Ana', lastName: 'Diaz', avatarUrl: null, phone: null },
      },
    ] as any);
    prismaMock.clubMembership.findMany.mockResolvedValue([{ userId: 'c1', membershipNo: '12345' }] as any);

    const rows = await svc.refereeListRegistrations('club-1', 'u1', 't1');

    expect(rows[0].captain).toEqual({
      firstName: 'Léa', lastName: 'Girard', avatarUrl: null, phone: '0600000001', membershipNo: '12345',
    });
    expect(rows[0].partner?.membershipNo).toBeNull();
    expect(JSON.stringify(rows)).not.toContain('c1'); // userId jamais exposé
    expect(rows[1].waitlistPosition).toBe(1);
    expect(rows[0].waitlistPosition).toBeNull();
  });

  it('refereeListRegistrations : exclut les annulés et cherche les licences du bon club, en une requête', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue({ clubId: 'club-1', refereeUserId: 'u1' } as any);
    prismaMock.tournamentRegistration.findMany.mockResolvedValue([
      {
        id: 'r1', status: 'CONFIRMED', paymentStatus: 'NONE',
        captainUserId: 'c1', partnerUserId: 'p1',
        captain: { firstName: 'Léa', lastName: 'Girard', avatarUrl: null, phone: null },
        partner: { firstName: 'Zoé', lastName: 'Marin', avatarUrl: null, phone: null },
      },
    ] as any);
    prismaMock.clubMembership.findMany.mockResolvedValue([] as any);

    await svc.refereeListRegistrations('club-1', 'u1', 't1');

    const regArg = prismaMock.tournamentRegistration.findMany.mock.calls[0][0] as any;
    expect(regArg.where).toEqual({ tournamentId: 't1', status: { not: 'CANCELLED' } });
    expect(prismaMock.clubMembership.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.clubMembership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clubId: 'club-1', userId: { in: ['c1', 'p1'] } } }),
    );
  });

  it('refereeListRegistrations : aucun inscrit → pas de requête de licences', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue({ clubId: 'club-1', refereeUserId: 'u1' } as any);
    prismaMock.tournamentRegistration.findMany.mockResolvedValue([] as any);

    await expect(svc.refereeListRegistrations('club-1', 'u1', 't1')).resolves.toEqual([]);
    expect(prismaMock.clubMembership.findMany).not.toHaveBeenCalled();
  });
});

describe('espace J/A — écriture (délégation au cœur admin)', () => {
  let svc: TournamentService;
  beforeEach(() => {
    jest.clearAllMocks();
    svc = new TournamentService();
    prismaMock.tournament.findUnique.mockResolvedValue({ clubId: 'club-1', refereeUserId: 'u1' } as any);
  });

  // Le J/A ne redéclare AUCUNE règle métier : il pose l'assertion de propriété puis délègue.
  // L'assertion porte sur l'ORDRE des arguments (le J/A prend clubId en tête, le cœur en queue) :
  // c'est le seul vrai piège de la délégation, et un remap fautif tomberait ici.
  it('refereePromoteRegistration délègue au cœur admin', async () => {
    const spy = jest.spyOn(svc, 'adminPromoteRegistration').mockResolvedValue({ id: 'r1' } as never);
    await svc.refereePromoteRegistration('club-1', 'u1', 't1', 'r1');
    expect(spy).toHaveBeenCalledWith('t1', 'r1', 'club-1');
  });

  it('refereeRemoveRegistration délègue au cœur admin', async () => {
    const spy = jest.spyOn(svc, 'adminRemoveRegistration').mockResolvedValue({ id: 'r1' } as never);
    await svc.refereeRemoveRegistration('club-1', 'u1', 't1', 'r1');
    expect(spy).toHaveBeenCalledWith('t1', 'r1', 'club-1');
  });

  it('refereePromoteRegistration renvoie le résultat du cœur (pas de réécriture)', async () => {
    jest.spyOn(svc, 'adminPromoteRegistration').mockResolvedValue({ id: 'r1', status: 'CONFIRMED' } as never);
    await expect(svc.refereePromoteRegistration('club-1', 'u1', 't1', 'r1'))
      .resolves.toMatchObject({ id: 'r1', status: 'CONFIRMED' });
  });

  // Kill-switch : le gate court AVANT la délégation. Si l'assertion passait après (ou pas du tout),
  // le cœur serait appelé et le J/A d'un autre tournoi écrirait sur celui-ci.
  it('kill-switch : un J/A sur le tournoi d’un autre ne peut pas promouvoir', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue({ clubId: 'club-1', refereeUserId: 'autre' } as any);
    const spy = jest.spyOn(svc, 'adminPromoteRegistration');
    await expect(svc.refereePromoteRegistration('club-1', 'u1', 't1', 'r1')).rejects.toThrow('TOURNAMENT_NOT_YOURS');
    expect(spy).not.toHaveBeenCalled();
  });

  it('kill-switch : un J/A sur le tournoi d’un autre ne peut pas retirer un binôme', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue({ clubId: 'club-1', refereeUserId: 'autre' } as any);
    const spy = jest.spyOn(svc, 'adminRemoveRegistration');
    await expect(svc.refereeRemoveRegistration('club-1', 'u1', 't1', 'r1')).rejects.toThrow('TOURNAMENT_NOT_YOURS');
    expect(spy).not.toHaveBeenCalled();
  });

  it('kill-switch : un tournoi d’un autre club est invisible (TOURNAMENT_NOT_FOUND), aucune écriture', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue({ clubId: 'club-2', refereeUserId: 'u1' } as any);
    const spy = jest.spyOn(svc, 'adminRemoveRegistration');
    await expect(svc.refereeRemoveRegistration('club-1', 'u1', 't1', 'r1')).rejects.toThrow('TOURNAMENT_NOT_FOUND');
    expect(spy).not.toHaveBeenCalled();
  });
});

// Sans cette garde, PATCH { refereeUserId: 'nimporte-qui' } ouvrirait l'espace J/A du club à
// n'importe quel User de la plateforme, non-membre compris. C'est une garde de sécurité.
describe('désignation du J/A', () => {
  let svc: TournamentService;
  const found = { id: 't1', status: 'DRAFT', entryFee: 0, requirePrepayment: false };
  beforeEach(() => { jest.clearAllMocks(); svc = new TournamentService(); });

  const createInput = (over: Record<string, unknown> = {}) => ({
    clubSportId: 'cs1', name: 'Open', category: 'P100', gender: 'MEN' as const,
    startTime: FUTURE, registrationDeadline: FUTURE, ...over,
  });

  it('updateTournament refuse un J/A qui n’a pas la facette (REFEREE_INVALID)', async () => {
    prismaMock.tournament.findFirst.mockResolvedValue(found as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE', isReferee: false } as any);
    await expect(svc.updateTournament('t1', 'club-1', { refereeUserId: 'u9' })).rejects.toThrow('REFEREE_INVALID');
    expect(prismaMock.tournament.update).not.toHaveBeenCalled(); // rien n'est écrit
  });

  it('updateTournament refuse un J/A BLOCKED, même avec la facette', async () => {
    prismaMock.tournament.findFirst.mockResolvedValue(found as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'BLOCKED', isReferee: true } as any);
    await expect(svc.updateTournament('t1', 'club-1', { refereeUserId: 'u9' })).rejects.toThrow('REFEREE_INVALID');
    expect(prismaMock.tournament.update).not.toHaveBeenCalled();
  });

  it('updateTournament refuse un non-membre du club', async () => {
    prismaMock.tournament.findFirst.mockResolvedValue(found as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue(null as any);
    await expect(svc.updateTournament('t1', 'club-1', { refereeUserId: 'u9' })).rejects.toThrow('REFEREE_INVALID');
    expect(prismaMock.tournament.update).not.toHaveBeenCalled();
  });

  it('updateTournament accepte un J/A qui a la facette', async () => {
    prismaMock.tournament.findFirst.mockResolvedValue(found as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE', isReferee: true } as any);
    prismaMock.tournament.update.mockResolvedValue({ id: 't1' } as any);
    await svc.updateTournament('t1', 'club-1', { refereeUserId: 'u9' });
    expect((prismaMock.tournament.update as jest.Mock).mock.calls[0][0].data.refereeUserId).toBe('u9');
  });

  // La facette est vérifiée dans LE club du tournoi : un J/A du club A ne doit pas pouvoir être
  // désigné sur un tournoi du club B au prétexte qu'il est J/A quelque part.
  it('updateTournament vérifie la facette dans le club du tournoi', async () => {
    prismaMock.tournament.findFirst.mockResolvedValue(found as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE', isReferee: true } as any);
    prismaMock.tournament.update.mockResolvedValue({ id: 't1' } as any);
    await svc.updateTournament('t1', 'club-1', { refereeUserId: 'u9' });
    expect(prismaMock.clubMembership.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId_clubId: { userId: 'u9', clubId: 'club-1' } } }),
    );
  });

  it('updateTournament : null retire le J/A sans vérification', async () => {
    prismaMock.tournament.findFirst.mockResolvedValue(found as any);
    prismaMock.tournament.update.mockResolvedValue({ id: 't1' } as any);
    await svc.updateTournament('t1', 'club-1', { refereeUserId: null });
    expect((prismaMock.tournament.update as jest.Mock).mock.calls[0][0].data.refereeUserId).toBeNull();
    expect(prismaMock.clubMembership.findUnique).not.toHaveBeenCalled();
  });

  it('updateTournament sans refereeUserId ne touche pas au J/A en place', async () => {
    prismaMock.tournament.findFirst.mockResolvedValue(found as any);
    prismaMock.tournament.update.mockResolvedValue({ id: 't1' } as any);
    await svc.updateTournament('t1', 'club-1', { name: 'Open P250' });
    const data = (prismaMock.tournament.update as jest.Mock).mock.calls[0][0].data;
    expect(data).not.toHaveProperty('refereeUserId');
    expect(prismaMock.clubMembership.findUnique).not.toHaveBeenCalled();
  });

  // La garde couvre les DEUX chemins d'écriture : créer un tournoi avec un J/A bidon doit
  // échouer comme l'éditer. Sinon le trou se rouvre à la création.
  it('createTournament refuse un J/A qui n’a pas la facette (REFEREE_INVALID)', async () => {
    prismaMock.clubSport.findFirst.mockResolvedValue({ id: 'cs1' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE', isReferee: false } as any);
    await expect(svc.createTournament('club-1', createInput({ refereeUserId: 'u9' }) as any)).rejects.toThrow('REFEREE_INVALID');
    expect(prismaMock.tournament.create).not.toHaveBeenCalled();
  });

  it('createTournament accepte un J/A qui a la facette', async () => {
    prismaMock.clubSport.findFirst.mockResolvedValue({ id: 'cs1' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE', isReferee: true } as any);
    prismaMock.tournament.create.mockResolvedValue({ id: 't1' } as any);
    await svc.createTournament('club-1', createInput({ refereeUserId: 'u9' }) as any);
    expect((prismaMock.tournament.create as jest.Mock).mock.calls[0][0].data.refereeUserId).toBe('u9');
  });

  it('createTournament sans J/A ne vérifie rien', async () => {
    prismaMock.clubSport.findFirst.mockResolvedValue({ id: 'cs1' } as any);
    prismaMock.tournament.create.mockResolvedValue({ id: 't1' } as any);
    await svc.createTournament('club-1', createInput() as any);
    expect(prismaMock.clubMembership.findUnique).not.toHaveBeenCalled();
  });
});

// Le J/A est une donnée interne : `refereeUserId` est un userId, et les lectures publiques
// sont anonymes (GET /api/clubs/:slug/tournaments, /api/tournaments/:id, /national).
// Spec §7 : « nom seul, jamais le userId ». La défense est une ALLOWLIST de colonnes
// (`select`) et non un retrait a posteriori : une colonne privée future ne fuite pas par défaut.
describe('projection publique — refereeUserId ne fuite pas', () => {
  let svc: TournamentService;
  beforeEach(() => { jest.clearAllMocks(); svc = new TournamentService(); });

  /** Colonnes demandées par un findMany/findUnique mocké. `path` = relation imbriquée. */
  const selectOf = (mock: jest.Mock, path?: string) => {
    const args = mock.mock.calls[0][0] as any;
    if (!path) return args.select;
    const rel = args.select?.[path] ?? args.include?.[path]; // la relation peut pendre de l'un ou l'autre
    return rel?.select;
  };

  it('listPublicByClubSlug ne demande pas refereeUserId', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
    prismaMock.tournament.findMany.mockResolvedValue([] as any);
    (prismaMock.tournamentRegistration.groupBy as jest.Mock).mockResolvedValue([] as any);

    await svc.listPublicByClubSlug('club-demo');

    const select = selectOf(prismaMock.tournament.findMany as jest.Mock);
    expect(select).toBeDefined();                 // projection explicite, pas un include fourre-tout
    expect(select.refereeUserId).toBeUndefined(); // la colonne n'est même pas lue
    expect(select.name).toBe(true);               // …mais le reste de la fiche est bien exposé
  });

  it('listNationalTournaments ne demande pas refereeUserId', async () => {
    prismaMock.tournament.findMany.mockResolvedValue([] as any);
    (prismaMock.tournamentRegistration.groupBy as jest.Mock).mockResolvedValue([] as any);

    await svc.listNationalTournaments();

    const select = selectOf(prismaMock.tournament.findMany as jest.Mock);
    expect(select).toBeDefined();
    expect(select.refereeUserId).toBeUndefined();
    expect(select.club).toBeDefined(); // la projection club du calendrier national est conservée
  });

  it('getById ne demande pas refereeUserId', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue({
      id: 't1', status: 'PUBLISHED', referee: null,
      club: { slug: 'demo', name: 'Demo', timezone: 'Europe/Paris' },
      clubSport: { sport: { key: 'padel', name: 'Padel' } },
    } as any);
    (prismaMock.tournamentRegistration.groupBy as jest.Mock).mockResolvedValue([] as any);

    await svc.getById('t1');

    const select = selectOf(prismaMock.tournament.findUnique as jest.Mock);
    expect(select).toBeDefined();
    expect(select.refereeUserId).toBeUndefined();
  });

  it('listUserRegistrations ne demande pas refereeUserId sur le tournoi imbriqué', async () => {
    prismaMock.tournamentRegistration.findMany.mockResolvedValue([] as any);

    await svc.listUserRegistrations('me');

    const select = selectOf(prismaMock.tournamentRegistration.findMany as jest.Mock, 'tournament');
    expect(select).toBeDefined();
    expect(select.refereeUserId).toBeUndefined();
    expect(select.club).toBeDefined(); // slug/nom/fuseau du club toujours là
  });

  // Le pendant : l'admin en a besoin pour pré-sélectionner son picker de J/A.
  it('listForAdmin expose refereeUserId (le picker admin en dépend)', async () => {
    prismaMock.tournament.findMany.mockResolvedValue([{ id: 't1', refereeUserId: 'u1' }] as any);
    (prismaMock.tournamentRegistration.groupBy as jest.Mock).mockResolvedValue([] as any);

    const [t] = await svc.listForAdmin('club-demo');

    expect((t as Record<string, unknown>).refereeUserId).toBe('u1');
  });
});

describe('getById — J/A public (nom seul)', () => {
  let svc: TournamentService;
  beforeEach(() => { jest.clearAllMocks(); svc = new TournamentService(); });

  const mockTournament = (referee: unknown) => {
    prismaMock.tournament.findUnique.mockResolvedValue({
      id: 't1', name: 'Open', status: 'PUBLISHED', referee,
      club: { slug: 'demo', name: 'Demo', timezone: 'Europe/Paris' },
      clubSport: { sport: { key: 'padel', name: 'Padel' } },
    } as any);
    (prismaMock.tournamentRegistration.groupBy as jest.Mock).mockResolvedValue([] as any);
  };

  it('expose le nom du J/A désigné, et aucun userId', async () => {
    // `id` volontairement présent dans le mock : si quelqu'un ajoute `id: true` au select du
    // J/A et étale l'objet tel quel, le userId partirait en clair. La projection { name } l'interdit.
    mockTournament({ id: 'u-referee', firstName: 'Julien', lastName: 'Martin' });

    const dto = await svc.getById('t1');

    expect(dto.referee).toEqual({ name: 'Julien Martin' });
    expect(JSON.stringify(dto)).not.toContain('u-referee');
  });

  it('referee: null quand aucun J/A n’est désigné', async () => {
    mockTournament(null);
    const dto = await svc.getById('t1');
    expect(dto.referee).toBeNull();
  });
});

describe('TournamentService.adminRemoveRegistration — remboursement', () => {
  beforeEach(() => { jest.clearAllMocks(); });
  afterEach(() => { jest.restoreAllMocks(); });

  it('retrait admin d une inscription PAID → RefundService.refund appelé (motif club) + REFUNDED', async () => {
    prismaMock.tournamentRegistration.findFirst
      .mockResolvedValueOnce({ id: 'r1', status: 'CONFIRMED' } as any) // findClubRegistration
      .mockResolvedValueOnce({ id: 'r1', status: 'CONFIRMED', paymentStatus: 'PAID' } as any); // dans la tx
    prismaMock.tournament.findUnique.mockResolvedValue({ requirePrepayment: true } as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([] as any);
    prismaMock.tournamentRegistration.update.mockResolvedValue({ id: 'r1', status: 'CANCELLED' } as any);
    // 3e appel findFirst (recherche de promotion dans cancelAndPromoteTx) → undefined = pas de promu.
    prismaMock.payment.findFirst.mockResolvedValue({ id: 'pay1', amount: 12 } as any);
    const refundSpy = jest.spyOn(RefundService.prototype, 'refund').mockResolvedValue({ id: 'rf1' } as any);

    await new TournamentService().adminRemoveRegistration('t1', 'r1', 'club-demo');

    expect(refundSpy).toHaveBeenCalledWith(expect.objectContaining({ paymentId: 'pay1', clubId: 'club-demo', amount: 12, reason: 'Retrait par le club' }));
  });

  it('retrait admin d une inscription non payée → pas de remboursement', async () => {
    prismaMock.tournamentRegistration.findFirst
      .mockResolvedValueOnce({ id: 'r1', status: 'CONFIRMED' } as any)
      .mockResolvedValueOnce({ id: 'r1', status: 'CONFIRMED', paymentStatus: 'NONE' } as any);
    prismaMock.tournament.findUnique.mockResolvedValue({ requirePrepayment: false } as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([] as any);
    prismaMock.tournamentRegistration.update.mockResolvedValue({ id: 'r1', status: 'CANCELLED' } as any);
    const refundSpy = jest.spyOn(RefundService.prototype, 'refund');

    await new TournamentService().adminRemoveRegistration('t1', 'r1', 'club-demo');

    expect(refundSpy).not.toHaveBeenCalled();
  });
});

describe('TournamentService.updateTournament — remboursement à l annulation', () => {
  beforeEach(() => { jest.clearAllMocks(); });
  afterEach(() => { jest.restoreAllMocks(); });

  it('annulation du tournoi par le club → rembourse chaque inscription PAID (motif club)', async () => {
    prismaMock.tournament.findFirst.mockResolvedValue({ id: 't1', status: 'PUBLISHED', entryFee: 12, requirePrepayment: true } as any);
    prismaMock.club.findUnique.mockResolvedValue({ stripeAccountStatus: 'ACTIVE' } as any); // assertPrepaymentAllowed
    prismaMock.tournament.update.mockResolvedValue({ id: 't1', status: 'CANCELLED' } as any);
    prismaMock.tournamentRegistration.findMany.mockResolvedValue([{ id: 'r1' }, { id: 'r2' }] as any);
    prismaMock.payment.findFirst
      .mockResolvedValueOnce({ id: 'pay1', amount: 12 } as any)
      .mockResolvedValueOnce({ id: 'pay2', amount: 12 } as any);
    prismaMock.tournamentRegistration.update.mockResolvedValue({} as any);
    const refundSpy = jest.spyOn(RefundService.prototype, 'refund').mockResolvedValue({ id: 'rf' } as any);

    await new TournamentService().updateTournament('t1', 'club-demo', { status: 'CANCELLED' });

    expect(refundSpy).toHaveBeenCalledTimes(2);
    expect(refundSpy).toHaveBeenCalledWith(expect.objectContaining({ paymentId: 'pay1', clubId: 'club-demo', amount: 12, reason: 'Annulation par le club' }));
    expect(refundSpy).toHaveBeenCalledWith(expect.objectContaining({ paymentId: 'pay2', amount: 12, reason: 'Annulation par le club' }));
  });

  it('mise à jour SANS transition vers CANCELLED → aucun remboursement', async () => {
    prismaMock.tournament.findFirst.mockResolvedValue({ id: 't1', status: 'PUBLISHED', entryFee: 12, requirePrepayment: false } as any);
    prismaMock.tournament.update.mockResolvedValue({ id: 't1', status: 'PUBLISHED' } as any);
    const refundSpy = jest.spyOn(RefundService.prototype, 'refund');

    await new TournamentService().updateTournament('t1', 'club-demo', { name: 'Nouveau nom' });

    expect(refundSpy).not.toHaveBeenCalled();
  });
});

describe('table de marque — lecture', () => {
  let svc: TournamentService;
  beforeEach(() => { jest.clearAllMocks(); svc = new TournamentService(); });

  it('listMarkTable expose userId (surface d\'action, pas la même règle que le roster)', async () => {
    prismaMock.tournament.findFirst.mockResolvedValue({
      id: 't1', name: 'Grand Prix', category: 'P500', gender: 'MEN', maxTeams: 12,
    } as any);
    prismaMock.tournamentRegistration.findMany.mockResolvedValue([
      {
        id: 'r1', status: 'CONFIRMED', paymentStatus: 'NONE', createdAt: new Date(),
        captainUserId: 'c1', partnerUserId: 'p1', captainPresence: 'PRESENT', partnerPresence: 'ABSENT',
        captain: { firstName: 'A', lastName: 'B', avatarUrl: null, phone: null },
        partner: { firstName: 'C', lastName: 'D', avatarUrl: null, phone: null },
      },
    ] as any);
    (prismaMock.tournamentBenchEntry.findMany as jest.Mock).mockResolvedValue([]);
    (prismaMock.tournamentLogEntry.findMany as jest.Mock).mockResolvedValue([]);
    prismaMock.clubMembership.findMany.mockResolvedValue([] as any);

    const view = await svc.listMarkTable('club-1', 't1');
    expect(view.registrations[0].captain.userId).toBe('c1');
    expect(view.registrations[0].captain.presence).toBe('PRESENT');
    expect(view.registrations[0].partner.presence).toBe('ABSENT');
    expect(view.pointedCount).toBe(1);
    expect(view.totalSlots).toBe(2);
  });

  it('listMarkTable : TOURNAMENT_NOT_FOUND si autre club', async () => {
    prismaMock.tournament.findFirst.mockResolvedValue(null as any);
    await expect(svc.listMarkTable('club-1', 't1')).rejects.toThrow('TOURNAMENT_NOT_FOUND');
  });

  it('listMarkTableLog : cap 200, plus récent d\'abord', async () => {
    prismaMock.tournament.findFirst.mockResolvedValue({ id: 't1' } as any);
    (prismaMock.tournamentLogEntry.findMany as jest.Mock).mockResolvedValue([]);
    await svc.listMarkTableLog('club-1', 't1');
    const arg = (prismaMock.tournamentLogEntry.findMany as jest.Mock).mock.calls[0][0];
    expect(arg.orderBy).toEqual({ createdAt: 'desc' });
    expect(arg.take).toBe(200);
  });
});

describe('table de marque — pointage', () => {
  let svc: TournamentService;
  beforeEach(() => { jest.clearAllMocks(); svc = new TournamentService(); });

  it('setPresence : écrit le côté demandé + journal CHECK_IN', async () => {
    prismaMock.tournamentRegistration.findFirst.mockResolvedValue({
      id: 'r1', captainUserId: 'c1', partnerUserId: 'p1',
      captain: { firstName: 'A', lastName: 'B' }, partner: { firstName: 'C', lastName: 'D' },
    } as any);
    const tx = { tournamentRegistration: { update: jest.fn() }, tournamentLogEntry: { create: jest.fn() } };
    (prismaMock.$transaction as jest.Mock).mockImplementation(async (fn: any) => fn(tx));

    await svc.setPresence('club-1', 't1', 'r1', 'CAPTAIN', 'PRESENT', 'staff-1');

    expect(tx.tournamentRegistration.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { captainPresence: 'PRESENT' } });
    expect(tx.tournamentLogEntry.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tournamentId: 't1', actorUserId: 'staff-1', kind: 'CHECK_IN' }),
    }));
  });

  it('setPresence : REGISTRATION_NOT_FOUND hors club/tournoi', async () => {
    prismaMock.tournamentRegistration.findFirst.mockResolvedValue(null as any);
    await expect(svc.setPresence('club-1', 't1', 'r1', 'CAPTAIN', 'PRESENT', 'u1')).rejects.toThrow('REGISTRATION_NOT_FOUND');
  });

  it('markTablePromote délègue à adminPromoteRegistration puis journalise', async () => {
    const spy = jest.spyOn(svc, 'adminPromoteRegistration').mockResolvedValue({ id: 'r1' } as never);
    prismaMock.tournamentRegistration.findUnique.mockResolvedValue({
      captain: { firstName: 'A', lastName: 'B' }, partner: { firstName: 'C', lastName: 'D' },
    } as any);
    (prismaMock.tournamentLogEntry.create as jest.Mock).mockResolvedValue({} as any);
    await svc.markTablePromote('club-1', 't1', 'r1', 'staff-1');
    expect(spy).toHaveBeenCalledWith('t1', 'r1', 'club-1');
    expect(prismaMock.tournamentLogEntry.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: 'PROMOTE' }),
    }));
  });

  // Non demandé par la description de tâche, ajouté pour la parité avec markTablePromote
  // (même wrapper journalisé, même risque de régression silencieuse sur le journal).
  it('markTableRemove délègue à adminRemoveRegistration puis journalise', async () => {
    prismaMock.tournamentRegistration.findUnique.mockResolvedValue({
      captain: { firstName: 'A', lastName: 'B' }, partner: { firstName: 'C', lastName: 'D' },
    } as any);
    const spy = jest.spyOn(svc, 'adminRemoveRegistration').mockResolvedValue({ id: 'r1' } as never);
    (prismaMock.tournamentLogEntry.create as jest.Mock).mockResolvedValue({} as any);
    await svc.markTableRemove('club-1', 't1', 'r1', 'staff-1');
    expect(spy).toHaveBeenCalledWith('t1', 'r1', 'club-1');
    expect(prismaMock.tournamentLogEntry.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: 'REMOVE' }),
    }));
  });
});

describe('table de marque — forfait & banc', () => {
  let svc: TournamentService;
  beforeEach(() => { jest.clearAllMocks(); svc = new TournamentService(); });

  it('declareForfeit : annule l\'inscription, met le coéquipier au banc, promeut l\'attente', async () => {
    prismaMock.tournamentRegistration.findFirst.mockResolvedValue({
      id: 'r1', status: 'CONFIRMED', captainUserId: 'c1', partnerUserId: 'p1',
      captain: { firstName: 'Bernard', lastName: 'X' }, partner: { firstName: 'Andre', lastName: 'Y' },
    } as any);
    const tx = {
      $queryRaw: jest.fn(),
      tournamentRegistration: { update: jest.fn().mockResolvedValue({ id: 'r1' }), findFirst: jest.fn().mockResolvedValue(null) },
      tournamentBenchEntry: { create: jest.fn() },
      tournamentLogEntry: { create: jest.fn() },
    };
    (prismaMock.$transaction as jest.Mock).mockImplementation((fn: any) => fn(tx));

    await svc.declareForfeit('club-1', 't1', 'r1', 'CAPTAIN', 'staff-1');

    expect(tx.tournamentRegistration.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'r1' }, data: expect.objectContaining({ status: 'CANCELLED' }),
    }));
    expect(tx.tournamentBenchEntry.create).toHaveBeenCalledWith({
      data: { tournamentId: 't1', userId: 'p1', source: 'FORFEIT', addedById: 'staff-1' },
    });
    expect(tx.tournamentLogEntry.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: 'FORFEIT' }),
    }));
  });

  it('declareForfeit : REGISTRATION_NOT_FOUND hors club/tournoi/déjà annulé', async () => {
    prismaMock.tournamentRegistration.findFirst.mockResolvedValue(null as any);
    await expect(svc.declareForfeit('club-1', 't1', 'r1', 'CAPTAIN', 'staff-1')).rejects.toThrow('REGISTRATION_NOT_FOUND');
  });

  it('addToBench : refuse un non-membre (NOT_A_MEMBER)', async () => {
    prismaMock.clubMembership.findUnique.mockResolvedValue(null as any);
    await expect(svc.addToBench('club-1', 't1', 'u9', 'staff-1')).rejects.toThrow('NOT_A_MEMBER');
  });

  it('addToBench : refuse un déjà-inscrit (ALREADY_REGISTERED)', async () => {
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);
    prismaMock.tournamentRegistration.findFirst.mockResolvedValue({ id: 'r-existing' } as any);
    await expect(svc.addToBench('club-1', 't1', 'u9', 'staff-1')).rejects.toThrow('ALREADY_REGISTERED');
  });

  it('addToBench : idempotent (ALREADY_ON_BENCH)', async () => {
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);
    prismaMock.tournamentRegistration.findFirst.mockResolvedValue(null as any);
    (prismaMock.tournamentBenchEntry.findUnique as jest.Mock).mockResolvedValue({ id: 'b1' } as any);
    await expect(svc.addToBench('club-1', 't1', 'u9', 'staff-1')).rejects.toThrow('ALREADY_ON_BENCH');
  });

  it('addToBench : membre éligible, pas encore inscrit → créé + journalisé', async () => {
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);
    prismaMock.tournamentRegistration.findFirst.mockResolvedValue(null as any);
    (prismaMock.tournamentBenchEntry.findUnique as jest.Mock).mockResolvedValue(null as any);
    prismaMock.user.findUnique.mockResolvedValue({ firstName: 'Zoé', lastName: 'K' } as any);
    const tx = { tournamentBenchEntry: { create: jest.fn() }, tournamentLogEntry: { create: jest.fn() } };
    (prismaMock.$transaction as jest.Mock).mockImplementation((fn: any) => fn(tx));

    await svc.addToBench('club-1', 't1', 'u9', 'staff-1');

    expect(tx.tournamentBenchEntry.create).toHaveBeenCalledWith({
      data: { tournamentId: 't1', userId: 'u9', source: 'WALK_IN', addedById: 'staff-1' },
    });
    expect(tx.tournamentLogEntry.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: 'ADD_LATE' }),
    }));
  });

  it('removeFromBench : BENCH_ENTRY_NOT_FOUND si absent', async () => {
    (prismaMock.tournamentBenchEntry.deleteMany as jest.Mock).mockResolvedValue({ count: 0 } as any);
    await expect(svc.removeFromBench('club-1', 't1', 'u9', 'staff-1')).rejects.toThrow('BENCH_ENTRY_NOT_FOUND');
  });

  it('removeFromBench : supprime l\'entrée présente', async () => {
    (prismaMock.tournamentBenchEntry.deleteMany as jest.Mock).mockResolvedValue({ count: 1 } as any);
    await expect(svc.removeFromBench('club-1', 't1', 'u9', 'staff-1')).resolves.toBeUndefined();
  });
});

describe('table de marque — remplacement', () => {
  let svc: TournamentService;
  beforeEach(() => { jest.clearAllMocks(); svc = new TournamentService(); });

  const baseReg = {
    id: 'r1', tournamentId: 't1', captainUserId: 'c1', partnerUserId: 'p1',
    tournament: { gender: 'MEN', openToWomen: false },
    captain: { firstName: 'Bernard', lastName: 'X', email: 'bernard@test.fr' },
    partner: { firstName: 'Andre', lastName: 'Y', email: 'andre@test.fr' },
  };

  /** Câble prisma.$transaction pour exécuter le callback avec un tx mocké minimal. Renvoie le tx pour assertions. */
  function mockTx() {
    const tx = {
      tournamentRegistration: { update: jest.fn().mockResolvedValue({ id: 'r1' }) },
      tournamentBenchEntry: { deleteMany: jest.fn() },
      tournamentLogEntry: { create: jest.fn() },
    };
    (prismaMock.$transaction as jest.Mock).mockImplementation((fn: any) => fn(tx));
    return tx;
  }

  it('replacePlayer : swap le côté CAPTAIN, présence -> PRESENT, paiement intouché, journalise', async () => {
    (prismaMock.tournamentRegistration.findFirst as jest.Mock)
      .mockResolvedValueOnce(baseReg as any) // fetch de la registration ciblée
      .mockResolvedValueOnce(null as any);   // dup check : 'u9' n'est nulle part ailleurs
    (prismaMock.clubMembership.findUnique as jest.Mock).mockResolvedValue({ status: 'ACTIVE' } as any);
    (prismaMock.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u9', sex: 'MALE', firstName: 'Marc', lastName: 'Z', email: 'marc@test.fr' } as any);
    const tx = mockTx();

    await svc.replacePlayer('club-1', 't1', 'r1', 'CAPTAIN', 'u9', 'staff-1');

    expect(tx.tournamentRegistration.update).toHaveBeenCalledWith({
      where: { id: 'r1' }, data: { captainUserId: 'u9', captainPresence: 'PRESENT' },
    });
    expect(tx.tournamentBenchEntry.deleteMany).toHaveBeenCalledWith({ where: { tournamentId: 't1', userId: 'u9' } });
    expect(tx.tournamentLogEntry.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tournamentId: 't1', actorUserId: 'staff-1', kind: 'REPLACE' }),
    }));
    // Le paiement (paymentStatus/paymentDeadline) n'est JAMAIS touché par un remplacement
    // (décision de conception § « Décisions » points 2 et 4) : le seul appel d'update ne
    // doit porter aucune clé paymentStatus.
    expect(tx.tournamentRegistration.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ paymentStatus: expect.anything() }) }),
    );
  });

  it('replacePlayer : swap le côté PARTNER également (branche symétrique)', async () => {
    (prismaMock.tournamentRegistration.findFirst as jest.Mock)
      .mockResolvedValueOnce(baseReg as any)
      .mockResolvedValueOnce(null as any);
    (prismaMock.clubMembership.findUnique as jest.Mock).mockResolvedValue({ status: 'ACTIVE' } as any);
    (prismaMock.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u9', sex: 'MALE', firstName: 'Marc', lastName: 'Z', email: 'marc@test.fr' } as any);
    const tx = mockTx();

    await svc.replacePlayer('club-1', 't1', 'r1', 'PARTNER', 'u9', 'staff-1');

    expect(tx.tournamentRegistration.update).toHaveBeenCalledWith({
      where: { id: 'r1' }, data: { partnerUserId: 'u9', partnerPresence: 'PRESENT' },
    });
    expect(tx.tournamentBenchEntry.deleteMany).toHaveBeenCalledWith({ where: { tournamentId: 't1', userId: 'u9' } });
  });

  // Point le plus important de cette task (cf. note d'implémenteur du plan) : sans l'email
  // réel du joueur RETIRÉ, `notifyTournamentReplacement` est un no-op silencieux
  // (`if (!opts.removedPlayer.email) return;` dans notifications.ts) et l'email ne part jamais.
  it('replacePlayer : notifie le joueur retiré avec SON email réel (pas null, pas undefined)', async () => {
    (prismaMock.tournamentRegistration.findFirst as jest.Mock)
      .mockResolvedValueOnce(baseReg as any)
      .mockResolvedValueOnce(null as any);
    (prismaMock.clubMembership.findUnique as jest.Mock).mockResolvedValue({ status: 'ACTIVE' } as any);
    (prismaMock.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u9', sex: 'MALE', firstName: 'Marc', lastName: 'Z', email: 'marc@test.fr' } as any);
    mockTx();

    await svc.replacePlayer('club-1', 't1', 'r1', 'CAPTAIN', 'u9', 'staff-1');

    expect(notifyTournamentReplacement).toHaveBeenCalledWith(expect.objectContaining({
      tournamentId: 't1',
      removedPlayer: expect.objectContaining({ id: 'c1', email: 'bernard@test.fr', firstName: 'Bernard', lastName: 'X' }),
      remainingPlayerName: 'Andre Y',
    }));
    const call = (notifyTournamentReplacement as jest.Mock).mock.calls[0][0];
    expect(call.removedPlayer.email).toBe('bernard@test.fr');
    expect(call.removedPlayer.email).not.toBeNull();
    expect(call.removedPlayer.email).not.toBeUndefined();
    // Le remplaçant ET le coéquipier restant sont notifiés séparément, APRÈS le swap (même regId).
    expect(notifyTournamentRegistration).toHaveBeenCalledWith('r1');
  });

  // Parité avec les méthodes sœurs de ce même bloc (setPresence, declareForfeit) : hors
  // club / hors tournoi / déjà annulée → REGISTRATION_NOT_FOUND, avant tout autre contrôle.
  it('replacePlayer : REGISTRATION_NOT_FOUND hors club/tournoi/déjà annulée', async () => {
    (prismaMock.tournamentRegistration.findFirst as jest.Mock).mockResolvedValue(null as any);
    await expect(svc.replacePlayer('club-1', 't1', 'r1', 'CAPTAIN', 'u9', 'staff-1')).rejects.toThrow('REGISTRATION_NOT_FOUND');
  });

  it('replacePlayer : refuse un non-membre (NOT_A_MEMBER)', async () => {
    (prismaMock.tournamentRegistration.findFirst as jest.Mock).mockResolvedValue(baseReg as any);
    (prismaMock.clubMembership.findUnique as jest.Mock).mockResolvedValue(null as any);
    await expect(svc.replacePlayer('club-1', 't1', 'r1', 'CAPTAIN', 'u9', 'staff-1')).rejects.toThrow('NOT_A_MEMBER');
  });

  it('replacePlayer : refuse un déjà-inscrit dans ce tournoi (ALREADY_REGISTERED)', async () => {
    (prismaMock.tournamentRegistration.findFirst as jest.Mock)
      .mockResolvedValueOnce(baseReg as any)
      .mockResolvedValueOnce({ id: 'r-other' } as any);
    (prismaMock.clubMembership.findUnique as jest.Mock).mockResolvedValue({ status: 'ACTIVE' } as any);
    await expect(svc.replacePlayer('club-1', 't1', 'r1', 'CAPTAIN', 'u9', 'staff-1')).rejects.toThrow('ALREADY_REGISTERED');
  });

  it('replacePlayer : composition refusée avec GENDER_MISMATCH (tableau Dames, remplaçant homme)', async () => {
    (prismaMock.tournamentRegistration.findFirst as jest.Mock)
      .mockResolvedValueOnce({ ...baseReg, tournament: { gender: 'WOMEN', openToWomen: false } } as any)
      .mockResolvedValueOnce(null as any);
    (prismaMock.clubMembership.findUnique as jest.Mock).mockResolvedValue({ status: 'ACTIVE' } as any);
    (prismaMock.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u9', sex: 'MALE' } as any);
    await expect(svc.replacePlayer('club-1', 't1', 'r1', 'CAPTAIN', 'u9', 'staff-1')).rejects.toThrow('GENDER_MISMATCH');
  });

  // Exigence explicite de la task : prouver que assertGender reçoit les sexes des DEUX côtés
  // correctement affectés (captainSex = celui qui occupe RÉELLEMENT la place capitaine après le
  // swap, partnerSex = celui qui occupe la place partenaire) — pas juste qu'une erreur sort.
  // Sexes volontairement DIFFÉRENTS (MALE/FEMALE) : une inversion captainSex<->partnerSex dans
  // l'implémentation changerait l'appel observé ci-dessous et ferait tomber ce test.
  it('replacePlayer : assertGender reçoit les sexes des DEUX côtés correctement affectés (détecte une inversion captain/partner)', async () => {
    (prismaMock.tournamentRegistration.findFirst as jest.Mock)
      .mockResolvedValueOnce({ ...baseReg, tournament: { gender: 'WOMEN', openToWomen: false } } as any)
      .mockResolvedValueOnce(null as any);
    (prismaMock.clubMembership.findUnique as jest.Mock).mockResolvedValue({ status: 'ACTIVE' } as any);
    // Remplaçant (nouveau CAPTAIN, 'u9') = homme ; coéquipière conservée (partner 'p1') = femme.
    (prismaMock.user.findUnique as jest.Mock)
      .mockResolvedValueOnce({ id: 'u9', sex: 'MALE', firstName: 'Marc', lastName: 'Z', email: 'marc@test.fr' } as any) // newUser
      .mockResolvedValueOnce({ sex: 'FEMALE' } as any); // otherUser = partner existant (p1)
    const spy = jest.spyOn(svc as any, 'assertGender');

    await expect(svc.replacePlayer('club-1', 't1', 'r1', 'CAPTAIN', 'u9', 'staff-1')).rejects.toThrow('GENDER_MISMATCH');

    // side='CAPTAIN' : captainSex doit venir du REMPLAÇANT (MALE), partnerSex du côté conservé (FEMALE).
    expect(spy).toHaveBeenCalledWith('WOMEN', 'MALE', 'FEMALE', false);
  });
});

describe('table de marque — appariement & tardif', () => {
  let svc: TournamentService;
  beforeEach(() => { jest.clearAllMocks(); svc = new TournamentService(); });

  function mockTournament(overrides: Record<string, unknown> = {}) {
    prismaMock.tournament.findUnique.mockResolvedValue({
      id: 't1', clubId: 'club-1', gender: 'MEN', openToWomen: true, status: 'PUBLISHED', maxTeams: 12, requirePrepayment: false,
      ...overrides,
    } as any);
  }

  /** Mocke la paire ua/ub comme 2 hommes membres ACTIVE (chemin nominal). */
  function mockEligiblePair() {
    (prismaMock.user.findUnique as jest.Mock)
      .mockResolvedValueOnce({ id: 'ua', sex: 'MALE', firstName: 'A', lastName: 'B' } as any)
      .mockResolvedValueOnce({ id: 'ub', sex: 'MALE', firstName: 'C', lastName: 'D' } as any);
    (prismaMock.clubMembership.findUnique as jest.Mock).mockResolvedValue({ status: 'ACTIVE' } as any);
  }

  /** Câble prisma.$transaction pour exécuter le callback avec un tx mocké. `registrationOverrides` ne remplace que les clés fournies. */
  function mockTx(registrationOverrides: Record<string, any> = {}) {
    const tx = {
      $queryRaw: jest.fn(),
      tournamentRegistration: {
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(5),
        create: jest.fn().mockResolvedValue({ id: 'r-new', status: 'CONFIRMED' }),
        ...registrationOverrides,
      },
      tournamentBenchEntry: { deleteMany: jest.fn() },
      tournamentLogEntry: { create: jest.fn() },
    };
    (prismaMock.$transaction as jest.Mock).mockImplementation((fn: any) => fn(tx));
    return tx;
  }

  it('pairFromBench : crée une inscription CONFIRMED si place libre, sort les 2 du banc', async () => {
    mockTournament();
    mockEligiblePair();
    const tx = mockTx();

    const reg = await svc.pairFromBench('club-1', 't1', 'ua', 'ub', 'staff-1');

    expect(tx.tournamentRegistration.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tournamentId: 't1', captainUserId: 'ua', partnerUserId: 'ub', status: 'CONFIRMED' }),
    }));
    expect(tx.tournamentBenchEntry.deleteMany).toHaveBeenCalledWith({ where: { tournamentId: 't1', userId: { in: ['ua', 'ub'] } } });
    expect(tx.tournamentLogEntry.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: 'PAIR' }),
    }));
    expect(reg.id).toBe('r-new');
  });

  it('pairFromBench : WAITLISTED si complet', async () => {
    mockTournament({ maxTeams: 2 });
    mockEligiblePair();
    const tx = mockTx({ count: jest.fn().mockResolvedValue(2), create: jest.fn().mockResolvedValue({ id: 'r-new', status: 'WAITLISTED' }) });

    const reg = await svc.pairFromBench('club-1', 't1', 'ua', 'ub', 'staff-1');

    expect(reg.status).toBe('WAITLISTED');
    void tx;
  });

  it('pairFromBench : épreuve payante -> DUE + holdDeadline', async () => {
    mockTournament({ requirePrepayment: true });
    mockEligiblePair();
    const tx = mockTx({ count: jest.fn().mockResolvedValue(1) });

    await svc.pairFromBench('club-1', 't1', 'ua', 'ub', 'staff-1');

    const createArg = tx.tournamentRegistration.create.mock.calls[0][0];
    expect(createArg.data.paymentStatus).toBe('DUE');
    expect(createArg.data.paymentDeadline).toBeInstanceOf(Date);
  });

  it('addLateRegistration : même chemin sans passer par le banc (pas de retrait du banc)', async () => {
    mockTournament();
    mockEligiblePair();
    const tx = mockTx({ count: jest.fn().mockResolvedValue(0) });

    await svc.addLateRegistration('club-1', 't1', 'ua', 'ub', 'staff-1');

    expect(tx.tournamentLogEntry.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: 'ADD_LATE' }),
    }));
    expect(tx.tournamentBenchEntry.deleteMany).not.toHaveBeenCalled();
  });

  it('pairFromBench : lève PARTNER_IS_SELF si les 2 ids sont identiques', async () => {
    mockTournament();
    await expect(svc.pairFromBench('club-1', 't1', 'ua', 'ua', 'staff-1')).rejects.toThrow('PARTNER_IS_SELF');
  });

  it('pairFromBench : lève TOURNAMENT_NOT_FOUND si le tournoi appartient à un autre club', async () => {
    mockTournament({ clubId: 'club-other' });
    await expect(svc.pairFromBench('club-1', 't1', 'ua', 'ub', 'staff-1')).rejects.toThrow('TOURNAMENT_NOT_FOUND');
  });

  it('pairFromBench : lève TOURNAMENT_NOT_OPEN si le tournoi n\'est pas PUBLISHED (pas de gate deadline)', async () => {
    mockTournament({ status: 'DRAFT' });
    await expect(svc.pairFromBench('club-1', 't1', 'ua', 'ub', 'staff-1')).rejects.toThrow('TOURNAMENT_NOT_OPEN');
  });

  it('pairFromBench : lève NOT_A_MEMBER si un des deux n\'est pas membre actif du club', async () => {
    mockTournament();
    (prismaMock.clubMembership.findUnique as jest.Mock).mockResolvedValue(null as any);
    await expect(svc.pairFromBench('club-1', 't1', 'ua', 'ub', 'staff-1')).rejects.toThrow('NOT_A_MEMBER');
  });

  it('pairFromBench : lève GENDER_MISMATCH si la composition ne respecte pas le tableau', async () => {
    mockTournament({ gender: 'WOMEN', openToWomen: false });
    (prismaMock.user.findUnique as jest.Mock)
      .mockResolvedValueOnce({ id: 'ua', sex: 'MALE', firstName: 'A', lastName: 'B' } as any)
      .mockResolvedValueOnce({ id: 'ub', sex: 'FEMALE', firstName: 'C', lastName: 'D' } as any);
    (prismaMock.clubMembership.findUnique as jest.Mock).mockResolvedValue({ status: 'ACTIVE' } as any);
    await expect(svc.pairFromBench('club-1', 't1', 'ua', 'ub', 'staff-1')).rejects.toThrow('GENDER_MISMATCH');
  });
});
