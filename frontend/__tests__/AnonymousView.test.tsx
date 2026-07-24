import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import AnonymousView from '@/components/legacy/AnonymousView';

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

const pushMock = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: (...a: unknown[]) => pushMock(...a), replace: jest.fn(), back: jest.fn() }),
}));

const wrap = () => render(<ThemeProvider><AnonymousView /></ThemeProvider>);

describe('AnonymousView', () => {
  beforeEach(() => {
    mockMatches.mockReset().mockResolvedValue([]);
    mockTournaments.mockReset().mockResolvedValue([]);
    pushMock.mockReset();
  });

  it('rend le hero, l\'annuaire, le mode d\'emploi et le pitch club', async () => {
    wrap();
    expect(screen.getByText(/Trouvez où jouer/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Ville, code postal ou département')).toBeInTheDocument();
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

  it('avec parties + tournois : pouls chiffré, sections vedette et tournois', async () => {
    mockMatches.mockResolvedValue([{ id: 'm1' }]);
    mockTournaments.mockResolvedValue([{ id: 't1' }, { id: 't2' }]);
    wrap();

    expect(await screen.findByText(/1 partie à rejoindre cette semaine/i)).toBeInTheDocument();
    expect(screen.getByText(/2 tournois à venir/i)).toBeInTheDocument();
    expect(screen.getByText(/Ça joue bientôt/i)).toBeInTheDocument();
    expect(screen.getByTestId('national-open-matches')).toBeInTheDocument();
    expect(screen.getByText(/Prochains tournois/i)).toBeInTheDocument();
    expect(screen.getByTestId('upcoming-tournaments')).toBeInTheDocument();
  });

  it('la recherche du hero navigue vers /decouvrir (q= saisi, pres=1 en géoloc)', async () => {
    wrap();
    const input = screen.getByPlaceholderText('Ville, code postal ou département');
    fireEvent.change(input, { target: { value: ' Lyon ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(pushMock).toHaveBeenCalledWith('/decouvrir?q=Lyon');
    fireEvent.click(screen.getByRole('button', { name: /Autour de moi/ }));
    expect(pushMock).toHaveBeenCalledWith('/decouvrir?pres=1');
    await waitFor(() => expect(mockMatches).toHaveBeenCalled());
  });
});
