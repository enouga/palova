# Carte enregistrée pré-sélectionnée (1 clic « Payer ») — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quand le joueur a une carte enregistrée par défaut, l'afficher pré-sélectionnée dans le `PaymentElement` partagé pour qu'il clique directement « Payer X € » (réservation + inscriptions tournois/events), avec « utiliser une autre carte » natif.

**Architecture:** Côté backend, les deux méthodes qui créent un `PaymentIntent` (`createPaymentIntent`, `createRegistrationPaymentIntent`) créent en plus une `CustomerSession` Stripe (helper privé partagé `buildCustomerSession`, best-effort) et renvoient son `client_secret`. Les routes le propagent (elles spreadent déjà le retour du service). Côté frontend, `StripePaymentStep` passe `customerSessionClientSecret` aux options d'`Elements` ; le `PaymentElement` affiche alors la carte enregistrée, pré-cochée. Aucune migration, aucun changement de schéma.

**Tech Stack:** Stripe Node SDK `^22.2.1` (`stripe.customerSessions.create`, apiVersion `2026-05-27.dahlia`), `@stripe/react-stripe-js`, Express, Jest (backend + RTL frontend), TypeScript.

**Découverte clé (vérifiée dans les types du SDK installé) :** pour ré-afficher les cartes déjà enregistrées (dont `allow_redisplay = 'unspecified'`) **sans muter le PaymentMethod**, la `CustomerSession` accepte `features.payment_method_allow_redisplay_filters: ['always','limited','unspecified']` en plus de `payment_method_redisplay: 'enabled'`. Accesseur confirmé : `stripe.customerSessions.create(params, { stripeAccount })`.

---

## Fichiers touchés

| Fichier | Rôle |
|---------|------|
| `backend/src/services/stripe.service.ts` | + helper `buildCustomerSession` ; `createPaymentIntent` & `createRegistrationPaymentIntent` renvoient `customerSessionClientSecret` ; `createSetupIntent` & `createRegistrationSetupIntent` renvoient `customerSessionClientSecret: null` |
| `backend/src/services/__tests__/stripe.service.test.ts` | + mock `customerSessions` ; nouveaux cas (CustomerSession créée, dégradation, setup sans session) |
| `backend/src/routes/__tests__/clubs.stripe-intent.routes.test.ts` | + cas « le champ traverse la réponse » |
| `backend/src/routes/__tests__/tournaments.routes.test.ts` | idem |
| `backend/src/routes/__tests__/events.routes.test.ts` | idem |
| `frontend/lib/api.ts` | + `customerSessionClientSecret: string \| null` aux 2 types de réponse |
| `frontend/components/StripePaymentStep.tsx` | state + injection dans les options `Elements` |
| `frontend/__tests__/StripePaymentStep.test.tsx` | mock `Elements` capture `options` ; 2 nouveaux cas |
| `frontend/components/BookingModal.tsx` | createIntent propage le champ |
| `frontend/app/tournois/[id]/page.tsx` | createIntent propage le champ |
| `frontend/app/events/[id]/page.tsx` | createIntent propage le champ |
| `CLAUDE.md` | note d'évolution |

> **Note environnement (mémoire projet) :** couper OneDrive pendant le dev ; si désync, `npm install` + `npx prisma generate`. Aucune migration ici.

---

## Task 1: Backend — `StripeService` crée une CustomerSession sur les PaymentIntents

**Files:**
- Modify: `backend/src/services/stripe.service.ts`
- Test: `backend/src/services/__tests__/stripe.service.test.ts`

- [ ] **Step 1: Ajouter `customerSessions` au mock Stripe du test**

Dans `backend/src/services/__tests__/stripe.service.test.ts`, remplacer la factory du mock `../../db/stripe` (l.24-38) par (ajout de `customerSessions`) :

```ts
jest.mock('../../db/stripe', () => ({
  stripe: {
    accounts: {
      create: jest.fn(),
      retrieve: jest.fn(),
      createLoginLink: jest.fn(),
    },
    accountLinks: { create: jest.fn() },
    customers: { create: jest.fn() },
    customerSessions: { create: jest.fn() },
    paymentIntents: { create: jest.fn(), retrieve: jest.fn() },
    setupIntents:   { create: jest.fn(), retrieve: jest.fn() },
    refunds:        { create: jest.fn() },
    paymentMethods: { retrieve: jest.fn(), detach: jest.fn() },
  },
}));
```

- [ ] **Step 2: Écrire les tests qui échouent**

Dans `describe('createPaymentIntent', ...)`, ajouter deux cas :

```ts
  it('crée une CustomerSession (redisplay + filtres) et renvoie son client_secret', async () => {
    (prisma.clubStripeCustomer.findUnique as jest.Mock).mockResolvedValue({
      id: 'csc-1', stripeCustomerId: 'cus_1', defaultPaymentMethodId: 'pm_saved',
    });
    (prisma.club.findUnique as jest.Mock).mockResolvedValue({
      stripeAccountId: 'acct_1', stripeAccountStatus: 'ACTIVE',
    });
    (stripe.paymentIntents.create as jest.Mock).mockResolvedValue({ client_secret: 'pi_secret_xxx' });
    (stripe.customerSessions.create as jest.Mock).mockResolvedValue({ client_secret: 'cuss_secret' });

    const result = await svc.createPaymentIntent({
      clubId: 'club-1', userId: 'user-1', reservationId: 'resa-1', amountCents: 2500,
    });

    expect(stripe.customerSessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_1',
        components: expect.objectContaining({
          payment_element: expect.objectContaining({
            enabled: true,
            features: expect.objectContaining({
              payment_method_redisplay: 'enabled',
              payment_method_allow_redisplay_filters: ['always', 'limited', 'unspecified'],
            }),
          }),
        }),
      }),
      { stripeAccount: 'acct_1' },
    );
    expect(result.clientSecret).toBe('pi_secret_xxx');
    expect(result.customerSessionClientSecret).toBe('cuss_secret');
  });

  it('renvoie customerSessionClientSecret=null si customerSessions.create échoue (paiement non bloqué)', async () => {
    (prisma.clubStripeCustomer.findUnique as jest.Mock).mockResolvedValue({
      id: 'csc-1', stripeCustomerId: 'cus_1', defaultPaymentMethodId: null,
    });
    (prisma.club.findUnique as jest.Mock).mockResolvedValue({
      stripeAccountId: 'acct_1', stripeAccountStatus: 'ACTIVE',
    });
    (stripe.paymentIntents.create as jest.Mock).mockResolvedValue({ client_secret: 'pi_secret_xxx' });
    (stripe.customerSessions.create as jest.Mock).mockRejectedValue(new Error('stripe down'));

    const result = await svc.createPaymentIntent({
      clubId: 'club-1', userId: 'user-1', reservationId: 'resa-1', amountCents: 2500,
    });

    expect(result.clientSecret).toBe('pi_secret_xxx');
    expect(result.customerSessionClientSecret).toBeNull();
  });
```

Dans `describe('createRegistrationPaymentIntent', ...)`, ajouter :

```ts
  it('crée une CustomerSession et renvoie son client_secret', async () => {
    (prisma.clubStripeCustomer.findUnique as jest.Mock).mockResolvedValue({
      id: 'csc-1', stripeCustomerId: 'cus_1', defaultPaymentMethodId: 'pm_saved',
    });
    (prisma.club.findUnique as jest.Mock).mockResolvedValue({
      stripeAccountId: 'acct_1', stripeAccountStatus: 'ACTIVE',
    });
    (stripe.paymentIntents.create as jest.Mock).mockResolvedValue({ client_secret: 'pi_reg_secret' });
    (stripe.customerSessions.create as jest.Mock).mockResolvedValue({ client_secret: 'cuss_reg' });

    const result = await svc.createRegistrationPaymentIntent({
      clubId: 'club-1', userId: 'user-1', registrationId: 'reg-1',
      kind: 'tournament', amountCents: 2000,
    });

    expect(stripe.customerSessions.create).toHaveBeenCalled();
    expect(result.customerSessionClientSecret).toBe('cuss_reg');
  });
```

Dans `describe('createSetupIntent', ...)`, ajouter :

```ts
  it('ne crée PAS de CustomerSession et renvoie customerSessionClientSecret=null', async () => {
    (prisma.clubStripeCustomer.findUnique as jest.Mock).mockResolvedValue({
      id: 'csc-1', stripeCustomerId: 'cus_1', defaultPaymentMethodId: 'pm_saved',
    });
    (prisma.club.findUnique as jest.Mock).mockResolvedValue({
      stripeAccountId: 'acct_1', stripeAccountStatus: 'ACTIVE',
    });
    (stripe.setupIntents.create as jest.Mock).mockResolvedValue({ client_secret: 'seti_secret_yyy' });

    const result = await svc.createSetupIntent({
      clubId: 'club-1', userId: 'user-1', reservationId: 'resa-1',
    });

    expect(stripe.customerSessions.create).not.toHaveBeenCalled();
    expect(result.customerSessionClientSecret).toBeNull();
  });
```

- [ ] **Step 3: Lancer les tests → échec attendu**

Run: `cd backend && npx jest src/services/__tests__/stripe.service.test.ts`
Expected: FAIL — `result.customerSessionClientSecret` est `undefined` (méthodes pas encore modifiées), et `customerSessions.create` non appelée.

- [ ] **Step 4: Implémenter le helper + brancher les 4 méthodes**

Dans `backend/src/services/stripe.service.ts`, ajouter le helper privé **juste après** `createOrGetCustomer` (après la ligne 82) :

```ts
  /**
   * Crée une CustomerSession pour ré-afficher la carte enregistrée du joueur
   * (pré-sélectionnée) dans le PaymentElement. Le filtre allow_redisplay inclut
   * 'unspecified' pour faire apparaître les cartes déjà enregistrées sans muter
   * le PaymentMethod. Best-effort : tout échec renvoie null → le PaymentElement
   * retombe sur le formulaire vierge, le paiement n'échoue jamais.
   */
  private async buildCustomerSession(
    stripeAccountId: string,
    stripeCustomerId: string,
  ): Promise<string | null> {
    try {
      const cs = await stripe.customerSessions.create(
        {
          customer: stripeCustomerId,
          components: {
            payment_element: {
              enabled: true,
              features: {
                payment_method_redisplay: 'enabled',
                payment_method_allow_redisplay_filters: ['always', 'limited', 'unspecified'],
              },
            },
          },
        },
        { stripeAccount: stripeAccountId },
      );
      return cs.client_secret ?? null;
    } catch {
      return null;
    }
  }
```

Modifier `createPaymentIntent` — signature de retour + fin de corps :

```ts
  async createPaymentIntent(params: {
    clubId: string;
    userId: string;
    reservationId: string;
    amountCents: number;
  }): Promise<{ clientSecret: string; customerSessionClientSecret: string | null }> {
    const club = await prisma.club.findUnique({
      where: { id: params.clubId },
      select: { stripeAccountId: true, stripeAccountStatus: true },
    });
    if (!club?.stripeAccountId || club.stripeAccountStatus !== 'ACTIVE') {
      throw new Error('STRIPE_NOT_CONFIGURED');
    }

    const customer = await this.createOrGetCustomer(params.clubId, params.userId);

    const pi = await stripe.paymentIntents.create(
      {
        amount: params.amountCents,
        currency: 'eur',
        customer: customer.stripeCustomerId,
        setup_future_usage: 'off_session',
        metadata: { reservationId: params.reservationId, clubId: params.clubId },
      },
      { stripeAccount: club.stripeAccountId },
    );

    if (!pi.client_secret) throw new Error('STRIPE_ERROR');
    const customerSessionClientSecret = await this.buildCustomerSession(
      club.stripeAccountId, customer.stripeCustomerId,
    );
    return { clientSecret: pi.client_secret, customerSessionClientSecret };
  }
```

Modifier `createRegistrationPaymentIntent` — signature de retour + fin de corps :

```ts
  async createRegistrationPaymentIntent(params: {
    clubId: string; userId: string; registrationId: string; kind: 'tournament' | 'event'; amountCents: number;
  }): Promise<{ clientSecret: string; customerSessionClientSecret: string | null }> {
    const club = await prisma.club.findUnique({
      where: { id: params.clubId }, select: { stripeAccountId: true, stripeAccountStatus: true },
    });
    if (!club?.stripeAccountId || club.stripeAccountStatus !== 'ACTIVE') throw new Error('STRIPE_NOT_CONFIGURED');
    const customer = await this.createOrGetCustomer(params.clubId, params.userId);
    const pi = await stripe.paymentIntents.create(
      {
        amount: params.amountCents, currency: 'eur', customer: customer.stripeCustomerId,
        setup_future_usage: 'off_session',
        metadata: { [this.regMetaKey(params.kind)]: params.registrationId, clubId: params.clubId },
      },
      { stripeAccount: club.stripeAccountId },
    );
    if (!pi.client_secret) throw new Error('STRIPE_ERROR');
    const customerSessionClientSecret = await this.buildCustomerSession(
      club.stripeAccountId, customer.stripeCustomerId,
    );
    return { clientSecret: pi.client_secret, customerSessionClientSecret };
  }
```

Modifier `createSetupIntent` — signature de retour + valeur de retour :

```ts
  async createSetupIntent(params: {
    clubId: string;
    userId: string;
    reservationId: string;
  }): Promise<{ clientSecret: string; customerSessionClientSecret: string | null }> {
    const club = await prisma.club.findUnique({
      where: { id: params.clubId },
      select: { stripeAccountId: true, stripeAccountStatus: true },
    });
    if (!club?.stripeAccountId || club.stripeAccountStatus !== 'ACTIVE') {
      throw new Error('STRIPE_NOT_CONFIGURED');
    }

    const customer = await this.createOrGetCustomer(params.clubId, params.userId);

    const si = await stripe.setupIntents.create(
      {
        customer: customer.stripeCustomerId,
        usage: 'off_session',
        payment_method_types: ['card'],
        metadata: { reservationId: params.reservationId, clubId: params.clubId },
      },
      { stripeAccount: club.stripeAccountId },
    );

    if (!si.client_secret) throw new Error('STRIPE_ERROR');
    return { clientSecret: si.client_secret, customerSessionClientSecret: null };
  }
```

Modifier `createRegistrationSetupIntent` — signature de retour + valeur de retour :

```ts
  async createRegistrationSetupIntent(params: {
    clubId: string; userId: string; registrationId: string; kind: 'tournament' | 'event';
  }): Promise<{ clientSecret: string; customerSessionClientSecret: string | null }> {
    const club = await prisma.club.findUnique({
      where: { id: params.clubId }, select: { stripeAccountId: true, stripeAccountStatus: true },
    });
    if (!club?.stripeAccountId || club.stripeAccountStatus !== 'ACTIVE') throw new Error('STRIPE_NOT_CONFIGURED');
    const customer = await this.createOrGetCustomer(params.clubId, params.userId);
    const si = await stripe.setupIntents.create(
      {
        customer: customer.stripeCustomerId, usage: 'off_session', payment_method_types: ['card'],
        metadata: { [this.regMetaKey(params.kind)]: params.registrationId, clubId: params.clubId },
      },
      { stripeAccount: club.stripeAccountId },
    );
    if (!si.client_secret) throw new Error('STRIPE_ERROR');
    return { clientSecret: si.client_secret, customerSessionClientSecret: null };
  }
```

- [ ] **Step 5: Lancer les tests → succès**

Run: `cd backend && npx jest src/services/__tests__/stripe.service.test.ts`
Expected: PASS (tous les cas, anciens + nouveaux).

- [ ] **Step 6: Vérifier la compilation TypeScript**

Run: `cd backend && npx tsc --noEmit`
Expected: aucun message (le SDK `^22.2.1` type bien `customerSessions.create` et `payment_method_allow_redisplay_filters`).

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/stripe.service.ts backend/src/services/__tests__/stripe.service.test.ts
git commit -m "feat(paiement): CustomerSession Stripe sur les PaymentIntents (carte enregistrée ré-affichée)"
```

---

## Task 2: Backend — le champ traverse les routes intent (tests de caractérisation)

**Files:**
- Test: `backend/src/routes/__tests__/clubs.stripe-intent.routes.test.ts`
- Test: `backend/src/routes/__tests__/tournaments.routes.test.ts`
- Test: `backend/src/routes/__tests__/events.routes.test.ts`

> Aucun changement de source : les routes font déjà `res.json({ ...result, type, stripeAccountId })`, donc le nouveau champ du service est propagé tel quel. Ces tests le prouvent.

- [ ] **Step 1: Ajouter le cas dans `clubs.stripe-intent.routes.test.ts`**

À la fin du `describe('POST /api/clubs/:slug/stripe/intent — payShare', ...)` :

```ts
  it('propage customerSessionClientSecret renvoyé par le service', async () => {
    mockResa('padel', 'double', 40);
    createPaymentIntent.mockResolvedValueOnce({ clientSecret: 'cs_test', customerSessionClientSecret: 'cuss_x' });

    const res = await request(app).post(url).set('Authorization', `Bearer ${token}`)
      .send({ reservationId: 'res-1', type: 'payment' });

    expect(res.status).toBe(200);
    expect(res.body.customerSessionClientSecret).toBe('cuss_x');
  });
```

- [ ] **Step 2: Ajouter le cas dans `tournaments.routes.test.ts`**

Dans le `describe` du POST `/registrations/:regId/intent` (à côté du test « CONFIRMED DUE ») :

```ts
  it('propage customerSessionClientSecret renvoyé par le service', async () => {
    prismaMock.tournamentRegistration.findUnique.mockResolvedValue({
      captainUserId: 'user-1',
      status: 'CONFIRMED',
      paymentStatus: 'DUE',
      paymentDeadline: new Date(Date.now() + 600_000),
      tournament: { clubId: 'club-1', entryFee: 15, club: { stripeAccountId: 'acct_1' } },
    } as any);
    createRegistrationPaymentIntent.mockResolvedValueOnce({ clientSecret: 'cs_reg_payment', customerSessionClientSecret: 'cuss_reg' });

    const res = await request(app)
      .post('/api/tournaments/tourn-1/registrations/reg-1/intent')
      .set('Authorization', `Bearer ${token1}`);

    expect(res.status).toBe(200);
    expect(res.body.customerSessionClientSecret).toBe('cuss_reg');
  });
```

- [ ] **Step 3: Ajouter le cas dans `events.routes.test.ts`**

Dans le `describe` du POST `/registrations/:regId/intent` (à côté du test « CONFIRMED DUE ») :

```ts
  it('propage customerSessionClientSecret renvoyé par le service', async () => {
    prismaMock.eventRegistration.findUnique.mockResolvedValue({
      userId: 'user-1',
      status: 'CONFIRMED',
      paymentStatus: 'DUE',
      paymentDeadline: new Date(Date.now() + 600_000),
      event: { clubId: 'club-1', price: 12, club: { stripeAccountId: 'acct_1' } },
    } as any);
    createRegistrationPaymentIntent.mockResolvedValueOnce({ clientSecret: 'cs_ev_payment', customerSessionClientSecret: 'cuss_ev' });

    const res = await request(app)
      .post('/api/events/ev-1/registrations/ereg-1/intent')
      .set('Authorization', `Bearer ${token1}`);

    expect(res.status).toBe(200);
    expect(res.body.customerSessionClientSecret).toBe('cuss_ev');
  });
```

- [ ] **Step 4: Lancer les 3 suites → succès**

Run: `cd backend && npx jest src/routes/__tests__/clubs.stripe-intent.routes.test.ts src/routes/__tests__/tournaments.routes.test.ts src/routes/__tests__/events.routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/__tests__/clubs.stripe-intent.routes.test.ts backend/src/routes/__tests__/tournaments.routes.test.ts backend/src/routes/__tests__/events.routes.test.ts
git commit -m "test(paiement): customerSessionClientSecret traverse les routes intent"
```

---

## Task 3: Frontend — types `api.ts` + injection dans les options `Elements`

**Files:**
- Modify: `frontend/lib/api.ts:200` et `:213`
- Modify: `frontend/components/StripePaymentStep.tsx`
- Test: `frontend/__tests__/StripePaymentStep.test.tsx`

- [ ] **Step 1: Faire capturer les `options` par le mock `Elements` + écrire les tests qui échouent**

Dans `frontend/__tests__/StripePaymentStep.test.tsx` :

(a) Ajouter une variable capture (préfixe `mock` obligatoire pour la factory `jest.mock`) sous les autres mocks (après la ligne 6) :

```ts
let mockLastElementsOptions: any = null;
```

(b) Remplacer le mock `@stripe/react-stripe-js` (l.14-19) pour capturer `options` :

```ts
jest.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children, options }: any) => { mockLastElementsOptions = options; return <div>{children}</div>; },
  PaymentElement: () => <div data-testid="payment-element" />,
  useStripe: () => ({ confirmPayment: mockConfirmPayment, confirmSetup: mockConfirmSetup }),
  useElements: () => ({}),
}));
```

(c) Remplacer le `beforeEach` (l.32) pour réinitialiser la capture entre les tests :

```ts
beforeEach(() => { jest.clearAllMocks(); mockLastElementsOptions = null; });
```

(d) Ajouter deux cas dans `describe('StripePaymentStep', ...)` :

```ts
  it('passe customerSessionClientSecret aux options Elements quand fourni', async () => {
    const props = {
      ...defaultProps,
      createIntent: jest.fn().mockResolvedValue({
        clientSecret: 'pi_test_secret', stripeAccountId: null, customerSessionClientSecret: 'cuss_x',
      }),
    };
    render(<StripePaymentStep {...props} />);
    await waitFor(() => expect(screen.getByTestId('payment-element')).toBeInTheDocument());
    expect(mockLastElementsOptions.customerSessionClientSecret).toBe('cuss_x');
  });

  it('omet customerSessionClientSecret des options quand null', async () => {
    render(<StripePaymentStep {...defaultProps} />);
    await waitFor(() => expect(screen.getByTestId('payment-element')).toBeInTheDocument());
    expect(mockLastElementsOptions.customerSessionClientSecret).toBeUndefined();
  });
```

- [ ] **Step 2: Lancer la suite → échec attendu**

Run: `cd frontend && npx jest StripePaymentStep`
Expected: FAIL — le composant ne lit/transmet pas encore `customerSessionClientSecret` (option `undefined` même quand fourni).

- [ ] **Step 3: Étendre les types `api.ts`**

Dans `frontend/lib/api.ts`, ajouter `customerSessionClientSecret: string | null` aux **deux** generics de réponse.

Ligne ~200 (`createStripeIntent`) :

```ts
    request<{ clientSecret: string; type: 'payment' | 'setup'; stripeAccountId: string | null; customerSessionClientSecret: string | null }>(
      `/api/clubs/${slug}/stripe/intent`,
      { method: 'POST', body: JSON.stringify(body) },
      token,
    ),
```

Ligne ~213 (`createRegistrationIntent`) :

```ts
    request<{ clientSecret: string; type: 'payment' | 'setup'; stripeAccountId: string | null; customerSessionClientSecret: string | null }>(
      `/api/${kind}/${eventId}/registrations/${regId}/intent`,
      { method: 'POST' },
      token,
    ),
```

- [ ] **Step 4: Brancher `StripePaymentStep`**

Dans `frontend/components/StripePaymentStep.tsx` :

(a) Étendre le type de retour de `createIntent` dans `interface Props` (l.21) :

```ts
  /** Crée un PaymentIntent ou SetupIntent et renvoie son client_secret + le compte Connect. */
  createIntent: () => Promise<{ clientSecret: string; stripeAccountId: string | null; customerSessionClientSecret?: string | null }>;
```

(b) Dans le composant `StripePaymentStep` (default export), ajouter un state (après `stripeAccountId`, l.87) :

```ts
  const [customerSessionClientSecret, setCustomerSessionClientSecret] = useState<string | null>(null);
```

(c) Renseigner ce state dans l'effet `createIntent().then(...)` (l.91-96) :

```ts
  useEffect(() => {
    props.createIntent()
      .then((r) => {
        setStripeAccountId(r.stripeAccountId ?? null);
        setCustomerSessionClientSecret(r.customerSessionClientSecret ?? null);
        setClientSecret(r.clientSecret);
      })
      .catch(() => setFetchError('Impossible d\'initialiser le paiement.'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
```

(d) Injecter dans les options `Elements` (l.117-118) :

```ts
  return (
    <Elements
      stripe={getStripe(stripeAccountId)}
      options={{ clientSecret, ...(customerSessionClientSecret ? { customerSessionClientSecret } : {}), locale: 'fr' }}
    >
      <StripeForm {...props} />
    </Elements>
  );
```

- [ ] **Step 5: Lancer la suite → succès**

Run: `cd frontend && npx jest StripePaymentStep`
Expected: PASS (anciens cas + 2 nouveaux).

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/api.ts frontend/components/StripePaymentStep.tsx frontend/__tests__/StripePaymentStep.test.tsx
git commit -m "feat(paiement): StripePaymentStep transmet customerSessionClientSecret aux Elements"
```

---

## Task 4: Frontend — propager le champ depuis les 3 callsites `createIntent`

**Files:**
- Modify: `frontend/components/BookingModal.tsx:665`
- Modify: `frontend/app/tournois/[id]/page.tsx:222`
- Modify: `frontend/app/events/[id]/page.tsx:174`

- [ ] **Step 1: `BookingModal.tsx`**

Remplacer (l.665) :

```ts
                          return { clientSecret: r.clientSecret, stripeAccountId: r.stripeAccountId ?? null };
```

par :

```ts
                          return { clientSecret: r.clientSecret, stripeAccountId: r.stripeAccountId ?? null, customerSessionClientSecret: r.customerSessionClientSecret ?? null };
```

- [ ] **Step 2: `app/tournois/[id]/page.tsx`**

Remplacer (l.222) :

```ts
                  return { clientSecret: r.clientSecret, stripeAccountId: r.stripeAccountId };
```

par :

```ts
                  return { clientSecret: r.clientSecret, stripeAccountId: r.stripeAccountId, customerSessionClientSecret: r.customerSessionClientSecret ?? null };
```

- [ ] **Step 3: `app/events/[id]/page.tsx`**

Remplacer (l.174) :

```ts
                  return { clientSecret: r.clientSecret, stripeAccountId: r.stripeAccountId };
```

par :

```ts
                  return { clientSecret: r.clientSecret, stripeAccountId: r.stripeAccountId, customerSessionClientSecret: r.customerSessionClientSecret ?? null };
```

- [ ] **Step 4: Vérifier les suites des callsites + TypeScript**

Run: `cd frontend && npx jest BookingModal.payment TournamentDetail EventDetail`
Expected: PASS (les mocks `api.createStripeIntent`/`createRegistrationIntent` ne renvoient pas le champ → `?? null` s'applique, aucun changement de comportement observable).

Run: `cd frontend && npx tsc --noEmit`
Expected: aucun message.

> **Note (mémoire projet) :** ne PAS valider par `npx jest` complet — la suite frontend complète présente un flake d'isolation connu (~6 échecs `BookingModal`). Valider par suites ciblées + `tsc`.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/BookingModal.tsx "frontend/app/tournois/[id]/page.tsx" "frontend/app/events/[id]/page.tsx"
git commit -m "feat(paiement): propage customerSessionClientSecret aux 3 tunnels de paiement"
```

---

## Task 5: Documentation + vérification finale

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Ajouter une note d'évolution dans `CLAUDE.md`**

À la fin de la section « Paiement en ligne des inscriptions (tournois & events) (v1) » (ou juste après la sous-section « Mon compte — … méthodes de paiement »), ajouter :

```markdown
> **Évolution (2026-06-30) — carte enregistrée pré-sélectionnée (1 clic « Payer ») :** quand le joueur a une carte par défaut sur le club, le `PaymentElement` partagé (`StripePaymentStep`) l'affiche **pré-cochée** ; un seul clic « Payer X € » suffit (3DS géré par `confirmPayment`), et Stripe propose nativement « utiliser une autre carte ». Mécanisme : `StripeService.createPaymentIntent`/`createRegistrationPaymentIntent` créent en plus une **`CustomerSession`** (helper privé `buildCustomerSession`, **best-effort** → `customerSessionClientSecret: null` si Stripe échoue, jamais bloquant) avec `payment_element.features.payment_method_redisplay: 'enabled'` + `payment_method_allow_redisplay_filters: ['always','limited','unspecified']` (ré-affiche les cartes `unspecified` **sans muter le PaymentMethod**). Les `SetupIntent` renvoient `customerSessionClientSecret: null` (ils ne tournent que sans carte au dossier). Les routes `/stripe/intent` & `/registrations/:id/intent` spreadent déjà le retour du service → champ propagé ; front : `api.ts` (types) → `StripePaymentStep` (options `Elements`) → 3 callsites `createIntent` (BookingModal + `/tournois/[id]` + `/events/[id]`). Aucune migration. Tests : `stripe.service.test.ts`, route tests intent (×3), `StripePaymentStep.test.tsx`. Spec & plan : `docs/superpowers/{specs,plans}/2026-06-30-carte-enregistree-preselectionnee*`.
```

- [ ] **Step 2: Vérification finale groupée (backend)**

Run: `cd backend && npx jest src/services/__tests__/stripe.service.test.ts src/routes/__tests__/clubs.stripe-intent.routes.test.ts src/routes/__tests__/tournaments.routes.test.ts src/routes/__tests__/events.routes.test.ts && npx tsc --noEmit`
Expected: toutes les suites PASS, tsc silencieux.

- [ ] **Step 3: Vérification finale groupée (frontend)**

Run: `cd frontend && npx jest StripePaymentStep BookingModal.payment TournamentDetail EventDetail && npx tsc --noEmit`
Expected: toutes les suites PASS, tsc silencieux.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(paiement): note d'évolution carte enregistrée pré-sélectionnée"
```

---

## Self-Review (rempli par l'auteur du plan)

- **Couverture spec :** CustomerSession sur PaymentIntents (Task 1) ; filtre `allow_redisplay` sans mutation (Task 1) ; dégradation best-effort (Task 1) ; SetupIntents → null (Task 1) ; propagation routes (Task 2) ; types api + Elements (Task 3) ; 3 callsites partout — réservation + tournois/events (Task 4) ; « pas de carte = comportement actuel » couvert par le cas « options omet le champ quand null » (Task 3) + `?? null` (Task 4). ✅
- **Placeholders :** aucun — chaque étape contient le code exact. ✅
- **Cohérence des types :** `customerSessionClientSecret: string | null` (backend & api.ts), optionnel (`?`) sur `Props.createIntent` de `StripePaymentStep` ; helper `buildCustomerSession(stripeAccountId, stripeCustomerId)` appelé avec les deux mêmes args partout. ✅
