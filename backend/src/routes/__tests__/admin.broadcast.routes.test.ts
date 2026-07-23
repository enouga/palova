import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';

// These variables are captured by the mock factory closure.
// Jest hoists jest.mock() calls but the factory body runs lazily on first require,
// so by then these let-bindings are already initialised.
let sendImpl = jest.fn().mockResolvedValue({ recipientCount: 5, broadcastId: 'bc-1' });
let countActiveMembersImpl = jest.fn().mockResolvedValue(5);
let historyImpl = jest.fn().mockResolvedValue([]);
let previewImpl = jest.fn().mockResolvedValue({ html: '<html>preview</html>' });
let audienceImpl = jest.fn().mockResolvedValue({ total: 5, email: 5, inApp: 5, excluded: 0 });
let receivedByImpl = jest.fn().mockResolvedValue([]);

jest.mock('../../services/broadcast.service', () => ({
  BroadcastService: jest.fn().mockImplementation(() => ({
    send: (...args: any[]) => sendImpl(...args),
    countActiveMembers: (...args: any[]) => countActiveMembersImpl(...args),
    history: (...args: any[]) => historyImpl(...args),
    preview: (...args: any[]) => previewImpl(...args),
    audience: (...args: any[]) => audienceImpl(...args),
    receivedBy: (...args: any[]) => receivedByImpl(...args),
  })),
}));

import app from '../../app';

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET manquant dans l environnement de test (.env)');

const token = () => jwt.sign({ id: 'u1', email: 'owner@x.fr' }, process.env.JWT_SECRET!);
const auth = { Authorization: `Bearer ${token()}` };
const base = '/api/clubs/club-demo/admin';

beforeEach(() => {
  prismaMock.clubMember.findUnique.mockResolvedValue({ userId: 'u1', clubId: 'club-demo', role: 'OWNER' } as any);
  // Reset mock implementations to happy-path defaults before each test
  sendImpl.mockReset();
  sendImpl.mockResolvedValue({ recipientCount: 5, broadcastId: 'bc-1' });
  countActiveMembersImpl.mockReset();
  countActiveMembersImpl.mockResolvedValue(5);
  historyImpl.mockReset();
  historyImpl.mockResolvedValue([]);
  previewImpl.mockReset();
  previewImpl.mockResolvedValue({ html: '<html>preview</html>' });
  audienceImpl.mockReset();
  audienceImpl.mockResolvedValue({ total: 5, email: 5, inApp: 5, excluded: 0 });
  receivedByImpl.mockReset();
  receivedByImpl.mockResolvedValue([]);
});

describe('POST /api/clubs/:clubId/admin/broadcast', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).post(`${base}/broadcast`).send({ title: 'Hi', bodyHtml: '<p>Msg</p>' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-member', async () => {
    prismaMock.clubMember.findUnique.mockResolvedValue(null as any);
    const res = await request(app).post(`${base}/broadcast`).set(auth).send({ title: 'Hi', bodyHtml: '<p>Msg</p>' });
    expect(res.status).toBe(403);
  });

  it('returns 200 and forwards the rich HTML body for OWNER', async () => {
    const res = await request(app).post(`${base}/broadcast`).set(auth).send({ title: 'Hi', bodyHtml: '<p>Msg</p>' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ recipientCount: 5, broadcastId: 'bc-1' });
    expect(sendImpl).toHaveBeenCalledWith('club-demo', 'u1', expect.objectContaining({ title: 'Hi', bodyHtml: '<p>Msg</p>' }));
  });

  it('forwards the chosen channels (coerced to booleans)', async () => {
    await request(app).post(`${base}/broadcast`).set(auth).send({ title: 'Hi', bodyHtml: '<p>Msg</p>', channels: { email: true, inApp: false, push: true } });
    expect(sendImpl).toHaveBeenCalledWith('club-demo', 'u1', expect.objectContaining({ channels: { email: true, inApp: false, push: true } }));
  });

  it('returns 200 for ADMIN', async () => {
    prismaMock.clubMember.findUnique.mockResolvedValue({ userId: 'u1', clubId: 'club-demo', role: 'ADMIN' } as any);
    const res = await request(app).post(`${base}/broadcast`).set(auth).send({ title: 'Hi', bodyHtml: '<p>Msg</p>' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ recipientCount: 5, broadcastId: 'bc-1' });
  });

  it('returns 200 for STAFF member (page Messages ouverte au staff, 2026-07-13)', async () => {
    prismaMock.clubMember.findUnique.mockResolvedValue({ userId: 'u1', clubId: 'club-demo', role: 'STAFF' } as any);
    const res = await request(app).post(`${base}/broadcast`).set(auth).send({ title: 'Hi', bodyHtml: '<p>Msg</p>' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ recipientCount: 5, broadcastId: 'bc-1' });
  });

  it('returns 400 with VALIDATION_ERROR on empty content', async () => {
    sendImpl.mockRejectedValue(new Error('VALIDATION_ERROR'));
    const res = await request(app).post(`${base}/broadcast`).set(auth).send({ title: '', bodyHtml: '<p>Msg</p>' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/clubs/:clubId/admin/broadcast/preview', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).post(`${base}/broadcast/preview`).send({ title: 'Hi', bodyHtml: '<p>Msg</p>' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-member', async () => {
    prismaMock.clubMember.findUnique.mockResolvedValue(null as any);
    const res = await request(app).post(`${base}/broadcast/preview`).set(auth).send({ title: 'Hi', bodyHtml: '<p>Msg</p>' });
    expect(res.status).toBe(403);
  });

  it('returns 200 with { html } for STAFF', async () => {
    prismaMock.clubMember.findUnique.mockResolvedValue({ userId: 'u1', clubId: 'club-demo', role: 'STAFF' } as any);
    const res = await request(app).post(`${base}/broadcast/preview`).set(auth).send({ title: 'Hi', bodyHtml: '<p>Msg</p>' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ html: '<html>preview</html>' });
    expect(previewImpl).toHaveBeenCalledWith('club-demo', expect.objectContaining({ title: 'Hi', bodyHtml: '<p>Msg</p>' }));
  });
});

describe('GET /api/clubs/:clubId/admin/broadcasts', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get(`${base}/broadcasts`);
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-member', async () => {
    prismaMock.clubMember.findUnique.mockResolvedValue(null as any);
    const res = await request(app).get(`${base}/broadcasts`).set(auth);
    expect(res.status).toBe(403);
  });

  it('returns 200 with recipientCount and items for OWNER', async () => {
    const res = await request(app).get(`${base}/broadcasts`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ recipientCount: 5, items: [] });
  });

  it('returns 200 for STAFF member (page Messages ouverte au staff, 2026-07-13)', async () => {
    prismaMock.clubMember.findUnique.mockResolvedValue({ userId: 'u1', clubId: 'club-demo', role: 'STAFF' } as any);
    const res = await request(app).get(`${base}/broadcasts`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ recipientCount: 5, items: [] });
  });
});

describe('POST /api/clubs/:clubId/admin/broadcast/audience', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).post(`${base}/broadcast/audience`).send({ kind: 'INFO' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-member', async () => {
    prismaMock.clubMember.findUnique.mockResolvedValue(null as any);
    const res = await request(app).post(`${base}/broadcast/audience`).set(auth).send({ kind: 'INFO' });
    expect(res.status).toBe(403);
  });

  it('appelle audience(clubId, { recipientUserIds, kind }) et relaie tel quel son résultat', async () => {
    audienceImpl.mockResolvedValue({ total: 3, email: 1, inApp: 2, excluded: 1 });
    const res = await request(app).post(`${base}/broadcast/audience`).set(auth)
      .send({ kind: 'COMMERCIAL', recipientUserIds: ['u1', 'u2'] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ total: 3, email: 1, inApp: 2, excluded: 1 });
    expect(audienceImpl).toHaveBeenCalledWith('club-demo', { recipientUserIds: ['u1', 'u2'], kind: 'COMMERCIAL' });
  });

  it('kind absent ou inconnu retombe sur INFO ; recipientUserIds absent → null', async () => {
    await request(app).post(`${base}/broadcast/audience`).set(auth).send({});
    expect(audienceImpl).toHaveBeenCalledWith('club-demo', { recipientUserIds: null, kind: 'INFO' });
  });

  it('returns 200 for STAFF member', async () => {
    prismaMock.clubMember.findUnique.mockResolvedValue({ userId: 'u1', clubId: 'club-demo', role: 'STAFF' } as any);
    const res = await request(app).post(`${base}/broadcast/audience`).set(auth).send({ kind: 'INFO' });
    expect(res.status).toBe(200);
  });
});

describe('GET /api/clubs/:clubId/admin/members/:userId/broadcasts', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get(`${base}/members/u1/broadcasts`);
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-member', async () => {
    prismaMock.clubMember.findUnique.mockResolvedValue(null as any);
    const res = await request(app).get(`${base}/members/u1/broadcasts`).set(auth);
    expect(res.status).toBe(403);
  });

  it('appelle receivedBy(clubId, userId) et relaie tel quel son résultat', async () => {
    receivedByImpl.mockResolvedValue([
      { id: 'b1', title: 'Promo', kind: 'COMMERCIAL', createdAt: new Date('2026-07-20') },
    ]);
    const res = await request(app).get(`${base}/members/u1/broadcasts`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ id: 'b1', title: 'Promo', kind: 'COMMERCIAL' });
    expect(receivedByImpl).toHaveBeenCalledWith('club-demo', 'u1');
  });

  it('returns 200 for STAFF member', async () => {
    prismaMock.clubMember.findUnique.mockResolvedValue({ userId: 'u1', clubId: 'club-demo', role: 'STAFF' } as any);
    const res = await request(app).get(`${base}/members/u1/broadcasts`).set(auth);
    expect(res.status).toBe(200);
  });
});
