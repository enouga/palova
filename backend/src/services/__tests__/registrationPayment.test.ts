import { REGISTRATION_HOLD_MINUTES, holdDeadline, occupiesSpotWhere, entryFeeCents, MIN_STRIPE_CENTS } from '../registrationPayment';

describe('registrationPayment helpers', () => {
  it('holdDeadline ajoute REGISTRATION_HOLD_MINUTES minutes', () => {
    const now = new Date('2026-06-25T10:00:00.000Z');
    expect(holdDeadline(now).toISOString()).toBe(new Date(now.getTime() + REGISTRATION_HOLD_MINUTES * 60_000).toISOString());
  });

  it('occupiesSpotWhere couvre PAID/NONE et DUE non expirée', () => {
    const now = new Date('2026-06-25T10:00:00.000Z');
    const w = occupiesSpotWhere(now);
    expect(w.status).toBe('CONFIRMED');
    expect(w.OR).toEqual([
      { paymentStatus: { in: ['PAID', 'NONE'] } },
      { paymentStatus: 'DUE', paymentDeadline: { gt: now } },
    ]);
  });

  it('entryFeeCents convertit en centimes arrondis', () => {
    expect(entryFeeCents(12)).toBe(1200);
    expect(entryFeeCents('0.5')).toBe(50);
    expect(entryFeeCents(null)).toBe(0);
  });

  it('MIN_STRIPE_CENTS vaut 50', () => { expect(MIN_STRIPE_CENTS).toBe(50); });
});
