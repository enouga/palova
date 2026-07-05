import { render, screen, waitFor } from '@testing-library/react';
import { ClubHouse } from '../components/ClubHouse';
import { ThemeProvider } from '../lib/ThemeProvider';

let mockAuth: { token: string | null; clubId: string | null; ready: boolean } = { token: null, clubId: null, ready: true };
jest.mock('../lib/useAuth', () => ({ useAuth: () => mockAuth }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));

// Stub des sections pour tester l'ORDRE sans leur logique interne :
jest.mock('../components/clubhouse/PosterMosaic', () => ({ PosterMosaic: () => <div data-testid="sec-posters" /> }));
jest.mock('../components/clubhouse/OpenMatchesShowcase', () => ({ OpenMatchesShowcase: () => <div data-testid="sec-matches" /> }));
jest.mock('../components/clubhouse/OffersShowcase', () => ({ OffersShowcase: () => <div data-testid="sec-offers" /> }));
jest.mock('../components/clubhouse/TopOfMonth', () => ({ TopOfMonth: () => <div data-testid="sec-top" /> }));
jest.mock('../components/clubhouse/ClubPresentationCard', () => ({ ClubPresentationCard: () => <div data-testid="sec-club" /> }));
jest.mock('../components/clubhouse/SponsorMarquee', () => ({ SponsorMarquee: () => <div data-testid="sec-sponsors" /> }));

jest.mock('../lib/api', () => ({
  assetUrl: (p: string | null) => p,
  api: {
    getClubAnnouncements: jest.fn().mockResolvedValue([]),
    getClubSponsors: jest.fn().mockResolvedValue([]),
    getClubTournaments: jest.fn().mockResolvedValue([]),
    getClubEvents: jest.fn().mockResolvedValue([]),
    getClubAvailability: jest.fn().mockResolvedValue([]),
    getMyReservations: jest.fn().mockResolvedValue([]),
    getOpenMatches: jest.fn().mockResolvedValue([]),
    getClubPresentation: jest.fn().mockResolvedValue(null),
    getClubOffers: jest.fn().mockResolvedValue(null),
    getClubTopMonth: jest.fn().mockResolvedValue([]),
    getMyClubSubscriptions: jest.fn().mockResolvedValue([]),
    cancelReservation: jest.fn(),
  },
}));
import { api } from '../lib/api';
const mocked = api as jest.Mocked<typeof api>;

const club = {
  id: 'c1', slug: 'demo', name: 'Club Démo', timezone: 'Europe/Paris',
  accentColor: '#d6ff3f', logoUrl: null, coverImageUrl: null,
  clubSports: [{ id: 'cs1', durationsMin: [90], sport: { defaultDurationsMin: [90] }, resources: [] }],
} as never;
const wrap = () => render(<ThemeProvider><ClubHouse club={club} /></ThemeProvider>);

const pinned = { id: 'a1', title: 'Tournoi interne', body: 'Lots !', linkUrl: null, imageUrl: null, isPublished: true, pinned: true, createdAt: '2026-06-09', updatedAt: '' };
const regular = { id: 'a2', title: 'Créneaux du matin', body: 'Dès 8h.', linkUrl: null, imageUrl: null, isPublished: true, pinned: false, createdAt: '2026-06-08', updatedAt: '' };

/** Fixtures des sections v2 : tout est présent pour tester l'ordre. */
const fullSections = () => {
  mocked.getClubPresentation.mockResolvedValue({
    presentationText: 'Bienvenue', coverImageUrl: null, address: '1 rue', city: null,
    latitude: null, longitude: null, contactPhone: null, contactEmail: null, openingHoursText: null, photos: [],
  } as never);
  mocked.getOpenMatches.mockResolvedValue([{
    id: 'm1', resourceName: 'T1', startTime: new Date(Date.now() + 3600e3).toISOString(), endTime: new Date(Date.now() + 2 * 3600e3).toISOString(),
    maxPlayers: 4, spotsLeft: 2, full: false, viewerIsParticipant: false, viewerIsOrganizer: false, players: [], lastMessageAt: null, unreadCount: 0,
  }] as never);
  mocked.getClubOffers.mockResolvedValue({
    plans: [{ id: 'pl1', name: 'Or', monthlyPrice: '39', commitmentMonths: 12, offPeakOnly: true, benefit: 'INCLUDED', discountPercent: null, dailyCap: null, weeklyCap: null, sportKeys: ['padel'] }],
    packages: [], onlinePurchase: false,
  } as never);
  mocked.getClubTopMonth.mockResolvedValue([
    { userId: 'u1', firstName: 'A', lastName: 'B', avatarUrl: null, wins: 5 },
    { userId: 'u2', firstName: 'C', lastName: 'D', avatarUrl: null, wins: 3 },
    { userId: 'u3', firstName: 'E', lastName: 'F', avatarUrl: null, wins: 1 },
  ] as never);
  mocked.getClubSponsors.mockResolvedValue([{ id: 's1', name: 'Head', logoUrl: '/l.png', linkUrl: null, offerText: null, offerCode: null, offerUntil: null, pinned: false, sortOrder: 0, isActive: true, createdAt: '' }] as never);
};

describe('ClubHouse', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth = { token: null, clubId: null, ready: true };
    mocked.getClubAnnouncements.mockResolvedValue([]);
    mocked.getClubSponsors.mockResolvedValue([]);
    mocked.getClubTournaments.mockResolvedValue([]);
    mocked.getClubEvents.mockResolvedValue([]);
    mocked.getClubAvailability.mockResolvedValue([]);
    mocked.getMyReservations.mockResolvedValue([]);
    mocked.getOpenMatches.mockResolvedValue([]);
    mocked.getClubPresentation.mockResolvedValue(null as never);
    mocked.getClubOffers.mockResolvedValue(null as never);
    mocked.getClubTopMonth.mockResolvedValue([]);
    mocked.getMyClubSubscriptions.mockResolvedValue([]);
  });

  it('annonce épinglée → son titre dans le hero, sans doublon dans la liste', async () => {
    mocked.getClubAnnouncements.mockResolvedValue([pinned, regular] as never);
    wrap();
    expect(await screen.findByText('Tournoi interne')).toBeInTheDocument();
    expect(screen.getByTestId('clubhouse-hero')).toHaveTextContent('Tournoi interne');
    expect(screen.getAllByText('Tournoi interne')).toHaveLength(1);
    expect(screen.getByText('Créneaux du matin')).toBeInTheDocument();
  });

  it('pas d annonce épinglée → hero avec accroche générique, annonces en liste', async () => {
    mocked.getClubAnnouncements.mockResolvedValue([regular] as never);
    wrap();
    expect(await screen.findByText('Créneaux du matin')).toBeInTheDocument();
    expect(screen.getByTestId('clubhouse-hero')).toHaveTextContent('Réservez, jouez, retrouvez-vous.');
  });

  it('annonce expirée → masquée partout ; annonce à image → bento, pas la liste', async () => {
    const expired = { ...regular, id: 'a3', title: 'Expirée', validUntil: '2020-01-01T23:59:59.999Z' };
    const withImage = { ...regular, id: 'a4', title: 'Affiche', imageUrl: '/uploads/announcements/x.jpg' };
    mocked.getClubAnnouncements.mockResolvedValue([regular, expired, withImage] as never);
    wrap();
    expect(await screen.findByText('Créneaux du matin')).toBeInTheDocument();
    expect(screen.queryByText('Expirée')).not.toBeInTheDocument();
    expect(screen.queryByText('Affiche')).not.toBeInTheDocument(); // vit dans la bento (stub)
    expect(screen.getByTestId('sec-posters')).toBeInTheDocument();
  });

  it('créneau libre à venir → chip « Prochain créneau » dans le pouls du hero (plus de bloc dédié)', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const future = new Date(Date.now() + 2 * 3600e3).toISOString();
    mocked.getClubAvailability.mockImplementation(async (_slug: string, date: string) =>
      (date === today
        ? [{ resource: { id: 'court-1', name: 'Terrain 1' }, slots: [{ startTime: future, endTime: future, available: true, price: '25', offPeak: false }] }]
        : []) as never);
    wrap();
    expect(await screen.findByText(/^Prochain créneau/)).toBeInTheDocument();
    // Le bloc « Prochains créneaux libres » a été retiré de la page (2026-07-05).
    expect(screen.queryByText(/Prochains créneaux libres/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Réserver' })).not.toBeInTheDocument();
  });

  it('aucune dispo → pas de chip « Prochain créneau »', async () => {
    mocked.getClubAnnouncements.mockResolvedValue([regular] as never);
    wrap();
    await screen.findByText('Créneaux du matin');
    expect(screen.queryByText(/Prochain créneau/)).not.toBeInTheDocument();
  });

  it('tournoi publié à venir → bloc « Prochains events »', async () => {
    mocked.getClubTournaments.mockResolvedValue([{
      id: 't1', name: 'P100 Messieurs', category: 'P100', gender: 'MEN', startTime: new Date(Date.now() + 7 * 86400e3).toISOString(),
      status: 'PUBLISHED', maxTeams: 16, confirmedCount: 14, waitlistCount: 0,
    }] as never);
    wrap();
    expect(await screen.findByText('P100 Messieurs')).toBeInTheDocument();
    expect(screen.getByText('Prochains events')).toBeInTheDocument();
    expect(screen.getByText('Plus que 2 places')).toBeInTheDocument();
  });

  it('animation publiée à venir → fusionnée dans « Prochains events »', async () => {
    mocked.getClubEvents.mockResolvedValue([{
      id: 'e1', name: 'Mêlée du vendredi', kind: 'MELEE', startTime: new Date(Date.now() + 2 * 86400e3).toISOString(),
      status: 'PUBLISHED', capacity: 12, confirmedCount: 4, waitlistCount: 0,
    }] as never);
    wrap();
    expect(await screen.findByText('Mêlée du vendredi')).toBeInTheDocument();
    expect(screen.getByText('Mêlée du vendredi').closest('a')).toHaveAttribute('href', '/events/e1');
  });

  it('visiteur : parties en tête, puis Le club ; offres avant top, partenaires en dernier', async () => {
    fullSections();
    wrap();
    await waitFor(() => expect(screen.getByTestId('sec-club')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('sec-top')).toBeInTheDocument());
    const ids = screen.getAllByTestId(/^sec-/).map((el) => el.getAttribute('data-testid'));
    expect(ids.indexOf('sec-matches')).toBe(0);
    expect(ids.indexOf('sec-matches')).toBeLessThan(ids.indexOf('sec-club'));
    expect(ids.indexOf('sec-offers')).toBeLessThan(ids.indexOf('sec-top'));
    expect(ids.indexOf('sec-sponsors')).toBe(ids.length - 1);
  });

  it('membre : parties en tête, Le club sous le top, top avant offres', async () => {
    mockAuth = { token: 't', clubId: null, ready: true };
    fullSections();
    wrap();
    await waitFor(() => expect(screen.getByTestId('sec-club')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('sec-top')).toBeInTheDocument());
    const ids = screen.getAllByTestId(/^sec-/).map((el) => el.getAttribute('data-testid'));
    expect(ids.indexOf('sec-matches')).toBeLessThan(ids.indexOf('sec-club'));
    expect(ids.indexOf('sec-top')).toBeLessThan(ids.indexOf('sec-offers'));
  });

  it('anonyme : les parties ouvertes se chargent sans token', async () => {
    fullSections();
    wrap();
    await waitFor(() => expect(mocked.getOpenMatches).toHaveBeenCalledWith('demo', undefined));
  });
});
