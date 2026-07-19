import { render, screen, fireEvent } from '@testing-library/react';
import { ClubReserve } from '../components/ClubReserve';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('next/navigation', () => ({
  usePathname: () => '/reserver',
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));
jest.mock('../components/BookingModal', () => ({
  __esModule: true,
  default: ({ resourceId }: { resourceId: string }) => <div data-testid="booking-modal">{resourceId}</div>,
}));
jest.mock('../lib/api', () => ({
  assetUrl: (p: string | null) => p,
  clubAvailabilityStreamUrl: (slug: string) => `http://test/api/clubs/${slug}/availability/stream`,
  notificationsStreamUrl: () => 'http://x/stream',
  api: {
    getMyMemberships: jest.fn().mockResolvedValue([]),
    getMyClubPackages: jest.fn().mockResolvedValue([]),
    getMyCardStatus: jest.fn().mockResolvedValue({ hasCardOnFile: false }),
    getMyClubSubscriptions: jest.fn().mockResolvedValue([]),
    getMyQuotaStatus: jest.fn().mockResolvedValue(null),
    getMyProfile: jest.fn().mockResolvedValue({ firstName: 'Test', lastName: 'User', email: 'test@palova.fr', avatarUrl: null }),
    getClubAvailability: jest.fn(),
    getMyReservations: jest.fn().mockResolvedValue([]),
    getMyTournaments: jest.fn().mockResolvedValue([]),
    getMyEvents: jest.fn().mockResolvedValue([]),
    getMyLessons: jest.fn().mockResolvedValue([]),
    getDmUnread: jest.fn().mockResolvedValue({ count: 0 }),
    getMyClubs: jest.fn().mockResolvedValue([]),
    getUnreadCount: jest.fn().mockResolvedValue({ count: 0 }),
    getNotifications: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
    markNotificationRead: jest.fn().mockResolvedValue({ ok: true }),
    markAllNotificationsRead: jest.fn().mockResolvedValue({ ok: true }),
  },
}));
beforeAll(() => {
  (global as any).EventSource = class { onmessage: ((e: any) => void) | null = null; close() {} };
});
import { api } from '../lib/api';
const mocked = api as jest.Mocked<typeof api>;

const club = {
  id: 'c1', slug: 'demo', name: 'Club Démo', timezone: 'Europe/Paris', description: null,
  memberBookingDays: 7, publicBookingDays: 7,
  clubSports: [{ id: 'cs1', durationsMin: [90], sport: { defaultDurationsMin: [90], name: 'Padel', icon: null }, resources: [{ id: 'r1' }] }],
} as never;

describe('ClubReserve — échec réseau de la disponibilité', () => {
  beforeEach(() => {
    document.cookie = 'token=abc; path=/';
  });
  afterEach(() => { document.cookie = 'token=; max-age=0; path=/'; });

  it('affiche un message distinct de « Aucun terrain. » + un bouton Réessayer qui recharge', async () => {
    mocked.getClubAvailability.mockRejectedValueOnce(new Error('network'));
    render(<ThemeProvider><ClubReserve club={club} /></ThemeProvider>);

    await screen.findByText(/impossible de charger les disponibilités/i);
    expect(screen.queryByText('Aucun terrain.')).not.toBeInTheDocument();

    mocked.getClubAvailability.mockResolvedValueOnce([]);
    fireEvent.click(screen.getByRole('button', { name: /réessayer/i }));
    await screen.findByText('Aucun terrain.');
  });
});
