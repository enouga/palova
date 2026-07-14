import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const listImpl = jest.fn();
const resolveImpl = jest.fn();
const imagePathImpl = jest.fn();
jest.mock('../../services/moderation.service', () => ({
  ModerationService: jest.fn().mockImplementation(() => ({
    listPlatformReports: (...a: any[]) => listImpl(...a),
    resolvePlatformReport: (...a: any[]) => resolveImpl(...a),
    platformReportImagePath: (...a: any[]) => imagePathImpl(...a),
  })),
}));

import app from '../../app';

const SECRET = process.env.JWT_SECRET!;
if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET manquant');
const tokenFor = (id: string) => jwt.sign({ id, email: `${id}@x.fr` }, SECRET, { expiresIn: '1h' });
const superToken = tokenFor('super-1');

beforeEach(() => {
  jest.clearAllMocks();
  listImpl.mockReset().mockResolvedValue([{ id: 'rep-1', status: 'OPEN' }]);
  resolveImpl.mockReset().mockResolvedValue({ id: 'rep-1', status: 'RESOLVED' });
  imagePathImpl.mockReset().mockResolvedValue({ absPath: '/tmp/x.jpg', mime: 'image/jpeg' });
});

describe('GET /api/platform/moderation/reports', () => {
  it('401 sans token', async () => {
    expect((await request(app).get('/api/platform/moderation/reports')).status).toBe(401);
  });
  it('403 non super-admin', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ isSuperAdmin: false } as any);
    const res = await request(app).get('/api/platform/moderation/reports').set('Authorization', `Bearer ${tokenFor('u1')}`);
    expect(res.status).toBe(403);
  });
  it('200 pour un super-admin', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ isSuperAdmin: true } as any);
    const res = await request(app).get('/api/platform/moderation/reports').set('Authorization', `Bearer ${superToken}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });
});

describe('POST /api/platform/moderation/reports/:reportId/resolve', () => {
  it('200 avec action REJECT', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ isSuperAdmin: true } as any);
    const res = await request(app).post('/api/platform/moderation/reports/rep-1/resolve')
      .set('Authorization', `Bearer ${superToken}`).send({ action: 'REJECT' });
    expect(res.status).toBe(200);
    expect(resolveImpl).toHaveBeenCalledWith('rep-1', 'super-1', 'REJECT');
  });
  it('400 action invalide', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ isSuperAdmin: true } as any);
    const res = await request(app).post('/api/platform/moderation/reports/rep-1/resolve')
      .set('Authorization', `Bearer ${superToken}`).send({ action: 'X' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/platform/moderation/reports/:id/image', () => {
  it('401 sans token', async () => {
    expect((await request(app).get('/api/platform/moderation/reports/rep-1/image')).status).toBe(401);
  });
  it('404 si le service lève', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ isSuperAdmin: true } as any);
    imagePathImpl.mockRejectedValue(new Error('MESSAGE_NOT_FOUND'));
    const res = await request(app).get('/api/platform/moderation/reports/rep-1/image').set('Authorization', `Bearer ${superToken}`);
    expect(res.status).toBe(404);
  });
});
