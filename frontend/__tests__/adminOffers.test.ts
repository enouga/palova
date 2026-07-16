import {
  OFFER_TINTS, offerAccent, offerTint, planPulse, packagePulse, planRevenueCents, splitByActive,
} from '../lib/adminOffers';
import type { PackageTemplate, SubscriberRow } from '../lib/api';
import { ACCENTS } from '../lib/theme';

describe('offerAccent', () => {
  it('cycle sur la palette', () => {
    expect(offerAccent(0)).toBe(OFFER_TINTS[0]);
    expect(offerAccent(OFFER_TINTS.length)).toBe(OFFER_TINTS[0]);
    expect(offerAccent(OFFER_TINTS.length + 2)).toBe(OFFER_TINTS[2]);
  });
});

describe('offerTint', () => {
  it('un abonnement est toujours bleu', () => {
    expect(offerTint('SUBSCRIPTION')).toBe(ACCENTS.blue);
  });
  it('un carnet (ENTRIES) est toujours abricot', () => {
    expect(offerTint('ENTRIES')).toBe(ACCENTS.apricot);
  });
  it('un porte-monnaie (WALLET) est toujours émeraude', () => {
    expect(offerTint('WALLET')).toBe(ACCENTS.emerald);
  });
});


describe('planPulse', () => {
  it('abonnés + revenu quand il y a des ventes', () => {
    expect(planPulse(12, 58800)).toBe('12 abonnés actifs · 588 €/mois');
    expect(planPulse(1, 4900)).toBe('1 abonné actif · 49 €/mois');
  });
  it('message neutre à zéro', () => {
    expect(planPulse(0, 0)).toBe('Aucune vente pour l’instant');
  });
});

describe('packagePulse', () => {
  const stats = (o: Partial<{ soldCount: number; activeCount: number; outstandingAmount: string }>) =>
    ({ soldCount: 0, activeCount: 0, outstandingAmount: '0.00', ...o });
  it('carnet : en circulation + vendus', () => {
    expect(packagePulse(stats({ soldCount: 23, activeCount: 8 }), 'ENTRIES'))
      .toBe('8 en circulation · 23 vendus');
  });
  it('porte-monnaie : € en circulation + vendus', () => {
    expect(packagePulse(stats({ soldCount: 9, activeCount: 5, outstandingAmount: '1240.00' }), 'WALLET'))
      .toBe('1 240 € en circulation · 9 vendus');
  });
  it('accord singulier « 1 vendu »', () => {
    expect(packagePulse(stats({ soldCount: 1, activeCount: 1 }), 'ENTRIES')).toBe('1 en circulation · 1 vendu');
  });
  it('message neutre à zéro vente', () => {
    expect(packagePulse(stats({}), 'ENTRIES')).toBe('Aucune vente pour l’instant');
    expect(packagePulse(undefined, 'ENTRIES')).toBe('Aucune vente pour l’instant');
  });
});

describe('planRevenueCents', () => {
  const now = Date.parse('2026-07-13T00:00:00Z');
  const sub = (o: Partial<SubscriberRow>): SubscriberRow => ({
    id: 'x', user: { id: 'u', firstName: 'A', lastName: 'B', avatarUrl: null },
    planId: 'p1', planName: 'P', status: 'ACTIVE',
    startedAt: '2026-01-01T00:00:00Z', expiresAt: '2027-01-01T00:00:00Z',
    monthlyPriceSnapshot: '49.00', sportKeys: ['padel'], ...o,
  });
  it('somme les mensualités des abonnés ACTIFS non expirés du plan', () => {
    const subs = [
      sub({ planId: 'p1', monthlyPriceSnapshot: '49.00' }),
      sub({ planId: 'p1', monthlyPriceSnapshot: '49.00' }),
      sub({ planId: 'p2', monthlyPriceSnapshot: '99.00' }),
      sub({ planId: 'p1', status: 'CANCELLED' }),
      sub({ planId: 'p1', expiresAt: '2026-01-01T00:00:00Z' }),
    ];
    expect(planRevenueCents(subs, 'p1', now)).toBe(9800);
  });
});

describe('splitByActive', () => {
  it('sépare actifs / inactifs en préservant l’ordre', () => {
    const items = [
      { id: 'a', isActive: true }, { id: 'b', isActive: false }, { id: 'c', isActive: true },
    ] as Pick<PackageTemplate, 'id' | 'isActive'>[];
    const { active, inactive } = splitByActive(items);
    expect(active.map(i => i.id)).toEqual(['a', 'c']);
    expect(inactive.map(i => i.id)).toEqual(['b']);
  });
});
