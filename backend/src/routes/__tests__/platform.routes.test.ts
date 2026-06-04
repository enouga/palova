import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';

const SECRET = process.env.JWT_SECRET!;
const tokenFor = (id: string) => jwt.sign({ id, email: `${id}@x.fr` }, SECRET, { expiresIn: '1h' });

describe('GET /api/platform/stats (autorisation)', () => {
  it('401 sans token', async () => {
    const res = await request(app).get('/api/platform/stats');
    expect(res.status).toBe(401);
  });

  it('403 avec un token de non super-admin', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ isSuperAdmin: false } as any);
    const res = await request(app).get('/api/platform/stats').set('Authorization', `Bearer ${tokenFor('u1')}`);
    expect(res.status).toBe(403);
  });

  it('200 avec un token de super-admin', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ isSuperAdmin: true } as any);
    prismaMock.club.count.mockResolvedValue(0 as any);
    prismaMock.user.count.mockResolvedValue(0 as any);
    prismaMock.reservation.count.mockResolvedValue(0 as any);
    prismaMock.tournament.count.mockResolvedValue(0 as any);
    const res = await request(app).get('/api/platform/stats').set('Authorization', `Bearer ${tokenFor('admin')}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('clubs');
  });
});
