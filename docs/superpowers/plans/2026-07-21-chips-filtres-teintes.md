# Chips de filtres teintées par groupe — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fusionner les 3 copies divergentes de chips de filtres en un composant partagé `components/ui/FacetChip.tsx` et teinter chaque groupe de filtres avec une couleur fixe de la palette `ACCENTS` (spec : `docs/superpowers/specs/2026-07-21-chips-filtres-teintes-design.md`).

**Architecture:** Un nouveau module feuille `ui/` (aucune dépendance métier — règle l'interdit d'import croisé events↔calendar) exporte `FILTER_TINTS` (mapping sémantique → teinte), `FacetChip` et `FacetGroup`. Les 4 surfaces (MatchesFilterBar, EventsFilterBar, calendar/FacetPanel + DateRangeChip, DiscoverMatches) migrent dessus et suppriment leurs copies locales. 100 % frontend, aucune migration, aucun backend.

**Tech Stack:** React/Next 16, jest + React Testing Library, `useTheme`/`inkOn`/`ACCENTS` de `lib/theme`.

---

## ⚠️ Précautions repo (à lire avant la Task 1)

- **Working tree sale** : Eric a un WIP parallèle (validation de match — fichiers backend + `frontend/lib/authGate.ts`, `frontend/proxy.ts`…). **Jamais `git add -A` / `git add .`** — chaque commit ajoute UNIQUEMENT les chemins listés dans sa task. Jamais de `git stash`.
- **Shims `.bin` cassés** : `npx jest` échoue. Lancer : `node node_modules/jest/bin/jest.js` et `node node_modules/typescript/bin/tsc` depuis `frontend/`.
- **Jest traite un chemin comme un motif** → toujours `--runTestsByPath` pour cibler un fichier.
- Tous les chemins ci-dessous sont relatifs à `C:\ProjetsIA\05_PERSO\RESERVE\palova`.

---

### Task 1: Composant partagé `FacetChip` (TDD)

**Files:**
- Create: `frontend/components/ui/FacetChip.tsx`
- Test: `frontend/__tests__/FacetChip.test.tsx`

- [ ] **Step 1: Écrire le test qui échoue**

```tsx
// frontend/__tests__/FacetChip.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '../lib/ThemeProvider';
import { FacetChip, FacetGroup, FILTER_TINTS } from '../components/ui/FacetChip';
import { inkOn } from '../lib/theme';

function wrap(ui: React.ReactNode) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe('FILTER_TINTS', () => {
  it('les teintes d’une même barre sont distinctes (Events)', () => {
    const events = [FILTER_TINTS.source, FILTER_TINTS.quand, FILTER_TINTS.categorie, FILTER_TINTS.genre, FILTER_TINTS.typeAnimation, FILTER_TINTS.acces];
    expect(new Set(events).size).toBe(events.length);
  });
});

describe('FacetChip', () => {
  it('active : pill pleine de la teinte, encre inkOn, coche', () => {
    wrap(<FacetChip label="Ce mois-ci" active tint={FILTER_TINTS.quand} onClick={() => {}} />);
    const btn = screen.getByRole('button', { name: 'Ce mois-ci' });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(btn).toHaveStyle({ background: FILTER_TINTS.quand, color: inkOn(FILTER_TINTS.quand) });
  });

  it('inactive : fond transparent, cliquable', () => {
    const onClick = jest.fn();
    wrap(<FacetChip label="P100" active={false} tint={FILTER_TINTS.categorie} onClick={onClick} />);
    const btn = screen.getByRole('button', { name: 'P100' });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    expect(btn).toHaveStyle({ background: 'transparent' });
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalled();
  });

  it('compteur en suffixe aria-hidden — le nom accessible reste le libellé seul', () => {
    wrap(<FacetChip label="P100" count={2} active={false} tint={FILTER_TINTS.categorie} onClick={() => {}} />);
    const btn = screen.getByRole('button', { name: 'P100' }); // pas « P100 2 »
    const suffix = btn.querySelector('span[aria-hidden]');
    expect(suffix).toHaveTextContent('2');
  });

  it('count 0 et inactive → estompée (.45) mais cliquable', () => {
    const onClick = jest.fn();
    wrap(<FacetChip label="Animations" count={0} active={false} tint={FILTER_TINTS.source} onClick={onClick} />);
    const btn = screen.getByRole('button', { name: 'Animations' });
    expect(btn).toHaveStyle({ opacity: 0.45 });
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalled();
  });

  it('relaie aria-expanded quand fourni', () => {
    wrap(<FacetChip label="Régler ▾" active={false} tint={FILTER_TINTS.niveau} onClick={() => {}} ariaExpanded />);
    expect(screen.getByRole('button', { name: 'Régler ▾' })).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('FacetGroup', () => {
  it('libellé + pastille de la teinte + enfants', () => {
    const { container } = wrap(
      <FacetGroup label="Quand" tint={FILTER_TINTS.quand}>
        <span>enfant</span>
      </FacetGroup>,
    );
    expect(screen.getByText('Quand')).toBeInTheDocument();
    expect(screen.getByText('enfant')).toBeInTheDocument();
    const dot = container.querySelector('span[aria-hidden]');
    expect(dot).toHaveStyle({ background: FILTER_TINTS.quand });
  });
});
```

- [ ] **Step 2: Vérifier que le test échoue**

Run: `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/FacetChip.test.tsx`
Expected: FAIL — `Cannot find module '../components/ui/FacetChip'`

- [ ] **Step 3: Implémenter le composant**

```tsx
// frontend/components/ui/FacetChip.tsx
'use client';
import { ReactNode } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS, inkOn } from '@/lib/theme';
import { Icon } from '@/components/ui/Icon';

// Chips de filtres partagées (Parties · Events · Tournois national · Découvrir) —
// remplace les 3 copies locales qui avaient dérivé (EventsFilterBar, MatchesFilterBar,
// calendar/FacetPanel). Chaque GROUPE de filtres porte une teinte fixe de la palette
// (FILTER_TINTS, même libellé ⇒ même teinte sur toutes les pages) : pastille sur le
// libellé du groupe, chip active = pill pleine de la teinte (encre via inkOn),
// inactive = contour neutre. `lime` jamais utilisé (illisible en clair).

export const FILTER_TINTS = {
  quand: ACCENTS.emerald,        // « Quand » (Events, calendrier national, Découvrir)
  categorie: ACCENTS.violet,     // « Catégorie » (Events, calendrier national)
  genre: ACCENTS.cyan,           // « Genre » (Events, calendrier national)
  niveau: ACCENTS.blue,          // « Niveau » (Parties, Découvrir)
  typePartie: ACCENTS.coral,     // « Type de partie » (Parties)
  source: ACCENTS.apricot,       // « Source » (Events)
  typeAnimation: ACCENTS.blue,   // « Type » (Events, animations)
  acces: ACCENTS.coral,          // « Accès » (Events, Réservé membres)
  ou: ACCENTS.blue,              // « Où » (calendrier national, « Autour de moi » compris)
} as const;

// Compteur en suffixe aria-hidden : le nom accessible reste « P100 », pas « P100 2 »
// (contrat des tests des 4 surfaces).
export function FacetChip({ label, count, active, onClick, tint, ariaExpanded }: {
  label: string; count?: number; active: boolean; onClick: () => void;
  tint: string; ariaExpanded?: boolean;
}) {
  const { th } = useTheme();
  const fg = active ? inkOn(tint) : th.text;
  return (
    <button type="button" onClick={onClick} aria-pressed={active} aria-expanded={ariaExpanded} style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      border: 'none', cursor: 'pointer', borderRadius: 999, padding: '5px 11px',
      fontFamily: th.fontUI, fontSize: 13, fontWeight: active ? 700 : 600,
      background: active ? tint : 'transparent', color: fg,
      boxShadow: active ? 'none' : `inset 0 0 0 1px ${th.line}`,
      opacity: !active && count === 0 ? 0.45 : 1,
      transition: 'all .15s', WebkitTapHighlightColor: 'transparent',
    }}>
      {active && <Icon name="check" size={12} color={fg} />}
      {label}
      {count != null && (
        <span aria-hidden style={{
          fontSize: 11.5, fontWeight: 700, color: active ? fg : th.textFaint,
          opacity: active ? 0.75 : 1, fontVariantNumeric: 'tabular-nums',
        }}>{count}</span>
      )}
    </button>
  );
}

export function FacetGroup({ label, tint, children }: {
  label: string; tint: string; children: ReactNode;
}) {
  const { th } = useTheme();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <span style={{
        display: 'flex', alignItems: 'center', gap: 6,
        fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6,
        textTransform: 'uppercase', color: th.textFaint,
      }}>
        <span aria-hidden style={{ width: 7, height: 7, borderRadius: 99, background: tint, display: 'inline-block' }} />
        {label}
      </span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>{children}</div>
    </div>
  );
}
```

- [ ] **Step 4: Vérifier que le test passe**

Run: `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/FacetChip.test.tsx`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/components/ui/FacetChip.tsx frontend/__tests__/FacetChip.test.tsx
git commit -m "feat(ui): FacetChip/FacetGroup partages avec teinte par groupe (FILTER_TINTS)"
```

---

### Task 2: Migrer `MatchesFilterBar` (/parties)

**Files:**
- Modify: `frontend/components/openmatch/MatchesFilterBar.tsx`
- Tests existants (contrat inchangé) : `frontend/__tests__/MatchesFilterBar.test.tsx`, `frontend/__tests__/OpenMatches.test.tsx`

- [ ] **Step 1: Supprimer les copies locales et brancher le partagé**

Dans `MatchesFilterBar.tsx` :

1. Remplacer les imports en tête (supprimer `Icon`, qui n'était utilisé que par la copie locale) :

```tsx
'use client';
import { useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import type { MatchAlert } from '@/lib/api';
import { FacetChip, FacetGroup, FILTER_TINTS } from '@/components/ui/FacetChip';
import { LevelRangeSlider } from '@/components/player/LevelRangeSlider';
import { fmtLevel } from '@/lib/levelMatch';
import { alertChipLabel } from '@/lib/matchAlerts';
```

2. **Supprimer entièrement** les composants locaux `Chip` (et son commentaire d'en-tête) et `GroupLabel`.

3. Remplacer le bloc « Niveau » (le `<div>` colonne + `GroupLabel` + rangée de `Chip` + slider) par — le slider reste un frère de `FacetGroup` dans une colonne englobante, pas un enfant de la rangée :

```tsx
{showLevelGroup && (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
    <FacetGroup label="Niveau" tint={FILTER_TINTS.niveau}>
      {myLevel != null && myLevelMin != null && myLevelMax != null && (
        <FacetChip label={`À mon niveau · ${fmtLevel(myLevelMin)}–${fmtLevel(myLevelMax)}`} tint={FILTER_TINTS.niveau}
          active={isMyLevel} onClick={() => onLevelChange(myLevelMin, myLevelMax)} />
      )}
      <FacetChip label="Tous" tint={FILTER_TINTS.niveau} active={isDefaultAll} onClick={() => onLevelChange(LEVEL_MIN, LEVEL_MAX)} />
      <FacetChip label={adjustLabel} tint={FILTER_TINTS.niveau} active={isCustom} ariaExpanded={sliderOpen}
        onClick={() => setSliderOpen((v) => !v)} />
    </FacetGroup>
    {sliderOpen && (
      <div style={{ maxWidth: 430, marginTop: 4 }}>
        <LevelRangeSlider compact min={fMin} max={fMax} onChange={onLevelChange} />
      </div>
    )}
  </div>
)}
```

4. Remplacer le bloc « Type de partie » par :

```tsx
<FacetGroup label="Type de partie" tint={FILTER_TINTS.typePartie}>
  <FacetChip label="Toutes" tint={FILTER_TINTS.typePartie} active={kindFilter === 'all'} onClick={() => onKindChange('all')} />
  <FacetChip label="Pour de vrai" tint={FILTER_TINTS.typePartie} active={kindFilter === 'competitive'} onClick={() => onKindChange('competitive')} />
  <FacetChip label="Pour le fun" tint={FILTER_TINTS.typePartie} active={kindFilter === 'friendly'} onClick={() => onKindChange('friendly')} />
</FacetGroup>
```

Le pied (compteur, chips d'alertes, « Créer une alerte ») est **inchangé**.

- [ ] **Step 2: Lancer les suites concernées**

Run: `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/MatchesFilterBar.test.tsx __tests__/OpenMatches.test.tsx`
Expected: PASS (contrats aria/libellés inchangés). Si un test échoue sur un détail de style, c'est une régression à corriger dans le composant, pas dans le test.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/openmatch/MatchesFilterBar.tsx
git commit -m "feat(parties): barre de filtres sur FacetChip partage (Niveau bleu, Type corail)"
```

---

### Task 3: Migrer `EventsFilterBar` (/events)

**Files:**
- Modify: `frontend/components/events/EventsFilterBar.tsx`
- Test existant (contrat inchangé) : `frontend/__tests__/EventsFilterBar.test.tsx`

- [ ] **Step 1: Supprimer les copies locales et brancher le partagé**

Dans `EventsFilterBar.tsx` :

1. Imports en tête (supprimer `ReactNode`, garder `Icon` — encore utilisé par « Effacer les filtres ») :

```tsx
'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { Icon } from '@/components/ui/Icon';
import { FacetChip, FacetGroup, FILTER_TINTS } from '@/components/ui/FacetChip';
import {
  AgendaFilter, AgendaCounts, EventFilterState,
  GENDER_LABEL, KIND_LABEL, WHEN_LABEL, WHEN_ORDER, agendaFacets,
} from '@/lib/events';
```

2. **Supprimer entièrement** les composants locaux `FacetChip` et `FacetGroup` (et leurs commentaires).

3. Ajouter les props `tint` sur chaque groupe et chaque chip (les `label`/`count`/`active`/`onClick` existants ne bougent pas) :

| Groupe | `tint` à passer (groupe ET chips) |
|---|---|
| `Source` | `FILTER_TINTS.source` |
| `Quand` | `FILTER_TINTS.quand` |
| `Catégorie` | `FILTER_TINTS.categorie` |
| `Genre` | `FILTER_TINTS.genre` |
| `Type` | `FILTER_TINTS.typeAnimation` |
| `Accès` | `FILTER_TINTS.acces` |

Exemple pour « Source » (même mécanique pour les 5 autres) :

```tsx
<FacetGroup label="Source" tint={FILTER_TINTS.source}>
  {SOURCES.map((s) => (
    <FacetChip key={s.key} label={s.label} count={counts.sources[s.key]} active={state.source === s.key}
      tint={FILTER_TINTS.source} onClick={() => setSource(s.key)} />
  ))}
</FacetGroup>
```

Le wrapper `key={state.source}` + animation `sp-rise`, le pied « N résultats · Effacer les filtres » : **inchangés**.

- [ ] **Step 2: Lancer la suite concernée**

Run: `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/EventsFilterBar.test.tsx`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/components/events/EventsFilterBar.tsx
git commit -m "feat(events): barre de filtres sur FacetChip partage (teintes par groupe)"
```

---

### Task 4: Migrer `calendar/FacetPanel` + `DateRangeChip` (/tournois national)

**Files:**
- Modify: `frontend/components/calendar/FacetPanel.tsx`
- Modify: `frontend/components/calendar/DateRangeChip.tsx`
- Tests existants (contrat inchangé) : `frontend/__tests__/FacetPanel.test.tsx`, `frontend/__tests__/TournamentFinder.test.tsx`

- [ ] **Step 1: `DateRangeChip` — prop `tint` optionnelle**

Dans `DateRangeChip.tsx` :

1. Ajouter l'import : `import { inkOn } from '@/lib/theme';`
2. Élargir la signature :

```tsx
export function DateRangeChip({ from, to, onChange, tint }: {
  from: string | null;
  to: string | null;
  onChange: (from: string | null, to: string | null) => void;
  /** Teinte du groupe hôte (défaut th.accent — rétro-compatible). */
  tint?: string;
}) {
```

3. Dans le corps, juste après `const active = label != null;` :

```tsx
const pill = tint ?? th.accent;
const pillInk = inkOn(pill);
```

4. Sur la **pill uniquement** (la popup calendrier interne reste sur `th.accent`) remplacer :
   - le `background` du `<span>` englobant : `background: active ? pill : th.surface`
   - la `color` du bouton principal : `color: active ? pillInk : th.text`
   - la couleur de l'icône calendrier : `color={active ? pillInk : th.textMute}`
   - la `color` du bouton ✕ « Effacer les dates » : `color: pillInk`

- [ ] **Step 2: `FacetPanel` — supprimer les copies, brancher le partagé**

Dans `FacetPanel.tsx` :

1. Imports : ajouter `import { FacetChip, FacetGroup, FILTER_TINTS } from '@/components/ui/FacetChip';` et `import { inkOn } from '@/lib/theme';` ; **supprimer entièrement** les définitions locales exportées `FacetChip` et `FacetGroup` en bas de fichier (le type `Th` reste — utilisé par `linkBtn`). Mettre à jour le commentaire d'en-tête (les briques ne sont plus des copies locales).
2. Tous les usages perdent `th={th}` et gagnent `tint` :
   - Groupe `Quand` : `tint={FILTER_TINTS.quand}` (groupe + les 4 `FacetChip` de presets) ; la `DateRangeChip` reçoit `tint={FILTER_TINTS.quand}`.
   - Groupe `Où` : `tint={FILTER_TINTS.ou}` (groupe + chips départements). Le lien « + N » est inchangé.
   - Groupe `Catégorie` : `tint={FILTER_TINTS.categorie}`.
   - Groupe `Genre` : `tint={FILTER_TINTS.genre}`.
3. Bouton dédié « 📍 Autour de moi » (reste un bouton custom — aria-label/busy inchangés), harmoniser ses couleurs :

```tsx
background: state.nearMe ? FILTER_TINTS.ou : 'transparent',
color: state.nearMe ? inkOn(FILTER_TINTS.ou) : th.text,
boxShadow: state.nearMe ? 'none' : `inset 0 0 0 1px ${th.line}`,
```

(l'inactif passe de fond `th.surface` au transparent + contour, comme toutes les chips).

- [ ] **Step 3: Vérifier qu'il ne reste aucun importeur des anciennes copies**

Run: `cd frontend && grep -rn "from '@/components/calendar/FacetPanel'" components app lib __tests__`
Expected: seuls des imports de `FacetPanel` (le composant panneau) — plus aucun `FacetChip`/`FacetGroup` sauf celui de `DiscoverMatches.tsx` (migré en Task 5 ; si la Task 5 n'est pas encore faite, la compile échouera à ses côtés — enchaîner).

- [ ] **Step 4: Lancer les suites concernées**

Run: `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/FacetPanel.test.tsx __tests__/TournamentFinder.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/components/calendar/FacetPanel.tsx frontend/components/calendar/DateRangeChip.tsx
git commit -m "feat(tournois): FacetPanel sur FacetChip partage + DateRangeChip teintable"
```

---

### Task 5: Migrer `DiscoverMatches` (/decouvrir)

**Files:**
- Modify: `frontend/components/discover/DiscoverMatches.tsx`
- Tests existants (contrat inchangé) : `frontend/__tests__/DiscoverMatches.test.tsx`, `frontend/__tests__/DiscoverPage.test.tsx`

- [ ] **Step 1: Migrer les imports et ajouter les teintes**

Dans `DiscoverMatches.tsx` :

1. Remplacer `import { FacetChip, FacetGroup } from '@/components/calendar/FacetPanel';` par `import { FacetChip, FacetGroup, FILTER_TINTS } from '@/components/ui/FacetChip';`
2. Remplacer le tiroir de filtres :

```tsx
<FacetGroup label="Quand" tint={FILTER_TINTS.quand}>
  {PERIOD_OPTIONS.map((o) => (
    <FacetChip key={o.value} label={o.label} tint={FILTER_TINTS.quand} active={period === o.value} onClick={() => setPeriod(o.value)} />
  ))}
</FacetGroup>
{levelChipVisible && (
  <FacetGroup label="Niveau" tint={FILTER_TINTS.niveau}>
    <FacetChip label="À mon niveau" tint={FILTER_TINTS.niveau} active={levelOn} onClick={() => setLevelOn((v) => !v)} />
  </FacetGroup>
)}
```

(plus aucun `th={th}` — le composant partagé lit le thème lui-même).

- [ ] **Step 2: Lancer les suites concernées**

Run: `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/DiscoverMatches.test.tsx __tests__/DiscoverPage.test.tsx`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/components/discover/DiscoverMatches.tsx
git commit -m "feat(decouvrir): filtres sur FacetChip partage (Quand emeraude, Niveau bleu)"
```

---

### Task 6: Vérifications globales (types, suites, visuel)

**Files:** aucun nouveau — vérification.

- [ ] **Step 1: Type-check**

Run: `cd frontend && node node_modules/typescript/bin/tsc --noEmit`
Expected: aucune erreur dans les fichiers touchés par ce plan (`components/ui/FacetChip.tsx`, `MatchesFilterBar.tsx`, `EventsFilterBar.tsx`, `FacetPanel.tsx`, `DateRangeChip.tsx`, `DiscoverMatches.tsx`, `__tests__/FacetChip.test.tsx`). ⚠️ Le WIP parallèle d'Eric peut produire des erreurs dans d'autres fichiers — les ignorer (filtrer la sortie sur nos chemins), ne surtout pas les « corriger ».

- [ ] **Step 2: Toutes les suites du périmètre en un run**

Run: `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/FacetChip.test.tsx __tests__/MatchesFilterBar.test.tsx __tests__/OpenMatches.test.tsx __tests__/EventsFilterBar.test.tsx __tests__/FacetPanel.test.tsx __tests__/TournamentFinder.test.tsx __tests__/DiscoverMatches.test.tsx __tests__/DiscoverPage.test.tsx`
Expected: PASS. (Ne PAS lancer la suite complète `jest` sans ciblage : flake d'isolation BookingModal connu, hors périmètre.)

- [ ] **Step 3: Vérification visuelle CDP (skill `verify`)**

Avec la stack dev lancée (`start.ps1` si besoin), vérifier via le skill projet `verify` :
- `/parties` (hôte club `padel-arena-paris.localhost:3000`) — groupe Niveau bleu (pastille + chip active), Type de partie corail, footer alertes intact ;
- `/events` (hôte club) — Source apricot, Quand émeraude, Catégorie violet ; chips à 0 estompées ;
- `/tournois` (hôte plateforme `localhost:3000`) — Quand émeraude (+ DateRangeChip active émeraude), Où bleu (« Autour de moi » compris), Catégorie violet, Genre cyan ;
- `/decouvrir` (hôte plateforme) — Quand émeraude, « À mon niveau » bleu (connecté `test@palova.fr`).

À chaque fois : thème clair ET sombre, desktop 1280 ET mobile 390 (⚠️ `mobile:false` + largeur fixe 390, sinon l'émulation masque les débordements). Aucun débordement horizontal.

- [ ] **Step 4: Mettre à jour CLAUDE.md (jalon) et committer**

Ajouter une entrée d'évolution dans la section adéquate de `CLAUDE.md` (une phrase : chips de filtres fusionnées en `components/ui/FacetChip.tsx` + teinte par groupe `FILTER_TINTS`, 4 surfaces, 100 % frontend, spec `2026-07-21-chips-filtres-teintes-design.md`).

```bash
git add CLAUDE.md
git commit -m "docs: jalon chips de filtres teintees par groupe"
```

---

## Self-review (fait à l'écriture du plan)

- **Couverture spec** : composant partagé (Task 1), mapping complet des 9 teintes (Task 1), les 4 surfaces (Tasks 2-5), « Autour de moi » + DateRangeChip (Task 4), tests nouveaux + suites existantes + visuel clair/sombre/mobile (Tasks 1-6). ✓
- **Aucun placeholder** ; tout le code des étapes est complet. ✓
- **Cohérence des types** : `FacetChip { label, count?, active, onClick, tint, ariaExpanded? }` et `FacetGroup { label, tint, children }` identiques dans toutes les tasks ; `DateRangeChip.tint?` optionnelle (rétro-compatible). ✓
