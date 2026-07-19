import { render, screen } from '@testing-library/react';
import { Logotype } from '../components/ui/atoms';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

let authCtx: { token: string | null; clubId: string | null; ready: boolean } = { token: null, clubId: null, ready: true };
jest.mock('../lib/useAuth', () => ({ useAuth: () => authCtx }));

let clubCtx: { slug: string | null } = { slug: null };
jest.mock('../lib/ClubProvider', () => ({ useClub: () => clubCtx }));

const wrap = () => render(<ThemeProvider><Logotype /></ThemeProvider>);

describe('Logotype — destination par défaut (pas de prop href)', () => {
  beforeEach(() => {
    authCtx = { token: null, clubId: null, ready: true };
    clubCtx = { slug: null };
  });

  it('hôte plateforme, joueur connecté simple (pas staff) → accueil personnalisé /', () => {
    authCtx = { token: 'abc', clubId: null, ready: true };
    wrap();
    expect(screen.getByLabelText('Accueil Palova')).toHaveAttribute('href', '/');
  });

  it('hôte plateforme, staff (clubId non nul) → back-office /admin', () => {
    authCtx = { token: 'abc', clubId: 'c1', ready: true };
    wrap();
    expect(screen.getByLabelText('Accueil Palova')).toHaveAttribute('href', '/admin');
  });

  it('sous-domaine club → home du club /', () => {
    clubCtx = { slug: 'demo' };
    authCtx = { token: 'abc', clubId: null, ready: true };
    wrap();
    expect(screen.getByLabelText('Accueil Palova')).toHaveAttribute('href', '/');
  });
});
