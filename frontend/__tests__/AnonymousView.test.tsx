import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import AnonymousView from '@/components/platform/AnonymousView';

// ClubDirectory est mocké : AnonymousView n'a alors besoin que du thème.
jest.mock('@/components/ClubDirectory', () => ({ ClubDirectory: () => <div data-testid="club-directory" /> }));

const wrap = () => render(<ThemeProvider><AnonymousView /></ThemeProvider>);

describe('AnonymousView', () => {
  it('rend le hero, l\'annuaire et le pitch club', () => {
    wrap();
    expect(screen.getByText(/Trouvez un terrain/i)).toBeInTheDocument();
    expect(screen.getByTestId('club-directory')).toBeInTheDocument();
    expect(screen.getByText(/Vous gérez un club/i)).toBeInTheDocument();
  });

  it('le CTA « Découvrir » pointe vers /offres et « Connexion » vers /login', () => {
    wrap();
    expect(screen.getByRole('link', { name: /Connexion/i })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: /Découvrir/i })).toHaveAttribute('href', '/offres');
  });
});
