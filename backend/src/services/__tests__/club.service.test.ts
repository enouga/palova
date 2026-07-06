import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { ClubService } from '../club.service';

jest.mock('../geo.service', () => ({
  ...jest.requireActual('../geo.service'),
  geocodeAddress: jest.fn(),
}));
import { geocodeAddress } from '../geo.service';
const geocodeMock = geocodeAddress as jest.Mock;

describe('ClubService — recherche de membres', () => {
  let service: ClubService;
  beforeEach(() => {
    service = new ClubService();
    // Par défaut : aucun lien de suivi → iFollow/mutual = false sur tous les résultats
    prismaMock.follow.findMany.mockResolvedValue([] as any);
    // Par défaut : aucune amitié → friend = { status:'none', requestable:false } sur tous les résultats
    prismaMock.friendship.findMany.mockResolvedValue([] as any);
  });

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

    expect(result).toEqual([{ id: 'u1', firstName: 'Jean', lastName: 'Dupont', level: null, iFollow: false, mutual: false, friend: { status: 'none', requestable: false } }]);
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
      { id: 'u1', firstName: 'Jean', lastName: 'Dupont', level: null, iFollow: false, mutual: false, friend: { status: 'none', requestable: false } },
      { id: 'u2', firstName: 'Julie', lastName: 'Dupond', level: null, iFollow: false, mutual: false, friend: { status: 'none', requestable: false } },
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
      { id: 'u1', firstName: 'Jean', lastName: 'Dupont', level: { level: 5, tier: 'Confirmé', isProvisional: false, reliability: 93 }, iFollow: false, mutual: false, friend: { status: 'none', requestable: false } },
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

  it('annote chaque résultat avec iFollow / mutual', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findMany.mockResolvedValue([
      { user: { id: 'u2', firstName: 'Léa', lastName: 'M' } },
      { user: { id: 'u3', firstName: 'Tom', lastName: 'B' } },
    ] as any);
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-padel' } as any);
    prismaMock.playerRating.findMany.mockResolvedValue([] as any);
    // u2 : je le suis et il me suit (mutual) ; u3 : aucun lien
    prismaMock.follow.findMany.mockResolvedValue([
      { followerId: 'caller', followingId: 'u2' },
      { followerId: 'u2', followingId: 'caller' },
    ] as any);

    const result = await service.searchMembers('demo', 'caller', '');

    expect(result).toEqual([
      { id: 'u2', firstName: 'Léa', lastName: 'M', level: null, iFollow: true,  mutual: true,  friend: { status: 'none', requestable: false } },
      { id: 'u3', firstName: 'Tom', lastName: 'B', level: null, iFollow: false, mutual: false, friend: { status: 'none', requestable: false } },
    ]);
  });
});

describe('ClubService.searchMembers — annotation friend', () => {
  let svc: ClubService;
  beforeEach(() => {
    svc = new ClubService();
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findMany.mockResolvedValue([
      { user: { id: 'u2', firstName: 'Léa', lastName: 'M', acceptsFriendRequests: true } },
      { user: { id: 'u3', firstName: 'Tom', lastName: 'B', acceptsFriendRequests: false } },
    ] as any);
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-padel' } as any);
    prismaMock.playerRating.findMany.mockResolvedValue([] as any);
    prismaMock.follow.findMany.mockResolvedValue([] as any);
  });

  it('renvoie friend={status,requestable} par membre (opt-in reflété)', async () => {
    prismaMock.friendship.findMany.mockResolvedValue([
      { userAId: 'u1', userBId: 'u2', status: 'PENDING', requestedById: 'u1' },
    ] as any);
    const res = await svc.searchMembers('demo', 'u1', '');
    const byId = Object.fromEntries(res.map((r: any) => [r.id, r.friend]));
    expect(byId['u2']).toEqual({ status: 'pending_out', requestable: false });
    expect(byId['u3']).toEqual({ status: 'none', requestable: false }); // u3 opt-in OFF
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
    prismaMock.matchPlayer.findMany.mockResolvedValue([] as any);
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
    expect(res.me).toEqual({ optedIn: true, ranked: true, rank: 1, level: 6.2, matchesPlayed: 30, matchesToGo: 0, wins: 0, losses: 0, streak: 0 });
  });

  it('me non classé : opt-in mais pas assez de matchs → matchesToGo', async () => {
    mockBase();
    prismaMock.clubMembership.findMany.mockResolvedValue([] as any);
    prismaMock.user.findUnique.mockResolvedValue({ showInLeaderboard: true, playerRatings: [{ displayLevel: 3.4, matchesPlayed: 3 }] } as any);

    const res = await service.clubLeaderboard('padel-arena', 'u1', 'padel');
    expect(res.entries).toEqual([]);
    expect(res.me).toEqual({ optedIn: true, ranked: false, rank: null, level: 3.4, matchesPlayed: 3, matchesToGo: 2, wins: 0, losses: 0, streak: 0 });
  });

  it('me non opté : optedIn false, ranked false', async () => {
    mockBase();
    prismaMock.clubMembership.findMany.mockResolvedValue([] as any);
    prismaMock.user.findUnique.mockResolvedValue({ showInLeaderboard: false, playerRatings: [] } as any);

    const res = await service.clubLeaderboard('padel-arena', 'u1', 'padel');
    expect(res.me).toEqual({ optedIn: false, ranked: false, rank: null, level: null, matchesPlayed: 0, matchesToGo: 5, wins: 0, losses: 0, streak: 0 });
  });

  it('me : bilan V/D + série depuis les matchs du club', async () => {
    mockBase();
    prismaMock.clubMembership.findMany.mockResolvedValue([] as any);
    prismaMock.user.findUnique.mockResolvedValue({ showInLeaderboard: true, playerRatings: [{ displayLevel: 5.2, matchesPlayed: 25 }] } as any);
    // desc : 3 victoires récentes puis 1 défaite → wins 3, losses 1, streak 3
    prismaMock.matchPlayer.findMany.mockResolvedValue([
      { team: 1, match: { winningTeam: 1, playedAt: new Date('2026-06-05') } },
      { team: 1, match: { winningTeam: 1, playedAt: new Date('2026-06-04') } },
      { team: 1, match: { winningTeam: 1, playedAt: new Date('2026-06-03') } },
      { team: 1, match: { winningTeam: 2, playedAt: new Date('2026-06-02') } },
    ] as any);

    const res = await service.clubLeaderboard('padel-arena', 'u1', 'padel');
    expect(res.me).toEqual({ optedIn: true, ranked: false, rank: null, level: 5.2, matchesPlayed: 25, matchesToGo: 0, wins: 3, losses: 1, streak: 3 });
    // Scoping : requête matchPlayer filtrée club + sport + confirmés
    expect(prismaMock.matchPlayer.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'u1', match: { clubId: 'club-1', status: 'CONFIRMED', sportId: 'sport-padel' } },
    }));
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

describe('myClubMatchStats', () => {
  const service = new ClubService();
  beforeEach(() => jest.clearAllMocks());

  it('renvoie le bilan V/D + série du club (scopé club+sport+CONFIRMED)', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-1', status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-padel' } as any);
    // desc : W, W, L → wins 2, losses 1, streak 2
    prismaMock.matchPlayer.findMany.mockResolvedValue([
      { team: 1, match: { winningTeam: 1, playedAt: new Date('2026-06-05') } },
      { team: 1, match: { winningTeam: 1, playedAt: new Date('2026-06-04') } },
      { team: 1, match: { winningTeam: 2, playedAt: new Date('2026-06-03') } },
    ] as any);

    const res = await service.myClubMatchStats('arena', 'u1', 'padel');
    expect(res).toEqual({ wins: 2, losses: 1, streak: 2 });
    expect(prismaMock.matchPlayer.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'u1', match: { clubId: 'club-1', status: 'CONFIRMED', sportId: 'sport-padel' } },
    }));
  });

  it('non-membre → MEMBERSHIP_REQUIRED', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-1', status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue(null as any);
    await expect(service.myClubMatchStats('arena', 'uX', 'padel')).rejects.toThrow('MEMBERSHIP_REQUIRED');
  });

  it('club inconnu → CLUB_NOT_FOUND', async () => {
    prismaMock.club.findUnique.mockResolvedValue(null as any);
    await expect(service.myClubMatchStats('nope', 'u1', 'padel')).rejects.toThrow('CLUB_NOT_FOUND');
  });

  it('sport inconnu → SPORT_NOT_FOUND', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-1', status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);
    prismaMock.sport.findUnique.mockResolvedValue(null as any);
    await expect(service.myClubMatchStats('arena', 'u1', 'curling')).rejects.toThrow('SPORT_NOT_FOUND');
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

describe('club.service — persistance du département', () => {
  beforeEach(() => jest.clearAllMocks());

  it('createClub persiste department/departmentCode quand le géocodage réussit', async () => {
    geocodeMock.mockResolvedValue({
      latitude: 48.85, longitude: 2.35, region: 'Île-de-France', department: 'Paris', departmentCode: '75', postalCode: '75011', city: 'Paris',
    });
    prismaMock.clubSlugAlias.findUnique.mockResolvedValue(null as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.club.create.mockResolvedValue({ id: 'c1' } as any);
    prismaMock.clubMember.create.mockResolvedValue({} as any);

    const service = new ClubService();
    await service.createClub({ name: 'Test', address: '1 rue', city: 'Paris', ownerId: 'u1' } as any);

    const data = prismaMock.club.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ department: 'Paris', departmentCode: '75' });
  });
});

describe('ClubService — listClubs (géo)', () => {
  const service = new ClubService();
  const row = (over: Record<string, unknown>) => ({
    id: 'c', slug: 's', name: 'N', city: 'V', region: 'R', latitude: null, longitude: null,
    description: null, accentColor: '#000', logoUrl: null, coverImageUrl: null,
    clubSports: [], _count: { resources: 0 }, ...over,
  });

  it('filtre « city » matche ville OU région (contains, insensitive)', async () => {
    prismaMock.club.findMany.mockResolvedValue([] as any);
    await service.listClubs({ city: 'occ' });
    const arg = (prismaMock.club.findMany as jest.Mock).mock.calls[0][0];
    expect(arg.where.OR).toEqual([
      { city:   { contains: 'occ', mode: 'insensitive' } },
      { region: { contains: 'occ', mode: 'insensitive' } },
    ]);
  });

  it('trie par distance croissante quand lat/lng fournis ; clubs sans coords en dernier', async () => {
    prismaMock.club.findMany.mockResolvedValue([
      row({ id: 'lyon',  latitude: 45.764, longitude: 4.8357 }),
      row({ id: 'paris', latitude: 48.8566, longitude: 2.3522 }),
      row({ id: 'nocoord', latitude: null, longitude: null }),
    ] as any);
    const res = await service.listClubs({ lat: 48.86, lng: 2.35 }); // proche de Paris
    expect(res.map((c) => c.id)).toEqual(['paris', 'lyon', 'nocoord']);
  });

  it('expose latitude/longitude/region dans la projection', async () => {
    prismaMock.club.findMany.mockResolvedValue([row({ latitude: 1, longitude: 2 })] as any);
    const res = await service.listClubs({});
    expect(res[0]).toMatchObject({ latitude: 1, longitude: 2, region: 'R' });
  });
});

describe('ClubService — géocodage create/update', () => {
  const service = new ClubService();
  beforeEach(() => {
    geocodeMock.mockReset();
    // $transaction(cb) exécute le callback avec prismaMock comme tx.
    (prismaMock.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(prismaMock));
  });

  it('createClub géocode l\'adresse et persiste lat/long/region/postalCode', async () => {
    geocodeMock.mockResolvedValue({ latitude: 48.8, longitude: 2.3, region: 'Île-de-France', postalCode: '75011', city: 'Paris' });
    prismaMock.clubSlugAlias.findUnique.mockResolvedValue(null as any);
    prismaMock.club.create.mockResolvedValue({ id: 'c1' } as any);
    prismaMock.clubMember.create.mockResolvedValue({} as any);

    await service.createClub({ ownerId: 'o1', name: 'Le Padel', address: '12 rue X', city: 'Paris' });

    expect(geocodeMock).toHaveBeenCalledWith({ address: '12 rue X', city: 'Paris' });
    const data = (prismaMock.club.create as jest.Mock).mock.calls[0][0].data;
    expect(data).toMatchObject({ latitude: 48.8, longitude: 2.3, region: 'Île-de-France', postalCode: '75011' });
  });

  it('createClub : géocodage en échec → club créé sans coordonnées', async () => {
    geocodeMock.mockResolvedValue(null);
    prismaMock.clubSlugAlias.findUnique.mockResolvedValue(null as any);
    prismaMock.club.create.mockResolvedValue({ id: 'c1' } as any);
    prismaMock.clubMember.create.mockResolvedValue({} as any);

    await service.createClub({ ownerId: 'o1', name: 'Le Padel', address: '12 rue X', city: 'Paris' });

    const data = (prismaMock.club.create as jest.Mock).mock.calls[0][0].data;
    expect(data.latitude).toBeUndefined();
  });

  it('updateClub re-géocode quand l\'adresse change', async () => {
    geocodeMock.mockResolvedValue({ latitude: 1, longitude: 2, region: 'R', postalCode: '12345', city: 'V' });
    prismaMock.club.findUnique.mockResolvedValue({ address: 'ancienne', city: 'V' } as any);
    prismaMock.club.update.mockResolvedValue({} as any);

    await service.updateClub('c1', { address: 'nouvelle' });

    expect(geocodeMock).toHaveBeenCalled();
    const data = (prismaMock.club.update as jest.Mock).mock.calls[0][0].data;
    expect(data).toMatchObject({ latitude: 1, longitude: 2, region: 'R', postalCode: '12345' });
  });

  it('updateClub ne géocode pas si l\'adresse est inchangée', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ address: 'pareille', city: 'V' } as any);
    prismaMock.club.update.mockResolvedValue({} as any);

    await service.updateClub('c1', { address: 'pareille', city: 'V' });

    expect(geocodeMock).not.toHaveBeenCalled();
  });
});

describe('clubTopOfMonth', () => {
  let service: ClubService;
  beforeEach(() => { service = new ClubService(); });

  it('agrège les victoires du mois courant et renvoie le top 3', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'c1', status: 'ACTIVE', timezone: 'Europe/Paris' } as any);
    const mk = (userId: string, team: number, winningTeam: number, name: string) => ({
      userId, team, match: { winningTeam },
      user: { firstName: name, lastName: 'X', avatarUrl: null },
    });
    prismaMock.matchPlayer.findMany.mockResolvedValue([
      mk('u1', 1, 1, 'Ana'), mk('u1', 1, 1, 'Ana'), mk('u1', 2, 1, 'Ana'), // 2 victoires
      mk('u2', 1, 1, 'Bob'), mk('u2', 2, 2, 'Bob'), mk('u2', 1, 1, 'Bob'), // 3 victoires
      mk('u3', 2, 2, 'Cléo'),                                              // 1 victoire
      mk('u4', 1, 2, 'Dan'),                                               // 0 victoire
    ] as any);
    const top = await service.clubTopOfMonth('slug');
    expect(top.map((t) => [t.userId, t.wins])).toEqual([['u2', 3], ['u1', 2], ['u3', 1]]);
    // fenêtre mensuelle passée au filtre playedAt
    expect(prismaMock.matchPlayer.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        match: expect.objectContaining({ clubId: 'c1', status: 'CONFIRMED', playedAt: expect.objectContaining({ gte: expect.any(Date), lt: expect.any(Date) }) }),
      }),
    }));
  });

  it('renvoie jusqu\'à 10 joueurs classés (pas seulement le podium)', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'c1', status: 'ACTIVE', timezone: 'Europe/Paris' } as any);
    const mk = (userId: string, wins: number) =>
      Array.from({ length: wins }, () => ({ userId, team: 1, match: { winningTeam: 1 }, user: { firstName: userId, lastName: 'X', avatarUrl: null } }));
    // 12 joueurs avec au moins 1 victoire chacun, décroissant.
    const rows = Array.from({ length: 12 }, (_, i) => mk(`u${i}`, 12 - i)).flat();
    prismaMock.matchPlayer.findMany.mockResolvedValue(rows as any);
    const top = await service.clubTopOfMonth('slug');
    expect(top).toHaveLength(10);
    expect(top[0].userId).toBe('u0');
    expect(top[9].userId).toBe('u9');
  });

  it('moins de 3 joueurs avec une victoire → liste vide (section masquée)', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'c1', status: 'ACTIVE', timezone: 'Europe/Paris' } as any);
    prismaMock.matchPlayer.findMany.mockResolvedValue([
      { userId: 'u1', team: 1, match: { winningTeam: 1 }, user: { firstName: 'A', lastName: 'B', avatarUrl: null } },
    ] as any);
    expect(await service.clubTopOfMonth('slug')).toEqual([]);
  });
});

describe('normalizeClubHouseSections', () => {
  const { normalizeClubHouseSections } = require('../club.service');
  const { Prisma } = require('@prisma/client');

  it('garde les entrées valides dans l\'ordre fourni et complète les clés manquantes en fin (visibles)', () => {
    expect(normalizeClubHouseSections([
      { key: 'top', visible: false },
      { key: 'matches', visible: true },
    ])).toEqual([
      { key: 'top', visible: false },
      { key: 'matches', visible: true },
      { key: 'agenda', visible: true },
      { key: 'posters', visible: true },
      { key: 'offers', visible: true },
      { key: 'clubCard', visible: true },
      { key: 'announcements', visible: true },
      { key: 'sponsors', visible: true },
    ]);
  });

  it('rejette les clés inconnues et dédoublonne (première occurrence gagne)', () => {
    const out = normalizeClubHouseSections([
      { key: 'hero', visible: false },
      { key: 'matches', visible: false },
      { key: 'matches', visible: true },
      'nimporte',
    ]) as { key: string; visible: boolean }[];
    expect(out.find((e) => e.key === 'matches')).toEqual({ key: 'matches', visible: false });
    expect(out.some((e) => e.key === 'hero')).toBe(false);
    expect(out).toHaveLength(8);
  });

  it('visible absent ou non-false → true', () => {
    const out = normalizeClubHouseSections([{ key: 'agenda' }]) as { key: string; visible: boolean }[];
    expect(out[0]).toEqual({ key: 'agenda', visible: true });
  });

  it('non-tableau ou rien de valide → DbNull (reset)', () => {
    expect(normalizeClubHouseSections(null)).toBe(Prisma.DbNull);
    expect(normalizeClubHouseSections('x')).toBe(Prisma.DbNull);
    expect(normalizeClubHouseSections([])).toBe(Prisma.DbNull);
    expect(normalizeClubHouseSections([{ key: 'inconnu', visible: true }])).toBe(Prisma.DbNull);
  });
});

describe('ClubService — sections du Club-house', () => {
  let svc: ClubService;
  beforeEach(() => { svc = new ClubService(); });

  it('updateClub écrit la config normalisée (complète, clés inconnues rejetées)', async () => {
    prismaMock.club.update.mockResolvedValue({} as any);
    await svc.updateClub('club-1', { clubHouseSections: [{ key: 'top', visible: false }, { key: 'nope', visible: true }] } as any);
    const arg = (prismaMock.club.update as jest.Mock).mock.calls[0][0];
    expect(arg.data.clubHouseSections[0]).toEqual({ key: 'top', visible: false });
    expect(arg.data.clubHouseSections).toHaveLength(8);
    expect((arg.data.clubHouseSections as any[]).some((e) => e.key === 'nope')).toBe(false);
  });

  it('updateClub null → DbNull (retour à l\'ordre adaptatif)', async () => {
    const { Prisma } = require('@prisma/client');
    prismaMock.club.update.mockResolvedValue({} as any);
    await svc.updateClub('club-1', { clubHouseSections: null } as any);
    const arg = (prismaMock.club.update as jest.Mock).mock.calls[0][0];
    expect(arg.data.clubHouseSections).toBe(Prisma.DbNull);
  });

  it('getClubBySlug expose clubHouseSections', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ status: 'ACTIVE', clubSports: [] } as any);
    await svc.getClubBySlug('demo');
    const arg = (prismaMock.club.findUnique as jest.Mock).mock.calls[0][0];
    expect(arg.select.clubHouseSections).toBe(true);
  });

  it('getClubForAdmin expose clubHouseSections', async () => {
    prismaMock.club.findUniqueOrThrow.mockResolvedValue({} as any);
    await svc.getClubForAdmin('club-1');
    const arg = (prismaMock.club.findUniqueOrThrow as jest.Mock).mock.calls[0][0];
    expect(arg.select.clubHouseSections).toBe(true);
  });
});

describe('ClubService — listMembers (rôle staff)', () => {
  let service: ClubService;
  beforeEach(() => { service = new ClubService(); });

  it('expose staffRole depuis club_members (null pour un membre simple), en 1 requête', async () => {
    prismaMock.clubMembership.findMany.mockResolvedValue([
      { id: 'm1', isSubscriber: false, membershipNo: null, status: 'ACTIVE', note: null, watch: false, createdAt: new Date('2026-01-01'),
        user: { id: 'u1', firstName: 'Olivia', lastName: 'Gerante', email: 'o@x.fr', phone: null } },
      { id: 'm2', isSubscriber: false, membershipNo: null, status: 'ACTIVE', note: null, watch: false, createdAt: new Date('2026-01-02'),
        user: { id: 'u2', firstName: 'Paul', lastName: 'Martin', email: 'p@x.fr', phone: null } },
    ] as any);
    prismaMock.clubMember.findMany.mockResolvedValue([{ userId: 'u1', role: 'OWNER' }] as any);

    const rows = await service.listMembers('club-demo');

    expect(rows[0].staffRole).toBe('OWNER');
    expect(rows[1].staffRole).toBeNull();
    // une seule requête staff pour tout le club (pas de N+1)
    expect(prismaMock.clubMember.findMany).toHaveBeenCalledWith({ where: { clubId: 'club-demo' }, select: { userId: true, role: true } });
  });
});

describe('ClubService — setMemberStaffRole', () => {
  let service: ClubService;
  beforeEach(() => {
    service = new ClubService();
    // Par défaut : la cible est dans le fichier-membres, sans rôle staff actuel.
    prismaMock.clubMembership.findUnique.mockResolvedValue({ id: 'mb1' } as any);
    prismaMock.clubMember.findUnique.mockResolvedValue(null as any);
    prismaMock.clubMember.upsert.mockResolvedValue({} as any);
    prismaMock.clubMember.deleteMany.mockResolvedValue({ count: 1 } as any);
  });

  it('promeut un membre en STAFF (upsert)', async () => {
    const r = await service.setMemberStaffRole('club-demo', 'actor', 'u9', 'STAFF');
    expect(r).toEqual({ userId: 'u9', staffRole: 'STAFF' });
    expect(prismaMock.clubMember.upsert).toHaveBeenCalledWith({
      where: { userId_clubId: { userId: 'u9', clubId: 'club-demo' } },
      update: { role: 'STAFF' },
      create: { userId: 'u9', clubId: 'club-demo', role: 'STAFF' },
    });
  });

  it('promeut un membre en ADMIN (upsert, y compris depuis STAFF)', async () => {
    prismaMock.clubMember.findUnique.mockResolvedValue({ role: 'STAFF' } as any);
    const r = await service.setMemberStaffRole('club-demo', 'actor', 'u9', 'ADMIN');
    expect(r).toEqual({ userId: 'u9', staffRole: 'ADMIN' });
    expect(prismaMock.clubMember.upsert).toHaveBeenCalledWith({
      where: { userId_clubId: { userId: 'u9', clubId: 'club-demo' } },
      update: { role: 'ADMIN' },
      create: { userId: 'u9', clubId: 'club-demo', role: 'ADMIN' },
    });
  });

  it('révoque (role null) via deleteMany non-OWNER — idempotent (0 ligne = OK)', async () => {
    prismaMock.clubMember.deleteMany.mockResolvedValue({ count: 0 } as any);
    const r = await service.setMemberStaffRole('club-demo', 'actor', 'u9', null);
    expect(r).toEqual({ userId: 'u9', staffRole: null });
    expect(prismaMock.clubMember.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u9', clubId: 'club-demo', role: { not: 'OWNER' } },
    });
    expect(prismaMock.clubMember.upsert).not.toHaveBeenCalled();
  });

  it('refuse un rôle invalide (VALIDATION_ERROR), y compris OWNER et undefined', async () => {
    await expect(service.setMemberStaffRole('club-demo', 'actor', 'u9', 'SUPER' as any)).rejects.toThrow('VALIDATION_ERROR');
    await expect(service.setMemberStaffRole('club-demo', 'actor', 'u9', 'OWNER' as any)).rejects.toThrow('VALIDATION_ERROR');
    await expect(service.setMemberStaffRole('club-demo', 'actor', 'u9', undefined as any)).rejects.toThrow('VALIDATION_ERROR');
  });

  it('refuse de modifier son propre rôle (CANNOT_CHANGE_SELF)', async () => {
    await expect(service.setMemberStaffRole('club-demo', 'u9', 'u9', 'ADMIN')).rejects.toThrow('CANNOT_CHANGE_SELF');
    expect(prismaMock.clubMember.upsert).not.toHaveBeenCalled();
  });

  it('refuse une cible hors fichier-membres (MEMBER_NOT_FOUND)', async () => {
    prismaMock.clubMembership.findUnique.mockResolvedValue(null as any);
    await expect(service.setMemberStaffRole('club-demo', 'actor', 'u9', 'STAFF')).rejects.toThrow('MEMBER_NOT_FOUND');
  });

  it('refuse de toucher un OWNER (CANNOT_CHANGE_OWNER)', async () => {
    prismaMock.clubMember.findUnique.mockResolvedValue({ role: 'OWNER' } as any);
    await expect(service.setMemberStaffRole('club-demo', 'actor', 'u9', 'STAFF')).rejects.toThrow('CANNOT_CHANGE_OWNER');
    expect(prismaMock.clubMember.upsert).not.toHaveBeenCalled();
    expect(prismaMock.clubMember.deleteMany).not.toHaveBeenCalled();
  });
});

describe('ClubService — removeMember (membre détenant un rôle staff)', () => {
  beforeEach(() => {
    prismaMock.clubMembership.findUnique.mockResolvedValue({ clubId: 'club-demo', userId: 'u9' } as any);
    // $transaction interactif : exécute le callback avec le mock comme tx
    prismaMock.$transaction.mockImplementation(((cb: any) => cb(prismaMock)) as any);
  });

  it('refuse de retirer un membre qui détient un rôle staff (MEMBER_IS_STAFF)', async () => {
    prismaMock.clubMember.findUnique.mockResolvedValue({ role: 'ADMIN' } as any);
    await expect(new ClubService().removeMember('club-demo', 'mb1')).rejects.toThrow('MEMBER_IS_STAFF');
    expect(prismaMock.clubMembership.delete).not.toHaveBeenCalled();
  });

  it('retire un membre simple (aucune ligne ClubMember)', async () => {
    prismaMock.clubMember.findUnique.mockResolvedValue(null as any);
    prismaMock.clubMembership.delete.mockResolvedValue({} as any);
    await new ClubService().removeMember('club-demo', 'mb1');
    expect(prismaMock.clubMember.findUnique).toHaveBeenCalledWith({
      where: { userId_clubId: { userId: 'u9', clubId: 'club-demo' } }, select: { role: true },
    });
    expect(prismaMock.clubMembership.delete).toHaveBeenCalledWith({ where: { id: 'mb1' } });
  });
});
