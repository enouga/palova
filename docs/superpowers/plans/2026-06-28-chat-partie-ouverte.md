# Chat de partie ouverte + « Ça m'intéresse » — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre, sur une partie ouverte (`Reservation` PUBLIC), un état léger « Ça m'intéresse » et un chat temps réel réservé aux inscrits + intéressés (notif quand absent, modération auteur/organisateur/admin).

**Architecture:** Deux briques additives greffées sur l'existant. (1) Intérêt = nouveau modèle `OpenMatchInterest`, géré par `OpenMatchService`, qui n'occupe pas de place et notifie l'organisateur. (2) Chat = nouveau modèle `OpenMatchMessage` + service isolé `OpenMatchChatService`, livraison temps réel via un nouveau canal `SSEService` par réservation, notifications aux absents via le `dispatch` existant (catégorie dédiée `OPEN_MATCH_CHAT`, coalescing par notification non lue). UI = bouton + compteur sur `OpenMatchCard`, feuille `OpenMatchChatSheet` (EventSource).

**Tech Stack:** Express 5 + Prisma 7 (PostgreSQL 16), SSE (EventSource), Jest (backend) + React Testing Library (frontend), Next.js 16 / React 19.

**Spec :** `docs/superpowers/specs/2026-06-28-chat-partie-ouverte-design.md`.

**Conventions du repo à respecter :**
- Prisma 7 : client via `PrismaPg` adapter (déjà en place dans `src/db/prisma.ts`) — ne jamais `new PrismaClient()` seul.
- Base de DEV en **dérive** : ne PAS lancer `prisma migrate dev` (veut un reset destructif). Migration **additive** hand-authored + `prisma migrate deploy` (repli `prisma db push`). Cf. mémoire « migrate deploy, not dev ».
- Erreurs service = `throw new Error('CODE')`, mappées en HTTP par `ERROR_STATUS`/`handleError` dans `clubs.ts`.
- Notifs best-effort APRÈS commit (`safeNotify`), jamais bloquantes.
- Front : pas de `new Date()` au rendu (hydration) — horloge posée en effet.
- ⚠️ OneDrive peut désynchroniser `node_modules/.prisma` : après une régénération de schéma, réflexe `npm install` + `npx prisma generate` si le client est amputé.

---

## File Structure

**Backend — créés :**
- `backend/prisma/migrations/<timestamp>_add_open_match_chat/migration.sql` — migration additive.
- `backend/src/services/openMatchChat.service.ts` — service du chat (accès, liste, post, suppression).
- `backend/src/services/__tests__/openMatchChat.service.test.ts` — tests du service chat.

**Backend — modifiés :**
- `backend/prisma/schema.prisma` — modèles `OpenMatchInterest`/`OpenMatchMessage`, relations inverses, enum `OPEN_MATCH_CHAT`.
- `backend/src/services/sse.service.ts` — canal SSE par réservation (`addMatchClient`/`broadcastMatch`/`getMatchUserIds`).
- `backend/src/services/openMatch.service.ts` — `setInterested`/`removeInterested`, effacement de l'intérêt au join, enrichissement de `listOpenMatches`.
- `backend/src/email/notifications.ts` — `notifyOpenMatchInterest`, `notifyOpenMatchChatMessage`.
- `backend/src/routes/clubs.ts` — routes interest + chat (+ stream SSE).
- `backend/src/services/__tests__/openMatch.service.test.ts` — bloc « intérêt ».
- `backend/src/services/__tests__/sse.user.test.ts` (ou nouveau `sse.match.test.ts`) — canal match.

**Frontend — créés :**
- `frontend/components/openmatch/OpenMatchChatSheet.tsx` — feuille du chat.
- `frontend/__tests__/OpenMatchChatSheet.test.tsx` — tests de la feuille.

**Frontend — modifiés :**
- `frontend/lib/api.ts` — types `OpenMatch` enrichi + `OpenMatchMessage`, méthodes, `chatStreamUrl`.
- `frontend/components/openmatch/OpenMatchCard.tsx` — bouton « Ça m'intéresse », compteur, « Discuter ».
- `frontend/components/openmatch/OpenMatches.tsx` — câblage handlers + ouverture feuille + libellés d'erreur.
- `frontend/__tests__/OpenMatchCard.test.tsx` (nouveau) et/ou `frontend/__tests__/OpenMatches.test.tsx`.
- Écran de préférences de notifications — libellé de la catégorie `OPEN_MATCH_CHAT`.

---

## Task 1: Migration + schéma Prisma (modèles + enum)

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260628000000_add_open_match_chat/migration.sql`

- [ ] **Step 1: Ajouter les deux modèles + la valeur d'enum au schéma**

Dans `backend/prisma/schema.prisma`, ajouter la valeur à l'enum existant (repérer `enum NotificationCategory { ... }`) :

```prisma
enum NotificationCategory {
  MY_GAMES
  MY_REGISTRATIONS
  MY_MATCHES
  PAYMENTS
  CLUB_MESSAGES
  ORGANIZER
  REMINDERS
  OPEN_MATCH_CHAT
}
```

Ajouter les deux modèles (à la fin du fichier, près des autres modèles de réservation) :

```prisma
/// Membre « intéressé » par une partie ouverte (n'occupe pas de place).
/// Débloque l'accès au chat et alimente le compteur d'intéressés sur la carte.
model OpenMatchInterest {
  id            String   @id @default(cuid())
  reservationId String   @map("reservation_id")
  userId        String   @map("user_id")
  createdAt     DateTime @default(now()) @map("created_at")

  reservation Reservation @relation(fields: [reservationId], references: [id], onDelete: Cascade)
  user        User        @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([reservationId, userId])
  @@index([reservationId])
  @@map("open_match_interests")
}

/// Message du fil de discussion d'une partie ouverte. Soft-delete (deletedAt) :
/// un message supprimé reste en base et s'affiche en pierre tombale « message supprimé ».
model OpenMatchMessage {
  id            String    @id @default(cuid())
  reservationId String    @map("reservation_id")
  userId        String    @map("user_id") // auteur
  body          String
  createdAt     DateTime  @default(now()) @map("created_at")
  deletedAt     DateTime? @map("deleted_at")
  deletedById   String?   @map("deleted_by_id")

  reservation Reservation @relation(fields: [reservationId], references: [id], onDelete: Cascade)
  user        User        @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([reservationId, createdAt])
  @@map("open_match_messages")
}
```

Ajouter les relations inverses. Dans `model Reservation { ... }`, après `lesson Lesson?` :

```prisma
  openMatchInterests OpenMatchInterest[]
  openMatchMessages  OpenMatchMessage[]
```

Dans `model User { ... }`, parmi les relations inverses (avant `@@map("users")`) :

```prisma
  openMatchInterests OpenMatchInterest[]
  openMatchMessages  OpenMatchMessage[]
```

- [ ] **Step 2: Écrire le SQL de migration**

Créer `backend/prisma/migrations/20260628000000_add_open_match_chat/migration.sql` :

```sql
-- AlterEnum
ALTER TYPE "NotificationCategory" ADD VALUE 'OPEN_MATCH_CHAT';

-- CreateTable
CREATE TABLE "open_match_interests" (
    "id" TEXT NOT NULL,
    "reservation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "open_match_interests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "open_match_messages" (
    "id" TEXT NOT NULL,
    "reservation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "deleted_by_id" TEXT,
    CONSTRAINT "open_match_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "open_match_interests_reservation_id_user_id_key" ON "open_match_interests"("reservation_id", "user_id");
CREATE INDEX "open_match_interests_reservation_id_idx" ON "open_match_interests"("reservation_id");
CREATE INDEX "open_match_messages_reservation_id_created_at_idx" ON "open_match_messages"("reservation_id", "created_at");

-- AddForeignKey
ALTER TABLE "open_match_interests" ADD CONSTRAINT "open_match_interests_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "open_match_interests" ADD CONSTRAINT "open_match_interests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "open_match_messages" ADD CONSTRAINT "open_match_messages_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "open_match_messages" ADD CONSTRAINT "open_match_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

> PostgreSQL 16 accepte `ALTER TYPE ... ADD VALUE` dans la transaction d'une migration tant que la valeur n'est pas *utilisée* dans la même migration (ce n'est pas le cas ici).

- [ ] **Step 3: Appliquer la migration et régénérer le client**

Run :
```bash
cd backend && npx prisma migrate deploy && npx prisma generate
```
Expected : « 1 migration applied » (ou « No pending migrations » si déjà appliquée), puis « Generated Prisma Client ».
Si `migrate deploy` échoue pour cause de dérive d'historique : repli `npx prisma db push` (applique le schéma sans exiger l'historique), puis `npx prisma generate`.

- [ ] **Step 4: Vérifier que le client typé compile**

Run :
```bash
cd backend && npx tsc --noEmit
```
Expected : PASS (les types `OpenMatchInterest`/`OpenMatchMessage` existent ; `NotificationCategory.OPEN_MATCH_CHAT` connu).

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(db): migration add_open_match_chat (intérêt + messages partie ouverte)"
```

---

## Task 2: Canal SSE par réservation (`SSEService`)

**Files:**
- Modify: `backend/src/services/sse.service.ts`
- Test: `backend/src/services/__tests__/sse.match.test.ts` (create)

- [ ] **Step 1: Écrire le test du canal match**

Créer `backend/src/services/__tests__/sse.match.test.ts` :

```typescript
import { SSEService } from '../sse.service';

// Faux Response Express minimal pour SSE (capture les writes + le handler 'close').
function fakeRes() {
  const writes: string[] = [];
  let closeHandler: (() => void) | null = null;
  return {
    setHeader() {}, flushHeaders() {},
    write(s: string) { writes.push(s); return true; },
    on(event: string, cb: () => void) { if (event === 'close') closeHandler = cb; },
    writes,
    close() { closeHandler?.(); },
  };
}

describe('SSEService — canal par partie (match)', () => {
  const sse = SSEService.getInstance();

  it('suit les userId connectés et les retire à la fermeture', () => {
    const a = fakeRes();
    const b = fakeRes();
    sse.addMatchClient('resa1', 'userA', a as never);
    sse.addMatchClient('resa1', 'userB', b as never);

    expect(sse.getMatchUserIds('resa1')).toEqual(new Set(['userA', 'userB']));

    a.close();
    expect(sse.getMatchUserIds('resa1')).toEqual(new Set(['userB']));

    b.close();
    expect(sse.getMatchUserIds('resa1')).toEqual(new Set());
  });

  it('broadcastMatch écrit le payload SSE à tous les clients de la partie', () => {
    const a = fakeRes();
    sse.addMatchClient('resa2', 'userA', a as never);
    a.writes.length = 0; // ignore le message 'connected'

    sse.broadcastMatch('resa2', { type: 'chat_message', message: { id: 'm1' } });

    expect(a.writes.join('')).toContain('"type":"chat_message"');
    expect(a.writes.join('')).toContain('"id":"m1"');
  });
});
```

- [ ] **Step 2: Lancer le test (échec attendu)**

Run : `cd backend && npx jest sse.match -t "canal par partie" -i`
Expected : FAIL (`addMatchClient`/`broadcastMatch`/`getMatchUserIds` n'existent pas).

- [ ] **Step 3: Implémenter le canal match dans `SSEService`**

Dans `backend/src/services/sse.service.ts`, ajouter le champ après `private userClients`:

```typescript
  // Clients abonnés au fil d'une partie : reservationId -> (Response -> userId).
  // On garde l'userId pour savoir qui regarde le fil en direct (ciblage des notifs).
  private matchClients: Map<string, Map<Response, string>> = new Map();
```

Puis ajouter ces méthodes (avant la fermeture de la classe) :

```typescript
  /** Abonne un client au flux d'une partie ouverte (chat temps réel). */
  addMatchClient(reservationId: string, userId: string, res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const keepAlive = setInterval(() => res.write(': ping\n\n'), 30_000);

    if (!this.matchClients.has(reservationId)) this.matchClients.set(reservationId, new Map());
    this.matchClients.get(reservationId)!.set(res, userId);

    res.on('close', () => {
      clearInterval(keepAlive);
      this.matchClients.get(reservationId)?.delete(res);
      if (this.matchClients.get(reservationId)?.size === 0) this.matchClients.delete(reservationId);
    });

    res.write(`data: ${JSON.stringify({ type: 'connected', reservationId })}\n\n`);
  }

  /** Diffuse un évènement à tous les clients du fil d'une partie (best-effort). */
  broadcastMatch(reservationId: string, event: unknown): void {
    const clients = this.matchClients.get(reservationId);
    if (!clients?.size) return;
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    const dead: Response[] = [];
    clients.forEach((_userId, res) => { try { res.write(payload); } catch { dead.push(res); } });
    dead.forEach((res) => clients.delete(res));
  }

  /** Ensemble des userId actuellement connectés au fil d'une partie. */
  getMatchUserIds(reservationId: string): Set<string> {
    return new Set(this.matchClients.get(reservationId)?.values() ?? []);
  }
```

- [ ] **Step 4: Lancer le test (succès attendu)**

Run : `cd backend && npx jest sse.match -i`
Expected : PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/sse.service.ts backend/src/services/__tests__/sse.match.test.ts
git commit -m "feat(sse): canal temps réel par partie ouverte (addMatchClient/broadcastMatch/getMatchUserIds)"
```

---

## Task 3: Intérêt — `OpenMatchService.setInterested` / `removeInterested`

**Files:**
- Modify: `backend/src/services/openMatch.service.ts`
- Modify: `backend/src/email/notifications.ts` (ajout `notifyOpenMatchInterest`)
- Test: `backend/src/services/__tests__/openMatch.service.test.ts`

- [ ] **Step 1: Écrire le test (bloc « intérêt »)**

Dans `backend/src/services/__tests__/openMatch.service.test.ts`, suivre le style de mock Prisma déjà présent dans le fichier (réutiliser ses helpers/mocks). Ajouter un `describe` :

```typescript
describe('OpenMatchService — intérêt', () => {
  it('setInterested refuse un participant déjà inscrit (ALREADY_PARTICIPANT)', async () => {
    // club ACTIVE + membre ACTIVE + résa PUBLIC/CONFIRMED/à venir où userId est déjà participant
    // → attendre rejects.toThrow('ALREADY_PARTICIPANT')
  });

  it('setInterested crée la ligne d’intérêt (idempotent via upsert)', async () => {
    // membre ACTIVE non participant → upsert OpenMatchInterest appelé avec { reservationId, userId }
  });

  it('removeInterested supprime la ligne (idempotent)', async () => {
    // deleteMany sur { reservationId, userId } — ne lève pas si absente
  });
});
```

> Remplir les corps en réutilisant les mocks Prisma existants du fichier (chercher `prismaMock`/`jest.mock('../../db/prisma'`). Asserter sur `prisma.openMatchInterest.upsert` / `.deleteMany`.

- [ ] **Step 2: Lancer le test (échec attendu)**

Run : `cd backend && npx jest openMatch.service -t "intérêt" -i`
Expected : FAIL (`setInterested`/`removeInterested` absents).

- [ ] **Step 3: Implémenter l'intérêt dans le service**

Dans `backend/src/services/openMatch.service.ts`, ajouter l'import du notifier en tête :

```typescript
import { notifyOpenMatchJoin, notifyOpenMatchLeft, notifyOpenMatchRemoved, notifyOpenMatchAdded, notifyOpenMatchInterest } from '../email/notifications';
```

Ajouter les méthodes dans la classe :

```typescript
  /** Marque l'appelant « intéressé » par une partie ouverte (n'occupe pas de place). */
  async setInterested(slug: string, reservationId: string, userId: string) {
    const club = await this.resolveActiveMember(slug, userId);

    const resa = await prisma.reservation.findUnique({
      where: { id: reservationId },
      select: {
        visibility: true, status: true, startTime: true,
        resource: { select: { clubId: true } },
        participants: { select: { userId: true } },
      },
    });
    if (!resa || resa.resource.clubId !== club.id) throw new Error('RESERVATION_NOT_FOUND');
    if (resa.visibility !== 'PUBLIC' || resa.status !== 'CONFIRMED') throw new Error('MATCH_NOT_JOINABLE');
    if (resa.startTime.getTime() <= Date.now()) throw new Error('MATCH_IN_PAST');
    if (resa.participants.some((p) => p.userId === userId)) throw new Error('ALREADY_PARTICIPANT');

    await prisma.openMatchInterest.upsert({
      where: { reservationId_userId: { reservationId, userId } },
      create: { reservationId, userId },
      update: {},
    });

    await this.safeNotify(() => notifyOpenMatchInterest(reservationId, userId));
    return { id: reservationId };
  }

  /** Retire l'intérêt de l'appelant (idempotent). */
  async removeInterested(slug: string, reservationId: string, userId: string) {
    const club = await this.resolveActiveMember(slug, userId);
    const resa = await prisma.reservation.findUnique({
      where: { id: reservationId },
      select: { resource: { select: { clubId: true } } },
    });
    if (!resa || resa.resource.clubId !== club.id) throw new Error('RESERVATION_NOT_FOUND');
    await prisma.openMatchInterest.deleteMany({ where: { reservationId, userId } });
    return { id: reservationId };
  }
```

- [ ] **Step 4: Ajouter `notifyOpenMatchInterest` aux notifications**

Dans `backend/src/email/notifications.ts`, après `notifyOpenMatchJoin`, ajouter :

```typescript
/** Prévient l'organisateur qu'un membre est « intéressé » par sa partie (in-app + push, pas d'email). */
export async function notifyOpenMatchInterest(reservationId: string, interestedUserId: string): Promise<void> {
  const resa = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: {
      resource: { select: { name: true, club: { select: { id: true, slug: true, timezone: true } } } },
      participants: { include: { user: { select: { firstName: true, lastName: true } } } },
    },
  });
  if (!resa) return;
  const organizerP = resa.participants.find((p) => p.isOrganizer);
  if (!organizerP || organizerP.userId === interestedUserId) return;

  const interested = await prisma.user.findUnique({
    where: { id: interestedUserId },
    select: { firstName: true, lastName: true },
  });
  if (!interested) return;

  const club = resa.resource.club;
  const dateLabel = formatDateRangeFr(resa.startTime, resa.endTime, club.timezone);
  const url = clubAppUrl(club.slug, '/parties');
  await dispatch({
    userId: organizerP.userId, clubId: club.id, category: 'MY_GAMES', type: 'open_match.interested',
    title: 'Quelqu’un est intéressé par ta partie',
    body: `${fullName(interested)} est intéressé par ta partie du ${dateLabel}.`,
    url, email: null,
  });
}
```

> `dispatch`, `formatDateRangeFr`, `clubAppUrl`, `fullName` sont déjà importés/définis dans ce fichier (utilisés par `notifyOpenMatchJoin`).

- [ ] **Step 5: Lancer le test (succès attendu)**

Run : `cd backend && npx jest openMatch.service -t "intérêt" -i`
Expected : PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/openMatch.service.ts backend/src/email/notifications.ts backend/src/services/__tests__/openMatch.service.test.ts
git commit -m "feat(parties): état « intéressé » (set/remove) + notif organisateur"
```

---

## Task 4: Effacer l'intérêt au join + enrichir `listOpenMatches`

**Files:**
- Modify: `backend/src/services/openMatch.service.ts`
- Test: `backend/src/services/__tests__/openMatch.service.test.ts`

- [ ] **Step 1: Écrire les tests**

Ajouter au `describe` « intérêt » :

```typescript
it('rejoindre une partie efface l’intérêt du joueur', async () => {
  // join réussi → tx.openMatchInterest.deleteMany appelé avec { reservationId, userId }
});

it('listOpenMatches expose interestedCount et viewerIsInterested', async () => {
  // une résa PUBLIC avec 2 intéressés dont le viewer → interestedCount===2, viewerIsInterested===true
});
```

- [ ] **Step 2: Lancer (échec attendu)**

Run : `cd backend && npx jest openMatch.service -t "efface l’intérêt" -i`
Expected : FAIL.

- [ ] **Step 3: Effacer l'intérêt dans la transaction de join**

Dans `joinOpenMatch`, juste après la création du participant (`const created = await tx.reservationParticipant.create(...)`), ajouter :

```typescript
      // Devenu participant : son éventuel « intérêt » est redondant.
      await tx.openMatchInterest.deleteMany({ where: { reservationId, userId } });
```

Idem dans `addOpenMatchPlayer` (après `const created = ...create(...)`), pour `targetUserId` :

```typescript
      await tx.openMatchInterest.deleteMany({ where: { reservationId, userId: targetUserId } });
```

- [ ] **Step 4: Enrichir `listOpenMatches`**

Dans `listOpenMatches`, étendre l'`include` de `findMany` avec les intéressés (⚠️ noms de relations exacts définis en Task 1 : `openMatchInterests`/`openMatchMessages`) :

```typescript
        openMatchInterests: {
          orderBy: { createdAt: 'asc' },
          select: { userId: true, user: { select: { firstName: true, lastName: true, avatarUrl: true } } },
        },
        openMatchMessages: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true },
        },
```

Puis dans le `return matches.map((m) => { ... })`, ajouter aux champs renvoyés :

```typescript
        interestedCount: m.openMatchInterests.length,
        viewerIsInterested: m.openMatchInterests.some((i) => i.userId === viewerUserId),
        interested: m.openMatchInterests.slice(0, 5).map((i) => ({
          userId: i.userId, firstName: i.user.firstName, lastName: i.user.lastName, avatarUrl: i.user.avatarUrl, isOrganizer: false,
        })),
        lastMessageAt: m.openMatchMessages[0]?.createdAt.toISOString() ?? null,
```

- [ ] **Step 5: Lancer les tests (succès attendu)**

Run : `cd backend && npx jest openMatch.service -i`
Expected : PASS (tout le fichier).

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/openMatch.service.ts backend/src/services/__tests__/openMatch.service.test.ts
git commit -m "feat(parties): efface l’intérêt au join + expose interestedCount/lastMessageAt"
```

---

## Task 5: Service chat — accès + liste + post

**Files:**
- Create: `backend/src/services/openMatchChat.service.ts`
- Modify: `backend/src/email/notifications.ts` (ajout `notifyOpenMatchChatMessage`)
- Test: `backend/src/services/__tests__/openMatchChat.service.test.ts` (create)

- [ ] **Step 1: Écrire les tests d'accès, liste et post**

Créer `backend/src/services/__tests__/openMatchChat.service.test.ts`. Mocker `../../db/prisma`, `../sse.service`, `../../email/notifications` comme les autres suites du repo. Squelette :

```typescript
import { OpenMatchChatService } from '../openMatchChat.service';
import { prisma } from '../../db/prisma';
import { SSEService } from '../sse.service';

jest.mock('../../db/prisma', () => ({ prisma: {
  club: { findUnique: jest.fn() },
  clubMembership: { findUnique: jest.fn() },
  reservation: { findUnique: jest.fn() },
  openMatchInterest: { findUnique: jest.fn() },
  openMatchMessage: { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  clubMember: { findFirst: jest.fn() },
} }));
jest.mock('../../email/notifications', () => ({ notifyOpenMatchChatMessage: jest.fn() }));

const mock = prisma as unknown as Record<string, Record<string, jest.Mock>>;
const svc = new OpenMatchChatService();

function activeMatch(over: object = {}) {
  mock.club.findUnique.mockResolvedValue({ id: 'club1', status: 'ACTIVE' });
  mock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' });
  mock.reservation.findUnique.mockResolvedValue({
    visibility: 'PUBLIC', status: 'CONFIRMED',
    resource: { clubId: 'club1' },
    participants: [{ userId: 'org', isOrganizer: true }],
    ...over,
  });
  mock.openMatchInterest.findUnique.mockResolvedValue(null);
}

beforeEach(() => jest.clearAllMocks());

describe('OpenMatchChatService — accès', () => {
  it('refuse un non-membre/non-intéressé (CHAT_FORBIDDEN)', async () => {
    activeMatch(); // viewer 'stranger' n'est ni participant ni intéressé
    await expect(svc.listMessages('club', 'resa1', 'stranger')).rejects.toThrow('CHAT_FORBIDDEN');
  });
  it('autorise un participant', async () => {
    activeMatch();
    mock.openMatchMessage.findMany.mockResolvedValue([]);
    await expect(svc.listMessages('club', 'resa1', 'org')).resolves.toEqual([]);
  });
  it('autorise un intéressé', async () => {
    activeMatch();
    mock.openMatchInterest.findUnique.mockResolvedValue({ id: 'i1' });
    mock.openMatchMessage.findMany.mockResolvedValue([]);
    await expect(svc.listMessages('club', 'resa1', 'curious')).resolves.toEqual([]);
  });
});

describe('OpenMatchChatService — post', () => {
  it('rejette un message vide (VALIDATION_ERROR)', async () => {
    activeMatch();
    mock.openMatchInterest.findUnique.mockResolvedValue({ id: 'i1' });
    await expect(svc.postMessage('club', 'resa1', 'curious', '   ')).rejects.toThrow('VALIDATION_ERROR');
  });
  it('crée le message, diffuse en SSE et notifie', async () => {
    activeMatch();
    mock.openMatchMessage.create.mockResolvedValue({
      id: 'm1', body: 'salut', createdAt: new Date('2026-06-28T10:00:00Z'), deletedAt: null,
      user: { id: 'org', firstName: 'Org', lastName: 'Anizer', avatarUrl: null },
    });
    const spy = jest.spyOn(SSEService.getInstance(), 'broadcastMatch').mockImplementation(() => {});
    const out = await svc.postMessage('club', 'resa1', 'org', 'salut');
    expect(out.body).toBe('salut');
    expect(spy).toHaveBeenCalledWith('resa1', expect.objectContaining({ type: 'chat_message' }));
  });
});
```

- [ ] **Step 2: Lancer (échec attendu)**

Run : `cd backend && npx jest openMatchChat.service -i`
Expected : FAIL (module inexistant).

- [ ] **Step 3: Implémenter le service**

Créer `backend/src/services/openMatchChat.service.ts` :

```typescript
import { prisma } from '../db/prisma';
import { SSEService } from './sse.service';
import { notifyOpenMatchChatMessage } from '../email/notifications';

const MAX_BODY = 2000;

export interface ChatMessageDTO {
  id: string;
  author: { userId: string; firstName: string; lastName: string; avatarUrl: string | null };
  body: string;
  createdAt: string;
  deleted: boolean;
}

interface ChatContext {
  clubId: string;
  isParticipant: boolean;
  isOrganizer: boolean;
}

type MsgRow = {
  id: string; body: string; createdAt: Date; deletedAt: Date | null;
  user: { id: string; firstName: string; lastName: string; avatarUrl: string | null };
};

function toDTO(m: MsgRow): ChatMessageDTO {
  const deleted = m.deletedAt != null;
  return {
    id: m.id,
    author: { userId: m.user.id, firstName: m.user.firstName, lastName: m.user.lastName, avatarUrl: m.user.avatarUrl },
    body: deleted ? '' : m.body,
    createdAt: m.createdAt.toISOString(),
    deleted,
  };
}

export class OpenMatchChatService {
  /** Accès au chat : club ACTIVE, membre ACTIVE, résa PUBLIC/CONFIRMED, et participant OU intéressé. */
  private async assertChatAccess(slug: string, reservationId: string, userId: string): Promise<ChatContext> {
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, status: true } });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    const member = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId, clubId: club.id } },
      select: { status: true },
    });
    if (!member) throw new Error('MEMBERSHIP_REQUIRED');
    if (member.status === 'BLOCKED') throw new Error('MEMBERSHIP_BLOCKED');

    const resa = await prisma.reservation.findUnique({
      where: { id: reservationId },
      select: {
        visibility: true, status: true,
        resource: { select: { clubId: true } },
        participants: { select: { userId: true, isOrganizer: true } },
      },
    });
    if (!resa || resa.resource.clubId !== club.id) throw new Error('RESERVATION_NOT_FOUND');
    if (resa.visibility !== 'PUBLIC' || resa.status !== 'CONFIRMED') throw new Error('MATCH_NOT_JOINABLE');

    const part = resa.participants.find((p) => p.userId === userId);
    const isParticipant = !!part;
    let isInterested = false;
    if (!isParticipant) {
      const interest = await prisma.openMatchInterest.findUnique({
        where: { reservationId_userId: { reservationId, userId } },
        select: { id: true },
      });
      isInterested = !!interest;
    }
    if (!isParticipant && !isInterested) throw new Error('CHAT_FORBIDDEN');
    return { clubId: club.id, isParticipant, isOrganizer: !!part?.isOrganizer };
  }

  /** Fil chronologique (messages supprimés en pierre tombale). */
  async listMessages(slug: string, reservationId: string, userId: string): Promise<ChatMessageDTO[]> {
    await this.assertChatAccess(slug, reservationId, userId);
    const rows = await prisma.openMatchMessage.findMany({
      where: { reservationId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, body: true, createdAt: true, deletedAt: true,
        user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
      },
    });
    return rows.map(toDTO);
  }

  /** Poste un message : valide, crée, diffuse en SSE, notifie les absents (best-effort). */
  async postMessage(slug: string, reservationId: string, userId: string, rawBody: string): Promise<ChatMessageDTO> {
    await this.assertChatAccess(slug, reservationId, userId);
    const body = (rawBody ?? '').trim();
    if (!body || body.length > MAX_BODY) throw new Error('VALIDATION_ERROR');

    const created = await prisma.openMatchMessage.create({
      data: { reservationId, userId, body },
      select: {
        id: true, body: true, createdAt: true, deletedAt: true,
        user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
      },
    });
    const dto = toDTO(created);
    SSEService.getInstance().broadcastMatch(reservationId, { type: 'chat_message', message: dto });
    try { await notifyOpenMatchChatMessage(reservationId, created.id, userId); }
    catch (err) { console.error('[openMatchChat] notification échouée', err); }
    return dto;
  }

  /** Supprime un message (auteur, organisateur de la partie, ou staff OWNER/ADMIN du club). */
  async deleteMessage(slug: string, reservationId: string, userId: string, messageId: string): Promise<ChatMessageDTO> {
    const ctx = await this.assertChatAccess(slug, reservationId, userId);
    const msg = await prisma.openMatchMessage.findUnique({
      where: { id: messageId },
      select: { id: true, reservationId: true, userId: true, deletedAt: true },
    });
    if (!msg || msg.reservationId !== reservationId) throw new Error('MESSAGE_NOT_FOUND');

    let allowed = msg.userId === userId || ctx.isOrganizer;
    if (!allowed) {
      const staff = await prisma.clubMember.findFirst({
        where: { userId, clubId: ctx.clubId, role: { in: ['OWNER', 'ADMIN'] } },
        select: { id: true },
      });
      allowed = !!staff;
    }
    if (!allowed) throw new Error('NOT_ALLOWED');

    const updated = await prisma.openMatchMessage.update({
      where: { id: messageId },
      data: { deletedAt: new Date(), deletedById: userId },
      select: {
        id: true, body: true, createdAt: true, deletedAt: true,
        user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
      },
    });
    const dto = toDTO(updated);
    SSEService.getInstance().broadcastMatch(reservationId, { type: 'chat_deleted', message: dto });
    return dto;
  }
}
```

- [ ] **Step 4: Ajouter un stub temporaire de notification pour compiler le test**

Cette tâche dépend de `notifyOpenMatchChatMessage` (Task 6). Pour garder l'ordre TDD, ajouter d'abord un stub minimal dans `backend/src/email/notifications.ts` (corps complété en Task 6) :

```typescript
/** Notifie les membres du chat ABSENTS qu'un message a été posté (in-app + push). Complété en Task 6. */
export async function notifyOpenMatchChatMessage(_reservationId: string, _messageId: string, _authorUserId: string): Promise<void> {
  // implémentation en Task 6
}
```

- [ ] **Step 5: Lancer les tests (succès attendu)**

Run : `cd backend && npx jest openMatchChat.service -i`
Expected : PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/openMatchChat.service.ts backend/src/services/__tests__/openMatchChat.service.test.ts backend/src/email/notifications.ts
git commit -m "feat(parties): service chat (accès participant/intéressé, liste, post + diffusion SSE)"
```

---

## Task 6: Suppression (modération) + notification des absents

**Files:**
- Modify: `backend/src/services/__tests__/openMatchChat.service.test.ts`
- Modify: `backend/src/email/notifications.ts`

- [ ] **Step 1: Écrire les tests de suppression**

Ajouter à la suite :

```typescript
describe('OpenMatchChatService — suppression', () => {
  function msgBy(authorId: string) {
    mock.openMatchMessage.findUnique.mockResolvedValue({ id: 'm1', reservationId: 'resa1', userId: authorId, deletedAt: null });
    mock.openMatchMessage.update.mockResolvedValue({
      id: 'm1', body: 'x', createdAt: new Date('2026-06-28T10:00:00Z'), deletedAt: new Date('2026-06-28T11:00:00Z'),
      user: { id: authorId, firstName: 'A', lastName: 'B', avatarUrl: null },
    });
  }
  it('l’auteur peut supprimer son message (tombstone)', async () => {
    activeMatch(); mock.openMatchInterest.findUnique.mockResolvedValue({ id: 'i1' }); msgBy('curious');
    const out = await svc.deleteMessage('club', 'resa1', 'curious', 'm1');
    expect(out.deleted).toBe(true);
    expect(out.body).toBe('');
  });
  it('l’organisateur peut supprimer le message d’un autre', async () => {
    activeMatch(); msgBy('curious');
    await expect(svc.deleteMessage('club', 'resa1', 'org', 'm1')).resolves.toMatchObject({ deleted: true });
  });
  it('un tiers ne peut pas supprimer (NOT_ALLOWED)', async () => {
    activeMatch(); mock.openMatchInterest.findUnique.mockResolvedValue({ id: 'i1' }); msgBy('someoneElse');
    mock.clubMember.findFirst.mockResolvedValue(null);
    await expect(svc.deleteMessage('club', 'resa1', 'curious', 'm1')).rejects.toThrow('NOT_ALLOWED');
  });
});
```

- [ ] **Step 2: Lancer (la suppression passe déjà — implémentée en Task 5 ; vérifier)**

Run : `cd backend && npx jest openMatchChat.service -t "suppression" -i`
Expected : PASS (la logique `deleteMessage` existe déjà depuis Task 5 ; ce step verrouille son comportement par les tests).

- [ ] **Step 3: Écrire le test de ciblage des notifications**

Créer/compléter `backend/src/email/__tests__/notifications.openmatch-chat.test.ts` :

```typescript
import { notifyOpenMatchChatMessage } from '../notifications';
import { prisma } from '../../db/prisma';
import { dispatch } from '../../services/notification/dispatcher';
import { SSEService } from '../../services/sse.service';

jest.mock('../../db/prisma', () => ({ prisma: {
  reservation: { findUnique: jest.fn() },
  openMatchInterest: { findMany: jest.fn() },
  notification: { findFirst: jest.fn() },
} }));
jest.mock('../../services/notification/dispatcher', () => ({ dispatch: jest.fn() }));

const mock = prisma as unknown as Record<string, Record<string, jest.Mock>>;

beforeEach(() => jest.clearAllMocks());

it('notifie les membres du chat sauf l’auteur et sauf les connectés', async () => {
  mock.reservation.findUnique.mockResolvedValue({
    startTime: new Date('2026-06-28T10:00:00Z'), endTime: new Date('2026-06-28T11:00:00Z'),
    resource: { name: 'Court 1', club: { id: 'club1', slug: 'demo', timezone: 'Europe/Paris' } },
    participants: [{ userId: 'author' }, { userId: 'present' }, { userId: 'absent' }],
    openMatchMessages: [{ id: 'm1', body: 'coucou', user: { firstName: 'A', lastName: 'B' } }],
  });
  mock.openMatchInterest.findMany.mockResolvedValue([{ userId: 'curious' }]);
  mock.notification.findFirst.mockResolvedValue(null); // aucune notif non lue existante
  jest.spyOn(SSEService.getInstance(), 'getMatchUserIds').mockReturnValue(new Set(['present']));

  await notifyOpenMatchChatMessage('resa1', 'm1', 'author');

  const targets = (dispatch as jest.Mock).mock.calls.map((c) => c[0].userId).sort();
  expect(targets).toEqual(['absent', 'curious']); // author exclu (auteur), present exclu (connecté)
});
```

- [ ] **Step 4: Lancer (échec attendu — corps stub)**

Run : `cd backend && npx jest notifications.openmatch-chat -i`
Expected : FAIL (le stub ne dispatch rien).

- [ ] **Step 5: Implémenter `notifyOpenMatchChatMessage`**

Dans `backend/src/email/notifications.ts`, remplacer le stub de Task 5 par :

```typescript
/**
 * Notifie les membres du chat (participants + intéressés) ABSENTS du fil qu'un message
 * a été posté (in-app + push, pas d'email). Exclut l'auteur et les connectés au flux SSE.
 * Coalescing : on saute un destinataire qui a déjà une notif « message » non lue pour cette
 * partie (le badge in-app agrège, on n'empile pas un push par message).
 */
export async function notifyOpenMatchChatMessage(reservationId: string, messageId: string, authorUserId: string): Promise<void> {
  const resa = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: {
      resource: { select: { name: true, club: { select: { id: true, slug: true } } } },
      participants: { select: { userId: true } },
      openMatchMessages: { where: { id: messageId }, select: { id: true, body: true, user: { select: { firstName: true, lastName: true } } } },
    },
  });
  if (!resa) return;
  const msg = resa.openMatchMessages[0];
  if (!msg) return;

  const interests = await prisma.openMatchInterest.findMany({ where: { reservationId }, select: { userId: true } });
  const connected = SSEService.getInstance().getMatchUserIds(reservationId);

  const recipients = new Set<string>();
  for (const p of resa.participants) recipients.add(p.userId);
  for (const i of interests) recipients.add(i.userId);
  recipients.delete(authorUserId);
  for (const u of connected) recipients.delete(u);

  const club = resa.resource.club;
  const url = clubAppUrl(club.slug, '/parties');
  const authorName = fullName(msg.user);
  const snippet = msg.body.length > 80 ? `${msg.body.slice(0, 80)}…` : msg.body;

  for (const userId of recipients) {
    // Coalescing : déjà une notif « message » non lue pour cette partie → on ne ré-empile pas.
    const existing = await prisma.notification.findFirst({
      where: { userId, type: 'open_match.message', readAt: null, data: { path: ['matchId'], equals: reservationId } },
      select: { id: true },
    });
    if (existing) continue;
    await dispatch({
      userId, clubId: club.id, category: 'OPEN_MATCH_CHAT', type: 'open_match.message',
      title: `Nouveau message — ${resa.resource.name}`,
      body: `${authorName} : ${snippet}`,
      url, data: { matchId: reservationId }, email: null,
    });
  }
}
```

Vérifier que `SSEService` est importé en tête de `notifications.ts` ; sinon ajouter :

```typescript
import { SSEService } from '../services/sse.service';
```

- [ ] **Step 6: Lancer les tests (succès attendu)**

Run : `cd backend && npx jest openMatchChat.service notifications.openmatch-chat -i`
Expected : PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/email/notifications.ts backend/src/services/__tests__/openMatchChat.service.test.ts backend/src/email/__tests__/notifications.openmatch-chat.test.ts
git commit -m "feat(parties): notif chat aux absents (coalescing par notif non lue) + tests modération"
```

---

## Task 7: Routes interest + chat (clubs.ts)

**Files:**
- Modify: `backend/src/routes/clubs.ts`
- Test: `backend/src/routes/__tests__/clubs.openmatch-chat.routes.test.ts` (create)

- [ ] **Step 1: Écrire un test de routes (supertest, style du repo)**

S'inspirer d'un test de routes existant (`reservations.routes.test.ts`) pour le montage de l'app + mock des services. Créer `backend/src/routes/__tests__/clubs.openmatch-chat.routes.test.ts` couvrant :

```typescript
// - POST /:slug/open-matches/:id/interest -> 200, appelle openMatchService.setInterested(slug,id,userId)
// - DELETE /:slug/open-matches/:id/interest -> 200, appelle removeInterested
// - GET /:slug/open-matches/:id/chat/messages -> 200, renvoie le tableau de listMessages
// - POST /:slug/open-matches/:id/chat/messages avec { body } -> 200, appelle postMessage(...,body)
// - POST .../chat/messages avec body vide -> 400 (VALIDATION_ERROR mappé)
// - DELETE .../chat/messages/:messageId -> 200, appelle deleteMessage
// - CHAT_FORBIDDEN -> 403 ; MATCH_NOT_JOINABLE -> 409
```

> Réutiliser le harnais de mock d'auth déjà utilisé par les tests de routes (injection de `req.user`). Mocker `OpenMatchService` et `OpenMatchChatService`.

- [ ] **Step 2: Lancer (échec attendu)**

Run : `cd backend && npx jest clubs.openmatch-chat.routes -i`
Expected : FAIL (routes absentes).

- [ ] **Step 3: Ajouter les codes d'erreur au mapping**

Dans `backend/src/routes/clubs.ts`, dans l'objet `ERROR_STATUS`, ajouter (s'ils manquent) :

```typescript
  RESERVATION_NOT_FOUND: 404,
  MATCH_NOT_JOINABLE:    409,
  MATCH_IN_PAST:         409,
  ALREADY_PARTICIPANT:   409,
  CHAT_FORBIDDEN:        403,
  NOT_ALLOWED:           403,
  MESSAGE_NOT_FOUND:     404,
```

- [ ] **Step 4: Importer jwt, SSEService, le service chat et l'instancier**

En tête de `clubs.ts`, ajouter :

```typescript
import jwt from 'jsonwebtoken';
import { SSEService } from '../services/sse.service';
import { OpenMatchChatService } from '../services/openMatchChat.service';
```

Près des autres instances de service :

```typescript
const openMatchChatService = new OpenMatchChatService();
```

- [ ] **Step 5: Ajouter les routes (après le bloc open-matches existant, ~ligne 221)**

```typescript
// « Ça m'intéresse » sur une partie ouverte (n'occupe pas de place, débloque le chat).
router.post('/:slug/open-matches/:id/interest', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await openMatchService.setInterested(asString(req.params.slug), asString(req.params.id), req.user!.id)); }
  catch (err) { handleError(err, res, next); }
});
router.delete('/:slug/open-matches/:id/interest', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await openMatchService.removeInterested(asString(req.params.slug), asString(req.params.id), req.user!.id)); }
  catch (err) { handleError(err, res, next); }
});

// Chat de la partie ouverte (inscrits + intéressés).
router.get('/:slug/open-matches/:id/chat/messages', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await openMatchChatService.listMessages(asString(req.params.slug), asString(req.params.id), req.user!.id)); }
  catch (err) { handleError(err, res, next); }
});
router.post('/:slug/open-matches/:id/chat/messages', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = typeof (req.body as { body?: unknown }).body === 'string' ? (req.body as { body: string }).body : '';
    res.json(await openMatchChatService.postMessage(asString(req.params.slug), asString(req.params.id), req.user!.id, body));
  } catch (err) { handleError(err, res, next); }
});
router.delete('/:slug/open-matches/:id/chat/messages/:messageId', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await openMatchChatService.deleteMessage(asString(req.params.slug), asString(req.params.id), req.user!.id, asString(req.params.messageId))); }
  catch (err) { handleError(err, res, next); }
});

// Flux SSE du chat. EventSource ne pose pas d'en-tête Authorization → token en query, puis garde d'accès.
router.get('/:slug/open-matches/:id/chat/stream', async (req: AuthRequest, res: Response) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  let userId: string;
  try { userId = (jwt.verify(token, process.env.JWT_SECRET!) as { id: string }).id; }
  catch { return void res.status(401).end(); }
  try { await openMatchChatService.assertChatAccessPublic(asString(req.params.slug), asString(req.params.id), userId); }
  catch { return void res.status(403).end(); }
  SSEService.getInstance().addMatchClient(asString(req.params.id), userId, res);
});
```

- [ ] **Step 6: Exposer la garde d'accès pour la route stream**

`assertChatAccess` est privée. Ajouter dans `openMatchChat.service.ts` une façade publique réutilisant la même garde :

```typescript
  /** Variante publique de la garde d'accès, pour la route SSE (lève si pas d'accès). */
  async assertChatAccessPublic(slug: string, reservationId: string, userId: string): Promise<void> {
    await this.assertChatAccess(slug, reservationId, userId);
  }
```

- [ ] **Step 7: Lancer les tests (succès attendu)**

Run : `cd backend && npx jest clubs.openmatch-chat.routes -i`
Expected : PASS.

- [ ] **Step 8: Vérifier la compilation globale backend**

Run : `cd backend && npx tsc --noEmit`
Expected : PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/src/routes/clubs.ts backend/src/services/openMatchChat.service.ts backend/src/routes/__tests__/clubs.openmatch-chat.routes.test.ts
git commit -m "feat(parties): routes interest + chat (messages CRUD + flux SSE)"
```

---

## Task 8: API client (types + méthodes + URL stream)

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Enrichir le type `OpenMatch` et ajouter `OpenMatchMessage`**

Dans `frontend/lib/api.ts`, étendre l'interface `OpenMatch` (ajouter les champs) :

```typescript
  interestedCount: number;
  viewerIsInterested: boolean;
  interested: OpenMatchPlayer[];
  lastMessageAt: string | null;
```

Ajouter, près de `OpenMatch` :

```typescript
export interface OpenMatchMessage {
  id: string;
  author: { userId: string; firstName: string; lastName: string; avatarUrl: string | null };
  body: string;
  createdAt: string;
  deleted: boolean;
}
```

- [ ] **Step 2: Ajouter les méthodes API + l'URL du flux**

Après le bloc `// --- Parties ouvertes (membres du club) ---` (méthodes existantes), ajouter dans l'objet `api` :

```typescript
  setInterested: (slug: string, id: string, token: string) =>
    request<{ id: string }>(`/api/clubs/${slug}/open-matches/${id}/interest`, { method: 'POST' }, token),
  removeInterested: (slug: string, id: string, token: string) =>
    request<{ id: string }>(`/api/clubs/${slug}/open-matches/${id}/interest`, { method: 'DELETE' }, token),
  getChatMessages: (slug: string, id: string, token: string) =>
    request<OpenMatchMessage[]>(`/api/clubs/${slug}/open-matches/${id}/chat/messages`, {}, token),
  postChatMessage: (slug: string, id: string, body: string, token: string) =>
    request<OpenMatchMessage>(`/api/clubs/${slug}/open-matches/${id}/chat/messages`, { method: 'POST', body: JSON.stringify({ body }) }, token),
  deleteChatMessage: (slug: string, id: string, messageId: string, token: string) =>
    request<OpenMatchMessage>(`/api/clubs/${slug}/open-matches/${id}/chat/messages/${messageId}`, { method: 'DELETE' }, token),
```

Exporter un helper d'URL pour l'`EventSource` (à côté de `assetUrl`, qui utilise déjà `BASE_URL`) :

```typescript
/** URL du flux SSE du chat d'une partie (token en query : EventSource ne pose pas d'en-tête). */
export function chatStreamUrl(slug: string, id: string, token: string): string {
  return `${BASE_URL}/api/clubs/${slug}/open-matches/${id}/chat/stream?token=${encodeURIComponent(token)}`;
}
```

- [ ] **Step 3: Vérifier la compilation front**

Run : `cd frontend && npx tsc --noEmit`
Expected : PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(parties): API client chat + intérêt (types, méthodes, chatStreamUrl)"
```

---

## Task 9: `OpenMatchChatSheet` (feuille de chat temps réel)

**Files:**
- Create: `frontend/components/openmatch/OpenMatchChatSheet.tsx`
- Test: `frontend/__tests__/OpenMatchChatSheet.test.tsx` (create)

- [ ] **Step 1: Écrire le test de la feuille**

Créer `frontend/__tests__/OpenMatchChatSheet.test.tsx`. Mocker `@/lib/api` (exposer `api`, `assetUrl`, `chatStreamUrl`) et fournir un `EventSource` pilotable :

```typescript
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { OpenMatchChatSheet } from '@/components/openmatch/OpenMatchChatSheet';

let lastES: FakeES | null = null;
class FakeES {
  url: string; onmessage: ((e: { data: string }) => void) | null = null; onerror: (() => void) | null = null;
  constructor(url: string) { this.url = url; lastES = this; }
  close() {}
  emit(obj: unknown) { this.onmessage?.({ data: JSON.stringify(obj) }); }
}
(global as unknown as { EventSource: unknown }).EventSource = FakeES;

jest.mock('@/lib/api', () => ({
  assetUrl: (p: string | null) => p,
  chatStreamUrl: (_s: string, _i: string, _t: string) => 'http://x/stream',
  api: {
    getChatMessages: jest.fn().mockResolvedValue([
      { id: 'm1', author: { userId: 'u2', firstName: 'Bob', lastName: 'Y', avatarUrl: null }, body: 'salut', createdAt: '2026-06-28T10:00:00Z', deleted: false },
    ]),
    postChatMessage: jest.fn().mockResolvedValue({ id: 'm2', author: { userId: 'u1', firstName: 'Moi', lastName: 'X', avatarUrl: null }, body: 'yo', createdAt: '2026-06-28T10:01:00Z', deleted: false }),
    deleteChatMessage: jest.fn().mockResolvedValue({}),
  },
}));

const baseProps = {
  slug: 'demo', token: 't', reservationId: 'resa1', viewerUserId: 'u1',
  viewerIsOrganizer: false, title: 'Court 1 · sam. 28', timezone: 'Europe/Paris',
  onClose: jest.fn(),
};

function renderSheet(over = {}) {
  return render(<OpenMatchChatSheet {...baseProps} {...over} />);
}

it('charge et affiche le fil', async () => {
  renderSheet();
  expect(await screen.findByText('salut')).toBeInTheDocument();
});

it('envoie un message (optimiste) et appelle l’API', async () => {
  renderSheet();
  await screen.findByText('salut');
  fireEvent.change(screen.getByPlaceholderText(/message/i), { target: { value: 'yo' } });
  fireEvent.click(screen.getByRole('button', { name: /envoyer/i }));
  await waitFor(() => expect(require('@/lib/api').api.postChatMessage).toHaveBeenCalledWith('demo', 'resa1', 'yo', 't'));
});

it('reçoit un message en SSE et l’ajoute au fil', async () => {
  renderSheet();
  await screen.findByText('salut');
  act(() => lastES!.emit({ type: 'chat_message', message: { id: 'm9', author: { userId: 'u3', firstName: 'Zoe', lastName: 'W', avatarUrl: null }, body: 'coucou', createdAt: '2026-06-28T10:02:00Z', deleted: false } }));
  expect(await screen.findByText('coucou')).toBeInTheDocument();
});

it('rend une pierre tombale pour un message supprimé reçu en SSE', async () => {
  renderSheet();
  await screen.findByText('salut');
  act(() => lastES!.emit({ type: 'chat_deleted', message: { id: 'm1', author: { userId: 'u2', firstName: 'Bob', lastName: 'Y', avatarUrl: null }, body: '', createdAt: '2026-06-28T10:00:00Z', deleted: true } }));
  expect(await screen.findByText(/message supprimé/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Lancer (échec attendu)**

Run : `cd frontend && npx jest OpenMatchChatSheet`
Expected : FAIL (composant inexistant).

- [ ] **Step 3: Implémenter la feuille**

Créer `frontend/components/openmatch/OpenMatchChatSheet.tsx` :

```tsx
'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { api, assetUrl, chatStreamUrl, OpenMatchMessage } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { colorForSeed } from '@/lib/playerColors';

export interface OpenMatchChatSheetProps {
  slug: string;
  token: string;
  reservationId: string;
  viewerUserId: string;
  viewerIsOrganizer: boolean;
  title: string;
  timezone: string;
  onClose: () => void;
}

function hhmm(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso)).replace(':', 'h');
}

export function OpenMatchChatSheet({ slug, token, reservationId, viewerUserId, viewerIsOrganizer, title, timezone, onClose }: OpenMatchChatSheetProps) {
  const { th } = useTheme();
  const [messages, setMessages] = useState<OpenMatchMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<OpenMatchMessage | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Upsert par id (la diffusion SSE peut doubler notre envoi optimiste).
  const upsert = useCallback((m: OpenMatchMessage) => {
    setMessages((prev) => {
      const i = prev.findIndex((x) => x.id === m.id);
      if (i === -1) return [...prev, m];
      const next = prev.slice(); next[i] = m; return next;
    });
  }, []);

  useEffect(() => {
    let alive = true;
    api.getChatMessages(slug, reservationId, token).then((rows) => { if (alive) setMessages(rows); }).catch(() => {});
    return () => { alive = false; };
  }, [slug, reservationId, token]);

  useEffect(() => {
    const es = new EventSource(chatStreamUrl(slug, reservationId, token));
    es.onmessage = (e: MessageEvent) => {
      try {
        const evt = JSON.parse(e.data) as { type: string; message?: OpenMatchMessage };
        if ((evt.type === 'chat_message' || evt.type === 'chat_deleted') && evt.message) upsert(evt.message);
      } catch { /* ignore */ }
    };
    es.onerror = () => { /* EventSource reconnecte tout seul */ };
    return () => es.close();
  }, [slug, reservationId, token, upsert]);

  // Auto-scroll en bas à chaque nouveau message.
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [messages]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true); setDraft('');
    try { upsert(await api.postChatMessage(slug, reservationId, body, token)); }
    catch { setDraft(body); }
    finally { setSending(false); }
  };

  const canDelete = (m: OpenMatchMessage) => !m.deleted && (m.author.userId === viewerUserId || viewerIsOrganizer);

  const doDelete = async (m: OpenMatchMessage) => {
    try { upsert(await api.deleteChatMessage(slug, reservationId, m.id, token)); }
    catch { /* best-effort */ }
    finally { setPendingDelete(null); }
  };

  return (
    <div role="dialog" aria-label="Discussion de la partie"
      style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', background: 'rgba(0,0,0,0.4)' }}
      onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: th.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: `1px solid ${th.line}` }}>
          <Icon name="users" size={18} color={th.accent} />
          <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 15, color: th.text }}>{title}</span>
          <button type="button" aria-label="Fermer" onClick={onClose}
            style={{ marginLeft: 'auto', border: 'none', background: 'transparent', cursor: 'pointer', color: th.textMute, fontSize: 20 }}>×</button>
        </div>

        <div ref={listRef} style={{ overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
          {messages.length === 0 ? (
            <div style={{ textAlign: 'center', color: th.textFaint, fontFamily: th.fontUI, fontSize: 13.5, padding: '24px 0' }}>
              Aucun message. Lancez la discussion !
            </div>
          ) : messages.map((m) => {
            const mine = m.author.userId === viewerUserId;
            return (
              <div key={m.id} style={{ display: 'flex', gap: 8, flexDirection: mine ? 'row-reverse' : 'row', alignItems: 'flex-end' }}>
                <Avatar firstName={m.author.firstName} lastName={m.author.lastName} src={assetUrl(m.author.avatarUrl)} size={28} color={colorForSeed(m.author.userId)} />
                <div style={{ maxWidth: '72%' }}>
                  <div style={{ fontFamily: th.fontUI, fontSize: 11.5, color: th.textFaint, marginBottom: 2, textAlign: mine ? 'right' : 'left' }}>
                    {m.author.firstName} · {hhmm(m.createdAt, timezone)}
                  </div>
                  <div style={{ background: mine ? th.accent : th.surface, color: mine ? th.onAccent : th.text, borderRadius: 14, padding: '8px 12px', fontFamily: th.fontUI, fontSize: 14, fontStyle: m.deleted ? 'italic' : 'normal', opacity: m.deleted ? 0.6 : 1 }}>
                    {m.deleted ? 'message supprimé' : m.body}
                  </div>
                  {canDelete(m) && (
                    <button type="button" onClick={() => setPendingDelete(m)}
                      style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textFaint, fontFamily: th.fontUI, fontSize: 11.5, marginTop: 2, padding: 0, textAlign: mine ? 'right' : 'left', width: '100%' }}>
                      Supprimer
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 8, padding: '10px 16px', borderTop: `1px solid ${th.line}`, paddingBottom: 'max(10px, env(safe-area-inset-bottom))' }}>
          <input value={draft} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Votre message…" maxLength={2000}
            style={{ flex: 1, border: `1px solid ${th.line}`, borderRadius: 12, padding: '10px 12px', fontFamily: th.fontUI, fontSize: 14, background: th.surface, color: th.text }} />
          <button type="button" aria-label="Envoyer" onClick={send} disabled={sending || !draft.trim()}
            style={{ border: 'none', borderRadius: 12, padding: '0 16px', background: th.accent, color: th.onAccent, fontFamily: th.fontUI, fontWeight: 700, cursor: sending || !draft.trim() ? 'default' : 'pointer', opacity: sending || !draft.trim() ? 0.5 : 1 }}>
            Envoyer
          </button>
        </div>
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title="Supprimer le message"
          message="Ce message sera retiré de la discussion."
          confirmLabel="Supprimer" cancelLabel="Annuler"
          onConfirm={() => doDelete(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
```

> Vérifier les props réelles de `Avatar` (`firstName`/`lastName`/`src`/`size`/`color`) et de `ConfirmDialog` (`onConfirm`/`onCancel`/`busy?`) dans le repo ; ajuster les noms si besoin. `colorForSeed` vient de `@/lib/playerColors` (déjà utilisé ailleurs).

- [ ] **Step 4: Lancer les tests (succès attendu)**

Run : `cd frontend && npx jest OpenMatchChatSheet`
Expected : PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/openmatch/OpenMatchChatSheet.tsx frontend/__tests__/OpenMatchChatSheet.test.tsx
git commit -m "feat(parties): feuille de chat temps réel (SSE, optimiste, suppression)"
```

---

## Task 10: Carte — bouton « Ça m'intéresse », compteur, « Discuter »

**Files:**
- Modify: `frontend/components/openmatch/OpenMatchCard.tsx`
- Test: `frontend/__tests__/OpenMatchCard.test.tsx` (create)

- [ ] **Step 1: Écrire le test de la carte**

Créer `frontend/__tests__/OpenMatchCard.test.tsx`. Mock minimal de `ThemeProvider`/`@/lib/api` selon le style des tests existants. Couvrir :

```typescript
// - non-participant, non-intéressé : bouton « Ça m'intéresse » présent ; clic -> onToggleInterest(m)
// - viewerIsInterested : le bouton « Discuter » est activé (pas disabled)
// - non-participant non-intéressé : « Discuter » désactivé (disabled)
// - interestedCount=3 : un libellé « 3 intéressés » (ou compteur) est rendu
```

> Fournir un `match` complet (champs `interestedCount`, `viewerIsInterested`, `interested`, `lastMessageAt`).

- [ ] **Step 2: Lancer (échec attendu)**

Run : `cd frontend && npx jest OpenMatchCard`
Expected : FAIL.

- [ ] **Step 3: Étendre les props de la carte**

Dans `frontend/components/openmatch/OpenMatchCard.tsx`, ajouter à `OpenMatchCardProps` :

```typescript
  onToggleInterest: (m: OpenMatch) => void;
  onOpenChat: (m: OpenMatch) => void;
  hasUnread: boolean;
```

- [ ] **Step 4: Rendre le compteur d'intéressés + boutons**

Dans le chip d'en-tête (rangée `marginLeft:'auto'`), après le chip de places, ajouter le compteur :

```tsx
          {m.interestedCount > 0 && (
            <Chip tone="line" icon="users">{m.interestedCount} intéressé{m.interestedCount > 1 ? 's' : ''}</Chip>
          )}
```

Dans la colonne d'actions (le bloc `flexDirection:'column'` à droite), ajouter le bouton « Discuter » (toujours présent, activé selon l'accès) et, pour un non-participant, le toggle d'intérêt :

```tsx
          <Btn variant="surface" icon="users" disabled={!(m.viewerIsParticipant || m.viewerIsInterested)} onClick={() => onOpenChat(m)}>
            Discuter{hasUnread ? ' •' : ''}
          </Btn>
          {!m.viewerIsParticipant && (
            <Btn variant={m.viewerIsInterested ? 'accent' : 'surface'} disabled={busy} onClick={() => onToggleInterest(m)}>
              {m.viewerIsInterested ? 'Intéressé ✓' : 'Ça m’intéresse'}
            </Btn>
          )}
```

> Vérifier les variantes réelles de `Btn` (`'surface'`/`'accent'` sont utilisées dans le fichier) et l'icône `users` (déjà présente). Adapter `icon="users"`/`icon="chat"` à une icône existante de `components/ui/Icon.tsx`.

- [ ] **Step 5: Lancer les tests (succès attendu)**

Run : `cd frontend && npx jest OpenMatchCard`
Expected : PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/openmatch/OpenMatchCard.tsx frontend/__tests__/OpenMatchCard.test.tsx
git commit -m "feat(parties): carte — « Ça m'intéresse », compteur, bouton Discuter"
```

---

## Task 11: Câblage `OpenMatches` (handlers + feuille + non-lu + erreurs)

**Files:**
- Modify: `frontend/components/openmatch/OpenMatches.tsx`
- Modify: `frontend/__tests__/OpenMatches.test.tsx`

- [ ] **Step 1: Étendre le test d'intégration**

Dans `frontend/__tests__/OpenMatches.test.tsx`, ajouter au mock `api` les nouvelles méthodes (`setInterested`, `removeInterested`, `getChatMessages`, `postChatMessage`, `deleteChatMessage`) et `chatStreamUrl`/`assetUrl`. Ajouter des cas :

```typescript
// - clic « Ça m'intéresse » -> api.setInterested(slug, id, token) appelé puis rechargement
// - clic « Discuter » sur une partie où viewerIsInterested -> la feuille (role="dialog") s'ouvre
```

- [ ] **Step 2: Lancer (échec attendu)**

Run : `cd frontend && npx jest OpenMatches`
Expected : FAIL.

- [ ] **Step 3: Câbler les handlers + l'état de la feuille**

Dans `frontend/components/openmatch/OpenMatches.tsx` :

Ajouter l'import :
```typescript
import { OpenMatchChatSheet } from '@/components/openmatch/OpenMatchChatSheet';
```

Ajouter les libellés d'erreur au dico `JOIN_ERRORS` :
```typescript
  ALREADY_PARTICIPANT:   'Vous participez déjà à cette partie.',
  CHAT_FORBIDDEN:        'Réservé aux inscrits et aux intéressés.',
  NOT_ALLOWED:           'Action non autorisée.',
  RESERVATION_NOT_FOUND: "Cette partie n'existe plus.",
```

Ajouter l'état de la feuille :
```typescript
  const [chatting, setChatting] = useState<OpenMatch | null>(null);
```

Helper « non-lu » (lecture locale par partie) — au-dessus du `return` :
```typescript
  const lastReadKey = (id: string) => `palova:match-chat-read:${id}`;
  const hasUnread = (m: OpenMatch) => {
    if (!m.lastMessageAt || typeof window === 'undefined') return false;
    const seen = window.localStorage.getItem(lastReadKey(m.id));
    return !seen || new Date(m.lastMessageAt) > new Date(seen);
  };
  const openChat = (m: OpenMatch) => {
    if (typeof window !== 'undefined') window.localStorage.setItem(lastReadKey(m.id), new Date().toISOString());
    setChatting(m);
  };
  const toggleInterest = (m: OpenMatch) =>
    act(m, () => (m.viewerIsInterested ? api.removeInterested(club.slug, m.id, token!) : api.setInterested(club.slug, m.id, token!)));
```

Passer les nouvelles props aux **deux** rendus `<OpenMatchCard>` (section « Pour toi » et « Autres ») :
```tsx
                  onToggleInterest={toggleInterest}
                  onOpenChat={openChat}
                  hasUnread={hasUnread(m)}
```

Rendre la feuille (avant la fermeture de `<Screen>`, à côté des autres modales) :
```tsx
      {chatting && token && (
        <OpenMatchChatSheet
          slug={club.slug} token={token} reservationId={chatting.id} viewerUserId={/* id du viewer */ ''}
          viewerIsOrganizer={chatting.viewerIsOrganizer}
          title={`${chatting.resourceName} · ${new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: club.timezone }).format(new Date(chatting.startTime)).replace(':', 'h')}`}
          timezone={club.timezone}
          onClose={() => { setChatting(null); load(); }}
        />
      )}
```

> `viewerUserId` : récupérer l'id du joueur connecté comme ailleurs dans le composant. Si `OpenMatches` n'a pas déjà l'id du viewer, l'obtenir via le profil (`api.getMyProfile(token)` au montage, comme `myLevel`) et le stocker dans un state `viewerUserId`. Détailler ce petit ajout au moment de l'implémentation (un `useEffect` qui set `viewerUserId`).

- [ ] **Step 4: Lancer les tests (succès attendu)**

Run : `cd frontend && npx jest OpenMatches`
Expected : PASS.

- [ ] **Step 5: Vérifier la compilation front + lint**

Run : `cd frontend && npx tsc --noEmit`
Expected : PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/openmatch/OpenMatches.tsx frontend/__tests__/OpenMatches.test.tsx
git commit -m "feat(parties): câblage intérêt + ouverture du chat + pastille non-lu"
```

---

## Task 12: Libellé de la catégorie de notification `OPEN_MATCH_CHAT`

**Files:**
- Modify: écran de préférences de notifications (à localiser)

- [ ] **Step 1: Localiser l'écran de préférences**

Run : `cd frontend && grep -rln "MY_GAMES\|notification-preferences\|CLUB_MESSAGES" components app lib | grep -v ".next"`
Repérer le composant qui mappe les `NotificationCategory` à des libellés FR.

- [ ] **Step 2: Ajouter le libellé**

Dans la table de libellés des catégories, ajouter l'entrée :
```typescript
  OPEN_MATCH_CHAT: 'Messages de partie',
```
(et, si une liste ordonnée des catégories affichées existe, y insérer `OPEN_MATCH_CHAT`).

- [ ] **Step 3: Vérifier le rendu (test existant des préférences, s'il existe)**

Run : `cd frontend && npx jest -t "préférence" 2>/dev/null || npx tsc --noEmit`
Expected : PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend
git commit -m "feat(parties): libellé préférence « Messages de partie » (OPEN_MATCH_CHAT)"
```

---

## Task 13: Vérification finale (suites complètes + smoke manuel)

**Files:** aucun (vérification)

- [ ] **Step 1: Suite backend complète**

Run : `cd backend && npx jest -i`
Expected : PASS (aucune régression).

- [ ] **Step 2: Suite frontend complète**

Run : `cd frontend && npx jest`
Expected : PASS.

- [ ] **Step 3: Compilation des deux côtés**

Run : `cd backend && npx tsc --noEmit && cd ../frontend && npx tsc --noEmit`
Expected : PASS.

- [ ] **Step 4: Smoke manuel (deux comptes membres)**

Avec Docker + backend + frontend lancés (cf. CLAUDE.md), sur `/parties` :
1. Compte A crée une partie ouverte (réserver → « Partie ouverte »).
2. Compte B clique « Ça m'intéresse » → A reçoit une notif (cloche), compteur « 1 intéressé » visible.
3. B ouvre « Discuter », envoie un message ; A (chat fermé) reçoit une notif, (chat ouvert) le voit en direct.
4. A supprime le message de B → pierre tombale « message supprimé » des deux côtés.
5. Vérifier qu'un compte C **non membre du club** reçoit 403 sur le chat (pas d'accès).

- [ ] **Step 5: Commit (si ajustements)**

```bash
git add -A && git commit -m "test(parties): vérification finale chat + intérêt"
```

---

## Self-review (couverture spec)

- Audience inscrits + intéressés → Tasks 3, 5 (`assertChatAccess` participant OU intérêt).
- État « Ça m'intéresse » sans place + clear au join → Tasks 3, 4.
- Compteur visible + notif organisateur → Tasks 3 (`notifyOpenMatchInterest`), 4 (`interestedCount`), 10 (chip).
- Temps réel SSE → Tasks 2 (canal), 7 (route stream), 9 (EventSource).
- Notif aux absents (in-app + push, coalescing, pas d'email) → Task 6.
- Feuille depuis la carte → Tasks 9, 10, 11.
- Modération auteur/organisateur/admin + soft-delete tombstone → Tasks 5, 6, 9.
- Catégorie `OPEN_MATCH_CHAT` + préférence → Tasks 1, 12.

**Écart assumé vs spec :** le coalescing « push » de la spec est réalisé via la **notification in-app non lue** (Task 6) plutôt qu'un cache mémoire — même effet (un rappel par partie tant qu'on n'a pas lu), sans état volatil. Limite connue : un destinataire qui a coupé l'in-app mais gardé le push n'est pas coalescé (cas marginal).
