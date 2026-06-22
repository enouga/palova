import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BookingModal from '../components/BookingModal';
import { ThemeProvider } from '../lib/ThemeProvider';
import { api, TimeSlot } from '../lib/api';

jest.mock('../lib/api', () => ({
  api: {
    holdSlot:           jest.fn(),
    confirmReservation: jest.fn(),
    cancelReservation:  jest.fn(),
    getMyRating:        jest.fn().mockResolvedValue(null),
  },
  assetUrl: (u: string | null) => u,
}));

// L'étape Stripe est montée via dynamic() ; on la remplace par un stub qui expose
// les props reçues (type / payShare / amountLabel) pour pouvoir les asserter.
jest.mock('../components/StripePaymentStep', () => ({
  __esModule: true,
  default: (props: { type: string; payShare?: boolean; amountLabel: string }) => (
    <div data-testid="stripe-step"
      data-type={props.type}
      data-payshare={String(!!props.payShare)}
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

async function openPending(overrides: Partial<React.ComponentProps<typeof BookingModal>> = {}) {
  (api.holdSlot as jest.Mock).mockResolvedValue({ id: 'res-1', status: 'PENDING', totalPrice: '40' });
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
  fireEvent.click(screen.getByRole('button', { name: /Pré-réserver/ }));
  await screen.findByText(/Confirmez dans/);
}

describe('BookingModal — choix du mode de paiement (Lot 2)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('« Régler au club » caché quand le paiement en ligne est imposé', async () => {
    await openPending({ requireOnlinePayment: true, stripeActive: true });
    expect(screen.queryByRole('button', { name: /Régler au club/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Payer en ligne/ })).toBeInTheDocument();
  });

  it('avenue en ligne masquée quand Stripe inactif et paiement non imposé', async () => {
    await openPending({ stripeActive: false, requireOnlinePayment: false });
    expect(screen.queryByRole('button', { name: /Payer en ligne/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Régler au club/ })).toBeInTheDocument();
  });

  it('avenue en ligne visible quand Stripe actif (paiement facultatif)', async () => {
    await openPending({ stripeActive: true });
    expect(screen.getByRole('button', { name: /Payer en ligne/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Régler au club/ })).toBeInTheDocument();
  });

  it('« Ma part » désactivée quand la part < 0,50 € (repli sur le total)', async () => {
    // total 0,40 € → part = 0,10 € < 0,50 € ; capacité padel double = 4 → 0,10 €.
    const tinySlot: TimeSlot = { ...mockSlot, price: '0.40' };
    await openPending({ stripeActive: true, slot: tinySlot });
    fireEvent.click(screen.getByRole('button', { name: /Payer en ligne/ }));
    const share = screen.getByRole('button', { name: /Ma part/ });
    expect(share).toBeDisabled();
    expect(screen.getByText(/trop faible/i)).toBeInTheDocument();
  });

  it('en ligne + « Ma part » → étape Stripe avec payShare=true et le montant par personne', async () => {
    await openPending({ stripeActive: true });
    fireEvent.click(screen.getByRole('button', { name: /Payer en ligne/ }));
    fireEvent.click(screen.getByRole('button', { name: /Ma part/ })); // 40 € / 4 = 10 €
    fireEvent.click(screen.getByRole('button', { name: /^Payer 10€/ }));

    const step = await screen.findByTestId('stripe-step');
    expect(step).toHaveAttribute('data-type', 'payment');
    expect(step).toHaveAttribute('data-payshare', 'true');
    expect(step).toHaveAttribute('data-amount', '10€');
  });

  it('en ligne + « Total » → étape Stripe avec payShare=false et le total', async () => {
    await openPending({ stripeActive: true });
    fireEvent.click(screen.getByRole('button', { name: /Payer en ligne/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Payer 40€/ }));

    const step = await screen.findByTestId('stripe-step');
    expect(step).toHaveAttribute('data-payshare', 'false');
    expect(step).toHaveAttribute('data-amount', '40€');
  });

  it('empreinte requise (sans paiement en ligne) → étape Stripe setup, payShare ignoré', async () => {
    await openPending({ requireCardFingerprint: true, stripeActive: false });
    fireEvent.click(screen.getByRole('button', { name: /Confirmer et payer/ }));

    const step = await screen.findByTestId('stripe-step');
    expect(step).toHaveAttribute('data-type', 'setup');
    expect(step).toHaveAttribute('data-payshare', 'false');
  });

  it('défensif : paiement en ligne imposé mais Stripe inactif → avenue désactivée + note, confirmation bloquée', async () => {
    await openPending({ requireOnlinePayment: true, stripeActive: false });
    expect(screen.getByText(/momentanément indisponible/i)).toBeInTheDocument();
    const onlineBtn = screen.getByRole('button', { name: /Payer en ligne/ });
    expect(onlineBtn).toBeDisabled();
    // Le bouton de confirmation ne déclenche pas l'étape Stripe.
    const confirm = screen.getByRole('button', { name: /Payer 40€|Confirmer/ });
    expect(confirm).toBeDisabled();
    expect(screen.queryByTestId('stripe-step')).not.toBeInTheDocument();
  });
});
