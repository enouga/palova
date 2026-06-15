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
