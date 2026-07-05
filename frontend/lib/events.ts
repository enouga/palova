import type { Tournament, ClubEvent, ClubEventKind, TournamentGender, LessonSummary } from '@/lib/api';

// Helpers purs de la page Events : fusion tournois + animations + cours, filtre, libellés.

export type AgendaFilter = 'tout' | 'competitions' | 'animations' | 'cours';

// Ladder des catégories tournoi, pour trier les facettes (miroir de CATEGORIES côté admin).
export const CATEGORY_ORDER = ['P25', 'P50', 'P100', 'P250', 'P500', 'P1000', 'P1500', 'P2000'];
const GENDER_ORDER: TournamentGender[] = ['MEN', 'WOMEN', 'MIXED'];
const KIND_ORDER: ClubEventKind[] = ['MELEE', 'STAGE', 'SOIREE', 'INITIATION', 'AUTRE'];

export type AgendaItem =
  | { source: 'tournament'; startTime: string; endTime: string | null; tournament: Tournament }
  | { source: 'event'; startTime: string; endTime: string | null; event: ClubEvent }
  | { source: 'lesson'; startTime: string; endTime: string | null; lesson: LessonSummary };

export const KIND_LABEL: Record<ClubEventKind, string> = {
  MELEE: 'Mêlée', STAGE: 'Stage', SOIREE: 'Soirée', INITIATION: 'Initiation', AUTRE: 'Événement',
};

export const GENDER_LABEL: Record<TournamentGender, string> = { MEN: 'Messieurs', WOMEN: 'Dames', MIXED: 'Mixte' };

/** Fusionne tournois + animations PUBLISHED + cours à venir, triés par date de début. */
export function mergeAgenda(tournaments: Tournament[], events: ClubEvent[], lessons: LessonSummary[], now: Date): AgendaItem[] {
  const items: AgendaItem[] = [
    ...tournaments
      .filter((t) => t.status === 'PUBLISHED' && new Date(t.startTime) > now)
      .map((t) => ({ source: 'tournament' as const, startTime: t.startTime, endTime: t.endTime, tournament: t })),
    ...events
      .filter((e) => e.status === 'PUBLISHED' && new Date(e.startTime) > now)
      .map((e) => ({ source: 'event' as const, startTime: e.startTime, endTime: e.endTime, event: e })),
    ...lessons
      .filter((l) => new Date(l.reservation.startTime) > now)
      .map((l) => ({ source: 'lesson' as const, startTime: l.reservation.startTime, endTime: l.reservation.endTime, lesson: l })),
  ];
  // ISO UTC : ordre lexicographique = ordre chronologique
  return items.sort((a, b) => a.startTime.localeCompare(b.startTime));
}

export function filterAgenda(items: AgendaItem[], filter: AgendaFilter): AgendaItem[] {
  if (filter === 'competitions') return items.filter((i) => i.source === 'tournament');
  if (filter === 'animations') return items.filter((i) => i.source === 'event');
  if (filter === 'cours') return items.filter((i) => i.source === 'lesson');
  return items;
}

/** Libellé des places d'une animation — urgent (rouge) quand il reste ≤ 5 places. */
export function eventPlacesLabel(e: ClubEvent): { text: string; urgent: boolean } {
  if (e.capacity != null) {
    const left = e.capacity - e.confirmedCount;
    if (left <= 0) return { text: "Complet · liste d'attente possible", urgent: false };
    if (left <= 5) return { text: `Plus que ${left} place${left > 1 ? 's' : ''}`, urgent: true };
    return { text: `${left} places restantes`, urgent: false };
  }
  const n = e.confirmedCount;
  return { text: `${n} inscrit${n > 1 ? 's' : ''}`, urgent: false };
}

// --- Filtres avancés (rangée secondaire contextuelle multi-sélection) ---

// Fenêtre « Quand » : presets transverses à toutes les sources (miroir des presets
// du calendrier national — dupliqués ici pour éviter un cycle events ↔ tournamentCalendar).
export type AgendaWhen = 'weekend' | 'thisMonth' | 'days30';
export const WHEN_ORDER: AgendaWhen[] = ['weekend', 'thisMonth', 'days30'];
export const WHEN_LABEL: Record<AgendaWhen, string> = { weekend: 'Ce week-end', thisMonth: 'Ce mois-ci', days30: 'Sous 30 jours' };

/** Fenêtre [from, to] d'un preset, ancrée sur `now` (heure locale du visiteur). */
export function whenWindow(when: AgendaWhen, now: Date): { from: Date; to: Date } {
  if (when === 'days30') return { from: now, to: new Date(now.getTime() + 30 * 86_400_000) };
  if (when === 'thisMonth') return { from: now, to: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999) };
  // weekend : samedi 00:00 → dimanche 23:59 ; un dimanche en cours = ce jour seul.
  const dow = now.getDay(); // 0=dim … 6=sam
  const sat = dow === 0
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
    : new Date(now.getFullYear(), now.getMonth(), now.getDate() + (6 - dow));
  const end = dow === 0 ? sat : new Date(sat.getFullYear(), sat.getMonth(), sat.getDate() + 1);
  return { from: sat, to: new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999) };
}

export interface EventFilterState {
  source: AgendaFilter;
  categories: Set<string>;        // tournois — OU intra-dimension
  genders: Set<TournamentGender>; // tournois
  kinds: Set<ClubEventKind>;      // animations
  memberOnly: boolean;            // animations — true = réservées aux membres
  when: AgendaWhen | null;        // toutes sources — persiste au changement de source
}

export function emptyFilterState(): EventFilterState {
  return { source: 'tout', categories: new Set(), genders: new Set(), kinds: new Set(), memberOnly: false, when: null };
}

/** Valeurs de facettes réellement présentes dans les items, triées et dédupliquées. */
export function agendaFacets(items: AgendaItem[]): {
  categories: string[];
  genders: TournamentGender[];
  kinds: ClubEventKind[];
  hasMemberOnly: boolean;
} {
  const categories = new Set<string>();
  const genders = new Set<TournamentGender>();
  const kinds = new Set<ClubEventKind>();
  let hasMemberOnly = false;
  for (const i of items) {
    if (i.source === 'tournament') {
      categories.add(i.tournament.category);
      genders.add(i.tournament.gender);
    } else if (i.source === 'event') {
      kinds.add(i.event.kind);
      if (i.event.memberOnly) hasMemberOnly = true;
    }
    // source === 'lesson' : pas de facettes secondaires pour les cours (YAGNI)
  }
  const byOrder = <T>(order: T[]) => (a: T, b: T) => order.indexOf(a) - order.indexOf(b);
  return {
    categories: [...categories].sort(byOrder(CATEGORY_ORDER)),
    genders: [...genders].sort(byOrder(GENDER_ORDER)),
    kinds: [...kinds].sort(byOrder(KIND_ORDER)),
    hasMemberOnly,
  };
}

/**
 * Filtre l'agenda par l'état complet. La source s'applique d'abord ; « quand » (si `now`
 * est fourni) contraint toutes les sources par la date de début ; ensuite chaque
 * facette ne contraint QUE les items de sa source (les autres passent) :
 * tournoi gardé si (catégories vide || cat ∈ set) && (genres vide || genre ∈ set) ;
 * animation gardée si (kinds vide || kind ∈ set) && (!memberOnly || event.memberOnly).
 */
export function applyAgendaFilters(items: AgendaItem[], state: EventFilterState, now?: Date): AgendaItem[] {
  const win = state.when && now ? whenWindow(state.when, now) : null;
  return filterAgenda(items, state.source).filter((i) => {
    if (win) {
      const t = Date.parse(i.startTime);
      if (t < win.from.getTime() || t > win.to.getTime()) return false;
    }
    if (i.source === 'tournament') {
      if (state.categories.size > 0 && !state.categories.has(i.tournament.category)) return false;
      if (state.genders.size > 0 && !state.genders.has(i.tournament.gender)) return false;
      return true;
    }
    if (i.source === 'lesson') {
      // Pas de facettes secondaires pour les cours — ils passent toujours.
      return true;
    }
    if (state.kinds.size > 0 && !state.kinds.has(i.event.kind)) return false;
    if (state.memberOnly && !i.event.memberOnly) return false;
    return true;
  });
}

// --- Compteurs de facettes (même philosophie que le calendrier national) ---

export interface FacetCount<T = string> { value: T; count: number }

export interface AgendaCounts {
  sources: Record<AgendaFilter, number>;   // par source, sous « quand » seul (les facettes se réinitialisent au changement de source)
  when: Record<AgendaWhen, number>;        // par preset, sous source + facettes
  categories: FacetCount[];                // tournois passant les AUTRES dimensions
  genders: FacetCount<TournamentGender>[];
  kinds: FacetCount<ClubEventKind>[];      // animations passant les AUTRES dimensions
  memberOnly: number;
}

/**
 * Compte, pour chaque option de facette, les items qu'elle donnerait : chaque dimension
 * est évaluée sous les contraintes des AUTRES dimensions, jamais la sienne (une facette
 * ne se contraint pas elle-même). Les compteurs de catégories/genres ne comptent que les
 * tournois, kinds/membres que les animations (leurs facettes ne contraignent qu'eux).
 */
export function agendaCounts(
  items: AgendaItem[],
  state: EventFilterState,
  now: Date | null,
  facets: ReturnType<typeof agendaFacets>,
): AgendaCounts {
  const run = (over: Partial<EventFilterState>) => applyAgendaFilters(items, { ...state, ...over }, now ?? undefined);
  const only = (xs: AgendaItem[], s: AgendaItem['source']) => xs.filter((i) => i.source === s).length;

  const whenOnly = run({ source: 'tout', categories: new Set(), genders: new Set(), kinds: new Set(), memberOnly: false });
  const when = {} as Record<AgendaWhen, number>;
  for (const w of WHEN_ORDER) when[w] = run({ when: w }).length;

  return {
    sources: {
      tout: whenOnly.length,
      competitions: only(whenOnly, 'tournament'),
      animations: only(whenOnly, 'event'),
      cours: only(whenOnly, 'lesson'),
    },
    when,
    categories: facets.categories.map((c) => ({ value: c, count: only(run({ categories: new Set([c]) }), 'tournament') })),
    genders: facets.genders.map((g) => ({ value: g, count: only(run({ genders: new Set([g]) }), 'tournament') })),
    kinds: facets.kinds.map((k) => ({ value: k, count: only(run({ kinds: new Set([k]) }), 'event') })),
    memberOnly: only(run({ memberOnly: true }), 'event'),
  };
}
