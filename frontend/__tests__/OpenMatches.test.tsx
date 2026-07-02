import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OpenMatches } from '../components/openmatch/OpenMatches';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('next/navigation', () => ({
  usePathname: () => '/parties',
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));
jest.mock('../lib/api', () => ({
  assetUrl: (p: string | null) => p,
  notificationsStreamUrl: () => 'http://x/stream',
  chatStreamUrl: () => 'http://x/stream',
  api: {
    getMyMemberships: jest.fn().mockResolvedValue([]),
    // Chargé au montage par ProfileMenu (info-bulle d'identité dans le header) ; menu jamais ouvert ici.
    getMyProfile:     jest.fn().mockResolvedValue({ id: 'u1', firstName: 'Test', lastName: 'User', email: 'test@palova.fr', avatarUrl: null }),
    getMyClubs:       jest.fn().mockResolvedValue([]),
    getMyRating:      jest.fn().mockResolvedValue(null),
    getOpenMatches:   jest.fn(),
    joinOpenMatch:    jest.fn().mockResolvedValue({ id: 'm1' }),
    leaveOpenMatch:   jest.fn().mockResolvedValue({ id: 'm1' }),
    removeOpenMatchPlayer: jest.fn().mockResolvedValue({ id: 'm1' }),
    searchClubMembers: jest.fn().mockResolvedValue([]),
    addOpenMatchPlayer: jest.fn().mockResolvedValue({ id: 'm1' }),
    setOpenMatchTeams: jest.fn().mockResolvedValue({ id: 'm1' }),
    recordMatchResult: jest.fn().mockResolvedValue({ id: 'mr1', status: 'PENDING' }),
    setInterested:    jest.fn().mockResolvedValue({}),
    removeInterested: jest.fn().mockResolvedValue({}),
    getChatMessages:  jest.fn().mockResolvedValue([]),
    postChatMessage:  jest.fn(),
    deleteChatMessage: jest.fn(),
    markOpenMatchChatRead: jest.fn().mockResolvedValue({ count: 0 }),
    getOpenMatchUnread: jest.fn().mockResolvedValue({ count: 0 }),
    // Chargé par OpenMatches pour la preuve sociale (anneau ami).
    listFollowing: jest.fn().mockResolvedValue([]),
    // Chargé par FriendsQuickRow (monté via AddPlayerSheet dans le flux d'ajout de joueur).
    listClubFriends: jest.fn().mockResolvedValue([]),
    // consommés par ClubNav (badge « à venir » = réservations + tournois + events + cours)
    getMyReservations: jest.fn().mockResolvedValue([]),
    getMyTournaments: jest.fn().mockResolvedValue([]),
    getMyEvents: jest.fn().mockResolvedValue([]),
    getMyLessons: jest.fn().mockResolvedValue([]),
    // consommés par NotificationBell (intégré dans ClubNav)
    getUnreadCount: jest.fn().mockResolvedValue({ count: 0 }),
    getNotifications: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
    markNotificationRead: jest.fn().mockResolvedValue({ ok: true }),
    markAllNotificationsRead: jest.fn().mockResolvedValue({ ok: true }),
  },
}));
// EventSource n'existe pas en jsdom : stub minimal (requis par NotificationBell et OpenMatchChatSheet).
beforeAll(() => {
  (global as any).EventSource = class { onmessage: ((e: any) => void) | null = null; onerror: ((e: any) => void) | null = null; close() {} };
});
import { api } from '../lib/api';
const mocked = api as jest.Mocked<typeof api>;

const club = { id: 'c1', slug: 'demo', name: 'Club Démo', timezone: 'Europe/Paris' } as never;
const future = new Date(Date.now() + 48 * 3600e3).toISOString();

const match = (over: Record<string, unknown> = {}) => ({
  id: 'm1', resourceName: 'Terrain 1', startTime: future, endTime: future,
  maxPlayers: 4, spotsLeft: 2, full: false, viewerIsParticipant: false, viewerIsOrganizer: false,
  players: [{ userId: 'u-org', firstName: 'Org', lastName: 'A', avatarUrl: null, isOrganizer: true }],
  interestedCount: 0, viewerIsInterested: false, interested: [], lastMessageAt: null, unreadCount: 0,
  ...over,
});

describe('OpenMatches', () => {
  beforeEach(() => { document.cookie = 'token=abc; path=/'; jest.clearAllMocks(); });
  afterEach(() => { document.cookie = 'token=; max-age=0; path=/'; });

  it('liste les parties et permet de rejoindre', async () => {
    mocked.getOpenMatches.mockResolvedValue([match()] as never);
    render(<ThemeProvider><OpenMatches club={club} /></ThemeProvider>);

    expect(await screen.findByText('Terrain 1')).toBeInTheDocument();
    expect(screen.getByText('2 places')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Rejoindre/ }));
    await waitFor(() => expect(mocked.joinOpenMatch).toHaveBeenCalledWith('demo', 'm1', 'abc'));
  });

  it('lit le niveau PADEL (pas le sport préféré)', async () => {
    mocked.getOpenMatches.mockResolvedValue([] as never);
    render(<ThemeProvider><OpenMatches club={club} /></ThemeProvider>);
    await waitFor(() => expect(mocked.getMyRating).toHaveBeenCalledWith('abc', 'padel'));
  });

  it('affiche « Quitter » pour un participant non-organisateur', async () => {
    mocked.getOpenMatches.mockResolvedValue([match({ viewerIsParticipant: true })] as never);
    render(<ThemeProvider><OpenMatches club={club} /></ThemeProvider>);

    fireEvent.click(await screen.findByRole('button', { name: /Quitter/ }));
    await waitFor(() => expect(mocked.leaveOpenMatch).toHaveBeenCalledWith('demo', 'm1', 'abc'));
  });

  it('masque les actions et affiche « Vous organisez » pour l organisateur', async () => {
    mocked.getOpenMatches.mockResolvedValue([match({ viewerIsParticipant: true, viewerIsOrganizer: true })] as never);
    render(<ThemeProvider><OpenMatches club={club} /></ThemeProvider>);

    expect(await screen.findByText('Vous organisez')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Rejoindre|Quitter/ })).not.toBeInTheDocument();
  });

  it('désactive « Rejoindre » quand la partie est complète', async () => {
    mocked.getOpenMatches.mockResolvedValue([match({ full: true, spotsLeft: 0 })] as never);
    render(<ThemeProvider><OpenMatches club={club} /></ThemeProvider>);

    expect(await screen.findByText('Complet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Rejoindre/ })).toBeDisabled();
  });

  it('permet à l organisateur de retirer un joueur non-organisateur', async () => {
    const players = [
      { userId: 'u-org', firstName: 'Org', lastName: 'A', avatarUrl: null, isOrganizer: true },
      { userId: 'u-emma', firstName: 'Emma', lastName: 'Bernard', avatarUrl: null, isOrganizer: false },
    ];
    mocked.getOpenMatches.mockResolvedValue([match({ viewerIsOrganizer: true, players, spotsLeft: 1 })] as never);
    render(<ThemeProvider><OpenMatches club={club} /></ThemeProvider>);

    expect(await screen.findByText('Emma Bernard')).toBeInTheDocument();
    // Tap sur le joueur → feuille d'actions → « Retirer de la partie ».
    fireEvent.click(await screen.findByRole('button', { name: 'Modifier Emma Bernard' }));
    fireEvent.click(screen.getByRole('button', { name: /Retirer de la partie/ }));
    await waitFor(() => expect(mocked.removeOpenMatchPlayer).toHaveBeenCalledWith('demo', 'm1', 'u-emma', 'abc'));
  });

  it('masque le bouton « Retirer » quand le viewer n est pas l organisateur', async () => {
    const players = [
      { userId: 'u-org', firstName: 'Org', lastName: 'A', avatarUrl: null, isOrganizer: true },
      { userId: 'u-emma', firstName: 'Emma', lastName: 'Bernard', avatarUrl: null, isOrganizer: false },
    ];
    mocked.getOpenMatches.mockResolvedValue([match({ viewerIsOrganizer: false, players, spotsLeft: 1 })] as never);
    render(<ThemeProvider><OpenMatches club={club} /></ThemeProvider>);

    expect(await screen.findByText('Emma Bernard')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Modifier Emma Bernard' })).not.toBeInTheDocument();
  });

  it('permet à l organisateur d ajouter un joueur sur une place libre', async () => {
    mocked.getOpenMatches.mockResolvedValue([match({ viewerIsParticipant: true, viewerIsOrganizer: true, spotsLeft: 2 })] as never);
    (mocked.searchClubMembers as jest.Mock).mockResolvedValue([{ id: 'u-new', firstName: 'New', lastName: 'Player' }]);
    render(<ThemeProvider><OpenMatches club={club} /></ThemeProvider>);

    // Un « + » par place libre : le premier vise l'équipe 1 → feuille d'ajout.
    const addBtns = await screen.findAllByRole('button', { name: /Ajouter un joueur à l'équipe/ });
    fireEvent.click(addBtns[0]);
    fireEvent.click(await screen.findByRole('button', { name: /New Player/ }));
    await waitFor(() => expect(mocked.addOpenMatchPlayer).toHaveBeenCalledWith('demo', 'm1', 'u-new', 'abc'));
    // La place tapée est épinglée : org en G (slot 0), le nouveau sur la place D visée (slot 1).
    await waitFor(() => expect(mocked.setOpenMatchTeams).toHaveBeenCalledWith(
      'demo', 'm1', { 'u-org': 1, 'u-new': 1 }, 'abc', { 'u-org': 0, 'u-new': 1 }));
  });

  it('ajoute un ami via la rangée « Mes amis »', async () => {
    mocked.getOpenMatches.mockResolvedValue([match({ viewerIsParticipant: true, viewerIsOrganizer: true, spotsLeft: 2 })] as never);
    (mocked.listClubFriends as jest.Mock).mockResolvedValue([{ id: 'u-ami', firstName: 'Ami', lastName: 'X', avatarUrl: null, level: null, mutual: true }]);
    render(<ThemeProvider><OpenMatches club={club} /></ThemeProvider>);
    const addBtns = await screen.findAllByRole('button', { name: /Ajouter un joueur à l'équipe/ });
    fireEvent.click(addBtns[0]);
    fireEvent.click(await screen.findByRole('button', { name: /Ami/ }));
    await waitFor(() => expect(mocked.addOpenMatchPlayer).toHaveBeenCalledWith('demo', 'm1', 'u-ami', 'abc'));
  });

  it('ne montre pas « Ajouter un joueur » à un non-organisateur', async () => {
    mocked.getOpenMatches.mockResolvedValue([match({ viewerIsParticipant: true, viewerIsOrganizer: false, spotsLeft: 2 })] as never);
    render(<ThemeProvider><OpenMatches club={club} /></ThemeProvider>);
    expect(await screen.findByText('Terrain 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ajouter un joueur/ })).not.toBeInTheDocument();
  });

  it('met les parties à mon niveau dans « Pour toi » et les retire des « Autres »', async () => {
    const at = (h: number) => new Date(Date.now() + h * 3600e3).toISOString();
    // myLevel = 5 ; une partie ciblée niveau 5 (recommandée) + une hors fourchette (niveau 1-2)
    mocked.getMyRating.mockResolvedValue({ level: 5, tier: 'Confirmé', isProvisional: false, matchesPlayed: 10, calibrated: true } as never);
    mocked.getOpenMatches.mockResolvedValue([
      match({ id: 'reco', resourceName: 'Court A', startTime: at(2), endTime: at(3), players: [], targetLevelMin: 5, targetLevelMax: 5 }),
      match({ id: 'other', resourceName: 'Court B', startTime: at(4), endTime: at(5), players: [], targetLevelMin: 1, targetLevelMax: 2 }),
    ] as never);
    render(<ThemeProvider><OpenMatches club={club} /></ThemeProvider>);

    // « Pour toi » présent et contient Court A ; la section « Autres parties » ne re-liste pas 'reco'.
    await screen.findByText('Pour toi');
    expect(screen.getByText('Court A')).toBeInTheDocument();
    // Court A n'apparaît qu'une fois (dé-dup) :
    expect(screen.getAllByText('Court A')).toHaveLength(1);
    // Court B (hors fourchette) reste dans « Autres parties ».
    expect(screen.getByText('Autres parties')).toBeInTheDocument();
    expect(screen.getByText('Court B')).toBeInTheDocument();
  });

  it('club OFF : pas d onglet « Classement » ni reco « Pour toi »', async () => {
    const at = (h: number) => new Date(Date.now() + h * 3600e3).toISOString();
    mocked.getMyRating.mockResolvedValue({ level: 5, tier: 'Confirmé', isProvisional: false, matchesPlayed: 10, calibrated: true } as never);
    mocked.getOpenMatches.mockResolvedValue([
      match({ id: 'reco', resourceName: 'Court A', startTime: at(2), endTime: at(3), players: [], targetLevelMin: 5, targetLevelMax: 5 }),
    ] as never);
    const clubOff = { id: 'c1', slug: 'demo', name: 'Club Démo', timezone: 'Europe/Paris', levelSystemEnabled: false } as never;
    render(<ThemeProvider><OpenMatches club={clubOff} /></ThemeProvider>);

    expect(await screen.findByText('Court A')).toBeInTheDocument();
    expect(screen.queryByText('Classement')).not.toBeInTheDocument();
    expect(screen.queryByText(/Pour toi/i)).not.toBeInTheDocument();
  });

  it('cliquer « Ça m intéresse » appelle setInterested puis recharge', async () => {
    mocked.getOpenMatches.mockResolvedValue([match()] as never);
    render(<ThemeProvider><OpenMatches club={club} /></ThemeProvider>);

    fireEvent.click(await screen.findByRole('button', { name: /Ça m'intéresse/ }));
    await waitFor(() => expect(mocked.setInterested).toHaveBeenCalledWith('demo', 'm1', 'abc'));
    await waitFor(() => expect(mocked.getOpenMatches).toHaveBeenCalledTimes(2));
  });

  it('cliquer « Discuter » sur une partie où viewerIsInterested ouvre la feuille de chat', async () => {
    mocked.getOpenMatches.mockResolvedValue([match({ viewerIsInterested: true })] as never);
    render(<ThemeProvider><OpenMatches club={club} /></ThemeProvider>);

    fireEvent.click(await screen.findByRole('button', { name: /Discuter/ }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('cliquer « Discuter » appelle markOpenMatchChatRead', async () => {
    mocked.getOpenMatches.mockResolvedValue([match({ viewerIsInterested: true })] as never);
    render(<ThemeProvider><OpenMatches club={club} /></ThemeProvider>);

    fireEvent.click(await screen.findByRole('button', { name: /Discuter/ }));
    await waitFor(() => expect(mocked.markOpenMatchChatRead).toHaveBeenCalledWith('demo', 'm1', 'abc'));
  });

  it('anonyme : affiche la liste, charge sans token, et « Rejoindre » ouvre le prompt d\'auth', async () => {
    document.cookie = 'token=; max-age=0; path=/'; // pas de session
    mocked.getOpenMatches.mockResolvedValue([match()] as never);
    render(<ThemeProvider><OpenMatches club={club} /></ThemeProvider>);

    expect(await screen.findByText('Terrain 1')).toBeInTheDocument();
    await waitFor(() => expect(mocked.getOpenMatches).toHaveBeenCalledWith('demo', undefined));

    fireEvent.click(screen.getByRole('button', { name: /Rejoindre/ }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(mocked.joinOpenMatch).not.toHaveBeenCalled();
  });
});
