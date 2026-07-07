# Réserver — « Confirmer d'abord, organiser ensuite » (design)

**Date** : 2026-07-07
**Statut** : validé en brainstorming (maquettes visuelles, choix utilisateur consignés ci-dessous)
**Périmètre** : **100 % frontend** — aucune migration, aucune route nouvelle, aucun changement backend.

## Problème

La modale de réservation (`components/BookingModal.tsx`, page unique depuis le 2026-06-24) mêle
deux tâches de nature différente sous un timer de 5 minutes :

1. **Sécuriser le créneau** — urgente (le hold Redis expire), décision simple : « je prends, je paie comment » ;
2. **Organiser la partie** — pas urgente : partenaires, composition d'équipes, places G/D,
   partie ouverte, fourchette de niveau. Des décisions sociales qu'on prend souvent *après*
   avoir réservé.

Or tout le volet « organiser » possède déjà un chemin post-confirmation complet :

- routes owner `GET/POST /api/reservations/:id/players`, `DELETE /:id/players/:participantId`,
  `POST /:id/teams`, `POST /:id/visibility` ;
- composants `ReservationPlayersInline` (MatchTeams padel / PlayerPills autres sports,
  AddPlayerSheet/PartnerSearch, remplacement, ajout ciblé) et `OpenMatchToggle`
  (ouvrir/fermer la partie + limiteur de niveau + bouton Partager), déjà utilisés par le
  calendrier « Mes réservations ».

La modale duplique donc, sous pression du timer, des choix éditables sereinement après.

## Décisions validées avec l'utilisateur

| Question | Choix |
|---|---|
| Que garde la modale de l'organisation ? | **Un seul interrupteur « Partie ouverte »** (pas de partenaires, pas d'équipes, pas de slider de niveau) |
| Forme du panneau de succès ? | **La modale se transforme en place** (pas de fermeture/réouverture, pas de feuille séparée) |
| Défaut de paiement de la ligne repliée ? | **Abonnement couvrant > premier solde prépayé couvrant > régler au club** (ou en ligne si le club l'impose) — uniquement parmi ce que le joueur possède réellement |

## Écran 1 — la modale réduite (phase `held`)

### Conservé tel quel
Barre de timer + pill « Créneau bloqué pour vous » + chip `mm:ss` (coral < 60 s), hold au montage
(gardes `didHold`/`closedRef`/StrictMode), `BookingHeaderCard`, `CancellationNotice`, bandeau
d'erreur, écran d'erreur (expiration/hold raté), pied CGV + `StripePaymentStep` sur le chemin
carte (`cardPath` inchangé), rangée « Abandonner / CTA adaptatif » sinon, mapping `BOOKING_ERRORS`.

### Nouveau : ligne de paiement repliée
- **Repliée par défaut** : une seule carte (style `payCard` sélectionné) montrant le moyen
  pré-choisi — tuile icône + titre + ligne de conséquence (« reste X après » pour un solde,
  « aucune carte enregistrée » / phrase empreinte pour le club, « votre part : X € » pour le
  paiement en ligne) + bouton texte **« changer »**.
- **Pré-sélection** (uniquement parmi ce que le joueur possède) :
  1. abonnement couvrant (`coveringSubscription`) → `useSub = true` (comportement actuel) ;
  2. sinon **premier** package `isUsable` + `canCover(totalEuros)` → `paySource` (nouveau :
     aujourd'hui le carnet n'est jamais auto-sélectionné) ;
  3. sinon « Régler au club » — ou « Payer en ligne » si `requireOnlinePayment`.
- **Tap « changer »** : déplie **en place** les avenues existantes (cartes/pills actuelles,
  gating strictement inchangé : abo ssi couvrant, carnets ssi possédés — grisés si solde
  insuffisant —, « Payer en ligne » ssi Stripe actif ou imposé, « Régler au club » sauf online
  imposé). Une fois déplié, reste déplié jusqu'à la fin.
- Choisir « Payer en ligne » révèle CGV + formulaire Stripe **comme aujourd'hui** (aucun
  changement de la mécanique `cardIntentPath`/`cardPath`/empreinte no-show).
- `INSUFFICIENT_BALANCE` au confirm : désélectionne le carnet (comportement actuel) **et
  déplie** la section paiement pour rendre l'état visible.

### Nouveau : interrupteur « Partie ouverte aux membres »
- Rendu ssi `showPartners && isPadel` (mêmes conditions que l'option actuelle). **OFF par défaut.**
- Sous-texte : OFF → « Vos partenaires s'ajoutent après la confirmation. » ; ON → « niveau
  X.X–Y.Y · réglable après confirmation » (ou « ouverte à tous » si la préférence mémorisée a
  `enabled: false`).
- Fourchette appliquée **sans slider** : `loadLevelPref()` si présente, sinon ±1 autour de mon
  niveau (`getMyRating`, fetch lancé seulement si l'interrupteur est utilisable), sinon 3–5.
  Le fetch `getMyRating` n'est fait que si aucune pref mémorisée (logique actuelle conservée).
- `levelForSport` (padel + club levelEnabled) garde l'affichage du sous-texte niveau, comme
  aujourd'hui pour le bloc niveau.

### Quota : affiché seulement s'il mord
`QuotaStatus` compact rendu ssi, pour la classification du créneau (`slot.offPeak` → compteur
`offPeak`, sinon `peak`), le compteur existe et `limit - used ≤ 1`. Sinon rien (le serveur
refuse de toute façon avec un message mappé).

### Supprimé de la modale
Toute la section Joueurs : `MatchTeams` éditable, `AddPlayerSheet`, pastilles partenaires,
`PartnerSearch`, `Segmented` privée/ouverte, switch + `LevelRangeSlider`, chip « ≈ X € par
joueur (N joueurs) », fetch `getMyProfile` au montage, états `partners`/`teamsDraft`/
`slotsDraft`/`addTarget`/`me` et leurs helpers (`nextSide`, `addPartner`, `addPartnerTo`,
`removePartner`, `buildPlayers`).

### `persistHoldSetup` simplifié
- Interrupteur **ON** → `applyHoldSetup(reservation.id, { partnerUserIds: [], visibility:
  'PUBLIC', targetLevelMin, targetLevelMax })` (niveaux `null` si pref « ouverte à tous »).
- Interrupteur **OFF** → **aucun appel** (une résa naît `PRIVATE`, rien à écrire).
- `beforeSubmit` de `StripePaymentStep` continue de pointer dessus (les webhooks Stripe
  confirment une résa dont la visibilité est déjà posée).
- `saveLevelPref` n'est **plus** écrit ici : la modale ne fait que lire la préférence.
  L'écriture accompagne désormais l'endroit où l'on choisit la fourchette :
  `OpenMatchToggle.publish` enregistre `saveLevelPref({ enabled: limit, min, max })`
  (seule modification apportée à ce composant).

## Écran 2 — le succès qui organise (phase `confirmed`)

Nouvelle phase interne `'confirmed'`, atteinte depuis :
- `handleConfirm` réussi (abo / carnet / régler au club) ;
- `onSuccess` de `StripePaymentStep` (paiement en ligne **et** empreinte no-show).

La feuille **reste ouverte et se transforme** :
- barre de timer masquée, timer arrêté (aucune expiration possible en phase `confirmed`) ;
- bandeau vert « Réservation confirmée ! » + ligne récap : court · date · horaire · résumé du
  paiement (`paidWithLabel` pour un solde, « couverte par votre abonnement », « payée en
  ligne · X € », « à régler au club ») ;
- **bloc organisation** (ssi `showPartners`) : rend **`ReservationPlayersInline` tel quel**
  (qui intègre `OpenMatchToggle` : chip « Ouverte » + Partager + Fermer si la partie est
  ouverte, bouton « Ouvrir aux joueurs du club » avec limiteur de niveau sinon ; MatchTeams
  padel / PlayerPills autres sports ; ajout/remplacement/retrait de joueurs) ;
- bouton plein pleine largeur **« Terminé »**.

### Données du bloc organisation
`ReservationPlayersInline` consomme un `MyReservation`. Au passage en phase `confirmed`, la
modale fetch **`api.getMyReservations(token)`** et sélectionne la résa par id ; `onChanged`
re-fetch de la même façon. `now` = horloge posée à l'entrée en phase (pas de `new Date()` au
rendu). En cas d'échec du fetch : le succès reste affiché, le bloc est remplacé par un lien
« Gérer ma réservation → `/me/reservations` » (jamais d'écran d'erreur après un paiement réussi).

### Fermeture
- « Terminé » et le clic backdrop en phase `confirmed` appellent **`onConfirmed(reservation,
  paid)`** — c'est le seul moment où il est émis. `ClubReserve` garde son comportement actuel
  (fermer + bannière verte + `reloadAll`/`refreshQuota`/refresh des soldes), simplement décalé
  à la fermeture de la feuille au lieu de l'instant de confirmation.
- `settled.current` est posé à la confirmation : ni le backdrop ni « Terminé » n'annulent quoi
  que ce soit (garde existante de `handleClose` réutilisée).
- `cap ≤ 1` (`showPartners` false) : succès simple (bandeau + récap + Terminé).

### Limitation assumée (v1)
Si le club a un `playerChangeCutoffHours > 0` et que la résa est prise **dans** cette fenêtre
(last-minute), `isPlayerChangeOpen` est faux → l'ajout de joueurs post-confirmation est refusé
(UI non éditable + garde backend `PLAYER_CHANGE_TOO_LATE`). Aujourd'hui la modale permettait de
déclarer des partenaires même dans ce cas (via `applyHoldSetup`). Perte acceptée en v1 : cutoff
à 0 chez la plupart des clubs (défaut `?? 0` = modifiable jusqu'au début) ; une fenêtre de grâce
backend « X min après création » est notée en évolution possible.

## Ce qui ne change pas

- Grille/cartes de la page Réserver, bascule vue cartes/grille, lien profond
  `?resource=&start=` (ouvre la même modale réduite), rareté, repli des passés.
- Hold au montage, annulation à la fermeture pré-confirmation, écran d'erreur, timer 5 min.
- Toutes les routes backend et leurs gardes ; `applyHoldSetup` (appelé avec `partnerUserIds: []`).
- La bannière « Réservation confirmée ! » de `ClubReserve` (résiduelle après « Terminé »).
- Le contrat `onConfirmed(reservation, paid)` — seul son **moment** d'émission change.
- `ReservationPlayersInline` (zéro modification), `OpenMatchToggle` (une ligne `saveLevelPref`).
- Constat au passage : le mode « déplacer une réservation » (`?move=`, `POST /:id/reschedule`)
  documenté dans CLAUDE.md **n'existe plus dans le code actuel** (aucune route ni appel) —
  rien à traiter ici, mais la doc est périmée.

## Composants / fichiers touchés

| Fichier | Nature |
|---|---|
| `components/BookingModal.tsx` | Refonte : suppression section Joueurs, ligne paiement repliée + état `payExpanded`, interrupteur « Partie ouverte », phase `'confirmed'` + fetch `getMyReservations` + rendu `ReservationPlayersInline`, CTA « Terminé » |
| `components/reservations/OpenMatchToggle.tsx` | +1 ligne : `saveLevelPref` dans `publish` |
| `components/ClubReserve.tsx` | Rien d'obligatoire (contrat `onConfirmed` conservé) |
| `__tests__/BookingModal*.test.tsx` | Réécriture des suites (voir Tests) |

Pas de nouveau composant si la refonte tient proprement dans `BookingModal.tsx` ; si le fichier
devient illisible, extraire `components/booking/{PaymentPicker,BookingSuccess}.tsx` (décision au
moment du plan — pas une exigence).

## Tests

Suites `BookingModal*.test.tsx` réécrites :
- hold au montage / erreur de hold + Fermer / annulation à la fermeture pré-confirmation /
  timer expiré → inchangés dans l'esprit ;
- **défauts de paiement** : abo couvrant pré-choisi ; sinon carnet couvrant pré-choisi ; sinon
  club ; `requireOnlinePayment` → en ligne ; carnet insuffisant jamais pré-choisi ;
- **repli/dépli** : ligne repliée seule au départ, « changer » déplie les avenues, gating
  inchangé (pas d'avenue abo sans abo couvrant, pas de carnets sans packages…) ;
- **interrupteur partie ouverte** : ON → `applyHoldSetup` avec `visibility: 'PUBLIC'` +
  niveaux de la pref (mock `loadLevelPref`) et `partnerUserIds: []` ; OFF → **aucun** appel
  `applyHoldSetup` ;
- **phase confirmed** : confirm direct → bandeau succès + `getMyReservations` fetché +
  `ReservationPlayersInline` rendu (MatchTeams visible pour un padel) ; « Terminé » →
  `onConfirmed` appelé ; backdrop post-confirmation → `onConfirmed` sans `cancelReservation` ;
  échec `getMyReservations` → lien « Gérer ma réservation » ; `cap ≤ 1` → pas de bloc
  organisation ;
- **Stripe** : `onSuccess` → phase confirmed (plus de fermeture immédiate) ; `payShare`/CGV
  inchangés ;
- **quota** : rendu ssi `limit - used ≤ 1` pour la classification du créneau ;
- ⚠️ mocks à prévoir : `api.getMyReservations`, `api.listClubFriends` (PartnerSearch/
  AddPlayerSheet transitifs), `assetUrl` — pièges connus des suites existantes.

`OpenMatchToggle` : un cas « publish enregistre la préférence de niveau ».
Vérifier que les suites `ClubReserve.*` (deeplink/persport/pastslots/view) passent sans
modification ; adapter uniquement si elles simulent la confirmation de bout en bout.

## Hors périmètre (v2 possibles)

- Édition de la fourchette de niveau pendant que la partie est déjà ouverte (v1 : Fermer puis
  rouvrir avec la nouvelle fourchette, via `OpenMatchToggle`).
- Fenêtre de grâce backend pour l'ajout de joueurs sur une résa prise dans le cutoff.
- Mémoire du « dernier moyen de paiement utilisé » par club.
- Toute évolution du backend, du checkout Stripe, des emails.
