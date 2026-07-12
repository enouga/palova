# Planning — pastilles-initiales de paiement + panneau au survol — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the anonymous `PaymentDots` on `/admin/planning` block tiles with per-player initials pastilles (who's paid, who owes) plus a detailed hover panel — 100% frontend, no migration, no backend change.

**Architecture:** A new pure helper `participantPastilles` in `frontend/lib/caisse.ts` derives a per-seat payment model by reusing the existing `deriveSlots` helper (same seat-derivation logic already used by the cash register). Two new presentational components render it: `PaymentInitials` (the pastilles row, small or full) and `TilePaymentPopover` (the hover detail panel, positioned with a second pure helper `popoverPosition`). `app/admin/planning/page.tsx` swaps `paymentDots`/`PaymentDots` for these on the grid tiles only — `PaymentDots`/`paymentDots`/`SETTLED_COLOR` stay untouched because `CashRegister`, `QueueList`, and `/admin/reservations` still use them.

**Tech Stack:** Next.js 16 (React 19, client component), TypeScript, Jest + React Testing Library.

**Context — parallel WIP:** `frontend/app/admin/planning/page.tsx` and `frontend/__tests__/AdminPlanning.test.tsx` currently have small uncommitted changes from unrelated work (removing a "Montant libre" advanced-options link from the cash register modal, around line 869-875 and in the test file). This plan's edits target a different part of the file (the grid tile rendering, ~line 719-762, and the hover/state declarations near the top) and were written against the file's *current* (already-modified) content, so they don't conflict. Read the file fresh before editing if time has passed and more WIP may have landed.

---

### Task 1: `participantPastilles` + `popoverPosition` helpers in `lib/caisse.ts`

**Files:**
- Modify: `frontend/lib/caisse.ts` (insert after `deriveSlots`, before the `// ── Encaissement optimiste ──` comment, i.e. after the line `}` that closes `deriveSlots` around line 236)
- Test: `frontend/__tests__/caisse.test.ts`

- [ ] **Step 1: Write the failing tests**

Edit `frontend/__tests__/caisse.test.ts`. First update the import line at the top:

Old:
```ts
import { toCents, remainingCents, centsToInput, centsToStr, fmtEuros, tariffCents, dueCents, quickAmounts, paymentDots, validatePaymentAmount, deriveSlots, applyOptimisticPayment, applyOptimisticRefund, isOptimisticId, hhmm, isSalePayment, trendSeries } from '@/lib/caisse';
```

New:
```ts
import { toCents, remainingCents, centsToInput, centsToStr, fmtEuros, tariffCents, dueCents, quickAmounts, paymentDots, participantPastilles, popoverPosition, validatePaymentAmount, deriveSlots, applyOptimisticPayment, applyOptimisticRefund, isOptimisticId, hhmm, isSalePayment, trendSeries } from '@/lib/caisse';
```

Then insert two new `describe` blocks between the end of the existing `describe('paymentDots', ...)` block and the start of `describe('playerCount', ...)`:

Old:
```ts
  it('non applicable : type ≠ COURT ou dû ≤ 0 → null', () => {
    expect(paymentDots(resa({ type: 'TOURNAMENT', payments: 1 }), 4, 5200)).toBeNull();
    expect(paymentDots(resa({ totalPrice: '0.00' }), 4, 0)).toBeNull();
  });
});

describe('playerCount', () => {
```

New:
```ts
  it('non applicable : type ≠ COURT ou dû ≤ 0 → null', () => {
    expect(paymentDots(resa({ type: 'TOURNAMENT', payments: 1 }), 4, 5200)).toBeNull();
    expect(paymentDots(resa({ totalPrice: '0.00' }), 4, 0)).toBeNull();
  });
});

describe('participantPastilles', () => {
  const withParticipants = (paidAmount: string, parts: { id: string; isOrganizer: boolean; firstName: string; lastName: string; paid: string; outstanding: string }[]) => ({
    id: 'r1', type: 'COURT' as ReservationType, paidAmount,
    user: { firstName: 'Jean', lastName: 'Test' },
    participants: parts.map((p) => ({ ...p, share: '13.00' })),
  });

  it('2 participants, rien payé → 2 pastilles dues (pas soldé)', () => {
    const rv = withParticipants('0.00', [
      { id: 'p1', isOrganizer: true, firstName: 'Jean', lastName: 'Test', paid: '0.00', outstanding: '13.00' },
      { id: 'p2', isOrganizer: false, firstName: 'Léa', lastName: 'Roy', paid: '0.00', outstanding: '13.00' },
    ]);
    const m = participantPastilles(rv, 2, 2600)!;
    expect(m.settled).toBe(false);
    expect(m.seats).toHaveLength(2);
    expect(m.seats[0]).toMatchObject({ initials: 'JT', name: 'Jean Test', paid: false, outstandingCents: 1300 });
    expect(m.seats[1]).toMatchObject({ initials: 'LR', name: 'Léa Roy', paid: false, outstandingCents: 1300 });
  });

  it('la part réglée d’un joueur est verte même si la résa entière ne l’est pas', () => {
    const rv = withParticipants('13.00', [
      { id: 'p1', isOrganizer: true, firstName: 'Jean', lastName: 'Test', paid: '13.00', outstanding: '0.00' },
      { id: 'p2', isOrganizer: false, firstName: 'Léa', lastName: 'Roy', paid: '0.00', outstanding: '13.00' },
    ]);
    const m = participantPastilles(rv, 2, 2600)!;
    expect(m.settled).toBe(false);
    expect(m.seats[0]!.paid).toBe(true);
    expect(m.seats[1]!.paid).toBe(false);
  });

  it('résa soldée au global → toutes les places occupées passent vertes, même sans détail par joueur', () => {
    const rv = withParticipants('52.00', [
      { id: 'p1', isOrganizer: true, firstName: 'Jean', lastName: 'Test', paid: '0.00', outstanding: '13.00' },
      { id: 'p2', isOrganizer: false, firstName: 'Léa', lastName: 'Roy', paid: '0.00', outstanding: '13.00' },
    ]);
    const m = participantPastilles(rv, 4, 5200)!;   // double : 2 places vides en plus
    expect(m.settled).toBe(true);
    expect(m.seats[0]!.paid).toBe(true);
    expect(m.seats[1]!.paid).toBe(true);
    expect(m.seats[2]).toBeNull();
    expect(m.seats[3]).toBeNull();
  });

  it("sans détail par joueur (résa créée en admin) → 1 pastille titulaire (holder) + places vides", () => {
    const rv = { id: 'r1', type: 'COURT' as ReservationType, paidAmount: '0.00', user: { firstName: 'Jean', lastName: 'Dupont' }, participants: [] };
    const m = participantPastilles(rv, 4, 5200)!;
    expect(m.seats[0]).toMatchObject({ initials: 'JD', name: 'Jean Dupont', paid: false, outstandingCents: 5200 });
    expect(m.seats.slice(1)).toEqual([null, null, null]);
  });

  it('holder payé intégralement → pastille verte, résa soldée', () => {
    const rv = { id: 'r1', type: 'COURT' as ReservationType, paidAmount: '52.00', user: { firstName: 'Jean', lastName: 'Dupont' }, participants: [] };
    const m = participantPastilles(rv, 4, 5200)!;
    expect(m.settled).toBe(true);
    expect(m.seats[0]).toMatchObject({ paid: true, outstandingCents: 0 });
  });

  it('non applicable : type ≠ COURT ou dû ≤ 0 → null', () => {
    expect(participantPastilles({ id: 'r1', type: 'TOURNAMENT' as ReservationType, paidAmount: '0.00', user: null, participants: [] }, 4, 5200)).toBeNull();
    expect(participantPastilles({ id: 'r1', type: 'COURT' as ReservationType, paidAmount: '0.00', user: null, participants: [] }, 4, 0)).toBeNull();
  });
});

describe('popoverPosition', () => {
  it('place le panneau à droite du bloc quand il y a la place', () => {
    expect(popoverPosition({ left: 100, right: 220, top: 50 }, 1280)).toEqual({ left: 228, top: 50 });
  });

  it('bascule à gauche quand le panneau déborderait à droite du viewport', () => {
    expect(popoverPosition({ left: 700, right: 790, top: 50 }, 800)).toEqual({ left: 462, top: 50 });
  });
});

describe('playerCount', () => {
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `frontend/`):
```bash
node node_modules/jest/bin/jest.js caisse.test.ts
```
Expected: FAIL — `participantPastilles`/`popoverPosition` are not exported from `@/lib/caisse` (TypeScript/module error, or `undefined is not a function`).

- [ ] **Step 3: Implement the helpers**

Edit `frontend/lib/caisse.ts`. Insert after the `deriveSlots` function (its closing `}`) and before the `// ── Encaissement optimiste ──` section comment:

Old:
```ts
  let emptyIdx = 0;
  while (slots.length < capacity) slots.push({ kind: 'empty', index: emptyIdx++ });
  return slots;
}

// ── Encaissement optimiste ─────────────────────────────────────────────────
```

New:
```ts
  let emptyIdx = 0;
  while (slots.length < capacity) slots.push({ kind: 'empty', index: emptyIdx++ });
  return slots;
}

// ── Pastilles-initiales de paiement (planning) ────────────────────────────

export interface PastilleSeat {
  seed: string;
  initials: string;
  name: string;
  paid: boolean;
  paidCents: number;
  outstandingCents: number;
}

export interface PastillesModel {
  /** Une entrée par place (capacité du terrain) ; `null` = place vide. */
  seats: (PastilleSeat | null)[];
  settled: boolean;
  totalPaidCents: number;
  totalDueCents: number;
}

/**
 * Modèle des pastilles-initiales de paiement d'un bloc du planning : une
 * pastille par place (réutilise `deriveSlots`, même logique que la caisse),
 * verte + initiales quand la part du joueur est réglée (ou que la résa est
 * soldée au global, même sans détail par joueur), place vide = pointillés.
 * `null` si non applicable (pas un créneau COURT payant) — miroir de `paymentDots`.
 */
export function participantPastilles(
  rv: {
    id: string;
    type: ReservationType;
    paidAmount: string;
    user: { firstName: string; lastName: string } | null;
    participants: { id: string; isOrganizer: boolean; firstName: string; lastName: string; paid: string; share: string; outstanding: string }[];
  },
  players: number,
  due: number,
): PastillesModel | null {
  if (rv.type !== 'COURT' || due <= 0) return null;
  const totalPaidCents = toCents(rv.paidAmount);
  const settled = totalPaidCents >= due;
  const slots = deriveSlots(rv, players);
  const seats: (PastilleSeat | null)[] = slots.slice(0, players).map((s) => {
    if (s.kind === 'empty') return null;
    const paidCents = s.kind === 'participant' ? s.paidCents : totalPaidCents;
    const outstandingCents = s.kind === 'participant' ? s.outstandingCents : Math.max(0, due - totalPaidCents);
    return {
      seed: s.seed,
      initials: `${s.firstName[0] ?? ''}${s.lastName[0] ?? ''}`.toUpperCase(),
      name: `${s.firstName} ${s.lastName}`.trim(),
      paid: settled || outstandingCents <= 0,
      paidCents,
      outstandingCents,
    };
  });
  return { seats, settled, totalPaidCents, totalDueCents: due };
}

export interface PopoverAnchor { left: number; right: number; top: number }

/**
 * Position (fixed) du panneau de détail au survol d'une vignette : à droite du
 * bloc par défaut, bascule à gauche si le panneau déborderait du viewport.
 */
export function popoverPosition(anchor: PopoverAnchor, viewportWidth: number, panelWidth = 230, gap = 8): { left: number; top: number } {
  const flip = anchor.right + gap + panelWidth > viewportWidth;
  return { left: flip ? anchor.left - gap - panelWidth : anchor.right + gap, top: anchor.top };
}

// ── Encaissement optimiste ─────────────────────────────────────────────────
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
node node_modules/jest/bin/jest.js caisse.test.ts
```
Expected: PASS, all suites including the two new ones.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/caisse.ts frontend/__tests__/caisse.test.ts
git commit -m "feat(planning): pastilles-initiales de paiement (helper pur participantPastilles)"
```

---

### Task 2: `PaymentInitials` component

**Files:**
- Create: `frontend/components/admin/PaymentInitials.tsx`

- [ ] **Step 1: Write the component**

```tsx
'use client';
import { useTheme } from '@/lib/ThemeProvider';
import type { PastillesModel } from '@/lib/caisse';
import { SETTLED_COLOR } from './PaymentDots';

/**
 * Pastilles-initiales de paiement d'un bloc du planning : verte + initiales
 * quand la place est réglée, contour clair sinon, pointillés si la place est
 * vide. `compact` (petits créneaux) plafonne l'aperçu aux 2 premières places.
 */
export function PaymentInitials({ model, compact }: { model: PastillesModel; compact?: boolean }) {
  const { th } = useTheme();
  const seats = compact ? model.seats.slice(0, 2) : model.seats;
  const size = compact ? 12 : 15;
  const fontSize = compact ? 6.5 : 7.5;
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 3, height: size }}>
      {seats.map((seat, i) => seat ? (
        <span key={i} style={{
          width: size, height: size, borderRadius: '50%', boxSizing: 'border-box',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: th.fontUI, fontWeight: 800, fontSize, lineHeight: 1,
          background: seat.paid ? SETTLED_COLOR : th.surface,
          color: seat.paid ? '#fff' : th.textMute,
          border: seat.paid ? 'none' : `1px solid ${th.line}`,
        }}>{seat.initials}</span>
      ) : (
        <span key={i} style={{ width: size, height: size, borderRadius: '50%', boxSizing: 'border-box', border: `1px dashed ${th.textFaint}` }} />
      ))}
      {!compact && model.settled && <span style={{ fontSize: 9, fontWeight: 700, color: SETTLED_COLOR, lineHeight: 1 }}>✓</span>}
    </span>
  );
}
```

- [ ] **Step 2: Typecheck**

Run (from `frontend/`):
```bash
node node_modules/typescript/bin/tsc --noEmit
```
Expected: no new errors referencing `PaymentInitials.tsx` (the file isn't wired into any page yet, so this mainly catches syntax/type mistakes in isolation — full wiring is verified in Task 4).

- [ ] **Step 3: Commit**

```bash
git add frontend/components/admin/PaymentInitials.tsx
git commit -m "feat(planning): composant PaymentInitials (pastilles-initiales)"
```

---

### Task 3: `TilePaymentPopover` component

**Files:**
- Create: `frontend/components/admin/planning/TilePaymentPopover.tsx`

- [ ] **Step 1: Write the component**

```tsx
'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { fmtEuros, popoverPosition } from '@/lib/caisse';
import type { PastillesModel, PopoverAnchor } from '@/lib/caisse';
import { SETTLED_COLOR } from '@/components/admin/PaymentDots';

const PANEL_W = 230;

/** Panneau détaillé (qui a payé, combien) affiché au survol prolongé d'un bloc du planning. */
export function TilePaymentPopover({ model, anchor }: { model: PastillesModel; anchor: PopoverAnchor }) {
  const { th } = useTheme();
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const { left, top } = popoverPosition(anchor, viewportWidth, PANEL_W);
  const remaining = model.totalDueCents - model.totalPaidCents;
  return (
    <div role="tooltip" style={{
      position: 'fixed', left, top, zIndex: 45, width: PANEL_W, boxSizing: 'border-box',
      background: th.surface, borderRadius: 10, boxShadow: th.shadow, border: `1px solid ${th.line}`,
      padding: '9px 12px', fontFamily: th.fontUI, fontSize: 12, pointerEvents: 'none',
    }}>
      {model.seats.map((seat, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '2px 0' }}>
          {seat ? (
            <>
              <span style={{ color: seat.paid ? th.text : '#c0392b' }}>{seat.paid ? '✓' : '○'} {seat.name}</span>
              <span style={{ fontFamily: th.fontMono, fontSize: 11, color: seat.paid ? th.textMute : '#c0392b' }}>
                {seat.paid ? fmtEuros(seat.paidCents) : `reste ${fmtEuros(seat.outstandingCents)}`}
              </span>
            </>
          ) : (
            <span style={{ color: th.textFaint }}>○ place libre</span>
          )}
        </div>
      ))}
      <div style={{ marginTop: 5, paddingTop: 5, borderTop: `1px solid ${th.line}`, fontWeight: 700 }}>
        {model.settled
          ? <span style={{ color: SETTLED_COLOR }}>✓ Soldé</span>
          : <span>Payé {fmtEuros(model.totalPaidCents)} / {fmtEuros(model.totalDueCents)} · <span style={{ color: '#c0392b' }}>reste {fmtEuros(remaining)}</span></span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run (from `frontend/`):
```bash
node node_modules/typescript/bin/tsc --noEmit
```
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/admin/planning/TilePaymentPopover.tsx
git commit -m "feat(planning): composant TilePaymentPopover (panneau au survol)"
```

---

### Task 4: Wire into `/admin/planning` + tests

**Files:**
- Modify: `frontend/app/admin/planning/page.tsx`
- Modify: `frontend/__tests__/AdminPlanning.test.tsx`

- [ ] **Step 1: Write the failing tests**

Edit `frontend/__tests__/AdminPlanning.test.tsx`. First add `act` to the RTL import at the top:

Old:
```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
```

New:
```tsx
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
```

Then insert new tests right after the existing test `"permet de sélectionner une place SANS joueur et d'encaisser sa part (anonyme)"` and before `it('option club « paiement au club »...'`:

Old:
```tsx
it("permet de sélectionner une place SANS joueur et d'encaisser sa part (anonyme)", async () => {
  (api.adminGetResources as jest.Mock).mockResolvedValue([doubleCourt()]);
  (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([oneNamedResa()]));
  renderPage();
  await openModal();
  await screen.findByRole('button', { name: 'CB' });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Joueur 2' }));   // ajoute la 1re place vide à la sélection
  fireEvent.click(screen.getByRole('button', { name: 'CB' }));
  await waitFor(() => {
    const call = (api.adminAddPayment as jest.Mock).mock.calls.at(-1)!;
    expect(call[2]).toMatchObject({ amount: 13, method: 'CARD' });   // une part (52/4), anonyme
    expect(call[2].participantId).toBeUndefined();
  });
});

it('option club « paiement au club » : un seul bouton « Encaissé » (moyen CLUB), pas de choix de moyen', async () => {
```

New:
```tsx
it("permet de sélectionner une place SANS joueur et d'encaisser sa part (anonyme)", async () => {
  (api.adminGetResources as jest.Mock).mockResolvedValue([doubleCourt()]);
  (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([oneNamedResa()]));
  renderPage();
  await openModal();
  await screen.findByRole('button', { name: 'CB' });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Joueur 2' }));   // ajoute la 1re place vide à la sélection
  fireEvent.click(screen.getByRole('button', { name: 'CB' }));
  await waitFor(() => {
    const call = (api.adminAddPayment as jest.Mock).mock.calls.at(-1)!;
    expect(call[2]).toMatchObject({ amount: 13, method: 'CARD' });   // une part (52/4), anonyme
    expect(call[2].participantId).toBeUndefined();
  });
});

describe('pastilles-initiales de paiement + panneau au survol', () => {
  it('les vignettes affichent des pastilles-initiales (qui a payé) au lieu de points anonymes', async () => {
    (api.adminGetResources as jest.Mock).mockResolvedValue([singleCourt()]);
    (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([twoPlayerResa()]));
    renderPage();
    await screen.findByText('Jean Test');
    expect(screen.getByText('JT')).toBeInTheDocument();
    expect(screen.getByText('LR')).toBeInTheDocument();
  });

  it('le title du bloc ne détaille plus payé/dû (remplacé par le survol)', async () => {
    (api.adminGetResources as jest.Mock).mockResolvedValue([singleCourt()]);
    (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([twoPlayerResa()]));
    renderPage();
    const block = (await screen.findByText('Jean Test')).closest('button') as HTMLElement;
    expect(block.title).not.toMatch(/payé/);
    expect(block.title).toMatch(/Jean Test · Terrain/);
  });

  it('un survol prolongé (~400ms) ouvre un panneau détaillant qui a payé et le reste dû', async () => {
    jest.useFakeTimers();
    // Double (52 €, 4 places) : pt-1 (Jean Test) réglé, pt-2 (Léa Roy) doit encore, 2 places
    // vides — le "reste" du total (39 €) diffère de celui de Léa Roy (13 €) : pas d'ambiguïté
    // de texte entre la ligne joueur et la ligne de total.
    (api.adminGetResources as jest.Mock).mockResolvedValue([doubleCourt()]);
    (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([twoPlayerResa({
      totalPrice: '52.00', dueAmount: '52.00', paidAmount: '13.00',
      participants: [
        { id: 'pt-1', userId: 'u1', isOrganizer: true, firstName: 'Jean', lastName: 'Test', share: '13.00', paid: '13.00', outstanding: '0.00' },
        { id: 'pt-2', userId: 'u2', isOrganizer: false, firstName: 'Léa', lastName: 'Roy', share: '13.00', paid: '0.00', outstanding: '13.00' },
      ],
    })]));
    renderPage();
    const block = (await screen.findByText('Jean Test')).closest('button') as HTMLElement;
    fireEvent.mouseEnter(block);
    expect(screen.queryByText(/Léa Roy/)).toBeNull();          // pas immédiat
    act(() => { jest.advanceTimersByTime(400); });
    expect(screen.getByText(/Léa Roy/)).toBeInTheDocument();
    expect(screen.getByText(/reste 13/)).toBeInTheDocument();
    jest.useRealTimers();
  });

  it('le panneau ne s’ouvre pas si la souris quitte le bloc avant le délai', async () => {
    jest.useFakeTimers();
    (api.adminGetResources as jest.Mock).mockResolvedValue([singleCourt()]);
    (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([twoPlayerResa()]));
    renderPage();
    const block = (await screen.findByText('Jean Test')).closest('button') as HTMLElement;
    fireEvent.mouseEnter(block);
    fireEvent.mouseLeave(block);
    act(() => { jest.advanceTimersByTime(400); });
    expect(screen.queryByText(/Léa Roy/)).toBeNull();
    jest.useRealTimers();
  });

  it('un mousedown (début de drag) annule un survol en cours', async () => {
    jest.useFakeTimers();
    (api.adminGetResources as jest.Mock).mockResolvedValue([singleCourt()]);
    (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([twoPlayerResa()]));
    renderPage();
    const block = (await screen.findByText('Jean Test')).closest('button') as HTMLElement;
    fireEvent.mouseEnter(block);
    fireEvent.mouseDown(block, { clientY: 300 });
    act(() => { jest.advanceTimersByTime(400); });
    expect(screen.queryByText(/Léa Roy/)).toBeNull();
    fireEvent.mouseUp(window);
    jest.useRealTimers();
  });
});

it('option club « paiement au club » : un seul bouton « Encaissé » (moyen CLUB), pas de choix de moyen', async () => {
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `frontend/`):
```bash
node node_modules/jest/bin/jest.js AdminPlanning.test.tsx
```
Expected: FAIL on the 5 new tests — pastilles/popover don't exist yet on the page (still rendering the old `PaymentDots`/points, no hover handlers).

- [ ] **Step 3: Wire the page — imports**

Edit `frontend/app/admin/planning/page.tsx`.

Old:
```tsx
import { toCents, dueCents, fmtEuros, paymentDots, DEFAULT_QUICK_METHODS, QUICK_METHODS, applyOptimisticPayment, applyOptimisticRefund, PaymentIntent } from '@/lib/caisse';
```

New:
```tsx
import { toCents, dueCents, fmtEuros, participantPastilles, PastillesModel, PopoverAnchor, DEFAULT_QUICK_METHODS, QUICK_METHODS, applyOptimisticPayment, applyOptimisticRefund, PaymentIntent } from '@/lib/caisse';
```

Old:
```tsx
import { PaymentDots, SETTLED_COLOR } from '@/components/admin/PaymentDots';
```

New:
```tsx
import { SETTLED_COLOR } from '@/components/admin/PaymentDots';
import { PaymentInitials } from '@/components/admin/PaymentInitials';
import { TilePaymentPopover } from '@/components/admin/planning/TilePaymentPopover';
```

- [ ] **Step 4: Wire the page — hover state**

Old:
```tsx
  const [toast, setToast] = useState<RescheduleToast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
```

New:
```tsx
  const [toast, setToast] = useState<RescheduleToast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  // Panneau de paiement au survol (~400 ms) d'un bloc COURT payant : nom + montants par joueur.
  const [hover, setHover] = useState<{ id: string; anchor: PopoverAnchor; model: PastillesModel } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }, []);
  const clearHoverTimer = () => { if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; } };
  const scheduleHover = (rv: ClubReservation, model: PastillesModel, el: HTMLElement) => {
    clearHoverTimer();
    hoverTimer.current = setTimeout(() => {
      const r = el.getBoundingClientRect();
      setHover({ id: rv.id, model, anchor: { left: r.left, right: r.right, top: r.top } });
    }, 400);
  };
  const cancelHover = (id: string) => {
    clearHoverTimer();
    setHover((cur) => (cur?.id === id ? null : cur));
  };
```

- [ ] **Step 5: Wire the page — cancel hover when a drag starts**

Old:
```tsx
  const startBlockDrag = (evt: ReactMouseEvent, rv: ClubReservation, kind: 'move' | 'resize', startMin: number, endMin: number) => {
    if (rv.status === 'CANCELLED' || busy) return;
    evt.preventDefault();
    draggedRef.current = false;
```

New:
```tsx
  const startBlockDrag = (evt: ReactMouseEvent, rv: ClubReservation, kind: 'move' | 'resize', startMin: number, endMin: number) => {
    if (rv.status === 'CANCELLED' || busy) return;
    cancelHover(rv.id);
    evt.preventDefault();
    draggedRef.current = false;
```

- [ ] **Step 6: Wire the page — compute pastilles instead of dots**

Old:
```tsx
                  const due = dueOf(rv);
                  const dots = paymentDots(rv, playersOf(rv), due);
                  return (
```

New:
```tsx
                  const due = dueOf(rv);
                  const dots = participantPastilles(rv, playersOf(rv), due);
                  return (
```

- [ ] **Step 7: Wire the page — block JSX (hover handlers, title, pastilles rendering)**

Old:
```tsx
                    <button key={rv.id} type="button"
                      onMouseDown={(evt) => startBlockDrag(evt, rv, 'move', s, e)}
                      onClick={() => { if (draggedRef.current) { draggedRef.current = false; return; } openRes(rv); }}
                      title={`${labelOf(rv)} · ${TYPE_META[rv.type].label} · ${fmtHM(rv.startTime, tz)}–${fmtHM(rv.endTime, tz)}${dots ? ` · payé ${fmtEuros(toCents(rv.paidAmount))} / ${fmtEuros(due)}` : ''}`}
                      style={{
                        position: 'absolute', top: top + 2, left: 3, right: 3, height, boxSizing: 'border-box',
                        borderRadius: 9, padding: small ? '3px 8px' : '5px 8px', overflow: 'hidden', zIndex: 2, textAlign: 'left',
                        cursor: cancelled ? 'pointer' : 'grab',
                        background: tint(c), boxShadow: `inset 3px 0 0 ${c}`,
                        border: pend ? `1px dashed ${c}` : '1px solid transparent', opacity: dragging ? 0.3 : (pend ? 0.85 : 1),
                        display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', gap: 2,
                      }}>
                      <span style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, color: th.text, lineHeight: 1.15, display: '-webkit-box', WebkitLineClamp: small ? 1 : 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', wordBreak: 'break-word' }}>{labelOf(rv)}</span>
                      {!small && <span style={{ fontFamily: th.fontMono, fontSize: 10, color: th.textMute, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pend ? 'attente · ' : ''}{fmtHM(rv.startTime, tz)}–{fmtHM(rv.endTime, tz)}</span>}
                      {dots && !small && <span style={{ marginTop: 'auto', display: 'flex' }}><PaymentDots dots={dots} color={c} /></span>}
                      {dots && small && (dots.settled
                        ? <span style={{ position: 'absolute', right: 5, bottom: 3, fontSize: 9, fontWeight: 700, color: SETTLED_COLOR, lineHeight: 1 }}>✓</span>
                        : dots.filled > 0 && <span style={{ position: 'absolute', right: 6, bottom: 5, width: 6, height: 6, borderRadius: '50%', background: c }} />)}
```

New:
```tsx
                    <button key={rv.id} type="button"
                      onMouseDown={(evt) => startBlockDrag(evt, rv, 'move', s, e)}
                      onMouseEnter={(evt) => { if (dots) scheduleHover(rv, dots, evt.currentTarget); }}
                      onMouseLeave={() => cancelHover(rv.id)}
                      onClick={() => { if (draggedRef.current) { draggedRef.current = false; return; } openRes(rv); }}
                      title={`${labelOf(rv)} · ${TYPE_META[rv.type].label} · ${fmtHM(rv.startTime, tz)}–${fmtHM(rv.endTime, tz)}`}
                      style={{
                        position: 'absolute', top: top + 2, left: 3, right: 3, height, boxSizing: 'border-box',
                        borderRadius: 9, padding: small ? '3px 8px' : '5px 8px', overflow: 'hidden', zIndex: 2, textAlign: 'left',
                        cursor: cancelled ? 'pointer' : 'grab',
                        background: tint(c), boxShadow: `inset 3px 0 0 ${c}`,
                        border: pend ? `1px dashed ${c}` : '1px solid transparent', opacity: dragging ? 0.3 : (pend ? 0.85 : 1),
                        display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', gap: 2,
                      }}>
                      <span style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, color: th.text, lineHeight: 1.15, display: '-webkit-box', WebkitLineClamp: small ? 1 : 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', wordBreak: 'break-word' }}>{labelOf(rv)}</span>
                      {!small && <span style={{ fontFamily: th.fontMono, fontSize: 10, color: th.textMute, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pend ? 'attente · ' : ''}{fmtHM(rv.startTime, tz)}–{fmtHM(rv.endTime, tz)}</span>}
                      {dots && !small && <span style={{ marginTop: 'auto', display: 'flex' }}><PaymentInitials model={dots} /></span>}
                      {dots && small && (dots.settled
                        ? <span style={{ position: 'absolute', right: 5, bottom: 3, fontSize: 9, fontWeight: 700, color: SETTLED_COLOR, lineHeight: 1 }}>✓</span>
                        : dots.seats.some(Boolean) && <span style={{ position: 'absolute', right: 6, bottom: 4 }}><PaymentInitials model={dots} compact /></span>)}
```

- [ ] **Step 8: Wire the page — render the popover**

Old:
```tsx
        <div style={{ marginTop: 12, fontFamily: th.fontUI, fontSize: 12.5, color: th.textFaint }}>{resources.length} terrain{resources.length > 1 ? 's' : ''} · {shown.length} réservation{shown.length > 1 ? 's' : ''} affichée{shown.length > 1 ? 's' : ''}</div>
        </>
      )}

      {/* modale détail réservation */}
```

New:
```tsx
        <div style={{ marginTop: 12, fontFamily: th.fontUI, fontSize: 12.5, color: th.textFaint }}>{resources.length} terrain{resources.length > 1 ? 's' : ''} · {shown.length} réservation{shown.length > 1 ? 's' : ''} affichée{shown.length > 1 ? 's' : ''}</div>
        </>
      )}

      {hover && !drag && <TilePaymentPopover model={hover.model} anchor={hover.anchor} />}

      {/* modale détail réservation */}
```

- [ ] **Step 9: Run tests to verify they pass**

Run (from `frontend/`):
```bash
node node_modules/jest/bin/jest.js AdminPlanning.test.tsx
```
Expected: PASS — all tests in the file, including the 5 new ones and the pre-existing drag & drop / cash register suites (unaffected).

- [ ] **Step 10: Typecheck**

Run (from `frontend/`):
```bash
node node_modules/typescript/bin/tsc --noEmit
```
Expected: no errors.

- [ ] **Step 11: Run the caisse suite too (regression check on the shared helper)**

Run (from `frontend/`):
```bash
node node_modules/jest/bin/jest.js caisse.test.ts AdminPlanning.test.tsx
```
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add frontend/app/admin/planning/page.tsx frontend/__tests__/AdminPlanning.test.tsx
git commit -m "feat(planning): vignettes en pastilles-initiales de paiement + panneau au survol"
```

---

### Task 5: Regression check on pages that still use `PaymentDots`/`paymentDots`

**Files:** none modified — verification only.

- [ ] **Step 1: Confirm the untouched consumers still pass**

Run (from `frontend/`):
```bash
node node_modules/jest/bin/jest.js CashRegister.test.tsx AdminReservations.test.tsx AdminEncaissement.test.tsx
```
Expected: PASS, unchanged — `PaymentDots`/`paymentDots`/`SETTLED_COLOR` were not touched, so `CashRegister`, `/admin/reservations` (via `QueueList`/inline `paymentDots` usage), and `/admin/encaissement` keep their existing anonymous-dots rendering.

- [ ] **Step 2: Visual check (clair + sombre)**

Use the `verify` skill against `/admin/planning` with a reservation that has 2+ participants (one paid, one not) on a COURT resource:
- confirm pastilles show initials, green for the paid participant, outlined for the unpaid one, dashed for empty seats
- hover the tile ~0.5s and confirm the detail panel appears to the right (or flips left on the last column) with full names and amounts
- repeat in dark theme (`th.mode === 'floodlit'`)

If a visual issue is found, fix it inline in `PaymentInitials.tsx`/`TilePaymentPopover.tsx` and re-run Task 4 Step 9's test command before re-committing.

- [ ] **Step 3: Commit any visual fixes (only if Step 2 required changes)**

```bash
git add frontend/components/admin/PaymentInitials.tsx frontend/components/admin/planning/TilePaymentPopover.tsx
git commit -m "fix(planning): ajustement visuel des pastilles-initiales / panneau au survol"
```
