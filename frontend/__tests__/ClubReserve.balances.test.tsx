import { render, screen } from '@testing-library/react';
import { ClubReserve } from '../components/ClubReserve';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('next/navigation', () => ({
  usePathname: () => '/reserver',
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));
jest.mock('../components/BookingModal', () => ({ __esModule: true, default: () => null }));
jest.mock('../lib/api', () => ({
  assetUrl: (p: string | null) => p,
  notificationsStreamUrl: () => 'http://x/stream',
  api: {
    getMyMemberships: jest.fn().mockResolvedValue([]),
    getMyClubPackages: jest.fn().mockResolvedValue([]),
    getMyCardStatus: jest.fn().mockResolvedValue({ hasCardOnFile: false }),
    getMyClubSubscriptions: jest.fn().mockResolvedValue([]),
    getMyQuotaStatus: jest.fn().mockResolvedValue(null),
    getMyProfile: jest.fn().mockResolvedValue({ firstName: 'T', lastName: 'U', email: 't@p.fr', avatarUrl: null }),
    getClubAvailability: jest.fn(),
    // consommés par ClubNav (badge « à venir » = réservations + tournois + events + cours)
    getMyReservations: jest.fn().mockResolvedValue([]),
    getMyTournaments: jest.fn().mockResolvedValue([]),
    getMyEvents: jest.fn().mockResolvedValue([]),
    getMyLessons: jest.fn().mockResolvedValue([]),
    // consommé par ClubNav (badge non lus de l'onglet Parties — club avec padel)
    getOpenMatchUnread: jest.fn().mockResolvedValue({ count: 0 }),
    // consommé par ClubNav (badge 💬 Messages du header)
    getDmUnread: jest.fn().mockResolvedValue({ count: 0 }),
    // consommé par ClubNav (icône « Espace club » du header)
    getMyClubs: jest.fn().mockResolvedValue([]),
    // consommé par ClubNav (pastille « parties ouvertes » de l'onglet Parties)
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

// Club mono-sport (padel) : sélection résolue en synchrone, pas de SportPicker.
const club = {
  id: 'c1', slug: 'demo', name: 'Club Démo', timezone: 'Europe/Paris', description: null,
  memberBookingDays: 7, publicBookingDays: 7,
  clubSports: [
    { id: 'cs1', durationsMin: [90], sport: { key: 'padel', defaultDurationsMin: [90], name: 'Padel', icon: null }, resources: [{ id: 'r1' }] },
  ],
} as never;

// Porte-monnaie + abonnement : jamais affichés sur Réserver (déjà dans le menu profil),
// mais toujours chargés (BookingModal : « payer avec mon solde », couverture abo).
const wallet = [{ id: 'p1', kind: 'WALLET', amountRemaining: '130', creditsRemaining: null, expiresAt: null }];
const subs = [{ id: 's1', sportKeys: ['padel'], offPeakOnly: true }];

describe('ClubReserve — rangée quotas défilante', () => {
  beforeEach(() => {
    document.cookie = 'token=abc; path=/';
    localStorage.clear();
    mocked.getClubAvailability.mockResolvedValue([] as never);
    // clearAllMocks ne retire pas les implémentations posées par un test → re-fixe les défauts.
    mocked.getMyClubPackages.mockResolvedValue([] as never);
    mocked.getMyClubSubscriptions.mockResolvedValue([] as never);
    mocked.getMyQuotaStatus.mockResolvedValue(null as never);
    window.history.pushState({}, '', '/reserver');
  });
  afterEach(() => { document.cookie = 'token=; max-age=0; path=/'; jest.clearAllMocks(); });

  it('rend les quotas seuls sur la rangée défilante, suffixe dans chaque jauge — pas de porte-monnaie ni d\'Abonné', async () => {
    mocked.getMyClubPackages.mockResolvedValue(wallet as never);
    mocked.getMyClubSubscriptions.mockResolvedValue(subs as never);
    mocked.getMyQuotaStatus.mockResolvedValue({
      model: 'WEEKLY',
      peak: { used: 15, limit: 100 },
      offPeak: { used: 0, limit: 67 },
    } as never);

    render(<ThemeProvider><ClubReserve club={club} /></ThemeProvider>);

    // Une seule rangée défilante (scrollbar masquée) contenant les deux jauges.
    const row = await screen.findByTestId('balances-row');
    expect(row.classList.contains('sp-scroll-x')).toBe(true);
    expect(row).toContainElement(screen.getByText('15/100'));
    expect(row).toContainElement(screen.getByText('0/67'));

    // Le suffixe de période vit DANS chaque jauge (2 occurrences), pas de libellé orphelin.
    expect(screen.getAllByText('cette semaine')).toHaveLength(2);

    // Soldes et abonnement : déjà dans le menu profil → pas de doublon sur Réserver.
    expect(screen.queryByText('130,00 €')).not.toBeInTheDocument();
    expect(screen.queryByText('padel · h. creuses')).not.toBeInTheDocument();
    expect(screen.queryByText('Porte-monnaie')).not.toBeInTheDocument();
    expect(screen.queryByText('Abonné')).not.toBeInTheDocument();
  });

  it("n'affiche pas la rangée sans quota, même avec porte-monnaie et abonnement", async () => {
    mocked.getMyClubPackages.mockResolvedValue(wallet as never);
    mocked.getMyClubSubscriptions.mockResolvedValue(subs as never);

    render(<ThemeProvider><ClubReserve club={club} /></ThemeProvider>);
    await screen.findByText(/Aucun terrain/);
    expect(screen.queryByTestId('balances-row')).not.toBeInTheDocument();
  });
});
