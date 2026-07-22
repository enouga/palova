import { render, screen, waitFor } from '@testing-library/react';
import { WalletCard } from '../components/platform/home/WalletCard';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('../lib/api', () => ({ assetUrl: (p: string | null) => p, api: { getMyWallet: jest.fn() } }));
import { api } from '../lib/api';
const mocked = api as jest.Mocked<typeof api>;

const ENTRY = {
  club: { slug: 'padel-arena', name: 'Padel Arena', accentColor: '#5e93da' },
  subscriptions: [{ id: 's1', planId: 'pl1', status: 'ACTIVE', startedAt: '2026-01-01', expiresAt: '2026-09-12T00:00:00.000Z',
    monthlyPriceSnapshot: '39', sportKeys: ['padel'], offPeakOnly: false, benefit: 'FREE', discountPercent: null,
    dailyCap: null, weeklyCap: null, plan: { name: 'Padel illimité' } }],
  packages: [{ id: 'p1', kind: 'ENTRIES', creditsTotal: 10, creditsRemaining: 8, amountTotal: null, amountRemaining: null,
    purchasedAt: '2026-06-01', expiresAt: null, template: { name: 'Carnet 10', sportKeys: ['padel'] } }],
};

describe('WalletCard', () => {
  it('liste abonnements + carnets avec la chip du club', async () => {
    mocked.getMyWallet.mockResolvedValue([ENTRY] as never);
    render(<ThemeProvider><WalletCard token="tok" /></ThemeProvider>);
    expect(await screen.findByText(/Padel illimité/)).toBeInTheDocument();
    // packageLabel() produit un texte générique dérivé du solde (pas le nom de l'offre) :
    // "Carnet — 8 entrées" pour ce carnet à 8 crédits restants.
    expect(screen.getByText(/Carnet — 8 entrées/)).toBeInTheDocument();
    expect(screen.getAllByText('Padel Arena').length).toBeGreaterThan(0);
  });

  it('portefeuille vide → rien', async () => {
    mocked.getMyWallet.mockResolvedValue([] as never);
    const { container } = render(<ThemeProvider><WalletCard token="tok" /></ThemeProvider>);
    await waitFor(() => expect(mocked.getMyWallet).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });
});
