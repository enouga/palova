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
    adminSetMemberStaffRole: jest.fn(),
    adminSetMemberCoach: jest.fn(),
    adminRemoveMember: jest.fn(),
    adminUpdateMember: jest.fn(),
    adminSetMemberBlocked: jest.fn(),
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

beforeEach(() => {
  jest.clearAllMocks();
  (api.adminGetMembers as jest.Mock).mockResolvedValue(members);
  (api.getMyClubs as jest.Mock).mockResolvedValue([{ clubId: 'club-1', slug: 'c', name: 'Club', role: 'ADMIN' }]);
  (api.getMyProfile as jest.Mock).mockResolvedValue({ id: 'u-viewer' });
  (api.adminSetMemberStaffRole as jest.Mock).mockResolvedValue({ userId: 'u-plain', staffRole: 'STAFF' });
  (api.adminSetMemberCoach as jest.Mock).mockResolvedValue({ userId: 'u-plain', isCoach: true });
});

const mount = () => render(<ThemeProvider><AdminMembersPage /></ThemeProvider>);

// Ouvre le panneau d'un membre (le bloc « Rôle » / « Supprimer » vit dans le panneau).
const openPanel = async (name: string) => fireEvent.click(await screen.findByRole('button', { name: `Ouvrir la fiche de ${name}` }));
const roleGroup = (name: string) => screen.getByRole('group', { name: `Rôle de ${name}` });

it('affiche les badges Gérant/Admin (rien pour un membre simple)', async () => {
  mount();
  await screen.findByText('Paul Martin');
  expect(screen.getByText('Gérant')).toBeInTheDocument();
  expect(screen.getByText('Admin')).toBeInTheDocument();
  expect(screen.queryByText('Staff')).toBeNull();
});

it('viewer ADMIN : bloc Rôle éditable pour un membre simple (segmented + case Coach)', async () => {
  mount();
  await screen.findByText('Paul Martin');

  await openPanel('Paul Martin');
  const group = await waitFor(() => roleGroup('Paul Martin'));
  expect(within(group).getByRole('button', { name: 'Membre' })).toBeInTheDocument();
  expect(within(group).getByRole('button', { name: 'Staff' })).toBeInTheDocument();
  expect(within(group).getByRole('button', { name: 'Admin' })).toBeInTheDocument();
  expect(within(group).getByRole('checkbox', { name: /Coach/ })).toBeInTheDocument();
});

it('viewer ADMIN : bloc Rôle en lecture seule pour le gérant et pour soi-même (case Coach reste active)', async () => {
  mount();
  await screen.findByText('Paul Martin');

  await openPanel('Olivia Gerante');
  const ownerGroup = await waitFor(() => roleGroup('Olivia Gerante'));
  expect(within(ownerGroup).queryByRole('button', { name: 'Staff' })).toBeNull();
  expect(within(ownerGroup).getByText('Gérant')).toBeInTheDocument();
  expect(within(ownerGroup).getByRole('checkbox', { name: /Coach/ })).toBeInTheDocument();

  await openPanel('Vera Moi');
  const selfGroup = await waitFor(() => roleGroup('Vera Moi'));
  expect(within(selfGroup).queryByRole('button', { name: 'Membre' })).toBeNull();
  expect(within(selfGroup).getByText('Admin')).toBeInTheDocument();
  expect(within(selfGroup).getByRole('checkbox', { name: /Coach/ })).toBeInTheDocument();
});

it('viewer STAFF : badges visibles mais aucun bloc Rôle dans le panneau', async () => {
  (api.getMyClubs as jest.Mock).mockResolvedValue([{ clubId: 'club-1', slug: 'c', name: 'Club', role: 'STAFF' }]);
  mount();
  await screen.findByText('Paul Martin');
  expect(screen.getByText('Gérant')).toBeInTheDocument();
  await openPanel('Paul Martin');
  expect(screen.queryByRole('group', { name: /Rôle de/ })).toBeNull();
});

it('sélectionner « Staff » dans le segmented → PATCH puis rechargement', async () => {
  mount();
  await openPanel('Paul Martin');
  const group = await waitFor(() => roleGroup('Paul Martin'));
  fireEvent.click(within(group).getByRole('button', { name: 'Staff' }));
  await waitFor(() => expect(api.adminSetMemberStaffRole).toHaveBeenCalledWith('club-1', 'u-plain', 'STAFF', 'tok'));
  await waitFor(() => expect(api.adminGetMembers).toHaveBeenCalledTimes(2));
});

it('supprimer un membre staff → 409 MEMBER_IS_STAFF affiché en français', async () => {
  (api.adminRemoveMember as jest.Mock).mockRejectedValue(new Error('MEMBER_IS_STAFF'));
  mount();
  await screen.findByText('Vera Moi');
  await openPanel('Vera Moi');
  fireEvent.click(screen.getByRole('button', { name: 'Supprimer le membre' }));
  fireEvent.click(screen.getByRole('button', { name: 'Supprimer' })); // confirmation
  await screen.findByText(/retirez d'abord son rôle/i);
  expect(api.adminRemoveMember).toHaveBeenCalledWith('club-1', 'm2', 'tok');
});

it('bloquer un membre staff → 409 MEMBER_IS_STAFF affiché en français', async () => {
  (api.adminSetMemberBlocked as jest.Mock).mockRejectedValue(new Error('MEMBER_IS_STAFF'));
  mount();
  await screen.findByText('Vera Moi');
  await openPanel('Vera Moi');
  fireEvent.click(screen.getByRole('button', { name: 'Bloquer' }));
  await screen.findByText(/retirez d'abord son rôle/i);
  expect(api.adminSetMemberBlocked).toHaveBeenCalledWith('club-1', 'm2', true, 'tok');
});

const sam = { ...base, id: 'm4', userId: 'u-staff', firstName: 'Sam', lastName: 'Staffeur', email: 's@x.fr', staffRole: 'STAFF' };

it('révoquer via « Membre » → PATCH role null', async () => {
  (api.adminGetMembers as jest.Mock).mockResolvedValue([...members, sam]);
  mount();
  await openPanel('Sam Staffeur');
  const group = await waitFor(() => roleGroup('Sam Staffeur'));
  fireEvent.click(within(group).getByRole('button', { name: 'Membre' }));
  await waitFor(() => expect(api.adminSetMemberStaffRole).toHaveBeenCalledWith('club-1', 'u-staff', null, 'tok'));
});

it('re-sélectionner le rôle courant = no-op (pas de PATCH, pas de rechargement)', async () => {
  (api.adminGetMembers as jest.Mock).mockResolvedValue([...members, sam]);
  mount();
  await openPanel('Sam Staffeur');
  const group = await waitFor(() => roleGroup('Sam Staffeur'));
  fireEvent.click(within(group).getByRole('button', { name: 'Staff' }));
  await waitFor(() => expect(api.adminGetMembers).toHaveBeenCalledTimes(1));
  expect(api.adminSetMemberStaffRole).not.toHaveBeenCalled();
});

it('cocher « Coach » → PATCH isCoach puis rechargement', async () => {
  mount();
  await openPanel('Paul Martin');
  const group = await waitFor(() => roleGroup('Paul Martin'));
  fireEvent.click(within(group).getByRole('checkbox', { name: /Coach/ }));
  await waitFor(() => expect(api.adminSetMemberCoach).toHaveBeenCalledWith('club-1', 'u-plain', true, 'tok'));
  await waitFor(() => expect(api.adminGetMembers).toHaveBeenCalledTimes(2));
});

it('décocher « Coach » → PATCH isCoach false', async () => {
  (api.adminGetMembers as jest.Mock).mockResolvedValue(
    members.map((m) => (m.userId === 'u-plain' ? { ...m, isCoach: true } : m)),
  );
  (api.adminSetMemberCoach as jest.Mock).mockResolvedValue({ userId: 'u-plain', isCoach: false });
  mount();
  await openPanel('Paul Martin');
  const group = await waitFor(() => roleGroup('Paul Martin'));
  const checkbox = within(group).getByRole('checkbox', { name: /Coach/ }) as HTMLInputElement;
  expect(checkbox.checked).toBe(true);
  fireEvent.click(checkbox);
  await waitFor(() => expect(api.adminSetMemberCoach).toHaveBeenCalledWith('club-1', 'u-plain', false, 'tok'));
});
