import { loadStripe } from '@stripe/stripe-js';
import { getStripe } from '@/lib/stripe';

jest.mock('@stripe/stripe-js', () => ({
  loadStripe: jest.fn(() => Promise.resolve(null)),
}));

beforeEach(() => (loadStripe as jest.Mock).mockClear());

describe('getStripe (Stripe Connect direct charges)', () => {
  it('initialise Stripe.js avec le compte connecté du club', () => {
    getStripe('acct_test_123');
    expect(loadStripe).toHaveBeenCalledWith(expect.anything(), { stripeAccount: 'acct_test_123' });
  });

  it('sans compte connecté, n\'envoie pas d\'option stripeAccount', () => {
    getStripe(null);
    expect(loadStripe).toHaveBeenCalledWith(expect.anything(), undefined);
  });

  it('mémoïse une instance par compte', () => {
    const a = getStripe('acct_memo');
    const b = getStripe('acct_memo');
    expect(a).toBe(b);
  });
});
