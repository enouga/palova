# Système d'amis (suivi de joueurs) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à un joueur de suivre d'autres joueurs (« amis », lien à sens unique) et de les ajouter en un tap lors d'une partie/réservation, partout où l'on choisit un coéquipier.

**Architecture:** Une table `Follow` globale (pas de `clubId`) ; l'action « suivre » est exposée sur une route club-scoped qui vérifie la co-appartenance active au club courant (frontière de confidentialité + branding de notif). Un endpoint pivot `GET /api/clubs/:slug/friends` = mes amis globaux ∩ membres actifs du club, qui alimente une rangée « Mes amis » ajoutée **dans `PartnerSearch`** (composant déjà réutilisé par `BookingModal`, l'ajout-organisateur de partie ouverte, et l'inscription tournoi → 3 surfaces d'un coup). Le statut « ami » (réciproque) est dérivé, jamais stocké. Bouton de suivi réutilisable + hub `/me/friends`.

**Tech Stack:** Backend Express 5 + Prisma 7 (Postgres). Frontend Next.js 16 + React 19, styles inline via `useTheme`. Tests : Jest + `prismaMock` (backend), React Testing Library + mock `@/lib/api` (frontend).

**Référence spec :** `docs/superpowers/specs/2026-06-30-systeme-amis-suivi-design.md`

**Rappels d'environnement :**
- Dev DB en dérive → **ne jamais lancer `prisma migrate dev`** (reset destructif). Appliquer l'additif via `prisma db push` puis `prisma generate`. Écrire aussi le SQL de migration pour la prod (`migrate deploy`).
- `OpenMatches` monte le **vrai `ClubNav`** dans ses tests : tout nouvel appel `api.*` ajouté à un composant monté par ces suites doit être ajouté au mock `@/lib/api`. **Ne pas** ajouter d'appel `api.*` à `ClubNav` lui-même.
- Préserver les retouches cosmétiques en cours (loupe + halo) du champ de recherche dans `PlayerPicker.tsx` et `PartnerSearch.tsx`.
- OneDrive peut amputer `node_modules/.prisma` : après désync, réflexe `npm install` + `npx prisma generate`.

---

## Task 1 : Modèle `Follow` + enum `SOCIAL` + migration

**Files:**
- Modify: `backend/prisma/schema.prisma` (model `User` relations ~ ligne 460, ajout model `Follow`, enum `NotificationCategory` ~ ligne 1183)
- Create: `backend/prisma/migrations/20260630120000_add_player_follows/migration.sql`

- [ ] **Step 1: Ajouter la valeur d'enum `SOCIAL`**

Dans `enum NotificationCategory` (après `OPEN_MATCH_CHAT`) :

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
  SOCIAL
}
```

- [ ] **Step 2: Ajouter les relations sur `User`**

Dans `model User`, juste après `openMatchMessages       OpenMatchMessage[]` :

```prisma
  openMatchMessages       OpenMatchMessage[]
  followsGiven            Follow[] @relation("FollowsGiven")
  followsReceived         Follow[] @relation("FollowsReceived")
```

- [ ] **Step 3: Ajouter le model `Follow`**

À la fin du fichier (près des autres modèles sociaux comme `OpenMatchInterest`) :

```prisma
// Suivi de joueur à sens unique (« ami »). Friendship GLOBALE (pas de clubId) ;
// l'action de suivi est gardée club-scoped côté route. « Ami » mutuel = dérivé (les 2 lignes existent).
model Follow {
  id          String   @id @default(cuid())
  followerId  String   @map("follower_id")
  followingId String   @map("following_id")
  createdAt   DateTime @default(now()) @map("created_at")

  follower  User @relation("FollowsGiven",    fields: [followerId],  references: [id], onDelete: Cascade)
  following User @relation("FollowsReceived", fields: [followingId], references: [id], onDelete: Cascade)

  @@unique([followerId, followingId])
  @@index([followingId])
  @@map("follows")
}
```

- [ ] **Step 4: Écrire le SQL de migration (pour la prod)**

`backend/prisma/migrations/20260630120000_add_player_follows/migration.sql` :

```sql
-- Ajoute la catégorie de notification sociale (suivi). Idempotent.
ALTER TYPE "NotificationCategory" ADD VALUE IF NOT EXISTS 'SOCIAL';

-- Table de suivi de joueur (friendship globale, sens unique).
CREATE TABLE "follows" (
  "id"           TEXT NOT NULL,
  "follower_id"  TEXT NOT NULL,
  "following_id" TEXT NOT NULL,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "follows_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "follows_follower_id_following_id_key" ON "follows"("follower_id", "following_id");
CREATE INDEX "follows_following_id_idx" ON "follows"("following_id");

ALTER TABLE "follows" ADD CONSTRAINT "follows_follower_id_fkey"
  FOREIGN KEY ("follower_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "follows" ADD CONSTRAINT "follows_following_id_fkey"
  FOREIGN KEY ("following_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 5: Appliquer en dev (SQL additif direct, PAS `db push`) + régénérer le client**

⚠️ La base dev est **partagée avec la checkout principale** et a une dérive de migrations connue. **Ne PAS utiliser `prisma db push`** : il synchronise tout le schéma et pourrait **supprimer** des colonnes que la base possède mais que ce schéma (basé origin/main) ne déclare pas. Appliquer **uniquement** le SQL additif :

Run (depuis `backend/`) :
```bash
npx prisma db execute --file prisma/migrations/20260630120000_add_player_follows/migration.sql --schema prisma/schema.prisma
npx prisma generate
```
Expected: la table `follows` + la valeur d'enum `SOCIAL` sont créées (SQL idempotent : `IF NOT EXISTS`). `generate` régénère le client avec `prisma.follow` (écrit dans le `node_modules` jonctionné, partagé avec main — inoffensif car additif). Vérifier ensuite : `node -e "const{PrismaClient}=require('@prisma/client'); console.log(typeof new PrismaClient().follow)"` → `object`.

- [ ] **Step 6: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260630120000_add_player_follows/
git commit -m "feat(amis): table Follow + catégorie de notif SOCIAL"
```

---

## Task 2 : `FollowService` — follow / unfollow / relation

**Files:**
- Create: `backend/src/services/follow.service.ts`
- Test: `backend/src/services/__tests__/follow.service.test.ts`

- [ ] **Step 1: Écrire les tests qui échouent**

`backend/src/services/__tests__/follow.service.test.ts` :

```typescript
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { FollowService } from '../follow.service';

const mockNotifyFollow = jest.fn();
jest.mock('../../email/notifications', () => ({
  notifyNewFollower: (...args: unknown[]) => mockNotifyFollow(...args),
}));

const ACTIVE = { status: 'ACTIVE' } as any;

describe('FollowService — follow/unfollow', () => {
  let service: FollowService;
  beforeEach(() => {
    service = new FollowService();
    mockNotifyFollow.mockReset().mockResolvedValue(undefined);
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
    // par défaut : les deux sont membres actifs
    prismaMock.clubMembership.findUnique.mockResolvedValue(ACTIVE);
  });

  it('refuse de se suivre soi-même', async () => {
    await expect(service.follow('demo', 'u1', 'u1')).rejects.toThrow('CANNOT_FOLLOW_SELF');
  });

  it('refuse si la cible n\'est pas membre actif du club', async () => {
    prismaMock.clubMembership.findUnique
      .mockResolvedValueOnce(ACTIVE)   // caller
      .mockResolvedValueOnce(null);    // target
    await expect(service.follow('demo', 'u1', 'u2')).rejects.toThrow('NOT_A_MEMBER');
  });

  it('crée le suivi, notifie, et renvoie la relation', async () => {
    prismaMock.follow.findUnique.mockResolvedValue(null); // pas encore suivi
    prismaMock.follow.create.mockResolvedValue({ id: 'f1' } as any);
    prismaMock.follow.findMany.mockResolvedValue([{ followerId: 'u1', followingId: 'u2' }] as any);

    const rel = await service.follow('demo', 'u1', 'u2');

    expect(prismaMock.follow.create).toHaveBeenCalledWith({ data: { followerId: 'u1', followingId: 'u2' } });
    expect(mockNotifyFollow).toHaveBeenCalledWith('u1', 'u2', 'club-demo');
    expect(rel).toEqual({ iFollow: true, followsMe: false, mutual: false });
  });

  it('re-suivre est idempotent et ne renotifie pas', async () => {
    prismaMock.follow.findUnique.mockResolvedValue({ id: 'f1' } as any); // déjà suivi
    prismaMock.follow.findMany.mockResolvedValue([{ followerId: 'u1', followingId: 'u2' }] as any);

    await service.follow('demo', 'u1', 'u2');

    expect(prismaMock.follow.create).not.toHaveBeenCalled();
    expect(mockNotifyFollow).not.toHaveBeenCalled();
  });

  it('détecte la réciprocité (mutual)', async () => {
    prismaMock.follow.findUnique.mockResolvedValue({ id: 'f1' } as any);
    prismaMock.follow.findMany.mockResolvedValue([
      { followerId: 'u1', followingId: 'u2' },
      { followerId: 'u2', followingId: 'u1' },
    ] as any);

    const rel = await service.follow('demo', 'u1', 'u2');
    expect(rel).toEqual({ iFollow: true, followsMe: true, mutual: true });
  });

  it('unfollow supprime (deleteMany, idempotent) et renvoie la relation', async () => {
    prismaMock.follow.deleteMany.mockResolvedValue({ count: 1 } as any);
    prismaMock.follow.findMany.mockResolvedValue([] as any);

    const rel = await service.unfollow('demo', 'u1', 'u2');

    expect(prismaMock.follow.deleteMany).toHaveBeenCalledWith({ where: { followerId: 'u1', followingId: 'u2' } });
    expect(rel).toEqual({ iFollow: false, followsMe: false, mutual: false });
  });
});
```

- [ ] **Step 2: Lancer les tests → échec attendu**

Run: `cd backend && npx jest follow.service --silent`
Expected: FAIL — `Cannot find module '../follow.service'`.

- [ ] **Step 3: Implémenter `FollowService` (follow/unfollow/relation)**

`backend/src/services/follow.service.ts` :

```typescript
import { prisma } from '../db/prisma';
import { notifyNewFollower } from '../email/notifications';

export interface FollowRelation {
  iFollow: boolean;
  followsMe: boolean;
  mutual: boolean;
}

export class FollowService {
  /** Vérifie que le club existe/ACTIVE et renvoie son id. */
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

  /** Relation entre deux joueurs (lue en une requête). */
  async getRelationship(a: string, b: string): Promise<FollowRelation> {
    const rows = await prisma.follow.findMany({
      where: { OR: [{ followerId: a, followingId: b }, { followerId: b, followingId: a }] },
      select: { followerId: true, followingId: true },
    });
    const iFollow   = rows.some((r) => r.followerId === a && r.followingId === b);
    const followsMe = rows.some((r) => r.followerId === b && r.followingId === a);
    return { iFollow, followsMe, mutual: iFollow && followsMe };
  }

  /** Suit un joueur depuis le contexte d'un club (co-membres actifs requis). Idempotent. */
  async follow(slug: string, followerId: string, targetUserId: string): Promise<FollowRelation> {
    if (followerId === targetUserId) throw new Error('CANNOT_FOLLOW_SELF');
    const clubId = await this.activeClubId(slug);
    await this.assertActiveMember(followerId, clubId, 'MEMBERSHIP_REQUIRED');
    await this.assertActiveMember(targetUserId, clubId, 'NOT_A_MEMBER');

    const existing = await prisma.follow.findUnique({
      where: { followerId_followingId: { followerId, followingId: targetUserId } },
      select: { id: true },
    });
    if (!existing) {
      await prisma.follow.create({ data: { followerId, followingId: targetUserId } });
      // best-effort, après écriture : ne jamais faire échouer le suivi sur une notif.
      notifyNewFollower(followerId, targetUserId, clubId).catch(() => {});
    }
    return this.getRelationship(followerId, targetUserId);
  }

  /** Cesse de suivre. Idempotent (deleteMany). */
  async unfollow(slug: string, followerId: string, targetUserId: string): Promise<FollowRelation> {
    const clubId = await this.activeClubId(slug);
    await this.assertActiveMember(followerId, clubId, 'MEMBERSHIP_REQUIRED');
    await prisma.follow.deleteMany({ where: { followerId, followingId: targetUserId } });
    return this.getRelationship(followerId, targetUserId);
  }
}
```

- [ ] **Step 4: Stubber `notifyNewFollower` pour que l'import existe**

Le test mocke `../../email/notifications`, mais l'implémentation réelle l'importe. Ajouter un stub temporaire dans `backend/src/email/notifications.ts` (sera complété en Task 6) — à la fin du fichier :

```typescript
// Notif « X vous suit » (in-app + push, pas d'email). Implémentée en Task 6.
export async function notifyNewFollower(_followerId: string, _targetUserId: string, _clubId: string): Promise<void> {
  // TODO Task 6 — orchestration dispatch()
}
```

- [ ] **Step 5: Lancer les tests → succès**

Run: `cd backend && npx jest follow.service --silent`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/follow.service.ts backend/src/services/__tests__/follow.service.test.ts backend/src/email/notifications.ts
git commit -m "feat(amis): FollowService follow/unfollow + relation dérivée"
```

---

## Task 3 : `FollowService` — listes following / followers (avec mutual)

**Files:**
- Modify: `backend/src/services/follow.service.ts`
- Test: `backend/src/services/__tests__/follow.service.test.ts`

- [ ] **Step 1: Ajouter les tests qui échouent**

Ajouter ce bloc dans le fichier de test :

```typescript
describe('FollowService — listes', () => {
  let service: FollowService;
  beforeEach(() => { service = new FollowService(); });

  it('listFollowing renvoie mes suivis avec le flag mutual', async () => {
    prismaMock.follow.findMany
      .mockResolvedValueOnce([ // mes suivis
        { following: { id: 'u2', firstName: 'Léa', lastName: 'M', avatarUrl: null } },
        { following: { id: 'u3', firstName: 'Tom', lastName: 'B', avatarUrl: 'a.png' } },
      ] as any)
      .mockResolvedValueOnce([{ followerId: 'u2' }] as any); // qui me suit en retour (parmi u2,u3)

    const list = await service.listFollowing('u1');

    expect(list).toEqual([
      { id: 'u2', firstName: 'Léa', lastName: 'M', avatarUrl: null,    mutual: true },
      { id: 'u3', firstName: 'Tom', lastName: 'B', avatarUrl: 'a.png', mutual: false },
    ]);
  });

  it('listFollowers renvoie ceux qui me suivent avec le flag mutual', async () => {
    prismaMock.follow.findMany
      .mockResolvedValueOnce([
        { follower: { id: 'u2', firstName: 'Léa', lastName: 'M', avatarUrl: null } },
      ] as any)
      .mockResolvedValueOnce([{ followingId: 'u2' }] as any); // ceux que je suis (parmi mes followers)

    const list = await service.listFollowers('u1');
    expect(list).toEqual([{ id: 'u2', firstName: 'Léa', lastName: 'M', avatarUrl: null, mutual: true }]);
  });
});
```

- [ ] **Step 2: Lancer → échec attendu**

Run: `cd backend && npx jest follow.service --silent`
Expected: FAIL — `service.listFollowing is not a function`.

- [ ] **Step 3: Implémenter les deux listes**

Ajouter dans la classe `FollowService` :

```typescript
  /** Mes amis (joueurs que je suis), filtrables par nom, avec flag mutual. Global. */
  async listFollowing(userId: string, q?: string): Promise<Friend[]> {
    const query = (q ?? '').trim();
    const rows = await prisma.follow.findMany({
      where: {
        followerId: userId,
        ...(query
          ? { following: { OR: [{ firstName: { contains: query, mode: 'insensitive' } }, { lastName: { contains: query, mode: 'insensitive' } }] } }
          : {}),
      },
      orderBy: [{ following: { lastName: 'asc' } }, { following: { firstName: 'asc' } }],
      select: { following: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
    });
    const ids = rows.map((r) => r.following.id);
    const back = await prisma.follow.findMany({
      where: { followerId: { in: ids }, followingId: userId },
      select: { followerId: true },
    });
    const mutualSet = new Set(back.map((b) => b.followerId));
    return rows.map((r) => ({ ...r.following, mutual: mutualSet.has(r.following.id) }));
  }

  /** Ceux qui me suivent, avec flag mutual. Global. */
  async listFollowers(userId: string): Promise<Friend[]> {
    const rows = await prisma.follow.findMany({
      where: { followingId: userId },
      orderBy: [{ follower: { lastName: 'asc' } }, { follower: { firstName: 'asc' } }],
      select: { follower: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
    });
    const ids = rows.map((r) => r.follower.id);
    const mine = await prisma.follow.findMany({
      where: { followerId: userId, followingId: { in: ids } },
      select: { followingId: true },
    });
    const mutualSet = new Set(mine.map((m) => m.followingId));
    return rows.map((r) => ({ ...r.follower, mutual: mutualSet.has(r.follower.id) }));
  }
```

Et ajouter le type `Friend` près de `FollowRelation` en haut du fichier :

```typescript
export interface Friend {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  mutual: boolean;
}
```

- [ ] **Step 4: Lancer → succès**

Run: `cd backend && npx jest follow.service --silent`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/follow.service.ts backend/src/services/__tests__/follow.service.test.ts
git commit -m "feat(amis): listFollowing/listFollowers avec mutual dérivé"
```

---

## Task 4 : `FollowService.listClubFriends` (endpoint pivot d'ajout rapide)

**Files:**
- Modify: `backend/src/services/follow.service.ts`
- Test: `backend/src/services/__tests__/follow.service.test.ts`

- [ ] **Step 1: Ajouter le test qui échoue**

```typescript
describe('FollowService — amis du club (ajout rapide)', () => {
  let service: FollowService;
  beforeEach(() => {
    service = new FollowService();
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-padel' } as any);
    prismaMock.playerRating.findMany.mockResolvedValue([] as any);
  });

  it('renvoie mes amis qui sont membres actifs du club, avec niveau et avatar', async () => {
    // mes amis globaux qui sont aussi membres actifs de ce club
    prismaMock.follow.findMany
      .mockResolvedValueOnce([
        { following: { id: 'u2', firstName: 'Léa', lastName: 'M', avatarUrl: null } },
      ] as any)
      .mockResolvedValueOnce([{ followerId: 'u2' }] as any); // mutual
    const list = await service.listClubFriends('demo', 'u1');
    expect(list).toEqual([{ id: 'u2', firstName: 'Léa', lastName: 'M', avatarUrl: null, level: null, mutual: true }]);
    // le filtre passe bien par la co-appartenance active au club
    const arg = (prismaMock.follow.findMany as jest.Mock).mock.calls[0][0];
    expect(arg.where.following.clubMemberships.some).toEqual({ clubId: 'club-demo', status: 'ACTIVE' });
  });
});
```

- [ ] **Step 2: Lancer → échec attendu**

Run: `cd backend && npx jest follow.service --silent`
Expected: FAIL — `service.listClubFriends is not a function`.

- [ ] **Step 3: Implémenter `listClubFriends`**

Ajouter les imports en haut du fichier :

```typescript
import { RatingService } from './rating.service';
import { resolvePreferredSportKey } from './rating/preferredSport';
import type { UserLevel } from './rating.service';
```

> Si `UserLevel` n'est pas exporté par `rating.service`, retirer cet import et typer `level` en `any | null` dans `ClubFriend` (le front a déjà le type). Vérifier l'export réel avant de figer.

Ajouter un champ privé et le type, puis la méthode :

```typescript
export interface ClubFriend extends Friend {
  level: UserLevel | null;
}

// dans la classe :
  private ratingService = new RatingService();

  /** Mes amis ∩ membres ACTIFS du club, avec niveau (sport préféré du caller) + avatar. */
  async listClubFriends(slug: string, userId: string, q?: string): Promise<ClubFriend[]> {
    const clubId = await this.activeClubId(slug);
    await this.assertActiveMember(userId, clubId, 'MEMBERSHIP_REQUIRED');
    const query = (q ?? '').trim();

    const rows = await prisma.follow.findMany({
      where: {
        followerId: userId,
        following: {
          clubMemberships: { some: { clubId, status: 'ACTIVE' } },
          ...(query
            ? { OR: [{ firstName: { contains: query, mode: 'insensitive' } }, { lastName: { contains: query, mode: 'insensitive' } }] }
            : {}),
        },
      },
      orderBy: [{ following: { lastName: 'asc' } }, { following: { firstName: 'asc' } }],
      take: 30,
      select: { following: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
    });
    const ids = rows.map((r) => r.following.id);
    if (ids.length === 0) return [];

    const back = await prisma.follow.findMany({
      where: { followerId: { in: ids }, followingId: userId },
      select: { followerId: true },
    });
    const mutualSet = new Set(back.map((b) => b.followerId));
    const sportKey = await resolvePreferredSportKey(userId);
    const levels = await this.ratingService.getLevelsForUsers(ids, sportKey);

    return rows.map((r) => ({
      id: r.following.id,
      firstName: r.following.firstName,
      lastName: r.following.lastName,
      avatarUrl: r.following.avatarUrl,
      level: levels[r.following.id] ?? null,
      mutual: mutualSet.has(r.following.id),
    }));
  }
```

- [ ] **Step 4: Lancer → succès**

Run: `cd backend && npx jest follow.service --silent`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/follow.service.ts backend/src/services/__tests__/follow.service.test.ts
git commit -m "feat(amis): listClubFriends (amis du club avec niveau) pour l'ajout rapide"
```

---

## Task 5 : Enrichir `searchMembers` (iFollow / mutual)

**Files:**
- Modify: `backend/src/services/club.service.ts` (méthode `searchMembers`, ~ lignes 428-456)
- Test: `backend/src/services/__tests__/club.service.test.ts`

- [ ] **Step 1: Ajouter le test qui échoue**

Dans `club.service.test.ts`, ajouter au `describe('ClubService — recherche de membres', …)` :

```typescript
it('annote chaque résultat avec iFollow / mutual', async () => {
  prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
  prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);
  prismaMock.clubMembership.findMany.mockResolvedValue([
    { user: { id: 'u2', firstName: 'Léa', lastName: 'M' } },
    { user: { id: 'u3', firstName: 'Tom', lastName: 'B' } },
  ] as any);
  prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-padel' } as any);
  prismaMock.playerRating.findMany.mockResolvedValue([] as any);
  // u2 : je le suis et il me suit (mutual) ; u3 : aucun lien
  prismaMock.follow.findMany.mockResolvedValue([
    { followerId: 'caller', followingId: 'u2' },
    { followerId: 'u2', followingId: 'caller' },
  ] as any);

  const result = await service.searchMembers('demo', 'caller', '');

  expect(result).toEqual([
    { id: 'u2', firstName: 'Léa', lastName: 'M', level: null, iFollow: true,  mutual: true },
    { id: 'u3', firstName: 'Tom', lastName: 'B', level: null, iFollow: false, mutual: false },
  ]);
});
```

- [ ] **Step 2: Lancer → échec attendu**

Run: `cd backend && npx jest club.service --silent -t "iFollow"`
Expected: FAIL — le résultat n'a pas `iFollow`/`mutual`.

- [ ] **Step 3: Implémenter l'enrichissement**

Dans `searchMembers`, remplacer le `return` final :

```typescript
  const userIds = members.map((m) => m.user.id);
  const sportKey = await resolvePreferredSportKey(callerUserId);
  const levels = await this.ratingService.getLevelsForUsers(userIds, sportKey);
  return members.map((m) => ({ ...m.user, level: levels[m.user.id] ?? null }));
```

par :

```typescript
  const userIds = members.map((m) => m.user.id);
  const sportKey = await resolvePreferredSportKey(callerUserId);
  const levels = await this.ratingService.getLevelsForUsers(userIds, sportKey);
  // Annoter le lien de suivi avec le caller (1 requête sur les ids retournés, sens A↔B).
  const links = await prisma.follow.findMany({
    where: {
      OR: [
        { followerId: callerUserId, followingId: { in: userIds } },
        { followerId: { in: userIds }, followingId: callerUserId },
      ],
    },
    select: { followerId: true, followingId: true },
  });
  const iFollowSet  = new Set(links.filter((l) => l.followerId === callerUserId).map((l) => l.followingId));
  const followsMe   = new Set(links.filter((l) => l.followingId === callerUserId).map((l) => l.followerId));
  return members.map((m) => ({
    ...m.user,
    level: levels[m.user.id] ?? null,
    iFollow: iFollowSet.has(m.user.id),
    mutual: iFollowSet.has(m.user.id) && followsMe.has(m.user.id),
  }));
```

- [ ] **Step 4: Lancer → succès (et non-régression de la suite)**

Run: `cd backend && npx jest club.service --silent`
Expected: PASS (tous les tests, y compris les anciens — `level: null` reste présent).

> Note : les anciens tests comparaient `toEqual([{ id, firstName, lastName, level: null }])`. L'ajout de `iFollow`/`mutual` casse ces `toEqual` stricts. Mettre à jour ces assertions pour inclure `iFollow: false, mutual: false` (aucun lien mocké → `prismaMock.follow.findMany` renvoie `[]` par défaut ; s'assurer qu'il est mocké à `[]` dans le `beforeEach` de ce describe).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/club.service.ts backend/src/services/__tests__/club.service.test.ts
git commit -m "feat(amis): searchMembers annote iFollow/mutual pour le toggle de suivi inline"
```

---

## Task 6 : Notification « X vous suit » (`notifyNewFollower`)

**Files:**
- Modify: `backend/src/email/notifications.ts` (remplacer le stub de Task 2)
- Test: `backend/src/email/__tests__/notifications.follow.test.ts`

- [ ] **Step 1: Écrire le test qui échoue**

`backend/src/email/__tests__/notifications.follow.test.ts` :

```typescript
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';

const mockDispatch = jest.fn();
jest.mock('../../services/notification/dispatcher', () => ({ dispatch: (...a: unknown[]) => mockDispatch(...a) }));

import { notifyNewFollower } from '../notifications';

describe('notifyNewFollower', () => {
  beforeEach(() => {
    mockDispatch.mockReset().mockResolvedValue(undefined);
    prismaMock.user.findUnique.mockResolvedValue({ firstName: 'Léa', lastName: 'M' } as any);
    prismaMock.notification.findFirst.mockResolvedValue(null); // pas de notif non lue existante
  });

  it('dispatche une notif SOCIAL in-app/push sans email', async () => {
    await notifyNewFollower('u1', 'u2', 'club-demo');
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    const arg = mockDispatch.mock.calls[0][0];
    expect(arg).toMatchObject({
      userId: 'u2',
      clubId: 'club-demo',
      category: 'SOCIAL',
      type: 'follow.new',
      data: { followerId: 'u1' },
    });
    expect(arg.email).toBeFalsy();
    expect(arg.url).toBe('/me/friends?tab=followers');
  });

  it('coalesce : ne renotifie pas si une notif follow.new non lue du même suiveur existe', async () => {
    prismaMock.notification.findFirst.mockResolvedValue({ id: 'n1' } as any);
    await notifyNewFollower('u1', 'u2', 'club-demo');
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Lancer → échec attendu**

Run: `cd backend && npx jest notifications.follow --silent`
Expected: FAIL (le stub ne dispatche rien).

- [ ] **Step 3: Implémenter `notifyNewFollower`**

Remplacer le stub ajouté en Task 2 dans `backend/src/email/notifications.ts`. Vérifier que `dispatch` est déjà importé en haut du fichier (les notifiers open-match l'utilisent) ; sinon ajouter `import { dispatch } from '../services/notification/dispatcher';`.

```typescript
// Notif « X vous suit » (in-app + push, pas d'email). Best-effort.
// Coalescing : on saute si une notif follow.new non lue du même suiveur existe déjà pour ce destinataire.
export async function notifyNewFollower(followerId: string, targetUserId: string, clubId: string): Promise<void> {
  const follower = await prisma.user.findUnique({ where: { id: followerId }, select: { firstName: true, lastName: true } });
  if (!follower) return;
  const already = await prisma.notification.findFirst({
    where: { userId: targetUserId, type: 'follow.new', readAt: null, data: { path: ['followerId'], equals: followerId } },
    select: { id: true },
  });
  if (already) return;
  const name = `${follower.firstName} ${follower.lastName}`.trim();
  await dispatch({
    userId: targetUserId,
    clubId,
    category: 'SOCIAL',
    type: 'follow.new',
    title: `${name} vous suit`,
    body: `${name} vous a ajouté à ses amis. Suivez-le en retour pour vous retrouver plus vite.`,
    url: '/me/friends?tab=followers',
    data: { followerId },
    email: null,
  });
}
```

> Vérifier que `prisma` est importé dans `notifications.ts` (il l'est déjà pour les autres notifiers). Si l'objet `data` JSON-path filtre n'est pas supporté par le mock de test, le test mocke `notification.findFirst` directement donc ce n'est pas un souci en test ; en runtime Postgres le `path/equals` fonctionne.

- [ ] **Step 4: Lancer → succès**

Run: `cd backend && npx jest notifications.follow --silent`
Expected: PASS (2 tests). Relancer aussi `npx jest follow.service --silent` → toujours PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/email/notifications.ts backend/src/email/__tests__/notifications.follow.test.ts
git commit -m "feat(amis): notification SOCIAL « X vous suit » (in-app/push, coalescée)"
```

---

## Task 7 : Routes Express (follows club-scoped + listes me + amis du club)

**Files:**
- Modify: `backend/src/routes/clubs.ts` (instancier le service ~ après les autres `const xService = new ...`, ajouter routes près de `/:slug/members/search` et `/:slug/open-matches`)
- Modify: `backend/src/routes/me.ts` (ajouter `/following` et `/followers`)
- Modify: `backend/src/routes/clubs.ts` ERROR_STATUS (ajouter `NOT_A_MEMBER`)
- Test: `backend/src/routes/__tests__/follows.routes.test.ts`

- [ ] **Step 1: Écrire le test de routes qui échoue**

`backend/src/routes/__tests__/follows.routes.test.ts` (mirroir des tests de routes existants — vérifier le harness `request(app)` utilisé par `reservations.routes.test.ts` et copier son `beforeAll`/mock auth) :

```typescript
import request from 'supertest';
import { app } from '../../app';

const mockFollow = jest.fn();
const mockUnfollow = jest.fn();
const mockClubFriends = jest.fn();
const mockFollowing = jest.fn();
const mockFollowers = jest.fn();
jest.mock('../../services/follow.service', () => ({
  FollowService: jest.fn().mockImplementation(() => ({
    follow: mockFollow, unfollow: mockUnfollow, listClubFriends: mockClubFriends,
    listFollowing: mockFollowing, listFollowers: mockFollowers,
  })),
}));

// Réutiliser le même mock JWT/auth que les autres suites de routes (authMiddleware → req.user.id='u1').
// Voir reservations.routes.test.ts pour le pattern exact (jest.mock('../../middleware/auth', ...)).

describe('routes follows', () => {
  beforeEach(() => { [mockFollow, mockUnfollow, mockClubFriends, mockFollowing, mockFollowers].forEach((m) => m.mockReset()); });

  it('POST /api/clubs/:slug/follows/:userId', async () => {
    mockFollow.mockResolvedValue({ iFollow: true, followsMe: false, mutual: false });
    const res = await request(app).post('/api/clubs/demo/follows/u2').set('Authorization', 'Bearer t');
    expect(res.status).toBe(200);
    expect(mockFollow).toHaveBeenCalledWith('demo', 'u1', 'u2');
    expect(res.body).toEqual({ iFollow: true, followsMe: false, mutual: false });
  });

  it('DELETE /api/clubs/:slug/follows/:userId', async () => {
    mockUnfollow.mockResolvedValue({ iFollow: false, followsMe: false, mutual: false });
    const res = await request(app).delete('/api/clubs/demo/follows/u2').set('Authorization', 'Bearer t');
    expect(res.status).toBe(200);
    expect(mockUnfollow).toHaveBeenCalledWith('demo', 'u1', 'u2');
  });

  it('GET /api/clubs/:slug/friends', async () => {
    mockClubFriends.mockResolvedValue([{ id: 'u2', firstName: 'Léa', lastName: 'M', avatarUrl: null, level: null, mutual: true }]);
    const res = await request(app).get('/api/clubs/demo/friends?q=lé').set('Authorization', 'Bearer t');
    expect(res.status).toBe(200);
    expect(mockClubFriends).toHaveBeenCalledWith('demo', 'u1', 'lé');
  });

  it('GET /api/me/following', async () => {
    mockFollowing.mockResolvedValue([]);
    const res = await request(app).get('/api/me/following?q=lé').set('Authorization', 'Bearer t');
    expect(res.status).toBe(200);
    expect(mockFollowing).toHaveBeenCalledWith('u1', 'lé');
  });

  it('GET /api/me/followers', async () => {
    mockFollowers.mockResolvedValue([]);
    const res = await request(app).get('/api/me/followers').set('Authorization', 'Bearer t');
    expect(res.status).toBe(200);
    expect(mockFollowers).toHaveBeenCalledWith('u1');
  });
});
```

> Avant d'écrire, ouvrir `backend/src/routes/__tests__/reservations.routes.test.ts` et copier **exactement** son mock d'auth (`jest.mock('../../middleware/auth', ...)`) pour que `req.user.id` vaille `'u1'`. Si ces suites n'utilisent pas supertest mais un autre harness, s'aligner dessus.

- [ ] **Step 2: Lancer → échec attendu**

Run: `cd backend && npx jest follows.routes --silent`
Expected: FAIL — 404 (routes inexistantes).

- [ ] **Step 3: Ajouter `NOT_A_MEMBER` à ERROR_STATUS**

Dans `backend/src/routes/clubs.ts`, dans `ERROR_STATUS`, ajouter :

```typescript
  NOT_A_MEMBER:          404,
```

- [ ] **Step 4: Instancier le service + routes dans `clubs.ts`**

Ajouter l'import en haut : `import { FollowService } from '../services/follow.service';`
Près des autres instanciations (`const clubService = new ClubService();` etc.) :

```typescript
const followService = new FollowService();
```

Ajouter les routes (à côté de `/:slug/members/search`) :

```typescript
// --- Amis / suivi ---
router.get('/:slug/friends', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await followService.listClubFriends(asString(req.params.slug), req.user!.id, asString(req.query.q))); }
  catch (err) { handleError(err, res, next); }
});

router.post('/:slug/follows/:userId', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await followService.follow(asString(req.params.slug), req.user!.id, asString(req.params.userId))); }
  catch (err) { handleError(err, res, next); }
});

router.delete('/:slug/follows/:userId', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await followService.unfollow(asString(req.params.slug), req.user!.id, asString(req.params.userId))); }
  catch (err) { handleError(err, res, next); }
});
```

- [ ] **Step 5: Routes listes dans `me.ts`**

Ajouter en haut de `me.ts` : `import { FollowService } from '../services/follow.service';` puis `const followService = new FollowService();` (près des autres services). Ajouter les routes :

```typescript
router.get('/following', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await followService.listFollowing(req.user!.id, typeof req.query.q === 'string' ? req.query.q : undefined)); }
  catch (err) { next(err); }
});

router.get('/followers', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await followService.listFollowers(req.user!.id)); }
  catch (err) { next(err); }
});
```

> `asString` est un helper local de `clubs.ts` ; dans `me.ts` les query params sont lus directement (cf. routes existantes). Adapter au style du fichier.

- [ ] **Step 6: Lancer → succès**

Run: `cd backend && npx jest follows.routes --silent`
Expected: PASS (5 tests).

- [ ] **Step 7: Vérifier la compilation TS + suite backend**

Run: `cd backend && npx tsc --noEmit && npx jest --silent`
Expected: 0 erreur TS ; suites vertes.

- [ ] **Step 8: Commit**

```bash
git add backend/src/routes/clubs.ts backend/src/routes/me.ts backend/src/routes/__tests__/follows.routes.test.ts
git commit -m "feat(amis): routes follows (club-scoped) + listes following/followers + amis du club"
```

---

## Task 8 : Client API + types (frontend)

**Files:**
- Modify: `frontend/lib/api.ts` (types vers ligne 1810 ; méthodes dans l'objet `api`)

- [ ] **Step 1: Ajouter les types**

Près de `ClubMemberSearchResult` :

```typescript
export interface ClubMemberSearchResult {
  id: string;
  firstName: string;
  lastName: string;
  level?: UserLevel | null;
  iFollow?: boolean;   // annoté par searchMembers
  mutual?: boolean;
}

export interface Friend {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  level?: UserLevel | null;
  mutual: boolean;
}

export interface FollowRelation {
  iFollow: boolean;
  followsMe: boolean;
  mutual: boolean;
}
```

- [ ] **Step 2: Ajouter les méthodes dans l'objet `api`**

```typescript
  // --- Amis / suivi ---
  listClubFriends: (slug: string, token: string, q?: string) =>
    request<Friend[]>(`/api/clubs/${slug}/friends${q ? `?q=${encodeURIComponent(q)}` : ''}`, {}, token),
  listFollowing: (token: string, q?: string) =>
    request<Friend[]>(`/api/me/following${q ? `?q=${encodeURIComponent(q)}` : ''}`, {}, token),
  listFollowers: (token: string) =>
    request<Friend[]>(`/api/me/followers`, {}, token),
  followUser: (slug: string, userId: string, token: string) =>
    request<FollowRelation>(`/api/clubs/${slug}/follows/${userId}`, { method: 'POST' }, token),
  unfollowUser: (slug: string, userId: string, token: string) =>
    request<FollowRelation>(`/api/clubs/${slug}/follows/${userId}`, { method: 'DELETE' }, token),
```

- [ ] **Step 3: Vérifier la compilation TS**

Run: `cd frontend && npx tsc --noEmit`
Expected: 0 erreur.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(amis): méthodes API et types Friend/FollowRelation"
```

---

## Task 9 : Composant `FollowButton`

**Files:**
- Create: `frontend/components/social/FollowButton.tsx`
- Test: `frontend/__tests__/FollowButton.test.tsx`

- [ ] **Step 1: Écrire le test qui échoue**

`frontend/__tests__/FollowButton.test.tsx` :

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FollowButton } from '@/components/social/FollowButton';

jest.mock('@/lib/ThemeProvider', () => ({ useTheme: () => ({ th: { accent: '#06c', onAccent: '#fff', surface2: '#eee', line: '#ccc', text: '#111', textMute: '#666', fontUI: 'sans-serif' } }) }));
const followUser = jest.fn();
const unfollowUser = jest.fn();
jest.mock('@/lib/api', () => ({ api: { followUser: (...a: unknown[]) => followUser(...a), unfollowUser: (...a: unknown[]) => unfollowUser(...a) } }));

describe('FollowButton', () => {
  beforeEach(() => { followUser.mockReset().mockResolvedValue({ iFollow: true, followsMe: false, mutual: false }); unfollowUser.mockReset().mockResolvedValue({ iFollow: false, followsMe: false, mutual: false }); });

  it('affiche « Suivre » quand on ne suit pas, et suit au clic (optimiste)', async () => {
    render(<FollowButton slug="demo" userId="u2" token="t" initial={{ iFollow: false, mutual: false }} />);
    const btn = screen.getByRole('button', { name: /suivre/i });
    fireEvent.click(btn);
    expect(await screen.findByRole('button', { name: /suivi/i })).toBeInTheDocument(); // optimiste
    await waitFor(() => expect(followUser).toHaveBeenCalledWith('demo', 'u2', 't'));
  });

  it('affiche « Suivi(e) » et défait au clic', async () => {
    render(<FollowButton slug="demo" userId="u2" token="t" initial={{ iFollow: true, mutual: false }} />);
    fireEvent.click(screen.getByRole('button', { name: /suivi/i }));
    expect(await screen.findByRole('button', { name: /suivre/i })).toBeInTheDocument();
    await waitFor(() => expect(unfollowUser).toHaveBeenCalledWith('demo', 'u2', 't'));
  });

  it('affiche « Amis » quand mutuel', () => {
    render(<FollowButton slug="demo" userId="u2" token="t" initial={{ iFollow: true, mutual: true }} />);
    expect(screen.getByRole('button', { name: /amis/i })).toBeInTheDocument();
  });

  it('revient à l\'état initial si l\'API échoue', async () => {
    followUser.mockRejectedValue(new Error('boom'));
    render(<FollowButton slug="demo" userId="u2" token="t" initial={{ iFollow: false, mutual: false }} />);
    fireEvent.click(screen.getByRole('button', { name: /suivre/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /suivre/i })).toBeInTheDocument()); // rollback
  });
});
```

- [ ] **Step 2: Lancer → échec attendu**

Run: `cd frontend && npx jest FollowButton --silent`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter `FollowButton`**

`frontend/components/social/FollowButton.tsx` :

```typescript
'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Icon } from '@/components/ui/Icon';

// Toggle de suivi réutilisable, optimiste. 3 états : Suivre / Suivi(e) / Amis (mutuel).
export function FollowButton({ slug, userId, token, initial, size = 'sm', onChange }: {
  slug: string;
  userId: string;
  token: string;
  initial: { iFollow: boolean; mutual?: boolean };
  size?: 'sm' | 'xs';
  onChange?: (iFollow: boolean) => void;
}) {
  const { th } = useTheme();
  const [iFollow, setIFollow] = useState(initial.iFollow);
  const [mutual, setMutual]   = useState(!!initial.mutual);
  const [busy, setBusy]       = useState(false);

  const toggle = async () => {
    if (busy) return;
    const next = !iFollow;
    setBusy(true);
    setIFollow(next);                 // optimiste
    if (!next) setMutual(false);
    try {
      const rel = next ? await api.followUser(slug, userId, token) : await api.unfollowUser(slug, userId, token);
      setIFollow(rel.iFollow);
      setMutual(rel.mutual);
      onChange?.(rel.iFollow);
    } catch {
      setIFollow(!next);              // rollback
      setMutual(!!initial.mutual);
    } finally {
      setBusy(false);
    }
  };

  const pad = size === 'xs' ? '3px 8px' : '5px 11px';
  const fs  = size === 'xs' ? 12 : 13;
  const label = mutual ? 'Amis' : iFollow ? 'Suivi(e)' : 'Suivre';
  const filled = iFollow;
  const style: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 5, border: `1px solid ${th.accent}`,
    background: filled ? th.accent : 'transparent', color: filled ? th.onAccent : th.accent,
    borderRadius: 999, padding: pad, fontFamily: th.fontUI, fontSize: fs, fontWeight: 600, cursor: 'pointer',
    opacity: busy ? 0.7 : 1, whiteSpace: 'nowrap',
  };
  return (
    <button type="button" onClick={toggle} disabled={busy} style={style} aria-pressed={iFollow}>
      <Icon name={mutual ? 'users' : iFollow ? 'check' : 'plus'} size={fs} color={filled ? th.onAccent : th.accent} />
      {label}
    </button>
  );
}
```

> Vérifier que les icônes `users`, `check`, `plus` existent dans `components/ui/Icon.tsx`. Sinon, ajouter `users` (Task 13 Step 0) et utiliser `check`/`plus` existants — au pire remplacer par un libellé seul si une icône manque.

- [ ] **Step 4: Lancer → succès**

Run: `cd frontend && npx jest FollowButton --silent`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/social/FollowButton.tsx frontend/__tests__/FollowButton.test.tsx
git commit -m "feat(amis): FollowButton (toggle Suivre/Suivi/Amis, optimiste)"
```

---

## Task 10 : Composant `FriendsQuickRow` (rangée d'ajout rapide)

**Files:**
- Create: `frontend/components/social/FriendsQuickRow.tsx`
- Test: `frontend/__tests__/FriendsQuickRow.test.tsx`

- [ ] **Step 1: Écrire le test qui échoue**

`frontend/__tests__/FriendsQuickRow.test.tsx` :

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FriendsQuickRow } from '@/components/social/FriendsQuickRow';

jest.mock('@/lib/ThemeProvider', () => ({ useTheme: () => ({ th: { accent: '#06c', onAccent: '#fff', surface: '#fff', surface2: '#eee', line: '#ccc', text: '#111', textMute: '#666', fontUI: 'sans-serif' } }) }));
jest.mock('@/lib/useLevelSystem', () => ({ useLevelSystemEnabled: () => true }));
const listClubFriends = jest.fn();
jest.mock('@/lib/api', () => ({ assetUrl: (p: string | null) => p, api: { listClubFriends: (...a: unknown[]) => listClubFriends(...a) } }));

describe('FriendsQuickRow', () => {
  beforeEach(() => { listClubFriends.mockReset(); });

  it('liste les amis du club et déclenche onPick au clic', async () => {
    listClubFriends.mockResolvedValue([{ id: 'u2', firstName: 'Léa', lastName: 'M', avatarUrl: null, level: null, mutual: true }]);
    const onPick = jest.fn();
    render(<FriendsQuickRow slug="demo" token="t" excludeIds={[]} onPick={onPick} />);
    const chip = await screen.findByRole('button', { name: /léa/i });
    fireEvent.click(chip);
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'u2' }));
  });

  it('masque les amis déjà ajoutés (excludeIds) et ne rend rien si vide', async () => {
    listClubFriends.mockResolvedValue([{ id: 'u2', firstName: 'Léa', lastName: 'M', avatarUrl: null, level: null, mutual: true }]);
    const { container } = render(<FriendsQuickRow slug="demo" token="t" excludeIds={['u2']} onPick={jest.fn()} />);
    await waitFor(() => expect(listClubFriends).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement(); // tous filtrés → rien
  });
});
```

- [ ] **Step 2: Lancer → échec attendu**

Run: `cd frontend && npx jest FriendsQuickRow --silent`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter `FriendsQuickRow`**

`frontend/components/social/FriendsQuickRow.tsx` :

```typescript
'use client';
import { useEffect, useState } from 'react';
import { api, Friend } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Avatar } from '@/components/ui/Avatar';
import { LevelChip } from '@/components/player/LevelChip';
import { colorForSeed } from '@/lib/playerColors';

// Rangée horizontale « Mes amis » : ajout en un tap des amis membres de ce club.
// Filtre par `query` (optionnel) et masque `excludeIds` (déjà ajoutés). Rien si liste vide.
export function FriendsQuickRow({ slug, token, excludeIds, query, onPick }: {
  slug: string;
  token: string;
  excludeIds: string[];
  query?: string;
  onPick: (friend: Friend) => void;
}) {
  const { th } = useTheme();
  const [friends, setFriends] = useState<Friend[]>([]);

  useEffect(() => {
    let alive = true;
    api.listClubFriends(slug, token).then((fs) => { if (alive) setFriends(fs); }).catch(() => {});
    return () => { alive = false; };
  }, [slug, token]);

  const q = (query ?? '').trim().toLowerCase();
  const visible = friends.filter((f) =>
    !excludeIds.includes(f.id) &&
    (!q || `${f.firstName} ${f.lastName}`.toLowerCase().includes(q)));

  if (visible.length === 0) return null;

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, color: th.textMute, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>Mes amis</div>
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
        {visible.map((f) => (
          <button key={f.id} type="button" onClick={() => onPick(f)}
            style={{ display: 'flex', alignItems: 'center', gap: 7, border: `1px solid ${th.line}`, background: th.surface2, borderRadius: 999, padding: '4px 11px 4px 4px', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
            <Avatar firstName={f.firstName} lastName={f.lastName} avatarUrl={f.avatarUrl} size={26} color={colorForSeed(f.id)} />
            <span style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.text, fontWeight: 600 }}>{f.firstName}</span>
            <LevelChip level={f.level} size="xs" />
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Lancer → succès**

Run: `cd frontend && npx jest FriendsQuickRow --silent`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/social/FriendsQuickRow.tsx frontend/__tests__/FriendsQuickRow.test.tsx
git commit -m "feat(amis): FriendsQuickRow (rangée d'ajout rapide des amis du club)"
```

---

## Task 11 : Intégrer dans `PartnerSearch` (couvre BookingModal + open-match-add + tournois)

**Files:**
- Modify: `frontend/components/tournament/PartnerSearch.tsx`
- Test: `frontend/__tests__/PartnerSearch.friends.test.tsx`

- [ ] **Step 1: Écrire le test qui échoue**

`frontend/__tests__/PartnerSearch.friends.test.tsx` :

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { PartnerSearch } from '@/components/tournament/PartnerSearch';

jest.mock('@/lib/ThemeProvider', () => ({ useTheme: () => ({ th: { accent: '#06c', onAccent: '#fff', surface: '#fff', surface2: '#eee', line: '#ccc', text: '#111', textMute: '#666', textFaint:'#999', fontUI: 'sans-serif' } }) }));
jest.mock('@/lib/useLevelSystem', () => ({ useLevelSystemEnabled: () => true }));
const listClubFriends = jest.fn();
const searchClubMembers = jest.fn();
jest.mock('@/lib/api', () => ({ assetUrl: (p: string | null) => p, api: { listClubFriends: (...a: unknown[]) => listClubFriends(...a), searchClubMembers: (...a: unknown[]) => searchClubMembers(...a) } }));

describe('PartnerSearch — rangée Mes amis', () => {
  beforeEach(() => {
    listClubFriends.mockReset().mockResolvedValue([{ id: 'u2', firstName: 'Léa', lastName: 'M', avatarUrl: null, level: null, mutual: true }]);
    searchClubMembers.mockReset().mockResolvedValue([]);
  });

  it('au focus, propose mes amis et les sélectionne au clic', async () => {
    const onSelect = jest.fn();
    render(<PartnerSearch slug="demo" token="t" selected={null} onSelect={onSelect} onClear={jest.fn()} />);
    fireEvent.focus(screen.getByPlaceholderText(/tapez un nom/i));
    fireEvent.click(await screen.findByRole('button', { name: /léa/i }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'u2' }));
  });
});
```

- [ ] **Step 2: Lancer → échec attendu**

Run: `cd frontend && npx jest PartnerSearch.friends --silent`
Expected: FAIL — pas de rangée amis.

- [ ] **Step 3: Intégrer `FriendsQuickRow` dans le dropdown**

Dans `PartnerSearch.tsx`, ajouter l'import :

```typescript
import { FriendsQuickRow } from '@/components/social/FriendsQuickRow';
```

Dans le bloc `{open && ( <div …dropdown… > … )}`, insérer la rangée amis **avant** la liste `visible` :

```typescript
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30, marginTop: 4, maxHeight: 320, overflowY: 'auto', background: th.surface, borderRadius: 11, boxShadow: `0 8px 24px rgba(0,0,0,0.25), inset 0 0 0 1px ${th.line}`, padding: 8 }}>
          <FriendsQuickRow slug={slug} token={token} excludeIds={excludeIds ?? []} query={q}
            onPick={(f) => { onSelect(f); setQ(''); if (!keepOpenOnSelect) setOpen(false); }} />
          {visible.length === 0
            ? <div style={{ padding: '10px 5px', fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute }}>Aucun membre trouvé.</div>
            : visible.map((m) => (
                <button key={m.id} onMouseDown={(e) => { e.preventDefault(); onSelect(m); setQ(''); if (!keepOpenOnSelect) setOpen(false); }} style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left', border: 'none', background: 'transparent', cursor: 'pointer', padding: '10px 5px', fontFamily: th.fontUI, fontSize: 14, color: th.text }}>
                  {m.firstName} {m.lastName}
                  <LevelChip level={m.level} size="xs" />
                </button>
              ))}
        </div>
      )}
```

> `FriendsQuickRow` utilise `onClick` (pas `onMouseDown`) ; comme l'input a un `onBlur` retardé de 150 ms, le clic d'un chip passe avant la fermeture. Conserver l'`onMouseDown`+`preventDefault` des lignes de résultats. `q`, `onSelect`, `keepOpenOnSelect`, `excludeIds` sont déjà dans le scope du composant.

- [ ] **Step 4: Lancer → succès + non-régression**

Run: `cd frontend && npx jest PartnerSearch --silent`
Expected: PASS (nouveau test + éventuels tests existants de PartnerSearch).

- [ ] **Step 5: Vérifier que BookingModal/OpenMatchCard compilent (consommateurs)**

Run: `cd frontend && npx tsc --noEmit`
Expected: 0 erreur — la signature publique de `PartnerSearch` est inchangée (props identiques), seuls les consommateurs héritent de la rangée amis gratuitement.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/tournament/PartnerSearch.tsx frontend/__tests__/PartnerSearch.friends.test.tsx
git commit -m "feat(amis): rangée « Mes amis » dans PartnerSearch (booking + open-match + tournois)"
```

---

## Task 12 : Preuve sociale sur les parties ouvertes (anneau ami + ligne « X et N amis »)

**Files:**
- Modify: `frontend/components/openmatch/OpenMatches.tsx` (charger `listFollowing`, dériver le Set, le passer)
- Modify: `frontend/components/openmatch/OpenMatchCard.tsx` (prop `friendIds`, ligne de preuve sociale, anneau)
- Modify: `frontend/__tests__/OpenMatches.test.tsx` (ajouter `listFollowing` au mock `@/lib/api`)
- Test: `frontend/__tests__/OpenMatchCard.friends.test.tsx`

- [ ] **Step 1: Mettre à jour le mock `@/lib/api` d'`OpenMatches.test.tsx`**

Ajouter dans l'objet `api: { … }` du `jest.mock('../lib/api', …)` :

```typescript
    listFollowing: jest.fn().mockResolvedValue([]),
```

(Sinon l'appel ajouté au Step 3 lèverait `api.listFollowing is not a function` dans la suite qui monte le vrai `ClubNav`.)

- [ ] **Step 2: Écrire le test de carte qui échoue**

`frontend/__tests__/OpenMatchCard.friends.test.tsx` :

```typescript
import { render, screen } from '@testing-library/react';
import { OpenMatchCard } from '@/components/openmatch/OpenMatchCard';

jest.mock('@/lib/ThemeProvider', () => ({ useTheme: () => ({ th: { accent: '#06c', onAccent:'#fff', surface:'#fff', surface2:'#eee', line:'#ccc', text:'#111', textMute:'#666', fontUI:'sans-serif' } }) }));
jest.mock('@/lib/api', () => ({ assetUrl: (p: string | null) => p }));

const baseMatch: any = {
  id: 'm1', resourceName: 'Court 1', startTime: new Date(Date.now()+3600000).toISOString(), endTime: new Date(Date.now()+7200000).toISOString(),
  maxPlayers: 4, spotsLeft: 2, full: false, viewerIsParticipant: false, viewerIsOrganizer: false,
  players: [
    { userId: 'u2', firstName: 'Léa', lastName: 'M', avatarUrl: null, isOrganizer: true, level: null },
    { userId: 'u9', firstName: 'Zoé', lastName: 'X', avatarUrl: null, isOrganizer: false, level: null },
  ],
  interestedCount: 0, viewerIsInterested: false, interested: [], lastMessageAt: null, unreadCount: 0,
};
const noop = () => {};
const props: any = { timezone: 'Europe/Paris', slug: 'demo', token: 't', busy: false, addingOpen: false,
  onJoin: noop, onLeave: noop, onRemovePlayer: noop, onAddPlayer: noop, onToggleAdd: noop, onCancelAdd: noop,
  onRecordResult: noop, canRecordResult: false, onToggleInterest: noop, onOpenChat: noop, onAuthPrompt: noop };

describe('OpenMatchCard — preuve sociale amis', () => {
  it('affiche « X de vos amis » quand des amis jouent', () => {
    render(<OpenMatchCard match={baseMatch} friendIds={new Set(['u2'])} {...props} />);
    expect(screen.getByText(/ami/i)).toBeInTheDocument();
  });
  it('n\'affiche rien quand aucun ami ne joue', () => {
    render(<OpenMatchCard match={baseMatch} friendIds={new Set()} {...props} />);
    expect(screen.queryByText(/de vos amis/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: `OpenMatches` charge le Set d'amis et le passe**

Dans `OpenMatches.tsx`, ajouter un état + un effet de chargement (près de `viewerUserId`) :

```typescript
const [friendIds, setFriendIds] = useState<Set<string>>(new Set());

useEffect(() => {
  if (!token) return;
  api.listFollowing(token).then((fs) => setFriendIds(new Set(fs.map((f) => f.id)))).catch(() => {});
}, [token]);
```

Puis passer la prop à chaque `<OpenMatchCard … />` rendu dans la liste :

```typescript
<OpenMatchCard match={m} friendIds={friendIds} /* …props existantes inchangées… */ />
```

- [ ] **Step 4: `OpenMatchCard` — prop + ligne + anneau**

Dans `OpenMatchCardProps`, ajouter :

```typescript
  friendIds?: Set<string>;
```

Calculer en tête de composant (après la destructuration des props) :

```typescript
  const friendsHere = match.players.filter((p) => !p.isOrganizer ? friendIds?.has(p.userId) : friendIds?.has(p.userId));
  const friendCount = match.players.filter((p) => friendIds?.has(p.userId)).length;
```

> Simplifier : `const friendCount = match.players.filter((p) => friendIds?.has(p.userId)).length;` suffit (retirer `friendsHere` si inutilisé).

Ajouter la ligne de preuve sociale juste au-dessus de `<PlayerPills … />` :

```typescript
{friendCount > 0 && (
  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: th.fontUI, fontSize: 12.5, color: th.accent, fontWeight: 600, marginBottom: 6 }}>
    <Icon name="users" size={14} color={th.accent} />
    {friendCount === 1 ? '1 de vos amis joue ici' : `${friendCount} de vos amis jouent ici`}
  </div>
)}
```

Passer l'info d'anneau à `PlayerPills` (prop additive `friendIds`) :

```typescript
<PlayerPills players={match.players} spotsLeft={match.spotsLeft} friendIds={friendIds} /* …reste inchangé… */ />
```

> Vérifier que `Icon` et `th` sont déjà importés/disponibles dans `OpenMatchCard` (oui : il utilise déjà `th` et des icônes). Si `Icon` n'est pas importé, ajouter `import { Icon } from '@/components/ui/Icon';`.

- [ ] **Step 5: `PlayerPills` — anneau ami (additif, sans régression)**

Dans le composant `PlayerPills` (même fichier `OpenMatchCard.tsx` ou son propre fichier — localiser via la définition), ajouter la prop optionnelle `friendIds?: Set<string>` et, sur l'avatar d'un joueur suivi, un anneau :

```typescript
// autour de l'Avatar d'un joueur :
<span style={{ borderRadius: '50%', padding: friendIds?.has(p.userId) ? 2 : 0, background: friendIds?.has(p.userId) ? th.accent : 'transparent', display: 'inline-flex' }}>
  <Avatar firstName={p.firstName} lastName={p.lastName} avatarUrl={p.avatarUrl} size={28} color={colorForSeed(p.userId)} />
</span>
```

> Adapter au markup réel de `PlayerPills`. Si `PlayerPills` est dans un fichier séparé, modifier ce fichier et propager la prop. L'anneau est purement cosmétique ; absence de `friendIds` ⇒ comportement inchangé.

- [ ] **Step 6: Lancer → succès**

Run: `cd frontend && npx jest OpenMatchCard.friends OpenMatches --silent`
Expected: PASS (nouveaux tests + suite OpenMatches non régressée).

- [ ] **Step 7: Commit**

```bash
git add frontend/components/openmatch/OpenMatchCard.tsx frontend/components/openmatch/OpenMatches.tsx frontend/__tests__/OpenMatchCard.friends.test.tsx frontend/__tests__/OpenMatches.test.tsx
git commit -m "feat(amis): preuve sociale sur les parties ouvertes (anneau + « X de vos amis »)"
```

---

## Task 13 : Hub `/me/friends` + lien `ProfileMenu` + icône `users`

**Files:**
- Modify: `frontend/components/ui/Icon.tsx` (ajouter `users` si absent)
- Create: `frontend/app/me/friends/page.tsx`
- Create: `frontend/components/social/FriendsHub.tsx`
- Modify: `frontend/components/ProfileMenu.tsx` (ajouter le lien « Mes amis »)
- Modify: `frontend/lib/notifications.ts` (libellé catégorie `SOCIAL`)
- Test: `frontend/__tests__/FriendsHub.test.tsx`

- [ ] **Step 0: Ajouter l'icône `users` si absente**

Dans `frontend/components/ui/Icon.tsx`, si la clé `users` n'existe pas, ajouter un cas (deux silhouettes) au même format que les autres icônes du fichier :

```tsx
users: (
  <>
    <circle cx="9" cy="8" r="3" /><path d="M3 19c0-3 3-5 6-5s6 2 6 5" />
    <circle cx="17" cy="9" r="2.2" /><path d="M16 14c2.5 0 5 1.7 5 5" />
  </>
),
```

> Respecter le style exact (stroke/viewBox) du composant `Icon` existant ; adapter les attributs si le fichier utilise `fill` plutôt que `stroke`.

- [ ] **Step 1: Ajouter le libellé de catégorie `SOCIAL`**

Dans `frontend/lib/notifications.ts`, ajouter au tableau `CATEGORY_META` :

```typescript
  { key: 'SOCIAL', label: 'Amis & suivi', desc: 'Quand un joueur commence à vous suivre' },
```

- [ ] **Step 2: Écrire le test du hub qui échoue**

`frontend/__tests__/FriendsHub.test.tsx` :

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FriendsHub } from '@/components/social/FriendsHub';

jest.mock('@/lib/ThemeProvider', () => ({ useTheme: () => ({ th: { accent: '#06c', onAccent:'#fff', surface:'#fff', surface2:'#eee', line:'#ccc', text:'#111', textMute:'#666', fontUI:'sans-serif' } }) }));
jest.mock('@/lib/useLevelSystem', () => ({ useLevelSystemEnabled: () => true }));
const listFollowing = jest.fn();
const listFollowers = jest.fn();
jest.mock('@/lib/api', () => ({ assetUrl: (p: string | null) => p, api: {
  listFollowing: (...a: unknown[]) => listFollowing(...a),
  listFollowers: (...a: unknown[]) => listFollowers(...a),
  followUser: jest.fn().mockResolvedValue({ iFollow: true, followsMe: true, mutual: true }),
  unfollowUser: jest.fn().mockResolvedValue({ iFollow: false, followsMe: false, mutual: false }),
} }));

describe('FriendsHub', () => {
  beforeEach(() => {
    listFollowing.mockReset().mockResolvedValue([{ id: 'u2', firstName: 'Léa', lastName: 'M', avatarUrl: null, mutual: true }]);
    listFollowers.mockReset().mockResolvedValue([{ id: 'u3', firstName: 'Tom', lastName: 'B', avatarUrl: null, mutual: false }]);
  });

  it('charge mes amis (mutuels) par défaut', async () => {
    render(<FriendsHub slug="demo" token="t" initialTab="amis" />);
    expect(await screen.findByText(/Léa/)).toBeInTheDocument();
  });

  it('l\'onglet « Me suivent » liste les followers', async () => {
    render(<FriendsHub slug="demo" token="t" initialTab="followers" />);
    await waitFor(() => expect(listFollowers).toHaveBeenCalled());
    expect(await screen.findByText(/Tom/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Lancer → échec attendu**

Run: `cd frontend && npx jest FriendsHub --silent`
Expected: FAIL — module introuvable.

- [ ] **Step 4: Implémenter `FriendsHub`**

`frontend/components/social/FriendsHub.tsx` :

```typescript
'use client';
import { useEffect, useState } from 'react';
import { api, Friend } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Avatar } from '@/components/ui/Avatar';
import { FollowButton } from '@/components/social/FollowButton';
import { colorForSeed } from '@/lib/playerColors';

type Tab = 'amis' | 'following' | 'followers';

// Hub social du joueur : amis (mutuels), je suis, me suivent. Suivi club-scoped via `slug`.
export function FriendsHub({ slug, token, initialTab = 'amis' }: { slug: string; token: string; initialTab?: Tab }) {
  const { th } = useTheme();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [following, setFollowing] = useState<Friend[]>([]);
  const [followers, setFollowers] = useState<Friend[]>([]);
  const [q, setQ] = useState('');

  useEffect(() => { api.listFollowing(token).then(setFollowing).catch(() => {}); }, [token]);
  useEffect(() => { api.listFollowers(token).then(setFollowers).catch(() => {}); }, [token]);

  const amis = following.filter((f) => f.mutual);
  const source = tab === 'amis' ? amis : tab === 'following' ? following : followers;
  const ql = q.trim().toLowerCase();
  const list = ql ? source.filter((f) => `${f.firstName} ${f.lastName}`.toLowerCase().includes(ql)) : source;

  const tabs: { key: Tab; label: string; n: number }[] = [
    { key: 'amis',      label: 'Amis',       n: amis.length },
    { key: 'following', label: 'Je suis',    n: following.length },
    { key: 'followers', label: 'Me suivent', n: followers.length },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        {tabs.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            style={{ flex: 1, border: `1px solid ${tab === t.key ? th.accent : th.line}`, background: tab === t.key ? th.accent : 'transparent', color: tab === t.key ? th.onAccent : th.text, borderRadius: 10, padding: '8px 6px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}>
            {t.label} <span style={{ opacity: 0.7 }}>{t.n}</span>
          </button>
        ))}
      </div>

      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un joueur…"
        style={{ border: `1px solid ${th.line}`, background: th.surface2, color: th.text, borderRadius: 10, padding: '10px 12px', fontFamily: th.fontUI, fontSize: 14 }} />

      {list.length === 0
        ? <div style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, padding: '16px 4px' }}>
            {tab === 'followers' ? 'Personne ne vous suit encore.' : tab === 'amis' ? 'Aucun ami mutuel pour l\'instant.' : 'Vous ne suivez personne pour l\'instant.'}
          </div>
        : list.map((f) => (
            <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px', borderBottom: `1px solid ${th.line}` }}>
              <Avatar firstName={f.firstName} lastName={f.lastName} avatarUrl={f.avatarUrl} size={36} color={colorForSeed(f.id)} />
              <span style={{ flex: 1, fontFamily: th.fontUI, fontSize: 14.5, color: th.text, fontWeight: 600 }}>{f.firstName} {f.lastName}</span>
              <FollowButton slug={slug} userId={f.id} token={token}
                initial={{ iFollow: tab !== 'followers' || f.mutual, mutual: f.mutual }} />
            </div>
          ))}
    </div>
  );
}
```

> Sur l'onglet « Me suivent », `iFollow` initial = `f.mutual` (je le suis déjà ssi mutuel) → le bouton montre « Suivre » pour un follower que je ne suis pas encore (follow-back en un clic). Sur les onglets « Amis »/« Je suis », `iFollow` initial = true.

- [ ] **Step 5: Créer la page `/me/friends`**

`frontend/app/me/friends/page.tsx` — calquer le shell de `frontend/app/me/profile/page.tsx` (header `ClubNav`, garde d'auth, lecture du `slug` via `useClub`). Page client minimale :

```typescript
'use client';
import { useSearchParams } from 'next/navigation';
import { useClub } from '@/lib/ClubProvider';
import { useAuth } from '@/lib/useAuth';
import { FriendsHub } from '@/components/social/FriendsHub';
// + imports du shell (Screen, ClubNav, etc.) repris de /me/profile

export default function FriendsPage() {
  const { slug, club } = useClub();
  const { token, ready } = useAuth();
  const tabParam = useSearchParams().get('tab');
  const initialTab = tabParam === 'followers' ? 'followers' : tabParam === 'following' ? 'following' : 'amis';
  if (!ready) return null;
  if (!token || !slug) return null; // hub disponible sur un hôte club
  return (
    // … shell identique à /me/profile (ClubNav + conteneur) …
    <FriendsHub slug={slug} token={token} initialTab={initialTab} />
  );
}
```

> Reprendre fidèlement la structure de page de `/me/profile/page.tsx` (mêmes wrappers `Screen`/`ClubNav`/titres) pour la cohérence visuelle ; n'injecter que `<FriendsHub …/>` dans le corps. Titre de page : « Mes amis ».

- [ ] **Step 6: Lien « Mes amis » dans `ProfileMenu`**

Dans `ProfileMenu.tsx`, section des liens, ajouter (après « Mon profil », avant « Mes matchs ») — **sans nouvel appel API** (pas de compteur, pour ne pas casser les mocks des suites montant le vrai `ClubNav`) :

```typescript
{slug && <MenuItem th={th} icon="users" label="Mes amis" onClick={() => go('/me/friends')} />}
```

> `slug` est déjà déstructuré de `useClub()` dans `ProfileMenu`. Le lien n'apparaît que sur un hôte club (le suivi y est défini).

- [ ] **Step 7: Lancer → succès**

Run: `cd frontend && npx jest FriendsHub --silent`
Expected: PASS (2 tests).

- [ ] **Step 8: Vérifier TS + suites impactées par ProfileMenu**

Run: `cd frontend && npx tsc --noEmit && npx jest ProfileMenu OpenMatches --silent`
Expected: 0 erreur TS ; suites vertes (ProfileMenu n'ajoute aucun appel API ; `users` est une icône valide).

- [ ] **Step 9: Commit**

```bash
git add frontend/app/me/friends/ frontend/components/social/FriendsHub.tsx frontend/components/ProfileMenu.tsx frontend/components/ui/Icon.tsx frontend/lib/notifications.ts frontend/__tests__/FriendsHub.test.tsx
git commit -m "feat(amis): hub /me/friends + lien ProfileMenu + catégorie de notif SOCIAL"
```

---

## Task 14 : Vérification finale (revue + suites complètes + types)

**Files:** aucun (vérification)

- [ ] **Step 1: Suites backend ciblées + TS**

Run: `cd backend && npx jest follow.service notifications.follow follows.routes club.service --silent && npx tsc --noEmit`
Expected: tout vert, 0 erreur TS.

- [ ] **Step 2: Suites frontend ciblées + TS**

Run: `cd frontend && npx jest FollowButton FriendsQuickRow PartnerSearch FriendsHub OpenMatchCard OpenMatches --silent && npx tsc --noEmit`
Expected: tout vert, 0 erreur TS.

> Si la suite complète `npx jest` (frontend) montre ~6 échecs `BookingModal`, c'est le flake d'isolation pré-existant connu (passe en isolation) — ne pas le confondre avec une régression. Vérifier `BookingModal` en isolation : `npx jest BookingModal --silent`.

- [ ] **Step 3: Smoke manuel (optionnel mais recommandé)**

Démarrer back + front, sur un hôte club connecté :
1. Aller dans une réservation multi-joueurs (BookingModal) → la rangée « Mes amis » s'affiche si on suit des co-membres ; un tap ajoute le partenaire.
2. `/me/friends` → onglets Amis / Je suis / Me suivent ; follow-back en un clic.
3. Suivre un joueur → il reçoit la notif « X vous suit » (cloche).
4. Page Parties → « N de vos amis jouent ici » sur les parties où l'on suit un joueur.

- [ ] **Step 4: Mettre à jour `CLAUDE.md`**

Ajouter une section « Système d'amis (suivi de joueurs) (v1) ✅ implémenté » résumant : table `Follow` globale + action club-scoped, endpoint pivot `/api/clubs/:slug/friends`, rangée `FriendsQuickRow` dans `PartnerSearch` (couvre booking/open-match/tournois), `FollowButton`, hub `/me/friends`, notif `SOCIAL` « X vous suit », et les fichiers clés. Lier la spec et ce plan.

```bash
git add CLAUDE.md
git commit -m "docs(amis): documenter le système de suivi de joueurs dans CLAUDE.md"
```

---

## Auto-revue du plan (couverture spec)

- **Modèle `Follow` global, mutual dérivé** → Task 1 ✓
- **Action club-scoped co-membre + notif SOCIAL** → Tasks 2, 6, 7 ✓
- **Lectures globales following/followers** → Tasks 3, 7 ✓
- **Endpoint pivot `listClubFriends`** → Tasks 4, 7 ✓
- **Enrichissement `searchMembers` (iFollow/mutual)** → Task 5 ✓
- **Surface A (booking) + B-add + C (tournois) via PartnerSearch** → Task 11 ✓ (BookingModal/OpenMatchCard consomment PartnerSearch, signature inchangée)
- **Surface B preuve sociale (anneau + « X amis »)** → Task 12 ✓
- **Surface D FollowButton** → Task 9 (composant), réutilisé dans le hub Task 13 ✓
- **Hub `/me/friends` + ProfileMenu + libellé SOCIAL** → Task 13 ✓
- **Tests backend + frontend** → chaque task en TDD + Task 14 ✓
- **Pièges ClubNav/mocks, db push, retouches cosmétiques** → rappelés dans l'en-tête et Tasks 5/12 ✓

**Écart assumé vs spec :** la spec listait « PlayerPicker + BookingModal » pour la surface A. En réalité `BookingModal` consomme `PartnerSearch` (pas `PlayerPicker`, qui est l'outil **admin** prenant `Member[]`). On intègre donc la rangée amis dans `PartnerSearch` (couvre A+B-add+C d'un coup) et on **n'ajoute pas** la rangée à `PlayerPicker` (l'admin ajoute n'importe quel membre, pas « ses amis »). Décision DRY validée par la lecture du code.
