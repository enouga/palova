import { splitPastSlots, scarcityLabel, gridColumns, RESERVE_VIEW_KEY } from '../lib/reserveView';

const iso = (offsetH: number) => new Date(Date.now() + offsetH * 3600e3).toISOString();

describe('reserveView helpers', () => {
  describe('splitPastSlots', () => {
    it('partitionne selon nowMs (<= now = passé), en conservant l\'ordre', () => {
      const now = Date.now();
      const slots = [
        { startTime: iso(-2) }, // passé
        { startTime: iso(-1) }, // passé
        { startTime: iso(1) },  // à venir
        { startTime: iso(3) },  // à venir
      ];
      const { past, rest } = splitPastSlots(slots, now);
      expect(past).toHaveLength(2);
      expect(rest).toHaveLength(2);
      expect(rest[0].startTime).toBe(slots[2].startTime);
    });
    it('renvoie tout dans rest quand rien n\'est passé', () => {
      const { past, rest } = splitPastSlots([{ startTime: iso(1) }], Date.now());
      expect(past).toHaveLength(0);
      expect(rest).toHaveLength(1);
    });
  });

  describe('scarcityLabel', () => {
    it('null en dehors de 1..3', () => {
      expect(scarcityLabel(0, true)).toBeNull();
      expect(scarcityLabel(4, true)).toBeNull();
    });
    it('singulier/pluriel + variante jour', () => {
      expect(scarcityLabel(1, true)).toBe("Plus que 1 créneau aujourd'hui");
      expect(scarcityLabel(3, true)).toBe("Plus que 3 créneaux aujourd'hui");
      expect(scarcityLabel(2, false)).toBe('Plus que 2 créneaux ce jour-là');
    });
  });

  describe('gridColumns', () => {
    it('union triée des heures À VENIR sur tous les terrains (passés exclus, dédupliqués)', () => {
      const now = Date.now();
      const items = [
        { slots: [{ startTime: iso(-1) }, { startTime: iso(2) }, { startTime: iso(1) }] },
        { slots: [{ startTime: iso(1) }, { startTime: iso(3) }] },
      ];
      const cols = gridColumns(items, now);
      expect(cols).toEqual([...cols].sort());          // trié
      expect(cols).toHaveLength(3);                      // iso(1), iso(2), iso(3) — iso(-1) exclu, iso(1) dédup
      expect(cols.some((c) => c === iso(-1))).toBe(false);
    });
  });

  it('RESERVE_VIEW_KEY est scoppé au club', () => {
    expect(RESERVE_VIEW_KEY('c1')).toBe('palova:reserve-view:c1');
  });
});
