import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';

jest.mock('../../services/broadcast.service', () => ({
  BroadcastService: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({ recipientCount: 5, broadcastId: 'bc-1' }),
    countActiveMembers: jest.fn().mockResolvedValue(5),
    history: jest.fn().mockResolvedValue([]),
  })),
}));

import app from '../../app';

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET manquant dans l environnement de test (.env)');

const token = () => jwt.sign({ id: 'u1', email: 'owner@x.fr' }, process.env.JWT_SECRET!);
const auth = { Authorization: `Bearer ${token()}` };
const base = '/api/clubs/club-demo/admin';

beforeEach(() => {
  prismaMock.clubMember.findUnique.mockResolvedValue({ userId: 'u1', clubId: 'club-demo', role: 'OWNER' } as any);
});

describe('POST /api/clubs/:clubId/admin/broadcast', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).post(`${base}/broadcast`).send({ title: 'Hi', body: 'Msg' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-member', async () => {
    prismaMock.clubMember.findUnique.mockResolvedValue(null as any);
    const res = await request(app).post(`${base}/broadcast`).set(auth).send({ title: 'Hi', body: 'Msg' });
    expect(res.status).toBe(403);
  });

  it('returns 200 with recipientCount and broadcastId for OWNER', async () => {
    const res = await request(app).post(`${base}/broadcast`).set(auth).send({ title: 'Hi', body: 'Msg' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ recipientCount: 5, broadcastId: 'bc-1' });
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
});
