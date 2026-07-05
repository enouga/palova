import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { Leaderboard } from '@/components/openmatch/Leaderboard';

// useTheme exige un ThemeProvider (cf. PlayerPills.test.tsx).
const wrap = (ui: React.ReactNode) => render(<ThemeProvider>{ui}</ThemeProvider>);

const clubSports = [
  { id: 'cs1', slotStepMin: 30, durationsMin: [60], sport: { id: 's1', key: 'padel', name: 'Padel', resourceNoun: 'court', defaultSlotStepMin: 30, defaultDurationsMin: [60], icon: null, surfaces: [], published: true, hasLighting: false }, resources: [] },
  { id: 'cs2', slotStepMin: 30, durationsMin: [60], sport: { id: 's2', key: 'tennis', name: 'Tennis', resourceNoun: 'court', defaultSlotStepMin: 30, defaultDurationsMin: [60], icon: null, surfaces: [], published: true, hasLighting: false }, resources: [] },
];
const club = { slug: 'padel-arena', name: 'Padel Arena', clubSports } as any;
const clubSingle = { slug: 'padel-arena', name: 'Padel Arena', clubSports: [clubSports[0]] } as any;

const updateMyProfile = jest.fn();
const getClubLeaderboard = jest.fn();
const getMyProfile = jest.fn();
const getMyRating = jest.fn();
const getMyMatches = jest.fn();
const getRatingHistory = jest.fn();
jest.mock('@/lib/api', () => ({
  api: {
    getClubLeaderboard: (...a: any[]) => getClubLeaderboard(...a),
    updateMyProfile: (...a: any[]) => updateMyProfile(...a),
    getMyProfile: (...a: any[]) => getMyProfile(...a),
    getMyRating: (...a: any[]) => getMyRating(...a),
    getMyMatches: (...a: any[]) => getMyMatches(...a),
    getRatingHistory: (...a: any[]) => getRatingHistory(...a),
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
    me: { optedIn: true, ranked: true, rank: 1, level: 6.2, matchesPlayed: 30, matchesToGo: 0, wins: 0, losses: 0, streak: 0 },
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // Défaut : pas de sport préféré (évite des erreurs dans les tests qui ne le testent pas)
  getMyProfile.mockResolvedValue({ preferredSport: null });
  getMyRating.mockResolvedValue(null);
  getMyMatches.mockResolvedValue([]);
  getRatingHistory.mockResolvedValue([]);
});

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

it('sélecteur de sport : défaut préféré si disponible, changement recharge', async () => {
  getMyProfile.mockResolvedValue({ preferredSport: { id: 's2', key: 'tennis', name: 'Tennis' } });
  getClubLeaderboard.mockResolvedValue(payload());
  wrap(<Leaderboard club={club} viewerUserId="u1" />);
  // Attend que getClubLeaderboard soit appelé avec 'tennis' (sport préféré)
  await waitFor(() =>
    expect(getClubLeaderboard).toHaveBeenCalledWith('padel-arena', 't', 'tennis')
  );
  // Le sélecteur est rendu avec la valeur tennis
  const select = screen.getByRole('combobox');
  expect(select).toHaveValue('tennis');
  // Changer vers padel
  fireEvent.change(select, { target: { value: 'padel' } });
  await waitFor(() =>
    expect(getClubLeaderboard).toHaveBeenCalledWith('padel-arena', 't', 'padel')
  );
});

it('sélecteur : sport préféré absent du club → défaut = 1er sport du club', async () => {
  getMyProfile.mockResolvedValue({ preferredSport: { id: 's99', key: 'squash', name: 'Squash' } });
  getClubLeaderboard.mockResolvedValue(payload());
  wrap(<Leaderboard club={club} viewerUserId="u1" />);
  // Le 1er sport du club = padel
  await waitFor(() =>
    expect(getClubLeaderboard).toHaveBeenCalledWith('padel-arena', 't', 'padel')
  );
  const select = screen.getByRole('combobox');
  expect(select).toHaveValue('padel');
});

it("selecteur masque si le club n'a qu'un seul sport", async () => {
  getMyProfile.mockResolvedValue({ preferredSport: null });
  getClubLeaderboard.mockResolvedValue(payload());
  wrap(<Leaderboard club={clubSingle} viewerUserId="u1" />);
  await screen.findByText('Ana A');
  expect(screen.queryByRole('combobox')).toBeNull();
});

it('panneau moi : hero niveau + tuiles KPI quand il y a des matchs', async () => {
  getClubLeaderboard.mockResolvedValue(payload({
    me: { optedIn: true, ranked: true, rank: 3, level: 5.2, matchesPlayed: 40, matchesToGo: 0, wins: 18, losses: 7, streak: 3 },
  }));
  wrap(<Leaderboard club={club} viewerUserId="u1" />);
  await screen.findByText(/Votre niveau/i);
  expect(screen.getByText('5.2')).toBeInTheDocument();
  expect(screen.getByText(/sur 2 au classement du club/i)).toBeInTheDocument();
  // Tuiles KPI : Matchs / Victoires / Série
  expect(screen.getByText('25')).toBeInTheDocument();
  expect(screen.getByText('72 %')).toBeInTheDocument();
  expect(screen.getByText('18 V · 7 D')).toBeInTheDocument();
  expect(screen.getByText('3 V')).toBeInTheDocument();
});

it('panneau moi : série de défaites → tuile Série en défaites', async () => {
  getClubLeaderboard.mockResolvedValue(payload({
    me: { optedIn: true, ranked: true, rank: 4, level: 4.8, matchesPlayed: 30, matchesToGo: 0, wins: 10, losses: 12, streak: -2 },
  }));
  wrap(<Leaderboard club={club} viewerUserId="u1" />);
  await screen.findByText('2 D');
});

it('bandeau moi : pas de rangée de stats sans match décidé', async () => {
  getClubLeaderboard.mockResolvedValue(payload({
    entries: [],
    me: { optedIn: true, ranked: false, rank: null, level: 5.0, matchesPlayed: 9, matchesToGo: 0, wins: 0, losses: 0, streak: 0 },
  }));
  wrap(<Leaderboard club={club} viewerUserId="u9" />);
  await screen.findByText(/Aucun joueur classé/i);
  expect(screen.queryByText(/de victoires/i)).toBeNull();
});
