import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
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
    adminGetClub: jest.fn(), adminUpdateClub: jest.fn().mockResolvedValue({}),
    uploadClubLogo: jest.fn(), uploadClubCover: jest.fn(),
    adminGetSports: jest.fn().mockResolvedValue([]), getSports: jest.fn().mockResolvedValue([]),
    adminApplySportsBatch: jest.fn().mockResolvedValue([]),
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

const wrap = () => render(<AdminSettingsPage />);

describe('AdminSettingsPage (onglets + SaveBar)', () => {
  beforeEach(() => {
    refreshMock.mockReset();
    (mocked.adminGetClub as jest.Mock).mockResolvedValue({ ...CLUB });
    (mocked.adminUpdateClub as jest.Mock).mockClear().mockResolvedValue({});
    (mocked.adminApplySportsBatch as jest.Mock).mockClear().mockResolvedValue([]);
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

  it('Sports : ajouter un sport est différé (aucun appel réseau) jusqu\'à Enregistrer', async () => {
    (mocked.getSports as jest.Mock).mockResolvedValueOnce([
      { id: 'padel', name: 'Padel', icon: null, defaultDurationsMin: [90] },
      { id: 'tennis', name: 'Tennis', icon: '🎾', defaultDurationsMin: [60] },
    ]);
    (mocked.adminGetSports as jest.Mock).mockResolvedValueOnce([
      { id: 'cs1', slotStepMin: null, durationsMin: [90], sport: { id: 'padel', key: 'padel', name: 'Padel', resourceNoun: 'Court', defaultDurationsMin: [90], surfaces: [], hasLighting: false } },
    ]);
    // Le PUT batch renvoie la liste COMPLÈTE des ClubSport du club (pas seulement le diff soumis) —
    // il faut que la réponse mockée reflète bien Tennis pour que le brouillon redevienne "propre".
    (mocked.adminApplySportsBatch as jest.Mock).mockResolvedValueOnce([
      { id: 'cs1', slotStepMin: null, durationsMin: [90], sport: { id: 'padel', key: 'padel', name: 'Padel', resourceNoun: 'Court', defaultDurationsMin: [90], surfaces: [], hasLighting: false } },
      { id: 'cs2', slotStepMin: null, durationsMin: [], sport: { id: 'tennis', key: 'tennis', name: 'Tennis', resourceNoun: 'Court', defaultDurationsMin: [60], surfaces: [], hasLighting: false } },
    ]);

    wrap();
    await screen.findByText('Profil');
    fireEvent.click(screen.getByRole('button', { name: 'Sports' }));
    fireEvent.click(await screen.findByRole('button', { name: /Tennis/ }));

    expect(await screen.findByText('Modifications non enregistrées')).toBeInTheDocument();
    expect(mocked.adminApplySportsBatch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(mocked.adminApplySportsBatch)
      .toHaveBeenCalledWith('c1', [{ sportId: 'tennis', durationsMin: [] }], 'tok'));
    expect(await screen.findByText(/Enregistré/)).toBeInTheDocument();
  });

  it('Sports : Annuler défait un ajout de sport sans appel réseau', async () => {
    (mocked.getSports as jest.Mock).mockResolvedValueOnce([
      { id: 'padel', name: 'Padel', icon: null, defaultDurationsMin: [90] },
      { id: 'tennis', name: 'Tennis', icon: '🎾', defaultDurationsMin: [60] },
    ]);
    (mocked.adminGetSports as jest.Mock).mockResolvedValueOnce([]);

    wrap();
    await screen.findByText('Profil');
    fireEvent.click(screen.getByRole('button', { name: 'Sports' }));
    fireEvent.click(await screen.findByRole('button', { name: /Tennis/ }));
    expect(await screen.findByText('Modifications non enregistrées')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByText('Modifications non enregistrées')).not.toBeInTheDocument();
    expect(mocked.adminApplySportsBatch).not.toHaveBeenCalled();
    // Tennis redevient proposé à l'ajout (le brouillon est revenu à la baseline vide).
    expect(await screen.findByRole('button', { name: /Tennis/ })).toBeInTheDocument();
  });

  it('Enregistrer déclenche à la fois le PATCH Club et le batch Sports quand les deux onglets sont dirty', async () => {
    (mocked.getSports as jest.Mock).mockResolvedValueOnce([
      { id: 'padel', name: 'Padel', icon: null, defaultDurationsMin: [90] },
      { id: 'tennis', name: 'Tennis', icon: '🎾', defaultDurationsMin: [60] },
    ]);
    (mocked.adminGetSports as jest.Mock).mockResolvedValueOnce([]);
    // Réponse réaliste du PUT batch (liste complète, reflète Tennis) pour que le brouillon
    // Sports redevienne propre lui aussi — sinon la barre resterait dirty après un succès réel.
    (mocked.adminApplySportsBatch as jest.Mock).mockResolvedValueOnce([
      { id: 'cs-tennis', slotStepMin: null, durationsMin: [], sport: { id: 'tennis', key: 'tennis', name: 'Tennis', resourceNoun: 'Court', defaultDurationsMin: [60], surfaces: [], hasLighting: false } },
    ]);

    wrap();
    const nameInput = await screen.findByDisplayValue('Démo');
    fireEvent.change(nameInput, { target: { value: 'Nouveau nom' } });

    fireEvent.click(screen.getByRole('button', { name: 'Sports' }));
    fireEvent.click(await screen.findByRole('button', { name: /Tennis/ }));
    expect(await screen.findByText('Modifications non enregistrées')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(mocked.adminUpdateClub).toHaveBeenCalled());
    await waitFor(() => expect(mocked.adminApplySportsBatch)
      .toHaveBeenCalledWith('c1', [{ sportId: 'tennis', durationsMin: [] }], 'tok'));
    expect(await screen.findByText(/Enregistré/)).toBeInTheDocument();
  });

  it('un ajout de sport pendant un enregistrement Sports en vol n\'est pas silencieusement perdu (régression)', async () => {
    (mocked.getSports as jest.Mock).mockResolvedValueOnce([
      { id: 'padel', name: 'Padel', icon: null, defaultDurationsMin: [90] },
      { id: 'tennis', name: 'Tennis', icon: '🎾', defaultDurationsMin: [60] },
      { id: 'squash', name: 'Squash', icon: null, defaultDurationsMin: [45] },
    ]);
    (mocked.adminGetSports as jest.Mock).mockResolvedValueOnce([]);

    let resolveBatch: (v: unknown) => void = () => {};
    (mocked.adminApplySportsBatch as jest.Mock).mockReturnValueOnce(
      new Promise((resolve) => { resolveBatch = resolve; }),
    );

    wrap();
    await screen.findByText('Profil');
    fireEvent.click(screen.getByRole('button', { name: 'Sports' }));
    fireEvent.click(await screen.findByRole('button', { name: /Tennis/ }));
    expect(await screen.findByText('Modifications non enregistrées')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(mocked.adminApplySportsBatch).toHaveBeenCalledTimes(1));
    // Le batch en vol n'a soumis QUE Tennis (Squash n'existait pas encore dans le brouillon).
    expect((mocked.adminApplySportsBatch as jest.Mock).mock.calls[0][1]).toEqual([{ sportId: 'tennis', durationsMin: [] }]);

    // Pendant que la requête est en vol, l'utilisateur ajoute un second sport.
    fireEvent.click(await screen.findByRole('button', { name: /Squash/ }));

    // La requête se résout enfin, avec la ligne Tennis créée côté serveur (Squash n'y figure pas).
    await act(async () => {
      resolveBatch([
        { id: 'cs-tennis', slotStepMin: null, durationsMin: [], sport: { id: 'tennis', key: 'tennis', name: 'Tennis', resourceNoun: 'Court', defaultDurationsMin: [60], surfaces: [], hasLighting: false } },
      ]);
    });

    // Le Squash ajouté pendant le vol ne doit PAS être écrasé par la réponse du batch précédent :
    // la barre doit rester "non enregistrée" (pas de faux "Enregistré ✓") et Squash doit
    // toujours figurer dans le brouillon vivant (liste des sports proposés, plus dans "à ajouter").
    await waitFor(() => expect(screen.getByText('Modifications non enregistrées')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Squash/ })).not.toBeInTheDocument();
    expect(screen.getByText('Squash')).toBeInTheDocument();
  });

  it('échec partiel : le Club se sauvegarde et se rebaseline même si le batch Sports échoue', async () => {
    (mocked.getSports as jest.Mock).mockResolvedValueOnce([
      { id: 'padel', name: 'Padel', icon: null, defaultDurationsMin: [90] },
      { id: 'tennis', name: 'Tennis', icon: '🎾', defaultDurationsMin: [60] },
    ]);
    (mocked.adminGetSports as jest.Mock).mockResolvedValueOnce([]);
    (mocked.adminApplySportsBatch as jest.Mock).mockRejectedValueOnce(new Error('Le serveur a refusé le lot'));

    wrap();
    const nameInput = await screen.findByDisplayValue('Démo');
    fireEvent.change(nameInput, { target: { value: 'Nouveau nom' } });

    fireEvent.click(screen.getByRole('button', { name: 'Sports' }));
    fireEvent.click(await screen.findByRole('button', { name: /Tennis/ }));
    expect(await screen.findByText('Modifications non enregistrées')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(mocked.adminUpdateClub).toHaveBeenCalled());
    await waitFor(() => expect(mocked.adminApplySportsBatch).toHaveBeenCalled());

    // Le Club a réussi (baseline commitée → refreshClub appelé) ; le message d'erreur du
    // batch Sports remplace le flash de succès (pas de faux « Enregistré ✓ »).
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(await screen.findByText(/Le serveur a refusé le lot/)).toBeInTheDocument();
    expect(screen.queryByText(/^Enregistré/)).not.toBeInTheDocument();

    // Le brouillon Sports reste dirty (Tennis toujours en attente) pour permettre un nouvel essai.
    fireEvent.click(screen.getByRole('button', { name: 'Sports' }));
    expect(screen.getByText('Tennis')).toBeInTheDocument();
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
