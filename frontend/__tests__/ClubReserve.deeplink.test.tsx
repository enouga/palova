import { render, screen } from '@testing-library/react';
import { ClubReserve } from '../components/ClubReserve';
import { ThemeProvider } from '../lib/ThemeProvider';

// Lendemain midi UTC : déterministe (pas de chevauchement de minuit) et dans la fenêtre de résa.
const start = (() => { const d = new Date(Date.now() + 24 * 3600e3); d.setUTCHours(12, 0, 0, 0); return d.toISOString(); })();

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
  notificationsStreamUrl: () => 'http://x/stream',
  api: {
    getMyMemberships: jest.fn().mockResolvedValue([]),
    getMyClubPackages: jest.fn().mockResolvedValue([]),
    getMyCardStatus: jest.fn().mockResolvedValue({ hasCardOnFile: false }),
    getMyClubSubscriptions: jest.fn().mockResolvedValue([]),
    getMyQuotaStatus: jest.fn().mockResolvedValue(null),
    // Chargé au montage par ProfileMenu (info-bulle d'identité dans le header) ; menu jamais ouvert ici.
    getMyProfile: jest.fn().mockResolvedValue({ firstName: 'Test', lastName: 'User', email: 'test@palova.fr', avatarUrl: null }),
    getClubAvailability: jest.fn(),
    // consommé par ClubNav (badge réservations à venir)
    getMyReservations: jest.fn().mockResolvedValue([]),
    // consommés par NotificationBell (intégré dans ClubNav)
    getUnreadCount: jest.fn().mockResolvedValue({ count: 0 }),
    getNotifications: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
    markNotificationRead: jest.fn().mockResolvedValue({ ok: true }),
    markAllNotificationsRead: jest.fn().mockResolvedValue({ ok: true }),
  },
}));
// EventSource n'existe pas en jsdom : stub minimal (requis par NotificationBell).
beforeAll(() => {
  (global as any).EventSource = class { onmessage: ((e: any) => void) | null = null; close() {} };
});
import { api } from '../lib/api';
const mocked = api as jest.Mocked<typeof api>;

const club = {
  id: 'c1', slug: 'demo', name: 'Club Démo', timezone: 'Europe/Paris', description: null,
  memberBookingDays: 7, publicBookingDays: 7,
  clubSports: [{ id: 'cs1', durationsMin: [90], sport: { defaultDurationsMin: [90], name: 'Padel', icon: null }, resources: [] }],
} as never;

const availability = [{
  resource: { id: 'court-1', name: 'Terrain 1', attributes: {}, price: '25', offPeakPrice: null, sport: { key: 'padel', name: 'Padel' }, clubSportId: 'cs1' },
  slots: [{ startTime: start, endTime: start, available: true, price: '25', offPeak: false }],
}];

describe('ClubReserve — lien profond', () => {
  beforeEach(() => {
    document.cookie = 'token=abc; path=/';
    mocked.getClubAvailability.mockResolvedValue(availability as never);
  });
  afterEach(() => { document.cookie = 'token=; max-age=0; path=/'; });

  it('?resource=&start= pré-ouvre la confirmation quand le créneau est libre', async () => {
    window.history.pushState({}, '', `/reserver?resource=court-1&start=${encodeURIComponent(start)}`);
    render(<ThemeProvider><ClubReserve club={club} /></ThemeProvider>);
    expect(await screen.findByTestId('booking-modal')).toHaveTextContent('court-1');
  });

  it('créneau pris entre-temps → page normale, sans modale ni erreur', async () => {
    mocked.getClubAvailability.mockResolvedValue([{
      ...availability[0],
      slots: [{ startTime: start, endTime: start, available: false, price: '25', offPeak: false }],
    }] as never);
    window.history.pushState({}, '', `/reserver?resource=court-1&start=${encodeURIComponent(start)}`);
    render(<ThemeProvider><ClubReserve club={club} /></ThemeProvider>);
    expect(await screen.findByText('Terrain 1')).toBeInTheDocument();
    expect(screen.queryByTestId('booking-modal')).not.toBeInTheDocument();
  });
});
