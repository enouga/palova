import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';

// --- Scaffold : mocks des services à effets de bord au chargement de clubs.ts ---
// (copiés VERBATIM depuis clubs.coach.routes.test.ts)
jest.mock('../../services/openMatch.service', () => ({
  OpenMatchService: jest.fn().mockImplementation(() => ({
    listOpenMatches:       jest.fn().mockResolvedValue([]),
    getOpenMatch:          jest.fn().mockResolvedValue({ id: 'match-1' }),
    joinOpenMatch:         jest.fn().mockResolvedValue({}),
    leaveOpenMatch:        jest.fn().mockResolvedValue({}),
    removeOpenMatchPlayer: jest.fn().mockResolvedValue({}),
    addOpenMatchPlayer:    jest.fn().mockResolvedValue({}),
    setTeams:              jest.fn().mockResolvedValue({ id: 'match-1' }),
  })),
}));

jest.mock('../../services/openMatchChat.service', () => ({
  OpenMatchChatService: jest.fn().mockImplementation(() => ({
    assertChatAccessPublic: jest.fn().mockResolvedValue(undefined),
    listMessages:           jest.fn().mockResolvedValue([]),
    postMessage:            jest.fn().mockResolvedValue({}),
    deleteMessage:          jest.fn().mockResolvedValue({}),
    markRead:               jest.fn().mockResolvedValue({ count: 0 }),
    unreadCount:            jest.fn().mockResolvedValue({ count: 0 }),
  })),
}));

jest.mock('../../services/moderation.service', () => ({
  ModerationService: jest.fn().mockImplementation(() => ({
    reportOpenMatchMessage: jest.fn().mockResolvedValue({ id: 'rep-1' }),
  })),
}));

// --- Mock ciblé : TournamentService (classe instanciée au chargement de clubs.ts) ---
const resolveReferee = jest.fn(), listRefereeTournaments = jest.fn(), refereeListRegistrations = jest.fn(),
  refereePromoteRegistration = jest.fn(), refereeRemoveRegistration = jest.fn();
jest.mock('../../services/tournament.service', () => ({
  TournamentService: jest.fn().mockImplementation(() => ({
    resolveReferee, listRefereeTournaments, refereeListRegistrations,
    refereePromoteRegistration, refereeRemoveRegistration,
    listPublicByClubSlug: jest.fn().mockResolvedValue([]),
  })),
}));

// --- Mock ciblé : lessonService (l'autre facette lue par /me/facets) ---
const resolveCoach = jest.fn();
jest.mock('../../services/lesson.service', () => ({
  lessonService: { resolveCoach, listPublicByClubSlug: jest.fn().mockResolvedValue([]) },
}));

// --- Mock ciblé : ensureActiveMembership (résout le club + adhésion) ---
jest.mock('../../services/membership', () => ({
  ensureActiveMembership: jest.fn().mockResolvedValue({ id: 'club-1' }),
}));

import app from '../../app';

const SECRET = process.env.JWT_SECRET!;
if (!SECRET) throw new Error('JWT_SECRET manquant');
const token = jwt.sign({ id: 'u-ref', email: 'r@x.fr' }, SECRET, { expiresIn: '1h' });
const auth = { Authorization: `Bearer ${token}` };
const base = '/api/clubs/demo/me/referee';

beforeEach(() => { jest.clearAllMocks(); });

describe('GET /me/facets', () => {
  it('reflète les DEUX facettes (coach + J/A) en un seul aller-retour', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-1', status: 'ACTIVE' } as any);
    resolveCoach.mockResolvedValue({ id: 'coach-1' });
    resolveReferee.mockResolvedValue(true);
    const res = await request(app).get('/api/clubs/demo/me/facets').set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ isCoach: true, isReferee: true });
  });

  it('renvoie les deux facettes à false pour un membre lambda', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-1', status: 'ACTIVE' } as any);
    resolveCoach.mockResolvedValue(null);
    resolveReferee.mockResolvedValue(false);
    const res = await request(app).get('/api/clubs/demo/me/facets').set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ isCoach: false, isReferee: false });
  });

  it('distingue les facettes : J/A sans être coach', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-1', status: 'ACTIVE' } as any);
    resolveCoach.mockResolvedValue(null);
    resolveReferee.mockResolvedValue(true);
    const res = await request(app).get('/api/clubs/demo/me/facets').set(auth);
    expect(res.body).toEqual({ isCoach: false, isReferee: true });
  });

  // Le menu ne doit jamais bruiter : un club inconnu/inactif rend un signal négatif, pas une erreur.
  it('club inconnu → 200 { false, false } (jamais 404/403)', async () => {
    prismaMock.club.findUnique.mockResolvedValue(null as any);
    const res = await request(app).get('/api/clubs/nope/me/facets').set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ isCoach: false, isReferee: false });
  });

  it('club inactif → 200 { false, false } (jamais 404/403)', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-1', status: 'SUSPENDED' } as any);
    const res = await request(app).get('/api/clubs/demo/me/facets').set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ isCoach: false, isReferee: false });
    expect(resolveReferee).not.toHaveBeenCalled();
  });

  it('sans token → 401', async () => {
    const res = await request(app).get('/api/clubs/demo/me/facets');
    expect(res.status).toBe(401);
  });
});

describe('Routes espace juge-arbitre', () => {
  // LE test du gate : sans la facette, un membre lambda ne lit RIEN de l'espace J/A.
  // Si la ligne resolveReferee saute d'une route, ce test doit virer au rouge.
  it('GET /me/referee/tournaments → 403 NOT_A_REFEREE sans la facette', async () => {
    resolveReferee.mockResolvedValue(false);
    const res = await request(app).get(`${base}/tournaments`).set(auth);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('NOT_A_REFEREE');
    expect(listRefereeTournaments).not.toHaveBeenCalled();
  });

  it('GET /me/referee/tournaments → 200 + liste, scope upcoming par défaut', async () => {
    resolveReferee.mockResolvedValue(true);
    listRefereeTournaments.mockResolvedValue([{ id: 'trn-1' }]);
    const res = await request(app).get(`${base}/tournaments`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'trn-1' }]);
    expect(listRefereeTournaments).toHaveBeenCalledWith('club-1', 'u-ref', 'upcoming');
  });

  it('GET /me/referee/tournaments?scope=past → délègue avec past', async () => {
    resolveReferee.mockResolvedValue(true);
    listRefereeTournaments.mockResolvedValue([]);
    const res = await request(app).get(`${base}/tournaments?scope=past`).set(auth);
    expect(res.status).toBe(200);
    expect(listRefereeTournaments).toHaveBeenCalledWith('club-1', 'u-ref', 'past');
  });

  it('GET registrations → 403 NOT_A_REFEREE sans la facette', async () => {
    resolveReferee.mockResolvedValue(false);
    const res = await request(app).get(`${base}/tournaments/trn-1/registrations`).set(auth);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('NOT_A_REFEREE');
    expect(refereeListRegistrations).not.toHaveBeenCalled();
  });

  it('GET registrations → 200 + roster (délègue refereeListRegistrations)', async () => {
    resolveReferee.mockResolvedValue(true);
    refereeListRegistrations.mockResolvedValue([{ id: 'reg-1' }]);
    const res = await request(app).get(`${base}/tournaments/trn-1/registrations`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'reg-1' }]);
    expect(refereeListRegistrations).toHaveBeenCalledWith('club-1', 'u-ref', 'trn-1');
  });

  it('GET registrations → 404 TOURNAMENT_NOT_FOUND remonté', async () => {
    resolveReferee.mockResolvedValue(true);
    refereeListRegistrations.mockRejectedValue(new Error('TOURNAMENT_NOT_FOUND'));
    const res = await request(app).get(`${base}/tournaments/trn-x/registrations`).set(auth);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('TOURNAMENT_NOT_FOUND');
  });

  it('POST promote → 200 (délègue refereePromoteRegistration)', async () => {
    resolveReferee.mockResolvedValue(true);
    refereePromoteRegistration.mockResolvedValue({ id: 'reg-1', status: 'CONFIRMED' });
    const res = await request(app).post(`${base}/tournaments/trn-1/registrations/reg-1/promote`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'reg-1', status: 'CONFIRMED' });
    expect(refereePromoteRegistration).toHaveBeenCalledWith('club-1', 'u-ref', 'trn-1', 'reg-1');
  });

  it('POST promote → 403 NOT_A_REFEREE sans la facette', async () => {
    resolveReferee.mockResolvedValue(false);
    const res = await request(app).post(`${base}/tournaments/trn-1/registrations/reg-1/promote`).set(auth);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('NOT_A_REFEREE');
    expect(refereePromoteRegistration).not.toHaveBeenCalled();
  });

  it('DELETE registration → 200 (délègue refereeRemoveRegistration)', async () => {
    resolveReferee.mockResolvedValue(true);
    refereeRemoveRegistration.mockResolvedValue({ cancelled: true, promotedRegistrationId: null });
    const res = await request(app).delete(`${base}/tournaments/trn-1/registrations/reg-1`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ cancelled: true, promotedRegistrationId: null });
    expect(refereeRemoveRegistration).toHaveBeenCalledWith('club-1', 'u-ref', 'trn-1', 'reg-1');
  });

  // La facette ne suffit pas : le tournoi d'un AUTRE J/A reste fermé (gate = propriété).
  it('DELETE registration → 403 TOURNAMENT_NOT_YOURS remonté', async () => {
    resolveReferee.mockResolvedValue(true);
    refereeRemoveRegistration.mockRejectedValue(new Error('TOURNAMENT_NOT_YOURS'));
    const res = await request(app).delete(`${base}/tournaments/trn-9/registrations/reg-1`).set(auth);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('TOURNAMENT_NOT_YOURS');
  });

  it('DELETE registration → 403 NOT_A_REFEREE sans la facette', async () => {
    resolveReferee.mockResolvedValue(false);
    const res = await request(app).delete(`${base}/tournaments/trn-1/registrations/reg-1`).set(auth);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('NOT_A_REFEREE');
    expect(refereeRemoveRegistration).not.toHaveBeenCalled();
  });

  it('sans token → 401', async () => {
    const res = await request(app).get(`${base}/tournaments`);
    expect(res.status).toBe(401);
  });
});
