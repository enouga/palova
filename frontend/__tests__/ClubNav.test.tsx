import { render, screen } from '@testing-library/react';
import { ClubNav } from '../components/ClubNav';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('next/navigation', () => ({
  usePathname: () => '/tournois',
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));
jest.mock('../lib/api', () => ({ api: { getMyMemberships: jest.fn().mockResolvedValue([]) } }));

const club = { id: 'c1', slug: 'demo', name: 'Club Démo', logoUrl: null } as never;
const wrap = () => render(<ThemeProvider><ClubNav club={club} /></ThemeProvider>);

function clearCookies() {
  document.cookie = 'token=; max-age=0; path=/';
  document.cookie = 'clubId=; max-age=0; path=/';
}

describe('ClubNav', () => {
  beforeEach(clearCookies);
  afterEach(clearCookies);

  it('affiche les onglets Réserver, Tournois et Infos', () => {
    wrap();
    expect(screen.getByText('Réserver')).toBeInTheDocument();
    expect(screen.getByText('Tournois')).toBeInTheDocument();
    expect(screen.getByText('Infos')).toBeInTheDocument();
  });

  it('la marque Palova vise le domaine racine (pas le sous-domaine du club)', () => {
    wrap();
    const link = screen.getByLabelText('Accueil Palova');
    expect(link).toHaveAttribute('href');
    expect(link.getAttribute('href')).not.toContain('demo.');
  });

  it('affiche le nom du club en titre non cliquable', () => {
    wrap();
    expect(screen.getByText('Club Démo')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Club Démo' })).not.toBeInTheDocument();
  });

  it("surligne l'onglet actif selon le chemin courant", () => {
    wrap();
    expect(screen.getByText('Tournois').closest('a')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Réserver').closest('a')).not.toHaveAttribute('aria-current');
  });

  it('montre « Connexion » et masque « Mes réservations » sans session', () => {
    wrap();
    expect(screen.getByText('Connexion')).toBeInTheDocument();
    expect(screen.queryByText('Mes réservations')).not.toBeInTheDocument();
  });

  it('montre « Mes réservations » et masque « Connexion » avec une session', async () => {
    document.cookie = 'token=abc; path=/';
    wrap();
    expect(await screen.findByText('Mes réservations')).toBeInTheDocument();
    expect(screen.queryByText('Connexion')).not.toBeInTheDocument();
  });
});
