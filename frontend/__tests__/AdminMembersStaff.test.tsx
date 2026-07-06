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
    adminRemoveMember: jest.fn(),
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
});

const mount = () => render(<ThemeProvider><AdminMembersPage /></ThemeProvider>);

it('affiche les badges Gérant/Admin (rien pour un membre simple)', async () => {
  mount();
  await screen.findByText('Paul Martin');
  expect(screen.getByText('Gérant')).toBeInTheDocument();
  expect(screen.getByText('Admin')).toBeInTheDocument();
  expect(screen.queryByText('Staff')).toBeNull();
});

it('viewer ADMIN : « Rôle… » présent sur un membre simple, absent sur le gérant et sur soi-même', async () => {
  mount();
  await screen.findByText('Paul Martin');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Rôle staff de Paul Martin' })).toBeInTheDocument());
  expect(screen.queryByRole('button', { name: 'Rôle staff de Olivia Gerante' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Rôle staff de Vera Moi' })).toBeNull();
});

it('viewer STAFF : badges visibles mais aucune action « Rôle… »', async () => {
  (api.getMyClubs as jest.Mock).mockResolvedValue([{ clubId: 'club-1', slug: 'c', name: 'Club', role: 'STAFF' }]);
  mount();
  await screen.findByText('Paul Martin');
  expect(screen.getByText('Gérant')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Rôle staff de/ })).toBeNull();
});

it('sélectionner « Staff » dans le menu → PATCH puis rechargement', async () => {
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Rôle staff de Paul Martin' }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: /^Staff/ }));
  await waitFor(() => expect(api.adminSetMemberStaffRole).toHaveBeenCalledWith('club-1', 'u-plain', 'STAFF', 'tok'));
  await waitFor(() => expect(api.adminGetMembers).toHaveBeenCalledTimes(2));
});

it('supprimer un membre staff → 409 MEMBER_IS_STAFF affiché en français', async () => {
  (api.adminRemoveMember as jest.Mock).mockRejectedValue(new Error('MEMBER_IS_STAFF'));
  mount();
  await screen.findByText('Vera Moi');
  // ligne de Vera Moi (ADMIN) : le bouton Suppr. existe (le gating de suppression n'a pas changé)
  const veraRow = screen.getByText('Vera Moi').closest('tr')!;
  fireEvent.click(within(veraRow as HTMLElement).getByText('Suppr.'));
  fireEvent.click(screen.getByRole('button', { name: 'Supprimer' }));
  await screen.findByText(/retirez d'abord son rôle/i);
  expect(api.adminRemoveMember).toHaveBeenCalledWith('club-1', 'm2', 'tok');
});

const sam = { ...base, id: 'm4', userId: 'u-staff', firstName: 'Sam', lastName: 'Staffeur', email: 's@x.fr', staffRole: 'STAFF' };

it('révoquer via « Aucun » → PATCH role null', async () => {
  (api.adminGetMembers as jest.Mock).mockResolvedValue([...members, sam]);
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Rôle staff de Sam Staffeur' }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: /^Aucun/ }));
  await waitFor(() => expect(api.adminSetMemberStaffRole).toHaveBeenCalledWith('club-1', 'u-staff', null, 'tok'));
});

it('re-sélectionner le rôle courant = no-op (pas de PATCH, menu fermé)', async () => {
  (api.adminGetMembers as jest.Mock).mockResolvedValue([...members, sam]);
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Rôle staff de Sam Staffeur' }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: /^Staff/ }));
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  expect(api.adminSetMemberStaffRole).not.toHaveBeenCalled();
});
