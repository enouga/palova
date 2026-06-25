import type { Prisma } from '@prisma/client';

/** Fenêtre de paiement d'une place confirmée provisoire (minutes). */
export const REGISTRATION_HOLD_MINUTES = 15;

/** Montant minimal encaissable par Stripe (centimes). */
export const MIN_STRIPE_CENTS = 50;

export function holdDeadline(now: Date): Date {
  return new Date(now.getTime() + REGISTRATION_HOLD_MINUTES * 60_000);
}

/**
 * Clause Prisma identifiant une inscription qui OCCUPE une place :
 * CONFIRMED ET (payée/gratuite, ou DUE dont le délai de paiement n'est pas écoulé).
 * Une DUE expirée ne tient pas la place (libérée par le cleanup job).
 */
export function occupiesSpotWhere(now: Date) {
  return {
    status: 'CONFIRMED',
    OR: [
      { paymentStatus: { in: ['PAID', 'NONE'] } },
      { paymentStatus: 'DUE', paymentDeadline: { gt: now } },
    ],
  } satisfies Prisma.TournamentRegistrationWhereInput;
}

/** Convertit entryFee/price (Decimal | number | string | null) en centimes arrondis. */
export function entryFeeCents(fee: unknown): number {
  const n = Math.round(Number(fee) * 100);
  return Number.isFinite(n) ? n : 0;
}
