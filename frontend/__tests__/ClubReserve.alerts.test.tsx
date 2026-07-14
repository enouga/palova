import { render, screen, fireEvent } from '@testing-library/react';
import { ClubReserve } from '../components/ClubReserve';
import { ThemeProvider } from '../lib/ThemeProvider';

// Un créneau padel « pris » (available:false) mais À VENIR → pill cliquable « être alerté ».
const future    = new Date(Date.now() + 3 * 3600e3).toISOString();
const futureEnd = new Date(Date.now() + 4.5 * 3600e3).toISOString();
// Même formatage que ClubReserve (heure dans le fuseau du club).
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
    // consommé par MatchAlertSheet (soumission — non appelé ici, on ouvre juste la feuille)
    createMatchAlert: jest.fn().mockResolvedValue({ id: 'a1', windowStart: '2030-01-01T17:00:00Z', windowEnd: '2030-01-01T20:00:00Z' }),
    // consommés par ClubNav (badge « à venir » = réservations + tournois + events + cours)
    getMyReservations: jest.fn().mockResolvedValue([]),
    getMyTournaments: jest.fn().mockResolvedValue([]),
    getMyEvents: jest.fn().mockResolvedValue([]),
    getMyLessons: jest.fn().mockResolvedValue([]),
    // consommé par ClubNav (badge 💬 Messages du header)
    getDmUnread: jest.fn().mockResolvedValue({ count: 0 }),
    // consommé par ClubNav (icône « Espace club » du header)
    getMyClubs: jest.fn().mockResolvedValue([]),
    // consommés par ClubNav (onglet « Parties » — le club est padel dans ce test)
    getOpenMatchUnread: jest.fn().mockResolvedValue({ count: 0 }),
    getOpenMatches: jest.fn().mockResolvedValue([]),
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
  clubSports: [{ id: 'cs1', durationsMin: [90], sport: { key: 'padel', defaultDurationsMin: [90], name: 'Padel', icon: null }, resources: [{ id: 'r1' }] }],
} as never;

const availability = [{
  resource: { id: 'court-1', name: 'Terrain 1', attributes: {}, price: '25', offPeakPrice: null, sport: { key: 'padel', name: 'Padel' }, clubSportId: 'cs1' },
  slots: [
    { startTime: future, endTime: futureEnd, available: false, price: '25', offPeak: false },
  ],
}];

describe('ClubReserve — alertes sur créneau pris (padel)', () => {
  beforeEach(() => {
    document.cookie = 'token=abc; path=/';
    mocked.getClubAvailability.mockResolvedValue(availability as never);
  });
  afterEach(() => { document.cookie = 'token=; max-age=0; path=/'; });

  it('cliquer un créneau padel « pris » à venir ouvre la feuille d\'alerte', async () => {
    render(<ThemeProvider><ClubReserve club={club} /></ThemeProvider>);
    // Le créneau pris est rendu comme un bouton d'alerte (padel, à venir, connecté).
    const taken = await screen.findByTitle(/être alerté/i);
    expect(taken.tagName).toBe('BUTTON');
    // Il affiche bien l'heure du créneau.
    expect(taken).toHaveTextContent(fmt(future));
    // Cliquer ouvre la feuille de création d'alerte.
    fireEvent.click(taken);
    expect(await screen.findByRole('dialog', { name: /créer une alerte/i })).toBeInTheDocument();
  });
});
