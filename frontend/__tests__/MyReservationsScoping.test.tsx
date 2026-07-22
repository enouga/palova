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
let mockClubState: { slug: string | null; club: { name: string; showOtherClubsReservations?: boolean; levelSystemEnabled?: boolean } | null };
jest.mock('../lib/ClubProvider', () => ({ useClub: () => mockClubState }));

jest.mock('../lib/api', () => ({
  assetUrl: (p: string | null) => p,
  api: {
    getMyReservations: jest.fn(),
    getMyTournaments: jest.fn(),
    getMyEvents: jest.fn(),
    getMyLessons: jest.fn().mockResolvedValue([]),
    cancelReservation: jest.fn(),
    getMyMatches: jest.fn().mockResolvedValue([]),
    recordMatchResult: jest.fn(),
    getMyQuotaStatus: jest.fn().mockResolvedValue(null),
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

  it('réglage ON : la carte étrangère porte le marqueur club (liseré + chip), la locale non', async () => {
    mockClubState = { slug: 'padel-arena', club: { name: 'Padel Arena', showOtherClubsReservations: true } };
    const { container } = render(<ThemeProvider><MyReservationsPage /></ThemeProvider>);
    fireEvent.click(await screen.findByText(/À venir/));
    await screen.findByText('Court Autre');
    const stripes = container.querySelectorAll('[data-club-stripe]');
    expect(stripes).toHaveLength(1); // seulement l'entrée étrangère
    expect(stripes[0]).toHaveStyle('background: #5e93da'); // fallback ACCENTS.blue (payload sans accentColor)
    expect(screen.getByText('autre-club').tagName).toBe('SPAN'); // chip club
    expect(screen.getByText('padel-arena').tagName).toBe('DIV'); // sous-titre texte de la carte locale intact
  });

  it('plateforme : toutes les cartes portent le marqueur de leur club', async () => {
    mockClubState = { slug: null, club: null };
    const { container } = render(<ThemeProvider><MyReservationsPage /></ThemeProvider>);
    fireEvent.click(await screen.findByText(/À venir/));
    await screen.findByText('Court Local');
    expect(container.querySelectorAll('[data-club-stripe]')).toHaveLength(2);
  });

  it('réglage OFF : ligne « Vous avez aussi 1 réservation à venir dans un autre club » + lien plateforme', async () => {
    mockClubState = { slug: 'padel-arena', club: { name: 'Padel Arena', showOtherClubsReservations: false } };
    render(<ThemeProvider><MyReservationsPage /></ThemeProvider>);
    expect(await screen.findByText(/Vous avez aussi 1 réservation à venir dans un autre club/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Tout voir sur Palova/ });
    expect(link.getAttribute('href')).toContain('/me/reservations');
  });

  it('réglage ON : pas de ligne d\'info (les entrées sont déjà visibles)', async () => {
    mockClubState = { slug: 'padel-arena', club: { name: 'Padel Arena', showOtherClubsReservations: true } };
    render(<ThemeProvider><MyReservationsPage /></ThemeProvider>);
    await screen.findByText(/À venir/);
    expect(screen.queryByText(/Vous avez aussi/)).toBeNull();
  });

  it('plateforme : pas de ligne d\'info (vue globale)', async () => {
    mockClubState = { slug: null, club: null };
    render(<ThemeProvider><MyReservationsPage /></ThemeProvider>);
    await screen.findByText(/À venir/);
    expect(screen.queryByText(/Vous avez aussi/)).toBeNull();
  });

  it('club OFF : pas d onglet « Matchs »', async () => {
    mockClubState = { slug: 'padel-arena', club: { name: 'Padel Arena', levelSystemEnabled: false } };
    render(<ThemeProvider><MyReservationsPage /></ThemeProvider>);
    expect(await screen.findByText('Mes réservations')).toBeInTheDocument();
    expect(screen.queryByText('Matchs')).not.toBeInTheDocument();
  });
});
