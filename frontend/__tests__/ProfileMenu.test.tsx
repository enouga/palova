import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProfileMenu } from '../components/ProfileMenu';
import { ThemeProvider } from '../lib/ThemeProvider';

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: jest.fn(), back: jest.fn() }),
}));

// Contexte club contrôlable : slug null = hôte plateforme, sinon hôte club.
let clubCtx: { slug: string | null; club: { id: string; slug: string; name: string; clubSports?: { id: string; sport: { key: string; name: string } }[] } | null; loading: boolean } =
  { slug: null, club: null, loading: false };
jest.mock('../lib/ClubProvider', () => ({ useClub: () => clubCtx }));

jest.mock('../lib/api', () => ({
  api: {
    getMyProfile: jest.fn(),
    getMyClubs: jest.fn(),
    getMyClubMembership: jest.fn(),
    getMyClubPackages: jest.fn(),
    getMyClubSubscriptions: jest.fn(),
  },
  assetUrl: (p: string | null) => (p ? `http://localhost:3001${p}` : null),
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { api } = require('../lib/api') as { api: Record<string, jest.Mock> };

// État d'installation PWA contrôlable par test (objet stable — cf. note mocks CLAUDE.md).
const installCtx: { state: 'hidden' | 'native' | 'ios-manual' | 'android-manual'; promptInstall: jest.Mock } =
  { state: 'hidden', promptInstall: jest.fn() };
jest.mock('../lib/useInstallPrompt', () => ({ useInstallPrompt: () => installCtx }));

const profile = {
  id: 'u1', email: 'marc@palova.fr', firstName: 'Marc', lastName: 'Bidaut', phone: '0601020304', sex: 'MALE',
  birthDate: null, avatarUrl: null, locale: 'fr', isSuperAdmin: false,
};

const wrap = (direction?: 'down' | 'up') =>
  render(<ThemeProvider><ProfileMenu direction={direction} /></ThemeProvider>);

function clearCookies() {
  document.cookie = 'token=; max-age=0; path=/';
  document.cookie = 'clubId=; max-age=0; path=/';
}

const openMenu = () => fireEvent.click(screen.getByLabelText('Mon profil'));

describe('ProfileMenu', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearCookies();
    clubCtx = { slug: null, club: null, loading: false };
    api.getMyProfile.mockResolvedValue(profile);
    api.getMyClubs.mockResolvedValue([]);
    api.getMyClubMembership.mockResolvedValue(null);
    api.getMyClubPackages.mockResolvedValue([]);
    api.getMyClubSubscriptions.mockResolvedValue([]);
    installCtx.state = 'hidden';
    installCtx.promptInstall = jest.fn();
  });
  afterEach(clearCookies);

  it('ne rend rien sans session', () => {
    const { container } = wrap();
    expect(container.querySelector('button')).toBeNull();
  });

  it('affiche le bouton avec une session, le menu reste fermé', async () => {
    document.cookie = 'token=abc; path=/';
    wrap();
    const btn = await screen.findByLabelText('Mon profil');
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Se déconnecter')).not.toBeInTheDocument();
    // L'identité est chargée dès le montage (pour l'info-bulle de survol), mais le menu reste fermé.
    expect(api.getMyProfile).toHaveBeenCalled();
    expect(api.getMyClubs).not.toHaveBeenCalled(); // données par club encore paresseuses
  });

  it("bouton fermé : avatar en initiales + info-bulle « Nom · e-mail », sans ouvrir le menu", async () => {
    document.cookie = 'token=abc; path=/';
    wrap();
    const btn = await screen.findByLabelText('Mon profil');
    // Initiales visibles dans le bouton dès le montage : on sait qui est connecté sans cliquer.
    await waitFor(() => expect(screen.getByText('MB')).toBeInTheDocument());
    expect(btn).toHaveAttribute('title', 'Marc Bidaut · marc@palova.fr'); // survol → identité complète
    expect(screen.queryByText('Se déconnecter')).not.toBeInTheDocument();  // menu toujours fermé
  });

  it("bouton fermé : photo d'avatar si disponible (pas d'initiales)", async () => {
    document.cookie = 'token=abc; path=/';
    api.getMyProfile.mockResolvedValue({ ...profile, avatarUrl: '/uploads/avatars/u1-1.png' });
    const { container } = wrap();
    await screen.findByLabelText('Mon profil');
    await waitFor(() => {
      const img = container.querySelector('img');
      expect(img).not.toBeNull();
      expect(img!.getAttribute('src')).toContain('/uploads/avatars/u1-1.png');
    });
    expect(screen.queryByText('MB')).not.toBeInTheDocument(); // photo → pas d'initiales
  });

  it("au clic : identité (nom, e-mail, initiales) + déconnexion + liens", async () => {
    document.cookie = 'token=abc; path=/';
    wrap();
    openMenu();
    expect(await screen.findByText('Marc Bidaut')).toBeInTheDocument();
    expect(screen.getByText('marc@palova.fr')).toBeInTheDocument();
    // Initiales à deux endroits : l'avatar du bouton + l'identité du menu ouvert.
    expect(screen.getAllByText('MB')).toHaveLength(2);
    expect(screen.getByText('Se déconnecter')).toBeInTheDocument();
    expect(screen.queryByText('Mes réservations')).not.toBeInTheDocument();
    expect(screen.getByText('Mes clubs')).toBeInTheDocument();
  });

  it('hôte club : chip Abonné et soldes utilisables', async () => {
    document.cookie = 'token=abc; path=/';
    clubCtx = { slug: 'demo', club: { id: 'c1', slug: 'demo', name: 'Club Démo' }, loading: false };
    api.getMyClubMembership.mockResolvedValue({ membershipNo: 'LIC42', status: 'ACTIVE', isSubscriber: true });
    api.getMyClubPackages.mockResolvedValue([
      { id: 'p1', kind: 'ENTRIES', creditsTotal: 10, creditsRemaining: 7, amountTotal: null, amountRemaining: null, purchasedAt: '2026-01-01', expiresAt: null, template: { name: 'Carnet 10', sportKeys: [] } },
      { id: 'p2', kind: 'ENTRIES', creditsTotal: 10, creditsRemaining: 0, amountTotal: null, amountRemaining: null, purchasedAt: '2026-01-01', expiresAt: null, template: { name: 'Carnet épuisé', sportKeys: [] } },
    ]);
    wrap();
    openMenu();
    expect(await screen.findByText('Abonné')).toBeInTheDocument();
    expect(screen.getByText('Carnet — 7 entrées')).toBeInTheDocument();
    expect(screen.queryByText(/Carnet — 0 entrée/)).not.toBeInTheDocument(); // solde épuisé masqué
  });

  it('club multi-sport : le sport apparaît à côté des soldes et abonnements', async () => {
    document.cookie = 'token=abc; path=/';
    clubCtx = {
      slug: 'demo', loading: false,
      club: { id: 'c1', slug: 'demo', name: 'Club Démo', clubSports: [
        { id: 'cs1', sport: { key: 'padel', name: 'Padel' } },
        { id: 'cs2', sport: { key: 'tennis', name: 'Tennis' } },
      ] },
    };
    api.getMyClubPackages.mockResolvedValue([
      { id: 'p1', kind: 'WALLET', creditsTotal: null, creditsRemaining: null, amountTotal: '100', amountRemaining: '90', purchasedAt: '2026-01-01', expiresAt: null, template: { name: 'Avoir', sportKeys: ['tennis'] } },
    ]);
    api.getMyClubSubscriptions.mockResolvedValue([
      { id: 's1', planId: 'pl1', status: 'ACTIVE', startedAt: '2026-01-01', expiresAt: '2027-01-01', monthlyPriceSnapshot: '30', sportKeys: ['padel'], offPeakOnly: true, benefit: 'INCLUDED', discountPercent: null, dailyCap: null, weeklyCap: null, plan: { name: 'Abonnement Padel' } },
    ]);
    wrap();
    openMenu();
    expect(await screen.findByText('Porte-monnaie — 90,00 € · Tennis')).toBeInTheDocument();
    expect(screen.getByText('Abonnement Padel · Padel')).toBeInTheDocument();
  });

  it("hôte plateforme : pas de section soldes ni d'appel membership", async () => {
    document.cookie = 'token=abc; path=/';
    wrap();
    openMenu();
    await screen.findByText('Marc Bidaut');
    expect(screen.queryByText('Mes soldes')).not.toBeInTheDocument();
    expect(api.getMyClubMembership).not.toHaveBeenCalled();
  });

  it('lien Superadmin : seulement si super-admin ET hors hôte club', async () => {
    document.cookie = 'token=abc; path=/';
    api.getMyProfile.mockResolvedValue({ ...profile, isSuperAdmin: true });
    wrap();
    openMenu();
    expect(await screen.findByText('Superadmin')).toBeInTheDocument();
  });

  it('pas de lien Superadmin sur un hôte club, même super-admin', async () => {
    document.cookie = 'token=abc; path=/';
    clubCtx = { slug: 'demo', club: { id: 'c1', slug: 'demo', name: 'Club Démo' }, loading: false };
    api.getMyProfile.mockResolvedValue({ ...profile, isSuperAdmin: true });
    wrap();
    openMenu();
    await screen.findByText('Marc Bidaut');
    expect(screen.queryByText('Superadmin')).not.toBeInTheDocument();
  });

  it("pas de lien « Espace club » dans le menu pour le club courant (déplacé dans l'en-tête)", async () => {
    document.cookie = 'token=abc; path=/';
    clubCtx = { slug: 'demo', club: { id: 'c1', slug: 'demo', name: 'Club Démo' }, loading: false };
    api.getMyClubs.mockResolvedValue([{ clubId: 'c1', slug: 'demo', name: 'Club Démo', role: 'OWNER' }]);
    wrap();
    openMenu();
    await screen.findByText('Mes clubs'); // menu chargé
    expect(screen.queryByText('Espace club')).not.toBeInTheDocument();
  });

  it("lien « Espace club » pour les AUTRES clubs gérés, pas le club courant", async () => {
    document.cookie = 'token=abc; path=/';
    clubCtx = { slug: 'demo', club: { id: 'c1', slug: 'demo', name: 'Club Démo' }, loading: false };
    api.getMyClubs.mockResolvedValue([
      { clubId: 'c1', slug: 'demo', name: 'Club Démo', role: 'OWNER' },
      { clubId: 'c2', slug: 'autre', name: 'Autre Club', role: 'ADMIN' },
      { clubId: 'c3', slug: 'troisieme', name: 'Troisième Club', role: 'STAFF' },
    ]);
    wrap();
    openMenu();
    expect(await screen.findByText('Espace club — Autre Club')).toBeInTheDocument();
    expect(screen.getByText('Espace club — Troisième Club')).toBeInTheDocument();
    expect(screen.queryByText('Espace club — Club Démo')).not.toBeInTheDocument();
    expect(screen.queryByText('Espace club')).not.toBeInTheDocument(); // pas de version courte (2 autres clubs)
  });

  it("lien « Espace club » visible aussi sur l'hôte plateforme dès qu'on gère un club", async () => {
    document.cookie = 'token=abc; path=/';
    clubCtx = { slug: null, club: null, loading: false }; // hôte plateforme
    api.getMyClubs.mockResolvedValue([{ clubId: 'c1', slug: 'demo', name: 'Club Démo', role: 'ADMIN' }]);
    wrap();
    openMenu();
    expect(await screen.findByText('Espace club')).toBeInTheDocument();
  });

  it("pas de lien « Espace club » si on ne gère aucun club", async () => {
    document.cookie = 'token=abc; path=/';
    clubCtx = { slug: 'demo', club: { id: 'c1', slug: 'demo', name: 'Club Démo' }, loading: false };
    api.getMyClubs.mockResolvedValue([]); // membre simple, pas gérant
    wrap();
    openMenu();
    await screen.findByText('Mes clubs'); // menu chargé
    expect(screen.queryByText('Espace club')).not.toBeInTheDocument();
  });

  it('Échap et clic extérieur ferment le menu', async () => {
    document.cookie = 'token=abc; path=/';
    wrap();
    openMenu();
    await screen.findByText('Se déconnecter');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Se déconnecter')).not.toBeInTheDocument();
    openMenu();
    await screen.findByText('Se déconnecter');
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText('Se déconnecter')).not.toBeInTheDocument();
  });

  it('le lien « Mon profil » navigue vers /me/profile', async () => {
    document.cookie = 'token=abc; path=/';
    wrap();
    openMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Mon profil' }));
    expect(push).toHaveBeenCalledWith('/me/profile');
  });

  it('signale un profil incomplet sur le lien « Mon profil »', async () => {
    document.cookie = 'token=abc; path=/';
    api.getMyProfile.mockResolvedValue({ ...profile, phone: null });
    wrap();
    openMenu();
    expect(await screen.findByRole('menuitem', { name: 'Mon profil · incomplet' })).toBeInTheDocument();
  });

  it("affiche la photo d'avatar quand avatarUrl est défini, les initiales sinon", async () => {
    document.cookie = 'token=abc; path=/';
    api.getMyProfile.mockResolvedValue({ ...profile, avatarUrl: '/uploads/avatars/u1-1.png' });
    const { container } = wrap();
    openMenu();
    await screen.findByText('Marc Bidaut');
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toContain('/uploads/avatars/u1-1.png');
    expect(screen.queryByText('MB')).not.toBeInTheDocument();
  });

  it("pas d'entrée Installer quand l'installation est impossible", async () => {
    document.cookie = 'token=abc; path=/';
    wrap();
    openMenu();
    await screen.findByText('Marc Bidaut');
    expect(screen.queryByText("Installer l'application")).not.toBeInTheDocument();
  });

  it('état native : le clic déclenche le prompt du navigateur', async () => {
    document.cookie = 'token=abc; path=/';
    installCtx.state = 'native';
    wrap();
    openMenu();
    fireEvent.click(await screen.findByText("Installer l'application"));
    expect(installCtx.promptInstall).toHaveBeenCalledTimes(1);
  });

  it("état ios-manual : le clic ouvre le tutoriel « Sur l'écran d'accueil »", async () => {
    document.cookie = 'token=abc; path=/';
    installCtx.state = 'ios-manual';
    wrap();
    openMenu();
    fireEvent.click(await screen.findByText("Installer l'application"));
    expect(installCtx.promptInstall).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: "Installer l'application" })).toBeInTheDocument();
    expect(screen.getByText(/Sur l'écran d'accueil/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Compris'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('état android-manual : le clic ouvre le tutoriel « menu de Chrome »', async () => {
    document.cookie = 'token=abc; path=/';
    installCtx.state = 'android-manual';
    wrap();
    openMenu();
    fireEvent.click(await screen.findByText("Installer l'application"));
    expect(installCtx.promptInstall).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: "Installer l'application" })).toBeInTheDocument();
    expect(screen.getByText(/menu de Chrome/)).toBeInTheDocument();
    expect(screen.queryByText(/Sur l'écran d'accueil/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Compris'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
