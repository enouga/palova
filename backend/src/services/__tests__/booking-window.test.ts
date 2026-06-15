import { DateTime } from 'luxon';
import { maxBookableInstant } from '../booking-window';

const tz = 'Europe/Paris';
const at = (iso: string) => DateTime.fromISO(iso, { zone: tz });

describe('maxBookableInstant', () => {
  describe('DAY_AT_HOUR', () => {
    it("rétrocompat : H=0 ⇒ fin de journée de aujourd'hui + W", () => {
      const max = maxBookableInstant(at('2026-06-15T06:00'), 7, 'DAY_AT_HOUR', 0);
      expect(max.toISO()).toBe(at('2026-06-22T00:00').endOf('day').toISO());
    });
    it("avant l'heure de release ⇒ W-1 jours", () => {
      const max = maxBookableInstant(at('2026-06-15T06:00'), 7, 'DAY_AT_HOUR', 8);
      expect(max.toISODate()).toBe('2026-06-21');
    });
    it("à/après l'heure de release ⇒ W jours", () => {
      const max = maxBookableInstant(at('2026-06-15T08:00'), 7, 'DAY_AT_HOUR', 8);
      expect(max.toISODate()).toBe('2026-06-22');
    });
    it("W=0 : le jour même reste ouvert même avant l'heure", () => {
      const max = maxBookableInstant(at('2026-06-15T06:00'), 0, 'DAY_AT_HOUR', 8);
      expect(max.toISODate()).toBe('2026-06-15');
    });
  });
  describe('ROLLING_SLOT', () => {
    it("ouvre exactement W jours après l'instant courant (heure ignorée)", () => {
      const max = maxBookableInstant(at('2026-06-15T18:30'), 7, 'ROLLING_SLOT', 8);
      expect(max.toISO()).toBe(at('2026-06-22T18:30').toISO());
    });
  });
  describe('WINDOW_SHIFT', () => {
    it('coupe à J+W à H:00', () => {
      const max = maxBookableInstant(at('2026-06-15T18:30'), 7, 'WINDOW_SHIFT', 8);
      expect(max.toISO()).toBe(at('2026-06-22T08:00').toISO());
    });
  });
});
