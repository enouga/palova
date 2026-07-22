import { render, screen, waitFor } from '@testing-library/react';
import { MonPalova } from '../components/platform/MonPalova';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));
jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true, clubId: null }) }));
// Sections lourdes déjà testées isolément → stubs (le test vérifie l'ORCHESTRATION).
jest.mock('../components/match/ResultsToRecord', () => ({ ResultsToRecord: () => <div data-testid="results" /> }));
jest.mock('../components/platform/home/HomeMatchesRail', () => ({ HomeMatchesRail: () => <div data-testid="rail" /> }));
jest.mock('../components/platform/home/WalletCard', () => ({ WalletCard: () => <div data-testid="wallet" /> }));
jest.mock('../components/platform/home/LevelCard', () => ({ LevelCard: () => <div data-testid="level" /> }));
jest.mock('../components/platform/home/ManagedClubsCard', () => ({ ManagedClubsCard: () => <div data-testid="managed" /> }));
jest.mock('../components/platform/home/DiscoverPill', () => ({ DiscoverPill: () => <div data-testid="discover" /> }));
jest.mock('../components/ProfileMenu', () => ({ ProfileMenu: () => <div data-testid="profile" /> }));

jest.mock('../lib/api', () => ({
  assetUrl: (p: string | null) => p,
  api: {
    getMyProfile: jest.fn(), getMyReservations: jest.fn(), getMyTournaments: jest.fn(),
    getMyEvents: jest.fn(), getMyLessons: jest.fn(), getMyMemberships: jest.fn(),
  },
}));
import { api } from '../lib/api';
const mocked = api as jest.Mocked<typeof api>;

const future = new Date(Date.now() + 24 * 3600e3).toISOString();
const futureEnd = new Date(Date.now() + 25 * 3600e3).toISOString();
const resa = (id: string, start = future) => ({
  id, startTime: start, endTime: futureEnd, status: 'CONFIRMED', totalPrice: '25', capacity: 4, participants: [],
  resource: { id: `c-${id}`, name: `Court ${id}`, club: { name: 'Padel Arena', slug: 'padel-arena', timezone: 'Europe/Paris', accentColor: '#5e93da' } },
});

beforeEach(() => {
  jest.clearAllMocks();
  mocked.getMyProfile.mockResolvedValue({ firstName: 'Eric' } as never);
  mocked.getMyReservations.mockResolvedValue([resa('1'), resa('2')] as never);
  mocked.getMyTournaments.mockResolvedValue([] as never);
  mocked.getMyEvents.mockResolvedValue([] as never);
  mocked.getMyLessons.mockResolvedValue([] as never);
  mocked.getMyMemberships.mockResolvedValue([] as never);
});

const wrap = () => render(<ThemeProvider><MonPalova /></ThemeProvider>);

describe('MonPalova', () => {
  it('rend le hero (1re entrée), l\'agenda « À venir » (les suivantes) et toutes les sections', async () => {
    wrap();
    expect(await screen.findByText(/Bonjour Eric/)).toBeInTheDocument();
    expect(screen.getByText(/Court 1/)).toBeInTheDocument();   // hero
    expect(screen.getByText('Court 2')).toBeInTheDocument();   // À venir (pas de doublon du hero)
    for (const id of ['managed', 'results', 'rail', 'wallet', 'level', 'discover']) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: /Trouver un club/ })).toBeInTheDocument(); // MyClubsRow
  });

  it('une brique agenda en échec n\'éteint pas la page (hero fallback + autres sections vivantes)', async () => {
    mocked.getMyReservations.mockRejectedValue(new Error('boom'));
    wrap();
    expect(await screen.findByText(/Trouve ta prochaine partie/)).toBeInTheDocument();
    expect(screen.getByTestId('rail')).toBeInTheDocument();
  });

  it('agenda vide → hero invitation, pas de section « À venir »', async () => {
    mocked.getMyReservations.mockResolvedValue([] as never);
    wrap();
    expect(await screen.findByText(/Trouve ta prochaine partie/)).toBeInTheDocument();
    expect(screen.queryByText(/À venir · tous clubs/i)).toBeNull();
  });
});
