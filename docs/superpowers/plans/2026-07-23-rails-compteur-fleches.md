# Rails de cartes : compteur de résultats + flèches persistantes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer l'affordance implicite (carte coupée au bord + scroll libre sans
signal) de 4 rails de cartes par un compteur « N résultats » toujours visible + des
flèches ‹ › reprenant pixel pour pixel le style déjà validé dans `OffersShowcase.tsx`
(rond plein accent, superposé au bord, visible seulement quand il reste du contenu
caché de ce côté).

**Architecture:** Deux briques partagées extraites de la logique existante
d'`OffersShowcase` — un hook `useScrollRail` (suivi de bord + défilement par page) et un
atome `RailArrows` (rendu des flèches + dégradé de fondu) — plus un prop `count`
optionnel sur `SectionHeader` (clubhouse). Les 4 rails ciblés (`NationalOpenMatches`,
`OpenMatchesShowcase`, `OffersShowcase`, `FriendsAgendaRail`) se branchent dessus. Le
glisser tactile/trackpad (`.sp-scroll-x`) reste inchangé — les flèches s'ajoutent, ne
remplacent rien.

**Tech Stack:** Next.js 16 / React / TypeScript, Jest + Testing Library (`@testing-library/react`).

**Spec de référence :** `docs/superpowers/specs/2026-07-23-rails-compteur-fleches-design.md`

---

## Contexte utile à l'engineer

- Toutes les commandes de test s'exécutent depuis `frontend/` :
  `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/<Fichier>.test.tsx`
  (voir mémoire projet : les shims `node_modules/.bin` sont parfois cassés — utiliser
  cette forme directe si `npx jest` échoue avec « n'est pas reconnu »).
- Vérification de types : `node node_modules/typescript/bin/tsc --noEmit` (jest ne
  type-check pas — c'est le seul filet de type).
- `ThemeProvider`/`useTheme` viennent de `@/lib/ThemeProvider`. Le fichier
  `frontend/__tests__/FriendsAgendaRail.test.tsx` mocke ce module directement (pas de
  vrai `<ThemeProvider>`) — les autres suites de ce plan utilisent le vrai
  `<ThemeProvider>` de `@/lib/ThemeProvider`.
- jsdom ne calcule aucun layout réel : `scrollWidth`/`clientWidth`/`scrollLeft` valent
  toujours 0 par défaut sur un élément. Pour tester la détection de bord du hook, il
  faut forcer ces propriétés avec `Object.defineProperty` (technique déjà utilisée
  ailleurs dans l'écosystème jsdom, détaillée Tâche 1).
- Aucune migration, aucun changement backend — 100% frontend.

---

### Task 1: Hook partagé `useScrollRail`

**Files:**
- Create: `frontend/lib/useScrollRail.ts`
- Test: `frontend/__tests__/useScrollRail.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/__tests__/useScrollRail.test.tsx`:

```tsx
import { render, act, fireEvent } from '@testing-library/react';
import { useScrollRail } from '@/lib/useScrollRail';

function setLayout(el: HTMLElement, vals: { scrollWidth: number; clientWidth: number; scrollLeft: number }) {
  Object.defineProperty(el, 'scrollWidth', { value: vals.scrollWidth, configurable: true });
  Object.defineProperty(el, 'clientWidth', { value: vals.clientWidth, configurable: true });
  Object.defineProperty(el, 'scrollLeft', { value: vals.scrollLeft, configurable: true, writable: true });
}

let lastEdges: { left: boolean; right: boolean } | null = null;
let lastScrollByPage: ((dir: 1 | -1) => void) | null = null;

function Harness({ count }: { count: number }) {
  const { railRef, edges, scrollByPage } = useScrollRail([count]);
  lastEdges = edges;
  lastScrollByPage = scrollByPage;
  return (
    <div ref={railRef} data-testid="rail">
      {Array.from({ length: count }, (_, i) => <span key={i}>item{i}</span>)}
    </div>
  );
}

beforeEach(() => { lastEdges = null; lastScrollByPage = null; });

it('mesure les bords au montage : aucun débordement mesuré → aucune flèche', () => {
  render(<Harness count={3} />);
  expect(lastEdges).toEqual({ left: false, right: false });
});

it('edges.right vrai quand le contenu déborde à droite', () => {
  const { getByTestId } = render(<Harness count={6} />);
  const rail = getByTestId('rail');
  setLayout(rail, { scrollWidth: 800, clientWidth: 300, scrollLeft: 0 });
  act(() => { fireEvent.scroll(rail); });
  expect(lastEdges).toEqual({ left: false, right: true });
});

it('edges.left vrai après défilement, edges.right faux en bout de rail', () => {
  const { getByTestId } = render(<Harness count={6} />);
  const rail = getByTestId('rail');
  setLayout(rail, { scrollWidth: 800, clientWidth: 300, scrollLeft: 500 });
  act(() => { fireEvent.scroll(rail); });
  expect(lastEdges).toEqual({ left: true, right: false });
});

it('scrollByPage appelle scrollBy avec 80% de la largeur visible, dans les deux sens', () => {
  const { getByTestId } = render(<Harness count={6} />);
  const rail = getByTestId('rail');
  setLayout(rail, { scrollWidth: 800, clientWidth: 300, scrollLeft: 0 });
  (rail as unknown as { scrollBy: jest.Mock }).scrollBy = jest.fn();
  act(() => { lastScrollByPage!(1); });
  expect(rail.scrollBy).toHaveBeenCalledWith({ left: 240, behavior: 'smooth' });
  act(() => { lastScrollByPage!(-1); });
  expect(rail.scrollBy).toHaveBeenCalledWith({ left: -240, behavior: 'smooth' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/useScrollRail.test.tsx`
Expected: FAIL — `Cannot find module '@/lib/useScrollRail'`

- [ ] **Step 3: Write the implementation**

Create `frontend/lib/useScrollRail.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';

export type ScrollRailEdges = { left: boolean; right: boolean };

/** Factorise le suivi de bord gauche/droite + le défilement par page d'un rail
 *  horizontal scrollable (`.sp-scroll-x`). `deps` redéclenche la mesure quand le
 *  contenu change (ex. le nombre de cartes). Extrait de la logique historique
 *  d'`OffersShowcase` — même calcul, même seuil de 4px, même ratio de page (80%). */
export function useScrollRail(deps: readonly unknown[]) {
  const railRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<ScrollRailEdges>({ left: false, right: false });

  const measure = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft < max - 4 });
  }, []);

  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => { el.removeEventListener('scroll', measure); window.removeEventListener('resize', measure); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const scrollByPage = (dir: 1 | -1) => {
    const el = railRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' });
  };

  return { railRef, edges, scrollByPage };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/useScrollRail.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/useScrollRail.ts frontend/__tests__/useScrollRail.test.tsx
git commit -m "feat(ui): add useScrollRail hook (edge tracking + page scroll)"
```

---

### Task 2: Atome partagé `RailArrows`

**Files:**
- Create: `frontend/components/ui/RailArrows.tsx`
- Test: `frontend/__tests__/RailArrows.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/__tests__/RailArrows.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { RailArrows } from '@/components/ui/RailArrows';

const wrap = (edges: { left: boolean; right: boolean }, onPrev = jest.fn(), onNext = jest.fn()) =>
  render(
    <ThemeProvider>
      <div style={{ position: 'relative' }}>
        <RailArrows edges={edges} onPrev={onPrev} onNext={onNext} prevLabel="Précédent" nextLabel="Suivant" />
      </div>
    </ThemeProvider>,
  );

it('aucune flèche si les deux bords sont fermés', () => {
  wrap({ left: false, right: false });
  expect(screen.queryByRole('button')).toBeNull();
});

it('flèche droite seule visible en début de rail', () => {
  wrap({ left: false, right: true });
  expect(screen.queryByRole('button', { name: 'Précédent' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Suivant' })).toBeInTheDocument();
});

it('flèche gauche seule visible en fin de rail', () => {
  wrap({ left: true, right: false });
  expect(screen.getByRole('button', { name: 'Précédent' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Suivant' })).toBeNull();
});

it('clic sur chaque flèche déclenche onPrev/onNext', () => {
  const onPrev = jest.fn();
  const onNext = jest.fn();
  wrap({ left: true, right: true }, onPrev, onNext);
  fireEvent.click(screen.getByRole('button', { name: 'Précédent' }));
  fireEvent.click(screen.getByRole('button', { name: 'Suivant' }));
  expect(onPrev).toHaveBeenCalledTimes(1);
  expect(onNext).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/RailArrows.test.tsx`
Expected: FAIL — `Cannot find module '@/components/ui/RailArrows'`

- [ ] **Step 3: Write the implementation**

Create `frontend/components/ui/RailArrows.tsx`:

```tsx
'use client';
import { CSSProperties } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { inkOn } from '@/lib/theme';
import type { ScrollRailEdges } from '@/lib/useScrollRail';

/** Flèches de défilement superposées au bord d'un rail de cartes horizontal — rond
 *  plein accent, dégradé de fondu, visibles seulement quand il reste du contenu caché
 *  de ce côté (pas de grisé : la flèche disparaît à l'extrémité). Style repris pixel
 *  pour pixel de l'implémentation historique d'`OffersShowcase` (validé par Eric sur
 *  capture). À poser en enfant d'un conteneur `position:'relative'` qui NE défile PAS
 *  lui-même (sibling du rail `.sp-scroll-x`, pas son parent direct scrollable) —
 *  sinon les boutons défileraient avec le contenu. `fadeBottom` = inset bas du
 *  dégradé, à aligner sur le padding bas de la rangée hôte (chaque rail a le sien). */
export function RailArrows({ edges, onPrev, onNext, prevLabel, nextLabel, fadeBottom = 14 }: {
  edges: ScrollRailEdges;
  onPrev: () => void;
  onNext: () => void;
  prevLabel: string;
  nextLabel: string;
  fadeBottom?: number;
}) {
  const { th } = useTheme();
  const navBtn = (side: 'left' | 'right'): CSSProperties => ({
    position: 'absolute', [side]: 8, top: '50%', transform: 'translateY(-50%)', width: 38, height: 38,
    borderRadius: 99, border: `2px solid ${th.surface}`, background: th.accent, color: inkOn(th.accent),
    boxShadow: '0 3px 12px rgba(0,0,0,0.28)', fontSize: 20, fontWeight: 800, lineHeight: 1, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2, fontFamily: th.fontUI,
  });
  const fade = (side: 'left' | 'right'): CSSProperties => ({
    position: 'absolute', [side]: 0, top: 0, bottom: fadeBottom, width: 48, pointerEvents: 'none',
    background: `linear-gradient(to ${side === 'left' ? 'right' : 'left'}, ${th.bg}, transparent)`,
  });
  return (
    <>
      {edges.left && <span aria-hidden style={fade('left')} />}
      {edges.right && <span aria-hidden style={fade('right')} />}
      {edges.left && <button type="button" aria-label={prevLabel} onClick={onPrev} style={navBtn('left')}>‹</button>}
      {edges.right && <button type="button" aria-label={nextLabel} onClick={onNext} style={navBtn('right')}>›</button>}
    </>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/RailArrows.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/components/ui/RailArrows.tsx frontend/__tests__/RailArrows.test.tsx
git commit -m "feat(ui): add RailArrows (shared scroll-rail arrow buttons)"
```

---

### Task 3: `SectionHeader` (clubhouse) gagne un compteur optionnel

**Files:**
- Modify: `frontend/components/clubhouse/SectionHeader.tsx:26-38`
- Test: Create `frontend/__tests__/SectionHeader.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/__tests__/SectionHeader.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { SectionHeader } from '@/components/clubhouse/SectionHeader';

const wrap = (props: React.ComponentProps<typeof SectionHeader>) =>
  render(<ThemeProvider><SectionHeader {...props} /></ThemeProvider>);

it('titre seul : ni compteur ni lien', () => {
  wrap({ title: 'Ça joue bientôt' });
  expect(screen.getByRole('heading', { name: 'Ça joue bientôt' })).toBeInTheDocument();
  expect(screen.queryByText(/résultat|offre|partie/)).toBeNull();
  expect(screen.queryByRole('link')).toBeNull();
});

it('compteur seul, sans lien « voir tout »', () => {
  wrap({ title: 'Abonnements & offres', count: '4 offres' });
  expect(screen.getByText('4 offres')).toBeInTheDocument();
  expect(screen.queryByRole('link')).toBeNull();
});

it('compteur + lien « voir tout » ensemble', () => {
  wrap({ title: 'Ça joue bientôt', count: '4 parties', action: { label: 'Toutes les parties →', href: '/parties' } });
  expect(screen.getByText('4 parties')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Toutes les parties →' })).toHaveAttribute('href', '/parties');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/SectionHeader.test.tsx`
Expected: FAIL — the 2nd and 3rd tests fail (`count` prop not rendered, "4 offres"/"4 parties" not found)

- [ ] **Step 3: Modify the implementation**

In `frontend/components/clubhouse/SectionHeader.tsx`, replace the `SectionHeader` function
(lines 26-38) with:

```tsx
/** Titre de section éditorial : display 21px + compteur optionnel + action optionnelle à droite. */
export function SectionHeader({ title, action, count }: { title: string; action?: { label: string; href: string }; count?: string }) {
  const { th } = useTheme();
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 13 }}>
      <h2 style={{ margin: 0, fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 21, letterSpacing: -0.3, color: th.text }}>{title}</h2>
      {count && (
        <span style={{ marginLeft: 'auto', fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, whiteSpace: 'nowrap' }}>{count}</span>
      )}
      {action && (
        <Link href={action.href} style={{ marginLeft: count ? 0 : 'auto', fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, color: th.accent, textDecoration: 'none', whiteSpace: 'nowrap' }}>
          {action.label}
        </Link>
      )}
    </div>
  );
}
```

(Only the `SectionHeader` function changes — `cardStyle` and `listRowStyle` above it are untouched.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/SectionHeader.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Run the full frontend test suite to check for regressions**

Run: `node node_modules/jest/bin/jest.js --testPathPattern "OpenMatchesShowcase|OffersShowcase|FriendsAgendaRail"`
Expected: PASS (existing suites unaffected — `count` is optional, no existing caller passes it yet)

- [ ] **Step 6: Commit**

```bash
git add frontend/components/clubhouse/SectionHeader.tsx frontend/__tests__/SectionHeader.test.tsx
git commit -m "feat(club-house): SectionHeader gains an optional result counter"
```

---

### Task 4: Brancher `OffersShowcase` (remplace son implémentation locale)

**Files:**
- Modify: `frontend/components/clubhouse/OffersShowcase.tsx:1-14,69-84,96-123,170-206`
- Modify: `frontend/__tests__/OffersShowcase.test.tsx`

- [ ] **Step 1: Write the failing test**

In `frontend/__tests__/OffersShowcase.test.tsx`, add this test at the end of the
`describe('OffersShowcase', ...)` block (just before the closing `});`):

```tsx
  it('affiche le compteur de résultats (total des cartes, tous groupes confondus)', () => {
    wrap({});
    expect(screen.getByText('2 offres')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/OffersShowcase.test.tsx`
Expected: FAIL — `Unable to find an element with the text: 2 offres`

- [ ] **Step 3: Update the imports**

In `frontend/components/clubhouse/OffersShowcase.tsx`, replace lines 1-14 with:

```tsx
'use client';
import { useState } from 'react';
import dynamic from 'next/dynamic';
import { api, assetUrl, ClubDetail, PublicOffers, PublicPlan, PublicPackageTemplate } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { useClub } from '@/lib/ClubProvider';
import { sportTag, clubIsMultiSport } from '@/lib/sportBadge';
import { offerTint, sportOfferTint, sportKeyColor, sportGroupLabel, groupOffersBySport } from '@/lib/adminOffers';
import { Btn } from '@/components/ui/atoms';
import { SectionHeader, cardStyle } from '@/components/clubhouse/SectionHeader';
import { CgvGate } from '@/components/CgvGate';
import { useScrollRail } from '@/lib/useScrollRail';
import { RailArrows } from '@/components/ui/RailArrows';
```

(`CSSProperties`, `useEffect`, `useRef`, `inkOn` are no longer used directly by this
file — they move into the shared `RailArrows`/`useScrollRail`.)

- [ ] **Step 4: Replace the edge-tracking block with the shared hook**

Replace (around line 69-84):

```tsx
  // Affordance de défilement : on affiche un dégradé + un chevron à gauche/droite seulement
  // quand il reste des cartes cachées de ce côté (signale clairement « il y a plus à voir »).
  const railRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<{ left: boolean; right: boolean }>({ left: false, right: false });
  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft < max - 4 });
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => { el.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, [offers.plans.length, offers.packages.length]);
```

with:

```tsx
  const { railRef, edges, scrollByPage } = useScrollRail([offers.plans.length, offers.packages.length]);
```

- [ ] **Step 5: Remove the local `scrollByPage`/`navBtn`/`fade` + add the count label**

Remove (around old line 113-123):

```tsx
  const scrollByPage = (dir: number) => railRef.current?.scrollBy({ left: dir * railRef.current.clientWidth * 0.8, behavior: 'smooth' });
  const navBtn = (side: 'left' | 'right'): CSSProperties => ({
    position: 'absolute', [side]: 8, top: '50%', transform: 'translateY(-50%)', width: 38, height: 38,
    borderRadius: 99, border: `2px solid ${th.surface}`, background: th.accent, color: inkOn(th.accent),
    boxShadow: '0 3px 12px rgba(0,0,0,0.28)', fontSize: 20, fontWeight: 800, lineHeight: 1, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2, fontFamily: th.fontUI,
  });
  const fade = (side: 'left' | 'right'): CSSProperties => ({
    position: 'absolute', [side]: 0, top: 0, bottom: 14, width: 48, pointerEvents: 'none',
    background: `linear-gradient(to ${side === 'left' ? 'right' : 'left'}, ${th.bg}, transparent)`,
  });
```

Just above it, right after the `groups` computation (which reads `cardEntries.length`), add:

```tsx
  const count = `${cardEntries.length} offre${cardEntries.length > 1 ? 's' : ''}`;
```

(`cardEntries` and `groups` themselves are unchanged.)

- [ ] **Step 6: Wire the header + replace the arrow markup**

In the `return`, change:

```tsx
      <SectionHeader title="Abonnements & offres" />
```

to:

```tsx
      <SectionHeader title="Abonnements & offres" count={count} />
```

Then replace the closing block of the scroll wrapper (around old line 202-206):

```tsx
        {edges.left && <span aria-hidden style={fade('left')} />}
        {edges.right && <span aria-hidden style={fade('right')} />}
        {edges.left && <button type="button" aria-label="Offres précédentes" onClick={() => scrollByPage(-1)} style={navBtn('left')}>‹</button>}
        {edges.right && <button type="button" aria-label="Voir plus d’offres" onClick={() => scrollByPage(1)} style={navBtn('right')}>›</button>}
      </div>
```

with:

```tsx
        <RailArrows edges={edges} onPrev={() => scrollByPage(-1)} onNext={() => scrollByPage(1)} prevLabel="Offres précédentes" nextLabel="Voir plus d’offres" fadeBottom={14} />
      </div>
```

- [ ] **Step 7: Run test to verify it passes**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/OffersShowcase.test.tsx`
Expected: PASS (all tests, including the new one)

- [ ] **Step 8: Type-check**

Run: `node node_modules/typescript/bin/tsc --noEmit`
Expected: no new errors from `OffersShowcase.tsx`

- [ ] **Step 9: Commit**

```bash
git add frontend/components/clubhouse/OffersShowcase.tsx frontend/__tests__/OffersShowcase.test.tsx
git commit -m "feat(club-house): offers rail uses the shared scroll-rail counter+arrows"
```

---

### Task 5: Brancher `OpenMatchesShowcase`

**Files:**
- Modify: `frontend/components/clubhouse/OpenMatchesShowcase.tsx` (full file)
- Modify: `frontend/__tests__/OpenMatchesShowcase.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `frontend/__tests__/OpenMatchesShowcase.test.tsx`, add these two tests at the end of
the `describe('OpenMatchesShowcase', ...)` block:

```tsx
  it('affiche le compteur de résultats', () => {
    wrap([match({})]);
    expect(screen.getByText('1 partie')).toBeInTheDocument();
  });

  it('le compteur reflète le plafond de 6 cartes, pas le total réel', () => {
    wrap(Array.from({ length: 8 }, (_, i) => match({ id: `m${i}` })));
    expect(screen.getByText('6 parties')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/OpenMatchesShowcase.test.tsx`
Expected: FAIL on the 2 new tests — `Unable to find an element with the text: 1 partie` / `6 parties`

- [ ] **Step 3: Write the implementation**

Replace the entire content of `frontend/components/clubhouse/OpenMatchesShowcase.tsx` with:

```tsx
'use client';
import Link from 'next/link';
import { OpenMatch } from '@/lib/api';
import { matchSeats } from '@/lib/clubhouse';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { formatDateShort, formatDateShortTimeRange, formatHourRange } from '@/lib/tournament';
import { rangeLabel } from '@/lib/levelMatch';
import { colorForSeed } from '@/lib/playerColors';
import { Avatar } from '@/components/ui/Avatar';
import { SectionHeader, cardStyle } from '@/components/clubhouse/SectionHeader';
import { useScrollRail } from '@/lib/useScrollRail';
import { RailArrows } from '@/components/ui/RailArrows';

// Section vedette « Ça joue bientôt » : grandes cartes parties ouvertes en défilement
// horizontal snap. On VOIT les places à prendre (sièges vides en pointillés) ; clic → /parties/[id].
export function OpenMatchesShowcase({ matches, timezone }: { matches: OpenMatch[]; timezone: string }) {
  const { th } = useTheme();
  const shown = matches.slice(0, 6);
  const { railRef, edges, scrollByPage } = useScrollRail([shown.length]);
  if (matches.length === 0) return null;
  const count = `${shown.length} partie${shown.length > 1 ? 's' : ''}`;
  return (
    <section id="ch-matches">
      <SectionHeader title="Ça joue bientôt" action={{ label: 'Toutes les parties →', href: '/parties' }} count={count} />
      <div style={{ position: 'relative', margin: '0 -20px' }}>
        {/* scrollPaddingLeft = padding-left : sans lui, le snap `mandatory` cale la 1re carte sur le
            bord du snapport dès le montage (scrollLeft 20) et mange le padding → rail désaligné du titre. */}
        <div ref={railRef} className="sp-scroll-x" style={{ display: 'flex', gap: 12, padding: '4px 20px 14px', scrollSnapType: 'x mandatory', scrollPaddingLeft: 20 }}>
          {shown.map((m) => {
            const empty = matchSeats(m);
            const urgent = !m.full && m.spotsLeft === 1;
            const level = (m.targetLevelMin != null || m.targetLevelMax != null)
              ? rangeLabel(m.targetLevelMin ?? null, m.targetLevelMax ?? null) : null;
            const genderLabel = m.gender === 'WOMEN' ? 'Féminine' : m.gender === 'MIXED' ? 'Mixte' : null;
            const when = formatDateShortTimeRange(m.startTime, m.endTime, timezone);
            const dateLabel = formatDateShort(m.startTime, timezone);
            const timeLabel = formatHourRange(m.startTime, m.endTime, timezone);
            return (
              <article key={m.id} style={{ ...cardStyle(th), flex: '0 0 272px', scrollSnapAlign: 'start', padding: '16px 16px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  {/* date et heure sur 2 lignes distinctes — un saut de ligne au milieu de « → 09h30 »
                      apparaissait selon la longueur du texte (largeur de carte fixe, texte variable) */}
                  <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 18, letterSpacing: -0.2, color: th.text, whiteSpace: 'nowrap' }}>{dateLabel}</div>
                  <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 18, letterSpacing: -0.2, color: th.text, whiteSpace: 'nowrap' }}>{timeLabel}</div>
                  <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginTop: 3 }}>
                    {m.resourceName}{level ? ` · ${level}` : ''}{genderLabel ? ` · ${genderLabel}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center' }} aria-label={m.full ? 'Complet' : `${m.spotsLeft} place${m.spotsLeft > 1 ? 's' : ''} à prendre`}>
                  {m.players.map((p, i) => (
                    <span key={p.userId} style={{ marginLeft: i === 0 ? 0 : -9, borderRadius: '50%', boxShadow: `0 0 0 2.5px ${th.surface}`, lineHeight: 0 }}>
                      <Avatar firstName={p.firstName} lastName={p.lastName} avatarUrl={p.avatarUrl} size={36} color={colorForSeed(p.userId)} />
                    </span>
                  ))}
                  {Array.from({ length: empty }, (_, i) => (
                    <span key={`e${i}`} data-testid="empty-seat" aria-hidden="true" style={{
                      width: 36, height: 36, borderRadius: '50%', marginLeft: m.players.length + i === 0 ? 0 : -9, boxSizing: 'border-box',
                      border: `2px dashed ${urgent ? ACCENTS.coral : th.lineStrong}`, background: th.surface,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      fontFamily: th.fontUI, fontSize: 15, fontWeight: 700, color: urgent ? ACCENTS.coral : th.textFaint,
                    }}>+</span>
                  ))}
                  <span style={{
                    marginLeft: 'auto', fontFamily: th.fontUI, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', borderRadius: 999, padding: '4px 10px',
                    background: m.full ? th.surface2 : urgent ? (th.mode === 'floodlit' ? `${ACCENTS.coral}26` : `${ACCENTS.coral}33`) : (th.mode === 'floodlit' ? `${th.accent}26` : `${th.accent}33`),
                    color: m.full ? th.textMute : urgent ? (th.mode === 'floodlit' ? ACCENTS.coral : th.ink) : (th.mode === 'floodlit' ? th.accent : th.ink),
                  }}>
                    {m.full ? 'Complet' : `${m.spotsLeft} place${m.spotsLeft > 1 ? 's' : ''}`}
                  </span>
                </div>
                <Link href={`/parties/${m.id}`} aria-label={`${m.full ? 'Voir' : 'Rejoindre'} la partie du ${when}`} style={{
                  textAlign: 'center', textDecoration: 'none', borderRadius: 11, padding: '10px 12px',
                  fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700,
                  background: m.full ? th.surface2 : th.accent, color: m.full ? th.text : th.onAccent,
                }}>
                  {m.full ? 'Voir la partie' : 'Rejoindre'}
                </Link>
              </article>
            );
          })}
        </div>
        <RailArrows edges={edges} onPrev={() => scrollByPage(-1)} onNext={() => scrollByPage(1)} prevLabel="Parties précédentes" nextLabel="Parties suivantes" fadeBottom={14} />
      </div>
    </section>
  );
}
```

(The card markup is byte-for-byte identical to before — only the top of the function,
the header call, and the wrapper/arrows around the scrollable row changed.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/OpenMatchesShowcase.test.tsx`
Expected: PASS (all tests, including the 2 new ones)

- [ ] **Step 5: Type-check**

Run: `node node_modules/typescript/bin/tsc --noEmit`
Expected: no new errors from `OpenMatchesShowcase.tsx`

- [ ] **Step 6: Commit**

```bash
git add frontend/components/clubhouse/OpenMatchesShowcase.tsx frontend/__tests__/OpenMatchesShowcase.test.tsx
git commit -m "feat(club-house): open-matches showcase gains result counter + arrows"
```

---

### Task 6: Brancher `FriendsAgendaRail`

**Files:**
- Modify: `frontend/components/social/FriendsAgendaRail.tsx` (full file)
- Modify: `frontend/__tests__/FriendsAgendaRail.test.tsx`

- [ ] **Step 1: Write the failing test**

In `frontend/__tests__/FriendsAgendaRail.test.tsx`, add this test after the existing
`it('carte → navigation vers la partie', ...)` block:

```tsx
it('affiche le compteur de résultats', () => {
  render(<FriendsAgendaRail items={[item, { ...item, id: 'r2', kind: 'event' as const, label: 'Soirée padel' }]} timezone="Europe/Paris" />);
  expect(screen.getByText('2 résultats')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/FriendsAgendaRail.test.tsx`
Expected: FAIL — `Unable to find an element with the text: 2 résultats`

- [ ] **Step 3: Write the implementation**

Replace the entire content of `frontend/components/social/FriendsAgendaRail.tsx` with:

```tsx
'use client';
import { useRouter } from 'next/navigation';
import { FriendsAgendaItem } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';
import { cardStyle, SectionHeader } from '@/components/clubhouse/SectionHeader';
import { agendaWhenLabel } from '@/lib/social';
import { useScrollRail } from '@/lib/useScrollRail';
import { RailArrows } from '@/components/ui/RailArrows';

const HREF: Record<FriendsAgendaItem['kind'], (id: string) => string> = {
  match: (id) => `/parties/${id}`,
  tournament: (id) => `/tournois/${id}`,
  event: (id) => `/events/${id}`,
};

// Rail « Ça joue bientôt » : où jouent mes amis/favoris prochainement. Masqué si vide.
export function FriendsAgendaRail({ items, timezone }: { items: FriendsAgendaItem[]; timezone: string }) {
  const { th } = useTheme();
  const router = useRouter();
  const { railRef, edges, scrollByPage } = useScrollRail([items.length]);
  if (items.length === 0) return null;
  const count = `${items.length} résultat${items.length > 1 ? 's' : ''}`;
  return (
    <section aria-label="Ça joue bientôt">
      <SectionHeader title="Ça joue bientôt" count={count} />
      <div style={{ position: 'relative', margin: '0 -20px' }}>
        <div ref={railRef} className="sp-scroll-x" style={{ display: 'flex', gap: 10, padding: '4px 20px 8px', scrollSnapType: 'x proximity' }}>
          {items.map((it) => (
            <button key={`${it.kind}-${it.id}`} type="button" onClick={() => router.push(HREF[it.kind](it.id))}
              style={{ ...cardStyle(th), scrollSnapAlign: 'start', flex: '0 0 auto', width: 190,
                padding: '12px 13px', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
              <div style={{ fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 800, letterSpacing: 0.3, color: th.accent, textTransform: 'uppercase' }}>
                {agendaWhenLabel(it.startTime, timezone)}
              </div>
              <div style={{ fontFamily: th.fontUI, fontSize: 14, fontWeight: 700, color: th.text, margin: '4px 0 8px',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {it.label}
              </div>
              <div style={{ display: 'flex' }}>
                {it.friends.map((f, i) => (
                  <span key={f.id} style={{ marginLeft: i === 0 ? 0 : -8, display: 'inline-flex', borderRadius: '50%', boxShadow: `0 0 0 2px ${th.surface}` }}>
                    <Avatar firstName={f.firstName} lastName={f.lastName} avatarUrl={f.avatarUrl} size={26} color={colorForSeed(f.id)} />
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>
        <RailArrows edges={edges} onPrev={() => scrollByPage(-1)} onNext={() => scrollByPage(1)} prevLabel="Résultats précédents" nextLabel="Résultats suivants" fadeBottom={8} />
      </div>
    </section>
  );
}
```

(Only change to the row itself: it now sits inside a `position:'relative'` wrapper
that bleeds full-width — `margin:'0 -20px'` — with the row's own padding gaining
`20px` horizontal insets, so the arrows land in a clean gutter instead of overlapping
the first/last card. Card markup unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/FriendsAgendaRail.test.tsx`
Expected: PASS (all tests, including the new one)

- [ ] **Step 5: Type-check**

Run: `node node_modules/typescript/bin/tsc --noEmit`
Expected: no new errors from `FriendsAgendaRail.tsx`

- [ ] **Step 6: Commit**

```bash
git add frontend/components/social/FriendsAgendaRail.tsx frontend/__tests__/FriendsAgendaRail.test.tsx
git commit -m "feat(social): friends agenda rail gains result counter + arrows"
```

---

### Task 7: Brancher `NationalOpenMatches`

**Files:**
- Modify: `frontend/components/platform/NationalOpenMatches.tsx` (full file)
- Modify: `frontend/__tests__/NationalOpenMatches.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `frontend/__tests__/NationalOpenMatches.test.tsx`, add these two tests inside the
`describe('NationalOpenMatches', ...)` block, right before the closing `});`:

```tsx
  it('affiche le compteur au singulier pour 1 résultat', () => {
    wrap([makeMatch()]);
    expect(screen.getByText('1 partie')).toBeInTheDocument();
  });

  it('affiche le compteur au pluriel pour plusieurs résultats', () => {
    wrap([makeMatch(), makeMatch({ id: 'm2' })]);
    expect(screen.getByText('2 parties')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/NationalOpenMatches.test.tsx`
Expected: FAIL — `Unable to find an element with the text: 1 partie` / `2 parties`

- [ ] **Step 3: Write the implementation**

Replace the entire content of `frontend/components/platform/NationalOpenMatches.tsx` with:

```tsx
'use client';
import { NationalOpenMatch } from '@/lib/api';
import { NationalMatchCard } from '@/components/platform/NationalMatchCard';
import { useTheme } from '@/lib/ThemeProvider';
import { useScrollRail } from '@/lib/useScrollRail';
import { RailArrows } from '@/components/ui/RailArrows';

// Rail vedette de la vitrine palova.fr : les parties ouvertes publiques de tous les clubs,
// en grandes cartes snap-scroll (pattern OpenMatchesShowcase du club-house) enrichies de
// l'identité du club. Clic → la page partageable /parties/[id] sur le sous-domaine du club
// (le visiteur y retrouve le parcours rejoindre + invite de connexion). Vide → rien rendu.
// Pas d'en-tête propre — ses 2 appelants (HomeMatchesRail, AnonymousView) ont chacun le
// leur, différent — donc le compteur de résultats est affiché ici, en ligne discrète
// juste au-dessus du rail.
export function NationalOpenMatches({ matches }: { matches: NationalOpenMatch[] }) {
  const { th } = useTheme();
  const { railRef, edges, scrollByPage } = useScrollRail([matches.length]);
  if (matches.length === 0) return null;
  const count = `${matches.length} partie${matches.length > 1 ? 's' : ''}`;
  return (
    <div>
      <div style={{ textAlign: 'right', fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute }}>{count}</div>
      <div style={{ position: 'relative', margin: '0 -20px' }}>
        {/* scrollPaddingLeft = padding-left : sans lui le snap `mandatory` mange le padding au montage. */}
        <div ref={railRef} className="sp-scroll-x" style={{ display: 'flex', gap: 14, padding: '16px 20px 18px', scrollSnapType: 'x mandatory', scrollPaddingLeft: 20 }}>
          {matches.map((m) => (
            <NationalMatchCard key={m.id} match={m} style={{ flex: '0 0 282px', scrollSnapAlign: 'start' }} />
          ))}
        </div>
        <RailArrows edges={edges} onPrev={() => scrollByPage(-1)} onNext={() => scrollByPage(1)} prevLabel="Parties précédentes" nextLabel="Parties suivantes" fadeBottom={18} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/NationalOpenMatches.test.tsx`
Expected: PASS (all tests, including the 2 new ones)

- [ ] **Step 5: Type-check**

Run: `node node_modules/typescript/bin/tsc --noEmit`
Expected: no new errors from `NationalOpenMatches.tsx`

- [ ] **Step 6: Commit**

```bash
git add frontend/components/platform/NationalOpenMatches.tsx frontend/__tests__/NationalOpenMatches.test.tsx
git commit -m "feat(platform): national open-matches rail gains result counter + arrows"
```

---

### Task 8: Vérification finale

**Files:** none (verification only)

- [ ] **Step 1: Run the full frontend test suite**

Run: `node node_modules/jest/bin/jest.js`
Expected: PASS — no regressions. (Note: per project memory, a full run may show a
handful of pre-existing `BookingModal` test-isolation flakes unrelated to this work —
if seen, re-run those specific suites in isolation to confirm they're the known flake,
not a new regression.)

- [ ] **Step 2: Full type-check**

Run: `node node_modules/typescript/bin/tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Visual verification (CDP)**

Start the dev stack per `CLAUDE.md` (`docker-compose-v1.exe up -d`, backend `npm run
dev`, frontend `npm run dev`), then use the `verify` skill (or manual Chrome/CDP) to
check, in both light and dark theme, desktop (1280) and mobile (390):

- `/` (Mon Palova, connected player) — « Parties à rejoindre » rail: counter text
  present, arrows appear/disappear as you scroll, clicking an arrow pages the rail.
- `/` (anonymous, palova.fr host) — same rail in `AnonymousView`, same behavior.
- Club-house (`/`, club host) — « Ça joue bientôt » + offers rail: counter next to
  title, arrows match the pre-existing offers-rail look exactly (same round accent
  button, same fade).
- `/me/friends` — « Ça joue bientôt » rail (needs ≥2 upcoming items among friends to
  populate): counter + arrows, no horizontal overflow introduced by the new
  `margin:'0 -20px'` wrapper.

No code changes expected at this step unless a real visual regression is found — if
so, fix inline and re-run the affected suite + tsc before re-verifying.

---

## Self-review notes (for the plan author, already applied above)

- **Spec coverage**: all 4 in-scope components (`NationalOpenMatches`,
  `OpenMatchesShowcase`, `OffersShowcase`, `FriendsAgendaRail`) have a task; the shared
  hook, shared atom, and `SectionHeader` extension each have their own task; scope
  exclusions from the spec are not touched by any task.
- **Type consistency**: `useScrollRail(deps)` returns `{ railRef, edges, scrollByPage }`
  in every task that calls it; `RailArrows` always receives `edges`, `onPrev`, `onNext`,
  `prevLabel`, `nextLabel`, optionally `fadeBottom` — consistent across Tasks 4-7.
- **No placeholders**: every step has complete, exact code — no "similar to Task N" or
  "add appropriate styling" left unresolved.
