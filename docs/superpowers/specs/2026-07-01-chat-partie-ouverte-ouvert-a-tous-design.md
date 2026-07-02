# Chat de partie ouverte ouvert à tous — suppression de l'« intéressé »

**Date :** 2026-07-01
**Statut :** design validé (à implémenter)

## Contexte

Sur une **partie ouverte** (`Reservation` `visibility:PUBLIC`, padel), le chat par partie
n'est aujourd'hui accessible qu'aux **participants + « intéressés »**. Le bouton
« Ça m'intéresse » (`OpenMatchInterest`) sert essentiellement à **débloquer ce chat**
sans occuper de place ; il porte accessoirement un compteur « N intéressés » et notifie
l'organisateur.

## Objectif

1. **Supprimer** le bouton « Ça m'intéresse » et **tout le concept d'intérêt**
   (modèle, compteur, notif organisateur, routes, méthodes, champs DTO).
2. **Ouvrir le chat à tout utilisateur connecté** : n'importe quel membre (adhésion
   créée à la volée comme pour « Rejoindre ») peut lire et écrire dans le chat d'une
   partie ouverte.
3. Un **visiteur anonyme** qui clique sur « Discuter » voit l'**invite à s'inscrire /
   se connecter** (`AuthPromptDialog` existante).

## Décisions (issues du brainstorming)

- **Accès au chat = tout utilisateur connecté**, adhésion ACTIVE créée à la volée
  (refus `BLOCKED`). On retire la condition « participant OU intéressé ».
- **Destinataires des notifs de message = participants ∪ personnes ayant déjà écrit
  dans ce chat**, moins l'auteur, moins les connectés au flux SSE. (Remplaçant naturel
  de « intéressé » : on n'est notifié que sur les conversations où l'on est impliqué.)
- **Suppression totale** de `OpenMatchInterest` (pas de conservation comme preuve sociale).
- **Conséquence assumée** (déjà le cas avec l'« intéressé ») : ouvrir un chat inscrit
  l'utilisateur au club à la volée.

## Détail de conception

### 1. Accès au chat (backend)

`backend/src/services/openMatchChat.service.ts` — `assertChatAccess(slug, reservationId, userId)` :

- **Avant** : club ACTIVE → membre **existant** (sinon `MEMBERSHIP_REQUIRED`) & non `BLOCKED`
  → résa PUBLIC/CONFIRMED → **participant OU intéressé** (sinon `CHAT_FORBIDDEN`).
- **Après** : club ACTIVE → **adhésion ACTIVE créée à la volée si absente** (refus `BLOCKED`)
  → résa PUBLIC/CONFIRMED. **Plus de condition participant/intéressé**, plus de
  `CHAT_FORBIDDEN` ni `MEMBERSHIP_REQUIRED`, plus de lecture `openMatchInterest`.
- On **garde** le calcul `isParticipant` / `isOrganizer` (retour `ChatContext`, utilisé
  par la modération et le DTO).
- La logique d'adhésion à la volée est **factorisée** : extraire l'actuel
  `OpenMatchService.ensureActiveMembership` (privé) en **helper partagé** (nouveau
  petit module `backend/src/services/membership.ts`, ex. `ensureActiveMembership(slug, userId)
  → { clubId }`), réutilisé par `OpenMatchService.join/add` et `assertChatAccess`.
- `assertChatAccessPublic` (route SSE) hérite du nouveau comportement sans changement.

Les routes chat restent derrière `authMiddleware` (l'anonyme n'atteint jamais le service).

### 2. Notifications de message (backend)

`backend/src/email/notifications.ts` — `notifyOpenMatchChatMessage(reservationId, messageId, authorUserId)` :

- Remplacer la lecture `prisma.openMatchInterest.findMany(...)` par les **auteurs
  distincts de messages** de cette partie :
  `prisma.openMatchMessage.findMany({ where: { reservationId }, distinct: ['userId'], select: { userId: true } })`.
- `recipients = participants ∪ chatters − authorUserId − connectés(SSE)`. Reste identique :
  un email + une notif `open_match.message` par destinataire (pas de coalescing), catégorie
  `OPEN_MATCH_CHAT`, `data.matchId` (compteurs de non-lus inchangés).
- **Supprimer** `notifyOpenMatchInterest` (toute la fonction).

### 3. Suppression de l'« intéressé »

**Schéma / base :** `backend/prisma/schema.prisma`

- Retirer le modèle `OpenMatchInterest` (table `open_match_interests`) et les relations
  `openMatchInterests` sur `User` (l.465) et `Reservation` (l.704).
- **Migration destructive** `DROP TABLE IF EXISTS "open_match_interests";` — SQL à la main,
  appliquée en **dev via `prisma db execute`** puis `prisma generate` (dérive de base connue,
  cf. mémoire projet), en **prod via `prisma migrate deploy`**. La table n'est référencée par
  aucune FK entrante (seulement des FK sortantes cascade) → drop sans effet de bord.

**`backend/src/services/openMatch.service.ts` :**

- Supprimer `setInterested` et `removeInterested`.
- Retirer l'`include openMatchInterests` de `listOpenMatches` et les champs du DTO :
  `interestedCount`, `viewerIsInterested`, `interested`.
- Retirer les deux `tx.openMatchInterest.deleteMany(...)` dans `join`/`add` (inutiles).
- Retirer l'import et l'appel `notifyOpenMatchInterest`.
- Utiliser le helper partagé `ensureActiveMembership` (cf. §1).

**Routes :** `backend/src/routes/clubs.ts` — supprimer
`POST /:slug/open-matches/:id/interest` et `DELETE /:slug/open-matches/:id/interest`.

### 4. Frontend

**`frontend/lib/api.ts` :**

- Retirer du type `OpenMatch` les champs `interestedCount`, `viewerIsInterested`, `interested`.
- Supprimer les méthodes `setInterested` et `removeInterested`.

**`frontend/components/openmatch/OpenMatchCard.tsx` :**

- Supprimer le chip « N intéressés », le bouton « Ça m'intéresse » / « Intéressé »,
  la prop `onToggleInterest`, le `interestTint` et le commentaire associé.
- `canChat` = **utilisateur connecté** (`!isAnonymous`). Le bouton **« Discuter » s'affiche
  aussi pour l'anonyme** ; `onClick` = `isAnonymous ? onAuthPrompt(m) : onOpenChat(m)`
  (le badge de non-lus reste réservé au connecté, `unreadCount` = 0 en anonyme).

**`frontend/components/openmatch/OpenMatches.tsx` :**

- Supprimer le handler `toggleInterest` et le passage `onToggleInterest` (les deux sites).

### 5. Tests

**Backend :**

- `openMatchChat.service` / `clubs.openmatch-chat.routes` : n'importe quel connecté peut
  lire/écrire ; **non-membre → adhésion créée** et accès accordé ; `BLOCKED` refusé ;
  plus aucune dépendance à l'intérêt.
- `openMatch.service` : retrait des cas `setInterested`/`removeInterested` et des
  assertions `interested*` du DTO.
- `notifications` : destinataires = participants + **auteurs de messages** (un non-joueur
  ayant écrit est notifié ; un membre n'ayant jamais écrit et non-participant ne l'est pas).

**Frontend :**

- `OpenMatchCard` / `OpenMatchCard.friends` : plus de bouton d'intérêt ni de chip ;
  « Discuter » présent pour un connecté ; **anonyme → clic déclenche `onAuthPrompt`**.
- `OpenMatches` : plus d'appel `setInterested`/`removeInterested`.
- `recommend` / `MatchesForYou` : retrait des `interested*` des mocks `OpenMatch`.

## Hors périmètre

- Conserver l'intérêt comme preuve sociale (écarté).
- Notifs fondées sur les accusés de lecture (écarté).
- Chat générique tournois/events, réactions/réponses, rate-limit fin : inchangés.

## Fichiers touchés (récapitulatif)

- `backend/prisma/schema.prisma` (retrait modèle + relations)
- migration SQL `DROP TABLE open_match_interests`
- `backend/src/services/membership.ts` (nouveau helper partagé)
- `backend/src/services/openMatchChat.service.ts`
- `backend/src/services/openMatch.service.ts`
- `backend/src/email/notifications.ts`
- `backend/src/routes/clubs.ts`
- `frontend/lib/api.ts`
- `frontend/components/openmatch/OpenMatchCard.tsx`
- `frontend/components/openmatch/OpenMatches.tsx`
- tests backend + frontend listés au §5
