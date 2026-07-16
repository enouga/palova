# Parties ouvertes — tiroir de filtres (langage Events) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 5-tier stack of filters at the top of `/parties` (label + always-open slider + kind chips + orphan alert button) with a single filter drawer that matches the visual language of `EventsFilterBar` — labeled chip groups, a collapsible level slider, and a footer row with the result count, alert chips, and the "create alert" action.

**Architecture:** New presentational component `MatchesFilterBar.tsx` owns all the drawer UI and internal disclosure state (slider open/closed); `OpenMatches.tsx` keeps every existing data/filter/alert data flow (fetch, `fMin/fMax`, `kindFilter`, `alerts`, optimistic delete) and simply renders the new component with props instead of the old inline JSX block.

**Tech Stack:** Next.js 16 / React 19 frontend, Jest + React Testing Library, TypeScript. No backend changes.

**Spec:** `docs/superpowers/specs/2026-07-16-parties-filtres-tiroir-design.md`

---

## Task 1: Create `MatchesFilterBar`

**Files:**
- Create: `frontend/components/openmatch/MatchesFilterBar.tsx`
- Test: `frontend/__tests__/MatchesFilterBar.test.tsx`

Presentational component, fully controlled by props. Owns only the local "is the slider expanded" disclosure state.

- [ ] **Step 1: Write the failing test file**

Create `frontend/__tests__/MatchesFilterBar.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { MatchesFilterBar } from '../components/openmatch/MatchesFilterBar';
import { ThemeProvider } from '../lib/ThemeProvider';
import type { MatchAlert } from '../lib/api';

const noop = () => {};

const baseProps = {
  levelEnabled: true,
  authenticated: true,
  myLevel: null as number | null,
  myLevelMin: null as number | null,
  myLevelMax: null as number | null,
  fMin: 1,
  fMax: 8,
  onLevelChange: noop,
  kindFilter: 'all' as const,
  onKindChange: noop,
  resultCount: 0,
  alerts: [] as MatchAlert[],
  timezone: 'Europe/Paris',
  onDeleteAlert: noop,
  onCreateAlert: noop,
};

function renderBar(overrides: Partial<typeof baseProps> = {}) {
  return render(<ThemeProvider><MatchesFilterBar {...baseProps} {...overrides} /></ThemeProvider>);
}

describe('MatchesFilterBar', () => {
  it('affiche les chips Type de partie et notifie au clic', () => {
    const onKindChange = jest.fn();
    renderBar({ onKindChange });
    expect(screen.getByRole('button', { name: 'Toutes' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Compétitives' }));
    expect(onKindChange).toHaveBeenCalledWith('competitive');
    fireEvent.click(screen.getByRole('button', { name: 'Amicales' }));
    expect(onKindChange).toHaveBeenCalledWith('friendly');
  });

  it('affiche le compteur de parties au singulier et au pluriel', () => {
    const { rerender } = renderBar({ resultCount: 1 });
    expect(screen.getByText('1 partie')).toBeInTheDocument();
    rerender(<ThemeProvider><MatchesFilterBar {...baseProps} resultCount={3} /></ThemeProvider>);
    expect(screen.getByText('3 parties')).toBeInTheDocument();
  });

  it('le pied est masqué pour un anonyme sans filtre actif', () => {
    renderBar({ authenticated: false, levelEnabled: false, kindFilter: 'all' });
    expect(screen.queryByTestId('matches-filter-footer')).not.toBeInTheDocument();
  });

  it('le pied apparaît pour un anonyme dès qu\'un filtre Type est actif', () => {
    renderBar({ authenticated: false, levelEnabled: false, kindFilter: 'friendly', resultCount: 2 });
    expect(screen.getByTestId('matches-filter-footer')).toBeInTheDocument();
    expect(screen.getByText('2 parties')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /créer une alerte/i })).not.toBeInTheDocument();
  });

  it('masque le groupe Niveau si le club n\'a pas le système de niveau', () => {
    renderBar({ levelEnabled: false, myLevel: 5, myLevelMin: 4, myLevelMax: 6 });
    expect(screen.queryByRole('button', { name: 'Tous' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Toutes' })).toBeInTheDocument();
  });

  it('masque le groupe Niveau pour un visiteur anonyme', () => {
    renderBar({ authenticated: false, myLevel: 5, myLevelMin: 4, myLevelMax: 6 });
    expect(screen.queryByRole('button', { name: 'Tous' })).not.toBeInTheDocument();
  });

  it('chip « À mon niveau » actif quand la fourchette correspond au préset', () => {
    renderBar({ myLevel: 5, myLevelMin: 4, myLevelMax: 6, fMin: 4, fMax: 6 });
    const chip = screen.getByRole('button', { name: /À mon niveau · 4–6/ });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
  });

  it('« Régler ▾ » déplie et replie le curseur de niveau', () => {
    renderBar({ myLevel: 5, myLevelMin: 4, myLevelMax: 6 });
    expect(screen.queryByLabelText('Niveau minimum')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Régler/ }));
    expect(screen.getByLabelText('Niveau minimum')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Régler/ }));
    expect(screen.queryByLabelText('Niveau minimum')).not.toBeInTheDocument();
  });

  it('fourchette personnalisée : le chip affiche « Niveau x–y » et devient actif', () => {
    renderBar({ myLevel: 5, myLevelMin: 4, myLevelMax: 6, fMin: 3, fMax: 6.5 });
    const chip = screen.getByRole('button', { name: /Niveau 3–6,5/ });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
  });

  it('affiche les chips d\'alertes actives et supprime au clic sur ✕', () => {
    const onDeleteAlert = jest.fn();
    const alerts: MatchAlert[] = [{
      id: 'al1', windowStart: '2026-07-17T16:00:00.000Z', windowEnd: '2026-07-17T19:00:00.000Z',
      targetLevelMin: null, targetLevelMax: null,
    }];
    renderBar({ alerts, onDeleteAlert });
    fireEvent.click(screen.getByRole('button', { name: "Supprimer l'alerte" }));
    expect(onDeleteAlert).toHaveBeenCalledWith('al1');
  });

  it('bouton « Créer une alerte » visible seulement pour un connecté', () => {
    const { rerender } = renderBar({ authenticated: true });
    expect(screen.getByRole('button', { name: /créer une alerte/i })).toBeInTheDocument();
    rerender(<ThemeProvider><MatchesFilterBar {...baseProps} authenticated={false} /></ThemeProvider>);
    expect(screen.queryByRole('button', { name: /créer une alerte/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `frontend/`): `node node_modules/jest/bin/jest.js MatchesFilterBar --config jest.config.js`
Expected: FAIL — `Cannot find module '../components/openmatch/MatchesFilterBar'`

- [ ] **Step 3: Write the component**

Create `frontend/components/openmatch/MatchesFilterBar.tsx`:

```tsx
'use client';
import { useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import type { MatchAlert } from '@/lib/api';
import { Icon } from '@/components/ui/Icon';
import { LevelRangeSlider } from '@/components/player/LevelRangeSlider';
import { fmtLevel } from '@/lib/levelMatch';
import { alertChipLabel } from '@/lib/matchAlerts';

type KindFilter = 'all' | 'competitive' | 'friendly';

// Chip de filtre — actif = encre pleine + coche, inactif = pill fine contourée
// (même langage que FacetChip d'EventsFilterBar).
function Chip({ label, active, onClick, ariaExpanded }: {
  label: string; active: boolean; onClick: () => void; ariaExpanded?: boolean;
}) {
  const { th } = useTheme();
  const fg = active ? (th.mode === 'floodlit' ? th.text : '#f7f5ee') : th.textMute;
  return (
    <button type="button" aria-pressed={active} aria-expanded={ariaExpanded} onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      border: 'none', cursor: 'pointer', borderRadius: 999, padding: '5px 11px',
      fontFamily: th.fontUI, fontSize: 12, fontWeight: active ? 700 : 600,
      background: active ? th.ink : 'transparent', color: fg,
      boxShadow: active ? 'none' : `inset 0 0 0 1px ${th.line}`,
      transition: 'all .15s', WebkitTapHighlightColor: 'transparent',
    }}>
      {active && <Icon name="check" size={11} color={fg} />}
      {label}
    </button>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  const { th } = useTheme();
  return (
    <span style={{
      fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6,
      textTransform: 'uppercase', color: th.textFaint,
    }}>{children}</span>
  );
}

export interface MatchesFilterBarProps {
  levelEnabled: boolean;
  authenticated: boolean;
  myLevel: number | null;
  myLevelMin: number | null;
  myLevelMax: number | null;
  fMin: number;
  fMax: number;
  onLevelChange: (min: number, max: number) => void;
  kindFilter: KindFilter;
  onKindChange: (k: KindFilter) => void;
  resultCount: number;
  alerts: MatchAlert[];
  timezone: string;
  onDeleteAlert: (id: string) => void;
  onCreateAlert: () => void;
}

// Tiroir de filtres de /parties — même langage que la barre Events (EventsFilterBar) :
// groupes labellisés, chips encre pleine, pied avec compteur + alertes.
export function MatchesFilterBar({
  levelEnabled, authenticated, myLevel, myLevelMin, myLevelMax, fMin, fMax, onLevelChange,
  kindFilter, onKindChange, resultCount, alerts, timezone, onDeleteAlert, onCreateAlert,
}: MatchesFilterBarProps) {
  const { th } = useTheme();
  const [sliderOpen, setSliderOpen] = useState(false);

  const showLevelGroup = levelEnabled && authenticated;
  const isDefaultAll = fMin === 1 && fMax === 8;
  const isMyLevel = myLevelMin != null && myLevelMax != null && fMin === myLevelMin && fMax === myLevelMax;
  const isCustom = showLevelGroup && !isDefaultAll && !isMyLevel;
  const arrow = sliderOpen ? '▴' : '▾';
  const adjustLabel = isCustom ? `Niveau ${fmtLevel(fMin)}–${fmtLevel(fMax)} ${arrow}` : `Régler ${arrow}`;

  const hasActiveFilter = kindFilter !== 'all' || (showLevelGroup && (fMin > 1 || fMax < 8));
  const showFooter = authenticated || hasActiveFilter;

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ borderRadius: 16, background: th.bgElev, boxShadow: `inset 0 0 0 1px ${th.line}` }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 26px', padding: '12px 14px' }}>
          {showLevelGroup && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <GroupLabel>Niveau</GroupLabel>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {myLevel != null && myLevelMin != null && myLevelMax != null && (
                  <Chip label={`À mon niveau · ${fmtLevel(myLevelMin)}–${fmtLevel(myLevelMax)}`}
                    active={isMyLevel} onClick={() => onLevelChange(myLevelMin, myLevelMax)} />
                )}
                <Chip label="Tous" active={isDefaultAll} onClick={() => onLevelChange(1, 8)} />
                <Chip label={adjustLabel} active={isCustom} ariaExpanded={sliderOpen}
                  onClick={() => setSliderOpen((v) => !v)} />
              </div>
              {sliderOpen && (
                <div style={{ maxWidth: 430, marginTop: 4 }}>
                  <LevelRangeSlider compact min={fMin} max={fMax} onChange={onLevelChange} />
                </div>
              )}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <GroupLabel>Type de partie</GroupLabel>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <Chip label="Toutes" active={kindFilter === 'all'} onClick={() => onKindChange('all')} />
              <Chip label="Compétitives" active={kindFilter === 'competitive'} onClick={() => onKindChange('competitive')} />
              <Chip label="Amicales" active={kindFilter === 'friendly'} onClick={() => onKindChange('friendly')} />
            </div>
          </div>
        </div>

        {showFooter && (
          <div data-testid="matches-filter-footer" style={{
            display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10,
            padding: '9px 14px', borderTop: `1px solid ${th.line}`,
          }}>
            <span style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, color: th.text }}>
              {resultCount} partie{resultCount > 1 ? 's' : ''}
            </span>
            {alerts.map((al) => (
              <span key={al.id} style={{
                display: 'inline-flex', alignItems: 'center', gap: 8, background: th.surface2,
                borderRadius: 999, padding: '6px 10px 6px 12px', fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute,
              }}>
                {alertChipLabel(al, timezone)}
                <button aria-label="Supprimer l'alerte" onClick={() => onDeleteAlert(al.id)} style={{
                  border: 'none', background: 'transparent', cursor: 'pointer', color: th.textFaint, fontSize: 15, lineHeight: 1,
                }}>✕</button>
              </span>
            ))}
            <span style={{ flex: 1 }} />
            {authenticated && (
              <button onClick={onCreateAlert} style={{
                border: 'none', background: 'transparent', cursor: 'pointer',
                fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, color: th.accent, whiteSpace: 'nowrap',
              }}>
                🔔 Créer une alerte
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `frontend/`): `node node_modules/jest/bin/jest.js MatchesFilterBar --config jest.config.js`
Expected: PASS (12 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/components/openmatch/MatchesFilterBar.tsx frontend/__tests__/MatchesFilterBar.test.tsx
git commit -m "feat(parties): tiroir de filtres MatchesFilterBar (langage Events)"
```

---

## Task 2: Wire `MatchesFilterBar` into `OpenMatches.tsx`

**Files:**
- Modify: `frontend/components/openmatch/OpenMatches.tsx`

This task removes the old 5-tier inline UI and the now-dead `FilterChip`/`atMyLevel`/unused imports, and renders `MatchesFilterBar` instead. No behavior change is expected in `OpenMatches.test.tsx` — same button labels, same data flow — so that suite is the regression gate for this task.

- [ ] **Step 1: Remove unused imports, add the new one**

In `frontend/components/openmatch/OpenMatches.tsx`, delete these three lines entirely (their only use, the local `FilterChip` and the inline slider/alert chips, is migrating into `MatchesFilterBar`):

```tsx
import { Icon } from '@/components/ui/Icon';
```
```tsx
import { LevelRangeSlider } from '@/components/player/LevelRangeSlider';
```
```tsx
import { alertChipLabel } from '@/lib/matchAlerts';
```

Add this import right after the `OpenMatchModals` import:

Old:
```tsx
import { OpenMatchModals } from '@/components/openmatch/OpenMatchModals';
```

New:
```tsx
import { OpenMatchModals } from '@/components/openmatch/OpenMatchModals';
import { MatchesFilterBar } from '@/components/openmatch/MatchesFilterBar';
```

- [ ] **Step 2: Remove the local `FilterChip` function**

Old:
```tsx
// Chip de filtre — même langage que `FacetChip` d'EventsFilterBar (tournois/events) :
// actif = encre pleine + coche, inactif = pill fine contourée.
function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  const { th } = useTheme();
  const fg = active ? (th.mode === 'floodlit' ? th.text : '#f7f5ee') : th.textMute;
  return (
    <button type="button" aria-pressed={active} onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      border: 'none', cursor: 'pointer', borderRadius: 999, padding: '5px 11px',
      fontFamily: th.fontUI, fontSize: 12, fontWeight: active ? 700 : 600,
      background: active ? th.ink : 'transparent', color: fg,
      boxShadow: active ? 'none' : `inset 0 0 0 1px ${th.line}`,
      transition: 'all .15s', WebkitTapHighlightColor: 'transparent',
    }}>
      {active && <Icon name="check" size={11} color={fg} />}
      {label}
    </button>
  );
}

// /parties — découverte des parties ouvertes (PUBLIC) du club : rejoindre / quitter.
```

New:
```tsx
// /parties — découverte des parties ouvertes (PUBLIC) du club : rejoindre / quitter.
```

- [ ] **Step 3: Add `handleDeleteAlert`/`handleCreateAlert` helpers**

Old:
```tsx
  const loadAlerts = useCallback(() => {
    if (!token) { setAlerts([]); return; }
    api.listMyMatchAlerts(club.slug, token).then(setAlerts).catch(() => setAlerts([]));
  }, [token, club.slug]);
  useEffect(() => { loadAlerts(); }, [loadAlerts]);
```

New:
```tsx
  const loadAlerts = useCallback(() => {
    if (!token) { setAlerts([]); return; }
    api.listMyMatchAlerts(club.slug, token).then(setAlerts).catch(() => setAlerts([]));
  }, [token, club.slug]);
  useEffect(() => { loadAlerts(); }, [loadAlerts]);

  const handleDeleteAlert = async (id: string) => {
    if (!token) return;
    setAlerts((xs) => xs.filter((x) => x.id !== id)); // optimiste
    try { await api.deleteMatchAlert(club.slug, id, token); } catch { loadAlerts(); }
  };
  const handleCreateAlert = () => {
    setAlertSheet({ date: new Date().toISOString().slice(0, 10), from: '18:00', to: '21:00' });
  };
```

- [ ] **Step 4: Remove the dead `atMyLevel` variable**

Old:
```tsx
  const levelFilterActive = fMin > 1 || fMax < 8;
  // Fourchette « à mon niveau » (±1 autour du niveau arrondi) — sert à savoir si ce raccourci
  // est la sélection courante, pour le chip « rempli » (même langage que les filtres Events).
  const myLevelMin = myLevel != null ? Math.max(1, Math.round(myLevel) - 1) : null;
  const myLevelMax = myLevel != null ? Math.min(8, Math.round(myLevel) + 1) : null;
  const atMyLevel = myLevelMin != null && fMin === myLevelMin && fMax === myLevelMax;
  const byLevel = levelFilterActive
```

New:
```tsx
  const levelFilterActive = fMin > 1 || fMax < 8;
  // Fourchette « à mon niveau » (±1 autour du niveau arrondi) — passée à MatchesFilterBar
  // pour le chip préset (le composant décide lui-même s'il est actif).
  const myLevelMin = myLevel != null ? Math.max(1, Math.round(myLevel) - 1) : null;
  const myLevelMax = myLevel != null ? Math.min(8, Math.round(myLevel) + 1) : null;
  const byLevel = levelFilterActive
```

- [ ] **Step 5: Replace the h1/p/filters block with `MatchesFilterBar`**

Old:
```tsx
        <div style={{ padding: '18px 20px 0' }}>
          <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 26, color: th.text, margin: 0, letterSpacing: -0.4 }}>Parties ouvertes</h1>
          <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, lineHeight: 1.5, margin: '8px 0 0' }}>
            Rejoignez la partie publique d&apos;un autre membre, ou créez la vôtre en choisissant « Partie ouverte » au moment de réserver.
          </p>
          {levelEnabled && token && (
            <div style={{ marginTop: 14, maxWidth: 430 }}>
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 4 }}>
                <span style={{ fontFamily: th.fontUI, fontSize: 12, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase', color: th.textMute }}>Filtrer par niveau</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  {myLevel != null && myLevelMin != null && myLevelMax != null && (
                    <FilterChip label="À mon niveau" active={atMyLevel}
                      onClick={() => setLevelFilter(myLevelMin, myLevelMax)} />
                  )}
                  <FilterChip label="Tous" active={!levelFilterActive}
                    onClick={() => setLevelFilter(1, 8)} />
                </div>
              </div>
              <LevelRangeSlider compact min={fMin} max={fMax} onChange={setLevelFilter} />
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
            <FilterChip label="Toutes" active={kindFilter === 'all'} onClick={() => setKindFilter('all')} />
            <FilterChip label="Compétitives" active={kindFilter === 'competitive'} onClick={() => setKindFilter('competitive')} />
            <FilterChip label="Amicales" active={kindFilter === 'friendly'} onClick={() => setKindFilter('friendly')} />
          </div>
          {token && (
            <div style={{ marginTop: 14 }}>
              <button
                onClick={() => setAlertSheet({ date: new Date().toISOString().slice(0, 10), from: '18:00', to: '21:00' })}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: `1px solid ${th.line}`, background: th.surface, borderRadius: 999, padding: '8px 14px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600, color: th.text }}>
                🔔 Créer une alerte
              </button>
              {alerts.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                  {alerts.map((al) => (
                    <span key={al.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: th.surface2, borderRadius: 999, padding: '6px 10px 6px 12px', fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute }}>
                      {alertChipLabel(al, club.timezone)}
                      <button aria-label="Supprimer l'alerte" onClick={async () => {
                        setAlerts((xs) => xs.filter((x) => x.id !== al.id)); // optimiste
                        try { await api.deleteMatchAlert(club.slug, al.id, token); } catch { loadAlerts(); }
                      }} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textFaint, fontSize: 15, lineHeight: 1 }}>✕</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
```

New:
```tsx
        <div style={{ padding: '18px 20px 0' }}>
          <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 26, color: th.text, margin: 0, letterSpacing: -0.4 }}>Parties ouvertes</h1>
          <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, lineHeight: 1.5, margin: '8px 0 0' }}>
            Rejoignez une partie publique, ou créez la vôtre au moment de réserver.
          </p>
          <MatchesFilterBar
            levelEnabled={levelEnabled}
            authenticated={!!token}
            myLevel={myLevel}
            myLevelMin={myLevelMin}
            myLevelMax={myLevelMax}
            fMin={fMin}
            fMax={fMax}
            onLevelChange={setLevelFilter}
            kindFilter={kindFilter}
            onKindChange={setKindFilter}
            resultCount={filtered.length}
            alerts={alerts}
            timezone={club.timezone}
            onDeleteAlert={handleDeleteAlert}
            onCreateAlert={handleCreateAlert}
          />
        </div>
```

- [ ] **Step 6: Reuse `handleCreateAlert` in the empty-state button**

Old:
```tsx
                {token && (
                  <div style={{ marginTop: 12 }}>
                    <button onClick={() => setAlertSheet({ date: new Date().toISOString().slice(0, 10), from: '18:00', to: '21:00' })}
                      style={{ border: 'none', background: th.accent, color: th.onAccent, borderRadius: 999, padding: '9px 16px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700 }}>
                      🔔 Créer une alerte
                    </button>
                  </div>
                )}
```

New:
```tsx
                {token && (
                  <div style={{ marginTop: 12 }}>
                    <button onClick={handleCreateAlert}
                      style={{ border: 'none', background: th.accent, color: th.onAccent, borderRadius: 999, padding: '9px 16px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700 }}>
                      🔔 Créer une alerte
                    </button>
                  </div>
                )}
```

- [ ] **Step 7: Run the existing OpenMatches suite**

Run (from `frontend/`): `node node_modules/jest/bin/jest.js OpenMatches.test --config jest.config.js`
Expected: PASS — every pre-existing test green, with no edits to `OpenMatches.test.tsx` (button labels and `data-match-grid` structure are unchanged; the "Créer une alerte" button now renders because `showFooter` is true for an authenticated viewer, and the "Amicales"/"Compétitives"/"Toutes" chips are still plain buttons with that exact text, now rendered inside `MatchesFilterBar`).

If a test fails, do not weaken its expectations — the spec requires behavior parity. Re-check the diff in Steps 1-6 for a typo instead.

- [ ] **Step 8: Commit**

```bash
git add frontend/components/openmatch/OpenMatches.tsx
git commit -m "refactor(parties): utilise MatchesFilterBar, retire le bloc de filtres inline"
```

---

## Task 3: Full regression + type-check + visual verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full component + integration suites together**

Run (from `frontend/`):
```bash
node node_modules/jest/bin/jest.js MatchesFilterBar OpenMatches.test --config jest.config.js
```
Expected: PASS, both suites green (12 tests in `MatchesFilterBar.test.tsx` + all pre-existing cases in `OpenMatches.test.tsx`).

- [ ] **Step 2: Type-check**

Run (from `frontend/`):
```bash
node node_modules/typescript/bin/tsc --noEmit
```
Expected: no errors referencing `MatchesFilterBar.tsx` or `OpenMatches.tsx`. (`ts-jest` with `isolatedModules` does not type-check — this is the real type gate, per project convention.) Ignore pre-existing unrelated errors elsewhere in the repo from parallel work; only files touched by this plan must be clean.

- [ ] **Step 3: Visual verification**

Use the `verify` skill (or start the dev server and drive Chrome via CDP manually) to check `/parties` on the seeded club (`padel-arena-paris`), logged in as `test@palova.fr`:
- Light theme, desktop (1280px): tiroir renders with Niveau + Type de partie groups side by side; footer shows the result count + "Créer une alerte".
- Light theme, mobile (390px): groups wrap onto separate lines, no horizontal overflow.
- Dark theme (floodlit): tiroir background/contrast readable, active-chip ink color legible (`th.mode === 'floodlit'` branch in `Chip`).
- Click "Régler ▾": slider expands inline; drag it and confirm the chip becomes "Niveau x–y ▴" and the match list re-filters.
- Click "Créer une alerte": `MatchAlertSheet` opens exactly as before.
- Create an alert and confirm its chip appears in the footer with a working ✕ delete.

- [ ] **Step 4: Final diff review**

Run `git status` and confirm only these files changed relative to the branch's prior state:
- `frontend/components/openmatch/MatchesFilterBar.tsx` (new)
- `frontend/components/openmatch/OpenMatches.tsx` (modified)
- `frontend/__tests__/MatchesFilterBar.test.tsx` (new)

(The spec and this plan file were already committed during brainstorming/planning.) No backend files, no migrations — matches the spec's "100% frontend" scope.
