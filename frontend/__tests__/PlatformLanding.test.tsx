import { render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import PlatformLanding from '@/components/PlatformLanding';

const replace = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));
jest.mock('@/components/platform/AnonymousView', () => ({ __esModule: true, default: () => <div data-testid="anon" /> }));
jest.mock('@/lib/api', () => ({ api: { getMyClubs: jest.fn(), getMyMemberships: jest.fn() }, assetUrl: (u: string) => u }));

const useAuthMock = jest.fn();
jest.mock('@/lib/useAuth', () => ({ useAuth: () => useAuthMock() }));

const wrap = () => render(<ThemeProvider><PlatformLanding /></ThemeProvider>);

describe('PlatformLanding (dispatch anonyme)', () => {
  beforeEach(() => { replace.mockReset(); });

  it('visiteur non connecté → AnonymousView, jamais de redirection /login', async () => {
    useAuthMock.mockReturnValue({ token: null, ready: true });
    wrap();
    expect(await screen.findByTestId('anon')).toBeInTheDocument();
    await waitFor(() => expect(replace).not.toHaveBeenCalled());
  });
});
