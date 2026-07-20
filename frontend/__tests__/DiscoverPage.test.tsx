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
    club: { slug: 'paris', name: 'Padel Paris', city: 'Paris', timezone: 'Europe/Paris', accentColor: '#5e93da', logoUrl: null, latitude: 48.8566, longitude: 2.3522, department: 'Paris', departmentCode: '75' },
    ...over,
  };
}

const MATCH_PARIS = makeMatch({
  id: 'paris',
  club: { slug: 'paris', name: 'Padel Paris', city: 'Paris', timezone: 'Europe/Paris', accentColor: '#5e93da', logoUrl: null, latitude: 48.8566, longitude: 2.3522, department: 'Paris', departmentCode: '75' },
});
const MATCH_LYON = makeMatch({
  id: 'lyon',
  club: { slug: 'lyon', name: 'Padel Lyon', city: 'Lyon', timezone: 'Europe/Paris', accentColor: '#5e93da', logoUrl: null, latitude: 45.7640, longitude: 4.8357, department: 'Rhône', departmentCode: '69' },
});

const wrap = () => render(<ThemeProvider><DiscoverPage /></ThemeProvider>);

// jsdom n'implémente pas scrollIntoView : stub commun à tous les tests (les ancres/deep-links
// l'appellent pour naviguer entre les sections empilées).
beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn();
});

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
  it('rend les 3 sections simultanément (plus d\'onglets)', async () => {
    wrap();
    expect(await screen.findAllByRole('link', { name: /Rejoindre la partie/ })).toHaveLength(2);
    expect(screen.getByTestId('discover-map')).toBeInTheDocument();
    expect(screen.getByText('Un club, une partie, un tournoi — partout autour de vous.')).toBeInTheDocument();
    await waitFor(() => expect(listNationalTournaments).toHaveBeenCalledTimes(1)); // fetch page, dès l'arrivée
    await waitFor(() => expect(listClubs).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Parties' })).not.toBeInTheDocument(); // plus de PillTabs onglets
  });

  it('les ancres portent les compteurs et scrollent vers la section', async () => {
    wrap();
    const anchor = await screen.findByRole('button', { name: 'Parties 2' });
    fireEvent.click(screen.getByRole('button', { name: /Clubs/ }));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(anchor).toBeInTheDocument();
  });

  it('#clubs au chargement scrolle vers la section clubs une fois les données arrivées', async () => {
    window.history.replaceState(null, '', '/decouvrir#clubs');
    wrap();
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
  });

  it('champ localisation : un code postal filtre les 3 sections par département', async () => {
    wrap();
    await screen.findAllByRole('link', { name: /Rejoindre la partie/ });
    fireEvent.change(screen.getByPlaceholderText('Ville, code postal ou département'), { target: { value: '69000' } });
    await waitFor(() => expect(screen.queryByText('Padel Paris')).not.toBeInTheDocument());
    expect(screen.getByText('Padel Lyon')).toBeInTheDocument();
    await waitFor(() => expect(listClubs).toHaveBeenLastCalledWith(expect.objectContaining({ dept: ['69'] })));
  });

  it('champ localisation : une ville filtre par nom', async () => {
    wrap();
    await screen.findAllByRole('link', { name: /Rejoindre la partie/ });
    fireEvent.change(screen.getByPlaceholderText('Ville, code postal ou département'), { target: { value: 'Lyon' } });
    await waitFor(() => expect(screen.queryByText('Padel Paris')).not.toBeInTheDocument());
    await waitFor(() => expect(listClubs).toHaveBeenLastCalledWith(expect.objectContaining({ city: 'Lyon' })));
  });

  it('hôte club : redirige vers la plateforme (hash préservé), rien rendu', () => {
    window.history.replaceState(null, '', '/decouvrir#clubs');
    clubCtx = { slug: 'demo', club: null, loading: false };
    const { container } = wrap();
    expect(hardNavigate).toHaveBeenCalledTimes(1);
    const url = hardNavigate.mock.calls[0][0] as string;
    expect(url).toContain('/decouvrir');
    expect(url).toContain('#clubs');
    expect(url).not.toContain('demo.');
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('discover-map')).not.toBeInTheDocument();
  });

  it('anonyme : pas de chip « À mon niveau », getMyRating jamais appelé', async () => {
    wrap();
    await screen.findAllByRole('link', { name: /Rejoindre la partie/ });
    expect(screen.queryByRole('button', { name: 'À mon niveau' })).not.toBeInTheDocument();
    expect(getMyRating).not.toHaveBeenCalled();
  });

  it('état vide parties : « Voir les clubs » scrolle vers la section clubs', async () => {
    listNationalOpenMatches.mockResolvedValue([]);
    wrap();
    const btn = await screen.findByRole('button', { name: /Voir les clubs/ });
    fireEvent.click(btn);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });
});
