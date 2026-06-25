# Paiement en ligne obligatoire des inscriptions (tournois & events)

**Date :** 2026-06-25
**Statut :** design validé

## Contexte

Aujourd'hui, les frais d'inscription sont **purement informatifs** : `Tournament.entryFee`
et `ClubEvent.price` sont stockés et affichés, mais l'inscription (`TournamentService.register`
/ `EventService.register`) ne déclenche **aucun paiement**. Les inscriptions sont gratuites côté
flux technique.

L'infrastructure de paiement en ligne existe déjà pour les **réservations de terrain** :

- **Stripe Connect (comptes Express par club)** — `Club.stripeAccountId` /
  `stripeAccountStatus` (`NONE | PENDING | ACTIVE | RESTRICTED`).
- `StripeService.createPaymentIntent` / `createSetupIntent` (metadata `{ reservationId, clubId }`,
  renvoie `clientSecret`), `chargeNoShow` (débit **off-session** via la carte enregistrée
  `ClubStripeCustomer.defaultPaymentMethodId`), `refundPaymentIntent`.
- Webhook `stripe-webhooks.ts` : `payment_intent.succeeded` → `confirmReservation`,
  `setup_intent.succeeded` → enregistre `defaultPaymentMethodId`, `account.updated` → statut.
- Modèle `Payment` (`method = ONLINE`, `stripePaymentIntentId`, `refundedAmount`, `status`,
  FK nullables `reservationId`/`participantId`/`memberPackageId`), `RefundService.refund`
  (remboursement ONLINE → Stripe + ligne `Refund`).
- Réglage club `requireOnlinePayment` pour les réservations ; page admin dédiée
  `/admin/payments` (cf. `2026-06-25-admin-paiement-en-ligne-stripe-design.md`).

Côté inscriptions, `register()` tourne en transaction **Serializable + `FOR UPDATE`** sur la ligne
tournoi/event, décide **`CONFIRMED` ou `WAITLISTED`** selon la capacité, et **promeut
automatiquement** le 1er `WAITLISTED` quand une place se libère (`cancelAndPromoteTx`). Les emails
(inscription / liste d'attente / désinscription / promotion) partent **après commit**, best-effort
via `safeNotify`.

## Objectif

Permettre qu'une inscription à un **tournoi** ou un **event** exige un **règlement en ligne par
CB** (Stripe), au choix du club, **épreuve par épreuve**, en réutilisant l'infra Stripe Connect
existante — **sans jamais encaisser quelqu'un qui n'a pas de place**.

## Décisions validées (brainstorming)

1. **Périmètre** : tournois **et** events, activable **par épreuve** (case « Inscription à régler
   en ligne »). Montant = `entryFee` (équipe, tournoi) / `price` (event).
2. **Verrou club (contrainte explicite)** : la case n'est disponible **que si le club a activé le
   paiement en ligne** dans son admin, c.-à-d. `club.stripeAccountStatus === 'ACTIVE'`. Sinon, pas
   de paiement en ligne — la case est désactivée et l'inscription reste gratuite/informative.
3. **Liste d'attente** : on encaisse **uniquement une place confirmée**. Complet → liste d'attente
   **gratuite**, carte enregistrée (SetupIntent). À la **promotion auto**, débit **off-session**
   (mécanisme `chargeNoShow`) ; **échec carte → on promeut le suivant + notif**.
4. **Tournoi (binôme)** : le **capitaine paie l'`entryFee` de l'équipe** en une fois ;
   l'inscription se confirme immédiatement.
5. **Remboursement** : **auto avant `registrationDeadline`** (désinscription) ; après la clôture,
   plus de remboursement auto (l'admin peut rembourser à la main via `RefundService`).
6. **Tenue de la place pendant le paiement** : approche **« inscription confirmée provisoire avec
   délai de paiement »** (état `DUE` + `paymentDeadline`), calquée sur le pattern
   `Reservation` PENDING + `cleanup.job`. (Alternatives rejetées : « payer puis inscrire » =
   course sur la dernière place + remboursement forcé ; « autorisation Stripe » = l'empreinte
   expire en 7 j alors que les clôtures sont à plusieurs semaines.)

## Architecture

### 1. Verrou côté club & activation par épreuve

- `/admin/tournaments` et `/admin/events` : case **« Inscription à régler en ligne »**
  (`requirePrepayment`). **Activable seulement si `club.stripeAccountStatus === 'ACTIVE'`** ;
  sinon désactivée + libellé « Activez d'abord le paiement en ligne dans *Paiement en ligne* → »
  (lien vers `/admin/payments`).
- **Garde-fou backend** dans `TournamentService.update` / `EventService.update` : passer
  `requirePrepayment = true` est refusé (`ONLINE_PAYMENT_NOT_ENABLED`, 409) si :
  - le club n'a pas `stripeAccountStatus === 'ACTIVE'`, **ou**
  - le montant (`entryFee` / `price`) est nul ou `< 0,50 €` (minimum Stripe).
- **Dégradation** : si le Stripe d'un club redevient inactif alors qu'une épreuve a
  `requirePrepayment = true`, la création d'intent échoue (`STRIPE_NOT_CONFIGURED`) → l'inscription
  est **bloquée** avec un message clair (jamais inscrite sans paiement).

### 2. Données (migration additive `add_registration_online_payment`, zéro renommage)

```prisma
enum RegistrationPaymentStatus { NONE  DUE  PAID  REFUNDED }

model Tournament {
  // …
  requirePrepayment Boolean @default(false) @map("require_prepayment")
}
model ClubEvent {
  // …
  requirePrepayment Boolean @default(false) @map("require_prepayment")
}

model TournamentRegistration {
  // …
  paymentStatus   RegistrationPaymentStatus @default(NONE) @map("payment_status")
  paymentDeadline DateTime?                 @map("payment_deadline") @db.Timestamptz
  payments        Payment[]
}
model EventRegistration {
  // …
  paymentStatus   RegistrationPaymentStatus @default(NONE) @map("payment_status")
  paymentDeadline DateTime?                 @map("payment_deadline") @db.Timestamptz
  payments        Payment[]
}

model Payment {
  // …
  tournamentRegistrationId String? @map("tournament_registration_id")
  eventRegistrationId      String? @map("event_registration_id")
  tournamentRegistration   TournamentRegistration? @relation(fields: [tournamentRegistrationId], references: [id], onDelete: SetNull)
  eventRegistration        EventRegistration?      @relation(fields: [eventRegistrationId], references: [id], onDelete: SetNull)
  @@index([tournamentRegistrationId])
  @@index([eventRegistrationId])
}
```

Deux FK nullables sur `Payment` = **même pattern** que les `reservationId?`/`participantId?`/
`memberPackageId?` existants. `method = ONLINE` et `stripePaymentIntentId` réutilisés tels quels.

**Sémantique de `paymentStatus`** :
- `NONE` — épreuve gratuite (`requirePrepayment = false`) : comportement actuel, intact.
- `DUE` — paiement attendu, non finalisé.
  - `CONFIRMED + DUE + paymentDeadline > now` → **occupe la place** (fenêtre de paiement).
  - `WAITLISTED + DUE + paymentDeadline = null` → en attente, carte enregistrée, débitée à la promotion.
- `PAID` — réglé.
- `REFUNDED` — remboursé.

### 3. Flux backend — place confirmée

1. `register()` garde sa transaction Serializable + `FOR UPDATE`. Le **comptage de capacité** passe
   de « `CONFIRMED` » à « inscriptions occupant une place » =
   `status = CONFIRMED AND (paymentStatus IN (PAID, NONE) OR (paymentStatus = DUE AND paymentDeadline > now))`.
   C'est le miroir du comptage de conflits réservation (CONFIRMED + PENDING récents). Les `DUE`
   expirées ne comptent pas. Pour une épreuve gratuite (tout `NONE`), le comptage est identique à
   aujourd'hui.
2. Épreuve payante + place dispo → ligne créée `CONFIRMED` + `paymentStatus = DUE` +
   `paymentDeadline = now + HOLD_MINUTES` (**15 min**). Elle tient la place. **Pas de notif** à ce
   stade (la notif d'inscription part au paiement confirmé).
3. La réponse `register()` indique au front : `{ registration, payment: { mode: 'payment' } }`.
   Le front appelle `createRegistrationIntent` (PaymentIntent, montant = `entryFee` / `price` en
   centimes, metadata `{ tournamentRegistrationId | eventRegistrationId, clubId }`) puis confirme
   via Stripe Elements.
4. `confirmRegistrationPayment(regId, { stripePaymentIntentId })` : `DUE → PAID` via `updateMany`
   **conditionnel** (`where: { id, paymentStatus: 'DUE' }`, `count === 0` ⇒ déjà fait → no-op),
   crée le `Payment` (`method = ONLINE`, FK reg, `stripePaymentIntentId`), **puis** `safeNotify`
   (inscription confirmée). **Idempotent** (client + webhook).

### 4. Flux backend — liste d'attente + promotion

- Complet → ligne `WAITLISTED` + `paymentStatus = DUE` + `paymentDeadline = null` (le job
  n'y touche jamais). Réponse `{ registration, payment: { mode: 'setup' } }` → le front enregistre
  la carte via **SetupIntent** (renseigne `ClubStripeCustomer.defaultPaymentMethodId`). **Aucun
  débit.** Notif « liste d'attente » comme aujourd'hui.
- **Promotion** (`cancelAndPromoteTx`) — quand une place se libère :
  - Épreuve gratuite → promotion directe `CONFIRMED` (`NONE`), inchangée.
  - Épreuve payante → le promu passe `CONFIRMED` + `DUE` + `paymentDeadline = now + HOLD_MINUTES`
    **dans la transaction** ; le helper renvoie l'id du promu **et un drapeau « à débiter »**.
  - **Après commit** (best-effort, hors transaction), `chargePromotedRegistration(regId)` :
    débit **off-session** via la carte enregistrée (méthode type `chargeNoShow`).
    - succès → `PAID` + crée `Payment` + notif « place confirmée et débitée » ;
    - échec (`card_declined` / `authentication_required` / pas de carte) → inscription
      `CANCELLED`, **on promeut le suivant** (nouveau cycle cancel+promote) + notif au joueur
      « carte refusée, place non confirmée ».
  - Le `paymentDeadline` du promu est un **filet** : si le serveur tombe entre commit et débit, le
    `cleanup.job` libère la ligne et promeut le suivant.

> ⚠️ Le débit Stripe est **hors transaction DB** (appel réseau long). La transaction de promotion
> ne fait que poser l'état `DUE` ; le débit et ses conséquences (succès/échec→suivant) sont des
> opérations post-commit, chacune transactionnelle.

### 5. Webhook Stripe (`stripe-webhooks.ts`)

- `payment_intent.succeeded` : router sur `metadata.tournamentRegistrationId` /
  `eventRegistrationId` → `confirmRegistrationPayment` ; sinon `reservationId` (comportement
  actuel). Double chemin client + webhook, tous deux idempotents.
- `setup_intent.succeeded` : si la metadata porte un id d'inscription → enregistre
  `defaultPaymentMethodId` pour `(clubId, userId)` (réutilise la branche `updateMany` existante).

### 6. Service Stripe & routes (additif)

- `StripeService` : `createRegistrationPaymentIntent({ clubId, userId, registrationId, kind, amountCents })`
  et `createRegistrationSetupIntent({ clubId, userId, registrationId, kind })` — mêmes corps que les
  variantes réservation, metadata `{ [kind === 'tournament' ? 'tournamentRegistrationId' : 'eventRegistrationId']: registrationId, clubId }`.
  `chargeRegistrationOffSession({ clubId, userId, registrationId, kind, amountCents })` (miroir de
  `chargeNoShow`).
- Routes (montées sous `authMiddleware`, club résolu par slug comme l'existant) :
  - `POST /api/tournaments/:id/register` / `POST /api/events/:id/register` — renvoient désormais
    `{ registration, payment: { mode: 'payment' | 'setup' } | null }` (null = gratuit).
  - `POST /api/tournaments/registrations/:regId/intent` / `…/events/registrations/:regId/intent`
    → `{ clientSecret, stripeAccountId }` (type payment ou setup selon le statut de la ligne ;
    garde : ligne appartient à l'appelant, `DUE`, non expirée).
  - `POST /api/tournaments/registrations/:regId/confirm-payment` /
    `…/events/registrations/:regId/confirm-payment` → `confirmRegistrationPayment` (chemin client).

### 7. Job de nettoyage (`cleanup.job.ts`)

Étendre le job existant (qui libère déjà les `Reservation` PENDING expirées) : libérer les
inscriptions `status = CONFIRMED AND paymentStatus = DUE AND paymentDeadline < now`
(paiement initial non finalisé) → `CANCELLED` + promotion du suivant via le même chemin que
l'annulation. Les `WAITLISTED + DUE` (`paymentDeadline = null`) sont **ignorées**.

### 8. Remboursement à l'annulation

`cancelRegistration` (tournoi & event) : si la ligne annulée était `PAID` **et**
`now < registrationDeadline`, **après commit** (best-effort) : rembourser le `Payment` ONLINE via
`RefundService.refund({ paymentId, clubId, amount })` (déjà branché ONLINE → Stripe + ligne
`Refund`) → `paymentStatus = REFUNDED`. Après la clôture : pas de remboursement auto (l'admin garde
`RefundService` pour un remboursement manuel). Un échec de remboursement n'annule jamais la
désinscription (best-effort, journalisé).

### 9. Frontend

- **`StripePaymentStep` rendu *target-agnostic*** : aujourd'hui couplé à `reservationId` /
  `api.createStripeIntent` / `api.confirmReservation`. Le généraliser pour recevoir deux callbacks
  injectés — `createIntent(): Promise<{ clientSecret; stripeAccountId }>` et
  `confirm(ids): Promise<void>` — plus `type` et `amountLabel`. Réservation et inscription
  réutilisent le même composant (petit refactor qui **préserve le chemin réservation** et clarifie
  la frontière du composant).
- **`/tournois/[id]` et `/events/[id]`** : si `requirePrepayment`, le bouton « S'inscrire » crée la
  ligne `DUE` puis ouvre l'étape Stripe :
  - place dispo → étape **paiement** (montant affiché = `entryFee` / `price`) ;
  - liste d'attente → étape **« Enregistrer ma carte »** avec copie explicite « débitée seulement si
    une place se libère ».
  - Fermer sans finaliser → la ligne `DUE` expire toute seule (job) — le front peut aussi appeler
    une annulation immédiate (cohérent avec la fermeture du `BookingModal`).
- Sur les fiches, l'`entryFee` / `price` passe de « informatif » à **« à régler en ligne »** quand
  `requirePrepayment`.
- `lib/api.ts` : `createRegistrationIntent`, `confirmRegistrationPayment` + types des nouvelles
  réponses de `register`.

### 10. Cas limites

- Épreuve gratuite ou `requirePrepayment = false` → **strictement le flux actuel** (aucune régression).
- `entryFee` / `price` null ou `< 0,50 €` avec `requirePrepayment = true` → refus à l'activation admin.
- Tournoi → **capitaine paie l'`entryFee` de l'équipe** en une fois, confirmation immédiate.
- Stripe inactif au moment de l'inscription d'une épreuve payante → `STRIPE_NOT_CONFIGURED`,
  inscription bloquée + message (jamais inscrite gratuitement par défaut).
- Double confirmation (client + webhook) → idempotente via `updateMany` conditionnel sur `DUE`.

## Gestion des erreurs

- `ONLINE_PAYMENT_NOT_ENABLED` (409) — activation `requirePrepayment` sans Stripe actif / sans
  montant valide.
- `STRIPE_NOT_CONFIGURED` (existant) — création d'intent / débit alors que le compte n'est pas actif.
- Débit off-session promotion : `card_declined` / `authentication_required` → annulation + promotion
  du suivant (jamais d'erreur 500 remontée au flux d'annulation, qui reste best-effort).
- Remboursement auto : échec → journalisé, désinscription préservée.
- Toutes les bascules d'état (`DUE→PAID`, promotion, libération job) sont des `updateMany`
  conditionnels / transactions Serializable — pas de double encaissement, pas de double promotion.

## Tests

**Backend**
- `tournament.service.test.ts` / `event.service.test.ts` :
  - register épreuve payante place dispo → ligne `CONFIRMED + DUE + paymentDeadline`, occupe la place ;
  - `confirmRegistrationPayment` → `PAID` + `Payment` créé + idempotent (2ᵉ appel no-op) ;
  - register complet → `WAITLISTED + DUE`, mode `setup` ;
  - promotion payante : débit OK → `PAID` + notif ; débit KO → `CANCELLED` + promotion du suivant ;
  - `cancelRegistration` `PAID` avant clôture → remboursement appelé + `REFUNDED` ; après clôture → pas de remboursement ;
  - comptage de capacité : une `DUE` expirée ne tient pas la place.
- `stripe.service.test.ts` : `createRegistration{Payment,Setup}Intent` (metadata), `chargeRegistrationOffSession`.
- `stripe.webhook.test.ts` : `payment_intent.succeeded` avec `tournamentRegistrationId` / `eventRegistrationId` → confirme la bonne inscription.
- Garde-fou `update` : `requirePrepayment = true` sans Stripe actif / montant < 0,50 € → `ONLINE_PAYMENT_NOT_ENABLED`.
- `cleanup.job` : inscription `CONFIRMED + DUE` expirée → libérée + suivant promu.

**Frontend**
- `StripePaymentStep` générique (callbacks `createIntent`/`confirm`) — le chemin réservation existant ne régresse pas.
- Parcours inscription payante (place dispo) et parcours liste d'attente (card-setup) sur `/tournois/[id]` et `/events/[id]`.
- Admin : case `requirePrepayment` désactivée si Stripe non actif.

## Hors v1

- Paiement échelonné ou **partage entre coéquipiers** (partenaire paie sa part).
- Relances de paiement / délai « payez sous 48 h » avec lien (on a choisi le débit off-session auto).
- Remboursement partiel auto, fenêtre de remboursement configurable par épreuve.
- Règlement des frais d'inscription via **caisse / porte-monnaie / carnet** (uniquement CB en ligne ici).
- Rappels e-mail avant échéance.

## Fichiers touchés (indicatif)

- `backend/prisma/schema.prisma` + migration `add_registration_online_payment`
- `backend/src/services/tournament.service.ts`, `event.service.ts` (register/promotion/cancel/update)
- `backend/src/services/stripe.service.ts` (intents + débit off-session inscription)
- `backend/src/routes/` tournois & events (intent + confirm-payment), `stripe-webhooks.ts`
- `backend/src/jobs/cleanup.job.ts`
- `backend/src/email/notifications.ts` (notif inscription au **paiement** confirmé, promotion débitée)
- `frontend/components/StripePaymentStep.tsx` (générique), fiches `/tournois/[id]`, `/events/[id]`,
  admin `/admin/tournaments`, `/admin/events`, `frontend/lib/api.ts`
- Tests associés.
