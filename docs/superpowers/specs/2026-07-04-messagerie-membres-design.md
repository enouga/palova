# Messagerie 1-à-1 entre membres (chat privé) — Design

**Date** : 2026-07-04
**Statut** : validé (brainstorming avec maquettes navigateur)
**Référence** : c'est la « spec B » annoncée par `2026-07-01-amis-opt-in-demandes-design.md`
(le nom prévu était `2026-07-01-messagerie-membres` ; ce document la remplace).

## Contexte

Le système d'amis (suivi `Follow` + amitié confirmée `Friendship`) est en place, ainsi qu'un chat
par partie ouverte (`OpenMatchChatService`). Il manque la brique promise par la spec amis : une
**messagerie privée 1-à-1**, ouverte à **tout membre du club** (indépendante de l'amitié — l'opt-in
`acceptsFriendRequests` ne la gouverne pas ; le texte du profil le promet déjà). L'utilisateur veut
un système « top niveau » : lu/non-lu, indicateur de frappe, réactions emoji, photos, blocage.

## Décisions actées (brainstorming)

- **Fonctionnalités v1** : accusés de lecture (✓/✓✓), « en train d'écrire… », réactions emoji,
  photos/pièces jointes, **blocage de membre**.
- **1-à-1 seulement** (modèle de données extensible aux groupes plus tard, sans migration destructive).
- **Notifications** : in-app + push **à chaque message** ; **email coalescé par conversation**
  (1 email pour le premier message non lu d'une rafale, pas 1 par message).
- **Layout hybride** (option C des maquettes) : page QG `/me/messages` (split view desktop,
  liste → fil en mobile) **+** widget ancré bas-droite en desktop pour discuter sans quitter la page.
- **Entrées** : lignes de `/me/friends` (5 onglets), joueurs d'une partie ouverte, annuaire
  (onglet « Trouver »), grilles d'inscrits tournoi/event. **Pas** de bouton dans le dropdown
  `PartnerSearch` (bouton imbriqué — même raison que `FollowButton`).
- **Entrée principale + badge** : icône **💬 dans le header** à côté de la cloche (badge chiffré
  rouge) + lien « Messages » dans le `ProfileMenu`.
- **Architecture** : module `messaging` **isolé**, miroir des patterns du chat de partie —
  le chat de partie n'est **pas touché** (pas de moteur unifié : refactor risqué pour zéro valeur visible).

## Modèle de données (migration additive `add_direct_messages`)

5 nouveaux modèles + 1 valeur d'enum. SQL additif idempotent (dev : `prisma db execute` —
**jamais** `db push`/`migrate dev`, base dev partagée avec dérive ; prod : `migrate deploy`).

```prisma
/// Conversation privée 1-à-1, GLOBALE (une seule par paire, tous clubs confondus).
/// clubId = club de contexte à la création (branding notifs/emails), PAS une frontière d'accès.
model Conversation {
  id            String    @id @default(cuid())
  userAId       String    @map("user_a_id") // paire canonique userAId < userBId (comme Friendship)
  userBId       String    @map("user_b_id")
  clubId        String?   @map("club_id")
  createdAt     DateTime  @default(now()) @map("created_at")
  lastMessageAt DateTime? @map("last_message_at") // tri de la boîte de réception

  userA        User @relation("ConversationsAsA", fields: [userAId], references: [id], onDelete: Cascade)
  userB        User @relation("ConversationsAsB", fields: [userBId], references: [id], onDelete: Cascade)
  participants ConversationParticipant[]
  messages     DirectMessage[]

  @@unique([userAId, userBId])
  @@index([userBId])
  @@map("conversations")
}

/// État PAR PERSONNE : lastReadAt = curseur de lecture → ✓✓ et compteurs de non-lus EXACTS
/// (indépendants des notifications, contrairement au chat de partie). Extensible groupes.
model ConversationParticipant {
  id             String    @id @default(cuid())
  conversationId String    @map("conversation_id")
  userId         String    @map("user_id")
  lastReadAt     DateTime? @map("last_read_at")
  createdAt      DateTime  @default(now()) @map("created_at")

  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  user         User         @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([conversationId, userId])
  @@index([userId])
  @@map("conversation_participants")
}

/// Message privé. Soft-delete pierre tombale (pattern OpenMatchMessage). body ≤ 2000 car.
/// body optionnel si imageUrl (photo avec légende facultative).
model DirectMessage {
  id             String    @id @default(cuid())
  conversationId String    @map("conversation_id")
  authorId       String    @map("author_id")
  body           String
  imageUrl       String?   @map("image_url")
  createdAt      DateTime  @default(now()) @map("created_at")
  deletedAt      DateTime? @map("deleted_at")
  deletedById    String?   @map("deleted_by_id")

  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  author       User         @relation(fields: [authorId], references: [id], onDelete: Cascade)
  reactions    MessageReaction[]

  @@index([conversationId, createdAt])
  @@map("direct_messages")
}

/// Réaction emoji (une par emoji et par utilisateur).
model MessageReaction {
  id        String   @id @default(cuid())
  messageId String   @map("message_id")
  userId    String   @map("user_id")
  emoji     String
  createdAt DateTime @default(now()) @map("created_at")

  message DirectMessage @relation(fields: [messageId], references: [id], onDelete: Cascade)
  user    User          @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([messageId, userId, emoji])
  @@map("message_reactions")
}

/// Blocage GLOBAL (comme Follow). Un blocage dans un sens ou l'autre gèle la conversation
/// des deux côtés. v1 : effet messagerie seulement (pas d'effet parties/follows).
model UserBlock {
  id        String   @id @default(cuid())
  blockerId String   @map("blocker_id")
  blockedId String   @map("blocked_id")
  createdAt DateTime @default(now()) @map("created_at")

  blocker User @relation("BlocksGiven", fields: [blockerId], references: [id], onDelete: Cascade)
  blocked User @relation("BlocksReceived", fields: [blockedId], references: [id], onDelete: Cascade)

  @@unique([blockerId, blockedId])
  @@index([blockedId])
  @@map("user_blocks")
}
```

Enum : `NotificationCategory` gagne **`DIRECT_MESSAGES`**
(`ALTER TYPE "NotificationCategory" ADD VALUE`, pattern `add_open_match_chat`).

## Règles d'accès (`MessagingService`, nouveau service isolé)

- **Écrire à quelqu'un** exige d'être **co-membres ACTIFS d'au moins un club commun**
  (une adhésion BLOCKED côté club ne compte pas). Sinon **`NOT_CO_MEMBERS`** (403).
- **Get-or-create idempotent** par paire canonique. `POST /api/me/conversations`
  `{ otherUserId, clubSlug? }` — `clubSlug` optionnel pose le `clubId` de contexte ; absent →
  premier club commun actif. Self-DM refusé (**`CANNOT_MESSAGE_SELF`** 400).
- **Blocage** : blocage dans un sens **ou** l'autre → envoi/réaction refusés des deux côtés,
  erreur générique **`USER_BLOCKED`** (409) qui ne révèle pas le sens. Le fil reste lisible.
  Débloquer rouvre. Le méta de `GET messages` expose `blocked: boolean` (sans le sens) pour
  désactiver le composer préventivement.
- **Lecture/flux** : réservés aux 2 participants — **`CONVERSATION_NOT_FOUND`** (404) pour un
  tiers (pas de fuite d'existence).
- **Suppression d'un message** : **auteur seulement** (pas de modération staff dans une
  conversation privée). Pierre tombale idempotente ; fichier image supprimé best-effort.
- **RGPD** : cascade Prisma sur suppression de compte ; l'interlocuteur voit « Utilisateur
  supprimé » (anonymisation existante).
- La **boîte de réception ne liste que les conversations ayant ≥ 1 message**
  (`lastMessageAt != null`) — un get-or-create sans message n'encombre pas l'inbox de l'autre.

## API (routes globales — la porte d'accès est « club commun », pas un slug)

| Route | Rôle |
|---|---|
| `GET /api/me/conversations` | Inbox : interlocuteur (userId, nom, avatarUrl), aperçu dernier message, `unreadCount`/conversation, tri `lastMessageAt desc` |
| `GET /api/me/conversations/unread-count` | Total global → badge 💬 |
| `POST /api/me/conversations` | Get-or-create `{ otherUserId, clubSlug? }` |
| `GET /api/conversations/:id/messages?before=&limit=` | Fil paginé par curseur (`before` = id de message ; défaut 50, max 100, ordre chrono). Méta : `{ otherLastReadAt, myLastReadAt, blocked }` |
| `POST /api/conversations/:id/messages` | `{ body }` (trim, 1..2000) |
| `POST /api/conversations/:id/images` | multipart : image + `body` légende optionnelle |
| `DELETE /api/conversations/:id/messages/:messageId` | Pierre tombale (auteur seul) |
| `POST /api/conversations/:id/messages/:messageId/reactions` | `{ emoji }` ajoute (idempotent) |
| `DELETE /api/conversations/:id/messages/:messageId/reactions?emoji=` | Retire (idempotent) |
| `POST /api/conversations/:id/read` | `lastReadAt = now` + marque lues les notifs `dm.message` de la conversation → broadcast `dm_read` |
| `POST /api/conversations/:id/typing` | Éphémère (rien en base), broadcast aux autres ; throttle client 1 req/3 s |
| `GET /api/conversations/:id/stream?token=` | SSE (token en query + garde participant, pattern chat de partie) |
| `GET /api/conversations/:id/messages/:messageId/image?token=` | Streaming authentifié de la photo |
| `POST /api/me/blocks/:userId` / `DELETE …` / `GET /api/me/blocks` | Bloquer / débloquer / liste |

**DTO message** (aligné `OpenMatchMessage`) : `{ id, author: { userId, firstName, lastName,
avatarUrl }, body, imageUrl, createdAt, deleted, reactions: [{ emoji, count, mine }] }`.
✓✓ dérivé client : mon message est « lu » ssi `otherLastReadAt >= createdAt`.

## Temps réel (SSE)

4ᵉ canal dans `SSEService`, copie du pattern `matchClients` : `addConversationClient` /
`broadcastConversation` / `getConversationUserIds`. Événements : `dm_message`, `dm_deleted`,
`dm_reaction`, `dm_read` (`{ userId, lastReadAt }` — les ✓✓ passent en « Lu » en direct),
`dm_typing` (`{ userId }` — l'indicateur s'efface après 5 s sans nouvel event).
Badge global : flux cloche existant (`notificationsStreamUrl`) + event window **`palova:dm-unread`**
(pattern exact du badge « Parties »).

## Notifications

Destinataire **absent** = non connecté au SSE de la conversation (`getConversationUserIds`).
Catégorie **`DIRECT_MESSAGES`** (opt-out par canal dans `/me/notifications/settings` —
`CategoryMeta` ajoutée à `frontend/lib/notifications.ts`).

- **In-app + push : à chaque message** (type `dm.message`, `data.conversationId`,
  `url=/me/messages?with=<auteur>`; les compteurs DM exacts viennent de `lastReadAt`, pas des notifs).
- **Email : coalescé par conversation** — s'il existe déjà une notif `dm.message` **non lue** pour
  cette conversation, `dispatch` est appelé avec `email: null`. 5 messages en 2 min = 1 email.
- Email déclaré au **registre** : `EMAIL_DEFS['dm.message']` (vars prénom/auteur/message/club/lien)
  → apparaît dans `/admin/emails`, personnalisable par club, brandé par `conversation.clubId`
  (repli Palova si null). Envoi best-effort après commit (`safeNotify`, jamais bloquant).

## Photos

- JPEG/PNG/WebP, **5 Mo max**, multer memoryStorage (pattern avatar).
- ⚠️ `/uploads` est servi **statiquement sans auth** → les images DM vont dans un répertoire
  **hors du mount statique** : `uploads-private/dm/<conversationId>/<messageId>.<ext>`
  (surchargable `PRIVATE_UPLOADS_DIR`), servies par la route authentifiée
  `GET /api/conversations/:id/messages/:messageId/image?token=` (revérifie participant,
  content-type correct, garde anti-traversée).
- **Prod : volume `backend_uploads_private:/app/uploads-private`** à ajouter à
  `docker-compose.prod.yml` (sinon photos perdues au rebuild).
- UI : vignette dans le fil → visionneuse plein écran ; préview avant envoi dans le composer.

## Frontend

Nouveau dossier `frontend/components/messages/` + helpers purs `frontend/lib/messages.ts`
(openDm, aperçu inbox, groupage par jour, état ✓/✓✓) :

- **`MessagesHub`** — page `/me/messages` (shell calqué sur `/me/friends` : `Screen` + `ClubNav`),
  split view desktop (`useIsDesktop` : liste ~320 px + fil), mobile liste → fil plein écran.
  Deeplink **`?with=<userId>`** = get-or-create + ouverture du fil.
- **`ConversationList`** — `Avatar` + `colorForSeed`, aperçu (« 📷 Photo » si image,
  « Vous : … ✓✓ » si dernier message à moi), heure relative hydration-safe, badge non-lus,
  ⋮ → « Membres bloqués » (liste + débloquer).
- **`MessageThread`** — bulles groupées par jour (mine = accent à droite, autre = surface à
  gauche), **envoi optimiste** upsert par id (pattern `OpenMatchChatSheet`), réactions au
  survol/appui long (barre rapide ❤️👍😂😮 + grille complète), **✓/✓✓ Lu** sous mon dernier
  message, « X écrit… », pierre tombale, **chargement du passé au scroll haut** (curseur),
  vignettes photos, en-tête ⋮ → « Bloquer ce membre ». EventSource sur
  `conversationStreamUrl`, `markRead` à l'ouverture/fermeture + dispatch `palova:dm-unread`.
- **`MessageComposer`** — textarea auto-grow, Entrée = envoyer / Maj+Entrée = saut de ligne
  (desktop), 🙂 emojis (**`CHAT_EMOJIS` extraits** d'`OpenMatchChatSheet` vers une constante
  partagée — seul micro-refactor du chat de partie), 📷 avec préview, désactivé si `blocked`.
- **`DmWidgetHost`** — monté **une fois** dans les providers racine (client, actif connecté).
  Helper `openDm(userId)` : desktop → event window **`palova:open-dm`** → widget ancré bas-droite
  (pattern `pointerEvents none/auto` du chat de partie, ≤ `min(380px, 92vw)`) ; mobile →
  `router.push('/me/messages?with=' + userId)`.
- **Header 💬** : icône à côté de la cloche dans `ClubNav`, badge chiffré rouge
  (`getDmUnread`), live via flux cloche + `palova:dm-unread`. ⚠️ Les suites qui montent le
  **vrai `ClubNav`** (`ClubReserve.{deeplink,persport,pastslots}`, `OpenMatches`) doivent mocker
  le nouvel appel `api` (mémoire connue). + lien « Messages » dans `ProfileMenu` (slug-gated,
  sans appel API — comme « Mes amis »).
- **Entrées `openDm`** : lignes de `FriendsHub` (5 onglets), pastilles joueurs d'une partie
  (tap sur un autre joueur), grilles d'inscrits tournoi/event — ces payloads publics n'exposent
  pas l'`userId` : ajout **additif** de `userId` dans `listParticipants` (tournoi + event).
- `lib/api.ts` : types `ConversationSummary`/`DmMessage`/`DmReaction` + méthodes
  (`listConversations`, `getDmUnread`, `openConversation`, `getDmMessages`, `postDmMessage`,
  `postDmImage`, `deleteDmMessage`, `addDmReaction`/`removeDmReaction`, `markConversationRead`, `sendTyping`,
  `blockUser`/`unblockUser`/`listBlocks`) + `conversationStreamUrl`, `dmImageUrl`.

**v1 : surfaces sur l'hôte club uniquement** (comme `/me/friends`) — l'hôte plateforme n'affiche
ni icône ni page Messages (hors périmètre).

## Erreurs & cas limites

- `USER_BLOCKED` → « Vous ne pouvez pas échanger avec ce membre. » (générique, sens non révélé).
- `NOT_CO_MEMBERS` → « Vous devez partager un club avec ce membre. »
- Échec d'envoi → brouillon restauré (pattern existant) ; échec upload → pas de message fantôme.
- Jamais de `new Date()` au rendu (horloge posée en effet — hydration).
- EventSource : reconnexion auto native, `onerror` no-op (pattern existant).
- Typing : rien en base, indicateur auto-expirant 5 s ; throttle client 3 s.
- Messages supprimés : exclus des compteurs de non-lus ; réactions masquées sur pierre tombale.

## Tests

- **Backend** : `messaging.service.test.ts` (paire canonique get-or-create, gardes
  co-membres/blocage/self, pagination curseur, compteurs non-lus, toggle réactions, `lastReadAt`
  + ✓✓, suppression auteur seul, coalescing email, inbox sans conversations vides) ;
  `conversations.routes.test.ts` (auth, 403/404, garde SSE, route image authentifiée,
  validation 400) ; `notifications.dm.test.ts` (absent/présent, coalescing, échec email non
  bloquant) ; registre (rendu `dm.message`).
- **Frontend** : `MessagesHub` (split desktop / navigation mobile, deeplink `?with=`),
  `MessageThread` (optimiste, réactions, ✓✓, typing, pierre tombale, pagination),
  `MessageComposer` (emoji, préview image, Entrée/Maj+Entrée), `DmWidgetHost` (event → widget
  desktop / route mobile), `ConversationList` (tri, badges, aperçus), badge header, bouton
  `FriendsHub`. Mise à jour des mocks `lib/api` des suites ClubNav real-mount.
- `tsc --noEmit` des deux côtés ; suites scoped (flake full-suite BookingModal connu).

## Hors périmètre (repoussé)

- Conversations de **groupe** (le modèle `ConversationParticipant` y est prêt).
- Surface **hôte plateforme** (icône/page Messages hors club).
- Édition de message, réponses citées, transfert, messages vocaux, pièces jointes non-image.
- Notification sur **réaction** ; accusés « distribué » (un seul niveau ✓ → ✓✓ Lu).
- Recherche plein texte dans les conversations ; archivage/sourdine par conversation.
- Unification du moteur avec le chat de partie ; modération staff des DM ; signalement.
- Effet du blocage hors messagerie (parties, follows…).
