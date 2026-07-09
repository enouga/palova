import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
jest.mock('../lib/ClubProvider', () => ({
  useClub: () => ({ slug: 'padel-arena', club: { name: 'Padel Arena' } }),
}));
jest.mock('../lib/api', () => ({
  assetUrl: (p: string | null) => p,
  chatStreamUrl: () => 'http://x/stream',
  api: {
    getMyReservations: jest.fn(),
    getMyTournaments: jest.fn().mockResolvedValue([]),
    getMyEvents: jest.fn().mockResolvedValue([]),
    getMyLessons: jest.fn().mockResolvedValue([]),
    cancelReservation: jest.fn(),
    getMyMatches: jest.fn().mockResolvedValue([]),
    getMyQuotaStatus: jest.fn().mockResolvedValue(null),
    getChatMessages: jest.fn().mockResolvedValue([]),
    postChatMessage: jest.fn(),
    deleteChatMessage: jest.fn(),
  },
}));
import { api } from '../lib/api';
const mocked = api as jest.Mocked<typeof api>;

// EventSource n'existe pas en jsdom : stub minimal (requis par OpenMatchChatSheet).
beforeAll(() => {
  (global as any).EventSource = class { onmessage: ((e: any) => void) | null = null; onerror: ((e: any) => void) | null = null; close() {} };
});

const start = (() => { const d = new Date(Date.now() + 24 * 3600e3); d.setUTCHours(12, 0, 0, 0); return d; })();

const reservation = {
  id: 'res-1',
  startTime: start.toISOString(),
  endTime: new Date(start.getTime() + 3600e3).toISOString(),
  status: 'CONFIRMED',
  totalPrice: '25.00',
  visibility: 'PUBLIC',
  capacity: 4,
  participants: [
    { id: 'p1', userId: 'u-org', isOrganizer: true, firstName: 'Eric', lastName: 'N', avatarUrl: null },
  ],
  resource: { id: 'court-1', name: 'Court 1', sport: { key: 'padel', name: 'Padel' }, club: { name: 'Padel Arena', slug: 'padel-arena', timezone: 'Europe/Paris' } },
};

describe('Mes réservations — chat de partie ouverte', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mocked.getMyReservations.mockResolvedValue([reservation] as never);
    mocked.getMyTournaments.mockResolvedValue([] as never);
    mocked.getMyEvents.mockResolvedValue([] as never);
    mocked.getChatMessages.mockResolvedValue([] as never);
  });

  it('« Discuter » sur la carte d\'une partie ouverte (onglet À venir) ouvre la vraie feuille de chat', async () => {
    render(<ThemeProvider><MyReservationsPage /></ThemeProvider>);
    fireEvent.click(await screen.findByText(/À venir/));
    fireEvent.click(await screen.findByRole('button', { name: /Discuter/ }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await waitFor(() => expect(mocked.getChatMessages).toHaveBeenCalledWith('padel-arena', 'res-1', 'abc'));
  });
});
