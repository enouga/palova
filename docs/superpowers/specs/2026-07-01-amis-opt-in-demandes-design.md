# Spec A — Amis : opt-in + demandes d'ami

Date : 2026-07-01
Statut : validé (brainstorming)

## Contexte & objectif

Aujourd'hui le « suivi » (`Follow`) est **à sens unique et instantané** : n'importe quel co-membre
actif peut vous suivre sans consentement, et « ami » est simplement **dérivé** d'un suivi mutuel.
Le hub `/me/friends` appelle « Amis » les suivis mutuels.

L'utilisateur veut **du consentement** : pour être ajouté en ami il faut (1) l'**autoriser dans son
profil**, puis (2) **accepter la demande** de l'autre. On introduit donc une **amitié confirmée**
(réciproque, consentie) **en plus** du suivi, qui reste inchangé.

> Cette spec ne couvre **que** la brique « Amis ». La **messagerie 1-à-1** (ouverte à *tout* membre
> du club, indépendante de l'amitié) fera l'objet de la **spec B** (`2026-07-01-messagerie-membres`).

## Décisions actées (brainstorming)

- **Consentement = interrupteur global d'opt-in ET demandes à accepter** (les deux).
- **On garde le suivi à sens unique** (anneaux « ami », preuve sociale sur les parties, ajout rapide
  en match) **et on ajoute** l'amitié confirmée par-dessus.
- **Le chat sera ouvert à tout membre du club** → l'opt-in ne gouverne **que les demandes d'ami**,
  **pas** le chat (spec B).
- **Défaut de l'opt-in = OFF** (vrai opt-in : « il faut accepter »).
- **« Amis » désigne désormais l'amitié confirmée**, plus les suivis mutuels.

## Modèle de données (migrations additives)

### `User.acceptsFriendRequests Boolean @default(false)`
L'opt-in. OFF ⇒ le membre n'est pas « ajoutable en ami » et ne reçoit pas de demandes.
N'a **aucun effet sur le chat** (spec B).

### Nouveau modèle `Friendship`
```prisma
enum FriendshipStatus { PENDING ACCEPTED }

model Friendship {
  id            String           @id @default(cuid())
  userAId       String           // ordonné canoniquement : userAId < userBId
  userBId       String
  requestedById String           // qui a initié la demande
  status        FriendshipStatus @default(PENDING)
  createdAt     DateTime         @default(now())
  respondedAt   DateTime?
  userA         User             @relation("FriendshipA", fields: [userAId], references: [id], onDelete: Cascade)
  userB         User             @relation("FriendshipB", fields: [userBId], references: [id], onDelete: Cascade)
  @@unique([userAId, userBId])
  @@index([userBId])
}
```
- **Global** (comme `Follow`) : pas de `clubId` stocké. Le club de contexte sert seulement à brander
  la notification au moment de l'action (passé au notifieur, comme `notifyNewFollower`).
- Ordre canonique `(userAId, userBId)` avec `userAId < userBId` (comparaison de chaînes) ⇒ une seule
  ligne par paire, `@@unique` empêche les doublons/courses.
- `requestedById` distingue « demande reçue » (≠ moi) de « demande envoyée » (= moi) quand `PENDING`.

### Notifications
Réutilise la **catégorie `SOCIAL`** existante (comme les follows) — **pas** de nouvelle valeur d'enum
ni de nouveau réglage de préférence. Types distincts :
- `friend.request` → à la cible d'une demande (« X veut vous ajouter en ami »), `url=/me/friends?tab=demandes`.
- `friend.accepted` → au demandeur quand accepté (« X a accepté votre demande »), `url=/me/friends`.
In-app + push, **pas d'email** (aligné sur `notifyNewFollower`). Best-effort (jamais bloquant).
Coalescing sur la notif non lue du même émetteur (comme les follows).

> ⚠️ Migration : base DEV en dérive → appliquer le SQL additif via `prisma db execute` (pas
> `db push`). En prod `prisma migrate deploy`. (cf. mémoire projet « migrate deploy, not dev ».)

## Backend — `FriendshipService`

Nouveau `backend/src/services/friendship.service.ts` (isolé de `FollowService`).

- `private canonical(a, b): { userAId, userBId }` — tri des deux ids.
- `private activeClubId(slug)` / `assertActiveMember(...)` — mêmes gardes que `FollowService`.
- `requestFriend(slug, requesterId, targetId): Promise<FriendRelation>`
  - refuse `requesterId === targetId` (`CANNOT_FRIEND_SELF`) ;
  - club ACTIVE + **les deux co-membres ACTIFS** (`MEMBERSHIP_REQUIRED` / `NOT_A_MEMBER`) ;
  - lit `target.acceptsFriendRequests` → si OFF, `FRIEND_REQUESTS_DISABLED` ;
  - upsert sur la paire canonique :
    - aucune ligne → crée `PENDING` (`requestedById = requester`) ; notifie la cible ;
    - `PENDING` initiée par **la cible** (demande inverse en attente) → **acceptation directe**
      (`ACCEPTED`, `respondedAt=now`) ; notifie le demandeur d'origine ;
    - `PENDING` initiée par moi, ou `ACCEPTED` → **idempotent** (no-op, pas de notif) ;
  - avale le `P2002` d'une course (comme `follow`).
- `respond(slug, userId, otherUserId, accept): Promise<FriendRelation>`
  - trouve la ligne `PENDING` de la paire **où `requestedById === otherUserId`** (donc reçue par moi) ;
    absente → `REQUEST_NOT_FOUND` ;
  - `accept=true` → `ACCEPTED` + `respondedAt` + notifie le demandeur (`friend.accepted`) ;
  - `accept=false` → **supprime** la ligne (refus = disparaît, re-demandable plus tard).
- `removeFriend(userId, otherUserId): Promise<FriendRelation>` — `deleteMany` sur la paire (idempotent,
  aucune appartenance requise : on peut toujours retirer un ami).
- `getRelationship(a, b): Promise<FriendRelation>` — `{ status: 'none'|'pending_out'|'pending_in'|'friends',
  requestable: boolean }` (`requestable` = cible opted-in ET status `none`).
- `listFriends(userId, q?): Promise<Friend[]>` — amitiés **ACCEPTED**, l'« autre » de chaque paire
  (id, prénom, nom, avatar), filtrable par nom, tri nom/prénom. **Global.**
- `listRequests(userId): Promise<{ received: Friend[]; sent: Friend[] }>` — lignes `PENDING`,
  ventilées selon `requestedById`.

`FriendRelation` (interface exportée) : `{ status: 'none'|'pending_out'|'pending_in'|'friends'; requestable: boolean }`.

### Routes
Club-scopées (comme les follows, montées derrière `authMiddleware`) :
- `POST   /api/clubs/:slug/friends/:userId/request`
- `POST   /api/clubs/:slug/friends/:userId/respond`  (body `{ accept: boolean }`)
- `DELETE /api/clubs/:slug/friends/:userId`
Globales :
- `GET /api/me/friendships`      → `listFriends`
- `GET /api/me/friend-requests`  → `listRequests`
Opt-in :
- `PATCH /api/me` accepte `acceptsFriendRequests` (booléen) ;
- `GET /api/me/profile` expose `acceptsFriendRequests`.

Annuaire : `searchMembers` **annote** chaque résultat d'un `friend: FriendRelation` (status +
requestable), comme il annote déjà `iFollow`/`mutual`, pour piloter le `FriendButton` de la liste
« Trouver » sans requête supplémentaire par ligne.

Mapping d'erreurs : `FRIEND_REQUESTS_DISABLED`/`CANNOT_FRIEND_SELF`/`NOT_A_MEMBER` → 400/409 ;
`REQUEST_NOT_FOUND` → 404 ; `MEMBERSHIP_REQUIRED` → 403 (cohérent avec les follows).

## Frontend

### `lib/api.ts`
- Type `FriendRelation` (`status`, `requestable`) ; `ClubMemberSearchResult` gagne `friend?: FriendRelation`.
- Méthodes : `requestFriend(slug, userId, token)`, `respondFriend(slug, userId, accept, token)`,
  `removeFriend(slug, userId, token)`, `listFriendships(token)`, `listFriendRequests(token)`.
- `MyProfile`/`PATCH me` : champ `acceptsFriendRequests`.

### Profil (`/me/profile`)
Interrupteur « **Autoriser les demandes d'ami** » (section Préférences), avec sous-texte :
« La messagerie reste ouverte à tous les membres du club ; ce réglage ne concerne que les amitiés. »
Câblé sur `PATCH /api/me`.

### Hub `/me/friends` — réorganisation des onglets
- **Amis** = `listFriendships` (amitiés **confirmées**). *(auparavant : suivis mutuels)*
- **Demandes** = `listFriendRequests` : reçues (boutons **Accepter** / **Refuser**) puis envoyées
  (« Demande envoyée », annulable via `removeFriend`). Badge du nombre de reçues. *Nouveau.*
- **Abonnements** / **Abonnés** = les follows (ex-« Je suis » / « Me suivent », inchangés).
- **Trouver** = annuaire ; chaque ligne porte **Suivre** (`FollowButton`) **et** **Ajouter en ami**
  (`FriendButton`, grisé « N'accepte pas les demandes » si l'opt-in cible est OFF).

### Composant `FriendButton`
Nouveau `components/social/FriendButton.tsx`, à côté de `FollowButton`. États pilotés par
`FriendRelation` : `none`+requestable → **Demander en ami** ; `pending_out` → **Demande envoyée**
(clic = annuler) ; `pending_in` → **Accepter** (+ Refuser) ; `friends` → **Amis** (clic = retirer,
via `ConfirmDialog`) ; `none`+!requestable → **N'accepte pas les demandes** (désactivé). Optimiste
avec rollback (comme `FollowButton`).

### `FollowButton` — désambiguïsation
Cesse d'afficher « Amis » sur un suivi mutuel : l'état mutuel devient « **Suivi(e)** » (le libellé
« Amis » est désormais réservé à l'amitié confirmée). Aucun autre changement de comportement du suivi.

## Tests

Backend :
- `friendship.service.test.ts` : demande (opt-in OFF refusée, self refusé, non-membre refusé),
  acceptation directe sur demande inverse, idempotence, respond accept/refuse, remove, `getRelationship`
  aux 4 états, `listFriends`/`listRequests`.
- `notifications` : `friend.request`/`friend.accepted` émis au bon destinataire, échec non bloquant.
- routes : `friends.routes.test.ts` (request/respond/remove + codes d'erreur), `me` (opt-in, listes).

Frontend :
- `FriendButton.test.tsx` (les 5 états + optimiste/rollback).
- `FriendsHub.test.tsx` : nouveaux onglets, Demandes reçues (accepter/refuser), « Amis » = confirmés.
- `MeProfile.test.tsx` : interrupteur opt-in.
- ⚠️ mémoire projet : les suites qui montent le vrai `ClubNav` / `PartnerSearch` doivent mocker les
  nouvelles méthodes `api.*` (sinon « not a function »).

## Hors périmètre (repoussé)

- **Messagerie 1-à-1** → spec B.
- Blocage / mise en sourdine d'un membre.
- Demandes d'ami inter-clubs / hors club courant.
- Suggestions d'amis, amis en commun.
- Email pour les demandes/acceptations (in-app + push seulement).
