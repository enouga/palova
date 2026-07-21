import { render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import PlatformLanding from '@/components/PlatformLanding';
import { api } from '@/lib/api';

const replace = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));
jest.mock('@/components/platform/AnonymousView', () => ({ __esModule: true, default: () => <div data-testid="anon" /> }));
jest.mock('@/components/ProfileMenu', () => ({ ProfileMenu: () => <div data-testid="profile-menu" /> }));
jest.mock('@/lib/api', () => ({ api: { getMyClubs: jest.fn() }, assetUrl: (u: string) => u }));

const useAuthMock = jest.fn();
jest.mock('@/lib/useAuth', () => ({ useAuth: () => useAuthMock() }));

const wrap = () => render(<ThemeProvider><PlatformLanding /></ThemeProvider>);

describe('PlatformLanding (dispatch anonyme)', () => {
  beforeEach(() => { replace.mockReset(); (api.getMyClubs as jest.Mock).mockReset(); });

  it('visiteur non connecté → AnonymousView, jamais de redirection /login', async () => {
    useAuthMock.mockReturnValue({ token: null, ready: true });
    wrap();
    expect(await screen.findByTestId('anon')).toBeInTheDocument();
    await waitFor(() => expect(replace).not.toHaveBeenCalled());
  });

  it('joueur connecté sans club géré → redirection vers /decouvrir (plus de « Vos clubs » dédié)', async () => {
    useAuthMock.mockReturnValue({ token: 'tok', ready: true });
    (api.getMyClubs as jest.Mock).mockResolvedValue([]);
    wrap();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/decouvrir'));
    expect(screen.queryByText('Vos clubs.')).not.toBeInTheDocument();
  });

  it('gérant connecté → ManagerView (lien admin), jamais de redirection', async () => {
    useAuthMock.mockReturnValue({ token: 'tok', ready: true });
    (api.getMyClubs as jest.Mock).mockResolvedValue([{ clubId: 'c1', slug: 'padel-arena-paris', name: 'Padel Arena Paris' }]);
    wrap();
    expect(await screen.findByText(/Aller à l'admin de Padel Arena Paris/)).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});
