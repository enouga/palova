// Traduction note interne Glicko ↔ échelle padel 0–8 (référentiel French Padel Shop),
// + constantes de départ et statut provisoire. Module PUR.

export const LEVEL_MIN_RATING = 1000; // displayLevel 0
export const LEVEL_MAX_RATING = 2100; // displayLevel 8
export const DEFAULT_RD = 350;        // incertitude initiale (= MAX_RD)
export const DEFAULT_VOLATILITY = 0.06;
export const PROVISIONAL_RD_THRESHOLD = 110; // au-dessus = « en calibrage »
export const SKIP_DEFAULT_LEVEL = 3;  // auto-éval « passée » → départ neutre

// 1 → 8, dans l'ordre du référentiel.
export const TIERS = [
  'Débutant', 'Perfectionnement', 'Élémentaire', 'Intermédiaire',
  'Confirmé', 'Avancé', 'Expert', 'Élite',
] as const;

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Note interne → niveau 0–8 arrondi au dixième. */
export function ratingToLevel(rating: number): number {
  const lvl = ((rating - LEVEL_MIN_RATING) / (LEVEL_MAX_RATING - LEVEL_MIN_RATING)) * 8;
  return Math.round(clamp(lvl, 0, 8) * 10) / 10;
}

/** Niveau 0–8 → note interne (mapping inverse exact). */
export function levelToRating(level: number): number {
  return LEVEL_MIN_RATING + (clamp(level, 0, 8) / 8) * (LEVEL_MAX_RATING - LEVEL_MIN_RATING);
}

export function isProvisional(rd: number): boolean {
  return rd > PROVISIONAL_RD_THRESHOLD;
}

/** Palier nommé d'un niveau (jamais sous le palier 1, jamais au-dessus du 8). */
export function namedTier(level: number): string {
  const idx = clamp(Math.round(level), 1, 8);
  return TIERS[idx - 1];
}
