import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminMembersPage from '../app/admin/members/page';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));
jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'club-1', levelSystemEnabled: true, clubSports: [] } }) }));
jest.mock('../lib/useIsDesktop', () => ({ useIsDesktop: () => true }));
jest.mock('../lib/api', () => ({
  api: {
    adminGetMembers: jest.fn(),
    adminGetClub: jest.fn().mockResolvedValue({ id: 'club-1', quickPaymentMethods: [], payAtClubOnly: false }),
    getMyClubs: jest.fn(),
    getMyProfile: jest.fn(),
    adminSetMemberStaffRole: jest.fn(),
    adminRemoveMember: jest.fn(),
    adminUpdateMember: jest.fn(),
    adminSetMemberBlocked: jest.fn(),
    // Fiche cockpit — chargée dès qu'un membre est sélectionné.
    adminGetMemberHistory: jest.fn(),
    adminGetMemberNotes: jest.fn().mockResolvedValue([]),
    adminGetMemberLevel: jest.fn().mockResolvedValue(null),
  },
  assetUrl: (u: string | null) => u,
}));
import { api } from '../lib/api';

const base = { phone: null, isSubscriber: false, membershipNo: null, status: 'ACTIVE', note: null, watch: false };
const members = [
  { ...base, id: 'm1', userId: 'u-owner',  firstName: 'Olivia', lastName: 'Gerante', email: 'o@x.fr', staffRole: 'OWNER' },
  { ...base, id: 'm2', userId: 'u-viewer', firstName: 'Vera',   lastName: 'Moi',     email: 'v@x.fr', staffRole: 'ADMIN' },
  { ...base, id: 'm3', userId: 'u-plain',  firstName: 'Paul',   lastName: 'Martin',  email: 'p@x.fr', staffRole: null },
];

const historyFor = (m: typeof members[number]) => ({
  member: { userId: m.userId, firstName: m.firstName, lastName: m.lastName, email: m.email, phone: null, avatarUrl: null, isSubscriber: false, membershipNo: null, status: 'ACTIVE', watch: false, hasActivePackage: false, since: '2024-01-01T00:00:00Z' },
  reservations: [], counts: { total: 0, confirmed: 0, cancelled: 0, lateCancelled: 0, noShow: 0, upcoming: 0 },
  heatmap: Array.from({ length: 7 }, () => new Array(24).fill(0)),
  favorites: { resource: null, sportKey: null, weekday: null },
  finance: { totalSpent: '0.00', averageBasket: '0.00', outstanding: '0.00', unpaid: [], paymentsByMethod: {}, revenueByMonth: [], prepaid: { balances: [], consumption: [] } },
  game: { sportKey: 'padel', level: null, tier: null, isProvisional: false, matchesPlayed: 0, levelPoints: [], wins: 0, losses: 0, frequentPartners: [] },
  loyalty: { firstVisitAt: null, lastVisitAt: null, daysSinceLastVisit: null, tenureDays: 0, playsPerMonth: 0, cancellationRate: 0, atRisk: false },
});

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState(null, '', '/admin/members');
  (api.adminGetMembers as jest.Mock).mockResolvedValue(members);
  (api.adminGetClub as jest.Mock).mockResolvedValue({ id: 'club-1', quickPaymentMethods: [], payAtClubOnly: false });
  (api.getMyClubs as jest.Mock).mockResolvedValue([{ clubId: 'club-1', slug: 'c', name: 'Club', role: 'ADMIN' }]);
  (api.getMyProfile as jest.Mock).mockResolvedValue({ id: 'u-viewer' });
  (api.adminSetMemberStaffRole as jest.Mock).mockResolvedValue({ userId: 'u-plain', staffRole: 'STAFF' });
  (api.adminGetMemberHistory as jest.Mock).mockImplementation((_clubId: string, userId: string) => {
    const m = [...members, sam].find((x) => x.userId === userId) ?? members[2];
    return Promise.resolve(JSON.parse(JSON.stringify(historyFor(m))));
  });
});

const mount = () => render(<ThemeProvider><AdminMembersPage /></ThemeProvider>);

// Ouvre la fiche cockpit d'un membre (le bouton « Rôle… » / « Supprimer » vit dans son menu « ⋯ »,
// items rendus role="menuitem" — pas role="button" — car le conteneur est role="menu").
const openCockpit = async (name: string) => {
  fireEvent.click(await screen.findByRole('button', { name: `Ouvrir la fiche de ${name}` }));
  await screen.findByRole('button', { name: "Plus d'actions" });
};
const openOverflowMenu = () => fireEvent.click(screen.getByRole('button', { name: "Plus d'actions" }));

it('affiche les badges Gérant/Admin (rien pour un membre simple)', async () => {
  mount();
  await screen.findByText('Paul Martin');
  expect(screen.getByText('Gérant')).toBeInTheDocument();
  expect(screen.getByText('Admin')).toBeInTheDocument();
  expect(screen.queryByText('Staff')).toBeNull();
});

it('viewer ADMIN : « Rôle… » présent dans le menu d\'un membre simple, absent pour le gérant et soi-même', async () => {
  mount();
  await screen.findByText('Paul Martin');

  await openCockpit('Paul Martin');
  openOverflowMenu();
  await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Rôle staff de Paul Martin' })).toBeInTheDocument());

  await openCockpit('Olivia Gerante');
  openOverflowMenu();
  expect(screen.queryByRole('menuitem', { name: 'Rôle staff de Olivia Gerante' })).toBeNull();

  await openCockpit('Vera Moi');
  openOverflowMenu();
  expect(screen.queryByRole('menuitem', { name: 'Rôle staff de Vera Moi' })).toBeNull();
});

it('viewer STAFF : badges visibles mais aucune action « Rôle… » dans le menu', async () => {
  (api.getMyClubs as jest.Mock).mockResolvedValue([{ clubId: 'club-1', slug: 'c', name: 'Club', role: 'STAFF' }]);
  mount();
  await screen.findByText('Paul Martin');
  expect(screen.getByText('Gérant')).toBeInTheDocument();
  await openCockpit('Paul Martin');
  openOverflowMenu();
  expect(screen.queryByRole('menuitem', { name: /Rôle staff de/ })).toBeNull();
});

it('sélectionner « Staff » dans le menu → PATCH puis rechargement', async () => {
  mount();
  await openCockpit('Paul Martin');
  openOverflowMenu();
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Rôle staff de Paul Martin' }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: /^Staff/ }));
  await waitFor(() => expect(api.adminSetMemberStaffRole).toHaveBeenCalledWith('club-1', 'u-plain', 'STAFF', 'tok'));
  await waitFor(() => expect(api.adminGetMembers).toHaveBeenCalledTimes(2));
});

it('supprimer un membre staff → 409 MEMBER_IS_STAFF affiché en français', async () => {
  (api.adminRemoveMember as jest.Mock).mockRejectedValue(new Error('MEMBER_IS_STAFF'));
  mount();
  await screen.findByText('Vera Moi');
  await openCockpit('Vera Moi');
  openOverflowMenu();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Supprimer le membre' }));
  fireEvent.click(screen.getByRole('button', { name: 'Supprimer' })); // confirmation
  await screen.findByText(/retirez d'abord son rôle/i);
  expect(api.adminRemoveMember).toHaveBeenCalledWith('club-1', 'm2', 'tok');
});

const sam = { ...base, id: 'm4', userId: 'u-staff', firstName: 'Sam', lastName: 'Staffeur', email: 's@x.fr', staffRole: 'STAFF' };

it('révoquer via « Aucun » → PATCH role null', async () => {
  (api.adminGetMembers as jest.Mock).mockResolvedValue([...members, sam]);
  mount();
  await openCockpit('Sam Staffeur');
  openOverflowMenu();
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Rôle staff de Sam Staffeur' }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: /^Aucun/ }));
  await waitFor(() => expect(api.adminSetMemberStaffRole).toHaveBeenCalledWith('club-1', 'u-staff', null, 'tok'));
});

it('re-sélectionner le rôle courant = no-op (pas de PATCH, menu fermé)', async () => {
  (api.adminGetMembers as jest.Mock).mockResolvedValue([...members, sam]);
  mount();
  await openCockpit('Sam Staffeur');
  openOverflowMenu();
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Rôle staff de Sam Staffeur' }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: /^Staff/ }));
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  expect(api.adminSetMemberStaffRole).not.toHaveBeenCalled();
});
