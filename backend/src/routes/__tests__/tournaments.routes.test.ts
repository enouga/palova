import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';

// Mock StripeService avant tout import de l'app (hoist garanti par jest.mock).
jest.mock('../../services/stripe.service', () => {
  const createRegistrationPaymentIntent = jest.fn().mockResolvedValue({ clientSecret: 'cs_reg_payment' });
  const createRegistrationSetupIntent   = jest.fn().mockResolvedValue({ clientSecret: 'cs_reg_setup' });
  return {
    StripeService: jest.fn().mockImplementation(() => ({
      createRegistrationPaymentIntent,
      createRegistrationSetupIntent,
    })),
  };
});

// La route contact-referee délègue à la messagerie : on la stubbe (gardes DM testées chez elle).
// ⚠️ Ce bloc DOIT rester avant `import app` (comme le mock Stripe ci-dessus) : `import app`
// charge en cascade `services/moderation.service.ts`, qui importe le vrai MessagingService —
// la factory de mock doit donc être enregistrée AVANT que ce require ne s'exécute.
const getOrCreateConversation = jest.fn();
jest.mock('../../services/messaging.service', () => ({
  MessagingService: jest.fn().mockImplementation(() => ({ getOrCreateConversation })),
}));

import app from '../../app';
import { TournamentService } from '../../services/tournament.service';
import { StripeService } from '../../services/stripe.service';
const stripeInstance = new (StripeService as any)();
const createRegistrationPaymentIntent = stripeInstance.createRegistrationPaymentIntent as jest.Mock;
const createRegistrationSetupIntent   = stripeInstance.createRegistrationSetupIntent   as jest.Mock;

const SECRET = process.env.JWT_SECRET!;
if (!SECRET) throw new Error('JWT_SECRET manquant dans l environnement de test (.env)');

const token1 = jwt.sign({ id: 'user-1', email: 'u@x.fr' }, SECRET, { expiresIn: '1h' });
const token2 = jwt.sign({ id: 'user-2', email: 'u2@x.fr' }, SECRET, { expiresIn: '1h' });

beforeEach(() => {
  createRegistrationPaymentIntent.mockClear();
  createRegistrationSetupIntent.mockClear();
  getOrCreateConversation.mockClear();
});

// ---------------------------------------------------------------------------
// POST /api/tournaments/:id/register → { registration, payment }
// ---------------------------------------------------------------------------
describe('POST /api/tournaments/:id/register', () => {
  it('201 — renvoie { registration, payment }', async () => {
    const spy = jest.spyOn(TournamentService.prototype, 'register').mockResolvedValue({
      registration: { id: 'reg-1', status: 'CONFIRMED', paymentStatus: 'NONE' },
      payment: null,
    } as any);

    const res = await request(app)
      .post('/api/tournaments/tourn-1/register')
      .set('Authorization', `Bearer ${token1}`)
      .send({ partnerUserId: 'user-2' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('registration');
    expect(res.body).toHaveProperty('payment');
    spy.mockRestore();
  });

  it('201 — renvoie payment avec mode quand paiement requis', async () => {
    const spy = jest.spyOn(TournamentService.prototype, 'register').mockResolvedValue({
      registration: { id: 'reg-1', status: 'CONFIRMED', paymentStatus: 'DUE' },
      payment: { mode: 'payment' },
    } as any);

    const res = await request(app)
      .post('/api/tournaments/tourn-1/register')
      .set('Authorization', `Bearer ${token1}`)
      .send({ partnerUserId: 'user-2' });

    expect(res.status).toBe(201);
    expect(res.body.payment).toEqual({ mode: 'payment' });
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// POST /api/tournaments/:id/registrations/:regId/intent
// ---------------------------------------------------------------------------
describe('POST /api/tournaments/:id/registrations/:regId/intent', () => {
  it('401 sans token', async () => {
    const res = await request(app)
      .post('/api/tournaments/tourn-1/registrations/reg-1/intent');
    expect(res.status).toBe(401);
  });

  it('404 si l\'inscription n\'existe pas', async () => {
    prismaMock.tournamentRegistration.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .post('/api/tournaments/tourn-1/registrations/reg-x/intent')
      .set('Authorization', `Bearer ${token1}`);
    expect(res.status).toBe(404);
  });

  it('403 si l\'inscription n\'appartient pas à l\'appelant', async () => {
    prismaMock.tournamentRegistration.findUnique.mockResolvedValue({
      captainUserId: 'autre-user',
      status: 'CONFIRMED',
      paymentStatus: 'DUE',
      paymentDeadline: new Date(Date.now() + 600_000),
      tournament: { clubId: 'club-1', entryFee: 15, club: { stripeAccountId: 'acct_1' } },
    } as any);

    const res = await request(app)
      .post('/api/tournaments/tourn-1/registrations/reg-1/intent')
      .set('Authorization', `Bearer ${token1}`);

    expect(res.status).toBe(403);
  });

  it('409 NOT_PAYABLE si paymentStatus !== DUE', async () => {
    prismaMock.tournamentRegistration.findUnique.mockResolvedValue({
      captainUserId: 'user-1',
      status: 'CONFIRMED',
      paymentStatus: 'PAID',
      paymentDeadline: new Date(Date.now() + 600_000),
      tournament: { clubId: 'club-1', entryFee: 15, club: { stripeAccountId: 'acct_1' } },
    } as any);

    const res = await request(app)
      .post('/api/tournaments/tourn-1/registrations/reg-1/intent')
      .set('Authorization', `Bearer ${token1}`);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('NOT_PAYABLE');
  });

  it('200 — CONFIRMED DUE → PaymentIntent + clientSecret + stripeAccountId', async () => {
    prismaMock.tournamentRegistration.findUnique.mockResolvedValue({
      captainUserId: 'user-1',
      status: 'CONFIRMED',
      paymentStatus: 'DUE',
      paymentDeadline: new Date(Date.now() + 600_000),
      tournament: { clubId: 'club-1', entryFee: 15, club: { stripeAccountId: 'acct_1' } },
    } as any);

    const res = await request(app)
      .post('/api/tournaments/tourn-1/registrations/reg-1/intent')
      .set('Authorization', `Bearer ${token1}`)
      .send({ cgvAccepted: true });

    expect(res.status).toBe(200);
    expect(res.body.clientSecret).toBe('cs_reg_payment');
    expect(res.body.stripeAccountId).toBe('acct_1');
    expect(res.body.type).toBe('payment');
    expect(createRegistrationPaymentIntent).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 1500, kind: 'tournament' }),
    );
  });

  it('propage customerSessionClientSecret renvoyé par le service', async () => {
    prismaMock.tournamentRegistration.findUnique.mockResolvedValue({
      captainUserId: 'user-1',
      status: 'CONFIRMED',
      paymentStatus: 'DUE',
      paymentDeadline: new Date(Date.now() + 600_000),
      tournament: { clubId: 'club-1', entryFee: 15, club: { stripeAccountId: 'acct_1' } },
    } as any);
    createRegistrationPaymentIntent.mockResolvedValueOnce({ clientSecret: 'cs_reg_payment', customerSessionClientSecret: 'cuss_reg' });

    const res = await request(app)
      .post('/api/tournaments/tourn-1/registrations/reg-1/intent')
      .set('Authorization', `Bearer ${token1}`)
      .send({ cgvAccepted: true });

    expect(res.status).toBe(200);
    expect(res.body.customerSessionClientSecret).toBe('cuss_reg');
  });

  it('400 AMOUNT_TOO_SMALL si entryFee donne < 50 centimes', async () => {
    prismaMock.tournamentRegistration.findUnique.mockResolvedValue({
      captainUserId: 'user-1',
      status: 'CONFIRMED',
      paymentStatus: 'DUE',
      paymentDeadline: new Date(Date.now() + 600_000),
      tournament: { clubId: 'club-1', entryFee: 0.40, club: { stripeAccountId: 'acct_1' } },
    } as any);

    const res = await request(app)
      .post('/api/tournaments/tourn-1/registrations/reg-1/intent')
      .set('Authorization', `Bearer ${token1}`)
      .send({ cgvAccepted: true });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('AMOUNT_TOO_SMALL');
    expect(createRegistrationPaymentIntent).not.toHaveBeenCalled();
  });

  it('200 — WAITLISTED DUE → SetupIntent + stripeAccountId', async () => {
    prismaMock.tournamentRegistration.findUnique.mockResolvedValue({
      captainUserId: 'user-1',
      status: 'WAITLISTED',
      paymentStatus: 'DUE',
      paymentDeadline: new Date(Date.now() + 600_000),
      tournament: { clubId: 'club-1', entryFee: 15, club: { stripeAccountId: 'acct_1' } },
    } as any);

    const res = await request(app)
      .post('/api/tournaments/tourn-1/registrations/reg-1/intent')
      .set('Authorization', `Bearer ${token1}`)
      .send({ cgvAccepted: true });

    expect(res.status).toBe(200);
    expect(res.body.clientSecret).toBe('cs_reg_setup');
    expect(res.body.type).toBe('setup');
    expect(createRegistrationSetupIntent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'tournament' }),
    );
  });

  it('intent refuse sans cgvAccepted (400 CGV_NOT_ACCEPTED)', async () => {
    prismaMock.tournamentRegistration.findUnique.mockResolvedValue({
      captainUserId: 'user-1',
      status: 'CONFIRMED',
      paymentStatus: 'DUE',
      paymentDeadline: new Date(Date.now() + 600_000),
      tournament: { clubId: 'club-1', entryFee: 15, club: { stripeAccountId: 'acct_1' } },
    } as any);

    const res = await request(app)
      .post('/api/tournaments/tourn-1/registrations/reg-1/intent')
      .set('Authorization', `Bearer ${token1}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CGV_NOT_ACCEPTED');
    expect(prismaMock.tournamentRegistration.updateMany).not.toHaveBeenCalled();
    expect(createRegistrationPaymentIntent).not.toHaveBeenCalled();
  });

  it('intent horodate cgvAcceptedAt une seule fois (updateMany conditionnel)', async () => {
    prismaMock.tournamentRegistration.findUnique.mockResolvedValue({
      captainUserId: 'user-1',
      status: 'CONFIRMED',
      paymentStatus: 'DUE',
      paymentDeadline: new Date(Date.now() + 600_000),
      tournament: { clubId: 'club-1', entryFee: 15, club: { stripeAccountId: 'acct_1' } },
    } as any);
    prismaMock.tournamentRegistration.updateMany.mockResolvedValue({ count: 1 });

    const res = await request(app)
      .post('/api/tournaments/tourn-1/registrations/reg-1/intent')
      .set('Authorization', `Bearer ${token1}`)
      .send({ cgvAccepted: true });

    expect(res.status).toBe(200);
    expect(prismaMock.tournamentRegistration.updateMany).toHaveBeenCalledWith({
      where: { id: 'reg-1', cgvAcceptedAt: null },
      data: { cgvAcceptedAt: expect.any(Date) },
    });
  });
});

// ---------------------------------------------------------------------------
// POST /api/tournaments/:id/registrations/:regId/confirm-payment
// ---------------------------------------------------------------------------
describe('POST /api/tournaments/:id/registrations/:regId/confirm-payment', () => {
  it('401 sans token', async () => {
    const res = await request(app)
      .post('/api/tournaments/tourn-1/registrations/reg-1/confirm-payment');
    expect(res.status).toBe(401);
  });

  it('400 VALIDATION_ERROR si stripePaymentIntentId absent', async () => {
    const res = await request(app)
      .post('/api/tournaments/tourn-1/registrations/reg-1/confirm-payment')
      .set('Authorization', `Bearer ${token1}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('200 — appelle service.confirmRegistrationPayment et renvoie le résultat', async () => {
    const spy = jest.spyOn(TournamentService.prototype, 'confirmRegistrationPayment').mockResolvedValue({
      id: 'reg-1', paymentStatus: 'PAID',
    } as any);

    const res = await request(app)
      .post('/api/tournaments/tourn-1/registrations/reg-1/confirm-payment')
      .set('Authorization', `Bearer ${token1}`)
      .send({ stripePaymentIntentId: 'pi_test_123' });

    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith('reg-1', { stripePaymentIntentId: 'pi_test_123' });
    expect(res.body.paymentStatus).toBe('PAID');
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// POST /api/tournaments/:id/contact-referee
// ---------------------------------------------------------------------------
describe('POST /api/tournaments/:id/contact-referee', () => {
  it('401 sans token', async () => {
    const res = await request(app).post('/api/tournaments/t1/contact-referee');
    expect(res.status).toBe(401);
  });

  it('200 — porte OK → délègue à la messagerie et renvoie la conversation', async () => {
    const spy = jest.spyOn(TournamentService.prototype, 'assertRefereeContactable')
      .mockResolvedValue({ refereeUserId: 'u-ref', clubSlug: 'demo' });
    getOrCreateConversation.mockResolvedValue({ id: 'conv-1', other: { userId: 'u-ref' } });

    const res = await request(app)
      .post('/api/tournaments/t1/contact-referee')
      .set('Authorization', `Bearer ${token1}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('conv-1');
    expect(getOrCreateConversation).toHaveBeenCalledWith('user-1', 'u-ref', 'demo');
    spy.mockRestore();
  });

  it('403 NOT_REGISTERED (réservé aux inscrits)', async () => {
    const spy = jest.spyOn(TournamentService.prototype, 'assertRefereeContactable')
      .mockRejectedValue(new Error('NOT_REGISTERED'));
    const res = await request(app)
      .post('/api/tournaments/t1/contact-referee')
      .set('Authorization', `Bearer ${token1}`);
    expect(res.status).toBe(403);
    expect(getOrCreateConversation).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('409 REFEREE_NOT_CONTACTABLE', async () => {
    const spy = jest.spyOn(TournamentService.prototype, 'assertRefereeContactable')
      .mockRejectedValue(new Error('REFEREE_NOT_CONTACTABLE'));
    const res = await request(app)
      .post('/api/tournaments/t1/contact-referee')
      .set('Authorization', `Bearer ${token1}`);
    expect(res.status).toBe(409);
    spy.mockRestore();
  });

  it('les gardes DM restent souveraines : DM_DISABLED relayé en 409', async () => {
    const spy = jest.spyOn(TournamentService.prototype, 'assertRefereeContactable')
      .mockResolvedValue({ refereeUserId: 'u-ref', clubSlug: 'demo' });
    getOrCreateConversation.mockRejectedValue(new Error('DM_DISABLED'));
    const res = await request(app)
      .post('/api/tournaments/t1/contact-referee')
      .set('Authorization', `Bearer ${token1}`);
    expect(res.status).toBe(409);
    spy.mockRestore();
  });
});
