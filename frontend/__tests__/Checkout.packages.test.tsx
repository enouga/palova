import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderCheckout, buildQuery, buildClub, heldReservation, MockClub } from '../test-utils/checkoutHarness';

// Port de BookingModal.packages.test.tsx vers la page /reserver/confirmer — les soldes
// prépayés (packages) ne sont plus passés en prop mais chargés via `api.getMyClubPackages`.

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
    getMyProfile:          jest.fn().mockResolvedValue({ id: 'user-1', firstName: 'Alice', lastName: 'Org', avatarUrl: null }),
    getClubPage:           jest.fn().mockResolvedValue({}),
    getMyClubPackages:     jest.fn().mockResolvedValue([]),
    getMyClubSubscriptions: jest.fn().mockResolvedValue([]),
    getMyQuotaStatus:      jest.fn().mockResolvedValue(null),
    getMyCardStatus:       jest.fn().mockResolvedValue({ hasCardOnFile: false }),
    createStripeIntent:    jest.fn(),
  },
  assetUrl: (u: string | null) => u,
}));

import { api, MemberPackage } from '../lib/api';

const pkg: MemberPackage = {
  id: 'pkg-1', kind: 'ENTRIES', creditsTotal: 10, creditsRemaining: 7,
  amountTotal: null, amountRemaining: null, purchasedAt: '2026-06-01T00:00:00Z',
  expiresAt: null, template: { name: '10 entrées' },
};

const poorWallet: MemberPackage = {
  id: 'w-1', kind: 'WALLET', creditsTotal: null, creditsRemaining: null,
  amountTotal: '10.00', amountRemaining: '10.00', purchasedAt: '2026-06-01T00:00:00Z',
  expiresAt: null, template: { name: 'Porte-monnaie' },
};

async function waitHeld() {
  return screen.findByText('Mode de paiement');
}

function renderWithPackages(packages: MemberPackage[]) {
  (api.getMyClubPackages as jest.Mock).mockResolvedValue(packages);
  return renderCheckout();
}

describe('Checkout — paiement par carnet', () => {
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
  });
  afterEach(() => { document.cookie = 'token=; max-age=0; path=/'; });

  it('propose le carnet en phase held et confirme avec paymentSource', async () => {
    renderWithPackages([pkg]);

    // Le hold est automatique — attendre que le contenu interactif apparaisse
    fireEvent.click(await screen.findByRole('button', { name: /Carnet — 7 entrées/ }));
    fireEvent.click(screen.getByRole('button', { name: /Confirmer avec mon solde/ }));

    await waitFor(() => {
      expect(api.confirmReservation).toHaveBeenCalledWith('res-1', 'jwt-token', { paymentSource: { packageId: 'pkg-1' } });
    });
  });

  it('confirme sans paymentSource si « Régler au club » reste sélectionné', async () => {
    renderWithPackages([pkg]);

    // Attendre la phase held
    await waitHeld();
    expect(screen.getByRole('button', { name: /Régler au club/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Confirmer la réservation/ }));

    await waitFor(() => {
      expect(api.confirmReservation).toHaveBeenCalledWith('res-1', 'jwt-token', undefined);
    });
  });

  it('solde insuffisant : reste en held, message affiché, retombe sur « Régler au club »', async () => {
    (api.confirmReservation as jest.Mock).mockRejectedValueOnce(new Error('INSUFFICIENT_BALANCE'));
    renderWithPackages([pkg]);

    // Attendre la phase held
    fireEvent.click(await screen.findByRole('button', { name: /Carnet — 7 entrées/ }));
    fireEvent.click(screen.getByRole('button', { name: /Confirmer avec mon solde/ }));

    expect(await screen.findByText(/Solde insuffisant/)).toBeInTheDocument();
    // toujours en phase held : le bouton de confirmation standard est revenu
    expect(screen.getByRole('button', { name: /Confirmer la réservation/ })).toBeInTheDocument();
  });

  it('affiche le solde restant projeté à la sélection du carnet', async () => {
    renderWithPackages([pkg]);
    fireEvent.click(await screen.findByRole('button', { name: /Carnet — 7 entrées/ }));
    expect(screen.getByText(/il restera 6 entrées/)).toBeInTheDocument();
  });

  it('porte-monnaie insuffisant : puce désactivée + mention « solde insuffisant »', async () => {
    renderWithPackages([poorWallet]);
    await waitHeld();
    expect(screen.getByRole('button', { name: /Porte-monnaie/ })).toBeDisabled();
    expect(screen.getByText(/solde insuffisant/)).toBeInTheDocument();
  });

  it('confirme avec un carnet → retour à la grille (confirmé)', async () => {
    renderWithPackages([pkg]);
    fireEvent.click(await screen.findByRole('button', { name: /Carnet — 7 entrées/ }));
    fireEvent.click(screen.getByRole('button', { name: /Confirmer avec mon solde/ }));
    await waitFor(() => {
      expect(api.confirmReservation).toHaveBeenCalledWith('res-1', 'jwt-token', { paymentSource: { packageId: 'pkg-1' } });
    });
    // Le résumé « payé avec votre carnet » n'est plus affiché par la page elle-même
    // (l'ancien `onConfirmed(reservation, paid)` du modal) — la navigation post-confirmation
    // est la même pour tous les moyens de paiement (miroir de Checkout.test.tsx).
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/reserver?confirmed=1'));
  });
});
