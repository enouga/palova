// Actions superadmin sur l'abonnement SaaS d'un club (changer palier, annuler, réactiver).
// Réservé au super-admin plateforme — le gérant OWNER, lui, passe par le Customer Portal.
import { prisma } from '../../db/prisma';
import { BillingInterval } from './tiers';
import { changeSubscriptionTier, cancelAtPeriodEnd, resumeAtPeriodEnd } from './stripeBilling';

/** Abonnement LIVE d'un club (null si jamais souscrit ou canceled). Sinon NO_SUBSCRIPTION. */
async function requireLiveSubscription(clubId: string) {
  const sub = await prisma.platformSubscription.findUnique({ where: { clubId } });
  const live = sub && sub.status !== 'canceled' ? sub : null;
  if (!live) throw new Error('NO_SUBSCRIPTION');
  return live;
}

function parseTier(raw: unknown): number {
  const tier = Number(raw);
  if (!Number.isInteger(tier) || tier < 1 || tier > 4) throw new Error('TIER_INVALID');
  return tier;
}

function parseInterval(raw: unknown): BillingInterval | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (raw !== 'month' && raw !== 'year') throw new Error('VALIDATION_ERROR');
  return raw;
}

export interface SubscriptionActionResult {
  tier: number;
  interval: BillingInterval;
  status: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

/**
 * Change le palier (et éventuellement la cadence) de l'abonnement live d'un club.
 * Applique côté Stripe (sans prorata, effectif à la prochaine facture) puis met à jour
 * la ligne locale — le webhook subscription.updated resynchronisera de toute façon.
 */
export async function setClubSubscriptionTier(
  clubId: string, rawTier: unknown, rawInterval?: unknown,
): Promise<SubscriptionActionResult> {
  const tier = parseTier(rawTier);
  const interval = parseInterval(rawInterval);
  const live = await requireLiveSubscription(clubId);
  await changeSubscriptionTier(live.stripeSubscriptionId, tier, interval);
  const updated = await prisma.platformSubscription.update({
    where: { clubId },
    data: { tier, ...(interval ? { interval } : {}) },
  });
  return {
    tier: updated.tier,
    interval: updated.interval as BillingInterval,
    status: updated.status,
    currentPeriodEnd: updated.currentPeriodEnd,
    cancelAtPeriodEnd: updated.cancelAtPeriodEnd,
  };
}

/** Programme l'annulation à échéance de l'abonnement live d'un club (idempotent). */
export async function cancelClubSubscription(
  clubId: string,
): Promise<{ cancelAtPeriodEnd: true; currentPeriodEnd: Date | null }> {
  const live = await requireLiveSubscription(clubId);
  await cancelAtPeriodEnd(live.stripeSubscriptionId);
  const updated = await prisma.platformSubscription.update({
    where: { clubId }, data: { cancelAtPeriodEnd: true },
  });
  return { cancelAtPeriodEnd: true, currentPeriodEnd: updated.currentPeriodEnd };
}

/** Réactive un abonnement programmé pour s'arrêter à échéance (idempotent). */
export async function resumeClubSubscription(clubId: string): Promise<{ cancelAtPeriodEnd: false }> {
  const live = await requireLiveSubscription(clubId);
  await resumeAtPeriodEnd(live.stripeSubscriptionId);
  await prisma.platformSubscription.update({
    where: { clubId }, data: { cancelAtPeriodEnd: false },
  });
  return { cancelAtPeriodEnd: false };
}
