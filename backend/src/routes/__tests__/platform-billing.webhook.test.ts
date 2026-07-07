import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';

jest.mock('../../db/stripe', () => ({
  stripe: {
    webhooks: { constructEvent: jest.fn() },
    subscriptions: { retrieve: jest.fn() },
  },
}));
jest.mock('../../services/platformBilling/billingEmails', () => ({
  buildSubscribedEmail: jest.fn().mockReturnValue({ subject: 's', html: 'h', text: 't' }),
  sendToOwners: jest.fn().mockResolvedValue(undefined),
}));

import { stripe } from '../../db/stripe';
import app from '../../app';

const mockConstructEvent = stripe.webhooks.constructEvent as jest.Mock;
const mockRetrieve = stripe.subscriptions.retrieve as jest.Mock;
const URL = '/api/billing/webhooks';

const SUB = {
  id: 'sub_1', status: 'active', cancel_at_period_end: false,
  metadata: { clubId: 'club-1' },
  items: { data: [{ price: { lookup_key: 'palova_t2_month' }, current_period_end: 1790000000 }] },
};

beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.platformSubscription.upsert.mockResolvedValue({} as any);
  prismaMock.platformSubscription.updateMany.mockResolvedValue({ count: 1 } as any);
  prismaMock.club.findFirst.mockResolvedValue({ id: 'club-1' } as any); // résolution facture par customer
  prismaMock.platformInvoice.upsert.mockResolvedValue({} as any);
});

describe('POST /api/billing/webhooks', () => {
  it('400 sans signature', async () => {
    expect((await request(app).post(URL).send({})).status).toBe(400);
  });

  it('400 si signature invalide', async () => {
    mockConstructEvent.mockImplementation(() => { throw new Error('bad sig'); });
    const res = await request(app).post(URL).set('stripe-signature', 'sig').send({});
    expect(res.status).toBe(400);
  });

  it('checkout.session.completed → retrieve + upsert + email', async () => {
    mockConstructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: { object: { client_reference_id: 'club-1', subscription: 'sub_1' } },
    });
    mockRetrieve.mockResolvedValue(SUB);
    prismaMock.club.findUnique.mockResolvedValue({ name: 'C', slug: 's' } as any);
    const res = await request(app).post(URL).set('stripe-signature', 'sig').send({});
    expect(res.status).toBe(200);
    expect(mockRetrieve).toHaveBeenCalledWith('sub_1');
    expect(prismaMock.platformSubscription.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { clubId: 'club-1' },
    }));
  });

  it('customer.subscription.updated → sync via metadata.clubId', async () => {
    mockConstructEvent.mockReturnValue({ type: 'customer.subscription.updated', data: { object: SUB } });
    const res = await request(app).post(URL).set('stripe-signature', 'sig').send({});
    expect(res.status).toBe(200);
    expect(prismaMock.platformSubscription.upsert).toHaveBeenCalled();
  });

  it('invoice.payment_failed → statut past_due + facture persistée (failed)', async () => {
    mockConstructEvent.mockReturnValue({
      type: 'invoice.payment_failed',
      data: { object: { id: 'in_9', subscription: 'sub_1', customer: 'cus_1', amount_due: 5900, created: 1 } },
    });
    const res = await request(app).post(URL).set('stripe-signature', 'sig').send({});
    expect(res.status).toBe(200);
    expect(prismaMock.platformSubscription.updateMany).toHaveBeenCalledWith({
      where: { stripeSubscriptionId: 'sub_1' },
      data: { status: 'past_due' },
    });
    expect(prismaMock.platformInvoice.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { stripeInvoiceId: 'in_9' },
    }));
    const arg = prismaMock.platformInvoice.upsert.mock.calls[0][0] as any;
    expect(arg.create).toMatchObject({ status: 'failed', amountCents: 5900 });
  });

  it('invoice.paid → facture persistée (paid)', async () => {
    mockConstructEvent.mockReturnValue({
      type: 'invoice.paid',
      data: { object: { id: 'in_10', subscription: 'sub_1', customer: 'cus_1', amount_paid: 5900, status: 'paid', created: 1,
        lines: { data: [{ price: { lookup_key: 'palova_t2_month' } }] } } },
    });
    const res = await request(app).post(URL).set('stripe-signature', 'sig').send({});
    expect(res.status).toBe(200);
    expect(prismaMock.platformSubscription.updateMany).toHaveBeenCalledWith({
      where: { stripeSubscriptionId: 'sub_1' }, data: { status: 'active' },
    });
    const arg = prismaMock.platformInvoice.upsert.mock.calls[0][0] as any;
    expect(arg.create).toMatchObject({ status: 'paid', tier: 2, amountCents: 5900 });
  });

  it('événement inconnu → 200 sans effet', async () => {
    mockConstructEvent.mockReturnValue({ type: 'charge.refunded', data: { object: {} } });
    expect((await request(app).post(URL).set('stripe-signature', 'sig').send({})).status).toBe(200);
  });
});
