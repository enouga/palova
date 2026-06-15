# Phase 4 — Stripe Connect & Paiement en ligne

**Date :** 2026-06-15  
**Statut :** Approuvé  
**Périmètre :** Paiement CB en ligne à la réservation, empreinte anti-no-show, onboarding Stripe par club

---

## Contexte

Les phases 1-3 ont posé les fondations : `PaymentStatus` (`PENDING/AUTHORIZED/CAPTURED`), `PaymentMethod.ONLINE`, `RefundService`, `AccountingService`. Le schéma était déjà conçu pour accueillir le paiement en ligne. La Phase 4 branche Stripe Connect sur ces fondations.

**Modèle SaaS :** chaque club connecte son propre compte Stripe (Connect Express, direct charges). Palova ne détient aucun fond. Aucune `application_fee_amount` en Phase 4.

---

## Décisions produit

| Décision | Valeur |
|---|---|
| Type de compte Stripe | Express (onboarding hébergé Stripe, KYC délégué) |
| Modèle de charge | Direct charges sur le compte connecté (`{ stripeAccount }`) |
| Qui paye | L'organisateur paye le total ; le split (`ReservationParticipant.share`) reste informatif |
| Paiement obligatoire | Opt-in par club (`requireOnlinePayment`) |
| Empreinte no-show | Opt-in par club (`requireCardFingerprint`), SetupIntent `off_session` |
| Débit no-show | Manuel par l'admin, montant libre |
| Intégration front | Stripe Payment Element embarqué dans le BookingModal (Option A) |
| Remboursement en ligne | Via `RefundService` étendu : appel `stripe.refunds.create` si `stripePaymentIntentId` présent |

---

## Modèle de données

### Nouvelles colonnes `Club`

```prisma
stripeAccountId        String?             @map("stripe_account_id")
stripeAccountStatus    StripeAccountStatus @default(NONE) @map("stripe_account_status")
requireOnlinePayment   Boolean             @default(false) @map("require_online_payment")
requireCardFingerprint Boolean             @default(false) @map("require_card_fingerprint")
```

### Nouvel enum

```prisma
enum StripeAccountStatus {
  NONE        // club n'a pas connecté Stripe
  PENDING     // compte créé, onboarding incomplet
  ACTIVE      // charges_enabled=true
  RESTRICTED  // Stripe a restreint le compte
}
```

### Nouveau modèle `ClubStripeCustomer`

```prisma
model ClubStripeCustomer {
  id                     String   @id @default(cuid())
  clubId                 String   @map("club_id")
  userId                 String   @map("user_id")
  stripeCustomerId       String   @map("stripe_customer_id")
  defaultPaymentMethodId String?  @map("default_payment_method_id")
  createdAt              DateTime @default(now()) @map("created_at")
  updatedAt              DateTime @updatedAt @map("updated_at")

  club Club @relation(fields: [clubId], references: [id], onDelete: Cascade)
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([clubId, userId])
  @@index([clubId])
  @@map("club_stripe_customers")
}
```

Le `Customer` Stripe est créé sur le compte connecté du club (via `{ stripeAccount }`), pas sur le compte plateforme. Cela permet la réutilisation de carte et le débit off-session pour le no-show.

### Nouvelles colonnes `Payment`

```prisma
stripePaymentIntentId String? @map("stripe_payment_intent_id")
stripePaymentMethodId String? @map("stripe_payment_method_id")
```

### Migration

`20260615_add_stripe_connect` — entièrement additive : nouvelles colonnes nullable, `stripeAccountStatus=NONE` par défaut sur tous les clubs existants, nouveau modèle `ClubStripeCustomer`.

---

## Architecture backend

### `backend/src/db/stripe.ts`

Instance Stripe singleton :

```typescript
import Stripe from 'stripe';
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20',
});
```

### `backend/src/services/stripe.service.ts`

Wrapper autour du SDK Stripe. Toutes les opérations sur les comptes connectés passent par `{ stripeAccount: club.stripeAccountId }`.

**Méthodes :**

- `createConnectedAccount(clubId)` → crée un compte Express, sauve `stripeAccountId` + `PENDING`, retourne l'URL d'onboarding
- `refreshOnboardingLink(clubId, refreshUrl, returnUrl)` → crée un nouveau `accountLink` (compte déjà créé)
- `syncAccountStatus(stripeAccountId)` → `stripe.accounts.retrieve` → met à jour `stripeAccountStatus` du club
- `createLoginLink(stripeAccountId)` → `stripe.accounts.createLoginLink` → URL tableau de bord Express
- `createOrGetCustomer(clubId, userId, email)` → upsert `ClubStripeCustomer`, crée le Customer Stripe si absent
- `createPaymentIntent(params)` → PI sur le compte connecté avec `setup_future_usage: 'off_session'`
- `createSetupIntent(params)` → SI sur le compte connecté avec `usage: 'off_session'`
- `chargeNoShow(params: { clubId, userId, amount, reservationId, note? })` → récupère `defaultPaymentMethodId`, crée PI avec `off_session: true, confirm: true`
- `refundPaymentIntent(stripeAccountId, paymentIntentId, amountCents)` → `stripe.refunds.create`

### Routes nouvelles

| Méthode | Route | Auth | Description |
|---|---|---|---|
| `POST` | `/api/clubs/:slug/stripe/connect` | admin | Initier ou reprendre l'onboarding |
| `GET` | `/api/clubs/:slug/stripe/status` | admin | Sync + retourner le statut du compte |
| `GET` | `/api/clubs/:slug/stripe/login-link` | admin | URL tableau de bord Express |
| `POST` | `/api/clubs/:slug/stripe/intent` | joueur | Créer PI ou SI pour une résa |
| `POST` | `/api/clubs/:clubId/admin/reservations/:id/no-show-charge` | admin | Débiter le no-show |
| `POST` | `/api/stripe/webhooks` | public (vérifié par signature) | Réception des événements Stripe |

### `confirmReservation` étendu

Accepte deux champs optionnels dans le body :

```typescript
stripePaymentIntentId?: string
stripeSetupIntentId?: string
```

**Logique ajoutée avant confirmation :**

1. Si `club.requireOnlinePayment && !stripePaymentIntentId` → `403 ONLINE_PAYMENT_REQUIRED`
2. Si `club.requireCardFingerprint && !club.requireOnlinePayment && !stripeSetupIntentId` → `403 CARD_FINGERPRINT_REQUIRED`
3. Si `stripePaymentIntentId` fourni : `stripe.paymentIntents.retrieve(id, { stripeAccount })` → status doit être `succeeded` → sinon `402 PAYMENT_NOT_SUCCEEDED`
4. Si `stripeSetupIntentId` fourni : `stripe.setupIntents.retrieve(id, { stripeAccount })` → status doit être `succeeded` → sinon `402 SETUP_NOT_SUCCEEDED` ; puis sauve `defaultPaymentMethodId` sur `ClubStripeCustomer`
5. Confirmation de la résa (logique existante inchangée)
6. Si PaymentIntent : crée `Payment` avec `method=ONLINE, status=CAPTURED, stripePaymentIntentId, stripePaymentMethodId`

**Note — double flag :** quand les deux flags sont actifs (`requireOnlinePayment=true` ET `requireCardFingerprint=true`), seul le PaymentIntent est requis à la confirmation : `setup_future_usage: 'off_session'` sur le PI sauvegarde automatiquement la carte → pas de SetupIntent séparé. La condition `CARD_FINGERPRINT_REQUIRED` ne se déclenche que si `requireOnlinePayment=false`.

---

## Flux PaymentIntent (paiement CB obligatoire)

```
Joueur                    Frontend              Backend               Stripe
  |                          |                     |                     |
  |-- hold slot -----------→ |                     |                     |
  |                          |-- holdSlot ------→  |                     |
  |                          |← reservationId ---- |                     |
  |                          |                     |                     |
  |                          |-- POST /stripe/intent (type:payment) → |  |
  |                          |                     |-- customers.create → |
  |                          |                     |-- PI.create ------→ |
  |                          |← { clientSecret } - |                     |
  |                          |                     |                     |
  |-- remplit carte ------→  |                     |                     |
  |                          |-- stripe.confirmPayment() -----------→  |
  |                          |← { paymentIntent.status: 'succeeded' } |
  |                          |                     |                     |
  |                          |-- confirmReservation({ stripePaymentIntentId }) →
  |                          |                     |-- PI.retrieve ----→ |
  |                          |                     |← status=succeeded   |
  |                          |                     |-- confirm résa      |
  |                          |                     |-- create Payment    |
  |← confirmation --------- |                     |                     |
```

---

## Flux SetupIntent (empreinte only)

Identique mais avec `type: 'setup'`, `stripe.confirmSetup()`, et au `confirmReservation` : sauvegarde de `defaultPaymentMethodId` sans création de Payment.

---

## Flux no-show (charge manuelle admin)

```
Admin → "Facturer no-show" → modale montant
→ POST /admin/reservations/:id/no-show-charge { amount }
→ backend : récupère ClubStripeCustomer.defaultPaymentMethodId
→ stripe.paymentIntents.create({ customer, payment_method, amount, off_session: true, confirm: true })
→ succès → crée Payment (ONLINE/CAPTURED)
→ erreur Stripe → 402 CARD_DECLINED avec message Stripe
```

---

## Webhooks

**Endpoint :** `POST /api/stripe/webhooks`  
Body brut requis : `express.raw({ type: 'application/json' })` sur cette route uniquement.  
Vérification : `stripe.webhooks.constructEvent(body, sig, STRIPE_WEBHOOK_SECRET)` → 400 si invalide.

| Événement | Action |
|---|---|
| `account.updated` | Si `charges_enabled=true` → `stripeAccountStatus=ACTIVE` ; sinon `RESTRICTED` |
| `payment_intent.succeeded` | Filet : si résa encore `PENDING` → `confirmReservation` |
| `payment_intent.payment_failed` | Log uniquement |
| `setup_intent.succeeded` | Filet : si `defaultPaymentMethodId` manquant → le sauver |

**Idempotence :** chaque handler vérifie l'état courant avant d'agir.

**Dev :** `stripe listen --forward-to localhost:3001/api/stripe/webhooks`  
**Prod :** webhook enregistré dans le dashboard Stripe Palova (platform account), URL `https://api.palova.fr/api/stripe/webhooks`.

---

## Variables d'environnement

```env
# backend/.env (dev)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...   # fourni par stripe listen en dev

# frontend/.env.local (dev)
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

`.env.prod` / `.env.prod.example` : mêmes clés en `sk_live_` / `pk_live_` / `whsec_` prod.  
`docker-compose.prod.yml` : transmettre `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` au backend et `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` au frontend.

---

## Frontend

### `frontend/lib/stripe.ts`

```typescript
import { loadStripe } from '@stripe/stripe-js';
let stripePromise: ReturnType<typeof loadStripe> | null = null;
export const getStripe = () => {
  if (!stripePromise)
    stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);
  return stripePromise;
};
```

### `/admin/settings` — section "Paiement en ligne"

- `stripeAccountStatus === NONE` : bouton "Connecter mon compte Stripe"
- `PENDING` : "Onboarding en cours" + bouton "Reprendre"
- `ACTIVE` : badge vert + lien "Tableau de bord Stripe ↗" + deux toggles actifs :
  - "Exiger le paiement CB à la réservation" (`requireOnlinePayment`)
  - "Enregistrer une empreinte bancaire (protection no-show)" (`requireCardFingerprint`)
- `RESTRICTED` : badge orange "Votre compte Stripe est restreint"
- Toggles désactivés (avec tooltip) si `status !== ACTIVE`

### `BookingModal` — étape `StripePaymentStep`

- Chargée via `dynamic(() => import('./StripePaymentStep'), { ssr: false })`
- Déclenchée après validation des détails si `club.requireOnlinePayment || club.requireCardFingerprint`
- Séquence : appel `/stripe/intent` → mount `<Elements>` avec `clientSecret` → `<PaymentElement>` → bouton "Payer X €" ou "Enregistrer ma carte"
- Erreurs Stripe affichées inline ; le hold reste actif, le joueur peut réessayer
- "Annuler" → `cancelReservation` (hold libéré)

### Planning admin

- `listClubReservations` expose `hasCardFingerprint: boolean` (vrai si `ClubStripeCustomer.defaultPaymentMethodId` non null pour l'organisateur)
- Bloc résa : icône 💳 si `hasCardFingerprint`
- Panneau résa : bouton "Facturer no-show" → modale → appel → toast succès/erreur
- Le Payment créé par no-show s'affiche dans les `PaymentDots` sans modification

### `lib/api.ts` — nouveaux appels

```typescript
initiateStripeConnect(clubSlug)           // POST /clubs/:slug/stripe/connect
getStripeStatus(clubSlug)                 // GET /clubs/:slug/stripe/status
getStripeLoginLink(clubSlug)              // GET /clubs/:slug/stripe/login-link
createStripeIntent(clubSlug, body)        // POST /clubs/:slug/stripe/intent
chargeNoShow(clubId, reservationId, body) // POST /clubs/:clubId/admin/reservations/:id/no-show-charge
```

---

## `RefundService` — extension pour les remboursements en ligne

Dans `RefundService.refund`, si `payment.method === 'ONLINE'` et `payment.stripePaymentIntentId` :

```typescript
await stripe.refunds.create(
  { payment_intent: payment.stripePaymentIntentId, amount: amountCents },
  { stripeAccount: club.stripeAccountId }
);
```

L'appel Stripe HTTP ne peut pas être à l'intérieur d'une transaction Prisma. Ordre : (1) appeler `stripe.refunds.create` **avant** d'ouvrir la transaction DB ; (2) si Stripe échoue → lancer une exception, la DB n'est pas touchée ; (3) si la transaction DB échoue après un refund Stripe réussi → cas rare, loguer le `stripeRefundId` pour réconciliation manuelle via le dashboard Stripe.

---

## Gestion d'erreurs

| Code | Situation |
|---|---|
| `ONLINE_PAYMENT_REQUIRED` | `confirmReservation` sans PI quand requis |
| `CARD_FINGERPRINT_REQUIRED` | `confirmReservation` sans SI quand empreinte requise |
| `PAYMENT_NOT_SUCCEEDED` | PI Stripe non en `succeeded` |
| `SETUP_NOT_SUCCEEDED` | SI Stripe non en `succeeded` |
| `NO_CARD_ON_FILE` | No-show sans `defaultPaymentMethodId` |
| `CARD_DECLINED` | Stripe rejette le débit no-show |
| `STRIPE_NOT_CONFIGURED` | Action nécessitant Stripe sur un club sans compte actif |

---

## Tests

### Backend

**`stripe.service.test.ts`**  
SDK Stripe mocké (`jest.mock('stripe')`). Couvre : `createConnectedAccount`, `createPaymentIntent`, `createSetupIntent`, `chargeNoShow`, `syncAccountStatus`, `refundPaymentIntent`.

**`reservation.service.test.ts` (blocs ajoutés)**
- `confirmReservation` avec PI valide → CONFIRMED + Payment ONLINE créé
- `confirmReservation` sans PI quand `requireOnlinePayment=true` → `ONLINE_PAYMENT_REQUIRED`
- `confirmReservation` avec PI Stripe en `requires_payment_method` → `PAYMENT_NOT_SUCCEEDED`
- `confirmReservation` avec SI valide → pas de Payment, `defaultPaymentMethodId` sauvé

**`stripe.webhook.test.ts`**
- Signature invalide → 400
- `account.updated` `charges_enabled=true` → `stripeAccountStatus=ACTIVE`
- `payment_intent.succeeded` résa PENDING → confirmReservation appelé
- Idempotence : résa déjà CONFIRMED → no-op

**`no-show` (dans `reservation.service.test.ts`)**
- Charge réussie → Payment créé
- Pas d'empreinte → `NO_CARD_ON_FILE`
- Stripe card_declined → `CARD_DECLINED` propagé

### Frontend

**`StripePaymentStep.test.tsx`**  
`@stripe/stripe-js` et `@stripe/react-stripe-js` mockés. Teste : affichage du montant, message d'erreur si `confirmPayment` rejette, appel `confirmReservation` après succès.

**Hors scope :** e2e Stripe réel → testé manuellement avec Stripe CLI + carte `4242 4242 4242 4242`.

---

## Hors périmètre Phase 4

- Frais de plateforme Palova (`application_fee_amount`) → Phase 5
- Paiement des frais d'inscription tournoi/event en ligne → Phase 5
- Apple Pay / Google Pay (supporté par Payment Element sans code supplémentaire, mais non testé)
- Gestion des litiges (disputes) Stripe
- Remboursement automatique en ligne à l'annulation (la Phase 2 fait le recrédit prépayé ; l'extension Stripe — appel `stripe.refunds.create` dans `RefundService` — sera ajoutée à la Phase 2 en complément)
- Dashboard Stripe embarqué (Stripe Connect Embedded Components)
