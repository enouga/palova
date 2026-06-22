import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ClubReserve } from '../components/ClubReserve';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('next/navigation', () => ({
  usePathname: () => '/reserver',
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));
jest.mock('../components/BookingModal', () => ({ __esModule: true, default: () => null }));
jest.mock('../lib/api', () => ({
  assetUrl: (p: string | null) => p,
  api: {
    getMyMemberships: jest.fn().mockResolvedValue([]),
    getMyClubPackages: jest.fn().mockResolvedValue([]),
    getMyQuotaStatus: jest.fn().mockResolvedValue(null),
    getMyProfile: jest.fn().mockResolvedValue({ firstName: 'T', lastName: 'U', email: 't@p.fr', avatarUrl: null }),
    getClubAvailability: jest.fn(),
  },
}));
import { api } from '../lib/api';
const mocked = api as jest.Mocked<typeof api>;

// Deux sports aux durées distinctes : Padel [90], Squash [45, 60].
const club = {
  id: 'c1', slug: 'demo', name: 'Club Démo', timezone: 'Europe/Paris', description: null,
  memberBookingDays: 7, publicBookingDays: 7,
  clubSports: [
    { id: 'cs1', durationsMin: [90], sport: { key: 'padel', defaultDurationsMin: [90], name: 'Padel', icon: null }, resources: [] },
    { id: 'cs2', durationsMin: [45, 60], sport: { key: 'squash', defaultDurationsMin: [45, 60], name: 'Squash', icon: null }, resources: [] },
  ],
} as never;

// Club Padel [90] + Tennis [60, 90] pour les tests de sport préféré.
const clubPadelTennis = {
  id: 'c2', slug: 'demo2', name: 'Club Multi', timezone: 'Europe/Paris', description: null,
  memberBookingDays: 7, publicBookingDays: 7,
  clubSports: [
    { id: 'cs-padel', durationsMin: [90], sport: { key: 'padel', defaultDurationsMin: [90], name: 'Padel', icon: null }, resources: [] },
    { id: 'cs-tennis', durationsMin: [60, 90], sport: { key: 'tennis', defaultDurationsMin: [60, 90], name: 'Tennis', icon: null }, resources: [] },
  ],
} as never;

describe('ClubReserve — durée par sport', () => {
  beforeEach(() => {
    document.cookie = 'token=abc; path=/';
    mocked.getClubAvailability.mockResolvedValue([] as never);
    window.history.pushState({}, '', '/reserver');
  });
  afterEach(() => { document.cookie = 'token=; max-age=0; path=/'; jest.clearAllMocks(); });

  it('charge chaque sport avec son propre clubSportId et sa durée par défaut', async () => {
    render(<ThemeProvider><ClubReserve club={club} /></ThemeProvider>);

    await waitFor(() => expect(mocked.getClubAvailability).toHaveBeenCalledTimes(2));
    const calls = mocked.getClubAvailability.mock.calls.map((c) => [c[2], c[3]]); // [durée, clubSportId]
    expect(calls).toContainEqual([90, 'cs1']); // Padel : seule durée 90
    expect(calls).toContainEqual([45, 'cs2']); // Squash : défaut = 1re durée (45)
  });

  it('affiche les onglets sport et bascule la section au clic', async () => {
    render(<ThemeProvider><ClubReserve club={club} /></ThemeProvider>);
    expect(await screen.findByRole('button', { name: 'Padel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Squash' })).toBeInTheDocument();
    // Par défaut Padel (durée unique) → aucune pastille de durée propre à Squash.
    expect(screen.queryByText('45 min')).not.toBeInTheDocument();
    // Bascule sur Squash → ses durées (45/60) apparaissent.
    fireEvent.click(screen.getByRole('button', { name: 'Squash' }));
    expect(await screen.findByText('45 min')).toBeInTheDocument();
    expect(screen.getByText('1 h')).toBeInTheDocument();
  });
});

describe('ClubReserve — sport préféré par défaut', () => {
  beforeEach(() => {
    document.cookie = 'token=abc; path=/';
    mocked.getClubAvailability.mockResolvedValue([] as never);
    window.history.pushState({}, '', '/reserver');
  });
  afterEach(() => { document.cookie = 'token=; max-age=0; path=/'; jest.clearAllMocks(); });

  it('sélectionne le sport préféré par défaut quand il est proposé par le club', async () => {
    // getMyProfile retourne preferredSport.key='tennis'
    mocked.getMyProfile.mockResolvedValue({
      firstName: 'T', lastName: 'U', email: 't@p.fr', avatarUrl: null,
      preferredSport: { id: 'sp-tennis', key: 'tennis', name: 'Tennis' },
    } as never);

    render(<ThemeProvider><ClubReserve club={clubPadelTennis} /></ThemeProvider>);

    // Tennis a deux durées [60, 90] → si Tennis est sélectionné, ses pastilles de durée apparaissent.
    // Padel n'a qu'une durée [90] → ses pastilles n'apparaissent pas (section Padel masquée).
    await waitFor(() => expect(screen.queryByText('1 h')).toBeInTheDocument());
    // '1 h' correspond à 60 min (Tennis) — mais Padel a 90 min = '1 h 30'.
    // Vérifier que les deux durées Tennis sont présentes : '1 h' et '1 h 30'.
    expect(screen.getByText('1 h')).toBeInTheDocument();
    expect(screen.getByText('1 h 30')).toBeInTheDocument();
  });

  it("garde clubSports[0] par défaut quand le sport préféré n'est pas proposé par le club", async () => {
    // getMyProfile retourne preferredSport.key='squash' mais le club n'a que padel+tennis
    mocked.getMyProfile.mockResolvedValue({
      firstName: 'T', lastName: 'U', email: 't@p.fr', avatarUrl: null,
      preferredSport: { id: 'sp-squash', key: 'squash', name: 'Squash' },
    } as never);

    render(<ThemeProvider><ClubReserve club={clubPadelTennis} /></ThemeProvider>);

    // Padel est clubSports[0] et n'a qu'une durée [90] → aucun sélecteur de durée visible.
    // Tennis a deux durées → si Tennis était actif, on verrait '1 h'.
    // On attend que l'effet sport-préféré ait eu le temps de s'exécuter.
    await waitFor(() => expect(mocked.getMyProfile).toHaveBeenCalled());
    // Laisser le temps à l'effet async de se résoudre.
    await new Promise((r) => setTimeout(r, 50));
    // Tennis n'est pas le sport par défaut → ses pastilles de durée ne sont pas affichées.
    expect(screen.queryByText('1 h')).not.toBeInTheDocument();
  });
});
