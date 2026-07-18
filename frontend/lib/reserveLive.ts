import type { ClubAvailability } from '@/lib/api';

// Événement du canal SSE club (miroir de SSEEvent backend, champs utiles seulement).
export interface SlotStreamEvent {
  type: 'slot_held' | 'slot_confirmed' | 'slot_released' | 'connected';
  resourceId: string;
  startTime?: string;
  endTime?: string;
}

export interface ApplyResult {
  next: Record<string, ClubAvailability[]>;
  changed: boolean;      // au moins un créneau a flippé (held/confirmed)
  needsRefetch: boolean; // slot_released touchant un créneau chargé → refetch débouncé
}

/**
 * Patch local d'un événement de créneau sur l'état `availBySport` de la page Réserver.
 * - held/confirmed : tout créneau CHEVAUCHANT [startTime, endTime) du bon terrain passe
 *   pris — chevauchement, pas égalité (une résa 1h30 bloque les créneaux 1h recouverts).
 *   Patch sûr sans connaître les autres résas : une résa active chevauchante suffit.
 * - released : PAS de patch local (le créneau peut rester couvert par une autre résa
 *   que le client ne connaît pas) → needsRefetch, le parent refetch débouncé (le cache
 *   serveur est invalidé AVANT le broadcast, le refetch obtient l'état frais).
 * - Un événement qui ne chevauche aucun créneau chargé (autre jour, terrain absent)
 *   est un no-op strict : même référence renvoyée, aucun re-render.
 */
export function applySlotEvent(
  avail: Record<string, ClubAvailability[]>,
  ev: SlotStreamEvent,
): ApplyResult {
  if (!ev.startTime || !ev.endTime || ev.type === 'connected') {
    return { next: avail, changed: false, needsRefetch: false };
  }
  const evStart = new Date(ev.startTime).getTime();
  const evEnd = new Date(ev.endTime).getTime();
  const overlaps = (s: { startTime: string; endTime: string }) =>
    new Date(s.startTime).getTime() < evEnd && new Date(s.endTime).getTime() > evStart;

  if (ev.type === 'slot_released') {
    const touches = Object.values(avail).some((list) =>
      list.some((a) => a.resource.id === ev.resourceId && a.slots.some(overlaps)));
    return { next: avail, changed: false, needsRefetch: touches };
  }

  // slot_held / slot_confirmed → créneaux chevauchants pris.
  let changed = false;
  const next: Record<string, ClubAvailability[]> = {};
  for (const [sportId, list] of Object.entries(avail)) {
    let listChanged = false;
    const newList = list.map((a) => {
      if (a.resource.id !== ev.resourceId) return a;
      let slotChanged = false;
      const slots = a.slots.map((s) => {
        if (!s.available || !overlaps(s)) return s;
        slotChanged = true;
        return { ...s, available: false };
      });
      if (!slotChanged) return a;
      listChanged = true;
      return { ...a, slots };
    });
    next[sportId] = listChanged ? newList : list;
    if (listChanged) changed = true;
  }
  return changed
    ? { next, changed: true, needsRefetch: false }
    : { next: avail, changed: false, needsRefetch: false };
}
