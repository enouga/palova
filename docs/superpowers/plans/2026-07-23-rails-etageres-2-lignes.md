# Étagères 2 lignes (correction des grilles qui wrappent) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the wrapping 4-column grids built in the previous round (Club-house
"Prochains events", `/decouvrir` Tournois, `/decouvrir` Clubs) with 2-row horizontally
scrolling shelves — same `useScrollRail`/`RailArrows`/counter mechanics as the 1-row
rails already shipped, just filling 2 rows per column via `grid-auto-flow: column`.

**Architecture:** Pure CSS container change (`grid-template-columns` wrap → `grid-auto-flow:
column` + `grid-template-rows: repeat(2, auto)`) plus the same rail scaffolding
(`useScrollRail` + `RailArrows` + a small counter) already used by the 4 rails from
the first round. No new shared components. Existing card markup (`AgendaCard`,
`ClubCard`, `TournamentsAlaUne`'s own `<Link>` item) untouched.

**Tech Stack:** Next.js 16 / React / TypeScript, Jest + Testing Library.

**Spec de référence :** `docs/superpowers/specs/2026-07-23-rails-etageres-2-lignes-design.md`

---

## Contexte utile à l'engineer

- Commandes depuis `frontend/` : `node node_modules/jest/bin/jest.js --runTestsByPath <fichier>`,
  `node node_modules/typescript/bin/tsc --noEmit`.
- `useScrollRail`/`RailArrows` existent déjà — ne pas les recréer.
- Les 3 fichiers cibles ont chacun déjà une classe CSS scopée (`.ta-grid`,
  `.discover-tournaments-grid`, `.discover-clubs-grid`) posée au tour précédent — on
  change seulement leur DÉFINITION CSS (le nom de classe et son point de pose restent).
- Aucune migration, aucun changement backend.

---

### Task 1: `TournamentsAlaUne.tsx` (Club-house « Prochains events ») → étagère 2 lignes

**Files:**
- Modify: `frontend/components/clubhouse/TournamentsAlaUne.tsx` (full file)
- Modify: `frontend/__tests__/TournamentsAlaUne.test.tsx`

- [ ] **Step 1: Write the failing test**

In `frontend/__tests__/TournamentsAlaUne.test.tsx`, add this test at the end of the
`describe('TournamentsAlaUne', ...)` block, right before the closing `});` (after the
existing `.ta-grid` test):

```tsx
  it('affiche le compteur de résultats à côté du titre', () => {
    wrap(items([t({}), t({ id: 't2', name: 'P200' })]));
    expect(screen.getByText('2 résultats')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/TournamentsAlaUne.test.tsx`
Expected: FAIL — `Unable to find an element with the text: 2 résultats`

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
import { useScrollRail } from '@/lib/useScrollRail';
import { RailArrows } from '@/components/ui/RailArrows';

const GENDER_LABEL: Record<string, string> = { MEN: 'Messieurs', WOMEN: 'Dames', MIXED: 'Mixte' };

function formatDay(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).format(new Date(iso));
}

// « Prochains events » : tournois + animations fusionnés (nom de fichier historique conservé).
// Étagère qui défile HORIZONTALEMENT sur 2 lignes (grid-auto-flow: column) — même mécanique
// que les rails à 1 ligne (compteur + flèches), pas une grille qui wrap : le glisser/les
// flèches révèlent les colonnes suivantes, le nombre de colonnes visibles dépend juste de la
// largeur d'écran. Section pleine largeur (cf. ClubHouse.tsx), plus jamais partagée à
// mi-largeur avec « Vos réservations ». `now` null avant le mount (hydration-safe) : les
// countdowns n'apparaissent qu'ensuite.
export function TournamentsAlaUne({ items, timezone, now = null, multiSport = false }: { items: AgendaItem[]; timezone: string; now?: Date | null; multiSport?: boolean }) {
  const { th } = useTheme();
  const shown = items.filter((item) => item.source !== 'lesson');
  const { railRef, edges, scrollByPage } = useScrollRail([shown.length]);
  if (items.length === 0) return null;
  const count = `${shown.length} résultat${shown.length > 1 ? 's' : ''}`;
  return (
    <div style={{ ...cardStyle(th), padding: '16px' }}>
      <style>{`.ta-grid{display:grid;grid-template-rows:repeat(2,auto);grid-auto-flow:column;grid-auto-columns:260px;gap:10px;align-items:start}`}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
        <span aria-hidden="true" style={{ width: 28, height: 28, borderRadius: 9, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: th.mode === 'floodlit' ? `${ACCENTS.apricot}26` : `${ACCENTS.apricot}40` }}>
          <Icon name="trophy" size={15} color={th.mode === 'floodlit' ? ACCENTS.apricot : th.ink} />
        </span>
        <span style={{ fontFamily: th.fontUI, fontWeight: 800, fontSize: 14, color: th.text }}>Prochains events</span>
        <span style={{ marginLeft: 'auto', fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute }}>{count}</span>
      </div>
      <div style={{ position: 'relative', margin: '0 -20px' }}>
        <div ref={railRef} className="sp-scroll-x ta-grid" style={{ padding: '4px 20px 8px', scrollSnapType: 'x proximity', scrollPaddingLeft: 20 }}>
          {shown.map((item) => {
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
        <RailArrows edges={edges} onPrev={() => scrollByPage(-1)} onNext={() => scrollByPage(1)} prevLabel="Précédents" nextLabel="Suivants" fadeBottom={8} />
      </div>
    </div>
  );
}
```

(Functional diff vs. the previous round: `shown` is now computed once and reused for
both the counter and the `.map`; `useScrollRail` + `RailArrows` + the counter span are
new; `.ta-grid`'s CSS switches from a column-count wrap to a 2-row column-flow shelf;
the outer scroll wrapper gains the standard `position:relative; margin:0 -20px` bleed.
Every item's own markup is byte-identical to before.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/TournamentsAlaUne.test.tsx`
Expected: PASS (all tests, including the `.ta-grid` presence test from the previous
round and the new counter test)

- [ ] **Step 5: Regression-check `ClubHouse.test.tsx`**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/ClubHouse.test.tsx`
Expected: PASS (text-presence assertions only, unaffected)

- [ ] **Step 6: Type-check**

Run: `node node_modules/typescript/bin/tsc --noEmit`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/clubhouse/TournamentsAlaUne.tsx frontend/__tests__/TournamentsAlaUne.test.tsx
git commit -m "fix(club-house): prochains events is a 2-row scrolling shelf, not a wrapping grid"
```

---

### Task 2: `TournamentFinder.tsx` (embedded `/decouvrir` Tournois) → étagère 2 lignes

**Files:**
- Modify: `frontend/components/calendar/TournamentFinder.tsx`
- Modify: `frontend/__tests__/TournamentFinder.test.tsx`

- [ ] **Step 1: Update the failing test**

In `frontend/__tests__/TournamentFinder.test.tsx`, replace the test titled
`'hideTitle : grille 4 colonnes et plafonnée à 8, la page /tournois autonome reste complète'`
(added in the previous round) with:

```tsx
  it('hideTitle : étagère 2 lignes plafonnée à 8, la page /tournois autonome reste complète', async () => {
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
    expect(screen.getByText('8 tournois')).toBeInTheDocument();

    // La page autonome (pas de hideTitle) ne tronque rien.
    rerender(<ThemeProvider><TournamentFinder items={many} /></ThemeProvider>);
    expect(screen.getAllByText(/^Tournoi \d+$/)).toHaveLength(15);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/TournamentFinder.test.tsx`
Expected: FAIL — `Unable to find an element with the text: 8 tournois` (counter doesn't
exist yet)

- [ ] **Step 3: Write the implementation**

In `frontend/components/calendar/TournamentFinder.tsx`, change the closing render
block. Replace:

```tsx
      {hideTitle && (
        <style>{`.discover-tournaments-grid{display:grid;grid-template-columns:1fr;gap:12px}@media(min-width:640px){.discover-tournaments-grid{grid-template-columns:1fr 1fr}}@media(min-width:960px){.discover-tournaments-grid{grid-template-columns:1fr 1fr 1fr 1fr}}`}</style>
      )}
      <div
        className={hideTitle ? 'discover-tournaments-grid' : undefined}
        style={hideTitle ? { padding: '18px 20px 0', alignItems: 'start' } : { padding: '18px 20px 0', display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        {visibleResults === null && <div style={{ fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>}
        {visibleResults?.length === 0 && (
          <div style={{ textAlign: 'center', padding: '18px 0 6px', ...(hideTitle ? { gridColumn: '1 / -1' } : {}) }}>
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
        {visibleResults?.map(({ tournament: t, distanceKm }) => {
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
              extra={t.entryFee ? `${t.entryFee} €` : null}
              sportLabel={showSport ? (t.sport?.name ?? null) : null}
              onClick={() => { window.location.href = clubUrl(t.club.slug, `/tournois/${t.id}`); }}
            />
          );
        })}
      </div>
    </div>
  );
}
```

with:

```tsx
      {hideTitle ? (
        <div style={{ padding: '18px 20px 0' }}>
          {visibleResults === null && <div style={{ fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>}
          {visibleResults?.length === 0 && (
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
          {visibleResults != null && visibleResults.length > 0 && (
            <>
              <style>{`.discover-tournaments-grid{display:grid;grid-template-rows:repeat(2,auto);grid-auto-flow:column;grid-auto-columns:320px;gap:12px;align-items:start}`}</style>
              <div style={{ textAlign: 'right', fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginBottom: 4 }}>
                {visibleResults.length} tournoi{visibleResults.length > 1 ? 's' : ''}
              </div>
              <div style={{ position: 'relative', margin: '0 -20px' }}>
                <div ref={railRef} className="sp-scroll-x discover-tournaments-grid" style={{ padding: '4px 20px 8px', scrollSnapType: 'x proximity', scrollPaddingLeft: 20 }}>
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
                        extra={t.entryFee ? `${t.entryFee} €` : null}
                        sportLabel={showSport ? (t.sport?.name ?? null) : null}
                        onClick={() => { window.location.href = clubUrl(t.club.slug, `/tournois/${t.id}`); }}
                      />
                    );
                  })}
                </div>
                <RailArrows edges={edges} onPrev={() => scrollByPage(-1)} onNext={() => scrollByPage(1)} prevLabel="Tournois précédents" nextLabel="Tournois suivants" fadeBottom={8} />
              </div>
            </>
          )}
        </div>
      ) : (
        <div style={{ padding: '18px 20px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {visibleResults === null && <div style={{ fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>}
          {visibleResults?.length === 0 && (
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
          {visibleResults?.map(({ tournament: t, distanceKm }) => {
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
                extra={t.entryFee ? `${t.entryFee} €` : null}
                sportLabel={showSport ? (t.sport?.name ?? null) : null}
                onClick={() => { window.location.href = clubUrl(t.club.slug, `/tournois/${t.id}`); }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
```

(Splitting the `hideTitle` vs. standalone branches into two separate blocks — rather
than the previous single block with inline conditionals — is what lets the embedded
mode own its rail wrapper/counter/arrows without touching the standalone page's plain
list, which keeps its own unrelated layout untouched.)

Then add the hook call and imports. At the top of the file, change:

```tsx
import { AgendaCard } from '@/components/agenda/AgendaCard';
import { FacetPanel } from '@/components/calendar/FacetPanel';
```

to:

```tsx
import { AgendaCard } from '@/components/agenda/AgendaCard';
import { FacetPanel } from '@/components/calendar/FacetPanel';
import { useScrollRail } from '@/lib/useScrollRail';
import { RailArrows } from '@/components/ui/RailArrows';
```

And right after the existing `visibleResults` effect (`useEffect(() => { if (visibleResults) onCount?.(visibleResults.length); }, [visibleResults?.length, onCount]);`),
add:

```tsx
  const { railRef, edges, scrollByPage } = useScrollRail([visibleResults?.length ?? 0]);
```

(`TournamentFinder` has no early return before its JSX, so this hook can go anywhere
among the other top-level hooks — no Rules-of-Hooks concern here.)

Also update the comment above `MAX_VISIBLE` (no functional change, just accuracy —
it no longer describes a "grille 2 colonnes"):

```tsx
// Plafond d'affichage quand le calendrier est embarqué (page /decouvrir, `hideTitle`) : ce
// n'est pas un flux exhaustif là-bas, contrairement à la page /tournois autonome (filtres +
// « Effacer » restent le bon outil pour aller plus loin). Étagère 2 lignes : ce plafond ne
// limite plus le nombre de colonnes visibles, juste le total chargé dans l'étagère.
const MAX_VISIBLE = 8;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/TournamentFinder.test.tsx`
Expected: PASS (all tests)

- [ ] **Step 5: Type-check**

Run: `node node_modules/typescript/bin/tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/calendar/TournamentFinder.tsx frontend/__tests__/TournamentFinder.test.tsx
git commit -m "fix(discover): tournois is a 2-row scrolling shelf, not a wrapping grid"
```

---

### Task 3: `ClubDirectory.tsx` → étagère 2 lignes, aucun plafond

**Files:**
- Modify: `frontend/components/ClubDirectory.tsx`
- Modify: `frontend/__tests__/ClubDirectory.test.tsx`

- [ ] **Step 1: Update the failing test**

In `frontend/__tests__/ClubDirectory.test.tsx`, replace the test titled
`'les résultats sont rendus dans une grille 2 colonnes'`:

```tsx
it('les résultats sont rendus dans une grille 2 colonnes', async () => {
  authToken = null;
  const club = (id: string) => ({
    id, slug: id, name: id.toUpperCase(), city: null, description: null,
    accentColor: '#123456', logoUrl: null, coverImageUrl: null, sports: [], resourceCount: 1,
  });
  listClubs.mockResolvedValue([club('a'), club('b')]);
  const { container } = wrap();
  await waitFor(() => expect(screen.getAllByTestId('club-card')).toHaveLength(2));
  expect(container.querySelector('.discover-clubs-grid')).not.toBeNull();
});
```

with:

```tsx
it('les résultats sont rendus dans une étagère 2 lignes, avec un compteur', async () => {
  authToken = null;
  const club = (id: string) => ({
    id, slug: id, name: id.toUpperCase(), city: null, description: null,
    accentColor: '#123456', logoUrl: null, coverImageUrl: null, sports: [], resourceCount: 1,
  });
  listClubs.mockResolvedValue([club('a'), club('b')]);
  const { container } = wrap();
  await waitFor(() => expect(screen.getAllByTestId('club-card')).toHaveLength(2));
  expect(container.querySelector('.discover-clubs-grid')).not.toBeNull();
  expect(screen.getByText('2 clubs')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/ClubDirectory.test.tsx`
Expected: FAIL — `Unable to find an element with the text: 2 clubs`

- [ ] **Step 3: Write the implementation**

In `frontend/components/ClubDirectory.tsx`, add imports. Change:

```tsx
import { ClubCard } from '@/components/ClubCard';
```

to:

```tsx
import { ClubCard } from '@/components/ClubCard';
import { useScrollRail } from '@/lib/useScrollRail';
import { RailArrows } from '@/components/ui/RailArrows';
```

Add the hook call right after `visibleClubs` is computed (below its `useEffect` for
`onCount`, still inside the top-level hook sequence — this component has no early
return, so placement is not hook-order-sensitive, but keeping it near `visibleClubs`
keeps the code readable):

```tsx
  const { railRef, edges, scrollByPage } = useScrollRail([visibleClubs.length]);
```

Then replace the "résultats" block:

```tsx
      {/* résultats */}
      <style>{`.discover-clubs-grid{display:grid;grid-template-columns:1fr;gap:16px}@media(min-width:640px){.discover-clubs-grid{grid-template-columns:1fr 1fr}}`}</style>
      <div className="discover-clubs-grid" style={{ padding: '20px 20px 0', alignItems: 'start' }}>
        {loading ? (
          <div style={{ gridColumn: '1 / -1', padding: '30px 0', textAlign: 'center', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>
        ) : error ? (
          <div style={{ gridColumn: '1 / -1', padding: '30px 0', textAlign: 'center', fontFamily: th.fontUI, color: th.textMute }}>
            Impossible de charger les clubs pour le moment.
            <div style={{ marginTop: 10 }}>
              <button onClick={load} style={{ border: 'none', background: th.accent, color: th.onAccent, borderRadius: 999, padding: '8px 16px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700 }}>Réessayer</button>
            </div>
          </div>
        ) : visibleClubs.length === 0 ? (
          <div style={{ gridColumn: '1 / -1', padding: '30px 0', textAlign: 'center', fontFamily: th.fontUI, color: th.textMute }}>Aucun club ne correspond.</div>
        ) : (
          visibleClubs.map((c, i) => <ClubCard key={c.id} club={c} defaultCover={COVER_PHOTOS[i % COVER_PHOTOS.length]} />)
        )}
      </div>
    </>
  );
}
```

with:

```tsx
      {/* résultats — étagère qui défile horizontalement sur 2 lignes (grid-auto-flow:
          column), pas une grille qui wrap : c'est un vrai annuaire (recherche + filtres),
          aucun plafond — tout résultat filtré doit rester atteignable via le défilement. */}
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
          <>
            <style>{`.discover-clubs-grid{display:grid;grid-template-rows:repeat(2,auto);grid-auto-flow:column;grid-auto-columns:270px;gap:16px;align-items:start}`}</style>
            <div style={{ textAlign: 'right', fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginBottom: 4 }}>
              {visibleClubs.length} club{visibleClubs.length > 1 ? 's' : ''}
            </div>
            <div style={{ position: 'relative', margin: '0 -20px' }}>
              <div ref={railRef} className="sp-scroll-x discover-clubs-grid" style={{ padding: '4px 20px 8px', scrollSnapType: 'x proximity', scrollPaddingLeft: 20 }}>
                {visibleClubs.map((c, i) => <ClubCard key={c.id} club={c} defaultCover={COVER_PHOTOS[i % COVER_PHOTOS.length]} />)}
              </div>
              <RailArrows edges={edges} onPrev={() => scrollByPage(-1)} onNext={() => scrollByPage(1)} prevLabel="Clubs précédents" nextLabel="Clubs suivants" fadeBottom={8} />
            </div>
          </>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/ClubDirectory.test.tsx`
Expected: PASS (all tests, including the renamed one)

- [ ] **Step 5: Regression-check `AnonymousView.test.tsx`** (also renders `ClubDirectory`,
uncontrolled, on the platform vitrine)

Run: `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/AnonymousView.test.tsx`
Expected: PASS

- [ ] **Step 6: Type-check**

Run: `node node_modules/typescript/bin/tsc --noEmit`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/ClubDirectory.tsx frontend/__tests__/ClubDirectory.test.tsx
git commit -m "fix(discover): club directory is a 2-row scrolling shelf, not a wrapping grid, no cap"
```

---

### Task 4: Vérification finale

**Files:** none (verification only)

- [ ] **Step 1: Run the full frontend test suite**

Run: `node node_modules/jest/bin/jest.js`
Expected: PASS — no regressions (aside from the known pre-existing
`BookingModal`/`ClubReserve.opening` full-run flake, unrelated to this work).

- [ ] **Step 2: Full type-check**

Run: `node node_modules/typescript/bin/tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Visual verification (CDP)**

With the dev stack running, capture and inspect `/decouvrir` (desktop 1280 + mobile
390) and the Club-house home (connected, a club with upcoming tournaments/events),
light + dark:

- Tournois and Clubs sections on `/decouvrir`: 2 physical rows, cards flow down each
  column (item 1 above item 2, item 3 starts a new column), counter + arrows, no
  wrapping to a 3rd/4th visual row regardless of viewport width.
- Club-house "Prochains events": same 2-row shelf, full width, counter now present
  next to the title, "Vos réservations" still stacked below it.
- Confirm the Clubs shelf has no visible cap (all clubs from the directory reachable
  via the arrows/scroll, not just the first 4).

No code changes expected at this step unless a real visual regression is found — if
so, fix inline and re-run the affected suite + tsc before re-verifying.

---

## Self-review notes (for the plan author, already applied above)

- **Spec coverage**: all 3 target components (TournamentsAlaUne, TournamentFinder
  embedded, ClubDirectory) have a task; the "no cap on clubs" requirement is called out
  explicitly in Task 3.
- **Type consistency**: `useScrollRail`/`RailArrows` used with the same signature as
  every prior usage this session.
- **No placeholders**: every step has complete, exact code.
