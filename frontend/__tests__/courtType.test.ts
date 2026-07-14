import { coverageType, COVERAGE_OPTIONS, LIGHTING_BADGE, capacityFor, lightingIsInformative } from '@/lib/courtType';

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
describe('lightingIsInformative', () => {
  it('faux si tous les terrains ont l\'éclairage (badge redondant)', () => {
    expect(lightingIsInformative([{ attributes: { lighting: true } }, { attributes: { lighting: true } }])).toBe(false);
  });
  it("vrai si au moins un terrain n'a pas l'éclairage", () => {
    expect(lightingIsInformative([{ attributes: { lighting: true } }, { attributes: { lighting: false } }])).toBe(true);
  });
  it('lighting absent compte comme non éclairé', () => {
    expect(lightingIsInformative([{ attributes: { lighting: true } }, { attributes: {} }])).toBe(true);
  });
  it('liste vide → faux (rien à distinguer)', () => expect(lightingIsInformative([])).toBe(false));
});
describe('capacityFor', () => {
  it('padel → 4', () => expect(capacityFor('padel')).toBe(4));
  it('padel single → 2', () => expect(capacityFor('padel', 'single')).toBe(2));
  it('tennis → 2', () => expect(capacityFor('tennis')).toBe(2));
  it('squash → 2', () => expect(capacityFor('squash')).toBe(2));
  it('pickleball → 4', () => expect(capacityFor('pickleball')).toBe(4));
  it('pickleball single → 2', () => expect(capacityFor('pickleball', 'single')).toBe(2));
  it('sport inconnu → 4', () => expect(capacityFor('badminton')).toBe(4));
  it('sport inconnu single → 2', () => expect(capacityFor('badminton', 'single')).toBe(2));
  it('sport undefined (sans format) → 4', () => expect(capacityFor(undefined)).toBe(4));
});
