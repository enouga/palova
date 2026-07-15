import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';

const SECRET = process.env.JWT_SECRET!;
if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET manquant');
const token = () => jwt.sign({ id: 'admin1', email: 'a@x.fr' }, SECRET, { expiresIn: '1h' });
const auth = { Authorization: `Bearer ${token()}` };
const base = '/api/clubs/club-demo/admin';

const memberRoles = (roles: Record<string, 'OWNER' | 'ADMIN' | 'STAFF'>) =>
  prismaMock.clubMember.findUnique.mockImplementation(((args: any) => {
    const userId = args?.where?.userId_clubId?.userId as string;
    const role = roles[userId];
    return Promise.resolve(role ? { userId, clubId: 'club-demo', role } : null);
  }) as any);

beforeEach(() => {
  jest.clearAllMocks();
  memberRoles({ admin1: 'ADMIN' });
  prismaMock.clubMembership.findUnique.mockResolvedValue({ id: 'mb1' } as any);
});

describe('PATCH /api/clubs/:clubId/admin/members/:userId/coach', () => {
  it('401 sans token', async () => {
    const res = await request(app).patch(`${base}/members/u9/coach`).send({ isCoach: true });
    expect(res.status).toBe(401);
  });

  it('403 pour un viewer STAFF (route réservée ADMIN+)', async () => {
    memberRoles({ admin1: 'STAFF' });
    const res = await request(app).patch(`${base}/members/u9/coach`).set(auth).send({ isCoach: true });
    expect(res.status).toBe(403);
  });

  it('400 VALIDATION_ERROR si isCoach absent ou non-booléen', async () => {
    const res = await request(app).patch(`${base}/members/u9/coach`).set(auth).send({});
    expect(res.status).toBe(400);
    const res2 = await request(app).patch(`${base}/members/u9/coach`).set(auth).send({ isCoach: 'yes' });
    expect(res2.status).toBe(400);
  });

  it('200 : coche → crée la ligne Coach', async () => {
    prismaMock.coach.findUnique.mockResolvedValue(null as any);
    prismaMock.user.findUnique.mockResolvedValue({ firstName: 'Paul', lastName: 'Martin' } as any);
    prismaMock.coach.create.mockResolvedValue({ id: 'c1' } as any);
    const res = await request(app).patch(`${base}/members/u9/coach`).set(auth).send({ isCoach: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId: 'u9', isCoach: true });
  });

  it('200 : décoche → soft-disable', async () => {
    prismaMock.coach.updateMany.mockResolvedValue({ count: 1 } as any);
    const res = await request(app).patch(`${base}/members/u9/coach`).set(auth).send({ isCoach: false });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId: 'u9', isCoach: false });
  });

  it('404 MEMBER_NOT_FOUND si la cible est hors fichier-membres', async () => {
    prismaMock.clubMembership.findUnique.mockResolvedValue(null as any);
    const res = await request(app).patch(`${base}/members/u9/coach`).set(auth).send({ isCoach: true });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('MEMBER_NOT_FOUND');
  });
});
