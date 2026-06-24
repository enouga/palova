import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { ClubService } from '../club.service';

describe('ClubService — recherche de membres', () => {
  let service: ClubService;
  beforeEach(() => { service = new ClubService(); });

  it('refuse un non-membre (MEMBERSHIP_REQUIRED)', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue(null as any);
    await expect(service.searchMembers('demo', 'caller', 'dup')).rejects.toThrow('MEMBERSHIP_REQUIRED');
  });

  it('renvoie la liste des membres (≤20, sans filtre nom) quand la requête est vide', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findMany.mockResolvedValue([
      { user: { id: 'u1', firstName: 'Jean', lastName: 'Dupont' } },
    ] as any);
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-padel' } as any);
    prismaMock.playerRating.findMany.mockResolvedValue([] as any);

    const result = await service.searchMembers('demo', 'caller', '');

    expect(result).toEqual([{ id: 'u1', firstName: 'Jean', lastName: 'Dupont', level: null }]);
    const arg = (prismaMock.clubMembership.findMany as jest.Mock).mock.calls[0][0];
    expect(arg.where.user).toBeUndefined(); // pas de filtre nom quand la requête est vide
    expect(arg.take).toBe(20);
  });

  it('renvoie les membres correspondants (id + nom uniquement, sans e-mail)', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findMany.mockResolvedValue([
      { user: { id: 'u1', firstName: 'Jean', lastName: 'Dupont' } },
      { user: { id: 'u2', firstName: 'Julie', lastName: 'Dupond' } },
    ] as any);
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-padel' } as any);
    prismaMock.playerRating.findMany.mockResolvedValue([] as any);

    const result = await service.searchMembers('demo', 'caller', 'dup');

    expect(result).toEqual([
      { id: 'u1', firstName: 'Jean', lastName: 'Dupont', level: null },
      { id: 'u2', firstName: 'Julie', lastName: 'Dupond', level: null },
    ]);
    const arg = (prismaMock.clubMembership.findMany as jest.Mock).mock.calls[0][0];
    expect(arg.where.userId).toEqual({ not: 'caller' });
    expect(arg.where.status).toBe('ACTIVE');
    expect(arg.where.user).toBeDefined(); // filtre nom appliqué quand la requête est non vide
    expect(arg.take).toBe(20);
  });
  it('enrichit chaque membre avec son niveau padel (level)', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findMany.mockResolvedValue([
      { user: { id: 'u1', firstName: 'Jean', lastName: 'Dupont' } },
    ] as any);
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-padel' } as any);
    prismaMock.playerRating.findMany.mockResolvedValue([
      { userId: 'u1', displayLevel: 5, rd: 80, isProvisional: false },
    ] as any);

    const result = await service.searchMembers('demo', 'caller', '');

    expect(result).toEqual([
      { id: 'u1', firstName: 'Jean', lastName: 'Dupont', level: { level: 5, tier: 'Confirmé', isProvisional: false, reliability: 93 } },
    ]);
  });

  it('searchMembers utilise le sport préféré de l\'appelant', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-arena', status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findMany.mockResolvedValue([
      { user: { id: 'u2', firstName: 'Alice', lastName: 'Martin' } },
    ] as any);
    prismaMock.user.findUnique.mockResolvedValue({ preferredSport: { key: 'tennis' } } as any);
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-tennis' } as any);
    prismaMock.playerRating.findMany.mockResolvedValue([] as any);

    await service.searchMembers('arena', 'caller-1', '');

    expect(prismaMock.sport.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { key: 'tennis' } }));
  });

  it('refuse un membre bloqué (MEMBERSHIP_REQUIRED)', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'BLOCKED' } as any);
    await expect(service.searchMembers('demo', 'caller', 'dup')).rejects.toThrow('MEMBERSHIP_REQUIRED');
  });

  it('refuse un club suspendu / introuvable (CLUB_NOT_FOUND)', async () => {
    prismaMock.club.findUnique.mockResolvedValue(null as any);
    await expect(service.searchMembers('demo', 'caller', 'dup')).rejects.toThrow('CLUB_NOT_FOUND');
  });
});

describe('ClubService — mon adhésion (licence)', () => {
  let service: ClubService;
  beforeEach(() => { service = new ClubService(); });

  it('getMyMembership renvoie la licence du joueur', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ membershipNo: 'LIC-9', status: 'ACTIVE', isSubscriber: false } as any);
    expect(await service.getMyMembership('demo', 'caller')).toMatchObject({ membershipNo: 'LIC-9' });
  });

  it('getMyMembership lève MEMBERSHIP_REQUIRED si pas membre', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue(null as any);
    await expect(service.getMyMembership('demo', 'caller')).rejects.toThrow('MEMBERSHIP_REQUIRED');
  });

  it('setMyMembership écrit la licence (trim) sur sa propre adhésion', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ id: 'm1', status: 'ACTIVE' } as any);
    prismaMock.clubMembership.update.mockResolvedValue({ membershipNo: 'LIC-9', status: 'ACTIVE', isSubscriber: false } as any);

    await service.setMyMembership('demo', 'caller', '  LIC-9  ');

    expect(prismaMock.clubMembership.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { membershipNo: 'LIC-9' },
      select: { membershipNo: true, status: true, isSubscriber: true },
    });
  });

  it('setMyMembership refuse une licence vide (VALIDATION_ERROR)', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ id: 'm1', status: 'ACTIVE' } as any);
    await expect(service.setMyMembership('demo', 'caller', '   ')).rejects.toThrow('VALIDATION_ERROR');
  });

  it('setMyMembership refuse un membre bloqué (MEMBERSHIP_BLOCKED)', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ id: 'm1', status: 'BLOCKED' } as any);
    await expect(service.setMyMembership('demo', 'caller', 'LIC-9')).rejects.toThrow('MEMBERSHIP_BLOCKED');
  });
});

describe('ClubService — empreinte carte (getMyCardStatus)', () => {
  let service: ClubService;
  beforeEach(() => { service = new ClubService(); });

  it('renvoie hasCardOnFile=true quand une carte est enregistrée (defaultPaymentMethodId)', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
    prismaMock.clubStripeCustomer.findUnique.mockResolvedValue({ defaultPaymentMethodId: 'pm_saved' } as any);
    expect(await service.getMyCardStatus('demo', 'caller')).toEqual({ hasCardOnFile: true });
  });

  it('renvoie hasCardOnFile=false quand defaultPaymentMethodId est null', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
    prismaMock.clubStripeCustomer.findUnique.mockResolvedValue({ defaultPaymentMethodId: null } as any);
    expect(await service.getMyCardStatus('demo', 'caller')).toEqual({ hasCardOnFile: false });
  });

  it('renvoie hasCardOnFile=false quand aucun client Stripe (absent)', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
    prismaMock.clubStripeCustomer.findUnique.mockResolvedValue(null as any);
    expect(await service.getMyCardStatus('demo', 'caller')).toEqual({ hasCardOnFile: false });
  });

  it('lève CLUB_NOT_FOUND pour un club inconnu / suspendu', async () => {
    prismaMock.club.findUnique.mockResolvedValue(null as any);
    await expect(service.getMyCardStatus('demo', 'caller')).rejects.toThrow('CLUB_NOT_FOUND');
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'SUSPENDED' } as any);
    await expect(service.getMyCardStatus('demo', 'caller')).rejects.toThrow('CLUB_NOT_FOUND');
  });
});

describe('clubLeaderboard', () => {
  const service = new ClubService();
  const activeClub = { id: 'club-1', status: 'ACTIVE', levelSystemEnabled: true };

  function mockBase() {
    prismaMock.club.findUnique.mockResolvedValue(activeClub as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-padel' } as any);
  }

  it('classe les joueurs par niveau décroissant puis rating, avec rangs', async () => {
    mockBase();
    prismaMock.clubMembership.findMany.mockResolvedValue([
      { user: { id: 'u2', firstName: 'Bea', lastName: 'B', avatarUrl: null, playerRatings: [{ displayLevel: 5.0, rating: 1700, matchesPlayed: 12 }] } },
      { user: { id: 'u1', firstName: 'Ana', lastName: 'A', avatarUrl: null, playerRatings: [{ displayLevel: 6.2, rating: 1820, matchesPlayed: 30 }] } },
      { user: { id: 'u3', firstName: 'Cy', lastName: 'C', avatarUrl: null, playerRatings: [{ displayLevel: 5.0, rating: 1750, matchesPlayed: 8 }] } },
    ] as any);
    prismaMock.user.findUnique.mockResolvedValue({ showInLeaderboard: true, playerRatings: [{ displayLevel: 6.2, matchesPlayed: 30 }] } as any);

    const res = await service.clubLeaderboard('padel-arena', 'u1', 'padel');
    expect(res.entries.map((e) => [e.rank, e.userId])).toEqual([[1, 'u1'], [2, 'u3'], [3, 'u2']]);
    expect(res.entries[0].tier).toBe('Avancé'); // namedTier(6.2)
    expect(res.me).toEqual({ optedIn: true, ranked: true, rank: 1, level: 6.2, matchesPlayed: 30, matchesToGo: 0 });
  });

  it('me non classé : opt-in mais pas assez de matchs → matchesToGo', async () => {
    mockBase();
    prismaMock.clubMembership.findMany.mockResolvedValue([] as any);
    prismaMock.user.findUnique.mockResolvedValue({ showInLeaderboard: true, playerRatings: [{ displayLevel: 3.4, matchesPlayed: 3 }] } as any);

    const res = await service.clubLeaderboard('padel-arena', 'u1', 'padel');
    expect(res.entries).toEqual([]);
    expect(res.me).toEqual({ optedIn: true, ranked: false, rank: null, level: 3.4, matchesPlayed: 3, matchesToGo: 2 });
  });

  it('me non opté : optedIn false, ranked false', async () => {
    mockBase();
    prismaMock.clubMembership.findMany.mockResolvedValue([] as any);
    prismaMock.user.findUnique.mockResolvedValue({ showInLeaderboard: false, playerRatings: [] } as any);

    const res = await service.clubLeaderboard('padel-arena', 'u1', 'padel');
    expect(res.me).toEqual({ optedIn: false, ranked: false, rank: null, level: null, matchesPlayed: 0, matchesToGo: 5 });
  });

  it('refuse un non-membre (MEMBERSHIP_REQUIRED)', async () => {
    prismaMock.club.findUnique.mockResolvedValue(activeClub as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue(null as any);
    await expect(service.clubLeaderboard('padel-arena', 'uX', 'padel')).rejects.toThrow('MEMBERSHIP_REQUIRED');
  });

  it('sport inconnu → SPORT_NOT_FOUND', async () => {
    prismaMock.club.findUnique.mockResolvedValue(activeClub as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);
    prismaMock.sport.findUnique.mockResolvedValue(null as any);
    await expect(service.clubLeaderboard('padel-arena', 'u1', 'curling')).rejects.toThrow('SPORT_NOT_FOUND');
  });

  it('clubLeaderboard refuse si le club a désactivé le niveau', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'c1', status: 'ACTIVE', levelSystemEnabled: false } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);
    await expect(service.clubLeaderboard('demo', 'u1')).rejects.toThrow('LEVEL_SYSTEM_DISABLED');
  });
});

describe('ClubService.resolveSlug', () => {
  const service = new ClubService();

  it('slug actuel → moved:false', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ slug: 'arena' } as any);
    await expect(service.resolveSlug('arena')).resolves.toEqual({ slug: 'arena', moved: false });
  });

  it('alias historique → slug actuel du club, moved:true', async () => {
    prismaMock.club.findUnique.mockResolvedValue(null as any);
    prismaMock.clubSlugAlias.findUnique.mockResolvedValue({ club: { slug: 'nouveau' } } as any);
    await expect(service.resolveSlug('ancien')).resolves.toEqual({ slug: 'nouveau', moved: true });
  });

  it('inconnu → CLUB_NOT_FOUND', async () => {
    prismaMock.club.findUnique.mockResolvedValue(null as any);
    prismaMock.clubSlugAlias.findUnique.mockResolvedValue(null as any);
    await expect(service.resolveSlug('inconnu')).rejects.toThrow('CLUB_NOT_FOUND');
  });
});

describe('ClubService.createClub — slugs réservés / alias', () => {
  const service = new ClubService();

  it('SLUG_RESERVED pour un libellé technique', async () => {
    await expect(service.createClub({ ownerId: 'u1', name: 'App' })).rejects.toThrow('SLUG_RESERVED');
  });

  it('SLUG_TAKEN si le slug est un alias historique d un club', async () => {
    // La vérification d'alias se fait DANS la transaction (fix TOCTOU) — on injecte via tx.
    const tx = {
      clubSlugAlias: { findUnique: jest.fn().mockResolvedValue({ slug: 'ancien-club' }) },
      club: { create: jest.fn() },
      clubMember: { create: jest.fn() },
    };
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx));
    await expect(service.createClub({ ownerId: 'u1', name: 'Ancien Club' })).rejects.toThrow('SLUG_TAKEN');
    expect(tx.club.create).not.toHaveBeenCalled();
  });
});

describe('levelSystemEnabled exposition', () => {
  let svc: ClubService;
  beforeEach(() => { svc = new ClubService(); });

  it('getClubBySlug renvoie levelSystemEnabled', async () => {
    prismaMock.club.findUnique.mockResolvedValue({
      id: 'c1', slug: 'demo', name: 'Demo', status: 'ACTIVE', levelSystemEnabled: false, clubSports: [],
    } as any);
    const res = await svc.getClubBySlug('demo');
    expect(res.levelSystemEnabled).toBe(false);
    const arg = (prismaMock.club.findUnique as jest.Mock).mock.calls[0][0];
    expect(arg.select.levelSystemEnabled).toBe(true);
  });

  it('getClubBySlug expose la politique d\'annulation (cutoff + remboursement)', async () => {
    prismaMock.club.findUnique.mockResolvedValue({
      id: 'c1', slug: 'demo', name: 'Demo', status: 'ACTIVE',
      cancellationCutoffHours: 24, refundOnCancelWithinCutoff: true, clubSports: [],
    } as any);
    const res = await svc.getClubBySlug('demo');
    expect(res.cancellationCutoffHours).toBe(24);
    expect(res.refundOnCancelWithinCutoff).toBe(true);
    const arg = (prismaMock.club.findUnique as jest.Mock).mock.calls[0][0];
    expect(arg.select.cancellationCutoffHours).toBe(true);
    expect(arg.select.refundOnCancelWithinCutoff).toBe(true);
  });

  it('getClubBySlug expose stripeAccountStatus (mais pas stripeAccountId) dans le payload public', async () => {
    prismaMock.club.findUnique.mockResolvedValue({
      id: 'c1', slug: 'demo', name: 'Demo', status: 'ACTIVE',
      stripeAccountStatus: 'ACTIVE', clubSports: [],
    } as any);
    const res = await svc.getClubBySlug('demo');
    expect((res as any).stripeAccountStatus).toBe('ACTIVE');
    const arg = (prismaMock.club.findUnique as jest.Mock).mock.calls[0][0];
    expect(arg.select.stripeAccountStatus).toBe(true);
    expect(arg.select.stripeAccountId).toBeUndefined();
  });

  it('getClubForAdmin sélectionne levelSystemEnabled', async () => {
    prismaMock.club.findUniqueOrThrow.mockResolvedValue({} as any);
    await svc.getClubForAdmin('club-1');
    const arg = (prismaMock.club.findUniqueOrThrow as jest.Mock).mock.calls[0][0];
    expect(arg.select.levelSystemEnabled).toBe(true);
  });

  it('updateClub accepte levelSystemEnabled', async () => {
    prismaMock.club.update.mockResolvedValue({} as any);
    await svc.updateClub('c1', { levelSystemEnabled: false } as any);
    const arg = (prismaMock.club.update as jest.Mock).mock.calls[0][0];
    expect(arg.data.levelSystemEnabled).toBe(false);
  });

  it('updateClub ignore levelSystemEnabled absent', async () => {
    prismaMock.club.update.mockResolvedValue({} as any);
    await svc.updateClub('c1', { name: 'X' });
    const arg = (prismaMock.club.update as jest.Mock).mock.calls[0][0];
    expect(arg.data.levelSystemEnabled).toBeUndefined();
  });
});

describe('slugify', () => {
  it('pas de tiret final quand la coupe à 60 tombe sur un tiret', () => {
    const { slugify } = require('../club.service');
    const out = slugify('a'.repeat(59) + ' b');
    expect(out).toBe('a'.repeat(59));
    expect(out.endsWith('-')).toBe(false);
  });
});

describe('ClubService — updateClub délais', () => {
  let svc: ClubService;
  beforeEach(() => { svc = new ClubService(); });

  it('clampe les délais entre 0 et 365', async () => {
    prismaMock.club.update.mockResolvedValue({} as any);
    await svc.updateClub('club-1', { playerChangeCutoffHours: 999, cancellationCutoffHours: -5 });
    const arg = (prismaMock.club.update as jest.Mock).mock.calls[0][0];
    expect(arg.data.playerChangeCutoffHours).toBe(365);
    expect(arg.data.cancellationCutoffHours).toBe(0);
  });

  it('ignore les délais absents', async () => {
    prismaMock.club.update.mockResolvedValue({} as any);
    await svc.updateClub('club-1', { name: 'X' });
    const arg = (prismaMock.club.update as jest.Mock).mock.calls[0][0];
    expect(arg.data.playerChangeCutoffHours).toBeUndefined();
    expect(arg.data.cancellationCutoffHours).toBeUndefined();
  });
});

describe('ClubService.addClubSport — gate published', () => {
  let svc: ClubService;
  beforeEach(() => { svc = new ClubService(); });

  it('refuse d\'activer un sport non publié (SPORT_NOT_FOUND) et n\'appelle pas upsert', async () => {
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-1', published: false } as any);
    await expect(svc.addClubSport('club-1', 'sport-1')).rejects.toThrow('SPORT_NOT_FOUND');
    expect(prismaMock.clubSport.upsert).not.toHaveBeenCalled();
  });

  it('active un sport publié (published: true) et appelle upsert', async () => {
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-1', published: true } as any);
    prismaMock.clubSport.upsert.mockResolvedValue({ id: 'cs-1', clubId: 'club-1', sportId: 'sport-1' } as any);
    const result = await svc.addClubSport('club-1', 'sport-1');
    expect(result).toMatchObject({ id: 'cs-1' });
    expect(prismaMock.clubSport.upsert).toHaveBeenCalledTimes(1);
  });
});

describe('ClubService — updateClub heures d\'ouverture', () => {
  let svc: ClubService;
  beforeEach(() => { svc = new ClubService(); });

  it('clampe les heures de release (0-23) et accepte un mode valide', async () => {
    prismaMock.club.update.mockResolvedValue({} as any);
    await svc.updateClub('club-1', { bookingReleaseMode: 'WINDOW_SHIFT', publicReleaseHour: 30, memberReleaseHour: -2 });
    const arg = (prismaMock.club.update as jest.Mock).mock.calls[0][0];
    expect(arg.data.bookingReleaseMode).toBe('WINDOW_SHIFT');
    expect(arg.data.publicReleaseHour).toBe(23);
    expect(arg.data.memberReleaseHour).toBe(0);
  });

  it('ignore un mode invalide', async () => {
    prismaMock.club.update.mockResolvedValue({} as any);
    await svc.updateClub('club-1', { bookingReleaseMode: 'NOPE' as any });
    const arg = (prismaMock.club.update as jest.Mock).mock.calls[0][0];
    expect(arg.data.bookingReleaseMode).toBeUndefined();
  });

  it('ignore les heures absentes', async () => {
    prismaMock.club.update.mockResolvedValue({} as any);
    await svc.updateClub('club-1', { name: 'X' });
    const arg = (prismaMock.club.update as jest.Mock).mock.calls[0][0];
    expect(arg.data.publicReleaseHour).toBeUndefined();
    expect(arg.data.memberReleaseHour).toBeUndefined();
  });
});

describe('ClubService — updateClub identité légale', () => {
  let svc: ClubService;
  beforeEach(() => { svc = new ClubService(); });

  it('écrit les champs d\'identité légale (trim) et ignore les absents', async () => {
    prismaMock.club.update.mockResolvedValue({} as any);
    await svc.updateClub('club-1', {
      legalEntityName: '  Padel Arena SAS  ',
      siret: ' 12345678900012 ',
      legalEmail: '  contact@arena.fr ',
    });
    const arg = (prismaMock.club.update as jest.Mock).mock.calls[0][0];
    expect(arg.data.legalEntityName).toBe('Padel Arena SAS');
    expect(arg.data.siret).toBe('12345678900012');
    expect(arg.data.legalEmail).toBe('contact@arena.fr');
    expect(arg.data.legalForm).toBeUndefined();
    expect(arg.data.vatNumber).toBeUndefined();
    expect(arg.data.legalRepresentative).toBeUndefined();
    expect(arg.data.legalPhone).toBeUndefined();
  });

  it('vide un champ d\'identité légale passé en chaîne vide (→ null)', async () => {
    prismaMock.club.update.mockResolvedValue({} as any);
    await svc.updateClub('club-1', { legalPhone: '   ' });
    const arg = (prismaMock.club.update as jest.Mock).mock.calls[0][0];
    expect(arg.data.legalPhone).toBeNull();
  });

  it('getClubForAdmin sélectionne les champs d\'identité légale', async () => {
    prismaMock.club.findUniqueOrThrow.mockResolvedValue({} as any);
    await svc.getClubForAdmin('club-1');
    const arg = (prismaMock.club.findUniqueOrThrow as jest.Mock).mock.calls[0][0];
    expect(arg.select.legalEntityName).toBe(true);
    expect(arg.select.legalForm).toBe(true);
    expect(arg.select.siret).toBe(true);
    expect(arg.select.vatNumber).toBe(true);
    expect(arg.select.legalRepresentative).toBe(true);
    expect(arg.select.legalEmail).toBe(true);
    expect(arg.select.legalPhone).toBe(true);
  });
});

describe('ClubService — annuaire (listClubs)', () => {
  let svc: ClubService;
  beforeEach(() => { svc = new ClubService(); });

  it('demande et expose coverImageUrl pour chaque club', async () => {
    prismaMock.club.findMany.mockResolvedValue([
      {
        id: 'c1', slug: 'demo', name: 'Padel Arena', city: 'Paris', description: null,
        accentColor: '#d6ff3f', logoUrl: null, coverImageUrl: '/uploads/covers/c1-1.jpg',
        clubSports: [{ sport: { key: 'padel', name: 'Padel', icon: '🎾' } }],
        _count: { resources: 3 },
      },
    ] as any);

    const [club] = await svc.listClubs({});
    expect(club.coverImageUrl).toBe('/uploads/covers/c1-1.jpg');
    const arg = (prismaMock.club.findMany as jest.Mock).mock.calls[0][0];
    expect(arg.select.coverImageUrl).toBe(true);
  });
});

describe('normalizeQuickPaymentMethods', () => {
  const { normalizeQuickPaymentMethods } = require('../club.service');

  it('garde les moyens autorisés, dans l\'ordre fourni', () => {
    expect(normalizeQuickPaymentMethods(['CASH', 'CARD', 'VOUCHER', 'TRANSFER', 'MEMBER']))
      .toEqual(['CASH', 'CARD', 'VOUCHER', 'TRANSFER', 'MEMBER']);
  });

  it('filtre les valeurs inconnues et dédoublonne en gardant la 1re occurrence', () => {
    expect(normalizeQuickPaymentMethods(['CARD', 'BITCOIN', 'CASH', 'CARD', 'PACK_CREDIT', 'WALLET', 'ONLINE', 'OTHER']))
      .toEqual(['CARD', 'CASH']);
  });

  it('entrée vide ou non-tableau → tableau vide', () => {
    expect(normalizeQuickPaymentMethods([])).toEqual([]);
    expect(normalizeQuickPaymentMethods('CARD' as any)).toEqual([]);
    expect(normalizeQuickPaymentMethods(null as any)).toEqual([]);
  });
});

describe('ClubService — moyens d\'encaissement rapides', () => {
  let svc: ClubService;
  beforeEach(() => { svc = new ClubService(); });

  it('updateClub écrit les moyens normalisés', async () => {
    prismaMock.club.update.mockResolvedValue({} as any);
    await svc.updateClub('club-1', { quickPaymentMethods: ['CARD', 'NOPE', 'CASH', 'CARD'] } as any);
    const arg = (prismaMock.club.update as jest.Mock).mock.calls[0][0];
    expect(arg.data.quickPaymentMethods).toEqual(['CARD', 'CASH']);
  });

  it('updateClub ignore quickPaymentMethods absent (ou non-tableau)', async () => {
    prismaMock.club.update.mockResolvedValue({} as any);
    await svc.updateClub('club-1', { name: 'X' });
    const arg = (prismaMock.club.update as jest.Mock).mock.calls[0][0];
    expect(arg.data.quickPaymentMethods).toBeUndefined();
  });

  it('getClubForAdmin sélectionne quickPaymentMethods', async () => {
    prismaMock.club.findUniqueOrThrow.mockResolvedValue({} as any);
    await svc.getClubForAdmin('club-1');
    const arg = (prismaMock.club.findUniqueOrThrow as jest.Mock).mock.calls[0][0];
    expect(arg.select.quickPaymentMethods).toBe(true);
  });
});
