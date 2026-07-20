import { Router, Request, Response } from 'express';
import { stripe } from '../db/stripe';
import { prisma } from '../db/prisma';
import { ReservationService } from '../services/reservation.service';
import { TournamentService } from '../services/tournament.service';
import { EventService } from '../services/event.service';
import { OfferService, OfferIntentMeta } from '../services/offer.service';
import { reportError } from '../observability/reportError';

const router = Router();

// Un « code métier » connu (OFFER_NOT_FOUND, SLOT_NO_LONGER_AVAILABLE, VALIDATION_ERROR…,
// en UPPER_SNAKE_CASE) est un résultat TERMINAL : rejouer le webhook n'y changerait rien → 200.
// Toute AUTRE erreur (Prisma infra, conflit de sérialisation épuisé, bug, inattendu) → 500 pour
// que Stripe REJOUE — sinon un paiement débité mais non fulfillé serait perdu à jamais.
function isTerminalBusinessError(e: unknown): boolean {
  return e instanceof Error && /^[A-Z][A-Z0-9_]{2,}$/.test(e.message);
}

router.post('/', async (req: Request, res: Response) => {
  const reservationService = new ReservationService();
  const sig = req.headers['stripe-signature'] as string;

  if (!sig) return void res.status(400).json({ error: 'Missing stripe-signature' });

  let event: ReturnType<typeof stripe.webhooks.constructEvent>;
  try {
    event = stripe.webhooks.constructEvent(
      req.body as Buffer,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET ?? '',
    );
  } catch {
    return void res.status(400).json({ error: 'Invalid webhook signature' });
  }

  try {
    switch (event.type) {
      case 'account.updated': {
        const account = event.data.object as {
          id: string;
          charges_enabled: boolean;
          details_submitted: boolean;
        };
        const status = account.charges_enabled ? 'ACTIVE'
          : account.details_submitted ? 'RESTRICTED'
          : 'PENDING';
        const club = await prisma.club.findFirst({ where: { stripeAccountId: account.id } });
        if (club) {
          await prisma.club.update({
            where: { id: club.id },
            data: { stripeAccountStatus: status as any },
          });
        }
        break;
      }

      case 'payment_intent.succeeded': {
        const pi = event.data.object as {
          id: string;
          metadata: Record<string, string>;
          payment_method: string | null;
          amount: number;
        };

        // Les services de fulfillment sont idempotents (retour normal si déjà traité) ; une
        // erreur qui remonte ici est donc soit terminale (→200), soit transitoire (→500),
        // triée par le catch de sortie. Plus de catch qui avale : un échec transitoire doit
        // faire rejouer Stripe.
        if (pi.metadata?.offerPlanId || pi.metadata?.offerPackageTemplateId) {
          await new OfferService().fulfillPaidIntent(pi.metadata as OfferIntentMeta, pi.id, pi.amount);
          break;
        }

        if (pi.metadata?.tournamentRegistrationId) {
          await new TournamentService().confirmRegistrationPayment(pi.metadata.tournamentRegistrationId, { stripePaymentIntentId: pi.id });
          break;
        }
        if (pi.metadata?.eventRegistrationId) {
          await new EventService().confirmRegistrationPayment(pi.metadata.eventRegistrationId, { stripePaymentIntentId: pi.id });
          break;
        }

        const reservationId = pi.metadata?.reservationId;
        if (!reservationId) break;
        const reservation = await prisma.reservation.findUnique({ where: { id: reservationId } });
        if (!reservation || reservation.status !== 'PENDING' || !reservation.userId) break;
        await reservationService.confirmReservation(reservation.id, reservation.userId, {
          stripePaymentIntentId: pi.id,
        });
        break;
      }

      case 'setup_intent.succeeded': {
        const si = event.data.object as {
          id: string;
          metadata: Record<string, string>;
          payment_method: string | null;
        };
        if (!si.payment_method) break;
        const clubId = si.metadata?.clubId;

        if (si.metadata?.tournamentRegistrationId && clubId) {
          const reg = await prisma.tournamentRegistration.findUnique({ where: { id: si.metadata.tournamentRegistrationId }, select: { captainUserId: true } });
          if (reg) await prisma.clubStripeCustomer.updateMany({ where: { clubId, userId: reg.captainUserId, defaultPaymentMethodId: null }, data: { defaultPaymentMethodId: si.payment_method } });
          break;
        }
        if (si.metadata?.eventRegistrationId && clubId) {
          const reg = await prisma.eventRegistration.findUnique({ where: { id: si.metadata.eventRegistrationId }, select: { userId: true } });
          if (reg) await prisma.clubStripeCustomer.updateMany({ where: { clubId, userId: reg.userId, defaultPaymentMethodId: null }, data: { defaultPaymentMethodId: si.payment_method } });
          break;
        }

        if (!si.metadata?.reservationId) break;
        const reservation = await prisma.reservation.findUnique({
          where: { id: si.metadata.reservationId },
          select: { userId: true, resource: { select: { clubId: true } } },
        });
        if (!reservation?.userId) break;
        await prisma.clubStripeCustomer.updateMany({
          where: {
            clubId: (reservation.resource as any)?.clubId,
            userId: reservation.userId,
            defaultPaymentMethodId: null,
          },
          data: { defaultPaymentMethodId: si.payment_method },
        });
        break;
      }

      default:
        break;
    }
  } catch (err) {
    if (isTerminalBusinessError(err)) {
      console.warn('[stripe-webhook] résultat terminal, pas de retry', event.type, (err as Error).message);
    } else {
      // Erreur transitoire/inattendue : renvoyer un non-2xx pour que Stripe REJOUE l'événement
      // (sinon un paiement débité mais non fulfillé serait définitivement perdu).
      reportError(err, { source: 'stripe-webhook', eventType: event.type });
      return void res.status(500).json({ error: 'Webhook handler failed' });
    }
  }

  res.json({ received: true });
});

export default router;
