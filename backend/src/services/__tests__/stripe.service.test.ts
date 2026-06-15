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
