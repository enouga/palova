import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
    getMyRating:        jest.fn().mockResolvedValue(null),
    getClubPage:        jest.fn().mockResolvedValue({ kind: 'CGV', bodyMarkdown: '...', updatedAt: '' }),
  },
  assetUrl: (u: string | null) => u,
}));

// L'étape Stripe est montée via dynamic() ; on la remplace par un stub qui expose
// les props reçues (type / amountLabel / cgvAccepted) pour pouvoir les asserter.
// payShare n'est plus une prop directe : il est capturé dans le callback createIntent.
jest.mock('../components/StripePaymentStep', () => ({
  __esModule: true,
  default: (props: { type: string; amountLabel: string; cgvAccepted?: boolean }) => (
    <div data-testid="stripe-step"
      data-type={props.type}
      data-cgv={String(!!props.cgvAccepted)}
      data-amount={props.amountLabel} />
  ),
}));

// Padel double → capacité 4.
const mockSlot: TimeSlot = {
  startTime: '2026-06-15T06:00:00.000Z',
  endTime:   '2026-06-15T07:00:00.000Z',
  available: true,
  price: '40',
  offPeak: false,
};

function renderModal(overrides: Partial<React.ComponentProps<typeof BookingModal>> = {}) {
  render(
    <ThemeProvider>
      <BookingModal
        slot={mockSlot}
        resourceId="court-1"
        price="40"
        duration={60}
        token="jwt-token"
        sportKey="padel"
        format="double"
        onClose={jest.fn()}
        onConfirmed={jest.fn()}
        {...overrides}
      />
    </ThemeProvider>,
  );
}

// Coche la case CGV (révèle le formulaire Stripe dans le nouveau flux « Stripe direct »).
function acceptCgv() {
  fireEvent.click(screen.getByRole('checkbox', { name: /conditions générales/i }));
}

describe('BookingModal — choix du mode de paiement (Lot 2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClub = null;
    localStorage.clear();
    (api.holdSlot as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'PENDING', totalPrice: '40' });
    (api.confirmReservation as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'CONFIRMED' });
    (api.cancelReservation as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'CANCELLED' });
    (api.applyHoldSetup as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'PENDING' });
  });

  it('« Régler au club » caché quand le paiement en ligne est imposé', async () => {
    renderModal({ requireOnlinePayment: true, stripeActive: true });
    // Attendre la phase held (hold automatique au montage)
    await screen.findByText(/Créneau bloqué/);
    expect(screen.queryByRole('button', { name: /Régler au club/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Payer en ligne/ })).toBeInTheDocument();
  });

  it('avenue en ligne masquée quand Stripe inactif et paiement non imposé', async () => {
    renderModal({ stripeActive: false, requireOnlinePayment: false });
    await screen.findByText(/Créneau bloqué/);
    expect(screen.queryByRole('button', { name: /Payer en ligne/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Régler au club/ })).toBeInTheDocument();
  });

  it('avenue en ligne visible quand Stripe actif (paiement facultatif)', async () => {
    renderModal({ stripeActive: true });
    await screen.findByText(/Créneau bloqué/);
    expect(screen.getByRole('button', { name: /Payer en ligne/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Régler au club/ })).toBeInTheDocument();
  });

  it('part trop faible < 0,50 € : online affiche « part trop faible » et paie le total', async () => {
    // total 0,40 € → part = 0,10 € < 0,50 € ; capacité padel double = 4 → 0,10 €.
    const tinySlot: TimeSlot = { ...mockSlot, price: '0.40' };
    (api.holdSlot as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'PENDING', totalPrice: '0.40' });
    renderModal({ stripeActive: true, slot: tinySlot, price: '0.40' });
    fireEvent.click(await screen.findByRole('button', { name: /Payer en ligne/ }));
    // L'avenue affiche le message "part trop faible".
    expect(screen.getByText(/trop faible/i)).toBeInTheDocument();
    // Cocher les CGV révèle l'étape Stripe, qui charge le TOTAL (pas la part : < 0,50 €).
    acceptCgv();
    const step = await screen.findByTestId('stripe-step');
    expect(step).toHaveAttribute('data-amount', '0,40€');
  });

  it('en ligne → étape Stripe directe avec le montant par personne', async () => {
    // 40 € / 4 joueurs (padel double) = 10 € par personne (payShare capturé dans createIntent)
    renderModal({ stripeActive: true });
    fireEvent.click(await screen.findByRole('button', { name: /Payer en ligne/ }));
    acceptCgv();
    const step = await screen.findByTestId('stripe-step');
    expect(step).toHaveAttribute('data-type', 'payment');
    expect(step).toHaveAttribute('data-amount', '10€');
  });

  it('en ligne paie toujours la part par personne (10€ = 40€/4), jamais le total', async () => {
    renderModal({ stripeActive: true });
    fireEvent.click(await screen.findByRole('button', { name: /Payer en ligne/ }));
    // L'avenue montre la part (10 €), pas le total (40 €).
    expect(screen.getByText(/Votre part/)).toBeInTheDocument();
    acceptCgv();
    const step = await screen.findByTestId('stripe-step');
    // amountLabel prouve que createIntent utilisera la part, pas le total.
    expect(step).toHaveAttribute('data-amount', '10€');
  });

  it('empreinte requise (sans paiement en ligne) → étape Stripe setup', async () => {
    renderModal({ requireCardFingerprint: true, stripeActive: false });
    await screen.findByText(/Créneau bloqué/);
    acceptCgv();
    const step = await screen.findByTestId('stripe-step');
    expect(step).toHaveAttribute('data-type', 'setup');
  });

  it('défensif : paiement en ligne imposé mais Stripe inactif → avenue désactivée + note, étape Stripe jamais ouverte', async () => {
    renderModal({ requireOnlinePayment: true, stripeActive: false });
    await screen.findByText(/Créneau bloqué/);
    expect(screen.getByText(/momentanément indisponible/i)).toBeInTheDocument();
    const onlineBtn = screen.getByRole('button', { name: /Payer en ligne/ });
    expect(onlineBtn).toBeDisabled();
    // La rangée d'action est conservée pour ce cas, avec un bouton désactivé.
    const confirm = screen.getByRole('button', { name: /Valider le paiement|Confirmer/ });
    expect(confirm).toBeDisabled();
    expect(screen.queryByTestId('stripe-step')).not.toBeInTheDocument();
  });
});

describe('BookingModal — acceptation des CGV au paiement en ligne (Lot 3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClub = null;
    localStorage.clear();
    (api.holdSlot as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'PENDING', totalPrice: '40' });
    (api.confirmReservation as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'CONFIRMED' });
    (api.cancelReservation as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'CANCELLED' });
    (api.applyHoldSetup as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'PENDING' });
    (api.getClubPage as jest.Mock).mockResolvedValue({ kind: 'CGV', bodyMarkdown: '...', updatedAt: '' });
  });

  it('paiement en ligne → case CGV ; l\'étape Stripe n\'apparaît qu\'une fois cochée (cgvAccepted=true)', async () => {
    renderModal({ stripeActive: true });
    fireEvent.click(await screen.findByRole('button', { name: /Payer en ligne/ }));

    const checkbox = screen.getByRole('checkbox', { name: /conditions générales/i });
    expect(checkbox).toBeInTheDocument();
    expect(screen.queryByTestId('stripe-step')).not.toBeInTheDocument();   // pas avant CGV

    fireEvent.click(checkbox);
    const step = await screen.findByTestId('stripe-step');
    expect(step).toHaveAttribute('data-cgv', 'true');
  });

  it('« Régler au club » → pas de case CGV, confirmation non bloquée', async () => {
    renderModal({ stripeActive: true });
    // Attendre la phase held
    await screen.findByText(/Créneau bloqué/);
    // payMode par défaut = 'club' quand le paiement en ligne n'est pas imposé.
    expect(screen.queryByRole('checkbox', { name: /conditions générales/i })).not.toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: /Confirmer la réservation/ });
    expect(confirm).not.toBeDisabled();
  });

  it('carnet prépayé sélectionné → pas de case CGV', async () => {
    renderModal({ stripeActive: true, packages: [{ id: 'pkg-1', kind: 'ENTRIES', creditsRemaining: 10 } as any] });
    fireEvent.click(await screen.findByRole('button', { name: /Carnet — 10 entrées/ }));
    expect(screen.queryByRole('checkbox', { name: /conditions générales/i })).not.toBeInTheDocument();
  });

  it('getClubPage rejette (PAGE_NOT_FOUND) → case CGV TOUJOURS affichée + note de repli, étape gardée', async () => {
    (api.getClubPage as jest.Mock).mockRejectedValue(new Error('PAGE_NOT_FOUND'));
    renderModal({ stripeActive: true });
    fireEvent.click(await screen.findByRole('button', { name: /Payer en ligne/ }));

    const checkbox = await screen.findByRole('checkbox', { name: /conditions générales/i });
    expect(checkbox).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/conditions générales de la plateforme/i)).toBeInTheDocument());

    expect(screen.queryByTestId('stripe-step')).not.toBeInTheDocument();   // tant que la case n'est pas cochée
  });

  it('empreinte bancaire (setup intent) → case CGV affichée et requise avant l\'étape', async () => {
    renderModal({ requireCardFingerprint: true, stripeActive: false });
    await screen.findByText(/Créneau bloqué/);
    const checkbox = screen.getByRole('checkbox', { name: /conditions générales/i });
    expect(checkbox).toBeInTheDocument();
    expect(screen.queryByTestId('stripe-step')).not.toBeInTheDocument();

    fireEvent.click(checkbox);
    await screen.findByTestId('stripe-step');
  });

  it('liens CGV / confidentialité = ancres vers les pages publiques (nouvel onglet)', async () => {
    renderModal({ stripeActive: true });
    fireEvent.click(await screen.findByRole('button', { name: /Payer en ligne/ }));

    const cgvLink = screen.getByRole('link', { name: /conditions générales de vente/i });
    expect(cgvLink).toHaveAttribute('href', '/cgv');
    expect(cgvLink).toHaveAttribute('target', '_blank');
    expect(cgvLink).toHaveAttribute('rel', expect.stringContaining('noopener'));

    const privacyLink = screen.getByRole('link', { name: /politique de confidentialité/i });
    expect(privacyLink).toHaveAttribute('href', '/confidentialite');
    expect(privacyLink).toHaveAttribute('target', '_blank');
  });
});

describe('BookingModal — gardes paiement renvoyées par le backend (jamais de code brut)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClub = null;
    localStorage.clear();
    (api.holdSlot as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'PENDING', totalPrice: '40' });
    (api.confirmReservation as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'CONFIRMED' });
    (api.cancelReservation as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'CANCELLED' });
    (api.applyHoldSetup as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'PENDING' });
    (api.getClubPage as jest.Mock).mockResolvedValue({ kind: 'CGV', bodyMarkdown: '...', updatedAt: '' });
  });

  it('donnée club périmée : confirmReservation renvoie CARD_FINGERPRINT_REQUIRED → bascule empreinte (CGV + étape setup), jamais le code brut', async () => {
    // requireCardFingerprint=false (prop périmée), mais le backend (à jour) l'exige.
    renderModal({ stripeActive: true, requireCardFingerprint: false });
    (api.confirmReservation as jest.Mock).mockRejectedValueOnce(new Error('CARD_FINGERPRINT_REQUIRED'));

    fireEvent.click(await screen.findByRole('button', { name: /Confirmer la réservation/ }));

    // Le code brut ne doit JAMAIS s'afficher.
    await waitFor(() => expect(screen.queryByText('CARD_FINGERPRINT_REQUIRED')).not.toBeInTheDocument());
    // Le tunnel passe en mode empreinte : la case CGV apparaît, puis l'étape setup une fois cochée.
    const checkbox = await screen.findByRole('checkbox', { name: /conditions générales/i });
    fireEvent.click(checkbox);
    const step = await screen.findByTestId('stripe-step');
    expect(step).toHaveAttribute('data-type', 'setup');
  });

  it('autre garde paiement (CGV_NOT_ACCEPTED) → message FR lisible, jamais le code brut', async () => {
    renderModal({ stripeActive: true });
    (api.confirmReservation as jest.Mock).mockRejectedValueOnce(new Error('CGV_NOT_ACCEPTED'));

    fireEvent.click(await screen.findByRole('button', { name: /Confirmer la réservation/ }));

    expect(await screen.findByText(/Veuillez accepter les conditions générales/i)).toBeInTheDocument();
    expect(screen.queryByText('CGV_NOT_ACCEPTED')).not.toBeInTheDocument();
  });
});
