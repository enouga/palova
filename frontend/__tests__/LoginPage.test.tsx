import { render, screen } from '@testing-library/react';
import LoginPage from '../app/login/page';
import { ThemeProvider } from '../lib/ThemeProvider';
import { PANEL_COPY } from '../lib/authShell';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));
jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ slug: null, club: null, loading: false }) }));
jest.mock('../lib/api', () => ({
  api: { resendCode: jest.fn(), getMyClubs: jest.fn() },
  assetUrl: (p: string | null) => p,
}));

describe('Page connexion (LoginPage)', () => {
  it('rend le titre, le panneau de marque, les champs et le CTA', () => {
    render(<ThemeProvider><LoginPage /></ThemeProvider>);
    expect(screen.getByRole('heading', { name: 'Bon retour.' })).toBeInTheDocument();
    expect(screen.getByText(PANEL_COPY.player.headline)).toBeInTheDocument();
    expect(screen.getByLabelText('Adresse e-mail')).toBeInTheDocument();
    expect(screen.getByLabelText('Mot de passe')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Se connecter' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mot de passe oublié ?' })).toBeInTheDocument();
  });

  it('garde le préremplissage seedé hors production (NODE_ENV=test ⇒ prérempli)', () => {
    render(<ThemeProvider><LoginPage /></ThemeProvider>);
    expect(screen.getByLabelText('Adresse e-mail')).toHaveValue('test@palova.fr');
  });
});
