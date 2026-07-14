import { inRange, rangeLabel, levelDistance, fmtLevel, rangesOverlap } from '@/lib/levelMatch';

describe('inRange', () => {
  it('null fourchette → toujours dans la zone', () => expect(inRange(4, null, null)).toBe(true));
  it('dans la fourchette', () => expect(inRange(4, 3, 5)).toBe(true));
  it('sous la fourchette', () => expect(inRange(2, 3, 5)).toBe(false));
  it('au-dessus', () => expect(inRange(6, 3, 5)).toBe(false));
  it('niveau inconnu (null) → considéré dans la zone', () => expect(inRange(null, 3, 5)).toBe(true));
});
describe('fmtLevel', () => {
  it('entier sans décimale', () => expect(fmtLevel(3)).toBe('3'));
  it('décimal avec virgule', () => expect(fmtLevel(3.2)).toBe('3,2'));
  it('arrondi au dixième', () => expect(fmtLevel(5.44)).toBe('5,4'));
  it('5.0 → entier', () => expect(fmtLevel(5.0)).toBe('5'));
});
describe('rangeLabel', () => {
  it('fourchette complète (entiers)', () => expect(rangeLabel(3, 5)).toBe('Niveau 3 à 5'));
  it('fourchette décimale', () => expect(rangeLabel(3.2, 5.4)).toBe('Niveau 3,2 à 5,4'));
  it('min seul', () => expect(rangeLabel(3, null)).toBe('Niveau 3 et +'));
  it('max seul', () => expect(rangeLabel(null, 5)).toBe("Niveau 5 et -"));
  it('aucune', () => expect(rangeLabel(null, null)).toBe('Tous niveaux'));
});
describe('levelDistance', () => {
  it('distance absolue', () => expect(levelDistance(4, 4.5)).toBeCloseTo(0.5));
  it('niveau inconnu → Infinity', () => expect(levelDistance(null, 4)).toBe(Infinity));
});
describe('rangesOverlap', () => {
  it('fourchettes qui se chevauchent', () => expect(rangesOverlap(2, 5, 4, 6)).toBe(true));
  it('fourchettes disjointes', () => expect(rangesOverlap(2, 5, 6, 8)).toBe(false));
  it('adjacentes (bornes égales) → chevauchent', () => expect(rangesOverlap(2, 4, 4, 6)).toBe(true));
  it('« ouverte à tous » (null,null) chevauche toute fourchette', () => expect(rangesOverlap(null, null, 3, 5)).toBe(true));
  it('borne du filtre non bornée d\'un côté', () => expect(rangesOverlap(6, 8, 3, null)).toBe(true));
});
