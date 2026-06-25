# Page admin « Paiement en ligne » + changement de compte Stripe

**Date :** 2026-06-25
**Statut :** design validé

## Contexte

Le paiement en ligne repose sur **Stripe Connect (comptes Express)** : Palova est la
plateforme (une seule `STRIPE_SECRET_KEY`), chaque club fait un *onboarding* qui crée un
**compte connecté** dont l'id est stocké dans `Club.stripeAccountId` (+ `stripeAccountStatus`
`NONE | PENDING | ACTIVE | RESTRICTED`). Les empreintes bancaires des joueurs vivent sur ce
compte connecté via `ClubStripeCustomer` (`stripeCustomerId`, `defaultPaymentMethodId`).

Aujourd'hui, la configuration Stripe est un **bloc** dans `/admin/settings` (états + 2 réglages
`requireOnlinePayment` / `requireCardFingerprint`). Routes backend existantes :
`POST /stripe/connect`, `GET /stripe/status`, `GET /stripe/login-link`.

**Deux limites motivent ce travail :**
1. La config Stripe est noyée dans la page Réglages, sans visibilité propre.
2. **Un club ne peut pas changer de compte Stripe.** `createConnectedAccount` réutilise
   toujours `stripeAccountId` s'il existe ; aucune route de déliaison. Changer aujourd'hui
   exige une remise à `null` manuelle en base — impossible pour le gérant.

## Objectifs

- Extraire la configuration du paiement en ligne dans une **page admin dédiée** `/admin/payments`.
- Permettre au gérant de **changer de compte Stripe** proprement (déliaison + ré-onboarding),
  avec un **garde-fou** contre la perte de remboursements encore plausibles.

## Non-objectifs

- Pas de suppression du compte côté Stripe (on délie localement, le ré-onboarding crée un
  compte neuf).
- Pas de migration de données entre ancien et nouveau compte (empreintes purgées, à re-saisir).
- Pas de changement du flux de paiement joueur (BookingModal, webhooks) ni des réglages eux-mêmes.

## Architecture

### 1. Navigation & placement

- Nouvelle entrée dans la sidebar `/admin` (`frontend/app/admin/layout.tsx`), section
  **« Finances »** (à côté de *Comptabilité* / *Offres prépayées*) :
  `{ href: '/admin/payments', label: 'Paiement en ligne', icon: 'lock' }`.
  `lock` est un `IconName` existant, non utilisé ailleurs dans la sidebar (dé-duplication
  respectée) et lisible comme « paiement sécurisé ».
- Le bloc « Paiement en ligne » de `/admin/settings` est **retiré** ; à sa place, une carte
  courte avec un lien **« Gérer le paiement en ligne → »** vers `/admin/payments`.

### 2. Page `/admin/payments` (nouveau, client component)

Réutilise le chargement de `/admin/settings` : `useAuth()` (token), `useClub()` (`hostClub.id`),
données via `api.adminGetClub(clubId, token)` → `ClubAdminDetail` (expose `stripeAccountStatus`,
`requireOnlinePayment`, `requireCardFingerprint`). Même shell visuel (cartes thémées).

Affichage selon `club.stripeAccountStatus` (logique reprise telle quelle, plus un en-tête de
statut clair : pastille colorée + libellé) :

- **NONE** → pitch + bouton « Connecter mon compte Stripe » → `initiateStripeConnect` (redirige
  vers l'onboarding ; `returnUrl`/`refreshUrl` pointent sur `/admin/payments?stripe=return|refresh`,
  géré par l'effet `?stripe=` repris de settings).
- **PENDING** → « Onboarding en cours » + « Reprendre l'onboarding » (même bouton).
- **RESTRICTED** → « Compte restreint — vérifiez votre tableau de bord ».
- **ACTIVE** → « ● Compte actif » + lien « Tableau de bord Stripe ↗ » (`getStripeLoginLink`) +
  les 2 réglages `requireOnlinePayment` / `requireCardFingerprint` (toggles, enregistrés via
  `adminUpdateClub`, même `save()` que settings).
- Bouton **« Rafraîchir le statut »** (tous états liés) → `getStripeStatus` puis `load()`.

### 3. Changement de compte Stripe (nouveau)

- Visible dès qu'un compte est lié (PENDING / RESTRICTED / ACTIVE) : bouton discret
  **« Changer de compte Stripe »** (ton danger / secondaire).
- Ouvre un **`ConfirmDialog`** (`frontend/components/ui/ConfirmDialog.tsx`, déjà danger) :
  - `title` « Changer de compte Stripe »
  - `message` listant les conséquences : empreintes bancaires supprimées (clients re-saisissent
    leur carte), paiement CB désactivé jusqu'au nouvel onboarding, et **les remboursements des
    paiements CB déjà encaissés sur l'ancien compte ne seront plus possibles**.
  - `confirmLabel` « Changer de compte ».
- À la confirmation → `api.disconnectStripe(clubId, token)` :
  - **succès** → `useClub().refresh()` **puis** `load()` (la fiche club racine est mise en cache
    une seule fois par `ClubProvider` ; sans `refresh()` la modale de réservation resterait sur
    l'ancien statut), la page rebascule sur l'état **NONE**.
  - **409 `STRIPE_HAS_PENDING_ONLINE_PAYMENTS`** → message inline dans le dialog :
    « X paiement(s) CB sur des réservations à venir — remboursez-les ou attendez qu'elles soient
    passées avant de changer de compte. » (le `count` vient du corps de la réponse).
- Garde `busy` anti double-clic sur le dialog pendant la requête.

### 4. Backend (additif)

**`StripeService.disconnectAccount(clubId)`** (`backend/src/services/stripe.service.ts`) :

1. **Garde-fou** (hors transaction, lecture) — compte les `Payment` du club tels que :
   - `method = 'ONLINE'` et `stripePaymentIntentId` non nul (adossés au compte connecté),
   - `refundedAmount < amount` (solde remboursable > 0),
   - rattachés à une `Reservation` dont `startTime > now` (encore annulable → remboursement
     plausible).

   Si `count > 0` → `throw` d'une erreur portant le code `STRIPE_HAS_PENDING_ONLINE_PAYMENTS`
   et le `count` (ex. `Object.assign(new Error('STRIPE_HAS_PENDING_ONLINE_PAYMENTS'), { count })`).

   > Raison du filtre `startTime > now` : un paiement encaissé et jamais remboursé est le cas
   > **normal** ; bloquer sur « tout paiement non totalement remboursé » figerait le changement
   > pour toujours. On ne bloque que sur les réservations à venir — condition **finie qui se
   > purge d'elle-même** quand les créneaux passent. Les empreintes no-show, re-collectables, ne
   > bloquent pas (simple avertissement côté UI).

2. **Déliaison** (transaction `Serializable`) :
   - `club.update` : `stripeAccountId = null`, `stripeAccountStatus = 'NONE'`,
     `requireOnlinePayment = false`, `requireCardFingerprint = false` (sinon des réservations
     seraient bloquées sans compte actif).
   - `clubStripeCustomer.deleteMany({ clubId })` (customers/cartes liés à l'ancien compte,
     inutilisables sur le nouveau).

**Route** `POST /api/clubs/:clubId/admin/stripe/disconnect` (`backend/src/routes/admin.ts`,
après les routes `/stripe/*` existantes) → appelle `disconnectAccount`, `204` au succès.

> ⚠️ `handleError` ne renvoie que `{ error: message }` (mappé via `ERROR_STATUS`), sans champ
> supplémentaire. Pour transmettre le `count`, la route **traite ce code explicitement** dans son
> `catch` : si `err.message === 'STRIPE_HAS_PENDING_ONLINE_PAYMENTS'` →
> `res.status(409).json({ error: err.message, count: err.count ?? 0 })` ; sinon
> `handleError(err, res, next)`. (Pas besoin de l'ajouter à `ERROR_STATUS`.)

**Client** `api.disconnectStripe(clubId, token)` (`frontend/lib/api.ts`, à côté des autres
fonctions Stripe).

### 5. Données

**Aucune migration.** On réutilise `Club.stripeAccountId/stripeAccountStatus/requireOnlinePayment/
requireCardFingerprint`, `ClubStripeCustomer`, `Payment.method/stripePaymentIntentId/
refundedAmount/reservationId`, `Reservation.startTime`.

## Gestion des erreurs

- `disconnectStripe` 409 → message explicite dans le `ConfirmDialog` (ne ferme pas, n'agit pas).
- Échec onboarding / login-link / refresh status → comportements existants conservés (le bouton
  se ré-active, pas de crash).
- Toute la déliaison est transactionnelle : un échec laisse le compte intact.

## Tests

**Backend** — `backend/src/services/__tests__/stripe.service.test.ts` :
- `disconnectAccount` sans paiement en attente → `stripeAccountId=null`, `stripeAccountStatus='NONE'`,
  2 flags à `false`, `ClubStripeCustomer` du club supprimés.
- `disconnectAccount` avec un `Payment` ONLINE non remboursé sur une **réservation future** →
  throw `STRIPE_HAS_PENDING_ONLINE_PAYMENTS` (+ `count`), **rien n'est modifié**.
- Paiement ONLINE non remboursé mais sur une **réservation passée** → **n'empêche pas** la déliaison.

**Backend (route)** — éventuel ajout dans une suite admin Stripe : `POST /stripe/disconnect`
renvoie 409 `{ error, count }` quand garde-fou actif.

**Frontend** — `frontend/__tests__/AdminPayments.test.tsx` (nouveau) :
- rend chaque état (`NONE/PENDING/ACTIVE/RESTRICTED`) ;
- le dialog « Changer de compte » appelle `disconnectStripe` puis repasse en NONE (mock `refresh`/`load`) ;
- 409 → message d'erreur affiché, pas de bascule.
- Mise à jour de la suite settings : bloc Stripe **retiré**, lien « Gérer le paiement en ligne → » présent.

## Fichiers touchés

- `frontend/app/admin/payments/page.tsx` (nouveau)
- `frontend/app/admin/layout.tsx` (entrée sidebar)
- `frontend/app/admin/settings/page.tsx` (retrait bloc + lien)
- `frontend/lib/api.ts` (`disconnectStripe`)
- `backend/src/services/stripe.service.ts` (`disconnectAccount` + garde-fou)
- `backend/src/routes/admin.ts` (route `/stripe/disconnect`, mapping erreur)
- Tests associés.
