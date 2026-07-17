# Table de marque du J/A — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner au J/A (et au staff) une « table de marque » plein écran par tournoi : pointage par joueur, forfait, remplacement depuis un banc, appariement de deux orphelins, binôme tardif, journal des interventions — en outrepassant `registrationDeadline`, réservé aux joueurs.

**Architecture:** Modèle additif (2 colonnes de présence sur `TournamentRegistration`, tables `TournamentBenchEntry`/`TournamentLogEntry`). **Un seul cœur de service** dans `TournamentService` ; deux portes minces (routes J/A sous `clubs.ts` gatées `resolveReferee`+propriété, routes staff sous `admin.ts` gatées STAFF hérité) qui appellent les mêmes méthodes avec `actorUserId = req.user.id`. Front : un hook `useMarkTable(mode)` + composants partagés, consommés par deux pages minces (`/me/refereeing/[id]`, `/admin/tournaments/[id]/table`).

**Tech Stack:** Prisma 7 (driver adapter), Express/TypeScript, Jest, Next.js 16 (App Router, client components).

**Spec:** `docs/superpowers/specs/2026-07-17-table-de-marque-ja-design.md`

---

## ⚠️ Avant de commencer

- Ce plan touche `backend/src/services/tournament.service.ts`, `backend/src/routes/clubs.ts`, `backend/src/routes/admin.ts`, `backend/src/email/notifications.ts`, `backend/prisma/schema.prisma` — **fichiers volumineux et partagés**. Relire avant chaque édition (contenu changeant en continu sur ce repo).
- **Isoler dans un worktree** (`superpowers:using-git-worktrees`) avant exécution — l'utilisateur édite `main`/ses branches en parallèle. Voir le worktree `juge-arbitre` déjà monté dans cette session comme référence de setup (junction `frontend/node_modules`, `npm install` propre pour `backend/`, `.env` copiés).
- **`npx` est cassé dans un worktree** → binaires en direct : `node node_modules/jest/bin/jest.js`, `node node_modules/typescript/bin/tsc --noEmit`, `node node_modules/prisma/build/index.js`.
- **Jamais `prisma db push` / `migrate dev`** (base dev partagée, dérive connue) → `prisma db execute --file <migration.sql>` puis `prisma generate`.
- **Jamais `git add -A`** — chemins explicites, l'utilisateur a du WIP parallèle.

## Décisions de conception prises en écrivant ce plan (pas dans la spec — à connaître)

1. **`listMarkTable` expose `userId`** sur les joueurs de la grille ET du banc, pour les deux surfaces (J/A et staff). La règle « userId jamais exposé côté J/A » de la spec héritée du roster **read-only** (`refereeListRegistrations`, inchangé) ne s'applique pas ici : la table de marque est une surface **d'action** authentifiée et gatée (jamais publique) — remplacer/apparier exige un identifiant à renvoyer au serveur. Documenté en commentaire dans le code (Task 2).
2. **Remplacer ne dépend d'aucun forfait préalable.** Un absent (pointage ✕) est directement une cible de remplacement — le forfait est un acte séparé et plus lourd (annule tout le binôme, libère la place pour une nouvelle paire via la promotion existante). Les deux sont des outils indépendants pour la même situation.
3. **Composition = réutilisation stricte de `assertGender`** (méthode privée existante), pas un nouveau code `COMPOSITION_INVALID` — DRY avec `register`/`changePartner`, même code d'erreur `GENDER_MISMATCH` déjà géré côté front.
4. **Téléphone/licence NE sont PAS bloquants** pour remplacement/appariement/tardif (spec : « chips coral, le J/A juge ») — contrairement à l'inscription joueur normale. Seuls adhésion ACTIVE + sexe connu (composition) restent des gardes dures.
5. **Promouvoir/retirer depuis la table de marque** passent par de **nouveaux wrappers journalisés** (`markTablePromote`/`markTableRemove`) qui délèguent aux méthodes existantes puis écrivent au journal — les méthodes existantes (`adminPromoteRegistration` etc., utilisées par le roster « Inscrits » simple) restent **inchangées**, pas de bruit de journal là où il n'a pas sa place.
6. **`listLog` = `take: 200`, pas de curseur** — pagination simple au sens littéral, YAGNI.

## File Structure

**Backend — modifiés :** `prisma/schema.prisma`, `src/services/tournament.service.ts`, `src/email/notifications.ts`, `src/routes/clubs.ts`, `src/routes/admin.ts`.
**Backend — créé :** migration `prisma/migrations/20260718090000_add_tournament_mark_table/migration.sql`.

**Frontend — créés :** `lib/markTable.ts` (helpers purs), `components/tournament/{MarkTable,MarkTableTile,BenchBar,MarkTableJournal}.tsx`, `components/tournament/MemberPicker.tsx`, `app/me/refereeing/[id]/page.tsx`, `app/admin/tournaments/[id]/table/page.tsx`.
**Frontend — modifiés :** `lib/api.ts`, `components/referee/RefereeTournamentCard.tsx` (bouton d'entrée), `app/admin/tournaments/page.tsx` (bouton d'entrée sur `AgendaAdminCard`).

---

### Task 1: Migration + schéma

**Files:**
- Create: `backend/prisma/migrations/20260718090000_add_tournament_mark_table/migration.sql`
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1: Écrire la migration**

```sql
CREATE TYPE "TournamentPresence" AS ENUM ('UNSEEN', 'PRESENT', 'ABSENT');
CREATE TYPE "BenchSource" AS ENUM ('FORFEIT', 'WALK_IN');

ALTER TABLE "tournament_registrations" ADD COLUMN "captain_presence" "TournamentPresence" NOT NULL DEFAULT 'UNSEEN';
ALTER TABLE "tournament_registrations" ADD COLUMN "partner_presence" "TournamentPresence" NOT NULL DEFAULT 'UNSEEN';

CREATE TABLE "tournament_bench_entries" (
  "id" TEXT NOT NULL,
  "tournament_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "source" "BenchSource" NOT NULL,
  "added_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tournament_bench_entries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tournament_bench_entries_tournament_id_user_id_key" ON "tournament_bench_entries"("tournament_id", "user_id");
ALTER TABLE "tournament_bench_entries" ADD CONSTRAINT "tournament_bench_entries_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tournament_bench_entries" ADD CONSTRAINT "tournament_bench_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tournament_bench_entries" ADD CONSTRAINT "tournament_bench_entries_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "tournament_log_entries" (
  "id" TEXT NOT NULL,
  "tournament_id" TEXT NOT NULL,
  "actor_user_id" TEXT,
  "kind" TEXT NOT NULL,
  "data" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tournament_log_entries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "tournament_log_entries_tournament_id_created_at_idx" ON "tournament_log_entries"("tournament_id", "created_at");
ALTER TABLE "tournament_log_entries" ADD CONSTRAINT "tournament_log_entries_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tournament_log_entries" ADD CONSTRAINT "tournament_log_entries_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 2: Modifier le schéma**

Dans `model TournamentRegistration`, après `updatedAt` :
```prisma
  captainPresence TournamentPresence @default(UNSEEN) @map("captain_presence")
  partnerPresence TournamentPresence @default(UNSEEN) @map("partner_presence")
```

Ajouter, avant `model TournamentRegistration` :
```prisma
enum TournamentPresence { UNSEEN PRESENT ABSENT }
enum BenchSource { FORFEIT WALK_IN }

/// Le banc : joueurs seuls en attente d'une place (forfait du coéquipier, ou retardataire).
model TournamentBenchEntry {
  id           String     @id @default(cuid())
  tournamentId String     @map("tournament_id")
  userId       String     @map("user_id")
  source       BenchSource
  addedById    String?    @map("added_by_id")
  createdAt    DateTime   @default(now()) @map("created_at")

  tournament Tournament @relation(fields: [tournamentId], references: [id], onDelete: Cascade)
  user       User       @relation("TournamentBenchUser", fields: [userId], references: [id], onDelete: Cascade)
  addedBy    User?      @relation("TournamentBenchAddedBy", fields: [addedById], references: [id], onDelete: SetNull)

  @@unique([tournamentId, userId])
  @@map("tournament_bench_entries")
}

/// Journal des interventions à la table de marque (qui, quoi, quand).
model TournamentLogEntry {
  id           String   @id @default(cuid())
  tournamentId String   @map("tournament_id")
  actorUserId  String?  @map("actor_user_id")
  kind         String
  data         Json
  createdAt    DateTime @default(now()) @map("created_at")

  tournament Tournament @relation(fields: [tournamentId], references: [id], onDelete: Cascade)
  actor      User?      @relation("TournamentLogActor", fields: [actorUserId], references: [id], onDelete: SetNull)

  @@index([tournamentId, createdAt])
  @@map("tournament_log_entries")
}
```

Dans `model Tournament`, ajouter les relations inverses à côté de `registrations` :
```prisma
  benchEntries  TournamentBenchEntry[]
  logEntries    TournamentLogEntry[]
```

Dans `model User`, ajouter (3 nouvelles relations nommées inverses) :
```prisma
  tournamentBenchEntries      TournamentBenchEntry[] @relation("TournamentBenchUser")
  tournamentBenchEntriesAdded TournamentBenchEntry[] @relation("TournamentBenchAddedBy")
  tournamentLogEntries        TournamentLogEntry[]   @relation("TournamentLogActor")
```

- [ ] **Step 3: Appliquer + régénérer**

```bash
cd backend
node node_modules/prisma/build/index.js db execute --file prisma/migrations/20260718090000_add_tournament_mark_table/migration.sql
node node_modules/prisma/build/index.js generate
```
Expected: `Script executed successfully.` puis `Generated Prisma Client`.

- [ ] **Step 4: Vérifier**

```bash
node node_modules/prisma/build/index.js validate
node node_modules/typescript/bin/tsc --noEmit
```
Expected : `valid 🚀`, puis 0 sortie (ou uniquement la baseline connue si présente).

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260718090000_add_tournament_mark_table/migration.sql
git commit -m "feat(tournois): migration table de marque (presence, banc, journal)"
```

---

### Task 2: Lecture — `listMarkTable` + `listMarkTableLog`

**Files:**
- Modify: `backend/src/services/tournament.service.ts`
- Test: `backend/src/services/__tests__/tournament.service.test.ts`

- [ ] **Step 1: Tests**

```ts
describe('table de marque — lecture', () => {
  it('listMarkTable expose userId (surface d’action, pas la même règle que le roster)', async () => {
    (prisma.tournament.findFirst as jest.Mock).mockResolvedValue({
      id: 't1', name: 'Grand Prix', category: 'P500', gender: 'MEN', maxTeams: 12,
    });
    (prisma.tournamentRegistration.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'r1', status: 'CONFIRMED', paymentStatus: 'NONE', createdAt: new Date(),
        captainUserId: 'c1', partnerUserId: 'p1', captainPresence: 'PRESENT', partnerPresence: 'ABSENT',
        captain: { firstName: 'A', lastName: 'B', avatarUrl: null, phone: null },
        partner: { firstName: 'C', lastName: 'D', avatarUrl: null, phone: null },
      },
    ]);
    (prisma.tournamentBenchEntry.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.tournamentLogEntry.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.clubMembership.findMany as jest.Mock).mockResolvedValue([]);

    const view = await tournamentService.listMarkTable('club-1', 't1');
    expect(view.registrations[0].captain.userId).toBe('c1');
    expect(view.registrations[0].captain.presence).toBe('PRESENT');
    expect(view.registrations[0].partner.presence).toBe('ABSENT');
    expect(view.pointedCount).toBe(1);
    expect(view.totalSlots).toBe(2);
  });

  it('listMarkTable : TOURNAMENT_NOT_FOUND si autre club', async () => {
    (prisma.tournament.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(tournamentService.listMarkTable('club-1', 't1')).rejects.toThrow('TOURNAMENT_NOT_FOUND');
  });

  it('listMarkTableLog : cap 200, plus récent d’abord', async () => {
    (prisma.tournament.findFirst as jest.Mock).mockResolvedValue({ id: 't1' });
    (prisma.tournamentLogEntry.findMany as jest.Mock).mockResolvedValue([]);
    await tournamentService.listMarkTableLog('club-1', 't1');
    const arg = (prisma.tournamentLogEntry.findMany as jest.Mock).mock.calls[0][0];
    expect(arg.orderBy).toEqual({ createdAt: 'desc' });
    expect(arg.take).toBe(200);
  });
});
```

- [ ] **Step 2: Lancer, constater le rouge**

`node node_modules/jest/bin/jest.js src/services/__tests__/tournament.service.test.ts -t "table de marque — lecture"` → `listMarkTable is not a function`.

- [ ] **Step 3: Implémenter**

Types exportés (à côté de `RefereeTournamentRow`) :
```ts
export type MarkTablePresence = 'UNSEEN' | 'PRESENT' | 'ABSENT';

export interface MarkTablePlayer {
  userId: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  phone: string | null;
  membershipNo: string | null;
  presence: MarkTablePresence;
}

export interface MarkTableRegistration {
  id: string;
  status: string;
  paymentStatus: string;
  waitlistPosition: number | null;
  captain: MarkTablePlayer;
  partner: MarkTablePlayer;
}

export interface MarkTableBenchEntry {
  userId: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  phone: string | null;
  membershipNo: string | null;
  source: 'FORFEIT' | 'WALK_IN';
}

export interface MarkTableLogEntry {
  id: string;
  kind: string;
  data: Record<string, unknown>;
  actorName: string | null;
  createdAt: Date;
}

export interface MarkTableView {
  tournament: { id: string; name: string; category: string; gender: string; maxTeams: number | null };
  registrations: MarkTableRegistration[];
  bench: MarkTableBenchEntry[];
  recentLog: MarkTableLogEntry[];
  pointedCount: number;
  totalSlots: number;
  waitlistCount: number;
}
```

Bloc « Table de marque » en fin de classe (nouvelle section) :
```ts
  // ─────────────────────────────────────────────────────────── Table de marque
  // Gate = fait de la ROUTE appelante (resolveReferee+propriété côté J/A, STAFF côté admin).
  // Les méthodes ci-dessous sont le CŒUR PARTAGÉ, appelé par les deux portes.

  /** Vérifie que le tournoi appartient au club. TOURNAMENT_NOT_FOUND sinon. */
  private async assertTournamentInClub(clubId: string, tournamentId: string) {
    const t = await prisma.tournament.findFirst({
      where: { id: tournamentId, clubId },
      select: { id: true, name: true, category: true, gender: true, maxTeams: true },
    });
    if (!t) throw new Error('TOURNAMENT_NOT_FOUND');
    return t;
  }

  /**
   * `userId` exposé ici (contrairement à `refereeListRegistrations`, en lecture seule) :
   * cette vue sert à AGIR (remplacer/apparier), il faut un identifiant à renvoyer au
   * serveur. Jamais atteignable sans être J/A du tournoi ou STAFF du club — jamais public.
   */
  async listMarkTable(clubId: string, tournamentId: string): Promise<MarkTableView> {
    const t = await this.assertTournamentInClub(clubId, tournamentId);

    const registrations = await prisma.tournamentRegistration.findMany({
      where: { tournamentId, status: { not: 'CANCELLED' } },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true, status: true, paymentStatus: true,
        captainUserId: true, partnerUserId: true, captainPresence: true, partnerPresence: true,
        captain: { select: { firstName: true, lastName: true, avatarUrl: true, phone: true } },
        partner: { select: { firstName: true, lastName: true, avatarUrl: true, phone: true } },
      },
    });
    const bench = await prisma.tournamentBenchEntry.findMany({
      where: { tournamentId },
      orderBy: { createdAt: 'asc' },
      select: {
        userId: true, source: true,
        user: { select: { firstName: true, lastName: true, avatarUrl: true, phone: true } },
      },
    });
    const recentLogRows = await prisma.tournamentLogEntry.findMany({
      where: { tournamentId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, kind: true, data: true, createdAt: true, actor: { select: { firstName: true, lastName: true } } },
    });

    const userIds = [...new Set([
      ...registrations.flatMap((r) => [r.captainUserId, r.partnerUserId]),
      ...bench.map((b) => b.userId),
    ])];
    const memberships = userIds.length
      ? await prisma.clubMembership.findMany({ where: { clubId, userId: { in: userIds } }, select: { userId: true, membershipNo: true } })
      : [];
    const licenseByUser = new Map(memberships.map((m) => [m.userId, m.membershipNo]));

    const toPlayer = (u: { firstName: string; lastName: string; avatarUrl: string | null; phone: string | null }, userId: string, presence: MarkTablePresence): MarkTablePlayer => ({
      userId, firstName: u.firstName, lastName: u.lastName, avatarUrl: u.avatarUrl, phone: u.phone,
      membershipNo: licenseByUser.get(userId) ?? null, presence,
    });

    let waitlistIdx = 0;
    let pointedCount = 0;
    const mapped = registrations.map((r) => {
      if (r.captainPresence === 'PRESENT') pointedCount++;
      if (r.partnerPresence === 'PRESENT') pointedCount++;
      return {
        id: r.id, status: r.status, paymentStatus: r.paymentStatus,
        waitlistPosition: r.status === 'WAITLISTED' ? ++waitlistIdx : null,
        captain: toPlayer(r.captain, r.captainUserId, r.captainPresence),
        partner: toPlayer(r.partner, r.partnerUserId, r.partnerPresence),
      };
    });

    return {
      tournament: t,
      registrations: mapped,
      bench: bench.map((b) => ({
        userId: b.userId, firstName: b.user.firstName, lastName: b.user.lastName,
        avatarUrl: b.user.avatarUrl, phone: b.user.phone,
        membershipNo: licenseByUser.get(b.userId) ?? null, source: b.source,
      })),
      recentLog: recentLogRows.map((l) => ({
        id: l.id, kind: l.kind, data: l.data as Record<string, unknown>, createdAt: l.createdAt,
        actorName: l.actor ? `${l.actor.firstName} ${l.actor.lastName}`.trim() : null,
      })),
      pointedCount,
      totalSlots: mapped.filter((r) => r.status === 'CONFIRMED').length * 2,
      waitlistCount: mapped.filter((r) => r.status === 'WAITLISTED').length,
    };
  }

  /** Journal complet du tournoi, plus récent d'abord. Pas de curseur (v1 : cap simple). */
  async listMarkTableLog(clubId: string, tournamentId: string): Promise<MarkTableLogEntry[]> {
    await this.assertTournamentInClub(clubId, tournamentId);
    const rows = await prisma.tournamentLogEntry.findMany({
      where: { tournamentId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { id: true, kind: true, data: true, createdAt: true, actor: { select: { firstName: true, lastName: true } } },
    });
    return rows.map((l) => ({
      id: l.id, kind: l.kind, data: l.data as Record<string, unknown>, createdAt: l.createdAt,
      actorName: l.actor ? `${l.actor.firstName} ${l.actor.lastName}`.trim() : null,
    }));
  }

  /** Écrit une entrée de journal. À appeler DANS la transaction de l'acte qu'elle documente. */
  private async writeLog(tx: Prisma.TransactionClient, tournamentId: string, actorUserId: string, kind: string, data: Record<string, unknown>) {
    await tx.tournamentLogEntry.create({ data: { tournamentId, actorUserId, kind, data } });
  }
```

- [ ] **Step 4: Lancer, vérifier vert**

`node node_modules/jest/bin/jest.js src/services/__tests__/tournament.service.test.ts -t "table de marque"` → PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/tournament.service.ts backend/src/services/__tests__/tournament.service.test.ts
git commit -m "feat(tournois): lecture table de marque (listMarkTable, listMarkTableLog)"
```

---

### Task 3: Pointage + promote/remove journalisés

**Files:**
- Modify: `backend/src/services/tournament.service.ts`
- Test: `backend/src/services/__tests__/tournament.service.test.ts`

- [ ] **Step 1: Tests**

```ts
describe('table de marque — pointage', () => {
  it('setPresence : écrit le côté demandé + journal CHECK_IN', async () => {
    (prisma.tournamentRegistration.findFirst as jest.Mock).mockResolvedValue({
      id: 'r1', captainUserId: 'c1', partnerUserId: 'p1',
      captain: { firstName: 'A', lastName: 'B' }, partner: { firstName: 'C', lastName: 'D' },
    });
    const tx = { tournamentRegistration: { update: jest.fn() }, tournamentLogEntry: { create: jest.fn() } };
    (prisma.$transaction as jest.Mock).mockImplementation((fn) => fn(tx));

    await tournamentService.setPresence('club-1', 't1', 'r1', 'CAPTAIN', 'PRESENT', 'staff-1');

    expect(tx.tournamentRegistration.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { captainPresence: 'PRESENT' } });
    expect(tx.tournamentLogEntry.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tournamentId: 't1', actorUserId: 'staff-1', kind: 'CHECK_IN' }),
    }));
  });

  it('setPresence : REGISTRATION_NOT_FOUND hors club/tournoi', async () => {
    (prisma.tournamentRegistration.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(tournamentService.setPresence('club-1', 't1', 'r1', 'CAPTAIN', 'PRESENT', 'u1')).rejects.toThrow('REGISTRATION_NOT_FOUND');
  });

  it('markTablePromote délègue à adminPromoteRegistration puis journalise', async () => {
    const spy = jest.spyOn(tournamentService, 'adminPromoteRegistration').mockResolvedValue({ id: 'r1' } as never);
    (prisma.tournamentRegistration.findUnique as jest.Mock).mockResolvedValue({
      captain: { firstName: 'A', lastName: 'B' }, partner: { firstName: 'C', lastName: 'D' },
    });
    (prisma.tournamentLogEntry.create as jest.Mock).mockResolvedValue({});
    await tournamentService.markTablePromote('club-1', 't1', 'r1', 'staff-1');
    expect(spy).toHaveBeenCalledWith('t1', 'r1', 'club-1');
    expect(prisma.tournamentLogEntry.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: 'PROMOTE' }),
    }));
  });
});
```

- [ ] **Step 2: Rouge constaté** — `setPresence is not a function`.

- [ ] **Step 3: Implémenter** (à la suite du bloc Task 2)

```ts
  /** Pointage d'un joueur. Pas de gate temporel — pointer se fait à tout moment. */
  async setPresence(clubId: string, tournamentId: string, regId: string, side: 'CAPTAIN' | 'PARTNER', presence: MarkTablePresence, actorUserId: string) {
    const reg = await prisma.tournamentRegistration.findFirst({
      where: { id: regId, tournamentId, tournament: { clubId }, status: { not: 'CANCELLED' } },
      select: { id: true, captainUserId: true, partnerUserId: true, captain: { select: { firstName: true, lastName: true } }, partner: { select: { firstName: true, lastName: true } } },
    });
    if (!reg) throw new Error('REGISTRATION_NOT_FOUND');
    const player = side === 'CAPTAIN' ? reg.captain : reg.partner;
    await prisma.$transaction(async (tx) => {
      await tx.tournamentRegistration.update({
        where: { id: regId },
        data: side === 'CAPTAIN' ? { captainPresence: presence } : { partnerPresence: presence },
      });
      await this.writeLog(tx, tournamentId, actorUserId, 'CHECK_IN', {
        playerName: `${player.firstName} ${player.lastName}`.trim(), presence,
      });
    });
  }

  /** Promotion depuis la table de marque : délègue au cœur admin, puis journalise. */
  async markTablePromote(clubId: string, tournamentId: string, regId: string, actorUserId: string) {
    const promoted = await this.adminPromoteRegistration(tournamentId, regId, clubId);
    const full = await prisma.tournamentRegistration.findUnique({
      where: { id: promoted.id },
      select: { captain: { select: { firstName: true, lastName: true } }, partner: { select: { firstName: true, lastName: true } } },
    });
    if (full) {
      await prisma.tournamentLogEntry.create({
        data: { tournamentId, actorUserId, kind: 'PROMOTE', data: { nameA: `${full.captain.firstName} ${full.captain.lastName}`.trim(), nameB: `${full.partner.firstName} ${full.partner.lastName}`.trim() } },
      });
    }
    return promoted;
  }

  /** Retrait depuis la table de marque : délègue au cœur admin, puis journalise. */
  async markTableRemove(clubId: string, tournamentId: string, regId: string, actorUserId: string) {
    const before = await prisma.tournamentRegistration.findUnique({
      where: { id: regId },
      select: { captain: { select: { firstName: true, lastName: true } }, partner: { select: { firstName: true, lastName: true } } },
    });
    const removed = await this.adminRemoveRegistration(tournamentId, regId, clubId);
    if (before) {
      await prisma.tournamentLogEntry.create({
        data: { tournamentId, actorUserId, kind: 'REMOVE', data: { nameA: `${before.captain.firstName} ${before.captain.lastName}`.trim(), nameB: `${before.partner.firstName} ${before.partner.lastName}`.trim() } },
      });
    }
    return removed;
  }
```

- [ ] **Step 4: Vert** — `node node_modules/jest/bin/jest.js src/services/__tests__/tournament.service.test.ts` → suite tournoi entière verte.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/tournament.service.ts backend/src/services/__tests__/tournament.service.test.ts
git commit -m "feat(tournois): pointage + promote/remove journalises (table de marque)"
```

---

### Task 4: Forfait + banc (entrée/sortie)

**Files:**
- Modify: `backend/src/services/tournament.service.ts`
- Test: `backend/src/services/__tests__/tournament.service.test.ts`

- [ ] **Step 1: Tests**

```ts
describe('table de marque — forfait & banc', () => {
  it('declareForfeit : annule l’inscription, met le coéquipier au banc, promeut l’attente', async () => {
    (prisma.tournamentRegistration.findFirst as jest.Mock).mockResolvedValue({
      id: 'r1', status: 'CONFIRMED', captainUserId: 'c1', partnerUserId: 'p1',
      captain: { firstName: 'Bernard', lastName: 'X' }, partner: { firstName: 'Andre', lastName: 'Y' },
    });
    const tx = {
      $queryRaw: jest.fn(),
      tournamentRegistration: { update: jest.fn().mockResolvedValue({ id: 'r1' }), findFirst: jest.fn().mockResolvedValue(null) },
      tournamentBenchEntry: { create: jest.fn() },
      tournamentLogEntry: { create: jest.fn() },
    };
    (prisma.$transaction as jest.Mock).mockImplementation((fn) => fn(tx));

    await tournamentService.declareForfeit('club-1', 't1', 'r1', 'CAPTAIN', 'staff-1');

    expect(tx.tournamentRegistration.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'r1' }, data: expect.objectContaining({ status: 'CANCELLED' }),
    }));
    expect(tx.tournamentBenchEntry.create).toHaveBeenCalledWith({
      data: { tournamentId: 't1', userId: 'p1', source: 'FORFEIT', addedById: 'staff-1' },
    });
    expect(tx.tournamentLogEntry.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: 'FORFEIT' }),
    }));
  });

  it('addToBench : refuse un non-membre (NOT_A_MEMBER)', async () => {
    (prisma.clubMembership.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(tournamentService.addToBench('club-1', 't1', 'u9', 'staff-1')).rejects.toThrow('NOT_A_MEMBER');
  });

  it('addToBench : refuse un déjà-inscrit (ALREADY_REGISTERED)', async () => {
    (prisma.clubMembership.findUnique as jest.Mock).mockResolvedValue({ status: 'ACTIVE' });
    (prisma.tournamentRegistration.findFirst as jest.Mock).mockResolvedValue({ id: 'r-existing' });
    await expect(tournamentService.addToBench('club-1', 't1', 'u9', 'staff-1')).rejects.toThrow('ALREADY_REGISTERED');
  });

  it('addToBench : idempotent (ALREADY_ON_BENCH)', async () => {
    (prisma.clubMembership.findUnique as jest.Mock).mockResolvedValue({ status: 'ACTIVE' });
    (prisma.tournamentRegistration.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.tournamentBenchEntry.findUnique as jest.Mock).mockResolvedValue({ id: 'b1' });
    await expect(tournamentService.addToBench('club-1', 't1', 'u9', 'staff-1')).rejects.toThrow('ALREADY_ON_BENCH');
  });

  it('removeFromBench : BENCH_ENTRY_NOT_FOUND si absent', async () => {
    (prisma.tournamentBenchEntry.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });
    await expect(tournamentService.removeFromBench('club-1', 't1', 'u9', 'staff-1')).rejects.toThrow('BENCH_ENTRY_NOT_FOUND');
  });
});
```

- [ ] **Step 2: Rouge** — `declareForfeit is not a function`.

- [ ] **Step 3: Implémenter**

```ts
  /** Adhésion ACTIVE requise (pas BLOCKED, pas absente). NOT_A_MEMBER sinon. Pas de garde phone/licence (spec : le J/A juge). */
  private async assertActiveMember(clubId: string, userId: string): Promise<void> {
    const m = await prisma.clubMembership.findUnique({ where: { userId_clubId: { userId, clubId } }, select: { status: true } });
    if (!m || m.status !== 'ACTIVE') throw new Error('NOT_A_MEMBER');
  }

  /**
   * Forfait d'un côté d'un binôme : annule TOUTE l'inscription (le schéma n'autorise pas un
   * côté vide) et place le coéquipier survivant sur le banc pour qu'il puisse être repêché
   * (appariement ou remplacement ailleurs). Réutilise cancelAndPromoteTx (promotion auto du
   * 1er en attente, mêmes règles que adminRemoveRegistration).
   */
  async declareForfeit(clubId: string, tournamentId: string, regId: string, side: 'CAPTAIN' | 'PARTNER', actorUserId: string) {
    const reg = await prisma.tournamentRegistration.findFirst({
      where: { id: regId, tournamentId, tournament: { clubId }, status: { not: 'CANCELLED' } },
      select: {
        id: true, status: true, captainUserId: true, partnerUserId: true,
        captain: { select: { firstName: true, lastName: true } }, partner: { select: { firstName: true, lastName: true } },
      },
    });
    if (!reg) throw new Error('REGISTRATION_NOT_FOUND');
    const t = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { requirePrepayment: true } });
    const forfeited = side === 'CAPTAIN' ? reg.captain : reg.partner;
    const remaining = side === 'CAPTAIN' ? { user: reg.partner, id: reg.partnerUserId } : { user: reg.captain, id: reg.captainUserId };

    const { cancelled, promotedRegistrationId } = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tournaments WHERE id = ${tournamentId} FOR UPDATE`;
      const res = await this.cancelAndPromoteTx(tx, tournamentId, regId, reg.status === 'CONFIRMED', t?.requirePrepayment ?? false);
      await tx.tournamentBenchEntry.create({ data: { tournamentId, userId: remaining.id, source: 'FORFEIT', addedById: actorUserId } });
      await this.writeLog(tx, tournamentId, actorUserId, 'FORFEIT', {
        forfeitedName: `${forfeited.firstName} ${forfeited.lastName}`.trim(),
        remainingName: `${remaining.user.firstName} ${remaining.user.lastName}`.trim(),
      });
      return res;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 });

    if (promotedRegistrationId && t?.requirePrepayment) {
      await this.safeNotify(() => notify.notifyTournamentCancellation(cancelled.id));
      await this.safeCharge(promotedRegistrationId);
    } else {
      await this.notifyCancellation(cancelled.id, promotedRegistrationId);
    }
    return cancelled;
  }

  /** Ajoute un retardataire au banc (membre actif requis). Idempotent via l'index unique. */
  async addToBench(clubId: string, tournamentId: string, userId: string, actorUserId: string) {
    await this.assertActiveMember(clubId, userId);
    const dup = await prisma.tournamentRegistration.findFirst({
      where: { tournamentId, status: { not: 'CANCELLED' }, OR: [{ captainUserId: userId }, { partnerUserId: userId }] },
      select: { id: true },
    });
    if (dup) throw new Error('ALREADY_REGISTERED');
    const already = await prisma.tournamentBenchEntry.findUnique({ where: { tournamentId_userId: { tournamentId, userId } } });
    if (already) throw new Error('ALREADY_ON_BENCH');
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true } });
    await prisma.$transaction(async (tx) => {
      await tx.tournamentBenchEntry.create({ data: { tournamentId, userId, source: 'WALK_IN', addedById: actorUserId } });
      await this.writeLog(tx, tournamentId, actorUserId, 'ADD_LATE', { playerName: user ? `${user.firstName} ${user.lastName}`.trim() : userId });
    });
  }

  /** Retrait manuel du banc. BENCH_ENTRY_NOT_FOUND si absent. */
  async removeFromBench(clubId: string, tournamentId: string, userId: string, actorUserId: string) {
    await this.assertTournamentInClub(clubId, tournamentId);
    const del = await prisma.tournamentBenchEntry.deleteMany({ where: { tournamentId, userId } });
    if (del.count === 0) throw new Error('BENCH_ENTRY_NOT_FOUND');
    void actorUserId; // pas de journal pour un simple retrait manuel (acte correctif, pas un événement de jeu)
  }
```

- [ ] **Step 4: Vert** — suite tournoi complète.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/tournament.service.ts backend/src/services/__tests__/tournament.service.test.ts
git commit -m "feat(tournois): forfait + banc (table de marque)"
```

---

### Task 5: Notification de remplacement

**Files:**
- Modify: `backend/src/email/notifications.ts`
- Test: `backend/src/email/__tests__/emails.test.ts` (ou fichier de test notifications existant — vérifier lequel couvre `notifyTournament*` et y ajouter)

- [ ] **Step 1: Test**

```ts
it('notifyTournamentReplacement envoie « registration.cancelled » au seul joueur remplacé', async () => {
  (prisma.tournament.findUnique as jest.Mock).mockResolvedValue({
    id: 't1', name: 'Grand Prix', startTime: new Date(), endTime: null, registrationDeadline: new Date(),
    club: { id: 'club-1', slug: 'demo', name: 'Demo', timezone: 'Europe/Paris', logoUrl: null, logoWideUrl: null, accentColor: '#000', address: null, city: null, contactPhone: null, contactEmail: null },
  });
  (emailTemplates.getOverride as jest.Mock).mockResolvedValue(null);
  const dispatchSpy = jest.spyOn(dispatcher, 'dispatch').mockResolvedValue();

  await notify.notifyTournamentReplacement({
    tournamentId: 't1',
    removedPlayer: { id: 'u1', email: 'removed@test.fr', firstName: 'Bernard', lastName: 'X' },
    remainingPlayerName: 'Andre Y',
  });

  expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', type: 'registration.cancelled' }));
});

it('notifyTournamentReplacement : no-op silencieux si tournoi introuvable', async () => {
  (prisma.tournament.findUnique as jest.Mock).mockResolvedValue(null);
  await expect(notify.notifyTournamentReplacement({
    tournamentId: 't1', removedPlayer: { id: 'u1', email: 'a@test.fr', firstName: 'A', lastName: 'B' }, remainingPlayerName: 'C',
  })).resolves.toBeUndefined();
});
```

> Adapter les mocks à la convention réelle du fichier de test choisi (chercher un test existant de `notifyTournamentCancellation` et copier son harnais exact — imports, mocks de `prisma`, `emailTemplates`, `dispatch`).

- [ ] **Step 2: Rouge** — `notify.notifyTournamentReplacement is not a function`.

- [ ] **Step 3: Implémenter**, après `notifyTournamentPromotion` dans `notifications.ts` :

```ts
/**
 * Un joueur est remplacé à la table de marque : la même inscription (même id) accueille
 * un nouveau captain/partnerUserId, donc `notifyTournamentCancellation(regId)` ne peut plus
 * atteindre l'ancien joueur (le champ a déjà changé). On lui envoie ici, ciblé, le même
 * email `registration.cancelled` que la désinscription classique — aucun template nouveau.
 * Le remplaçant (et le coéquipier restant) sont notifiés séparément via
 * `notifyTournamentRegistration(regId)`, appelé APRÈS le swap par l'appelant.
 */
export async function notifyTournamentReplacement(opts: {
  tournamentId: string;
  removedPlayer: { id: string; email: string | null; firstName: string; lastName: string };
  remainingPlayerName: string;
}): Promise<void> {
  const t = await prisma.tournament.findUnique({
    where: { id: opts.tournamentId },
    select: { id: true, name: true, startTime: true, endTime: true, registrationDeadline: true, club: { select: EMAIL_CLUB_SELECT } },
  });
  if (!t || !opts.removedPlayer.email) return;

  const brand = brandFromClub(t.club);
  const dateLabel = formatDateRangeFr(t.startTime, t.endTime, t.club.timezone);
  const url = clubAppUrl(t.club.slug, `/tournois/${t.id}`);
  const emailType = 'registration.cancelled';
  const override = await emailTemplates.getOverride(t.club.id, emailType);
  const vars: Record<string, string> = {
    prenom: opts.removedPlayer.firstName,
    activite: t.name,
    ref_activite: refActivite('tournament'),
    type_activite: typeActivite('tournament'),
    club: t.club.name,
    date: dateLabel,
    lien: url,
    coequipier: opts.remainingPlayerName,
    phrase_coequipier: '',
    date_limite_annulation: formatDateFr(t.registrationDeadline, t.club.timezone),
  };
  const mail = renderClubEmail(emailType, vars, brand, override);
  const { title, body } = playerNotifContent('cancelled', t.name);
  await dispatch({
    userId: opts.removedPlayer.id,
    clubId: t.club.id,
    category: 'MY_REGISTRATIONS',
    type: emailType,
    title,
    body,
    url,
    email: { to: opts.removedPlayer.email, subject: mail.subject, html: mail.html, text: mail.text },
  });
}
```

- [ ] **Step 4: Vérifier + tsc**

```bash
node node_modules/jest/bin/jest.js <fichier-de-test-choisi> -t "notifyTournamentReplacement"
node node_modules/typescript/bin/tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/email/notifications.ts backend/src/email/__tests__/*.test.ts
git commit -m "feat(tournois): email cible au joueur remplace (table de marque)"
```

---

### Task 6: Remplacement de joueur (le cœur du sujet)

**Files:**
- Modify: `backend/src/services/tournament.service.ts`
- Test: `backend/src/services/__tests__/tournament.service.test.ts`

- [ ] **Step 1: Tests**

```ts
describe('table de marque — remplacement', () => {
  const baseReg = {
    id: 'r1', tournamentId: 't1', captainUserId: 'c1', partnerUserId: 'p1',
    tournament: { gender: 'MEN', openToWomen: false },
    captain: { firstName: 'Bernard', lastName: 'X', email: 'bernard@test.fr' },
    partner: { firstName: 'Andre', lastName: 'Y', email: 'andre@test.fr' },
  };

  it('replacePlayer : swap le côté demandé, présence -> PRESENT, paiement intouché', async () => {
    (prisma.tournamentRegistration.findFirst as jest.Mock).mockResolvedValue(baseReg);
    (prisma.clubMembership.findUnique as jest.Mock).mockResolvedValue({ status: 'ACTIVE' });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u9', sex: 'MALE' });
    const tx = {
      tournamentRegistration: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn().mockResolvedValue({ id: 'r1' }) },
      tournamentBenchEntry: { deleteMany: jest.fn() },
      tournamentLogEntry: { create: jest.fn() },
    };
    (prisma.$transaction as jest.Mock).mockImplementation((fn) => fn(tx));
    jest.spyOn(notify, 'notifyTournamentReplacement').mockResolvedValue();
    jest.spyOn(notify, 'notifyTournamentRegistration').mockResolvedValue();

    await tournamentService.replacePlayer('club-1', 't1', 'r1', 'CAPTAIN', 'u9', 'staff-1');

    expect(tx.tournamentRegistration.update).toHaveBeenCalledWith({
      where: { id: 'r1' }, data: { captainUserId: 'u9', captainPresence: 'PRESENT' },
    });
    expect(tx.tournamentBenchEntry.deleteMany).toHaveBeenCalledWith({ where: { tournamentId: 't1', userId: 'u9' } });
  });

  it('replacePlayer : refuse un non-membre (NOT_A_MEMBER)', async () => {
    (prisma.tournamentRegistration.findFirst as jest.Mock).mockResolvedValue(baseReg);
    (prisma.clubMembership.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(tournamentService.replacePlayer('club-1', 't1', 'r1', 'CAPTAIN', 'u9', 'staff-1')).rejects.toThrow('NOT_A_MEMBER');
  });

  it('replacePlayer : refuse un déjà-inscrit dans ce tournoi', async () => {
    (prisma.tournamentRegistration.findFirst as jest.Mock)
      .mockResolvedValueOnce(baseReg)
      .mockResolvedValueOnce({ id: 'r-other' });
    (prisma.clubMembership.findUnique as jest.Mock).mockResolvedValue({ status: 'ACTIVE' });
    await expect(tournamentService.replacePlayer('club-1', 't1', 'r1', 'CAPTAIN', 'u9', 'staff-1')).rejects.toThrow('ALREADY_REGISTERED');
  });

  it('replacePlayer : composition refusée avec GENDER_MISMATCH (tableau Dames, remplaçant homme)', async () => {
    (prisma.tournamentRegistration.findFirst as jest.Mock)
      .mockResolvedValueOnce({ ...baseReg, tournament: { gender: 'WOMEN', openToWomen: false } })
      .mockResolvedValueOnce(null);
    (prisma.clubMembership.findUnique as jest.Mock).mockResolvedValue({ status: 'ACTIVE' });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u9', sex: 'MALE' });
    await expect(tournamentService.replacePlayer('club-1', 't1', 'r1', 'CAPTAIN', 'u9', 'staff-1')).rejects.toThrow('GENDER_MISMATCH');
  });
});
```

- [ ] **Step 2: Rouge** — `replacePlayer is not a function`.

- [ ] **Step 3: Implémenter**

```ts
  /**
   * Remplace UN côté d'un binôme, sur SA place (même regId, même paiement — intouché).
   * Fonctionne sur n'importe quel côté (absent ou non : aucun gate de présence côté serveur,
   * l'UI ne propose que les côtés ABSENT comme cibles). Outrepasse la clôture.
   */
  async replacePlayer(clubId: string, tournamentId: string, regId: string, side: 'CAPTAIN' | 'PARTNER', newUserId: string, actorUserId: string) {
    const reg = await prisma.tournamentRegistration.findFirst({
      where: { id: regId, tournamentId, tournament: { clubId }, status: { not: 'CANCELLED' } },
      select: {
        id: true, captainUserId: true, partnerUserId: true,
        tournament: { select: { gender: true, openToWomen: true } },
        captain: { select: { firstName: true, lastName: true } }, partner: { select: { firstName: true, lastName: true } },
      },
    });
    if (!reg) throw new Error('REGISTRATION_NOT_FOUND');
    if (newUserId === reg.captainUserId || newUserId === reg.partnerUserId) throw new Error('ALREADY_REGISTERED');

    await this.assertActiveMember(clubId, newUserId);
    const dup = await prisma.tournamentRegistration.findFirst({
      where: { tournamentId, status: { not: 'CANCELLED' }, id: { not: regId }, OR: [{ captainUserId: newUserId }, { partnerUserId: newUserId }] },
      select: { id: true },
    });
    if (dup) throw new Error('ALREADY_REGISTERED');

    const newUser = await prisma.user.findUnique({ where: { id: newUserId }, select: { id: true, sex: true, firstName: true, lastName: true, email: true } });
    if (!newUser) throw new Error('USER_NOT_FOUND');
    if (!newUser.sex) throw new Error('SEX_REQUIRED');
    const otherSide = side === 'CAPTAIN' ? reg.partner : reg.captain;
    // otherSide.sex n'est pas chargé ci-dessus : on le récupère via le user complet du côté conservé.
    const otherUserId = side === 'CAPTAIN' ? reg.partnerUserId : reg.captainUserId;
    const otherUser = await prisma.user.findUnique({ where: { id: otherUserId }, select: { sex: true } });
    if (!otherUser?.sex) throw new Error('SEX_REQUIRED');
    const captainSex = side === 'CAPTAIN' ? newUser.sex : otherUser.sex;
    const partnerSex = side === 'CAPTAIN' ? otherUser.sex : newUser.sex;
    this.assertGender(reg.tournament.gender, captainSex as Sex, partnerSex as Sex, reg.tournament.openToWomen);

    const removedPlayer = side === 'CAPTAIN' ? reg.captain : reg.partner;
    await prisma.$transaction(async (tx) => {
      await tx.tournamentRegistration.update({
        where: { id: regId },
        data: side === 'CAPTAIN'
          ? { captainUserId: newUserId, captainPresence: 'PRESENT' }
          : { partnerUserId: newUserId, partnerPresence: 'PRESENT' },
      });
      await tx.tournamentBenchEntry.deleteMany({ where: { tournamentId, userId: newUserId } });
      await this.writeLog(tx, tournamentId, actorUserId, 'REPLACE', {
        removedName: `${removedPlayer.firstName} ${removedPlayer.lastName}`.trim(),
        newName: `${newUser.firstName} ${newUser.lastName}`.trim(),
      });
    });

    await this.safeNotify(() => notify.notifyTournamentReplacement({
      tournamentId,
      removedPlayer: { id: side === 'CAPTAIN' ? reg.captainUserId : reg.partnerUserId, email: null, firstName: removedPlayer.firstName, lastName: removedPlayer.lastName },
      remainingPlayerName: `${otherSide.firstName} ${otherSide.lastName}`.trim(),
    }));
    await this.safeNotify(() => notify.notifyTournamentRegistration(regId));
  }
```

⚠️ **Note pour l'implémenteur** : `notifyTournamentReplacement` a besoin de l'email du joueur retiré, or il n'est pas chargé dans le `select` de `reg.captain`/`reg.partner` ci-dessus (seulement `firstName`/`lastName`). **Corriger avant de committer** : ajouter `email: true` au `select` de `captain`/`partner` dans la requête `findFirst` du début de la méthode, et passer `removedPlayer.email: removedPlayer.email` (au lieu de `null`) dans l'appel à `notifyTournamentReplacement`. Écrire un test qui vérifie `notify.notifyTournamentReplacement` reçoit un email non-null pour attraper toute régression future.

- [ ] **Step 4: Corriger l'omission d'email, vérifier vert** — relire le diff, appliquer le correctif ci-dessus, relancer la suite tournoi complète.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/tournament.service.ts backend/src/services/__tests__/tournament.service.test.ts
git commit -m "feat(tournois): remplacement de joueur (table de marque)"
```

---

### Task 7: Appariement + binôme tardif

**Files:**
- Modify: `backend/src/services/tournament.service.ts`
- Test: `backend/src/services/__tests__/tournament.service.test.ts`

- [ ] **Step 1: Tests**

```ts
describe('table de marque — appariement & tardif', () => {
  it('pairFromBench : crée une inscription CONFIRMED si place libre, sort les 2 du banc', async () => {
    (prisma.tournament.findUnique as jest.Mock).mockResolvedValue({
      id: 't1', clubId: 'club-1', gender: 'MEN', openToWomen: true, status: 'PUBLISHED', maxTeams: 12, requirePrepayment: false,
    });
    (prisma.user.findUnique as jest.Mock)
      .mockResolvedValueOnce({ id: 'ua', sex: 'MALE', firstName: 'A', lastName: 'B' })
      .mockResolvedValueOnce({ id: 'ub', sex: 'MALE', firstName: 'C', lastName: 'D' });
    (prisma.clubMembership.findUnique as jest.Mock).mockResolvedValue({ status: 'ACTIVE' });
    const tx = {
      $queryRaw: jest.fn(),
      tournamentRegistration: { findFirst: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(5), create: jest.fn().mockResolvedValue({ id: 'r-new', status: 'CONFIRMED' }) },
      tournamentBenchEntry: { deleteMany: jest.fn() },
      tournamentLogEntry: { create: jest.fn() },
    };
    (prisma.$transaction as jest.Mock).mockImplementation((fn) => fn(tx));

    const reg = await tournamentService.pairFromBench('club-1', 't1', 'ua', 'ub', 'staff-1');

    expect(tx.tournamentRegistration.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tournamentId: 't1', captainUserId: 'ua', partnerUserId: 'ub', status: 'CONFIRMED' }),
    }));
    expect(tx.tournamentBenchEntry.deleteMany).toHaveBeenCalledWith({ where: { tournamentId: 't1', userId: { in: ['ua', 'ub'] } } });
    expect(reg.id).toBe('r-new');
  });

  it('pairFromBench : WAITLISTED si complet', async () => {
    (prisma.tournament.findUnique as jest.Mock).mockResolvedValue({
      id: 't1', clubId: 'club-1', gender: 'MEN', openToWomen: true, status: 'PUBLISHED', maxTeams: 2, requirePrepayment: false,
    });
    (prisma.user.findUnique as jest.Mock)
      .mockResolvedValueOnce({ id: 'ua', sex: 'MALE', firstName: 'A', lastName: 'B' })
      .mockResolvedValueOnce({ id: 'ub', sex: 'MALE', firstName: 'C', lastName: 'D' });
    (prisma.clubMembership.findUnique as jest.Mock).mockResolvedValue({ status: 'ACTIVE' });
    const tx = {
      $queryRaw: jest.fn(),
      tournamentRegistration: { findFirst: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(2), create: jest.fn().mockResolvedValue({ id: 'r-new', status: 'WAITLISTED' }) },
      tournamentBenchEntry: { deleteMany: jest.fn() },
      tournamentLogEntry: { create: jest.fn() },
    };
    (prisma.$transaction as jest.Mock).mockImplementation((fn) => fn(tx));
    const reg = await tournamentService.pairFromBench('club-1', 't1', 'ua', 'ub', 'staff-1');
    expect(reg.status).toBe('WAITLISTED');
  });

  it('pairFromBench : épreuve payante -> DUE + holdDeadline', async () => {
    (prisma.tournament.findUnique as jest.Mock).mockResolvedValue({
      id: 't1', clubId: 'club-1', gender: 'MEN', openToWomen: true, status: 'PUBLISHED', maxTeams: 12, requirePrepayment: true,
    });
    (prisma.user.findUnique as jest.Mock)
      .mockResolvedValueOnce({ id: 'ua', sex: 'MALE', firstName: 'A', lastName: 'B' })
      .mockResolvedValueOnce({ id: 'ub', sex: 'MALE', firstName: 'C', lastName: 'D' });
    (prisma.clubMembership.findUnique as jest.Mock).mockResolvedValue({ status: 'ACTIVE' });
    const tx = {
      $queryRaw: jest.fn(),
      tournamentRegistration: { findFirst: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(1), create: jest.fn().mockResolvedValue({ id: 'r-new', status: 'CONFIRMED' }) },
      tournamentBenchEntry: { deleteMany: jest.fn() },
      tournamentLogEntry: { create: jest.fn() },
    };
    (prisma.$transaction as jest.Mock).mockImplementation((fn) => fn(tx));
    await tournamentService.pairFromBench('club-1', 't1', 'ua', 'ub', 'staff-1');
    const createArg = tx.tournamentRegistration.create.mock.calls[0][0];
    expect(createArg.data.paymentStatus).toBe('DUE');
    expect(createArg.data.paymentDeadline).toBeInstanceOf(Date);
  });

  it('addLateRegistration : même chemin sans passer par le banc', async () => {
    (prisma.tournament.findUnique as jest.Mock).mockResolvedValue({
      id: 't1', clubId: 'club-1', gender: 'MEN', openToWomen: true, status: 'PUBLISHED', maxTeams: 12, requirePrepayment: false,
    });
    (prisma.user.findUnique as jest.Mock)
      .mockResolvedValueOnce({ id: 'ua', sex: 'MALE', firstName: 'A', lastName: 'B' })
      .mockResolvedValueOnce({ id: 'ub', sex: 'MALE', firstName: 'C', lastName: 'D' });
    (prisma.clubMembership.findUnique as jest.Mock).mockResolvedValue({ status: 'ACTIVE' });
    const tx = {
      $queryRaw: jest.fn(),
      tournamentRegistration: { findFirst: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(0), create: jest.fn().mockResolvedValue({ id: 'r-new', status: 'CONFIRMED' }) },
      tournamentBenchEntry: { deleteMany: jest.fn() },
      tournamentLogEntry: { create: jest.fn() },
    };
    (prisma.$transaction as jest.Mock).mockImplementation((fn) => fn(tx));
    await tournamentService.addLateRegistration('club-1', 't1', 'ua', 'ub', 'staff-1');
    expect(tx.tournamentLogEntry.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: 'ADD_LATE' }),
    }));
  });
});
```

- [ ] **Step 2: Rouge** — `pairFromBench is not a function`.

- [ ] **Step 3: Implémenter**

```ts
  /**
   * Cœur partagé d'appariement/tardif : mêmes validations que `register` SAUF la deadline.
   * `fromBench` détermine si les 2 joueurs sont retirés du banc après création.
   */
  private async createPairedRegistration(clubId: string, tournamentId: string, userAId: string, userBId: string, actorUserId: string, logKind: 'PAIR' | 'ADD_LATE', fromBench: boolean) {
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { id: true, clubId: true, gender: true, openToWomen: true, status: true, maxTeams: true, requirePrepayment: true },
    });
    if (!tournament || tournament.clubId !== clubId) throw new Error('TOURNAMENT_NOT_FOUND');
    if (tournament.status !== 'PUBLISHED') throw new Error('TOURNAMENT_NOT_OPEN');
    if (userAId === userBId) throw new Error('PARTNER_IS_SELF');

    await this.assertActiveMember(clubId, userAId);
    await this.assertActiveMember(clubId, userBId);
    const [userA, userB] = await Promise.all([
      prisma.user.findUnique({ where: { id: userAId }, select: { id: true, sex: true, firstName: true, lastName: true } }),
      prisma.user.findUnique({ where: { id: userBId }, select: { id: true, sex: true, firstName: true, lastName: true } }),
    ]);
    if (!userA || !userB) throw new Error('USER_NOT_FOUND');
    if (!userA.sex || !userB.sex) throw new Error('SEX_REQUIRED');
    this.assertGender(tournament.gender, userA.sex as Sex, userB.sex as Sex, tournament.openToWomen);

    const paid = tournament.requirePrepayment;
    const registration = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tournaments WHERE id = ${tournamentId} FOR UPDATE`;
      await this.assertNoActiveRegistration(tx, tournamentId, [userAId, userBId]);
      const now = new Date();
      const confirmed = await tx.tournamentRegistration.count({ where: { tournamentId, ...occupiesSpotWhere(now) } });
      const status = tournament.maxTeams == null || confirmed < tournament.maxTeams ? 'CONFIRMED' : 'WAITLISTED';
      const created = await tx.tournamentRegistration.create({
        data: {
          tournamentId, captainUserId: userAId, partnerUserId: userBId, status,
          captainPresence: 'PRESENT', partnerPresence: 'PRESENT',
          ...(paid ? { paymentStatus: 'DUE', paymentDeadline: status === 'CONFIRMED' ? holdDeadline(now) : null } : {}),
        },
      });
      if (fromBench) await tx.tournamentBenchEntry.deleteMany({ where: { tournamentId, userId: { in: [userAId, userBId] } } });
      await this.writeLog(tx, tournamentId, actorUserId, logKind, {
        nameA: `${userA.firstName} ${userA.lastName}`.trim(), nameB: `${userB.firstName} ${userB.lastName}`.trim(),
      });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 });

    if (!paid || registration.status === 'WAITLISTED') {
      await this.safeNotify(() => notify.notifyTournamentRegistration(registration.id));
    }
    return registration;
  }

  /** Deux joueurs du banc forment un nouveau binôme. Ils sortent du banc dans la transaction. */
  async pairFromBench(clubId: string, tournamentId: string, userAId: string, userBId: string, actorUserId: string) {
    return this.createPairedRegistration(clubId, tournamentId, userAId, userBId, actorUserId, 'PAIR', true);
  }

  /** Binôme tardif direct (sans passer par le banc). */
  async addLateRegistration(clubId: string, tournamentId: string, captainUserId: string, partnerUserId: string, actorUserId: string) {
    return this.createPairedRegistration(clubId, tournamentId, captainUserId, partnerUserId, actorUserId, 'ADD_LATE', false);
  }
```

⚠️ **Note** : `assertGender` est `private` — ces nouvelles méthodes sont dans la même classe, donc l'appel direct fonctionne. Si `assertActiveMember`/`writeLog`/`assertNoActiveRegistration` ont été renommées dans les tâches précédentes, aligner ces appels.

- [ ] **Step 4: Vert** — suite tournoi complète, `tsc --noEmit` propre.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/tournament.service.ts backend/src/services/__tests__/tournament.service.test.ts
git commit -m "feat(tournois): appariement banc + binome tardif (table de marque)"
```

---

### Task 8: Routes J/A

**Files:**
- Modify: `backend/src/routes/clubs.ts`
- Test: `backend/src/routes/__tests__/clubs.referee.routes.test.ts`

- [ ] **Step 1: Tests** — calquer sur les tests existants du fichier (mock `ensureActiveMembership`, `resolveReferee`). Cas minimaux :

```ts
describe('table de marque — routes J/A', () => {
  beforeEach(() => {
    (tournamentService.resolveReferee as jest.Mock).mockResolvedValue(true);
  });

  it('GET mark-table — 403 NOT_A_REFEREE sans la facette', async () => {
    (tournamentService.resolveReferee as jest.Mock).mockResolvedValue(false);
    const res = await request(app).get('/api/clubs/demo/me/referee/tournaments/t1/mark-table').set('Authorization', 'Bearer t');
    expect(res.status).toBe(403);
  });

  it('GET mark-table — 200 avec la facette', async () => {
    (tournamentService.listMarkTable as jest.Mock).mockResolvedValue({ registrations: [] });
    const res = await request(app).get('/api/clubs/demo/me/referee/tournaments/t1/mark-table').set('Authorization', 'Bearer t');
    expect(res.status).toBe(200);
    expect(tournamentService.listMarkTable).toHaveBeenCalledWith('club-1', 't1');
  });

  it('POST presence — délègue avec side+presence', async () => {
    (tournamentService.setPresence as jest.Mock).mockResolvedValue(undefined);
    const res = await request(app).post('/api/clubs/demo/me/referee/tournaments/t1/registrations/r1/presence')
      .set('Authorization', 'Bearer t').send({ side: 'CAPTAIN', presence: 'PRESENT' });
    expect(res.status).toBe(200);
    expect(tournamentService.setPresence).toHaveBeenCalledWith('club-1', 't1', 'r1', 'CAPTAIN', 'PRESENT', expect.any(String));
  });

  it('POST replace — GENDER_MISMATCH remonte 400', async () => {
    (tournamentService.replacePlayer as jest.Mock).mockRejectedValue(new Error('GENDER_MISMATCH'));
    const res = await request(app).post('/api/clubs/demo/me/referee/tournaments/t1/registrations/r1/replace')
      .set('Authorization', 'Bearer t').send({ side: 'CAPTAIN', newUserId: 'u9' });
    expect(res.status).toBe(400);
  });

  it('DELETE bench/:userId — 200', async () => {
    (tournamentService.removeFromBench as jest.Mock).mockResolvedValue(undefined);
    const res = await request(app).delete('/api/clubs/demo/me/referee/tournaments/t1/bench/u9').set('Authorization', 'Bearer t');
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Rouge** — 404 sur toutes les routes.

- [ ] **Step 3: Implémenter** — codes d'erreur d'abord, dans `ERROR_STATUS` (`clubs.ts`, à côté de `TOURNAMENT_NOT_FOUND`) :

```ts
  NOT_A_MEMBER:          403,
  ALREADY_ON_BENCH:      409,
  BENCH_ENTRY_NOT_FOUND: 404,
  TOURNAMENT_NOT_OPEN:   409,
  SEX_REQUIRED:          400,
  GENDER_MISMATCH:       400,
  USER_NOT_FOUND:        404,
```
(`ALREADY_REGISTERED`, `REGISTRATION_NOT_FOUND` existent déjà dans le fichier — vérifier avant d'ajouter en double.)

Après le bloc des 4 routes J/A existantes :

```ts
// --- Table de marque du J/A (mêmes gates que les 4 routes ci-dessus, cœur partagé avec le staff) ---

router.get('/:slug/me/referee/tournaments/:id/mark-table', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id: clubId } = await ensureActiveMembership(asString(req.params.slug), req.user!.id);
    if (!(await tournamentService.resolveReferee(clubId, req.user!.id))) throw new Error('NOT_A_REFEREE');
    res.json(await tournamentService.listMarkTable(clubId, asString(req.params.id)));
  } catch (err) { handleError(err, res, next); }
});

router.get('/:slug/me/referee/tournaments/:id/mark-table/log', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id: clubId } = await ensureActiveMembership(asString(req.params.slug), req.user!.id);
    if (!(await tournamentService.resolveReferee(clubId, req.user!.id))) throw new Error('NOT_A_REFEREE');
    res.json(await tournamentService.listMarkTableLog(clubId, asString(req.params.id)));
  } catch (err) { handleError(err, res, next); }
});

router.post('/:slug/me/referee/tournaments/:id/registrations/:regId/presence', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id: clubId } = await ensureActiveMembership(asString(req.params.slug), req.user!.id);
    if (!(await tournamentService.resolveReferee(clubId, req.user!.id))) throw new Error('NOT_A_REFEREE');
    const side = asString(req.body?.side); const presence = asString(req.body?.presence);
    if (!['CAPTAIN', 'PARTNER'].includes(side) || !['UNSEEN', 'PRESENT', 'ABSENT'].includes(presence)) throw new Error('VALIDATION_ERROR');
    await tournamentService.setPresence(clubId, asString(req.params.id), asString(req.params.regId), side as 'CAPTAIN' | 'PARTNER', presence as never, req.user!.id);
    res.json({ ok: true });
  } catch (err) { handleError(err, res, next); }
});

router.post('/:slug/me/referee/tournaments/:id/registrations/:regId/forfeit', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id: clubId } = await ensureActiveMembership(asString(req.params.slug), req.user!.id);
    if (!(await tournamentService.resolveReferee(clubId, req.user!.id))) throw new Error('NOT_A_REFEREE');
    const side = asString(req.body?.side);
    if (!['CAPTAIN', 'PARTNER'].includes(side)) throw new Error('VALIDATION_ERROR');
    res.json(await tournamentService.declareForfeit(clubId, asString(req.params.id), asString(req.params.regId), side as 'CAPTAIN' | 'PARTNER', req.user!.id));
  } catch (err) { handleError(err, res, next); }
});

router.post('/:slug/me/referee/tournaments/:id/registrations/:regId/replace', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id: clubId } = await ensureActiveMembership(asString(req.params.slug), req.user!.id);
    if (!(await tournamentService.resolveReferee(clubId, req.user!.id))) throw new Error('NOT_A_REFEREE');
    const side = asString(req.body?.side); const newUserId = asString(req.body?.newUserId);
    if (!['CAPTAIN', 'PARTNER'].includes(side) || !newUserId) throw new Error('VALIDATION_ERROR');
    await tournamentService.replacePlayer(clubId, asString(req.params.id), asString(req.params.regId), side as 'CAPTAIN' | 'PARTNER', newUserId, req.user!.id);
    res.json({ ok: true });
  } catch (err) { handleError(err, res, next); }
});

router.post('/:slug/me/referee/tournaments/:id/bench', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id: clubId } = await ensureActiveMembership(asString(req.params.slug), req.user!.id);
    if (!(await tournamentService.resolveReferee(clubId, req.user!.id))) throw new Error('NOT_A_REFEREE');
    const userId = asString(req.body?.userId);
    if (!userId) throw new Error('VALIDATION_ERROR');
    await tournamentService.addToBench(clubId, asString(req.params.id), userId, req.user!.id);
    res.status(201).json({ ok: true });
  } catch (err) { handleError(err, res, next); }
});

router.delete('/:slug/me/referee/tournaments/:id/bench/:userId', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id: clubId } = await ensureActiveMembership(asString(req.params.slug), req.user!.id);
    if (!(await tournamentService.resolveReferee(clubId, req.user!.id))) throw new Error('NOT_A_REFEREE');
    await tournamentService.removeFromBench(clubId, asString(req.params.id), asString(req.params.userId), req.user!.id);
    res.json({ ok: true });
  } catch (err) { handleError(err, res, next); }
});

router.post('/:slug/me/referee/tournaments/:id/bench/pair', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id: clubId } = await ensureActiveMembership(asString(req.params.slug), req.user!.id);
    if (!(await tournamentService.resolveReferee(clubId, req.user!.id))) throw new Error('NOT_A_REFEREE');
    const userAId = asString(req.body?.userAId); const userBId = asString(req.body?.userBId);
    if (!userAId || !userBId) throw new Error('VALIDATION_ERROR');
    res.status(201).json(await tournamentService.pairFromBench(clubId, asString(req.params.id), userAId, userBId, req.user!.id));
  } catch (err) { handleError(err, res, next); }
});

router.post('/:slug/me/referee/tournaments/:id/registrations', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id: clubId } = await ensureActiveMembership(asString(req.params.slug), req.user!.id);
    if (!(await tournamentService.resolveReferee(clubId, req.user!.id))) throw new Error('NOT_A_REFEREE');
    const captainUserId = asString(req.body?.captainUserId); const partnerUserId = asString(req.body?.partnerUserId);
    if (!captainUserId || !partnerUserId) throw new Error('VALIDATION_ERROR');
    res.status(201).json(await tournamentService.addLateRegistration(clubId, asString(req.params.id), captainUserId, partnerUserId, req.user!.id));
  } catch (err) { handleError(err, res, next); }
});
```

⚠️ Vérifier que `VALIDATION_ERROR: 400` est déjà dans `ERROR_STATUS` de `clubs.ts` (probable, très utilisé) — sinon l'ajouter.

- [ ] **Step 4: Vert** — `node node_modules/jest/bin/jest.js src/routes/__tests__/clubs.referee.routes.test.ts`, `tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/clubs.ts backend/src/routes/__tests__/clubs.referee.routes.test.ts
git commit -m "feat(tournois): routes J/A table de marque"
```

---

### Task 9: Routes staff

**Files:**
- Modify: `backend/src/routes/admin.ts`
- Test: `backend/src/routes/__tests__/admin.tournaments.routes.test.ts` (ou fichier admin-tournois existant)

- [ ] **Step 1: Tests** — miroir de Task 8, sans le gate `resolveReferee` (le routeur admin gate STAFF globalement). Vérifier ce fait par **mutation** : commenter temporairement `router.use(authMiddleware, requireClubMember('STAFF'))` en tête du fichier lors du run de test isolé n'est PAS praticable en TDD normal — à la place, ajouter un test qui vérifie qu'un rôle `STAFF` (le plus bas) accède avec succès (le gate global suffit, pas de test de rejet supplémentaire nécessaire ici puisque déjà couvert par `admin.role-gates.routes.test.ts` pour le routeur entier).

```ts
describe('table de marque — routes staff', () => {
  it('GET mark-table — délègue au service', async () => {
    (tournamentService.listMarkTable as jest.Mock).mockResolvedValue({ registrations: [] });
    const res = await request(app).get('/api/clubs/club-1/admin/tournaments/t1/mark-table');
    expect(res.status).toBe(200);
    expect(tournamentService.listMarkTable).toHaveBeenCalledWith('club-1', 't1');
  });

  it('POST forfeit — délègue avec actorUserId', async () => {
    (tournamentService.declareForfeit as jest.Mock).mockResolvedValue({ id: 'r1' });
    const res = await request(app).post('/api/clubs/club-1/admin/tournaments/t1/registrations/r1/forfeit').send({ side: 'PARTNER' });
    expect(res.status).toBe(200);
    expect(tournamentService.declareForfeit).toHaveBeenCalledWith('club-1', 't1', 'r1', 'PARTNER', expect.any(String));
  });

  it('POST mark-table/registrations — tardif', async () => {
    (tournamentService.addLateRegistration as jest.Mock).mockResolvedValue({ id: 'r-new' });
    const res = await request(app).post('/api/clubs/club-1/admin/tournaments/t1/registrations').send({ captainUserId: 'a', partnerUserId: 'b' });
    expect(res.status).toBe(201);
  });
});
```

> Adapter aux mocks/harnais réels du fichier admin choisi (auth simulée, `req.membership`).

- [ ] **Step 2: Rouge.**

- [ ] **Step 3: Implémenter** — après le bloc `--- Tournois ---` existant dans `admin.ts` :

```ts
// --- Table de marque (staff) — même cœur que les routes J/A, gate STAFF hérité du routeur ---

router.get('/tournaments/:id/mark-table', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await tournamentService.listMarkTable(req.membership!.clubId, asString(req.params.id))); } catch (e) { handleError(e, res, next); }
});
router.get('/tournaments/:id/mark-table/log', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await tournamentService.listMarkTableLog(req.membership!.clubId, asString(req.params.id))); } catch (e) { handleError(e, res, next); }
});
router.post('/tournaments/:id/registrations/:regId/presence', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const side = asString(req.body?.side); const presence = asString(req.body?.presence);
    if (!['CAPTAIN', 'PARTNER'].includes(side) || !['UNSEEN', 'PRESENT', 'ABSENT'].includes(presence)) return void res.status(400).json({ error: 'VALIDATION_ERROR' });
    await tournamentService.setPresence(req.membership!.clubId, asString(req.params.id), asString(req.params.regId), side as 'CAPTAIN' | 'PARTNER', presence as never, req.user!.id);
    res.json({ ok: true });
  } catch (e) { handleError(e, res, next); }
});
router.post('/tournaments/:id/registrations/:regId/forfeit', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const side = asString(req.body?.side);
    if (!['CAPTAIN', 'PARTNER'].includes(side)) return void res.status(400).json({ error: 'VALIDATION_ERROR' });
    res.json(await tournamentService.declareForfeit(req.membership!.clubId, asString(req.params.id), asString(req.params.regId), side as 'CAPTAIN' | 'PARTNER', req.user!.id));
  } catch (e) { handleError(e, res, next); }
});
router.post('/tournaments/:id/registrations/:regId/replace', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const side = asString(req.body?.side); const newUserId = asString(req.body?.newUserId);
    if (!['CAPTAIN', 'PARTNER'].includes(side) || !newUserId) return void res.status(400).json({ error: 'VALIDATION_ERROR' });
    await tournamentService.replacePlayer(req.membership!.clubId, asString(req.params.id), asString(req.params.regId), side as 'CAPTAIN' | 'PARTNER', newUserId, req.user!.id);
    res.json({ ok: true });
  } catch (e) { handleError(e, res, next); }
});
router.post('/tournaments/:id/bench', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = asString(req.body?.userId);
    if (!userId) return void res.status(400).json({ error: 'VALIDATION_ERROR' });
    await tournamentService.addToBench(req.membership!.clubId, asString(req.params.id), userId, req.user!.id);
    res.status(201).json({ ok: true });
  } catch (e) { handleError(e, res, next); }
});
router.delete('/tournaments/:id/bench/:userId', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    await tournamentService.removeFromBench(req.membership!.clubId, asString(req.params.id), asString(req.params.userId), req.user!.id);
    res.json({ ok: true });
  } catch (e) { handleError(e, res, next); }
});
router.post('/tournaments/:id/bench/pair', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const userAId = asString(req.body?.userAId); const userBId = asString(req.body?.userBId);
    if (!userAId || !userBId) return void res.status(400).json({ error: 'VALIDATION_ERROR' });
    res.status(201).json(await tournamentService.pairFromBench(req.membership!.clubId, asString(req.params.id), userAId, userBId, req.user!.id));
  } catch (e) { handleError(e, res, next); }
});
router.post('/tournaments/:id/registrations', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const captainUserId = asString(req.body?.captainUserId); const partnerUserId = asString(req.body?.partnerUserId);
    if (!captainUserId || !partnerUserId) return void res.status(400).json({ error: 'VALIDATION_ERROR' });
    res.status(201).json(await tournamentService.addLateRegistration(req.membership!.clubId, asString(req.params.id), captainUserId, partnerUserId, req.user!.id));
  } catch (e) { handleError(e, res, next); }
});
```

Ajouter dans `ERROR_STATUS` d'`admin.ts` (mêmes codes que Task 8, vérifier absence de doublon) :
```ts
  NOT_A_MEMBER:          403,
  ALREADY_ON_BENCH:      409,
  BENCH_ENTRY_NOT_FOUND: 404,
  TOURNAMENT_NOT_OPEN:   409,
  SEX_REQUIRED:          400,
  GENDER_MISMATCH:       400,
```
(`ALREADY_REGISTERED`, `REGISTRATION_NOT_FOUND`, `USER_NOT_FOUND`, `VALIDATION_ERROR` existent déjà dans ce fichier.)

- [ ] **Step 4: Vert + non-régression** — suite backend complète : `node node_modules/jest/bin/jest.js` depuis `backend/`. Comparer au nombre de suites/tests connu **avant** ce lot (mesurer via `git stash` si doute — ne jamais faire confiance à un chiffre de baseline annoncé sans le revérifier).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/admin.ts backend/src/routes/__tests__/*.test.ts
git commit -m "feat(tournois): routes staff table de marque"
```

---

### Task 10: Client API frontend

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Types** — à côté du bloc `// --- Espace juge-arbitre (Arbitrage) ---` :

```ts
export type MarkTablePresence = 'UNSEEN' | 'PRESENT' | 'ABSENT';

export interface MarkTablePlayer {
  userId: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  phone: string | null;
  membershipNo: string | null;
  presence: MarkTablePresence;
}

export interface MarkTableRegistration {
  id: string;
  status: string;
  paymentStatus: string;
  waitlistPosition: number | null;
  captain: MarkTablePlayer;
  partner: MarkTablePlayer;
}

export interface MarkTableBenchEntry {
  userId: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  phone: string | null;
  membershipNo: string | null;
  source: 'FORFEIT' | 'WALK_IN';
}

export interface MarkTableLogEntry {
  id: string;
  kind: string;
  data: Record<string, unknown>;
  actorName: string | null;
  createdAt: string;
}

export interface MarkTableView {
  tournament: { id: string; name: string; category: string; gender: string; maxTeams: number | null };
  registrations: MarkTableRegistration[];
  bench: MarkTableBenchEntry[];
  recentLog: MarkTableLogEntry[];
  pointedCount: number;
  totalSlots: number;
  waitlistCount: number;
}

export type MarkTableSide = 'CAPTAIN' | 'PARTNER';
```

- [ ] **Step 2: Méthodes** — deux blocs symétriques. J/A, à côté des méthodes referee existantes :

```ts
  getRefereeMarkTable: (slug: string, tournamentId: string, token: string) =>
    request<MarkTableView>(`/api/clubs/${slug}/me/referee/tournaments/${tournamentId}/mark-table`, {}, token),
  getRefereeMarkTableLog: (slug: string, tournamentId: string, token: string) =>
    request<MarkTableLogEntry[]>(`/api/clubs/${slug}/me/referee/tournaments/${tournamentId}/mark-table/log`, {}, token),
  refereeSetPresence: (slug: string, tournamentId: string, regId: string, side: MarkTableSide, presence: MarkTablePresence, token: string) =>
    request<{ ok: true }>(`/api/clubs/${slug}/me/referee/tournaments/${tournamentId}/registrations/${regId}/presence`, { method: 'POST', body: JSON.stringify({ side, presence }) }, token),
  refereeForfeit: (slug: string, tournamentId: string, regId: string, side: MarkTableSide, token: string) =>
    request<{ id: string }>(`/api/clubs/${slug}/me/referee/tournaments/${tournamentId}/registrations/${regId}/forfeit`, { method: 'POST', body: JSON.stringify({ side }) }, token),
  refereeReplacePlayer: (slug: string, tournamentId: string, regId: string, side: MarkTableSide, newUserId: string, token: string) =>
    request<{ ok: true }>(`/api/clubs/${slug}/me/referee/tournaments/${tournamentId}/registrations/${regId}/replace`, { method: 'POST', body: JSON.stringify({ side, newUserId }) }, token),
  refereeAddToBench: (slug: string, tournamentId: string, userId: string, token: string) =>
    request<{ ok: true }>(`/api/clubs/${slug}/me/referee/tournaments/${tournamentId}/bench`, { method: 'POST', body: JSON.stringify({ userId }) }, token),
  refereeRemoveFromBench: (slug: string, tournamentId: string, userId: string, token: string) =>
    request<{ ok: true }>(`/api/clubs/${slug}/me/referee/tournaments/${tournamentId}/bench/${userId}`, { method: 'DELETE' }, token),
  refereePairFromBench: (slug: string, tournamentId: string, userAId: string, userBId: string, token: string) =>
    request<{ id: string }>(`/api/clubs/${slug}/me/referee/tournaments/${tournamentId}/bench/pair`, { method: 'POST', body: JSON.stringify({ userAId, userBId }) }, token),
  refereeAddLateRegistration: (slug: string, tournamentId: string, captainUserId: string, partnerUserId: string, token: string) =>
    request<{ id: string }>(`/api/clubs/${slug}/me/referee/tournaments/${tournamentId}/registrations`, { method: 'POST', body: JSON.stringify({ captainUserId, partnerUserId }) }, token),
```

Staff, à côté des méthodes admin tournois :

```ts
  adminGetMarkTable: (clubId: string, tournamentId: string, token: string) =>
    request<MarkTableView>(`/api/clubs/${clubId}/admin/tournaments/${tournamentId}/mark-table`, {}, token),
  adminGetMarkTableLog: (clubId: string, tournamentId: string, token: string) =>
    request<MarkTableLogEntry[]>(`/api/clubs/${clubId}/admin/tournaments/${tournamentId}/mark-table/log`, {}, token),
  adminSetPresence: (clubId: string, tournamentId: string, regId: string, side: MarkTableSide, presence: MarkTablePresence, token: string) =>
    request<{ ok: true }>(`/api/clubs/${clubId}/admin/tournaments/${tournamentId}/registrations/${regId}/presence`, { method: 'POST', body: JSON.stringify({ side, presence }) }, token),
  adminForfeit: (clubId: string, tournamentId: string, regId: string, side: MarkTableSide, token: string) =>
    request<{ id: string }>(`/api/clubs/${clubId}/admin/tournaments/${tournamentId}/registrations/${regId}/forfeit`, { method: 'POST', body: JSON.stringify({ side }) }, token),
  adminReplacePlayer: (clubId: string, tournamentId: string, regId: string, side: MarkTableSide, newUserId: string, token: string) =>
    request<{ ok: true }>(`/api/clubs/${clubId}/admin/tournaments/${tournamentId}/registrations/${regId}/replace`, { method: 'POST', body: JSON.stringify({ side, newUserId }) }, token),
  adminAddToBench: (clubId: string, tournamentId: string, userId: string, token: string) =>
    request<{ ok: true }>(`/api/clubs/${clubId}/admin/tournaments/${tournamentId}/bench`, { method: 'POST', body: JSON.stringify({ userId }) }, token),
  adminRemoveFromBench: (clubId: string, tournamentId: string, userId: string, token: string) =>
    request<{ ok: true }>(`/api/clubs/${clubId}/admin/tournaments/${tournamentId}/bench/${userId}`, { method: 'DELETE' }, token),
  adminPairFromBench: (clubId: string, tournamentId: string, userAId: string, userBId: string, token: string) =>
    request<{ id: string }>(`/api/clubs/${clubId}/admin/tournaments/${tournamentId}/bench/pair`, { method: 'POST', body: JSON.stringify({ userAId, userBId }) }, token),
  adminAddLateRegistration: (clubId: string, tournamentId: string, captainUserId: string, partnerUserId: string, token: string) =>
    request<{ id: string }>(`/api/clubs/${clubId}/admin/tournaments/${tournamentId}/registrations`, { method: 'POST', body: JSON.stringify({ captainUserId, partnerUserId }) }, token),
  adminMarkTablePromote: (clubId: string, tournamentId: string, regId: string, token: string) =>
    request<{ id: string }>(`/api/clubs/${clubId}/admin/tournaments/${tournamentId}/registrations/${regId}`, { method: 'PATCH' }, token),
```

> ⚠️ `adminMarkTablePromote` réutilise la route `PATCH /tournaments/:id/registrations/:regId` **existante** (déjà journalisée serveur via `markTablePromote` — non, ATTENTION : cette route existante appelle `adminPromoteRegistration` directement, PAS `markTablePromote`. Corriger côté backend (Task 3 a créé `markTablePromote`/`markTableRemove` mais ne les a pas câblés sur une route) : **ajouter deux nouvelles routes dédiées** `POST /tournaments/:id/mark-table/registrations/:regId/promote` et `DELETE /tournaments/:id/mark-table/registrations/:regId` dans `admin.ts` (Task 9), et leurs équivalents J/A dans `clubs.ts` (Task 8), plutôt que de réutiliser les routes non-journalisées existantes. **Revenir sur Tasks 8-9 pour ajouter ces 2×2 routes manquantes avant cette Task 10** (ou les ajouter maintenant si Tasks 8-9 sont déjà committées — un commit correctif est acceptable).

- [ ] **Step 3: Corriger Tasks 8-9** — ajouter dans `clubs.ts` :
```ts
router.post('/:slug/me/referee/tournaments/:id/mark-table/registrations/:regId/promote', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id: clubId } = await ensureActiveMembership(asString(req.params.slug), req.user!.id);
    if (!(await tournamentService.resolveReferee(clubId, req.user!.id))) throw new Error('NOT_A_REFEREE');
    res.json(await tournamentService.markTablePromote(clubId, asString(req.params.id), asString(req.params.regId), req.user!.id));
  } catch (err) { handleError(err, res, next); }
});
router.delete('/:slug/me/referee/tournaments/:id/mark-table/registrations/:regId', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id: clubId } = await ensureActiveMembership(asString(req.params.slug), req.user!.id);
    if (!(await tournamentService.resolveReferee(clubId, req.user!.id))) throw new Error('NOT_A_REFEREE');
    res.json(await tournamentService.markTableRemove(clubId, asString(req.params.id), asString(req.params.regId), req.user!.id));
  } catch (err) { handleError(err, res, next); }
});
```
et dans `admin.ts` :
```ts
router.post('/tournaments/:id/mark-table/registrations/:regId/promote', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await tournamentService.markTablePromote(req.membership!.clubId, asString(req.params.id), asString(req.params.regId), req.user!.id)); } catch (e) { handleError(e, res, next); }
});
router.delete('/tournaments/:id/mark-table/registrations/:regId', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await tournamentService.markTableRemove(req.membership!.clubId, asString(req.params.id), asString(req.params.regId), req.user!.id)); } catch (e) { handleError(e, res, next); }
});
```
Puis corriger `adminMarkTablePromote`/ajouter `adminMarkTableRemove`/`refereeMarkTablePromote`/`refereeMarkTableRemove` dans `api.ts` pour pointer vers ces nouvelles routes `/mark-table/registrations/:regId[/promote]`.

- [ ] **Step 4: Vérifier** — `node node_modules/typescript/bin/tsc --noEmit` depuis `frontend/` (baseline connue : erreurs pré-existantes non liées, à ignorer si présentes — comparer avant/après ce diff).

- [ ] **Step 5: Committer les 3 fichiers ensemble** (le correctif backend + le client) :

```bash
git add backend/src/routes/clubs.ts backend/src/routes/admin.ts frontend/lib/api.ts
git commit -m "feat(tournois): routes promote/remove journalisees + client API table de marque"
```

---

### Task 11: Helpers purs frontend

**Files:**
- Create: `frontend/lib/markTable.ts`
- Test: `frontend/__tests__/markTable.test.ts`

- [ ] **Step 1: Tests**

```ts
import { nextPresence, presenceGlyph, isReplaceableSlot, benchSelectionNext, MARK_TABLE_ERRORS } from '@/lib/markTable';

describe('markTable helpers', () => {
  it('nextPresence cycle ○→✅→✕→○', () => {
    expect(nextPresence('UNSEEN')).toBe('PRESENT');
    expect(nextPresence('PRESENT')).toBe('ABSENT');
    expect(nextPresence('ABSENT')).toBe('UNSEEN');
  });

  it('presenceGlyph', () => {
    expect(presenceGlyph('UNSEEN')).toBe('○');
    expect(presenceGlyph('PRESENT')).toBe('✅');
    expect(presenceGlyph('ABSENT')).toBe('✕');
  });

  it('isReplaceableSlot : seul ABSENT est une cible', () => {
    expect(isReplaceableSlot('ABSENT')).toBe(true);
    expect(isReplaceableSlot('PRESENT')).toBe(false);
    expect(isReplaceableSlot('UNSEEN')).toBe(false);
  });

  it('benchSelectionNext : 0→1→2, re-tap déselectionne, 3e tap ignoré', () => {
    expect(benchSelectionNext([], 'a')).toEqual(['a']);
    expect(benchSelectionNext(['a'], 'b')).toEqual(['a', 'b']);
    expect(benchSelectionNext(['a'], 'a')).toEqual([]);
    expect(benchSelectionNext(['a', 'b'], 'c')).toEqual(['a', 'b']); // 2 déjà sélectionnés : ignoré
    expect(benchSelectionNext(['a', 'b'], 'a')).toEqual(['b']); // déselectionner l'un des deux reste possible
  });
});
```

- [ ] **Step 2: Rouge** — module introuvable.

- [ ] **Step 3: Implémenter**

```ts
import type { MarkTablePresence } from './api';

export function nextPresence(p: MarkTablePresence): MarkTablePresence {
  return p === 'UNSEEN' ? 'PRESENT' : p === 'PRESENT' ? 'ABSENT' : 'UNSEEN';
}

export function presenceGlyph(p: MarkTablePresence): string {
  return p === 'PRESENT' ? '✅' : p === 'ABSENT' ? '✕' : '○';
}

/** Seul un joueur pointé ABSENT est une cible de remplacement (le J/A n'écarte pas un présent par erreur). */
export function isReplaceableSlot(p: MarkTablePresence): boolean {
  return p === 'ABSENT';
}

/**
 * File de sélection du banc (0 à 2 userId) : tap = ajoute si < 2 ou déjà présent (toggle),
 * ignore un 3e joueur tant que 2 sont déjà sélectionnés (il faut d'abord en retirer un).
 */
export function benchSelectionNext(current: string[], userId: string): string[] {
  if (current.includes(userId)) return current.filter((id) => id !== userId);
  if (current.length >= 2) return current;
  return [...current, userId];
}

export const MARK_TABLE_ERRORS: Record<string, string> = {
  NOT_A_MEMBER: "Ce joueur n'est pas membre du club.",
  ALREADY_REGISTERED: 'Ce joueur est déjà inscrit à ce tournoi.',
  ALREADY_ON_BENCH: 'Ce joueur est déjà sur le banc.',
  BENCH_ENTRY_NOT_FOUND: 'Introuvable sur le banc.',
  REGISTRATION_NOT_FOUND: 'Inscription introuvable.',
  SEX_REQUIRED: 'Ce membre doit renseigner son sexe dans son profil avant de jouer un tableau genré.',
  GENDER_MISMATCH: 'Cette composition ne respecte pas le tableau (genre).',
  TOURNAMENT_NOT_OPEN: "Ce tournoi n'accepte plus d'inscriptions.",
  TOURNAMENT_NOT_YOURS: "Vous n'êtes plus juge-arbitre de ce tournoi.",
  TOURNAMENT_NOT_FOUND: 'Ce tournoi est introuvable.',
  NOT_A_REFEREE: 'Accès réservé aux juges-arbitres du club.',
};

export function markTableErrorLabel(e: unknown): string {
  const msg = (e as Error).message;
  return MARK_TABLE_ERRORS[msg] ?? msg;
}
```

- [ ] **Step 4: Vert** — `node node_modules/jest/bin/jest.js __tests__/markTable.test.ts` depuis `frontend/`.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/markTable.ts frontend/__tests__/markTable.test.ts
git commit -m "feat(tournois): helpers purs table de marque"
```

---

### Task 12: `MarkTableTile` + `BenchBar` (présentation)

**Files:**
- Create: `frontend/components/tournament/MarkTableTile.tsx`
- Create: `frontend/components/tournament/BenchBar.tsx`
- Test: `frontend/__tests__/MarkTableTile.test.tsx`, `frontend/__tests__/BenchBar.test.tsx`

- [ ] **Step 1: Tests `MarkTableTile`**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MarkTableTile } from '@/components/tournament/MarkTableTile';

const reg = {
  id: 'r1', status: 'CONFIRMED', paymentStatus: 'NONE', waitlistPosition: null,
  captain: { userId: 'c1', firstName: 'Bernard', lastName: 'X', avatarUrl: null, phone: null, membershipNo: null, presence: 'ABSENT' as const },
  partner: { userId: 'p1', firstName: 'Andre', lastName: 'Y', avatarUrl: null, phone: null, membershipNo: '999', presence: 'PRESENT' as const },
};

it('tap sur un joueur cycle la présence', async () => {
  const onTapPlayer = jest.fn();
  render(<MarkTableTile reg={reg} replaceHighlight={null} onTapPlayer={onTapPlayer} onTapReplaceTarget={jest.fn()} onOpenMenu={jest.fn()} />);
  await userEvent.click(screen.getByText('Bernard X'));
  expect(onTapPlayer).toHaveBeenCalledWith('r1', 'CAPTAIN');
});

it('un slot ABSENT devient une cible de remplacement quand replaceHighlight est actif', async () => {
  const onTapReplaceTarget = jest.fn();
  render(<MarkTableTile reg={reg} replaceHighlight="u9" onTapPlayer={jest.fn()} onTapReplaceTarget={onTapReplaceTarget} onOpenMenu={jest.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: /mettre .* ici/i }));
  expect(onTapReplaceTarget).toHaveBeenCalledWith('r1', 'CAPTAIN');
});

it('un slot PRESENT n’est jamais une cible même en mode remplacement', () => {
  render(<MarkTableTile reg={reg} replaceHighlight="u9" onTapPlayer={jest.fn()} onTapReplaceTarget={jest.fn()} onOpenMenu={jest.fn()} />);
  expect(screen.queryByRole('button', { name: /mettre .* dans andre/i })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Rouge.**

- [ ] **Step 3: Implémenter `MarkTableTile.tsx`**

```tsx
'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';
import { presenceGlyph, isReplaceableSlot } from '@/lib/markTable';
import type { MarkTableRegistration, MarkTableSide } from '@/lib/api';

/**
 * Une tuile binôme de la grille. Tap sur un nom = pointage (cycle). Si `replaceHighlight`
 * (userId du banc sélectionné) est posé, tout côté ABSENT devient un bouton « Mettre X ici »
 * qui déclenche le remplacement — indépendant d'un forfait préalable (cf. plan, décision 2).
 */
export function MarkTableTile({
  reg, replaceHighlight, replaceTargetName, onTapPlayer, onTapReplaceTarget, onOpenMenu,
}: {
  reg: MarkTableRegistration;
  replaceHighlight: string | null;
  replaceTargetName?: string;
  onTapPlayer: (regId: string, side: MarkTableSide) => void;
  onTapReplaceTarget: (regId: string, side: MarkTableSide) => void;
  onOpenMenu: (regId: string, side: MarkTableSide) => void;
}) {
  const { th } = useTheme();
  const bothPresent = reg.captain.presence === 'PRESENT' && reg.partner.presence === 'PRESENT';
  const anyAbsent = reg.captain.presence === 'ABSENT' || reg.partner.presence === 'ABSENT';
  const border = bothPresent ? ACCENTS.emerald : anyAbsent ? ACCENTS.coral : th.line;

  const row = (player: MarkTableRegistration['captain'], side: MarkTableSide) => {
    const isTarget = replaceHighlight != null && isReplaceableSlot(player.presence);
    if (isTarget) {
      return (
        <button key={side} onClick={() => onTapReplaceTarget(reg.id, side)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
            border: `1.5px dashed ${ACCENTS.blue}`, borderRadius: 8, padding: '4px 6px',
            background: th.mode === 'floodlit' ? `${ACCENTS.blue}1f` : `${ACCENTS.blue}22`,
            cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, color: th.accent,
          }}>
          Mettre {replaceTargetName ?? '…'} ici
        </button>
      );
    }
    return (
      <div key={side} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={() => onTapPlayer(reg.id, side)} style={{ display: 'flex', alignItems: 'center', gap: 6, border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, color: player.presence === 'ABSENT' ? ACCENTS.coral : th.text }}>
          <span aria-hidden="true">{presenceGlyph(player.presence)}</span>
          {player.firstName} {player.lastName}
        </button>
        <button aria-label={`Options pour ${player.firstName} ${player.lastName}`} onClick={() => onOpenMenu(reg.id, side)}
          style={{ marginLeft: 'auto', border: 'none', background: 'transparent', cursor: 'pointer', color: th.textFaint, fontSize: 14, padding: '2px 6px' }}>⋮</button>
      </div>
    );
  };

  return (
    <div style={{ background: th.surface, borderRadius: 12, padding: '9px 10px', boxShadow: `inset 0 0 0 1.5px ${border}`, display: 'flex', flexDirection: 'column', gap: 5 }}>
      {row(reg.captain, 'CAPTAIN')}
      {row(reg.partner, 'PARTNER')}
    </div>
  );
}
```

- [ ] **Step 4: Tests `BenchBar`**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BenchBar } from '@/components/tournament/BenchBar';

const bench = [
  { userId: 'u1', firstName: 'Kevin', lastName: 'Vasseur', avatarUrl: null, phone: null, membershipNo: null, source: 'WALK_IN' as const },
  { userId: 'u2', firstName: 'Sarah', lastName: 'Marchand', avatarUrl: null, phone: null, membershipNo: '111', source: 'FORFEIT' as const },
];

it('tap un joueur du banc le sélectionne', async () => {
  const onTap = jest.fn();
  render(<BenchBar bench={bench} selection={[]} onTapPlayer={onTap} onAddWalkIn={jest.fn()} onPair={jest.fn()} />);
  await userEvent.click(screen.getByText('Kevin Vasseur'));
  expect(onTap).toHaveBeenCalledWith('u1');
});

it('2 sélectionnés affichent le bouton Apparier', () => {
  render(<BenchBar bench={bench} selection={['u1', 'u2']} onTapPlayer={jest.fn()} onAddWalkIn={jest.fn()} onPair={jest.fn()} />);
  expect(screen.getByRole('button', { name: /apparier/i })).toBeInTheDocument();
});

it('banc vide -> message neutre, pas de crash', () => {
  render(<BenchBar bench={[]} selection={[]} onTapPlayer={jest.fn()} onAddWalkIn={jest.fn()} onPair={jest.fn()} />);
  expect(screen.getByText(/banc vide/i)).toBeInTheDocument();
});
```

- [ ] **Step 5: Implémenter `BenchBar.tsx`**

```tsx
'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { Avatar } from '@/components/ui/Avatar';
import { Btn } from '@/components/ui/atoms';
import { colorForSeed } from '@/lib/playerColors';
import type { MarkTableBenchEntry } from '@/lib/api';

export function BenchBar({ bench, selection, onTapPlayer, onAddWalkIn, onPair }: {
  bench: MarkTableBenchEntry[];
  selection: string[];
  onTapPlayer: (userId: string) => void;
  onAddWalkIn: () => void;
  onPair: () => void;
}) {
  const { th } = useTheme();
  return (
    <div style={{ position: 'sticky', bottom: 0, background: th.surface, borderRadius: '18px 18px 0 0', boxShadow: '0 -5px 20px rgba(0,0,0,.13)', padding: '10px 14px 13px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontFamily: th.fontUI, fontSize: 11, fontWeight: 800, letterSpacing: 0.8, color: th.textMute, textTransform: 'uppercase' }}>Banc</span>
        {selection.length === 1 && <span style={{ fontFamily: th.fontUI, fontSize: 11.5, color: th.accent, fontWeight: 600 }}>— touchez une place ✕ pour remplacer, ou un autre joueur pour apparier</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, overflowX: 'auto' }}>
        {bench.length === 0 && <span style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textFaint }}>Banc vide.</span>}
        {bench.map((b) => {
          const selected = selection.includes(b.userId);
          return (
            <button key={b.userId} onClick={() => onTapPlayer(b.userId)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, border: 'none', background: 'transparent', cursor: 'pointer', flexShrink: 0 }}>
              <span style={{ borderRadius: '50%', boxShadow: selected ? `0 0 0 3px ${ACCENTS.blue}55` : 'none' }}>
                <Avatar firstName={b.firstName} lastName={b.lastName} avatarUrl={b.avatarUrl} size={30} color={colorForSeed(b.userId)} />
              </span>
              <span style={{ fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 700, color: selected ? th.accent : th.textMute, whiteSpace: 'nowrap' }}>{b.firstName} {b.lastName}</span>
            </button>
          );
        })}
        <button onClick={onAddWalkIn} aria-label="Ajouter un retardataire" style={{ width: 30, height: 30, borderRadius: '50%', border: `1.5px dashed ${th.textFaint}`, background: 'transparent', color: th.textFaint, fontSize: 16, cursor: 'pointer', flexShrink: 0 }}>+</button>
        {selection.length === 2 && (
          <Btn variant="primary" onClick={onPair} style={{ marginLeft: 'auto', height: 34, fontSize: 12.5, padding: '0 14px', flexShrink: 0 }}>Apparier ✓</Btn>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Vert** — `node node_modules/jest/bin/jest.js __tests__/MarkTableTile.test.tsx __tests__/BenchBar.test.tsx`, `tsc --noEmit`.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/tournament/MarkTableTile.tsx frontend/components/tournament/BenchBar.tsx frontend/__tests__/MarkTableTile.test.tsx frontend/__tests__/BenchBar.test.tsx
git commit -m "feat(tournois): tuile + banc de la table de marque"
```

---

### Task 13: `MemberPicker` (retardataire / binôme tardif)

**Files:**
- Create: `frontend/components/tournament/MemberPicker.tsx`
- Test: `frontend/__tests__/MemberPicker.test.tsx`

- [ ] **Step 1: Test**

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemberPicker } from '@/components/tournament/MemberPicker';
import { api } from '@/lib/api';

jest.mock('@/lib/api');

it('cherche et sélectionne un membre', async () => {
  (api.searchClubMembers as jest.Mock).mockResolvedValue([{ id: 'u9', firstName: 'Kevin', lastName: 'Vasseur' }]);
  const onPick = jest.fn();
  render(<MemberPicker slug="demo" token="t" onPick={onPick} onClose={jest.fn()} />);
  await userEvent.type(screen.getByPlaceholderText(/nom/i), 'Vasseur');
  await waitFor(() => expect(screen.getByText('Kevin Vasseur')).toBeInTheDocument());
  await userEvent.click(screen.getByText('Kevin Vasseur'));
  expect(onPick).toHaveBeenCalledWith('u9', 'Kevin Vasseur');
});

it('échec réseau -> message, pas de liste vide muette', async () => {
  (api.searchClubMembers as jest.Mock).mockRejectedValue(new Error('fail'));
  render(<MemberPicker slug="demo" token="t" onPick={jest.fn()} onClose={jest.fn()} />);
  await userEvent.type(screen.getByPlaceholderText(/nom/i), 'x');
  await waitFor(() => expect(screen.getByText(/indisponible/i)).toBeInTheDocument());
});
```

- [ ] **Step 2: Rouge.**

- [ ] **Step 3: Implémenter**

```tsx
'use client';
import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';

/** Sélecteur d'un membre du club par recherche (annuaire existant, réservé aux membres actifs). */
export function MemberPicker({ slug, token, onPick, onClose }: {
  slug: string;
  token: string;
  onPick: (userId: string, name: string) => void;
  onClose: () => void;
}) {
  const { th } = useTheme();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ id: string; firstName: string; lastName: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      try {
        setError(null);
        const rows = await api.searchClubMembers(slug, q, token);
        if (alive) setResults(rows);
      } catch {
        if (alive) setError('Recherche indisponible, réessayez.');
      }
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [q, slug, token]);

  return (
    <div role="dialog" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 60 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: th.bg, borderRadius: '18px 18px 0 0', padding: 16, width: '100%', maxWidth: 480, maxHeight: '70vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <input autoFocus placeholder="Chercher un nom…" value={q} onChange={(e) => setQ(e.target.value)}
          style={{ fontFamily: th.fontUI, fontSize: 15, padding: '10px 12px', borderRadius: 10, border: `1px solid ${th.line}`, background: th.surface, color: th.text }} />
        {error && <span style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>{error}</span>}
        {results.map((r) => (
          <button key={r.id} onClick={() => onPick(r.id, `${r.firstName} ${r.lastName}`.trim())}
            style={{ textAlign: 'left', border: 'none', background: th.surface, borderRadius: 10, padding: '10px 12px', fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, color: th.text, cursor: 'pointer' }}>
            {r.firstName} {r.lastName}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Vert** + `tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/tournament/MemberPicker.tsx frontend/__tests__/MemberPicker.test.tsx
git commit -m "feat(tournois): picker de membre (table de marque)"
```

---

### Task 14: `MarkTable` — orchestrateur + gestes

**Files:**
- Create: `frontend/components/tournament/MarkTable.tsx`
- Test: `frontend/__tests__/MarkTable.test.tsx`

- [ ] **Step 1: Tests** — un jeu de mocks `mode='referee'` couvrant le cycle complet.

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MarkTable } from '@/components/tournament/MarkTable';
import { api } from '@/lib/api';

jest.mock('@/lib/api');

const view = {
  tournament: { id: 't1', name: 'Grand Prix', category: 'P500', gender: 'MEN', maxTeams: 12 },
  registrations: [{
    id: 'r1', status: 'CONFIRMED', paymentStatus: 'NONE', waitlistPosition: null,
    captain: { userId: 'c1', firstName: 'Bernard', lastName: 'X', avatarUrl: null, phone: null, membershipNo: null, presence: 'ABSENT' },
    partner: { userId: 'p1', firstName: 'Andre', lastName: 'Y', avatarUrl: null, phone: null, membershipNo: '999', presence: 'PRESENT' },
  }],
  bench: [{ userId: 'u9', firstName: 'Kevin', lastName: 'Vasseur', avatarUrl: null, phone: null, membershipNo: null, source: 'WALK_IN' }],
  recentLog: [], pointedCount: 1, totalSlots: 2, waitlistCount: 0,
};

function setup() {
  (api.getRefereeMarkTable as jest.Mock).mockResolvedValue(view);
  render(<MarkTable mode="referee" slug="demo" tournamentId="t1" token="t" />);
}

it('affiche les chips vivantes', async () => {
  setup();
  expect(await screen.findByText(/1\s*\/\s*2 pointés/i)).toBeInTheDocument();
});

it('tap un joueur cycle la présence (optimiste + appel serveur)', async () => {
  (api.refereeSetPresence as jest.Mock).mockResolvedValue({ ok: true });
  setup();
  await userEvent.click(await screen.findByText('Bernard X'));
  await waitFor(() => expect(api.refereeSetPresence).toHaveBeenCalledWith('demo', 't1', 'r1', 'CAPTAIN', 'UNSEEN', 't'));
});

it('geste banc -> place : sélectionner Vasseur puis taper le slot ABSENT de Bernard remplace', async () => {
  (api.refereeReplacePlayer as jest.Mock).mockResolvedValue({ ok: true });
  setup();
  await userEvent.click(await screen.findByText('Kevin Vasseur'));
  const target = await screen.findByRole('button', { name: /mettre kevin/i });
  await userEvent.click(target);
  await waitFor(() => expect(api.refereeReplacePlayer).toHaveBeenCalledWith('demo', 't1', 'r1', 'CAPTAIN', 'u9', 't'));
});

it('erreur mappée en français', async () => {
  (api.refereeSetPresence as jest.Mock).mockRejectedValue(new Error('TOURNAMENT_NOT_YOURS'));
  setup();
  await userEvent.click(await screen.findByText('Bernard X'));
  expect(await screen.findByText(/n'êtes plus juge-arbitre/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Rouge.**

- [ ] **Step 3: Implémenter**

```tsx
'use client';
import { useState, useEffect, useCallback } from 'react';
import { api, MarkTableView, MarkTableSide } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { benchSelectionNext, markTableErrorLabel } from '@/lib/markTable';
import { MarkTableTile } from './MarkTableTile';
import { BenchBar } from './BenchBar';
import { MemberPicker } from './MemberPicker';
import { HERO_GRADIENT, HERO_INK } from '@/components/agenda/AgendaHero';

type Mode = 'referee' | 'staff';

/** Sélectionne le bon jeu de méthodes api.* selon le mode (deux portes, un seul composant). */
function bindApi(mode: Mode, idOrSlug: string, token: string) {
  return mode === 'referee' ? {
    get: (tid: string) => api.getRefereeMarkTable(idOrSlug, tid, token),
    setPresence: (tid: string, r: string, s: MarkTableSide, p: 'UNSEEN' | 'PRESENT' | 'ABSENT') => api.refereeSetPresence(idOrSlug, tid, r, s, p, token),
    forfeit: (tid: string, r: string, s: MarkTableSide) => api.refereeForfeit(idOrSlug, tid, r, s, token),
    replace: (tid: string, r: string, s: MarkTableSide, u: string) => api.refereeReplacePlayer(idOrSlug, tid, r, s, u, token),
    addWalkIn: (tid: string, u: string) => api.refereeAddToBench(idOrSlug, tid, u, token),
    removeBench: (tid: string, u: string) => api.refereeRemoveFromBench(idOrSlug, tid, u, token),
    pair: (tid: string, a: string, b: string) => api.refereePairFromBench(idOrSlug, tid, a, b, token),
    addLate: (tid: string, a: string, b: string) => api.refereeAddLateRegistration(idOrSlug, tid, a, b, token),
  } : {
    get: (tid: string) => api.adminGetMarkTable(idOrSlug, tid, token),
    setPresence: (tid: string, r: string, s: MarkTableSide, p: 'UNSEEN' | 'PRESENT' | 'ABSENT') => api.adminSetPresence(idOrSlug, tid, r, s, p, token),
    forfeit: (tid: string, r: string, s: MarkTableSide) => api.adminForfeit(idOrSlug, tid, r, s, token),
    replace: (tid: string, r: string, s: MarkTableSide, u: string) => api.adminReplacePlayer(idOrSlug, tid, r, s, u, token),
    addWalkIn: (tid: string, u: string) => api.adminAddToBench(idOrSlug, tid, u, token),
    removeBench: (tid: string, u: string) => api.adminRemoveFromBench(idOrSlug, tid, u, token),
    pair: (tid: string, a: string, b: string) => api.adminPairFromBench(idOrSlug, tid, a, b, token),
    addLate: (tid: string, a: string, b: string) => api.adminAddLateRegistration(idOrSlug, tid, a, b, token),
  };
}

export function MarkTable({ mode, slug, clubId, tournamentId, token, memberSearchSlug }: {
  mode: Mode;
  slug?: string;      // requis en mode 'referee'
  clubId?: string;    // requis en mode 'staff'
  tournamentId: string;
  token: string;
  memberSearchSlug: string; // GET /members/search est scopé par slug dans les deux cas
}) {
  const { th } = useTheme();
  const idOrSlug = (mode === 'referee' ? slug : clubId)!;
  const bound = bindApi(mode, idOrSlug, token);

  const [view, setView] = useState<MarkTableView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [benchSelection, setBenchSelection] = useState<string[]>([]);
  const [showWalkIn, setShowWalkIn] = useState(false);

  const load = useCallback(async () => {
    try { setError(null); setView(await bound.get(tournamentId)); }
    catch (e) { setError(markTableErrorLabel(e)); }
  }, [tournamentId, idOrSlug, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const withReload = async (fn: () => Promise<unknown>) => {
    try { await fn(); await load(); }
    catch (e) { setError(markTableErrorLabel(e)); }
  };

  const tapPlayer = (regId: string, side: MarkTableSide) => {
    if (benchSelection.length > 0 || !view) return; // en mode remplacement, la grille ne pointe plus
    const reg = view.registrations.find((r) => r.id === regId)!;
    const current = side === 'CAPTAIN' ? reg.captain.presence : reg.partner.presence;
    const next = current === 'UNSEEN' ? 'PRESENT' : current === 'PRESENT' ? 'ABSENT' : 'UNSEEN';
    void withReload(() => bound.setPresence(tournamentId, regId, side, next));
  };

  const tapBench = (userId: string) => setBenchSelection((sel) => benchSelectionNext(sel, userId));

  const tapReplaceTarget = (regId: string, side: MarkTableSide) => {
    if (benchSelection.length !== 1) return;
    const userId = benchSelection[0];
    setBenchSelection([]);
    void withReload(() => bound.replace(tournamentId, regId, side, userId));
  };

  const doPair = () => {
    if (benchSelection.length !== 2) return;
    const [a, b] = benchSelection;
    setBenchSelection([]);
    void withReload(() => bound.pair(tournamentId, a, b));
  };

  const replaceTargetName = benchSelection.length === 1
    ? view?.bench.find((b) => b.userId === benchSelection[0])?.firstName
    : undefined;

  if (!view) return <div style={{ padding: 20, fontFamily: th.fontUI, color: th.textFaint }}>{error ?? 'Chargement…'}</div>;

  return (
    <div style={{ minHeight: '100vh', background: th.bg, display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: HERO_GRADIENT, padding: '16px 16px 14px', color: HERO_INK }}>
        <div style={{ fontFamily: th.fontUI, fontSize: 10, letterSpacing: 1.2, fontWeight: 800, opacity: 0.7 }}>TABLE DE MARQUE</div>
        <div style={{ fontFamily: th.fontDisplay, fontSize: 19, fontWeight: 800 }}>{view.tournament.name}</div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          <span style={{ background: 'rgba(255,255,255,.78)', borderRadius: 999, padding: '3px 9px', fontSize: 11.5, fontWeight: 800 }}>{view.pointedCount} / {view.totalSlots} pointés</span>
          {view.waitlistCount > 0 && <span style={{ background: 'rgba(255,255,255,.78)', borderRadius: 999, padding: '3px 9px', fontSize: 11.5, fontWeight: 800, color: ACCENTS.violet }}>{view.waitlistCount} attente</span>}
          {view.bench.length > 0 && <span style={{ background: ACCENTS.coral, color: '#fff', borderRadius: 999, padding: '3px 9px', fontSize: 11.5, fontWeight: 800 }}>banc {view.bench.length}</span>}
        </div>
      </div>

      {error && <div style={{ margin: 12, background: `${ACCENTS.coral}33`, color: ACCENTS.coral, borderRadius: 10, padding: '9px 12px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600 }}>{error}</div>}

      <div style={{ flex: 1, padding: '10px 11px 0', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8, alignContent: 'start' }}>
        {view.registrations.map((reg) => (
          <MarkTableTile key={reg.id} reg={reg}
            replaceHighlight={benchSelection.length === 1 ? benchSelection[0] : null}
            replaceTargetName={replaceTargetName}
            onTapPlayer={tapPlayer}
            onTapReplaceTarget={tapReplaceTarget}
            onOpenMenu={(regId, side) => { void withReload(() => bound.forfeit(tournamentId, regId, side)); }} />
        ))}
      </div>

      <div style={{ height: 90 }} />{/* respire au-dessus du banc sticky */}
      <BenchBar bench={view.bench} selection={benchSelection} onTapPlayer={tapBench} onAddWalkIn={() => setShowWalkIn(true)} onPair={doPair} />

      {showWalkIn && (
        <MemberPicker slug={memberSearchSlug} token={token} onClose={() => setShowWalkIn(false)}
          onPick={(userId) => { setShowWalkIn(false); void withReload(() => bound.addWalkIn(tournamentId, userId)); }} />
      )}
    </div>
  );
}
```

⚠️ **Note pour l'implémenteur** : le test « ouvre le menu ⋮ » de `MarkTableTile` (Task 12) attend un menu contextuel (forfait / appeler / promouvoir) — le code ci-dessus câble `onOpenMenu` directement sur `forfeit`, ce qui est une **simplification à corriger** : construire un vrai petit menu (3 lignes : Déclarer forfait / Appeler `tel:` / Promouvoir si WAITLISTED) plutôt qu'une action directe sans confirmation. Ajouter un état `menuFor: { regId, side } | null` + un composant `OverflowMenu` minimal (position fixe, backdrop, 3 boutons), et **envelopper le forfait dans une confirmation** (`ConfirmDialog`, pattern déjà utilisé dans `MeRefereeing`) avant l'appel réseau — un forfait annule toute l'inscription, ce n'est pas anodin.

- [ ] **Step 4: Corriger le menu + confirmation** avant de committer, puis compléter les tests Task 12/14 en conséquence (le test `onOpenMenu` de Task 12 vérifie déjà que la prop est appelée — ajouter ici un test d'intégration `MarkTable` qui vérifie que le forfait ouvre `ConfirmDialog` avant tout appel réseau).

- [ ] **Step 5: Vert** — `node node_modules/jest/bin/jest.js __tests__/MarkTable.test.tsx`, `tsc --noEmit`.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/tournament/MarkTable.tsx frontend/__tests__/MarkTable.test.tsx
git commit -m "feat(tournois): orchestrateur table de marque (pointage, remplacement, appariement)"
```

---

### Task 15: Journal + binôme tardif (complète MarkTable)

**Files:**
- Create: `frontend/components/tournament/MarkTableJournal.tsx`
- Modify: `frontend/components/tournament/MarkTable.tsx`
- Test: `frontend/__tests__/MarkTableJournal.test.tsx` + ajouts dans `MarkTable.test.tsx`

- [ ] **Step 1: Test `MarkTableJournal`**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MarkTableJournal } from '@/components/tournament/MarkTableJournal';

const entries = [{ id: 'l1', kind: 'REPLACE', data: { removedName: 'Bernard X', newName: 'Kevin Vasseur' }, actorName: 'Vous', createdAt: new Date().toISOString() }];

it('replié par défaut, affiche la dernière ligne au dépli', async () => {
  render(<MarkTableJournal entries={entries} />);
  expect(screen.queryByText(/vasseur/i)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /journal/i }));
  expect(screen.getByText(/vasseur/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Rouge, puis implémenter**

```tsx
'use client';
import { useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import type { MarkTableLogEntry } from '@/lib/api';

const LABELS: Record<string, (d: Record<string, unknown>) => string> = {
  CHECK_IN: (d) => `${d.playerName} pointé ${d.presence === 'PRESENT' ? 'présent' : d.presence === 'ABSENT' ? 'absent' : 'non vu'}`,
  FORFEIT: (d) => `${d.forfeitedName} forfait — ${d.remainingName} au banc`,
  REPLACE: (d) => `${d.newName} remplace ${d.removedName}`,
  PAIR: (d) => `${d.nameA} & ${d.nameB} appariés`,
  ADD_LATE: (d) => `${d.nameA ?? d.playerName} ${d.nameB ? `& ${d.nameB} ` : ''}ajouté${d.nameB ? 's' : ''}`,
  PROMOTE: (d) => `${d.nameA} & ${d.nameB} promus`,
  REMOVE: (d) => `${d.nameA} & ${d.nameB} retirés`,
};

export function MarkTableJournal({ entries }: { entries: MarkTableLogEntry[] }) {
  const { th } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <div style={{ margin: '0 11px', background: th.surface, borderRadius: 10, padding: '6px 9px' }}>
      <button onClick={() => setOpen((o) => !o)} style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 11, fontWeight: 800, letterSpacing: 0.6, color: th.textMute, textTransform: 'uppercase' }}>
        Journal <span style={{ marginLeft: 'auto' }}>{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
          {entries.length === 0
            ? <span style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textFaint }}>Aucune intervention.</span>
            : entries.map((e) => (
              <div key={e.id} style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute }}>
                {new Date(e.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} · {LABELS[e.kind]?.(e.data) ?? e.kind} — {e.actorName ?? 'système'}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Câbler dans `MarkTable.tsx`** — importer `MarkTableJournal`, l'insérer entre la grille et le `<div style={{ height: 90 }} />`, alimenté par `view.recentLog`. Ajouter un bouton footer « + Ajouter un binôme tardif » (ouvre `MemberPicker` deux fois, ou une variante à deux champs — **au choix de l'implémenteur, documenter la décision** : le plus simple est de réutiliser `MemberPicker` en séquence — `onPick` du premier stocke `captainUserId` puis rouvre `MemberPicker` pour le partenaire, puis appelle `bound.addLate`).

- [ ] **Step 4: Vert + tsc.**

- [ ] **Step 5: Commit**

```bash
git add frontend/components/tournament/MarkTableJournal.tsx frontend/components/tournament/MarkTable.tsx frontend/__tests__/MarkTableJournal.test.tsx frontend/__tests__/MarkTable.test.tsx
git commit -m "feat(tournois): journal + binome tardif dans la table de marque"
```

---

### Task 16: Points d'entrée + pages

**Files:**
- Create: `frontend/app/me/refereeing/[id]/page.tsx`
- Create: `frontend/app/admin/tournaments/[id]/table/page.tsx`
- Modify: `frontend/components/referee/RefereeTournamentCard.tsx` (bouton)
- Modify: `frontend/app/admin/tournaments/page.tsx` (bouton sur `renderCard`)
- Test: `frontend/__tests__/MeRefereeing.test.tsx` (ajout), `frontend/__tests__/AdminTournaments.test.tsx` (ajout)

- [ ] **Step 1: Page J/A** — `app/me/refereeing/[id]/page.tsx` :

```tsx
'use client';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { MarkTable } from '@/components/tournament/MarkTable';

export default function RefereeMarkTablePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { token, ready } = useAuth();
  const { slug } = useClub();
  if (!ready || !token || !slug) return null;
  return (
    <>
      <button onClick={() => router.back()} aria-label="Fermer"
        style={{ position: 'fixed', top: 14, right: 14, zIndex: 70, width: 34, height: 34, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,.35)', color: '#fff', fontSize: 16, cursor: 'pointer' }}>✕</button>
      <MarkTable mode="referee" slug={slug} tournamentId={id} token={token} memberSearchSlug={slug} />
    </>
  );
}
```

- [ ] **Step 2: Page staff** — `app/admin/tournaments/[id]/table/page.tsx` (mêmes conventions que les autres pages admin `[id]` du dossier — vérifier le pattern exact d'accès à `club.id`/`token` dans un fichier voisin type `app/admin/members/[userId]/page.tsx` avant d'écrire, pour rester cohérent) :

```tsx
'use client';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { MarkTable } from '@/components/tournament/MarkTable';

export default function AdminMarkTablePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { token, ready } = useAuth();
  const { club, slug } = useClub();
  if (!ready || !token || !club || !slug) return null;
  return (
    <>
      <button onClick={() => router.back()} aria-label="Fermer"
        style={{ position: 'fixed', top: 14, right: 14, zIndex: 70, width: 34, height: 34, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,.35)', color: '#fff', fontSize: 16, cursor: 'pointer' }}>✕</button>
      <MarkTable mode="staff" clubId={club.id} tournamentId={id} token={token} memberSearchSlug={slug} />
    </>
  );
}
```

⚠️ **Vérifier avant d'écrire** : le nom exact du hook retournant `club.id` (`useClub()` peut exposer `club` directement ou nécessiter `useAdminClub()` côté back-office — lire un fichier `app/admin/*/page.tsx` existant pour confirmer, ne pas deviner).

- [ ] **Step 3: Bouton sur `RefereeTournamentCard`** — ajouter une prop `onOpenMarkTable: () => void`, bouton à côté d'« Inscrits » :
```tsx
<Btn variant="surface" onClick={onOpenMarkTable} style={{ height: 42 }}>Table de marque</Btn>
```
Dans `app/me/refereeing/page.tsx`, câbler via `router.push(`/me/refereeing/${t.id}`)` (import `useRouter` depuis `next/navigation`).

- [ ] **Step 4: Bouton sur `AgendaAdminCard`** (liste `/admin/tournaments`) — dans `renderCard(t)`, ajouter aux `actions` existantes un lien/bouton vers `/admin/tournaments/${t.id}/table` (via `router.push`, cohérent avec le reste du fichier — lire comment `actions` est déjà construit dans le fichier avant d'insérer, pattern exact à respecter).

- [ ] **Step 5: Tests** — ajouter dans `MeRefereeing.test.tsx` : clic sur « Table de marque » appelle `router.push` avec le bon chemin (mock `next/navigation`). Idem `AdminTournaments.test.tsx`.

- [ ] **Step 6: Vert + tsc** — suites ciblées, jamais la suite frontend complète (flake `BookingModal` connu).

- [ ] **Step 7: Commit**

```bash
git add frontend/app/me/refereeing/\[id\]/page.tsx frontend/app/admin/tournaments/\[id\]/table/page.tsx frontend/components/referee/RefereeTournamentCard.tsx frontend/app/admin/tournaments/page.tsx frontend/app/me/refereeing/page.tsx frontend/__tests__/MeRefereeing.test.tsx frontend/__tests__/AdminTournaments.test.tsx
git commit -m "feat(tournois): points d'entree table de marque (J/A + admin)"
```

---

### Task 17: Vérification visuelle CDP (obligatoire — regarder les images)

- [ ] **Step 1: Poser des données** — script `node -r ts-node/register` jetable depuis `backend/` : facette J/A sur `test@palova.fr`, l'assigner à un tournoi à venir avec au moins 6 inscrits (dont attente), 2 présences ABSENT, 1-2 entrées de banc (une `FORFEIT`, une `WALK_IN`). **Noter l'état initial**, restaurer à la fin (preuve par relecture collée).

- [ ] **Step 2: Lancer la stack, capturer en CDP** — suivre `docs/superpowers/...verify` skill du repo (hôte club `padel-arena-paris.localhost:3000`, cookie `token` via login API, WebSocket natif Node, profil Chrome dédié). Capturer `/me/refereeing/<id>` **et** `/admin/tournaments/<id>/table` : clair + sombre, **desktop 1280 ET mobile 390** (`mobile:false` + largeur fixe — `mobile:true` ment sur les débordements).

- [ ] **Step 3: REGARDER les images** (outil Read, multimodal) — vérifier : grille lisible, tuile ABSENT en coral, banc visible en bas, chips vivantes, journal replié propre, pas de texte coupé/chevauchant. **La mesure `scrollWidth` seule est aveugle ici** (leçon de la carte méta J/A, `overflow-x:clip` la clampe) — un défaut de mise en page peut être invisible à la mesure et visible à l'image.

- [ ] **Step 4: Corriger tout défaut trouvé**, recapturer, reregarder — itérer jusqu'à propre.

- [ ] **Step 5: Nettoyer** — Chrome du profil dédié uniquement (jamais tous les `chrome.exe`), scripts jetables supprimés, base restaurée (preuve collée).

---

### Task 18: E2E contre la vraie base + non-régression finale

- [ ] **Step 1: Backend** — `node node_modules/jest/bin/jest.js` depuis `backend/` (suite complète). Comparer au total connu avant ce lot (le mesurer soi-même via `git stash` si doute, ne jamais faire confiance à un chiffre annoncé).

- [ ] **Step 2: Frontend** — suites ciblées de ce lot + les 3 suites *real-mount* `ClubNav`/`ClubReserve.balances`/`OpenMatches` (elles montent `ProfileMenu`, à ne jamais casser). `tsc --noEmit` des deux côtés.

- [ ] **Step 3: E2E script jetable** contre la vraie base (pattern des lots précédents de cette session) : pointer un joueur, déclarer un forfait (vérifier CANCELLED + banc + promotion), remplacer un absent depuis le banc (vérifier paiement intouché), apparier deux orphelins (vérifier CONFIRMED/WAITLISTED selon capacité), ajouter un tardif, vérifier le journal contient une ligne par acte, vérifier le **kill-switch** : décocher `isReferee` du J/A coupe l'accès à la table (403 `NOT_A_REFEREE` sur la route), le staff garde l'accès. **Restaurer l'état initial**, preuve collée.

- [ ] **Step 4: Rapport final** — lister tout défaut trouvé et corrigé, tout écart pris en cours de route, ce qui reste éventuellement en `DONE_WITH_CONCERNS`.

---

## Self-Review

**Couverture de la spec :** §3 modèle → T1 · §4 lecture/pointage/forfait/banc/remplacement/appariement/tardif/journal → T2-T7 · §5 routes → T8-T10 (+ correctif promote/remove journalisés découvert en écrivant T10) · §6 front → T11-T16 · §7 notifications → T5-T6 · §9 tests → intégrés à chaque tâche + T17-T18.

**Placeholders corrigés en écrivant :** aucun laissé — le correctif « promote/remove journalisés manquants » (T10 Step 3) et le menu ⋮ simplifié (T14 note) sont des **trous trouvés pendant l'écriture**, pas des trous laissés : chacun a sa correction complète inline, pas juste signalée.

**Cohérence des types :** `MarkTablePresence`/`MarkTableSide` identiques back (Task 2) et front (Task 10) ; `MarkTableView`/`MarkTableRegistration`/`MarkTableBenchEntry`/`MarkTableLogEntry` répétés à l'identique des deux côtés (JSON), `Date`→`string` seule différence (sérialisation). `bindApi` (Task 14) référence exactement les noms posés en Task 10.

**Écart assumé vs spec, à faire trancher par l'implémenteur/l'utilisateur si ça gêne à l'usage :** le geste « replace » n'exige pas de forfait préalable (décision de conception n°2, ci-dessus) — c'est une clarification cohérente avec la maquette validée, pas une réduction de périmètre, mais ça mérite d'être montré à l'utilisateur à la vérification visuelle (Task 17) pour confirmation explicite.
