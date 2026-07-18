import { bookingWindow, addDaysToKey } from '../lib/bookingWindow';

const tz = 'Europe/Paris';

describe('addDaysToKey', () => {
  it('ajoute des jours en arithmétique calendaire', () => {
    expect(addDaysToKey('2026-06-15', 7)).toBe('2026-06-22');
    expect(addDaysToKey('2026-06-30', 1)).toBe('2026-07-01');
  });
});

describe('bookingWindow', () => {
  it('DAY_AT_HOUR : avant l’heure ⇒ maxDayKey = aujourd’hui + (W-1)', () => {
    const now = new Date('2026-06-15T04:00:00.000Z'); // 06:00 Paris < 8h
    const w = bookingWindow(now, tz, 7, 'DAY_AT_HOUR', 8);
    expect(w.maxDayKey).toBe('2026-06-21');
    expect(w.slotAllowed('2026-06-21T17:00:00.000Z')).toBe(true); // journée entière ouverte
  });

  it('DAY_AT_HOUR : après l’heure ⇒ maxDayKey = aujourd’hui + W', () => {
    const now = new Date('2026-06-15T07:00:00.000Z'); // 09:00 Paris >= 8h
    const w = bookingWindow(now, tz, 7, 'DAY_AT_HOUR', 8);
    expect(w.maxDayKey).toBe('2026-06-22');
  });

  it('ROLLING_SLOT : un créneau au-delà de now + W jours est fermé', () => {
    const now = new Date('2026-06-15T10:00:00.000Z');
    const w = bookingWindow(now, tz, 7, 'ROLLING_SLOT', 8);
    expect(w.slotAllowed('2026-06-22T09:00:00.000Z')).toBe(true);  // <= now+7j
    expect(w.slotAllowed('2026-06-22T11:00:00.000Z')).toBe(false); // > now+7j
  });

  it('WINDOW_SHIFT : le dernier jour n’est ouvert que jusqu’à H:00 (heure club)', () => {
    const now = new Date('2026-06-15T10:00:00.000Z');
    const w = bookingWindow(now, tz, 7, 'WINDOW_SHIFT', 8);
    expect(w.maxDayKey).toBe('2026-06-22');
    // 2026-06-22 06:00 Paris (= 04:00Z) <= 8h => ouvert ; 10:00 Paris (= 08:00Z) > 8h => fermé
    expect(w.slotAllowed('2026-06-22T04:00:00.000Z')).toBe(true);
    expect(w.slotAllowed('2026-06-22T08:00:00.000Z')).toBe(false);
  });
});

import { nextOpening, formatCountdown } from '@/lib/bookingWindow';

describe('nextOpening (rendez-vous d\'ouverture)', () => {
  const tz2 = 'Europe/Paris';

  it('DAY_AT_HOUR H=0 avant minuit : ouvre au prochain minuit local, jour = aujourd\'hui + W', () => {
    // 2026-07-18 23:30 Paris (été, UTC+2) = 21:30 UTC
    const now = new Date('2026-07-18T21:30:00.000Z');
    const o = nextOpening(now, tz2, 7, 'DAY_AT_HOUR', 0)!;
    // prochain minuit local = 2026-07-19T00:00 Paris = 18T22:00Z
    expect(o.opensAtMs).toBe(new Date('2026-07-18T22:00:00.000Z').getTime());
    expect(o.dayKey).toBe('2026-07-26'); // 19 juillet + 7 jours
  });

  it('DAY_AT_HOUR H=8 : à 7h59 ouvre à 8h du même jour ; à 8h01 ouvre demain 8h', () => {
    const before = nextOpening(new Date('2026-07-18T05:59:00.000Z'), tz2, 7, 'DAY_AT_HOUR', 8)!; // 07:59 Paris
    expect(before.opensAtMs).toBe(new Date('2026-07-18T06:00:00.000Z').getTime()); // 08:00 Paris
    expect(before.dayKey).toBe('2026-07-25');

    const after = nextOpening(new Date('2026-07-18T06:01:00.000Z'), tz2, 7, 'DAY_AT_HOUR', 8)!; // 08:01 Paris
    expect(after.opensAtMs).toBe(new Date('2026-07-19T06:00:00.000Z').getTime()); // demain 08:00
    expect(after.dayKey).toBe('2026-07-26');
  });

  it('WINDOW_SHIFT : bascule au prochain minuit local', () => {
    const o = nextOpening(new Date('2026-07-18T10:00:00.000Z'), tz2, 14, 'WINDOW_SHIFT', 12)!;
    expect(o.opensAtMs).toBe(new Date('2026-07-18T22:00:00.000Z').getTime()); // minuit Paris
    expect(o.dayKey).toBe('2026-08-02'); // 19 juillet + 14
  });

  it('ROLLING_SLOT (fenêtre glissante continue) : pas de rendez-vous', () => {
    expect(nextOpening(new Date(), tz2, 7, 'ROLLING_SLOT', 0)).toBeNull();
  });

  it('fenêtre de 0 jour : pas de rendez-vous', () => {
    expect(nextOpening(new Date(), tz2, 0, 'DAY_AT_HOUR', 0)).toBeNull();
  });
});

describe('formatCountdown', () => {
  it('format hh:mm:ss au-delà d\'une heure, mm:ss en dessous', () => {
    expect(formatCountdown(3 * 3600_000 + 12 * 60_000 + 45_000)).toBe('03:12:45');
    expect(formatCountdown(12 * 60_000 + 5_000)).toBe('12:05');
    expect(formatCountdown(0)).toBe('00:00');
    expect(formatCountdown(-500)).toBe('00:00');
  });
});
