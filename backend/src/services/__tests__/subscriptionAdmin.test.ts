import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';

const stripeMock = {
  products: { retrieve: jest.fn(), create: jest.fn() },
  prices: { list: jest.fn(), create: jest.fn() },
  subscriptions: { retrieve: jest.fn(), update: jest.fn() },
};
jest.mock('../../db/stripe', () => ({ stripe: stripeMock }));

import {
  setClubSubscriptionTier, cancelClubSubscription, resumeClubSubscription,
} from '../platformBilling/subscriptionAdmin';

beforeEach(() => {
  jest.clearAllMocks();
  stripeMock.prices.list.mockResolvedValue({ data: [] });
  stripeMock.products.retrieve.mockResolvedValue({ id: 'palova-club' });
  stripeMock.prices.create.mockImplementation(async (p: any) => ({ id: `price_${p.lookup_key}`, lookup_key: p.lookup_key }));
  stripeMock.subscriptions.retrieve.mockResolvedValue({
    id: 'sub_1', items: { data: [{ id: 'si_1', price: { lookup_key: 'palova_t2_month' } }] },
  });
  stripeMock.subscriptions.update.mockResolvedValue({});
});

const liveSub = {
  clubId: 'club-1', stripeSubscriptionId: 'sub_1', status: 'active', tier: 2, interval: 'month',
  currentPeriodEnd: new Date('2026-08-01'), cancelAtPeriodEnd: false,
};

describe('setClubSubscriptionTier', () => {
  it('change le palier côté Stripe puis met à jour la ligne locale', async () => {
    prismaMock.platformSubscription.findUnique.mockResolvedValue(liveSub as any);
    prismaMock.platformSubscription.update.mockResolvedValue({ ...liveSub, tier: 3 } as any);
    const out = await setClubSubscriptionTier('club-1', 3);
    expect(stripeMock.subscriptions.update).toHaveBeenCalledWith('sub_1', expect.objectContaining({
      items: [{ id: 'si_1', price: 'price_palova_t3_month' }], proration_behavior: 'none',
    }));
    expect(prismaMock.platformSubscription.update).toHaveBeenCalledWith({
      where: { clubId: 'club-1' }, data: { tier: 3 },
    });
    expect(out.tier).toBe(3);
  });

  it('change aussi la cadence si interval fourni (annuel)', async () => {
    prismaMock.platformSubscription.findUnique.mockResolvedValue(liveSub as any);
    prismaMock.platformSubscription.update.mockResolvedValue({ ...liveSub, tier: 3, interval: 'year' } as any);
    await setClubSubscriptionTier('club-1', 3, 'year');
    expect(stripeMock.subscriptions.update).toHaveBeenCalledWith('sub_1', expect.objectContaining({
      items: [{ id: 'si_1', price: 'price_palova_t3_year' }],
    }));
    expect(prismaMock.platformSubscription.update).toHaveBeenCalledWith({
      where: { clubId: 'club-1' }, data: { tier: 3, interval: 'year' },
    });
  });

  it('TIER_INVALID pour un palier hors 1..4', async () => {
    await expect(setClubSubscriptionTier('club-1', 0)).rejects.toThrow('TIER_INVALID');
    await expect(setClubSubscriptionTier('club-1', 5)).rejects.toThrow('TIER_INVALID');
    await expect(setClubSubscriptionTier('club-1', 'x')).rejects.toThrow('TIER_INVALID');
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
  });

  it('VALIDATION_ERROR pour une cadence invalide', async () => {
    await expect(setClubSubscriptionTier('club-1', 2, 'weekly')).rejects.toThrow('VALIDATION_ERROR');
  });

  it('NO_SUBSCRIPTION si aucun abonnement', async () => {
    prismaMock.platformSubscription.findUnique.mockResolvedValue(null as any);
    await expect(setClubSubscriptionTier('club-1', 2)).rejects.toThrow('NO_SUBSCRIPTION');
  });

  it('NO_SUBSCRIPTION si l abonnement est canceled', async () => {
    prismaMock.platformSubscription.findUnique.mockResolvedValue({ ...liveSub, status: 'canceled' } as any);
    await expect(setClubSubscriptionTier('club-1', 2)).rejects.toThrow('NO_SUBSCRIPTION');
  });
});

describe('cancelClubSubscription', () => {
  it('programme l annulation à échéance', async () => {
    prismaMock.platformSubscription.findUnique.mockResolvedValue(liveSub as any);
    prismaMock.platformSubscription.update.mockResolvedValue({ ...liveSub, cancelAtPeriodEnd: true } as any);
    const out = await cancelClubSubscription('club-1');
    expect(stripeMock.subscriptions.update).toHaveBeenCalledWith('sub_1', { cancel_at_period_end: true });
    expect(prismaMock.platformSubscription.update).toHaveBeenCalledWith({
      where: { clubId: 'club-1' }, data: { cancelAtPeriodEnd: true },
    });
    expect(out.cancelAtPeriodEnd).toBe(true);
  });

  it('NO_SUBSCRIPTION si aucun abonnement live', async () => {
    prismaMock.platformSubscription.findUnique.mockResolvedValue(null as any);
    await expect(cancelClubSubscription('club-1')).rejects.toThrow('NO_SUBSCRIPTION');
  });
});

describe('resumeClubSubscription', () => {
  it('lève l annulation programmée', async () => {
    prismaMock.platformSubscription.findUnique.mockResolvedValue({ ...liveSub, cancelAtPeriodEnd: true } as any);
    prismaMock.platformSubscription.update.mockResolvedValue({ ...liveSub, cancelAtPeriodEnd: false } as any);
    const out = await resumeClubSubscription('club-1');
    expect(stripeMock.subscriptions.update).toHaveBeenCalledWith('sub_1', { cancel_at_period_end: false });
    expect(out.cancelAtPeriodEnd).toBe(false);
  });
});
