import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
});

const mount = () => render(<ThemeProvider><AdminMembersPage /></ThemeProvider>);

// Ouvre le panneau d'un membre (le bouton « Rôle… » / « Supprimer » vit dans le panneau).
const openPanel = async (name: string) => fireEvent.click(await screen.findByRole('button', { name: `Ouvrir la fiche de ${name}` }));

it('affiche les badges Gérant/Admin (rien pour un membre simple)', async () => {
  mount();
  await screen.findByText('Paul Martin');
  expect(screen.getByText('Gérant')).toBeInTheDocument();
  expect(screen.getByText('Admin')).toBeInTheDocument();
  expect(screen.queryByText('Staff')).toBeNull();
});

it('viewer ADMIN : « Rôle… » présent dans le panneau d\'un membre simple, absent pour le gérant et soi-même', async () => {
  mount();
  await screen.findByText('Paul Martin');

  await openPanel('Paul Martin');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Rôle staff de Paul Martin' })).toBeInTheDocument());

  await openPanel('Olivia Gerante');
  expect(screen.queryByRole('button', { name: 'Rôle staff de Olivia Gerante' })).toBeNull();

  await openPanel('Vera Moi');
  expect(screen.queryByRole('button', { name: 'Rôle staff de Vera Moi' })).toBeNull();
});

it('viewer STAFF : badges visibles mais aucune action « Rôle… » dans le panneau', async () => {
  (api.getMyClubs as jest.Mock).mockResolvedValue([{ clubId: 'club-1', slug: 'c', name: 'Club', role: 'STAFF' }]);
  mount();
  await screen.findByText('Paul Martin');
  expect(screen.getByText('Gérant')).toBeInTheDocument();
  await openPanel('Paul Martin');
  expect(screen.queryByRole('button', { name: /Rôle staff de/ })).toBeNull();
});

it('sélectionner « Staff » dans le menu → PATCH puis rechargement', async () => {
  mount();
  await openPanel('Paul Martin');
  fireEvent.click(await screen.findByRole('button', { name: 'Rôle staff de Paul Martin' }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: /^Staff/ }));
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

const sam = { ...base, id: 'm4', userId: 'u-staff', firstName: 'Sam', lastName: 'Staffeur', email: 's@x.fr', staffRole: 'STAFF' };

it('révoquer via « Aucun » → PATCH role null', async () => {
  (api.adminGetMembers as jest.Mock).mockResolvedValue([...members, sam]);
  mount();
  await openPanel('Sam Staffeur');
  fireEvent.click(await screen.findByRole('button', { name: 'Rôle staff de Sam Staffeur' }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: /^Aucun/ }));
  await waitFor(() => expect(api.adminSetMemberStaffRole).toHaveBeenCalledWith('club-1', 'u-staff', null, 'tok'));
});

it('re-sélectionner le rôle courant = no-op (pas de PATCH, menu fermé)', async () => {
  (api.adminGetMembers as jest.Mock).mockResolvedValue([...members, sam]);
  mount();
  await openPanel('Sam Staffeur');
  fireEvent.click(await screen.findByRole('button', { name: 'Rôle staff de Sam Staffeur' }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: /^Staff/ }));
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  expect(api.adminSetMemberStaffRole).not.toHaveBeenCalled();
});
