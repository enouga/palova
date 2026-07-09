# Encaissement — un job par surface (réorganisation légère)

**Date : 2026-07-09**

## Problème

Le back-office alignait **quatre** surfaces d'argent dans la même section « Au quotidien »
(Planning + « Encaissement » `/admin/reservations` + « Caisse express »
`/admin/encaissement` + « Caisse » `/admin/caisse`), plus « Comptabilité » ailleurs. Les
trois surfaces d'encaissement de créneaux font le **même job** (encaisser une réservation)
avec trois UX différentes — strates d'itérations successives — sans hiérarchie qui dise
laquelle utiliser. Le gérant ne savait pas laquelle choisir.

Fait technique : les trois partagent **le même moteur** — composant `CollectPanel` (modale
« Détails »), helpers `lib/caisse.ts`, backend `addPayment` (garde `PAYMENT_EXCEEDS_DUE`,
transaction Serializable). Chaque surface rapide n'ajoute qu'**une** exclusivité au-dessus
de ce socle.

## Benchmark concurrence

Modèle constant chez tous les acteurs étudiés (Playtomic Manager, Eversports Manager,
Gestion Sports, Doinsport) : **un comptoir + une liste de contrôle + une caisse produits
optionnelle**, jamais trois comptoirs concurrents.

- **Comptoir (depuis le planning / une file)** : marquer payé au fil de l'eau. Playtomic
  « mark all / one player as paid » avec moyens « onsite » personnalisables ; Eversports ✓
  dans le calendrier.
- **Liste transversale de contrôle** : Playtomic « Payments Section » (onglet Pending,
  filtres date/statut/moyen), Eversports « Financials > Invoices ». Sert au contrôle et aux
  remboursements, **pas** à l'encaissement primaire.
- **Caisse / POS optionnelle** : Playtomic Store/POS + Cash Register à sessions (fond de
  caisse, audit, clôture) ; GS Cash / Doinsport = module NF525 séparé, jamais imposé
  (en France la certification NF525 rend ce choix structurel).

## Décision — un job par surface (routes inchangées, seuls les libellés bougent)

| Route | Avant | Après | Job |
|---|---|---|---|
| `/admin/encaissement` | « Caisse express » (Au quotidien) | **« Caisse »** (Au quotidien) | Le comptoir : file + montant annoncé + tap moyen + undo + auto-avance |
| `/admin/caisse` | « Caisse » (Au quotidien) | **« Ventes & journée »** (Au quotidien) | Vente carnets/abos, tickets CE, récap du jour |
| `/admin/reservations` | « Encaissement » (Au quotidien) | **« Paiements »** (déplacée dans **Finances**, en tête) | Contrôle : impayés, remboursements, reçus, filtres riches |
| Pop-up planning | — | inchangée | Raccourci contextuel (encaisser la résa affichée) |

## Changements

1. **Nav & titres** (`frontend/app/admin/layout.tsx`, `<h1>` des 3 pages).
2. **Filtres statut & moyen rebranchés sur « Paiements »** : les helpers purs
   `statusFilter` (StatusMode all|unpaid|partial|paid|cancelled) et `hasAnyMethod`
   existaient dans `lib/collect.ts`, testés mais non branchés. Ajoutés en **props
   optionnelles** de `ReservationFilters` (radiogroup « Statut » + chips « Moyen » des
   moyens présents le jour) → rendus seulement sur `/admin/reservations` (la Caisse express
   garde sa barre allégée). Le statut remplace le masquage des annulées : mode `cancelled`
   les affiche, les autres modes ne montrent que l'actif.

## Hors périmètre (parqué)

Session de caisse espèces (fond/clôture/écart, type Playtomic Cash Register), article libre
(nom+prix au vol), relance d'impayés, remboursement auto à l'annulation, fusion éventuelle
de `/admin/caisse` dans la Comptabilité, « mode simple » de pointage payé (réglage club,
pattern `quickPaymentMethods`).

## Vérification

- Suites front : `AdminLayout`, `AdminReservations` (filtres statut/moyen/reset),
  `AdminEncaissement`, `ReservationCollect`, `collect` — vertes.
- `tsc --noEmit` propre.
- Visuel : sidebar (3 sections), titres des 3 pages, filtres Paiements (statut annulées,
  chips moyen) en clair + sombre.
