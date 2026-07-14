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

// Objets club STABLES (identité préservée entre les rendus, cf. deps du useEffect des droits).
const clubOn = { id: 'c1', slug: 'demo', name: 'Club Démo', logoUrl: null };
const clubOff = { id: 'c1', slug: 'demo', name: 'Club Démo', logoUrl: null, levelSystemEnabled: false };
const mockClubCtx: { slug: string | null; club: Record<string, unknown> | null; loading: boolean } =
  { slug: 'demo', club: clubOn as Record<string, unknown>, loading: false };
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
    mockClubCtx.slug = 'demo'; // hôte club par défaut
    mockClubCtx.club = clubOn; // restaure le club ON par défaut (objet stable)
    api.getMyClubs.mockResolvedValue([{ clubId: 'c1', role: 'OWNER' }]);
  });

  it("filet anti-blocage : après le délai, propose de recharger/se reconnecter si la garde ne se résout jamais", async () => {
    jest.useFakeTimers();
    // getMyClubs ne se résout JAMAIS → `allowed` reste null → la garde reste bloquée.
    api.getMyClubs.mockReturnValue(new Promise(() => {}));
    render(
      <ThemeProvider>
        <AdminLayout><div>Contenu admin</div></AdminLayout>
      </ThemeProvider>,
    );
    // Au départ : « Chargement… », aucun bouton de secours.
    expect(screen.getByText('Chargement…')).toBeInTheDocument();
    expect(screen.queryByText('Recharger')).not.toBeInTheDocument();
    // Après le délai de secours, l'écran devient actionnable (plus de spinner infini).
    act(() => { jest.advanceTimersByTime(12000); });
    expect(screen.getByText('Recharger')).toBeInTheDocument();
    expect(screen.getByText('Se reconnecter')).toBeInTheDocument();
    expect(screen.queryByText('Chargement…')).not.toBeInTheDocument();
    jest.useRealTimers();
  });

  it("hôte plateforme (slug null) : redirige vers l'accueil au lieu de « Chargement… » infini", async () => {
    // Sur l'hôte plateforme, aucun slug → le club ne se chargera jamais. La garde ne doit
    // pas laisser la page tourner indéfiniment : elle renvoie à l'accueil.
    mockClubCtx.slug = null;
    mockClubCtx.club = null;
    await wrap();
    expect(mockRouter.replace).toHaveBeenCalledWith('/');
    // On n'atteint jamais la vérification des droits (getMyClubs) sur cet hôte.
    expect(api.getMyClubs).not.toHaveBeenCalled();
  });

  it('club OFF : pas de lien nav « Matchs »', async () => {
    mockClubCtx.club = clubOff; // objet stable avec levelSystemEnabled: false
    await wrap();
    expect(screen.getByText('Tableau de bord')).toBeInTheDocument(); // sidebar rendue
    expect(screen.queryByText('Matchs')).not.toBeInTheDocument();
  });

  it('club ON : lien nav « Matchs » présent', async () => {
    await wrap();
    expect(screen.getByText('Matchs')).toBeInTheDocument();
  });

  it("affiche le nom du club dans l'en-tête, même sans logo", async () => {
    await wrap();
    expect(screen.getByText('Club Démo')).toBeInTheDocument();
  });

  it("lien rapide vers le Club-house dans l'en-tête", async () => {
    await wrap();
    const link = screen.getByLabelText('Voir le Club-house');
    expect(link).toHaveAttribute('href', '/');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('le toggle masque puis ré-affiche la sidebar', async () => {
    await wrap();
    expect(screen.getByText('Tableau de bord')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Masquer le menu'));
    expect(screen.queryByText('Tableau de bord')).not.toBeInTheDocument();
    expect(screen.getByText('Contenu admin')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Afficher le menu'));
    expect(screen.getByText('Tableau de bord')).toBeInTheDocument();
  });

  it('relit la préférence localStorage au montage (sidebar masquée)', async () => {
    localStorage.setItem(KEY, 'collapsed');
    await wrap();
    expect(screen.getByLabelText('Afficher le menu')).toBeInTheDocument();
    expect(screen.queryByText('Tableau de bord')).not.toBeInTheDocument();
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
      expect(screen.queryByText('Tableau de bord')).not.toBeInTheDocument();
    });

    it('une préférence « open » explicite prime sur le repli auto', async () => {
      localStorage.setItem(KEY, 'open');
      await wrap();
      expect(screen.getByText('Tableau de bord')).toBeInTheDocument();
    });
  });
});

describe('AdminLayout — sections repliables', () => {
  const SECTIONS = 'palova:admin-sidebar-sections';
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    mockClubCtx.slug = 'demo';
    mockClubCtx.club = clubOn;
    api.getMyClubs.mockResolvedValue([{ clubId: 'c1', role: 'OWNER' }]);
  });

  it('tout déplié par défaut : les entrées de section sont visibles', async () => {
    await wrap();
    expect(screen.getByText('Planning')).toBeInTheDocument();
    expect(screen.getByText('Caisse')).toBeInTheDocument();            // /admin/encaissement (comptoir)
    expect(screen.getByText('Ventes & journée')).toBeInTheDocument();  // /admin/caisse
    expect(screen.getByText('Paiements')).toBeInTheDocument();         // /admin/reservations (Finances)
    expect(screen.getByText('Réglages')).toBeInTheDocument();
  });

  it('replier une section masque ses entrées (le tableau de bord reste)', async () => {
    await wrap();
    fireEvent.click(screen.getByTitle('Replier Au quotidien'));
    expect(screen.queryByText('Planning')).not.toBeInTheDocument();
    expect(screen.getByTitle('Déplier Au quotidien')).toBeInTheDocument();
    expect(screen.getByText('Tableau de bord')).toBeInTheDocument(); // hors section
  });

  it('« Tout replier » masque les entrées de toutes les sections', async () => {
    await wrap();
    fireEvent.click(screen.getByText('Tout replier'));
    expect(screen.queryByText('Planning')).not.toBeInTheDocument();
    expect(screen.queryByText('Réglages')).not.toBeInTheDocument();
    expect(screen.getByText('Tableau de bord')).toBeInTheDocument();
    // Le bouton bascule alors vers « Tout déplier ».
    expect(screen.getByText('Tout déplier')).toBeInTheDocument();
  });

  it('mémorise les sections repliées dans localStorage', async () => {
    await wrap();
    fireEvent.click(screen.getByTitle('Replier Configuration'));
    expect(JSON.parse(localStorage.getItem(SECTIONS) || '[]')).toContain('Configuration');
  });

  it('relit les sections repliées au montage', async () => {
    localStorage.setItem(SECTIONS, JSON.stringify(['Au quotidien']));
    await wrap();
    expect(screen.queryByText('Planning')).not.toBeInTheDocument();
    expect(screen.getByTitle('Déplier Au quotidien')).toBeInTheDocument();
  });
});

describe('AdminLayout — entrées gatées par rôle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    mockClubCtx.slug = 'demo';
    mockClubCtx.club = clubOn;
  });

  it('OWNER : entrée « Abonnement Palova » présente', async () => {
    api.getMyClubs.mockResolvedValue([{ clubId: 'c1', role: 'OWNER' }]);
    await wrap();
    expect(screen.getByText('Abonnement Palova')).toBeInTheDocument();
  });

  it('ADMIN : entrée « Abonnement Palova » présente', async () => {
    api.getMyClubs.mockResolvedValue([{ clubId: 'c1', role: 'ADMIN' }]);
    await wrap();
    expect(screen.getByText('Abonnement Palova')).toBeInTheDocument();
  });

  it('STAFF : pas d’entrée « Abonnement Palova » (le reste de Finances est rendu)', async () => {
    api.getMyClubs.mockResolvedValue([{ clubId: 'c1', role: 'STAFF' }]);
    await wrap();
    expect(screen.getByText('Paiements')).toBeInTheDocument(); // la section Finances est là
    expect(screen.queryByText('Abonnement Palova')).not.toBeInTheDocument();
  });

  // « Paiement en ligne » mise de côté (2026-07-13) : masquée pour tous les rôles, y compris le gérant.
  it('OWNER : « Paiement en ligne » masquée (page mise de côté)', async () => {
    api.getMyClubs.mockResolvedValue([{ clubId: 'c1', role: 'OWNER' }]);
    await wrap();
    expect(screen.getByText('Paiements')).toBeInTheDocument(); // la section Finances est là
    expect(screen.queryByText('Paiement en ligne')).not.toBeInTheDocument();
  });
});
