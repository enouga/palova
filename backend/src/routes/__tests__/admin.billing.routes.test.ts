import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';

jest.mock('../../services/platformBilling/stripeBilling', () => ({
  createBillingCheckout: jest.fn(),
  createBillingPortal: jest.fn(),
}));

import { createBillingCheckout, createBillingPortal } from '../../services/platformBilling/stripeBilling';
import app from '../../app';

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET manquant');
const auth = { Authorization: `Bearer ${jwt.sign({ id: 'u1', email: 'owner@x.fr' }, process.env.JWT_SECRET!)}` };
const BASE = '/api/clubs/club-demo/admin/billing';

function mockRole(role: 'OWNER' | 'ADMIN' | 'STAFF') {
  prismaMock.clubMember.findUnique.mockResolvedValue({ userId: 'u1', clubId: 'club-demo', role } as any);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRole('ADMIN');
  prismaMock.club.findUnique.mockResolvedValue({
    activeMemberCount: 180, activeMemberCountAt: new Date('2026-07-07T04:00:00Z'), billingExempt: false,
  } as any);
  prismaMock.platformSubscription.findUnique.mockResolvedValue(null);
  prismaMock.clubMemberSnapshot.findMany.mockResolvedValue([
    { month: '2026-06', activeMembers: 170, observedTier: 2 },
  ] as any);
});

describe('GET /billing', () => {
  it('401 sans token', async () => {
    expect((await request(app).get(BASE)).status).toBe(401);
  });

  it('403 pour STAFF', async () => {
    mockRole('STAFF');
    expect((await request(app).get(BASE).set(auth)).status).toBe(403);
  });

  it('200 : état consolidé TO_REGULARIZE avec palier observé et prix', async () => {
    const res = await request(app).get(BASE).set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      activeMembers: 180,
      observedTier: 2,
      monthlyPriceCents: 5900,
      yearlyPriceCents: 60200,
      state: 'TO_REGULARIZE',
      subscription: null,
    });
    expect(res.body.snapshots).toHaveLength(1);
  });

  it('200 : abonnement actif → OK + détail', async () => {
    prismaMock.platformSubscription.findUnique.mockResolvedValue({
      status: 'active', tier: 2, interval: 'month',
      currentPeriodEnd: new Date('2026-08-01T00:00:00Z'), cancelAtPeriodEnd: false,
    } as any);
    const res = await request(app).get(BASE).set(auth);
    expect(res.body.state).toBe('OK');
    expect(res.body.subscription).toMatchObject({ tier: 2, interval: 'month', priceCents: 5900 });
  });
});

describe('POST /billing/checkout', () => {
  it('403 pour ADMIN (OWNER requis)', async () => {
    const res = await request(app).post(`${BASE}/checkout`).set(auth)
      .send({ interval: 'month', returnUrl: 'https://club.palova.fr/admin/billing' });
    expect(res.status).toBe(403);
  });

  it('200 pour OWNER : renvoie l URL de checkout', async () => {
    mockRole('OWNER');
    (createBillingCheckout as jest.Mock).mockResolvedValue('https://checkout.stripe.com/x');
    const res = await request(app).post(`${BASE}/checkout`).set(auth)
      .send({ interval: 'year', returnUrl: 'https://club.palova.fr/admin/billing' });
    expect(res.status).toBe(200);
    expect(res.body.url).toBe('https://checkout.stripe.com/x');
    expect(createBillingCheckout).toHaveBeenCalledWith('club-demo', 'year', 'https://club.palova.fr/admin/billing');
  });

  it('400 si interval invalide ou returnUrl non http', async () => {
    mockRole('OWNER');
    expect((await request(app).post(`${BASE}/checkout`).set(auth).send({ interval: 'week', returnUrl: 'https://x' })).status).toBe(400);
    expect((await request(app).post(`${BASE}/checkout`).set(auth).send({ interval: 'month', returnUrl: 'javascript:x' })).status).toBe(400);
  });

  it('409 si ALREADY_SUBSCRIBED', async () => {
    mockRole('OWNER');
    (createBillingCheckout as jest.Mock).mockRejectedValue(new Error('ALREADY_SUBSCRIBED'));
    const res = await request(app).post(`${BASE}/checkout`).set(auth)
      .send({ interval: 'month', returnUrl: 'https://x' });
    expect(res.status).toBe(409);
  });
});

describe('POST /billing/portal', () => {
  it('200 pour OWNER', async () => {
    mockRole('OWNER');
    (createBillingPortal as jest.Mock).mockResolvedValue('https://billing.stripe.com/p');
    const res = await request(app).post(`${BASE}/portal`).set(auth).send({ returnUrl: 'https://x' });
    expect(res.body.url).toBe('https://billing.stripe.com/p');
  });

  it('409 si NO_BILLING_ACCOUNT', async () => {
    mockRole('OWNER');
    (createBillingPortal as jest.Mock).mockRejectedValue(new Error('NO_BILLING_ACCOUNT'));
    expect((await request(app).post(`${BASE}/portal`).set(auth).send({ returnUrl: 'https://x' })).status).toBe(409);
  });
});
