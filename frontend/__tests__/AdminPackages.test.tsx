import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import AdminPackagesPage from '../app/admin/packages/page';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));
jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'club-1', clubSports: [{ sport: { key: 'padel', name: 'Padel' } }, { sport: { key: 'tennis', name: 'Tennis' } }] } }) }));
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
const overview = {
  kpis: { activeCount: 12, monthlyRevenueCents: 58800, expiringSoonCount: 0 },
  plans: [{ id: 'plan-1', name: 'Padel illimité', monthlyPrice: '49.00', benefit: 'INCLUDED', discountPercent: null, sportKeys: ['padel'], isActive: true, activeCount: 12 }],
  subscribers: Array.from({ length: 12 }, (_, i) => ({
    id: `s${i}`, user: { id: `u${i}`, firstName: 'A', lastName: 'B', avatarUrl: null }, planId: 'plan-1', planName: 'Padel illimité',
    status: 'ACTIVE', startedAt: '2026-01-01T00:00:00Z', expiresAt: '2027-01-01T00:00:00Z', monthlyPriceSnapshot: '49.00', sportKeys: ['padel'],
  })),
};

beforeEach(() => {
  jest.clearAllMocks();
  (api.adminGetPackageTemplates as jest.Mock).mockResolvedValue([tpl]);
  (api.adminGetSubscriptionPlans as jest.Mock).mockResolvedValue([plan]);
  (api.adminGetSubscriptionOverview as jest.Mock).mockResolvedValue(overview);
});

const mount = () => render(<ThemeProvider><AdminPackagesPage /></ThemeProvider>);

it('affiche le titre « Offres » et les deux sections', async () => {
  mount();
  expect(await screen.findByRole('heading', { name: 'Offres' })).toBeInTheDocument();
  expect(await screen.findByText('Abonnements')).toBeInTheDocument();
  expect(screen.getByText('Carnets & Porte-monnaie')).toBeInTheDocument();
});

it('rend une carte par offre avec son pouls', async () => {
  mount();
  expect(await screen.findByText('Carte 10 parties')).toBeInTheDocument();
  expect(screen.getByText('Padel illimité')).toBeInTheDocument();
  expect(screen.getByText('8 en circulation · 23 vendus')).toBeInTheDocument();
  expect(screen.getByText(/12 abonnés actifs · 588 €\/mois/)).toBeInTheDocument();
});

it('« Créer une offre » ouvre le studio', async () => {
  mount();
  fireEvent.click(await screen.findByRole('button', { name: /Créer une offre/ }));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  expect(screen.getByText('Ce que verront vos joueurs')).toBeInTheDocument();
});

it('crée un carnet via le studio (create + upload image sauté sans fichier)', async () => {
  (api.adminCreatePackageTemplate as jest.Mock).mockResolvedValue({ ...tpl, id: 'tpl-new' });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: /Créer une offre/ }));
  await screen.findByRole('dialog');
  fireEvent.click(screen.getByRole('button', { name: /Carnet/ }));
  fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Carte 5' } });
  fireEvent.change(screen.getByLabelText('Prix de vente €'), { target: { value: '60' } });
  fireEvent.change(screen.getByLabelText('Entrées'), { target: { value: '5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Mettre en vente' }));
  await waitFor(() => expect(api.adminCreatePackageTemplate).toHaveBeenCalledWith(
    'club-1', expect.objectContaining({ kind: 'ENTRIES', name: 'Carte 5', price: 60, entriesCount: 5 }), 'tok',
  ));
  expect(api.adminUploadPackageTemplateImage).not.toHaveBeenCalled();
});

it('« Modifier » un abonnement préremplit le studio et enregistre via update', async () => {
  (api.adminUpdateSubscriptionPlan as jest.Mock).mockResolvedValue(plan);
  mount();
  await screen.findByText('Padel illimité');
  const planCard = screen.getByText('Padel illimité').closest('div')!.parentElement!.parentElement!;
  fireEvent.click(within(planCard).getByRole('button', { name: 'Modifier' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByDisplayValue('Padel illimité')).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.adminUpdateSubscriptionPlan).toHaveBeenCalledWith(
    'club-1', 'plan-1', expect.objectContaining({ name: 'Padel illimité', monthlyPrice: 49 }), 'tok',
  ));
});

it('« Retirer » désactive l’offre', async () => {
  (api.adminUpdatePackageTemplate as jest.Mock).mockResolvedValue({ ...tpl, isActive: false });
  mount();
  await screen.findByText('Carte 10 parties');
  const tplCard = screen.getByText('Carte 10 parties').closest('div')!.parentElement!.parentElement!;
  fireEvent.click(within(tplCard).getByRole('button', { name: 'Retirer' }));
  await waitFor(() => expect(api.adminUpdatePackageTemplate).toHaveBeenCalledWith(
    'club-1', 'tpl-1', { isActive: false }, 'tok',
  ));
});

it('une section vide ne rend pas son intitulé', async () => {
  (api.adminGetSubscriptionPlans as jest.Mock).mockResolvedValue([]);
  (api.adminGetSubscriptionOverview as jest.Mock).mockResolvedValue({ kpis: { activeCount: 0, monthlyRevenueCents: 0, expiringSoonCount: 0 }, plans: [], subscribers: [] });
  mount();
  await screen.findByText('Carte 10 parties');
  expect(screen.getByText('Carnets & Porte-monnaie')).toBeInTheDocument();
  expect(screen.queryByText('Abonnements')).toBeNull();
});

it('aucune offre → carte d’état vide seule, pas d’intitulés de section', async () => {
  (api.adminGetPackageTemplates as jest.Mock).mockResolvedValue([]);
  (api.adminGetSubscriptionPlans as jest.Mock).mockResolvedValue([]);
  (api.adminGetSubscriptionOverview as jest.Mock).mockResolvedValue({ kpis: { activeCount: 0, monthlyRevenueCents: 0, expiringSoonCount: 0 }, plans: [], subscribers: [] });
  mount();
  expect(await screen.findByText('Créez votre première offre')).toBeInTheDocument();
  expect(screen.queryByText('Abonnements')).toBeNull();
  expect(screen.queryByText('Carnets & Porte-monnaie')).toBeNull();
});
