# Messagerie 1-à-1 entre membres — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Messagerie privée 1-à-1 entre membres (spec `docs/superpowers/specs/2026-07-04-messagerie-membres-design.md`) : conversations globales par paire, lu/non-lu (✓✓), frappe, réactions emoji, photos, blocage ; page `/me/messages` + widget desktop ; notifs in-app + push + email coalescé.

**Architecture:** Module `messaging` isolé, miroir des patterns du chat de partie (`OpenMatchChatService`/`SSEService`/`dispatch`) — le chat de partie n'est PAS touché (sauf extraction de la constante `CHAT_EMOJIS`). Compteurs de non-lus exacts via `ConversationParticipant.lastReadAt` (pas via les notifications).

**Tech Stack:** Express 5 + Prisma 7 (adapter PrismaPg), SSE maison (`SSEService`), nodemailer + registre d'emails, Next.js 16 + React 19, Jest (backend : `prismaMock` de `src/__mocks__/prisma` + supertest ; frontend : RTL + `FakeES`).

---

## ⚠️ Notes d'exécution (à lire avant la tâche 1)

- **Worktree recommandé** : l'utilisateur édite le repo en parallèle (`frontend/components/ClubNav.tsx` et d'autres sont déjà modifiés). Suivre la mémoire « Worktree setup for palova » (junction `node_modules`, copie `backend/.env` + `frontend/.env.local`, migrations via `prisma db execute`). Avant CHAQUE commit : `git status` et n'ajouter QUE ses propres fichiers.
- **Migrations** : jamais `prisma migrate dev` ni `db push` (dérive de la base dev) → `npx prisma db execute --file <sql> --schema prisma/schema.prisma` puis `npx prisma generate`. Prod : `prisma migrate deploy`.
- **Jest/tsc** : les shims `.bin` sont cassés → `node node_modules/jest/bin/jest.js …` et `node node_modules/typescript/bin/tsc --noEmit` (cwd `backend/` ou `frontend/` ; le cwd PowerShell se réinitialise à chaque commande → une seule ligne `cd X; …` par commande, ou utiliser bash).
- **Suites qui montent le vrai `ClubNav`** (`ClubReserve.deeplink/persport/pastslots`, `OpenMatches`) : tout nouvel appel `api.*` dans `ClubNav` casse leurs mocks — corrigé en tâche 13.
- **Écarts de spec assumés (3 raffinements)** : les réactions sont sérialisées `{ emoji, userIds: string[] }` (le client dérive `count` et `mine` — une seule forme pour GET et SSE) ; la route DELETE réaction prend l'emoji en query (`?emoji=`) ; `conversation.clubId` null → **pas d'email** (in-app + push seuls) au lieu d'un email brandé Palova — cas théorique, la garde co-membres garantit un club à la création.

## Fichiers (vue d'ensemble)

**Backend — créés** : `prisma/migrations/20260704000000_add_direct_messages/migration.sql`, `src/services/messaging.service.ts`, `src/routes/conversations.ts`, `src/services/__tests__/messaging.service.test.ts`, `src/routes/__tests__/conversations.routes.test.ts`, `src/email/__tests__/notifications.dm.test.ts`.
**Backend — modifiés** : `prisma/schema.prisma`, `src/services/sse.service.ts`, `src/email/notifications.ts`, `src/email/registry.ts`, `src/app.ts`, `src/utils/uploads.ts`, `docker-compose.prod.yml`.
**Frontend — créés** : `lib/chatEmojis.ts`, `lib/messages.ts`, `components/messages/{MessageComposer,MessageThread,ConversationList,MessagesHub,DmWidgetHost}.tsx`, `app/me/messages/page.tsx`, `__tests__/{messages.test.ts,MessageThread.test.tsx,MessagesHub.test.tsx,DmWidgetHost.test.tsx}`.
**Frontend — modifiés** : `lib/api.ts`, `lib/notifications.ts`, `components/openmatch/OpenMatchChatSheet.tsx`, `components/ui/Icon.tsx`, `components/ClubNav.tsx` (⚠️ WIP utilisateur — adapter), `components/ProfileMenu.tsx`, `components/social/FriendsHub.tsx`, `components/player/PlayerPills.tsx`, `components/match/MatchTeams.tsx`, `components/event/ParticipantsGrid.tsx`, `components/tournament/TeamsGrid.tsx`, `app/layout.tsx`, `app/admin/emails/page.tsx`, mocks de 4-5 suites existantes.

---

### Task 1 : Migration + schéma Prisma

**Files:**
- Create: `backend/prisma/migrations/20260704000000_add_direct_messages/migration.sql`
- Modify: `backend/prisma/schema.prisma` (enum `NotificationCategory`, modèle `User`, + 5 modèles en fin de fichier après `Friendship`)

- [ ] **Step 1 : Écrire le SQL additif idempotent**

```sql
DO $$ BEGIN
  ALTER TYPE "NotificationCategory" ADD VALUE IF NOT EXISTS 'DIRECT_MESSAGES';
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "conversations" (
  "id" TEXT NOT NULL,
  "user_a_id" TEXT NOT NULL,
  "user_b_id" TEXT NOT NULL,
  "club_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_message_at" TIMESTAMP(3),
  CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "conversations_user_a_id_user_b_id_key" ON "conversations"("user_a_id", "user_b_id");
CREATE INDEX IF NOT EXISTS "conversations_user_b_id_idx" ON "conversations"("user_b_id");

CREATE TABLE IF NOT EXISTS "conversation_participants" (
  "id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "last_read_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_participants_conversation_id_user_id_key" ON "conversation_participants"("conversation_id", "user_id");
CREATE INDEX IF NOT EXISTS "conversation_participants_user_id_idx" ON "conversation_participants"("user_id");

CREATE TABLE IF NOT EXISTS "direct_messages" (
  "id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "author_id" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "image_url" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),
  "deleted_by_id" TEXT,
  CONSTRAINT "direct_messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "direct_messages_conversation_id_created_at_idx" ON "direct_messages"("conversation_id", "created_at");

CREATE TABLE IF NOT EXISTS "message_reactions" (
  "id" TEXT NOT NULL,
  "message_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "emoji" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "message_reactions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "message_reactions_message_id_user_id_emoji_key" ON "message_reactions"("message_id", "user_id", "emoji");

CREATE TABLE IF NOT EXISTS "user_blocks" (
  "id" TEXT NOT NULL,
  "blocker_id" TEXT NOT NULL,
  "blocked_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_blocks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "user_blocks_blocker_id_blocked_id_key" ON "user_blocks"("blocker_id", "blocked_id");
CREATE INDEX IF NOT EXISTS "user_blocks_blocked_id_idx" ON "user_blocks"("blocked_id");

DO $$ BEGIN
  ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_a_id_fkey"
    FOREIGN KEY ("user_a_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_b_id_fkey"
    FOREIGN KEY ("user_b_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_author_id_fkey"
    FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_message_id_fkey"
    FOREIGN KEY ("message_id") REFERENCES "direct_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocker_id_fkey"
    FOREIGN KEY ("blocker_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocked_id_fkey"
    FOREIGN KEY ("blocked_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
```

- [ ] **Step 2 : Schéma Prisma — enum + relations User**

Dans `backend/prisma/schema.prisma` :
1. Enum `NotificationCategory` (~l.1190) : ajouter `DIRECT_MESSAGES` après `SOCIAL`.
2. Modèle `User` (~l.470, après `friendshipsB`) : ajouter
```prisma
  conversationsA          Conversation[] @relation("ConversationsAsA")
  conversationsB          Conversation[] @relation("ConversationsAsB")
  conversationParticipations ConversationParticipant[]
  directMessages          DirectMessage[]
  messageReactions        MessageReaction[]
  blocksGiven             UserBlock[] @relation("BlocksGiven")
  blocksReceived          UserBlock[] @relation("BlocksReceived")
```

- [ ] **Step 3 : Schéma Prisma — les 5 modèles** (à coller après le modèle `Friendship`)

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

/// État PAR PERSONNE : lastReadAt = curseur de lecture → ✓✓ et compteurs de non-lus exacts.
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
/// imageUrl = chemin RELATIF dans uploads-private/dm (jamais servi statiquement).
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

/// Blocage GLOBAL (comme Follow). Un blocage dans un sens ou l'autre gèle l'envoi des deux côtés.
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

- [ ] **Step 4 : Appliquer + régénérer le client**

Depuis `backend/` :
```
npx prisma db execute --file prisma/migrations/20260704000000_add_direct_messages/migration.sql --schema prisma/schema.prisma
npx prisma generate
```
Attendu : `Script executed` puis `Generated Prisma Client`.

- [ ] **Step 5 : Vérifier le typage puis committer**

`cd backend; node node_modules/typescript/bin/tsc --noEmit` → 0 erreur.
```
git add backend/prisma/schema.prisma backend/prisma/migrations/20260704000000_add_direct_messages
git commit -m "feat(dm): schema + migration additive add_direct_messages"
```

---

### Task 2 : SSEService — canal conversation

**Files:**
- Modify: `backend/src/services/sse.service.ts`

- [ ] **Step 1 : Ajouter le 4ᵉ canal** (copie exacte du pattern `matchClients`, à coller en fin de classe)

```typescript
  // Clients abonnés au fil d'une conversation privée : conversationId -> (Response -> userId).
  private conversationClients: Map<string, Map<Response, string>> = new Map();

  /** Abonne un client au flux d'une conversation privée (messagerie temps réel). */
  addConversationClient(conversationId: string, userId: string, res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const keepAlive = setInterval(() => res.write(': ping\n\n'), 30_000);

    if (!this.conversationClients.has(conversationId)) this.conversationClients.set(conversationId, new Map());
    this.conversationClients.get(conversationId)!.set(res, userId);

    res.on('close', () => {
      clearInterval(keepAlive);
      this.conversationClients.get(conversationId)?.delete(res);
      if (this.conversationClients.get(conversationId)?.size === 0) this.conversationClients.delete(conversationId);
    });

    res.write(`data: ${JSON.stringify({ type: 'connected', conversationId })}\n\n`);
  }

  /** Diffuse un évènement à tous les clients du fil d'une conversation (best-effort). */
  broadcastConversation(conversationId: string, event: unknown): void {
    const clients = this.conversationClients.get(conversationId);
    if (!clients?.size) return;
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    const dead: Response[] = [];
    clients.forEach((_userId, res) => { try { res.write(payload); } catch { dead.push(res); } });
    dead.forEach((res) => clients.delete(res));
  }

  /** Ensemble des userId actuellement connectés au fil d'une conversation. */
  getConversationUserIds(conversationId: string): Set<string> {
    return new Set(this.conversationClients.get(conversationId)?.values() ?? []);
  }
```

- [ ] **Step 2 : Typage + commit**

`cd backend; node node_modules/typescript/bin/tsc --noEmit` → 0 erreur.
```
git add backend/src/services/sse.service.ts
git commit -m "feat(dm): canal SSE par conversation (add/broadcast/getUserIds)"
```
*(Pas de test unitaire dédié — `SSEService` n'en a pas aujourd'hui ; couvert par les tests de routes en tâche 7.)*

---

### Task 3 : `MessagingService` — conversations & gardes (TDD)

**Files:**
- Create: `backend/src/services/messaging.service.ts`
- Test: `backend/src/services/__tests__/messaging.service.test.ts`

- [ ] **Step 1 : Écrire les tests qui échouent** (fichier complet, bloc « conversations »)

```typescript
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { MessagingService } from '../messaging.service';
import { SSEService } from '../sse.service';

const mockNotify = jest.fn();
jest.mock('../../email/notifications', () => ({
  notifyDirectMessage: (...a: unknown[]) => mockNotify(...a),
}));

const U = (id: string) => ({ id, firstName: 'P', lastName: id.toUpperCase(), avatarUrl: null });

describe('MessagingService — getOrCreateConversation', () => {
  let service: MessagingService;
  beforeEach(() => {
    service = new MessagingService();
    mockNotify.mockReset().mockResolvedValue(undefined);
    prismaMock.user.findUnique.mockResolvedValue({ ...U('u2'), deletedAt: null } as any);
    prismaMock.clubMembership.findMany.mockResolvedValue([{ clubId: 'club-demo' }] as any);
    prismaMock.clubMembership.findFirst.mockResolvedValue({ clubId: 'club-demo' } as any);
    prismaMock.userBlock.findFirst.mockResolvedValue(null);
    prismaMock.conversationParticipant.createMany.mockResolvedValue({ count: 2 } as any);
  });

  it('refuse le self-DM', async () => {
    await expect(service.getOrCreateConversation('u1', 'u1')).rejects.toThrow('CANNOT_MESSAGE_SELF');
  });

  it('refuse sans club actif commun', async () => {
    prismaMock.clubMembership.findFirst.mockResolvedValue(null);
    prismaMock.conversation.findUnique.mockResolvedValue(null);
    await expect(service.getOrCreateConversation('u1', 'u2')).rejects.toThrow('NOT_CO_MEMBERS');
  });

  it('crée la conversation avec la paire canonique (a < b) et les 2 participants', async () => {
    prismaMock.conversation.findUnique.mockResolvedValue(null);
    prismaMock.conversation.create.mockResolvedValue({ id: 'c1', clubId: 'club-demo', lastMessageAt: null } as any);
    const conv = await service.getOrCreateConversation('z9', 'u2');
    expect(prismaMock.conversation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: { userAId: 'u2', userBId: 'z9', clubId: 'club-demo' },
    }));
    expect(prismaMock.conversationParticipant.createMany).toHaveBeenCalledWith({
      data: [
        { conversationId: 'c1', userId: 'u2' },
        { conversationId: 'c1', userId: 'z9' },
      ],
      skipDuplicates: true,
    });
    expect(conv.id).toBe('c1');
    expect(conv.other.userId).toBe('u2');
  });

  it('est idempotent : renvoie la conversation existante sans create', async () => {
    prismaMock.conversation.findUnique.mockResolvedValue({ id: 'c1', clubId: 'club-demo', lastMessageAt: null } as any);
    const conv = await service.getOrCreateConversation('u1', 'u2');
    expect(prismaMock.conversation.create).not.toHaveBeenCalled();
    expect(conv.id).toBe('c1');
  });

  it('refuse de CRÉER une conversation avec un utilisateur bloqué (mais renvoie l\'existante)', async () => {
    prismaMock.userBlock.findFirst.mockResolvedValue({ id: 'b1' } as any);
    prismaMock.conversation.findUnique.mockResolvedValue(null);
    await expect(service.getOrCreateConversation('u1', 'u2')).rejects.toThrow('USER_BLOCKED');
    prismaMock.conversation.findUnique.mockResolvedValue({ id: 'c1', clubId: 'club-demo', lastMessageAt: null } as any);
    await expect(service.getOrCreateConversation('u1', 'u2')).resolves.toMatchObject({ id: 'c1' });
  });

  it('interlocuteur supprimé (RGPD) → CONVERSATION_NOT_FOUND', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ ...U('u2'), deletedAt: new Date() } as any);
    await expect(service.getOrCreateConversation('u1', 'u2')).rejects.toThrow('CONVERSATION_NOT_FOUND');
  });
});

describe('MessagingService — listConversations / unreadTotal', () => {
  let service: MessagingService;
  const conv = (id: string, otherId: string, lastBody: string | null) => ({
    userId: 'u1', lastReadAt: null,
    conversation: {
      id, clubId: 'club-demo', lastMessageAt: lastBody ? new Date('2026-07-04T10:00:00Z') : null,
      userAId: 'u1' < otherId ? 'u1' : otherId, userBId: 'u1' < otherId ? otherId : 'u1',
      participants: [
        { userId: 'u1', lastReadAt: null, user: U('u1') },
        { userId: otherId, lastReadAt: null, user: U(otherId) },
      ],
      messages: lastBody ? [{ body: lastBody, imageUrl: null, authorId: otherId, deletedAt: null }] : [],
    },
  });

  beforeEach(() => { service = new MessagingService(); });

  it('liste triée par lastMessageAt, avec interlocuteur, aperçu et unreadCount', async () => {
    prismaMock.conversationParticipant.findMany.mockResolvedValue([conv('c1', 'u2', 'salut')] as any);
    prismaMock.directMessage.count.mockResolvedValue(3);
    const list = await service.listConversations('u1');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: 'c1', unreadCount: 3,
      other: { userId: 'u2' },
      lastMessage: { body: 'salut', hasImage: false, mine: false, deleted: false },
    });
    // le comptage exclut mes propres messages et les supprimés
    expect(prismaMock.directMessage.count).toHaveBeenCalledWith({
      where: { conversationId: 'c1', deletedAt: null, authorId: { not: 'u1' } },
    });
  });

  it('unreadTotal additionne les non-lus de toutes mes conversations', async () => {
    prismaMock.conversationParticipant.findMany.mockResolvedValue([
      { conversationId: 'c1', userId: 'u1', lastReadAt: new Date('2026-07-01T00:00:00Z') },
      { conversationId: 'c2', userId: 'u1', lastReadAt: null },
    ] as any);
    prismaMock.directMessage.count.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    await expect(service.unreadTotal('u1')).resolves.toEqual({ count: 3 });
    expect(prismaMock.directMessage.count).toHaveBeenCalledWith({
      where: { conversationId: 'c1', deletedAt: null, authorId: { not: 'u1' }, createdAt: { gt: new Date('2026-07-01T00:00:00Z') } },
    });
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

`cd backend; node node_modules/jest/bin/jest.js src/services/__tests__/messaging.service.test.ts`
Attendu : FAIL — `Cannot find module '../messaging.service'`.

- [ ] **Step 3 : Implémenter le service (partie conversations)** — créer `backend/src/services/messaging.service.ts` :

```typescript
import { prisma } from '../db/prisma';
import { SSEService } from './sse.service';
import { notifyDirectMessage } from '../email/notifications';

const MAX_BODY = 2000;
const PAGE_DEFAULT = 50;
const PAGE_MAX = 100;

export interface DmUser { userId: string; firstName: string; lastName: string; avatarUrl: string | null }
export interface DmReactionDTO { emoji: string; userIds: string[] }
export interface DmMessageDTO {
  id: string; author: DmUser; body: string; imageUrl: string | null;
  createdAt: string; deleted: boolean; reactions: DmReactionDTO[];
}
export interface ConversationSummaryDTO {
  id: string; other: DmUser; clubId: string | null; lastMessageAt: string | null;
  unreadCount: number;
  lastMessage: { body: string; hasImage: boolean; mine: boolean; deleted: boolean } | null;
}
export interface DmListMeta { myLastReadAt: string | null; otherLastReadAt: string | null; blocked: boolean; hasMore: boolean }

/** Paire canonique (comme Friendship) : une seule conversation par paire. */
function canonical(a: string, b: string): { userAId: string; userBId: string } {
  return a < b ? { userAId: a, userBId: b } : { userAId: b, userBId: a };
}

const USER_SELECT = { id: true, firstName: true, lastName: true, avatarUrl: true } as const;
const MSG_SELECT = {
  id: true, body: true, imageUrl: true, createdAt: true, deletedAt: true,
  author: { select: USER_SELECT },
  reactions: { select: { emoji: true, userId: true } },
} as const;

type MsgRow = {
  id: string; body: string; imageUrl: string | null; createdAt: Date; deletedAt: Date | null;
  author: { id: string; firstName: string; lastName: string; avatarUrl: string | null };
  reactions: { emoji: string; userId: string }[];
};

function toUser(u: { id: string; firstName: string; lastName: string; avatarUrl: string | null }): DmUser {
  return { userId: u.id, firstName: u.firstName, lastName: u.lastName, avatarUrl: u.avatarUrl };
}

function toMessageDTO(m: MsgRow): DmMessageDTO {
  const deleted = m.deletedAt != null;
  const byEmoji = new Map<string, string[]>();
  if (!deleted) for (const r of m.reactions) {
    if (!byEmoji.has(r.emoji)) byEmoji.set(r.emoji, []);
    byEmoji.get(r.emoji)!.push(r.userId);
  }
  return {
    id: m.id,
    author: toUser(m.author),
    body: deleted ? '' : m.body,
    imageUrl: deleted ? null : m.imageUrl,
    createdAt: m.createdAt.toISOString(),
    deleted,
    reactions: [...byEmoji.entries()].map(([emoji, userIds]) => ({ emoji, userIds })),
  };
}

export class MessagingService {
  /** Club ACTIF où les deux sont membres ACTIFS (slug préféré honoré s'il convient), sinon NOT_CO_MEMBERS. */
  private async sharedActiveClubId(a: string, b: string, preferredSlug?: string | null): Promise<string> {
    if (preferredSlug) {
      const club = await prisma.club.findUnique({ where: { slug: preferredSlug }, select: { id: true, status: true } });
      if (club?.status === 'ACTIVE') {
        const both = await prisma.clubMembership.count({ where: { clubId: club.id, status: 'ACTIVE', userId: { in: [a, b] } } });
        if (both === 2) return club.id;
      }
    }
    const mine = await prisma.clubMembership.findMany({ where: { userId: a, status: 'ACTIVE' }, select: { clubId: true } });
    const shared = mine.length === 0 ? null : await prisma.clubMembership.findFirst({
      where: { userId: b, status: 'ACTIVE', clubId: { in: mine.map((m) => m.clubId) }, club: { status: 'ACTIVE' } },
      select: { clubId: true },
    });
    if (!shared) throw new Error('NOT_CO_MEMBERS');
    return shared.clubId;
  }

  /** Blocage dans un sens OU l'autre → USER_BLOCKED (générique, sens non révélé). */
  private async assertNotBlocked(a: string, b: string): Promise<void> {
    if (await this.pairBlocked(a, b)) throw new Error('USER_BLOCKED');
  }

  private async pairBlocked(a: string, b: string): Promise<boolean> {
    const block = await prisma.userBlock.findFirst({
      where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] },
      select: { id: true },
    });
    return !!block;
  }

  /** Conversation + mes droits ; CONVERSATION_NOT_FOUND pour un tiers (pas de fuite d'existence). */
  private async assertParticipant(conversationId: string, userId: string) {
    const conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true, clubId: true, userAId: true, userBId: true,
        participants: { select: { userId: true, lastReadAt: true, user: { select: USER_SELECT } } },
      },
    });
    if (!conv || (conv.userAId !== userId && conv.userBId !== userId)) throw new Error('CONVERSATION_NOT_FOUND');
    const otherId = conv.userAId === userId ? conv.userBId : conv.userAId;
    return { conv, otherId };
  }

  /** Get-or-create idempotent par paire canonique. Bloqué ⇒ pas de création (l'existante reste lisible). */
  async getOrCreateConversation(meId: string, otherUserId: string, clubSlug?: string | null): Promise<ConversationSummaryDTO> {
    if (!otherUserId || otherUserId === meId) throw new Error('CANNOT_MESSAGE_SELF');
    const other = await prisma.user.findUnique({ where: { id: otherUserId }, select: { ...USER_SELECT, deletedAt: true } });
    if (!other || other.deletedAt) throw new Error('CONVERSATION_NOT_FOUND');

    const pair = canonical(meId, otherUserId);
    let conv = await prisma.conversation.findUnique({
      where: { userAId_userBId: pair },
      select: { id: true, clubId: true, lastMessageAt: true },
    });
    if (!conv) {
      const clubId = await this.sharedActiveClubId(meId, otherUserId, clubSlug);
      await this.assertNotBlocked(meId, otherUserId);
      try {
        conv = await prisma.conversation.create({
          data: { ...pair, clubId },
          select: { id: true, clubId: true, lastMessageAt: true },
        });
      } catch {
        // course P2002 : l'autre l'a créée en même temps
        conv = await prisma.conversation.findUnique({
          where: { userAId_userBId: pair },
          select: { id: true, clubId: true, lastMessageAt: true },
        });
        if (!conv) throw new Error('CONVERSATION_NOT_FOUND');
      }
    }
    await prisma.conversationParticipant.createMany({
      data: [
        { conversationId: conv.id, userId: pair.userAId },
        { conversationId: conv.id, userId: pair.userBId },
      ],
      skipDuplicates: true,
    });
    return {
      id: conv.id, clubId: conv.clubId,
      lastMessageAt: conv.lastMessageAt?.toISOString() ?? null,
      unreadCount: 0, lastMessage: null,
      other: toUser(other),
    };
  }

  private unreadWhere(conversationId: string, meId: string, lastReadAt: Date | null) {
    return {
      conversationId, deletedAt: null, authorId: { not: meId },
      ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
    };
  }

  /** Boîte de réception : conversations avec ≥ 1 message, tri lastMessageAt desc. */
  async listConversations(meId: string): Promise<ConversationSummaryDTO[]> {
    const parts = await prisma.conversationParticipant.findMany({
      where: { userId: meId, conversation: { lastMessageAt: { not: null } } },
      select: {
        userId: true, lastReadAt: true,
        conversation: {
          select: {
            id: true, clubId: true, lastMessageAt: true, userAId: true, userBId: true,
            participants: { select: { userId: true, lastReadAt: true, user: { select: USER_SELECT } } },
            messages: {
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1,
              select: { body: true, imageUrl: true, authorId: true, deletedAt: true },
            },
          },
        },
      },
    });
    const rows = await Promise.all(parts.map(async (p) => {
      const c = p.conversation;
      const other = c.participants.find((x) => x.userId !== meId)?.user;
      const last = c.messages[0] ?? null;
      const unreadCount = await prisma.directMessage.count({ where: this.unreadWhere(c.id, meId, p.lastReadAt) });
      return {
        id: c.id, clubId: c.clubId,
        lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
        unreadCount,
        other: other ? toUser(other) : { userId: '', firstName: 'Utilisateur', lastName: 'supprimé', avatarUrl: null },
        lastMessage: last ? {
          body: last.deletedAt ? '' : last.body,
          hasImage: !last.deletedAt && !!last.imageUrl,
          mine: last.authorId === meId,
          deleted: last.deletedAt != null,
        } : null,
      };
    }));
    return rows.sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''));
  }

  /** Total global de non-lus (badge 💬 du header). */
  async unreadTotal(meId: string): Promise<{ count: number }> {
    const parts = await prisma.conversationParticipant.findMany({
      where: { userId: meId },
      select: { conversationId: true, lastReadAt: true },
    });
    const counts = await Promise.all(parts.map((p) =>
      prisma.directMessage.count({ where: this.unreadWhere(p.conversationId, meId, p.lastReadAt) })));
    return { count: counts.reduce((s, n) => s + n, 0) };
  }
}
```

- [ ] **Step 4 : Vérifier que les tests passent**

`cd backend; node node_modules/jest/bin/jest.js src/services/__tests__/messaging.service.test.ts` → PASS (9 tests).
Note : si `prismaMock` ne connaît pas encore `conversation`/`userBlock`…, vérifier que `src/__mocks__/prisma.ts` est généré dynamiquement (mockDeep) — c'est le cas pour `friendship`, rien à faire normalement.

- [ ] **Step 5 : Commit**

```
git add backend/src/services/messaging.service.ts backend/src/services/__tests__/messaging.service.test.ts
git commit -m "feat(dm): MessagingService — conversations, gardes co-membres/blocage, inbox, non-lus"
```

---

### Task 4 : `MessagingService` — messages (fil paginé, envoi, suppression) (TDD)

**Files:**
- Modify: `backend/src/services/messaging.service.ts`
- Test: `backend/src/services/__tests__/messaging.service.test.ts` (ajouter les blocs)

- [ ] **Step 1 : Tests qui échouent** (à ajouter au fichier de test)

```typescript
const CONV = {
  id: 'c1', clubId: 'club-demo', userAId: 'u1', userBId: 'u2',
  participants: [
    { userId: 'u1', lastReadAt: null, user: U('u1') },
    { userId: 'u2', lastReadAt: new Date('2026-07-04T09:00:00Z'), user: U('u2') },
  ],
};
const MSG_ROW = (id: string, authorId: string, body: string, over: Record<string, unknown> = {}) => ({
  id, body, imageUrl: null, createdAt: new Date('2026-07-04T10:00:00Z'), deletedAt: null,
  author: U(authorId), reactions: [], ...over,
});

describe('MessagingService — messages', () => {
  let service: MessagingService;
  let broadcast: jest.SpyInstance;
  beforeEach(() => {
    service = new MessagingService();
    mockNotify.mockReset().mockResolvedValue(undefined);
    broadcast = jest.spyOn(SSEService.getInstance(), 'broadcastConversation').mockImplementation(() => {});
    prismaMock.conversation.findUnique.mockResolvedValue(CONV as any);
    prismaMock.userBlock.findFirst.mockResolvedValue(null);
  });
  afterEach(() => broadcast.mockRestore());

  it('listMessages : tiers → CONVERSATION_NOT_FOUND', async () => {
    await expect(service.listMessages('c1', 'intrus')).rejects.toThrow('CONVERSATION_NOT_FOUND');
  });

  it('listMessages : page chrono + méta (lastReadAt des deux côtés, blocked, hasMore)', async () => {
    prismaMock.directMessage.findMany.mockResolvedValue([MSG_ROW('m2', 'u2', 'b'), MSG_ROW('m1', 'u1', 'a')] as any);
    const r = await service.listMessages('c1', 'u1');
    expect(r.messages.map((m) => m.id)).toEqual(['m1', 'm2']); // ré-ordonné chrono asc
    expect(r.meta).toEqual({
      myLastReadAt: null,
      otherLastReadAt: '2026-07-04T09:00:00.000Z',
      blocked: false,
      hasMore: false,
    });
  });

  it('listMessages : curseur before + hasMore', async () => {
    const rows = Array.from({ length: 51 }, (_, i) => MSG_ROW(`m${51 - i}`, 'u2', `x${i}`));
    prismaMock.directMessage.findMany.mockResolvedValue(rows as any);
    const r = await service.listMessages('c1', 'u1', 'm52');
    expect(prismaMock.directMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { conversationId: 'c1' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 51,
      cursor: { id: 'm52' }, skip: 1,
    }));
    expect(r.messages).toHaveLength(50);
    expect(r.meta.hasMore).toBe(true);
  });

  it('postMessage : crée, met à jour lastMessageAt, broadcast + notifie', async () => {
    const created = MSG_ROW('m3', 'u1', 'coucou');
    prismaMock.directMessage.create.mockResolvedValue(created as any);
    prismaMock.conversation.update.mockResolvedValue({} as any);
    const dto = await service.postMessage('c1', 'u1', '  coucou  ');
    expect(prismaMock.directMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: { conversationId: 'c1', authorId: 'u1', body: 'coucou' },
    }));
    expect(prismaMock.conversation.update).toHaveBeenCalledWith({
      where: { id: 'c1' }, data: { lastMessageAt: created.createdAt },
    });
    expect(broadcast).toHaveBeenCalledWith('c1', { type: 'dm_message', message: expect.objectContaining({ id: 'm3' }) });
    expect(mockNotify).toHaveBeenCalledWith('c1', 'm3', 'u1');
    expect(dto.body).toBe('coucou');
  });

  it('postMessage : vide ou > 2000 → VALIDATION_ERROR', async () => {
    await expect(service.postMessage('c1', 'u1', '   ')).rejects.toThrow('VALIDATION_ERROR');
    await expect(service.postMessage('c1', 'u1', 'x'.repeat(2001))).rejects.toThrow('VALIDATION_ERROR');
  });

  it('postMessage : paire bloquée → USER_BLOCKED (quel que soit le sens)', async () => {
    prismaMock.userBlock.findFirst.mockResolvedValue({ id: 'b1' } as any);
    await expect(service.postMessage('c1', 'u1', 'yo')).rejects.toThrow('USER_BLOCKED');
  });

  it('postMessage : un échec de notification ne casse pas l\'envoi', async () => {
    prismaMock.directMessage.create.mockResolvedValue(MSG_ROW('m3', 'u1', 'yo') as any);
    prismaMock.conversation.update.mockResolvedValue({} as any);
    mockNotify.mockRejectedValue(new Error('SMTP down'));
    await expect(service.postMessage('c1', 'u1', 'yo')).resolves.toMatchObject({ id: 'm3' });
  });

  it('deleteMessage : auteur seul, pierre tombale + broadcast', async () => {
    prismaMock.directMessage.findUnique.mockResolvedValue({ ...MSG_ROW('m1', 'u1', 'a'), conversationId: 'c1', authorId: 'u1' } as any);
    prismaMock.directMessage.update.mockResolvedValue(MSG_ROW('m1', 'u1', 'a', { deletedAt: new Date() }) as any);
    const dto = await service.deleteMessage('c1', 'u1', 'm1');
    expect(dto.deleted).toBe(true);
    expect(dto.body).toBe('');
    expect(broadcast).toHaveBeenCalledWith('c1', { type: 'dm_deleted', message: expect.objectContaining({ id: 'm1', deleted: true }) });
  });

  it('deleteMessage : non-auteur → NOT_ALLOWED ; déjà supprimé → idempotent sans re-broadcast', async () => {
    prismaMock.directMessage.findUnique.mockResolvedValue({ ...MSG_ROW('m1', 'u2', 'a'), conversationId: 'c1', authorId: 'u2' } as any);
    await expect(service.deleteMessage('c1', 'u1', 'm1')).rejects.toThrow('NOT_ALLOWED');
    prismaMock.directMessage.findUnique.mockResolvedValue({ ...MSG_ROW('m1', 'u1', 'a', { deletedAt: new Date() }), conversationId: 'c1', authorId: 'u1' } as any);
    const dto = await service.deleteMessage('c1', 'u1', 'm1');
    expect(dto.deleted).toBe(true);
    expect(broadcast).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2 : Vérifier l'échec** — `listMessages is not a function`.

- [ ] **Step 3 : Implémenter** (méthodes à ajouter dans la classe `MessagingService`)

```typescript
  /** Fil paginé par curseur (before = id de message), renvoyé en ordre CHRONO. */
  async listMessages(conversationId: string, meId: string, before?: string | null, limitRaw?: string | number | null):
    Promise<{ messages: DmMessageDTO[]; meta: DmListMeta }> {
    const { conv, otherId } = await this.assertParticipant(conversationId, meId);
    const limit = Math.min(Math.max(Number(limitRaw) || PAGE_DEFAULT, 1), PAGE_MAX);
    const rows = await prisma.directMessage.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(before ? { cursor: { id: before }, skip: 1 } : {}),
      select: MSG_SELECT,
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).reverse();
    const mine = conv.participants.find((p) => p.userId === meId);
    const theirs = conv.participants.find((p) => p.userId === otherId);
    return {
      messages: page.map(toMessageDTO),
      meta: {
        myLastReadAt: mine?.lastReadAt?.toISOString() ?? null,
        otherLastReadAt: theirs?.lastReadAt?.toISOString() ?? null,
        blocked: await this.pairBlocked(meId, otherId),
        hasMore,
      },
    };
  }

  /** Poste un message texte : valide, crée, avance lastMessageAt, broadcast, notifie (best-effort). */
  async postMessage(conversationId: string, meId: string, rawBody: string): Promise<DmMessageDTO> {
    const { otherId } = await this.assertParticipant(conversationId, meId);
    await this.assertNotBlocked(meId, otherId);
    const body = (rawBody ?? '').trim();
    if (!body || body.length > MAX_BODY) throw new Error('VALIDATION_ERROR');
    const created = await prisma.directMessage.create({
      data: { conversationId, authorId: meId, body },
      select: MSG_SELECT,
    });
    return this.finishSend(conversationId, meId, created);
  }

  /** Fin d'envoi commune texte/photo : lastMessageAt + broadcast + notif best-effort. */
  private async finishSend(conversationId: string, meId: string, created: MsgRow): Promise<DmMessageDTO> {
    await prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: created.createdAt } });
    const dto = toMessageDTO(created);
    SSEService.getInstance().broadcastConversation(conversationId, { type: 'dm_message', message: dto });
    try { await notifyDirectMessage(conversationId, created.id, meId); }
    catch (err) { console.error('[messaging] notification échouée', err); }
    return dto;
  }

  /** Supprime un message : AUTEUR SEUL (pas de modération staff en privé). Pierre tombale idempotente. */
  async deleteMessage(conversationId: string, meId: string, messageId: string): Promise<DmMessageDTO> {
    await this.assertParticipant(conversationId, meId);
    const msg = await prisma.directMessage.findUnique({
      where: { id: messageId },
      select: { ...MSG_SELECT, conversationId: true, authorId: true },
    });
    if (!msg || msg.conversationId !== conversationId) throw new Error('MESSAGE_NOT_FOUND');
    if (msg.authorId !== meId) throw new Error('NOT_ALLOWED');
    if (msg.deletedAt) return toMessageDTO(msg); // idempotent, pas de re-broadcast
    if (msg.imageUrl) this.unlinkImage(msg.imageUrl); // best-effort (défini en tâche 8)
    const updated = await prisma.directMessage.update({
      where: { id: messageId },
      data: { deletedAt: new Date(), deletedById: meId },
      select: MSG_SELECT,
    });
    const dto = toMessageDTO(updated);
    SSEService.getInstance().broadcastConversation(conversationId, { type: 'dm_deleted', message: dto });
    return dto;
  }

  /** Stub rempli en tâche 8 (photos). */
  private unlinkImage(_relPath: string): void { /* no-op avant la tâche 8 */ }
```

- [ ] **Step 4 : Vérifier** — suite complète du service PASS.

- [ ] **Step 5 : Commit**

```
git add backend/src/services/messaging.service.ts backend/src/services/__tests__/messaging.service.test.ts
git commit -m "feat(dm): fil pagine par curseur, envoi (broadcast+notif best-effort), suppression pierre tombale"
```

---

### Task 5 : `MessagingService` — lecture (✓✓), réactions, frappe, blocages (TDD)

**Files:**
- Modify: `backend/src/services/messaging.service.ts`
- Test: `backend/src/services/__tests__/messaging.service.test.ts` (ajouter les blocs)

- [ ] **Step 1 : Tests qui échouent**

```typescript
describe('MessagingService — lecture, réactions, frappe, blocages', () => {
  let service: MessagingService;
  let broadcast: jest.SpyInstance;
  beforeEach(() => {
    service = new MessagingService();
    broadcast = jest.spyOn(SSEService.getInstance(), 'broadcastConversation').mockImplementation(() => {});
    prismaMock.conversation.findUnique.mockResolvedValue(CONV as any);
    prismaMock.userBlock.findFirst.mockResolvedValue(null);
  });
  afterEach(() => broadcast.mockRestore());

  it('markRead : pose lastReadAt, marque les notifs dm lues, broadcast dm_read', async () => {
    prismaMock.conversationParticipant.update.mockResolvedValue({ lastReadAt: new Date('2026-07-04T11:00:00Z') } as any);
    prismaMock.notification.updateMany.mockResolvedValue({ count: 2 } as any);
    const r = await service.markRead('c1', 'u1');
    expect(prismaMock.conversationParticipant.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { conversationId_userId: { conversationId: 'c1', userId: 'u1' } },
    }));
    expect(prismaMock.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', type: 'dm.message', readAt: null, data: { path: ['conversationId'], equals: 'c1' } },
      data: { readAt: expect.any(Date) },
    });
    expect(broadcast).toHaveBeenCalledWith('c1', { type: 'dm_read', userId: 'u1', lastReadAt: '2026-07-04T11:00:00.000Z' });
    expect(r.lastReadAt).toBe('2026-07-04T11:00:00.000Z');
  });

  it('addReaction : idempotent (P2002 avalé), broadcast l\'état complet des réactions', async () => {
    prismaMock.directMessage.findUnique.mockResolvedValue({ id: 'm1', conversationId: 'c1', deletedAt: null } as any);
    prismaMock.messageReaction.create.mockRejectedValue({ code: 'P2002' });
    prismaMock.messageReaction.findMany.mockResolvedValue([
      { emoji: '👍', userId: 'u1' }, { emoji: '👍', userId: 'u2' }, { emoji: '❤️', userId: 'u2' },
    ] as any);
    const r = await service.addReaction('c1', 'u1', 'm1', '👍');
    expect(r).toEqual([{ emoji: '👍', userIds: ['u1', 'u2'] }, { emoji: '❤️', userIds: ['u2'] }]);
    expect(broadcast).toHaveBeenCalledWith('c1', { type: 'dm_reaction', messageId: 'm1', reactions: r });
  });

  it('addReaction : message supprimé ou étranger → MESSAGE_NOT_FOUND ; emoji vide → VALIDATION_ERROR', async () => {
    prismaMock.directMessage.findUnique.mockResolvedValue({ id: 'm1', conversationId: 'c1', deletedAt: new Date() } as any);
    await expect(service.addReaction('c1', 'u1', 'm1', '👍')).rejects.toThrow('MESSAGE_NOT_FOUND');
    prismaMock.directMessage.findUnique.mockResolvedValue({ id: 'm1', conversationId: 'c1', deletedAt: null } as any);
    await expect(service.addReaction('c1', 'u1', 'm1', '')).rejects.toThrow('VALIDATION_ERROR');
  });

  it('removeReaction : deleteMany idempotent + broadcast', async () => {
    prismaMock.directMessage.findUnique.mockResolvedValue({ id: 'm1', conversationId: 'c1', deletedAt: null } as any);
    prismaMock.messageReaction.deleteMany.mockResolvedValue({ count: 1 } as any);
    prismaMock.messageReaction.findMany.mockResolvedValue([] as any);
    const r = await service.removeReaction('c1', 'u1', 'm1', '👍');
    expect(prismaMock.messageReaction.deleteMany).toHaveBeenCalledWith({ where: { messageId: 'm1', userId: 'u1', emoji: '👍' } });
    expect(r).toEqual([]);
  });

  it('typing : broadcast éphémère, rien en base', async () => {
    await service.typing('c1', 'u1');
    expect(broadcast).toHaveBeenCalledWith('c1', { type: 'dm_typing', userId: 'u1' });
  });

  it('block/unblock : self refusé, create idempotent, unblock deleteMany', async () => {
    await expect(service.block('u1', 'u1')).rejects.toThrow('CANNOT_BLOCK_SELF');
    prismaMock.userBlock.create.mockRejectedValue({ code: 'P2002' });
    await expect(service.block('u1', 'u2')).resolves.toEqual({ blocked: true });
    prismaMock.userBlock.deleteMany.mockResolvedValue({ count: 1 } as any);
    await expect(service.unblock('u1', 'u2')).resolves.toEqual({ blocked: false });
    expect(prismaMock.userBlock.deleteMany).toHaveBeenCalledWith({ where: { blockerId: 'u1', blockedId: 'u2' } });
  });

  it('listBlocks : renvoie les utilisateurs que J\'AI bloqués', async () => {
    prismaMock.userBlock.findMany.mockResolvedValue([
      { blocked: U('u2') }, { blocked: U('u3') },
    ] as any);
    const list = await service.listBlocks('u1');
    expect(list.map((b) => b.userId)).toEqual(['u2', 'u3']);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec** — `markRead is not a function`.

- [ ] **Step 3 : Implémenter** (méthodes à ajouter dans la classe)

```typescript
  /** Marque la conversation lue : curseur lastReadAt + notifs dm lues + broadcast dm_read (✓✓ live). */
  async markRead(conversationId: string, meId: string): Promise<{ lastReadAt: string }> {
    await this.assertParticipant(conversationId, meId);
    const now = new Date();
    const part = await prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId: meId } },
      data: { lastReadAt: now },
      select: { lastReadAt: true },
    });
    await prisma.notification.updateMany({
      where: { userId: meId, type: 'dm.message', readAt: null, data: { path: ['conversationId'], equals: conversationId } },
      data: { readAt: now },
    });
    const iso = (part.lastReadAt ?? now).toISOString();
    SSEService.getInstance().broadcastConversation(conversationId, { type: 'dm_read', userId: meId, lastReadAt: iso });
    return { lastReadAt: iso };
  }

  /** Message vivant de CETTE conversation, sinon MESSAGE_NOT_FOUND. */
  private async assertLiveMessage(conversationId: string, messageId: string): Promise<void> {
    const msg = await prisma.directMessage.findUnique({
      where: { id: messageId },
      select: { id: true, conversationId: true, deletedAt: true },
    });
    if (!msg || msg.conversationId !== conversationId || msg.deletedAt) throw new Error('MESSAGE_NOT_FOUND');
  }

  private async reactionsOf(messageId: string): Promise<DmReactionDTO[]> {
    const rows = await prisma.messageReaction.findMany({
      where: { messageId },
      orderBy: { createdAt: 'asc' },
      select: { emoji: true, userId: true },
    });
    const byEmoji = new Map<string, string[]>();
    for (const r of rows) {
      if (!byEmoji.has(r.emoji)) byEmoji.set(r.emoji, []);
      byEmoji.get(r.emoji)!.push(r.userId);
    }
    return [...byEmoji.entries()].map(([emoji, userIds]) => ({ emoji, userIds }));
  }

  private async broadcastReactions(conversationId: string, messageId: string): Promise<DmReactionDTO[]> {
    const reactions = await this.reactionsOf(messageId);
    SSEService.getInstance().broadcastConversation(conversationId, { type: 'dm_reaction', messageId, reactions });
    return reactions;
  }

  /** Ajoute une réaction (idempotent) et renvoie l'état complet des réactions du message. */
  async addReaction(conversationId: string, meId: string, messageId: string, emoji: string): Promise<DmReactionDTO[]> {
    const { otherId } = await this.assertParticipant(conversationId, meId);
    await this.assertNotBlocked(meId, otherId);
    const e = (emoji ?? '').trim();
    if (!e || e.length > 16) throw new Error('VALIDATION_ERROR');
    await this.assertLiveMessage(conversationId, messageId);
    try { await prisma.messageReaction.create({ data: { messageId, userId: meId, emoji: e } }); }
    catch { /* P2002 : déjà réagi avec cet emoji — idempotent */ }
    return this.broadcastReactions(conversationId, messageId);
  }

  /** Retire une réaction (idempotent) et renvoie l'état complet. */
  async removeReaction(conversationId: string, meId: string, messageId: string, emoji: string): Promise<DmReactionDTO[]> {
    await this.assertParticipant(conversationId, meId);
    await this.assertLiveMessage(conversationId, messageId);
    await prisma.messageReaction.deleteMany({ where: { messageId, userId: meId, emoji: (emoji ?? '').trim() } });
    return this.broadcastReactions(conversationId, messageId);
  }

  /** « X écrit… » : broadcast éphémère, RIEN en base (le client filtre son propre userId). */
  async typing(conversationId: string, meId: string): Promise<{ ok: true }> {
    await this.assertParticipant(conversationId, meId);
    SSEService.getInstance().broadcastConversation(conversationId, { type: 'dm_typing', userId: meId });
    return { ok: true };
  }

  /** Blocage global : idempotent. Effet = plus d'envoi/réaction dans les deux sens (messagerie seulement). */
  async block(meId: string, targetUserId: string): Promise<{ blocked: true }> {
    if (!targetUserId || targetUserId === meId) throw new Error('CANNOT_BLOCK_SELF');
    try { await prisma.userBlock.create({ data: { blockerId: meId, blockedId: targetUserId } }); }
    catch { /* P2002 : déjà bloqué — idempotent */ }
    return { blocked: true };
  }

  async unblock(meId: string, targetUserId: string): Promise<{ blocked: false }> {
    await prisma.userBlock.deleteMany({ where: { blockerId: meId, blockedId: targetUserId } });
    return { blocked: false };
  }

  /** Membres que J'AI bloqués (écran de gestion + déblocage). */
  async listBlocks(meId: string): Promise<DmUser[]> {
    const rows = await prisma.userBlock.findMany({
      where: { blockerId: meId },
      orderBy: { createdAt: 'desc' },
      select: { blocked: { select: USER_SELECT } },
    });
    return rows.map((r) => toUser(r.blocked));
  }
```

- [ ] **Step 4 : Vérifier** — suite complète PASS. Puis `node node_modules/typescript/bin/tsc --noEmit` → 0 erreur.

- [ ] **Step 5 : Commit**

```
git add backend/src/services/messaging.service.ts backend/src/services/__tests__/messaging.service.test.ts
git commit -m "feat(dm): lecture (lastReadAt + dm_read), reactions emoji, frappe, blocages"
```

---

### Task 6 : Notification `dm.message` + email coalescé + registre (TDD)

**Files:**
- Modify: `backend/src/email/notifications.ts` (nouvelle fonction en fin de fichier)
- Modify: `backend/src/email/registry.ts` (union `group` + entrée `EMAIL_DEFS`)
- Modify: `frontend/app/admin/emails/page.tsx` (GROUP_ORDER + GROUP_LABEL — petit ajout front fait ici pour garder le registre cohérent)
- Test: `backend/src/email/__tests__/notifications.dm.test.ts`

- [ ] **Step 1 : Tests qui échouent** (fichier complet — s'inspirer de `notifications.follow.test.ts` pour les mocks)

```typescript
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { SSEService } from '../../services/sse.service';

const mockDispatch = jest.fn();
jest.mock('../../services/notification/dispatcher', () => ({
  dispatch: (...a: unknown[]) => mockDispatch(...a),
}));
jest.mock('../../services/emailTemplate.service', () => ({
  emailTemplates: { getOverride: jest.fn().mockResolvedValue(null) },
}));

import { notifyDirectMessage } from '../notifications';

const CONV = {
  clubId: 'club-demo', userAId: 'u1', userBId: 'u2',
  messages: [{ body: 'on joue samedi ?', imageUrl: null, author: { firstName: 'Éric', lastName: 'N' } }],
};
const CLUB = { id: 'club-demo', name: 'Padel Arena', slug: 'demo', logoUrl: null, accentColor: '#123456' };

describe('notifyDirectMessage', () => {
  beforeEach(() => {
    mockDispatch.mockReset().mockResolvedValue(undefined);
    prismaMock.conversation.findUnique.mockResolvedValue(CONV as any);
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u2', email: 'u2@test.fr', firstName: 'Marie', deletedAt: null } as any);
    prismaMock.notification.findFirst.mockResolvedValue(null);
    prismaMock.club.findUnique.mockResolvedValue(CLUB as any);
    jest.spyOn(SSEService.getInstance(), 'getConversationUserIds').mockReturnValue(new Set());
  });
  afterEach(() => jest.restoreAllMocks());

  it('notifie le destinataire absent : catégorie DIRECT_MESSAGES, data.conversationId, email brandé', async () => {
    await notifyDirectMessage('c1', 'm1', 'u1');
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'u2', clubId: 'club-demo', category: 'DIRECT_MESSAGES', type: 'dm.message',
      url: '/me/messages?with=u1',
      data: { conversationId: 'c1' },
      email: expect.objectContaining({ to: 'u2@test.fr' }),
    }));
  });

  it('destinataire connecté au flux de la conversation → aucune notif', async () => {
    (SSEService.getInstance().getConversationUserIds as jest.Mock).mockReturnValue(new Set(['u2']));
    await notifyDirectMessage('c1', 'm1', 'u1');
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('email coalescé : notif dm non lue existante pour la conversation → dispatch avec email null', async () => {
    prismaMock.notification.findFirst.mockResolvedValue({ id: 'n1' } as any);
    await notifyDirectMessage('c1', 'm1', 'u1');
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({ email: null }));
  });

  it('message photo sans texte → aperçu « 📷 Photo »', async () => {
    prismaMock.conversation.findUnique.mockResolvedValue({
      ...CONV, messages: [{ body: '', imageUrl: 'c1/x.jpg', author: { firstName: 'Éric', lastName: 'N' } }],
    } as any);
    await notifyDirectMessage('c1', 'm1', 'u1');
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({ body: '📷 Photo' }));
  });

  it('destinataire supprimé (RGPD) → rien', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u2', email: 'x', firstName: 'M', deletedAt: new Date() } as any);
    await notifyDirectMessage('c1', 'm1', 'u1');
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2 : Vérifier l'échec** — `notifyDirectMessage` n'existe pas.

- [ ] **Step 3 : Implémenter `notifyDirectMessage`** (fin de `backend/src/email/notifications.ts`)

```typescript
/**
 * Notifie le destinataire ABSENT du fil qu'un message privé est arrivé.
 * In-app + push À CHAQUE message ; EMAIL COALESCÉ par conversation (envoyé seulement
 * s'il n'existe pas déjà une notif dm.message non lue pour cette conversation).
 * Les compteurs de non-lus DM viennent de lastReadAt, PAS des notifications.
 */
export async function notifyDirectMessage(conversationId: string, messageId: string, authorUserId: string): Promise<void> {
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      clubId: true, userAId: true, userBId: true,
      messages: { where: { id: messageId }, select: { body: true, imageUrl: true, author: { select: { firstName: true, lastName: true } } } },
    },
  });
  const msg = conv?.messages[0];
  if (!conv || !msg) return;

  const recipientId = conv.userAId === authorUserId ? conv.userBId : conv.userAId;
  if (SSEService.getInstance().getConversationUserIds(conversationId).has(recipientId)) return;

  const recipient = await prisma.user.findUnique({
    where: { id: recipientId },
    select: { id: true, email: true, firstName: true, deletedAt: true },
  });
  if (!recipient || recipient.deletedAt) return;

  const authorName = fullName(msg.author);
  const raw = msg.body || (msg.imageUrl ? '📷 Photo' : '');
  const snippet = raw.length > 140 ? `${raw.slice(0, 140)}…` : raw;
  const url = `/me/messages?with=${authorUserId}`;

  // Email coalescé par conversation (5 messages en 2 min = 1 email).
  const already = await prisma.notification.findFirst({
    where: { userId: recipientId, type: 'dm.message', readAt: null, data: { path: ['conversationId'], equals: conversationId } },
    select: { id: true },
  });

  let email: { to: string; subject: string; html: string; text: string } | null = null;
  if (!already && conv.clubId && recipient.email) {
    const club = await prisma.club.findUnique({
      where: { id: conv.clubId },
      select: { id: true, name: true, slug: true, logoUrl: true, accentColor: true },
    });
    if (club) {
      const override = await emailTemplates.getOverride(club.id, 'dm.message');
      const mail = renderClubEmail('dm.message', {
        prenom: recipient.firstName,
        auteur: authorName,
        message: snippet,
        club: club.name,
        lien: clubAppUrl(club.slug, `/me/messages?with=${authorUserId}`),
      }, brandFromClub(club), override);
      email = { to: recipient.email, subject: mail.subject, html: mail.html, text: mail.text };
    }
  }

  await dispatch({
    userId: recipientId, clubId: conv.clubId, category: 'DIRECT_MESSAGES', type: 'dm.message',
    title: `Message de ${authorName}`,
    body: snippet,
    url, data: { conversationId },
    email,
  });
}
```

- [ ] **Step 4 : Registre email**

Dans `backend/src/email/registry.ts` :
1. Union `EmailDef.group` (l.62) : ajouter `| 'messages'`.
2. Nouvelle entrée dans `EMAIL_DEFS` (après `'open_match.message'`) :

```typescript
  // ------------------------------------------------------------- Messagerie
  'dm.message': {
    type: 'dm.message', group: 'messages',
    title: 'Message privé reçu',
    description: 'Au destinataire absent quand un message privé arrive (1 email par rafale de messages).',
    hasCta: true,
    vars: [
      { key: 'prenom', label: 'Prénom', sample: 'Marie' },
      { key: 'auteur', label: 'Auteur du message', sample: 'Éric Nougayrède' },
      { key: 'message', label: 'Extrait du message', sample: 'On se fait un match samedi ?' },
      { key: 'club', label: 'Club', sample: 'Padel Arena Paris' },
      { key: 'lien', label: 'Lien', sample: 'https://club.palova.fr/me/messages' },
    ],
    defaults: {
      subject: 'Nouveau message de {{auteur}}',
      heading: 'Nouveau message privé 💬',
      bodyHtml: '<p>Bonjour {{prenom}},</p><p style="margin:0 0 12px;">Vous avez reçu un message privé :</p><p style="margin:0;padding:12px 14px;background:#f4f4f5;border-radius:8px;font-style:italic;"><strong>{{auteur}}</strong> : {{message}}</p>',
      ctaLabel: 'Répondre',
    },
    infoRows: (v) => [row('Club', v.club)],
  },
```

3. Front `frontend/app/admin/emails/page.tsx` : `GROUP_ORDER` → `['inscriptions', 'organisateur', 'parties', 'messages', 'matchs', 'paiement']` ; `GROUP_LABEL` → ajouter `messages: 'Messagerie'`.

- [ ] **Step 5 : Vérifier puis committer**

`cd backend; node node_modules/jest/bin/jest.js src/email/__tests__/notifications.dm.test.ts src/email/__tests__` → PASS (les suites registre existantes restent vertes — la nouvelle entrée est additive).
```
git add backend/src/email/notifications.ts backend/src/email/registry.ts backend/src/email/__tests__/notifications.dm.test.ts frontend/app/admin/emails/page.tsx
git commit -m "feat(dm): notif dm.message (in-app+push par message, email coalesce par conversation) + email personnalisable"
```

---

### Task 7 : Routes `/api/me/*` + `/api/conversations/*` + SSE (TDD)

**Files:**
- Create: `backend/src/routes/conversations.ts`
- Modify: `backend/src/app.ts`
- Test: `backend/src/routes/__tests__/conversations.routes.test.ts`

- [ ] **Step 1 : Tests qui échouent** (pattern `friends.routes.test.ts` : service mocké + supertest)

```typescript
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';

let mocks: Record<string, jest.Mock>;
jest.mock('../../services/messaging.service', () => ({
  MessagingService: jest.fn().mockImplementation(() => new Proxy({}, {
    get: (_t, prop: string) => (...a: unknown[]) => mocks[prop]?.(...a),
  })),
}));

const token = jwt.sign({ id: 'u1', email: 'u1@test.fr' }, process.env.JWT_SECRET!);

describe('routes conversations', () => {
  beforeEach(() => { mocks = {
    getOrCreateConversation: jest.fn(), listConversations: jest.fn(), unreadTotal: jest.fn(),
    listMessages: jest.fn(), postMessage: jest.fn(), deleteMessage: jest.fn(),
    addReaction: jest.fn(), removeReaction: jest.fn(), markRead: jest.fn(), typing: jest.fn(),
    block: jest.fn(), unblock: jest.fn(), listBlocks: jest.fn(),
    assertParticipantPublic: jest.fn(),
  }; });

  it('GET /api/me/conversations (auth requise)', async () => {
    mocks.listConversations.mockResolvedValue([]);
    expect((await request(app).get('/api/me/conversations')).status).toBe(401);
    const res = await request(app).get('/api/me/conversations').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(mocks.listConversations).toHaveBeenCalledWith('u1');
  });

  it('GET /api/me/conversations/unread-count', async () => {
    mocks.unreadTotal.mockResolvedValue({ count: 3 });
    const res = await request(app).get('/api/me/conversations/unread-count').set('Authorization', `Bearer ${token}`);
    expect(res.body).toEqual({ count: 3 });
  });

  it('POST /api/me/conversations passe otherUserId + clubSlug', async () => {
    mocks.getOrCreateConversation.mockResolvedValue({ id: 'c1' });
    const res = await request(app).post('/api/me/conversations')
      .send({ otherUserId: 'u2', clubSlug: 'demo' }).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(mocks.getOrCreateConversation).toHaveBeenCalledWith('u1', 'u2', 'demo');
  });

  it('GET /api/conversations/:id/messages relaie before/limit', async () => {
    mocks.listMessages.mockResolvedValue({ messages: [], meta: {} });
    await request(app).get('/api/conversations/c1/messages?before=m9&limit=20').set('Authorization', `Bearer ${token}`);
    expect(mocks.listMessages).toHaveBeenCalledWith('c1', 'u1', 'm9', '20');
  });

  it('POST message / DELETE message / réactions / read / typing', async () => {
    mocks.postMessage.mockResolvedValue({ id: 'm1' });
    await request(app).post('/api/conversations/c1/messages').send({ body: 'yo' }).set('Authorization', `Bearer ${token}`);
    expect(mocks.postMessage).toHaveBeenCalledWith('c1', 'u1', 'yo');

    mocks.deleteMessage.mockResolvedValue({ id: 'm1', deleted: true });
    await request(app).delete('/api/conversations/c1/messages/m1').set('Authorization', `Bearer ${token}`);
    expect(mocks.deleteMessage).toHaveBeenCalledWith('c1', 'u1', 'm1');

    mocks.addReaction.mockResolvedValue([]);
    await request(app).post('/api/conversations/c1/messages/m1/reactions').send({ emoji: '👍' }).set('Authorization', `Bearer ${token}`);
    expect(mocks.addReaction).toHaveBeenCalledWith('c1', 'u1', 'm1', '👍');

    mocks.removeReaction.mockResolvedValue([]);
    await request(app).delete('/api/conversations/c1/messages/m1/reactions?emoji=%F0%9F%91%8D').set('Authorization', `Bearer ${token}`);
    expect(mocks.removeReaction).toHaveBeenCalledWith('c1', 'u1', 'm1', '👍');

    mocks.markRead.mockResolvedValue({ lastReadAt: 'x' });
    await request(app).post('/api/conversations/c1/read').set('Authorization', `Bearer ${token}`);
    expect(mocks.markRead).toHaveBeenCalledWith('c1', 'u1');

    mocks.typing.mockResolvedValue({ ok: true });
    await request(app).post('/api/conversations/c1/typing').set('Authorization', `Bearer ${token}`);
    expect(mocks.typing).toHaveBeenCalledWith('c1', 'u1');
  });

  it('blocs : POST/DELETE /api/me/blocks/:userId + GET /api/me/blocks', async () => {
    mocks.block.mockResolvedValue({ blocked: true });
    await request(app).post('/api/me/blocks/u2').set('Authorization', `Bearer ${token}`);
    expect(mocks.block).toHaveBeenCalledWith('u1', 'u2');
    mocks.unblock.mockResolvedValue({ blocked: false });
    await request(app).delete('/api/me/blocks/u2').set('Authorization', `Bearer ${token}`);
    expect(mocks.unblock).toHaveBeenCalledWith('u1', 'u2');
    mocks.listBlocks.mockResolvedValue([]);
    await request(app).get('/api/me/blocks').set('Authorization', `Bearer ${token}`);
    expect(mocks.listBlocks).toHaveBeenCalledWith('u1');
  });

  it('mapping erreurs : NOT_CO_MEMBERS 403, USER_BLOCKED 409, CANNOT_MESSAGE_SELF 400, CONVERSATION_NOT_FOUND 404', async () => {
    for (const [code, status] of [
      ['NOT_CO_MEMBERS', 403], ['USER_BLOCKED', 409], ['CANNOT_MESSAGE_SELF', 400], ['CONVERSATION_NOT_FOUND', 404],
    ] as const) {
      mocks.getOrCreateConversation.mockRejectedValue(new Error(code));
      const res = await request(app).post('/api/me/conversations').send({ otherUserId: 'u2' }).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(status);
      expect(res.body).toEqual({ error: code });
    }
  });

  it('SSE : token invalide → 401 ; non-participant → 403', async () => {
    const bad = await request(app).get('/api/conversations/c1/stream?token=nope');
    expect(bad.status).toBe(401);
    mocks.assertParticipantPublic.mockRejectedValue(new Error('CONVERSATION_NOT_FOUND'));
    const forbidden = await request(app).get(`/api/conversations/c1/stream?token=${token}`);
    expect(forbidden.status).toBe(403);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec** — 404 sur toutes les routes.

- [ ] **Step 3 : Ajouter la garde publique au service** (`messaging.service.ts`, pour la route SSE — miroir d'`assertChatAccessPublic`)

```typescript
  /** Variante publique de la garde participant, pour la route SSE (lève si pas d'accès). */
  async assertParticipantPublic(conversationId: string, userId: string): Promise<void> {
    await this.assertParticipant(conversationId, userId);
  }
```

- [ ] **Step 4 : Créer `backend/src/routes/conversations.ts`** (deux routers nommés)

```typescript
import { Router, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { MessagingService } from '../services/messaging.service';
import { SSEService } from '../services/sse.service';

const messagingService = new MessagingService();

const ERROR_STATUS: Record<string, number> = {
  CONVERSATION_NOT_FOUND: 404,
  MESSAGE_NOT_FOUND:      404,
  NOT_CO_MEMBERS:         403,
  NOT_ALLOWED:            403,
  USER_BLOCKED:           409,
  CANNOT_MESSAGE_SELF:    400,
  CANNOT_BLOCK_SELF:      400,
  VALIDATION_ERROR:       400,
};

const handleError = (err: unknown, res: Response, next: NextFunction) => {
  const message = (err as Error).message;
  const status = ERROR_STATUS[message];
  if (status) return void res.status(status).json({ error: message });
  next(err);
};

function asString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return '';
}

// ---------------------------------------------------------------------------
// Router monté sur /api/me : boîte de réception + blocages (scope « moi »).
// ---------------------------------------------------------------------------
export const meMessagingRouter = Router();

// ⚠️ /unread-count AVANT tout paramètre : sous /api/me il n'y a pas de :id ici, mais on
// garde l'ordre par cohérence avec le pattern open-matches.
meMessagingRouter.get('/conversations/unread-count', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await messagingService.unreadTotal(req.user!.id)); }
  catch (err) { handleError(err, res, next); }
});

meMessagingRouter.get('/conversations', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await messagingService.listConversations(req.user!.id)); }
  catch (err) { handleError(err, res, next); }
});

// Get-or-create : { otherUserId, clubSlug? } — clubSlug pose le club de contexte (branding).
meMessagingRouter.post('/conversations', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = req.body as { otherUserId?: unknown; clubSlug?: unknown };
    const otherUserId = typeof body.otherUserId === 'string' ? body.otherUserId : '';
    const clubSlug = typeof body.clubSlug === 'string' ? body.clubSlug : null;
    res.json(await messagingService.getOrCreateConversation(req.user!.id, otherUserId, clubSlug));
  } catch (err) { handleError(err, res, next); }
});

meMessagingRouter.get('/blocks', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await messagingService.listBlocks(req.user!.id)); }
  catch (err) { handleError(err, res, next); }
});
meMessagingRouter.post('/blocks/:userId', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await messagingService.block(req.user!.id, asString(req.params.userId))); }
  catch (err) { handleError(err, res, next); }
});
meMessagingRouter.delete('/blocks/:userId', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await messagingService.unblock(req.user!.id, asString(req.params.userId))); }
  catch (err) { handleError(err, res, next); }
});

// ---------------------------------------------------------------------------
// Router monté sur /api/conversations : le fil d'une conversation.
// ---------------------------------------------------------------------------
export const conversationsRouter = Router();

conversationsRouter.get('/:id/messages', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const before = typeof req.query.before === 'string' ? req.query.before : null;
    const limit = typeof req.query.limit === 'string' ? req.query.limit : null;
    res.json(await messagingService.listMessages(asString(req.params.id), req.user!.id, before, limit));
  } catch (err) { handleError(err, res, next); }
});

conversationsRouter.post('/:id/messages', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = typeof (req.body as { body?: unknown }).body === 'string' ? (req.body as { body: string }).body : '';
    res.json(await messagingService.postMessage(asString(req.params.id), req.user!.id, body));
  } catch (err) { handleError(err, res, next); }
});

conversationsRouter.delete('/:id/messages/:messageId', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await messagingService.deleteMessage(asString(req.params.id), req.user!.id, asString(req.params.messageId))); }
  catch (err) { handleError(err, res, next); }
});

conversationsRouter.post('/:id/messages/:messageId/reactions', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const emoji = typeof (req.body as { emoji?: unknown }).emoji === 'string' ? (req.body as { emoji: string }).emoji : '';
    res.json(await messagingService.addReaction(asString(req.params.id), req.user!.id, asString(req.params.messageId), emoji));
  } catch (err) { handleError(err, res, next); }
});

conversationsRouter.delete('/:id/messages/:messageId/reactions', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const emoji = typeof req.query.emoji === 'string' ? req.query.emoji : '';
    res.json(await messagingService.removeReaction(asString(req.params.id), req.user!.id, asString(req.params.messageId), emoji));
  } catch (err) { handleError(err, res, next); }
});

conversationsRouter.post('/:id/read', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await messagingService.markRead(asString(req.params.id), req.user!.id)); }
  catch (err) { handleError(err, res, next); }
});

conversationsRouter.post('/:id/typing', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await messagingService.typing(asString(req.params.id), req.user!.id)); }
  catch (err) { handleError(err, res, next); }
});

// Flux SSE du fil. EventSource ne pose pas d'en-tête Authorization → token en query + garde.
conversationsRouter.get('/:id/stream', async (req: AuthRequest, res: Response) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  let userId: string;
  try { userId = (jwt.verify(token, process.env.JWT_SECRET!) as { id: string }).id; }
  catch { return void res.status(401).end(); }
  try { await messagingService.assertParticipantPublic(asString(req.params.id), userId); }
  catch { return void res.status(403).end(); }
  SSEService.getInstance().addConversationClient(asString(req.params.id), userId, res);
});
```

- [ ] **Step 5 : Monter dans `app.ts`**

```typescript
import { meMessagingRouter, conversationsRouter } from './routes/conversations';
```
et après `app.use('/api/me', notificationsRouter);` (l.61) :
```typescript
app.use('/api/me',            meMessagingRouter);
app.use('/api/conversations', conversationsRouter);
```

- [ ] **Step 6 : Vérifier puis committer**

`cd backend; node node_modules/jest/bin/jest.js src/routes/__tests__/conversations.routes.test.ts` → PASS.
```
git add backend/src/routes/conversations.ts backend/src/routes/__tests__/conversations.routes.test.ts backend/src/app.ts backend/src/services/messaging.service.ts
git commit -m "feat(dm): routes conversations + blocks + flux SSE (token en query)"
```

---

### Task 8 : Photos — stockage privé + upload + streaming authentifié (TDD)

**Files:**
- Modify: `backend/src/utils/uploads.ts`, `backend/src/services/messaging.service.ts`, `backend/src/routes/conversations.ts`, `docker-compose.prod.yml`
- Test: `backend/src/routes/__tests__/conversations.routes.test.ts` (bloc images)

- [ ] **Step 1 : Tests qui échouent** (à ajouter au fichier de routes ; ajouter `createImageMessage: jest.fn(), imagePathFor: jest.fn()` dans `mocks`)

```typescript
describe('routes conversations — images', () => {
  it('POST /api/conversations/:id/images : multipart → createImageMessage', async () => {
    mocks.createImageMessage.mockResolvedValue({ id: 'm1', imageUrl: 'c1/x.jpg' });
    const res = await request(app).post('/api/conversations/c1/images')
      .set('Authorization', `Bearer ${token}`)
      .field('body', 'légende')
      .attach('image', Buffer.from([0xff, 0xd8, 0xff]), { filename: 'p.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(200);
    expect(mocks.createImageMessage).toHaveBeenCalledWith('c1', 'u1',
      expect.objectContaining({ mimetype: 'image/jpeg' }), 'légende');
  });

  it('POST images : format non supporté → 400', async () => {
    mocks.createImageMessage.mockRejectedValue(new Error('VALIDATION_ERROR'));
    const res = await request(app).post('/api/conversations/c1/images')
      .set('Authorization', `Bearer ${token}`)
      .attach('image', Buffer.from('x'), { filename: 'x.gif', contentType: 'image/gif' });
    expect(res.status).toBe(400);
  });

  it('GET image : token en query + garde participant, 404 sans image', async () => {
    expect((await request(app).get('/api/conversations/c1/messages/m1/image?token=nope')).status).toBe(401);
    mocks.imagePathFor.mockRejectedValue(new Error('MESSAGE_NOT_FOUND'));
    const res = await request(app).get(`/api/conversations/c1/messages/m1/image?token=${token}`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2 : Répertoire privé** (`backend/src/utils/uploads.ts`)

```typescript
// Racine des fichiers PRIVÉS (photos de messagerie) — JAMAIS servie statiquement :
// streaming via une route authentifiée uniquement. Volume Docker dédié en prod.
export const PRIVATE_UPLOADS_DIR = process.env.PRIVATE_UPLOADS_DIR || path.join(process.cwd(), 'uploads-private');
export const DM_DIR = path.join(PRIVATE_UPLOADS_DIR, 'dm');
```
et dans `ensureUploadDirs()` : `fs.mkdirSync(DM_DIR, { recursive: true });`

- [ ] **Step 3 : Service — `createImageMessage`, `imagePathFor`, vrai `unlinkImage`** (dans `messaging.service.ts` ; imports à ajouter : `import fs from 'fs'; import path from 'path'; import { DM_DIR, EXT_BY_MIME } from '../utils/uploads';`)

```typescript
  /** Poste un message photo (JPEG/PNG/WebP ≤ 5 Mo, légende optionnelle ≤ 2000). */
  async createImageMessage(conversationId: string, meId: string,
    file: { buffer: Buffer; mimetype: string }, caption?: string | null): Promise<DmMessageDTO> {
    const { otherId } = await this.assertParticipant(conversationId, meId);
    await this.assertNotBlocked(meId, otherId);
    const ext = EXT_BY_MIME[file.mimetype];
    if (!ext) throw new Error('VALIDATION_ERROR');
    const body = (caption ?? '').trim();
    if (body.length > MAX_BODY) throw new Error('VALIDATION_ERROR');

    const relPath = `${conversationId}/${Date.now()}-${Math.round(Math.random() * 1e9)}.${ext}`;
    const absPath = path.join(DM_DIR, relPath);
    await fs.promises.mkdir(path.dirname(absPath), { recursive: true });
    await fs.promises.writeFile(absPath, file.buffer);

    let created: MsgRow;
    try {
      created = await prisma.directMessage.create({
        data: { conversationId, authorId: meId, body, imageUrl: relPath },
        select: MSG_SELECT,
      });
    } catch (err) {
      fs.promises.unlink(absPath).catch(() => {}); // pas de fichier orphelin
      throw err;
    }
    return this.finishSend(conversationId, meId, created);
  }

  /** Chemin absolu + mime d'une image de message, APRÈS garde participant. Anti-traversée. */
  async imagePathFor(conversationId: string, meId: string, messageId: string): Promise<{ absPath: string; mime: string }> {
    await this.assertParticipant(conversationId, meId);
    const msg = await prisma.directMessage.findUnique({
      where: { id: messageId },
      select: { conversationId: true, imageUrl: true, deletedAt: true },
    });
    if (!msg || msg.conversationId !== conversationId || msg.deletedAt || !msg.imageUrl) throw new Error('MESSAGE_NOT_FOUND');
    if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9.-]+$/.test(msg.imageUrl)) throw new Error('MESSAGE_NOT_FOUND'); // anti-traversée
    const ext = msg.imageUrl.split('.').pop()!.toLowerCase();
    const mime = ext === 'jpg' ? 'image/jpeg' : ext === 'png' ? 'image/png' : 'image/webp';
    return { absPath: path.join(DM_DIR, msg.imageUrl), mime };
  }
```
Remplacer le stub `unlinkImage` :
```typescript
  /** Suppression best-effort du fichier photo (confidentialité) — jamais bloquant. */
  private unlinkImage(relPath: string): void {
    if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9.-]+$/.test(relPath)) return;
    fs.promises.unlink(path.join(DM_DIR, relPath)).catch(() => {});
  }
```

- [ ] **Step 4 : Routes images** (dans `conversations.ts` ; imports : `import multer from 'multer';`)

```typescript
const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Message photo : multipart { image, body? } — 5 Mo max, JPEG/PNG/WebP.
conversationsRouter.post('/:id/images', authMiddleware, (req: AuthRequest, res: Response, next: NextFunction) => {
  imageUpload.single('image')(req, res, async (err: unknown) => {
    try {
      if (err) {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          return void res.status(400).json({ error: 'Image trop lourde (5 Mo max)' });
        }
        return next(err as Error);
      }
      if (!req.file) return void res.status(400).json({ error: 'VALIDATION_ERROR' });
      const caption = typeof (req.body as { body?: unknown })?.body === 'string' ? (req.body as { body: string }).body : '';
      res.json(await messagingService.createImageMessage(asString(req.params.id), req.user!.id, req.file, caption));
    } catch (e) { handleError(e, res, next); }
  });
});

// Streaming authentifié de la photo (les <img> ne posent pas d'Authorization → token en query).
conversationsRouter.get('/:id/messages/:messageId/image', async (req: AuthRequest, res: Response) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  let userId: string;
  try { userId = (jwt.verify(token, process.env.JWT_SECRET!) as { id: string }).id; }
  catch { return void res.status(401).end(); }
  try {
    const { absPath, mime } = await messagingService.imagePathFor(asString(req.params.id), userId, asString(req.params.messageId));
    res.sendFile(absPath, { headers: { 'Content-Type': mime, 'Cache-Control': 'private, max-age=31536000, immutable' } });
  } catch { res.status(404).end(); }
});
```
Note : le rejet « format non supporté » vient de `createImageMessage` (`VALIDATION_ERROR` → 400) — pour le test avec service mocké, faire rejeter `mocks.createImageMessage` avec `new Error('VALIDATION_ERROR')` dans le cas gif.

- [ ] **Step 5 : Volume prod** (`docker-compose.prod.yml`)

Sous le service backend, après `- backend_uploads:/app/uploads` :
```yaml
      # Photos de messagerie privée (jamais servies statiquement).
      - backend_uploads_private:/app/uploads-private
```
et dans le bloc `volumes:` final : `backend_uploads_private:`.

- [ ] **Step 6 : Vérifier puis committer**

Suites service + routes PASS ; `tsc --noEmit` OK.
```
git add backend/src/utils/uploads.ts backend/src/services/messaging.service.ts backend/src/routes/conversations.ts backend/src/routes/__tests__/conversations.routes.test.ts docker-compose.prod.yml
git commit -m "feat(dm): photos privees (uploads-private, upload multipart 5Mo, streaming authentifie)"
```

---

### Task 9 : Front — `lib/api.ts`, `lib/chatEmojis.ts`, helpers purs `lib/messages.ts` (TDD helpers)

**Files:**
- Create: `frontend/lib/chatEmojis.ts`, `frontend/lib/messages.ts`
- Modify: `frontend/lib/api.ts`, `frontend/components/openmatch/OpenMatchChatSheet.tsx`
- Test: `frontend/__tests__/messages.test.ts`

- [ ] **Step 1 : Extraire `CHAT_EMOJIS`** — créer `frontend/lib/chatEmojis.ts` :

```typescript
// Palette d'emojis des chats (partie ouverte + messagerie privée). Curée, sans dépendance.
export const CHAT_EMOJIS = [
  '😀', '😁', '😄', '😅', '😂', '🙂', '😉', '😍', '😎', '🤩',
  '😘', '😴', '🥵', '😢', '😡', '🤝', '👍', '👎', '👏', '🙌',
  '💪', '🔥', '🎾', '🏆', '⏰', '📍', '✅', '❌', '❓', '🎉', '🙏', '💯',
];

// Barre de réactions rapides (appui long / survol d'un message privé).
export const QUICK_REACTIONS = ['❤️', '👍', '😂', '😮'];
```
Dans `OpenMatchChatSheet.tsx` : supprimer la constante locale `CHAT_EMOJIS` (l.11-16) et ajouter `import { CHAT_EMOJIS } from '@/lib/chatEmojis';`. Lancer `cd frontend; node node_modules/jest/bin/jest.js __tests__/OpenMatchChatSheet.test.tsx` → toujours PASS (aucun changement de comportement).

- [ ] **Step 2 : Types + méthodes `lib/api.ts`**

Types (près des types sociaux, ~l.1890) :
```typescript
// --- Messagerie privée 1-à-1 ---
export interface DmUserInfo { userId: string; firstName: string; lastName: string; avatarUrl: string | null }
export interface DmReaction { emoji: string; userIds: string[] }
export interface DmMessage {
  id: string; author: DmUserInfo; body: string; imageUrl: string | null;
  createdAt: string; deleted: boolean; reactions: DmReaction[];
}
export interface DmMeta { myLastReadAt: string | null; otherLastReadAt: string | null; blocked: boolean; hasMore: boolean }
export interface ConversationSummary {
  id: string; other: DmUserInfo; clubId: string | null; lastMessageAt: string | null;
  unreadCount: number;
  lastMessage: { body: string; hasImage: boolean; mine: boolean; deleted: boolean } | null;
}
```
Méthodes (dans `api`, près des méthodes sociales ~l.598) :
```typescript
  // --- Messagerie privée ---
  listConversations: (token: string) => request<ConversationSummary[]>('/api/me/conversations', {}, token),
  getDmUnread: (token: string) => request<{ count: number }>('/api/me/conversations/unread-count', {}, token),
  openConversation: (otherUserId: string, token: string, clubSlug?: string | null) =>
    request<ConversationSummary>('/api/me/conversations', { method: 'POST', body: JSON.stringify({ otherUserId, clubSlug }) }, token),
  getDmMessages: (conversationId: string, token: string, before?: string | null) =>
    request<{ messages: DmMessage[]; meta: DmMeta }>(
      `/api/conversations/${conversationId}/messages${before ? `?before=${encodeURIComponent(before)}` : ''}`, {}, token),
  postDmMessage: (conversationId: string, body: string, token: string) =>
    request<DmMessage>(`/api/conversations/${conversationId}/messages`, { method: 'POST', body: JSON.stringify({ body }) }, token),
  deleteDmMessage: (conversationId: string, messageId: string, token: string) =>
    request<DmMessage>(`/api/conversations/${conversationId}/messages/${messageId}`, { method: 'DELETE' }, token),
  addDmReaction: (conversationId: string, messageId: string, emoji: string, token: string) =>
    request<DmReaction[]>(`/api/conversations/${conversationId}/messages/${messageId}/reactions`,
      { method: 'POST', body: JSON.stringify({ emoji }) }, token),
  removeDmReaction: (conversationId: string, messageId: string, emoji: string, token: string) =>
    request<DmReaction[]>(`/api/conversations/${conversationId}/messages/${messageId}/reactions?emoji=${encodeURIComponent(emoji)}`,
      { method: 'DELETE' }, token),
  markConversationRead: (conversationId: string, token: string) =>
    request<{ lastReadAt: string }>(`/api/conversations/${conversationId}/read`, { method: 'POST' }, token),
  sendTyping: (conversationId: string, token: string) =>
    request<{ ok: true }>(`/api/conversations/${conversationId}/typing`, { method: 'POST' }, token),
  /** Upload photo : fetch dédié (FormData — pas de Content-Type JSON), pattern uploadMyAvatar. */
  uploadDmImage: async (conversationId: string, file: File, caption: string, token: string): Promise<DmMessage> => {
    const form = new FormData();
    form.append('image', file);
    if (caption) form.append('body', caption);
    const res = await fetch(`${BASE_URL}/api/conversations/${conversationId}/images`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.json() as Promise<DmMessage>;
  },
  blockUser: (userId: string, token: string) =>
    request<{ blocked: true }>(`/api/me/blocks/${userId}`, { method: 'POST' }, token),
  unblockUser: (userId: string, token: string) =>
    request<{ blocked: false }>(`/api/me/blocks/${userId}`, { method: 'DELETE' }, token),
  listBlockedUsers: (token: string) => request<DmUserInfo[]>('/api/me/blocks', {}, token),
```
URLs (en fin de fichier, près de `chatStreamUrl` ~l.2169) :
```typescript
export function conversationStreamUrl(conversationId: string, token: string): string {
  return `${BASE_URL}/api/conversations/${conversationId}/stream?token=${encodeURIComponent(token)}`;
}
export function dmImageUrl(conversationId: string, messageId: string, token: string): string {
  return `${BASE_URL}/api/conversations/${conversationId}/messages/${messageId}/image?token=${encodeURIComponent(token)}`;
}
```

- [ ] **Step 3 : Tests des helpers purs** (`frontend/__tests__/messages.test.ts`)

```typescript
import { inboxPreview, dayKey, dayLabel, isReadByOther, applyReactionToggle } from '@/lib/messages';
import { ConversationSummary, DmMessage } from '@/lib/api';

const NOW = new Date('2026-07-04T15:00:00');

const conv = (over: Partial<ConversationSummary['lastMessage']> & { mine?: boolean } = {}): ConversationSummary => ({
  id: 'c1', other: { userId: 'u2', firstName: 'Marie', lastName: 'D', avatarUrl: null },
  clubId: null, lastMessageAt: '2026-07-04T10:00:00Z', unreadCount: 0,
  lastMessage: { body: 'salut', hasImage: false, mine: false, deleted: false, ...over },
});

describe('inboxPreview', () => {
  it('message de l\'autre → texte brut', () => expect(inboxPreview(conv())).toBe('salut'));
  it('mon message → préfixe « Vous : »', () => expect(inboxPreview(conv({ mine: true }))).toBe('Vous : salut'));
  it('photo → 📷 Photo', () => expect(inboxPreview(conv({ body: '', hasImage: true }))).toBe('📷 Photo'));
  it('supprimé → message supprimé', () => expect(inboxPreview(conv({ deleted: true }))).toBe('message supprimé'));
  it('sans dernier message → chaîne vide', () => expect(inboxPreview({ ...conv(), lastMessage: null })).toBe(''));
});

describe('dayKey / dayLabel', () => {
  it('clé locale stable YYYY-MM-DD', () => expect(dayKey('2026-07-04T10:00:00Z')).toMatch(/^\d{4}-\d{2}-\d{2}$/));
  it('aujourd\'hui / hier / date longue', () => {
    expect(dayLabel('2026-07-04T08:00:00', NOW)).toBe("aujourd'hui");
    expect(dayLabel('2026-07-03T23:00:00', NOW)).toBe('hier');
    expect(dayLabel('2026-07-01T10:00:00', NOW)).toMatch(/1 juillet/);
  });
});

describe('isReadByOther', () => {
  it('lu ssi otherLastReadAt >= createdAt', () => {
    expect(isReadByOther('2026-07-04T10:00:00Z', '2026-07-04T11:00:00Z')).toBe(true);
    expect(isReadByOther('2026-07-04T10:00:00Z', '2026-07-04T09:00:00Z')).toBe(false);
    expect(isReadByOther('2026-07-04T10:00:00Z', null)).toBe(false);
  });
});

describe('applyReactionToggle (patch local optimiste)', () => {
  const msg: DmMessage = { id: 'm1', author: { userId: 'u2', firstName: 'M', lastName: 'D', avatarUrl: null },
    body: 'x', imageUrl: null, createdAt: '2026-07-04T10:00:00Z', deleted: false,
    reactions: [{ emoji: '👍', userIds: ['u2'] }] };
  it('ajoute ma réaction', () => {
    const r = applyReactionToggle(msg.reactions, '👍', 'u1');
    expect(r).toEqual([{ emoji: '👍', userIds: ['u2', 'u1'] }]);
  });
  it('retire ma réaction existante (toggle) et purge l\'emoji vide', () => {
    const r = applyReactionToggle([{ emoji: '👍', userIds: ['u1'] }], '👍', 'u1');
    expect(r).toEqual([]);
  });
});
```

- [ ] **Step 4 : Implémenter `frontend/lib/messages.ts`**

```typescript
import { ConversationSummary, DmReaction } from './api';

// Helpers PURS de la messagerie (testés) — aucun accès réseau/DOM ici, sauf openDm (event window).

/** Aperçu d'une conversation dans la boîte de réception. */
export function inboxPreview(c: ConversationSummary): string {
  const m = c.lastMessage;
  if (!m) return '';
  if (m.deleted) return 'message supprimé';
  const body = m.hasImage && !m.body ? '📷 Photo' : m.body;
  return m.mine ? `Vous : ${body}` : body;
}

/** Clé de jour LOCALE (groupage des messages par jour). */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** Libellé du séparateur de jour : « aujourd'hui », « hier », sinon « 4 juillet [2025] ». Pur (fonction de now). */
export function dayLabel(iso: string, now: Date): string {
  const key = dayKey(iso);
  if (key === dayKey(now.toISOString())) return "aujourd'hui";
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (key === dayKey(yesterday.toISOString())) return 'hier';
  const d = new Date(iso);
  const label = `${d.getDate()} ${MONTHS_FR[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? label : `${label} ${d.getFullYear()}`;
}

/** ✓✓ : mon message est lu ssi le curseur de lecture de l'autre a dépassé sa date. */
export function isReadByOther(createdAtIso: string, otherLastReadAtIso: string | null): boolean {
  if (!otherLastReadAtIso) return false;
  return otherLastReadAtIso >= createdAtIso ||
    new Date(otherLastReadAtIso).getTime() >= new Date(createdAtIso).getTime();
}

/** Patch local optimiste d'un toggle de réaction (réconcilié par la réponse serveur/SSE). */
export function applyReactionToggle(reactions: DmReaction[], emoji: string, meId: string): DmReaction[] {
  const existing = reactions.find((r) => r.emoji === emoji);
  const iReacted = !!existing?.userIds.includes(meId);
  return reactions
    .map((r) => r.emoji !== emoji ? r : { ...r, userIds: iReacted ? r.userIds.filter((u) => u !== meId) : [...r.userIds, meId] })
    .concat(existing ? [] : [{ emoji, userIds: [meId] }])
    .filter((r) => r.userIds.length > 0);
}

/** Ouvre une conversation : widget ancré en desktop (event window), page en mobile. */
export function openDm(userId: string, opts: { isDesktop: boolean; navigate: (href: string) => void }): void {
  if (opts.isDesktop) window.dispatchEvent(new CustomEvent('palova:open-dm', { detail: { userId } }));
  else opts.navigate(`/me/messages?with=${userId}`);
}
```

- [ ] **Step 5 : Vérifier puis committer**

`cd frontend; node node_modules/jest/bin/jest.js __tests__/messages.test.ts __tests__/OpenMatchChatSheet.test.tsx` → PASS.
`cd frontend; node node_modules/typescript/bin/tsc --noEmit` → 0 erreur (scoper le grep aux fichiers touchés si du WIP utilisateur casse d'autres fichiers).
```
git add frontend/lib/chatEmojis.ts frontend/lib/messages.ts frontend/lib/api.ts frontend/components/openmatch/OpenMatchChatSheet.tsx frontend/__tests__/messages.test.ts
git commit -m "feat(dm): api front messagerie + helpers purs + CHAT_EMOJIS partages"
```

---

### Task 10 : Front — `MessageComposer` + `MessageThread` (TDD)

**Files:**
- Create: `frontend/components/messages/MessageComposer.tsx`, `frontend/components/messages/MessageThread.tsx`
- Test: `frontend/__tests__/MessageThread.test.tsx`

- [ ] **Step 1 : Tests qui échouent** (pattern `OpenMatchChatSheet.test.tsx` : `FakeES` + api mockée)

```tsx
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MessageThread } from '@/components/messages/MessageThread';
import { ThemeProvider } from '@/lib/ThemeProvider';

let lastES: FakeES | null = null;
class FakeES {
  url: string; onmessage: ((e: { data: string }) => void) | null = null; onerror: (() => void) | null = null;
  constructor(url: string) { this.url = url; lastES = this; }
  close() {}
  emit(obj: unknown) { this.onmessage?.({ data: JSON.stringify(obj) }); }
}
(global as unknown as { EventSource: unknown }).EventSource = FakeES;

const MSG = (id: string, authorId: string, body: string, over = {}) => ({
  id, author: { userId: authorId, firstName: authorId === 'u1' ? 'Moi' : 'Marie', lastName: 'X', avatarUrl: null },
  body, imageUrl: null, createdAt: '2026-07-04T10:00:00Z', deleted: false, reactions: [], ...over,
});

jest.mock('@/lib/api', () => ({
  assetUrl: (p: string | null) => p,
  conversationStreamUrl: () => 'http://x/stream',
  dmImageUrl: (c: string, m: string) => `http://x/${c}/${m}/image`,
  api: {
    getDmMessages: jest.fn().mockResolvedValue({
      messages: [MSG('m1', 'u2', 'salut'), MSG('m2', 'u1', 'yo')],
      meta: { myLastReadAt: null, otherLastReadAt: '2026-07-04T11:00:00Z', blocked: false, hasMore: false },
    }),
    postDmMessage: jest.fn().mockResolvedValue(MSG('m3', 'u1', 'nouveau')),
    deleteDmMessage: jest.fn().mockResolvedValue(MSG('m2', 'u1', '', { deleted: true })),
    addDmReaction: jest.fn().mockResolvedValue([{ emoji: '👍', userIds: ['u1'] }]),
    removeDmReaction: jest.fn().mockResolvedValue([]),
    markConversationRead: jest.fn().mockResolvedValue({ lastReadAt: '2026-07-04T12:00:00Z' }),
    sendTyping: jest.fn().mockResolvedValue({ ok: true }),
    uploadDmImage: jest.fn().mockResolvedValue(MSG('m4', 'u1', '', { imageUrl: 'c1/x.jpg' })),
  },
}));
const apiMock = jest.requireMock('@/lib/api').api;

const renderThread = (over = {}) => render(
  <ThemeProvider>
    <MessageThread conversationId="c1" token="t" viewerUserId="u1"
      other={{ userId: 'u2', firstName: 'Marie', lastName: 'D', avatarUrl: null }} {...over} />
  </ThemeProvider>,
);

it('charge le fil, marque lu à l\'ouverture, affiche ✓✓ Lu sur mon dernier message lu', async () => {
  renderThread();
  expect(await screen.findByText('salut')).toBeInTheDocument();
  expect(apiMock.markConversationRead).toHaveBeenCalledWith('c1', 't');
  expect(screen.getByText(/✓✓/)).toBeInTheDocument(); // otherLastReadAt (11h) >= createdAt (10h)
});

it('envoie un message (optimiste : draft vidé, restauré sur échec)', async () => {
  renderThread();
  await screen.findByText('salut');
  const input = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: 'nouveau' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(apiMock.postDmMessage).toHaveBeenCalledWith('c1', 'nouveau', 't'));
  expect(input.value).toBe('');
});

it('reçoit dm_message en SSE → upsert + markRead ; dm_typing → « Marie écrit… »', async () => {
  renderThread();
  await screen.findByText('salut');
  act(() => lastES!.emit({ type: 'dm_message', message: MSG('m9', 'u2', 'coucou') }));
  expect(await screen.findByText('coucou')).toBeInTheDocument();
  act(() => lastES!.emit({ type: 'dm_typing', userId: 'u2' }));
  expect(await screen.findByText(/Marie écrit/)).toBeInTheDocument();
});

it('dm_read en SSE fait passer mes messages en ✓✓ sans recharger', async () => {
  apiMock.getDmMessages.mockResolvedValueOnce({
    messages: [MSG('m2', 'u1', 'yo')],
    meta: { myLastReadAt: null, otherLastReadAt: null, blocked: false, hasMore: false },
  });
  renderThread();
  await screen.findByText('yo');
  expect(screen.queryByText(/✓✓/)).toBeNull();
  act(() => lastES!.emit({ type: 'dm_read', userId: 'u2', lastReadAt: '2026-07-04T12:00:00Z' }));
  expect(await screen.findByText(/✓✓/)).toBeInTheDocument();
});

it('réaction : toggle 👍 via la barre rapide → addDmReaction, chip « 👍 1 » affichée', async () => {
  renderThread();
  await screen.findByText('salut');
  fireEvent.click(screen.getAllByRole('button', { name: /réagir/i })[0]);
  fireEvent.click(await screen.findByRole('button', { name: 'Réaction 👍' }));
  await waitFor(() => expect(apiMock.addDmReaction).toHaveBeenCalledWith('c1', 'm1', '👍', 't'));
});

it('conversation bloquée → composer désactivé avec message générique', async () => {
  apiMock.getDmMessages.mockResolvedValueOnce({
    messages: [], meta: { myLastReadAt: null, otherLastReadAt: null, blocked: true, hasMore: false },
  });
  renderThread();
  expect(await screen.findByText(/Vous ne pouvez pas échanger avec ce membre/)).toBeInTheDocument();
});

it('pagination : « Messages précédents » visible si hasMore, charge avec before=', async () => {
  apiMock.getDmMessages.mockResolvedValueOnce({
    messages: [MSG('m5', 'u2', 'récent')],
    meta: { myLastReadAt: null, otherLastReadAt: null, blocked: false, hasMore: true },
  });
  renderThread();
  await screen.findByText('récent');
  apiMock.getDmMessages.mockResolvedValueOnce({
    messages: [MSG('m4', 'u2', 'ancien')], meta: { myLastReadAt: null, otherLastReadAt: null, blocked: false, hasMore: false },
  });
  fireEvent.click(screen.getByRole('button', { name: /précédents/i }));
  await waitFor(() => expect(apiMock.getDmMessages).toHaveBeenCalledWith('c1', 't', 'm5'));
  expect(await screen.findByText('ancien')).toBeInTheDocument();
});
```

- [ ] **Step 2 : Vérifier l'échec** — modules inexistants.

- [ ] **Step 3 : `MessageComposer`** (`frontend/components/messages/MessageComposer.tsx`)

```tsx
'use client';
import { useRef, useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { CHAT_EMOJIS } from '@/lib/chatEmojis';

// Composer de message privé : textarea auto-grow, Entrée = envoyer (Maj+Entrée = saut de
// ligne), 🙂 emojis, 📷 photo avec préview. Throttle « typing » 3 s (fire-and-forget).
export function MessageComposer({ disabled, onSend, onSendImage, onTyping }: {
  disabled?: boolean;
  onSend: (body: string) => Promise<boolean>; // false = échec → draft restauré
  onSendImage: (file: File, caption: string) => Promise<boolean>;
  onTyping: () => void;
}) {
  const { th } = useTheme();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const lastTypingRef = useRef(0);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const throttledTyping = () => {
    const now = Date.now();
    if (now - lastTypingRef.current > 3000) { lastTypingRef.current = now; onTyping(); }
  };

  const send = async () => {
    if (sending || disabled) return;
    const body = draft.trim();
    if (pendingImage) {
      const file = pendingImage;
      setSending(true); setPendingImage(null); setDraft('');
      const ok = await onSendImage(file, body);
      if (!ok) { setPendingImage(file); setDraft(body); }
      setSending(false);
      return;
    }
    if (!body) return;
    setSending(true); setDraft('');
    const ok = await onSend(body);
    if (!ok) setDraft(body);
    setSending(false);
  };

  return (
    <div style={{ position: 'relative', borderTop: `1px solid ${th.line}` }}>
      {emojiOpen && (
        <div role="menu" aria-label="Choisir un emoji"
          style={{ position: 'absolute', bottom: '100%', left: 12, right: 12, marginBottom: 8, background: th.surface,
            boxShadow: `inset 0 0 0 1px ${th.line}, 0 8px 24px rgba(0,0,0,0.18)`, borderRadius: 12, padding: 8,
            display: 'flex', flexWrap: 'wrap', gap: 2, maxHeight: 180, overflowY: 'auto' }}>
          {CHAT_EMOJIS.map((e) => (
            <button key={e} type="button" aria-label={`Emoji ${e}`} onClick={() => setDraft((d) => (d + e).slice(0, 2000))}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 22, lineHeight: 1, padding: 6, borderRadius: 8 }}>
              {e}
            </button>
          ))}
        </div>
      )}
      {pendingImage && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px 0' }}>
          {/* préview avant envoi */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={URL.createObjectURL(pendingImage)} alt="Aperçu de la photo"
            style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 10, border: `1px solid ${th.line}` }} />
          <button type="button" aria-label="Retirer la photo" onClick={() => setPendingImage(null)}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textMute, fontSize: 18 }}>×</button>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, padding: '10px 16px', paddingBottom: 'max(10px, env(safe-area-inset-bottom))', alignItems: 'flex-end' }}>
        <button type="button" aria-label="Emojis" aria-expanded={emojiOpen} disabled={disabled} onClick={() => setEmojiOpen((o) => !o)}
          style={{ border: `1px solid ${th.line}`, borderRadius: 12, background: emojiOpen ? th.surface : 'transparent', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '9px 12px', color: th.text, opacity: disabled ? 0.5 : 1 }}>
          🙂
        </button>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden aria-label="Choisir une photo"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) setPendingImage(f); e.target.value = ''; }} />
        <button type="button" aria-label="Envoyer une photo" disabled={disabled} onClick={() => fileRef.current?.click()}
          style={{ border: `1px solid ${th.line}`, borderRadius: 12, background: 'transparent', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '10px 12px', color: th.text, opacity: disabled ? 0.5 : 1 }}>
          📷
        </button>
        <textarea value={draft} rows={1} disabled={disabled}
          onChange={(e) => { setDraft(e.target.value.slice(0, 2000)); throttledTyping(); }}
          onFocus={() => setEmojiOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setEmojiOpen(false);
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          placeholder="Votre message…"
          style={{ flex: 1, minWidth: 0, resize: 'none', border: `1px solid ${th.line}`, borderRadius: 12, padding: '10px 12px',
            fontFamily: th.fontUI, fontSize: 14, background: th.surface, color: th.text, maxHeight: 120, opacity: disabled ? 0.5 : 1 }} />
        <button type="button" aria-label="Envoyer" onClick={send}
          disabled={disabled || sending || (!draft.trim() && !pendingImage)}
          style={{ border: 'none', borderRadius: 12, padding: '10px 16px', background: th.accent, color: th.onAccent,
            fontFamily: th.fontUI, fontWeight: 700,
            cursor: disabled || sending || (!draft.trim() && !pendingImage) ? 'default' : 'pointer',
            opacity: disabled || sending || (!draft.trim() && !pendingImage) ? 0.5 : 1 }}>
          Envoyer
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4 : `MessageThread`** (`frontend/components/messages/MessageThread.tsx`)

```tsx
'use client';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { api, conversationStreamUrl, dmImageUrl, DmMessage, DmMeta, DmUserInfo, DmReaction } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Avatar } from '@/components/ui/Avatar';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { colorForSeed } from '@/lib/playerColors';
import { QUICK_REACTIONS } from '@/lib/chatEmojis';
import { dayKey, dayLabel, isReadByOther, applyReactionToggle } from '@/lib/messages';
import { MessageComposer } from './MessageComposer';

const TYPING_TTL = 5000;

function hhmm(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso)).replace(':', 'h');
}

// Fil d'une conversation privée : bulles groupées par jour, envoi optimiste, réactions,
// ✓/✓✓ Lu, « X écrit… », pierre tombale, pagination par curseur, photos.
// Le parent (hub ou widget) rend l'en-tête ; onMeta lui remonte { blocked } pour le menu.
export function MessageThread({ conversationId, token, viewerUserId, other, onMeta, onUnreadCleared }: {
  conversationId: string;
  token: string;
  viewerUserId: string;
  other: DmUserInfo;
  onMeta?: (meta: DmMeta) => void;
  onUnreadCleared?: () => void;
}) {
  const { th } = useTheme();
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [meta, setMeta] = useState<DmMeta | null>(null);
  const [now, setNow] = useState<Date | null>(null); // horloge posée en effet — jamais new Date() au rendu
  const [typingUntil, setTypingUntil] = useState(0);
  const [reactFor, setReactFor] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DmMessage | null>(null);
  const [lightbox, setLightbox] = useState<DmMessage | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { setNow(new Date()); }, []);

  const upsert = useCallback((m: DmMessage) => {
    setMessages((prev) => {
      const i = prev.findIndex((x) => x.id === m.id);
      if (i === -1) return [...prev, m];
      const next = prev.slice(); next[i] = m; return next;
    });
  }, []);

  const markRead = useCallback(() => {
    api.markConversationRead(conversationId, token)
      .then(() => { window.dispatchEvent(new Event('palova:dm-unread')); onUnreadCleared?.(); })
      .catch(() => {});
  }, [conversationId, token, onUnreadCleared]);

  useEffect(() => {
    let alive = true;
    api.getDmMessages(conversationId, token).then((r) => {
      if (!alive) return;
      setMessages(r.messages); setMeta(r.meta); onMeta?.(r.meta);
    }).catch(() => {});
    markRead();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, token]);

  useEffect(() => {
    const es = new EventSource(conversationStreamUrl(conversationId, token));
    es.onmessage = (e: MessageEvent) => {
      try {
        const evt = JSON.parse(e.data) as { type: string; message?: DmMessage; messageId?: string; reactions?: DmReaction[]; userId?: string; lastReadAt?: string };
        if ((evt.type === 'dm_message' || evt.type === 'dm_deleted') && evt.message) {
          upsert(evt.message);
          if (evt.type === 'dm_message' && evt.message.author.userId !== viewerUserId) { setTypingUntil(0); markRead(); }
        } else if (evt.type === 'dm_reaction' && evt.messageId) {
          setMessages((prev) => prev.map((m) => m.id === evt.messageId ? { ...m, reactions: evt.reactions ?? [] } : m));
        } else if (evt.type === 'dm_read' && evt.userId !== viewerUserId && evt.lastReadAt) {
          setMeta((prev) => prev ? { ...prev, otherLastReadAt: evt.lastReadAt! } : prev);
        } else if (evt.type === 'dm_typing' && evt.userId !== viewerUserId) {
          setTypingUntil(Date.now() + TYPING_TTL);
        }
      } catch { /* ignore */ }
    };
    es.onerror = () => { /* EventSource reconnecte tout seul */ };
    return () => es.close();
  }, [conversationId, token, viewerUserId, upsert, markRead]);

  // L'indicateur « écrit… » expire tout seul.
  useEffect(() => {
    if (!typingUntil) return;
    const t = setTimeout(() => setTypingUntil(0), Math.max(0, typingUntil - Date.now()));
    return () => clearTimeout(t);
  }, [typingUntil]);

  useEffect(() => { listRef.current?.scrollTo?.({ top: listRef.current.scrollHeight }); }, [messages, typingUntil]);

  const send = async (body: string) => {
    try { upsert(await api.postDmMessage(conversationId, body, token)); return true; }
    catch { return false; }
  };
  const sendImage = async (file: File, caption: string) => {
    try { upsert(await api.uploadDmImage(conversationId, file, caption, token)); return true; }
    catch { return false; }
  };
  const typing = () => { api.sendTyping(conversationId, token).catch(() => {}); };

  const toggleReaction = async (m: DmMessage, emoji: string) => {
    setReactFor(null);
    const iReacted = !!m.reactions.find((r) => r.emoji === emoji)?.userIds.includes(viewerUserId);
    // patch optimiste, réconcilié par la réponse (et par le broadcast SSE)
    setMessages((prev) => prev.map((x) => x.id === m.id ? { ...x, reactions: applyReactionToggle(x.reactions, emoji, viewerUserId) } : x));
    try {
      const reactions = iReacted
        ? await api.removeDmReaction(conversationId, m.id, emoji, token)
        : await api.addDmReaction(conversationId, m.id, emoji, token);
      setMessages((prev) => prev.map((x) => x.id === m.id ? { ...x, reactions } : x));
    } catch { /* le prochain broadcast resynchronisera */ }
  };

  const doDelete = async (m: DmMessage) => {
    try { upsert(await api.deleteDmMessage(conversationId, m.id, token)); }
    catch { /* best-effort */ }
    finally { setPendingDelete(null); }
  };

  const loadMore = async () => {
    if (loadingMore || !messages.length) return;
    setLoadingMore(true);
    try {
      const r = await api.getDmMessages(conversationId, token, messages[0].id);
      setMessages((prev) => [...r.messages, ...prev]);
      setMeta((prev) => prev ? { ...prev, hasMore: r.meta.hasMore } : r.meta);
    } catch { /* noop */ }
    finally { setLoadingMore(false); }
  };

  // Dernier de MES messages : seul porteur du ✓/✓✓ (pattern messenger).
  const lastMineId = [...messages].reverse().find((m) => m.author.userId === viewerUserId && !m.deleted)?.id;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div ref={listRef} style={{ overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
        {meta?.hasMore && (
          <button type="button" onClick={loadMore} disabled={loadingMore}
            style={{ alignSelf: 'center', border: `1px solid ${th.line}`, background: th.surface, color: th.textMute,
              borderRadius: 999, padding: '5px 14px', fontFamily: th.fontUI, fontSize: 12.5, cursor: 'pointer' }}>
            {loadingMore ? 'Chargement…' : 'Messages précédents'}
          </button>
        )}
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: th.textFaint, fontFamily: th.fontUI, fontSize: 13.5, padding: '24px 0' }}>
            Aucun message. Écrivez le premier !
          </div>
        )}
        {messages.map((m, i) => {
          const mine = m.author.userId === viewerUserId;
          const newDay = i === 0 || dayKey(m.createdAt) !== dayKey(messages[i - 1].createdAt);
          return (
            <Fragment key={m.id}>
              {newDay && now && (
                <div style={{ alignSelf: 'center', fontFamily: th.fontUI, fontSize: 11.5, color: th.textFaint,
                  background: th.surface, borderRadius: 999, padding: '2px 10px' }}>
                  {dayLabel(m.createdAt, now)}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, flexDirection: mine ? 'row-reverse' : 'row', alignItems: 'flex-end' }}>
                <Avatar firstName={m.author.firstName} lastName={m.author.lastName} avatarUrl={m.author.avatarUrl}
                  size={28} color={colorForSeed(m.author.userId)} />
                <div style={{ maxWidth: '72%', position: 'relative' }}>
                  <div style={{ fontFamily: th.fontUI, fontSize: 11.5, color: th.textFaint, marginBottom: 2, textAlign: mine ? 'right' : 'left' }}>
                    {hhmm(m.createdAt)}
                  </div>
                  <div style={{ background: mine ? th.accent : th.surface, color: mine ? th.onAccent : th.text,
                    borderRadius: 14, padding: '8px 12px', fontFamily: th.fontUI, fontSize: 14,
                    fontStyle: m.deleted ? 'italic' : 'normal', opacity: m.deleted ? 0.6 : 1 }}>
                    {m.deleted ? 'message supprimé' : (
                      <>
                        {m.imageUrl && (
                          <button type="button" aria-label="Agrandir la photo" onClick={() => setLightbox(m)}
                            style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', display: 'block' }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={dmImageUrl(conversationId, m.id, token)} alt="Photo"
                              style={{ maxWidth: '100%', maxHeight: 220, borderRadius: 10, display: 'block' }} />
                          </button>
                        )}
                        {m.body}
                      </>
                    )}
                  </div>
                  {m.reactions.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, marginTop: 3, justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                      {m.reactions.map((r) => (
                        <button key={r.emoji} type="button" aria-label={`Réaction ${r.emoji} (${r.userIds.length})`}
                          onClick={() => toggleReaction(m, r.emoji)}
                          style={{ border: `1px solid ${r.userIds.includes(viewerUserId) ? th.accent : th.line}`,
                            background: th.surface, borderRadius: 999, padding: '1px 7px', cursor: 'pointer',
                            fontFamily: th.fontUI, fontSize: 12 }}>
                          {r.emoji} {r.userIds.length}
                        </button>
                      ))}
                    </div>
                  )}
                  {!m.deleted && (
                    <div style={{ display: 'flex', gap: 8, justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                      <button type="button" aria-label={`Réagir au message de ${m.author.firstName}`}
                        onClick={() => setReactFor(reactFor === m.id ? null : m.id)}
                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textFaint,
                          fontFamily: th.fontUI, fontSize: 11.5, padding: 0, marginTop: 2 }}>
                        Réagir
                      </button>
                      {mine && (
                        <button type="button" onClick={() => setPendingDelete(m)}
                          style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textFaint,
                            fontFamily: th.fontUI, fontSize: 11.5, padding: 0, marginTop: 2 }}>
                          Supprimer
                        </button>
                      )}
                    </div>
                  )}
                  {reactFor === m.id && (
                    <div role="menu" aria-label="Réactions rapides"
                      style={{ position: 'absolute', zIndex: 5, bottom: '100%', [mine ? 'right' : 'left']: 0, marginBottom: 4,
                        background: th.bg, boxShadow: `inset 0 0 0 1px ${th.line}, 0 8px 24px rgba(0,0,0,0.18)`,
                        borderRadius: 999, padding: '4px 8px', display: 'flex', gap: 4 }}>
                      {QUICK_REACTIONS.map((e) => (
                        <button key={e} type="button" aria-label={`Réaction ${e}`} onClick={() => toggleReaction(m, e)}
                          style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 4 }}>
                          {e}
                        </button>
                      ))}
                    </div>
                  )}
                  {mine && m.id === lastMineId && (
                    <div style={{ textAlign: 'right', fontFamily: th.fontUI, fontSize: 11, marginTop: 2,
                      color: isReadByOther(m.createdAt, meta?.otherLastReadAt ?? null) ? th.accent : th.textFaint }}>
                      {isReadByOther(m.createdAt, meta?.otherLastReadAt ?? null) ? '✓✓ Lu' : '✓ Envoyé'}
                    </div>
                  )}
                </div>
              </div>
            </Fragment>
          );
        })}
        {typingUntil > 0 && (
          <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textFaint, fontStyle: 'italic' }}>
            {other.firstName} écrit…
          </div>
        )}
      </div>

      {meta?.blocked ? (
        <div style={{ borderTop: `1px solid ${th.line}`, padding: '14px 16px', fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, textAlign: 'center' }}>
          Vous ne pouvez pas échanger avec ce membre.
        </div>
      ) : (
        <MessageComposer onSend={send} onSendImage={sendImage} onTyping={typing} />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Supprimer le message"
          message="Ce message sera retiré de la conversation."
          confirmLabel="Supprimer" cancelLabel="Annuler"
          onConfirm={() => doDelete(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
      {lightbox && (
        <div role="dialog" aria-label="Photo" onClick={() => setLightbox(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, cursor: 'zoom-out' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={dmImageUrl(conversationId, lightbox.id, token)} alt="Photo"
            style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 12 }} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5 : Vérifier puis committer**

`cd frontend; node node_modules/jest/bin/jest.js __tests__/MessageThread.test.tsx` → PASS.
```
git add frontend/components/messages/MessageComposer.tsx frontend/components/messages/MessageThread.tsx frontend/__tests__/MessageThread.test.tsx
git commit -m "feat(dm): fil de conversation (optimiste, reactions, lu/non-lu, frappe, photos) + composer"
```

---

### Task 11 : Front — `ConversationList` + `MessagesHub` + page `/me/messages` (TDD)

**Files:**
- Create: `frontend/components/messages/ConversationList.tsx`, `frontend/components/messages/MessagesHub.tsx`, `frontend/app/me/messages/page.tsx`
- Test: `frontend/__tests__/MessagesHub.test.tsx`

- [ ] **Step 1 : Tests qui échouent**

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MessagesHub } from '@/components/messages/MessagesHub';
import { ThemeProvider } from '@/lib/ThemeProvider';

class FakeES { onmessage: unknown = null; onerror: unknown = null; close() {} }
(global as unknown as { EventSource: unknown }).EventSource = FakeES;

const CONV = {
  id: 'c1', other: { userId: 'u2', firstName: 'Marie', lastName: 'Dupont', avatarUrl: null },
  clubId: 'club-demo', lastMessageAt: '2026-07-04T10:00:00Z', unreadCount: 2,
  lastMessage: { body: 'on joue ?', hasImage: false, mine: false, deleted: false },
};

jest.mock('@/lib/api', () => ({
  assetUrl: (p: string | null) => p,
  conversationStreamUrl: () => 'http://x/stream',
  notificationsStreamUrl: () => 'http://x/notif',
  dmImageUrl: () => 'http://x/img',
  api: {
    listConversations: jest.fn().mockResolvedValue([CONV]),
    openConversation: jest.fn().mockResolvedValue(CONV),
    getDmMessages: jest.fn().mockResolvedValue({ messages: [], meta: { myLastReadAt: null, otherLastReadAt: null, blocked: false, hasMore: false } }),
    markConversationRead: jest.fn().mockResolvedValue({ lastReadAt: 'x' }),
    listBlockedUsers: jest.fn().mockResolvedValue([]),
    blockUser: jest.fn().mockResolvedValue({ blocked: true }),
    unblockUser: jest.fn().mockResolvedValue({ blocked: false }),
    postDmMessage: jest.fn(), uploadDmImage: jest.fn(), sendTyping: jest.fn().mockResolvedValue({ ok: true }),
    addDmReaction: jest.fn(), removeDmReaction: jest.fn(), deleteDmMessage: jest.fn(),
  },
}));
const apiMock = jest.requireMock('@/lib/api').api;

// jsdom = mobile par défaut (matchMedia stubé) → parcours liste → fil.
const renderHub = (over = {}) => render(
  <ThemeProvider><MessagesHub token="t" viewerUserId="u1" clubSlug="demo" {...over} /></ThemeProvider>,
);

it('liste les conversations avec aperçu et badge de non-lus', async () => {
  renderHub();
  expect(await screen.findByText('Marie Dupont')).toBeInTheDocument();
  expect(screen.getByText('on joue ?')).toBeInTheDocument();
  expect(screen.getByText('2')).toBeInTheDocument();
});

it('tap sur une conversation → ouvre le fil (mobile) puis retour', async () => {
  renderHub();
  fireEvent.click(await screen.findByText('Marie Dupont'));
  await waitFor(() => expect(apiMock.getDmMessages).toHaveBeenCalledWith('c1', 't'));
  fireEvent.click(screen.getByRole('button', { name: /retour/i }));
  expect(await screen.findByText('on joue ?')).toBeInTheDocument();
});

it('deeplink initialWith → openConversation puis fil ouvert', async () => {
  renderHub({ initialWith: 'u2' });
  await waitFor(() => expect(apiMock.openConversation).toHaveBeenCalledWith('u2', 't', 'demo'));
  await waitFor(() => expect(apiMock.getDmMessages).toHaveBeenCalled());
});

it('menu ⋮ de l\'en-tête du fil : « Bloquer ce membre » → blockUser après confirmation', async () => {
  renderHub();
  fireEvent.click(await screen.findByText('Marie Dupont'));
  await waitFor(() => expect(apiMock.getDmMessages).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: /options de la conversation/i }));
  fireEvent.click(await screen.findByRole('menuitem', { name: /bloquer/i }));
  fireEvent.click(await screen.findByRole('button', { name: /^bloquer$/i })); // ConfirmDialog
  await waitFor(() => expect(apiMock.blockUser).toHaveBeenCalledWith('u2', 't'));
});

it('« Membres bloqués » liste et débloque', async () => {
  apiMock.listBlockedUsers.mockResolvedValue([{ userId: 'u9', firstName: 'Paul', lastName: 'R', avatarUrl: null }]);
  renderHub();
  await screen.findByText('Marie Dupont');
  fireEvent.click(screen.getByRole('button', { name: /membres bloqués/i }));
  expect(await screen.findByText('Paul R')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /débloquer/i }));
  await waitFor(() => expect(apiMock.unblockUser).toHaveBeenCalledWith('u9', 't'));
});
```

- [ ] **Step 2 : Vérifier l'échec.**

- [ ] **Step 3 : `ConversationList`** (`frontend/components/messages/ConversationList.tsx`)

```tsx
'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';
import { ConversationSummary } from '@/lib/api';
import { inboxPreview } from '@/lib/messages';
import { relativeTime } from '@/lib/notifications';

// Boîte de réception : avatar coloré, aperçu, heure relative, badge non-lus.
// `now` posé par le parent en effet (hydration-safe) ; null au 1er rendu → pas d'heure.
export function ConversationList({ conversations, selectedId, now, onSelect }: {
  conversations: ConversationSummary[];
  selectedId: string | null;
  now: Date | null;
  onSelect: (c: ConversationSummary) => void;
}) {
  const { th } = useTheme();
  if (conversations.length === 0) {
    return (
      <div style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, padding: '24px 16px', textAlign: 'center' }}>
        Aucune conversation. Écrivez à un membre depuis « Mes amis », une partie ou l'annuaire.
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {conversations.map((c) => (
        <button key={c.id} type="button" onClick={() => onSelect(c)}
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', textAlign: 'left',
            border: 'none', cursor: 'pointer', borderBottom: `1px solid ${th.line}`,
            background: selectedId === c.id ? th.surface : 'transparent',
            borderLeft: selectedId === c.id ? `3px solid ${th.accent}` : '3px solid transparent' }}>
          <Avatar firstName={c.other.firstName} lastName={c.other.lastName} avatarUrl={c.other.avatarUrl}
            size={38} color={colorForSeed(c.other.userId)} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontFamily: th.fontUI, fontWeight: c.unreadCount > 0 ? 700 : 600, fontSize: 14.5, color: th.text }}>
                {c.other.firstName} {c.other.lastName}
              </span>
              {now && c.lastMessageAt && (
                <span style={{ fontFamily: th.fontUI, fontSize: 11.5, color: th.textFaint, whiteSpace: 'nowrap' }}>
                  {relativeTime(c.lastMessageAt, now)}
                </span>
              )}
            </span>
            <span style={{ display: 'block', fontFamily: th.fontUI, fontSize: 13, marginTop: 1,
              color: c.unreadCount > 0 ? th.text : th.textMute, fontWeight: c.unreadCount > 0 ? 600 : 400,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {inboxPreview(c)}
            </span>
          </span>
          {c.unreadCount > 0 && (
            <span style={{ background: '#e5484d', color: '#fff', borderRadius: 999, minWidth: 20, height: 20,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, padding: '0 6px' }}>
              {c.unreadCount > 99 ? '99+' : c.unreadCount}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4 : `MessagesHub`** (`frontend/components/messages/MessagesHub.tsx`)

```tsx
'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, notificationsStreamUrl, ConversationSummary, DmMeta, DmUserInfo } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { Avatar } from '@/components/ui/Avatar';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { colorForSeed } from '@/lib/playerColors';
import { ConversationList } from './ConversationList';
import { MessageThread } from './MessageThread';

// QG de la messagerie (/me/messages) : split view desktop (liste ~320px + fil),
// liste → fil plein écran en mobile. Deeplink initialWith = get-or-create + ouverture.
export function MessagesHub({ token, viewerUserId, clubSlug, initialWith }: {
  token: string;
  viewerUserId: string;
  clubSlug: string | null;
  initialWith?: string | null;
}) {
  const { th } = useTheme();
  const isDesktop = useIsDesktop(900);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selected, setSelected] = useState<ConversationSummary | null>(null);
  const [meta, setMeta] = useState<DmMeta | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [blockTarget, setBlockTarget] = useState<DmUserInfo | null>(null);
  const [blockedOpen, setBlockedOpen] = useState(false);
  const [blocked, setBlocked] = useState<DmUserInfo[]>([]);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => { setNow(new Date()); }, []);

  const reload = useCallback(() => {
    api.listConversations(token).then((rows) => {
      setConversations(rows);
      // re-dérive la sélection par id stable après reload
      setSelected((prev) => prev ? rows.find((c) => c.id === prev.id) ?? prev : prev);
    }).catch(() => {});
  }, [token]);
  useEffect(() => { reload(); }, [reload]);

  // Live : nouveau message ailleurs → cloche SSE ; lecture locale → event window.
  useEffect(() => {
    const es = new EventSource(notificationsStreamUrl(token));
    es.onmessage = (e: MessageEvent) => {
      try { if ((JSON.parse(e.data) as { type: string }).type === 'notification') reload(); } catch { /* ignore */ }
    };
    es.onerror = () => {};
    const onLocal = () => reload();
    window.addEventListener('palova:dm-unread', onLocal);
    return () => { es.close(); window.removeEventListener('palova:dm-unread', onLocal); };
  }, [token, reload]);

  // Deeplink ?with= : get-or-create puis ouverture.
  useEffect(() => {
    if (!initialWith) return;
    api.openConversation(initialWith, token, clubSlug)
      .then((c) => { setSelected(c); reload(); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialWith, token, clubSlug]);

  const doBlock = async (u: DmUserInfo) => {
    try { await api.blockUser(u.userId, token); setMeta((m) => m ? { ...m, blocked: true } : m); }
    catch { /* noop */ }
    finally { setBlockTarget(null); setMenuOpen(false); }
  };
  const openBlocked = async () => {
    setBlockedOpen(true);
    try { setBlocked(await api.listBlockedUsers(token)); } catch { setBlocked([]); }
  };
  const unblock = async (u: DmUserInfo) => {
    try { await api.unblockUser(u.userId, token); setBlocked((prev) => prev.filter((x) => x.userId !== u.userId)); }
    catch { /* noop */ }
  };

  const threadHeader = selected && (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: `1px solid ${th.line}` }}>
      {!isDesktop && (
        <button type="button" aria-label="Retour" onClick={() => setSelected(null)}
          style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.text, fontSize: 18, padding: 4 }}>←</button>
      )}
      <Avatar firstName={selected.other.firstName} lastName={selected.other.lastName}
        avatarUrl={selected.other.avatarUrl} size={30} color={colorForSeed(selected.other.userId)} />
      <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 15, color: th.text, flex: 1 }}>
        {selected.other.firstName} {selected.other.lastName}
      </span>
      <div style={{ position: 'relative' }}>
        <button type="button" aria-label="Options de la conversation" aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
          style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textMute, fontSize: 18, padding: 4 }}>⋮</button>
        {menuOpen && (
          <div role="menu" style={{ position: 'absolute', right: 0, top: '100%', zIndex: 10, background: th.bg,
            boxShadow: `inset 0 0 0 1px ${th.line}, 0 8px 24px rgba(0,0,0,0.18)`, borderRadius: 12, padding: 6, minWidth: 200 }}>
            <button role="menuitem" type="button"
              onClick={() => (meta?.blocked ? (api.unblockUser(selected.other.userId, token).then(() => setMeta((m) => m ? { ...m, blocked: false } : m)), setMenuOpen(false)) : setBlockTarget(selected.other))}
              style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'transparent',
                cursor: 'pointer', padding: '9px 12px', fontFamily: th.fontUI, fontSize: 14, color: th.text }}>
              {meta?.blocked ? 'Débloquer ce membre' : 'Bloquer ce membre'}
            </button>
          </div>
        )}
      </div>
    </div>
  );

  const thread = selected && (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {threadHeader}
      <MessageThread conversationId={selected.id} token={token} viewerUserId={viewerUserId}
        other={selected.other} onMeta={setMeta} onUnreadCleared={reload} />
    </div>
  );

  const list = (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderBottom: `1px solid ${th.line}` }}>
        <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 15, color: th.text }}>Conversations</span>
        <button type="button" aria-label="Membres bloqués" title="Membres bloqués" onClick={openBlocked}
          style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textMute, fontFamily: th.fontUI, fontSize: 12.5 }}>
          Bloqués
        </button>
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        <ConversationList conversations={conversations} selectedId={selected?.id ?? null} now={now} onSelect={setSelected} />
      </div>
    </div>
  );

  return (
    <div style={{ border: `1px solid ${th.line}`, borderRadius: 16, background: th.bg, overflow: 'hidden',
      display: 'flex', height: 'min(680px, calc(100vh - 220px))', minHeight: 380 }}>
      {isDesktop ? (
        <>
          <div style={{ width: 320, borderRight: `1px solid ${th.line}`, display: 'flex', flexDirection: 'column', minHeight: 0 }}>{list}</div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {thread ?? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: th.fontUI, fontSize: 14, color: th.textFaint }}>
                Sélectionnez une conversation
              </div>
            )}
          </div>
        </>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>{selected ? thread : list}</div>
      )}

      {blockTarget && (
        <ConfirmDialog
          title="Bloquer ce membre"
          message={`${blockTarget.firstName} ${blockTarget.lastName} ne pourra plus vous écrire (et vous non plus). Vous pourrez le débloquer à tout moment.`}
          confirmLabel="Bloquer" cancelLabel="Annuler"
          onConfirm={() => doBlock(blockTarget)}
          onCancel={() => setBlockTarget(null)}
        />
      )}
      {blockedOpen && (
        <div role="dialog" aria-label="Membres bloqués" onClick={() => setBlockedOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ width: 360, maxWidth: '100%', background: th.bg, border: `1px solid ${th.line}`, borderRadius: 16, padding: 16 }}>
            <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 15, color: th.text, marginBottom: 10 }}>Membres bloqués</div>
            {blocked.length === 0
              ? <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute }}>Personne n'est bloqué.</div>
              : blocked.map((u) => (
                <div key={u.userId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${th.line}` }}>
                  <Avatar firstName={u.firstName} lastName={u.lastName} avatarUrl={u.avatarUrl} size={30} color={colorForSeed(u.userId)} />
                  <span style={{ flex: 1, fontFamily: th.fontUI, fontSize: 14, color: th.text }}>{u.firstName} {u.lastName}</span>
                  <button type="button" onClick={() => unblock(u)}
                    style={{ border: `1px solid ${th.accent}`, background: 'transparent', color: th.accent, borderRadius: 999,
                      padding: '4px 10px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                    Débloquer
                  </button>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5 : Page** (`frontend/app/me/messages/page.tsx`, shell calqué sur `app/me/friends/page.tsx`)

```tsx
'use client';
import { useSearchParams } from 'next/navigation';
import { useTheme } from '@/lib/ThemeProvider';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { Screen } from '@/components/ui/Screen';
import { ClubNav } from '@/components/ClubNav';
import { MessagesHub } from '@/components/messages/MessagesHub';

// Messagerie privée du joueur. Disponible sur un hôte club (comme /me/friends).
// ?with=<userId> = deeplink d'ouverture/création d'une conversation.
export default function MessagesPage() {
  const { th } = useTheme();
  const { token, user, ready } = useAuth();
  const { slug, club } = useClub();
  const initialWith = useSearchParams().get('with');

  if (!ready) return null;
  if (!token || !slug || !club || !user) return null;

  return (
    <Screen>
      <div style={{ paddingBottom: 48 }}>
        <ClubNav club={club} />
        <div style={{ padding: '18px 20px 0', fontFamily: th.fontDisplay, fontWeight: 500, fontSize: 38, lineHeight: 1.05, color: th.text, letterSpacing: -0.5 }}>
          Messages
        </div>
        <div style={{ padding: '18px 20px 0' }}>
          <MessagesHub token={token} viewerUserId={user.id} clubSlug={slug} initialWith={initialWith} />
        </div>
      </div>
    </Screen>
  );
}
```
⚠️ Vérifier la forme exacte de `useAuth` (si `user.id` n'y est pas, réutiliser le pattern de `/me/friends` + `getMyProfile` pour l'id viewer — même approche que `OpenMatches`).

- [ ] **Step 6 : Vérifier puis committer**

`cd frontend; node node_modules/jest/bin/jest.js __tests__/MessagesHub.test.tsx` → PASS.
```
git add frontend/components/messages/ConversationList.tsx frontend/components/messages/MessagesHub.tsx frontend/app/me/messages/page.tsx frontend/__tests__/MessagesHub.test.tsx
git commit -m "feat(dm): boite de reception + hub /me/messages (split desktop, liste->fil mobile, blocage)"
```

---

### Task 12 : Front — `DmWidgetHost` (widget desktop) + montage racine (TDD)

**Files:**
- Create: `frontend/components/messages/DmWidgetHost.tsx`
- Modify: `frontend/app/layout.tsx`
- Test: `frontend/__tests__/DmWidgetHost.test.tsx`

- [ ] **Step 1 : Tests qui échouent**

```tsx
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { DmWidgetHost } from '@/components/messages/DmWidgetHost';
import { ThemeProvider } from '@/lib/ThemeProvider';

class FakeES { onmessage: unknown = null; onerror: unknown = null; close() {} }
(global as unknown as { EventSource: unknown }).EventSource = FakeES;

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const CONV = {
  id: 'c1', other: { userId: 'u2', firstName: 'Marie', lastName: 'D', avatarUrl: null },
  clubId: null, lastMessageAt: null, unreadCount: 0, lastMessage: null,
};
jest.mock('@/lib/api', () => ({
  assetUrl: (p: string | null) => p,
  conversationStreamUrl: () => 'http://x/stream',
  dmImageUrl: () => 'http://x/img',
  api: {
    openConversation: jest.fn().mockResolvedValue(CONV),
    getDmMessages: jest.fn().mockResolvedValue({ messages: [], meta: { myLastReadAt: null, otherLastReadAt: null, blocked: false, hasMore: false } }),
    markConversationRead: jest.fn().mockResolvedValue({ lastReadAt: 'x' }),
    postDmMessage: jest.fn(), uploadDmImage: jest.fn(), sendTyping: jest.fn().mockResolvedValue({ ok: true }),
    addDmReaction: jest.fn(), removeDmReaction: jest.fn(), deleteDmMessage: jest.fn(),
  },
}));
const apiMock = jest.requireMock('@/lib/api').api;

// useAuth mocké : connecté. useClub mocké : hôte plateforme (slug null).
jest.mock('@/lib/useAuth', () => ({ useAuth: () => ({ token: 't', user: { id: 'u1' }, ready: true }) }));
jest.mock('@/lib/ClubProvider', () => ({ useClub: () => ({ slug: null, club: null }) }));

const emitOpen = (userId: string) =>
  act(() => { window.dispatchEvent(new CustomEvent('palova:open-dm', { detail: { userId } })); });

it('desktop : palova:open-dm ouvre le widget ancré avec le fil', async () => {
  // useIsDesktop lit matchMedia — le forcer à desktop
  (window.matchMedia as jest.Mock) = jest.fn().mockReturnValue({
    matches: true, addEventListener: jest.fn(), removeEventListener: jest.fn(),
  });
  render(<ThemeProvider><DmWidgetHost /></ThemeProvider>);
  emitOpen('u2');
  await waitFor(() => expect(apiMock.openConversation).toHaveBeenCalledWith('u2', 't', null));
  expect(await screen.findByText('Marie D')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /fermer/i }));
  expect(screen.queryByText('Marie D')).toBeNull();
});

it('mobile : palova:open-dm route vers /me/messages?with=', async () => {
  (window.matchMedia as jest.Mock) = jest.fn().mockReturnValue({
    matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn(),
  });
  render(<ThemeProvider><DmWidgetHost /></ThemeProvider>);
  emitOpen('u2');
  await waitFor(() => expect(push).toHaveBeenCalledWith('/me/messages?with=u2'));
});
```
⚠️ Adapter le stub `matchMedia` à celui de `jest.setup.ts` (il existe déjà — le surcharger localement comme ci-dessus).

- [ ] **Step 2 : Vérifier l'échec.**

- [ ] **Step 3 : `DmWidgetHost`** (`frontend/components/messages/DmWidgetHost.tsx`)

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ConversationSummary } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { useAuth } from '@/lib/useAuth';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { useClub } from '@/lib/ClubProvider';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';
import { MessageThread } from './MessageThread';

// Hôte GLOBAL du widget de conversation (monté une fois dans le layout racine).
// Écoute l'event window `palova:open-dm` ({ detail: { userId } }) émis par openDm() :
// desktop → widget ancré bas-droite (pattern OpenMatchChatSheet, la page reste cliquable) ;
// mobile → navigation vers /me/messages?with=. Rien n'est rendu hors connexion.
export function DmWidgetHost() {
  const { th } = useTheme();
  const router = useRouter();
  const { token, user, ready } = useAuth();
  const { slug } = useClub();
  const isDesktop = useIsDesktop();
  const [conv, setConv] = useState<ConversationSummary | null>(null);

  useEffect(() => {
    if (!ready || !token) return;
    const onOpen = (e: Event) => {
      const userId = (e as CustomEvent<{ userId?: string }>).detail?.userId;
      if (!userId) return;
      if (!isDesktop) { router.push(`/me/messages?with=${userId}`); return; }
      api.openConversation(userId, token, slug ?? null).then(setConv).catch(() => {});
    };
    window.addEventListener('palova:open-dm', onOpen);
    return () => window.removeEventListener('palova:open-dm', onOpen);
  }, [ready, token, isDesktop, router, slug]);

  if (!ready || !token || !user || !conv || !isDesktop) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'flex-end',
      justifyContent: 'flex-end', padding: 24, pointerEvents: 'none' }}>
      <div style={{ background: th.bg, display: 'flex', flexDirection: 'column', pointerEvents: 'auto',
        width: 'min(380px, 92vw)', height: 'min(520px, 80vh)', borderRadius: 20,
        boxShadow: '0 24px 64px rgba(0,0,0,0.35)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: `1px solid ${th.line}` }}>
          <Avatar firstName={conv.other.firstName} lastName={conv.other.lastName} avatarUrl={conv.other.avatarUrl}
            size={28} color={colorForSeed(conv.other.userId)} />
          <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 14.5, color: th.text, flex: 1 }}>
            {conv.other.firstName} {conv.other.lastName}
          </span>
          <button type="button" aria-label="Ouvrir la messagerie" title="Ouvrir la messagerie"
            onClick={() => { setConv(null); router.push(`/me/messages?with=${conv.other.userId}`); }}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textMute, fontSize: 15 }}>⤢</button>
          <button type="button" aria-label="Fermer" onClick={() => setConv(null)}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textMute, fontSize: 20 }}>×</button>
        </div>
        <MessageThread conversationId={conv.id} token={token} viewerUserId={user.id} other={conv.other} />
      </div>
    </div>
  );
}
```
⚠️ Même remarque que la page : si `useAuth` n'expose pas `user.id`, charger l'id via `getMyProfile` au premier open (et le mémoriser) — ne PAS ajouter d'appel systématique au montage (le host est sur toutes les pages).

- [ ] **Step 4 : Monter dans le layout racine** (`frontend/app/layout.tsx`)

```tsx
import { DmWidgetHost } from '@/components/messages/DmWidgetHost';
```
et dans le JSX, dans `<ClubProvider …>` juste avant `<Footer />` :
```tsx
          <DmWidgetHost />
```
(`ClubProvider` fournit le ThemeProvider — le host est un client component autorisé dans ce layout serveur.)

- [ ] **Step 5 : Vérifier puis committer**

`cd frontend; node node_modules/jest/bin/jest.js __tests__/DmWidgetHost.test.tsx` → PASS. `tsc --noEmit` OK.
```
git add frontend/components/messages/DmWidgetHost.tsx frontend/app/layout.tsx frontend/__tests__/DmWidgetHost.test.tsx
git commit -m "feat(dm): widget de conversation ancre (desktop) + openDm global via event window"
```

---

### Task 13 : Front — icône 💬 header + lien ProfileMenu + icône `chat` + préférence notifs + mocks

**Files:**
- Modify: `frontend/components/ui/Icon.tsx`, `frontend/components/ClubNav.tsx` (⚠️ WIP utilisateur), `frontend/components/ProfileMenu.tsx`, `frontend/lib/notifications.ts`
- Modify (mocks): `frontend/__tests__/ClubNav.test.tsx`, `frontend/__tests__/ClubReserve.deeplink.test.tsx`, `frontend/__tests__/ClubReserve.persport.test.tsx`, `frontend/__tests__/ClubReserve.pastslots.test.tsx`, `frontend/__tests__/OpenMatches.test.tsx`

- [ ] **Step 1 : Icône `chat`** (`components/ui/Icon.tsx`) — ajouter `'chat'` à `IconName` et, dans le switch/map des tracés (suivre le style des icônes existantes, stroke 24×24) :

```tsx
case 'chat': return <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" />;
```

- [ ] **Step 2 : Test badge header** (à ajouter dans `frontend/__tests__/ClubNav.test.tsx`, à côté du test du badge « Parties » existant) : mocker `api.getDmUnread` → `{ count: 4 }`, rendre `ClubNav`, attendre le lien/icône « Messages » avec badge « 4 » ; cliquer → `router.push('/me/messages')` (ou vérifier `href` selon le rendu). Vérifier aussi qu'un event `window.dispatchEvent(new Event('palova:dm-unread'))` redéclenche `getDmUnread`.

- [ ] **Step 3 : ClubNav — icône 💬 + badge** ⚠️ **Lire le fichier au moment de l'exécution** (WIP utilisateur : la position exacte peut avoir bougé). Pattern à suivre = badge `partiesUnread` existant (l.44-58) :
  - État `dmUnread`, chargé par `api.getDmUnread(token)` (PAS de slug — route `/api/me/*`), rafraîchi par : le flux `notificationsStreamUrl` déjà ouvert (sur `{type:'notification'}` → refresh les DEUX compteurs), l'event window `palova:dm-unread`, et le changement de `pathname`.
  - Rendu : à côté de la cloche/ProfileMenu dans la rangée header, un bouton icône `chat` (composant `Icon`, taille alignée sur la cloche) qui navigue vers `/me/messages`, surmonté du même `CountBadge` rouge que « Parties » quand `dmUnread > 0`. Visible seulement connecté (`token`).

- [ ] **Step 4 : ProfileMenu + préférences notifs**
  - `ProfileMenu.tsx` (l.156, après « Mes amis ») : `{slug && <MenuItem th={th} icon="chat" label="Messages" onClick={() => go('/me/messages')} />}` — **sans appel API** (ne casse pas les suites qui montent le vrai ClubNav/ProfileMenu).
  - `lib/notifications.ts` : ajouter `'DIRECT_MESSAGES'` au type `NotifCategory` et dans `CATEGORY_META` (après `OPEN_MATCH_CHAT`) :
    ```typescript
    { key: 'DIRECT_MESSAGES', label: 'Messages privés', desc: 'Quand un membre vous écrit en privé' },
    ```
    et dans `notificationVisual`, ajouter `case 'DIRECT_MESSAGES': return { icon: 'chat', accent: ACCENTS.blue };`

- [ ] **Step 5 : Réparer les mocks des suites real-mount**

Dans `ClubReserve.deeplink.test.tsx`, `ClubReserve.persport.test.tsx`, `ClubReserve.pastslots.test.tsx`, `OpenMatches.test.tsx` (et `ClubNav.test.tsx` si besoin) : ajouter au mock `@/lib/api` → `getDmUnread: jest.fn().mockResolvedValue({ count: 0 })` (au même endroit que `getOpenMatchUnread`).

- [ ] **Step 6 : Vérifier puis committer**

`cd frontend; node node_modules/jest/bin/jest.js __tests__/ClubNav.test.tsx __tests__/ClubReserve.deeplink.test.tsx __tests__/ClubReserve.persport.test.tsx __tests__/ClubReserve.pastslots.test.tsx __tests__/OpenMatches.test.tsx` → PASS.
```
git add frontend/components/ui/Icon.tsx frontend/components/ClubNav.tsx frontend/components/ProfileMenu.tsx frontend/lib/notifications.ts frontend/__tests__/ClubNav.test.tsx frontend/__tests__/ClubReserve.*.test.tsx frontend/__tests__/OpenMatches.test.tsx
git commit -m "feat(dm): icone Messages + badge non-lus dans le header, lien ProfileMenu, categorie de notifs"
```

---

### Task 14 : Entrées « Envoyer un message » (4 surfaces)

**Files:**
- Modify (backend) : `backend/src/services/tournament.service.ts` + `backend/src/services/event.service.ts` (`listParticipants` : exposer `userId` — additif)
- Modify (front) : `frontend/components/social/FriendsHub.tsx`, `frontend/components/player/PlayerPills.tsx`, `frontend/components/match/MatchTeams.tsx`, `frontend/components/event/ParticipantsGrid.tsx`, `frontend/components/tournament/TeamsGrid.tsx` + leurs points d'appel
- Tests : blocs ajoutés aux suites existantes (`tournament.service.test.ts`, `event.service.test.ts`, `FriendsHub.test.tsx`, `ParticipantsGrid`/`TeamsGrid` si suites existantes)

- [ ] **Step 1 (backend, TDD) : `userId` dans les inscrits publics**

Test (bloc à ajouter à `tournament.service.test.ts` et `event.service.test.ts`) : le retour de `listParticipants` expose `userId` pour chaque joueur/inscrit (mocker le findMany avec `user: { id: 'u2', … }` et asserter `expect(row.userId).toBe('u2')` — calquer sur les assertions `avatarUrl` existantes de ces suites).
Implémentation : dans les deux `listParticipants`, ajouter `id: true` au `select` du user (s'il n'y est pas déjà) et `userId: u.id` au mapping de sortie (champ **additif** — les seeds de couleur `colorForSeed(reg.id)` restent inchangés). Côté front, ajouter `userId?: string` aux types correspondants dans `lib/api.ts` (`TournamentParticipant`/`EventParticipant` — noms exacts à vérifier dans le fichier).

- [ ] **Step 2 (front) : helper d'appel commun**

Chaque surface appelle :
```tsx
import { openDm } from '@/lib/messages';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { useRouter } from 'next/navigation';
// dans le composant :
const isDesktop = useIsDesktop();
const router = useRouter();
const message = (userId: string) => openDm(userId, { isDesktop, navigate: (h) => router.push(h) });
```

- [ ] **Step 3 : FriendsHub** — bouton 💬 sur chaque ligne des 5 onglets (avant `FollowButton`/`FriendButton`), visible pour tout id ≠ moi :

```tsx
<button type="button" aria-label={`Écrire à ${f.firstName} ${f.lastName}`} title="Envoyer un message"
  onClick={() => message(f.id)}
  style={{ border: `1px solid ${th.line}`, background: 'transparent', color: th.text, borderRadius: 999,
    padding: '5px 9px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}>
  <Icon name="chat" size={15} color={th.textMute} />
</button>
```
(l'insérer dans les rendus des lignes `amis`/`following`/`followers`/`demandes`/`search` — dans `search`, l'id est `r.id`). Test : mocker `@/lib/messages` (`openDm: jest.fn()`) dans `FriendsHub.test.tsx` et vérifier l'appel avec le bon userId au clic.

- [ ] **Step 4 : joueurs d'une partie** — props additifs **optionnels** (aucun call-site existant cassé) :
  - `PlayerPills` : `onMessage?: (p: PlayerPillData) => void` → si fourni et `p.userId !== viewerUserId` (passer aussi `viewerUserId?: string`), rendre un petit bouton 💬 (même style que le × de retrait, `aria-label={'Écrire à ' + p.firstName}`) dans la pastille.
  - `MatchTeams` : `onPlayerTap?: (userId: string) => void` — actif **seulement si `!editable`** (ne pas interférer avec le tap-pour-permuter) : la cellule occupée d'un AUTRE joueur devient cliquable → `onPlayerTap(p.userId)`.
  - Câblage dans `OpenMatchCard` (et `OpenMatchDetail` via la carte partagée) : passer `onPlayerTap={viewer connecté && !anonyme ? message : undefined}` — lire la structure actuelle du composant au moment de l'exécution.

- [ ] **Step 5 : grilles d'inscrits tournoi/event** — dans `ParticipantsGrid.tsx` et `TeamsGrid.tsx` : si `p.userId` présent et ≠ viewer, bouton 💬 discret sur la carte (coin, `aria-label` explicite) → `message(p.userId)`. Le viewerUserId est déjà connu des pages fiches (sinon le passer en prop optionnelle depuis `/tournois/[id]` et `/events/[id]`).

- [ ] **Step 6 : Vérifier puis committer**

Backend : suites tournament/event PASS. Front : suites FriendsHub + composants touchés PASS ; `tsc --noEmit` des deux côtés.
```
git add backend/src/services/tournament.service.ts backend/src/services/event.service.ts backend/src/services/__tests__/tournament.service.test.ts backend/src/services/__tests__/event.service.test.ts frontend/components/social/FriendsHub.tsx frontend/components/player/PlayerPills.tsx frontend/components/match/MatchTeams.tsx frontend/components/event/ParticipantsGrid.tsx frontend/components/tournament/TeamsGrid.tsx frontend/lib/api.ts frontend/__tests__/FriendsHub.test.tsx
git commit -m "feat(dm): entrees Envoyer un message (amis, parties, annuaire, inscrits) + userId additif inscrits"
```
*(Ajuster la liste `git add` aux fichiers réellement touchés — call-sites inclus.)*

---

### Task 15 : Vérification finale + documentation

**Files:**
- Modify: `CLAUDE.md` (nouvelle section), rien d'autre

- [ ] **Step 1 : Suites complètes scopées**

```
cd backend;  node node_modules/jest/bin/jest.js src/services/__tests__/messaging.service.test.ts src/routes/__tests__/conversations.routes.test.ts src/email/__tests__/notifications.dm.test.ts src/services/__tests__/tournament.service.test.ts src/services/__tests__/event.service.test.ts
cd backend;  node node_modules/typescript/bin/tsc --noEmit
cd frontend; node node_modules/jest/bin/jest.js __tests__/messages.test.ts __tests__/MessageThread.test.tsx __tests__/MessagesHub.test.tsx __tests__/DmWidgetHost.test.tsx __tests__/ClubNav.test.tsx __tests__/OpenMatchChatSheet.test.tsx __tests__/FriendsHub.test.tsx __tests__/ClubReserve.deeplink.test.tsx __tests__/ClubReserve.persport.test.tsx __tests__/ClubReserve.pastslots.test.tsx __tests__/OpenMatches.test.tsx
cd frontend; node node_modules/typescript/bin/tsc --noEmit
```
Attendu : tout PASS (rappel : la full-suite `npx jest` frontend a un flake BookingModal connu — non bloquant, hors périmètre).

- [ ] **Step 2 : Smoke test manuel (invoquer le skill `verify` / `run`)**

Backend + frontend démarrés (cf. CLAUDE.md racine), deux comptes du club seedé (`test@palova.fr` + un 2ᵉ membre, slug `padel-arena-paris`) :
1. Compte A → `/me/friends` → onglet Trouver → 💬 sur un membre → (desktop) widget ancré s'ouvre.
2. A envoie « salut » → compte B (autre navigateur) : badge 💬 header passe à 1, cloche notifiée ; B ouvre `/me/messages` → fil, ✓✓ apparaît chez A en direct.
3. B tape → « B écrit… » chez A ; réaction 👍 chez B → chip visible chez A.
4. A envoie une photo → vignette + lightbox chez B ; l'URL de l'image exige le token (tester en navigation privée → 401).
5. A bloque B (menu ⋮) → B ne peut plus écrire (« Vous ne pouvez pas échanger… ») ; A débloque → OK.
6. Vérifier l'email « fallback console » du backend pour le 1er message manqué (et un seul par rafale).
7. `curl http://localhost:3001/api/me/conversations -H "Authorization: Bearer <token>"` → 200 JSON.

- [ ] **Step 3 : Documenter dans `CLAUDE.md`** — ajouter une section « ## Messagerie privée 1-à-1 (v1) ✅ implémenté » sur le modèle des autres : modèles + migration `add_direct_messages` (appliquée en DEV via `prisma db execute`, prod `migrate deploy` + **volume `backend_uploads_private`**), gardes (co-membres ACTIFS, blocage bilatéral, auteur-seul), routes, SSE 4ᵉ canal, notifs `DIRECT_MESSAGES` (email coalescé, ⚠️ SMTP prod), composants front, entrées, écarts de spec (réactions `{emoji, userIds}`), pointeurs spec+plan.

- [ ] **Step 4 : Commit final**

```
git add CLAUDE.md
git commit -m "docs(dm): section messagerie privee 1-a-1 dans CLAUDE.md"
```

---

## Couverture spec → tâches (auto-vérification)

| Exigence de la spec | Tâche |
|---|---|
| 5 modèles + enum, migration additive | 1 |
| Canal SSE conversation | 2 |
| Get-or-create canonique, co-membres, self, RGPD | 3 |
| Inbox (≥1 message), unreadCount exacts, total global | 3 |
| Fil paginé curseur + méta, envoi, suppression auteur-seul | 4 |
| markRead/✓✓, réactions, typing, block/unblock/liste | 5 |
| Notif `dm.message` in-app+push/message, email coalescé, registre + `/admin/emails` | 6 |
| Routes + mapping erreurs + SSE token query | 7 |
| Photos privées (upload 5 Mo, streaming authentifié, volume prod) | 8 |
| api front + helpers purs + CHAT_EMOJIS partagés | 9 |
| Fil UI (optimiste, réactions, ✓✓, typing, pierre tombale, pagination, lightbox) + composer (emoji, photo, Entrée) | 10 |
| Inbox UI + hub split/mobile + page + deeplink `?with=` + blocage UI + bloqués | 11 |
| Widget desktop + `openDm` + montage racine | 12 |
| Badge 💬 header + ProfileMenu + `CategoryMeta` + mocks real-mount | 13 |
| 4 entrées (amis, partie, annuaire, inscrits) + `userId` additif | 14 |
| Vérif E2E + CLAUDE.md | 15 |
