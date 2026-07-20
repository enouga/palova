# Filtres Tournois — chip « 📅 Dates » + calendrier de plage — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer les deux `<input type="date">` natifs du panneau de filtres tournois (`FacetPanel`, partagé `/decouvrir` + `/tournois`) par une chip « 📅 Dates » ouvrant un calendrier maison en mode plage (2 taps).

**Architecture:** Un helper pur `rangeChipLabel` (`lib/tournamentCalendar.ts`) + un composant autonome `DateRangeChip` (chip + popup, réutilise les helpers purs de `lib/calendar` comme `DateField` — sans toucher `DateField`) branché dans `FacetPanel` sur le `onSetRange` existant. Zéro changement d'état/URL/backend. Spec : `docs/superpowers/specs/2026-07-20-filtres-tournois-calendrier-design.md`.

**Tech Stack:** React/TS, Jest + RTL, helpers `monthGrid`/`monthLabel`/`addMonths`/`todayKey` de `@/lib/calendar`, thème maison.

**⚠️ Git (session parallèle) :** stager uniquement les chemins listés, jamais `git add -A`. Pas de stash, pas de changement de branche.

**Tests (poste d'Eric) :** depuis `frontend/` : `node node_modules/jest/bin/jest.js --runTestsByPath <fichiers>` ; typage `node node_modules/typescript/bin/tsc --noEmit`.

---

## Task 1: Helper pur `rangeChipLabel`

**Files:**
- Modify: `frontend/lib/tournamentCalendar.ts` (append en fin de fichier)
- Test: `frontend/__tests__/tournamentCalendar.test.ts` (append un bloc)

- [ ] **Step 1: Écrire les tests qui échouent**

Dans `frontend/__tests__/tournamentCalendar.test.ts`, ajouter en fin de fichier (avant la fermeture du dernier `describe` racine s'il y en a un, sinon au niveau racine) :

```ts
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
```

et compléter l'import existant de `../lib/tournamentCalendar` avec `rangeChipLabel`.

- [ ] **Step 2: Vérifier l'échec**

`node node_modules/jest/bin/jest.js --runTestsByPath __tests__/tournamentCalendar.test.ts`
Expected: FAIL — `rangeChipLabel` n'est pas exporté.

- [ ] **Step 3: Implémenter le helper**

En fin de `frontend/lib/tournamentCalendar.ts` :

```ts
// ── Chip « 📅 Dates » du FacetPanel ──────────────────────────────────────────
// Libellé court d'une plage YYYY-MM-DD, sans passer par Date (aucun fuseau).
const MONTHS_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

function dayMonthLabel(key: string): string {
  const [, m, d] = key.split('-');
  return `${Number(d)} ${MONTHS_FR[Number(m) - 1]}`;
}

/** « 24 juil. → 2 août » / « Du 24 juil. » / « Jusqu'au 2 août » / null si aucune borne. */
export function rangeChipLabel(from: string | null, to: string | null): string | null {
  if (from && to) return `${dayMonthLabel(from)} → ${dayMonthLabel(to)}`;
  if (from) return `Du ${dayMonthLabel(from)}`;
  if (to) return `Jusqu'au ${dayMonthLabel(to)}`;
  return null;
}
```

- [ ] **Step 4: Vérifier que la suite passe**

`node node_modules/jest/bin/jest.js --runTestsByPath __tests__/tournamentCalendar.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/tournamentCalendar.ts frontend/__tests__/tournamentCalendar.test.ts
git commit -m "feat(tournois): rangeChipLabel — libelle court de plage pour la chip Dates

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Composant `DateRangeChip`

**Files:**
- Create: `frontend/components/calendar/DateRangeChip.tsx`
- Test: `frontend/__tests__/DateRangeChip.test.tsx`

- [ ] **Step 1: Écrire le test qui échoue**

Créer `frontend/__tests__/DateRangeChip.test.tsx` — un **harnais à état** simule le parent contrôlé (les tests de taps sont **déterministes** : l'état initial fixe le mois affiché, jamais dépendant d'aujourd'hui) :

```tsx
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { DateRangeChip } from '@/components/calendar/DateRangeChip';

function Harness({ onChange, initial = { from: null as string | null, to: null as string | null } }: {
  onChange: jest.Mock; initial?: { from: string | null; to: string | null };
}) {
  const [r, setR] = useState(initial);
  return (
    <ThemeProvider>
      <DateRangeChip from={r.from} to={r.to}
        onChange={(from, to) => { setR({ from, to }); onChange(from, to); }} />
    </ThemeProvider>
  );
}

describe('DateRangeChip', () => {
  it('chip neutre « Dates » → ouvre le calendrier', () => {
    render(<Harness onChange={jest.fn()} />);
    const chip = screen.getByRole('button', { name: 'Dates' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(chip);
    expect(screen.getByRole('dialog', { name: 'Choisir des dates' })).toBeInTheDocument();
  });

  it('2ᵉ tap postérieur → pose la fin et ferme', () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} initial={{ from: '2026-07-20', to: null }} />);
    fireEvent.click(screen.getByRole('button', { name: /Du 20 juil/ }));
    fireEvent.click(screen.getByRole('button', { name: '24/07/2026' }));
    expect(onChange).toHaveBeenLastCalledWith('2026-07-20', '2026-07-24');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('2ᵉ tap antérieur → bornes échangées', () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} initial={{ from: '2026-07-20', to: null }} />);
    fireEvent.click(screen.getByRole('button', { name: /Du 20 juil/ }));
    fireEvent.click(screen.getByRole('button', { name: '10/07/2026' }));
    expect(onChange).toHaveBeenLastCalledWith('2026-07-10', '2026-07-20');
  });

  it('plage complète : tap → repart sur un nouveau début (popup reste ouverte)', () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} initial={{ from: '2026-07-10', to: '2026-07-15' }} />);
    fireEvent.click(screen.getByRole('button', { name: /10 juil\. → 15 juil\./ }));
    fireEvent.click(screen.getByRole('button', { name: '22/07/2026' }));
    expect(onChange).toHaveBeenLastCalledWith('2026-07-22', null);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('✕ efface la plage sans ouvrir le calendrier', () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} initial={{ from: '2026-07-10', to: '2026-07-15' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Effacer les dates' }));
    expect(onChange).toHaveBeenLastCalledWith(null, null);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('« Effacer » du pied vide la plage et ferme', () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} initial={{ from: '2026-07-10', to: '2026-07-15' }} />);
    fireEvent.click(screen.getByRole('button', { name: /10 juil\. → 15 juil\./ }));
    fireEvent.click(screen.getByRole('button', { name: 'Effacer' }));
    expect(onChange).toHaveBeenLastCalledWith(null, null);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

`node node_modules/jest/bin/jest.js --runTestsByPath __tests__/DateRangeChip.test.tsx`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Écrire le composant**

Créer `frontend/components/calendar/DateRangeChip.tsx` :

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { Icon } from '@/components/ui/Icon';
import { addMonths, monthGrid, monthLabel, todayKey } from '@/lib/calendar';
import { rangeChipLabel } from '@/lib/tournamentCalendar';

const DOW = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];

/** "YYYY-MM-DD" → "DD/MM/YYYY" (aria-label des jours, idiome DateField). */
function frLabel(key: string): string {
  const [y, m, d] = key.split('-');
  return `${d}/${m}/${y}`;
}

// Chip « 📅 Dates » du FacetPanel : ouvre un calendrier maison en mode PLAGE — 1ᵉʳ tap = début,
// 2ᵉ tap = fin (bornes échangées si tapées à l'envers) puis fermeture ; plage re-tapée = on
// repart sur un nouveau début. Autonome : mêmes helpers purs que DateField (monthGrid/monthLabel/
// addMonths/todayKey) mais SANS toucher DateField (mono-date, consommé partout — la ~grille
// dupliquée est le prix de sa stabilité). Valeurs YYYY-MM-DD, le format de CalendarFilterState.
export function DateRangeChip({ from, to, onChange }: {
  from: string | null;
  to: string | null;
  onChange: (from: string | null, to: string | null) => void;
}) {
  const { th } = useTheme();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const base = from || todayKey();
  const [view, setView] = useState(() => ({ year: Number(base.slice(0, 4)), month: Number(base.slice(5, 7)) }));

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const openPicker = () => {
    const b = from || todayKey();
    setView({ year: Number(b.slice(0, 4)), month: Number(b.slice(5, 7)) });
    setOpen((o) => !o);
  };

  const pick = (key: string) => {
    if (!from || to) { onChange(key, null); return; } // 1ᵉʳ tap, ou plage complète → nouveau début
    if (key < from) onChange(key, from); else onChange(from, key); // 2ᵉ tap : fin (swap si besoin)
    setOpen(false);
  };

  const clear = () => { onChange(null, null); setOpen(false); };

  const label = rangeChipLabel(from, to);
  const active = label != null;
  const today = todayKey();
  const inkText = th.mode === 'floodlit' ? th.text : '#f7f5ee';

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', borderRadius: 999,
        background: active ? th.accent : th.surface,
        boxShadow: active ? 'none' : `inset 0 0 0 1px ${th.line}`,
      }}>
        <button type="button" onClick={openPicker} aria-haspopup="dialog" aria-expanded={open}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', cursor: 'pointer',
            background: 'transparent', borderRadius: 999, padding: active ? '7px 4px 7px 13px' : '7px 13px',
            fontFamily: th.fontUI, fontSize: 13, fontWeight: 700,
            color: active ? th.onAccent : th.text,
          }}>
          <Icon name="calendar" size={14} color={active ? th.onAccent : th.textMute} />
          {label ?? 'Dates'}
        </button>
        {active && (
          <button type="button" onClick={clear} aria-label="Effacer les dates"
            style={{ border: 'none', cursor: 'pointer', background: 'transparent', color: th.onAccent,
              fontFamily: th.fontUI, fontSize: 13, fontWeight: 800, padding: '7px 11px 7px 4px' }}>
            ✕
          </button>
        )}
      </span>

      {open && (
        <div role="dialog" aria-label="Choisir des dates"
          style={{
            position: 'absolute', top: 'calc(100% + 8px)', left: 0, zIndex: 50, width: 296,
            background: th.surface, border: `1px solid ${th.line}`, borderRadius: 16,
            boxShadow: '0 16px 40px rgba(0,0,0,0.18)', padding: 14,
          }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" onClick={() => setView((v) => addMonths(v.year, v.month, -1))} aria-label="Mois précédent"
              style={navBtnStyle(th)}><Icon name="chevL" size={18} color={th.text} /></button>
            <div style={{ flex: 1, textAlign: 'center', fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 16, color: th.text, textTransform: 'capitalize' }}>
              {monthLabel(view.year, view.month)}
            </div>
            <button type="button" onClick={() => setView((v) => addMonths(v.year, v.month, 1))} aria-label="Mois suivant"
              style={navBtnStyle(th)}><Icon name="chevR" size={18} color={th.text} /></button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0, rowGap: 3, marginTop: 12 }}>
            {DOW.map((d) => (
              <div key={d} style={{ textAlign: 'center', fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: th.textFaint, paddingBottom: 4 }}>
                {d}
              </div>
            ))}
            {monthGrid(view.year, view.month).flat().map((cell) => {
              const isEdge = cell.key === from || cell.key === to;
              const isBetween = !!from && !!to && cell.key > from && cell.key < to;
              const isToday = cell.key === today;
              return (
                <button key={cell.key} type="button" onClick={() => pick(cell.key)} aria-label={frLabel(cell.key)}
                  style={{
                    height: 36, border: 'none', cursor: 'pointer',
                    borderRadius: isEdge ? 10 : 0,
                    fontFamily: th.fontUI, fontSize: 14, fontWeight: isEdge || isToday ? 700 : 500,
                    background: isEdge ? th.ink : isBetween ? `${th.accent}26` : 'transparent',
                    color: isEdge ? inkText : !cell.inMonth ? th.textFaint : isToday ? th.accent : th.text,
                    boxShadow: isToday && !isEdge ? `inset 0 0 0 1.5px ${th.accent}` : 'none',
                    WebkitTapHighlightColor: 'transparent',
                  }}>
                  {cell.day}
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, borderTop: `1px solid ${th.line}`, paddingTop: 10 }}>
            <span style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textFaint }}>Début → fin, en 2 taps</span>
            <button type="button" onClick={clear}
              style={{ border: 'none', background: 'transparent', color: th.accent, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, padding: '4px 2px' }}>
              Effacer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function navBtnStyle(th: ReturnType<typeof useTheme>['th']): React.CSSProperties {
  return {
    width: 34, height: 34, borderRadius: 10, border: 'none', cursor: 'pointer', flexShrink: 0,
    background: th.surface2, display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
}
```

- [ ] **Step 4: Vérifier que la suite passe**

`node node_modules/jest/bin/jest.js --runTestsByPath __tests__/DateRangeChip.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/calendar/DateRangeChip.tsx frontend/__tests__/DateRangeChip.test.tsx
git commit -m "feat(tournois): DateRangeChip — calendrier de plage maison (chip Dates)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Brancher dans `FacetPanel` (retrait des inputs natifs)

**Files:**
- Modify: `frontend/components/calendar/FacetPanel.tsx`
- Test: `frontend/__tests__/FacetPanel.test.tsx`

- [ ] **Step 1: Ajouter les tests d'intégration (ils échouent)**

Dans `frontend/__tests__/FacetPanel.test.tsx`, ajouter en fin de `describe` :

```tsx
  it('la rangée Quand porte la chip « Dates » (plus d\'inputs natifs)', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Dates' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Du')).not.toBeInTheDocument(); // les <input type=date> ont disparu
  });

  it('avec une plage posée : chip pleine + ✕ → onSetRange(null, null)', () => {
    const state = { ...emptyCalendarState(), from: '2026-07-24', to: '2026-08-02' };
    const p = setup({ state });
    expect(screen.getByRole('button', { name: /24 juil\. → 2 août/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Effacer les dates' }));
    expect(p.onSetRange).toHaveBeenCalledWith(null, null);
  });
```

- [ ] **Step 2: Vérifier l'échec**

`node node_modules/jest/bin/jest.js --runTestsByPath __tests__/FacetPanel.test.tsx`
Expected: FAIL — chip « Dates » introuvable.

- [ ] **Step 3: Brancher la chip**

Dans `frontend/components/calendar/FacetPanel.tsx` :

3a. Ajouter l'import :

```tsx
import { DateRangeChip } from '@/components/calendar/DateRangeChip';
```

3b. Dans le groupe « Quand », remplacer le bloc des deux inputs :

```tsx
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 4 }}>
          <input type="date" aria-label="Du" value={state.from ?? ''} onChange={(e) => onSetRange(e.target.value || null, state.to)}
            style={dateInput(th)} />
          <span style={{ color: th.textFaint, fontFamily: th.fontUI, fontSize: 13 }}>→</span>
          <input type="date" aria-label="au" value={state.to ?? ''} onChange={(e) => onSetRange(state.from, e.target.value || null)}
            style={dateInput(th)} />
        </span>
```

par :

```tsx
        <DateRangeChip from={state.from} to={state.to} onChange={onSetRange} />
```

3c. Supprimer la fonction `dateInput` en bas de fichier (devenue morte).

- [ ] **Step 4: Vérifier que les suites passent**

`node node_modules/jest/bin/jest.js --runTestsByPath __tests__/FacetPanel.test.tsx __tests__/TournamentFinder.test.tsx`
Expected: PASS (FacetPanel 5 tests ; TournamentFinder inchangé vert).

- [ ] **Step 5: Typage**

`node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep -i "FacetPanel\|DateRangeChip\|tournamentCalendar"`
Expected: aucune ligne.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/calendar/FacetPanel.tsx frontend/__tests__/FacetPanel.test.tsx
git commit -m "feat(tournois): FacetPanel — chip Dates + calendrier de plage remplacent les inputs date natifs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Vérification visuelle + suite finale

- [ ] **Step 1: Vérif CDP** — `/decouvrir` connecté (section Tournois), clair 1280 : chip « Dates » dans la rangée Quand, popup ouverte lisible (nav mois, plage surlignée) ; sombre 390 : popup lisible, **aucun débordement** (`scrollWidth ≤ clientWidth`). Ouvrir la popup via CDP (`Input.dispatchMouseEvent` sur la chip) ou vérifier au moins le rendu fermé + s'appuyer sur les tests pour l'ouvert si le clic synthétique est fragile.

- [ ] **Step 2: Suite ciblée finale**

`node node_modules/jest/bin/jest.js --runTestsByPath __tests__/tournamentCalendar.test.ts __tests__/DateRangeChip.test.tsx __tests__/FacetPanel.test.tsx __tests__/TournamentFinder.test.tsx __tests__/DiscoverPage.test.tsx`
Expected: tout vert.

- [ ] **Step 3: Correctifs éventuels + commit** (uniquement si un fichier a changé après la vérif).

---

## Self-review (vérifié à l'écriture)

- **Couverture spec :** libellés chip → Task 1 ; plage 2 taps/swap/✕/Effacer/a11y dialog → Task 2 ; retrait inputs + branchement `onSetRange` sans changement d'API → Task 3 ; vérif visuelle → Task 4 ; `DateField`/presets/facettes/état/URL intouchés → aucune tâche ne les modifie. ✔
- **Placeholders :** aucun. ✔
- **Cohérence :** `DateRangeChip({ from, to, onChange })` identique Tasks 2/3 ; `rangeChipLabel` défini Task 1, consommé Task 2 ; aria-labels « Effacer les dates » / « Choisir des dates » / jours `DD/MM/YYYY` identiques entre composant et tests ; tests déterministes (état initial fixe le mois affiché). ✔
