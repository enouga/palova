import type { NationalOpenMatch } from '@/lib/api';
import { distanceKm } from '@/lib/tournamentCalendar';
import { norm } from '@/lib/members';
import { rangesOverlap } from '@/lib/levelMatch';

// Helpers purs de l'onglet « Parties » de /decouvrir : filtre période/ville/niveau
// + tri par distance sur les parties ouvertes nationales (GET /api/open-matches/national).

export type DiscoverPeriod = 'today' | 'weekend' | 'all';

export interface DiscoverMatchFilter {
  period: DiscoverPeriod;
  city: string;
  myLevel: number | null;
}

export interface RankedMatch {
  match: NationalOpenMatch;
  distanceKm: number | null;
}

/**
 * Fenêtre [from, to] d'un preset de période, ancrée sur `now` (heure locale du visiteur).
 * `'all'` = pas de fenêtre (null). Weekend : samedi 00:00 → dimanche 23:59:59.999, un
 * dimanche en cours = ce jour seul (même logique que `whenWindow` de lib/events.ts —
 * dupliquée ici pour éviter un cycle events ↔ tournamentCalendar ↔ discover).
 */
export function discoverWindow(period: DiscoverPeriod, now: Date): { from: Date; to: Date } | null {
  if (period === 'all') return null;
  if (period === 'today') {
    return { from: now, to: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999) };
  }
  const dow = now.getDay(); // 0=dim … 6=sam
  const sat = dow === 0
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
    : new Date(now.getFullYear(), now.getMonth(), now.getDate() + (6 - dow));
  const end = dow === 0 ? sat : new Date(sat.getFullYear(), sat.getMonth(), sat.getDate() + 1);
  return { from: sat, to: new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999) };
}

/** Fourchette de niveau autour du niveau du joueur (arrondi ±1), pour le filtre « à mon niveau ». */
function myLevelWindow(myLevel: number): [number, number] {
  const center = Math.round(myLevel);
  return [center - 1, center + 1];
}

/**
 * Filtre les parties nationales par période + ville + niveau (ET entre dimensions).
 * Ville : comparaison insensible accents/casse (`norm`), substring — filtre vide = pas
 * de contrainte, sinon un club sans ville (`city: null`) est exclu. Niveau : une partie
 * sans fourchette (`targetLevelMin/Max` null) est toujours « ouverte à tous » — géré
 * nativement par `rangesOverlap` (bornes null = non bornées) sans cas particulier ;
 * `myLevel: null` désactive entièrement le filtre de niveau.
 */
export function filterNationalMatches(
  matches: NationalOpenMatch[],
  f: DiscoverMatchFilter,
  now: Date,
): NationalOpenMatch[] {
  const win = discoverWindow(f.period, now);
  const cityQuery = norm(f.city.trim());
  const levelWin = f.myLevel != null ? myLevelWindow(f.myLevel) : null;

  return matches.filter((m) => {
    if (win) {
      const t = new Date(m.startTime).getTime();
      if (t < win.from.getTime() || t > win.to.getTime()) return false;
    }
    if (cityQuery) {
      if (m.club.city == null || !norm(m.club.city).includes(cityQuery)) return false;
    }
    if (levelWin && !rangesOverlap(m.targetLevelMin, m.targetLevelMax, levelWin[0], levelWin[1])) return false;
    return true;
  });
}

/**
 * Trie par distance croissante (nulls — pas de géoloc visiteur ou pas de coords club —
 * en fin, tiebreak `startTime`, miroir `applyFilters` de tournamentCalendar.ts). Sans
 * `coords`, l'ordre d'entrée est conservé et `distanceKm` vaut `null` partout.
 */
export function sortMatchesByDistance(
  matches: NationalOpenMatch[],
  coords: { lat: number; lng: number } | null,
): RankedMatch[] {
  const ranked: RankedMatch[] = matches.map((match) => {
    const hasCoords = coords != null && match.club.latitude != null && match.club.longitude != null;
    return {
      match,
      distanceKm: hasCoords ? distanceKm(coords!, { lat: match.club.latitude!, lng: match.club.longitude! }) : null,
    };
  });
  if (!coords) return ranked;
  ranked.sort((a, b) => {
    if (a.distanceKm == null && b.distanceKm == null) return a.match.startTime.localeCompare(b.match.startTime);
    if (a.distanceKm == null) return 1;
    if (b.distanceKm == null) return -1;
    return a.distanceKm - b.distanceKm || a.match.startTime.localeCompare(b.match.startTime);
  });
  return ranked;
}

/** Libellé de distance : mètres sous 1 km, kilomètres arrondis au-delà. */
export function distanceLabel(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${Math.round(km)} km`;
}
