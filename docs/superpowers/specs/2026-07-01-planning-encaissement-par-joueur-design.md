# Planning — encaissement par joueur dans la modale (parité page Encaissement)

_Date : 2026-07-01_

## Problème

La modale de détail réservation de `/admin/planning` embarque le `CollectPanel`
« avancé » et lui passe `onPaid={() => setSelected(null)}` : **la modale se referme
au premier paiement** (impossible d'encaisser les 3 autres joueurs d'un terrain sans
la rouvrir) et **il n'y a pas d'encaissement par joueur en 1 clic** comme sur la page
« Encaissement » (`/admin/reservations`). Perçu comme « pas fonctionnel ».

Les deux surfaces ont divergé : le planning a été porté sur `CollectPanel`
(`595ea0d`), puis la page Encaissement a reçu le flux par joueur `ReservationCollect`
(`918af3b`, `eedc759`) — le planning n'a jamais rattrapé.

## Objectif

La modale du planning adopte le flux par joueur de la page Encaissement : lignes
fines par place, boutons moyens rapides 1 clic (optimiste), « Tout solder », et
**ne se referme plus** à chaque paiement.

## Périmètre

La page `frontend/app/admin/planning/page.tsx` + un ajout **additif** à
`CollectPanel` (prop `collectEmptyPlaces`, défaut `false` → page Encaissement
inchangée) + tests. Aucun changement backend, aucune migration, aucun changement de
`ReservationCollect` ni `lib/caisse.ts`.

## Conception

### 1. Encaissement par joueur via `CollectPanel`, affiché directement

Dans la modale (`selected.status !== 'CANCELLED'`), rendre le **`CollectPanel`**
directement (câblé sur `selected`), **sans `onPaid`** (la modale ne se ferme plus au
paiement) et **sans toggle « Détails / options »**. C'est le modèle demandé : chaque
ligne joueur se **sélectionne** (bouton « Régler » → cible son `participantId` et
préremplit sa part), et **TOUS les moyens s'activent en bas, sous les lignes**
(Carte / Espèces / Ticket CE en tête = moyens rapides du club, puis Virement /
Abo-Membre / Autre + carnet/porte-monnaie selon le solde) — ils encaissent pour le
joueur sélectionné, sinon pour la réservation entière. Pas de boutons de moyens
répétés sur chaque ligne, pas de fenêtre secondaire.

`CollectPanel` gère aussi le cas **événement à prix libre** (`due <= 0`) : saisie d'un
montant + moyens. Aucun branchement particulier n'est nécessaire.

**Places SANS joueur sélectionnables** — nouveau prop additif **`collectEmptyPlaces`**
(défaut `false`, planning `true`) : chaque place vide « Joueur N » gagne un bouton
« Régler » qui cible une **part anonyme** (`dû ÷ capacité`, sans `participantId`) et
affiche « réglé · {moyen} » quand couverte par les paiements anonymes (`coveredGeneric`,
même règle que la page Encaissement). Sans le prop, `CollectPanel` reste inchangé — la
modale « Détails / options » de la page Encaissement n'est pas affectée. Indispensable
au comptoir : 4 joueurs se présentent, seul l'organisateur est enregistré → on encaisse
les 3 autres places individuellement.

### 2. Rechargement léger après encaissement (pas de démontage de la modale)

Nouveaux helpers dans la page planning :

- `patchReservation(updated)` — remplace une résa dans la grille (`setRes`), sans requête.
- `reloadReservations()` — rechargement **léger** (une requête `adminGetReservations`,
  **sans `setLoading`** → la grille ne re-flashe pas « Chargement… »).
- `reloadPackages()` — recharge les soldes prépayés (best-effort).
- `onCollected(updated?)` — passé à `CollectPanel` comme `onChanged` : patch si la mutation
  renvoie la résa (association / retrait / remplacement de joueur), sinon
  `reloadReservations()` + `reloadPackages()` puis re-synchro de `selected` depuis la
  liste fraîche (le bandeau d'état et la liste des encaissements se mettent à jour).

Pas de `onPaid` : **la modale reste ouverte** après chaque paiement.

### 3. Section « Encaissements » (liste + reçus)

Ajouter, comme la modale de la page Encaissement, la liste `selected.payments`
(icône moyen, payeur = participant ou « Réservation », heure) + bouton **« Reçu »**
imprimable (`Receipt` + overlay d'impression + `toCaissePayment`) + la **note**
(`p.note`) affichée en fin de ligne (« … · Coffre-fort »). Nécessite de mémoriser
`clubDetail` (`ClubAdminDetail`, pour nom + adresse du reçu) — déjà chargé via
`adminGetClub` dans `load()`, il suffit de le stocker.

### 4. Moyen « Autre » → champ « comment ça a été réglé » (note)

Certains règlements ne rentrent dans aucun bouton dédié (par l'abonnement du joueur,
sorti du coffre-fort…). Dans `CollectPanel`, cliquer **« Autre »** n'encaisse plus
directement : ça ouvre un **champ texte** (comme la référence Ticket CE) où saisir
*comment* ça a été réglé, puis « Valider » enregistre le paiement `OTHER` avec cette
**note**. Plomberie déjà en place de bout en bout (`AddPaymentBody.note` → route
`/reservations/:id/payments` → `addPayment` persiste `Payment.note` pour tout moyen) :
**aucun changement backend**. La note est affichée dans la liste « Encaissements ».

### 5. Règlements « sans encaissement » (Coffre / Offres / Abonnement)

Trois règlements **débités au joueur** (offre souscrite, coffre, abonnement) qui **ne
sont pas de l'argent réel** → ils ne doivent pas compter dans les totaux de caisse.
Nouveau prop additif de `CollectPanel` **`settlementPresets: { label; note }[]`** :
chaque entrée devient un **bouton 1 clic** qui enregistre un paiement en **`MEMBER`**
(hors `MONEY_METHODS`, donc aucun flux d'argent) avec **`note` = libellé**. Le planning
passe `[{Coffre}, {Offres}, {Abonnement}]`. `payNow(method, noteOverride?)` accepte
désormais une note explicite (réutilisée par ces boutons). **Aucune migration** — la
distinction Coffre/Offres/Abonnement vit dans la `note`, l'argent-vs-non dans la méthode.

Ces boutons ne s'affichent **que si le joueur ciblé a souscrit à des offres** =
**abonnement `Subscription` ACTIF en base OU carnet/porte-monnaie utilisable**
(participant sélectionné, sinon titulaire). Le carnet/porte-monnaie vient déjà de
`packagesByUser` (`selPackages`) ; les abonnements actifs sont résolus par un prop
additif **`subscribedUserIds: Set<string>`**. La modale du planning les charge **à
l'ouverture** pour les joueurs de la résa (titulaire + participants) via l'endpoint
existant **`adminGetMemberSubscriptions`** (filtré `status ACTIVE` + non expiré) —
**aucun endpoint ni migration en plus**. Sans offre → aucun règlement sans encaissement.
La liste « Encaissements » affiche **`note || libellé du moyen`** (« … · Coffre »).
Quand `settlementPresets` est fourni, le bouton **générique « Abo / Membre » (MEMBER)
est retiré** des moyens (doublon avec « Abonnement ») ; la page Encaissement (sans
presets) le conserve.

### 6. Conservé tel quel

Bandeau d'état, sélecteur de Type, section Élèves (cours), Annulation (+ série),
« Facturer no-show », formulaire de création.

## Tests

Nouveau `frontend/__tests__/AdminPlanning.test.tsx` (mocks calqués sur
`AdminReservations.test.tsx`) :

- Sélectionner une ligne joueur (« Régler ») puis un moyen **en bas** appelle
  `adminAddPayment` avec le bon `participantId` **sans fermer la modale**.
- Les moyens sont **un seul jeu en bas** (un seul bouton « Carte », pas un par ligne) ;
  une sélection « Régler » par joueur.
- **Tous** les moyens sont proposés (Carte, Espèces, Virement, Ticket CE, Abo/Membre, Autre).
- Encaisser la réservation entière → le bandeau d'état passe à « Soldé ».
- La section « Encaissements » liste les paiements existants.

## Hors périmètre

Récurrence, remboursement auto, export — inchangés. Aucune modification des composants
partagés ni du backend.
