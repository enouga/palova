import { isActiveSub, daysUntil, expiresSoon, filterRegistry, RegistryMode } from '../lib/subscriptionAdmin';
import type { SubscriberRow } from '../lib/api';

const NOW = Date.UTC(2026, 6, 13); // 2026-07-13
const row = (o: Partial<SubscriberRow>): SubscriberRow => ({
  id: 'x', user: { id: 'u', firstName: 'Jean', lastName: 'Dupont', avatarUrl: null },
  planId: 'p1', planName: 'Padel illimité', status: 'ACTIVE',
  startedAt: '2026-06-01T00:00:00Z', expiresAt: '2026-08-12T00:00:00Z',
  monthlyPriceSnapshot: '39.00', sportKeys: ['padel'], ...o,
});

describe('subscriptionAdmin', () => {
  it('isActiveSub : ACTIVE + non expiré', () => {
    expect(isActiveSub(row({}), NOW)).toBe(true);
    expect(isActiveSub(row({ status: 'CANCELLED' }), NOW)).toBe(false);
    expect(isActiveSub(row({ expiresAt: '2026-07-01T00:00:00Z' }), NOW)).toBe(false);
  });
  it('daysUntil : arrondi au jour supérieur', () => {
    expect(daysUntil('2026-07-28T00:00:00Z', NOW)).toBe(15);
  });
  it('expiresSoon : actif ET < 30 j', () => {
    expect(expiresSoon(row({ expiresAt: '2026-07-28T00:00:00Z' }), NOW)).toBe(true);
    expect(expiresSoon(row({ expiresAt: '2026-09-01T00:00:00Z' }), NOW)).toBe(false);
  });
  it('filterRegistry : mode + plan + recherche + tri', () => {
    const subs = [
      row({ id: 'a', user: { id: 'u1', firstName: 'Jean', lastName: 'Dupont', avatarUrl: null }, expiresAt: '2026-08-20T00:00:00Z' }),
      row({ id: 'b', user: { id: 'u2', firstName: 'Marie', lastName: 'Leroy', avatarUrl: null }, expiresAt: '2026-07-28T00:00:00Z' }),
      row({ id: 'c', status: 'CANCELLED', planId: 'p2' }),
    ];
    const active = filterRegistry(subs, { query: '', mode: 'active' as RegistryMode, planId: null }, NOW);
    expect(active.map((s) => s.id)).toEqual(['b', 'a']);            // tri échéance asc
    expect(filterRegistry(subs, { query: 'ler', mode: 'active', planId: null }, NOW).map((s) => s.id)).toEqual(['b']);
    expect(filterRegistry(subs, { query: '', mode: 'history', planId: null }, NOW).map((s) => s.id)).toEqual(['c']);
    expect(filterRegistry(subs, { query: '', mode: 'active', planId: 'p1' }, NOW).map((s) => s.id)).toEqual(['b', 'a']);
    expect(filterRegistry(subs, { query: '', mode: 'soon', planId: null }, NOW).map((s) => s.id)).toEqual(['b']);
  });
});
