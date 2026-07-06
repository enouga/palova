import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StartChecklist } from '@/components/admin/StartChecklist';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { ONBOARDING_HIDDEN_KEY } from '@/lib/onboarding';

jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  api: { adminGetOnboardingStatus: jest.fn() },
}));
import { api } from '@/lib/api';

const partial = {
  hasLogo: true, sportsCount: 1, resourcesCount: 4,
  hasPresentation: false, stripeStatus: 'NONE', offersCount: 0, eventsCount: 0,
};
const complete = {
  hasLogo: true, sportsCount: 1, resourcesCount: 4,
  hasPresentation: true, stripeStatus: 'ACTIVE', offersCount: 1, eventsCount: 1,
};

const wrap = () => render(
  <ThemeProvider><StartChecklist clubId="c1" token="t" /></ThemeProvider>,
);

describe('StartChecklist', () => {
  beforeEach(() => { jest.clearAllMocks(); window.localStorage.clear(); });

  it('affiche la progression, les jalons faits barrés et les ouverts en lien', async () => {
    (api.adminGetOnboardingStatus as jest.Mock).mockResolvedValue(partial);
    wrap();
    expect(await screen.findByText('4/8')).toBeInTheDocument();
    // jalon fait : présent mais PAS un lien ; jalon ouvert : lien vers sa page admin
    expect(screen.getByText('Vos terrains')).toBeInTheDocument();
    expect(screen.getByText('Vos terrains').closest('a')).toBeNull();
    const stripe = screen.getByText('Le paiement en ligne (Stripe)').closest('a')!;
    expect(stripe).toHaveAttribute('href', '/admin/payments');
    // lien de réouverture du wizard
    expect(screen.getByText(/Rouvrir le guide/).closest('a')).toHaveAttribute('href', '/admin/onboarding');
  });

  it('la croix masque la carte et persiste en localStorage', async () => {
    (api.adminGetOnboardingStatus as jest.Mock).mockResolvedValue(partial);
    wrap();
    await screen.findByText('4/8');
    fireEvent.click(screen.getByLabelText('Masquer le guide de démarrage'));
    expect(screen.queryByText('4/8')).not.toBeInTheDocument();
    expect(window.localStorage.getItem(ONBOARDING_HIDDEN_KEY('c1'))).toBe('hidden');
  });

  it('déjà masquée : ne fetch pas, ne rend rien', async () => {
    window.localStorage.setItem(ONBOARDING_HIDDEN_KEY('c1'), 'hidden');
    (api.adminGetOnboardingStatus as jest.Mock).mockResolvedValue(partial);
    const { container } = wrap();
    await waitFor(() => expect(container.firstChild).toBeNull());
    expect(api.adminGetOnboardingStatus).not.toHaveBeenCalled();
  });

  it('club complet (8/8) : ne rend rien', async () => {
    (api.adminGetOnboardingStatus as jest.Mock).mockResolvedValue(complete);
    const { container } = wrap();
    await waitFor(() => expect(api.adminGetOnboardingStatus).toHaveBeenCalled());
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it('erreur API : ne rend rien (jamais de carte cassée)', async () => {
    (api.adminGetOnboardingStatus as jest.Mock).mockRejectedValue(new Error('boom'));
    const { container } = wrap();
    await waitFor(() => expect(api.adminGetOnboardingStatus).toHaveBeenCalled());
    await waitFor(() => expect(container.firstChild).toBeNull());
  });
});
