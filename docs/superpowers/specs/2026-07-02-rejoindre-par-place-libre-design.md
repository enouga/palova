# Rejoindre une partie ouverte en cliquant une place libre

**Date :** 2026-07-02
**Statut :** validé (choix utilisateur : place persistée · bouton « Rejoindre » supprimé ·
join immédiat sans confirmation)
**S'appuie sur :** `2026-07-02-places-gd-persistees-design.md` (colonnes
`ReservationParticipant.team/slot` + `effectiveTeams`).

## Problème

Pour se rajouter à une partie ouverte, le joueur passe par un bouton « Rejoindre » dans la
barre d'actions : le serveur le place automatiquement, sans qu'il choisisse son équipe ni
son côté (G/D). Les places libres du mini-terrain (`MatchTeams`) sont pourtant déjà
visibles — mais inertes pour un non-participant (seul l'organisateur a des cellules
cliquables « + Ajouter »).

## Décision

Le mini-terrain devient **le** geste pour rejoindre : un non-participant (anonyme compris)
tape directement une **place libre** et rejoint la partie **à cette place précise**
(équipe + slot persistés côté serveur, refus si prise entre-temps). Le bouton
« Rejoindre » de la barre d'actions est **supprimé**. Un tap = join immédiat (mêmes gardes
qu'aujourd'hui : avertissement niveau hors fourchette, invite de connexion pour
l'anonyme) ; « Quitter » couvre le mauvais clic.

Option écartée : join puis auto-placement en 2 requêtes (via un `setOpenMatchTeams`
assoupli au self-service) — non atomique (course sur la place), élargit une route
organisateur pour rien.

## Backend

- **Aucune migration** (colonnes `team`/`slot` déjà en base).
- **`OpenMatchService.joinOpenMatch(slug, id, userId, target?)`** avec
  `target?: { team: 1 | 2; slot?: number }` :
  - Le `findMany` des participants dans la transaction Serializable récupère en plus
    `team`, `slot`, `joinedAt`.
  - Si `target` est fourni : validation contre le **layout effectif**
    (`effectiveTeams(parts, maxPlayers)`) — `team` ∉ {1,2} ou `slot` hors `0..half-1` →
    `TEAM_INVALID` ; côté plein → `TEAM_SIDE_FULL` ; slot visé occupé →
    `TEAM_SLOT_TAKEN`. Puis `create` du participant avec `team` + `slot` explicites.
  - Sans `target` : comportement actuel strictement inchangé (participant créé
    `team/slot null`, dérivés à la lecture).
- **Route** `POST /api/clubs/:slug/open-matches/:id/join` : body additif
  `{ team?, slot? }` relayé au service ; `TEAM_INVALID`/`TEAM_SIDE_FULL`/
  `TEAM_SLOT_TAKEN` mappés **400** (comme sur les routes teams).

## Frontend

- **`lib/api.ts`** : `joinOpenMatch(slug, id, token, target?)` envoie le body quand la
  cible est fournie.
- **`MatchTeams`** : nouvelle prop **`onJoinFree?: (team: 1 | 2, slot: number) => void`**,
  indépendante d'`editable`. Rendu d'une cellule libre, par priorité :
  1. organisateur (`editable && onAddToTeam`) → « + Ajouter » (inchangé) ;
  2. sinon `onJoinFree` → bouton « + Rejoindre » (même visuel, libellé et `aria-label`
     « Rejoindre l'équipe N » dédiés) ;
  3. sinon cellule inerte « Place libre ».
- **`OpenMatchCard`** : passe `onJoinFree` quand le viewer n'est **ni organisateur ni
  participant** — anonyme : la cellule déclenche `onAuthPrompt(m)` ; connecté :
  `onJoin(m, team, slot)`. Le bouton « Rejoindre » de la barre d'actions est retiré ;
  la barre garde Discuter / Saisir le résultat / Partager / « Quitter » / chip « Vous
  organisez ». Partie complète : aucune cellule libre, la chip « Complet » suffit.
- **`useOpenMatchActions`** : `join(m, target?)` et `confirmJoin` transmettent la cible ;
  l'état `joinWarning` devient `{ match, target? }` pour que « Rejoindre quand même »
  atterrisse à la place tapée. Sur erreur `TEAM_SLOT_TAKEN` : message **et** `reload()`
  (la grille reflète l'occupation réelle). Libellés `JOIN_ERRORS` : + `TEAM_SIDE_FULL`
  (« Cette équipe est complète. ») et `TEAM_INVALID` (« Place invalide. »).
- **Surfaces** : liste `/parties` (×2 avec « Pour toi ») et page détail `/parties/[id]`
  profitent automatiquement (carte partagée).

## Hors périmètre

Se déplacer soi-même une fois inscrit (reste organisateur-only), tournois/events, sports
non-padel (les parties ouvertes sont padel-only), `BookingModal` (création — l'organisateur
se place déjà), confirmation avant join.

## Tests

- Backend : `openMatch.service.test.ts` — join avec cible → participant créé avec
  `team`/`slot` ; slot occupé (explicite **et** dérivé du layout effectif) →
  `TEAM_SLOT_TAKEN` ; côté plein → `TEAM_SIDE_FULL` ; cible invalide → `TEAM_INVALID` ;
  sans cible → comportement actuel. Route : body relayé, 400 sur les 3 codes.
- Frontend : `MatchTeams.test.tsx` — place libre avec `onJoinFree` rend « Rejoindre » et
  émet `(team, slot)` ; priorité organisateur conservée ; sans handler → « Place libre »
  inerte. `OpenMatchCard.test.tsx` — plus de bouton « Rejoindre » dans la barre, clic
  cellule → `onJoin(m, team, slot)`, anonyme → `onAuthPrompt`. `OpenMatches.test.tsx` —
  garde niveau : hors fourchette ouvre l'avertissement puis « Rejoindre quand même »
  rejoint à la cible mémorisée.
