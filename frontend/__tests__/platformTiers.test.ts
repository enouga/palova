import { PLATFORM_TIERS, tierFor, tierPriceCents, tierLabel } from '@/lib/platformTiers';

describe('platformTiers (miroir front — garder synchro avec backend/src/services/platformBilling/tiers.ts)', () => {
  it('bornes des paliers', () => {
    expect([0, 50, 51, 150, 151, 400, 401, 800, 801].map(tierFor)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4]);
  });
  it('prix mensuels et annuels', () => {
    expect(PLATFORM_TIERS.map((t) => t.monthlyCents)).toEqual([0, 2900, 5900, 9900, 14900]);
    expect(tierPriceCents(4, 'year')).toBe(152000);
  });
  it('libellés', () => {
    expect(tierLabel(2)).toBe('151 – 400 membres actifs');
    expect(tierLabel(4)).toBe('801+ membres actifs');
  });
});
