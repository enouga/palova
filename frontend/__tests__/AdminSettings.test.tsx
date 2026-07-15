import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AdminSettingsPage from '../app/admin/settings/page';

const refreshMock = jest.fn();
jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));
jest.mock('../lib/ClubProvider', () => ({
  useClub: () => ({ slug: 'demo', club: { id: 'c1' }, loading: false, refresh: refreshMock }),
}));
jest.mock('../lib/ThemeProvider', () => ({ useTheme: () => ({ th: new Proxy({}, { get: () => '' }) }) }));
jest.mock('../lib/api', () => ({
  assetUrl: (p: string | null) => p,
  api: { adminGetClub: jest.fn(), adminUpdateClub: jest.fn().mockResolvedValue({}), uploadClubLogo: jest.fn(), uploadClubCover: jest.fn() },
}));
import { api } from '../lib/api';
const mocked = api as jest.Mocked<typeof api>;

const CLUB = {
  id: 'c1', slug: 'demo', name: 'Démo', description: '', address: 'a', city: '', country: '',
  timezone: 'Europe/Paris', logoUrl: '', coverImageUrl: null, accentColor: '#5e93da', defaultThemeMode: 'daylight',
  status: 'ACTIVE', listedInDirectory: true, listTournamentsNationally: false, showOffersPublicly: false,
  publicBookingDays: 14, memberBookingDays: 28, bookingReleaseMode: 'DAY_AT_HOUR', publicReleaseHour: 8, memberReleaseHour: 8,
  offPeakHours: null, bookingQuotas: null, playerChangeCutoffHours: 0, cancellationCutoffHours: 24,
  showOtherClubsReservations: false, refundOnCancelWithinCutoff: false, levelSystemEnabled: true,
  stripeAccountId: null, stripeAccountStatus: 'ACTIVE', requireOnlinePayment: true, requireCardFingerprint: true,
  quickPaymentMethods: ['CARD'], payAtClubOnly: false,
  legalEntityName: '', legalForm: '', siret: '', vatNumber: '', legalRepresentative: '', legalEmail: '', legalPhone: '',
};

const wrap = () => render(<AdminSettingsPage />);

describe('AdminSettingsPage (onglets + SaveBar)', () => {
  beforeEach(() => {
    refreshMock.mockReset();
    (mocked.adminGetClub as jest.Mock).mockResolvedValue({ ...CLUB });
    (mocked.adminUpdateClub as jest.Mock).mockClear().mockResolvedValue({});
    window.history.replaceState(null, '', '/admin/settings');
  });

  it('shows the Identité tab first and no save bar when pristine', async () => {
    wrap();
    expect(await screen.findByText('Profil')).toBeInTheDocument();
    expect(screen.queryByText('Modifications non enregistrées')).not.toBeInTheDocument();
  });

  it('switches tabs and reflects the active tab in the URL', async () => {
    wrap();
    await screen.findByText('Profil');
    fireEvent.click(screen.getByRole('button', { name: 'Réservation' }));
    expect(await screen.findByText(/Réservation à l/)).toBeInTheDocument();
    expect(window.location.search).toContain('tab=reservation');
  });

  it('reveals the save bar on edit and saves via the global PATCH then refreshes', async () => {
    wrap();
    const nameInput = await screen.findByDisplayValue('Démo');
    fireEvent.change(nameInput, { target: { value: 'Nouveau nom' } });
    expect(await screen.findByText('Modifications non enregistrées')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(mocked.adminUpdateClub).toHaveBeenCalled());
    const body = (mocked.adminUpdateClub as jest.Mock).mock.calls[0][1];
    expect(body.name).toBe('Nouveau nom');
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('Modifications non enregistrées')).not.toBeInTheDocument());
  });

  it('Cancel reverts the draft and hides the save bar', async () => {
    wrap();
    const nameInput = await screen.findByDisplayValue('Démo');
    fireEvent.change(nameInput, { target: { value: 'X' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Annuler' }));
    expect(screen.getByDisplayValue('Démo')).toBeInTheDocument();
    expect(screen.queryByText('Modifications non enregistrées')).not.toBeInTheDocument();
  });

  it('opens on the tab named in ?tab= at mount', async () => {
    window.history.replaceState(null, '', '/admin/settings?tab=visibilite');
    wrap();
    expect(await screen.findByText('Système de niveau de joueur')).toBeInTheDocument();
  });

  it('booking presets: the member "28 jours" chip is active for memberBookingDays=28', async () => {
    wrap();
    await screen.findByText('Profil');
    fireEvent.click(screen.getByRole('button', { name: 'Réservation' }));
    const chip = await screen.findByRole('button', { name: '28 jours' });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
  });

  it('persists showOtherClubsReservations (regression: old save() dropped it)', async () => {
    wrap();
    await screen.findByText('Profil');
    fireEvent.click(screen.getByRole('button', { name: 'Visibilité & joueurs' }));
    const toggle = await screen.findByText('Afficher aussi les réservations des autres clubs');
    fireEvent.click(toggle);
    fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(mocked.adminUpdateClub).toHaveBeenCalled());
    const body = (mocked.adminUpdateClub as jest.Mock).mock.calls[0][1];
    expect(body.showOtherClubsReservations).toBe(true);
  });
});
