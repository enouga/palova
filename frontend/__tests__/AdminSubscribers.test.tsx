import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import AdminSubscribersPage from '../app/admin/abonnes/page';
import { ThemeProvider } from '../lib/ThemeProvider';
import { api } from '../lib/api';

jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));
jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'club-1', clubSports: [{ sport: { key: 'padel' } }] } }) }));
jest.mock('../lib/api', () => ({
  api: {
    adminGetSubscriptionOverview: jest.fn(),
    adminRenewSubscription: jest.fn(), adminChangeSubscription: jest.fn(), adminCancelSubscription: jest.fn(),
  },
  assetUrl: (u: string | null) => u,
}));

const overview = {
  kpis: { activeCount: 2, monthlyRevenueCents: 6800, expiringSoonCount: 1 },
  plans: [{ id: 'p1', name: 'Padel illimité', monthlyPrice: '39.00', benefit: 'INCLUDED', discountPercent: null, sportKeys: ['padel'], isActive: true, activeCount: 1 }],
  subscribers: [
    { id: 'a', user: { id: 'u1', firstName: 'Jean', lastName: 'Dupont', avatarUrl: null }, planId: 'p1', planName: 'Padel illimité', status: 'ACTIVE', startedAt: '2099-01-01T00:00:00Z', expiresAt: '2099-12-01T00:00:00Z', monthlyPriceSnapshot: '39.00', sportKeys: ['padel'] },
    { id: 'b', user: { id: 'u2', firstName: 'Marie', lastName: 'Leroy', avatarUrl: null }, planId: 'p1', planName: 'Padel illimité', status: 'CANCELLED', startedAt: '2020-01-01T00:00:00Z', expiresAt: '2020-02-01T00:00:00Z', monthlyPriceSnapshot: '29.00', sportKeys: ['padel'] },
  ],
};

beforeEach(() => { jest.clearAllMocks(); (api.adminGetSubscriptionOverview as jest.Mock).mockResolvedValue(overview); });

it('KPIs + carte forfait + registre (actifs par défaut)', async () => {
  render(<ThemeProvider><AdminSubscribersPage /></ThemeProvider>);
  expect(await screen.findByRole('heading', { name: 'Abonnés' })).toBeInTheDocument();
  expect(screen.getByText('68 €')).toBeInTheDocument();          // revenu/mois
  expect(screen.getAllByText(/Padel illimité/).length).toBeGreaterThan(0); // carte forfait + ligne registre

  expect(screen.getByText('Jean Dupont')).toBeInTheDocument();   // actif
  expect(screen.queryByText('Marie Leroy')).not.toBeInTheDocument(); // annulée (historique)
});

it('onglet Historique montre les annulées', async () => {
  render(<ThemeProvider><AdminSubscribersPage /></ThemeProvider>);
  await screen.findByText('Jean Dupont');
  fireEvent.click(screen.getByRole('button', { name: /Historique/ }));
  expect(await screen.findByText('Marie Leroy')).toBeInTheDocument();
});

it('clic sur ⟳ ouvre le dialog et renouvelle', async () => {
  (api.adminRenewSubscription as jest.Mock).mockResolvedValue({ subscription: { id: 'a' } });
  render(<ThemeProvider><AdminSubscribersPage /></ThemeProvider>);
  const row = (await screen.findByText('Jean Dupont')).closest('[data-sub-row]')!;
  fireEvent.click(within(row as HTMLElement).getByRole('button', { name: /Renouveler/ }));
  fireEvent.click(await screen.findByRole('button', { name: /Renouveler · / }));
  await waitFor(() => expect(api.adminRenewSubscription).toHaveBeenCalledWith('club-1', 'a', expect.anything(), 'tok'));
});
