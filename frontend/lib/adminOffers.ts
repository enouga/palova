import { ACCENTS } from '@/lib/theme';
import type { PackageKind, SubscriberRow } from '@/lib/api';

/** Teintes cyclées des cartes (miroir de OffersShowcase, même ordre). */
export const OFFER_TINTS = [ACCENTS.blue, ACCENTS.apricot, ACCENTS.emerald, ACCENTS.violet, ACCENTS.cyan];
export const offerAccent = (index: number): string => OFFER_TINTS[((index % OFFER_TINTS.length) + OFFER_TINTS.length) % OFFER_TINTS.length];

/** Type d'offre pour la couleur : un abonnement, un carnet (entrées) ou un porte-monnaie. */
export type OfferTintKind = 'SUBSCRIPTION' | PackageKind;

/** Couleur d'une offre déterminée par son TYPE (pas sa position) : deux offres du même type partagent toujours la même teinte. */
export const offerTint = (kind: OfferTintKind): string =>
  kind === 'SUBSCRIPTION' ? ACCENTS.blue : kind === 'ENTRIES' ? ACCENTS.apricot : ACCENTS.emerald;

const NO_SALE = 'Aucune vente pour l’instant';

/** Espace fine insécable entre milliers : « 1 240 € ». */
function eurosInt(cents: number): string {
  const euros = Math.round(cents / 100);
  return `${euros.toLocaleString('fr-FR').replace(/ /g, ' ').replace(/ /g, ' ')} €`;
}

/** Pouls d'un abonnement : « 12 abonnés actifs · 588 €/mois ». */
export function planPulse(activeCount: number, revenueCents: number): string {
  if (activeCount <= 0) return NO_SALE;
  const noun = activeCount === 1 ? 'abonné actif' : 'abonnés actifs';
  return `${activeCount} ${noun} · ${eurosInt(revenueCents)}/mois`;
}

const sold = (n: number): string => `${n} ${n === 1 ? 'vendu' : 'vendus'}`;

/** Pouls d'un carnet/porte-monnaie depuis les stats serveur. */
export function packagePulse(
  stats: { soldCount: number; activeCount: number; outstandingAmount: string } | undefined,
  kind: PackageKind,
): string {
  if (!stats || stats.soldCount <= 0) return NO_SALE;
  if (kind === 'WALLET') {
    const cents = Math.round(Number(stats.outstandingAmount) * 100);
    return `${eurosInt(cents)} en circulation · ${sold(stats.soldCount)}`;
  }
  return `${stats.activeCount} en circulation · ${sold(stats.soldCount)}`;
}

/** Revenu mensuel récurrent d'un plan = Σ mensualités des abonnés ACTIFS non expirés. */
export function planRevenueCents(subscribers: SubscriberRow[], planId: string, nowMs: number): number {
  return subscribers
    .filter((s) => s.planId === planId && s.status === 'ACTIVE' && Date.parse(s.expiresAt) > nowMs)
    .reduce((sum, s) => sum + Math.round(Number(s.monthlyPriceSnapshot) * 100), 0);
}

/** Sépare actifs (en vente) / inactifs (retirés) en préservant l'ordre d'entrée. */
export function splitByActive<T extends { isActive: boolean }>(items: T[]): { active: T[]; inactive: T[] } {
  const active: T[] = []; const inactive: T[] = [];
  for (const it of items) (it.isActive ? active : inactive).push(it);
  return { active, inactive };
}
