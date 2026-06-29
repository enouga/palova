import { render, screen, fireEvent } from '@testing-library/react';
import { ClubNav } from '../components/ClubNav';
import { ThemeProvider } from '../lib/ThemeProvider';

// EventSource n'existe pas en jsdom : stub minimal (requis par NotificationBell et ClubNav).
beforeAll(() => {
  (global as any).EventSource = class { onmessage: any = null; onerror: any = null; close() {} };
});

let pathname = '/tournois';
jest.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));
jest.mock('../lib/api', () => ({
  assetUrl: (p: string | null) => p,
  notificationsStreamUrl: () => 'http://x/stream',
  api: {
    getMyMemberships: jest.fn().mockResolvedValue([]),
    // consommés par ProfileMenu (rangée 1) à l'ouverture du menu
    getMyProfile: jest.fn().mockResolvedValue(null),
    getMyClubs: jest.fn().mockResolvedValue([]),
    getMyClubMembership: jest.fn().mockResolvedValue(null),
    getMyClubPackages: jest.fn().mockResolvedValue([]),
    // consommés par NotificationBell
    getUnreadCount: jest.fn().mockResolvedValue({ count: 0 }),
    // consommé par ClubNav (badge Parties)
    getOpenMatchUnread: jest.fn().mockResolvedValue({ count: 0 }),
    getNotifications: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
    markNotificationRead: jest.fn().mockResolvedValue({ ok: true }),
    markAllNotificationsRead: jest.fn().mockResolvedValue({ ok: true }),
  },
}));

const club = { id: 'c1', slug: 'demo', name: 'Club Démo', logoUrl: null } as never;
const clubWithLogo = { id: 'c1', slug: 'demo', name: 'Club Démo', logoUrl: '/uploads/logos/demo.png' } as never;
const wrap = () => render(<ThemeProvider><ClubNav club={club} /></ThemeProvider>);

function clearCookies() {
  document.cookie = 'token=; max-age=0; path=/';
  document.cookie = 'clubId=; max-age=0; path=/';
}

describe('ClubNav', () => {
  beforeEach(() => { clearCookies(); pathname = '/tournois'; });
  afterEach(clearCookies);

  it('Club-house est le premier onglet, pointe sur la racine, et Réserver sur /reserver', () => {
    wrap();
    const labels = Array.from(document.querySelectorAll('.cn-tab .cn-tab-label')).map((el) => el.textContent);
    expect(labels[0]).toBe('Club-house');
    expect(screen.getByText('Club-house').closest('a')).toHaveAttribute('href', '/');
    expect(screen.getByText('Réserver').closest('a')).toHaveAttribute('href', '/reserver');
  });

  it("surligne Club-house (pas Réserver) sur la racine du club", () => {
    pathname = '/';
    wrap();
    expect(screen.getByText('Club-house').closest('a')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Réserver').closest('a')).not.toHaveAttribute('aria-current');
  });

  it('le libellé Club-house utilise la police brand', () => {
    wrap();
    const label = screen.getByText('Club-house') as HTMLElement;
    expect(label.style.fontFamily).toContain('--font-brand');
  });

  it('affiche les onglets Réserver, Events et Club-house', () => {
    wrap();
    expect(screen.getByText('Réserver')).toBeInTheDocument();
    expect(screen.getByText('Events')).toBeInTheDocument();
    expect(screen.getByText('Events').closest('a')).toHaveAttribute('href', '/events');
    expect(screen.getByText('Club-house')).toBeInTheDocument();
    expect(screen.queryByText('Tournois')).not.toBeInTheDocument();
    expect(screen.queryByText('Infos')).not.toBeInTheDocument();
  });

  it('la marque Palova vise le domaine racine (pas le sous-domaine du club)', () => {
    wrap();
    const link = screen.getByLabelText('Accueil Palova');
    expect(link).toHaveAttribute('href');
    expect(link.getAttribute('href')).not.toContain('demo.');
  });

  it('affiche le nom du club en titre non cliquable', () => {
    wrap();
    expect(screen.getByText('Club Démo')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Club Démo' })).not.toBeInTheDocument();
  });

  it("surligne l'onglet actif selon le chemin courant (Events reste actif sur /tournois)", () => {
    wrap();
    expect(screen.getByText('Events').closest('a')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Réserver').closest('a')).not.toHaveAttribute('aria-current');
  });

  it('surligne Events sur /events', () => {
    pathname = '/events';
    wrap();
    expect(screen.getByText('Events').closest('a')).toHaveAttribute('aria-current', 'page');
  });

  it('expose les accroches CSS du mode mobile (libellé .cn-tab-label, onglet .cn-tab/.is-active)', () => {
    wrap();
    // chemin courant = /tournois → onglet Events actif
    const label = screen.getByText('Events');
    expect(label).toHaveClass('cn-tab-label');
    const active = label.closest('a')!;
    expect(active).toHaveClass('cn-tab');
    expect(active).toHaveClass('is-active');

    const reserver = screen.getByText('Réserver').closest('a')!;
    expect(reserver).toHaveClass('cn-tab');
    expect(reserver).not.toHaveClass('is-active');
    // onglet nommé même quand l'icône est seule (mobile)
    expect(reserver).toHaveAttribute('aria-label', 'Réserver');
  });

  it("affiche le logo du club quand logoUrl est renseigné, lien vers l'accueil club, à la place de la marque Palova", () => {
    render(<ThemeProvider><ClubNav club={clubWithLogo} /></ThemeProvider>);
    const img = screen.getByRole('img', { name: 'Logo Club Démo' });
    expect(img).toHaveAttribute('src', '/uploads/logos/demo.png');
    expect(img.closest('a')).toHaveAttribute('href', '/');
    expect(screen.queryByLabelText('Accueil Palova')).not.toBeInTheDocument();
  });

  it("retombe sur la marque Palova quand le club n'a pas de logo", () => {
    wrap();
    expect(screen.getByLabelText('Accueil Palova')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Logo/ })).not.toBeInTheDocument();
  });

  it("bascule sur la marque Palova si le logo du club échoue à charger (onError)", () => {
    render(<ThemeProvider><ClubNav club={clubWithLogo} /></ThemeProvider>);
    fireEvent.error(screen.getByRole('img', { name: 'Logo Club Démo' }));
    expect(screen.getByLabelText('Accueil Palova')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Logo Club Démo' })).not.toBeInTheDocument();
  });

  it('montre « Connexion » et masque « Mes réservations » sans session', () => {
    wrap();
    expect(screen.getByText('Connexion')).toBeInTheDocument();
    expect(screen.queryByText('Mes réservations')).not.toBeInTheDocument();
  });

  it('montre « Mes réservations » et masque « Connexion » avec une session', async () => {
    document.cookie = 'token=abc; path=/';
    wrap();
    expect(await screen.findByText('Mes réservations')).toBeInTheDocument();
    expect(screen.queryByText('Connexion')).not.toBeInTheDocument();
  });

  it("affiche un badge de non lus sur l'onglet Parties quand count > 0", async () => {
    const { api: mockApi } = require('../lib/api');
    mockApi.getOpenMatchUnread.mockResolvedValueOnce({ count: 2 });
    document.cookie = 'token=abc; path=/';
    const clubPadel = { id: 'c1', slug: 'demo', name: 'Club Démo', logoUrl: null, clubSports: [{ sport: { key: 'padel' } }] } as never;
    render(<ThemeProvider><ClubNav club={clubPadel} /></ThemeProvider>);
    expect(await screen.findByLabelText('2 non lus')).toBeInTheDocument();
  });

  it('montre « Parties » sans session si le club a du padel (parties ouvertes publiques)', async () => {
    const padelClub = { id: 'c1', slug: 'demo', name: 'Club Démo', logoUrl: null, clubSports: [{ sport: { key: 'padel' } }] } as never;
    render(<ThemeProvider><ClubNav club={padelClub} /></ThemeProvider>);
    expect(await screen.findByText('Parties')).toBeInTheDocument();
  });

  it('expose un libellé court (.cn-lbl-short) pour les onglets longs — affiché à la place du long sur mobile actif', async () => {
    document.cookie = 'token=abc; path=/';
    pathname = '/me/reservations';
    wrap();
    const full = await screen.findByText('Mes réservations');
    expect(full).toHaveClass('cn-tab-label', 'cn-lbl-full');
    const short = screen.getByText('Résas');
    expect(short).toHaveClass('cn-tab-label', 'cn-lbl-short');
    // même onglet, actif, toujours nommé par son libellé complet
    const link = full.closest('a')!;
    expect(short.closest('a')).toBe(link);
    expect(link).toHaveClass('is-active');
    expect(link).toHaveAttribute('aria-label', 'Mes réservations');
    // le span court est le dernier enfant (cible CSS mobile .cn-tab-label:last-child)
    expect(link.lastElementChild).toBe(short);
    // les onglets sans version courte n'en rendent pas
    expect(screen.getByText('Réserver').closest('a')!.querySelector('.cn-lbl-short')).toBeNull();
  });
});
