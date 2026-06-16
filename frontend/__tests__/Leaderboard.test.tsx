import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { Leaderboard } from '@/components/openmatch/Leaderboard';

// useTheme exige un ThemeProvider (cf. PlayerPills.test.tsx).
const wrap = (ui: React.ReactNode) => render(<ThemeProvider>{ui}</ThemeProvider>);

const club = { slug: 'padel-arena', name: 'Padel Arena' } as any;

const updateMyProfile = jest.fn();
const getClubLeaderboard = jest.fn();
jest.mock('@/lib/api', () => ({
  api: {
    getClubLeaderboard: (...a: any[]) => getClubLeaderboard(...a),
    updateMyProfile: (...a: any[]) => updateMyProfile(...a),
  },
  assetUrl: (u: string | null) => u,
}));
jest.mock('@/lib/useAuth', () => ({ useAuth: () => ({ token: 't', ready: true }) }));

function payload(over: any = {}) {
  return {
    sport: 'padel',
    entries: [
      { rank: 1, userId: 'u1', firstName: 'Ana', lastName: 'A', avatarUrl: null, level: 6.2, tier: 'Avancé', matchesPlayed: 30 },
      { rank: 2, userId: 'u2', firstName: 'Bea', lastName: 'B', avatarUrl: null, level: 5.0, tier: 'Confirmé', matchesPlayed: 12 },
    ],
    me: { optedIn: true, ranked: true, rank: 1, level: 6.2, matchesPlayed: 30, matchesToGo: 0 },
    ...over,
  };
}

beforeEach(() => { jest.clearAllMocks(); });

it('affiche les lignes classées dans l ordre', async () => {
  getClubLeaderboard.mockResolvedValue(payload());
  wrap(<Leaderboard club={club} viewerUserId="u1" />);
  await screen.findByText('Ana A');
  const names = screen.getAllByTestId('lb-name').map((n) => n.textContent);
  expect(names).toEqual(['Ana A', 'Bea B']);
});

it('panneau moi : opt-in mais pas assez de matchs → matchesToGo', async () => {
  getClubLeaderboard.mockResolvedValue(payload({ entries: [], me: { optedIn: true, ranked: false, rank: null, level: 3.4, matchesPlayed: 3, matchesToGo: 2 } }));
  wrap(<Leaderboard club={club} viewerUserId="u9" />);
  await screen.findByText(/Encore 2 matchs/i);
});

it('panneau moi : pas opté → CTA qui appelle updateMyProfile', async () => {
  getClubLeaderboard.mockResolvedValue(payload({ entries: [], me: { optedIn: false, ranked: false, rank: null, level: null, matchesPlayed: 0, matchesToGo: 5 } }));
  updateMyProfile.mockResolvedValue({});
  getClubLeaderboard.mockResolvedValueOnce(payload({ entries: [], me: { optedIn: false, ranked: false, rank: null, level: null, matchesPlayed: 0, matchesToGo: 5 } }));
  wrap(<Leaderboard club={club} viewerUserId="u9" />);
  const cta = await screen.findByRole('button', { name: /Apparaître dans le classement/i });
  fireEvent.click(cta);
  await waitFor(() => expect(updateMyProfile).toHaveBeenCalledWith({ showInLeaderboard: true }, 't'));
});

it('état vide quand aucun joueur classé et déjà opté', async () => {
  getClubLeaderboard.mockResolvedValue(payload({ entries: [], me: { optedIn: true, ranked: false, rank: null, level: 6.0, matchesPlayed: 9, matchesToGo: 0 } }));
  wrap(<Leaderboard club={club} viewerUserId="u9" />);
  await screen.findByText(/Aucun joueur classé/i);
});
