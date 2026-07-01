import { render, screen, waitFor } from '@testing-library/react';
import { OpenMatchDetail } from '../components/openmatch/OpenMatchDetail';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('next/navigation', () => ({
  usePathname: () => '/parties/m1',
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

const club = { id: 'c1', slug: 'demo', name: 'Club Démo', timezone: 'Europe/Paris', clubSports: [{ sport: { key: 'padel' } }], levelSystemEnabled: true } as never;
jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ club, loading: false, slug: 'demo' }) }));

jest.mock('../lib/api', () => ({
  assetUrl: (p: string | null) => p,
  notificationsStreamUrl: () => 'http://x/stream',
  chatStreamUrl: () => 'http://x/stream',
  api: {
    getMyProfile: jest.fn().mockResolvedValue({ id: 'u1', firstName: 'T', lastName: 'U', email: 't@x.fr', avatarUrl: null }),
    getMyClubs: jest.fn().mockResolvedValue([]),
    getMyRating: jest.fn().mockResolvedValue(null),
    getMyMemberships: jest.fn().mockResolvedValue([]),
    listFollowing: jest.fn().mockResolvedValue([]),
    listClubFriends: jest.fn().mockResolvedValue([]),
    getMyReservations: jest.fn().mockResolvedValue([]),
    getMyTournaments: jest.fn().mockResolvedValue([]),
    getMyEvents: jest.fn().mockResolvedValue([]),
    getMyLessons: jest.fn().mockResolvedValue([]),
    getUnreadCount: jest.fn().mockResolvedValue({ count: 0 }),
    getNotifications: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
    markNotificationRead: jest.fn().mockResolvedValue({ ok: true }),
    markAllNotificationsRead: jest.fn().mockResolvedValue({ ok: true }),
    getOpenMatchUnread: jest.fn().mockResolvedValue({ count: 0 }),
    getOpenMatch: jest.fn(),
  },
}));
beforeAll(() => { (global as any).EventSource = class { onmessage: any = null; onerror: any = null; close() {} }; });
import { api } from '../lib/api';
const mocked = api as jest.Mocked<typeof api>;

const future = new Date(Date.now() + 48 * 3600e3).toISOString();
const match = {
  id: 'm1', resourceName: 'Terrain 1', startTime: future, endTime: future, sport: { key: 'padel', name: 'Padel' },
  maxPlayers: 4, spotsLeft: 2, full: false, viewerIsParticipant: false, viewerIsOrganizer: false,
  players: [{ userId: 'u-org', firstName: 'Org', lastName: 'A', avatarUrl: null, isOrganizer: true, team: 1 }],
  interestedCount: 0, viewerIsInterested: false, interested: [], lastMessageAt: null, unreadCount: 0,
};

describe('OpenMatchDetail', () => {
  beforeEach(() => { document.cookie = 'token=abc; path=/'; jest.clearAllMocks(); });
  afterEach(() => { document.cookie = 'token=; max-age=0; path=/'; });

  it('affiche la carte de la partie et la barre de partage', async () => {
    mocked.getOpenMatch.mockResolvedValue(match as never);
    render(<ThemeProvider><OpenMatchDetail matchId="m1" /></ThemeProvider>);
    expect(await screen.findByText('Terrain 1')).toBeInTheDocument();
    expect(screen.getByText('Ajouter au calendrier')).toBeInTheDocument();
  });

  it('affiche un état « n’existe plus » sur 404', async () => {
    mocked.getOpenMatch.mockRejectedValue(new Error('RESERVATION_NOT_FOUND'));
    render(<ThemeProvider><OpenMatchDetail matchId="nope" /></ThemeProvider>);
    expect(await screen.findByText(/n'existe plus/i)).toBeInTheDocument();
  });
});
