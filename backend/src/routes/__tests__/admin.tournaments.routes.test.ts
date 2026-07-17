import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';

// --- Mock ciblé : TournamentService (classe instanciée au chargement d'admin.ts) ---
// Miroir exact de clubs.referee.routes.test.ts (Task 8) — mêmes méthodes du cœur partagé,
// ici appelées SANS le gate resolveReferee (le routeur admin gate STAFF globalement).
const listMarkTable = jest.fn(), listMarkTableLog = jest.fn(), setPresence = jest.fn(),
  markTablePromote = jest.fn(), markTableRemove = jest.fn(), declareForfeit = jest.fn(),
  replacePlayer = jest.fn(), addToBench = jest.fn(), removeFromBench = jest.fn(),
  pairFromBench = jest.fn(), addLateRegistration = jest.fn();
jest.mock('../../services/tournament.service', () => ({
  TournamentService: jest.fn().mockImplementation(() => ({
    listMarkTable, listMarkTableLog, setPresence, markTablePromote, markTableRemove,
    declareForfeit, replacePlayer, addToBench, removeFromBench, pairFromBench, addLateRegistration,
  })),
}));

import app from '../../app';

const SECRET = process.env.JWT_SECRET!;
if (!SECRET) throw new Error('JWT_SECRET manquant');
const token = jwt.sign({ id: 'staff-1', email: 'staff@x.fr' }, SECRET, { expiresIn: '1h' });
const auth = { Authorization: `Bearer ${token}` };
const base = '/api/clubs/club-1/admin';

// Garde du routeur admin : requireClubMember('STAFF') lit clubMember.findUnique.
// Ces routes doivent rester accessibles à un simple STAFF (pas de gate ADMIN ajouté).
beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.clubMember.findUnique.mockResolvedValue({ userId: 'staff-1', clubId: 'club-1', role: 'STAFF' } as any);
});

describe('table de marque — routes staff', () => {
  it('GET mark-table — délègue au service (clubId, tournamentId)', async () => {
    listMarkTable.mockResolvedValue({ registrations: [] });
    const res = await request(app).get(`${base}/tournaments/t1/mark-table`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ registrations: [] });
    expect(listMarkTable).toHaveBeenCalledWith('club-1', 't1');
  });

  it('GET mark-table — sans token → 401', async () => {
    const res = await request(app).get(`${base}/tournaments/t1/mark-table`);
    expect(res.status).toBe(401);
    expect(listMarkTable).not.toHaveBeenCalled();
  });

  it('GET mark-table — 404 TOURNAMENT_NOT_FOUND remonté', async () => {
    listMarkTable.mockRejectedValue(new Error('TOURNAMENT_NOT_FOUND'));
    const res = await request(app).get(`${base}/tournaments/t9/mark-table`).set(auth);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('TOURNAMENT_NOT_FOUND');
  });

  it('GET mark-table/log — délègue au service (clubId, tournamentId)', async () => {
    listMarkTableLog.mockResolvedValue([{ id: 'log-1' }]);
    const res = await request(app).get(`${base}/tournaments/t1/mark-table/log`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'log-1' }]);
    expect(listMarkTableLog).toHaveBeenCalledWith('club-1', 't1');
  });

  it('POST presence — délègue avec side+presence+actorUserId, dans cet ordre', async () => {
    setPresence.mockResolvedValue(undefined);
    const res = await request(app)
      .post(`${base}/tournaments/t1/registrations/r1/presence`)
      .set(auth).send({ side: 'CAPTAIN', presence: 'PRESENT' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(setPresence).toHaveBeenCalledWith('club-1', 't1', 'r1', 'CAPTAIN', 'PRESENT', 'staff-1');
  });

  it('POST presence — 400 VALIDATION_ERROR si side/presence invalides', async () => {
    const res = await request(app)
      .post(`${base}/tournaments/t1/registrations/r1/presence`)
      .set(auth).send({ side: 'REFEREE', presence: 'PRESENT' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
    expect(setPresence).not.toHaveBeenCalled();
  });

  it('POST forfeit — délègue avec (clubId, tournamentId, regId, side, actorUserId)', async () => {
    declareForfeit.mockResolvedValue({ id: 'r1', status: 'CANCELLED' });
    const res = await request(app)
      .post(`${base}/tournaments/t1/registrations/r1/forfeit`)
      .set(auth).send({ side: 'PARTNER' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'r1', status: 'CANCELLED' });
    expect(declareForfeit).toHaveBeenCalledWith('club-1', 't1', 'r1', 'PARTNER', 'staff-1');
  });

  it('POST forfeit — 400 VALIDATION_ERROR si side invalide', async () => {
    const res = await request(app)
      .post(`${base}/tournaments/t1/registrations/r1/forfeit`)
      .set(auth).send({ side: 'NOBODY' });
    expect(res.status).toBe(400);
    expect(declareForfeit).not.toHaveBeenCalled();
  });

  it('POST replace — délègue avec (clubId, tournamentId, regId, side, newUserId, actorUserId)', async () => {
    replacePlayer.mockResolvedValue(undefined);
    const res = await request(app)
      .post(`${base}/tournaments/t1/registrations/r1/replace`)
      .set(auth).send({ side: 'CAPTAIN', newUserId: 'u9' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(replacePlayer).toHaveBeenCalledWith('club-1', 't1', 'r1', 'CAPTAIN', 'u9', 'staff-1');
  });

  it('POST replace — 400 VALIDATION_ERROR si newUserId manquant', async () => {
    const res = await request(app)
      .post(`${base}/tournaments/t1/registrations/r1/replace`)
      .set(auth).send({ side: 'CAPTAIN' });
    expect(res.status).toBe(400);
    expect(replacePlayer).not.toHaveBeenCalled();
  });

  it('POST replace — GENDER_MISMATCH remonté 400 (nouveau code ERROR_STATUS)', async () => {
    replacePlayer.mockRejectedValue(new Error('GENDER_MISMATCH'));
    const res = await request(app)
      .post(`${base}/tournaments/t1/registrations/r1/replace`)
      .set(auth).send({ side: 'CAPTAIN', newUserId: 'u9' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('GENDER_MISMATCH');
  });

  it('POST replace — SEX_REQUIRED remonté 400 (nouveau code ERROR_STATUS)', async () => {
    replacePlayer.mockRejectedValue(new Error('SEX_REQUIRED'));
    const res = await request(app)
      .post(`${base}/tournaments/t1/registrations/r1/replace`)
      .set(auth).send({ side: 'CAPTAIN', newUserId: 'u9' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('SEX_REQUIRED');
  });

  it('POST replace — NOT_A_MEMBER remonté (nouveau code ERROR_STATUS, distinct de MEMBER_NOT_FOUND)', async () => {
    replacePlayer.mockRejectedValue(new Error('NOT_A_MEMBER'));
    const res = await request(app)
      .post(`${base}/tournaments/t1/registrations/r1/replace`)
      .set(auth).send({ side: 'CAPTAIN', newUserId: 'u9' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NOT_A_MEMBER');
  });

  it('POST bench — 201, délègue (clubId, tournamentId, userId, actorUserId)', async () => {
    addToBench.mockResolvedValue(undefined);
    const res = await request(app)
      .post(`${base}/tournaments/t1/bench`)
      .set(auth).send({ userId: 'u9' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true });
    expect(addToBench).toHaveBeenCalledWith('club-1', 't1', 'u9', 'staff-1');
  });

  it('POST bench — 400 VALIDATION_ERROR si userId manquant', async () => {
    const res = await request(app).post(`${base}/tournaments/t1/bench`).set(auth).send({});
    expect(res.status).toBe(400);
    expect(addToBench).not.toHaveBeenCalled();
  });

  it('POST bench — 409 ALREADY_ON_BENCH remonté (nouveau code ERROR_STATUS)', async () => {
    addToBench.mockRejectedValue(new Error('ALREADY_ON_BENCH'));
    const res = await request(app).post(`${base}/tournaments/t1/bench`).set(auth).send({ userId: 'u9' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('ALREADY_ON_BENCH');
  });

  it('POST bench — 409 ALREADY_REGISTERED remonté (nouveau code ERROR_STATUS)', async () => {
    addToBench.mockRejectedValue(new Error('ALREADY_REGISTERED'));
    const res = await request(app).post(`${base}/tournaments/t1/bench`).set(auth).send({ userId: 'u9' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('ALREADY_REGISTERED');
  });

  it('DELETE bench/:userId — 200, délègue (clubId, tournamentId, userId, actorUserId)', async () => {
    removeFromBench.mockResolvedValue(undefined);
    const res = await request(app).delete(`${base}/tournaments/t1/bench/u9`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(removeFromBench).toHaveBeenCalledWith('club-1', 't1', 'u9', 'staff-1');
  });

  it('DELETE bench/:userId — 404 BENCH_ENTRY_NOT_FOUND remonté (nouveau code ERROR_STATUS)', async () => {
    removeFromBench.mockRejectedValue(new Error('BENCH_ENTRY_NOT_FOUND'));
    const res = await request(app).delete(`${base}/tournaments/t1/bench/u9`).set(auth);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('BENCH_ENTRY_NOT_FOUND');
  });

  it('POST bench/pair — 201, délègue (clubId, tournamentId, userAId, userBId, actorUserId)', async () => {
    pairFromBench.mockResolvedValue({ id: 'reg-new' });
    const res = await request(app)
      .post(`${base}/tournaments/t1/bench/pair`)
      .set(auth).send({ userAId: 'ua', userBId: 'ub' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 'reg-new' });
    expect(pairFromBench).toHaveBeenCalledWith('club-1', 't1', 'ua', 'ub', 'staff-1');
  });

  it('POST bench/pair — 400 VALIDATION_ERROR si un id manque', async () => {
    const res = await request(app).post(`${base}/tournaments/t1/bench/pair`).set(auth).send({ userAId: 'ua' });
    expect(res.status).toBe(400);
    expect(pairFromBench).not.toHaveBeenCalled();
  });

  it('POST bench/pair — 409 TOURNAMENT_NOT_OPEN remonté (nouveau code ERROR_STATUS)', async () => {
    pairFromBench.mockRejectedValue(new Error('TOURNAMENT_NOT_OPEN'));
    const res = await request(app)
      .post(`${base}/tournaments/t1/bench/pair`)
      .set(auth).send({ userAId: 'ua', userBId: 'ub' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('TOURNAMENT_NOT_OPEN');
  });

  it('POST registrations (binôme tardif) — 201, délègue (clubId, tournamentId, captainUserId, partnerUserId, actorUserId)', async () => {
    addLateRegistration.mockResolvedValue({ id: 'reg-late' });
    const res = await request(app)
      .post(`${base}/tournaments/t1/registrations`)
      .set(auth).send({ captainUserId: 'ua', partnerUserId: 'ub' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 'reg-late' });
    expect(addLateRegistration).toHaveBeenCalledWith('club-1', 't1', 'ua', 'ub', 'staff-1');
  });

  it('POST registrations (binôme tardif) — 400 VALIDATION_ERROR si partenaire manquant', async () => {
    const res = await request(app).post(`${base}/tournaments/t1/registrations`).set(auth).send({ captainUserId: 'ua' });
    expect(res.status).toBe(400);
    expect(addLateRegistration).not.toHaveBeenCalled();
  });

  it('POST mark-table/registrations/:regId/promote — 200, délègue (clubId, tournamentId, regId, actorUserId)', async () => {
    markTablePromote.mockResolvedValue({ id: 'r1', status: 'CONFIRMED' });
    const res = await request(app).post(`${base}/tournaments/t1/mark-table/registrations/r1/promote`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'r1', status: 'CONFIRMED' });
    expect(markTablePromote).toHaveBeenCalledWith('club-1', 't1', 'r1', 'staff-1');
  });

  it('DELETE mark-table/registrations/:regId — 200, délègue (clubId, tournamentId, regId, actorUserId)', async () => {
    markTableRemove.mockResolvedValue({ cancelled: true });
    const res = await request(app).delete(`${base}/tournaments/t1/mark-table/registrations/r1`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ cancelled: true });
    expect(markTableRemove).toHaveBeenCalledWith('club-1', 't1', 'r1', 'staff-1');
  });

  // Le routeur admin gate STAFF globalement (router.use(authMiddleware, requireClubMember('STAFF')),
  // ligne 185) : ces routes ne doivent PAS exiger ADMIN — un simple STAFF y a accès.
  it('STAFF (pas ADMIN/OWNER) → accès accordé (pas de gate ADMIN ajouté sur ces routes)', async () => {
    listMarkTable.mockResolvedValue({ registrations: [] });
    const res = await request(app).get(`${base}/tournaments/t1/mark-table`).set(auth);
    expect(res.status).not.toBe(403);
  });

  // Non-membre du club → bloqué par la garde globale du routeur, avant même d'atteindre la route.
  it('non-membre du club → 403 (garde globale du routeur)', async () => {
    prismaMock.clubMember.findUnique.mockResolvedValue(null as any);
    const res = await request(app).get(`${base}/tournaments/t1/mark-table`).set(auth);
    expect(res.status).toBe(403);
    expect(listMarkTable).not.toHaveBeenCalled();
  });
});
