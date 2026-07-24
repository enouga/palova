import {
  filterNationalMatches, parseLocationQuery, sortMatchesByDistance, distanceLabel,
  partiesStateToStored, storedToPartiesState, partiesFilterCount,
  clubsStateToStored, storedToClubsFilters,
} from '@/lib/discover';
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
    department: null,
    departmentCode: null,
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

describe('filterNationalMatches — date', () => {
  const base: DiscoverMatchFilter = { datePreset: 'today', dateFrom: null, dateTo: null, kind: 'all', gender: 'all', location: { city: null, deptCodes: [] }, myLevel: null };

  it('match dans 2 h → gardé en today', () => {
    const m = makeMatch({ startTime: new Date(NOW.getTime() + 2 * 3_600_000).toISOString() });
    expect(filterNationalMatches([m], base, NOW)).toEqual([m]);
  });

  it('match dans 5 jours → exclu en today', () => {
    const m = makeMatch({ startTime: new Date(NOW.getTime() + 5 * DAY).toISOString() });
    expect(filterNationalMatches([m], base, NOW)).toEqual([]);
  });

  it('match dans 5 jours (lundi suivant) → exclu en thisWeek (au-delà de dimanche)', () => {
    const m = makeMatch({ startTime: new Date(NOW.getTime() + 5 * DAY).toISOString() });
    expect(filterNationalMatches([m], { ...base, datePreset: 'thisWeek' }, NOW)).toEqual([]);
  });

  it('match dans 5 jours → gardé sans filtre de date (datePreset null)', () => {
    const m = makeMatch({ startTime: new Date(NOW.getTime() + 5 * DAY).toISOString() });
    expect(filterNationalMatches([m], { ...base, datePreset: null }, NOW)).toEqual([m]);
  });

  it('plage custom from/to prime sur le preset', () => {
    const m = makeMatch({ startTime: new Date(NOW.getTime() + 20 * DAY).toISOString() });
    // datePreset 'today' exclurait ce match, mais une plage custom couvrant le jour prime.
    const from = new Date(NOW.getTime() + 20 * DAY);
    const to = new Date(NOW.getTime() + 21 * DAY);
    const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    expect(filterNationalMatches([m], { ...base, dateFrom: ymd(from), dateTo: ymd(to) }, NOW)).toEqual([m]);
  });
});

describe('filterNationalMatches — ville', () => {
  const base: DiscoverMatchFilter = { datePreset: null, dateFrom: null, dateTo: null, kind: 'all', gender: 'all', location: { city: null, deptCodes: [] }, myLevel: null };

  it("insensible accents/casse : 'sete' trouve « Sète »", () => {
    const match = makeMatch({ club: makeClub({ city: 'Sète' }) });
    expect(filterNationalMatches([match], { ...base, location: { city: 'sete', deptCodes: [] } }, NOW)).toEqual([match]);
  });

  it('city: null exclu si le filtre ville est actif', () => {
    const match = makeMatch({ club: makeClub({ city: null }) });
    expect(filterNationalMatches([match], { ...base, location: { city: 'paris', deptCodes: [] } }, NOW)).toEqual([]);
  });

  it('filtre ville vide → tout passe (y compris une ville null)', () => {
    const match = makeMatch({ club: makeClub({ city: null }) });
    expect(filterNationalMatches([match], base, NOW)).toEqual([match]);
  });

  // Fabrique de match localisée pour les tests ci-dessous : id + ville/département/code
  // département du club (le reste = défauts de makeMatch/makeClub).
  function m(over: { id?: string; city?: string; department?: string; departmentCode?: string } = {}): NationalOpenMatch {
    const clubOverride: Partial<NationalOpenMatchClub> = {
      department: over.department ?? null,
      departmentCode: over.departmentCode ?? null,
    };
    if (over.city !== undefined) clubOverride.city = over.city;
    return makeMatch({ id: over.id, club: makeClub(clubOverride) });
  }

  it('deptCodes filtre sur club.departmentCode (insensible casse)', () => {
    const inDept  = m({ id: 'a', departmentCode: '31' });
    const outDept = m({ id: 'b', departmentCode: '75' });
    const noDept  = m({ id: 'c' }); // departmentCode null → exclu quand filtre actif
    const out = filterNationalMatches([inDept, outDept, noDept], { ...base, location: { city: null, deptCodes: ['31'] } }, NOW);
    expect(out.map((x) => x.id)).toEqual(['a']);
  });

  it('city texte matche aussi le nom du département', () => {
    const byDeptName = m({ id: 'a', city: 'Muret', department: 'Haute-Garonne' });
    const other      = m({ id: 'b', city: 'Paris', department: 'Paris' });
    const out = filterNationalMatches([byDeptName, other], { ...base, location: { city: 'haute-garonne', deptCodes: [] } }, NOW);
    expect(out.map((x) => x.id)).toEqual(['a']);
  });
});

describe('filterNationalMatches — niveau', () => {
  const base: DiscoverMatchFilter = { datePreset: null, dateFrom: null, dateTo: null, kind: 'all', gender: 'all', location: { city: null, deptCodes: [] }, myLevel: 6.2 };

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

describe('filterNationalMatches — type (competitive) et genre', () => {
  const base: DiscoverMatchFilter = { datePreset: null, dateFrom: null, dateTo: null, kind: 'all', gender: 'all', location: { city: null, deptCodes: [] }, myLevel: null };

  it("kind 'competitive' garde les parties compétitives (competitive true ou absent)", () => {
    const comp = makeMatch({ id: 'c', competitive: true });
    const undef = makeMatch({ id: 'u' }); // competitive absent → traité compétitif (défaut)
    const fun = makeMatch({ id: 'f', competitive: false });
    const out = filterNationalMatches([comp, undef, fun], { ...base, kind: 'competitive' }, NOW);
    expect(out.map((m) => m.id)).toEqual(['c', 'u']);
  });

  it("kind 'friendly' ne garde que les parties pour le fun (competitive === false)", () => {
    const comp = makeMatch({ id: 'c', competitive: true });
    const undef = makeMatch({ id: 'u' });
    const fun = makeMatch({ id: 'f', competitive: false });
    const out = filterNationalMatches([comp, undef, fun], { ...base, kind: 'friendly' }, NOW);
    expect(out.map((m) => m.id)).toEqual(['f']);
  });

  it("genre 'WOMEN' ne garde que les parties féminines", () => {
    const w = makeMatch({ id: 'w', gender: 'WOMEN' });
    const mx = makeMatch({ id: 'x', gender: 'MIXED' });
    const open = makeMatch({ id: 'o', gender: null });
    const out = filterNationalMatches([w, mx, open], { ...base, gender: 'WOMEN' }, NOW);
    expect(out.map((m) => m.id)).toEqual(['w']);
  });

  it("genre 'MIXED' ne garde que les parties mixtes", () => {
    const w = makeMatch({ id: 'w', gender: 'WOMEN' });
    const mx = makeMatch({ id: 'x', gender: 'MIXED' });
    const out = filterNationalMatches([w, mx], { ...base, gender: 'MIXED' }, NOW);
    expect(out.map((m) => m.id)).toEqual(['x']);
  });

  it("kind/genre 'all' → aucun filtre (une partie féminine + pour le fun passe)", () => {
    const w = makeMatch({ id: 'w', gender: 'WOMEN', competitive: false });
    expect(filterNationalMatches([w], base, NOW)).toEqual([w]);
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

describe('parseLocationQuery — ville, code postal ou département', () => {
  it('vide → aucun filtre', () => {
    expect(parseLocationQuery('')).toEqual({ city: null, deptCodes: [] });
    expect(parseLocationQuery('   ')).toEqual({ city: null, deptCodes: [] });
  });
  it('code postal 5 chiffres → département (2 premiers chiffres)', () => {
    expect(parseLocationQuery('31770')).toEqual({ city: null, deptCodes: ['31'] });
  });
  it('code postal DOM 97x → département 3 chiffres', () => {
    expect(parseLocationQuery('97400')).toEqual({ city: null, deptCodes: ['974'] });
  });
  it('code postal corse 20xxx → 2A et 2B', () => {
    expect(parseLocationQuery('20090')).toEqual({ city: null, deptCodes: ['2A', '2B'] });
  });
  it('code département direct (2 ou 3 chiffres)', () => {
    expect(parseLocationQuery('31')).toEqual({ city: null, deptCodes: ['31'] });
    expect(parseLocationQuery('974')).toEqual({ city: null, deptCodes: ['974'] });
  });
  it('20 seul → 2A et 2B ; 2a/2b → code corse majuscule', () => {
    expect(parseLocationQuery('20')).toEqual({ city: null, deptCodes: ['2A', '2B'] });
    expect(parseLocationQuery('2a')).toEqual({ city: null, deptCodes: ['2A'] });
    expect(parseLocationQuery('2B')).toEqual({ city: null, deptCodes: ['2B'] });
  });
  it('texte → recherche par nom (ville ou département)', () => {
    expect(parseLocationQuery('Colomiers')).toEqual({ city: 'Colomiers', deptCodes: [] });
  });
});

describe('partiesStateToStored / storedToPartiesState', () => {
  it('aller-retour préserve toutes les dimensions', () => {
    const stored = partiesStateToStored({ datePreset: 'today', dateFrom: null, dateTo: null, kind: 'friendly', gender: 'WOMEN', levelOn: true });
    expect(stored).toEqual({ quand: 'today', from: null, to: null, type: 'friendly', genre: 'WOMEN', niveau: true });
    expect(storedToPartiesState(stored)).toEqual(stored);
  });

  it('entrée corrompue → état par défaut tolérant', () => {
    const empty = { quand: null, from: null, to: null, type: 'all', genre: 'all', niveau: false };
    expect(storedToPartiesState(null)).toEqual(empty);
    expect(storedToPartiesState('not an object')).toEqual(empty);
    expect(storedToPartiesState({ quand: 'bogus', type: 'bogus', genre: 'bogus', niveau: 'yes' })).toEqual(empty);
  });

  it('valide une plage from/to en string', () => {
    expect(storedToPartiesState({ from: '2026-07-24', to: '2026-08-02' }))
      .toEqual({ quand: null, from: '2026-07-24', to: '2026-08-02', type: 'all', genre: 'all', niveau: false });
  });
});

describe('partiesFilterCount', () => {
  const base = { datePreset: null, dateFrom: null, dateTo: null, kind: 'all' as const, gender: 'all' as const, levelOn: false, levelChipVisible: false };

  it('aucun filtre actif → 0', () => {
    expect(partiesFilterCount(base)).toBe(0);
  });

  it('date + type + genre actifs → 3', () => {
    expect(partiesFilterCount({ ...base, datePreset: 'today', kind: 'friendly', gender: 'WOMEN' })).toBe(3);
  });

  it('plage from/to sans preset compte pour 1 (pas 2)', () => {
    expect(partiesFilterCount({ ...base, dateFrom: '2026-07-24', dateTo: '2026-08-02' })).toBe(1);
  });

  it('niveau ON mais chip invisible → non compté', () => {
    expect(partiesFilterCount({ ...base, levelOn: true, levelChipVisible: false })).toBe(0);
  });

  it('niveau ON et chip visible → compté', () => {
    expect(partiesFilterCount({ ...base, levelOn: true, levelChipVisible: true })).toBe(1);
  });
});

describe('clubsStateToStored / storedToClubsFilters', () => {
  it('aller-retour préserve q et sport', () => {
    const stored = clubsStateToStored({ q: 'Padel', sport: 'padel' });
    expect(stored).toEqual({ q: 'Padel', sport: 'padel' });
    expect(storedToClubsFilters(stored)).toEqual(stored);
  });

  it('entrée corrompue → état par défaut tolérant', () => {
    expect(storedToClubsFilters(null)).toEqual({ q: '', sport: '' });
    expect(storedToClubsFilters({ q: 42, sport: null })).toEqual({ q: '', sport: '' });
  });
});
