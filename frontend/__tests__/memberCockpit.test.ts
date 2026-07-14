import { resasLast30, spent12moCents, reliabilityPct, unpaidTotalCents } from '../lib/memberCockpit';

const NOW = new Date('2026-07-14T12:00:00Z').getTime();

describe('memberCockpit helpers', () => {
  it('resasLast30 : confirmées dans [now−30j, now], annulées et futures exclues', () => {
    const rows = [
      { status: 'CONFIRMED' as const, startTime: '2026-07-01T18:00:00Z' },  // ✓
      { status: 'CONFIRMED' as const, startTime: '2026-06-20T18:00:00Z' },  // ✓ (24 j)
      { status: 'CONFIRMED' as const, startTime: '2026-05-01T18:00:00Z' },  // trop vieux
      { status: 'CONFIRMED' as const, startTime: '2026-07-20T18:00:00Z' },  // futur
      { status: 'CANCELLED' as const, startTime: '2026-07-05T18:00:00Z' },  // annulée
    ];
    expect(resasLast30(rows, NOW)).toBe(2);
  });

  it('spent12moCents : somme des 12 derniers mois calendaires, mois plus vieux exclus', () => {
    const series = [
      { month: '2026-07', net: '20.00' },
      { month: '2026-01', net: '10.50' },
      { month: '2025-08', net: '5.00' },   // il y a 11 mois → inclus
      { month: '2025-07', net: '99.00' },  // il y a 12 mois → exclu
    ];
    expect(spent12moCents(series, NOW)).toBe(3550);
  });

  it('reliabilityPct : 100 − taux d\'annulation, arrondi', () => {
    expect(reliabilityPct(0)).toBe(100);
    expect(reliabilityPct(0.038)).toBe(96);
    expect(reliabilityPct(1)).toBe(0);
  });

  it('unpaidTotalCents : somme des restes dus', () => {
    expect(unpaidTotalCents([{ dueAmount: '8.00' }, { dueAmount: '5.50' }])).toBe(1350);
    expect(unpaidTotalCents([])).toBe(0);
  });
});
