import crypto from 'crypto';

// Version de rendu de la carte OG de partie : à incrémenter quand le VISUEL change,
// pour invalider le cache disque ET les aperçus WhatsApp (le hash — donc l'URL
// og:image et l'URL de partage ?s= — change avec).
export const CARD_RENDER_VERSION = 'v1';

// Champs qui influencent le rendu de la carte. Toute évolution du visuel qui consomme
// un nouveau champ doit l'ajouter ici, sinon le cache servirait des cartes périmées.
export interface MatchCardState {
  players: Array<{
    userId: string;
    team: number | null;
    slot?: number | null;
    avatarUrl: string | null;
    level?: { level: number } | null;
  }>;
  spotsLeft: number;
  targetLevelMin: number | null;
  targetLevelMax: number | null;
  startTime: string; // ISO
  endTime: string; // ISO
  resourceName: string;
  accentColor: string;
  logoUrl: string | null;
}

/** Hash court et stable de l'état visuel d'une partie (12 hex). Pur, déterministe. */
export function matchCardStateHash(s: MatchCardState): string {
  const canonical = JSON.stringify({
    v: CARD_RENDER_VERSION,
    players: s.players.map((p) => [p.userId, p.team ?? null, p.slot ?? null, p.avatarUrl ?? null, p.level?.level ?? null]),
    spots: s.spotsLeft,
    lvl: [s.targetLevelMin, s.targetLevelMax],
    t: [s.startTime, s.endTime],
    r: s.resourceName,
    brand: [s.accentColor, s.logoUrl ?? null],
  });
  return crypto.createHash('md5').update(canonical).digest('hex').slice(0, 12);
}
