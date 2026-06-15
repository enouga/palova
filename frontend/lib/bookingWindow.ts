import type { BookingReleaseMode } from './api';

const DAY_MS = 86_400_000;

/** Heure (0-23) de `now` dans le fuseau `tz`. */
function hourInTz(now: Date, tz: string): number {
  const h = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: tz }).format(now);
  return Number(h) % 24; // '24' (minuit) → 0
}

/** Clé calendaire 'YYYY-MM-DD' de `instant` dans le fuseau `tz`. */
export function dayKeyInTz(instant: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz }).format(instant);
}

/** Minutes depuis minuit (0-1439) de `instant` dans le fuseau `tz`. */
function minutesInTz(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).formatToParts(instant);
  const h = Number(parts.find((p) => p.type === 'hour')?.value) % 24;
  const m = Number(parts.find((p) => p.type === 'minute')?.value);
  return h * 60 + m;
}

/** Ajoute `n` jours à une clé 'YYYY-MM-DD' (arithmétique calendaire pure, sans fuseau). */
export function addDaysToKey(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export interface BookingWindow {
  /** Dernier jour sélectionnable 'YYYY-MM-DD' (pour DateSelector.maxKey). */
  maxDayKey: string;
  /** Un créneau (startTime ISO) est-il déjà ouvert à la réservation ? */
  slotAllowed: (startIso: string) => boolean;
}

/**
 * Fenêtre de réservation effective côté affichage — miroir de
 * backend `maxBookableInstant`. `now` = instant courant ; `tz` = fuseau du club.
 */
export function bookingWindow(
  now: Date, tz: string, windowDays: number, mode: BookingReleaseMode, releaseHour: number,
): BookingWindow {
  const W = Math.max(0, Math.trunc(windowDays || 0));
  const H = Math.min(23, Math.max(0, Math.trunc(releaseHour || 0)));
  const todayKey = dayKeyInTz(now, tz);

  if (mode === 'ROLLING_SLOT') {
    const maxInstant = now.getTime() + W * DAY_MS;
    return {
      maxDayKey: addDaysToKey(todayKey, W),
      slotAllowed: (iso) => new Date(iso).getTime() <= maxInstant,
    };
  }
  if (mode === 'WINDOW_SHIFT') {
    const maxDayKey = addDaysToKey(todayKey, W);
    return {
      maxDayKey,
      slotAllowed: (iso) => {
        const k = dayKeyInTz(new Date(iso), tz);
        if (k < maxDayKey) return true;
        if (k > maxDayKey) return false;
        return minutesInTz(new Date(iso), tz) <= H * 60;
      },
    };
  }
  // DAY_AT_HOUR (défaut) : journée entière ouverte → gating au niveau du jour.
  const released = hourInTz(now, tz) >= H ? W : Math.max(0, W - 1);
  return {
    maxDayKey: addDaysToKey(todayKey, released),
    slotAllowed: () => true,
  };
}
