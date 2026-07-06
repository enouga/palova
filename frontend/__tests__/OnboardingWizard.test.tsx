import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';
import { ThemeProvider } from '@/lib/ThemeProvider';

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: jest.fn(), back: jest.fn() }) }));
jest.mock('@/lib/useAuth', () => ({ useAuth: () => ({ token: 't', ready: true }) }));
jest.mock('@/lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'c1', name: 'Padel Riviera' } }) }));

jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  api: {
    adminGetClub: jest.fn(),
    adminGetSports: jest.fn(),
    adminGetResources: jest.fn(),
    getSports: jest.fn(),
    adminUpdateClub: jest.fn(),
    adminAddSport: jest.fn(),
    adminCreateResource: jest.fn(),
    uploadClubLogo: jest.fn(),
  },
}));
import { api } from '@/lib/api';

const club = {
  id: 'c1', slug: 'padel-riviera', name: 'Padel Riviera',
  logoUrl: null, accentColor: '#d6ff3f', defaultThemeMode: 'floodlit',
  publicBookingDays: 7, memberBookingDays: 14, cancellationCutoffHours: 0,
  listedInDirectory: true, stripeAccountStatus: 'NONE',
};
const padelCs = {
  id: 'cs-padel', slotStepMin: null, durationsMin: [],
  sport: { id: 's-padel', key: 'padel', name: 'Padel', resourceNoun: 'piste', defaultDurationsMin: [60], surfaces: [], hasLighting: true },
};
const catalog = [
  { id: 's-padel', key: 'padel', name: 'Padel', resourceNoun: 'piste', icon: '🎾', surfaces: [], published: true, hasLighting: true, defaultSlotStepMin: 30, defaultDurationsMin: [60] },
];

const wrap = () => render(<ThemeProvider><OnboardingWizard /></ThemeProvider>);

// La suite se veut « environnement desktop » : le shell interroge réellement
// matchMedia('(min-width: 860px)') au montage (pour refléter correctement une
// vraie fenêtre étroite en prod) — le stub neutre de jest.setup.ts renvoie
// `matches:false` pour toute requête, ce qui masquerait l'aperçu vivant ici.
// On surcharge donc localement (ce fichier seulement) pour simuler un vrai
// écran large, sans toucher au comportement de production ni au stub global.
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  (api.adminGetClub as jest.Mock).mockResolvedValue(club);
  (api.adminGetSports as jest.Mock).mockResolvedValue([padelCs]);
  (api.adminGetResources as jest.Mock).mockResolvedValue([]);
  (api.getSports as jest.Mock).mockResolvedValue(catalog);
  (api.adminUpdateClub as jest.Mock).mockResolvedValue(club);
});

describe('OnboardingWizard', () => {
  it('charge l’état réel puis affiche l’étape 1 avec l’aperçu vivant', async () => {
    wrap();
    expect(await screen.findByText(/Donnez un visage/)).toBeInTheDocument();
    // l'aperçu montre le club + placeholder terrains ; le sport actif y apparaît déjà
    expect(screen.getByText('padel-riviera.palova.fr')).toBeInTheDocument();
    expect(screen.getByText(/étape 3…/)).toBeInTheDocument();
    expect(screen.getByText('1/5')).toBeInTheDocument();
  });

  it('« Configurer plus tard » sort vers /admin', async () => {
    wrap();
    await screen.findByText(/Donnez un visage/);
    fireEvent.click(screen.getByText(/Configurer plus tard/));
    expect(push).toHaveBeenCalledWith('/admin');
  });

  it('parcours complet en sautant : les 5 étapes défilent jusqu’au final', async () => {
    wrap();
    await screen.findByText(/Donnez un visage/);
    fireEvent.click(screen.getByText('Passer cette étape'));            // → sports
    expect(await screen.findByText(/Que joue-t-on/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Passer cette étape'));            // → terrains
    expect(await screen.findByText(/Vos terrains,/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Passer cette étape'));            // → règles
    expect(await screen.findByText(/Deux règles,/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Passer cette étape'));            // → mise en ligne
    expect(await screen.findByText(/coup d’envoi/)).toBeInTheDocument();
    expect(screen.getByText('5/5')).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Mettre mon club en ligne/));
    expect(await screen.findByText(/en ligne\./)).toBeInTheDocument();
    // le final masque la barre de progression
    expect(screen.queryByText('5/5')).not.toBeInTheDocument();
  });

  it('valider l’étape 1 persiste puis avance ; l’accent choisi se propage à l’aperçu', async () => {
    wrap();
    await screen.findByText(/Donnez un visage/);
    fireEvent.click(screen.getByLabelText('Accent #5e93da'));
    fireEvent.click(screen.getByText('Continuer →'));
    await waitFor(() => expect(api.adminUpdateClub).toHaveBeenCalledWith(
      'c1', { accentColor: '#5e93da', defaultThemeMode: 'floodlit' }, 't',
    ));
    expect(await screen.findByText(/Que joue-t-on/)).toBeInTheDocument();
  });

  it('les terrains créés à l’étape 3 apparaissent dans l’aperçu', async () => {
    (api.adminCreateResource as jest.Mock).mockImplementation((_c, body) => Promise.resolve({
      id: `r-${body.name}`, name: body.name, price: String(body.price), isActive: true,
      attributes: body.attributes, clubSport: padelCs,
    }));
    wrap();
    await screen.findByText(/Donnez un visage/);
    fireEvent.click(screen.getByText('Passer cette étape'));            // → sports
    await screen.findByText(/Que joue-t-on/);
    fireEvent.click(screen.getByText('Passer cette étape'));            // → terrains
    await screen.findByText(/Vos terrains,/);
    fireEvent.change(screen.getByLabelText('Prix au créneau (€) — Padel'), { target: { value: '25' } });
    fireEvent.click(screen.getByText('Continuer →'));
    await screen.findByText(/Deux règles,/);
    // l'aperçu du téléphone reflète les 2 pistes créées (défaut stepper = 2)
    expect(screen.getByText(/2 pistes · dès 25 €/)).toBeInTheDocument();
  });

  it('échec de chargement → message, pas de crash', async () => {
    (api.adminGetClub as jest.Mock).mockRejectedValue(new Error('boom'));
    wrap();
    expect(await screen.findByText(/Impossible de charger votre club/)).toBeInTheDocument();
  });
});
