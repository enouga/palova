# Lot 1 — Coachs + récurrence générique — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner au staff/admin un catalogue de coachs et la possibilité de créer des réservations **récurrentes** (série hebdo avec date de fin) de n'importe quel type depuis le planning.

**Architecture:** Migration additive (`Coach`, `ReservationSeries`, `Reservation.seriesId`, enums `LessonKind`/`EnrollmentMode` posés dès maintenant pour le Lot 2). `CoachService` = CRUD calqué sur `SponsorService`. La récurrence repose sur une fonction **pure** `weeklyOccurrences` (Luxon, testable sans DB) + `ReservationService.adminCreateSeries`/`adminCancelSeries` qui réutilisent la détection de conflit terrain existante (Serializable, prédicats de `holdSlot`) et **sautent** les créneaux occupés. Frontend : page `/admin/coaches` + bloc « Récurrence » dans la modale de création du planning + bouton « Annuler la série » dans la modale de détail.

**Tech Stack:** TypeScript, Prisma 7 (adapter-pg), Express 5, Luxon, Jest + supertest (backend) ; Next.js 16, React 19, Jest + React Testing Library (frontend).

**Périmètre :** Lot 1 du spec `docs/superpowers/specs/2026-06-17-cours-recurrence-design.md`. Les params « cours » (coach/capacité/élèves) de `ReservationSeries` sont **créés en base mais non utilisés** ici — c'est le Lot 2. La récurrence Lot 1 crée des réservations « sèches » (type voulu, `seriesId`, `totalPrice=0`, pas de `Lesson`).

**Référence de patterns :**
- CRUD simple : `backend/src/services/sponsor.service.ts` + `backend/src/services/__tests__/sponsor.service.test.ts`.
- Création de réservation admin + conflit : `backend/src/services/reservation.service.ts` (`adminCreateReservation`, ~ligne 612).
- Mock Prisma : `backend/src/__mocks__/prisma.ts` (`mockDeep` — tout nouveau modèle est auto-mocké après `prisma generate`). `$transaction` se mocke par `prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock))`.
- Routes admin + `ERROR_STATUS` + `handleError` : `backend/src/routes/admin.ts`.
- Page admin (hooks/thème) : `frontend/app/admin/sponsors/page.tsx` (`useTheme`, `useAuth`, `useClub`, `api`, `Btn`).
- Modale planning : `frontend/app/admin/planning/page.tsx` (`openCreate` ~390, `submitCreate` ~404, JSX modale ~805).

---

### Task 1 : Schéma Prisma — Coach, ReservationSeries, Reservation.seriesId, enums

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create (généré) : `backend/prisma/migrations/<timestamp>_add_coaches_and_reservation_series/migration.sql`

- [ ] **Step 1 : Ajouter les deux enums** (après le bloc `enum MatchPlayerConfirmation`, vers la ligne 159)

```prisma
/// Type de cours : individuel (capacité 1) ou collectif (capacité N). Utilisé en Lot 2.
enum LessonKind {
  INDIVIDUAL
  COLLECTIVE
}

/// Mode d'inscription d'un cours récurrent : à la série (trimestre) ou séance par séance. Lot 2.
enum EnrollmentMode {
  SERIES
  PER_SESSION
}
```

- [ ] **Step 2 : Ajouter les modèles `Coach` et `ReservationSeries`** (à la fin du fichier, après `EventRegistration`)

```prisma
/// Coach/moniteur géré par le club (indépendant des comptes staff). Suppression = soft (isActive=false).
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

  @@index([clubId])
  @@map("coaches")
}

/// Récurrence hebdomadaire générique (tous types). Génère des Reservation (Reservation.seriesId).
/// Les colonnes « cours » (coachId/capacity/lessonKind/allowSelfEnroll/enrollmentMode) sont posées
/// dès maintenant mais exploitées au Lot 2 — null/false en Lot 1.
model ReservationSeries {
  id          String          @id @default(cuid())
  clubId      String          @map("club_id")
  resourceId  String          @map("resource_id")
  type        ReservationType @default(COURT)
  title       String?
  weekday     Int                                    // 1–7 (Luxon, 1=lundi)
  startLocal  String          @map("start_local")    // "HH:mm" heure locale du club
  durationMin Int             @map("duration_min")
  startDate   DateTime        @map("start_date") @db.Date
  endDate     DateTime        @map("end_date") @db.Date
  coachId         String?         @map("coach_id")
  capacity        Int?
  lessonKind      LessonKind?     @map("lesson_kind")
  allowSelfEnroll Boolean         @default(false) @map("allow_self_enroll")
  enrollmentMode  EnrollmentMode? @map("enrollment_mode")
  cancelledAt DateTime?       @map("cancelled_at")
  createdAt   DateTime        @default(now()) @map("created_at")
  updatedAt   DateTime        @updatedAt @map("updated_at")

  club         Club          @relation(fields: [clubId], references: [id], onDelete: Cascade)
  resource     Resource      @relation(fields: [resourceId], references: [id], onDelete: Cascade)
  coach        Coach?        @relation(fields: [coachId], references: [id], onDelete: SetNull)
  reservations Reservation[]

  @@index([clubId])
  @@index([resourceId])
  @@map("reservation_series")
}
```

- [ ] **Step 3 : Ajouter `seriesId` + relation sur `Reservation`** (dans `model Reservation`, après `targetLevelMax`)

```prisma
  seriesId    String?           @map("series_id") // occurrence d'une série (récurrence admin)
```

Puis dans la zone des relations de `Reservation` (après `matches Match[]`) :

```prisma
  series       ReservationSeries?       @relation(fields: [seriesId], references: [id], onDelete: SetNull)
```

Et ajouter l'index (à côté des autres `@@index` de `Reservation`) :

```prisma
  @@index([seriesId])
```

- [ ] **Step 4 : Ajouter les back-relations** sur `Club` et `Resource`

Dans `model Club`, à la fin de la liste des relations (après `faqItems ClubFaqItem[]`) :

```prisma
  coaches          Coach[]
  reservationSeries ReservationSeries[]
```

Dans `model Resource`, après `reservations Reservation[]` :

```prisma
  series       ReservationSeries[]
```

- [ ] **Step 5 : Générer la migration + le client**

Run : `cd backend && npx prisma migrate dev --name add_coaches_and_reservation_series`
Expected : nouvelle migration créée et appliquée, puis « Generated Prisma Client ».

> Si PostgreSQL est éteint : `npx prisma migrate dev --create-only --name add_coaches_and_reservation_series` puis `npx prisma generate`. La migration est purement additive (nouvelles tables + colonnes nullables / `seriesId` nullable) → s'appliquera au boot via `prisma migrate deploy`.

- [ ] **Step 6 : Vérifier la compilation TypeScript**

Run : `cd backend && npx tsc --noEmit`
Expected : aucune erreur (les nouveaux types Prisma `Coach`, `ReservationSeries`, `LessonKind`, `EnrollmentMode` existent).

- [ ] **Step 7 : Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(cours): schéma Coach + ReservationSeries + Reservation.seriesId (Lot 1)"
```

---

### Task 2 : `CoachService` (CRUD)

**Files:**
- Create: `backend/src/services/coach.service.ts`
- Test: `backend/src/services/__tests__/coach.service.test.ts`

- [ ] **Step 1 : Écrire les tests qui échouent**

```typescript
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { CoachService } from '../coach.service';

describe('CoachService', () => {
  let service: CoachService;
  beforeEach(() => { service = new CoachService(); });

  it('create normalise name/bio (trim, vide → null) et défauts', async () => {
    prismaMock.coach.create.mockResolvedValue({ id: 'c1' } as any);
    await service.create('club-demo', { name: '  Paul  ', bio: '   ' });
    expect(prismaMock.coach.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ clubId: 'club-demo', name: 'Paul', bio: null, isActive: true, sortOrder: 0, photoUrl: null }),
    }));
  });

  it('create rejette VALIDATION_ERROR si name vide', async () => {
    await expect(service.create('club-demo', { name: '   ' })).rejects.toThrow('VALIDATION_ERROR');
    expect(prismaMock.coach.create).not.toHaveBeenCalled();
  });

  it('update ignore les champs non fournis', async () => {
    prismaMock.coach.findUnique.mockResolvedValue({ clubId: 'club-demo' } as any);
    prismaMock.coach.update.mockResolvedValue({ id: 'c1' } as any);
    await service.update('c1', 'club-demo', { name: 'Paul Pro' });
    expect(prismaMock.coach.update).toHaveBeenCalledWith(expect.objectContaining({ data: { name: 'Paul Pro' } }));
  });

  it('update rejette COACH_NOT_FOUND si autre club', async () => {
    prismaMock.coach.findUnique.mockResolvedValue({ clubId: 'autre' } as any);
    await expect(service.update('c1', 'club-demo', { name: 'x' })).rejects.toThrow('COACH_NOT_FOUND');
  });

  it('remove = soft delete (isActive=false), garde-fou club', async () => {
    prismaMock.coach.findUnique.mockResolvedValue({ clubId: 'club-demo' } as any);
    prismaMock.coach.update.mockResolvedValue({ id: 'c1' } as any);
    await service.remove('c1', 'club-demo');
    expect(prismaMock.coach.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { isActive: false } });
  });

  it('listAdmin trie actifs d abord puis sortOrder puis nom', async () => {
    prismaMock.coach.findMany.mockResolvedValue([] as any);
    await service.listAdmin('club-demo');
    expect(prismaMock.coach.findMany).toHaveBeenCalledWith({
      where: { clubId: 'club-demo' },
      orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
  });
});
```

- [ ] **Step 2 : Lancer les tests pour vérifier qu'ils échouent**

Run : `cd backend && npx jest coach.service -t CoachService`
Expected : FAIL (`Cannot find module '../coach.service'`).

- [ ] **Step 3 : Écrire le service**

```typescript
import { prisma } from '../db/prisma';

export interface CoachInput {
  name?: string;
  photoUrl?: string | null;
  bio?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}

export class CoachService {
  /** Liste back-office : actifs d'abord, puis ordre choisi, puis alphabétique. */
  async listAdmin(clubId: string) {
    return prisma.coach.findMany({
      where: { clubId },
      orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async create(clubId: string, data: CoachInput) {
    const name = (data.name ?? '').trim();
    if (!name) throw new Error('VALIDATION_ERROR');
    return prisma.coach.create({
      data: {
        clubId,
        name,
        photoUrl: data.photoUrl?.trim() || null,
        bio: data.bio?.trim() || null,
        sortOrder: Number.isInteger(data.sortOrder) ? data.sortOrder! : 0,
        isActive: data.isActive ?? true,
      },
    });
  }

  async update(id: string, clubId: string, data: CoachInput) {
    const found = await prisma.coach.findUnique({ where: { id }, select: { clubId: true } });
    if (!found || found.clubId !== clubId) throw new Error('COACH_NOT_FOUND');
    return prisma.coach.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.photoUrl !== undefined ? { photoUrl: data.photoUrl?.trim() || null } : {}),
        ...(data.bio !== undefined ? { bio: data.bio?.trim() || null } : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: Number(data.sortOrder) } : {}),
        ...(data.isActive !== undefined ? { isActive: !!data.isActive } : {}),
      },
    });
  }

  /** Suppression douce : un coach peut être référencé par des séries/cours → on désactive. */
  async remove(id: string, clubId: string) {
    const found = await prisma.coach.findUnique({ where: { id }, select: { clubId: true } });
    if (!found || found.clubId !== clubId) throw new Error('COACH_NOT_FOUND');
    await prisma.coach.update({ where: { id }, data: { isActive: false } });
  }
}
```

- [ ] **Step 4 : Lancer les tests pour vérifier qu'ils passent**

Run : `cd backend && npx jest coach.service`
Expected : PASS (6 tests).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/coach.service.ts backend/src/services/__tests__/coach.service.test.ts
git commit -m "feat(cours): CoachService CRUD (Lot 1)"
```

---

### Task 3 : Routes admin coachs

**Files:**
- Modify: `backend/src/routes/admin.ts`
- Test: `backend/src/routes/__tests__/admin.coaches.routes.test.ts`

- [ ] **Step 1 : Écrire le test de routes qui échoue**

Calque sur `backend/src/routes/__tests__/admin.sponsors.routes.test.ts` pour le montage de l'app de test (auth + scope club mockés). Vérifie : `GET` liste, `POST` 201, `PATCH` 200, `DELETE` 200, et `COACH_NOT_FOUND` → 404.

```typescript
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import express from 'express';
import request from 'supertest';

// Auth + scope club court-circuités : on injecte une membership de test.
jest.mock('../../middleware/auth', () => ({ authMiddleware: (req: any, _res: any, next: any) => { req.userId = 'u1'; next(); } }));
jest.mock('../../middleware/requireClubMember', () => ({
  requireClubMember: () => (req: any, _res: any, next: any) => { req.membership = { clubId: 'club-demo', role: 'ADMIN' }; next(); },
}));

import adminRouter from '../admin';

const app = express();
app.use(express.json());
app.use('/api/clubs/:clubId/admin', adminRouter);

describe('routes admin /coaches', () => {
  it('GET /coaches → 200 liste', async () => {
    prismaMock.coach.findMany.mockResolvedValue([{ id: 'c1', name: 'Paul' }] as any);
    const res = await request(app).get('/api/clubs/club-demo/admin/coaches');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'c1', name: 'Paul' }]);
  });

  it('POST /coaches → 201', async () => {
    prismaMock.coach.create.mockResolvedValue({ id: 'c1', name: 'Paul' } as any);
    const res = await request(app).post('/api/clubs/club-demo/admin/coaches').send({ name: 'Paul' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe('c1');
  });

  it('PATCH /coaches/:id → 200', async () => {
    prismaMock.coach.findUnique.mockResolvedValue({ clubId: 'club-demo' } as any);
    prismaMock.coach.update.mockResolvedValue({ id: 'c1', name: 'Paul Pro' } as any);
    const res = await request(app).patch('/api/clubs/club-demo/admin/coaches/c1').send({ name: 'Paul Pro' });
    expect(res.status).toBe(200);
  });

  it('PATCH coach d un autre club → 404 COACH_NOT_FOUND', async () => {
    prismaMock.coach.findUnique.mockResolvedValue({ clubId: 'autre' } as any);
    const res = await request(app).patch('/api/clubs/club-demo/admin/coaches/c1').send({ name: 'x' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('COACH_NOT_FOUND');
  });

  it('DELETE /coaches/:id → 200', async () => {
    prismaMock.coach.findUnique.mockResolvedValue({ clubId: 'club-demo' } as any);
    prismaMock.coach.update.mockResolvedValue({ id: 'c1' } as any);
    const res = await request(app).delete('/api/clubs/club-demo/admin/coaches/c1');
    expect(res.status).toBe(200);
  });
});
```

> Vérifie le mock exact des middlewares dans `admin.sponsors.routes.test.ts` et aligne-toi dessus s'il diffère.

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run : `cd backend && npx jest admin.coaches.routes`
Expected : FAIL (routes inexistantes → 404 sur GET/POST).

- [ ] **Step 3 : Ajouter le service + l'erreur + les routes dans `admin.ts`**

En tête, importer le service (à côté des autres imports de services, ~ligne 22) :

```typescript
import { CoachService } from '../services/coach.service';
```

Instancier (à côté des autres `const xService = new …`, ~ligne 36) :

```typescript
const coachService = new CoachService();
```

Ajouter dans `ERROR_STATUS` (objet ~ligne 43) :

```typescript
  COACH_NOT_FOUND:        404,
  SERIES_NOT_FOUND:       404,
  SERIES_TOO_LONG:        400,
```

Ajouter le bloc de routes (juste après le bloc `// --- Sponsors ---`, vers la ligne 529) :

```typescript
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

- [ ] **Step 4 : Lancer le test pour vérifier qu'il passe**

Run : `cd backend && npx jest admin.coaches.routes`
Expected : PASS (5 tests).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/routes/admin.ts backend/src/routes/__tests__/admin.coaches.routes.test.ts
git commit -m "feat(cours): routes admin /coaches (Lot 1)"
```

---

### Task 4 : Fonction pure `weeklyOccurrences` (calcul des dates de récurrence)

**Files:**
- Create: `backend/src/services/recurrence.ts`
- Test: `backend/src/services/__tests__/recurrence.test.ts`

- [ ] **Step 1 : Écrire les tests qui échouent**

```typescript
import { weeklyOccurrences, MAX_OCCURRENCES } from '../recurrence';

const base = { weekday: 2, startLocal: '18:00', durationMin: 90, tz: 'Europe/Paris' }; // mardi

describe('weeklyOccurrences', () => {
  it('génère une occurrence par semaine entre startDate et endDate (bornes incluses)', () => {
    // 2026-06-02 = mardi. Du 02/06 au 16/06 → 3 mardis (02, 09, 16).
    const occ = weeklyOccurrences({ ...base, startDate: '2026-06-02', endDate: '2026-06-16' });
    expect(occ).toHaveLength(3);
  });

  it('avance jusqu au premier weekday si startDate ne tombe pas dessus', () => {
    // 2026-06-01 = lundi ; 1er mardi = 02/06.
    const occ = weeklyOccurrences({ ...base, startDate: '2026-06-01', endDate: '2026-06-02' });
    expect(occ).toHaveLength(1);
    expect(occ[0].startUtc.toISOString()).toBe('2026-06-02T16:00:00.000Z'); // 18:00 Paris (été = UTC+2)
  });

  it('calcule la fin via durationMin', () => {
    const occ = weeklyOccurrences({ ...base, startDate: '2026-06-02', endDate: '2026-06-02' });
    expect(occ[0].endUtc.toISOString()).toBe('2026-06-02T17:30:00.000Z'); // +90 min
  });

  it('reste à l heure locale à travers un changement d heure (DST)', () => {
    // Bascule heure d'hiver France : dim 25/10/2026. Vendredi (weekday 5) 10:00.
    const occ = weeklyOccurrences({ weekday: 5, startLocal: '10:00', durationMin: 60, tz: 'Europe/Paris', startDate: '2026-10-23', endDate: '2026-10-30' });
    expect(occ).toHaveLength(2);
    expect(occ[0].startUtc.toISOString()).toBe('2026-10-23T08:00:00.000Z'); // été UTC+2
    expect(occ[1].startUtc.toISOString()).toBe('2026-10-30T09:00:00.000Z'); // hiver UTC+1
  });

  it('rejette VALIDATION_ERROR si endDate < startDate', () => {
    expect(() => weeklyOccurrences({ ...base, startDate: '2026-06-16', endDate: '2026-06-02' })).toThrow('VALIDATION_ERROR');
  });

  it('rejette VALIDATION_ERROR si aucune occurrence dans l intervalle', () => {
    // 2026-06-03 = mercredi, 2026-06-04 = jeudi : aucun mardi.
    expect(() => weeklyOccurrences({ ...base, startDate: '2026-06-03', endDate: '2026-06-04' })).toThrow('VALIDATION_ERROR');
  });

  it('rejette VALIDATION_ERROR sur weekday/heure/durée invalides', () => {
    expect(() => weeklyOccurrences({ ...base, weekday: 0, startDate: '2026-06-02', endDate: '2026-06-09' })).toThrow('VALIDATION_ERROR');
    expect(() => weeklyOccurrences({ ...base, startLocal: '25:00', startDate: '2026-06-02', endDate: '2026-06-09' })).toThrow('VALIDATION_ERROR');
    expect(() => weeklyOccurrences({ ...base, durationMin: 0, startDate: '2026-06-02', endDate: '2026-06-09' })).toThrow('VALIDATION_ERROR');
  });

  it('rejette SERIES_TOO_LONG au-delà de MAX_OCCURRENCES', () => {
    // 61 semaines de mardis.
    const end = '2027-08-10'; // > 60 mardis après 2026-06-02
    expect(() => weeklyOccurrences({ ...base, startDate: '2026-06-02', endDate: end })).toThrow('SERIES_TOO_LONG');
    expect(MAX_OCCURRENCES).toBe(60);
  });
});
```

- [ ] **Step 2 : Lancer les tests pour vérifier qu'ils échouent**

Run : `cd backend && npx jest recurrence`
Expected : FAIL (`Cannot find module '../recurrence'`).

- [ ] **Step 3 : Écrire la fonction pure**

```typescript
import { DateTime } from 'luxon';

export const MAX_OCCURRENCES = 60;

export interface SeriesSchedule {
  weekday: number;     // 1–7 (Luxon, 1=lundi)
  startLocal: string;  // "HH:mm"
  durationMin: number;
  startDate: string;   // "YYYY-MM-DD"
  endDate: string;     // "YYYY-MM-DD" (incluse)
  tz: string;
}

export interface Occurrence {
  startUtc: Date;
  endUtc: Date;
}

/**
 * Toutes les occurrences hebdomadaires d'une série, en UTC. L'heure est appliquée
 * EN LOCAL pour chaque date (donc stable à travers les changements d'heure / DST).
 * Lance VALIDATION_ERROR (entrées invalides ou intervalle vide) ou SERIES_TOO_LONG.
 */
export function weeklyOccurrences(s: SeriesSchedule): Occurrence[] {
  const m = /^(\d{2}):(\d{2})$/.exec(s.startLocal);
  if (!m) throw new Error('VALIDATION_ERROR');
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) throw new Error('VALIDATION_ERROR');
  if (!Number.isInteger(s.weekday) || s.weekday < 1 || s.weekday > 7) throw new Error('VALIDATION_ERROR');
  if (!Number.isInteger(s.durationMin) || s.durationMin <= 0) throw new Error('VALIDATION_ERROR');

  const startDay = DateTime.fromISO(s.startDate, { zone: s.tz }).startOf('day');
  const endDay = DateTime.fromISO(s.endDate, { zone: s.tz }).startOf('day');
  if (!startDay.isValid || !endDay.isValid || endDay < startDay) throw new Error('VALIDATION_ERROR');

  // Premier jour >= startDay tombant sur le bon weekday.
  let cursor = startDay.plus({ days: (s.weekday - startDay.weekday + 7) % 7 });

  const out: Occurrence[] = [];
  while (cursor <= endDay) {
    const start = cursor.set({ hour, minute, second: 0, millisecond: 0 });
    const end = start.plus({ minutes: s.durationMin });
    out.push({ startUtc: start.toUTC().toJSDate(), endUtc: end.toUTC().toJSDate() });
    if (out.length > MAX_OCCURRENCES) throw new Error('SERIES_TOO_LONG');
    cursor = cursor.plus({ days: 7 });
  }
  if (out.length === 0) throw new Error('VALIDATION_ERROR');
  return out;
}
```

- [ ] **Step 4 : Lancer les tests pour vérifier qu'ils passent**

Run : `cd backend && npx jest recurrence`
Expected : PASS (8 tests).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/recurrence.ts backend/src/services/__tests__/recurrence.test.ts
git commit -m "feat(cours): weeklyOccurrences pur pour la récurrence (Lot 1)"
```

---

### Task 5 : `adminCreateSeries` (génération de la série)

**Files:**
- Modify: `backend/src/services/reservation.service.ts`
- Test: `backend/src/services/__tests__/reservation.series.test.ts`

- [ ] **Step 1 : Écrire les tests qui échouent**

```typescript
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { ReservationService } from '../reservation.service';

describe('ReservationService.adminCreateSeries', () => {
  let service: ReservationService;
  beforeEach(() => {
    service = new ReservationService();
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.resource.findUnique.mockResolvedValue({ clubId: 'club-demo', club: { timezone: 'Europe/Paris' } } as any);
    prismaMock.reservationSeries.create.mockResolvedValue({ id: 'ser1' } as any);
    prismaMock.reservation.create.mockImplementation(async (args: any) => ({ id: 'r-' + Math.round(args.data.startTime.getTime() / 1000), ...args.data }) as any);
  });

  it('crée une réservation CONFIRMED par occurrence avec seriesId', async () => {
    prismaMock.reservation.count.mockResolvedValue(0 as any);
    const out = await service.adminCreateSeries({
      clubId: 'club-demo', resourceId: 'res1', type: 'COACHING',
      weekday: 2, startLocal: '18:00', durationMin: 90,
      startDate: '2026-06-02', endDate: '2026-06-16',
    });
    expect(out.created).toBe(3);
    expect(out.skipped).toEqual([]);
    expect(prismaMock.reservation.create).toHaveBeenCalledTimes(3);
    expect(prismaMock.reservation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'CONFIRMED', type: 'COACHING', seriesId: 'ser1', userId: null }),
    }));
  });

  it('saute les occurrences en conflit et les remonte dans skipped', async () => {
    // 1re occurrence en conflit, les 2 suivantes libres.
    prismaMock.reservation.count
      .mockResolvedValueOnce(1 as any)
      .mockResolvedValue(0 as any);
    const out = await service.adminCreateSeries({
      clubId: 'club-demo', resourceId: 'res1', type: 'COURT',
      weekday: 2, startLocal: '18:00', durationMin: 90,
      startDate: '2026-06-02', endDate: '2026-06-16',
    });
    expect(out.created).toBe(2);
    expect(out.skipped).toHaveLength(1);
    expect(out.skipped[0].reason).toBe('SLOT_NOT_AVAILABLE');
  });

  it('rejette CLUB_MISMATCH si la ressource est d un autre club', async () => {
    prismaMock.resource.findUnique.mockResolvedValue({ clubId: 'autre', club: { timezone: 'Europe/Paris' } } as any);
    await expect(service.adminCreateSeries({
      clubId: 'club-demo', resourceId: 'res1', type: 'COURT',
      weekday: 2, startLocal: '18:00', durationMin: 90, startDate: '2026-06-02', endDate: '2026-06-16',
    })).rejects.toThrow('CLUB_MISMATCH');
  });

  it('rejette RESOURCE_NOT_FOUND', async () => {
    prismaMock.resource.findUnique.mockResolvedValue(null as any);
    await expect(service.adminCreateSeries({
      clubId: 'club-demo', resourceId: 'res1', type: 'COURT',
      weekday: 2, startLocal: '18:00', durationMin: 90, startDate: '2026-06-02', endDate: '2026-06-16',
    })).rejects.toThrow('RESOURCE_NOT_FOUND');
  });

  it('propage SERIES_TOO_LONG sans rien créer', async () => {
    await expect(service.adminCreateSeries({
      clubId: 'club-demo', resourceId: 'res1', type: 'COURT',
      weekday: 2, startLocal: '18:00', durationMin: 90, startDate: '2026-06-02', endDate: '2027-08-10',
    })).rejects.toThrow('SERIES_TOO_LONG');
    expect(prismaMock.reservationSeries.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2 : Lancer les tests pour vérifier qu'ils échouent**

Run : `cd backend && npx jest reservation.series`
Expected : FAIL (`adminCreateSeries is not a function`).

- [ ] **Step 3 : Implémenter `adminCreateSeries`**

En tête de `reservation.service.ts`, ajouter l'import (à côté de `import { DateTime } from 'luxon';`) :

```typescript
import { weeklyOccurrences } from './recurrence';
```

Ajouter la méthode dans la classe `ReservationService` (juste après `adminCreateReservation`, ~ligne 692) :

```typescript
  /**
   * Création d'une SÉRIE récurrente hebdo par un gestionnaire (tous types). Génère une
   * Reservation CONFIRMED par occurrence (totalPrice 0, userId null), liée par seriesId.
   * Les créneaux déjà occupés sont SAUTÉS et remontés dans `skipped` (un conflit isolé
   * ne bloque pas la série). Lot 1 : pas de Lesson ni de params cours (Lot 2).
   */
  async adminCreateSeries(params: {
    clubId: string;
    resourceId: string;
    type: ReservationType;
    title?: string;
    weekday: number;
    startLocal: string;   // "HH:mm"
    durationMin: number;
    startDate: string;    // "YYYY-MM-DD"
    endDate: string;      // "YYYY-MM-DD"
  }): Promise<{ seriesId: string; created: number; skipped: Array<{ start: string; reason: string }> }> {
    const resource = await prisma.resource.findUnique({
      where: { id: params.resourceId },
      select: { clubId: true, club: { select: { timezone: true } } },
    });
    if (!resource)                          throw new Error('RESOURCE_NOT_FOUND');
    if (resource.clubId !== params.clubId)  throw new Error('CLUB_MISMATCH');

    // Calcule les occurrences AVANT toute écriture (lève VALIDATION_ERROR / SERIES_TOO_LONG).
    const occurrences = weeklyOccurrences({
      weekday: params.weekday, startLocal: params.startLocal, durationMin: params.durationMin,
      startDate: params.startDate, endDate: params.endDate, tz: resource.club.timezone,
    });

    const title = params.title?.trim() || null;
    const tenMinutesAgo = new Date(Date.now() - HOLD_EXPIRY_MS);

    const { seriesId, createdList, skipped } = await prisma.$transaction(async (tx) => {
      const series = await tx.reservationSeries.create({
        data: {
          clubId: params.clubId,
          resourceId: params.resourceId,
          type: params.type,
          title,
          weekday: params.weekday,
          startLocal: params.startLocal,
          durationMin: params.durationMin,
          startDate: new Date(`${params.startDate}T00:00:00.000Z`),
          endDate:   new Date(`${params.endDate}T00:00:00.000Z`),
        },
      });

      const createdList: Array<{ id: string; startUtc: Date; endUtc: Date }> = [];
      const skipped: Array<{ start: string; reason: string }> = [];

      for (const occ of occurrences) {
        const conflicts = await tx.reservation.count({
          where: {
            resourceId: params.resourceId,
            OR: [
              { status: 'CONFIRMED' },
              { status: 'PENDING', createdAt: { gt: tenMinutesAgo } },
            ],
            startTime: { lt: occ.endUtc },
            endTime:   { gt: occ.startUtc },
          },
        });
        if (conflicts > 0) {
          skipped.push({ start: occ.startUtc.toISOString(), reason: 'SLOT_NOT_AVAILABLE' });
          continue;
        }
        const created = await tx.reservation.create({
          data: {
            resourceId: params.resourceId,
            userId: null,
            startTime: occ.startUtc,
            endTime: occ.endUtc,
            status: 'CONFIRMED',
            type: params.type,
            title,
            totalPrice: new Prisma.Decimal(0),
            seriesId: series.id,
          },
        });
        createdList.push({ id: created.id, startUtc: occ.startUtc, endUtc: occ.endUtc });
      }

      return { seriesId: series.id, createdList, skipped };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 20_000,
    });

    // SSE après commit : les vues live des autres clients se mettent à jour.
    for (const r of createdList) {
      SSEService.getInstance().broadcast(params.resourceId, {
        type: 'slot_confirmed',
        resourceId: params.resourceId,
        reservationId: r.id,
        startTime: r.startUtc.toISOString(),
        endTime: r.endUtc.toISOString(),
      });
    }

    return { seriesId, created: createdList.length, skipped };
  }
```

- [ ] **Step 4 : Lancer les tests pour vérifier qu'ils passent**

Run : `cd backend && npx jest reservation.series`
Expected : PASS (5 tests).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/reservation.service.ts backend/src/services/__tests__/reservation.series.test.ts
git commit -m "feat(cours): adminCreateSeries (génération récurrente, saut des conflits) (Lot 1)"
```

---

### Task 6 : `adminCancelSeries` (annulation des occurrences futures)

**Files:**
- Modify: `backend/src/services/reservation.service.ts`
- Test: `backend/src/services/__tests__/reservation.series.test.ts` (ajout d'un `describe`)

- [ ] **Step 1 : Ajouter les tests qui échouent** (dans le même fichier de test)

```typescript
describe('ReservationService.adminCancelSeries', () => {
  let service: ReservationService;
  beforeEach(() => {
    service = new ReservationService();
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
  });

  it('annule les occurrences futures et clôt la série', async () => {
    prismaMock.reservationSeries.findUnique.mockResolvedValue({ id: 'ser1', clubId: 'club-demo' } as any);
    prismaMock.reservation.findMany.mockResolvedValue([
      { id: 'r1', resourceId: 'res1', startTime: new Date('2999-01-01T10:00:00Z'), endTime: new Date('2999-01-01T11:00:00Z') },
    ] as any);
    prismaMock.reservation.updateMany.mockResolvedValue({ count: 1 } as any);
    prismaMock.reservationSeries.update.mockResolvedValue({ id: 'ser1' } as any);

    const out = await service.adminCancelSeries('ser1', 'club-demo');
    expect(out.cancelled).toBe(1);
    expect(prismaMock.reservation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'CANCELLED' }),
    }));
    expect(prismaMock.reservationSeries.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'ser1' },
      data: expect.objectContaining({ cancelledAt: expect.any(Date) }),
    }));
  });

  it('rejette SERIES_NOT_FOUND', async () => {
    prismaMock.reservationSeries.findUnique.mockResolvedValue(null as any);
    await expect(service.adminCancelSeries('ser1', 'club-demo')).rejects.toThrow('SERIES_NOT_FOUND');
  });

  it('rejette CLUB_MISMATCH', async () => {
    prismaMock.reservationSeries.findUnique.mockResolvedValue({ id: 'ser1', clubId: 'autre' } as any);
    await expect(service.adminCancelSeries('ser1', 'club-demo')).rejects.toThrow('CLUB_MISMATCH');
  });
});
```

- [ ] **Step 2 : Lancer les tests pour vérifier qu'ils échouent**

Run : `cd backend && npx jest reservation.series -t adminCancelSeries`
Expected : FAIL (`adminCancelSeries is not a function`).

- [ ] **Step 3 : Implémenter `adminCancelSeries`** (dans la classe, après `adminCreateSeries`)

```typescript
  /**
   * Annulation d'une série par un gestionnaire : passe en CANCELLED toutes les occurrences
   * FUTURES (startTime > maintenant) encore actives, conserve le passé, clôt la série
   * (cancelledAt). Libère les locks Redis + SSE slot_released par occurrence. Vérifie le club.
   */
  async adminCancelSeries(seriesId: string, adminClubId: string): Promise<{ cancelled: number }> {
    const series = await prisma.reservationSeries.findUnique({
      where: { id: seriesId },
      select: { id: true, clubId: true },
    });
    if (!series)                          throw new Error('SERIES_NOT_FOUND');
    if (series.clubId !== adminClubId)    throw new Error('CLUB_MISMATCH');

    const now = new Date();
    const future = await prisma.reservation.findMany({
      where: { seriesId, status: { not: 'CANCELLED' }, startTime: { gt: now } },
      select: { id: true, resourceId: true, startTime: true, endTime: true },
    });

    await prisma.$transaction(async (tx) => {
      await tx.reservation.updateMany({
        where: { seriesId, status: { not: 'CANCELLED' }, startTime: { gt: now } },
        data: { status: 'CANCELLED', cancelledAt: now },
      });
      await tx.reservationSeries.update({ where: { id: seriesId }, data: { cancelledAt: now } });
    });

    for (const r of future) {
      await redis.del(this.lockKey(r.resourceId, r.startTime));
      SSEService.getInstance().broadcast(r.resourceId, {
        type: 'slot_released',
        resourceId: r.resourceId,
        reservationId: r.id,
        startTime: r.startTime.toISOString(),
        endTime: r.endTime.toISOString(),
      });
    }

    return { cancelled: future.length };
  }
```

- [ ] **Step 4 : Lancer les tests pour vérifier qu'ils passent**

Run : `cd backend && npx jest reservation.series`
Expected : PASS (tous, incl. les 3 nouveaux).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/reservation.service.ts backend/src/services/__tests__/reservation.series.test.ts
git commit -m "feat(cours): adminCancelSeries (annulation des occurrences futures) (Lot 1)"
```

---

### Task 7 : Routes admin séries

**Files:**
- Modify: `backend/src/routes/admin.ts`
- Test: `backend/src/routes/__tests__/admin.series.routes.test.ts`

- [ ] **Step 1 : Écrire le test de routes qui échoue**

```typescript
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import express from 'express';
import request from 'supertest';

jest.mock('../../middleware/auth', () => ({ authMiddleware: (req: any, _res: any, next: any) => { req.userId = 'u1'; next(); } }));
jest.mock('../../middleware/requireClubMember', () => ({
  requireClubMember: () => (req: any, _res: any, next: any) => { req.membership = { clubId: 'club-demo', role: 'ADMIN' }; next(); },
}));

import adminRouter from '../admin';

const app = express();
app.use(express.json());
app.use('/api/clubs/:clubId/admin', adminRouter);

describe('routes admin /reservation-series', () => {
  beforeEach(() => {
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.resource.findUnique.mockResolvedValue({ clubId: 'club-demo', club: { timezone: 'Europe/Paris' } } as any);
    prismaMock.reservationSeries.create.mockResolvedValue({ id: 'ser1' } as any);
    prismaMock.reservation.count.mockResolvedValue(0 as any);
    prismaMock.reservation.create.mockResolvedValue({ id: 'r1' } as any);
  });

  it('POST → 201 avec récap created/skipped', async () => {
    const res = await request(app).post('/api/clubs/club-demo/admin/reservation-series').send({
      resourceId: 'res1', type: 'COACHING', weekday: 2, startLocal: '18:00', durationMin: 90,
      startDate: '2026-06-02', endDate: '2026-06-16',
    });
    expect(res.status).toBe(201);
    expect(res.body.seriesId).toBe('ser1');
    expect(res.body.created).toBe(3);
  });

  it('POST type invalide → 400', async () => {
    const res = await request(app).post('/api/clubs/club-demo/admin/reservation-series').send({
      resourceId: 'res1', type: 'NOPE', weekday: 2, startLocal: '18:00', durationMin: 90,
      startDate: '2026-06-02', endDate: '2026-06-16',
    });
    expect(res.status).toBe(400);
  });

  it('POST date invalide → 400', async () => {
    const res = await request(app).post('/api/clubs/club-demo/admin/reservation-series').send({
      resourceId: 'res1', type: 'COURT', weekday: 2, startLocal: '18:00', durationMin: 90,
      startDate: '02/06/2026', endDate: '2026-06-16',
    });
    expect(res.status).toBe(400);
  });

  it('DELETE → 200 cancelled', async () => {
    prismaMock.reservationSeries.findUnique.mockResolvedValue({ id: 'ser1', clubId: 'club-demo' } as any);
    prismaMock.reservation.findMany.mockResolvedValue([] as any);
    prismaMock.reservation.updateMany.mockResolvedValue({ count: 0 } as any);
    prismaMock.reservationSeries.update.mockResolvedValue({ id: 'ser1' } as any);
    const res = await request(app).delete('/api/clubs/club-demo/admin/reservation-series/ser1');
    expect(res.status).toBe(200);
    expect(res.body.cancelled).toBe(0);
  });
});
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run : `cd backend && npx jest admin.series.routes`
Expected : FAIL (routes inexistantes).

- [ ] **Step 3 : Importer `ReservationType` + ajouter les routes**

En tête de `admin.ts`, étendre l'import Prisma (ligne 5) :

```typescript
import { Prisma, ClubPageKind, ReservationType } from '@prisma/client';
```

Ajouter les routes juste après le bloc `// --- Coachs ---` (Task 3) :

```typescript
// --- Séries récurrentes (tous types) ---
router.post('/reservation-series', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const { resourceId, title, weekday, startLocal, durationMin, startDate, endDate } = req.body;
    const type = asString(req.body.type);
    if (typeof resourceId !== 'string' || !resourceId) return void res.status(400).json({ error: 'resourceId requis' });
    if (!RESERVATION_TYPES.includes(type as typeof RESERVATION_TYPES[number])) return void res.status(400).json({ error: 'type invalide' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asString(startDate)) || !/^\d{4}-\d{2}-\d{2}$/.test(asString(endDate))) {
      return void res.status(400).json({ error: 'dates doivent être YYYY-MM-DD' });
    }
    if (!/^\d{2}:\d{2}$/.test(asString(startLocal))) return void res.status(400).json({ error: 'startLocal doit être HH:mm' });
    if (!Number.isInteger(Number(weekday)) || !Number.isInteger(Number(durationMin))) {
      return void res.status(400).json({ error: 'weekday/durationMin invalides' });
    }
    const created = await reservationService.adminCreateSeries({
      clubId: req.membership!.clubId,
      resourceId,
      type: type as ReservationType,
      title: typeof title === 'string' ? title : undefined,
      weekday: Number(weekday),
      startLocal: asString(startLocal),
      durationMin: Number(durationMin),
      startDate: asString(startDate),
      endDate: asString(endDate),
    });
    res.status(201).json(created);
  } catch (err) { handleError(err, res, next); }
});

router.delete('/reservation-series/:id', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await reservationService.adminCancelSeries(asString(req.params.id), req.membership!.clubId));
  } catch (err) { handleError(err, res, next); }
});
```

- [ ] **Step 4 : Lancer le test pour vérifier qu'il passe**

Run : `cd backend && npx jest admin.series.routes`
Expected : PASS (4 tests).

- [ ] **Step 5 : Gate backend complet**

Run : `cd backend && npx jest && npx tsc --noEmit`
Expected : tous les tests PASS, aucune erreur TS.

- [ ] **Step 6 : Commit**

```bash
git add backend/src/routes/admin.ts backend/src/routes/__tests__/admin.series.routes.test.ts
git commit -m "feat(cours): routes admin /reservation-series (Lot 1)"
```

---

### Task 8 : Client API frontend + types

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1 : Ajouter les types** (près des autres `export interface`, par ex. après `Sponsor`)

```typescript
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

export interface CreateSeriesBody {
  resourceId: string;
  type: ReservationType;
  title?: string;
  weekday: number;       // 1–7 (1=lundi)
  startLocal: string;    // "HH:mm"
  durationMin: number;
  startDate: string;     // "YYYY-MM-DD"
  endDate: string;       // "YYYY-MM-DD"
}

export interface CreateSeriesResult {
  seriesId: string;
  created: number;
  skipped: Array<{ start: string; reason: string }>;
}
```

- [ ] **Step 2 : Ajouter les méthodes** dans l'objet `api` (à côté de `adminCreateReservation`)

```typescript
  adminListCoaches: (clubId: string, token: string) =>
    request<Coach[]>(`/api/clubs/${clubId}/admin/coaches`, {}, token),

  adminCreateCoach: (clubId: string, body: CoachBody, token: string) =>
    request<Coach>(`/api/clubs/${clubId}/admin/coaches`, { method: 'POST', body: JSON.stringify(body) }, token),

  adminUpdateCoach: (clubId: string, id: string, body: CoachBody, token: string) =>
    request<Coach>(`/api/clubs/${clubId}/admin/coaches/${id}`, { method: 'PATCH', body: JSON.stringify(body) }, token),

  adminDeleteCoach: (clubId: string, id: string, token: string) =>
    request<{ ok: true }>(`/api/clubs/${clubId}/admin/coaches/${id}`, { method: 'DELETE' }, token),

  adminCreateSeries: (clubId: string, body: CreateSeriesBody, token: string) =>
    request<CreateSeriesResult>(`/api/clubs/${clubId}/admin/reservation-series`, { method: 'POST', body: JSON.stringify(body) }, token),

  adminCancelSeries: (clubId: string, id: string, token: string) =>
    request<{ cancelled: number }>(`/api/clubs/${clubId}/admin/reservation-series/${id}`, { method: 'DELETE' }, token),
```

> Vérifie que `ReservationType` est déjà exporté/importé dans `api.ts` (utilisé par `CreateReservationBody`). Sinon, réutilise le même import que les types de réservation existants.

- [ ] **Step 3 : Vérifier la compilation**

Run : `cd frontend && npx tsc --noEmit`
Expected : aucune erreur.

- [ ] **Step 4 : Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(cours): client API coachs + séries (Lot 1)"
```

---

### Task 9 : Page `/admin/coaches` + lien sidebar

**Files:**
- Create: `frontend/app/admin/coaches/page.tsx`
- Modify: `frontend/app/admin/layout.tsx` (ajout du lien de navigation)
- Test: `frontend/__tests__/AdminCoaches.test.tsx`

- [ ] **Step 1 : Écrire le test qui échoue**

```typescript
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AdminCoachesPage from '@/app/admin/coaches/page';

jest.mock('@/lib/useAuth', () => ({ useAuth: () => ({ token: 't', ready: true }) }));
jest.mock('@/lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'club-demo', accentColor: '#d6ff3f' } }) }));
jest.mock('@/lib/api', () => ({
  assetUrl: (u: string) => u,
  api: {
    adminListCoaches: jest.fn().mockResolvedValue([{ id: 'c1', name: 'Paul', bio: null, photoUrl: null, isActive: true, sortOrder: 0 }]),
    adminCreateCoach: jest.fn().mockResolvedValue({ id: 'c2', name: 'Marie' }),
    adminUpdateCoach: jest.fn(),
    adminDeleteCoach: jest.fn().mockResolvedValue({ ok: true }),
  },
}));

describe('AdminCoachesPage', () => {
  it('affiche les coachs chargés', async () => {
    render(<AdminCoachesPage />);
    await waitFor(() => expect(screen.getByText('Paul')).toBeInTheDocument());
  });

  it('crée un coach via le formulaire', async () => {
    const { api } = require('@/lib/api');
    render(<AdminCoachesPage />);
    await waitFor(() => screen.getByText('Paul'));
    fireEvent.change(screen.getByPlaceholderText(/nom du coach/i), { target: { value: 'Marie' } });
    fireEvent.click(screen.getByRole('button', { name: /ajouter le coach/i }));
    await waitFor(() => expect(api.adminCreateCoach).toHaveBeenCalledWith('club-demo', expect.objectContaining({ name: 'Marie' }), 't'));
  });
});
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run : `cd frontend && npx jest AdminCoaches`
Expected : FAIL (`Cannot find module '@/app/admin/coaches/page'`).

- [ ] **Step 3 : Écrire la page** (modèle calqué sur `frontend/app/admin/sponsors/page.tsx`, simplifié — sans upload en Lot 1)

```tsx
'use client';
import { useState, useEffect, useCallback, CSSProperties } from 'react';
import { api, Coach, CoachBody } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { Btn } from '@/components/ui/atoms';

const EMPTY = { name: '', bio: '', sortOrder: '0', isActive: true };

export default function AdminCoachesPage() {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { club } = useClub();
  const clubId = club?.id;
  const [items, setItems]   = useState<Coach[]>([]);
  const [form, setForm]     = useState(EMPTY);
  const [editId, setEditId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const labelStyle: CSSProperties = { fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.textMute, display: 'flex', flexDirection: 'column', gap: 6 };
  const inputStyle: CSSProperties = { height: 46, padding: '0 14px', borderRadius: 12, background: th.bg, color: th.text, border: `1px solid ${th.line}`, fontFamily: th.fontUI, fontSize: 15 };

  const load = useCallback(async () => {
    if (!token || !clubId) return;
    setLoading(true);
    try { setError(null); setItems(await api.adminListCoaches(clubId, token)); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [token, clubId]);

  useEffect(() => { if (ready && token && clubId) load(); }, [ready, token, clubId, load]);

  const resetForm = () => { setForm(EMPTY); setEditId(null); };

  const submit = async () => {
    if (!token || !clubId || !form.name.trim()) return;
    setSaving(true);
    const body: CoachBody = {
      name: form.name.trim(),
      bio: form.bio.trim() || null,
      sortOrder: Number.parseInt(form.sortOrder, 10) || 0,
      isActive: form.isActive,
    };
    try {
      setError(null);
      if (editId) await api.adminUpdateCoach(clubId, editId, body, token);
      else        await api.adminCreateCoach(clubId, body, token);
      resetForm();
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  };

  const startEdit = (c: Coach) => {
    setEditId(c.id);
    setForm({ name: c.name, bio: c.bio ?? '', sortOrder: String(c.sortOrder), isActive: c.isActive });
  };

  const remove = async (c: Coach) => {
    if (!token || !clubId) return;
    if (!confirm(`Désactiver le coach « ${c.name} » ?`)) return;
    try { await api.adminDeleteCoach(clubId, c.id, token); await load(); }
    catch (e) { setError((e as Error).message); }
  };

  return (
    <div style={{ maxWidth: 760 }}>
      <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 30, color: th.text, margin: '0 0 18px' }}>Coachs</h1>

      {error && <div style={{ marginBottom: 14, background: '#ff7a4d', color: '#fff', borderRadius: 12, padding: '10px 13px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600 }}>{error}</div>}

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr', background: th.surface, borderRadius: 16, padding: 18, marginBottom: 22 }}>
        <label style={{ ...labelStyle, gridColumn: '1 / -1' }}>Nom
          <input style={inputStyle} value={form.name} placeholder="Nom du coach" onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </label>
        <label style={{ ...labelStyle, gridColumn: '1 / -1' }}>Bio (optionnel)
          <input style={inputStyle} value={form.bio} placeholder="Spécialité, diplômes…" onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))} />
        </label>
        <label style={labelStyle}>Ordre
          <input style={inputStyle} type="number" value={form.sortOrder} onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, alignSelf: 'end', fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, color: th.text }}>
          <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} /> Actif
        </label>
        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 10 }}>
          <Btn type="button" icon="check" onClick={submit} disabled={saving || !form.name.trim()}>
            {saving ? '…' : editId ? 'Enregistrer' : 'Ajouter le coach'}
          </Btn>
          {editId && <button type="button" onClick={resetForm} style={{ border: `1px solid ${th.line}`, background: 'transparent', color: th.text, borderRadius: 10, padding: '8px 14px', cursor: 'pointer', fontFamily: th.fontUI, fontWeight: 600 }}>Annuler</button>}
        </div>
      </div>

      {loading ? <div style={{ fontFamily: th.fontUI, color: th.textMute }}>Chargement…</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((c) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: th.surface, borderRadius: 12, padding: '12px 16px', opacity: c.isActive ? 1 : 0.5 }}>
              <div style={{ flex: 1, fontFamily: th.fontUI, fontWeight: 600, color: th.text }}>
                {c.name}{!c.isActive && <span style={{ marginLeft: 8, fontSize: 12, color: th.textMute }}>(inactif)</span>}
                {c.bio && <div style={{ fontSize: 12.5, fontWeight: 400, color: th.textMute }}>{c.bio}</div>}
              </div>
              <button type="button" onClick={() => startEdit(c)} style={{ border: `1px solid ${th.line}`, background: 'transparent', color: th.text, borderRadius: 9, padding: '6px 12px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600 }}>Modifier</button>
              {c.isActive && <button type="button" onClick={() => remove(c)} style={{ border: 'none', background: th.surface2, color: th.textMute, borderRadius: 9, padding: '6px 12px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600 }}>Désactiver</button>}
            </div>
          ))}
          {items.length === 0 && <div style={{ fontFamily: th.fontUI, color: th.textMute }}>Aucun coach pour l&apos;instant.</div>}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4 : Ajouter le lien « Coachs » dans la sidebar admin**

Dans `frontend/app/admin/layout.tsx`, repérer le tableau des entrées de navigation (cherche les `href: '/admin/sponsors'` ou `'/admin/members'`) et ajouter une entrée cohérente avec le format existant, par ex. :

```tsx
{ href: '/admin/coaches', label: 'Coachs' },
```

> Respecte exactement la forme des entrées voisines (certaines ont une `icon`). Place « Coachs » près de « Planning »/« Events ».

- [ ] **Step 5 : Lancer le test pour vérifier qu'il passe**

Run : `cd frontend && npx jest AdminCoaches`
Expected : PASS (2 tests).

- [ ] **Step 6 : Commit**

```bash
git add frontend/app/admin/coaches/page.tsx frontend/app/admin/layout.tsx frontend/__tests__/AdminCoaches.test.tsx
git commit -m "feat(cours): page /admin/coaches + lien sidebar (Lot 1)"
```

---

### Task 10 : Bloc « Récurrence » dans la modale de création du planning

**Files:**
- Modify: `frontend/app/admin/planning/page.tsx`

**Contexte :** la modale de création (`createOpen`) appelle `submitCreate` (~ligne 404) qui fait `api.adminCreateReservation`. On ajoute un interrupteur « Récurrent » et, s'il est activé, on appelle `api.adminCreateSeries` à la place. Le `weekday` se déduit de `cDate`, la durée de `cStart`/`cEnd`.

- [ ] **Step 1 : Ajouter les états de récurrence**

Repérer les `useState` du formulaire de création (près de `const [cType, setCType]`, etc.) et ajouter :

```tsx
const [cRecurring, setCRecurring] = useState(false);
const [cEndDate, setCEndDate]     = useState('');
```

- [ ] **Step 2 : Réinitialiser à l'ouverture**

Dans `openCreate` (~ligne 390), à la fin (après `setError(null);`), ajouter :

```tsx
    setCRecurring(false);
    setCEndDate(date);
```

- [ ] **Step 3 : Ajouter deux helpers purs** (au-dessus du composant, près des autres consts de module)

```tsx
// weekday Luxon (1=lundi..7=dimanche) depuis une date "YYYY-MM-DD".
function weekdayOf(dateISO: string): number {
  const d = new Date(`${dateISO}T00:00:00Z`);
  const js = d.getUTCDay(); // 0=dimanche..6=samedi
  return js === 0 ? 7 : js;
}
// durée en minutes entre deux "HH:mm" (>0 supposé, validé à la soumission).
function durationMinutes(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}
```

- [ ] **Step 4 : Brancher la soumission** — remplacer le corps de `submitCreate` (~ligne 404)

```tsx
  const submitCreate = async () => {
    if (!token || !clubId) return;
    if (!cResourceId) { setError('Choisis un terrain.'); return; }
    if (cEnd <= cStart) { setError('L’heure de fin doit être après le début.'); return; }
    setBusy(true);
    try {
      setError(null);
      if (cRecurring) {
        if (!cEndDate || cEndDate < cDate) { setError('La date de fin doit être après la date de début.'); setBusy(false); return; }
        const res = await api.adminCreateSeries(clubId, {
          resourceId: cResourceId,
          type: cType,
          title: cTitle.trim() || undefined,
          weekday: weekdayOf(cDate),
          startLocal: cStart,
          durationMin: durationMinutes(cStart, cEnd),
          startDate: cDate,
          endDate: cEndDate,
        }, token);
        if (res.skipped.length > 0) {
          alert(`${res.created} séance(s) créée(s). ${res.skipped.length} ignorée(s) (créneau déjà pris).`);
        }
      } else {
        await api.adminCreateReservation(clubId, {
          resourceId: cResourceId, date: cDate, startTime: cStart, endTime: cEnd,
          type: cType,
          title: cTitle.trim() || undefined,
          memberUserId: cMember?.userId ?? undefined,
          price: cPrice ? Number(cPrice) : undefined,
        }, token);
      }
      setCreateOpen(false);
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
```

- [ ] **Step 5 : Ajouter le bloc UI « Récurrence »** dans la modale, juste avant la rangée du bouton « Créer » (avant le `<div>` du `Btn …onClick={submitCreate}` ~ligne 878)

```tsx
            <div style={{ marginTop: 14, borderTop: `1px solid ${th.line}`, paddingTop: 14 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, color: th.text, cursor: 'pointer' }}>
                <input type="checkbox" checked={cRecurring} onChange={(e) => setCRecurring(e.target.checked)} />
                Répéter chaque semaine
              </label>
              {cRecurring && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 12, color: th.textMute, marginBottom: 6 }}>
                    Tous les <strong style={{ color: th.text }}>{['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'][weekdayOf(cDate) - 1]}s</strong> à {cStart}, jusqu&apos;au :
                  </div>
                  <DateField value={cEndDate} onChange={setCEndDate} size="sm" />
                  <div style={{ fontSize: 11.5, color: th.textMute, marginTop: 6 }}>Le membre et le prix ne s&apos;appliquent pas à une série.</div>
                </div>
              )}
            </div>
```

- [ ] **Step 6 : Vérifier compilation + tests existants du planning**

Run : `cd frontend && npx tsc --noEmit && npx jest planning`
Expected : aucune erreur TS ; si un test de planning existe, il reste vert.

- [ ] **Step 7 : Commit**

```bash
git add frontend/app/admin/planning/page.tsx
git commit -m "feat(cours): bloc Récurrence dans la modale de création du planning (Lot 1)"
```

---

### Task 11 : Bouton « Annuler la série » dans la modale de détail

**Files:**
- Modify: `frontend/app/admin/planning/page.tsx`

**Contexte :** la modale de détail (`selected`) affiche déjà type/paiement/annulation d'une réservation. On ajoute, **si la réservation appartient à une série** (`selected.seriesId`), un bouton « Annuler toute la série » à côté de l'annulation simple existante.

- [ ] **Step 1 : Exposer `seriesId` sur le type `ClubReservation`**

Dans `frontend/lib/api.ts`, sur l'interface `ClubReservation`, ajouter le champ optionnel :

```typescript
  seriesId?: string | null;
```

(le backend le renvoie déjà via `findMany` sur `Reservation` — `listClubReservations` sélectionne l'entité complète.)

> Vérifie que `listClubReservations` n'utilise pas un `select` qui exclut `seriesId`. Dans `reservation.service.ts`, l'`include` ne pose pas de `select` sur la réservation elle-même → `seriesId` est présent. OK.

- [ ] **Step 2 : Ajouter le handler d'annulation de série** (près de la fonction d'annulation simple existante dans le composant)

```tsx
  const cancelSeries = async () => {
    if (!token || !clubId || !selected?.seriesId) return;
    if (!confirm('Annuler toutes les séances FUTURES de cette série ? Le passé est conservé.')) return;
    setBusy(true);
    try {
      setError(null);
      const res = await api.adminCancelSeries(clubId, selected.seriesId, token);
      alert(`${res.cancelled} séance(s) future(s) annulée(s).`);
      setSelected(null);
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
```

> Adapte `selected`/`setSelected`/`setBusy`/`setError` aux noms exacts utilisés par la modale de détail (repère le bouton d'annulation simple existant et son `onClick`).

- [ ] **Step 3 : Ajouter le bouton dans la modale de détail**, à côté du bouton d'annulation simple existant, conditionné par `selected.seriesId` :

```tsx
{selected.seriesId && (
  <button type="button" onClick={cancelSeries} disabled={busy}
    style={{ border: '1px solid #ff7a4d', background: 'transparent', color: '#ff7a4d', borderRadius: 10, padding: '8px 14px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13, fontWeight: 700 }}>
    Annuler toute la série
  </button>
)}
```

- [ ] **Step 4 : Vérifier compilation + gate frontend**

Run : `cd frontend && npx tsc --noEmit && npx jest`
Expected : aucune erreur TS, tous les tests verts.

- [ ] **Step 5 : Commit**

```bash
git add frontend/lib/api.ts frontend/app/admin/planning/page.tsx
git commit -m "feat(cours): annulation d'une série depuis la modale de détail (Lot 1)"
```

---

## Vérification manuelle (navigateur)

Après le dernier commit, démarrer back (`npm run dev` dans `backend/`) + front (`npm run dev` dans `frontend/`) avec PostgreSQL + Redis up (`docker-compose-v1.exe up -d`), puis sur un sous-domaine club connecté en admin :

1. `/admin/coaches` : créer 2 coachs, en modifier un, en désactiver un (vérifier qu'il passe en grisé et disparaît des « actifs » en tête).
2. `/admin/planning` : « Ajouter » → activer « Répéter chaque semaine », choisir une date de fin à +4 semaines, type Coaching → vérifier le récap et que 5 blocs apparaissent les bons jours (un par semaine).
3. Créer une 2ᵉ série qui chevauche une séance existante → vérifier le message « X ignorée(s) ».
4. Ouvrir une séance de série → « Annuler toute la série » → vérifier que les séances futures disparaissent et que les passées restent.
5. Vérifier côté joueur (`/reserver`) que les créneaux des séances bloquent bien la réservation.

---

## Self-review (effectuée)

- **Couverture du spec (périmètre Lot 1)** : Coach (modèle T1 + service T2 + routes T3 + UI T9) ✓ ; `ReservationSeries` + `Reservation.seriesId` (T1) ✓ ; récurrence générique tous types (helper pur T4 + service T5 + routes T7 + UI T10) ✓ ; annulation de série (T6 + UI T11) ✓ ; saut des conflits + récap (T5) ✓ ; garde-fou `SERIES_TOO_LONG` (T4/T5) ✓. Les params « cours » de `ReservationSeries` sont **volontairement posés mais inutilisés** (Lot 2) — documenté dans le schéma et l'en-tête.
- **Placeholders** : aucun « TBD »/« TODO ». Les rares « adapte aux noms exacts » concernent l'alignement sur du code existant non recopié intégralement (modale de détail du planning, entrées de sidebar) et sont accompagnés d'un repère de localisation précis.
- **Cohérence des types/signatures** : `adminCreateSeries`/`adminCancelSeries` (service) ↔ `CreateSeriesBody`/`CreateSeriesResult` (api.ts) ↔ routes ↔ UI cohérents ; `weeklyOccurrences`/`SeriesSchedule`/`Occurrence`/`MAX_OCCURRENCES` partagés T4→T5 ; codes d'erreur `COACH_NOT_FOUND`/`SERIES_NOT_FOUND`/`SERIES_TOO_LONG` ajoutés à `ERROR_STATUS` (T3) et levés par les services (T2/T5/T6).
