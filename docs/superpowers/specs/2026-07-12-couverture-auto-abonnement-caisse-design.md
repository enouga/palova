# Couverture automatique par abonnement en Caisse & Planning

Date : 2026-07-12 · Statut : ✅ implémenté (2026-07-13 — avec garde-fous anti-sur-encaissement : plafond au reste dû global de la résa, pas de double soustraction du déjà-payé)

## Contexte & objectif

En Caisse (`/admin/encaissement`) comme au Planning (`/admin/planning`), un joueur abonné dont le
créneau respecte les règles de son abonnement (sport couvert, heures pleines/creuses) apparaît
comme n'importe quel joueur non payé — le personnel doit reconnaître qu'il est abonné et cliquer
manuellement le bouton générique « Abo / Membre » (`PaymentMethod.MEMBER`), qui n'enregistre qu'un
paiement « sans argent » non lié à un abonnement réel, sans aucune vérification (sport, heures
creuses, plafond jour/semaine).

Le parcours de réservation en ligne, lui, sait déjà faire cette vérification proprement
(`SubscriptionService.coverageFor`, méthode `PaymentMethod.SUBSCRIPTION`, plafonds jour/semaine,
couverture `INCLUDED` ou `DISCOUNT`) — mais seulement pour l'organisateur, au moment où il choisit
explicitement « Confirmer avec mon abonnement ». Rien ne relie un abonnement à un encaissement fait
a posteriori au comptoir.

**Objectif** : quand une réservation COURT apparaît en Caisse ou au Planning, toute place (titulaire
ou participant) dont le joueur a un abonnement actif couvrant le créneau doit automatiquement
apparaître « ✓ réglé · Abonnement », sans action du personnel — en enregistrant un vrai paiement
(pas un simple affichage), pour que ça se répercute partout ailleurs (page Paiements, reçus,
comptabilité) sans logique dupliquée.

## Décisions

1. **Automatique, sans clic** : dès que la réservation apparaît en Caisse/Planning, la couverture est
   appliquée avant même que le personnel ouvre la tuile — pas un bouton à confirmer.
2. **Par joueur, individuellement** : sur une résa à plusieurs joueurs, chaque place (titulaire ou
   participant) est vérifiée séparément contre les abonnements du joueur qui l'occupe.
3. **Le bouton manuel « Abo / Membre » est conservé** comme filet de rattrapage pour les cas non
   couverts automatiquement (abonnement absent du système, accord ponctuel, etc.).
4. **Vrai paiement, pas un affichage cosmétique** : on réutilise `PaymentMethod.SUBSCRIPTION` et
   `sourceSubscriptionId` (déjà au schéma, déjà utilisés par le flux de réservation en ligne) —
   aucune migration nécessaire.

## Architecture

### Backend

Nouvelle fonction **`ReservationService.autoApplySubscriptionCoverage(clubId, date?)`**
(`reservation.service.ts`, à côté d'`addPayment` dont elle reprend les patterns) :

- Reprend la même fenêtre de date que `listClubReservations` (bornes UTC du jour `date`), filtrée aux
  réservations **COURT** au statut **CONFIRMED**. Inclut `resource.clubSport.sport.key`,
  `resource.club.{offPeakHours,timezone}`, `participants`, `payments` (avec `refundedAmount`).
- Pour chaque réservation, reconstruit les « places » comme `addPayment` : pas de participants →
  une place (titulaire, `dueCents` = prix total ou tarif du terrain en repli) ; sinon, une place par
  participant (`dueCents` = sa `share`). Calcule le déjà-payé de chaque place (somme des paiements
  liés moins remboursements) ; place déjà soldée → ignorée.
- Pour chaque place encore due avec un `userId` identifié : cherche parmi les abonnements **actifs et
  non expirés** de ce joueur sur le club (une requête groupée en amont pour tous les joueurs
  concernés, pas de N+1) le premier qui couvre le créneau via `SubscriptionService.coverageFor`
  (sport + `offPeakOnly`, calcul `isOffPeak` via `classifySlot` déjà importé dans ce fichier).
- Vérifie le plafond jour/semaine de l'abonnement retenu (même requête de comptage que la branche
  `SUBSCRIPTION` de `confirmReservation`, sur `method:'SUBSCRIPTION', sourceSubscriptionId`).
- Si couvert et sous plafond : **transaction Serializable par réservation** qui re-vérifie le reste dû
  au moment d'écrire (protège d'une course avec un encaissement manuel concurrent), puis crée
  `Payment { reservationId, participantId, clubId, amount: coverCents/100, method:'SUBSCRIPTION',
  sourceSubscriptionId, receiptNo }`. `createdByUserId: null` (paiement système, pas d'agent humain).
- Abonnement **DISCOUNT** : seule la part couverte (`coverCents`) est réglée ; le reste continue
  d'apparaître à encaisser normalement — aucun traitement spécial requis, `slotStatuses` gère déjà les
  paiements partiels par place.
- Retourne `{ applied: number }` (nombre de paiements créés) — utile pour les tests, pas exploité
  par le front.

Nouvelle route **`POST /api/clubs/:clubId/admin/reservations/auto-apply-subscriptions?date=YYYY-MM-DD`**
dans `admin.ts`, sous le `requireClubMember('STAFF')` déjà appliqué à tout le routeur (même niveau
d'accès que le reste de la Caisse).

### Frontend

Aucun changement dans `CashRegister`/`QueueList` (le libellé « Abonnement » et l'icône existent déjà
dans leurs `METHOD_LABEL_FULL`/`METHOD_ICON`). Le bouton « annuler » d'une place réglée fonctionne
déjà pour n'importe quelle méthode de paiement — un paiement auto-appliqué reste donc annulable par
le personnel comme n'importe quel autre.

- `lib/api.ts` : `adminAutoApplySubscriptions(clubId, date, token)`.
- `app/admin/encaissement/page.tsx` : dans `load()` et `reloadReservations()`, appel de
  `adminAutoApplySubscriptions` **avant** `adminGetReservations`, avec le même `date`. Best-effort
  (échec avalé silencieusement, comme `reloadPackages` — ne bloque jamais l'encaissement manuel).
- `app/admin/planning/page.tsx` : même appel avant son propre chargement des réservations du jour.

## Hors périmètre

- Réservations **EVENT** (pas de notion de sport/heures creuses par place).
- Réservations **PENDING** ou **annulées**.
- Page **Paiements** (`/admin/reservations`, lecture/contrôle) : ne déclenche pas le balayage —
  profite quand même des paiements déjà posés par Caisse/Planning.
- Pas de bascule club pour désactiver ce comportement : sans `SubscriptionPlan` configuré, la
  fonction ne trouve rien à appliquer (no-op, coût négligeable).
- Choix entre plusieurs abonnements couvrants du même joueur : premier trouvé, pas de priorité
  explicite (cas rare en pratique).

## Tests

- Backend : `reservation.service.test.ts` — couverture `INCLUDED` totale, `DISCOUNT` partielle
  (reste dû), non-couverture (sport/heures ne correspondent pas → rien n'est créé), plafond
  jour/semaine atteint (rien n'est créé), place déjà réglée (ignorée), par-participant (chaque place
  vérifiée séparément), résa EVENT/PENDING/annulée ignorée. Route test pour
  `POST .../auto-apply-subscriptions`.
- Frontend : `AdminEncaissement.test.tsx` et `AdminPlanning.test.tsx` — l'appel à
  `adminAutoApplySubscriptions` a bien lieu avant le chargement des réservations ; son échec
  n'empêche pas la page de charger.
