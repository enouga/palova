import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';

const SECRET = process.env.JWT_SECRET!;
if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET manquant');
const token = (id = 'admin-1') => jwt.sign({ id, email: 'a@x.fr' }, SECRET, { expiresIn: '1h' });
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
  memberRoles({ 'admin-1': 'ADMIN', 'staff-1': 'STAFF' });
});

it('GET /promotions → 200 (liste)', async () => {
  prismaMock.promotion.findMany.mockResolvedValue([] as any);
  const res = await request(app).get(`${base}/promotions`).set(auth);
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
});

it('401 sans token', async () => {
  const res = await request(app).get(`${base}/promotions`);
  expect(res.status).toBe(401);
});

it('403 pour un STAFF (route ADMIN)', async () => {
  const res = await request(app).get(`${base}/promotions`).set({ Authorization: `Bearer ${token('staff-1')}` });
  expect(res.status).toBe(403);
});

it('POST /promotions → 201', async () => {
  prismaMock.promotion.create.mockResolvedValue({
    id: 'promo-1', clubId: 'club-demo', name: 'Été', startDate: new Date('2026-08-01T00:00:00Z'), endDate: new Date('2026-08-31T00:00:00Z'),
    windowStart: null, windowEnd: null, kind: 'PERCENT', percentOff: 20, fixedPrice: null, enabled: true, createdAt: new Date(), resources: [],
  } as any);
  const res = await request(app).post(`${base}/promotions`).set(auth)
    .send({ name: 'Été', startDate: '2026-08-01', endDate: '2026-08-31', kind: 'PERCENT', percentOff: 20, resourceIds: [] });
  expect(res.status).toBe(201);
  expect(res.body.id).toBe('promo-1');
});

it('POST /promotions invalide → 400', async () => {
  const res = await request(app).post(`${base}/promotions`).set(auth)
    .send({ name: '', startDate: '2026-08-01', endDate: '2026-08-31', kind: 'PERCENT', percentOff: 20 });
  expect(res.status).toBe(400);
  expect(res.body.error).toBe('VALIDATION_ERROR');
});

it('PATCH /promotions/:id d’un autre club → 404', async () => {
  prismaMock.promotion.findUnique.mockResolvedValue({ id: 'promo-1', clubId: 'autre', resources: [] } as any);
  const res = await request(app).patch(`${base}/promotions/promo-1`).set(auth).send({ enabled: false });
  expect(res.status).toBe(404);
  expect(res.body.error).toBe('PROMOTION_NOT_FOUND');
});

it('DELETE /promotions/:id → 200', async () => {
  prismaMock.promotion.findUnique.mockResolvedValue({ id: 'promo-1', clubId: 'club-demo' } as any);
  prismaMock.promotion.delete.mockResolvedValue({ id: 'promo-1' } as any);
  const res = await request(app).delete(`${base}/promotions/promo-1`).set(auth);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: true });
});
