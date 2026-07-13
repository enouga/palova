// Groupage des listes admin Tournois & Events par statut, pour les cartes enrichies.
// Pur & générique (aucun theme, aucun React) → testable. `now` passé en paramètre
// (hydration-safe : la page pose l'horloge dans un effet, jamais new Date() au rendu).

export type AgendaStatus = 'DRAFT' | 'PUBLISHED' | 'CANCELLED';
export type AgendaGroupKey = 'draft' | 'upcoming' | 'past' | 'cancelled';

export interface AgendaGroup<T> {
  key: AgendaGroupKey;
  label: string;
  items: T[];
}

export interface AgendaAccessors<T> {
  status: (t: T) => AgendaStatus;
  start: (t: T) => string;                 // ISO
  end: (t: T) => string | null | undefined; // ISO ou null
}

const LABELS: Record<AgendaGroupKey, string> = {
  draft: 'Brouillons',
  upcoming: 'Publiés · à venir',
  past: 'Passés',
  cancelled: 'Annulés',
};

// Ordre d'affichage des sections.
const ORDER: AgendaGroupKey[] = ['draft', 'upcoming', 'past', 'cancelled'];

/** Section d'un item : brouillon / à venir / passé / annulé. Un publié bascule en « passé »
 *  dès que sa fin (ou son début s'il n'a pas de fin) est dépassée. */
export function agendaItemGroup(
  status: AgendaStatus,
  start: string,
  end: string | null | undefined,
  now: Date,
): AgendaGroupKey {
  if (status === 'DRAFT') return 'draft';
  if (status === 'CANCELLED') return 'cancelled';
  return new Date(end ?? start).getTime() < now.getTime() ? 'past' : 'upcoming';
}

/** Range les items en sections ordonnées ; les sections vides sont omises.
 *  Tri intra-section : Brouillons & À venir par début croissant (le plus proche d'abord),
 *  Passés & Annulés par début décroissant (le plus récent d'abord). */
export function groupAdminAgenda<T>(items: T[], now: Date, acc: AgendaAccessors<T>): AgendaGroup<T>[] {
  const buckets: Record<AgendaGroupKey, T[]> = { draft: [], upcoming: [], past: [], cancelled: [] };
  for (const t of items) {
    buckets[agendaItemGroup(acc.status(t), acc.start(t), acc.end(t), now)].push(t);
  }
  const asc = (a: T, b: T) => new Date(acc.start(a)).getTime() - new Date(acc.start(b)).getTime();
  const desc = (a: T, b: T) => asc(b, a);
  buckets.draft.sort(asc);
  buckets.upcoming.sort(asc);
  buckets.past.sort(desc);
  buckets.cancelled.sort(desc);
  return ORDER.filter((k) => buckets[k].length > 0).map((k) => ({ key: k, label: LABELS[k], items: buckets[k] }));
}
