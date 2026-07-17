import { MyReservation, MyQuotaStatus } from './api';

/** Vrai tant qu'on est à plus de `cutoffHours` du début. cutoff 0/absent = jusqu'au début. */
function withinWindow(startTimeIso: string, cutoffHours: number | undefined, now: number): boolean {
  const deadline = new Date(startTimeIso).getTime() - Math.max(0, cutoffHours ?? 0) * 3_600_000;
  return now <= deadline;
}

/** L'organisateur peut-il encore changer les joueurs ? (résa confirmée + délai non dépassé) */
export function isPlayerChangeOpen(r: MyReservation, now: number): boolean {
  return r.status === 'CONFIRMED' && withinWindow(r.startTime, r.resource.club.playerChangeCutoffHours, now);
}

/** L'organisateur peut-il encore annuler ? (résa non annulée + délai non dépassé) */
export function isCancellationOpen(r: MyReservation, now: number): boolean {
  return r.status !== 'CANCELLED' && withinWindow(r.startTime, r.resource.club.cancellationCutoffHours, now);
}

/** Phrase d'affichage de la politique d'annulation du club (lecture seule). */
export function cancellationPolicyLabel(cutoffHours: number | undefined, refunds: boolean): string {
  if (!cutoffHours || cutoffHours <= 0) return 'Annulation gratuite jusqu’au début.';
  const head = `Annulation gratuite jusqu’à ${cutoffHours} h avant le début.`;
  const tail = refunds ? 'Remboursement si vous annulez à temps.' : 'Aucun remboursement passé ce délai.';
  return `${head} ${tail}`;
}

/**
 * Le quota du joueur « mord »-il pour la classification du créneau (pleines/creuses) ?
 * true ssi le compteur concerné existe et qu'il reste ≤ 1 réservation possible —
 * c'est le seul cas où BookingModal affiche le compteur (sinon : bruit).
 */
export function quotaBites(status: MyQuotaStatus | null | undefined, offPeak: boolean): boolean {
  const count = offPeak ? status?.offPeak : status?.peak;
  return !!count && count.limit - count.used <= 1;
}

/**
 * Réduit le statut de quota aux seules classes « qui mordent » (reste ≤ 1) — pour les
 * affichages permanents (Réserver, Mes réservations) où montrer un compteur « 0/10 » en
 * continu est du bruit. Une classe confortable est remise à null (QuotaStatus masque déjà
 * les classes nulles) → seules les jauges tendues s'affichent, en coral au plafond.
 * Renvoie null si aucune classe n'est tendue : la rangée entière est alors masquée.
 * NB : ne PAS utiliser pour la jauge de BookingModal, qui reste gatée sur la classe du
 * créneau en cours (`quotaBites(status, isOffPeak)`).
 */
export function tightQuotaOnly(status: MyQuotaStatus | null | undefined): MyQuotaStatus | null {
  if (!status) return null;
  const peak = quotaBites(status, false) ? status.peak : null;
  const offPeak = quotaBites(status, true) ? status.offPeak : null;
  return peak || offPeak ? { ...status, peak, offPeak } : null;
}
