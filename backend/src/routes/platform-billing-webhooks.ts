// Webhook Stripe Billing PLATEFORME (abonnements SaaS des clubs) — secret DÉDIÉ
// STRIPE_BILLING_WEBHOOK_SECRET, distinct du webhook Connect (stripe-webhooks.ts).
import { Router, Request, Response } from 'express';
import Stripe from 'stripe';
import { stripe } from '../db/stripe';
import { prisma } from '../db/prisma';
import { syncSubscription, subscriptionFields } from '../services/platformBilling/stripeBilling';
import { buildSubscribedEmail, sendToOwners } from '../services/platformBilling/billingEmails';

const router = Router();

/** Retrouve le club d'un abonnement : metadata.clubId, sinon par Customer. */
async function resolveClubId(sub: Stripe.Subscription): Promise<string | null> {
  const fromMeta = (sub.metadata?.clubId as string) || null;
  if (fromMeta) return fromMeta;
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  if (!customerId) return null;
  const club = await prisma.club.findFirst({ where: { platformCustomerId: customerId }, select: { id: true } });
  return club?.id ?? null;
}

router.post('/', async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'] as string;
  if (!sig) return void res.status(400).json({ error: 'Missing stripe-signature' });

  let event: ReturnType<typeof stripe.webhooks.constructEvent>;
  try {
    event = stripe.webhooks.constructEvent(
      req.body as Buffer,
      sig,
      process.env.STRIPE_BILLING_WEBHOOK_SECRET ?? '',
    );
  } catch {
    return void res.status(400).json({ error: 'Invalid webhook signature' });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const clubId = session.client_reference_id;
        const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
        if (clubId && subId) {
          const sub = await stripe.subscriptions.retrieve(subId);
          await syncSubscription(clubId, sub);
          // Email de confirmation best-effort.
          const club = await prisma.club.findUnique({ where: { id: clubId }, select: { name: true, slug: true } });
          const fields = subscriptionFields(sub);
          if (club && fields) {
            await sendToOwners(clubId, buildSubscribedEmail({
              clubName: club.name, slug: club.slug, tier: fields.tier, interval: fields.interval,
            }));
          }
        }
        break;
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const clubId = await resolveClubId(sub);
        if (clubId) await syncSubscription(clubId, sub);
        break;
      }

      case 'invoice.paid':
      case 'invoice.payment_failed': {
        // L'emplacement de l'id d'abonnement sur l'Invoice varie selon la version d'API — tolérer les deux.
        const invoice = event.data.object as any;
        const subId: string | null =
          (typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id)
          ?? invoice.parent?.subscription_details?.subscription ?? null;
        if (subId) {
          await prisma.platformSubscription.updateMany({
            where: { stripeSubscriptionId: subId },
            data: { status: event.type === 'invoice.paid' ? 'active' : 'past_due' },
          });
        }
        break;
      }
    }
  } catch (err) {
    // On répond 200 quand même : Stripe re-livre sinon en boucle ; l'état sera resynchronisé
    // par le prochain événement subscription.updated.
    console.error('[billing-webhook]', err);
  }

  res.json({ received: true });
});

export default router;
