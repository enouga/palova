import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AdminBillingPage from '@/app/admin/billing/page';

jest.mock('@/lib/useAuth', () => ({ useAuth: () => ({ token: 't', ready: true }) }));
jest.mock('@/lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'club-1', slug: 'club' } }) }));
jest.mock('@/lib/ThemeProvider', () => ({
  useTheme: () => ({ th: {
    fontUI: '', fontDisplay: '', fontMono: '', text: '#000', textMute: '#555', textFaint: '#999',
    bg: '#fff', bgElev: '#fff', line: '#eee', accent: '#06c',
  } }),
}));

const BILLING = {
  activeMembers: 180, countedAt: '2026-07-07T04:00:00Z',
  observedTier: 2, tierLabel: '151 – 400 membres actifs',
  monthlyPriceCents: 5900, yearlyPriceCents: 60200,
  state: 'TO_REGULARIZE',
  subscription: null,
  snapshots: [{ month: '2026-06', activeMembers: 170, tier: 2 }],
};

jest.mock('@/lib/api', () => ({
  api: {
    adminGetBilling: jest.fn(),
    adminBillingCheckout: jest.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/x' }),
    adminBillingPortal: jest.fn().mockResolvedValue({ url: 'https://billing.stripe.com/p' }),
    getMyClubs: jest.fn(),
  },
}));
import { api } from '@/lib/api';

describe('AdminBillingPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (api.adminGetBilling as jest.Mock).mockResolvedValue(BILLING);
    (api.getMyClubs as jest.Mock).mockResolvedValue([{ clubId: 'club-1', slug: 'club', name: 'C', role: 'OWNER' }]);
  });

  it('affiche la jauge, la grille des paliers et le palier courant surligné', async () => {
    render(<AdminBillingPage />);
    await waitFor(() => expect(screen.getByText('180')).toBeInTheDocument());
    // Grille de prix : les 4 paliers payants + le gratuit
    expect(screen.getAllByText(/29 €/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/59 €/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/149 €/).length).toBeGreaterThan(0);
    expect(screen.getByText('Gratuit')).toBeInTheDocument();
    // Palier observé (t2) mis en avant
    expect(screen.getByText('Votre palier')).toBeInTheDocument();
    expect(screen.getByText('151 – 400')).toBeInTheDocument();
  });

  it('état à régulariser : bouton Souscrire visible pour OWNER, lance le checkout', async () => {
    render(<AdminBillingPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: /souscrire — mensuel/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /souscrire — mensuel/i }));
    await waitFor(() => expect(api.adminBillingCheckout).toHaveBeenCalledWith(
      'club-1', 'month', expect.stringContaining('/admin/billing'), 't',
    ));
  });

  it('ADMIN (non OWNER) : boutons de souscription absents, message à la place', async () => {
    (api.getMyClubs as jest.Mock).mockResolvedValue([{ clubId: 'club-1', slug: 'club', name: 'C', role: 'ADMIN' }]);
    render(<AdminBillingPage />);
    await waitFor(() => expect(screen.getByText('180')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /souscrire/i })).not.toBeInTheDocument();
    expect(screen.getByText(/réservée au gérant/i)).toBeInTheDocument();
  });

  it('abonnement actif : état OK + bouton Gérer (portal)', async () => {
    (api.adminGetBilling as jest.Mock).mockResolvedValue({
      ...BILLING, state: 'OK',
      subscription: {
        status: 'active', tier: 2, tierLabel: '151 – 400 membres actifs', interval: 'month',
        priceCents: 5900, currentPeriodEnd: '2026-08-01T00:00:00Z', cancelAtPeriodEnd: false,
      },
    });
    render(<AdminBillingPage />);
    await waitFor(() => expect(screen.getByText(/abonnement actif/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /gérer mon abonnement/i }));
    await waitFor(() => expect(api.adminBillingPortal).toHaveBeenCalled());
  });

  it('affiche l historique des snapshots', async () => {
    render(<AdminBillingPage />);
    await waitFor(() => expect(screen.getByText('2026-06')).toBeInTheDocument());
  });
});
