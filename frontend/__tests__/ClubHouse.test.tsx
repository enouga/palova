import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { ClubHouse } from '../components/ClubHouse';
import { ThemeProvider } from '../lib/ThemeProvider';

let mockAuth: { token: string | null; clubId: string | null; ready: boolean } = { token: null, clubId: null, ready: true };
jest.mock('../lib/useAuth', () => ({ useAuth: () => mockAuth }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));

// Stub des sections pour tester l'ORDRE sans leur logique interne :
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
const clubWith = (sections: unknown) =>
  ({ ...(club as unknown as Record<string, unknown>), clubHouseSections: sections }) as never;
const wrapWith = (c: never) => render(<ThemeProvider><ClubHouse club={c} /></ThemeProvider>);

const pinned = { id: 'a1', title: 'Tournoi interne', body: 'Lots !', linkUrl: null, imageUrl: null, kind: 'INFO', validUntil: null, isPublished: true, pinned: true, createdAt: '2026-06-09', updatedAt: '' };
const regular = { id: 'a2', title: 'Créneaux du matin', body: 'Dès 8h.', linkUrl: null, imageUrl: null, kind: 'INFO', validUntil: null, isPublished: true, pinned: false, createdAt: '2026-06-08', updatedAt: '' };

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
    mocked.getMyReservations.mockResolvedValue([]);
    mocked.getOpenMatches.mockResolvedValue([]);
    mocked.getClubPresentation.mockResolvedValue(null as never);
    mocked.getClubOffers.mockResolvedValue(null as never);
    mocked.getClubTopMonth.mockResolvedValue([]);
    mocked.getMyClubSubscriptions.mockResolvedValue([]);
  });

  it('annonces → kiosque « À la une » : la 1re (épinglée) affichée, navigation vers les autres', async () => {
    mocked.getClubAnnouncements.mockResolvedValue([pinned, regular] as never);
    wrap();
    expect(await screen.findByText('Tournoi interne')).toBeInTheDocument();
    expect(screen.getByTestId('clubhouse-kiosk')).toHaveTextContent('Tournoi interne');
    // La 2e annonce n'est pas rendue tant qu'on n'a pas navigué (une diapo à la fois).
    expect(screen.queryByText('Créneaux du matin')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Annonce 2 sur 2' }));
    expect(screen.getByText('Créneaux du matin')).toBeInTheDocument();
    expect(screen.queryByText('Tournoi interne')).not.toBeInTheDocument();
  });

  it('aucune annonce → kiosque avec l accroche générique', async () => {
    wrap();
    await waitFor(() => expect(mocked.getClubAnnouncements).toHaveBeenCalled());
    expect(screen.getByTestId('clubhouse-kiosk')).toHaveTextContent('Réservez, jouez, retrouvez-vous.');
  });

  it('annonce expirée → exclue du kiosque ; annonce à image = diapo, pas hors kiosque', async () => {
    const expired = { ...regular, id: 'a3', title: 'Expirée', validUntil: '2020-01-01T23:59:59.999Z' };
    const withImage = { ...regular, id: 'a4', title: 'Affiche', imageUrl: '/uploads/announcements/x.jpg' };
    mocked.getClubAnnouncements.mockResolvedValue([regular, expired, withImage] as never);
    wrap();
    expect(await screen.findByText('Créneaux du matin')).toBeInTheDocument();
    expect(screen.queryByText('Expirée')).not.toBeInTheDocument();
    // withImage est la 2e diapo (non rendue) — le kiosque a 2 segments (regular + withImage).
    expect(screen.getByRole('button', { name: 'Annonce 2 sur 2' })).toBeInTheDocument();
    expect(screen.queryByText('Affiche')).not.toBeInTheDocument();
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

  it('membre : carte « Vos réservations » (tuile-date, Tout voir), clic sur une ligne → dialog d annulation', async () => {
    mockAuth = { token: 't', clubId: null, ready: true };
    mocked.getMyReservations.mockResolvedValue([{
      id: 'r1', status: 'CONFIRMED',
      startTime: new Date(Date.now() + 24 * 3600e3).toISOString(),
      endTime: new Date(Date.now() + 25.5 * 3600e3).toISOString(),
      resource: { name: 'Padel int 1', club: { slug: 'demo', name: 'Club Démo', timezone: 'Europe/Paris' } },
    }] as never);
    wrap();
    expect(await screen.findByText('Vos réservations')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tout voir →' })).toHaveAttribute('href', '/me/reservations');
    fireEvent.click(screen.getByRole('button', { name: /Gérer la réservation Padel int 1/ }));
    expect(screen.getByText('Annuler la réservation ?')).toBeInTheDocument();
  });

  it('anonyme : les parties ouvertes se chargent sans token', async () => {
    fullSections();
    wrap();
    await waitFor(() => expect(mocked.getOpenMatches).toHaveBeenCalledWith('demo', undefined));
  });

  it('config custom : ordre appliqué, section masquée absente et fetch sauté', async () => {
    fullSections();
    wrapWith(clubWith([
      { key: 'top', visible: true },
      { key: 'clubCard', visible: true },
      { key: 'matches', visible: false },
      { key: 'agenda', visible: true },
      { key: 'offers', visible: true },
      { key: 'sponsors', visible: true },
    ]));
    await waitFor(() => expect(screen.getByTestId('sec-top')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('sec-club')).toBeInTheDocument());
    const ids = screen.getAllByTestId(/^sec-/).map((el) => el.getAttribute('data-testid'));
    expect(ids.indexOf('sec-top')).toBeLessThan(ids.indexOf('sec-club'));
    expect(screen.queryByTestId('sec-matches')).not.toBeInTheDocument();
    expect(mocked.getOpenMatches).not.toHaveBeenCalled();
  });

  it('sponsors masqués : rivière absente, fetch sponsors sauté ; clés manquantes complétées visibles', async () => {
    fullSections();
    wrapWith(clubWith([{ key: 'sponsors', visible: false }]));
    await waitFor(() => expect(screen.getByTestId('sec-top')).toBeInTheDocument());
    expect(screen.queryByTestId('sec-sponsors')).not.toBeInTheDocument();
    expect(mocked.getClubSponsors).not.toHaveBeenCalled();
  });

  it('aucune annonce ni section → kiosque accroche + « Pas d\'informations »', async () => {
    // act async : les fetchs mockés (tous vides) se résolvent AVANT l'assertion.
    await act(async () => { wrap(); });
    expect(screen.getByText(/Pas d'informations pour le moment/)).toBeInTheDocument();
    expect(screen.getByTestId('clubhouse-kiosk')).toHaveTextContent('Réservez, jouez, retrouvez-vous.');
  });
});
