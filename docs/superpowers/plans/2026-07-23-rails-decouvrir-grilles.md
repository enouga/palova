# Rails découvrir + retrait "Toutes" + grilles 4×2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the previous rail work (compteur+flèches) to `/decouvrir`'s parties
section, remove the now-redundant "Toutes/Tout voir →" links from the two rails that
have arrows, and switch the events/tournois listings (Club-house "Prochains events",
`/decouvrir` Tournois) from a wrapping/list layout to a 4-column × 2-row grid (8 cards).

**Architecture:** Reuses the `useScrollRail`/`RailArrows` pair built in the previous
round — no new shared components needed. The two grid changes are pure CSS container
swaps (existing card markup untouched); `ClubHouse.tsx`'s "Prochains events" +
"Vos réservations" pairing becomes a vertical stack (each full width) instead of a
2-column `.ch-grid`, since a real 4-column grid needs the full page width.

**Tech Stack:** Next.js 16 / React / TypeScript, Jest + Testing Library.

**Spec de référence :** `docs/superpowers/specs/2026-07-23-rails-decouvrir-grilles-design.md`

---

## Contexte utile à l'engineer

- Commandes depuis `frontend/` : `node node_modules/jest/bin/jest.js --runTestsByPath <fichier>`,
  `node node_modules/typescript/bin/tsc --noEmit` (jamais `npx`, shims cassés sur ce poste).
- `useScrollRail`/`RailArrows` existent déjà (`frontend/lib/useScrollRail.ts`,
  `frontend/components/ui/RailArrows.tsx`) — livrés au tour précédent, ne pas les
  recréer, juste les importer.
- `NationalMatchCard` accepte un prop `style?: React.CSSProperties` qui est spread dans
  son style inline final — passer `{ flex: '0 0 270px', scrollSnapAlign: 'start' }`
  fonctionne comme dans `NationalOpenMatches.tsx`.
- Aucune migration, aucun changement backend — 100% frontend.

---

### Task 1: Retirer "Toutes/Tout voir →" des 2 rails à flèches

**Files:**
- Modify: `frontend/components/clubhouse/OpenMatchesShowcase.tsx`
- Modify: `frontend/components/platform/home/HomeMatchesRail.tsx`
- Modify: `frontend/__tests__/OpenMatchesShowcase.test.tsx`
- Modify: `frontend/__tests__/HomeMatchesRail.test.tsx`

- [ ] **Step 1: Update the failing tests**

In `frontend/__tests__/OpenMatchesShowcase.test.tsx`, in the first test
(`'carte : sièges vides dessinés (maxPlayers - inscrits), niveau, CTA Rejoindre → /parties/[id]'`),
remove this line:

```tsx
    expect(screen.getByRole('link', { name: /Toutes les parties/i })).toHaveAttribute('href', '/parties');
```

Replace the whole test body with:

```tsx
  it('carte : sièges vides dessinés (maxPlayers - inscrits), niveau, CTA Rejoindre → /parties/[id]', () => {
    wrap([match({})]);
    expect(screen.getAllByTestId('empty-seat')).toHaveLength(3);
    expect(screen.getByText(/Niveau 4 à 6/)).toBeInTheDocument();
    expect(screen.getByText(/3 places/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Rejoindre la partie/ })).toHaveAttribute('href', '/parties/m1');
  });

  it('pas de lien « Toutes les parties » (retiré, doublon avec la nav)', () => {
    wrap([match({})]);
    expect(screen.queryByRole('link', { name: /Toutes/i })).toBeNull();
  });
```

In `frontend/__tests__/HomeMatchesRail.test.tsx`, replace the first test:

```tsx
  it('affiche le rail (mes clubs d\'abord) + lien « Toutes »', async () => {
    mocked.listNationalOpenMatches.mockResolvedValue([match('m1', 'autre'), match('m2', 'mien')] as never);
    render(<ThemeProvider><HomeMatchesRail myClubSlugs={new Set(['mien'])} /></ThemeProvider>);
    await waitFor(() => expect(screen.getByRole('link', { name: /Toutes/ })).toHaveAttribute('href', '/decouvrir#parties'));
    // tri : la carte de MON club sort en premier dans le DOM
    const links = Array.from(document.querySelectorAll('a[href*="/parties/"]')).map((a) => a.getAttribute('href'));
    expect(links[0]).toContain('/parties/m2');
  });
```

with:

```tsx
  it('affiche le rail (mes clubs d\'abord), pas de lien « Toutes »', async () => {
    mocked.listNationalOpenMatches.mockResolvedValue([match('m1', 'autre'), match('m2', 'mien')] as never);
    render(<ThemeProvider><HomeMatchesRail myClubSlugs={new Set(['mien'])} /></ThemeProvider>);
    await waitFor(() => expect(document.querySelectorAll('a[href*="/parties/"]').length).toBe(2));
    expect(screen.queryByRole('link', { name: /Toutes/ })).toBeNull();
    // tri : la carte de MON club sort en premier dans le DOM
    const links = Array.from(document.querySelectorAll('a[href*="/parties/"]')).map((a) => a.getAttribute('href'));
    expect(links[0]).toContain('/parties/m2');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/OpenMatchesShowcase.test.tsx __tests__/HomeMatchesRail.test.tsx`
Expected: FAIL — the new "pas de lien" assertions find the link (not yet removed).

- [ ] **Step 3: Remove the links**

In `frontend/components/clubhouse/OpenMatchesShowcase.tsx`, change:

```tsx
      <SectionHeader title="Ça joue bientôt" action={{ label: 'Toutes les parties →', href: '/parties' }} count={count} />
```

to:

```tsx
      <SectionHeader title="Ça joue bientôt" count={count} />
```

In `frontend/components/platform/home/HomeMatchesRail.tsx`, change:

```tsx
      <SectionHeader kicker="Parties à rejoindre" moreLabel="Toutes →" moreHref="/decouvrir#parties" />
```

to:

```tsx
      <SectionHeader kicker="Parties à rejoindre" />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/OpenMatchesShowcase.test.tsx __tests__/HomeMatchesRail.test.tsx`
Expected: PASS (all tests)

- [ ] **Step 5: Type-check**

Run: `node node_modules/typescript/bin/tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/clubhouse/OpenMatchesShowcase.tsx frontend/components/platform/home/HomeMatchesRail.tsx frontend/__tests__/OpenMatchesShowcase.test.tsx frontend/__tests__/HomeMatchesRail.test.tsx
git commit -m "feat(club-house,platform): remove redundant \"Toutes\" link on arrow-rails"
```

---

### Task 2: `/decouvrir` "Parties ouvertes" → rail (compteur + flèches)

**Files:**
- Modify: `frontend/components/discover/DiscoverMatches.tsx` (full file)
- Modify: `frontend/__tests__/DiscoverMatches.test.tsx`

- [ ] **Step 1: Write the failing test**

In `frontend/__tests__/DiscoverMatches.test.tsx`, add this test at the end of the
`describe('DiscoverMatches', ...)` block, right before the closing `});`:

```tsx
  it('affiche le compteur de résultats', async () => {
    wrap({ matches: [makeMatch({ id: 'm1' }), makeMatch({ id: 'm2', club: { ...makeMatch().club, name: 'Autre club' } })] });
    expect(await screen.findByText('2 parties')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/DiscoverMatches.test.tsx`
Expected: FAIL — `Unable to find an element with the text: 2 parties`

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
import { filterNationalMatches, sortMatchesByDistance, DiscoverPeriod, LocationQuery } from '@/lib/discover';
import { useScrollRail } from '@/lib/useScrollRail';
import { RailArrows } from '@/components/ui/RailArrows';

const PERIOD_OPTIONS: { value: DiscoverPeriod; label: string }[] = [
  { value: 'today', label: "Aujourd'hui" },
  { value: 'weekend', label: 'Week-end' },
  { value: 'all', label: '14 jours' },
];

// Rail de découverte, pas un flux exhaustif : on plafonne l'affichage (comme les autres
// rails de la vitrine — OpenMatchesShowcase à 6, UpcomingTournaments à 4).
const MAX_VISIBLE = 9;

// Onglet « Parties » de la page /decouvrir : rail de parties ouvertes nationales
// (GET /api/open-matches/national, chargées par le parent) filtrées par période/localisation/
// niveau et triées par distance. Même traitement compteur+flèches que le rail de l'accueil
// (NationalOpenMatches) — cette page EST déjà la vue complète, pas de lien "voir tout".
// Pur côté données — `matches`/`location`/`coords`/`now` arrivent en props, seuls
// `period`/`levelOn`/`rating` sont un état local à ce composant. `onCount` (optionnel)
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
  const [period, setPeriod] = useState<DiscoverPeriod>('all');
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
    ? sortMatchesByDistance(filterNationalMatches(matches, { period, location, myLevel }, now), coords).slice(0, MAX_VISIBLE)
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
            {PERIOD_OPTIONS.map((o) => (
              <FacetChip key={o.value} label={o.label} tint={FILTER_TINTS.quand} active={period === o.value} onClick={() => setPeriod(o.value)} />
            ))}
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
          <div style={{ textAlign: 'right', fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginBottom: 4 }}>{count}</div>
          <div style={{ position: 'relative', margin: '0 -20px' }}>
            <div ref={railRef} className="sp-scroll-x" style={{ display: 'flex', gap: 14, padding: '4px 20px 8px', scrollSnapType: 'x proximity', scrollPaddingLeft: 20 }}>
              {list.map((r) => (
                <NationalMatchCard key={r.match.id} match={r.match} distanceKm={r.distanceKm} style={{ flex: '0 0 270px', scrollSnapAlign: 'start' }} />
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
Expected: PASS (all tests, including the new one). All prior tests (filters, sorting,
level toggle, cap at 9, empty state, onCount) still exercise the same DOM shape
(`role="link"` cards), unaffected by grid→rail.

- [ ] **Step 5: Type-check**

Run: `node node_modules/typescript/bin/tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/discover/DiscoverMatches.tsx frontend/__tests__/DiscoverMatches.test.tsx
git commit -m "feat(discover): parties ouvertes rail gains result counter + arrows"
```

---

### Task 3: Club-house "Prochains events" → grille 4×2, pleine largeur

**Files:**
- Modify: `frontend/components/clubhouse/TournamentsAlaUne.tsx` (full file)
- Modify: `frontend/components/ClubHouse.tsx:115,141-152`
- Modify: `frontend/__tests__/TournamentsAlaUne.test.tsx`

- [ ] **Step 1: Write the failing test**

In `frontend/__tests__/TournamentsAlaUne.test.tsx`, add this test at the end of the
`describe('TournamentsAlaUne', ...)` block, right before the closing `});`:

```tsx
  it('rend les items dans une grille responsive (classe ta-grid)', () => {
    const { container } = wrap(items([t({}), t({ id: 't2', name: 'P200' })]));
    expect(container.querySelector('.ta-grid')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/TournamentsAlaUne.test.tsx`
Expected: FAIL — `.ta-grid` not found (container is still a plain flex column, no class)

- [ ] **Step 3: Write the implementation**

Replace the entire content of `frontend/components/clubhouse/TournamentsAlaUne.tsx` with:

```tsx
'use client';
import Link from 'next/link';
import { tournamentPlacesLabel } from '@/lib/clubhouse';
import { AgendaItem, eventPlacesLabel, KIND_LABEL } from '@/lib/events';
import { deadlineCountdown, fillRatio, formatHourRange } from '@/lib/tournament';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS, gaugeTrack } from '@/lib/theme';
import { Icon } from '@/components/ui/Icon';
import { cardStyle } from '@/components/clubhouse/SectionHeader';

const GENDER_LABEL: Record<string, string> = { MEN: 'Messieurs', WOMEN: 'Dames', MIXED: 'Mixte' };

function formatDay(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).format(new Date(iso));
}

// « Prochains events » : tournois + animations fusionnés (nom de fichier historique conservé).
// Chaque carte : nom + chip compte à rebours, badge + date, mini-jauge de remplissage et
// urgence. Grille responsive (1 colonne mobile, 2 ≥560px, 4 ≥900px — « 2 lignes de 4 » sur
// desktop) : la section est pleine largeur (cf. ClubHouse.tsx), plus jamais partagée à
// mi-largeur avec « Vos réservations ». `now` null avant le mount (hydration-safe) : les
// countdowns n'apparaissent qu'ensuite.
export function TournamentsAlaUne({ items, timezone, now = null, multiSport = false }: { items: AgendaItem[]; timezone: string; now?: Date | null; multiSport?: boolean }) {
  const { th } = useTheme();
  if (items.length === 0) return null;
  return (
    <div style={{ ...cardStyle(th), padding: '16px' }}>
      <style>{`.ta-grid{display:grid;grid-template-columns:1fr;gap:10px}@media(min-width:560px){.ta-grid{grid-template-columns:1fr 1fr}}@media(min-width:900px){.ta-grid{grid-template-columns:1fr 1fr 1fr 1fr}}`}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
        <span aria-hidden="true" style={{ width: 28, height: 28, borderRadius: 9, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: th.mode === 'floodlit' ? `${ACCENTS.apricot}26` : `${ACCENTS.apricot}40` }}>
          <Icon name="trophy" size={15} color={th.mode === 'floodlit' ? ACCENTS.apricot : th.ink} />
        </span>
        <span style={{ fontFamily: th.fontUI, fontWeight: 800, fontSize: 14, color: th.text }}>Prochains events</span>
      </div>
      <div className="ta-grid">
        {items.filter((item) => item.source !== 'lesson').map((item) => {
          const isT = item.source === 'tournament';
          const id = isT ? item.tournament.id : item.event.id;
          const name = isT ? item.tournament.name : item.event.name;
          const badge = isT ? `${item.tournament.category} · ${GENDER_LABEL[item.tournament.gender]}` : KIND_LABEL[item.event.kind];
          const sportName = multiSport ? ((isT ? item.tournament.sport?.name : item.event.sport?.name) ?? null) : null;
          const places = isT ? tournamentPlacesLabel(item.tournament) : eventPlacesLabel(item.event);
          const href = isT ? `/tournois/${id}` : `/events/${id}`;
          const deadline = isT ? item.tournament.registrationDeadline : item.event.registrationDeadline;
          const countdown = now ? deadlineCountdown(deadline, now) : null;
          const ratio = isT
            ? fillRatio(item.tournament)
            : fillRatio({ confirmedCount: item.event.confirmedCount, maxTeams: item.event.capacity });
          return (
            <Link key={`${item.source}-${id}`} href={href} aria-label={name} style={{ textDecoration: 'none', background: th.surface2, borderRadius: 12, padding: '10px 12px', display: 'block' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ flex: 1, minWidth: 0, fontFamily: th.fontUI, fontSize: 14, fontWeight: 700, color: th.text }}>{name}</span>
                {countdown && (
                  <span style={{
                    fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', borderRadius: 999, padding: '2px 8px',
                    background: countdown.urgent ? (th.mode === 'floodlit' ? `${ACCENTS.coral}26` : `${ACCENTS.coral}40`) : th.surface,
                    color: countdown.urgent ? (th.mode === 'floodlit' ? ACCENTS.coral : th.ink) : th.textMute,
                  }}>
                    {countdown.text}
                  </span>
                )}
              </span>
              <span style={{ display: 'block', fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginTop: 2 }}>
                {sportName ? `${sportName} · ` : ''}{badge}
                {' · '}
                {formatDay(item.startTime, timezone)}
                {' · '}
                {formatHourRange(item.startTime, item.endTime, timezone)}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}>
                {ratio != null && (
                  <span style={{ flex: '0 1 90px', ...gaugeTrack(th, 4, 999, th.surface) }}>
                    <span style={{ display: 'block', height: '100%', borderRadius: 999, background: places.urgent ? ACCENTS.coral : th.accent, width: `${Math.round(ratio * 100)}%` }} />
                  </span>
                )}
                <span style={{ fontFamily: th.fontUI, fontSize: 12, fontWeight: places.urgent ? 700 : 500, color: places.urgent ? ACCENTS.coral : th.textMute }}>{places.text}</span>
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
```

(Only 2 real changes vs. the original: the new `<style>` tag, and the items container
going from `style={{ display: 'flex', flexDirection: 'column', gap: 7 }}` to
`className="ta-grid"`. Every item's own markup is untouched.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/TournamentsAlaUne.test.tsx`
Expected: PASS (all tests, including the new one)

- [ ] **Step 5: Update `ClubHouse.tsx` — cap 8 + full-width stack**

In `frontend/components/ClubHouse.tsx`, change line 115:

```tsx
  const nextEvents = mergeAgenda(tournaments, events, [], now).slice(0, 3);
```

to:

```tsx
  const nextEvents = mergeAgenda(tournaments, events, [], now).slice(0, 8);
```

Then replace the `agenda` entry of the `sections` object (currently lines 141-152):

```tsx
    // Prochains events + Vos réservations côte à côte (≥ 700px) — cartes sœurs, même langage.
    agenda: (nextEvents.length > 0 || next.length > 0) && (
      <>
        <style>{`.ch-grid{display:grid;grid-template-columns:1fr;gap:12px;align-items:start}@media(min-width:700px){.ch-grid{grid-template-columns:1fr 1fr}}`}</style>
        <div className={nextEvents.length > 0 && next.length > 0 ? 'ch-grid' : undefined}>
          {nextEvents.length > 0 && (
            <TournamentsAlaUne items={nextEvents} timezone={club.timezone} now={clock} multiSport={clubIsMultiSport(club)} />
          )}
          {next.length > 0 && <MyReservationsCard reservations={next} onManage={setConfirmCancel} />}
        </div>
      </>
    ),
```

with:

```tsx
    // Prochains events (pleine largeur, grille 4×2) puis Vos réservations juste après —
    // chacun pleine largeur : une vraie grille 4 colonnes a besoin de plus de place que la
    // moitié de page qu'offrait l'ancien côte-à-côte (.ch-grid, retiré).
    agenda: (nextEvents.length > 0 || next.length > 0) && (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {nextEvents.length > 0 && (
          <TournamentsAlaUne items={nextEvents} timezone={club.timezone} now={clock} multiSport={clubIsMultiSport(club)} />
        )}
        {next.length > 0 && <MyReservationsCard reservations={next} onManage={setConfirmCancel} />}
      </div>
    ),
```

- [ ] **Step 6: Run the existing ClubHouse suite (regression check)**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/ClubHouse.test.tsx`
Expected: PASS — existing assertions only check text presence ("Prochains events" etc.),
none depend on the `.ch-grid` class or the 3-item cap, so no test changes are needed here.

- [ ] **Step 7: Type-check**

Run: `node node_modules/typescript/bin/tsc --noEmit`
Expected: no new errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/components/clubhouse/TournamentsAlaUne.tsx frontend/components/ClubHouse.tsx frontend/__tests__/TournamentsAlaUne.test.tsx
git commit -m "feat(club-house): prochains events becomes a full-width 4x2 grid"
```

---

### Task 4: `/decouvrir` Tournois → 4 colonnes, plafond 8

**Files:**
- Modify: `frontend/components/calendar/TournamentFinder.tsx`
- Modify: `frontend/__tests__/TournamentFinder.test.tsx:127-142`

- [ ] **Step 1: Update the failing test**

In `frontend/__tests__/TournamentFinder.test.tsx`, replace the test at lines 127-142:

```tsx
  it('hideTitle : grille 2 colonnes et plafonnée à 10, la page /tournois autonome reste complète', async () => {
    const many: NationalTournament[] = Array.from({ length: 15 }, (_, i) => ({
      ...NAT[0], id: `t${i}`, name: `Tournoi ${i}`,
    }));
    const onCount = jest.fn();
    const { container, rerender } = render(
      <ThemeProvider><TournamentFinder hideTitle items={many} onCount={onCount} /></ThemeProvider>,
    );
    await waitFor(() => expect(onCount).toHaveBeenLastCalledWith(10));
    expect(screen.getAllByText(/^Tournoi \d+$/)).toHaveLength(10);
    expect(container.querySelector('.discover-tournaments-grid')).not.toBeNull();

    // La page autonome (pas de hideTitle) ne tronque rien.
    rerender(<ThemeProvider><TournamentFinder items={many} /></ThemeProvider>);
    expect(screen.getAllByText(/^Tournoi \d+$/)).toHaveLength(15);
  });
```

with:

```tsx
  it('hideTitle : grille 4 colonnes et plafonnée à 8, la page /tournois autonome reste complète', async () => {
    const many: NationalTournament[] = Array.from({ length: 15 }, (_, i) => ({
      ...NAT[0], id: `t${i}`, name: `Tournoi ${i}`,
    }));
    const onCount = jest.fn();
    const { container, rerender } = render(
      <ThemeProvider><TournamentFinder hideTitle items={many} onCount={onCount} /></ThemeProvider>,
    );
    await waitFor(() => expect(onCount).toHaveBeenLastCalledWith(8));
    expect(screen.getAllByText(/^Tournoi \d+$/)).toHaveLength(8);
    expect(container.querySelector('.discover-tournaments-grid')).not.toBeNull();

    // La page autonome (pas de hideTitle) ne tronque rien.
    rerender(<ThemeProvider><TournamentFinder items={many} /></ThemeProvider>);
    expect(screen.getAllByText(/^Tournoi \d+$/)).toHaveLength(15);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/TournamentFinder.test.tsx`
Expected: FAIL — `onCount` was last called with `10`, not `8`; 10 items found, not 8.

- [ ] **Step 3: Write the implementation**

In `frontend/components/calendar/TournamentFinder.tsx`, change:

```tsx
// Plafond d'affichage quand le calendrier est embarqué (page /decouvrir, `hideTitle`) : ce
// n'est pas un flux exhaustif là-bas, contrairement à la page /tournois autonome (filtres +
// « Effacer » restent le bon outil pour aller plus loin). Nombre pair pour la grille 2 colonnes.
const MAX_VISIBLE = 10;
```

to:

```tsx
// Plafond d'affichage quand le calendrier est embarqué (page /decouvrir, `hideTitle`) : ce
// n'est pas un flux exhaustif là-bas, contrairement à la page /tournois autonome (filtres +
// « Effacer » restent le bon outil pour aller plus loin). 2 lignes de 4 sur la grille large écran.
const MAX_VISIBLE = 8;
```

Then change:

```tsx
      {hideTitle && (
        <style>{`.discover-tournaments-grid{display:grid;grid-template-columns:1fr;gap:12px}@media(min-width:640px){.discover-tournaments-grid{grid-template-columns:1fr 1fr}}`}</style>
      )}
```

to:

```tsx
      {hideTitle && (
        <style>{`.discover-tournaments-grid{display:grid;grid-template-columns:1fr;gap:12px}@media(min-width:640px){.discover-tournaments-grid{grid-template-columns:1fr 1fr}}@media(min-width:960px){.discover-tournaments-grid{grid-template-columns:1fr 1fr 1fr 1fr}}`}</style>
      )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/TournamentFinder.test.tsx`
Expected: PASS (all tests)

- [ ] **Step 5: Type-check**

Run: `node node_modules/typescript/bin/tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/calendar/TournamentFinder.tsx frontend/__tests__/TournamentFinder.test.tsx
git commit -m "feat(discover): tournois grid gains a 4-column breakpoint, cap 10 to 8"
```

---

### Task 5: Vérification finale

**Files:** none (verification only)

- [ ] **Step 1: Run the full frontend test suite**

Run: `node node_modules/jest/bin/jest.js`
Expected: PASS — no regressions. (Per project memory, a full run may show the known
pre-existing `BookingModal`/`ClubReserve.opening` test-isolation flake, unrelated to
this work — if seen, re-run those specific suites in isolation to confirm.)

- [ ] **Step 2: Full type-check**

Run: `node node_modules/typescript/bin/tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Visual verification (CDP)**

With the dev stack running (`docker-compose-v1.exe up -d`, backend + frontend `npm run
dev`), capture and inspect, light+dark, desktop (1280) and mobile (390):

- `/decouvrir#parties` (anonymous and connected) — rail of `NationalMatchCard`s with a
  "N parties" counter and arrows (same look as the homepage rail), filter chips above
  unaffected.
- `/decouvrir#tournois` — grid of `AgendaCard`s, 4 columns at ≥960px viewport, capped at 8.
- Club-house home (connected, a club with ≥1 upcoming tournament/event AND ≥1 upcoming
  reservation) — "Prochains events" full width as a 4-column grid (2-column at
  560-900px, 1 column below), "Vos réservations" stacked immediately below it, also
  full width — confirm no leftover half-width layout.
- Club-house home + Mon Palova homepage — confirm the "Toutes les parties →" /
  "Toutes →" links are gone from "Ça joue bientôt" and "Parties à rejoindre" headers,
  while the counter + arrows still work as before.

No code changes expected at this step unless a real visual regression is found — if
so, fix inline and re-run the affected suite + tsc before re-verifying.

---

## Self-review notes (for the plan author, already applied above)

- **Spec coverage**: all 3 decisions (decouvrir rail, link removal scope, 4×2 grids ×2
  locations) each have a dedicated task.
- **Type consistency**: `useScrollRail`/`RailArrows` used with the exact same signature
  as the previous round (Task 2 here mirrors `NationalOpenMatches.tsx`'s existing
  wiring, not a new pattern).
- **No placeholders**: every step has complete, exact code.
- **Scope guard**: `HomeAgenda.tsx`, `MyReservationsCard.tsx`'s own "Tout voir →", and
  `UpcomingTournaments.tsx` (anonymous vitrine) are explicitly NOT touched by any task
  here, per the confirmed scope decision.
