import { Member } from '@/lib/api';
import {
  norm, filterMembers, segCounts, sortMembers, daysSince, memberKpis, membersCsv,
} from '@/lib/members';

const mk = (over: Partial<Member>): Member => ({
  id: 'mb-' + (over.userId ?? 'x'), userId: over.userId ?? 'u', firstName: 'A', lastName: 'B',
  email: 'a@b.fr', phone: null, isSubscriber: false, membershipNo: null, status: 'ACTIVE', note: null,
  ...over,
});

const NOW = Date.parse('2026-07-08T12:00:00Z');

describe('norm', () => {
  it('minuscule + sans accents', () => {
    expect(norm('Benoît')).toBe('benoit');
    expect(norm('ÉLODIE')).toBe('elodie');
  });
});

describe('filterMembers', () => {
  const ms = [
    mk({ userId: 'u1', firstName: 'Benoît', lastName: 'Roy', email: 'benoit@x.fr', hasActiveSubscription: true }),
    mk({ userId: 'u2', firstName: 'Zoé', lastName: 'Diaz', email: 'zoe@x.fr', status: 'BLOCKED' }),
    mk({ userId: 'u3', firstName: 'Léo', lastName: 'Costa', email: 'leo@x.fr', staffRole: 'STAFF' }),
    mk({ userId: 'u4', firstName: 'Ana', lastName: 'Bernard', watch: true }),
  ];

  it('recherche multi-termes ET, insensible aux accents', () => {
    expect(filterMembers(ms, 'benoit roy', 'all').map((m) => m.userId)).toEqual(['u1']);
    expect(filterMembers(ms, 'zzz', 'all')).toEqual([]);
    expect(filterMembers(ms, '', 'all')).toHaveLength(4);
  });

  it('filtre par segment', () => {
    expect(filterMembers(ms, '', 'subs').map((m) => m.userId)).toEqual(['u1']);
    expect(filterMembers(ms, '', 'blocked').map((m) => m.userId)).toEqual(['u2']);
    expect(filterMembers(ms, '', 'staff').map((m) => m.userId)).toEqual(['u3']);
    expect(filterMembers(ms, '', 'watch').map((m) => m.userId)).toEqual(['u4']);
  });

  it('recherche s\'applique dans le segment courant', () => {
    expect(filterMembers(ms, 'diaz', 'blocked').map((m) => m.userId)).toEqual(['u2']);
    expect(filterMembers(ms, 'diaz', 'subs')).toEqual([]);
  });
});

describe('segCounts', () => {
  it('compte chaque segment (sur l\'ensemble donné)', () => {
    const ms = [
      mk({ userId: 'u1', hasActiveSubscription: true }),
      mk({ userId: 'u2', status: 'BLOCKED' }),
      mk({ userId: 'u3', staffRole: 'ADMIN' }),
      mk({ userId: 'u4', watch: true, hasActiveSubscription: true }),
    ];
    expect(segCounts(ms)).toEqual({ all: 4, subs: 2, staff: 1, watch: 1, blocked: 1 });
  });
});

describe('sortMembers', () => {
  const ms = [
    mk({ userId: 'u1', firstName: 'Benoît', lastName: 'Roy', since: '2026-01-10T00:00:00Z', lastSeenAt: '2026-07-01T00:00:00Z' }),
    mk({ userId: 'u2', firstName: 'Ana', lastName: 'Bernard', since: '2026-06-20T00:00:00Z', lastSeenAt: null }),
    mk({ userId: 'u3', firstName: 'Léo', lastName: 'Costa', since: '2026-03-05T00:00:00Z', lastSeenAt: '2026-07-06T00:00:00Z' }),
  ];
  it('nom (localeCompare fr)', () => {
    expect(sortMembers(ms, 'name').map((m) => m.userId)).toEqual(['u2', 'u3', 'u1']);
  });
  it('plus récents (since desc)', () => {
    expect(sortMembers(ms, 'recent').map((m) => m.userId)).toEqual(['u2', 'u3', 'u1']);
  });
  it('activité (lastSeenAt desc, null en dernier)', () => {
    expect(sortMembers(ms, 'activity').map((m) => m.userId)).toEqual(['u3', 'u1', 'u2']);
  });
  it('ne mute pas l\'entrée', () => {
    const copy = [...ms];
    sortMembers(ms, 'name');
    expect(ms).toEqual(copy);
  });
});

describe('daysSince', () => {
  it('null si absent, sinon jours entiers', () => {
    expect(daysSince(null, NOW)).toBeNull();
    expect(daysSince(undefined, NOW)).toBeNull();
    expect(daysSince('2026-07-08T00:00:00Z', NOW)).toBe(0);
    expect(daysSince('2026-07-01T12:00:00Z', NOW)).toBe(7);
  });
});

describe('memberKpis', () => {
  it('total / abonnés / actifs 30j / bloqués', () => {
    const ms = [
      mk({ userId: 'u1', hasActiveSubscription: true, lastSeenAt: '2026-07-05T00:00:00Z' }), // actif
      mk({ userId: 'u2', lastSeenAt: '2026-01-01T00:00:00Z' }),                              // > 30j
      mk({ userId: 'u3', status: 'BLOCKED' }),
      mk({ userId: 'u4', hasActiveSubscription: true, lastSeenAt: null }),
    ];
    expect(memberKpis(ms, NOW)).toEqual({ total: 4, subscribers: 2, activeRecent: 1, blocked: 1 });
  });
});

describe('membersCsv', () => {
  const ms = [
    mk({ userId: 'u1', firstName: 'Ana', lastName: 'Bernard', email: 'ana@x.fr', phone: '0612',
      isSubscriber: true, subscriptionPlan: 'Premium', hasActivePackage: true, membershipNo: 'A-1',
      status: 'ACTIVE', staffRole: 'STAFF', watch: true, since: '2026-01-10T00:00:00Z',
      lastSeenAt: '2026-07-01T00:00:00Z', level: { level: 5.2, tier: 'P500', isProvisional: false, reliability: 0.9 } }),
    mk({ userId: 'u2', firstName: 'Zoé', lastName: 'D;iaz', email: 'zoe@x.fr', status: 'BLOCKED' }),
  ];
  const csv = membersCsv(ms, NOW);

  it('commence par un BOM UTF-8', () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });
  it('sépare par point-virgule et échappe les champs contenant ;', () => {
    expect(csv).toContain('Prénom;Nom;Email');
    expect(csv).toContain('"D;iaz"');
  });
  it('booléens en Oui/Non et date JJ/MM/AAAA', () => {
    expect(csv).toContain('Oui'); // abonné u1
    expect(csv).toContain('Non'); // abonné u2
    expect(csv).toContain('10/01/2026'); // membre depuis u1
  });
});
