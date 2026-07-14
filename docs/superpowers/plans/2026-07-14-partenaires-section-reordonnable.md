# Partenaires section réordonnable — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the "Partenaires" (sponsors) section of the Club-house fully reorderable from `/admin/club`, instead of being fixed to the bottom of the page.

**Architecture:** `sponsors` currently lives outside the reorderable `SECTION_DEFS`/`order` machinery in `frontend/lib/clubhouse.ts` (tracked only as a separate `sponsorsVisible` boolean) and is rendered unconditionally after all other sections in `frontend/components/ClubHouse.tsx`. This plan folds `sponsors` into the same list as the other 5 sections everywhere: the pure helpers in `lib/clubhouse.ts`, the page renderer in `ClubHouse.tsx`, and the admin editor in `ClubHouseSectionsCard.tsx`. No backend change — `Club.clubHouseSections` (JSON) and `normalizeClubHouseSections` already treat all 6 keys uniformly.

**Tech Stack:** Next.js 16 / React 19 frontend, TypeScript, Jest + React Testing Library. No backend/migration involved.

Spec: `docs/superpowers/specs/2026-07-14-partenaires-section-reordonnable-design.md`

---

### Task 1: `frontend/lib/clubhouse.ts` — merge sponsors into the reorderable helpers

**Files:**
- Modify: `frontend/lib/clubhouse.ts:52-122`
- Test: `frontend/__tests__/clubhouse.test.ts:1` (import), `:80-152` (describe blocks)

- [ ] **Step 1: Update the test file to the new expected behavior (failing test)**

Replace the import on line 1 of `frontend/__tests__/clubhouse.test.ts`:

```ts
import { announcementExpired, fullSectionSettings, hiddenSectionKeys, kiosqueSlides, matchSeats, offerIsActive, resolveSections, SECTION_DEFS, SECTION_KEYS, tournamentPlacesLabel, todayISO } from '../lib/clubhouse';
```

(drops `SPONSORS_DEF`, which is being merged into `SECTION_DEFS` and removed as a separate export)

Replace the whole `describe('resolveSections', ...)` block (originally lines 80-116) with:

```ts
describe('resolveSections', () => {
  it('config null → ordres adaptatifs historiques (membre ≠ visiteur), sponsors inclus en fin', () => {
    expect(resolveSections(null, true).order).toEqual(['matches', 'agenda', 'top', 'offers', 'clubCard', 'sponsors']);
    expect(resolveSections(null, false).order).toEqual(['matches', 'clubCard', 'agenda', 'offers', 'top', 'sponsors']);
    expect(resolveSections(undefined, false).order).toContain('sponsors');
  });

  it('config custom → même ordre pour tous, sections masquées exclues (sponsors compris)', () => {
    const config: ClubHouseSectionSetting[] = [
      { key: 'top', visible: true },
      { key: 'matches', visible: false },
      { key: 'agenda', visible: true },
      { key: 'offers', visible: true },
      { key: 'clubCard', visible: true },
      { key: 'sponsors', visible: false },
    ];
    const member = resolveSections(config, true);
    const visitor = resolveSections(config, false);
    expect(member.order).toEqual(visitor.order);
    expect(member.order[0]).toBe('top');
    expect(member.order).not.toContain('matches');
    expect(member.order).not.toContain('sponsors');
  });

  it('sponsors réordonnable : peut être placé en tête ou au milieu, pas seulement en fin', () => {
    const front = resolveSections([
      { key: 'sponsors', visible: true },
      { key: 'matches', visible: true },
      { key: 'agenda', visible: true },
      { key: 'top', visible: true },
      { key: 'offers', visible: true },
      { key: 'clubCard', visible: true },
    ], true);
    expect(front.order[0]).toBe('sponsors');

    const middle = resolveSections([
      { key: 'matches', visible: true },
      { key: 'sponsors', visible: true },
      { key: 'agenda', visible: true },
      { key: 'top', visible: true },
      { key: 'offers', visible: true },
      { key: 'clubCard', visible: true },
    ], true);
    expect(middle.order[1]).toBe('sponsors');
  });

  it('clé connue absente de la config → ajoutée en fin, visible (tolérance versions)', () => {
    const { order } = resolveSections([{ key: 'clubCard', visible: true }], true);
    expect(order[0]).toBe('clubCard');
    expect(order).toHaveLength(6);
  });

  it('clé inconnue (dont anciennes posters/announcements) ignorée', () => {
    const { order } = resolveSections([{ key: 'posters', visible: true } as never, { key: 'top', visible: true }], true);
    expect(order[0]).toBe('top');
    expect(order).not.toContain('posters');
  });
});
```

Leave the `describe('hiddenSectionKeys', ...)` block (originally lines 118-132) untouched — its expectations already hold under the new implementation.

Replace the last test of `describe('fullSectionSettings / SECTION_DEFS', ...)` (originally lines 149-151):

```ts
  it('SECTION_DEFS couvre exactement SECTION_KEYS (sponsors compris)', () => {
    expect(SECTION_DEFS.map((d) => d.key).sort()).toEqual([...SECTION_KEYS].sort());
  });
```

- [ ] **Step 2: Run the test file to verify it fails**

```bash
cd "C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend" && node node_modules/jest/bin/jest.js __tests__/clubhouse.test.ts
```

Expected: FAIL — `resolveSections(null, true).order` is still `['matches','agenda','top','offers','clubCard']` (missing `'sponsors'`), and `SECTION_DEFS.map((d) => d.key).sort()` doesn't equal `SECTION_KEYS.sort()` (sponsors missing from `SECTION_DEFS`).

- [ ] **Step 3: Implement — merge sponsors into the reorderable helpers**

Replace `frontend/lib/clubhouse.ts` lines 51-122 (from the `// --- Sections configurables ...` comment through the end of `fullSectionSettings`) with:

```ts
// --- Sections configurables du Club-house (miroir écriture : backend normalizeClubHouseSections) ---

/** Toutes les clés de sections. */
export const SECTION_KEYS: ClubHouseSectionKey[] = ['matches', 'agenda', 'top', 'offers', 'clubCard', 'sponsors'];

/** Libellés admin des sections réordonnables (l'ordre ici = ordre par défaut membre). */
export const SECTION_DEFS: { key: ClubHouseSectionKey; label: string; hint?: string }[] = [
  { key: 'matches', label: 'Ça joue bientôt', hint: 'Parties ouvertes qui cherchent des joueurs' },
  { key: 'agenda', label: 'Prochains events & vos réservations' },
  { key: 'top', label: 'Top du mois', hint: 'Podium des victoires du mois' },
  { key: 'offers', label: 'Offres du club', hint: 'Dépend aussi de « Vendre les offres en ligne » (Réglages)' },
  { key: 'clubCard', label: 'Le club', hint: 'Présentation et photos' },
  { key: 'sponsors', label: 'Partenaires', hint: 'Rivière de logos' },
];

const MEMBER_ORDER: ClubHouseSectionKey[] = ['matches', 'agenda', 'top', 'offers', 'clubCard', 'sponsors'];
const VISITOR_ORDER: ClubHouseSectionKey[] = ['matches', 'clubCard', 'agenda', 'offers', 'top', 'sponsors'];

/** Ordre + visibilité effectifs. config null → ordre adaptatif historique (visiteur/membre) ;
 *  sinon la config s'applique à tous. Clé inconnue ignorée, clé connue absente ajoutée en
 *  fin visible (une section livrée après la sauvegarde de la config s'affiche quand même). */
export function resolveSections(
  config: ClubHouseSectionSetting[] | null | undefined,
  isMember: boolean,
): { order: ClubHouseSectionKey[] } {
  if (!Array.isArray(config) || config.length === 0) {
    return { order: isMember ? MEMBER_ORDER : VISITOR_ORDER };
  }
  const seen = new Set<string>();
  const order: ClubHouseSectionKey[] = [];
  for (const e of config) {
    const key = e?.key as ClubHouseSectionKey | undefined;
    if (!key || seen.has(key) || !SECTION_KEYS.includes(key)) continue;
    seen.add(key);
    if (e.visible !== false) order.push(key);
  }
  for (const key of SECTION_KEYS) {
    if (!seen.has(key)) order.push(key);
  }
  return { order };
}

/** Clés masquées par la config (sert à sauter les fetchs inutiles). null → rien de masqué. */
export function hiddenSectionKeys(config: ClubHouseSectionSetting[] | null | undefined): Set<ClubHouseSectionKey> {
  const { order } = resolveSections(config, true); // la visibilité ne dépend pas de l'audience
  const hidden = new Set<ClubHouseSectionKey>();
  for (const key of SECTION_KEYS) if (!order.includes(key)) hidden.add(key);
  return hidden;
}

/** Liste complète (6 entrées) pour l'éditeur admin : config complétée ; null → défaut membre. */
export function fullSectionSettings(config: ClubHouseSectionSetting[] | null | undefined): ClubHouseSectionSetting[] {
  if (!Array.isArray(config) || config.length === 0) {
    return MEMBER_ORDER.map((key) => ({ key, visible: true }));
  }
  const seen = new Set<string>();
  const out: ClubHouseSectionSetting[] = [];
  for (const e of config) {
    const key = e?.key as ClubHouseSectionKey | undefined;
    if (!key || seen.has(key) || !SECTION_KEYS.includes(key)) continue;
    seen.add(key);
    out.push({ key, visible: e.visible !== false });
  }
  for (const key of SECTION_KEYS) if (!seen.has(key)) out.push({ key, visible: true });
  return out;
}
```

- [ ] **Step 4: Run the test file to verify it passes**

```bash
cd "C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend" && node node_modules/jest/bin/jest.js __tests__/clubhouse.test.ts
```

Expected: PASS (all tests green).

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/clubhouse.ts frontend/__tests__/clubhouse.test.ts
git commit -m "feat(clubhouse): partenaires devient une section reordonnable comme les autres"
```

---

### Task 2: `frontend/components/ClubHouse.tsx` — render sponsors through the ordered section list

**Files:**
- Modify: `frontend/components/ClubHouse.tsx:126-173`
- Test: `frontend/__tests__/ClubHouse.test.tsx` (new test, add near the existing "config custom" tests around line 198)

- [ ] **Step 1: Add a failing test proving sponsors can move out of last place**

In `frontend/__tests__/ClubHouse.test.tsx`, insert this test right after the `'config custom : ordre appliqué, section masquée absente et fetch sauté'` test (after line 198, before the `'sponsors masqués'` test):

```tsx
  it('config custom : sponsors peut être réordonné (pas seulement en dernier)', async () => {
    fullSections();
    wrapWith(clubWith([
      { key: 'sponsors', visible: true },
      { key: 'matches', visible: true },
      { key: 'agenda', visible: true },
      { key: 'top', visible: true },
      { key: 'offers', visible: true },
      { key: 'clubCard', visible: true },
    ]));
    await waitFor(() => expect(screen.getByTestId('sec-sponsors')).toBeInTheDocument());
    const ids = screen.getAllByTestId(/^sec-/).map((el) => el.getAttribute('data-testid'));
    expect(ids[0]).toBe('sec-sponsors');
  });
```

- [ ] **Step 2: Run the test file to verify the new test fails**

```bash
cd "C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend" && node node_modules/jest/bin/jest.js __tests__/ClubHouse.test.tsx
```

Expected: FAIL on the new test — `sec-sponsors` is still rendered last (`ClubHouse.tsx` renders it unconditionally after `order.map(...)`), so `ids[0]` is `'sec-matches'`, not `'sec-sponsors'`.

- [ ] **Step 3: Implement — fold sponsors into the `sections` map and the render loop**

Replace `frontend/components/ClubHouse.tsx` lines 128-173 with:

```tsx
  const sections: Record<string, React.ReactNode> = {
    clubCard: showClubCard && presentation && (
      <div>
        <SectionHeader title="Le club" action={{ label: 'Découvrir →', href: '/club' }} />
        <ClubShowcase presentation={presentation} club={club} now={clock} />
      </div>
    ),
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
    matches: upcomingMatches.length > 0 && <OpenMatchesShowcase matches={upcomingMatches.slice(0, 6)} timezone={club.timezone} />,
    offers: showOffers && offers && (
      <OffersShowcase
        offers={offers}
        token={token}
        hasActiveSubscription={hasSub}
        onAuthPrompt={() => setAuthPrompt(true)}
        onPurchased={() => { if (token) api.getMyClubSubscriptions(club.slug, token).then((subs) => setHasSub(subs.length > 0)).catch(() => {}); }}
      />
    ),
    top: topMonth.length >= 3 && <TopOfMonth entries={topMonth} />,
    // SponsorFlipDeck gère déjà son propre padding de bord (contrairement aux autres sections,
    // wrappées par `wrap()`) — rendu tel quel dans la boucle, jamais passé à `wrap()`.
    sponsors: spons.length > 0 && <SponsorFlipDeck key="sponsors" sponsors={spons} now={clock} />,
  };

  // Config admin (Club.clubHouseSections) : un seul ordre pour tous ; null → ordre adaptatif.
  const { order } = resolveSections(club.clubHouseSections, !!token);

  return (
    <>
      <AnnouncementKiosk clubName={club.name} slides={slides} now={clock} intervalSeconds={club.clubHouseKioskSeconds} />

      {club.levelSystemEnabled !== false && (
        <ResultsToRecord token={token} clubSlug={club.slug} />
      )}

      {order.map((k) => (k === 'sponsors' ? sections[k] : wrap(k, sections[k])))}

      {empty && (
```

(the remainder of the `return`, from `{empty && (` onward, is unchanged)

- [ ] **Step 4: Run the test file to verify it passes**

```bash
cd "C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend" && node node_modules/jest/bin/jest.js __tests__/ClubHouse.test.tsx
```

Expected: PASS — including the pre-existing `'visiteur : ... partenaires en dernier'` test (still true by default, since `MEMBER_ORDER`/`VISITOR_ORDER` still end with `'sponsors'`) and the new test.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/ClubHouse.tsx frontend/__tests__/ClubHouse.test.tsx
git commit -m "feat(clubhouse): la rivière partenaires respecte l'ordre configuré des sections"
```

---

### Task 3: `frontend/components/admin/ClubHouseSectionsCard.tsx` — unify the Partenaires row

**Files:**
- Modify: `frontend/components/admin/ClubHouseSectionsCard.tsx:3` (import), `:55-91` (state derivation), `:104-106` (defs map), `:142-176` (render loop + hardcoded row)
- Test: `frontend/__tests__/AdminClub.test.tsx` (new test, add after line 77)

- [ ] **Step 1: Add a failing test proving Partenaires has drag/arrow controls**

In `frontend/__tests__/AdminClub.test.tsx`, insert this test right after the `'carte Sections : ↓ sur la première ligne → ordre permuté dans le PATCH'` test (after line 77):

```tsx
  it('carte Sections : Partenaires est réordonnable comme les autres (flèche ↑)', async () => {
    wrap();
    await waitFor(() => expect(screen.getByText('Sections du Club-house')).toBeInTheDocument());
    expect(screen.getByText('Rivière de logos')).toBeInTheDocument();
    expect(screen.queryByText(/toujours en bas de page/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Descendre Partenaires')).toBeDisabled();
    expect(screen.getByLabelText('Monter Partenaires')).not.toBeDisabled();
    fireEvent.click(screen.getByLabelText('Monter Partenaires'));
    await waitFor(() => expect(api.adminUpdateClub).toHaveBeenCalled());
    const body = (api.adminUpdateClub as jest.Mock).mock.calls[0][1];
    expect(body.clubHouseSections).toHaveLength(6);
    expect(body.clubHouseSections[4].key).toBe('sponsors');
    expect(body.clubHouseSections[5].key).toBe('clubCard');
  });
```

- [ ] **Step 2: Run the test file to verify it fails**

```bash
cd "C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend" && node node_modules/jest/bin/jest.js __tests__/AdminClub.test.tsx
```

Expected: FAIL — `screen.getByLabelText('Monter Partenaires')` throws (no such element; the Partenaires row currently has no ↑/↓ buttons).

- [ ] **Step 3: Implement — remove the special-cased sponsors row**

In `frontend/components/admin/ClubHouseSectionsCard.tsx`, update the import (line 3):

```tsx
import { fullSectionSettings, SECTION_DEFS } from '@/lib/clubhouse';
```

Replace lines 55-91 (from `if (!items) return null;` through the end of the `toggle` function) with:

```tsx
  if (!items) return null;

  const move = (idx: number, dir: -1 | 1) => {
    const next = [...items];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    persist(next);
  };

  const onDropRow = (targetKey: ClubHouseSectionKey) => {
    if (!dragKey || dragKey === targetKey) { setDragKey(null); return; }
    const next = [...items];
    const from = next.findIndex((r) => r.key === dragKey);
    const to = next.findIndex((r) => r.key === targetKey);
    setDragKey(null);
    if (from < 0 || to < 0) return;
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    persist(next);
  };

  const toggle = (key: ClubHouseSectionKey) => {
    persist(items.map((r) => (r.key === key ? { ...r, visible: !r.visible } : r)));
  };
```

Replace the `defs` Map construction (originally lines 104-106):

```tsx
  const defs = new Map<ClubHouseSectionKey, { label: string; hint?: string }>(
    SECTION_DEFS.map((d) => [d.key, d]),
  );
```

Replace the render loop and the hardcoded Partenaires row (originally lines 142-176) with:

```tsx
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((s, idx) => {
          const def = defs.get(s.key);
          return (
            <div key={s.key} onDragOver={(e) => e.preventDefault()} onDrop={() => onDropRow(s.key)}
              style={{ ...rowStyle, opacity: dragKey === s.key ? 0.4 : (s.visible ? 1 : 0.55) }}>
              <span draggable onDragStart={() => setDragKey(s.key)} onDragEnd={() => setDragKey(null)}
                title="Glisser pour réordonner" style={{ cursor: 'grab', display: 'flex' }}>
                <Icon name="grip" size={18} color={th.textFaint} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: th.fontUI, fontSize: 14.5, fontWeight: 600, color: th.text }}>{def?.label}</div>
                {def?.hint && <div style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute }}>{def.hint}</div>}
              </div>
              <button onClick={() => move(idx, -1)} disabled={idx === 0} aria-label={`Monter ${def?.label}`} style={arrowStyle(idx === 0)}>↑</button>
              <button onClick={() => move(idx, 1)} disabled={idx === items.length - 1} aria-label={`Descendre ${def?.label}`} style={arrowStyle(idx === items.length - 1)}>↓</button>
              <label style={toggleLabel}>
                <input type="checkbox" checked={s.visible} onChange={() => toggle(s.key)} aria-label={`Afficher ${def?.label}`} />
                Afficher
              </label>
            </div>
          );
        })}
      </div>
```

- [ ] **Step 4: Run the test file to verify it passes**

```bash
cd "C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend" && node node_modules/jest/bin/jest.js __tests__/AdminClub.test.tsx
```

Expected: PASS — including the pre-existing `'carte Sections : lignes + Partenaires ; masquer une section → PATCH liste complète'` and `'↓ sur la première ligne'` tests, plus the new test.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/admin/ClubHouseSectionsCard.tsx frontend/__tests__/AdminClub.test.tsx
git commit -m "feat(admin): la ligne Partenaires est glissable/flechable comme les autres sections"
```

---

### Task 4: Scoped verification (tests + types)

**Files:** none (verification only)

- [ ] **Step 1: Run all three affected test files together**

```bash
cd "C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend" && node node_modules/jest/bin/jest.js __tests__/clubhouse.test.ts __tests__/ClubHouse.test.tsx __tests__/AdminClub.test.tsx
```

Expected: all suites PASS, 0 failures.

- [ ] **Step 2: Type-check the changed files**

```bash
cd "C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend" && node node_modules/typescript/bin/tsc --noEmit
```

Expected: no new errors referencing `lib/clubhouse.ts`, `components/ClubHouse.tsx`, or `components/admin/ClubHouseSectionsCard.tsx`. (Per project history, `tsc` may surface pre-existing unrelated errors from concurrent WIP elsewhere in the repo — only errors in these three files block this task.)

- [ ] **Step 3: No commit for this task** (verification only, nothing to stage).

---

### Task 5: Visual verification in the browser

**Files:** none (manual/visual QA)

- [ ] **Step 1: Start the dev stack** (Docker + backend + frontend) per `CLAUDE.md`, if not already running.

- [ ] **Step 2: Use the `verify` skill to visually check `/admin/club`**

Log in as a club OWNER/ADMIN, open `/admin/club`, and confirm in the "Sections du Club-house" card:
- The "Partenaires" row now shows a drag handle (⠿) and ↑/↓ buttons like every other row.
- Its hint reads "Rivière de logos" only (no more "— toujours en bas de page").
- Clicking ↑ on "Partenaires" moves it up one slot and the change persists (`adminUpdateClub` call, reload shows it in the new position).

- [ ] **Step 3: Use the `verify` skill to visually check the Club-house page (`/`)**

After moving "Partenaires" to, e.g., the top of the order in `/admin/club`, load the club's Club-house homepage and confirm the partner logos ribbon now renders near the top of the page instead of at the bottom, with normal spacing (no doubled padding/gutter around it).

- [ ] **Step 4: Revert the test club's section order** back to whatever it was before this manual check (or leave as the user prefers) — this step has no fixed outcome, just avoid leaving the demo club in a confusing state without saying so.
