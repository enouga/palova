# Amis — opt-in + demandes d'ami — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter une **amitié confirmée** (opt-in profil + demande→acceptation) par-dessus le suivi existant, sans toucher au suivi.

**Architecture:** Un nouveau modèle `Friendship` (une ligne canonique par paire, `PENDING`/`ACCEPTED`) + un flag `User.acceptsFriendRequests`. Service `FriendshipService` isolé (miroir de `FollowService`), notifications réutilisant la catégorie `SOCIAL`, routes club-scopées, et un `FriendButton` + réorg du hub `/me/friends`. Le suivi (`Follow`) reste inchangé ; le `FollowButton` cesse juste d'afficher « Amis » sur un suivi mutuel.

**Tech Stack:** Prisma 7 (PostgreSQL), Express 5, Jest + supertest (backend, Prisma **mocké**) ; Next 16 / React 19, React Testing Library (frontend).

**Spec :** `docs/superpowers/specs/2026-07-01-amis-opt-in-demandes-design.md`

**Conventions du repo à respecter :**
- Backend : services en classe, gardes `activeClubId`/`assertActiveMember`, `handleError`/`ERROR_STATUS` dans `clubs.ts`, `dispatch` (importé de `services/notification/dispatcher`) pour les notifs, tests avec `prismaMock` (`src/__mocks__/prisma`).
- Migration : base DEV en dérive → **ne pas** `prisma db push` ni `migrate dev` ; appliquer le SQL additif via `prisma db execute` puis `prisma generate` (cf. mémoire « migrate deploy, not migrate dev »). Le fichier de migration est commité pour la prod (`migrate deploy`).
- Frontend : styles inline via `useTheme()`, pas de `new Date()` au rendu.

---

## Task 1 : Migration — `User.acceptsFriendRequests` + modèle `Friendship`

**Files:**
- Modify: `backend/prisma/schema.prisma` (User + nouveau modèle + enum)
- Create: `backend/prisma/migrations/20260701000000_add_friendships/migration.sql`

- [ ] **Step 1: Ajouter le champ et les relations au modèle `User`**

Dans `backend/prisma/schema.prisma`, modèle `User`, après la ligne `autoMatchProposals ...` (l. ~430) ajouter :

```prisma
  /// Opt-in : autoriser les autres membres à m'envoyer une demande d'ami (ne concerne PAS le chat).
  acceptsFriendRequests Boolean @default(false) @map("accepts_friend_requests")
```

Puis dans le bloc des relations de `User` (après `followsReceived ...`, l. ~468) ajouter :

```prisma
  friendshipsA           Friendship[] @relation("FriendshipA")
  friendshipsB           Friendship[] @relation("FriendshipB")
```

- [ ] **Step 2: Ajouter l'enum + le modèle `Friendship`**

Juste après le modèle `Follow` (l. ~1346) :

```prisma
enum FriendshipStatus {
  PENDING
  ACCEPTED
}

/// Amitié confirmée (réciproque, consentie). GLOBALE (pas de clubId) : le club de contexte
/// sert seulement à brander la notif. Paire canonique userAId < userBId (une seule ligne).
model Friendship {
  id            String           @id @default(cuid())
  userAId       String           @map("user_a_id")
  userBId       String           @map("user_b_id")
  requestedById String           @map("requested_by_id")
  status        FriendshipStatus @default(PENDING)
  createdAt     DateTime         @default(now()) @map("created_at")
  respondedAt   DateTime?        @map("responded_at")

  userA User @relation("FriendshipA", fields: [userAId], references: [id], onDelete: Cascade)
  userB User @relation("FriendshipB", fields: [userBId], references: [id], onDelete: Cascade)

  @@unique([userAId, userBId])
  @@index([userBId])
  @@map("friendships")
}
```

- [ ] **Step 3: Écrire le SQL de migration (additif, idempotent)**

Créer `backend/prisma/migrations/20260701000000_add_friendships/migration.sql` :

```sql
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "accepts_friend_requests" BOOLEAN NOT NULL DEFAULT false;

DO $$ BEGIN
  CREATE TYPE "FriendshipStatus" AS ENUM ('PENDING', 'ACCEPTED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "friendships" (
  "id" TEXT NOT NULL,
  "user_a_id" TEXT NOT NULL,
  "user_b_id" TEXT NOT NULL,
  "requested_by_id" TEXT NOT NULL,
  "status" "FriendshipStatus" NOT NULL DEFAULT 'PENDING',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "responded_at" TIMESTAMP(3),
  CONSTRAINT "friendships_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "friendships_user_a_id_user_b_id_key" ON "friendships"("user_a_id", "user_b_id");
CREATE INDEX IF NOT EXISTS "friendships_user_b_id_idx" ON "friendships"("user_b_id");

DO $$ BEGIN
  ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_a_id_fkey"
    FOREIGN KEY ("user_a_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_b_id_fkey"
    FOREIGN KEY ("user_b_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
```

- [ ] **Step 4: Appliquer en DEV (surgical, sans toucher les autres migrations en attente) + régénérer le client**

Run (depuis `backend/`) :
```bash
npx prisma db execute --file prisma/migrations/20260701000000_add_friendships/migration.sql --schema prisma/schema.prisma
npx prisma generate
```
Expected: `Script executed successfully.` puis `Generated Prisma Client`.

- [ ] **Step 5: Vérifier que le client typé connaît le modèle**

Run: `npx tsc --noEmit` (depuis `backend/`)
Expected: PASS (aucune erreur — `prisma.friendship` et `User.acceptsFriendRequests` sont typés).

- [ ] **Step 6: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260701000000_add_friendships
git commit -m "feat(amis): schema Friendship + opt-in acceptsFriendRequests"
```

---

## Task 2 : Notifications `friend.request` / `friend.accepted`

**Files:**
- Modify: `backend/src/email/notifications.ts` (ajouter 2 fonctions près de `notifyNewFollower`, l. ~1264)
- Test: `backend/src/email/__tests__/notifications.friend.test.ts`

- [ ] **Step 1: Écrire le test qui échoue**

Créer `backend/src/email/__tests__/notifications.friend.test.ts` :

```ts
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';

const mockDispatch = jest.fn();
jest.mock('../../services/notification/dispatcher', () => ({ dispatch: (...a: unknown[]) => mockDispatch(...a) }));

import { notifyFriendRequest, notifyFriendAccepted } from '../notifications';

describe('notifyFriendRequest', () => {
  beforeEach(() => {
    mockDispatch.mockReset().mockResolvedValue(undefined);
    prismaMock.user.findUnique.mockResolvedValue({ firstName: 'Léa', lastName: 'M' } as any);
    prismaMock.notification.findFirst.mockResolvedValue(null);
  });

  it('dispatche une notif SOCIAL friend.request in-app/push sans email', async () => {
    await notifyFriendRequest('u1', 'u2', 'club-demo');
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    const arg = mockDispatch.mock.calls[0][0];
    expect(arg).toMatchObject({ userId: 'u2', clubId: 'club-demo', category: 'SOCIAL', type: 'friend.request', data: { requesterId: 'u1' } });
    expect(arg.email).toBeFalsy();
    expect(arg.url).toBe('/me/friends?tab=demandes');
  });

  it('coalesce : ne renotifie pas si une demande non lue du même émetteur existe', async () => {
    prismaMock.notification.findFirst.mockResolvedValue({ id: 'n1' } as any);
    await notifyFriendRequest('u1', 'u2', 'club-demo');
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});

describe('notifyFriendAccepted', () => {
  beforeEach(() => {
    mockDispatch.mockReset().mockResolvedValue(undefined);
    prismaMock.user.findUnique.mockResolvedValue({ firstName: 'Tom', lastName: 'B' } as any);
  });

  it('dispatche friend.accepted au demandeur d\'origine', async () => {
    await notifyFriendAccepted('u2', 'u1', 'club-demo');
    const arg = mockDispatch.mock.calls[0][0];
    expect(arg).toMatchObject({ userId: 'u1', clubId: 'club-demo', category: 'SOCIAL', type: 'friend.accepted', data: { accepterId: 'u2' } });
    expect(arg.url).toBe('/me/friends');
  });
});
```

- [ ] **Step 2: Lancer le test (échoue)**

Run: `npx jest notifications.friend --silent` (depuis `backend/`)
Expected: FAIL (`notifyFriendRequest is not a function`).

- [ ] **Step 3: Implémenter les 2 fonctions**

Dans `backend/src/email/notifications.ts`, après la fin de `notifyNewFollower` (l. ~1264) :

```ts
export async function notifyFriendRequest(requesterId: string, targetId: string, clubId: string): Promise<void> {
  const requester = await prisma.user.findUnique({ where: { id: requesterId }, select: { firstName: true, lastName: true } });
  if (!requester) return;
  const already = await prisma.notification.findFirst({
    where: { userId: targetId, type: 'friend.request', readAt: null, data: { path: ['requesterId'], equals: requesterId } },
    select: { id: true },
  });
  if (already) return;
  const name = `${requester.firstName} ${requester.lastName}`.trim();
  await dispatch({
    userId: targetId,
    clubId,
    category: 'SOCIAL',
    type: 'friend.request',
    title: `${name} veut vous ajouter en ami`,
    body: `${name} vous a envoyé une demande d'ami. Ouvrez « Mes amis » pour l'accepter.`,
    url: '/me/friends?tab=demandes',
    data: { requesterId },
    email: null,
  });
}

export async function notifyFriendAccepted(accepterId: string, requesterId: string, clubId: string): Promise<void> {
  const accepter = await prisma.user.findUnique({ where: { id: accepterId }, select: { firstName: true, lastName: true } });
  if (!accepter) return;
  const name = `${accepter.firstName} ${accepter.lastName}`.trim();
  await dispatch({
    userId: requesterId,
    clubId,
    category: 'SOCIAL',
    type: 'friend.accepted',
    title: `${name} a accepté votre demande`,
    body: `Vous êtes désormais amis avec ${name}.`,
    url: '/me/friends',
    data: { accepterId },
    email: null,
  });
}
```

- [ ] **Step 4: Lancer le test (passe)**

Run: `npx jest notifications.friend --silent`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/email/notifications.ts backend/src/email/__tests__/notifications.friend.test.ts
git commit -m "feat(amis): notifications friend.request / friend.accepted"
```

---

## Task 3 : `FriendshipService`

**Files:**
- Create: `backend/src/services/friendship.service.ts`
- Test: `backend/src/services/__tests__/friendship.service.test.ts`

- [ ] **Step 1: Écrire le test qui échoue**

Créer `backend/src/services/__tests__/friendship.service.test.ts` :

```ts
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { FriendshipService } from '../friendship.service';

const mockNotifyRequest = jest.fn();
const mockNotifyAccepted = jest.fn();
jest.mock('../../email/notifications', () => ({
  notifyFriendRequest:  (...a: unknown[]) => mockNotifyRequest(...a),
  notifyFriendAccepted: (...a: unknown[]) => mockNotifyAccepted(...a),
}));

const ACTIVE = { status: 'ACTIVE' } as any;

describe('FriendshipService — requestFriend', () => {
  let service: FriendshipService;
  beforeEach(() => {
    service = new FriendshipService();
    mockNotifyRequest.mockReset().mockResolvedValue(undefined);
    mockNotifyAccepted.mockReset().mockResolvedValue(undefined);
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue(ACTIVE);
    prismaMock.user.findUnique.mockResolvedValue({ acceptsFriendRequests: true } as any);
  });

  it('refuse de s\'ajouter soi-même', async () => {
    await expect(service.requestFriend('demo', 'u1', 'u1')).rejects.toThrow('CANNOT_FRIEND_SELF');
  });

  it('refuse si la cible n\'a pas activé l\'opt-in', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ acceptsFriendRequests: false } as any);
    prismaMock.friendship.findUnique.mockResolvedValue(null);
    await expect(service.requestFriend('demo', 'u1', 'u2')).rejects.toThrow('FRIEND_REQUESTS_DISABLED');
  });

  it('crée une demande PENDING et notifie la cible', async () => {
    prismaMock.friendship.findUnique.mockResolvedValueOnce(null); // existant (requestFriend)
    prismaMock.friendship.create.mockResolvedValue({ id: 'fr1' } as any);
    prismaMock.friendship.findUnique.mockResolvedValueOnce({ status: 'PENDING', requestedById: 'u1' } as any); // getRelationship
    const rel = await service.requestFriend('demo', 'u1', 'u2');
    expect(prismaMock.friendship.create).toHaveBeenCalledWith({ data: { userAId: 'u1', userBId: 'u2', requestedById: 'u1', status: 'PENDING' } });
    expect(mockNotifyRequest).toHaveBeenCalledWith('u1', 'u2', 'club-demo');
    expect(rel).toEqual({ status: 'pending_out', requestable: false });
  });

  it('accepte directement si une demande inverse est en attente', async () => {
    prismaMock.friendship.findUnique.mockResolvedValueOnce({ id: 'fr1', status: 'PENDING', requestedById: 'u2' } as any);
    prismaMock.friendship.update.mockResolvedValue({} as any);
    prismaMock.friendship.findUnique.mockResolvedValueOnce({ status: 'ACCEPTED', requestedById: 'u2' } as any);
    const rel = await service.requestFriend('demo', 'u1', 'u2');
    expect(prismaMock.friendship.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'fr1' }, data: expect.objectContaining({ status: 'ACCEPTED' }) }));
    expect(mockNotifyAccepted).toHaveBeenCalledWith('u1', 'u2', 'club-demo');
    expect(rel).toEqual({ status: 'friends', requestable: false });
  });

  it('canonicalise la paire (userA < userB) même si le demandeur est « plus grand »', async () => {
    prismaMock.friendship.findUnique.mockResolvedValueOnce(null);
    prismaMock.friendship.create.mockResolvedValue({ id: 'fr1' } as any);
    prismaMock.friendship.findUnique.mockResolvedValueOnce({ status: 'PENDING', requestedById: 'z9' } as any);
    await service.requestFriend('demo', 'z9', 'a1');
    expect(prismaMock.friendship.create).toHaveBeenCalledWith({ data: { userAId: 'a1', userBId: 'z9', requestedById: 'z9', status: 'PENDING' } });
  });
});

describe('FriendshipService — respond / remove / relations', () => {
  let service: FriendshipService;
  beforeEach(() => {
    service = new FriendshipService();
    mockNotifyAccepted.mockReset().mockResolvedValue(undefined);
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
  });

  it('respond(accept) passe la demande reçue en ACCEPTED et notifie le demandeur', async () => {
    prismaMock.friendship.findUnique.mockResolvedValueOnce({ id: 'fr1', status: 'PENDING', requestedById: 'u2' } as any);
    prismaMock.friendship.update.mockResolvedValue({} as any);
    prismaMock.friendship.findUnique.mockResolvedValueOnce({ status: 'ACCEPTED', requestedById: 'u2' } as any);
    const rel = await service.respond('demo', 'u1', 'u2', true);
    expect(prismaMock.friendship.update).toHaveBeenCalled();
    expect(mockNotifyAccepted).toHaveBeenCalledWith('u1', 'u2', 'club-demo');
    expect(rel).toEqual({ status: 'friends', requestable: false });
  });

  it('respond(refuse) supprime la demande', async () => {
    prismaMock.friendship.findUnique.mockResolvedValueOnce({ id: 'fr1', status: 'PENDING', requestedById: 'u2' } as any);
    prismaMock.friendship.delete.mockResolvedValue({} as any);
    prismaMock.friendship.findUnique.mockResolvedValueOnce(null);
    prismaMock.user.findUnique.mockResolvedValue({ acceptsFriendRequests: true } as any);
    await service.respond('demo', 'u1', 'u2', false);
    expect(prismaMock.friendship.delete).toHaveBeenCalledWith({ where: { id: 'fr1' } });
  });

  it('respond échoue si aucune demande reçue en attente', async () => {
    prismaMock.friendship.findUnique.mockResolvedValueOnce({ status: 'PENDING', requestedById: 'u1' } as any); // demande MIENNE, pas reçue
    await expect(service.respond('demo', 'u1', 'u2', true)).rejects.toThrow('REQUEST_NOT_FOUND');
  });

  it('removeFriend supprime (deleteMany canonique, idempotent)', async () => {
    prismaMock.friendship.deleteMany.mockResolvedValue({ count: 1 } as any);
    prismaMock.friendship.findUnique.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue({ acceptsFriendRequests: true } as any);
    await service.removeFriend('u1', 'u2');
    expect(prismaMock.friendship.deleteMany).toHaveBeenCalledWith({ where: { userAId: 'u1', userBId: 'u2' } });
  });

  it('getRelationship: none + requestable selon l\'opt-in cible', async () => {
    prismaMock.friendship.findUnique.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue({ acceptsFriendRequests: true } as any);
    expect(await service.getRelationship('u1', 'u2')).toEqual({ status: 'none', requestable: true });
  });
});

describe('FriendshipService — listes', () => {
  let service: FriendshipService;
  beforeEach(() => { service = new FriendshipService(); });

  it('listFriends renvoie « l\'autre » de chaque amitié ACCEPTED', async () => {
    prismaMock.friendship.findMany.mockResolvedValue([
      { userAId: 'u1', userBId: 'u2', userA: { id: 'u1', firstName: 'Moi', lastName: 'X', avatarUrl: null }, userB: { id: 'u2', firstName: 'Léa', lastName: 'M', avatarUrl: null } },
      { userAId: 'u0', userBId: 'u1', userA: { id: 'u0', firstName: 'Tom', lastName: 'B', avatarUrl: 'a.png' }, userB: { id: 'u1', firstName: 'Moi', lastName: 'X', avatarUrl: null } },
    ] as any);
    const list = await service.listFriends('u1');
    expect(list.map((f) => f.id).sort()).toEqual(['u0', 'u2']);
    expect(list.every((f) => f.mutual === true)).toBe(true);
  });

  it('listRequests ventile reçues (autre a demandé) et envoyées (moi)', async () => {
    prismaMock.friendship.findMany.mockResolvedValue([
      { userAId: 'u1', userBId: 'u2', requestedById: 'u2', userA: { id: 'u1', firstName: 'Moi', lastName: 'X', avatarUrl: null }, userB: { id: 'u2', firstName: 'Léa', lastName: 'M', avatarUrl: null } },
      { userAId: 'u1', userBId: 'u3', requestedById: 'u1', userA: { id: 'u1', firstName: 'Moi', lastName: 'X', avatarUrl: null }, userB: { id: 'u3', firstName: 'Tom', lastName: 'B', avatarUrl: null } },
    ] as any);
    const { received, sent } = await service.listRequests('u1');
    expect(received.map((f) => f.id)).toEqual(['u2']);
    expect(sent.map((f) => f.id)).toEqual(['u3']);
  });
});
```

- [ ] **Step 2: Lancer le test (échoue)**

Run: `npx jest friendship.service --silent`
Expected: FAIL (`Cannot find module '../friendship.service'`).

- [ ] **Step 3: Implémenter `FriendshipService`**

Créer `backend/src/services/friendship.service.ts` :

```ts
import { prisma } from '../db/prisma';
import { notifyFriendRequest, notifyFriendAccepted } from '../email/notifications';

export type FriendStatus = 'none' | 'pending_out' | 'pending_in' | 'friends';
export interface FriendRelation {
  status: FriendStatus;
  requestable: boolean;
}
export interface Friend {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  mutual: boolean;
}

const USER_SEL = { id: true, firstName: true, lastName: true, avatarUrl: true } as const;

export class FriendshipService {
  /** Paire canonique (userAId < userBId) pour l'unicité. */
  private pair(a: string, b: string): { userAId: string; userBId: string } {
    return a < b ? { userAId: a, userBId: b } : { userAId: b, userBId: a };
  }

  private async activeClubId(slug: string): Promise<string> {
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, status: true } });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    return club.id;
  }

  private async assertActiveMember(userId: string, clubId: string, error: string): Promise<void> {
    const m = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId, clubId } },
      select: { status: true },
    });
    if (!m || m.status !== 'ACTIVE') throw new Error(error);
  }

  /** Envoie une demande d'ami (ou accepte directement une demande inverse en attente). */
  async requestFriend(slug: string, requesterId: string, targetId: string): Promise<FriendRelation> {
    if (requesterId === targetId) throw new Error('CANNOT_FRIEND_SELF');
    const clubId = await this.activeClubId(slug);
    await this.assertActiveMember(requesterId, clubId, 'MEMBERSHIP_REQUIRED');
    await this.assertActiveMember(targetId, clubId, 'NOT_A_MEMBER');

    const key = this.pair(requesterId, targetId);
    const existing = await prisma.friendship.findUnique({
      where: { userAId_userBId: key },
      select: { id: true, status: true, requestedById: true },
    });
    if (existing) {
      // Demande inverse en attente → acceptation directe. Sinon (déjà envoyée par moi ou déjà amis) : no-op.
      if (existing.status === 'PENDING' && existing.requestedById === targetId) {
        await prisma.friendship.update({ where: { id: existing.id }, data: { status: 'ACCEPTED', respondedAt: new Date() } });
        notifyFriendAccepted(requesterId, targetId, clubId).catch(() => {});
      }
      return this.getRelationship(requesterId, targetId);
    }

    // Nouvelle demande : la cible doit avoir activé l'opt-in.
    const target = await prisma.user.findUnique({ where: { id: targetId }, select: { acceptsFriendRequests: true } });
    if (!target?.acceptsFriendRequests) throw new Error('FRIEND_REQUESTS_DISABLED');
    try {
      await prisma.friendship.create({ data: { ...key, requestedById: requesterId, status: 'PENDING' } });
      notifyFriendRequest(requesterId, targetId, clubId).catch(() => {});
    } catch (err) {
      // Course : une ligne a été créée entre le findUnique et le create → P2002, no-op.
      if ((err as { code?: string })?.code !== 'P2002') throw err;
    }
    return this.getRelationship(requesterId, targetId);
  }

  /** Répond à une demande REÇUE (initiée par l'autre) : accepte ou refuse (supprime). */
  async respond(slug: string, userId: string, otherUserId: string, accept: boolean): Promise<FriendRelation> {
    const clubId = await this.activeClubId(slug);
    const row = await prisma.friendship.findUnique({
      where: { userAId_userBId: this.pair(userId, otherUserId) },
      select: { id: true, status: true, requestedById: true },
    });
    if (!row || row.status !== 'PENDING' || row.requestedById !== otherUserId) throw new Error('REQUEST_NOT_FOUND');
    if (accept) {
      await prisma.friendship.update({ where: { id: row.id }, data: { status: 'ACCEPTED', respondedAt: new Date() } });
      notifyFriendAccepted(userId, otherUserId, clubId).catch(() => {});
    } else {
      await prisma.friendship.delete({ where: { id: row.id } });
    }
    return this.getRelationship(userId, otherUserId);
  }

  /** Retire un ami OU annule une demande envoyée (idempotent, aucune appartenance requise). */
  async removeFriend(userId: string, otherUserId: string): Promise<FriendRelation> {
    await prisma.friendship.deleteMany({ where: this.pair(userId, otherUserId) });
    return this.getRelationship(userId, otherUserId);
  }

  /** Relation entre deux joueurs, du point de vue de `a`. */
  async getRelationship(a: string, b: string): Promise<FriendRelation> {
    const row = await prisma.friendship.findUnique({
      where: { userAId_userBId: this.pair(a, b) },
      select: { status: true, requestedById: true },
    });
    if (!row) {
      const target = await prisma.user.findUnique({ where: { id: b }, select: { acceptsFriendRequests: true } });
      return { status: 'none', requestable: !!target?.acceptsFriendRequests };
    }
    if (row.status === 'ACCEPTED') return { status: 'friends', requestable: false };
    return { status: row.requestedById === a ? 'pending_out' : 'pending_in', requestable: false };
  }

  /** Mes amitiés confirmées (ACCEPTED). Global. Filtrable par nom. */
  async listFriends(userId: string, q?: string): Promise<Friend[]> {
    const query = (q ?? '').trim().toLowerCase();
    const rows = await prisma.friendship.findMany({
      where: { status: 'ACCEPTED', OR: [{ userAId: userId }, { userBId: userId }] },
      select: { userAId: true, userA: { select: USER_SEL }, userB: { select: USER_SEL } },
    });
    let others = rows.map((r) => (r.userAId === userId ? r.userB : r.userA));
    if (query) others = others.filter((o) => `${o.firstName} ${o.lastName}`.toLowerCase().includes(query));
    others.sort((x, y) => `${x.lastName}${x.firstName}`.localeCompare(`${y.lastName}${y.firstName}`));
    return others.map((o) => ({ id: o.id, firstName: o.firstName, lastName: o.lastName, avatarUrl: o.avatarUrl, mutual: true }));
  }

  /** Demandes en attente : reçues (l'autre a demandé) et envoyées (moi). Global. */
  async listRequests(userId: string): Promise<{ received: Friend[]; sent: Friend[] }> {
    const rows = await prisma.friendship.findMany({
      where: { status: 'PENDING', OR: [{ userAId: userId }, { userBId: userId }] },
      orderBy: { createdAt: 'desc' },
      select: { userAId: true, requestedById: true, userA: { select: USER_SEL }, userB: { select: USER_SEL } },
    });
    const received: Friend[] = [];
    const sent: Friend[] = [];
    for (const r of rows) {
      const other = r.userAId === userId ? r.userB : r.userA;
      const entry: Friend = { id: other.id, firstName: other.firstName, lastName: other.lastName, avatarUrl: other.avatarUrl, mutual: false };
      if (r.requestedById === userId) sent.push(entry);
      else received.push(entry);
    }
    return { received, sent };
  }
}
```

- [ ] **Step 4: Lancer le test (passe)**

Run: `npx jest friendship.service --silent`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/friendship.service.ts backend/src/services/__tests__/friendship.service.test.ts
git commit -m "feat(amis): FriendshipService (demande/accepte/refuse/retire + listes)"
```

---

## Task 4 : Routes backend (`clubs.ts` + `me.ts`)

**Files:**
- Modify: `backend/src/routes/clubs.ts` (import + instance + ERROR_STATUS + 3 routes après les routes `follows`, l. ~220)
- Modify: `backend/src/routes/me.ts` (import + instance + 2 routes après `/followers`, l. ~205)
- Test: `backend/src/routes/__tests__/friends.routes.test.ts`

- [ ] **Step 1: Écrire le test qui échoue**

Créer `backend/src/routes/__tests__/friends.routes.test.ts` :

```ts
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';

let mockRequestFriend: jest.Mock;
let mockRespond: jest.Mock;
let mockRemove: jest.Mock;
let mockListFriends: jest.Mock;
let mockListRequests: jest.Mock;

jest.mock('../../services/friendship.service', () => ({
  FriendshipService: jest.fn().mockImplementation(() => ({
    requestFriend: (...a: unknown[]) => mockRequestFriend(...a),
    respond:       (...a: unknown[]) => mockRespond(...a),
    removeFriend:  (...a: unknown[]) => mockRemove(...a),
    listFriends:   (...a: unknown[]) => mockListFriends(...a),
    listRequests:  (...a: unknown[]) => mockListRequests(...a),
  })),
}));

const token = jwt.sign({ id: 'u1', email: 'u1@test.fr' }, process.env.JWT_SECRET!);

describe('routes friends', () => {
  beforeEach(() => {
    mockRequestFriend = jest.fn();
    mockRespond = jest.fn();
    mockRemove = jest.fn();
    mockListFriends = jest.fn();
    mockListRequests = jest.fn();
  });

  it('POST /api/clubs/:slug/friends/:userId/request', async () => {
    mockRequestFriend.mockResolvedValue({ status: 'pending_out', requestable: false });
    const res = await request(app).post('/api/clubs/demo/friends/u2/request').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(mockRequestFriend).toHaveBeenCalledWith('demo', 'u1', 'u2');
  });

  it('POST /respond passe accept=true depuis le body', async () => {
    mockRespond.mockResolvedValue({ status: 'friends', requestable: false });
    const res = await request(app).post('/api/clubs/demo/friends/u2/respond').send({ accept: true }).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(mockRespond).toHaveBeenCalledWith('demo', 'u1', 'u2', true);
  });

  it('DELETE /api/clubs/:slug/friends/:userId', async () => {
    mockRemove.mockResolvedValue({ status: 'none', requestable: true });
    const res = await request(app).delete('/api/clubs/demo/friends/u2').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(mockRemove).toHaveBeenCalledWith('u1', 'u2');
  });

  it('mappe FRIEND_REQUESTS_DISABLED sur 409', async () => {
    mockRequestFriend.mockRejectedValue(new Error('FRIEND_REQUESTS_DISABLED'));
    const res = await request(app).post('/api/clubs/demo/friends/u2/request').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'FRIEND_REQUESTS_DISABLED' });
  });

  it('GET /api/me/friendships', async () => {
    mockListFriends.mockResolvedValue([]);
    const res = await request(app).get('/api/me/friendships?q=lea').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(mockListFriends).toHaveBeenCalledWith('u1', 'lea');
  });

  it('GET /api/me/friend-requests', async () => {
    mockListRequests.mockResolvedValue({ received: [], sent: [] });
    const res = await request(app).get('/api/me/friend-requests').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(mockListRequests).toHaveBeenCalledWith('u1');
  });
});
```

- [ ] **Step 2: Lancer le test (échoue)**

Run: `npx jest friends.routes --silent`
Expected: FAIL (routes 404).

- [ ] **Step 3: Ajouter les codes d'erreur dans `clubs.ts`**

Dans `ERROR_STATUS` (l. ~47), ajouter (après `NOT_A_MEMBER: 404,`) :

```ts
  FRIEND_REQUESTS_DISABLED: 409,
  CANNOT_FRIEND_SELF:       400,
  REQUEST_NOT_FOUND:        404,
```

- [ ] **Step 4: Importer + instancier + monter les routes dans `clubs.ts`**

Import (près de `import { FollowService } ...`, l. ~18) :
```ts
import { FriendshipService } from '../services/friendship.service';
```
Instance (près de `const followService = new FollowService();`, l. ~45) :
```ts
const friendshipService = new FriendshipService();
```
Routes — juste **après** le bloc `router.delete('/:slug/follows/:userId' ...)` (l. ~220) :
```ts
// --- Amitiés confirmées (demande / réponse / retrait) ---
router.post('/:slug/friends/:userId/request', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await friendshipService.requestFriend(asString(req.params.slug), req.user!.id, asString(req.params.userId))); }
  catch (err) { handleError(err, res, next); }
});
router.post('/:slug/friends/:userId/respond', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await friendshipService.respond(asString(req.params.slug), req.user!.id, asString(req.params.userId), req.body?.accept === true)); }
  catch (err) { handleError(err, res, next); }
});
router.delete('/:slug/friends/:userId', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await friendshipService.removeFriend(req.user!.id, asString(req.params.userId))); }
  catch (err) { handleError(err, res, next); }
});
```

- [ ] **Step 5: Monter les routes globales dans `me.ts`**

Import (près de `import { FollowService } ...`, l. ~16) :
```ts
import { FriendshipService } from '../services/friendship.service';
```
Instance (près de `const followService = new FollowService();`, l. ~24) :
```ts
const friendshipService = new FriendshipService();
```
Routes — après `router.get('/followers' ...)` (l. ~205) :
```ts
// Amitiés confirmées du joueur connecté (filtrables par nom).
router.get('/friendships', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await friendshipService.listFriends(req.user!.id, typeof req.query.q === 'string' ? req.query.q : undefined)); }
  catch (err) { next(err); }
});

// Demandes d'ami en attente (reçues + envoyées).
router.get('/friend-requests', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await friendshipService.listRequests(req.user!.id)); }
  catch (err) { next(err); }
});
```

- [ ] **Step 6: Lancer le test (passe)**

Run: `npx jest friends.routes --silent`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/clubs.ts backend/src/routes/me.ts backend/src/routes/__tests__/friends.routes.test.ts
git commit -m "feat(amis): routes demande/réponse/retrait + listes amis/demandes"
```

---

## Task 5 : Annoter `searchMembers` avec la relation d'amitié

**Files:**
- Modify: `backend/src/services/club.service.ts` (`searchMembers`, l. ~429-473)
- Test: `backend/src/services/__tests__/club.service.test.ts` (ajouter un bloc)

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter dans `backend/src/services/__tests__/club.service.test.ts` un nouveau `describe` (mirroir des mocks existants du fichier — `prismaMock` déjà importé en tête) :

```ts
describe('ClubService.searchMembers — annotation friend', () => {
  let svc: ClubService;
  beforeEach(() => {
    svc = new ClubService();
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findMany.mockResolvedValue([
      { user: { id: 'u2', firstName: 'Léa', lastName: 'M', acceptsFriendRequests: true } },
      { user: { id: 'u3', firstName: 'Tom', lastName: 'B', acceptsFriendRequests: false } },
    ] as any);
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-padel' } as any);
    prismaMock.playerRating.findMany.mockResolvedValue([] as any);
    prismaMock.follow.findMany.mockResolvedValue([] as any);
  });

  it('renvoie friend={status,requestable} par membre (opt-in reflété)', async () => {
    prismaMock.friendship.findMany.mockResolvedValue([
      { userAId: 'u1', userBId: 'u2', status: 'PENDING', requestedById: 'u1' },
    ] as any);
    const res = await svc.searchMembers('demo', 'u1', '');
    const byId = Object.fromEntries(res.map((r: any) => [r.id, r.friend]));
    expect(byId['u2']).toEqual({ status: 'pending_out', requestable: false });
    expect(byId['u3']).toEqual({ status: 'none', requestable: false }); // u3 opt-in OFF
  });
});
```

- [ ] **Step 2: Lancer le test (échoue)**

Run: `npx jest club.service --silent -t "annotation friend"`
Expected: FAIL (`friend` undefined / `acceptsFriendRequests` non sélectionné).

- [ ] **Step 3: Implémenter l'annotation**

Dans `searchMembers` :

(a) Ajouter `acceptsFriendRequests` au `select` du membre (l. ~450) :
```ts
      select: { user: { select: { id: true, firstName: true, lastName: true, acceptsFriendRequests: true } } },
```

(b) Après le calcul de `iFollowSet`/`followsMe` (l. ~466), avant le `return` :
```ts
    // Annoter la relation d'amitié (paire canonique) en une requête sur les ids retournés.
    const fr = await prisma.friendship.findMany({
      where: {
        OR: [
          { userAId: callerUserId, userBId: { in: userIds } },
          { userBId: callerUserId, userAId: { in: userIds } },
        ],
      },
      select: { userAId: true, userBId: true, status: true, requestedById: true },
    });
    const frByOther = new Map<string, { status: string; requestedById: string }>();
    for (const f of fr) {
      const other = f.userAId === callerUserId ? f.userBId : f.userAId;
      frByOther.set(other, { status: f.status, requestedById: f.requestedById });
    }
```

(c) Remplacer le `return members.map(...)` par :
```ts
    return members.map((m) => {
      const rel = frByOther.get(m.user.id);
      const friend = !rel
        ? { status: 'none' as const, requestable: m.user.acceptsFriendRequests }
        : rel.status === 'ACCEPTED'
          ? { status: 'friends' as const, requestable: false }
          : { status: (rel.requestedById === callerUserId ? 'pending_out' : 'pending_in') as const, requestable: false };
      return {
        id: m.user.id,
        firstName: m.user.firstName,
        lastName: m.user.lastName,
        level: levels[m.user.id] ?? null,
        iFollow: iFollowSet.has(m.user.id),
        mutual: iFollowSet.has(m.user.id) && followsMe.has(m.user.id),
        friend,
      };
    });
```

- [ ] **Step 4: Lancer le test (passe) + typecheck**

Run: `npx jest club.service --silent -t "annotation friend"` → PASS
Run: `npx tsc --noEmit` → PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/club.service.ts backend/src/services/__tests__/club.service.test.ts
git commit -m "feat(amis): searchMembers annote la relation d'amitié"
```

---

## Task 6 : Opt-in dans le profil (`PATCH /api/me` + `GET /profile`)

**Files:**
- Modify: `backend/src/routes/me.ts` (`PROFILE_SELECT` l. ~27, `PATCH /` l. ~109-154)
- Test: `backend/src/routes/__tests__/me.routes.test.ts` (ajouter un cas)

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter dans `backend/src/routes/__tests__/me.routes.test.ts` (mirroir des cas PATCH existants qui utilisent `prismaMock.user.update`) :

```ts
  it('PATCH /api/me accepte acceptsFriendRequests (booléen)', async () => {
    prismaMock.user.update.mockResolvedValue({ id: 'u1', acceptsFriendRequests: true } as any);
    const res = await request(app).patch('/api/me').send({ acceptsFriendRequests: true }).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const arg = (prismaMock.user.update as jest.Mock).mock.calls[0][0];
    expect(arg.data).toEqual({ acceptsFriendRequests: true });
  });

  it('PATCH /api/me rejette acceptsFriendRequests non booléen', async () => {
    const res = await request(app).patch('/api/me').send({ acceptsFriendRequests: 'oui' }).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
```

> Note : si les cas PATCH existants du fichier vérifient le `select`, laisse `PROFILE_SELECT` inchangé côté assertion — on ajoute juste un champ.

- [ ] **Step 2: Lancer le test (échoue)**

Run: `npx jest me.routes --silent -t acceptsFriendRequests`
Expected: FAIL (le champ est ignoré ; `data` vide).

- [ ] **Step 3: Implémenter**

(a) `PROFILE_SELECT` (l. ~27-32) — ajouter `acceptsFriendRequests: true,` :
```ts
  birthDate: true, avatarUrl: true, locale: true, isSuperAdmin: true, showInLeaderboard: true,
  autoMatchProposals: true, acceptsFriendRequests: true,
```

(b) `PATCH /` — étendre la déstructuration et le type `data`, et ajouter la validation (mirroir de `autoMatchProposals`, l. ~137-140) :

Déstructuration (l. ~111) :
```ts
    const { phone, sex, birthDate, locale, showInLeaderboard, autoMatchProposals, acceptsFriendRequests, preferredSportId } = req.body;
```
Type `data` (l. ~112) — ajouter `; acceptsFriendRequests?: boolean` avant `preferredSportId?`.
Bloc de validation (après le bloc `autoMatchProposals`, l. ~140) :
```ts
    if (acceptsFriendRequests !== undefined) {
      if (typeof acceptsFriendRequests !== 'boolean') return void res.status(400).json({ error: 'acceptsFriendRequests invalide' });
      data.acceptsFriendRequests = acceptsFriendRequests;
    }
```

- [ ] **Step 4: Lancer le test (passe)**

Run: `npx jest me.routes --silent -t acceptsFriendRequests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/me.ts backend/src/routes/__tests__/me.routes.test.ts
git commit -m "feat(amis): opt-in acceptsFriendRequests dans le profil"
```

---

## Task 7 : `lib/api.ts` — types + méthodes

**Files:**
- Modify: `frontend/lib/api.ts` (types + méthodes de l'objet `api`)

- [ ] **Step 1: Ajouter les types**

Après l'interface `FollowRelation` (l. ~1875-1879) :
```ts
export type FriendStatus = 'none' | 'pending_out' | 'pending_in' | 'friends';
export interface FriendRelation {
  status: FriendStatus;
  requestable: boolean;
}
export interface FriendRequests {
  received: Friend[];
  sent: Friend[];
}
```
Dans `ClubMemberSearchResult` (l. ~1857-1864), ajouter :
```ts
  friend?: FriendRelation; // annoté par searchMembers
```
Dans `MyProfile` (l. ~1795, après `autoMatchProposals: boolean;`) :
```ts
  acceptsFriendRequests: boolean;
```

- [ ] **Step 2: Étendre `updateMyProfile` + ajouter les méthodes amis**

`updateMyProfile` (l. ~552) — ajouter `acceptsFriendRequests?: boolean;` au type du body.

Dans la section `// --- Amis / suivi ---` (après `unfollowUser`, l. ~598) :
```ts
  requestFriend: (slug: string, userId: string, token: string) =>
    request<FriendRelation>(`/api/clubs/${slug}/friends/${userId}/request`, { method: 'POST' }, token),
  respondFriend: (slug: string, userId: string, accept: boolean, token: string) =>
    request<FriendRelation>(`/api/clubs/${slug}/friends/${userId}/respond`, { method: 'POST', body: JSON.stringify({ accept }) }, token),
  removeFriend: (slug: string, userId: string, token: string) =>
    request<FriendRelation>(`/api/clubs/${slug}/friends/${userId}`, { method: 'DELETE' }, token),
  listFriendships: (token: string, q?: string) =>
    request<Friend[]>(`/api/me/friendships${q ? `?q=${encodeURIComponent(q)}` : ''}`, {}, token),
  listFriendRequests: (token: string) =>
    request<FriendRequests>(`/api/me/friend-requests`, {}, token),
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit` (depuis `frontend/`)
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(amis): api client (types FriendRelation + méthodes)"
```

---

## Task 8 : Composant `FriendButton`

**Files:**
- Create: `frontend/components/social/FriendButton.tsx`
- Test: `frontend/__tests__/FriendButton.test.tsx`

- [ ] **Step 1: Écrire le test qui échoue**

Créer `frontend/__tests__/FriendButton.test.tsx` :

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { FriendButton } from '@/components/social/FriendButton';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({
  api: { requestFriend: jest.fn(), respondFriend: jest.fn(), removeFriend: jest.fn() },
}));

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('FriendButton', () => {
  beforeEach(() => jest.clearAllMocks());

  it('none+requestable → « Ajouter en ami », clic envoie la demande', async () => {
    (api.requestFriend as jest.Mock).mockResolvedValue({ status: 'pending_out', requestable: false });
    wrap(<FriendButton slug="demo" userId="u2" token="t" relation={{ status: 'none', requestable: true }} />);
    const btn = screen.getByRole('button', { name: /Ajouter en ami/ });
    fireEvent.click(btn);
    await waitFor(() => expect(api.requestFriend).toHaveBeenCalledWith('demo', 'u2', 't'));
    expect(screen.getByRole('button', { name: /Demande envoyée/ })).toBeInTheDocument();
  });

  it('none+!requestable → désactivé « N\'accepte pas les demandes »', () => {
    wrap(<FriendButton slug="demo" userId="u2" token="t" relation={{ status: 'none', requestable: false }} />);
    expect(screen.getByRole('button', { name: /N'accepte pas les demandes/ })).toBeDisabled();
  });

  it('pending_in → « Accepter » appelle respondFriend(true)', async () => {
    (api.respondFriend as jest.Mock).mockResolvedValue({ status: 'friends', requestable: false });
    wrap(<FriendButton slug="demo" userId="u2" token="t" relation={{ status: 'pending_in', requestable: false }} />);
    fireEvent.click(screen.getByRole('button', { name: /^Accepter/ }));
    await waitFor(() => expect(api.respondFriend).toHaveBeenCalledWith('demo', 'u2', true, 't'));
  });

  it('friends → clic retire (removeFriend)', async () => {
    (api.removeFriend as jest.Mock).mockResolvedValue({ status: 'none', requestable: true });
    wrap(<FriendButton slug="demo" userId="u2" token="t" relation={{ status: 'friends', requestable: false }} />);
    fireEvent.click(screen.getByRole('button', { name: /Amis/ }));
    await waitFor(() => expect(api.removeFriend).toHaveBeenCalledWith('demo', 'u2', 't'));
  });
});
```

- [ ] **Step 2: Lancer le test (échoue)**

Run: `npx jest FriendButton --silent` (depuis `frontend/`)
Expected: FAIL (module introuvable).

- [ ] **Step 3: Implémenter `FriendButton`**

Créer `frontend/components/social/FriendButton.tsx` :

```tsx
'use client';
import { useState } from 'react';
import { api, FriendRelation } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Icon } from '@/components/ui/Icon';

// Bouton d'amitié réutilisable, optimiste. 5 états dérivés de FriendRelation :
//   none+requestable → Ajouter en ami | pending_out → Demande envoyée (clic = annuler)
//   pending_in → Accepter (+ Refuser) | friends → Amis (clic = retirer)
//   none+!requestable → « N'accepte pas les demandes » (désactivé)
export function FriendButton({ slug, userId, token, relation, size = 'sm', onChange }: {
  slug: string;
  userId: string;
  token: string;
  relation: FriendRelation;
  size?: 'sm' | 'xs';
  onChange?: (rel: FriendRelation) => void;
}) {
  const { th } = useTheme();
  const [rel, setRel] = useState<FriendRelation>(relation);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<FriendRelation>, optimistic: FriendRelation) => {
    if (busy) return;
    setBusy(true);
    const prev = rel;
    setRel(optimistic);
    try {
      const next = await fn();
      setRel(next);
      onChange?.(next);
    } catch {
      setRel(prev); // rollback
    } finally {
      setBusy(false);
    }
  };

  const pad = size === 'xs' ? '3px 8px' : '5px 11px';
  const fs = size === 'xs' ? 12 : 13;
  const base: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 5, border: `1px solid ${th.accent}`,
    borderRadius: 999, padding: pad, fontFamily: th.fontUI, fontSize: fs, fontWeight: 600,
    whiteSpace: 'nowrap', opacity: busy ? 0.7 : 1,
  };
  const filled: React.CSSProperties = { ...base, background: th.accent, color: th.onAccent, cursor: 'pointer' };
  const hollow: React.CSSProperties = { ...base, background: 'transparent', color: th.accent, cursor: 'pointer' };
  const muted: React.CSSProperties = {
    ...base, border: `1px solid ${th.line}`, background: 'transparent', color: th.textMute, cursor: 'default',
  };

  if (rel.status === 'friends') {
    return (
      <button type="button" disabled={busy} style={filled}
        onClick={() => run(() => api.removeFriend(slug, userId, token), { status: 'none', requestable: true })}>
        <Icon name="users" size={fs} color={th.onAccent} />Amis
      </button>
    );
  }
  if (rel.status === 'pending_out') {
    return (
      <button type="button" disabled={busy} style={hollow}
        onClick={() => run(() => api.removeFriend(slug, userId, token), { status: 'none', requestable: true })}>
        <Icon name="check" size={fs} color={th.accent} />Demande envoyée
      </button>
    );
  }
  if (rel.status === 'pending_in') {
    return (
      <span style={{ display: 'inline-flex', gap: 6 }}>
        <button type="button" disabled={busy} style={filled}
          onClick={() => run(() => api.respondFriend(slug, userId, true, token), { status: 'friends', requestable: false })}>
          <Icon name="check" size={fs} color={th.onAccent} />Accepter
        </button>
        <button type="button" disabled={busy} style={hollow}
          onClick={() => run(() => api.respondFriend(slug, userId, false, token), { status: 'none', requestable: false })}>
          Refuser
        </button>
      </span>
    );
  }
  if (!rel.requestable) {
    return <button type="button" disabled style={muted}>N&apos;accepte pas les demandes</button>;
  }
  return (
    <button type="button" disabled={busy} style={hollow}
      onClick={() => run(() => api.requestFriend(slug, userId, token), { status: 'pending_out', requestable: false })}>
      <Icon name="plus" size={fs} color={th.accent} />Ajouter en ami
    </button>
  );
}
```

- [ ] **Step 4: Lancer le test (passe)**

Run: `npx jest FriendButton --silent`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/social/FriendButton.tsx frontend/__tests__/FriendButton.test.tsx
git commit -m "feat(amis): composant FriendButton (5 états optimiste)"
```

---

## Task 8bis : Désambiguïser `FollowButton` (le mutuel n'est plus « Amis »)

**Files:**
- Modify: `frontend/components/social/FollowButton.tsx` (l. 42, 52)
- Test: `frontend/__tests__/FollowButton.test.tsx` (mettre à jour l'assertion « Amis »)

- [ ] **Step 1: Mettre à jour le test**

Dans `frontend/__tests__/FollowButton.test.tsx`, remplacer l'assertion qui attend le libellé « Amis » sur un suivi mutuel par « Suivi(e) ». Ajouter/ajuster :
```tsx
  it('un suivi mutuel affiche « Suivi(e) » (plus « Amis »)', () => {
    render(<ThemeProvider><FollowButton slug="demo" userId="u2" token="t" initial={{ iFollow: true, mutual: true }} /></ThemeProvider>);
    expect(screen.getByRole('button', { name: /Suivi\(e\)/ })).toBeInTheDocument();
    expect(screen.queryByText('Amis')).not.toBeInTheDocument();
  });
```
> Si le test existant contient un cas « Amis » explicite, le corriger de la même façon (chercher `'Amis'` dans le fichier).

- [ ] **Step 2: Lancer le test (échoue)**

Run: `npx jest FollowButton --silent`
Expected: FAIL (le bouton affiche encore « Amis »).

- [ ] **Step 3: Modifier `FollowButton`**

Ligne 42 :
```ts
  const label = iFollow ? 'Suivi(e)' : 'Suivre';
```
Ligne 52 (icône) :
```tsx
      <Icon name={iFollow ? 'check' : 'plus'} size={fs} color={filled ? th.onAccent : th.accent} />
```
> `mutual` reste dans le state (renvoyé par l'API) mais ne pilote plus le libellé.

- [ ] **Step 4: Lancer le test (passe)**

Run: `npx jest FollowButton --silent`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/social/FollowButton.tsx frontend/__tests__/FollowButton.test.tsx
git commit -m "refactor(amis): FollowButton — mutuel = « Suivi(e) », plus « Amis »"
```

---

## Task 9 : Réorganiser le hub `/me/friends`

**Files:**
- Modify: `frontend/components/social/FriendsHub.tsx` (réécriture)
- Modify: `frontend/app/me/friends/page.tsx` (accepter `?tab=demandes`)
- Test: `frontend/__tests__/FriendsHub.test.tsx` (réécriture/ajouts)

- [ ] **Step 1: Écrire les tests qui échouent**

Réécrire `frontend/__tests__/FriendsHub.test.tsx` :

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { FriendsHub } from '@/components/social/FriendsHub';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({
  api: {
    listFriendships: jest.fn(),
    listFriendRequests: jest.fn(),
    listFollowing: jest.fn(),
    listFollowers: jest.fn(),
    searchClubMembers: jest.fn(),
    respondFriend: jest.fn(),
    removeFriend: jest.fn(),
    requestFriend: jest.fn(),
    followUser: jest.fn(),
    unfollowUser: jest.fn(),
  },
}));

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

beforeEach(() => {
  jest.clearAllMocks();
  (api.listFriendships as jest.Mock).mockResolvedValue([{ id: 'u2', firstName: 'Léa', lastName: 'M', avatarUrl: null, mutual: true }]);
  (api.listFriendRequests as jest.Mock).mockResolvedValue({
    received: [{ id: 'u3', firstName: 'Tom', lastName: 'B', avatarUrl: null, mutual: false }],
    sent: [{ id: 'u4', firstName: 'Zoé', lastName: 'K', avatarUrl: null, mutual: false }],
  });
  (api.listFollowing as jest.Mock).mockResolvedValue([]);
  (api.listFollowers as jest.Mock).mockResolvedValue([]);
  (api.searchClubMembers as jest.Mock).mockResolvedValue([]);
});

describe('FriendsHub', () => {
  it('onglet Amis = amitiés confirmées', async () => {
    wrap(<FriendsHub slug="demo" token="t" />);
    expect(await screen.findByText('Léa M')).toBeInTheDocument();
  });

  it('onglet Demandes affiche les reçues avec Accepter/Refuser', async () => {
    (api.respondFriend as jest.Mock).mockResolvedValue({ status: 'friends', requestable: false });
    wrap(<FriendsHub slug="demo" token="t" initialTab="demandes" />);
    expect(await screen.findByText('Tom B')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Accepter/ }));
    await waitFor(() => expect(api.respondFriend).toHaveBeenCalledWith('demo', 'u3', true, 't'));
  });

  it('onglet Demandes affiche aussi les envoyées', async () => {
    wrap(<FriendsHub slug="demo" token="t" initialTab="demandes" />);
    expect(await screen.findByText('Zoé K')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Lancer les tests (échouent)**

Run: `npx jest FriendsHub --silent`
Expected: FAIL (`api.listFriendships is not a function` / onglet « demandes » inconnu).

- [ ] **Step 3: Réécrire `FriendsHub`**

Remplacer intégralement `frontend/components/social/FriendsHub.tsx` :

```tsx
'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, ClubMemberSearchResult, Friend, FriendRequests } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Avatar } from '@/components/ui/Avatar';
import { FollowButton } from '@/components/social/FollowButton';
import { FriendButton } from '@/components/social/FriendButton';
import { LevelChip } from '@/components/player/LevelChip';
import { colorForSeed } from '@/lib/playerColors';

type Tab = 'amis' | 'demandes' | 'following' | 'followers' | 'search';

// Hub social : Amis (confirmés) / Demandes (reçues+envoyées) / Abonnements / Abonnés / Trouver.
export function FriendsHub({ slug, token, initialTab = 'amis' }: { slug: string; token: string; initialTab?: Tab }) {
  const { th } = useTheme();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [requests, setRequests] = useState<FriendRequests>({ received: [], sent: [] });
  const [following, setFollowing] = useState<Friend[]>([]);
  const [followers, setFollowers] = useState<Friend[]>([]);
  const [q, setQ] = useState('');
  const [searchResults, setSearchResults] = useState<ClubMemberSearchResult[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(() => {
    api.listFriendships(token).then(setFriends).catch(() => {});
    api.listFriendRequests(token).then(setRequests).catch(() => {});
    api.listFollowing(token).then(setFollowing).catch(() => {});
    api.listFollowers(token).then(setFollowers).catch(() => {});
  }, [token]);
  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (tab !== 'search') return;
    const query = q.trim();
    const handle = setTimeout(() => {
      api.searchClubMembers(slug, query, token).then(setSearchResults).catch(() => setSearchResults([]));
    }, query ? 250 : 0);
    return () => clearTimeout(handle);
  }, [tab, q, slug, token]);

  const respond = async (userId: string, accept: boolean) => {
    setBusyId(userId);
    try { await api.respondFriend(slug, userId, accept, token); reload(); }
    catch { /* noop */ }
    finally { setBusyId(null); }
  };
  const cancelSent = async (userId: string) => {
    setBusyId(userId);
    try { await api.removeFriend(slug, userId, token); reload(); }
    catch { /* noop */ }
    finally { setBusyId(null); }
  };

  const tabs: { key: Tab; label: string; n?: number }[] = [
    { key: 'amis',      label: 'Amis',        n: friends.length },
    { key: 'demandes',  label: 'Demandes',    n: requests.received.length },
    { key: 'following', label: 'Abonnements', n: following.length },
    { key: 'followers', label: 'Abonnés',     n: followers.length },
    { key: 'search',    label: 'Trouver' },
  ];

  const row = (children: React.ReactNode, key: string) => (
    <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px', borderBottom: `1px solid ${th.line}` }}>
      {children}
    </div>
  );
  const identity = (f: { id: string; firstName: string; lastName: string; avatarUrl?: string | null; level?: Friend['level'] }) => (
    <>
      <Avatar firstName={f.firstName} lastName={f.lastName} avatarUrl={f.avatarUrl ?? null} size={36} color={colorForSeed(f.id)} />
      <span style={{ flex: 1, fontFamily: th.fontUI, fontSize: 14.5, color: th.text, fontWeight: 600 }}>{f.firstName} {f.lastName}</span>
      {f.level != null && <LevelChip level={f.level} />}
    </>
  );

  const btnStyle = (fill: boolean): React.CSSProperties => ({
    border: `1px solid ${th.accent}`, background: fill ? th.accent : 'transparent', color: fill ? th.onAccent : th.accent,
    borderRadius: 999, padding: '5px 11px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {tabs.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            style={{ flex: 1, minWidth: 90, border: `1px solid ${tab === t.key ? th.accent : th.line}`, background: tab === t.key ? th.accent : 'transparent', color: tab === t.key ? th.onAccent : th.text, borderRadius: 10, padding: '8px 6px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}>
            {t.label}{t.n ? <span style={{ opacity: 0.7 }}> {t.n}</span> : null}
          </button>
        ))}
      </div>

      {tab === 'demandes' ? (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {requests.received.length === 0 && requests.sent.length === 0 && (
            <div style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, padding: '16px 4px' }}>Aucune demande en attente.</div>
          )}
          {requests.received.map((f) => row(
            <>
              {identity(f)}
              <button type="button" disabled={busyId === f.id} style={btnStyle(true)} onClick={() => respond(f.id, true)}>Accepter</button>
              <button type="button" disabled={busyId === f.id} style={btnStyle(false)} onClick={() => respond(f.id, false)}>Refuser</button>
            </>, `rec-${f.id}`))}
          {requests.sent.length > 0 && (
            <div style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute, textTransform: 'uppercase', letterSpacing: 0.4, padding: '12px 4px 4px' }}>Envoyées</div>
          )}
          {requests.sent.map((f) => row(
            <>
              {identity(f)}
              <button type="button" disabled={busyId === f.id} style={btnStyle(false)} onClick={() => cancelSent(f.id)}>Annuler</button>
            </>, `sent-${f.id}`))}
        </div>
      ) : tab === 'search' ? (
        <>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un joueur…"
            style={{ border: `1px solid ${th.line}`, background: th.surface2, color: th.text, borderRadius: 10, padding: '10px 12px', fontFamily: th.fontUI, fontSize: 14 }} />
          {searchResults.length === 0
            ? <div style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, padding: '16px 4px' }}>Aucun membre trouvé.</div>
            : searchResults.map((r) => row(
                <>
                  {identity(r)}
                  <FollowButton slug={slug} userId={r.id} token={token} initial={{ iFollow: !!r.iFollow, mutual: !!r.mutual }} onChange={reload} />
                  <FriendButton slug={slug} userId={r.id} token={token} relation={r.friend ?? { status: 'none', requestable: false }} onChange={reload} />
                </>, r.id))}
        </>
      ) : (
        (() => {
          const list = tab === 'amis' ? friends : tab === 'following' ? following : followers;
          const empty = tab === 'amis' ? 'Aucun ami confirmé pour l\'instant.' : tab === 'following' ? 'Vous ne suivez personne.' : 'Personne ne vous suit encore.';
          return list.length === 0
            ? <div style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, padding: '16px 4px' }}>{empty}</div>
            : list.map((f) => row(
                <>
                  {identity(f)}
                  {tab === 'amis'
                    ? <FriendButton slug={slug} userId={f.id} token={token} relation={{ status: 'friends', requestable: false }} onChange={reload} />
                    : <FollowButton slug={slug} userId={f.id} token={token} initial={{ iFollow: tab === 'following', mutual: f.mutual }} onChange={reload} />}
                </>, f.id));
        })()
      )}
    </div>
  );
}
```

- [ ] **Step 4: Accepter `?tab=demandes` dans la page**

Dans `frontend/app/me/friends/page.tsx` (l. 18), remplacer :
```ts
  const initialTab = tabParam === 'followers' ? 'followers' : tabParam === 'following' ? 'following' : tabParam === 'demandes' ? 'demandes' : 'amis';
```

- [ ] **Step 5: Lancer les tests (passent) + typecheck**

Run: `npx jest FriendsHub --silent` → PASS
Run: `npx tsc --noEmit` → PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/components/social/FriendsHub.tsx frontend/app/me/friends/page.tsx frontend/__tests__/FriendsHub.test.tsx
git commit -m "feat(amis): hub Amis/Demandes/Abonnements/Abonnés/Trouver"
```

---

## Task 10 : Interrupteur d'opt-in dans `/me/profile`

**Files:**
- Modify: `frontend/app/me/profile/page.tsx` (handler + Segmented dans la section Préférences)
- Test: `frontend/__tests__/MeProfile.test.tsx` (ajout d'un cas)

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter dans `frontend/__tests__/MeProfile.test.tsx` un cas (mirroir des cas `showInLeaderboard`/`autoMatchProposals` existants — réutiliser le mock `api.updateMyProfile` déjà en place et un `profile` avec `acceptsFriendRequests: false`) :

```tsx
  it('bascule « Autoriser les demandes d\'ami » via PATCH', async () => {
    (api.updateMyProfile as jest.Mock).mockResolvedValue({ ...baseProfile, acceptsFriendRequests: true });
    renderProfile(); // helper existant du fichier
    const group = await screen.findByRole('group', { name: /Autoriser les demandes d'ami/ });
    fireEvent.click(within(group).getByText('Oui'));
    await waitFor(() => expect(api.updateMyProfile).toHaveBeenCalledWith({ acceptsFriendRequests: true }, expect.any(String)));
  });
```
> Adapter `baseProfile`/`renderProfile` aux helpers réels du fichier ; s'assurer que le `MyProfile` mocké inclut `acceptsFriendRequests: false`.

- [ ] **Step 2: Lancer le test (échoue)**

Run: `npx jest MeProfile --silent -t "demandes d'ami"`
Expected: FAIL (groupe absent).

- [ ] **Step 3: Ajouter le handler**

Dans `frontend/app/me/profile/page.tsx`, près de `changeAutoMatchProposals` (l. ~167-173) :
```ts
  const changeAcceptsFriendRequests = async (next: boolean) => {
    if (!token || !profile) return;
    setError(null);
    setProfile({ ...profile, acceptsFriendRequests: next }); // optimiste
    try { setProfile(await api.updateMyProfile({ acceptsFriendRequests: next }, token)); }
    catch (e) { setError((e as Error).message); }
  };
```

- [ ] **Step 4: Ajouter le contrôle dans la section Préférences**

Dans la section `id="preferences"` (après le bloc `autoMatchProposals`, l. ~471-478) :
```tsx
                  <div style={{ marginTop: 14 }}>
                    <span style={label}>Autoriser les demandes d&apos;ami</span>
                    <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, margin: '2px 0 6px' }}>
                      La messagerie reste ouverte à tous les membres du club ; ce réglage ne concerne que les amitiés.
                    </div>
                    <div role="group" aria-label="Autoriser les demandes d'ami">
                      <Segmented<'oui' | 'non'>
                        value={profile.acceptsFriendRequests ? 'oui' : 'non'}
                        onChange={(v) => changeAcceptsFriendRequests(v === 'oui')}
                        options={[{ value: 'oui', label: 'Oui' }, { value: 'non', label: 'Non' }]}
                      />
                    </div>
                  </div>
```
> `label`, `th`, `Segmented` sont déjà utilisés dans cette section — pas de nouvel import.

- [ ] **Step 5: Lancer le test (passe) + typecheck**

Run: `npx jest MeProfile --silent -t "demandes d'ami"` → PASS
Run: `npx tsc --noEmit` → PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/app/me/profile/page.tsx frontend/__tests__/MeProfile.test.tsx
git commit -m "feat(amis): interrupteur opt-in « Autoriser les demandes d'ami »"
```

---

## Task 11 : Vérification finale

- [ ] **Step 1: Suites backend touchées**

Run (depuis `backend/`): `npx jest friendship.service friends.routes notifications.friend club.service me.routes --silent`
Expected: PASS.

- [ ] **Step 2: Suites frontend touchées**

Run (depuis `frontend/`): `npx jest FriendButton FollowButton FriendsHub MeProfile --silent`
Expected: PASS.

- [ ] **Step 3: Typecheck des deux côtés**

Run: `cd backend && npx tsc --noEmit` puis `cd ../frontend && npx tsc --noEmit`
Expected: PASS des deux.

- [ ] **Step 4: Mettre à jour `CLAUDE.md`**

Ajouter une entrée « Amis — opt-in + demandes (v1) ✅ implémenté » résumant : modèle `Friendship` + `User.acceptsFriendRequests`, `FriendshipService`, routes, `FriendButton`, hub réorganisé, `FollowButton` désambiguïsé, migration appliquée via `prisma db execute`. Renvoyer à la spec/plan. Noter la **spec B (messagerie)** comme suite.

```bash
git add CLAUDE.md
git commit -m "docs(amis): entrée CLAUDE.md — opt-in + demandes d'ami"
```

---

## Notes de couverture (self-review)

- **`User.acceptsFriendRequests` (opt-in)** → Task 1 (schema), Task 6 (PATCH/GET), Task 10 (UI).
- **Modèle `Friendship` + acceptation directe + refus** → Task 1, Task 3.
- **Notifications `SOCIAL` friend.request/accepted** → Task 2.
- **Routes club-scopées + globales + mapping d'erreurs** → Task 4.
- **Annuaire annoté (`friend`)** → Task 5.
- **`FriendButton` (5 états) + `FollowButton` désambiguïsé** → Task 8, Task 8bis.
- **Hub réorganisé (Amis/Demandes/Abonnements/Abonnés/Trouver) + deeplink `?tab=demandes`** → Task 9.
- **Hors périmètre (messagerie, blocage, email demandes, inter-clubs)** → non couvert **volontairement** (spec B / hors v1).
