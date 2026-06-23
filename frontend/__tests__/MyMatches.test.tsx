import { render, screen, waitFor, act } from '@testing-library/react';
import MyMatchesPage from '../app/me/matches/page';
import { ThemeProvider } from '../lib/ThemeProvider';

const replace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace, back: jest.fn() }),
}));

// Contexte club contrôlable : slug null = hôte plateforme, sinon hôte club.
let clubCtx: { slug: string | null; club: { id: string; slug: string; name: string; levelSystemEnabled?: boolean } | null; loading: boolean } =
  { slug: null, club: null, loading: false };
jest.mock('../lib/ClubProvider', () => ({ useClub: () => clubCtx }));

jest.mock('../components/ClubNav', () => ({ ClubNav: () => <nav /> }));
jest.mock('../components/ProfileMenu', () => ({ ProfileMenu: () => <div /> }));

jest.mock('../lib/api', () => ({
  __esModule: true,
  assetUrl: () => null,
  api: {
    getMyMatches: jest.fn(),
    confirmMatch: jest.fn().mockResolvedValue({ ok: true }),
    disputeMatch: jest.fn().mockResolvedValue({ ok: true }),
    getMatchComments: jest.fn().mockResolvedValue({ status: 'DISPUTED', comments: [] }),
  },
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { api } = require('../lib/api') as { api: Record<string, jest.Mock> };

const match = {
  matchId: 'm1', reservationId: 'r1', status: 'PENDING',
  sets: [[6, 4], [6, 3]] as [number, number][],
  playedAt: '2026-06-20T16:30:00Z', winningTeam: 1, myTeam: 2,
  myConfirmation: 'PENDING', ratingAfter: null, needsMyConfirmation: true, commentCount: 0,
  club: { name: 'Padel Arena Paris' }, sport: { name: 'Padel' },
  resource: { name: 'Court 2' },
  players: [
    { userId: 'u1', team: 2, firstName: 'Eric', lastName: 'Nougayrede', isMe: true },
    { userId: 'u2', team: 2, firstName: 'Marie', lastName: 'Durand', isMe: false },
    { userId: 'u3', team: 1, firstName: 'Paul', lastName: 'Roy', isMe: false },
    { userId: 'u4', team: 1, firstName: 'Lea', lastName: 'Martin', isMe: false },
  ],
};

const wrap = () => render(<ThemeProvider><MyMatchesPage /></ThemeProvider>);

describe('Page Mes matchs à confirmer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    document.cookie = 'token=abc; path=/';
    clubCtx = { slug: null, club: null, loading: false };
    api.getMyMatches.mockResolvedValue([]);
  });
  afterEach(() => { document.cookie = 'token=; max-age=0; path=/'; });

  it('redirige vers /login quand non authentifié', async () => {
    document.cookie = 'token=; max-age=0; path=/';
    wrap();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
  });

  it('affiche un état de chargement avant la réponse', async () => {
    let resolve!: (v: unknown[]) => void;
    const pending = new Promise<unknown[]>((r) => { resolve = r; });
    api.getMyMatches.mockReturnValue(pending);
    wrap();
    expect(screen.getByText(/Chargement/)).toBeInTheDocument();
    await act(async () => { resolve([]); await pending; });
  });

  it('affiche un état vide quand aucun match', async () => {
    wrap();
    expect(await screen.findByText(/Aucun match enregistré/)).toBeInTheDocument();
  });

  it('rend les matchs renvoyés par api.getMyMatches', async () => {
    api.getMyMatches.mockResolvedValue([match]);
    wrap();
    expect(await screen.findByText('6-4 / 6-3')).toBeInTheDocument();
    expect(screen.getByText(/Marie Durand/)).toBeInTheDocument();
    expect(screen.getByText(/Paul Roy/)).toBeInTheDocument();
    expect(screen.getByText(/Padel Arena Paris/)).toBeInTheDocument();
    expect(screen.getByText(/Court 2/)).toBeInTheDocument();
    expect(api.getMyMatches).toHaveBeenCalledWith('abc');
  });
});
