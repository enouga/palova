import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';

const SECRET = process.env.JWT_SECRET!;
if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET manquant');
const token = () => jwt.sign({ id: 'staff-1', email: 's@x.fr' }, SECRET, { expiresIn: '1h' });
const auth = { Authorization: `Bearer ${token()}` };
const base = '/api/clubs/club-demo/admin';

// clubMember.findUnique sert au middleware requireClubMember('STAFF') (rôle de l'ACTEUR).
const memberRoles = (roles: Record<string, 'OWNER' | 'ADMIN' | 'STAFF'>) =>
  prismaMock.clubMember.findUnique.mockImplementation(((args: any) => {
    const userId = args?.where?.userId_clubId?.userId as string;
    const role = roles[userId];
    return Promise.resolve(role ? { userId, clubId: 'club-demo', role } : null);
  }) as any);

beforeEach(() => {
  jest.clearAllMocks();
  memberRoles({ 'staff-1': 'OWNER' });
  prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
  prismaMock.clubCounter.upsert.mockResolvedValue({ value: 1 } as any);
});

it('GET /subscriptions/overview → 200 (kpis/plans/subscribers)', async () => {
  prismaMock.subscription.findMany.mockResolvedValue([] as any);
  prismaMock.subscriptionPlan.findMany.mockResolvedValue([] as any);
  const res = await request(app).get(`${base}/subscriptions/overview`).set(auth);
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('kpis');
  expect(res.body).toHaveProperty('subscribers');
});

it('401 sans token', async () => {
  const res = await request(app).get(`${base}/subscriptions/overview`);
  expect(res.status).toBe(401);
});

it('POST /subscriptions/:id/renew → 200', async () => {
  prismaMock.subscription.findUnique.mockResolvedValue({ id: 's1', clubId: 'club-demo', status: 'ACTIVE', expiresAt: new Date(), monthlyPriceSnapshot: '39.00', plan: { name: 'X', commitmentMonths: 1 } } as any);
  prismaMock.subscription.update.mockResolvedValue({ id: 's1' } as any);
  prismaMock.payment.create.mockResolvedValue({ id: 'p' } as any);
  const res = await request(app).post(`${base}/subscriptions/s1/renew`).set(auth).send({ method: 'CARD' });
  expect(res.status).toBe(200);
});

it('POST /subscriptions/:id/renew sur CANCELLED → 409', async () => {
  prismaMock.subscription.findUnique.mockResolvedValue({ id: 's1', clubId: 'club-demo', status: 'CANCELLED', plan: { name: 'X', commitmentMonths: 1 } } as any);
  const res = await request(app).post(`${base}/subscriptions/s1/renew`).set(auth).send({});
  expect(res.status).toBe(409);
  expect(res.body.error).toBe('SUBSCRIPTION_NOT_RENEWABLE');
});

it('POST /subscriptions/:id/change → 200 (résilie + revend)', async () => {
  prismaMock.subscription.findUnique.mockResolvedValue({ id: 's1', clubId: 'club-demo', userId: 'u1' } as any);
  prismaMock.subscriptionPlan.findUnique.mockResolvedValue({
    id: 'p2', clubId: 'club-demo', isActive: true, name: 'Padel illimité', monthlyPrice: '39.00',
    commitmentMonths: 1, sportKeys: ['padel'], offPeakOnly: false, benefit: 'INCLUDED', discountPercent: null, dailyCap: null, weeklyCap: null,
  } as any);
  prismaMock.clubMembership.findUnique.mockResolvedValue({ id: 'm1' } as any);
  prismaMock.subscription.update.mockResolvedValue({ id: 's1', status: 'CANCELLED' } as any);
  prismaMock.subscription.create.mockResolvedValue({ id: 's-new', status: 'ACTIVE' } as any);
  prismaMock.payment.create.mockResolvedValue({ id: 'p' } as any);
  const res = await request(app).post(`${base}/subscriptions/s1/change`).set(auth).send({ planId: 'p2', method: 'CARD' });
  expect(res.status).toBe(200);
  expect(res.body.subscription.id).toBe('s-new');
});

it('POST /subscriptions/:id/cancel → 200 CANCELLED', async () => {
  prismaMock.subscription.findUnique.mockResolvedValue({ id: 's1', clubId: 'club-demo' } as any);
  prismaMock.subscription.update.mockResolvedValue({ id: 's1', status: 'CANCELLED' } as any);
  const res = await request(app).post(`${base}/subscriptions/s1/cancel`).set(auth);
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('CANCELLED');
});
