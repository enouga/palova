# Parties : étagère 2 lignes + sélecteur de date unifié — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the `/decouvrir` Parties rail the same 2-row shelf as Tournois/Clubs/
Prochains events, and replace both Parties' 3-chip period filter and Tournois' 4-chip
preset filter with ONE shared date selector: "Aujourd'hui / Cette semaine / Ce mois-ci"
+ a free date-range picker ("Dates").

**Architecture:** `lib/tournamentCalendar.ts` becomes the single source of truth for
`DatePreset`/`resolveDateWindow`/the preset chip list (`DATE_PRESETS`) — `lib/discover.ts`
stops duplicating its own window-computation logic and calls `resolveDateWindow`
instead. `DiscoverMatches.tsx` adopts the same "Quand" UI block as `FacetPanel.tsx`
(same presets, same `DateRangeChip`), plus the same `grid-auto-flow: column` shelf CSS
already used by the other 3 sections this session.

**Tech Stack:** Next.js 16 / React / TypeScript, Jest + Testing Library.

**Spec de référence :** `docs/superpowers/specs/2026-07-23-parties-selecteur-date-unifie-design.md`

---

## Contexte utile à l'engineer

- Commandes depuis `frontend/` : `node node_modules/jest/bin/jest.js --runTestsByPath <fichier>`,
  `node node_modules/typescript/bin/tsc --noEmit`.
- `resolveDateWindow`'s parameter type narrows from `CalendarFilterState` to a smaller
  structural type (`{ datePreset, from, to }`) — TypeScript structural typing means
  every existing caller that passes a full `CalendarFilterState` (`applyFilters`,
  `calendarFacets`) keeps compiling unchanged; only the callers that construct a
  smaller object (the new `discover.ts` caller) benefit.
- `DateRangeChip` (`components/calendar/DateRangeChip.tsx`) is already fully generic
  (`from`/`to`/`onChange`/`tint` props only) — reused as-is, no changes needed there.
- Aucune migration, aucun changement backend — 100% frontend.

---

### Task 1: `lib/tournamentCalendar.ts` — nouveau preset `thisWeek`, `today` remplace `days30`/`months3`/`weekend`

**Files:**
- Modify: `frontend/lib/tournamentCalendar.ts`
- Modify: `frontend/__tests__/tournamentCalendar.test.ts`

- [ ] **Step 1: Update the failing tests**

In `frontend/__tests__/tournamentCalendar.test.ts`, replace the `'preset days30 = [now, now+30j]'` test:

```ts
  it('preset days30 = [now, now+30j]', () => {
    const w = resolveDateWindow({ ...emptyCalendarState(), datePreset: 'days30' }, NOW)!;
    expect(w.from.getTime()).toBe(NOW.getTime());
    expect(w.to!.getTime()).toBe(NOW.getTime() + 30 * 86_400_000);
  });
```

with:

```ts
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
```

(The `'preset thisMonth ne garde que juillet'` test in the `applyFilters` describe block
is untouched — `thisMonth` keeps its exact existing behavior.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/tournamentCalendar.test.ts`
Expected: FAIL — `datePreset: 'today'`/`'thisWeek'` aren't valid `DatePreset` values yet
(TS would also fail to compile once `tsc` runs, but Jest's ts-jest with isolatedModules
lets it run and fail at the runtime assertion instead — `resolveDateWindow` falls
through its switch and returns `undefined`, so `w` is falsy and the `!` non-null
assertion throws or `w.from` reads from `undefined`).

- [ ] **Step 3: Write the implementation**

In `frontend/lib/tournamentCalendar.ts`, replace:

```ts
export type DatePreset = 'weekend' | 'thisMonth' | 'days30' | 'months3';
```

with:

```ts
export type DatePreset = 'today' | 'thisWeek' | 'thisMonth';

/** Sous-ensemble de `CalendarFilterState` utile au calcul de fenêtre — permet à
 *  `lib/discover.ts` (Parties) de réutiliser `resolveDateWindow` sans porter les champs
 *  propres aux tournois (deptCodes/categories/genders/nearMe). `CalendarFilterState` est
 *  un sur-ensemble structurel : tous les appels existants restent valides tels quels. */
export type DateFilterState = { datePreset: DatePreset | null; from: string | null; to: string | null };

/** Puces de préréglage partagées par le sélecteur « Quand » de Tournois (FacetPanel) et
 *  de Parties (DiscoverMatches) — un seul jeu de libellés, jamais deux copies. */
export const DATE_PRESETS: { key: DatePreset; label: string }[] = [
  { key: 'today', label: "Aujourd'hui" },
  { key: 'thisWeek', label: 'Cette semaine' },
  { key: 'thisMonth', label: 'Ce mois-ci' },
];
```

Then replace the `resolveDateWindow` function:

```ts
/** Fenêtre [from, to] (to nullable = pas de borne haute). Plage custom prime sur le preset. */
export function resolveDateWindow(state: CalendarFilterState, now: Date): { from: Date; to: Date | null } | null {
  if (state.from || state.to) {
    return {
      from: state.from ? startOfLocalDay(state.from) : now,
      to: state.to ? endOfLocalDay(state.to) : null,
    };
  }
  if (!state.datePreset) return null;
  const day = 86_400_000;
  switch (state.datePreset) {
    case 'days30':
      return { from: now, to: new Date(now.getTime() + 30 * day) };
    case 'months3': {
      const to = new Date(now); to.setMonth(to.getMonth() + 3);
      return { from: now, to };
    }
    case 'thisMonth': {
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999); // dernier jour du mois
      return { from: now, to };
    }
    case 'weekend': {
      const dow = now.getDay(); // 0=dim … 6=sam
      if (dow === 0) { // dimanche en cours
        return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0), to: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999) };
      }
      const daysToSat = 6 - dow; // sam=0 … lun=5
      const sat = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysToSat, 0, 0, 0, 0);
      const sun = new Date(sat.getFullYear(), sat.getMonth(), sat.getDate() + 1, 23, 59, 59, 999);
      return { from: sat, to: sun };
    }
  }
}
```

with:

```ts
/** Fenêtre [from, to] (to nullable = pas de borne haute). Plage custom prime sur le preset. */
export function resolveDateWindow(state: DateFilterState, now: Date): { from: Date; to: Date | null } | null {
  if (state.from || state.to) {
    return {
      from: state.from ? startOfLocalDay(state.from) : now,
      to: state.to ? endOfLocalDay(state.to) : null,
    };
  }
  if (!state.datePreset) return null;
  switch (state.datePreset) {
    case 'today':
      return { from: now, to: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999) };
    case 'thisWeek': {
      const dow = now.getDay(); // 0=dim … 6=sam
      const daysToSunday = dow === 0 ? 0 : 7 - dow;
      const sun = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysToSunday, 23, 59, 59, 999);
      return { from: now, to: sun };
    }
    case 'thisMonth': {
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999); // dernier jour du mois
      return { from: now, to };
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/tournamentCalendar.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Type-check**

Run: `node node_modules/typescript/bin/tsc --noEmit`
Expected: FAIL at this step — `FacetPanel.tsx` and `discover.ts`/`DiscoverMatches.tsx`
still reference the old `DatePreset` values (`'weekend'`, `'days30'`, `'months3'`,
`DiscoverPeriod`). This is expected and resolved by Tasks 2-4.

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/tournamentCalendar.ts frontend/__tests__/tournamentCalendar.test.ts
git commit -m "feat(discover): DatePreset becomes today/thisWeek/thisMonth, shared DATE_PRESETS list"
```

---

### Task 2: `FacetPanel.tsx` (Tournois) — utilise `DATE_PRESETS` partagé

**Files:**
- Modify: `frontend/components/calendar/FacetPanel.tsx`

- [ ] **Step 1: Write the implementation** (no new test needed — `FacetPanel.test.tsx`'s
existing assertions don't reference specific preset labels, per the codebase survey;
they'll keep passing once the component compiles against the new preset list)

In `frontend/components/calendar/FacetPanel.tsx`, replace:

```tsx
import { CalendarFilterState, DatePreset, calendarFacets } from '@/lib/tournamentCalendar';
import { TournamentGender } from '@/lib/api';

const GENDER_LABEL: Record<string, string> = { MEN: 'Messieurs', WOMEN: 'Dames', MIXED: 'Mixte' };
const PRESETS: { key: DatePreset; label: string }[] = [
  { key: 'weekend', label: 'Ce week-end' },
  { key: 'thisMonth', label: 'Ce mois-ci' },
  { key: 'days30', label: '30 jours' },
  { key: 'months3', label: '3 mois' },
];
```

with:

```tsx
import { CalendarFilterState, DatePreset, DATE_PRESETS, calendarFacets } from '@/lib/tournamentCalendar';
import { TournamentGender } from '@/lib/api';

const GENDER_LABEL: Record<string, string> = { MEN: 'Messieurs', WOMEN: 'Dames', MIXED: 'Mixte' };
```

Then, in the "Quand" `FacetGroup`, replace `{PRESETS.map((p) => (` with `{DATE_PRESETS.map((p) => (` (the rest of that block — the `FacetChip` JSX and the `DateRangeChip` line right after — stays exactly as-is).

- [ ] **Step 2: Run tests to verify they still pass**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/FacetPanel.test.tsx __tests__/TournamentFinder.test.tsx`
Expected: PASS (no assertion in either file names a specific old preset label)

- [ ] **Step 3: Type-check**

Run: `node node_modules/typescript/bin/tsc --noEmit`
Expected: still fails on `discover.ts`/`DiscoverMatches.tsx` (Tasks 3-4 not done yet) —
confirm no NEW error is reported for `FacetPanel.tsx` itself.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/calendar/FacetPanel.tsx
git commit -m "feat(discover): tournois quand-filter uses the shared DATE_PRESETS list"
```

---

### Task 3: `lib/discover.ts` — retire `DiscoverPeriod`/`discoverWindow`, réutilise `resolveDateWindow`

**Files:**
- Modify: `frontend/lib/discover.ts`
- Modify: `frontend/__tests__/discover.test.ts`

- [ ] **Step 1: Update the failing tests**

In `frontend/__tests__/discover.test.ts`, replace the whole file content with:

```ts
import { filterNationalMatches, parseLocationQuery, sortMatchesByDistance, distanceLabel } from '@/lib/discover';
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
  const base: DiscoverMatchFilter = { datePreset: 'today', dateFrom: null, dateTo: null, location: { city: null, deptCodes: [] }, myLevel: null };

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
  const base: DiscoverMatchFilter = { datePreset: null, dateFrom: null, dateTo: null, location: { city: null, deptCodes: [] }, myLevel: null };

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
    const noDept  = m({ id: 'c' });
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
  const base: DiscoverMatchFilter = { datePreset: null, dateFrom: null, dateTo: null, location: { city: null, deptCodes: [] }, myLevel: 6.2 };

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
```

(The `discoverWindow` describe block is removed entirely — the window-computation
math it tested now lives in, and is tested by, `tournamentCalendar.test.ts`'s
`resolveDateWindow` suite, Task 1. Duplicating that coverage here would violate DRY.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/discover.test.ts`
Expected: FAIL — `lib/discover.ts` doesn't export a `DiscoverMatchFilter` with
`datePreset`/`dateFrom`/`dateTo` yet (TS shape mismatch surfaces as a runtime failure
since the old `filterNationalMatches` reads `f.period`, which is `undefined` on the
new test fixtures, `discoverWindow('undefined' as never, now)` throws or returns
unexpected values).

- [ ] **Step 3: Write the implementation**

Replace the entire content of `frontend/lib/discover.ts` with:

```ts
import type { NationalOpenMatch } from '@/lib/api';
import { distanceKm, DatePreset, resolveDateWindow } from '@/lib/tournamentCalendar';
import { norm } from '@/lib/members';
import { rangesOverlap } from '@/lib/levelMatch';

// Helpers purs de l'onglet « Parties » de /decouvrir : filtre date/ville/niveau + tri par
// distance sur les parties ouvertes nationales (GET /api/open-matches/national). Le filtre de
// date réutilise DatePreset/resolveDateWindow de tournamentCalendar.ts — même sélecteur
// « Aujourd'hui / Cette semaine / Ce mois-ci / Dates » que la section Tournois, pas une
// logique de fenêtre dupliquée.

export interface DiscoverMatchFilter {
  datePreset: DatePreset | null;
  dateFrom: string | null; // 'YYYY-MM-DD'
  dateTo: string | null;   // 'YYYY-MM-DD'
  location: LocationQuery;
  myLevel: number | null;
}

/** Requête de localisation parsée : ville OU codes département (exclusifs). */
export interface LocationQuery { city: string | null; deptCodes: string[] }

/** « Ville, code postal ou département » : un CP est réduit à son département (97x → 3 chiffres,
 *  Corse 20xxx → 2A+2B) ; un code 2-3 chiffres passe tel quel ; sinon recherche par nom. */
export function parseLocationQuery(q: string): LocationQuery {
  const t = q.trim();
  if (!t) return { city: null, deptCodes: [] };
  if (/^\d{5}$/.test(t)) {
    if (t.startsWith('20')) return { city: null, deptCodes: ['2A', '2B'] };
    if (t.startsWith('97')) return { city: null, deptCodes: [t.slice(0, 3)] };
    return { city: null, deptCodes: [t.slice(0, 2)] };
  }
  if (/^2[abAB]$/.test(t)) return { city: null, deptCodes: [t.toUpperCase()] };
  if (t === '20') return { city: null, deptCodes: ['2A', '2B'] };
  if (/^\d{2,3}$/.test(t)) return { city: null, deptCodes: [t] };
  return { city: t, deptCodes: [] };
}

export interface RankedMatch {
  match: NationalOpenMatch;
  distanceKm: number | null;
}

/**
 * Fourchette de niveau autour du niveau du joueur (arrondi ±1), clampée [1,8] (bornes du
 * système de niveau — miroir du clamp de `OpenMatches.tsx`), pour le filtre « à mon niveau ».
 */
function myLevelWindow(myLevel: number): [number, number] {
  const center = Math.round(myLevel);
  return [Math.max(1, center - 1), Math.min(8, center + 1)];
}

/**
 * Filtre les parties nationales par date + localisation + niveau (ET entre dimensions).
 * Localisation : soit une liste de codes département (`club.departmentCode`, comparaison
 * insensible casse, club sans code exclu), soit une recherche texte insensible accents/casse
 * (`norm`, substring) sur la ville OU le nom du département — les deux formes sont exclusives
 * (cf. `parseLocationQuery`) ; filtre vide = pas de contrainte. Niveau : une partie sans
 * fourchette (`targetLevelMin/Max` null) est toujours « ouverte à tous » — géré nativement par
 * `rangesOverlap` (bornes null = non bornées) sans cas particulier ; `myLevel: null` désactive
 * entièrement le filtre de niveau.
 */
export function filterNationalMatches(
  matches: NationalOpenMatch[],
  f: DiscoverMatchFilter,
  now: Date,
): NationalOpenMatch[] {
  const win = resolveDateWindow({ datePreset: f.datePreset, from: f.dateFrom, to: f.dateTo }, now);
  const { city, deptCodes } = f.location;
  const needle = city ? norm(city) : null;
  const levelWin = f.myLevel != null ? myLevelWindow(f.myLevel) : null;

  const locOk = (m: NationalOpenMatch) => {
    if (deptCodes.length) return m.club.departmentCode != null && deptCodes.includes(m.club.departmentCode.toUpperCase());
    if (needle) return (m.club.city != null && norm(m.club.city).includes(needle))
      || (m.club.department != null && norm(m.club.department).includes(needle));
    return true;
  };

  return matches.filter((m) => {
    if (win) {
      const t = new Date(m.startTime).getTime();
      if (t < win.from.getTime()) return false;
      if (win.to && t > win.to.getTime()) return false;
    }
    if (!locOk(m)) return false;
    if (levelWin && !rangesOverlap(m.targetLevelMin, m.targetLevelMax, levelWin[0], levelWin[1])) return false;
    return true;
  });
}

/**
 * Trie par distance croissante (nulls — pas de géoloc visiteur ou pas de coords club —
 * en fin, tiebreak `startTime`, miroir `applyFilters` de tournamentCalendar.ts). Sans
 * `coords`, l'ordre d'entrée est conservé et `distanceKm` vaut `null` partout.
 */
export function sortMatchesByDistance(
  matches: NationalOpenMatch[],
  coords: { lat: number; lng: number } | null,
): RankedMatch[] {
  const ranked: RankedMatch[] = matches.map((match) => {
    const hasCoords = coords != null && match.club.latitude != null && match.club.longitude != null;
    return {
      match,
      distanceKm: hasCoords ? distanceKm(coords!, { lat: match.club.latitude!, lng: match.club.longitude! }) : null,
    };
  });
  if (!coords) return ranked;
  ranked.sort((a, b) => {
    if (a.distanceKm == null && b.distanceKm == null) return a.match.startTime.localeCompare(b.match.startTime);
    if (a.distanceKm == null) return 1;
    if (b.distanceKm == null) return -1;
    return a.distanceKm - b.distanceKm || a.match.startTime.localeCompare(b.match.startTime);
  });
  return ranked;
}

/** Libellé de distance : mètres sous 1 km, kilomètres arrondis au-delà. */
export function distanceLabel(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${Math.round(km)} km`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/discover.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/discover.ts frontend/__tests__/discover.test.ts
git commit -m "feat(discover): parties date filter reuses resolveDateWindow, drop discoverWindow"
```

---

### Task 4: `DiscoverMatches.tsx` — sélecteur de date partagé + étagère 2 lignes

**Files:**
- Modify: `frontend/components/discover/DiscoverMatches.tsx` (full file)
- Modify: `frontend/__tests__/DiscoverMatches.test.tsx`

- [ ] **Step 1: Update the test title (no behavior change needed for most tests)**

In `frontend/__tests__/DiscoverMatches.test.tsx`, rename the test titled
`'rend 1 carte par partie, défaut « 14 jours » = période all'` (its body is unaffected —
the default state still shows everything, unfiltered by date):

```tsx
  it('rend 1 carte par partie, défaut « 14 jours » = période all', () => {
```

to:

```tsx
  it('rend 1 carte par partie, aucun filtre de date par défaut', () => {
```

No other test in this file needs a body change — per the codebase survey, the only
chip label asserted anywhere in this file is `"Aujourd'hui"`, which is unchanged in the
new preset list, and the existing "click Aujourd'hui filters to today" behavior is
unaffected (same window semantics, `datePreset` replaces `period` as the underlying
state name but the visible chip and its effect are identical).

- [ ] **Step 2: Run the full suite to confirm this rename alone doesn't break anything,
then implement**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/DiscoverMatches.test.tsx`
Expected: still PASS at this point (title-only change) — this step is a checkpoint, not
a red/green TDD step, since no new assertion was added (the component already satisfies
the existing behavioral contract; Task 4 is a refactor of *how* that contract is met,
not a new one).

- [ ] **Step 3: Write the implementation**

Replace the entire content of `frontend/components/discover/DiscoverMatches.tsx` with:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { api, NationalOpenMatch, MyRating } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useTheme } from '@/lib/ThemeProvider';
import { FacetChip, FacetGroup, FILTER_TINTS } from '@/components/ui/FacetChip';
import { NationalMatchCard } from '@/components/platform/NationalMatchCard';
import { filterNationalMatches, sortMatchesByDistance, LocationQuery } from '@/lib/discover';
import { DatePreset, DATE_PRESETS } from '@/lib/tournamentCalendar';
import { DateRangeChip } from '@/components/calendar/DateRangeChip';
import { useScrollRail } from '@/lib/useScrollRail';
import { RailArrows } from '@/components/ui/RailArrows';

// Rail de découverte, pas un flux exhaustif : on plafonne l'affichage (comme les autres
// rails de la vitrine — OpenMatchesShowcase à 6, UpcomingTournaments à 4).
const MAX_VISIBLE = 9;

// Onglet « Parties » de la page /decouvrir : étagère 2 lignes de parties ouvertes nationales
// (GET /api/open-matches/national, chargées par le parent) filtrées par date/localisation/
// niveau et triées par distance. Le sélecteur de date (puces Aujourd'hui/Cette semaine/Ce
// mois-ci + calendrier « Dates ») est EXACTEMENT celui de la section Tournois (DATE_PRESETS/
// DateRangeChip partagés, cf. lib/tournamentCalendar.ts) — un seul sélecteur, pas deux
// comportements sous un même nom. Pur côté données — `matches`/`location`/`coords`/`now`
// arrivent en props, l'état de date/niveau est local à ce composant. `onCount` (optionnel)
// reporte au parent le nombre de cartes affichées après filtrage — pas appelé tant que
// `matches`/`now` ne sont pas chargés (compteur inconnu).
export function DiscoverMatches({
  matches,
  location,
  coords,
  now,
  onSeeClubs,
  onCount,
}: {
  matches: NationalOpenMatch[] | null;
  location: LocationQuery;
  coords: { lat: number; lng: number } | null;
  now: Date | null;
  onSeeClubs: () => void;
  onCount?: (n: number) => void;
}) {
  const { th } = useTheme();
  const { token } = useAuth();
  const [datePreset, setDatePreset] = useState<DatePreset | null>(null);
  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const [dateTo, setDateTo] = useState<string | null>(null);
  const [levelOn, setLevelOn] = useState(false);
  const [rating, setRating] = useState<MyRating | null>(null);

  useEffect(() => {
    if (!token) { setRating(null); return; }
    api.getMyRating(token, 'padel').then(setRating).catch(() => setRating(null));
  }, [token]);

  const levelChipVisible = Boolean(token) && rating?.level != null;
  const myLevel = levelChipVisible && levelOn ? rating!.level : null;

  // `ranked` reste `null` tant que `matches`/`now` ne sont pas chargés (compteur inconnu) —
  // calculé AVANT les hooks ci-dessous pour respecter les règles des hooks (ils doivent être
  // appelés à chaque rendu, jamais conditionnellement, donc avant l'early return plus bas).
  const ranked = matches != null && now != null
    ? sortMatchesByDistance(filterNationalMatches(matches, { datePreset, dateFrom, dateTo, location, myLevel }, now), coords).slice(0, MAX_VISIBLE)
    : null;

  useEffect(() => {
    if (ranked) onCount?.(ranked.length);
  }, [ranked?.length, onCount]);

  const { railRef, edges, scrollByPage } = useScrollRail([ranked?.length ?? 0]);

  if (matches == null || now == null) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', fontFamily: th.fontUI, color: th.textMute }}>
        Chargement…
      </div>
    );
  }

  const list = ranked ?? [];
  const count = `${list.length} partie${list.length > 1 ? 's' : ''}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Même tiroir compact que les filtres Tournois (FacetPanel) — langage partagé. */}
      <div style={{ borderRadius: 16, background: th.bgElev, boxShadow: `inset 0 0 0 1px ${th.line}` }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 26px', padding: '12px 14px' }}>
          <FacetGroup label="Quand" tint={FILTER_TINTS.quand}>
            {DATE_PRESETS.map((p) => (
              <FacetChip key={p.key} label={p.label} tint={FILTER_TINTS.quand}
                active={datePreset === p.key && !dateFrom && !dateTo}
                onClick={() => setDatePreset(datePreset === p.key ? null : p.key)} />
            ))}
            <DateRangeChip from={dateFrom} to={dateTo} onChange={(f, t) => { setDateFrom(f); setDateTo(t); }} tint={FILTER_TINTS.quand} />
          </FacetGroup>
          {levelChipVisible && (
            <FacetGroup label="Niveau" tint={FILTER_TINTS.niveau}>
              <FacetChip label="À mon niveau" tint={FILTER_TINTS.niveau} active={levelOn} onClick={() => setLevelOn((v) => !v)} />
            </FacetGroup>
          )}
        </div>
      </div>

      {list.length === 0 ? (
        <div style={{ padding: '32px 0', textAlign: 'center', fontFamily: th.fontUI, color: th.textMute }}>
          <div>Aucune partie ne correspond pour le moment.</div>
          <button
            onClick={onSeeClubs}
            style={{
              marginTop: 14, border: 'none', cursor: 'pointer', borderRadius: 999, padding: '10px 20px',
              fontFamily: th.fontUI, fontSize: 14, fontWeight: 700, background: th.accent, color: th.onAccent,
            }}
          >
            Voir les clubs →
          </button>
        </div>
      ) : (
        <div>
          {/* grid-auto-columns en calc(50% - gap/2) — toujours 2 vignettes pleinement
              visibles dans la largeur du conteneur, même traitement que Tournois/Clubs/
              Prochains events. */}
          <style>{`.discover-matches-grid{display:grid;grid-template-rows:repeat(2,auto);grid-auto-flow:column;grid-auto-columns:calc(50% - 7px);gap:14px;align-items:start}`}</style>
          <div style={{ textAlign: 'right', fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginBottom: 4 }}>{count}</div>
          <div style={{ position: 'relative', margin: '0 -20px' }}>
            <div ref={railRef} className="sp-scroll-x discover-matches-grid" style={{ padding: '4px 20px 8px', scrollSnapType: 'x proximity', scrollPaddingLeft: 20 }}>
              {list.map((r) => (
                <NationalMatchCard key={r.match.id} match={r.match} distanceKm={r.distanceKm} style={{ scrollSnapAlign: 'start' }} />
              ))}
            </div>
            <RailArrows edges={edges} onPrev={() => scrollByPage(-1)} onNext={() => scrollByPage(1)} prevLabel="Parties précédentes" nextLabel="Parties suivantes" fadeBottom={8} />
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/DiscoverMatches.test.tsx`
Expected: PASS (all tests, including the renamed one — every other test's chip
interactions and cap/empty/loading assertions are unaffected by the internal state
rename or the grid-vs-flex row change)

- [ ] **Step 5: Type-check**

Run: `node node_modules/typescript/bin/tsc --noEmit`
Expected: no errors anywhere (this was the last file referencing the old shapes).

- [ ] **Step 6: Commit**

```bash
git add frontend/components/discover/DiscoverMatches.tsx frontend/__tests__/DiscoverMatches.test.tsx
git commit -m "feat(discover): parties gets the shared date selector + 2-row shelf"
```

---

### Task 5: Vérification finale

**Files:** none (verification only)

- [ ] **Step 1: Run the full frontend test suite**

Run: `node node_modules/jest/bin/jest.js`
Expected: PASS — no regressions (aside from the known pre-existing
`BookingModal`/`ClubReserve.opening` full-run flake, unrelated to this work).

- [ ] **Step 2: Full type-check**

Run: `node node_modules/typescript/bin/tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Visual verification (CDP)**

With the dev stack running, capture `/decouvrir` (desktop 1280 + mobile 390), light +
dark:

- Parties: 2-row shelf (exactly 2 tiles per row, like Tournois/Clubs/Prochains events),
  counter + arrows unchanged, "Quand" filter now shows Aujourd'hui / Cette semaine / Ce
  mois-ci + a "Dates" button that opens the same calendar popup as Tournois'.
- Tournois: same 3 presets + Dates button (was 4 presets before — confirm "Ce
  week-end"/"30 jours"/"3 mois" are gone, replaced by "Cette semaine").
- Click "Cette semaine" on both Parties and Tournois, confirm it filters to items
  within the current week (through Sunday).

No code changes expected at this step unless a real visual regression is found — if
so, fix inline and re-run the affected suite + tsc before re-verifying.

---

## Self-review notes (for the plan author, already applied above)

- **Spec coverage**: unified `DatePreset`, shared `DATE_PRESETS`, `DiscoverMatches`'
  new date state + shelf CSS, and `FacetPanel`'s switch to the shared preset list are
  each covered by a task.
- **Type consistency**: `resolveDateWindow(state: DateFilterState, now: Date)` used
  identically by `discover.ts` (Task 3) and unchanged for `applyFilters`/
  `calendarFacets` (still pass a full `CalendarFilterState`, structurally compatible).
- **No placeholders**: every step has complete, exact code.
