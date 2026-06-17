import { coverageType, COVERAGE_OPTIONS, LIGHTING_BADGE } from '@/lib/courtType';

describe('coverageType', () => {
  it('indoor → Intérieur', () => expect(coverageType('indoor').label).toBe('Intérieur'));
  it('semi → Semi-couvert', () => expect(coverageType('semi').label).toBe('Semi-couvert'));
  it('outdoor → Extérieur', () => expect(coverageType('outdoor').label).toBe('Extérieur'));
  it('undefined → Extérieur (fallback rétrocompat)', () => expect(coverageType(undefined).label).toBe('Extérieur'));
  it('chaque cas a une icône et une couleur', () => {
    for (const c of ['indoor', 'outdoor', 'semi'] as const) {
      const t = coverageType(c);
      expect(t.icon).toBeTruthy();
      expect(t.color).toMatch(/^#/);
    }
  });
});
describe('COVERAGE_OPTIONS', () => {
  it("liste les 3 états dans l'ordre Intérieur, Extérieur, Semi-couvert", () => {
    expect(COVERAGE_OPTIONS.map((o) => o.value)).toEqual(['indoor', 'outdoor', 'semi']);
  });
});
describe('LIGHTING_BADGE', () => {
  it('porte le libellé Éclairage', () => expect(LIGHTING_BADGE.label).toBe('Éclairage'));
});
