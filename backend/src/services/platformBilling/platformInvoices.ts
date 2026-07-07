// Miroir local des factures Stripe du COMPTE PLATEFORME (abonnements SaaS des clubs).
// Le webhook billing ne persiste que le statut de l'abonnement ; cette table donne
// l'historique fiable du CA encaissé, alimentée par le webhook + une synchro superadmin.
import { stripe } from '../../db/stripe';
import { prisma } from '../../db/prisma';
import { BillingInterval, tierFromLookupKey } from './tiers';

/**
 * Sous-ensemble structurel d'une Invoice Stripe (le namespace de types Stripe n'est
 * pas résolu par le tsconfig du repo — convention : types inline, cf. StripeSubscriptionLike).
 */
export interface StripeInvoiceLike {
  id: string;
  status?: string | null; // 'paid' | 'open' | 'void' | 'uncollectible' | 'draft'
  customer?: string | { id: string } | null;
  amount_paid?: number | null;
  amount_due?: number | null;
  currency?: string | null;
  created?: number | null; // epoch s
  hosted_invoice_url?: string | null;
  status_transitions?: { paid_at?: number | null } | null;
  subscription?: string | { id: string } | null; // API pré-Basil
  parent?: { subscription_details?: { subscription?: string | null } | null } | null; // API Basil+
  lines?: {
    data?: Array<{
      price?: { lookup_key?: string | null } | null; // absent des lignes en Basil
      period?: { start?: number | null; end?: number | null } | null;
    }> | null;
  } | null;
}

type InvoiceStatus = 'paid' | 'open' | 'failed' | 'void' | 'uncollectible';

/** Id d'abonnement d'une invoice — tolère les deux emplacements (comme le webhook). */
export function invoiceSubscriptionId(inv: StripeInvoiceLike): string | null {
  const direct = typeof inv.subscription === 'string' ? inv.subscription : inv.subscription?.id;
  return direct ?? inv.parent?.subscription_details?.subscription ?? null;
}

function epochToDate(sec: number | null | undefined): Date | null {
  return typeof sec === 'number' ? new Date(sec * 1000) : null;
}

export interface InvoiceFields {
  stripeInvoiceId: string;
  amountCents: number;
  currency: string;
  status: string;
  tier: number | null;
  interval: BillingInterval | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  paidAt: Date | null;
  hostedInvoiceUrl: string | null;
  createdAt: Date;
}

/**
 * Champs DB depuis une Invoice Stripe — helper PUR (tier/interval via lookup_key de la
 * 1re ligne uniquement). `statusOverride` force 'paid'/'failed' depuis le type d'événement
 * webhook. Le repli tier/interval via PlatformSubscription est fait dans `upsertInvoice`.
 */
export function invoiceFields(inv: StripeInvoiceLike, statusOverride?: 'paid' | 'failed'): InvoiceFields {
  const line = inv.lines?.data?.[0];
  const parsed = tierFromLookupKey(line?.price?.lookup_key ?? null);
  const status: InvoiceStatus =
    statusOverride ?? (inv.status === 'paid' ? 'paid' : ((inv.status as InvoiceStatus | undefined) ?? 'open'));
  const isPaid = status === 'paid';
  return {
    stripeInvoiceId: inv.id,
    amountCents: (isPaid ? inv.amount_paid : inv.amount_due) ?? inv.amount_due ?? 0,
    currency: inv.currency ?? 'eur',
    status,
    tier: parsed?.tier ?? null,
    interval: parsed?.interval ?? null,
    periodStart: epochToDate(line?.period?.start),
    periodEnd: epochToDate(line?.period?.end),
    paidAt: isPaid ? epochToDate(inv.status_transitions?.paid_at) : null,
    hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
    createdAt: epochToDate(inv.created) ?? new Date(),
  };
}

function customerId(inv: StripeInvoiceLike): string | null {
  return typeof inv.customer === 'string' ? inv.customer : inv.customer?.id ?? null;
}

/**
 * Persiste une facture pour un club connu (upsert idempotent par stripeInvoiceId).
 * Si le lookup_key n'a pas donné le palier (API Basil), repli sur PlatformSubscription.
 */
export async function upsertInvoiceForClub(
  clubId: string, inv: StripeInvoiceLike, statusOverride?: 'paid' | 'failed',
): Promise<void> {
  const fields = invoiceFields(inv, statusOverride);
  let { tier, interval } = fields;
  if (tier === null) {
    const sub = await prisma.platformSubscription.findUnique({
      where: { clubId }, select: { tier: true, interval: true },
    });
    if (sub) { tier = sub.tier; interval = sub.interval as BillingInterval; }
  }
  const data = { ...fields, tier, interval, clubId };
  const { stripeInvoiceId, ...rest } = data;
  await prisma.platformInvoice.upsert({
    where: { stripeInvoiceId },
    update: rest,
    create: data,
  });
}

/**
 * Upsert d'une facture reçue par webhook — club résolu via customer → Club.platformCustomerId.
 * Customer inconnu (facture non-Palova, ou club sans customer enregistré) → skip silencieux.
 */
export async function upsertInvoice(inv: StripeInvoiceLike, statusOverride?: 'paid' | 'failed'): Promise<void> {
  const cust = customerId(inv);
  if (!cust) return;
  const club = await prisma.club.findFirst({
    where: { platformCustomerId: cust }, select: { id: true },
  });
  if (!club) return;
  await upsertInvoiceForClub(club.id, inv, statusOverride);
}

/**
 * Backfill + rattrapage : pour chaque club à platformCustomerId non nul, pagine toutes
 * ses factures Stripe et les upsert. Sert d'import initial et de filet si un webhook a été raté.
 * Un échec sur un club n'arrête pas la boucle (pattern refreshAllClubs).
 */
export async function syncAllInvoices(): Promise<{ clubs: number; imported: number }> {
  const clubs = await prisma.club.findMany({
    where: { platformCustomerId: { not: null } },
    select: { id: true, platformCustomerId: true, slug: true },
  });
  let imported = 0;
  for (const club of clubs) {
    try {
      let startingAfter: string | undefined;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const page = await stripe.invoices.list({
          customer: club.platformCustomerId as string,
          limit: 100,
          ...(startingAfter ? { starting_after: startingAfter } : {}),
        });
        for (const inv of page.data as unknown as StripeInvoiceLike[]) {
          await upsertInvoiceForClub(club.id, inv);
          imported++;
        }
        if (!page.has_more || page.data.length === 0) break;
        startingAfter = page.data[page.data.length - 1].id;
      }
    } catch (err) {
      console.error(`[billing] sync invoices ${club.slug}:`, err);
    }
  }
  return { clubs: clubs.length, imported };
}
