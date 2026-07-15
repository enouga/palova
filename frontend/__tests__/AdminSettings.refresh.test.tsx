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
  api: {
    adminGetClub: jest.fn(),
    adminUpdateClub: jest.fn().mockResolvedValue({}),
    uploadClubLogo: jest.fn(),
    uploadClubCover: jest.fn(),
  },
}));
import { api } from '../lib/api';
const mocked = api as jest.Mocked<typeof api>;

const MIN_CLUB = {
  id: 'c1', slug: 'demo', name: 'Démo', description: '', address: 'a', city: '', country: '',
  timezone: 'Europe/Paris', logoUrl: '', coverImageUrl: null, accentColor: '#5e93da', defaultThemeMode: 'daylight',
  status: 'ACTIVE', listedInDirectory: true, publicBookingDays: 7, memberBookingDays: 7,
  bookingReleaseMode: 'DAY_AT_HOUR', publicReleaseHour: 8, memberReleaseHour: 8,
  offPeakHours: null, bookingQuotas: null, playerChangeCutoffHours: 2, cancellationCutoffHours: 2,
  showOtherClubsReservations: false, refundOnCancelWithinCutoff: false, levelSystemEnabled: true,
  stripeAccountId: null, stripeAccountStatus: 'ACTIVE', requireOnlinePayment: true, requireCardFingerprint: true,
  quickPaymentMethods: ['CARD'], payAtClubOnly: false, legalEntityName: '', legalForm: '', siret: '', vatNumber: '',
  legalRepresentative: '', legalEmail: '', legalPhone: '',
};

describe('AdminSettingsPage', () => {
  beforeEach(() => {
    refreshMock.mockReset();
    (mocked.adminGetClub as jest.Mock).mockResolvedValue(MIN_CLUB);
  });

  // Régression : sans ce refresh, le club partagé (ClubProvider) restait périmé après
  // l'activation du paiement en ligne → la modale de réservation montrait « Régler au club ».
  it('refreshes the shared club context after saving so the booking flow sees new settings', async () => {
    render(<AdminSettingsPage />);
    const nameInput = await screen.findByDisplayValue('Démo');
    fireEvent.change(nameInput, { target: { value: 'Démo 2' } });
    fireEvent.click(await screen.findByText('Enregistrer'));

    await waitFor(() => expect(mocked.adminUpdateClub).toHaveBeenCalled());
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });
});
