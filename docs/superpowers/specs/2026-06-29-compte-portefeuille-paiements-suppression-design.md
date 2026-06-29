# Mon compte — Portefeuille, méthodes de paiement, historique & suppression de compte

**Date :** 2026-06-29
**Statut :** Design validé, prêt pour le plan d'implémentation

## Problème

Le joueur connecté n'a aujourd'hui aucun endroit pour :

1. **Voir ses méthodes de paiement** (la carte bancaire enregistrée auprès du club) et les **anciens paiements** qu'il a réglés.
2. **Supprimer son compte**.
3. Consulter **son porte-monnaie / ses crédits / son abonnement** au club.

Les données existent en base mais ne sont surfacées que partiellement (chips de soldes dans `ProfileMenu`, booléen `hasCardOnFile`). Aucune suppression de compte n'est possible.

## Décisions de cadrage (issues du brainstorming)

- **Périmètre = club courant uniquement.** Porte-monnaie, crédits, abonnement, carte et historique sont **scopés au club** du sous-domaine actif. Pas de vue agrégée multi-clubs en v1.
- **Suppression de compte = anonymisation (soft delete).** Le login est révoqué, les données personnelles sont effacées, mais l'historique comptable des clubs (paiements, réservations passées) reste intact (conforme RGPD, ne casse pas la compta).
- **Garde-fous de suppression (les 4) :** annuler mes réservations futures · bloquer si je suis l'unique gérant d'un club · avertir si solde/abo perdu · re-saisie du mot de passe.
- **Carte enregistrée :** afficher **marque + 4 derniers chiffres + expiration** et permettre de la **retirer**.
- **Placement :** tout dans `/me/profile` sous forme de **nouvelles sections** (+ ancres dans `ProfileSectionNav`). Les sections club-scopées ne s'affichent que sur un sous-domaine de club ; la suppression de compte s'affiche partout (compte global).

## Contexte technique existant (réutilisé)

- **Page profil** `frontend/app/me/profile/page.tsx` : sections + `ProfileSectionNav` collant, `navItems` construit à partir des sections **réellement rendues**, `scrollMarginTop: var(--profile-anchor)`. Rendu sur sous-domaine club (`slug && club`) **et** hôte plateforme (sans club).
- **Soldes** : `GET /api/clubs/:slug/me/packages` → `MemberPackage[]` ; helpers `frontend/lib/packages.ts` (`packageLabel`, `isUsable`).
- **Abonnements** : `GET /api/clubs/:slug/me/subscriptions` → `Subscription[]`.
- **Carte enregistrée** : modèle `ClubStripeCustomer` (`stripeCustomerId`, `defaultPaymentMethodId`), sur le **compte Stripe connecté du club**. `defaultPaymentMethodId` est écrit en 4 endroits : `reservation.service.ts` (confirm, 2 branches), `stripe-webhooks.ts` (`setup_intent.succeeded`, `payment_intent.succeeded`). Lecture actuelle = booléen via `ClubService.getMyCardStatus` → `{ hasCardOnFile }`.
- **Paiements** : modèle `Payment` (pas de champ payeur direct). Attribution à un joueur **comme `MemberStatsService.getMemberHistory`** : via `reservation.userId` (organisateur), `participant.userId`, `memberPackage.userId` (vente), `subscription.userId` (vente), `tournamentRegistration`/`eventRegistration`. Montants nets de `refundedAmount`.
- **Routes `me`** : `backend/src/routes/me.ts` (profil, avatar, mot de passe…). **Pas** de `DELETE /api/me`.
- **Annulation de réservation** : logique existante dans `ReservationService` (libère le verrou Redis + SSE `slot_released`) — à réutiliser pour annuler les réservations futures.
- **Login** : `backend/src/routes/auth.ts` — à durcir pour refuser un compte `deletedAt != null`.

> ⚠️ **Migrations (dérive de base connue)** : hand-author le SQL additif + `prisma migrate deploy` (PAS `migrate dev` qui veut reset). Cf. mémoire projet « Prisma: migrate deploy, not migrate dev ».

## Architecture

### Vue d'ensemble

Quatre nouvelles sections dans `/me/profile`, dans l'ordre proposé après les sections existantes :

| Section | id (ancre) | Visible si | Source |
|---|---|---|---|
| **Portefeuille** | `portefeuille` | `slug && club && membership` | `me/subscriptions` + `me/packages` (existants) |
| **Méthodes de paiement** | `paiement` | `slug && club && membership` | `me/payment-method` (nouveau) |
| **Mes paiements** | `paiements` | `slug && club && membership` | `me/payments` (nouveau) |
| **Supprimer le compte** | `suppression` | toujours (compte global) | `me/account-deletion-summary` + `DELETE /api/me` (nouveaux) |

`navItems` est étendu en suivant le pattern existant (entrées ajoutées **conditionnellement** pour ne pas créer d'ancre morte). Icônes à ajouter à `components/ui/Icon.tsx` si manquantes (ex. `wallet`/`card`/`receipt`/`trash`).

### 1. Section « Portefeuille » (lecture seule)

- **Abonnements** : `api.getMyClubSubscriptions(slug, token)`. Affiche nom du plan, bénéfice (`INCLUDED` → « Inclus » / `DISCOUNT` → « -X% »), période de validité, statut. État vide neutre.
- **Soldes** : `api.getMyClubPackages(slug, token)`. Réutilise `packageLabel` (« Carnet — 7 entrées », « Porte-monnaie — 53,50 € ») et `isUsable` (badge « expiré » / « épuisé »). État vide neutre.
- **Aucun backend nouveau.** Composant `frontend/components/profile/WalletSection.tsx`.

### 2. Section « Méthodes de paiement » (carte enregistrée)

**Migration additive `add_saved_card_details`** sur `ClubStripeCustomer` :
`cardBrand String?`, `cardLast4 String?`, `cardExpMonth Int?`, `cardExpYear Int?` (tous nullable, `@map` snake_case).

**Capture des détails = lazy à la lecture** (évite de modifier les 4 sites d'écriture de `defaultPaymentMethodId`) :
- `GET /api/clubs/:slug/me/payment-method` → `{ brand, last4, expMonth, expYear } | null`.
  - Lit `ClubStripeCustomer`. Si `defaultPaymentMethodId == null` → `null`.
  - Si `defaultPaymentMethodId` présent mais `cardLast4` absent (carte « legacy ») → `StripeService.getCardDetails(clubId, defaultPaymentMethodId)` (Stripe `paymentMethods.retrieve(pmId, { stripeAccount })`), **persiste** brand/last4/exp sur la ligne, puis renvoie.
  - Échec Stripe au backfill → renvoyer une forme dégradée `{ brand: null, last4: null, … }` mais `present: true` (ou `{ brand:'Carte', last4:null }`) plutôt qu'une 500. **Décision d'implémentation à trancher dans le plan** ; ne jamais faire échouer le chargement du profil.
- `DELETE /api/clubs/:slug/me/payment-method` :
  - `StripeService.detachCard(clubId, defaultPaymentMethodId)` (Stripe `paymentMethods.detach(pmId, { stripeAccount })`), **best-effort** (ignore l'erreur « déjà détachée »).
  - Puis `clubStripeCustomer.update` → `defaultPaymentMethodId = null`, card* = null.
  - Renvoie `{ ok: true }`.

**Service** : nouvelles méthodes sur `StripeService` (`getCardDetails`, `detachCard`) ; orchestration dans `ClubService` (`getMyPaymentMethod`, `removeMyPaymentMethod`) — gardes club ACTIVE + membership, miroir de `getMyCardStatus`.

**Front** : `frontend/components/profile/PaymentMethodSection.tsx`. Affiche « Visa •••• 4242 · exp 04/27 » (libellé via helper pur, cf. `lib/payments.ts`) ; bouton « Retirer ma carte » → `ConfirmDialog` existant → `api.removeMyPaymentMethod`. État vide : « Aucune carte enregistrée ». Note explicative (la carte sert d'empreinte anti no-show / aux débits liste d'attente — le club pourra la redemander à la prochaine réservation).

> **Trade-off tranché** : on **stocke** brand/last4/exp (migration) avec backfill paresseux à la lecture, plutôt qu'un fetch Stripe systématique à chaque ouverture de profil.

### 3. Section « Mes paiements » (historique)

- `GET /api/clubs/:slug/me/payments` → `MyPayment[]` triés par date desc.
  - **Attribution** = ensemble des paiements où le joueur est : organisateur (`reservation.userId`), participant (`participant.userId`), acheteur de carnet/porte-monnaie (`memberPackage.userId`), acheteur d'abonnement (`subscription.userId`), ou inscrit (tournament/event registration), **scopés au club** (`payment.clubId` ou `reservation.resource.clubId`). Réutilise/centralise la logique d'attribution de `MemberStatsService`.
  - DTO `MyPayment` : `{ id, date, amountCents, method, refundedCents, status, label }`.
  - `label` dérivé serveur : « Réservation {ressource} · {date courte} », « Carnet {n} entrées », « Porte-monnaie {montant} », « Abonnement {plan} », « Inscription {tournoi/event} ». Helper de libellé pur côté front pour le rendu, données brutes côté API.
- **Service** : `MemberStatsService` (ou nouveau `PaymentHistoryService`) exposant `listMyPaymentsBySlug(slug, userId)`.
- **Front** : `frontend/components/profile/PaymentsHistory.tsx` — liste compacte (date, libellé, montant, puce méthode, mention « remboursé » si `refundedCents > 0`). Pagination simple/limite (ex. 50 derniers) avec mention si tronqué. Helpers purs `frontend/lib/payments.ts` (libellé méthode FR, format euros, libellé de paiement).

### 4. Section « Supprimer mon compte » (anonymisation)

**Migration additive `add_user_deleted_at`** : `User.deletedAt DateTime?` (`@map("deleted_at")`).

**Pré-check (avertissements + blocage)** :
- `GET /api/me/account-deletion-summary` → `{ blockingClubs: string[], futureReservations: number, activeSubscriptions: number, balances: string[] }`.
  - `blockingClubs` = clubs où le joueur est l'**unique** `OWNER` (compte des `ClubMember` rôle OWNER par club == 1 et c'est moi).
  - `futureReservations` = réservations CONFIRMED/PENDING à venir dont je suis organisateur.
  - `activeSubscriptions` = abonnements ACTIVE tous clubs.
  - `balances` = libellés des soldes non nuls (carnets/porte-monnaie utilisables).

**Suppression** :
- `DELETE /api/me` (body `{ password }`) :
  1. **Re-vérifie le mot de passe** (`bcrypt.compare`) → 401 `INVALID_PASSWORD` si faux.
  2. **Blocage** si `blockingClubs` non vide → 409 `OWNS_CLUB` (+ noms). Message : transférer la gestion d'abord.
  3. Dans une **transaction** :
     - **Annule les réservations futures** (réutilise le chemin d'annulation existant → libère verrou Redis + SSE `slot_released`). Note : l'annulation par lot peut se faire hors transaction Prisma si la logique Redis/SSE l'exige — à préciser dans le plan ; l'anonymisation, elle, reste atomique.
     - **Scrub PII** sur `User` : `firstName='Joueur'`, `lastName='supprimé'`, `email='deleted-<id>@deleted.palova.invalid'` (unicité préservée), `phone=null`, `avatarUrl=null`, `birthDate=null`, `sex=null`, `locale=null`, `password=<hash aléatoire>`, `isSuperAdmin=false`, `deletedAt=now()`.
     - Supprime les **push subscriptions** du joueur.
  4. Hors transaction (best-effort) : supprime le **fichier avatar** sur disque.
  5. Renvoie `{ ok: true }`. **Wallet/abonnements NON remboursés** (avertis), laissés pour la compta du club mais inutilisables (login révoqué).
- **Durcissement login** : `auth.ts` refuse un compte `deletedAt != null` (même si l'email scrubé rend déjà le login impraticable).

**Front** : `frontend/components/profile/DeleteAccountSection.tsx`.
- Bouton danger « Supprimer mon compte » → `ConfirmDialog` (pattern existant) montrant les **avertissements** issus de `account-deletion-summary` (N réservations seront annulées, solde/abo perdu) et exigeant la **saisie du mot de passe**.
- Si `blockingClubs` non vide : bouton de suppression **désactivé** + explication (transférer la gestion du/des club(s) listés).
- Au succès : déconnexion (clear token) → `router.replace('/login')`.

### 5. Plomberie front (`lib/api.ts`)

Nouvelles méthodes : `getMyPaymentMethod(slug, token)`, `removeMyPaymentMethod(slug, token)`, `getMyPayments(slug, token)`, `getAccountDeletionSummary(token)`, `deleteMyAccount(password, token)`. Nouveaux types : `MyPaymentMethod`, `MyPayment`, `AccountDeletionSummary`.

⚠️ Les suites de tests front qui **mockent `@/lib/api`** doivent exposer ces nouvelles méthodes (sinon `undefined` au runtime).

### 6. Chargement dans la page profil

`/me/profile` charge en plus, **quand `slug && membership`** : packages, subscriptions, payment-method, payments (en parallèle, best-effort, `.catch(()=>…)` comme l'existant). `account-deletion-summary` chargé **toujours** (compte global). Les nouvelles sections suivent le style des cartes existantes (`card`, `cardTitle`, `scrollMarginTop`).

## Découpage en unités (isolation)

- **Helpers purs testables** : `frontend/lib/payments.ts` (libellés méthode/paiement, format euros, format carte). Réutilise `lib/packages.ts`.
- **Composants présentation** : `WalletSection`, `PaymentMethodSection`, `PaymentsHistory`, `DeleteAccountSection` — chacun reçoit ses données en props ou les charge via `api`, sans logique métier.
- **Services backend** : carte (`ClubService` + `StripeService`), historique (`MemberStatsService`/`PaymentHistoryService`), suppression (nouveau `AccountService` ou méthodes dans `me.ts`).

## Gestion des erreurs

- Carte : tout échec Stripe au backfill/détachement = best-effort, jamais de 500 sur le profil ; le détachement nullifie quand même localement.
- Suppression : `INVALID_PASSWORD` (401), `OWNS_CLUB` (409, + noms). Messages FR mappés côté front.
- Endpoints club-scopés : gardes club ACTIVE + membership (miroir existant), sinon `CLUB_NOT_FOUND` / `MEMBERSHIP_REQUIRED`.

## Tests

**Backend**
- `me/payment-method` : présent → DTO ; legacy → backfill (Stripe appelé, ligne mise à jour) ; absent → null ; échec Stripe → dégradé non bloquant.
- `DELETE me/payment-method` : détache + nullifie ; idempotent si déjà détachée.
- `me/payments` : attribution (organisateur, participant, vente carnet/abo, inscription), scope club, montants nets.
- `DELETE /api/me` : mauvais mot de passe → 401 ; unique OWNER → 409 `OWNS_CLUB` ; cas nominal → réservations futures annulées + PII scrubée + `deletedAt` posé + push supprimées.
- `account-deletion-summary` : blockingClubs / compteurs corrects.
- Login refuse `deletedAt != null`.

**Frontend**
- `lib/payments.ts` (helpers purs).
- `WalletSection` (abos + soldes + états vides), `PaymentMethodSection` (affichage carte + retrait via ConfirmDialog), `PaymentsHistory` (liste + remboursé + tronqué), `DeleteAccountSection` (avertissements, blocage OWNER, saisie mot de passe, déconnexion).
- `navItems` : ancres ajoutées seulement quand les sections sont rendues.

## Hors périmètre (v1)

- Vue agrégée multi-clubs (porte-monnaie/abos/paiements de tous les clubs).
- Ajout/édition d'une carte depuis le profil (la carte s'enregistre via les parcours réservation/inscription existants).
- Remboursement automatique du solde/abonnement à la suppression de compte.
- Export comptable / reçu PDF de l'historique (le reçu imprimable côté admin reste séparé).
- Re-saisie par « taper SUPPRIMER » (on retient la re-saisie du mot de passe).
