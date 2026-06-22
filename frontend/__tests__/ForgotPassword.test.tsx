import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ForgotPasswordPage from '../app/forgot-password/page';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ slug: null, club: null, loading: false }) }));

jest.mock('../lib/api', () => ({
  api: {
    forgotPassword: jest.fn(),
    resetPassword: jest.fn(),
    getMyClubs: jest.fn(),
    joinClub: jest.fn(),
  },
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { api } = require('../lib/api') as { api: Record<string, jest.Mock> };

const wrap = () => render(<ThemeProvider><ForgotPasswordPage /></ThemeProvider>);

describe('Page mot de passe oublié', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.forgotPassword.mockResolvedValue({ ok: true });
    api.resetPassword.mockResolvedValue({ token: 'tok', user: { id: 'u1', email: 'a@b.fr', firstName: 'A', lastName: 'B', isSuperAdmin: false } });
    api.getMyClubs.mockResolvedValue([]);
  });

  it('étape 1 : envoie le code et passe à la saisie (message neutre)', async () => {
    wrap();
    fireEvent.change(screen.getByLabelText('Adresse e-mail'), { target: { value: 'a@b.fr' } });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer le code' }));
    await waitFor(() => expect(api.forgotPassword).toHaveBeenCalledWith('a@b.fr'));
    // L'étape 2 (saisie du code + nouveau mot de passe) apparaît.
    expect(await screen.findByLabelText('Code de validation')).toBeInTheDocument();
    expect(screen.getByLabelText('Nouveau mot de passe')).toBeInTheDocument();
  });

  it('étape 2 : réinitialise avec le code et le nouveau mot de passe', async () => {
    wrap();
    fireEvent.change(screen.getByLabelText('Adresse e-mail'), { target: { value: 'a@b.fr' } });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer le code' }));
    fireEvent.change(await screen.findByLabelText('Code de validation'), { target: { value: '123456' } });
    fireEvent.change(screen.getByLabelText('Nouveau mot de passe'), { target: { value: 'newpass123' } });
    fireEvent.change(screen.getByLabelText('Confirmer le nouveau mot de passe'), { target: { value: 'newpass123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Réinitialiser' }));
    await waitFor(() => expect(api.resetPassword).toHaveBeenCalledWith('a@b.fr', '123456', 'newpass123'));
    // L'auto-login enchaîne sur le routage post-auth.
    await waitFor(() => expect(api.getMyClubs).toHaveBeenCalledWith('tok'));
  });

  it('étape 2 : refuse si la confirmation diffère, sans appeler l\'API', async () => {
    wrap();
    fireEvent.change(screen.getByLabelText('Adresse e-mail'), { target: { value: 'a@b.fr' } });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer le code' }));
    fireEvent.change(await screen.findByLabelText('Code de validation'), { target: { value: '123456' } });
    fireEvent.change(screen.getByLabelText('Nouveau mot de passe'), { target: { value: 'newpass123' } });
    fireEvent.change(screen.getByLabelText('Confirmer le nouveau mot de passe'), { target: { value: 'autrechose' } });
    fireEvent.click(screen.getByRole('button', { name: 'Réinitialiser' }));
    expect(await screen.findByText('Les mots de passe ne correspondent pas.')).toBeInTheDocument();
    expect(api.resetPassword).not.toHaveBeenCalled();
  });
});
