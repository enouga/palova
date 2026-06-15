import { Router, Request, Response } from 'express';
import { stripe } from '../db/stripe';
import { prisma } from '../db/prisma';

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'];
  if (!sig) return void res.status(400).json({ error: 'Missing stripe-signature' });

  let event: ReturnType<typeof stripe.webhooks.constructEvent>;
  try {
    event = stripe.webhooks.constructEvent(
      req.body as Buffer,
      sig as string,
      process.env.STRIPE_WEBHOOK_SECRET ?? '',
    );
  } catch {
    return void res.status(400).json({ error: 'Invalid webhook signature' });
  }

  try {
    switch (event.type) {
      case 'account.updated': {
        const account = event.data.object as { id: string; charges_enabled: boolean; details_submitted: boolean };
        const status = account.charges_enabled ? 'ACTIVE'
          : account.details_submitted ? 'RESTRICTED'
          : 'PENDING';
        await prisma.club.updateMany({
          where: { stripeAccountId: (event as any).account ?? account.id },
          data: { stripeAccountStatus: status as any },
        });
        break;
      }

      case 'payment_intent.succeeded': {
        const pi = event.data.object as {
          customer: string | null;
          payment_method: string | null;
          metadata: { clubId?: string; reservationId?: string };
        };
        if (pi.customer && pi.payment_method && pi.metadata.clubId) {
          await prisma.clubStripeCustomer.updateMany({
            where: { clubId: pi.metadata.clubId, stripeCustomerId: pi.customer },
            data: { defaultPaymentMethodId: pi.payment_method },
          });
        }
        break;
      }

      case 'setup_intent.succeeded': {
        const si = event.data.object as {
          customer: string | null;
          payment_method: string | null;
          metadata: { clubId?: string; reservationId?: string };
        };
        if (si.customer && si.payment_method && si.metadata.clubId) {
          await prisma.clubStripeCustomer.updateMany({
            where: { clubId: si.metadata.clubId, stripeCustomerId: si.customer },
            data: { defaultPaymentMethodId: si.payment_method },
          });
        }
        break;
      }

      default:
        // Événements non gérés ignorés intentionnellement
        break;
    }
  } catch (err) {
    console.error('[Stripe webhook] Error handling event', event.type, err);
    return void res.status(500).json({ error: 'Webhook handler error' });
  }

  res.json({ received: true });
});

export default router;
