// Helpers purs de la page Réserver (présentation des créneaux + vue cartes/grille).
// Aucune dépendance React — testés isolément.

export type ReserveView = 'cards' | 'grid';

/** Clé localStorage de la vue préférée, scoppée au club (comme palova:reserve-sports:<clubId>). */
export const RESERVE_VIEW_KEY = (clubId: string) => `palova:reserve-view:${clubId}`;

/**
 * Partitionne les créneaux d'un terrain : `past` = déjà commencés (startTime <= nowMs,
 * même règle que l'affichage existant), `rest` = le reste, chacun dans l'ordre d'origine.
 */
export function splitPastSlots<T extends { startTime: string }>(
  slots: T[],
  nowMs: number,
): { past: T[]; rest: T[] } {
  const past: T[] = [];
  const rest: T[] = [];
  for (const s of slots) {
    if (new Date(s.startTime).getTime() <= nowMs) past.push(s);
    else rest.push(s);
  }
  return { past, rest };
}

/**
 * Libellé de rareté : affiché seulement quand il reste 1 à 3 créneaux réservables,
 * sinon null. `isToday` change la formulation (« aujourd'hui » vs « ce jour-là »).
 */
export function scarcityLabel(bookableCount: number, isToday: boolean): string | null {
  if (bookableCount < 1 || bookableCount > 3) return null;
  const noun = bookableCount === 1 ? 'créneau' : 'créneaux';
  return isToday
    ? `Plus que ${bookableCount} ${noun} aujourd'hui`
    : `Plus que ${bookableCount} ${noun} ce jour-là`;
}

/**
 * Colonnes de la vue grille : union triée (ISO) des heures de début À VENIR
 * de tous les terrains d'une section. Les créneaux passés sont exclus (pas de repli en grille).
 */
export function gridColumns<S extends { startTime: string }>(
  items: { slots: S[] }[],
  nowMs: number,
): string[] {
  const set = new Set<string>();
  for (const it of items) {
    for (const s of it.slots) {
      if (new Date(s.startTime).getTime() > nowMs) set.add(s.startTime);
    }
  }
  return [...set].sort();
}
