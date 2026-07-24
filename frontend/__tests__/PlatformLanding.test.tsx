import { render, screen } from '@testing-library/react';
import PlatformLanding from '../components/PlatformLanding';
import { ThemeProvider } from '../lib/ThemeProvider';

const replace = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace, push: jest.fn() }) }));
// Depuis la fusion des trois surfaces, PlatformLanding ne choisit plus un visage : il rend
// TOUJOURS `PalovaHome`, qui s'adapte lui-même à la session (cf. sa propre suite).
jest.mock('@/components/platform/PalovaHome', () => ({ PalovaHome: () => <div data-testid="home" /> }));
const useAuthMock = jest.fn();
jest.mock('@/lib/useAuth', () => ({ useAuth: () => useAuthMock() }));

const wrap = () => render(<ThemeProvider><PlatformLanding /></ThemeProvider>);

describe('PlatformLanding', () => {
  beforeEach(() => jest.clearAllMocks());

  it('visiteur non connecté → accueil unifié, jamais de redirection /login', () => {
    useAuthMock.mockReturnValue({ token: null, ready: true, clubId: null });
    wrap();
    expect(screen.getByTestId('home')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('connecté → le MÊME accueil (plus JAMAIS de redirection ni d\'écran « Vos clubs »)', () => {
    useAuthMock.mockReturnValue({ token: 'tok', ready: true, clubId: null });
    wrap();
    expect(screen.getByTestId('home')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    expect(screen.queryByText(/Vos clubs\./)).toBeNull();
  });

  it('session non résolue → squelette (on ne peint pas la version visiteur à un connecté)', () => {
    useAuthMock.mockReturnValue({ token: null, ready: false, clubId: null });
    wrap();
    expect(screen.queryByTestId('home')).toBeNull();
  });
});
