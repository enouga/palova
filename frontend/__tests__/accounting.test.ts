import { monthLabel, monthRange, methodLabel, fmtAmount } from '@/lib/accounting';

describe('monthLabel', () => {
  it('contient l\'année', () => {
    expect(monthLabel(2026, 6)).toContain('2026');
  });

  it('contient le mois en français', () => {
    const label = monthLabel(2026, 6);
    // "juin" en minuscules dans la locale fr-FR
    expect(label.toLowerCase()).toContain('juin');
  });

  it('fonctionne pour janvier', () => {
    const label = monthLabel(2025, 1);
    expect(label).toContain('2025');
    expect(label.toLowerCase()).toContain('janvier');
  });

  it('fonctionne pour décembre', () => {
    const label = monthLabel(2024, 12);
    expect(label).toContain('2024');
    expect(label.toLowerCase()).toContain('décembre');
  });
});

describe('monthRange', () => {
  it('renvoie le premier et dernier jour de juin 2026', () => {
    expect(monthRange(2026, 6)).toEqual({ from: '2026-06-01', to: '2026-06-30' });
  });

  it('gère les mois à 31 jours', () => {
    expect(monthRange(2026, 1)).toEqual({ from: '2026-01-01', to: '2026-01-31' });
  });

  it('gère février (non bissextile)', () => {
    expect(monthRange(2025, 2)).toEqual({ from: '2025-02-01', to: '2025-02-28' });
  });

  it('gère février bissextile', () => {
    expect(monthRange(2024, 2)).toEqual({ from: '2024-02-01', to: '2024-02-29' });
  });
});

describe('methodLabel', () => {
  it('traduit CASH', () => {
    expect(methodLabel('CASH')).toBe('Espèces');
  });

  it('renvoie la clé brute si inconnue', () => {
    expect(methodLabel('UNKNOWN_METHOD')).toBe('UNKNOWN_METHOD');
  });
});

describe('fmtAmount', () => {
  it('formate un montant entier', () => {
    expect(fmtAmount('52.00')).toBe('52 €');
  });

  it('formate un montant décimal', () => {
    expect(fmtAmount('13.50')).toBe('13,50 €');
  });
});
