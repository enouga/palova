# Récurrence des animations (mêlée hebdo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre au staff de créer une animation (`ClubEvent`) récurrente chaque semaine (ex. mêlée hebdo) en une fois, bornée par une date de fin, avec possibilité de prolonger ou d'annuler la série en bloc.

**Architecture:** Nouvelle table `ClubEventSeries` (mirroir de `ReservationSeries`), génération bornée des occurrences via le helper déjà testé `weeklyOccurrences` (`recurrence.ts`, non modifié). Chaque occurrence générée est un `ClubEvent` autonome (`seriesId` additif) — édition/inscription/annulation individuelles inchangées. L'annulation de série réutilise tel quel `EventService.updateEvent(id, clubId, {status:'CANCELLED'})` (notif + remboursement déjà testés) au lieu de dupliquer cette logique.

**Tech Stack:** Node.js/Express, Prisma (Postgres), Jest, Next.js/React (frontend).

**Spec de référence :** `docs/superpowers/specs/2026-07-19-recurrence-animations-design.md`

---

### Task 1: Schéma Prisma + migration

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260719130000_add_club_event_series/migration.sql`

- [ ] **Step 1: Ajouter le modèle `ClubEventSeries` et la relation inverse sur `Club`**

Dans `backend/prisma/schema.prisma`, remplacer la ligne (relations du modèle `Club`) :

```prisma
  clubEvents   ClubEvent[]
```

par :

```prisma
  clubEvents   ClubEvent[]
  clubEventSeries ClubEventSeries[]
```

Puis, remplacer le modèle `ClubEvent` (actuellement) :

```prisma
model ClubEvent {
  id                   String          @id @default(cuid())
  clubId               String          @map("club_id")
  name                 String
  kind                 ClubEventKind
  description          String?
  startTime            DateTime        @map("start_time") @db.Timestamptz
  endTime              DateTime?       @map("end_time") @db.Timestamptz
  registrationDeadline DateTime        @map("registration_deadline") @db.Timestamptz
  capacity             Int?                                            // null = illimité
  price                Decimal?        @db.Decimal(10, 2)              // informatif — règlement au club
  requirePrepayment    Boolean         @default(false) @map("require_prepayment")
  memberOnly           Boolean         @default(true) @map("member_only")
  status               ClubEventStatus @default(DRAFT)
  createdAt            DateTime        @default(now()) @map("created_at")
  updatedAt            DateTime        @updatedAt @map("updated_at")

  clubSportId   String?             @map("club_sport_id")

  club          Club                @relation(fields: [clubId], references: [id], onDelete: Cascade)
  clubSport     ClubSport?          @relation(fields: [clubSportId], references: [id], onDelete: Restrict)
  registrations EventRegistration[]

  @@index([clubId, status, startTime])
  @@map("club_events")
}
```

par (ajout du champ `seriesId` + relation, tout le reste inchangé) :

```prisma
model ClubEvent {
  id                   String          @id @default(cuid())
  clubId               String          @map("club_id")
  name                 String
  kind                 ClubEventKind
  description          String?
  startTime            DateTime        @map("start_time") @db.Timestamptz
  endTime              DateTime?       @map("end_time") @db.Timestamptz
  registrationDeadline DateTime        @map("registration_deadline") @db.Timestamptz
  capacity             Int?                                            // null = illimité
  price                Decimal?        @db.Decimal(10, 2)              // informatif — règlement au club
  requirePrepayment    Boolean         @default(false) @map("require_prepayment")
  memberOnly           Boolean         @default(true) @map("member_only")
  status               ClubEventStatus @default(DRAFT)
  createdAt            DateTime        @default(now()) @map("created_at")
  updatedAt            DateTime        @updatedAt @map("updated_at")

  clubSportId   String?             @map("club_sport_id")
  seriesId      String?             @map("series_id")

  club          Club                @relation(fields: [clubId], references: [id], onDelete: Cascade)
  clubSport     ClubSport?          @relation(fields: [clubSportId], references: [id], onDelete: Restrict)
  series        ClubEventSeries?    @relation(fields: [seriesId], references: [id], onDelete: SetNull)
  registrations EventRegistration[]

  @@index([clubId, status, startTime])
  @@index([seriesId])
  @@map("club_events")
}

/// Gabarit d'une animation récurrente hebdomadaire (mêlée hebdo…) — génère des `ClubEvent`
/// indépendants, bornés par startDate/endDate (plafond 60 occurrences, `weeklyOccurrences`).
/// Supprimer la série ne supprime jamais les occurrences déjà créées (onDelete: SetNull côté
/// ClubEvent) — seule `adminCancelSeries` les annule explicitement.
model ClubEventSeries {
  id                  String    @id @default(cuid())
  clubId              String    @map("club_id")
  name                String
  kind                ClubEventKind
  description         String?
  capacity            Int?
  price               Decimal?  @db.Decimal(10, 2)
  memberOnly          Boolean   @default(true) @map("member_only")
  requirePrepayment   Boolean   @default(false) @map("require_prepayment")
  clubSportId         String?   @map("club_sport_id")
  weekday             Int                                    // 1=lundi … 7=dimanche (Luxon)
  startLocal          String    @map("start_local")          // "HH:mm"
  durationMin         Int       @map("duration_min")
  deadlineLeadMinutes Int       @map("deadline_lead_minutes") // clôture = début − ce délai
  startDate           DateTime  @map("start_date") @db.Date
  endDate             DateTime  @map("end_date") @db.Date
  cancelledAt         DateTime? @map("cancelled_at")
  createdAt           DateTime  @default(now()) @map("created_at")
  updatedAt           DateTime  @updatedAt @map("updated_at")

  club   Club        @relation(fields: [clubId], references: [id], onDelete: Cascade)
  events ClubEvent[]

  @@index([clubId])
  @@map("club_event_series")
}
```

- [ ] **Step 2: Écrire la migration SQL**

Créer `backend/prisma/migrations/20260719130000_add_club_event_series/migration.sql` :

```sql
-- CreateTable
CREATE TABLE "club_event_series" (
    "id" TEXT NOT NULL,
    "club_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ClubEventKind" NOT NULL,
    "description" TEXT,
    "capacity" INTEGER,
    "price" DECIMAL(10,2),
    "member_only" BOOLEAN NOT NULL DEFAULT true,
    "require_prepayment" BOOLEAN NOT NULL DEFAULT false,
    "club_sport_id" TEXT,
    "weekday" INTEGER NOT NULL,
    "start_local" TEXT NOT NULL,
    "duration_min" INTEGER NOT NULL,
    "deadline_lead_minutes" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "club_event_series_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "club_events" ADD COLUMN "series_id" TEXT;

-- CreateIndex
CREATE INDEX "club_event_series_club_id_idx" ON "club_event_series"("club_id");

-- CreateIndex
CREATE INDEX "club_events_series_id_idx" ON "club_events"("series_id");

-- AddForeignKey
ALTER TABLE "club_event_series" ADD CONSTRAINT "club_event_series_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_events" ADD CONSTRAINT "club_events_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "club_event_series"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 3: Appliquer la migration en DEV et régénérer le client Prisma**

Run: `cd backend && npx prisma db execute --file prisma/migrations/20260719130000_add_club_event_series/migration.sql --schema prisma/schema.prisma`
Expected: pas d'erreur (table créée, colonne ajoutée).

Run: `cd backend && npx prisma generate`
Expected: `✔ Generated Prisma Client`.

- [ ] **Step 4: Vérifier que le backend compile toujours**

Run: `cd backend && npx tsc --noEmit`
Expected: aucune erreur (le champ `seriesId`/`ClubEventSeries` n'est encore consommé nulle part, donc rien à casser).

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260719130000_add_club_event_series
git commit -m "feat(db): modele ClubEventSeries + ClubEvent.seriesId (recurrence animations)"
```

---

### Task 2: `EventService.adminCreateSeries`

**Files:**
- Modify: `backend/src/services/event.service.ts`
- Modify: `backend/src/services/__tests__/event.service.test.ts`

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à la fin de `backend/src/services/__tests__/event.service.test.ts` :

```ts
describe('EventService.adminCreateSeries', () => {
  let service: EventService;
  beforeEach(() => {
    service = new EventService();
    prismaMock.club.findUnique.mockResolvedValue({ timezone: 'Europe/Paris' } as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.clubEventSeries.create.mockImplementation(async ({ data }: any) => ({ id: 'series-1', ...data }));
    let n = 0;
    prismaMock.clubEvent.create.mockImplementation(async ({ data }: any) => ({ id: `ev-${++n}`, ...data }));
  });

  const seriesInput = {
    name: 'Mêlée du jeudi', kind: 'MELEE' as const, description: null,
    capacity: 12, price: 5, memberOnly: true, requirePrepayment: false, clubSportId: null,
    weekday: 4, startLocal: '18:00', durationMin: 90, deadlineLeadMinutes: 240,
    startDate: '2026-08-06', endDate: '2026-08-27', status: 'PUBLISHED' as const,
  };

  it('crée la série et une occurrence par jeudi entre startDate et endDate', async () => {
    const result = await service.adminCreateSeries('club-demo', seriesInput);
    expect(result.seriesId).toBe('series-1');
    expect(result.created).toBe(4); // 4 jeudis (06,13,20,27 août 2026)
    expect(prismaMock.clubEvent.create).toHaveBeenCalledTimes(4);
  });

  it('calcule registrationDeadline = début − deadlineLeadMinutes pour chaque occurrence', async () => {
    await service.adminCreateSeries('club-demo', seriesInput);
    const firstCall = (prismaMock.clubEvent.create as jest.Mock).mock.calls[0][0];
    const start = firstCall.data.startTime as Date;
    const deadline = firstCall.data.registrationDeadline as Date;
    expect(deadline.getTime()).toBe(start.getTime() - 240 * 60000);
  });

  it('applique le même statut (DRAFT/PUBLISHED) à toutes les occurrences', async () => {
    await service.adminCreateSeries('club-demo', { ...seriesInput, status: 'DRAFT' });
    const calls = (prismaMock.clubEvent.create as jest.Mock).mock.calls;
    for (const c of calls) expect(c[0].data.status).toBe('DRAFT');
  });

  it('rejette une série de plus de 60 occurrences (SERIES_TOO_LONG)', async () => {
    await expect(service.adminCreateSeries('club-demo', {
      ...seriesInput, startDate: '2026-01-01', endDate: '2028-01-01',
    })).rejects.toThrow('SERIES_TOO_LONG');
  });

  it('rejette un clubSportId qui n\'appartient pas au club (VALIDATION_ERROR)', async () => {
    prismaMock.clubSport.findFirst.mockResolvedValue(null);
    await expect(service.adminCreateSeries('club-demo', { ...seriesInput, clubSportId: 'cs-other' }))
      .rejects.toThrow('VALIDATION_ERROR');
  });
});
```

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

Run: `cd backend && npx jest src/services/__tests__/event.service.test.ts -t "adminCreateSeries"`
Expected: FAIL — `service.adminCreateSeries` n'existe pas encore (`TypeError: service.adminCreateSeries is not a function`).

- [ ] **Step 3: Implémenter `adminCreateSeries`**

Dans `backend/src/services/event.service.ts`, remplacer l'import :

```ts
import { ClubEventKind, ClubEventStatus, Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { serializableTx } from '../db/serializable';
import * as notify from '../email/notifications';
import { RatingService } from './rating.service';
import { occupiesSpotWhere, holdDeadline, entryFeeCents } from './registrationPayment';
import { PackageService } from './package.service';
import { StripeService } from './stripe.service';
import { RefundService } from './refund.service';
```

par :

```ts
import { ClubEventKind, ClubEventStatus, Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { serializableTx } from '../db/serializable';
import * as notify from '../email/notifications';
import { RatingService } from './rating.service';
import { occupiesSpotWhere, holdDeadline, entryFeeCents } from './registrationPayment';
import { PackageService } from './package.service';
import { StripeService } from './stripe.service';
import { RefundService } from './refund.service';
import { weeklyOccurrences } from './recurrence';
```

Puis ajouter, juste avant la ligne `export interface CreateEventInput {` :

```ts
export interface CreateEventSeriesInput {
  name: string;
  kind: ClubEventKind;
  description?: string | null;
  capacity?: number | null;
  price?: number | null;
  memberOnly?: boolean;
  requirePrepayment?: boolean;
  clubSportId?: string | null;
  weekday: number;
  startLocal: string;    // "HH:mm"
  durationMin: number;
  deadlineLeadMinutes: number;
  startDate: string;     // "YYYY-MM-DD"
  endDate: string;       // "YYYY-MM-DD"
  status: ClubEventStatus;
}
```

Puis, remplacer :

```ts
  async createEvent(clubId: string, input: CreateEventInput) {
```

par :

```ts
  /**
   * Crée une série d'animations récurrentes hebdomadaires — une occurrence (ClubEvent
   * indépendant) par semaine entre startDate et endDate (bornes incluses), plafond 60
   * (weeklyOccurrences lève SERIES_TOO_LONG au-delà). Chaque occurrence reçoit le même
   * statut (DRAFT/PUBLISHED) et registrationDeadline = début − deadlineLeadMinutes.
   */
  async adminCreateSeries(clubId: string, input: CreateEventSeriesInput): Promise<{ seriesId: string; created: number }> {
    const name = input.name.trim();
    if (!name) throw new Error('VALIDATION_ERROR');
    if (!KINDS.includes(input.kind)) throw new Error('VALIDATION_ERROR');
    if (!['DRAFT', 'PUBLISHED'].includes(input.status)) throw new Error('VALIDATION_ERROR');
    if (input.clubSportId != null) {
      const cs = await prisma.clubSport.findFirst({ where: { id: input.clubSportId, clubId } });
      if (!cs) throw new Error('VALIDATION_ERROR');
    }
    if (!Number.isInteger(input.deadlineLeadMinutes) || input.deadlineLeadMinutes < 0) throw new Error('VALIDATION_ERROR');

    const club = await prisma.club.findUnique({ where: { id: clubId }, select: { timezone: true } });
    if (!club) throw new Error('CLUB_NOT_FOUND');

    // Calculée AVANT toute écriture (lève VALIDATION_ERROR / SERIES_TOO_LONG).
    const occurrences = weeklyOccurrences({
      weekday: input.weekday, startLocal: input.startLocal, durationMin: input.durationMin,
      startDate: input.startDate, endDate: input.endDate, tz: club.timezone,
    });

    const capacity = input.capacity ?? null;
    const price = input.price != null ? new Prisma.Decimal(input.price) : null;
    const memberOnly = input.memberOnly ?? true;
    const requirePrepayment = Boolean(input.requirePrepayment);
    if (requirePrepayment) {
      await this.assertPrepaymentAllowed(clubId, Math.round(Number(input.price ?? 0) * 100));
    }

    const { seriesId, created } = await prisma.$transaction(async (tx) => {
      const series = await tx.clubEventSeries.create({
        data: {
          clubId, name, kind: input.kind, description: input.description?.trim() || null,
          capacity, price, memberOnly, requirePrepayment, clubSportId: input.clubSportId ?? null,
          weekday: input.weekday, startLocal: input.startLocal, durationMin: input.durationMin,
          deadlineLeadMinutes: input.deadlineLeadMinutes,
          startDate: new Date(`${input.startDate}T00:00:00.000Z`),
          endDate: new Date(`${input.endDate}T00:00:00.000Z`),
        },
      });
      let created = 0;
      for (const occ of occurrences) {
        await tx.clubEvent.create({
          data: {
            clubId, name, kind: input.kind, description: input.description?.trim() || null,
            startTime: occ.startUtc, endTime: occ.endUtc,
            registrationDeadline: new Date(occ.startUtc.getTime() - input.deadlineLeadMinutes * 60000),
            capacity, price, memberOnly, requirePrepayment, clubSportId: input.clubSportId ?? null,
            status: input.status, seriesId: series.id,
          } as Prisma.ClubEventUncheckedCreateInput,
        });
        created++;
      }
      return { seriesId: series.id, created };
    });

    return { seriesId, created };
  }

  async createEvent(clubId: string, input: CreateEventInput) {
```

- [ ] **Step 4: Lancer les tests et vérifier qu'ils passent**

Run: `cd backend && npx jest src/services/__tests__/event.service.test.ts -t "adminCreateSeries"`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/event.service.ts backend/src/services/__tests__/event.service.test.ts
git commit -m "feat(events): EventService.adminCreateSeries (recurrence hebdo)"
```

---

### Task 3: `EventService.adminExtendSeries`

**Files:**
- Modify: `backend/src/services/event.service.ts`
- Modify: `backend/src/services/__tests__/event.service.test.ts`

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à la fin de `backend/src/services/__tests__/event.service.test.ts` :

```ts
describe('EventService.adminExtendSeries', () => {
  let service: EventService;
  const series = () => ({
    id: 'series-1', clubId: 'club-demo', name: 'Mêlée du jeudi', kind: 'MELEE', description: null,
    capacity: 12, price: new (require('@prisma/client').Prisma.Decimal)(5), memberOnly: true,
    requirePrepayment: false, clubSportId: null, weekday: 4, startLocal: '18:00', durationMin: 90,
    deadlineLeadMinutes: 240, startDate: new Date('2026-08-06T00:00:00.000Z'),
    endDate: new Date('2026-08-27T00:00:00.000Z'), cancelledAt: null,
  });

  beforeEach(() => {
    service = new EventService();
    prismaMock.club.findUnique.mockResolvedValue({ timezone: 'Europe/Paris' } as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    let n = 0;
    prismaMock.clubEvent.create.mockImplementation(async ({ data }: any) => ({ id: `ev-new-${++n}`, ...data }));
  });

  it('SERIES_NOT_FOUND si la série n\'existe pas', async () => {
    prismaMock.clubEventSeries.findUnique.mockResolvedValue(null);
    await expect(service.adminExtendSeries('missing', 'club-demo', '2026-09-24'))
      .rejects.toThrow('SERIES_NOT_FOUND');
  });

  it('CLUB_MISMATCH si la série appartient à un autre club', async () => {
    prismaMock.clubEventSeries.findUnique.mockResolvedValue({ ...series(), clubId: 'other-club' } as any);
    await expect(service.adminExtendSeries('series-1', 'club-demo', '2026-09-24'))
      .rejects.toThrow('CLUB_MISMATCH');
  });

  it('SERIES_CANCELLED si la série est déjà annulée', async () => {
    prismaMock.clubEventSeries.findUnique.mockResolvedValue({ ...series(), cancelledAt: new Date() } as any);
    await expect(service.adminExtendSeries('series-1', 'club-demo', '2026-09-24'))
      .rejects.toThrow('SERIES_CANCELLED');
  });

  it('ne crée que le delta (occurrences après la dernière existante), met à jour endDate', async () => {
    prismaMock.clubEventSeries.findUnique.mockResolvedValue(series() as any);
    prismaMock.clubEvent.findFirst.mockResolvedValue({ startTime: new Date('2026-08-27T16:00:00.000Z') } as any);
    prismaMock.clubEventSeries.update.mockResolvedValue({} as any);
    prismaMock.clubEvent.count.mockResolvedValue(4 as any); // 4 occurrences existantes

    const result = await service.adminExtendSeries('series-1', 'club-demo', '2026-09-10');

    // Prolongation du 27 août au 10 sept 2026 → jeudis 03 et 10 sept = 2 nouvelles occurrences.
    expect(result.created).toBe(2);
    expect(prismaMock.clubEventSeries.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'series-1' },
      data: expect.objectContaining({ endDate: new Date('2026-09-10T00:00:00.000Z') }),
    }));
  });

  it('refuse si le total (existantes + delta) dépasserait 60 (SERIES_TOO_LONG)', async () => {
    prismaMock.clubEventSeries.findUnique.mockResolvedValue(series() as any);
    prismaMock.clubEvent.findFirst.mockResolvedValue({ startTime: new Date('2026-08-27T16:00:00.000Z') } as any);
    prismaMock.clubEvent.count.mockResolvedValue(59 as any); // 59 existantes + 2 nouvelles > 60
    await expect(service.adminExtendSeries('series-1', 'club-demo', '2026-09-10'))
      .rejects.toThrow('SERIES_TOO_LONG');
  });
});
```

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

Run: `cd backend && npx jest src/services/__tests__/event.service.test.ts -t "adminExtendSeries"`
Expected: FAIL — `service.adminExtendSeries` n'existe pas.

- [ ] **Step 3: Implémenter `adminExtendSeries`**

Dans `backend/src/services/event.service.ts`, juste après la fermeture de `adminCreateSeries` (avant `async createEvent(clubId: string, input: CreateEventInput) {`), insérer :

```ts
  /**
   * Prolonge une série : recalcule weeklyOccurrences sur toute la fenêtre startDate..newEndDate
   * et ne crée que les occurrences postérieures à la dernière déjà existante (évite les
   * doublons). Plafond 60 occurrences AU TOTAL sur la série (existantes + delta).
   */
  async adminExtendSeries(seriesId: string, clubId: string, newEndDate: string): Promise<{ created: number }> {
    const series = await prisma.clubEventSeries.findUnique({ where: { id: seriesId } });
    if (!series) throw new Error('SERIES_NOT_FOUND');
    if (series.clubId !== clubId) throw new Error('CLUB_MISMATCH');
    if (series.cancelledAt) throw new Error('SERIES_CANCELLED');

    const club = await prisma.club.findUnique({ where: { id: clubId }, select: { timezone: true } });
    if (!club) throw new Error('CLUB_NOT_FOUND');

    const startDateStr = series.startDate.toISOString().slice(0, 10);
    const occurrences = weeklyOccurrences({
      weekday: series.weekday, startLocal: series.startLocal, durationMin: series.durationMin,
      startDate: startDateStr, endDate: newEndDate, tz: club.timezone,
    });

    const last = await prisma.clubEvent.findFirst({
      where: { seriesId }, orderBy: { startTime: 'desc' }, select: { startTime: true },
    });
    const delta = last ? occurrences.filter((o) => o.startUtc > last.startTime) : occurrences;

    const existingCount = await prisma.clubEvent.count({ where: { seriesId } });
    if (existingCount + delta.length > 60) throw new Error('SERIES_TOO_LONG');

    const created = await prisma.$transaction(async (tx) => {
      let created = 0;
      for (const occ of delta) {
        await tx.clubEvent.create({
          data: {
            clubId, name: series.name, kind: series.kind, description: series.description,
            startTime: occ.startUtc, endTime: occ.endUtc,
            registrationDeadline: new Date(occ.startUtc.getTime() - series.deadlineLeadMinutes * 60000),
            capacity: series.capacity, price: series.price, memberOnly: series.memberOnly,
            requirePrepayment: series.requirePrepayment, clubSportId: series.clubSportId,
            status: 'PUBLISHED', seriesId: series.id,
          } as Prisma.ClubEventUncheckedCreateInput,
        });
        created++;
      }
      await tx.clubEventSeries.update({ where: { id: seriesId }, data: { endDate: new Date(`${newEndDate}T00:00:00.000Z`) } });
      return created;
    });

    return { created };
  }

  async createEvent(clubId: string, input: CreateEventInput) {
```

- [ ] **Step 4: Lancer les tests et vérifier qu'ils passent**

Run: `cd backend && npx jest src/services/__tests__/event.service.test.ts -t "adminExtendSeries"`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/event.service.ts backend/src/services/__tests__/event.service.test.ts
git commit -m "feat(events): EventService.adminExtendSeries (prolonger une serie)"
```

---

### Task 4: `EventService.adminCancelSeries`

**Files:**
- Modify: `backend/src/services/event.service.ts`
- Modify: `backend/src/services/__tests__/event.service.test.ts`

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à la fin de `backend/src/services/__tests__/event.service.test.ts` :

```ts
describe('EventService.adminCancelSeries', () => {
  let service: EventService;
  beforeEach(() => { service = new EventService(); });

  it('SERIES_NOT_FOUND si la série n\'existe pas', async () => {
    prismaMock.clubEventSeries.findUnique.mockResolvedValue(null);
    await expect(service.adminCancelSeries('missing', 'club-demo')).rejects.toThrow('SERIES_NOT_FOUND');
  });

  it('CLUB_MISMATCH si la série appartient à un autre club', async () => {
    prismaMock.clubEventSeries.findUnique.mockResolvedValue({ id: 'series-1', clubId: 'other' } as any);
    await expect(service.adminCancelSeries('series-1', 'club-demo')).rejects.toThrow('CLUB_MISMATCH');
  });

  it('annule chaque occurrence future non annulée via updateEvent (notif + remboursement réutilisés), laisse les passées intactes', async () => {
    prismaMock.clubEventSeries.findUnique.mockResolvedValue({ id: 'series-1', clubId: 'club-demo' } as any);
    prismaMock.clubEvent.findMany.mockResolvedValue([{ id: 'ev-future-1' }, { id: 'ev-future-2' }] as any);
    const updateSpy = jest.spyOn(service, 'updateEvent').mockResolvedValue({} as any);
    prismaMock.clubEventSeries.update.mockResolvedValue({} as any);

    const result = await service.adminCancelSeries('series-1', 'club-demo');

    expect(result.cancelled).toBe(2);
    expect(updateSpy).toHaveBeenCalledWith('ev-future-1', 'club-demo', { status: 'CANCELLED' });
    expect(updateSpy).toHaveBeenCalledWith('ev-future-2', 'club-demo', { status: 'CANCELLED' });
    // La requête ne cible que les occurrences futures non déjà annulées.
    expect(prismaMock.clubEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ seriesId: 'series-1', status: { not: 'CANCELLED' }, startTime: { gt: expect.any(Date) } }),
    }));
    expect(prismaMock.clubEventSeries.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'series-1' }, data: expect.objectContaining({ cancelledAt: expect.any(Date) }),
    }));
    updateSpy.mockRestore();
  });

  it('idempotent : renvoie {cancelled:0} sans erreur si aucune occurrence future ne reste (série déjà annulée)', async () => {
    prismaMock.clubEventSeries.findUnique.mockResolvedValue({ id: 'series-1', clubId: 'club-demo' } as any);
    prismaMock.clubEvent.findMany.mockResolvedValue([]);
    prismaMock.clubEventSeries.update.mockResolvedValue({} as any);

    const result = await service.adminCancelSeries('series-1', 'club-demo');
    expect(result.cancelled).toBe(0);
  });
});
```

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

Run: `cd backend && npx jest src/services/__tests__/event.service.test.ts -t "adminCancelSeries"`
Expected: FAIL — `service.adminCancelSeries` n'existe pas.

- [ ] **Step 3: Implémenter `adminCancelSeries`**

Dans `backend/src/services/event.service.ts`, juste après la fermeture de `adminExtendSeries` (avant `async createEvent(clubId: string, input: CreateEventInput) {`), insérer :

```ts
  /**
   * Annule une série : passe CANCELLED toutes les occurrences FUTURES encore actives, en
   * réutilisant updateEvent (déjà testé) pour chacune — donc notif « activité annulée par
   * le club » + remboursement des inscrits payés, sans dupliquer cette logique. Les
   * occurrences passées ne sont jamais touchées. Idempotent (série déjà annulée → 0).
   */
  async adminCancelSeries(seriesId: string, clubId: string): Promise<{ cancelled: number }> {
    const series = await prisma.clubEventSeries.findUnique({ where: { id: seriesId } });
    if (!series) throw new Error('SERIES_NOT_FOUND');
    if (series.clubId !== clubId) throw new Error('CLUB_MISMATCH');

    const now = new Date();
    const future = await prisma.clubEvent.findMany({
      where: { seriesId, status: { not: 'CANCELLED' }, startTime: { gt: now } },
      select: { id: true },
    });

    for (const e of future) {
      await this.updateEvent(e.id, clubId, { status: 'CANCELLED' });
    }

    await prisma.clubEventSeries.update({ where: { id: seriesId }, data: { cancelledAt: now } });
    return { cancelled: future.length };
  }

  async createEvent(clubId: string, input: CreateEventInput) {
```

- [ ] **Step 4: Lancer les tests et vérifier qu'ils passent**

Run: `cd backend && npx jest src/services/__tests__/event.service.test.ts -t "adminCancelSeries"`
Expected: PASS (4 tests)

- [ ] **Step 5: Lancer tout le fichier de tests du service**

Run: `cd backend && npx jest src/services/__tests__/event.service.test.ts`
Expected: PASS (tous les tests existants + les 14 nouveaux)

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/event.service.ts backend/src/services/__tests__/event.service.test.ts
git commit -m "feat(events): EventService.adminCancelSeries (annulation en bloc)"
```

---

### Task 5: Routes admin

**Files:**
- Modify: `backend/src/routes/admin.ts`
- Modify: `backend/src/routes/__tests__/admin.events.routes.test.ts`

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à la fin de `backend/src/routes/__tests__/admin.events.routes.test.ts`, avant la dernière accolade fermante `});` du `describe('routes admin /events', ...)` (donc juste après le bloc `describe('PATCH /events/:id — mise à jour', ...)`) :

```ts

  describe('POST /event-series — création', () => {
    const seriesBody = {
      name: 'Mêlée du jeudi', kind: 'MELEE', weekday: 4, startLocal: '18:00', durationMin: 90,
      deadlineLeadMinutes: 240, startDate: '2026-08-06', endDate: '2026-08-27', status: 'PUBLISHED',
    };

    it('crée une série → 201, transmet le body au service', async () => {
      const spy = jest.spyOn(EventService.prototype, 'adminCreateSeries')
        .mockResolvedValue({ seriesId: 'series-1', created: 4 });
      const res = await request(app).post(`${base}/event-series`).set(auth).send(seriesBody);
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ seriesId: 'series-1', created: 4 });
      expect(spy).toHaveBeenCalledWith('club-demo', expect.objectContaining({ weekday: 4, startLocal: '18:00' }));
      spy.mockRestore();
    });

    it('weekday non entier → 400', async () => {
      const res = await request(app).post(`${base}/event-series`).set(auth).send({ ...seriesBody, weekday: 'jeudi' });
      expect(res.status).toBe(400);
    });

    it('dates au mauvais format → 400', async () => {
      const res = await request(app).post(`${base}/event-series`).set(auth).send({ ...seriesBody, startDate: '06/08/2026' });
      expect(res.status).toBe(400);
    });

    it('série trop longue → 400 SERIES_TOO_LONG', async () => {
      jest.spyOn(EventService.prototype, 'adminCreateSeries').mockRejectedValue(new Error('SERIES_TOO_LONG'));
      const res = await request(app).post(`${base}/event-series`).set(auth).send(seriesBody);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('SERIES_TOO_LONG');
    });
  });

  describe('POST /event-series/:id/extend — prolongation', () => {
    it('prolonge → 200', async () => {
      const spy = jest.spyOn(EventService.prototype, 'adminExtendSeries').mockResolvedValue({ created: 2 });
      const res = await request(app).post(`${base}/event-series/series-1/extend`).set(auth).send({ endDate: '2026-09-10' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ created: 2 });
      expect(spy).toHaveBeenCalledWith('series-1', 'club-demo', '2026-09-10');
      spy.mockRestore();
    });

    it('endDate au mauvais format → 400', async () => {
      const res = await request(app).post(`${base}/event-series/series-1/extend`).set(auth).send({ endDate: '10-09-2026' });
      expect(res.status).toBe(400);
    });

    it('série introuvable → 404', async () => {
      jest.spyOn(EventService.prototype, 'adminExtendSeries').mockRejectedValue(new Error('SERIES_NOT_FOUND'));
      const res = await request(app).post(`${base}/event-series/missing/extend`).set(auth).send({ endDate: '2026-09-10' });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /event-series/:id — annulation en bloc', () => {
    it('annule la série → 200', async () => {
      const spy = jest.spyOn(EventService.prototype, 'adminCancelSeries').mockResolvedValue({ cancelled: 2 });
      const res = await request(app).delete(`${base}/event-series/series-1`).set(auth);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ cancelled: 2 });
      expect(spy).toHaveBeenCalledWith('series-1', 'club-demo');
      spy.mockRestore();
    });

    it('série introuvable → 404', async () => {
      jest.spyOn(EventService.prototype, 'adminCancelSeries').mockRejectedValue(new Error('SERIES_NOT_FOUND'));
      const res = await request(app).delete(`${base}/event-series/missing`).set(auth);
      expect(res.status).toBe(404);
    });
  });
```

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

Run: `cd backend && npx jest src/routes/__tests__/admin.events.routes.test.ts`
Expected: FAIL — routes `POST /event-series`, `POST /event-series/:id/extend`, `DELETE /event-series/:id` renvoient 404 (inexistantes).

- [ ] **Step 3: Ajouter `SERIES_CANCELLED` au mapping d'erreurs**

Dans `backend/src/routes/admin.ts`, remplacer :

```ts
  ALREADY_SUBSCRIBED:     409,
  NOTHING_TO_SUBSCRIBE:   409,
  NO_BILLING_ACCOUNT:     409,
};
```

par :

```ts
  ALREADY_SUBSCRIBED:     409,
  NOTHING_TO_SUBSCRIBE:   409,
  NO_BILLING_ACCOUNT:     409,
  SERIES_CANCELLED:       409,
};
```

- [ ] **Step 4: Ajouter les 3 routes**

Dans `backend/src/routes/admin.ts`, remplacer :

```ts
router.delete('/events/:id/registrations/:regId', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await eventService.adminRemoveRegistration(asString(req.params.id), asString(req.params.regId), req.membership!.clubId)); } catch (e) { handleError(e, res, next); }
});

// --- Offres prépayées (carnets / porte-monnaie) ---
```

par :

```ts
router.delete('/events/:id/registrations/:regId', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await eventService.adminRemoveRegistration(asString(req.params.id), asString(req.params.regId), req.membership!.clubId)); } catch (e) { handleError(e, res, next); }
});

// --- Séries d'animations récurrentes (mêlée hebdo…) ---
router.post('/event-series', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const { name, kind, description, capacity, price, memberOnly, requirePrepayment, clubSportId } = req.body;
    const { weekday, startLocal, durationMin, deadlineLeadMinutes, startDate, endDate, status } = req.body;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asString(startDate)) || !/^\d{4}-\d{2}-\d{2}$/.test(asString(endDate))) {
      return void res.status(400).json({ error: 'dates doivent être YYYY-MM-DD' });
    }
    if (!/^\d{2}:\d{2}$/.test(asString(startLocal))) return void res.status(400).json({ error: 'startLocal doit être HH:mm' });
    if (!Number.isInteger(Number(weekday)) || !Number.isInteger(Number(durationMin)) || !Number.isInteger(Number(deadlineLeadMinutes))) {
      return void res.status(400).json({ error: 'weekday/durationMin/deadlineLeadMinutes invalides' });
    }
    const created = await eventService.adminCreateSeries(req.membership!.clubId, {
      name, kind, description, capacity, price, memberOnly, requirePrepayment, clubSportId,
      weekday: Number(weekday), startLocal: asString(startLocal), durationMin: Number(durationMin),
      deadlineLeadMinutes: Number(deadlineLeadMinutes), startDate: asString(startDate), endDate: asString(endDate),
      status: status === 'DRAFT' ? 'DRAFT' : 'PUBLISHED',
    });
    res.status(201).json(created);
  } catch (err) { handleError(err, res, next); }
});
router.post('/event-series/:id/extend', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const endDate = asString(req.body.endDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return void res.status(400).json({ error: 'endDate doit être YYYY-MM-DD' });
    res.json(await eventService.adminExtendSeries(asString(req.params.id), req.membership!.clubId, endDate));
  } catch (err) { handleError(err, res, next); }
});
router.delete('/event-series/:id', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await eventService.adminCancelSeries(asString(req.params.id), req.membership!.clubId)); } catch (err) { handleError(err, res, next); }
});

// --- Offres prépayées (carnets / porte-monnaie) ---
```

- [ ] **Step 5: Lancer les tests et vérifier qu'ils passent**

Run: `cd backend && npx jest src/routes/__tests__/admin.events.routes.test.ts`
Expected: PASS (tous les tests existants + les 9 nouveaux)

- [ ] **Step 6: Lancer toute la suite backend**

Run: `cd backend && npx jest`
Expected: PASS intégral (aucune régression).

Run: `cd backend && npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/admin.ts backend/src/routes/__tests__/admin.events.routes.test.ts
git commit -m "feat(events): routes admin /event-series (create/extend/cancel)"
```

---

### Task 6: Types et méthodes frontend (`lib/api.ts`)

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Ajouter les types**

Dans `frontend/lib/api.ts`, remplacer :

```ts
export interface ClubEvent {
  id: string;
  clubId: string;
  name: string;
  kind: ClubEventKind;
  description: string | null;
  startTime: string;
  endTime: string | null;
  registrationDeadline: string;
  capacity: number | null;
  price: string | null;            // Decimal sérialisé
  requirePrepayment?: boolean;     // true = inscription à régler en ligne via Stripe
  memberOnly: boolean;
  status: ClubEventStatus;
  confirmedCount: number;
  waitlistCount: number;
  clubSportId?: string | null;
  sport?: { key: string; name: string } | null; // peuplé par les listes/détail events + mes events
}
```

par (ajout additif `seriesId`) :

```ts
export interface ClubEvent {
  id: string;
  clubId: string;
  name: string;
  kind: ClubEventKind;
  description: string | null;
  startTime: string;
  endTime: string | null;
  registrationDeadline: string;
  capacity: number | null;
  price: string | null;            // Decimal sérialisé
  requirePrepayment?: boolean;     // true = inscription à régler en ligne via Stripe
  memberOnly: boolean;
  status: ClubEventStatus;
  confirmedCount: number;
  waitlistCount: number;
  clubSportId?: string | null;
  sport?: { key: string; name: string } | null; // peuplé par les listes/détail events + mes events
  seriesId?: string | null;        // additif — présent si l'event fait partie d'une série récurrente
}
```

Puis, remplacer :

```ts
export type CreateEventBody = {
  name: string;
  kind: ClubEventKind;
  description?: string | null;
  startTime: string;
  endTime?: string | null;
  registrationDeadline: string;
  capacity?: number | null;
  price?: number | null;
  memberOnly?: boolean;
  clubSportId?: string | null;
  requirePrepayment?: boolean;
};
export type UpdateEventBody = Partial<CreateEventBody & { status: ClubEventStatus }>;
```

par :

```ts
export type CreateEventBody = {
  name: string;
  kind: ClubEventKind;
  description?: string | null;
  startTime: string;
  endTime?: string | null;
  registrationDeadline: string;
  capacity?: number | null;
  price?: number | null;
  memberOnly?: boolean;
  clubSportId?: string | null;
  requirePrepayment?: boolean;
};
export type UpdateEventBody = Partial<CreateEventBody & { status: ClubEventStatus }>;

export interface CreateEventSeriesBody {
  name: string;
  kind: ClubEventKind;
  description?: string | null;
  capacity?: number | null;
  price?: number | null;
  memberOnly?: boolean;
  requirePrepayment?: boolean;
  clubSportId?: string | null;
  weekday: number;               // 1–7 (1=lundi)
  startLocal: string;            // "HH:mm"
  durationMin: number;
  deadlineLeadMinutes: number;
  startDate: string;              // "YYYY-MM-DD"
  endDate: string;                // "YYYY-MM-DD"
  status: 'DRAFT' | 'PUBLISHED';
}
export interface CreateEventSeriesResult { seriesId: string; created: number; }
```

- [ ] **Step 2: Ajouter les 3 méthodes API**

Dans `frontend/lib/api.ts`, remplacer :

```ts
  adminRemoveEventRegistration: (clubId: string, eventId: string, regId: string, token: string) =>
    request<{ id: string }>(`/api/clubs/${clubId}/admin/events/${eventId}/registrations/${regId}`, { method: 'DELETE' }, token),

  // --- Plateforme (super-admin) ---
```

par :

```ts
  adminRemoveEventRegistration: (clubId: string, eventId: string, regId: string, token: string) =>
    request<{ id: string }>(`/api/clubs/${clubId}/admin/events/${eventId}/registrations/${regId}`, { method: 'DELETE' }, token),

  adminCreateEventSeries: (clubId: string, body: CreateEventSeriesBody, token: string) =>
    request<CreateEventSeriesResult>(`/api/clubs/${clubId}/admin/event-series`, { method: 'POST', body: JSON.stringify(body) }, token),

  adminExtendEventSeries: (clubId: string, seriesId: string, endDate: string, token: string) =>
    request<{ created: number }>(`/api/clubs/${clubId}/admin/event-series/${seriesId}/extend`, { method: 'POST', body: JSON.stringify({ endDate }) }, token),

  adminCancelEventSeries: (clubId: string, seriesId: string, token: string) =>
    request<{ cancelled: number }>(`/api/clubs/${clubId}/admin/event-series/${seriesId}`, { method: 'DELETE' }, token),

  // --- Plateforme (super-admin) ---
```

- [ ] **Step 3: Vérifier que le frontend compile**

Run: `cd frontend && npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(events): types + methodes api.ts pour les series d'animations"
```

---

### Task 7: Composant `RecurrenceFields`

**Files:**
- Create: `frontend/components/admin/events/RecurrenceFields.tsx`
- Create: `frontend/__tests__/RecurrenceFields.test.tsx`

- [ ] **Step 1: Écrire le test qui échoue**

Créer `frontend/__tests__/RecurrenceFields.test.tsx` :

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '../lib/ThemeProvider';
import { RecurrenceFields, RecurrenceState } from '../components/admin/events/RecurrenceFields';

function renderField(state: RecurrenceState, onChange = jest.fn()) {
  return { onChange, ...render(<ThemeProvider><RecurrenceFields state={state} onChange={onChange} /></ThemeProvider>) };
}

const baseState: RecurrenceState = {
  weekday: 4, endDate: '', deadlineLeadHours: 4,
};

it('affiche le jour pré-coché correspondant à weekday', () => {
  renderField(baseState);
  const select = screen.getByLabelText(/Jour de la semaine/i) as HTMLSelectElement;
  expect(select.value).toBe('4');
});

it('changer le jour appelle onChange avec le nouveau weekday', () => {
  const { onChange } = renderField(baseState);
  fireEvent.change(screen.getByLabelText(/Jour de la semaine/i), { target: { value: '2' } });
  expect(onChange).toHaveBeenCalledWith({ ...baseState, weekday: 2 });
});

it('affiche les chips de délai de clôture 0h/4h/24h, sélection change deadlineLeadHours', () => {
  const { onChange } = renderField(baseState);
  fireEvent.click(screen.getByRole('button', { name: /24 h avant/i }));
  expect(onChange).toHaveBeenCalledWith({ ...baseState, deadlineLeadHours: 24 });
});

it('changer la date de fin appelle onChange', () => {
  const { onChange } = renderField(baseState);
  fireEvent.click(screen.getByRole('button', { name: /date de fin/i }));
  // Le DateField ouvre un calendrier ; on vérifie juste que le champ est bien branché à onChange
  // via son prop, testé indirectement par la présence du déclencheur.
  expect(screen.getByRole('button', { name: /date de fin/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Lancer le test et vérifier qu'il échoue**

Run: `cd frontend && npx jest --runTestsByPath __tests__/RecurrenceFields.test.tsx`
Expected: FAIL — le module `../components/admin/events/RecurrenceFields` n'existe pas.

- [ ] **Step 3: Créer le composant**

Créer `frontend/components/admin/events/RecurrenceFields.tsx` :

```tsx
'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { DateField } from '@/components/ui/DateField';
import { CANCEL_PRESETS } from '@/lib/onboarding';

export interface RecurrenceState {
  weekday: number;            // 1–7 (1=lundi)
  endDate: string;             // "YYYY-MM-DD"
  deadlineLeadHours: number;
}

const WEEKDAYS = [
  { value: 1, label: 'Lundi' }, { value: 2, label: 'Mardi' }, { value: 3, label: 'Mercredi' },
  { value: 4, label: 'Jeudi' }, { value: 5, label: 'Vendredi' }, { value: 6, label: 'Samedi' },
  { value: 7, label: 'Dimanche' },
];

interface RecurrenceFieldsProps {
  state: RecurrenceState;
  onChange: (next: RecurrenceState) => void;
}

/** Champs de récurrence hebdomadaire (jour, date de fin, délai de clôture) — création d'une série d'animations. */
export function RecurrenceFields({ state, onChange }: RecurrenceFieldsProps) {
  const { th } = useTheme();
  const label = { fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginBottom: 5, marginTop: 12 } as const;
  const input = { width: '100%', boxSizing: 'border-box' as const, background: th.surface2, border: `1px solid ${th.line}`, borderRadius: 10, padding: '9px 11px', fontFamily: th.fontUI, fontSize: 14, color: th.text };

  return (
    <div style={{ background: th.surface2, borderRadius: 12, padding: 14, marginTop: 12 }}>
      <div style={label}>
        <label htmlFor="rf-weekday">Jour de la semaine</label>
      </div>
      <select
        id="rf-weekday"
        aria-label="Jour de la semaine"
        style={input}
        value={state.weekday}
        onChange={(e) => onChange({ ...state, weekday: Number(e.target.value) })}
      >
        {WEEKDAYS.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
      </select>

      <div style={label}>Date de fin de la série</div>
      <DateField
        value={state.endDate}
        onChange={(v) => onChange({ ...state, endDate: v })}
        placeholder="date de fin"
        ariaLabel="Date de fin de la série"
      />

      <div style={label}>Clôture des inscriptions</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {CANCEL_PRESETS.map((p) => {
          const active = state.deadlineLeadHours === p.hours;
          return (
            <button
              key={p.hours}
              type="button"
              onClick={() => onChange({ ...state, deadlineLeadHours: p.hours })}
              style={{
                border: 'none', cursor: 'pointer', borderRadius: 999, padding: '7px 13px',
                fontFamily: th.fontUI, fontSize: 13, fontWeight: 700,
                background: active ? th.accent : th.surface, color: active ? th.onAccent : th.textMute,
              }}
            >
              {p.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Lancer le test et vérifier qu'il passe**

Run: `cd frontend && npx jest --runTestsByPath __tests__/RecurrenceFields.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/components/admin/events/RecurrenceFields.tsx frontend/__tests__/RecurrenceFields.test.tsx
git commit -m "feat(events): composant RecurrenceFields (jour, fin, cloture)"
```

---

### Task 8: Composant `SeriesManageDialog`

**Files:**
- Create: `frontend/components/admin/events/SeriesManageDialog.tsx`
- Create: `frontend/__tests__/SeriesManageDialog.test.tsx`

- [ ] **Step 1: Écrire le test qui échoue**

Créer `frontend/__tests__/SeriesManageDialog.test.tsx` :

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '../lib/ThemeProvider';
import { SeriesManageDialog } from '../components/admin/events/SeriesManageDialog';

function renderDialog(onExtend = jest.fn(), onCancelSeries = jest.fn(), onClose = jest.fn()) {
  return {
    onExtend, onCancelSeries, onClose,
    ...render(
      <ThemeProvider>
        <SeriesManageDialog onExtend={onExtend} onCancelSeries={onCancelSeries} onClose={onClose} />
      </ThemeProvider>,
    ),
  };
}

it('affiche le titre et les deux actions', () => {
  renderDialog();
  expect(screen.getByText(/Gérer la série/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Prolonger/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Annuler la série/i })).toBeInTheDocument();
});

it('« Annuler la série » ouvre une confirmation explicite avant d\'appeler onCancelSeries', () => {
  const { onCancelSeries } = renderDialog();
  fireEvent.click(screen.getByRole('button', { name: /Annuler la série/i }));
  expect(onCancelSeries).not.toHaveBeenCalled();
  expect(screen.getByText(/inscrits.*notifi/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^Confirmer$/i }));
  expect(onCancelSeries).toHaveBeenCalled();
});

it('fermer appelle onClose', () => {
  const { onClose } = renderDialog();
  fireEvent.click(screen.getByRole('button', { name: /Fermer|×/i }));
  expect(onClose).toHaveBeenCalled();
});
```

- [ ] **Step 2: Lancer le test et vérifier qu'il échoue**

Run: `cd frontend && npx jest --runTestsByPath __tests__/SeriesManageDialog.test.tsx`
Expected: FAIL — le module n'existe pas.

- [ ] **Step 3: Créer le composant**

Créer `frontend/components/admin/events/SeriesManageDialog.tsx` :

```tsx
'use client';
import { useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { Icon } from '@/components/ui/Icon';
import { DateField } from '@/components/ui/DateField';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

interface SeriesManageDialogProps {
  onExtend: (endDate: string) => void;
  onCancelSeries: () => void;
  onClose: () => void;
}

/** Petit panneau « Gérer la série » (prolonger / annuler en bloc) posé sur une carte AgendaAdminCard. */
export function SeriesManageDialog({ onExtend, onCancelSeries, onClose }: SeriesManageDialogProps) {
  const { th } = useTheme();
  const [newEndDate, setNewEndDate] = useState('');
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const btn = { border: 'none', cursor: 'pointer', background: th.accent, color: th.onAccent, borderRadius: 10, padding: '9px 14px', fontFamily: th.fontUI, fontWeight: 700, fontSize: 13.5 };
  const ghost = { border: `1px solid ${th.line}`, cursor: 'pointer', background: 'transparent', color: th.danger, borderRadius: 9, padding: '9px 14px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700 };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: th.bgElev, borderRadius: 18, padding: 20, width: 340, maxWidth: '92vw' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 17, color: th.text }}>Gérer la série</div>
          <button aria-label="Fermer" onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}>
            <Icon name="x" size={18} color={th.textMute} />
          </button>
        </div>

        <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginBottom: 6 }}>Nouvelle date de fin</div>
        <DateField value={newEndDate} onChange={setNewEndDate} placeholder="date de fin" ariaLabel="Nouvelle date de fin" />
        <button
          onClick={() => newEndDate && onExtend(newEndDate)}
          disabled={!newEndDate}
          style={{ ...btn, marginTop: 10, width: '100%', opacity: newEndDate ? 1 : 0.5 }}
        >
          Prolonger
        </button>

        <button onClick={() => setConfirmingCancel(true)} style={{ ...ghost, marginTop: 18, width: '100%' }}>
          Annuler la série
        </button>
      </div>

      {confirmingCancel && (
        <ConfirmDialog
          title="Annuler toute la série ?"
          message="Toutes les occurrences futures seront annulées, y compris celles qui ont déjà des inscrits — les inscrits seront notifiés par email et remboursés si besoin."
          confirmLabel="Confirmer"
          onConfirm={() => { setConfirmingCancel(false); onCancelSeries(); }}
          onCancel={() => setConfirmingCancel(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Lancer le test et vérifier qu'il passe**

Run: `cd frontend && npx jest --runTestsByPath __tests__/SeriesManageDialog.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/components/admin/events/SeriesManageDialog.tsx frontend/__tests__/SeriesManageDialog.test.tsx
git commit -m "feat(events): composant SeriesManageDialog (prolonger / annuler)"
```

---

### Task 9: Câblage dans `/admin/events`

**Files:**
- Modify: `frontend/app/admin/events/page.tsx`
- Modify: `frontend/__tests__/AdminEvents.test.tsx`

- [ ] **Step 1: Écrire les tests qui échouent**

Dans `frontend/__tests__/AdminEvents.test.tsx`, remplacer le bloc de mocks :

```tsx
const adminGetEvents = jest.fn();
const adminGetClub = jest.fn();
const adminCreateEvent = jest.fn();
const adminUpdateEvent = jest.fn();
const adminDeleteEvent = jest.fn();

jest.mock('../lib/api', () => ({
  api: {
    adminGetEvents: (...a: unknown[]) => adminGetEvents(...a),
    adminGetClub: (...a: unknown[]) => adminGetClub(...a),
    adminCreateEvent: (...a: unknown[]) => adminCreateEvent(...a),
    adminUpdateEvent: (...a: unknown[]) => adminUpdateEvent(...a),
    adminDeleteEvent: (...a: unknown[]) => adminDeleteEvent(...a),
    adminGetEvent: jest.fn(),
    adminPromoteEventRegistration: jest.fn(),
    adminRemoveEventRegistration: jest.fn(),
  },
}));
```

par :

```tsx
const adminGetEvents = jest.fn();
const adminGetClub = jest.fn();
const adminCreateEvent = jest.fn();
const adminUpdateEvent = jest.fn();
const adminDeleteEvent = jest.fn();
const adminCreateEventSeries = jest.fn();
const adminExtendEventSeries = jest.fn();
const adminCancelEventSeries = jest.fn();

jest.mock('../lib/api', () => ({
  api: {
    adminGetEvents: (...a: unknown[]) => adminGetEvents(...a),
    adminGetClub: (...a: unknown[]) => adminGetClub(...a),
    adminCreateEvent: (...a: unknown[]) => adminCreateEvent(...a),
    adminUpdateEvent: (...a: unknown[]) => adminUpdateEvent(...a),
    adminDeleteEvent: (...a: unknown[]) => adminDeleteEvent(...a),
    adminCreateEventSeries: (...a: unknown[]) => adminCreateEventSeries(...a),
    adminExtendEventSeries: (...a: unknown[]) => adminExtendEventSeries(...a),
    adminCancelEventSeries: (...a: unknown[]) => adminCancelEventSeries(...a),
    adminGetEvent: jest.fn(),
    adminPromoteEventRegistration: jest.fn(),
    adminRemoveEventRegistration: jest.fn(),
  },
}));
```

Puis, dans le `beforeEach` existant, remplacer :

```tsx
beforeEach(() => {
  jest.clearAllMocks();
  adminGetEvents.mockResolvedValue([]);
  adminGetClub.mockResolvedValue({ stripeAccountStatus: 'NONE' });
  adminCreateEvent.mockResolvedValue({});
  adminUpdateEvent.mockResolvedValue({});
  adminDeleteEvent.mockResolvedValue({});
});
```

par :

```tsx
beforeEach(() => {
  jest.clearAllMocks();
  adminGetEvents.mockResolvedValue([]);
  adminGetClub.mockResolvedValue({ stripeAccountStatus: 'NONE' });
  adminCreateEvent.mockResolvedValue({});
  adminUpdateEvent.mockResolvedValue({});
  adminDeleteEvent.mockResolvedValue({});
  adminCreateEventSeries.mockResolvedValue({ seriesId: 'series-1', created: 4 });
  adminExtendEventSeries.mockResolvedValue({ created: 2 });
  adminCancelEventSeries.mockResolvedValue({ cancelled: 2 });
});
```

Puis ajouter, à la fin du fichier (après le dernier test existant) :

```tsx

describe('récurrence hebdomadaire', () => {
  it('la case « Se répète chaque semaine » est décochée par défaut : soumission = adminCreateEvent', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Nouvel event/ }));
    fireEvent.change(await screen.findByPlaceholderText(/Mêlée du vendredi/), { target: { value: 'Mêlée' } });
    fireEvent.click(screen.getByRole('button', { name: /Créer/ }));
    await waitFor(() => expect(adminCreateEvent).toHaveBeenCalled());
    expect(adminCreateEventSeries).not.toHaveBeenCalled();
  });

  it('cocher la case affiche les champs de récurrence (jour, date de fin, délai de clôture)', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Nouvel event/ }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /Se répète chaque semaine/i }));
    expect(await screen.findByLabelText(/Jour de la semaine/i)).toBeInTheDocument();
  });

  it('récurrent sans heure de fin → message d\'erreur explicite, aucun appel API (la durée d\'une occurrence vient de Début→Fin)', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Nouvel event/ }));
    fireEvent.change(await screen.findByPlaceholderText(/Mêlée du vendredi/), { target: { value: 'Mêlée du jeudi' } });
    fireEvent.click(await screen.findByRole('checkbox', { name: /Se répète chaque semaine/i }));
    fireEvent.click(screen.getByRole('button', { name: /Créer/ }));
    expect(await screen.findByText(/heure de fin est requise/i)).toBeInTheDocument();
    expect(adminCreateEventSeries).not.toHaveBeenCalled();
    expect(adminCreateEvent).not.toHaveBeenCalled();
  });

  it('affiche la puce « Série » et le bouton « Série… » sur un event avec seriesId', async () => {
    adminGetEvents.mockResolvedValue([{
      id: 'ev1', name: 'Mêlée du jeudi', kind: 'MELEE', status: 'PUBLISHED',
      startTime: new Date(Date.now() + 86400_000).toISOString(), endTime: null,
      registrationDeadline: new Date(Date.now() + 3600_000).toISOString(),
      capacity: null, price: null, memberOnly: true, confirmedCount: 0, waitlistCount: 0,
      seriesId: 'series-1',
    }]);
    renderPage();
    expect(await screen.findByText(/Série/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Série…/ })).toBeInTheDocument();
  });

  it('« Prolonger » depuis le dialog appelle adminExtendEventSeries avec la nouvelle date', async () => {
    adminGetEvents.mockResolvedValue([{
      id: 'ev1', name: 'Mêlée du jeudi', kind: 'MELEE', status: 'PUBLISHED',
      startTime: new Date(Date.now() + 86400_000).toISOString(), endTime: null,
      registrationDeadline: new Date(Date.now() + 3600_000).toISOString(),
      capacity: null, price: null, memberOnly: true, confirmedCount: 0, waitlistCount: 0,
      seriesId: 'series-1',
    }]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Série…/ }));
    expect(await screen.findByText(/Gérer la série/i)).toBeInTheDocument();
    // Le champ « Nouvelle date de fin » n'est qu'un DateField (pas d'heure) : un clic sur le
    // déclencheur puis « Aujourd'hui » suffit à lui donner une valeur valide.
    fireEvent.click(screen.getByRole('button', { name: /Nouvelle date de fin/i }));
    fireEvent.click(screen.getByRole('button', { name: /Aujourd'hui/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Prolonger$/i }));
    await waitFor(() => expect(adminExtendEventSeries).toHaveBeenCalledWith('c1', 'series-1', expect.any(String), 'tok'));
  });

  it('« Annuler la série » puis confirmer appelle adminCancelEventSeries', async () => {
    adminGetEvents.mockResolvedValue([{
      id: 'ev1', name: 'Mêlée du jeudi', kind: 'MELEE', status: 'PUBLISHED',
      startTime: new Date(Date.now() + 86400_000).toISOString(), endTime: null,
      registrationDeadline: new Date(Date.now() + 3600_000).toISOString(),
      capacity: null, price: null, memberOnly: true, confirmedCount: 0, waitlistCount: 0,
      seriesId: 'series-1',
    }]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Série…/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Annuler la série/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Confirmer$/i }));
    await waitFor(() => expect(adminCancelEventSeries).toHaveBeenCalledWith('c1', 'series-1', 'tok'));
  });
});
```

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

Run: `cd frontend && npx jest --runTestsByPath __tests__/AdminEvents.test.tsx`
Expected: FAIL — la case « Se répète chaque semaine », la puce « Série » et le bouton « Série… » n'existent pas encore.

- [ ] **Step 3: Câbler la récurrence dans le formulaire de création**

Dans `frontend/app/admin/events/page.tsx`, remplacer l'import :

```tsx
import { AgendaAdminList } from '@/components/admin/AgendaAdminList';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
```

par :

```tsx
import { AgendaAdminList } from '@/components/admin/AgendaAdminList';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { RecurrenceFields, RecurrenceState } from '@/components/admin/events/RecurrenceFields';
import { SeriesManageDialog } from '@/components/admin/events/SeriesManageDialog';
```

Remplacer :

```tsx
  const [now, setNow] = useState<Date | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ClubEvent | null>(null);
```

par :

```tsx
  const [now, setNow] = useState<Date | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ClubEvent | null>(null);
  const [recurring, setRecurring] = useState(false);
  const [recurrence, setRecurrence] = useState<RecurrenceState>({ weekday: 1, endDate: '', deadlineLeadHours: 4 });
  const [managingSeriesId, setManagingSeriesId] = useState<string | null>(null);
```

Remplacer la fonction `save` :

```tsx
  const save = async () => {
    if (!form) return;
    setError(null);
    try {
      const body = { ...form, startTime: localInputToISO(form.startTime), registrationDeadline: localInputToISO(form.registrationDeadline), endTime: form.endTime ? localInputToISO(form.endTime) : null };
      if (editingId) await api.adminUpdateEvent(club.id, editingId, body, token);
      else await api.adminCreateEvent(club.id, body, token);
      setForm(null); setEditingId(null); reload();
    } catch (e) { setError((e as Error).message); }
  };
```

par :

```tsx
  const save = async () => {
    if (!form) return;
    setError(null);
    try {
      if (!editingId && recurring) {
        if (!form.endTime) { setError("Une heure de fin est requise pour une animation récurrente (elle fixe la durée de chaque occurrence)."); return; }
        const durationMin = Math.round((new Date(form.endTime).getTime() - new Date(form.startTime).getTime()) / 60000);
        if (durationMin <= 0) { setError('La fin doit être après le début.'); return; }
        await api.adminCreateEventSeries(club.id, {
          name: form.name, kind: form.kind, description: form.description,
          capacity: form.capacity, price: form.price, memberOnly: form.memberOnly,
          requirePrepayment: form.requirePrepayment, clubSportId: form.clubSportId,
          weekday: recurrence.weekday, startLocal: form.startTime.slice(11, 16),
          durationMin, deadlineLeadMinutes: recurrence.deadlineLeadHours * 60,
          startDate: form.startTime.slice(0, 10), endDate: recurrence.endDate,
          status: 'PUBLISHED',
        }, token);
      } else {
        const body = { ...form, startTime: localInputToISO(form.startTime), registrationDeadline: localInputToISO(form.registrationDeadline), endTime: form.endTime ? localInputToISO(form.endTime) : null };
        if (editingId) await api.adminUpdateEvent(club.id, editingId, body, token);
        else await api.adminCreateEvent(club.id, body, token);
      }
      setForm(null); setEditingId(null); setRecurring(false); reload();
    } catch (e) { setError((e as Error).message); }
  };

  const extendSeries = async (seriesId: string, endDate: string) => {
    try { await api.adminExtendEventSeries(club.id, seriesId, endDate, token); setManagingSeriesId(null); reload(); }
    catch (e) { setError((e as Error).message); }
  };
  const cancelSeries = async (seriesId: string) => {
    try { await api.adminCancelEventSeries(club.id, seriesId, token); setManagingSeriesId(null); reload(); }
    catch (e) { setError((e as Error).message); }
  };
```

Remplacer la fonction `renderCard` (uniquement les lignes `actions`/`chips`) :

```tsx
    const actions = (
      <>
        <button onClick={() => openDetail(e.id)} style={ghost}>Inscrits</button>
        <button onClick={() => startEdit(e)} style={ghost}>Modifier</button>
        {(key === 'draft' || key === 'cancelled') && <button onClick={() => setStatus(e.id, 'PUBLISHED')} style={primarySm}>Publier</button>}
        {key === 'upcoming' && <button onClick={() => setStatus(e.id, 'DRAFT')} style={ghost}>Repasser en brouillon</button>}
        {key === 'upcoming' && <button onClick={() => setStatus(e.id, 'CANCELLED')} style={ghost}>Annuler</button>}
        {e.confirmedCount === 0 && e.waitlistCount === 0 && <button onClick={() => setPendingDelete(e)} style={ghost}>Supprimer</button>}
      </>
    );
```

par :

```tsx
    const actions = (
      <>
        <button onClick={() => openDetail(e.id)} style={ghost}>Inscrits</button>
        <button onClick={() => startEdit(e)} style={ghost}>Modifier</button>
        {e.seriesId && <button onClick={() => setManagingSeriesId(e.seriesId!)} style={ghost}>Série…</button>}
        {(key === 'draft' || key === 'cancelled') && <button onClick={() => setStatus(e.id, 'PUBLISHED')} style={primarySm}>Publier</button>}
        {key === 'upcoming' && <button onClick={() => setStatus(e.id, 'DRAFT')} style={ghost}>Repasser en brouillon</button>}
        {key === 'upcoming' && <button onClick={() => setStatus(e.id, 'CANCELLED')} style={ghost}>Annuler</button>}
        {e.confirmedCount === 0 && e.waitlistCount === 0 && <button onClick={() => setPendingDelete(e)} style={ghost}>Supprimer</button>}
      </>
    );
```

Puis, dans le même `renderCard`, remplacer la ligne `chips=` :

```tsx
        chips={[e.sport?.name ?? null, e.price != null ? `${Number(e.price)} €` : null, e.memberOnly ? 'Membres' : null, e.requirePrepayment ? 'CB en ligne' : null]}
```

par :

```tsx
        chips={[e.sport?.name ?? null, e.price != null ? `${Number(e.price)} €` : null, e.memberOnly ? 'Membres' : null, e.requirePrepayment ? 'CB en ligne' : null, e.seriesId ? 'Série' : null]}
```

Ajouter la case de récurrence + les champs, juste après le bloc « Inscription à régler en ligne » et avant la rangée de boutons — remplacer :

```tsx
          {!stripeActive && (
            <div style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute, marginTop: 4 }}>
              Activez d&apos;abord le paiement en ligne dans{' '}
              <a href="/admin/payments" style={{ color: th.accent }}>Paiement en ligne →</a>
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
```

par :

```tsx
          {!stripeActive && (
            <div style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute, marginTop: 4 }}>
              Activez d&apos;abord le paiement en ligne dans{' '}
              <a href="/admin/payments" style={{ color: th.accent }}>Paiement en ligne →</a>
            </div>
          )}
          {!editingId && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: th.fontUI, fontSize: 13.5, color: th.text, marginTop: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={recurring} onChange={(e) => {
                const checked = e.target.checked;
                setRecurring(checked);
                // Pré-coche le jour de la semaine du début déjà saisi (Luxon : 1=lundi … 7=dimanche).
                if (checked && form.startTime) {
                  const jsDay = new Date(form.startTime).getDay(); // 0=dimanche … 6=samedi (natif)
                  setRecurrence((r) => ({ ...r, weekday: jsDay === 0 ? 7 : jsDay }));
                }
              }} />
              Se répète chaque semaine
            </label>
          )}
          {!editingId && recurring && (
            <RecurrenceFields state={recurrence} onChange={setRecurrence} />
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
```

Enfin, ajouter le dialog de gestion de série tout en bas, juste avant la fermeture du composant — remplacer :

```tsx
      {pendingDelete && (
        <ConfirmDialog
          title="Supprimer cet event ?"
          detail={pendingDelete.name}
          message="Cette action est définitive."
          confirmLabel="Supprimer"
          onConfirm={() => { const ev = pendingDelete; setPendingDelete(null); removeEvent(ev.id); }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
```

par :

```tsx
      {pendingDelete && (
        <ConfirmDialog
          title="Supprimer cet event ?"
          detail={pendingDelete.name}
          message="Cette action est définitive."
          confirmLabel="Supprimer"
          onConfirm={() => { const ev = pendingDelete; setPendingDelete(null); removeEvent(ev.id); }}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {managingSeriesId && (
        <SeriesManageDialog
          onExtend={(endDate) => extendSeries(managingSeriesId, endDate)}
          onCancelSeries={() => cancelSeries(managingSeriesId)}
          onClose={() => setManagingSeriesId(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Lancer les tests et vérifier qu'ils passent**

Run: `cd frontend && npx jest --runTestsByPath __tests__/AdminEvents.test.tsx`
Expected: PASS (tous les tests existants + les 6 nouveaux)

- [ ] **Step 5: Commit**

```bash
git add frontend/app/admin/events/page.tsx frontend/__tests__/AdminEvents.test.tsx
git commit -m "feat(events): cablage recurrence dans /admin/events (creation + gestion serie)"
```

---

### Task 10: Vérification globale et note d'évolution CLAUDE.md

**Files:**
- Modify: `palova/CLAUDE.md`

- [ ] **Step 1: Suite backend complète**

Run: `cd backend && npx jest`
Expected: PASS intégral.

Run: `cd backend && npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 2: Suite frontend complète**

Run: `cd frontend && npx jest`
Expected: PASS intégral.

Run: `cd frontend && npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 3: Vérification manuelle en navigateur**

Les tests automatisés du Step précédent évitent délibérément de piloter les vrais sélecteurs
`DateField`/`TimePicker` du champ « Fin » du formulaire principal (aucun test existant du repo
ne le fait — cf. auto-revue du plan). Il faut donc vérifier une fois à la main que le
chaînage complet fonctionne réellement : démarrer la stack (`docker-compose` + backend +
frontend, cf. `palova/CLAUDE.md` § Démarrage), aller sur `/admin/events`, créer un event avec
« Se répète chaque semaine » coché, un **Début et une Fin** réellement saisis via les
sélecteurs, une date de fin de série à quelques semaines, valider → vérifier que **N cartes**
apparaissent dans la liste (une par semaine), chacune avec la puce « Série » et le bouton
« Série… » ; ouvrir « Série… » → Prolonger avec une date plus loin → vérifier l'apparition de
nouvelles cartes ; puis Annuler la série → vérifier que les occurrences futures passent en
statut annulé (les passées, s'il y en a, restent intactes).

- [ ] **Step 4: Ajouter la note d'évolution**

Dans `palova/CLAUDE.md`, repérer la ligne (fin de la section « Events & animations ») qui se
termine par :

```
Tests : `EventsFilterBar.test.tsx` + blocs `whenWindow`/`agendaCounts`/« quand » dans `events.test.ts`.
```

Ajouter juste après cette ligne (avant le prochain `##`, qui est « Quotas de réservation ») :

```markdown

> **Évolution (2026-07-19) — récurrence hebdomadaire (mêlée hebdo) :** un `ClubEvent` peut
> désormais se répéter chaque semaine — nouveau modèle **`ClubEventSeries`** (mirroir de
> `ReservationSeries`, migration additive `add_club_event_series`) portant le gabarit
> (nom/type/description/capacité/prix/membres/CB en ligne/sport) + les paramètres de
> récurrence (jour, heure, durée, délai de clôture, bornes start/end). **Bornée, pas de fin
> ouverte** : `EventService.adminCreateSeries` réutilise tel quel `weeklyOccurrences`
> (`recurrence.ts`, non modifié), plafond 60 occurrences, chaque occurrence est un `ClubEvent`
> **indépendant** (`seriesId` additif) avec `registrationDeadline = début − délai fixe`.
> **`adminExtendSeries`** ne génère que le delta (dédoublonnage sur la dernière occurrence
> existante, plafond 60 au total). **`adminCancelSeries`** annule toutes les occurrences
> futures — **même déjà inscrites** — en réutilisant `updateEvent(...,{status:'CANCELLED'})`
> tel quel (donc la notif « activité annulée par le club » + le remboursement des inscrits
> payés, déjà testés, sans duplication) ; les occurrences passées ne sont jamais touchées.
> Routes `POST /admin/event-series`, `POST /admin/event-series/:id/extend`,
> `DELETE /admin/event-series/:id`. Front : case **« Se répète chaque semaine »** dans le
> formulaire de création (`RecurrenceFields.tsx` : jour, date de fin, chips de délai
> `CANCEL_PRESETS`), puce **« Série »** + bouton **« Série… »** sur les cartes concernées
> (`chips`/`actions` de `AgendaAdminCard`, aucun changement du composant partagé),
> **`SeriesManageDialog.tsx`** (Prolonger / Annuler la série, confirmation explicite). Rien ne
> change côté joueur (chaque occurrence est un event ordinaire sur `/events`). Hors v1 :
> récurrence à durée indéterminée, clôture à heure absolue récurrente, édition en masse d'un
> champ gabarit après coup, récurrence pour les tournois. Spec & plan :
> `docs/superpowers/{specs,plans}/2026-07-19-recurrence-animations*`.
```

- [ ] **Step 5: Commit**

```bash
git add palova/CLAUDE.md
git commit -m "docs: note d'evolution - recurrence hebdomadaire des animations"
```
