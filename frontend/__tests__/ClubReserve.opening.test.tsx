import { render, screen, act } from '@testing-library/react';
import { ClubReserve } from '../components/ClubReserve';
import { ThemeProvider } from '../lib/ThemeProvider';
import { nextOpening } from '../lib/bookingWindow';

const runnerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
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

// Inerte : cette suite ne teste pas le flux live, juste le rendez-vous d'ouverture.
class InertEventSource {
  onmessage: unknown = null;
  onerror: unknown = null;
  onopen: unknown = null;
  close() {}
}
beforeEach(() => { (global as any).EventSource = InertEventSource; });

const baseClub = {
  id: 'c1', slug: 'demo', name: 'Club Démo', timezone: runnerTz, description: null,
  memberBookingDays: 7, publicBookingDays: 7,
  publicReleaseHour: 0, memberReleaseHour: 0,
  clubSports: [{ id: 'cs1', durationsMin: [90], sport: { defaultDurationsMin: [90], name: 'Padel', icon: null }, resources: [{ id: 'r1' }] }],
};
const dayAtHourClub = { ...baseClub, bookingReleaseMode: 'DAY_AT_HOUR' } as never;
const rollingClub = { ...baseClub, bookingReleaseMode: 'ROLLING_SLOT' } as never;

const availability = [{
  resource: { id: 'court-1', name: 'Terrain 1', attributes: {}, price: '25', offPeakPrice: null, sport: { key: 'padel', name: 'Padel' }, clubSportId: 'cs1' },
  slots: [{ startTime: start, endTime: end, available: true, price: '25', offPeak: false }],
}];

describe('ClubReserve — rendez-vous d\'ouverture', () => {
  beforeEach(() => {
    document.cookie = 'token=abc; path=/';
    localStorage.clear();
    mocked.getClubAvailability.mockResolvedValue(availability as never);
  });
  afterEach(() => {
    document.cookie = 'token=; max-age=0; path=/';
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('affiche le jour verrouillé 🔒 et, au tap, le compte à rebours plein cadre', async () => {
    render(<ThemeProvider><ClubReserve club={dayAtHourClub} /></ThemeProvider>);
    await screen.findByText(fmt(start));

    const locked = await screen.findByRole('button', { name: /ouvre bientôt/i });
    act(() => { locked.click(); });
    expect(await screen.findByText(/apparaîtront ici automatiquement/i)).toBeInTheDocument();
  });

  it('bandeau de compte à rebours quand l\'ouverture est à moins d\'une heure', async () => {
    // Cible calculée par la fonction elle-même (le calage minute a jusqu'à 59 s de marge) :
    // 20 min avant reste confortablement sous le seuil d'affichage de 1 h.
    const target = nextOpening(new Date(), runnerTz, 7, 'DAY_AT_HOUR', 0)!;
    jest.useFakeTimers({ now: target.opensAtMs - 20 * 60_000 });

    render(<ThemeProvider><ClubReserve club={dayAtHourClub} /></ThemeProvider>);
    await act(async () => { await jest.advanceTimersByTimeAsync(0); });

    expect(screen.getByText(/Ouverture des créneaux du/i)).toBeInTheDocument();
  });

  it('à zéro : bascule automatique sur le nouveau jour (jitter mocké) et refetch', async () => {
    const target = nextOpening(new Date(), runnerTz, 7, 'DAY_AT_HOUR', 0)!;
    // 90 s avant : marge confortable au-delà de l'imprécision de calage minute (≤ 60 s).
    jest.useFakeTimers({ now: target.opensAtMs - 90_000 });
    jest.spyOn(Math, 'random').mockReturnValue(0); // jitter déterministe = 0 ms

    render(<ThemeProvider><ClubReserve club={dayAtHourClub} /></ThemeProvider>);
    await act(async () => { await jest.advanceTimersByTimeAsync(0); });

    const locked = screen.getByRole('button', { name: /ouvre bientôt/i });
    act(() => { locked.click(); });
    expect(screen.getByText(/apparaîtront ici automatiquement/i)).toBeInTheDocument();

    const calls = mocked.getClubAvailability.mock.calls.length;
    // Franchit largement la cible (90 s + marge de calage + jitter nul).
    await act(async () => { await jest.advanceTimersByTimeAsync(150_000); });

    expect(screen.queryByText(/apparaîtront ici automatiquement/i)).toBeNull();
    expect(mocked.getClubAvailability.mock.calls.length).toBeGreaterThan(calls);
  });

  it('club en ROLLING_SLOT : ni cadenas ni bandeau', async () => {
    render(<ThemeProvider><ClubReserve club={rollingClub} /></ThemeProvider>);
    await screen.findByText(fmt(start));

    expect(screen.queryByRole('button', { name: /ouvre bientôt/i })).toBeNull();
    expect(screen.queryByText(/Ouverture des créneaux/i)).toBeNull();
  });
});
