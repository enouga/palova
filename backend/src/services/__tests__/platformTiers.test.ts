import {
  PLATFORM_TIERS, tierFor, tierPriceCents, tierLabel, priceLookupKey, tierFromLookupKey,
} from '../platformBilling/tiers';

describe('PLATFORM_TIERS', () => {
  it('a 5 paliers, du gratuit au plafond', () => {
    expect(PLATFORM_TIERS).toHaveLength(5);
    expect(PLATFORM_TIERS[0]).toEqual({ tier: 0, maxMembers: 50, monthlyCents: 0, yearlyCents: 0 });
    expect(PLATFORM_TIERS[4].maxMembers).toBeNull();
  });
});

describe('tierFor — bornes exactes', () => {
  it.each([
    [0, 0], [50, 0], [51, 1], [150, 1], [151, 2], [400, 2], [401, 3], [800, 3], [801, 4], [5000, 4],
  ])('%i membres → palier %i', (members, tier) => {
    expect(tierFor(members)).toBe(tier);
  });
});

describe('tierPriceCents', () => {
  it('mensuel : 0/2900/5900/9900/14900', () => {
    expect([0, 1, 2, 3, 4].map((t) => tierPriceCents(t, 'month'))).toEqual([0, 2900, 5900, 9900, 14900]);
  });
  it('annuel (~-15 %) : 29600/60200/101000/152000', () => {
    expect([1, 2, 3, 4].map((t) => tierPriceCents(t, 'year'))).toEqual([29600, 60200, 101000, 152000]);
  });
  it('palier inconnu → TIER_INVALID', () => {
    expect(() => tierPriceCents(9, 'month')).toThrow('TIER_INVALID');
  });
});

describe('tierLabel', () => {
  it('libellés lisibles', () => {
    expect(tierLabel(0)).toBe('0 – 50 membres actifs');
    expect(tierLabel(1)).toBe('51 – 150 membres actifs');
    expect(tierLabel(4)).toBe('801+ membres actifs');
  });
});

describe('lookup keys Stripe', () => {
  it('aller-retour', () => {
    expect(priceLookupKey(2, 'year')).toBe('palova_t2_year');
    expect(tierFromLookupKey('palova_t2_year')).toEqual({ tier: 2, interval: 'year' });
    expect(tierFromLookupKey('palova_t0_month')).toBeNull(); // pas de prix pour le gratuit
    expect(tierFromLookupKey(null)).toBeNull();
    expect(tierFromLookupKey('autre_chose')).toBeNull();
  });
});
