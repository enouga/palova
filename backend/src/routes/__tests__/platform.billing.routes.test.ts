import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const stripeMock = {
  products: { retrieve: jest.fn(), create: jest.fn() },
  prices: { list: jest.fn(), create: jest.fn() },
  subscriptions: { retrieve: jest.fn(), update: jest.fn() },
  invoices: { list: jest.fn() },
};
jest.mock('../../db/stripe', () => ({ stripe: stripeMock }));

import app from '../../app';

const SECRET = process.env.JWT_SECRET!;
if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET manquant dans l environnement de test (.env)');
const tokenFor = (id: string) => jwt.sign({ id, email: `${id}@x.fr` }, SECRET, { expiresIn: '1h' });
const superToken = tokenFor('admin');

beforeEach(() => {
  jest.clearAllMocks();
  stripeMock.prices.list.mockResolvedValue({ data: [] });
  stripeMock.products.retrieve.mockResolvedValue({ id: 'palova-club' });
  stripeMock.prices.create.mockImplementation(async (p: any) => ({ id: `price_${p.lookup_key}`, lookup_key: p.lookup_key }));
});

describe('POST /api/platform/billing/sync-invoices', () => {
  it('401 sans token', async () => {
    expect((await request(app).post('/api/platform/billing/sync-invoices')).status).toBe(401);
  });
  it('403 non super-admin', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ isSuperAdmin: false } as any);
    const res = await request(app).post('/api/platform/billing/sync-invoices').set('Authorization', `Bearer ${tokenFor('u1')}`);
    expect(res.status).toBe(403);
  });
  it('200 renvoie { clubs, imported }', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ isSuperAdmin: true } as any);
    prismaMock.club.findMany.mockResolvedValue([] as any);
    const res = await request(app).post('/api/platform/billing/sync-invoices').set('Authorization', `Bearer ${superToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ clubs: 0, imported: 0 });
  });
});

describe('GET /api/platform/billing/overview', () => {
  it('200 forme attendue', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ isSuperAdmin: true } as any);
    prismaMock.club.findMany.mockResolvedValue([] as any);
    prismaMock.platformInvoice.findMany.mockResolvedValue([] as any);
    const res = await request(app).get('/api/platform/billing/overview').set('Authorization', `Bearer ${superToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('mrrCents');
    expect(res.body.revenueByMonth).toHaveLength(12);
  });
});

describe('GET /api/platform/stats/usage', () => {
  it('200 croissance + activité', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ isSuperAdmin: true } as any);
    prismaMock.club.findMany.mockResolvedValueOnce([] as any).mockResolvedValueOnce([] as any);
    prismaMock.user.findMany.mockResolvedValue([] as any);
    prismaMock.$queryRaw.mockResolvedValue([] as any);
    const res = await request(app).get('/api/platform/stats/usage').set('Authorization', `Bearer ${superToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('months');
    expect(res.body.growth).toHaveProperty('reservations');
  });
});

describe('GET /api/platform/clubs/:id', () => {
  it('404 si le club n existe pas', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ isSuperAdmin: true } as any);
    prismaMock.club.findUnique.mockResolvedValue(null as any);
    const res = await request(app).get('/api/platform/clubs/absent').set('Authorization', `Bearer ${superToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('CLUB_NOT_FOUND');
  });

  it('200 renvoie la fiche détaillée', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ isSuperAdmin: true } as any);
    prismaMock.club.findUnique.mockResolvedValue({
      id: 'club-1', slug: 'arena', name: 'Arena', city: 'Paris', address: '', timezone: 'Europe/Paris',
      status: 'ACTIVE', createdAt: new Date('2026-01-01'), billingExempt: false,
      activeMemberCount: 10, activeMemberCountAt: null, members: [], slugAliases: [],
      platformSubscription: null,
      _count: { clubMemberships: 0, resources: 0, tournaments: 0, clubEvents: 0 },
    } as any);
    prismaMock.clubMemberSnapshot.findMany.mockResolvedValue([] as any);
    prismaMock.platformInvoice.findMany.mockResolvedValue([] as any);
    prismaMock.reservation.findMany.mockResolvedValue([] as any);
    prismaMock.reservation.count.mockResolvedValue(0 as any);
    prismaMock.reservation.findFirst.mockResolvedValue(null as any);
    const res = await request(app).get('/api/platform/clubs/club-1').set('Authorization', `Bearer ${superToken}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Arena');
    expect(res.body.activity.reservationsByMonth).toHaveLength(12);
  });
});

describe('POST /api/platform/clubs/:id/billing/tier', () => {
  const liveSub = {
    clubId: 'club-1', stripeSubscriptionId: 'sub_1', status: 'active', tier: 2, interval: 'month',
    currentPeriodEnd: new Date('2026-08-01'), cancelAtPeriodEnd: false,
  };
  beforeEach(() => {
    stripeMock.subscriptions.retrieve.mockResolvedValue({
      id: 'sub_1', items: { data: [{ id: 'si_1', price: { lookup_key: 'palova_t2_month' } }] },
    });
    stripeMock.subscriptions.update.mockResolvedValue({});
  });

  it('200 change le palier', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ isSuperAdmin: true } as any);
    prismaMock.platformSubscription.findUnique.mockResolvedValue(liveSub as any);
    prismaMock.platformSubscription.update.mockResolvedValue({ ...liveSub, tier: 3 } as any);
    const res = await request(app).post('/api/platform/clubs/club-1/billing/tier')
      .set('Authorization', `Bearer ${superToken}`).send({ tier: 3 });
    expect(res.status).toBe(200);
    expect(res.body.tier).toBe(3);
  });

  it('400 palier invalide', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ isSuperAdmin: true } as any);
    prismaMock.platformSubscription.findUnique.mockResolvedValue(liveSub as any);
    const res = await request(app).post('/api/platform/clubs/club-1/billing/tier')
      .set('Authorization', `Bearer ${superToken}`).send({ tier: 9 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('TIER_INVALID');
  });

  it('409 NO_SUBSCRIPTION si le club n a pas d abonnement', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ isSuperAdmin: true } as any);
    prismaMock.platformSubscription.findUnique.mockResolvedValue(null as any);
    const res = await request(app).post('/api/platform/clubs/club-1/billing/tier')
      .set('Authorization', `Bearer ${superToken}`).send({ tier: 3 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('NO_SUBSCRIPTION');
  });
});

describe('POST /api/platform/clubs/:id/billing/{cancel,resume}', () => {
  const liveSub = {
    clubId: 'club-1', stripeSubscriptionId: 'sub_1', status: 'active', tier: 2, interval: 'month',
    currentPeriodEnd: new Date('2026-08-01'), cancelAtPeriodEnd: false,
  };
  beforeEach(() => { stripeMock.subscriptions.update.mockResolvedValue({}); });

  it('200 cancel', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ isSuperAdmin: true } as any);
    prismaMock.platformSubscription.findUnique.mockResolvedValue(liveSub as any);
    prismaMock.platformSubscription.update.mockResolvedValue({ ...liveSub, cancelAtPeriodEnd: true } as any);
    const res = await request(app).post('/api/platform/clubs/club-1/billing/cancel').set('Authorization', `Bearer ${superToken}`);
    expect(res.status).toBe(200);
    expect(res.body.cancelAtPeriodEnd).toBe(true);
  });

  it('200 resume', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ isSuperAdmin: true } as any);
    prismaMock.platformSubscription.findUnique.mockResolvedValue({ ...liveSub, cancelAtPeriodEnd: true } as any);
    prismaMock.platformSubscription.update.mockResolvedValue({ ...liveSub, cancelAtPeriodEnd: false } as any);
    const res = await request(app).post('/api/platform/clubs/club-1/billing/resume').set('Authorization', `Bearer ${superToken}`);
    expect(res.status).toBe(200);
    expect(res.body.cancelAtPeriodEnd).toBe(false);
  });
});
