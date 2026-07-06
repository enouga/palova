import { render, screen, fireEvent } from '@testing-library/react';
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';
import { ThemeProvider } from '@/lib/ThemeProvider';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }) }));
jest.mock('@/lib/useAuth', () => ({ useAuth: () => ({ token: 't', ready: true }) }));
jest.mock('@/lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'c1', name: 'Padel Riviera' } }) }));
jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  api: {
    adminGetClub: jest.fn(),
    adminGetSports: jest.fn(),
    adminGetResources: jest.fn(),
    getSports: jest.fn(),
  },
}));
import { api } from '@/lib/api';

// Ici, PAS de surcharge locale de matchMedia : le stub global de jest.setup.ts renvoie
// matches:false → le wizard se comporte comme sur mobile (vignette dépliable).
const club = {
  id: 'c1', slug: 'padel-riviera', name: 'Padel Riviera',
  logoUrl: null, accentColor: '#d6ff3f', defaultThemeMode: 'floodlit',
  publicBookingDays: 7, memberBookingDays: 14, cancellationCutoffHours: 0,
  listedInDirectory: true, stripeAccountStatus: 'NONE',
};

describe('OnboardingWizard (mobile)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (api.adminGetClub as jest.Mock).mockResolvedValue(club);
    (api.adminGetSports as jest.Mock).mockResolvedValue([]);
    (api.adminGetResources as jest.Mock).mockResolvedValue([]);
    (api.getSports as jest.Mock).mockResolvedValue([]);
  });

  it('vignette dépliable : l’aperçu est masqué puis révélé par « Voir l’aperçu ✨ »', async () => {
    render(<ThemeProvider><OnboardingWizard /></ThemeProvider>);
    await screen.findByText(/Donnez un visage/);
    expect(screen.queryByText('padel-riviera.palova.fr')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/Voir l’aperçu/));
    expect(screen.getByText('padel-riviera.palova.fr')).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Masquer l’aperçu/));
    expect(screen.queryByText('padel-riviera.palova.fr')).not.toBeInTheDocument();
  });
});
