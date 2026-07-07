import { isPlayerChangeOpen, isCancellationOpen, cancellationPolicyLabel, quotaBites } from '@/lib/reservations';
import { MyReservation } from '@/lib/api';

const NOW = Date.now();
const r = (startInHours: number, cutoff: number, status: MyReservation['status'] = 'CONFIRMED'): MyReservation => ({
  id: 'r1',
  startTime: new Date(NOW + startInHours * 3_600_000).toISOString(),
  endTime: new Date(NOW + (startInHours + 1) * 3_600_000).toISOString(),
  status,
  totalPrice: '25',
  resource: { id: 'c1', name: 'Court 1', club: { name: 'Club', slug: 'club', timezone: 'Europe/Paris', playerChangeCutoffHours: cutoff, cancellationCutoffHours: cutoff } },
  capacity: 4,
  participants: [],
});

describe('isPlayerChangeOpen / isCancellationOpen', () => {
  it('ouvert quand on est avant la clôture', () => {
    expect(isPlayerChangeOpen(r(5, 2), NOW)).toBe(true);
    expect(isCancellationOpen(r(5, 2), NOW)).toBe(true);
  });
  it('fermé une fois la clôture passée', () => {
    expect(isPlayerChangeOpen(r(1, 2), NOW)).toBe(false);
    expect(isCancellationOpen(r(1, 2), NOW)).toBe(false);
  });
  it('cutoff 0 (ou absent) = ouvert jusqu au début', () => {
    expect(isPlayerChangeOpen(r(1, 0), NOW)).toBe(true);
    expect(isPlayerChangeOpen(r(-1, 0), NOW)).toBe(false); // déjà commencé
  });
  it('fermé si la réservation est annulée / non confirmée', () => {
    expect(isPlayerChangeOpen(r(5, 0, 'CANCELLED'), NOW)).toBe(false);
    expect(isCancellationOpen(r(5, 0, 'CANCELLED'), NOW)).toBe(false);
    expect(isPlayerChangeOpen(r(5, 0, 'PENDING'), NOW)).toBe(false);
  });
});

describe('cancellationPolicyLabel', () => {
  it('cutoff 0 → gratuit jusqu au début', () => {
    expect(cancellationPolicyLabel(0, false)).toBe('Annulation gratuite jusqu’au début.');
    expect(cancellationPolicyLabel(0, true)).toBe('Annulation gratuite jusqu’au début.');
  });
  it('cutoff undefined → gratuit jusqu au début', () => {
    expect(cancellationPolicyLabel(undefined, true)).toBe('Annulation gratuite jusqu’au début.');
  });
  it('cutoff > 0 avec remboursement → mention du remboursement', () => {
    const out = cancellationPolicyLabel(24, true);
    expect(out).toContain('Annulation gratuite jusqu’à 24 h avant le début.');
    expect(out).toContain('Remboursement si vous annulez à temps.');
  });
  it('cutoff > 0 sans remboursement → mention aucun remboursement', () => {
    const out = cancellationPolicyLabel(24, false);
    expect(out).toContain('Annulation gratuite jusqu’à 24 h avant le début.');
    expect(out).toContain('Aucun remboursement passé ce délai.');
  });
});

describe('quotaBites', () => {
  it('false sans statut ou sans compteur pour la classe du créneau', () => {
    expect(quotaBites(null, false)).toBe(false);
    expect(quotaBites(undefined, true)).toBe(false);
    expect(quotaBites({ model: 'WEEKLY', peak: { used: 4, limit: 5 }, offPeak: null }, true)).toBe(false);
  });

  it('true quand il reste ≤ 1 réservation possible pour la classe du créneau', () => {
    expect(quotaBites({ model: 'WEEKLY', peak: { used: 4, limit: 5 }, offPeak: null }, false)).toBe(true);   // reste 1
    expect(quotaBites({ model: 'UPCOMING', peak: { used: 5, limit: 5 }, offPeak: null }, false)).toBe(true); // plafond atteint
    expect(quotaBites({ model: 'WEEKLY', peak: null, offPeak: { used: 2, limit: 3 } }, true)).toBe(true);
  });

  it('false quand il reste ≥ 2 réservations', () => {
    expect(quotaBites({ model: 'WEEKLY', peak: { used: 1, limit: 5 }, offPeak: null }, false)).toBe(false);
    expect(quotaBites({ model: 'WEEKLY', peak: null, offPeak: { used: 0, limit: 2 } }, true)).toBe(false);
  });
});
