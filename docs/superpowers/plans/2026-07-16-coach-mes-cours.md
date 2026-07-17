# Espace coach « Mes cours » — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner au coach connecté une page `/me/coaching` où il voit et gère (inscrire/retirer) les élèves de SES cours (à venir + passés), sans être STAFF.

**Architecture:** Le gate est la **propriété du cours** (ligne `Coach` active liée au `userId`, `lesson.coachId === coach.id`), pas un rôle. Le backend réutilise `LessonService` (cœur `adminEnrollStudent`/`adminRemoveStudent`, `resolveContainer`, `withCounts`) derrière des méthodes coach qui vérifient la propriété. Routes club-scopées `/api/clubs/:slug/me/coach*` dans `clubs.ts`. Front : page + carte de cours + entrée `ProfileMenu` gatée `isCoach`. Aucune migration.

**Tech Stack:** Express + Prisma (backend), Jest + supertest ; Next.js client components (frontend), Jest + RTL.

**Spec:** `docs/superpowers/specs/2026-07-16-coach-mes-cours-design.md`

**Conventions de test (mémoire) :**
- Backend : `cd C:/ProjetsIA/05_PERSO/RESERVE/palova/backend && node node_modules/jest/bin/jest.js <path>` (npx cassé).
- Frontend : `cd C:/ProjetsIA/05_PERSO/RESERVE/palova/frontend && node node_modules/jest/bin/jest.js <path>` + `node node_modules/typescript/bin/tsc --noEmit` comme gate de types séparé (jest ne type-check pas). Ignorer l'erreur pré-existante `MatchesFilterBar.test.tsx` (WIP amicale/compétitive d'Eric).
- ⚠️ Branche partagée `feat/annonces-drag-drop-kiosque` (WIP d'Eric en parallèle). Les commits sont gérés par l'orchestrateur, pas par les sous-agents.

---

## Task 1 : LessonService — méthodes coach + tests service

**Files:**
- Modify: `backend/src/services/lesson.service.ts`
- Test: `backend/src/services/__tests__/lesson.service.test.ts`

- [ ] **Step 1: Écrire les tests service (RED)**

Ajouter à la fin de `backend/src/services/__tests__/lesson.service.test.ts` (le fichier importe déjà `prismaMock` et `lessonService`/`LessonService` — réutiliser ses imports en tête ; si le singleton exporté est `lessonService`, l'utiliser) :

```typescript
describe('LessonService — espace coach', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('resolveCoach : renvoie {id} pour un coach actif, null sinon', async () => {
    prismaMock.coach.findFirst.mockResolvedValueOnce({ id: 'coach-1' } as any);
    expect(await lessonService.resolveCoach('club-1', 'u-coach')).toEqual({ id: 'coach-1' });
    prismaMock.coach.findFirst.mockResolvedValueOnce(null as any);
    expect(await lessonService.resolveCoach('club-1', 'u-x')).toBeNull();
  });

  it('listCoachLessons : ne renvoie que les cours du coach, roster avec téléphone, userId absent', async () => {
    prismaMock.lesson.findMany.mockResolvedValueOnce([{
      id: 'les-1', clubId: 'club-1', coachId: 'coach-1', lessonKind: 'GROUP', capacity: 4, seriesId: null,
      reservation: { startTime: new Date('2099-01-01T10:00:00Z'), endTime: new Date('2099-01-01T11:00:00Z'), resource: { name: 'Court 1', clubSport: { sport: { key: 'padel', name: 'Padel' } } } },
      series: null,
    }] as any);
    prismaMock.lessonEnrollment.findMany.mockResolvedValueOnce([
      { id: 'enr-1', status: 'CONFIRMED', userId: 'u-9', user: { firstName: 'Ana', lastName: 'B', avatarUrl: null, phone: '0611' } },
    ] as any);
    prismaMock.lessonEnrollment.groupBy.mockResolvedValueOnce([{ status: 'CONFIRMED', _count: 1 }] as any);

    const rows = await lessonService.listCoachLessons('club-1', 'coach-1', 'upcoming');
    expect(rows).toHaveLength(1);
    expect(rows[0].students[0]).toEqual({ id: 'enr-1', status: 'CONFIRMED', firstName: 'Ana', lastName: 'B', avatarUrl: null, phone: '0611', waitlistPosition: null });
    expect((rows[0].students[0] as any).userId).toBeUndefined();
    expect(rows[0].confirmedCount).toBe(1);
    // filtre : coachId passé au where
    const where = (prismaMock.lesson.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.coachId).toBe('coach-1');
    expect(where.reservation.startTime).toEqual({ gt: expect.any(Date) });
  });

  it('coachEnrollStudent : refuse un cours qui n\'est pas au coach (LESSON_NOT_YOURS)', async () => {
    prismaMock.lesson.findUnique.mockResolvedValueOnce({ clubId: 'club-1', coachId: 'autre-coach', reservation: { startTime: new Date('2099-01-01T10:00:00Z') } } as any);
    await expect(lessonService.coachEnrollStudent('club-1', 'coach-1', 'les-1', 'u-9')).rejects.toThrow('LESSON_NOT_YOURS');
  });

  it('coachEnrollStudent : refuse un cours introuvable / autre club (LESSON_NOT_FOUND)', async () => {
    prismaMock.lesson.findUnique.mockResolvedValueOnce(null as any);
    await expect(lessonService.coachEnrollStudent('club-1', 'coach-1', 'les-x', 'u-9')).rejects.toThrow('LESSON_NOT_FOUND');
  });

  it('coachEnrollStudent : refuse un cours passé (ENROLLMENT_LOCKED)', async () => {
    prismaMock.lesson.findUnique.mockResolvedValueOnce({ clubId: 'club-1', coachId: 'coach-1', reservation: { startTime: new Date('2000-01-01T10:00:00Z') } } as any);
    await expect(lessonService.coachEnrollStudent('club-1', 'coach-1', 'les-1', 'u-9')).rejects.toThrow('ENROLLMENT_LOCKED');
  });

  it('coachRemoveStudent : même garde de propriété (LESSON_NOT_YOURS)', async () => {
    prismaMock.lesson.findUnique.mockResolvedValueOnce({ clubId: 'club-1', coachId: 'autre-coach', reservation: { startTime: new Date('2099-01-01T10:00:00Z') } } as any);
    await expect(lessonService.coachRemoveStudent('club-1', 'coach-1', 'les-1', 'enr-1')).rejects.toThrow('LESSON_NOT_YOURS');
  });
});
```

- [ ] **Step 2: Lancer, vérifier RED**

Run: `cd C:/ProjetsIA/05_PERSO/RESERVE/palova/backend && node node_modules/jest/bin/jest.js src/services/__tests__/lesson.service.test.ts -t "espace coach"`
Expected: échec (`lessonService.resolveCoach is not a function`, etc.).

- [ ] **Step 3: Implémenter les méthodes coach (GREEN)**

Dans `backend/src/services/lesson.service.ts` :

(a) Après l'interface `StudentRow` (vers ligne 56), ajouter les types :
```typescript
export interface CoachStudentRow extends StudentRow {
  phone: string | null;
}

export interface CoachLessonRow {
  id: string;
  lessonKind: string;
  seriesId: string | null;
  reservation: { startTime: Date; endTime: Date; resource: { name: string } };
  sport: { key: string; name: string } | null;
  series: { title: string | null; enrollmentMode: EnrollmentMode | null } | null;
  capacity: number;
  confirmedCount: number;
  waitlistCount: number;
  students: CoachStudentRow[];
}
```

(b) À l'intérieur de la classe `LessonService` (n'importe où parmi les méthodes), ajouter :
```typescript
  /** Le coach actif lié à ce user dans ce club (null si aucun). Gate de l'espace coach. */
  async resolveCoach(clubId: string, userId: string): Promise<{ id: string } | null> {
    return prisma.coach.findFirst({ where: { clubId, userId, isActive: true }, select: { id: true } });
  }

  /** Mapping roster côté coach : ajoute le téléphone (userId jamais exposé). */
  private mapRosterForCoach(
    enrollments: Array<{
      id: string; status: string; userId: string;
      user: { firstName: string; lastName: string; avatarUrl: string | null; phone: string | null };
    }>,
  ): CoachStudentRow[] {
    let waitlistIdx = 0;
    return enrollments.map(({ userId: _userId, user, ...row }) => ({
      id: row.id,
      status: row.status,
      firstName: user.firstName,
      lastName: user.lastName,
      avatarUrl: user.avatarUrl,
      phone: user.phone,
      waitlistPosition: row.status === 'WAITLISTED' ? ++waitlistIdx : null,
    }));
  }

  /** Cours du coach (à venir = startTime>now asc ; passés = endTime<now desc, cap 30) + rosters. */
  async listCoachLessons(clubId: string, coachId: string, scope: 'upcoming' | 'past'): Promise<CoachLessonRow[]> {
    const now = new Date();
    const lessons = await prisma.lesson.findMany({
      where: {
        clubId,
        coachId,
        reservation: {
          status: { not: 'CANCELLED' },
          ...(scope === 'upcoming' ? { startTime: { gt: now } } : { endTime: { lt: now } }),
        },
      },
      include: {
        reservation: {
          select: {
            startTime: true,
            endTime: true,
            resource: { select: { name: true, clubSport: { select: { sport: { select: { key: true, name: true } } } } } },
          },
        },
        series: { select: { id: true, capacity: true, enrollmentMode: true, title: true } },
      },
      orderBy: { reservation: { startTime: scope === 'upcoming' ? 'asc' : 'desc' } },
      ...(scope === 'past' ? { take: 30 } : {}),
    });

    return Promise.all(
      lessons.map(async (lesson) => {
        const container = resolveContainer(lesson);
        const enrollments = await prisma.lessonEnrollment.findMany({
          where: { ...container.whereActive, status: { not: 'CANCELLED' } },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            status: true,
            userId: true,
            user: { select: { firstName: true, lastName: true, avatarUrl: true, phone: true } },
          },
        });
        const { confirmedCount, waitlistCount } = await this.withCounts(lesson);
        return {
          id: lesson.id,
          lessonKind: lesson.lessonKind,
          seriesId: lesson.seriesId,
          reservation: {
            startTime: lesson.reservation.startTime,
            endTime: lesson.reservation.endTime,
            resource: { name: lesson.reservation.resource.name },
          },
          sport: lesson.reservation.resource.clubSport?.sport ?? null,
          series: lesson.series ? { title: lesson.series.title, enrollmentMode: lesson.series.enrollmentMode } : null,
          capacity: lesson.capacity,
          confirmedCount,
          waitlistCount,
          students: this.mapRosterForCoach(enrollments),
        };
      }),
    );
  }

  /** Vérifie que le cours appartient bien au coach (et au club). LESSON_NOT_FOUND | LESSON_NOT_YOURS. */
  private async assertCoachOwnsLesson(lessonId: string, clubId: string, coachId: string) {
    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      select: { clubId: true, coachId: true, reservation: { select: { startTime: true } } },
    });
    if (!lesson || lesson.clubId !== clubId) throw new Error('LESSON_NOT_FOUND');
    if (lesson.coachId !== coachId) throw new Error('LESSON_NOT_YOURS');
    return lesson;
  }

  /** Inscription d'un élève par le coach (sur SON cours, non passé). Délègue au cœur admin. */
  async coachEnrollStudent(clubId: string, coachId: string, lessonId: string, targetUserId: string) {
    const lesson = await this.assertCoachOwnsLesson(lessonId, clubId, coachId);
    if (lesson.reservation.startTime <= new Date()) throw new Error('ENROLLMENT_LOCKED');
    return this.adminEnrollStudent(lessonId, targetUserId, clubId);
  }

  /** Retrait d'un élève par le coach (sur SON cours, non passé). Délègue au cœur admin. */
  async coachRemoveStudent(clubId: string, coachId: string, lessonId: string, enrollId: string) {
    const lesson = await this.assertCoachOwnsLesson(lessonId, clubId, coachId);
    if (lesson.reservation.startTime <= new Date()) throw new Error('ENROLLMENT_LOCKED');
    return this.adminRemoveStudent(lessonId, enrollId, clubId);
  }
```

Note : `resolveContainer` et `withCounts` sont déjà dans le module/la classe (helpers privés) et acceptent une lesson avec `{ id, capacity, seriesId, series: { id, capacity, enrollmentMode } }` — l'`include` ci-dessus fournit exactement ces champs (+ `title`, ignoré par eux). `EnrollmentMode` est déjà importé en tête du fichier.

- [ ] **Step 4: Vérifier GREEN**

Run: `cd C:/ProjetsIA/05_PERSO/RESERVE/palova/backend && node node_modules/jest/bin/jest.js src/services/__tests__/lesson.service.test.ts`
Expected: toute la suite verte (existants + nouveaux).
Type-check: `cd C:/ProjetsIA/05_PERSO/RESERVE/palova/backend && node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep "lesson.service" || echo "no lesson.service type errors"` → aucune ligne.

- [ ] **Step 5: Commit** (orchestrateur)

```bash
git add backend/src/services/lesson.service.ts backend/src/services/__tests__/lesson.service.test.ts
git commit -m "feat(coach): methodes LessonService espace coach (resolveCoach, listCoachLessons, enroll/remove ownership)"
```

---

## Task 2 : Routes coach dans clubs.ts + mapping d'erreur + test routes

**Files:**
- Modify: `backend/src/routes/clubs.ts` (ERROR_STATUS + 4 routes)
- Test: `backend/src/routes/__tests__/clubs.coach.routes.test.ts` (create)

- [ ] **Step 1: Écrire le test de routes (RED)**

Créer `backend/src/routes/__tests__/clubs.coach.routes.test.ts`. Copier le **bloc de mocks de scaffold** en tête de `clubs.match-alerts.routes.test.ts` (les `jest.mock` de `openMatch.service`, `openMatchChat.service`, `moderation.service` — nécessaires pour que `clubs.ts` s'importe proprement), puis ajouter les mocks ciblés :

```typescript
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';

// --- Scaffold : mocks des services à effets de bord au chargement de clubs.ts ---
// (copier VERBATIM les jest.mock de openMatch.service / openMatchChat.service / moderation.service
//  depuis clubs.match-alerts.routes.test.ts)

// --- Mock ciblé : lessonService (singleton importé par clubs.ts) ---
const resolveCoach = jest.fn(), listCoachLessons = jest.fn(), coachEnrollStudent = jest.fn(), coachRemoveStudent = jest.fn();
jest.mock('../../services/lesson.service', () => ({
  lessonService: { resolveCoach, listCoachLessons, coachEnrollStudent, coachRemoveStudent,
    listPublicByClubSlug: jest.fn().mockResolvedValue([]) },
}));

// --- Mock ciblé : ensureActiveMembership (résout le club + adhésion) ---
jest.mock('../../services/membership', () => ({
  ensureActiveMembership: jest.fn().mockResolvedValue({ id: 'club-1' }),
}));

import app from '../../app';

const SECRET = process.env.JWT_SECRET!;
if (!SECRET) throw new Error('JWT_SECRET manquant');
const token = jwt.sign({ id: 'u-coach', email: 'c@x.fr' }, SECRET, { expiresIn: '1h' });
const auth = { Authorization: `Bearer ${token}` };
const base = '/api/clubs/demo/me/coach';

beforeEach(() => { jest.clearAllMocks(); });

describe('Routes espace coach', () => {
  it('GET /me/coach → { isCoach:false } pour un non-coach (jamais 403)', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-1', status: 'ACTIVE' } as any);
    resolveCoach.mockResolvedValue(null);
    const res = await request(app).get(base).set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ isCoach: false });
  });

  it('GET /me/coach → { isCoach:true } pour un coach', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-1', status: 'ACTIVE' } as any);
    resolveCoach.mockResolvedValue({ id: 'coach-1' });
    const res = await request(app).get(base).set(auth);
    expect(res.body).toEqual({ isCoach: true });
  });

  it('GET /me/coach/lessons → 403 NOT_A_COACH pour un non-coach', async () => {
    resolveCoach.mockResolvedValue(null);
    const res = await request(app).get(`${base}/lessons?scope=upcoming`).set(auth);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('NOT_A_COACH');
  });

  it('GET /me/coach/lessons → 200 + liste pour un coach', async () => {
    resolveCoach.mockResolvedValue({ id: 'coach-1' });
    listCoachLessons.mockResolvedValue([{ id: 'les-1' }]);
    const res = await request(app).get(`${base}/lessons?scope=past`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'les-1' }]);
    expect(listCoachLessons).toHaveBeenCalledWith('club-1', 'coach-1', 'past');
  });

  it('POST students → 201 (délègue coachEnrollStudent)', async () => {
    resolveCoach.mockResolvedValue({ id: 'coach-1' });
    coachEnrollStudent.mockResolvedValue({ id: 'enr-1', status: 'CONFIRMED' });
    const res = await request(app).post(`${base}/lessons/les-1/students`).set(auth).send({ userId: 'u-9' });
    expect(res.status).toBe(201);
    expect(coachEnrollStudent).toHaveBeenCalledWith('club-1', 'coach-1', 'les-1', 'u-9');
  });

  it('POST students → 403 LESSON_NOT_YOURS remonté', async () => {
    resolveCoach.mockResolvedValue({ id: 'coach-1' });
    coachEnrollStudent.mockRejectedValue(new Error('LESSON_NOT_YOURS'));
    const res = await request(app).post(`${base}/lessons/les-1/students`).set(auth).send({ userId: 'u-9' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('LESSON_NOT_YOURS');
  });

  it('DELETE students → 200 (délègue coachRemoveStudent)', async () => {
    resolveCoach.mockResolvedValue({ id: 'coach-1' });
    coachRemoveStudent.mockResolvedValue({ cancelledEnrollmentId: 'enr-1', promotedEnrollmentId: null });
    const res = await request(app).delete(`${base}/lessons/les-1/students/enr-1`).set(auth);
    expect(res.status).toBe(200);
    expect(coachRemoveStudent).toHaveBeenCalledWith('club-1', 'coach-1', 'les-1', 'enr-1');
  });

  it('sans token → 401', async () => {
    const res = await request(app).get(`${base}/lessons`);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: RED**

Run: `cd C:/ProjetsIA/05_PERSO/RESERVE/palova/backend && node node_modules/jest/bin/jest.js src/routes/__tests__/clubs.coach.routes.test.ts`
Expected: échec (routes 404 → pas encore déclarées). Si l'import d'`app` échoue faute d'un mock de scaffold, ajouter le mock manquant (copier depuis clubs.match-alerts.routes.test.ts) — NE PAS improviser d'autres changements.

- [ ] **Step 3: Ajouter les codes d'erreur + les routes (GREEN)**

Dans `backend/src/routes/clubs.ts` :

(a) Dans l'objet `ERROR_STATUS` (vers ligne 62), ajouter ces entrées (certaines absentes) :
```typescript
  NOT_A_COACH:           403,
  LESSON_NOT_YOURS:      403,
  LESSON_NOT_FOUND:      404,
  ENROLLMENT_LOCKED:     409,
  ENROLLMENT_NOT_FOUND:  404,
  ALREADY_ENROLLED:      409,
```
(Ne pas dupliquer une clé déjà présente ; `MEMBERSHIP_BLOCKED`/`CLUB_NOT_FOUND`/`VALIDATION_ERROR` existent déjà.)

(b) Juste APRÈS la route publique `router.get('/:slug/lessons', …)` (vers ligne 269), ajouter les 4 routes coach. `authMiddleware`, `AuthRequest`, `prisma`, `ensureActiveMembership`, `lessonService`, `asString`, `handleError` sont déjà importés/définis dans le fichier :
```typescript
// --- Espace coach : le coach connecté voit et gère SES cours (gate = ligne Coach active, PAS un rôle) ---

// Signal léger pour l'entrée de menu (jamais 403 : ne bruite pas le menu).
router.get('/:slug/me/coach', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const club = await prisma.club.findUnique({ where: { slug: asString(req.params.slug) }, select: { id: true, status: true } });
    if (!club || club.status !== 'ACTIVE') return void res.json({ isCoach: false });
    const coach = await lessonService.resolveCoach(club.id, req.user!.id);
    res.json({ isCoach: coach != null });
  } catch (err) { handleError(err, res, next); }
});

// Cours du coach (?scope=upcoming|past). 403 NOT_A_COACH si pas de ligne coach active.
// ensureActiveMembership : le coach devient membre actif (idempotent) → le picker de membres marche.
router.get('/:slug/me/coach/lessons', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id: clubId } = await ensureActiveMembership(asString(req.params.slug), req.user!.id);
    const coach = await lessonService.resolveCoach(clubId, req.user!.id);
    if (!coach) throw new Error('NOT_A_COACH');
    const scope = asString(req.query.scope) === 'past' ? 'past' : 'upcoming';
    res.json(await lessonService.listCoachLessons(clubId, coach.id, scope));
  } catch (err) { handleError(err, res, next); }
});

// Inscription d'un élève par le coach (sur SON cours).
router.post('/:slug/me/coach/lessons/:lessonId/students', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id: clubId } = await ensureActiveMembership(asString(req.params.slug), req.user!.id);
    const coach = await lessonService.resolveCoach(clubId, req.user!.id);
    if (!coach) throw new Error('NOT_A_COACH');
    const userId = asString(req.body?.userId);
    if (!userId) throw new Error('VALIDATION_ERROR');
    res.status(201).json(await lessonService.coachEnrollStudent(clubId, coach.id, asString(req.params.lessonId), userId));
  } catch (err) { handleError(err, res, next); }
});

// Retrait d'un élève par le coach (sur SON cours).
router.delete('/:slug/me/coach/lessons/:lessonId/students/:enrollId', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id: clubId } = await ensureActiveMembership(asString(req.params.slug), req.user!.id);
    const coach = await lessonService.resolveCoach(clubId, req.user!.id);
    if (!coach) throw new Error('NOT_A_COACH');
    res.json(await lessonService.coachRemoveStudent(clubId, coach.id, asString(req.params.lessonId), asString(req.params.enrollId)));
  } catch (err) { handleError(err, res, next); }
});
```

- [ ] **Step 4: GREEN**

Run: `cd C:/ProjetsIA/05_PERSO/RESERVE/palova/backend && node node_modules/jest/bin/jest.js src/routes/__tests__/clubs.coach.routes.test.ts`
Expected: 8/8 verts.
Type-check: `cd C:/ProjetsIA/05_PERSO/RESERVE/palova/backend && node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep "routes/clubs" || echo "no clubs route type errors"` → aucune ligne.

- [ ] **Step 5: Commit** (orchestrateur)

```bash
git add backend/src/routes/clubs.ts backend/src/routes/__tests__/clubs.coach.routes.test.ts
git commit -m "feat(coach): routes /me/coach + /me/coach/lessons (+students) + mapping erreurs"
```

---

## Task 3 : Frontend — types + méthodes api

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Ajouter les types**

Dans `frontend/lib/api.ts`, ajouter (près des autres types de cours/lesson) :
```typescript
export interface CoachStudentRow {
  id: string;
  status: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  phone: string | null;
  waitlistPosition: number | null;
}

export interface CoachLessonRow {
  id: string;
  lessonKind: string;
  seriesId: string | null;
  reservation: { startTime: string; endTime: string; resource: { name: string } };
  sport: { key: string; name: string } | null;
  series: { title: string | null; enrollmentMode: string | null } | null;
  capacity: number;
  confirmedCount: number;
  waitlistCount: number;
  students: CoachStudentRow[];
}
```

- [ ] **Step 2: Ajouter les méthodes**

Dans l'objet `api` de `frontend/lib/api.ts`, ajouter (suivre la signature de `request` déjà utilisée dans le fichier : `request<T>(path, opts, token)`) :
```typescript
  getCoachStatus: (slug: string, token: string) =>
    request<{ isCoach: boolean }>(`/api/clubs/${slug}/me/coach`, {}, token),
  getCoachLessons: (slug: string, scope: 'upcoming' | 'past', token: string) =>
    request<CoachLessonRow[]>(`/api/clubs/${slug}/me/coach/lessons?scope=${scope}`, {}, token),
  coachEnrollStudent: (slug: string, lessonId: string, userId: string, token: string) =>
    request<{ id: string; status: string }>(`/api/clubs/${slug}/me/coach/lessons/${lessonId}/students`, { method: 'POST', body: JSON.stringify({ userId }) }, token),
  coachRemoveStudent: (slug: string, lessonId: string, enrollId: string, token: string) =>
    request<{ cancelledEnrollmentId: string; promotedEnrollmentId: string | null }>(`/api/clubs/${slug}/me/coach/lessons/${lessonId}/students/${enrollId}`, { method: 'DELETE' }, token),
```

- [ ] **Step 3: Vérifier les types**

Run: `cd C:/ProjetsIA/05_PERSO/RESERVE/palova/frontend && node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep "lib/api" || echo "no api type errors"`
Expected: aucune ligne.

- [ ] **Step 4: Commit** (orchestrateur)

```bash
git add frontend/lib/api.ts
git commit -m "feat(coach): types + methodes api espace coach"
```

---

## Task 4 : Frontend — composant CoachLessonCard

**Files:**
- Create: `frontend/components/coach/CoachLessonCard.tsx`
- Test: `frontend/__tests__/CoachLessonCard.test.tsx`

- [ ] **Step 1: Écrire le test (RED)**

Créer `frontend/__tests__/CoachLessonCard.test.tsx` :
```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { CoachLessonCard } from '../components/coach/CoachLessonCard';
import { ThemeProvider } from '../lib/ThemeProvider';
import type { CoachLessonRow } from '../lib/api';

const lesson: CoachLessonRow = {
  id: 'les-1', lessonKind: 'GROUP', seriesId: null,
  reservation: { startTime: '2099-01-01T10:00:00Z', endTime: '2099-01-01T11:00:00Z', resource: { name: 'Court 1' } },
  sport: { key: 'padel', name: 'Padel' },
  series: null, capacity: 4, confirmedCount: 1, waitlistCount: 0,
  students: [{ id: 'enr-1', status: 'CONFIRMED', firstName: 'Ana', lastName: 'B', avatarUrl: null, phone: '0611', waitlistPosition: null }],
};

const mount = (props: Partial<React.ComponentProps<typeof CoachLessonCard>> = {}) =>
  render(<ThemeProvider>
    <CoachLessonCard lesson={lesson} tz="Europe/Paris" editable onAddStudent={jest.fn()} onRemoveStudent={jest.fn()} {...props} />
  </ThemeProvider>);

it('affiche le terrain, l\'élève et son téléphone', () => {
  mount();
  expect(screen.getByText('Court 1')).toBeInTheDocument();
  expect(screen.getByText(/Ana B/)).toBeInTheDocument();
  expect(screen.getByText('0611')).toBeInTheDocument();
});

it('cours éditable (à venir) : bouton Ajouter + retrait par élève', () => {
  const onAdd = jest.fn(); const onRemove = jest.fn();
  mount({ onAddStudent: onAdd, onRemoveStudent: onRemove });
  fireEvent.click(screen.getByRole('button', { name: /Ajouter un élève/i }));
  expect(onAdd).toHaveBeenCalledWith('les-1');
  fireEvent.click(screen.getByRole('button', { name: /Retirer Ana B/i }));
  expect(onRemove).toHaveBeenCalledWith('les-1', 'enr-1');
});

it('cours en lecture seule (passé) : pas de bouton Ajouter ni retrait', () => {
  mount({ editable: false });
  expect(screen.queryByRole('button', { name: /Ajouter un élève/i })).toBeNull();
  expect(screen.queryByRole('button', { name: /Retirer/i })).toBeNull();
});
```

- [ ] **Step 2: RED**

Run: `cd C:/ProjetsIA/05_PERSO/RESERVE/palova/frontend && node node_modules/jest/bin/jest.js __tests__/CoachLessonCard.test.tsx`
Expected: échec (composant inexistant).

- [ ] **Step 3: Implémenter le composant (GREEN)**

Créer `frontend/components/coach/CoachLessonCard.tsx`. Réutiliser `Avatar` (`@/components/ui/Avatar`), `colorForSeed` (`@/lib/playerColors`), le thème (`useTheme`). Props :
```typescript
'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';
import type { CoachLessonRow } from '@/lib/api';

function fmtDate(iso: string, tz: string) {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).format(new Date(iso));
}
function fmtHour(iso: string, tz: string) {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso)).replace(':', 'h');
}

export function CoachLessonCard({ lesson, tz, editable, onAddStudent, onRemoveStudent }: {
  lesson: CoachLessonRow;
  tz: string;
  editable: boolean;
  onAddStudent: (lessonId: string) => void;
  onRemoveStudent: (lessonId: string, enrollId: string) => void;
}) {
  const { th } = useTheme();
  return (
    <div style={{ background: th.surface, borderRadius: 16, boxShadow: `inset 0 0 0 1px ${th.line}`, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* En-tête : date/heure, terrain, sport, capacité */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 16, color: th.text }}>
          {fmtDate(lesson.reservation.startTime, tz)} · {fmtHour(lesson.reservation.startTime, tz)}–{fmtHour(lesson.reservation.endTime, tz)}
        </span>
        <span style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>{lesson.reservation.resource.name}</span>
        {lesson.series?.title && <span style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>· {lesson.series.title}</span>}
        <span style={{ marginLeft: 'auto', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.textMute }}>
          {lesson.confirmedCount}/{lesson.capacity}{lesson.waitlistCount > 0 ? ` · ${lesson.waitlistCount} en attente` : ''}
        </span>
      </div>

      {/* Roster */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {lesson.students.length === 0 && (
          <span style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textFaint }}>Aucun élève inscrit.</span>
        )}
        {lesson.students.map((s) => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Avatar firstName={s.firstName} lastName={s.lastName} avatarUrl={s.avatarUrl} size={32} color={colorForSeed(s.id)} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, color: th.text }}>
                {s.firstName} {s.lastName}
                {s.status === 'WAITLISTED' && <span style={{ marginLeft: 6, fontSize: 11, color: th.textMute }}>· liste d&apos;attente {s.waitlistPosition}</span>}
              </div>
              {s.phone && <a href={`tel:${s.phone}`} style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.accent, textDecoration: 'none' }}>{s.phone}</a>}
            </div>
            {editable && (
              <button aria-label={`Retirer ${s.firstName} ${s.lastName}`} onClick={() => onRemoveStudent(lesson.id, s.id)}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textMute, fontSize: 18, lineHeight: 1, padding: 4 }}>×</button>
            )}
          </div>
        ))}
      </div>

      {editable && (
        <button onClick={() => onAddStudent(lesson.id)}
          style={{ alignSelf: 'flex-start', border: `1px solid ${th.line}`, background: 'transparent', cursor: 'pointer', borderRadius: 10, padding: '8px 12px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.text }}>
          + Ajouter un élève
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: GREEN**

Run: `cd C:/ProjetsIA/05_PERSO/RESERVE/palova/frontend && node node_modules/jest/bin/jest.js __tests__/CoachLessonCard.test.tsx`
Expected: 3/3 verts.

- [ ] **Step 5: Commit** (orchestrateur)

```bash
git add frontend/components/coach/CoachLessonCard.tsx frontend/__tests__/CoachLessonCard.test.tsx
git commit -m "feat(coach): composant CoachLessonCard (roster + telephone + actions)"
```

---

## Task 5 : Frontend — page /me/coaching

**Files:**
- Create: `frontend/app/me/coaching/page.tsx`
- Test: `frontend/__tests__/MeCoaching.test.tsx`

- [ ] **Step 1: Écrire le test (RED)**

Créer `frontend/__tests__/MeCoaching.test.tsx` :
```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MeCoachingPage from '../app/me/coaching/page';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }), logout: jest.fn() }));
jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ slug: 'demo', club: { id: 'c1', name: 'Club', timezone: 'Europe/Paris' } }) }));
// ClubNav/ProfileMenu montés par la page : mocker leurs appels ou les composants.
jest.mock('../components/ClubNav', () => ({ ClubNav: () => null }));
jest.mock('../components/ProfileMenu', () => ({ ProfileMenu: () => null }));
jest.mock('../lib/api', () => ({
  api: {
    getCoachLessons: jest.fn(),
    coachEnrollStudent: jest.fn(),
    coachRemoveStudent: jest.fn(),
    searchClubMembers: jest.fn().mockResolvedValue([]),
  },
  assetUrl: (u: string | null) => u,
}));
import { api } from '../lib/api';

const lesson = {
  id: 'les-1', lessonKind: 'GROUP', seriesId: null,
  reservation: { startTime: '2099-01-01T10:00:00Z', endTime: '2099-01-01T11:00:00Z', resource: { name: 'Court 1' } },
  sport: { key: 'padel', name: 'Padel' }, series: null, capacity: 4, confirmedCount: 1, waitlistCount: 0,
  students: [{ id: 'enr-1', status: 'CONFIRMED', firstName: 'Ana', lastName: 'B', avatarUrl: null, phone: '0611', waitlistPosition: null }],
};

const mount = () => render(<ThemeProvider><MeCoachingPage /></ThemeProvider>);

beforeEach(() => {
  jest.clearAllMocks();
  (api.getCoachLessons as jest.Mock).mockResolvedValue([lesson]);
});

it('charge et affiche les cours à venir du coach', async () => {
  mount();
  await screen.findByText('Court 1');
  expect(api.getCoachLessons).toHaveBeenCalledWith('demo', 'upcoming', 'tok');
  expect(screen.getByText(/Ana B/)).toBeInTheDocument();
});

it('bascule sur « Passés » recharge en scope past', async () => {
  mount();
  await screen.findByText('Court 1');
  fireEvent.click(screen.getByRole('button', { name: /Passés/i }));
  await waitFor(() => expect(api.getCoachLessons).toHaveBeenCalledWith('demo', 'past', 'tok'));
});

it('403 NOT_A_COACH → message réservé aux coachs', async () => {
  (api.getCoachLessons as jest.Mock).mockRejectedValue(new Error('NOT_A_COACH'));
  mount();
  await screen.findByText(/réservé aux coachs/i);
});

it('retirer un élève appelle coachRemoveStudent puis recharge', async () => {
  (api.coachRemoveStudent as jest.Mock).mockResolvedValue({ cancelledEnrollmentId: 'enr-1', promotedEnrollmentId: null });
  mount();
  await screen.findByText('Court 1');
  fireEvent.click(screen.getByRole('button', { name: 'Retirer Ana B' })); // croix de la carte (aria-label exact)
  // Le ConfirmDialog s'ouvre : son bouton de confirmation a le nom exact « Retirer » (confirmLabel).
  fireEvent.click(screen.getByRole('button', { name: 'Retirer' }));
  await waitFor(() => expect(api.coachRemoveStudent).toHaveBeenCalledWith('demo', 'les-1', 'enr-1', 'tok'));
});
```
(Les deux boutons se distinguent par leur nom accessible EXACT : « Retirer Ana B » sur la carte, « Retirer » dans le dialog — pas de collision avec `getByRole` en `exact`.)

- [ ] **Step 2: RED**

Run: `cd C:/ProjetsIA/05_PERSO/RESERVE/palova/frontend && node node_modules/jest/bin/jest.js __tests__/MeCoaching.test.tsx`
Expected: échec (page inexistante).

- [ ] **Step 3: Implémenter la page (GREEN)**

Créer `frontend/app/me/coaching/page.tsx`. Structure calquée sur `/me/reservations` (Screen + ClubNav + ProfileMenu header ; `Segmented` À venir/Passés). Charge `api.getCoachLessons(slug, scope, token)`, gère `NOT_A_COACH`. Rend une `CoachLessonCard` par cours (`editable = scope==='upcoming'`). Pour « Ajouter un élève » : un picker de recherche membre réutilisant `api.searchClubMembers(slug, q, token)` (débounce simple) → `api.coachEnrollStudent` puis reload. Pour le retrait : `ConfirmDialog` (`@/components/ui/ConfirmDialog`) → `api.coachRemoveStudent` puis reload. Exemple minimal fonctionnel :
```typescript
'use client';
import { useState, useEffect, useCallback } from 'react';
import { api, CoachLessonRow } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { Screen } from '@/components/ui/Screen';
import { Segmented } from '@/components/ui/atoms';
import { ClubNav } from '@/components/ClubNav';
import { ProfileMenu } from '@/components/ProfileMenu';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { CoachLessonCard } from '@/components/coach/CoachLessonCard';
import { AddStudentPicker } from '@/components/coach/AddStudentPicker';

export default function MeCoachingPage() {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { slug, club } = useClub();
  const tz = club?.timezone ?? 'Europe/Paris';
  const [scope, setScope] = useState<'upcoming' | 'past'>('upcoming');
  const [lessons, setLessons] = useState<CoachLessonRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notCoach, setNotCoach] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addFor, setAddFor] = useState<string | null>(null);
  const [removeFor, setRemoveFor] = useState<{ lessonId: string; enrollId: string } | null>(null);

  const load = useCallback(async () => {
    if (!token || !slug) return;
    setLoading(true);
    try {
      setError(null); setNotCoach(false);
      setLessons(await api.getCoachLessons(slug, scope, token));
    } catch (e) {
      if ((e as Error).message === 'NOT_A_COACH') setNotCoach(true);
      else setError((e as Error).message);
    } finally { setLoading(false); }
  }, [token, slug, scope]);

  useEffect(() => { if (ready && token && slug) load(); }, [ready, token, slug, load]);

  const doRemove = async () => {
    if (!token || !slug || !removeFor) return;
    try { await api.coachRemoveStudent(slug, removeFor.lessonId, removeFor.enrollId, token); setRemoveFor(null); await load(); }
    catch (e) { setError((e as Error).message); setRemoveFor(null); }
  };

  return (
    <Screen>
      <ClubNav />
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '16px 16px 40px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 24, margin: 0, color: th.text }}>Mes cours</h1>
          <span style={{ marginLeft: 'auto' }}><ProfileMenu /></span>
        </div>

        {notCoach ? (
          <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute }}>Cet espace est réservé aux coachs du club.</p>
        ) : (
          <>
            <Segmented value={scope} onChange={(v) => setScope(v as 'upcoming' | 'past')}
              options={[{ value: 'upcoming', label: 'À venir' }, { value: 'past', label: 'Passés' }]} />
            {error && <div style={{ background: th.accent, color: th.onAccent, borderRadius: 10, padding: '9px 12px', fontFamily: th.fontUI, fontSize: 13 }}>{error}</div>}
            {loading ? (
              <span style={{ fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</span>
            ) : lessons.length === 0 ? (
              <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textFaint }}>{scope === 'upcoming' ? 'Aucun cours à venir.' : 'Aucun cours passé.'}</p>
            ) : (
              lessons.map((l) => (
                <CoachLessonCard key={l.id} lesson={l} tz={tz} editable={scope === 'upcoming'}
                  onAddStudent={(lessonId) => setAddFor(lessonId)}
                  onRemoveStudent={(lessonId, enrollId) => setRemoveFor({ lessonId, enrollId })} />
              ))
            )}
          </>
        )}
      </div>

      {addFor && slug && token && (
        <AddStudentPicker slug={slug} token={token}
          onClose={() => setAddFor(null)}
          onPick={async (userId) => { try { await api.coachEnrollStudent(slug, addFor, userId, token); setAddFor(null); await load(); } catch (e) { setError((e as Error).message); setAddFor(null); } }} />
      )}

      {removeFor && (
        <ConfirmDialog title="Retirer l'élève ?" message="Il sera désinscrit de ce cours." confirmLabel="Retirer"
          onConfirm={doRemove} onCancel={() => setRemoveFor(null)} />
      )}
    </Screen>
  );
}
```
Signatures vérifiées : `ConfirmDialog` est **rendu conditionnellement** (pas de prop `open`) et prend `{ title, message?, confirmLabel? (défaut 'Confirmer'), cancelLabel? (défaut 'Retour'), onConfirm, onCancel }` — l'usage ci-dessus (`confirmLabel="Retirer"`) est correct. `Segmented<T>` prend `{ options, value, onChange }`. `Screen` : s'inspirer de l'usage dans `app/me/reservations/page.tsx`. **`AddStudentPicker` est créé dans cette même tâche (Step 3b)** — l'importer directement.

- [ ] **Step 3b: Créer le picker d'ajout `AddStudentPicker`**

Créer `frontend/components/coach/AddStudentPicker.tsx` : overlay avec champ de recherche (débounce ~250 ms) → `api.searchClubMembers(slug, q, token)` (renvoie `{ id, firstName, lastName, ... }[]`), clic sur une ligne = `onPick(userId)`. S'inspirer de `components/messages/NewConversationPanel.tsx` (même pattern annuaire). Props : `{ slug: string; token: string; onClose: () => void; onPick: (userId: string) => void }`. (Pas de test dédié requis ; couvert indirectement — mais si le temps le permet, un test léger de sélection est bienvenu.)

- [ ] **Step 4: GREEN**

Run: `cd C:/ProjetsIA/05_PERSO/RESERVE/palova/frontend && node node_modules/jest/bin/jest.js __tests__/MeCoaching.test.tsx __tests__/CoachLessonCard.test.tsx`
Expected: verts.
Type-check: `cd C:/ProjetsIA/05_PERSO/RESERVE/palova/frontend && node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep -E "me/coaching|coach/" || echo "no coach type errors"` → aucune ligne.

- [ ] **Step 5: Commit** (orchestrateur)

```bash
git add frontend/app/me/coaching/page.tsx frontend/components/coach/AddStudentPicker.tsx frontend/__tests__/MeCoaching.test.tsx
git commit -m "feat(coach): page /me/coaching (a venir/passes, ajout/retrait eleve)"
```

---

## Task 6 : Frontend — entrée « Mes cours » dans ProfileMenu

**Files:**
- Modify: `frontend/components/ProfileMenu.tsx`
- Test: `frontend/__tests__/ProfileMenu.test.tsx`

- [ ] **Step 1: Écrire le test (RED)**

Dans `frontend/__tests__/ProfileMenu.test.tsx`, ajouter le mock `api.getCoachStatus` (au mock `api` existant) et deux cas. Repérer comment le test ouvre le menu (clic sur « Mon profil ») et mocke `getMyClubs`/`getMyClubMembership`. Ajouter :
```typescript
it('affiche « Mes cours » quand le viewer est coach', async () => {
  (api.getCoachStatus as jest.Mock).mockResolvedValue({ isCoach: true });
  // …monter le menu avec un slug (hôte club) et l'ouvrir (cf. tests existants)…
  // await ouverture ;
  expect(await screen.findByText('Mes cours')).toBeInTheDocument();
});

it('masque « Mes cours » quand le viewer n\'est pas coach', async () => {
  (api.getCoachStatus as jest.Mock).mockResolvedValue({ isCoach: false });
  // …ouvrir le menu…
  expect(screen.queryByText('Mes cours')).toBeNull();
});
```
(Adapter au harnais existant du fichier : ajouter `getCoachStatus: jest.fn().mockResolvedValue({ isCoach: false })` au mock `api`, et réutiliser la façon dont les autres tests ouvrent le menu et attendent les données paresseuses.)

- [ ] **Step 2: RED**

Run: `cd C:/ProjetsIA/05_PERSO/RESERVE/palova/frontend && node node_modules/jest/bin/jest.js __tests__/ProfileMenu.test.tsx -t "Mes cours"`
Expected: échec (entrée absente).

- [ ] **Step 3: Ajouter l'entrée (GREEN)**

Dans `frontend/components/ProfileMenu.tsx` :
- Ajouter un état : `const [isCoach, setIsCoach] = useState(false);`
- Dans le bloc de chargement paresseux `toggle()` (là où `if (slug) { … }`), ajouter :
```typescript
        api.getCoachStatus(slug, token).then((r) => setIsCoach(r.isCoach)).catch(() => {});
```
- Dans la liste des liens (près de « Mes amis »/« Messages », qui sont déjà `slug`-gated), ajouter :
```tsx
            {slug && isCoach && <MenuItem th={th} icon="whistle" label="Mes cours" onClick={() => go('/me/coaching')} />}
```
(Si l'icône `whistle` n'existe pas dans `IconName`, utiliser `ball` — vérifier `components/ui/Icon.tsx`.)

- [ ] **Step 4: GREEN**

Run: `cd C:/ProjetsIA/05_PERSO/RESERVE/palova/frontend && node node_modules/jest/bin/jest.js __tests__/ProfileMenu.test.tsx`
Expected: toute la suite verte.
Note : l'appel `getCoachStatus` est **paresseux (à l'ouverture du menu)** → les suites *real-mount* de `ClubNav` (`ClubReserve.*`, `OpenMatches`) qui n'ouvrent jamais le menu ne sont PAS affectées. Si l'une échoue malgré tout, ajouter `getCoachStatus: jest.fn().mockResolvedValue({ isCoach:false })` à son mock `api`.

- [ ] **Step 5: Commit** (orchestrateur)

```bash
git add frontend/components/ProfileMenu.tsx frontend/__tests__/ProfileMenu.test.tsx
git commit -m "feat(coach): entree Mes cours dans ProfileMenu (gatee isCoach)"
```

---

## Task 7 : Vérification finale intégrée

**Files:** (aucune modif — vérification seule)

- [ ] **Step 1: Suites backend**

Run: `cd C:/ProjetsIA/05_PERSO/RESERVE/palova/backend && node node_modules/jest/bin/jest.js src/services/__tests__/lesson.service.test.ts src/routes/__tests__/clubs.coach.routes.test.ts`
Expected: tout vert.

- [ ] **Step 2: Suites frontend**

Run: `cd C:/ProjetsIA/05_PERSO/RESERVE/palova/frontend && node node_modules/jest/bin/jest.js __tests__/CoachLessonCard.test.tsx __tests__/MeCoaching.test.tsx __tests__/ProfileMenu.test.tsx`
Expected: tout vert.

- [ ] **Step 3: Types (2 côtés, scopé)**

Run: `cd C:/ProjetsIA/05_PERSO/RESERVE/palova/backend && node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep -E "lesson.service|routes/clubs" || echo "backend OK"`
Run: `cd C:/ProjetsIA/05_PERSO/RESERVE/palova/frontend && node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep -E "me/coaching|coach/|lib/api|ProfileMenu" || echo "frontend OK"`
Expected: « backend OK » / « frontend OK » (ignorer l'erreur pré-existante `MatchesFilterBar.test.tsx`).

---

## Self-review checklist (fin d'exécution)

- [ ] Résolution coach + `GET /me/coach` boolean ✅ Tasks 1, 2
- [ ] `GET /me/coach/lessons?scope=` avec roster + téléphone, `userId` non exposé, `NOT_A_COACH` ✅ Tasks 1, 2
- [ ] enroll/remove délèguent au cœur admin + garde de propriété + cours passé verrouillé ✅ Tasks 1, 2
- [ ] `ensureActiveMembership` pour le picker ✅ Task 2
- [ ] Types + méthodes api ✅ Task 3
- [ ] Carte de cours (roster + tel + actions contextuelles à venir/passé) ✅ Task 4
- [ ] Page 2 sections + NOT_A_COACH + ajout/retrait ✅ Task 5
- [ ] Entrée ProfileMenu gatée isCoach (appel paresseux) ✅ Task 6
- [ ] Aucune migration, aucune garde de rôle back-office touchée ✅
- [ ] Hors v1 respecté : pas de pointage, pas de création/édition de cours par le coach ✅
