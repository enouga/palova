# Superadmin v2 — pilotage plateforme (design)

## Contexte

Le propriétaire de Palova veut piloter sa plateforme : gérer les clubs, suivre et agir sur les
paiements SaaS des clubs, et voir des stats d'utilisation. Le socle superadmin (v1) existe
(dashboard 7 compteurs, table clubs avec suspendre/exonérer/alias/créer, CRUD sports) mais reste
superficiel côté clubs et quasi absent côté facturation ; les stats agrégées n'existent pas.

Contrainte perf : **aucun ralentissement du site**. Tout est on-demand derrière `requireSuperAdmin`,
jamais exécuté pour les joueurs ou les clubs ; les agrégations s'appuient sur les snapshots mensuels
déjà en base (`ClubMemberSnapshot`) et des `$queryRaw` ponctuels. Pas de cache en v1.

## Trois piliers

1. **Fiche club détaillée** `/superadmin/clubs/[id]` + recherche dans la table.
2. **Facturation superadmin** : vue riche par club (palier souscrit, cadence, échéance, factures) +
   actions sur l'abonnement (changer palier, annuler à échéance, réactiver) + page vue d'ensemble.
3. **Stats d'utilisation** : croissance (clubs/joueurs/réservations par mois), activité par club,
   revenus SaaS (CA encaissé/mois, répartition paliers).

## Décision technique clé — persistance des factures

Le webhook `invoice.paid`/`payment_failed` ne persistait que `PlatformSubscription.status`. Pour un
historique CA fiable, on ajoute une table **`PlatformInvoice`** (miroir local des invoices Stripe),
alimentée par le webhook (upsert idempotent par `stripeInvoiceId`) + une route de synchronisation
superadmin qui pagine l'API Stripe (backfill + rattrapage de webhook raté). Résolution du club via
`customer` → `Club.platformCustomerId`. Types Stripe structurels inline (le namespace `Stripe.*` ne
résout pas sous le tsconfig ; tolérer lookup_key pré-Basil et repli sur `PlatformSubscription`).

## Actions sur l'abonnement

Réutilisent la plomberie `stripeBilling.ts` : changement de palier = price swap `proration_behavior:
'none'` (effectif à la prochaine facture, jamais de prorata) ; annulation = `cancel_at_period_end` ;
réactivation = remise à false. Wrappers avec gardes (`NO_SUBSCRIPTION` 409, `TIER_INVALID` 400). La
mise à jour DB locale est immédiate ; le webhook `subscription.updated` resynchronise de toute façon.

## Réutilisation

- Charts SVG maison existants : `MonthlyRevenueChart` (via pont `centsSeriesToDecimal`), pattern
  répliqué en `CountBarsChart` pour les compteurs mensuels.
- `MemberGauge` (jauge seuils 50/150/400/800) et `ChangeSlugDialog` extraits en composants partagés.
- Paliers : miroir front `lib/platformTiers.ts` (ne rien dupliquer).

## Hors v1

Cache/agrégats pré-calculés des stats, export CSV, remboursement de facture depuis l'UI, emails
superadmin, changement de cadence seul (passe par le dialog de palier), pagination serveur de la table.
