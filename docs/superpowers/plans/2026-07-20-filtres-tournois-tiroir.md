# Filtres Tournois — tiroir compact façon Events — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replier le `FacetPanel` (4 groupes empilés + pill isolée) en UN tiroir compact au langage d'`EventsFilterBar` (groupes côte à côte, chips ✓/compteurs, pied « N résultats · Effacer les filtres »), et supprimer le grand vide sous la section Tournois de `/decouvrir` (`minHeight:100vh` embarqué + état vide actionnable).

**Architecture:** Réécriture du rendu de `FacetPanel.tsx` avec des briques locales module-scope (`FacetChip`/`FacetGroup`, dupliquées d'Events — pas d'import croisé events↔calendar, précédent `whenWindow`) + prop additive `resultCount?`. `TournamentFinder` : `minHeight` conditionnel à `hideTitle`, `clearFilters` extrait, état vide avec bouton. Spec : `docs/superpowers/specs/2026-07-20-filtres-tournois-tiroir-design.md`.

**Tech Stack:** React/TS, Jest + RTL, thème maison.

**⚠️ Git (session parallèle) :** stager uniquement les chemins listés. Pas de stash, pas de changement de branche.

**Tests (poste d'Eric) :** depuis `frontend/` : `node node_modules/jest/bin/jest.js --runTestsByPath <fichiers>` ; typage `node node_modules/typescript/bin/tsc --noEmit`. ⚠️ Le cwd Bash persiste entre commandes — vérifier `pwd` avant les runs.

**Contrats préservés :** noms accessibles des chips inchangés (compteur en `aria-hidden` → « Paris », pas « Paris 2 ») ; « Autour de moi » garde `aria-pressed` + libellés d'état ; `DateRangeChip` intact. **Écart assumé vs spec :** le test existant `getByText('Effacer')` migre vers « Effacer les filtres » (libellé du pied Events).

---

## Task 1: `FacetPanel` en tiroir compact

**Files:**
- Modify: `frontend/components/calendar/FacetPanel.tsx` (réécriture du rendu)
- Test: `frontend/__tests__/FacetPanel.test.tsx`

- [ ] **Step 1: Mettre à jour les tests (ils échouent d'abord)**

Dans `frontend/__tests__/FacetPanel.test.tsx` :

1a. Test « Effacer » — remplacer :

```tsx
  it('« Effacer » apparaît quand un filtre est actif', () => {
    const state = { ...emptyCalendarState(), deptCodes: new Set(['75']) };
    const p = setup({ state });
    fireEvent.click(screen.getByText('Effacer'));
    expect(p.onClear).toHaveBeenCalled();
  });
```

par :

```tsx
  it('le pied « Effacer les filtres » apparaît quand un filtre est actif', () => {
    const state = { ...emptyCalendarState(), deptCodes: new Set(['75']) };
    const p = setup({ state });
    fireEvent.click(screen.getByRole('button', { name: /Effacer les filtres/ }));
    expect(p.onClear).toHaveBeenCalled();
  });
```

1b. Ajouter en fin de `describe` :

```tsx
  it('« Autour de moi » vit dans le groupe Où (plus de pill isolée au-dessus)', () => {
    setup();
    expect(screen.getByText('Où')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Autour de moi/i })).toBeInTheDocument();
  });

  it('pied « N résultats » rendu si resultCount fourni et filtre actif, absent sinon', () => {
    const state = { ...emptyCalendarState(), deptCodes: new Set(['75']) };
    const r1 = render(
      <ThemeProvider>
        <FacetPanel facets={facets} state={state} resultCount={3}
          onToggleDept={jest.fn()} onToggleCategory={jest.fn()} onToggleGender={jest.fn()}
          onSetPreset={jest.fn()} onSetRange={jest.fn()} onToggleNearMe={jest.fn()} onClear={jest.fn()} />
      </ThemeProvider>,
    );
    expect(screen.getByText('3 résultats')).toBeInTheDocument();
    r1.unmount();
    setup(); // aucun filtre actif → pas de pied du tout
    expect(screen.queryByText(/résultat/)).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Vérifier l'échec**

`node node_modules/jest/bin/jest.js --runTestsByPath __tests__/FacetPanel.test.tsx`
Expected: FAIL — « Effacer les filtres », « Où », « 3 résultats » introuvables (les autres tests restent verts).

- [ ] **Step 3: Réécrire `FacetPanel.tsx`**

Remplacer **tout le contenu** de `frontend/components/calendar/FacetPanel.tsx` par :

```tsx
'use client';
import { useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { Icon } from '@/components/ui/Icon';
import { DateRangeChip } from '@/components/calendar/DateRangeChip';
import { CalendarFilterState, DatePreset, calendarFacets } from '@/lib/tournamentCalendar';
import { TournamentGender } from '@/lib/api';

const GENDER_LABEL: Record<string, string> = { MEN: 'Messieurs', WOMEN: 'Dames', MIXED: 'Mixte' };
const PRESETS: { key: DatePreset; label: string }[] = [
  { key: 'weekend', label: 'Ce week-end' },
  { key: 'thisMonth', label: 'Ce mois-ci' },
  { key: 'days30', label: '30 jours' },
  { key: 'months3', label: '3 mois' },
];
const DEPT_VISIBLE = 8; // nombre de départements montrés avant « + tous »

type Th = ReturnType<typeof useTheme>['th'];

export interface FacetPanelProps {
  facets: ReturnType<typeof calendarFacets>;
  state: CalendarFilterState;
  onToggleDept: (code: string) => void;
  onToggleCategory: (c: string) => void;
  onToggleGender: (g: TournamentGender) => void;
  onSetPreset: (p: DatePreset | null) => void;
  onSetRange: (from: string | null, to: string | null) => void;
  onToggleNearMe: () => void;
  onClear: () => void;
  nearMeBusy?: boolean;
  /** Nombre de résultats affichés (pied du tiroir) — fourni par la page hôte. */
  resultCount?: number | null;
}

// Panneau de filtres des tournois (partagé /decouvrir + /tournois) : UN tiroir compact au
// langage d'EventsFilterBar — groupes labellisés côte à côte (flex-wrap), chips ✓/compteurs,
// pied « N résultats · Effacer les filtres ». Les briques FacetChip/FacetGroup sont des copies
// LOCALES de celles d'Events (APIs différentes, et pas d'import croisé events↔calendar — même
// précédent que whenWindow) ; toujours module-scope, jamais définies dans le rendu (leçon du
// bug Group : un composant défini dans un autre est remonté à chaque rendu).
export function FacetPanel({ facets, state, onToggleDept, onToggleCategory, onToggleGender, onSetPreset, onSetRange, onToggleNearMe, onClear, nearMeBusy, resultCount }: FacetPanelProps) {
  const { th } = useTheme();
  const [showAllDepts, setShowAllDepts] = useState(false);

  // « Autour de moi » est un tri, pas un filtre (et onClear le préserve) → exclu de hasActive.
  const hasActive = state.deptCodes.size > 0 || state.categories.size > 0 || state.genders.size > 0 || state.datePreset != null || !!state.from || !!state.to;
  const depts = showAllDepts ? facets.departments : facets.departments.slice(0, DEPT_VISIBLE);

  return (
    <div style={{ padding: '4px 20px 0' }}>
      <div style={{ borderRadius: 16, background: th.bgElev, boxShadow: `inset 0 0 0 1px ${th.line}` }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 26px', padding: '12px 14px' }}>
          <FacetGroup th={th} label="Quand">
            {PRESETS.map((p) => (
              <FacetChip key={p.key} th={th} label={p.label} active={state.datePreset === p.key && !state.from && !state.to}
                onClick={() => onSetPreset(state.datePreset === p.key ? null : p.key)} />
            ))}
            <DateRangeChip from={state.from} to={state.to} onChange={onSetRange} />
          </FacetGroup>

          <FacetGroup th={th} label="Où">
            {/* Autour de moi = un TRI (accent, pas encre) — même sujet que les départements. */}
            <button onClick={onToggleNearMe} aria-pressed={state.nearMe}
              aria-label={nearMeBusy ? 'Localisation…' : state.nearMe ? 'Autour de moi ✓' : 'Autour de moi'}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', cursor: 'pointer',
                borderRadius: 999, padding: '5px 11px', fontFamily: th.fontUI, fontSize: 13,
                fontWeight: state.nearMe ? 700 : 600,
                background: state.nearMe ? th.accent : th.surface,
                color: state.nearMe ? th.onAccent : th.text,
                boxShadow: state.nearMe ? 'none' : `inset 0 0 0 1px ${th.line}`,
                WebkitTapHighlightColor: 'transparent',
              }}>
              📍 {nearMeBusy ? 'Localisation…' : state.nearMe ? 'Autour de moi ✓' : 'Autour de moi'}
            </button>
            {depts.map((d) => (
              <FacetChip key={d.code} th={th} label={d.name} count={d.count} active={state.deptCodes.has(d.code)} onClick={() => onToggleDept(d.code)} />
            ))}
            {facets.departments.length > DEPT_VISIBLE && (
              <button onClick={() => setShowAllDepts((v) => !v)} style={linkBtn(th)}>
                {showAllDepts ? 'voir moins' : `+ ${facets.departments.length - DEPT_VISIBLE}`}
              </button>
            )}
          </FacetGroup>

          {facets.categories.length > 0 && (
            <FacetGroup th={th} label="Catégorie">
              {facets.categories.map((c) => (
                <FacetChip key={c.value} th={th} label={c.value} count={c.count} active={state.categories.has(c.value)} onClick={() => onToggleCategory(c.value)} />
              ))}
            </FacetGroup>
          )}

          {facets.genders.length > 0 && (
            <FacetGroup th={th} label="Genre">
              {facets.genders.map((g) => (
                <FacetChip key={g.value} th={th} label={GENDER_LABEL[g.value]} count={g.count} active={state.genders.has(g.value)} onClick={() => onToggleGender(g.value)} />
              ))}
            </FacetGroup>
          )}
        </div>

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
      </div>
    </div>
  );
}

// Chip de facette (copie locale du FacetChip d'Events) : ✓ + encre pleine quand active,
// compteur en suffixe `aria-hidden` (le nom accessible reste « Paris », pas « Paris 2 » —
// contrat des tests), estompée mais cliquable à 0.
function FacetChip({ th, label, count, active, onClick }: {
  th: Th; label: string; count?: number; active: boolean; onClick: () => void;
}) {
  const fg = active ? (th.mode === 'floodlit' ? th.text : '#f7f5ee') : th.text;
  return (
    <button onClick={onClick} aria-pressed={active} style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      border: 'none', cursor: 'pointer', borderRadius: 999, padding: '5px 11px',
      fontFamily: th.fontUI, fontSize: 13, fontWeight: active ? 700 : 600,
      background: active ? th.ink : th.surface, color: fg,
      boxShadow: active ? 'none' : `inset 0 0 0 1px ${th.line}`,
      opacity: !active && count === 0 ? 0.45 : 1,
      WebkitTapHighlightColor: 'transparent',
    }}>
      {active && <Icon name="check" size={12} color={fg} />}
      {label}
      {count != null && (
        <span aria-hidden style={{ fontSize: 11.5, fontWeight: 700, color: active ? fg : th.textFaint, opacity: active ? 0.75 : 1, fontVariantNumeric: 'tabular-nums' }}>{count}</span>
      )}
    </button>
  );
}

function FacetGroup({ th, label, children }: { th: Th; label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <span style={{
        fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6,
        textTransform: 'uppercase', color: th.textFaint,
      }}>{label}</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>{children}</div>
    </div>
  );
}

function linkBtn(th: Th): React.CSSProperties {
  return { border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.textFaint, padding: '5px 8px' };
}
```

(Disparus : l'import `Pill`, `facetLabel`, l'ancien `Group`, la grande pill « Autour de moi » isolée.)

- [ ] **Step 4: Vérifier que la suite passe**

`node node_modules/jest/bin/jest.js --runTestsByPath __tests__/FacetPanel.test.tsx`
Expected: PASS (8 tests : 6 existants dont Effacer migré + 2 nouveaux).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/calendar/FacetPanel.tsx frontend/__tests__/FacetPanel.test.tsx
git commit -m "feat(tournois): FacetPanel en tiroir compact facon Events (groupes cote a cote, pied N resultats)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `TournamentFinder` — fin du vide + état vide actionnable

**Files:**
- Modify: `frontend/components/calendar/TournamentFinder.tsx`
- Test: `frontend/__tests__/TournamentFinder.test.tsx`

- [ ] **Step 1: Ajouter les tests (ils échouent)**

En fin de `describe` de `frontend/__tests__/TournamentFinder.test.tsx` :

```tsx
  it('hideTitle (mode embarqué) : pas de minHeight plein écran', async () => {
    const { container } = render(<ThemeProvider><TournamentFinder hideTitle /></ThemeProvider>);
    await screen.findByText('GP Paris');
    expect((container.firstChild as HTMLElement).style.minHeight).toBe('');
  });

  it('0 résultat avec filtres actifs : bouton « Effacer les filtres » qui relance la liste', async () => {
    render(<ThemeProvider><TournamentFinder /></ThemeProvider>);
    await screen.findByText('GP Paris');
    fireEvent.click(screen.getByRole('button', { name: 'Paris' }));    // dept 75
    fireEvent.click(screen.getByRole('button', { name: 'Dames' }));    // genre WOMEN → 0 résultat
    expect(await screen.findByText('Aucun tournoi ne correspond à votre recherche.')).toBeInTheDocument();
    const btns = screen.getAllByRole('button', { name: /Effacer les filtres/ });
    fireEvent.click(btns[btns.length - 1]); // celui de l'état vide (le pied du tiroir en a un aussi)
    expect(await screen.findByText('GP Paris')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Vérifier l'échec**

`node node_modules/jest/bin/jest.js --runTestsByPath __tests__/TournamentFinder.test.tsx`
Expected: FAIL — les 2 nouveaux (minHeight encore `100vh` ; pas de bouton dans l'état vide). ⚠️ Si « Dames » n'apparaît pas : le fixture `NAT` contient bien un tournoi WOMEN (Open Lyon) → la facette existe.

- [ ] **Step 3: Modifier `TournamentFinder.tsx`**

3a. Racine — remplacer :

```tsx
    <div style={{ paddingBottom: 48, background: th.bg, minHeight: '100vh' }}>
```

par (embarqué dans /decouvrir, la section reprend sa hauteur naturelle — le 100vh ne vaut que pour la page /tournois autonome) :

```tsx
    <div style={{ paddingBottom: 48, background: th.bg, minHeight: hideTitle ? undefined : '100vh' }}>
```

3b. Extraire le clear (juste avant le `return`, à côté des `useMemo`) et calculer l'état filtré :

```tsx
  const clearFilters = () => setState((s) => ({ ...emptyCalendarState(), nearMe: s.nearMe }));
  const hasActiveFilters = state.deptCodes.size > 0 || state.categories.size > 0 || state.genders.size > 0 || state.datePreset != null || !!state.from || !!state.to;
```

3c. Dans le JSX du `FacetPanel`, remplacer `onClear={() => setState((s) => ({ ...emptyCalendarState(), nearMe: s.nearMe }))}` par `onClear={clearFilters}` et ajouter la prop `resultCount={results ? results.length : null}`.

3d. État vide — remplacer :

```tsx
        {results?.length === 0 && <div style={{ fontFamily: th.fontUI, color: th.textMute }}>Aucun tournoi ne correspond à votre recherche.</div>}
```

par :

```tsx
        {results?.length === 0 && (
          <div style={{ textAlign: 'center', padding: '18px 0 6px' }}>
            <div style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute }}>
              {hasActiveFilters ? 'Aucun tournoi ne correspond à votre recherche.' : 'Aucun tournoi à venir pour le moment.'}
            </div>
            {hasActiveFilters && (
              <button onClick={clearFilters} style={{
                marginTop: 12, border: 'none', cursor: 'pointer', borderRadius: 999, padding: '9px 18px',
                fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700, background: th.accent, color: th.onAccent,
              }}>
                Effacer les filtres
              </button>
            )}
          </div>
        )}
```

- [ ] **Step 4: Vérifier que les suites passent**

`node node_modules/jest/bin/jest.js --runTestsByPath __tests__/TournamentFinder.test.tsx __tests__/FacetPanel.test.tsx __tests__/DiscoverPage.test.tsx`
Expected: PASS (TournamentFinder 13 = 11 + 2 ; FacetPanel 8 ; DiscoverPage 10).

- [ ] **Step 5: Typage**

`node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep -i "FacetPanel\|TournamentFinder"`
Expected: aucune ligne.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/calendar/TournamentFinder.tsx frontend/__tests__/TournamentFinder.test.tsx
git commit -m "feat(tournois): fin du vide sous la section embarquee (minHeight conditionnel) + etat vide actionnable

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Vérification visuelle + suite finale

- [ ] **Step 1: Vérif CDP** — `/decouvrir#tournois` connecté, clair 1280 + sombre 390 : tiroir compact (groupes côte à côte, nettement moins haut), « Autour de moi » dans Où, chips estompées à 0, pied « N résultats · Effacer les filtres » quand un filtre est posé, **plus de vide** sous la section quand 0 résultat (filtrer pour vider puis mesurer la hauteur de section), aucun débordement (`scrollWidth ≤ clientWidth`). Vérifier aussi `/tournois` clair 1280 (page autonome, tiroir identique).

- [ ] **Step 2: Suite ciblée finale**

`node node_modules/jest/bin/jest.js --runTestsByPath __tests__/FacetPanel.test.tsx __tests__/TournamentFinder.test.tsx __tests__/DiscoverPage.test.tsx __tests__/DateRangeChip.test.tsx __tests__/tournamentCalendar.test.ts`
Expected: tout vert.

- [ ] **Step 3: Correctifs éventuels + commit** (uniquement si un fichier change après la vérif).

---

## Self-review (vérifié à l'écriture)

- **Couverture spec :** tiroir bgElev/groupes côte à côte/chips Events/pied → Task 1 ; « Autour de moi » dans Où → Task 1 ; briques locales module-scope (pas d'import croisé, pas de définition dans le rendu) → Task 1 ; `resultCount` → Tasks 1-2 ; minHeight conditionnel + état vide actionnable → Task 2 ; vérif CDP deux surfaces → Task 3. ✔
- **Placeholders :** aucun. ✔
- **Cohérence :** `FacetChip({ th, label, count?, active, onClick })` / `FacetGroup({ th, label, children })` définis et consommés dans le même fichier ; `resultCount` optionnel (les usages existants sans la prop compilent) ; libellés « Effacer les filtres » identiques composant/tests ; compteur `aria-hidden` → les tests par nom « Paris »/« Dames » tiennent. ✔
