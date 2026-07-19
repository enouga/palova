import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import type { NationalOpenMatch } from '@/lib/api';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

// Contexte club contrôlable : slug null = hôte plateforme, sinon hôte club (redirection).
let clubCtx: { slug: string | null; club: unknown; loading: boolean } = { slug: null, club: null, loading: false };
jest.mock('@/lib/ClubProvider', () => ({ useClub: () => clubCtx }));

const hardNavigate = jest.fn();
jest.mock('@/lib/nav', () => ({
  hardNavigate: (...a: unknown[]) => hardNavigate(...a),
  currentHost: () => 'localhost:3000',
}));

let authToken: string | null = null;
jest.mock('@/lib/useAuth', () => ({
  useAuth: () => ({ token: authToken, clubId: null, ready: true }),
  logout: jest.fn(),
}));

const listNationalOpenMatches = jest.fn();
const listNationalTournaments = jest.fn();
const getSports = jest.fn();
const listClubs = jest.fn();
const getMyRating = jest.fn();
const getMyProfile = jest.fn();

jest.mock('@/lib/api', () => ({
  api: {
    listNationalOpenMatches: (...a: unknown[]) => listNationalOpenMatches(...a),
    listNationalTournaments: (...a: unknown[]) => listNationalTournaments(...a),
    getSports: (...a: unknown[]) => getSports(...a),
    listClubs: (...a: unknown[]) => listClubs(...a),
    getMyRating: (...a: unknown[]) => getMyRating(...a),
    getMyProfile: (...a: unknown[]) => getMyProfile(...a),
  },
  assetUrl: (p: string | null) => p,
}));

// Import après les mocks (le module lit `api`/`useClub`/`useAuth`/`hardNavigate` au montage).
import DiscoverPage from '@/app/decouvrir/page';

function makeMatch(over: Partial<NationalOpenMatch> = {}): NationalOpenMatch {
  return {
    id: 'm1',
    resourceName: 'Court 1',
    sport: { key: 'padel', name: 'Padel' },
    startTime: '2026-07-08T16:00:00.000Z',
    endTime: '2026-07-08T17:30:00.000Z',
    maxPlayers: 4,
    spotsLeft: 2,
    full: false,
    targetLevelMin: null,
    targetLevelMax: null,
    players: [],
    club: { slug: 'paris', name: 'Padel Paris', city: 'Paris', timezone: 'Europe/Paris', accentColor: '#5e93da', logoUrl: null, latitude: 48.8566, longitude: 2.3522 },
    ...over,
  };
}

const MATCH_PARIS = makeMatch({
  id: 'paris',
  club: { slug: 'paris', name: 'Padel Paris', city: 'Paris', timezone: 'Europe/Paris', accentColor: '#5e93da', logoUrl: null, latitude: 48.8566, longitude: 2.3522 },
});
const MATCH_LYON = makeMatch({
  id: 'lyon',
  club: { slug: 'lyon', name: 'Padel Lyon', city: 'Lyon', timezone: 'Europe/Paris', accentColor: '#5e93da', logoUrl: null, latitude: 45.7640, longitude: 4.8357 },
});

const wrap = () => render(<ThemeProvider><DiscoverPage /></ThemeProvider>);

beforeEach(() => {
  jest.clearAllMocks();
  clubCtx = { slug: null, club: null, loading: false };
  authToken = null;
  window.history.replaceState(null, '', '/decouvrir');
  listNationalOpenMatches.mockResolvedValue([MATCH_PARIS, MATCH_LYON]);
  listNationalTournaments.mockResolvedValue([]);
  getSports.mockResolvedValue([]);
  listClubs.mockResolvedValue([]);
  getMyRating.mockResolvedValue(null);
  getMyProfile.mockResolvedValue({ preferredSport: null } as never);
});

describe('DiscoverPage', () => {
  it('par défaut : onglet Parties, titre Découvrir, 2 cartes, tournois non chargé', async () => {
    wrap();
    expect(screen.getByText('Découvrir')).toBeInTheDocument();
    await waitFor(() => expect(listNationalOpenMatches).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getAllByRole('link', { name: /Rejoindre la partie/ })).toHaveLength(2));
    expect(listNationalTournaments).not.toHaveBeenCalled();
  });

  it('?tab=clubs au montage : charge les clubs, masque l\'input « Ville ou région »', async () => {
    window.history.replaceState(null, '', '/decouvrir?tab=clubs');
    wrap();
    await waitFor(() => expect(listClubs).toHaveBeenCalled());
    expect(screen.queryByPlaceholderText('Ville ou région')).not.toBeInTheDocument();
  });

  it('?tab=inconnu retombe sur Parties', async () => {
    window.history.replaceState(null, '', '/decouvrir?tab=inconnu');
    wrap();
    await waitFor(() => expect(listNationalOpenMatches).toHaveBeenCalled());
    expect(listClubs).not.toHaveBeenCalled();
    expect(listNationalTournaments).not.toHaveBeenCalled();
  });

  it('clic sur l\'onglet Tournois : URL tab=tournois, calendrier chargé, titre interne masqué', async () => {
    wrap();
    fireEvent.click(screen.getByRole('button', { name: 'Tournois' }));
    await waitFor(() => expect(listNationalTournaments).toHaveBeenCalled());
    expect(window.location.search).toContain('tab=tournois');
    expect(screen.queryByText('Calendrier des tournois')).not.toBeInTheDocument();
  });

  it('hôte club : redirige vers la plateforme (URL préservée), rien rendu', () => {
    window.history.replaceState(null, '', '/decouvrir?tab=clubs');
    clubCtx = { slug: 'demo', club: null, loading: false };
    const { container } = wrap();
    expect(hardNavigate).toHaveBeenCalledTimes(1);
    const url = hardNavigate.mock.calls[0][0] as string;
    expect(url).toContain('/decouvrir?tab=clubs');
    expect(url).not.toContain('demo.');
    expect(container).toBeEmptyDOMElement();
  });

  it('anonyme : pas de chip « À mon niveau », getMyRating jamais appelé', async () => {
    wrap();
    await waitFor(() => expect(screen.getAllByRole('link', { name: /Rejoindre la partie/ })).toHaveLength(2));
    expect(screen.queryByRole('button', { name: 'À mon niveau' })).not.toBeInTheDocument();
    expect(getMyRating).not.toHaveBeenCalled();
  });

  it('ville partagée (input « Ville ») filtre les cartes Parties', async () => {
    wrap();
    await waitFor(() => expect(screen.getAllByRole('link', { name: /Rejoindre la partie/ })).toHaveLength(2));
    fireEvent.change(screen.getByPlaceholderText('Ville'), { target: { value: 'Lyon' } });
    await waitFor(() => expect(screen.getAllByRole('link', { name: /Rejoindre la partie/ })).toHaveLength(1));
    expect(screen.getByText('Padel Lyon')).toBeInTheDocument();
    expect(screen.queryByText('Padel Paris')).not.toBeInTheDocument();
  });

  it('état vide : « Voir les clubs » bascule sur l\'onglet Clubs', async () => {
    listNationalOpenMatches.mockResolvedValue([]);
    wrap();
    const btn = await screen.findByRole('button', { name: /Voir les clubs/ });
    fireEvent.click(btn);
    await waitFor(() => expect(listClubs).toHaveBeenCalled());
    expect(window.location.search).toContain('tab=clubs');
  });
});
