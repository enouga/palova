# Caisse en deux zones — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nouvelle page `/admin/encaissement` (« Caisse express ») : file chronologique à gauche, caisse POS à droite (sélection de joueurs → gros boutons de moyens), sans toucher à la page `/admin/reservations` existante.

**Architecture:** 100 % frontend. Helpers purs `lib/caisseRegister.ts` (statuts par place, auto-sélection, groupes de file) + deux composants (`QueueList`, `CashRegister`) + une page qui reprend le squelette de chargement/optimisme de `app/admin/reservations/page.tsx`. Aucun backend, aucune migration, mêmes appels API.

**Tech Stack:** Next.js 16 (client components), React 19, jest + React Testing Library (ts-jest, PAS de type-check → `tsc --noEmit` séparé).

**Spec:** `docs/superpowers/specs/2026-07-07-caisse-deux-zones-design.md`

**⚠️ Conventions repo:**
- Shims `node_modules/.bin` cassés : lancer `node node_modules/jest/bin/jest.js` et `node node_modules/typescript/bin/tsc` directement.
- Tous les montants en **centimes** (entiers), jamais de flottants (`toCents`/`fmtEuros`).
- Jamais de `new Date()` au rendu (hydration) — ici pages admin client-only, `fmtTime` sur des ISO reçus, OK.
- Ne PAS modifier `app/admin/reservations/page.tsx`, `ReservationCollect.tsx`, `CollectPanel.tsx`, `lib/caisse.ts`, `lib/collect.ts`.

---

## File Structure

| Fichier | Rôle |
|---|---|
| Create `frontend/lib/caisseRegister.ts` | Helpers purs : `slotStatuses`, `nextSelectable`, `selectionTotal`, `queueGroups` |
| Create `frontend/__tests__/caisseRegister.test.ts` | Tests des helpers purs |
| Create `frontend/components/admin/caisse/CashRegister.tsx` | Zone 2 : tuiles joueurs, sélection, gros boutons, toast Annuler, file `enqueue` |
| Create `frontend/__tests__/CashRegister.test.tsx` | Tests du composant caisse |
| Create `frontend/components/admin/caisse/QueueList.tsx` | Zone 1 : file « À encaisser d'abord » / « Soldées » (présentation pure) |
| Create `frontend/app/admin/encaissement/page.tsx` | Page : chargement, filtres, KPI, split desktop / feuille mobile, modales Détails/Reçu/Annulation |
| Create `frontend/__tests__/AdminEncaissement.test.tsx` | Tests de la page (file, sélection, wiring, filtres) |
| Modify `frontend/app/admin/layout.tsx:101` | Entrée de nav « Caisse express » |

---

### Task 1: Helpers purs `lib/caisseRegister.ts`

**Files:**
- Create: `frontend/lib/caisseRegister.ts`
- Test: `frontend/__tests__/caisseRegister.test.ts`

La logique de statut par place existe déjà, enfouie dans `ReservationCollect.tsx:92-115` (parts égales `due ÷ capacité`, places nommées suivies par leurs paiements `participantId`, places génériques couvertes de haut en bas par les paiements anonymes). On l'extrait en pur SANS toucher au composant existant.

- [ ] **Step 1: Écrire les tests (qui échouent)**

Créer `frontend/__tests__/caisseRegister.test.ts` :

```ts
import { slotStatuses, nextSelectable, selectionTotal, queueGroups, SlotStatus } from '../lib/caisseRegister';

// ── factories minimales (structurelles, mêmes formes que l'API) ────────────
const pay = (id: string, amount: string, method = 'CARD', participantId: string | null = null, refunded = '0.00') => ({
  id, amount, method, participantId, payerName: null, note: null, voucherRef: null,
  voucherIssuer: null, voucherStatus: null, createdAt: '2099-01-01T10:00:00.000Z',
  refundedAmount: refunded, receiptNo: null,
});
const part = (id: string, userId: string, first: string, last: string, paid = '0.00') => ({
  id, userId, isOrganizer: false, firstName: first, lastName: last,
  paid, share: '13.00', outstanding: '13.00',
});
const rv = (over: Record<string, unknown> = {}) => ({
  id: 'rv-1', status: 'CONFIRMED', type: 'COURT', startTime: '2099-06-22T16:00:00.000Z',
  endTime: '2099-06-22T17:00:00.000Z', title: null, totalPrice: '52.00', paidAmount: '0.00',
  resource: { id: 'court-1', name: 'C1' },
  user: { id: 'u0', firstName: 'Jean', lastName: 'Dupont', email: 'j@x.fr' },
  participants: [] as unknown[], payments: [] as unknown[], ...over,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any;

describe('slotStatuses', () => {
  it('titulaire + places vides : 4 parts égales non réglées, userId sur le titulaire', () => {
    const s = slotStatuses(rv(), 4, 5200);
    expect(s).toHaveLength(4);
    expect(s.every((x: SlotStatus) => !x.paid && x.amountCents === 1300)).toBe(true);
    expect(s[0].slot.kind).toBe('holder');
    expect(s[0].userId).toBe('u0');
    expect(s[1].slot.kind).toBe('empty');
    expect(s[1].userId).toBeNull();
  });

  it('place nommée réglée par SON paiement : paid, method, payments pour le remboursement', () => {
    const r = rv({
      participants: [part('pt-1', 'u1', 'Léa', 'Roy', '13.00'), part('pt-2', 'u2', 'Max', 'Bo')],
      payments: [pay('p1', '13.00', 'CASH', 'pt-1')],
      paidAmount: '13.00',
    });
    const s = slotStatuses(r, 4, 5200);
    expect(s[0].paid).toBe(true);
    expect(s[0].method).toBe('CASH');
    expect(s[0].payments.map((p) => p.id)).toEqual(['p1']);
    expect(s[0].amountCents).toBe(0);
    expect(s[1].paid).toBe(false);
    expect(s[1].amountCents).toBe(1300);
    expect(s[1].participantId).toBe('pt-2');
    expect(s[1].userId).toBe('u2');
  });

  it('paiements anonymes : couvrent les places génériques de haut en bas', () => {
    const r = rv({ payments: [pay('p1', '13.00', 'CARD'), pay('p2', '13.00', 'CASH')], paidAmount: '26.00' });
    const s = slotStatuses(r, 4, 5200);
    expect(s[0].paid).toBe(true);
    expect(s[0].method).toBe('CARD');   // 1er paiement anonyme → 1re place
    expect(s[1].paid).toBe(true);
    expect(s[1].method).toBe('CASH');
    expect(s[2].paid).toBe(false);
    expect(s[3].paid).toBe(false);
  });

  it('résa soldée : toutes les places sont réglées', () => {
    const r = rv({ payments: [pay('p1', '52.00')], paidAmount: '52.00' });
    const s = slotStatuses(r, 4, 5200);
    expect(s.every((x: SlotStatus) => x.paid && x.amountCents === 0)).toBe(true);
  });

  it('part plafonnée au reste dû (paiement libre partiel)', () => {
    const r = rv({ payments: [pay('p1', '45.00')], paidAmount: '45.00' });
    const s = slotStatuses(r, 4, 5200);
    // 45 € anonymes = 3 parts couvertes (3 × 13), reste 7 € sur la 4e place.
    expect(s[3].paid).toBe(false);
    expect(s[3].amountCents).toBe(700);
  });
});

describe('nextSelectable', () => {
  const mk = (paidIdx: number[]): SlotStatus[] =>
    [0, 1, 2, 3].map((i) => ({
      slot: { kind: 'empty', index: i }, index: i,
      amountCents: paidIdx.includes(i) ? 0 : 1300, paid: paidIdx.includes(i),
      payments: [], method: null, userId: null, participantId: null,
    }));
  it('sans exclusion : première place non réglée', () => {
    expect(nextSelectable(mk([0]))).toBe(1);
  });
  it('après paiement : la place suivante (au-delà des payées à l\'instant)', () => {
    expect(nextSelectable(mk([0]), new Set([1]))).toBe(2);
  });
  it('reboucle en tête quand la fin est réglée', () => {
    expect(nextSelectable(mk([1, 3]), new Set([2]))).toBe(0);
  });
  it('null quand tout est réglé', () => {
    expect(nextSelectable(mk([0, 1, 2, 3]))).toBeNull();
    expect(nextSelectable(mk([0, 1]), new Set([2, 3]))).toBeNull();
  });
});

describe('selectionTotal', () => {
  it('somme les parts des places sélectionnées', () => {
    const st: SlotStatus[] = [1300, 1300, 700].map((c, i) => ({
      slot: { kind: 'empty', index: i }, index: i, amountCents: c, paid: false,
      payments: [], method: null, userId: null, participantId: null,
    }));
    expect(selectionTotal(st, new Set([0, 2]))).toBe(2000);
    expect(selectionTotal(st, new Set())).toBe(0);
  });
});

describe('queueGroups', () => {
  const entry = (id: string, start: string, paid: string, over: Record<string, unknown> = {}) =>
    rv({ id, startTime: start, paidAmount: paid, ...over });
  const dueOf = () => 5200;
  it('à encaisser trié par heure, soldées à part, annulées exclues', () => {
    const rows = [
      entry('b', '2099-06-22T18:00:00.000Z', '0.00'),
      entry('a', '2099-06-22T16:00:00.000Z', '0.00'),
      entry('s', '2099-06-22T15:00:00.000Z', '52.00'),
      entry('x', '2099-06-22T14:00:00.000Z', '0.00', { status: 'CANCELLED' }),
    ];
    const g = queueGroups(rows, dueOf);
    expect(g.toCollect.map((e) => e.r.id)).toEqual(['a', 'b']);
    expect(g.settled.map((e) => e.r.id)).toEqual(['s']);
    expect(g.toCollect[0].remaining).toBe(5200);
  });
  it('dû nul → groupe « soldées »', () => {
    const g = queueGroups([entry('e', '2099-06-22T16:00:00.000Z', '0.00')], () => 0);
    expect(g.toCollect).toHaveLength(0);
    expect(g.settled.map((e) => e.r.id)).toEqual(['e']);
  });
});
```

- [ ] **Step 2: Vérifier que les tests échouent**

```bash
cd frontend && node node_modules/jest/bin/jest.js __tests__/caisseRegister.test.ts
```
Attendu : FAIL — `Cannot find module '../lib/caisseRegister'`.

- [ ] **Step 3: Implémenter `frontend/lib/caisseRegister.ts`**

```ts
import type { ClubReservation, Payment, PaymentMethod } from '@/lib/api';
import { deriveSlots, SlotEntry, toCents } from '@/lib/caisse';

// Helpers purs de la page « Caisse express » (/admin/encaissement).
// Miroir extrait de la logique de statut par place de ReservationCollect :
// 1 place = 1 part ÉGALE (dû ÷ capacité) ; une place nommée est « réglée »
// via SES paiements (participantId) ; les places génériques (titulaire/vides)
// sont couvertes de haut en bas par les paiements anonymes.

/** Reste remboursable d'un paiement (centimes). */
const refundable = (p: Payment) => toCents(p.amount) - toCents(p.refundedAmount ?? '0');

export interface SlotStatus {
  slot: SlotEntry;
  index: number;
  /** part à encaisser si on encaisse cette place maintenant (0 si réglée), centimes */
  amountCents: number;
  paid: boolean;
  /** paiements attribués à la place (remboursement ciblé « annuler ») */
  payments: Payment[];
  /** moyen affiché sur une place réglée (dernier paiement) */
  method: PaymentMethod | null;
  /** joueur identifié (soldes prépayés) — titulaire ou participant */
  userId: string | null;
  /** place nommée → cible de l'encaissement (body.participantId) */
  participantId: string | null;
}

type RegisterReservation = Pick<ClubReservation, 'id' | 'user' | 'participants' | 'payments' | 'paidAmount'>;

/** Statut de paiement de chaque place d'une réservation COURT. */
export function slotStatuses(rv: RegisterReservation, players: number, due: number): SlotStatus[] {
  const paid = toCents(rv.paidAmount);
  const remaining = Math.max(0, due - paid);
  const settled = due > 0 && remaining <= 0;
  const capShare = players > 0 ? Math.round(due / players) : remaining;
  const bills = rv.participants ?? [];
  const participantPaidCents = bills.reduce((sum, p) => sum + toCents(p.paid), 0);
  const anonPaidCents = Math.max(0, paid - participantPaidCents);
  const coveredGeneric = capShare > 0 ? Math.floor(anonPaidCents / capShare) : 0;
  const anonPays = (rv.payments ?? []).filter((p) => !p.participantId && refundable(p) > 0);
  let genericSeen = 0;
  return deriveSlots(rv, players).map((slot, index) => {
    if (slot.kind === 'participant') {
      const playerRemaining = Math.max(0, capShare - slot.paidCents);
      const isPaid = playerRemaining <= 0 || settled;
      const ownPays = (rv.payments ?? []).filter((p) => p.participantId === slot.participantId);
      const bill = bills.find((b) => b.id === slot.participantId);
      return {
        slot, index,
        amountCents: isPaid ? 0 : Math.min(playerRemaining, remaining),
        paid: isPaid,
        payments: ownPays,
        method: ownPays.length ? ownPays[ownPays.length - 1].method : null,
        userId: bill?.userId ?? null,
        participantId: slot.participantId,
      };
    }
    const g = genericSeen; genericSeen += 1;
    const covered = g < coveredGeneric;
    const anonPay = covered ? anonPays[g] ?? null : null;
    const isPaid = covered || settled;
    return {
      slot, index,
      amountCents: isPaid ? 0 : Math.min(capShare, remaining),
      paid: isPaid,
      payments: anonPay ? [anonPay] : [],
      method: anonPay?.method ?? null,
      userId: slot.kind === 'holder' ? (rv.user?.id ?? null) : null,
      participantId: null,
    };
  });
}

/**
 * Place à (auto-)sélectionner : la première non réglée après la dernière que
 * l'on vient d'encaisser (`justPaid`), sinon on reboucle en tête. null = tout réglé.
 */
export function nextSelectable(statuses: SlotStatus[], justPaid: ReadonlySet<number> = new Set()): number | null {
  const after = justPaid.size ? Math.max(...justPaid) : -1;
  const ok = (i: number) => {
    const s = statuses[i];
    return !!s && !s.paid && s.amountCents > 0 && !justPaid.has(i);
  };
  for (let i = after + 1; i < statuses.length; i++) if (ok(i)) return i;
  for (let i = 0; i < after; i++) if (ok(i)) return i;
  return null;
}

/** Montant cumulé (centimes) des places sélectionnées — le chiffre annoncé au client. */
export function selectionTotal(statuses: SlotStatus[], selected: ReadonlySet<number>): number {
  let total = 0;
  for (const i of selected) total += statuses[i]?.amountCents ?? 0;
  return total;
}

export interface QueueEntry<R extends { paidAmount: string }> { r: R; due: number; remaining: number }

/**
 * Groupes de la file : « à encaisser » (reste dû > 0) triés par heure de début,
 * puis « soldées » (réglées ou dû nul). Les annulées sont exclues.
 */
export function queueGroups<R extends { status: string; startTime: string; paidAmount: string }>(
  reservations: R[],
  dueOf: (r: R) => number,
): { toCollect: QueueEntry<R>[]; settled: QueueEntry<R>[] } {
  const entries = reservations
    .filter((r) => r.status !== 'CANCELLED')
    .map((r) => {
      const due = dueOf(r);
      return { r, due, remaining: Math.max(0, due - toCents(r.paidAmount)) };
    });
  const byTime = (a: QueueEntry<R>, b: QueueEntry<R>) => a.r.startTime.localeCompare(b.r.startTime);
  return {
    toCollect: entries.filter((e) => e.remaining > 0).sort(byTime),
    settled: entries.filter((e) => e.remaining <= 0).sort(byTime),
  };
}
```

- [ ] **Step 4: Vérifier que les tests passent**

```bash
cd frontend && node node_modules/jest/bin/jest.js __tests__/caisseRegister.test.ts
```
Attendu : PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/caisseRegister.ts frontend/__tests__/caisseRegister.test.ts
git commit -m "feat(caisse): helpers purs de la caisse express (statuts par place, file)"
```

---

### Task 2: Composant `CashRegister` (zone caisse)

**Files:**
- Create: `frontend/components/admin/caisse/CashRegister.tsx`
- Test: `frontend/__tests__/CashRegister.test.tsx`

Le cœur POS : tuiles joueurs cochables, montant en grand, gros boutons de moyens, carnet contextuel, toast « Annuler », file sérialisée `enqueue` (pattern repris de `ReservationCollect.tsx:69-79`), association de membre via `PlayerPicker`.

**Décisions d'implémentation (validées en spec) :**
- Les tuiles sont des `<div role="checkbox" aria-checked>` (PAS des `<button>`) : elles contiennent des vrais boutons internes (« associer », « annuler ») — pas de boutons imbriqués.
- `onOptimisticPay` **renvoie l'id synthétique** (`opt:N`) créé par la page : le toast peut ainsi annuler visuellement AVANT réconciliation (ids synthétiques) comme APRÈS (ids réels collectés au fil de la file — garantis présents quand la tâche d'annulation, enfilée derrière, s'exécute).
- Toast : un seul à la fois (le dernier gagne), ~6 s. À expiration, si la résa a été soldée par ce lot ET `isDesktop` → `onSettled()` (la page passe à la résa suivante). « Annuler » annule aussi ce saut.
- Multi-sélection → un `adminAddPayment` PAR place (attribution par joueur préservée).

- [ ] **Step 1: Écrire les tests (qui échouent)**

Créer `frontend/__tests__/CashRegister.test.tsx` :

```tsx
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { CashRegister } from '../components/admin/caisse/CashRegister';
import { ThemeProvider } from '../lib/ThemeProvider';
import { api, ClubReservation, PaymentMethod } from '../lib/api';

jest.mock('../lib/api', () => ({
  api: {
    adminAddPayment: jest.fn().mockResolvedValue({ id: 'real-1' }),
    refundPayment: jest.fn().mockResolvedValue({ id: 'rf-1' }),
    adminAssignReservationMember: jest.fn().mockResolvedValue({ id: 'rv-1' }),
    adminAddReservationParticipant: jest.fn().mockResolvedValue({ id: 'rv-1' }),
    adminCreateMember: jest.fn().mockResolvedValue({ tempPassword: null, existed: false }),
    adminGetMembers: jest.fn().mockResolvedValue([]),
  },
  assetUrl: (u: string | null) => u,
}));

const part = (id: string, userId: string, first: string, last: string, paid = '0.00') => ({
  id, userId, isOrganizer: false, firstName: first, lastName: last, paid, share: '13.00', outstanding: '13.00',
});
const rv = (over: Record<string, unknown> = {}): ClubReservation => ({
  id: 'rv-1', resourceId: 'court-1', startTime: '2099-06-22T16:00:00.000Z', endTime: '2099-06-22T17:00:00.000Z',
  status: 'CONFIRMED', type: 'COURT', title: null, totalPrice: '52.00', paidAmount: '0.00', dueAmount: '52.00',
  resource: { id: 'court-1', name: 'Padel int 1' },
  user: { id: 'u0', firstName: 'Jean', lastName: 'Dupont', email: 'j@x.fr' },
  payments: [], participants: [], ...over,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any);

const baseProps = () => ({
  players: 4, due: 5200, members: [], quickMethods: ['CARD', 'VOUCHER', 'CASH'] as PaymentMethod[],
  packagesByUser: {}, clubId: 'club-1', token: 'tok', isDesktop: true,
  onChanged: jest.fn(), onOptimisticPay: jest.fn().mockReturnValue('opt:1'),
  onOptimisticRefund: jest.fn(), onOpenDetails: jest.fn(), onCancel: jest.fn(),
  onError: jest.fn(), onSettled: jest.fn(),
});

const renderReg = (r: ClubReservation, props = baseProps()) =>
  render(<ThemeProvider><CashRegister reservation={r} {...props} /></ThemeProvider>);

beforeEach(() => { jest.clearAllMocks(); });

it('pré-sélectionne la première place non réglée et affiche sa part en grand', () => {
  renderReg(rv());
  const tiles = screen.getAllByRole('checkbox');
  expect(tiles[0]).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByText('1 joueur sélectionné')).toBeInTheDocument();
  expect(screen.getByTestId('cx-total')).toHaveTextContent('13 €');
});

it('multi-sélection : cocher une 2e tuile cumule le montant', () => {
  renderReg(rv());
  fireEvent.click(screen.getAllByRole('checkbox')[1]);
  expect(screen.getByText('2 joueurs sélectionnés')).toBeInTheDocument();
  expect(screen.getByTestId('cx-total')).toHaveTextContent('26 €');
});

it('CB sur une multi-sélection : un adminAddPayment PAR place, avec participantId pour les nommées', async () => {
  const r = rv({ participants: [part('pt-1', 'u1', 'Léa', 'Roy'), part('pt-2', 'u2', 'Max', 'Bo')] });
  renderReg(r);
  fireEvent.click(screen.getAllByRole('checkbox')[1]);              // pt-2 s'ajoute à pt-1
  fireEvent.click(screen.getByRole('button', { name: /CB/ }));
  await waitFor(() => expect(api.adminAddPayment).toHaveBeenCalledTimes(2));
  expect(api.adminAddPayment).toHaveBeenCalledWith('club-1', 'rv-1',
    expect.objectContaining({ amount: 13, method: 'CARD', participantId: 'pt-1' }), 'tok');
  expect(api.adminAddPayment).toHaveBeenCalledWith('club-1', 'rv-1',
    expect.objectContaining({ amount: 13, method: 'CARD', participantId: 'pt-2' }), 'tok');
});

it('« Tout le reste » sélectionne toutes les places non réglées', () => {
  renderReg(rv());
  fireEvent.click(screen.getByRole('button', { name: /Tout le reste/ }));
  expect(screen.getByText('4 joueurs sélectionnés')).toBeInTheDocument();
  expect(screen.getByTestId('cx-total')).toHaveTextContent('52 €');
});

it('carnet contextuel : visible en mono-sélection quand le joueur a un solde, masqué en multi', () => {
  const r = rv({ participants: [part('pt-1', 'u1', 'Léa', 'Roy'), part('pt-2', 'u2', 'Max', 'Bo')] });
  const props = { ...baseProps(), packagesByUser: { u1: [
    { id: 'pk-1', userId: 'u1', kind: 'ENTRIES', creditsTotal: 10, creditsRemaining: 3, amountTotal: null, amountRemaining: null, purchasedAt: '', expiresAt: null },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ] } as any };
  renderReg(r, props);
  expect(screen.getByRole('button', { name: /Carnet/ })).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('checkbox')[1]);   // multi → masqué
  expect(screen.queryByRole('button', { name: /Carnet/ })).not.toBeInTheDocument();
});

it('paiement carnet : PACK_CREDIT + sourcePackageId + participantId', async () => {
  const r = rv({ participants: [part('pt-1', 'u1', 'Léa', 'Roy')] });
  const props = { ...baseProps(), packagesByUser: { u1: [
    { id: 'pk-1', userId: 'u1', kind: 'ENTRIES', creditsTotal: 10, creditsRemaining: 3, amountTotal: null, amountRemaining: null, purchasedAt: '', expiresAt: null },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ] } as any };
  renderReg(r, props);
  fireEvent.click(screen.getByRole('button', { name: /Carnet/ }));
  await waitFor(() => expect(api.adminAddPayment).toHaveBeenCalledWith('club-1', 'rv-1',
    expect.objectContaining({ method: 'PACK_CREDIT', sourcePackageId: 'pk-1', participantId: 'pt-1', amount: 13 }), 'tok'));
});

it('toast après encaissement : « Annuler » rembourse (optimiste + réseau) et bloque onSettled', async () => {
  jest.useFakeTimers();
  const props = baseProps();
  renderReg(rv(), props);
  fireEvent.click(screen.getByRole('button', { name: /CB/ }));
  // le toast apparaît avec le lien Annuler
  const undo = await screen.findByRole('button', { name: 'Annuler' });
  // attendre que la file ait persisté le paiement (id réel collecté)
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  fireEvent.click(undo);
  expect(props.onOptimisticRefund).toHaveBeenCalled();
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(api.refundPayment).toHaveBeenCalledWith('club-1', 'real-1',
    expect.objectContaining({ amount: 13 }), 'tok');
  act(() => { jest.advanceTimersByTime(7000); });
  expect(props.onSettled).not.toHaveBeenCalled();
  jest.useRealTimers();
});

it('lot qui solde la résa : onSettled appelé à l\'expiration du toast (desktop)', async () => {
  jest.useFakeTimers();
  const props = baseProps();
  renderReg(rv(), props);
  fireEvent.click(screen.getByRole('button', { name: /Tout le reste/ }));
  fireEvent.click(screen.getByRole('button', { name: /CB/ }));
  await screen.findByRole('button', { name: 'Annuler' });
  act(() => { jest.advanceTimersByTime(7000); });
  expect(props.onSettled).toHaveBeenCalled();
  jest.useRealTimers();
});

it('place réglée : ✓ + moyen + « annuler » qui rembourse le paiement de la place', async () => {
  const r = rv({
    participants: [part('pt-1', 'u1', 'Léa', 'Roy', '13.00'), part('pt-2', 'u2', 'Max', 'Bo')],
    payments: [{ id: 'p1', amount: '13.00', method: 'CASH', participantId: 'pt-1', payerName: null, note: null, voucherRef: null, voucherIssuer: null, voucherStatus: null, createdAt: '2099-06-22T15:00:00.000Z', refundedAmount: '0.00', receiptNo: null }],
    paidAmount: '13.00',
  });
  const props = baseProps();
  renderReg(r, props);
  expect(screen.getByText(/réglé/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'annuler' }));
  expect(props.onOptimisticRefund).toHaveBeenCalledWith(['p1']);
  await waitFor(() => expect(api.refundPayment).toHaveBeenCalledWith('club-1', 'p1',
    expect.objectContaining({ amount: 13 }), 'tok'));
});

it('événement (type EVENT) : pas de tuiles, « Encaisser » règle le reste en anonyme', async () => {
  const r = rv({ type: 'EVENT', totalPrice: '40.00', dueAmount: '40.00' });
  renderReg(r, { ...baseProps(), due: 4000, players: 0 });
  expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: /CB/ }));
  await waitFor(() => expect(api.adminAddPayment).toHaveBeenCalledWith('club-1', 'rv-1',
    expect.objectContaining({ amount: 40, method: 'CARD' }), 'tok'));
  expect((api.adminAddPayment as jest.Mock).mock.calls[0][2].participantId).toBeUndefined();
});

it('résa sans prix (due 0) : bouton « Encaisser un montant… » → onOpenDetails', () => {
  const r = rv({ totalPrice: '0.00', dueAmount: '0.00' });
  const props = baseProps();
  renderReg(r, { ...props, due: 0 });
  fireEvent.click(screen.getByRole('button', { name: /Encaisser un montant/ }));
  expect(props.onOpenDetails).toHaveBeenCalled();
});

it('résa soldée : bandeau ✓ Soldé, pas de boutons de paiement', () => {
  const r = rv({ payments: [{ id: 'p1', amount: '52.00', method: 'CARD', participantId: null, payerName: null, note: null, voucherRef: null, voucherIssuer: null, voucherStatus: null, createdAt: '2099-06-22T15:00:00.000Z', refundedAmount: '0.00', receiptNo: null }], paidAmount: '52.00' });
  renderReg(r);
  expect(screen.getByText(/Soldé/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /CB/ })).not.toBeInTheDocument();
});

it('« associer un membre » sur une place générique ouvre le PlayerPicker', () => {
  renderReg(rv());
  fireEvent.click(screen.getAllByRole('button', { name: /associer/i })[0]);
  expect(screen.getByPlaceholderText(/Rechercher un membre/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Vérifier que les tests échouent**

```bash
cd frontend && node node_modules/jest/bin/jest.js __tests__/CashRegister.test.tsx
```
Attendu : FAIL — `Cannot find module '../components/admin/caisse/CashRegister'`.

- [ ] **Step 3: Implémenter `frontend/components/admin/caisse/CashRegister.tsx`**

```tsx
'use client';
import { useEffect, useRef, useState, CSSProperties } from 'react';
import { api, ClubReservation, Member, CreateMemberBody, PaymentMethod, AddPaymentBody, Payment, MemberPackage } from '@/lib/api';
import { toCents, fmtEuros, isOptimisticId, PaymentIntent, QUICK_METHOD_LABEL } from '@/lib/caisse';
import { slotStatuses, nextSelectable, selectionTotal, SlotStatus } from '@/lib/caisseRegister';
import { pickPackageFor, packageLabel } from '@/lib/packages';
import { useTheme } from '@/lib/ThemeProvider';
import { inkOn } from '@/lib/theme';
import { colorForSeed } from '@/lib/playerColors';
import { Icon, IconName } from '@/components/ui/Icon';
import { PlayerPicker } from '@/components/admin/PlayerPicker';
import { SETTLED_COLOR } from '@/components/admin/PaymentDots';

const CORAL = '#ff7a4d';
const TOAST_MS = 6000;
const METHOD_ICON: Record<string, IconName> = { CASH: 'euro', CARD: 'card', VOUCHER: 'ticket', TRANSFER: 'arrowR', MEMBER: 'user', PACK_CREDIT: 'ticket', WALLET: 'euro', ONLINE: 'card', OTHER: 'euro', SUBSCRIPTION: 'user' };
const METHOD_LABEL_FULL: Record<string, string> = { CASH: 'Espèces', CARD: 'CB', TRANSFER: 'Virement', ONLINE: 'En ligne', OTHER: 'Autre', VOUCHER: 'Ticket CE', PACK_CREDIT: 'Carnet', WALLET: 'Porte-monnaie', MEMBER: 'Abo / Membre', SUBSCRIPTION: 'Abonnement' };

function fmtTime(iso: string): string { return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); }
function mapPayError(e: unknown, perPlayer: boolean): string {
  const m = (e as Error).message;
  if (m === 'PAYMENT_EXCEEDS_DUE') return perPlayer ? 'Le montant dépasse la part du joueur.' : 'Le montant dépasse le reste dû.';
  return m;
}
function mapAssocError(e: unknown): string {
  const m = (e as Error).message;
  return ({
    TOO_MANY_PLAYERS: 'Terrain complet.',
    RESERVATION_HAS_NO_MEMBER: "Associez d'abord un joueur à la réservation.",
    PARTNER_DUPLICATE: 'Ce joueur est déjà ajouté.',
    MEMBER_NOT_FOUND: "Ce joueur n'est pas membre actif du club.",
  } as Record<string, string>)[m] ?? m;
}

/** Un lot d'encaissements annulable via le toast (les ids réels arrivent au fil de la file). */
interface UndoBatch {
  label: string;
  items: { amountCents: number; syntheticId: string; realId: string | null }[];
  /** ce lot a soldé la résa → à l'expiration du toast, la page passe à la suivante (desktop). */
  settledAll: boolean;
}

export interface CashRegisterProps {
  reservation: ClubReservation;
  players: number;          // capacité du terrain (2 single / 4 double), 0 hors COURT
  due: number;              // centimes — calculé par le parent (dueCents)
  members: Member[];
  quickMethods: PaymentMethod[];
  packagesByUser?: Record<string, MemberPackage[]>;
  clubId: string;
  token: string;
  isDesktop: boolean;
  onChanged: (updated?: ClubReservation) => void | Promise<void>;
  /** patch local immédiat d'un encaissement ; renvoie l'id synthétique (`opt:N`) créé. */
  onOptimisticPay: (intent: PaymentIntent) => string;
  onOptimisticRefund: (paymentIds: string[]) => void;
  onOpenDetails: () => void;
  onCancel: () => void;
  onError: (msg: string) => void;
  /** la résa vient d'être soldée ET le toast a expiré → passer à la suivante. */
  onSettled?: () => void;
}

/**
 * Zone « caisse » de la page Caisse express : on sélectionne QUI paie (tuiles),
 * le montant à annoncer s'affiche en grand, puis un tap sur le MOYEN encaisse
 * (optimiste, un appel par place). Toast « Annuler » ~6 s après chaque lot.
 */
export function CashRegister({ reservation, players, due, members, quickMethods, packagesByUser, clubId, token, isDesktop, onChanged, onOptimisticPay, onOptimisticRefund, onOpenDetails, onCancel, onError, onSettled }: CashRegisterProps) {
  const { th } = useTheme();
  const isCourt = reservation.type === 'COURT';
  const paid = toCents(reservation.paidAmount);
  const remaining = Math.max(0, due - paid);
  const settled = due > 0 && remaining <= 0;
  const statuses: SlotStatus[] = isCourt && players > 0 ? slotStatuses(reservation, players, due) : [];

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [associatingIndex, setAssociatingIndex] = useState<number | null>(null);
  const [assocBusy, setAssocBusy] = useState(false);
  const [toast, setToast] = useState<UndoBatch | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // File sérialisée des appels réseau (pattern ReservationCollect) : l'UI réagit au
  // clic, les appels s'enchaînent, réconciliation UNE fois la file vide.
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const pending = useRef(0);
  const enqueue = (task: () => Promise<void>) => {
    pending.current += 1;
    const run = async () => {
      await task();
      pending.current -= 1;
      if (pending.current === 0) await onChanged();
    };
    chain.current = chain.current.then(run, run);
  };

  // Changement de réservation → sélection re-semée sur la 1re place non réglée,
  // picker fermé, toast conservé (il annule des paiements déjà identifiés par id).
  const rvId = reservation.id;
  useEffect(() => {
    setAssociatingIndex(null);
    setSelected(() => {
      const first = nextSelectable(isCourt && players > 0 ? slotStatuses(reservation, players, due) : []);
      return first === null ? new Set() : new Set([first]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rvId]);

  // Une place sélectionnée devenue réglée (paiement depuis la modale Détails,
  // réconciliation…) sort de la sélection.
  useEffect(() => {
    setSelected((cur) => {
      const kept = [...cur].filter((i) => statuses[i] && !statuses[i].paid);
      return kept.length === cur.size ? cur : new Set(kept);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservation]);

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const armToast = (batch: UndoBatch) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(batch);
    toastTimer.current = setTimeout(() => {
      setToast(null);
      if (batch.settledAll && isDesktop) onSettled?.();
    }, TOAST_MS);
  };

  const undoToast = (batch: UndoBatch) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(null);
    // Visuel immédiat : ids synthétiques (avant réconciliation) ET réels (après) —
    // applyOptimisticRefund ignore les ids absents.
    onOptimisticRefund([...batch.items.map((i) => i.syntheticId), ...batch.items.flatMap((i) => (i.realId ? [i.realId] : []))]);
    // Réseau : la tâche s'exécute APRÈS les encaissements du lot (file FIFO) → realId posés.
    enqueue(async () => {
      try {
        for (const it of batch.items) {
          if (it.realId) await api.refundPayment(clubId, it.realId, { amount: it.amountCents / 100, reason: 'Annulation au comptoir' }, token);
        }
      } catch (e) { onError((e as Error).message); }
    });
  };

  // Encaisse un lot de places (ou le reste entier hors COURT) avec un moyen.
  const paySelection = (method: PaymentMethod, sourcePackageId?: string) => {
    const targets: { amountCents: number; participantId?: string }[] = isCourt && players > 0
      ? [...selected].sort((a, b) => a - b).flatMap((i) => {
          const s = statuses[i];
          return s && !s.paid && s.amountCents > 0 ? [{ amountCents: s.amountCents, participantId: s.participantId ?? undefined }] : [];
        })
      : remaining > 0 ? [{ amountCents: remaining }] : [];
    if (targets.length === 0) return;
    const totalCents = targets.reduce((s, t) => s + t.amountCents, 0);
    const batch: UndoBatch = {
      label: `${fmtEuros(totalCents)} ${METHOD_LABEL_FULL[method] ?? method}`,
      items: [], settledAll: totalCents >= remaining,
    };
    for (const t of targets) {
      const syntheticId = onOptimisticPay({ amountCents: t.amountCents, method, participantId: t.participantId ?? null });
      const item: UndoBatch['items'][number] = { amountCents: t.amountCents, syntheticId, realId: null };
      batch.items.push(item);
      enqueue(async () => {
        try {
          const body: AddPaymentBody = { amount: t.amountCents / 100, method };
          if (t.participantId) body.participantId = t.participantId;
          if (sourcePackageId) body.sourcePackageId = sourcePackageId;
          const created = await api.adminAddPayment(clubId, reservation.id, body, token);
          item.realId = (created as Payment | undefined)?.id ?? null;
        } catch (e) { onError(mapPayError(e, !!t.participantId)); }
      });
    }
    // Auto-avance : la place non réglée suivante (déterministe, sans attendre le state).
    if (isCourt && players > 0) {
      const next = nextSelectable(statuses, new Set(selected));
      setSelected(next === null ? new Set() : new Set([next]));
    }
    armToast(batch);
  };

  // Annule (rembourse) le règlement d'une place déjà réglée.
  const refundSlot = (pays: Payment[]) => {
    const targets = pays.filter((p) => toCents(p.amount) - toCents(p.refundedAmount ?? '0') > 0 && !isOptimisticId(p.id));
    if (targets.length === 0) return;
    onOptimisticRefund(targets.map((p) => p.id));
    enqueue(async () => {
      try {
        for (const p of targets) {
          const rem = toCents(p.amount) - toCents(p.refundedAmount ?? '0');
          await api.refundPayment(clubId, p.id, { amount: rem / 100, reason: 'Annulation au comptoir' }, token);
        }
      } catch (e) { onError((e as Error).message); }
    });
  };

  // Association d'un membre à une place générique (mêmes appels que ReservationCollect).
  const needsHolder = !reservation.user && (reservation.participants ?? []).length === 0;
  const associate = async (m: Member) => {
    if (assocBusy) return;
    setAssocBusy(true);
    try {
      const updated = needsHolder
        ? await api.adminAssignReservationMember(clubId, reservation.id, m.userId, token)
        : await api.adminAddReservationParticipant(clubId, reservation.id, m.userId, token);
      setAssociatingIndex(null);
      await onChanged(updated);
    } catch (e) { onError(mapAssocError(e)); }
    finally { setAssocBusy(false); }
  };
  const createAndAssociate = async (body: CreateMemberBody) => {
    const r = await api.adminCreateMember(clubId, body, token);
    const mem = await api.adminGetMembers(clubId, token);
    const created = mem.find((m) => m.email.toLowerCase() === body.email.toLowerCase());
    if (created) await associate(created);
    return r;
  };

  // ── dérivés d'affichage ──────────────────────────────────────────────────
  const selTotal = isCourt && players > 0 ? selectionTotal(statuses, selected) : remaining;
  const unpaid = statuses.filter((s) => !s.paid && s.amountCents > 0);
  const methods = quickMethods.filter((m) => METHOD_ICON[m]);
  // Carnet/porte-monnaie : mono-sélection d'une place à joueur identifié seulement.
  const single = selected.size === 1 ? statuses[[...selected][0]] : null;
  const singlePkgs = single?.userId ? (packagesByUser?.[single.userId] ?? []) : [];
  const pk = single ? (pickPackageFor(singlePkgs, single.amountCents, 'WALLET') ?? pickPackageFor(singlePkgs, single.amountCents, 'ENTRIES')) : null;
  const who = reservation.title?.trim() ? reservation.title : reservation.user ? `${reservation.user.firstName} ${reservation.user.lastName}` : 'Événement';
  const pct = due > 0 ? Math.max(0, Math.min(100, Math.round((paid / due) * 100))) : 0;

  const toggle = (i: number) => {
    const s = statuses[i];
    if (!s || s.paid) return;
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

  // ── styles ───────────────────────────────────────────────────────────────
  const card: CSSProperties = { background: th.surface, borderRadius: 16, boxShadow: th.shadow, overflow: 'hidden', fontFamily: th.fontUI, position: 'relative' };
  const tileBase = (sel: boolean, isPaid: boolean): CSSProperties => ({
    borderRadius: 13, padding: 12, display: 'flex', alignItems: 'center', gap: 10, minHeight: 58,
    background: isPaid ? `${SETTLED_COLOR}14` : sel ? `${th.accent}1a` : th.surface2,
    boxShadow: sel ? `0 0 0 2px ${th.accent}` : `inset 0 0 0 1px ${isPaid ? `${SETTLED_COLOR}44` : th.line}`,
    cursor: isPaid ? 'default' : 'pointer', opacity: isPaid ? 0.8 : 1, position: 'relative',
  });
  const payBtn = (primary: boolean): CSSProperties => ({
    flex: '1 1 110px', height: 52, border: 'none', borderRadius: 12, cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    fontFamily: th.fontUI, fontSize: 14.5, fontWeight: 700,
    background: primary ? th.accent : th.surface, color: primary ? th.onAccent : th.text,
    boxShadow: primary ? 'none' : `inset 0 0 0 1.5px ${th.lineStrong}`,
  });
  const avatar = (seed: string, first: string, last: string) => {
    const c = colorForSeed(seed);
    return (
      <span style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, background: c, color: inkOn(c), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10.5, fontWeight: 700 }}>
        {(first[0] ?? '').toUpperCase()}{(last[0] ?? '').toUpperCase()}
      </span>
    );
  };

  const renderTile = (s: SlotStatus) => {
    if (associatingIndex === s.index) {
      return (
        <div key={`t${s.index}`} style={{ ...tileBase(false, false), cursor: 'default', gridColumn: '1 / -1' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <PlayerPicker members={members} value={null} onSelect={associate} onClear={() => setAssociatingIndex(null)} onCreate={createAndAssociate} placeholder="Rechercher un membre…" />
          </div>
        </div>
      );
    }
    const isSel = selected.has(s.index);
    const name = s.slot.kind === 'empty' ? `Joueur ${s.index + 1}` : `${(s.slot as { firstName: string }).firstName} ${(s.slot as { lastName: string }).lastName}`;
    const generic = s.slot.kind === 'empty';
    return (
      <div key={`t${s.index}`} role="checkbox" aria-checked={isSel} aria-disabled={s.paid} aria-label={name}
        tabIndex={s.paid ? -1 : 0} onClick={() => toggle(s.index)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(s.index); } }}
        style={tileBase(isSel, s.paid)}>
        {generic
          ? <span style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, background: th.surfaceHi, color: th.textMute, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>{s.index + 1}</span>
          : avatar((s.slot as { seed: string }).seed, (s.slot as { firstName: string }).firstName, (s.slot as { lastName: string }).lastName)}
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: generic ? th.textMute : th.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {name}
            {s.slot.kind === 'participant' && (s.slot as { isOrganizer: boolean }).isOrganizer && <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 600, color: th.textFaint, background: th.surfaceHi, borderRadius: 5, padding: '1px 5px' }}>orga</span>}
          </span>
          {s.paid ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: SETTLED_COLOR, fontWeight: 700 }}>
              ✓ réglé{s.method && <span style={{ color: th.textMute, fontWeight: 500 }}>· {METHOD_LABEL_FULL[s.method] ?? s.method}</span>}
              {s.payments.some((p) => toCents(p.amount) - toCents(p.refundedAmount ?? '0') > 0 && !isOptimisticId(p.id)) && (
                <button type="button" onClick={(e) => { e.stopPropagation(); refundSlot(s.payments); }}
                  style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textFaint, fontSize: 11, fontWeight: 600, textDecoration: 'underline', padding: 0 }}>annuler</button>
              )}
            </span>
          ) : generic ? (
            <button type="button" onClick={(e) => { e.stopPropagation(); setAssociatingIndex(s.index); }}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.accent, fontSize: 11.5, fontWeight: 600, padding: 0 }}>associer un membre</button>
          ) : null}
        </span>
        {!s.paid && <span style={{ fontSize: 14, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: th.text, whiteSpace: 'nowrap' }}>{fmtEuros(s.amountCents)}</span>}
        {(isSel || s.paid) && (
          <span aria-hidden style={{ position: 'absolute', top: -7, right: -6, width: 20, height: 20, borderRadius: '50%', background: s.paid ? SETTLED_COLOR : th.accent, color: '#fff', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: th.shadow }}>✓</span>
        )}
      </div>
    );
  };

  return (
    <div style={card}>
      {/* ── en-tête ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px 12px', borderBottom: `1px solid ${th.line}` }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: th.text }}>{fmtTime(reservation.startTime)} — {reservation.resource.name}</div>
          <div style={{ fontSize: 12, color: th.textMute, marginTop: 2 }}>
            {who}{isCourt && players > 0 ? ` · ${players} joueurs` : ''}{due > 0 ? ` · ${fmtEuros(due)}` : ''}
          </div>
        </div>
        {due > 0 && (
          <>
            <span style={{ flex: '0 1 130px', height: 6, borderRadius: 3, background: th.surfaceHi, overflow: 'hidden' }}>
              <span style={{ display: 'block', height: '100%', width: `${pct}%`, background: SETTLED_COLOR, transition: 'width .3s ease' }} />
            </span>
            <div style={{ textAlign: 'right', fontSize: 11.5, color: th.textMute, whiteSpace: 'nowrap' }}>
              encaissé {fmtEuros(paid)}<br />reste <b style={{ color: settled ? SETTLED_COLOR : CORAL, fontSize: 13 }}>{fmtEuros(remaining)}</b>
            </div>
          </>
        )}
      </div>

      {/* ── tuiles joueurs (COURT à parts) ── */}
      {isCourt && players > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 10, padding: '16px 18px 4px' }}>
          {statuses.map(renderTile)}
          {unpaid.length > 1 && !settled && (
            <button type="button" onClick={() => setSelected(new Set(unpaid.map((s) => s.index)))}
              style={{ gridColumn: '1 / -1', padding: '9px 0', borderRadius: 10, border: 'none', background: 'transparent', boxShadow: `inset 0 0 0 1.5px ${th.lineStrong}`, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.textMute }}>
              Tout le reste — {unpaid.length} parts · {fmtEuros(unpaid.reduce((s, x) => s + x.amountCents, 0))}
            </button>
          )}
        </div>
      )}

      {/* ── zone d'action ── */}
      {settled ? (
        <div style={{ margin: '14px 18px', borderRadius: 14, padding: '18px 16px', background: `${SETTLED_COLOR}14`, boxShadow: `inset 0 0 0 1px ${SETTLED_COLOR}44`, display: 'flex', alignItems: 'center', gap: 10, fontSize: 16, fontWeight: 700, color: SETTLED_COLOR }}>
          <Icon name="check" size={20} color={SETTLED_COLOR} />Soldé · {fmtEuros(paid)} encaissés
        </div>
      ) : due <= 0 ? (
        <div style={{ margin: '14px 18px' }}>
          <button type="button" onClick={onOpenDetails} style={{ width: '100%', height: 44, border: 'none', borderRadius: 12, background: th.accent, color: th.onAccent, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 14, fontWeight: 600 }}>Encaisser un montant…</button>
        </div>
      ) : (
        <div style={{ margin: '12px 18px 16px', borderRadius: 14, background: th.bgElev, boxShadow: `inset 0 0 0 1px ${th.line}`, padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: th.textMute }}>
              {isCourt && players > 0
                ? `${selected.size} joueur${selected.size > 1 ? 's' : ''} sélectionné${selected.size > 1 ? 's' : ''}`
                : 'Reste à encaisser'}
            </span>
            <span data-testid="cx-total" style={{ marginLeft: 'auto', fontFamily: th.fontDisplay, fontSize: 30, fontWeight: 800, letterSpacing: -0.5, fontVariantNumeric: 'tabular-nums', color: th.text }}>{fmtEuros(selTotal)}</span>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {methods.map((m, i) => (
              <button key={m} type="button" disabled={selTotal <= 0} onClick={() => paySelection(m)}
                style={{ ...payBtn(i === 0), opacity: selTotal <= 0 ? 0.45 : 1 }}>
                <Icon name={METHOD_ICON[m]} size={15} color={i === 0 ? th.onAccent : th.textMute} />{QUICK_METHOD_LABEL[m]}
              </button>
            ))}
            {pk && single && (
              <button type="button" onClick={() => paySelection(pk.kind === 'ENTRIES' ? 'PACK_CREDIT' : 'WALLET', pk.id)}
                title={`Régler avec ${packageLabel(pk)}`}
                style={{ ...payBtn(false), color: th.accent, boxShadow: `inset 0 0 0 1.5px ${th.accent}`, fontSize: 13 }}>
                <Icon name="ticket" size={15} color={th.accent} />{pk.kind === 'ENTRIES' ? 'Carnet' : 'Porte-monnaie'} · {packageLabel(pk)}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── pied ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '0 18px 14px', fontSize: 12.5 }}>
        <button type="button" onClick={onOpenDetails} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.accent, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5, padding: 0 }}>
          Montant libre, reçu, historique <Icon name="chevR" size={14} color={th.accent} />
        </button>
        <button type="button" onClick={onCancel} style={{ marginLeft: 'auto', border: 'none', background: 'transparent', cursor: 'pointer', color: th.textFaint, fontFamily: th.fontUI, fontSize: 12, fontWeight: 600, padding: 0 }}>Annuler la réservation</button>
      </div>

      {/* ── toast Annuler ── */}
      {toast && (
        <div role="status" style={{ position: 'absolute', left: 18, right: 18, bottom: 54, display: 'flex', alignItems: 'center', gap: 12, background: th.text, color: th.bg, borderRadius: 12, padding: '10px 14px', fontSize: 12.5, fontWeight: 600, boxShadow: th.shadow }}>
          <span style={{ flex: 1 }}>✓ {toast.label} encaissé</span>
          <button type="button" onClick={() => undoToast(toast)}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.accent, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, padding: 0 }}>Annuler</button>
        </div>
      )}
    </div>
  );
}
```

**Note :** `th.shadow` existe sur le thème (utilisé par la modale de la page actuelle). Si `tsc` râle sur `th.bgElev`/`th.shadow`, vérifier les noms dans `lib/theme.ts` (ils y sont : `bgElev` ligne ~50, `shadow` dans le type Th).

- [ ] **Step 4: Vérifier que les tests passent**

```bash
cd frontend && node node_modules/jest/bin/jest.js __tests__/CashRegister.test.tsx
```
Attendu : PASS (13 tests). Si le test toast est flaky sur les micro-tâches, remplacer les doubles `await Promise.resolve()` par `await act(async () => { await jest.advanceTimersByTimeAsync(0); })`.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/admin/caisse/CashRegister.tsx frontend/__tests__/CashRegister.test.tsx
git commit -m "feat(caisse): composant CashRegister (tuiles joueurs, selection, toast annuler)"
```

---

### Task 3: Composant `QueueList` (zone file)

**Files:**
- Create: `frontend/components/admin/caisse/QueueList.tsx`

Présentation pure, testée via la suite de la page (Task 4).

- [ ] **Step 1: Implémenter `frontend/components/admin/caisse/QueueList.tsx`**

```tsx
'use client';
import { CSSProperties } from 'react';
import { ClubReservation } from '@/lib/api';
import { fmtEuros, paymentDots } from '@/lib/caisse';
import { QueueEntry } from '@/lib/caisseRegister';
import { useTheme } from '@/lib/ThemeProvider';
import { PaymentDots, SETTLED_COLOR } from '@/components/admin/PaymentDots';

const CORAL = '#ff7a4d';

function fmtTime(iso: string): string { return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); }

export interface QueueListProps {
  toCollect: QueueEntry<ClubReservation>[];
  settled: QueueEntry<ClubReservation>[];
  playersOf: (r: ClubReservation) => number;
  selectedId: string | null;
  onSelect: (r: ClubReservation) => void;
}

/**
 * Zone « file » de la Caisse express : réservations à encaisser (chronologique)
 * puis soldées. Une ligne = heure · titulaire · terrain, pastilles, reste dû.
 */
export function QueueList({ toCollect, settled, playersOf, selectedId, onSelect }: QueueListProps) {
  const { th } = useTheme();

  const header = (label: string) => (
    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: th.textFaint, padding: '2px 4px', fontFamily: th.fontUI }}>{label}</div>
  );

  const row = (e: QueueEntry<ClubReservation>, done: boolean) => {
    const r = e.r;
    const who = r.title?.trim() ? r.title : r.user ? `${r.user.firstName} ${r.user.lastName}` : 'Événement';
    const sel = r.id === selectedId;
    const dots = paymentDots(r, playersOf(r), e.due);
    const st: CSSProperties = {
      display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
      background: th.surface, border: 'none', borderRadius: 12, padding: '10px 12px', cursor: 'pointer',
      boxShadow: sel ? `0 0 0 2px ${th.accent}` : `inset 0 0 0 1px ${th.line}`,
      opacity: done && !sel ? 0.65 : 1, fontFamily: th.fontUI,
    };
    return (
      <button key={r.id} type="button" onClick={() => onSelect(r)} aria-current={sel || undefined} style={st}>
        <span style={{ fontFamily: th.fontMono, fontSize: 13, fontWeight: 700, color: th.text, flexShrink: 0 }}>{fmtTime(r.startTime)}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: th.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{who}</span>
          <span style={{ display: 'block', fontSize: 11, color: th.textFaint }}>{r.resource.name}</span>
        </span>
        {dots && !done && <PaymentDots dots={dots} color={th.accent} />}
        {done
          ? <span style={{ fontSize: 12, fontWeight: 700, color: SETTLED_COLOR, whiteSpace: 'nowrap' }}>✓ Soldé</span>
          : <span style={{ fontSize: 13, fontWeight: 800, color: CORAL, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{fmtEuros(e.remaining)}</span>}
      </button>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {toCollect.length > 0 && header("À encaisser d'abord")}
      {toCollect.map((e) => row(e, false))}
      {settled.length > 0 && header('Soldées')}
      {settled.map((e) => row(e, true))}
      {toCollect.length === 0 && settled.length === 0 && (
        <div style={{ padding: '32px 12px', textAlign: 'center', fontFamily: th.fontUI, fontSize: 13, color: th.textFaint, background: th.surface, borderRadius: 14, boxShadow: `inset 0 0 0 1px ${th.line}` }}>Aucune réservation</div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Vérifier que ça compile**

```bash
cd frontend && node node_modules/typescript/bin/tsc --noEmit
```
Attendu : 0 erreur sur les fichiers `caisse*` / `QueueList` (ignorer les erreurs pré-existantes d'autres chantiers s'il y en a — scoper au grep : `tsc --noEmit 2>&1 | grep -i caisse` doit être vide, idem `QueueList`).

- [ ] **Step 3: Commit**

```bash
git add frontend/components/admin/caisse/QueueList.tsx
git commit -m "feat(caisse): composant QueueList (file a encaisser / soldees)"
```

---

### Task 4: Page `/admin/encaissement` + entrée de nav

**Files:**
- Create: `frontend/app/admin/encaissement/page.tsx`
- Modify: `frontend/app/admin/layout.tsx:101` (une ligne ajoutée)
- Test: `frontend/__tests__/AdminEncaissement.test.tsx`

La page reprend le squelette de `app/admin/reservations/page.tsx` (chargement 5 appels, filtres, KPI, optimisme, modales) et remplace la liste groupée par terrain par le split QueueList / CashRegister. **Différences clés vs la page actuelle :**
- `applyPaymentLocally` **renvoie** l'id synthétique (le CashRegister en a besoin pour le toast).
- État `selectedRvId` (résa affichée dans la caisse) distinct de `selected` (modale Détails).
- Desktop (`useIsDesktop(900)`) : split 2 colonnes, auto-sélection de la 1re résa à encaisser. Mobile : file pleine largeur, caisse en feuille plein écran, pas d'auto-sélection.
- `onSettled` : passe à la résa à encaisser suivante.

- [ ] **Step 1: Écrire les tests (qui échouent)**

Créer `frontend/__tests__/AdminEncaissement.test.tsx` :

```tsx
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import AdminEncaissementPage from '../app/admin/encaissement/page';
import { ThemeProvider } from '../lib/ThemeProvider';
import { api } from '../lib/api';

jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));
jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'club-1' } }) }));
jest.mock('../lib/useIsDesktop', () => ({ useIsDesktop: () => true }));
jest.mock('../lib/api', () => ({
  api: {
    adminGetClub: jest.fn().mockResolvedValue({ name: 'Club', address: 'X', timezone: 'Europe/Paris', offPeakHours: null, quickPaymentMethods: ['CARD', 'VOUCHER', 'CASH'] }),
    adminGetResources: jest.fn().mockResolvedValue([{ id: 'court-1', name: 'Padel int 1', attributes: {}, isActive: true, price: '52.00', offPeakPrice: null, openHour: 8, closeHour: 22, slotStepMin: null, clubSport: { id: 'cs', slotStepMin: null, durationsMin: [60], sport: { key: 'padel', name: 'Padel', resourceNoun: 'Terrain', defaultSlotStepMin: 30, defaultDurationsMin: [60], surfaces: [], hasLighting: false } } }]),
    adminGetMembers: jest.fn().mockResolvedValue([]),
    adminGetReservations: jest.fn(),
    adminGetActivePackages: jest.fn().mockResolvedValue([]),
    adminAddPayment: jest.fn().mockResolvedValue({ id: 'p-new' }),
    adminCancelReservation: jest.fn().mockResolvedValue({}),
    adminAssignReservationMember: jest.fn().mockResolvedValue({ id: 'rv-1' }),
    adminAddReservationParticipant: jest.fn().mockResolvedValue({ id: 'rv-1' }),
    adminCreateMember: jest.fn().mockResolvedValue({ tempPassword: null, existed: false }),
    adminGetMemberPackages: jest.fn().mockResolvedValue([]),
    refundPayment: jest.fn().mockResolvedValue({}),
  },
  assetUrl: (u: string | null) => u,
}));

Element.prototype.scrollIntoView = jest.fn();

const mkResa = (id: string, start: string, over: Record<string, unknown> = {}) => ({
  id, resourceId: 'court-1', startTime: start, endTime: start.replace('T16', 'T17'),
  status: 'CONFIRMED', type: 'COURT', title: null, totalPrice: '52.00', paidAmount: '0.00', dueAmount: '52.00',
  resource: { id: 'court-1', name: 'Padel int 1' },
  user: { id: 'u1', firstName: 'Jean', lastName: 'Dupont', email: 'j@x.fr' }, payments: [], participants: [], ...over,
});
const resp = (reservations: unknown[]) => ({ reservations, summary: { total: '0', paid: '0', paidTotal: '0', outstanding: '0' } });

const renderPage = () => render(<ThemeProvider><AdminEncaissementPage /></ThemeProvider>);

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([
    mkResa('rv-b', '2099-06-22T18:00:00.000Z'),
    mkResa('rv-a', '2099-06-22T16:00:00.000Z'),
    mkResa('rv-s', '2099-06-22T15:00:00.000Z', { paidAmount: '52.00', payments: [{ id: 'p1', amount: '52.00', method: 'CARD', participantId: null, payerName: null, note: null, voucherRef: null, voucherIssuer: null, voucherStatus: null, createdAt: '2099-06-22T14:00:00.000Z', refundedAmount: '0.00', receiptNo: null }] }),
  ]));
});

it('titre « Caisse express » + file en deux groupes triés (à encaisser par heure, soldées)', async () => {
  renderPage();
  expect(await screen.findByRole('heading', { name: 'Caisse express' })).toBeInTheDocument();
  expect(screen.getByText("À encaisser d'abord")).toBeInTheDocument();
  expect(screen.getByText('Soldées')).toBeInTheDocument();
  const queue = screen.getByTestId('cx-queue');
  const rows = within(queue).getAllByRole('button', { name: /Jean Dupont/ });
  expect(rows).toHaveLength(3);
  expect(rows[2]).toHaveTextContent('Soldé');   // la soldée en dernier
});

it('desktop : la première résa à encaisser est auto-sélectionnée dans la caisse', async () => {
  renderPage();
  const register = await screen.findByTestId('cx-register');
  expect(within(register).getByText(/16:00|17:00|18:00/)).toBeInTheDocument();
  // rv-a (16:00) est la première à encaisser → affichée dans la caisse
  expect(within(register).getByText(/Padel int 1/)).toBeInTheDocument();
});

it('clic sur une ligne de la file → la caisse affiche cette réservation', async () => {
  renderPage();
  const queue = await screen.findByTestId('cx-queue');
  const rows = within(queue).getAllByRole('button', { name: /Jean Dupont/ });
  fireEvent.click(rows[1]);   // rv-b (18:00)
  const register = screen.getByTestId('cx-register');
  await waitFor(() => expect(within(register).getByText(/18:00/)).toBeInTheDocument());
});

it('wiring encaissement : CB dans la caisse → adminAddPayment', async () => {
  renderPage();
  const register = await screen.findByTestId('cx-register');
  fireEvent.click(within(register).getByRole('button', { name: /CB/ }));
  await waitFor(() => expect(api.adminAddPayment).toHaveBeenCalledWith('club-1', 'rv-a',
    expect.objectContaining({ method: 'CARD', amount: 13 }), 'tok'));
});

it('recherche : masque les non-correspondants de la file', async () => {
  renderPage();
  await screen.findByTestId('cx-queue');
  fireEvent.change(screen.getByPlaceholderText(/Rechercher un client/i), { target: { value: 'zzz' } });
  expect(screen.getByText('Aucune réservation')).toBeInTheDocument();
});

it('annulées masquées de la file', async () => {
  (api.adminGetReservations as jest.Mock).mockResolvedValue(resp([
    mkResa('rv-x', '2099-06-22T16:00:00.000Z', { status: 'CANCELLED' }),
  ]));
  renderPage();
  expect(await screen.findByText('Aucune réservation')).toBeInTheDocument();
});

it('bandeau KPI présent (Encaissé / Reste / Total)', async () => {
  renderPage();
  await screen.findByTestId('cx-queue');
  expect(screen.getByText('Encaissé')).toBeInTheDocument();
  expect(screen.getByText('Reste')).toBeInTheDocument();
  expect(screen.getByText('Total')).toBeInTheDocument();
});

it('« Montant libre, reçu, historique » ouvre la modale Détails (CollectPanel)', async () => {
  renderPage();
  const register = await screen.findByTestId('cx-register');
  fireEvent.click(within(register).getByRole('button', { name: /Montant libre/ }));
  // la modale affiche le nom du terrain en titre display + le bandeau d'état
  expect(await screen.findByText('Reste à encaisser')).toBeInTheDocument();
});
```

- [ ] **Step 2: Vérifier que les tests échouent**

```bash
cd frontend && node node_modules/jest/bin/jest.js __tests__/AdminEncaissement.test.tsx
```
Attendu : FAIL — `Cannot find module '../app/admin/encaissement/page'`.

- [ ] **Step 3: Implémenter la page**

Créer `frontend/app/admin/encaissement/page.tsx`. Le squelette (imports, state, `load`, `reloadReservations`, `patchReservation`, `reloadPackages`, `onMutated`, `cancel`, dérivés `dueOf`/`playersOf`/`remainingOf`/`isCollectable`, `refreshSelected`, résolution des sports, prédicats de filtre, KPI, `filtersEl`, modales) **reprend `app/admin/reservations/page.tsx`** avec ces différences précises :

1. Nom du composant : `AdminEncaissementPage`. Clé localStorage sports : `palova:encaissement-sports:<clubId>` (identique — les deux pages partagent la préférence, voulu).
2. `applyPaymentLocally` **renvoie l'id** :
```tsx
  const applyPaymentLocally = useCallback((reservationId: string, intent: PaymentIntent): string => {
    const id = `opt:${(optSeq.current += 1)}`;
    const iso = new Date().toISOString();
    setData((cur) => (cur ? { ...cur, reservations: cur.reservations.map((r) => (r.id === reservationId ? applyOptimisticPayment(r, intent, id, iso) : r)) } : cur));
    return id;
  }, []);
```
3. Imports en plus / en moins :
```tsx
import { QueueList } from '@/components/admin/caisse/QueueList';
import { CashRegister } from '@/components/admin/caisse/CashRegister';
import { queueGroups } from '@/lib/caisseRegister';
import { useIsDesktop } from '@/lib/useIsDesktop';
// ReservationCollect et PaymentDots ne sont PAS importés (le renderRow terrain disparaît).
```
4. État de sélection de la caisse + auto-sélection desktop + saut à la suivante :
```tsx
  const isDesktop = useIsDesktop(900);
  const [selectedRvId, setSelectedRvId] = useState<string | null>(null);

  // File (sur les résas VISIBLES après filtres) — recalculée à chaque rendu.
  const groups = queueGroups(visible, dueOf);
  // La résa affichée dans la caisse : cherchée dans TOUTES les résas du jour (elle
  // peut sortir de `visible` après un filtre/encaissement sans casser la caisse).
  const currentRv = selectedRvId ? dayResas.find((r) => r.id === selectedRvId) ?? null : null;

  // Desktop : auto-sélection de la première résa à encaisser (jamais sur mobile).
  useEffect(() => {
    if (!isDesktop || loading || selectedRvId) return;
    const first = queueGroups(dayResas.filter((r) => r.status !== 'CANCELLED'), dueOf).toCollect[0];
    if (first) setSelectedRvId(first.r.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDesktop, loading, selectedRvId, data]);

  // Résa soldée (toast expiré) → prochaine à encaisser.
  const selectNextDue = useCallback(() => {
    setSelectedRvId((cur) => {
      const g = queueGroups((data?.reservations ?? []).filter((r) => r.status !== 'CANCELLED'), dueOf);
      const next = g.toCollect.find((e) => e.r.id !== cur);
      return next ? next.r.id : cur;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
```
   ⚠️ `dueOf` dépend de `resources`/`peak`/`tz` : le définir AVANT ces hooks (même ordre que la page actuelle).
5. Le rendu de la liste (l'ancien bloc `groups.map(...)` par terrain) est remplacé par le split :
```tsx
      {loading ? (
        <div style={{ padding: '32px 0', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>
      ) : (
        <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
          {/* ── zone 1 : la file ── */}
          <div data-testid="cx-queue" style={{ flex: isDesktop ? '0 0 340px' : 1, minWidth: 0 }}>
            <QueueList toCollect={groups.toCollect} settled={groups.settled} playersOf={playersOf}
              selectedId={selectedRvId} onSelect={(r) => setSelectedRvId(r.id)} />
          </div>
          {/* ── zone 2 : la caisse (desktop : colonne sticky) ── */}
          {isDesktop && (
            <div data-testid="cx-register" style={{ flex: 1, minWidth: 0, position: 'sticky', top: 12 }}>
              {currentRv ? (
                <CashRegister reservation={currentRv} players={playersOf(currentRv)} due={dueOf(currentRv)}
                  members={members} quickMethods={quickMethods} packagesByUser={packagesByUser}
                  clubId={clubId!} token={token!} isDesktop
                  onChanged={onMutated}
                  onOptimisticPay={(intent) => applyPaymentLocally(currentRv.id, intent)}
                  onOptimisticRefund={(ids) => applyRefundLocally(currentRv.id, ids)}
                  onOpenDetails={() => setSelected(currentRv)}
                  onCancel={() => setConfirmCancel(currentRv)}
                  onError={(m) => setError(m)} onSettled={selectNextDue} />
              ) : (
                <div style={{ padding: '48px 20px', textAlign: 'center', fontFamily: th.fontUI, fontSize: 13.5, color: th.textFaint, background: th.surface, borderRadius: 16, boxShadow: `inset 0 0 0 1px ${th.line}` }}>
                  Sélectionnez une réservation dans la file
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── mobile : caisse en feuille plein écran ── */}
      {!isDesktop && currentRv && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 40, background: th.bg, overflowY: 'auto', padding: '14px 14px 24px' }}>
          <button type="button" onClick={() => setSelectedRvId(null)}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.accent, fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600, padding: '4px 0 12px' }}>‹ Retour à la file</button>
          <div data-testid="cx-register-mobile">
            <CashRegister reservation={currentRv} players={playersOf(currentRv)} due={dueOf(currentRv)}
              members={members} quickMethods={quickMethods} packagesByUser={packagesByUser}
              clubId={clubId!} token={token!} isDesktop={false}
              onChanged={onMutated}
              onOptimisticPay={(intent) => applyPaymentLocally(currentRv.id, intent)}
              onOptimisticRefund={(ids) => applyRefundLocally(currentRv.id, ids)}
              onOpenDetails={() => setSelected(currentRv)}
              onCancel={() => setConfirmCancel(currentRv)}
              onError={(m) => setError(m)} />
          </div>
        </div>
      )}
```
6. Titre : `<h1 …>Caisse express</h1>`. Le KPI utilise `groups.toCollect.length` à la place de `groups.length` (compteur de terrains disparu) : sub du Total = `` `${kpiRows.length} résa` ``.
7. Les trois blocs modaux (`selected` → modale Détails avec `CollectPanel` + historique + `Receipt`, `receiptTarget`, `confirmCancel`) : **copier verbatim `app/admin/reservations/page.tsx:398-522`** (mêmes noms d'état, mêmes helpers `fmt`/`fmtTime`/`statusStyle`/`toCaissePayment`/`STATUS_LABEL`/`METHOD_LABEL`/`METHOD_ICON` repris en tête de fichier). Duplication assumée : la page actuelle doit rester intacte, et elle a vocation à disparaître après validation.

- [ ] **Step 4: Ajouter l'entrée de nav**

Dans `frontend/app/admin/layout.tsx`, section « Au quotidien » (ligne ~101), ajouter après l'entrée Encaissement :

```tsx
      { href: '/admin/reservations', label: 'Encaissement', icon: 'ticket' },
      { href: '/admin/encaissement', label: 'Caisse express', icon: 'card' },
```
(L'icône `card` existe dans `components/ui/Icon.tsx`.)

- [ ] **Step 5: Vérifier que les tests passent**

```bash
cd frontend && node node_modules/jest/bin/jest.js __tests__/AdminEncaissement.test.tsx
```
Attendu : PASS (8 tests).

- [ ] **Step 6: Non-régression des suites voisines**

```bash
cd frontend && node node_modules/jest/bin/jest.js __tests__/AdminReservations.test.tsx __tests__/AdminLayout.test.tsx __tests__/CollectPanel.test.tsx __tests__/caisse.test.ts __tests__/collect.test.ts
```
Attendu : PASS partout (la page actuelle est intouchée ; AdminLayout tolère l'entrée en plus — si un test y énumère les entrées de nav, ajouter « Caisse express » à la liste attendue).

- [ ] **Step 7: Commit**

```bash
git add frontend/app/admin/encaissement/page.tsx frontend/app/admin/layout.tsx frontend/__tests__/AdminEncaissement.test.tsx
git commit -m "feat(caisse): page /admin/encaissement - caisse express en deux zones"
```

---

### Task 5: Type-check, vérification visuelle, finalisation

- [ ] **Step 1: Type-check complet**

```bash
cd frontend && node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep -iE "caisse|encaissement|QueueList|CashRegister"
```
Attendu : aucune ligne (le type-gate est séparé de jest — ts-jest ne type-checke pas).

- [ ] **Step 2: Suites du chantier une dernière fois**

```bash
cd frontend && node node_modules/jest/bin/jest.js __tests__/caisseRegister.test.ts __tests__/CashRegister.test.tsx __tests__/AdminEncaissement.test.tsx
```
Attendu : PASS (33 tests).

- [ ] **Step 3: Vérification visuelle en local**

Démarrer la stack (`start.ps1` ou backend+frontend déjà lancés), se connecter en admin sur le club seedé (`padel-arena-paris`, `super@palova.fr`), ouvrir `/admin/encaissement` et vérifier : split desktop, auto-sélection, sélection multi + montant, encaissement CB optimiste, toast Annuler, thème sombre, largeur mobile (devtools). Utiliser la skill `verify` si disponible pour capturer clair/sombre + mobile/desktop.

- [ ] **Step 4: Commit final éventuel (ajustements visuels) puis récap**

```bash
git add -A && git commit -m "fix(caisse): ajustements visuels apres verification"
```
Ne committer que s'il y a eu des retouches. Terminer par la skill `superpowers:finishing-a-development-branch` (PR vers main).
