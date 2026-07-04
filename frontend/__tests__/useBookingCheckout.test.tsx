import { renderHook, waitFor } from '@testing-library/react';
import { useBookingCheckout } from '@/components/checkout/useBookingCheckout';
import type { BookingCheckoutInput } from '@/components/checkout/useBookingCheckout';

const holdSlot = jest.fn();

jest.mock('@/lib/api', () => ({
  api: { holdSlot: (...a: any[]) => holdSlot(...a) },
  assetUrl: (u: string | null) => u,
}));

// Entrée mono-joueur (pas de slug / maxPlayers=1) → showPartners=false → seul
// api.holdSlot est appelé au montage (pas de getMyProfile/getMyRating/getClubPage).
const baseInput = (): BookingCheckoutInput => ({
  slot: { startTime: '2026-07-03T16:00:00Z', endTime: '2026-07-03T17:30:00Z', price: '25', offPeak: false } as any,
  resourceId: 'court-1',
  price: '25',
  duration: 90,
  token: 't',
  maxPlayers: 1,
  sportKey: 'padel',
  onConfirmed: jest.fn(),
  onExit: jest.fn(),
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useBookingCheckout — reprise du timer depuis createdAt', () => {
  it('hold frais : secondsLeft ≈ 300 (créneau tout juste posé)', async () => {
    holdSlot.mockResolvedValue({ id: 'r1', status: 'PENDING', createdAt: new Date().toISOString() });

    const { result } = renderHook(() => useBookingCheckout(baseInput()));

    await waitFor(() => expect(result.current.phase).toBe('held'));

    expect(result.current.secondsLeft).toBeGreaterThanOrEqual(299);
    expect(result.current.secondsLeft).toBeLessThanOrEqual(300);
  });

  it('reprise après refresh : créneau posé il y a 2 min → secondsLeft ≈ 180', async () => {
    holdSlot.mockResolvedValue({ id: 'r1', status: 'PENDING', createdAt: new Date(Date.now() - 120_000).toISOString() });

    const { result } = renderHook(() => useBookingCheckout(baseInput()));

    await waitFor(() => expect(result.current.phase).toBe('held'));

    expect(result.current.secondsLeft).toBeGreaterThanOrEqual(179);
    expect(result.current.secondsLeft).toBeLessThanOrEqual(181);
  });
});
