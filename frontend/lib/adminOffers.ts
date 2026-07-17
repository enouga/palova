import { ACCENTS } from '@/lib/theme';
import type { PackageKind, SubscriberRow } from '@/lib/api';

/** Type d'offre pour la couleur : un abonnement, un carnet (entrées) ou un porte-monnaie. */
export type OfferTintKind = 'SUBSCRIPTION' | PackageKind;

/** Couleur d'une offre déterminée par son TYPE (pas sa position) : deux offres du même type partagent toujours la même teinte. */
export const offerTint = (kind: OfferTintKind): string =>
  kind === 'SUBSCRIPTION' ? ACCENTS.blue : kind === 'ENTRIES' ? ACCENTS.apricot : ACCENTS.emerald;

/** Couleur dédiée à chaque sport — indépendante de offerTint, qui code le TYPE d'offre. */
export const SPORT_COLORS: Record<string, string> = {
  padel: '#7FAE86',
  tennis: '#6F9FC4',
  squash: '#D69574',
  badminton: '#A78FC4',
  pickleball: '#CDA553',
  pingpong: '#C98FA0',
};

/** Couleur neutre du compartiment « Tous sports » (offre à 0 ou plusieurs sports, ou sport hors catalogue). */
export const SPORT_COLOR_OTHER = '#B9B3A8';

/** Clé de regroupement d'une offre : son sport si elle en cible exactement un, sinon `null` ("Tous sports"). */
function sportGroupKey(sportKeys: string[]): string | null {
  return sportKeys.length === 1 ? sportKeys[0] : null;
}

/** Couleur d'une clé de regroupement (sport précis, ou `null` pour "Tous sports"). */
export function sportKeyColor(key: string | null): string {
  return key !== null ? (SPORT_COLORS[key] ?? SPORT_COLOR_OTHER) : SPORT_COLOR_OTHER;
}

/** Couleur de sport d'une offre : sa couleur dédiée si elle ne cible qu'un seul sport, neutre sinon. */
export function sportOfferTint(sportKeys: string[]): string {
  return sportKeyColor(sportGroupKey(sportKeys));
}

/** Libellé de section : nom du sport résolu via le club, "Tous sports" pour le compartiment `null`. */
export function sportGroupLabel(
  key: string | null,
  club: { clubSports?: { sport: { key: string; name: string } }[] } | null | undefined,
): string {
  if (key === null) return 'Tous sports';
  return club?.clubSports?.find((cs) => cs.sport.key === key)?.sport.name ?? key;
}

/**
 * Regroupe des offres par sport : une offre à un seul sport rejoint le groupe de ce sport, une
 * offre à 0 ou plusieurs sports rejoint le compartiment "Tous sports" (clé `null`). Ordre des
 * groupes = celui de `clubSports` (sports du club) ; une clé présente dans les offres mais hors
 * de `clubSports` est ajoutée ensuite, dans l'ordre de première apparition ; le compartiment
 * "Tous sports" est toujours en dernier. Regroupement stable : l'ordre relatif des offres à
 * l'intérieur de chaque groupe est celui du tableau reçu. Groupes vides omis.
 */
export function groupOffersBySport<T extends { sportKeys: string[] }>(
  items: T[],
  clubSports: { sport: { key: string } }[],
): { key: string | null; items: T[] }[] {
  const buckets = new Map<string | null, T[]>();
  for (const item of items) {
    const key = sportGroupKey(item.sportKeys);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }
  const order: (string | null)[] = [];
  for (const cs of clubSports) {
    if (buckets.has(cs.sport.key) && !order.includes(cs.sport.key)) order.push(cs.sport.key);
  }
  for (const key of buckets.keys()) {
    if (key !== null && !order.includes(key)) order.push(key);
  }
  if (buckets.has(null)) order.push(null);
  return order.map((key) => ({ key, items: buckets.get(key)! }));
}

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
