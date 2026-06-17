// Régression : une variable STRIPE_SECRET_KEY VIDE ("") ne doit pas faire crasher
// le boot du backend. Avant le fix, `new Stripe(process.env.STRIPE_SECRET_KEY ?? 'sk_test_placeholder')`
// utilisait `??` qui ne capte QUE null/undefined : une chaîne vide passait telle quelle à
// `new Stripe("")` → throw "Neither apiKey nor config.authenticator provided" au chargement
// du module → crash-loop du conteneur → 502 sur toute l'API (incident prod 2026-06-17).
describe('db/stripe — robustesse de la clé secrète', () => {
  const ORIGINAL = process.env.STRIPE_SECRET_KEY;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = ORIGINAL;
    jest.resetModules();
  });

  it('ne crashe pas et expose un client quand STRIPE_SECRET_KEY est une chaîne vide', () => {
    process.env.STRIPE_SECRET_KEY = '';
    let mod: { stripe: unknown } | undefined;
    expect(() => {
      jest.isolateModules(() => {
        mod = require('../stripe') as { stripe: unknown };
      });
    }).not.toThrow();
    expect(mod?.stripe).toBeDefined();
  });

  it('ne crashe pas quand STRIPE_SECRET_KEY est absent', () => {
    delete process.env.STRIPE_SECRET_KEY;
    expect(() => {
      jest.isolateModules(() => {
        require('../stripe');
      });
    }).not.toThrow();
  });
});
