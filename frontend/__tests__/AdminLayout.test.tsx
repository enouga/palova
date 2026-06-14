import { render, screen, fireEvent, act } from '@testing-library/react';
import AdminLayout from '../app/admin/layout';
import { ThemeProvider } from '../lib/ThemeProvider';

// Objets stables entre les rendus : club et router sont dans les deps du useEffect
// de vérification des droits — une identité neuve relancerait getMyClubs à chaque rendu.
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => '/admin',
}));

jest.mock('../lib/useAuth', () => ({
  useAuth: () => ({ token: 'abc', clubId: null, ready: true }),
}));

const mockClubCtx = { slug: 'demo', club: { id: 'c1', slug: 'demo', name: 'Club Démo', logoUrl: null }, loading: false };
jest.mock('../lib/ClubProvider', () => ({ useClub: () => mockClubCtx }));

jest.mock('../lib/api', () => ({
  api: {
    getMyClubs: jest.fn(),
    // Chargé au montage par ProfileMenu (info-bulle d'identité) ; le menu ne s'ouvre pas ici.
    getMyProfile: jest.fn().mockResolvedValue({ firstName: 'Admin', lastName: 'User', email: 'admin@palova.fr', avatarUrl: null }),
    getMyClubMembership: jest.fn(),
    getMyClubPackages: jest.fn(),
  },
  assetUrl: (p: string | null) => p,
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { api } = require('../lib/api') as { api: Record<string, jest.Mock> };

const KEY = 'palova:admin-sidebar';

const wrap = async () => {
  render(
    <ThemeProvider>
      <AdminLayout>
        <div>Contenu admin</div>
      </AdminLayout>
    </ThemeProvider>,
  );
  // Laisse la promesse getMyClubs (vérification des droits) se résoudre dans act.
  await act(async () => {});
};

describe('AdminLayout — toggle de la sidebar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    api.getMyClubs.mockResolvedValue([{ clubId: 'c1' }]);
  });

  it("affiche le nom du club dans l'en-tête, même sans logo", async () => {
    await wrap();
    expect(screen.getByText('Club Démo')).toBeInTheDocument();
  });

  it('le toggle masque puis ré-affiche la sidebar', async () => {
    await wrap();
    expect(screen.getByText('Espace club')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Masquer le menu'));
    expect(screen.queryByText('Espace club')).not.toBeInTheDocument();
    expect(screen.getByText('Contenu admin')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Afficher le menu'));
    expect(screen.getByText('Espace club')).toBeInTheDocument();
  });

  it('relit la préférence localStorage au montage (sidebar masquée)', async () => {
    localStorage.setItem(KEY, 'collapsed');
    await wrap();
    expect(screen.getByLabelText('Afficher le menu')).toBeInTheDocument();
    expect(screen.queryByText('Espace club')).not.toBeInTheDocument();
  });

  it('écrit la préférence dans localStorage à chaque toggle', async () => {
    await wrap();

    fireEvent.click(screen.getByLabelText('Masquer le menu'));
    expect(localStorage.getItem(KEY)).toBe('collapsed');

    fireEvent.click(screen.getByLabelText('Afficher le menu'));
    expect(localStorage.getItem(KEY)).toBe('open');
  });

  describe('repli par défaut sur téléphone', () => {
    const realMatchMedia = window.matchMedia;
    // matche uniquement la requête « petit écran » (téléphone).
    const phoneMM = (q: string) => ({
      matches: /max-width/.test(q), media: q, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
    });
    beforeEach(() => { window.matchMedia = phoneMM as unknown as typeof window.matchMedia; });
    afterEach(() => { window.matchMedia = realMatchMedia; });

    it('téléphone sans préférence : sidebar repliée par défaut', async () => {
      await wrap();
      expect(screen.getByLabelText('Afficher le menu')).toBeInTheDocument();
      expect(screen.queryByText('Espace club')).not.toBeInTheDocument();
    });

    it('une préférence « open » explicite prime sur le repli auto', async () => {
      localStorage.setItem(KEY, 'open');
      await wrap();
      expect(screen.getByText('Espace club')).toBeInTheDocument();
    });
  });
});
