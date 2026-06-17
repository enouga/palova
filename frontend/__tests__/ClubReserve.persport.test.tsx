import { render, screen, waitFor } from '@testing-library/react';
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
    { id: 'cs1', durationsMin: [90], sport: { defaultDurationsMin: [90], name: 'Padel', icon: null }, resources: [] },
    { id: 'cs2', durationsMin: [45, 60], sport: { defaultDurationsMin: [45, 60], name: 'Squash', icon: null }, resources: [] },
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

  it('affiche les deux sections de sport', async () => {
    render(<ThemeProvider><ClubReserve club={club} /></ThemeProvider>);
    expect(await screen.findByText('Padel')).toBeInTheDocument();
    expect(await screen.findByText('Squash')).toBeInTheDocument();
  });
});
