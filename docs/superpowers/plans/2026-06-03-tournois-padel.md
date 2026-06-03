# Tournois de padel — Plan d'implémentation (v1 : inscriptions)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à un club de publier des tournois de padel (P25→P2000, Messieurs/Dames/Mixte) et aux joueurs de s'y inscrire en binôme — avec contrôle membre+licence+téléphone+sexe, liste d'attente, et modification/annulation jusqu'à une date limite.

**Architecture:** Backend Express 5 + Prisma 7 (service `TournamentService` calqué sur `ReservationService`, routes avec table `ERROR_STATUS`+`handleError`). Frontend Next.js 16 (pages client inline-stylées via le thème, client `lib/api.ts`). Migration Prisma purement **additive**. Spec : `docs/superpowers/specs/2026-06-03-tournois-padel-design.md`.

**Tech Stack:** TypeScript, Prisma 7 (adapter-pg), PostgreSQL, Jest + jest-mock-extended (deep mock Prisma), React 19, Luxon (déjà présent).

**Conventions à respecter (vérifiées dans le code) :**
- Service : classe, `import { prisma } from '../db/prisma'`, `throw new Error('CODE')`.
- Tests service : `import '../../__mocks__/prisma'` + `prismaMock`, pas de vraie DB.
- Routes : `ERROR_STATUS: Record<string,number>` + `handleError` + helper `asString`.
- Admin monté sur `/api/clubs/:clubId/admin` (router `mergeParams`, déjà gated `requireClubMember('STAFF')`, `req.membership!.clubId`).
- Décimaux/dates renvoyés bruts (Prisma sérialise `Decimal`→string, `Date`→ISO) — comme le reste du code.

---

## File Structure

**Backend (créés) :**
- `backend/src/services/tournament.service.ts` — toute la logique métier tournois.
- `backend/src/services/__tests__/tournament.service.test.ts` — tests unitaires.
- `backend/src/routes/tournaments.ts` — routes joueur (`/api/tournaments`).

**Backend (modifiés) :**
- `backend/prisma/schema.prisma` — enums + `User.sex` + `Tournament` + `TournamentRegistration`.
- `backend/src/app.ts` — montage du router tournois.
- `backend/src/routes/clubs.ts` — `GET /:slug/tournaments` (public).
- `backend/src/routes/me.ts` — `GET /me/profile`, `PATCH /me`, `GET /me/tournaments`.
- `backend/src/routes/admin.ts` — CRUD tournois + actions inscriptions.

**Frontend (créés) :**
- `frontend/app/tournois/page.tsx` — liste des tournois du club.
- `frontend/app/tournois/[id]/page.tsx` — détail + inscription/gestion binôme.
- `frontend/app/admin/tournaments/page.tsx` — back-office tournois.

**Frontend (modifiés) :**
- `frontend/lib/api.ts` — types + méthodes.
- `frontend/components/ui/Icon.tsx` — icône `trophy`.
- `frontend/components/ClubHome.tsx` — lien « Tournois » dans le hub.
- `frontend/app/admin/layout.tsx` — entrée de nav « Tournois ».

---

## Task 1 : Schéma Prisma + migration

**Files:**
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1 : Ajouter les enums** (après l'enum `MembershipStatus`, ~ligne 45 de `schema.prisma`)

```prisma
enum Sex {
  MALE
  FEMALE
}

enum TournamentGender {
  MEN     // Messieurs
  WOMEN   // Dames
  MIXED   // Mixte (1 MALE + 1 FEMALE)
}

enum TournamentStatus {
  DRAFT
  PUBLISHED
  CANCELLED
}

enum RegistrationStatus {
  CONFIRMED
  WAITLISTED
  CANCELLED
}
```

- [ ] **Step 2 : Ajouter `sex` + relations sur `User`** (dans `model User`, après `phone String?`)

```prisma
  sex       Sex?
```
Et dans la liste des relations de `User` (après `clubMemberships ClubMembership[]`) :
```prisma
  captainRegistrations TournamentRegistration[] @relation("CaptainRegistrations")
  partnerRegistrations TournamentRegistration[] @relation("PartnerRegistrations")
```

- [ ] **Step 3 : Ajouter les relations inverses sur `Club` et `ClubSport`**

Dans `model Club`, après `sponsors Sponsor[]` :
```prisma
  tournaments Tournament[]
```
Dans `model ClubSport`, après `resources Resource[]` :
```prisma
  tournaments Tournament[]
```

- [ ] **Step 4 : Ajouter les modèles `Tournament` et `TournamentRegistration`** (à la fin du fichier)

```prisma
/// Tournoi de padel d'un club. v1 : inscriptions (pas de tableaux/scores).
model Tournament {
  id                   String           @id @default(cuid())
  clubId               String           @map("club_id")
  clubSportId          String           @map("club_sport_id")
  name                 String
  category             String                                   // "P25","P50","P100",…
  gender               TournamentGender
  description          String?
  startTime            DateTime         @map("start_time") @db.Timestamptz
  endTime              DateTime?        @map("end_time") @db.Timestamptz
  registrationDeadline DateTime         @map("registration_deadline") @db.Timestamptz
  maxTeams             Int?             @map("max_teams")        // null = illimité
  entryFee             Decimal?         @map("entry_fee") @db.Decimal(10, 2)
  status               TournamentStatus @default(DRAFT)
  createdAt            DateTime         @default(now()) @map("created_at")
  updatedAt            DateTime         @updatedAt @map("updated_at")

  club          Club                     @relation(fields: [clubId], references: [id], onDelete: Cascade)
  clubSport     ClubSport                @relation(fields: [clubSportId], references: [id], onDelete: Restrict)
  registrations TournamentRegistration[]

  @@index([clubId])
  @@index([clubId, status, startTime])
  @@map("tournaments")
}

/// Un binôme inscrit à un tournoi (capitaine + coéquipier, tous deux membres du club).
model TournamentRegistration {
  id            String             @id @default(cuid())
  tournamentId  String             @map("tournament_id")
  captainUserId String             @map("captain_user_id")
  partnerUserId String             @map("partner_user_id")
  status        RegistrationStatus @default(CONFIRMED)
  cancelledAt   DateTime?          @map("cancelled_at")
  createdAt     DateTime           @default(now()) @map("created_at") // = ordre liste d'attente
  updatedAt     DateTime           @updatedAt @map("updated_at")

  tournament Tournament @relation(fields: [tournamentId], references: [id], onDelete: Cascade)
  captain    User       @relation("CaptainRegistrations", fields: [captainUserId], references: [id], onDelete: Restrict)
  partner    User       @relation("PartnerRegistrations", fields: [partnerUserId], references: [id], onDelete: Restrict)

  @@index([tournamentId, status, createdAt])
  @@index([captainUserId])
  @@index([partnerUserId])
  @@map("tournament_registrations")
}
```

- [ ] **Step 5 : Valider le schéma**

Run (depuis `backend/`) : `npx prisma validate`
Expected : `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 6 : Créer la migration + régénérer le client** (Docker Postgres doit tourner — cf. CLAUDE.md)

Run (depuis `backend/`) : `npm run db:migrate -- --name add_tournaments`
Expected : nouvelle migration `prisma/migrations/<ts>_add_tournaments/`, client régénéré, « Your database is now in sync ».

- [ ] **Step 7 : Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(tournois): schema Prisma tournois + inscriptions + sexe joueur"
```

---

## Task 2 : `TournamentService` — inscription (validation + places)

**Files:**
- Create: `backend/src/services/tournament.service.ts`
- Test: `backend/src/services/__tests__/tournament.service.test.ts`

- [ ] **Step 1 : Écrire le squelette du service avec `register` + helpers**

Créer `backend/src/services/tournament.service.ts` :

```typescript
import { Prisma, TournamentGender, TournamentStatus } from '@prisma/client';
import { prisma } from '../db/prisma';

type Sex = 'MALE' | 'FEMALE';

export interface CreateTournamentInput {
  clubSportId: string;
  name: string;
  category: string;
  gender: TournamentGender;
  description?: string | null;
  startTime: string | Date;
  endTime?: string | Date | null;
  registrationDeadline: string | Date;
  maxTeams?: number | null;
  entryFee?: number | null;
}
export type UpdateTournamentInput = Partial<CreateTournamentInput & { status: TournamentStatus }>;

/** Erreur métier avec, optionnellement, le joueur concerné ("self" | "partner"). */
function appError(code: string, subject?: 'self' | 'partner'): Error {
  return Object.assign(new Error(code), subject ? { subject } : {});
}

export class TournamentService {
  // ---------------------------------------------------------------- Inscription

  /** Inscrit un binôme (capitaine connecté + coéquipier par e-mail). */
  async register(tournamentId: string, captainUserId: string, partnerEmail: string) {
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { id: true, clubId: true, gender: true, status: true, registrationDeadline: true, maxTeams: true },
    });
    if (!tournament) throw new Error('TOURNAMENT_NOT_FOUND');
    if (tournament.status !== 'PUBLISHED') throw new Error('TOURNAMENT_NOT_OPEN');
    if (new Date() >= tournament.registrationDeadline) throw new Error('REGISTRATION_CLOSED');

    const { partnerUserId } = await this.resolveAndAssertEligible(tournament, captainUserId, partnerEmail);
    await this.assertNoActiveRegistration(tournamentId, [captainUserId, partnerUserId]);

    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tournaments WHERE id = ${tournamentId} FOR UPDATE`;
      const confirmed = await tx.tournamentRegistration.count({ where: { tournamentId, status: 'CONFIRMED' } });
      const status = tournament.maxTeams == null || confirmed < tournament.maxTeams ? 'CONFIRMED' : 'WAITLISTED';
      return tx.tournamentRegistration.create({
        data: { tournamentId, captainUserId, partnerUserId, status },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 });
  }

  // ----------------------------------------------------------------- Helpers

  /** Vérifie l'éligibilité des 2 joueurs et renvoie l'id résolu du coéquipier. */
  private async resolveAndAssertEligible(
    tournament: { clubId: string; gender: TournamentGender },
    captainUserId: string,
    partnerEmail: string,
  ): Promise<{ partnerUserId: string }> {
    const email = (partnerEmail ?? '').trim().toLowerCase();
    if (!email) throw appError('PARTNER_NOT_FOUND', 'partner');

    const [captain, partner] = await Promise.all([
      prisma.user.findUnique({ where: { id: captainUserId }, select: { id: true, sex: true, phone: true } }),
      prisma.user.findUnique({ where: { email }, select: { id: true, sex: true, phone: true } }),
    ]);
    if (!captain) throw new Error('USER_NOT_FOUND');
    if (!partner) throw appError('PARTNER_NOT_FOUND', 'partner');
    if (partner.id === captain.id) throw new Error('PARTNER_IS_SELF');

    const [capM, partM] = await Promise.all([
      prisma.clubMembership.findUnique({ where: { userId_clubId: { userId: captain.id, clubId: tournament.clubId } }, select: { status: true, membershipNo: true } }),
      prisma.clubMembership.findUnique({ where: { userId_clubId: { userId: partner.id, clubId: tournament.clubId } }, select: { status: true, membershipNo: true } }),
    ]);

    if (capM?.status === 'BLOCKED') throw appError('MEMBERSHIP_BLOCKED', 'self');
    if (!capM) throw appError('MEMBERSHIP_REQUIRED', 'self');
    if (partM?.status === 'BLOCKED') throw appError('MEMBERSHIP_BLOCKED', 'partner');
    if (!partM) throw appError('MEMBERSHIP_REQUIRED', 'partner');

    if (!captain.phone) throw appError('PHONE_REQUIRED', 'self');
    if (!partner.phone) throw appError('PHONE_REQUIRED', 'partner');

    if (!capM.membershipNo) throw appError('LICENSE_REQUIRED', 'self');
    if (!partM.membershipNo) throw appError('LICENSE_REQUIRED', 'partner');

    if (!captain.sex) throw appError('SEX_REQUIRED', 'self');
    if (!partner.sex) throw appError('SEX_REQUIRED', 'partner');

    this.assertGender(tournament.gender, captain.sex as Sex, partner.sex as Sex);
    return { partnerUserId: partner.id };
  }

  private assertGender(gender: TournamentGender, a: Sex, b: Sex): void {
    const ok =
      gender === 'MEN'   ? a === 'MALE' && b === 'MALE' :
      gender === 'WOMEN' ? a === 'FEMALE' && b === 'FEMALE' :
      /* MIXED */          (a === 'MALE' && b === 'FEMALE') || (a === 'FEMALE' && b === 'MALE');
    if (!ok) throw new Error('GENDER_MISMATCH');
  }

  /** Aucun des userIds donnés ne doit déjà figurer dans un binôme actif du tournoi. */
  private async assertNoActiveRegistration(tournamentId: string, userIds: string[], excludeRegId?: string): Promise<void> {
    const dup = await prisma.tournamentRegistration.findFirst({
      where: {
        tournamentId,
        status: { not: 'CANCELLED' },
        ...(excludeRegId ? { id: { not: excludeRegId } } : {}),
        OR: [{ captainUserId: { in: userIds } }, { partnerUserId: { in: userIds } }],
      },
      select: { id: true },
    });
    if (dup) throw new Error('ALREADY_REGISTERED');
  }
}
```

- [ ] **Step 2 : Écrire les tests d'inscription** (`tournament.service.test.ts`)

```typescript
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { TournamentService } from '../tournament.service';

const FUTURE = new Date(Date.now() + 86_400_000); // +24h

function tournament(overrides: Record<string, unknown> = {}) {
  return { id: 't1', clubId: 'club-demo', gender: 'MEN', status: 'PUBLISHED', registrationDeadline: FUTURE, maxTeams: 8, ...overrides };
}

/** Configure le chemin nominal d'éligibilité (2 hommes membres ACTIVE, tél + licence + sexe OK). */
function mockEligibleHappyPath() {
  prismaMock.user.findUnique.mockImplementation((args: any) => {
    if (args.where.id === 'captain') return Promise.resolve({ id: 'captain', sex: 'MALE', phone: '0600000001' }) as any;
    if (args.where.email === 'partner@x.fr') return Promise.resolve({ id: 'partner', sex: 'MALE', phone: '0600000002' }) as any;
    return Promise.resolve(null) as any;
  });
  prismaMock.clubMembership.findUnique.mockImplementation((args: any) => {
    const uid = args.where.userId_clubId.userId;
    return Promise.resolve({ status: 'ACTIVE', membershipNo: uid === 'captain' ? 'LIC-1' : 'LIC-2' }) as any;
  });
  prismaMock.tournamentRegistration.findFirst.mockResolvedValue(null as any);
  prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
  prismaMock.$queryRaw.mockResolvedValue([] as any);
}

describe('TournamentService.register', () => {
  let service: TournamentService;
  beforeEach(() => { service = new TournamentService(); });

  it('crée une inscription CONFIRMED quand il reste des places', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(tournament({ maxTeams: 8 }) as any);
    mockEligibleHappyPath();
    prismaMock.tournamentRegistration.count.mockResolvedValue(3 as any);
    prismaMock.tournamentRegistration.create.mockResolvedValue({ id: 'r1', status: 'CONFIRMED' } as any);

    const result = await service.register('t1', 'captain', 'partner@x.fr');

    expect(prismaMock.tournamentRegistration.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tournamentId: 't1', captainUserId: 'captain', partnerUserId: 'partner', status: 'CONFIRMED' }) }),
    );
    expect(result.status).toBe('CONFIRMED');
  });

  it('place en WAITLISTED quand le tournoi est complet', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(tournament({ maxTeams: 8 }) as any);
    mockEligibleHappyPath();
    prismaMock.tournamentRegistration.count.mockResolvedValue(8 as any);
    prismaMock.tournamentRegistration.create.mockResolvedValue({ id: 'r1', status: 'WAITLISTED' } as any);

    await service.register('t1', 'captain', 'partner@x.fr');

    expect(prismaMock.tournamentRegistration.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'WAITLISTED' }) }),
    );
  });

  it('CONFIRMED sans limite de places (maxTeams null)', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(tournament({ maxTeams: null }) as any);
    mockEligibleHappyPath();
    prismaMock.tournamentRegistration.count.mockResolvedValue(999 as any);
    prismaMock.tournamentRegistration.create.mockResolvedValue({ id: 'r1', status: 'CONFIRMED' } as any);

    await service.register('t1', 'captain', 'partner@x.fr');

    expect(prismaMock.tournamentRegistration.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CONFIRMED' }) }),
    );
  });

  it('lève TOURNAMENT_NOT_OPEN si le tournoi est DRAFT', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(tournament({ status: 'DRAFT' }) as any);
    await expect(service.register('t1', 'captain', 'partner@x.fr')).rejects.toThrow('TOURNAMENT_NOT_OPEN');
  });

  it('lève REGISTRATION_CLOSED après la deadline', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(tournament({ registrationDeadline: new Date(Date.now() - 1000) }) as any);
    await expect(service.register('t1', 'captain', 'partner@x.fr')).rejects.toThrow('REGISTRATION_CLOSED');
  });

  it('lève PARTNER_NOT_FOUND si le coéquipier n a pas de compte', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(tournament() as any);
    prismaMock.user.findUnique.mockImplementation((args: any) =>
      (args.where.id === 'captain' ? Promise.resolve({ id: 'captain', sex: 'MALE', phone: '0600' }) : Promise.resolve(null)) as any);
    await expect(service.register('t1', 'captain', 'ghost@x.fr')).rejects.toThrow('PARTNER_NOT_FOUND');
  });

  it('lève MEMBERSHIP_REQUIRED si le coéquipier n est pas membre', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(tournament() as any);
    prismaMock.user.findUnique.mockImplementation((args: any) => {
      if (args.where.id === 'captain') return Promise.resolve({ id: 'captain', sex: 'MALE', phone: '0600' }) as any;
      if (args.where.email === 'partner@x.fr') return Promise.resolve({ id: 'partner', sex: 'MALE', phone: '0601' }) as any;
      return Promise.resolve(null) as any;
    });
    prismaMock.clubMembership.findUnique.mockImplementation((args: any) =>
      (args.where.userId_clubId.userId === 'captain' ? Promise.resolve({ status: 'ACTIVE', membershipNo: 'L1' }) : Promise.resolve(null)) as any);
    await expect(service.register('t1', 'captain', 'partner@x.fr')).rejects.toThrow('MEMBERSHIP_REQUIRED');
  });

  it('lève LICENSE_REQUIRED si une licence manque', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(tournament() as any);
    mockEligibleHappyPath();
    prismaMock.clubMembership.findUnique.mockImplementation((args: any) =>
      (args.where.userId_clubId.userId === 'captain' ? Promise.resolve({ status: 'ACTIVE', membershipNo: 'L1' }) : Promise.resolve({ status: 'ACTIVE', membershipNo: null })) as any);
    await expect(service.register('t1', 'captain', 'partner@x.fr')).rejects.toThrow('LICENSE_REQUIRED');
  });

  it('lève SEX_REQUIRED si le sexe d un joueur est absent', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(tournament() as any);
    mockEligibleHappyPath();
    prismaMock.user.findUnique.mockImplementation((args: any) => {
      if (args.where.id === 'captain') return Promise.resolve({ id: 'captain', sex: null, phone: '0600' }) as any;
      if (args.where.email === 'partner@x.fr') return Promise.resolve({ id: 'partner', sex: 'MALE', phone: '0601' }) as any;
      return Promise.resolve(null) as any;
    });
    await expect(service.register('t1', 'captain', 'partner@x.fr')).rejects.toThrow('SEX_REQUIRED');
  });

  it('lève GENDER_MISMATCH si un tournoi Mixte reçoit 2 hommes', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(tournament({ gender: 'MIXED' }) as any);
    mockEligibleHappyPath(); // 2 MALE
    await expect(service.register('t1', 'captain', 'partner@x.fr')).rejects.toThrow('GENDER_MISMATCH');
  });

  it('lève ALREADY_REGISTERED si un joueur est déjà engagé', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(tournament() as any);
    mockEligibleHappyPath();
    prismaMock.tournamentRegistration.findFirst.mockResolvedValue({ id: 'r-existing' } as any);
    await expect(service.register('t1', 'captain', 'partner@x.fr')).rejects.toThrow('ALREADY_REGISTERED');
  });
});
```

- [ ] **Step 3 : Lancer les tests, vérifier qu'ils passent**

Run (depuis `backend/`) : `npm test -- tournament.service`
Expected : tous les tests `TournamentService.register` PASS.

- [ ] **Step 4 : Commit**

```bash
git add backend/src/services/tournament.service.ts backend/src/services/__tests__/tournament.service.test.ts
git commit -m "feat(tournois): service inscription (validation membre/licence/sexe/genre + liste d'attente)"
```

---

## Task 3 : `TournamentService` — modifier / annuler / promotion

**Files:**
- Modify: `backend/src/services/tournament.service.ts`
- Test: `backend/src/services/__tests__/tournament.service.test.ts`

- [ ] **Step 1 : Ajouter `changePartner`, `cancelRegistration` et le helper de promotion**

Dans la classe `TournamentService`, après `register` :

```typescript
  /** Change de coéquipier : conserve statut + place en liste d'attente (createdAt inchangé). */
  async changePartner(tournamentId: string, captainUserId: string, partnerEmail: string) {
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { id: true, clubId: true, gender: true, status: true, registrationDeadline: true },
    });
    if (!tournament) throw new Error('TOURNAMENT_NOT_FOUND');
    if (tournament.status === 'CANCELLED') throw new Error('TOURNAMENT_NOT_OPEN');
    if (new Date() >= tournament.registrationDeadline) throw new Error('REGISTRATION_LOCKED');

    const reg = await prisma.tournamentRegistration.findFirst({
      where: { tournamentId, captainUserId, status: { not: 'CANCELLED' } },
      select: { id: true },
    });
    if (!reg) throw new Error('REGISTRATION_NOT_FOUND');

    const { partnerUserId } = await this.resolveAndAssertEligible(tournament, captainUserId, partnerEmail);
    await this.assertNoActiveRegistration(tournamentId, [captainUserId, partnerUserId], reg.id);

    return prisma.tournamentRegistration.update({
      where: { id: reg.id },
      data: { partnerUserId },
    });
  }

  /** Le capitaine se désinscrit avant la deadline ; promotion auto du 1er en attente. */
  async cancelRegistration(tournamentId: string, captainUserId: string) {
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { registrationDeadline: true },
    });
    if (!tournament) throw new Error('TOURNAMENT_NOT_FOUND');
    if (new Date() >= tournament.registrationDeadline) throw new Error('REGISTRATION_LOCKED');

    const reg = await prisma.tournamentRegistration.findFirst({
      where: { tournamentId, captainUserId, status: { not: 'CANCELLED' } },
      select: { id: true, status: true },
    });
    if (!reg) throw new Error('REGISTRATION_NOT_FOUND');

    return this.cancelAndPromote(tournamentId, reg.id, reg.status === 'CONFIRMED');
  }

  /** Passe une inscription CANCELLED et, si elle était CONFIRMED, promeut le 1er WAITLISTED. */
  private async cancelAndPromote(tournamentId: string, regId: string, wasConfirmed: boolean) {
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tournaments WHERE id = ${tournamentId} FOR UPDATE`;
      const cancelled = await tx.tournamentRegistration.update({
        where: { id: regId },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
      if (wasConfirmed) {
        const next = await tx.tournamentRegistration.findFirst({
          where: { tournamentId, status: 'WAITLISTED' },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });
        if (next) {
          await tx.tournamentRegistration.update({ where: { id: next.id }, data: { status: 'CONFIRMED' } });
        }
      }
      return cancelled;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 });
  }
```

- [ ] **Step 2 : Ajouter les tests** (dans `tournament.service.test.ts`, nouveau bloc `describe`)

```typescript
describe('TournamentService.changePartner / cancelRegistration', () => {
  let service: TournamentService;
  beforeEach(() => { service = new TournamentService(); });

  it('change de coéquipier sans toucher au statut (update partnerUserId seul)', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(tournament() as any);
    prismaMock.tournamentRegistration.findFirst
      .mockResolvedValueOnce({ id: 'reg-1' } as any) // recherche de l'inscription du capitaine
      .mockResolvedValueOnce(null as any);            // pas de doublon
    // éligibilité du nouveau partenaire (2 hommes)
    prismaMock.user.findUnique.mockImplementation((args: any) => {
      if (args.where.id === 'captain') return Promise.resolve({ id: 'captain', sex: 'MALE', phone: '0600' }) as any;
      if (args.where.email === 'new@x.fr') return Promise.resolve({ id: 'newp', sex: 'MALE', phone: '0602' }) as any;
      return Promise.resolve(null) as any;
    });
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE', membershipNo: 'L' } as any);
    prismaMock.tournamentRegistration.update.mockResolvedValue({ id: 'reg-1', partnerUserId: 'newp' } as any);

    await service.changePartner('t1', 'captain', 'new@x.fr');

    expect(prismaMock.tournamentRegistration.update).toHaveBeenCalledWith({
      where: { id: 'reg-1' },
      data: { partnerUserId: 'newp' },
    });
  });

  it('lève REGISTRATION_LOCKED si on modifie après la deadline', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(tournament({ registrationDeadline: new Date(Date.now() - 1000) }) as any);
    await expect(service.changePartner('t1', 'captain', 'new@x.fr')).rejects.toThrow('REGISTRATION_LOCKED');
  });

  it('annule et promeut le 1er WAITLISTED quand une place CONFIRMED se libère', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue({ registrationDeadline: FUTURE } as any);
    prismaMock.tournamentRegistration.findFirst
      .mockResolvedValueOnce({ id: 'reg-confirmed', status: 'CONFIRMED' } as any) // l'inscription du capitaine
      .mockResolvedValueOnce({ id: 'reg-waiting' } as any);                        // le 1er en attente
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([] as any);
    prismaMock.tournamentRegistration.update.mockResolvedValue({ id: 'reg-confirmed', status: 'CANCELLED' } as any);

    await service.cancelRegistration('t1', 'captain');

    expect(prismaMock.tournamentRegistration.update).toHaveBeenCalledWith({
      where: { id: 'reg-confirmed' },
      data: { status: 'CANCELLED', cancelledAt: expect.any(Date) },
    });
    expect(prismaMock.tournamentRegistration.update).toHaveBeenCalledWith({
      where: { id: 'reg-waiting' },
      data: { status: 'CONFIRMED' },
    });
  });

  it('ne promeut personne si l inscription annulée était WAITLISTED', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue({ registrationDeadline: FUTURE } as any);
    prismaMock.tournamentRegistration.findFirst.mockResolvedValueOnce({ id: 'reg-w', status: 'WAITLISTED' } as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([] as any);
    prismaMock.tournamentRegistration.update.mockResolvedValue({ id: 'reg-w', status: 'CANCELLED' } as any);

    await service.cancelRegistration('t1', 'captain');

    // une seule update (la mise en CANCELLED), pas de promotion
    expect(prismaMock.tournamentRegistration.update).toHaveBeenCalledTimes(1);
  });

  it('lève REGISTRATION_NOT_FOUND si le capitaine n a pas d inscription active', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue({ registrationDeadline: FUTURE } as any);
    prismaMock.tournamentRegistration.findFirst.mockResolvedValueOnce(null as any);
    await expect(service.cancelRegistration('t1', 'captain')).rejects.toThrow('REGISTRATION_NOT_FOUND');
  });
});
```

- [ ] **Step 3 : Lancer les tests**

Run : `npm test -- tournament.service`
Expected : tous PASS (register + changePartner/cancel).

- [ ] **Step 4 : Commit**

```bash
git add backend/src/services/tournament.service.ts backend/src/services/__tests__/tournament.service.test.ts
git commit -m "feat(tournois): modification de coéquipier + annulation avec promotion liste d'attente"
```

---

## Task 4 : `TournamentService` — lectures + administration club

**Files:**
- Modify: `backend/src/services/tournament.service.ts`
- Test: `backend/src/services/__tests__/tournament.service.test.ts`

- [ ] **Step 1 : Ajouter les méthodes de lecture et d'admin**

Dans la classe `TournamentService`, après `cancelAndPromote` :

```typescript
  // --------------------------------------------------------- Lectures publiques

  /** Tournois PUBLISHED à venir d'un club (par slug), avec compteurs de places. */
  async listPublicByClubSlug(slug: string) {
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, status: true } });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    const tournaments = await prisma.tournament.findMany({
      where: { clubId: club.id, status: 'PUBLISHED' },
      orderBy: { startTime: 'asc' },
    });
    return this.withCounts(tournaments);
  }

  /** Détail public d'un tournoi (DRAFT masqué) + compteurs. */
  async getById(tournamentId: string) {
    const t = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: { club: { select: { slug: true, name: true, timezone: true } }, clubSport: { select: { sport: { select: { key: true, name: true } } } } },
    });
    if (!t || t.status === 'DRAFT') throw new Error('TOURNAMENT_NOT_FOUND');
    const [withCount] = await this.withCounts([t]);
    return withCount;
  }

  /** Inscriptions actives du joueur connecté (capitaine OU partenaire), tous clubs. */
  async listUserRegistrations(userId: string) {
    return prisma.tournamentRegistration.findMany({
      where: { status: { not: 'CANCELLED' }, OR: [{ captainUserId: userId }, { partnerUserId: userId }] },
      orderBy: { tournament: { startTime: 'asc' } },
      include: {
        tournament: { include: { club: { select: { slug: true, name: true, timezone: true } } } },
        captain: { select: { id: true, firstName: true, lastName: true, email: true } },
        partner: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
  }

  /** Ajoute confirmedCount / waitlistCount à une liste de tournois. */
  private async withCounts<T extends { id: string }>(tournaments: T[]) {
    if (tournaments.length === 0) return [] as (T & { confirmedCount: number; waitlistCount: number })[];
    const grouped = await prisma.tournamentRegistration.groupBy({
      by: ['tournamentId', 'status'],
      where: { tournamentId: { in: tournaments.map((t) => t.id) }, status: { not: 'CANCELLED' } },
      _count: { _all: true },
    });
    const count = (id: string, status: string) =>
      grouped.find((g) => g.tournamentId === id && g.status === status)?._count._all ?? 0;
    return tournaments.map((t) => ({ ...t, confirmedCount: count(t.id, 'CONFIRMED'), waitlistCount: count(t.id, 'WAITLISTED') }));
  }

  // ----------------------------------------------------------- Admin (club)

  /** Tous les tournois du club (DRAFT inclus) + compteurs. */
  async listForAdmin(clubId: string) {
    const tournaments = await prisma.tournament.findMany({ where: { clubId }, orderBy: { startTime: 'desc' } });
    return this.withCounts(tournaments);
  }

  /** Détail admin : tournoi + inscriptions actives avec coordonnées (nom/tél/sexe/licence). */
  async getForAdmin(tournamentId: string, clubId: string) {
    const t = await prisma.tournament.findFirst({ where: { id: tournamentId, clubId } });
    if (!t) throw new Error('TOURNAMENT_NOT_FOUND');
    const registrations = await prisma.tournamentRegistration.findMany({
      where: { tournamentId, status: { not: 'CANCELLED' } },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      include: {
        captain: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, sex: true } },
        partner: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, sex: true } },
      },
    });
    const userIds = [...new Set(registrations.flatMap((r) => [r.captainUserId, r.partnerUserId]))];
    const memberships = userIds.length
      ? await prisma.clubMembership.findMany({ where: { clubId, userId: { in: userIds } }, select: { userId: true, membershipNo: true } })
      : [];
    const licenseByUser = new Map(memberships.map((m) => [m.userId, m.membershipNo]));
    return {
      tournament: t,
      registrations: registrations.map((r) => ({
        ...r,
        captainLicense: licenseByUser.get(r.captainUserId) ?? null,
        partnerLicense: licenseByUser.get(r.partnerUserId) ?? null,
      })),
    };
  }

  async createTournament(clubId: string, input: CreateTournamentInput) {
    const data = this.validateTournamentInput(input, true);
    const cs = await prisma.clubSport.findFirst({ where: { id: input.clubSportId, clubId }, select: { id: true } });
    if (!cs) throw new Error('CLUB_SPORT_NOT_FOUND');
    return prisma.tournament.create({ data: { clubId, clubSportId: input.clubSportId, ...data } });
  }

  async updateTournament(tournamentId: string, clubId: string, input: UpdateTournamentInput) {
    const found = await prisma.tournament.findFirst({ where: { id: tournamentId, clubId }, select: { id: true } });
    if (!found) throw new Error('TOURNAMENT_NOT_FOUND');
    const data = this.validateTournamentInput(input, false);
    if (input.status !== undefined) {
      if (!['DRAFT', 'PUBLISHED', 'CANCELLED'].includes(input.status as string)) throw new Error('VALIDATION_ERROR');
      (data as Record<string, unknown>).status = input.status;
    }
    return prisma.tournament.update({ where: { id: tournamentId }, data });
  }

  async deleteTournament(tournamentId: string, clubId: string) {
    const found = await prisma.tournament.findFirst({ where: { id: tournamentId, clubId }, select: { id: true } });
    if (!found) throw new Error('TOURNAMENT_NOT_FOUND');
    const active = await prisma.tournamentRegistration.count({ where: { tournamentId, status: { not: 'CANCELLED' } } });
    if (active > 0) throw new Error('HAS_REGISTRATIONS'); // utiliser status=CANCELLED pour annuler à la place
    await prisma.tournament.delete({ where: { id: tournamentId } });
  }

  /** Promotion manuelle d'un binôme en attente par le club (override, sans contrôle de place). */
  async adminPromoteRegistration(tournamentId: string, regId: string, clubId: string) {
    const reg = await this.findClubRegistration(tournamentId, regId, clubId);
    if (reg.status !== 'WAITLISTED') throw new Error('VALIDATION_ERROR');
    return prisma.tournamentRegistration.update({ where: { id: regId }, data: { status: 'CONFIRMED' } });
  }

  /** Désinscription manuelle par le club (promeut le 1er en attente si c'était un CONFIRMED). */
  async adminRemoveRegistration(tournamentId: string, regId: string, clubId: string) {
    const reg = await this.findClubRegistration(tournamentId, regId, clubId);
    return this.cancelAndPromote(tournamentId, regId, reg.status === 'CONFIRMED');
  }

  private async findClubRegistration(tournamentId: string, regId: string, clubId: string) {
    const reg = await prisma.tournamentRegistration.findFirst({
      where: { id: regId, tournamentId, tournament: { clubId } },
      select: { id: true, status: true },
    });
    if (!reg) throw new Error('REGISTRATION_NOT_FOUND');
    return reg;
  }

  /** Valide + normalise les champs d'un tournoi. `requireAll` pour la création. */
  private validateTournamentInput(input: UpdateTournamentInput, requireAll: boolean) {
    const data: Record<string, unknown> = {};
    const setStr = (key: 'name' | 'category', value?: string) => {
      const v = (value ?? '').trim();
      if (requireAll && !v) throw new Error('VALIDATION_ERROR');
      if (value !== undefined) { if (!v) throw new Error('VALIDATION_ERROR'); data[key] = v; }
    };
    setStr('name', input.name);
    setStr('category', input.category);

    if (requireAll || input.gender !== undefined) {
      if (!['MEN', 'WOMEN', 'MIXED'].includes(input.gender as string)) throw new Error('VALIDATION_ERROR');
      data.gender = input.gender;
    }
    if (input.description !== undefined) data.description = (input.description ?? '')?.toString().trim() || null;

    const parseDate = (v: string | Date) => { const d = new Date(v); if (isNaN(d.getTime())) throw new Error('VALIDATION_ERROR'); return d; };
    if (requireAll || input.startTime !== undefined) data.startTime = parseDate(input.startTime as string | Date);
    if (requireAll || input.registrationDeadline !== undefined) data.registrationDeadline = parseDate(input.registrationDeadline as string | Date);
    if (input.endTime !== undefined) data.endTime = input.endTime ? parseDate(input.endTime) : null;

    if (input.maxTeams !== undefined) {
      if (input.maxTeams === null) data.maxTeams = null;
      else { const n = Math.trunc(Number(input.maxTeams)); if (isNaN(n) || n < 1) throw new Error('VALIDATION_ERROR'); data.maxTeams = n; }
    }
    if (input.entryFee !== undefined) {
      if (input.entryFee === null) data.entryFee = null;
      else { const f = Number(input.entryFee); if (isNaN(f) || f < 0) throw new Error('VALIDATION_ERROR'); data.entryFee = new Prisma.Decimal(f); }
    }
    return data;
  }
```

- [ ] **Step 2 : Ajouter quelques tests admin/lecture** (nouveau `describe`)

```typescript
describe('TournamentService — admin & lectures', () => {
  let service: TournamentService;
  beforeEach(() => { service = new TournamentService(); });

  it('createTournament refuse un genre invalide', async () => {
    await expect(service.createTournament('club-demo', {
      clubSportId: 'cs1', name: 'Open', category: 'P100', gender: 'XXX' as any,
      startTime: FUTURE, registrationDeadline: FUTURE,
    })).rejects.toThrow('VALIDATION_ERROR');
  });

  it('createTournament refuse un clubSport d un autre club', async () => {
    prismaMock.clubSport.findFirst.mockResolvedValue(null as any);
    await expect(service.createTournament('club-demo', {
      clubSportId: 'cs-autre', name: 'Open', category: 'P100', gender: 'MEN',
      startTime: FUTURE, registrationDeadline: FUTURE,
    })).rejects.toThrow('CLUB_SPORT_NOT_FOUND');
  });

  it('createTournament crée avec entryFee en Decimal et maxTeams entier', async () => {
    prismaMock.clubSport.findFirst.mockResolvedValue({ id: 'cs1' } as any);
    prismaMock.tournament.create.mockResolvedValue({ id: 't1' } as any);
    await service.createTournament('club-demo', {
      clubSportId: 'cs1', name: '  Open P100  ', category: 'P100', gender: 'MIXED',
      startTime: FUTURE, registrationDeadline: FUTURE, maxTeams: 16, entryFee: 20,
    });
    const arg = (prismaMock.tournament.create as jest.Mock).mock.calls[0][0];
    expect(arg.data.name).toBe('Open P100');
    expect(arg.data.maxTeams).toBe(16);
    expect(arg.data.gender).toBe('MIXED');
  });

  it('deleteTournament refuse si des inscriptions actives existent', async () => {
    prismaMock.tournament.findFirst.mockResolvedValue({ id: 't1' } as any);
    prismaMock.tournamentRegistration.count.mockResolvedValue(2 as any);
    await expect(service.deleteTournament('t1', 'club-demo')).rejects.toThrow('HAS_REGISTRATIONS');
  });

  it('listPublicByClubSlug attache les compteurs de places', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
    prismaMock.tournament.findMany.mockResolvedValue([{ id: 't1' }, { id: 't2' }] as any);
    prismaMock.tournamentRegistration.groupBy.mockResolvedValue([
      { tournamentId: 't1', status: 'CONFIRMED', _count: { _all: 5 } },
      { tournamentId: 't1', status: 'WAITLISTED', _count: { _all: 2 } },
    ] as any);

    const result = await service.listPublicByClubSlug('club-demo');

    expect(result[0]).toMatchObject({ id: 't1', confirmedCount: 5, waitlistCount: 2 });
    expect(result[1]).toMatchObject({ id: 't2', confirmedCount: 0, waitlistCount: 0 });
  });
});
```

- [ ] **Step 3 : Lancer toute la suite tournois**

Run : `npm test -- tournament.service`
Expected : tous les `describe` PASS.

- [ ] **Step 4 : Commit**

```bash
git add backend/src/services/tournament.service.ts backend/src/services/__tests__/tournament.service.test.ts
git commit -m "feat(tournois): lectures publiques + CRUD admin + actions inscriptions"
```

---

## Task 5 : Routes backend (joueur, public, profil, admin)

**Files:**
- Create: `backend/src/routes/tournaments.ts`
- Modify: `backend/src/app.ts`, `backend/src/routes/clubs.ts`, `backend/src/routes/me.ts`, `backend/src/routes/admin.ts`

- [ ] **Step 1 : Créer le router joueur** `backend/src/routes/tournaments.ts`

```typescript
import { Router, Response, NextFunction } from 'express';
import { TournamentService } from '../services/tournament.service';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();
const service = new TournamentService();

const ERROR_STATUS: Record<string, number> = {
  TOURNAMENT_NOT_FOUND:   404,
  TOURNAMENT_NOT_OPEN:    409,
  REGISTRATION_CLOSED:    409,
  REGISTRATION_LOCKED:    409,
  REGISTRATION_NOT_FOUND: 404,
  PARTNER_NOT_FOUND:      404,
  PARTNER_IS_SELF:        400,
  USER_NOT_FOUND:         404,
  MEMBERSHIP_REQUIRED:    403,
  MEMBERSHIP_BLOCKED:     403,
  PHONE_REQUIRED:         422,
  LICENSE_REQUIRED:       422,
  SEX_REQUIRED:           422,
  GENDER_MISMATCH:        422,
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
  if (status) {
    const subject = (err as { subject?: string }).subject;
    return void res.status(status).json({ error: message, ...(subject ? { subject } : {}) });
  }
  next(err);
};

// Détail public d'un tournoi (pas d'auth ; le DRAFT est masqué par le service).
router.get('/:id', async (req, res, next) => {
  try { res.json(await service.getById(asString(req.params.id))); }
  catch (err) { handleError(err, res, next); }
});

router.post('/:id/register', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partnerEmail } = req.body;
    if (!partnerEmail) return void res.status(400).json({ error: 'partnerEmail requis' });
    res.status(201).json(await service.register(asString(req.params.id), req.user!.id, partnerEmail));
  } catch (err) { handleError(err, res, next); }
});

router.patch('/:id/registration', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partnerEmail } = req.body;
    if (!partnerEmail) return void res.status(400).json({ error: 'partnerEmail requis' });
    res.json(await service.changePartner(asString(req.params.id), req.user!.id, partnerEmail));
  } catch (err) { handleError(err, res, next); }
});

router.delete('/:id/registration', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await service.cancelRegistration(asString(req.params.id), req.user!.id)); }
  catch (err) { handleError(err, res, next); }
});

export default router;
```

- [ ] **Step 2 : Monter le router dans `app.ts`**

Dans `backend/src/app.ts`, ajouter l'import (avec les autres) :
```typescript
import tournamentsRouter from './routes/tournaments';
```
Et le montage (après la ligne `app.use('/api/reservations', reservationsRouter);`) :
```typescript
app.use('/api/tournaments',   tournamentsRouter);
```

- [ ] **Step 3 : Listing public dans `clubs.ts`**

Dans `backend/src/routes/clubs.ts`, importer le service en haut :
```typescript
import { TournamentService } from '../services/tournament.service';
```
Instancier (avec les autres services) :
```typescript
const tournamentService = new TournamentService();
```
Ajouter la route **avant** `router.get('/:slug', …)` (sinon `:slug` capture tout) :
```typescript
// Tournois publiés d'un club (à venir).
router.get('/:slug/tournaments', async (req, res, next) => {
  try { res.json(await tournamentService.listPublicByClubSlug(asString(req.params.slug))); }
  catch (err) { handleError(err, res, next); }
});
```

- [ ] **Step 4 : Profil + mes tournois dans `me.ts`**

Dans `backend/src/routes/me.ts`, importer + instancier le service :
```typescript
import { TournamentService } from '../services/tournament.service';
// …
const tournamentService = new TournamentService();
```
Ajouter ces routes avant `export default router;` :
```typescript
// Profil du joueur connecté (pour savoir si tél/sexe sont renseignés).
router.get('/profile', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { id: true, email: true, firstName: true, lastName: true, phone: true, sex: true },
    });
    res.json(user);
  } catch (err) { next(err); }
});

// Mise à jour du profil : téléphone et/ou sexe (pré-requis d'inscription tournoi).
router.patch('/', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { phone, sex } = req.body;
    const data: { phone?: string | null; sex?: 'MALE' | 'FEMALE' | null } = {};
    if (phone !== undefined) data.phone = typeof phone === 'string' && phone.trim() ? phone.trim() : null;
    if (sex !== undefined) {
      if (sex !== null && sex !== 'MALE' && sex !== 'FEMALE') return void res.status(400).json({ error: 'sex invalide' });
      data.sex = sex;
    }
    const user = await prisma.user.update({
      where: { id: req.user!.id }, data,
      select: { id: true, email: true, firstName: true, lastName: true, phone: true, sex: true },
    });
    res.json(user);
  } catch (err) { next(err); }
});

// Inscriptions tournois du joueur connecté.
router.get('/tournaments', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await tournamentService.listUserRegistrations(req.user!.id)); }
  catch (err) { next(err); }
});
```

- [ ] **Step 5 : Routes admin dans `admin.ts`**

Dans `backend/src/routes/admin.ts` : importer + instancier le service :
```typescript
import { TournamentService } from '../services/tournament.service';
// …
const tournamentService = new TournamentService();
```
Compléter la table `ERROR_STATUS` (ajouter les clés manquantes) :
```typescript
  TOURNAMENT_NOT_FOUND: 404,
  HAS_REGISTRATIONS:    409,
  REGISTRATION_NOT_FOUND: 404,
```
Ajouter le bloc de routes avant `export default router;` :
```typescript
// --- Tournois ---
router.get('/tournaments', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await tournamentService.listForAdmin(req.membership!.clubId)); } catch (e) { handleError(e, res, next); }
});
router.post('/tournaments', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.status(201).json(await tournamentService.createTournament(req.membership!.clubId, req.body)); } catch (e) { handleError(e, res, next); }
});
router.get('/tournaments/:id', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await tournamentService.getForAdmin(asString(req.params.id), req.membership!.clubId)); } catch (e) { handleError(e, res, next); }
});
router.patch('/tournaments/:id', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await tournamentService.updateTournament(asString(req.params.id), req.membership!.clubId, req.body)); } catch (e) { handleError(e, res, next); }
});
router.delete('/tournaments/:id', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { await tournamentService.deleteTournament(asString(req.params.id), req.membership!.clubId); res.json({ ok: true }); } catch (e) { handleError(e, res, next); }
});
router.patch('/tournaments/:id/registrations/:regId', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await tournamentService.adminPromoteRegistration(asString(req.params.id), asString(req.params.regId), req.membership!.clubId)); } catch (e) { handleError(e, res, next); }
});
router.delete('/tournaments/:id/registrations/:regId', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await tournamentService.adminRemoveRegistration(asString(req.params.id), asString(req.params.regId), req.membership!.clubId)); } catch (e) { handleError(e, res, next); }
});
```

- [ ] **Step 6 : Vérifier la compilation TypeScript**

Run (depuis `backend/`) : `npx tsc --noEmit`
Expected : aucune erreur.

- [ ] **Step 7 : Smoke test manuel des routes** (Docker + backend lancés : `npm run dev`)

Run :
```bash
curl "http://localhost:3001/api/clubs/club-demo/tournaments"
```
Expected : `[]` (aucun tournoi publié pour l'instant) avec HTTP 200.

- [ ] **Step 8 : Commit**

```bash
git add backend/src/routes/tournaments.ts backend/src/app.ts backend/src/routes/clubs.ts backend/src/routes/me.ts backend/src/routes/admin.ts
git commit -m "feat(tournois): routes API joueur, publiques, profil et back-office"
```

---

## Task 6 : Client API frontend (`lib/api.ts`)

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1 : Ajouter les types tournois** (à la fin de la section `// --- Types ---`)

```typescript
export type TournamentGender = 'MEN' | 'WOMEN' | 'MIXED';
export type TournamentStatus = 'DRAFT' | 'PUBLISHED' | 'CANCELLED';
export type RegistrationStatus = 'CONFIRMED' | 'WAITLISTED' | 'CANCELLED';
export type Sex = 'MALE' | 'FEMALE';

export interface Tournament {
  id: string;
  clubId: string;
  clubSportId: string;
  name: string;
  category: string;
  gender: TournamentGender;
  description: string | null;
  startTime: string;
  endTime: string | null;
  registrationDeadline: string;
  maxTeams: number | null;
  entryFee: string | null;
  status: TournamentStatus;
  confirmedCount: number;
  waitlistCount: number;
}

export interface TournamentDetail extends Tournament {
  club: { slug: string; name: string; timezone: string };
  clubSport: { sport: { key: string; name: string } };
}

export interface MyTournamentRegistration {
  id: string;
  status: RegistrationStatus;
  createdAt: string;
  captain: { id: string; firstName: string; lastName: string; email: string };
  partner: { id: string; firstName: string; lastName: string; email: string };
  tournament: Tournament & { club: { slug: string; name: string; timezone: string } };
}

export interface MyProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  sex: Sex | null;
}

export interface AdminRegistration {
  id: string;
  status: RegistrationStatus;
  createdAt: string;
  captain: { id: string; firstName: string; lastName: string; email: string; phone: string | null; sex: Sex | null };
  partner: { id: string; firstName: string; lastName: string; email: string; phone: string | null; sex: Sex | null };
  captainLicense: string | null;
  partnerLicense: string | null;
}

export interface AdminTournamentDetail {
  tournament: Tournament;
  registrations: AdminRegistration[];
}

export type CreateTournamentBody = {
  clubSportId: string;
  name: string;
  category: string;
  gender: TournamentGender;
  description?: string | null;
  startTime: string;
  endTime?: string | null;
  registrationDeadline: string;
  maxTeams?: number | null;
  entryFee?: number | null;
};
export type UpdateTournamentBody = Partial<CreateTournamentBody & { status: TournamentStatus }>;
```

- [ ] **Step 2 : Ajouter les méthodes** dans l'objet `api` (avant la dernière `}` de `export const api = {`, par ex. après les méthodes sponsors)

```typescript
  // --- Tournois (public + joueur) ---
  getClubTournaments: (slug: string) => request<Tournament[]>(`/api/clubs/${slug}/tournaments`),

  getTournament: (id: string) => request<TournamentDetail>(`/api/tournaments/${id}`),

  registerTournament: (id: string, partnerEmail: string, token: string) =>
    request<MyTournamentRegistration>(`/api/tournaments/${id}/register`, { method: 'POST', body: JSON.stringify({ partnerEmail }) }, token),

  changeTournamentPartner: (id: string, partnerEmail: string, token: string) =>
    request<MyTournamentRegistration>(`/api/tournaments/${id}/registration`, { method: 'PATCH', body: JSON.stringify({ partnerEmail }) }, token),

  cancelTournamentRegistration: (id: string, token: string) =>
    request<MyTournamentRegistration>(`/api/tournaments/${id}/registration`, { method: 'DELETE' }, token),

  // --- Profil joueur ---
  getMyProfile: (token: string) => request<MyProfile>('/api/me/profile', {}, token),

  updateMyProfile: (body: { phone?: string | null; sex?: Sex | null }, token: string) =>
    request<MyProfile>('/api/me', { method: 'PATCH', body: JSON.stringify(body) }, token),

  getMyTournaments: (token: string) => request<MyTournamentRegistration[]>('/api/me/tournaments', {}, token),

  // --- Tournois (back-office club) ---
  adminGetTournaments: (clubId: string, token: string) =>
    request<Tournament[]>(`/api/clubs/${clubId}/admin/tournaments`, {}, token),

  adminGetTournament: (clubId: string, id: string, token: string) =>
    request<AdminTournamentDetail>(`/api/clubs/${clubId}/admin/tournaments/${id}`, {}, token),

  adminCreateTournament: (clubId: string, body: CreateTournamentBody, token: string) =>
    request<Tournament>(`/api/clubs/${clubId}/admin/tournaments`, { method: 'POST', body: JSON.stringify(body) }, token),

  adminUpdateTournament: (clubId: string, id: string, body: UpdateTournamentBody, token: string) =>
    request<Tournament>(`/api/clubs/${clubId}/admin/tournaments/${id}`, { method: 'PATCH', body: JSON.stringify(body) }, token),

  adminDeleteTournament: (clubId: string, id: string, token: string) =>
    request<{ ok: boolean }>(`/api/clubs/${clubId}/admin/tournaments/${id}`, { method: 'DELETE' }, token),

  adminPromoteRegistration: (clubId: string, tournamentId: string, regId: string, token: string) =>
    request<AdminRegistration>(`/api/clubs/${clubId}/admin/tournaments/${tournamentId}/registrations/${regId}`, { method: 'PATCH' }, token),

  adminRemoveRegistration: (clubId: string, tournamentId: string, regId: string, token: string) =>
    request<{ id: string }>(`/api/clubs/${clubId}/admin/tournaments/${tournamentId}/registrations/${regId}`, { method: 'DELETE' }, token),
```

- [ ] **Step 3 : Vérifier la compilation**

Run (depuis `frontend/`) : `npx tsc --noEmit`
Expected : aucune erreur.

- [ ] **Step 4 : Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(tournois): types et méthodes client API"
```

---

## Task 7 : Icône, lien page d'accueil, page liste `/tournois`

**Files:**
- Modify: `frontend/components/ui/Icon.tsx`, `frontend/components/ClubHome.tsx`
- Create: `frontend/app/tournois/page.tsx`

- [ ] **Step 1 : Ajouter l'icône `trophy`** dans `frontend/components/ui/Icon.tsx`

Dans le type `IconName`, ajouter `| 'trophy'` (à la fin de l'union) :
```typescript
  | 'moon' | 'logout' | 'grip' | 'trophy';
```
Dans l'objet `paths`, ajouter une entrée (après `grip:`) :
```typescript
    trophy: <><path d="M7 4h10v4a5 5 0 01-10 0V4z" {...p} /><path d="M7 5H4.5v2A3 3 0 007 9.8M17 5h2.5v2A3 3 0 0117 9.8M9 14h6M12 14v3M8.5 20h7M9.5 17h5l.5 3h-6z" {...p} /></>,
```

- [ ] **Step 2 : Ajouter le lien « Tournois »** dans `frontend/components/ClubHome.tsx`

Dans le tableau `links` (vers la ligne 55), ajouter en 2ᵉ position :
```typescript
    { label: 'Tournois', icon: 'trophy', href: '/tournois', show: true },
```

- [ ] **Step 3 : Créer la page liste** `frontend/app/tournois/page.tsx`

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { api, Tournament } from '@/lib/api';
import { Screen } from '@/components/ui/Screen';
import { Logotype, ThemeToggle, Chip } from '@/components/ui/atoms';
import { Icon } from '@/components/ui/Icon';

const GENDER_LABEL: Record<string, string> = { MEN: 'Messieurs', WOMEN: 'Dames', MIXED: 'Mixte' };

function formatDate(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }).format(new Date(iso));
}

export default function TournoisPage() {
  const { club, loading } = useClub();
  const { th } = useTheme();
  const router = useRouter();
  const [items, setItems] = useState<Tournament[] | null>(null);

  useEffect(() => {
    if (!club) return;
    api.getClubTournaments(club.slug).then(setItems).catch(() => setItems([]));
  }, [club?.slug]);

  if (loading || !club) {
    return <div style={{ minHeight: '100vh', background: th.bg, color: th.textFaint, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI }}>Chargement…</div>;
  }

  return (
    <Screen style={{ maxWidth: 760 }}>
      <div style={{ paddingBottom: 40 }}>
        <div style={{ padding: '24px 20px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button onClick={() => router.push('/')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="chevL" size={18} color={th.textMute} /><Logotype size={20} />
          </button>
          <ThemeToggle />
        </div>

        <div style={{ padding: '14px 20px 0' }}>
          <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 30, color: th.text, letterSpacing: -0.5 }}>Tournois</div>
          <div style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, marginTop: 4 }}>{club.name}</div>
        </div>

        <div style={{ padding: '22px 20px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items === null && <div style={{ fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>}
          {items?.length === 0 && <div style={{ fontFamily: th.fontUI, color: th.textMute }}>Aucun tournoi à venir pour le moment.</div>}
          {items?.map((t) => {
            const full = t.maxTeams != null && t.confirmedCount >= t.maxTeams;
            const closed = new Date(t.registrationDeadline) <= new Date();
            return (
              <button key={t.id} onClick={() => router.push(`/tournois/${t.id}`)} style={{ border: 'none', cursor: 'pointer', textAlign: 'left', width: '100%', background: th.surface, borderRadius: 16, padding: '16px 18px', boxShadow: `inset 0 0 0 1px ${th.line}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Chip tone="accent">{t.category}</Chip>
                  <Chip>{GENDER_LABEL[t.gender]}</Chip>
                  {closed ? <Chip>Inscriptions closes</Chip> : full ? <Chip>Complet · liste d&apos;attente</Chip> : null}
                </div>
                <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 19, color: th.text, marginTop: 10 }}>{t.name}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, marginTop: 6 }}>
                  <Icon name="calendar" size={14} color={th.textMute} />{formatDate(t.startTime, club.timezone)}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, marginTop: 4 }}>
                  <Icon name="users" size={14} color={th.textMute} />
                  {t.maxTeams != null ? `${t.confirmedCount}/${t.maxTeams} binômes` : `${t.confirmedCount} binômes`}
                  {t.waitlistCount > 0 ? ` · ${t.waitlistCount} en attente` : ''}
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

- [ ] **Step 4 : Vérifier compilation + rendu**

Run (depuis `frontend/`) : `npx tsc --noEmit`
Expected : aucune erreur.
Vérif manuelle (frontend lancé) : ouvrir `http://localhost:3000/tournois` sur un host club (cf. sous-domaines `*.localhost`) → page « Tournois » avec « Aucun tournoi à venir ».

- [ ] **Step 5 : Commit**

```bash
git add frontend/components/ui/Icon.tsx frontend/components/ClubHome.tsx frontend/app/tournois/page.tsx
git commit -m "feat(tournois): icône trophy, lien page d'accueil et page liste des tournois"
```

---

## Task 8 : Page détail `/tournois/[id]` (inscription + gestion binôme)

**Files:**
- Create: `frontend/app/tournois/[id]/page.tsx`

> Rappel Next.js 16 : dans une **page client**, `params` se lit via `React.use(params)` (params est une Promise). Vérifier le guide `node_modules/next/dist/docs/` si besoin.

- [ ] **Step 1 : Créer la page détail**

```tsx
'use client';
import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { useAuth } from '@/lib/useAuth';
import { api, TournamentDetail, MyProfile, MyTournamentRegistration } from '@/lib/api';
import { Screen } from '@/components/ui/Screen';
import { Logotype, ThemeToggle, Chip } from '@/components/ui/atoms';
import { Icon } from '@/components/ui/Icon';

const GENDER_LABEL: Record<string, string> = { MEN: 'Messieurs', WOMEN: 'Dames', MIXED: 'Mixte' };

const ERROR_FR: Record<string, string> = {
  TOURNAMENT_NOT_OPEN: 'Les inscriptions ne sont pas ouvertes.',
  REGISTRATION_CLOSED: 'Les inscriptions sont closes.',
  REGISTRATION_LOCKED: 'La date limite de modification est dépassée.',
  PARTNER_NOT_FOUND: "Aucun joueur trouvé avec cet e-mail (il doit avoir un compte et être membre du club).",
  PARTNER_IS_SELF: 'Vous ne pouvez pas être votre propre coéquipier.',
  MEMBERSHIP_REQUIRED: "{who} n'est pas membre du club.",
  MEMBERSHIP_BLOCKED: '{who} est bloqué(e) par le club.',
  PHONE_REQUIRED: "{who} doit renseigner un numéro de téléphone.",
  LICENSE_REQUIRED: "{who} doit renseigner un numéro de licence (auprès du club).",
  SEX_REQUIRED: '{who} doit renseigner son sexe dans son profil.',
  GENDER_MISMATCH: "La composition du binôme ne correspond pas à la catégorie du tournoi.",
  ALREADY_REGISTERED: "Un des deux joueurs est déjà inscrit à ce tournoi.",
};

function messageFor(err: unknown): string {
  const e = err as { message?: string; subject?: string };
  const tmpl = ERROR_FR[e.message ?? ''] ?? e.message ?? 'Une erreur est survenue.';
  const who = e.subject === 'partner' ? 'Votre coéquipier' : 'Vous';
  return tmpl.replace('{who}', who);
}

function formatDateTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso)).replace(':', 'h');
}

export default function TournamentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { club } = useClub();
  const { th } = useTheme();
  const router = useRouter();
  const { token, ready } = useAuth();

  const [t, setT] = useState<TournamentDetail | null>(null);
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [myReg, setMyReg] = useState<MyTournamentRegistration | null>(null);
  const [partnerEmail, setPartnerEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.getTournament(id).then(setT).catch(() => setT(null));
  useEffect(() => { load(); }, [id]);
  useEffect(() => {
    if (!ready || !token) return;
    api.getMyProfile(token).then(setProfile).catch(() => {});
    api.getMyTournaments(token).then((rs) => setMyReg(rs.find((r) => r.tournament.id === id) ?? null)).catch(() => {});
  }, [ready, token, id]);

  if (!t || !club) {
    return <div style={{ minHeight: '100vh', background: th.bg, color: th.textFaint, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI }}>Chargement…</div>;
  }

  const tz = t.club.timezone;
  const closed = new Date(t.registrationDeadline) <= new Date();
  const full = t.maxTeams != null && t.confirmedCount >= t.maxTeams;
  const profileIncomplete = !!token && profile != null && (!profile.phone || !profile.sex);

  const saveProfile = async (phone: string, sex: 'MALE' | 'FEMALE') => {
    if (!token) return;
    setBusy(true); setError(null);
    try { setProfile(await api.updateMyProfile({ phone, sex }, token)); }
    catch (e) { setError(messageFor(e)); }
    finally { setBusy(false); }
  };

  const register = async () => {
    if (!token) { router.push('/login'); return; }
    setBusy(true); setError(null);
    try {
      await api.registerTournament(id, partnerEmail.trim(), token);
      setPartnerEmail('');
      await load();
      const rs = await api.getMyTournaments(token);
      setMyReg(rs.find((r) => r.tournament.id === id) ?? null);
    } catch (e) { setError(messageFor(e)); }
    finally { setBusy(false); }
  };

  const changePartner = async () => {
    if (!token) return;
    setBusy(true); setError(null);
    try {
      await api.changeTournamentPartner(id, partnerEmail.trim(), token);
      setPartnerEmail('');
      const rs = await api.getMyTournaments(token);
      setMyReg(rs.find((r) => r.tournament.id === id) ?? null);
    } catch (e) { setError(messageFor(e)); }
    finally { setBusy(false); }
  };

  const cancel = async () => {
    if (!token) return;
    setBusy(true); setError(null);
    try {
      await api.cancelTournamentRegistration(id, token);
      setMyReg(null);
      await load();
    } catch (e) { setError(messageFor(e)); }
    finally { setBusy(false); }
  };

  const inputStyle = { width: '100%', boxSizing: 'border-box' as const, background: th.surface2, border: `1px solid ${th.line}`, borderRadius: 11, padding: '11px 13px', fontFamily: th.fontUI, fontSize: 14, color: th.text };
  const primaryBtn = { border: 'none', cursor: 'pointer', background: th.accent, color: th.onAccent, borderRadius: 11, padding: '12px 16px', fontFamily: th.fontUI, fontWeight: 700, fontSize: 14.5, opacity: busy ? 0.6 : 1 };

  return (
    <Screen style={{ maxWidth: 640 }}>
      <div style={{ paddingBottom: 48 }}>
        <div style={{ padding: '24px 20px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button onClick={() => router.push('/tournois')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="chevL" size={18} color={th.textMute} /><Logotype size={20} />
          </button>
          <ThemeToggle />
        </div>

        {/* En-tête tournoi */}
        <div style={{ padding: '14px 20px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Chip tone="accent">{t.category}</Chip><Chip>{GENDER_LABEL[t.gender]}</Chip>
          </div>
          <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 28, color: th.text, marginTop: 10, letterSpacing: -0.5 }}>{t.name}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 10, fontFamily: th.fontUI, fontSize: 14, color: th.textMute }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Icon name="calendar" size={15} color={th.textMute} />Début : {formatDateTime(t.startTime, tz)}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Icon name="clock" size={15} color={th.textMute} />Inscriptions jusqu&apos;au {formatDateTime(t.registrationDeadline, tz)}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Icon name="users" size={15} color={th.textMute} />{t.maxTeams != null ? `${t.confirmedCount}/${t.maxTeams} binômes` : `${t.confirmedCount} binômes`}{t.waitlistCount > 0 ? ` · ${t.waitlistCount} en attente` : ''}</span>
            {t.entryFee && <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Icon name="euro" size={15} color={th.textMute} />{t.entryFee} € par binôme</span>}
          </div>
          {t.description && <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, marginTop: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{t.description}</p>}
        </div>

        <div style={{ padding: '24px 20px 0' }}>
          {error && <div style={{ background: '#3a1d1d', color: '#ff6b6b', borderRadius: 11, padding: '11px 13px', fontFamily: th.fontUI, fontSize: 13.5, marginBottom: 14 }}>{error}</div>}

          {/* Non connecté */}
          {ready && !token && (
            <button onClick={() => router.push('/login')} style={primaryBtn}>Se connecter pour s&apos;inscrire</button>
          )}

          {/* Déjà inscrit */}
          {token && myReg && (
            <div style={{ background: th.surface, borderRadius: 16, padding: '16px 18px', boxShadow: `inset 0 0 0 1px ${th.line}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Chip tone="accent" icon="check">{myReg.status === 'CONFIRMED' ? 'Inscrit' : 'Liste d\'attente'}</Chip>
              </div>
              <div style={{ fontFamily: th.fontUI, fontSize: 14, color: th.text, marginTop: 12 }}>
                Votre binôme : <strong>{myReg.captain.firstName} {myReg.captain.lastName}</strong> &amp; <strong>{myReg.partner.firstName} {myReg.partner.lastName}</strong>
              </div>
              {!closed ? (
                <>
                  <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginTop: 16, marginBottom: 6 }}>Changer de coéquipier (e-mail)</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input value={partnerEmail} onChange={(e) => setPartnerEmail(e.target.value)} placeholder="email@coequipier.fr" style={inputStyle} />
                    <button onClick={changePartner} disabled={busy || !partnerEmail.trim()} style={{ ...primaryBtn, whiteSpace: 'nowrap' }}>Changer</button>
                  </div>
                  <button onClick={cancel} disabled={busy} style={{ marginTop: 12, border: `1px solid ${th.line}`, background: 'transparent', color: th.textMute, cursor: 'pointer', borderRadius: 11, padding: '10px 14px', fontFamily: th.fontUI, fontSize: 13.5 }}>Se désinscrire</button>
                </>
              ) : (
                <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textFaint, marginTop: 12 }}>Inscriptions closes : modification et annulation ne sont plus possibles.</div>
              )}
            </div>
          )}

          {/* Pas encore inscrit, inscriptions ouvertes */}
          {token && !myReg && !closed && (
            <div>
              {profileIncomplete && (
                <ProfileCompletion busy={busy} onSave={saveProfile} />
              )}
              <div style={{ opacity: profileIncomplete ? 0.4 : 1, pointerEvents: profileIncomplete ? 'none' : 'auto' }}>
                {full && <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, marginBottom: 10 }}>Tournoi complet : votre binôme sera placé en liste d&apos;attente.</div>}
                <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, marginBottom: 8, lineHeight: 1.5 }}>
                  Votre coéquipier doit avoir un compte, être membre du club, et avoir renseigné téléphone, licence et sexe.
                </div>
                <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginBottom: 6 }}>E-mail du coéquipier</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input value={partnerEmail} onChange={(e) => setPartnerEmail(e.target.value)} placeholder="email@coequipier.fr" style={inputStyle} />
                  <button onClick={register} disabled={busy || !partnerEmail.trim()} style={{ ...primaryBtn, whiteSpace: 'nowrap' }}>S&apos;inscrire</button>
                </div>
              </div>
            </div>
          )}

          {token && !myReg && closed && (
            <div style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute }}>Les inscriptions pour ce tournoi sont closes.</div>
          )}
        </div>
      </div>
    </Screen>
  );
}

function ProfileCompletion({ busy, onSave }: {
  busy: boolean;
  onSave: (phone: string, sex: 'MALE' | 'FEMALE') => void;
}) {
  const { th } = useTheme();
  const [phone, setPhone] = useState('');
  const [sex, setSex] = useState<'MALE' | 'FEMALE' | ''>('');
  const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', background: th.surface2, border: `1px solid ${th.line}`, borderRadius: 11, padding: '11px 13px', fontFamily: th.fontUI, fontSize: 14, color: th.text };
  const primaryBtn: React.CSSProperties = { border: 'none', cursor: 'pointer', background: th.accent, color: th.onAccent, borderRadius: 11, padding: '12px 16px', fontFamily: th.fontUI, fontWeight: 700, fontSize: 14.5, opacity: busy ? 0.6 : 1 };
  return (
    <div style={{ background: th.surface, borderRadius: 16, padding: '16px 18px', boxShadow: `inset 0 0 0 1px ${th.line}`, marginBottom: 16 }}>
      <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 14.5, color: th.text }}>Complétez votre profil</div>
      <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, marginTop: 4, marginBottom: 12 }}>Téléphone et sexe sont requis pour s&apos;inscrire à un tournoi.</div>
      <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Téléphone" style={{ ...inputStyle, marginBottom: 8 }} />
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {(['MALE', 'FEMALE'] as const).map((s) => (
          <button key={s} onClick={() => setSex(s)} style={{ flex: 1, cursor: 'pointer', borderRadius: 11, padding: '10px', fontFamily: th.fontUI, fontSize: 14, border: `1px solid ${sex === s ? th.accent : th.line}`, background: sex === s ? th.surface2 : 'transparent', color: th.text }}>
            {s === 'MALE' ? 'Homme' : 'Femme'}
          </button>
        ))}
      </div>
      <button onClick={() => sex && onSave(phone.trim(), sex)} disabled={busy || !phone.trim() || !sex} style={{ ...primaryBtn, width: '100%' }}>Enregistrer mon profil</button>
    </div>
  );
}
```

- [ ] **Step 2 : Vérifier la compilation** (et corriger d'éventuels champs de thème manquants)

Run (depuis `frontend/`) : `npx tsc --noEmit`
Expected : aucune erreur. (Le thème `Theme` n'a pas de token `danger` — on utilise des couleurs d'erreur en dur `#3a1d1d`/`#ff6b6b`, comme la page admin. N'introduire aucune référence `th.danger`.)

- [ ] **Step 3 : Commit**

```bash
git add frontend/app/tournois/[id]/page.tsx
git commit -m "feat(tournois): page détail + inscription/modif/annulation binôme + complétion profil"
```

---

## Task 9 : Back-office club `/admin/tournaments`

**Files:**
- Modify: `frontend/app/admin/layout.tsx`
- Create: `frontend/app/admin/tournaments/page.tsx`

- [ ] **Step 1 : Ajouter l'entrée de nav** dans `frontend/app/admin/layout.tsx`

Dans le tableau `links` (vers la ligne 47), après l'entrée `Réservations` :
```typescript
    { href: '/admin/tournaments', label: 'Tournois',         icon: 'trophy' as const },
```

- [ ] **Step 2 : Créer la page admin** `frontend/app/admin/tournaments/page.tsx`

```tsx
'use client';
import { useCallback, useEffect, useState } from 'react';
import { useClub } from '@/lib/ClubProvider';
import { useAuth } from '@/lib/useAuth';
import { useTheme } from '@/lib/ThemeProvider';
import { api, Tournament, AdminTournamentDetail, CreateTournamentBody, AdminClubSport } from '@/lib/api';
import { Icon } from '@/components/ui/Icon';

const CATEGORIES = ['P25', 'P50', 'P100', 'P250', 'P500', 'P1000', 'P1500', 'P2000'];
const GENDERS: { value: 'MEN' | 'WOMEN' | 'MIXED'; label: string }[] = [
  { value: 'MEN', label: 'Messieurs' }, { value: 'WOMEN', label: 'Dames' }, { value: 'MIXED', label: 'Mixte' },
];

const emptyForm = (clubSportId: string): CreateTournamentBody => ({
  clubSportId, name: '', category: 'P100', gender: 'MEN',
  description: '', startTime: '', registrationDeadline: '', maxTeams: null, entryFee: null,
});

export default function AdminTournamentsPage() {
  const { club } = useClub();
  const { token } = useAuth();
  const { th } = useTheme();
  const [list, setList] = useState<Tournament[]>([]);
  const [sports, setSports] = useState<AdminClubSport[]>([]);
  const [form, setForm] = useState<CreateTournamentBody | null>(null);
  const [detail, setDetail] = useState<AdminTournamentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!club || !token) return;
    api.adminGetTournaments(club.id, token).then(setList).catch(() => setList([]));
  }, [club?.id, token]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    if (!club || !token) return;
    api.adminGetSports(club.id, token).then(setSports).catch(() => setSports([]));
  }, [club?.id, token]);

  if (!club || !token) return null;

  const padelSportId = sports.find((s) => s.sport.key === 'padel')?.id ?? sports[0]?.id ?? '';

  const submit = async () => {
    if (!form) return;
    setError(null);
    try {
      await api.adminCreateTournament(club.id, {
        ...form,
        maxTeams: form.maxTeams ? Number(form.maxTeams) : null,
        entryFee: form.entryFee ? Number(form.entryFee) : null,
      }, token);
      setForm(null); reload();
    } catch (e) { setError((e as Error).message); }
  };

  const publish = async (t: Tournament, status: 'PUBLISHED' | 'CANCELLED' | 'DRAFT') => {
    await api.adminUpdateTournament(club.id, t.id, { status }, token); reload();
  };
  const openDetail = async (t: Tournament) => {
    setDetail(await api.adminGetTournament(club.id, t.id, token));
  };
  const promote = async (regId: string) => {
    if (!detail) return;
    await api.adminPromoteRegistration(club.id, detail.tournament.id, regId, token);
    openDetail(detail.tournament); reload();
  };
  const remove = async (regId: string) => {
    if (!detail) return;
    await api.adminRemoveRegistration(club.id, detail.tournament.id, regId, token);
    openDetail(detail.tournament); reload();
  };

  const label = { fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginBottom: 5, marginTop: 12 } as const;
  const input = { width: '100%', boxSizing: 'border-box' as const, background: th.surface2, border: `1px solid ${th.line}`, borderRadius: 10, padding: '9px 11px', fontFamily: th.fontUI, fontSize: 14, color: th.text };
  const btn = { border: 'none', cursor: 'pointer', background: th.accent, color: th.onAccent, borderRadius: 10, padding: '10px 14px', fontFamily: th.fontUI, fontWeight: 700, fontSize: 14 };
  const ghost = { border: `1px solid ${th.line}`, cursor: 'pointer', background: 'transparent', color: th.textMute, borderRadius: 9, padding: '7px 11px', fontFamily: th.fontUI, fontSize: 13 };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 26, color: th.text, margin: 0 }}>Tournois</h1>
        <button onClick={() => setForm(emptyForm(padelSportId))} style={btn}><Icon name="plus" size={15} color={th.onAccent} style={{ display: 'inline', marginRight: 6, verticalAlign: '-2px' }} />Nouveau tournoi</button>
      </div>

      {error && <div style={{ background: '#3a1d1d', color: '#ff6b6b', borderRadius: 10, padding: '10px 12px', fontFamily: th.fontUI, fontSize: 13.5, marginBottom: 14 }}>{error}</div>}

      {/* Formulaire de création */}
      {form && (
        <div style={{ background: th.surface, borderRadius: 14, padding: 18, boxShadow: `inset 0 0 0 1px ${th.line}`, marginBottom: 20 }}>
          <div style={label}>Nom</div>
          <input style={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Open de printemps" />
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={label}>Catégorie</div>
              <select style={input} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <div style={label}>Genre</div>
              <select style={input} value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value as CreateTournamentBody['gender'] })}>
                {GENDERS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={label}>Début</div>
              <input type="datetime-local" style={input} value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={label}>Limite d&apos;inscription</div>
              <input type="datetime-local" style={input} value={form.registrationDeadline} onChange={(e) => setForm({ ...form, registrationDeadline: e.target.value })} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={label}>Nb max de binômes (vide = illimité)</div>
              <input type="number" min={1} style={input} value={form.maxTeams ?? ''} onChange={(e) => setForm({ ...form, maxTeams: e.target.value ? Number(e.target.value) : null })} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={label}>Frais d&apos;inscription (€)</div>
              <input type="number" min={0} step="0.01" style={input} value={form.entryFee ?? ''} onChange={(e) => setForm({ ...form, entryFee: e.target.value ? Number(e.target.value) : null })} />
            </div>
          </div>
          <div style={label}>Description</div>
          <textarea style={{ ...input, minHeight: 70, resize: 'vertical' }} value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button onClick={submit} style={btn}>Créer (brouillon)</button>
            <button onClick={() => setForm(null)} style={ghost}>Annuler</button>
          </div>
        </div>
      )}

      {/* Liste des tournois */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {list.length === 0 && <div style={{ fontFamily: th.fontUI, color: th.textMute }}>Aucun tournoi.</div>}
        {list.map((t) => (
          <div key={t.id} style={{ background: th.surface, borderRadius: 12, padding: '14px 16px', boxShadow: `inset 0 0 0 1px ${th.line}` }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 15, color: th.text }}>
                {t.category} · {t.name} <span style={{ color: th.textFaint, fontWeight: 400 }}>· {t.status}</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => openDetail(t)} style={ghost}>Inscrits ({t.confirmedCount}{t.maxTeams ? `/${t.maxTeams}` : ''}{t.waitlistCount ? ` +${t.waitlistCount}` : ''})</button>
                {t.status !== 'PUBLISHED' && <button onClick={() => publish(t, 'PUBLISHED')} style={ghost}>Publier</button>}
                {t.status === 'PUBLISHED' && <button onClick={() => publish(t, 'CANCELLED')} style={ghost}>Annuler</button>}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Panneau inscrits */}
      {detail && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'flex-end', zIndex: 50 }} onClick={() => setDetail(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 460, maxWidth: '100%', height: '100%', overflowY: 'auto', background: th.bgElev, padding: 24, boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 19, color: th.text }}>{detail.tournament.name}</div>
              <button onClick={() => setDetail(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}><Icon name="x" size={20} color={th.textMute} /></button>
            </div>
            {detail.registrations.length === 0 && <div style={{ fontFamily: th.fontUI, color: th.textMute }}>Aucun inscrit.</div>}
            {detail.registrations.map((r) => (
              <div key={r.id} style={{ background: th.surface, borderRadius: 11, padding: '12px 14px', marginBottom: 10, boxShadow: `inset 0 0 0 1px ${th.line}` }}>
                <div style={{ fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: r.status === 'CONFIRMED' ? th.accent : th.textMute }}>{r.status === 'CONFIRMED' ? 'Confirmé' : 'Liste d\'attente'}</div>
                {[{ p: r.captain, lic: r.captainLicense }, { p: r.partner, lic: r.partnerLicense }].map(({ p, lic }) => (
                  <div key={p.id} style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.text, marginTop: 6 }}>
                    {p.firstName} {p.lastName} <span style={{ color: th.textMute }}>· {p.phone ?? '—'} · licence {lic ?? '—'} · {p.sex === 'MALE' ? 'H' : p.sex === 'FEMALE' ? 'F' : '—'}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  {r.status === 'WAITLISTED' && <button onClick={() => promote(r.id)} style={ghost}>Promouvoir</button>}
                  <button onClick={() => remove(r.id)} style={ghost}>Désinscrire</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3 : Vérifier la compilation**

Run (depuis `frontend/`) : `npx tsc --noEmit`
Expected : aucune erreur.

- [ ] **Step 4 : Commit**

```bash
git add frontend/app/admin/layout.tsx frontend/app/admin/tournaments/page.tsx
git commit -m "feat(tournois): back-office club (création, publication, inscrits, promotion)"
```

---

## Task 10 : Vérification end-to-end + finalisation

**Files:** aucun (vérification). Docker + backend (`npm run dev`) + frontend (`npm run dev`) lancés.

- [ ] **Step 1 : Suite de tests backend complète**

Run (depuis `backend/`) : `npm test`
Expected : toutes les suites PASS (existantes + `tournament.service`).

- [ ] **Step 2 : Typecheck des deux côtés**

Run : `cd backend && npx tsc --noEmit` puis `cd ../frontend && npx tsc --noEmit`
Expected : aucune erreur.

- [ ] **Step 3 : Parcours manuel (happy path)** sur un host club (`<slug>.localhost:3000`)

Checklist :
1. Back-office → **Tournois** → créer un tournoi `P100 / Mixte`, `maxTeams=2`, deadline future → **Publier**.
2. S'assurer que 2 comptes joueurs (1 H + 1 F) sont **membres** du club avec **licence** renseignée (back-office → Membres), et que chacun a un **téléphone**.
3. Page d'accueil club → le lien **Tournois** apparaît → ouvrir le tournoi.
4. Joueur H connecté : compléter profil (tél + sexe) si demandé → s'inscrire avec l'e-mail de la joueuse F → **Inscrit** (CONFIRMED).
5. Inscrire 2 autres binômes pour dépasser `maxTeams` → le 3ᵉ passe **Liste d'attente**.
6. Désinscrire un binôme CONFIRMED → vérifier la **promotion auto** du 1er en attente (back-office → Inscrits).
7. Tester un binôme **2 hommes** sur le tournoi Mixte → message d'erreur `GENDER_MISMATCH`.
8. Passer la deadline (ou créer un tournoi à deadline passée) → boutons d'inscription/modif masqués, mention « inscriptions closes ».

- [ ] **Step 4 : Vérifier le lint frontend si configuré**

Run (depuis `frontend/`) : `npx eslint app/tournois app/admin/tournaments components/ClubHome.tsx` (ou la commande lint du projet)
Expected : aucune erreur bloquante (Next 16 : pas de `next lint`, utiliser ESLint directement — cf. CLAUDE.md).

- [ ] **Step 5 : Mettre à jour la doc projet**

Dans `palova/CLAUDE.md`, retirer/ajuster la ligne « Gestion admin du club » si besoin et noter que les **tournois (v1 inscriptions)** sont implémentés. Ajouter sous « À implémenter » les évolutions repoussées : tableaux/poules/scores, paiement en ligne, notifications e-mail de promotion.

- [ ] **Step 6 : Commit final**

```bash
git add -A
git commit -m "docs(tournois): maj CLAUDE.md (tournois v1 livrés, évolutions futures)"
```

---

## Notes de vérification (self-review)

- **Couverture spec :** catégories P25→P2000 (liste `CATEGORIES`, Task 9) ✓ ; mixte contrôlé (`assertGender`, Task 2) ✓ ; binôme = 2 membres tél+licence+sexe (`resolveAndAssertEligible`, Task 2) ✓ ; deadline modif/annulation (`changePartner`/`cancelRegistration`, Task 3) ✓ ; liste d'attente + promotion (Task 2/3) ✓ ; lien page d'accueil (`ClubHome`, Task 7) ✓ ; back-office (Task 9) ✓.
- **Cohérence des types :** `partnerEmail` partout ; `subject: 'self'|'partner'` posé par `appError` (Task 2) et relayé par le `handleError` du router joueur (Task 5) et l'UI `messageFor` (Task 8). `withCounts` renvoie `confirmedCount`/`waitlistCount`, consommés par `Tournament` (api.ts, Task 6) et l'UI (Task 7/8/9).
- **Migration additive :** seuls des ajouts (`User.sex` nullable, nouvelles tables) → aucune donnée existante impactée.
- **Concurrence :** `register` et `cancelAndPromote` verrouillent la ligne tournoi (`SELECT … FOR UPDATE`) en transaction Serializable, comme `ReservationService.confirmReservation`.
