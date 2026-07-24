# Pseudo joueur (parties ouvertes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a player set a unique pseudo in their profile, shown instead of first/last name in open-match surfaces (`/parties`, `OpenMatchCard`, `MatchTeams`, `/parties/[id]`, its chat) when set.

**Architecture:** One additive nullable+unique `User.pseudo` column, validated and uniqueness-checked in the existing `PATCH /api/me` handler. The two open-match services (`OpenMatchService`, `OpenMatchChatService`) expose `pseudo` as an additive DTO field alongside `firstName`/`lastName` (no shape break). Frontend components that already compute a "display name" for a player (`MatchTeams`, `OpenMatchCard`, `OpenMatchChatSheet`) prefer `pseudo` when present, unchanged otherwise. Editing happens in the existing `/me/profile` baseline/draft/`SaveBar` mechanism (`buildProfileBody`).

**Tech Stack:** Express + Prisma 7 (Postgres) backend, Next.js 16 + React frontend, Jest (`ts-jest`) on both sides.

Spec: `docs/superpowers/specs/2026-07-24-pseudo-joueur-design.md`

---

## Task 1: Migration — `User.pseudo`

**Files:**
- Create: `backend/prisma/migrations/20260724120000_add_user_pseudo/migration.sql`
- Modify: `backend/prisma/schema.prisma:527-528`

- [ ] **Step 1: Write the migration SQL**

Create `backend/prisma/migrations/20260724120000_add_user_pseudo/migration.sql`:

```sql
-- Pseudo optionnel, unique sur la plateforme (comparaison insensible à la casse faite en
-- appli, cf. PATCH /api/me) — affiché à la place du prénom/nom dans les parties ouvertes.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pseudo" VARCHAR(20);
CREATE UNIQUE INDEX IF NOT EXISTS "users_pseudo_key" ON "users"("pseudo");
```

- [ ] **Step 2: Apply it to the dev database**

Run: `cd backend && npx prisma db execute --file prisma/migrations/20260724120000_add_user_pseudo/migration.sql`
Expected: no error (silent success — `db execute` doesn't print output on success).

- [ ] **Step 3: Update `schema.prisma`**

In `backend/prisma/schema.prisma`, the `User` model currently reads (around line 527):

```prisma
  firstName             String    @map("first_name")
  lastName              String    @map("last_name")
  phone                 String?
```

Change it to:

```prisma
  firstName             String    @map("first_name")
  lastName              String    @map("last_name")
  /// Pseudo optionnel, unique sur la plateforme (insensible à la casse, vérifié en
  /// appli) — affiché à la place du prénom/nom dans les parties ouvertes quand renseigné.
  pseudo                String?   @unique @db.VarChar(20)
  phone                 String?
```

- [ ] **Step 4: Regenerate the Prisma client**

Run: `cd backend && npx prisma generate`
Expected: `✔ Generated Prisma Client` with no errors.

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260724120000_add_user_pseudo
git commit -m "feat(db): add User.pseudo (unique, additive)"
```

---

## Task 2: Backend — `PATCH /api/me` accepts, validates and enforces uniqueness of `pseudo`

**Files:**
- Modify: `backend/src/routes/me.ts:1-43,135-191`
- Test: `backend/src/routes/__tests__/me.routes.test.ts:38-42,149` (fixture + new `it`s inside `describe('PATCH /api/me')`)

- [ ] **Step 1: Write the failing tests**

In `backend/src/routes/__tests__/me.routes.test.ts`, add the `Prisma` import next to the existing `bcrypt` import (line 5):

```ts
import bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
```

Add `pseudo: null` to the `PROFILE` fixture (line 38-42):

```ts
const PROFILE = {
  id: 'u1', email: 'test@x.fr', firstName: 'Eric', lastName: 'Nougayrede', phone: null, sex: null,
  birthDate: null, avatarUrl: null, locale: 'fr', isSuperAdmin: false, showInLeaderboard: false,
  autoMatchProposals: false, acceptsFriendRequests: false, acceptsDirectMessages: false, pseudo: null,
};
```

Then, just before the closing `});` of `describe('PATCH /api/me', ...)` (line 149), add:

```ts
  it.each(['ab', 'x'.repeat(21), 'jo jo', 'joël', 'a!b'])('rejette un pseudo invalide « %s » (400)', async (pseudo) => {
    const res = await request(app).patch('/api/me').set('Authorization', `Bearer ${token()}`).send({ pseudo });
    expect(res.status).toBe(400);
  });

  it('rejette un pseudo non-string (400)', async () => {
    const res = await request(app).patch('/api/me').set('Authorization', `Bearer ${token()}`).send({ pseudo: 42 });
    expect(res.status).toBe(400);
  });

  it('enregistre un pseudo valide (trim)', async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.user.update.mockResolvedValue({ ...PROFILE, pseudo: 'SmashMaster' } as any);
    const res = await request(app).patch('/api/me').set('Authorization', `Bearer ${token()}`).send({ pseudo: ' SmashMaster ' });
    expect(res.status).toBe(200);
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { pseudo: { equals: 'SmashMaster', mode: 'insensitive' }, NOT: { id: 'u1' } },
    }));
    expect(prismaMock.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { pseudo: 'SmashMaster' } }));
  });

  it('efface le pseudo avec une chaîne vide (pas de vérif d’unicité)', async () => {
    prismaMock.user.update.mockResolvedValue(PROFILE as any);
    const res = await request(app).patch('/api/me').set('Authorization', `Bearer ${token()}`).send({ pseudo: '   ' });
    expect(res.status).toBe(200);
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { pseudo: null } }));
  });

  it('efface le pseudo avec null', async () => {
    prismaMock.user.update.mockResolvedValue(PROFILE as any);
    const res = await request(app).patch('/api/me').set('Authorization', `Bearer ${token()}`).send({ pseudo: null });
    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { pseudo: null } }));
  });

  it('rejette un pseudo déjà pris, insensible à la casse (409)', async () => {
    prismaMock.user.findFirst.mockResolvedValue({ id: 'other' } as any);
    const res = await request(app).patch('/api/me').set('Authorization', `Bearer ${token()}`).send({ pseudo: 'smashmaster' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Ce pseudo est déjà pris.');
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('filet anti-course : une contrainte unique violée à l’écriture renvoie 409', async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.user.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x', meta: { target: ['pseudo'] } }),
    );
    const res = await request(app).patch('/api/me').set('Authorization', `Bearer ${token()}`).send({ pseudo: 'SmashMaster' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Ce pseudo est déjà pris.');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx jest me.routes.test.ts -t "pseudo"`
Expected: FAIL — routes don't read/validate `pseudo` yet (400/409 assertions fail, or `res.status` is 200 with `pseudo` silently dropped).

- [ ] **Step 3: Implement**

In `backend/src/routes/me.ts`, add the `Prisma` import (top of file, after the `authMiddleware` import on line 6):

```ts
import { Prisma } from '@prisma/client';
```

Add `pseudo: true` to `PROFILE_SELECT` (line 37-43):

```ts
const PROFILE_SELECT = {
  id: true, email: true, firstName: true, lastName: true, pseudo: true, phone: true, sex: true,
  birthDate: true, avatarUrl: true, address: true, postalCode: true, city: true,
  locale: true, isSuperAdmin: true, showInLeaderboard: true,
  autoMatchProposals: true, acceptsFriendRequests: true, acceptsDirectMessages: true,
  preferredSport: { select: { id: true, key: true, name: true } },
} as const;
```

Replace the whole `router.patch('/', ...)` handler (lines 135-191) with:

```ts
router.patch('/', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { phone, sex, birthDate, locale, showInLeaderboard, autoMatchProposals, acceptsFriendRequests, acceptsDirectMessages, preferredSportId, address, postalCode, city, pseudo } = req.body;
    const data: { phone?: string | null; sex?: 'MALE' | 'FEMALE' | null; birthDate?: Date | null; locale?: string | null; showInLeaderboard?: boolean; autoMatchProposals?: boolean; acceptsFriendRequests?: boolean; acceptsDirectMessages?: boolean; preferredSportId?: string | null; address?: string | null; postalCode?: string | null; city?: string | null; pseudo?: string | null } = {};
    if (phone !== undefined) data.phone = typeof phone === 'string' && phone.trim() ? phone.trim() : null;
    if (address !== undefined) data.address = typeof address === 'string' && address.trim() ? address.trim() : null;
    if (postalCode !== undefined) data.postalCode = typeof postalCode === 'string' && postalCode.trim() ? postalCode.trim() : null;
    if (city !== undefined) data.city = typeof city === 'string' && city.trim() ? city.trim() : null;
    if (pseudo !== undefined) {
      if (pseudo === null) {
        data.pseudo = null;
      } else if (typeof pseudo !== 'string') {
        return void res.status(400).json({ error: 'pseudo invalide' });
      } else {
        const trimmed = pseudo.trim();
        if (!trimmed) {
          data.pseudo = null;
        } else if (!/^[A-Za-z0-9_-]{3,20}$/.test(trimmed)) {
          return void res.status(400).json({ error: 'Le pseudo doit contenir 3 à 20 caractères (lettres, chiffres, - ou _), sans espace ni accent.' });
        } else {
          const conflict = await prisma.user.findFirst({
            where: { pseudo: { equals: trimmed, mode: 'insensitive' }, NOT: { id: req.user!.id } },
            select: { id: true },
          });
          if (conflict) return void res.status(409).json({ error: 'Ce pseudo est déjà pris.' });
          data.pseudo = trimmed;
        }
      }
    }
    if (sex !== undefined) {
      if (sex !== null && sex !== 'MALE' && sex !== 'FEMALE') return void res.status(400).json({ error: 'sex invalide' });
      data.sex = sex;
    }
    if (birthDate !== undefined) {
      if (birthDate === null) data.birthDate = null;
      else {
        const parsed = typeof birthDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(birthDate) ? new Date(birthDate) : null;
        // new Date('2026-02-30') glisse en mars : on revérifie que l'ISO retombe sur la saisie.
        if (!parsed || isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== birthDate) {
          return void res.status(400).json({ error: 'birthDate invalide' });
        }
        data.birthDate = parsed;
      }
    }
    if (locale !== undefined) {
      if (locale !== null && !LOCALES.includes(locale)) return void res.status(400).json({ error: 'locale invalide' });
      data.locale = locale;
    }
    if (showInLeaderboard !== undefined) {
      if (typeof showInLeaderboard !== 'boolean') return void res.status(400).json({ error: 'showInLeaderboard invalide' });
      data.showInLeaderboard = showInLeaderboard;
    }
    if (autoMatchProposals !== undefined) {
      if (typeof autoMatchProposals !== 'boolean') return void res.status(400).json({ error: 'autoMatchProposals invalide' });
      data.autoMatchProposals = autoMatchProposals;
    }
    if (acceptsFriendRequests !== undefined) {
      if (typeof acceptsFriendRequests !== 'boolean') return void res.status(400).json({ error: 'acceptsFriendRequests invalide' });
      data.acceptsFriendRequests = acceptsFriendRequests;
    }
    if (acceptsDirectMessages !== undefined) {
      if (typeof acceptsDirectMessages !== 'boolean') return void res.status(400).json({ error: 'acceptsDirectMessages invalide' });
      data.acceptsDirectMessages = acceptsDirectMessages;
    }
    if (preferredSportId !== undefined) {
      if (preferredSportId === null) {
        data.preferredSportId = null;
      } else {
        if (typeof preferredSportId !== 'string') return void res.status(400).json({ error: 'preferredSportId invalide' });
        const sport = await prisma.sport.findUnique({ where: { id: preferredSportId }, select: { id: true, published: true } });
        if (!sport || !sport.published) return void res.status(400).json({ error: 'preferredSportId invalide' });
        data.preferredSportId = preferredSportId;
      }
    }
    const user = await prisma.user.update({ where: { id: req.user!.id }, data, select: PROFILE_SELECT });
    res.json(user);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return void res.status(409).json({ error: 'Ce pseudo est déjà pris.' });
    }
    next(err);
  }
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx jest me.routes.test.ts`
Expected: PASS — all tests in the file (existing + new) green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/me.ts backend/src/routes/__tests__/me.routes.test.ts
git commit -m "feat(profile): validate + enforce unique pseudo on PATCH /api/me"
```

---

## Task 3: Backend — `OpenMatchService` exposes `pseudo` per player

**Files:**
- Modify: `backend/src/services/openMatch.service.ts:14-22,106-111`
- Test: `backend/src/services/__tests__/openMatch.service.test.ts` (new `it`s in `describe('listOpenMatches', ...)` and `describe('getOpenMatch', ...)`)

- [ ] **Step 1: Write the failing tests**

In `backend/src/services/__tests__/openMatch.service.test.ts`, inside `describe('listOpenMatches', ...)` (after the `'expose gender (matchGender) dans le DTO'` test, i.e. after line 140), add:

```ts
    it('expose le pseudo par joueur quand renseigné', async () => {
      prismaMock.reservation.findMany.mockResolvedValue([
        {
          id: 'm1', startTime: future(48), endTime: future(49),
          resource: { id: 'court-1', name: 'Court 1', attributes: { format: 'double' }, clubSport: { sport: { key: 'padel', name: 'Padel' } } },
          participants: [
            { userId: 'org', isOrganizer: true, team: null, user: { firstName: 'Org', lastName: 'A', avatarUrl: null, pseudo: 'SmashMaster' } },
            { userId: 'viewer', isOrganizer: false, team: null, user: { firstName: 'V', lastName: 'B', avatarUrl: null, pseudo: null } },
          ], openMatchMessages: [], _count: { openMatchMessages: 0 },
        },
      ] as any);

      const [match] = await service.listOpenMatches('club-demo', 'viewer');

      const byId = Object.fromEntries(match.players.map((p: any) => [p.userId, p]));
      expect(byId.org.pseudo).toBe('SmashMaster');
      expect(byId.viewer.pseudo).toBeNull();
    });
```

Inside `describe('getOpenMatch', ...)` (after the `'renvoie la partie pour un viewer anonyme'` test, i.e. after line 963), add:

```ts
    it('expose aussi le pseudo (DTO partagé avec listOpenMatches)', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(row({
        participants: [{ userId: 'org', isOrganizer: true, team: null, user: { firstName: 'Org', lastName: 'A', avatarUrl: null, pseudo: 'SmashMaster' } }],
      }) as any);
      const out = await service.getOpenMatch('club-demo', 'm1', null);
      expect(out.players[0].pseudo).toBe('SmashMaster');
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx jest openMatch.service.test.ts -t "pseudo"`
Expected: FAIL — `player.pseudo` is `undefined` (field not selected/mapped yet).

- [ ] **Step 3: Implement**

In `backend/src/services/openMatch.service.ts`, update `MATCH_INCLUDE` (lines 14-22) — only this constant, `NATIONAL_INCLUDE` stays untouched (out of scope, `/decouvrir` vitrine):

```ts
const MATCH_INCLUDE = {
  resource: { select: { id: true, name: true, attributes: true, clubId: true, clubSport: { select: { sport: { select: { key: true, name: true } } } } } },
  participants: {
    orderBy: { joinedAt: 'asc' },
    select: { userId: true, isOrganizer: true, team: true, slot: true, user: { select: { firstName: true, lastName: true, avatarUrl: true, pseudo: true } } },
  },
  openMatchMessages: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
  _count: { select: { openMatchMessages: { where: { deletedAt: null } } } },
} satisfies Prisma.ReservationInclude;
```

Update the `players` map inside `toDTO` (lines 106-111):

```ts
    const players = teamed.map((p) => ({
      userId: p.userId, firstName: p.user.firstName, lastName: p.user.lastName, avatarUrl: p.user.avatarUrl, isOrganizer: p.isOrganizer,
      pseudo: p.user.pseudo,
      level: levels[`${p.userId}:${sportKey}`] ?? null,
      team: p.team,
      slot: p.slot,
    }));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx jest openMatch.service.test.ts`
Expected: PASS — full file green (no regression in the other ~40 tests in this file).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/openMatch.service.ts backend/src/services/__tests__/openMatch.service.test.ts
git commit -m "feat(open-matches): expose player pseudo in the match DTO"
```

---

## Task 4: Backend — `OpenMatchChatService` exposes the author's `pseudo`

**Files:**
- Modify: `backend/src/services/openMatchChat.service.ts:9-16,24-27,29-39,74-76,90-94,119-123,165-169,189-193`
- Test: `backend/src/services/__tests__/openMatchChat.service.test.ts` (new `it` in `describe('postMessage', ...)`)

- [ ] **Step 1: Write the failing test**

In `backend/src/services/__tests__/openMatchChat.service.test.ts`, inside `describe('postMessage', ...)` (after the `'crée le message, renvoie le DTO et diffuse en SSE'` test), add:

```ts
    it('expose le pseudo de l’auteur dans le DTO quand renseigné', async () => {
      primeAccessOk();

      const fakeRow = {
        id: 'msg-2',
        body: 'Salut !',
        createdAt: new Date('2026-06-28T10:00:00Z'),
        deletedAt: null,
        user: { id: 'org', firstName: 'Eric', lastName: 'N', avatarUrl: null, pseudo: 'SmashMaster' },
      };
      prismaMock.openMatchMessage.create.mockResolvedValue(fakeRow as any);
      const broadcastSpy = jest.spyOn(SSEService.getInstance(), 'broadcastMatch').mockImplementation(() => {});

      const dto = await service.postMessage('club-demo', 'resa-1', 'org', 'Salut !');

      expect(dto.author.pseudo).toBe('SmashMaster');
      broadcastSpy.mockRestore();
    });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx jest openMatchChat.service.test.ts -t "pseudo"`
Expected: FAIL — `dto.author.pseudo` is `undefined`.

- [ ] **Step 3: Implement**

In `backend/src/services/openMatchChat.service.ts`:

Update the `ChatMessageDTO` interface (lines 9-16):

```ts
export interface ChatMessageDTO {
  id: string;
  author: { userId: string; firstName: string; lastName: string; avatarUrl: string | null; pseudo: string | null };
  body: string;
  createdAt: string;
  deleted: boolean;
  edited: boolean;
}
```

Update the `MsgRow` type (lines 24-27):

```ts
type MsgRow = {
  id: string; body: string; createdAt: Date; editedAt?: Date | null; deletedAt: Date | null;
  user: { id: string; firstName: string; lastName: string; avatarUrl: string | null; pseudo: string | null };
};
```

Update `toDTO` (lines 29-39) to include `pseudo` in `author`:

```ts
function toDTO(m: MsgRow): ChatMessageDTO {
  const deleted = m.deletedAt != null;
  return {
    id: m.id,
    author: { userId: m.user.id, firstName: m.user.firstName, lastName: m.user.lastName, avatarUrl: m.user.avatarUrl, pseudo: m.user.pseudo },
    body: deleted ? '' : m.body,
    createdAt: m.createdAt.toISOString(),
    deleted,
    edited: !deleted && m.editedAt != null,
  };
}
```

Add `pseudo: true` to the `user: { select: {...} }` block in **all 5** occurrences (`listMessages` line 75, `postMessage` line 92, `editMessage` line 121, `deleteMessage`'s read at line 167 and its update at line 191). Each currently reads:

```ts
        user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
```

Change each to:

```ts
        user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, pseudo: true } },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx jest openMatchChat.service.test.ts`
Expected: PASS — full file green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/openMatchChat.service.ts backend/src/services/__tests__/openMatchChat.service.test.ts
git commit -m "feat(open-match-chat): expose author pseudo in chat message DTO"
```

---

## Task 5: Frontend — types (`lib/api.ts`)

**Files:**
- Modify: `frontend/lib/api.ts:775-776,1727-1736,1762-1769,2540-2560`

No dedicated test file — this task is pure type additions, verified by `tsc` at the end of Task 8, 9, 10 and by the final verification pass (Task 11). All fields are additive/optional so nothing can regress at runtime.

- [ ] **Step 1: Add `pseudo` to `MyProfile`**

In `frontend/lib/api.ts`, the `MyProfile` interface (around line 2540) currently starts:

```ts
export interface MyProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
```

Add `pseudo` right after `lastName`:

```ts
export interface MyProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  pseudo: string | null;
  phone: string | null;
```

- [ ] **Step 2: Add `pseudo` to `updateMyProfile`'s body type**

Around line 775:

```ts
  updateMyProfile: (body: { phone?: string | null; sex?: Sex | null; birthDate?: string | null; locale?: string | null; showInLeaderboard?: boolean; autoMatchProposals?: boolean; acceptsFriendRequests?: boolean; acceptsDirectMessages?: boolean; preferredSportId?: string | null }, token: string) =>
    request<MyProfile>('/api/me', { method: 'PATCH', body: JSON.stringify(body) }, token),
```

Add `pseudo?: string | null;` to the body type:

```ts
  updateMyProfile: (body: { phone?: string | null; pseudo?: string | null; sex?: Sex | null; birthDate?: string | null; locale?: string | null; showInLeaderboard?: boolean; autoMatchProposals?: boolean; acceptsFriendRequests?: boolean; acceptsDirectMessages?: boolean; preferredSportId?: string | null }, token: string) =>
    request<MyProfile>('/api/me', { method: 'PATCH', body: JSON.stringify(body) }, token),
```

- [ ] **Step 3: Add `pseudo` to `OpenMatchPlayer`**

Around line 1727:

```ts
export interface OpenMatchPlayer {
  userId: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  isOrganizer: boolean;
  level?: UserLevel | null;
  team?: 1 | 2 | null;
  slot?: number | null; // place au sein de l'équipe (0=G, 1=D), concrète en padel
}
```

Add `pseudo?: string | null;` after `lastName`:

```ts
export interface OpenMatchPlayer {
  userId: string;
  firstName: string;
  lastName: string;
  pseudo?: string | null;
  avatarUrl: string | null;
  isOrganizer: boolean;
  level?: UserLevel | null;
  team?: 1 | 2 | null;
  slot?: number | null; // place au sein de l'équipe (0=G, 1=D), concrète en padel
}
```

- [ ] **Step 4: Add `pseudo` to `OpenMatchMessage.author`**

Around line 1762:

```ts
export interface OpenMatchMessage {
  id: string;
  author: { userId: string; firstName: string; lastName: string; avatarUrl: string | null };
  body: string;
  createdAt: string;
  deleted: boolean;
  edited: boolean;
}
```

Change to:

```ts
export interface OpenMatchMessage {
  id: string;
  author: { userId: string; firstName: string; lastName: string; avatarUrl: string | null; pseudo?: string | null };
  body: string;
  createdAt: string;
  deleted: boolean;
  edited: boolean;
}
```

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(types): add pseudo to MyProfile/OpenMatchPlayer/OpenMatchMessage"
```

---

## Task 6: Frontend — `lib/meProfile.ts` carries `pseudo` through the draft/save mechanism

**Files:**
- Modify: `frontend/lib/meProfile.ts:22-64`
- Test: `frontend/__tests__/meProfile.test.ts:4-12,30-35`

- [ ] **Step 1: Write the failing tests**

In `frontend/__tests__/meProfile.test.ts`, add `pseudo: null,` to the `base` fixture (line 4-12):

```ts
const base: MyProfile = {
  id: 'u1', email: 'eric@palova.fr', firstName: 'Eric', lastName: 'Nougayrede', pseudo: null,
  phone: '0609032635', sex: 'MALE', birthDate: '1973-07-08T00:00:00.000Z',
  avatarUrl: null, locale: 'fr', isSuperAdmin: false,
  showInLeaderboard: false, autoMatchProposals: false,
  acceptsFriendRequests: true, acceptsDirectMessages: true,
  preferredSport: { id: 'sport-padel', key: 'padel', name: 'Padel' },
  address: null, postalCode: null, city: null,
};
```

Update the "13 champs" test (line 30-35) — it currently asserts 12 keys:

```ts
  it('buildProfileBody expose les 13 champs enregistrés', () => {
    expect(Object.keys(buildProfileBody(base)).sort()).toEqual([
      'acceptsDirectMessages', 'acceptsFriendRequests', 'address', 'autoMatchProposals',
      'birthDate', 'city', 'locale', 'phone', 'postalCode', 'preferredSportId', 'pseudo', 'sex', 'showInLeaderboard',
    ]);
  });
```

Add a new test right after the "trim le téléphone" test (after line 50):

```ts
  it('buildProfileBody trim le pseudo, vide → null', () => {
    expect(buildProfileBody({ ...base, pseudo: '  SmashMaster  ' }).pseudo).toBe('SmashMaster');
    expect(buildProfileBody({ ...base, pseudo: '   ' }).pseudo).toBeNull();
    expect(buildProfileBody({ ...base, pseudo: null }).pseudo).toBeNull();
  });
```

Add a line to the existing `isDirty` test (inside the `it('isDirty est faux à l’identique...')` block, after the `city` assertion):

```ts
    expect(isDirty(base, { ...base, pseudo: 'SmashMaster' })).toBe(true);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx jest --runTestsByPath __tests__/meProfile.test.ts`
Expected: FAIL — TS error (`pseudo` missing from `UpdateProfileBody`) or assertion failures (12 vs 13 keys, `pseudo` undefined).

- [ ] **Step 3: Implement**

In `frontend/lib/meProfile.ts`, add `pseudo` to `UpdateProfileBody` (line 22-35):

```ts
export interface UpdateProfileBody {
  phone: string | null;
  pseudo: string | null;
  sex: Sex | null;
  birthDate: string | null;
  preferredSportId: string | null;
  locale: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  showInLeaderboard: boolean;
  autoMatchProposals: boolean;
  acceptsFriendRequests: boolean;
  acceptsDirectMessages: boolean;
}
```

Add `pseudo` to `buildProfileBody` (line 49-64), right after `phone`:

```ts
export function buildProfileBody(p: MyProfile): UpdateProfileBody {
  return {
    phone: p.phone?.trim() || null,
    pseudo: p.pseudo?.trim() || null,
    sex: p.sex,
    birthDate: p.birthDate ? p.birthDate.slice(0, 10) : null,
    preferredSportId: p.preferredSport?.id ?? null,
    locale: p.locale ?? 'fr',
    address: p.address?.trim() || null,
    postalCode: p.postalCode?.trim() || null,
    city: p.city?.trim() || null,
    showInLeaderboard: p.showInLeaderboard,
    autoMatchProposals: p.autoMatchProposals,
    acceptsFriendRequests: p.acceptsFriendRequests,
    acceptsDirectMessages: p.acceptsDirectMessages,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx jest --runTestsByPath __tests__/meProfile.test.ts`
Expected: PASS — full file green.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/meProfile.ts frontend/__tests__/meProfile.test.ts
git commit -m "feat(profile): carry pseudo through buildProfileBody/isDirty"
```

---

## Task 7: Frontend — `lib/names.ts` gains `playerLabel`

**Files:**
- Modify: `frontend/lib/names.ts`
- Test: `frontend/__tests__/names.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `frontend/__tests__/names.test.ts` (after the closing `});` of the `shortNamesById` describe block):

```ts
import { playerLabel } from '@/lib/names';

describe('playerLabel', () => {
  it('renvoie le pseudo quand il est présent', () => {
    expect(playerLabel({ pseudo: 'SmashMaster', firstName: 'Marc', lastName: 'A' })).toBe('SmashMaster');
  });

  it('replie sur "Prénom Nom" sans pseudo', () => {
    expect(playerLabel({ pseudo: null, firstName: 'Marc', lastName: 'A' })).toBe('Marc A');
    expect(playerLabel({ firstName: 'Marc', lastName: 'A' })).toBe('Marc A');
  });
});
```

(Move the `import { shortNamesById } from '@/lib/names';` and this new import together at the top of the file — both import from the same module.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx jest --runTestsByPath __tests__/names.test.ts`
Expected: FAIL — `playerLabel` is not exported yet.

- [ ] **Step 3: Implement**

In `frontend/lib/names.ts`, add at the end of the file:

```ts

/** Étiquette d'un joueur pour un affichage ponctuel (en-tête de feuille, etc.) : le
 * pseudo s'il existe, sinon « Prénom Nom ». Sans la désambiguïsation par lot de
 * `shortNamesById` (usage à un seul joueur à la fois). */
export function playerLabel(p: { pseudo?: string | null; firstName: string; lastName: string }): string {
  return p.pseudo ?? `${p.firstName} ${p.lastName}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx jest --runTestsByPath __tests__/names.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/names.ts frontend/__tests__/names.test.ts
git commit -m "feat(names): add playerLabel helper (pseudo-aware)"
```

---

## Task 8: Frontend — `/me/profile` Identity tab gets a "Pseudo" card

**Files:**
- Modify: `frontend/components/profile/tabs/ProfileIdentity.tsx:22-71`
- Test: `frontend/__tests__/MeProfile.test.tsx:31-35` (fixture) + new `it`s

- [ ] **Step 1: Write the failing tests**

In `frontend/__tests__/MeProfile.test.tsx`, add `pseudo: null,` to the `profile` fixture (line 31-35):

```ts
const profile = {
  id: 'u1', email: 'eric@palova.fr', firstName: 'Eric', lastName: 'Nougayrede', pseudo: null, phone: '0609032635', sex: 'MALE',
  birthDate: '1973-07-08T00:00:00.000Z', avatarUrl: null, locale: 'fr', isSuperAdmin: false, showInLeaderboard: false,
  autoMatchProposals: false, acceptsFriendRequests: false, acceptsDirectMessages: true, preferredSport: null,
};
```

Add two tests inside `describe('Page Mon profil — onglets + SaveBar', ...)`, right after the `'éditer un champ révèle la barre...'` test (after line 125):

```ts
  it('onglet Identité : édite le pseudo et l’enregistre', async () => {
    wrap();
    const pseudo = await screen.findByLabelText('Pseudo');
    expect(pseudo).toHaveValue('');
    fireEvent.change(pseudo, { target: { value: 'SmashMaster' } });
    expect(screen.getByText('Modifications non enregistrées')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(api.updateMyProfile).toHaveBeenCalledWith(
      expect.objectContaining({ pseudo: 'SmashMaster' }), 'abc',
    ));
    expect(await screen.findByText('Enregistré ✓')).toBeInTheDocument();
  });

  it('onglet Identité : affiche le pseudo existant, préremplit le champ', async () => {
    api.getMyProfile.mockResolvedValue({ ...profile, pseudo: 'DejaLa' });
    wrap();
    expect(await screen.findByLabelText('Pseudo')).toHaveValue('DejaLa');
  });

  it('onglet Identité : une erreur serveur (pseudo déjà pris) s’affiche dans la barre', async () => {
    api.updateMyProfile.mockRejectedValue(new Error('Ce pseudo est déjà pris.'));
    wrap();
    fireEvent.change(await screen.findByLabelText('Pseudo'), { target: { value: 'SmashMaster' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ce pseudo est déjà pris.');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx jest --runTestsByPath __tests__/MeProfile.test.tsx -t "pseudo"`
Expected: FAIL — `screen.findByLabelText('Pseudo')` times out (field doesn't exist yet).

- [ ] **Step 3: Implement**

In `frontend/components/profile/tabs/ProfileIdentity.tsx`, add a new card as the very first element returned, before the `{sports.length > 0 && (...)}` block:

```tsx
export function ProfileIdentity({ profile, set, sports, licence, clubName, onLicence }: Props) {
  const { th, card } = useProfileStyles();
  const hint = { fontFamily: th.fontUI, fontSize: 12, color: th.textFaint };

  return (
    <>
      <section style={card} aria-label="Pseudo">
        <CardKicker>Pseudo</CardKicker>
        <ProfileInput label="Pseudo" value={profile.pseudo ?? ''} onChange={(v) => set('pseudo', v)} placeholder="SmashMaster" />
        <span style={hint}>Affiché à la place de votre prénom/nom dans les parties ouvertes, quand il est renseigné.</span>
      </section>

      {sports.length > 0 && (
        <section style={card} aria-label="Sport préféré">
```

(Everything from `{sports.length > 0 && (` to the end of the file is unchanged — only the new `<section>` above is inserted, and the opening `<>`/`return (` stay where they are.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx jest --runTestsByPath __tests__/MeProfile.test.tsx`
Expected: PASS — full file green (existing tests unaffected: `pseudo: null` renders an empty input, doesn't change any other `region`/label query).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/profile/tabs/ProfileIdentity.tsx frontend/__tests__/MeProfile.test.tsx
git commit -m "feat(profile): add Pseudo card to the Identity tab"
```

---

## Task 9: Frontend — `MatchTeams` prefers pseudo for the displayed name

**Files:**
- Modify: `frontend/components/match/MatchTeams.tsx:12-23,96-100,224-236,335`
- Test: `frontend/__tests__/MatchTeams.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `frontend/__tests__/MatchTeams.test.tsx`, inside the `describe('MatchTeams (mini-terrain)', ...)` block, right before the closing `});`:

```ts
  it('pseudo présent : remplace le nom dans la cellule, les aria-labels et la feuille d’actions', () => {
    const pl: MatchPlayerData[] = [
      { userId: 'a', firstName: 'Marc', lastName: 'A', pseudo: 'SmashMaster', isOrganizer: true, team: 1 },
      { userId: 'b', firstName: 'Paul', lastName: 'B', team: 1 },
    ];
    // onSetTeams fourni : sans lui, la cellule de l'organisateur (a) n'a aucune action
    // disponible (repAllowed/remAllowed sont faux pour l'organisateur) et ne serait pas
    // un bouton du tout — cf. le test existant « la feuille de l'organisateur n'a ni
    // Retirer ni Remplacer » qui passe déjà onSetTeams pour la même raison.
    wrap(<MatchTeams players={pl} capacity={4} editable onSetTeams={jest.fn()} onReplace={jest.fn()} onRemove={jest.fn()} />);
    expect(screen.getByText('SmashMaster')).toBeInTheDocument();
    expect(screen.queryByText('Marc A')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Modifier SmashMaster' }));
    expect(screen.getByRole('dialog', { name: 'Actions pour SmashMaster' })).toBeInTheDocument();
  });
```

(No separate "sans pseudo" regression test is needed: every one of the 13 pre-existing tests in this file already renders players without a `pseudo` field and asserts full names like `'Marc A'` — they double as the backward-compatibility check once `pseudo` becomes an optional field.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx jest --runTestsByPath __tests__/MatchTeams.test.tsx -t "pseudo"`
Expected: FAIL — cell shows "Marc A" (pseudo ignored), `MatchPlayerData` has no `pseudo` field.

- [ ] **Step 3: Implement**

In `frontend/components/match/MatchTeams.tsx`, add `pseudo` to `MatchPlayerData` (lines 12-23):

```ts
export interface MatchPlayerData {
  userId: string;
  firstName: string;
  lastName: string;
  /** Pseudo optionnel — priorité d'affichage sur prénom/nom (parties ouvertes). */
  pseudo?: string | null;
  avatarUrl?: string | null;
  isOrganizer?: boolean;
  participantId?: string;
  level?: UserLevel | null;
  team: 1 | 2;
  /** Place au sein de l'équipe (0=G, 1=D), persistée côté serveur — fait foi au rendu. */
  slot?: number | null;
}
```

Change the `displayName` helper (lines 96-100) so pseudo wins over the short/full name, keeping `fullName`/`title` untouched:

```ts
  const shortNames = narrow
    ? shortNamesById(players.map((p) => ({ id: p.userId, firstName: p.firstName, lastName: p.lastName })))
    : null;
  const fullName = (p: MatchPlayerData) => `${p.firstName} ${p.lastName}`;
  const displayName = (p: MatchPlayerData) => p.pseudo ?? shortNames?.[p.userId] ?? fullName(p);
```

In `renderPlayer` (around lines 224-236), replace the two `fullName(p)` usages in `aria-label`s with `displayName(p)` — `title={fullName(p)}` stays unchanged (hover tooltip keeps revealing the real name, out of scope):

```tsx
      if (!editable && onPlayerTap && p.userId !== viewerUserId) {
        return (
          <button type="button" data-player-slot={SLOT_LABELS[idx]} disabled={busy}
            aria-label={`Écrire à ${displayName(p)}`} title="Envoyer un message"
            onClick={() => onPlayerTap(p.userId)}
            style={{ ...cellStyle, cursor: busy ? 'default' : 'pointer', font: 'inherit' }}>
            {inner}
          </button>
        );
      }
      return <div data-player-slot={SLOT_LABELS[idx]} style={cellStyle}>{inner}</div>;
    }
    return (
      <button type="button" data-player-slot={SLOT_LABELS[idx]} disabled={busy}
        aria-label={`Modifier ${displayName(p)}`} onClick={() => setSelectedId(p.userId)}
        style={{ ...cellStyle, cursor: busy ? 'default' : 'pointer', font: 'inherit' }}>
        {inner}
      </button>
    );
```

In the `PlayerActionSheet` render (around line 335), pass `displayName(selected)` instead of `fullName(selected)`:

```tsx
        <PlayerActionSheet
          player={selected}
          playerName={displayName(selected)}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx jest --runTestsByPath __tests__/MatchTeams.test.tsx`
Expected: PASS — full file green (13 existing tests + 2 new).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/match/MatchTeams.tsx frontend/__tests__/MatchTeams.test.tsx
git commit -m "feat(match-teams): show pseudo instead of name when set"
```

---

## Task 10: Frontend — `OpenMatchCard` passes `pseudo` through and uses it in the replace-sheet header

**Files:**
- Modify: `frontend/components/openmatch/OpenMatchCard.tsx:13,132-137,199`
- Test: `frontend/__tests__/OpenMatchCard.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `frontend/__tests__/OpenMatchCard.test.tsx`, inside the `describe('OpenMatchCard', ...)` block, right before the closing `});`:

```ts
  it('affiche le pseudo d’un joueur dans le mini-terrain quand renseigné', () => {
    const match = makeMatch({
      players: [{ userId: 'u-org', firstName: 'Org', lastName: 'A', avatarUrl: null, isOrganizer: true, team: 1 as (1 | 2), pseudo: 'SmashMaster' }],
    });
    render(<ThemeProvider><OpenMatchCard {...makeProps(match)} /></ThemeProvider>);
    expect(screen.getByText('SmashMaster')).toBeInTheDocument();
    expect(screen.queryByText('Org A')).not.toBeInTheDocument();
  });

  it('feuille « Remplacer » : l’en-tête utilise le pseudo du joueur remplacé', () => {
    const match = makeMatch({
      viewerIsOrganizer: true, viewerIsParticipant: true, spotsLeft: 0, full: true,
      players: [
        { userId: 'u-org', firstName: 'Org', lastName: 'A', avatarUrl: null, isOrganizer: true, team: 1 as (1 | 2) },
        { userId: 'u-bob', firstName: 'Bob', lastName: 'B', avatarUrl: null, isOrganizer: false, team: 1 as (1 | 2), pseudo: 'SmashMaster' },
        { userId: 'u-cara', firstName: 'Cara', lastName: 'C', avatarUrl: null, isOrganizer: false, team: 2 as (1 | 2) },
        { userId: 'u-dan', firstName: 'Dan', lastName: 'D', avatarUrl: null, isOrganizer: false, team: 2 as (1 | 2) },
      ],
    });
    // addingOpen doit être vrai dès le départ : dans ce test isolé, rien ne relève le
    // prop en réponse à onToggleAdd (c'est le parent — OpenMatches — qui fait ça en vrai).
    render(<ThemeProvider><OpenMatchCard {...makeProps(match, { addingOpen: true })} /></ThemeProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Modifier SmashMaster' }));
    fireEvent.click(screen.getByRole('button', { name: /Remplacer par un autre joueur/ }));
    expect(screen.getByRole('dialog', { name: 'Remplacer SmashMaster' })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx jest --runTestsByPath __tests__/OpenMatchCard.test.tsx -t "pseudo"`
Expected: FAIL — the card shows "Org A"/no pseudo (not mapped into `MatchTeams` yet), and the replace sheet header reads "Remplacer Bob B".

- [ ] **Step 3: Implement**

In `frontend/components/openmatch/OpenMatchCard.tsx`, import `playerLabel` (line 13, alongside the existing `MatchTeams` import):

```ts
import { MatchTeams, MatchPlayerData } from '@/components/match/MatchTeams';
import { playerLabel } from '@/lib/names';
```

Add `pseudo: p.pseudo` to the `players` mapping passed to `MatchTeams` (lines 132-137):

```tsx
      <MatchTeams
        players={m.players.map((p) => ({
          userId: p.userId, firstName: p.firstName, lastName: p.lastName, pseudo: p.pseudo,
          avatarUrl: p.avatarUrl, isOrganizer: p.isOrganizer, level: p.level,
          team: (p.team ?? 1) as 1 | 2,
          slot: p.slot,
        }))}
```

Update `replaceName` (line 199) to use `playerLabel` instead of always concatenating first/last name:

```tsx
          replaceName={addMode.kind === 'replace' ? playerLabel(addMode.player) : undefined}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx jest --runTestsByPath __tests__/OpenMatchCard.test.tsx`
Expected: PASS — full file green.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/openmatch/OpenMatchCard.tsx frontend/__tests__/OpenMatchCard.test.tsx
git commit -m "feat(open-match-card): pass pseudo through to MatchTeams and the replace sheet"
```

---

## Task 11: Frontend — chat message header prefers the author's pseudo

**Files:**
- Modify: `frontend/components/openmatch/OpenMatchChatSheet.tsx:139`
- Test: `frontend/__tests__/OpenMatchChatSheet.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `frontend/__tests__/OpenMatchChatSheet.test.tsx`, at the end of the file:

```ts
it('affiche le pseudo de l’auteur dans l’en-tête du message quand renseigné', async () => {
  const { api } = require('@/lib/api');
  api.getChatMessages.mockResolvedValueOnce([
    { id: 'm1', author: { userId: 'u2', firstName: 'Bob', lastName: 'Y', avatarUrl: null, pseudo: 'SmashMaster' }, body: 'salut', createdAt: '2026-06-28T10:00:00Z', deleted: false },
  ]);
  renderSheet();
  expect(await screen.findByText(/SmashMaster ·/)).toBeInTheDocument();
  expect(screen.queryByText(/^Bob ·/)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx jest --runTestsByPath __tests__/OpenMatchChatSheet.test.tsx -t "pseudo"`
Expected: FAIL — header still shows "Bob ·".

- [ ] **Step 3: Implement**

In `frontend/components/openmatch/OpenMatchChatSheet.tsx`, change line 139:

```tsx
                    {m.author.pseudo ?? m.author.firstName} · {hhmm(m.createdAt, timezone)}{m.edited ? ' · modifié' : ''}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx jest --runTestsByPath __tests__/OpenMatchChatSheet.test.tsx`
Expected: PASS — full file green.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/openmatch/OpenMatchChatSheet.tsx frontend/__tests__/OpenMatchChatSheet.test.tsx
git commit -m "feat(open-match-chat): show author pseudo in the message header"
```

---

## Task 12: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Backend type-check**

Run: `cd backend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Backend full test suite**

Run: `cd backend && npx jest`
Expected: all suites PASS (pre-existing baseline unaffected — no new failures introduced by this feature).

- [ ] **Step 3: Frontend type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Frontend full test suite**

Run: `cd frontend && npx jest`
Expected: all suites PASS, other than the known pre-existing `BookingModal` full-suite isolation flake (see project memory `frontend-full-suite-bookingmodal-flake` — those tests pass in isolation; if any fail here, re-run just that file to confirm it's the known flake and not a regression from this feature).

- [ ] **Step 5: Manual smoke check (optional but recommended)**

With the dev stack running (`docker-compose up -d`, backend `npm run dev`, frontend `npm run dev`):
1. Log in as `test@palova.fr` / `password123`, go to `/me/profile`, set a pseudo (e.g. `SmashMaster`), save.
2. Open `/parties` on a club with an open padel match you're part of (or create one) — confirm the pseudo shows in the mini-terrain instead of your name.
3. Open the match's chat — confirm your messages show the pseudo in the header.
4. Try setting the same pseudo (different case) from a second account — confirm the 409 "Ce pseudo est déjà pris." surfaces in the profile's save bar.

- [ ] **Step 6: Final commit (if any cleanup was needed)**

Only if Steps 1-4 required fixes:

```bash
git add -A
git commit -m "fix: address issues found during final verification pass"
```
