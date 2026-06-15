import { render, screen, fireEvent } from '@testing-library/react';
import MyReservationsPage from '../app/me/reservations/page';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  usePathname: () => '/me/reservations',
}));

jest.mock('../lib/useAuth', () => ({
  useAuth: () => ({ token: 'abc', ready: true, clubId: null }),
  logout: jest.fn(),
}));
jest.mock('../components/ClubNav', () => ({ ClubNav: () => <div data-testid="nav" /> }));
jest.mock('../components/ProfileMenu', () => ({ ProfileMenu: () => <div data-testid="profile" /> }));

// useClub mutable : chaque test règle le club courant + sa préférence.
let mockClubState: { slug: string | null; club: { name: string; showOtherClubsReservations?: boolean } | null };
jest.mock('../lib/ClubProvider', () => ({ useClub: () => mockClubState }));

jest.mock('../lib/api', () => ({
  assetUrl: (p: string | null) => p,
  api: {
    getMyReservations: jest.fn(),
    getMyTournaments: jest.fn(),
    getMyEvents: jest.fn(),
    cancelReservation: jest.fn(),
  },
}));
import { api } from '../lib/api';
const mocked = api as jest.Mocked<typeof api>;

const future = (() => { const d = new Date(Date.now() + 24 * 3600e3); d.setUTCHours(12, 0, 0, 0); return d; })();
const mkRes = (id: string, slug: string, name: string) => ({
  id,
  startTime: future.toISOString(),
  endTime: new Date(future.getTime() + 3600e3).toISOString(),
  status: 'CONFIRMED',
  totalPrice: '25.00',
  resource: { id: `court-${id}`, name, club: { name: slug, slug, timezone: 'Europe/Paris' } },
});

async function openUpcoming() {
  render(<ThemeProvider><MyReservationsPage /></ThemeProvider>);
  fireEvent.click(await screen.findByText(/À venir/));
}

describe('Mes réservations — cloisonnement par club', () => {
  beforeEach(() => {
    mocked.getMyReservations.mockResolvedValue([mkRes('1', 'padel-arena', 'Court Local'), mkRes('2', 'autre-club', 'Court Autre')] as never);
    mocked.getMyTournaments.mockResolvedValue([] as never);
    mocked.getMyEvents.mockResolvedValue([] as never);
  });

  it('sur l app d un club, réglage OFF : ne montre que le club courant', async () => {
    mockClubState = { slug: 'padel-arena', club: { name: 'Padel Arena', showOtherClubsReservations: false } };
    await openUpcoming();
    expect(await screen.findByText('Court Local')).toBeInTheDocument();
    expect(screen.queryByText('Court Autre')).toBeNull();
  });

  it('réglage ON : montre aussi les autres clubs, l entrée étrangère est un lien vers l app du club', async () => {
    mockClubState = { slug: 'padel-arena', club: { name: 'Padel Arena', showOtherClubsReservations: true } };
    const { container } = render(<ThemeProvider><MyReservationsPage /></ThemeProvider>);
    fireEvent.click(await screen.findByText(/À venir/));
    expect(await screen.findByText('Court Local')).toBeInTheDocument();
    expect(screen.getByText('Court Autre')).toBeInTheDocument();
    // L'entrée du club courant garde son action Annuler ; l'étrangère est une carte-lien.
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeInTheDocument();
    expect(container.querySelector('a[href*="autre-club"]')).not.toBeNull();
  });

  it('sur la plateforme (pas de club courant) : vue globale, tout est affiché', async () => {
    mockClubState = { slug: null, club: null };
    await openUpcoming();
    expect(await screen.findByText('Court Local')).toBeInTheDocument();
    expect(screen.getByText('Court Autre')).toBeInTheDocument();
  });
});
