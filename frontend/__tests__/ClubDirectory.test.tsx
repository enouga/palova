import { render, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { ClubDirectory } from '@/components/ClubDirectory';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  usePathname: () => '/clubs',
}));

jest.mock('@/components/ClubCard', () => ({
  ClubCard: ({ club }: { club: { name: string } }) => <div>{club.name}</div>,
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
