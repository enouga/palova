import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
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
    // consommé par ClubNav (badge 💬 Messages du header)
    getDmUnread: jest.fn().mockResolvedValue({ count: 0 }),
    // consommé par ClubNav (pastille « parties ouvertes » de l'onglet Parties)
    getOpenMatches: jest.fn().mockResolvedValue([]),
    // consommés par ClubNav (badge « à venir » = réservations + tournois + events + cours)
    getMyReservations: jest.fn().mockResolvedValue([]),
    getMyTournaments: jest.fn().mockResolvedValue([]),
    getMyEvents: jest.fn().mockResolvedValue([]),
    getMyLessons: jest.fn().mockResolvedValue([]),
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
    // Le nom est rendu en deux variantes (rangée 1 pour le desktop + pied de barre pour le
    // mobile), montrées selon le breakpoint via CSS ; aucune n'est un lien.
    expect(screen.getAllByText('Club Démo').length).toBeGreaterThan(0);
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

  it('préfère le logotype horizontal (logoWideUrl) à l’icône dans le bandeau', () => {
    const clubWide = { id: 'c1', slug: 'demo', name: 'Club Démo', logoUrl: '/uploads/logos/i.png', logoWideUrl: '/uploads/logos/w.png' } as never;
    render(<ThemeProvider><ClubNav club={clubWide} /></ThemeProvider>);
    const img = screen.getByRole('img', { name: 'Logo Club Démo' }) as HTMLImageElement;
    expect(img.src).toContain('/uploads/logos/w.png');
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

  it("affiche un badge du nombre d'éléments à venir (réservations + tournois) sur l'onglet Mes réservations", async () => {
    const { api: mockApi } = require('../lib/api');
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const past = new Date(Date.now() - 86_400_000).toISOString();
    mockApi.getMyReservations.mockResolvedValueOnce([
      { id: 'r1', status: 'CONFIRMED', startTime: future, endTime: future, resource: { club: { slug: 'demo' } } },
      { id: 'r2', status: 'CONFIRMED', startTime: future, endTime: future, resource: { club: { slug: 'demo' } } },
      { id: 'r3', status: 'CANCELLED', startTime: future, endTime: future, resource: { club: { slug: 'demo' } } }, // annulée → exclue
      { id: 'r4', status: 'CONFIRMED', startTime: past, endTime: past, resource: { club: { slug: 'demo' } } },     // passée → exclue
      { id: 'r5', status: 'CONFIRMED', startTime: future, endTime: future, resource: { club: { slug: 'autre' } } }, // autre club → exclue
    ]);
    mockApi.getMyTournaments.mockResolvedValueOnce([
      { id: 'tr1', status: 'CONFIRMED', tournament: { status: 'PUBLISHED', startTime: future, endTime: future, club: { slug: 'demo' } } },  // à venir → compté
      { id: 'tr2', status: 'CONFIRMED', tournament: { status: 'PUBLISHED', startTime: past, endTime: past, club: { slug: 'demo' } } },      // passé → exclu
      { id: 'tr3', status: 'CANCELLED', tournament: { status: 'PUBLISHED', startTime: future, endTime: future, club: { slug: 'demo' } } },  // annulé → exclu
      { id: 'tr4', status: 'CONFIRMED', tournament: { status: 'PUBLISHED', startTime: future, endTime: future, club: { slug: 'autre' } } }, // autre club → exclu
    ]);
    document.cookie = 'token=abc; path=/';
    wrap();
    // 2 réservations + 1 tournoi à venir sur le club courant
    expect(await screen.findByLabelText('3 à venir')).toBeInTheDocument();
  });

  it("la pastille « à venir » (Résas) est en accent — même style que l'onglet À venir, pas le rouge notification", async () => {
    const { api: mockApi } = require('../lib/api');
    const future = new Date(Date.now() + 86_400_000).toISOString();
    mockApi.getMyReservations.mockResolvedValueOnce([
      { id: 'r1', status: 'CONFIRMED', startTime: future, endTime: future, resource: { club: { slug: 'demo' } } },
    ]);
    document.cookie = 'token=abc; path=/';
    wrap();
    const badge = await screen.findByLabelText('1 à venir');
    // Accent du thème (bleu Palova par défaut), pas le rouge danger des non-lus.
    expect(badge.style.background).not.toBe('rgb(178, 60, 23)');
    expect(badge.style.background).toBeTruthy();
  });

  it("affiche un badge de non lus sur l'onglet Parties quand count > 0 (rouge notification)", async () => {
    const { api: mockApi } = require('../lib/api');
    mockApi.getOpenMatchUnread.mockResolvedValueOnce({ count: 2 });
    document.cookie = 'token=abc; path=/';
    const clubPadel = { id: 'c1', slug: 'demo', name: 'Club Démo', logoUrl: null, clubSports: [{ sport: { key: 'padel' } }] } as never;
    render(<ThemeProvider><ClubNav club={clubPadel} /></ThemeProvider>);
    const badge = await screen.findByLabelText('2 non lus');
    expect(badge.style.background).toBe('rgb(178, 60, 23)');
  });

  it("affiche l'icône Messages du header avec badge rouge de non-lus quand connecté", async () => {
    const { api: mockApi } = require('../lib/api');
    mockApi.getDmUnread.mockResolvedValueOnce({ count: 4 });
    document.cookie = 'token=abc; path=/';
    wrap();
    const link = await screen.findByLabelText('Messages');
    expect(link).toHaveAttribute('href', '/me/messages');
    const badge = await screen.findByLabelText('4 messages non lus');
    expect(badge.style.background).toBe('rgb(178, 60, 23)');
  });

  it("masque l'icône Messages sans session", () => {
    wrap();
    expect(screen.queryByLabelText('Messages')).not.toBeInTheDocument();
  });

  it("l'event window palova:dm-unread redéclenche le compteur de messages", async () => {
    const { api: mockApi } = require('../lib/api');
    document.cookie = 'token=abc; path=/';
    wrap();
    await screen.findByLabelText('Messages');
    const callsBefore = mockApi.getDmUnread.mock.calls.length;
    act(() => { window.dispatchEvent(new Event('palova:dm-unread')); });
    await waitFor(() => expect(mockApi.getDmUnread.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it("affiche le nombre de parties ouvertes sur l'onglet Parties (pastille accent) quand aucun message non lu", async () => {
    const { api: mockApi } = require('../lib/api');
    mockApi.getOpenMatchUnread.mockResolvedValueOnce({ count: 0 });
    mockApi.getOpenMatches.mockResolvedValueOnce([{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }]);
    document.cookie = 'token=abc; path=/';
    const clubPadel = { id: 'c1', slug: 'demo', name: 'Club Démo', logoUrl: null, clubSports: [{ sport: { key: 'padel' } }] } as never;
    render(<ThemeProvider><ClubNav club={clubPadel} /></ThemeProvider>);
    const badge = await screen.findByLabelText('3 parties ouvertes');
    expect(badge.textContent).toBe('3');
    // Pastille accent (bleu Palova par défaut), pas le rouge th.danger des non-lus.
    expect(badge.style.background).not.toBe('rgb(178, 60, 23)');
  });

  it('le badge de non lus a priorité sur le compteur de parties ouvertes', async () => {
    const { api: mockApi } = require('../lib/api');
    mockApi.getOpenMatchUnread.mockResolvedValueOnce({ count: 1 });
    mockApi.getOpenMatches.mockResolvedValueOnce([{ id: 'm1' }, { id: 'm2' }]);
    document.cookie = 'token=abc; path=/';
    const clubPadel = { id: 'c1', slug: 'demo', name: 'Club Démo', logoUrl: null, clubSports: [{ sport: { key: 'padel' } }] } as never;
    render(<ThemeProvider><ClubNav club={clubPadel} /></ThemeProvider>);
    expect(await screen.findByLabelText('1 non lus')).toBeInTheDocument();
    expect(screen.queryByLabelText('2 parties ouvertes')).toBeNull();
  });

  it('montre « Parties » sans session si le club a du padel (parties ouvertes publiques)', async () => {
    const padelClub = { id: 'c1', slug: 'demo', name: 'Club Démo', logoUrl: null, clubSports: [{ sport: { key: 'padel' } }] } as never;
    render(<ThemeProvider><ClubNav club={padelClub} /></ThemeProvider>);
    expect(await screen.findByText('Parties')).toBeInTheDocument();
  });

  it("affiche l'icône « Espace club » (lien /admin, nouvel onglet) quand on gère ce club, quel que soit le rôle", async () => {
    const { api: mockApi } = require('../lib/api');
    mockApi.getMyClubs.mockResolvedValueOnce([{ clubId: 'c1', slug: 'demo', name: 'Club Démo', role: 'STAFF' }]);
    document.cookie = 'token=abc; path=/';
    wrap();
    const link = await screen.findByLabelText('Espace club');
    expect(link).toHaveAttribute('href', '/admin');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it("icône « Espace club » pointe vers l'AUTRE club géré (cross-sous-domaine, nouvel onglet) si on ne gère pas ce club-ci", async () => {
    const { api: mockApi } = require('../lib/api');
    mockApi.getMyClubs.mockResolvedValueOnce([{ clubId: 'autre-club', slug: 'x', name: 'X', role: 'OWNER' }]);
    document.cookie = 'token=abc; path=/';
    wrap();
    const link = await screen.findByLabelText('Espace club');
    expect(link).toHaveAttribute('href', expect.stringContaining('x.'));
    expect(link).toHaveAttribute('href', expect.stringContaining('/admin'));
    expect(link).toHaveAttribute('target', '_blank');
  });

  it("icône « Espace club » ouvre un popover listant chaque club quand on en gère plusieurs autres", async () => {
    const { api: mockApi } = require('../lib/api');
    mockApi.getMyClubs.mockResolvedValueOnce([
      { clubId: 'autre-1', slug: 'autre', name: 'Autre Club', role: 'ADMIN' },
      { clubId: 'autre-2', slug: 'troisieme', name: 'Troisième Club', role: 'STAFF' },
    ]);
    document.cookie = 'token=abc; path=/';
    wrap();
    const btn = await screen.findByLabelText('Espace club');
    expect(btn.tagName).toBe('BUTTON');
    fireEvent.click(btn);
    const first = await screen.findByText('Espace club — Autre Club');
    expect(first.closest('a')).toHaveAttribute('target', '_blank');
    expect(screen.getByText('Espace club — Troisième Club')).toBeInTheDocument();
  });

  it("masque l'icône « Espace club » si on ne gère aucun club", async () => {
    const { api: mockApi } = require('../lib/api');
    mockApi.getMyClubs.mockResolvedValueOnce([]);
    document.cookie = 'token=abc; path=/';
    wrap();
    await screen.findByText('Mes réservations'); // menu chargé
    expect(screen.queryByLabelText('Espace club')).not.toBeInTheDocument();
  });

  it("masque l'icône « Espace club » sans session", () => {
    wrap();
    expect(screen.queryByLabelText('Espace club')).not.toBeInTheDocument();
  });

  it("affiche l'icône Palova → /decouvrir même sans session (visiteur anonyme), hors sous-domaine club", () => {
    wrap();
    const link = screen.getByLabelText('Palova — découvrir clubs, parties et tournois');
    expect(link).toHaveAttribute('href', expect.stringContaining('/decouvrir'));
    expect(link.getAttribute('href')).not.toContain('demo.');
  });

  it("affiche l'icône Palova → /decouvrir aussi connecté", () => {
    document.cookie = 'token=abc; path=/';
    wrap();
    expect(screen.getByLabelText('Palova — découvrir clubs, parties et tournois')).toBeInTheDocument();
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

  it("la règle CSS mobile ≤400px qui rétrécit l'avatar exclut le badge de non-lus (position:absolute) pour ne pas l'écraser (régression collision de sélecteur)", () => {
    // jsdom n'applique pas les media queries au layout : ce test ne peut vérifier que la
    // PRÉSENCE littérale de l'exclusion dans le texte de la règle CSS, pas son effet visuel
    // réel (pastille 16x16 non écrasée à 34x34 sur un vrai navigateur ≤400px). Le badge de
    // NotificationBell a toujours position:absolute en première propriété de son style inline
    // (span overlay) ; l'avatar ProfileMenu (span d'initiales) ne l'a jamais — c'est la
    // distinction que le sélecteur `:not([style*="position: absolute"])` exploite.
    wrap();
    const style = document.querySelector('style');
    expect(style).not.toBeNull();
    expect(style!.textContent).toContain(
      '.cn-actions > div > button > span:not([style*="position: absolute"]), .cn-actions > div > button > img'
    );
  });
});
