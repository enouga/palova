import { render, screen, fireEvent } from '@testing-library/react';
import AdminMembersPage from '../app/admin/members/page';
import { ThemeProvider } from '../lib/ThemeProvider';

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push, back: jest.fn() }) }));
jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));
jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'club-1' } }) }));
jest.mock('../lib/api', () => ({
  api: {
    adminGetMembers: jest.fn().mockResolvedValue([
      { id: 'm1', userId: 'u1', firstName: 'Jean', lastName: 'Dupont', email: 'j@d.fr', phone: null, isSubscriber: false, membershipNo: null, status: 'ACTIVE', note: null, watch: true },
    ]),
    getMyClubs: jest.fn().mockResolvedValue([]),
    getMyProfile: jest.fn().mockResolvedValue({ id: 'viewer' }),
    adminSetMemberStaffRole: jest.fn(),
  },
  assetUrl: (u: string | null) => u,
}));

it('clic sur le nom d\'un membre → navigation vers son passif (par userId)', async () => {
  render(<ThemeProvider><AdminMembersPage /></ThemeProvider>);
  const cell = await screen.findByRole('link', { name: 'Voir le passif de Jean Dupont' });
  fireEvent.click(cell);
  expect(push).toHaveBeenCalledWith('/admin/members/u1');
});

it('affiche le badge « à surveiller » quand watch est vrai', async () => {
  render(<ThemeProvider><AdminMembersPage /></ThemeProvider>);
  await screen.findByText('Jean Dupont');
  expect(screen.getByTitle('À surveiller')).toBeInTheDocument();
});
