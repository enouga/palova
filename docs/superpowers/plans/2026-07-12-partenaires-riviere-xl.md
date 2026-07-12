# Partenaires — Rivière XL (SponsorMarquee v2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the "Nos partenaires" marquee card in `SponsorMarquee.tsx` so the logo is the hero (large white tile) instead of a tiny 46px icon, per the approved spec.

**Architecture:** Single-file frontend change. `SponsorMarquee.tsx`'s `card()` render function is rewritten from a horizontal logo+text layout to a vertical logo-hero layout (tile → name → offer row). All surrounding logic (sort order from backend, scroll/duplication mechanics, reduced-motion fallback, link wrapping, code-copy behavior, `now`-based expiry) is untouched.

**Tech Stack:** Next.js 16 / React 19, TypeScript, Jest + React Testing Library, existing `lib/theme.ts` (`ACCENTS`), `lib/tournament.ts` (`deadlineCountdown`), `lib/clubhouse.ts` (`offerIsActive`).

**Spec:** `docs/superpowers/specs/2026-07-12-partenaires-riviere-xl-design.md`

---

## File Structure

- **Modify:** `frontend/components/clubhouse/SponsorMarquee.tsx` — rewrite the `card()` closure only; component signature, hooks, `copy()`, section wrapper, `<style>` block (except the animation duration formula) stay as-is.
- **Modify:** `frontend/__tests__/SponsorMarquee.test.tsx` — update assertions to match the new DOM shape (tile image, name, offer chip, code button, countdown).

No other files change. No backend, no migration.

---

### Task 1: Rewrite the card to logo-hero layout, update tests

**Files:**
- Modify: `frontend/components/clubhouse/SponsorMarquee.tsx`
- Test: `frontend/__tests__/SponsorMarquee.test.tsx`

- [ ] **Step 1: Read the current test file baseline (already done above) — write the new failing tests**

Replace the full contents of `frontend/__tests__/SponsorMarquee.test.tsx` with:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { SponsorMarquee } from '@/components/clubhouse/SponsorMarquee';
import { ThemeProvider } from '@/lib/ThemeProvider';
import type { Sponsor } from '@/lib/api';

jest.mock('@/lib/api', () => ({ ...jest.requireActual('@/lib/api'), assetUrl: (p: string | null) => p }));

const sponsor = (over: Partial<Sponsor>): Sponsor => ({
  id: 's1', name: 'Head Padel', logoUrl: '/uploads/sponsors/h.png', linkUrl: null,
  offerText: null, offerCode: null, offerUntil: null, pinned: false, sortOrder: 0, isActive: true, createdAt: '', ...over,
});

const wrap = (sponsors: Sponsor[], now: Date | null) =>
  render(<ThemeProvider><SponsorMarquee sponsors={sponsors} now={now} /></ThemeProvider>);

describe('SponsorMarquee', () => {
  const now = new Date('2026-07-05T12:00:00Z');

  it('rend la tuile logo en héros avec le nom dessous, piste dupliquée', () => {
    wrap([sponsor({}), sponsor({ id: 's2', name: 'Nox' }), sponsor({ id: 's3', name: 'CM' })], now);
    const logos = screen.getAllByAltText('Head Padel');
    expect(logos.length).toBe(2); // piste dupliquée pour la boucle
    expect(logos[0]).toHaveAttribute('src', '/uploads/sponsors/h.png');
    expect(screen.getAllByText('Head Padel').length).toBeGreaterThanOrEqual(2); // nom sous la tuile
  });

  it('offre active → chip + bouton code copiable', () => {
    wrap([sponsor({ offerText: '-15 % raquettes', offerCode: 'PADEL15' }), sponsor({ id: 's2', name: 'Nox' }), sponsor({ id: 's3', name: 'CM' })], now);
    expect(screen.getAllByText('-15 % raquettes').length).toBe(2);
    fireEvent.click(screen.getAllByRole('button', { name: /PADEL15/ })[0]);
    // le code est copié (best-effort — pas de crash sans navigator.clipboard en jsdom)
  });

  it('sans offre → tuile + nom seuls, pas de chip', () => {
    wrap([sponsor({}), sponsor({ id: 's2', name: 'Nox' })], now);
    expect(screen.queryByRole('button', { name: /Copier/ })).toBeNull();
  });

  it('offre expirée → carte sans chip d’offre', () => {
    wrap([sponsor({ offerText: '-15 %', offerUntil: '2026-07-01T23:59:59.999Z' }), sponsor({ id: 's2' }), sponsor({ id: 's3' })], now);
    expect(screen.queryByText('-15 %')).toBeNull();
  });

  it('expiration urgente → compte à rebours affiché', () => {
    wrap([sponsor({ offerText: '-15 %', offerUntil: '2026-07-06T00:00:00.000Z' }), sponsor({ id: 's2' }), sponsor({ id: 's3' })], now);
    expect(screen.getAllByText(/Plus que/).length).toBeGreaterThan(0);
  });

  it('≤ 2 sponsors → grille statique sans duplication', () => {
    wrap([sponsor({}), sponsor({ id: 's2', name: 'Nox' })], now);
    expect(screen.getAllByAltText('Head Padel').length).toBe(1);
  });

  it('rien sans sponsor', () => {
    const { container } = wrap([], now);
    expect(container.firstChild).toBeNull();
  });
});
```

Key changes from the old suite: logos are now found via `getAllByAltText` (the tile `<img>` is the primary element, not a 46px icon next to text), and a new test covers the urgent-countdown case that the old suite never exercised on the marquee itself.

- [ ] **Step 2: Run the test file to confirm it fails against the current implementation**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/SponsorMarquee.test.tsx`
Expected: FAIL — `getAllByAltText('Head Padel')` still matches (alt was already the name), but the "sans chip" test fails because the current layout doesn't render a distinguishable "Copier" button role name the same way, and the urgent-countdown test fails because the current card never renders `deadlineCountdown` text at all (confirms this is new behavior, not yet implemented).

- [ ] **Step 3: Rewrite `SponsorMarquee.tsx`**

Replace the full contents of `frontend/components/clubhouse/SponsorMarquee.tsx` with:

```tsx
'use client';
import { useState } from 'react';
import { Sponsor, assetUrl } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { offerIsActive } from '@/lib/clubhouse';
import { deadlineCountdown } from '@/lib/tournament';
import { ACCENTS } from '@/lib/theme';
import { SectionHeader } from '@/components/clubhouse/SectionHeader';

// Rivière des partenaires : le logo est la carte (tuile blanche XL), nom +
// offre dessous ; boucle CSS pure avec pause au survol, statique si ≤ 2
// sponsors ou reduced-motion.
export function SponsorMarquee({ sponsors, now = null }: { sponsors: Sponsor[]; now?: Date | null }) {
  const { th } = useTheme();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  if (sponsors.length === 0) return null;
  const ref = now ?? new Date(0);
  const scrolling = sponsors.length > 2;
  const track = scrolling ? [...sponsors, ...sponsors] : sponsors;

  const copy = async (s: Sponsor) => {
    try { await navigator.clipboard.writeText(s.offerCode ?? ''); setCopiedId(s.id); setTimeout(() => setCopiedId(null), 1600); } catch { /* silencieux */ }
  };

  const card = (s: Sponsor, i: number) => {
    const active = offerIsActive(s, ref);
    const expiry = active && s.offerUntil && now ? deadlineCountdown(s.offerUntil, now) : null;
    const tile = (
      <div style={{ width: 150, height: 84, borderRadius: 12, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 1px 4px rgba(20,40,80,.14)`, padding: 10 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={assetUrl(s.logoUrl) ?? ''} alt={s.name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
      </div>
    );
    const name = (
      <div style={{ marginTop: 8, fontFamily: th.fontUI, fontSize: 11, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', color: th.text, textAlign: 'center' }}>
        {s.name}
      </div>
    );
    return (
      <div key={`${s.id}-${i}`} style={{ width: 150, flexShrink: 0, textAlign: 'center' }}>
        {s.linkUrl
          ? <a href={s.linkUrl} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', display: 'block' }}>{tile}{name}</a>
          : <>{tile}{name}</>}
        {active && (s.offerText || s.offerCode) && (
          <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            {s.offerText && (
              <span style={{ fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, color: th.accent, background: `${th.accent}1c`, borderRadius: 7, padding: '3px 8px', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.offerText}
              </span>
            )}
            {s.offerCode && (
              <button onClick={() => copy(s)} aria-label={`Copier le code ${s.offerCode}`} style={{
                border: 'none', cursor: 'pointer', fontFamily: th.fontMono, fontSize: 11, fontWeight: 700,
                color: '#fff', background: th.text, borderRadius: 7, padding: '3px 8px',
              }}>
                {copiedId === s.id ? '✓ Copié' : s.offerCode}
              </button>
            )}
            {expiry?.urgent && (
              <span style={{ fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 700, color: ACCENTS.coral }}>{expiry.text}</span>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <section style={{ padding: '26px 0 8px' }}>
      <div style={{ padding: '0 20px' }}>
        <SectionHeader title="Nos partenaires" />
      </div>
      <style>{`
        .sp-marquee { overflow: hidden; position: relative; }
        .sp-marquee::before, .sp-marquee::after { content: ''; position: absolute; top: 0; bottom: 0; width: 32px; z-index: 2; pointer-events: none; }
        .sp-marquee::before { left: 0; background: linear-gradient(90deg, ${th.bg}, transparent); }
        .sp-marquee::after { right: 0; background: linear-gradient(-90deg, ${th.bg}, transparent); }
        .sp-track { display: flex; gap: 16px; width: max-content; padding: 2px 20px; align-items: flex-start; }
        .sp-track[data-scrolling='true'] { animation: sp-slide ${Math.max(22, sponsors.length * 8)}s linear infinite; }
        .sp-track[data-scrolling='true']:hover { animation-play-state: paused; }
        @keyframes sp-slide { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        @media (prefers-reduced-motion: reduce) {
          .sp-track[data-scrolling='true'] { animation: none; flex-wrap: wrap; width: auto; }
        }
      `}</style>
      <div className="sp-marquee">
        <div className="sp-track" data-scrolling={scrolling}>
          {track.map((s, i) => card(s, i))}
        </div>
      </div>
    </section>
  );
}
```

Notes on this rewrite vs. the old file:
- `tile` and `name` are always rendered (wrapped in the `<a>` when `linkUrl` is set) — matches spec §"Anatomie" steps 1–2 and the "lien tuile+nom" requirement.
- The offer block (chip + code button + countdown) is a **sibling** of the `<a>`, never nested inside it — same anti-nested-interactive pattern as the old file (button must stay outside the anchor).
- `active && (s.offerText || s.offerCode)` guards the whole offer block so a sponsor with an active `offerCode` but no `offerText` (edge case, not in current seed data but allowed by the `Sponsor` type) still renders correctly — this is a minor superset of the spec's "chip with offerText" language, needed because `offerText` and `offerCode` are independently nullable in the type.
- Animation duration formula changed from `Math.max(18, n*6)` to `Math.max(22, n*8)` per spec's "ajustement" section (wider cards scroll slightly slower).
- Bullet-proofed code button color: `th.text` background + white text (was `${th.accent}1c` background + `th.accent` text) — reads on the new white-tile-adjacent layout; this is a visual call within spec intent ("bouton code mono, fond encre" from the anatomie mockup), not a spec deviation.

- [ ] **Step 4: Run the test file again to confirm it passes**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/SponsorMarquee.test.tsx`
Expected: PASS — all 7 tests green.

- [ ] **Step 5: Type-check the changed files**

Run: `cd frontend && node node_modules/typescript/bin/tsc --noEmit`
Expected: no new errors attributable to `SponsorMarquee.tsx` or its test file. (Pre-existing unrelated errors elsewhere in the repo, if any, are not this task's concern — only check output mentioning `SponsorMarquee`.)

- [ ] **Step 6: Commit**

```bash
cd frontend
git add components/clubhouse/SponsorMarquee.tsx __tests__/SponsorMarquee.test.tsx
git commit -m "feat(clubhouse): rivière partenaires - logo en héros (Rivière XL)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Visual verification (light + dark, mobile + desktop)

**Files:** none (verification only)

- [ ] **Step 1: Start the dev stack per `CLAUDE.md`** (Docker, backend `npm run dev`, frontend `npm run dev`) if not already running.

- [ ] **Step 2: Invoke the `verify` skill** against the Club-house page on the seeded demo club (`padel-arena-paris`, slug from memory) to screenshot the "Nos partenaires" section in both themes and both viewport classes (mobile ~390px, desktop ~1280px). Confirm:
  - Logo tiles are visibly larger than the old 46px icons and stay legible in dark mode (white tile background holds).
  - Name renders in small caps under the tile.
  - The Babolat/Decathlon seed sponsors (no offer data in dev seed) render tile+name only, no empty offer row.
  - If a sponsor with `offerText`/`offerCode` is temporarily seeded for the check (optional — only if the current seed has none), the chip + code button render correctly and clicking the code shows "✓ Copié".
  - Scrolling track still loops smoothly and pauses on hover; reduced-motion still wraps statically (can be checked via CDP emulation flag if the `verify` skill supports it, otherwise skip and rely on the unchanged CSS).

- [ ] **Step 3: Report findings.** If a visual issue is found (e.g. tile shadow too strong on dark background, name text truncating unexpectedly), fix it in `SponsorMarquee.tsx`, re-run the Task 1 test suite to confirm no regression, and commit as a follow-up fix commit (not amended).

---

## Self-Review

**Spec coverage:**
- Tuile logo ~150×84, blanc fixe, contain, ombre douce → Task 1 Step 3 ✓
- Nom petites capitales sous la tuile → Task 1 Step 3 ✓
- Chip offre + bouton code copiable + "✓ Copié" → Task 1 Step 3 ✓ (test in Task 1 Step 1)
- Compte à rebours coral si urgent → Task 1 Step 3 ✓ (test in Task 1 Step 1)
- Sans offre → tuile + nom seuls → Task 1 Step 3 ✓ (test in Task 1 Step 1)
- Tri pinned/sortOrder inchangé → not touched, backend-only, no task needed (spec explicitly says "non touché")
- Lien tuile+nom, bouton hors ancre → Task 1 Step 3 ✓
- Défilement/duplication/pause/fondus/reduced-motion inchangés → preserved verbatim in Step 3, tested in Task 1 Step 1 ("piste dupliquée" test, "≤ 2 sponsors" test)
- `now` null-safe → preserved (`ref = now ?? new Date(0)`), unchanged from original
- 0 sponsor → section non rendue → tested in Task 1 Step 1
- Durée d'animation ajustée → Task 1 Step 3 ✓
- Vérification visuelle CDP clair/sombre/mobile/desktop → Task 2 ✓
- Hors périmètre (page dédiée, backend, admin) → correctly excluded, no tasks touch those areas

**Placeholder scan:** none found — all code blocks are complete and runnable, no "TBD"/"similar to above".

**Type consistency:** `Sponsor` type fields used (`id`, `name`, `logoUrl`, `linkUrl`, `offerText`, `offerCode`, `offerUntil`, `pinned`, `sortOrder`, `isActive`, `createdAt`) match the existing `lib/api.ts` type used by both the old component and the test fixture — no new fields introduced. `offerIsActive`, `deadlineCountdown`, `assetUrl`, `SectionHeader`, `ACCENTS`, `useTheme` are all pre-existing imports used identically to the original file.
