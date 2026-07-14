import '../../__mocks__/prisma';
import express from 'express';
import request from 'supertest';

// clubs.ts instancie beaucoup de services au chargement du module ; on reprend les mocks
// des services à effets de bord du test frère (clubs.openmatch-chat.routes.test.ts) pour que
// le routeur s'importe proprement, puis on ajoute le mock de MatchAlertService et de l'auth.
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

const create = jest.fn(), listMine = jest.fn(), remove = jest.fn();
jest.mock('../../services/matchAlert.service', () => ({
  MatchAlertService: jest.fn().mockImplementation(() => ({ create, listMine, remove })),
}));

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => { req.user = { id: 'u1' }; next(); },
  optionalAuth:  (req: any, _res: any, next: any) => { req.user = { id: 'u1' }; next(); },
}));

import clubsRouter from '../clubs';

const app = express();
app.use(express.json());
app.use('/api/clubs', clubsRouter);

describe('routes match-alerts', () => {
  beforeEach(() => { create.mockReset(); listMine.mockReset(); remove.mockReset(); });

  it('POST crée une alerte (200)', async () => {
    create.mockResolvedValue({ id: 'a1', windowStart: '2026-07-16T16:00:00.000Z', windowEnd: '2026-07-16T19:00:00.000Z' });
    const res = await request(app).post('/api/clubs/arena/match-alerts').send({ date: '2026-07-16', from: '18:00', to: '21:00' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('a1');
    expect(create).toHaveBeenCalledWith('arena', 'u1', { date: '2026-07-16', from: '18:00', to: '21:00' });
  });

  it('POST fenêtre invalide → 400', async () => {
    create.mockRejectedValue(new Error('ALERT_WINDOW_INVALID'));
    const res = await request(app).post('/api/clubs/arena/match-alerts').send({ date: 'x', from: 'y', to: 'z' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ALERT_WINDOW_INVALID');
  });

  it('POST limite atteinte → 409', async () => {
    create.mockRejectedValue(new Error('ALERT_LIMIT_REACHED'));
    const res = await request(app).post('/api/clubs/arena/match-alerts').send({ date: '2026-07-16', from: '18:00', to: '21:00' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('ALERT_LIMIT_REACHED');
  });

  it('GET liste (200) et DELETE (200)', async () => {
    listMine.mockResolvedValue([{ id: 'a1' }]);
    remove.mockResolvedValue({ ok: true });

    const listRes = await request(app).get('/api/clubs/arena/match-alerts');
    expect(listRes.status).toBe(200);
    expect(listRes.body).toEqual([{ id: 'a1' }]);
    expect(listMine).toHaveBeenCalledWith('arena', 'u1');

    const delRes = await request(app).delete('/api/clubs/arena/match-alerts/a1');
    expect(delRes.status).toBe(200);
    expect(delRes.body).toEqual({ ok: true });
    expect(remove).toHaveBeenCalledWith('arena', 'u1', 'a1');
  });
});
