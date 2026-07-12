import type { ClubReservation, Payment, PaymentMethod, ReservationType } from '@/lib/api';
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

export type RegisterReservation = Pick<ClubReservation, 'id' | 'user' | 'participants' | 'payments' | 'paidAmount'>;

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

export interface PastilleSeat {
  seed: string;
  initials: string;
  name: string;
  paid: boolean;
  paidCents: number;
  outstandingCents: number;
}

export interface PastillesModel {
  /** Une entrée par place (capacité du terrain) ; `null` = place vide (non couverte). */
  seats: (PastilleSeat | null)[];
  settled: boolean;
  totalPaidCents: number;
  totalDueCents: number;
}

/**
 * Modèle des pastilles-initiales de paiement d'un bloc du planning : une
 * pastille par place, dérivée de `slotStatuses` — donc couvre aussi bien les
 * participants nommés que les places génériques (titulaire seul, ou réglées
 * par un paiement anonyme au comptoir), qui sont vertes dès qu'elles sont
 * couvertes même sans identité. Une place reste grise pointillée seulement
 * si elle n'est ni nommée ni couverte par un paiement. `null` si non
 * applicable (pas un créneau COURT payant) — miroir de `paymentDots`.
 */
export function participantPastilles(
  rv: RegisterReservation & { type: ReservationType },
  players: number,
  due: number,
): PastillesModel | null {
  if (rv.type !== 'COURT' || due <= 0) return null;
  const totalPaidCents = toCents(rv.paidAmount);
  const settled = totalPaidCents >= due;
  const capShare = players > 0 ? Math.round(due / players) : due;
  const seats: (PastilleSeat | null)[] = slotStatuses(rv, players, due).map((st) => {
    const s = st.slot;
    if (s.kind === 'empty') {
      if (!st.paid) return null;
      return { seed: `anon:${s.index}`, initials: '', name: `Joueur ${s.index + 1}`, paid: true, paidCents: capShare, outstandingCents: 0 };
    }
    return {
      seed: s.seed,
      initials: `${s.firstName[0] ?? ''}${s.lastName[0] ?? ''}`.toUpperCase(),
      name: `${s.firstName} ${s.lastName}`.trim(),
      paid: st.paid,
      paidCents: s.kind === 'participant' ? s.paidCents : (st.paid ? capShare : 0),
      outstandingCents: st.amountCents,
    };
  });
  return { seats, settled, totalPaidCents, totalDueCents: due };
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
 * Groupes de la file : « à encaisser » (reste dû > 0) puis « soldées » (réglées ou dû nul).
 * Les annulées sont exclues. Ordre : par **rang de ressource** (ordre des terrains) si
 * `resourceRank` est fourni, puis par heure de début ; sinon par heure de début seule.
 */
export function queueGroups<R extends { status: string; startTime: string; paidAmount: string; resourceId?: string }>(
  reservations: R[],
  dueOf: (r: R) => number,
  resourceRank?: (resourceId: string) => number,
): { toCollect: QueueEntry<R>[]; settled: QueueEntry<R>[] } {
  const entries = reservations
    .filter((r) => r.status !== 'CANCELLED')
    .map((r) => {
      const due = dueOf(r);
      return { r, due, remaining: Math.max(0, due - toCents(r.paidAmount)) };
    });
  const rankOf = (e: QueueEntry<R>) =>
    resourceRank && e.r.resourceId != null ? resourceRank(e.r.resourceId) : 0;
  const cmp = (a: QueueEntry<R>, b: QueueEntry<R>) =>
    (rankOf(a) - rankOf(b)) || a.r.startTime.localeCompare(b.r.startTime);
  return {
    toCollect: entries.filter((e) => e.remaining > 0).sort(cmp),
    settled: entries.filter((e) => e.remaining <= 0).sort(cmp),
  };
}
