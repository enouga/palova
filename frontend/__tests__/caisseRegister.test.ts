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
  it('classé par ordre des ressources (puis par heure) quand resourceRank est fourni', () => {
    const rows = [
      entry('a', '2099-06-22T16:00:00.000Z', '0.00', { resourceId: 'court-2' }),
      entry('b', '2099-06-22T15:00:00.000Z', '0.00', { resourceId: 'court-1' }),
      entry('c', '2099-06-22T17:00:00.000Z', '0.00', { resourceId: 'court-1' }),
    ];
    const rank = (id: string) => (({ 'court-1': 0, 'court-2': 1 }) as Record<string, number>)[id] ?? 99;
    const g = queueGroups(rows, dueOf, rank);
    // court-1 d'abord (b avant c par heure), puis court-2 (a)
    expect(g.toCollect.map((e) => e.r.id)).toEqual(['b', 'c', 'a']);
  });
});
