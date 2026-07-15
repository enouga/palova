# Coach = facette du membre + bloc « Rôle » visible — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the standalone `/admin/coaches` page and manage the "coach" flag from the member panel (`/admin/members`), while relocating the staff-role control from a hidden popover to a visible "RÔLE" block.

**Architecture:** `Coach` stays the FK anchor for lesson series (`Restrict`), gains a nullable `userId`. A new pure helper `coachDisplay()` derives name/photo from the linked user when present, falling back to the legacy columns otherwise — wired into every place that already serializes `coach: { name, photoUrl }`. A new admin route `PATCH /members/:userId/coach` toggles the link. `MemberPanel` gets a "RÔLE" block (Segmented Membre/Staff/Admin, applied immediately, replacing the old popover) plus a "Coach" checkbox.

**Tech Stack:** Express + Prisma 7 (driver adapter, additive migrations via `prisma db execute` in dev), Next.js 16 frontend, Jest (`ts-jest` backend, RTL frontend).

**Spec:** `docs/superpowers/specs/2026-07-15-coach-facette-membre-design.md`

---

### Task 1: Migration `add_coach_user_link`

**Files:**
- Modify: `backend/prisma/schema.prisma` (Coach model + User back-relation)
- Create: `backend/prisma/migrations/20260715200000_add_coach_user_link/migration.sql`

- [ ] **Step 1: Edit the `Coach` model in `schema.prisma`**

Find the `Coach` model (currently ~line 1171):

```prisma
model Coach {
  id        String   @id @default(cuid())
  clubId    String   @map("club_id")
  name      String
  photoUrl  String?  @map("photo_url")
  bio       String?
  isActive  Boolean  @default(true) @map("is_active")
  sortOrder Int      @default(0) @map("sort_order")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  club   Club                @relation(fields: [clubId], references: [id], onDelete: Cascade)
  series ReservationSeries[]
  lessons Lesson[]

  @@index([clubId])
  @@map("coaches")
}
```

Replace it with:

```prisma
/// Coach/moniteur géré par le club (peut être lié à un compte membre via `userId` — nom/photo
/// dérivés du profil dans ce cas). Suppression = soft (isActive=false).
model Coach {
  id        String   @id @default(cuid())
  clubId    String   @map("club_id")
  userId    String?  @map("user_id")
  name      String
  photoUrl  String?  @map("photo_url")
  bio       String?
  isActive  Boolean  @default(true) @map("is_active")
  sortOrder Int      @default(0) @map("sort_order")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  club   Club                @relation(fields: [clubId], references: [id], onDelete: Cascade)
  user   User?               @relation(fields: [userId], references: [id], onDelete: SetNull)
  series ReservationSeries[]
  lessons Lesson[]

  @@unique([clubId, userId])
  @@index([clubId])
  @@map("coaches")
}
```

- [ ] **Step 2: Add the back-relation on `User`**

In the `User` model, find this line (~line 504):

```prisma
  lessonEnrollments LessonEnrollment[]
```

Add a new line right after it:

```prisma
  lessonEnrollments LessonEnrollment[]
  coachProfiles     Coach[]
```

- [ ] **Step 3: Write the migration SQL**

Create `backend/prisma/migrations/20260715200000_add_coach_user_link/migration.sql`:

```sql
-- add_coach_user_link : rattache un Coach à un compte membre (nom/photo dérivés du profil).
ALTER TABLE "coaches" ADD COLUMN IF NOT EXISTS "user_id" TEXT;

DO $$ BEGIN
  ALTER TABLE "coaches" ADD CONSTRAINT "coaches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "coaches_club_id_user_id_key" ON "coaches"("club_id", "user_id");
```

- [ ] **Step 4: Apply the migration in dev and regenerate the client**

Run (from `backend/`):

```bash
npx prisma db execute --file prisma/migrations/20260715200000_add_coach_user_link/migration.sql
npx prisma generate
```

Expected: both commands exit 0. If `db execute` errors with "relation already exists" for the unique index or FK, the migration was already applied — safe to continue (both statements are idempotent).

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260715200000_add_coach_user_link
git commit -m "feat(db): add Coach.userId link to member accounts (additive)"
```

---

### Task 2: `CoachService` — `coachDisplay` helper + `setMemberCoach`, drop CRUD

**Files:**
- Modify: `backend/src/services/coach.service.ts`
- Modify: `backend/src/services/__tests__/coach.service.test.ts`

- [ ] **Step 1: Write the failing tests (replace the whole file)**

Replace `backend/src/services/__tests__/coach.service.test.ts` entirely with:

```ts
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { CoachService, coachDisplay } from '../coach.service';

describe('coachDisplay', () => {
  it('dérive nom/photo du user lié quand présent', () => {
    expect(coachDisplay({
      name: 'Ancien nom', photoUrl: '/old.jpg',
      user: { firstName: 'Paul', lastName: 'Martin', avatarUrl: '/avatars/paul.jpg' },
    })).toEqual({ name: 'Paul Martin', photoUrl: '/avatars/paul.jpg' });
  });

  it('repli sur les colonnes Coach pour un coach legacy sans user', () => {
    expect(coachDisplay({ name: 'Coach Legacy', photoUrl: '/legacy.jpg' }))
      .toEqual({ name: 'Coach Legacy', photoUrl: '/legacy.jpg' });
  });

  it('user lié sans avatar → photoUrl null (pas le repli sur la colonne Coach)', () => {
    expect(coachDisplay({ name: 'Ancien nom', photoUrl: '/old.jpg', user: { firstName: 'Paul', lastName: 'Martin', avatarUrl: null } }))
      .toEqual({ name: 'Paul Martin', photoUrl: null });
  });
});

describe('CoachService', () => {
  let service: CoachService;
  beforeEach(() => { service = new CoachService(); });

  it('listAdmin trie actifs d abord puis sortOrder puis nom, et dérive nom/photo du user lié', async () => {
    prismaMock.coach.findMany.mockResolvedValue([
      { id: 'c1', clubId: 'club-demo', name: 'Ancien', photoUrl: null, isActive: true, sortOrder: 0,
        user: { firstName: 'Paul', lastName: 'Martin', avatarUrl: '/p.jpg' } },
      { id: 'c2', clubId: 'club-demo', name: 'Coach Legacy', photoUrl: '/legacy.jpg', isActive: true, sortOrder: 1, user: null },
    ] as any);

    const rows = await service.listAdmin('club-demo');

    expect(prismaMock.coach.findMany).toHaveBeenCalledWith({
      where: { clubId: 'club-demo' },
      orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      include: { user: { select: { firstName: true, lastName: true, avatarUrl: true } } },
    });
    expect(rows[0]).toEqual({ id: 'c1', clubId: 'club-demo', isActive: true, sortOrder: 0, name: 'Paul Martin', photoUrl: '/p.jpg' });
    expect(rows[1]).toEqual({ id: 'c2', clubId: 'club-demo', isActive: true, sortOrder: 1, name: 'Coach Legacy', photoUrl: '/legacy.jpg' });
  });

  describe('setMemberCoach', () => {
    it('MEMBER_NOT_FOUND si la cible n est pas membre du club', async () => {
      prismaMock.clubMembership.findUnique.mockResolvedValue(null as any);
      await expect(service.setMemberCoach('club-demo', 'u1', true)).rejects.toThrow('MEMBER_NOT_FOUND');
      expect(prismaMock.coach.create).not.toHaveBeenCalled();
    });

    it('coche : crée la ligne Coach avec le nom snapshoté depuis le user', async () => {
      prismaMock.clubMembership.findUnique.mockResolvedValue({ id: 'mb1' } as any);
      prismaMock.coach.findUnique.mockResolvedValue(null as any);
      prismaMock.user.findUnique.mockResolvedValue({ firstName: 'Paul', lastName: 'Martin' } as any);
      prismaMock.coach.create.mockResolvedValue({ id: 'c1' } as any);

      const r = await service.setMemberCoach('club-demo', 'u1', true);

      expect(prismaMock.coach.create).toHaveBeenCalledWith({
        data: { clubId: 'club-demo', userId: 'u1', name: 'Paul Martin', isActive: true },
      });
      expect(r).toEqual({ userId: 'u1', isCoach: true });
    });

    it('coche : réactive une ligne Coach désactivée existante (pas de re-création)', async () => {
      prismaMock.clubMembership.findUnique.mockResolvedValue({ id: 'mb1' } as any);
      prismaMock.coach.findUnique.mockResolvedValue({ id: 'c1', isActive: false } as any);

      await service.setMemberCoach('club-demo', 'u1', true);

      expect(prismaMock.coach.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { isActive: true } });
      expect(prismaMock.coach.create).not.toHaveBeenCalled();
    });

    it('coche : no-op si déjà coach actif', async () => {
      prismaMock.clubMembership.findUnique.mockResolvedValue({ id: 'mb1' } as any);
      prismaMock.coach.findUnique.mockResolvedValue({ id: 'c1', isActive: true } as any);

      await service.setMemberCoach('club-demo', 'u1', true);

      expect(prismaMock.coach.update).not.toHaveBeenCalled();
      expect(prismaMock.coach.create).not.toHaveBeenCalled();
    });

    it('décoche : soft-disable (idempotent même sans ligne existante)', async () => {
      prismaMock.clubMembership.findUnique.mockResolvedValue({ id: 'mb1' } as any);
      prismaMock.coach.updateMany.mockResolvedValue({ count: 0 } as any);

      const r = await service.setMemberCoach('club-demo', 'u1', false);

      expect(prismaMock.coach.updateMany).toHaveBeenCalledWith({ where: { clubId: 'club-demo', userId: 'u1' }, data: { isActive: false } });
      expect(r).toEqual({ userId: 'u1', isCoach: false });
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node node_modules/jest/bin/jest.js src/services/__tests__/coach.service.test.ts` (from `backend/`)
Expected: FAIL — `coachDisplay` is not exported, `setMemberCoach` does not exist, `listAdmin` doesn't select `user`.

- [ ] **Step 3: Rewrite `coach.service.ts`**

Replace `backend/src/services/coach.service.ts` entirely with:

```ts
import { prisma } from '../db/prisma';

/**
 * Nom/photo affichés d'un coach : dérivés du compte user lié quand présent (l'avatar est géré
 * par le joueur lui-même) ; repli sur les colonnes historiques pour un coach legacy sans compte.
 */
export function coachDisplay(c: {
  name: string;
  photoUrl?: string | null;
  user?: { firstName: string; lastName: string; avatarUrl?: string | null } | null;
}): { name: string; photoUrl: string | null } {
  if (c.user) return { name: `${c.user.firstName} ${c.user.lastName}`.trim(), photoUrl: c.user.avatarUrl ?? null };
  return { name: c.name, photoUrl: c.photoUrl ?? null };
}

export class CoachService {
  /** Liste back-office : actifs d'abord, puis ordre choisi, puis alphabétique. Nom/photo dérivés du user lié. */
  async listAdmin(clubId: string) {
    const rows = await prisma.coach.findMany({
      where: { clubId },
      orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      include: { user: { select: { firstName: true, lastName: true, avatarUrl: true } } },
    });
    return rows.map((c) => ({
      id: c.id, clubId: c.clubId, isActive: c.isActive, sortOrder: c.sortOrder,
      ...coachDisplay(c),
    }));
  }

  /**
   * Statut « coach » d'un membre. Coché : crée (nom snapshoté depuis le user) ou réactive sa
   * ligne Coach ; décoché : soft-disable (idempotent). Pas de garde self/owner — être coach ne
   * confère aucun privilège d'accès, un admin peut se marquer lui-même coach.
   * Lève : MEMBER_NOT_FOUND si la cible n'est pas membre du club.
   */
  async setMemberCoach(clubId: string, userId: string, isCoach: boolean) {
    const membership = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId, clubId } }, select: { id: true },
    });
    if (!membership) throw new Error('MEMBER_NOT_FOUND');

    if (!isCoach) {
      await prisma.coach.updateMany({ where: { clubId, userId }, data: { isActive: false } });
      return { userId, isCoach: false };
    }

    const existing = await prisma.coach.findUnique({
      where: { clubId_userId: { clubId, userId } }, select: { id: true, isActive: true },
    });
    if (existing) {
      if (!existing.isActive) await prisma.coach.update({ where: { id: existing.id }, data: { isActive: true } });
    } else {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true } });
      await prisma.coach.create({
        data: { clubId, userId, name: `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim(), isActive: true },
      });
    }
    return { userId, isCoach: true };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node node_modules/jest/bin/jest.js src/services/__tests__/coach.service.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/coach.service.ts backend/src/services/__tests__/coach.service.test.ts
git commit -m "feat(coach): setMemberCoach + coachDisplay, drop standalone CRUD"
```

---

### Task 3: Routes — drop `/coaches` CRUD, add `PATCH /members/:userId/coach`

**Files:**
- Modify: `backend/src/routes/admin.ts`
- Modify: `backend/src/routes/__tests__/admin.coaches.routes.test.ts`
- Create: `backend/src/routes/__tests__/admin.member-coach.routes.test.ts`

- [ ] **Step 1: Write the failing route test**

Create `backend/src/routes/__tests__/admin.member-coach.routes.test.ts`:

```ts
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';

const SECRET = process.env.JWT_SECRET!;
if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET manquant');
const token = () => jwt.sign({ id: 'admin1', email: 'a@x.fr' }, SECRET, { expiresIn: '1h' });
const auth = { Authorization: `Bearer ${token()}` };
const base = '/api/clubs/club-demo/admin';

const memberRoles = (roles: Record<string, 'OWNER' | 'ADMIN' | 'STAFF'>) =>
  prismaMock.clubMember.findUnique.mockImplementation(((args: any) => {
    const userId = args?.where?.userId_clubId?.userId as string;
    const role = roles[userId];
    return Promise.resolve(role ? { userId, clubId: 'club-demo', role } : null);
  }) as any);

beforeEach(() => {
  jest.clearAllMocks();
  memberRoles({ admin1: 'ADMIN' });
  prismaMock.clubMembership.findUnique.mockResolvedValue({ id: 'mb1' } as any);
});

describe('PATCH /api/clubs/:clubId/admin/members/:userId/coach', () => {
  it('401 sans token', async () => {
    const res = await request(app).patch(`${base}/members/u9/coach`).send({ isCoach: true });
    expect(res.status).toBe(401);
  });

  it('403 pour un viewer STAFF (route réservée ADMIN+)', async () => {
    memberRoles({ admin1: 'STAFF' });
    const res = await request(app).patch(`${base}/members/u9/coach`).set(auth).send({ isCoach: true });
    expect(res.status).toBe(403);
  });

  it('400 VALIDATION_ERROR si isCoach absent ou non-booléen', async () => {
    const res = await request(app).patch(`${base}/members/u9/coach`).set(auth).send({});
    expect(res.status).toBe(400);
    const res2 = await request(app).patch(`${base}/members/u9/coach`).set(auth).send({ isCoach: 'yes' });
    expect(res2.status).toBe(400);
  });

  it('200 : coche → crée la ligne Coach', async () => {
    prismaMock.coach.findUnique.mockResolvedValue(null as any);
    prismaMock.user.findUnique.mockResolvedValue({ firstName: 'Paul', lastName: 'Martin' } as any);
    prismaMock.coach.create.mockResolvedValue({ id: 'c1' } as any);
    const res = await request(app).patch(`${base}/members/u9/coach`).set(auth).send({ isCoach: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId: 'u9', isCoach: true });
  });

  it('200 : décoche → soft-disable', async () => {
    prismaMock.coach.updateMany.mockResolvedValue({ count: 1 } as any);
    const res = await request(app).patch(`${base}/members/u9/coach`).set(auth).send({ isCoach: false });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId: 'u9', isCoach: false });
  });

  it('404 MEMBER_NOT_FOUND si la cible est hors fichier-membres', async () => {
    prismaMock.clubMembership.findUnique.mockResolvedValue(null as any);
    const res = await request(app).patch(`${base}/members/u9/coach`).set(auth).send({ isCoach: true });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('MEMBER_NOT_FOUND');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node node_modules/jest/bin/jest.js src/routes/__tests__/admin.member-coach.routes.test.ts`
Expected: FAIL — 404 (no such route) instead of the expected statuses.

- [ ] **Step 3: Add the route in `admin.ts`**

In `backend/src/routes/admin.ts`, find the staff-role route (~line 983-989):

```ts
// Rôle back-office (staff) d'un membre — réservé OWNER/ADMIN (un STAFF ne gère pas ses pairs).
// body { role: 'ADMIN' | 'STAFF' | null } — null révoque ; `role` absent = 400 (pas de révocation implicite).
router.patch('/members/:userId/staff-role', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await clubService.setMemberStaffRole(req.membership!.clubId, req.user!.id, asString(req.params.userId), req.body?.role));
  } catch (e) { handleError(e, res, next); }
});
```

Add immediately after it:

```ts

// Statut « coach » d'un membre (table coaches, userId lié) — réservé OWNER/ADMIN, même
// périmètre que le rôle staff. body { isCoach: boolean }.
router.patch('/members/:userId/coach', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    if (typeof req.body?.isCoach !== 'boolean') return void res.status(400).json({ error: 'VALIDATION_ERROR' });
    res.json(await coachService.setMemberCoach(req.membership!.clubId, asString(req.params.userId), req.body.isCoach));
  } catch (e) { handleError(e, res, next); }
});
```

- [ ] **Step 4: Remove the `/coaches` CRUD routes, keep GET**

Find (~line 721-733):

```ts
// --- Coachs ---
router.get('/coaches', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await coachService.listAdmin(req.membership!.clubId)); } catch (e) { handleError(e, res, next); }
});
router.post('/coaches', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.status(201).json(await coachService.create(req.membership!.clubId, req.body)); } catch (e) { handleError(e, res, next); }
});
router.patch('/coaches/:id', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await coachService.update(asString(req.params.id), req.membership!.clubId, req.body)); } catch (e) { handleError(e, res, next); }
});
router.delete('/coaches/:id', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { await coachService.remove(asString(req.params.id), req.membership!.clubId); res.json({ ok: true }); } catch (e) { handleError(e, res, next); }
});
```

Replace with:

```ts
// --- Coachs (lecture seule : le statut coach se gère depuis /members/:userId/coach) ---
router.get('/coaches', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await coachService.listAdmin(req.membership!.clubId)); } catch (e) { handleError(e, res, next); }
});
```

- [ ] **Step 5: Remove the now-unused `COACH_NOT_FOUND` entry from `ERROR_STATUS`**

Find in the `ERROR_STATUS` map (~line 111):

```ts
  COACH_NOT_FOUND:        404,
```

Delete this line.

- [ ] **Step 6: Run the new test to verify it passes**

Run: `node node_modules/jest/bin/jest.js src/routes/__tests__/admin.member-coach.routes.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 7: Trim `admin.coaches.routes.test.ts` to the surviving GET route**

Replace `backend/src/routes/__tests__/admin.coaches.routes.test.ts` entirely with:

```ts
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET manquant dans l environnement de test (.env)');
const token = () => jwt.sign({ id: 'u1', email: 'owner@x.fr' }, process.env.JWT_SECRET!);
const auth = { Authorization: `Bearer ${token()}` };
const base = '/api/clubs/club-demo/admin';

beforeEach(() => {
  prismaMock.clubMember.findUnique.mockResolvedValue({ userId: 'u1', clubId: 'club-demo', role: 'OWNER' } as any);
});

describe('routes admin /coaches (lecture seule)', () => {
  it('GET /coaches → 200 liste (STAFF suffit, pas de garde ADMIN)', async () => {
    prismaMock.coach.findMany.mockResolvedValue([
      { id: 'c1', clubId: 'club-demo', name: 'Paul', photoUrl: null, isActive: true, sortOrder: 0, user: null },
    ] as any);
    const res = await request(app).get(`${base}/coaches`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'c1', clubId: 'club-demo', name: 'Paul', photoUrl: null, isActive: true, sortOrder: 0 }]);
  });
});
```

- [ ] **Step 8: Run both route test files to verify everything passes**

Run: `node node_modules/jest/bin/jest.js src/routes/__tests__/admin.coaches.routes.test.ts src/routes/__tests__/admin.member-coach.routes.test.ts`
Expected: PASS (7 tests total)

- [ ] **Step 9: Commit**

```bash
git add backend/src/routes/admin.ts backend/src/routes/__tests__/admin.coaches.routes.test.ts backend/src/routes/__tests__/admin.member-coach.routes.test.ts
git commit -m "feat(routes): PATCH members/:userId/coach, drop /coaches CRUD"
```

---

### Task 4: `ClubService.listMembers` exposes `isCoach`

**Files:**
- Modify: `backend/src/services/club.service.ts`
- Modify: `backend/src/services/__tests__/club.service.test.ts`

- [ ] **Step 1: Write the failing test**

In `backend/src/services/__tests__/club.service.test.ts`, find the `beforeEach` of `describe('ClubService — listMembers (enrichi)'` (~line 939-954):

```ts
  beforeEach(() => {
    service = new ClubService();
    // Deux membres par défaut ; chaque requête d'enrichissement renvoie vide (surchargée au cas par cas).
    prismaMock.clubMembership.findMany.mockResolvedValue([
      { id: 'm1', isSubscriber: false, membershipNo: null, status: 'ACTIVE', note: null, watch: false, createdAt: new Date('2026-01-01'),
        user: { id: 'u1', firstName: 'Olivia', lastName: 'Gerante', email: 'o@x.fr', phone: null, avatarUrl: '/uploads/avatars/u1.jpg' } },
      { id: 'm2', isSubscriber: false, membershipNo: null, status: 'ACTIVE', note: null, watch: false, createdAt: new Date('2026-01-02'),
        user: { id: 'u2', firstName: 'Paul', lastName: 'Martin', email: 'p@x.fr', phone: null, avatarUrl: null } },
    ] as any);
    prismaMock.clubMember.findMany.mockResolvedValue([{ userId: 'u1', role: 'OWNER' }] as any);
    prismaMock.subscription.findMany.mockResolvedValue([] as any);
    prismaMock.memberPackage.findMany.mockResolvedValue([] as any);
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-padel' } as any); // getLevelsForUsers → sportId('padel')
    prismaMock.playerRating.findMany.mockResolvedValue([] as any);
    prismaMock.$queryRaw.mockResolvedValue([] as any);
  });
```

Add one line (`prismaMock.coach.findMany.mockResolvedValue([] as any);`) right before the closing `});`:

```ts
  beforeEach(() => {
    service = new ClubService();
    // Deux membres par défaut ; chaque requête d'enrichissement renvoie vide (surchargée au cas par cas).
    prismaMock.clubMembership.findMany.mockResolvedValue([
      { id: 'm1', isSubscriber: false, membershipNo: null, status: 'ACTIVE', note: null, watch: false, createdAt: new Date('2026-01-01'),
        user: { id: 'u1', firstName: 'Olivia', lastName: 'Gerante', email: 'o@x.fr', phone: null, avatarUrl: '/uploads/avatars/u1.jpg' } },
      { id: 'm2', isSubscriber: false, membershipNo: null, status: 'ACTIVE', note: null, watch: false, createdAt: new Date('2026-01-02'),
        user: { id: 'u2', firstName: 'Paul', lastName: 'Martin', email: 'p@x.fr', phone: null, avatarUrl: null } },
    ] as any);
    prismaMock.clubMember.findMany.mockResolvedValue([{ userId: 'u1', role: 'OWNER' }] as any);
    prismaMock.subscription.findMany.mockResolvedValue([] as any);
    prismaMock.memberPackage.findMany.mockResolvedValue([] as any);
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-padel' } as any); // getLevelsForUsers → sportId('padel')
    prismaMock.playerRating.findMany.mockResolvedValue([] as any);
    prismaMock.$queryRaw.mockResolvedValue([] as any);
    prismaMock.coach.findMany.mockResolvedValue([] as any);
  });

  it('expose isCoach (actif et lié au user seulement), en 1 requête groupée', async () => {
    prismaMock.coach.findMany.mockResolvedValue([{ userId: 'u1' }] as any);
    const rows = await service.listMembers('club-demo');
    expect(rows[0].isCoach).toBe(true);
    expect(rows[1].isCoach).toBe(false);
    expect(prismaMock.coach.findMany).toHaveBeenCalledWith({
      where: { clubId: 'club-demo', isActive: true, userId: { in: ['u1', 'u2'] } },
      select: { userId: true },
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node node_modules/jest/bin/jest.js src/services/__tests__/club.service.test.ts -t "listMembers"`
Expected: FAIL — `rows[0].isCoach` is `undefined`, and/or `prismaMock.coach.findMany` was never called with those args (may also throw if `coach.findMany` isn't mocked to return an array before this step — check it resolves to `undefined` and `.map` on it throws, since `listMembers` doesn't call it yet the mock is simply unused, so the failure is the assertion, not a throw).

- [ ] **Step 3: Add the query + `isCoach` mapping in `listMembers`**

In `backend/src/services/club.service.ts`, find the `Promise.all` that loads `[members, staff, subs, packages]` (~line 403-425) and change it to also load coaches:

```ts
    const [members, staff, subs, packages] = await Promise.all([
      prisma.clubMembership.findMany({
        where: { clubId, user: { deletedAt: null, isSuperAdmin: false } },
        orderBy: [{ user: { lastName: 'asc' } }, { user: { firstName: 'asc' } }],
        select: {
          id: true, isSubscriber: true, membershipNo: true, status: true, note: true, watch: true, createdAt: true,
          user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, avatarUrl: true } },
        },
      }),
      // rôle back-office (table ClubMember) mappé par userId — une requête pour tout le club
      prisma.clubMember.findMany({ where: { clubId }, select: { userId: true, role: true } }),
      // abonnements club actifs (prédicat miroir de subscription.service.listMySubscriptionsBySlug)
      // select élargi : la ligne membre porte le cycle de vie (échéance/prix/sport/id) en contexte abonnés.
      prisma.subscription.findMany({
        where: { clubId, status: 'ACTIVE', expiresAt: { gt: now } },
        select: { id: true, userId: true, planId: true, expiresAt: true, monthlyPriceSnapshot: true, sportKeys: true, plan: { select: { name: true } } },
      }),
      // carnets / porte-monnaie — utilisabilité calculée en JS (isUsable, miroir de memberStats.service)
      prisma.memberPackage.findMany({
        where: { clubId },
        select: { userId: true, creditsRemaining: true, amountRemaining: true, expiresAt: true },
      }),
    ]);
    const roleByUser = new Map(staff.map((s) => [s.userId, s.role]));
    const userIds = members.map((m) => m.user.id);
```

Replace with:

```ts
    const [members, staff, subs, packages] = await Promise.all([
      prisma.clubMembership.findMany({
        where: { clubId, user: { deletedAt: null, isSuperAdmin: false } },
        orderBy: [{ user: { lastName: 'asc' } }, { user: { firstName: 'asc' } }],
        select: {
          id: true, isSubscriber: true, membershipNo: true, status: true, note: true, watch: true, createdAt: true,
          user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, avatarUrl: true } },
        },
      }),
      // rôle back-office (table ClubMember) mappé par userId — une requête pour tout le club
      prisma.clubMember.findMany({ where: { clubId }, select: { userId: true, role: true } }),
      // abonnements club actifs (prédicat miroir de subscription.service.listMySubscriptionsBySlug)
      // select élargi : la ligne membre porte le cycle de vie (échéance/prix/sport/id) en contexte abonnés.
      prisma.subscription.findMany({
        where: { clubId, status: 'ACTIVE', expiresAt: { gt: now } },
        select: { id: true, userId: true, planId: true, expiresAt: true, monthlyPriceSnapshot: true, sportKeys: true, plan: { select: { name: true } } },
      }),
      // carnets / porte-monnaie — utilisabilité calculée en JS (isUsable, miroir de memberStats.service)
      prisma.memberPackage.findMany({
        where: { clubId },
        select: { userId: true, creditsRemaining: true, amountRemaining: true, expiresAt: true },
      }),
    ]);
    const roleByUser = new Map(staff.map((s) => [s.userId, s.role]));
    const userIds = members.map((m) => m.user.id);

    // Statut coach (table coaches, userId lié) — une requête pour tout le club, pas de N+1.
    const coachRows = userIds.length === 0
      ? []
      : await prisma.coach.findMany({ where: { clubId, isActive: true, userId: { in: userIds } }, select: { userId: true } });
    const coachUserIds = new Set(coachRows.map((c) => c.userId));
```

- [ ] **Step 4: Add `isCoach` to the returned row**

Find the `return members.map((m) => ({...}))` block (~line 471-483) and add `isCoach` at the end:

```ts
    return members.map((m) => ({
      id: m.id, userId: m.user.id,
      firstName: m.user.firstName, lastName: m.user.lastName, email: m.user.email, phone: m.user.phone,
      avatarUrl: m.user.avatarUrl ?? null,
      isSubscriber: m.isSubscriber, membershipNo: m.membershipNo, status: m.status, note: m.note, watch: m.watch, since: m.createdAt,
      staffRole: roleByUser.get(m.user.id) ?? null,
      level: levels[m.user.id] ?? null,
      hasActiveSubscription: subByUser.has(m.user.id),
      subscriptionPlan: subByUser.get(m.user.id)?.planName ?? null,
      subscription: subByUser.get(m.user.id) ?? null,
      hasActivePackage: usableByUser.has(m.user.id),
      lastSeenAt: lastSeenBy.get(m.user.id)?.toISOString() ?? null,
      isCoach: coachUserIds.has(m.user.id),
    }));
```

- [ ] **Step 5: Add `isCoach: false` to `toMemberRow` (freshly created/attached members)**

Find `toMemberRow` (~line 553-564):

```ts
      staffRole: null, level: null, hasActiveSubscription: false, subscriptionPlan: null, subscription: null,
      hasActivePackage: false, lastSeenAt: null,
    };
```

Replace with:

```ts
      staffRole: null, level: null, hasActiveSubscription: false, subscriptionPlan: null, subscription: null,
      hasActivePackage: false, lastSeenAt: null, isCoach: false,
    };
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node node_modules/jest/bin/jest.js src/services/__tests__/club.service.test.ts`
Expected: PASS (all `ClubService` tests, including the new `isCoach` one)

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/club.service.ts backend/src/services/__tests__/club.service.test.ts
git commit -m "feat(members): expose isCoach on listMembers (1 batched query)"
```

---

### Task 5: `lesson.service.ts` — derive coach name/photo from the linked user

**Files:**
- Modify: `backend/src/services/lesson.service.ts`
- Modify: `backend/src/services/__tests__/lesson.service.test.ts`

- [ ] **Step 1: Write the failing test**

In `backend/src/services/__tests__/lesson.service.test.ts`, add this new `describe` block right after the existing `describe('LessonService.getPublicLesson — lessonKind + seriesId présents dans le row public', ...)` block (~after line 280):

```ts
describe('LessonService.getPublicLesson — coach lié à un compte : nom/photo dérivés du user', () => {
  it('utilise prénom+nom et avatar du user quand le coach est lié', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue({
      id: 'l1',
      clubId: 'club-demo',
      lessonKind: 'INDIVIDUAL',
      seriesId: null,
      capacity: 4,
      allowSelfEnroll: true,
      coach: { name: 'Ancien nom', photoUrl: '/old.jpg', user: { firstName: 'Paul', lastName: 'Martin', avatarUrl: '/avatars/paul.jpg' } },
      reservation: {
        startTime: new Date('2026-07-01T09:00:00Z'),
        endTime: new Date('2026-07-01T10:00:00Z'),
        resource: { name: 'T1', clubSport: null },
      },
      series: null,
      club: { slug: 'club-demo', name: 'Club Démo', timezone: 'Europe/Paris' },
    } as any);
    (prismaMock.lessonEnrollment.groupBy as jest.Mock).mockResolvedValue([]);

    const row = await lessonService.getPublicLesson('l1');
    expect(row.coach).toEqual({ name: 'Paul Martin', photoUrl: '/avatars/paul.jpg' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node node_modules/jest/bin/jest.js src/services/__tests__/lesson.service.test.ts -t "coach lié à un compte"`
Expected: FAIL — `row.coach` is `{ name: 'Ancien nom', photoUrl: '/old.jpg', user: {...} }` (the raw `lesson.coach`, `user` key leaking through), not the derived shape.

- [ ] **Step 3: Import `coachDisplay` and update `mapToPublicRow`**

In `backend/src/services/lesson.service.ts`, add the import at the top (after the existing `notifications` import, ~line 7):

```ts
import { coachDisplay } from './coach.service';
```

Find the `mapToPublicRow` parameter type and body (~line 350-371):

```ts
  private mapToPublicRow(
    lesson: {
      id: string;
      clubId: string;
      lessonKind: string;
      seriesId: string | null;
      capacity: number;
      allowSelfEnroll: boolean;
      coach: { name: string; photoUrl: string | null };
      reservation: { startTime: Date; endTime: Date; resource: { name: string; clubSport: { sport: { key: string; name: string } } | null } };
      series: { id: string; capacity: number | null; enrollmentMode: EnrollmentMode | null; title: string | null } | null;
      club: { slug: string; name: string; timezone: string };
    },
    confirmedCount: number,
    waitlistCount: number,
  ): PublicLessonRow {
    return {
      id: lesson.id,
      clubId: lesson.clubId,
      lessonKind: lesson.lessonKind,
      seriesId: lesson.seriesId,
      coach: lesson.coach,
```

Replace with:

```ts
  private mapToPublicRow(
    lesson: {
      id: string;
      clubId: string;
      lessonKind: string;
      seriesId: string | null;
      capacity: number;
      allowSelfEnroll: boolean;
      coach: { name: string; photoUrl: string | null; user?: { firstName: string; lastName: string; avatarUrl: string | null } | null };
      reservation: { startTime: Date; endTime: Date; resource: { name: string; clubSport: { sport: { key: string; name: string } } | null } };
      series: { id: string; capacity: number | null; enrollmentMode: EnrollmentMode | null; title: string | null } | null;
      club: { slug: string; name: string; timezone: string };
    },
    confirmedCount: number,
    waitlistCount: number,
  ): PublicLessonRow {
    return {
      id: lesson.id,
      clubId: lesson.clubId,
      lessonKind: lesson.lessonKind,
      seriesId: lesson.seriesId,
      coach: coachDisplay(lesson.coach),
```

- [ ] **Step 4: Add `user` to the three `coach: { select: ... } }` sites**

There are 3 identical occurrences of this select in `lesson.service.ts` (in `getPublicLesson`, `listPublicByClubSlug`, and the series-occurrences branch of `listUserEnrollments`):

```ts
        coach: { select: { name: true, photoUrl: true } },
```

Replace **all three** occurrences with:

```ts
        coach: { select: { name: true, photoUrl: true, user: { select: { firstName: true, lastName: true, avatarUrl: true } } } },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node node_modules/jest/bin/jest.js src/services/__tests__/lesson.service.test.ts`
Expected: PASS (all `LessonService` tests, including the new one). The pre-existing tests using `coach: { name: 'Coach A', photoUrl: null }` (no `user` key) must still pass — `coachDisplay` falls back to the legacy columns when `user` is absent.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/lesson.service.ts backend/src/services/__tests__/lesson.service.test.ts
git commit -m "feat(lessons): derive public coach name/photo from linked user account"
```

---

### Task 6: `notifications.ts` — same derivation for the 2 email-context sites

**Files:**
- Modify: `backend/src/email/notifications.ts`
- Modify: `backend/src/email/__tests__/notifications.newevents.test.ts`

- [ ] **Step 1: Write the failing test**

In `backend/src/email/__tests__/notifications.newevents.test.ts`, add this test right after the existing `it('dispatch MY_REGISTRATIONS/activity.cancelled_by_club à chaque inscrit du cours', ...)` test (inside the same `describe('notifyActivityCancelledByClub(lesson) → dispatch', ...)` block, ~after line 179):

```ts
  it('utilise le nom du user lié au coach si présent (coach rattaché à un membre)', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue({
      id: 'lesson-2',
      club,
      coach: { name: 'Ancien nom', user: { firstName: 'Paul', lastName: 'Martin' } },
      reservation: {
        startTime: new Date('2026-07-15T10:00:00Z'),
        endTime: new Date('2026-07-15T11:00:00Z'),
      },
      enrollments: [
        { status: 'CONFIRMED', user: { id: 'student-3', email: 'student3@x.fr', firstName: 'Léa' } },
      ],
    } as any);

    await notifyActivityCancelledByClub('lesson', 'lesson-2');

    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'student-3',
      body: '« Cours — Paul Martin » a été annulé par le club.',
    }));
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node node_modules/jest/bin/jest.js src/email/__tests__/notifications.newevents.test.ts -t "nom du user lié"`
Expected: FAIL — `body` is `« Cours — Ancien nom » a été annulé par le club.` (uses the raw `coach.name`, ignores `user`).

- [ ] **Step 3: Import `coachDisplay` in `notifications.ts`**

In `backend/src/email/notifications.ts`, add the import after the existing `SSEService` import (~line 11):

```ts
import { coachDisplay } from '../services/coach.service';
```

- [ ] **Step 4: Update the `loadLessonEnrollment` selects and `lessonEmailContext`**

Find (~line 767-787):

```ts
async function loadLessonEnrollment(enrollmentId: string) {
  return prisma.lessonEnrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      lesson: {
        include: {
          coach: { select: { name: true } },
          reservation: { select: { startTime: true, endTime: true } },
          club: { select: EMAIL_CLUB_SELECT },
        },
      },
      series: {
        include: {
          coach: { select: { name: true } },
          club: { select: EMAIL_CLUB_SELECT },
        },
      },
      user: { select: { id: true, email: true, firstName: true, lastName: true } },
    },
  });
}
```

Replace with:

```ts
async function loadLessonEnrollment(enrollmentId: string) {
  return prisma.lessonEnrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      lesson: {
        include: {
          coach: { select: { name: true, user: { select: { firstName: true, lastName: true } } } },
          reservation: { select: { startTime: true, endTime: true } },
          club: { select: EMAIL_CLUB_SELECT },
        },
      },
      series: {
        include: {
          coach: { select: { name: true, user: { select: { firstName: true, lastName: true } } } },
          club: { select: EMAIL_CLUB_SELECT },
        },
      },
      user: { select: { id: true, email: true, firstName: true, lastName: true } },
    },
  });
}
```

Find, in `lessonEmailContext` (~line 800):

```ts
  const coachName = enr.lesson?.coach?.name ?? enr.series?.coach?.name ?? null;
```

Replace with:

```ts
  const coachName = (enr.lesson?.coach ? coachDisplay(enr.lesson.coach).name : null)
    ?? (enr.series?.coach ? coachDisplay(enr.series.coach).name : null);
```

- [ ] **Step 5: Update the second site (`notifyActivityCancelledByClub`, lesson branch)**

Find (~line 1229-1244):

```ts
    const lesson = await prisma.lesson.findUnique({
      where: { id: activityId },
      include: {
        club: { select: EMAIL_CLUB_SELECT },
        coach: { select: { name: true } },
        reservation: { select: { startTime: true, endTime: true } },
        enrollments: {
          where: { status: { in: ['CONFIRMED', 'WAITLISTED'] } },
          include: { user: { select: { id: true, email: true, firstName: true } } },
        },
      },
    });
    if (!lesson) return;
    const club = lesson.club;
    const brand = brandFromClub(club);
    const activityName = lesson.coach?.name ? `Cours — ${lesson.coach.name}` : 'Cours';
```

Replace with:

```ts
    const lesson = await prisma.lesson.findUnique({
      where: { id: activityId },
      include: {
        club: { select: EMAIL_CLUB_SELECT },
        coach: { select: { name: true, user: { select: { firstName: true, lastName: true } } } },
        reservation: { select: { startTime: true, endTime: true } },
        enrollments: {
          where: { status: { in: ['CONFIRMED', 'WAITLISTED'] } },
          include: { user: { select: { id: true, email: true, firstName: true } } },
        },
      },
    });
    if (!lesson) return;
    const club = lesson.club;
    const brand = brandFromClub(club);
    const coachName = lesson.coach ? coachDisplay(lesson.coach).name : null;
    const activityName = coachName ? `Cours — ${coachName}` : 'Cours';
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node node_modules/jest/bin/jest.js src/email/__tests__/notifications.newevents.test.ts`
Expected: PASS (all tests in this file, including the new one and the pre-existing `coach: { name: 'Jean Dupont' }` case which has no `user` key).

- [ ] **Step 7: Commit**

```bash
git add backend/src/email/notifications.ts backend/src/email/__tests__/notifications.newevents.test.ts
git commit -m "feat(emails): derive lesson coach name from linked user in notifications"
```

---

### Task 7: Backend suite — full run

- [ ] **Step 1: Run the full backend test suite**

Run (from `backend/`): `node node_modules/jest/bin/jest.js`
Expected: PASS. If any unrelated pre-existing failure shows up (check against known baselines in memory before assuming it's yours), note it but don't fix it as part of this plan.

- [ ] **Step 2: Type-check**

Run (from `backend/`): `node node_modules/typescript/bin/tsc --noEmit`
Expected: no errors.

---

### Task 8: Frontend `lib/api.ts` — types + methods

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Add `isCoach` to `Member`**

Find (~line 1356-1357):

```ts
  watch?: boolean;     // drapeau « à surveiller »
  staffRole?: 'OWNER' | 'ADMIN' | 'STAFF' | null; // rôle back-office (table ClubMember), null = membre simple
```

Replace with:

```ts
  watch?: boolean;     // drapeau « à surveiller »
  staffRole?: 'OWNER' | 'ADMIN' | 'STAFF' | null; // rôle back-office (table ClubMember), null = membre simple
  isCoach?: boolean;   // anime des cours (table coaches, liée au compte)
```

- [ ] **Step 2: Add `adminSetMemberCoach`**

Find (~line 554-555):

```ts
  adminSetMemberStaffRole: (clubId: string, userId: string, role: 'ADMIN' | 'STAFF' | null, token: string) =>
    request<{ userId: string; staffRole: 'ADMIN' | 'STAFF' | null }>(`/api/clubs/${clubId}/admin/members/${userId}/staff-role`, { method: 'PATCH', body: JSON.stringify({ role }) }, token),
```

Add right after it:

```ts

  adminSetMemberCoach: (clubId: string, userId: string, isCoach: boolean, token: string) =>
    request<{ userId: string; isCoach: boolean }>(`/api/clubs/${clubId}/admin/members/${userId}/coach`, { method: 'PATCH', body: JSON.stringify({ isCoach }) }, token),
```

- [ ] **Step 3: Drop the coach CRUD methods, keep `adminListCoaches`**

Find (~line 1002-1013):

```ts
  // --- Coachs (back-office club) ---
  adminListCoaches: (clubId: string, token: string) =>
    request<Coach[]>(`/api/clubs/${clubId}/admin/coaches`, {}, token),

  adminCreateCoach: (clubId: string, body: CoachBody, token: string) =>
    request<Coach>(`/api/clubs/${clubId}/admin/coaches`, { method: 'POST', body: JSON.stringify(body) }, token),

  adminUpdateCoach: (clubId: string, id: string, body: CoachBody, token: string) =>
    request<Coach>(`/api/clubs/${clubId}/admin/coaches/${id}`, { method: 'PATCH', body: JSON.stringify(body) }, token),

  adminDeleteCoach: (clubId: string, id: string, token: string) =>
    request<{ ok: true }>(`/api/clubs/${clubId}/admin/coaches/${id}`, { method: 'DELETE' }, token),
```

Replace with:

```ts
  // --- Coachs (lecture seule : le statut coach se gère depuis adminSetMemberCoach) ---
  adminListCoaches: (clubId: string, token: string) =>
    request<Coach[]>(`/api/clubs/${clubId}/admin/coaches`, {}, token),
```

- [ ] **Step 4: Drop `bio` from `Coach`, remove `CoachBody`**

Find (~line 2715-2730):

```ts
export interface Coach {
  id: string;
  clubId: string;
  name: string;
  photoUrl: string | null;
  bio: string | null;
  isActive: boolean;
  sortOrder: number;
}

export interface CoachBody {
  name?: string;
  bio?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}
```

Replace with:

```ts
export interface Coach {
  id: string;
  clubId: string;
  name: string;
  photoUrl: string | null;
  isActive: boolean;
  sortOrder: number;
}
```

- [ ] **Step 5: Type-check**

Run (from `frontend/`): `node node_modules/typescript/bin/tsc --noEmit`
Expected: errors in `app/admin/coaches/page.tsx` (still imports `CoachBody`, calls the removed methods) — expected at this point, fixed by Task 10 (file deleted). No other errors should reference `lib/api.ts` itself.

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(api): isCoach on Member, adminSetMemberCoach, drop coach CRUD methods"
```

---

### Task 9: `lib/members.ts` — relocate the `StaffRole` type

**Files:**
- Modify: `frontend/lib/members.ts`

- [ ] **Step 1: Add the `StaffRole` type export**

Find (~line 11-12):

```ts
/** Libellé du rôle back-office (partagé liste / panneau / CSV). */
export const STAFF_LABEL: Record<'OWNER' | 'ADMIN' | 'STAFF', string> = { OWNER: 'Gérant', ADMIN: 'Admin', STAFF: 'Staff' };
```

Replace with:

```ts
/** Libellé du rôle back-office (partagé liste / panneau / CSV). */
export const STAFF_LABEL: Record<'OWNER' | 'ADMIN' | 'STAFF', string> = { OWNER: 'Gérant', ADMIN: 'Admin', STAFF: 'Staff' };

/** Rôle attribuable depuis le bloc « Rôle » du panneau membre (null = révocation / membre simple). */
export type StaffRole = 'ADMIN' | 'STAFF' | null;
```

- [ ] **Step 2: Commit**

```bash
git add frontend/lib/members.ts
git commit -m "refactor: relocate StaffRole type to lib/members.ts"
```

---

### Task 10: `MemberPanel.tsx` + `page.tsx` wiring — visible "RÔLE" block + Coach checkbox

> **Ordering note:** this task rewrites `MemberPanel.tsx` (which starts requiring a new
> `onSetCoach` prop and importing `StaffRole` from `@/lib/members`) AND wires `page.tsx`
> to match, in the same task. Splitting them across two tasks/commits would leave an
> intermediate state where `page.tsx` still imports the soon-deleted `StaffRoleMenu.tsx`
> and doesn't pass `onSetCoach` — the very tests this task adds would fail at runtime
> (`onSetCoach is not a function`) if we stopped mid-way.

**Files:**
- Modify: `frontend/components/admin/members/MemberPanel.tsx`
- Modify: `frontend/components/admin/members/MemberRow.tsx`
- Modify: `frontend/app/admin/members/page.tsx`
- Modify: `frontend/__tests__/AdminMembersStaff.test.tsx`
- Modify: `frontend/__tests__/MemberRow.test.tsx`
- Delete: `frontend/components/admin/StaffRoleMenu.tsx`

- [ ] **Step 1: Write the failing tests — rewrite `AdminMembersStaff.test.tsx`**

Replace `frontend/__tests__/AdminMembersStaff.test.tsx` entirely with:

```tsx
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import AdminMembersPage from '../app/admin/members/page';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));
jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'club-1' } }) }));
jest.mock('../lib/api', () => ({
  api: {
    adminGetMembers: jest.fn(),
    getMyClubs: jest.fn(),
    getMyProfile: jest.fn(),
    adminSetMemberStaffRole: jest.fn(),
    adminSetMemberCoach: jest.fn(),
    adminRemoveMember: jest.fn(),
    adminUpdateMember: jest.fn(),
    adminSetMemberBlocked: jest.fn(),
  },
  assetUrl: (u: string | null) => u,
}));
import { api } from '../lib/api';

const base = { phone: null, isSubscriber: false, membershipNo: null, status: 'ACTIVE', note: null, watch: false };
const members = [
  { ...base, id: 'm1', userId: 'u-owner',  firstName: 'Olivia', lastName: 'Gerante', email: 'o@x.fr', staffRole: 'OWNER' },
  { ...base, id: 'm2', userId: 'u-viewer', firstName: 'Vera',   lastName: 'Moi',     email: 'v@x.fr', staffRole: 'ADMIN' },
  { ...base, id: 'm3', userId: 'u-plain',  firstName: 'Paul',   lastName: 'Martin',  email: 'p@x.fr', staffRole: null },
];

beforeEach(() => {
  jest.clearAllMocks();
  (api.adminGetMembers as jest.Mock).mockResolvedValue(members);
  (api.getMyClubs as jest.Mock).mockResolvedValue([{ clubId: 'club-1', slug: 'c', name: 'Club', role: 'ADMIN' }]);
  (api.getMyProfile as jest.Mock).mockResolvedValue({ id: 'u-viewer' });
  (api.adminSetMemberStaffRole as jest.Mock).mockResolvedValue({ userId: 'u-plain', staffRole: 'STAFF' });
  (api.adminSetMemberCoach as jest.Mock).mockResolvedValue({ userId: 'u-plain', isCoach: true });
});

const mount = () => render(<ThemeProvider><AdminMembersPage /></ThemeProvider>);

// Ouvre le panneau d'un membre (le bloc « Rôle » / « Supprimer » vit dans le panneau).
const openPanel = async (name: string) => fireEvent.click(await screen.findByRole('button', { name: `Ouvrir la fiche de ${name}` }));
const roleGroup = (name: string) => screen.getByRole('group', { name: `Rôle de ${name}` });

it('affiche les badges Gérant/Admin (rien pour un membre simple)', async () => {
  mount();
  await screen.findByText('Paul Martin');
  expect(screen.getByText('Gérant')).toBeInTheDocument();
  expect(screen.getByText('Admin')).toBeInTheDocument();
  expect(screen.queryByText('Staff')).toBeNull();
});

it('viewer ADMIN : bloc Rôle éditable pour un membre simple (segmented + case Coach)', async () => {
  mount();
  await screen.findByText('Paul Martin');

  await openPanel('Paul Martin');
  const group = await waitFor(() => roleGroup('Paul Martin'));
  expect(within(group).getByRole('button', { name: 'Membre' })).toBeInTheDocument();
  expect(within(group).getByRole('button', { name: 'Staff' })).toBeInTheDocument();
  expect(within(group).getByRole('button', { name: 'Admin' })).toBeInTheDocument();
  expect(within(group).getByRole('checkbox', { name: /Coach/ })).toBeInTheDocument();
});

it('viewer ADMIN : bloc Rôle en lecture seule pour le gérant et pour soi-même (case Coach reste active)', async () => {
  mount();
  await screen.findByText('Paul Martin');

  await openPanel('Olivia Gerante');
  const ownerGroup = await waitFor(() => roleGroup('Olivia Gerante'));
  expect(within(ownerGroup).queryByRole('button', { name: 'Staff' })).toBeNull();
  expect(within(ownerGroup).getByText('Gérant')).toBeInTheDocument();
  expect(within(ownerGroup).getByRole('checkbox', { name: /Coach/ })).toBeInTheDocument();

  await openPanel('Vera Moi');
  const selfGroup = await waitFor(() => roleGroup('Vera Moi'));
  expect(within(selfGroup).queryByRole('button', { name: 'Membre' })).toBeNull();
  expect(within(selfGroup).getByText('Admin')).toBeInTheDocument();
  expect(within(selfGroup).getByRole('checkbox', { name: /Coach/ })).toBeInTheDocument();
});

it('viewer STAFF : badges visibles mais aucun bloc Rôle dans le panneau', async () => {
  (api.getMyClubs as jest.Mock).mockResolvedValue([{ clubId: 'club-1', slug: 'c', name: 'Club', role: 'STAFF' }]);
  mount();
  await screen.findByText('Paul Martin');
  expect(screen.getByText('Gérant')).toBeInTheDocument();
  await openPanel('Paul Martin');
  expect(screen.queryByRole('group', { name: /Rôle de/ })).toBeNull();
});

it('sélectionner « Staff » dans le segmented → PATCH puis rechargement', async () => {
  mount();
  await openPanel('Paul Martin');
  const group = await waitFor(() => roleGroup('Paul Martin'));
  fireEvent.click(within(group).getByRole('button', { name: 'Staff' }));
  await waitFor(() => expect(api.adminSetMemberStaffRole).toHaveBeenCalledWith('club-1', 'u-plain', 'STAFF', 'tok'));
  await waitFor(() => expect(api.adminGetMembers).toHaveBeenCalledTimes(2));
});

it('supprimer un membre staff → 409 MEMBER_IS_STAFF affiché en français', async () => {
  (api.adminRemoveMember as jest.Mock).mockRejectedValue(new Error('MEMBER_IS_STAFF'));
  mount();
  await screen.findByText('Vera Moi');
  await openPanel('Vera Moi');
  fireEvent.click(screen.getByRole('button', { name: 'Supprimer le membre' }));
  fireEvent.click(screen.getByRole('button', { name: 'Supprimer' })); // confirmation
  await screen.findByText(/retirez d'abord son rôle/i);
  expect(api.adminRemoveMember).toHaveBeenCalledWith('club-1', 'm2', 'tok');
});

const sam = { ...base, id: 'm4', userId: 'u-staff', firstName: 'Sam', lastName: 'Staffeur', email: 's@x.fr', staffRole: 'STAFF' };

it('révoquer via « Membre » → PATCH role null', async () => {
  (api.adminGetMembers as jest.Mock).mockResolvedValue([...members, sam]);
  mount();
  await openPanel('Sam Staffeur');
  const group = await waitFor(() => roleGroup('Sam Staffeur'));
  fireEvent.click(within(group).getByRole('button', { name: 'Membre' }));
  await waitFor(() => expect(api.adminSetMemberStaffRole).toHaveBeenCalledWith('club-1', 'u-staff', null, 'tok'));
});

it('re-sélectionner le rôle courant = no-op (pas de PATCH, pas de rechargement)', async () => {
  (api.adminGetMembers as jest.Mock).mockResolvedValue([...members, sam]);
  mount();
  await openPanel('Sam Staffeur');
  const group = await waitFor(() => roleGroup('Sam Staffeur'));
  fireEvent.click(within(group).getByRole('button', { name: 'Staff' }));
  await waitFor(() => expect(api.adminGetMembers).toHaveBeenCalledTimes(1));
  expect(api.adminSetMemberStaffRole).not.toHaveBeenCalled();
});

it('cocher « Coach » → PATCH isCoach puis rechargement', async () => {
  mount();
  await openPanel('Paul Martin');
  const group = await waitFor(() => roleGroup('Paul Martin'));
  fireEvent.click(within(group).getByRole('checkbox', { name: /Coach/ }));
  await waitFor(() => expect(api.adminSetMemberCoach).toHaveBeenCalledWith('club-1', 'u-plain', true, 'tok'));
  await waitFor(() => expect(api.adminGetMembers).toHaveBeenCalledTimes(2));
});

it('décocher « Coach » → PATCH isCoach false', async () => {
  (api.adminGetMembers as jest.Mock).mockResolvedValue(
    members.map((m) => (m.userId === 'u-plain' ? { ...m, isCoach: true } : m)),
  );
  (api.adminSetMemberCoach as jest.Mock).mockResolvedValue({ userId: 'u-plain', isCoach: false });
  mount();
  await openPanel('Paul Martin');
  const group = await waitFor(() => roleGroup('Paul Martin'));
  const checkbox = within(group).getByRole('checkbox', { name: /Coach/ }) as HTMLInputElement;
  expect(checkbox.checked).toBe(true);
  fireEvent.click(checkbox);
  await waitFor(() => expect(api.adminSetMemberCoach).toHaveBeenCalledWith('club-1', 'u-plain', false, 'tok'));
});
```

- [ ] **Step 2: Add the Coach chip assertions to `MemberRow.test.tsx`**

In `frontend/__tests__/MemberRow.test.tsx`, add at the end of the file (after the last existing `it`):

```tsx

it('affiche la chip Coach quand isCoach', () => {
  wrap({ m: { ...base, isCoach: true } });
  expect(screen.getByText('Coach')).toBeInTheDocument();
});

it('pas de chip Coach sinon', () => {
  wrap();
  expect(screen.queryByText('Coach')).toBeNull();
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run (from `frontend/`):
```bash
node node_modules/jest/bin/jest.js AdminMembersStaff.test.tsx MemberRow.test.tsx
```
Expected: FAIL — no `role="group"` block exists yet, `adminSetMemberCoach` is never called, no "Coach" chip in `MemberRow`.

- [ ] **Step 4: Rewrite `MemberPanel.tsx`**

Replace `frontend/components/admin/members/MemberPanel.tsx` entirely with:

```tsx
'use client';
import { useState, useEffect, CSSProperties } from 'react';
import Link from 'next/link';
import { useTheme } from '@/lib/ThemeProvider';
import { Member } from '@/lib/api';
import { Avatar } from '@/components/ui/Avatar';
import { Chip, Segmented } from '@/components/ui/atoms';
import { colorForSeed } from '@/lib/playerColors';
import { STAFF_LABEL, StaffRole } from '@/lib/members';

export interface MemberDraft { phone: string; membershipNo: string; note: string; isSubscriber: boolean }

type RoleSeg = 'NONE' | 'STAFF' | 'ADMIN';
const toSeg = (r: StaffRole): RoleSeg => (r === 'ADMIN' ? 'ADMIN' : r === 'STAFF' ? 'STAFF' : 'NONE');
const fromSeg = (s: RoleSeg): StaffRole => (s === 'NONE' ? null : s);
const ROLE_HINT: Record<RoleSeg, string> = {
  NONE: "Membre simple, pas d'accès au back-office",
  STAFF: 'Accès au back-office du club',
  ADMIN: 'Back-office + gestion du staff et des niveaux',
};

export function MemberPanel({ member, viewer, canManageStaff, isDesktop, error, onSave, onToggleBlocked, onSetRole, onSetCoach, onDelete, onClose }: {
  member: Member;
  viewer: { userId: string; role: 'OWNER' | 'ADMIN' | 'STAFF' } | null;
  canManageStaff: boolean;
  isDesktop: boolean;
  error: string | null;
  onSave: (draft: MemberDraft) => Promise<void>;
  onToggleBlocked: () => void;
  onSetRole: (role: StaffRole) => void;
  onSetCoach: (isCoach: boolean) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { th } = useTheme();
  const [draft, setDraft] = useState<MemberDraft>({ phone: '', membershipNo: '', note: '', isSubscriber: false });
  const [busy, setBusy] = useState(false);

  // Reset du brouillon quand on change de membre (le panneau est réutilisé en place).
  useEffect(() => {
    setDraft({ phone: member.phone ?? '', membershipNo: member.membershipNo ?? '', note: member.note ?? '', isSubscriber: member.isSubscriber });
  }, [member.userId, member.phone, member.membershipNo, member.note, member.isSubscriber]);

  const blocked = member.status === 'BLOCKED';
  const canEditRole = canManageStaff && viewer != null && member.staffRole !== 'OWNER' && member.userId !== viewer.userId;

  const input: CSSProperties = { border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 9, padding: '9px 10px', fontFamily: th.fontUI, fontSize: 14, width: '100%' };
  const label: CSSProperties = { fontFamily: th.fontUI, fontSize: 12, fontWeight: 700, color: th.textMute, textTransform: 'uppercase', letterSpacing: 0.3, display: 'block', marginBottom: 5 };
  const ghostBtn: CSSProperties = { border: `1px solid ${th.line}`, background: 'transparent', cursor: 'pointer', borderRadius: 10, padding: '9px 13px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.textMute };

  const save = async () => { setBusy(true); try { await onSave(draft); } finally { setBusy(false); } };

  const body = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header identité */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Avatar firstName={member.firstName} lastName={member.lastName} avatarUrl={member.avatarUrl ?? null} size={46} color={colorForSeed(member.userId)} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 19, color: th.text, lineHeight: 1.15 }}>{member.firstName} {member.lastName}</div>
          <div style={{ fontSize: 12.5, color: th.textMute, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{member.email}</div>
        </div>
        {!isDesktop && (
          <button onClick={onClose} aria-label="Fermer" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textMute, fontSize: 22, lineHeight: 1, padding: 4 }}>×</button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {member.hasActivePackage && <Chip tone="line">Carnet actif</Chip>}
        <Chip tone={blocked ? 'line' : 'accent'}>{blocked ? 'Bloqué' : 'Actif'}</Chip>
      </div>

      <Link href={`/admin/members/${member.userId}`} style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, color: th.accent, textDecoration: 'none' }}>
        Voir la fiche complète →
      </Link>

      {error && <div style={{ background: th.accent, color: th.onAccent, borderRadius: 10, padding: '9px 12px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600 }}>{error}</div>}

      {/* Rôle back-office + statut coach — visible pour un viewer OWNER/ADMIN uniquement */}
      {canManageStaff && viewer && (
        <div role="group" aria-label={`Rôle de ${member.firstName} ${member.lastName}`} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={label}>Rôle</span>
          {canEditRole ? (
            <>
              <Segmented<RoleSeg>
                value={toSeg(member.staffRole ?? null)}
                onChange={(seg) => onSetRole(fromSeg(seg))}
                options={[
                  { value: 'NONE', label: 'Membre' },
                  { value: 'STAFF', label: 'Staff' },
                  { value: 'ADMIN', label: 'Admin' },
                ]}
              />
              <span style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute }}>{ROLE_HINT[toSeg(member.staffRole ?? null)]}</span>
            </>
          ) : (
            <span style={{ fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, color: th.text }}>
              {member.staffRole ? STAFF_LABEL[member.staffRole] : 'Membre'}
            </span>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 14, color: th.text, marginTop: 4 }}>
            <input type="checkbox" checked={!!member.isCoach} onChange={(e) => onSetCoach(e.target.checked)} style={{ width: 18, height: 18, accentColor: th.accent, cursor: 'pointer' }} />
            Coach — anime des cours
          </label>
        </div>
      )}

      {/* Champs éditables */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div><span style={label}>Téléphone</span><input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} placeholder="—" style={input} /></div>
        <div><span style={label}>N° adhérent</span><input value={draft.membershipNo} onChange={(e) => setDraft({ ...draft, membershipNo: e.target.value })} placeholder="—" style={input} /></div>
        <div><span style={label}>Note</span><textarea value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="—" rows={2} style={{ ...input, resize: 'vertical' }} /></div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 14, color: th.text }}>
          <input type="checkbox" checked={draft.isSubscriber} onChange={(e) => setDraft({ ...draft, isSubscriber: e.target.checked })} style={{ width: 18, height: 18, accentColor: th.accent, cursor: 'pointer' }} />
          Abonné (fenêtre de réservation élargie)
        </label>
      </div>

      <button onClick={save} disabled={busy} style={{ border: 'none', cursor: busy ? 'default' : 'pointer', borderRadius: 11, padding: '11px', fontFamily: th.fontUI, fontSize: 14, fontWeight: 700, background: th.accent, color: th.onAccent, opacity: busy ? 0.5 : 1 }}>
        {busy ? 'Enregistrement…' : 'Enregistrer'}
      </button>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderTop: `1px solid ${th.line}`, paddingTop: 14 }}>
        <button onClick={onToggleBlocked} style={ghostBtn}>{blocked ? 'Débloquer' : 'Bloquer'}</button>
        <button onClick={onDelete} style={{ ...ghostBtn, color: '#ff7a4d', marginLeft: 'auto' }}>Supprimer le membre</button>
      </div>
    </div>
  );

  if (isDesktop) {
    return (
      <div style={{ flex: '0 0 360px', alignSelf: 'flex-start', position: 'sticky', top: 12, background: th.surface, borderRadius: 18, boxShadow: `inset 0 0 0 1px ${th.line}`, padding: 18 }}>
        {body}
      </div>
    );
  }
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 40, background: th.bg, overflowY: 'auto', padding: 18, animation: 'sp-sheet-in .25s ease' }}>
      {body}
    </div>
  );
}
```

- [ ] **Step 5: Add the Coach chip in `MemberRow.tsx`**

In `frontend/components/admin/members/MemberRow.tsx`, find (~line 72):

```tsx
          {m.watch && <span title="À surveiller" style={{ fontSize: 13 }}>👁</span>}
          {m.staffRole && <Chip tone="accent">{STAFF_LABEL[m.staffRole]}</Chip>}
```

Replace with:

```tsx
          {m.watch && <span title="À surveiller" style={{ fontSize: 13 }}>👁</span>}
          {m.staffRole && <Chip tone="accent">{STAFF_LABEL[m.staffRole]}</Chip>}
          {m.isCoach && <Chip tone="line">Coach</Chip>}
```

- [ ] **Step 6: Fix the `StaffRole` import in `page.tsx`**

Find (~line 16):

```ts
import { StaffRole } from '@/components/admin/StaffRoleMenu';
```

Delete this line entirely (the import moves into the existing `@/lib/members` import below).

Find (~line 22-24):

```ts
import {
  MemberSeg, MemberSort, filterMembers, segCounts, sortMembers, memberKpis, membersCsv,
} from '@/lib/members';
```

Replace with:

```ts
import {
  MemberSeg, MemberSort, StaffRole, filterMembers, segCounts, sortMembers, memberKpis, membersCsv,
} from '@/lib/members';
```

- [ ] **Step 7: Update the `MEMBER_IS_STAFF` error copy**

Find (~line 35):

```ts
  MEMBER_IS_STAFF:     'Ce membre a un rôle staff : retirez d\'abord son rôle (bouton « Rôle… ») avant de le supprimer.',
```

Replace with:

```ts
  MEMBER_IS_STAFF:     'Ce membre a un rôle staff : retirez d\'abord son rôle (bloc « Rôle ») avant de le supprimer.',
```

- [ ] **Step 8: Add the `setCoach` handler**

Find `setRole` (~line 177-182):

```ts
  const setRole = async (role: StaffRole) => {
    if (!token || !clubId || !selected) return;
    if ((selected.staffRole ?? null) === role) return;
    try { setError(null); await api.adminSetMemberStaffRole(clubId, selected.userId, role, token); await load(); }
    catch (e) { const msg = (e as Error).message; setError(STAFF_ERRORS[msg] ?? msg); }
  };
```

Add right after it:

```ts

  const setCoach = async (isCoach: boolean) => {
    if (!token || !clubId || !selected) return;
    try { setError(null); await api.adminSetMemberCoach(clubId, selected.userId, isCoach, token); await load(); }
    catch (e) { setError((e as Error).message); }
  };
```

- [ ] **Step 9: Pass `onSetCoach` to both `MemberPanel` call sites**

Find (~line 310-311, desktop panel):

```tsx
              <MemberPanel member={selected} viewer={viewer} canManageStaff={canManageStaff} isDesktop error={error}
                onSave={save} onToggleBlocked={toggleBlocked} onSetRole={setRole} onDelete={() => setConfirmRemove(selected)} onClose={() => setSelectedUserId(null)} />
```

Replace with:

```tsx
              <MemberPanel member={selected} viewer={viewer} canManageStaff={canManageStaff} isDesktop error={error}
                onSave={save} onToggleBlocked={toggleBlocked} onSetRole={setRole} onSetCoach={setCoach} onDelete={() => setConfirmRemove(selected)} onClose={() => setSelectedUserId(null)} />
```

Find (~line 318-319, mobile panel):

```tsx
        <MemberPanel member={selected} viewer={viewer} canManageStaff={canManageStaff} isDesktop={false} error={error}
          onSave={save} onToggleBlocked={toggleBlocked} onSetRole={setRole} onDelete={() => setConfirmRemove(selected)} onClose={() => setSelectedUserId(null)} />
```

Replace with:

```tsx
        <MemberPanel member={selected} viewer={viewer} canManageStaff={canManageStaff} isDesktop={false} error={error}
          onSave={save} onToggleBlocked={toggleBlocked} onSetRole={setRole} onSetCoach={setCoach} onDelete={() => setConfirmRemove(selected)} onClose={() => setSelectedUserId(null)} />
```

- [ ] **Step 10: Delete `StaffRoleMenu.tsx`**

Now that `page.tsx` no longer imports from it (Step 6), it's safe to delete:

```bash
rm frontend/components/admin/StaffRoleMenu.tsx
```

- [ ] **Step 11: Run the full members test surface to verify everything passes**

Run (from `frontend/`):
```bash
node node_modules/jest/bin/jest.js AdminMembersStaff.test.tsx AdminMembersFilters.test.tsx MemberRow.test.tsx members.test.ts
```
Expected: PASS (all four files — `AdminMembersStaff.test.tsx` and `MemberRow.test.tsx` exercise the new behavior end-to-end; `AdminMembersFilters.test.tsx`/`members.test.ts` confirm nothing else broke).

- [ ] **Step 12: Commit**

```bash
git add frontend/components/admin/members/MemberPanel.tsx frontend/components/admin/members/MemberRow.tsx frontend/app/admin/members/page.tsx frontend/__tests__/AdminMembersStaff.test.tsx frontend/__tests__/MemberRow.test.tsx
git rm frontend/components/admin/StaffRoleMenu.tsx
git commit -m "feat(members): visible Rôle block (Segmented) + Coach checkbox, drop popover"
```

---

### Task 11: Remove the `/admin/coaches` page and its nav entry

**Files:**
- Modify: `frontend/app/admin/layout.tsx`
- Delete: `frontend/app/admin/coaches/page.tsx`
- Delete: `frontend/__tests__/AdminCoaches.test.tsx`

- [ ] **Step 1: Remove the sidebar entry**

In `frontend/app/admin/layout.tsx`, find (~line 154-162):

```tsx
    { title: 'Animations & jeu', color: '#e6a93c', items: [
      { href: '/admin/tournaments', label: 'Tournois', icon: 'trophy' },
      { href: '/admin/events',      label: 'Events',   icon: 'bolt' },
      // Lien « Matchs » masqué quand le système de niveau est désactivé pour le club.
      ...(club.levelSystemEnabled === false
        ? []
        : [{ href: '/admin/matches', label: 'Matchs', icon: 'trophy' } as NavItem]),
      { href: '/admin/coaches',     label: 'Coachs',   icon: 'user' },
    ] },
```

Replace with:

```tsx
    { title: 'Animations & jeu', color: '#e6a93c', items: [
      { href: '/admin/tournaments', label: 'Tournois', icon: 'trophy' },
      { href: '/admin/events',      label: 'Events',   icon: 'bolt' },
      // Lien « Matchs » masqué quand le système de niveau est désactivé pour le club.
      ...(club.levelSystemEnabled === false
        ? []
        : [{ href: '/admin/matches', label: 'Matchs', icon: 'trophy' } as NavItem]),
    ] },
```

- [ ] **Step 2: Delete the page and its test**

```bash
rm frontend/app/admin/coaches/page.tsx
rm frontend/__tests__/AdminCoaches.test.tsx
```

- [ ] **Step 3: Run the layout test suite to verify nothing else references the removed entry**

Run (from `frontend/`): `node node_modules/jest/bin/jest.js AdminLayout.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/admin/layout.tsx
git rm frontend/app/admin/coaches/page.tsx frontend/__tests__/AdminCoaches.test.tsx
git commit -m "chore(admin): remove /admin/coaches page (coach status now lives on the member panel)"
```

---

### Task 12: Full verification pass

- [ ] **Step 1: Backend — full suite + type-check**

Run (from `backend/`):
```bash
node node_modules/jest/bin/jest.js
node node_modules/typescript/bin/tsc --noEmit
```
Expected: PASS, no type errors. Compare any failure against known pre-existing baselines (see memory `frontend-full-suite-bookingmodal-flake` equivalent notes) before treating it as caused by this work.

- [ ] **Step 2: Frontend — full suite + type-check**

Run (from `frontend/`):
```bash
node node_modules/jest/bin/jest.js
node node_modules/typescript/bin/tsc --noEmit
```
Expected: PASS, no type errors (in particular, no leftover reference to `CoachBody`, `adminCreateCoach`, `adminUpdateCoach`, `adminDeleteCoach`, or `StaffRoleMenu`).

- [ ] **Step 3: Manual check with `/verify` (optional but recommended)**

Start the dev stack and visually confirm on `/admin/members`:
- Opening a plain member's panel shows the "RÔLE" segmented (Membre/Staff/Admin) + hint + "Coach — anime des cours" checkbox.
- Opening the gérant's own panel or the viewer's own row shows a static role label instead of the segmented, with the Coach checkbox still active.
- Checking "Coach" on a member, then opening `/admin/planning` → "Nouvel événement" → "Cours encadré" shows that member in the coach picker.
- The sidebar no longer has a "Coachs" entry, and `/admin/coaches` 404s.

---

## Notes for the implementing agent

- Every additive migration in this codebase is applied in dev via `prisma db execute` (not `prisma migrate dev`, which would trigger a destructive reset against the shared dev DB drift) — see Task 1 Step 4.
- `coachDisplay()` is the single point of truth for "is this coach linked to a user account" — every future site that serializes a `Coach` row should route through it rather than reading `.name`/`.photoUrl` directly.
- Do not add a `MemberSeg` filter tab or a CSV column for "Coach" — out of scope per the design doc (YAGNI).
