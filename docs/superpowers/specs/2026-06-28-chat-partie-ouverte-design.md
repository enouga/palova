# Chat de partie ouverte + « Ça m'intéresse » — design

> Statut : design validé (brainstorming). Prochaine étape : plan d'implémentation.
> Date : 2026-06-28.

## Problème

Une **partie ouverte** = une `Reservation` `visibility: PUBLIC` (padel, à venir, `CONFIRMED`) qu'un
membre du club peut découvrir et **rejoindre** jusqu'à complet (`/parties`, composant `OpenMatches`).
Aujourd'hui, rien ne permet aux gens **intéressés ou inscrits** d'échanger sur la partie (« on joue
vraiment ? », « il manque un 4ᵉ », « je peux venir plus tard ? »). On veut un **chat par partie**,
ouvert aux **personnes intéressées ou inscrites**.

Il n'existe pas encore de notion d'« intéressé » : seuls les **participants** (`ReservationParticipant`,
les joueurs qui ont *rejoint*) existent. On introduit donc un état léger « Intéressé ».

## Décisions (issues du brainstorming)

1. **Audience du chat** = inscrits **+** un nouvel état léger « Ça m'intéresse » (n'occupe pas de place).
2. **Temps réel + notifs** : messages en direct (SSE) quand le chat est ouvert **et** notification
   (cloche in-app + push) quand le destinataire est absent.
3. **Emplacement** : feuille / bottom-sheet ouverte depuis la carte de la partie (pas de nouvelle route).
4. **Rôle de « Ça m'intéresse »** : signal **visible** (compteur d'intéressés sur la carte) **+**
   notification à l'organisateur (« X est intéressé par ta partie »).
5. **Modération** : l'**auteur** supprime ses propres messages ; l'**organisateur** de la partie et les
   **admins/owners** du club peuvent retirer n'importe quel message.

## Vue d'ensemble & approche

Deux briques **additives**, greffées sur l'existant (`Reservation` PUBLIC, `SSEService`,
`dispatch`/préférences de notification) :

1. **Intérêt léger** : « Ça m'intéresse » sur une carte → état qui n'occupe pas de place, débloque le
   chat, affiche un compteur sur la carte, notifie l'organisateur.
2. **Chat par partie** : feuille (bottom-sheet) depuis la carte, réservée aux **inscrits + intéressés**,
   temps réel via SSE, notif in-app + push quand on est absent.

**Approche écartée** — un système de chat **générique** rattachable à n'importe quelle entité
(tournois, events…). YAGNI : on cible la partie ouverte (réservation PUBLIC padel), quitte à généraliser
plus tard si le besoin apparaît.

## 1. Modèle de données — migration additive `add_open_match_chat`

```prisma
model OpenMatchInterest {            // un membre « intéressé » par une partie ouverte
  id            String   @id @default(cuid())
  reservationId String   @map("reservation_id")
  userId        String   @map("user_id")
  createdAt     DateTime @default(now()) @map("created_at")
  reservation   Reservation @relation(fields: [reservationId], references: [id], onDelete: Cascade)
  user          User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([reservationId, userId])
  @@index([reservationId])
  @@map("open_match_interests")
}

model OpenMatchMessage {             // message du fil d'une partie ouverte
  id            String    @id @default(cuid())
  reservationId String    @map("reservation_id")
  userId        String    @map("user_id")        // auteur
  body          String                            // texte (trim, 1..2000 caractères)
  createdAt     DateTime  @default(now()) @map("created_at")
  deletedAt     DateTime? @map("deleted_at")      // soft-delete → rendu « message supprimé »
  deletedById   String?   @map("deleted_by_id")
  reservation   Reservation @relation(fields: [reservationId], references: [id], onDelete: Cascade)
  user          User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([reservationId, createdAt])
  @@map("open_match_messages")
}
```

- Relations inverses ajoutées sur `Reservation` (`openMatchInterests`, `openMatchMessages`) et `User`.
- Valeur d'enum **`OPEN_MATCH_CHAT`** ajoutée à `NotificationCategory` (catégorie dédiée : on peut couper
  le chat sans couper les notifs de partie `MY_GAMES`).
- **Cascade** : annuler/supprimer la réservation efface intérêts + messages.
- **Soft-delete** des messages (plutôt que hard) : dans un fil live, une pierre tombale
  « message supprimé » évite les sauts de liste et conserve la trace pour la modération.

> ⚠️ Base de DEV : appliquer la migration de façon **additive** (`prisma migrate deploy` après avoir
> rédigé le SQL, ou `prisma db push` si la base diverge déjà — cf. mémoire « migrate deploy, not dev »).

## 2. Backend

### Intérêt — sur `OpenMatchService` (membership de partie)

- `setInterested(slug, reservationId, userId)` : club ACTIVE, membre ACTIVE, résa PUBLIC/CONFIRMED/à venir,
  **pas déjà participant** (sinon `ALREADY_PARTICIPANT` — un inscrit n'a pas besoin d'être « intéressé »).
  Upsert sur `@@unique([reservationId, userId])` (idempotent). Après commit →
  `safeNotify(notifyOpenMatchInterest(reservationId, userId))`.
- `removeInterested(slug, reservationId, userId)` : supprime la ligne (idempotent).
- Rejoindre une partie (`joinOpenMatch` / `addOpenMatchPlayer`) **efface l'intérêt** du joueur concerné
  (devient redondant) — dans la même transaction.
- `listOpenMatches` enrichi (**additif**) : `interestedCount`, `viewerIsInterested`,
  `interested: OpenMatchPlayer[]` (avatars plafonnés, ex. 5), `lastMessageAt: string | null`
  (pour la pastille « non lu » côté front).

### Chat — nouveau service isolé `openMatchChat.service.ts`

- `assertChatAccess(slug, reservationId, userId)` → club ACTIVE, membre ACTIVE, résa PUBLIC/CONFIRMED,
  et **participant OU intéressé** (sinon `CHAT_FORBIDDEN`). Garde unique réutilisée par les 3 méthodes.
- `listMessages(slug, reservationId, userId)` : fil chronologique ; les messages supprimés sont renvoyés
  en **tombstone** (`deleted: true`, `body` masqué) ; chaque message porte son auteur
  (`userId, firstName, lastName, avatarUrl`) pour le rendu.
- `postMessage(slug, reservationId, userId, body)` : valide (trim, 1..2000), crée le message,
  **broadcast SSE** `chat_message` au canal de la partie, puis notifie les **absents** (cf. ci-dessous).
  Renvoie le message créé.
- `deleteMessage(slug, reservationId, userId, messageId)` : autorisé pour l'**auteur**, l'**organisateur**
  de la partie (participant `isOrganizer`) ou un **admin/owner** du club (`ClubMember` OWNER/ADMIN) →
  pose `deletedAt`/`deletedById`, **broadcast SSE** `chat_deleted`. Sinon `NOT_ALLOWED`.

### SSE — canal par partie (`SSEService`, miroir du canal par ressource)

- `addMatchClient(reservationId, userId, res)` / `broadcastMatch(reservationId, event)` /
  `getMatchUserIds(reservationId): Set<string>`. On **mémorise l'`userId`** de chaque connexion → on sait
  qui regarde le fil en direct (sert au ciblage des notifications).
- Endpoint stream : `GET /api/clubs/:slug/open-matches/:id/chat/stream` (auth + `assertChatAccess`).
  Évènements émis : `chat_message`, `chat_deleted`.

### Notifications « quand absent » (réutilise `dispatch`)

- **Catégorie `OPEN_MATCH_CHAT`, canaux in-app + push, pas d'email** (un email par message serait spammy).
- Destinataires = membres du chat (participants + intéressés) **moins l'auteur** **moins ceux
  actuellement connectés au canal SSE de la partie** (`getMatchUserIds`) → on ne notifie pas quelqu'un qui
  lit déjà le fil.
- **Anti-rafale** : coalescing push best-effort en mémoire (au plus un push par partie par destinataire
  absent tant qu'il ne s'est pas reconnecté / n'a pas lu) — détail d'implémentation ; la cloche in-app
  reste par message (le badge agrège visuellement).
- L'intérêt notifie l'organisateur via `dispatch` catégorie **`MY_GAMES`** (cohérent avec les autres
  notifs de partie : join/left/added/removed), in-app + push.

### Routes (sous `/api/clubs/:slug/open-matches/:id`, `authMiddleware`)

| Méthode + chemin | Rôle |
|---|---|
| `POST /interest` | devenir intéressé |
| `DELETE /interest` | retirer son intérêt |
| `GET /chat/messages` | charger le fil |
| `POST /chat/messages` | poster un message |
| `DELETE /chat/messages/:messageId` | supprimer (auteur / organisateur / admin) |
| `GET /chat/stream` | flux SSE temps réel du fil |

Mapping d'erreurs → HTTP comme l'existant : `CHAT_FORBIDDEN`/`NOT_ALLOWED` → 403,
`MATCH_NOT_JOINABLE`/`ALREADY_PARTICIPANT` → 409, validation (corps vide/trop long) → 400.

## 3. Frontend

### Types `lib/api.ts` (additif)

- `OpenMatch` gagne `interestedCount: number`, `viewerIsInterested: boolean`,
  `interested: OpenMatchPlayer[]`, `lastMessageAt: string | null`.
- Nouveau type `OpenMatchMessage` : `{ id, author: { userId, firstName, lastName, avatarUrl }, body,
  createdAt, deleted: boolean }`.
- Méthodes : `setInterested` / `removeInterested`, `getChatMessages`, `postChatMessage`,
  `deleteChatMessage`, + un helper d'URL `EventSource` pour le stream (token comme les autres SSE).

### `OpenMatchCard.tsx` (carte existante)

- Pour un **non-participant** : à côté de « Rejoindre », un toggle **« Ça m'intéresse »**
  (état plein si `viewerIsInterested`).
- **Compteur d'intéressés** (avatars empilés + nombre) près du chip de places — visible par tous,
  c'est le signal de demande pour l'organisateur.
- Bouton **« Discuter »** (icône bulle), **activé seulement si `viewerIsParticipant || viewerIsInterested`** ;
  pastille « non lu » si `lastMessageAt` plus récent que la dernière lecture locale (timestamp par
  partie en `localStorage`). Ouvre la feuille.

### `OpenMatchChatSheet.tsx` (nouveau — pattern feuille type `ConfirmDialog`/top-sheet)

- En-tête compact (terrain + créneau, repris de la carte).
- Liste des messages : groupés par auteur, **avatar + couleur via `colorForSeed(userId)`/`inkOn`**
  (cohérent avec le reste de l'app), heure courte, **auto-scroll en bas** ; tombstones « message supprimé »
  en grisé.
- Champ de saisie + envoi (Entrée = envoyer, garde anti-double-envoi, **optimiste** puis réconcilié au
  retour serveur).
- Suppression : sur ses propres messages, et sur tous si organisateur/admin → `ConfirmDialog`.
- **Temps réel** : `EventSource` sur `/chat/stream` au montage, fermé au démontage ; `chat_message`
  append, `chat_deleted` patch. Marque « lu » à l'ouverture (timestamp local par partie → efface la
  pastille).
- Horloge `now` posée en effet (jamais de `new Date()` au rendu — hydration).

### `OpenMatches.tsx`

- Câble les nouveaux handlers : toggle intérêt via `act()` existant + `load()`, ouverture de la feuille
  (`chattingId`).
- Ajoute les libellés d'erreur (`CHAT_FORBIDDEN`, `ALREADY_PARTICIPANT`, `NOT_ALLOWED`…) au dico
  `JOIN_ERRORS`.

### Réglages notifs

- La catégorie `OPEN_MATCH_CHAT` apparaît dans l'écran de préférences existant (libellé
  « Messages de partie »), opt-out comme les autres.

## 4. Tests

### Backend

- `openMatchChat.service.test.ts` : `assertChatAccess` (participant OK, intéressé OK, ni l'un ni l'autre →
  `CHAT_FORBIDDEN`, non-membre/bloqué refusé) ; `postMessage` (validation longueur/trim, broadcast
  appelé) ; `deleteMessage` (auteur OK, organisateur OK, admin OK, tiers → `NOT_ALLOWED`, soft-delete =
  tombstone) ; ciblage des notifs (auteur exclu, connectés au stream exclus via `getMatchUserIds` mocké).
- Bloc « intérêt » dans `openMatch.service.test.ts` : `setInterested` (idempotent, `ALREADY_PARTICIPANT`
  si déjà inscrit, organisateur notifié), `removeInterested`, rejoindre efface l'intérêt,
  `listOpenMatches` expose `interestedCount`/`viewerIsInterested`.
- `sse` : `addMatchClient`/`broadcastMatch`/`getMatchUserIds` (suit les userId, nettoyage à la fermeture).
- Routes (`clubs.routes`) : accès, codes HTTP des erreurs (403/409/400), ownership de la suppression.

### Frontend

- `OpenMatchChatSheet.test.tsx` : rendu du fil, envoi optimiste, réception SSE
  (`chat_message`/`chat_deleted` — `EventSource` mocké dans `jest.setup`), suppression (auteur vs
  organisateur), tombstone.
- `OpenMatchCard.test.tsx` : toggle « Ça m'intéresse », compteur d'intéressés, bouton « Discuter »
  désactivé sans accès, pastille non-lu.
- `api` : nouvelles méthodes (⚠️ les suites qui mockent `lib/api` doivent exposer les nouveaux exports).

## 5. Hors périmètre (YAGNI v1)

- Chat générique réutilisable (tournois / events) — on reste sur la partie ouverte.
- Email par message, fil de réponses/threads, réactions, pièces jointes/images, mentions @.
- Édition de message, accusés de lecture par joueur, indicateur « est en train d'écrire ».
- Rate-limiting fin (au-delà de la garde de longueur), historique post-partie (le fil suit la partie
  tant qu'elle est listée — les parties passées ne sont pas dans `listOpenMatches`).
