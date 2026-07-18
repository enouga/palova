import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';

// On capture les paramètres transmis au service Stripe pour vérifier le relais de
// cgvAcceptedAtIso (jest.mock est hoisté : les fns sont créées DANS la factory —
// singletons partagés par toutes les instances `new StripeService()`).
jest.mock('../../services/stripe.service', () => {
  const createOfferPaymentIntent = jest.fn().mockResolvedValue({ clientSecret: 'cs_offer', customerSessionClientSecret: null });
  return {
    StripeService: jest.fn().mockImplementation(() => ({ createOfferPaymentIntent })),
  };
});

import { StripeService } from '../../services/stripe.service';

const stripeInstance = new (StripeService as any)();
const createOfferPaymentIntent = stripeInstance.createOfferPaymentIntent as jest.Mock;

const SECRET = process.env.JWT_SECRET!;
if (!SECRET) throw new Error('JWT_SECRET manquant');
const token = jwt.sign({ id: 'user-1', email: 'u@x.fr' }, SECRET, { expiresIn: '1h' });

beforeEach(() => {
  createOfferPaymentIntent.mockClear();
  // Sert à la fois ensureActiveMembership (id/status) et la relecture showOffersPublicly/stripeAccountId.
  prismaMock.club.findUnique.mockResolvedValue({
    id: 'club-1', status: 'ACTIVE', showOffersPublicly: true, stripeAccountId: 'acct_1', stripeAccountStatus: 'ACTIVE',
  } as any);
  prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);
});

describe('POST /api/clubs/:slug/offers/plans/:id/intent', () => {
  beforeEach(() => {
    prismaMock.subscriptionPlan.findUnique.mockResolvedValue({
      id: 'p1', clubId: 'club-1', isActive: true, monthlyPrice: '39',
    } as any);
  });

  it('intent plan refuse sans cgvAccepted', async () => {
    const res = await request(app)
      .post('/api/clubs/padel-arena-paris/offers/plans/p1/intent')
      .set('Authorization', `Bearer ${token}`).send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CGV_NOT_ACCEPTED');
    expect(createOfferPaymentIntent).not.toHaveBeenCalled();
  });

  it('intent plan accepte avec cgvAccepted et relaie cgvAcceptedAtIso', async () => {
    const res = await request(app)
      .post('/api/clubs/padel-arena-paris/offers/plans/p1/intent')
      .set('Authorization', `Bearer ${token}`).send({ cgvAccepted: true });

    expect(res.status).toBe(200);
    expect(createOfferPaymentIntent).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'plan', offerId: 'p1', cgvAcceptedAtIso: expect.any(String),
    }));
  });
});

describe('POST /api/clubs/:slug/offers/packages/:id/intent', () => {
  beforeEach(() => {
    prismaMock.packageTemplate.findUnique.mockResolvedValue({
      id: 'tp1', clubId: 'club-1', isActive: true, price: '90',
    } as any);
  });

  it('intent carnet refuse sans cgvAccepted', async () => {
    const res = await request(app)
      .post('/api/clubs/padel-arena-paris/offers/packages/tp1/intent')
      .set('Authorization', `Bearer ${token}`).send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CGV_NOT_ACCEPTED');
    expect(createOfferPaymentIntent).not.toHaveBeenCalled();
  });

  it('intent carnet accepte avec cgvAccepted et relaie cgvAcceptedAtIso', async () => {
    const res = await request(app)
      .post('/api/clubs/padel-arena-paris/offers/packages/tp1/intent')
      .set('Authorization', `Bearer ${token}`).send({ cgvAccepted: true });

    expect(res.status).toBe(200);
    expect(createOfferPaymentIntent).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'package', offerId: 'tp1', cgvAcceptedAtIso: expect.any(String),
    }));
  });
});
