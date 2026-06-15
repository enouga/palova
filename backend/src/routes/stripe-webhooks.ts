import { Router, Request, Response } from 'express';
import { stripe } from '../db/stripe';
import { prisma } from '../db/prisma';
import { ReservationService } from '../services/reservation.service';

const router = Router();

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
        };
        const reservationId = pi.metadata?.reservationId;
        if (!reservationId) break;
        const reservation = await prisma.reservation.findUnique({ where: { id: reservationId } });
        if (!reservation || reservation.status !== 'PENDING') break;
        try {
          await reservationService.confirmReservation(reservation.id, reservation.userId!, {
            stripePaymentIntentId: pi.id,
          });
        } catch {
          // Peut échouer si déjà confirmé concurremment — attendu
        }
        break;
      }

      case 'setup_intent.succeeded': {
        const si = event.data.object as {
          id: string;
          metadata: Record<string, string>;
          payment_method: string | null;
        };
        if (!si.payment_method || !si.metadata?.reservationId) break;
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
    console.error('[stripe-webhook] erreur handler', event.type, err);
  }

  res.json({ received: true });
});

export default router;
