# Offre Palova au membre actif + facturation SaaS des clubs — Design (2026-07-07)

> Fait suite à l'étude de prix `docs/superpowers/briefs/2026-07-07-etude-prix-offre-clubs.md`.
> Remplace la grille « Découverte / Club / Club Pro » (79/149 €, paliers de fonctionnalités)
> par une offre **au nombre de membres actifs**, un seul plan tout inclus.

## Décisions actées (avec le user, 2026-07-07)

1. **Tout inclus à tous les paliers** — aucun gating de fonctionnalités par plan. Seul le
   nombre de membres actifs fait le prix.
2. **Stripe Billing** (compte plateforme, `STRIPE_SECRET_KEY` existant) : Checkout pour
   souscrire, factures/relances/impayés gérés par Stripe, Customer Portal pour la carte et
   les factures.
3. **Relance douce, jamais bloquer** : un club au-dessus du gratuit sans abonnement (ou en
   impayé durable) garde toutes ses fonctionnalités ; bannière + email de relance ; le
   super-admin voit le statut et décide.
4. **Membre actif = participation sur 90 jours glissants** (pas les `ClubMembership` bruts,
   créés à la volée et jamais expirés).
5. **Mensuel + annuel (-15 %)** dès la v1.

## 1. L'offre

| Palier | Membres actifs | Mensuel HT | Annuel HT (≈ -15 %) |
|---|---|---|---|
| 0 | 0 – 50 | 0 € | — |
| 1 | 51 – 150 | 29 € | 296 €/an |
| 2 | 151 – 400 | 59 € | 602 €/an |
| 3 | 401 – 800 | 99 € | 1 010 €/an |
| 4 | > 800 (plafond) | 149 € | 1 520 €/an |

Prix HT, TVA 20 % ajoutée par Stripe. Multi-club/franchise : sur devis (hors produit).

**Source de vérité unique** : constantes `PLATFORM_TIERS` dans
`backend/src/services/platformBilling/tiers.ts` + **miroir front**
`frontend/lib/platformTiers.ts` (pattern `level.ts` / `caisse.ts` — à garder synchronisés).
Fonctions pures : `tierFor(activeMembers): 0|1|2|3|4`, `tierPriceCents(tier, interval)`,
`tierLabel(tier)` (« 151 – 400 membres actifs »), bornes exportées pour la jauge.

## 2. Modèle de données — migration additive `add_platform_billing`

- `Club` :
  - `platformCustomerId String? @map("platform_customer_id")` — Customer Stripe du **compte
    plateforme** (≠ `ClubStripeCustomer`, qui vit sur les comptes Connect des clubs).
  - `activeMemberCount Int @default(0)` + `activeMemberCountAt DateTime?` — snapshot du
    metering nocturne (affichage jauge).
  - `billingExempt Boolean @default(false)` — clubs partenaires/pilotes exonérés par le
    super-admin (court-circuite relances et évaluations).
- **`PlatformSubscription`** (nom volontairement distinct du `Subscription` joueur) :
  `id`, `clubId @unique`, `stripeSubscriptionId @unique`, `status String` (miroir Stripe :
  `active`, `past_due`, `canceled`, `trialing`…), `tier Int` (1-4 souscrit),
  `interval String` (`month`|`year`), `currentPeriodEnd DateTime?`,
  `cancelAtPeriodEnd Boolean @default(false)`, timestamps. FK cascade sur club.
- **`ClubMemberSnapshot`** : `id`, `clubId`, `month String` (`YYYY-MM`, fuseau
  Europe/Paris), `activeMembers Int`, `observedTier Int`, `createdAt`.
  `@@unique([clubId, month])`. Alimente la règle « 2 mois consécutifs » et les graphes des
  deux UIs de suivi.

⚠️ Dev : appliquer via `prisma db execute` du SQL additif (dérive de base connue — jamais
`db push`/`migrate dev`) ; prod : `prisma migrate deploy`.

## 3. Metering « membres actifs »

`PlatformBillingService.countActiveMembers(clubId, now)` = **userIds distincts** sur la
fenêtre `[now − 90 j, +∞)` parmi :

- **Réservations CONFIRMED** du club (`resource.clubId`) avec `startTime ≥ now − 90 j`
  (les résas futures comptent : un joueur qui vient de réserver est actif) — organisateur
  (`Reservation.userId`) **et** participants (`ReservationParticipant.userId`).
- **Inscriptions tournois** non CANCELLED (`createdAt ≥ now − 90 j`) — capitaine + partenaire.
- **Inscriptions events** non CANCELLED (`createdAt` dans la fenêtre).
- **Inscriptions cours** (si modèle d'inscription leçon présent — vérifier le nom exact au plan).
- **Achats** : `MemberPackage` et `Subscription` (joueur) du club créés dans la fenêtre.

Implémentation : quelques `findMany`/`groupBy` `select userId distinct`, union en `Set`
côté JS. Les noms exacts des modèles/champs sont vérifiés à l'écriture du plan.

**Job `backend/src/jobs/platformBilling.job.ts`** (node-cron, comme `cleanup.job`) :
- **Nocturne 04:00** : recalcule `activeMemberCount`/`activeMemberCountAt` pour tous les
  clubs ACTIVE (les suspendus sont ignorés).
- **Mensuel, le 1ᵉʳ à 04:30 Europe/Paris** : pour chaque club ACTIVE non exempt — écrit le
  `ClubMemberSnapshot` du mois écoulé, applique les règles de palier (§5), déclenche
  relances/notifications. Idempotent par le `@@unique([clubId, month])` (re-run sans double
  effet).
- Au démarrage du job : `ensurePlatformPrices()` (§4), best-effort (échec loggé, ne bloque
  pas le boot).

## 4. Intégration Stripe Billing

Tout sur le **compte plateforme** (`stripe` client existant, sans `stripeAccount`).

- **Produits/prix** : `ensurePlatformPrices()` idempotent — 1 Product « Palova Club » +
  **8 Prices** retrouvés/créés par `lookup_key` (`palova_t{1-4}_{month,year}`), montants
  lus depuis `PLATFORM_TIERS`, `tax_behavior: 'exclusive'`, devise EUR. Aucun id de prix
  en `.env`.
- **TVA** : Tax Rate « TVA France 20 % » créé/retrouvé de façon idempotente, posé en
  `default_tax_rates` à la création de l'abonnement (Checkout `subscription_data`).
- **Souscription** : `POST /api/clubs/:clubId/admin/billing/checkout`
  (`requireClubMember('OWNER')`), body `{ interval: 'month'|'year', returnUrl }` (URL du
  front validée même pattern que le onboarding Connect). Crée/réutilise le Customer
  plateforme (`platformCustomerId`, email du gérant), puis Checkout Session
  `mode: 'subscription'` au **prix du palier observé courant** (`tierFor(activeMemberCount)`),
  `client_reference_id = clubId` + metadata `clubId`. Refus `NOTHING_TO_SUBSCRIBE` (409) si
  palier observé = 0, `ALREADY_SUBSCRIBED` (409) si un abonnement non-canceled existe.
- **Portal** : `POST …/billing/portal` (OWNER) → session Customer Portal (configuration
  créée programmatiquement si absente : historique de factures, changement de carte,
  annulation à échéance).
- **Webhook dédié** `POST /api/platform/billing/webhook` — secret propre
  `STRIPE_BILLING_WEBHOOK_SECRET` (séparé du webhook Connect `stripe-webhooks.ts` existant),
  raw body, événements :
  - `checkout.session.completed` → upsert `PlatformSubscription` depuis
    `session.subscription` (tier déduit du price `lookup_key`).
  - `customer.subscription.updated` / `deleted` → sync statut/tier/interval/période/
    `cancelAtPeriodEnd`.
  - `invoice.paid` / `invoice.payment_failed` → sync statut (`active`/`past_due`).
  Réponses 2xx systématiques après traitement ; événements inconnus ignorés.

## 5. Règles de changement de palier (jamais de blocage)

Évaluées au cron mensuel, par club non exempt. `observed` = palier du snapshot du mois,
`subscribed` = `PlatformSubscription.tier` (abonnement non-canceled).

- **Montée** (`observed > subscribed`) : seulement si le snapshot du **mois précédent**
  était déjà `> subscribed` (2 évaluations consécutives ; premier mois = comptage n° 1).
  → `stripe.subscriptions.update` avec le nouveau price, `proration_behavior: 'none'`
  → effectif **à la prochaine facture** (mois suivant en mensuel, renouvellement en
  annuel — le prix payé reste gelé sur la période en cours, aucun prorata).
  Email de préavis au gérant.
- **Descente** (`observed < subscribed`, `observed ≥ 1`) : dès **1 évaluation** (asymétrie
  en faveur du club), même mécanique de price swap sans prorata. Email d'information.
- **Descente à 0** (`observed = 0`) : pas de prix gratuit chez Stripe →
  `cancel_at_period_end: true` + email « votre club repasse au palier gratuit ». S'il
  regrossit ensuite, il refait un Checkout (carte conservée sur le Customer).
- **Sans abonnement et `observed ≥ 1`** : statut dérivé « à régulariser » — bannière
  persistante dans `/admin` + email de relance mensuel (cron). **Aucune fonctionnalité
  n'est jamais coupée.**
- **Impayé** : Stripe fait ses relances (dunning) ; on reflète `past_due` (bannière côté
  club, chip côté superadmin). Si Stripe finit par annuler → `canceled` → retour au cas
  « à régulariser » si `observed ≥ 1`.

Statut consolidé (helper pur `billingState`) : `EXEMPT | FREE | OK | TO_REGULARIZE |
PAST_DUE` — dérivé de (exempt, observed, subscription). Utilisé par les deux UIs.

## 6. Suivi côté club — page `/admin/billing`

Entrée sidebar « **Abonnement Palova** » (icône `wallet`). Contenu :
- **Jauge membres actifs** : compteur (`activeMemberCount`, daté), barre avec les seuils
  50/150/400/800, palier observé + prix correspondant.
- **État** : Gratuit (« Palova est gratuit jusqu'à 50 membres actifs ») / Actif (palier,
  cadence, montant, prochaine facture `currentPeriodEnd`, mention annulation programmée) /
  Impayé (bandeau) / À régulariser (bandeau + CTA).
- **Actions (OWNER seul, boutons masqués sinon)** : « Souscrire » avec choix
  mensuel | annuel -15 % → Checkout ; « Gérer mon abonnement & factures » → Portal.
- **Historique** : liste des `ClubMemberSnapshot` (12 derniers mois, membres + palier).
- **Bannière** orange sur le dashboard `/admin` quand `TO_REGULARIZE`/`PAST_DUE`
  (« Votre club dépasse le palier gratuit — souscrivez pour X €/mois → /admin/billing »).

Backend : `GET /api/clubs/:clubId/admin/billing` (`requireClubMember('ADMIN')`) → état
consolidé `{ activeMembers, countedAt, observedTier, tierPrice, state, subscription?,
snapshots[] }`. Front : types + `adminGetBilling` / `adminCreateBillingCheckout` /
`adminCreateBillingPortal` dans `lib/api.ts`.

## 7. Suivi côté super-admin

- **Dashboard `/superadmin`** : cartes **MRR** (somme des abonnements actifs ; annuel
  ramené au mois, en centimes), **clubs par palier** (0-4), **à régulariser**, **impayés**.
- **`/superadmin/clubs`** : colonnes membres actifs / palier / chip statut billing
  (Gratuit · Actif · À régulariser · Impayé · Exonéré) + action « Exonérer » (toggle
  `billingExempt`, `PATCH /api/platform/clubs/:id/billing-exempt`).
- Backend : `PlatformService.stats` et `listClubs` étendus (champs additifs).

## 8. Page publique `/tarifs` + FAQ

Réécriture de `PLATFORM_TARIFS` (`frontend/lib/platformContent.ts`) : grille par paliers,
« tout inclus dès le premier euro », « jamais plus de 149 € », **définition publique du
membre actif** (participation sur 90 jours), mensuel/annuel -15 %, prix HT, multi-club sur
devis. Mise à jour de l'entrée FAQ « Quelles sont les formules ? ». Les montants affichés
viennent du miroir `platformTiers.ts` (pas de nombres en dur dans le markdown si le
rendu le permet ; sinon dupliqués avec commentaire de synchro).

## 9. Emails (identité Palova)

3 gabarits dans `src/email/` (réutilisent `renderLayout` avec le branding Palova par
défaut ; **hors** registre des emails personnalisables par club — ce sont des emails
plateforme → gérant) :
1. Relance « palier gratuit dépassé » (mensuelle tant que `TO_REGULARIZE`).
2. Préavis de changement de palier (montée/descente, avec montant et date d'effet).
3. Confirmation de souscription (après `checkout.session.completed`).

Destinataire : email du user OWNER du club (repli `legalEmail`). Envoi best-effort
(pattern `safeNotify` — un échec SMTP ne casse jamais le cron ni le webhook). Les emails
d'impayé restent gérés par Stripe.

## 10. Config & déploiement

- `.env` : `STRIPE_BILLING_WEBHOOK_SECRET` (nouveau) — à ajouter à `.env.prod.example` et
  au pass-through `docker-compose.prod.yml`.
- Webhook à déclarer dans le dashboard Stripe (endpoint
  `https://api.palova.fr/api/platform/billing/webhook`, événements du §4).
- Dev sans Stripe configuré : la page `/admin/billing` affiche la jauge et l'état, les
  boutons Checkout/Portal renvoient l'erreur mappée `STRIPE_NOT_CONFIGURED`.

## 11. Tests

- **Backend** : `tiers.test.ts` (bornes exactes 50/51, 150/151, 400/401, 800/801, prix,
  plafond) ; `platformBilling.service.test.ts` (metering : fenêtres, distinct, sources,
  exclusion CANCELLED ; règles : montée 2 mois, descente 1 mois, descente à 0 → cancel,
  exempt court-circuite, à régulariser) ; `platform.billing.webhook.test.ts` (sync des 5
  événements, signature invalide 400) ; `admin.billing.routes.test.ts` (GET état consolidé,
  checkout OWNER-only 403, gardes 409).
- **Frontend** : `platformTiers.test.ts` (miroir) ; `AdminBilling.test.tsx` (jauge, états,
  boutons OWNER/ADMIN, erreurs mappées) ; bannière dashboard ; colonnes/chips superadmin ;
  `platformContent` (tarifs affichés).

## Hors périmètre v1 (assumé)

Prix fondateur gelé, coupons/remises, gating de fonctionnalités par plan, blocage
automatique (le super-admin peut toujours suspendre manuellement), changement de cadence
mensuel↔annuel en cours d'abonnement (annuler à échéance puis re-souscrire), Stripe Tax
automatique (tax rate fixe 20 % suffit), export comptable MRR, facturation des franchises.
