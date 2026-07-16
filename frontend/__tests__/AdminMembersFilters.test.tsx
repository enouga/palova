import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import AdminMembersPage from '../app/admin/members/page';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));
jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'club-1' } }) }));
jest.mock('../lib/api', () => ({
  api: {
    adminGetMembers: jest.fn(),
    getMyClubs: jest.fn(),
    getMyProfile: jest.fn(),
    adminAddMemberByEmail: jest.fn(),
    adminCreateMember: jest.fn(),
    // Contexte abonnés (fusion) — appelés paresseusement sur la pastille « Abonnés ».
    adminGetSubscriptionPlans: jest.fn(),
    adminRenewSubscription: jest.fn(),
    adminChangeSubscription: jest.fn(),
    adminCancelSubscription: jest.fn(),
  },
  assetUrl: (u: string | null) => u,
}));
import { api } from '../lib/api';

const base = { phone: null, isSubscriber: false, membershipNo: null, status: 'ACTIVE', note: null, watch: false };
const anaSub = { id: 'sub-a', planId: 'p1', planName: 'Padel illimité', expiresAt: '2027-01-01T00:00:00Z', monthlyPriceSnapshot: '39.00', sportKeys: ['padel'] };
const members = [
  { ...base, id: 'm1', userId: 'u1', firstName: 'Ana', lastName: 'Bernard', email: 'ana@x.fr', isSubscriber: true, hasActiveSubscription: true, subscriptionPlan: 'Padel illimité', subscription: anaSub },
  { ...base, id: 'm2', userId: 'u2', firstName: 'Zoé', lastName: 'Diaz', email: 'zoe@x.fr', status: 'BLOCKED' },
  { ...base, id: 'm3', userId: 'u3', firstName: 'Léo', lastName: 'Costa', email: 'leo@x.fr', staffRole: 'STAFF' },
];
const plans = [
  { id: 'p1', name: 'Padel illimité', monthlyPrice: '39.00', isActive: true, sportKeys: ['padel'], benefit: 'INCLUDED', discountPercent: null, commitmentMonths: 1, offPeakOnly: false, dailyCap: null, weeklyCap: null, description: null, imageUrl: null, createdAt: '2026-01-01T00:00:00Z' },
];

beforeEach(() => {
  jest.clearAllMocks();
  (api.adminGetMembers as jest.Mock).mockResolvedValue(members);
  (api.getMyClubs as jest.Mock).mockResolvedValue([{ clubId: 'club-1', slug: 'c', name: 'Club', role: 'ADMIN' }]);
  (api.getMyProfile as jest.Mock).mockResolvedValue({ id: 'u-viewer' });
  (api.adminGetSubscriptionPlans as jest.Mock).mockResolvedValue(plans);
});

const mount = () => render(<ThemeProvider><AdminMembersPage /></ThemeProvider>);

it('affiche les compteurs de segments', async () => {
  mount();
  await screen.findByText('Ana Bernard');
  expect(screen.getByRole('button', { name: 'Tous · 3' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Abonnés · 1' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Bloqués · 1' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Staff · 1' })).toBeInTheDocument();
});

it('le segment « Bloqués » ne montre que les membres bloqués', async () => {
  mount();
  await screen.findByText('Ana Bernard');
  fireEvent.click(screen.getByRole('button', { name: 'Bloqués · 1' }));
  expect(screen.getByText('Zoé Diaz')).toBeInTheDocument();
  expect(screen.queryByText('Ana Bernard')).toBeNull();
  expect(screen.queryByText('Léo Costa')).toBeNull();
});

it('le segment « Coachs » ne montre que les coachs', async () => {
  (api.adminGetMembers as jest.Mock).mockResolvedValue([
    ...members,
    { ...base, id: 'm4', userId: 'u4', firstName: 'Coco', lastName: 'Prof', email: 'coco@x.fr', isCoach: true },
  ]);
  mount();
  await screen.findByText('Ana Bernard');
  fireEvent.click(screen.getByRole('button', { name: 'Coachs · 1' }));
  expect(screen.getByText('Coco Prof')).toBeInTheDocument();
  expect(screen.queryByText('Ana Bernard')).toBeNull();
  expect(screen.queryByText('Léo Costa')).toBeNull();
});

it('le bandeau KPI est présent (club entier)', async () => {
  mount();
  await screen.findByText('Ana Bernard');
  // Labels propres au bandeau KPI (« Membres » collisionne avec le <h1>, « Actifs 30 j » est sans ambiguïté).
  expect(screen.getByText('Actifs 30 j')).toBeInTheDocument();
  expect(screen.getByText('Abonnés')).toBeInTheDocument();
});

it('contexte « Abonnés » : bandeau de pilotage + cycle de vie sur la ligne', async () => {
  mount();
  await screen.findByText('Ana Bernard');
  fireEvent.click(screen.getByRole('button', { name: 'Abonnés · 1' }));
  // Bandeau : KPI revenu + carte forfait
  expect(await screen.findByText('Revenu / mois')).toBeInTheDocument();
  expect(screen.getByText('39 €')).toBeInTheDocument();
  // Ligne enrichie : boutons de cycle de vie
  expect(screen.getByRole('button', { name: 'Renouveler' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Résilier' })).toBeInTheDocument();
  // Zoé (non abonnée) n'apparaît pas dans ce contexte
  expect(screen.queryByText('Zoé Diaz')).toBeNull();
});

it('contexte « Abonnés » : Résilier appelle adminCancelSubscription', async () => {
  (api.adminCancelSubscription as jest.Mock).mockResolvedValue({ id: 'sub-a', status: 'CANCELLED' });
  mount();
  await screen.findByText('Ana Bernard');
  fireEvent.click(screen.getByRole('button', { name: 'Abonnés · 1' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Résilier' }));
  fireEvent.click(await screen.findByRole('button', { name: /Résilier l’abonnement|Résilier l'abonnement/ }));
  await waitFor(() => expect(api.adminCancelSubscription).toHaveBeenCalledWith('club-1', 'sub-a', 'tok'));
});

it('contexte « Abonnés » : filtre « Expirent bientôt »', async () => {
  mount();
  await screen.findByText('Ana Bernard');
  fireEvent.click(screen.getByRole('button', { name: 'Abonnés · 1' }));
  // Ana expire en 2027 (> 30 j) → masquée quand on ne garde que « Expirent bientôt »
  fireEvent.click(await screen.findByRole('button', { name: 'Expirent bientôt' }));
  await waitFor(() => expect(screen.queryByText('Ana Bernard')).toBeNull());
});

it('dialog d\'ajout : onglet « Compte existant » → adminAddMemberByEmail puis rechargement', async () => {
  (api.adminAddMemberByEmail as jest.Mock).mockResolvedValue({ ok: true });
  mount();
  await screen.findByText('Ana Bernard');
  fireEvent.click(screen.getByRole('button', { name: /Ajouter un membre/ }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByPlaceholderText('joueur@exemple.fr'), { target: { value: 'new@x.fr' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Ajouter' }));
  await waitFor(() => expect(api.adminAddMemberByEmail).toHaveBeenCalledWith('club-1', 'new@x.fr', 'tok'));
  await waitFor(() => expect(api.adminGetMembers).toHaveBeenCalledTimes(2));
});

it('dialog d\'ajout : onglet « Nouveau compte » → adminCreateMember affiche le mot de passe temporaire', async () => {
  (api.adminCreateMember as jest.Mock).mockResolvedValue({ existed: false, tempPassword: 'TMP-9x' });
  mount();
  await screen.findByText('Ana Bernard');
  fireEvent.click(screen.getByRole('button', { name: /Ajouter un membre/ }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Nouveau compte' }));
  const inputs = within(dialog).getAllByRole('textbox'); // Prénom, Nom, Email, Téléphone, N° adhérent
  fireEvent.change(inputs[0], { target: { value: 'Max' } });
  fireEvent.change(inputs[1], { target: { value: 'Payne' } });
  fireEvent.change(inputs[2], { target: { value: 'max@x.fr' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Créer' }));
  await screen.findByText(/Mot de passe temporaire à transmettre : TMP-9x/);
});

it('export CSV : déclenche un téléchargement', async () => {
  const createUrl = jest.fn(() => 'blob:x');
  (global.URL as unknown as { createObjectURL: unknown }).createObjectURL = createUrl;
  (global.URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = jest.fn();
  const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  mount();
  await screen.findByText('Ana Bernard');
  fireEvent.click(screen.getByRole('button', { name: /Exporter CSV/ }));
  expect(createUrl).toHaveBeenCalledTimes(1);
  expect(clickSpy).toHaveBeenCalledTimes(1);
  clickSpy.mockRestore();
});

it('?plan=<id> ouvre le contexte Abonnés pré-filtré sur le forfait', async () => {
  window.history.replaceState({}, '', '/admin/members?plan=p1');
  mount();
  await screen.findByText('Ana Bernard');
  // Le segment Abonnés est actif → seule Ana (abonnée p1) est visible
  expect(screen.getByText('Ana Bernard')).toBeInTheDocument();
  expect(screen.queryByText('Zoé Diaz')).toBeNull();
  window.history.replaceState({}, '', '/admin/members');
});
