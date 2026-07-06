import { render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import AnonymousView from '@/components/platform/AnonymousView';

// Sections lourdes mockées : AnonymousView est testé sur sa structure et son pouls.
jest.mock('@/components/ClubDirectory', () => ({ ClubDirectory: () => <div data-testid="club-directory" /> }));
jest.mock('@/components/calendar/UpcomingTournaments', () => ({ UpcomingTournaments: () => <div data-testid="upcoming-tournaments" /> }));
jest.mock('@/components/platform/NationalOpenMatches', () => ({ NationalOpenMatches: () => <div data-testid="national-open-matches" /> }));

const mockMatches = jest.fn();
const mockTournaments = jest.fn();
jest.mock('@/lib/api', () => ({
  assetUrl: (p: string | null) => p,
  api: {
    listNationalOpenMatches: (...a: unknown[]) => mockMatches(...a),
    listNationalTournaments: (...a: unknown[]) => mockTournaments(...a),
  },
}));

const wrap = () => render(<ThemeProvider><AnonymousView /></ThemeProvider>);

describe('AnonymousView', () => {
  beforeEach(() => {
    mockMatches.mockReset().mockResolvedValue([]);
    mockTournaments.mockReset().mockResolvedValue([]);
  });

  it('rend le hero, l\'annuaire, le mode d\'emploi et le pitch club', async () => {
    wrap();
    expect(screen.getByText(/Le padel se joue ici/i)).toBeInTheDocument();
    expect(screen.getByTestId('club-directory')).toBeInTheDocument();
    expect(screen.getByText(/Comment ça marche/i)).toBeInTheDocument();
    expect(screen.getByText(/Vous gérez un club/i)).toBeInTheDocument();
    await waitFor(() => expect(mockMatches).toHaveBeenCalled());
  });

  it('CTAs : Connexion → /login, S\'inscrire → /register, Découvrir → /offres, Créer mon club → /clubs/new', async () => {
    wrap();
    expect(screen.getByRole('link', { name: /Connexion/i })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: /S['’]inscrire/i })).toHaveAttribute('href', '/register');
    expect(screen.getByRole('link', { name: /Découvrir/i })).toHaveAttribute('href', '/offres');
    expect(screen.getByRole('link', { name: /Créer mon club/i })).toHaveAttribute('href', '/clubs/new');
    await waitFor(() => expect(mockMatches).toHaveBeenCalled());
  });

  it('sans parties ni tournois : pas de pouls, pas de section « Ça joue bientôt » ni tournois', async () => {
    wrap();
    await waitFor(() => expect(mockMatches).toHaveBeenCalled());
    expect(screen.queryByText(/à rejoindre cette semaine/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Ça joue bientôt/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('national-open-matches')).not.toBeInTheDocument();
    expect(screen.queryByTestId('upcoming-tournaments')).not.toBeInTheDocument();
  });

  it('avec parties + tournois : pouls chiffré, sections vedette et tournois, CTA « Voir les parties »', async () => {
    mockMatches.mockResolvedValue([{ id: 'm1' }]);
    mockTournaments.mockResolvedValue([{ id: 't1' }, { id: 't2' }]);
    wrap();

    expect(await screen.findByText(/1 partie à rejoindre cette semaine/i)).toBeInTheDocument();
    expect(screen.getByText(/2 tournois à venir/i)).toBeInTheDocument();
    expect(screen.getByText(/Ça joue bientôt/i)).toBeInTheDocument();
    expect(screen.getByTestId('national-open-matches')).toBeInTheDocument();
    expect(screen.getByText(/Prochains tournois/i)).toBeInTheDocument();
    expect(screen.getByTestId('upcoming-tournaments')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Voir les parties/i })).toHaveAttribute('href', '#parties');
  });
});
