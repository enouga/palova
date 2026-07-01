import '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';

// jest.mock est hissé avant les imports — les fonctions partagées vivent dans la closure
// de la factory et sont donc les mêmes références quel que soit le nombre de `new …()`.
jest.mock('../../services/openMatch.service', () => {
  const listOpenMatches  = jest.fn().mockResolvedValue([]);
  const joinOpenMatch    = jest.fn().mockResolvedValue({});
  const setInterested    = jest.fn().mockResolvedValue({ id: 'match-1' });
  const removeInterested = jest.fn().mockResolvedValue({ id: 'match-1' });
  const setTeams         = jest.fn().mockResolvedValue({ id: 'match-1' });
  return {
    OpenMatchService: jest.fn().mockImplementation(() => ({
      listOpenMatches,
      joinOpenMatch,
      leaveOpenMatch:      jest.fn().mockResolvedValue({}),
      removeOpenMatchPlayer: jest.fn().mockResolvedValue({}),
      addOpenMatchPlayer:  jest.fn().mockResolvedValue({}),
      setInterested,
      removeInterested,
      setTeams,
    })),
  };
});

jest.mock('../../services/openMatchChat.service', () => {
  const stubMsg = { id: 'msg-1', body: 'hi', createdAt: '2026-01-01T10:00:00.000Z', deleted: false, author: { userId: 'u1', firstName: 'A', lastName: 'B', avatarUrl: null } };
  const listMessages           = jest.fn().mockResolvedValue([]);
  const postMessage            = jest.fn().mockResolvedValue(stubMsg);
  const deleteMessage          = jest.fn().mockResolvedValue({ ...stubMsg, body: '', deleted: true });
  const assertChatAccessPublic = jest.fn().mockResolvedValue(undefined);
  const markRead               = jest.fn().mockResolvedValue({ count: 0 });
  const unreadCount            = jest.fn().mockResolvedValue({ count: 0 });
  return {
    OpenMatchChatService: jest.fn().mockImplementation(() => ({
      assertChatAccessPublic,
      listMessages,
      postMessage,
      deleteMessage,
      markRead,
      unreadCount,
    })),
  };
});

import app from '../../app';
import { OpenMatchService }     from '../../services/openMatch.service';
import { OpenMatchChatService } from '../../services/openMatchChat.service';

const SECRET = process.env.JWT_SECRET!;
if (!SECRET) throw new Error('JWT_SECRET manquant dans l\'environnement de test');
const token = () => jwt.sign({ id: 'u1', email: 'test@x.fr' }, SECRET);

// Récupère les références partagées en instanciant une fois les services mockés.
const omInst   = new (OpenMatchService as any)();
const listOpenMatches = omInst.listOpenMatches as jest.Mock;
const joinOpenMatch    = omInst.joinOpenMatch    as jest.Mock;
const setInterested    = omInst.setInterested    as jest.Mock;
const removeInterested = omInst.removeInterested as jest.Mock;
const setTeams         = omInst.setTeams         as jest.Mock;

const chatInst  = new (OpenMatchChatService as any)();
const listMessages           = chatInst.listMessages           as jest.Mock;
const postMessage            = chatInst.postMessage            as jest.Mock;
const deleteMessage          = chatInst.deleteMessage          as jest.Mock;
const markRead               = chatInst.markRead               as jest.Mock;
const unreadCount            = chatInst.unreadCount            as jest.Mock;

const SLUG     = 'arena';
const MATCH_ID = 'match-1';
const base     = `/api/clubs/${SLUG}/open-matches/${MATCH_ID}`;

const stubMsg = { id: 'msg-1', body: 'hi', createdAt: '2026-01-01T10:00:00.000Z', deleted: false, author: { userId: 'u1', firstName: 'A', lastName: 'B', avatarUrl: null } };

beforeEach(() => {
  jest.clearAllMocks();
  // Restaure les valeurs par défaut après clearAllMocks (qui efface les calls mais pas les implémentations).
  listOpenMatches.mockResolvedValue([]);
  joinOpenMatch.mockResolvedValue({});
  setInterested.mockResolvedValue({ id: MATCH_ID });
  removeInterested.mockResolvedValue({ id: MATCH_ID });
  setTeams.mockResolvedValue({ id: MATCH_ID });
  listMessages.mockResolvedValue([]);
  postMessage.mockResolvedValue(stubMsg);
  deleteMessage.mockResolvedValue({ ...stubMsg, body: '', deleted: true });
  markRead.mockResolvedValue({ count: 0 });
  unreadCount.mockResolvedValue({ count: 0 });
});

// ─── Interest (ça m'intéresse) ────────────────────────────────────────────────

describe('POST /api/clubs/:slug/open-matches/:id/interest', () => {
  it('200 — appelle setInterested(slug, id, userId)', async () => {
    const res = await request(app)
      .post(`${base}/interest`)
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(setInterested).toHaveBeenCalledWith(SLUG, MATCH_ID, 'u1');
  });

  it('401 sans token', async () => {
    const res = await request(app).post(`${base}/interest`);
    expect(res.status).toBe(401);
    expect(setInterested).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/clubs/:slug/open-matches/:id/interest', () => {
  it('200 — appelle removeInterested(slug, id, userId)', async () => {
    const res = await request(app)
      .delete(`${base}/interest`)
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(removeInterested).toHaveBeenCalledWith(SLUG, MATCH_ID, 'u1');
  });
});

// ─── Teams (réorganisation par l'organisateur) ────────────────────────────────

describe('POST /api/clubs/:slug/open-matches/:id/participants/teams', () => {
  it('200 — appelle setTeams(slug, id, userId, teams)', async () => {
    const teams = { u1: 1, u2: 2, u3: 1, u4: 2 };
    const res = await request(app)
      .post(`${base}/participants/teams`)
      .set('Authorization', `Bearer ${token()}`)
      .send({ teams });
    expect(res.status).toBe(200);
    expect(setTeams).toHaveBeenCalledWith(SLUG, MATCH_ID, 'u1', teams);
  });

  it('400 — un côté sur-rempli (TEAM_SIDE_FULL) est mappé', async () => {
    setTeams.mockRejectedValue(new Error('TEAM_SIDE_FULL'));
    const res = await request(app)
      .post(`${base}/participants/teams`)
      .set('Authorization', `Bearer ${token()}`)
      .send({ teams: { u1: 1, u2: 1, u3: 1, u4: 2 } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('TEAM_SIDE_FULL');
  });

  it('401 sans token', async () => {
    const res = await request(app).post(`${base}/participants/teams`).send({ teams: {} });
    expect(res.status).toBe(401);
    expect(setTeams).not.toHaveBeenCalled();
  });
});

// ─── Chat — messages ──────────────────────────────────────────────────────────

describe('GET /api/clubs/:slug/open-matches/:id/chat/messages', () => {
  it('200 — renvoie le tableau produit par listMessages', async () => {
    const msgs = [stubMsg];
    listMessages.mockResolvedValue(msgs);
    const res = await request(app)
      .get(`${base}/chat/messages`)
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(msgs);
    expect(listMessages).toHaveBeenCalledWith(SLUG, MATCH_ID, 'u1');
  });

  it('401 sans token', async () => {
    const res = await request(app).get(`${base}/chat/messages`);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/clubs/:slug/open-matches/:id/chat/messages', () => {
  it('200 — appelle postMessage(slug, id, userId, body)', async () => {
    const res = await request(app)
      .post(`${base}/chat/messages`)
      .set('Authorization', `Bearer ${token()}`)
      .send({ body: 'hi' });
    expect(res.status).toBe(200);
    expect(postMessage).toHaveBeenCalledWith(SLUG, MATCH_ID, 'u1', 'hi');
  });
});

describe('DELETE /api/clubs/:slug/open-matches/:id/chat/messages/:messageId', () => {
  it('200 — appelle deleteMessage(slug, id, userId, messageId)', async () => {
    const res = await request(app)
      .delete(`${base}/chat/messages/msg-1`)
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(deleteMessage).toHaveBeenCalledWith(SLUG, MATCH_ID, 'u1', 'msg-1');
  });
});

// ─── Error mapping ────────────────────────────────────────────────────────────

describe('Error mapping', () => {
  it('CHAT_FORBIDDEN → 403', async () => {
    listMessages.mockRejectedValue(new Error('CHAT_FORBIDDEN'));
    const res = await request(app)
      .get(`${base}/chat/messages`)
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('CHAT_FORBIDDEN');
  });

  it('MATCH_NOT_JOINABLE → 409', async () => {
    setInterested.mockRejectedValue(new Error('MATCH_NOT_JOINABLE'));
    const res = await request(app)
      .post(`${base}/interest`)
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('MATCH_NOT_JOINABLE');
  });

  it('VALIDATION_ERROR → 400', async () => {
    postMessage.mockRejectedValue(new Error('VALIDATION_ERROR'));
    const res = await request(app)
      .post(`${base}/chat/messages`)
      .set('Authorization', `Bearer ${token()}`)
      .send({ body: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('MESSAGE_NOT_FOUND → 404', async () => {
    deleteMessage.mockRejectedValue(new Error('MESSAGE_NOT_FOUND'));
    const res = await request(app)
      .delete(`${base}/chat/messages/msg-x`)
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('MESSAGE_NOT_FOUND');
  });

  it('NOT_ALLOWED → 403', async () => {
    deleteMessage.mockRejectedValue(new Error('NOT_ALLOWED'));
    const res = await request(app)
      .delete(`${base}/chat/messages/msg-x`)
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('NOT_ALLOWED');
  });
});

// ─── Unread count (badge de l'onglet) ─────────────────────────────────────────

describe('GET /api/clubs/:slug/open-matches/unread-count', () => {
  it('200 — appelle unreadCount(slug, userId) et renvoie le résultat', async () => {
    unreadCount.mockResolvedValue({ count: 7 });
    const res = await request(app)
      .get(`/api/clubs/${SLUG}/open-matches/unread-count`)
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 7 });
    expect(unreadCount).toHaveBeenCalledWith(SLUG, 'u1');
  });

  it('401 sans token', async () => {
    const res = await request(app).get(`/api/clubs/${SLUG}/open-matches/unread-count`);
    expect(res.status).toBe(401);
    expect(unreadCount).not.toHaveBeenCalled();
  });
});

// ─── Mark read ────────────────────────────────────────────────────────────────

describe('POST /api/clubs/:slug/open-matches/:id/chat/read', () => {
  it('200 — appelle markRead(slug, id, userId) et renvoie le résultat', async () => {
    markRead.mockResolvedValue({ count: 3 });
    const res = await request(app)
      .post(`${base}/chat/read`)
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 3 });
    expect(markRead).toHaveBeenCalledWith(SLUG, MATCH_ID, 'u1');
  });

  it('401 sans token', async () => {
    const res = await request(app).post(`${base}/chat/read`);
    expect(res.status).toBe(401);
    expect(markRead).not.toHaveBeenCalled();
  });
});

// ─── SSE stream (on ne teste que le garde d'auth) ────────────────────────────

describe('GET /api/clubs/:slug/open-matches/:id/chat/stream (SSE)', () => {
  it('401 sans token query param', async () => {
    const res = await request(app).get(`${base}/chat/stream`);
    expect(res.status).toBe(401);
  });
});

describe('lecture publique de la liste', () => {
  const list = `/api/clubs/${SLUG}/open-matches`;

  it('GET sans Authorization → 200 + liste, viewer null (anonyme)', async () => {
    listOpenMatches.mockResolvedValue([{ id: 'm1' }]);
    const res = await request(app).get(list);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'm1' }]);
    expect(listOpenMatches).toHaveBeenCalledWith(SLUG, null);
  });

  it('GET avec Authorization → 200 + userId transmis', async () => {
    const res = await request(app).get(list).set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(listOpenMatches).toHaveBeenCalledWith(SLUG, 'u1');
  });

  it('POST /join sans Authorization reste protégé → 401', async () => {
    const res = await request(app).post(`${list}/${MATCH_ID}/join`);
    expect(res.status).toBe(401);
    expect(joinOpenMatch).not.toHaveBeenCalled();
  });
});
