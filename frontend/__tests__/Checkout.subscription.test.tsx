import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderCheckout, buildQuery, buildClub, heldReservation, MockClub } from '../test-utils/checkoutHarness';

// Port de BookingModal.subscription.test.tsx vers la page /reserver/confirmer — les
// abonnements ne sont plus passés en prop mais chargés via `api.getMyClubSubscriptions`.

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

import { api, Subscription } from '../lib/api';

const sub: Subscription = {
  id: 'sub-1', planId: 'plan-1', status: 'ACTIVE', startedAt: '', expiresAt: '',
  monthlyPriceSnapshot: '69', sportKeys: ['padel'], offPeakOnly: true, benefit: 'INCLUDED',
  discountPercent: null, dailyCap: null, weeklyCap: null, plan: { name: 'Abo Padel' },
};

function renderWithSubscriptions(query: URLSearchParams, subscriptions: Subscription[]) {
  mockSearchParams = query;
  (api.getMyClubSubscriptions as jest.Mock).mockResolvedValue(subscriptions);
  return renderCheckout();
}

describe('Checkout — couverture par abonnement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    document.cookie = 'token=jwt; path=/';
    mockPush.mockClear(); mockReplace.mockClear(); mockBack.mockClear();
    mockClubState = { slug: 'club-demo', club: buildClub(), loading: false };
    mockSearchParams = buildQuery();
    (api.holdSlot as jest.Mock).mockResolvedValue(heldReservation({ totalPrice: '13' }));
    (api.confirmReservation as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'CONFIRMED' });
    (api.cancelReservation as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'CANCELLED' });
    (api.applyHoldSetup as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'PENDING' });
  });
  afterEach(() => { document.cookie = 'token=; max-age=0; path=/'; });

  it('créneau creux couvert : confirme avec paymentSource subscriptionId', async () => {
    // 90 min, 13 €, entièrement en heures creuses.
    renderWithSubscriptions(buildQuery({ duration: '90', price: '13', offpeak: '1', sport: 'padel' }), [sub]);

    // Le hold est automatique — attendre que le contenu interactif apparaisse
    // Le bloc « couvert par votre abonnement » est visible et sélectionné par défaut.
    expect(await screen.findByText(/Couvert par votre abonnement/i)).toBeInTheDocument();

    // `useSub` bascule à `true` un tick après l'apparition de l'avenue (effet séparé, cf.
    // useBookingCheckout) — attendre le bouton (au lieu d'un accès synchrone) laisse ce tick passer.
    fireEvent.click(await screen.findByRole('button', { name: /Confirmer avec mon abonnement/ }));

    await waitFor(() => {
      expect(api.confirmReservation).toHaveBeenCalledWith('res-1', 'jwt', { paymentSource: { subscriptionId: 'sub-1' } });
    });
  });

  it('créneau plein avec abo heures creuses : pas de couverture, confirme sans paymentSource', async () => {
    // Même créneau mais heures PLEINES (offpeak=0) : l'abo (offPeakOnly) ne couvre pas.
    renderWithSubscriptions(buildQuery({ duration: '90', price: '13', offpeak: '0', sport: 'padel' }), [sub]);

    // Attendre la phase held
    await screen.findByText('Mode de paiement');
    expect(screen.queryByText(/Couvert par votre abonnement/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Confirmer la réservation/ }));

    await waitFor(() => {
      expect(api.confirmReservation).toHaveBeenCalledWith('res-1', 'jwt', undefined);
    });
  });
});
