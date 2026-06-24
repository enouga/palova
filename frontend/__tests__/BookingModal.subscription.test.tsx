import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BookingModal from '../components/BookingModal';
import { ThemeProvider } from '../lib/ThemeProvider';
import { api, TimeSlot, Subscription } from '../lib/api';

jest.mock('../lib/api', () => ({
  api: {
    holdSlot:           jest.fn(),
    confirmReservation: jest.fn(),
    cancelReservation:  jest.fn(),
  },
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

async function openPending(slot: TimeSlot, subscriptions: Subscription[]) {
  (api.holdSlot as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'PENDING', totalPrice: '13' });
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
  fireEvent.click(screen.getByRole('button', { name: /Pré-réserver/ }));
  await screen.findByText(/Confirmez dans/);
}

describe('BookingModal — couverture par abonnement', () => {
  beforeEach(() => jest.clearAllMocks());

  it('créneau creux couvert : confirme avec paymentSource subscriptionId', async () => {
    (api.confirmReservation as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'CONFIRMED' });
    await openPending(offPeakSlot, [sub]);

    // Le bloc « couvert par votre abonnement » est visible et sélectionné par défaut.
    expect(screen.getByText(/Couvert par votre abonnement/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Confirmer avec mon abonnement/ }));

    await waitFor(() => {
      expect(api.confirmReservation).toHaveBeenCalledWith('res-1', 'jwt', { paymentSource: { subscriptionId: 'sub-1' } });
    });
  });

  it('créneau plein avec abo heures creuses : pas de couverture, confirme sans paymentSource', async () => {
    (api.confirmReservation as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'CONFIRMED' });
    await openPending(peakSlot, [sub]);

    expect(screen.queryByText(/Couvert par votre abonnement/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Confirmer et payer/ }));

    await waitFor(() => {
      expect(api.confirmReservation).toHaveBeenCalledWith('res-1', 'jwt', undefined);
    });
  });
});
