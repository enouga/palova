import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OpenMatches } from '../components/openmatch/OpenMatches';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('next/navigation', () => ({
  usePathname: () => '/parties',
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));
jest.mock('../lib/api', () => ({
  assetUrl: (p: string | null) => p,
  api: {
    getMyMemberships: jest.fn().mockResolvedValue([]),
    getOpenMatches:   jest.fn(),
    joinOpenMatch:    jest.fn().mockResolvedValue({ id: 'm1' }),
    leaveOpenMatch:   jest.fn().mockResolvedValue({ id: 'm1' }),
  },
}));
import { api } from '../lib/api';
const mocked = api as jest.Mocked<typeof api>;

const club = { id: 'c1', slug: 'demo', name: 'Club Démo', timezone: 'Europe/Paris' } as never;
const future = new Date(Date.now() + 48 * 3600e3).toISOString();

const match = (over: Record<string, unknown> = {}) => ({
  id: 'm1', resourceName: 'Terrain 1', startTime: future, endTime: future,
  maxPlayers: 4, spotsLeft: 2, full: false, viewerIsParticipant: false, viewerIsOrganizer: false,
  players: [{ firstName: 'Org', lastName: 'A', avatarUrl: null, isOrganizer: true }],
  ...over,
});

describe('OpenMatches', () => {
  beforeEach(() => { document.cookie = 'token=abc; path=/'; jest.clearAllMocks(); });
  afterEach(() => { document.cookie = 'token=; max-age=0; path=/'; });

  it('liste les parties et permet de rejoindre', async () => {
    mocked.getOpenMatches.mockResolvedValue([match()] as never);
    render(<ThemeProvider><OpenMatches club={club} /></ThemeProvider>);

    expect(await screen.findByText('Terrain 1')).toBeInTheDocument();
    expect(screen.getByText('2 places')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Rejoindre/ }));
    await waitFor(() => expect(mocked.joinOpenMatch).toHaveBeenCalledWith('demo', 'm1', 'abc'));
  });

  it('affiche « Quitter » pour un participant non-organisateur', async () => {
    mocked.getOpenMatches.mockResolvedValue([match({ viewerIsParticipant: true })] as never);
    render(<ThemeProvider><OpenMatches club={club} /></ThemeProvider>);

    fireEvent.click(await screen.findByRole('button', { name: /Quitter/ }));
    await waitFor(() => expect(mocked.leaveOpenMatch).toHaveBeenCalledWith('demo', 'm1', 'abc'));
  });

  it('masque les actions et affiche « Vous organisez » pour l organisateur', async () => {
    mocked.getOpenMatches.mockResolvedValue([match({ viewerIsParticipant: true, viewerIsOrganizer: true })] as never);
    render(<ThemeProvider><OpenMatches club={club} /></ThemeProvider>);

    expect(await screen.findByText('Vous organisez')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Rejoindre|Quitter/ })).not.toBeInTheDocument();
  });

  it('désactive « Rejoindre » quand la partie est complète', async () => {
    mocked.getOpenMatches.mockResolvedValue([match({ full: true, spotsLeft: 0 })] as never);
    render(<ThemeProvider><OpenMatches club={club} /></ThemeProvider>);

    expect(await screen.findByText('Complet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Rejoindre/ })).toBeDisabled();
  });
});
