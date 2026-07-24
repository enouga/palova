import { render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));

let authToken: string | null = null;
jest.mock('@/lib/useAuth', () => ({ useAuth: () => ({ token: authToken, clubId: null, ready: true }), logout: jest.fn() }));

// Sections lourdes déjà testées isolément → stubs : cette suite vérifie l'ORCHESTRATION
// (qui est rendu selon la session, et avec quelles données). Le stub de DiscoverSections
// rend son `intro` : c'est par ce slot que passent « Comment ça marche » et les blocs perso.
const discoverProps = jest.fn();
jest.mock('@/components/platform/home/DiscoverSections', () => ({
  DiscoverSections: (p: { intro?: React.ReactNode; myClubSlugs: Set<string> | null }) => {
    discoverProps(p);
    return <div data-testid="discover">{p.intro}</div>;
  },
}));
jest.mock('@/components/match/ResultsToConfirm', () => ({ ResultsToConfirm: () => <div data-testid="results-confirm" /> }));
jest.mock('@/components/match/ResultsToRecord', () => ({ ResultsToRecord: () => <div data-testid="results-record" /> }));
jest.mock('@/components/platform/home/HomeAgenda', () => ({ HomeAgenda: () => <div data-testid="agenda" /> }));
jest.mock('@/components/platform/home/LevelCard', () => ({ LevelCard: () => <div data-testid="level" /> }));
jest.mock('@/components/platform/home/WalletCard', () => ({ WalletCard: () => <div data-testid="wallet" /> }));
jest.mock('@/components/platform/home/ManagedClubsCard', () => ({ ManagedClubsCard: () => <div data-testid="managed" /> }));
jest.mock('@/components/platform/ClubPitch', () => ({ ClubPitch: () => <div data-testid="club-pitch" /> }));
jest.mock('@/components/ProfileMenu', () => ({ ProfileMenu: () => <div data-testid="profile-menu" /> }));

const listNationalOpenMatches = jest.fn();
const listNationalTournaments = jest.fn();
const getMyProfile = jest.fn();
const getMyMemberships = jest.fn();
const empty = jest.fn();

jest.mock('@/lib/api', () => ({
  assetUrl: (p: string | null) => p,
  api: {
    listNationalOpenMatches: (...a: unknown[]) => listNationalOpenMatches(...a),
    listNationalTournaments: (...a: unknown[]) => listNationalTournaments(...a),
    getMyProfile: (...a: unknown[]) => getMyProfile(...a),
    getMyMemberships: (...a: unknown[]) => getMyMemberships(...a),
    getMyReservations: (...a: unknown[]) => empty(...a),
    getMyTournaments: (...a: unknown[]) => empty(...a),
    getMyEvents: (...a: unknown[]) => empty(...a),
    getMyLessons: (...a: unknown[]) => empty(...a),
  },
}));

import { PalovaHome } from '@/components/platform/PalovaHome';
import type { PlayerMembership } from '@/lib/api';

const membership = (slug: string, status: PlayerMembership['status'] = 'ACTIVE') =>
  ({ id: `m-${slug}`, slug, name: slug, city: null, logoUrl: null, accentColor: null, status } as unknown as PlayerMembership);

const wrap = () => render(<ThemeProvider><PalovaHome /></ThemeProvider>);

beforeEach(() => {
  jest.clearAllMocks();
  authToken = null;
  listNationalOpenMatches.mockResolvedValue([]);
  listNationalTournaments.mockResolvedValue([]);
  getMyProfile.mockResolvedValue({ firstName: 'Eric', lastName: 'N' });
  getMyMemberships.mockResolvedValue([]);
  empty.mockResolvedValue([]);
});

describe('PalovaHome — visiteur', () => {
  it('rend la surface SEO : <h1>, « Comment ça marche », panneau B2B, et les portes Connexion/S’inscrire', async () => {
    wrap();
    expect(await screen.findByRole('heading', { level: 1, name: /Trouvez où jouer/ })).toBeInTheDocument();
    expect(screen.getByText('Comment ça marche')).toBeInTheDocument();
    expect(screen.getByTestId('club-pitch')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Connexion' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /S'inscrire/ })).toBeInTheDocument();
    expect(screen.queryByTestId('profile-menu')).toBeNull();
  });

  it('porte quand même le moteur de découverte — mais aucun bloc personnel', async () => {
    wrap();
    expect(await screen.findByTestId('discover')).toBeInTheDocument();
    expect(screen.queryByTestId('results-confirm')).toBeNull();
    expect(screen.queryByTestId('results-record')).toBeNull();
    expect(screen.queryByTestId('agenda')).toBeNull();
    expect(screen.queryByTestId('level')).toBeNull();
    expect(screen.queryByTestId('wallet')).toBeNull();
    expect(screen.queryByTestId('managed')).toBeNull();
  });

  it('ne demande jamais les données du joueur', async () => {
    wrap();
    await screen.findByTestId('discover');
    expect(getMyProfile).not.toHaveBeenCalled();
    expect(getMyMemberships).not.toHaveBeenCalled();
  });

  it('pas de filtre « Mes clubs » : `myClubSlugs` reste null', async () => {
    wrap();
    await screen.findByTestId('discover');
    expect(discoverProps).toHaveBeenCalledWith(expect.objectContaining({ myClubSlugs: null }));
  });
});

describe('PalovaHome — connecté', () => {
  beforeEach(() => { authToken = 'tok'; });

  it('salue le joueur et empile ses blocs, sans la copie marketing', async () => {
    wrap();
    expect(await screen.findByText('Bonjour Eric')).toBeInTheDocument();
    expect(screen.getByTestId('agenda')).toBeInTheDocument();
    expect(screen.getByTestId('level')).toBeInTheDocument();
    expect(screen.getByTestId('wallet')).toBeInTheDocument();
    expect(screen.getByTestId('managed')).toBeInTheDocument();
    expect(screen.getByTestId('profile-menu')).toBeInTheDocument();

    expect(screen.queryByRole('heading', { level: 1, name: /Trouvez où jouer/ })).toBeNull();
    expect(screen.queryByText('Comment ça marche')).toBeNull();
    expect(screen.queryByTestId('club-pitch')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Connexion' })).toBeNull();
  });

  it('garde le MÊME moteur de découverte que le visiteur', async () => {
    wrap();
    expect(await screen.findByTestId('discover')).toBeInTheDocument();
  });

  // Les résultats de match ont quitté l'accueil : ils vivent sur le Club-house, /parties
  // et /me/matches. L'accueil plateforme reste tourné vers « où jouer ».
  it('ne porte PAS les résultats à confirmer / à saisir', async () => {
    wrap();
    await screen.findByTestId('discover');
    expect(screen.queryByTestId('results-confirm')).toBeNull();
    expect(screen.queryByTestId('results-record')).toBeNull();
  });

  it('passe ses clubs ACTIFS au filtre « Mes clubs » (les autres statuts sont ignorés)', async () => {
    getMyMemberships.mockResolvedValue([membership('padel-arena'), membership('vieux-club', 'BLOCKED')]);
    wrap();
    await waitFor(() => {
      expect(discoverProps).toHaveBeenCalledWith(expect.objectContaining({ myClubSlugs: new Set(['padel-arena']) }));
    });
  });

  it('sans adhésion active, `myClubSlugs` reste null — jamais de chip morte', async () => {
    getMyMemberships.mockResolvedValue([membership('vieux-club', 'BLOCKED')]);
    wrap();
    await screen.findByTestId('discover');
    await waitFor(() => expect(getMyMemberships).toHaveBeenCalled());
    expect(discoverProps).not.toHaveBeenCalledWith(expect.objectContaining({ myClubSlugs: expect.any(Set) }));
  });

  it('un profil en échec n’éteint que la salutation (la page reste debout)', async () => {
    getMyProfile.mockRejectedValue(new Error('boom'));
    wrap();
    expect(await screen.findByTestId('discover')).toBeInTheDocument();
    expect(screen.getByText('Bonjour')).toBeInTheDocument();
  });
});
