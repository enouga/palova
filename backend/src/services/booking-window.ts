import { DateTime } from 'luxon';

export type BookingReleaseMode = 'DAY_AT_HOUR' | 'ROLLING_SLOT' | 'WINDOW_SHIFT';

/**
 * Dernier instant réservable selon le mode d'ouverture du club.
 * Un créneau démarrant à `startLocal` est autorisé ssi `startLocal <= retour`.
 * `now` doit être exprimé dans le fuseau du club.
 *
 * Rétrocompat : DAY_AT_HOUR + releaseHour=0 ⇒ fin de journée de aujourd'hui+W
 * (la fenêtre glisse à minuit, comportement historique).
 */
export function maxBookableInstant(
  now: DateTime,
  windowDays: number,
  mode: BookingReleaseMode,
  releaseHour: number,
): DateTime {
  const W = Math.max(0, Math.trunc(windowDays || 0));
  const H = Math.min(23, Math.max(0, Math.trunc(releaseHour || 0)));

  if (mode === 'ROLLING_SLOT') {
    return now.plus({ days: W });
  }
  if (mode === 'WINDOW_SHIFT') {
    return now.startOf('day').plus({ days: W }).set({ hour: H, minute: 0, second: 0, millisecond: 0 });
  }
  // DAY_AT_HOUR (défaut). Plancher 0 : avec W=0 le jour même reste ouvert.
  const released = now.hour >= H ? W : Math.max(0, W - 1);
  return now.startOf('day').plus({ days: released }).endOf('day');
}
