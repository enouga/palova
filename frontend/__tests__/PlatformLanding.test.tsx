import { render, screen } from '@testing-library/react';
import PlatformLanding from '../components/PlatformLanding';
import { ThemeProvider } from '../lib/ThemeProvider';

const replace = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace, push: jest.fn() }) }));
jest.mock('@/components/platform/AnonymousView', () => ({ __esModule: true, default: () => <div data-testid="anon" /> }));
jest.mock('@/components/platform/MonPalova', () => ({ MonPalova: () => <div data-testid="mon-palova" /> }));
const useAuthMock = jest.fn();
jest.mock('@/lib/useAuth', () => ({ useAuth: () => useAuthMock() }));

const wrap = () => render(<ThemeProvider><PlatformLanding /></ThemeProvider>);

describe('PlatformLanding', () => {
  beforeEach(() => jest.clearAllMocks());

  it('visiteur non connecté → AnonymousView, jamais de redirection /login', () => {
    useAuthMock.mockReturnValue({ token: null, ready: true, clubId: null });
    wrap();
    expect(screen.getByTestId('anon')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('connecté → Mon Palova (plus JAMAIS de redirection /decouvrir ni d\'écran « Vos clubs »)', () => {
    useAuthMock.mockReturnValue({ token: 'tok', ready: true, clubId: null });
    wrap();
    expect(screen.getByTestId('mon-palova')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    expect(screen.queryByText(/Vos clubs\./)).toBeNull();
  });

  it('session non résolue → squelette (ni vitrine ni accueil)', () => {
    useAuthMock.mockReturnValue({ token: null, ready: false, clubId: null });
    wrap();
    expect(screen.queryByTestId('anon')).toBeNull();
    expect(screen.queryByTestId('mon-palova')).toBeNull();
  });
});
