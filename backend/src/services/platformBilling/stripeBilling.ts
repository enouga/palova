// Plomberie Stripe Billing sur le COMPTE PLATEFORME (STRIPE_SECRET_KEY) — rien ici ne
// touche les comptes Connect des clubs. Prix retrouvés par lookup_key (aucun id en .env).
import { stripe } from '../../db/stripe';
import { prisma } from '../../db/prisma';
import {
  PLATFORM_TIERS, BillingInterval, priceLookupKey, tierFromLookupKey, tierPriceCents, tierFor,
} from './tiers';

const PRODUCT_ID = 'palova-club';

async function ensurePlatformProduct(): Promise<void> {
  try {
    await stripe.products.retrieve(PRODUCT_ID);
  } catch {
    await stripe.products.create({ id: PRODUCT_ID, name: 'Palova Club' });
  }
}

/** Crée/retrouve les 8 Prices (paliers 1-4 × month/year). Renvoie lookup_key → price id. */
export async function ensurePlatformPrices(): Promise<Record<string, string>> {
  const keys: string[] = [];
  for (const t of PLATFORM_TIERS) {
    if (t.tier === 0) continue;
    keys.push(priceLookupKey(t.tier, 'month'), priceLookupKey(t.tier, 'year'));
  }
  const existing = await stripe.prices.list({ lookup_keys: keys, limit: 100 });
  const map: Record<string, string> = {};
  for (const p of existing.data) if (p.lookup_key) map[p.lookup_key] = p.id;

  const missing = keys.filter((k) => !map[k]);
  if (missing.length > 0) {
    await ensurePlatformProduct();
    for (const key of missing) {
      const parsed = tierFromLookupKey(key)!;
      const price = await stripe.prices.create({
        product: PRODUCT_ID,
        currency: 'eur',
        unit_amount: tierPriceCents(parsed.tier, parsed.interval),
        recurring: { interval: parsed.interval },
        lookup_key: key,
        tax_behavior: 'exclusive',
        nickname: `Palova palier ${parsed.tier} (${parsed.interval === 'year' ? 'annuel' : 'mensuel'})`,
      });
      map[key] = price.id;
    }
  }
  return map;
}

/** Tax Rate « TVA 20 % France » (idempotent par display_name + percentage actifs). */
export async function ensureTaxRate(): Promise<string> {
  const list = await stripe.taxRates.list({ active: true, limit: 100 });
  const found = list.data.find((t) => t.percentage === 20 && t.display_name === 'TVA');
  if (found) return found.id;
  const created = await stripe.taxRates.create({
    display_name: 'TVA', percentage: 20, inclusive: false, country: 'FR',
  });
  return created.id;
}

/** Customer du club sur le compte plateforme (créé au 1er besoin, email du gérant OWNER). */
export async function ensurePlatformCustomer(clubId: string): Promise<string> {
  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: {
      platformCustomerId: true, name: true, slug: true, legalEmail: true,
      members: { where: { role: 'OWNER' }, take: 1, select: { user: { select: { email: true } } } },
    },
  });
  if (!club) throw new Error('CLUB_NOT_FOUND');
  if (club.platformCustomerId) return club.platformCustomerId;

  const email = club.members[0]?.user.email ?? club.legalEmail ?? undefined;
  const customer = await stripe.customers.create({ name: club.name, email, metadata: { clubId } });
  await prisma.club.update({ where: { id: clubId }, data: { platformCustomerId: customer.id } });
  return customer.id;
}

/** Session Checkout d'abonnement au palier OBSERVÉ courant. Renvoie l'URL de paiement. */
export async function createBillingCheckout(
  clubId: string, interval: BillingInterval, returnUrl: string,
): Promise<string> {
  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: { activeMemberCount: true, platformCustomerId: true },
  });
  if (!club) throw new Error('CLUB_NOT_FOUND');

  const existing = await prisma.platformSubscription.findUnique({ where: { clubId } });
  if (existing && existing.status !== 'canceled') throw new Error('ALREADY_SUBSCRIBED');

  const tier = tierFor(club.activeMemberCount);
  if (tier === 0) throw new Error('NOTHING_TO_SUBSCRIBE');

  const [prices, taxRateId, customerId] = await Promise.all([
    ensurePlatformPrices(), ensureTaxRate(), ensurePlatformCustomer(clubId),
  ]);
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    client_reference_id: clubId,
    line_items: [{ price: prices[priceLookupKey(tier, interval)], quantity: 1 }],
    subscription_data: { default_tax_rates: [taxRateId], metadata: { clubId } },
    success_url: `${returnUrl}?checkout=success`,
    cancel_url: `${returnUrl}?checkout=cancelled`,
  });
  if (!session.url) throw new Error('STRIPE_NOT_CONFIGURED');
  return session.url;
}

/** Configuration du Customer Portal (factures + carte + annulation à échéance). */
async function ensurePortalConfiguration(): Promise<string> {
  const list = await stripe.billingPortal.configurations.list({ active: true, limit: 1 });
  if (list.data[0]) return list.data[0].id;
  const created = await stripe.billingPortal.configurations.create({
    business_profile: { headline: 'Palova — abonnement club' },
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: 'at_period_end' },
    },
  });
  return created.id;
}

/** Session Customer Portal (gérer carte, factures, annulation). */
export async function createBillingPortal(clubId: string, returnUrl: string): Promise<string> {
  const club = await prisma.club.findUnique({ where: { id: clubId }, select: { platformCustomerId: true } });
  if (!club?.platformCustomerId) throw new Error('NO_BILLING_ACCOUNT');
  const configuration = await ensurePortalConfiguration();
  const session = await stripe.billingPortal.sessions.create({
    customer: club.platformCustomerId, return_url: returnUrl, configuration,
  });
  return session.url;
}

/**
 * Sous-ensemble structurel de l'objet Subscription Stripe utilisé ici (le namespace
 * de types Stripe n'est pas résolu par le tsconfig du repo — convention : types inline).
 */
export interface StripeSubscriptionLike {
  id: string;
  status: string;
  cancel_at_period_end?: boolean | null;
  customer?: string | { id: string } | null;
  metadata?: Record<string, string> | null;
  items?: {
    data?: Array<{
      id?: string;
      price?: { lookup_key?: string | null } | null;
      current_period_end?: number | null;
    }> | null;
  } | null;
}

/** Champs DB depuis un objet Subscription Stripe (null si price non-Palova). */
export function subscriptionFields(sub: StripeSubscriptionLike): {
  status: string; tier: number; interval: BillingInterval;
  currentPeriodEnd: Date | null; cancelAtPeriodEnd: boolean;
} | null {
  const item = sub.items?.data?.[0];
  const parsed = tierFromLookupKey(item?.price?.lookup_key ?? null);
  if (!parsed) return null;
  // current_period_end vit sur l'item depuis l'API Basil (2025-03), sur l'abonnement avant — tolérer les deux.
  const rawEnd = (item as any)?.current_period_end ?? (sub as any).current_period_end ?? null;
  return {
    status: sub.status,
    tier: parsed.tier,
    interval: parsed.interval,
    currentPeriodEnd: rawEnd ? new Date(rawEnd * 1000) : null,
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
  };
}

/** Upsert de la ligne PlatformSubscription depuis l'objet Stripe (webhook + checkout). */
export async function syncSubscription(clubId: string, sub: StripeSubscriptionLike): Promise<void> {
  const fields = subscriptionFields(sub);
  if (!fields) return;
  await prisma.platformSubscription.upsert({
    where: { clubId },
    update: { stripeSubscriptionId: sub.id, ...fields },
    create: { clubId, stripeSubscriptionId: sub.id, ...fields },
  });
}

/** Change le palier d'un abonnement — SANS prorata : effectif à la prochaine facture. */
export async function changeSubscriptionTier(stripeSubscriptionId: string, newTier: number): Promise<void> {
  const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
  const item = sub.items.data[0];
  const parsed = tierFromLookupKey(item.price.lookup_key ?? null);
  const interval: BillingInterval = parsed?.interval ?? 'month';
  const prices = await ensurePlatformPrices();
  await stripe.subscriptions.update(stripeSubscriptionId, {
    items: [{ id: item.id, price: prices[priceLookupKey(newTier, interval)] }],
    proration_behavior: 'none',
  });
}

/** Programme l'annulation à échéance (retour au palier gratuit). */
export async function cancelAtPeriodEnd(stripeSubscriptionId: string): Promise<void> {
  await stripe.subscriptions.update(stripeSubscriptionId, { cancel_at_period_end: true });
}
