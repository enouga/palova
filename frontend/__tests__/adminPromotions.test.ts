import { promoStatus, groupPromotions, discountLabel, windowLabel, targetLabel } from '../lib/adminPromotions';
import type { Promotion } from '../lib/api';

const mk = (o: Partial<Promotion>): Promotion => ({
  id: 'p', name: 'P', startDate: '2026-08-01', endDate: '2026-08-31', windowStart: null, windowEnd: null,
  kind: 'PERCENT', percentOff: 20, fixedPrice: null, enabled: true, resourceIds: [], createdAt: '2026-07-01T00:00:00Z', ...o,
});

describe('promoStatus', () => {
  const now = Date.parse('2026-08-15T12:00:00Z');
  it('en cours si now dans [start, end]', () => { expect(promoStatus(mk({}), now)).toBe('running'); });
  it('à venir si start futur', () => { expect(promoStatus(mk({ startDate: '2026-09-01', endDate: '2026-09-30' }), now)).toBe('upcoming'); });
  it('passée si end révolu', () => { expect(promoStatus(mk({ startDate: '2026-07-01', endDate: '2026-07-31' }), now)).toBe('past'); });
});

describe('groupPromotions', () => {
  it('range en running / upcoming / past', () => {
    const now = Date.parse('2026-08-15T12:00:00Z');
    const g = groupPromotions([mk({ id: 'a' }), mk({ id: 'b', startDate: '2026-09-01', endDate: '2026-09-30' }), mk({ id: 'c', startDate: '2026-07-01', endDate: '2026-07-31' })], now);
    expect(g.running.map(p => p.id)).toEqual(['a']);
    expect(g.upcoming.map(p => p.id)).toEqual(['b']);
    expect(g.past.map(p => p.id)).toEqual(['c']);
  });
});

describe('discountLabel', () => {
  it('% → "−20 %"', () => { expect(discountLabel(mk({ kind: 'PERCENT', percentOff: 20 }))).toBe('−20 %'); });
  it('fixe → "15 €"', () => { expect(discountLabel(mk({ kind: 'FIXED', percentOff: null, fixedPrice: '15.00' }))).toBe('15 €'); });
});

describe('windowLabel', () => {
  it('null si pas de fenêtre', () => { expect(windowLabel(mk({}))).toBeNull(); });
  it('"18h–20h" si fenêtre', () => { expect(windowLabel(mk({ windowStart: 1080, windowEnd: 1200 }))).toBe('18h–20h'); });
});

describe('targetLabel', () => {
  it('tous les terrains si vide', () => { expect(targetLabel(mk({ resourceIds: [] }), 5)).toBe('Tous les terrains'); });
  it('n terrains sinon', () => { expect(targetLabel(mk({ resourceIds: ['a', 'b'] }), 5)).toBe('2 terrains'); });
  it('accord singulier', () => { expect(targetLabel(mk({ resourceIds: ['a'] }), 5)).toBe('1 terrain'); });
});
