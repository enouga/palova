import { loadStripe } from '@stripe/stripe-js';
import type { Stripe } from '@stripe/stripe-js';

// Une instance Stripe.js par compte connecté : en modèle « direct charges »,
// le clientSecret appartient au compte du club, donc Stripe.js DOIT être
// initialisé avec { stripeAccount } sinon le PaymentElement ne se monte pas.
const cache = new Map<string, Promise<Stripe | null>>();

export function getStripe(stripeAccount?: string | null): Promise<Stripe | null> {
  const key = stripeAccount ?? '';
  let promise = cache.get(key);
  if (!promise) {
    promise = loadStripe(
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '',
      stripeAccount ? { stripeAccount } : undefined,
    );
    cache.set(key, promise);
  }
  return promise;
}
