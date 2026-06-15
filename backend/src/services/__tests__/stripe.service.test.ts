import { StripeService } from '../stripe.service';

jest.mock('../../db/prisma', () => ({
  prisma: {
    club: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    user: { findUnique: jest.fn() },
    clubStripeCustomer: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

jest.mock('../../db/stripe', () => ({
  stripe: {
    accounts: {
      create: jest.fn(),
      retrieve: jest.fn(),
      createLoginLink: jest.fn(),
    },
    accountLinks: { create: jest.fn() },
    customers: { create: jest.fn() },
    paymentIntents: { create: jest.fn(), retrieve: jest.fn() },
    setupIntents:   { create: jest.fn(), retrieve: jest.fn() },
    refunds:        { create: jest.fn() },
  },
}));

import { prisma } from '../../db/prisma';
import { stripe } from '../../db/stripe';

const mockClub = (overrides = {}) => ({
  id: 'club-1',
  stripeAccountId: null,
  stripeAccountStatus: 'NONE',
  ...overrides,
});

beforeEach(() => jest.clearAllMocks());

const svc = new StripeService();

describe('createConnectedAccount', () => {
  it('crée un nouveau compte si stripeAccountId absent', async () => {
    (prisma.club.findUnique as jest.Mock).mockResolvedValue(mockClub());
    (stripe.accounts.create as jest.Mock).mockResolvedValue({ id: 'acct_new' });
    (prisma.club.update as jest.Mock).mockResolvedValue({});
    (stripe.accountLinks.create as jest.Mock).mockResolvedValue({ url: 'https://connect.stripe.com/xxx' });

    const url = await svc.createConnectedAccount('club-1', 'https://r.fr', 'https://ret.fr');

    expect(stripe.accounts.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'express' }));
    expect(prisma.club.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ stripeAccountId: 'acct_new', stripeAccountStatus: 'PENDING' }),
    }));
    expect(url).toBe('https://connect.stripe.com/xxx');
  });

  it('réutilise le compte existant si stripeAccountId déjà présent', async () => {
    (prisma.club.findUnique as jest.Mock).mockResolvedValue(mockClub({ stripeAccountId: 'acct_existing' }));
    (stripe.accountLinks.create as jest.Mock).mockResolvedValue({ url: 'https://connect.stripe.com/yyy' });

    const url = await svc.createConnectedAccount('club-1', 'https://r.fr', 'https://ret.fr');

    expect(stripe.accounts.create).not.toHaveBeenCalled();
    expect(url).toBe('https://connect.stripe.com/yyy');
  });
});

describe('syncAccountStatus', () => {
  it('met stripeAccountStatus=ACTIVE si charges_enabled=true', async () => {
    (prisma.club.findUnique as jest.Mock).mockResolvedValue(mockClub({ stripeAccountId: 'acct_1' }));
    (stripe.accounts.retrieve as jest.Mock).mockResolvedValue({ charges_enabled: true, details_submitted: true });
    (prisma.club.update as jest.Mock).mockResolvedValue({});

    const status = await svc.syncAccountStatus('club-1');
    expect(status).toBe('ACTIVE');
    expect(prisma.club.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { stripeAccountStatus: 'ACTIVE' },
    }));
  });

  it('met stripeAccountStatus=RESTRICTED si details_submitted mais charges_enabled=false', async () => {
    (prisma.club.findUnique as jest.Mock).mockResolvedValue(mockClub({ stripeAccountId: 'acct_1' }));
    (stripe.accounts.retrieve as jest.Mock).mockResolvedValue({ charges_enabled: false, details_submitted: true });
    (prisma.club.update as jest.Mock).mockResolvedValue({});

    const status = await svc.syncAccountStatus('club-1');
    expect(status).toBe('RESTRICTED');
  });

  it('met stripeAccountStatus=PENDING si onboarding incomplet', async () => {
    (prisma.club.findUnique as jest.Mock).mockResolvedValue(mockClub({ stripeAccountId: 'acct_1' }));
    (stripe.accounts.retrieve as jest.Mock).mockResolvedValue({ charges_enabled: false, details_submitted: false });
    (prisma.club.update as jest.Mock).mockResolvedValue({});

    const status = await svc.syncAccountStatus('club-1');
    expect(status).toBe('PENDING');
  });

  it('lève STRIPE_NOT_CONFIGURED si pas de stripeAccountId', async () => {
    (prisma.club.findUnique as jest.Mock).mockResolvedValue(mockClub());
    await expect(svc.syncAccountStatus('club-1')).rejects.toThrow('STRIPE_NOT_CONFIGURED');
  });
});

describe('createLoginLink', () => {
  it("retourne l'URL du tableau de bord Express", async () => {
    (prisma.club.findUnique as jest.Mock).mockResolvedValue(mockClub({ stripeAccountId: 'acct_1', stripeAccountStatus: 'ACTIVE' }));
    (stripe.accounts.createLoginLink as jest.Mock).mockResolvedValue({ url: 'https://dashboard.stripe.com/xxx' });

    const url = await svc.createLoginLink('club-1');
    expect(url).toBe('https://dashboard.stripe.com/xxx');
  });
});

describe('createOrGetCustomer', () => {
  it('crée un nouveau Customer Stripe si absent en base', async () => {
    (prisma.clubStripeCustomer.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.club.findUnique as jest.Mock).mockResolvedValue({ stripeAccountId: 'acct_1' });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ email: 'j@test.fr' });
    (stripe.customers.create as jest.Mock).mockResolvedValue({ id: 'cus_new' });
    (prisma.clubStripeCustomer.create as jest.Mock).mockResolvedValue({
      id: 'csc-1', stripeCustomerId: 'cus_new', defaultPaymentMethodId: null,
    });

    const result = await svc.createOrGetCustomer('club-1', 'user-1');

    expect(stripe.customers.create).toHaveBeenCalledWith(
      { email: 'j@test.fr' },
      { stripeAccount: 'acct_1' },
    );
    expect(result.stripeCustomerId).toBe('cus_new');
  });

  it('retourne le Customer existant sans appel Stripe', async () => {
    (prisma.clubStripeCustomer.findUnique as jest.Mock).mockResolvedValue({
      id: 'csc-1', stripeCustomerId: 'cus_existing', defaultPaymentMethodId: 'pm_xxx',
    });

    const result = await svc.createOrGetCustomer('club-1', 'user-1');

    expect(stripe.customers.create).not.toHaveBeenCalled();
    expect(result.stripeCustomerId).toBe('cus_existing');
  });
});

describe('createPaymentIntent', () => {
  it('crée un PaymentIntent sur le compte connecté', async () => {
    (prisma.clubStripeCustomer.findUnique as jest.Mock).mockResolvedValue({
      id: 'csc-1', stripeCustomerId: 'cus_1', defaultPaymentMethodId: null,
    });
    (prisma.club.findUnique as jest.Mock).mockResolvedValue({
      stripeAccountId: 'acct_1', stripeAccountStatus: 'ACTIVE',
    });
    (stripe.paymentIntents.create as jest.Mock).mockResolvedValue({ client_secret: 'pi_secret_xxx' });

    const result = await svc.createPaymentIntent({
      clubId: 'club-1', userId: 'user-1', reservationId: 'resa-1', amountCents: 2500,
    });

    expect(stripe.paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 2500,
        currency: 'eur',
        customer: 'cus_1',
        setup_future_usage: 'off_session',
      }),
      { stripeAccount: 'acct_1' },
    );
    expect(result.clientSecret).toBe('pi_secret_xxx');
  });

  it('lève STRIPE_NOT_CONFIGURED si status !== ACTIVE', async () => {
    (prisma.club.findUnique as jest.Mock).mockResolvedValue({
      stripeAccountId: 'acct_1', stripeAccountStatus: 'PENDING',
    });
    await expect(svc.createPaymentIntent({
      clubId: 'club-1', userId: 'user-1', reservationId: 'r-1', amountCents: 1000,
    })).rejects.toThrow('STRIPE_NOT_CONFIGURED');
  });
});

describe('createSetupIntent', () => {
  it('crée un SetupIntent off_session sur le compte connecté', async () => {
    (prisma.clubStripeCustomer.findUnique as jest.Mock).mockResolvedValue({
      id: 'csc-1', stripeCustomerId: 'cus_1', defaultPaymentMethodId: null,
    });
    (prisma.club.findUnique as jest.Mock).mockResolvedValue({
      stripeAccountId: 'acct_1', stripeAccountStatus: 'ACTIVE',
    });
    (stripe.setupIntents.create as jest.Mock).mockResolvedValue({ client_secret: 'seti_secret_yyy' });

    const result = await svc.createSetupIntent({
      clubId: 'club-1', userId: 'user-1', reservationId: 'resa-1',
    });

    expect(stripe.setupIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_1', usage: 'off_session' }),
      { stripeAccount: 'acct_1' },
    );
    expect(result.clientSecret).toBe('seti_secret_yyy');
  });
});
