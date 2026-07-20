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

// Vue plateforme (pas de club courant) : évite d'avoir à mocker getMyQuotaStatus.
jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ slug: null, club: null }) }));

jest.mock('../lib/api', () => ({
  assetUrl: (p: string | null) => p,
  api: {
    getMyReservations: jest.fn(),
    getMyTournaments: jest.fn().mockResolvedValue([]),
    getMyEvents: jest.fn().mockResolvedValue([]),
    getMyLessons: jest.fn().mockResolvedValue([]),
    cancelReservation: jest.fn(),
    getMyMatches: jest.fn().mockResolvedValue([]),
    recordMatchResult: jest.fn(),
    getMyQuotaStatus: jest.fn().mockResolvedValue(null),
  },
}));
import { api } from '../lib/api';
const mocked = api as jest.Mocked<typeof api>;

// N réservations passées, chacune avec un nom de terrain unique pour pouvoir les compter.
function pastReservations(n: number) {
  return Array.from({ length: n }, (_, i) => {
    const end = new Date(Date.now() - (i + 1) * 3600e3 * 24); // i+1 jours dans le passé
    return {
      id: `past-${i}`,
      startTime: new Date(end.getTime() - 3600e3).toISOString(),
      endTime: end.toISOString(),
      status: 'CONFIRMED',
      totalPrice: '25.00',
      resource: { id: `court-${i}`, name: `Court ${i}`, club: { name: 'Padel Arena', slug: 'padel-arena', timezone: 'Europe/Paris' } },
      participants: [],
    };
  });
}

async function openPast() {
  render(<ThemeProvider><MyReservationsPage /></ThemeProvider>);
  fireEvent.click(await screen.findByText(/Passées/));
}

describe('Mes réservations — pagination de l\'onglet Passées', () => {
  beforeEach(() => {
    mocked.getMyReservations.mockResolvedValue(pastReservations(50) as never);
  });

  it('n\'affiche que les 20 premières réservations passées au départ', async () => {
    await openPast();
    expect(await screen.findByText('Court 0')).toBeInTheDocument();
    expect(screen.getAllByText(/^Court \d+$/)).toHaveLength(20);
    expect(screen.getByText('Charger plus')).toBeInTheDocument();
  });

  it('« Charger plus » révèle 20 réservations de plus par clic, puis disparaît', async () => {
    await openPast();
    await screen.findByText('Court 0');

    fireEvent.click(screen.getByText('Charger plus'));
    expect(screen.getAllByText(/^Court \d+$/)).toHaveLength(40);
    expect(screen.getByText('Charger plus')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Charger plus'));
    expect(screen.getAllByText(/^Court \d+$/)).toHaveLength(50);
    expect(screen.queryByText('Charger plus')).toBeNull();
  });

  it('n\'affecte pas l\'onglet « À venir » (pas de fenêtre appliquée)', async () => {
    const future = new Date(Date.now() + 24 * 3600e3);
    mocked.getMyReservations.mockResolvedValue([
      ...pastReservations(30),
      {
        id: 'up-1',
        startTime: future.toISOString(),
        endTime: new Date(future.getTime() + 3600e3).toISOString(),
        status: 'CONFIRMED',
        totalPrice: '25.00',
        resource: { id: 'court-up', name: 'Court Futur', club: { name: 'Padel Arena', slug: 'padel-arena', timezone: 'Europe/Paris' } },
        participants: [],
      },
    ] as never);
    render(<ThemeProvider><MyReservationsPage /></ThemeProvider>);
    fireEvent.click(await screen.findByText(/À venir/));
    expect(await screen.findByText('Court Futur')).toBeInTheDocument();
    expect(screen.queryByText('Charger plus')).toBeNull();
  });
});
