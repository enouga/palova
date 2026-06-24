import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BookingModal from '../components/BookingModal';
import { ThemeProvider } from '../lib/ThemeProvider';
import { api, TimeSlot, Subscription } from '../lib/api';

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
    getClubPage:        jest.fn().mockResolvedValue({}),
  },
  assetUrl: (u: string | null) => u,
}));

const offPeakSlot: TimeSlot = {
  startTime: '2026-07-01T08:00:00.000Z',
  endTime:   '2026-07-01T09:30:00.000Z',
  available: true,
  price: '13',
  offPeak: true,
};

const peakSlot: TimeSlot = { ...offPeakSlot, offPeak: false };

const sub: Subscription = {
  id: 'sub-1', planId: 'plan-1', status: 'ACTIVE', startedAt: '', expiresAt: '',
  monthlyPriceSnapshot: '69', sportKeys: ['padel'], offPeakOnly: true, benefit: 'INCLUDED',
  discountPercent: null, dailyCap: null, weeklyCap: null, plan: { name: 'Abo Padel' },
};

function renderWithSubscriptions(slot: TimeSlot, subscriptions: Subscription[]) {
  render(
    <ThemeProvider>
      <BookingModal
        slot={slot}
        resourceId="court-1"
        price="13"
        duration={90}
        token="jwt"
        sportKey="padel"
        subscriptions={subscriptions}
        packages={[]}
        onClose={jest.fn()}
        onConfirmed={jest.fn()}
      />
    </ThemeProvider>,
  );
}

describe('BookingModal — couverture par abonnement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClub = null;
    localStorage.clear();
    (api.holdSlot as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'PENDING', totalPrice: '13' });
    (api.confirmReservation as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'CONFIRMED' });
    (api.cancelReservation as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'CANCELLED' });
    (api.applyHoldSetup as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'PENDING' });
  });

  it('créneau creux couvert : confirme avec paymentSource subscriptionId', async () => {
    renderWithSubscriptions(offPeakSlot, [sub]);

    // Le hold est automatique — attendre que le contenu interactif apparaisse
    // Le bloc « couvert par votre abonnement » est visible et sélectionné par défaut.
    expect(await screen.findByText(/Couvert par votre abonnement/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Confirmer avec mon abonnement/ }));

    await waitFor(() => {
      expect(api.confirmReservation).toHaveBeenCalledWith('res-1', 'jwt', { paymentSource: { subscriptionId: 'sub-1' } });
    });
  });

  it('créneau plein avec abo heures creuses : pas de couverture, confirme sans paymentSource', async () => {
    renderWithSubscriptions(peakSlot, [sub]);

    // Attendre la phase held
    await screen.findByText(/Créneau bloqué/);
    expect(screen.queryByText(/Couvert par votre abonnement/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Confirmer la réservation/ }));

    await waitFor(() => {
      expect(api.confirmReservation).toHaveBeenCalledWith('res-1', 'jwt', undefined);
    });
  });
});
