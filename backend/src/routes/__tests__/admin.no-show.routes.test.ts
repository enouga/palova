import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';

jest.mock('../../services/stripe.service', () => ({
  StripeService: jest.fn().mockImplementation(() => ({
    createConnectedAccount: jest.fn(),
    syncAccountStatus: jest.fn(),
    createLoginLink: jest.fn(),
    chargeNoShow: jest.fn().mockResolvedValue('pi_noshow_xyz'),
    refundPaymentIntent: jest.fn(),
  })),
}));

const SECRET = process.env.JWT_SECRET!;
if (!SECRET) throw new Error('JWT_SECRET manquant');
const token = jwt.sign({ id: 'admin-1', email: 'a@x.fr' }, SECRET, { expiresIn: '1h' });

const asMember = (role = 'OWNER') =>
  prismaMock.clubMember.findUnique.mockResolvedValue({ role } as any);

describe('POST /api/clubs/club-demo/admin/reservations/:id/no-show-charge', () => {
  const url = '/api/clubs/club-demo/admin/reservations/res-1/no-show-charge';

  it('201 + paymentId si carte disponible', async () => {
    asMember();
    prismaMock.reservation.findUnique.mockResolvedValue({
      id: 'res-1',
      resource: { clubId: 'club-demo' },
      participants: [{ id: 'part-1', userId: 'user-1', isOrganizer: true }],
    } as any);
    prismaMock.payment.create.mockResolvedValue({ id: 'pay-1' } as any);

    const res = await request(app)
      .post(url)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 25 });

    expect(res.status).toBe(201);
    expect(res.body.paymentId).toBe('pay-1');
    expect(res.body.stripePaymentIntentId).toBe('pi_noshow_xyz');
  });

  it('400 si amount manquant ou invalide', async () => {
    asMember();
    const res = await request(app)
      .post(url)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 0 });

    expect(res.status).toBe(400);
  });

  it('404 si réservation inconnue', async () => {
    asMember();
    prismaMock.reservation.findUnique.mockResolvedValue(null as any);

    const res = await request(app)
      .post(url)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 25 });

    expect(res.status).toBe(404);
  });

  it('422 NO_CARD_ON_FILE si pas d\'organisateur avec carte', async () => {
    asMember();
    prismaMock.reservation.findUnique.mockResolvedValue({
      id: 'res-1',
      resource: { clubId: 'club-demo' },
      participants: [],
    } as any);

    const res = await request(app)
      .post(url)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 25 });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('NO_CARD_ON_FILE');
  });

  it('403 si non membre', async () => {
    prismaMock.clubMember.findUnique.mockResolvedValue(null as any);

    const res = await request(app)
      .post(url)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 25 });

    expect(res.status).toBe(403);
  });
});
