# Abonnements configurables (heures creuses incluses) + couverture au booking

**Date :** 2026-06-23
**Périmètre :** backend (modèles dédiés + service + couverture au booking) + frontend (admin + booking + affichage joueur) + seed
**Statut :** validé en brainstorming, prêt pour plan d'implémentation

## Problème

Le modèle d'offres actuel (`PackageTemplate` / `MemberPackage`) ne connaît que deux types **prépayés qui se décrémentent** : carnet d'entrées (`ENTRIES`) ou porte-monnaie € (`WALLET`). Il ne sait pas représenter un **abonnement** :

- prix **mensuel récurrent** (un seul champ `price`),
- **accès illimité** (les deux types se décrémentent à chaque résa),
- restriction **« heures creuses »** attachée à un produit.

Le club veut vendre des abonnements du type « **Padel 69 €/mois, heures creuses, engagement 1 an** » et « **Squash 59 €/mois** », et que ces abonnements **rendent automatiquement gratuites (ou remisées) les réservations couvertes** au moment du booking.

Décision retenue : **étendre le modèle** avec des **modèles dédiés** (pas de `kind` SUBSCRIPTION greffé sur les packages → zéro régression sur le prépayé/caisse existant).

## Objectifs

- Un **template d'abonnement configurable par le club** (« templates à renseigner ») : sport(s) couvert(s), prix mensuel, engagement, condition heures creuses, type d'avantage (gratuit / remise %), plafond d'usage.
- **Vente unique** à un membre → droit d'accès actif pour la durée d'engagement (pas de prélèvement automatique ; conforme à l'infra caisse existante).
- **Couverture automatique au booking** : un créneau couvert par un abonnement actif devient gratuit (ou remisé) sans flux d'argent.
- **Seed** des 2 exemples (Padel 69, Squash 59) sur tous les clubs de test.

### Hors périmètre (v1)

- Prélèvement mensuel automatique (Stripe Subscriptions) et échéancier des mensualités suivantes : **la vente encaisse la 1ʳᵉ mensualité**, le reste est hors v1.
- Renouvellement / résiliation avec préavis, proratisation.
- Remise (`DISCOUNT`) **combinée à un paiement en ligne obligatoire** du reste dû (cas `requireOnlinePayment`) : v1 cible le règlement au club pour le reste ; `INCLUDED` (gratuit) marche partout.

## Décisions de conception (validées)

### 1. Modèle de données — migration **100 % additive**

Nouvelles tables + colonnes nullables + valeur d'enum uniquement (sûr sur la base existante).

#### `SubscriptionPlan` (template, édité dans `/admin/packages`)

| Champ | Type | Rôle |
|---|---|---|
| `id` | String @id @default(cuid) | |
| `clubId` | String | scope club (`onDelete: Cascade`) |
| `name` | String | « Abonnement Padel — heures creuses » |
| `sportKeys` | String[] | sports couverts (`['padel']`, multi possible). **Validés contre le catalogue `Sport` global** (pas l'activation club → un club padel-only peut pré-créer l'abo squash) |
| `monthlyPrice` | Decimal(10,2) | prix mensuel |
| `commitmentMonths` | Int | engagement (ex. 12) |
| `offPeakOnly` | Boolean | true = couvre seulement les créneaux **100 % heures creuses** ; false = tous |
| `benefit` | enum `SubscriptionBenefit` (`INCLUDED` \| `DISCOUNT`) | gratuit ou remise |
| `discountPercent` | Int? | requis et 1–100 si `DISCOUNT` ; null si `INCLUDED` |
| `dailyCap` | Int? | max résas couvertes / jour (null = illimité) |
| `weeklyCap` | Int? | max résas couvertes / semaine (null = illimité) |
| `isActive` | Boolean @default(true) | activable/désactivable |
| `createdAt` / `updatedAt` | DateTime | |

Relations : `club`, `subscriptions Subscription[]`. Index `[clubId]`. `@@map("subscription_plans")`.

#### `Subscription` (droit d'accès d'un membre, vendu une fois)

| Champ | Type | Rôle |
|---|---|---|
| `id` | String @id @default(cuid) | |
| `clubId`, `userId`, `planId` | String | scope + références |
| `startedAt` | DateTime @default(now) | début |
| `expiresAt` | DateTime | = `startedAt` + `commitmentMonths` (arithmétique Luxon, fuseau club) |
| `status` | enum `SubscriptionStatus` (`ACTIVE` \| `CANCELLED`) @default(ACTIVE) | |
| `monthlyPriceSnapshot` | Decimal(10,2) | prix au moment de la vente |
| `sportKeys` | String[] | **snapshot** de couverture |
| `offPeakOnly` | Boolean | snapshot |
| `benefit` | `SubscriptionBenefit` | snapshot |
| `discountPercent` | Int? | snapshot |
| `dailyCap`, `weeklyCap` | Int? | snapshot |
| `createdAt` | DateTime | |

**Snapshot figé** (comme `MemberPackage` fige `kind`/montants) : la couverture lue au booking vient de `Subscription`, **jamais** du plan. Éditer un plan n'altère pas les abos déjà vendus.
Relations : `club`, `user` (`onDelete: Cascade`), `plan` (`onDelete: Restrict`), `payments Payment[]`. Index `[clubId, userId]`. `@@map("subscriptions")`.

#### `Payment` (additif)

- Enum `PaymentMethod` : ajout de `SUBSCRIPTION`.
- `subscriptionId String?` — relie le paiement de **vente** (méthode argent CASH/CARD/…) à l'abonnement.
- `sourceSubscriptionId String?` — relie un paiement de **couverture** (method `SUBSCRIPTION`) à l'abonnement source (miroir de `memberPackageId` / `sourcePackageId`).
- `SUBSCRIPTION` rejoint les **méthodes « sans argent »** (comme `MEMBER` / `PACK_CREDIT` / `WALLET`) → exclue des totaux d'encaissement de la caisse et des stats CA (miroir de la liste existante dans `accounting.service.ts` / `package.service.ts` / `memberStats.service.ts`).

### 2. Backend — service & routes

`backend/src/services/subscription.service.ts` — `SubscriptionService` :

- **`listPlans(clubId)`** — tri `createdAt asc`.
- **`createPlan(clubId, body)`** — valide : `name` non vide ; `sportKeys` non vide ⊆ clés `Sport` existantes ; `monthlyPrice` > 0 ; `commitmentMonths` entier ≥ 1 ; `benefit` ∈ enum ; si `DISCOUNT` → `discountPercent` entier 1–100 ; caps null ou entier ≥ 1. Erreur `VALIDATION_ERROR`.
- **`updatePlan(id, clubId, body)`** — mêmes règles ; tous les champs éditables (le snapshot protège les abos vendus) ; `isActive`. `PLAN_NOT_FOUND` si autre club.
- **`sellSubscription(clubId, userId, { planId, method, payerName?, voucherRef?, voucherIssuer?, createdByUserId? })`** — vérifie plan actif + `clubMembership` existant ; `method` ∈ `SALE_METHODS` (réutilise la constante du prépayé : CASH/CARD/TRANSFER/VOUCHER/OTHER, défaut CASH) ; `expiresAt` = now + `commitmentMonths` mois (Luxon). **Transaction** : crée `Subscription` (avec snapshot des champs du plan) + `Payment` de vente (montant = `monthlyPrice`, `subscriptionId`, `receiptNo` via `PackageService.nextReceiptNo`, note « Vente abonnement <nom> — 1ʳᵉ mensualité »).
- **`listMySubscriptionsBySlug(slug, userId)`** — club ACTIVE ; abos `status ACTIVE` et `expiresAt > now`, `include plan.name`.
- **`listMemberSubscriptions(clubId, userId)`** — vue admin (historique compris).
- **`cancelSubscription(id, clubId)`** — passe `status = CANCELLED` (n'efface rien).
- **`static coverageFor(sub, { sportKey, slotClass, dueCents }) → { covered: boolean; coverCents: number }`** — **pur** : `covered` ssi `sportKey ∈ sub.sportKeys` ET (`!sub.offPeakOnly` OU `slotClass === 'offPeak'`) ; `coverCents` = `dueCents` si `INCLUDED`, sinon `round(dueCents * discountPercent / 100)`. (Le plafond est vérifié à part car il dépend d'un comptage en base.)

**Routes** (`backend/src/routes/admin.ts` + `clubs.ts` / `me.ts`) :
- Admin : `GET/POST /api/clubs/:clubId/admin/subscription-plans`, `PATCH …/subscription-plans/:id`, `POST /api/clubs/:clubId/admin/members/:userId/subscriptions` (vente), `GET …/members/:userId/subscriptions`.
- Joueur : `GET /api/clubs/:slug/me/subscriptions`.

### 3. Couverture au booking

Dans `reservation.service.ts` → `confirmReservation`, l'option `paymentSource` accepte désormais **`{ packageId } | { subscriptionId }`**.

Si `subscriptionId` (dans la transaction Serializable, après le verrou `FOR UPDATE` et le contrôle de conflit) :
1. Charge l'abonnement ; vérifie `userId`/`clubId`, `status ACTIVE`, `expiresAt > now`. Sinon `SUBSCRIPTION_NOT_FOUND`.
2. Résout la **clé sport** du terrain réservé (`Resource → ClubSport → Sport.key`).
3. Calcule `slotClass = classifySlot(off, start, end, tz)` et `dueCents = slotPriceCents(...)` (déjà disponibles dans le service).
4. `coverageFor(...)` → si `!covered` → `SUBSCRIPTION_NOT_APPLICABLE`.
5. **Plafond** (si `dailyCap`/`weeklyCap`) : compte les résas déjà couvertes par cet abonnement dont le `startTime` tombe dans le jour / la semaine du créneau (jointure `Payment(method SUBSCRIPTION, sourceSubscriptionId) → reservation.startTime`, fuseau club). `≥ cap` → `SUBSCRIPTION_CAP_REACHED`. Comptage hors verrou → dépassement de +1 toléré (même compromis que les quotas).
6. Crée `Payment(method 'SUBSCRIPTION', amount = coverCents/100, sourceSubscriptionId, reservationId, participantId = organisateur, receiptNo)`.
   - `INCLUDED` → `coverCents = dueCents` → reste dû = 0.
   - `DISCOUNT` → `coverCents = remise` → reste dû = `dueCents − coverCents`, payable normalement (caisse).

Le **prix affiché** du créneau (`totalPrice`) ne change pas : la couverture est un paiement « sans argent » qui éteint (ou réduit) le dû, exactement comme `WALLET`/`PACK_CREDIT`.

### 4. Frontend

- **Admin `/admin/packages`** : nouvelle section **« Abonnements »** sous « Offres prépayées ». Liste des plans (nom, sports, `xx €/mois`, engagement, « heures creuses » / « toutes heures », avantage, plafonds, activer/désactiver) + **formulaire de création** : nom, sports (multi-select sur le **catalogue `Sport` publié** — pas seulement les sports activés du club, pour pouvoir pré-créer un abo squash sur un club padel-only), prix mensuel, engagement (mois), interrupteur « Heures creuses uniquement », avantage `Segmented` (Inclus / Remise %) + champ %, plafonds jour/semaine (optionnels).
- **Vente** : panneau **« Vendre un abonnement »** dans `/admin/caisse` (à côté de la vente d'offre prépayée) : membre + plan + moyen de paiement → `POST …/members/:userId/subscriptions`.
- **Joueur** :
  - Chip **« Abonné Padel — heures creuses »** sur Réserver (à côté des chips de soldes).
  - **BookingModal** : si un abo actif **couvre** le créneau (décision côté client) → bloc « Couvert par votre abonnement — **gratuit** » (ou « **−X %** → reste **Y €** »), **appliqué par défaut** ; la confirmation passe `paymentSource: { subscriptionId }`. La détection « heures creuses » réutilise le miroir existant `frontend/lib/caisse.ts`.
  - **`ProfileMenu`** : abos actifs listés (réutilise la zone des soldes prépayés).
- **Helper pur** `frontend/lib/subscriptions.ts` : `subscriptionCovers(sub, { sportKey, isOffPeak }) → boolean` + libellés (`coverageLabel`), **testé**. Types `SubscriptionPlan` / `Subscription` dans `lib/api.ts` + méthodes API (`adminGet/Create/UpdateSubscriptionPlan`, `adminSellSubscription`, `adminGetMemberSubscriptions`, `getMySubscriptions`).

### 5. Seed

`prisma/seed-offers.ts` (mêmes points d'appel `seed.ts` + `seed-demo.ts`, à côté des cartes prépayées) : helper `seedDefaultSubscriptionPlans(prisma, clubId)`, **idempotent** (`findFirst` par `(clubId, name)`), créant 2 plans/club :
- **Abonnement Padel — heures creuses** : `sportKeys ['padel']`, `monthlyPrice 69`, `commitmentMonths 12`, `offPeakOnly true`, `benefit INCLUDED`.
- **Abonnement Squash — heures creuses** : `sportKeys ['squash']`, `monthlyPrice 59`, `commitmentMonths 12`, `offPeakOnly true`, `benefit INCLUDED`.

## Tests

- **Backend** `subscription.service.test.ts` : création (validation `sportKeys`/`discountPercent`/caps), vente (snapshot copié, `expiresAt`, paiement de vente = `monthlyPrice`), `cancel`, `listMySubscriptionsBySlug` (exclut expirés/annulés).
- **Backend** bloc « couverture abonnement » dans `reservation.service.test.ts` : créneau creux → gratuit (reste dû 0, paiement `SUBSCRIPTION`), créneau plein avec `offPeakOnly` → `SUBSCRIPTION_NOT_APPLICABLE`, plafond atteint → `SUBSCRIPTION_CAP_REACHED`, `DISCOUNT` → reste dû partiel, **immutabilité du snapshot** (éditer le plan après vente ne change pas la couverture).
- **Frontend** `lib/subscriptions.test.ts` : `subscriptionCovers` (sport hors liste, heures creuses vs pleines, `offPeakOnly` false) + libellés.

## Risques / points d'attention

- **Méthodes « sans argent »** : bien ajouter `SUBSCRIPTION` partout où `MEMBER`/`WALLET`/`PACK_CREDIT` sont exclues des totaux d'argent (caisse, comptabilité, `memberStats`). Sinon le CA est faussé.
- **Sports non activés** : un plan peut référencer un sport non activé par le club (squash sur un club padel-only) — légal (catalogue), mais la couverture ne se déclenche jamais sans terrain de ce sport. C'est voulu.
- **Snapshot** : toute la logique de booking lit `Subscription.*`, jamais `plan.*`.
- **`DISCOUNT` + paiement en ligne obligatoire** : hors v1 (cf. périmètre).
