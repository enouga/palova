import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import app from '../../app';

jest.mock('../../db/stripe', () => ({
  stripe: {
    webhooks: {
      constructEvent: jest.fn(),
    },
  },
}));

jest.mock('../../services/reservation.service', () => ({
  ReservationService: jest.fn().mockImplementation(() => ({
    confirmReservation: jest.fn().mockResolvedValue({ id: 'r-1', status: 'CONFIRMED' }),
  })),
}));

import { stripe } from '../../db/stripe';
import { ReservationService } from '../../services/reservation.service';
import { TournamentService } from '../../services/tournament.service';
import { EventService } from '../../services/event.service';
const mockConstructEvent = stripe.webhooks.constructEvent as jest.Mock;

let mockConfirmReservation: jest.Mock;

const RAW_BODY = Buffer.from(JSON.stringify({ type: 'test' }));
const SIG = 't=1,v1=abc';

describe('POST /api/stripe/webhooks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConfirmReservation = jest.fn().mockResolvedValue({ id: 'r-1', status: 'CONFIRMED' });
    (ReservationService as jest.Mock).mockImplementation(() => ({
      confirmReservation: mockConfirmReservation,
    }));
  });

  it('400 si la signature Stripe est invalide', async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error('signature invalide');
    });

    const res = await request(app)
      .post('/api/stripe/webhooks')
      .set('stripe-signature', SIG)
      .set('Content-Type', 'application/json')
      .send(RAW_BODY);

    expect(res.status).toBe(400);
  });

  it('200 + met à jour le statut club sur account.updated', async () => {
    mockConstructEvent.mockReturnValue({
      type: 'account.updated',
      data: {
        object: {
          id: 'acct_123',
          charges_enabled: true,
          details_submitted: true,
        },
      },
    });
    prismaMock.club.findFirst.mockResolvedValue({ id: 'club-1' } as any);
    prismaMock.club.update.mockResolvedValue({ id: 'club-1' } as any);

    const res = await request(app)
      .post('/api/stripe/webhooks')
      .set('stripe-signature', SIG)
      .set('Content-Type', 'application/json')
      .send(RAW_BODY);

    expect(res.status).toBe(200);
    expect(prismaMock.club.findFirst).toHaveBeenCalledWith({
      where: { stripeAccountId: 'acct_123' },
    });
    expect(prismaMock.club.update).toHaveBeenCalledWith({
      where: { id: 'club-1' },
      data: { stripeAccountStatus: 'ACTIVE' },
    });
  });

  it('200 + confirme la résa si payment_intent.succeeded et résa PENDING', async () => {
    mockConstructEvent.mockReturnValue({
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_123',
          metadata: { reservationId: 'res-1' },
          payment_method: 'pm_card_456',
        },
      },
    });
    prismaMock.reservation.findUnique.mockResolvedValue({
      id: 'res-1',
      status: 'PENDING',
      userId: 'user-1',
    } as any);

    const res = await request(app)
      .post('/api/stripe/webhooks')
      .set('stripe-signature', SIG)
      .set('Content-Type', 'application/json')
      .send(RAW_BODY);

    expect(res.status).toBe(200);
    expect(mockConfirmReservation).toHaveBeenCalledWith('res-1', 'user-1', {
      stripePaymentIntentId: 'pi_123',
    });
  });

  it('200 (no-op) si payment_intent.succeeded et résa déjà CONFIRMED (idempotent)', async () => {
    mockConstructEvent.mockReturnValue({
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_123',
          metadata: { reservationId: 'res-1' },
          payment_method: 'pm_card_456',
        },
      },
    });
    prismaMock.reservation.findUnique.mockResolvedValue({
      id: 'res-1',
      status: 'CONFIRMED',
      userId: 'user-1',
    } as any);

    const res = await request(app)
      .post('/api/stripe/webhooks')
      .set('stripe-signature', SIG)
      .set('Content-Type', 'application/json')
      .send(RAW_BODY);

    expect(res.status).toBe(200);
    expect(mockConfirmReservation).not.toHaveBeenCalled();
  });

  it('200 + sauvegarde defaultPaymentMethodId sur setup_intent.succeeded', async () => {
    mockConstructEvent.mockReturnValue({
      type: 'setup_intent.succeeded',
      data: {
        object: {
          id: 'si_123',
          metadata: { reservationId: 'res-2' },
          payment_method: 'pm_card_789',
        },
      },
    });
    prismaMock.reservation.findUnique.mockResolvedValue({
      userId: 'user-1',
      resource: { clubId: 'club-demo' },
    } as any);
    prismaMock.clubStripeCustomer.updateMany.mockResolvedValue({ count: 1 });

    const res = await request(app)
      .post('/api/stripe/webhooks')
      .set('stripe-signature', SIG)
      .set('Content-Type', 'application/json')
      .send(RAW_BODY);

    expect(res.status).toBe(200);
    expect(prismaMock.clubStripeCustomer.updateMany).toHaveBeenCalledWith({
      where: { clubId: 'club-demo', userId: 'user-1', defaultPaymentMethodId: null },
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
    expect(mockConfirmReservation).not.toHaveBeenCalled();
  });

  it('payment_intent.succeeded avec tournamentRegistrationId → confirme l\'inscription tournoi', async () => {
    const spy = jest.spyOn(TournamentService.prototype, 'confirmRegistrationPayment').mockResolvedValue({} as any);
    mockConstructEvent.mockReturnValue({
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_1',
          metadata: { tournamentRegistrationId: 'reg1' },
          payment_method: null,
        },
      },
    });

    const res = await request(app)
      .post('/api/stripe/webhooks')
      .set('stripe-signature', SIG)
      .set('Content-Type', 'application/json')
      .send(RAW_BODY);

    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith('reg1', { stripePaymentIntentId: 'pi_1' });
  });

  it('payment_intent.succeeded avec eventRegistrationId → confirme l\'inscription event', async () => {
    const spy = jest.spyOn(EventService.prototype, 'confirmRegistrationPayment').mockResolvedValue({} as any);
    mockConstructEvent.mockReturnValue({
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_2',
          metadata: { eventRegistrationId: 'reg2' },
          payment_method: null,
        },
      },
    });

    const res = await request(app)
      .post('/api/stripe/webhooks')
      .set('stripe-signature', SIG)
      .set('Content-Type', 'application/json')
      .send(RAW_BODY);

    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith('reg2', { stripePaymentIntentId: 'pi_2' });
  });
});
