import { packageLabel, isUsable, canCover } from '@/lib/packages';
import type { MemberPackage } from '@/lib/api';

const entries = (remaining: number, expiresAt: string | null = null): MemberPackage => ({
  id: 'p1', kind: 'ENTRIES', creditsTotal: 10, creditsRemaining: remaining,
  amountTotal: null, amountRemaining: null, purchasedAt: '2026-06-01T00:00:00Z',
  expiresAt, template: { name: '10 entrées' },
});

const wallet = (remaining: string): MemberPackage => ({
  id: 'p2', kind: 'WALLET', creditsTotal: null, creditsRemaining: null,
  amountTotal: '200.00', amountRemaining: remaining, purchasedAt: '2026-06-01T00:00:00Z',
  expiresAt: null, template: { name: 'Avoir 200 €' },
});

describe('packageLabel', () => {
  it('libelle un carnet avec ses entrées restantes', () => {
    expect(packageLabel(entries(7))).toBe('Carnet — 7 entrées');
    expect(packageLabel(entries(1))).toBe('Carnet — 1 entrée');
  });
  it('libelle un porte-monnaie avec son solde €', () => {
    expect(packageLabel(wallet('53.50'))).toBe('Porte-monnaie — 53,50 €');
  });
});

describe('isUsable', () => {
  const now = new Date('2026-06-10T12:00:00Z');
  it('carnet avec crédit non expiré → utilisable', () => {
    expect(isUsable(entries(1), now)).toBe(true);
  });
  it('carnet épuisé ou expiré → non utilisable', () => {
    expect(isUsable(entries(0), now)).toBe(false);
    expect(isUsable(entries(5, '2026-06-09T00:00:00Z'), now)).toBe(false);
  });
  it('porte-monnaie à 0 → non utilisable', () => {
    expect(isUsable(wallet('0.00'), now)).toBe(false);
  });
});

describe('canCover', () => {
  const now = new Date('2026-06-10T12:00:00Z');
  it('un carnet utilisable couvre toujours (1 entrée = 1 résa)', () => {
    expect(canCover(entries(1), 999, now)).toBe(true);
  });
  it('un porte-monnaie couvre si son solde >= montant', () => {
    expect(canCover(wallet('25.00'), 25, now)).toBe(true);
    expect(canCover(wallet('24.99'), 25, now)).toBe(false);
  });
});
