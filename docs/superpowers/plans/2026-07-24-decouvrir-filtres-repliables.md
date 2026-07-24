# /decouvrir — filtres repliables partout, mémorisés, compteur unique, cartes club 272px — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the three filter drawers of `/decouvrir` (Parties, Tournois, Clubs) behind one shared repliable `FiltersToggle` component, memorize every filter set (Parties, Clubs, Tournois already memorized, "Mes clubs") across sessions in localStorage, remove the duplicated result-count line from the Tournois drawer footer, and shrink the Clubs cards to the same 272px width used by the Parties cards.

**Architecture:** Extract the repliable-button markup already used by `TournamentFinder` into a shared presentational component `components/ui/FiltersToggle.tsx`. Add small pure serialize/deserialize + counting helpers to `frontend/lib/discover.ts` (mirroring the existing `calendarStateToStored`/`storedToCalendarState` pattern from `lib/tournamentCalendar.ts`). Wire the toggle + persistence into `DiscoverMatches` (Parties) and `ClubDirectory` (Clubs, controlled mode only — the anonymous landing-page directory is untouched). Remove the `resultCount` prop from `FacetPanel` (used only by `TournamentFinder`). Add a small "Mes clubs" persistence effect to `DiscoverClient`.

**Tech Stack:** Next.js 16 (App Router) frontend, React 19, TypeScript, Jest + React Testing Library, no backend/migration involved (100% frontend).

**Spec:** `docs/superpowers/specs/2026-07-24-decouvrir-filtres-repliables-design.md`

---

## Before you start

- Working directory: `C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend`
- Run a single test file with: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/<File>.test.tsx` (the `jest`/`tsc` shims in `node_modules/.bin` are broken on this machine — always invoke via `node node_modules/<pkg>/bin/<bin>.js`).
- Run the TypeScript type gate with: `node node_modules/typescript/bin/tsc --noEmit`
- `--runTestsByPath` is required when targeting one file — a bare path argument is treated as a *pattern* and can match multiple files (e.g. `discover.test.ts` also matches `DiscoverMatches.test.tsx` on this case-insensitive filesystem).

---

### Task 1: `lib/discover.ts` — stored-filter types, serializers, counters

**Files:**
- Modify: `frontend/lib/discover.ts`
- Test: `frontend/__tests__/discover.test.ts`

- [ ] **Step 1: Write the failing tests**

Open `frontend/__tests__/discover.test.ts` and change the top import line from:

```ts
import { filterNationalMatches, parseLocationQuery, sortMatchesByDistance, distanceLabel } from '@/lib/discover';
```

to:

```ts
import {
  filterNationalMatches, parseLocationQuery, sortMatchesByDistance, distanceLabel,
  partiesStateToStored, storedToPartiesState, partiesFilterCount,
  clubsStateToStored, storedToClubsFilters,
} from '@/lib/discover';
```

Then append these `describe` blocks at the end of the file (after the existing `parseLocationQuery` block, before the final closing of the file — i.e. as new top-level blocks):

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/discover.test.ts`
Expected: FAIL — `partiesStateToStored`, `storedToPartiesState`, `partiesFilterCount`, `clubsStateToStored`, `storedToClubsFilters` are not exported by `@/lib/discover`.

- [ ] **Step 3: Implement the helpers**

Open `frontend/lib/discover.ts`. Change the top import line from:

```ts
import type { NationalOpenMatch } from '@/lib/api';
import { distanceKm, DatePreset, resolveDateWindow } from '@/lib/tournamentCalendar';
import { norm } from '@/lib/members';
import { rangesOverlap } from '@/lib/levelMatch';
```

to:

```ts
import type { NationalOpenMatch } from '@/lib/api';
import { distanceKm, DatePreset, resolveDateWindow, DATE_PRESET_KEYS } from '@/lib/tournamentCalendar';
import { norm } from '@/lib/members';
import { rangesOverlap } from '@/lib/levelMatch';
```

Add the two shared union types right before the `DiscoverMatchFilter` interface (they're used by it below, and by the new storage helpers appended at the end of the file), and update the interface to reuse them instead of inline unions. Change:

```ts
export interface DiscoverMatchFilter {
  datePreset: DatePreset | null;
  dateFrom: string | null; // 'YYYY-MM-DD'
  dateTo: string | null;   // 'YYYY-MM-DD'
  kind: 'all' | 'competitive' | 'friendly';   // Pour de vrai / Pour le fun
  gender: 'all' | 'WOMEN' | 'MIXED';          // Féminine / Mixte
  location: LocationQuery;
  myLevel: number | null;
}
```

to:

```ts
/** Type de partie : Pour de vrai / Pour le fun (miroir de OpenMatches.tsx). */
export type PartiesKind = 'all' | 'competitive' | 'friendly';
/** Genre de partie : Féminine / Mixte. */
export type PartiesGender = 'all' | 'WOMEN' | 'MIXED';

export interface DiscoverMatchFilter {
  datePreset: DatePreset | null;
  dateFrom: string | null; // 'YYYY-MM-DD'
  dateTo: string | null;   // 'YYYY-MM-DD'
  kind: PartiesKind;
  gender: PartiesGender;
  location: LocationQuery;
  myLevel: number | null;
}
```

Finally, append this block at the very end of the file (after `distanceLabel`):

```ts
// ── Filtres « Ça joue bientôt » : mémoire de session + badge compteur ─────────

/** Clé localStorage des filtres Parties de /decouvrir (mémoire d'une session à l'autre). */
export const DISCOVER_PARTIES_FILTERS_KEY = 'palova:discover-parties-filters';

/** Forme JSON-sérialisable des filtres Parties. */
export interface StoredPartiesFilters {
  quand: DatePreset | null;
  from: string | null;
  to: string | null;
  type: PartiesKind;
  genre: PartiesGender;
  niveau: boolean;
}

export function partiesStateToStored(s: {
  datePreset: DatePreset | null; dateFrom: string | null; dateTo: string | null;
  kind: PartiesKind; gender: PartiesGender; levelOn: boolean;
}): StoredPartiesFilters {
  return { quand: s.datePreset, from: s.dateFrom, to: s.dateTo, type: s.kind, genre: s.gender, niveau: s.levelOn };
}

const PARTIES_KIND_VALUES: PartiesKind[] = ['all', 'competitive', 'friendly'];
const PARTIES_GENDER_VALUES: PartiesGender[] = ['all', 'WOMEN', 'MIXED'];

/** Réhydrate un état depuis le stockage — tolérant à toute entrée corrompue (miroir de
 *  `storedToCalendarState` de tournamentCalendar.ts). */
export function storedToPartiesState(raw: unknown): StoredPartiesFilters {
  const s: StoredPartiesFilters = { quand: null, from: null, to: null, type: 'all', genre: 'all', niveau: false };
  if (!raw || typeof raw !== 'object') return s;
  const o = raw as Record<string, unknown>;
  if (typeof o.quand === 'string' && (DATE_PRESET_KEYS as string[]).includes(o.quand)) s.quand = o.quand as DatePreset;
  if (typeof o.from === 'string') s.from = o.from;
  if (typeof o.to === 'string') s.to = o.to;
  if (typeof o.type === 'string' && (PARTIES_KIND_VALUES as string[]).includes(o.type)) s.type = o.type as PartiesKind;
  if (typeof o.genre === 'string' && (PARTIES_GENDER_VALUES as string[]).includes(o.genre)) s.genre = o.genre as PartiesGender;
  if (typeof o.niveau === 'boolean') s.niveau = o.niveau;
  return s;
}

/** Nombre de dimensions de filtre ACTIVES (badge « Filtres · N »). Le terme niveau ne compte
 *  que si la chip est visible (connecté + niveau calculé) — un `levelOn` restauré sans chip
 *  visible ne doit pas gonfler le badge d'un filtre invisible. Une plage from/to compte pour
 *  1, pas 2 (même règle que `activeFilterCount` de tournamentCalendar.ts). */
export function partiesFilterCount(f: {
  datePreset: DatePreset | null; dateFrom: string | null; dateTo: string | null;
  kind: PartiesKind; gender: PartiesGender; levelOn: boolean; levelChipVisible: boolean;
}): number {
  return (f.datePreset || f.dateFrom || f.dateTo ? 1 : 0)
    + (f.kind !== 'all' ? 1 : 0)
    + (f.gender !== 'all' ? 1 : 0)
    + (f.levelChipVisible && f.levelOn ? 1 : 0);
}

// ── Filtres Clubs (mode contrôlé de /decouvrir seulement) ─────────────────────

/** Clé localStorage des filtres Clubs de /decouvrir — mode contrôlé seulement, la vitrine
 *  anonyme (`ClubDirectory` en mode autonome) ne mémorise rien. */
export const DISCOVER_CLUBS_FILTERS_KEY = 'palova:discover-clubs-filters';

export interface StoredClubsFilters { q: string; sport: string }

export function clubsStateToStored(s: { q: string; sport: string }): StoredClubsFilters {
  return { q: s.q, sport: s.sport };
}

/** Réhydrate un état depuis le stockage — tolérant à toute entrée corrompue. */
export function storedToClubsFilters(raw: unknown): StoredClubsFilters {
  const s: StoredClubsFilters = { q: '', sport: '' };
  if (!raw || typeof raw !== 'object') return s;
  const o = raw as Record<string, unknown>;
  if (typeof o.q === 'string') s.q = o.q;
  if (typeof o.sport === 'string') s.sport = o.sport;
  return s;
}

// ── Filtre « Mes clubs » (mémorisé d'une session à l'autre) ───────────────────

/** Clé localStorage du toggle « Mes clubs » de /decouvrir. */
export const DISCOVER_MINE_ONLY_KEY = 'palova:discover-mine-only';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/discover.test.ts`
Expected: PASS — all tests green (existing + new).

- [ ] **Step 5: Type-check**

Run: `node node_modules/typescript/bin/tsc --noEmit`
Expected: no new errors introduced by this file.

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/discover.ts frontend/__tests__/discover.test.ts
git commit -m "feat(discover): helpers de mémorisation + comptage des filtres Parties/Clubs"
```

---

### Task 2: `components/ui/FiltersToggle.tsx` — shared repliable-filters button

**Files:**
- Create: `frontend/components/ui/FiltersToggle.tsx`
- Test: `frontend/__tests__/FiltersToggle.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/__tests__/FiltersToggle.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { FiltersToggle } from '@/components/ui/FiltersToggle';

function setup(over: Partial<React.ComponentProps<typeof FiltersToggle>> = {}) {
  const props = {
    count: 0, open: false, onToggle: jest.fn(), onClear: jest.fn(), controlsId: 'test-facets',
    ...over,
  };
  render(<ThemeProvider><FiltersToggle {...props} /></ThemeProvider>);
  return props;
}

describe('FiltersToggle', () => {
  it('rend le bouton « Filtres » sans badge ni lien Effacer à 0', () => {
    setup();
    expect(screen.getByRole('button', { name: /^Filtres/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Effacer' })).not.toBeInTheDocument();
  });

  it('badge affiche le compteur et le lien Effacer apparaît', () => {
    setup({ count: 2 });
    expect(screen.getByRole('button', { name: /^Filtres/ }).textContent).toContain('2');
    expect(screen.getByRole('button', { name: 'Effacer' })).toBeInTheDocument();
  });

  it('clic sur Filtres appelle onToggle, clic sur Effacer appelle onClear', () => {
    const p = setup({ count: 1 });
    fireEvent.click(screen.getByRole('button', { name: /^Filtres/ }));
    expect(p.onToggle).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Effacer' }));
    expect(p.onClear).toHaveBeenCalledTimes(1);
  });

  it('aria-expanded et aria-controls reflètent open/controlsId', () => {
    setup({ open: true, controlsId: 'my-panel' });
    const btn = screen.getByRole('button', { name: /^Filtres/ });
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    expect(btn).toHaveAttribute('aria-controls', 'my-panel');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/FiltersToggle.test.tsx`
Expected: FAIL — `Cannot find module '@/components/ui/FiltersToggle'`.

- [ ] **Step 3: Implement the component**

Create `frontend/components/ui/FiltersToggle.tsx`:

```tsx
'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { Icon } from '@/components/ui/Icon';

// Bouton repliable « ⚙ Filtres · N » partagé par les tiroirs de filtres de /decouvrir
// (Tournois, Parties, Clubs) — extrait de TournamentFinder.tsx pour un seul langage. Badge
// compteur, chevron, lien « Effacer » à côté (rendu seulement si count > 0). Le tiroir de
// contenu (facettes) reste chez l'appelant — ce composant ne rend que la rangée de contrôle.
export function FiltersToggle({ count, open, onToggle, onClear, controlsId }: {
  count: number;
  open: boolean;
  onToggle: () => void;
  onClear: () => void;
  controlsId: string;
}) {
  const { th } = useTheme();
  return (
    <div style={{ padding: '4px 20px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={controlsId}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, border: 'none', cursor: 'pointer',
          borderRadius: 999, padding: '8px 14px', background: th.bgElev,
          boxShadow: `inset 0 0 0 1px ${th.line}`, fontFamily: th.fontUI, fontSize: 13.5,
          fontWeight: 700, color: th.text, WebkitTapHighlightColor: 'transparent',
        }}
      >
        <Icon name="settings" size={15} color={th.textMute} />
        Filtres
        {count > 0 && (
          <span aria-hidden="true" style={{
            minWidth: 18, height: 18, borderRadius: 999, padding: '0 5px', display: 'inline-flex',
            alignItems: 'center', justifyContent: 'center', background: th.accent, color: th.onAccent,
            fontSize: 11.5, fontWeight: 800, lineHeight: 1,
          }}>{count}</span>
        )}
        <span aria-hidden="true" style={{ display: 'inline-flex', transform: open ? 'rotate(-90deg)' : 'rotate(90deg)', transition: 'transform .15s' }}>
          <Icon name="chevR" size={13} color={th.textMute} />
        </span>
      </button>
      {count > 0 && (
        <button type="button" onClick={onClear} style={{
          border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: th.fontUI,
          fontSize: 12.5, fontWeight: 600, color: th.textMute, padding: '4px 6px',
        }}>Effacer</button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/FiltersToggle.test.tsx`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/ui/FiltersToggle.tsx frontend/__tests__/FiltersToggle.test.tsx
git commit -m "feat(ui): FiltersToggle — bouton filtres repliable partagé"
```

---

### Task 3: `FacetPanel.tsx` — remove the duplicated `resultCount` footer

**Files:**
- Modify: `frontend/components/calendar/FacetPanel.tsx`
- Test: `frontend/__tests__/FacetPanel.test.tsx`

- [ ] **Step 1: Update the test to reflect the removal**

In `frontend/__tests__/FacetPanel.test.tsx`, replace the last test (`'pied « N résultats » rendu si resultCount fourni et filtre actif, absent sinon'`, lines 87-100) with:

```tsx
  it('le pied ne montre plus de compte de résultats (compteur unique = celui du rail)', () => {
    const state = { ...emptyCalendarState(), deptCodes: new Set(['75']) };
    const p = setup({ state });
    expect(screen.queryByText(/résultat/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Effacer les filtres/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Effacer les filtres/ }));
    expect(p.onClear).toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/FacetPanel.test.tsx`
Expected: FAIL — `screen.queryByText(/résultat/)` currently finds the "N résultats" text since `setup()` never passes `resultCount`, so this specific assertion... — actually re-check: `setup()` doesn't pass `resultCount` by default, so the footer's `resultCount != null && ...` renders nothing even today. The real regression check is structural: run it to confirm it still passes at this point (no behavior changed yet) — this step exists to catch a mistake, not necessarily to see a red bar. Proceed to Step 3 regardless.

- [ ] **Step 3: Update the top-of-file comment**

In `frontend/components/calendar/FacetPanel.tsx`, change:

```
// Panneau de filtres des tournois (partagé /decouvrir + /tournois) : UN tiroir compact au
// langage d'EventsFilterBar — groupes labellisés côte à côte (flex-wrap), chips ✓/compteurs,
// pied « N résultats · Effacer les filtres ». Les briques FacetChip/FacetGroup viennent
// désormais du module partagé `@/components/ui/FacetChip` (teintes fixes par groupe,
// FILTER_TINTS) — ce ne sont plus des copies locales.
```

to:

```
// Panneau de filtres des tournois (partagé /decouvrir + /tournois) : UN tiroir compact au
// langage d'EventsFilterBar — groupes labellisés côte à côte (flex-wrap), chips ✓/compteurs,
// pied « Effacer les filtres » (le compte de résultats vit dans le rail, pas ici — un seul
// compteur par section). Les briques FacetChip/FacetGroup viennent désormais du module
// partagé `@/components/ui/FacetChip` (teintes fixes par groupe, FILTER_TINTS) — ce ne sont
// plus des copies locales.
```

- [ ] **Step 4: Remove the `resultCount` prop**

In `FacetPanelProps`, remove:

```ts
  /** Nombre de résultats affichés (pied du tiroir) — fourni par la page hôte. */
  resultCount?: number | null;
```

Change the function signature from:

```ts
export function FacetPanel({ facets, state, onToggleDept, onToggleCategory, onToggleGender, onSetPreset, onSetRange, onToggleNearMe, onClear, nearMeBusy, resultCount }: FacetPanelProps) {
```

to:

```ts
export function FacetPanel({ facets, state, onToggleDept, onToggleCategory, onToggleGender, onSetPreset, onSetRange, onToggleNearMe, onClear, nearMeBusy }: FacetPanelProps) {
```

- [ ] **Step 5: Simplify the footer**

Change:

```tsx
        {hasActive && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 14px', borderTop: `1px solid ${th.line}` }}>
            <span style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, color: th.text }}>
              {resultCount != null && `${resultCount} résultat${resultCount > 1 ? 's' : ''}`}
            </span>
            <span style={{ flex: 1 }} />
            <button onClick={onClear} style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none', cursor: 'pointer',
              borderRadius: 999, padding: '4px 11px', background: 'transparent',
              boxShadow: `inset 0 0 0 1px ${th.lineStrong}`,
              fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.textMute,
            }}>
              <Icon name="x" size={12} color={th.textMute} />Effacer les filtres
            </button>
          </div>
        )}
```

to:

```tsx
        {hasActive && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '9px 14px', borderTop: `1px solid ${th.line}` }}>
            <button onClick={onClear} style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none', cursor: 'pointer',
              borderRadius: 999, padding: '4px 11px', background: 'transparent',
              boxShadow: `inset 0 0 0 1px ${th.lineStrong}`,
              fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.textMute,
            }}>
              <Icon name="x" size={12} color={th.textMute} />Effacer les filtres
            </button>
          </div>
        )}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/FacetPanel.test.tsx`
Expected: PASS — all tests green.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/calendar/FacetPanel.tsx frontend/__tests__/FacetPanel.test.tsx
git commit -m "refactor(decouvrir): FacetPanel — retire le compte de résultats en doublon du pied"
```

---

### Task 4: `TournamentFinder.tsx` — swap the inline toggle for `FiltersToggle`

**Files:**
- Modify: `frontend/components/calendar/TournamentFinder.tsx`
- Test: `frontend/__tests__/TournamentFinder.test.tsx` (no content change expected — this task is a pure refactor, verified by the existing suite staying green)

- [ ] **Step 1: Update imports**

In `frontend/components/calendar/TournamentFinder.tsx`, change:

```ts
import { AgendaCard } from '@/components/agenda/AgendaCard';
import { AgendaRail } from '@/components/agenda/AgendaRail';
import { FacetPanel } from '@/components/calendar/FacetPanel';
import { Icon } from '@/components/ui/Icon';
import { tournamentPlacesLabel } from '@/lib/clubhouse';
```

to:

```ts
import { AgendaCard } from '@/components/agenda/AgendaCard';
import { AgendaRail } from '@/components/agenda/AgendaRail';
import { FacetPanel } from '@/components/calendar/FacetPanel';
import { FiltersToggle } from '@/components/ui/FiltersToggle';
import { tournamentPlacesLabel } from '@/lib/clubhouse';
```

(the `Icon` import is dropped — after this task it is no longer used anywhere in this file; the `Icon` import stays removed only if step 2 below is applied)

- [ ] **Step 2: Replace the inline toggle markup**

Replace this whole block (the repliable-bar `<div>` + its inner `<button>` markup, immediately followed by the `{filtersOpen && (<div id="tournois-facets">...)}` block):

```tsx
          <div style={{ padding: '4px 20px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              onClick={() => setFiltersOpen((o) => !o)}
              aria-expanded={filtersOpen}
              aria-controls="tournois-facets"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8, border: 'none', cursor: 'pointer',
                borderRadius: 999, padding: '8px 14px', background: th.bgElev,
                boxShadow: `inset 0 0 0 1px ${th.line}`, fontFamily: th.fontUI, fontSize: 13.5,
                fontWeight: 700, color: th.text, WebkitTapHighlightColor: 'transparent',
              }}
            >
              <Icon name="settings" size={15} color={th.textMute} />
              Filtres
              {filterCount > 0 && (
                <span aria-hidden="true" style={{
                  minWidth: 18, height: 18, borderRadius: 999, padding: '0 5px', display: 'inline-flex',
                  alignItems: 'center', justifyContent: 'center', background: th.accent, color: th.onAccent,
                  fontSize: 11.5, fontWeight: 800, lineHeight: 1,
                }}>{filterCount}</span>
              )}
              <span aria-hidden="true" style={{ display: 'inline-flex', transform: filtersOpen ? 'rotate(-90deg)' : 'rotate(90deg)', transition: 'transform .15s' }}>
                <Icon name="chevR" size={13} color={th.textMute} />
              </span>
            </button>
            {filterCount > 0 && (
              <button type="button" onClick={clearFilters} style={{
                border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: th.fontUI,
                fontSize: 12.5, fontWeight: 600, color: th.textMute, padding: '4px 6px',
              }}>Effacer</button>
            )}
          </div>
          {filtersOpen && (
            <div id="tournois-facets">
              <FacetPanel
                facets={facets}
                state={state}
                onToggleDept={(c) => toggleIn('deptCodes', c)}
                onToggleCategory={(c) => toggleIn('categories', c)}
                onToggleGender={(g) => toggleIn('genders', g)}
                onSetPreset={(p) => setState((s) => ({ ...s, datePreset: p, from: null, to: null }))}
                onSetRange={(from, to) => setState((s) => ({ ...s, from, to, datePreset: null }))}
                onToggleNearMe={toggleNearMe}
                onClear={clearFilters}
                nearMeBusy={nearBusy}
                resultCount={results ? results.length : null}
              />
            </div>
          )}
```

with:

```tsx
          <FiltersToggle count={filterCount} open={filtersOpen} onToggle={() => setFiltersOpen((o) => !o)} onClear={clearFilters} controlsId="tournois-facets" />
          {filtersOpen && (
            <div id="tournois-facets">
              <FacetPanel
                facets={facets}
                state={state}
                onToggleDept={(c) => toggleIn('deptCodes', c)}
                onToggleCategory={(c) => toggleIn('categories', c)}
                onToggleGender={(g) => toggleIn('genders', g)}
                onSetPreset={(p) => setState((s) => ({ ...s, datePreset: p, from: null, to: null }))}
                onSetRange={(from, to) => setState((s) => ({ ...s, from, to, datePreset: null }))}
                onToggleNearMe={toggleNearMe}
                onClear={clearFilters}
                nearMeBusy={nearBusy}
              />
            </div>
          )}
```

- [ ] **Step 3: Run the existing test suite to confirm no regression**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/TournamentFinder.test.tsx`
Expected: PASS — all existing tests green, unchanged (same DOM structure/roles/labels as before, just sourced from the shared component).

- [ ] **Step 4: Type-check**

Run: `node node_modules/typescript/bin/tsc --noEmit`
Expected: no errors (confirms `Icon` import removal didn't leave a stray reference, and `resultCount` prop removal is consistent on both sides).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/calendar/TournamentFinder.tsx
git commit -m "refactor(decouvrir): TournamentFinder — utilise FiltersToggle partagé"
```

---

### Task 5: `DiscoverMatches.tsx` (Parties) — closed-by-default drawer + persistence

**Files:**
- Modify: `frontend/components/discover/DiscoverMatches.tsx`
- Test: `frontend/__tests__/DiscoverMatches.test.tsx`

- [ ] **Step 1: Replace the test file**

Replace the entire content of `frontend/__tests__/DiscoverMatches.test.tsx` with:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { DiscoverMatches } from '@/components/discover/DiscoverMatches';
import type { NationalOpenMatch, MyRating } from '@/lib/api';

const getMyRating = jest.fn();

jest.mock('@/lib/api', () => ({
  api: { getMyRating: (...a: unknown[]) => getMyRating(...a) },
  assetUrl: (p: string | null) => p, // Avatar
}));

let authToken: string | null = null;
jest.mock('@/lib/useAuth', () => ({
  useAuth: () => ({ token: authToken, clubId: null, ready: true }),
}));

function makeMatch(over: Partial<NationalOpenMatch> = {}): NationalOpenMatch {
  return {
    id: 'm1',
    resourceName: 'Court 1',
    sport: { key: 'padel', name: 'Padel' },
    startTime: '2026-07-08T16:00:00.000Z',
    endTime: '2026-07-08T17:30:00.000Z',
    maxPlayers: 4,
    spotsLeft: 2,
    full: false,
    targetLevelMin: 4,
    targetLevelMax: 6,
    players: [
      { userId: 'org', firstName: 'Léa', lastName: 'Martin', avatarUrl: null, isOrganizer: true, team: 1, slot: 0 },
      { userId: 'p2', firstName: 'Tom', lastName: 'Durand', avatarUrl: null, isOrganizer: false, team: 2, slot: 0 },
    ],
    club: { slug: 'padel-arena-paris', name: 'Padel Arena Paris', city: 'Paris', timezone: 'Europe/Paris', accentColor: '#5e93da', logoUrl: null, latitude: 48.8566, longitude: 2.3522, department: null, departmentCode: null },
    ...over,
  };
}

function makeRating(over: Partial<MyRating> = {}): MyRating {
  return { calibrated: true, level: 6.2, tier: 'Confirmé', isProvisional: false, reliability: 80, matchesPlayed: 12, ...over };
}

const NOW = new Date('2026-07-08T10:00:00.000Z');

const wrap = (props: Partial<React.ComponentProps<typeof DiscoverMatches>> = {}) =>
  render(
    <ThemeProvider>
      <DiscoverMatches
        matches={props.matches !== undefined ? props.matches : [makeMatch()]}
        location={props.location ?? { city: null, deptCodes: [] }}
        coords={props.coords !== undefined ? props.coords : null}
        now={props.now !== undefined ? props.now : NOW}
        onSeeClubs={props.onSeeClubs ?? jest.fn()}
        onCount={props.onCount}
      />
    </ThemeProvider>,
  );

// Le tiroir de facettes est replié par défaut ; l'ouvrir avant de toucher une puce.
const openFilters = () => fireEvent.click(screen.getByRole('button', { name: /^Filtres/ }));

beforeEach(() => {
  jest.clearAllMocks();
  authToken = null;
  localStorage.clear(); // les filtres persistent en localStorage → sinon fuite entre tests
  getMyRating.mockResolvedValue(null);
});

describe('DiscoverMatches', () => {
  it('rend 1 carte par partie, aucun filtre de date par défaut', () => {
    wrap({ matches: [makeMatch({ id: 'm1' }), makeMatch({ id: 'm2', club: { ...makeMatch().club, name: 'Autre club' } })] });
    expect(screen.getByText('Padel Arena Paris')).toBeInTheDocument();
    expect(screen.getByText('Autre club')).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('le tiroir de facettes est replié par défaut ; « Filtres » le déplie', () => {
    wrap();
    expect(screen.queryByText('Quand')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: "Aujourd'hui" })).not.toBeInTheDocument();
    openFilters();
    expect(screen.getByText('Quand')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Aujourd'hui" })).toBeInTheDocument();
  });

  it('filtre par type de partie (Pour le fun)', () => {
    wrap({
      matches: [
        makeMatch({ id: 'c', competitive: true }),
        makeMatch({ id: 'f', competitive: false, club: { ...makeMatch().club, name: 'Fun Club' } }),
      ],
    });
    expect(screen.getAllByRole('link')).toHaveLength(2);
    openFilters();
    fireEvent.click(screen.getByRole('button', { name: 'Pour le fun' }));
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByText('Fun Club')).toBeInTheDocument();
  });

  it('filtre par genre (Féminine)', () => {
    wrap({
      matches: [
        makeMatch({ id: 'w', gender: 'WOMEN' }),
        makeMatch({ id: 'm', gender: 'MIXED', club: { ...makeMatch().club, name: 'Mixte Club' } }),
      ],
    });
    expect(screen.getAllByRole('link')).toHaveLength(2);
    openFilters();
    fireEvent.click(screen.getByRole('button', { name: 'Féminine' }));
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.queryByText('Mixte Club')).not.toBeInTheDocument();
  });

  it('badge « Filtres · N » + « Effacer » réapparaît sur un filtre actif et le réinitialise', () => {
    wrap({
      matches: [
        makeMatch({ id: 'c', competitive: true }),
        makeMatch({ id: 'f', competitive: false, club: { ...makeMatch().club, name: 'Fun Club' } }),
      ],
    });
    expect(screen.queryByRole('button', { name: 'Effacer' })).not.toBeInTheDocument();
    openFilters();
    fireEvent.click(screen.getByRole('button', { name: 'Pour le fun' }));
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /^Filtres/ }).textContent).toContain('1');
    fireEvent.click(screen.getByRole('button', { name: 'Effacer' }));
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Effacer' })).not.toBeInTheDocument();
  });

  it('chip Aujourd\'hui filtre les parties hors de la journée', () => {
    wrap({
      now: NOW,
      matches: [
        makeMatch({ id: 'today', startTime: '2026-07-08T16:00:00.000Z', endTime: '2026-07-08T17:00:00.000Z' }),
        makeMatch({ id: 'later', club: { ...makeMatch().club, name: 'Club plus tard' }, startTime: '2026-07-15T16:00:00.000Z', endTime: '2026-07-15T17:00:00.000Z' }),
      ],
    });
    expect(screen.getAllByRole('link')).toHaveLength(2);
    openFilters();
    fireEvent.click(screen.getByRole('button', { name: 'Aujourd\'hui' }));
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.queryByText('Club plus tard')).not.toBeInTheDocument();
  });

  it('location.city filtre par ville', () => {
    wrap({
      location: { city: 'lyon', deptCodes: [] },
      matches: [
        makeMatch({ id: 'paris', club: { ...makeMatch().club, name: 'Club Paris', city: 'Paris' } }),
        makeMatch({ id: 'lyon', club: { ...makeMatch().club, name: 'Club Lyon', city: 'Lyon' } }),
      ],
    });
    expect(screen.getByText('Club Lyon')).toBeInTheDocument();
    expect(screen.queryByText('Club Paris')).not.toBeInTheDocument();
  });

  it('location.deptCodes filtre par code département', async () => {
    const matchParis = makeMatch({
      id: 'paris',
      club: { ...makeMatch().club, name: 'Padel Paris', city: 'Paris', departmentCode: '75' },
    });
    const matchLyon = makeMatch({
      id: 'lyon',
      club: { ...makeMatch().club, name: 'Padel Lyon', city: 'Lyon', departmentCode: '69' },
    });
    wrap({ matches: [matchParis, matchLyon], location: { city: null, deptCodes: ['69'] } });
    expect(await screen.findByText('Padel Lyon')).toBeInTheDocument();
    expect(screen.queryByText('Padel Paris')).not.toBeInTheDocument();
  });

  it('onCount reçoit le nombre de cartes affichées', async () => {
    const onCount = jest.fn();
    const matchParis = makeMatch({
      id: 'paris',
      club: { ...makeMatch().club, name: 'Padel Paris', city: 'Paris', departmentCode: '75' },
    });
    const matchLyon = makeMatch({
      id: 'lyon',
      club: { ...makeMatch().club, name: 'Padel Lyon', city: 'Lyon', departmentCode: '69' },
    });
    wrap({ matches: [matchParis, matchLyon], location: { city: null, deptCodes: [] }, onCount });
    await screen.findByText('Padel Paris');
    expect(onCount).toHaveBeenLastCalledWith(2);
  });

  it('coords Paris trie Paris avant Lyon et affiche la distance', () => {
    wrap({
      coords: { lat: 48.8566, lng: 2.3522 }, // Paris
      matches: [
        makeMatch({
          id: 'lyon',
          club: { slug: 'club-lyon', name: 'Club Lyon', city: 'Lyon', timezone: 'Europe/Paris', accentColor: '#5e93da', logoUrl: null, latitude: 45.7640, longitude: 4.8357, department: null, departmentCode: null },
        }),
        makeMatch({
          id: 'paris',
          club: { slug: 'club-paris', name: 'Club Paris', city: 'Paris', timezone: 'Europe/Paris', accentColor: '#5e93da', logoUrl: null, latitude: 48.8566, longitude: 2.3522, department: null, departmentCode: null },
        }),
      ],
    });
    const clubNames = screen.getAllByText(/^Club (Lyon|Paris)$/).map((el) => el.textContent);
    expect(clubNames).toEqual(['Club Paris', 'Club Lyon']);
    // Paris à ~0km, Lyon à ~390km : au moins une mention de distance en km.
    expect(screen.getAllByText(/km$/).length).toBeGreaterThan(0);
  });

  it('anonyme : pas de chip « À mon niveau » et getMyRating jamais appelé', () => {
    authToken = null;
    wrap();
    openFilters();
    expect(screen.queryByRole('button', { name: 'À mon niveau' })).not.toBeInTheDocument();
    expect(getMyRating).not.toHaveBeenCalled();
  });

  it('connecté (niveau 6.2) : chip présente, au clic filtre par niveau', async () => {
    authToken = 'tok';
    getMyRating.mockResolvedValue(makeRating({ level: 6.2 }));
    wrap({
      matches: [
        makeMatch({ id: 'inrange', club: { ...makeMatch().club, name: 'Club dans la fourchette' }, targetLevelMin: 5, targetLevelMax: 7 }),
        makeMatch({ id: 'outrange', club: { ...makeMatch().club, name: 'Club hors fourchette' }, targetLevelMin: 1, targetLevelMax: 2 }),
        makeMatch({ id: 'open', club: { ...makeMatch().club, name: 'Club ouvert à tous' }, targetLevelMin: null, targetLevelMax: null }),
      ],
    });

    await waitFor(() => expect(getMyRating).toHaveBeenCalledWith('tok', 'padel'));
    openFilters();
    const levelChip = await screen.findByRole('button', { name: 'À mon niveau' });

    // Avant le clic : les 3 parties sont visibles.
    expect(screen.getByText('Club hors fourchette')).toBeInTheDocument();

    fireEvent.click(levelChip);

    expect(screen.queryByText('Club hors fourchette')).not.toBeInTheDocument();
    expect(screen.getByText('Club dans la fourchette')).toBeInTheDocument();
    expect(screen.getByText('Club ouvert à tous')).toBeInTheDocument();
  });

  it('état vide : bouton « Voir les clubs » appelle onSeeClubs', () => {
    const onSeeClubs = jest.fn();
    wrap({ matches: [], onSeeClubs });
    const btn = screen.getByRole('button', { name: /Voir les clubs/ });
    fireEvent.click(btn);
    expect(onSeeClubs).toHaveBeenCalledTimes(1);
  });

  it('plafonne l\u2019affichage à 9 cartes même avec plus de parties disponibles', async () => {
    const onCount = jest.fn();
    const many = Array.from({ length: 15 }, (_, i) =>
      makeMatch({ id: `m${i}`, club: { ...makeMatch().club, name: `Club ${i}` } }),
    );
    wrap({ matches: many, onCount });
    await waitFor(() => expect(onCount).toHaveBeenLastCalledWith(9));
    expect(screen.getAllByRole('link')).toHaveLength(9);
  });

  it('affiche le compteur de résultats', async () => {
    wrap({ matches: [makeMatch({ id: 'm1' }), makeMatch({ id: 'm2', club: { ...makeMatch().club, name: 'Autre club' } })] });
    expect(await screen.findByText('2 parties')).toBeInTheDocument();
  });

  it('matches null → Chargement…', () => {
    wrap({ matches: null });
    expect(screen.getByText('Chargement…')).toBeInTheDocument();
  });

  it('now null → Chargement…', () => {
    wrap({ now: null });
    expect(screen.getByText('Chargement…')).toBeInTheDocument();
  });

  it('les filtres sont mémorisés entre montages (restaurés depuis localStorage, tiroir replié)', async () => {
    const twoMatches = () => [
      makeMatch({ id: 'c', competitive: true }),
      makeMatch({ id: 'f', competitive: false, club: { ...makeMatch().club, name: 'Fun Club' } }),
    ];
    const first = wrap({ matches: twoMatches() });
    openFilters();
    fireEvent.click(screen.getByRole('button', { name: 'Pour le fun' }));
    expect(screen.getAllByRole('link')).toHaveLength(1);
    first.unmount();

    wrap({ matches: twoMatches() });
    await waitFor(() => expect(screen.getAllByRole('link')).toHaveLength(1)); // filtre restauré, tiroir fermé
    expect(screen.getByRole('button', { name: /^Filtres/ }).textContent).toContain('1');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/DiscoverMatches.test.tsx`
Expected: FAIL — several tests fail because the drawer is currently always open (the `openFilters()` calls hit a `Filtres` button that doesn't exist yet), and the persistence/badge tests fail because the feature isn't implemented.

- [ ] **Step 3: Implement the component changes**

Replace the entire content of `frontend/components/discover/DiscoverMatches.tsx` with:

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { api, NationalOpenMatch, MyRating } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useTheme } from '@/lib/ThemeProvider';
import { FacetChip, FacetGroup, FILTER_TINTS } from '@/components/ui/FacetChip';
import { FiltersToggle } from '@/components/ui/FiltersToggle';
import { OpenMatchRailCard } from '@/components/match/OpenMatchRailCard';
import { clubUrl } from '@/lib/clubUrl';
import {
  filterNationalMatches, sortMatchesByDistance, LocationQuery, PartiesKind, PartiesGender,
  DISCOVER_PARTIES_FILTERS_KEY, partiesStateToStored, storedToPartiesState, partiesFilterCount,
} from '@/lib/discover';
import { DatePreset, DATE_PRESETS } from '@/lib/tournamentCalendar';
import { DateRangeChip } from '@/components/calendar/DateRangeChip';
import { AgendaRail } from '@/components/agenda/AgendaRail';

// Rail de découverte, pas un flux exhaustif : on plafonne l'affichage (comme les autres
// rails de la vitrine — OpenMatchesShowcase à 6, UpcomingTournaments à 4).
const MAX_VISIBLE = 9;

// Onglet « Parties » de la page /decouvrir : étagère 2 lignes de parties ouvertes nationales
// (GET /api/open-matches/national, chargées par le parent) filtrées par date/localisation/
// niveau et triées par distance. Le sélecteur de date (puces Aujourd'hui/Cette semaine/Ce
// mois-ci + calendrier « Dates ») est EXACTEMENT celui de la section Tournois (DATE_PRESETS/
// DateRangeChip partagés, cf. lib/tournamentCalendar.ts) — un seul sélecteur, pas deux
// comportements sous un même nom. Le tiroir de facettes est REPLIÉ PAR DÉFAUT (même bouton
// partagé `FiltersToggle` que la section Tournois) et les filtres sont MÉMORISÉS d'une
// session à l'autre (localStorage, `DISCOVER_PARTIES_FILTERS_KEY`). Pur côté données —
// `matches`/`location`/`coords`/`now` arrivent en props, l'état de date/niveau est local à
// ce composant. `onCount` (optionnel) reporte au parent le nombre de cartes affichées après
// filtrage — pas appelé tant que `matches`/`now` ne sont pas chargés (compteur inconnu).
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [datePreset, setDatePreset] = useState<DatePreset | null>(null);
  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const [dateTo, setDateTo] = useState<string | null>(null);
  const [kind, setKind] = useState<PartiesKind>('all');
  const [gender, setGender] = useState<PartiesGender>('all');
  const [levelOn, setLevelOn] = useState(false);
  const [rating, setRating] = useState<MyRating | null>(null);

  useEffect(() => {
    if (!token) { setRating(null); return; }
    api.getMyRating(token, 'padel').then(setRating).catch(() => setRating(null));
  }, [token]);

  // Restauration des filtres (une fois, au montage) — mémoire de session.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DISCOVER_PARTIES_FILTERS_KEY);
      if (raw) {
        const s = storedToPartiesState(JSON.parse(raw));
        setDatePreset(s.quand); setDateFrom(s.from); setDateTo(s.to);
        setKind(s.type); setGender(s.genre); setLevelOn(s.niveau);
      }
    } catch { /* stockage indisponible (mode privé/quota) : état par défaut */ }
  }, []);

  // Mémorisation (après restauration — le 1ᵉʳ passage est sauté, sinon on écrirait l'état
  // par défaut avant que la restauration n'ait pris effet).
  const wroteFiltersOnce = useRef(false);
  useEffect(() => {
    if (!wroteFiltersOnce.current) { wroteFiltersOnce.current = true; return; }
    try {
      localStorage.setItem(DISCOVER_PARTIES_FILTERS_KEY, JSON.stringify(
        partiesStateToStored({ datePreset, dateFrom, dateTo, kind, gender, levelOn }),
      ));
    } catch { /* stockage indisponible */ }
  }, [datePreset, dateFrom, dateTo, kind, gender, levelOn]);

  const levelChipVisible = Boolean(token) && rating?.level != null;
  const myLevel = levelChipVisible && levelOn ? rating!.level : null;

  // `ranked` reste `null` tant que `matches`/`now` ne sont pas chargés (compteur inconnu) —
  // calculé AVANT les hooks ci-dessous pour respecter les règles des hooks (ils doivent être
  // appelés à chaque rendu, jamais conditionnellement, donc avant l'early return plus bas).
  const ranked = matches != null && now != null
    ? sortMatchesByDistance(filterNationalMatches(matches, { datePreset, dateFrom, dateTo, kind, gender, location, myLevel }, now), coords).slice(0, MAX_VISIBLE)
    : null;

  useEffect(() => {
    if (ranked) onCount?.(ranked.length);
  }, [ranked?.length, onCount]);

  if (matches == null || now == null) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', fontFamily: th.fontUI, color: th.textMute }}>
        Chargement…
      </div>
    );
  }

  const list = ranked ?? [];
  const count = `${list.length} partie${list.length > 1 ? 's' : ''}`;
  const filterCount = partiesFilterCount({ datePreset, dateFrom, dateTo, kind, gender, levelOn, levelChipVisible });
  const resetFilters = () => {
    setDatePreset(null); setDateFrom(null); setDateTo(null); setKind('all'); setGender('all'); setLevelOn(false);
  };

  return (
    <>
      <FiltersToggle count={filterCount} open={filtersOpen} onToggle={() => setFiltersOpen((o) => !o)} onClear={resetFilters} controlsId="parties-facets" />
      {filtersOpen && (
        <div id="parties-facets" style={{ padding: '4px 20px 0' }}>
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
              <FacetGroup label="Type de partie" tint={FILTER_TINTS.typePartie}>
                <FacetChip label="Toutes" tint={FILTER_TINTS.typePartie} active={kind === 'all'} onClick={() => setKind('all')} />
                <FacetChip label="Pour de vrai" tint={FILTER_TINTS.typePartie} active={kind === 'competitive'} onClick={() => setKind('competitive')} />
                <FacetChip label="Pour le fun" tint={FILTER_TINTS.typePartie} active={kind === 'friendly'} onClick={() => setKind('friendly')} />
              </FacetGroup>
              <FacetGroup label="Genre" tint={FILTER_TINTS.genre}>
                <FacetChip label="Tous" tint={FILTER_TINTS.genre} active={gender === 'all'} onClick={() => setGender('all')} />
                <FacetChip label="Féminine" tint={FILTER_TINTS.genre} active={gender === 'WOMEN'} onClick={() => setGender('WOMEN')} />
                <FacetChip label="Mixte" tint={FILTER_TINTS.genre} active={gender === 'MIXED'} onClick={() => setGender('MIXED')} />
              </FacetGroup>
              {levelChipVisible && (
                <FacetGroup label="Niveau" tint={FILTER_TINTS.niveau}>
                  <FacetChip label="À mon niveau" tint={FILTER_TINTS.niveau} active={levelOn} onClick={() => setLevelOn((v) => !v)} />
                </FacetGroup>
              )}
            </div>
          </div>
        </div>
      )}

      <div style={{ padding: '18px 20px 0' }}>
        {list.length === 0 ? (
          <div style={{ padding: '18px 0 6px', textAlign: 'center', fontFamily: th.fontUI, color: th.textMute }}>
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
          <AgendaRail countLabel={count} desktopColumns="272px" mobileColumns="272px" desktopRows={1}
            prevLabel="Parties précédentes" nextLabel="Parties suivantes">
            {list.map((r) => (
              <OpenMatchRailCard key={r.match.id} match={r.match} club={r.match.club} distanceKm={r.distanceKm}
                timezone={r.match.club.timezone} href={clubUrl(r.match.club.slug, `/parties/${r.match.id}`)} />
            ))}
          </AgendaRail>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/DiscoverMatches.test.tsx`
Expected: PASS — all tests green.

- [ ] **Step 5: Type-check**

Run: `node node_modules/typescript/bin/tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/discover/DiscoverMatches.tsx frontend/__tests__/DiscoverMatches.test.tsx
git commit -m "feat(decouvrir): Parties — tiroir de filtres replié par défaut + mémorisation"
```

---

### Task 6: `ClubDirectory.tsx` (Clubs) — controlled-mode drawer + persistence + 272px cards

**Files:**
- Modify: `frontend/components/ClubDirectory.tsx`
- Test: `frontend/__tests__/ClubDirectory.test.tsx`

- [ ] **Step 1: Add `localStorage.clear()` to `beforeEach`**

In `frontend/__tests__/ClubDirectory.test.tsx`, change:

```tsx
beforeEach(() => {
  jest.clearAllMocks();
  authToken = 'tok';
  getSports.mockResolvedValue(sports);
  listClubs.mockResolvedValue([]);
  getMyProfile.mockResolvedValue({
```

to:

```tsx
beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear(); // les filtres du mode contrôlé persistent en localStorage → sinon fuite entre tests
  authToken = 'tok';
  getSports.mockResolvedValue(sports);
  listClubs.mockResolvedValue([]);
  getMyProfile.mockResolvedValue({
```

- [ ] **Step 2: Update the existing controlled-mode test**

Replace the test `'mode contrôlé (props city/coords) : transmet les valeurs à listClubs et masque ville + géoloc'` (currently asserting `screen.getByPlaceholderText('Nom du club')` is present without opening any drawer) with:

```tsx
it('mode contrôlé (props city/coords) : transmet les valeurs à listClubs, masque ville + géoloc, champ nom replié derrière Filtres', async () => {
  authToken = null; // simplifie : pas de filtre sport asynchrone en plus
  render(
    <ThemeProvider>
      <ClubDirectory city="Lyon" coords={{ lat: 45.75, lng: 4.85 }} />
    </ThemeProvider>,
  );

  await waitFor(() =>
    expect(listClubs).toHaveBeenCalledWith(
      expect.objectContaining({ city: 'Lyon', lat: 45.75, lng: 4.85 }),
    ),
  );

  expect(screen.queryByPlaceholderText('Ville ou région')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /autour de moi/i })).not.toBeInTheDocument();
  // Le champ « Nom du club » est replié derrière le bouton « Filtres » (fermé par défaut).
  expect(screen.queryByPlaceholderText('Nom du club')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^Filtres/ }));
  expect(screen.getByPlaceholderText('Nom du club')).toBeInTheDocument();
});
```

- [ ] **Step 3: Append new tests for the controlled-mode filter drawer**

Append this `describe` block at the very end of the file (after the last existing `it(...)`):

```tsx
describe('mode contrôlé : filtres repliables + mémorisés (page /decouvrir)', () => {
  beforeEach(() => { authToken = null; listClubs.mockResolvedValue([]); });

  it('badge « Filtres · N » reflète nom + sport', async () => {
    render(<ThemeProvider><ClubDirectory city="Lyon" /></ThemeProvider>);
    await waitFor(() => expect(listClubs).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /^Filtres/ }));
    expect(screen.getByRole('button', { name: /^Filtres/ }).textContent).not.toMatch(/\d/);
    fireEvent.change(screen.getByPlaceholderText('Nom du club'), { target: { value: 'Padel' } });
    expect(screen.getByRole('button', { name: /^Filtres/ }).textContent).toContain('1');
    fireEvent.click(await screen.findByRole('button', { name: 'Padel' })); // chip sport (fixture `sports`)
    expect(screen.getByRole('button', { name: /^Filtres/ }).textContent).toContain('2');
  });

  it('« Effacer » (à côté du bouton Filtres) vide nom + sport', async () => {
    render(<ThemeProvider><ClubDirectory city="Lyon" /></ThemeProvider>);
    await waitFor(() => expect(listClubs).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /^Filtres/ }));
    fireEvent.change(screen.getByPlaceholderText('Nom du club'), { target: { value: 'Padel' } });
    expect(screen.getByRole('button', { name: 'Effacer' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Effacer' }));
    expect((screen.getByPlaceholderText('Nom du club') as HTMLInputElement).value).toBe('');
    expect(screen.queryByRole('button', { name: 'Effacer' })).not.toBeInTheDocument();
  });

  it('les filtres se mémorisent entre montages (nom du club)', async () => {
    const first = render(<ThemeProvider><ClubDirectory city="Lyon" /></ThemeProvider>);
    await waitFor(() => expect(listClubs).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /^Filtres/ }));
    fireEvent.change(screen.getByPlaceholderText('Nom du club'), { target: { value: 'Padel Club' } });
    await waitFor(() => expect(listClubs).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'Padel Club' })));
    first.unmount();

    render(<ThemeProvider><ClubDirectory city="Lyon" /></ThemeProvider>);
    await waitFor(() => expect(listClubs).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'Padel Club' })));
    expect(screen.getByRole('button', { name: /^Filtres/ }).textContent).toContain('1'); // tiroir fermé, badge restauré
  });

  it('une mémoire de filtres existante saute le pré-remplissage du sport préféré', async () => {
    authToken = 'tok';
    getMyProfile.mockResolvedValue({
      id: 'u1', email: 'test@palova.fr', firstName: 'Test', lastName: 'User',
      phone: null, sex: null, birthDate: null, avatarUrl: null, locale: 'fr',
      isSuperAdmin: false, showInLeaderboard: false,
      preferredSport: { id: 's2', key: 'tennis', name: 'Tennis' },
    });
    localStorage.setItem('palova:discover-clubs-filters', JSON.stringify({ q: '', sport: '' }));
    render(<ThemeProvider><ClubDirectory city="Lyon" /></ThemeProvider>);
    await waitFor(() => expect(listClubs).toHaveBeenCalled());
    // Le sport préféré (tennis) n'est JAMAIS forcé : toutes les invocations gardent sport vide.
    const calls = listClubs.mock.calls as [{ sport?: string }][];
    calls.forEach((args) => expect(args[0].sport).toBeUndefined());
  });

  it('les cartes utilisent le rail compact 272px, comme les cartes de parties', async () => {
    listClubs.mockResolvedValue([clubFixture]);
    const { container } = render(<ThemeProvider><ClubDirectory city="Lyon" /></ThemeProvider>);
    await waitFor(() => expect(screen.getAllByTestId('club-card')).toHaveLength(1));
    const rail = container.querySelector('.ag-rail') as HTMLElement;
    expect(rail.style.getPropertyValue('--ag-cols')).toBe('272px');
    expect(rail.style.getPropertyValue('--ag-mobile-cols')).toBe('272px');
  });

  it('mode autonome (vitrine anonyme) : recherche toujours visible, rail large inchangé', async () => {
    listClubs.mockResolvedValue([clubFixture]);
    const { container } = render(<ThemeProvider><ClubDirectory /></ThemeProvider>);
    await waitFor(() => expect(screen.getAllByTestId('club-card')).toHaveLength(1));
    expect(screen.queryByRole('button', { name: /^Filtres/ })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Nom du club')).toBeInTheDocument();
    const rail = container.querySelector('.ag-rail') as HTMLElement;
    expect(rail.style.getPropertyValue('--ag-cols')).toBe('calc((100% - 24px) / 3)');
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/ClubDirectory.test.tsx`
Expected: FAIL — the updated controlled-mode test and all new tests fail (no `FiltersToggle` button exists yet, `Nom du club` is currently always visible, no persistence, no 272px rail).

- [ ] **Step 5: Implement the component changes**

Replace the entire content of `frontend/components/ClubDirectory.tsx` with:

```tsx
'use client';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { api, ClubSummary, Sport } from '@/lib/api';
import { COVER_PHOTOS } from '@/lib/clubCover';
import { useTheme } from '@/lib/ThemeProvider';
import { useAuth } from '@/lib/useAuth';
import { ClubCard } from '@/components/ClubCard';
import { AgendaRail } from '@/components/agenda/AgendaRail';
import { Icon } from '@/components/ui/Icon';
import { FiltersToggle } from '@/components/ui/FiltersToggle';
import { DISCOVER_CLUBS_FILTERS_KEY, clubsStateToStored, storedToClubsFilters } from '@/lib/discover';

// Moteur de recherche d'annuaire (nom / ville / sport) + grille de résultats.
// Bloc embeddable : ne rend QUE la recherche + les résultats (pas de Screen ni de titre de page),
// pour être réutilisé sur /clubs comme sur l'accueil plateforme.
// Mode contrôlé (props city/coords, page /decouvrir) : la page porte une barre de localisation
// PARTAGÉE (ville + géoloc) au-dessus — le composant masque ses propres contrôles de
// localisation ; le champ « Nom du club » + les chips sport passent alors derrière un tiroir
// repliable « Filtres · N » (mémorisé en localStorage) et les cartes utilisent le rail compact
// 272px (comme les cartes de parties). La vitrine anonyme (mode autonome) garde sa recherche
// toujours visible, ses cartes larges, et ne mémorise rien.
export function ClubDirectory({ city: cityProp, coords: coordsProp, deptCodes, onlySlugs, onCount }: { city?: string; coords?: { lat: number; lng: number } | null; deptCodes?: string[]; onlySlugs?: Set<string> | null; onCount?: (n: number) => void } = {}) {
  const { th } = useTheme();
  const { token } = useAuth();
  const [sports, setSports] = useState<Sport[]>([]);
  const [clubs, setClubs]   = useState<ClubSummary[]>([]);
  const [q, setQ]           = useState('');
  const [cityInput, setCityInput] = useState('');
  const [sport, setSport]   = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [coordsInput, setCoordsInput] = useState<{ lat: number; lng: number } | null>(null);
  const [geoState, setGeoState] = useState<'idle' | 'locating' | 'denied'>('idle');
  const [filtersOpen, setFiltersOpen] = useState(false);

  const controlled = cityProp !== undefined || coordsProp !== undefined || deptCodes !== undefined;
  const effCity = controlled ? (cityProp ?? '') : cityInput;
  const effCoords = controlled ? (coordsProp ?? null) : coordsInput;

  useEffect(() => { api.getSports().then(setSports).catch(() => setSports([])); }, []);

  // Restauration des filtres (mode contrôlé seulement — la vitrine anonyme ne mémorise rien).
  // Déclarée AVANT l'effet de pré-sélection du sport préféré ci-dessous : une entrée stockée
  // (même vide) doit empêcher ce dernier de forcer un sport (sinon impossible de mémoriser
  // le choix « Tous »).
  const skipSportPreselect = useRef(false);
  useEffect(() => {
    if (!controlled) return;
    try {
      const raw = localStorage.getItem(DISCOVER_CLUBS_FILTERS_KEY);
      if (raw != null) {
        skipSportPreselect.current = true;
        const s = storedToClubsFilters(JSON.parse(raw));
        setQ(s.q); setSport(s.sport);
      }
    } catch { /* stockage indisponible (mode privé/quota) : état par défaut */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pré-sélectionne le sport préféré du joueur connecté (modifiable librement ensuite) — sauté
  // si une mémoire de filtres existe déjà (mode contrôlé), pour ne jamais écraser un choix
  // explicite restauré depuis le stockage.
  useEffect(() => {
    if (!token) return;
    if (skipSportPreselect.current) return;
    api.getMyProfile(token).then((p) => {
      if (p.preferredSport?.key) setSport((cur) => cur || p.preferredSport!.key);
    }).catch(() => {});
  }, [token]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.listClubs({
        q: q || undefined, city: effCity || undefined, sport: sport || undefined,
        ...(effCoords ? { lat: effCoords.lat, lng: effCoords.lng } : {}),
        ...(deptCodes && deptCodes.length ? { dept: deptCodes } : {}),
      });
      setClubs(list);
      setError(false);
    } catch { setClubs([]); setError(true); }
    finally { setLoading(false); }
  }, [q, effCity, effCoords, sport, deptCodes?.join(',')]);

  // Mémorisation des filtres (mode contrôlé seulement), après la restauration (le 1ᵉʳ passage
  // est sauté — sinon on écrirait l'état par défaut avant que la restauration n'ait pris effet).
  const wroteClubFiltersOnce = useRef(false);
  useEffect(() => {
    if (!controlled) return;
    if (!wroteClubFiltersOnce.current) { wroteClubFiltersOnce.current = true; return; }
    try { localStorage.setItem(DISCOVER_CLUBS_FILTERS_KEY, JSON.stringify(clubsStateToStored({ q, sport }))); } catch { /* stockage indisponible */ }
  }, [controlled, q, sport]);

  // Rétrécit les clubs déjà chargés par slug (filtre « Mes clubs » posé par /decouvrir) —
  // purement côté client, `onlySlugs` reste hors des deps de `load()` : basculer le filtre ne
  // redéclenche jamais `listClubs`.
  const visibleClubs = useMemo(
    () => (onlySlugs ? clubs.filter((c) => onlySlugs.has(c.slug)) : clubs),
    [clubs, onlySlugs],
  );

  // Notifie le parent du nombre de clubs affichés — effet DÉDIÉ, découplé de `load` (dont
  // l'identité pilote le debounce de fetch) pour qu'un changement d'identité de `onCount`
  // ne relance jamais le fetch. `visibleClubs` reflète déjà le résultat (y compris `[]` sur erreur).
  useEffect(() => { onCount?.(visibleClubs.length); }, [visibleClubs.length, onCount]);

  const locateMe = () => {
    if (!navigator.geolocation) { setGeoState('denied'); return; }
    setGeoState('locating');
    navigator.geolocation.getCurrentPosition(
      (p) => { setCoordsInput({ lat: p.coords.latitude, lng: p.coords.longitude }); setGeoState('idle'); },
      () => setGeoState('denied'),
      { timeout: 8000 },
    );
  };

  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);

  const inputStyle = { flex: 1, minWidth: 0, height: 46, padding: '0 14px', borderRadius: 12, background: th.surface, color: th.text, border: 'none', boxShadow: `inset 0 0 0 1.5px ${th.line}`, fontFamily: th.fontUI, fontSize: 15 } as const;

  // Filtres propres à l'annuaire (la localisation en mode contrôlé vient de la barre partagée,
  // réinitialisée à part) : nom + sport, plus ville/géoloc en mode autonome (/clubs).
  const clubFiltersActive = !!q || !!sport || (!controlled && (!!cityInput || !!coordsInput));
  const clubsFilterCount = (q ? 1 : 0) + (sport ? 1 : 0);
  const resetClubFilters = () => {
    setQ(''); setSport('');
    if (!controlled) { setCityInput(''); setCoordsInput(null); setGeoState('idle'); }
  };

  return (
    <>
      {controlled ? (
        <>
          <FiltersToggle count={clubsFilterCount} open={filtersOpen} onToggle={() => setFiltersOpen((o) => !o)} onClear={resetClubFilters} controlsId="clubs-facets" />
          {filtersOpen && (
            <div id="clubs-facets" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 20px 0' }}>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom du club" style={inputStyle} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <button onClick={() => setSport('')} style={chipBtn(th, sport === '')}>Tous</button>
                {sports.map((s) => (
                  <button key={s.key} onClick={() => setSport(sport === s.key ? '' : s.key)} style={chipBtn(th, sport === s.key)}>
                    {s.icon ? `${s.icon} ` : ''}{s.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '18px 20px 0' }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom du club" style={inputStyle} />
            <input value={cityInput} onChange={(e) => setCityInput(e.target.value)} placeholder="Ville ou région" style={inputStyle} />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <button onClick={() => setSport('')} style={chipBtn(th, sport === '')}>Tous</button>
            {sports.map((s) => (
              <button key={s.key} onClick={() => setSport(sport === s.key ? '' : s.key)} style={chipBtn(th, sport === s.key)}>
                {s.icon ? `${s.icon} ` : ''}{s.name}
              </button>
            ))}
            {clubFiltersActive && (
              <button onClick={resetClubFilters} style={{
                marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none', cursor: 'pointer',
                borderRadius: 999, padding: '6px 12px', background: 'transparent', boxShadow: `inset 0 0 0 1px ${th.lineStrong}`,
                fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.textMute,
              }}>
                <Icon name="x" size={12} color={th.textMute} />Effacer les filtres
              </button>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button onClick={locateMe} style={chipBtn(th, !!coordsInput)}>
              📍 {coordsInput ? 'Autour de moi ✓' : geoState === 'locating' ? 'Localisation…' : 'Autour de moi'}
            </button>
            {geoState === 'denied' && (
              <span style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textFaint }}>
                Localisation indisponible — cherchez par ville ou région.
              </span>
            )}
          </div>
        </div>
      )}

      {/* résultats — rail partagé AgendaRail (1 rangée) : c'est un vrai annuaire (recherche +
          filtres), aucun plafond de résultats — tout résultat filtré reste atteignable via
          le défilement (les points de pagination du rail se masquent au-delà de 12 cartes).
          Mode contrôlé (/decouvrir) : cartes compactes 272px, comme les cartes de parties. */}
      <div style={{ padding: '20px 20px 0' }}>
        {loading ? (
          <div style={{ padding: '30px 0', textAlign: 'center', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>
        ) : error ? (
          <div style={{ padding: '30px 0', textAlign: 'center', fontFamily: th.fontUI, color: th.textMute }}>
            Impossible de charger les clubs pour le moment.
            <div style={{ marginTop: 10 }}>
              <button onClick={load} style={{ border: 'none', background: th.accent, color: th.onAccent, borderRadius: 999, padding: '8px 16px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700 }}>Réessayer</button>
            </div>
          </div>
        ) : visibleClubs.length === 0 ? (
          <div style={{ padding: '30px 0', textAlign: 'center', fontFamily: th.fontUI, color: th.textMute }}>Aucun club ne correspond.</div>
        ) : (
          <AgendaRail
            countLabel={`${visibleClubs.length} club${visibleClubs.length > 1 ? 's' : ''}`}
            desktopColumns={controlled ? '272px' : 'calc((100% - 24px) / 3)'} desktopRows={1}
            mobileColumns={controlled ? '272px' : undefined}
            prevLabel="Clubs précédents" nextLabel="Clubs suivants"
          >
            {visibleClubs.map((c, i) => <ClubCard key={c.id} club={c} defaultCover={COVER_PHOTOS[i % COVER_PHOTOS.length]} />)}
          </AgendaRail>
        )}
      </div>
    </>
  );
}

function chipBtn(th: ReturnType<typeof useTheme>['th'], active: boolean): React.CSSProperties {
  return {
    flexShrink: 0, border: 'none', cursor: 'pointer', borderRadius: 10, padding: '8px 14px',
    fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap',
    background: active ? th.ink : th.surface2,
    color: active ? (th.mode === 'floodlit' ? th.text : '#f7f5ee') : th.textMute,
  };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/ClubDirectory.test.tsx`
Expected: PASS — all tests green (existing + new).

- [ ] **Step 7: Type-check**

Run: `node node_modules/typescript/bin/tsc --noEmit`
Expected: no new errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/components/ClubDirectory.tsx frontend/__tests__/ClubDirectory.test.tsx
git commit -m "feat(decouvrir): Clubs — tiroir de filtres replié + mémorisation + cartes 272px (mode contrôlé)"
```

---

### Task 7: `DiscoverClient.tsx` — restructure Parties markup + memorize "Mes clubs"

**Files:**
- Modify: `frontend/app/decouvrir/DiscoverClient.tsx`
- Test: `frontend/__tests__/DiscoverPage.test.tsx`

- [ ] **Step 1: Write the failing test**

In `frontend/__tests__/DiscoverPage.test.tsx`, append this test at the end of the `describe('DiscoverPage', ...)` block (before the closing `});`):

```tsx
  it('« Mes clubs » se mémorise entre montages', async () => {
    authToken = 'tok';
    getMyMemberships.mockResolvedValue([membership('lyon')]);
    const first = wrap();
    await screen.findAllByRole('link', { name: /Rejoindre la partie/ });
    const chip = await screen.findByRole('button', { name: 'Mes clubs' });
    fireEvent.click(chip);
    await waitFor(() => expect(chip).toHaveAttribute('aria-pressed', 'true'));
    first.unmount();

    wrap();
    const chip2 = await screen.findByRole('button', { name: 'Mes clubs' });
    await waitFor(() => expect(chip2).toHaveAttribute('aria-pressed', 'true'));
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/DiscoverPage.test.tsx`
Expected: FAIL — the new test fails (`chip2` has `aria-pressed="false"` after remount, since "Mes clubs" isn't memorized yet). All other tests in the file still pass.

- [ ] **Step 3: Implement the changes**

In `frontend/app/decouvrir/DiscoverClient.tsx`, change the import line:

```ts
import { parseLocationQuery, DISCOVER_LOCATION_KEY } from '@/lib/discover';
```

to:

```ts
import { parseLocationQuery, DISCOVER_LOCATION_KEY, DISCOVER_MINE_ONLY_KEY } from '@/lib/discover';
```

Then insert two new effects right after the existing `wroteLocOnce` write-effect block and before the `IntersectionObserver` effect. Change:

```tsx
  // Mémorise le texte de recherche par lieu d'une session à l'autre (le montage est sauté pour
  // ne pas écraser la valeur restaurée avant sa relecture).
  const wroteLocOnce = useRef(false);
  useEffect(() => {
    if (slug) return;
    if (!wroteLocOnce.current) { wroteLocOnce.current = true; return; }
    try { localStorage.setItem(DISCOVER_LOCATION_KEY, locInput); } catch { /* stockage indispo */ }
  }, [slug, locInput]);

  useEffect(() => {
    if (slug) return;
    const io = new IntersectionObserver((entries) => {
```

to:

```tsx
  // Mémorise le texte de recherche par lieu d'une session à l'autre (le montage est sauté pour
  // ne pas écraser la valeur restaurée avant sa relecture).
  const wroteLocOnce = useRef(false);
  useEffect(() => {
    if (slug) return;
    if (!wroteLocOnce.current) { wroteLocOnce.current = true; return; }
    try { localStorage.setItem(DISCOVER_LOCATION_KEY, locInput); } catch { /* stockage indispo */ }
  }, [slug, locInput]);

  // « Mes clubs » mémorisé d'une session à l'autre (comme la recherche par lieu et les filtres
  // Tournois/Parties/Clubs) — ne s'applique, comme aujourd'hui, que si une adhésion active existe.
  useEffect(() => {
    if (slug) return;
    try { if (localStorage.getItem(DISCOVER_MINE_ONLY_KEY) === '1') setMineOnly(true); }
    catch { /* stockage indisponible */ }
  }, [slug]);

  const wroteMineOnlyOnce = useRef(false);
  useEffect(() => {
    if (slug) return;
    if (!wroteMineOnlyOnce.current) { wroteMineOnlyOnce.current = true; return; }
    try { localStorage.setItem(DISCOVER_MINE_ONLY_KEY, mineOnly ? '1' : '0'); } catch { /* stockage indisponible */ }
  }, [slug, mineOnly]);

  useEffect(() => {
    if (slug) return;
    const io = new IntersectionObserver((entries) => {
```

Finally, restructure the Parties `<section>` so `DiscoverMatches` sits OUTSIDE the `padding: '0 20px'` title wrapper — matching the exact same structure already used by the Tournois and Clubs sections (each finder component supplies its own horizontal padding internally, which `DiscoverMatches` now does after Task 5). Change:

```tsx
        <section id="parties" data-section="parties" ref={(el) => { sectionRefs.current.parties = el; }} style={{ paddingTop: 10 }}>
          <div style={{ padding: '0 20px' }}>
            <div style={kickStyle}>{tick}Parties ouvertes</div>
            <h2 style={titleStyle}>Ça joue bientôt</h2>
            <DiscoverMatches matches={filteredMatches} location={location} coords={coords} now={now}
              onSeeClubs={() => jumpTo('clubs')} onCount={onCountParties} />
          </div>
        </section>
```

to:

```tsx
        <section id="parties" data-section="parties" ref={(el) => { sectionRefs.current.parties = el; }} style={{ paddingTop: 10 }}>
          <div style={{ padding: '0 20px' }}>
            <div style={kickStyle}>{tick}Parties ouvertes</div>
            <h2 style={titleStyle}>Ça joue bientôt</h2>
          </div>
          <DiscoverMatches matches={filteredMatches} location={location} coords={coords} now={now}
            onSeeClubs={() => jumpTo('clubs')} onCount={onCountParties} />
        </section>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/DiscoverPage.test.tsx`
Expected: PASS — all tests green, including the new "Mes clubs" persistence test.

- [ ] **Step 5: Type-check**

Run: `node node_modules/typescript/bin/tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/decouvrir/DiscoverClient.tsx frontend/__tests__/DiscoverPage.test.tsx
git commit -m "feat(decouvrir): mémorise « Mes clubs » entre sessions, aligne le markup Parties sur Tournois/Clubs"
```

---

### Task 8: Full verification (type-check, targeted suite, visual check)

**Files:** none (verification only)

- [ ] **Step 1: Full type-check**

Run: `node node_modules/typescript/bin/tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Run every test file touched by this plan, together**

Run:

```bash
node node_modules/jest/bin/jest.js --runTestsByPath __tests__/discover.test.ts __tests__/FiltersToggle.test.tsx __tests__/FacetPanel.test.tsx __tests__/TournamentFinder.test.tsx __tests__/DiscoverMatches.test.tsx __tests__/ClubDirectory.test.tsx __tests__/DiscoverPage.test.tsx __tests__/DiscoverRedirects.test.tsx __tests__/AgendaRail.test.tsx
```

Expected: PASS — all suites green together (catches any cross-file interaction the isolated runs in earlier tasks might have missed).

- [ ] **Step 3: Sanity-check the anonymous landing page directory is untouched**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/AnonymousView.test.tsx`
Expected: PASS — the vitrine anonyme's `ClubDirectory` usage (autonomous mode) is unaffected by this plan.

- [ ] **Step 4: Visual verification**

Invoke the `verify` skill against `/decouvrir` on the platform host, in both light and dark theme, at desktop (1280px) and mobile (390px) widths. Confirm:
- All three sections (Parties, Tournois, Clubs) show the same "⚙ Filtres" repliable bar, closed by default.
- Opening Parties, entering a filter, reloading the page (or navigating away and back) restores the filter and its badge count.
- Opening Clubs, entering a name filter, doing the same, restores it too.
- The Tournois drawer footer shows only "Effacer les filtres" — no "N résultats" text (the single count is the "N tournois" label above the rail).
- Club cards in the Clubs rail are the same width as Parties cards (272px), on both desktop and mobile.
- Toggling "Mes clubs" (when visible — connected + at least one active membership), reloading, and confirming it stays on.
- No horizontal overflow at 390px in either theme.

- [ ] **Step 5: Report status to the user**

Summarize what changed, what was verified, and flag anything that needs a decision (there should be none — this plan is self-contained and 100% frontend, no migration, no backend change).
