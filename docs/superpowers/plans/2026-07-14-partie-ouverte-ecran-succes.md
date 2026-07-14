# Partie ouverte : déplacer l'interrupteur vers l'écran de succès — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the pre-confirmation "Partie ouverte aux membres" switch from `BookingModal.tsx` and re-create the same switch UI, wired to the post-confirmation API, on the success screen that follows (`BookingSuccess.tsx`).

**Architecture:** A new small component `OpenMatchQuickSwitch` duplicates the exact switch UI that used to live in `BookingModal`, but calls `api.setReservationVisibility` (post-confirmation) instead of `api.applyHoldSetup` (pre-confirmation). It's rendered in `BookingSuccess` above the existing "Organisez votre partie" block. Because that block already renders `ReservationPlayersInline`, which internally renders `OpenMatchToggle` (a richer, slider-based version of the same control), `ReservationPlayersInline` gets a new `hideOpenMatchToggle` prop so the two controls don't both appear on the success screen — the calendar surfaces (`DayPanel`, `MyAgendaListItem`, `ReservationAgendaCard`) keep the full `OpenMatchToggle` untouched.

**Tech Stack:** Next.js 16 (React 19), TypeScript, Jest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-14-partie-ouverte-ecran-succes-design.md`

---

## Before you start

Run these two commands from `frontend/` to confirm your baseline is green (both should report success / no output):

```bash
cd frontend
node node_modules/jest/bin/jest.js __tests__/BookingModal.test.tsx __tests__/BookingSuccess.test.tsx __tests__/ReservationPlayersInline.test.tsx __tests__/OpenMatchToggle.test.tsx
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
```

All commands below assume the working directory is `frontend/`.

---

### Task 1: `ReservationPlayersInline` gains a `hideOpenMatchToggle` prop

**Files:**
- Modify: `frontend/components/reservations/ReservationPlayersInline.tsx`
- Test: `frontend/__tests__/ReservationPlayersInline.test.tsx`

- [ ] **Step 1: Write the failing test**

Open `frontend/__tests__/ReservationPlayersInline.test.tsx`. Add this test right after the last
test in the file (after the `it("padel : propose d'ouvrir la partie", ...)` block, before the
closing `});` of the `describe`):

```tsx
  it('hideOpenMatchToggle masque le contrôle « Ouvrir la partie »', () => {
    render(
      <ThemeProvider>
        <ReservationPlayersInline reservation={resa(padel)} token="abc" now={now} onChanged={() => {}} hideOpenMatchToggle />
      </ThemeProvider>
    );
    expect(screen.queryByRole('button', { name: /Ouvrir la partie/ })).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/jest/bin/jest.js __tests__/ReservationPlayersInline.test.tsx`
Expected: FAIL — TypeScript/JSX will still compile (the prop is just ignored by React), but the
assertion fails because `OpenMatchToggle` is currently always rendered, so the button IS in the
document. The failure message will be something like:
`expect(element).not.toBeInTheDocument() ... received value must not be in the document`.

- [ ] **Step 3: Implement the prop**

In `frontend/components/reservations/ReservationPlayersInline.tsx`, change the function
signature (currently):

```tsx
export function ReservationPlayersInline({ reservation, token, now, onChanged }: {
  reservation: MyReservation;
  token: string;
  now: number;
  onChanged: () => void;
}) {
```

to:

```tsx
export function ReservationPlayersInline({ reservation, token, now, onChanged, hideOpenMatchToggle }: {
  reservation: MyReservation;
  token: string;
  now: number;
  onChanged: () => void;
  /** Masque le contrôle d'ouverture interne — utilisé par l'écran de succès de réservation,
   *  qui affiche son propre interrupteur juste au-dessus (cf. OpenMatchQuickSwitch). */
  hideOpenMatchToggle?: boolean;
}) {
```

Then change the render (currently):

```tsx
  return (
    <div style={{ marginTop: 9 }}>
      <OpenMatchToggle reservation={reservation} token={token} now={now} onChanged={onChanged} />
```

to:

```tsx
  return (
    <div style={{ marginTop: 9 }}>
      {!hideOpenMatchToggle && (
        <OpenMatchToggle reservation={reservation} token={token} now={now} onChanged={onChanged} />
      )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_modules/jest/bin/jest.js __tests__/ReservationPlayersInline.test.tsx`
Expected: PASS (all tests in the file, including the new one).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/reservations/ReservationPlayersInline.tsx frontend/__tests__/ReservationPlayersInline.test.tsx
git commit -m "feat(reservations): hideOpenMatchToggle prop on ReservationPlayersInline"
```

---

### Task 2: New component `OpenMatchQuickSwitch`

**Files:**
- Create: `frontend/components/reservations/OpenMatchQuickSwitch.tsx`
- Test: `frontend/__tests__/OpenMatchQuickSwitch.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/__tests__/OpenMatchQuickSwitch.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OpenMatchQuickSwitch } from '../components/reservations/OpenMatchQuickSwitch';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('../lib/api', () => ({
  assetUrl: (p: string | null) => p,
  api: {
    setReservationVisibility: jest.fn().mockResolvedValue({ id: 'r1', visibility: 'PUBLIC', targetLevelMin: null, targetLevelMax: null }),
    getMyRating: jest.fn().mockResolvedValue(null),
  },
}));
import { api } from '../lib/api';
const mocked = api as jest.Mocked<typeof api>;

const resa = (over: Record<string, unknown> = {}) => ({
  id: 'r1', startTime: new Date().toISOString(), endTime: new Date().toISOString(), status: 'CONFIRMED', totalPrice: '25',
  resource: { id: 'res1', name: 'Terrain 1', sport: { key: 'padel', name: 'Padel' }, club: { name: 'Club', slug: 'demo', timezone: 'Europe/Paris' } },
  capacity: 4,
  visibility: 'PRIVATE',
  participants: [
    { id: 'p-org', userId: 'u-org', isOrganizer: true, firstName: 'Org', lastName: 'A', avatarUrl: null },
  ],
  ...over,
}) as never;

const wrap = (over = {}, onChanged = () => {}) =>
  render(<ThemeProvider><OpenMatchQuickSwitch reservation={resa(over)} token="abc" onChanged={onChanged} /></ThemeProvider>);

describe('OpenMatchQuickSwitch', () => {
  beforeEach(() => { jest.clearAllMocks(); localStorage.clear(); });

  it('padel : interrupteur présent, OFF par défaut', async () => {
    wrap();
    const sw = await screen.findByRole('switch', { name: /Partie ouverte aux membres/ });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(/Réservation privée/)).toBeInTheDocument();
  });

  it('non-padel : ne rend rien', () => {
    const { container } = wrap({
      resource: { id: 'res1', name: 'Court', sport: { key: 'tennis', name: 'Tennis' }, club: { name: 'Club', slug: 'demo', timezone: 'Europe/Paris' } },
    });
    expect(container).toBeEmptyDOMElement();
  });

  it('résa déjà publique → interrupteur ON', () => {
    wrap({ visibility: 'PUBLIC' });
    expect(screen.getByRole('switch', { name: /Partie ouverte aux membres/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('bascule ON avec la préférence de niveau mémorisée → PUBLIC + fourchette', async () => {
    localStorage.setItem('palova:open-match-level', JSON.stringify({ enabled: true, min: 4, max: 6 }));
    const onChanged = jest.fn();
    wrap({}, onChanged);
    fireEvent.click(await screen.findByRole('switch', { name: /Partie ouverte aux membres/ }));
    await waitFor(() => expect(mocked.setReservationVisibility).toHaveBeenCalledWith(
      'r1', 'PUBLIC', 'abc', { targetLevelMin: 4, targetLevelMax: 6 },
    ));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('préférence « ouverte à tous » → targetLevel null', async () => {
    localStorage.setItem('palova:open-match-level', JSON.stringify({ enabled: false, min: 3, max: 5 }));
    wrap();
    fireEvent.click(await screen.findByRole('switch', { name: /Partie ouverte aux membres/ }));
    await waitFor(() => expect(mocked.setReservationVisibility).toHaveBeenCalledWith(
      'r1', 'PUBLIC', 'abc', { targetLevelMin: null, targetLevelMax: null },
    ));
  });

  it('bascule OFF → PRIVATE', async () => {
    const onChanged = jest.fn();
    wrap({ visibility: 'PUBLIC' }, onChanged);
    fireEvent.click(screen.getByRole('switch', { name: /Partie ouverte aux membres/ }));
    await waitFor(() => expect(mocked.setReservationVisibility).toHaveBeenCalledWith('r1', 'PRIVATE', 'abc'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('erreur mappée affichée', async () => {
    mocked.setReservationVisibility.mockRejectedValueOnce(new Error('UNAUTHORIZED'));
    wrap();
    fireEvent.click(await screen.findByRole('switch', { name: /Partie ouverte aux membres/ }));
    expect(await screen.findByText(/Seul l'organisateur/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/jest/bin/jest.js __tests__/OpenMatchQuickSwitch.test.tsx`
Expected: FAIL with a module-not-found error
(`Cannot find module '../components/reservations/OpenMatchQuickSwitch'`).

- [ ] **Step 3: Implement the component**

Create `frontend/components/reservations/OpenMatchQuickSwitch.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { api, MyReservation } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { sportHasLevels } from '@/lib/level';
import { loadLevelPref } from '@/lib/levelPrefs';
import { useLevelSystemEnabled } from '@/lib/useLevelSystem';
import { Icon } from '@/components/ui/Icon';

const ERR: Record<string, string> = {
  UNAUTHORIZED: "Seul l'organisateur peut ouvrir cette partie.",
  RESERVATION_NOT_ACTIVE: "Cette réservation n'est pas ouvrable.",
  OPEN_MATCH_PADEL_ONLY: 'Seules les parties de padel peuvent être ouvertes.',
};
const msg = (e: string) => ERR[e] ?? e;

/**
 * Bascule rapide « Partie ouverte aux membres » sur l'écran de succès de réservation :
 * reprend l'UI de l'ancien interrupteur pré-confirmation de BookingModal, mais appelle
 * l'API post-confirmation (setReservationVisibility) puisque la résa est déjà CONFIRMED.
 * Ne mémorise jamais la fourchette de niveau — seul OpenMatchToggle (avec son slider) le fait.
 */
export function OpenMatchQuickSwitch({ reservation, token, onChanged }: {
  reservation: MyReservation;
  token: string;
  onChanged: () => void;
}) {
  const { th } = useTheme();
  const levelEnabled = useLevelSystemEnabled();
  const sportKey = reservation.resource.sport?.key;
  const isPadel = sportKey === 'padel';
  const levelForSport = levelEnabled && sportHasLevels(sportKey);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [levelLimited, setLevelLimited] = useState(true);
  const [levelMin, setLevelMin] = useState(3);
  const [levelMax, setLevelMax] = useState(5);

  const openMatch = reservation.visibility === 'PUBLIC';

  // Préremplissage de la fourchette de niveau : dernier choix mémorisé, sinon défaut centré
  // sur le niveau du joueur ±1 (borné 1–8). Miroir de l'ancien effet de BookingModal.
  useEffect(() => {
    if (!isPadel || !levelForSport) return;
    const clamp = (v: number) => Math.max(1, Math.min(8, Math.round(v * 10) / 10));
    const pref = loadLevelPref();
    if (pref) { setLevelLimited(pref.enabled); setLevelMin(pref.min); setLevelMax(pref.max); return; }
    api.getMyRating(token, sportKey).then((r) => {
      const lvl = r?.level ?? null;
      if (lvl != null) { setLevelMin(clamp(lvl - 1)); setLevelMax(clamp(lvl + 1)); }
    }).catch(() => {});
  }, [isPadel, levelForSport, token, sportKey]);

  if (!isPadel) return null;

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (openMatch) {
        await api.setReservationVisibility(reservation.id, 'PRIVATE', token);
      } else {
        const limiting = levelForSport && levelLimited;
        await api.setReservationVisibility(reservation.id, 'PUBLIC', token, {
          targetLevelMin: limiting ? levelMin : null,
          targetLevelMax: limiting ? levelMax : null,
        });
      }
      onChanged();
    } catch (e) {
      setError(msg((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
        <Icon name="users" size={13} color={th.textMute} />
        <span style={{ fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: th.textMute }}>Votre partie</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600, color: th.text }}>Partie ouverte aux membres</span>
        <button type="button" role="switch" aria-checked={openMatch} aria-label="Partie ouverte aux membres"
          disabled={busy} onClick={toggle}
          style={{ width: 42, height: 24, borderRadius: 999, border: 'none', cursor: busy ? 'not-allowed' : 'pointer', padding: 0, position: 'relative', background: openMatch ? th.accent : th.lineStrong, transition: 'background .15s', flex: '0 0 auto', opacity: busy ? 0.6 : 1 }}>
          <span style={{ position: 'absolute', top: 3, left: openMatch ? 21 : 3, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
        </button>
      </div>
      <div style={{ fontFamily: th.fontUI, fontSize: 11.5, color: th.textFaint, marginTop: 6, lineHeight: 1.4 }}>
        {openMatch
          ? (levelForSport
              ? (levelLimited ? `Niveau ${levelMin}–${levelMax}.` : 'Ouverte à tous les niveaux.')
              : 'Visible et rejoignable par les membres du club.')
          : 'Réservation privée.'}
      </div>
      {error && (
        <div style={{ marginTop: 8, background: th.accent, color: th.onAccent, borderRadius: 10, padding: '8px 12px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600 }}>{error}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_modules/jest/bin/jest.js __tests__/OpenMatchQuickSwitch.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/reservations/OpenMatchQuickSwitch.tsx frontend/__tests__/OpenMatchQuickSwitch.test.tsx
git commit -m "feat(reservations): add OpenMatchQuickSwitch (post-confirmation open-match toggle)"
```

---

### Task 3: Wire `OpenMatchQuickSwitch` into `BookingSuccess`

**Files:**
- Modify: `frontend/components/booking/BookingSuccess.tsx`
- Test: `frontend/__tests__/BookingSuccess.test.tsx`

- [ ] **Step 1: Write the failing test**

In `frontend/__tests__/BookingSuccess.test.tsx`, add `setReservationVisibility` and
`getMyRating` to the `api` mock (needed because `OpenMatchQuickSwitch` will now render inside
`BookingSuccess`). Replace the mock block (currently):

```tsx
jest.mock('../lib/api', () => ({
  api: {
    getMyReservations:        jest.fn().mockResolvedValue([]),
    setReservationVisibility: jest.fn(),
    setReservationTeams:      jest.fn(),
    addReservationPlayer:     jest.fn(),
    removeReservationPlayer:  jest.fn(),
    searchClubMembers:        jest.fn().mockResolvedValue([]),
    listClubFriends:          jest.fn().mockResolvedValue([]),
  },
  assetUrl: (u: string | null) => u,
}));
```

with:

```tsx
jest.mock('../lib/api', () => ({
  api: {
    getMyReservations:        jest.fn().mockResolvedValue([]),
    setReservationVisibility: jest.fn().mockResolvedValue({ id: 'res-1', visibility: 'PUBLIC', targetLevelMin: null, targetLevelMax: null }),
    setReservationTeams:      jest.fn(),
    addReservationPlayer:     jest.fn(),
    removeReservationPlayer:  jest.fn(),
    searchClubMembers:        jest.fn().mockResolvedValue([]),
    listClubFriends:          jest.fn().mockResolvedValue([]),
    getMyRating:              jest.fn().mockResolvedValue(null),
  },
  assetUrl: (u: string | null) => u,
}));
```

Then replace the test `'showPartners → charge la résa et rend le bloc d organisation (équipes
+ ouvrir la partie)'` with two tests:

```tsx
  it('showPartners → charge la résa et rend le bloc d organisation (équipes + interrupteur partie ouverte)', async () => {
    renderSuccess();
    expect(await screen.findByText(/Organisez votre partie/i)).toBeInTheDocument();
    expect(await screen.findByText(/Alice/)).toBeInTheDocument();
    const sw = screen.getByRole('switch', { name: /Partie ouverte aux membres/ });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(api.getMyReservations).toHaveBeenCalledWith('jwt');
  });

  it('bascule l interrupteur « Partie ouverte » → appelle setReservationVisibility PUBLIC', async () => {
    renderSuccess();
    const sw = await screen.findByRole('switch', { name: /Partie ouverte aux membres/ });
    fireEvent.click(sw);
    await waitFor(() => expect(api.setReservationVisibility).toHaveBeenCalledWith(
      'res-1', 'PUBLIC', 'jwt', { targetLevelMin: null, targetLevelMax: null },
    ));
  });
```

This requires `waitFor` in the imports at the top of the file — change:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
```

to:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/jest/bin/jest.js __tests__/BookingSuccess.test.tsx`
Expected: FAIL — the new switch doesn't exist yet in `BookingSuccess`, so
`screen.getByRole('switch', { name: /Partie ouverte aux membres/ })` throws
"Unable to find role switch".

- [ ] **Step 3: Wire the component into `BookingSuccess`**

In `frontend/components/booking/BookingSuccess.tsx`, add the import (next to the existing
`ReservationPlayersInline` import):

```tsx
import { ReservationPlayersInline } from '@/components/reservations/ReservationPlayersInline';
import { OpenMatchQuickSwitch } from '@/components/reservations/OpenMatchQuickSwitch';
```

Then replace the `showPartners` block (currently):

```tsx
      {showPartners && (
        <div style={{ marginTop: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
            <Icon name="users" size={13} color={th.textMute} />
            <span style={{ fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: th.textMute }}>Organisez votre partie</span>
          </div>
          {failed ? (
            <a href="/me/reservations" style={{ fontFamily: th.fontUI, fontSize: 13, color: th.accent, fontWeight: 600 }}>Gérer ma réservation →</a>
          ) : resa ? (
            <ReservationPlayersInline reservation={resa} token={token} now={now} onChanged={reload} />
          ) : (
            <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textFaint }}>Chargement…</div>
          )}
        </div>
      )}
```

with:

```tsx
      {showPartners && (
        <div style={{ marginTop: 18 }}>
          {!failed && resa && (
            <OpenMatchQuickSwitch reservation={resa} token={token} onChanged={reload} />
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
            <Icon name="users" size={13} color={th.textMute} />
            <span style={{ fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: th.textMute }}>Organisez votre partie</span>
          </div>
          {failed ? (
            <a href="/me/reservations" style={{ fontFamily: th.fontUI, fontSize: 13, color: th.accent, fontWeight: 600 }}>Gérer ma réservation →</a>
          ) : resa ? (
            <ReservationPlayersInline reservation={resa} token={token} now={now} onChanged={reload} hideOpenMatchToggle />
          ) : (
            <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textFaint }}>Chargement…</div>
          )}
        </div>
      )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_modules/jest/bin/jest.js __tests__/BookingSuccess.test.tsx`
Expected: PASS (6 tests: the 4 original minus the replaced one, plus the 2 new ones).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/booking/BookingSuccess.tsx frontend/__tests__/BookingSuccess.test.tsx
git commit -m "feat(booking): show OpenMatchQuickSwitch on the booking success screen"
```

---

### Task 4: Remove the pre-confirmation toggle from `BookingModal`

**Files:**
- Modify: `frontend/components/BookingModal.tsx`
- Test: `frontend/__tests__/BookingModal.test.tsx`

- [ ] **Step 1: Update the tests first (they encode the new, reduced behavior)**

In `frontend/__tests__/BookingModal.test.tsx`, remove these 4 tests entirely (they test the
switch/`persistHoldSetup` that's being deleted):

- `'padel multi-joueurs : interrupteur « Partie ouverte aux membres » présent, OFF par défaut'`
- `'non-padel : pas d interrupteur « Partie ouverte »'`
- `'interrupteur OFF → confirmation sans applyHoldSetup'`
- `'interrupteur ON → applyHoldSetup PUBLIC, partnerUserIds vide, niveaux de la préférence'`
- `'interrupteur ON, préférence « ouverte à tous » → targetLevel null'`

(That's the whole block currently at lines 122–167, from
`it('padel multi-joueurs : interrupteur « Partie ouverte aux membres » présent...` through the
end of the `it('interrupteur ON, préférence « ouverte à tous »...` test, inclusive.)

Also update the stale comment in `'payer en ligne affiche la part par personne...'` test — change:

```tsx
    // Regex avec « : » pour cibler « Votre part : 7,50€ » sans capter le titre de section « Votre partie ».
```

to:

```tsx
    // Regex avec « : » pour cibler « Votre part : 7,50€ » précisément.
```

And update the trailing comment block at the end of the file (currently):

```tsx
  // NB : les parties ouvertes sont désormais padel-only (feat/parties-padel-only, sur main).
  // Les tests « partie ouverte sur non-padel » de la branche niveau sont donc devenus
  // sans objet — le bouton « Partie ouverte » n'apparaît plus hors padel (couvert par le
  // test « cache Partie ouverte sur un terrain non-padel » ci-dessus), et le limiteur de
  // niveau sur partie ouverte padel reste testé plus haut. Retirés à la fusion.
});
```

to just:

```tsx
});
```

(The whole comment referred to the tests just removed — it's now dead documentation about a
switch that no longer exists in this file; the equivalent behavior is now tested in
`OpenMatchQuickSwitch.test.tsx` and `BookingSuccess.test.tsx`.)

Also remove the now-unused `(api.applyHoldSetup as jest.Mock).mockResolvedValue(...)` line from
`beforeEach` (still fine to leave the `applyHoldSetup: jest.fn()...` entry in the `jest.mock`
call itself if other tests reference it — check first with step 2 below; if nothing fails,
leave the mock declarations as-is to minimize the diff).

- [ ] **Step 2: Run tests to verify the remaining ones still pass (mechanical removal only)**

Run: `node node_modules/jest/bin/jest.js __tests__/BookingModal.test.tsx`
Expected: PASS (10 tests remaining) — this step only deleted tests and fixed comments, so
nothing should be red yet. This confirms the deletions didn't break anything by accident.

- [ ] **Step 3: Remove the switch and its plumbing from `BookingModal.tsx`**

Remove these imports (no longer used anywhere in the file after this task):

```tsx
import { loadLevelPref } from '@/lib/levelPrefs';
import { useLevelSystemEnabled } from '@/lib/useLevelSystem';
import { sportHasLevels } from '@/lib/level';
```

Remove these two lines from the top of the component body:

```tsx
  const levelEnabled = useLevelSystemEnabled();
  // Le système de niveau (grille Padel Magazine) ne vaut que pour le padel.
  const levelForSport = levelEnabled && sportHasLevels(sportKey);
```

Remove the state block (currently):

```tsx
  // Interrupteur « Partie ouverte » : seule décision d'organisation restée dans la modale.
  const [openMatch, setOpenMatch] = useState(false);
  // Fourchette de niveau d'une partie ouverte : interrupteur + bornes, mémorisés (pré-remplis).
  // Limite ACTIVE par défaut (sauf si un choix mémorisé dit le contraire).
  const [levelLimited, setLevelLimited] = useState(true);
  const [levelMin, setLevelMin] = useState(3);
  const [levelMax, setLevelMax] = useState(5);
```

Replace the comment + `isPadel` line (currently):

```tsx
  // Multi-joueurs : l'interrupteur « Partie ouverte » n'apparaît que sur un court padel multi-joueurs.
  const cap = maxPlayers ?? 1;
  const showPartners = !!slug && cap > 1;
  // Parties ouvertes = padel uniquement → l'option « Partie ouverte » n'est offerte que sur un court padel.
  const isPadel = sportKey === 'padel';
```

with:

```tsx
  // Multi-joueurs : bloc « Organisez votre partie » (joueurs + ouverture aux membres, cette
  // dernière restreinte au padel) affiché sur l'écran de succès dès qu'un court a plusieurs
  // places et un club connu.
  const cap = maxPlayers ?? 1;
  const showPartners = !!slug && cap > 1;
```

Remove the level-preference-loading effect (currently, right after the hold-on-mount effect):

```tsx
  // Pré-remplissage de la fourchette de niveau : dernier choix mémorisé, sinon
  // défaut centré sur mon niveau ±1 (borné 1–8), interrupteur OFF (ouvert à tous).
  useEffect(() => {
    if (!showPartners || !levelForSport) return;
    const clamp = (v: number) => Math.max(1, Math.min(8, Math.round(v * 10) / 10));
    const pref = loadLevelPref();
    if (pref) { setLevelLimited(pref.enabled); setLevelMin(pref.min); setLevelMax(pref.max); }
    if (!token) return;
    if (pref) return; // choix mémorisé prioritaire : pas besoin du niveau pour le défaut
    api.getMyRating(token, sportKey).then((r) => {
      const lvl = r?.level ?? null;
      if (lvl != null) { setLevelMin(clamp(lvl - 1)); setLevelMax(clamp(lvl + 1)); }
    }).catch(() => {});
  }, [showPartners, token, levelForSport]); // eslint-disable-line react-hooks/exhaustive-deps
```

Remove the `persistHoldSetup` function entirely (currently):

```tsx
  // Publie la visibilité « partie ouverte » sur la résa PENDING avant confirmation (directe
  // OU Stripe via beforeSubmit) — les joueurs, eux, s'ajoutent après coup (écran de succès).
  // Interrupteur OFF → aucun appel : une réservation naît PRIVATE.
  const persistHoldSetup = async () => {
    if (!showPartners || !isPadel || !openMatch || !reservation) return;
    const limiting = levelForSport && levelLimited;
    await api.applyHoldSetup(reservation.id, token, {
      partnerUserIds: [],
      visibility: 'PUBLIC',
      targetLevelMin: limiting ? levelMin : null,
      targetLevelMax: limiting ? levelMax : null,
    });
  };
```

In `handleConfirm`, remove the call to it (currently the first line of the `try` block):

```tsx
    try {
      await persistHoldSetup();
      // Source de paiement : abonnement couvrant prioritaire, sinon carnet, sinon rien (régler au club).
```

becomes:

```tsx
    try {
      // Source de paiement : abonnement couvrant prioritaire, sinon carnet, sinon rien (régler au club).
```

Remove the whole "Partie ouverte" JSX block (currently, right after the `BookingHeaderCard` and
inside `{phase === 'held' && (<>`):

```tsx
              {/* Partie ouverte — seule décision d'organisation dans la modale (padel multi-joueurs).
                  Partenaires/équipes/niveau s'organisent sur l'écran de succès, sans timer. */}
              {showPartners && isPadel && (
                <div style={{ marginTop: 20 }}>
                  {sectionLabel('users', 'Votre partie')}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <span style={{ fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600, color: th.text }}>Partie ouverte aux membres</span>
                    <button type="button" role="switch" aria-checked={openMatch} aria-label="Partie ouverte aux membres"
                      onClick={() => setOpenMatch((v) => !v)}
                      style={{ width: 42, height: 24, borderRadius: 999, border: 'none', cursor: 'pointer', padding: 0, position: 'relative', background: openMatch ? th.accent : th.lineStrong, transition: 'background .15s', flex: '0 0 auto' }}>
                      <span style={{ position: 'absolute', top: 3, left: openMatch ? 21 : 3, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
                    </button>
                  </div>
                  <div style={{ fontFamily: th.fontUI, fontSize: 11.5, color: th.textFaint, marginTop: 6, lineHeight: 1.4 }}>
                    {openMatch
                      ? (levelForSport
                          ? (levelLimited
                              ? `Niveau ${levelMin}–${levelMax} · réglable après confirmation.`
                              : 'Ouverte à tous les niveaux · réglable après confirmation.')
                          : 'Visible et rejoignable par les membres du club.')
                      : 'Vos partenaires s’ajoutent après la confirmation.'}
                  </div>
                </div>
              )}

              {/* Quota : affiché seulement s'il mord (≤ 1 résa possible pour la classe du créneau). */}
```

Delete that whole block (from the `{/* Partie ouverte ... */}` comment through the closing
`)}` and the blank line right before `{/* Quota ...`), keeping the `{/* Quota ... */}` comment
and everything after it exactly as it was.

Finally, remove the `beforeSubmit={persistHoldSetup}` line from the `StripePaymentStep` call
(currently):

```tsx
                      <StripePaymentStep
                        // Remonte (donc recrée l'intent) si le type OU le montant part/total change,
                        // même après affichage du formulaire — l'intent est figé à sa création.
                        key={(payMode === 'online' && onlineAvailable) ? (onlineShare ? 'pay-share' : 'pay-full') : 'setup'}
                        type={(payMode === 'online' && onlineAvailable) ? 'payment' : 'setup'}
                        amountLabel={(payMode === 'online' && onlineAvailable) ? onlineAmountLabel : `${totalPrice}€`}
                        cgvAccepted={cgvAccepted} beforeSubmit={persistHoldSetup}
                        createIntent={async () => {
```

becomes:

```tsx
                      <StripePaymentStep
                        // Remonte (donc recrée l'intent) si le type OU le montant part/total change,
                        // même après affichage du formulaire — l'intent est figé à sa création.
                        key={(payMode === 'online' && onlineAvailable) ? (onlineShare ? 'pay-share' : 'pay-full') : 'setup'}
                        type={(payMode === 'online' && onlineAvailable) ? 'payment' : 'setup'}
                        amountLabel={(payMode === 'online' && onlineAvailable) ? onlineAmountLabel : `${totalPrice}€`}
                        cgvAccepted={cgvAccepted}
                        createIntent={async () => {
```

- [ ] **Step 4: Run tests and the type-checker to verify everything passes**

Run: `node node_modules/jest/bin/jest.js __tests__/BookingModal.test.tsx`
Expected: PASS (10 tests).

Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`
Expected: no output (no type errors — this catches any leftover reference to a removed
variable like `isPadel`, `openMatch`, `levelForSport`, etc.).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/BookingModal.tsx frontend/__tests__/BookingModal.test.tsx
git commit -m "refactor(booking): remove pre-confirmation open-match toggle from BookingModal"
```

---

## Final check

Run the full frontend suite once more to confirm nothing else broke (per project memory, a
handful of pre-existing `BookingModal` flakes can appear only under the *full* suite due to
test-isolation issues unrelated to this change — see `frontend-full-suite-bookingmodal-flake`
memory; if only those specific pre-existing flakes show up, that's expected and not a
regression from this plan):

```bash
node node_modules/jest/bin/jest.js __tests__/BookingModal.test.tsx __tests__/BookingSuccess.test.tsx __tests__/ReservationPlayersInline.test.tsx __tests__/OpenMatchToggle.test.tsx __tests__/OpenMatchQuickSwitch.test.tsx
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
```

Expected: all listed suites green, no type errors.
