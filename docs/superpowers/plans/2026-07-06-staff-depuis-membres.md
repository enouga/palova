# Rôle staff depuis la page Membres — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à un OWNER/ADMIN de nommer un membre ADMIN ou STAFF (accès back-office) depuis le tableau de `/admin/members`, et de révoquer ce rôle.

**Architecture:** Aucune migration — la table `ClubMember` (rôles `OWNER/ADMIN/STAFF`) et le middleware `requireClubMember` existent déjà ; il manque la route et l'UI. Backend : `listMembers` enrichi d'un champ `staffRole`, nouveau `setMemberStaffRole` derrière `PATCH /members/:userId/staff-role` gardé `requireClubMember('ADMIN')`, et `removeMember` qui révoque le rôle staff non-OWNER. Frontend : badge Gérant/Admin/Staff + popover « Rôle… » dans le tableau des membres, gaté sur le rôle du viewer (via `getMyClubs`/`getMyProfile`).

**Tech Stack:** Express 5 + Prisma 7 (backend, tests Jest + supertest + `prismaMock`), Next.js 16 + React 19 (frontend, tests React Testing Library).

**Spec:** `docs/superpowers/specs/2026-07-06-staff-depuis-membres-design.md`

---

## Contexte d'exécution (à lire avant de commencer)

- **Shims npm cassés sur cette machine** : `npx jest` / `npx tsc` échouent. Lancer les binaires directement : `node node_modules/jest/bin/jest.js …` et `node node_modules/typescript/bin/tsc --noEmit`.
- **PowerShell : le cwd se réinitialise entre chaque commande.** Toujours préfixer par `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\backend;` (ou `\frontend;`) dans la même commande.
- **Ne PAS lancer la suite frontend complète** (flake BookingModal connu) : vérifier par suites ciblées + `tsc --noEmit`.
- **Commits** : le user édite parfois le repo en parallèle — avant chaque commit, vérifier `git branch --show-current` (attendu `main`) et ne stager QUE les fichiers du task (`git add <chemins explicites>`).
- **jest frontend ne type-check pas** (ts-jest isolatedModules) : le gate de types est `tsc --noEmit` (Task 7).

## Fichiers touchés

| Fichier | Rôle |
|---|---|
| `backend/src/services/club.service.ts` | `listMembers` (+`staffRole`), nouveau `setMemberStaffRole`, `removeMember` (révocation) |
| `backend/src/services/__tests__/club.service.test.ts` | tests des 3 changements service |
| `backend/src/routes/admin.ts` | route `PATCH /members/:userId/staff-role` + 2 codes `ERROR_STATUS` |
| `backend/src/routes/__tests__/admin.staff-role.routes.test.ts` | **créé** — tests de la route |
| `frontend/lib/api.ts` | `Member.staffRole` + `adminSetMemberStaffRole` |
| `frontend/components/admin/StaffRoleMenu.tsx` | **créé** — popover Aucun/Staff/Admin (pattern SportPicker) |
| `frontend/app/admin/members/page.tsx` | badge + bouton « Rôle… » + gating viewer |
| `frontend/__tests__/AdminMembersStaff.test.tsx` | **créé** — tests UI |
| `frontend/__tests__/AdminMembersNav.test.tsx` | mock api complété (nouveaux appels de la page) |
| `CLAUDE.md` | section de la feature |

---

### Task 1: Backend — `listMembers` expose `staffRole`

**Files:**
- Modify: `backend/src/services/club.service.ts:385-399` (méthode `listMembers`)
- Test: `backend/src/services/__tests__/club.service.test.ts`

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à la fin de `backend/src/services/__tests__/club.service.test.ts` :

```typescript
describe('ClubService — listMembers (rôle staff)', () => {
  let service: ClubService;
  beforeEach(() => { service = new ClubService(); });

  it('expose staffRole depuis club_members (null pour un membre simple), en 1 requête', async () => {
    prismaMock.clubMembership.findMany.mockResolvedValue([
      { id: 'm1', isSubscriber: false, membershipNo: null, status: 'ACTIVE', note: null, watch: false, createdAt: new Date('2026-01-01'),
        user: { id: 'u1', firstName: 'Olivia', lastName: 'Gerante', email: 'o@x.fr', phone: null } },
      { id: 'm2', isSubscriber: false, membershipNo: null, status: 'ACTIVE', note: null, watch: false, createdAt: new Date('2026-01-02'),
        user: { id: 'u2', firstName: 'Paul', lastName: 'Martin', email: 'p@x.fr', phone: null } },
    ] as any);
    prismaMock.clubMember.findMany.mockResolvedValue([{ userId: 'u1', role: 'OWNER' }] as any);

    const rows = await service.listMembers('club-demo');

    expect(rows[0].staffRole).toBe('OWNER');
    expect(rows[1].staffRole).toBeNull();
    // une seule requête staff pour tout le club (pas de N+1)
    expect(prismaMock.clubMember.findMany).toHaveBeenCalledWith({ where: { clubId: 'club-demo' }, select: { userId: true, role: true } });
  });
});
```

- [ ] **Step 2: Vérifier qu'il échoue**

Run: `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\backend; node node_modules/jest/bin/jest.js src/services/__tests__/club.service.test.ts -t "staffRole"`
Expected: FAIL — `expect(rows[0].staffRole).toBe('OWNER')` reçoit `undefined`.

- [ ] **Step 3: Implémenter**

Dans `backend/src/services/club.service.ts`, remplacer la méthode `listMembers` (actuellement lignes 385-399) par :

```typescript
  async listMembers(clubId: string) {
    const [members, staff] = await Promise.all([
      prisma.clubMembership.findMany({
        where: { clubId },
        orderBy: [{ user: { lastName: 'asc' } }, { user: { firstName: 'asc' } }],
        select: {
          id: true, isSubscriber: true, membershipNo: true, status: true, note: true, watch: true, createdAt: true,
          user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
        },
      }),
      // rôle back-office (table ClubMember) mappé par userId — une requête pour tout le club
      prisma.clubMember.findMany({ where: { clubId }, select: { userId: true, role: true } }),
    ]);
    const roleByUser = new Map(staff.map((s) => [s.userId, s.role]));
    return members.map((m) => ({
      id: m.id, userId: m.user.id,
      firstName: m.user.firstName, lastName: m.user.lastName, email: m.user.email, phone: m.user.phone,
      isSubscriber: m.isSubscriber, membershipNo: m.membershipNo, status: m.status, note: m.note, watch: m.watch, since: m.createdAt,
      staffRole: roleByUser.get(m.user.id) ?? null,
    }));
  }
```

- [ ] **Step 4: Vérifier que le test passe (et rien de cassé dans la suite)**

Run: `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\backend; node node_modules/jest/bin/jest.js src/services/__tests__/club.service.test.ts`
Expected: PASS (toute la suite du fichier).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/club.service.ts backend/src/services/__tests__/club.service.test.ts
git commit -m "feat(admin): listMembers expose le role staff (staffRole)"
```

---

### Task 2: Backend — `ClubService.setMemberStaffRole`

**Files:**
- Modify: `backend/src/services/club.service.ts` (nouvelle méthode, juste après `setMemberWatch`, ~ligne 406)
- Test: `backend/src/services/__tests__/club.service.test.ts`

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à la fin de `backend/src/services/__tests__/club.service.test.ts` :

```typescript
describe('ClubService — setMemberStaffRole', () => {
  let service: ClubService;
  beforeEach(() => {
    service = new ClubService();
    // Par défaut : la cible est dans le fichier-membres, sans rôle staff actuel.
    prismaMock.clubMembership.findUnique.mockResolvedValue({ id: 'mb1' } as any);
    prismaMock.clubMember.findUnique.mockResolvedValue(null as any);
    prismaMock.clubMember.upsert.mockResolvedValue({} as any);
    prismaMock.clubMember.deleteMany.mockResolvedValue({ count: 1 } as any);
  });

  it('promeut un membre en STAFF (upsert)', async () => {
    const r = await service.setMemberStaffRole('club-demo', 'actor', 'u9', 'STAFF');
    expect(r).toEqual({ userId: 'u9', staffRole: 'STAFF' });
    expect(prismaMock.clubMember.upsert).toHaveBeenCalledWith({
      where: { userId_clubId: { userId: 'u9', clubId: 'club-demo' } },
      update: { role: 'STAFF' },
      create: { userId: 'u9', clubId: 'club-demo', role: 'STAFF' },
    });
  });

  it('promeut un membre en ADMIN (upsert, y compris depuis STAFF)', async () => {
    prismaMock.clubMember.findUnique.mockResolvedValue({ role: 'STAFF' } as any);
    const r = await service.setMemberStaffRole('club-demo', 'actor', 'u9', 'ADMIN');
    expect(r).toEqual({ userId: 'u9', staffRole: 'ADMIN' });
    expect(prismaMock.clubMember.upsert).toHaveBeenCalledWith({
      where: { userId_clubId: { userId: 'u9', clubId: 'club-demo' } },
      update: { role: 'ADMIN' },
      create: { userId: 'u9', clubId: 'club-demo', role: 'ADMIN' },
    });
  });

  it('révoque (role null) via deleteMany non-OWNER — idempotent (0 ligne = OK)', async () => {
    prismaMock.clubMember.deleteMany.mockResolvedValue({ count: 0 } as any);
    const r = await service.setMemberStaffRole('club-demo', 'actor', 'u9', null);
    expect(r).toEqual({ userId: 'u9', staffRole: null });
    expect(prismaMock.clubMember.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u9', clubId: 'club-demo', role: { not: 'OWNER' } },
    });
    expect(prismaMock.clubMember.upsert).not.toHaveBeenCalled();
  });

  it('refuse un rôle invalide (VALIDATION_ERROR), y compris OWNER et undefined', async () => {
    await expect(service.setMemberStaffRole('club-demo', 'actor', 'u9', 'SUPER' as any)).rejects.toThrow('VALIDATION_ERROR');
    await expect(service.setMemberStaffRole('club-demo', 'actor', 'u9', 'OWNER' as any)).rejects.toThrow('VALIDATION_ERROR');
    await expect(service.setMemberStaffRole('club-demo', 'actor', 'u9', undefined as any)).rejects.toThrow('VALIDATION_ERROR');
  });

  it('refuse de modifier son propre rôle (CANNOT_CHANGE_SELF)', async () => {
    await expect(service.setMemberStaffRole('club-demo', 'u9', 'u9', 'ADMIN')).rejects.toThrow('CANNOT_CHANGE_SELF');
    expect(prismaMock.clubMember.upsert).not.toHaveBeenCalled();
  });

  it('refuse une cible hors fichier-membres (MEMBER_NOT_FOUND)', async () => {
    prismaMock.clubMembership.findUnique.mockResolvedValue(null as any);
    await expect(service.setMemberStaffRole('club-demo', 'actor', 'u9', 'STAFF')).rejects.toThrow('MEMBER_NOT_FOUND');
  });

  it('refuse de toucher un OWNER (CANNOT_CHANGE_OWNER)', async () => {
    prismaMock.clubMember.findUnique.mockResolvedValue({ role: 'OWNER' } as any);
    await expect(service.setMemberStaffRole('club-demo', 'actor', 'u9', 'STAFF')).rejects.toThrow('CANNOT_CHANGE_OWNER');
    expect(prismaMock.clubMember.upsert).not.toHaveBeenCalled();
    expect(prismaMock.clubMember.deleteMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\backend; node node_modules/jest/bin/jest.js src/services/__tests__/club.service.test.ts -t "setMemberStaffRole"`
Expected: FAIL — `service.setMemberStaffRole is not a function`.

- [ ] **Step 3: Implémenter**

Dans `backend/src/services/club.service.ts`, ajouter juste après la méthode `setMemberWatch` (après sa `}` de fermeture, ~ligne 406) :

```typescript
  /**
   * Rôle back-office d'un membre (table ClubMember). Attribuable : ADMIN | STAFF ;
   * null = révocation (idempotente). Le OWNER est intouchable, et on ne se modifie
   * jamais soi-même (évite de se retirer l'accès par accident).
   */
  async setMemberStaffRole(clubId: string, actorUserId: string, targetUserId: string, role: 'ADMIN' | 'STAFF' | null) {
    if (role !== null && role !== 'ADMIN' && role !== 'STAFF') throw new Error('VALIDATION_ERROR');
    if (targetUserId === actorUserId) throw new Error('CANNOT_CHANGE_SELF');
    const membership = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId: targetUserId, clubId } }, select: { id: true },
    });
    if (!membership) throw new Error('MEMBER_NOT_FOUND');
    const current = await prisma.clubMember.findUnique({
      where: { userId_clubId: { userId: targetUserId, clubId } }, select: { role: true },
    });
    if (current?.role === 'OWNER') throw new Error('CANNOT_CHANGE_OWNER');
    if (role === null) {
      // `not: 'OWNER'` = défense en profondeur derrière la garde ci-dessus
      await prisma.clubMember.deleteMany({ where: { userId: targetUserId, clubId, role: { not: 'OWNER' } } });
    } else {
      await prisma.clubMember.upsert({
        where: { userId_clubId: { userId: targetUserId, clubId } },
        update: { role },
        create: { userId: targetUserId, clubId, role },
      });
    }
    return { userId: targetUserId, staffRole: role };
  }
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\backend; node node_modules/jest/bin/jest.js src/services/__tests__/club.service.test.ts`
Expected: PASS (toute la suite du fichier).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/club.service.ts backend/src/services/__tests__/club.service.test.ts
git commit -m "feat(admin): ClubService.setMemberStaffRole (gardes owner/self)"
```

---

### Task 3: Backend — `removeMember` révoque le rôle staff non-OWNER

**Files:**
- Modify: `backend/src/services/club.service.ts:483-487` (méthode `removeMember`)
- Test: `backend/src/services/__tests__/club.service.test.ts`

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à la fin de `backend/src/services/__tests__/club.service.test.ts` :

```typescript
describe('ClubService — removeMember (révocation du rôle staff)', () => {
  it('supprime aussi la ligne ClubMember non-OWNER du user retiré', async () => {
    prismaMock.clubMembership.findUnique.mockResolvedValue({ clubId: 'club-demo', userId: 'u9' } as any);
    prismaMock.clubMembership.delete.mockResolvedValue({} as any);
    prismaMock.clubMember.deleteMany.mockResolvedValue({ count: 1 } as any);

    await new ClubService().removeMember('club-demo', 'mb1');

    expect(prismaMock.clubMember.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u9', clubId: 'club-demo', role: { not: 'OWNER' } },
    });
  });
});
```

- [ ] **Step 2: Vérifier qu'il échoue**

Run: `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\backend; node node_modules/jest/bin/jest.js src/services/__tests__/club.service.test.ts -t "removeMember"`
Expected: FAIL — `clubMember.deleteMany` jamais appelé.

- [ ] **Step 3: Implémenter**

Dans `backend/src/services/club.service.ts`, remplacer la méthode `removeMember` (lignes 483-487) :

```typescript
  async removeMember(clubId: string, membershipId: string) {
    const m = await prisma.clubMembership.findUnique({ where: { id: membershipId }, select: { clubId: true, userId: true } });
    if (!m || m.clubId !== clubId) throw new Error('MEMBER_NOT_FOUND');
    await prisma.clubMembership.delete({ where: { id: membershipId } });
    // Retiré du fichier-membres = plus d'accès au back-office (le rôle OWNER, lui, survit).
    await prisma.clubMember.deleteMany({ where: { userId: m.userId, clubId, role: { not: 'OWNER' } } });
  }
```

- [ ] **Step 4: Vérifier que le test passe**

Run: `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\backend; node node_modules/jest/bin/jest.js src/services/__tests__/club.service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/club.service.ts backend/src/services/__tests__/club.service.test.ts
git commit -m "fix(admin): retirer un membre revoque son role staff non-OWNER"
```

---

### Task 4: Backend — route `PATCH /members/:userId/staff-role`

**Files:**
- Modify: `backend/src/routes/admin.ts` (`ERROR_STATUS` ~ligne 62-114 + nouvelle route après `/members/:userId/watch`, ~ligne 884)
- Create: `backend/src/routes/__tests__/admin.staff-role.routes.test.ts`

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `backend/src/routes/__tests__/admin.staff-role.routes.test.ts` :

```typescript
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

// clubMember.findUnique sert au middleware (rôle de l'ACTEUR) ET au service (rôle de la CIBLE) :
// on répond par userId pour distinguer les deux.
const memberRoles = (roles: Record<string, 'OWNER' | 'ADMIN' | 'STAFF'>) =>
  prismaMock.clubMember.findUnique.mockImplementation(((args: any) => {
    const userId = args?.where?.userId_clubId?.userId as string;
    const role = roles[userId];
    return Promise.resolve(role ? { userId, clubId: 'club-demo', role } : null);
  }) as any);

beforeEach(() => {
  jest.clearAllMocks();
  memberRoles({ admin1: 'ADMIN' }); // acteur ADMIN, cible sans rôle staff
  prismaMock.clubMembership.findUnique.mockResolvedValue({ id: 'mb1' } as any); // cible dans le fichier
  prismaMock.clubMember.upsert.mockResolvedValue({} as any);
  prismaMock.clubMember.deleteMany.mockResolvedValue({ count: 1 } as any);
});

describe('PATCH /api/clubs/:clubId/admin/members/:userId/staff-role', () => {
  it('401 sans token', async () => {
    const res = await request(app).patch(`${base}/members/u9/staff-role`).send({ role: 'STAFF' });
    expect(res.status).toBe(401);
  });

  it('403 pour un viewer STAFF (route réservée ADMIN+)', async () => {
    memberRoles({ admin1: 'STAFF' });
    const res = await request(app).patch(`${base}/members/u9/staff-role`).set(auth).send({ role: 'STAFF' });
    expect(res.status).toBe(403);
  });

  it('200 : un ADMIN promeut un membre en STAFF', async () => {
    const res = await request(app).patch(`${base}/members/u9/staff-role`).set(auth).send({ role: 'STAFF' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId: 'u9', staffRole: 'STAFF' });
    expect(prismaMock.clubMember.upsert).toHaveBeenCalled();
  });

  it('200 : révocation avec role null (deleteMany non-OWNER)', async () => {
    memberRoles({ admin1: 'ADMIN', u9: 'STAFF' });
    const res = await request(app).patch(`${base}/members/u9/staff-role`).set(auth).send({ role: null });
    expect(res.status).toBe(200);
    expect(res.body.staffRole).toBeNull();
    expect(prismaMock.clubMember.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u9', clubId: 'club-demo', role: { not: 'OWNER' } },
    });
  });

  it('403 CANNOT_CHANGE_OWNER si la cible est le gérant', async () => {
    memberRoles({ admin1: 'ADMIN', u9: 'OWNER' });
    const res = await request(app).patch(`${base}/members/u9/staff-role`).set(auth).send({ role: 'STAFF' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('CANNOT_CHANGE_OWNER');
  });

  it('409 CANNOT_CHANGE_SELF sur sa propre ligne', async () => {
    const res = await request(app).patch(`${base}/members/admin1/staff-role`).set(auth).send({ role: null });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('CANNOT_CHANGE_SELF');
  });

  it('404 MEMBER_NOT_FOUND si la cible est hors fichier-membres', async () => {
    prismaMock.clubMembership.findUnique.mockResolvedValue(null as any);
    const res = await request(app).patch(`${base}/members/u9/staff-role`).set(auth).send({ role: 'ADMIN' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('MEMBER_NOT_FOUND');
  });

  it('400 VALIDATION_ERROR pour un rôle inconnu ou absent', async () => {
    const res = await request(app).patch(`${base}/members/u9/staff-role`).set(auth).send({ role: 'SUPER' });
    expect(res.status).toBe(400);
    const res2 = await request(app).patch(`${base}/members/u9/staff-role`).set(auth).send({});
    expect(res2.status).toBe(400);
  });
});
```

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\backend; node node_modules/jest/bin/jest.js src/routes/__tests__/admin.staff-role.routes.test.ts`
Expected: FAIL — la route n'existe pas → 404 sur les cas 200/403/409.

- [ ] **Step 3: Implémenter**

Dans `backend/src/routes/admin.ts` :

**(a)** Dans `ERROR_STATUS`, ajouter après `MEMBER_NOT_FOUND:      404,` :

```typescript
  CANNOT_CHANGE_OWNER:   403,
  CANNOT_CHANGE_SELF:    409,
```

**(b)** Après la route `PATCH /members/:userId/watch` (~ligne 884, après sa `});` de fermeture), ajouter :

```typescript
// Rôle back-office (staff) d'un membre — réservé OWNER/ADMIN (un STAFF ne gère pas ses pairs).
// body { role: 'ADMIN' | 'STAFF' | null } — null révoque ; `role` absent = 400 (pas de révocation implicite).
router.patch('/members/:userId/staff-role', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await clubService.setMemberStaffRole(req.membership!.clubId, req.user!.id, asString(req.params.userId), req.body?.role));
  } catch (e) { handleError(e, res, next); }
});
```

(Note : `req.body?.role` non normalisé exprès — `undefined` échoue la validation du service, seul `null` explicite révoque.)

- [ ] **Step 4: Vérifier que les tests passent**

Run: `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\backend; node node_modules/jest/bin/jest.js src/routes/__tests__/admin.staff-role.routes.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/admin.ts backend/src/routes/__tests__/admin.staff-role.routes.test.ts
git commit -m "feat(admin): route PATCH /members/:userId/staff-role (reservee ADMIN+)"
```

---

### Task 5: Frontend — `lib/api.ts` (type + méthode)

**Files:**
- Modify: `frontend/lib/api.ts` (interface `Member` ~ligne 1172 ; méthode près de `adminSetMemberWatch` ~ligne 488)

Pas de test dédié (types vérifiés par `tsc --noEmit` en Task 7, comportement couvert par les tests UI de Task 6).

- [ ] **Step 1: Enrichir l'interface `Member`**

Dans `frontend/lib/api.ts`, dans `export interface Member { … }` (~ligne 1172), ajouter après `watch?: boolean;` :

```typescript
  staffRole?: 'OWNER' | 'ADMIN' | 'STAFF' | null; // rôle back-office (table ClubMember), null = membre simple
```

- [ ] **Step 2: Ajouter la méthode**

Juste après `adminSetMemberWatch` (~ligne 489), ajouter :

```typescript
  adminSetMemberStaffRole: (clubId: string, userId: string, role: 'ADMIN' | 'STAFF' | null, token: string) =>
    request<{ userId: string; staffRole: 'ADMIN' | 'STAFF' | null }>(`/api/clubs/${clubId}/admin/members/${userId}/staff-role`, { method: 'PATCH', body: JSON.stringify({ role }) }, token),
```

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(front): api adminSetMemberStaffRole + Member.staffRole"
```

---

### Task 6: Frontend — badge + menu « Rôle… » dans la page Membres

**Files:**
- Create: `frontend/components/admin/StaffRoleMenu.tsx`
- Modify: `frontend/app/admin/members/page.tsx`
- Modify: `frontend/__tests__/AdminMembersNav.test.tsx` (mock api complété)
- Test: `frontend/__tests__/AdminMembersStaff.test.tsx` (créé)

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `frontend/__tests__/AdminMembersStaff.test.tsx` :

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
});

const mount = () => render(<ThemeProvider><AdminMembersPage /></ThemeProvider>);

it('affiche les badges Gérant/Admin (rien pour un membre simple)', async () => {
  mount();
  await screen.findByText('Paul Martin');
  expect(screen.getByText('Gérant')).toBeInTheDocument();
  expect(screen.getByText('Admin')).toBeInTheDocument();
  expect(screen.queryByText('Staff')).toBeNull();
});

it('viewer ADMIN : « Rôle… » présent sur un membre simple, absent sur le gérant et sur soi-même', async () => {
  mount();
  await screen.findByText('Paul Martin');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Rôle staff de Paul Martin' })).toBeInTheDocument());
  expect(screen.queryByRole('button', { name: 'Rôle staff de Olivia Gerante' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Rôle staff de Vera Moi' })).toBeNull();
});

it('viewer STAFF : badges visibles mais aucune action « Rôle… »', async () => {
  (api.getMyClubs as jest.Mock).mockResolvedValue([{ clubId: 'club-1', slug: 'c', name: 'Club', role: 'STAFF' }]);
  mount();
  await screen.findByText('Paul Martin');
  expect(screen.getByText('Gérant')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Rôle staff de/ })).toBeNull();
});

it('sélectionner « Staff » dans le menu → PATCH puis rechargement', async () => {
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Rôle staff de Paul Martin' }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: /^Staff/ }));
  await waitFor(() => expect(api.adminSetMemberStaffRole).toHaveBeenCalledWith('club-1', 'u-plain', 'STAFF', 'tok'));
  await waitFor(() => expect(api.adminGetMembers).toHaveBeenCalledTimes(2));
});
```

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend; node node_modules/jest/bin/jest.js __tests__/AdminMembersStaff.test.tsx`
Expected: FAIL — pas de badge « Gérant », pas de bouton « Rôle staff de … ».

- [ ] **Step 3: Créer le composant `StaffRoleMenu`**

Créer `frontend/components/admin/StaffRoleMenu.tsx` :

```tsx
'use client';
import { useEffect, useRef } from 'react';
import { useTheme } from '@/lib/ThemeProvider';

export type StaffRole = 'ADMIN' | 'STAFF' | null;

const OPTIONS: { value: StaffRole; label: string; hint: string }[] = [
  { value: null,    label: 'Aucun', hint: "Membre simple, pas d'accès au back-office" },
  { value: 'STAFF', label: 'Staff', hint: 'Accès au back-office du club' },
  { value: 'ADMIN', label: 'Admin', hint: 'Back-office + gestion du staff et des niveaux' },
];

// Petit menu contextuel de rôle staff (pattern SportPicker : clic extérieur / Échap ferment).
export function StaffRoleMenu({ current, onPick, onClose }: {
  current: StaffRole; onPick: (role: StaffRole) => void; onClose: () => void;
}) {
  const { th } = useTheme();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [onClose]);

  return (
    <div ref={ref} role="menu" aria-label="Rôle staff"
      style={{ position: 'absolute', top: '100%', right: 0, marginTop: 6, zIndex: 20, minWidth: 240, background: th.surface, border: `1px solid ${th.line}`, borderRadius: 13, boxShadow: th.shadow, padding: 6 }}>
      {OPTIONS.map((o) => {
        const on = current === o.value;
        return (
          <button key={o.label} type="button" role="menuitemradio" aria-checked={on} onClick={() => onPick(o.value)}
            style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, background: on ? `${th.accent}18` : 'none', border: 'none', cursor: 'pointer', padding: '8px 10px', borderRadius: 9, fontFamily: th.fontUI, textAlign: 'left' }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: th.text }}>{o.label}{on ? ' ✓' : ''}</span>
            <span style={{ fontSize: 12, color: th.textMute }}>{o.hint}</span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Câbler la page Membres**

Dans `frontend/app/admin/members/page.tsx` :

**(a)** Ajouter l'import :

```typescript
import { StaffRoleMenu, StaffRole } from '@/components/admin/StaffRoleMenu';
```

**(b)** Ajouter les constantes module-level (après `const norm = …`) :

```typescript
const STAFF_LABEL: Record<'OWNER' | 'ADMIN' | 'STAFF', string> = { OWNER: 'Gérant', ADMIN: 'Admin', STAFF: 'Staff' };
const STAFF_ERRORS: Record<string, string> = {
  CANNOT_CHANGE_OWNER: 'Le rôle du gérant ne peut pas être modifié.',
  CANNOT_CHANGE_SELF:  'Vous ne pouvez pas modifier votre propre rôle.',
};
```

**(c)** Ajouter l'état + le chargement du viewer (après les `useState` existants, avant `load`) :

```typescript
  // Gestion du staff : réservée aux viewers OWNER/ADMIN ; jamais sur sa propre ligne.
  const [viewer, setViewer] = useState<{ userId: string; role: 'OWNER' | 'ADMIN' | 'STAFF' } | null>(null);
  const [roleMenuFor, setRoleMenuFor] = useState<string | null>(null); // userId du menu ouvert

  useEffect(() => {
    if (!ready || !token || !clubId) return;
    Promise.all([api.getMyClubs(token), api.getMyProfile(token)])
      .then(([clubs, me]) => {
        const mine = clubs.find((c) => c.clubId === clubId);
        setViewer(mine ? { userId: me.id, role: mine.role } : null);
      })
      .catch(() => setViewer(null)); // échec = pas d'action staff (les badges restent)
  }, [ready, token, clubId]);

  const canManageStaff = viewer !== null && (viewer.role === 'OWNER' || viewer.role === 'ADMIN');
```

**(d)** Ajouter le handler (après `remove`) :

```typescript
  const setRole = async (m: Member, role: StaffRole) => {
    if (!token || !clubId) return;
    setRoleMenuFor(null);
    if ((m.staffRole ?? null) === role) return;
    try {
      setError(null);
      await api.adminSetMemberStaffRole(clubId, m.userId, role, token);
      await load();
    } catch (e) {
      const msg = (e as Error).message;
      setError(STAFF_ERRORS[msg] ?? msg);
    }
  };
```

**(e)** Badge dans la cellule nom — ligne du `<td>` cliquable, après `{m.watch ? … : null}` :

```tsx
                    {m.staffRole ? <span style={{ marginLeft: 8 }}><Chip tone="accent">{STAFF_LABEL[m.staffRole]}</Chip></span> : null}
```

**(f)** Bouton « Rôle… » dans la `div` d'actions, entre « Bloquer » et « Suppr. » :

```tsx
                      {canManageStaff && viewer && m.staffRole !== 'OWNER' && m.userId !== viewer.userId && (
                        <div style={{ position: 'relative', display: 'inline-block' }}>
                          <button
                            onClick={() => setRoleMenuFor(roleMenuFor === m.userId ? null : m.userId)}
                            aria-haspopup="menu" aria-expanded={roleMenuFor === m.userId}
                            aria-label={`Rôle staff de ${m.firstName} ${m.lastName}`}
                            style={{ border: `1px solid ${th.line}`, background: 'transparent', cursor: 'pointer', borderRadius: 9, padding: '6px 11px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.textMute }}
                          >Rôle…</button>
                          {roleMenuFor === m.userId && (
                            <StaffRoleMenu
                              current={(m.staffRole ?? null) as StaffRole}
                              onPick={(r) => setRole(m, r)}
                              onClose={() => setRoleMenuFor(null)}
                            />
                          )}
                        </div>
                      )}
```

- [ ] **Step 5: Compléter le mock de `AdminMembersNav.test.tsx`**

La page appelle désormais `getMyClubs`/`getMyProfile` au montage : sans ces mocks la suite existante casse (« not a function »). Dans `frontend/__tests__/AdminMembersNav.test.tsx`, dans le `jest.mock('../lib/api', …)`, ajouter après `adminGetMembers: …` :

```typescript
    getMyClubs: jest.fn().mockResolvedValue([]),
    getMyProfile: jest.fn().mockResolvedValue({ id: 'viewer' }),
    adminSetMemberStaffRole: jest.fn(),
```

- [ ] **Step 6: Vérifier que les tests passent**

Run: `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend; node node_modules/jest/bin/jest.js __tests__/AdminMembersStaff.test.tsx __tests__/AdminMembersNav.test.tsx`
Expected: PASS (les 2 suites).

- [ ] **Step 7: Commit**

```bash
git add frontend/components/admin/StaffRoleMenu.tsx frontend/app/admin/members/page.tsx frontend/__tests__/AdminMembersStaff.test.tsx frontend/__tests__/AdminMembersNav.test.tsx
git commit -m "feat(admin): badge + menu Role… staff dans la page Membres"
```

---

### Task 7: Vérifications finales + CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (nouvelle section feature)

- [ ] **Step 1: Suite backend complète**

Run: `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\backend; node node_modules/jest/bin/jest.js`
Expected: PASS (0 failure).

- [ ] **Step 2: Type-check frontend**

Run: `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend; node node_modules/typescript/bin/tsc --noEmit`
Expected: 0 erreur dans les fichiers touchés (`lib/api.ts`, `app/admin/members/page.tsx`, `components/admin/StaffRoleMenu.tsx`, `__tests__/AdminMembers*.tsx`). En cas d'erreurs pré-existantes ailleurs (WIP parallèle), les ignorer si elles ne concernent pas ces fichiers.

- [ ] **Step 3: Type-check backend**

Run: `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\backend; node node_modules/typescript/bin/tsc --noEmit`
Expected: 0 erreur.

- [ ] **Step 4: Documenter dans CLAUDE.md**

Ajouter dans `CLAUDE.md`, juste avant la section « ## À implémenter (pas encore fait) » :

```markdown
## Rôles staff depuis la page Membres (v1) ✅ implémenté

Un OWNER/ADMIN peut nommer un membre **ADMIN ou STAFF** (accès back-office, table `ClubMember` existante — **aucune migration**) depuis le tableau `/admin/members` : badge **Gérant/Admin/Staff** à côté du nom + bouton « Rôle… » ouvrant un popover (Aucun/Staff/Admin, `components/admin/StaffRoleMenu.tsx`, pattern SportPicker), masqué sur la ligne du gérant et sur sa propre ligne, rendu seulement si le viewer est OWNER/ADMIN (lu via `getMyClubs` + `getMyProfile`). Backend : `listMembers` expose `staffRole` (1 requête `clubMember.findMany`, pas de N+1), `ClubService.setMemberStaffRole` derrière **`PATCH /api/clubs/:clubId/admin/members/:userId/staff-role`** (`requireClubMember('ADMIN')`, body `{ role: 'ADMIN'|'STAFF'|null }`, null = révocation idempotente) — gardes `VALIDATION_ERROR` 400 / `CANNOT_CHANGE_SELF` 409 / `MEMBER_NOT_FOUND` 404 / `CANNOT_CHANGE_OWNER` 403 ; **`removeMember` révoque aussi le rôle staff non-OWNER** (un membre retiré du fichier ne garde pas l'accès back-office). Front : `Member.staffRole` + `api.adminSetMemberStaffRole`. Hors v1 : attribution/transfert OWNER, permissions fines par rôle, notification au promu. Spec & plan : `docs/superpowers/{specs,plans}/2026-07-06-staff-depuis-membres*`.
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md section roles staff depuis la page Membres"
```

---

## Self-review (fait à l'écriture du plan)

- **Couverture spec** : `staffRole` dans listMembers (T1), setMemberStaffRole + 4 gardes (T2), removeMember (T3), route + ERROR_STATUS (T4), api.ts (T5), badge + popover + gating viewer + messages d'erreur (T6), tests 3 couches (T1-T4, T6), CLAUDE.md (T7). ✔
- **Piège identifié** : `clubMember.findUnique` sert au middleware ET au service dans les tests de route → mock par `mockImplementation` sur le `userId` (T4). ✔
- **Piège identifié** : la page appelle 2 nouveaux endpoints → mise à jour du mock de `AdminMembersNav.test.tsx` obligatoire (T6 Step 5). ✔
- **Cohérence des types** : `StaffRole = 'ADMIN' | 'STAFF' | null` (composant) vs `Member.staffRole` qui peut aussi valoir `'OWNER'` — le cast en T6(f) est gardé par `m.staffRole !== 'OWNER'`. ✔
