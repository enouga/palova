import Stripe from 'stripe';

// `||` (et non `??`) : on retombe sur le placeholder aussi quand la variable est une
// chaîne VIDE — docker-compose passe `""` quand .env.prod ne définit pas la clé, et
// `new Stripe("")` crashe au chargement du module. Voir test de régression.
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
  apiVersion: '2026-05-27.dahlia',
});
