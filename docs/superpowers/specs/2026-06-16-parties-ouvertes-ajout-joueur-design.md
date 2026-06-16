# Parties ouvertes — l'organisateur ajoute un joueur

_Spec — 2026-06-16_

## Contexte

Sur `/parties` (composant `OpenMatches.tsx`), un membre peut **rejoindre** une partie
ouverte (réservation `visibility=PUBLIC`) et la **quitter** ; l'organisateur peut déjà
**retirer** un autre joueur (`removeOpenMatchPlayer`, bouton `×` sur chaque pastille de
joueur non-organisateur). Il manque la capacité symétrique : **l'organisateur ne peut pas
ajouter un joueur** — aujourd'hui on ne peut que se rejoindre soi-même.

## Objectif

Permettre à l'organisateur d'une partie ouverte d'**ajouter un membre du club** sur une
place libre, en réutilisant au maximum les briques existantes (`joinOpenMatch`,
`PartnerSearch`, recalcul des parts, notifications). Le **retrait existe déjà** et n'est
pas modifié.

## Décisions (validées)

- **Qui peut être ajouté** : uniquement un **membre ACTIVE** du club (recherche par nom via
  l'annuaire existant). Pas d'invité sans compte (le modèle `ReservationParticipant → userId`
  l'interdit ; le supporter demanderait un changement de schéma — hors périmètre).
- **Déclencheur UI** : les pastilles **« Place libre »** déjà affichées deviennent
  **cliquables pour l'organisateur** → ouvrent un sélecteur de membre inline.
- **Notification** : le joueur ajouté reçoit un **email** « Vous avez été ajouté à une
  partie le… » (miroir du mail de join).

## Backend

### `OpenMatchService.addOpenMatchPlayer(slug, reservationId, organizerUserId, targetUserId)`

Quasi-miroir de `joinOpenMatch`. `resolveActiveMember(slug, organizerUserId)` d'abord, puis
transaction **Serializable + `SELECT … FOR UPDATE`** sur la réservation :

1. réservation existe (`RESERVATION_NOT_FOUND`), ressource du bon club (`CLUB_MISMATCH`) ;
2. partie joignable : `visibility=PUBLIC` & `status=CONFIRMED` (`MATCH_NOT_JOINABLE`),
   `start_time` dans le futur (`MATCH_IN_PAST`) ;
3. **acteur = organisateur** : l'acteur est participant **et** `isOrganizer` → sinon
   `NOT_ORGANIZER` ;
4. **cible = membre actif** : `ClubMembership` de `targetUserId` existe et n'est pas
   `BLOCKED` → sinon `MEMBERSHIP_REQUIRED` / `MEMBERSHIP_BLOCKED` ;
5. cible pas déjà dans la partie (`ALREADY_JOINED`) ;
6. place disponible : `participants.length < maxPlayers` (`MATCH_FULL`) ;
7. crée le `ReservationParticipant` (`isOrganizer:false`, `share:0`), puis **`applyShares`**
   recalcule les parts de tous (organisateur = reste au centime, autres = part égale).

Après commit, best-effort via `safeNotify` : **`notifyOpenMatchAdded(reservationId, targetUserId)`**.

`maxPlayers` = `playerCount(resource.attributes.format)` (comme le join).

### Notification

Nouveau builder **`notifyOpenMatchAdded(reservationId, addedUserId)`** dans
`email/notifications.ts`, calqué sur `notifyOpenMatchJoin`/`notifyOpenMatchRemoved` mais
**adressé au joueur ajouté** : sujet/corps « Vous avez été ajouté à une partie », rappel
terrain + créneau (fuseau du club), aux couleurs du club. Best-effort (un échec SMTP
n'annule jamais l'ajout).

### Route

`POST /api/clubs/:slug/open-matches/:id/participants`, corps `{ userId }` (la cible) ;
l'acteur = `req.user!.id`. Pendant du `DELETE …/participants/:userId` existant. Auth
`authMiddleware`. Renvoie `{ id }` comme les autres mutations.

## Frontend

### `lib/api.ts`

`addOpenMatchPlayer(slug, id, userId, token)` → `POST /api/clubs/${slug}/open-matches/${id}/participants`
avec `body: { userId }`.

### `OpenMatches.tsx`

- État local `addingId: string | null` (la carte dont le sélecteur est ouvert ; un seul à la fois).
- Si `viewerIsOrganizer` **et** `spotsLeft > 0` : la **première** pastille « Place libre »
  devient un bouton « + Ajouter un joueur » (les autres restent décoratives). Au clic →
  `setAddingId(m.id)`.
- Quand `addingId === m.id` : afficher inline un `PartnerSearch` (slug, token,
  `excludeIds` = `m.players.map(p => p.userId)`), + un bouton « Annuler » qui referme.
  À la sélection d'un membre → `act(m, () => api.addOpenMatchPlayer(slug, m.id, member.id, token))`
  puis `setAddingId(null)` ; `act` recharge déjà la liste.
- Erreurs : réutilise le bandeau `error` + map `JOIN_ERRORS` (les clés `NOT_ORGANIZER`,
  `MEMBERSHIP_REQUIRED`, `MEMBERSHIP_BLOCKED`, `ALREADY_JOINED`, `MATCH_FULL`, `MATCH_IN_PAST`
  existent déjà).
- Un non-organisateur ne voit **aucune** affordance d'ajout (places libres décoratives,
  comme aujourd'hui).

## Tests (TDD)

**Back — `openMatch.service.test.ts`** (ajouts) :
- organisateur ajoute un membre actif → participant créé, **parts recalculées**, `notifyOpenMatchAdded` appelé avec `(reservationId, targetUserId)` ;
- non-organisateur (simple participant) → `NOT_ORGANIZER`, aucun ajout ;
- cible non-membre → `MEMBERSHIP_REQUIRED` ; cible `BLOCKED` → `MEMBERSHIP_BLOCKED` ;
- cible déjà présente → `ALREADY_JOINED` ;
- partie complète → `MATCH_FULL` ;
- partie passée → `MATCH_IN_PAST` ;
- échec de la notification → **non bloquant** (l'ajout reste committé).

**Front — `OpenMatches.test.tsx`** (ajouts) :
- organisateur avec place libre : voit le déclencheur « + Ajouter un joueur », le clic ouvre `PartnerSearch` ;
- sélection d'un membre → `api.addOpenMatchPlayer` appelé avec le bon `userId`, puis rechargement ;
- non-organisateur : aucune affordance d'ajout visible.

## Hors périmètre

- Invités sans compte (changement de schéma).
- Transfert / changement d'organisateur.
- Modification du **retrait** existant.

## Migration

Aucune — additif pur (réutilise `ReservationParticipant`).
