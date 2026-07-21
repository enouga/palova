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

// ProfileMenu appelle getMyProfile dès qu'un token est présent et attend un profil complet
// (firstName/lastName) — hors sujet ici (on ne teste que le filtre « Mes clubs »), donc mocké
// pour ne pas avoir à maintenir un fixture de profil complet dans ce fichier.
jest.mock('@/components/ProfileMenu', () => ({ ProfileMenu: () => <div data-testid="profile-menu" /> }));

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
const getMyMemberships = jest.fn();

jest.mock('@/lib/api', () => ({
  api: {
    listNationalOpenMatches: (...a: unknown[]) => listNationalOpenMatches(...a),
    listNationalTournaments: (...a: unknown[]) => listNationalTournaments(...a),
    getSports: (...a: unknown[]) => getSports(...a),
    listClubs: (...a: unknown[]) => listClubs(...a),
    getMyRating: (...a: unknown[]) => getMyRating(...a),
    getMyProfile: (...a: unknown[]) => getMyProfile(...a),
    getMyMemberships: (...a: unknown[]) => getMyMemberships(...a),
  },
  assetUrl: (p: string | null) => p,
}));

// Import après les mocks (le module lit `api`/`useClub`/`useAuth`/`hardNavigate` au montage).
import { DiscoverClient } from '@/app/decouvrir/DiscoverClient';
import type { NationalTournament, PlayerMembership } from '@/lib/api';

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

function makeTournament(over: Partial<NationalTournament> = {}): NationalTournament {
  return {
    id: 't1', clubId: 'c', clubSportId: 'cs', name: 'Tournoi', category: 'P500', gender: 'MEN', openToWomen: true,
    description: null, contactInfo: null, startTime: '2026-07-02T12:00:00Z', endTime: null, registrationDeadline: '2026-07-01T12:00:00Z',
    maxTeams: 16, entryFee: null, status: 'PUBLISHED', confirmedCount: 0, waitlistCount: 0,
    club: { slug: 'paris', name: 'Padel Paris', city: 'Paris', department: 'Paris', departmentCode: '75', timezone: 'Europe/Paris', accentColor: '#5e93da', logoUrl: null, latitude: 48.85, longitude: 2.35 },
    ...over,
  } as NationalTournament;
}

const TOURNAMENT_PARIS = makeTournament({ id: 'tparis', name: 'Tournoi Paris' });
const TOURNAMENT_LYON = makeTournament({
  id: 'tlyon', name: 'Tournoi Lyon',
  club: { slug: 'lyon', name: 'Padel Lyon', city: 'Lyon', department: 'Rhône', departmentCode: '69', timezone: 'Europe/Paris', accentColor: '#5e93da', logoUrl: null, latitude: 45.76, longitude: 4.83 },
});

const CLUB_PARIS_SUMMARY = { id: 'c-paris', slug: 'paris', name: 'Padel Paris', city: 'Paris', region: null, latitude: 48.8566, longitude: 2.3522, description: null, accentColor: '#5e93da', logoUrl: null, coverImageUrl: null, sports: [], resourceCount: 1 };
const CLUB_LYON_SUMMARY = { id: 'c-lyon', slug: 'lyon', name: 'Padel Lyon', city: 'Lyon', region: null, latitude: 45.7640, longitude: 4.8357, description: null, accentColor: '#5e93da', logoUrl: null, coverImageUrl: null, sports: [], resourceCount: 1 };

function membership(slug: string, status: PlayerMembership['status'] = 'ACTIVE'): PlayerMembership {
  return { clubId: `c-${slug}`, slug, isSubscriber: false, status, club: { ...CLUB_PARIS_SUMMARY, slug, name: `Padel ${slug}` } };
}

const wrap = () => render(<ThemeProvider><DiscoverClient /></ThemeProvider>);

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
  getMyMemberships.mockResolvedValue([]);
});

describe('DiscoverPage', () => {
  it('rend les 3 sections simultanément (plus d\'onglets)', async () => {
    wrap();
    expect(await screen.findAllByRole('link', { name: /Rejoindre la partie/ })).toHaveLength(2);
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
  });

  it('anonyme : pas de chip « À mon niveau », getMyRating jamais appelé', async () => {
    wrap();
    await screen.findAllByRole('link', { name: /Rejoindre la partie/ });
    expect(screen.queryByRole('button', { name: 'À mon niveau' })).not.toBeInTheDocument();
    expect(getMyRating).not.toHaveBeenCalled();
  });

  it('anonyme : pas de chip « Mes clubs », getMyMemberships jamais appelé', async () => {
    wrap();
    await screen.findAllByRole('link', { name: /Rejoindre la partie/ });
    expect(screen.queryByRole('button', { name: 'Mes clubs' })).not.toBeInTheDocument();
    expect(getMyMemberships).not.toHaveBeenCalled();
  });

  it('connecté sans adhésion active (0, ou seulement BLOCKED) : pas de chip « Mes clubs »', async () => {
    authToken = 'tok';
    getMyMemberships.mockResolvedValue([membership('lyon', 'BLOCKED')]);
    wrap();
    await screen.findAllByRole('link', { name: /Rejoindre la partie/ });
    await waitFor(() => expect(getMyMemberships).toHaveBeenCalledWith('tok'));
    expect(screen.queryByRole('button', { name: 'Mes clubs' })).not.toBeInTheDocument();
  });

  it('connecté avec une adhésion ACTIVE (Lyon) : « Mes clubs » rétrécit les 3 sections, re-clic restaure', async () => {
    authToken = 'tok';
    getMyMemberships.mockResolvedValue([membership('lyon')]);
    listNationalTournaments.mockResolvedValue([TOURNAMENT_PARIS, TOURNAMENT_LYON]);
    listClubs.mockResolvedValue([CLUB_PARIS_SUMMARY, CLUB_LYON_SUMMARY]);
    wrap();

    await screen.findByText('Tournoi Paris');
    await waitFor(() => expect(listClubs).toHaveBeenCalled());
    expect(screen.getAllByText(/^Padel (Paris|Lyon)$/).length).toBeGreaterThan(0);

    const chip = await screen.findByRole('button', { name: 'Mes clubs' });
    fireEvent.click(chip);

    await waitFor(() => expect(screen.queryByText('Tournoi Paris')).not.toBeInTheDocument());
    expect(screen.getByText('Tournoi Lyon')).toBeInTheDocument();
    expect(screen.queryByText('Padel Paris')).not.toBeInTheDocument();

    fireEvent.click(chip);
    await waitFor(() => expect(screen.getByText('Tournoi Paris')).toBeInTheDocument());
  });

  it('état vide parties : « Voir les clubs » scrolle vers la section clubs', async () => {
    listNationalOpenMatches.mockResolvedValue([]);
    wrap();
    const btn = await screen.findByRole('button', { name: /Voir les clubs/ });
    fireEvent.click(btn);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('?q= préremplit la localisation et filtre dès l\'arrivée', async () => {
    window.history.replaceState(null, '', '/decouvrir?q=Lyon');
    wrap();
    await screen.findAllByRole('link', { name: /Rejoindre la partie/ });
    expect(screen.getByPlaceholderText('Ville, code postal ou département')).toHaveValue('Lyon');
    await waitFor(() => expect(screen.queryByText('Padel Paris')).not.toBeInTheDocument());
    expect(screen.getByText('Padel Lyon')).toBeInTheDocument();
  });

  it('?pres=1 déclenche la géolocalisation à l\'arrivée', async () => {
    const getCurrentPosition = jest.fn();
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition } });
    window.history.replaceState(null, '', '/decouvrir?pres=1');
    wrap();
    await waitFor(() => expect(getCurrentPosition).toHaveBeenCalled());
  });
});
