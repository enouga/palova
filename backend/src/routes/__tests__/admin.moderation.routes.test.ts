import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const listImpl = jest.fn();
const resolveImpl = jest.fn();
jest.mock('../../services/moderation.service', () => ({
  ModerationService: jest.fn().mockImplementation(() => ({
    listClubReports: (...a: any[]) => listImpl(...a),
    resolveClubReport: (...a: any[]) => resolveImpl(...a),
  })),
}));

import app from '../../app';

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET manquant');
const auth = { Authorization: `Bearer ${jwt.sign({ id: 'u1', email: 'owner@x.fr' }, process.env.JWT_SECRET!)}` };
const base = '/api/clubs/club-demo/admin/moderation/reports';

beforeEach(() => {
  prismaMock.clubMember.findUnique.mockResolvedValue({ userId: 'u1', clubId: 'club-demo', role: 'ADMIN' } as any);
  listImpl.mockReset().mockResolvedValue([{ id: 'rep-1', status: 'OPEN' }]);
  resolveImpl.mockReset().mockResolvedValue({ id: 'rep-1', status: 'RESOLVED', resolution: 'DELETED' });
});

describe('GET /moderation/reports', () => {
  it('401 sans token', async () => {
    expect((await request(app).get(base)).status).toBe(401);
  });
  it('403 pour STAFF (réservé ADMIN+)', async () => {
    prismaMock.clubMember.findUnique.mockResolvedValue({ userId: 'u1', clubId: 'club-demo', role: 'STAFF' } as any);
    const res = await request(app).get(base).set(auth);
    expect(res.status).toBe(403);
  });
  it('200 items pour ADMIN', async () => {
    const res = await request(app).get(base).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(listImpl).toHaveBeenCalledWith('club-demo', { status: undefined });
  });
  it('transmet ?status= au service', async () => {
    await request(app).get(`${base}?status=OPEN`).set(auth);
    expect(listImpl).toHaveBeenCalledWith('club-demo', { status: 'OPEN' });
  });
});

describe('POST /moderation/reports/:reportId/resolve', () => {
  it('200 avec action DELETE', async () => {
    const res = await request(app).post(`${base}/rep-1/resolve`).set(auth).send({ action: 'DELETE' });
    expect(res.status).toBe(200);
    expect(resolveImpl).toHaveBeenCalledWith('club-demo', 'rep-1', 'u1', 'DELETE');
  });
  it('400 si action invalide', async () => {
    const res = await request(app).post(`${base}/rep-1/resolve`).set(auth).send({ action: 'NAWAK' });
    expect(res.status).toBe(400);
    expect(resolveImpl).not.toHaveBeenCalled();
  });
  it('404 REPORT_NOT_FOUND', async () => {
    resolveImpl.mockRejectedValue(new Error('REPORT_NOT_FOUND'));
    const res = await request(app).post(`${base}/rep-1/resolve`).set(auth).send({ action: 'REJECT' });
    expect(res.status).toBe(404);
  });
});
