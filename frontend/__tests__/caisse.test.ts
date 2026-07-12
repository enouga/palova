import { toCents, remainingCents, centsToInput, centsToStr, fmtEuros, tariffCents, dueCents, quickAmounts, paymentDots, participantPastilles, popoverPosition, validatePaymentAmount, deriveSlots, applyOptimisticPayment, applyOptimisticRefund, isOptimisticId, hhmm, isSalePayment, trendSeries } from '@/lib/caisse';
import { playerCount } from '@/lib/courtType';
import type { ReservationType, ClubReservation } from '@/lib/api';

const TZ = 'Europe/Paris';

const resa = (over: Partial<{ type: ReservationType; totalPrice: string; paidAmount: string; payments: number; startTime: string; endTime: string }> = {}) => ({
  type: over.type ?? ('COURT' as ReservationType),
  totalPrice: over.totalPrice ?? '52.00',
  paidAmount: over.paidAmount ?? '0.00',
  // jeudi 11/06/2026, 16h-17h à Paris (UTC+2 en été)
  startTime: over.startTime ?? '2026-06-11T14:00:00.000Z',
  endTime: over.endTime ?? '2026-06-11T15:00:00.000Z',
  payments: Array.from({ length: over.payments ?? 0 }, (_, i) => ({ id: `pay-${i}` })),
});

describe('toCents', () => {
  it('parse les strings décimales API en centimes entiers', () => {
    expect(toCents('52.00')).toBe(5200);
    expect(toCents('13.5')).toBe(1350);
    expect(toCents(4.25)).toBe(425);
  });
  it('valeur invalide ou vide → 0', () => {
    expect(toCents('')).toBe(0);
    expect(toCents('abc')).toBe(0);
  });
});

describe('remainingCents', () => {
  it('reste dû = total - payé', () => {
    expect(remainingCents('52.00', '13.00')).toBe(3900);
  });
  it('jamais négatif (sur-payé)', () => {
    expect(remainingCents('52.00', '60.00')).toBe(0);
  });
});

describe('centsToInput', () => {
  it('formate sans zéros traînants pour un input number', () => {
    expect(centsToInput(1300)).toBe('13');
    expect(centsToInput(1350)).toBe('13.5');
    expect(centsToInput(425)).toBe('4.25');
    expect(centsToInput(0)).toBe('');
  });
});

describe('fmtEuros', () => {
  it('affiche en euros à la française', () => {
    expect(fmtEuros(1300)).toBe('13 €');
    expect(fmtEuros(1350)).toBe('13,50 €');
  });
});

describe('tariffCents', () => {
  // Prix AU CRÉNEAU : tarif creux ssi le créneau est entièrement en heures creuses,
  // la durée n'entre pas dans le prix (miroir de slotPriceCents backend).
  // 2026-06-11 est un jeudi (weekday 4) ; 14:00Z = 16h à Paris. Creuses 8h-17h le jeudi.
  const off = { 4: [{ start: 8, end: 17 }] };

  it('créneau entièrement creux : tarif réduit', () => {
    expect(tariffCents('2026-06-11T14:00:00Z', '2026-06-11T15:00:00Z', TZ, off, '52', '30')).toBe(3000);
  });
  it('heures pleines : plein tarif, durée sans effet (18h-19h30)', () => {
    expect(tariffCents('2026-06-11T16:00:00Z', '2026-06-11T17:30:00Z', TZ, off, '52', '30')).toBe(5200);
  });
  it('à cheval creuses/pleines (16h-18h) → plein tarif', () => {
    expect(tariffCents('2026-06-11T14:00:00Z', '2026-06-11T16:00:00Z', TZ, off, '52', '30')).toBe(5200);
  });
  it('pas de plages configurées → toujours plein tarif', () => {
    expect(tariffCents('2026-06-11T14:00:00Z', '2026-06-11T15:00:00Z', TZ, null, '52', '30')).toBe(5200);
  });
  it('pas de tarif heures creuses → plein tarif même en creuses', () => {
    expect(tariffCents('2026-06-11T14:00:00Z', '2026-06-11T15:00:00Z', TZ, off, '52', null)).toBe(5200);
  });
  it('plusieurs plages le même jour : entre deux plages = pleines', () => {
    const split = { 4: [{ start: 8, end: 12 }, { start: 14, end: 17 }] };
    expect(tariffCents('2026-06-11T08:00:00Z', '2026-06-11T09:00:00Z', TZ, split, '52', '30')).toBe(3000);  // 10h locale
    expect(tariffCents('2026-06-11T11:00:00Z', '2026-06-11T12:00:00Z', TZ, split, '52', '30')).toBe(5200);  // 13h locale
    expect(tariffCents('2026-06-11T13:00:00Z', '2026-06-11T14:00:00Z', TZ, split, '52', '30')).toBe(3000);  // 15h locale
  });
  it('précision à la minute : 9h30 creux, 9h15 à cheval → plein', () => {
    // Jeudi (weekday 4), creuses 9h30–12h00.
    const offMin = { 4: [{ start: 9, startMin: 30, end: 12, endMin: 0 }] };
    // 2026-06-11T07:30Z = 9h30 Paris → borne basse incluse → créneau creux
    expect(tariffCents('2026-06-11T07:30:00Z', '2026-06-11T08:30:00Z', TZ, offMin, '52', '30')).toBe(3000);
    // 2026-06-11T07:15Z = 9h15 Paris → 15 min pleines avant 9h30 → plein tarif
    expect(tariffCents('2026-06-11T07:15:00Z', '2026-06-11T08:15:00Z', TZ, offMin, '52', '30')).toBe(5200);
    // 2026-06-11T10:00Z = 12h00 Paris → borne haute exclue → plein
    expect(tariffCents('2026-06-11T10:00:00Z', '2026-06-11T11:00:00Z', TZ, offMin, '52', '30')).toBe(5200);
  });
  it('dimanche = weekday 7 (convention Luxon)', () => {
    // 2026-06-14 est un dimanche ; 10:00Z = 12h Paris, creuses 13h-24h → pleines à 12h.
    expect(tariffCents('2026-06-14T10:00:00Z', '2026-06-14T11:00:00Z', TZ, { 7: [{ start: 13, end: 24 }] }, '52', '30')).toBe(5200);
  });

  // Vecteurs PARTAGÉS avec backend/src/services/__tests__/pricing.test.ts (anti-drift).
  // Lundi 8 juin 2026 à Paris (UTC+2) ; creuses lundi 9h-12h et 14h-17h ; créneau 25 € / creux 18 €.
  describe('classe du créneau (miroir backend slotPriceCents)', () => {
    const OFF = { 1: [{ start: 9, end: 12 }, { start: 14, end: 17 }] };
    it('entièrement creux 9h-11h → 18 €, peu importe la durée', () => {
      expect(tariffCents('2026-06-08T07:00:00Z', '2026-06-08T09:00:00Z', TZ, OFF, '25', '18')).toBe(1800);
      expect(tariffCents('2026-06-08T07:00:00Z', '2026-06-08T08:00:00Z', TZ, OFF, '25', '18')).toBe(1800);
    });
    it('à cheval 16h-18h → plein tarif 25 €', () => {
      expect(tariffCents('2026-06-08T14:00:00Z', '2026-06-08T16:00:00Z', TZ, OFF, '25', '18')).toBe(2500);
    });
    it('franchissement de minuit : lundi 23h → mardi 1h (creuses lundi 22h-24h) → à cheval → plein', () => {
      expect(tariffCents('2026-06-08T21:00:00Z', '2026-06-08T23:00:00Z', TZ, { 1: [{ start: 22, end: 24 }] }, '25', '18')).toBe(2500);
    });
  });
});

describe('dueCents', () => {
  const courtRes = { price: '52', offPeakPrice: '30' };
  const off = { 4: [{ start: 8, end: 17 }] };

  it('prix de la résa quand il existe', () => {
    expect(dueCents(resa(), courtRes, off, TZ)).toBe(5200);
  });
  it('résa COURT sans prix → tarif du terrain (heures creuses)', () => {
    expect(dueCents(resa({ totalPrice: '0' }), courtRes, off, TZ)).toBe(3000);
  });
  it('résa non-COURT sans prix → 0 ; terrain inconnu → 0', () => {
    expect(dueCents(resa({ type: 'EVENT', totalPrice: '0' }), courtRes, off, TZ)).toBe(0);
    expect(dueCents(resa({ totalPrice: '0' }), undefined, off, TZ)).toBe(0);
  });
  it('dueAmount du backend prioritaire quand présent (source de vérité)', () => {
    expect(dueCents({ ...resa({ totalPrice: '0' }), dueAmount: '43.00' }, courtRes, off, TZ)).toBe(4300);
    expect(dueCents({ ...resa({ totalPrice: '52.00' }), dueAmount: '0.00' }, courtRes, off, TZ)).toBe(0);
  });
});

describe('quickAmounts', () => {
  it('rien payé sur un double 52 € → Total 52 et / joueur 13', () => {
    const chips = quickAmounts(5200, 0, 4);
    expect(chips.map((c) => c.key)).toEqual(['total', 'perPlayer']);
    expect(chips.find((c) => c.key === 'perPlayer')!.cents).toBe(1300);
  });
  it('paiement partiel → Reste en premier, Total (qui dépasserait le plafond) disparaît', () => {
    const chips = quickAmounts(5200, 1300, 4);
    expect(chips.map((c) => c.key)).toEqual(['remaining', 'perPlayer']);
    expect(chips[0].cents).toBe(3900);
  });
  it('la part / joueur qui dépasse le reste dû disparaît', () => {
    expect(quickAmounts(5200, 4500, 4).map((c) => c.key)).toEqual(['remaining']);
  });
  it('la part / joueur égale au reste dû est dédupliquée', () => {
    expect(quickAmounts(5200, 3900, 4).map((c) => c.key)).toEqual(['remaining']);
  });
  it('terrain single → prix / 2 ; arrondi au centime (17 € / 4)', () => {
    expect(quickAmounts(1800, 0, 2).find((c) => c.key === 'perPlayer')!.cents).toBe(900);
    expect(quickAmounts(1700, 0, 4).find((c) => c.key === 'perPlayer')!.cents).toBe(425);
  });
  it('soldé ou gratuit → aucune chip', () => {
    expect(quickAmounts(5200, 5200, 4)).toEqual([]);
    expect(quickAmounts(0, 0, 4)).toEqual([]);
  });
  it('libellés en euros lisibles', () => {
    const chips = quickAmounts(1700, 0, 4);
    expect(chips.find((c) => c.key === 'total')!.label).toBe('Total 17 €');
    expect(chips.find((c) => c.key === 'perPlayer')!.label).toBe('/ joueur 4,25 €');
  });
});

describe('paymentDots', () => {
  it('2 paiements sur 4 places → 2 pleines, pas soldé', () => {
    expect(paymentDots(resa({ paidAmount: '26.00', payments: 2 }), 4, 5200))
      .toEqual({ filled: 2, slots: 4, overflow: 0, settled: false });
  });
  it('soldé → settled true même avec moins de paiements que de places', () => {
    expect(paymentDots(resa({ paidAmount: '52.00', payments: 1 }), 4, 5200))
      .toEqual({ filled: 1, slots: 4, overflow: 0, settled: true });
  });
  it('plus de paiements que de places → cap + overflow', () => {
    expect(paymentDots(resa({ paidAmount: '52.00', payments: 5 }), 4, 5200))
      .toEqual({ filled: 4, slots: 4, overflow: 1, settled: true });
  });
  it('résa sans prix mais avec tarif déduit → pastilles sur le dû', () => {
    expect(paymentDots(resa({ totalPrice: '0', paidAmount: '30.00', payments: 1 }), 4, 3000))
      .toEqual({ filled: 1, slots: 4, overflow: 0, settled: true });
  });
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

  it("la part réglée d'un joueur est verte même si la résa entière ne l'est pas", () => {
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
  it('single → 2, double ou inconnu → 4', () => {
    expect(playerCount('single')).toBe(2);
    expect(playerCount('double')).toBe(4);
    expect(playerCount(undefined)).toBe(4);
  });
});

describe('validatePaymentAmount', () => {
  it('refuse 0, négatif, NaN', () => {
    expect(validatePaymentAmount(0, 1000)).toBe(false);
    expect(validatePaymentAmount(-5, 1000)).toBe(false);
    expect(validatePaymentAmount(NaN, 1000)).toBe(false);
  });
  it('accepte un montant dans le reste dû', () => {
    expect(validatePaymentAmount(1000, 1000)).toBe(true);
    expect(validatePaymentAmount(500, 1000)).toBe(true);
  });
  it('refuse un dépassement du reste dû', () => {
    expect(validatePaymentAmount(1001, 1000)).toBe(false);
  });
  it('autorise tout montant > 0 si le reste dû est inconnu (0 = pas de plafond)', () => {
    expect(validatePaymentAmount(5000, 0)).toBe(true);
  });
});

describe('deriveSlots', () => {
  const part = (id: string, first: string, last: string, over: Partial<{ isOrganizer: boolean; paid: string; share: string; outstanding: string }> = {}) => ({
    id, userId: 'u-' + id, isOrganizer: over.isOrganizer ?? false, firstName: first, lastName: last,
    paid: over.paid ?? '0.00', share: over.share ?? '13.00', outstanding: over.outstanding ?? '13.00',
  });

  it('double (cap 4) avec 2 participants → 2 places joueur + 2 places vides indexées', () => {
    const slots = deriveSlots({ id: 'r1', user: { firstName: 'Jean', lastName: 'Test' }, participants: [part('p1', 'Jean', 'Test', { isOrganizer: true }), part('p2', 'Léa', 'Roy')] }, 4);
    expect(slots.map((s) => s.kind)).toEqual(['participant', 'participant', 'empty', 'empty']);
    expect(slots[0]).toMatchObject({ kind: 'participant', participantId: 'p1', seed: 'p1', firstName: 'Jean', outstandingCents: 1300 });
    expect(slots.filter((s) => s.kind === 'empty').map((s: any) => s.index)).toEqual([0, 1]);
  });

  it('single (cap 2) → 2 places au total', () => {
    const slots = deriveSlots({ id: 'r1', user: { firstName: 'Jean', lastName: 'Test' }, participants: [part('p1', 'Jean', 'Test')] }, 2);
    expect(slots).toHaveLength(2);
    expect(slots.map((s) => s.kind)).toEqual(['participant', 'empty']);
  });

  it('holder sans participants → 1 place holder + (cap-1) vides', () => {
    const slots = deriveSlots({ id: 'r1', user: { firstName: 'Jean', lastName: 'Test' }, participants: [] }, 4);
    expect(slots[0]).toMatchObject({ kind: 'holder', seed: 'holder:r1', firstName: 'Jean', lastName: 'Test' });
    expect(slots.filter((s) => s.kind === 'empty')).toHaveLength(3);
  });

  it('ni holder ni participant → cap places vides', () => {
    const slots = deriveSlots({ id: 'r1', user: null, participants: [] }, 4);
    expect(slots.map((s) => s.kind)).toEqual(['empty', 'empty', 'empty', 'empty']);
  });
});

describe('encaissement optimiste', () => {
  const bill = (id: string, over: Partial<{ paid: string; share: string; outstanding: string; isOrganizer: boolean }> = {}) => ({
    id, userId: 'u-' + id, isOrganizer: over.isOrganizer ?? false, firstName: 'P', lastName: id,
    share: over.share ?? '6.25', paid: over.paid ?? '0.00', outstanding: over.outstanding ?? '6.25',
  });
  const rv = (over: Partial<ClubReservation> = {}): ClubReservation => ({
    id: 'r1', resourceId: 'court-1', startTime: '2026-06-24T07:30:00.000Z', endTime: '2026-06-24T09:00:00.000Z',
    status: 'CONFIRMED', type: 'COURT', title: null, totalPrice: '25.00', paidAmount: '0.00', dueAmount: '25.00',
    resource: { id: 'court-1', name: 'C1' }, user: { id: 'u1', firstName: 'Jean', lastName: 'Dupont', email: 'j@x.fr' },
    payments: [], participants: [bill('p1', { isOrganizer: true }), bill('p2'), bill('p3'), bill('p4')], ...over,
  });

  it('isOptimisticId reconnaît les ids locaux', () => {
    expect(isOptimisticId('opt:3')).toBe(true);
    expect(isOptimisticId('cmqr...real')).toBe(false);
  });

  it('paiement ciblé sur un joueur : sa part réglée + paidAmount + paiement synthétique', () => {
    const out = applyOptimisticPayment(rv(), { amountCents: 625, method: 'CARD', participantId: 'p2' }, 'opt:1', '2026-06-24T08:00:00.000Z');
    expect(out.paidAmount).toBe('6.25');
    const p2 = out.participants.find((p) => p.id === 'p2')!;
    expect(p2.paid).toBe('6.25');
    expect(p2.outstanding).toBe('0.00');
    expect(out.participants.find((p) => p.id === 'p1')!.outstanding).toBe('6.25'); // inchangé
    const synth = out.payments.at(-1)!;
    expect(synth).toMatchObject({ id: 'opt:1', amount: '6.25', method: 'CARD', participantId: 'p2', refundedAmount: '0.00' });
  });

  it('paiement anonyme (sans participantId) : seulement paidAmount + paiement synthétique', () => {
    const out = applyOptimisticPayment(rv(), { amountCents: 625, method: 'VOUCHER' }, 'opt:2', '2026-06-24T08:00:00.000Z');
    expect(out.paidAmount).toBe('6.25');
    expect(out.participants.every((p) => p.paid === '0.00')).toBe(true);
    expect(out.payments.at(-1)).toMatchObject({ id: 'opt:2', participantId: null, method: 'VOUCHER' });
  });

  it('n’est pas mutatif (la réservation source reste intacte)', () => {
    const src = rv();
    applyOptimisticPayment(src, { amountCents: 625, method: 'CARD', participantId: 'p2' }, 'opt:1', 'now');
    expect(src.paidAmount).toBe('0.00');
    expect(src.payments).toHaveLength(0);
  });

  it('remboursement optimiste : rembourse le paiement, réduit paidAmount, recrédite le joueur', () => {
    const base = applyOptimisticPayment(rv(), { amountCents: 625, method: 'CARD', participantId: 'p2' }, 'real-1', 'now');
    const out = applyOptimisticRefund(base, ['real-1']);
    expect(out.paidAmount).toBe('0.00');
    const p2 = out.participants.find((p) => p.id === 'p2')!;
    expect(p2.paid).toBe('0.00');
    expect(p2.outstanding).toBe('6.25');
    expect(out.payments.find((p) => p.id === 'real-1')!.refundedAmount).toBe('6.25');
  });

  it('remboursement : un paiement déjà remboursé n’est pas re-décompté', () => {
    const base = applyOptimisticPayment(rv(), { amountCents: 625, method: 'CARD', participantId: 'p2' }, 'real-1', 'now');
    const once = applyOptimisticRefund(base, ['real-1']);
    const twice = applyOptimisticRefund(once, ['real-1']);
    expect(twice.paidAmount).toBe('0.00');                 // pas négatif
    expect(twice.participants.find((p) => p.id === 'p2')!.outstanding).toBe('6.25');
  });

  it('centsToStr formate en string décimale API', () => {
    expect(centsToStr(625)).toBe('6.25');
    expect(centsToStr(0)).toBe('0.00');
    expect(centsToStr(2500)).toBe('25.00');
  });
});

describe('hhmm', () => {
  it('heure locale du club au format HH:MM (été Paris = UTC+2)', () => {
    expect(hhmm('2026-07-10T16:04:00.000Z', 'Europe/Paris')).toBe('18:04');
  });
});

describe('isSalePayment', () => {
  it('vente = paiement sans réservation liée (carnet/abo/recharge)', () => {
    expect(isSalePayment({ reservation: null })).toBe(true);
    expect(isSalePayment({ reservation: { id: 'rv-1' } })).toBe(false);
  });
});

describe('trendSeries', () => {
  const byDay = [
    { date: '2026-07-03', net: '10.00' },
    { date: '2026-07-08', net: '30.00' },
    { date: '2026-07-10', net: '20.00' },
  ];
  it('renvoie 7 points finissant à endKey, jours manquants comblés à 0', () => {
    const t = trendSeries(byDay, '2026-07-10');
    expect(t.points.map((p) => p.key)).toEqual([
      '2026-07-04', '2026-07-05', '2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10',
    ]);
    expect(t.points.map((p) => p.cents)).toEqual([0, 0, 0, 0, 3000, 0, 2000]);
  });
  it('compare au même jour de semaine S-1 (J-7)', () => {
    const t = trendSeries(byDay, '2026-07-10');
    expect(t.todayCents).toBe(2000);
    expect(t.prevWeekCents).toBe(1000);
    expect(t.deltaPct).toBe(100);
  });
  it('deltaPct null quand la semaine précédente est à 0 (pas de division)', () => {
    const t = trendSeries([{ date: '2026-07-10', net: '20.00' }], '2026-07-10');
    expect(t.prevWeekCents).toBe(0);
    expect(t.deltaPct).toBeNull();
  });
});
