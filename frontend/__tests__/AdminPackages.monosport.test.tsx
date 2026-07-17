import { render, screen } from '@testing-library/react';
import AdminPackagesPage from '../app/admin/packages/page';
import { ThemeProvider } from '../lib/ThemeProvider';
import { AdminRoleContext } from '../lib/adminRole';

jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));
jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'club-1', clubSports: [{ sport: { key: 'padel', name: 'Padel' } }] } }) }));
jest.mock('../lib/api', () => ({
  api: {
    adminGetPackageTemplates: jest.fn(),
    adminGetSubscriptionPlans: jest.fn(),
    adminGetSubscriptionOverview: jest.fn(),
    adminCreatePackageTemplate: jest.fn(),
    adminUpdatePackageTemplate: jest.fn(),
    adminUploadPackageTemplateImage: jest.fn(),
    adminCreateSubscriptionPlan: jest.fn(),
    adminUpdateSubscriptionPlan: jest.fn(),
    adminUploadSubscriptionPlanImage: jest.fn(),
  },
  assetUrl: (u: string | null) => u,
}));
import { api } from '../lib/api';

const tpl = {
  id: 'tpl-1', kind: 'ENTRIES', name: 'Carte 10 parties', sportKeys: ['padel'], description: null, imageUrl: null,
  price: '117.00', entriesCount: 10, walletAmount: null, validityDays: 180, isActive: true, createdAt: '2026-01-01T00:00:00Z',
  stats: { soldCount: 23, activeCount: 8, outstandingAmount: '0.00' },
};
const plan = {
  id: 'plan-1', name: 'Padel illimité', description: null, imageUrl: null, sportKeys: ['padel'],
  monthlyPrice: '49.00', commitmentMonths: 12, offPeakOnly: false, benefit: 'INCLUDED', discountPercent: null,
  dailyCap: null, weeklyCap: null, isActive: true, createdAt: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  (api.adminGetPackageTemplates as jest.Mock).mockResolvedValue([tpl]);
  (api.adminGetSubscriptionPlans as jest.Mock).mockResolvedValue([plan]);
  (api.adminGetSubscriptionOverview as jest.Mock).mockResolvedValue({ kpis: { activeCount: 0, monthlyRevenueCents: 0, expiringSoonCount: 0 }, plans: [], subscribers: [] });
});

const mount = () =>
  render(<AdminRoleContext.Provider value="ADMIN"><ThemeProvider><AdminPackagesPage /></ThemeProvider></AdminRoleContext.Provider>);

it('club mono-sport : sections Abonnements / Carnets & Porte-monnaie inchangées, bandeau = couleur de type', async () => {
  mount();
  expect(await screen.findByText('Abonnements')).toBeInTheDocument();
  expect(screen.getByText('Carnets & Porte-monnaie')).toBeInTheDocument();
  expect(screen.queryByTestId('offer-sport-kicker')).toBeNull();

  const planCard = screen.getByText('Padel illimité').closest('div')!.parentElement!.parentElement!;
  const stripe = planCard.querySelector('[data-testid="offer-card-stripe"]')!;
  // ACCENTS.blue = offerTint('SUBSCRIPTION'), inchangé par rapport à avant cette évolution.
  expect(stripe).toHaveStyle({ background: '#5e93da' });
});
