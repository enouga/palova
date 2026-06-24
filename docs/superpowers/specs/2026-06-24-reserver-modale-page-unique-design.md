# Refonte de la modale « Réserver » — page unique, créneau bloqué dès l'ouverture

**Date :** 2026-06-24
**Composant :** `frontend/components/BookingModal.tsx`
**Périmètre :** réservation d'un créneau depuis la grille `ClubReserve` + une **extension additive** de `confirmReservation` (backend) pour appliquer les partenaires/visibilité/niveau choisis après le blocage. **Hors périmètre :** déplacement/reschedule de réservation (géré ailleurs, n'utilise pas ce composant), modale du planning admin.

## 1. Contexte & problème

La modale actuelle se déroule en **deux écrans** :

1. **`confirm`** — gros prix (52 px) + tableau récap de 6 lignes (type de court, date, horaire, durée, prix/pers, annulation) + bouton **« Pré-réserver »**. Le créneau **n'est pas encore bloqué**.
2. **`pending`** — après « Pré-réserver », le hold est posé, un **anneau de compte à rebours de 132 px** domine l'écran, puis le choix du mode de paiement et la confirmation.

Reproches :
- Le haut prend **trop de place** (prix géant + tableau verbeux) et l'anneau de timer est démesuré.
- Il faut **deux clics / deux écrans** alors qu'on veut tout remplir d'un coup.
- Le créneau n'est bloqué qu'au 2ᵉ temps.

## 2. Objectif

Une **page unique** : à l'ouverture, le créneau est **immédiatement bloqué** (hold + verrou Redis, TTL 5 min). L'utilisateur remplit tout (joueurs, visibilité, paiement) sur cet écran, avec un **timer discret toujours visible**, et termine par **un seul bouton** dont le libellé s'adapte au mode de paiement. Les **conditions d'annulation du club** sont affichées en bloc d'info juste au-dessus du bouton.

## 3. Comportement cible

### 3.1 Blocage à l'ouverture (hold on mount)

- Au montage du composant, on appelle **immédiatement `api.holdSlot(...)`**. Comme l'utilisateur n'a encore rien choisi, ce hold initial est posé **sans partenaires, en `PRIVATE`, sans fourchette de niveau** (juste l'organisateur). Il pose le **verrou Redis** + crée la réservation `PENDING` qui réserve le créneau pendant 5 min.
- **Application des partenaires/visibilité/niveau via un endpoint dédié `applyHoldSetup` (backend, additif) :** à la validation, **avant** la confirmation/paiement, le front appelle un nouvel endpoint qui applique les choix sur la résa **PENDING** : revalider les partenaires (`validatePartners`, déjà présent), **remplacer les lignes `ReservationParticipant`** (`participantRows`, déjà présent) et mettre à jour `visibility`/`targetLevel*`. **Aucun re-hold, donc aucune fenêtre de course** : le même verrou Redis tient de l'ouverture à la confirmation.
  - **Pourquoi un endpoint séparé plutôt qu'étendre `confirmReservation` :** sur le chemin paiement en ligne, la confirmation est déclenchée par `StripePaymentStep` **et** par le webhook Stripe (`payment_intent.succeeded`) — le premier qui gagne finalise. Appliquer les joueurs **avant** le paiement les persiste quel que soit le confirmeur, sans course. `confirmReservation` et le webhook restent **inchangés**.
  - Quota inchangé : `assertQuota` compte les réservations de **l'organisateur**, pas des partenaires. La capacité (`TOO_MANY_PLAYERS`) est revalidée par `validatePartners`. Appelé **seulement** sur terrain multi-joueurs (`showPartners`) ; sinon ignoré.
- **Pendant le hold initial** (round-trip réseau) : la modale s'affiche déjà (toutes les infos du créneau viennent des props), avec un indicateur discret **« Blocage du créneau… »** à la place du badge timer, et le bouton final **désactivé**.
- **Succès** → le badge **« Créneau bloqué pour vous »** + le timer apparaissent, le bouton s'active.
- **Échec** (`SLOT_NOT_AVAILABLE`, `SLOT_ALREADY_HELD`, `QUOTA_*`, …) → bascule sur l'**écran d'erreur** : message clair (mapping `BOOKING_ERRORS` existant) + bouton **« Fermer »**. _(Décision : message clair + fermer, pas de blocage côté grille.)_

### 3.2 Page unique (fusion `confirm` + `pending`)

Suppression de l'écran `confirm` et du bouton « Pré-réserver ». Phases internes :

- **`holding`** — hold en vol (rendu complet + CTA désactivé + « Blocage du créneau… »).
- **`held`** — écran de remplissage unique (le cœur).
- **`stripe`** — étape de paiement Stripe inline (inchangée, rendue sous le contenu).
- **`error`** — message + Fermer.

(Plus de phase `pending` séparée ni de phase `confirm`.)

### 3.3 Timer 5 min discret

- `HOLD_SECONDS = 300` (inchangé, miroir backend).
- Remplacer l'anneau de 132 px par : une **barre fine en haut** de la modale qui se vide, + un **chip `⏱ m:ss`** (mono, tabular-nums) en haut à droite.
- **Sous 60 s** : barre + chip passent en **coral/rouge** (`ACCENTS.coral` / `th` équivalent).
- À **0:00** → bascule `error` : « La pré-réservation a expiré. Veuillez recommencer. » (comportement actuel conservé).

### 3.4 Header — carte présente mais compacte

Remplacer le prix 52 px + tableau 6 lignes par une **carte hero** unique (fond légèrement teinté accent) :
- **Nom du court** (≈ 22–23 px, gras) + **badge format** (Single/Double).
- **Date** en toutes lettres (≈ 14,5 px).
- **Créneau** `18h00 → 19h30 · 1h30` + **tag « heures creuses »** si `slot.offPeak`.
- **Prix total** à droite (≈ 34–36 px) + sous-texte `≈ {part}€ / pers · {capacité} j.`.

Densité intermédiaire : nettement plus léger que le tableau actuel, mais plus présent que la version « une ligne » jugée trop discrète.

### 3.5 Joueurs · visibilité · niveau (terrains multi-joueurs)

Bloc inchangé fonctionnellement, regroupé sous le label « Joueurs · membres du club » :
- Chips partenaires (avatar coloré `colorForSeed`, niveau, retrait) + `PartnerSearch`.
- Segmented **Partie privée / Partie ouverte** + phrase d'aide (places restantes).
- Si **ouverte** et système de niveau actif : interrupteur **« Limiter le niveau »** + `LevelRangeSlider`, mémorisé (`loadLevelPref`/`saveLevelPref`).
- Ligne « ≈ {perPlayer}€ par joueur ({nbPlayers} joueurs) » si > 1 joueur.

### 3.6 Paiement

Cartes empilées (mutuellement exclusives), même logique d'avenues qu'aujourd'hui :
- **Couvert par abonnement** (si `coveringSubscription` ≠ null) — sélectionné par défaut.
- **Régler au club** (caché si `requireOnlinePayment`).
- **Payer en ligne** (si `stripeActive` ou imposé) — **voir 3.7**.
- **Carnets prépayés** (boutons, paient le total depuis le solde).

### 3.7 Paiement en ligne = uniquement la part du joueur *(changement)*

- **Suppression du choix « Ma part / Total »** (`payAmount`).
- En ligne, on règle **toujours la part** = `total ÷ capacité` où la capacité = **`capacityFor(sportKey, format)`** (nombre de joueurs du sport × type single/double) — c.-à-d. `shareCents`/`perPerson` déjà calculés.
- L'option affiche `Payer en ligne ma part` + sous-texte `{total}€ ÷ {capacité} joueurs` + montant `{part}€`.
- **Cas limite** : si la part `< 0,50 €` (minimum Stripe → backend `AMOUNT_TOO_SMALL`), on **règle le total** (repli `shareTooSmall` existant) avec une mention discrète. Quasi impossible au padel.
- `StripePaymentStep` reçoit `payShare = !shareTooSmall` (au lieu du toggle), `amountLabel` = part (ou total en repli).

### 3.8 Conditions d'annulation (bloc d'info)

- **Bloc dédié** (icône + titre « Conditions d'annulation » + texte) **toujours affiché**, juste au-dessus du bouton.
- Texte via **`cancellationPolicyLabel(cancellationCutoffHours, refundOnCancelWithinCutoff)`** (helper existant, valeurs issues des réglages admin du club, déjà passées en props).
- **Info seule — aucune case à cocher obligatoire.** _(Décision.)_
- La carte hero + le bloc joueurs + le paiement étant sur la même page, **toutes les infos de la réservation sont visibles au moment de cette validation** (exigence « toutes les infos doivent apparaître sur la validation des conditions d'annulation »).

### 3.9 Case CGV (paiement CB en ligne uniquement)

- Conservée **uniquement sur le `cardIntentPath`** (paiement en ligne ou empreinte bancaire) — imposée par Stripe/légal. Logique `cgvAccepted` / `cgvStatus` (publié vs repli plateforme) **inchangée**.

### 3.10 Bouton final adaptatif

Un seul bouton, libellé selon le mode sélectionné :
- Abonnement → **« Confirmer avec mon abonnement »**
- Carnet/solde → **« Confirmer avec mon solde »**
- En ligne → **« Valider le paiement · {part}€ »**
- Régler au club → **« Confirmer la réservation »**

Désactivé tant que le hold n'est pas posé, ou si `cardIntentPath && !cgvAccepted`, ou si paiement en ligne requis mais indisponible.

### 3.11 Fermeture

`handleClose` inchangé : si un hold est posé (phases `held`/`stripe`), on **annule la réservation** (`api.cancelReservation`) puis `onClose()`. Le clic sur l'overlay ferme aussi.

## 4. États & transitions

```
ouverture
  └─ holding ──(holdSlot ok)──▶ held ──(confirm: club/abo/carnet)──▶ onConfirmed()
        │                          │
        │                          └─(confirm: cardIntentPath)──▶ stripe ──(ok)──▶ onClose()
        └─(holdSlot échoue)──▶ error                                  └─(annuler)─▶ held
  held ──(timer 0:00)──▶ error
  held/stripe ──(fermer/overlay)──▶ cancelReservation + onClose()
```

Cas particuliers conservés :
- `INSUFFICIENT_BALANCE` à la confirmation carnet → on retire le carnet, message, reste en `held`.
- `CARD_FINGERPRINT_REQUIRED` (donnée club périmée) → `fingerprintForced`, bascule tunnel empreinte, reste en `held`.
- `SLOT_NO_LONGER_AVAILABLE` à la confirmation → `error`.

## 5. Composant — structure

Rester dans `BookingModal.tsx`. Extraire si utile (lisibilité, le fichier grossit) :
- `BookingHeader` — la carte hero (court/date/créneau/prix).
- `BookingTimer` — barre fine + chip, état coral.
- `CancellationNotice` — le bloc d'info annulation.

Les helpers purs restent : `capacityFor`/`courtFormat` (`lib/courtType`), `cancellationPolicyLabel` (`lib/reservations`), `coveringSubscription`/`coverageLabel`, `packageLabel`/`canCover`. Côté backend, réutilisation de `validatePartners`/`participantRows` (aucun nouvel helper) — voir §7 pour l'ajout de `applyHoldSetup`.

## 6. Tests

Suites existantes à mettre à jour (elles supposent l'écran `confirm` + « Pré-réserver ») :
- `__tests__/BookingModal.test.tsx`, `BookingModal.packages.test.tsx`, `BookingModal.payment.test.tsx`, `BookingModal.subscription.test.tsx`.

Cas à couvrir :
1. **Hold à l'ouverture** : `holdSlot` appelé au montage (sans interaction) ; pendant le hold, CTA désactivé ; après succès, badge « bloqué » + timer visibles, CTA actif.
2. **Échec du hold** → écran d'erreur + « Fermer », message mappé (`SLOT_NOT_AVAILABLE`, `QUOTA_PEAK_REACHED`).
3. **Fermeture après hold** → `cancelReservation` appelé.
4. **Paiement en ligne = part** : le montant affiché et `payShare` correspondent à `total ÷ capacité` ; repli total si part < 0,50 €.
5. **Bouton adaptatif** : libellé correct par mode (club / en ligne / abo / carnet).
6. **Conditions d'annulation** : bloc affiché avec le texte `cancellationPolicyLabel`, sans case obligatoire.
7. **CGV** : case présente seulement sur le chemin CB en ligne, et bloque la validation tant que non cochée.
8. **Timer** : expiration → écran d'erreur « expiré ».
9. **Partenaires/visibilité transmis** : sur terrain multi-joueurs, `applyHoldSetup` est appelé (avant `confirmReservation`/Stripe) avec `partnerUserIds`/`visibility`/niveau ; sur terrain simple, il **n'est pas** appelé.

⚠️ jsdom : timers (`jest.useFakeTimers`) pour le compte à rebours ; mocks `lib/api` doivent exposer `holdSlot`, `confirmReservation`, `cancelReservation`, `applyHoldSetup`, `getMyRating`, `getClubPage`, `assetUrl`.

**Backend** (`reservation.service.test.ts`) : `applyHoldSetup` → participants remplacés (organisateur + partenaires), visibilité/niveau mis à jour ; `TOO_MANY_PLAYERS` si dépassement de capacité ; refus si la résa n'est pas PENDING ou pas possédée par l'utilisateur.

## 7. Backend (ajout additif, ciblé)

- **Nouvelle méthode `applyHoldSetup(reservationId, userId, { partnerUserIds?, visibility?, targetLevelMin?, targetLevelMax? })`** (`reservation.service.ts`) : exige la résa **PENDING**, possédée par `userId`, non expirée ; revalide les partenaires (`validatePartners`) ; dans une transaction, **remplace** les `ReservationParticipant` (`deleteMany` + `createMany` via `participantRows`, split sur `totalPrice`) et met à jour `visibility`/`targetLevelMin`/`targetLevelMax`. Réutilise `validatePartners`/`participantRows` — **aucun nouvel helper**.
- **Nouvelle route `POST /api/reservations/:id/setup`** (auth) : relaie le body vers `applyHoldSetup`, mappe les erreurs (`PARTNER_DUPLICATE`/`PARTNER_NOT_MEMBER`/`TOO_MANY_PLAYERS` → 409/400, `RESERVATION_NOT_PENDING` → 409, `UNAUTHORIZED` → 403).
- **Front** `api.applyHoldSetup(reservationId, token, params)` : appelée par la modale **avant** `confirmReservation`/Stripe, uniquement si terrain multi-joueurs.
- **`confirmReservation`, la route `/confirm` et le webhook Stripe : inchangés.**

## 8. Hors périmètre

- Déplacement/reschedule de réservation, modale du planning admin.
- Paiement CB hors Stripe ; remboursement auto à l'annulation.
- Mémorisation du mode de paiement entre réservations.

## 9. Décisions (validées)

1. **Blocage à l'ouverture** ; échec → message clair + Fermer.
2. **Conditions d'annulation = bloc d'info**, sans case (CGV conservée pour CB en ligne).
3. **Bouton adaptatif** selon le mode de paiement.
4. **Paiement en ligne = part du joueur** (`total ÷ capacité`), repli total si < 0,50 €.
5. **Header = carte compacte mais présente** (pas le tableau de 6 lignes, pas la ligne unique trop discrète).
6. **Timer discret** (barre + chip), coral sous 60 s, à la place de l'anneau.
