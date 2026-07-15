# Parties Amicale / Compétitive — design

**Date** : 2026-07-15
**Statut** : validé par Eric (brainstorming du 2026-07-15)

## Contexte & objectif

Aujourd'hui, tout résultat de match confirmé applique les ratings Glicko aux 4 joueurs
(`MatchService.finalize` → `ratingsAppliedAt`) : chaque partie compte pour le niveau, sans
distinction. Comme chez Playtomic, on veut qu'un organisateur puisse déclarer sa partie
**Amicale** (jouer détendu, le niveau ne bouge pas) ou **Compétitive** (le résultat compte
pour le niveau), et que les joueurs le sachent **avant de rejoindre** une partie ouverte.

## Décisions de cadrage (figées)

| Question | Décision |
|---|---|
| Libellés | **« Amicale » / « Compétitive »** (vocabulaire Playtomic, compréhension immédiate) |
| Effet mécanique | Seul le **niveau** est gaté : une amicale confirmée n'applique pas les ratings. La saisie de résultat reste possible. |
| Top du mois / classements / stats V-D | **Toutes les victoires comptent**, amicales incluses (l'amicale ne gèle que le rating) |
| Défaut | **Compétitive** (= comportement actuel ; zéro changement pour l'existant) |
| Portée | Parties ouvertes (choix à la publication, badge sur la carte, résultat **verrouillé** sur le type déclaré) **+** résas privées (interrupteur dans la modale de saisie du résultat) |
| Modifiable après publication | Oui, par l'organisateur, tant qu'aucun résultat non annulé n'existe sur la résa. Pas de notification aux inscrits (v1). |

## Modèle de données

Migration additive **`add_match_competitive`** (DEV : `prisma db execute` du SQL additif ;
prod : `migrate deploy`) :

- `Reservation.competitive Boolean @default(true)` — le type déclaré de la partie.
- `Match.competitive Boolean @default(true)` — **snapshot** au moment de la création du
  résultat (un changement ultérieur du flag résa ne rétro-modifie jamais un résultat).

Booléen plutôt qu'enum `MatchKind` : choix binaire, YAGNI (les tournois ont leur propre
modèle et ne passeront jamais par ce champ).

## Backend

### Publication / édition du type (réservation)

- `ReservationService.applyHoldSetup` accepte `competitive?: boolean` (additif, même
  traitement que `visibility`) — câblé depuis BookingModal à la création.
- `ReservationService.setReservationVisibility` accepte `competitive?: boolean` — câblé
  depuis `OpenMatchToggle` (publication post-confirmation et édition ultérieure).
  Garde : refus (`MATCH_ALREADY_RECORDED` 409) **seulement si** la valeur `competitive`
  envoyée diffère de l'actuelle **et** qu'un match non CANCELLED existe déjà sur la résa
  (les appels qui ne touchent que visibilité/niveau restent intacts).
- Pas de garde padel-only : le champ est inoffensif hors padel (seuls les matchs padel
  appliquent des ratings), défaut `true` partout.

### DTO parties ouvertes

`OpenMatchService.toDTO` (liste, détail) + le mapper national léger exposent
`competitive: boolean`. `MatchService.listToRecord` expose `competitive` + `visibility`
par ligne (la modale de saisie doit savoir si le type est verrouillé).
`listUserReservations` expose `competitive` (même besoin depuis le calendrier).

### Création du résultat

`MatchService.createFromReservation` : input `competitive?: boolean` ; règle serveur :

- résa `visibility === 'PUBLIC'` → **hérite de `reservation.competitive`, input ignoré**
  (personne ne bascule en amicale à la saisie pour esquiver une défaite) ;
- résa privée → `input.competitive ?? true`.

### Application des ratings

`MatchService.finalize` : si `!match.competitive` → passe le match en `CONFIRMED` **sans
rien toucher d'autre** (pas de `playerRating`, pas de `ratingBefore/After`,
`ratingsAppliedAt` reste `null`) puis return. Idempotent (re-update CONFIRMED sans effet).
Conséquences gratuites :

- `voidMatch` ne recalcule que si `ratingsAppliedAt` est posé → annuler une amicale ne
  déclenche aucun recalcul ;
- Top du mois (`clubTopOfMonth`) et stats V-D comptent les matchs `CONFIRMED` → amicales
  incluses, conforme à la décision ;
- courbe de niveau : pas de point (pas de `ratingBefore/After`), rien à changer.

## Frontend

- **BookingModal** (interrupteur « Partie ouverte aux membres » ON) : paire de chips
  `Compétitive | Amicale` sous la fourchette de niveau, sous-texte « Le résultat compte
  pour le niveau » / « Juste pour le plaisir — le niveau ne bouge pas ». Envoyé dans
  `applyHoldSetup`. Défaut Compétitive.
- **OpenMatchToggle / ReservationPlayersInline** (publication post-confirmation, édition) :
  même paire de chips, envoyée avec la visibilité.
- **OpenMatchCard + page `/parties/[id]`** : badge « Compétitive » (accent) / « Amicale »
  (emerald/neutre), à côté de la fourchette de niveau.
- **Filtre `/parties`** : chips `Toutes | Compétitives | Amicales` à côté de « À mon
  niveau » (filtrage client sur le DTO).
- **MatchResultModal** : nouvelles props (`competitive` initial + `locked`). Résa privée →
  segmented Amicale/Compétitive éditable (défaut Compétitive) ; partie ouverte → badge
  statique « Partie déclarée amicale/compétitive » (verrouillé). Le flag choisi est envoyé
  à `createFromReservation`.
- **Après confirmation d'une amicale** : mention « Partie amicale — niveau inchangé » là
  où le résultat confirmé s'affiche (l'emplacement exact — carte/fiche match — sera
  localisé au plan ; personne ne doit chercher pourquoi sa courbe n'a pas bougé).
- `lib/api.ts` : `competitive` additif sur `OpenMatch`, `MyReservation`, lignes
  `listToRecord`, inputs `applyHoldSetup`/`setReservationVisibility`/`recordMatchResult`.

## Hors v1 (parqué)

- Carte OG du lien partagé (badge type + bump `CARD_RENDER_VERSION`).
- Mention du type dans les emails de match (registre `/admin/emails`).
- Filtre de type sur les alertes de parties (`MatchAlert`).
- Notification aux inscrits quand l'organisateur change le type.

## Tests

- **Backend** : `match.service` — héritage PUBLIC verrouillé (input contraire ignoré),
  input privé honoré, défaut true ; `finalize` amicale → CONFIRMED sans playerRating ni
  `ratingsAppliedAt`, idempotent ; `voidMatch` amicale → pas de recompute. `openMatch.service`
  — `competitive` dans le DTO. `reservation.service` — `applyHoldSetup`/`setReservationVisibility`
  passent le flag ; garde `MATCH_ALREADY_RECORDED`. Routes : passthrough body additif.
- **Frontend** : `BookingModal` (chips + envoi du flag), `OpenMatchCard` (badge),
  `MatchResultModal` (segmented privé vs verrouillé public, envoi du flag), `OpenMatches`
  (filtre), types `lib/api.ts` via tsc.
