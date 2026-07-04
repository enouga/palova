import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { StrictMode } from 'react';
import { renderCheckout, buildQuery, buildClub, heldReservation, MockClub } from '../test-utils/checkoutHarness';
import { ThemeProvider } from '../lib/ThemeProvider';
import ConfirmerReservationPage from '../app/reserver/confirmer/page';

// Port de BookingModal.test.tsx vers la page /reserver/confirmer (remplace le modal monté
// via props par une page qui lit resource/start/duration/price/sport/format/name/offpeak
// en query + charge son contexte joueur (soldes/abonnements/quotas/empreinte) via l'API.

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
let mockSearchParams = buildQuery();
jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: mockBack }),
}));

let mockClubState: { slug: string | null; club: MockClub | null; loading: boolean } = {
  slug: 'club-demo', club: buildClub(), loading: false,
};
jest.mock('../lib/ClubProvider', () => ({
  useClub: () => mockClubState,
}));

jest.mock('../lib/api', () => ({
  api: {
    holdSlot:              jest.fn(),
    confirmReservation:    jest.fn(),
    cancelReservation:     jest.fn(),
    applyHoldSetup:        jest.fn(),
    searchClubMembers:     jest.fn(),
    listClubFriends:       jest.fn().mockResolvedValue([]),
    getMyRating:           jest.fn().mockResolvedValue(null),
    getMyProfile:          jest.fn(),
    getClubPage:           jest.fn().mockResolvedValue({}),
    getMyClubPackages:     jest.fn().mockResolvedValue([]),
    getMyClubSubscriptions: jest.fn().mockResolvedValue([]),
    getMyQuotaStatus:      jest.fn().mockResolvedValue(null),
    getMyCardStatus:       jest.fn().mockResolvedValue({ hasCardOnFile: false }),
    createStripeIntent:    jest.fn(),
  },
  assetUrl: (u: string | null) => u,
}));

import { api } from '../lib/api';

/** Attend la phase « held » — la section Mode de paiement n'est rendue que dans cette phase. */
async function waitHeld() {
  return screen.findByText('Mode de paiement');
}

describe('Checkout — page /reserver/confirmer (page unique)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    document.cookie = 'token=jwt-token; path=/';
    mockPush.mockClear(); mockReplace.mockClear(); mockBack.mockClear();
    mockClubState = { slug: 'club-demo', club: buildClub(), loading: false };
    mockSearchParams = buildQuery();
    (api.holdSlot as jest.Mock).mockResolvedValue(heldReservation());
    (api.confirmReservation as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'CONFIRMED' });
    (api.cancelReservation as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'CANCELLED' });
    (api.applyHoldSetup as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'PENDING' });
    (api.getMyProfile as jest.Mock).mockResolvedValue({ id: 'user-1', firstName: 'Alice', lastName: 'Org', avatarUrl: null });
  });
  afterEach(() => { document.cookie = 'token=; max-age=0; path=/'; });

  it('en dev (StrictMode, double montage) : atteint « held » avec un seul hold, sans auto-annulation', async () => {
    render(
      <StrictMode>
        <ThemeProvider>
          <ConfirmerReservationPage />
        </ThemeProvider>
      </StrictMode>,
    );
    await waitHeld();
    expect(api.holdSlot).toHaveBeenCalledTimes(1);          // un seul hold malgré le double montage
    expect(api.cancelReservation).not.toHaveBeenCalled();    // pas d'auto-annulation
  });

  it('bloque le créneau dès l ouverture (sans interaction)', async () => {
    renderCheckout();
    await waitFor(() => expect(api.holdSlot).toHaveBeenCalledWith(
      { resourceId: 'court-1', startTime: '2025-06-15T06:00:00.000Z', endTime: '2025-06-15T07:00:00.000Z' },
      'jwt-token',
    ));
    await waitHeld();
  });

  it('affiche un message d erreur si le hold échoue, et « Retour à la grille » ramène à /reserver', async () => {
    (api.holdSlot as jest.Mock).mockRejectedValue(new Error('SLOT_ALREADY_HELD'));
    renderCheckout();
    expect(await screen.findByText(/vient d'être pris/)).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: /Retour à la grille/ });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(mockPush).toHaveBeenCalledWith('/reserver');
  });

  it('confirme (régler au club) → confirmReservation puis retour à la grille (confirmé)', async () => {
    renderCheckout();
    fireEvent.click(await screen.findByRole('button', { name: /Confirmer la réservation/ }));
    await waitFor(() => expect(api.confirmReservation).toHaveBeenCalledWith('res-1', 'jwt-token', undefined));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/reserver?confirmed=1'));
  });

  it('« Abandonner » annule le hold puis retourne à la grille', async () => {
    renderCheckout();
    await waitHeld();
    fireEvent.click(screen.getByRole('button', { name: /Abandonner/ }));
    await waitFor(() => expect(api.cancelReservation).toHaveBeenCalledWith('res-1', 'jwt-token'));
    expect(mockPush).toHaveBeenCalledWith('/reserver');
  });

  it('affiche le bloc conditions d annulation (sans case)', async () => {
    mockClubState = { slug: 'club-demo', club: buildClub({ cancellationCutoffHours: 24, refundOnCancelWithinCutoff: false }), loading: false };
    renderCheckout();
    expect(await screen.findByText(/Conditions d'annulation/)).toBeInTheDocument();
    expect(screen.getByText(/24\s*h avant le début/)).toBeInTheDocument();
  });

  it('reprend le timer depuis createdAt (hold posé il y a 2 min → affiche ~03:xx, jamais 05:00)', async () => {
    (api.holdSlot as jest.Mock).mockResolvedValue(heldReservation({ createdAt: new Date(Date.now() - 120_000).toISOString() }));
    renderCheckout();
    await waitHeld();
    const timer = await screen.findByText(/0[23]:\d{2}/);
    expect(timer.textContent).not.toMatch(/05:00/);
  });

  it('partie ouverte : applyHoldSetup reçoit partnerUserIds + visibility', async () => {
    (api.searchClubMembers as jest.Mock).mockResolvedValue([{ id: 'user-2', firstName: 'Marc', lastName: 'Dupont' }]);
    mockSearchParams = buildQuery({ sport: 'padel' });
    renderCheckout();
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
    mockSearchParams = buildQuery({ sport: 'padel' });
    renderCheckout();
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
    mockSearchParams = buildQuery({ sport: 'padel' });
    renderCheckout();
    await waitHeld();
    expect(await screen.findByRole('button', { name: /Partie ouverte/ })).toBeInTheDocument();
  });

  it('cache « Partie ouverte » sur un terrain non-padel', async () => {
    mockSearchParams = buildQuery({ sport: 'tennis' });
    renderCheckout();
    await waitHeld();
    expect(screen.queryByRole('button', { name: /Partie ouverte/ })).not.toBeInTheDocument();
  });

  it('le timer expiré bascule en erreur', async () => {
    jest.useFakeTimers();
    renderCheckout();
    // Attendre que le hold résout et que le composant passe en phase 'held'
    await waitFor(() => expect(screen.getByText('Mode de paiement')).toBeInTheDocument());
    // Épuiser les 300 ticks du compte à rebours : chaque setTimeout de 1 s est chaîné,
    // on avance par petits blocs enveloppés dans act() pour que React traite les updates.
    for (let i = 0; i < 301; i++) {
      await act(async () => { jest.advanceTimersByTime(1000); });
    }
    expect(screen.getByText(/expiré/)).toBeInTheDocument();
    jest.useRealTimers();
  });

  it('payer en ligne affiche la part par personne (7,50€ = 30€ / 4)', async () => {
    // capacityFor('padel', 'double') === 4  →  30 € ÷ 4 = 7,50 €.
    mockClubState = { slug: 'club-demo', club: buildClub({ stripeAccountStatus: 'ACTIVE' }), loading: false };
    (api.holdSlot as jest.Mock).mockResolvedValue(heldReservation({ totalPrice: '30' }));
    mockSearchParams = buildQuery({ sport: 'padel', format: 'double', price: '30' });
    renderCheckout();
    fireEvent.click(await screen.findByRole('button', { name: /Payer en ligne/ }));
    expect(screen.getByText(/Votre part/)).toBeInTheDocument();
    expect(screen.getAllByText(/7,50/).length).toBeGreaterThan(0);
    // Laisse l'effet de vérification des CGV (déclenché par cardIntentPath) se résoudre
    // avant la fin du test, pour éviter un avertissement act() en teardown.
    await waitFor(() => expect(api.getClubPage).toHaveBeenCalled());
  });

  it('ne ré-annule pas la résa après une confirmation réussie au démontage', async () => {
    const { unmount } = renderCheckout();
    fireEvent.click(await screen.findByRole('button', { name: /Confirmer la réservation/ }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/reserver?confirmed=1'));
    unmount();
    expect(api.cancelReservation).not.toHaveBeenCalled();
  });

  it('partie ouverte, niveau OFF : applyHoldSetup sans targetLevelMin/Max', async () => {
    mockClubState = { slug: 'club-demo', club: buildClub({ levelSystemEnabled: false }), loading: false };
    (api.searchClubMembers as jest.Mock).mockResolvedValue([{ id: 'user-2', firstName: 'Marc', lastName: 'Dupont' }]);
    mockSearchParams = buildQuery({ sport: 'padel' });
    renderCheckout();
    await screen.findByText('Alice Org');
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
    mockClubState = { slug: 'club-demo', club: buildClub({ levelSystemEnabled: true }), loading: false };
    (api.searchClubMembers as jest.Mock).mockResolvedValue([{ id: 'user-2', firstName: 'Marc', lastName: 'Dupont' }]);
    mockSearchParams = buildQuery({ sport: 'padel' });
    renderCheckout();
    await screen.findByText('Alice Org');
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
    mockClubState = { slug: 'club-demo', club: buildClub({ requireCardFingerprint: true }), loading: false };
    (api.getMyCardStatus as jest.Mock).mockResolvedValue({ hasCardOnFile: true });
    renderCheckout();
    const confirmBtn = await screen.findByRole('button', { name: /Confirmer la réservation/ });
    // Pas de réenregistrement de carte → pas de case CGV.
    expect(screen.queryByRole('checkbox', { name: /conditions générales/i })).toBeNull();
    fireEvent.click(confirmBtn);
    // Confirme directement, sans paymentSource (pas d'étape Stripe).
    await waitFor(() => expect(api.confirmReservation).toHaveBeenCalledWith('res-1', 'jwt-token', undefined));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/reserver?confirmed=1'));
  });

  it('partie ouverte sur un terrain padel : le limiteur de niveau s affiche', async () => {
    mockClubState = { slug: 'club-demo', club: buildClub({ levelSystemEnabled: true }), loading: false };
    mockSearchParams = buildQuery({ sport: 'padel' });
    renderCheckout();
    fireEvent.click(await screen.findByRole('button', { name: /Partie ouverte/ }));
    expect(screen.getByText(/Limiter le niveau/)).toBeInTheDocument();
  });

  // NB : les parties ouvertes sont padel-only (feat/parties-padel-only, sur main) — le bouton
  // « Partie ouverte » n'apparaît plus hors padel (couvert par « cache « Partie ouverte »… » ci-dessus).
});
