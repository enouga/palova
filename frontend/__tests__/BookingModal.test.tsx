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

  it('padel multi-joueurs : interrupteur « Partie ouverte aux membres » présent, OFF par défaut', async () => {
    renderModal({ slug: 'club-demo', maxPlayers: 4, sportKey: 'padel' });
    await screen.findByText(/Créneau bloqué/);
    const sw = screen.getByRole('switch', { name: /Partie ouverte aux membres/ });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(/partenaires s.ajoutent après la confirmation/i)).toBeInTheDocument();
  });

  it('non-padel : pas d interrupteur « Partie ouverte »', async () => {
    renderModal({ slug: 'club-demo', maxPlayers: 4, sportKey: 'tennis' });
    await screen.findByText(/Créneau bloqué/);
    expect(screen.queryByRole('switch', { name: /Partie ouverte/ })).not.toBeInTheDocument();
  });

  it('interrupteur OFF → confirmation sans applyHoldSetup', async () => {
    renderModal({ slug: 'club-demo', maxPlayers: 4, sportKey: 'padel' });
    await screen.findByText(/Créneau bloqué/);
    fireEvent.click(screen.getByRole('button', { name: /Confirmer la réservation/ }));
    await waitFor(() => expect(api.confirmReservation).toHaveBeenCalled());
    expect(api.applyHoldSetup).not.toHaveBeenCalled();
  });

  it('interrupteur ON → applyHoldSetup PUBLIC, partnerUserIds vide, niveaux de la préférence', async () => {
    localStorage.setItem('palova:open-match-level', JSON.stringify({ enabled: true, min: 4, max: 6 }));
    renderModal({ slug: 'club-demo', maxPlayers: 4, sportKey: 'padel' });
    await screen.findByText(/Créneau bloqué/);
    fireEvent.click(screen.getByRole('switch', { name: /Partie ouverte aux membres/ }));
    expect(screen.getByText(/Niveau 4–6 · réglable après confirmation/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Confirmer la réservation/ }));
    await waitFor(() => expect(api.applyHoldSetup).toHaveBeenCalledWith(
      'res-1', 'jwt-token',
      { partnerUserIds: [], visibility: 'PUBLIC', targetLevelMin: 4, targetLevelMax: 6 },
    ));
  });

  it('interrupteur ON, préférence « ouverte à tous » → targetLevel null', async () => {
    localStorage.setItem('palova:open-match-level', JSON.stringify({ enabled: false, min: 3, max: 5 }));
    renderModal({ slug: 'club-demo', maxPlayers: 4, sportKey: 'padel' });
    await screen.findByText(/Créneau bloqué/);
    fireEvent.click(screen.getByRole('switch', { name: /Partie ouverte aux membres/ }));
    fireEvent.click(screen.getByRole('button', { name: /Confirmer la réservation/ }));
    await waitFor(() => expect(api.applyHoldSetup).toHaveBeenCalledWith(
      'res-1', 'jwt-token',
      { partnerUserIds: [], visibility: 'PUBLIC', targetLevelMin: null, targetLevelMax: null },
    ));
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
    // Défaut replié « Régler au club » ; on déplie (« changer ») pour choisir « Payer en ligne ».
    await screen.findByText(/Créneau bloqué/);
    fireEvent.click(screen.getByRole('button', { name: /changer/ }));
    fireEvent.click(screen.getByRole('button', { name: /Payer en ligne/ }));
    // Regex avec « : » pour cibler « Votre part : 7,50€ » sans capter le titre de section « Votre partie ».
    expect(screen.getByText(/Votre part :/)).toBeInTheDocument();
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

  // NB : les parties ouvertes sont désormais padel-only (feat/parties-padel-only, sur main).
  // Les tests « partie ouverte sur non-padel » de la branche niveau sont donc devenus
  // sans objet — le bouton « Partie ouverte » n'apparaît plus hors padel (couvert par le
  // test « cache Partie ouverte sur un terrain non-padel » ci-dessus), et le limiteur de
  // niveau sur partie ouverte padel reste testé plus haut. Retirés à la fusion.
});
