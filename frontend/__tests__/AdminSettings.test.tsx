import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import AdminSettingsPage from '../app/admin/settings/page';
import { AdminRoleContext } from '../lib/adminRole';

const refreshMock = jest.fn();
jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));
jest.mock('../lib/ClubProvider', () => ({
  useClub: () => ({ slug: 'demo', club: { id: 'c1' }, loading: false, refresh: refreshMock }),
}));
jest.mock('../lib/ThemeProvider', () => ({ useTheme: () => ({ th: new Proxy({}, { get: () => '' }) }) }));
jest.mock('../lib/api', () => ({
  assetUrl: (p: string | null) => p,
  api: {
    adminGetClub: jest.fn(), adminUpdateClub: jest.fn().mockResolvedValue({}),
    uploadClubLogo: jest.fn(), uploadClubCover: jest.fn(),
    adminGetSports: jest.fn().mockResolvedValue([]), getSports: jest.fn().mockResolvedValue([]),
    adminAddSport: jest.fn(), adminUpdateClubSport: jest.fn().mockResolvedValue({}),
  },
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

const PADEL_SPORT = { id: 'padel', key: 'padel', name: 'Padel', resourceNoun: 'Terrain', defaultDurationsMin: [90], surfaces: [], hasLighting: false };
const TENNIS_SPORT = { id: 'tennis', key: 'tennis', name: 'Tennis', resourceNoun: 'Court', defaultDurationsMin: [60], surfaces: [], hasLighting: false };
const ENABLED_SPORTS = [{ id: 'cs1', slotStepMin: null, durationsMin: [90], sport: PADEL_SPORT }];

const wrap = (role: 'OWNER' | 'ADMIN' | 'STAFF' | null = 'ADMIN') =>
  render(<AdminRoleContext.Provider value={role}><AdminSettingsPage /></AdminRoleContext.Provider>);

/** Ouvre l'onglet Sports d'une page montée avec un padel activé + tennis au catalogue. */
const openSportsTab = async () => {
  (mocked.adminGetSports as jest.Mock).mockResolvedValue(ENABLED_SPORTS);
  (mocked.getSports as jest.Mock).mockResolvedValue([PADEL_SPORT, TENNIS_SPORT]);
  wrap();
  await screen.findByText('Profil');
  fireEvent.click(screen.getByRole('button', { name: 'Sports' }));
  await screen.findByText('Proposés par le club');
};

describe('AdminSettingsPage (onglets + SaveBar)', () => {
  beforeEach(() => {
    refreshMock.mockReset();
    (mocked.adminGetClub as jest.Mock).mockClear().mockResolvedValue({ ...CLUB });
    (mocked.adminUpdateClub as jest.Mock).mockClear().mockResolvedValue({});
    (mocked.adminGetSports as jest.Mock).mockClear().mockResolvedValue([]);
    (mocked.getSports as jest.Mock).mockClear().mockResolvedValue([]);
    (mocked.adminAddSport as jest.Mock).mockClear().mockResolvedValue({ id: 'cs2', durationsMin: [], sport: TENNIS_SPORT });
    (mocked.adminUpdateClubSport as jest.Mock).mockClear().mockResolvedValue({});
    window.history.replaceState(null, '', '/admin/settings');
  });

  it('shows the Identité tab first and no save bar when pristine', async () => {
    wrap();
    expect(await screen.findByText('Profil')).toBeInTheDocument();
    expect(screen.queryByText('Modifications non enregistrées')).not.toBeInTheDocument();
  });

  it('viewer STAFF : page réservée aux administrateurs, aucun fetch club', async () => {
    wrap('STAFF');
    expect(screen.getByText(/réservée aux administrateurs/i)).toBeInTheDocument();
    expect(api.adminGetClub).not.toHaveBeenCalled();
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
    // La barre passe du « non enregistrées » au flash « Enregistré ✓ ».
    expect(await screen.findByText(/Enregistré/)).toBeInTheDocument();
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

  it('renders the Sports tab content when selected', async () => {
    wrap();
    await screen.findByText('Profil');
    fireEvent.click(screen.getByRole('button', { name: 'Sports' }));
    expect(await screen.findByText('Proposés par le club')).toBeInTheDocument();
    expect(window.location.search).toContain('tab=sports');
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

  describe('onglet Sports (brouillon + SaveBar, comme les autres onglets)', () => {
    it('toggling a duration reveals the save bar instead of saving immediately', async () => {
      await openSportsTab();
      fireEvent.click(screen.getByRole('button', { name: '1 h' }));
      expect(await screen.findByText('Modifications non enregistrées')).toBeInTheDocument();
      expect(mocked.adminUpdateClubSport).not.toHaveBeenCalled();
    });

    it('saves a toggled duration on Enregistrer, without touching the club PATCH', async () => {
      await openSportsTab();
      fireEvent.click(screen.getByRole('button', { name: '1 h' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer' }));
      await waitFor(() => expect(mocked.adminUpdateClubSport).toHaveBeenCalledWith('c1', 'cs1', [60, 90], 'tok'));
      expect(mocked.adminUpdateClub).not.toHaveBeenCalled();
      expect(await screen.findByText(/Enregistré/)).toBeInTheDocument();
    });

    it('adding a sport stages it, then creates it on Enregistrer', async () => {
      await openSportsTab();
      fireEvent.click(screen.getByRole('button', { name: /Tennis/ }));
      // Mis en attente : rien n'est créé tant qu'on n'a pas enregistré.
      expect(await screen.findByText('À enregistrer')).toBeInTheDocument();
      expect(mocked.adminAddSport).not.toHaveBeenCalled();

      fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer' }));
      await waitFor(() => expect(mocked.adminAddSport).toHaveBeenCalledWith('c1', 'tennis', 'tok'));
      // Durées inchangées (= défauts du sport) → pas de PATCH superflu qui figerait le choix.
      expect(mocked.adminUpdateClubSport).not.toHaveBeenCalled();
    });

    it('saves the chosen durations of a sport added in the same draft', async () => {
      await openSportsTab();
      fireEvent.click(screen.getByRole('button', { name: /Tennis/ }));
      // Le tennis est semé à [60] ; on ajoute 2 h avant d'avoir enregistré.
      const tennisRow = (await screen.findByText('À enregistrer')).parentElement!;
      fireEvent.click(within(tennisRow).getByRole('button', { name: '2 h' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer' }));
      await waitFor(() => expect(mocked.adminAddSport).toHaveBeenCalledWith('c1', 'tennis', 'tok'));
      // L'id ne naît qu'au POST → le PATCH des durées suit la création.
      await waitFor(() => expect(mocked.adminUpdateClubSport).toHaveBeenCalledWith('c1', 'cs2', [60, 120], 'tok'));
    });

    it('Cancel reverts a sports edit', async () => {
      await openSportsTab();
      fireEvent.click(screen.getByRole('button', { name: /Tennis/ }));
      fireEvent.click(await screen.findByRole('button', { name: 'Annuler' }));
      expect(screen.queryByText('À enregistrer')).not.toBeInTheDocument();
      expect(screen.queryByText('Modifications non enregistrées')).not.toBeInTheDocument();
    });

    it('surfaces a save failure in the bar and resyncs the baseline', async () => {
      await openSportsTab();
      (mocked.adminUpdateClubSport as jest.Mock).mockRejectedValueOnce(new Error('Boum'));
      fireEvent.click(screen.getByRole('button', { name: '1 h' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer' }));
      expect(await screen.findByText('Boum')).toBeInTheDocument();
      // Resync : la baseline est relue pour ne pas rejouer un flush partiel.
      await waitFor(() => expect(mocked.adminGetSports).toHaveBeenCalledTimes(2));
    });
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
