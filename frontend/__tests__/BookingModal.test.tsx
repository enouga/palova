import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { StrictMode } from 'react';
import BookingModal from '../components/BookingModal';
import { ThemeProvider } from '../lib/ThemeProvider';
import { api, TimeSlot } from '../lib/api';

let mockClub: { levelSystemEnabled?: boolean } | null = null;
jest.mock('../lib/ClubProvider', () => ({
  useClub: () => ({ slug: 'club-demo', club: mockClub, loading: false }),
}));

jest.mock('../lib/api', () => ({
  api: {
    holdSlot:           jest.fn(),
    confirmReservation: jest.fn(),
    cancelReservation:  jest.fn(),
    applyHoldSetup:     jest.fn().mockResolvedValue({ id: 'res-1', status: 'PENDING' }),
    searchClubMembers:  jest.fn(),
    listClubFriends:    jest.fn().mockResolvedValue([]),
    getMyRating:        jest.fn().mockResolvedValue(null),
    getMyProfile:       jest.fn().mockResolvedValue({ id: 'user-1', firstName: 'Alice', lastName: 'Org', avatarUrl: null }),
    getClubPage:        jest.fn().mockResolvedValue({}),
  },
  assetUrl: (u: string | null) => u,
}));

const mockSlot: TimeSlot = {
  startTime: '2025-06-15T06:00:00.000Z',
  endTime:   '2025-06-15T07:00:00.000Z',
  available: true, price: '25', offPeak: false,
};

function renderModal(overrides: Partial<React.ComponentProps<typeof BookingModal>> = {}) {
  return render(
    <ThemeProvider>
      <BookingModal slot={mockSlot} resourceId="court-1" price="25" duration={60}
        token="jwt-token" onClose={jest.fn()} onConfirmed={jest.fn()} {...overrides} />
    </ThemeProvider>
  );
}

describe('BookingModal — page unique', () => {
  beforeEach(() => {
    jest.clearAllMocks(); mockClub = null; localStorage.clear();
    (api.holdSlot as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'PENDING', totalPrice: '25' });
    (api.confirmReservation as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'CONFIRMED' });
    (api.cancelReservation as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'CANCELLED' });
    (api.applyHoldSetup as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'PENDING' });
    (api.getMyProfile as jest.Mock).mockResolvedValue({ id: 'user-1', firstName: 'Alice', lastName: 'Org', avatarUrl: null });
  });

  it('en dev (StrictMode, double montage) : atteint « held » avec un seul hold, sans auto-annulation', async () => {
    render(
      <StrictMode>
        <ThemeProvider>
          <BookingModal slot={mockSlot} resourceId="court-1" price="25" duration={60}
            token="jwt-token" onClose={jest.fn()} onConfirmed={jest.fn()} />
        </ThemeProvider>
      </StrictMode>
    );
    expect(await screen.findByText(/Créneau bloqué/)).toBeInTheDocument();
    expect(api.holdSlot).toHaveBeenCalledTimes(1);          // un seul hold malgré le double montage
    expect(api.cancelReservation).not.toHaveBeenCalled();    // pas d'auto-annulation
  });

  it('bloque le créneau dès l ouverture (sans interaction)', async () => {
    renderModal();
    await waitFor(() => expect(api.holdSlot).toHaveBeenCalledWith(
      { resourceId: 'court-1', startTime: mockSlot.startTime, endTime: mockSlot.endTime },
      'jwt-token',
    ));
    expect(await screen.findByText(/Créneau bloqué/)).toBeInTheDocument();
  });

  it('affiche un message d erreur si le hold échoue', async () => {
    (api.holdSlot as jest.Mock).mockRejectedValue(new Error('SLOT_ALREADY_HELD'));
    renderModal();
    expect(await screen.findByText(/vient d'être pris/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Fermer/ })).toBeInTheDocument();
  });

  it('confirme (régler au club) → confirmReservation + onConfirmed', async () => {
    const onConfirmed = jest.fn();
    renderModal({ onConfirmed });
    fireEvent.click(await screen.findByRole('button', { name: /Confirmer la réservation/ }));
    await waitFor(() => expect(api.confirmReservation).toHaveBeenCalledWith('res-1', 'jwt-token', undefined));
    await waitFor(() => expect(onConfirmed).toHaveBeenCalled());
  });

  it('fermer annule le hold', async () => {
    const onClose = jest.fn();
    renderModal({ onClose });
    await screen.findByText(/Créneau bloqué/);
    fireEvent.click(screen.getByRole('button', { name: /Abandonner|Fermer|Annuler/ }));
    await waitFor(() => expect(api.cancelReservation).toHaveBeenCalledWith('res-1', 'jwt-token'));
    expect(onClose).toHaveBeenCalled();
  });

  it('affiche le bloc conditions d annulation (sans case)', async () => {
    renderModal({ cancellationCutoffHours: 24, refundOnCancelWithinCutoff: false });
    expect(await screen.findByText(/Conditions d'annulation/)).toBeInTheDocument();
    expect(screen.getByText(/24\s*h avant le début/)).toBeInTheDocument();
  });

  it('partie ouverte : applyHoldSetup reçoit partnerUserIds + visibility', async () => {
    (api.searchClubMembers as jest.Mock).mockResolvedValue([{ id: 'user-2', firstName: 'Marc', lastName: 'Dupont' }]);
    renderModal({ slug: 'club-demo', maxPlayers: 4, sportKey: 'padel' });
    // L'aperçu d'équipes n'apparaît qu'une fois l'identité de l'organisateur chargée.
    await screen.findByText('Alice Org');
    // Ajout ciblé : « + » d'une place de l'équipe 1 → feuille d'ajout → pick.
    fireEvent.click(screen.getAllByRole('button', { name: /Ajouter un joueur à l'équipe 1/ })[0]);
    fireEvent.click(await screen.findByRole('button', { name: /Marc Dupont/ }));
    fireEvent.click(screen.getByRole('button', { name: /Partie ouverte/ }));
    fireEvent.click(screen.getByRole('button', { name: /Confirmer la réservation/ }));
    await waitFor(() => expect(api.applyHoldSetup).toHaveBeenCalledWith(
      'res-1', 'jwt-token',
      expect.objectContaining({ partnerUserIds: ['user-2'], visibility: 'PUBLIC' }),
    ));
  });

  it('padel : applyHoldSetup reçoit teams + slots (organisateur + partenaire, place tapée)', async () => {
    (api.searchClubMembers as jest.Mock).mockResolvedValue([{ id: 'user-2', firstName: 'Marc', lastName: 'Dupont' }]);
    renderModal({ slug: 'club-demo', maxPlayers: 4, sportKey: 'padel' });
    // L'aperçu d'équipes n'apparaît qu'une fois l'identité de l'organisateur chargée.
    await screen.findByText('Alice Org');
    // Ajout ciblé : « + » d'une place de l'équipe 1 (la D, l'organisateur occupe la G) → feuille → pick.
    fireEvent.click(screen.getAllByRole('button', { name: /Ajouter un joueur à l'équipe 1/ })[0]);
    fireEvent.click(await screen.findByRole('button', { name: /Marc Dupont/ }));
    // La feuille d'ajout se referme après le pick (la place visée est libérée).
    expect(screen.queryByPlaceholderText(/Rechercher un membre/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Confirmer la réservation/ }));
    await waitFor(() => expect(api.applyHoldSetup).toHaveBeenCalledWith(
      'res-1', 'jwt-token',
      expect.objectContaining({
        teams: expect.objectContaining({ 'user-1': 1, 'user-2': 1 }),
        slots: expect.objectContaining({ 'user-1': 0, 'user-2': 1 }),
      }),
    ));
  });

  it('propose « Partie ouverte » sur un terrain padel multi-joueurs', async () => {
    renderModal({ slug: 'club-demo', maxPlayers: 4, sportKey: 'padel' });
    await screen.findByText(/Créneau bloqué/);
    expect(await screen.findByRole('button', { name: /Partie ouverte/ })).toBeInTheDocument();
  });

  it('cache « Partie ouverte » sur un terrain non-padel', async () => {
    renderModal({ slug: 'club-demo', maxPlayers: 4, sportKey: 'tennis' });
    await screen.findByText(/Créneau bloqué/);
    expect(screen.queryByRole('button', { name: /Partie ouverte/ })).not.toBeInTheDocument();
  });

  it('le timer expiré bascule en erreur', async () => {
    (api.holdSlot as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'PENDING', totalPrice: '25' });
    jest.useFakeTimers();
    renderModal();
    // Attendre que le hold résout et que le composant passe en phase 'held'
    await waitFor(() => expect(screen.getByText(/Créneau bloqué/)).toBeInTheDocument());
    // Épuiser les 300 ticks du compte à rebours : chaque setTimeout de 1 s est chaîné,
    // on avance par petits blocs enveloppés dans act() pour que React traite les updates.
    for (let i = 0; i < 301; i++) {
      await act(async () => { jest.advanceTimersByTime(1000); });
    }
    expect(screen.getByText(/expiré/)).toBeInTheDocument();
    jest.useRealTimers();
  });

  it('payer en ligne affiche la part par personne (7,50€ = 30€ / 4)', async () => {
    // capacityFor('padel', 'double') === 4  →  30 € ÷ 4 = 7,50 €. Le nouveau flux n'a plus de
    // bouton « Valider le paiement » : la part s'affiche dans l'avenue (et sur le bouton Stripe « Payer »).
    (api.holdSlot as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'PENDING', totalPrice: '30' });
    renderModal({ slot: { ...mockSlot, price: '30' }, slug: 'club-demo', maxPlayers: 4,
      format: 'double', sportKey: 'padel', price: '30', stripeActive: true });
    fireEvent.click(await screen.findByRole('button', { name: /Payer en ligne/ }));
    expect(screen.getByText(/Votre part/)).toBeInTheDocument();
    expect(screen.getAllByText(/7,50/).length).toBeGreaterThan(0);
  });

  it('ne ré-annule pas la résa après une confirmation réussie au démontage', async () => {
    const onConfirmed = jest.fn();
    const { unmount } = renderModal({ onConfirmed });
    fireEvent.click(await screen.findByRole('button', { name: /Confirmer la réservation/ }));
    await waitFor(() => expect(onConfirmed).toHaveBeenCalled());
    unmount();
    expect(api.cancelReservation).not.toHaveBeenCalled();
  });

  it('partie ouverte, niveau OFF : applyHoldSetup sans targetLevelMin/Max', async () => {
    mockClub = { levelSystemEnabled: false };
    (api.searchClubMembers as jest.Mock).mockResolvedValue([{ id: 'user-2', firstName: 'Marc', lastName: 'Dupont' }]);
    renderModal({ slug: 'club-demo', maxPlayers: 4, sportKey: 'padel' });
    // L'aperçu d'équipes n'apparaît qu'une fois l'identité de l'organisateur chargée.
    await screen.findByText('Alice Org');
    // Ajout ciblé : « + » d'une place de l'équipe 1 → feuille d'ajout → pick.
    fireEvent.click(screen.getAllByRole('button', { name: /Ajouter un joueur à l'équipe 1/ })[0]);
    fireEvent.click(await screen.findByRole('button', { name: /Marc Dupont/ }));
    fireEvent.click(screen.getByRole('button', { name: /Partie ouverte/ }));
    fireEvent.click(screen.getByRole('button', { name: /Confirmer la réservation/ }));
    await waitFor(() => expect(api.applyHoldSetup).toHaveBeenCalled());
    const setup = (api.applyHoldSetup as jest.Mock).mock.calls[0][2];
    expect(setup).not.toHaveProperty('targetLevelMin');
    expect(setup).not.toHaveProperty('targetLevelMax');
  });

  it('partie ouverte, niveau ON et limite active : applyHoldSetup avec targetLevelMin/Max', async () => {
    mockClub = { levelSystemEnabled: true };
    (api.searchClubMembers as jest.Mock).mockResolvedValue([{ id: 'user-2', firstName: 'Marc', lastName: 'Dupont' }]);
    renderModal({ slug: 'club-demo', maxPlayers: 4, sportKey: 'padel' });
    // L'aperçu d'équipes n'apparaît qu'une fois l'identité de l'organisateur chargée.
    await screen.findByText('Alice Org');
    // Ajout ciblé : « + » d'une place de l'équipe 1 → feuille d'ajout → pick.
    fireEvent.click(screen.getAllByRole('button', { name: /Ajouter un joueur à l'équipe 1/ })[0]);
    fireEvent.click(await screen.findByRole('button', { name: /Marc Dupont/ }));
    fireEvent.click(screen.getByRole('button', { name: /Partie ouverte/ }));
    fireEvent.click(screen.getByRole('button', { name: /Confirmer la réservation/ }));
    await waitFor(() => expect(api.applyHoldSetup).toHaveBeenCalledWith(
      'res-1', 'jwt-token',
      expect.objectContaining({ visibility: 'PUBLIC', targetLevelMin: expect.any(Number), targetLevelMax: expect.any(Number) }),
    ));
  });

  it('empreinte requise MAIS carte déjà sur fichier : confirme direct (pas de CGV, pas d étape Stripe)', async () => {
    const onConfirmed = jest.fn();
    renderModal({ requireCardFingerprint: true, hasCardOnFile: true, onConfirmed });
    const confirmBtn = await screen.findByRole('button', { name: /Confirmer la réservation/ });
    // Pas de réenregistrement de carte → pas de case CGV.
    expect(screen.queryByRole('checkbox', { name: /conditions générales/i })).toBeNull();
    fireEvent.click(confirmBtn);
    // Confirme directement, sans paymentSource (pas d'étape Stripe).
    await waitFor(() => expect(api.confirmReservation).toHaveBeenCalledWith('res-1', 'jwt-token', undefined));
    await waitFor(() => expect(onConfirmed).toHaveBeenCalled());
  });

  it('partie ouverte sur un terrain padel : le limiteur de niveau s affiche', async () => {
    mockClub = { levelSystemEnabled: true };
    renderModal({ slug: 'club-demo', maxPlayers: 4, sportKey: 'padel' });
    fireEvent.click(await screen.findByRole('button', { name: /Partie ouverte/ }));
    expect(screen.getByText(/Limiter le niveau/)).toBeInTheDocument();
  });

  // NB : les parties ouvertes sont désormais padel-only (feat/parties-padel-only, sur main).
  // Les tests « partie ouverte sur non-padel » de la branche niveau sont donc devenus
  // sans objet — le bouton « Partie ouverte » n'apparaît plus hors padel (couvert par le
  // test « cache Partie ouverte sur un terrain non-padel » ci-dessus), et le limiteur de
  // niveau sur partie ouverte padel reste testé plus haut. Retirés à la fusion.
});
