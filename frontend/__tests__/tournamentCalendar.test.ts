import {
  emptyCalendarState, resolveDateWindow, applyFilters, calendarFacets, distanceKm, rangeChipLabel,
  activeFilterCount, calendarStateToStored, storedToCalendarState,
  CalendarFilterState,
} from '@/lib/tournamentCalendar';
import { NationalTournament } from '@/lib/api';

const NOW = new Date('2026-07-01T10:00:00Z'); // mercredi

function tourn(over: Partial<NationalTournament> & { id: string; startTime: string; deptCode: string | null; deptName?: string; category?: string; gender?: any; lat?: number | null; lng?: number | null }): NationalTournament {
  return {
    id: over.id, clubId: 'c', clubSportId: 'cs', name: `T-${over.id}`,
    category: over.category ?? 'P500', gender: over.gender ?? 'MEN', openToWomen: true,
    description: null, contactInfo: null, startTime: over.startTime, endTime: null,
    registrationDeadline: over.startTime, maxTeams: 16, entryFee: null, status: 'PUBLISHED',
    confirmedCount: 0, waitlistCount: 0,
    club: {
      slug: `club-${over.id}`, name: `Club ${over.id}`, city: 'Ville',
      department: over.deptName ?? (over.deptCode ? `Dép ${over.deptCode}` : null), departmentCode: over.deptCode,
      timezone: 'Europe/Paris', accentColor: '#000', logoUrl: null,
      latitude: over.lat ?? null, longitude: over.lng ?? null,
    },
  } as NationalTournament;
}

const items: NationalTournament[] = [
  tourn({ id: 'a', startTime: '2026-07-02T12:00:00Z', deptCode: '75', category: 'P500', gender: 'MEN', lat: 48.85, lng: 2.35 }),
  tourn({ id: 'b', startTime: '2026-07-20T12:00:00Z', deptCode: '69', category: 'P1000', gender: 'WOMEN', lat: 45.76, lng: 4.83 }),
  tourn({ id: 'c', startTime: '2026-09-15T12:00:00Z', deptCode: '75', category: 'P500', gender: 'MIXED', lat: null, lng: null }),
];

describe('resolveDateWindow', () => {
  it('preset today = [now, fin de journée locale]', () => {
    const w = resolveDateWindow({ ...emptyCalendarState(), datePreset: 'today' }, NOW)!;
    expect(w.from.getTime()).toBe(NOW.getTime());
    expect(w.to!.getTime()).toBe(new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate(), 23, 59, 59, 999).getTime());
  });
  it("preset thisWeek un mercredi → jusqu'à dimanche 23:59:59.999 (même semaine)", () => {
    const w = resolveDateWindow({ ...emptyCalendarState(), datePreset: 'thisWeek' }, NOW)!;
    expect(w.from.getTime()).toBe(NOW.getTime());
    // NOW est un mercredi (cf. commentaire ligne 7) : +4 jours = dimanche.
    expect(w.to!.getTime()).toBe(new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + 4, 23, 59, 59, 999).getTime());
  });
  it('preset thisWeek un dimanche en cours → ce jour seul', () => {
    const sunday = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + 4, 10, 0, 0);
    const w = resolveDateWindow({ ...emptyCalendarState(), datePreset: 'thisWeek' }, sunday)!;
    expect(w.from.getTime()).toBe(sunday.getTime());
    expect(w.to!.getTime()).toBe(new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate(), 23, 59, 59, 999).getTime());
  });
  it('aucun preset ni plage → null', () => {
    expect(resolveDateWindow(emptyCalendarState(), NOW)).toBeNull();
  });
  it('plage custom from/to prime sur le preset', () => {
    const w = resolveDateWindow({ ...emptyCalendarState(), datePreset: 'today', from: '2026-07-10', to: '2026-07-15' }, NOW)!;
    expect(w.from.getFullYear()).toBe(2026);
    expect(w.to).not.toBeNull();
  });
});

describe('applyFilters', () => {
  it('OU intra-département, ET inter-dimensions', () => {
    const st: CalendarFilterState = { ...emptyCalendarState(), deptCodes: new Set(['75']), categories: new Set(['P500']) };
    const res = applyFilters(items, st, NOW);
    expect(res.map((r) => r.tournament.id).sort()).toEqual(['a', 'c']);
  });
  it('preset thisMonth ne garde que juillet', () => {
    const st: CalendarFilterState = { ...emptyCalendarState(), datePreset: 'thisMonth' };
    const res = applyFilters(items, st, NOW);
    expect(res.map((r) => r.tournament.id).sort()).toEqual(['a', 'b']);
  });
  it('sans nearMe → tri par date', () => {
    const res = applyFilters(items, emptyCalendarState(), NOW);
    expect(res.map((r) => r.tournament.id)).toEqual(['a', 'b', 'c']);
  });
  it('nearMe + coords → tri par distance, distanceKm renseignée, nulls en dernier', () => {
    const st: CalendarFilterState = { ...emptyCalendarState(), nearMe: true };
    const res = applyFilters(items, st, NOW, { lat: 45.76, lng: 4.83 }); // proche de Lyon (b)
    expect(res[0].tournament.id).toBe('b');
    expect(res[res.length - 1].tournament.id).toBe('c'); // pas de coords → dernier
    expect(res[0].distanceKm).toBeCloseTo(0, 0);
  });
});

describe('calendarFacets', () => {
  it('valeurs présentes + compteurs ne se contraignant pas eux-mêmes', () => {
    const st: CalendarFilterState = { ...emptyCalendarState(), deptCodes: new Set(['75']) };
    const f = calendarFacets(items, st, NOW);
    // catégories comptées sous le filtre dept=75 → P500 ×2 (a,c)
    const p500 = f.categories.find((c) => c.value === 'P500');
    expect(p500?.count).toBe(2);
    // départements comptés SANS se contraindre → 75 ×2, 69 ×1
    expect(f.departments.find((d) => d.code === '75')?.count).toBe(2);
    expect(f.departments.find((d) => d.code === '69')?.count).toBe(1);
  });
});

describe('distanceKm', () => {
  it('Paris→Lyon ≈ 390 km', () => {
    const d = distanceKm({ lat: 48.8566, lng: 2.3522 }, { lat: 45.764, lng: 4.8357 });
    expect(d).toBeGreaterThan(370);
    expect(d).toBeLessThan(410);
  });
});

describe('activeFilterCount', () => {
  it('compte départements + catégories + genres + (1 si date active), jamais nearMe', () => {
    expect(activeFilterCount(emptyCalendarState())).toBe(0);
    const st: CalendarFilterState = {
      ...emptyCalendarState(),
      deptCodes: new Set(['75', '69']),
      categories: new Set(['P500']),
      genders: new Set(['MEN']),
      datePreset: 'thisMonth',
    };
    expect(activeFilterCount(st)).toBe(5); // 2 dept + 1 cat + 1 genre + 1 date
  });
  it('une plage from/to compte pour 1 (pas 2), nearMe ignoré', () => {
    const st: CalendarFilterState = { ...emptyCalendarState(), from: '2026-07-24', to: '2026-08-02', nearMe: true };
    expect(activeFilterCount(st)).toBe(1);
  });
});

describe('calendarStateToStored / storedToCalendarState', () => {
  it('aller-retour préserve dimensions filtrantes, jamais nearMe', () => {
    const st: CalendarFilterState = {
      ...emptyCalendarState(),
      deptCodes: new Set(['75', '69']),
      categories: new Set(['P500', 'P1000']),
      genders: new Set(['MEN', 'MIXED']),
      datePreset: 'thisMonth',
      nearMe: true, // ne doit PAS ressortir
    };
    const back = storedToCalendarState(calendarStateToStored(st));
    expect([...back.deptCodes].sort()).toEqual(['69', '75']);
    expect([...back.categories].sort()).toEqual(['P1000', 'P500']);
    expect([...back.genders].sort()).toEqual(['MEN', 'MIXED']);
    expect(back.datePreset).toBe('thisMonth');
    expect(back.nearMe).toBe(false);
  });
  it('plage from/to conservée', () => {
    const st: CalendarFilterState = { ...emptyCalendarState(), from: '2026-07-24', to: '2026-08-02' };
    const back = storedToCalendarState(calendarStateToStored(st));
    expect(back.from).toBe('2026-07-24');
    expect(back.to).toBe('2026-08-02');
    expect(back.datePreset).toBeNull();
  });
  it('entrée corrompue → état vide (tolérant)', () => {
    expect(activeFilterCount(storedToCalendarState(null))).toBe(0);
    expect(activeFilterCount(storedToCalendarState('nope'))).toBe(0);
    expect(activeFilterCount(storedToCalendarState({ quand: 'bidon', dept: 'x', genre: ['ZZ'] }))).toBe(0);
  });
});

describe('rangeChipLabel', () => {
  it('plage complète → « 24 juil. → 2 août »', () => {
    expect(rangeChipLabel('2026-07-24', '2026-08-02')).toBe('24 juil. → 2 août');
  });
  it('début seul → « Du 24 juil. »', () => {
    expect(rangeChipLabel('2026-07-24', null)).toBe('Du 24 juil.');
  });
  it('fin seule → « Jusqu\'au 2 août »', () => {
    expect(rangeChipLabel(null, '2026-08-02')).toBe("Jusqu'au 2 août");
  });
  it('aucune borne → null', () => {
    expect(rangeChipLabel(null, null)).toBeNull();
  });
});
