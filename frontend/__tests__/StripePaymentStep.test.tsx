import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import StripePaymentStep from '@/components/StripePaymentStep';

const mockConfirmPayment = jest.fn();
const mockConfirmSetup = jest.fn();

jest.mock('@/components/ui/atoms', () => ({
  Btn: ({ onClick, children, disabled, variant }: any) => (
    <button onClick={onClick} disabled={disabled}>{children}</button>
  ),
}));

jest.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: any) => <div>{children}</div>,
  PaymentElement: () => <div data-testid="payment-element" />,
  useStripe: () => ({ confirmPayment: mockConfirmPayment, confirmSetup: mockConfirmSetup }),
  useElements: () => ({}),
}));

jest.mock('@/lib/stripe', () => ({
  getStripe: jest.fn().mockResolvedValue(null),
}));

// StripePaymentStep no longer calls api directly — mocked for safety (assetUrl per repo convention).
jest.mock('@/lib/api', () => ({
  api: {
    assetUrl: (path: string) => path,
  },
}));

beforeEach(() => jest.clearAllMocks());

const defaultProps = {
  type: 'payment' as const,
  amountLabel: '25,00 €',
  createIntent: jest.fn().mockResolvedValue({ clientSecret: 'pi_test_secret', stripeAccountId: null }),
  confirm: jest.fn().mockResolvedValue(undefined),
  onSuccess: jest.fn(),
  onCancel: jest.fn(),
};

describe('StripePaymentStep', () => {
  it('affiche le Payment Element et le montant', async () => {
    render(<StripePaymentStep {...defaultProps} />);
    await waitFor(() => expect(screen.getByTestId('payment-element')).toBeInTheDocument());
    expect(screen.getAllByText(/25,00/).length).toBeGreaterThan(0);
  });

  it('appelle confirm puis onSuccess après un paiement réussi', async () => {
    mockConfirmPayment.mockResolvedValue({ paymentIntent: { status: 'succeeded', id: 'pi_abc' }, error: null });
    const confirm = jest.fn().mockResolvedValue(undefined);

    render(<StripePaymentStep {...defaultProps} confirm={confirm} />);
    await waitFor(() => screen.getByText(/Payer/));
    fireEvent.click(screen.getByText(/Payer/));

    await waitFor(() => expect(defaultProps.onSuccess).toHaveBeenCalled());
    expect(confirm).toHaveBeenCalledWith({
      stripePaymentIntentId: 'pi_abc',
      stripeSetupIntentId: undefined,
    });
  });

  it('affiche une erreur si confirmPayment retourne une erreur', async () => {
    mockConfirmPayment.mockResolvedValue({ error: { message: 'Votre carte a été refusée' } });

    render(<StripePaymentStep {...defaultProps} />);
    await waitFor(() => screen.getByText(/Payer/));
    fireEvent.click(screen.getByText(/Payer/));

    await waitFor(() => expect(screen.getByText(/refusée/)).toBeInTheDocument());
    expect(defaultProps.onSuccess).not.toHaveBeenCalled();
  });

  it('affiche "Enregistrer ma carte" en mode setup', async () => {
    const setupProps = {
      ...defaultProps,
      type: 'setup' as const,
      createIntent: jest.fn().mockResolvedValue({ clientSecret: 'seti_secret', stripeAccountId: null }),
    };
    render(<StripePaymentStep {...setupProps} />);
    await waitFor(() => screen.getByText(/Enregistrer/));
    expect(screen.getByText(/Enregistrer ma carte/)).toBeInTheDocument();
  });

  it('appelle onCancel au clic Annuler', async () => {
    render(<StripePaymentStep {...defaultProps} />);
    fireEvent.click(screen.getByText(/Annuler/));
    expect(defaultProps.onCancel).toHaveBeenCalled();
  });
});
