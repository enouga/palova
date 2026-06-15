import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import app from '../../app';

// Mock stripe module
jest.mock('../../db/stripe', () => ({
  stripe: {
    webhooks: {
      constructEvent: jest.fn(),
    },
  },
}));

import { stripe } from '../../db/stripe';
const mockConstructEvent = stripe.webhooks.constructEvent as jest.Mock;

const RAW_BODY = Buffer.from(JSON.stringify({ type: 'test' }));
const SIG = 't=1,v1=abc';

describe('POST /api/stripe/webhooks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('400 si la signature Stripe est invalide', async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error('No signatures found');
    });

    const res = await request(app)
      .post('/api/stripe/webhooks')
      .set('stripe-signature', SIG)
      .set('Content-Type', 'application/json')
      .send(RAW_BODY);

    expect(res.status).toBe(400);
  });

  it('200 + met à jour le statut club sur account.updated', async () => {
    const accountEvent = {
      type: 'account.updated',
      account: 'acct_123',
      data: {
        object: {
          id: 'acct_123',
          charges_enabled: true,
          details_submitted: true,
        },
      },
    };
    mockConstructEvent.mockReturnValue(accountEvent);
    prismaMock.club.updateMany.mockResolvedValue({ count: 1 });

    const res = await request(app)
      .post('/api/stripe/webhooks')
      .set('stripe-signature', SIG)
      .set('Content-Type', 'application/json')
      .send(RAW_BODY);

    expect(res.status).toBe(200);
    expect(prismaMock.club.updateMany).toHaveBeenCalledWith({
      where: { stripeAccountId: 'acct_123' },
      data: { stripeAccountStatus: 'ACTIVE' },
    });
  });

  it('200 + sauvegarde defaultPaymentMethodId sur payment_intent.succeeded', async () => {
    const piEvent = {
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_123',
          customer: 'cus_club_xyz',
          payment_method: 'pm_card_456',
          metadata: { clubId: 'club-demo', reservationId: 'res-1' },
        },
      },
    };
    mockConstructEvent.mockReturnValue(piEvent);
    prismaMock.clubStripeCustomer.updateMany.mockResolvedValue({ count: 1 });

    const res = await request(app)
      .post('/api/stripe/webhooks')
      .set('stripe-signature', SIG)
      .set('Content-Type', 'application/json')
      .send(RAW_BODY);

    expect(res.status).toBe(200);
    expect(prismaMock.clubStripeCustomer.updateMany).toHaveBeenCalledWith({
      where: { clubId: 'club-demo', stripeCustomerId: 'cus_club_xyz' },
      data: { defaultPaymentMethodId: 'pm_card_456' },
    });
  });

  it('200 + sauvegarde defaultPaymentMethodId sur setup_intent.succeeded', async () => {
    const siEvent = {
      type: 'setup_intent.succeeded',
      data: {
        object: {
          id: 'si_123',
          customer: 'cus_club_xyz',
          payment_method: 'pm_card_789',
          metadata: { clubId: 'club-demo', reservationId: 'res-2' },
        },
      },
    };
    mockConstructEvent.mockReturnValue(siEvent);
    prismaMock.clubStripeCustomer.updateMany.mockResolvedValue({ count: 1 });

    const res = await request(app)
      .post('/api/stripe/webhooks')
      .set('stripe-signature', SIG)
      .set('Content-Type', 'application/json')
      .send(RAW_BODY);

    expect(res.status).toBe(200);
    expect(prismaMock.clubStripeCustomer.updateMany).toHaveBeenCalledWith({
      where: { clubId: 'club-demo', stripeCustomerId: 'cus_club_xyz' },
      data: { defaultPaymentMethodId: 'pm_card_789' },
    });
  });

  it('200 (no-op) pour un type d\'événement non géré', async () => {
    mockConstructEvent.mockReturnValue({ type: 'customer.created', data: { object: {} } });

    const res = await request(app)
      .post('/api/stripe/webhooks')
      .set('stripe-signature', SIG)
      .set('Content-Type', 'application/json')
      .send(RAW_BODY);

    expect(res.status).toBe(200);
  });
});
