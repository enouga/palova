import { stripe } from './src/db/stripe';

const acct = 'acct_1TjDI8R4g8ImLQpc';

async function main() {
  // 1) reproduce CURRENT createPaymentIntent params (no APM, no payment_method_types)
  const pi1 = await stripe.paymentIntents.create(
    { amount: 5200, currency: 'eur', setup_future_usage: 'off_session' },
    { stripeAccount: acct },
  );
  console.log('CURRENT-STYLE PI:', JSON.stringify({
    id: pi1.id, status: pi1.status,
    payment_method_types: pi1.payment_method_types,
    automatic_payment_methods: pi1.automatic_payment_methods,
  }));

  // 2) with automatic_payment_methods enabled
  const pi2 = await stripe.paymentIntents.create(
    { amount: 5200, currency: 'eur', setup_future_usage: 'off_session', automatic_payment_methods: { enabled: true } },
    { stripeAccount: acct },
  );
  console.log('APM PI:', JSON.stringify({
    id: pi2.id, status: pi2.status,
    payment_method_types: pi2.payment_method_types,
    automatic_payment_methods: pi2.automatic_payment_methods,
  }));
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
