import type { OffPeakHours, OffPeakRange, ReservationType, PaymentMethod, ClubReservation, Payment } from '@/lib/api';
import { addDaysKey } from '@/lib/calendar';

// Helpers purs de la caisse du planning. Tous les calculs se font en centimes
// (entiers) : les montants API sont des strings décimales ("52.00") et la
// division d'un prix par joueur ne doit jamais passer par des flottants.

/** Parse une string décimale API ("52.00") en centimes (entier). Invalide → 0. */
export function toCents(v: string | number): number {
  const n = Math.round(Number(v) * 100);
  return Number.isFinite(n) ? n : 0;
}

/** Reste dû en centimes (jamais négatif). */
export function remainingCents(totalPrice: string, paidAmount: string): number {
  return Math.max(0, toCents(totalPrice) - toCents(paidAmount));
}

/** Centimes → valeur pour un <input type=number> : "13", "13.5", "4.25" ; 0 → "". */
export function centsToInput(cents: number): string {
  return cents > 0 ? String(cents / 100) : '';
}

/** Centimes → string décimale API ("625" → "6.25"). */
export function centsToStr(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Centimes → affichage "13 €" / "13,50 €". */
export function fmtEuros(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const rem = abs % 100;
  const euros = (abs - rem) / 100;
  return rem === 0 ? `${sign}${euros} €` : `${sign}${euros},${String(rem).padStart(2, '0')} €`;
}

// Convention Luxon (comme le backend) : 1 = lundi … 7 = dimanche.
const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

function localWeekdayHour(iso: string, tz: string): { weekday: number; hour: number; minute: number } {
  const d = new Date(iso);
  const wd = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: tz }).format(d);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: tz }).format(d));
  const minute = Number(new Intl.DateTimeFormat('en-GB', { minute: '2-digit', timeZone: tz }).format(d));
  return { weekday: WEEKDAY[wd] ?? 1, hour, minute };
}

function rMin(r: OffPeakRange): { s: number; e: number } {
  return { s: r.start * 60 + (r.startMin ?? 0), e: r.end * 60 + (r.endMin ?? 0) };
}

/**
 * Minutes creuses / pleines d'un créneau — walker en minutes RÉELLES qui relit
 * l'heure locale à chaque borne de plage (minuit et changement de jour gérés).
 * Miroir de `splitOffPeakMinutes` dans backend/src/services/pricing.ts —
 * mêmes vecteurs de test des deux côtés.
 */
function splitOffPeakMinutes(
  off: OffPeakHours | null | undefined,
  startMs: number,
  endMs: number,
  tz: string,
): { offPeakMin: number; peakMin: number } {
  let offPeakMin = 0;
  let peakMin = 0;
  let cursorMs = startMs;
  while (cursorMs < endMs) {
    const { weekday, hour, minute } = localWeekdayHour(new Date(cursorMs).toISOString(), tz);
    const t = hour * 60 + minute;
    const ranges = off?.[weekday] ?? [];
    const offPeak = ranges.some((r) => { const { s, e } = rMin(r); return t >= s && t < e; });
    let next = 1440; // prochaine borne de plage strictement après t, sinon minuit
    for (const r of ranges) {
      const { s, e } = rMin(r);
      if (s > t && s < next) next = s;
      if (e > t && e < next) next = e;
    }
    const remainMin = Math.ceil((endMs - cursorMs) / 60_000);
    const segMin = Math.max(1, Math.min(next - t, remainMin));
    if (offPeak) offPeakMin += segMin; else peakMin += segMin;
    cursorMs += segMin * 60_000;
  }
  return { offPeakMin, peakMin };
}

/**
 * Prix du terrain pour un créneau, en centimes : tarif creux si le créneau est
 * ENTIÈREMENT en heures creuses (et qu'un tarif creux existe), sinon tarif
 * plein. La durée n'entre pas dans le prix — miroir de `slotPriceCents` backend.
 */
export function tariffCents(
  startISO: string,
  endISO: string,
  tz: string,
  off: OffPeakHours | null | undefined,
  price: string,
  offPeakPrice: string | null,
): number {
  const priceCents = toCents(price);
  if (offPeakPrice == null) return priceCents;
  const { peakMin } = splitOffPeakMinutes(off, new Date(startISO).getTime(), new Date(endISO).getTime(), tz);
  return peakMin === 0 ? toCents(offPeakPrice) : priceCents;
}

/**
 * Montant dû d'une réservation, en centimes. Le `dueAmount` calculé par le
 * backend (source de vérité) est prioritaire quand présent ; sinon repli
 * local : prix de la résa s'il existe, sinon tarif du terrain pour un créneau
 * COURT (0 pour le reste — événements libres). C'est aussi le plafond
 * d'encaissement (même règle que le backend).
 */
export function dueCents(
  rv: { type: ReservationType; totalPrice: string; startTime: string; endTime: string; dueAmount?: string },
  resource: { price: string; offPeakPrice: string | null } | undefined,
  off: OffPeakHours | null | undefined,
  tz: string,
): number {
  if (rv.dueAmount != null) return toCents(rv.dueAmount);
  const total = toCents(rv.totalPrice);
  if (total > 0) return total;
  if (rv.type !== 'COURT' || !resource) return 0;
  return tariffCents(rv.startTime, rv.endTime, tz, off, resource.price, resource.offPeakPrice);
}

export interface QuickAmount {
  key: 'remaining' | 'total' | 'perPlayer';
  label: string;
  cents: number;
}

/**
 * Chips de préremplissage du montant à encaisser, plafonnées au reste dû :
 * « Total » tant que rien n'est payé, « Reste » ensuite, « / joueur » (dû ÷ nb
 * joueurs, arrondi au centime) tant que la part tient dans le reste.
 */
export function quickAmounts(due: number, paid: number, players: number): QuickAmount[] {
  if (due <= 0) return [];
  const remaining = Math.max(0, due - paid);
  if (remaining <= 0) return [];
  const chips: QuickAmount[] = [];
  if (remaining < due) chips.push({ key: 'remaining', label: `Reste ${fmtEuros(remaining)}`, cents: remaining });
  else chips.push({ key: 'total', label: `Total ${fmtEuros(due)}`, cents: due });
  if (players > 1) {
    const per = Math.round(due / players);
    if (per < remaining) chips.push({ key: 'perPlayer', label: `/ joueur ${fmtEuros(per)}`, cents: per });
  }
  return chips;
}

export interface PaymentDotsModel {
  filled: number;
  slots: number;
  overflow: number;
  settled: boolean;
}

/**
 * Modèle des pastilles de paiement d'un bloc du planning : 1 point plein par
 * paiement enregistré, `slots` = nb de joueurs du terrain, soldé quand le
 * payé couvre le dû. `null` si non applicable (pas un créneau COURT payant).
 */
export function paymentDots(
  rv: { type: ReservationType; paidAmount: string; payments: ReadonlyArray<unknown> },
  players: number,
  due: number,
): PaymentDotsModel | null {
  if (rv.type !== 'COURT' || due <= 0) return null;
  const count = rv.payments.length;
  return {
    filled: Math.min(count, players),
    slots: players,
    overflow: Math.max(0, count - players),
    settled: toCents(rv.paidAmount) >= due,
  };
}

/**
 * Le montant (centimes) à encaisser est-il valide ? > 0 et, si un plafond
 * `remainingCents` est fourni (> 0), n'excède pas le reste dû. `remainingCents`
 * = 0 → pas de plafond (événement libre).
 */
export function validatePaymentAmount(cents: number, remainingCents: number): boolean {
  if (!Number.isFinite(cents) || cents <= 0) return false;
  if (remainingCents > 0 && cents > remainingCents) return false;
  return true;
}

// ── Encaissement par joueur ───────────────────────────────────────────────

/** Moyens d'encaissement rapides éligibles aux boutons 1 clic (miroir backend QUICK_PAYMENT_METHODS). */
export const QUICK_METHODS: PaymentMethod[] = ['CASH', 'CARD', 'VOUCHER', 'TRANSFER', 'MEMBER'];

/** Repli si le club n'a configuré AUCUN moyen rapide (miroir du défaut de la migration `add_quick_payment_methods`). */
export const DEFAULT_QUICK_METHODS: PaymentMethod[] = ['CARD', 'VOUCHER', 'CASH'];

/** Libellé court des moyens rapides (sans icône — l'UI ajoute l'icône). */
export const QUICK_METHOD_LABEL: Record<string, string> = {
  CASH: 'Espèces', CARD: 'CB', VOUCHER: 'Ticket CE', TRANSFER: 'Virement', MEMBER: 'Abo / Membre',
};

/** Une place de la réservation : un joueur (participant), le titulaire seul, ou une place libre. */
export type SlotEntry =
  | { kind: 'participant'; participantId: string; seed: string; firstName: string; lastName: string; isOrganizer: boolean; paidCents: number; shareCents: number; outstandingCents: number }
  | { kind: 'holder'; seed: string; firstName: string; lastName: string }
  | { kind: 'empty'; index: number };

/**
 * Places d'une réservation (capacité = nb de joueurs du terrain). Les places
 * remplies viennent des participants ; à défaut, le titulaire occupe 1 place
 * (« holder »). Les places restantes sont vides (associables), indexées.
 */
export function deriveSlots(
  r: {
    id: string;
    user: { firstName: string; lastName: string } | null;
    participants: { id: string; isOrganizer: boolean; firstName: string; lastName: string; paid: string; share: string; outstanding: string }[];
  },
  capacity: number,
): SlotEntry[] {
  const slots: SlotEntry[] = [];
  const parts = r.participants ?? [];
  if (parts.length > 0) {
    for (const p of parts) {
      slots.push({
        kind: 'participant', participantId: p.id, seed: p.id, firstName: p.firstName, lastName: p.lastName,
        isOrganizer: p.isOrganizer, paidCents: toCents(p.paid), shareCents: toCents(p.share), outstandingCents: toCents(p.outstanding),
      });
    }
  } else if (r.user) {
    slots.push({ kind: 'holder', seed: `holder:${r.id}`, firstName: r.user.firstName, lastName: r.user.lastName });
  }
  let emptyIdx = 0;
  while (slots.length < capacity) slots.push({ kind: 'empty', index: emptyIdx++ });
  return slots;
}

// ── Encaissement optimiste ─────────────────────────────────────────────────
// Le comptoir doit réagir AU CLIC, sans attendre l'aller-retour réseau. On
// applique le paiement (ou le remboursement) localement tout de suite, puis on
// réconcilie avec le serveur via un rechargement. Helpers PURS, testés.

/** Préfixe des paiements créés localement (optimistes) — pas encore persistés. */
export const OPTIMISTIC_PREFIX = 'opt:';
export function isOptimisticId(id: string): boolean { return id.startsWith(OPTIMISTIC_PREFIX); }

/** Intention d'encaissement : montant (centimes), moyen, et joueur ciblé éventuel. */
export interface PaymentIntent {
  amountCents: number;
  method: PaymentMethod;
  participantId?: string | null;
}

/**
 * Applique un encaissement à une réservation SANS appel réseau (mise à jour
 * optimiste) : ajoute un paiement synthétique, augmente `paidAmount`, et — si
 * ciblé sur un joueur — son `paid`/`outstanding`. À réconcilier ensuite avec le
 * serveur (qui remplacera ce paiement synthétique par le vrai).
 */
export function applyOptimisticPayment(
  rv: ClubReservation,
  intent: PaymentIntent,
  syntheticId: string,
  createdAtIso: string,
): ClubReservation {
  const { amountCents, method, participantId } = intent;
  const synthetic: Payment = {
    id: syntheticId,
    amount: centsToStr(amountCents),
    method,
    participantId: participantId ?? null,
    payerName: null, note: null, voucherRef: null, voucherIssuer: null, voucherStatus: null,
    createdAt: createdAtIso, refundedAmount: '0.00', receiptNo: null,
  };
  const participants = rv.participants.map((p) =>
    participantId && p.id === participantId
      ? { ...p, paid: centsToStr(toCents(p.paid) + amountCents), outstanding: centsToStr(Math.max(0, toCents(p.outstanding) - amountCents)) }
      : p);
  return {
    ...rv,
    paidAmount: centsToStr(toCents(rv.paidAmount) + amountCents),
    participants,
    payments: [...rv.payments, synthetic],
  };
}

/**
 * Annule (rembourse intégralement) des paiements d'une réservation SANS appel
 * réseau : marque `refundedAmount = amount` pour les ids fournis, réduit
 * `paidAmount` et recrédite le reste dû des joueurs concernés. À réconcilier.
 */
export function applyOptimisticRefund(rv: ClubReservation, paymentIds: string[]): ClubReservation {
  const ids = new Set(paymentIds);
  let refundedTotal = 0;
  const backByParticipant: Record<string, number> = {};
  const payments = rv.payments.map((p) => {
    if (!ids.has(p.id)) return p;
    const rem = toCents(p.amount) - toCents(p.refundedAmount ?? '0');
    if (rem <= 0) return p;
    refundedTotal += rem;
    if (p.participantId) backByParticipant[p.participantId] = (backByParticipant[p.participantId] ?? 0) + rem;
    return { ...p, refundedAmount: centsToStr(toCents(p.refundedAmount ?? '0') + rem) };
  });
  const participants = rv.participants.map((p) => {
    const back = backByParticipant[p.id] ?? 0;
    return back
      ? { ...p, paid: centsToStr(Math.max(0, toCents(p.paid) - back)), outstanding: centsToStr(toCents(p.outstanding) + back) }
      : p;
  });
  return { ...rv, paidAmount: centsToStr(Math.max(0, toCents(rv.paidAmount) - refundedTotal)), payments, participants };
}

// ── Ventes & journée : heure locale, ventes, tendance ─────────────────────────

/** ISO → "HH:MM" au fuseau donné (24 h). */
export function hhmm(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz })
    .format(new Date(iso));
}

/** Une « vente » = un encaissement SANS réservation liée (carnet, abo, recharge, libre). */
export function isSalePayment(p: { reservation: unknown | null }): boolean {
  return p.reservation == null;
}

export interface TrendPoint { key: string; cents: number }
export interface TrendModel {
  /** 7 points, de endKey-6 à endKey inclus (net encaissé/jour en centimes). */
  points: TrendPoint[];
  todayCents: number;
  prevWeekCents: number;
  /** Variation % vs le même jour de semaine S-1 ; null si S-1 = 0 (pas de division). */
  deltaPct: number | null;
}

/**
 * Série de tendance sur 7 jours (fuseau déjà appliqué en amont : `byDay` vient de
 * `adminAccountingSummary`, dont les clés jour sont au fuseau du club). Comble les
 * jours absents à 0 et compare endKey au même jour de semaine 7 jours plus tôt.
 */
export function trendSeries(byDay: { date: string; net: string }[], endKey: string): TrendModel {
  const map = new Map<string, number>();
  for (const d of byDay) map.set(d.date, toCents(d.net));
  const points: TrendPoint[] = [];
  for (let i = 6; i >= 0; i--) {
    const key = addDaysKey(endKey, -i);
    points.push({ key, cents: map.get(key) ?? 0 });
  }
  const todayCents = map.get(endKey) ?? 0;
  const prevWeekCents = map.get(addDaysKey(endKey, -7)) ?? 0;
  const deltaPct = prevWeekCents === 0 ? null : Math.round(((todayCents - prevWeekCents) / prevWeekCents) * 100);
  return { points, todayCents, prevWeekCents, deltaPct };
}
