// Référentiel padel 0–8 (French Padel Shop). Miroir d'affichage de backend/src/services/rating/level.ts.
// Les descriptions servent à l'auto-évaluation.

export interface LevelTier {
  level: number;       // 1–8
  name: string;
  blurb: string;       // résumé court pour l'auto-éval
}

export const LEVEL_TIERS: LevelTier[] = [
  { level: 1, name: 'Débutant',          blurb: "Je commence à jouer, j'apprends les coups de base." },
  { level: 2, name: 'Perfectionnement',  blurb: "Je joue les coups de base, des échanges courts, je commence à volleyer." },
  { level: 3, name: 'Élémentaire',       blurb: "Je joue en loisir, je garde la balle en jeu, je commence la vitre de fond." },
  { level: 4, name: 'Intermédiaire',     blurb: "Longs échanges, je monte au filet et défends après un lob, placement selon mon partenaire." },
  { level: 5, name: 'Confirmé',          blurb: "Service-volée, repli sur lob, contre-attaque, effets et placement avec mon partenaire." },
  { level: 6, name: 'Avancé',            blurb: "Jeu rapide et effets, je maîtrise les doubles vitres et contre-attaque les smashs." },
  { level: 7, name: 'Expert',            blurb: "Je maîtrise tactique et coups appuyés (bandeja, vibora), bonne contre-attaque." },
  { level: 8, name: 'Élite',             blurb: "Niveau compétition national (P1000/P1500/P2000)." },
];

/** Palier correspondant à un niveau 0–8 décimal (arrondi au plus proche, borné 1–8). */
export function tierForLevel(level: number): LevelTier {
  const idx = Math.max(1, Math.min(8, Math.round(level)));
  return LEVEL_TIERS[idx - 1];
}

/** Clé du sport qui porte le système de niveau (grille Padel Magazine). */
export const LEVEL_SPORT_KEY = 'padel';

/** Ce sport utilise-t-il le système de niveau ? (padel uniquement) */
export function sportHasLevels(sportKey?: string | null): boolean {
  return sportKey === LEVEL_SPORT_KEY;
}
