import { render, screen, fireEvent } from '@testing-library/react';
import { ClubReserve } from '../components/ClubReserve';
import { ThemeProvider } from '../lib/ThemeProvider';

const future = new Date(Date.now() + 3 * 3600e3).toISOString();
const fmt = (iso: string) =>
  new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' })
    .format(new Date(iso)).replace(':', 'h');

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
    getMyProfile: jest.fn().mockResolvedValue({ firstName: 'Test', lastName: 'User', email: 'test@palova.fr', avatarUrl: null }),
    getClubAvailability: jest.fn(),
    getMyReservations: jest.fn().mockResolvedValue([]),
    getMyTournaments: jest.fn().mockResolvedValue([]),
    getMyEvents: jest.fn().mockResolvedValue([]),
    getMyLessons: jest.fn().mockResolvedValue([]),
    getDmUnread: jest.fn().mockResolvedValue({ count: 0 }),
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

const availability = [{
  resource: { id: 'court-1', name: 'Terrain 1', attributes: {}, price: '25', offPeakPrice: null, sport: { key: 'padel', name: 'Padel' }, clubSportId: 'cs1' },
  slots: [{ startTime: future, endTime: future, available: true, price: '25', offPeak: false }],
}];

describe('ClubReserve — bascule de vue', () => {
  beforeEach(() => {
    document.cookie = 'token=abc; path=/';
    localStorage.clear();
    mocked.getClubAvailability.mockResolvedValue(availability as never);
  });
  afterEach(() => { document.cookie = 'token=; max-age=0; path=/'; });

  it('bascule en vue grille, persiste le choix, et rend une cellule cliquable', async () => {
    render(<ThemeProvider><ClubReserve club={club} /></ThemeProvider>);
    // Vue cartes par défaut : le chip horaire est là.
    await screen.findByText(fmt(future));
    // Bascule en grille.
    fireEvent.click(screen.getByLabelText('Vue grille'));
    // La cellule de grille (aria-label « Terrain 1 <heure> ») est présente.
    expect(await screen.findByLabelText(new RegExp(`Terrain 1 ${fmt(future)}`))).toBeInTheDocument();
    // Le choix est persisté.
    expect(localStorage.getItem('palova:reserve-view:c1')).toBe('grid');
  });

  it('restaure la vue grille mémorisée au montage', async () => {
    localStorage.setItem('palova:reserve-view:c1', 'grid');
    render(<ThemeProvider><ClubReserve club={club} /></ThemeProvider>);
    expect(await screen.findByLabelText(new RegExp(`Terrain 1 ${fmt(future)}`))).toBeInTheDocument();
  });
});
