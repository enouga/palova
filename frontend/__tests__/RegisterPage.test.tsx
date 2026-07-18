import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RegisterPage from '../app/register/page';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ slug: null, club: null, loading: false }) }));

jest.mock('../components/VerifyCodeForm', () => ({
  VerifyCodeForm: () => <div>code-form</div>,
}));

jest.mock('../lib/api', () => ({
  api: {
    register: jest.fn(),
    getSports: jest.fn(),
    joinClub: jest.fn(),
  },
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { api } = require('../lib/api') as { api: Record<string, jest.Mock> };

const SPORTS = [
  { id: 'sport-padel', key: 'padel', name: 'Padel', resourceNoun: 'terrain', defaultSlotStepMin: 90, defaultDurationsMin: [90], icon: '🎾', surfaces: [], published: true, hasLighting: false },
  { id: 'sport-tennis', key: 'tennis', name: 'Tennis', resourceNoun: 'terrain', defaultSlotStepMin: 60, defaultDurationsMin: [60], icon: null, surfaces: [], published: true, hasLighting: false },
];

const wrap = () => render(<ThemeProvider><RegisterPage /></ThemeProvider>);

describe('Page inscription (RegisterPage)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.getSports.mockResolvedValue(SPORTS);
    api.register.mockResolvedValue({ email: 'a@b.fr', devCode: '123456' });
  });

  it('bloque la soumission tant que la case CGU n\'est pas cochée', async () => {
    api.getSports.mockResolvedValue([]);
    wrap();

    fireEvent.change(screen.getByLabelText('Prénom'), { target: { value: 'Alice' } });
    fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Martin' } });
    fireEvent.change(screen.getByLabelText('Adresse e-mail'), { target: { value: 'alice@test.fr' } });
    fireEvent.change(screen.getByLabelText('Mot de passe (8+ caractères)'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Créer mon compte' }));

    await waitFor(() => expect(screen.getByText(/accepter les conditions/i)).toBeInTheDocument());
    expect(api.register).not.toHaveBeenCalled();
  });

  it('envoie acceptTerms: true quand la case est cochée', async () => {
    api.getSports.mockResolvedValue([]);
    wrap();

    fireEvent.change(screen.getByLabelText('Prénom'), { target: { value: 'Alice' } });
    fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Martin' } });
    fireEvent.change(screen.getByLabelText('Adresse e-mail'), { target: { value: 'alice@test.fr' } });
    fireEvent.change(screen.getByLabelText('Mot de passe (8+ caractères)'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /J'accepte les conditions générales d'utilisation/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Créer mon compte' }));

    await waitFor(() => expect(api.register).toHaveBeenCalledWith(expect.objectContaining({ acceptTerms: true })));
  });

  it('appelle api.register sans preferredSportId quand aucun sport n\'est sélectionné', async () => {
    api.getSports.mockResolvedValue([]);
    wrap();

    fireEvent.change(screen.getByLabelText('Prénom'), { target: { value: 'Alice' } });
    fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Martin' } });
    fireEvent.change(screen.getByLabelText('Adresse e-mail'), { target: { value: 'alice@test.fr' } });
    fireEvent.change(screen.getByLabelText('Mot de passe (8+ caractères)'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /J'accepte les conditions générales d'utilisation/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Créer mon compte' }));

    await waitFor(() =>
      expect(api.register).toHaveBeenCalledWith(
        expect.not.objectContaining({ preferredSportId: expect.anything() }),
      ),
    );
  });

  it('affiche le sélecteur « Sport préféré » et l\'inclut dans api.register quand choisi', async () => {
    wrap();

    // Attendre que les sports soient chargés
    await waitFor(() => expect(screen.getByLabelText('Sport préféré (facultatif)')).toBeInTheDocument());

    // Remplir les champs obligatoires
    fireEvent.change(screen.getByLabelText('Prénom'), { target: { value: 'Alice' } });
    fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Martin' } });
    fireEvent.change(screen.getByLabelText('Adresse e-mail'), { target: { value: 'alice@test.fr' } });
    fireEvent.change(screen.getByLabelText('Mot de passe (8+ caractères)'), { target: { value: 'password123' } });

    // Sélectionner un sport
    fireEvent.change(screen.getByLabelText('Sport préféré (facultatif)'), { target: { value: 'sport-padel' } });

    fireEvent.click(screen.getByRole('checkbox', { name: /J'accepte les conditions générales d'utilisation/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Créer mon compte' }));

    await waitFor(() =>
      expect(api.register).toHaveBeenCalledWith(
        expect.objectContaining({ preferredSportId: 'sport-padel' }),
      ),
    );
  });

  it('omet preferredSportId quand l\'option vide est sélectionnée', async () => {
    wrap();

    await waitFor(() => expect(screen.getByLabelText('Sport préféré (facultatif)')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Prénom'), { target: { value: 'Alice' } });
    fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Martin' } });
    fireEvent.change(screen.getByLabelText('Adresse e-mail'), { target: { value: 'alice@test.fr' } });
    fireEvent.change(screen.getByLabelText('Mot de passe (8+ caractères)'), { target: { value: 'password123' } });

    // Laisser la sélection vide (option par défaut)
    fireEvent.change(screen.getByLabelText('Sport préféré (facultatif)'), { target: { value: '' } });

    fireEvent.click(screen.getByRole('checkbox', { name: /J'accepte les conditions générales d'utilisation/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Créer mon compte' }));

    await waitFor(() =>
      expect(api.register).toHaveBeenCalledWith(
        expect.not.objectContaining({ preferredSportId: expect.anything() }),
      ),
    );
  });
});
