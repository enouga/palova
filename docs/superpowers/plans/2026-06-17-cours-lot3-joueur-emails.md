# Cours Lot 3 — « Côté joueur + emails » Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre aux joueurs de s'auto-inscrire aux cours ouverts (`allowSelfEnroll`), les intégrer à `/events` (filtre « Cours » + fiche `/cours/[id]`), les afficher dans « Mes réservations »/Calendrier, et envoyer les emails (inscription/attente/promotion/désinscription) aux joueurs et aux organisateurs.

**Architecture:** Réutilise `LessonService` (Lot 2) : nouvelles méthodes joueur `enroll`/`cancelEnrollment` (gate `allowSelfEnroll`) + lectures publiques, en réutilisant `resolveContainer`/`lockContainer` tels quels. Nouveau routeur `/api/lessons` calqué sur `/api/events`. Emails via l'infra `notifications.ts` existante (ajout du type d'activité `lesson`). Front : lessons deviennent une 4e source d'`AgendaItem` sur `/events`, une fiche `/cours/[id]` calquée sur `/events/[id]`, et une entrée calendrier.

**Tech Stack:** Express 5 + Prisma 7 ; Next.js 16 / React 19 ; Jest (services mockés `jest-mock-extended`, routes supertest, helpers purs front).

Spec : `docs/superpowers/specs/2026-06-17-cours-recurrence-design.md` (Lot 3 = ligne 283‑284 + sections « Inscriptions », « Frontend côté joueur », « Notifications email »).

⚠️ **Dev parallèle** : garde-fous sous-agent — `git add` **uniquement les fichiers de la tâche**, jamais `-A` ; `git branch --show-current` avant chaque commit. Branche au moment de l'écriture : `feat/cours-lot1` (== origin/main `972edec`).

---

## Décisions de cadrage (à respecter)

- **Visibilité publique** : `listPublicByClubSlug` ne renvoie que les cours **ouverts** (`allowSelfEnroll === true`), **à venir** (reservation.startTime > now), reservation non CANCELLED. Les cours gérés 100 % staff (allowSelfEnroll false) n'apparaissent pas dans `/events`.
- **Mode SERIES** : chaque occurrence (Lesson) apparaît dans `/events` ; s'inscrire sur une occurrence inscrit au **niveau série** (`resolveContainer` gère déjà ça) → le joueur figure sur toutes les occurrences. Pour « Mes cours », une inscription série est **dépliée** en ses occurrences futures.
- **Désinscription** : autorisée tant que la séance n'est pas passée (`ENROLLMENT_LOCKED` si `reservation.startTime <= now`). Annuler une occurrence d'une inscription série la **désinscrit de la série** (cohérent avec l'admin remove — la série est le conteneur).
- **Emails** : best-effort `safeNotify` **après commit** (un échec SMTP n'annule jamais l'inscription), au joueur + aux organisateurs staff OWNER/ADMIN. Pas de nouvel email au changement (hors v1).

---

## File Structure

Backend :
- **Modify** `backend/src/services/lesson.service.ts` — méthodes joueur + lectures publiques + helper `loadLessonPublic` + `safeNotify`.
- **Create** `backend/src/routes/lessons.ts` — routeur public/joueur `/api/lessons`.
- **Modify** `backend/src/app.ts` — monter `/api/lessons`.
- **Modify** `backend/src/routes/clubs.ts` — `GET /:slug/lessons`.
- **Modify** `backend/src/routes/me.ts` — `GET /me/lessons`.
- **Modify** `backend/src/email/templates/emails.ts` — `ActivityType += 'lesson'`, branche `words()`.
- **Modify** `backend/src/email/notifications.ts` — `notifyLesson{Enrollment,Cancellation,Promotion}` + admin URL `/admin/lessons`.
- Tests : `lesson.service.test.ts` (ajouts), `backend/src/routes/__tests__/lessons.routes.test.ts`, ajouts `emails.test.ts`.

Frontend :
- **Modify** `frontend/lib/api.ts` — types + 6 méthodes lessons.
- **Modify** `frontend/lib/events.ts` — source `lesson` dans `AgendaItem`, filtre `cours`.
- **Modify** `frontend/app/events/page.tsx` — fetch + filtre Cours + carte.
- **Create** `frontend/app/cours/[id]/page.tsx` — fiche cours (calque `events/[id]`).
- **Modify** `frontend/lib/calendar.ts` — entrée `lesson`.
- **Modify** `frontend/app/me/reservations/page.tsx` — fetch `getMyLessons`.
- Tests : ajouts `frontend/__tests__/events.test.ts`, `frontend/__tests__/calendar.test.ts` (ou les fichiers existants équivalents).

Commandes : back `cd backend && npx jest <f>` / `npx tsc --noEmit` / `npm test` ; front idem dans `frontend`.

---

## Task 1: `LessonService` — méthodes joueur + lectures publiques

**Files:**
- Modify: `backend/src/services/lesson.service.ts`
- Test: `backend/src/services/__tests__/lesson.service.test.ts`

But : ajouter `enroll`, `cancelEnrollment` (gate `allowSelfEnroll` + lock past), `listParticipants(lessonId)` public (sans clubId), `getPublicLesson`, `listPublicByClubSlug`, `listUserEnrollments`. Réutiliser `resolveContainer`/`lockContainer`. Lire le fichier pour les noms exacts (`loadLesson(lessonId, clubId)` existe ; ajouter `loadLessonPublic(lessonId)`).

- [ ] **Step 1: Tests (rouge)** — ajouter à `lesson.service.test.ts` :

```ts
describe('LessonService.enroll (joueur)', () => {
  it('refuse si allowSelfEnroll=false → SELF_ENROLL_DISABLED', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue({ id: 'l1', clubId: 'club-demo', capacity: 2, allowSelfEnroll: false, seriesId: null, series: null, reservation: { startTime: new Date(Date.now() + 86400000) } } as any);
    await expect(lessonService.enroll('l1', 'u1')).rejects.toThrow('SELF_ENROLL_DISABLED');
  });

  it('inscrit CONFIRMED si ouvert et place libre', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue({ id: 'l1', clubId: 'club-demo', capacity: 2, allowSelfEnroll: true, seriesId: null, series: null, reservation: { startTime: new Date(Date.now() + 86400000) } } as any);
    prismaMock.clubMembership.findFirst.mockResolvedValue(null as any);
    prismaMock.lessonEnrollment.findUnique.mockResolvedValue(null);
    prismaMock.lessonEnrollment.count.mockResolvedValue(0);
    prismaMock.lessonEnrollment.create.mockResolvedValue({ id: 'e1', status: 'CONFIRMED' } as any);
    const r = await lessonService.enroll('l1', 'u1');
    expect(r.status).toBe('CONFIRMED');
  });
});

describe('LessonService.cancelEnrollment (joueur)', () => {
  it('refuse si la séance est passée → ENROLLMENT_LOCKED', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue({ id: 'l1', clubId: 'club-demo', capacity: 2, allowSelfEnroll: true, seriesId: null, series: null, reservation: { startTime: new Date(Date.now() - 86400000) } } as any);
    await expect(lessonService.cancelEnrollment('l1', 'u1')).rejects.toThrow('ENROLLMENT_LOCKED');
  });
});

describe('LessonService.listParticipants (public)', () => {
  it('renvoie le roster sans userId', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue({ id: 'l1', clubId: 'club-demo', capacity: 2, allowSelfEnroll: true, seriesId: null, series: null, reservation: { startTime: new Date() } } as any);
    prismaMock.lessonEnrollment.findMany.mockResolvedValue([
      { id: 'e1', status: 'CONFIRMED', createdAt: new Date(1), userId: 'u1', user: { firstName: 'A', lastName: 'B', avatarUrl: null } },
    ] as any);
    const list = await lessonService.listParticipants('l1');
    expect((list[0] as any).userId).toBeUndefined();
    expect(list[0].firstName).toBe('A');
  });
});
```
Run → FAIL.

- [ ] **Step 2: Implémenter dans `lesson.service.ts`**

Ajouter le loader public (les lectures incluent la réservation pour les dates/lock) :
```ts
private async loadLessonPublic(lessonId: string) {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    include: { series: true, reservation: { select: { startTime: true } } },
  });
  if (!lesson) throw new Error('LESSON_NOT_FOUND');
  return lesson;
}
```
`enroll` (réutilise la mécanique d'`adminEnrollStudent` mais sans clubId et avec le gate self-enroll) :
```ts
async enroll(lessonId: string, userId: string) {
  const lesson = await this.loadLessonPublic(lessonId);
  if (!lesson.allowSelfEnroll) throw new Error('SELF_ENROLL_DISABLED');
  const m = await prisma.clubMembership.findFirst({ where: { userId, clubId: lesson.clubId } });
  if (m?.status === 'BLOCKED') throw new Error('MEMBERSHIP_BLOCKED');
  const container = resolveContainer(lesson);
  return prisma.$transaction(async (tx) => {
    await this.lockContainer(tx, container);
    const existing = await tx.lessonEnrollment.findUnique({
      where: container.kind === 'series' ? { seriesId_userId: { seriesId: container.id, userId } } : { lessonId_userId: { lessonId: container.id, userId } },
    });
    if (existing && existing.status !== 'CANCELLED') throw new Error('ALREADY_ENROLLED');
    const confirmed = await tx.lessonEnrollment.count({ where: { ...container.where, status: 'CONFIRMED' } });
    const status = (container.capacity == null || confirmed < container.capacity) ? 'CONFIRMED' : 'WAITLISTED';
    if (existing) return tx.lessonEnrollment.update({ where: { id: existing.id }, data: { status, cancelledAt: null, createdAt: new Date() } });
    return tx.lessonEnrollment.create({ data: { ...container.enrollKey, userId, status } });
  }, SER);
}
```
⚠️ Adapter `container.where`/`container.enrollKey`/`container.kind`/`container.id`/`container.capacity` aux **vrais** champs renvoyés par `resolveContainer` dans le fichier (les lire). Réutiliser la constante d'options de transaction (`SER`) déjà définie.

`cancelEnrollment` (gate past + promotion auto via le même chemin qu'`adminRemoveStudent`) :
```ts
async cancelEnrollment(lessonId: string, userId: string) {
  const lesson = await this.loadLessonPublic(lessonId);
  if (lesson.reservation && lesson.reservation.startTime <= new Date()) throw new Error('ENROLLMENT_LOCKED');
  const container = resolveContainer(lesson);
  return prisma.$transaction(async (tx) => {
    await this.lockContainer(tx, container);
    const target = await tx.lessonEnrollment.findFirst({ where: { ...container.where, userId, status: { not: 'CANCELLED' } } });
    if (!target) throw new Error('ENROLLMENT_NOT_FOUND');
    await tx.lessonEnrollment.update({ where: { id: target.id }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
    let promotedEnrollmentId: string | null = null;
    if (target.status === 'CONFIRMED') {
      const next = await tx.lessonEnrollment.findFirst({ where: { ...container.where, status: 'WAITLISTED' }, orderBy: { createdAt: 'asc' } });
      if (next) { await tx.lessonEnrollment.update({ where: { id: next.id }, data: { status: 'CONFIRMED' } }); promotedEnrollmentId = next.id; }
    }
    return { cancelledEnrollmentId: target.id, promotedEnrollmentId };
  }, SER);
}
```

Public `listParticipants(lessonId)` — comme `listStudents` mais sans clubId :
```ts
async listParticipants(lessonId: string) {
  const lesson = await this.loadLessonPublic(lessonId);
  const container = resolveContainer(lesson);
  const rows = await prisma.lessonEnrollment.findMany({
    where: { ...container.where, status: { not: 'CANCELLED' } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, status: true, createdAt: true, userId: true, user: { select: { firstName: true, lastName: true, avatarUrl: true } } },
  });
  let wl = 0;
  return rows.map(({ userId: _u, user, ...r }) => ({ id: r.id, status: r.status, firstName: user.firstName, lastName: user.lastName, avatarUrl: user.avatarUrl, waitlistPosition: r.status === 'WAITLISTED' ? ++wl : null }));
}
```
(Si `listStudents` partage déjà ce mapping, extraire un helper privé `mapRoster(rows)` et l'appeler des deux côtés — DRY.)

`getPublicLesson`, `listPublicByClubSlug`, `listUserEnrollments` — voir Task 2 (les routes en ont besoin) ; implémentez-les ici avec ces formes :
```ts
private lessonInclude = {
  coach: { select: { name: true, photoUrl: true } },
  reservation: { select: { startTime: true, endTime: true, resource: { select: { name: true } } } },
  series: { select: { enrollmentMode: true, title: true } },
} as const;

private async withCounts(lesson: any) {
  const container = resolveContainer(lesson);
  const grouped = await prisma.lessonEnrollment.groupBy({ by: ['status'], where: container.where, _count: true });
  const confirmedCount = grouped.find((g) => g.status === 'CONFIRMED')?._count ?? 0;
  const waitlistCount = grouped.find((g) => g.status === 'WAITLISTED')?._count ?? 0;
  return { confirmedCount, waitlistCount };
}

async getPublicLesson(lessonId: string) {
  const lesson = await prisma.lesson.findUnique({ where: { id: lessonId }, include: { ...this.lessonInclude, series: true, club: { select: { slug: true, name: true, timezone: true } } } });
  if (!lesson) throw new Error('LESSON_NOT_FOUND');
  return { ...lesson, ...(await this.withCounts(lesson)) };
}

async listPublicByClubSlug(slug: string) {
  const lessons = await prisma.lesson.findMany({
    where: { allowSelfEnroll: true, club: { slug, status: 'ACTIVE' }, reservation: { status: { not: 'CANCELLED' }, startTime: { gt: new Date() } } },
    include: this.lessonInclude,
    orderBy: { reservation: { startTime: 'asc' } },
  });
  return Promise.all(lessons.map(async (l) => ({ ...l, ...(await this.withCounts(l)) })));
}

async listUserEnrollments(userId: string) {
  const rows = await prisma.lessonEnrollment.findMany({
    where: { userId, status: { not: 'CANCELLED' } },
    include: { lesson: { include: this.lessonInclude }, series: { include: { lessons: { where: { reservation: { startTime: { gt: new Date() }, status: { not: 'CANCELLED' } } }, include: this.lessonInclude } } } },
  });
  // déplie : lessonId set → 1 occurrence ; seriesId set → toutes les occurrences futures de la série
  const out: any[] = [];
  for (const r of rows) {
    if (r.lesson) out.push({ enrollmentId: r.id, status: r.status, lesson: r.lesson });
    else if (r.series) for (const occ of r.series.lessons) out.push({ enrollmentId: r.id, status: r.status, lesson: occ });
  }
  return out;
}
```
⚠️ Vérifier que `Club` a bien un champ `status` (ACTIVE) et le nom de relation `club` sur `Lesson` (ajoutée au Lot 2). Adapter `resolveContainer` si sa signature attend `series.enrollmentMode`/`series.capacity` (les `include` ci-dessus doivent fournir ces champs — pour `withCounts` la lesson doit inclure `series: { enrollmentMode, capacity }`; ajuster l'include si besoin).

- [ ] **Step 3: Run tests** → `cd "…/backend" && npx jest lesson.service.test.ts` → green. Step 4: `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**
```bash
cd "C:/Users/e.nougayrede/OneDrive - BAYARD PRESSE/IA/05_PERSO/RESERVE/palova"
git branch --show-current
git add backend/src/services/lesson.service.ts backend/src/services/__tests__/lesson.service.test.ts
git commit -m "feat(cours): LessonService méthodes joueur + lectures publiques (Lot 3)"
```

---

## Task 2: Routeur `/api/lessons` + `/api/clubs/:slug/lessons` + `/api/me/lessons`

**Files:**
- Create: `backend/src/routes/lessons.ts`
- Modify: `backend/src/app.ts`, `backend/src/routes/clubs.ts`, `backend/src/routes/me.ts`
- Test: `backend/src/routes/__tests__/lessons.routes.test.ts`

- [ ] **Step 1: Test (rouge)** — `lessons.routes.test.ts` (mirroir de `events` route test ; lire `backend/src/routes/__tests__/` pour le harnais supertest exact, JWT, app)

```ts
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';
const token = jwt.sign({ id: 'u1', email: 'a@b.fr' }, process.env.JWT_SECRET!);

describe('routes lessons joueur', () => {
  it('GET /api/lessons/:id → 200', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue({ id: 'l1', clubId: 'c', allowSelfEnroll: true, seriesId: null, series: null, capacity: 2, coach: { name: 'X', photoUrl: null }, reservation: { startTime: new Date(), endTime: new Date(), resource: { name: 'T1' } }, club: { slug: 's', name: 'N', timezone: 'Europe/Paris' } } as any);
    prismaMock.lessonEnrollment.groupBy.mockResolvedValue([] as any);
    const res = await request(app).get('/api/lessons/l1');
    expect(res.status).toBe(200);
  });

  it('POST /api/lessons/:id/enrollment refuse 403 si fermé', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue({ id: 'l1', clubId: 'c', allowSelfEnroll: false, seriesId: null, series: null, reservation: { startTime: new Date(Date.now() + 86400000) } } as any);
    const res = await request(app).post('/api/lessons/l1/enrollment').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('POST sans auth → 401', async () => {
    const res = await request(app).post('/api/lessons/l1/enrollment');
    expect(res.status).toBe(401);
  });
});
```
Run → FAIL.

- [ ] **Step 2: Créer `backend/src/routes/lessons.ts`** (calque `backend/src/routes/events.ts` — lire ce fichier pour le style exact : imports, `Router`, `authMiddleware`, `asString`, le mapping d'erreurs) :
```ts
import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth'; // adapter au vrai chemin/nom
import { lessonService } from '../services/lesson.service';
import { asString } from '../utils/...'; // si events.ts en utilise un

const ERROR_STATUS: Record<string, number> = {
  LESSON_NOT_FOUND: 404, SELF_ENROLL_DISABLED: 403, MEMBERSHIP_BLOCKED: 403,
  ALREADY_ENROLLED: 409, ENROLLMENT_NOT_FOUND: 404, ENROLLMENT_LOCKED: 409,
};
const router = Router();

router.get('/:id', async (req, res) => {
  try { res.json(await lessonService.getPublicLesson(asString(req.params.id))); }
  catch (e) { res.status(ERROR_STATUS[(e as Error).message] ?? 500).json({ error: (e as Error).message }); }
});
router.get('/:id/participants', async (req, res) => {
  try { res.json(await lessonService.listParticipants(asString(req.params.id))); }
  catch (e) { res.status(ERROR_STATUS[(e as Error).message] ?? 500).json({ error: (e as Error).message }); }
});
router.post('/:id/enrollment', authMiddleware, async (req: AuthRequest, res) => {
  try { res.status(201).json(await lessonService.enroll(asString(req.params.id), req.user!.id)); }
  catch (e) { res.status(ERROR_STATUS[(e as Error).message] ?? 500).json({ error: (e as Error).message }); }
});
router.delete('/:id/enrollment', authMiddleware, async (req: AuthRequest, res) => {
  try { res.json(await lessonService.cancelEnrollment(asString(req.params.id), req.user!.id)); }
  catch (e) { res.status(ERROR_STATUS[(e as Error).message] ?? 500).json({ error: (e as Error).message }); }
});
export default router;
```
⚠️ Copier les imports/erreur-handling EXACTS d'`events.ts` (il a peut-être un helper `handle`/`next`). Le 201/empty body : si `events.ts` renvoie autrement, s'aligner.

- [ ] **Step 3: Monter le routeur** dans `backend/src/app.ts` à côté de `app.use('/api/events', eventsRouter)` : `app.use('/api/lessons', lessonsRouter);` (importer).

- [ ] **Step 4: Routes publiques club + me**
Dans `backend/src/routes/clubs.ts`, près de `GET /:slug/events` :
```ts
router.get('/:slug/lessons', async (req, res, next) => {
  try { res.json(await lessonService.listPublicByClubSlug(asString(req.params.slug))); } catch (e) { next(e); }
});
```
(importer `lessonService` ; copier le style exact du voisin `events`, y compris next(e)/try-catch.)
Dans `backend/src/routes/me.ts`, près de `GET /events` :
```ts
router.get('/lessons', authMiddleware, async (req: AuthRequest, res, next) => {
  try { res.json(await lessonService.listUserEnrollments(req.user!.id)); } catch (e) { next(e); }
});
```

- [ ] **Step 5: Run** `cd "…/backend" && npx jest lessons.routes.test.ts` → green ; `npx tsc --noEmit` → clean ; `npm test` → vert.

- [ ] **Step 6: Commit**
```bash
git add backend/src/routes/lessons.ts backend/src/app.ts backend/src/routes/clubs.ts backend/src/routes/me.ts backend/src/routes/__tests__/lessons.routes.test.ts
git commit -m "feat(cours): routes joueur/public /api/lessons + clubs/me (Lot 3)"
```

---

## Task 3: Emails — type d'activité `lesson` + notifications + câblage

**Files:**
- Modify: `backend/src/email/templates/emails.ts`, `backend/src/email/notifications.ts`, `backend/src/services/lesson.service.ts`
- Test: `backend/src/email/__tests__/emails.test.ts`, ajouts `lesson.service.test.ts`

- [ ] **Step 1: Étendre `ActivityType`** (lire `emails.ts`) : `export type ActivityType = 'tournament' | 'event' | 'lesson';` et ajouter la branche `lesson` dans le helper `words()` (libellés FR — ex. `{ article: 'au cours', noun: 'le cours', voir: 'Voir le cours', gerer: 'Gérer le cours' }`, adapter aux clés réelles du helper). Ajouter un test dans `emails.test.ts` :
```ts
it('buildPlayerEmail gère activityType lesson', () => {
  const m = buildPlayerEmail({ firstName: 'A', action: 'confirmed', activityType: 'lesson', activityName: 'Cours collectif', clubName: 'Club', dateLabel: 'lun. 1 sept. 18:00', url: 'https://x', brand: {} as any });
  expect(m.subject).toContain('Cours collectif');
  expect(m.html).toContain('Cours collectif');
});
```

- [ ] **Step 2: `notifications.ts`** — ajouter (calque `notifyEventRegistration/Cancellation/Promotion`, lire le fichier) :
```ts
async function loadLessonEnrollment(enrollmentId: string) {
  return prisma.lessonEnrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      lesson: { include: { coach: { select: { name: true } }, reservation: { select: { startTime: true } }, club: { select: { name: true, slug: true, logoUrl: true, accentColor: true, timezone: true } } } },
      series: { include: { coach: { select: { name: true } }, club: { select: { name: true, slug: true, logoUrl: true, accentColor: true, timezone: true } } } },
      user: { select: { email: true, firstName: true, lastName: true } },
    },
  });
}
export async function notifyLessonEnrollment(enrollmentId: string): Promise<void> { /* charge, action 'confirmed'|'waitlisted' selon status, email joueur + organisateurs (clubId via lesson||series) */ }
export async function notifyLessonCancellation(enrollmentId: string): Promise<void> { /* action 'cancelled' */ }
export async function notifyLessonPromotion(enrollmentId: string): Promise<void> { /* action 'promoted' */ }
```
- L'URL joueur = `clubAppUrl(slug, '/cours/' + lessonId)` (ou `/events` si série) ; l'URL admin (`notifyOrganizers`) ajoute la 3e branche `'/admin/lessons'` (modifier la fonction `notifyOrganizers` dans le même fichier).
- Le club/coach/date viennent de `lesson` si présent sinon `series`. Le `dateLabel` = `frDateTime(reservation.startTime, timezone)` (helper existant dans `links.ts`).
- Les organisateurs = staff OWNER/ADMIN du club (réutiliser la requête `clubMember` existante de `notifyOrganizers`).

- [ ] **Step 3: Câbler dans `lesson.service.ts`** — ajouter un `safeNotify` privé (copier celui d'`event.service.ts`, qui est privé) puis, **après commit** :
  - `enroll` → `safeNotify(() => notifyLessonEnrollment(result.id))`
  - `cancelEnrollment` → `safeNotify(() => notifyLessonCancellation(cancelledEnrollmentId)); if (promotedEnrollmentId) safeNotify(() => notifyLessonPromotion(promotedEnrollmentId))`
  - `adminRemoveStudent` (Lot 2) → idem cancellation + promotion (ajout des notifications, comportement inchangé sinon)
  - `adminEnrollStudent` (Lot 2) → `safeNotify(() => notifyLessonEnrollment(result.id))`
  Test (dans `lesson.service.test.ts`) : mocker le module `notifications` (`jest.mock('../../email/notifications')`) et asserter que `notifyLessonEnrollment` est appelé avec le bon id après une inscription, et que l'**échec** d'email n'empêche pas l'inscription (le mock rejette → l'appel résout quand même).

- [ ] **Step 4: Run** `cd "…/backend" && npx jest emails.test.ts lesson.service.test.ts` → green ; `npx tsc --noEmit` ; `npm test` → vert.

- [ ] **Step 5: Commit**
```bash
git add backend/src/email/templates/emails.ts backend/src/email/notifications.ts backend/src/services/lesson.service.ts backend/src/email/__tests__/emails.test.ts backend/src/services/__tests__/lesson.service.test.ts
git commit -m "feat(cours): emails inscription/attente/promotion/désinscription (Lot 3)"
```

---

## Task 4: Frontend — client API lessons (joueur) + types

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Types** (mirroir `ClubEventDetail`/`MyEventRegistration`, lire `api.ts`) :
```ts
export interface LessonSummary {
  id: string; clubId: string; lessonKind: 'INDIVIDUAL' | 'COLLECTIVE'; allowSelfEnroll: boolean;
  capacity: number; confirmedCount: number; waitlistCount: number; seriesId: string | null;
  coach: { name: string; photoUrl: string | null };
  reservation: { startTime: string; endTime: string; resource: { name: string } };
  series?: { enrollmentMode: 'SERIES' | 'PER_SESSION'; title: string | null } | null;
}
export type LessonDetail = LessonSummary & { club: { slug: string; name: string; timezone: string } };
export interface LessonParticipant { id: string; status: string; firstName: string; lastName: string; avatarUrl: string | null; waitlistPosition: number | null }
export interface LessonEnrollmentRecord { id: string; status: string; lessonId: string | null; seriesId: string | null }
export interface MyLessonEnrollment { enrollmentId: string; status: string; lesson: LessonSummary }
```
- [ ] **Step 2: Méthodes** (mêmes conventions que les méthodes events lignes ~366‑378) :
```ts
getClubLessons: (slug: string) => request<LessonSummary[]>(`/api/clubs/${slug}/lessons`),
getLesson: (id: string) => request<LessonDetail>(`/api/lessons/${id}`),
getLessonParticipants: (id: string) => request<LessonParticipant[]>(`/api/lessons/${id}/participants`),
enrollLesson: (id: string, token: string) => request<LessonEnrollmentRecord>(`/api/lessons/${id}/enrollment`, { method: 'POST' }, token),
cancelLessonEnrollment: (id: string, token: string) => request<{ cancelledEnrollmentId: string; promotedEnrollmentId: string | null }>(`/api/lessons/${id}/enrollment`, { method: 'DELETE' }, token),
getMyLessons: (token: string) => request<MyLessonEnrollment[]>(`/api/me/lessons`, {}, token),
```
- [ ] **Step 3:** `cd "…/frontend" && npx tsc --noEmit` clean ; `npm test` vert (mocks de `lib/api` non cassés). 
- [ ] **Step 4: Commit**
```bash
git add frontend/lib/api.ts
git commit -m "feat(cours): client API joueur lessons + types (Lot 3)"
```

---

## Task 5: `/events` — lessons comme 4e source + filtre « Cours »

**Files:**
- Modify: `frontend/lib/events.ts`, `frontend/app/events/page.tsx`
- Test: `frontend/__tests__/events.test.ts`

- [ ] **Step 1: Tests helpers (rouge)** — ajouter à `events.test.ts` :
```ts
it('mergeAgenda inclut les cours', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const lessons = [{ id: 'l1', reservation: { startTime: '2026-02-01T17:00:00Z', endTime: '2026-02-01T18:00:00Z' }, lessonKind: 'COLLECTIVE' } as any];
  const merged = mergeAgenda([], [], lessons, now);
  expect(merged.some((i) => i.source === 'lesson')).toBe(true);
});
it('applyAgendaFilters filtre Cours', () => {
  const items = [{ source: 'lesson', startTime: 't', endTime: null, lesson: {} as any }];
  expect(applyAgendaFilters(items as any, { filter: 'cours' } as any).length).toBe(1);
});
```
(Adapter aux signatures réelles de `mergeAgenda`/`applyAgendaFilters`/`EventFilterState` — les lire.)

- [ ] **Step 2: Étendre `frontend/lib/events.ts`**
- `AgendaItem` += `| { source: 'lesson'; startTime: string; endTime: string | null; lesson: LessonSummary }`.
- `AgendaFilter` += `'cours'`.
- `mergeAgenda(tournaments, events, lessons, now)` : ajouter le mapping des lessons (startTime = `lesson.reservation.startTime`) filtrées à venir, puis tri ISO inchangé.
- `applyAgendaFilters` : `filter === 'cours'` ne garde que `source === 'lesson'` ; `filter === 'tout'` inclut les lessons. (Les facettes secondaires : Cours → optionnel `lessonKind` ; YAGNI si non demandé — au minimum gérer le filtre principal.)
- `FILTERS` (la const des onglets) : ajouter `{ key: 'cours', label: 'Cours' }`.

- [ ] **Step 3: `frontend/app/events/page.tsx`**
- Ajouter `const [lessons, setLessons] = useState<LessonSummary[]>([])` ; fetch `api.getClubLessons(club.slug).then(setLessons).catch(() => setLessons([]))`.
- Passer `lessons` à `mergeAgenda(...)`.
- Rendu carte : pour `source==='lesson'`, une `AgendaCard` (icône `graduation` ou `user`, accent `ACCENTS.blue`, tag `lessonKindLabel(lesson.lessonKind)` via `@/lib/lessons`, places `confirmedCount/capacity`, onClick → `router.push('/cours/' + lesson.id)`).

- [ ] **Step 4:** `npx jest __tests__/events.test.ts` green ; `npx tsc --noEmit` clean ; `npm test` vert.
- [ ] **Step 5: Commit**
```bash
git add frontend/lib/events.ts frontend/app/events/page.tsx frontend/__tests__/events.test.ts
git commit -m "feat(cours): cours dans /events (source + filtre Cours) (Lot 3)"
```

---

## Task 6: Fiche cours `frontend/app/cours/[id]/page.tsx`

**Files:**
- Create: `frontend/app/cours/[id]/page.tsx`

Calque **exact** de `frontend/app/events/[id]/page.tsx` (lire ce fichier en entier et l'adapter). Deltas :
- Fetch : `api.getLesson(id)`, `api.getLessonParticipants(id)`, et si `token` `api.getMyLessons(token)` → `myReg = list.find((x) => x.lesson.id === id)` (et pour le mode série, `x.lesson.seriesId === lesson.seriesId`).
- Hero/méta : titre = `series?.title ?? 'Cours'`, sous-titre coach (`lesson.coach.name`), date `frDateTime(reservation.startTime)`, terrain `reservation.resource.name`, jauge `confirmedCount/capacity`.
- CTA :
  - si `!lesson.allowSelfEnroll` → bloc info statique « Inscription gérée par le club » (pas de bouton).
  - sinon, non inscrit → bouton « S'inscrire » (ou « Rejoindre la liste d'attente » si complet) → `api.enrollLesson(id, token)` ; déjà inscrit → « Se désinscrire » → `api.cancelLessonEnrollment(id, token)` ; gérer les erreurs (`SELF_ENROLL_DISABLED`/`ENROLLMENT_LOCKED`/login requis) avec les libellés existants.
- Participants : réutiliser `ParticipantsGrid` (mêmes props que la fiche event) avec `participants` + `myRegId={myReg?.enrollmentId}`.
- Bouton retour → `/events`.

- [ ] **Step 1:** créer la page en adaptant `events/[id]/page.tsx`.
- [ ] **Step 2:** `cd "…/frontend" && npx tsc --noEmit` clean ; `npm test` vert.
- [ ] **Step 3: Commit**
```bash
git add frontend/app/cours/[id]/page.tsx
git commit -m "feat(cours): fiche joueur /cours/[id] (Lot 3)"
```

---

## Task 7: « Mes cours » dans Calendrier / Mes réservations

**Files:**
- Modify: `frontend/lib/calendar.ts`, `frontend/app/me/reservations/page.tsx`
- Test: `frontend/__tests__/calendar.test.ts` (ou le fichier de tests calendar existant)

- [ ] **Step 1: Tests (rouge)** — ajouter à `calendar.test.ts` un cas vérifiant qu'une inscription cours future produit une entrée `kind:'lesson'` au bon `dayKey` (adapter aux signatures réelles `buildCalendarEntries`/`buildAgendaList`).

- [ ] **Step 2: `frontend/lib/calendar.ts`**
- `CalendarEntry` += `| { kind: 'lesson'; id: string; dayKey: string; past: boolean; enrollment: MyLessonEnrollment }`.
- `AgendaListItem` += `| { kind: 'lesson'; id: string; start: string; past: boolean; enrollment: MyLessonEnrollment }`.
- `agendaKindMeta` : `case 'lesson': return { color: ACCENTS.blue, label: 'Cours' };`.
- `buildCalendarEntries(reservations, regs, events, lessons, now)` : ajouter une boucle lessons (clé jour = `enrollment.lesson.reservation.startTime`, single-day comme une réservation).
- `buildAgendaList(reservations, regs, events, lessons, now)` : ajouter les items `kind:'lesson'` (start = startTime), triés avec le reste.

- [ ] **Step 3: `frontend/app/me/reservations/page.tsx`**
- Ajouter `api.getMyLessons(t).catch(() => [])` au `Promise.all` ; état `[lessons, setLessons]` ; passer aux deux builders.
- Le panneau du jour / la liste : pour `kind:'lesson'`, libellé « Cours · [coach] · [terrain] » + lien « Voir » → `/cours/<lesson.id>`.

- [ ] **Step 4:** `npx jest __tests__/calendar.test.ts` green ; `npx tsc --noEmit` clean ; `npm test` vert.
- [ ] **Step 5: Commit**
```bash
git add frontend/lib/calendar.ts frontend/app/me/reservations/page.tsx frontend/__tests__/calendar.test.ts
git commit -m "feat(cours): Mes cours dans le calendrier / Mes réservations (Lot 3)"
```

---

## Vérification manuelle finale (Postgres up + migrations appliquées)

1. Staff : créer un cours collectif **ouvert à l'auto-inscription** (Lot 2 UI).
2. Joueur : `/events` → onglet **Cours** → la séance apparaît → fiche `/cours/[id]` → **S'inscrire** → reçoit l'email de confirmation ; au-delà de la capacité → **liste d'attente** + email d'attente.
3. Désinscription d'un confirmé → le 1er en attente est **promu** + reçoit l'email « une place s'est libérée ».
4. « Mes réservations » → onglet Calendrier : le cours apparaît (pastille bleue), lien vers la fiche.
5. Cours **non ouvert** (allowSelfEnroll false) → absent de `/events`, fiche montre « Inscription gérée par le club » sans bouton.
6. Série mode « À la série » : une inscription couvre toutes les occurrences futures (présentes dans « Mes cours »).

---

## Self-Review (couverture spec Lot 3)

- Auto-inscription joueur gated `allowSelfEnroll` + BLOCKED + lock past → Task 1. ✅
- Routes joueur/public `/api/lessons/*`, `/api/clubs/:slug/lessons`, `/api/me/lessons` → Task 2. ✅
- Emails inscription/attente/promotion/désinscription, joueur + organisateurs, best-effort après commit → Task 3. ✅
- Intégration `/events` (filtre Cours + carte) + fiche `/cours/[id]` → Tasks 5‑6. ✅
- « Mes cours » dans Calendrier/Mes réservations → Task 7. ✅
- Client API + types → Task 4. ✅
- Hors v1 (non inclus, conforme) : rappels avant échéance, file d'envoi, email changement, absence ponctuelle d'un élève série. ✅
- Pas de migration (tout réutilise les modèles Lot 2). ✅
