import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';

const stripeMock = {
  products: { retrieve: jest.fn(), create: jest.fn() },
  prices: { list: jest.fn(), create: jest.fn() },
  taxRates: { list: jest.fn(), create: jest.fn() },
  customers: { create: jest.fn() },
  checkout: { sessions: { create: jest.fn() } },
  billingPortal: {
    configurations: { list: jest.fn(), create: jest.fn() },
    sessions: { create: jest.fn() },
  },
  subscriptions: { retrieve: jest.fn(), update: jest.fn() },
};
jest.mock('../../db/stripe', () => ({ stripe: stripeMock }));

import {
  subscriptionFields, createBillingCheckout, ensurePlatformPrices, syncSubscription,
} from '../platformBilling/stripeBilling';

beforeEach(() => {
  jest.clearAllMocks();
  stripeMock.prices.list.mockResolvedValue({ data: [] });
  stripeMock.products.retrieve.mockResolvedValue({ id: 'palova-club' });
  stripeMock.prices.create.mockImplementation(async (p: any) => ({ id: `price_${p.lookup_key}`, lookup_key: p.lookup_key }));
});

describe('ensurePlatformPrices', () => {
  it('crée les 8 prix manquants par lookup_key', async () => {
    const map = await ensurePlatformPrices();
    expect(stripeMock.prices.create).toHaveBeenCalledTimes(8);
    expect(map['palova_t1_month']).toBe('price_palova_t1_month');
    expect(stripeMock.prices.create).toHaveBeenCalledWith(expect.objectContaining({
      lookup_key: 'palova_t4_year', unit_amount: 152000, currency: 'eur',
      recurring: { interval: 'year' }, tax_behavior: 'exclusive',
    }));
  });

  it('ne recrée pas les prix existants', async () => {
    stripeMock.prices.list.mockResolvedValue({
      data: [{ id: 'price_x', lookup_key: 'palova_t1_month' }],
    });
    const map = await ensurePlatformPrices();
    expect(map['palova_t1_month']).toBe('price_x');
    expect(stripeMock.prices.create).toHaveBeenCalledTimes(7);
  });
});

describe('subscriptionFields', () => {
  it('extrait statut/palier/cadence/période depuis le lookup_key du price', () => {
    const sub: any = {
      status: 'active',
      cancel_at_period_end: false,
      items: { data: [{ price: { lookup_key: 'palova_t2_year' }, current_period_end: 1790000000 }] },
    };
    expect(subscriptionFields(sub)).toEqual({
      status: 'active', tier: 2, interval: 'year',
      currentPeriodEnd: new Date(1790000000 * 1000), cancelAtPeriodEnd: false,
    });
  });
  it('null si le price ne vient pas de Palova', () => {
    expect(subscriptionFields({ status: 'active', items: { data: [{ price: { lookup_key: 'autre' } }] } } as any)).toBeNull();
  });
});

describe('syncSubscription', () => {
  it('upsert la ligne PlatformSubscription', async () => {
    prismaMock.platformSubscription.upsert.mockResolvedValue({} as any);
    const sub: any = {
      id: 'sub_1', status: 'active', cancel_at_period_end: true,
      items: { data: [{ price: { lookup_key: 'palova_t1_month' }, current_period_end: 1790000000 }] },
    };
    await syncSubscription('club-1', sub);
    expect(prismaMock.platformSubscription.upsert).toHaveBeenCalledWith({
      where: { clubId: 'club-1' },
      update: expect.objectContaining({ stripeSubscriptionId: 'sub_1', status: 'active', tier: 1, cancelAtPeriodEnd: true }),
      create: expect.objectContaining({ clubId: 'club-1', stripeSubscriptionId: 'sub_1', tier: 1 }),
    });
  });
});

describe('createBillingCheckout', () => {
  beforeEach(() => {
    prismaMock.club.findUnique.mockResolvedValue({
      activeMemberCount: 200, platformCustomerId: 'cus_1', name: 'Club', slug: 'club',
      legalEmail: null, members: [],
    } as any);
    prismaMock.platformSubscription.findUnique.mockResolvedValue(null);
    stripeMock.taxRates.list.mockResolvedValue({ data: [{ id: 'txr_1', percentage: 20, display_name: 'TVA' }] });
    stripeMock.checkout.sessions.create.mockResolvedValue({ url: 'https://checkout.stripe.com/x' });
  });

  it('crée une session au prix du palier observé (200 membres → t2)', async () => {
    const url = await createBillingCheckout('club-1', 'month', 'https://club.palova.fr/admin/billing');
    expect(url).toBe('https://checkout.stripe.com/x');
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'subscription',
      customer: 'cus_1',
      client_reference_id: 'club-1',
      line_items: [{ price: 'price_palova_t2_month', quantity: 1 }],
      subscription_data: { default_tax_rates: ['txr_1'], metadata: { clubId: 'club-1' } },
    }));
  });

  it('refuse si déjà abonné (non canceled)', async () => {
    prismaMock.platformSubscription.findUnique.mockResolvedValue({ status: 'active' } as any);
    await expect(createBillingCheckout('club-1', 'month', 'https://x')).rejects.toThrow('ALREADY_SUBSCRIBED');
  });

  it('refuse si palier observé = 0', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ activeMemberCount: 10, platformCustomerId: 'cus_1', members: [] } as any);
    await expect(createBillingCheckout('club-1', 'month', 'https://x')).rejects.toThrow('NOTHING_TO_SUBSCRIBE');
  });
});
