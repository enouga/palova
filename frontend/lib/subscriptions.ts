import type { Subscription } from './api';

type Coverage = Pick<Subscription, 'sportKeys' | 'offPeakOnly'>;
type Benefit = Pick<Subscription, 'benefit' | 'discountPercent'>;

/** Vrai si l'abonnement couvre ce créneau (miroir booléen de SubscriptionService.coverageFor). */
export function subscriptionCovers(sub: Coverage, ctx: { sportKey: string; isOffPeak: boolean }): boolean {
  return sub.sportKeys.includes(ctx.sportKey) && (!sub.offPeakOnly || ctx.isOffPeak);
}

/** Libellé court de l'avantage (« gratuit » ou « −X % »). */
export function coverageLabel(sub: Benefit): string {
  return sub.benefit === 'INCLUDED' ? 'gratuit' : `−${sub.discountPercent ?? 0} %`;
}

/** 1er abonnement de la liste qui couvre le créneau, sinon null. */
export function coveringSubscription<T extends Coverage>(
  subs: T[], ctx: { sportKey: string; isOffPeak: boolean },
): T | null {
  return subs.find((s) => subscriptionCovers(s, ctx)) ?? null;
}
