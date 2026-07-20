import { render, screen, act } from '@testing-library/react';
import { ClubReserve } from '../components/ClubReserve';
import { ThemeProvider } from '../lib/ThemeProvider';

const start = new Date(Date.now() + 3 * 3600e3).toISOString();
const end = new Date(Date.now() + 4 * 3600e3).toISOString();
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
import { api } from '../lib/api';
const mocked = api as jest.Mocked<typeof api>;

// Fausse EventSource capturante : chaque test contrôle les événements émis au client.
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  closed = false;
  constructor(url: string) { this.url = url; FakeEventSource.instances.push(this); }
  close() { this.closed = true; }
  emit(payload: unknown) { this.onmessage?.({ data: JSON.stringify(payload) }); }
}
beforeEach(() => { FakeEventSource.instances = []; (global as any).EventSource = FakeEventSource; });
// ClubNav ouvre aussi son propre flux (notifications) — on isole toujours celui de la dispo.
function availabilityStream(): FakeEventSource {
  return FakeEventSource.instances.find((i) => i.url.includes('/availability/stream'))!;
}

const club = {
  id: 'c1', slug: 'demo', name: 'Club Démo', timezone: 'Europe/Paris', description: null,
  memberBookingDays: 7, publicBookingDays: 7,
  clubSports: [{ id: 'cs1', durationsMin: [90], sport: { defaultDurationsMin: [90], name: 'Padel', icon: null }, resources: [{ id: 'r1' }] }],
} as never;

const availability = [{
  resource: { id: 'court-1', name: 'Terrain 1', attributes: {}, price: '25', offPeakPrice: null, sport: { key: 'padel', name: 'Padel' }, clubSportId: 'cs1' },
  slots: [{ startTime: start, endTime: end, available: true, price: '25', offPeak: false }],
}];

describe('ClubReserve — grille en direct', () => {
  beforeEach(() => {
    document.cookie = 'token=abc; path=/';
    localStorage.clear();
    mocked.getClubAvailability.mockResolvedValue(availability as never);
  });
  afterEach(() => { document.cookie = 'token=; max-age=0; path=/'; });

  it('ouvre le flux SSE du club et affiche « En direct »', async () => {
    render(<ThemeProvider><ClubReserve club={club} /></ThemeProvider>);
    await screen.findByText(fmt(start));

    await screen.findByText(/En direct/);
    const streams = FakeEventSource.instances.filter((i) => i.url.includes('/availability/stream'));
    expect(streams).toHaveLength(1);
  });

  it('slot_held reçu → le créneau passe pris sans aucun refetch', async () => {
    render(<ThemeProvider><ClubReserve club={club} /></ThemeProvider>);
    await screen.findByText(fmt(start));
    await screen.findByText(/En direct/);

    const calls = mocked.getClubAvailability.mock.calls.length;
    act(() => {
      availabilityStream().emit({
        type: 'slot_held', resourceId: 'court-1', startTime: start, endTime: end,
      });
    });

    // Le créneau n'est plus un bouton cliquable (rendu en <span title="Réservé">).
    expect(screen.queryByRole('button', { name: fmt(start) })).toBeNull();
    expect(await screen.findByTitle('Réservé')).toBeInTheDocument();
    expect(mocked.getClubAvailability.mock.calls.length).toBe(calls); // zéro refetch
  });

  it('slot_released reçu → refetch débouncé de la dispo', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    render(<ThemeProvider><ClubReserve club={club} /></ThemeProvider>);
    await screen.findByText(fmt(start));
    await screen.findByText(/En direct/);

    const calls = mocked.getClubAvailability.mock.calls.length;
    act(() => {
      availabilityStream().emit({
        type: 'slot_released', resourceId: 'court-1', startTime: start, endTime: end,
      });
    });
    await act(async () => { jest.advanceTimersByTime(600); });

    expect(mocked.getClubAvailability.mock.calls.length).toBeGreaterThan(calls);
    jest.useRealTimers();
  });

  it('erreur de flux → « Reconnexion… », reconnexion → resync + « En direct »', async () => {
    render(<ThemeProvider><ClubReserve club={club} /></ThemeProvider>);
    await screen.findByText(fmt(start));
    await screen.findByText(/En direct/);

    act(() => { availabilityStream().onerror?.(); });
    await screen.findByText(/Reconnexion/);

    const calls = mocked.getClubAvailability.mock.calls.length;
    act(() => { availabilityStream().onopen?.(); });
    await screen.findByText(/En direct/);

    expect(mocked.getClubAvailability.mock.calls.length).toBeGreaterThan(calls); // resync
  });
});
