import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { ClubDirectory } from '@/components/ClubDirectory';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  usePathname: () => '/clubs',
}));

jest.mock('@/components/ClubCard', () => ({
  ClubCard: ({ club, defaultCover }: { club: { name: string }; defaultCover?: string }) =>
    <div data-testid="club-card" data-cover={defaultCover}>{club.name}</div>,
}));

const getSports = jest.fn();
const getMyProfile = jest.fn();
const listClubs = jest.fn();

jest.mock('@/lib/api', () => ({
  api: {
    getSports: (...a: unknown[]) => getSports(...a),
    getMyProfile: (...a: unknown[]) => getMyProfile(...a),
    listClubs: (...a: unknown[]) => listClubs(...a),
  },
  assetUrl: (u: string | null) => u,
}));

const sports = [
  { key: 'padel', name: 'Padel', icon: null, id: 's1', published: true },
  { key: 'tennis', name: 'Tennis', icon: null, id: 's2', published: true },
];

let authToken: string | null = 'tok';
jest.mock('@/lib/useAuth', () => ({
  useAuth: () => ({ token: authToken, ready: true }),
}));

const wrap = () => render(<ThemeProvider><ClubDirectory /></ThemeProvider>);

beforeEach(() => {
  jest.clearAllMocks();
  authToken = 'tok';
  getSports.mockResolvedValue(sports);
  listClubs.mockResolvedValue([]);
  getMyProfile.mockResolvedValue({
    id: 'u1', email: 'test@palova.fr', firstName: 'Test', lastName: 'User',
    phone: null, sex: null, birthDate: null, avatarUrl: null, locale: 'fr',
    isSuperAdmin: false, showInLeaderboard: false,
    preferredSport: { id: 's2', key: 'tennis', name: 'Tennis' },
  });
});

it('initialise le filtre sur le sport préféré du joueur', async () => {
  wrap();
  await waitFor(() =>
    expect(listClubs).toHaveBeenCalledWith(expect.objectContaining({ sport: 'tennis' }))
  );
});

it('sans préférence (preferredSport null), ne force aucun sport', async () => {
  getMyProfile.mockResolvedValue({
    id: 'u1', email: 'test@palova.fr', firstName: 'Test', lastName: 'User',
    phone: null, sex: null, birthDate: null, avatarUrl: null, locale: 'fr',
    isSuperAdmin: false, showInLeaderboard: false,
    preferredSport: null,
  });
  wrap();
  await waitFor(() => expect(listClubs).toHaveBeenCalled());
  // Toutes les invocations : sport doit être undefined (pas de filtre forcé)
  const calls = listClubs.mock.calls as [{ sport?: string }][];
  calls.forEach((args) => expect(args[0].sport).toBeUndefined());
});

it('sans token, ne charge pas le profil et ne force aucun sport', async () => {
  authToken = null;
  wrap();
  await waitFor(() => expect(listClubs).toHaveBeenCalled());
  expect(getMyProfile).not.toHaveBeenCalled();
  const calls = listClubs.mock.calls as [{ sport?: string }][];
  calls.forEach((args) => expect(args[0].sport).toBeUndefined());
});

it('« Autour de moi » relance listClubs avec lat/lng', async () => {
  const ok = (cb: PositionCallback) => cb({ coords: { latitude: 48.86, longitude: 2.35 } } as GeolocationPosition);
  Object.defineProperty(global.navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: ok } });

  wrap();
  fireEvent.click(await screen.findByRole('button', { name: /autour de moi/i }));

  await waitFor(() =>
    expect(listClubs).toHaveBeenCalledWith(expect.objectContaining({ lat: 48.86, lng: 2.35 })),
  );
});

it('un échec réseau affiche un message distinct de « aucun club » + un bouton Réessayer', async () => {
  authToken = null;
  listClubs.mockRejectedValueOnce(new Error('network'));
  wrap();
  await screen.findByText(/impossible de charger les clubs/i);
  expect(screen.queryByText('Aucun club ne correspond.')).not.toBeInTheDocument();

  listClubs.mockResolvedValueOnce([]);
  fireEvent.click(screen.getByRole('button', { name: /réessayer/i }));
  await screen.findByText('Aucun club ne correspond.');
});

it('fait tourner la banque de couvertures → cartes voisines distinctes', async () => {
  authToken = null; // évite le filtre sport, simplifie le chargement
  const club = (id: string) => ({
    id, slug: id, name: id.toUpperCase(), city: null, description: null,
    accentColor: '#123456', logoUrl: null, coverImageUrl: null, sports: [], resourceCount: 1,
  });
  listClubs.mockResolvedValue([club('a'), club('b'), club('c')]);
  wrap();
  await waitFor(() => expect(screen.getAllByTestId('club-card')).toHaveLength(3));
  const covers = screen.getAllByTestId('club-card').map((el) => el.getAttribute('data-cover'));
  expect(new Set(covers).size).toBe(3); // 3 cartes → 3 couvertures distinctes (rotation)
});

it('mode contrôlé (props city/coords) : transmet les valeurs à listClubs et masque ville + géoloc', async () => {
  authToken = null; // simplifie : pas de filtre sport asynchrone en plus
  render(
    <ThemeProvider>
      <ClubDirectory city="Lyon" coords={{ lat: 45.75, lng: 4.85 }} />
    </ThemeProvider>,
  );

  await waitFor(() =>
    expect(listClubs).toHaveBeenCalledWith(
      expect.objectContaining({ city: 'Lyon', lat: 45.75, lng: 4.85 }),
    ),
  );

  expect(screen.queryByPlaceholderText('Ville ou région')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /autour de moi/i })).not.toBeInTheDocument();
  expect(screen.getByPlaceholderText('Nom du club')).toBeInTheDocument();
});

it('mode contrôlé : un changement de la prop city relance listClubs avec la nouvelle valeur', async () => {
  authToken = null;
  const { rerender } = render(
    <ThemeProvider><ClubDirectory city="Lyon" /></ThemeProvider>,
  );
  await waitFor(() =>
    expect(listClubs).toHaveBeenCalledWith(expect.objectContaining({ city: 'Lyon' })),
  );

  rerender(
    <ThemeProvider><ClubDirectory city="Marseille" /></ThemeProvider>,
  );
  await waitFor(() =>
    expect(listClubs).toHaveBeenCalledWith(expect.objectContaining({ city: 'Marseille' })),
  );
});

const clubFixture = {
  id: 'c1', slug: 'club-1', name: 'Padel Club 1', city: 'Paris', description: null,
  accentColor: '#123456', logoUrl: null, coverImageUrl: null, sports: [], resourceCount: 1,
};

it('prop deptCodes → listClubs reçoit dept', async () => {
  authToken = null;
  render(<ThemeProvider><ClubDirectory deptCodes={['2A', '2B']} /></ThemeProvider>);
  await waitFor(() => expect(listClubs).toHaveBeenCalledWith(expect.objectContaining({ dept: ['2A', '2B'] })));
});

it('onCount reçoit le nombre de clubs affichés', async () => {
  authToken = null;
  listClubs.mockResolvedValue([clubFixture]);
  const onCount = jest.fn();
  render(<ThemeProvider><ClubDirectory onCount={onCount} /></ThemeProvider>);
  await waitFor(() => expect(onCount).toHaveBeenLastCalledWith(1));
});
