import type { NationalOpenMatch } from '@/lib/api';
import { distanceKm, DatePreset, resolveDateWindow } from '@/lib/tournamentCalendar';
import { norm } from '@/lib/members';
import { rangesOverlap } from '@/lib/levelMatch';

// Helpers purs de l'onglet « Parties » de /decouvrir : filtre date/ville/niveau + tri par
// distance sur les parties ouvertes nationales (GET /api/open-matches/national). Le filtre de
// date réutilise DatePreset/resolveDateWindow de tournamentCalendar.ts — même sélecteur
// « Aujourd'hui / Cette semaine / Ce mois-ci / Dates » que la section Tournois, pas une
// logique de fenêtre dupliquée.

export interface DiscoverMatchFilter {
  datePreset: DatePreset | null;
  dateFrom: string | null; // 'YYYY-MM-DD'
  dateTo: string | null;   // 'YYYY-MM-DD'
  kind: 'all' | 'competitive' | 'friendly';   // Pour de vrai / Pour le fun
  gender: 'all' | 'WOMEN' | 'MIXED';          // Féminine / Mixte
  location: LocationQuery;
  myLevel: number | null;
}

/** Requête de localisation parsée : ville OU codes département (exclusifs). */
export interface LocationQuery { city: string | null; deptCodes: string[] }

/** « Ville, code postal ou département » : un CP est réduit à son département (97x → 3 chiffres,
 *  Corse 20xxx → 2A+2B) ; un code 2-3 chiffres passe tel quel ; sinon recherche par nom. */
export function parseLocationQuery(q: string): LocationQuery {
  const t = q.trim();
  if (!t) return { city: null, deptCodes: [] };
  if (/^\d{5}$/.test(t)) {
    if (t.startsWith('20')) return { city: null, deptCodes: ['2A', '2B'] };
    if (t.startsWith('97')) return { city: null, deptCodes: [t.slice(0, 3)] };
    return { city: null, deptCodes: [t.slice(0, 2)] };
  }
  if (/^2[abAB]$/.test(t)) return { city: null, deptCodes: [t.toUpperCase()] };
  if (t === '20') return { city: null, deptCodes: ['2A', '2B'] };
  if (/^\d{2,3}$/.test(t)) return { city: null, deptCodes: [t] };
  return { city: t, deptCodes: [] };
}

export interface RankedMatch {
  match: NationalOpenMatch;
  distanceKm: number | null;
}

/**
 * Fourchette de niveau autour du niveau du joueur (arrondi ±1), clampée [1,8] (bornes du
 * système de niveau — miroir du clamp de `OpenMatches.tsx`), pour le filtre « à mon niveau ».
 */
function myLevelWindow(myLevel: number): [number, number] {
  const center = Math.round(myLevel);
  return [Math.max(1, center - 1), Math.min(8, center + 1)];
}

/**
 * Filtre les parties nationales par date + localisation + niveau (ET entre dimensions).
 * Localisation : soit une liste de codes département (`club.departmentCode`, comparaison
 * insensible casse, club sans code exclu), soit une recherche texte insensible accents/casse
 * (`norm`, substring) sur la ville OU le nom du département — les deux formes sont exclusives
 * (cf. `parseLocationQuery`) ; filtre vide = pas de contrainte. Niveau : une partie sans
 * fourchette (`targetLevelMin/Max` null) est toujours « ouverte à tous » — géré nativement par
 * `rangesOverlap` (bornes null = non bornées) sans cas particulier ; `myLevel: null` désactive
 * entièrement le filtre de niveau.
 */
export function filterNationalMatches(
  matches: NationalOpenMatch[],
  f: DiscoverMatchFilter,
  now: Date,
): NationalOpenMatch[] {
  const win = resolveDateWindow({ datePreset: f.datePreset, from: f.dateFrom, to: f.dateTo }, now);
  const { city, deptCodes } = f.location;
  const needle = city ? norm(city) : null;
  const levelWin = f.myLevel != null ? myLevelWindow(f.myLevel) : null;

  const locOk = (m: NationalOpenMatch) => {
    if (deptCodes.length) return m.club.departmentCode != null && deptCodes.includes(m.club.departmentCode.toUpperCase());
    if (needle) return (m.club.city != null && norm(m.club.city).includes(needle))
      || (m.club.department != null && norm(m.club.department).includes(needle));
    return true;
  };

  return matches.filter((m) => {
    if (win) {
      const t = new Date(m.startTime).getTime();
      if (t < win.from.getTime()) return false;
      if (win.to && t > win.to.getTime()) return false;
    }
    if (!locOk(m)) return false;
    if (levelWin && !rangesOverlap(m.targetLevelMin, m.targetLevelMax, levelWin[0], levelWin[1])) return false;
    // Type : competitive absent/true = « Pour de vrai », false = « Pour le fun » (miroir de
    // la logique de /parties, OpenMatches.tsx).
    if (f.kind !== 'all' && (m.competitive === false) !== (f.kind === 'friendly')) return false;
    if (f.gender !== 'all' && (m.gender ?? null) !== f.gender) return false;
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
