import { inRange, rangeLabel, levelDistance } from '@/lib/levelMatch';

describe('inRange', () => {
  it('null fourchette → toujours dans la zone', () => expect(inRange(4, null, null)).toBe(true));
  it('dans la fourchette', () => expect(inRange(4, 3, 5)).toBe(true));
  it('sous la fourchette', () => expect(inRange(2, 3, 5)).toBe(false));
  it('au-dessus', () => expect(inRange(6, 3, 5)).toBe(false));
  it('niveau inconnu (null) → considéré dans la zone', () => expect(inRange(null, 3, 5)).toBe(true));
});
describe('rangeLabel', () => {
  it('fourchette complète', () => expect(rangeLabel(3, 5)).toBe('Niveau 3 à 5'));
  it('min seul', () => expect(rangeLabel(3, null)).toBe('Niveau 3 et +'));
  it('max seul', () => expect(rangeLabel(null, 5)).toBe("Niveau 5 et -"));
  it('aucune', () => expect(rangeLabel(null, null)).toBe('Tous niveaux'));
});
describe('levelDistance', () => {
  it('distance absolue', () => expect(levelDistance(4, 4.5)).toBeCloseTo(0.5));
  it('niveau inconnu → Infinity', () => expect(levelDistance(null, 4)).toBe(Infinity));
});
