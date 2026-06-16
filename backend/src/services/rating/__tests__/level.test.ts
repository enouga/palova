import {
  ratingToLevel, levelToRating, isProvisional, namedTier, TIERS,
  DEFAULT_RD, SKIP_DEFAULT_LEVEL,
} from '../level';

describe('mapping interne ↔ 0–8', () => {
  it('calibrer à un palier puis relire redonne ce palier', () => {
    for (const L of [1, 2, 3, 4, 5, 6, 7, 8]) {
      expect(ratingToLevel(levelToRating(L))).toBeCloseTo(L, 1);
    }
  });
  it('le niveau reste borné dans [0,8]', () => {
    expect(ratingToLevel(50)).toBe(0);
    expect(ratingToLevel(99999)).toBe(8);
  });
});

describe('isProvisional', () => {
  it('RD max → provisoire', () => expect(isProvisional(DEFAULT_RD)).toBe(true));
  it('RD bas → fiabilisé', () => expect(isProvisional(80)).toBe(false));
});

describe('namedTier', () => {
  it('8 paliers nommés', () => expect(TIERS).toHaveLength(8));
  it('niveau ~4 → Intermédiaire', () => expect(namedTier(4)).toBe('Intermédiaire'));
  it('niveau 8 → Élite', () => expect(namedTier(8)).toBe('Élite'));
  it('niveau 0 → Débutant (jamais sous le palier 1)', () => expect(namedTier(0)).toBe('Débutant'));
});

describe('SKIP_DEFAULT_LEVEL', () => {
  it('départ neutre = 3', () => expect(SKIP_DEFAULT_LEVEL).toBe(3));
});
