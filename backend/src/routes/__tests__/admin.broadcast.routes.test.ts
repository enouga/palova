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

jest.mock('../../services/broadcast.service', () => ({
  BroadcastService: jest.fn().mockImplementation(() => ({
    send: (...args: any[]) => sendImpl(...args),
    countActiveMembers: (...args: any[]) => countActiveMembersImpl(...args),
    history: (...args: any[]) => historyImpl(...args),
    preview: (...args: any[]) => previewImpl(...args),
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
