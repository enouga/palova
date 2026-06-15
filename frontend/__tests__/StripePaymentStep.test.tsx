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

jest.mock('next/dynamic', () => {
  // Track call count: first call = Elements, second call = PaymentElement
  let callCount = 0;
  return (importFn: () => Promise<any>, options?: any) => {
    callCount += 1;
    const mod = require('@stripe/react-stripe-js');
    if (options && options.ssr === false) {
      const exportName = callCount === 1 ? 'Elements' : 'PaymentElement';
      return mod[exportName];
    }
    return mod;
  };
});

jest.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: any) => <div>{children}</div>,
  PaymentElement: () => <div data-testid="payment-element" />,
  useStripe: () => ({ confirmPayment: mockConfirmPayment, confirmSetup: mockConfirmSetup }),
  useElements: () => ({}),
}));

jest.mock('@/lib/stripe', () => ({
  getStripe: jest.fn().mockResolvedValue(null),
}));

jest.mock('@/lib/api', () => ({
  api: {
    createStripeIntent: jest.fn().mockResolvedValue({ clientSecret: 'pi_test_secret', type: 'payment' }),
    confirmReservation: jest.fn().mockResolvedValue({ id: 'r-1', status: 'CONFIRMED' }),
  },
}));

import { api } from '@/lib/api';

beforeEach(() => jest.clearAllMocks());

const defaultProps = {
  reservationId: 'r-1',
  slug: 'test-club',
  clubId: 'club-1',
  type: 'payment' as const,
  amountLabel: '25,00 €',
  token: 'tok-1',
  onSuccess: jest.fn(),
  onCancel: jest.fn(),
};

describe('StripePaymentStep', () => {
  it('affiche le Payment Element et le montant', async () => {
    render(<StripePaymentStep {...defaultProps} />);
    await waitFor(() => expect(screen.getByTestId('payment-element')).toBeInTheDocument());
    expect(screen.getAllByText(/25,00/).length).toBeGreaterThan(0);
  });

  it('appelle onSuccess après un paiement réussi', async () => {
    mockConfirmPayment.mockResolvedValue({ paymentIntent: { status: 'succeeded', id: 'pi_abc' }, error: null });
    (api.confirmReservation as jest.Mock).mockResolvedValue({ id: 'r-1', status: 'CONFIRMED' });

    render(<StripePaymentStep {...defaultProps} />);
    await waitFor(() => screen.getByText(/Payer/));
    fireEvent.click(screen.getByText(/Payer/));

    await waitFor(() => expect(defaultProps.onSuccess).toHaveBeenCalled());
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
    render(<StripePaymentStep {...defaultProps} type="setup" />);
    await waitFor(() => screen.getByText(/Enregistrer/));
    expect(screen.getByText(/Enregistrer ma carte/)).toBeInTheDocument();
  });

  it('appelle onCancel au clic Annuler', async () => {
    render(<StripePaymentStep {...defaultProps} />);
    fireEvent.click(screen.getByText(/Annuler/));
    expect(defaultProps.onCancel).toHaveBeenCalled();
  });
});
