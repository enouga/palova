import type { NationalOpenMatch } from '@/lib/api';
import { distanceKm, DatePreset, resolveDateWindow, DATE_PRESET_KEYS } from '@/lib/tournamentCalendar';
import { norm } from '@/lib/members';
import { rangesOverlap } from '@/lib/levelMatch';

// Helpers purs de l'onglet « Parties » de /decouvrir : filtre date/ville/niveau + tri par
// distance sur les parties ouvertes nationales (GET /api/open-matches/national). Le filtre de
// date réutilise DatePreset/resolveDateWindow de tournamentCalendar.ts — même sélecteur
// « Aujourd'hui / Cette semaine / Ce mois-ci / Dates » que la section Tournois, pas une
// logique de fenêtre dupliquée.

/** Type de partie : Pour de vrai / Pour le fun (miroir de OpenMatches.tsx). */
export type PartiesKind = 'all' | 'competitive' | 'friendly';
/** Genre de partie : Féminine / Mixte. */
export type PartiesGender = 'all' | 'WOMEN' | 'MIXED';

export interface DiscoverMatchFilter {
  datePreset: DatePreset | null;
  dateFrom: string | null; // 'YYYY-MM-DD'
  dateTo: string | null;   // 'YYYY-MM-DD'
  kind: PartiesKind;
  gender: PartiesGender;
  location: LocationQuery;
  myLevel: number | null;
}

/** Requête de localisation parsée : ville OU codes département (exclusifs). */
export interface LocationQuery { city: string | null; deptCodes: string[] }

/** Clé localStorage du texte de recherche par lieu de /decouvrir (ville / CP / département) —
 *  mémorisé d'une session à l'autre ; la géoloc « Autour de moi » n'est jamais rejouée. */
export const DISCOVER_LOCATION_KEY = 'palova:discover-location';

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

// ── Filtres « Ça joue bientôt » : mémoire de session + badge compteur ─────────

/** Clé localStorage des filtres Parties de /decouvrir (mémoire d'une session à l'autre). */
export const DISCOVER_PARTIES_FILTERS_KEY = 'palova:discover-parties-filters';

/** Forme JSON-sérialisable des filtres Parties. */
export interface StoredPartiesFilters {
  quand: DatePreset | null;
  from: string | null;
  to: string | null;
  type: PartiesKind;
  genre: PartiesGender;
  niveau: boolean;
}

export function partiesStateToStored(s: {
  datePreset: DatePreset | null; dateFrom: string | null; dateTo: string | null;
  kind: PartiesKind; gender: PartiesGender; levelOn: boolean;
}): StoredPartiesFilters {
  return { quand: s.datePreset, from: s.dateFrom, to: s.dateTo, type: s.kind, genre: s.gender, niveau: s.levelOn };
}

const PARTIES_KIND_VALUES: PartiesKind[] = ['all', 'competitive', 'friendly'];
const PARTIES_GENDER_VALUES: PartiesGender[] = ['all', 'WOMEN', 'MIXED'];

/** Réhydrate un état depuis le stockage — tolérant à toute entrée corrompue (miroir de
 *  `storedToCalendarState` de tournamentCalendar.ts). */
export function storedToPartiesState(raw: unknown): StoredPartiesFilters {
  const s: StoredPartiesFilters = { quand: null, from: null, to: null, type: 'all', genre: 'all', niveau: false };
  if (!raw || typeof raw !== 'object') return s;
  const o = raw as Record<string, unknown>;
  if (typeof o.quand === 'string' && (DATE_PRESET_KEYS as string[]).includes(o.quand)) s.quand = o.quand as DatePreset;
  if (typeof o.from === 'string') s.from = o.from;
  if (typeof o.to === 'string') s.to = o.to;
  if (typeof o.type === 'string' && (PARTIES_KIND_VALUES as string[]).includes(o.type)) s.type = o.type as PartiesKind;
  if (typeof o.genre === 'string' && (PARTIES_GENDER_VALUES as string[]).includes(o.genre)) s.genre = o.genre as PartiesGender;
  if (typeof o.niveau === 'boolean') s.niveau = o.niveau;
  return s;
}

/** Nombre de dimensions de filtre ACTIVES (badge « Filtres · N »). Le terme niveau ne compte
 *  que si la chip est visible (connecté + niveau calculé) — un `levelOn` restauré sans chip
 *  visible ne doit pas gonfler le badge d'un filtre invisible. Une plage from/to compte pour
 *  1, pas 2 (même règle que `activeFilterCount` de tournamentCalendar.ts). */
export function partiesFilterCount(f: {
  datePreset: DatePreset | null; dateFrom: string | null; dateTo: string | null;
  kind: PartiesKind; gender: PartiesGender; levelOn: boolean; levelChipVisible: boolean;
}): number {
  return (f.datePreset || f.dateFrom || f.dateTo ? 1 : 0)
    + (f.kind !== 'all' ? 1 : 0)
    + (f.gender !== 'all' ? 1 : 0)
    + (f.levelChipVisible && f.levelOn ? 1 : 0);
}

// ── Filtres Clubs (mode contrôlé de /decouvrir seulement) ─────────────────────

/** Clé localStorage des filtres Clubs de /decouvrir — mode contrôlé seulement, la vitrine
 *  anonyme (`ClubDirectory` en mode autonome) ne mémorise rien. */
export const DISCOVER_CLUBS_FILTERS_KEY = 'palova:discover-clubs-filters';

export interface StoredClubsFilters { q: string; sport: string }

export function clubsStateToStored(s: { q: string; sport: string }): StoredClubsFilters {
  return { q: s.q, sport: s.sport };
}

/** Réhydrate un état depuis le stockage — tolérant à toute entrée corrompue. */
export function storedToClubsFilters(raw: unknown): StoredClubsFilters {
  const s: StoredClubsFilters = { q: '', sport: '' };
  if (!raw || typeof raw !== 'object') return s;
  const o = raw as Record<string, unknown>;
  if (typeof o.q === 'string') s.q = o.q;
  if (typeof o.sport === 'string') s.sport = o.sport;
  return s;
}

// ── Filtre « Mes clubs » (mémorisé d'une session à l'autre) ───────────────────

/** Clé localStorage du toggle « Mes clubs » de /decouvrir. */
export const DISCOVER_MINE_ONLY_KEY = 'palova:discover-mine-only';
