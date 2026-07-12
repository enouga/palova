# Modale planning au look « Caisse » + option « paiement au club » + moyens Chèque/CLUB

Date : 2026-07-12 · Statut : ✅ implémenté

## Contexte & objectif

La modale d'encaissement du planning (`/admin/planning`) utilisait `CollectPanel` (lignes joueur
avec bouton « Régler » + choix de moyen en bas). Le gérant veut la **même expérience que la page
Caisse** (`/admin/encaissement`, composant `CashRegister`) : sélectionner les joueurs **en cliquant
la ligne**, gros montant, tap sur le moyen = encaissé. Il veut aussi une **option club « paiement au
club »** : un seul bouton d'encaissement, sans choix de moyen — et s'assurer que **notre liste de
moyens est exhaustive** face aux concurrents.

## Benchmark concurrents (recherche web)

- **Playtomic Manager** — réglage « Onsite Payment Methods » : le club définit ses moyens et
  **marque une résa comme payée à la réception** (activable/désactivable). Split vs single payment.
- **Gestion Sports (GS Cash)** — espèces, CB (TPE), tickets resto, bons cadeaux, points de fidélité ;
  « paiement divisé : chacun sa part en un clic » ; certifié **NF525**.
- **Doinsport** — caisse centralisée (en ligne / sur place / virement / prélèvement), certifié **LNE**.
- **Aides FR** — Chèque-Vacances / Coupon Sport ANCV / Pass'Sport traités comme moyens distincts
  (AssoConnect, Sportsregions).
- **Conséquence NF525/LNE** : un encaissement sur place **compte toujours dans le CA**. → l'option
  « paiement au club » enregistre un **vrai paiement** (pas un pointage hors-compta).

## Décisions

1. **Modale planning = look Caisse** : réutiliser `CashRegister` (pas re-styler `CollectPanel`).
2. **Bouton unique « Encaissé »** = vrai encaissement sous moyen neutre **`CLUB`** (« Au club »),
   compte dans le CA (option 1 validée).
3. **Look Caisse** appliqué à la **modale planning uniquement** ; l'option club, elle, s'applique
   partout (planning + page Caisse + modale Détails de Paiements).
4. **Exhaustivité** : ajouter **Chèque** (`CHEQUE`) ; ANCV/Coupon Sport restent sous « Ticket CE »
   (champ émetteur). Bon cadeau / ardoise / points fidélité / moyens 100 % personnalisables = parqués.

## Architecture

### Backend (migration additive `add_pay_at_club_and_payment_methods`)
- Enum `PaymentMethod` + **`CHEQUE`** (chèque papier) et **`CLUB`** (« Au club »).
- `Club.payAtClubOnly Boolean @default(false)`.
- `CHEQUE`+`CLUB` ajoutés à **`MONEY_METHODS`** (accounting / package / memberStats) → comptés dans
  le CA / Ventes & journée. `CHEQUE` ajouté à `QUICK_PAYMENT_METHODS` (moyen rapide sélectionnable).
  `CLUB` **hors** quick (réservé au bouton unique).
- `addPayment` : `CHEQUE`/`CLUB` ajoutés à la whitelist de méthodes (sinon repli CASH).
- `club.service` : `payAtClubOnly` dans `getClubForAdmin` (select) + `updateClub` (param/data).
- DEV : `prisma db execute` (enum `ADD VALUE IF NOT EXISTS` + `ADD COLUMN IF NOT EXISTS`) + `generate`.
  Prod : `migrate deploy`.

### Frontend
- Types (`lib/api.ts`) : union `PaymentMethod` + CHEQUE/CLUB ; `payAtClubOnly` sur `ClubAdminDetail`
  et `UpdateClubBody`. Libellés/icônes complétés dans **tous** les `Record<PaymentMethod,…>`
  (`caisse.ts`, `accounting.ts`, `payments.ts`, `DayJournal`, `Receipt`, `ReservationCollect`,
  `CashRegister`, `CollectPanel`, pages planning/reservations/encaissement). Icônes : Chèque=`ticket`,
  Au club=`home`. `DayJournal.MONEY_METHODS` (miroir front) += CHEQUE/CLUB.
- **`CashRegister.payAtClubOnly`** : en mode ON, la grille de moyens (+ carnet/porte-monnaie) est
  remplacée par un unique bouton « Encaissé · {selTotal} » → `paySelection('CLUB')`. Toast z-index
  45→55 (au-dessus d'une modale). 
- **`CollectPanel.payAtClubOnly`** : en mode ON, la section moyens (primaires/secondaires/packages/
  presets/voucher/other) est remplacée par un bouton « Encaissé · {montant} » → `payNow('CLUB')`.
- **Modale planning** : `CollectPanel` → `CashRegister` (props `registerMethods`, `payAtClubOnly`,
  `onOptimisticPay/Refund` via `applyPaymentLocally/applyRefundLocally` qui patchent `selected`+grille,
  `onOpenDetails` → modale **Détails** = `CollectPanel`, `onCancel` → `confirmCancel`). Bandeau d'état
  masqué hors résa annulée (l'en-tête de `CashRegister` porte le reste). Historique inline conservé.
  Déclencheur « Annuler la réservation » unique (pied de `CashRegister`).
- **Réglages** (`/admin/settings`) : case « Paiement au club — encaissement en un clic » (masque la
  liste des moyens rapides quand active) ; `payAtClubOnly` ajouté au body de `save`.

## Tests
- Back : `club.service` (payAtClubOnly select+update). Les `MONEY_METHODS`/whitelist sont couverts
  par les suites accounting/package/reservation existantes (toujours vertes).
- Front : `AdminPlanning` réécrit (tuiles cliquables, boutons CB, « Tout le reste » → Soldé, place
  vide anonyme, lien Détails, mode payAtClubOnly), `CollectPanel`/`CashRegister` (bouton unique CLUB).
- ⚠️ `AdminCaisse.test` : 1 échec **pré-existant** (WIP parallèle sur `PlayerPicker` retirant l'email
  de l'affichage — indépendant de ce travail).
- Vérif CDP clair+sombre : look Caisse (tuiles + CB/Chèque/…) sans scroll, et mode « au club »
  (bouton unique « Encaissé »).

## Hors périmètre (parqué)
Moyens 100 % personnalisables par club (à la Playtomic), bon/carte cadeau, ardoise/compte client,
points de fidélité, session de caisse espèces (fond/clôture/Z), look Caisse sur la modale de Paiements.
