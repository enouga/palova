# Carte enregistrée pré-sélectionnée au paiement en ligne (1 clic « Payer »)

> Design — 2026-06-30

## Problème

Tous les paiements CB en ligne (réservation de terrain via `BookingModal` **et**
inscriptions payantes tournois/events via `/tournois/[id]` & `/events/[id]`) passent
par le composant partagé `frontend/components/StripePaymentStep.tsx`, qui monte le
`PaymentElement` de Stripe **sans `CustomerSession`** :

```ts
<Elements stripe={getStripe(stripeAccountId)} options={{ clientSecret, locale: 'fr' }}>
```

Conséquence : même quand le joueur a déjà une carte au dossier
(`ClubStripeCustomer.defaultPaymentMethodId` + `cardBrand`/`cardLast4`/`cardExpMonth`/
`cardExpYear` sont stockés), le formulaire est **vierge** et il doit **re-saisir sa
carte à chaque fois**. On veut : si une carte est déjà enregistrée par défaut, elle
est **pré-sélectionnée** et le joueur clique directement **« Payer X € »** sans avoir
à re-saisir ni à choisir explicitement la carte.

## Objectif

Quand le joueur a une carte enregistrée par défaut sur le club :
- elle s'affiche **pré-cochée** dans le `PaymentElement` ;
- un seul clic **« Payer X € »** déclenche le paiement (3DS géré si nécessaire) ;
- Stripe propose **nativement** « utiliser une autre carte » (pas de chooser maison) ;
- comportement appliqué **partout** : réservation + inscriptions tournois/events
  (tout passe par `StripePaymentStep`).

Quand il n'y a **pas** de carte au dossier : comportement **identique à aujourd'hui**
(formulaire vierge).

## Approche retenue : `CustomerSession` + `PaymentElement` natif

Mécanisme Stripe officiel pour ré-afficher une carte enregistrée dans le
`PaymentElement` (docs Stripe « Save and reuse payment methods » / « existing customers ») :

1. Côté serveur, créer une **`CustomerSession`** liée au customer, avec le composant
   `payment_element` et la feature `payment_method_redisplay: 'enabled'`, et renvoyer
   son `client_secret` au client.
2. Par défaut, le `PaymentElement` n'affiche que les cartes dont `allow_redisplay = 'always'`.
   Les cartes sauvées précédemment via `setup_future_usage`/SetupIntent ont
   `allow_redisplay = 'unspecified'`. Pour les ré-afficher **sans muter le PaymentMethod**,
   on élargit le filtre de la `CustomerSession` :
   `features.payment_method_allow_redisplay_filters = ['always', 'limited', 'unspecified']`
   (voie documentée Stripe « include payment methods where allow_redisplay=unspecified » ;
   consentement déjà obtenu lors de l'enregistrement off-session de la carte).
3. Côté client, passer `customerSessionClientSecret` dans les options d'`Elements` :
   `stripe.elements({ clientSecret, customerSessionClientSecret })`.

La `CustomerSession` se crée sur le **compte connecté** via l'en-tête `Stripe-Account`
(option `{ stripeAccount }` du SDK), exactement comme `createOrGetCustomer` crée déjà
le customer.

### Pourquoi pas un panneau maison (approche écartée)
Une alternative consistait à afficher notre propre ligne « Visa •••• 4242 — Payer 25 € »
+ un endpoint `payment_method=default, confirm:true` on-session avec gestion 3DS via
`stripe.handleNextAction`. Écartée : beaucoup plus de surface (nouvel endpoint, UI,
gestion 3DS côté client, tests) pour reproduire ce que le `PaymentElement` fait déjà.
La `CustomerSession` garde **un seul chemin `confirmPayment`** et offre « autre carte »
gratuitement.

## Changements backend (`backend/src/services/stripe.service.ts` + routes)

### `StripeService`

- **`createPaymentIntent`** et **`createRegistrationPaymentIntent`** : après avoir créé
  le PaymentIntent (inchangé), créer une `CustomerSession` via un helper privé partagé
  `buildCustomerSession(stripeAccountId, stripeCustomerId)` :
  ```ts
  const cs = await stripe.customerSessions.create(
    { customer: stripeCustomerId,
      components: { payment_element: {
        enabled: true,
        features: {
          payment_method_redisplay: 'enabled',
          payment_method_allow_redisplay_filters: ['always', 'limited', 'unspecified'],
        } } } },
    { stripeAccount: stripeAccountId });
  return cs.client_secret ?? null;
  ```
  et renvoyer `{ clientSecret, customerSessionClientSecret }`.
  - **Dégradation** : `buildCustomerSession` enveloppe l'appel en `try/catch` et renvoie
    `null` à tout échec → le paiement continue (formulaire vierge). Le paiement n'échoue
    **jamais** à cause de cette feature. (Pas de mutation de PaymentMethod : le filtre
    `payment_method_allow_redisplay_filters` suffit à ré-afficher les cartes `unspecified`.)

- **`createSetupIntent`** et **`createRegistrationSetupIntent`** : inchangées sur le fond ;
  renvoient `customerSessionClientSecret: null` pour uniformiser la forme. (Ces flux ne
  tournent que lorsqu'aucune carte n'est au dossier — empreinte no-show gated par
  `!hasCardOnFile`, enregistrement de carte waitlist — donc rien à ré-afficher.)

### Routes

`backend/src/routes/clubs.ts` (`/api/clubs/:slug/stripe/intent`),
`backend/src/routes/tournaments.ts` et `backend/src/routes/events.ts`
(`/registrations/:regId/intent`) **spreadent déjà** le retour du service
(`...result` / `...r`), donc le nouveau champ passe automatiquement. Forme de réponse :
`{ clientSecret, type, stripeAccountId, customerSessionClientSecret }`.

### Migration
**Aucune** — pas de changement de schéma.

## Changements frontend

- **`frontend/lib/api.ts`** : ajouter `customerSessionClientSecret: string | null` aux
  types de réponse de `stripeIntent` (l.~200) et `createRegistrationIntent` (l.~213).

- **`frontend/components/StripePaymentStep.tsx`** :
  - `Props.createIntent` renvoie aussi `customerSessionClientSecret?: string | null` ;
  - stocker la valeur en state (à côté de `clientSecret`/`stripeAccountId`) ;
  - passer aux options : `options={{ clientSecret, customerSessionClientSecret: cscs ?? undefined, locale: 'fr' }}`.
  - Le reste est **inchangé** : `confirmPayment({ elements, redirect: 'if_required' })`
    gère la carte sélectionnée + 3DS, et le bouton « Payer X € » ne bouge pas.

- **`frontend/components/BookingModal.tsx`** (createIntent l.~658) et
  **`frontend/app/tournois/[id]/page.tsx`** / **`frontend/app/events/[id]/page.tsx`**
  (createIntent) : propager `customerSessionClientSecret` depuis l'appel API
  (one-liner chacun).

## Comportement résultant

| Situation | Résultat |
|-----------|----------|
| Carte enregistrée par défaut | Carte **pré-cochée**, clic « Payer X € », 3DS si besoin, « autre carte » natif |
| Aucune carte | Formulaire vierge — **identique à aujourd'hui** |
| `customerSessions.create` échoue | `null` → formulaire vierge, paiement OK (dégradation) |
| Empreinte / setup waitlist | Inchangé (tourne sans carte au dossier) |
| CVC | Pas de recollection forcée (défaut Stripe) → 1-clic tient |

## Tests

### Backend (`backend/src/services/__tests__/stripe.service.test.ts`)
- `createPaymentIntent` (et `createRegistrationPaymentIntent`) :
  - appelle `customerSessions.create` avec `payment_method_redisplay: 'enabled'`,
    `payment_method_allow_redisplay_filters: ['always','limited','unspecified']` et
    l'en-tête `{ stripeAccount }` ;
  - renvoie `customerSessionClientSecret` ;
  - gracieux : si `customerSessions.create` jette → renvoie `customerSessionClientSecret: null`
    sans propager l'erreur (le `clientSecret` du PaymentIntent reste valide).
- `createSetupIntent` / `createRegistrationSetupIntent` : renvoient
  `customerSessionClientSecret: null` et **n'appellent pas** `customerSessions.create`.
- Routes (`clubs.stripe-intent.routes.test.ts`, `tournaments.routes.test.ts`,
  `events.routes.test.ts`) : le champ `customerSessionClientSecret` traverse la réponse.

### Frontend (`frontend/__tests__/StripePaymentStep.test.tsx`)
- Quand `createIntent` renvoie `customerSessionClientSecret`, il est injecté dans les
  options d'`Elements` ;
- quand `null`/absent, l'option est absente (`undefined`).

## Hors périmètre
- Ajout / suppression de carte depuis le tunnel de paiement (reste sur `/me/profile`).
- Recollection CVC.
- Vue multi-clubs des cartes.
- Changement des flux `setup` (empreinte no-show, carte waitlist) au-delà du champ
  `customerSessionClientSecret: null` ajouté pour uniformité.
