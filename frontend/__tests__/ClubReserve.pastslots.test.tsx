import { render, screen } from '@testing-library/react';
import { ClubReserve } from '../components/ClubReserve';
import { ThemeProvider } from '../lib/ThemeProvider';

// Créneaux relatifs à l'instant réel → déterministe quelle que soit l'heure d'exécution :
// l'un a déjà commencé (passé), l'autre est à venir.
const past   = new Date(Date.now() - 3 * 3600e3).toISOString();
const future = new Date(Date.now() + 3 * 3600e3).toISOString();
// Même formatage que ClubReserve (heure dans le fuseau du club).
const fmt = (iso: string) =>
  new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' })
    .format(new Date(iso)).replace(':', 'h');

jest.mock('next/navigation', () => ({
  usePathname: () => '/reserver',
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));
jest.mock('../components/BookingModal', () => ({
  __esModule: true,
  default: ({ resourceId }: { resourceId: string }) => <div data-testid="booking-modal">{resourceId}</div>,
}));
jest.mock('../lib/api', () => ({
  assetUrl: (p: string | null) => p,
  api: {
    getMyMemberships: jest.fn().mockResolvedValue([]),
    getMyClubPackages: jest.fn().mockResolvedValue([]),
    getMyProfile: jest.fn().mockResolvedValue({ firstName: 'Test', lastName: 'User', email: 'test@palova.fr', avatarUrl: null }),
    getClubAvailability: jest.fn(),
  },
}));
import { api } from '../lib/api';
const mocked = api as jest.Mocked<typeof api>;

const club = {
  id: 'c1', slug: 'demo', name: 'Club Démo', timezone: 'Europe/Paris', description: null,
  memberBookingDays: 7, publicBookingDays: 7,
  clubSports: [{ id: 'cs1', durationsMin: [90], sport: { defaultDurationsMin: [90], name: 'Padel', icon: null }, resources: [] }],
} as never;

const availability = [{
  resource: { id: 'court-1', name: 'Terrain 1', attributes: {}, price: '25', offPeakPrice: null, sport: { key: 'padel', name: 'Padel' }, clubSportId: 'cs1' },
  slots: [
    { startTime: past,   endTime: past,   available: true, price: '25', offPeak: false },
    { startTime: future, endTime: future, available: true, price: '25', offPeak: false },
  ],
}];

describe('ClubReserve — créneaux déjà commencés', () => {
  beforeEach(() => {
    document.cookie = 'token=abc; path=/';
    mocked.getClubAvailability.mockResolvedValue(availability as never);
  });
  afterEach(() => { document.cookie = 'token=; max-age=0; path=/'; });

  it('masque le créneau dont le début est déjà passé, garde le créneau à venir', async () => {
    render(<ThemeProvider><ClubReserve club={club} /></ThemeProvider>);
    // Le créneau à venir s'affiche…
    expect(await screen.findByText(fmt(future))).toBeInTheDocument();
    // …et le créneau déjà commencé est absent de la liste.
    expect(screen.queryByText(fmt(past))).not.toBeInTheDocument();
  });
});
