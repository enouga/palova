import { countBarsModel, centsSeriesToDecimal, daysSince } from '@/lib/platformStats';

describe('countBarsModel', () => {
  it('auto-zoom [0, max], barres réparties, hauteur ∝ valeur', () => {
    const m = countBarsModel([
      { month: '2026-05', count: 0 },
      { month: '2026-06', count: 5 },
      { month: '2026-07', count: 10 },
    ], 300, 100);
    expect(m.max).toBe(10);
    expect(m.bars).toHaveLength(3);
    expect(m.bars[0].h).toBe(0);      // count 0 → hauteur nulle
    expect(m.bars[2].h).toBe(100);    // max → pleine hauteur
    expect(m.bars[2].value).toBe(10);
  });

  it('max 0 → toutes les barres à plat, pas de division par zéro', () => {
    const m = countBarsModel([{ month: '2026-07', count: 0 }], 300, 100);
    expect(m.max).toBe(0);
    expect(m.bars[0].h).toBe(0);
  });
});

describe('centsSeriesToDecimal', () => {
  it('convertit les centimes en strings décimales pour MonthlyRevenueChart', () => {
    expect(centsSeriesToDecimal([{ month: '2026-07', amountCents: 5900 }]))
      .toEqual([{ month: '2026-07', net: '59.00' }]);
  });
});

describe('daysSince', () => {
  it('compte les jours pleins, ≥ 0', () => {
    expect(daysSince('2026-07-01T00:00:00Z', '2026-07-08T00:00:00Z')).toBe(7);
    expect(daysSince('2026-07-08T00:00:00Z', '2026-07-01T00:00:00Z')).toBe(0); // pas de négatif
  });
  it('null si la date est absente', () => {
    expect(daysSince(null, '2026-07-08T00:00:00Z')).toBeNull();
  });
});
