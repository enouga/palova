# Carte partie unifiée + rails de parties compacts en mobile — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une seule carte de partie ouverte (`OpenMatchRailCard`, en-tête club optionnel) partagée entre /decouvrir, la vitrine, Mon Palova et le Club-house, et des rails de parties compacts (272px) en mobile via `AgendaRail.mobileColumns`.

**Architecture:** 100 % frontend, aucune migration. `NationalMatchCard` (components/platform/) est généralisée et déplacée en `components/match/OpenMatchRailCard.tsx` ; `OpenMatchesShowcase` abandonne ses cartes `<article>` maison. `AgendaRail` gagne une prop `mobileColumns` (variable CSS, défaut inchangé). Spec : `docs/superpowers/specs/2026-07-24-carte-partie-unifiee-mobile-compacte-design.md`.

**Tech Stack:** Next.js 16, React inline styles + `<style>` de composant, Jest + RTL, `tsc --noEmit`.

**Conventions d'exécution :** branche `feat/seo-referencement`, exécution inline ; `git status` avant chaque commit, ne stager QUE les fichiers de la tâche, **jamais de `git stash`** ; jest via `node node_modules/jest/bin/jest.js --runTestsByPath <fichiers>` depuis `frontend/` ; tsc via `node node_modules/typescript/bin/tsc --noEmit`.

---

### Task 1 : `AgendaRail.mobileColumns` (TDD)

**Files:**
- Modify: `frontend/components/agenda/AgendaRail.tsx`
- Test: `frontend/__tests__/AgendaRail.test.tsx` (ajout d'un cas)

- [ ] **Step 1 : ajouter le test qui échoue** — à la fin du `describe('AgendaRail')` :

```tsx
  it('mobileColumns personnalisé → variable CSS posée ; défaut = plein cadre', () => {
    const { container, unmount } = wrap(<AgendaRail prevLabel="p" nextLabel="s" mobileColumns="272px">{cards(3)}</AgendaRail>);
    expect((container.querySelector('.ag-rail') as HTMLElement).style.getPropertyValue('--ag-mobile-cols')).toBe('272px');
    unmount();
    const { container: c2 } = render(
      <ThemeProvider><AgendaRail prevLabel="p" nextLabel="s">{cards(3)}</AgendaRail></ThemeProvider>,
    );
    expect((c2.querySelector('.ag-rail') as HTMLElement).style.getPropertyValue('--ag-mobile-cols')).toBe('calc(100% - 6px)');
  });
```

- [ ] **Step 2 : vérifier l'échec**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/AgendaRail.test.tsx`
Expected: FAIL — prop `mobileColumns` inconnue du type / variable CSS absente.

- [ ] **Step 3 : implémenter** — dans `AgendaRail.tsx` :

Dans `RAIL_CSS`, la règle mobile passe de :

```css
@media (max-width:699.98px){.ag-rail{grid-auto-columns:calc(100% - 6px);grid-template-rows:auto;scroll-snap-type:x mandatory}.ag-arrows{display:none}}
```

à :

```css
@media (max-width:699.98px){.ag-rail{grid-auto-columns:var(--ag-mobile-cols);grid-template-rows:auto;scroll-snap-type:x mandatory}.ag-arrows{display:none}}
```

Signature du composant — ajouter la prop (après `desktopRows`) :

```tsx
  /** grid-auto-columns < 700px — défaut plein cadre (une carte + liseré ~14px). Les rails de
   *  parties passent '272px' : cartes compactes conçues pour cette largeur (spec 2026-07-24
   *  carte-partie-unifiée). */
  mobileColumns?: string;
```

avec le défaut dans la destructuration : `mobileColumns = 'calc(100% - 6px)'`.

Style inline du rail — ajouter la variable à côté des deux existantes :

```tsx
          ...({ '--ag-cols': desktopColumns, '--ag-rows': `repeat(${rows}, auto)`, '--ag-mobile-cols': mobileColumns } as React.CSSProperties),
```

- [ ] **Step 4 : vérifier le vert**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/AgendaRail.test.tsx`
Expected: PASS (5 tests). Puis `node node_modules/typescript/bin/tsc --noEmit` → exit 0.

- [ ] **Step 5 : commit**

```bash
git add frontend/components/agenda/AgendaRail.tsx frontend/__tests__/AgendaRail.test.tsx
git commit -m "feat(agenda): AgendaRail.mobileColumns — largeur mobile réglable par surface (défaut plein cadre)"
```

---

### Task 2 : `OpenMatchRailCard` — la carte unique (création + suite, sans toucher l'existant)

**Files:**
- Create: `frontend/components/match/OpenMatchRailCard.tsx`
- Test: `frontend/__tests__/OpenMatchRailCard.test.tsx` (create)

L'ancienne `NationalMatchCard` et sa suite restent EN PLACE dans cette tâche (supprimées en Task 3) — la nouvelle carte est créée et testée isolément d'abord.

- [ ] **Step 1 : écrire la suite qui échoue**

```tsx
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { OpenMatchRailCard, RailMatch } from '@/components/match/OpenMatchRailCard';

jest.mock('@/lib/api', () => ({
  assetUrl: (p: string | null) => p, // Avatar
}));

const CLUB = { name: 'Padel Arena Paris', city: 'Paris', accentColor: '#5e93da' };

function makeMatch(over: Partial<RailMatch> = {}): RailMatch {
  return {
    id: 'm1',
    resourceName: 'Court 1',
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
    ...over,
  };
}

const wrap = (m: RailMatch, opts: { club?: typeof CLUB | null; distanceKm?: number | null } = {}) =>
  render(<ThemeProvider>
    <OpenMatchRailCard match={m} club={opts.club} distanceKm={opts.distanceKm} href="/parties/m1" timezone="Europe/Paris" />
  </ThemeProvider>);

describe('OpenMatchRailCard', () => {
  it('avec club : nom du club, distance, sièges vides, lien', () => {
    wrap(makeMatch(), { club: CLUB, distanceKm: 3.4 });
    expect(screen.getByText('Padel Arena Paris')).toBeInTheDocument();
    expect(screen.getByText('· 3 km')).toBeInTheDocument();
    expect(screen.getAllByTestId('empty-seat')).toHaveLength(2);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/parties/m1');
  });

  it('sans club : ni nom de club, ni liseré identitaire', () => {
    const { container } = wrap(makeMatch());
    expect(screen.queryByText('Padel Arena Paris')).not.toBeInTheDocument();
    expect(container.querySelector('[data-club-band]')).toBeNull();
  });

  it('chips type + genre : Pour de vrai par défaut, Pour le fun si competitive=false, Féminine', () => {
    const { unmount } = wrap(makeMatch({ gender: 'WOMEN' }));
    expect(screen.getByText('Pour de vrai')).toBeInTheDocument();
    expect(screen.getByText('Féminine')).toBeInTheDocument();
    unmount();
    wrap(makeMatch({ competitive: false }));
    expect(screen.getByText('Pour le fun')).toBeInTheDocument();
  });

  it('complet : chip Complet, CTA « Voir la partie », aucun siège vide', () => {
    wrap(makeMatch({
      full: true, spotsLeft: 0,
      players: [
        { userId: 'u1', firstName: 'A', lastName: 'A', avatarUrl: null, isOrganizer: true },
        { userId: 'u2', firstName: 'B', lastName: 'B', avatarUrl: null, isOrganizer: false },
        { userId: 'u3', firstName: 'C', lastName: 'C', avatarUrl: null, isOrganizer: false },
        { userId: 'u4', firstName: 'D', lastName: 'D', avatarUrl: null, isOrganizer: false },
      ],
    }));
    expect(screen.getByText('Complet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Voir la partie/ })).toBeInTheDocument();
    expect(screen.queryAllByTestId('empty-seat')).toHaveLength(0);
  });

  it('non complet : CTA « Rejoindre → » et méta Tous niveaux sans fourchette', () => {
    wrap(makeMatch({ targetLevelMin: null, targetLevelMax: null }));
    expect(screen.getByText('Rejoindre →')).toBeInTheDocument();
    expect(screen.getByText(/Tous niveaux/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2 : vérifier l'échec**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/OpenMatchRailCard.test.tsx`
Expected: FAIL — module `@/components/match/OpenMatchRailCard` introuvable.

- [ ] **Step 3 : créer le composant** — `frontend/components/match/OpenMatchRailCard.tsx` :

```tsx
'use client';
import { OpenMatchGender, OpenMatchPlayer } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { matchSeats } from '@/lib/clubhouse';
import { rangeLabel } from '@/lib/levelMatch';
import { formatDateShort, formatDateShortTimeRange, formatHourRange } from '@/lib/tournament';
import { colorForSeed } from '@/lib/playerColors';
import { distanceLabel } from '@/lib/discover';
import { Avatar } from '@/components/ui/Avatar';
import { Chip } from '@/components/ui/atoms';

/** Forme structurelle commune à `OpenMatch` (club) et `NationalOpenMatch` (plateforme). */
export interface RailMatch {
  id: string;
  resourceName: string;
  startTime: string;
  endTime: string;
  maxPlayers: number;
  spotsLeft: number;
  full?: boolean;
  players: OpenMatchPlayer[];
  targetLevelMin?: number | null;
  targetLevelMax?: number | null;
  competitive?: boolean;
  gender?: OpenMatchGender | null;
}

// LA carte de partie ouverte des rails (spec 2026-07-24 carte-partie-unifiée) : partagée
// entre les surfaces cross-club (/decouvrir, vitrine, Mon Palova — prop `club` fournie →
// liseré identitaire + « club · ville · distance ») et le Club-house (« Ça joue bientôt » —
// `club` omis, contexte mono-club). Pure : pas de fetch, pas de state ; l'appelant fournit
// `href` (cross-sous-domaine ou relatif) et `timezone` (celle du club de la partie).
export function OpenMatchRailCard({ match: m, club, distanceKm, href, timezone }: {
  match: RailMatch;
  club?: { name: string; city: string | null; accentColor: string } | null;
  distanceKm?: number | null;
  href: string;
  timezone: string;
}) {
  const { th } = useTheme();
  const empty = matchSeats(m);
  const full = m.full === true;
  const urgent = !full && m.spotsLeft === 1;
  const level = (m.targetLevelMin != null || m.targetLevelMax != null)
    ? rangeLabel(m.targetLevelMin ?? null, m.targetLevelMax ?? null) : null;
  const genderLabel = m.gender === 'WOMEN' ? 'Féminine' : m.gender === 'MIXED' ? 'Mixte' : null;
  const when = formatDateShortTimeRange(m.startTime, m.endTime, timezone);
  // Date et heure sur 2 lignes distinctes (nowrap chacune) → hauteur de carte CONSTANTE,
  // que le libellé soit court ou long (un seul champ laissait l'heure sauter à la ligne).
  const dateLabel = formatDateShort(m.startTime, timezone);
  const timeLabel = formatHourRange(m.startTime, m.endTime, timezone);
  return (
    <a
      href={href}
      aria-label={`${full ? 'Voir' : 'Rejoindre'} la partie du ${when}${club ? ` à ${club.name}` : ''}`}
      className="pl-lift"
      style={{
        textDecoration: 'none',
        background: th.surface, borderRadius: 20, padding: '16px 16px 15px',
        boxShadow: `${th.shadowSoft}, inset 0 0 0 1px ${th.line}`,
        display: 'flex', flexDirection: 'column', gap: 12, position: 'relative', overflow: 'hidden',
      }}
    >
      {club && (
        <>
          {/* liseré identitaire du club (surfaces cross-club uniquement) */}
          <span aria-hidden="true" data-club-band style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: club.accentColor }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
            <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: '50%', background: club.accentColor, flexShrink: 0 }} />
            <span style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, color: th.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {club.name}
            </span>
            {club.city && (
              <span style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, whiteSpace: 'nowrap', flexShrink: 0 }}>· {club.city}</span>
            )}
            {distanceKm != null && (
              <span style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, whiteSpace: 'nowrap', flexShrink: 0 }}>· {distanceLabel(distanceKm)}</span>
            )}
          </div>
        </>
      )}

      <div>
        <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 18, letterSpacing: -0.2, color: th.text, whiteSpace: 'nowrap' }}>{dateLabel}</div>
        <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 18, letterSpacing: -0.2, color: th.text, whiteSpace: 'nowrap' }}>{timeLabel}</div>
        <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginTop: 3 }}>
          {m.resourceName} · {level ?? 'Tous niveaux'}
        </div>
        {/* Type (toujours) + genre (si féminine/mixte) en chips — mêmes libellés que /parties. */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {m.competitive === false
            ? <Chip tone="line">Pour le fun</Chip>
            : <Chip tone="accent">Pour de vrai</Chip>}
          {genderLabel && <Chip tone="line">{genderLabel}</Chip>}
        </div>
      </div>

      {/* joueurs + sièges à prendre */}
      <div style={{ display: 'flex', alignItems: 'center' }} aria-label={full ? 'Complet' : `${m.spotsLeft} place${m.spotsLeft > 1 ? 's' : ''} à prendre`}>
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
          background: full ? th.surface2 : urgent ? (th.mode === 'floodlit' ? `${ACCENTS.coral}26` : `${ACCENTS.coral}33`) : (th.mode === 'floodlit' ? `${th.accent}26` : `${th.accent}33`),
          color: full ? th.textMute : urgent ? (th.mode === 'floodlit' ? ACCENTS.coral : th.ink) : (th.mode === 'floodlit' ? th.accent : th.ink),
        }}>
          {full ? 'Complet' : `${m.spotsLeft} place${m.spotsLeft > 1 ? 's' : ''}`}
        </span>
      </div>

      {/* marginTop:auto → le CTA descend en bas quand la carte est étirée par le rail :
          les boutons d'une même rangée s'alignent même si une carte est plus haute. */}
      <span style={{
        marginTop: 'auto',
        textAlign: 'center', borderRadius: 11, padding: '10px 12px',
        fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700,
        background: full ? th.surface2 : th.accent, color: full ? th.text : th.onAccent,
      }}>
        {full ? 'Voir la partie' : 'Rejoindre →'}
      </span>
    </a>
  );
}
```

(Différences voulues vs `NationalMatchCard` : bloc club conditionnel + `data-club-band`, `full` géré partout — chip, sièges `urgent`, CTA, aria —, `href`/`timezone` en props, prop `style` supprimée — plus aucun appelant n'en a besoin depuis que le rail gère colonnes et snap.)

- [ ] **Step 4 : vérifier le vert**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/OpenMatchRailCard.test.tsx`
Expected: PASS (5 tests). Puis `node node_modules/typescript/bin/tsc --noEmit` → exit 0.

- [ ] **Step 5 : commit**

```bash
git add frontend/components/match/OpenMatchRailCard.tsx frontend/__tests__/OpenMatchRailCard.test.tsx
git commit -m "feat(match): OpenMatchRailCard — carte de partie unique des rails (en-tête club optionnel, état Complet)"
```

---

### Task 3 : surfaces nationales sur la carte unique + suppression de `NationalMatchCard`

**Files:**
- Modify: `frontend/components/platform/NationalOpenMatches.tsx`
- Modify: `frontend/components/discover/DiscoverMatches.tsx`
- Delete: `frontend/components/platform/NationalMatchCard.tsx`
- Delete: `frontend/__tests__/NationalMatchCard.test.tsx` (couverte par `OpenMatchRailCard.test.tsx`)

- [ ] **Step 1 : NationalOpenMatches** — remplacer l'import `NationalMatchCard` par :

```tsx
import { OpenMatchRailCard } from '@/components/match/OpenMatchRailCard';
import { clubUrl } from '@/lib/clubUrl';
```

et le corps du rail par :

```tsx
    <AgendaRail countLabel={count} desktopColumns="272px" mobileColumns="272px" desktopRows={1}
      prevLabel="Parties précédentes" nextLabel="Parties suivantes">
      {matches.map((m) => (
        <OpenMatchRailCard key={m.id} match={m} club={m.club} timezone={m.club.timezone}
          href={clubUrl(m.club.slug, `/parties/${m.id}`)} />
      ))}
    </AgendaRail>
```

(282px → 272px : convergence des largeurs, spec §2.)

- [ ] **Step 2 : DiscoverMatches** — même mouvement :

```tsx
  <AgendaRail countLabel={count} desktopColumns="272px" mobileColumns="272px" desktopRows={1}
    prevLabel="Parties précédentes" nextLabel="Parties suivantes">
    {list.map((r) => (
      <OpenMatchRailCard key={r.match.id} match={r.match} club={r.match.club} distanceKm={r.distanceKm}
        timezone={r.match.club.timezone} href={clubUrl(r.match.club.slug, `/parties/${r.match.id}`)} />
    ))}
  </AgendaRail>
```

Imports : retirer `NationalMatchCard`, ajouter `OpenMatchRailCard` + `clubUrl` (vérifier si `clubUrl` est déjà importé dans ce fichier avant d'ajouter).

- [ ] **Step 3 : supprimer l'ancienne carte et sa suite**

```bash
git rm frontend/components/platform/NationalMatchCard.tsx frontend/__tests__/NationalMatchCard.test.tsx
```

Puis vérifier qu'aucune référence ne subsiste : `grep -rn "NationalMatchCard" frontend --include="*.tsx" --include="*.ts"` → attendu : aucun résultat.

- [ ] **Step 4 : suites + types**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/NationalOpenMatches.test.tsx __tests__/HomeMatchesRail.test.tsx __tests__/DiscoverMatches.test.tsx __tests__/DiscoverPage.test.tsx __tests__/AnonymousView.test.tsx` puis `node node_modules/typescript/bin/tsc --noEmit`
Expected: PASS / exit 0 (ces suites rendent la carte via ses parents ; les assertions — nom du club, distance, sièges, liens — tiennent car le DTO et le rendu « avec club » sont identiques).

- [ ] **Step 5 : commit**

```bash
git add -A frontend/components/platform frontend/components/discover/DiscoverMatches.tsx frontend/__tests__
git commit -m "feat(rails): surfaces nationales sur OpenMatchRailCard, largeurs unifiées 272px mobile+desktop"
```

---

### Task 4 : Club-house « Ça joue bientôt » sur la carte unique

**Files:**
- Modify: `frontend/components/clubhouse/OpenMatchesShowcase.tsx`

- [ ] **Step 1 : remplacer les cartes `<article>` maison** — le composant se réduit à :

```tsx
'use client';
import { OpenMatch } from '@/lib/api';
import { SectionHeader } from '@/components/clubhouse/SectionHeader';
import { AgendaRail } from '@/components/agenda/AgendaRail';
import { OpenMatchRailCard } from '@/components/match/OpenMatchRailCard';

// Section vedette « Ça joue bientôt » : la carte de partie unique des rails
// (OpenMatchRailCard, sans en-tête club — contexte mono-club) sur le rail partagé.
// Clic → /parties/[id] (relatif, même hôte).
export function OpenMatchesShowcase({ matches, timezone }: { matches: OpenMatch[]; timezone: string }) {
  const shown = matches.slice(0, 6);
  if (matches.length === 0) return null;
  const count = `${shown.length} partie${shown.length > 1 ? 's' : ''}`;
  return (
    <section id="ch-matches">
      <SectionHeader title="Ça joue bientôt" count={count} />
      <AgendaRail desktopColumns="272px" mobileColumns="272px" desktopRows={1}
        prevLabel="Parties précédentes" nextLabel="Parties suivantes">
        {shown.map((m) => (
          <OpenMatchRailCard key={m.id} match={m} href={`/parties/${m.id}`} timezone={timezone} />
        ))}
      </AgendaRail>
    </section>
  );
}
```

(Disparaissent : `Link`, `matchSeats`, `useTheme`, `ACCENTS`, `formatDateShort`/`formatDateShortTimeRange`/`formatHourRange`, `rangeLabel`, `colorForSeed`, `Avatar`, `cardStyle` — tout vit désormais dans la carte partagée. `SectionHeader` reste. Le Club-house y gagne les chips « Pour de vrai »/genre et le CTA « Rejoindre → ».)

- [ ] **Step 2 : suites + types**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/OpenMatchesShowcase.test.tsx __tests__/ClubHouse.test.tsx` puis `node node_modules/typescript/bin/tsc --noEmit`
Expected: PASS / exit 0 — les assertions existantes tiennent : aria `Rejoindre la partie du …` (préservée sans suffixe club), `Voir la partie`, `Complet`, `1 place`, sièges `empty-seat`, compteur, plafond 6, `/Féminine/` (passe de la méta au chip, le texte reste trouvable), « sans fourchette → pas de mention Niveau » (la carte affiche « Tous niveaux », sans N majuscule — le regex `/Niveau/` ne matche pas). ⚠️ Si `OpenMatchesShowcase.test` échoue sur `assetUrl` (Avatar via le vrai `lib/api`), il fonctionnait déjà ainsi — ne rien mocker de plus sans lire l'erreur réelle.

- [ ] **Step 3 : commit**

```bash
git add frontend/components/clubhouse/OpenMatchesShowcase.tsx
git commit -m "feat(clubhouse): Ça joue bientôt sur OpenMatchRailCard — même carte que /decouvrir, chips type/genre incluses"
```

---

### Task 5 : balayage + vérification visuelle

- [ ] **Step 1 : suite scoped**

```bash
node node_modules/jest/bin/jest.js --runTestsByPath \
  __tests__/AgendaRail.test.tsx __tests__/OpenMatchRailCard.test.tsx \
  __tests__/NationalOpenMatches.test.tsx __tests__/HomeMatchesRail.test.tsx \
  __tests__/DiscoverMatches.test.tsx __tests__/DiscoverPage.test.tsx \
  __tests__/OpenMatchesShowcase.test.tsx __tests__/ClubHouse.test.tsx __tests__/AnonymousView.test.tsx
```

Expected: tout PASS. Puis `node node_modules/typescript/bin/tsc --noEmit` → exit 0.

- [ ] **Step 2 : vérif CDP** (skill `verify`, session `test@palova.fr`) — mobile 390 (`mobile:false`, largeur fixe) en clair ET sombre :
  - `http://localhost:3000/decouvrir` : cartes parties compactes ~272px (plus de plein cadre), bout de la carte suivante visible, points de pagination.
  - `http://padel-arena-paris.localhost:3000/` : « Ça joue bientôt » = MÊME carte (chips type/genre, CTA « Rejoindre → »), compacte en mobile.
  - Un cliché desktop 1280 de chaque pour non-régression (largeur 272px inchangée).

- [ ] **Step 3 : retouches éventuelles puis commit**

```bash
git add <fichiers retouchés>
git commit -m "fix(match): retouches issues de la vérification visuelle"
```
