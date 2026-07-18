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

const notifyNoShowChargedMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../../email/notifications', () => ({
  notifyNoShowCharged: (...args: unknown[]) => notifyNoShowChargedMock(...args),
}));

const SECRET = process.env.JWT_SECRET!;
if (!SECRET) throw new Error('JWT_SECRET manquant');
const token = jwt.sign({ id: 'admin-1', email: 'a@x.fr' }, SECRET, { expiresIn: '1h' });

const asMember = (role = 'OWNER') =>
  prismaMock.clubMember.findUnique.mockResolvedValue({ role } as any);

describe('POST /api/clubs/club-demo/admin/reservations/:id/no-show-charge', () => {
  const url = '/api/clubs/club-demo/admin/reservations/res-1/no-show-charge';

  beforeEach(() => notifyNoShowChargedMock.mockClear());

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

    // marqué comme débit d'absence (distinct d'un paiement normal, pour le suivi de récidive)
    expect(prismaMock.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ noShow: true }),
    }));

    // le joueur débité est notifié (P0 : plus jamais de débit muet)
    expect(notifyNoShowChargedMock).toHaveBeenCalledWith('res-1', 'user-1', 2500);
  });

  it('201 même si la notification échoue (best-effort, ne casse pas le débit)', async () => {
    asMember();
    prismaMock.reservation.findUnique.mockResolvedValue({
      id: 'res-1',
      resource: { clubId: 'club-demo' },
      participants: [{ id: 'part-1', userId: 'user-1', isOrganizer: true }],
    } as any);
    prismaMock.payment.create.mockResolvedValue({ id: 'pay-1' } as any);
    notifyNoShowChargedMock.mockRejectedValueOnce(new Error('SMTP down'));

    const res = await request(app)
      .post(url)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 25 });

    expect(res.status).toBe(201);
    expect(res.body.paymentId).toBe('pay-1');
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

describe('GET /api/clubs/club-demo/admin/reservations/:id/no-show-preview', () => {
  const url = '/api/clubs/club-demo/admin/reservations/res-1/no-show-preview';

  it('200 avec le nombre de no-show déjà facturés à l\'organisateur (récidive)', async () => {
    asMember();
    prismaMock.reservation.findUnique.mockResolvedValue({
      id: 'res-1',
      resource: { clubId: 'club-demo' },
      participants: [{ id: 'part-1', userId: 'user-1', isOrganizer: true }],
    } as any);
    prismaMock.payment.count.mockResolvedValue(2);
    prismaMock.payment.findFirst.mockResolvedValue({ createdAt: new Date('2026-06-01T10:00:00Z') } as any);

    const res = await request(app).get(url).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ previousCount: 2, lastChargedAt: '2026-06-01T10:00:00.000Z' });
    expect(prismaMock.payment.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ clubId: 'club-demo', noShow: true, participant: { userId: 'user-1' } }),
    }));
  });

  it('200 { previousCount: 0, lastChargedAt: null } si jamais facturé', async () => {
    asMember();
    prismaMock.reservation.findUnique.mockResolvedValue({
      id: 'res-1',
      resource: { clubId: 'club-demo' },
      participants: [{ id: 'part-1', userId: 'user-1', isOrganizer: true }],
    } as any);
    prismaMock.payment.count.mockResolvedValue(0);

    const res = await request(app).get(url).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ previousCount: 0, lastChargedAt: null });
  });

  it('404 si réservation inconnue', async () => {
    asMember();
    prismaMock.reservation.findUnique.mockResolvedValue(null as any);

    const res = await request(app).get(url).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it('403 si non membre', async () => {
    prismaMock.clubMember.findUnique.mockResolvedValue(null as any);

    const res = await request(app).get(url).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });
});
