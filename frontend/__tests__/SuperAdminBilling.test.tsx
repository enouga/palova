import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SuperAdminBilling from '../app/superadmin/billing/page';
import { ThemeProvider } from '../lib/ThemeProvider';

const platformBillingOverview = jest.fn();
const platformClubs = jest.fn();
const platformSyncInvoices = jest.fn();
jest.mock('../lib/api', () => ({
  api: {
    platformBillingOverview: (...a: unknown[]) => platformBillingOverview(...a),
    platformClubs: (...a: unknown[]) => platformClubs(...a),
    platformSyncInvoices: (...a: unknown[]) => platformSyncInvoices(...a),
  },
}));
jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok' }) }));

const overview = {
  mrrCents: 11800, toRegularize: 1, pastDue: 0,
  byTierObserved: [2, 0, 1, 0, 0], byTierSubscribed: [0, 0, 1, 0, 0],
  revenueByMonth: Array.from({ length: 12 }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, '0')}`, amountCents: i * 100 })),
  totalCollectedCents: 11800, invoiceCount: 2,
};

const mkClub = (over: Record<string, unknown>) => ({
  id: 'club-1', slug: 'arena', name: 'Arena', city: 'Paris', status: 'ACTIVE', createdAt: '2026-01-01',
  aliases: [], owners: [{ id: 'u1', email: 'o@x.fr', firstName: 'O', lastName: 'M' }],
  counts: { adherents: 10, resources: 4 },
  billing: { activeMembers: 10, observedTier: 0, state: 'FREE', exempt: false, subscribedTier: null, subscription: null },
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  platformBillingOverview.mockResolvedValue(overview);
  platformClubs.mockResolvedValue([
    mkClub({ id: 'club-free', name: 'Petit Club', state: undefined }), // FREE sans sub → filtré
    mkClub({
      id: 'club-pay', name: 'Gros Club',
      billing: {
        activeMembers: 300, observedTier: 2, state: 'OK', exempt: false, subscribedTier: 2,
        subscription: { status: 'active', tier: 2, interval: 'month', currentPeriodEnd: '2026-08-01', cancelAtPeriodEnd: false },
      },
    }),
  ]);
});

function renderPage() {
  return render(<ThemeProvider><SuperAdminBilling /></ThemeProvider>);
}

it('affiche les KPI de facturation', async () => {
  renderPage();
  expect(await screen.findByText('MRR')).toBeInTheDocument();
  expect(screen.getByText('À régulariser')).toBeInTheDocument();
  expect(screen.getByText(/2 factures payées/)).toBeInTheDocument();
});

it('la liste des clubs facturables exclut les FREE sans abonnement', async () => {
  renderPage();
  expect(await screen.findByRole('link', { name: 'Gros Club' })).toHaveAttribute('href', '/superadmin/clubs/club-pay');
  expect(screen.queryByText('Petit Club')).not.toBeInTheDocument();
});

it('le bouton Synchroniser Stripe appelle platformSyncInvoices puis recharge', async () => {
  platformSyncInvoices.mockResolvedValue({ clubs: 3, imported: 5 });
  renderPage();
  await screen.findByText('MRR');
  fireEvent.click(screen.getByRole('button', { name: /Synchroniser Stripe/ }));
  await waitFor(() => expect(platformSyncInvoices).toHaveBeenCalledWith('tok'));
  expect(await screen.findByText(/5 factures synchronisées sur 3 clubs/)).toBeInTheDocument();
  // Rechargement de l'overview (2 appels : montage + après sync).
  expect(platformBillingOverview).toHaveBeenCalledTimes(2);
});
