# Modération & anti-abus des chats — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fermer 4 trous de sécurité/légaux des chats (partie ouverte + messagerie privée) : signalement de messages (DSA/LCEN) avec files de modération club/superadmin, rate-limiting Redis anti-boucle, re-vérification de la co-adhésion active pour bloquer un membre `BLOCKED` en DM, ré-encodage sharp des photos DM (format réel, EXIF/GPS retirés, plafond 2048×2048).

**Architecture:** Backend additif — 1 migration (`MessageReport` + 3 enums), 1 helper Redis (`rateLimit.ts`), 1 nouveau `ModerationService` qui réutilise les gardes d'accès déjà publiques d'`OpenMatchChatService`/`MessagingService`, 2 méthodes de modération ajoutées à `MessagingService` (suppression/lecture image sans garde participant, réservées au superadmin), 2 builders d'email purs. Routes : 2 routes de création de signalement (existantes `clubs.ts`/`conversations.ts`), 2 routes admin club (`admin.ts`, déjà montées sous `requireClubMember`), 3 routes superadmin (`platform.ts`, déjà montées sous `requireSuperAdmin`). Frontend — 1 composant `ReportDialog` partagé, câblage dans les 2 chats existants, 2 pages admin/superadmin neuves, 1 entrée FAQ.

**Tech Stack:** Express + Prisma 7 (adapter pg) + ioredis + sharp, Next.js 16, Jest (backend `npx jest` fonctionne ; frontend shims `node_modules/.bin` cassés → `node node_modules/jest/bin/jest.js` / `node node_modules/typescript/bin/tsc`).

**Spec:** `docs/superpowers/specs/2026-07-14-moderation-chat-design.md`

---

## Conventions du repo à respecter

- Migrations : JAMAIS `prisma db push` ni `migrate dev` (dérive de la base dev) — écrire le SQL additif, l'appliquer via `npx prisma db execute --file …` (depuis `backend/`), puis `npx prisma generate`.
- PowerShell/Bash : le cwd persiste dans l'outil Bash de cette session — préfixer par `cd` uniquement si nécessaire.
- Les tests frontend ne type-checkent pas (ts-jest isolatedModules) : `tsc --noEmit` est la porte de types séparée, à lancer scopée sur les fichiers touchés (le repo a du WIP parallèle).
- `assertRateLimit` échoue TOUJOURS ouvert (fail-open) sur erreur Redis — jamais fail-closed.
- Tous les fichiers TypeScript neufs suivent le style existant : pas de commentaires inutiles, un commentaire uniquement pour une contrainte non-évidente.

## Structure des fichiers

**Backend**
- Create: `backend/prisma/migrations/20260714130000_add_message_reports/migration.sql`
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/src/services/rateLimit.ts` + `backend/src/services/__tests__/rateLimit.test.ts`
- Modify: `backend/src/__mocks__/redis.ts`
- Modify: `backend/src/services/messaging.service.ts` (BLOCKED→DM, sharp, rate-limit, 2 méthodes modérateur)
- Modify: `backend/src/services/__tests__/messaging.service.test.ts`
- Modify: `backend/src/services/openMatchChat.service.ts` (rate-limit)
- Modify: `backend/src/email/notifications.ts` (export `EMAIL_CLUB_SELECT`)
- Create: `backend/src/email/templates/moderation.ts` + `backend/src/email/__tests__/moderation-emails.test.ts`
- Create: `backend/src/services/moderation.service.ts` + `backend/src/services/__tests__/moderation.service.test.ts`
- Modify: `backend/src/routes/clubs.ts` (route signalement chat)
- Modify: `backend/src/routes/conversations.ts` (route signalement DM)
- Modify: `backend/src/routes/__tests__/clubs.openmatch-chat.routes.test.ts`
- Modify: `backend/src/routes/__tests__/conversations.routes.test.ts`
- Modify: `backend/src/routes/admin.ts` (2 routes modération club)
- Create: `backend/src/routes/__tests__/admin.moderation.routes.test.ts`
- Modify: `backend/src/routes/platform.ts` (3 routes modération DM)
- Create: `backend/src/routes/__tests__/platform.moderation.routes.test.ts`

**Frontend**
- Modify: `frontend/lib/api.ts`
- Modify: `frontend/components/ui/Icon.tsx`
- Create: `frontend/components/moderation/ReportDialog.tsx` + `frontend/__tests__/ReportDialog.test.tsx`
- Modify: `frontend/components/openmatch/OpenMatchChatSheet.tsx` + `frontend/__tests__/OpenMatchChatSheet.test.tsx`
- Modify: `frontend/components/messages/MessageThread.tsx` + `frontend/__tests__/MessageThread.test.tsx`
- Create: `frontend/app/admin/moderation/page.tsx` + `frontend/__tests__/AdminModeration.test.tsx`
- Modify: `frontend/app/admin/layout.tsx` + `frontend/__tests__/AdminLayout.test.tsx`
- Create: `frontend/app/superadmin/moderation/page.tsx` + `frontend/__tests__/SuperAdminModeration.test.tsx`
- Modify: `frontend/app/superadmin/layout.tsx`
- Modify: `frontend/lib/platformContent.ts`

---

### Task 1: Migration — `MessageReport` + 3 enums

**Files:**
- Create: `backend/prisma/migrations/20260714130000_add_message_reports/migration.sql`
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1: Écrire le SQL de migration**

Créer `backend/prisma/migrations/20260714130000_add_message_reports/migration.sql` :

```sql
DO $$ BEGIN
  CREATE TYPE "ReportReason" AS ENUM ('HARASSMENT', 'ILLEGAL', 'SPAM', 'OTHER');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'RESOLVED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "ReportResolution" AS ENUM ('DELETED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "message_reports" (
  "id" TEXT NOT NULL,
  "open_match_message_id" TEXT,
  "direct_message_id" TEXT,
  "reporter_id" TEXT NOT NULL,
  "club_id" TEXT,
  "reason" "ReportReason" NOT NULL,
  "detail" TEXT,
  "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
  "resolution" "ReportResolution",
  "resolved_by_id" TEXT,
  "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "message_reports_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "message_reports_open_match_message_id_reporter_id_key" ON "message_reports"("open_match_message_id", "reporter_id");
CREATE UNIQUE INDEX IF NOT EXISTS "message_reports_direct_message_id_reporter_id_key" ON "message_reports"("direct_message_id", "reporter_id");
CREATE INDEX IF NOT EXISTS "message_reports_club_id_status_idx" ON "message_reports"("club_id", "status");
CREATE INDEX IF NOT EXISTS "message_reports_status_idx" ON "message_reports"("status");

DO $$ BEGIN
  ALTER TABLE "message_reports" ADD CONSTRAINT "message_reports_open_match_message_id_fkey"
    FOREIGN KEY ("open_match_message_id") REFERENCES "open_match_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "message_reports" ADD CONSTRAINT "message_reports_direct_message_id_fkey"
    FOREIGN KEY ("direct_message_id") REFERENCES "direct_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "message_reports" ADD CONSTRAINT "message_reports_reporter_id_fkey"
    FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "message_reports" ADD CONSTRAINT "message_reports_resolved_by_id_fkey"
    FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
```

- [ ] **Step 2: Ajouter les enums + le modèle dans `backend/prisma/schema.prisma`**

Juste avant `model OpenMatchMessage {` (repérer avec `grep -n "model OpenMatchMessage" backend/prisma/schema.prisma`), insérer :

```prisma
enum ReportReason {
  HARASSMENT
  ILLEGAL
  SPAM
  OTHER
}

enum ReportStatus {
  OPEN
  RESOLVED
}

enum ReportResolution {
  DELETED
  REJECTED
}

/// Signalement d'un message (chat de partie OU DM — exactement une des deux FK est renseignée,
/// pattern Payment). clubId = routage (résa du chat de partie ; clubId de la conversation pour
/// un DM, informatif seulement — le routage DM est superadmin, jamais le staff club).
model MessageReport {
  id                 String            @id @default(cuid())
  openMatchMessageId String?           @map("open_match_message_id")
  directMessageId    String?           @map("direct_message_id")
  reporterId         String            @map("reporter_id")
  clubId             String?           @map("club_id")
  reason             ReportReason
  detail             String?
  status             ReportStatus      @default(OPEN)
  resolution         ReportResolution?
  resolvedById       String?           @map("resolved_by_id")
  resolvedAt         DateTime?         @map("resolved_at")
  createdAt          DateTime          @default(now()) @map("created_at")

  openMatchMessage OpenMatchMessage? @relation(fields: [openMatchMessageId], references: [id], onDelete: Cascade)
  directMessage    DirectMessage?    @relation(fields: [directMessageId], references: [id], onDelete: Cascade)
  reporter         User              @relation("MessageReportsFiled", fields: [reporterId], references: [id], onDelete: Cascade)
  resolvedBy       User?             @relation("MessageReportsResolved", fields: [resolvedById], references: [id], onDelete: SetNull)

  @@unique([openMatchMessageId, reporterId])
  @@unique([directMessageId, reporterId])
  @@index([clubId, status])
  @@index([status])
  @@map("message_reports")
}
```

Puis, dans `model OpenMatchMessage { ... }`, après la ligne `user User @relation(...)`, ajouter :
```prisma
  reports MessageReport[]
```

Dans `model DirectMessage { ... }`, après la ligne `reactions MessageReaction[]`, ajouter :
```prisma
  reports MessageReport[]
```

Dans `model User { ... }`, juste avant `@@map("users")` (après `blocksReceived UserBlock[] @relation("BlocksReceived")`), ajouter :
```prisma
  messageReportsFiled    MessageReport[] @relation("MessageReportsFiled")
  messageReportsResolved MessageReport[] @relation("MessageReportsResolved")
```

- [ ] **Step 3: Appliquer en DEV + régénérer le client**

Run (depuis `backend/`) :
```bash
npx prisma db execute --file prisma/migrations/20260714130000_add_message_reports/migration.sql
npx prisma generate
```
Expected: exécution sans erreur, client régénéré (les types `ReportReason`/`ReportStatus`/`ReportResolution`/`MessageReport` deviennent disponibles depuis `@prisma/client`).

- [ ] **Step 4: Vérifier que le reste de la suite Prisma est toujours vert**

Run (depuis `backend/`) :
```bash
npx jest src/services/__tests__/club.service.test.ts
```
Expected: PASS (aucune régression — changement additif pur).

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260714130000_add_message_reports
git commit -m "feat(moderation): migration MessageReport (signalement chat + DM)"
```

---

### Task 2: Helper rate-limiting Redis

**Files:**
- Create: `backend/src/services/rateLimit.ts`
- Modify: `backend/src/__mocks__/redis.ts`
- Create: `backend/src/services/__tests__/rateLimit.test.ts`

- [ ] **Step 1: Ajouter `incr`/`expire` au mock Redis**

Dans `backend/src/__mocks__/redis.ts`, remplacer :
```ts
export const redisMock = {
  set: jest.fn(),
  del: jest.fn(),
  get: jest.fn(),
  exists: jest.fn(),
  connect: jest.fn(),
  on: jest.fn(),
};
```
par :
```ts
export const redisMock = {
  set: jest.fn(),
  del: jest.fn(),
  get: jest.fn(),
  exists: jest.fn(),
  incr: jest.fn(),
  expire: jest.fn(),
  connect: jest.fn(),
  on: jest.fn(),
};
```

- [ ] **Step 2: Écrire le test (échoue d'abord — module inexistant)**

Créer `backend/src/services/__tests__/rateLimit.test.ts` :
```ts
import '../../__mocks__/redis';
import { redisMock } from '../../__mocks__/redis';
import { assertRateLimit } from '../rateLimit';

describe('assertRateLimit', () => {
  it('sous la limite → OK, INCR posé, EXPIRE au premier appel (count===1)', async () => {
    redisMock.incr.mockResolvedValue(1);
    redisMock.expire.mockResolvedValue(1);
    await expect(assertRateLimit('test:bucket', 'u1', 5, 60)).resolves.toBeUndefined();
    expect(redisMock.incr).toHaveBeenCalledWith(expect.stringContaining('rl:test:bucket:u1:'));
    expect(redisMock.expire).toHaveBeenCalledWith(expect.stringMatching(/^rl:test:bucket:u1:\d+$/), 60);
  });

  it('un appel suivant (count > 1) ne repose pas EXPIRE', async () => {
    redisMock.incr.mockResolvedValue(3);
    await assertRateLimit('test:bucket', 'u1', 5, 60);
    expect(redisMock.expire).not.toHaveBeenCalled();
  });

  it('au-delà de la limite → throw RATE_LIMITED', async () => {
    redisMock.incr.mockResolvedValue(6);
    await expect(assertRateLimit('test:bucket', 'u1', 5, 60)).rejects.toThrow('RATE_LIMITED');
  });

  it('fenêtre différente → clé différente', async () => {
    redisMock.incr.mockResolvedValue(1);
    const t0 = 1_720_000_000_000;
    jest.spyOn(Date, 'now').mockReturnValueOnce(t0).mockReturnValueOnce(t0 + 61_000);
    await assertRateLimit('test:bucket', 'u1', 5, 60);
    await assertRateLimit('test:bucket', 'u1', 5, 60);
    const keys = redisMock.incr.mock.calls.map((c) => c[0]);
    expect(keys[0]).not.toBe(keys[1]);
    (Date.now as jest.Mock).mockRestore();
  });

  it('Redis indisponible (incr rejette) → fail-open, ne lève pas', async () => {
    redisMock.incr.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(assertRateLimit('test:bucket', 'u1', 5, 60)).resolves.toBeUndefined();
  });

  it('Redis indisponible sur EXPIRE → fail-open aussi', async () => {
    redisMock.incr.mockResolvedValue(1);
    redisMock.expire.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(assertRateLimit('test:bucket', 'u1', 5, 60)).resolves.toBeUndefined();
  });
});
```

Run (depuis `backend/`) :
```bash
npx jest src/services/__tests__/rateLimit.test.ts
```
Expected: FAIL — `Cannot find module '../rateLimit'`.

- [ ] **Step 3: Implémenter `rateLimit.ts`**

Créer `backend/src/services/rateLimit.ts` :
```ts
import { redis } from '../redis/client';

/**
 * Fenêtre fixe (pas de sliding window) : clé `rl:{bucket}:{userId}:{floor(now/windowSec)}`.
 * Fail-open sur toute erreur Redis (down, timeout) — le chat ne meurt jamais si Redis est
 * indisponible ; seul le dépassement RÉEL de la limite lève.
 */
export async function assertRateLimit(bucket: string, userId: string, max: number, windowSec: number): Promise<void> {
  const windowStart = Math.floor(Date.now() / 1000 / windowSec);
  const key = `rl:${bucket}:${userId}:${windowStart}`;
  let count: number;
  try {
    count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSec);
  } catch (err) {
    console.error('[rateLimit] Redis indisponible, fail-open', err);
    return;
  }
  if (count > max) throw new Error('RATE_LIMITED');
}
```

- [ ] **Step 4: Vérifier**

Run (depuis `backend/`) :
```bash
npx jest src/services/__tests__/rateLimit.test.ts
```
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/rateLimit.ts backend/src/services/__tests__/rateLimit.test.ts backend/src/__mocks__/redis.ts
git commit -m "feat(moderation): helper rate-limit Redis fail-open"
```

---

### Task 3: Fermeture BLOCKED→DM (co-adhésion re-vérifiée à chaque envoi)

**Files:**
- Modify: `backend/src/services/messaging.service.ts`
- Modify: `backend/src/services/__tests__/messaging.service.test.ts`

- [ ] **Step 1: Ajouter `assertCanWrite` (réutilise `sharedActiveClubId`)**

Dans `backend/src/services/messaging.service.ts`, après la méthode `assertNotBlocked` (juste avant `private async pairBlocked`), insérer :
```ts
  /** Écriture autorisée : pas bloqué + un club ACTIF commun où les DEUX adhésions sont ACTIVES,
   *  re-vérifié à CHAQUE envoi (pas seulement à la création de la conversation) — un membre
   *  BLOCKED du seul club commun perd l'écriture même sans blocage de paire. Réutilise
   *  sharedActiveClubId (throw NOT_CO_MEMBERS si plus aucun club commun). */
  private async assertCanWrite(a: string, b: string): Promise<void> {
    await this.assertNotBlocked(a, b);
    await this.sharedActiveClubId(a, b);
  }
```

- [ ] **Step 2: Appliquer dans `postMessage` et `addReaction`**

Dans `postMessage`, remplacer :
```ts
    const { otherId } = await this.assertParticipant(conversationId, meId);
    await this.assertNotBlocked(meId, otherId);
    const body = (rawBody ?? '').trim();
```
par :
```ts
    const { otherId } = await this.assertParticipant(conversationId, meId);
    await this.assertCanWrite(meId, otherId);
    const body = (rawBody ?? '').trim();
```

Dans `addReaction`, remplacer :
```ts
    const { otherId } = await this.assertParticipant(conversationId, meId);
    await this.assertNotBlocked(meId, otherId);
    const e = (emoji ?? '').trim();
```
par :
```ts
    const { otherId } = await this.assertParticipant(conversationId, meId);
    await this.assertCanWrite(meId, otherId);
    const e = (emoji ?? '').trim();
```

`createImageMessage` sera traité au Task 4 (réécriture complète de la méthode).

- [ ] **Step 3: Mettre à jour les `beforeEach` existants (sinon `mine.length` throw sur `undefined`)**

Dans le describe `'MessagingService — messages'` (chercher `describe('MessagingService — messages'`), le `beforeEach` actuel est :
```ts
  beforeEach(() => {
    service = new MessagingService();
    mockNotify.mockReset().mockResolvedValue(undefined);
    broadcast = jest.spyOn(SSEService.getInstance(), 'broadcastConversation').mockImplementation(() => {});
    prismaMock.conversation.findUnique.mockResolvedValue(CONV as any);
    prismaMock.userBlock.findFirst.mockResolvedValue(null);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
  });
```
Ajouter 2 lignes juste après `prismaMock.userBlock.findFirst.mockResolvedValue(null);` :
```ts
    prismaMock.clubMembership.findMany.mockResolvedValue([{ clubId: 'club-demo' }] as any);
    prismaMock.clubMembership.findFirst.mockResolvedValue({ clubId: 'club-demo' } as any);
```

Dans le describe `'MessagingService — lecture, réactions, frappe, blocages'`, le `beforeEach` actuel est :
```ts
  beforeEach(() => {
    service = new MessagingService();
    broadcast = jest.spyOn(SSEService.getInstance(), 'broadcastConversation').mockImplementation(() => {});
    prismaMock.conversation.findUnique.mockResolvedValue(CONV as any);
    prismaMock.userBlock.findFirst.mockResolvedValue(null);
  });
```
Ajouter les mêmes 2 lignes après `prismaMock.userBlock.findFirst.mockResolvedValue(null);`.

- [ ] **Step 4: Lancer les tests existants (non-régression)**

Run (depuis `backend/`) :
```bash
npx jest src/services/__tests__/messaging.service.test.ts
```
Expected: tous PASS (même nombre qu'avant — comportement inchangé quand un club commun existe).

- [ ] **Step 5: Ajouter les tests du nouveau comportement**

Dans le describe `'MessagingService — messages'`, après le test `'postMessage : paire bloquée → USER_BLOCKED (quel que soit le sens)'`, ajouter :
```ts
  it('postMessage : plus aucun club actif commun → NOT_CO_MEMBERS', async () => {
    prismaMock.clubMembership.findMany.mockResolvedValue([]);
    await expect(service.postMessage('c1', 'u1', 'yo')).rejects.toThrow('NOT_CO_MEMBERS');
  });

  it('postMessage : club commun mais l autre a perdu son adhésion ACTIVE (BLOCKED) → NOT_CO_MEMBERS', async () => {
    prismaMock.clubMembership.findMany.mockResolvedValue([{ clubId: 'club-demo' }] as any);
    prismaMock.clubMembership.findFirst.mockResolvedValue(null);
    await expect(service.postMessage('c1', 'u1', 'yo')).rejects.toThrow('NOT_CO_MEMBERS');
  });

  it('postMessage : un AUTRE club actif commun suffit encore', async () => {
    prismaMock.clubMembership.findMany.mockResolvedValue([{ clubId: 'club-autre' }] as any);
    prismaMock.clubMembership.findFirst.mockResolvedValue({ clubId: 'club-autre' } as any);
    prismaMock.directMessage.create.mockResolvedValue(MSG_ROW('m3', 'u1', 'yo') as any);
    prismaMock.conversation.update.mockResolvedValue({} as any);
    await expect(service.postMessage('c1', 'u1', 'yo')).resolves.toMatchObject({ id: 'm3' });
  });
```

Dans le describe `'MessagingService — lecture, réactions, frappe, blocages'`, après le test `'addReaction : message supprimé ou étranger → MESSAGE_NOT_FOUND ; emoji vide → VALIDATION_ERROR'`, ajouter :
```ts
  it('addReaction : plus de club actif commun → NOT_CO_MEMBERS', async () => {
    prismaMock.clubMembership.findMany.mockResolvedValue([]);
    await expect(service.addReaction('c1', 'u1', 'm1', '👍')).rejects.toThrow('NOT_CO_MEMBERS');
  });

  it('removeReaction et markRead restent accessibles même sans club commun (lecture/nettoyage)', async () => {
    prismaMock.clubMembership.findMany.mockResolvedValue([]);
    prismaMock.directMessage.findUnique.mockResolvedValue({ id: 'm1', conversationId: 'c1', deletedAt: null } as any);
    prismaMock.messageReaction.deleteMany.mockResolvedValue({ count: 1 } as any);
    prismaMock.messageReaction.findMany.mockResolvedValue([] as any);
    await expect(service.removeReaction('c1', 'u1', 'm1', '👍')).resolves.toEqual([]);
    prismaMock.conversationParticipant.update.mockResolvedValue({ lastReadAt: new Date('2026-07-04T11:00:00Z') } as any);
    prismaMock.notification.updateMany.mockResolvedValue({ count: 0 } as any);
    await expect(service.markRead('c1', 'u1')).resolves.toMatchObject({ lastReadAt: expect.any(String) });
  });
```

- [ ] **Step 6: Lancer les tests**

Run (depuis `backend/`) :
```bash
npx jest src/services/__tests__/messaging.service.test.ts
```
Expected: tous PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/messaging.service.ts backend/src/services/__tests__/messaging.service.test.ts
git commit -m "fix(dm): re-verifier la co-adhesion active a chaque envoi (BLOCKED coupe les DM)"
```

---

### Task 4: Ré-encodage sharp des photos DM (format réel, EXIF retiré, plafond 2048×2048)

**Files:**
- Modify: `backend/src/services/messaging.service.ts`
- Modify: `backend/src/services/__tests__/messaging.service.test.ts`

- [ ] **Step 1: Réécrire `createImageMessage`**

Dans `backend/src/services/messaging.service.ts`, en tête de fichier, remplacer :
```ts
import { DM_DIR, EXT_BY_MIME } from '../utils/uploads';
```
par :
```ts
import sharp from 'sharp';
import { DM_DIR } from '../utils/uploads';
```

Remplacer toute la méthode `createImageMessage` :
```ts
  /** Poste un message photo (JPEG/PNG/WebP ≤ 5 Mo, légende optionnelle ≤ 2000). */
  async createImageMessage(conversationId: string, meId: string,
    file: { buffer: Buffer; mimetype: string }, caption?: string | null): Promise<DmMessageDTO> {
    const { otherId } = await this.assertParticipant(conversationId, meId);
    await this.assertCanWrite(meId, otherId);
    await assertRateLimit('dm:post', meId, 12, 60);
    await assertRateLimit('dm:image', meId, 20, 3600);
    const body = (caption ?? '').trim();
    if (body.length > MAX_BODY) throw new Error('VALIDATION_ERROR');

    const { buffer: processed, ext } = await this.reencodeImage(file.buffer);

    const relPath = `${conversationId}/${Date.now()}-${Math.round(Math.random() * 1e9)}.${ext}`;
    const absPath = path.join(DM_DIR, relPath);
    await fs.promises.mkdir(path.dirname(absPath), { recursive: true });
    await fs.promises.writeFile(absPath, processed);

    let created: MsgRow;
    try {
      created = await prisma.$transaction(async (tx) => {
        const c = await tx.directMessage.create({
          data: { conversationId, authorId: meId, body, imageUrl: relPath },
          select: MSG_SELECT,
        });
        await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: c.createdAt } });
        return c;
      });
    } catch (err) {
      fs.promises.unlink(absPath).catch(() => {}); // pas de fichier orphelin
      throw err;
    }
    return this.finishSend(conversationId, meId, created);
  }

  /** Détecte le format RÉEL (sharp, pas le mimetype déclaré par le client), applique
   *  l'orientation EXIF puis ré-encode SANS métadonnées (EXIF/GPS/ICC retirés par défaut),
   *  plafonne 2048×2048 sans agrandir. Fichier corrompu / non jpeg-png-webp → VALIDATION_ERROR. */
  private async reencodeImage(input: Buffer): Promise<{ buffer: Buffer; ext: string }> {
    try {
      const img = sharp(input).rotate();
      const meta = await img.metadata();
      if (meta.format !== 'jpeg' && meta.format !== 'png' && meta.format !== 'webp') {
        throw new Error('VALIDATION_ERROR');
      }
      const resized = img.resize(2048, 2048, { fit: 'inside', withoutEnlargement: true });
      const buffer = meta.format === 'jpeg' ? await resized.jpeg({ quality: 82 }).toBuffer()
        : meta.format === 'webp' ? await resized.webp({ quality: 82 }).toBuffer()
        : await resized.png().toBuffer();
      return { buffer, ext: meta.format === 'jpeg' ? 'jpg' : meta.format };
    } catch (err) {
      if ((err as Error).message === 'VALIDATION_ERROR') throw err;
      throw new Error('VALIDATION_ERROR');
    }
  }
```

Add the `assertRateLimit` import (placed here since Task 5 also needs it — importing now avoids a second edit pass):
```ts
import { assertRateLimit } from './rateLimit';
```
(insert next to the `sharp`/`DM_DIR` imports at the top of the file).

- [ ] **Step 2: Écrire les tests (real sharp buffers, pas de fixtures binaires)**

Dans `backend/src/services/__tests__/messaging.service.test.ts`, ajouter en tête de fichier :
```ts
import sharp from 'sharp';
import fs from 'fs';
```

À la fin du describe `'MessagingService — messages'` (juste avant la dernière accolade fermante du describe, après le bloc `deleteMessage : message d'une AUTRE conversation`), ajouter :
```ts
  describe('createImageMessage', () => {
    beforeEach(() => {
      prismaMock.clubMembership.findMany.mockResolvedValue([{ clubId: 'club-demo' }] as any);
      prismaMock.clubMembership.findFirst.mockResolvedValue({ clubId: 'club-demo' } as any);
    });

    it('détecte le format RÉEL via sharp (mimetype menteur), stocke la bonne extension, plafonne 2048×2048, retire l EXIF', async () => {
      const bigPng = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 10, g: 200, b: 30 } } })
        .withMetadata({ exif: { IFD0: { Make: 'TestCam' } } })
        .png().toBuffer();
      const writeSpy = jest.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined);
      jest.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined as any);
      prismaMock.directMessage.create.mockResolvedValue(MSG_ROW('m5', 'u1', '') as any);
      prismaMock.conversation.update.mockResolvedValue({} as any);

      const dto = await service.createImageMessage('c1', 'u1', { buffer: bigPng, mimetype: 'image/jpeg' }, '');

      expect(prismaMock.directMessage.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ imageUrl: expect.stringMatching(/^c1\/\d+-\d+\.png$/) }),
      }));
      const written = writeSpy.mock.calls[0][1] as Buffer;
      const outMeta = await sharp(written).metadata();
      expect(outMeta.format).toBe('png');
      expect(outMeta.width).toBeLessThanOrEqual(2048);
      expect(outMeta.height).toBeLessThanOrEqual(2048);
      expect(outMeta.exif).toBeUndefined();
      expect(dto.imageUrl).toMatch(/\.png$/);
      writeSpy.mockRestore();
    });

    it('fichier corrompu / non-image → VALIDATION_ERROR', async () => {
      await expect(
        service.createImageMessage('c1', 'u1', { buffer: Buffer.from('pas une image'), mimetype: 'image/png' }, ''),
      ).rejects.toThrow('VALIDATION_ERROR');
    });

    it('format non supporté (gif) → VALIDATION_ERROR', async () => {
      const gif = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 0, g: 0, b: 0 } } }).gif().toBuffer();
      await expect(
        service.createImageMessage('c1', 'u1', { buffer: gif, mimetype: 'image/gif' }, ''),
      ).rejects.toThrow('VALIDATION_ERROR');
    });

    it('légende > 2000 caractères → VALIDATION_ERROR (avant même le décodage image)', async () => {
      const tiny = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 0, g: 0, b: 0 } } }).jpeg().toBuffer();
      await expect(
        service.createImageMessage('c1', 'u1', { buffer: tiny, mimetype: 'image/jpeg' }, 'x'.repeat(2001)),
      ).rejects.toThrow('VALIDATION_ERROR');
    });

    it('petite image sous le plafond n est pas agrandie', async () => {
      const small = await sharp({ create: { width: 40, height: 30, channels: 3, background: { r: 5, g: 5, b: 5 } } }).jpeg().toBuffer();
      const writeSpy = jest.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined);
      jest.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined as any);
      prismaMock.directMessage.create.mockResolvedValue(MSG_ROW('m6', 'u1', '') as any);
      prismaMock.conversation.update.mockResolvedValue({} as any);

      await service.createImageMessage('c1', 'u1', { buffer: small, mimetype: 'image/jpeg' }, '');

      const written = writeSpy.mock.calls[0][1] as Buffer;
      const outMeta = await sharp(written).metadata();
      expect(outMeta.width).toBe(40);
      expect(outMeta.height).toBe(30);
      writeSpy.mockRestore();
    });
  });
```

Note: le `gif()` de sharp nécessite le support GIF de libvips (présent dans le build sharp par défaut utilisé ailleurs dans le repo, ex. `icon.service.ts`) — si `sharp().gif()` n'est pas disponible dans l'environnement CI, remplacer ce test par un buffer BMP (`Buffer.from([0x42,0x4D, ...])` minimal) ou simplement vérifier qu'un format inconnu déclaré est rejeté avec le buffer corrompu du test précédent (le test « format non supporté » devient alors redondant avec « fichier corrompu » et peut être retiré).

- [ ] **Step 3: Lancer les tests**

Run (depuis `backend/`) :
```bash
npx jest src/services/__tests__/messaging.service.test.ts
```
Expected: tous PASS (5 nouveaux tests `createImageMessage` + tous les tests existants inchangés).

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/messaging.service.ts backend/src/services/__tests__/messaging.service.test.ts
git commit -m "feat(dm): reencoder les photos DM via sharp (format reel, EXIF retire, plafond 2048px)"
```

---

### Task 5: Rate-limiting des chats (match:post, dm:post déjà branché, dm:newconv)

**Files:**
- Modify: `backend/src/services/openMatchChat.service.ts`
- Modify: `backend/src/services/__tests__/openMatchChat.service.test.ts`
- Modify: `backend/src/services/messaging.service.ts`
- Modify: `backend/src/services/__tests__/messaging.service.test.ts`

`dm:post`/`dm:image` sont déjà branchés dans `createImageMessage` (Task 4) ; il reste `postMessage` (DM texte), `match:post` (chat de partie) et `dm:newconv` (nouvelle conversation).

- [ ] **Step 1: `OpenMatchChatService.postMessage`**

Dans `backend/src/services/openMatchChat.service.ts`, ajouter l'import :
```ts
import { assertRateLimit } from './rateLimit';
```
Dans `postMessage`, remplacer :
```ts
  async postMessage(slug: string, reservationId: string, userId: string, rawBody: string): Promise<ChatMessageDTO> {
    await this.assertChatAccess(slug, reservationId, userId);
    const body = (rawBody ?? '').trim();
```
par :
```ts
  async postMessage(slug: string, reservationId: string, userId: string, rawBody: string): Promise<ChatMessageDTO> {
    await this.assertChatAccess(slug, reservationId, userId);
    await assertRateLimit('match:post', userId, 12, 60);
    const body = (rawBody ?? '').trim();
```

- [ ] **Step 2: `MessagingService.postMessage` (dm:post)**

Dans `backend/src/services/messaging.service.ts`, dans `postMessage`, remplacer :
```ts
    const { otherId } = await this.assertParticipant(conversationId, meId);
    await this.assertCanWrite(meId, otherId);
    const body = (rawBody ?? '').trim();
```
par :
```ts
    const { otherId } = await this.assertParticipant(conversationId, meId);
    await this.assertCanWrite(meId, otherId);
    await assertRateLimit('dm:post', meId, 12, 60);
    const body = (rawBody ?? '').trim();
```

- [ ] **Step 3: `MessagingService.getOrCreateConversation` (dm:newconv, compté SEULEMENT à la création réelle)**

Dans `getOrCreateConversation`, repérer le bloc :
```ts
    if (!conv) {
      const clubId = await this.sharedActiveClubId(meId, otherUserId, clubSlug);
      await this.assertNotBlocked(meId, otherUserId);
      try {
```
Remplacer par :
```ts
    if (!conv) {
      const clubId = await this.sharedActiveClubId(meId, otherUserId, clubSlug);
      await this.assertNotBlocked(meId, otherUserId);
      await assertRateLimit('dm:newconv', meId, 15, 3600);
      try {
```

- [ ] **Step 4: Lancer les tests existants (non-régression, sans mock redis particulier)**

Run (depuis `backend/`) :
```bash
npx jest src/services/__tests__/openMatchChat.service.test.ts src/services/__tests__/messaging.service.test.ts
```
Expected: tous PASS (le mock redis par défaut renvoie `undefined` pour `incr`, donc `count > max` est toujours `false` sans configuration explicite — comportement inchangé).

- [ ] **Step 5: Ajouter les tests de dépassement**

Dans `backend/src/services/__tests__/openMatchChat.service.test.ts`, ajouter en tête :
```ts
import '../../__mocks__/redis';
import { redisMock } from '../../__mocks__/redis';
```
Dans le describe `'postMessage'`, ajouter :
```ts
    it('au-delà de 12 messages/min → RATE_LIMITED', async () => {
      primeAccessOk();
      redisMock.incr.mockResolvedValue(13);
      await expect(service.postMessage('club-demo', 'resa-1', 'org', 'spam')).rejects.toThrow('RATE_LIMITED');
    });
```

Dans `backend/src/services/__tests__/messaging.service.test.ts`, ajouter en tête (à côté des autres imports) :
```ts
import { redisMock } from '../../__mocks__/redis';
```
(le mock lui-même est déjà chargé globalement via `setupFilesAfterEnv` dans `jest.config.ts` — pas besoin d'un second `import '../../__mocks__/redis'`.)

Dans le describe `'MessagingService — messages'`, ajouter :
```ts
  it('postMessage : au-delà de 12 messages/min → RATE_LIMITED', async () => {
    redisMock.incr.mockResolvedValue(13);
    await expect(service.postMessage('c1', 'u1', 'yo')).rejects.toThrow('RATE_LIMITED');
  });
```

Dans le describe `'MessagingService — getOrCreateConversation'`, ajouter :
```ts
  it('au-delà de 15 nouvelles conversations/h → RATE_LIMITED (compté SEULEMENT à la création)', async () => {
    prismaMock.conversation.findUnique.mockResolvedValue(null);
    redisMock.incr.mockResolvedValue(16);
    await expect(service.getOrCreateConversation('u1', 'u2')).rejects.toThrow('RATE_LIMITED');
  });

  it('la limite dm:newconv n est PAS vérifiée quand la conversation existe déjà (pas de create)', async () => {
    prismaMock.conversation.findUnique.mockResolvedValue({ id: 'c1', clubId: 'club-demo', lastMessageAt: null } as any);
    redisMock.incr.mockResolvedValue(16); // dépassé, mais ne doit jamais être appelé
    await expect(service.getOrCreateConversation('u1', 'u2')).resolves.toMatchObject({ id: 'c1' });
    expect(redisMock.incr).not.toHaveBeenCalled();
  });
```

- [ ] **Step 6: Lancer les tests**

Run (depuis `backend/`) :
```bash
npx jest src/services/__tests__/openMatchChat.service.test.ts src/services/__tests__/messaging.service.test.ts
```
Expected: tous PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/openMatchChat.service.ts backend/src/services/messaging.service.ts backend/src/services/__tests__/openMatchChat.service.test.ts backend/src/services/__tests__/messaging.service.test.ts
git commit -m "feat(chat): rate-limit Redis (chat de partie, DM, nouvelles conversations)"
```

---

### Task 6: Icône `flag` (bouton Signaler)

**Files:**
- Modify: `frontend/components/ui/Icon.tsx`

- [ ] **Step 1: Ajouter le nom et le glyphe**

Dans `frontend/components/ui/Icon.tsx`, dans le type `IconName`, remplacer la dernière ligne de l'union :
```ts
  | 'cup' | 'cart' | 'shower' | 'parking' | 'racket' | 'parasol' | 'wifi' | 'whistle' | 'camera';
```
par :
```ts
  | 'cup' | 'cart' | 'shower' | 'parking' | 'racket' | 'parasol' | 'wifi' | 'whistle' | 'camera' | 'flag';
```

Après le `case 'camera': ...; break;`, ajouter :
```ts
    case 'flag': glyph = <><path d="M5 3v18" {...p} /><path d="M5 4.5h13l-2.5 3.75L18 12H5" {...p} /></>; break;
```

- [ ] **Step 2: Type-check**

Run (depuis `frontend/`) :
```bash
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
```
Expected: pas de nouvelle erreur liée à `Icon.tsx` (le repo peut avoir des erreurs préexistantes ailleurs — vérifier qu'aucune ne mentionne `Icon.tsx`).

- [ ] **Step 3: Commit**

```bash
git add frontend/components/ui/Icon.tsx
git commit -m "feat(ui): icone flag (bouton Signaler)"
```

---

### Task 7: Builders d'email de signalement

**Files:**
- Modify: `backend/src/email/notifications.ts` (exporter `EMAIL_CLUB_SELECT`)
- Create: `backend/src/email/templates/moderation.ts`
- Create: `backend/src/email/__tests__/moderation-emails.test.ts`

- [ ] **Step 1: Exporter `EMAIL_CLUB_SELECT`**

Dans `backend/src/email/notifications.ts`, remplacer :
```ts
const EMAIL_CLUB_SELECT = {
```
par :
```ts
export const EMAIL_CLUB_SELECT = {
```

- [ ] **Step 2: Écrire le test (échoue — module inexistant)**

Créer `backend/src/email/__tests__/moderation-emails.test.ts` :
```ts
import { buildClubMessageReportEmail, buildPlatformMessageReportEmail } from '../templates/moderation';
import { PALOVA_BRAND, Brand } from '../templates/layout';

describe('buildClubMessageReportEmail', () => {
  const brand: Brand = { ...PALOVA_BRAND, name: 'Padel Arena Paris' };

  it('inclut auteur, terrain, date, extrait et lien vers la modération', () => {
    const mail = buildClubMessageReportEmail({
      authorName: 'Marie D.', excerpt: 'propos déplacés', court: 'Court 2',
      when: 'samedi 12 juillet 2026 à 18h00', url: 'https://demo.palova.fr/admin/moderation', brand,
    });
    expect(mail.subject).toContain('Padel Arena Paris');
    expect(mail.html).toContain('Marie D.');
    expect(mail.html).toContain('Court 2');
    expect(mail.html).toContain('propos déplacés');
    expect(mail.html).toContain('https://demo.palova.fr/admin/moderation');
    expect(mail.text).toContain('propos déplacés');
  });

  it('échappe le contenu dynamique', () => {
    const mail = buildClubMessageReportEmail({
      authorName: '<script>alert(1)</script>', excerpt: '<b>x</b>', court: 'Court 1',
      when: 'demain', url: 'https://x/admin/moderation', brand,
    });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).not.toContain('<b>x</b>');
  });
});

describe('buildPlatformMessageReportEmail', () => {
  it('signale la présence d une photo', () => {
    const mail = buildPlatformMessageReportEmail({
      authorName: 'Jean D.', excerpt: 'message signalé', hasImage: true,
      url: 'https://palova.fr/superadmin/moderation', brand: PALOVA_BRAND,
    });
    expect(mail.html).toContain('photo');
    expect(mail.text).toContain('photo');
  });

  it('sans photo, ne mentionne rien à ce sujet', () => {
    const mail = buildPlatformMessageReportEmail({
      authorName: 'Jean D.', excerpt: 'message signalé', hasImage: false,
      url: 'https://palova.fr/superadmin/moderation', brand: PALOVA_BRAND,
    });
    expect(mail.html).not.toContain('Il contient une photo');
  });
});
```

Run (depuis `backend/`) :
```bash
npx jest src/email/__tests__/moderation-emails.test.ts
```
Expected: FAIL — `Cannot find module '../templates/moderation'`.

- [ ] **Step 3: Implémenter les builders**

Créer `backend/src/email/templates/moderation.ts` :
```ts
import { Brand, escapeHtml, renderLayout } from './layout';

export interface BuiltEmail { subject: string; html: string; text: string }

export interface ClubMessageReportEmailInput {
  authorName: string;
  excerpt: string;
  court: string;
  when: string;
  url: string;
  brand: Brand;
}

/** Email au staff OWNER/ADMIN du club : un message du chat de partie a été signalé. */
export function buildClubMessageReportEmail(i: ClubMessageReportEmailInput): BuiltEmail {
  const subject = `Signalement d'un message — ${i.brand.name}`;
  const introHtml = `<p style="margin:0;">Un membre a signalé un message de <strong>${escapeHtml(i.authorName)}</strong> dans le chat d'une partie (${escapeHtml(i.court)}, ${escapeHtml(i.when)}).</p>`;
  const html = renderLayout({
    brand: i.brand,
    preheader: subject,
    heading: 'Nouveau signalement',
    introHtml,
    infoRows: [{ label: 'Extrait du message', value: i.excerpt }],
    ctaLabel: 'Voir les signalements',
    ctaUrl: i.url,
  });
  const text = [
    'Nouveau signalement',
    '',
    `${i.authorName} — ${i.court}, ${i.when}`,
    `Extrait : ${i.excerpt}`,
    '',
    `Voir les signalements : ${i.url}`,
  ].join('\n');
  return { subject, html, text };
}

export interface PlatformMessageReportEmailInput {
  authorName: string;
  excerpt: string;
  hasImage: boolean;
  url: string;
  brand: Brand;
}

/** Email aux superadmins plateforme : un message privé (DM) a été signalé. */
export function buildPlatformMessageReportEmail(i: PlatformMessageReportEmailInput): BuiltEmail {
  const subject = "Signalement d'un message privé";
  const introHtml = `<p style="margin:0;">Un message privé de <strong>${escapeHtml(i.authorName)}</strong> a été signalé.${i.hasImage ? ' Il contient une photo.' : ''}</p>`;
  const html = renderLayout({
    brand: i.brand,
    preheader: subject,
    heading: 'Nouveau signalement',
    introHtml,
    infoRows: [{ label: 'Extrait du message', value: i.excerpt }],
    ctaLabel: 'Voir les signalements',
    ctaUrl: i.url,
  });
  const text = [
    'Nouveau signalement (messagerie privée)',
    '',
    `Auteur : ${i.authorName}`,
    `Extrait : ${i.excerpt}`,
    i.hasImage ? 'Contient une photo.' : '',
    '',
    `Voir les signalements : ${i.url}`,
  ].filter(Boolean).join('\n');
  return { subject, html, text };
}
```

- [ ] **Step 4: Vérifier**

Run (depuis `backend/`) :
```bash
npx jest src/email/__tests__/moderation-emails.test.ts
```
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/src/email/templates/moderation.ts backend/src/email/__tests__/moderation-emails.test.ts backend/src/email/notifications.ts
git commit -m "feat(moderation): emails de signalement (staff club, superadmin)"
```

---

### Task 8: `ModerationService`

**Files:**
- Modify: `backend/src/services/messaging.service.ts` (2 méthodes réservées au modérateur)
- Modify: `backend/src/services/__tests__/messaging.service.test.ts`
- Create: `backend/src/services/moderation.service.ts`
- Create: `backend/src/services/__tests__/moderation.service.test.ts`

- [ ] **Step 1: Ajouter `deleteMessageAsModerator` et `imagePathForModerator` à `MessagingService`**

Dans `backend/src/services/messaging.service.ts`, après la méthode `imagePathFor` (juste avant `/** Supprime un message : AUTEUR SEUL...`), insérer :
```ts
  /** Chemin absolu + mime d'une image de DM, pour un MODÉRATEUR superadmin (pas de garde
   *  participant — il n'est jamais membre de la conversation). Réutilise la regex anti-traversée. */
  async imagePathForModerator(messageId: string): Promise<{ absPath: string; mime: string }> {
    const msg = await prisma.directMessage.findUnique({
      where: { id: messageId },
      select: { imageUrl: true, deletedAt: true },
    });
    if (!msg || msg.deletedAt || !msg.imageUrl) throw new Error('MESSAGE_NOT_FOUND');
    if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9.-]+$/.test(msg.imageUrl)) throw new Error('MESSAGE_NOT_FOUND');
    const ext = msg.imageUrl.split('.').pop()!.toLowerCase();
    const mime = ext === 'jpg' ? 'image/jpeg' : ext === 'png' ? 'image/png' : 'image/webp';
    return { absPath: path.join(DM_DIR, msg.imageUrl), mime };
  }

```
Après la méthode `deleteMessage` (juste avant `/** Suppression best-effort du fichier photo...`), insérer :
```ts
  /** Suppression par le SUPERADMIN plateforme (résolution d'un signalement) : pas de garde
   *  participant ni auteur — réservée à ModerationService après vérification du signalement. */
  async deleteMessageAsModerator(conversationId: string, messageId: string, moderatorUserId: string): Promise<DmMessageDTO> {
    const msg = await prisma.directMessage.findUnique({ where: { id: messageId }, select: MSG_SELECT });
    if (!msg || (msg as { conversationId?: string }).conversationId !== undefined) { /* select ne porte pas conversationId */ }
    const raw = await prisma.directMessage.findUnique({
      where: { id: messageId },
      select: { ...MSG_SELECT, conversationId: true },
    });
    if (!raw || raw.conversationId !== conversationId) throw new Error('MESSAGE_NOT_FOUND');
    if (raw.deletedAt) return toMessageDTO(raw);
    const updated = await prisma.directMessage.update({
      where: { id: messageId },
      data: { deletedAt: new Date(), deletedById: moderatorUserId },
      select: MSG_SELECT,
    });
    if (raw.imageUrl) this.unlinkImage(raw.imageUrl);
    const dto = toMessageDTO(updated);
    SSEService.getInstance().broadcastConversation(conversationId, { type: 'dm_deleted', message: dto });
    return dto;
  }
```

⚠️ Le bloc `if (!msg || ...) { /* ... */ }` ci-dessus est un résidu de brouillon à NE PAS coller : la première recherche `msg` (select `MSG_SELECT` seul, sans `conversationId`) est inutile. Écrire directement la version propre :
```ts
  /** Suppression par le SUPERADMIN plateforme (résolution d'un signalement) : pas de garde
   *  participant ni auteur — réservée à ModerationService après vérification du signalement. */
  async deleteMessageAsModerator(conversationId: string, messageId: string, moderatorUserId: string): Promise<DmMessageDTO> {
    const msg = await prisma.directMessage.findUnique({
      where: { id: messageId },
      select: { ...MSG_SELECT, conversationId: true },
    });
    if (!msg || msg.conversationId !== conversationId) throw new Error('MESSAGE_NOT_FOUND');
    if (msg.deletedAt) return toMessageDTO(msg);
    const updated = await prisma.directMessage.update({
      where: { id: messageId },
      data: { deletedAt: new Date(), deletedById: moderatorUserId },
      select: MSG_SELECT,
    });
    if (msg.imageUrl) this.unlinkImage(msg.imageUrl);
    const dto = toMessageDTO(updated);
    SSEService.getInstance().broadcastConversation(conversationId, { type: 'dm_deleted', message: dto });
    return dto;
  }
```

- [ ] **Step 2: Tester ces 2 méthodes dans `messaging.service.test.ts`**

Dans le describe `'MessagingService — messages'`, après le bloc `deleteMessage`, ajouter :
```ts
  describe('deleteMessageAsModerator / imagePathForModerator', () => {
    it('deleteMessageAsModerator : tombstone sans garde auteur/participant, unlink photo', async () => {
      prismaMock.directMessage.findUnique.mockResolvedValue({
        ...MSG_ROW('m7', 'u2', 'msg', { imageUrl: 'c1/x.jpg' }), conversationId: 'c1',
      } as any);
      prismaMock.directMessage.update.mockResolvedValue(MSG_ROW('m7', 'u2', 'msg', { deletedAt: new Date() }) as any);
      const dto = await service.deleteMessageAsModerator('c1', 'm7', 'super-1');
      expect(dto.deleted).toBe(true);
      expect(broadcast).toHaveBeenCalledWith('c1', { type: 'dm_deleted', message: expect.objectContaining({ id: 'm7' }) });
    });

    it('deleteMessageAsModerator : déjà supprimé → idempotent, pas de re-broadcast', async () => {
      prismaMock.directMessage.findUnique.mockResolvedValue({
        ...MSG_ROW('m7', 'u2', 'msg', { deletedAt: new Date() }), conversationId: 'c1',
      } as any);
      const dto = await service.deleteMessageAsModerator('c1', 'm7', 'super-1');
      expect(dto.deleted).toBe(true);
      expect(prismaMock.directMessage.update).not.toHaveBeenCalled();
      expect(broadcast).not.toHaveBeenCalled();
    });

    it('deleteMessageAsModerator : message d une autre conversation → MESSAGE_NOT_FOUND', async () => {
      prismaMock.directMessage.findUnique.mockResolvedValue({ ...MSG_ROW('m7', 'u2', 'msg'), conversationId: 'cX' } as any);
      await expect(service.deleteMessageAsModerator('c1', 'm7', 'super-1')).rejects.toThrow('MESSAGE_NOT_FOUND');
    });

    it('imagePathForModerator : chemin + mime sans garde participant', async () => {
      prismaMock.directMessage.findUnique.mockResolvedValue({ imageUrl: 'c1/photo.png', deletedAt: null } as any);
      const r = await service.imagePathForModerator('m7');
      expect(r.mime).toBe('image/png');
      expect(r.absPath).toContain('c1');
      expect(r.absPath).toContain('photo.png');
    });

    it('imagePathForModerator : message supprimé ou sans image → MESSAGE_NOT_FOUND', async () => {
      prismaMock.directMessage.findUnique.mockResolvedValue({ imageUrl: null, deletedAt: null } as any);
      await expect(service.imagePathForModerator('m7')).rejects.toThrow('MESSAGE_NOT_FOUND');
    });
  });
```

Run (depuis `backend/`) :
```bash
npx jest src/services/__tests__/messaging.service.test.ts
```
Expected: tous PASS.

- [ ] **Step 3: Commit intermédiaire**

```bash
git add backend/src/services/messaging.service.ts backend/src/services/__tests__/messaging.service.test.ts
git commit -m "feat(dm): methodes de suppression/lecture reservees au moderateur superadmin"
```

- [ ] **Step 4: Écrire le test de `ModerationService` (échoue — module inexistant)**

Créer `backend/src/services/__tests__/moderation.service.test.ts` :
```ts
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import '../../__mocks__/redis';

const mockSendMail = jest.fn().mockResolvedValue(undefined);
jest.mock('../../email/mailer', () => ({ sendMail: (...a: unknown[]) => mockSendMail(...a) }));

import { ModerationService } from '../moderation.service';

const CLUB = { id: 'club-1', name: 'Padel Arena', slug: 'padel-arena', logoUrl: null, accentColor: '#000', timezone: 'Europe/Paris', address: null, city: null, contactPhone: null, contactEmail: null };

describe('ModerationService — reportOpenMatchMessage', () => {
  let service: ModerationService;
  beforeEach(() => {
    service = new ModerationService();
    mockSendMail.mockClear();
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-1', status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);
    prismaMock.reservation.findUnique.mockResolvedValue({
      visibility: 'PUBLIC', status: 'CONFIRMED',
      resource: { clubId: 'club-1' },
      participants: [{ userId: 'org', isOrganizer: true }],
    } as any);
    prismaMock.openMatchMessage.findUnique.mockResolvedValue({
      id: 'm1', reservationId: 'resa-1', userId: 'author-1', deletedAt: null,
    } as any);
  });

  it('crée le signalement et notifie le staff par email', async () => {
    prismaMock.messageReport.create.mockResolvedValue({ id: 'rep-1' } as any);
    prismaMock.openMatchMessage.findUnique
      .mockResolvedValueOnce({ id: 'm1', reservationId: 'resa-1', userId: 'author-1', deletedAt: null } as any)
      .mockResolvedValueOnce({
        body: 'propos', user: { firstName: 'A', lastName: 'B' },
        reservation: { startTime: new Date('2026-07-14T18:00:00Z'), resource: { name: 'Court 1' } },
      } as any);
    prismaMock.club.findUnique.mockResolvedValueOnce({ id: 'club-1', status: 'ACTIVE' } as any).mockResolvedValueOnce(CLUB as any);
    prismaMock.clubMember.findMany.mockResolvedValue([{ user: { email: 'owner@x.fr' } }] as any);

    const r = await service.reportOpenMatchMessage('club-demo', 'resa-1', 'm1', 'reporter-1', { reason: 'SPAM', detail: 'gênant' });
    expect(r.id).toBe('rep-1');
    expect(prismaMock.messageReport.create).toHaveBeenCalledWith({
      data: { openMatchMessageId: 'm1', reporterId: 'reporter-1', clubId: 'club-1', reason: 'SPAM', detail: 'gênant' },
    });
    await new Promise((r2) => setImmediate(r2)); // laisse le .catch best-effort se résoudre
    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'owner@x.fr' }));
  });

  it('auto-signalement refusé → VALIDATION_ERROR', async () => {
    await expect(
      service.reportOpenMatchMessage('club-demo', 'resa-1', 'm1', 'author-1', { reason: 'SPAM', detail: null }),
    ).rejects.toThrow('VALIDATION_ERROR');
  });

  it('message d une autre résa ou supprimé → MESSAGE_NOT_FOUND', async () => {
    prismaMock.openMatchMessage.findUnique.mockResolvedValue({ id: 'm1', reservationId: 'resa-X', userId: 'author-1', deletedAt: null } as any);
    await expect(
      service.reportOpenMatchMessage('club-demo', 'resa-1', 'm1', 'reporter-1', { reason: 'SPAM', detail: null }),
    ).rejects.toThrow('MESSAGE_NOT_FOUND');
  });

  it('motif invalide → VALIDATION_ERROR', async () => {
    await expect(
      service.reportOpenMatchMessage('club-demo', 'resa-1', 'm1', 'reporter-1', { reason: 'NAWAK', detail: null }),
    ).rejects.toThrow('VALIDATION_ERROR');
  });

  it('détail > 500 caractères → VALIDATION_ERROR', async () => {
    await expect(
      service.reportOpenMatchMessage('club-demo', 'resa-1', 'm1', 'reporter-1', { reason: 'SPAM', detail: 'x'.repeat(501) }),
    ).rejects.toThrow('VALIDATION_ERROR');
  });

  it('non-membre du club → refusé par la garde d accès (RESERVATION_NOT_FOUND)', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue({
      visibility: 'PUBLIC', status: 'CONFIRMED', resource: { clubId: 'club-AUTRE' }, participants: [],
    } as any);
    await expect(
      service.reportOpenMatchMessage('club-demo', 'resa-1', 'm1', 'reporter-1', { reason: 'SPAM', detail: null }),
    ).rejects.toThrow('RESERVATION_NOT_FOUND');
  });

  it('doublon (P2002) → idempotent, renvoie le signalement existant', async () => {
    prismaMock.messageReport.create.mockRejectedValue({ code: 'P2002' });
    prismaMock.messageReport.findUniqueOrThrow.mockResolvedValue({ id: 'rep-existant' } as any);
    const r = await service.reportOpenMatchMessage('club-demo', 'resa-1', 'm1', 'reporter-1', { reason: 'SPAM', detail: null });
    expect(r.id).toBe('rep-existant');
  });
});

describe('ModerationService — resolveClubReport', () => {
  let service: ModerationService;
  beforeEach(() => {
    service = new ModerationService();
  });

  it('DELETE : tombstone le message via OpenMatchChatService, clôt tous les OPEN du même message', async () => {
    prismaMock.messageReport.findUnique.mockResolvedValue({ id: 'rep-1', clubId: 'club-1', openMatchMessageId: 'm1', status: 'OPEN' } as any);
    prismaMock.messageReport.updateMany.mockResolvedValue({ count: 2 } as any);
    prismaMock.openMatchMessage.findUnique.mockResolvedValue({ reservationId: 'resa-1', deletedAt: null } as any);
    prismaMock.club.findUnique.mockResolvedValue({ slug: 'padel-arena' } as any);
    // deleteMessage() interne d'OpenMatchChatService va relire club/resa/message — le mock générique suffit :
    prismaMock.reservation.findUnique.mockResolvedValue({
      resource: { clubId: 'club-1' }, participants: [{ userId: 'org', isOrganizer: true }],
    } as any);
    prismaMock.openMatchMessage.findUnique
      .mockResolvedValueOnce({ reservationId: 'resa-1', deletedAt: null } as any) // 1er appel : lookup du message rapporté
      .mockResolvedValueOnce({
        id: 'm1', reservationId: 'resa-1', userId: 'author-1', deletedAt: null,
        user: { id: 'author-1', firstName: 'A', lastName: 'B', avatarUrl: null },
      } as any); // 2e appel : dans OpenMatchChatService.deleteMessage
    prismaMock.openMatchMessage.update.mockResolvedValue({
      id: 'm1', body: 'x', createdAt: new Date(), deletedAt: new Date(),
      user: { id: 'author-1', firstName: 'A', lastName: 'B', avatarUrl: null },
    } as any);
    prismaMock.messageReport.findUniqueOrThrow.mockResolvedValue({
      id: 'rep-1', reason: 'SPAM', detail: null, status: 'RESOLVED', resolution: 'DELETED',
      createdAt: new Date(), resolvedAt: new Date(),
      reporter: { id: 'r1', firstName: 'R', lastName: 'P' },
      openMatchMessage: {
        id: 'm1', body: 'x', createdAt: new Date(), deletedAt: new Date(), reservationId: 'resa-1',
        user: { id: 'author-1', firstName: 'A', lastName: 'B' },
        reservation: { startTime: new Date(), resource: { name: 'Court 1' } },
      },
    } as any);

    const row = await service.resolveClubReport('club-1', 'rep-1', 'mod-1', 'DELETE');
    expect(row.status).toBe('RESOLVED');
    expect(prismaMock.messageReport.updateMany).toHaveBeenCalledWith({
      where: { openMatchMessageId: 'm1', status: 'OPEN' },
      data: { status: 'RESOLVED', resolution: 'DELETED', resolvedById: 'mod-1', resolvedAt: expect.any(Date) },
    });
  });

  it('REJECT : ne touche pas au message', async () => {
    prismaMock.messageReport.findUnique.mockResolvedValue({ id: 'rep-1', clubId: 'club-1', openMatchMessageId: 'm1', status: 'OPEN' } as any);
    prismaMock.messageReport.updateMany.mockResolvedValue({ count: 1 } as any);
    prismaMock.messageReport.findUniqueOrThrow.mockResolvedValue({
      id: 'rep-1', reason: 'SPAM', detail: null, status: 'RESOLVED', resolution: 'REJECTED',
      createdAt: new Date(), resolvedAt: new Date(),
      reporter: { id: 'r1', firstName: 'R', lastName: 'P' },
      openMatchMessage: {
        id: 'm1', body: 'x', createdAt: new Date(), deletedAt: null, reservationId: 'resa-1',
        user: { id: 'author-1', firstName: 'A', lastName: 'B' },
        reservation: { startTime: new Date(), resource: { name: 'Court 1' } },
      },
    } as any);

    const row = await service.resolveClubReport('club-1', 'rep-1', 'mod-1', 'REJECT');
    expect(row.resolution).toBe('REJECTED');
    expect(prismaMock.openMatchMessage.update).not.toHaveBeenCalled();
  });

  it('report d un AUTRE club → REPORT_NOT_FOUND', async () => {
    prismaMock.messageReport.findUnique.mockResolvedValue({ id: 'rep-1', clubId: 'club-AUTRE', openMatchMessageId: 'm1', status: 'OPEN' } as any);
    await expect(service.resolveClubReport('club-1', 'rep-1', 'mod-1', 'REJECT')).rejects.toThrow('REPORT_NOT_FOUND');
  });

  it('déjà RESOLVED → idempotent, ne relance pas updateMany', async () => {
    prismaMock.messageReport.findUnique.mockResolvedValue({ id: 'rep-1', clubId: 'club-1', openMatchMessageId: 'm1', status: 'RESOLVED' } as any);
    prismaMock.messageReport.findUniqueOrThrow.mockResolvedValue({
      id: 'rep-1', reason: 'SPAM', detail: null, status: 'RESOLVED', resolution: 'REJECTED',
      createdAt: new Date(), resolvedAt: new Date(),
      reporter: { id: 'r1', firstName: 'R', lastName: 'P' },
      openMatchMessage: {
        id: 'm1', body: 'x', createdAt: new Date(), deletedAt: null, reservationId: 'resa-1',
        user: { id: 'author-1', firstName: 'A', lastName: 'B' },
        reservation: { startTime: new Date(), resource: { name: 'Court 1' } },
      },
    } as any);
    const row = await service.resolveClubReport('club-1', 'rep-1', 'mod-1', 'DELETE');
    expect(row.status).toBe('RESOLVED');
    expect(prismaMock.messageReport.updateMany).not.toHaveBeenCalled();
  });
});

describe('ModerationService — reportDirectMessage / platform', () => {
  let service: ModerationService;
  beforeEach(() => {
    service = new ModerationService();
    mockSendMail.mockClear();
    prismaMock.conversation.findUnique.mockResolvedValue({
      id: 'c1', clubId: 'club-1', userAId: 'reporter-1', userBId: 'author-1',
      participants: [{ userId: 'reporter-1', lastReadAt: null, user: {} }, { userId: 'author-1', lastReadAt: null, user: {} }],
    } as any);
    prismaMock.directMessage.findUnique.mockResolvedValue({
      id: 'dm1', conversationId: 'c1', authorId: 'author-1', deletedAt: null,
    } as any);
  });

  it('crée le signalement DM et notifie les superadmins', async () => {
    prismaMock.messageReport.create.mockResolvedValue({ id: 'rep-2' } as any);
    prismaMock.directMessage.findUnique
      .mockResolvedValueOnce({ id: 'dm1', conversationId: 'c1', authorId: 'author-1', deletedAt: null } as any)
      .mockResolvedValueOnce({ body: 'message', imageUrl: null, author: { firstName: 'A', lastName: 'B' } } as any);
    prismaMock.user.findMany.mockResolvedValue([{ email: 'super@palova.fr' }] as any);

    const r = await service.reportDirectMessage('c1', 'dm1', 'reporter-1', { reason: 'HARASSMENT', detail: null });
    expect(r.id).toBe('rep-2');
    await new Promise((r2) => setImmediate(r2));
    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'super@palova.fr' }));
  });

  it('tiers non-participant → CONVERSATION_NOT_FOUND', async () => {
    prismaMock.conversation.findUnique.mockResolvedValue({
      id: 'c1', clubId: 'club-1', userAId: 'author-1', userBId: 'other',
      participants: [],
    } as any);
    await expect(
      service.reportDirectMessage('c1', 'dm1', 'reporter-1', { reason: 'SPAM', detail: null }),
    ).rejects.toThrow('CONVERSATION_NOT_FOUND');
  });

  it('auto-signalement refusé → VALIDATION_ERROR', async () => {
    await expect(
      service.reportDirectMessage('c1', 'dm1', 'author-1', { reason: 'SPAM', detail: null }),
    ).rejects.toThrow('VALIDATION_ERROR');
  });

  it('resolvePlatformReport DELETE : tombstone via MessagingService.deleteMessageAsModerator', async () => {
    prismaMock.messageReport.findUnique.mockResolvedValue({ id: 'rep-2', directMessageId: 'dm1', status: 'OPEN' } as any);
    prismaMock.messageReport.updateMany.mockResolvedValue({ count: 1 } as any);
    prismaMock.directMessage.findUnique
      .mockResolvedValueOnce({ conversationId: 'c1', deletedAt: null } as any) // lookup pour connaître la conversation
      .mockResolvedValueOnce({ // dans deleteMessageAsModerator
        id: 'dm1', body: 'msg', imageUrl: null, createdAt: new Date(), deletedAt: null,
        author: { id: 'author-1', firstName: 'A', lastName: 'B', avatarUrl: null },
        reactions: [], conversationId: 'c1',
      } as any);
    prismaMock.directMessage.update.mockResolvedValue({
      id: 'dm1', body: 'msg', imageUrl: null, createdAt: new Date(), deletedAt: new Date(),
      author: { id: 'author-1', firstName: 'A', lastName: 'B', avatarUrl: null }, reactions: [],
    } as any);
    prismaMock.messageReport.findUniqueOrThrow.mockResolvedValue({
      id: 'rep-2', reason: 'SPAM', detail: null, status: 'RESOLVED', resolution: 'DELETED',
      createdAt: new Date(), resolvedAt: new Date(),
      reporter: { id: 'r1', firstName: 'R', lastName: 'P' },
      directMessage: {
        id: 'dm1', body: 'msg', imageUrl: null, createdAt: new Date(), deletedAt: new Date(), conversationId: 'c1',
        author: { id: 'author-1', firstName: 'A', lastName: 'B' },
      },
    } as any);

    const row = await service.resolvePlatformReport('rep-2', 'super-1', 'DELETE');
    expect(row.status).toBe('RESOLVED');
    expect(row.message.deleted).toBe(true);
  });

  it('platformReportImagePath : anti-traversée déjà couverte par imagePathForModerator', async () => {
    prismaMock.messageReport.findUnique.mockResolvedValue({ directMessageId: 'dm1' } as any);
    prismaMock.directMessage.findUnique.mockResolvedValue({ imageUrl: '../../etc/passwd', deletedAt: null } as any);
    await expect(service.platformReportImagePath('rep-2')).rejects.toThrow('MESSAGE_NOT_FOUND');
  });
});
```

Run (depuis `backend/`) :
```bash
npx jest src/services/__tests__/moderation.service.test.ts
```
Expected: FAIL — `Cannot find module '../moderation.service'`.

- [ ] **Step 5: Implémenter `ModerationService`**

Créer `backend/src/services/moderation.service.ts` :
```ts
import { ClubRole, ReportReason, ReportResolution, ReportStatus } from '@prisma/client';
import { prisma } from '../db/prisma';
import { OpenMatchChatService } from './openMatchChat.service';
import { MessagingService } from './messaging.service';
import { assertRateLimit } from './rateLimit';
import { sendMail } from '../email/mailer';
import { brandFromClub } from '../email/registry';
import { PALOVA_BRAND } from '../email/templates/layout';
import { clubAppUrl, formatDateFr, platformAsset } from '../email/links';
import { buildClubMessageReportEmail, buildPlatformMessageReportEmail } from '../email/templates/moderation';
import { EMAIL_CLUB_SELECT } from '../email/notifications';

const openMatchChatService = new OpenMatchChatService();
const messagingService = new MessagingService();

const REASONS = new Set<ReportReason>(['HARASSMENT', 'ILLEGAL', 'SPAM', 'OTHER']);

function normalizeReason(v: unknown): ReportReason {
  if (typeof v !== 'string' || !REASONS.has(v as ReportReason)) throw new Error('VALIDATION_ERROR');
  return v as ReportReason;
}

function normalizeDetail(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v !== 'string') throw new Error('VALIDATION_ERROR');
  const trimmed = v.trim();
  if (trimmed.length > 500) throw new Error('VALIDATION_ERROR');
  return trimmed || null;
}

function normalizeStatusFilter(v?: string): ReportStatus | undefined {
  return v === 'OPEN' || v === 'RESOLVED' ? v : undefined;
}

function excerptOf(body: string): string {
  return body.length > 280 ? body.slice(0, 277) + '…' : body;
}

export interface ReportedByDTO { id: string; firstName: string; lastName: string }

export interface ClubReportRow {
  id: string; reason: ReportReason; detail: string | null; status: ReportStatus; resolution: ReportResolution | null;
  createdAt: string; resolvedAt: string | null;
  reporter: ReportedByDTO;
  message: { id: string; body: string; deleted: boolean; createdAt: string; author: ReportedByDTO };
  match: { reservationId: string; startTime: string; resourceName: string };
}

export interface PlatformReportRow {
  id: string; reason: ReportReason; detail: string | null; status: ReportStatus; resolution: ReportResolution | null;
  createdAt: string; resolvedAt: string | null;
  reporter: ReportedByDTO;
  message: { id: string; body: string; deleted: boolean; createdAt: string; author: ReportedByDTO; hasImage: boolean };
  conversationId: string;
}

const CLUB_REPORT_INCLUDE = {
  reporter: { select: { id: true, firstName: true, lastName: true } },
  openMatchMessage: {
    select: {
      id: true, body: true, createdAt: true, deletedAt: true, reservationId: true,
      user: { select: { id: true, firstName: true, lastName: true } },
      reservation: { select: { startTime: true, resource: { select: { name: true } } } },
    },
  },
} as const;

type ClubReportSrc = {
  id: string; reason: ReportReason; detail: string | null; status: ReportStatus; resolution: ReportResolution | null;
  createdAt: Date; resolvedAt: Date | null;
  reporter: { id: string; firstName: string; lastName: string };
  openMatchMessage: {
    id: string; body: string; createdAt: Date; deletedAt: Date | null; reservationId: string;
    user: { id: string; firstName: string; lastName: string };
    reservation: { startTime: Date; resource: { name: string } };
  } | null;
};

function toClubReportRow(r: ClubReportSrc): ClubReportRow {
  const m = r.openMatchMessage!;
  return {
    id: r.id, reason: r.reason, detail: r.detail, status: r.status, resolution: r.resolution,
    createdAt: r.createdAt.toISOString(), resolvedAt: r.resolvedAt?.toISOString() ?? null,
    reporter: r.reporter,
    message: { id: m.id, body: m.deletedAt ? '' : m.body, deleted: m.deletedAt != null, createdAt: m.createdAt.toISOString(), author: m.user },
    match: { reservationId: m.reservationId, startTime: m.reservation.startTime.toISOString(), resourceName: m.reservation.resource.name },
  };
}

const PLATFORM_REPORT_INCLUDE = {
  reporter: { select: { id: true, firstName: true, lastName: true } },
  directMessage: {
    select: {
      id: true, body: true, imageUrl: true, createdAt: true, deletedAt: true, conversationId: true,
      author: { select: { id: true, firstName: true, lastName: true } },
    },
  },
} as const;

type PlatformReportSrc = {
  id: string; reason: ReportReason; detail: string | null; status: ReportStatus; resolution: ReportResolution | null;
  createdAt: Date; resolvedAt: Date | null;
  reporter: { id: string; firstName: string; lastName: string };
  directMessage: {
    id: string; body: string; imageUrl: string | null; createdAt: Date; deletedAt: Date | null; conversationId: string;
    author: { id: string; firstName: string; lastName: string };
  } | null;
};

function toPlatformReportRow(r: PlatformReportSrc): PlatformReportRow {
  const m = r.directMessage!;
  return {
    id: r.id, reason: r.reason, detail: r.detail, status: r.status, resolution: r.resolution,
    createdAt: r.createdAt.toISOString(), resolvedAt: r.resolvedAt?.toISOString() ?? null,
    reporter: r.reporter,
    message: {
      id: m.id, body: m.deletedAt ? '' : m.body, deleted: m.deletedAt != null, createdAt: m.createdAt.toISOString(),
      author: m.author, hasImage: !m.deletedAt && !!m.imageUrl,
    },
    conversationId: m.conversationId,
  };
}

export class ModerationService {
  // ---------------------------------------------------------- Chat de partie ouverte

  async reportOpenMatchMessage(
    slug: string, reservationId: string, messageId: string, reporterId: string,
    input: { reason: unknown; detail: unknown },
  ): Promise<{ id: string }> {
    await openMatchChatService.assertChatAccessPublic(slug, reservationId, reporterId);
    await assertRateLimit('report', reporterId, 10, 3600);

    const msg = await prisma.openMatchMessage.findUnique({
      where: { id: messageId },
      select: { id: true, reservationId: true, userId: true, deletedAt: true },
    });
    if (!msg || msg.reservationId !== reservationId || msg.deletedAt) throw new Error('MESSAGE_NOT_FOUND');
    if (msg.userId === reporterId) throw new Error('VALIDATION_ERROR');

    const reason = normalizeReason(input.reason);
    const detail = normalizeDetail(input.detail);

    const resa = await prisma.reservation.findUnique({ where: { id: reservationId }, select: { resource: { select: { clubId: true } } } });
    const clubId = resa!.resource.clubId;

    let report: { id: string };
    try {
      report = await prisma.messageReport.create({ data: { openMatchMessageId: messageId, reporterId, clubId, reason, detail } });
    } catch (err) {
      if ((err as { code?: string }).code !== 'P2002') throw err;
      report = await prisma.messageReport.findUniqueOrThrow({
        where: { openMatchMessageId_reporterId: { openMatchMessageId: messageId, reporterId } },
      });
    }
    this.notifyClubStaff(clubId, messageId).catch((e) => console.error('[moderation] notification club échouée', e));
    return { id: report.id };
  }

  private async notifyClubStaff(clubId: string, messageId: string): Promise<void> {
    const msg = await prisma.openMatchMessage.findUnique({
      where: { id: messageId },
      select: {
        body: true, user: { select: { firstName: true, lastName: true } },
        reservation: { select: { startTime: true, resource: { select: { name: true } } } },
      },
    });
    if (!msg) return;
    const club = await prisma.club.findUnique({ where: { id: clubId }, select: EMAIL_CLUB_SELECT });
    if (!club) return;
    const staff = await prisma.clubMember.findMany({
      where: { clubId, role: { in: [ClubRole.OWNER, ClubRole.ADMIN] } },
      select: { user: { select: { email: true } } },
    });
    const emails = staff.map((s) => s.user.email).filter((e): e is string => !!e);
    if (!emails.length) return;
    const brand = brandFromClub(club);
    const mail = buildClubMessageReportEmail({
      authorName: `${msg.user.firstName} ${msg.user.lastName}`.trim(),
      excerpt: excerptOf(msg.body),
      court: msg.reservation.resource.name,
      when: formatDateFr(msg.reservation.startTime, club.timezone),
      url: clubAppUrl(club.slug, '/admin/moderation'),
      brand,
    });
    for (const to of emails) await sendMail({ to, subject: mail.subject, html: mail.html, text: mail.text });
  }

  async listClubReports(clubId: string, opts: { status?: string } = {}): Promise<ClubReportRow[]> {
    const status = normalizeStatusFilter(opts.status);
    const rows = await prisma.messageReport.findMany({
      where: { clubId, openMatchMessageId: { not: null }, ...(status ? { status } : {}) },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: CLUB_REPORT_INCLUDE,
    });
    return rows.map((r) => toClubReportRow(r as ClubReportSrc));
  }

  private async fetchClubReport(reportId: string): Promise<ClubReportRow> {
    const r = await prisma.messageReport.findUniqueOrThrow({ where: { id: reportId }, include: CLUB_REPORT_INCLUDE });
    return toClubReportRow(r as ClubReportSrc);
  }

  async resolveClubReport(clubId: string, reportId: string, moderatorUserId: string, action: 'DELETE' | 'REJECT'): Promise<ClubReportRow> {
    const report = await prisma.messageReport.findUnique({
      where: { id: reportId },
      select: { id: true, clubId: true, openMatchMessageId: true, status: true },
    });
    if (!report || report.clubId !== clubId || !report.openMatchMessageId) throw new Error('REPORT_NOT_FOUND');

    if (report.status !== 'RESOLVED') {
      const resolution: ReportResolution = action === 'DELETE' ? 'DELETED' : 'REJECTED';
      await prisma.messageReport.updateMany({
        where: { openMatchMessageId: report.openMatchMessageId, status: 'OPEN' },
        data: { status: 'RESOLVED', resolution, resolvedById: moderatorUserId, resolvedAt: new Date() },
      });
      if (action === 'DELETE') {
        const msg = await prisma.openMatchMessage.findUnique({
          where: { id: report.openMatchMessageId },
          select: { reservationId: true, deletedAt: true },
        });
        if (msg && !msg.deletedAt) {
          const club = await prisma.club.findUnique({ where: { id: clubId }, select: { slug: true } });
          if (club) await openMatchChatService.deleteMessage(club.slug, msg.reservationId, moderatorUserId, report.openMatchMessageId);
        }
      }
    }
    return this.fetchClubReport(reportId);
  }

  // ---------------------------------------------------------- Messagerie privée

  async reportDirectMessage(
    conversationId: string, messageId: string, reporterId: string,
    input: { reason: unknown; detail: unknown },
  ): Promise<{ id: string }> {
    await messagingService.assertParticipantPublic(conversationId, reporterId);
    await assertRateLimit('report', reporterId, 10, 3600);

    const msg = await prisma.directMessage.findUnique({
      where: { id: messageId },
      select: { id: true, conversationId: true, authorId: true, deletedAt: true },
    });
    if (!msg || msg.conversationId !== conversationId || msg.deletedAt) throw new Error('MESSAGE_NOT_FOUND');
    if (msg.authorId === reporterId) throw new Error('VALIDATION_ERROR');

    const reason = normalizeReason(input.reason);
    const detail = normalizeDetail(input.detail);

    const conv = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { clubId: true } });

    let report: { id: string };
    try {
      report = await prisma.messageReport.create({ data: { directMessageId: messageId, reporterId, clubId: conv?.clubId ?? null, reason, detail } });
    } catch (err) {
      if ((err as { code?: string }).code !== 'P2002') throw err;
      report = await prisma.messageReport.findUniqueOrThrow({
        where: { directMessageId_reporterId: { directMessageId: messageId, reporterId } },
      });
    }
    this.notifySuperAdmins(messageId).catch((e) => console.error('[moderation] notification superadmin échouée', e));
    return { id: report.id };
  }

  private async notifySuperAdmins(messageId: string): Promise<void> {
    const msg = await prisma.directMessage.findUnique({
      where: { id: messageId },
      select: { body: true, imageUrl: true, author: { select: { firstName: true, lastName: true } } },
    });
    if (!msg) return;
    const admins = await prisma.user.findMany({ where: { isSuperAdmin: true, deletedAt: null }, select: { email: true } });
    const emails = admins.map((a) => a.email).filter((e): e is string => !!e);
    if (!emails.length) return;
    const mail = buildPlatformMessageReportEmail({
      authorName: `${msg.author.firstName} ${msg.author.lastName}`.trim(),
      excerpt: excerptOf(msg.body),
      hasImage: !!msg.imageUrl,
      url: platformAsset('/superadmin/moderation'),
      brand: PALOVA_BRAND,
    });
    for (const to of emails) await sendMail({ to, subject: mail.subject, html: mail.html, text: mail.text });
  }

  async listPlatformReports(opts: { status?: string } = {}): Promise<PlatformReportRow[]> {
    const status = normalizeStatusFilter(opts.status);
    const rows = await prisma.messageReport.findMany({
      where: { directMessageId: { not: null }, ...(status ? { status } : {}) },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: PLATFORM_REPORT_INCLUDE,
    });
    return rows.map((r) => toPlatformReportRow(r as PlatformReportSrc));
  }

  private async fetchPlatformReport(reportId: string): Promise<PlatformReportRow> {
    const r = await prisma.messageReport.findUniqueOrThrow({ where: { id: reportId }, include: PLATFORM_REPORT_INCLUDE });
    return toPlatformReportRow(r as PlatformReportSrc);
  }

  async resolvePlatformReport(reportId: string, superAdminUserId: string, action: 'DELETE' | 'REJECT'): Promise<PlatformReportRow> {
    const report = await prisma.messageReport.findUnique({
      where: { id: reportId },
      select: { id: true, directMessageId: true, status: true },
    });
    if (!report || !report.directMessageId) throw new Error('REPORT_NOT_FOUND');

    if (report.status !== 'RESOLVED') {
      const resolution: ReportResolution = action === 'DELETE' ? 'DELETED' : 'REJECTED';
      await prisma.messageReport.updateMany({
        where: { directMessageId: report.directMessageId, status: 'OPEN' },
        data: { status: 'RESOLVED', resolution, resolvedById: superAdminUserId, resolvedAt: new Date() },
      });
      if (action === 'DELETE') {
        const msg = await prisma.directMessage.findUnique({ where: { id: report.directMessageId }, select: { conversationId: true, deletedAt: true } });
        if (msg && !msg.deletedAt) await messagingService.deleteMessageAsModerator(msg.conversationId, report.directMessageId, superAdminUserId);
      }
    }
    return this.fetchPlatformReport(reportId);
  }

  async platformReportImagePath(reportId: string): Promise<{ absPath: string; mime: string }> {
    const report = await prisma.messageReport.findUnique({ where: { id: reportId }, select: { directMessageId: true } });
    if (!report?.directMessageId) throw new Error('MESSAGE_NOT_FOUND');
    return messagingService.imagePathForModerator(report.directMessageId);
  }
}
```

- [ ] **Step 6: Lancer les tests**

Run (depuis `backend/`) :
```bash
npx jest src/services/__tests__/moderation.service.test.ts
```
Expected: tous PASS. Si un mock de séquence (`mockResolvedValueOnce`) ne matche pas l'ordre réel des appels Prisma, ajuster l'ordre des `.mockResolvedValueOnce()` pour refléter l'ordre RÉEL des requêtes dans le code (pas l'inverse) — c'est le signe le plus fiable d'un vrai bug d'ordering vs un test mal calé.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/moderation.service.ts backend/src/services/__tests__/moderation.service.test.ts
git commit -m "feat(moderation): ModerationService (signalement + resolution club/superadmin)"
```

---

### Task 9: Routes de création de signalement

**Files:**
- Modify: `backend/src/routes/clubs.ts`
- Modify: `backend/src/routes/conversations.ts`
- Modify: `backend/src/routes/__tests__/clubs.openmatch-chat.routes.test.ts`
- Modify: `backend/src/routes/__tests__/conversations.routes.test.ts`

- [ ] **Step 1: Route club (chat de partie)**

Dans `backend/src/routes/clubs.ts`, ajouter l'import :
```ts
import { ModerationService } from '../services/moderation.service';
```
et l'instance, à côté de `const openMatchChatService = new OpenMatchChatService();` :
```ts
const moderationService = new ModerationService();
```
Dans `ERROR_STATUS`, ajouter :
```ts
  RATE_LIMITED:          429,
```

Après la route `router.delete('/:slug/open-matches/:id/chat/messages/:messageId', ...)`, ajouter :
```ts
// Signalement d'un message du chat (DSA/LCEN) — jamais son propre message, dédup par signaleur.
router.post('/:slug/open-matches/:id/chat/messages/:messageId/report', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = req.body as { reason?: unknown; detail?: unknown };
    const r = await moderationService.reportOpenMatchMessage(
      asString(req.params.slug), asString(req.params.id), asString(req.params.messageId), req.user!.id,
      { reason: body.reason, detail: typeof body.detail === 'string' ? body.detail : null },
    );
    res.json(r);
  } catch (err) { handleError(err, res, next); }
});
```

- [ ] **Step 2: Route DM**

Dans `backend/src/routes/conversations.ts`, ajouter l'import :
```ts
import { ModerationService } from '../services/moderation.service';
```
et l'instance :
```ts
const moderationService = new ModerationService();
```
Dans `ERROR_STATUS`, ajouter :
```ts
  RATE_LIMITED: 429,
```
Après la route `conversationsRouter.delete('/:id/messages/:messageId/reactions', ...)`, ajouter :
```ts
conversationsRouter.post('/:id/messages/:messageId/report', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = req.body as { reason?: unknown; detail?: unknown };
    const r = await moderationService.reportDirectMessage(
      asString(req.params.id), asString(req.params.messageId), req.user!.id,
      { reason: body.reason, detail: typeof body.detail === 'string' ? body.detail : null },
    );
    res.json(r);
  } catch (err) { handleError(err, res, next); }
});
```

- [ ] **Step 3: Tests — route club**

Dans `backend/src/routes/__tests__/clubs.openmatch-chat.routes.test.ts`, repérer le mock du service (probablement `jest.mock('../../services/openMatchChat.service', ...)`) et le describe `DELETE .../chat/messages/:messageId`. Ajouter un mock du `ModerationService` juste après le mock d'`OpenMatchChatService` :
```ts
const reportImpl = jest.fn();
jest.mock('../../services/moderation.service', () => ({
  ModerationService: jest.fn().mockImplementation(() => ({
    reportOpenMatchMessage: (...a: any[]) => reportImpl(...a),
  })),
}));
```
Dans le `beforeEach` global du fichier, ajouter :
```ts
  reportImpl.mockReset().mockResolvedValue({ id: 'rep-1' });
```
Ajouter un nouveau describe à la fin du fichier :
```ts
describe('POST /api/clubs/:slug/open-matches/:id/chat/messages/:messageId/report', () => {
  it('401 sans token', async () => {
    const res = await request(app).post('/api/clubs/club-demo/open-matches/resa-1/chat/messages/m1/report').send({ reason: 'SPAM' });
    expect(res.status).toBe(401);
  });

  it('200 avec un token valide', async () => {
    const res = await request(app).post('/api/clubs/club-demo/open-matches/resa-1/chat/messages/m1/report')
      .set(auth).send({ reason: 'SPAM', detail: 'gênant' });
    expect(res.status).toBe(200);
    expect(reportImpl).toHaveBeenCalledWith('club-demo', 'resa-1', 'm1', 'u1', { reason: 'SPAM', detail: 'gênant' });
  });

  it('429 quand le service lève RATE_LIMITED', async () => {
    reportImpl.mockRejectedValue(new Error('RATE_LIMITED'));
    const res = await request(app).post('/api/clubs/club-demo/open-matches/resa-1/chat/messages/m1/report').set(auth).send({ reason: 'SPAM' });
    expect(res.status).toBe(429);
  });

  it('400 quand le service lève VALIDATION_ERROR', async () => {
    reportImpl.mockRejectedValue(new Error('VALIDATION_ERROR'));
    const res = await request(app).post('/api/clubs/club-demo/open-matches/resa-1/chat/messages/m1/report').set(auth).send({ reason: 'NAWAK' });
    expect(res.status).toBe(400);
  });
});
```
⚠️ Vérifier le nom exact de la variable `auth` (header Authorization avec token) déjà utilisée plus haut dans ce fichier de test — la réutiliser telle quelle, ne pas la redéfinir.

- [ ] **Step 4: Tests — route DM**

Dans `backend/src/routes/__tests__/conversations.routes.test.ts`, appliquer le même principe : mock `ModerationService.reportDirectMessage`, ajouter un describe `POST /:id/messages/:messageId/report` avec les cas 401/200/429/400 (copier le style du describe existant `POST /:id/messages/:messageId/reactions` pour l'auth/le token).

- [ ] **Step 5: Lancer les tests**

Run (depuis `backend/`) :
```bash
npx jest src/routes/__tests__/clubs.openmatch-chat.routes.test.ts src/routes/__tests__/conversations.routes.test.ts
```
Expected: tous PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/clubs.ts backend/src/routes/conversations.ts backend/src/routes/__tests__/clubs.openmatch-chat.routes.test.ts backend/src/routes/__tests__/conversations.routes.test.ts
git commit -m "feat(moderation): routes de signalement (chat de partie + DM)"
```

---

### Task 10: Routes admin club — liste + résolution des signalements

**Files:**
- Modify: `backend/src/routes/admin.ts`
- Create: `backend/src/routes/__tests__/admin.moderation.routes.test.ts`

- [ ] **Step 1: Ajouter les routes**

Dans `backend/src/routes/admin.ts`, ajouter l'import :
```ts
import { ModerationService } from '../services/moderation.service';
```
et l'instance, à côté des autres services :
```ts
const moderationService = new ModerationService();
```
Dans `ERROR_STATUS`, ajouter :
```ts
  REPORT_NOT_FOUND:      404,
```
Après le bloc `--- Page club (présentation + galerie) ---` (ou en fin de fichier, avant `export default router;`), ajouter :
```ts
// --- Modération (signalements du chat de partie) ---

router.get('/moderation/reports', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const items = await moderationService.listClubReports(req.membership!.clubId, { status });
    res.json({ items });
  } catch (err) { handleError(err, res, next); }
});

router.post('/moderation/reports/:reportId/resolve', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const action = (req.body as { action?: unknown })?.action;
    if (action !== 'DELETE' && action !== 'REJECT') return void res.status(400).json({ error: 'VALIDATION_ERROR' });
    res.json(await moderationService.resolveClubReport(req.membership!.clubId, asString(req.params.reportId), req.user!.id, action));
  } catch (err) { handleError(err, res, next); }
});
```

- [ ] **Step 2: Écrire les tests**

Créer `backend/src/routes/__tests__/admin.moderation.routes.test.ts` (calqué sur `admin.emails.routes.test.ts`) :
```ts
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const listImpl = jest.fn();
const resolveImpl = jest.fn();
jest.mock('../../services/moderation.service', () => ({
  ModerationService: jest.fn().mockImplementation(() => ({
    listClubReports: (...a: any[]) => listImpl(...a),
    resolveClubReport: (...a: any[]) => resolveImpl(...a),
  })),
}));

import app from '../../app';

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET manquant');
const auth = { Authorization: `Bearer ${jwt.sign({ id: 'u1', email: 'owner@x.fr' }, process.env.JWT_SECRET!)}` };
const base = '/api/clubs/club-demo/admin/moderation/reports';

beforeEach(() => {
  prismaMock.clubMember.findUnique.mockResolvedValue({ userId: 'u1', clubId: 'club-demo', role: 'ADMIN' } as any);
  listImpl.mockReset().mockResolvedValue([{ id: 'rep-1', status: 'OPEN' }]);
  resolveImpl.mockReset().mockResolvedValue({ id: 'rep-1', status: 'RESOLVED', resolution: 'DELETED' });
});

describe('GET /moderation/reports', () => {
  it('401 sans token', async () => {
    expect((await request(app).get(base)).status).toBe(401);
  });
  it('403 pour STAFF (réservé ADMIN+)', async () => {
    prismaMock.clubMember.findUnique.mockResolvedValue({ userId: 'u1', clubId: 'club-demo', role: 'STAFF' } as any);
    const res = await request(app).get(base).set(auth);
    expect(res.status).toBe(403);
  });
  it('200 items pour ADMIN', async () => {
    const res = await request(app).get(base).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(listImpl).toHaveBeenCalledWith('club-demo', { status: undefined });
  });
  it('transmet ?status= au service', async () => {
    await request(app).get(`${base}?status=OPEN`).set(auth);
    expect(listImpl).toHaveBeenCalledWith('club-demo', { status: 'OPEN' });
  });
});

describe('POST /moderation/reports/:reportId/resolve', () => {
  it('200 avec action DELETE', async () => {
    const res = await request(app).post(`${base}/rep-1/resolve`).set(auth).send({ action: 'DELETE' });
    expect(res.status).toBe(200);
    expect(resolveImpl).toHaveBeenCalledWith('club-demo', 'rep-1', 'u1', 'DELETE');
  });
  it('400 si action invalide', async () => {
    const res = await request(app).post(`${base}/rep-1/resolve`).set(auth).send({ action: 'NAWAK' });
    expect(res.status).toBe(400);
    expect(resolveImpl).not.toHaveBeenCalled();
  });
  it('404 REPORT_NOT_FOUND', async () => {
    resolveImpl.mockRejectedValue(new Error('REPORT_NOT_FOUND'));
    const res = await request(app).post(`${base}/rep-1/resolve`).set(auth).send({ action: 'REJECT' });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 3: Lancer les tests**

Run (depuis `backend/`) :
```bash
npx jest src/routes/__tests__/admin.moderation.routes.test.ts
```
Expected: 7 passed.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/admin.ts backend/src/routes/__tests__/admin.moderation.routes.test.ts
git commit -m "feat(moderation): routes admin club (liste + resolution des signalements)"
```

---

### Task 11: Routes superadmin — liste + résolution + image des signalements DM

**Files:**
- Modify: `backend/src/routes/platform.ts`
- Create: `backend/src/routes/__tests__/platform.moderation.routes.test.ts`

- [ ] **Step 1: Ajouter les routes**

Dans `backend/src/routes/platform.ts`, ajouter l'import :
```ts
import { ModerationService } from '../services/moderation.service';
```
et l'instance :
```ts
const moderationService = new ModerationService();
```
Dans `ERROR_STATUS`, ajouter :
```ts
  REPORT_NOT_FOUND: 404,
```
Avant `export default router;`, ajouter :
```ts
// --- Modération (signalements de messagerie privée — jamais le chat de partie, réservé au staff club) ---

router.get('/moderation/reports', async (req, res, next) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const items = await moderationService.listPlatformReports({ status });
    res.json({ items });
  } catch (err) { handleError(err, res, next); }
});

router.post('/moderation/reports/:reportId/resolve', async (req: AuthRequest, res, next) => {
  try {
    const action = (req.body as { action?: unknown })?.action;
    if (action !== 'DELETE' && action !== 'REJECT') return void res.status(400).json({ error: 'VALIDATION_ERROR' });
    res.json(await moderationService.resolvePlatformReport(req.params.reportId, req.user!.id, action));
  } catch (err) { handleError(err, res, next); }
});

router.get('/moderation/reports/:id/image', async (req, res) => {
  try {
    const { absPath, mime } = await moderationService.platformReportImagePath(req.params.id);
    res.sendFile(absPath, { dotfiles: 'allow', headers: { 'Content-Type': mime, 'Cache-Control': 'private, max-age=60' } });
  } catch { res.status(404).end(); }
});
```

Ajouter également l'import du type de requête authentifiée en tête de fichier (nécessaire pour `req.user!.id`) :
```ts
import { AuthRequest } from '../middleware/auth';
```

- [ ] **Step 2: Écrire les tests**

Créer `backend/src/routes/__tests__/platform.moderation.routes.test.ts` (calqué sur `platform.billing.routes.test.ts`) :
```ts
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const listImpl = jest.fn();
const resolveImpl = jest.fn();
const imagePathImpl = jest.fn();
jest.mock('../../services/moderation.service', () => ({
  ModerationService: jest.fn().mockImplementation(() => ({
    listPlatformReports: (...a: any[]) => listImpl(...a),
    resolvePlatformReport: (...a: any[]) => resolveImpl(...a),
    platformReportImagePath: (...a: any[]) => imagePathImpl(...a),
  })),
}));

import app from '../../app';

const SECRET = process.env.JWT_SECRET!;
if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET manquant');
const tokenFor = (id: string) => jwt.sign({ id, email: `${id}@x.fr` }, SECRET, { expiresIn: '1h' });
const superToken = tokenFor('super-1');

beforeEach(() => {
  jest.clearAllMocks();
  listImpl.mockReset().mockResolvedValue([{ id: 'rep-1', status: 'OPEN' }]);
  resolveImpl.mockReset().mockResolvedValue({ id: 'rep-1', status: 'RESOLVED' });
  imagePathImpl.mockReset().mockResolvedValue({ absPath: '/tmp/x.jpg', mime: 'image/jpeg' });
});

describe('GET /api/platform/moderation/reports', () => {
  it('401 sans token', async () => {
    expect((await request(app).get('/api/platform/moderation/reports')).status).toBe(401);
  });
  it('403 non super-admin', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ isSuperAdmin: false } as any);
    const res = await request(app).get('/api/platform/moderation/reports').set('Authorization', `Bearer ${tokenFor('u1')}`);
    expect(res.status).toBe(403);
  });
  it('200 pour un super-admin', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ isSuperAdmin: true } as any);
    const res = await request(app).get('/api/platform/moderation/reports').set('Authorization', `Bearer ${superToken}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });
});

describe('POST /api/platform/moderation/reports/:reportId/resolve', () => {
  it('200 avec action REJECT', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ isSuperAdmin: true } as any);
    const res = await request(app).post('/api/platform/moderation/reports/rep-1/resolve')
      .set('Authorization', `Bearer ${superToken}`).send({ action: 'REJECT' });
    expect(res.status).toBe(200);
    expect(resolveImpl).toHaveBeenCalledWith('rep-1', 'super-1', 'REJECT');
  });
  it('400 action invalide', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ isSuperAdmin: true } as any);
    const res = await request(app).post('/api/platform/moderation/reports/rep-1/resolve')
      .set('Authorization', `Bearer ${superToken}`).send({ action: 'X' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/platform/moderation/reports/:id/image', () => {
  it('401 sans token', async () => {
    expect((await request(app).get('/api/platform/moderation/reports/rep-1/image')).status).toBe(401);
  });
  it('404 si le service lève', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ isSuperAdmin: true } as any);
    imagePathImpl.mockRejectedValue(new Error('MESSAGE_NOT_FOUND'));
    const res = await request(app).get('/api/platform/moderation/reports/rep-1/image').set('Authorization', `Bearer ${superToken}`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 3: Lancer les tests**

Run (depuis `backend/`) :
```bash
npx jest src/routes/__tests__/platform.moderation.routes.test.ts
```
Expected: 7 passed.

- [ ] **Step 4: Lancer toute la suite backend (non-régression globale)**

Run (depuis `backend/`) :
```bash
npx jest
```
Expected: PASS (0 failure attribuable à ce travail — un flake pré-existant éventuel doit être vérifié isolément avant d'être ignoré).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/platform.ts backend/src/routes/__tests__/platform.moderation.routes.test.ts
git commit -m "feat(moderation): routes superadmin (liste + resolution + image des signalements DM)"
```

---

### Task 12: Frontend — types & méthodes API

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Types**

Dans `frontend/lib/api.ts`, ajouter (à proximité des types `DmMessage`/`ConversationSummary`, repérer avec `grep -n "export interface DmMessage" frontend/lib/api.ts`) :
```ts
export type ReportReason = 'HARASSMENT' | 'ILLEGAL' | 'SPAM' | 'OTHER';
export type ReportStatus = 'OPEN' | 'RESOLVED';
export type ReportResolution = 'DELETED' | 'REJECTED';

export interface MessageReportRow {
  id: string;
  reason: ReportReason;
  detail: string | null;
  status: ReportStatus;
  resolution: ReportResolution | null;
  createdAt: string;
  resolvedAt: string | null;
  reporter: { id: string; firstName: string; lastName: string };
  message: {
    id: string; body: string; deleted: boolean; createdAt: string;
    author: { id: string; firstName: string; lastName: string };
    hasImage?: boolean;
  };
  match?: { reservationId: string; startTime: string; resourceName: string };
  conversationId?: string;
}
```

- [ ] **Step 2: Méthodes**

Ajouter dans `export const api = { ... }`, à côté de `deleteChatMessage` :
```ts
  reportChatMessage: (slug: string, id: string, messageId: string, reason: ReportReason, detail: string | null, token: string) =>
    request<{ id: string }>(`/api/clubs/${slug}/open-matches/${id}/chat/messages/${messageId}/report`,
      { method: 'POST', body: JSON.stringify({ reason, detail }) }, token),
```
et, à côté de `deleteDmMessage` :
```ts
  reportDmMessage: (conversationId: string, messageId: string, reason: ReportReason, detail: string | null, token: string) =>
    request<{ id: string }>(`/api/conversations/${conversationId}/messages/${messageId}/report`,
      { method: 'POST', body: JSON.stringify({ reason, detail }) }, token),
```
et, dans la section back-office club (`adminGetClub` etc.), ajouter :
```ts
  adminListReports: (clubId: string, token: string, status?: ReportStatus) =>
    request<{ items: MessageReportRow[] }>(`/api/clubs/${clubId}/admin/moderation/reports${status ? `?status=${status}` : ''}`, {}, token),
  adminResolveReport: (clubId: string, reportId: string, action: 'DELETE' | 'REJECT', token: string) =>
    request<MessageReportRow>(`/api/clubs/${clubId}/admin/moderation/reports/${reportId}/resolve`,
      { method: 'POST', body: JSON.stringify({ action }) }, token),
```
et, dans la section plateforme (à côté de `platformStats`/`listNationalTournaments`), ajouter :
```ts
  platformListReports: (token: string, status?: ReportStatus) =>
    request<{ items: MessageReportRow[] }>(`/api/platform/moderation/reports${status ? `?status=${status}` : ''}`, {}, token),
  platformResolveReport: (reportId: string, action: 'DELETE' | 'REJECT', token: string) =>
    request<MessageReportRow>(`/api/platform/moderation/reports/${reportId}/resolve`,
      { method: 'POST', body: JSON.stringify({ action }) }, token),
  platformReportImage: async (reportId: string, token: string): Promise<Blob> => {
    const res = await fetch(`${BASE_URL}/api/platform/moderation/reports/${reportId}/image`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.blob();
  },
```

- [ ] **Step 3: Type-check**

Run (depuis `frontend/`) :
```bash
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
```
Expected: aucune nouvelle erreur dans `lib/api.ts`.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(moderation): types et methodes API signalement (front)"
```

---

### Task 13: `ReportDialog` (composant partagé)

**Files:**
- Create: `frontend/components/moderation/ReportDialog.tsx`
- Create: `frontend/__tests__/ReportDialog.test.tsx`

- [ ] **Step 1: Écrire le test (échoue — composant inexistant)**

Créer `frontend/__tests__/ReportDialog.test.tsx` :
```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReportDialog } from '@/components/moderation/ReportDialog';
import { ThemeProvider } from '@/lib/ThemeProvider';

function renderDialog(onSubmit = jest.fn().mockResolvedValue(undefined), onCancel = jest.fn()) {
  render(<ThemeProvider><ReportDialog onSubmit={onSubmit} onCancel={onCancel} /></ThemeProvider>);
  return { onSubmit, onCancel };
}

it('affiche les 4 motifs, Harcèlement pré-sélectionné', () => {
  renderDialog();
  expect(screen.getByRole('radio', { name: /harcèlement/i })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('radio', { name: /contenu illicite/i })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: /spam/i })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: /autre/i })).toBeInTheDocument();
});

it('envoie le motif choisi + détail, affiche la confirmation', async () => {
  const { onSubmit } = renderDialog();
  fireEvent.click(screen.getByRole('radio', { name: /spam/i }));
  fireEvent.change(screen.getByPlaceholderText(/précisions/i), { target: { value: 'répétitif' } });
  fireEvent.click(screen.getByRole('button', { name: /envoyer le signalement/i }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('SPAM', 'répétitif'));
  expect(await screen.findByText(/signalement envoyé/i)).toBeInTheDocument();
});

it('re-signaler (idempotent côté serveur) affiche quand même la confirmation', async () => {
  const onSubmit = jest.fn().mockResolvedValue(undefined);
  renderDialog(onSubmit);
  fireEvent.click(screen.getByRole('button', { name: /envoyer le signalement/i }));
  expect(await screen.findByText(/signalement envoyé/i)).toBeInTheDocument();
});

it('échec réseau → message d erreur, reste sur le formulaire', async () => {
  const onSubmit = jest.fn().mockRejectedValue(new Error('RATE_LIMITED'));
  renderDialog(onSubmit);
  fireEvent.click(screen.getByRole('button', { name: /envoyer le signalement/i }));
  expect(await screen.findByText(/trop de signalements|réessayez/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /envoyer le signalement/i })).toBeInTheDocument();
});

it('Annuler appelle onCancel', () => {
  const { onCancel } = renderDialog();
  fireEvent.click(screen.getByRole('button', { name: /annuler/i }));
  expect(onCancel).toHaveBeenCalled();
});
```

Run (depuis `frontend/`) :
```bash
node node_modules/jest/bin/jest.js ReportDialog.test.tsx
```
Expected: FAIL — module introuvable.

- [ ] **Step 2: Implémenter `ReportDialog`**

Créer `frontend/components/moderation/ReportDialog.tsx` :
```tsx
'use client';
import { useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { Btn } from '@/components/ui/atoms';
import { ReportReason } from '@/lib/api';

const REASONS: { value: ReportReason; label: string }[] = [
  { value: 'HARASSMENT', label: 'Harcèlement' },
  { value: 'ILLEGAL', label: 'Contenu illicite' },
  { value: 'SPAM', label: 'Spam' },
  { value: 'OTHER', label: 'Autre' },
];

export function ReportDialog({ onSubmit, onCancel }: {
  onSubmit: (reason: ReportReason, detail: string) => Promise<void>;
  onCancel: () => void;
}) {
  const { th } = useTheme();
  const [reason, setReason] = useState<ReportReason>('HARASSMENT');
  const [detail, setDetail] = useState('');
  const [phase, setPhase] = useState<'form' | 'sending' | 'sent'>('form');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setPhase('sending'); setError(null);
    try {
      await onSubmit(reason, detail.trim());
      setPhase('sent');
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg === 'RATE_LIMITED' ? 'Trop de signalements, réessayez plus tard.' : 'Échec de l\'envoi, réessayez.');
      setPhase('form');
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 96, display: 'flex', flexDirection: 'column', justifyContent: 'flex-start' }}>
      <div onClick={phase === 'sending' ? undefined : onCancel} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)' }} />
      <div role="dialog" aria-modal="true" aria-label="Signaler ce message" style={{ position: 'relative', width: '100%', maxWidth: 460, margin: '0 auto', background: th.bgElev, borderRadius: '0 0 24px 24px', padding: '20px 20px 28px', boxShadow: '0 10px 40px rgba(0,0,0,0.3)' }}>
        {phase === 'sent' ? (
          <>
            <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 22, color: th.text }}>Signalement envoyé</div>
            <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, marginTop: 8 }}>
              Merci, il sera examiné rapidement.
            </div>
            <Btn variant="surface" onClick={onCancel} style={{ marginTop: 20, width: '100%' }}>Fermer</Btn>
          </>
        ) : (
          <>
            <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 22, color: th.text }}>Signaler ce message</div>
            <div role="radiogroup" aria-label="Motif" style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 14 }}>
              {REASONS.map((r) => (
                <button key={r.value} type="button" role="radio" aria-checked={reason === r.value}
                  onClick={() => setReason(r.value)}
                  style={{
                    textAlign: 'left', border: `1px solid ${reason === r.value ? th.accent : th.line}`,
                    background: reason === r.value ? `${th.accent}1a` : th.surface, borderRadius: 12,
                    padding: '10px 14px', fontFamily: th.fontUI, fontSize: 14, color: th.text, cursor: 'pointer',
                  }}>
                  {r.label}
                </button>
              ))}
            </div>
            <textarea value={detail} onChange={(e) => setDetail(e.target.value.slice(0, 500))}
              placeholder="Précisions (optionnel)" rows={3}
              style={{ width: '100%', marginTop: 12, border: `1px solid ${th.line}`, borderRadius: 12, padding: '10px 12px', resize: 'vertical', fontFamily: th.fontUI, fontSize: 14, background: th.surface, color: th.text }} />
            {error && <div style={{ marginTop: 8, fontFamily: th.fontUI, fontSize: 12.5, color: '#e0554f' }}>{error}</div>}
            <div style={{ display: 'flex', gap: 11, marginTop: 18 }}>
              <Btn variant="surface" onClick={onCancel} disabled={phase === 'sending'} style={{ flex: '0 0 42%' }}>Annuler</Btn>
              <Btn variant="danger" onClick={submit} disabled={phase === 'sending'} style={{ flex: 1 }}>
                {phase === 'sending' ? '…' : 'Envoyer le signalement'}
              </Btn>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Vérifier**

Run (depuis `frontend/`) :
```bash
node node_modules/jest/bin/jest.js ReportDialog.test.tsx
```
Expected: 5 passed.

Run :
```bash
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
```
Expected: aucune nouvelle erreur.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/moderation/ReportDialog.tsx frontend/__tests__/ReportDialog.test.tsx
git commit -m "feat(moderation): composant ReportDialog partage"
```

---

### Task 14: Câblage — `OpenMatchChatSheet` (bouton Signaler + erreur rate-limit)

**Files:**
- Modify: `frontend/components/openmatch/OpenMatchChatSheet.tsx`
- Modify: `frontend/__tests__/OpenMatchChatSheet.test.tsx`

- [ ] **Step 1: Câbler le composant**

Dans `frontend/components/openmatch/OpenMatchChatSheet.tsx`, ajouter les imports :
```ts
import { ReportDialog } from '@/components/moderation/ReportDialog';
import { ReportReason } from '@/lib/api';
```
Ajouter l'état, à côté de `pendingDelete` :
```ts
  const [reportTarget, setReportTarget] = useState<OpenMatchMessage | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
```
Dans `send`, remplacer :
```ts
  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true); setDraft('');
    try { upsert(await api.postChatMessage(slug, reservationId, body, token)); }
    catch { setDraft(body); }
    finally { setSending(false); }
  };
```
par :
```ts
  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true); setDraft(''); setSendError(null);
    try { upsert(await api.postChatMessage(slug, reservationId, body, token)); }
    catch (err) {
      setDraft(body);
      if ((err as Error).message === 'RATE_LIMITED') setSendError('Vous envoyez trop de messages, patientez un instant.');
    }
    finally { setSending(false); }
  };
```

Dans le rendu de chaque message, repérer :
```tsx
                  {canDelete(m) && (
                    <button type="button" onClick={() => setPendingDelete(m)}
                      style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textFaint, fontFamily: th.fontUI, fontSize: 11.5, marginTop: 2, padding: 0, textAlign: mine ? 'right' : 'left', width: '100%' }}>
                      Supprimer
                    </button>
                  )}
```
Remplacer par :
```tsx
                  {(canDelete(m) || (!m.deleted && !mine)) && (
                    <div style={{ display: 'flex', gap: 10, justifyContent: mine ? 'flex-end' : 'flex-start', marginTop: 2 }}>
                      {canDelete(m) && (
                        <button type="button" onClick={() => setPendingDelete(m)}
                          style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textFaint, fontFamily: th.fontUI, fontSize: 11.5, padding: 0 }}>
                          Supprimer
                        </button>
                      )}
                      {!m.deleted && !mine && (
                        <button type="button" onClick={() => setReportTarget(m)}
                          style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textFaint, fontFamily: th.fontUI, fontSize: 11.5, padding: 0 }}>
                          Signaler
                        </button>
                      )}
                    </div>
                  )}
```

Juste avant la barre de saisie (repérer `<div style={{ position: 'relative', borderTop: ...`), ajouter l'affichage de l'erreur :
```tsx
        {sendError && (
          <div style={{ padding: '6px 16px 0', fontFamily: th.fontUI, fontSize: 12.5, color: '#e0554f' }}>{sendError}</div>
        )}
```

À la fin du composant, juste avant la fermeture du `pendingDelete && <ConfirmDialog ... />`, ajouter :
```tsx
      {reportTarget && (
        <ReportDialog
          onCancel={() => setReportTarget(null)}
          onSubmit={async (reason: ReportReason, detail: string) => {
            await api.reportChatMessage(slug, reservationId, reportTarget.id, reason, detail || null, token);
          }}
        />
      )}
```

- [ ] **Step 2: Ajouter les tests**

Dans `frontend/__tests__/OpenMatchChatSheet.test.tsx`, ajouter `reportChatMessage: jest.fn().mockResolvedValue({ id: 'rep-1' })` dans l'objet `api` mocké. Puis, à la fin du fichier :
```ts
it('affiche « Signaler » sur le message d un autre, pas sur le sien', async () => {
  renderSheet();
  await screen.findByText('salut'); // message de u2 (Bob)
  expect(screen.getByRole('button', { name: /signaler/i })).toBeInTheDocument();
});

it('signale un message : ouvre ReportDialog, envoie le motif, confirme', async () => {
  renderSheet();
  await screen.findByText('salut');
  fireEvent.click(screen.getByRole('button', { name: /signaler/i }));
  fireEvent.click(screen.getByRole('button', { name: /envoyer le signalement/i }));
  await waitFor(() => expect(require('@/lib/api').api.reportChatMessage).toHaveBeenCalledWith('demo', 'resa1', 'm1', 'HARASSMENT', null, 't'));
  expect(await screen.findByText(/signalement envoyé/i)).toBeInTheDocument();
});

it('RATE_LIMITED à l envoi affiche un message inline', async () => {
  const { api } = require('@/lib/api');
  api.postChatMessage.mockRejectedValueOnce(new Error('RATE_LIMITED'));
  renderSheet();
  await screen.findByText('salut');
  fireEvent.change(screen.getByPlaceholderText(/message/i), { target: { value: 'trop vite' } });
  fireEvent.click(screen.getByRole('button', { name: /envoyer/i }));
  expect(await screen.findByText(/trop de messages/i)).toBeInTheDocument();
});
```

- [ ] **Step 3: Lancer les tests**

Run (depuis `frontend/`) :
```bash
node node_modules/jest/bin/jest.js OpenMatchChatSheet.test.tsx
```
Expected: tous PASS (5 anciens + 3 nouveaux).

- [ ] **Step 4: Vérifier tsc + commit**

Run :
```bash
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
```
```bash
git add frontend/components/openmatch/OpenMatchChatSheet.tsx frontend/__tests__/OpenMatchChatSheet.test.tsx
git commit -m "feat(moderation): bouton Signaler + erreur rate-limit dans le chat de partie"
```

---

### Task 15: Câblage — `MessageThread` (bouton Signaler + bandeau NOT_CO_MEMBERS + erreur rate-limit)

**Files:**
- Modify: `frontend/components/messages/MessageThread.tsx`
- Modify: `frontend/__tests__/MessageThread.test.tsx`

- [ ] **Step 1: Câbler le composant**

Dans `frontend/components/messages/MessageThread.tsx`, ajouter les imports :
```ts
import { ReportDialog } from '@/components/moderation/ReportDialog';
```
(`ReportReason` est déjà potentiellement importé via `DmMessage` — sinon ajouter `ReportReason` à l'import existant de `@/lib/api`.)

Ajouter l'état, à côté de `pendingDelete`/`lightbox` :
```ts
  const [reportTarget, setReportTarget] = useState<DmMessage | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [writeBlocked, setWriteBlocked] = useState(false);
```

Remplacer `send`/`sendImage` :
```ts
  const send = async (body: string) => {
    try { upsert(await api.postDmMessage(conversationId, body, token)); return true; }
    catch { return false; }
  };
  const sendImage = async (file: File, caption: string) => {
    try { upsert(await api.uploadDmImage(conversationId, file, caption, token)); return true; }
    catch { return false; }
  };
```
par :
```ts
  const handleSendError = (err: unknown) => {
    const msg = (err as Error).message;
    if (msg === 'NOT_CO_MEMBERS') setWriteBlocked(true);
    else if (msg === 'RATE_LIMITED') setSendError('Vous envoyez trop de messages, patientez un instant.');
  };
  const send = async (body: string) => {
    setSendError(null);
    try { upsert(await api.postDmMessage(conversationId, body, token)); return true; }
    catch (err) { handleSendError(err); return false; }
  };
  const sendImage = async (file: File, caption: string) => {
    setSendError(null);
    try { upsert(await api.uploadDmImage(conversationId, file, caption, token)); return true; }
    catch (err) { handleSendError(err); return false; }
  };
```

Dans le rendu de chaque message, repérer :
```tsx
                      {mine && (
                        <button type="button" onClick={() => setPendingDelete(m)}
                          style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textFaint,
                            fontFamily: th.fontUI, fontSize: 11.5, padding: 0, marginTop: 2 }}>
                          Supprimer
                        </button>
                      )}
```
Ajouter juste après (toujours à l'intérieur du même bloc `{!m.deleted && (...)}`) :
```tsx
                      {!mine && (
                        <button type="button" onClick={() => setReportTarget(m)}
                          style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textFaint,
                            fontFamily: th.fontUI, fontSize: 11.5, padding: 0, marginTop: 2 }}>
                          Signaler
                        </button>
                      )}
```

Remplacer le bloc de fin (composer / bandeau bloqué) :
```tsx
      {meta?.blocked ? (
        <div style={{ borderTop: `1px solid ${th.line}`, padding: '14px 16px', fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, textAlign: 'center' }}>
          Vous ne pouvez pas échanger avec ce membre.
        </div>
      ) : (
        <MessageComposer onSend={send} onSendImage={sendImage} onTyping={typing} initialDraft={initialDraft} />
      )}
```
par :
```tsx
      {meta?.blocked || writeBlocked ? (
        <div style={{ borderTop: `1px solid ${th.line}`, padding: '14px 16px', fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, textAlign: 'center' }}>
          {writeBlocked && !meta?.blocked ? 'Vous ne pouvez plus écrire à ce joueur.' : 'Vous ne pouvez pas échanger avec ce membre.'}
        </div>
      ) : (
        <>
          {sendError && (
            <div style={{ padding: '6px 16px 0', fontFamily: th.fontUI, fontSize: 12.5, color: '#e0554f' }}>{sendError}</div>
          )}
          <MessageComposer onSend={send} onSendImage={sendImage} onTyping={typing} initialDraft={initialDraft} />
        </>
      )}
```

Après le bloc `{pendingDelete && <ConfirmDialog ... />}`, ajouter :
```tsx
      {reportTarget && (
        <ReportDialog
          onCancel={() => setReportTarget(null)}
          onSubmit={async (reason, detail) => {
            await api.reportDmMessage(conversationId, reportTarget.id, reason, detail || null, token);
          }}
        />
      )}
```

- [ ] **Step 2: Ajouter les tests**

Dans `frontend/__tests__/MessageThread.test.tsx`, ajouter `reportDmMessage: jest.fn().mockResolvedValue({ id: 'rep-1' })` dans l'objet `api` mocké. Puis, à la fin du fichier :
```ts
it('affiche « Signaler » sur le message de l autre, pas sur le sien', async () => {
  renderThread();
  await screen.findByText('salut'); // m1 de u2
  const reportButtons = screen.getAllByRole('button', { name: /signaler/i });
  expect(reportButtons).toHaveLength(1); // un seul message n est pas de moi (m1) sur les 2 chargés
});

it('signale un message et affiche la confirmation', async () => {
  renderThread();
  await screen.findByText('salut');
  fireEvent.click(screen.getAllByRole('button', { name: /signaler/i })[0]);
  fireEvent.click(screen.getByRole('button', { name: /envoyer le signalement/i }));
  await waitFor(() => expect(apiMock.reportDmMessage).toHaveBeenCalledWith('c1', 'm1', 'HARASSMENT', null, 't'));
  expect(await screen.findByText(/signalement envoyé/i)).toBeInTheDocument();
});

it('NOT_CO_MEMBERS à l envoi remplace le composer par le bandeau bloqué', async () => {
  apiMock.postDmMessage.mockRejectedValueOnce(new Error('NOT_CO_MEMBERS'));
  renderThread();
  await screen.findByText('salut');
  fireEvent.change(screen.getByPlaceholderText(/message/i), { target: { value: 'salut' } });
  fireEvent.keyDown(screen.getByPlaceholderText(/message/i), { key: 'Enter' });
  expect(await screen.findByText(/vous ne pouvez plus écrire à ce joueur/i)).toBeInTheDocument();
});

it('RATE_LIMITED à l envoi affiche un message inline (composer reste actif)', async () => {
  apiMock.postDmMessage.mockRejectedValueOnce(new Error('RATE_LIMITED'));
  renderThread();
  await screen.findByText('salut');
  fireEvent.change(screen.getByPlaceholderText(/message/i), { target: { value: 'vite vite' } });
  fireEvent.keyDown(screen.getByPlaceholderText(/message/i), { key: 'Enter' });
  expect(await screen.findByText(/trop de messages/i)).toBeInTheDocument();
  expect(screen.getByPlaceholderText(/message/i)).toBeInTheDocument();
});
```

- [ ] **Step 3: Lancer les tests**

Run (depuis `frontend/`) :
```bash
node node_modules/jest/bin/jest.js MessageThread.test.tsx
```
Expected: tous PASS.

⚠️ Le repo a une flake pré-existante connue sur la suite complète Jest côté `BookingModal` (isolation de tests) — sans lien avec ce travail ; vérifier `MessageThread.test.tsx` de façon isolée comme ci-dessus suffit.

- [ ] **Step 4: Vérifier tsc + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
```
```bash
git add frontend/components/messages/MessageThread.tsx frontend/__tests__/MessageThread.test.tsx
git commit -m "feat(moderation): bouton Signaler + bandeau NOT_CO_MEMBERS + rate-limit dans la messagerie privee"
```

---

### Task 16: Page admin `/admin/moderation` + entrée nav

**Files:**
- Create: `frontend/app/admin/moderation/page.tsx`
- Modify: `frontend/app/admin/layout.tsx`
- Modify: `frontend/__tests__/AdminLayout.test.tsx`
- Create: `frontend/__tests__/AdminModeration.test.tsx`

- [ ] **Step 1: Entrée de navigation**

Dans `frontend/app/admin/layout.tsx`, dans la section `{ title: 'Au quotidien', ... items: [...] }`, ajouter une entrée après `Ventes & journée` :
```ts
      { href: '/admin/moderation',   label: 'Signalements',      icon: 'flag' },
```

Dans `frontend/__tests__/AdminLayout.test.tsx`, repérer le test qui vérifie les items de la section « Au quotidien » (contient déjà `expect(screen.getByText('Caisse'))...`) et ajouter juste après :
```ts
    expect(screen.getByText('Signalements')).toBeInTheDocument();
```

- [ ] **Step 2: Écrire le test de la page (échoue — page inexistante)**

Créer `frontend/__tests__/AdminModeration.test.tsx` (calqué sur `AdminBroadcast.test.tsx`) :
```tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AdminModerationPage from '@/app/admin/moderation/page';
import { ThemeProvider } from '@/lib/ThemeProvider';

jest.mock('@/lib/useAuth', () => ({ useAuth: () => ({ token: 't', ready: true }) }));
jest.mock('@/lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'club-demo', accentColor: '#d6ff3f' } }) }));

const REPORT = {
  id: 'rep-1', reason: 'SPAM', detail: 'gênant', status: 'OPEN', resolution: null,
  createdAt: '2026-07-14T10:00:00.000Z', resolvedAt: null,
  reporter: { id: 'r1', firstName: 'Marie', lastName: 'D' },
  message: { id: 'm1', body: 'contenu signalé', deleted: false, createdAt: '2026-07-14T09:55:00.000Z', author: { id: 'a1', firstName: 'Léo', lastName: 'B' } },
  match: { reservationId: 'resa-1', startTime: '2026-07-14T18:00:00.000Z', resourceName: 'Court 1' },
};

jest.mock('@/lib/api', () => ({
  assetUrl: (u: string) => u,
  api: {
    adminListReports: jest.fn().mockResolvedValue({ items: [REPORT] }),
    adminResolveReport: jest.fn().mockResolvedValue({ ...REPORT, status: 'RESOLVED', resolution: 'DELETED' }),
  },
}));

function renderPage() {
  return render(<ThemeProvider><AdminModerationPage /></ThemeProvider>);
}

it('affiche un signalement ouvert avec l extrait du message et le motif', async () => {
  renderPage();
  await waitFor(() => expect(screen.getByText('contenu signalé')).toBeInTheDocument());
  expect(screen.getByText(/spam/i)).toBeInTheDocument();
  expect(screen.getByText(/court 1/i)).toBeInTheDocument();
});

it('Supprimer le message appelle adminResolveReport avec DELETE après confirmation', async () => {
  const { api } = require('@/lib/api');
  renderPage();
  await waitFor(() => screen.getByText('contenu signalé'));
  fireEvent.click(screen.getByRole('button', { name: /supprimer le message/i }));
  fireEvent.click(screen.getByRole('button', { name: /^supprimer$/i }));
  await waitFor(() => expect(api.adminResolveReport).toHaveBeenCalledWith('club-demo', 'rep-1', 'DELETE', 't'));
});

it('Rejeter appelle adminResolveReport avec REJECT', async () => {
  const { api } = require('@/lib/api');
  renderPage();
  await waitFor(() => screen.getByText('contenu signalé'));
  fireEvent.click(screen.getByRole('button', { name: /rejeter/i }));
  await waitFor(() => expect(api.adminResolveReport).toHaveBeenCalledWith('club-demo', 'rep-1', 'REJECT', 't'));
});
```

Run (depuis `frontend/`) :
```bash
node node_modules/jest/bin/jest.js AdminModeration.test.tsx
```
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter la page**

Créer `frontend/app/admin/moderation/page.tsx` :
```tsx
'use client';
import { useState, useEffect, useCallback } from 'react';
import { api, MessageReportRow } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { Btn } from '@/components/ui/atoms';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

const REASON_LABEL: Record<string, string> = { HARASSMENT: 'Harcèlement', ILLEGAL: 'Contenu illicite', SPAM: 'Spam', OTHER: 'Autre' };

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function AdminModerationPage() {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { club } = useClub();
  const clubId = club?.id;

  const [items, setItems] = useState<MessageReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<MessageReportRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !clubId) return;
    setLoading(true);
    try { setItems((await api.adminListReports(clubId, token)).items); }
    finally { setLoading(false); }
  }, [token, clubId]);

  useEffect(() => { if (ready) load(); }, [ready, load]);

  const resolve = async (report: MessageReportRow, action: 'DELETE' | 'REJECT') => {
    if (!token || !clubId) return;
    setBusy(report.id);
    try {
      const updated = await api.adminResolveReport(clubId, report.id, action, token);
      setItems((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    } finally { setBusy(null); setConfirmDelete(null); }
  };

  const open = items.filter((r) => r.status === 'OPEN');
  const resolved = items.filter((r) => r.status === 'RESOLVED');

  return (
    <div style={{ maxWidth: 760 }}>
      <h1 style={{ fontFamily: th.fontDisplay, fontSize: 26, color: th.text, marginBottom: 4 }}>Signalements</h1>
      <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, marginBottom: 20 }}>
        Messages du chat de partie signalés par les membres.
      </div>

      {loading ? (
        <div style={{ fontFamily: th.fontUI, color: th.textMute }}>Chargement…</div>
      ) : items.length === 0 ? (
        <div style={{ fontFamily: th.fontUI, color: th.textMute }}>Aucun signalement.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {open.map((r) => (
            <div key={r.id} style={{ background: th.bgElev, borderRadius: 14, padding: 16, boxShadow: th.shadow }}>
              <div style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.accent }}>{REASON_LABEL[r.reason]}</div>
              <div style={{ fontFamily: th.fontUI, fontSize: 14.5, color: th.text, marginTop: 6 }}>{r.message.body}</div>
              <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginTop: 8 }}>
                {r.message.author.firstName} {r.message.author.lastName} · {r.match?.resourceName} · {r.match && fmt(r.match.startTime)}
              </div>
              <div style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textFaint, marginTop: 4 }}>
                Signalé par {r.reporter.firstName} {r.reporter.lastName} le {fmt(r.createdAt)}
                {r.detail ? ` — « ${r.detail} »` : ''}
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                <Btn variant="danger" onClick={() => setConfirmDelete(r)} disabled={busy === r.id}>Supprimer le message</Btn>
                <Btn variant="surface" onClick={() => resolve(r, 'REJECT')} disabled={busy === r.id}>Rejeter</Btn>
              </div>
            </div>
          ))}
          {resolved.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, cursor: 'pointer' }}>
                Historique ({resolved.length})
              </summary>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                {resolved.map((r) => (
                  <div key={r.id} style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, padding: '8px 0', borderTop: `1px solid ${th.line}` }}>
                    {REASON_LABEL[r.reason]} · {r.resolution === 'DELETED' ? 'Supprimé' : 'Rejeté'} · {r.resolvedAt && fmt(r.resolvedAt)}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Supprimer le message"
          message="Le message sera retiré du chat et le signalement clos."
          confirmLabel="Supprimer" cancelLabel="Annuler"
          busy={busy === confirmDelete.id}
          onConfirm={() => resolve(confirmDelete, 'DELETE')}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Lancer les tests**

Run (depuis `frontend/`) :
```bash
node node_modules/jest/bin/jest.js AdminModeration.test.tsx AdminLayout.test.tsx
```
Expected: tous PASS.

- [ ] **Step 5: Vérifier tsc + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
```
```bash
git add frontend/app/admin/moderation/page.tsx frontend/app/admin/layout.tsx frontend/__tests__/AdminModeration.test.tsx frontend/__tests__/AdminLayout.test.tsx
git commit -m "feat(moderation): page admin /admin/moderation + entree nav"
```

---

### Task 17: Page superadmin `/superadmin/moderation` + entrée nav

**Files:**
- Create: `frontend/app/superadmin/moderation/page.tsx`
- Modify: `frontend/app/superadmin/layout.tsx`
- Create: `frontend/__tests__/SuperAdminModeration.test.tsx`

- [ ] **Step 1: Entrée de navigation**

Dans `frontend/app/superadmin/layout.tsx`, dans le tableau `links`, ajouter après `Statistiques` :
```ts
    { href: '/superadmin/moderation', label: 'Modération',    icon: 'flag' as const },
```

- [ ] **Step 2: Écrire le test (échoue — page inexistante)**

Créer `frontend/__tests__/SuperAdminModeration.test.tsx` :
```tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import SuperAdminModerationPage from '@/app/superadmin/moderation/page';
import { ThemeProvider } from '@/lib/ThemeProvider';

jest.mock('@/lib/useAuth', () => ({ useAuth: () => ({ token: 't', ready: true }) }));

const REPORT = {
  id: 'rep-2', reason: 'HARASSMENT', detail: null, status: 'OPEN', resolution: null,
  createdAt: '2026-07-14T10:00:00.000Z', resolvedAt: null,
  reporter: { id: 'r1', firstName: 'Marie', lastName: 'D' },
  message: { id: 'dm1', body: 'message privé signalé', deleted: false, createdAt: '2026-07-14T09:55:00.000Z', author: { id: 'a1', firstName: 'Léo', lastName: 'B' }, hasImage: false },
  conversationId: 'c1',
};

jest.mock('@/lib/api', () => ({
  assetUrl: (u: string) => u,
  api: {
    platformListReports: jest.fn().mockResolvedValue({ items: [REPORT] }),
    platformResolveReport: jest.fn().mockResolvedValue({ ...REPORT, status: 'RESOLVED', resolution: 'DELETED' }),
    platformReportImage: jest.fn(),
  },
}));

function renderPage() {
  return render(<ThemeProvider><SuperAdminModerationPage /></ThemeProvider>);
}

it('affiche un signalement DM ouvert', async () => {
  renderPage();
  await waitFor(() => expect(screen.getByText('message privé signalé')).toBeInTheDocument());
  expect(screen.getByText(/harcèlement/i)).toBeInTheDocument();
});

it('Supprimer le message appelle platformResolveReport DELETE après confirmation', async () => {
  const { api } = require('@/lib/api');
  renderPage();
  await waitFor(() => screen.getByText('message privé signalé'));
  fireEvent.click(screen.getByRole('button', { name: /supprimer le message/i }));
  fireEvent.click(screen.getByRole('button', { name: /^supprimer$/i }));
  await waitFor(() => expect(api.platformResolveReport).toHaveBeenCalledWith('rep-2', 'DELETE', 't'));
});

it('Rejeter appelle platformResolveReport REJECT', async () => {
  const { api } = require('@/lib/api');
  renderPage();
  await waitFor(() => screen.getByText('message privé signalé'));
  fireEvent.click(screen.getByRole('button', { name: /rejeter/i }));
  await waitFor(() => expect(api.platformResolveReport).toHaveBeenCalledWith('rep-2', 'REJECT', 't'));
});
```

Run (depuis `frontend/`) :
```bash
node node_modules/jest/bin/jest.js SuperAdminModeration.test.tsx
```
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter la page**

Créer `frontend/app/superadmin/moderation/page.tsx` (même structure que la page admin, source `platformListReports`/`platformResolveReport`, pas de `useClub`, et un bouton « Voir la photo » quand `message.hasImage`) :
```tsx
'use client';
import { useState, useEffect, useCallback } from 'react';
import { api, MessageReportRow } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useTheme } from '@/lib/ThemeProvider';
import { Btn } from '@/components/ui/atoms';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

const REASON_LABEL: Record<string, string> = { HARASSMENT: 'Harcèlement', ILLEGAL: 'Contenu illicite', SPAM: 'Spam', OTHER: 'Autre' };

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function SuperAdminModerationPage() {
  const { th } = useTheme();
  const { token, ready } = useAuth();

  const [items, setItems] = useState<MessageReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<MessageReportRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<{ id: string; url: string } | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try { setItems((await api.platformListReports(token)).items); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { if (ready) load(); }, [ready, load]);

  const resolve = async (report: MessageReportRow, action: 'DELETE' | 'REJECT') => {
    if (!token) return;
    setBusy(report.id);
    try {
      const updated = await api.platformResolveReport(report.id, action, token);
      setItems((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    } finally { setBusy(null); setConfirmDelete(null); }
  };

  const showImage = async (r: MessageReportRow) => {
    if (!token) return;
    const blob = await api.platformReportImage(r.id, token);
    setImageUrl({ id: r.id, url: URL.createObjectURL(blob) });
  };

  const open = items.filter((r) => r.status === 'OPEN');
  const resolved = items.filter((r) => r.status === 'RESOLVED');

  return (
    <div style={{ maxWidth: 760 }}>
      <h1 style={{ fontFamily: th.fontDisplay, fontSize: 26, color: th.text, marginBottom: 4 }}>Modération</h1>
      <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, marginBottom: 20 }}>
        Messages privés signalés par les joueurs, tous clubs confondus.
      </div>

      {loading ? (
        <div style={{ fontFamily: th.fontUI, color: th.textMute }}>Chargement…</div>
      ) : items.length === 0 ? (
        <div style={{ fontFamily: th.fontUI, color: th.textMute }}>Aucun signalement.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {open.map((r) => (
            <div key={r.id} style={{ background: th.bgElev, borderRadius: 14, padding: 16, boxShadow: th.shadow }}>
              <div style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.accent }}>{REASON_LABEL[r.reason]}</div>
              <div style={{ fontFamily: th.fontUI, fontSize: 14.5, color: th.text, marginTop: 6 }}>{r.message.body}</div>
              {r.message.hasImage && (
                <button type="button" onClick={() => showImage(r)}
                  style={{ marginTop: 6, border: 'none', background: 'transparent', color: th.accent, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13, padding: 0 }}>
                  Voir la photo
                </button>
              )}
              {imageUrl?.id === r.id && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUrl.url} alt="Photo signalée" style={{ maxWidth: '100%', maxHeight: 260, borderRadius: 10, marginTop: 8, display: 'block' }} />
              )}
              <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginTop: 8 }}>
                {r.message.author.firstName} {r.message.author.lastName}
              </div>
              <div style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textFaint, marginTop: 4 }}>
                Signalé par {r.reporter.firstName} {r.reporter.lastName} le {fmt(r.createdAt)}
                {r.detail ? ` — « ${r.detail} »` : ''}
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                <Btn variant="danger" onClick={() => setConfirmDelete(r)} disabled={busy === r.id}>Supprimer le message</Btn>
                <Btn variant="surface" onClick={() => resolve(r, 'REJECT')} disabled={busy === r.id}>Rejeter</Btn>
              </div>
            </div>
          ))}
          {resolved.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, cursor: 'pointer' }}>
                Historique ({resolved.length})
              </summary>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                {resolved.map((r) => (
                  <div key={r.id} style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, padding: '8px 0', borderTop: `1px solid ${th.line}` }}>
                    {REASON_LABEL[r.reason]} · {r.resolution === 'DELETED' ? 'Supprimé' : 'Rejeté'} · {r.resolvedAt && fmt(r.resolvedAt)}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Supprimer le message"
          message="Le message sera retiré de la conversation et le signalement clos."
          confirmLabel="Supprimer" cancelLabel="Annuler"
          busy={busy === confirmDelete.id}
          onConfirm={() => resolve(confirmDelete, 'DELETE')}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Lancer les tests**

Run (depuis `frontend/`) :
```bash
node node_modules/jest/bin/jest.js SuperAdminModeration.test.tsx
```
Expected: 3 passed.

- [ ] **Step 5: Vérifier tsc + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
```
```bash
git add frontend/app/superadmin/moderation/page.tsx frontend/app/superadmin/layout.tsx frontend/__tests__/SuperAdminModeration.test.tsx
git commit -m "feat(moderation): page superadmin /superadmin/moderation + entree nav"
```

---

### Task 18: Point de contact DSA (FAQ plateforme)

**Files:**
- Modify: `frontend/lib/platformContent.ts`

- [ ] **Step 1: Ajouter l'entrée FAQ**

Dans `frontend/lib/platformContent.ts`, dans le tableau `PLATFORM_FAQ`, ajouter avant la ligne finale `];` :
```ts
  { category: 'Données', question: 'Comment signaler un contenu (message de chat, message privé) ?', answer: 'Chaque message d\'un chat de partie ou d\'une conversation privée peut être signalé via le bouton « Signaler ». Un signalement dans un chat de partie est examiné par le staff du club ; un signalement en messagerie privée est examiné par l\'équipe Palova. Vous pouvez aussi nous écrire directement à contact@palova.fr.' },
```

- [ ] **Step 2: Vérifier qu'aucun test n'est cassé**

Run (depuis `frontend/`) :
```bash
node node_modules/jest/bin/jest.js -t "platformContent"
```
Expected: si aucun test ne cible `platformContent.ts`, la commande renvoie « no tests found » — dans ce cas, lancer plutôt la suite qui consomme la FAQ (rechercher `PLATFORM_FAQ` dans `frontend/__tests__` via `grep -rl PLATFORM_FAQ frontend/__tests__`) et la lancer si elle existe ; sinon ce step est un no-op de vérification visuelle.

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/platformContent.ts
git commit -m "feat(moderation): entree FAQ point de contact DSA"
```

---

### Task 19: Vérification finale

**Files:** aucun (validation uniquement)

- [ ] **Step 1: Suite backend complète**

Run (depuis `backend/`) :
```bash
npx jest
```
Expected: PASS. Si un test échoue, distinguer une régression réelle (à corriger) d'une flake déjà connue avant ce travail (vérifier via `git stash` + relancer si un doute existe).

- [ ] **Step 2: Suite frontend complète**

Run (depuis `frontend/`) :
```bash
node node_modules/jest/bin/jest.js
```
Expected: PASS, à l'exception de la flake `BookingModal` pré-existante déjà documentée (mémoire `frontend-full-suite-bookingmodal-flake`) — vérifier qu'aucun échec ne provient des fichiers touchés par ce plan.

- [ ] **Step 3: Type-check complet des deux côtés**

Run (depuis `backend/`) :
```bash
npx tsc --noEmit
```
Run (depuis `frontend/`) :
```bash
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
```
Expected: pas de nouvelle erreur imputable à ce travail (le repo peut avoir du WIP parallèle avec des erreurs préexistantes ailleurs — ne signaler/corriger que celles touchant les fichiers de ce plan).

- [ ] **Step 4: Vérification visuelle (skill `verify`)**

Utiliser le skill `verify` pour ouvrir `/admin/moderation` (avec au moins un signalement de test en base — créer un signalement via l'UI du chat de partie d'abord) et `/superadmin/moderation`, en clair et en sombre, desktop 1280 + mobile 390 : vérifier qu'aucune ligne ne déborde horizontalement et que le bouton « Signaler » est bien absent sur ses propres messages dans les deux chats.

- [ ] **Step 5: Mettre à jour CLAUDE.md**

Ajouter une section « Modération & anti-abus des chats (v1) ✅ implémenté » dans `CLAUDE.md`, résumant les 4 volets (signalement + files club/superadmin, rate-limiting Redis, fermeture BLOCKED→DM, ré-encodage sharp), la migration `add_message_reports`, et le hors-périmètre repris de la spec (ban plateforme, signalement de profils/photos/annonces, ré-encodage des autres uploads, rate-limit générique, pages légales complètes).

- [ ] **Step 6: Commit final**

```bash
git add CLAUDE.md
git commit -m "docs: memoire moderation & anti-abus des chats"
```
