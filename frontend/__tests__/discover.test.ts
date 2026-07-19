import { discoverWindow, filterNationalMatches, sortMatchesByDistance, distanceLabel } from '@/lib/discover';
import type { DiscoverMatchFilter } from '@/lib/discover';
import type { NationalOpenMatch, NationalOpenMatchClub } from '@/lib/api';

// Mercredi 8 juillet 2026, 10h (heure locale du visiteur).
const NOW = new Date(2026, 6, 8, 10, 0, 0);

function makeClub(over: Partial<NationalOpenMatchClub> = {}): NationalOpenMatchClub {
  return {
    slug: 'padel-arena-paris',
    name: 'Padel Arena Paris',
    city: 'Paris',
    timezone: 'Europe/Paris',
    accentColor: '#5e93da',
    logoUrl: null,
    latitude: 48.8566,
    longitude: 2.3522,
    ...over,
  };
}

function makeMatch(over: Partial<NationalOpenMatch> = {}): NationalOpenMatch {
  return {
    id: 'm1',
    resourceName: 'Court 1',
    sport: { key: 'padel', name: 'Padel' },
    startTime: NOW.toISOString(),
    endTime: new Date(NOW.getTime() + 90 * 60_000).toISOString(),
    maxPlayers: 4,
    spotsLeft: 2,
    full: false,
    targetLevelMin: 4,
    targetLevelMax: 6,
    players: [],
    club: makeClub(),
    ...over,
  };
}

const DAY = 86_400_000;

describe('discoverWindow', () => {
  it("'all' → pas de fenêtre", () => {
    expect(discoverWindow('all', NOW)).toBeNull();
  });

  it("'today' → from=now, to=fin de journée locale", () => {
    const win = discoverWindow('today', NOW)!;
    expect(win.from).toEqual(NOW);
    expect(win.to).toEqual(new Date(2026, 6, 8, 23, 59, 59, 999));
  });

  it("'weekend' un mercredi → samedi 11 00:00 → dimanche 12 23:59:59.999", () => {
    const win = discoverWindow('weekend', NOW)!;
    expect(win.from).toEqual(new Date(2026, 6, 11, 0, 0, 0, 0));
    expect(win.to).toEqual(new Date(2026, 6, 12, 23, 59, 59, 999));
  });

  it("'weekend' un dimanche en cours → ce jour seul", () => {
    const sunday = new Date(2026, 6, 12, 10, 0, 0);
    const win = discoverWindow('weekend', sunday)!;
    expect(win.from).toEqual(new Date(2026, 6, 12, 0, 0, 0, 0));
    expect(win.to).toEqual(new Date(2026, 6, 12, 23, 59, 59, 999));
  });
});

describe('filterNationalMatches — période', () => {
  const base: DiscoverMatchFilter = { period: 'today', city: '', myLevel: null };

  it('match dans 2 h → gardé en today', () => {
    const m = makeMatch({ startTime: new Date(NOW.getTime() + 2 * 3_600_000).toISOString() });
    expect(filterNationalMatches([m], base, NOW)).toEqual([m]);
  });

  it('match dans 5 jours → exclu en today', () => {
    const m = makeMatch({ startTime: new Date(NOW.getTime() + 5 * DAY).toISOString() });
    expect(filterNationalMatches([m], base, NOW)).toEqual([]);
  });

  it('match dans 5 jours → exclu en weekend', () => {
    const m = makeMatch({ startTime: new Date(NOW.getTime() + 5 * DAY).toISOString() });
    expect(filterNationalMatches([m], { ...base, period: 'weekend' }, NOW)).toEqual([]);
  });

  it('match dans 5 jours → gardé en all', () => {
    const m = makeMatch({ startTime: new Date(NOW.getTime() + 5 * DAY).toISOString() });
    expect(filterNationalMatches([m], { ...base, period: 'all' }, NOW)).toEqual([m]);
  });
});

describe('filterNationalMatches — ville', () => {
  const base: DiscoverMatchFilter = { period: 'all', city: '', myLevel: null };

  it("insensible accents/casse : 'sete' trouve « Sète »", () => {
    const m = makeMatch({ club: makeClub({ city: 'Sète' }) });
    expect(filterNationalMatches([m], { ...base, city: 'sete' }, NOW)).toEqual([m]);
  });

  it('city: null exclu si le filtre ville est actif', () => {
    const m = makeMatch({ club: makeClub({ city: null }) });
    expect(filterNationalMatches([m], { ...base, city: 'paris' }, NOW)).toEqual([]);
  });

  it('filtre ville vide → tout passe (y compris une ville null)', () => {
    const m = makeMatch({ club: makeClub({ city: null }) });
    expect(filterNationalMatches([m], base, NOW)).toEqual([m]);
  });
});

describe('filterNationalMatches — niveau', () => {
  const base: DiscoverMatchFilter = { period: 'all', city: '', myLevel: 6.2 };

  it('myLevel 6.2 → fourchette [5,7] : garde une partie 4–6 (chevauchement)', () => {
    const m = makeMatch({ targetLevelMin: 4, targetLevelMax: 6 });
    expect(filterNationalMatches([m], base, NOW)).toEqual([m]);
  });

  it('myLevel 6.2 → fourchette [5,7] : exclut une partie 1–2 (aucun chevauchement)', () => {
    const m = makeMatch({ targetLevelMin: 1, targetLevelMax: 2 });
    expect(filterNationalMatches([m], base, NOW)).toEqual([]);
  });

  it('partie sans fourchette (null/null) → toujours gardée, « ouverte à tous »', () => {
    const m = makeMatch({ targetLevelMin: null, targetLevelMax: null });
    expect(filterNationalMatches([m], base, NOW)).toEqual([m]);
  });

  it('myLevel: null → pas de filtre de niveau', () => {
    const m = makeMatch({ targetLevelMin: 1, targetLevelMax: 2 });
    expect(filterNationalMatches([m], { ...base, myLevel: null }, NOW)).toEqual([m]);
  });

  it('myLevel 8 → fourchette clampée [7,8] (pas [7,9], niveau max = 8) : exclut une partie 9–9', () => {
    const m = makeMatch({ targetLevelMin: 9, targetLevelMax: 9 });
    expect(filterNationalMatches([m], { ...base, myLevel: 8 }, NOW)).toEqual([]);
  });
});

describe('sortMatchesByDistance', () => {
  it('coords null → ordre conservé, distanceKm null partout', () => {
    const a = makeMatch({ id: 'a' });
    const b = makeMatch({ id: 'b' });
    const ranked = sortMatchesByDistance([a, b], null);
    expect(ranked.map((r) => r.match.id)).toEqual(['a', 'b']);
    expect(ranked.every((r) => r.distanceKm === null)).toBe(true);
  });

  it('avec des coords Paris : Lyon après Paris, club sans lat/lng en dernier, Paris ≈ 0', () => {
    const paris = makeMatch({ id: 'paris', club: makeClub({ latitude: 48.8566, longitude: 2.3522 }) });
    const lyon = makeMatch({ id: 'lyon', club: makeClub({ latitude: 45.764, longitude: 4.8357 }) });
    const noCoords = makeMatch({ id: 'nocoords', club: makeClub({ latitude: null, longitude: null }) });
    const parisCoords = { lat: 48.8566, lng: 2.3522 };

    const ranked = sortMatchesByDistance([lyon, noCoords, paris], parisCoords);

    expect(ranked.map((r) => r.match.id)).toEqual(['paris', 'lyon', 'nocoords']);
    expect(ranked[0].distanceKm).not.toBeNull();
    expect(ranked[0].distanceKm!).toBeCloseTo(0, 1);
    expect(ranked[2].distanceKm).toBeNull();
  });
});

describe('distanceLabel', () => {
  it('0.85 km → « 850 m »', () => {
    expect(distanceLabel(0.85)).toBe('850 m');
  });

  it('3.4 km → « 3 km »', () => {
    expect(distanceLabel(3.4)).toBe('3 km');
  });

  it('12.6 km → « 13 km »', () => {
    expect(distanceLabel(12.6)).toBe('13 km');
  });
});
