# Partie ouverte : déplacer l'interrupteur de la modale de confirmation vers l'écran de succès

## Contexte

Aujourd'hui, deux mécanismes distincts permettent d'ouvrir une réservation padel multi-joueurs
aux membres du club :

1. **`BookingModal.tsx`** (avant confirmation, phase `held`) : un interrupteur « Partie ouverte
   aux membres » (`showPartners && isPadel`). S'il est activé, `persistHoldSetup()` appelle
   `api.applyHoldSetup(reservationId, ..., { visibility: 'PUBLIC', targetLevelMin/Max })` juste
   avant `confirmReservation` (ou dans le `beforeSubmit` du paiement Stripe).
2. **`OpenMatchToggle.tsx`** (après confirmation, rendu par `ReservationPlayersInline` dans
   `BookingSuccess.tsx` et dans les surfaces calendrier `DayPanel`/`MyAgendaListItem`/
   `ReservationAgendaCard`) : un bouton « Ouvrir la partie » qui déplie une fourchette de niveau
   réglable (slider) + bouton Publier, agissant sur `api.setReservationVisibility` (résa déjà
   CONFIRMED).

Les deux couvrent le même besoin (rendre la partie publique, avec fourchette de niveau
optionnelle) à deux moments différents, ce qui duplique la logique et alourdit la modale de
confirmation.

## Objectif

Déplacer l'interrupteur simple (sans slider) de la modale de confirmation vers l'écran de succès
qui la suit, en dupliquant son UI/UX telle quelle (pas de fusion avec `OpenMatchToggle`, qui reste
utilisable ailleurs pour un réglage plus fin).

## Design

### 1. `BookingModal.tsx` — nettoyage

Suppression complète du bloc « Partie ouverte aux membres » (`showPartners && isPadel`) et de
tout ce qui ne sert qu'à lui :

- État : `openMatch`/`setOpenMatch`, `levelLimited`/`setLevelLimited`, `levelMin`/`setLevelMin`,
  `levelMax`/`setLevelMax`.
- L'effet de préchargement de la préférence de niveau (pref mémorisée sinon
  `api.getMyRating` ±1, clampé 1–8).
- La fonction `persistHoldSetup` et ses deux appels (`handleConfirm`, `beforeSubmit` de
  `StripePaymentStep`).
- Les variables/imports devenus morts : `isPadel` (`sportKey === 'padel'`), `levelForSport`,
  `levelEnabled` (`useLevelSystemEnabled`), imports `loadLevelPref`, `useLevelSystemEnabled`,
  `sportHasLevels`.

`BookingModal` ne fait plus aucun appel à `api.applyHoldSetup` : une réservation confirme
toujours PRIVATE ; joueurs et ouverture se règlent entièrement après confirmation, sur l'écran
de succès.

### 2. Nouveau composant `frontend/components/reservations/OpenMatchQuickSwitch.tsx`

Reprend l'UI de l'ancien bloc de `BookingModal` (label de section « Votre partie », switch
« Partie ouverte aux membres », texte d'aide sous le switch), branché sur l'API
post-confirmation :

- Props : `reservation: MyReservation`, `token: string`, `onChanged: () => void`.
- Ne se rend que pour le padel (`reservation.resource.sport?.key === 'padel'`) — même règle
  métier que partout ailleurs (« parties ouvertes = padel uniquement »).
- État initial dérivé de `reservation.visibility === 'PUBLIC'` (source de vérité serveur, pas
  un état local découplé).
- Préchargement de la fourchette de niveau : identique à l'ancien comportement de
  `BookingModal` — préférence mémorisée (`loadLevelPref`) sinon centrée sur le niveau du joueur
  ±1 (clampé 1–8, via `api.getMyRating`) ; gaté par `useLevelSystemEnabled()` +
  `sportHasLevels(sportKey)`. Ne mémorise jamais la préférence lui-même (comme avant — seul
  `OpenMatchToggle` avec son slider écrit la préférence).
- Bascule ON → `api.setReservationVisibility(id, 'PUBLIC', token, { targetLevelMin, targetLevelMax })`
  (bornes nulles si le niveau n'est pas limité) ; bascule OFF →
  `api.setReservationVisibility(id, 'PRIVATE', token)`. Appel immédiat au clic (pas de bouton
  Publier séparé), avec garde `busy` et message d'erreur mappé (sous-ensemble du `ERR` de
  `OpenMatchToggle` : `UNAUTHORIZED`, `RESERVATION_NOT_ACTIVE`, `OPEN_MATCH_PADEL_ONLY`), puis
  `onChanged()`.
- Texte d'aide (sans la mention « réglable après confirmation », devenue caduque) :
  - ON + niveau limité : `Niveau {min}–{max}.`
  - ON + niveau non limité (mais système de niveau actif) : `Ouverte à tous les niveaux.`
  - ON + système de niveau inactif/non-applicable : `Visible et rejoignable par les membres du
    club.`
  - OFF : `Réservation privée.`

### 3. `ReservationPlayersInline.tsx` — prop `hideOpenMatchToggle`

Nouvelle prop optionnelle `hideOpenMatchToggle?: boolean` (défaut `false`) qui, si vraie,
n'affiche pas son `<OpenMatchToggle>` interne. Utilisée uniquement par `BookingSuccess` (pour ne
pas dupliquer le contrôle sur le même écran) ; les autres call sites (`DayPanel`,
`MyAgendaListItem`, `ReservationAgendaCard`) ne la passent pas et gardent le contrôle complet
existant (utile pour ajuster la fourchette de niveau plus tard, ou fermer une partie ouverte).

### 4. `BookingSuccess.tsx`

Une fois `resa` chargée et `showPartners` vrai, rend `<OpenMatchQuickSwitch reservation={resa}
token={token} onChanged={reload} />` juste au-dessus du bloc « Organisez votre partie », puis
`<ReservationPlayersInline ... hideOpenMatchToggle />`. `OpenMatchQuickSwitch` se masque
lui-même hors padel (cf. §2) ; aucune logique de gating supplémentaire nécessaire côté
`BookingSuccess`.

### 5. Tests à mettre à jour

- `BookingModal.test.tsx` : retrait des tests dédiés à l'interrupteur (« interrupteur présent,
  OFF par défaut », « pas d'interrupteur hors padel », « OFF → confirmation sans
  applyHoldSetup », « ON → applyHoldSetup PUBLIC… ») et de la note associée sur le limiteur de
  niveau.
- `BookingSuccess.test.tsx` : le test qui attend le bouton « Ouvrir la partie » est remplacé par
  un test attendant le nouveau switch « Partie ouverte aux membres » ; nouveau cas vérifiant
  que la bascule appelle `api.setReservationVisibility`.
- Nouveau `OpenMatchQuickSwitch.test.tsx` : rendu padel/non-padel, état initial depuis
  `visibility`, bascule ON (avec/sans niveau limité) et OFF, erreur mappée.
- `ReservationPlayersInline.test.tsx` : cas `hideOpenMatchToggle` (masque bien
  `OpenMatchToggle`, comportement par défaut inchangé sans la prop).

## Hors périmètre

- Pas de changement de `OpenMatchToggle.tsx` lui-même (reste utilisé tel quel dans les surfaces
  calendrier).
- Pas de changement des routes/services backend (`setReservationVisibility`/`applyHoldSetup`
  existent déjà et ne bougent pas).
- Pas de fusion des deux composants en un seul réglage universel — décision explicite de garder
  deux UI adaptées à deux contextes (bascule rapide à la confirmation vs réglage fin plus tard).
