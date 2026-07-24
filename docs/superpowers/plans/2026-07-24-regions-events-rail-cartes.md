# Régions d'events unifiées — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unifier toutes les régions d'events (tournois, animations, parties, clubs) sur UN rail responsive partagé (`AgendaRail` : mobile = une carte à la fois + points, desktop = étagère + flèches) et UNE carte restylée « liseré éditorial ».

**Architecture:** 100 % frontend présentation, aucun backend, aucune migration. Deux briques neuves (`AgendaRail`, carte restylée dans `AgendaCardHeader`/`AgendaCard`) puis migration surface par surface. Spec : `docs/superpowers/specs/2026-07-24-regions-events-rail-cartes-design.md`.

**Tech Stack:** Next.js 16 (Turbopack), React inline styles + petits blocs `<style>` de composant (pattern existant — AUCUNE modification de `globals.css`, donc pas de piège de chunk CSS périmé), Jest + React Testing Library, `tsc --noEmit` en garde de types (jest ne type-check pas).

**Conventions d'exécution :**
- Branche courante `feat/seo-referencement`, exécution inline acceptée (pas de worktree requis — présentation pure). ⚠️ Eric édite parfois en parallèle : avant chaque commit, `git status` et ne stager QUE les fichiers du task. **Jamais de `git stash`.**
- Jest : `node node_modules/jest/bin/jest.js --runTestsByPath <fichiers>` depuis `frontend/` (les shims `.bin` sont cassés ; un chemin nu attrape d'autres suites par motif).
- tsc : `node node_modules/typescript/bin/tsc --noEmit` depuis `frontend/`.

**Écarts assumés vs spec (validés au moment du plan) :**
- Accent des animations = `ACCENTS.violet` (ce que `/events` passe déjà), pas cyan — la spec disait « les accents déjà passés par les appelants », c'est violet.
- Points de pagination masqués au-delà de 12 cartes (l'annuaire Clubs n'est pas plafonné — 30 points seraient illisibles).
- `ClubCard` : la pastille ronde accentColor flottante sur la cover est SUPPRIMÉE, remplacée par le liseré latéral (un seul marqueur d'identité).
- Club-house « Prochains events » : passe à la règle `desktopRows:'auto'` (1 rangée si ≤ 4, avant : toujours 2).

---

### Task 1 : Helper de teinte de tag lisible en mode clair — SUPERSEDED

**Statut : retiré en cours d'exécution (revue de qualité).** `frontend/lib/theme.ts` a déjà
une fonction `shade(hex: string, factor: number): string` (juste avant `inkOn`) qui fait
exactement le même calcul et sert déjà au même usage ailleurs (`memberCardUi.tsx`,
`admin/layout.tsx` : assombrir un accent pour un texte lisible sur fond clair). Le
`darkenHex` initialement prévu ici en était un doublon pur. **Utiliser `shade(accent, 0.58)`
directement dans Task 4** — aucun nouveau helper à créer. Cette tâche ne produit plus de
changement de code (le commit `feat(theme): darkenHex…` a été suivi d'un commit
`revert(theme): retirer darkenHex — doublon de shade() existant`).

<details><summary>Texte original de la tâche (archivé, ne pas exécuter)</summary>

- [ ] **Step 1 : écrire le test qui échoue**

```ts
import { darkenHex } from '../lib/theme';

describe('darkenHex', () => {
  it('assombrit chaque canal par le facteur', () => {
    expect(darkenHex('#ffffff', 0.5)).toBe('#808080');
    expect(darkenHex('#000000', 0.5)).toBe('#000000');
  });
  it('facteur 1 = couleur inchangée', () => {
    expect(darkenHex('#ef9f6a', 1)).toBe('#ef9f6a');
  });
});
```

- [ ] **Step 2 : vérifier l'échec**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/darkenHex.test.ts`
Expected: FAIL — `darkenHex` is not a function / not exported.

- [ ] **Step 3 : implémentation minimale** (dans `lib/theme.ts`, sous `inkOn`)

```ts
/** Assombrit une couleur hex (facteur 0..1 appliqué à chaque canal) — rend un accent pastel
 *  lisible en TEXTE sur fond clair (tag des cartes d'agenda) ; en floodlit on garde l'accent plein. */
export function darkenHex(hex: string, factor: number): string {
  const h = hex.replace('#', '');
  const c = (i: number) => Math.round(parseInt(h.slice(i, i + 2), 16) * factor).toString(16).padStart(2, '0');
  return `#${c(0)}${c(2)}${c(4)}`;
}
```

- [ ] **Step 4 : vérifier le vert**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/darkenHex.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5 : commit**

```bash
git add frontend/lib/theme.ts frontend/__tests__/darkenHex.test.ts
git commit -m "feat(theme): darkenHex — accent assombri lisible en texte sur fond clair"
```

</details>

---

### Task 2 : `useScrollRail` étendu (`activeIndex` + `scrollToIndex`)

**Files:**
- Modify: `frontend/lib/useScrollRail.ts`

Pas de suite dédiée (jsdom n'a ni layout ni scroll réel) — le hook est couvert via `AgendaRail.test.tsx` (Task 3). Les consommateurs existants (`edges`/`scrollByPage`) ne changent pas.

- [ ] **Step 1 : étendre le hook** — remplacer le contenu de `useScrollRail` par :

```ts
export function useScrollRail(deps: readonly unknown[]) {
  const railRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<ScrollRailEdges>({ left: false, right: false });
  const [activeIndex, setActiveIndex] = useState(0);

  const measure = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft < max - 4 });
    // Index de snap (points de pagination) : l'enfant dont l'offsetLeft est le plus proche
    // du bord gauche visible. offsetLeft est du layout (insensible au scroll), d'où le
    // décalage par kids[0].offsetLeft (= padding gauche du rail).
    const kids = Array.from(el.children) as HTMLElement[];
    if (kids.length === 0) return;
    const target = el.scrollLeft + kids[0].offsetLeft;
    let best = 0;
    for (let i = 1; i < kids.length; i++) {
      if (Math.abs(kids[i].offsetLeft - target) < Math.abs(kids[best].offsetLeft - target)) best = i;
    }
    setActiveIndex(best);
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

  const scrollToIndex = (i: number) => {
    const el = railRef.current;
    const kids = el ? (Array.from(el.children) as HTMLElement[]) : [];
    if (!el || !kids[i]) return;
    el.scrollTo({ left: kids[i].offsetLeft - kids[0].offsetLeft, behavior: 'smooth' });
  };

  return { railRef, edges, scrollByPage, activeIndex, scrollToIndex };
}
```

(Le JSDoc d'en-tête du fichier reste ; imports inchangés.)

- [ ] **Step 2 : non-régression des consommateurs actuels**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/NationalOpenMatches.test.tsx __tests__/OpenMatchesShowcase.test.tsx __tests__/ClubDirectory.test.tsx __tests__/DiscoverMatches.test.tsx`
Expected: PASS.

- [ ] **Step 3 : commit**

```bash
git add frontend/lib/useScrollRail.ts
git commit -m "feat(rail): useScrollRail expose activeIndex + scrollToIndex (points de pagination)"
```

---

### Task 3 : composant `AgendaRail` (TDD)

**Files:**
- Create: `frontend/components/agenda/AgendaRail.tsx`
- Test: `frontend/__tests__/AgendaRail.test.tsx` (create)

- [ ] **Step 1 : écrire la suite qui échoue**

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { AgendaRail } from '../components/agenda/AgendaRail';
import { ThemeProvider } from '../lib/ThemeProvider';

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);
const cards = (n: number) => Array.from({ length: n }, (_, i) => <div key={i}>Carte {i + 1}</div>);

describe('AgendaRail', () => {
  it('rend les enfants, le compteur et un point cliquable par carte', () => {
    wrap(<AgendaRail countLabel="8 tournois" prevLabel="Préc" nextLabel="Suiv">{cards(8)}</AgendaRail>);
    expect(screen.getByText('8 tournois')).toBeInTheDocument();
    expect(screen.getByText('Carte 1')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Aller à la carte/ })).toHaveLength(8);
  });

  it('1 seule carte, ou plus de 12 → pas de points', () => {
    const { unmount } = wrap(<AgendaRail prevLabel="p" nextLabel="s">{cards(1)}</AgendaRail>);
    expect(screen.queryByRole('button', { name: /Aller à la carte/ })).not.toBeInTheDocument();
    unmount();
    wrap(<AgendaRail prevLabel="p" nextLabel="s">{cards(13)}</AgendaRail>);
    expect(screen.queryByRole('button', { name: /Aller à la carte/ })).not.toBeInTheDocument();
  });

  it("desktopRows 'auto' : 1 rangée jusqu'à 4 cartes, 2 au-delà", () => {
    const { container, unmount } = wrap(<AgendaRail prevLabel="p" nextLabel="s">{cards(4)}</AgendaRail>);
    expect((container.querySelector('.ag-rail') as HTMLElement).style.getPropertyValue('--ag-rows')).toBe('repeat(1, auto)');
    unmount();
    const { container: c2 } = render(
      <ThemeProvider><AgendaRail prevLabel="p" nextLabel="s">{cards(5)}</AgendaRail></ThemeProvider>,
    );
    expect((c2.querySelector('.ag-rail') as HTMLElement).style.getPropertyValue('--ag-rows')).toBe('repeat(2, auto)');
  });

  it('clic sur un point → défilement du rail', () => {
    const scrollTo = jest.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { value: scrollTo, writable: true });
    wrap(<AgendaRail prevLabel="p" nextLabel="s">{cards(3)}</AgendaRail>);
    fireEvent.click(screen.getByRole('button', { name: 'Aller à la carte 2' }));
    expect(scrollTo).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2 : vérifier l'échec**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/AgendaRail.test.tsx`
Expected: FAIL — module `../components/agenda/AgendaRail` introuvable.

- [ ] **Step 3 : implémenter le composant**

```tsx
'use client';
import { Children, ReactNode } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { useScrollRail } from '@/lib/useScrollRail';
import { RailArrows } from '@/components/ui/RailArrows';

// Rail d'agenda partagé — LA règle responsive unique des régions d'events (spec 2026-07-24) :
// mobile < 700px = une carte pleinement visible + liseré ~14px de la suivante (jamais de
// contenu coupé à moitié), snap obligatoire, points de pagination cliquables ; desktop =
// étagère (colonnes réglables par surface, 1 rangée ≤ 4 enfants sinon 2 en 'auto'), flèches.
// Possède le scroller, PAS l'en-tête de section (chaque surface garde son kicker/titre).
// Points masqués au-delà de 12 cartes (annuaire clubs non plafonné). Les media queries
// vivent dans un <style> de composant (pattern des rails historiques) — display des points
// et flèches PAR CSS uniquement, jamais en inline (l'inline gagnerait sur la media query).
const RAIL_CSS = `
.ag-rail{display:grid;grid-auto-flow:column;gap:12px;align-items:stretch;grid-auto-columns:var(--ag-cols);grid-template-rows:var(--ag-rows);scroll-snap-type:x proximity;scroll-padding-left:20px}
.ag-rail>*{scroll-snap-align:start}
.ag-dots{display:flex;gap:6px;justify-content:center;padding-top:10px}
@media (max-width:699.98px){.ag-rail{grid-auto-columns:calc(100% - 26px);grid-template-rows:auto;scroll-snap-type:x mandatory}.ag-arrows{display:none}}
@media (min-width:700px){.ag-dots{display:none}}
`;

export function AgendaRail({ countLabel, desktopColumns = 'calc(50% - 6px)', desktopRows = 'auto', prevLabel, nextLabel, children }: {
  /** « 8 tournois » — rangée discrète alignée à droite au-dessus du rail. */
  countLabel?: string | null;
  /** grid-auto-columns ≥ 700px — '270px' (parties), 'calc((100% - 24px) / 3)' (clubs)… */
  desktopColumns?: string;
  /** 'auto' = 1 rangée si ≤ 4 enfants, sinon 2 (règle des étagères tournois/events). */
  desktopRows?: 1 | 2 | 'auto';
  prevLabel: string;
  nextLabel: string;
  children: ReactNode;
}) {
  const { th } = useTheme();
  const items = Children.toArray(children);
  const rows = desktopRows === 'auto' ? (items.length <= 4 ? 1 : 2) : desktopRows;
  const { railRef, edges, scrollByPage, activeIndex, scrollToIndex } = useScrollRail([items.length]);

  return (
    <div>
      <style>{RAIL_CSS}</style>
      {countLabel && (
        <div style={{ textAlign: 'right', fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, color: th.text, marginBottom: 4 }}>{countLabel}</div>
      )}
      <div style={{ position: 'relative', margin: '0 -20px' }}>
        {/* scrollPaddingLeft (dans RAIL_CSS) = padding-left : sans lui le snap mandatory mange le padding au montage. */}
        <div ref={railRef} className="sp-scroll-x ag-rail" style={{
          ...({ '--ag-cols': desktopColumns, '--ag-rows': `repeat(${rows}, auto)` } as React.CSSProperties),
          padding: '4px 20px 8px',
        }}>
          {children}
        </div>
        <span className="ag-arrows">
          <RailArrows edges={edges} onPrev={() => scrollByPage(-1)} onNext={() => scrollByPage(1)} prevLabel={prevLabel} nextLabel={nextLabel} fadeBottom={8} />
        </span>
      </div>
      {items.length > 1 && items.length <= 12 && (
        <div className="ag-dots">
          {items.map((_, i) => (
            <button key={i} type="button" aria-label={`Aller à la carte ${i + 1}`}
              aria-current={i === activeIndex ? 'true' : undefined}
              onClick={() => scrollToIndex(i)}
              style={{
                border: 'none', cursor: 'pointer', padding: 0, height: 6, borderRadius: 999,
                width: i === activeIndex ? 18 : 6, transition: 'width .2s ease',
                background: i === activeIndex ? th.accent : th.lineStrong,
              }} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4 : vérifier le vert**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/AgendaRail.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5 : commit**

```bash
git add frontend/components/agenda/AgendaRail.tsx frontend/__tests__/AgendaRail.test.tsx
git commit -m "feat(agenda): AgendaRail — rail responsive partagé (snap 1 carte + points mobile, étagère + flèches desktop)"
```

---

### Task 4 : carte restylée « liseré éditorial » (`AgendaCardHeader` + `AgendaCard`)

**Files:**
- Modify: `frontend/components/agenda/AgendaCardHeader.tsx` (réécriture du corps)
- Modify: `frontend/components/agenda/AgendaCard.tsx` (coquille)
- Test: `frontend/__tests__/AgendaCard.test.tsx` (mise à jour)

- [ ] **Step 1 : mettre à jour la suite (rouge d'abord)** — remplacer le contenu de `AgendaCard.test.tsx` par :

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { AgendaCard } from '../components/agenda/AgendaCard';
import { ThemeProvider } from '../lib/ThemeProvider';
import { ACCENTS } from '../lib/theme';

const NOW = new Date('2026-06-10T12:00:00Z');

const base = {
  icon: 'trophy' as const,
  accent: ACCENTS.apricot,
  tag: 'P500 · Messieurs',
  title: 'Grand Prix Messieurs',
  dateLabel: 'jeudi 9 juillet · 14h01',
  deadline: '2026-07-04T12:01:00Z',
  ratio: 7 / 12 as number | null,
  places: { text: 'Plus que 5 places', urgent: true },
  price: '40 €',
  onClick: jest.fn(),
};

const wrap = (over: Partial<typeof base> & { now: Date | null; subtitle?: string | null; sportLabel?: string | null; extra?: string | null; price?: string | null }) =>
  render(<ThemeProvider><AgendaCard {...base} {...over} /></ThemeProvider>);

describe('AgendaCard', () => {
  it('affiche tag, titre, date, prix vedette, countdown et places', () => {
    wrap({ now: NOW });
    expect(screen.getByText('P500 · Messieurs')).toBeInTheDocument();
    expect(screen.getByText('Grand Prix Messieurs')).toBeInTheDocument();
    expect(screen.getByText('jeudi 9 juillet · 14h01')).toBeInTheDocument();
    expect(screen.getByText('40 €')).toBeInTheDocument();
    expect(screen.getByText('J-24')).toBeInTheDocument();
    expect(screen.getByText('Plus que 5 places')).toBeInTheDocument();
    expect(screen.getByTestId('card-fill').style.width).toBe('58%');
  });

  it('porte le liseré latéral teinté à l’accent du type', () => {
    const { container } = wrap({ now: NOW });
    const stripe = container.querySelector('[data-club-stripe]') as HTMLElement;
    expect(stripe).not.toBeNull();
    expect(stripe).toHaveStyle({ background: ACCENTS.apricot });
  });

  it('extra reste un suffixe de la ligne de date (sans prix)', () => {
    wrap({ now: NOW, price: null, extra: 'Membres' });
    expect(screen.getByText('jeudi 9 juillet · 14h01 · Membres')).toBeInTheDocument();
    expect(screen.queryByText('40 €')).not.toBeInTheDocument();
  });

  it('now=null → pas de countdown, jauge à 0', () => {
    wrap({ now: null });
    expect(screen.queryByText('J-24')).not.toBeInTheDocument();
    expect(screen.getByTestId('card-fill').style.width).toBe('0px');
  });

  it('affiche le subtitle quand fourni', () => {
    wrap({ now: NOW, subtitle: 'Padel Paris · Paris · 8 km' });
    expect(screen.getByText('Padel Paris · Paris · 8 km')).toBeInTheDocument();
  });

  it('affiche le chip sport quand sportLabel fourni, sinon non', () => {
    const { rerender } = wrap({ now: NOW, sportLabel: 'Tennis' });
    expect(screen.getByTestId('sport-badge')).toHaveTextContent('Tennis');
    rerender(<ThemeProvider><AgendaCard {...base} now={NOW} sportLabel={null} /></ThemeProvider>);
    expect(screen.queryByTestId('sport-badge')).not.toBeInTheDocument();
  });

  it('sans capacité → pas de jauge ; clic → onClick', () => {
    const onClick = jest.fn();
    wrap({ now: NOW, ratio: null, onClick });
    expect(screen.queryByTestId('card-fill')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Grand Prix Messieurs'));
    expect(onClick).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2 : vérifier l'échec**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/AgendaCard.test.tsx`
Expected: FAIL — prop `price` inconnue du type, prix rendu dans la ligne de date, pas de `[data-club-stripe]`.

- [ ] **Step 3 : réécrire `AgendaCardHeader.tsx`**

```tsx
'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS, shade, gaugeTrack } from '@/lib/theme';
import { Icon, IconName } from '@/components/ui/Icon';
import { deadlineCountdown } from '@/lib/tournament';

export interface AgendaCardHeaderProps {
  icon: IconName;              // trophy (compétition) / bolt (animation) / whistle-user (cours)
  accent: string;              // teinte du type : liseré (posé par la coquille), icône, tag
  tag: string;                 // « P500 · Messieurs » / « Mêlée »
  title: string;
  dateLabel: string;           // « jeudi 9 juillet · 14h01 »
  /** ISO — compte à rebours. Absent/null = pas de chip (échéance passée ou sans objet). */
  deadline?: string | null;
  now: Date | null;            // null avant le mount (hydration-safe)
  ratio: number | null;        // remplissage 0..1, null = pas de jauge
  places: { text: string; urgent: boolean };
  /** « 40 € » — chiffre vedette display à droite de la ligne de date. */
  price?: string | null;
  extra?: string | null;       // « Membres » / « Coach : … » — suffixe de la ligne de date
  subtitle?: string | null;    // « Club · Ville · 8 km » — ligne secondaire (calendrier national)
  sportLabel?: string | null;  // « Tennis » — chip sport (vue multi-sport / multi-club) ; null = masqué
}

/**
 * Corps visuel commun des cartes d'agenda « liseré éditorial » (spec 2026-07-24) :
 * icône + tag teintés type, titre display, date + prix vedette, jauge de remplissage
 * épinglée en pied (pieds alignés quand la carte est étirée dans un rail).
 *
 * Rendu en UNE colonne flex (`flex:1; minWidth:0`) — le parent pose
 * `display:flex; gap:13` et le liseré (CardStripe) dans sa coquille.
 *
 * Tout est en `<span>` : valide dans le `<button>` d'AgendaCard (contenu phrasé) COMME dans
 * les cartes `<div>` dépliables (J/A, coach), qui ne peuvent pas être un bouton puisqu'elles
 * contiennent elles-mêmes des boutons et des liens `tel:`.
 */
export function AgendaCardHeader({
  icon, accent, tag, title, dateLabel, deadline, now, ratio, places, price, extra, subtitle, sportLabel,
}: AgendaCardHeaderProps) {
  const { th } = useTheme();
  const countdown = deadline && now ? deadlineCountdown(deadline, now) : null;
  // Accent lisible en texte : assombri sur fond clair, plein en floodlit (spec §1).
  const tagColor = th.mode === 'floodlit' ? accent : shade(accent, 0.58);

  return (
    <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <Icon name={icon} size={13} color={tagColor} style={{ flexShrink: 0 }} />
        {sportLabel && (
          <span data-testid="sport-badge" style={{
            fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, letterSpacing: 0.3, whiteSpace: 'nowrap', flexShrink: 0,
            borderRadius: 999, padding: '2px 8px', background: th.surface2, color: th.textMute, boxShadow: `inset 0 0 0 1px ${th.line}`,
          }}>{sportLabel}</span>
        )}
        <span style={{ fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: tagColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tag}</span>
        <span style={{ flex: 1 }} />
        {countdown && (
          <span style={{
            fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap', borderRadius: 999, padding: '3px 9px',
            background: countdown.urgent ? (th.mode === 'floodlit' ? `${ACCENTS.coral}26` : `${ACCENTS.coral}40`) : th.surface2,
            color: countdown.urgent ? (th.mode === 'floodlit' ? ACCENTS.coral : th.ink) : th.textMute,
          }}>
            {countdown.text}
          </span>
        )}
      </span>

      <span style={{ fontFamily: th.fontDisplay, fontSize: 17.5, fontWeight: 600, letterSpacing: -0.2, color: th.text }}>{title}</span>
      {subtitle && (
        <span style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textFaint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subtitle}</span>
      )}
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, minWidth: 0 }}>
          {dateLabel}{extra ? ` · ${extra}` : ''}
        </span>
        <span style={{ flex: 1 }} />
        {price && (
          <span style={{ fontFamily: th.fontDisplay, fontSize: 16.5, fontWeight: 700, color: th.text, whiteSpace: 'nowrap' }}>{price}</span>
        )}
      </span>

      {/* marginTop:auto = pied épinglé en bas quand la carte est étirée par le rail (hauteurs égales) */}
      <span style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 'auto', paddingTop: 6 }}>
        {ratio != null && (
          <span style={{ flex: '0 1 120px', ...gaugeTrack(th, 5) }}>
            <span data-testid="card-fill" style={{ display: 'block', height: '100%', borderRadius: 999, background: places.urgent ? ACCENTS.coral : th.accent, width: now ? `${Math.round(ratio * 100)}%` : 0, transition: 'width .8s ease' }} />
          </span>
        )}
        <span style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: places.urgent ? 700 : 600, color: places.urgent ? ACCENTS.coral : th.textMute }}>{places.text}</span>
      </span>
    </span>
  );
}
```

- [ ] **Step 4 : réécrire `AgendaCard.tsx`**

```tsx
'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { CardStripe } from '@/components/ui/atoms';
import { cardStyle } from '@/components/clubhouse/SectionHeader';
import { AgendaCardHeader, AgendaCardHeaderProps } from '@/components/agenda/AgendaCardHeader';

export interface AgendaCardProps extends AgendaCardHeaderProps {
  deadline: string;            // ISO — compte à rebours avant clôture (toujours fourni ici)
  onClick: () => void;
}

// Carte d'event commune « liseré éditorial » (spec 2026-07-24) : ombre douce (cardStyle),
// liseré latéral teinté par type (CardStripe), lift au survol. Le corps visuel vit dans
// AgendaCardHeader, partagé avec les cartes dépliables (Arbitrage, Mes cours) qui ne
// peuvent pas être un <button>.
export function AgendaCard({ onClick, ...header }: AgendaCardProps) {
  const { th } = useTheme();

  return (
    <button onClick={onClick} className="pl-lift" style={{
      border: 'none', cursor: 'pointer', textAlign: 'left', width: '100%',
      position: 'relative', overflow: 'hidden',
      ...cardStyle(th), padding: '13px 16px 13px 19px',
      display: 'flex', alignItems: 'flex-start', gap: 13,
    }}>
      <CardStripe color={header.accent} />
      <AgendaCardHeader {...header} />
    </button>
  );
}
```

(Le chevron `chevR` et l'import `Icon` disparaissent de ce fichier.)

- [ ] **Step 5 : vérifier le vert + non-régression des consommateurs**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/AgendaCard.test.tsx __tests__/UpcomingTournaments.test.tsx __tests__/TournamentFinder.test.tsx __tests__/MeRefereeing.test.tsx __tests__/CoachLessonCard.test.tsx`
Expected: `AgendaCard` PASS. Les autres : si un test asserte l'ancien texte `date · 40 €` en un seul nœud, le corriger en deux assertions (`getByText('…date…')` + `getByText('40 €')`) — mais NE PAS encore basculer les appelants sur `price` (c'est Task 5) : à ce stade ils passent le prix via `extra`, toujours rendu en suffixe de date, donc les suites doivent rester vertes sans modification. En cas d'échec inattendu, lire le message avant de toucher quoi que ce soit.

- [ ] **Step 6 : commit**

```bash
git add frontend/components/agenda/AgendaCardHeader.tsx frontend/components/agenda/AgendaCard.tsx frontend/__tests__/AgendaCard.test.tsx
git commit -m "feat(agenda): carte liseré éditorial — CardStripe type, ombre douce, titre display, prop price"
```

---

### Task 5 : basculer les appelants sur `price` (le prix quitte `extra`)

**Files:**
- Modify: `frontend/app/events/EventsClient.tsx` (3 cartes)
- Modify: `frontend/components/calendar/TournamentFinder.tsx` (2 cartes)
- Modify: `frontend/components/calendar/UpcomingTournaments.tsx` (1 carte)

- [ ] **Step 1 : EventsClient** — dans la carte **tournoi** :

```tsx
// avant
extra={item.tournament.entryFee ? `${item.tournament.entryFee} €` : null}
// après
price={item.tournament.entryFee ? `${item.tournament.entryFee} €` : null}
```

Dans la carte **event** (le prix devient vedette, « Membres » reste en suffixe) :

```tsx
// avant
extra={[item.event.price != null && Number(item.event.price) > 0 ? `${Number(item.event.price)} €` : null, item.event.memberOnly ? 'Membres' : null].filter(Boolean).join(' · ') || null}
// après
price={item.event.price != null && Number(item.event.price) > 0 ? `${Number(item.event.price)} €` : null}
extra={item.event.memberOnly ? 'Membres' : null}
```

La carte **cours** ne change pas (`extra={'Coach : …'}`, pas de prix).

- [ ] **Step 2 : TournamentFinder (les 2 branches, embarquée et autonome)** — remplacer les deux occurrences de :

```tsx
extra={t.entryFee ? `${t.entryFee} €` : null}
```

par :

```tsx
price={t.entryFee ? `${t.entryFee} €` : null}
```

- [ ] **Step 3 : UpcomingTournaments** — même remplacement `extra=` → `price=` sur `t.entryFee`.

- [ ] **Step 4 : suites + types**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/TournamentFinder.test.tsx __tests__/UpcomingTournaments.test.tsx __tests__/DiscoverPage.test.tsx __tests__/AnonymousView.test.tsx`
Expected: PASS — si une assertion cherchait `« date · 20 € »` en un nœud, la scinder (date seule + prix seul).
Run: `node node_modules/typescript/bin/tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5 : commit**

```bash
git add frontend/app/events/EventsClient.tsx frontend/components/calendar/TournamentFinder.tsx frontend/components/calendar/UpcomingTournaments.tsx
git commit -m "feat(agenda): le prix des cartes devient chiffre vedette (prop price), Membres reste en suffixe"
```

(+ les fichiers de test modifiés le cas échéant.)

---

### Task 6 : /decouvrir Tournois — `TournamentFinder` embarqué sur `AgendaRail`

**Files:**
- Modify: `frontend/components/calendar/TournamentFinder.tsx` (branche `hideTitle` uniquement)

- [ ] **Step 1 : remplacer le bloc rail** — dans la branche `hideTitle`, supprimer : le `<style>` `.discover-tournaments-grid`, le `<div>` compteur (`{visibleResults.length} tournoi…`), le wrapper `position:relative; margin:0 -20px`, le `<div ref={railRef} …>` et le `<RailArrows …/>`. À la place :

```tsx
{visibleResults != null && visibleResults.length > 0 && (
  <AgendaRail
    countLabel={`${visibleResults.length} tournoi${visibleResults.length > 1 ? 's' : ''}`}
    prevLabel="Tournois précédents" nextLabel="Tournois suivants"
  >
    {visibleResults.map(({ tournament: t, distanceKm }) => {
      const subtitle = [t.club.name, t.club.city, distanceKm != null ? `${Math.round(distanceKm)} km` : null].filter(Boolean).join(' · ');
      return (
        <AgendaCard
          key={t.id}
          icon="trophy"
          accent={ACCENTS.apricot}
          tag={`${t.category} · ${GENDER_LABEL[t.gender]}`}
          title={t.name}
          subtitle={subtitle}
          dateLabel={formatDateTimeRange(t.startTime, t.endTime, t.club.timezone)}
          deadline={t.registrationDeadline}
          now={now}
          ratio={fillRatio(t)}
          places={tournamentPlacesLabel(t)}
          price={t.entryFee ? `${t.entryFee} €` : null}
          sportLabel={showSport ? (t.sport?.name ?? null) : null}
          onClick={() => { window.location.href = clubUrl(t.club.slug, `/tournois/${t.id}`); }}
        />
      );
    })}
  </AgendaRail>
)}
```

(`desktopColumns`/`desktopRows` par défaut = comportement actuel : 2 colonnes, 1 rangée ≤ 4 sinon 2.)

- [ ] **Step 2 : nettoyer** — supprimer l'appel `useScrollRail` du composant et les imports devenus inutiles (`useScrollRail`, `RailArrows`) ; ajouter `import { AgendaRail } from '@/components/agenda/AgendaRail';`. La branche autonome (flux vertical) ne bouge pas.

- [ ] **Step 3 : suites + types**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/TournamentFinder.test.tsx __tests__/DiscoverPage.test.tsx` puis `node node_modules/typescript/bin/tsc --noEmit`
Expected: PASS / exit 0. Si un test cible `.discover-tournaments-grid`, le pointer sur `.ag-rail`.

- [ ] **Step 4 : commit**

```bash
git add frontend/components/calendar/TournamentFinder.tsx
git commit -m "feat(decouvrir): la section Tournois passe sur AgendaRail"
```

---

### Task 7 : /decouvrir Parties — `DiscoverMatches` sur `AgendaRail`

**Files:**
- Modify: `frontend/components/discover/DiscoverMatches.tsx`

- [ ] **Step 1 : remplacer le bloc rail** — supprimer le `<div>` compteur, le wrapper `position:relative`, le rail flex/grid et `RailArrows` ; à la place :

```tsx
<div>
  <AgendaRail countLabel={count} desktopColumns="270px" desktopRows={1}
    prevLabel="Parties précédentes" nextLabel="Parties suivantes">
    {list.map((r) => (
      <NationalMatchCard key={r.match.id} match={r.match} distanceKm={r.distanceKm} />
    ))}
  </AgendaRail>
</div>
```

(La prop `style={{ scrollSnapAlign: 'start' }}` de `NationalMatchCard` disparaît — `.ag-rail>*` la porte. La carte elle-même est inchangée, spec §3.)

- [ ] **Step 2 : nettoyer** — retirer `useScrollRail`/`RailArrows` des imports et l'appel du hook ; importer `AgendaRail`.

- [ ] **Step 3 : suites + types**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/DiscoverMatches.test.tsx __tests__/DiscoverPage.test.tsx` puis `node node_modules/typescript/bin/tsc --noEmit`
Expected: PASS / exit 0.

- [ ] **Step 4 : commit**

```bash
git add frontend/components/discover/DiscoverMatches.tsx
git commit -m "feat(decouvrir): la section Parties passe sur AgendaRail"
```

---

### Task 8 : /decouvrir Clubs — `ClubDirectory` sur `AgendaRail` + liseré `ClubCard`

**Files:**
- Modify: `frontend/components/ClubDirectory.tsx`
- Modify: `frontend/components/ClubCard.tsx`

- [ ] **Step 1 : ClubDirectory** — supprimer le `<style>` `.discover-clubs-grid`, le `<div>` compteur, le wrapper + rail + `RailArrows`, remplacer par :

```tsx
<AgendaRail
  countLabel={`${visibleClubs.length} club${visibleClubs.length > 1 ? 's' : ''}`}
  desktopColumns="calc((100% - 24px) / 3)" desktopRows={1}
  prevLabel="Clubs précédents" nextLabel="Clubs suivants"
>
  {visibleClubs.map((c, i) => <ClubCard key={c.id} club={c} defaultCover={COVER_PHOTOS[i % COVER_PHOTOS.length]} />)}
</AgendaRail>
```

Nettoyer `useScrollRail`/`RailArrows` (imports + appel), importer `AgendaRail`.
(L'annuaire n'est pas plafonné : au-delà de 12 clubs, `AgendaRail` masque les points tout seul.)

- [ ] **Step 2 : ClubCard** — vérifier d'abord les usages (`grep -rn "ClubCard" frontend --include="*.tsx"` → attendu : `ClubDirectory` + test). Puis :

```tsx
// avant (conteneur)
<div style={{ background: th.surface, borderRadius: 22, overflow: 'hidden', boxShadow: `${th.shadowSoft}, inset 0 0 0 1px ${th.line}` }}>
// après
<div style={{ ...cardStyle(th), borderRadius: 22, position: 'relative', overflow: 'hidden' }}>
  <CardStripe color={club.accentColor} />
```

et **supprimer** la pastille flottante (`<span style={{ position:'absolute', top:12, right:12, … background: club.accentColor …}} />`) — le liseré est le marqueur d'identité. Ajouter les imports `CardStripe` (`@/components/ui/atoms`) et `cardStyle` (`@/components/clubhouse/SectionHeader`).

- [ ] **Step 3 : suites + types**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/ClubDirectory.test.tsx` puis `node node_modules/typescript/bin/tsc --noEmit`
Expected: PASS / exit 0 (si un test asserte la pastille, le basculer sur `[data-club-stripe]`).

- [ ] **Step 4 : commit**

```bash
git add frontend/components/ClubDirectory.tsx frontend/components/ClubCard.tsx
git commit -m "feat(decouvrir): l'annuaire Clubs passe sur AgendaRail, liseré accentColor sur ClubCard"
```

---

### Task 9 : Club-house « Prochains events » — vraies cartes dans `AgendaRail`

**Files:**
- Modify: `frontend/components/clubhouse/TournamentsAlaUne.tsx` (réécriture du corps)
- Test: `frontend/__tests__/TournamentsAlaUne.test.tsx` (assertions adaptées, fixtures conservées)

- [ ] **Step 1 : réécrire le composant**

```tsx
'use client';
import { useRouter } from 'next/navigation';
import { tournamentPlacesLabel } from '@/lib/clubhouse';
import { AgendaItem, eventPlacesLabel, KIND_LABEL } from '@/lib/events';
import { fillRatio, formatDateTimeRange } from '@/lib/tournament';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { Icon } from '@/components/ui/Icon';
import { cardStyle } from '@/components/clubhouse/SectionHeader';
import { AgendaCard } from '@/components/agenda/AgendaCard';
import { AgendaRail } from '@/components/agenda/AgendaRail';

const GENDER_LABEL: Record<string, string> = { MEN: 'Messieurs', WOMEN: 'Dames', MIXED: 'Mixte' };

// « Prochains events » : tournois + animations fusionnés (nom de fichier historique conservé).
// Depuis la spec 2026-07-24 : de VRAIES AgendaCard restylées dans le rail partagé AgendaRail
// (une carte à la fois + points en mobile, étagère + flèches en desktop) — plus de
// mini-tuiles dédiées. `now` null avant le mount (hydration-safe).
export function TournamentsAlaUne({ items, timezone, now = null, multiSport = false }: { items: AgendaItem[]; timezone: string; now?: Date | null; multiSport?: boolean }) {
  const { th } = useTheme();
  const router = useRouter();
  const shown = items.filter((item) => item.source !== 'lesson');
  if (items.length === 0) return null;
  const count = `${shown.length} résultat${shown.length > 1 ? 's' : ''}`;
  return (
    <div style={{ ...cardStyle(th), padding: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
        <span aria-hidden="true" style={{ width: 28, height: 28, borderRadius: 9, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: th.mode === 'floodlit' ? `${ACCENTS.apricot}26` : `${ACCENTS.apricot}40` }}>
          <Icon name="trophy" size={15} color={th.mode === 'floodlit' ? ACCENTS.apricot : th.ink} />
        </span>
        <span style={{ fontFamily: th.fontUI, fontWeight: 800, fontSize: 14, color: th.text }}>Prochains events</span>
        <span style={{ marginLeft: 'auto', fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute }}>{count}</span>
      </div>
      <AgendaRail prevLabel="Events précédents" nextLabel="Events suivants">
        {shown.map((item) => {
          const isT = item.source === 'tournament';
          const id = isT ? item.tournament.id : item.event.id;
          const priceValue = isT
            ? (item.tournament.entryFee ? `${item.tournament.entryFee} €` : null)
            : (item.event.price != null && Number(item.event.price) > 0 ? `${Number(item.event.price)} €` : null);
          return (
            <AgendaCard
              key={`${item.source}-${id}`}
              icon={isT ? 'trophy' : 'bolt'}
              accent={isT ? ACCENTS.apricot : ACCENTS.violet}
              tag={isT ? `${item.tournament.category} · ${GENDER_LABEL[item.tournament.gender]}` : KIND_LABEL[item.event.kind]}
              title={isT ? item.tournament.name : item.event.name}
              dateLabel={formatDateTimeRange(item.startTime, item.endTime, timezone)}
              deadline={isT ? item.tournament.registrationDeadline : item.event.registrationDeadline}
              now={now}
              ratio={isT ? fillRatio(item.tournament) : fillRatio({ confirmedCount: item.event.confirmedCount, maxTeams: item.event.capacity })}
              places={isT ? tournamentPlacesLabel(item.tournament) : eventPlacesLabel(item.event)}
              price={priceValue}
              extra={!isT && item.event.memberOnly ? 'Membres' : null}
              sportLabel={multiSport ? ((isT ? item.tournament.sport?.name : item.event.sport?.name) ?? null) : null}
              onClick={() => router.push(isT ? `/tournois/${id}` : `/events/${id}`)}
            />
          );
        })}
      </AgendaRail>
    </div>
  );
}
```

(Les imports devenus inutiles — `Link`, `deadlineCountdown`, `formatHourRange`, `gaugeTrack`, `useScrollRail`, `RailArrows` — et le helper local `formatDay` disparaissent.)

- [ ] **Step 2 : adapter la suite** — dans `TournamentsAlaUne.test.tsx`, **conserver les fixtures** ; remplacer les assertions DOM :
  - les items étaient des liens `<a aria-label={name}>` → deviennent des `<button>` contenant le titre : `screen.getByText(name)` + clic → mock du router. Ajouter en tête de suite (pattern des autres suites du repo) :

```tsx
const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
```

  - le clic : `fireEvent.click(screen.getByText('<nom du tournoi de la fixture>'))` puis `expect(push).toHaveBeenCalledWith('/tournois/<id de la fixture>')`.
  - toute assertion sur `.ta-grid` ou la structure des tuiles → cibler `.ag-rail` / le texte des cartes.
  - le compteur `N résultats` et le titre « Prochains events » : inchangés.

- [ ] **Step 3 : suites + types**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/TournamentsAlaUne.test.tsx __tests__/ClubHouse.test.tsx` puis `node node_modules/typescript/bin/tsc --noEmit`
Expected: PASS / exit 0 (si `ClubHouse.test` monte la section avec un mock de router déjà présent, rien à faire ; sinon même mock).

- [ ] **Step 4 : commit**

```bash
git add frontend/components/clubhouse/TournamentsAlaUne.tsx frontend/__tests__/TournamentsAlaUne.test.tsx
git commit -m "feat(clubhouse): Prochains events en vraies cartes AgendaCard dans AgendaRail"
```

---

### Task 10 : vitrine — `UpcomingTournaments` passe en rail

**Files:**
- Modify: `frontend/components/calendar/UpcomingTournaments.tsx`

- [ ] **Step 1 : remplacer la colonne par le rail** — le conteneur `display:flex; flexDirection:column; gap:12` devient :

```tsx
<div style={{ padding: '12px 20px 0' }}>
  <AgendaRail prevLabel="Tournois précédents" nextLabel="Tournois suivants">
    {top.map((t) => (
      <AgendaCard
        key={t.id}
        icon="trophy"
        accent={ACCENTS.apricot}
        tag={`${t.category} · ${GENDER_LABEL[t.gender]}`}
        title={t.name}
        subtitle={[t.club.name, t.club.city].filter(Boolean).join(' · ')}
        dateLabel={formatDateTimeRange(t.startTime, t.endTime, t.club.timezone)}
        deadline={t.registrationDeadline}
        now={now}
        ratio={fillRatio(t)}
        places={tournamentPlacesLabel(t)}
        price={t.entryFee ? `${t.entryFee} €` : null}
        sportLabel={showSport ? (t.sport?.name ?? null) : null}
        onClick={() => { window.location.href = clubUrl(t.club.slug, `/tournois/${t.id}`); }}
      />
    ))}
  </AgendaRail>
  <a href={platformUrl('/decouvrir#tournois')} style={{ display: 'inline-block', marginTop: 10, fontFamily: th.fontUI, fontWeight: 700, fontSize: 14.5, color: th.text, textDecoration: 'none' }}>
    Voir tout le calendrier →
  </a>
</div>
```

Importer `AgendaRail`. (Cap `MAX = 4` inchangé → `desktopRows:'auto'` donne 1 rangée.)

- [ ] **Step 2 : suites + types**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/UpcomingTournaments.test.tsx __tests__/AnonymousView.test.tsx` puis `node node_modules/typescript/bin/tsc --noEmit`
Expected: PASS / exit 0.

- [ ] **Step 3 : commit**

```bash
git add frontend/components/calendar/UpcomingTournaments.tsx
git commit -m "feat(vitrine): UpcomingTournaments passe sur AgendaRail"
```

---

### Task 11 : rails de parties — `NationalOpenMatches` + `OpenMatchesShowcase`

**Files:**
- Modify: `frontend/components/platform/NationalOpenMatches.tsx`
- Modify: `frontend/components/clubhouse/OpenMatchesShowcase.tsx`

- [ ] **Step 1 : NationalOpenMatches** — remplacer compteur + wrapper + rail flex + `RailArrows` par :

```tsx
export function NationalOpenMatches({ matches }: { matches: NationalOpenMatch[] }) {
  if (matches.length === 0) return null;
  const count = `${matches.length} partie${matches.length > 1 ? 's' : ''}`;
  return (
    <AgendaRail countLabel={count} desktopColumns="282px" desktopRows={1}
      prevLabel="Parties précédentes" nextLabel="Parties suivantes">
      {matches.map((m) => <NationalMatchCard key={m.id} match={m} />)}
    </AgendaRail>
  );
}
```

(`useTheme`/`useScrollRail`/`RailArrows` sortent des imports ; la prop `style` de la carte — flex basis + snap align — disparaît, le rail gère.)

- [ ] **Step 2 : OpenMatchesShowcase** — même mouvement : le `<div>` wrapper `position:relative; margin:0 -20px` + le rail flex `sp-scroll-x` + `RailArrows` sont remplacés par `<AgendaRail desktopColumns="272px" desktopRows={1} prevLabel="Parties précédentes" nextLabel="Parties suivantes">…</AgendaRail>` ; dans le style des `<article>` de carte, retirer `flex: '0 0 272px'` et `scrollSnapAlign: 'start'` (le reste du style de carte est conservé — cartes showcase inchangées, spec §3). Nettoyer `useScrollRail`/`RailArrows` des imports.

- [ ] **Step 3 : suites + types**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/NationalOpenMatches.test.tsx __tests__/HomeMatchesRail.test.tsx __tests__/OpenMatchesShowcase.test.tsx __tests__/AnonymousView.test.tsx` puis `node node_modules/typescript/bin/tsc --noEmit`
Expected: PASS / exit 0.

- [ ] **Step 4 : commit**

```bash
git add frontend/components/platform/NationalOpenMatches.tsx frontend/components/clubhouse/OpenMatchesShowcase.tsx
git commit -m "feat(rails): parties nationales et showcase club-house sur AgendaRail"
```

---

### Task 12 : coquilles J/A + coach (ombre douce + liseré)

**Files:**
- Modify: `frontend/components/referee/RefereeTournamentCard.tsx`
- Modify: `frontend/components/coach/CoachLessonCard.tsx`

- [ ] **Step 1 : RefereeTournamentCard** — le wrapper racine :

```tsx
// avant
<div style={{ background: th.surface, borderRadius: 16, padding: '14px 16px', boxShadow: `inset 0 0 0 1px ${th.line}` }}>
// après
<div style={{ position: 'relative', overflow: 'hidden', ...cardStyle(th), padding: '14px 16px 14px 19px' }}>
  <CardStripe color={ACCENTS.apricot} />
```

Imports à ajouter : `CardStripe` (`@/components/ui/atoms`), `cardStyle` (`@/components/clubhouse/SectionHeader`).

- [ ] **Step 2 : CoachLessonCard** — même remplacement avec `<CardStripe color={ACCENTS.blue} />`.

- [ ] **Step 3 : suites + types**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/MeRefereeing.test.tsx __tests__/CoachLessonCard.test.tsx` puis `node node_modules/typescript/bin/tsc --noEmit`
Expected: PASS / exit 0.

- [ ] **Step 4 : commit**

```bash
git add frontend/components/referee/RefereeTournamentCard.tsx frontend/components/coach/CoachLessonCard.tsx
git commit -m "feat(agenda): coquille ombre douce + liseré sur les cartes J/A et coach"
```

---

### Task 13 : balayage final tests + types

- [ ] **Step 1 : suite scoped complète du périmètre**

Run (depuis `frontend/`) :

```bash
node node_modules/jest/bin/jest.js --runTestsByPath \
  __tests__/AgendaRail.test.tsx __tests__/AgendaCard.test.tsx \
  __tests__/TournamentFinder.test.tsx __tests__/DiscoverPage.test.tsx __tests__/DiscoverMatches.test.tsx \
  __tests__/ClubDirectory.test.tsx __tests__/TournamentsAlaUne.test.tsx __tests__/ClubHouse.test.tsx \
  __tests__/UpcomingTournaments.test.tsx __tests__/AnonymousView.test.tsx \
  __tests__/NationalOpenMatches.test.tsx __tests__/HomeMatchesRail.test.tsx __tests__/OpenMatchesShowcase.test.tsx \
  __tests__/MeRefereeing.test.tsx __tests__/CoachLessonCard.test.tsx __tests__/tournamentCalendar.test.ts
```

Expected: tout PASS. (La suite COMPLÈTE `npx jest` a un flake connu BookingModal hors périmètre — ne pas s'y fier pour ce travail, cf. mémoire projet.)

- [ ] **Step 2 : types**

Run: `node node_modules/typescript/bin/tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3 : commit de rattrapage éventuel** (si des tests ont été ajustés en route)

```bash
git status
git add <fichiers de test du périmètre uniquement>
git commit -m "test(agenda): ajustements des suites au nouveau langage rail + carte"
```

---

### Task 14 : vérification visuelle (CDP)

- [ ] **Step 1 : redémarrer la stack** — `powershell -File start.ps1` depuis la racine (le dev server de longue durée sert parfois des chunks périmés).

- [ ] **Step 2 : invoquer le skill projet `verify`** (session authentifiée `test@palova.fr` / `password123`) et vérifier, en **clair ET sombre**, **desktop 1280 ET mobile 390** (⚠️ mobile en `mobile:false` + largeur fixe 390 — l'émulation mobile réajuste le viewport et masque les débordements) :
  - `http://localhost:3000/decouvrir` (hôte plateforme) : les 3 sections Parties/Tournois/Clubs — en mobile UNE carte pleine + liseré de la suivante + points, jamais de contenu coupé à moitié ; en desktop l'étagère + flèches ; liseré type sur les cartes tournois, prix en chiffre vedette.
  - `http://padel-arena-paris.localhost:3000/events` : cartes restylées (liseré apricot/violet/bleu selon le type), flux vertical conservé.
  - `http://padel-arena-paris.localhost:3000/` (Club-house) : « Prochains events » en vraies cartes dans le rail ; « Ça joue bientôt » une carte à la fois en mobile.
  - `http://localhost:3000/` **déconnecté** (vitrine anonyme) : rails tournois + parties.
  - `scrollWidth ≤ viewport` partout (pas de débordement horizontal).

- [ ] **Step 3 : corriger ce que la vérif révèle** (contrastes sombre, paddings) puis re-vérifier et committer :

```bash
git add <fichiers retouchés>
git commit -m "fix(agenda): retouches issues de la vérification visuelle"
```
