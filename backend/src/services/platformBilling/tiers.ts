/**
 * Paliers de l'offre SaaS Palova : un seul plan tout inclus, prix au nombre de
 * membres actifs (participation sur 90 jours glissants), plafonné au palier 4.
 * ⚠️ Miroir front : frontend/lib/platformTiers.ts — garder les deux synchronisés.
 */

export type BillingInterval = 'month' | 'year';

export interface PlatformTier {
  tier: 0 | 1 | 2 | 3 | 4;
  /** Borne haute INCLUSE de membres actifs (null = plafond, illimité). */
  maxMembers: number | null;
  monthlyCents: number; // HT
  yearlyCents: number;  // HT (~ -15 % vs 12 × mensuel)
}

export const PLATFORM_TIERS: PlatformTier[] = [
  { tier: 0, maxMembers: 50,   monthlyCents: 0,     yearlyCents: 0 },
  { tier: 1, maxMembers: 150,  monthlyCents: 2900,  yearlyCents: 29600 },
  { tier: 2, maxMembers: 400,  monthlyCents: 5900,  yearlyCents: 60200 },
  { tier: 3, maxMembers: 800,  monthlyCents: 9900,  yearlyCents: 101000 },
  { tier: 4, maxMembers: null, monthlyCents: 14900, yearlyCents: 152000 },
];

export function tierFor(activeMembers: number): number {
  for (const t of PLATFORM_TIERS) {
    if (t.maxMembers === null || activeMembers <= t.maxMembers) return t.tier;
  }
  return 4;
}

export function tierPriceCents(tier: number, interval: BillingInterval): number {
  const t = PLATFORM_TIERS.find((x) => x.tier === tier);
  if (!t) throw new Error('TIER_INVALID');
  return interval === 'year' ? t.yearlyCents : t.monthlyCents;
}

export function tierLabel(tier: number): string {
  const t = PLATFORM_TIERS.find((x) => x.tier === tier);
  if (!t) return '';
  const prev = PLATFORM_TIERS.find((x) => x.tier === tier - 1);
  const min = prev?.maxMembers != null ? prev.maxMembers + 1 : 0;
  return t.maxMembers === null
    ? `${min}+ membres actifs`
    : `${min} – ${t.maxMembers} membres actifs`;
}

/** lookup_key du Price Stripe d'un palier payant (aucun prix pour le palier 0). */
export function priceLookupKey(tier: number, interval: BillingInterval): string {
  return `palova_t${tier}_${interval}`;
}

/** Palier + cadence depuis un lookup_key Stripe (null si inconnu). */
export function tierFromLookupKey(
  key: string | null | undefined,
): { tier: number; interval: BillingInterval } | null {
  const m = /^palova_t([1-4])_(month|year)$/.exec(key ?? '');
  if (!m) return null;
  return { tier: Number(m[1]), interval: m[2] as BillingInterval };
}
