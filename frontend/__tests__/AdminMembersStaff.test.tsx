import { render, screen, fireEvent } from '@testing-library/react';
import AdminMembersPage from '../app/admin/members/page';
import { ThemeProvider } from '../lib/ThemeProvider';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush, back: jest.fn() }) }));
jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));
jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'club-1' } }) }));
jest.mock('../lib/api', () => ({
  api: {
    adminGetMembers: jest.fn(),
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
});

const mount = () => render(<ThemeProvider><AdminMembersPage /></ThemeProvider>);

it('affiche les badges Gérant/Admin (rien pour un membre simple)', async () => {
  mount();
  await screen.findByText('Paul Martin');
  expect(screen.getByText('Gérant')).toBeInTheDocument();
  expect(screen.getByText('Admin')).toBeInTheDocument();
  expect(screen.queryByText('Staff')).toBeNull();
});

it('cliquer une ligne navigue directement vers la fiche du membre (le panneau a disparu)', async () => {
  mount();
  await screen.findByText('Paul Martin');
  fireEvent.click(screen.getByRole('button', { name: 'Ouvrir la fiche de Paul Martin' }));
  expect(mockPush).toHaveBeenCalledWith('/admin/members/u-plain');
});

it('cliquer le nom (lien distinct) navigue aussi vers la même fiche', async () => {
  mount();
  await screen.findByText('Paul Martin');
  fireEvent.click(screen.getByRole('link', { name: 'Voir le passif de Paul Martin' }));
  expect(mockPush).toHaveBeenCalledWith('/admin/members/u-plain');
});

// Les cas rôle / coach / juge-arbitre / bloquer / supprimer testaient le panneau latéral
// MemberPanel, supprimé en Task 6 (fiche membre 360 : la liste navigue, le panneau disparaît).
// Migrés dans frontend/__tests__/MemberHistory.test.tsx, section « Carte « Rôle & accès » » :
// 'rôle & accès : changer le rôle appelle adminSetMemberStaffRole'
// 'rôle & accès : re-sélectionner le rôle courant = no-op (pas de PATCH)'
// 'rôle & accès : cocher « Coach » appelle adminSetMemberCoach puis recharge la fiche'
// 'rôle & accès : cocher « Juge-arbitre » appelle adminSetMemberReferee, indépendant de Coach'
// 'rôle & accès : viewer STAFF → aucun bloc Rôle/Coach/Juge-arbitre visible (canManageStaff=false)'
// 'rôle & accès : bloquer un membre appelle adminSetMemberBlocked(true)'
// 'rôle & accès : bloquer un membre staff → 409 MEMBER_IS_STAFF affiché en français'
// 'rôle & accès : supprimer un membre → confirmation puis adminRemoveMember + navigation vers la liste'
// 'rôle & accès : supprimer un membre staff → 409 MEMBER_IS_STAFF affiché en français'
