import {
  emptyCalendarState, resolveDateWindow, applyFilters, calendarFacets, distanceKm,
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
  it('preset days30 = [now, now+30j]', () => {
    const w = resolveDateWindow({ ...emptyCalendarState(), datePreset: 'days30' }, NOW)!;
    expect(w.from.getTime()).toBe(NOW.getTime());
    expect(w.to!.getTime()).toBe(NOW.getTime() + 30 * 86_400_000);
  });
  it('aucun preset ni plage → null', () => {
    expect(resolveDateWindow(emptyCalendarState(), NOW)).toBeNull();
  });
  it('plage custom from/to prime sur le preset', () => {
    const w = resolveDateWindow({ ...emptyCalendarState(), datePreset: 'days30', from: '2026-07-10', to: '2026-07-15' }, NOW)!;
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
