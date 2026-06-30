import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';

// On capture l'amountCents transmis au service Stripe pour vérifier la part facturée.
// jest.mock est hoisté : les fns sont créées DANS la factory (singletons partagés par
// toutes les instances `new StripeService()`) puis récupérées via le module mocké.
jest.mock('../../services/stripe.service', () => {
  const createPaymentIntent = jest.fn().mockResolvedValue({ clientSecret: 'cs_test' });
  const createSetupIntent = jest.fn().mockResolvedValue({ clientSecret: 'cs_setup' });
  return {
    StripeService: jest.fn().mockImplementation(() => ({ createPaymentIntent, createSetupIntent })),
  };
});

import { StripeService } from '../../services/stripe.service';

// Récupère les fns singletons en instanciant une fois le service mocké.
const stripeInstance = new (StripeService as any)();
const createPaymentIntent = stripeInstance.createPaymentIntent as jest.Mock;
const createSetupIntent = stripeInstance.createSetupIntent as jest.Mock;

const SECRET = process.env.JWT_SECRET!;
if (!SECRET) throw new Error('JWT_SECRET manquant');
const token = jwt.sign({ id: 'user-1', email: 'u@x.fr' }, SECRET, { expiresIn: '1h' });

const url = '/api/clubs/club-demo/stripe/intent';

// Réservation avec un sport/format donné et un prix total (en euros).
const mockResa = (sportKey: string, format: string, totalPrice: number) =>
  prismaMock.reservation.findUnique.mockResolvedValue({
    totalPrice,
    userId: 'user-1',
    resource: { attributes: { format }, clubSport: { sport: { key: sportKey } } },
  } as any);

beforeEach(() => {
  createPaymentIntent.mockClear();
  createSetupIntent.mockClear();
  prismaMock.club.findUnique.mockResolvedValue({ id: 'club-1', stripeAccountId: 'acct_1' } as any);
});

describe('POST /api/clubs/:slug/stripe/intent — payShare', () => {
  it('payShare:true sur un padel double (capacité 4) facture le quart du total', async () => {
    mockResa('padel', 'double', 40); // 4000 cents / 4 = 1000
    const res = await request(app).post(url).set('Authorization', `Bearer ${token}`)
      .send({ reservationId: 'res-1', type: 'payment', payShare: true });

    expect(res.status).toBe(200);
    expect(createPaymentIntent).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 1000 }));
  });

  it('payShare omis facture le total complet', async () => {
    mockResa('padel', 'double', 40);
    const res = await request(app).post(url).set('Authorization', `Bearer ${token}`)
      .send({ reservationId: 'res-1', type: 'payment' });

    expect(res.status).toBe(200);
    expect(createPaymentIntent).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 4000 }));
  });

  it('payShare:false facture le total complet', async () => {
    mockResa('padel', 'double', 40);
    const res = await request(app).post(url).set('Authorization', `Bearer ${token}`)
      .send({ reservationId: 'res-1', type: 'payment', payShare: false });

    expect(res.status).toBe(200);
    expect(createPaymentIntent).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 4000 }));
  });

  it('tennis (capacité 2) : la part est la moitié du total', async () => {
    mockResa('tennis', 'double', 40); // 4000 / 2 = 2000
    const res = await request(app).post(url).set('Authorization', `Bearer ${token}`)
      .send({ reservationId: 'res-1', type: 'payment', payShare: true });

    expect(res.status).toBe(200);
    expect(createPaymentIntent).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 2000 }));
  });

  it('amountCents < 50 → 400 AMOUNT_TOO_SMALL et aucun intent créé', async () => {
    mockResa('padel', 'double', 1); // 100 cents / 4 = 25 cents < 50
    const res = await request(app).post(url).set('Authorization', `Bearer ${token}`)
      .send({ reservationId: 'res-1', type: 'payment', payShare: true });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('AMOUNT_TOO_SMALL');
    expect(createPaymentIntent).not.toHaveBeenCalled();
  });

  it('type:setup reste inchangé (pas de montant)', async () => {
    mockResa('padel', 'double', 40);
    const res = await request(app).post(url).set('Authorization', `Bearer ${token}`)
      .send({ reservationId: 'res-1', type: 'setup' });

    expect(res.status).toBe(200);
    expect(createSetupIntent).toHaveBeenCalled();
    expect(createPaymentIntent).not.toHaveBeenCalled();
  });

  it('propage customerSessionClientSecret renvoyé par le service', async () => {
    mockResa('padel', 'double', 40);
    createPaymentIntent.mockResolvedValueOnce({ clientSecret: 'cs_test', customerSessionClientSecret: 'cuss_x' });

    const res = await request(app).post(url).set('Authorization', `Bearer ${token}`)
      .send({ reservationId: 'res-1', type: 'payment' });

    expect(res.status).toBe(200);
    expect(res.body.customerSessionClientSecret).toBe('cuss_x');
  });
});
