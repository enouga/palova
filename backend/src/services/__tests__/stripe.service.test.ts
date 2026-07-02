import { StripeService } from '../stripe.service';

jest.mock('../../db/prisma', () => {
  const prisma: Record<string, any> = {
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
      deleteMany: jest.fn(),
    },
    payment: { findMany: jest.fn() },
    // Exécute le callback de transaction avec `prisma` comme `tx`.
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  return { prisma };
});

jest.mock('../../db/stripe', () => ({
  stripe: {
    accounts: {
      create: jest.fn(),
      retrieve: jest.fn(),
      createLoginLink: jest.fn(),
    },
    accountLinks: { create: jest.fn() },
    customers: { create: jest.fn() },
    customerSessions: { create: jest.fn() },
    paymentIntents: { create: jest.fn(), retrieve: jest.fn() },
    setupIntents:   { create: jest.fn(), retrieve: jest.fn() },
    refunds:        { create: jest.fn() },
    paymentMethods: { retrieve: jest.fn(), detach: jest.fn() },
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
        payment_method_types: ['card'],
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

  it('crée une CustomerSession (redisplay + filtres) et renvoie son client_secret', async () => {
    (prisma.clubStripeCustomer.findUnique as jest.Mock).mockResolvedValue({
      id: 'csc-1', stripeCustomerId: 'cus_1', defaultPaymentMethodId: 'pm_saved',
    });
    (prisma.club.findUnique as jest.Mock).mockResolvedValue({
      stripeAccountId: 'acct_1', stripeAccountStatus: 'ACTIVE',
    });
    (stripe.paymentIntents.create as jest.Mock).mockResolvedValue({ client_secret: 'pi_secret_xxx' });
    (stripe.customerSessions.create as jest.Mock).mockResolvedValue({ client_secret: 'cuss_secret' });

    const result = await svc.createPaymentIntent({
      clubId: 'club-1', userId: 'user-1', reservationId: 'resa-1', amountCents: 2500,
    });

    expect(stripe.customerSessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_1',
        components: expect.objectContaining({
          payment_element: expect.objectContaining({
            enabled: true,
            features: expect.objectContaining({
              payment_method_redisplay: 'enabled',
              payment_method_allow_redisplay_filters: ['always', 'limited', 'unspecified'],
            }),
          }),
        }),
      }),
      { stripeAccount: 'acct_1' },
    );
    expect(result.clientSecret).toBe('pi_secret_xxx');
    expect(result.customerSessionClientSecret).toBe('cuss_secret');
  });

  it('renvoie customerSessionClientSecret=null si customerSessions.create échoue (paiement non bloqué)', async () => {
    (prisma.clubStripeCustomer.findUnique as jest.Mock).mockResolvedValue({
      id: 'csc-1', stripeCustomerId: 'cus_1', defaultPaymentMethodId: null,
    });
    (prisma.club.findUnique as jest.Mock).mockResolvedValue({
      stripeAccountId: 'acct_1', stripeAccountStatus: 'ACTIVE',
    });
    (stripe.paymentIntents.create as jest.Mock).mockResolvedValue({ client_secret: 'pi_secret_xxx' });
    (stripe.customerSessions.create as jest.Mock).mockRejectedValue(new Error('stripe down'));

    const result = await svc.createPaymentIntent({
      clubId: 'club-1', userId: 'user-1', reservationId: 'resa-1', amountCents: 2500,
    });

    expect(result.clientSecret).toBe('pi_secret_xxx');
    expect(result.customerSessionClientSecret).toBeNull();
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

  it('ne crée PAS de CustomerSession et renvoie customerSessionClientSecret=null', async () => {
    (prisma.clubStripeCustomer.findUnique as jest.Mock).mockResolvedValue({
      id: 'csc-1', stripeCustomerId: 'cus_1', defaultPaymentMethodId: 'pm_saved',
    });
    (prisma.club.findUnique as jest.Mock).mockResolvedValue({
      stripeAccountId: 'acct_1', stripeAccountStatus: 'ACTIVE',
    });
    (stripe.setupIntents.create as jest.Mock).mockResolvedValue({ client_secret: 'seti_secret_yyy' });

    const result = await svc.createSetupIntent({
      clubId: 'club-1', userId: 'user-1', reservationId: 'resa-1',
    });

    expect(stripe.customerSessions.create).not.toHaveBeenCalled();
    expect(result.customerSessionClientSecret).toBeNull();
  });
});

describe('chargeNoShow', () => {
  it('crée un PaymentIntent off_session confirmé et retourne son id', async () => {
    (prisma.club.findUnique as jest.Mock).mockResolvedValue({ stripeAccountId: 'acct_1' });
    (prisma.clubStripeCustomer.findUnique as jest.Mock).mockResolvedValue({
      stripeCustomerId: 'cus_1',
      defaultPaymentMethodId: 'pm_saved',
    });
    (stripe.paymentIntents.create as jest.Mock).mockResolvedValue({ id: 'pi_noshow_123' });

    const piId = await svc.chargeNoShow({
      clubId: 'club-1', userId: 'user-1', reservationId: 'resa-1',
      amountCents: 2500, createdByUserId: 'admin-1',
    });

    expect(stripe.paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 2500, currency: 'eur', off_session: true, confirm: true,
        payment_method: 'pm_saved',
      }),
      { stripeAccount: 'acct_1' },
    );
    expect(piId).toBe('pi_noshow_123');
  });

  it('lève NO_CARD_ON_FILE si pas de defaultPaymentMethodId', async () => {
    (prisma.club.findUnique as jest.Mock).mockResolvedValue({ stripeAccountId: 'acct_1' });
    (prisma.clubStripeCustomer.findUnique as jest.Mock).mockResolvedValue({
      stripeCustomerId: 'cus_1', defaultPaymentMethodId: null,
    });

    await expect(svc.chargeNoShow({
      clubId: 'club-1', userId: 'user-1', reservationId: 'r-1', amountCents: 1000,
    })).rejects.toThrow('NO_CARD_ON_FILE');
  });

  it('lève NO_CARD_ON_FILE si pas de ClubStripeCustomer', async () => {
    (prisma.club.findUnique as jest.Mock).mockResolvedValue({ stripeAccountId: 'acct_1' });
    (prisma.clubStripeCustomer.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(svc.chargeNoShow({
      clubId: 'club-1', userId: 'user-1', reservationId: 'r-1', amountCents: 1000,
    })).rejects.toThrow('NO_CARD_ON_FILE');
  });

  it('lève CARD_DECLINED si Stripe renvoie card_declined', async () => {
    (prisma.club.findUnique as jest.Mock).mockResolvedValue({ stripeAccountId: 'acct_1' });
    (prisma.clubStripeCustomer.findUnique as jest.Mock).mockResolvedValue({
      stripeCustomerId: 'cus_1', defaultPaymentMethodId: 'pm_saved',
    });
    const stripeErr = Object.assign(new Error('card declined'), { code: 'card_declined' });
    (stripe.paymentIntents.create as jest.Mock).mockRejectedValue(stripeErr);

    await expect(svc.chargeNoShow({
      clubId: 'club-1', userId: 'user-1', reservationId: 'r-1', amountCents: 1000,
    })).rejects.toThrow('CARD_DECLINED');
  });
});

describe('createRegistrationPaymentIntent', () => {
  it('crée un PaymentIntent avec tournamentRegistrationId dans les metadata', async () => {
    (prisma.clubStripeCustomer.findUnique as jest.Mock).mockResolvedValue({
      id: 'csc-1', stripeCustomerId: 'cus_1', defaultPaymentMethodId: null,
    });
    (prisma.club.findUnique as jest.Mock).mockResolvedValue({
      stripeAccountId: 'acct_1', stripeAccountStatus: 'ACTIVE',
    });
    (stripe.paymentIntents.create as jest.Mock).mockResolvedValue({ client_secret: 'pi_reg_secret' });

    const result = await svc.createRegistrationPaymentIntent({
      clubId: 'club-1', userId: 'user-1', registrationId: 'reg-1',
      kind: 'tournament', amountCents: 2000,
    });

    expect(stripe.paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 2000,
        currency: 'eur',
        customer: 'cus_1',
        setup_future_usage: 'off_session',
        payment_method_types: ['card'],
        metadata: expect.objectContaining({ tournamentRegistrationId: 'reg-1', clubId: 'club-1' }),
      }),
      { stripeAccount: 'acct_1' },
    );
    expect(result.clientSecret).toBe('pi_reg_secret');
  });

  it('lève STRIPE_NOT_CONFIGURED si status !== ACTIVE', async () => {
    (prisma.club.findUnique as jest.Mock).mockResolvedValue({
      stripeAccountId: 'acct_1', stripeAccountStatus: 'PENDING',
    });
    await expect(svc.createRegistrationPaymentIntent({
      clubId: 'club-1', userId: 'user-1', registrationId: 'reg-1',
      kind: 'tournament', amountCents: 1000,
    })).rejects.toThrow('STRIPE_NOT_CONFIGURED');
  });

  it('crée une CustomerSession et renvoie son client_secret', async () => {
    (prisma.clubStripeCustomer.findUnique as jest.Mock).mockResolvedValue({
      id: 'csc-1', stripeCustomerId: 'cus_1', defaultPaymentMethodId: 'pm_saved',
    });
    (prisma.club.findUnique as jest.Mock).mockResolvedValue({
      stripeAccountId: 'acct_1', stripeAccountStatus: 'ACTIVE',
    });
    (stripe.paymentIntents.create as jest.Mock).mockResolvedValue({ client_secret: 'pi_reg_secret' });
    (stripe.customerSessions.create as jest.Mock).mockResolvedValue({ client_secret: 'cuss_reg' });

    const result = await svc.createRegistrationPaymentIntent({
      clubId: 'club-1', userId: 'user-1', registrationId: 'reg-1',
      kind: 'tournament', amountCents: 2000,
    });

    expect(stripe.customerSessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_1',
        components: expect.objectContaining({
          payment_element: expect.objectContaining({
            enabled: true,
            features: expect.objectContaining({
              payment_method_redisplay: 'enabled',
              payment_method_allow_redisplay_filters: ['always', 'limited', 'unspecified'],
            }),
          }),
        }),
      }),
      { stripeAccount: 'acct_1' },
    );
    expect(result.customerSessionClientSecret).toBe('cuss_reg');
  });
});

describe('createRegistrationSetupIntent', () => {
  it('crée un SetupIntent avec eventRegistrationId dans les metadata', async () => {
    (prisma.clubStripeCustomer.findUnique as jest.Mock).mockResolvedValue({
      id: 'csc-1', stripeCustomerId: 'cus_1', defaultPaymentMethodId: null,
    });
    (prisma.club.findUnique as jest.Mock).mockResolvedValue({
      stripeAccountId: 'acct_1', stripeAccountStatus: 'ACTIVE',
    });
    (stripe.setupIntents.create as jest.Mock).mockResolvedValue({ client_secret: 'seti_reg_secret' });

    const result = await svc.createRegistrationSetupIntent({
      clubId: 'club-1', userId: 'user-1', registrationId: 'reg-event-1', kind: 'event',
    });

    expect(stripe.setupIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_1',
        usage: 'off_session',
        metadata: expect.objectContaining({ eventRegistrationId: 'reg-event-1', clubId: 'club-1' }),
      }),
      { stripeAccount: 'acct_1' },
    );
    expect(result.clientSecret).toBe('seti_reg_secret');
  });

  it('ne crée PAS de CustomerSession et renvoie customerSessionClientSecret=null', async () => {
    (prisma.clubStripeCustomer.findUnique as jest.Mock).mockResolvedValue({
      id: 'csc-1', stripeCustomerId: 'cus_1', defaultPaymentMethodId: 'pm_saved',
    });
    (prisma.club.findUnique as jest.Mock).mockResolvedValue({
      stripeAccountId: 'acct_1', stripeAccountStatus: 'ACTIVE',
    });
    (stripe.setupIntents.create as jest.Mock).mockResolvedValue({ client_secret: 'seti_reg_secret' });

    const result = await svc.createRegistrationSetupIntent({
      clubId: 'club-1', userId: 'user-1', registrationId: 'reg-event-1', kind: 'event',
    });

    expect(stripe.customerSessions.create).not.toHaveBeenCalled();
    expect(result.customerSessionClientSecret).toBeNull();
  });
});

describe('chargeRegistrationOffSession', () => {
  it('retourne le piId en cas de succès', async () => {
    (prisma.club.findUnique as jest.Mock).mockResolvedValue({ stripeAccountId: 'acct_1' });
    (prisma.clubStripeCustomer.findUnique as jest.Mock).mockResolvedValue({
      stripeCustomerId: 'cus_1', defaultPaymentMethodId: 'pm_saved',
    });
    (stripe.paymentIntents.create as jest.Mock).mockResolvedValue({ id: 'pi_reg_charge_1' });

    const piId = await svc.chargeRegistrationOffSession({
      clubId: 'club-1', userId: 'user-1', registrationId: 'reg-1',
      kind: 'tournament', amountCents: 3000,
    });

    expect(stripe.paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 3000, currency: 'eur', off_session: true, confirm: true,
        payment_method: 'pm_saved',
        metadata: expect.objectContaining({ tournamentRegistrationId: 'reg-1' }),
      }),
      { stripeAccount: 'acct_1' },
    );
    expect(piId).toBe('pi_reg_charge_1');
  });

  it('lève CARD_DECLINED si Stripe renvoie card_declined (kind=event)', async () => {
    (prisma.club.findUnique as jest.Mock).mockResolvedValue({ stripeAccountId: 'acct_1' });
    (prisma.clubStripeCustomer.findUnique as jest.Mock).mockResolvedValue({
      stripeCustomerId: 'cus_1', defaultPaymentMethodId: 'pm_saved',
    });
    const stripeErr = Object.assign(new Error('card declined'), { code: 'card_declined' });
    (stripe.paymentIntents.create as jest.Mock).mockRejectedValue(stripeErr);

    await expect(svc.chargeRegistrationOffSession({
      clubId: 'club-1', userId: 'user-1', registrationId: 'reg-event-1',
      kind: 'event', amountCents: 1500,
    })).rejects.toThrow('CARD_DECLINED');
  });

  it('lève NO_CARD_ON_FILE si pas de defaultPaymentMethodId', async () => {
    (prisma.club.findUnique as jest.Mock).mockResolvedValue({ stripeAccountId: 'acct_1' });
    (prisma.clubStripeCustomer.findUnique as jest.Mock).mockResolvedValue({
      stripeCustomerId: 'cus_1', defaultPaymentMethodId: null,
    });

    await expect(svc.chargeRegistrationOffSession({
      clubId: 'club-1', userId: 'user-1', registrationId: 'reg-1',
      kind: 'event', amountCents: 1000,
    })).rejects.toThrow('NO_CARD_ON_FILE');
  });

  it('transmet idempotencyKey dans les options Stripe quand fournie', async () => {
    (prisma.club.findUnique as jest.Mock).mockResolvedValue({ stripeAccountId: 'acct_1' });
    (prisma.clubStripeCustomer.findUnique as jest.Mock).mockResolvedValue({
      stripeCustomerId: 'cus_1', defaultPaymentMethodId: 'pm_saved',
    });
    (stripe.paymentIntents.create as jest.Mock).mockResolvedValue({ id: 'pi_idem' });

    await svc.chargeRegistrationOffSession({
      clubId: 'club-1', userId: 'user-1', registrationId: 'reg-1',
      kind: 'tournament', amountCents: 3000, idempotencyKey: 'reg-charge-reg-1',
    });

    expect(stripe.paymentIntents.create).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ stripeAccount: 'acct_1', idempotencyKey: 'reg-charge-reg-1' }),
    );
  });
});

describe('refundPaymentIntent', () => {
  it('appelle stripe.refunds.create sur le compte connecté', async () => {
    (stripe.refunds.create as jest.Mock).mockResolvedValue({ id: 'ref_1' });

    await svc.refundPaymentIntent({
      stripeAccountId: 'acct_1', paymentIntentId: 'pi_1', amountCents: 500,
    });

    expect(stripe.refunds.create).toHaveBeenCalledWith(
      { payment_intent: 'pi_1', amount: 500 },
      { stripeAccount: 'acct_1' },
    );
  });
});

describe('disconnectAccount', () => {
  it('délie le compte, reset les flags et purge les ClubStripeCustomer', async () => {
    (prisma.club.findUnique as jest.Mock).mockResolvedValue(mockClub({ stripeAccountId: 'acct_1' }));
    (prisma.payment.findMany as jest.Mock).mockResolvedValue([]); // aucun paiement en attente
    (prisma.club.update as jest.Mock).mockResolvedValue({});
    (prisma.clubStripeCustomer.deleteMany as jest.Mock).mockResolvedValue({ count: 3 });

    await svc.disconnectAccount('club-1');

    expect(prisma.club.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'club-1' },
      data: {
        stripeAccountId: null,
        stripeAccountStatus: 'NONE',
        requireOnlinePayment: false,
        requireCardFingerprint: false,
      },
    }));
    expect(prisma.clubStripeCustomer.deleteMany).toHaveBeenCalledWith({ where: { clubId: 'club-1' } });
  });

  it('bloque (STRIPE_HAS_PENDING_ONLINE_PAYMENTS + count) si un paiement ONLINE non remboursé reste sur une réservation à venir', async () => {
    (prisma.club.findUnique as jest.Mock).mockResolvedValue(mockClub({ stripeAccountId: 'acct_1' }));
    (prisma.payment.findMany as jest.Mock).mockResolvedValue([
      { amount: 25, refundedAmount: 25 },  // entièrement remboursé → ne compte pas
      { amount: 25, refundedAmount: 0 },   // remboursable → compte
    ]);

    await expect(svc.disconnectAccount('club-1')).rejects.toMatchObject({
      message: 'STRIPE_HAS_PENDING_ONLINE_PAYMENTS',
      count: 1,
    });
    expect(prisma.club.update).not.toHaveBeenCalled();
    expect(prisma.clubStripeCustomer.deleteMany).not.toHaveBeenCalled();
  });

  it('lève STRIPE_NOT_CONFIGURED si aucun compte lié', async () => {
    (prisma.club.findUnique as jest.Mock).mockResolvedValue(mockClub()); // stripeAccountId null
    await expect(svc.disconnectAccount('club-1')).rejects.toThrow('STRIPE_NOT_CONFIGURED');
  });
});

describe('getCardDetails', () => {
  it('retourne brand/last4/exp depuis le PaymentMethod du compte connecté', async () => {
    (prisma.club.findUnique as jest.Mock).mockResolvedValue({ stripeAccountId: 'acct_1' });
    (stripe.paymentMethods.retrieve as jest.Mock).mockResolvedValue({
      card: { brand: 'visa', last4: '4242', exp_month: 4, exp_year: 2027 },
    });
    const res = await new StripeService().getCardDetails('club-1', 'pm_123');
    expect(res).toEqual({ brand: 'visa', last4: '4242', expMonth: 4, expYear: 2027 });
    expect(stripe.paymentMethods.retrieve).toHaveBeenCalledWith('pm_123', undefined, { stripeAccount: 'acct_1' });
  });

  it('lève STRIPE_NOT_CONFIGURED si le club n a pas de compte', async () => {
    (prisma.club.findUnique as jest.Mock).mockResolvedValue({ stripeAccountId: null });
    await expect(new StripeService().getCardDetails('club-1', 'pm_123')).rejects.toThrow('STRIPE_NOT_CONFIGURED');
  });
});

describe('detachCard', () => {
  it('détache le PaymentMethod sur le compte connecté', async () => {
    (prisma.club.findUnique as jest.Mock).mockResolvedValue({ stripeAccountId: 'acct_1' });
    (stripe.paymentMethods.detach as jest.Mock).mockResolvedValue({ id: 'pm_123' });
    await new StripeService().detachCard('club-1', 'pm_123');
    expect(stripe.paymentMethods.detach).toHaveBeenCalledWith('pm_123', undefined, { stripeAccount: 'acct_1' });
  });
});
