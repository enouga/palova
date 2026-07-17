import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import NewClubPage from '../app/clubs/new/page';
import { ThemeProvider } from '../lib/ThemeProvider';
import { PANEL_COPY } from '../lib/authShell';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));
jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ slug: null, club: null, loading: false }) }));
jest.mock('../lib/api', () => ({
  api: { getSports: jest.fn(), register: jest.fn(), createClub: jest.fn(), adminAddSport: jest.fn() },
  assetUrl: (p: string | null) => p,
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { api } = require('../lib/api') as { api: Record<string, jest.Mock> };

// Stub minimal de VerifyCodeForm : un bouton qui appelle onVerified (comme le ferait la
// vraie saisie de code) et affiche l'éventuelle erreur levée par finishClub — permet de
// tester le mapping d'erreurs de finishClub sans reproduire toute la saisie du code.
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('../components/VerifyCodeForm', () => {
  const React = require('react') as typeof import('react');
  return {
    VerifyCodeForm: ({ onVerified }: { onVerified: (auth: unknown) => void | Promise<void> }) => {
      const [err, setErr] = React.useState<string | null>(null);
      return (
        <div>
          <button
            type="button"
            onClick={async () => {
              try {
                await onVerified({ token: 'tok', user: { id: 'u1', email: 'gerant@test.fr', firstName: 'A', lastName: 'M', isSuperAdmin: false } });
              } catch (e) {
                setErr((e as Error).message);
              }
            }}
          >
            Déclencher la vérification
          </button>
          {err && <div>{err}</div>}
        </div>
      );
    },
  };
});

const SPORTS = [
  { id: 'sport-padel', key: 'padel', name: 'Padel', resourceNoun: 'terrain', defaultSlotStepMin: 90, defaultDurationsMin: [90], icon: '🎾', surfaces: [], published: true, hasLighting: false },
];

describe('Page création de club (NewClubPage)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.getSports.mockResolvedValue(SPORTS);
  });

  it('rend le titre, le panneau B2B et le formulaire complet', async () => {
    render(<ThemeProvider><NewClubPage /></ThemeProvider>);
    expect(screen.getByRole('heading', { name: "Créez l'espace de votre club." })).toBeInTheDocument();
    expect(screen.getByText(PANEL_COPY.club.headline)).toBeInTheDocument(); // panneau Palova B2B
    expect(screen.getByLabelText('Prénom')).toBeInTheDocument();
    expect(screen.getByLabelText('Nom du club')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Sport principal')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Créer mon club' })).toBeInTheDocument();
  });

  it('explique que le compte créé est le compte gérant (admin) du club', async () => {
    render(<ThemeProvider><NewClubPage /></ThemeProvider>);
    expect(screen.getByText(/compte gérant \(administrateur\)/)).toBeInTheDocument();
    expect(screen.getByText(/nommer des admins et du staff/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Sport principal')).toBeInTheDocument());
  });

  it('bloque la soumission si le SIRET est invalide (Luhn) sans appeler api.register', async () => {
    render(<ThemeProvider><NewClubPage /></ThemeProvider>);
    await waitFor(() => expect(screen.getByLabelText('Sport principal')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Prénom'), { target: { value: 'Alice' } });
    fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Martin' } });
    fireEvent.change(screen.getByLabelText('Adresse e-mail'), { target: { value: 'alice@test.fr' } });
    fireEvent.change(screen.getByLabelText('Mot de passe (8+ caractères)'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText('Nom du club'), { target: { value: 'Padel Club' } });
    fireEvent.change(screen.getByLabelText('SIRET du club'), { target: { value: '123' } });
    fireEvent.change(screen.getByLabelText('Téléphone du gérant'), { target: { value: '0612345678' } });

    fireEvent.click(screen.getByRole('button', { name: 'Créer mon club' }));

    await waitFor(() => expect(screen.getByText(/SIRET.*invalide/i)).toBeInTheDocument());
    expect(api.register).not.toHaveBeenCalled();
  });

  it('mappe SIRET_NOT_FOUND en message clair à la création du club (après vérification du code)', async () => {
    api.register.mockResolvedValue({ email: 'gerant@test.fr', devCode: '123456' });
    api.createClub.mockRejectedValue(new Error('SIRET_NOT_FOUND'));

    render(<ThemeProvider><NewClubPage /></ThemeProvider>);
    await waitFor(() => expect(screen.getByLabelText('Sport principal')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Prénom'), { target: { value: 'Alice' } });
    fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Martin' } });
    fireEvent.change(screen.getByLabelText('Adresse e-mail'), { target: { value: 'alice@test.fr' } });
    fireEvent.change(screen.getByLabelText('Mot de passe (8+ caractères)'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText('Nom du club'), { target: { value: 'Padel Club' } });
    // SIRET Luhn-valide (14 chiffres, clé correcte) pour passer la garde client.
    fireEvent.change(screen.getByLabelText('SIRET du club'), { target: { value: '12345678901237' } });
    fireEvent.change(screen.getByLabelText('Téléphone du gérant'), { target: { value: '0612345678' } });

    fireEvent.click(screen.getByRole('button', { name: 'Créer mon club' }));

    const verifyBtn = await screen.findByRole('button', { name: 'Déclencher la vérification' });
    fireEvent.click(verifyBtn);

    await waitFor(() =>
      expect(api.createClub).toHaveBeenCalledWith(
        expect.objectContaining({ siret: '12345678901237', ownerPhone: '0612345678' }),
        'tok',
      ),
    );
    await waitFor(() => expect(screen.getByText(/n'existe pas/i)).toBeInTheDocument());
  });
});
