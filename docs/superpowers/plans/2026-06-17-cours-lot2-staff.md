# Cours Lot 2 — « Cours (staff) » Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gérer des cours individuels/collectifs depuis le back-office : modèles `Lesson` + `LessonEnrollment`, création d'un cours (ponctuel ou en série) avec coach/capacité/mode d'inscription, et gestion des élèves (ajout/retrait/liste d'attente/promotion) dans le planning. 100 % staff — l'auto-inscription joueur et les emails sont au Lot 3.

**Architecture:** Un cours = une `Reservation` `COACHING` (Lot 1) + un `Lesson` 1‑pour‑1 (snapshot des params). Les inscriptions `LessonEnrollment` sont **polymorphes** : conteneur = `Lesson` (mode PER_SESSION ou cours ponctuel) ou `ReservationSeries` (mode SERIES). `LessonService` calque la logique capacité/attente/promotion d'`EventService` (transaction Serializable + `SELECT … FOR UPDATE` sur le conteneur). Migrations purement additives.

**Tech Stack:** Express 5 + Prisma 7 (PrismaPg adapter) ; Next.js 16 / React 19 ; Jest (services mockés via `jest-mock-extended`, routes via supertest).

Spec : `docs/superpowers/specs/2026-06-17-cours-recurrence-design.md` (Lot 2 = lignes 280‑282).

⚠️ **Dev parallèle** : si la branche/le contexte change, garde-fous sous-agent — `git add` **uniquement les fichiers de la tâche**, jamais `-A` ; `git branch --show-current` avant chaque commit. Branche de travail courante au moment de l'écriture : `feat/cours-lot1` (== origin/main `48eb57d`).

---

## File Structure

Backend :
- **Modify** `backend/prisma/schema.prisma` — modèles `Lesson` + `LessonEnrollment` + back-relations.
- **Create** `backend/prisma/migrations/<ts>_add_lessons/migration.sql` — tables additives.
- **Modify** `backend/src/services/reservation.service.ts` — `adminCreateSeries` (params cours + création `Lesson`), `adminCreateReservation` (`lessonParams?`).
- **Create** `backend/src/services/lesson.service.ts` — `LessonService` (enroll/remove/promote/list polymorphe).
- **Modify** `backend/src/routes/admin.ts` — routes `/lessons/:id/students` + `ERROR_STATUS`.
- **Create/Modify** tests : `backend/src/services/__tests__/lesson.service.test.ts`, ajouts dans `reservation.series.test.ts`, `backend/src/routes/__tests__/admin.lessons.routes.test.ts`.

Frontend :
- **Modify** `frontend/lib/api.ts` — types + méthodes admin lessons, extension `CreateSeriesBody`.
- **Create** `frontend/lib/lessons.ts` (+ `frontend/__tests__/lessons.test.ts`) — helpers purs.
- **Modify** `frontend/app/admin/planning/page.tsx` — bloc « Cours » (création) + gestion élèves (détail).

Commandes :
- Backend tests : `cd "C:/Users/e.nougayrede/OneDrive - BAYARD PRESSE/IA/05_PERSO/RESERVE/palova/backend" && npx jest <file>`
- Prisma client : `cd "…/backend" && npx prisma generate`
- Frontend tests : `cd "…/frontend" && npx jest <file>` ; types `npx tsc --noEmit`

---

## Task 1: Schéma `Lesson` + `LessonEnrollment` + migration

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_add_lessons/migration.sql`

- [ ] **Step 1: Ajouter les modèles au schéma**

Dans `backend/prisma/schema.prisma`, ajouter (après `ReservationSeries`) :

```prisma
model Lesson {
  id              String     @id @default(cuid())
  reservationId   String     @unique @map("reservation_id")
  clubId          String     @map("club_id")
  coachId         String     @map("coach_id")
  capacity        Int
  lessonKind      LessonKind @map("lesson_kind")
  allowSelfEnroll Boolean    @default(false) @map("allow_self_enroll")
  seriesId        String?    @map("series_id")
  createdAt       DateTime   @default(now()) @map("created_at")
  updatedAt       DateTime   @updatedAt @map("updated_at")

  reservation Reservation        @relation(fields: [reservationId], references: [id], onDelete: Cascade)
  coach       Coach              @relation(fields: [coachId], references: [id], onDelete: Restrict)
  series      ReservationSeries? @relation(fields: [seriesId], references: [id], onDelete: SetNull)
  enrollments LessonEnrollment[]
  @@index([clubId])
  @@index([seriesId])
  @@map("lessons")
}

model LessonEnrollment {
  id          String             @id @default(cuid())
  lessonId    String?            @map("lesson_id")
  seriesId    String?            @map("series_id")
  userId      String             @map("user_id")
  status      RegistrationStatus @default(CONFIRMED)
  cancelledAt DateTime?          @map("cancelled_at")
  createdAt   DateTime           @default(now()) @map("created_at")
  updatedAt   DateTime           @updatedAt @map("updated_at")

  lesson Lesson?            @relation(fields: [lessonId], references: [id], onDelete: Cascade)
  series ReservationSeries? @relation(fields: [seriesId], references: [id], onDelete: Cascade)
  user   User               @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([lessonId, userId])
  @@unique([seriesId, userId])
  @@index([lessonId, status, createdAt])
  @@index([seriesId, status, createdAt])
  @@index([userId])
  @@map("lesson_enrollments")
}
```

Ajouter les **back-relations** sur les modèles existants (une ligne chacune, dans le bloc relations du modèle) :
- `Coach` : `lessons Lesson[]`
- `ReservationSeries` : `lessons Lesson[]` **et** `enrollments LessonEnrollment[]`
- `Reservation` : `lesson Lesson?`
- `User` : `lessonEnrollments LessonEnrollment[]`

- [ ] **Step 2: Créer la migration (additive) + regénérer le client**

Tenter d'abord la voie Prisma standard (si Postgres up) :
```bash
cd "C:/Users/e.nougayrede/OneDrive - BAYARD PRESSE/IA/05_PERSO/RESERVE/palova/backend"
npx prisma migrate dev --name add_lessons --create-only
```
Si la commande échoue (Postgres down / garde-fou `migrate reset` comme au Lot 1), créer **manuellement** le dossier `backend/prisma/migrations/<timestamp>_add_lessons/` (timestamp `AAAAMMJJHHMMSS`, postérieur au dernier `20260617140538_add_coaches_and_reservation_series`) avec `migration.sql` :

```sql
-- CreateTable
CREATE TABLE "lessons" (
    "id" TEXT NOT NULL,
    "reservation_id" TEXT NOT NULL,
    "club_id" TEXT NOT NULL,
    "coach_id" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "lesson_kind" "LessonKind" NOT NULL,
    "allow_self_enroll" BOOLEAN NOT NULL DEFAULT false,
    "series_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "lessons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_enrollments" (
    "id" TEXT NOT NULL,
    "lesson_id" TEXT,
    "series_id" TEXT,
    "user_id" TEXT NOT NULL,
    "status" "RegistrationStatus" NOT NULL DEFAULT 'CONFIRMED',
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "lesson_enrollments_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "lessons_reservation_id_key" ON "lessons"("reservation_id");
CREATE INDEX "lessons_club_id_idx" ON "lessons"("club_id");
CREATE INDEX "lessons_series_id_idx" ON "lessons"("series_id");
CREATE UNIQUE INDEX "lesson_enrollments_lesson_id_user_id_key" ON "lesson_enrollments"("lesson_id", "user_id");
CREATE UNIQUE INDEX "lesson_enrollments_series_id_user_id_key" ON "lesson_enrollments"("series_id", "user_id");
CREATE INDEX "lesson_enrollments_lesson_id_status_created_at_idx" ON "lesson_enrollments"("lesson_id", "status", "created_at");
CREATE INDEX "lesson_enrollments_series_id_status_created_at_idx" ON "lesson_enrollments"("series_id", "status", "created_at");
CREATE INDEX "lesson_enrollments_user_id_idx" ON "lesson_enrollments"("user_id");

-- Foreign keys
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "coaches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "reservation_series"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "lesson_enrollments" ADD CONSTRAINT "lesson_enrollments_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lesson_enrollments" ADD CONSTRAINT "lesson_enrollments_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "reservation_series"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lesson_enrollments" ADD CONSTRAINT "lesson_enrollments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```
⚠️ Avant d'écrire le SQL, **vérifier les noms de tables réels** via les directives `@@map` du schéma (`reservations`, `coaches`, `reservation_series`, et la table de `User` — confirmer `users`). Adapter le SQL si un `@@map` diffère.

Puis **toujours** regénérer le client (lit le schéma, pas besoin de DB) :
```bash
cd "…/backend" && npx prisma generate
```

- [ ] **Step 3: Vérifier la compilation des types**

Run: `cd "…/backend" && npx tsc --noEmit`
Expected: aucune erreur (les nouveaux modèles `prisma.lesson` / `prisma.lessonEnrollment` sont typés).

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/e.nougayrede/OneDrive - BAYARD PRESSE/IA/05_PERSO/RESERVE/palova"
git branch --show-current
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(cours): schéma Lesson + LessonEnrollment (Lot 2)"
```

---

## Task 2: `adminCreateSeries` — params cours + création des `Lesson`

**Files:**
- Modify: `backend/src/services/reservation.service.ts`
- Test: `backend/src/services/__tests__/reservation.series.test.ts`

Contexte : aujourd'hui `adminCreateSeries` crée la `ReservationSeries` **sans** les params cours et **aucun** `Lesson`. On ajoute un paramètre optionnel `lessonParams` ; quand `type === 'COACHING'` et `lessonParams` fourni, on persiste les colonnes cours sur la série et on crée un `Lesson` snapshot par occurrence créée.

- [ ] **Step 1: Écrire le test (rouge)**

Ajouter dans `reservation.series.test.ts` un bloc :

```ts
describe('adminCreateSeries — cours', () => {
  it('persiste les params cours sur la série et crée un Lesson par occurrence', async () => {
    prismaMock.resource.findUnique.mockResolvedValue({ id: 'r1', clubId: 'club-demo' } as any);
    prismaMock.reservationSeries.create.mockResolvedValue({ id: 's1' } as any);
    prismaMock.reservation.count.mockResolvedValue(0);
    prismaMock.reservation.create.mockResolvedValue({ id: 'res1', startTime: new Date('2026-09-01T16:00:00Z') } as any);
    prismaMock.lesson.create.mockResolvedValue({ id: 'l1' } as any);

    const res = await reservationService.adminCreateSeries({
      clubId: 'club-demo', resourceId: 'r1', type: 'COACHING', title: 'Cours',
      weekday: 2, startLocal: '18:00', durationMin: 60,
      startDate: '2026-09-01', endDate: '2026-09-15',
      lessonParams: { coachId: 'c1', capacity: 4, lessonKind: 'COLLECTIVE', allowSelfEnroll: false, enrollmentMode: 'SERIES' },
    });

    // série créée avec les colonnes cours
    expect(prismaMock.reservationSeries.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({
        coachId: 'c1', capacity: 4, lessonKind: 'COLLECTIVE', allowSelfEnroll: false, enrollmentMode: 'SERIES',
      }) }),
    );
    // un Lesson snapshot par occurrence créée
    expect(prismaMock.lesson.create).toHaveBeenCalledTimes(res.created);
    expect(prismaMock.lesson.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({
        reservationId: 'res1', clubId: 'club-demo', coachId: 'c1', capacity: 4,
        lessonKind: 'COLLECTIVE', allowSelfEnroll: false, seriesId: 's1',
      }) }),
    );
  });

  it('sans lessonParams : aucune création de Lesson (rétrocompat Lot 1)', async () => {
    prismaMock.resource.findUnique.mockResolvedValue({ id: 'r1', clubId: 'club-demo' } as any);
    prismaMock.reservationSeries.create.mockResolvedValue({ id: 's1' } as any);
    prismaMock.reservation.count.mockResolvedValue(0);
    prismaMock.reservation.create.mockResolvedValue({ id: 'res1', startTime: new Date() } as any);
    await reservationService.adminCreateSeries({
      clubId: 'club-demo', resourceId: 'r1', type: 'COURT',
      weekday: 2, startLocal: '18:00', durationMin: 60, startDate: '2026-09-01', endDate: '2026-09-08',
    });
    expect(prismaMock.lesson.create).not.toHaveBeenCalled();
  });
});
```
Run: `cd "…/backend" && npx jest reservation.series.test.ts` → FAIL (signature/champ `lessonParams` inexistant, `lesson.create` jamais appelé).

- [ ] **Step 2: Étendre la signature et la logique**

Dans `reservation.service.ts`, ajouter au type du paramètre de `adminCreateSeries` :
```ts
  lessonParams?: {
    coachId: string;
    capacity: number;
    lessonKind: 'INDIVIDUAL' | 'COLLECTIVE';
    allowSelfEnroll: boolean;
    enrollmentMode: 'SERIES' | 'PER_SESSION';
  };
```
Au début (avant la transaction), si `lessonParams` est fourni : valider `type === 'COACHING'` sinon `throw new Error('VALIDATION_ERROR')`, et `capacity >= 1` (sinon `VALIDATION_ERROR`). Optionnel : vérifier que le coach existe et appartient au club (`tx.coach.findFirst({ where: { id: coachId, clubId } })` → `COACH_NOT_FOUND`) — peut se faire dans la transaction.

Dans le `tx.reservationSeries.create`, étendre `data` avec les colonnes cours **quand `lessonParams` fourni** :
```ts
        ...(params.lessonParams ? {
          coachId: params.lessonParams.coachId,
          capacity: params.lessonParams.capacity,
          lessonKind: params.lessonParams.lessonKind,
          allowSelfEnroll: params.lessonParams.allowSelfEnroll,
          enrollmentMode: params.lessonParams.enrollmentMode,
        } : {}),
```
Dans la boucle des occurrences, **après** chaque `tx.reservation.create(...)` réussi (créneau non sauté) et **si `lessonParams`** :
```ts
        await tx.lesson.create({ data: {
          reservationId: created.id,
          clubId: params.clubId,
          coachId: params.lessonParams.coachId,
          capacity: params.lessonParams.capacity,
          lessonKind: params.lessonParams.lessonKind,
          allowSelfEnroll: params.lessonParams.allowSelfEnroll,
          seriesId: series.id,
        } });
```
(`created` = la valeur retournée par `tx.reservation.create`.)

- [ ] **Step 3: Run tests** → `cd "…/backend" && npx jest reservation.series.test.ts` → PASS (anciens + nouveaux).

- [ ] **Step 4: Commit**
```bash
cd "…/palova" && git branch --show-current
git add backend/src/services/reservation.service.ts backend/src/services/__tests__/reservation.series.test.ts
git commit -m "feat(cours): adminCreateSeries crée les Lesson snapshot (Lot 2)"
```

---

## Task 3: `adminCreateReservation` — cours ponctuel (`lessonParams`)

**Files:**
- Modify: `backend/src/services/reservation.service.ts`
- Test: `backend/src/services/__tests__/reservation.series.test.ts` (ou un fichier `reservation.lesson.test.ts`)

- [ ] **Step 1: Test (rouge)**

```ts
describe('adminCreateReservation — cours ponctuel', () => {
  it('crée un Lesson 1-pour-1 quand lessonParams fourni', async () => {
    prismaMock.resource.findUnique.mockResolvedValue({ id: 'r1', clubId: 'club-demo' } as any);
    prismaMock.reservation.count.mockResolvedValue(0);
    prismaMock.reservation.create.mockResolvedValue({ id: 'res9', startTime: new Date('2026-09-01T16:00:00Z') } as any);
    prismaMock.lesson.create.mockResolvedValue({ id: 'l9' } as any);

    await reservationService.adminCreateReservation({
      clubId: 'club-demo', resourceId: 'r1', date: '2026-09-01', startTime: '18:00', endTime: '19:00',
      type: 'COACHING', title: 'Cours perso',
      lessonParams: { coachId: 'c1', capacity: 1, lessonKind: 'INDIVIDUAL', allowSelfEnroll: false },
    });
    expect(prismaMock.lesson.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      reservationId: 'res9', clubId: 'club-demo', coachId: 'c1', capacity: 1, lessonKind: 'INDIVIDUAL', seriesId: null,
    }) }));
  });
});
```
Run → FAIL.

- [ ] **Step 2: Implémenter**

Ajouter `lessonParams?` (mêmes champs que Task 2 **sans** `enrollmentMode` — un cours ponctuel n'a pas de mode série) au type de `adminCreateReservation`. Dans la transaction, après le `tx.reservation.create`, si `lessonParams` : valider `type==='COACHING'` + `capacity>=1`, puis `tx.lesson.create({ data: { reservationId: created.id, clubId, coachId, capacity, lessonKind, allowSelfEnroll, seriesId: null } })`. Mettre la création de la réservation **et** du lesson dans la même transaction Serializable (déjà le cas pour la réservation).

- [ ] **Step 3: Run tests** → PASS.

- [ ] **Step 4: Commit**
```bash
git add backend/src/services/reservation.service.ts backend/src/services/__tests__/reservation.series.test.ts
git commit -m "feat(cours): adminCreateReservation crée un Lesson ponctuel (Lot 2)"
```

---

## Task 4: `LessonService` (enroll / remove / promote / list, polymorphe)

**Files:**
- Create: `backend/src/services/lesson.service.ts`
- Test: `backend/src/services/__tests__/lesson.service.test.ts`

Conteneur : pour une `Lesson` d'id `lessonId`, charger la lesson (+ `series`). Si `lesson.seriesId` **et** `series.enrollmentMode === 'SERIES'` → conteneur = série (`capacity = series.capacity`, inscriptions `where seriesId`). Sinon → conteneur = lesson (`capacity = lesson.capacity`, inscriptions `where lessonId`).

- [ ] **Step 1: Test (rouge)** — `backend/src/services/__tests__/lesson.service.test.ts`

```ts
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { lessonService } from '../lesson.service';

beforeEach(() => {
  prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
  prismaMock.$queryRaw.mockResolvedValue([] as any); // SELECT … FOR UPDATE
});

const lessonPerSession = { id: 'l1', clubId: 'club-demo', capacity: 2, seriesId: null, series: null };

describe('LessonService.adminEnrollStudent', () => {
  it('inscrit CONFIRMED tant que la capacité du conteneur (lesson) n’est pas atteinte', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue(lessonPerSession as any);
    prismaMock.lessonEnrollment.findUnique.mockResolvedValue(null);
    prismaMock.lessonEnrollment.count.mockResolvedValue(0);
    prismaMock.lessonEnrollment.create.mockResolvedValue({ id: 'e1', status: 'CONFIRMED' } as any);
    const r = await lessonService.adminEnrollStudent('l1', 'u1', 'club-demo');
    expect(r.status).toBe('CONFIRMED');
    expect(prismaMock.lessonEnrollment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ lessonId: 'l1', seriesId: null, userId: 'u1', status: 'CONFIRMED' }),
    }));
  });

  it('met en WAITLISTED quand la capacité est atteinte', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue(lessonPerSession as any);
    prismaMock.lessonEnrollment.findUnique.mockResolvedValue(null);
    prismaMock.lessonEnrollment.count.mockResolvedValue(2); // == capacity
    prismaMock.lessonEnrollment.create.mockResolvedValue({ id: 'e3', status: 'WAITLISTED' } as any);
    const r = await lessonService.adminEnrollStudent('l1', 'u3', 'club-demo');
    expect(r.status).toBe('WAITLISTED');
  });

  it('mode SERIES : conteneur = série (capacity série, where seriesId)', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue({ id: 'l1', clubId: 'club-demo', capacity: 99, seriesId: 's1', series: { id: 's1', capacity: 1, enrollmentMode: 'SERIES' } } as any);
    prismaMock.lessonEnrollment.findUnique.mockResolvedValue(null);
    prismaMock.lessonEnrollment.count.mockResolvedValue(0);
    prismaMock.lessonEnrollment.create.mockResolvedValue({ id: 'e4', status: 'CONFIRMED' } as any);
    await lessonService.adminEnrollStudent('l1', 'u4', 'club-demo');
    expect(prismaMock.lessonEnrollment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ lessonId: null, seriesId: 's1' }),
    }));
    expect(prismaMock.lessonEnrollment.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ seriesId: 's1', status: 'CONFIRMED' }),
    }));
  });

  it('refuse un club étranger (CLUB_MISMATCH)', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue({ ...lessonPerSession, clubId: 'autre' } as any);
    await expect(lessonService.adminEnrollStudent('l1', 'u1', 'club-demo')).rejects.toThrow('CLUB_MISMATCH');
  });

  it('lesson absente → LESSON_NOT_FOUND', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue(null);
    await expect(lessonService.adminEnrollStudent('x', 'u1', 'club-demo')).rejects.toThrow('LESSON_NOT_FOUND');
  });
});

describe('LessonService.adminRemoveStudent — promotion auto', () => {
  it('promeut le 1er WAITLISTED à l’annulation d’un CONFIRMED', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue(lessonPerSession as any);
    prismaMock.lessonEnrollment.findFirst
      .mockResolvedValueOnce({ id: 'e1', status: 'CONFIRMED', lessonId: 'l1', seriesId: null } as any) // l'inscription ciblée
      .mockResolvedValueOnce({ id: 'e2', status: 'WAITLISTED' } as any); // 1er en attente
    prismaMock.lessonEnrollment.update.mockResolvedValue({} as any);
    const r = await lessonService.adminRemoveStudent('l1', 'e1', 'club-demo');
    expect(r.promotedEnrollmentId).toBe('e2');
    expect(prismaMock.lessonEnrollment.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'e2' }, data: expect.objectContaining({ status: 'CONFIRMED' }) }));
  });
});

describe('LessonService.listStudents', () => {
  it('renvoie le roster sans userId ni email, avec waitlistPosition', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue(lessonPerSession as any);
    prismaMock.lessonEnrollment.findMany.mockResolvedValue([
      { id: 'e1', status: 'CONFIRMED', createdAt: new Date(1), userId: 'u1', user: { firstName: 'A', lastName: 'B', avatarUrl: null } },
      { id: 'e2', status: 'WAITLISTED', createdAt: new Date(2), userId: 'u2', user: { firstName: 'C', lastName: 'D', avatarUrl: null } },
    ] as any);
    const list = await lessonService.listStudents('l1', 'club-demo');
    expect(list[0]).toEqual(expect.objectContaining({ id: 'e1', status: 'CONFIRMED', firstName: 'A', lastName: 'B' }));
    expect((list[0] as any).userId).toBeUndefined();
    expect(list[1].waitlistPosition).toBe(1);
  });
});
```
Run → FAIL (service inexistant).

- [ ] **Step 2: Implémenter `lesson.service.ts`**

```ts
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';

type Container =
  | { kind: 'lesson'; id: string; capacity: number }
  | { kind: 'series'; id: string; capacity: number };

const SER = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 };

class LessonService {
  // Charge la lesson, vérifie le club, et détermine le conteneur d'inscription.
  private async resolve(lessonId: string, clubId: string): Promise<{ lesson: any; container: Container }> {
    const lesson = await prisma.lesson.findUnique({ where: { id: lessonId }, include: { series: true } });
    if (!lesson) throw new Error('LESSON_NOT_FOUND');
    if (lesson.clubId !== clubId) throw new Error('CLUB_MISMATCH');
    const useSeries = lesson.seriesId && lesson.series?.enrollmentMode === 'SERIES';
    const container: Container = useSeries
      ? { kind: 'series', id: lesson.seriesId!, capacity: lesson.series!.capacity ?? lesson.capacity }
      : { kind: 'lesson', id: lesson.id, capacity: lesson.capacity };
    return { lesson, container };
  }

  private whereOf(c: Container) {
    return c.kind === 'series' ? { seriesId: c.id } : { lessonId: c.id };
  }
  private dataKeyOf(c: Container) {
    return c.kind === 'series' ? { lessonId: null as string | null, seriesId: c.id } : { lessonId: c.id, seriesId: null as string | null };
  }

  async adminEnrollStudent(lessonId: string, userId: string, clubId: string) {
    const { container } = await this.resolve(lessonId, clubId);
    // Refuser un membre BLOQUÉ du club.
    const m = await prisma.clubMembership.findFirst({ where: { userId, clubId } });
    if (m?.status === 'BLOCKED') throw new Error('MEMBERSHIP_BLOCKED');

    return prisma.$transaction(async (tx) => {
      const table = container.kind === 'series' ? 'reservation_series' : 'lessons';
      await tx.$queryRawUnsafe(`SELECT id FROM "${table}" WHERE id = $1 FOR UPDATE`, container.id);

      const key = this.dataKeyOf(container);
      const existing = await tx.lessonEnrollment.findUnique({
        where: container.kind === 'series'
          ? { seriesId_userId: { seriesId: container.id, userId } }
          : { lessonId_userId: { lessonId: container.id, userId } },
      });
      if (existing && existing.status !== 'CANCELLED') throw new Error('ALREADY_ENROLLED');

      const confirmed = await tx.lessonEnrollment.count({ where: { ...this.whereOf(container), status: 'CONFIRMED' } });
      const status = (container.capacity == null || confirmed < container.capacity) ? 'CONFIRMED' : 'WAITLISTED';

      if (existing) {
        return tx.lessonEnrollment.update({ where: { id: existing.id }, data: { status, cancelledAt: null, createdAt: new Date() } });
      }
      return tx.lessonEnrollment.create({ data: { ...key, userId, status } });
    }, SER);
  }

  async adminRemoveStudent(lessonId: string, enrollId: string, clubId: string) {
    const { container } = await this.resolve(lessonId, clubId);
    return prisma.$transaction(async (tx) => {
      const table = container.kind === 'series' ? 'reservation_series' : 'lessons';
      await tx.$queryRawUnsafe(`SELECT id FROM "${table}" WHERE id = $1 FOR UPDATE`, container.id);

      const target = await tx.lessonEnrollment.findFirst({ where: { id: enrollId, ...this.whereOf(container) } });
      if (!target) throw new Error('ENROLLMENT_NOT_FOUND');
      await tx.lessonEnrollment.update({ where: { id: target.id }, data: { status: 'CANCELLED', cancelledAt: new Date() } });

      let promotedEnrollmentId: string | null = null;
      if (target.status === 'CONFIRMED') {
        const next = await tx.lessonEnrollment.findFirst({ where: { ...this.whereOf(container), status: 'WAITLISTED' }, orderBy: { createdAt: 'asc' } });
        if (next) { await tx.lessonEnrollment.update({ where: { id: next.id }, data: { status: 'CONFIRMED' } }); promotedEnrollmentId = next.id; }
      }
      return { cancelledEnrollmentId: target.id, promotedEnrollmentId };
    }, SER);
  }

  // Promotion manuelle d'un WAITLISTED (bouton staff).
  async adminPromoteStudent(lessonId: string, enrollId: string, clubId: string) {
    const { container } = await this.resolve(lessonId, clubId);
    const target = await prisma.lessonEnrollment.findFirst({ where: { id: enrollId, ...this.whereOf(container) } });
    if (!target) throw new Error('ENROLLMENT_NOT_FOUND');
    if (target.status !== 'WAITLISTED') throw new Error('VALIDATION_ERROR');
    return prisma.lessonEnrollment.update({ where: { id: target.id }, data: { status: 'CONFIRMED' } });
  }

  async listStudents(lessonId: string, clubId: string) {
    const { container } = await this.resolve(lessonId, clubId);
    const rows = await prisma.lessonEnrollment.findMany({
      where: { ...this.whereOf(container), status: { not: 'CANCELLED' } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, status: true, createdAt: true, userId: true, user: { select: { firstName: true, lastName: true, avatarUrl: true } } },
    });
    let wl = 0;
    return rows.map(({ userId, user, ...r }) => ({
      id: r.id, status: r.status,
      firstName: user.firstName, lastName: user.lastName, avatarUrl: user.avatarUrl,
      waitlistPosition: r.status === 'WAITLISTED' ? ++wl : null,
    }));
  }
}

export const lessonService = new LessonService();
```
⚠️ Vérifier le nom du modèle d'adhésion (`clubMembership`) et de son champ `status`/`userId`/`clubId` dans le schéma (l'app utilise `ClubMembership` @@map `club_subscribers` d'après la mémoire) — adapter le `findFirst` en conséquence. Si le nom du raw `$queryRawUnsafe` pose souci avec l'adapter PrismaPg, suivre le même style que `event.service.ts` (qui fait `SELECT … FOR UPDATE` via `tx.$queryRaw`).

- [ ] **Step 3: Run tests** → `cd "…/backend" && npx jest lesson.service.test.ts` → PASS. (Adapter les mocks `$queryRawUnsafe` si nécessaire : `prismaMock.$queryRawUnsafe.mockResolvedValue([])`.)

- [ ] **Step 4: Commit**
```bash
git add backend/src/services/lesson.service.ts backend/src/services/__tests__/lesson.service.test.ts
git commit -m "feat(cours): LessonService enroll/remove/promote/list polymorphe (Lot 2)"
```

---

## Task 5: Routes admin `/lessons/:id/students` + `ERROR_STATUS`

**Files:**
- Modify: `backend/src/routes/admin.ts`
- Test: `backend/src/routes/__tests__/admin.lessons.routes.test.ts`

- [ ] **Step 1: Test (rouge)** — `admin.lessons.routes.test.ts`

```ts
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';

const token = jwt.sign({ id: 'u1', email: 'o@x.fr' }, process.env.JWT_SECRET!);
const base = '/api/clubs/club-demo/admin';
beforeEach(() => {
  prismaMock.clubMember.findUnique.mockResolvedValue({ userId: 'u1', clubId: 'club-demo', role: 'OWNER' } as any);
});

describe('routes lessons students', () => {
  it('POST /lessons/:id/students → 201', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue({ id: 'l1', clubId: 'club-demo', capacity: 2, seriesId: null, series: null } as any);
    prismaMock.clubMembership.findFirst.mockResolvedValue(null);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.$queryRawUnsafe.mockResolvedValue([]);
    prismaMock.lessonEnrollment.findUnique.mockResolvedValue(null);
    prismaMock.lessonEnrollment.count.mockResolvedValue(0);
    prismaMock.lessonEnrollment.create.mockResolvedValue({ id: 'e1', status: 'CONFIRMED' } as any);
    const res = await request(app).post(`${base}/lessons/l1/students`).set('Authorization', `Bearer ${token}`).send({ userId: 'u9' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('CONFIRMED');
  });

  it('lesson absente → 404 LESSON_NOT_FOUND', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue(null);
    const res = await request(app).post(`${base}/lessons/x/students`).set('Authorization', `Bearer ${token}`).send({ userId: 'u9' });
    expect(res.status).toBe(404);
  });
});
```
Run → FAIL.

- [ ] **Step 2: Ajouter au `ERROR_STATUS`** (dans `admin.ts`, l'objet lignes ~45‑85) :
```ts
  LESSON_NOT_FOUND: 404,
  ENROLLMENT_NOT_FOUND: 404,
  ALREADY_ENROLLED: 409,
  MEMBERSHIP_BLOCKED: 403,
```
(Ne pas dupliquer une clé déjà présente — vérifier `CLUB_MISMATCH`/`VALIDATION_ERROR` déjà mappés ; sinon les ajouter : `CLUB_MISMATCH: 403`, `VALIDATION_ERROR: 400`.)

- [ ] **Step 3: Ajouter les routes** après le bloc `/reservation-series` (après ~ligne 583). Importer `lessonService` en tête du fichier (`import { lessonService } from '../services/lesson.service';`). Reprendre exactement le style de gestion d'erreur des routes voisines (try/catch → `ERROR_STATUS[(e as Error).message] ?? 500`).
```ts
router.get('/lessons/:id/students', async (req, res) => {
  try { res.json(await lessonService.listStudents(req.params.id, req.params.clubId)); }
  catch (e) { const s = ERROR_STATUS[(e as Error).message] ?? 500; res.status(s).json({ error: (e as Error).message }); }
});
router.post('/lessons/:id/students', async (req, res) => {
  try { res.status(201).json(await lessonService.adminEnrollStudent(req.params.id, req.body.userId, req.params.clubId)); }
  catch (e) { const s = ERROR_STATUS[(e as Error).message] ?? 500; res.status(s).json({ error: (e as Error).message }); }
});
router.patch('/lessons/:id/students/:enrollId', async (req, res) => {
  try { res.json(await lessonService.adminPromoteStudent(req.params.id, req.params.enrollId, req.params.clubId)); }
  catch (e) { const s = ERROR_STATUS[(e as Error).message] ?? 500; res.status(s).json({ error: (e as Error).message }); }
});
router.delete('/lessons/:id/students/:enrollId', async (req, res) => {
  try { res.json(await lessonService.adminRemoveStudent(req.params.id, req.params.enrollId, req.params.clubId)); }
  catch (e) { const s = ERROR_STATUS[(e as Error).message] ?? 500; res.status(s).json({ error: (e as Error).message }); }
});
```
(Adapter `req.params.clubId` au nom réellement utilisé dans le fichier — vérifier comment les routes coaches/series récupèrent le clubId.)

- [ ] **Step 4: Run tests + suite back**
Run: `cd "…/backend" && npx jest admin.lessons.routes.test.ts` → PASS, puis `npm test` → tout vert.

- [ ] **Step 5: Commit**
```bash
git add backend/src/routes/admin.ts backend/src/routes/__tests__/admin.lessons.routes.test.ts
git commit -m "feat(cours): routes admin /lessons/:id/students (Lot 2)"
```

---

## Task 6: Frontend — client API + helpers `lessons.ts`

**Files:**
- Modify: `frontend/lib/api.ts`
- Create: `frontend/lib/lessons.ts` + `frontend/__tests__/lessons.test.ts`

- [ ] **Step 1: Types + méthodes API**

Dans `frontend/lib/api.ts`, étendre `CreateSeriesBody` (lignes ~1486) avec les params cours optionnels :
```ts
  coachId?: string;
  capacity?: number;
  lessonKind?: 'INDIVIDUAL' | 'COLLECTIVE';
  allowSelfEnroll?: boolean;
  enrollmentMode?: 'SERIES' | 'PER_SESSION';
```
Ajouter les types :
```ts
export interface LessonStudent {
  id: string;
  status: 'CONFIRMED' | 'WAITLISTED' | 'CANCELLED';
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  waitlistPosition: number | null;
}
```
Étendre le body de création de réservation admin (chercher la méthode `adminCreateReservation` existante / son type) avec `lessonParams?: { coachId: string; capacity: number; lessonKind: 'INDIVIDUAL'|'COLLECTIVE'; allowSelfEnroll: boolean }`.
Ajouter les méthodes (style des méthodes coaches/series voisines) :
```ts
adminListLessonStudents: (clubId: string, lessonId: string, token: string) =>
  request<LessonStudent[]>(`/api/clubs/${clubId}/admin/lessons/${lessonId}/students`, {}, token),
adminEnrollStudent: (clubId: string, lessonId: string, userId: string, token: string) =>
  request<LessonStudent>(`/api/clubs/${clubId}/admin/lessons/${lessonId}/students`, { method: 'POST', body: JSON.stringify({ userId }) }, token),
adminPromoteStudent: (clubId: string, lessonId: string, enrollId: string, token: string) =>
  request<LessonStudent>(`/api/clubs/${clubId}/admin/lessons/${lessonId}/students/${enrollId}`, { method: 'PATCH' }, token),
adminRemoveStudent: (clubId: string, lessonId: string, enrollId: string, token: string) =>
  request<{ cancelledEnrollmentId: string; promotedEnrollmentId: string | null }>(`/api/clubs/${clubId}/admin/lessons/${lessonId}/students/${enrollId}`, { method: 'DELETE' }, token),
```

- [ ] **Step 2: Test helpers (rouge)** — `frontend/__tests__/lessons.test.ts`
```ts
import { lessonKindLabel, capacityLabel, fillRatioLesson } from '@/lib/lessons';

describe('lessons helpers', () => {
  it('libellés de type', () => {
    expect(lessonKindLabel('INDIVIDUAL')).toBe('Individuel');
    expect(lessonKindLabel('COLLECTIVE')).toBe('Collectif');
  });
  it('capacityLabel', () => {
    expect(capacityLabel(3, 4)).toBe('3 / 4');
  });
  it('fillRatioLesson borné [0,1]', () => {
    expect(fillRatioLesson(2, 4)).toBe(0.5);
    expect(fillRatioLesson(9, 4)).toBe(1);
    expect(fillRatioLesson(0, 0)).toBe(0);
  });
});
```
Run → FAIL.

- [ ] **Step 3: Implémenter `frontend/lib/lessons.ts`**
```ts
export type LessonKind = 'INDIVIDUAL' | 'COLLECTIVE';

export function lessonKindLabel(k: LessonKind): string {
  return k === 'INDIVIDUAL' ? 'Individuel' : 'Collectif';
}
export function capacityLabel(confirmed: number, capacity: number): string {
  return `${confirmed} / ${capacity}`;
}
export function fillRatioLesson(confirmed: number, capacity: number): number {
  if (!capacity || capacity <= 0) return 0;
  return Math.max(0, Math.min(1, confirmed / capacity));
}
```

- [ ] **Step 4: Run tests + types** → `cd "…/frontend" && npx jest __tests__/lessons.test.ts` PASS ; `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**
```bash
git add frontend/lib/api.ts frontend/lib/lessons.ts frontend/__tests__/lessons.test.ts
git commit -m "feat(cours): client API lessons + helpers (Lot 2)"
```

---

## Task 7: Planning — bloc « Cours » à la création

**Files:**
- Modify: `frontend/app/admin/planning/page.tsx`

But : quand le type de réservation créée est **Coaching**, afficher un bloc « Cours » (coach, capacité, case « ouvert à l'auto-inscription », et si récurrent → mode d'inscription). À la soumission, passer `lessonParams` (création ponctuelle) ou les champs cours dans `CreateSeriesBody` (série).

- [ ] **Step 1: État + chargement des coachs**

Près des états de la modale de création (lignes ~127‑129), ajouter :
```ts
const [cIsCourse, setCIsCourse]       = useState(false);
const [cCoachId, setCCoachId]         = useState('');
const [cCapacity, setCCapacity]       = useState('1');
const [cAllowSelfEnroll, setCAllowSelfEnroll] = useState(false);
const [cEnrollMode, setCEnrollMode]   = useState<'SERIES' | 'PER_SESSION'>('SERIES');
const [coaches, setCoaches]           = useState<Coach[]>([]);
```
Au montage (à côté du `api.adminGetMembers` ligne ~139), charger les coachs actifs : `api.adminListCoaches(clubId, token).then((cs) => setCoaches(cs.filter((c) => c.isActive)))`.

- [ ] **Step 2: Bloc « Cours » dans la modale (entre Intitulé ~ligne 918 et bloc Récurrence ~ligne 934)**

N'afficher que si le type sélectionné est Coaching (`cType === 'COACHING'`, vérifier le nom exact de l'état de type dans le fichier). Utiliser les composants/inputs déjà stylés du fichier (mêmes `label`/`input`/`select`).
```tsx
{cType === 'COACHING' && (
  <div style={{ /* même style que les autres groupes de la modale */ }}>
    <label><input type="checkbox" checked={cIsCourse} onChange={(e) => setCIsCourse(e.target.checked)} /> Cours encadré (coach + élèves)</label>
    {cIsCourse && (
      <>
        <label>Coach
          <select value={cCoachId} onChange={(e) => setCCoachId(e.target.value)}>
            <option value="">— choisir —</option>
            {coaches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label>Capacité
          <input type="number" min={1} value={cCapacity} onChange={(e) => setCCapacity(e.target.value)} />
        </label>
        <label><input type="checkbox" checked={cAllowSelfEnroll} onChange={(e) => setCAllowSelfEnroll(e.target.checked)} /> Ouvert à l'auto-inscription des joueurs</label>
        {cRecurring && (
          <label>Inscription
            <select value={cEnrollMode} onChange={(e) => setCEnrollMode(e.target.value as 'SERIES' | 'PER_SESSION')}>
              <option value="SERIES">À la série (trimestre)</option>
              <option value="PER_SESSION">Séance par séance</option>
            </select>
          </label>
        )}
      </>
    )}
  </div>
)}
```
Capacité = 1 ⇒ individuel ; ≥ 2 ⇒ collectif. Dérivation à la soumission : `lessonKind = Number(cCapacity) <= 1 ? 'INDIVIDUAL' : 'COLLECTIVE'`.

- [ ] **Step 3: Soumission**

Dans le handler de création (là où `api.adminCreateSeries` et la création ponctuelle sont appelées) :
- Si `cIsCourse && cType === 'COACHING'`, construire `const lessonKind = Number(cCapacity) <= 1 ? 'INDIVIDUAL' : 'COLLECTIVE';`
- **Série** (`cRecurring`) : ajouter au body `adminCreateSeries` : `coachId: cCoachId, capacity: Number(cCapacity), lessonKind, allowSelfEnroll: cAllowSelfEnroll, enrollmentMode: cEnrollMode`.
- **Ponctuel** : passer `lessonParams: { coachId: cCoachId, capacity: Number(cCapacity), lessonKind, allowSelfEnroll: cAllowSelfEnroll }` au body de création de réservation.
- Garde UI : bouton « Créer » désactivé si `cIsCourse && !cCoachId`. Réinitialiser les états cours à la fermeture/réouverture de la modale.

- [ ] **Step 4: Types + build front**
Run: `cd "…/frontend" && npx tsc --noEmit` → clean. (Pas de test composant requis ici ; la logique de dérivation est triviale et le helper est testé en Task 6.)

- [ ] **Step 5: Commit**
```bash
git add frontend/app/admin/planning/page.tsx
git commit -m "feat(cours): bloc Cours à la création du planning (Lot 2)"
```

---

## Task 8: Planning — gestion des élèves dans la modale de détail

**Files:**
- Modify: `frontend/app/admin/planning/page.tsx`

But : quand la réservation sélectionnée est un cours (a un `Lesson`), afficher une section « Élèves » : liste (confirmés + liste d'attente avec position), ajout via le `PlayerPicker` existant (recherche locale dans `members`), retrait, et promotion d'un élève en attente. Section placée **au-dessus** du bloc d'annulation (lignes ~814‑835).

- [ ] **Step 1: Exposer le `lessonId` sur la réservation sélectionnée**

La modale de détail lit `selected` (une réservation). Vérifier que le payload de réservation chargé par le planning inclut `lesson { id }` (sinon étendre la lecture côté backend `listClubReservations`/équivalent pour inclure `lesson: { select: { id: true, capacity: true, lessonKind: true } }`, additif). Si l'ajout backend est nécessaire, le faire dans cette tâche (lecture additive, sans changer la forme des autres champs) et committer.

- [ ] **Step 2: État + chargement du roster**
```ts
const [students, setStudents] = useState<LessonStudent[]>([]);
const loadStudents = useCallback((lessonId: string) => {
  if (!token || !clubId) return;
  api.adminListLessonStudents(clubId, lessonId, token).then(setStudents).catch(() => setStudents([]));
}, [token, clubId]);
```
Charger à l'ouverture du détail si `selected?.lesson?.id`.

- [ ] **Step 3: Section « Élèves » (au-dessus du bloc annulation)**
```tsx
{selected?.lesson?.id && (
  <div>
    <h4>Élèves {capacityLabel(students.filter((s) => s.status === 'CONFIRMED').length, selected.lesson.capacity)}</h4>
    {students.map((s) => (
      <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>{s.firstName} {s.lastName}</span>
        {s.status === 'WAITLISTED' && <span>· attente {s.waitlistPosition}</span>}
        {s.status === 'WAITLISTED' && <button onClick={() => api.adminPromoteStudent(clubId!, selected.lesson!.id, s.id, token!).then(() => loadStudents(selected.lesson!.id))}>Promouvoir</button>}
        <button onClick={() => api.adminRemoveStudent(clubId!, selected.lesson!.id, s.id, token!).then(() => loadStudents(selected.lesson!.id))}>Retirer</button>
      </div>
    ))}
    {/* Ajout : réutiliser le PlayerPicker existant (members + recherche locale) */}
    <PlayerPicker members={members} onPick={(userId) => api.adminEnrollStudent(clubId!, selected.lesson!.id, userId, token!).then(() => loadStudents(selected.lesson!.id)).catch(() => {})} />
  </div>
)}
```
Reprendre la **signature exacte** du `PlayerPicker` tel qu'utilisé ailleurs dans le fichier (props `members`/`onPick` ou équivalent — vérifier lignes ~674‑681 / 924‑930) et l'adapter. Styliser comme la liste « Par joueur » existante (lignes ~699‑752).

- [ ] **Step 4: Types + build**
Run: `cd "…/frontend" && npx tsc --noEmit` → clean ; `cd "…/frontend" && npm test` → vert.

- [ ] **Step 5: Commit**
```bash
git add frontend/app/admin/planning/page.tsx
# + backend si lecture lesson ajoutée
git commit -m "feat(cours): gestion des élèves dans la modale de détail (Lot 2)"
```

---

## Vérification manuelle finale (quand Postgres up + migration appliquée)

1. Appliquer la migration : `cd backend && npx prisma migrate deploy` (ou dev).
2. `/admin/coaches` : créer un coach.
3. `/admin/planning` : créer un **cours collectif ponctuel** (Coaching, capacité 4) → ouvrir le détail → ajouter 5 élèves : 4 CONFIRMED + 1 en attente ; retirer un confirmé → le 5e est promu auto ; promouvoir manuellement marche aussi.
4. Créer une **série de cours** mode « À la série » → vérifier qu'un `Lesson` existe par occurrence et que l'inscription se fait au niveau série (présente sur chaque séance). Mode « Séance par séance » → roster distinct par séance.
5. Annuler une séance vs la série (Lot 1) : inchangé, ne casse pas les inscriptions.

---

## Self-Review (couverture spec Lot 2)

- `Lesson` + `LessonEnrollment` + migration additive → Task 1. ✅
- Snapshot Lesson à la génération de série + params cours sur la série → Task 2. ✅
- Cours ponctuel via `adminCreateReservation` + `lessonParams` → Task 3. ✅
- `LessonService` capacité/attente/promotion **polymorphe** (lesson vs série) + IDOR `CLUB_MISMATCH` + `LESSON_NOT_FOUND`/`ALREADY_ENROLLED`/BLOCKED → Task 4. ✅
- Routes admin students + `ERROR_STATUS` (404/409/403) → Task 5. ✅
- Front : client + helpers, bloc « Cours » création, gestion élèves détail → Tasks 6‑8. ✅
- Hors Lot 2 (→ Lot 3) : auto-inscription joueur (`/api/lessons/*`, `/events`), « Mes cours », **emails**. Non inclus ici, conforme au découpage. ✅
