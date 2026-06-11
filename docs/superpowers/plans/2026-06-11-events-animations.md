# Events & animations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Onglet « Events » unique (tournois + animations) avec inscriptions individuelles en ligne pour les animations (mêlées, stages, soirées, initiations).

**Architecture:** Nouveau modèle `ClubEvent` + `EventRegistration` à côté de `Tournament` (approche B de la spec `docs/superpowers/specs/2026-06-11-events-animations-design.md`). `EventService` en miroir simplifié de `TournamentService` (inscription individuelle, pas de binôme). La page `/events` fusionne les deux sources côté client (pattern du calendrier « Mes réservations »).

**Tech Stack:** Express 5 + Prisma 7 (adapter PrismaPg obligatoire), Jest + prismaMock, Next.js 16 + React 19 (styles inline `th.*`, composants `Screen`/`ClubNav`/`Icon`/atoms).

**Conventions du projet à respecter :**
- Erreurs métier = `throw new Error('CODE_EN_MAJUSCULES')`, mappées en statuts HTTP dans la route.
- Transactions critiques : `Prisma.TransactionIsolationLevel.Serializable` + `SELECT … FOR UPDATE`, timeout 10 000 ms.
- Tests backend : `import '../../__mocks__/prisma'` + `prismaMock`, pas de vraie base.
- Commentaires en français, compacts.
- Jamais `new PrismaClient()` seul (adapter requis — déjà géré dans `src/db/prisma.ts`).

---

### Task 1 : Schéma Prisma + migration `add_club_events`

**Files:**
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1 : Ajouter les enums et modèles au schéma**

Dans `backend/prisma/schema.prisma`, juste après l'enum `RegistrationStatus` (ligne ~84), ajouter :

```prisma
enum ClubEventKind {
  MELEE       // mêlée / americano / mexicano
  STAGE       // stage, clinic, cours ponctuel
  SOIREE      // soirée, after-work, vie du club
  INITIATION  // découverte / portes ouvertes
  AUTRE
}

enum ClubEventStatus {
  DRAFT
  PUBLISHED
  CANCELLED
}
```

Après le modèle `TournamentRegistration` (ligne ~442), ajouter :

```prisma
/// Animation du club (mêlée, stage, soirée…) — inscription individuelle.
/// Les tournois homologués restent sur le modèle Tournament.
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
  memberOnly           Boolean         @default(true) @map("member_only")
  status               ClubEventStatus @default(DRAFT)
  createdAt            DateTime        @default(now()) @map("created_at")
  updatedAt            DateTime        @updatedAt @map("updated_at")

  club          Club                @relation(fields: [clubId], references: [id], onDelete: Cascade)
  registrations EventRegistration[]

  @@index([clubId, status, startTime])
  @@map("club_events")
}

model EventRegistration {
  id          String             @id @default(cuid())
  eventId     String             @map("event_id")
  userId      String             @map("user_id")
  status      RegistrationStatus @default(CONFIRMED)
  cancelledAt DateTime?          @map("cancelled_at")
  createdAt   DateTime           @default(now()) @map("created_at") // = ordre de liste d'attente
  updatedAt   DateTime           @updatedAt @map("updated_at")

  event ClubEvent @relation(fields: [eventId], references: [id], onDelete: Cascade)
  user  User      @relation(fields: [userId], references: [id], onDelete: Restrict)

  @@unique([eventId, userId]) // une seule ligne par joueur et par événement (réinscription = update)
  @@index([eventId, status, createdAt])
  @@map("event_registrations")
}
```

- [ ] **Step 2 : Brancher les relations inverses**

Dans le modèle `Club`, à côté de la relation `tournaments Tournament[]` existante, ajouter :

```prisma
  clubEvents  ClubEvent[]
```

Dans le modèle `User`, à côté des relations `CaptainRegistrations`/`PartnerRegistrations`, ajouter :

```prisma
  eventRegistrations EventRegistration[]
```

- [ ] **Step 3 : Générer et appliquer la migration**

Run (dans `backend/`) : `npx prisma migrate dev --name add_club_events`
Expected: `Applying migration … add_club_events` puis « Your database is now in sync with your schema » et régénération du client.

- [ ] **Step 4 : Vérifier la compilation**

Run (dans `backend/`) : `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5 : Commit**

```bash
git add backend/prisma
git commit -m "feat(events): modeles ClubEvent + EventRegistration (migration add_club_events)"
```

---

### Task 2 : `EventService.register` (TDD)

**Files:**
- Create: `backend/src/services/event.service.ts`
- Create: `backend/src/services/__tests__/event.service.test.ts`

- [ ] **Step 1 : Écrire les tests d'inscription (échouent : le service n'existe pas)**

Créer `backend/src/services/__tests__/event.service.test.ts` :

```typescript
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { EventService } from '../event.service';

const FUTURE = new Date(Date.now() + 86_400_000); // +24h

function event(overrides: Record<string, unknown> = {}) {
  return { id: 'e1', clubId: 'club-demo', status: 'PUBLISHED', registrationDeadline: FUTURE, capacity: 12, memberOnly: true, ...overrides };
}

/** Chemin nominal : membre ACTIVE, transaction passthrough, pas d'inscription existante. */
function mockHappyPath() {
  prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);
  prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
  prismaMock.$queryRaw.mockResolvedValue([] as any);
  prismaMock.eventRegistration.findUnique.mockResolvedValue(null as any);
}

describe('EventService.register', () => {
  let service: EventService;
  beforeEach(() => { service = new EventService(); });

  it('crée une inscription CONFIRMED quand il reste des places', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event({ capacity: 12 }) as any);
    mockHappyPath();
    prismaMock.eventRegistration.count.mockResolvedValue(3 as any);
    prismaMock.eventRegistration.create.mockResolvedValue({ id: 'r1', status: 'CONFIRMED' } as any);

    const result = await service.register('e1', 'user-1');

    expect(prismaMock.eventRegistration.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ eventId: 'e1', userId: 'user-1', status: 'CONFIRMED' }) }),
    );
    expect(result.status).toBe('CONFIRMED');
  });

  it('place en WAITLISTED quand l événement est complet', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event({ capacity: 12 }) as any);
    mockHappyPath();
    prismaMock.eventRegistration.count.mockResolvedValue(12 as any);
    prismaMock.eventRegistration.create.mockResolvedValue({ id: 'r1', status: 'WAITLISTED' } as any);

    await service.register('e1', 'user-1');

    expect(prismaMock.eventRegistration.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'WAITLISTED' }) }),
    );
  });

  it('CONFIRMED sans limite de places (capacity null)', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event({ capacity: null }) as any);
    mockHappyPath();
    prismaMock.eventRegistration.count.mockResolvedValue(999 as any);
    prismaMock.eventRegistration.create.mockResolvedValue({ id: 'r1', status: 'CONFIRMED' } as any);

    await service.register('e1', 'user-1');

    expect(prismaMock.eventRegistration.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CONFIRMED' }) }),
    );
  });

  it('réinscription après annulation : met à jour la ligne, createdAt repart à maintenant', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event() as any);
    mockHappyPath();
    prismaMock.eventRegistration.findUnique.mockResolvedValue({ id: 'r-old', status: 'CANCELLED' } as any);
    prismaMock.eventRegistration.count.mockResolvedValue(0 as any);
    prismaMock.eventRegistration.update.mockResolvedValue({ id: 'r-old', status: 'CONFIRMED' } as any);

    await service.register('e1', 'user-1');

    expect(prismaMock.eventRegistration.create).not.toHaveBeenCalled();
    expect(prismaMock.eventRegistration.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'r-old' },
      data: expect.objectContaining({ status: 'CONFIRMED', cancelledAt: null, createdAt: expect.any(Date) }),
    }));
  });

  it('lève ALREADY_REGISTERED si une inscription active existe', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event() as any);
    mockHappyPath();
    prismaMock.eventRegistration.findUnique.mockResolvedValue({ id: 'r1', status: 'WAITLISTED' } as any);
    await expect(service.register('e1', 'user-1')).rejects.toThrow('ALREADY_REGISTERED');
  });

  it('lève EVENT_NOT_OPEN si DRAFT', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event({ status: 'DRAFT' }) as any);
    await expect(service.register('e1', 'user-1')).rejects.toThrow('EVENT_NOT_OPEN');
  });

  it('lève REGISTRATION_CLOSED après la deadline', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event({ registrationDeadline: new Date(Date.now() - 1000) }) as any);
    await expect(service.register('e1', 'user-1')).rejects.toThrow('REGISTRATION_CLOSED');
  });

  it('lève EVENT_NOT_FOUND si inconnu', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(null as any);
    await expect(service.register('ghost', 'user-1')).rejects.toThrow('EVENT_NOT_FOUND');
  });

  it('memberOnly : lève MEMBERSHIP_REQUIRED pour un non-membre', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event({ memberOnly: true }) as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue(null as any);
    await expect(service.register('e1', 'user-1')).rejects.toThrow('MEMBERSHIP_REQUIRED');
  });

  it('événement ouvert : un non-membre peut s inscrire', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event({ memberOnly: false }) as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue(null as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([] as any);
    prismaMock.eventRegistration.findUnique.mockResolvedValue(null as any);
    prismaMock.eventRegistration.count.mockResolvedValue(0 as any);
    prismaMock.eventRegistration.create.mockResolvedValue({ id: 'r1', status: 'CONFIRMED' } as any);

    await expect(service.register('e1', 'user-1')).resolves.toMatchObject({ status: 'CONFIRMED' });
  });

  it('un membre BLOCKED est refusé même sur un événement ouvert', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event({ memberOnly: false }) as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'BLOCKED' } as any);
    await expect(service.register('e1', 'user-1')).rejects.toThrow('MEMBERSHIP_BLOCKED');
  });
});
```

- [ ] **Step 2 : Vérifier que les tests échouent**

Run (dans `backend/`) : `npm test -- event.service`
Expected: FAIL — `Cannot find module '../event.service'`.

- [ ] **Step 3 : Implémenter le service (inscription seule)**

Créer `backend/src/services/event.service.ts` :

```typescript
import { ClubEventKind, ClubEventStatus, Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';

export interface CreateEventInput {
  name: string;
  kind: ClubEventKind;
  description?: string | null;
  startTime: string | Date;
  endTime?: string | Date | null;
  registrationDeadline: string | Date;
  capacity?: number | null;
  price?: number | null;
  memberOnly?: boolean;
}
export type UpdateEventInput = Partial<CreateEventInput & { status: ClubEventStatus }>;

const KINDS: ClubEventKind[] = ['MELEE', 'STAGE', 'SOIREE', 'INITIATION', 'AUTRE'];

export class EventService {
  // ---------------------------------------------------------------- Inscription

  /** Inscrit le joueur connecté (individuel). Réinscription après annulation = la ligne repart en fin de file. */
  async register(eventId: string, userId: string) {
    const event = await prisma.clubEvent.findUnique({
      where: { id: eventId },
      select: { id: true, clubId: true, status: true, registrationDeadline: true, capacity: true, memberOnly: true },
    });
    if (!event) throw new Error('EVENT_NOT_FOUND');
    if (event.status !== 'PUBLISHED') throw new Error('EVENT_NOT_OPEN');
    if (new Date() >= event.registrationDeadline) throw new Error('REGISTRATION_CLOSED');

    const membership = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId, clubId: event.clubId } },
      select: { status: true },
    });
    if (membership?.status === 'BLOCKED') throw new Error('MEMBERSHIP_BLOCKED');
    if (event.memberOnly && membership?.status !== 'ACTIVE') throw new Error('MEMBERSHIP_REQUIRED');

    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM club_events WHERE id = ${eventId} FOR UPDATE`;
      const existing = await tx.eventRegistration.findUnique({
        where: { eventId_userId: { eventId, userId } },
        select: { id: true, status: true },
      });
      if (existing && existing.status !== 'CANCELLED') throw new Error('ALREADY_REGISTERED');

      const confirmed = await tx.eventRegistration.count({ where: { eventId, status: 'CONFIRMED' } });
      const status = event.capacity == null || confirmed < event.capacity ? 'CONFIRMED' : 'WAITLISTED';

      if (existing) {
        // Réinscription : la ligne CANCELLED est réutilisée, createdAt repart à
        // maintenant — le joueur ne récupère pas son ancienne position d'attente.
        return tx.eventRegistration.update({
          where: { id: existing.id },
          data: { status, cancelledAt: null, createdAt: new Date() },
        });
      }
      return tx.eventRegistration.create({ data: { eventId, userId, status } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 });
  }
}
```

(`KINDS`, `CreateEventInput`, `UpdateEventInput` servent aux tâches 4-5 — l'import inutilisé `ClubEventStatus`/`KINDS` est toléré temporairement ou préfixé d'un `// utilisé en Task 5` si ESLint bloque.)

- [ ] **Step 4 : Vérifier que les tests passent**

Run : `npm test -- event.service`
Expected: PASS (11 tests).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/event.service.ts backend/src/services/__tests__/event.service.test.ts
git commit -m "feat(events): EventService.register - inscription individuelle, liste d'attente, memberOnly"
```

---

### Task 3 : `EventService.cancelRegistration` + promotion (TDD)

**Files:**
- Modify: `backend/src/services/event.service.ts`
- Modify: `backend/src/services/__tests__/event.service.test.ts`

- [ ] **Step 1 : Écrire les tests d'annulation**

Ajouter à la fin de `event.service.test.ts` :

```typescript
describe('EventService.cancelRegistration', () => {
  let service: EventService;
  beforeEach(() => {
    service = new EventService();
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([] as any);
  });

  it('annule une inscription CONFIRMED et promeut le 1er WAITLISTED', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event() as any);
    prismaMock.eventRegistration.findFirst
      .mockResolvedValueOnce({ id: 'r1', status: 'CONFIRMED' } as any)   // ma ligne active
      .mockResolvedValueOnce({ id: 'r-wait' } as any);                   // 1er en attente
    prismaMock.eventRegistration.update.mockResolvedValue({ id: 'r1', status: 'CANCELLED' } as any);

    await service.cancelRegistration('e1', 'user-1');

    expect(prismaMock.eventRegistration.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'r1' }, data: expect.objectContaining({ status: 'CANCELLED' }),
    }));
    expect(prismaMock.eventRegistration.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'r-wait' }, data: { status: 'CONFIRMED' },
    }));
  });

  it('annule une WAITLISTED sans promotion', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event() as any);
    prismaMock.eventRegistration.findFirst.mockResolvedValueOnce({ id: 'r1', status: 'WAITLISTED' } as any);
    prismaMock.eventRegistration.update.mockResolvedValue({ id: 'r1', status: 'CANCELLED' } as any);

    await service.cancelRegistration('e1', 'user-1');

    expect(prismaMock.eventRegistration.update).toHaveBeenCalledTimes(1);
  });

  it('lève REGISTRATION_LOCKED après la deadline', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event({ registrationDeadline: new Date(Date.now() - 1000) }) as any);
    await expect(service.cancelRegistration('e1', 'user-1')).rejects.toThrow('REGISTRATION_LOCKED');
  });

  it('lève REGISTRATION_NOT_FOUND sans inscription active', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(event() as any);
    prismaMock.eventRegistration.findFirst.mockResolvedValue(null as any);
    await expect(service.cancelRegistration('e1', 'user-1')).rejects.toThrow('REGISTRATION_NOT_FOUND');
  });
});
```

- [ ] **Step 2 : Vérifier que les tests échouent**

Run : `npm test -- event.service`
Expected: FAIL — `service.cancelRegistration is not a function`.

- [ ] **Step 3 : Implémenter l'annulation + promotion**

Ajouter dans la classe `EventService` (après `register`) :

```typescript
  /** Le joueur se désinscrit avant la deadline ; promotion auto du 1er en attente. */
  async cancelRegistration(eventId: string, userId: string) {
    const event = await prisma.clubEvent.findUnique({
      where: { id: eventId },
      select: { registrationDeadline: true },
    });
    if (!event) throw new Error('EVENT_NOT_FOUND');
    if (new Date() >= event.registrationDeadline) throw new Error('REGISTRATION_LOCKED');

    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM club_events WHERE id = ${eventId} FOR UPDATE`;
      const reg = await tx.eventRegistration.findFirst({
        where: { eventId, userId, status: { not: 'CANCELLED' } },
        select: { id: true, status: true },
      });
      if (!reg) throw new Error('REGISTRATION_NOT_FOUND');
      return this.cancelAndPromoteTx(tx, eventId, reg.id, reg.status === 'CONFIRMED');
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 });
  }

  /** Passe une inscription CANCELLED et, si elle était CONFIRMED, promeut le 1er WAITLISTED. À appeler sous verrou de l'événement. */
  private async cancelAndPromoteTx(tx: Prisma.TransactionClient, eventId: string, regId: string, wasConfirmed: boolean) {
    const cancelled = await tx.eventRegistration.update({
      where: { id: regId },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    if (wasConfirmed) {
      const next = await tx.eventRegistration.findFirst({
        where: { eventId, status: 'WAITLISTED' },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (next) await tx.eventRegistration.update({ where: { id: next.id }, data: { status: 'CONFIRMED' } });
    }
    return cancelled;
  }
```

- [ ] **Step 4 : Vérifier que les tests passent**

Run : `npm test -- event.service`
Expected: PASS (15 tests).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/event.service.ts backend/src/services/__tests__/event.service.test.ts
git commit -m "feat(events): desinscription + promotion auto du 1er en liste d'attente"
```

---

### Task 4 : `EventService` — lectures publiques + « mes events » (TDD)

**Files:**
- Modify: `backend/src/services/event.service.ts`
- Modify: `backend/src/services/__tests__/event.service.test.ts`

- [ ] **Step 1 : Écrire les tests de lecture**

Ajouter à la fin de `event.service.test.ts` :

```typescript
describe('EventService lectures', () => {
  let service: EventService;
  beforeEach(() => { service = new EventService(); });

  it('listPublicByClubSlug : PUBLISHED seulement, avec compteurs', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
    prismaMock.clubEvent.findMany.mockResolvedValue([{ id: 'e1' }, { id: 'e2' }] as any);
    prismaMock.eventRegistration.groupBy.mockResolvedValue([
      { eventId: 'e1', status: 'CONFIRMED', _count: { _all: 4 } },
      { eventId: 'e1', status: 'WAITLISTED', _count: { _all: 2 } },
    ] as any);

    const out = await service.listPublicByClubSlug('club-demo');

    expect(prismaMock.clubEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { clubId: 'club-demo', status: 'PUBLISHED' },
    }));
    expect(out[0]).toMatchObject({ id: 'e1', confirmedCount: 4, waitlistCount: 2 });
    expect(out[1]).toMatchObject({ id: 'e2', confirmedCount: 0, waitlistCount: 0 });
  });

  it('getById : masque les DRAFT', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue({ id: 'e1', status: 'DRAFT' } as any);
    await expect(service.getById('e1')).rejects.toThrow('EVENT_NOT_FOUND');
  });

  it('listUserRegistrations : inscriptions actives avec event + club', async () => {
    prismaMock.eventRegistration.findMany.mockResolvedValue([{ id: 'r1', status: 'CONFIRMED' }] as any);
    const out = await service.listUserRegistrations('user-1');
    expect(prismaMock.eventRegistration.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'user-1', status: { not: 'CANCELLED' } },
    }));
    expect(out).toHaveLength(1);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `npm test -- event.service`
Expected: FAIL — `listPublicByClubSlug is not a function`.

- [ ] **Step 3 : Implémenter les lectures**

Ajouter dans la classe `EventService` :

```typescript
  // --------------------------------------------------------- Lectures publiques

  /** Animations PUBLISHED d'un club (par slug), triées par date, avec compteurs. */
  async listPublicByClubSlug(slug: string) {
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, status: true } });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    const events = await prisma.clubEvent.findMany({
      where: { clubId: club.id, status: 'PUBLISHED' },
      orderBy: { startTime: 'asc' },
    });
    return this.withCounts(events);
  }

  /** Détail public (DRAFT masqué) + compteurs + infos club. */
  async getById(eventId: string) {
    const e = await prisma.clubEvent.findUnique({
      where: { id: eventId },
      include: { club: { select: { slug: true, name: true, timezone: true } } },
    });
    if (!e || e.status === 'DRAFT') throw new Error('EVENT_NOT_FOUND');
    const [withCount] = await this.withCounts([e]);
    return withCount;
  }

  /** Inscriptions actives du joueur connecté, tous clubs, avec event + club. */
  async listUserRegistrations(userId: string) {
    return prisma.eventRegistration.findMany({
      where: { userId, status: { not: 'CANCELLED' } },
      orderBy: { event: { startTime: 'asc' } },
      include: { event: { include: { club: { select: { slug: true, name: true, timezone: true } } } } },
    });
  }

  /** Ajoute confirmedCount / waitlistCount à une liste d'événements. */
  private async withCounts<T extends { id: string }>(events: T[]) {
    if (events.length === 0) return [] as (T & { confirmedCount: number; waitlistCount: number })[];
    const grouped = await prisma.eventRegistration.groupBy({
      by: ['eventId', 'status'],
      where: { eventId: { in: events.map((e) => e.id) }, status: { not: 'CANCELLED' } },
      _count: { _all: true },
    });
    const count = (id: string, status: string) =>
      grouped.find((g) => g.eventId === id && g.status === status)?._count._all ?? 0;
    return events.map((e) => ({ ...e, confirmedCount: count(e.id, 'CONFIRMED'), waitlistCount: count(e.id, 'WAITLISTED') }));
  }
```

- [ ] **Step 4 : Vérifier que les tests passent**

Run : `npm test -- event.service`
Expected: PASS (18 tests).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/event.service.ts backend/src/services/__tests__/event.service.test.ts
git commit -m "feat(events): lectures publiques + inscriptions du joueur (compteurs de places)"
```

---

### Task 5 : `EventService` — CRUD admin + validation (TDD)

**Files:**
- Modify: `backend/src/services/event.service.ts`
- Modify: `backend/src/services/__tests__/event.service.test.ts`

- [ ] **Step 1 : Écrire les tests admin**

Ajouter à la fin de `event.service.test.ts` :

```typescript
describe('EventService admin', () => {
  let service: EventService;
  beforeEach(() => { service = new EventService(); });

  const validInput = {
    name: 'Mêlée du vendredi', kind: 'MELEE' as const,
    startTime: FUTURE.toISOString(), registrationDeadline: FUTURE.toISOString(),
    capacity: 12, price: 10, memberOnly: true,
  };

  it('createEvent : crée avec les champs normalisés', async () => {
    prismaMock.clubEvent.create.mockResolvedValue({ id: 'e1' } as any);
    await service.createEvent('club-demo', validInput);
    expect(prismaMock.clubEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ clubId: 'club-demo', name: 'Mêlée du vendredi', kind: 'MELEE', capacity: 12, memberOnly: true }),
    }));
  });

  it('createEvent : refuse un kind inconnu', async () => {
    await expect(service.createEvent('club-demo', { ...validInput, kind: 'KARAOKE' as never }))
      .rejects.toThrow('VALIDATION_ERROR');
  });

  it('createEvent : refuse capacity < 1 et price < 0', async () => {
    await expect(service.createEvent('club-demo', { ...validInput, capacity: 0 })).rejects.toThrow('VALIDATION_ERROR');
    await expect(service.createEvent('club-demo', { ...validInput, price: -1 })).rejects.toThrow('VALIDATION_ERROR');
  });

  it('updateEvent : refuse un event d un autre club', async () => {
    prismaMock.clubEvent.findFirst.mockResolvedValue(null as any);
    await expect(service.updateEvent('e1', 'autre-club', { name: 'X' })).rejects.toThrow('EVENT_NOT_FOUND');
  });

  it('deleteEvent : refuse s il reste des inscriptions actives', async () => {
    prismaMock.clubEvent.findFirst.mockResolvedValue({ id: 'e1' } as any);
    prismaMock.eventRegistration.count.mockResolvedValue(3 as any);
    await expect(service.deleteEvent('e1', 'club-demo')).rejects.toThrow('HAS_REGISTRATIONS');
  });

  it('adminRemoveRegistration : annule et promeut sous verrou', async () => {
    prismaMock.eventRegistration.findFirst
      .mockResolvedValueOnce({ id: 'r1', status: 'CONFIRMED' } as any)  // appartenance au club
      .mockResolvedValueOnce({ id: 'r1', status: 'CONFIRMED' } as any)  // relecture sous verrou
      .mockResolvedValueOnce(null as any);                              // pas de WAITLISTED
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([] as any);
    prismaMock.eventRegistration.update.mockResolvedValue({ id: 'r1', status: 'CANCELLED' } as any);

    const out = await service.adminRemoveRegistration('e1', 'r1', 'club-demo');
    expect(out.status).toBe('CANCELLED');
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run : `npm test -- event.service`
Expected: FAIL — `createEvent is not a function`.

- [ ] **Step 3 : Implémenter le CRUD admin**

Ajouter dans la classe `EventService` :

```typescript
  // ----------------------------------------------------------- Admin (club)

  /** Tous les événements du club (DRAFT inclus) + compteurs. */
  async listForAdmin(clubId: string) {
    const events = await prisma.clubEvent.findMany({ where: { clubId }, orderBy: { startTime: 'desc' } });
    return this.withCounts(events);
  }

  /** Détail admin : event + inscriptions actives avec coordonnées. */
  async getForAdmin(eventId: string, clubId: string) {
    const e = await prisma.clubEvent.findFirst({ where: { id: eventId, clubId } });
    if (!e) throw new Error('EVENT_NOT_FOUND');
    const registrations = await prisma.eventRegistration.findMany({
      where: { eventId, status: { not: 'CANCELLED' } },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }], // CONFIRMED avant WAITLISTED
      include: { user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } } },
    });
    const [event] = await this.withCounts([e]);
    return { event, registrations };
  }

  async createEvent(clubId: string, input: CreateEventInput) {
    const data = this.validateEventInput(input, true);
    return prisma.clubEvent.create({ data: { clubId, ...data } as Prisma.ClubEventUncheckedCreateInput });
  }

  async updateEvent(eventId: string, clubId: string, input: UpdateEventInput) {
    const found = await prisma.clubEvent.findFirst({ where: { id: eventId, clubId }, select: { id: true } });
    if (!found) throw new Error('EVENT_NOT_FOUND');
    const data = this.validateEventInput(input, false);
    if (input.status !== undefined) {
      if (!['DRAFT', 'PUBLISHED', 'CANCELLED'].includes(input.status as string)) throw new Error('VALIDATION_ERROR');
      (data as Record<string, unknown>).status = input.status;
    }
    return prisma.clubEvent.update({ where: { id: eventId }, data });
  }

  async deleteEvent(eventId: string, clubId: string) {
    const found = await prisma.clubEvent.findFirst({ where: { id: eventId, clubId }, select: { id: true } });
    if (!found) throw new Error('EVENT_NOT_FOUND');
    const active = await prisma.eventRegistration.count({ where: { eventId, status: { not: 'CANCELLED' } } });
    if (active > 0) throw new Error('HAS_REGISTRATIONS'); // utiliser status=CANCELLED pour annuler à la place
    await prisma.clubEvent.delete({ where: { id: eventId } });
  }

  /** Promotion manuelle par le club (override, sans contrôle de place). */
  async adminPromoteRegistration(eventId: string, regId: string, clubId: string) {
    const reg = await this.findClubRegistration(eventId, regId, clubId);
    if (reg.status !== 'WAITLISTED') throw new Error('VALIDATION_ERROR');
    return prisma.eventRegistration.update({ where: { id: regId }, data: { status: 'CONFIRMED' } });
  }

  /** Désinscription manuelle par le club (promeut le 1er en attente si CONFIRMED). */
  async adminRemoveRegistration(eventId: string, regId: string, clubId: string) {
    await this.findClubRegistration(eventId, regId, clubId); // vérifie l'appartenance au club
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM club_events WHERE id = ${eventId} FOR UPDATE`;
      const reg = await tx.eventRegistration.findFirst({
        where: { id: regId, status: { not: 'CANCELLED' } },
        select: { id: true, status: true },
      });
      if (!reg) throw new Error('REGISTRATION_NOT_FOUND');
      return this.cancelAndPromoteTx(tx, eventId, regId, reg.status === 'CONFIRMED');
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 });
  }

  private async findClubRegistration(eventId: string, regId: string, clubId: string) {
    const reg = await prisma.eventRegistration.findFirst({
      where: { id: regId, eventId, event: { clubId } },
      select: { id: true, status: true },
    });
    if (!reg) throw new Error('REGISTRATION_NOT_FOUND');
    return reg;
  }

  /** Valide + normalise les champs. `requireAll` pour la création. */
  private validateEventInput(input: UpdateEventInput, requireAll: boolean) {
    const data: Record<string, unknown> = {};

    if (requireAll || input.name !== undefined) {
      const v = (input.name ?? '').trim();
      if (!v) throw new Error('VALIDATION_ERROR');
      data.name = v;
    }
    if (requireAll || input.kind !== undefined) {
      if (!KINDS.includes(input.kind as ClubEventKind)) throw new Error('VALIDATION_ERROR');
      data.kind = input.kind;
    }
    if (input.description !== undefined) data.description = (input.description ?? '')?.toString().trim() || null;

    const parseDate = (v: string | Date) => { const d = new Date(v); if (isNaN(d.getTime())) throw new Error('VALIDATION_ERROR'); return d; };
    if (requireAll || input.startTime !== undefined) data.startTime = parseDate(input.startTime as string | Date);
    if (requireAll || input.registrationDeadline !== undefined) data.registrationDeadline = parseDate(input.registrationDeadline as string | Date);
    if (input.endTime !== undefined) data.endTime = input.endTime ? parseDate(input.endTime) : null;

    if (input.capacity !== undefined) {
      if (input.capacity === null) data.capacity = null;
      else { const n = Math.trunc(Number(input.capacity)); if (isNaN(n) || n < 1) throw new Error('VALIDATION_ERROR'); data.capacity = n; }
    }
    if (input.price !== undefined) {
      if (input.price === null) data.price = null;
      else { const f = Number(input.price); if (isNaN(f) || f < 0) throw new Error('VALIDATION_ERROR'); data.price = new Prisma.Decimal(f); }
    }
    if (input.memberOnly !== undefined) {
      if (typeof input.memberOnly !== 'boolean') throw new Error('VALIDATION_ERROR');
      data.memberOnly = input.memberOnly;
    }
    return data;
  }
```

- [ ] **Step 4 : Vérifier que tout passe**

Run : `npm test -- event.service` → PASS (24 tests). Puis `npm test` complet → tous les suites PASS. Puis `npx tsc --noEmit` → exit 0.

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/event.service.ts backend/src/services/__tests__/event.service.test.ts
git commit -m "feat(events): CRUD admin + gestion des inscrits (promotion/retrait manuel)"
```

---

### Task 6 : Routes backend

**Files:**
- Create: `backend/src/routes/events.ts`
- Modify: `backend/src/app.ts` (montage)
- Modify: `backend/src/routes/clubs.ts` (liste publique par slug)
- Modify: `backend/src/routes/admin.ts` (CRUD admin)
- Modify: `backend/src/routes/me.ts` (mes inscriptions)

- [ ] **Step 1 : Créer `backend/src/routes/events.ts`** (miroir de `routes/tournaments.ts`)

```typescript
import { Router, Response, NextFunction } from 'express';
import { EventService } from '../services/event.service';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();
const service = new EventService();

const ERROR_STATUS: Record<string, number> = {
  EVENT_NOT_FOUND:        404,
  EVENT_NOT_OPEN:         409,
  REGISTRATION_CLOSED:    409,
  REGISTRATION_LOCKED:    409,
  REGISTRATION_NOT_FOUND: 404,
  MEMBERSHIP_REQUIRED:    403,
  MEMBERSHIP_BLOCKED:     403,
  ALREADY_REGISTERED:     409,
};

function asString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return '';
}

const handleError = (err: unknown, res: Response, next: NextFunction) => {
  const message = (err as Error).message;
  const status  = ERROR_STATUS[message];
  if (status) return void res.status(status).json({ error: message });
  next(err);
};

// Détail public d'un événement (pas d'auth ; le DRAFT est masqué par le service).
router.get('/:id', async (req, res, next) => {
  try { res.json(await service.getById(asString(req.params.id))); }
  catch (err) { handleError(err, res, next); }
});

router.post('/:id/register', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.status(201).json(await service.register(asString(req.params.id), req.user!.id)); }
  catch (err) { handleError(err, res, next); }
});

router.delete('/:id/registration', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await service.cancelRegistration(asString(req.params.id), req.user!.id)); }
  catch (err) { handleError(err, res, next); }
});

export default router;
```

- [ ] **Step 2 : Monter le routeur dans `backend/src/app.ts`**

Après la ligne `import tournamentsRouter from './routes/tournaments';` :

```typescript
import eventsRouter from './routes/events';
```

Après la ligne `app.use('/api/tournaments',   tournamentsRouter);` :

```typescript
app.use('/api/events',        eventsRouter);
```

- [ ] **Step 3 : Liste publique par slug dans `backend/src/routes/clubs.ts`**

En tête, à côté de l'import `TournamentService` :

```typescript
import { EventService } from '../services/event.service';
```

À côté de `const tournamentService = new TournamentService();` :

```typescript
const eventService = new EventService();
```

Après la route `GET /:slug/tournaments` (ligne ~105) :

```typescript
// Animations publiées d'un club (à venir).
router.get('/:slug/events', async (req, res, next) => {
  try { res.json(await eventService.listPublicByClubSlug(asString(req.params.slug))); }
  catch (err) { handleError(err, res, next); }
});
```

- [ ] **Step 4 : CRUD admin dans `backend/src/routes/admin.ts`**

En tête, à côté de l'import `TournamentService` :

```typescript
import { EventService } from '../services/event.service';
```

À côté de `const tournamentService = new TournamentService();` :

```typescript
const eventService = new EventService();
```

Après le bloc des routes `/tournaments/...` (ligne ~344) :

```typescript
// --- Events (animations : mêlées, stages, soirées…) ---

router.get('/events', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await eventService.listForAdmin(req.membership!.clubId)); } catch (e) { handleError(e, res, next); }
});
router.post('/events', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.status(201).json(await eventService.createEvent(req.membership!.clubId, req.body)); } catch (e) { handleError(e, res, next); }
});
router.get('/events/:id', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await eventService.getForAdmin(asString(req.params.id), req.membership!.clubId)); } catch (e) { handleError(e, res, next); }
});
router.patch('/events/:id', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await eventService.updateEvent(asString(req.params.id), req.membership!.clubId, req.body)); } catch (e) { handleError(e, res, next); }
});
router.delete('/events/:id', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { await eventService.deleteEvent(asString(req.params.id), req.membership!.clubId); res.json({ ok: true }); } catch (e) { handleError(e, res, next); }
});
router.patch('/events/:id/registrations/:regId', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await eventService.adminPromoteRegistration(asString(req.params.id), asString(req.params.regId), req.membership!.clubId)); } catch (e) { handleError(e, res, next); }
});
router.delete('/events/:id/registrations/:regId', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await eventService.adminRemoveRegistration(asString(req.params.id), asString(req.params.regId), req.membership!.clubId)); } catch (e) { handleError(e, res, next); }
});
```

Vérifier que `ERROR_STATUS` de `admin.ts` couvre `EVENT_NOT_FOUND: 404`, `HAS_REGISTRATIONS: 409`, `REGISTRATION_NOT_FOUND: 404`, `VALIDATION_ERROR: 400` — ajouter les codes manquants à l'objet existant.

- [ ] **Step 5 : « Mes events » dans `backend/src/routes/me.ts`**

En tête, à côté de l'import `TournamentService` :

```typescript
import { EventService } from '../services/event.service';
```

À côté de `const tournamentService = new TournamentService();` :

```typescript
const eventService = new EventService();
```

Après la route `GET /tournaments` (ligne ~106) :

```typescript
// Inscriptions actives du joueur aux animations (tous clubs).
router.get('/events', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await eventService.listUserRegistrations(req.user!.id)); }
  catch (err) { next(err); }
});
```

- [ ] **Step 6 : Vérifier compilation + tests + smoke HTTP**

Run : `npx tsc --noEmit` → exit 0. `npm test` → PASS.
Puis redémarrer le backend (le dev server `ts-node` ne recharge PAS tout seul : tuer le process sur le port 3001 et relancer `npm run dev`) et :

```bash
curl http://localhost:3001/api/clubs/lyon-padel-club/events
```

Expected: `[]` (aucun event encore créé), statut 200.

- [ ] **Step 7 : Commit**

```bash
git add backend/src/routes backend/src/app.ts
git commit -m "feat(events): routes publiques /api/events + /api/clubs/:slug/events, admin CRUD, /api/me/events"
```

---

### Task 7 : Frontend — types API + helpers `lib/events.ts` (TDD)

**Files:**
- Modify: `frontend/lib/api.ts`
- Create: `frontend/lib/events.ts`
- Create: `frontend/__tests__/events.test.ts`

- [ ] **Step 1 : Types + méthodes dans `frontend/lib/api.ts`**

Après les types tournois (autour de la ligne 805, après `UpdateTournamentBody`), ajouter :

```typescript
// --- Events (animations : mêlées, stages, soirées…) ---

export type ClubEventKind = 'MELEE' | 'STAGE' | 'SOIREE' | 'INITIATION' | 'AUTRE';
export type ClubEventStatus = 'DRAFT' | 'PUBLISHED' | 'CANCELLED';

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
  price: string | null;       // Decimal sérialisé — informatif, règlement au club
  memberOnly: boolean;
  status: ClubEventStatus;
  confirmedCount: number;
  waitlistCount: number;
}

export interface ClubEventDetail extends ClubEvent {
  club: { slug: string; name: string; timezone: string };
}

export interface EventRegistrationRecord {
  id: string;
  eventId: string;
  userId: string;
  status: RegistrationStatus;
}

export interface MyEventRegistration {
  id: string;
  status: RegistrationStatus;
  event: ClubEvent & { club: { slug: string; name: string; timezone: string } };
}

export interface AdminEventRegistration {
  id: string;
  status: RegistrationStatus;
  createdAt: string;
  user: { id: string; firstName: string; lastName: string; email: string; phone: string | null };
}

export interface AdminEventDetail {
  event: ClubEvent;
  registrations: AdminEventRegistration[];
}

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
};
export type UpdateEventBody = Partial<CreateEventBody & { status: ClubEventStatus }>;
```

Dans l'objet `api`, après les méthodes tournois (`cancelTournamentRegistration`, ligne ~222) :

```typescript
  getClubEvents: (slug: string) => request<ClubEvent[]>(`/api/clubs/${slug}/events`),

  getEvent: (id: string) => request<ClubEventDetail>(`/api/events/${id}`),

  registerEvent: (id: string, token: string) =>
    request<EventRegistrationRecord>(`/api/events/${id}/register`, { method: 'POST' }, token),

  cancelEventRegistration: (id: string, token: string) =>
    request<EventRegistrationRecord>(`/api/events/${id}/registration`, { method: 'DELETE' }, token),
```

Après `getMyTournaments` (ligne ~244) :

```typescript
  getMyEvents: (token: string) => request<MyEventRegistration[]>('/api/me/events', {}, token),
```

Après `adminRemoveRegistration` (ligne ~266) :

```typescript
  adminGetEvents: (clubId: string, token: string) =>
    request<ClubEvent[]>(`/api/clubs/${clubId}/admin/events`, {}, token),

  adminGetEvent: (clubId: string, id: string, token: string) =>
    request<AdminEventDetail>(`/api/clubs/${clubId}/admin/events/${id}`, {}, token),

  adminCreateEvent: (clubId: string, body: CreateEventBody, token: string) =>
    request<ClubEvent>(`/api/clubs/${clubId}/admin/events`, { method: 'POST', body: JSON.stringify(body) }, token),

  adminUpdateEvent: (clubId: string, id: string, body: UpdateEventBody, token: string) =>
    request<ClubEvent>(`/api/clubs/${clubId}/admin/events/${id}`, { method: 'PATCH', body: JSON.stringify(body) }, token),

  adminDeleteEvent: (clubId: string, id: string, token: string) =>
    request<{ ok: boolean }>(`/api/clubs/${clubId}/admin/events/${id}`, { method: 'DELETE' }, token),

  adminPromoteEventRegistration: (clubId: string, eventId: string, regId: string, token: string) =>
    request<AdminEventRegistration>(`/api/clubs/${clubId}/admin/events/${eventId}/registrations/${regId}`, { method: 'PATCH' }, token),

  adminRemoveEventRegistration: (clubId: string, eventId: string, regId: string, token: string) =>
    request<{ id: string }>(`/api/clubs/${clubId}/admin/events/${eventId}/registrations/${regId}`, { method: 'DELETE' }, token),
```

- [ ] **Step 2 : Écrire les tests des helpers (échouent)**

Créer `frontend/__tests__/events.test.ts` :

```typescript
import { mergeAgenda, filterAgenda, eventPlacesLabel, KIND_LABEL } from '@/lib/events';
import type { Tournament, ClubEvent } from '@/lib/api';

const NOW = new Date('2026-06-11T12:00:00Z');

const tournoi = (over: Partial<Tournament> = {}): Tournament => ({
  id: 't1', clubId: 'c1', clubSportId: 'cs1', name: 'P100', category: 'P100', gender: 'MEN',
  description: null, startTime: '2026-06-20T08:00:00.000Z', endTime: null,
  registrationDeadline: '2026-06-18T08:00:00.000Z', maxTeams: 8, entryFee: null,
  status: 'PUBLISHED', confirmedCount: 2, waitlistCount: 0, ...over,
} as Tournament);

const anim = (over: Partial<ClubEvent> = {}): ClubEvent => ({
  id: 'e1', clubId: 'c1', name: 'Mêlée du vendredi', kind: 'MELEE', description: null,
  startTime: '2026-06-15T18:00:00.000Z', endTime: null, registrationDeadline: '2026-06-15T12:00:00.000Z',
  capacity: 12, price: null, memberOnly: true, status: 'PUBLISHED', confirmedCount: 4, waitlistCount: 0, ...over,
});

describe('mergeAgenda', () => {
  it('fusionne et trie par date de début, PUBLISHED à venir seulement', () => {
    const items = mergeAgenda([tournoi()], [anim()], NOW);
    expect(items.map((i) => i.source)).toEqual(['event', 'tournament']); // 15/06 avant 20/06
  });
  it('exclut le passé et les non-PUBLISHED', () => {
    const past = anim({ startTime: '2026-06-01T18:00:00.000Z' });
    const draft = tournoi({ status: 'DRAFT' });
    expect(mergeAgenda([draft], [past], NOW)).toHaveLength(0);
  });
});

describe('filterAgenda', () => {
  const items = mergeAgenda([tournoi()], [anim()], NOW);
  it('competitions = tournois seulement, animations = events seulement', () => {
    expect(filterAgenda(items, 'competitions').every((i) => i.source === 'tournament')).toBe(true);
    expect(filterAgenda(items, 'animations').every((i) => i.source === 'event')).toBe(true);
    expect(filterAgenda(items, 'tout')).toHaveLength(2);
  });
});

describe('eventPlacesLabel', () => {
  it('capacité limitée : restantes / urgence / complet', () => {
    expect(eventPlacesLabel(anim({ capacity: 12, confirmedCount: 4 }))).toEqual({ text: '8 places restantes', urgent: false });
    expect(eventPlacesLabel(anim({ capacity: 12, confirmedCount: 9 }))).toEqual({ text: 'Plus que 3 places', urgent: true });
    expect(eventPlacesLabel(anim({ capacity: 12, confirmedCount: 12 }))).toEqual({ text: "Complet · liste d'attente possible", urgent: false });
  });
  it('sans capacité : nombre d inscrits', () => {
    expect(eventPlacesLabel(anim({ capacity: null, confirmedCount: 5 }))).toEqual({ text: '5 inscrits', urgent: false });
    expect(eventPlacesLabel(anim({ capacity: null, confirmedCount: 1 }))).toEqual({ text: '1 inscrit', urgent: false });
  });
});

describe('KIND_LABEL', () => {
  it('couvre tous les kinds', () => {
    expect(KIND_LABEL).toEqual({ MELEE: 'Mêlée', STAGE: 'Stage', SOIREE: 'Soirée', INITIATION: 'Initiation', AUTRE: 'Événement' });
  });
});
```

Run : `npm test -- events` → FAIL (`Cannot find module '@/lib/events'`).

- [ ] **Step 3 : Implémenter `frontend/lib/events.ts`**

```typescript
import type { Tournament, ClubEvent, ClubEventKind } from '@/lib/api';

// Helpers purs de la page Events : fusion tournois + animations, filtre, libellés.

export type AgendaFilter = 'tout' | 'competitions' | 'animations';

export type AgendaItem =
  | { source: 'tournament'; startTime: string; tournament: Tournament }
  | { source: 'event'; startTime: string; event: ClubEvent };

export const KIND_LABEL: Record<ClubEventKind, string> = {
  MELEE: 'Mêlée', STAGE: 'Stage', SOIREE: 'Soirée', INITIATION: 'Initiation', AUTRE: 'Événement',
};

/** Fusionne tournois + animations PUBLISHED à venir, triés par date de début. */
export function mergeAgenda(tournaments: Tournament[], events: ClubEvent[], now: Date): AgendaItem[] {
  const items: AgendaItem[] = [
    ...tournaments
      .filter((t) => t.status === 'PUBLISHED' && new Date(t.startTime) > now)
      .map((t) => ({ source: 'tournament' as const, startTime: t.startTime, tournament: t })),
    ...events
      .filter((e) => e.status === 'PUBLISHED' && new Date(e.startTime) > now)
      .map((e) => ({ source: 'event' as const, startTime: e.startTime, event: e })),
  ];
  // ISO UTC : ordre lexicographique = ordre chronologique
  return items.sort((a, b) => a.startTime.localeCompare(b.startTime));
}

export function filterAgenda(items: AgendaItem[], filter: AgendaFilter): AgendaItem[] {
  if (filter === 'competitions') return items.filter((i) => i.source === 'tournament');
  if (filter === 'animations') return items.filter((i) => i.source === 'event');
  return items;
}

/** Libellé des places d'une animation — urgent (rouge) quand il reste ≤ 5 places. */
export function eventPlacesLabel(e: ClubEvent): { text: string; urgent: boolean } {
  if (e.capacity != null) {
    const left = e.capacity - e.confirmedCount;
    if (left <= 0) return { text: "Complet · liste d'attente possible", urgent: false };
    if (left <= 5) return { text: `Plus que ${left} place${left > 1 ? 's' : ''}`, urgent: true };
    return { text: `${left} places restantes`, urgent: false };
  }
  const n = e.confirmedCount;
  return { text: `${n} inscrit${n > 1 ? 's' : ''}`, urgent: false };
}
```

- [ ] **Step 4 : Vérifier tests + types**

Run : `npm test -- events` → PASS. `npx tsc --noEmit` → exit 0.

- [ ] **Step 5 : Commit**

```bash
git add frontend/lib/api.ts frontend/lib/events.ts frontend/__tests__/events.test.ts
git commit -m "feat(events): types API + helpers purs lib/events (fusion, filtre, places)"
```

---

### Task 8 : Page `/events` + redirection `/tournois` + onglet nav

**Files:**
- Create: `frontend/app/events/page.tsx`
- Modify: `frontend/app/tournois/page.tsx` (devient une redirection — `app/tournois/[id]/page.tsx` ne bouge PAS)
- Modify: `frontend/components/ClubNav.tsx:37`

- [ ] **Step 1 : Créer `frontend/app/events/page.tsx`**

Reprendre la structure de l'actuel `app/tournois/page.tsx` (client component, `useClub`/`useTheme`, cartes `th.surface`) avec la fusion et le filtre :

```tsx
'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { api, Tournament, ClubEvent } from '@/lib/api';
import { mergeAgenda, filterAgenda, eventPlacesLabel, AgendaFilter, KIND_LABEL } from '@/lib/events';
import { tournamentPlacesLabel } from '@/lib/clubhouse';
import { Screen } from '@/components/ui/Screen';
import { Icon } from '@/components/ui/Icon';
import { ClubNav } from '@/components/ClubNav';

const GENDER_LABEL: Record<string, string> = { MEN: 'Messieurs', WOMEN: 'Dames', MIXED: 'Mixte' };
const FILTERS: { key: AgendaFilter; label: string }[] = [
  { key: 'tout', label: 'Tout' }, { key: 'competitions', label: 'Compétitions' }, { key: 'animations', label: 'Animations' },
];

function formatDate(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }).format(new Date(iso));
}

export default function EventsPage() {
  const { club, loading } = useClub();
  const { th } = useTheme();
  const router = useRouter();
  const params = useSearchParams();
  const initial = (params.get('filtre') as AgendaFilter) || 'tout';
  const [filter, setFilter] = useState<AgendaFilter>(['tout', 'competitions', 'animations'].includes(initial) ? initial : 'tout');
  const [tournaments, setTournaments] = useState<Tournament[] | null>(null);
  const [events, setEvents] = useState<ClubEvent[] | null>(null);

  useEffect(() => {
    if (!club) return;
    api.getClubTournaments(club.slug).then(setTournaments).catch(() => setTournaments([]));
    api.getClubEvents(club.slug).then(setEvents).catch(() => setEvents([]));
  }, [club?.slug]);

  const items = useMemo(
    () => (tournaments && events ? filterAgenda(mergeAgenda(tournaments, events, new Date()), filter) : null),
    [tournaments, events, filter],
  );

  if (loading || !club) {
    return <div style={{ minHeight: '100vh', background: th.bg, color: th.textFaint, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI }}>Chargement…</div>;
  }

  const chip = (active: boolean) => ({
    border: 'none', cursor: 'pointer', borderRadius: 999, padding: '8px 16px',
    fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700,
    background: active ? th.ink : th.surface, color: active ? (th.mode === 'floodlit' ? th.text : '#f7f5ee') : th.textMute,
    boxShadow: active ? 'none' : `inset 0 0 0 1px ${th.line}`,
  });

  return (
    <Screen>
      <div style={{ paddingBottom: 40 }}>
        <ClubNav club={club} />

        <div style={{ padding: '18px 20px 0' }}>
          <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 30, color: th.text, letterSpacing: -0.5 }}>Events</div>
          <div style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, marginTop: 4 }}>{club.name}</div>
        </div>

        <div style={{ padding: '16px 20px 0', display: 'flex', gap: 8 }}>
          {FILTERS.map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)} style={chip(filter === f.key)}>{f.label}</button>
          ))}
        </div>

        <div style={{ padding: '18px 20px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items === null && <div style={{ fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>}
          {items?.length === 0 && <div style={{ fontFamily: th.fontUI, color: th.textMute }}>Rien de prévu pour le moment.</div>}
          {items?.map((item) => {
            const isT = item.source === 'tournament';
            const id = isT ? item.tournament.id : item.event.id;
            const name = isT ? item.tournament.name : item.event.name;
            const tag = isT ? `${item.tournament.category} · ${GENDER_LABEL[item.tournament.gender]}` : KIND_LABEL[item.event.kind];
            const places = isT ? tournamentPlacesLabel(item.tournament) : eventPlacesLabel(item.event);
            const href = isT ? `/tournois/${id}` : `/events/${id}`;
            return (
              <button key={`${item.source}-${id}`} onClick={() => router.push(href)}
                style={{ border: 'none', cursor: 'pointer', textAlign: 'left', width: '100%', background: th.surface, borderRadius: 16, padding: '16px 18px', boxShadow: `inset 0 0 0 1px ${th.line}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Icon name={isT ? 'trophy' : 'bolt'} size={15} color={th.textMute} />
                  <span style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute }}>{tag}</span>
                </div>
                <div style={{ fontFamily: th.fontUI, fontSize: 16.5, fontWeight: 700, color: th.text, marginTop: 6 }}>{name}</div>
                <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, marginTop: 3 }}>
                  {formatDate(item.startTime, club.timezone)}
                  {' · '}
                  <span style={{ color: places.urgent ? '#e05656' : th.textMute, fontWeight: places.urgent ? 700 : 400 }}>{places.text}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </Screen>
  );
}
```

Note : si le composant utilisant `useSearchParams` casse le build (`missing suspense boundary`), envelopper le contenu dans `<Suspense>` selon la doc `node_modules/next/dist/docs/` (lire la doc Next 16 du repo avant de coder — voir `frontend/AGENTS.md`).

- [ ] **Step 2 : `/tournois` devient une redirection**

Remplacer **tout le contenu** de `frontend/app/tournois/page.tsx` par :

```tsx
import { redirect } from 'next/navigation';

// L'onglet « Tournois » est devenu « Events » (tournois + animations).
// Les fiches /tournois/[id] restent en place.
export default function TournoisRedirect() {
  redirect('/events?filtre=competitions');
}
```

`frontend/app/tournois/[id]/page.tsx` ne change pas.

- [ ] **Step 3 : Onglet nav**

Dans `frontend/components/ClubNav.tsx` ligne 37, remplacer :

```tsx
    { label: 'Tournois', href: '/tournois', icon: 'trophy', match: (p) => p.startsWith('/tournois'), show: true },
```

par :

```tsx
    { label: 'Events', href: '/events', icon: 'trophy', match: (p) => p.startsWith('/events') || p.startsWith('/tournois'), show: true },
```

Mettre à jour le commentaire de la ligne 16 (`Réserver / Tournois /` → `Réserver / Events /`).

- [ ] **Step 4 : Vérifier**

Run : `npx tsc --noEmit` → exit 0. Puis en manuel (front + back démarrés) : `/events` affiche les tournois seedés sous le filtre Tout et Compétitions ; `/tournois` redirige vers `/events?filtre=competitions`.

- [ ] **Step 5 : Commit**

```bash
git add frontend/app/events/page.tsx frontend/app/tournois/page.tsx frontend/components/ClubNav.tsx
git commit -m "feat(events): page /events avec filtre Tout/Competitions/Animations, onglet nav, redirection /tournois"
```

---

### Task 9 : Fiche animation `/events/[id]`

**Files:**
- Create: `frontend/app/events/[id]/page.tsx`

- [ ] **Step 1 : Créer la fiche**

Page client : détail + inscription/désinscription. L'inscription du joueur est retrouvée via `api.getMyEvents(token)` (même pattern que les tournois avec `/api/me/tournaments`).

```tsx
'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useClub } from '@/lib/ClubProvider';
import { useAuth } from '@/lib/useAuth';
import { useTheme } from '@/lib/ThemeProvider';
import { api, ClubEventDetail, MyEventRegistration } from '@/lib/api';
import { eventPlacesLabel, KIND_LABEL } from '@/lib/events';
import { Screen } from '@/components/ui/Screen';
import { Btn } from '@/components/ui/atoms';
import { ClubNav } from '@/components/ClubNav';

const ERROR_LABEL: Record<string, string> = {
  MEMBERSHIP_REQUIRED: 'Cet event est réservé aux membres du club.',
  MEMBERSHIP_BLOCKED: 'Votre compte est bloqué dans ce club — rapprochez-vous de l’accueil.',
  ALREADY_REGISTERED: 'Vous êtes déjà inscrit.',
  REGISTRATION_CLOSED: 'Les inscriptions sont closes.',
  REGISTRATION_LOCKED: 'La date limite est passée, la désinscription se fait à l’accueil.',
  EVENT_NOT_OPEN: 'Cet event n’est pas ouvert aux inscriptions.',
};

function fmt(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso)).replace(':', 'h');
}

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { club, loading } = useClub();
  const { token, ready } = useAuth();
  const { th } = useTheme();
  const router = useRouter();
  const [event, setEvent] = useState<ClubEventDetail | null>(null);
  const [myReg, setMyReg] = useState<MyEventRegistration | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(() => {
    api.getEvent(id).then(setEvent).catch(() => setNotFound(true));
    if (token) api.getMyEvents(token).then((regs) => setMyReg(regs.find((r) => r.event.id === id) ?? null)).catch(() => setMyReg(null));
  }, [id, token]);

  useEffect(() => { if (ready) load(); }, [ready, load]);

  if (loading || !club || (!event && !notFound)) {
    return <div style={{ minHeight: '100vh', background: th.bg, color: th.textFaint, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI }}>Chargement…</div>;
  }

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); load(); }
    catch (e) { const code = (e as Error).message; setError(ERROR_LABEL[code] ?? code); }
    finally { setBusy(false); }
  };

  const deadlinePassed = event ? new Date(event.registrationDeadline) <= new Date() : false;
  const full = event ? event.capacity != null && event.confirmedCount >= event.capacity : false;
  const places = event ? eventPlacesLabel(event) : null;

  return (
    <Screen>
      <div style={{ paddingBottom: 40 }}>
        <ClubNav club={club} />

        {notFound || !event ? (
          <div style={{ padding: '40px 20px', fontFamily: th.fontUI, color: th.textMute }}>Cet event n’existe pas ou n’est plus visible.</div>
        ) : (
          <div style={{ padding: '18px 20px 0', maxWidth: 640 }}>
            <span style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute }}>
              {KIND_LABEL[event.kind]}{event.memberOnly ? ' · réservé aux membres' : ''}
            </span>
            <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 30, color: th.text, letterSpacing: -0.5, margin: '6px 0 0' }}>{event.name}</h1>

            <div style={{ marginTop: 16, background: th.surface, borderRadius: 16, padding: '16px 18px', boxShadow: `inset 0 0 0 1px ${th.line}`, display: 'flex', flexDirection: 'column', gap: 8, fontFamily: th.fontUI, fontSize: 14.5, color: th.text }}>
              <div>📅 {fmt(event.startTime, event.club.timezone)}{event.endTime ? ` → ${fmt(event.endTime, event.club.timezone)}` : ''}</div>
              <div>✍️ Inscriptions jusqu’au {fmt(event.registrationDeadline, event.club.timezone)}</div>
              {event.price != null && Number(event.price) > 0 && <div>💶 {Number(event.price)} € — règlement au club</div>}
              {places && <div style={{ color: places.urgent ? '#e05656' : th.text, fontWeight: places.urgent ? 700 : 400 }}>👥 {places.text}</div>}
            </div>

            {event.description && (
              <p style={{ fontFamily: th.fontUI, fontSize: 14.5, color: th.textMute, marginTop: 16, whiteSpace: 'pre-wrap' }}>{event.description}</p>
            )}

            {error && <div style={{ marginTop: 16, background: th.accent, color: th.onAccent, borderRadius: 12, padding: '11px 14px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>{error}</div>}

            <div style={{ marginTop: 20 }}>
              {!token && ready && (
                <Btn onClick={() => router.push('/login')} icon="user">Se connecter pour s’inscrire</Btn>
              )}
              {token && !myReg && !deadlinePassed && (
                <Btn onClick={() => act(() => api.registerEvent(event.id, token))} disabled={busy} icon="check">
                  {busy ? '…' : full ? 'Rejoindre la liste d’attente' : 'S’inscrire'}
                </Btn>
              )}
              {token && myReg && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <span style={{ fontFamily: th.fontUI, fontSize: 14.5, fontWeight: 700, color: th.text }}>
                    {myReg.status === 'CONFIRMED' ? '✅ Vous êtes inscrit.' : '⏳ Vous êtes en liste d’attente.'}
                  </span>
                  {!deadlinePassed && (
                    <Btn onClick={() => act(() => api.cancelEventRegistration(event.id, token))} disabled={busy} icon="cross">
                      {busy ? '…' : 'Se désinscrire'}
                    </Btn>
                  )}
                </div>
              )}
              {deadlinePassed && !myReg && (
                <span style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute }}>Les inscriptions sont closes.</span>
              )}
            </div>
          </div>
        )}
      </div>
    </Screen>
  );
}
```

Avant d'écrire le fichier, vérifier les noms d'icônes disponibles dans `frontend/components/ui/Icon.tsx` (`check`, `cross`, `user`…) et les props exactes de `Btn` dans `components/ui/atoms` — ajuster si besoin.

- [ ] **Step 2 : Vérifier**

Run : `npx tsc --noEmit` → exit 0. Manuel : créer un event en SQL ou attendre la Task 10, puis tester inscription/désinscription avec `test@palova.fr`.

- [ ] **Step 3 : Commit**

```bash
git add frontend/app/events
git commit -m "feat(events): fiche /events/[id] - inscription, liste d'attente, desinscription"
```

---

### Task 10 : Back-office `/admin/events`

**Files:**
- Create: `frontend/app/admin/events/page.tsx`
- Modify: `frontend/app/admin/layout.tsx:55` (entrée de menu)

- [ ] **Step 1 : Entrée de menu**

Dans `frontend/app/admin/layout.tsx`, après la ligne `{ href: '/admin/tournaments', label: 'Tournois', icon: 'trophy' as const },` ajouter :

```tsx
    { href: '/admin/events',       label: 'Events',          icon: 'bolt' as const },
```

- [ ] **Step 2 : Créer `frontend/app/admin/events/page.tsx`**

Calquer la structure de `app/admin/tournaments/page.tsx` (183 lignes : liste + formulaire + détail inscrits, états `list/form/detail/error`, `reload` en `useCallback`). Lire ce fichier avant d'écrire pour copier les styles exacts (cartes, champs, boutons). Contenu fonctionnel :

```tsx
'use client';
import { useCallback, useEffect, useState } from 'react';
import { useClub } from '@/lib/ClubProvider';
import { useAuth } from '@/lib/useAuth';
import { useTheme } from '@/lib/ThemeProvider';
import { api, ClubEvent, AdminEventDetail, CreateEventBody, ClubEventKind } from '@/lib/api';
import { KIND_LABEL } from '@/lib/events';
import { Icon } from '@/components/ui/Icon';

const KINDS: ClubEventKind[] = ['MELEE', 'STAGE', 'SOIREE', 'INITIATION', 'AUTRE'];

const emptyForm = (): CreateEventBody => ({
  name: '', kind: 'MELEE', description: '', startTime: '', endTime: null,
  registrationDeadline: '', capacity: null, price: null, memberOnly: true,
});

export default function AdminEventsPage() {
  const { club } = useClub();
  const { token } = useAuth();
  const { th } = useTheme();
  const [list, setList] = useState<ClubEvent[]>([]);
  const [form, setForm] = useState<CreateEventBody | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminEventDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!club || !token) return;
    api.adminGetEvents(club.id, token).then(setList).catch(() => setList([]));
  }, [club?.id, token]);

  useEffect(() => { reload(); }, [reload]);

  if (!club || !token) return null;

  const toISO = (v: string) => (v ? new Date(v).toISOString() : '');

  const save = async () => {
    if (!form) return;
    setError(null);
    try {
      const body = { ...form, startTime: toISO(form.startTime), registrationDeadline: toISO(form.registrationDeadline), endTime: form.endTime ? toISO(form.endTime) : null };
      if (editingId) await api.adminUpdateEvent(club.id, editingId, body, token);
      else await api.adminCreateEvent(club.id, body, token);
      setForm(null); setEditingId(null); reload();
    } catch (e) { setError((e as Error).message); }
  };

  const setStatus = async (id: string, status: 'DRAFT' | 'PUBLISHED' | 'CANCELLED') => {
    setError(null);
    try { await api.adminUpdateEvent(club.id, id, { status }, token); reload(); }
    catch (e) { setError((e as Error).message); }
  };

  const openDetail = (id: string) =>
    api.adminGetEvent(club.id, id, token).then(setDetail).catch(() => setDetail(null));

  const removeReg = async (eventId: string, regId: string) => {
    await api.adminRemoveEventRegistration(club.id, eventId, regId, token);
    openDetail(eventId); reload();
  };
  const promoteReg = async (eventId: string, regId: string) => {
    await api.adminPromoteEventRegistration(club.id, eventId, regId, token);
    openDetail(eventId); reload();
  };

  // … rendu : reprendre EXACTEMENT les styles (card, field, label, table) de
  // app/admin/tournaments/page.tsx en remplaçant les champs spécifiques :
  // - select Kind (KINDS → KIND_LABEL) à la place de catégorie/genre/sport
  // - inputs datetime-local startTime / endTime / registrationDeadline
  // - input number capacity (vide = illimité), input number price (vide = gratuit)
  // - checkbox memberOnly « Réservé aux membres »
  // - liste : nom · kind · date · statut (DRAFT/PUBLISHED/CANCELLED) · inscrits (confirmedCount/capacity)
  //   + actions Publier/Repasser en brouillon/Annuler, Modifier, Inscrits, Supprimer (si 0 inscrit)
  // - détail inscrits : nom, email, téléphone, statut, bouton Promouvoir (si WAITLISTED), bouton Retirer
}
```

⚠️ Le commentaire `// … rendu :` ci-dessus n'est PAS un placeholder à laisser : l'exécutant DOIT écrire le JSX complet en copiant la structure visuelle de `app/admin/tournaments/page.tsx` (qu'il aura lue), avec les champs listés. Le squelette logique (états, handlers) ci-dessus est complet et à reprendre tel quel.

- [ ] **Step 3 : Vérifier**

Run : `npx tsc --noEmit` → exit 0. Manuel : créer une mêlée memberOnly via `/admin/events`, la publier, vérifier qu'elle apparaît sur `/events` (filtre Animations) et que l'inscription marche depuis la fiche.

- [ ] **Step 4 : Commit**

```bash
git add frontend/app/admin
git commit -m "feat(events): back-office /admin/events - CRUD, publication, gestion des inscrits"
```

---

### Task 11 : Club-house — bloc « Prochains events »

**Files:**
- Modify: `frontend/components/ClubHouse.tsx`
- Modify: `frontend/components/clubhouse/TournamentsAlaUne.tsx`
- Modify: `frontend/lib/clubhouse.ts` (si le picker y vit)
- Modify: `frontend/__tests__/` (test du picker fusionné si `lib/clubhouse.ts` est testé)

- [ ] **Step 1 : Généraliser le bloc**

Dans `ClubHouse.tsx` : ajouter le fetch `api.getClubEvents(club.slug)` à côté de `getClubTournaments`, fusionner avec `mergeAgenda` (de `lib/events.ts`), garder les 2-3 prochains (`.slice(0, 3)`).

Dans `TournamentsAlaUne.tsx` : renommer le titre affiché « Prochains tournois » → **« Prochains events »**, et faire accepter `items: AgendaItem[]` au lieu de `tournaments: Tournament[]` — chaque ligne affiche le badge (catégorie+genre pour un tournoi, `KIND_LABEL` pour une animation), le libellé des places (`tournamentPlacesLabel` / `eventPlacesLabel`) et pointe vers `/tournois/[id]` ou `/events/[id]` selon la source. Conserver le nom de fichier (pas de renommage de composant nécessaire en v1 — un commentaire suffit).

- [ ] **Step 2 : Vérifier**

Run : `npm test` (frontend) → PASS ; `npx tsc --noEmit` → exit 0. Manuel : le Club-house montre la mêlée créée en Task 10 dans « Prochains events ».

- [ ] **Step 3 : Commit**

```bash
git add frontend/components frontend/lib
git commit -m "feat(events): club-house - bloc Prochains events (tournois + animations)"
```

---

### Task 12 : Documentation + vérifications finales

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1 : Documenter dans `CLAUDE.md`**

Ajouter une section après « Caisse & carnets (v1) » :

```markdown
## Events & animations (v1) ✅ implémenté

L'onglet « Tournois » devient **« Events »** (`/events`, redirection `/tournois` → `/events?filtre=competitions`, fiches `/tournois/[id]` inchangées) : page unique fusionnant **tournois + animations** côté client avec filtre `[ Tout | Compétitions | Animations ]`. Nouveau modèle **`ClubEvent`** (kind MELEE/STAGE/SOIREE/INITIATION/AUTRE, capacité opt., prix informatif, `memberOnly`, statut DRAFT/PUBLISHED/CANCELLED, migration `add_club_events`) + **`EventRegistration`** (inscription **individuelle**, `@@unique([eventId,userId])`, réinscription = la ligne CANCELLED repart en fin de file). `EventService` miroir simplifié de `TournamentService` : inscription en transaction Serializable + FOR UPDATE, liste d'attente avec **promotion auto**, BLOCKED refusé partout, `memberOnly` → membre ACTIF requis. Routes : `/api/events/:id{,/register,/registration}`, `/api/clubs/:slug/events`, admin `/api/clubs/:clubId/admin/events*`, `GET /api/me/events`. Front : `/events` + fiche `/events/[id]`, `/admin/events`, bloc Club-house « Prochains events » ; helpers purs `lib/events.ts`. Hors v1 : blocage de terrains, e-mails, paiement en ligne, récurrence. Spec & plan : `docs/superpowers/{specs,plans}/2026-06-11-events-animations*`.
```

Et dans « À implémenter », mettre à jour la ligne tournois-évolutions pour mentionner les évolutions events (notifications, blocage terrains, récurrence).

- [ ] **Step 2 : Vérifications finales complètes**

```bash
cd backend && npm test && npx tsc --noEmit
cd ../frontend && npm test && npx tsc --noEmit
```

Expected: tout PASS, exit 0 partout.

Parcours manuel de bout en bout :
1. `/admin/events` → créer « Mêlée du vendredi » (MELEE, capacité 2, memberOnly), publier.
2. `/events` → visible sous Animations ; `/tournois` redirige.
3. S'inscrire avec 2 comptes membres → CONFIRMED ×2 ; un 3e compte → liste d'attente.
4. Désinscrire un CONFIRMED → le 3e est promu (recharger la fiche).
5. Compte non-membre sur un event memberOnly → message « réservé aux membres ».

- [ ] **Step 3 : Commit final**

```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md - events & animations (ClubEvent, inscriptions individuelles)"
```
