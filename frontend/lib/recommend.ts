import type { OpenMatch } from '@/lib/api';
import { inRange } from '@/lib/levelMatch';

/** Centre d'une fourchette de niveau ; null si aucune borne (« tous niveaux »). */
export function rangeCenter(min: number | null | undefined, max: number | null | undefined): number | null {
  const lo = min ?? null;
  const hi = max ?? null;
  if (lo != null && hi != null) return (lo + hi) / 2;
  if (lo != null) return lo;
  if (hi != null) return hi;
  return null;
}

/**
 * Parties ouvertes « pour toi » : non complètes, à venir, où le joueur n'est pas inscrit,
 * et dont la fourchette l'inclut. Triées par proximité du niveau au centre de la fourchette
 * (« tous niveaux » relégués, distance +∞), puis par heure de début croissante.
 * Niveau inconnu → [].
 */
export function recommendMatches(matches: OpenMatch[], myLevel: number | null, now: Date): OpenMatch[] {
  if (myLevel == null) return [];
  const nowMs = now.getTime();
  const eligible = matches.filter((m) =>
    !m.full
    && new Date(m.startTime).getTime() > nowMs
    && !m.viewerIsParticipant
    && inRange(myLevel, m.targetLevelMin ?? null, m.targetLevelMax ?? null),
  );
  const dist = (m: OpenMatch) => {
    const c = rangeCenter(m.targetLevelMin, m.targetLevelMax);
    return c == null ? Infinity : Math.abs(myLevel - c);
  };
  return [...eligible].sort((a, b) =>
    dist(a) - dist(b) || new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
  );
}
