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
// Table de marque — cœur partagé, appelé par les nouvelles routes J/A de cette Task 8.
// assertRefereeOwnsTournament (étage 2) est posée à la porte J/A depuis le fix de la faille
// d'autorisation : sans elle, n'importe quel J/A actif du club pouvait agir sur la table de
// marque de n'importe quel tournoi du club, pas seulement le sien.
const listMarkTable = jest.fn(), listMarkTableLog = jest.fn(), setPresence = jest.fn(),
  markTablePromote = jest.fn(), markTableRemove = jest.fn(), declareForfeit = jest.fn(),
  replacePlayer = jest.fn(), addToBench = jest.fn(), removeFromBench = jest.fn(),
  pairFromBench = jest.fn(), addLateRegistration = jest.fn(), assertRefereeOwnsTournament = jest.fn();
jest.mock('../../services/tournament.service', () => ({
  TournamentService: jest.fn().mockImplementation(() => ({
    resolveReferee, listRefereeTournaments, refereeListRegistrations,
    refereePromoteRegistration, refereeRemoveRegistration,
    listMarkTable, listMarkTableLog, setPresence, markTablePromote, markTableRemove,
    declareForfeit, replacePlayer, addToBench, removeFromBench, pairFromBench, addLateRegistration,
    assertRefereeOwnsTournament,
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

describe('table de marque — routes J/A', () => {
  beforeEach(() => {
    resolveReferee.mockResolvedValue(true);
    assertRefereeOwnsTournament.mockResolvedValue(undefined);
  });

  // LE test du gate : sans la facette, un J/A lambda ne lit RIEN de la table de marque.
  // Mutation-vérifié (cf. rapport) : retirer le `if (!resolveReferee...)` d'une route fait virer ce test au rouge.
  it('GET mark-table — 403 NOT_A_REFEREE sans la facette', async () => {
    resolveReferee.mockResolvedValue(false);
    const res = await request(app).get(`${base}/tournaments/t1/mark-table`).set(auth);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('NOT_A_REFEREE');
    expect(listMarkTable).not.toHaveBeenCalled();
  });

  it('GET mark-table — 200 avec la facette', async () => {
    listMarkTable.mockResolvedValue({ registrations: [] });
    const res = await request(app).get(`${base}/tournaments/t1/mark-table`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ registrations: [] });
    expect(listMarkTable).toHaveBeenCalledWith('club-1', 't1');
    expect(assertRefereeOwnsTournament).toHaveBeenCalledWith('t1', 'club-1', 'u-ref');
  });

  // Faille corrigée : la facette seule ne suffit pas — un J/A actif du club ne doit pas
  // pouvoir agir sur la table de marque d'un tournoi qui n'est pas le sien (étage 2, TOURNAMENT_NOT_YOURS).
  it('GET mark-table — 403 TOURNAMENT_NOT_YOURS si le tournoi n\'est pas le sien', async () => {
    assertRefereeOwnsTournament.mockRejectedValue(new Error('TOURNAMENT_NOT_YOURS'));
    const res = await request(app).get(`${base}/tournaments/t9/mark-table`).set(auth);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('TOURNAMENT_NOT_YOURS');
    expect(listMarkTable).not.toHaveBeenCalled();
  });

  it('POST forfeit — 403 TOURNAMENT_NOT_YOURS si le tournoi n\'est pas le sien', async () => {
    assertRefereeOwnsTournament.mockRejectedValue(new Error('TOURNAMENT_NOT_YOURS'));
    const res = await request(app)
      .post(`${base}/tournaments/t9/registrations/r1/forfeit`)
      .set(auth).send({ side: 'PARTNER' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('TOURNAMENT_NOT_YOURS');
    expect(declareForfeit).not.toHaveBeenCalled();
  });

  it('POST mark-table/registrations/:regId/promote — 403 TOURNAMENT_NOT_YOURS si le tournoi n\'est pas le sien', async () => {
    assertRefereeOwnsTournament.mockRejectedValue(new Error('TOURNAMENT_NOT_YOURS'));
    const res = await request(app).post(`${base}/tournaments/t9/mark-table/registrations/r1/promote`).set(auth);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('TOURNAMENT_NOT_YOURS');
    expect(markTablePromote).not.toHaveBeenCalled();
  });

  it('GET mark-table/log — 200, délègue listMarkTableLog', async () => {
    listMarkTableLog.mockResolvedValue([{ id: 'log-1' }]);
    const res = await request(app).get(`${base}/tournaments/t1/mark-table/log`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'log-1' }]);
    expect(listMarkTableLog).toHaveBeenCalledWith('club-1', 't1');
  });

  it('GET mark-table/log — 403 NOT_A_REFEREE sans la facette', async () => {
    resolveReferee.mockResolvedValue(false);
    const res = await request(app).get(`${base}/tournaments/t1/mark-table/log`).set(auth);
    expect(res.status).toBe(403);
    expect(listMarkTableLog).not.toHaveBeenCalled();
  });

  it('POST presence — délègue avec side+presence', async () => {
    setPresence.mockResolvedValue(undefined);
    const res = await request(app)
      .post(`${base}/tournaments/t1/registrations/r1/presence`)
      .set(auth).send({ side: 'CAPTAIN', presence: 'PRESENT' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(setPresence).toHaveBeenCalledWith('club-1', 't1', 'r1', 'CAPTAIN', 'PRESENT', 'u-ref');
  });

  it('POST presence — 400 VALIDATION_ERROR si side/presence invalides', async () => {
    const res = await request(app)
      .post(`${base}/tournaments/t1/registrations/r1/presence`)
      .set(auth).send({ side: 'REFEREE', presence: 'PRESENT' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
    expect(setPresence).not.toHaveBeenCalled();
  });

  it('POST forfeit — délègue avec side, remonte le résultat', async () => {
    declareForfeit.mockResolvedValue({ id: 'r1', status: 'CANCELLED' });
    const res = await request(app)
      .post(`${base}/tournaments/t1/registrations/r1/forfeit`)
      .set(auth).send({ side: 'PARTNER' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'r1', status: 'CANCELLED' });
    expect(declareForfeit).toHaveBeenCalledWith('club-1', 't1', 'r1', 'PARTNER', 'u-ref');
  });

  it('POST forfeit — 400 VALIDATION_ERROR si side invalide', async () => {
    const res = await request(app)
      .post(`${base}/tournaments/t1/registrations/r1/forfeit`)
      .set(auth).send({ side: 'NOBODY' });
    expect(res.status).toBe(400);
    expect(declareForfeit).not.toHaveBeenCalled();
  });

  it('POST replace — délègue side+newUserId', async () => {
    replacePlayer.mockResolvedValue(undefined);
    const res = await request(app)
      .post(`${base}/tournaments/t1/registrations/r1/replace`)
      .set(auth).send({ side: 'CAPTAIN', newUserId: 'u9' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(replacePlayer).toHaveBeenCalledWith('club-1', 't1', 'r1', 'CAPTAIN', 'u9', 'u-ref');
  });

  it('POST replace — GENDER_MISMATCH remonte 400', async () => {
    replacePlayer.mockRejectedValue(new Error('GENDER_MISMATCH'));
    const res = await request(app)
      .post(`${base}/tournaments/t1/registrations/r1/replace`)
      .set(auth).send({ side: 'CAPTAIN', newUserId: 'u9' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('GENDER_MISMATCH');
  });

  it('POST replace — 400 VALIDATION_ERROR si newUserId manquant', async () => {
    const res = await request(app)
      .post(`${base}/tournaments/t1/registrations/r1/replace`)
      .set(auth).send({ side: 'CAPTAIN' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
    expect(replacePlayer).not.toHaveBeenCalled();
  });

  it('POST bench — 201, délègue userId', async () => {
    addToBench.mockResolvedValue(undefined);
    const res = await request(app)
      .post(`${base}/tournaments/t1/bench`)
      .set(auth).send({ userId: 'u9' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true });
    expect(addToBench).toHaveBeenCalledWith('club-1', 't1', 'u9', 'u-ref');
  });

  it('POST bench — 400 VALIDATION_ERROR si userId manquant', async () => {
    const res = await request(app).post(`${base}/tournaments/t1/bench`).set(auth).send({});
    expect(res.status).toBe(400);
    expect(addToBench).not.toHaveBeenCalled();
  });

  it('POST bench — 409 ALREADY_ON_BENCH remonté', async () => {
    addToBench.mockRejectedValue(new Error('ALREADY_ON_BENCH'));
    const res = await request(app).post(`${base}/tournaments/t1/bench`).set(auth).send({ userId: 'u9' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('ALREADY_ON_BENCH');
  });

  it('DELETE bench/:userId — 200', async () => {
    removeFromBench.mockResolvedValue(undefined);
    const res = await request(app).delete(`${base}/tournaments/t1/bench/u9`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(removeFromBench).toHaveBeenCalledWith('club-1', 't1', 'u9', 'u-ref');
  });

  it('DELETE bench/:userId — 404 BENCH_ENTRY_NOT_FOUND remonté', async () => {
    removeFromBench.mockRejectedValue(new Error('BENCH_ENTRY_NOT_FOUND'));
    const res = await request(app).delete(`${base}/tournaments/t1/bench/u9`).set(auth);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('BENCH_ENTRY_NOT_FOUND');
  });

  it('DELETE bench/:userId — 403 NOT_A_REFEREE sans la facette', async () => {
    resolveReferee.mockResolvedValue(false);
    const res = await request(app).delete(`${base}/tournaments/t1/bench/u9`).set(auth);
    expect(res.status).toBe(403);
    expect(removeFromBench).not.toHaveBeenCalled();
  });

  it('POST bench/pair — 201, délègue userAId+userBId', async () => {
    pairFromBench.mockResolvedValue({ id: 'reg-new' });
    const res = await request(app)
      .post(`${base}/tournaments/t1/bench/pair`)
      .set(auth).send({ userAId: 'ua', userBId: 'ub' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 'reg-new' });
    expect(pairFromBench).toHaveBeenCalledWith('club-1', 't1', 'ua', 'ub', 'u-ref');
  });

  it('POST bench/pair — 400 VALIDATION_ERROR si un id manque', async () => {
    const res = await request(app).post(`${base}/tournaments/t1/bench/pair`).set(auth).send({ userAId: 'ua' });
    expect(res.status).toBe(400);
    expect(pairFromBench).not.toHaveBeenCalled();
  });

  it('POST registrations (binôme tardif) — 201, délègue captainUserId+partnerUserId', async () => {
    addLateRegistration.mockResolvedValue({ id: 'reg-late' });
    const res = await request(app)
      .post(`${base}/tournaments/t1/registrations`)
      .set(auth).send({ captainUserId: 'ua', partnerUserId: 'ub' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 'reg-late' });
    expect(addLateRegistration).toHaveBeenCalledWith('club-1', 't1', 'ua', 'ub', 'u-ref');
  });

  it('POST registrations (binôme tardif) — 400 VALIDATION_ERROR si partenaire manquant', async () => {
    const res = await request(app).post(`${base}/tournaments/t1/registrations`).set(auth).send({ captainUserId: 'ua' });
    expect(res.status).toBe(400);
    expect(addLateRegistration).not.toHaveBeenCalled();
  });

  it('POST mark-table/registrations/:regId/promote — 200, délègue markTablePromote', async () => {
    markTablePromote.mockResolvedValue({ id: 'r1', status: 'CONFIRMED' });
    const res = await request(app).post(`${base}/tournaments/t1/mark-table/registrations/r1/promote`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'r1', status: 'CONFIRMED' });
    expect(markTablePromote).toHaveBeenCalledWith('club-1', 't1', 'r1', 'u-ref');
  });

  it('POST mark-table/registrations/:regId/promote — 403 NOT_A_REFEREE sans la facette', async () => {
    resolveReferee.mockResolvedValue(false);
    const res = await request(app).post(`${base}/tournaments/t1/mark-table/registrations/r1/promote`).set(auth);
    expect(res.status).toBe(403);
    expect(markTablePromote).not.toHaveBeenCalled();
  });

  it('DELETE mark-table/registrations/:regId — 200, délègue markTableRemove', async () => {
    markTableRemove.mockResolvedValue({ cancelled: true });
    const res = await request(app).delete(`${base}/tournaments/t1/mark-table/registrations/r1`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ cancelled: true });
    expect(markTableRemove).toHaveBeenCalledWith('club-1', 't1', 'r1', 'u-ref');
  });

  it('DELETE mark-table/registrations/:regId — 403 NOT_A_REFEREE sans la facette', async () => {
    resolveReferee.mockResolvedValue(false);
    const res = await request(app).delete(`${base}/tournaments/t1/mark-table/registrations/r1`).set(auth);
    expect(res.status).toBe(403);
    expect(markTableRemove).not.toHaveBeenCalled();
  });

  it('sans token → 401 (mark-table)', async () => {
    const res = await request(app).get(`${base}/tournaments/t1/mark-table`);
    expect(res.status).toBe(401);
  });
});
