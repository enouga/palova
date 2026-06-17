import { DateTime } from 'luxon';

export const MAX_OCCURRENCES = 60;

export interface SeriesSchedule {
  weekday: number;     // 1–7 (Luxon, 1=lundi)
  startLocal: string;  // "HH:mm"
  durationMin: number;
  startDate: string;   // "YYYY-MM-DD"
  endDate: string;     // "YYYY-MM-DD" (incluse)
  tz: string;
}

export interface Occurrence {
  startUtc: Date;
  endUtc: Date;
}

/**
 * Toutes les occurrences hebdomadaires d'une série, en UTC. L'heure est appliquée
 * EN LOCAL pour chaque date (donc stable à travers les changements d'heure / DST).
 * Lance VALIDATION_ERROR (entrées invalides ou intervalle vide) ou SERIES_TOO_LONG.
 */
export function weeklyOccurrences(s: SeriesSchedule): Occurrence[] {
  const m = /^(\d{2}):(\d{2})$/.exec(s.startLocal);
  if (!m) throw new Error('VALIDATION_ERROR');
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) throw new Error('VALIDATION_ERROR');
  if (!Number.isInteger(s.weekday) || s.weekday < 1 || s.weekday > 7) throw new Error('VALIDATION_ERROR');
  if (!Number.isInteger(s.durationMin) || s.durationMin <= 0) throw new Error('VALIDATION_ERROR');

  const startDay = DateTime.fromISO(s.startDate, { zone: s.tz }).startOf('day');
  const endDay = DateTime.fromISO(s.endDate, { zone: s.tz }).startOf('day');
  if (!startDay.isValid || !endDay.isValid || endDay < startDay) throw new Error('VALIDATION_ERROR');

  // Premier jour >= startDay tombant sur le bon weekday.
  let cursor = startDay.plus({ days: (s.weekday - startDay.weekday + 7) % 7 });

  const out: Occurrence[] = [];
  while (cursor <= endDay) {
    const start = cursor.set({ hour, minute, second: 0, millisecond: 0 });
    const end = start.plus({ minutes: s.durationMin });
    out.push({ startUtc: start.toUTC().toJSDate(), endUtc: end.toUTC().toJSDate() });
    if (out.length > MAX_OCCURRENCES) throw new Error('SERIES_TOO_LONG');
    cursor = cursor.plus({ days: 7 });
  }
  if (out.length === 0) throw new Error('VALIDATION_ERROR');
  return out;
}
