import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderCheckout, buildQuery, buildClub, heldReservation, MockClub } from '../test-utils/checkoutHarness';

// Port de BookingModal.payment.test.tsx vers la page /reserver/confirmer — mêmes scénarios
// (avenues de paiement + CGV/Stripe), adaptés au contexte query + club (au lieu de props).

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
// Padel double → capacité 4. Créneau 40 € par défaut (10 €/joueur).
let mockSearchParams = buildQuery({ price: '40', sport: 'padel', format: 'double' });
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
    getMyProfile:          jest.fn().mockResolvedValue({ id: 'user-1', firstName: 'Alice', lastName: 'Org', avatarUrl: null }),
    getClubPage:           jest.fn().mockResolvedValue({ kind: 'CGV', bodyMarkdown: '...', updatedAt: '' }),
    getMyClubPackages:     jest.fn().mockResolvedValue([]),
    getMyClubSubscriptions: jest.fn().mockResolvedValue([]),
    getMyQuotaStatus:      jest.fn().mockResolvedValue(null),
    getMyCardStatus:       jest.fn().mockResolvedValue({ hasCardOnFile: false }),
    createStripeIntent:    jest.fn(),
  },
  assetUrl: (u: string | null) => u,
}));

import { api, MemberPackage } from '../lib/api';

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

async function waitHeld() {
  return screen.findByText('Mode de paiement');
}

// Coche la case CGV (révèle le formulaire Stripe dans le flux « Stripe direct »).
function acceptCgv() {
  fireEvent.click(screen.getByRole('checkbox', { name: /conditions générales/i }));
}

describe('Checkout — choix du mode de paiement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    document.cookie = 'token=jwt-token; path=/';
    mockPush.mockClear(); mockReplace.mockClear(); mockBack.mockClear();
    mockClubState = { slug: 'club-demo', club: buildClub(), loading: false };
    mockSearchParams = buildQuery({ price: '40', sport: 'padel', format: 'double' });
    (api.holdSlot as jest.Mock).mockResolvedValue(heldReservation({ totalPrice: '40' }));
    (api.confirmReservation as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'CONFIRMED' });
    (api.cancelReservation as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'CANCELLED' });
    (api.applyHoldSetup as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'PENDING' });
  });
  afterEach(() => { document.cookie = 'token=; max-age=0; path=/'; });

  it('« Régler au club » caché quand le paiement en ligne est imposé', async () => {
    mockClubState = { slug: 'club-demo', club: buildClub({ requireOnlinePayment: true, stripeAccountStatus: 'ACTIVE' }), loading: false };
    renderCheckout();
    await waitHeld();
    expect(screen.queryByRole('button', { name: /Régler au club/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Payer en ligne/ })).toBeInTheDocument();
    // Paiement en ligne imposé dès le montage → cardIntentPath actif d'emblée, laisse l'effet
    // de vérification des CGV se résoudre avant la fin du test (évite un avertissement act()).
    await waitFor(() => expect(api.getClubPage).toHaveBeenCalled());
  });

  it('avenue en ligne masquée quand Stripe inactif et paiement non imposé', async () => {
    mockClubState = { slug: 'club-demo', club: buildClub({ stripeAccountStatus: 'INACTIVE', requireOnlinePayment: false }), loading: false };
    renderCheckout();
    await waitHeld();
    expect(screen.queryByRole('button', { name: /Payer en ligne/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Régler au club/ })).toBeInTheDocument();
  });

  it('avenue en ligne visible quand Stripe actif (paiement facultatif)', async () => {
    mockClubState = { slug: 'club-demo', club: buildClub({ stripeAccountStatus: 'ACTIVE' }), loading: false };
    renderCheckout();
    await waitHeld();
    expect(screen.getByRole('button', { name: /Payer en ligne/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Régler au club/ })).toBeInTheDocument();
  });

  it('part trop faible < 0,50 € : online affiche « part trop faible » et paie le total', async () => {
    // total 0,40 € → part = 0,10 € < 0,50 € ; capacité padel double = 4 → 0,10 €.
    mockClubState = { slug: 'club-demo', club: buildClub({ stripeAccountStatus: 'ACTIVE' }), loading: false };
    (api.holdSlot as jest.Mock).mockResolvedValue(heldReservation({ totalPrice: '0.40' }));
    mockSearchParams = buildQuery({ price: '0.40', sport: 'padel', format: 'double' });
    renderCheckout();
    fireEvent.click(await screen.findByRole('button', { name: /Payer en ligne/ }));
    // L'avenue affiche le message "part trop faible".
    expect(screen.getByText(/trop faible/i)).toBeInTheDocument();
    // Cocher les CGV révèle l'étape Stripe, qui charge le TOTAL (pas la part : < 0,50 €).
    acceptCgv();
    const step = await screen.findByTestId('stripe-step');
    expect(step).toHaveAttribute('data-amount', '0,40€');
    await waitFor(() => expect(api.getClubPage).toHaveBeenCalled());
  });

  it('en ligne → étape Stripe directe avec le montant par personne', async () => {
    // 40 € / 4 joueurs (padel double) = 10 € par personne (payShare capturé dans createIntent)
    mockClubState = { slug: 'club-demo', club: buildClub({ stripeAccountStatus: 'ACTIVE' }), loading: false };
    renderCheckout();
    fireEvent.click(await screen.findByRole('button', { name: /Payer en ligne/ }));
    acceptCgv();
    const step = await screen.findByTestId('stripe-step');
    expect(step).toHaveAttribute('data-type', 'payment');
    expect(step).toHaveAttribute('data-amount', '10€');
    await waitFor(() => expect(api.getClubPage).toHaveBeenCalled());
  });

  it('en ligne paie toujours la part par personne (10€ = 40€/4), jamais le total', async () => {
    mockClubState = { slug: 'club-demo', club: buildClub({ stripeAccountStatus: 'ACTIVE' }), loading: false };
    renderCheckout();
    fireEvent.click(await screen.findByRole('button', { name: /Payer en ligne/ }));
    // L'avenue montre la part (10 €), pas le total (40 €).
    expect(screen.getByText(/Votre part/)).toBeInTheDocument();
    acceptCgv();
    const step = await screen.findByTestId('stripe-step');
    // amountLabel prouve que createIntent utilisera la part, pas le total.
    expect(step).toHaveAttribute('data-amount', '10€');
    await waitFor(() => expect(api.getClubPage).toHaveBeenCalled());
  });

  it('empreinte requise (sans paiement en ligne) → étape Stripe setup', async () => {
    mockClubState = { slug: 'club-demo', club: buildClub({ requireCardFingerprint: true, stripeAccountStatus: 'INACTIVE' }), loading: false };
    renderCheckout();
    await waitHeld();
    acceptCgv();
    const step = await screen.findByTestId('stripe-step');
    expect(step).toHaveAttribute('data-type', 'setup');
    await waitFor(() => expect(api.getClubPage).toHaveBeenCalled());
  });

  it('défensif : paiement en ligne imposé mais Stripe inactif → avenue désactivée + note, étape Stripe jamais ouverte', async () => {
    mockClubState = { slug: 'club-demo', club: buildClub({ requireOnlinePayment: true, stripeAccountStatus: 'INACTIVE' }), loading: false };
    renderCheckout();
    await waitHeld();
    expect(screen.getByText(/momentanément indisponible/i)).toBeInTheDocument();
    const onlineBtn = screen.getByRole('button', { name: /Payer en ligne/ });
    expect(onlineBtn).toBeDisabled();
    // La rangée d'action est conservée pour ce cas, avec un bouton désactivé.
    const confirm = screen.getByRole('button', { name: /Valider le paiement|Confirmer/ });
    expect(confirm).toBeDisabled();
    expect(screen.queryByTestId('stripe-step')).not.toBeInTheDocument();
    await waitFor(() => expect(api.getClubPage).toHaveBeenCalled());
  });
});

describe('Checkout — acceptation des CGV au paiement en ligne', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    document.cookie = 'token=jwt-token; path=/';
    mockPush.mockClear(); mockReplace.mockClear(); mockBack.mockClear();
    mockClubState = { slug: 'club-demo', club: buildClub(), loading: false };
    mockSearchParams = buildQuery({ price: '40', sport: 'padel', format: 'double' });
    (api.holdSlot as jest.Mock).mockResolvedValue(heldReservation({ totalPrice: '40' }));
    (api.confirmReservation as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'CONFIRMED' });
    (api.cancelReservation as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'CANCELLED' });
    (api.applyHoldSetup as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'PENDING' });
    (api.getClubPage as jest.Mock).mockResolvedValue({ kind: 'CGV', bodyMarkdown: '...', updatedAt: '' });
  });
  afterEach(() => { document.cookie = 'token=; max-age=0; path=/'; });

  it('paiement en ligne → case CGV ; l\'étape Stripe n\'apparaît qu\'une fois cochée (cgvAccepted=true)', async () => {
    mockClubState = { slug: 'club-demo', club: buildClub({ stripeAccountStatus: 'ACTIVE' }), loading: false };
    renderCheckout();
    fireEvent.click(await screen.findByRole('button', { name: /Payer en ligne/ }));

    const checkbox = screen.getByRole('checkbox', { name: /conditions générales/i });
    expect(checkbox).toBeInTheDocument();
    expect(screen.queryByTestId('stripe-step')).not.toBeInTheDocument();   // pas avant CGV

    fireEvent.click(checkbox);
    const step = await screen.findByTestId('stripe-step');
    expect(step).toHaveAttribute('data-cgv', 'true');
    await waitFor(() => expect(api.getClubPage).toHaveBeenCalled());
  });

  it('« Régler au club » → pas de case CGV, confirmation non bloquée', async () => {
    mockClubState = { slug: 'club-demo', club: buildClub({ stripeAccountStatus: 'ACTIVE' }), loading: false };
    renderCheckout();
    await waitHeld();
    // payMode par défaut = 'club' quand le paiement en ligne n'est pas imposé.
    expect(screen.queryByRole('checkbox', { name: /conditions générales/i })).not.toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: /Confirmer la réservation/ });
    expect(confirm).not.toBeDisabled();
  });

  it('carnet prépayé sélectionné → pas de case CGV', async () => {
    mockClubState = { slug: 'club-demo', club: buildClub({ stripeAccountStatus: 'ACTIVE' }), loading: false };
    const pkg: MemberPackage = {
      id: 'pkg-1', kind: 'ENTRIES', creditsTotal: 10, creditsRemaining: 10,
      amountTotal: null, amountRemaining: null, purchasedAt: '2026-06-01T00:00:00Z',
      expiresAt: null, template: { name: '10 entrées' },
    };
    (api.getMyClubPackages as jest.Mock).mockResolvedValue([pkg]);
    renderCheckout();
    fireEvent.click(await screen.findByRole('button', { name: /Carnet — 10 entrées/ }));
    expect(screen.queryByRole('checkbox', { name: /conditions générales/i })).not.toBeInTheDocument();
  });

  it('getClubPage rejette (PAGE_NOT_FOUND) → case CGV TOUJOURS affichée + note de repli, étape gardée', async () => {
    mockClubState = { slug: 'club-demo', club: buildClub({ stripeAccountStatus: 'ACTIVE' }), loading: false };
    (api.getClubPage as jest.Mock).mockRejectedValue(new Error('PAGE_NOT_FOUND'));
    renderCheckout();
    fireEvent.click(await screen.findByRole('button', { name: /Payer en ligne/ }));

    const checkbox = await screen.findByRole('checkbox', { name: /conditions générales/i });
    expect(checkbox).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/conditions générales de la plateforme/i)).toBeInTheDocument());

    expect(screen.queryByTestId('stripe-step')).not.toBeInTheDocument();   // tant que la case n'est pas cochée
  });

  it('empreinte bancaire (setup intent) → case CGV affichée et requise avant l\'étape', async () => {
    mockClubState = { slug: 'club-demo', club: buildClub({ requireCardFingerprint: true, stripeAccountStatus: 'INACTIVE' }), loading: false };
    renderCheckout();
    await waitHeld();
    const checkbox = screen.getByRole('checkbox', { name: /conditions générales/i });
    expect(checkbox).toBeInTheDocument();
    expect(screen.queryByTestId('stripe-step')).not.toBeInTheDocument();

    fireEvent.click(checkbox);
    await screen.findByTestId('stripe-step');
  });

  it('liens CGV / confidentialité = ancres vers les pages publiques (nouvel onglet)', async () => {
    mockClubState = { slug: 'club-demo', club: buildClub({ stripeAccountStatus: 'ACTIVE' }), loading: false };
    renderCheckout();
    fireEvent.click(await screen.findByRole('button', { name: /Payer en ligne/ }));

    const cgvLink = screen.getByRole('link', { name: /conditions générales de vente/i });
    expect(cgvLink).toHaveAttribute('href', '/cgv');
    expect(cgvLink).toHaveAttribute('target', '_blank');
    expect(cgvLink).toHaveAttribute('rel', expect.stringContaining('noopener'));

    const privacyLink = screen.getByRole('link', { name: /politique de confidentialité/i });
    expect(privacyLink).toHaveAttribute('href', '/confidentialite');
    expect(privacyLink).toHaveAttribute('target', '_blank');
    await waitFor(() => expect(api.getClubPage).toHaveBeenCalled());
  });
});

describe('Checkout — CGV pré-cochée si déjà acceptée pour le club (mémoire locale)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    document.cookie = 'token=jwt-token; path=/';
    mockPush.mockClear(); mockReplace.mockClear(); mockBack.mockClear();
    mockClubState = { slug: 'club-demo', club: buildClub({ requireOnlinePayment: true, stripeAccountStatus: 'ACTIVE' }), loading: false };
    mockSearchParams = buildQuery({ price: '40', sport: 'padel', format: 'double' });
    (api.holdSlot as jest.Mock).mockResolvedValue(heldReservation({ totalPrice: '40' }));
    (api.confirmReservation as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'CONFIRMED' });
    (api.cancelReservation as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'CANCELLED' });
    (api.applyHoldSetup as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'PENDING' });
    (api.getClubPage as jest.Mock).mockResolvedValue({ kind: 'CGV', bodyMarkdown: '...', updatedAt: '' });
  });
  afterEach(() => { document.cookie = 'token=; max-age=0; path=/'; });

  it('déjà accepté pour ce club → case pré-cochée et étape Stripe affichée sans clic', async () => {
    localStorage.setItem('palova:cgv-accepted:club-demo', '1');
    renderCheckout();

    // La case est cochée d'emblée et le formulaire Stripe s'affiche sans interaction.
    const checkbox = await screen.findByRole('checkbox', { name: /conditions générales/i });
    expect(checkbox).toBeChecked();
    const step = await screen.findByTestId('stripe-step');
    expect(step).toHaveAttribute('data-cgv', 'true');
    await waitFor(() => expect(api.getClubPage).toHaveBeenCalled());
  });

  it('mémoire d\'un AUTRE club n\'affecte pas celui-ci (clé par slug)', async () => {
    localStorage.setItem('palova:cgv-accepted:autre-club', '1');
    renderCheckout();

    const checkbox = await screen.findByRole('checkbox', { name: /conditions générales/i });
    expect(checkbox).not.toBeChecked();
    expect(screen.queryByTestId('stripe-step')).not.toBeInTheDocument();
    await waitFor(() => expect(api.getClubPage).toHaveBeenCalled());
  });

  it('cocher la case mémorise l\'acceptation pour ce club', async () => {
    renderCheckout();
    const checkbox = await screen.findByRole('checkbox', { name: /conditions générales/i });
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);
    await screen.findByTestId('stripe-step');
    expect(localStorage.getItem('palova:cgv-accepted:club-demo')).toBe('1');
    await waitFor(() => expect(api.getClubPage).toHaveBeenCalled());
  });
});

describe('Checkout — gardes paiement renvoyées par le backend (jamais de code brut)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    document.cookie = 'token=jwt-token; path=/';
    mockPush.mockClear(); mockReplace.mockClear(); mockBack.mockClear();
    mockClubState = { slug: 'club-demo', club: buildClub(), loading: false };
    mockSearchParams = buildQuery({ price: '40', sport: 'padel', format: 'double' });
    (api.holdSlot as jest.Mock).mockResolvedValue(heldReservation({ totalPrice: '40' }));
    (api.confirmReservation as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'CONFIRMED' });
    (api.cancelReservation as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'CANCELLED' });
    (api.applyHoldSetup as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'PENDING' });
    (api.getClubPage as jest.Mock).mockResolvedValue({ kind: 'CGV', bodyMarkdown: '...', updatedAt: '' });
  });
  afterEach(() => { document.cookie = 'token=; max-age=0; path=/'; });

  it('donnée club périmée : confirmReservation renvoie CARD_FINGERPRINT_REQUIRED → bascule empreinte (CGV + étape setup), jamais le code brut', async () => {
    // requireCardFingerprint=false (donnée club périmée), mais le backend (à jour) l'exige.
    mockClubState = { slug: 'club-demo', club: buildClub({ requireCardFingerprint: false, stripeAccountStatus: 'ACTIVE' }), loading: false };
    renderCheckout();
    (api.confirmReservation as jest.Mock).mockRejectedValueOnce(new Error('CARD_FINGERPRINT_REQUIRED'));

    fireEvent.click(await screen.findByRole('button', { name: /Confirmer la réservation/ }));

    // Le code brut ne doit JAMAIS s'afficher.
    await waitFor(() => expect(screen.queryByText('CARD_FINGERPRINT_REQUIRED')).not.toBeInTheDocument());
    // Le tunnel passe en mode empreinte : la case CGV apparaît, puis l'étape setup une fois cochée.
    const checkbox = await screen.findByRole('checkbox', { name: /conditions générales/i });
    fireEvent.click(checkbox);
    const step = await screen.findByTestId('stripe-step');
    expect(step).toHaveAttribute('data-type', 'setup');
    await waitFor(() => expect(api.getClubPage).toHaveBeenCalled());
  });

  it('autre garde paiement (CGV_NOT_ACCEPTED) → message FR lisible, jamais le code brut', async () => {
    mockClubState = { slug: 'club-demo', club: buildClub({ stripeAccountStatus: 'ACTIVE' }), loading: false };
    renderCheckout();
    (api.confirmReservation as jest.Mock).mockRejectedValueOnce(new Error('CGV_NOT_ACCEPTED'));

    fireEvent.click(await screen.findByRole('button', { name: /Confirmer la réservation/ }));

    expect(await screen.findByText(/Veuillez accepter les conditions générales/i)).toBeInTheDocument();
    expect(screen.queryByText('CGV_NOT_ACCEPTED')).not.toBeInTheDocument();
  });
});
