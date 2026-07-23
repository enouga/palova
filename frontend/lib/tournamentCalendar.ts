import { NationalTournament, TournamentGender } from './api';
import { CATEGORY_ORDER } from './events';

// ── État de filtre ────────────────────────────────────────────────────────────
export type DatePreset = 'today' | 'thisWeek' | 'thisMonth';

/** Sous-ensemble de `CalendarFilterState` utile au calcul de fenêtre — permet à
 *  `lib/discover.ts` (Parties) de réutiliser `resolveDateWindow` sans porter les champs
 *  propres aux tournois (deptCodes/categories/genders/nearMe). `CalendarFilterState` est
 *  un sur-ensemble structurel : tous les appels existants restent valides tels quels. */
export type DateFilterState = { datePreset: DatePreset | null; from: string | null; to: string | null };

/** Puces de préréglage partagées par le sélecteur « Quand » de Tournois (FacetPanel) et
 *  de Parties (DiscoverMatches) — un seul jeu de libellés, jamais deux copies. */
export const DATE_PRESETS: { key: DatePreset; label: string }[] = [
  { key: 'today', label: "Aujourd'hui" },
  { key: 'thisWeek', label: 'Cette semaine' },
  { key: 'thisMonth', label: 'Ce mois-ci' },
];

export interface CalendarFilterState {
  deptCodes: Set<string>;
  categories: Set<string>;
  genders: Set<TournamentGender>;
  datePreset: DatePreset | null;
  from: string | null; // 'YYYY-MM-DD' (heure locale du visiteur)
  to: string | null;   // 'YYYY-MM-DD'
  nearMe: boolean;
}

export function emptyCalendarState(): CalendarFilterState {
  return { deptCodes: new Set(), categories: new Set(), genders: new Set(), datePreset: null, from: null, to: null, nearMe: false };
}

// P25→P2000 : ordre canonique des catégories, réutilisé depuis lib/events.ts (source unique).
const GENDER_ORDER: TournamentGender[] = ['MEN', 'WOMEN', 'MIXED'];

// ── Fenêtre de date ─────────────────────────────────────────────────────────
function startOfLocalDay(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}
function endOfLocalDay(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}

/** Fenêtre [from, to] (to nullable = pas de borne haute). Plage custom prime sur le preset. */
export function resolveDateWindow(state: DateFilterState, now: Date): { from: Date; to: Date | null } | null {
  if (state.from || state.to) {
    return {
      from: state.from ? startOfLocalDay(state.from) : now,
      to: state.to ? endOfLocalDay(state.to) : null,
    };
  }
  if (!state.datePreset) return null;
  switch (state.datePreset) {
    case 'today':
      return { from: now, to: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999) };
    case 'thisWeek': {
      const dow = now.getDay(); // 0=dim … 6=sam
      const daysToSunday = dow === 0 ? 0 : 7 - dow;
      const sun = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysToSunday, 23, 59, 59, 999);
      return { from: now, to: sun };
    }
    case 'thisMonth': {
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999); // dernier jour du mois
      return { from: now, to };
    }
  }
}

// ── Prédicats de dimension ────────────────────────────────────────────────────
function inWindow(t: NationalTournament, win: { from: Date; to: Date | null } | null): boolean {
  if (!win) return true;
  const start = new Date(t.startTime).getTime();
  if (start < win.from.getTime()) return false;
  if (win.to && start > win.to.getTime()) return false;
  return true;
}
const inDepts = (t: NationalTournament, s: CalendarFilterState) => s.deptCodes.size === 0 || (t.club.departmentCode != null && s.deptCodes.has(t.club.departmentCode));
const inCats = (t: NationalTournament, s: CalendarFilterState) => s.categories.size === 0 || s.categories.has(t.category);
const inGenders = (t: NationalTournament, s: CalendarFilterState) => s.genders.size === 0 || s.genders.has(t.gender);

// ── Distance (haversine, miroir de geo.service backend) ───────────────────────
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// ── Application des filtres + tri ─────────────────────────────────────────────
export interface RankedTournament { tournament: NationalTournament; distanceKm: number | null }

export function applyFilters(
  items: NationalTournament[],
  state: CalendarFilterState,
  now: Date,
  coords?: { lat: number; lng: number },
): RankedTournament[] {
  const win = resolveDateWindow(state, now);
  const kept = items.filter((t) => inWindow(t, win) && inDepts(t, state) && inCats(t, state) && inGenders(t, state));
  const ranked: RankedTournament[] = kept.map((t) => {
    const hasCoords = state.nearMe && coords && t.club.latitude != null && t.club.longitude != null;
    return { tournament: t, distanceKm: hasCoords ? distanceKm(coords!, { lat: t.club.latitude!, lng: t.club.longitude! }) : null };
  });
  if (state.nearMe && coords) {
    // tri par distance (nulls en dernier), tiebreak date
    ranked.sort((a, b) => {
      if (a.distanceKm == null && b.distanceKm == null) return a.tournament.startTime.localeCompare(b.tournament.startTime);
      if (a.distanceKm == null) return 1;
      if (b.distanceKm == null) return -1;
      return a.distanceKm - b.distanceKm || a.tournament.startTime.localeCompare(b.tournament.startTime);
    });
  } else {
    ranked.sort((a, b) => a.tournament.startTime.localeCompare(b.tournament.startTime));
  }
  return ranked;
}

// ── Facettes (valeurs présentes + compteurs ne se contraignant pas eux-mêmes) ──
export interface DeptFacet { code: string; name: string; count: number }
export interface ValueFacet<T = string> { value: T; count: number }

export function calendarFacets(items: NationalTournament[], state: CalendarFilterState, now: Date): {
  departments: DeptFacet[];
  categories: ValueFacet[];
  genders: ValueFacet<TournamentGender>[];
} {
  const win = resolveDateWindow(state, now);

  // Département : compte sous (date + cat + genre), PAS sous lui-même.
  const deptNames = new Map<string, string>();
  const deptCount = new Map<string, number>();
  for (const t of items) {
    if (!(inWindow(t, win) && inCats(t, state) && inGenders(t, state))) continue;
    const code = t.club.departmentCode;
    if (!code) continue;
    if (!deptNames.has(code)) deptNames.set(code, t.club.department ?? code);
    deptCount.set(code, (deptCount.get(code) ?? 0) + 1);
  }
  const departments = [...deptCount.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((code) => ({ code, name: deptNames.get(code)!, count: deptCount.get(code)! }));

  // Catégorie : compte sous (date + dept + genre).
  const catCount = new Map<string, number>();
  for (const t of items) {
    if (!(inWindow(t, win) && inDepts(t, state) && inGenders(t, state))) continue;
    catCount.set(t.category, (catCount.get(t.category) ?? 0) + 1);
  }
  const categories = [...catCount.keys()]
    .sort((a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b))
    .map((value) => ({ value, count: catCount.get(value)! }));

  // Genre : compte sous (date + dept + cat).
  const genCount = new Map<TournamentGender, number>();
  for (const t of items) {
    if (!(inWindow(t, win) && inDepts(t, state) && inCats(t, state))) continue;
    genCount.set(t.gender, (genCount.get(t.gender) ?? 0) + 1);
  }
  const genders = [...genCount.keys()]
    .sort((a, b) => GENDER_ORDER.indexOf(a) - GENDER_ORDER.indexOf(b))
    .map((value) => ({ value, count: genCount.get(value)! }));

  return { departments, categories, genders };
}

// ── Chip « 📅 Dates » du FacetPanel ──────────────────────────────────────────
// Libellé court d'une plage YYYY-MM-DD, sans passer par Date (aucun fuseau).
const MONTHS_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

function dayMonthLabel(key: string): string {
  const [, m, d] = key.split('-');
  return `${Number(d)} ${MONTHS_FR[Number(m) - 1]}`;
}

/** « 24 juil. → 2 août » / « Du 24 juil. » / « Jusqu'au 2 août » / null si aucune borne. */
export function rangeChipLabel(from: string | null, to: string | null): string | null {
  if (from && to) return `${dayMonthLabel(from)} → ${dayMonthLabel(to)}`;
  if (from) return `Du ${dayMonthLabel(from)}`;
  if (to) return `Jusqu'au ${dayMonthLabel(to)}`;
  return null;
}
