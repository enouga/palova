# Juge-arbitre (J/A) de tournoi — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un membre non-staff désigné juge-arbitre d'un tournoi peut le piloter (v1 : gérer ses inscrits) depuis un espace dédié, sans recevoir aucun droit sur le reste du club.

**Architecture:** **Facette + mission sur l'objet**, calqué sur le coach. Deux colonnes additives — `ClubMembership.isReferee` (la facette) et `Tournament.refereeUserId` (la mission) — **zéro table, zéro rôle**. Gate à deux étages (`resolveReferee` puis `assertRefereeOwnsTournament`), puis **délégation au cœur admin déjà testé** (`adminPromoteRegistration` / `adminRemoveRegistration`) : aucune logique métier dupliquée.

**Tech Stack:** Prisma 7 (driver adapter obligatoire), Express + TypeScript, Jest (backend), Next.js 16 + React Testing Library (frontend).

**Spec:** `docs/superpowers/specs/2026-07-17-juge-arbitre-tournoi-design.md`

---

## ⚠️ Avant de commencer — état du dépôt

Au moment où ce plan est écrit, le dépôt est sur `main` **avec un merge non committé** (`.git/MERGE_HEAD` présent, conflits résolus mais pas clôturés) et un très gros index en vol.

- [ ] Vérifier que le merge d'Eric est clôturé : `ls .git/MERGE_HEAD` doit être vide, `git status --short` propre.
- [ ] **Ne jamais `git add -A`** dans ce plan — toujours lister les chemins explicitement (WIP tiers).
- [ ] `frontend/components/ProfileMenu.tsx` et `frontend/__tests__/ProfileMenu.test.tsx` étaient **modifiés par Eric** : ce sont exactement deux fichiers de la Task 11. Resynchroniser avant.

## File Structure

**Backend — créés :**
- `backend/prisma/migrations/20260717120000_add_tournament_referee/migration.sql` — migration additive
- `backend/src/routes/__tests__/clubs.referee.routes.test.ts`
- `backend/src/routes/__tests__/admin.member-referee.routes.test.ts`

**Backend — modifiés :**
- `backend/prisma/schema.prisma` — 2 colonnes + relation nommée
- `backend/src/services/tournament.service.ts` — bloc « Espace J/A » (miroir du bloc coach de `lesson.service.ts:777-887`) + validation `refereeUserId`
- `backend/src/services/club.service.ts` — `isReferee` dans `listMembers` + `setMemberReferee`
- `backend/src/routes/clubs.ts` — routes `/me/referee*` + `/me/facets`, retrait de `/me/coach`, codes d'erreur
- `backend/src/routes/admin.ts` — `PATCH /members/:userId/referee`, `GET /referees`

**Frontend — créés :**
- `frontend/app/me/refereeing/page.tsx`
- `frontend/components/referee/RefereeTournamentCard.tsx`
- `frontend/__tests__/MeRefereeing.test.tsx`, `RefereeTournamentCard.test.tsx`

**Frontend — modifiés :**
- `frontend/lib/api.ts`, `frontend/lib/members.ts`
- `frontend/components/ProfileMenu.tsx`, `frontend/components/admin/members/MemberPanel.tsx`
- `frontend/app/admin/members/page.tsx`, `frontend/app/admin/tournaments/page.tsx`
- `frontend/app/tournois/[id]/page.tsx`

**Responsabilités :** le gate + la propriété vivent dans `tournament.service.ts` (l'objet possédé est le tournoi) ; la facette vit dans `club.service.ts` (elle est sur `ClubMembership`, comme `watch`). Cette séparation copie exactement coach = `lesson.service.ts` (l'objet) + `coach.service.ts` (la facette).

---

### Task 1 : Migration + schéma

**Files:**
- Create: `backend/prisma/migrations/20260717120000_add_tournament_referee/migration.sql`
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1 : Écrire la migration**

```sql
-- Facette « juge-arbitre » du membre (miroir de ClubMembership.watch)
ALTER TABLE "club_subscribers" ADD COLUMN IF NOT EXISTS "is_referee" BOOLEAN NOT NULL DEFAULT false;

-- Mission : le J/A désigné de ce tournoi
ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "referee_user_id" TEXT;
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_referee_user_id_fkey"
  FOREIGN KEY ("referee_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "tournaments_referee_user_id_idx" ON "tournaments"("referee_user_id");
```

- [ ] **Step 2 : Modifier le schéma**

Dans `model ClubMembership`, après la ligne `watch` :

```prisma
  isReferee    Boolean          @default(false) @map("is_referee")  // facette juge-arbitre
```

Dans `model Tournament`, ajouter le champ, la relation et l'index :

```prisma
  refereeUserId String? @map("referee_user_id")
  referee       User?   @relation("TournamentReferee", fields: [refereeUserId], references: [id], onDelete: SetNull)
  @@index([refereeUserId])
```

Dans `model User`, ajouter la relation inverse (obligatoire, sinon `prisma validate` échoue) :

```prisma
  refereedTournaments Tournament[] @relation("TournamentReferee")
```

- [ ] **Step 3 : Appliquer en DEV et régénérer**

> ⚠️ La base dev a une **dérive connue** : **ni `db push` ni `migrate dev`** (ils veulent un reset destructif). Prisma 7 : sans `--schema`, la config vient de `prisma.config.ts`.

Run (dans `backend/`) :
```bash
npx prisma db execute --file prisma/migrations/20260717120000_add_tournament_referee/migration.sql
npx prisma generate
```
Expected: `Script executed successfully.` puis `Generated Prisma Client`.

- [ ] **Step 4 : Vérifier que le client type les colonnes**

Run: `node node_modules/typescript/bin/tsc --noEmit -p backend/tsconfig.json`
Expected: aucune erreur sur `isReferee` / `refereeUserId`.

- [ ] **Step 5 : Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260717120000_add_tournament_referee/migration.sql
git commit -m "feat(tournois): migration facette J/A + refereeUserId"
```

---

### Task 2 : Gate à deux étages (`resolveReferee`, `assertRefereeOwnsTournament`)

**Files:**
- Modify: `backend/src/services/tournament.service.ts` (nouveau bloc en fin de classe, avant la fermeture)
- Test: `backend/src/services/__tests__/tournament.service.test.ts`

- [ ] **Step 1 : Écrire les tests qui échouent**

```ts
describe('espace J/A — gate', () => {
  it('resolveReferee : vrai pour un membre ACTIVE avec la facette', async () => {
    (prisma.clubMembership.findUnique as jest.Mock).mockResolvedValue({ status: 'ACTIVE', isReferee: true });
    await expect(tournamentService.resolveReferee('club-1', 'u1')).resolves.toBe(true);
  });

  it('resolveReferee : faux si la facette est décochée', async () => {
    (prisma.clubMembership.findUnique as jest.Mock).mockResolvedValue({ status: 'ACTIVE', isReferee: false });
    await expect(tournamentService.resolveReferee('club-1', 'u1')).resolves.toBe(false);
  });

  it('resolveReferee : faux si le membre est BLOCKED, même J/A', async () => {
    (prisma.clubMembership.findUnique as jest.Mock).mockResolvedValue({ status: 'BLOCKED', isReferee: true });
    await expect(tournamentService.resolveReferee('club-1', 'u1')).resolves.toBe(false);
  });

  it('resolveReferee : faux si aucune adhésion', async () => {
    (prisma.clubMembership.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(tournamentService.resolveReferee('club-1', 'u1')).resolves.toBe(false);
  });

  it('assertRefereeOwnsTournament : TOURNAMENT_NOT_YOURS pour un autre J/A', async () => {
    (prisma.tournament.findUnique as jest.Mock).mockResolvedValue({ clubId: 'club-1', refereeUserId: 'autre' });
    await expect(tournamentService.refereeListRegistrations('club-1', 'u1', 't1')).rejects.toThrow('TOURNAMENT_NOT_YOURS');
  });

  it('assertRefereeOwnsTournament : TOURNAMENT_NOT_FOUND si le tournoi est d’un autre club', async () => {
    (prisma.tournament.findUnique as jest.Mock).mockResolvedValue({ clubId: 'club-2', refereeUserId: 'u1' });
    await expect(tournamentService.refereeListRegistrations('club-1', 'u1', 't1')).rejects.toThrow('TOURNAMENT_NOT_FOUND');
  });
});
```

- [ ] **Step 2 : Lancer les tests, vérifier l'échec**

Run: `node node_modules/jest/bin/jest.js src/services/__tests__/tournament.service.test.ts -t "espace J/A" --rootDir backend` (depuis la racine ; adapter au runner du repo)
Expected: FAIL — `tournamentService.resolveReferee is not a function`.

- [ ] **Step 3 : Implémenter le gate**

Dans `backend/src/services/tournament.service.ts`, en fin de classe :

```ts
  // ─────────────────────────────────────────────────────── Espace juge-arbitre
  // Gate = facette ClubMembership.isReferee + propriété du tournoi. PAS un rôle : un J/A
  // n'a aucun droit sur le reste du club. Miroir de l'espace coach (lesson.service.ts).

  /** Étage 1 — « es-tu J/A de ce club ? ». Adhésion ACTIVE + facette. Gate de l'espace arbitrage. */
  async resolveReferee(clubId: string, userId: string): Promise<boolean> {
    const m = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId, clubId } },
      select: { status: true, isReferee: true },
    });
    return !!m && m.status === 'ACTIVE' && m.isReferee;
  }

  /**
   * Étage 2 — « ce tournoi est-il le tien ? ».
   * TOURNAMENT_NOT_FOUND (inexistant / autre club) | TOURNAMENT_NOT_YOURS (autre J/A).
   */
  private async assertRefereeOwnsTournament(tournamentId: string, clubId: string, userId: string) {
    const t = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { clubId: true, refereeUserId: true },
    });
    if (!t || t.clubId !== clubId) throw new Error('TOURNAMENT_NOT_FOUND');
    if (t.refereeUserId !== userId) throw new Error('TOURNAMENT_NOT_YOURS');
    return t;
  }
```

- [ ] **Step 4 : Lancer les tests**

Expected: les 4 tests `resolveReferee` PASS ; les 2 tests `assert*` échouent encore (`refereeListRegistrations` n'existe pas) — c'est attendu, ils passeront en Task 3.

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/tournament.service.ts backend/src/services/__tests__/tournament.service.test.ts
git commit -m "feat(tournois): gate J/A a deux etages (facette + propriete)"
```

---

### Task 3 : Lecture — `listRefereeTournaments` + `refereeListRegistrations`

**Files:**
- Modify: `backend/src/services/tournament.service.ts`
- Test: `backend/src/services/__tests__/tournament.service.test.ts`

- [ ] **Step 1 : Écrire les tests qui échouent**

```ts
describe('espace J/A — lecture', () => {
  it('listRefereeTournaments : filtre sur refereeUserId et le scope à venir', async () => {
    (prisma.tournament.findMany as jest.Mock).mockResolvedValue([]);
    await tournamentService.listRefereeTournaments('club-1', 'u1', 'upcoming');
    const arg = (prisma.tournament.findMany as jest.Mock).mock.calls[0][0];
    expect(arg.where.clubId).toBe('club-1');
    expect(arg.where.refereeUserId).toBe('u1');
    expect(arg.where.startTime).toEqual({ gt: expect.any(Date) });
    expect(arg.take).toBeUndefined();
  });

  it('listRefereeTournaments : scope passé = desc, cap 30', async () => {
    (prisma.tournament.findMany as jest.Mock).mockResolvedValue([]);
    await tournamentService.listRefereeTournaments('club-1', 'u1', 'past');
    const arg = (prisma.tournament.findMany as jest.Mock).mock.calls[0][0];
    expect(arg.orderBy).toEqual({ startTime: 'desc' });
    expect(arg.take).toBe(30);
  });

  it('refereeListRegistrations : expose licence + téléphone, jamais userId', async () => {
    (prisma.tournament.findUnique as jest.Mock).mockResolvedValue({ clubId: 'club-1', refereeUserId: 'u1' });
    (prisma.tournamentRegistration.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'r1', status: 'CONFIRMED', paymentStatus: 'PAID', createdAt: new Date('2026-01-01'),
        captainUser: { id: 'c1', firstName: 'Léa', lastName: 'Girard', avatarUrl: null, phone: '0600000001' },
        partnerUser: { id: 'p1', firstName: 'Zoé', lastName: 'Marin', avatarUrl: null, phone: null },
      },
      {
        id: 'r2', status: 'WAITLISTED', paymentStatus: 'NONE', createdAt: new Date('2026-01-02'),
        captainUser: { id: 'c2', firstName: 'Tom', lastName: 'Roy', avatarUrl: null, phone: null },
        partnerUser: null,
      },
    ]);
    (prisma.clubMembership.findMany as jest.Mock).mockResolvedValue([
      { userId: 'c1', membershipNo: '12345' },
    ]);

    const rows = await tournamentService.refereeListRegistrations('club-1', 'u1', 't1');

    expect(rows[0].captain).toEqual({
      firstName: 'Léa', lastName: 'Girard', avatarUrl: null, phone: '0600000001', membershipNo: '12345',
    });
    expect(rows[0].partner?.membershipNo).toBeNull();
    expect(JSON.stringify(rows)).not.toContain('c1');       // userId jamais exposé
    expect(rows[1].waitlistPosition).toBe(1);
    expect(rows[0].waitlistPosition).toBeNull();
  });
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Expected: FAIL — `listRefereeTournaments is not a function`.

- [ ] **Step 3 : Implémenter**

En haut de `tournament.service.ts`, à côté des autres types exportés :

```ts
export interface RefereePlayerRow {
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  phone: string | null;
  membershipNo: string | null;   // licence — le J/A la vérifie à la table de marque
}

export interface RefereeRegistrationRow {
  id: string;
  status: string;
  paymentStatus: string;
  waitlistPosition: number | null;
  captain: RefereePlayerRow;
  partner: RefereePlayerRow | null;
}

export interface RefereeTournamentRow {
  id: string;
  name: string;
  category: string;
  gender: string;
  status: string;
  startTime: Date;
  endTime: Date | null;
  registrationDeadline: Date;
  maxTeams: number | null;
  confirmedCount: number;
  waitlistCount: number;
}
```

Dans le bloc « Espace juge-arbitre » :

```ts
  /** Tournois du J/A (à venir = startTime>now asc ; passés = startTime<now desc, cap 30). */
  async listRefereeTournaments(clubId: string, userId: string, scope: 'upcoming' | 'past'): Promise<RefereeTournamentRow[]> {
    const now = new Date();
    const rows = await prisma.tournament.findMany({
      where: {
        clubId,
        refereeUserId: userId,
        ...(scope === 'upcoming' ? { startTime: { gt: now } } : { startTime: { lt: now } }),
      },
      orderBy: { startTime: scope === 'upcoming' ? 'asc' : 'desc' },
      ...(scope === 'past' ? { take: 30 } : {}),
      select: {
        id: true, name: true, category: true, gender: true, status: true,
        startTime: true, endTime: true, registrationDeadline: true, maxTeams: true,
        _count: { select: { registrations: { where: { status: 'CONFIRMED' } } } },
      },
    });

    // Compteurs d'attente en une requête groupée (pas de N+1).
    const ids = rows.map((r) => r.id);
    const waitRows = ids.length === 0 ? [] : await prisma.tournamentRegistration.groupBy({
      by: ['tournamentId'],
      where: { tournamentId: { in: ids }, status: 'WAITLISTED' },
      _count: { _all: true },
    });
    const waitBy = new Map(waitRows.map((w) => [w.tournamentId, w._count._all]));

    return rows.map(({ _count, ...t }) => ({
      ...t,
      confirmedCount: _count.registrations,
      waitlistCount: waitBy.get(t.id) ?? 0,
    }));
  }

  /** Roster J/A d'un tournoi : binômes + contacts + licence. `userId` jamais exposé. */
  async refereeListRegistrations(clubId: string, userId: string, tournamentId: string): Promise<RefereeRegistrationRow[]> {
    await this.assertRefereeOwnsTournament(tournamentId, clubId, userId);

    const regs = await prisma.tournamentRegistration.findMany({
      where: { tournamentId, status: { not: 'CANCELLED' } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, status: true, paymentStatus: true, createdAt: true,
        captainUser: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, phone: true } },
        partnerUser: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, phone: true } },
      },
    });

    // Licences en une requête groupée pour tous les joueurs du tableau.
    const playerIds = regs.flatMap((r) => [r.captainUser?.id, r.partnerUser?.id]).filter((v): v is string => !!v);
    const licRows = playerIds.length === 0 ? [] : await prisma.clubMembership.findMany({
      where: { clubId, userId: { in: playerIds } },
      select: { userId: true, membershipNo: true },
    });
    const licBy = new Map(licRows.map((l) => [l.userId, l.membershipNo]));

    const toPlayer = (u: { id: string; firstName: string; lastName: string; avatarUrl: string | null; phone: string | null } | null): RefereePlayerRow | null =>
      u == null ? null : {
        firstName: u.firstName, lastName: u.lastName, avatarUrl: u.avatarUrl, phone: u.phone,
        membershipNo: licBy.get(u.id) ?? null,
      };

    let waitlistIdx = 0;
    return regs.map((r) => ({
      id: r.id,
      status: r.status,
      paymentStatus: r.paymentStatus,
      waitlistPosition: r.status === 'WAITLISTED' ? ++waitlistIdx : null,
      captain: toPlayer(r.captainUser)!,
      partner: toPlayer(r.partnerUser),
    }));
  }
```

- [ ] **Step 4 : Lancer les tests**

Run: `node node_modules/jest/bin/jest.js src/services/__tests__/tournament.service.test.ts -t "espace J/A"`
Expected: PASS — y compris les 2 tests `assert*` de la Task 2.

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/tournament.service.ts backend/src/services/__tests__/tournament.service.test.ts
git commit -m "feat(tournois): lecture J/A (tournois + roster avec licence)"
```

---

### Task 4 : Écriture — `refereePromoteRegistration` + `refereeRemoveRegistration`

**Files:**
- Modify: `backend/src/services/tournament.service.ts`
- Test: `backend/src/services/__tests__/tournament.service.test.ts`

- [ ] **Step 1 : Écrire les tests qui échouent**

```ts
describe('espace J/A — écriture (délégation)', () => {
  beforeEach(() => {
    (prisma.tournament.findUnique as jest.Mock).mockResolvedValue({ clubId: 'club-1', refereeUserId: 'u1' });
  });

  it('refereePromoteRegistration délègue au cœur admin', async () => {
    const spy = jest.spyOn(tournamentService, 'adminPromoteRegistration').mockResolvedValue({ id: 'r1' } as never);
    await tournamentService.refereePromoteRegistration('club-1', 'u1', 't1', 'r1');
    expect(spy).toHaveBeenCalledWith('t1', 'r1', 'club-1');
  });

  it('refereeRemoveRegistration délègue au cœur admin', async () => {
    const spy = jest.spyOn(tournamentService, 'adminRemoveRegistration').mockResolvedValue({ id: 'r1' } as never);
    await tournamentService.refereeRemoveRegistration('club-1', 'u1', 't1', 'r1');
    expect(spy).toHaveBeenCalledWith('t1', 'r1', 'club-1');
  });

  it('kill-switch : un J/A sur le tournoi d’un autre ne peut pas promouvoir', async () => {
    (prisma.tournament.findUnique as jest.Mock).mockResolvedValue({ clubId: 'club-1', refereeUserId: 'autre' });
    const spy = jest.spyOn(tournamentService, 'adminPromoteRegistration');
    await expect(tournamentService.refereePromoteRegistration('club-1', 'u1', 't1', 'r1')).rejects.toThrow('TOURNAMENT_NOT_YOURS');
    expect(spy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Expected: FAIL — `refereePromoteRegistration is not a function`.

- [ ] **Step 3 : Implémenter**

```ts
  /**
   * Promotion d'un binôme en attente par le J/A (sur SON tournoi). Délègue au cœur admin.
   * Pas de verrou temporel : le J/A doit pouvoir agir PENDANT le tournoi. Les règles de
   * deadline / tableau lancé sont portées par le cœur — on ne les redouble pas ici.
   */
  async refereePromoteRegistration(clubId: string, userId: string, tournamentId: string, regId: string) {
    await this.assertRefereeOwnsTournament(tournamentId, clubId, userId);
    return this.adminPromoteRegistration(tournamentId, regId, clubId);
  }

  /** Retrait d'un binôme par le J/A (sur SON tournoi). Délègue au cœur admin. */
  async refereeRemoveRegistration(clubId: string, userId: string, tournamentId: string, regId: string) {
    await this.assertRefereeOwnsTournament(tournamentId, clubId, userId);
    return this.adminRemoveRegistration(tournamentId, regId, clubId);
  }
```

- [ ] **Step 4 : Lancer les tests**

Expected: PASS (3/3).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/tournament.service.ts backend/src/services/__tests__/tournament.service.test.ts
git commit -m "feat(tournois): ecriture J/A (promotion/retrait deleguees au coeur admin)"
```

---

### Task 5 : Désignation du J/A sur le tournoi (`refereeUserId` + `REFEREE_INVALID`)

**Files:**
- Modify: `backend/src/services/tournament.service.ts` (`validateTournamentInput:553`, `createTournament:457`, `updateTournament:464`)
- Test: `backend/src/services/__tests__/tournament.service.test.ts`

**Pourquoi une garde :** sans elle, `PATCH /tournaments/:id { refereeUserId }` désignerait **n'importe quel `User` de la plateforme** — y compris un non-membre — et lui ouvrirait l'espace J/A du club. La facette doit être vérifiée serveur.

- [ ] **Step 1 : Écrire les tests qui échouent**

```ts
describe('désignation du J/A', () => {
  it('refuse un J/A qui n’a pas la facette (REFEREE_INVALID)', async () => {
    (prisma.tournament.findFirst as jest.Mock).mockResolvedValue({ id: 't1', status: 'DRAFT', entryFee: 0, requirePrepayment: false });
    (prisma.clubMembership.findUnique as jest.Mock).mockResolvedValue({ status: 'ACTIVE', isReferee: false });
    await expect(tournamentService.updateTournament('t1', 'club-1', { refereeUserId: 'u9' } as never)).rejects.toThrow('REFEREE_INVALID');
  });

  it('accepte un J/A qui a la facette', async () => {
    (prisma.tournament.findFirst as jest.Mock).mockResolvedValue({ id: 't1', status: 'DRAFT', entryFee: 0, requirePrepayment: false });
    (prisma.clubMembership.findUnique as jest.Mock).mockResolvedValue({ status: 'ACTIVE', isReferee: true });
    (prisma.tournament.update as jest.Mock).mockResolvedValue({ id: 't1' });
    await tournamentService.updateTournament('t1', 'club-1', { refereeUserId: 'u9' } as never);
    expect((prisma.tournament.update as jest.Mock).mock.calls[0][0].data.refereeUserId).toBe('u9');
  });

  it('null retire le J/A sans vérification', async () => {
    (prisma.tournament.findFirst as jest.Mock).mockResolvedValue({ id: 't1', status: 'DRAFT', entryFee: 0, requirePrepayment: false });
    (prisma.tournament.update as jest.Mock).mockResolvedValue({ id: 't1' });
    await tournamentService.updateTournament('t1', 'club-1', { refereeUserId: null } as never);
    expect((prisma.tournament.update as jest.Mock).mock.calls[0][0].data.refereeUserId).toBeNull();
    expect(prisma.clubMembership.findUnique).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Expected: FAIL — `refereeUserId` absent de `data`.

- [ ] **Step 3 : Implémenter**

Dans l'interface `UpdateTournamentInput` (autour de `tournament.service.ts:19`, à côté de `contactInfo`) :

```ts
  refereeUserId?: string | null;
```

Dans `validateTournamentInput`, juste après la ligne `contactInfo` (`:569`) :

```ts
    if (input.refereeUserId !== undefined) data.refereeUserId = (input.refereeUserId ?? '').toString().trim() || null;
```

Nouvelle méthode privée dans le bloc « Espace juge-arbitre » :

```ts
  /** Le J/A désigné doit être un membre ACTIVE du club portant la facette. REFEREE_INVALID sinon. */
  private async assertRefereeValid(clubId: string, refereeUserId: string | null) {
    if (!refereeUserId) return;                       // null = retirer le J/A, rien à vérifier
    if (!(await this.resolveReferee(clubId, refereeUserId))) throw new Error('REFEREE_INVALID');
  }
```

Dans `createTournament`, juste avant le `prisma.tournament.create` (`:461`) :

```ts
    if (data.refereeUserId !== undefined) await this.assertRefereeValid(clubId, data.refereeUserId as string | null);
```

Dans `updateTournament`, juste avant le `prisma.tournament.update` (`:481`) :

```ts
    if (data.refereeUserId !== undefined) await this.assertRefereeValid(clubId, data.refereeUserId as string | null);
```

- [ ] **Step 4 : Lancer les tests**

Run: `node node_modules/jest/bin/jest.js src/services/__tests__/tournament.service.test.ts`
Expected: PASS — toute la suite tournoi verte (aucune régression).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/tournament.service.ts backend/src/services/__tests__/tournament.service.test.ts
git commit -m "feat(tournois): designation du J/A validee serveur (REFEREE_INVALID)"
```

---

### Task 6 : Facette côté club (`setMemberReferee` + `isReferee` dans `listMembers`)

**Files:**
- Modify: `backend/src/services/club.service.ts` (`listMembers:412`)
- Test: `backend/src/services/__tests__/club.service.test.ts`

- [ ] **Step 1 : Écrire les tests qui échouent**

```ts
describe('facette J/A', () => {
  it('setMemberReferee : MEMBER_NOT_FOUND si la cible n’est pas membre', async () => {
    (prisma.clubMembership.update as jest.Mock).mockRejectedValue({ code: 'P2025' });
    await expect(clubService.setMemberReferee('club-1', 'u9', true)).rejects.toThrow('MEMBER_NOT_FOUND');
  });

  it('setMemberReferee : coche la facette', async () => {
    (prisma.clubMembership.update as jest.Mock).mockResolvedValue({ isReferee: true });
    await expect(clubService.setMemberReferee('club-1', 'u1', true)).resolves.toEqual({ userId: 'u1', isReferee: true });
    expect((prisma.clubMembership.update as jest.Mock).mock.calls[0][0]).toMatchObject({
      where: { userId_clubId: { userId: 'u1', clubId: 'club-1' } },
      data: { isReferee: true },
    });
  });

  it('listMembers expose isReferee', async () => {
    // (compléter les mocks du beforeEach existant de la suite listMembers)
    const rows = await clubService.listMembers('club-1');
    expect(rows[0]).toHaveProperty('isReferee');
  });
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Expected: FAIL — `clubService.setMemberReferee is not a function`.

- [ ] **Step 3 : Implémenter**

Dans `listMembers`, ajouter `isReferee: true` au `select` du `clubMembership.findMany` (`club.service.ts:421`) :

```ts
          id: true, isSubscriber: true, membershipNo: true, status: true, note: true, watch: true, isReferee: true, createdAt: true,
```

et dans le `return members.map(...)`, à côté de `isCoach` :

```ts
      isReferee: m.isReferee,
```

Nouvelle méthode, à côté de `setMemberWatch` :

```ts
  /**
   * Facette « juge-arbitre » d'un membre (colonne ClubMembership.isReferee).
   * Idempotent. Pas de garde self/owner — être J/A ne confère aucun privilège sur le club,
   * seulement sur les tournois qu'on lui assigne (miroir de CoachService.setMemberCoach).
   * Lève : MEMBER_NOT_FOUND si la cible n'est pas membre du club.
   */
  async setMemberReferee(clubId: string, userId: string, isReferee: boolean) {
    try {
      await prisma.clubMembership.update({
        where: { userId_clubId: { userId, clubId } },
        data: { isReferee },
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2025') throw new Error('MEMBER_NOT_FOUND');
      throw e;
    }
    return { userId, isReferee };
  }
```

- [ ] **Step 4 : Lancer les tests**

Run: `node node_modules/jest/bin/jest.js src/services/__tests__/club.service.test.ts`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/club.service.ts backend/src/services/__tests__/club.service.test.ts
git commit -m "feat(membres): facette J/A (setMemberReferee + isReferee dans listMembers)"
```

---

### Task 7 : Routes admin (`PATCH /members/:userId/referee`, `GET /referees`)

**Files:**
- Modify: `backend/src/routes/admin.ts` (après le bloc coach, `:1039`)
- Test: `backend/src/routes/__tests__/admin.member-referee.routes.test.ts` (create)

- [ ] **Step 1 : Écrire les tests qui échouent**

Calquer le fichier sur `backend/src/routes/__tests__/admin.member-coach.routes.test.ts` (mêmes mocks/harnais), avec ces cas :

```ts
it('PATCH /members/:userId/referee — 200 et délègue au service', async () => {
  (clubService.setMemberReferee as jest.Mock).mockResolvedValue({ userId: 'u1', isReferee: true });
  const res = await request(app).patch('/api/clubs/club-1/admin/members/u1/referee').send({ isReferee: true });
  expect(res.status).toBe(200);
  expect(clubService.setMemberReferee).toHaveBeenCalledWith('club-1', 'u1', true);
});

it('PATCH /members/:userId/referee — 400 si isReferee n’est pas un booléen', async () => {
  const res = await request(app).patch('/api/clubs/club-1/admin/members/u1/referee').send({ isReferee: 'oui' });
  expect(res.status).toBe(400);
  expect(clubService.setMemberReferee).not.toHaveBeenCalled();
});

it('PATCH /members/:userId/referee — 404 MEMBER_NOT_FOUND', async () => {
  (clubService.setMemberReferee as jest.Mock).mockRejectedValue(new Error('MEMBER_NOT_FOUND'));
  const res = await request(app).patch('/api/clubs/club-1/admin/members/u1/referee').send({ isReferee: true });
  expect(res.status).toBe(404);
});

it('GET /referees — renvoie le vivier', async () => {
  (clubService.listReferees as jest.Mock).mockResolvedValue([{ userId: 'u1', firstName: 'Léa', lastName: 'Girard', avatarUrl: null }]);
  const res = await request(app).get('/api/clubs/club-1/admin/referees');
  expect(res.status).toBe(200);
  expect(res.body).toHaveLength(1);
});
```

> ⚠️ Ce fichier de test doit vérifier le **gate ADMIN**. Reprendre le harnais de `admin.role-gates.routes.test.ts` (déjà présent) pour asserter qu'un STAFF reçoit 403 sur `PATCH /members/:userId/referee`.

- [ ] **Step 2 : Lancer, vérifier l'échec**

Expected: FAIL — 404 (routes inexistantes).

- [ ] **Step 3 : Implémenter**

Ajouter `listReferees` dans `club.service.ts`, à côté de `setMemberReferee` :

```ts
  /** Vivier des J/A du club (membres ACTIVE portant la facette) — alimente le picker du tournoi. */
  async listReferees(clubId: string) {
    const rows = await prisma.clubMembership.findMany({
      where: { clubId, isReferee: true, status: 'ACTIVE', user: { deletedAt: null } },
      orderBy: [{ user: { lastName: 'asc' } }, { user: { firstName: 'asc' } }],
      select: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
    });
    return rows.map((r) => ({
      userId: r.user.id, firstName: r.user.firstName, lastName: r.user.lastName, avatarUrl: r.user.avatarUrl ?? null,
    }));
  }
```

Dans `backend/src/routes/admin.ts`, après le bloc coach :

```ts
// Facette « juge-arbitre » d'un membre — réservé OWNER/ADMIN, même périmètre que le rôle staff.
// Être J/A ne donne aucun droit sur le club : seulement sur les tournois qu'on lui assigne.
router.patch('/members/:userId/referee', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    if (typeof req.body?.isReferee !== 'boolean') return void res.status(400).json({ error: 'isReferee (boolean) requis' });
    res.json(await clubService.setMemberReferee(req.membership!.clubId, asString(req.params.userId), req.body.isReferee));
  } catch (e) { handleError(e, res, next); }
});

// Vivier des J/A (lecture seule : la facette se gère depuis /members/:userId/referee).
router.get('/referees', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await clubService.listReferees(req.membership!.clubId)); } catch (e) { handleError(e, res, next); }
});
```

Vérifier que `MEMBER_NOT_FOUND: 404` et `REFEREE_INVALID: 400` sont dans la table `ERROR_STATUS` d'`admin.ts` ; les ajouter sinon.

- [ ] **Step 4 : Lancer les tests**

Run: `node node_modules/jest/bin/jest.js src/routes/__tests__/admin.member-referee.routes.test.ts`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add backend/src/routes/admin.ts backend/src/services/club.service.ts backend/src/routes/__tests__/admin.member-referee.routes.test.ts
git commit -m "feat(admin): routes facette J/A + vivier (gate ADMIN)"
```

---

### Task 8 : Routes de l'espace J/A + `/me/facets` (et retrait de `/me/coach`)

**Files:**
- Modify: `backend/src/routes/clubs.ts` (codes d'erreur `:103-108`, bloc coach `:279-323`)
- Test: `backend/src/routes/__tests__/clubs.referee.routes.test.ts` (create)
- Test: `backend/src/routes/__tests__/clubs.coach.routes.test.ts` (retrait du cas `GET /me/coach`)

- [ ] **Step 1 : Écrire les tests qui échouent**

Calquer sur `clubs.coach.routes.test.ts` (mocke `ensureActiveMembership` → `{ id: 'club-1' }`, cf. `:44-46`).

```ts
it('GET /me/facets — ne 403 jamais, renvoie les deux facettes', async () => {
  (prisma.club.findUnique as jest.Mock).mockResolvedValue({ id: 'club-1', status: 'ACTIVE' });
  (lessonService.resolveCoach as jest.Mock).mockResolvedValue({ id: 'coach-1' });
  (tournamentService.resolveReferee as jest.Mock).mockResolvedValue(false);
  const res = await request(app).get('/api/clubs/demo/me/facets').set('Authorization', 'Bearer t');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ isCoach: true, isReferee: false });
});

it('GET /me/facets — club inconnu : tout à false, jamais 404', async () => {
  (prisma.club.findUnique as jest.Mock).mockResolvedValue(null);
  const res = await request(app).get('/api/clubs/nope/me/facets').set('Authorization', 'Bearer t');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ isCoach: false, isReferee: false });
});

it('GET /me/referee/tournaments — 403 NOT_A_REFEREE sans la facette', async () => {
  (tournamentService.resolveReferee as jest.Mock).mockResolvedValue(false);
  const res = await request(app).get('/api/clubs/demo/me/referee/tournaments').set('Authorization', 'Bearer t');
  expect(res.status).toBe(403);
  expect(res.body.error).toBe('NOT_A_REFEREE');
});

it('GET /me/referee/tournaments — 200 avec la facette', async () => {
  (tournamentService.resolveReferee as jest.Mock).mockResolvedValue(true);
  (tournamentService.listRefereeTournaments as jest.Mock).mockResolvedValue([]);
  const res = await request(app).get('/api/clubs/demo/me/referee/tournaments?scope=past').set('Authorization', 'Bearer t');
  expect(res.status).toBe(200);
  expect(tournamentService.listRefereeTournaments).toHaveBeenCalledWith('club-1', expect.any(String), 'past');
});

it('POST /me/referee/tournaments/:id/registrations/:regId/promote — délègue', async () => {
  (tournamentService.resolveReferee as jest.Mock).mockResolvedValue(true);
  (tournamentService.refereePromoteRegistration as jest.Mock).mockResolvedValue({ id: 'r1' });
  const res = await request(app).post('/api/clubs/demo/me/referee/tournaments/t1/registrations/r1/promote').set('Authorization', 'Bearer t');
  expect(res.status).toBe(200);
});

it('DELETE .../registrations/:regId — 403 TOURNAMENT_NOT_YOURS', async () => {
  (tournamentService.resolveReferee as jest.Mock).mockResolvedValue(true);
  (tournamentService.refereeRemoveRegistration as jest.Mock).mockRejectedValue(new Error('TOURNAMENT_NOT_YOURS'));
  const res = await request(app).delete('/api/clubs/demo/me/referee/tournaments/t1/registrations/r1').set('Authorization', 'Bearer t');
  expect(res.status).toBe(403);
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Expected: FAIL — 404 sur toutes les routes.

- [ ] **Step 3 : Implémenter**

Dans `ERROR_STATUS` (`clubs.ts:103-108`), ajouter :

```ts
  NOT_A_REFEREE:         403,
  TOURNAMENT_NOT_YOURS:  403,
  TOURNAMENT_NOT_FOUND:  404,
```

**Remplacer** la route `GET /:slug/me/coach` (`clubs.ts:282-289`) par le signal unifié :

```ts
// Signal léger des facettes pour les entrées de menu (jamais 403 : ne bruite pas le menu).
// Remplace l'ancien GET /:slug/me/coach — deux facettes, un seul aller-retour.
router.get('/:slug/me/facets', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const club = await prisma.club.findUnique({ where: { slug: asString(req.params.slug) }, select: { id: true, status: true } });
    if (!club || club.status !== 'ACTIVE') return void res.json({ isCoach: false, isReferee: false });
    const [coach, isReferee] = await Promise.all([
      lessonService.resolveCoach(club.id, req.user!.id),
      tournamentService.resolveReferee(club.id, req.user!.id),
    ]);
    res.json({ isCoach: coach != null, isReferee });
  } catch (err) { handleError(err, res, next); }
});
```

Ajouter le bloc J/A après le bloc coach (`clubs.ts:323`) :

```ts
// --- Espace juge-arbitre : le J/A voit et gère SES tournois (gate = facette + propriété, PAS un rôle) ---

// Tournois du J/A (?scope=upcoming|past). 403 NOT_A_REFEREE sans la facette.
router.get('/:slug/me/referee/tournaments', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id: clubId } = await ensureActiveMembership(asString(req.params.slug), req.user!.id);
    if (!(await tournamentService.resolveReferee(clubId, req.user!.id))) throw new Error('NOT_A_REFEREE');
    const scope = asString(req.query.scope) === 'past' ? 'past' : 'upcoming';
    res.json(await tournamentService.listRefereeTournaments(clubId, req.user!.id, scope));
  } catch (err) { handleError(err, res, next); }
});

// Roster d'un tournoi du J/A.
router.get('/:slug/me/referee/tournaments/:id/registrations', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id: clubId } = await ensureActiveMembership(asString(req.params.slug), req.user!.id);
    if (!(await tournamentService.resolveReferee(clubId, req.user!.id))) throw new Error('NOT_A_REFEREE');
    res.json(await tournamentService.refereeListRegistrations(clubId, req.user!.id, asString(req.params.id)));
  } catch (err) { handleError(err, res, next); }
});

// Promotion d'un binôme en attente par le J/A.
router.post('/:slug/me/referee/tournaments/:id/registrations/:regId/promote', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id: clubId } = await ensureActiveMembership(asString(req.params.slug), req.user!.id);
    if (!(await tournamentService.resolveReferee(clubId, req.user!.id))) throw new Error('NOT_A_REFEREE');
    res.json(await tournamentService.refereePromoteRegistration(clubId, req.user!.id, asString(req.params.id), asString(req.params.regId)));
  } catch (err) { handleError(err, res, next); }
});

// Retrait d'un binôme par le J/A.
router.delete('/:slug/me/referee/tournaments/:id/registrations/:regId', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id: clubId } = await ensureActiveMembership(asString(req.params.slug), req.user!.id);
    if (!(await tournamentService.resolveReferee(clubId, req.user!.id))) throw new Error('NOT_A_REFEREE');
    res.json(await tournamentService.refereeRemoveRegistration(clubId, req.user!.id, asString(req.params.id), asString(req.params.regId)));
  } catch (err) { handleError(err, res, next); }
});
```

Vérifier que `tournamentService` est bien importé dans `clubs.ts` (il l'est déjà pour les routes publiques).

- [ ] **Step 4 : Retirer le cas mort du test coach**

Dans `backend/src/routes/__tests__/clubs.coach.routes.test.ts`, supprimer le(s) test(s) ciblant `GET /:slug/me/coach` (la route n'existe plus). Les cas `/me/coach/lessons*` restent.

- [ ] **Step 5 : Lancer les deux suites**

Run: `node node_modules/jest/bin/jest.js src/routes/__tests__/clubs.referee.routes.test.ts src/routes/__tests__/clubs.coach.routes.test.ts`
Expected: PASS des deux.

- [ ] **Step 6 : Commit**

```bash
git add backend/src/routes/clubs.ts backend/src/routes/__tests__/clubs.referee.routes.test.ts backend/src/routes/__tests__/clubs.coach.routes.test.ts
git commit -m "feat(tournois): routes espace J/A + /me/facets (remplace /me/coach)"
```

---

### Task 9 : Client API frontend

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1 : Ajouter les types**

À côté du bloc `// --- Espace coach (Mes cours) ---` :

```ts
// --- Espace juge-arbitre (Arbitrage) ---

export interface RefereePlayerRow {
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  phone: string | null;
  membershipNo: string | null;
}

export interface RefereeRegistrationRow {
  id: string;
  status: string;
  paymentStatus: string;
  waitlistPosition: number | null;
  captain: RefereePlayerRow;
  partner: RefereePlayerRow | null;
}

export interface RefereeTournamentRow {
  id: string;
  name: string;
  category: string;
  gender: string;
  status: string;
  startTime: string;
  endTime: string | null;
  registrationDeadline: string;
  maxTeams: number | null;
  confirmedCount: number;
  waitlistCount: number;
}

export interface ClubReferee {
  userId: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
}
```

- [ ] **Step 2 : Remplacer `getCoachStatus` par `getMyFacets` et ajouter les méthodes J/A**

Supprimer :
```ts
  getCoachStatus: (slug: string, token: string) =>
    request<{ isCoach: boolean }>(`/api/clubs/${slug}/me/coach`, {}, token),
```

Ajouter (bloc coach) :
```ts
  getMyFacets: (slug: string, token: string) =>
    request<{ isCoach: boolean; isReferee: boolean }>(`/api/clubs/${slug}/me/facets`, {}, token),
```

Ajouter (nouveau bloc J/A) :
```ts
  // --- Espace juge-arbitre (le J/A gère SES tournois) ---
  getRefereeTournaments: (slug: string, scope: 'upcoming' | 'past', token: string) =>
    request<RefereeTournamentRow[]>(`/api/clubs/${slug}/me/referee/tournaments?scope=${scope}`, {}, token),
  getRefereeRegistrations: (slug: string, tournamentId: string, token: string) =>
    request<RefereeRegistrationRow[]>(`/api/clubs/${slug}/me/referee/tournaments/${tournamentId}/registrations`, {}, token),
  refereePromoteRegistration: (slug: string, tournamentId: string, regId: string, token: string) =>
    request<{ id: string }>(`/api/clubs/${slug}/me/referee/tournaments/${tournamentId}/registrations/${regId}/promote`, { method: 'POST' }, token),
  refereeRemoveRegistration: (slug: string, tournamentId: string, regId: string, token: string) =>
    request<{ id: string }>(`/api/clubs/${slug}/me/referee/tournaments/${tournamentId}/registrations/${regId}`, { method: 'DELETE' }, token),
```

Ajouter aux méthodes admin (à côté de `adminSetMemberCoach`) :
```ts
  adminSetMemberReferee: (clubId: string, userId: string, isReferee: boolean, token: string) =>
    request<{ userId: string; isReferee: boolean }>(`/api/clubs/${clubId}/admin/members/${userId}/referee`, { method: 'PATCH', body: JSON.stringify({ isReferee }) }, token),
  adminGetReferees: (clubId: string, token: string) =>
    request<ClubReferee[]>(`/api/clubs/${clubId}/admin/referees`, {}, token),
```

- [ ] **Step 3 : Ajouter `isReferee` au type `Member`**

Dans l'interface `Member`, à côté de `isCoach` :
```ts
  isReferee: boolean;
```

Dans le type du tournoi admin (celui utilisé par `/admin/tournaments`), à côté de `contactInfo` :
```ts
  refereeUserId: string | null;
```

- [ ] **Step 4 : Vérifier le typage**

Run: `node node_modules/typescript/bin/tsc --noEmit -p frontend/tsconfig.json`
Expected: **une seule** erreur attendue — `ProfileMenu.tsx` qui appelle encore `getCoachStatus`. Elle disparaît en Task 11.

- [ ] **Step 5 : Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(api): types et methodes J/A + getMyFacets"
```

---

### Task 10 : Page `/me/refereeing` + carte

**Files:**
- Create: `frontend/components/referee/RefereeTournamentCard.tsx`
- Create: `frontend/app/me/refereeing/page.tsx`
- Test: `frontend/__tests__/MeRefereeing.test.tsx`

- [ ] **Step 1 : Écrire le test qui échoue**

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MeRefereeingPage from '@/app/me/refereeing/page';
import { api } from '@/lib/api';

jest.mock('@/lib/api');
jest.mock('@/lib/useAuth', () => ({ useAuth: () => ({ token: 't', ready: true }) }));
jest.mock('@/lib/ClubProvider', () => ({ useClub: () => ({ slug: 'demo', club: { id: 'c1', name: 'Demo', timezone: 'Europe/Paris' } }) }));
jest.mock('@/components/ClubNav', () => ({ ClubNav: () => null }));
jest.mock('@/components/ProfileMenu', () => ({ ProfileMenu: () => null }));

const tournoi = {
  id: 't1', name: 'P100 de printemps', category: 'P100', gender: 'MEN', status: 'PUBLISHED',
  startTime: '2026-09-01T08:00:00.000Z', endTime: null, registrationDeadline: '2026-08-25T22:00:00.000Z',
  maxTeams: 16, confirmedCount: 12, waitlistCount: 2,
};

it('affiche le message dédié pour un non-J/A (jamais un écran d’erreur)', async () => {
  (api.getRefereeTournaments as jest.Mock).mockRejectedValue(new Error('NOT_A_REFEREE'));
  render(<MeRefereeingPage />);
  expect(await screen.findByText(/réservé aux juges-arbitres/i)).toBeInTheDocument();
});

it('liste les tournois du J/A', async () => {
  (api.getRefereeTournaments as jest.Mock).mockResolvedValue([tournoi]);
  render(<MeRefereeingPage />);
  expect(await screen.findByText('P100 de printemps')).toBeInTheDocument();
  expect(screen.getByText(/12\s*\/\s*16/)).toBeInTheDocument();
});

it('ouvre le roster et promeut un binôme en attente', async () => {
  (api.getRefereeTournaments as jest.Mock).mockResolvedValue([tournoi]);
  (api.getRefereeRegistrations as jest.Mock).mockResolvedValue([
    { id: 'r1', status: 'WAITLISTED', paymentStatus: 'NONE', waitlistPosition: 1,
      captain: { firstName: 'Tom', lastName: 'Roy', avatarUrl: null, phone: '0600000001', membershipNo: '999' },
      partner: null },
  ]);
  (api.refereePromoteRegistration as jest.Mock).mockResolvedValue({ id: 'r1' });

  render(<MeRefereeingPage />);
  await userEvent.click(await screen.findByRole('button', { name: /inscrits/i }));
  expect(await screen.findByText(/Tom Roy/)).toBeInTheDocument();
  expect(screen.getByText('999')).toBeInTheDocument();          // licence visible
  await userEvent.click(screen.getByRole('button', { name: /promouvoir/i }));
  await waitFor(() => expect(api.refereePromoteRegistration).toHaveBeenCalledWith('demo', 't1', 'r1', 't'));
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `node node_modules/jest/bin/jest.js __tests__/MeRefereeing.test.tsx --rootDir frontend`
Expected: FAIL — module `@/app/me/refereeing/page` introuvable.

- [ ] **Step 3 : Écrire la carte**

`frontend/components/referee/RefereeTournamentCard.tsx` — calquée sur `components/coach/CoachLessonCard.tsx` (mêmes conventions de style : `th` du ThemeProvider, `fontUI`/`fontDisplay`, `th.shadow`).

```tsx
'use client';
import { RefereeTournamentRow, RefereeRegistrationRow } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';
import { formatDateShortTimeRange } from '@/lib/tournament';

export function RefereeTournamentCard({
  tournament, tz, registrations, open, editable, onToggle, onPromote, onRemove,
}: {
  tournament: RefereeTournamentRow;
  tz: string;
  registrations: RefereeRegistrationRow[] | null;
  open: boolean;
  editable: boolean;
  onToggle: () => void;
  onPromote: (regId: string) => void;
  onRemove: (regId: string) => void;
}) {
  const { th } = useTheme();
  const label = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`;

  return (
    <div style={{ background: th.surface, borderRadius: 14, boxShadow: th.shadow, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ fontFamily: th.fontDisplay, fontSize: 18, fontWeight: 700, margin: 0, color: th.text }}>{tournament.name}</h2>
        <span style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute }}>{tournament.category}</span>
      </div>

      <span style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>
        {formatDateShortTimeRange(tournament.startTime, tournament.endTime, tz)}
      </span>

      <span style={{ fontFamily: th.fontUI, fontSize: 13, color: th.text }}>
        {tournament.confirmedCount}{tournament.maxTeams != null ? ` / ${tournament.maxTeams}` : ''} binômes
        {tournament.waitlistCount > 0 ? ` · ${tournament.waitlistCount} en attente` : ''}
      </span>

      <button onClick={onToggle} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.accent }}>
        {open ? 'Masquer les inscrits' : 'Inscrits'}
      </button>

      {open && registrations && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {registrations.length === 0 && (
            <li style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textFaint }}>Aucun inscrit.</li>
          )}
          {registrations.map((r) => (
            <li key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Avatar name={label(r.captain)} url={r.captain.avatarUrl} color={colorForSeed(r.id)} size={26} />
              <span style={{ fontFamily: th.fontUI, fontSize: 13, color: th.text }}>
                {label(r.captain)}{r.partner ? ` & ${label(r.partner)}` : ''}
              </span>
              {r.captain.membershipNo && (
                <span style={{ fontFamily: th.fontUI, fontSize: 11, color: th.textFaint }}>{r.captain.membershipNo}</span>
              )}
              {r.captain.phone && (
                <a href={`tel:${r.captain.phone}`} style={{ fontFamily: th.fontUI, fontSize: 11, color: th.accent }}>{r.captain.phone}</a>
              )}
              {r.waitlistPosition != null && (
                <span style={{ fontFamily: th.fontUI, fontSize: 11, color: th.textMute }}>Attente #{r.waitlistPosition}</span>
              )}
              {editable && r.status === 'WAITLISTED' && (
                <button onClick={() => onPromote(r.id)} style={{ marginLeft: 'auto', background: th.accent, color: th.onAccent, border: 'none', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12, fontWeight: 600 }}>
                  Promouvoir
                </button>
              )}
              {editable && (
                <button onClick={() => onRemove(r.id)} aria-label={`Retirer ${label(r.captain)}`} style={{ background: 'none', border: 'none', cursor: 'pointer', color: th.textFaint, fontSize: 16, lineHeight: 1 }}>
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

> Vérifier les signatures réelles de `Avatar` (prop `url` vs `avatarUrl`) et de `formatDateShortTimeRange` dans `frontend/lib/tournament.ts` avant de compiler — les aligner si elles diffèrent.

- [ ] **Step 4 : Écrire la page**

`frontend/app/me/refereeing/page.tsx` — clone structurel de `app/me/coaching/page.tsx` :

```tsx
'use client';
import { useState, useEffect, useCallback } from 'react';
import { api, RefereeTournamentRow, RefereeRegistrationRow } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { Screen } from '@/components/ui/Screen';
import { Segmented } from '@/components/ui/atoms';
import { ClubNav } from '@/components/ClubNav';
import { ProfileMenu } from '@/components/ProfileMenu';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { RefereeTournamentCard } from '@/components/referee/RefereeTournamentCard';

/**
 * Espace juge-arbitre « Arbitrage » : le J/A connecté voit et gère les inscrits de SES
 * tournois, sans être STAFF. Gate serveur = facette isReferee + propriété du tournoi
 * (NOT_A_REFEREE mappé sur un message dédié, jamais un écran d'erreur générique).
 */
export default function MeRefereeingPage() {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { slug, club } = useClub();
  const tz = club?.timezone ?? 'Europe/Paris';
  const [scope, setScope] = useState<'upcoming' | 'past'>('upcoming');
  const [tournaments, setTournaments] = useState<RefereeTournamentRow[]>([]);
  const [rosters, setRosters] = useState<Record<string, RefereeRegistrationRow[]>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notReferee, setNotReferee] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removeFor, setRemoveFor] = useState<{ tournamentId: string; regId: string } | null>(null);

  const load = useCallback(async () => {
    if (!token || !slug) return;
    setLoading(true);
    try {
      setError(null); setNotReferee(false);
      setTournaments(await api.getRefereeTournaments(slug, scope, token));
    } catch (e) {
      if ((e as Error).message === 'NOT_A_REFEREE') setNotReferee(true);
      else setError((e as Error).message);
    } finally { setLoading(false); }
  }, [token, slug, scope]);

  useEffect(() => { if (ready && token && slug) load(); }, [ready, token, slug, load]);

  const loadRoster = useCallback(async (tournamentId: string) => {
    if (!token || !slug) return;
    try { setRosters((r) => ({ ...r, [tournamentId]: [] })); setRosters((r) => ({ ...r, [tournamentId]: await api.getRefereeRegistrations(slug, tournamentId, token) })); }
    catch (e) { setError((e as Error).message); }
  }, [token, slug]);

  const toggle = (id: string) => {
    if (openId === id) return void setOpenId(null);
    setOpenId(id);
    if (!rosters[id]) void loadRoster(id);
  };

  const doPromote = async (tournamentId: string, regId: string) => {
    if (!token || !slug) return;
    try { await api.refereePromoteRegistration(slug, tournamentId, regId, token); await loadRoster(tournamentId); await load(); }
    catch (e) { setError((e as Error).message); }
  };

  const doRemove = async () => {
    if (!token || !slug || !removeFor) return;
    try { await api.refereeRemoveRegistration(slug, removeFor.tournamentId, removeFor.regId, token); const id = removeFor.tournamentId; setRemoveFor(null); await loadRoster(id); await load(); }
    catch (e) { setError((e as Error).message); setRemoveFor(null); }
  };

  return (
    <Screen>
      {slug && club && <ClubNav club={club} />}
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '16px 16px 40px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 24, margin: 0, color: th.text }}>Arbitrage</h1>
          <span style={{ marginLeft: 'auto' }}><ProfileMenu /></span>
        </div>

        {notReferee ? (
          <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute }}>Cet espace est réservé aux juges-arbitres du club.</p>
        ) : (
          <>
            <Segmented<'upcoming' | 'past'> value={scope} onChange={setScope}
              options={[{ value: 'upcoming', label: 'À venir' }, { value: 'past', label: 'Passés' }]} />
            {error && <div style={{ background: th.accent, color: th.onAccent, borderRadius: 10, padding: '9px 12px', fontFamily: th.fontUI, fontSize: 13 }}>{error}</div>}
            {loading ? (
              <span style={{ fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</span>
            ) : tournaments.length === 0 ? (
              <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textFaint }}>{scope === 'upcoming' ? 'Aucun tournoi à venir.' : 'Aucun tournoi passé.'}</p>
            ) : (
              tournaments.map((t) => (
                <RefereeTournamentCard key={t.id} tournament={t} tz={tz}
                  registrations={rosters[t.id] ?? null} open={openId === t.id} editable={scope === 'upcoming'}
                  onToggle={() => toggle(t.id)}
                  onPromote={(regId) => doPromote(t.id, regId)}
                  onRemove={(regId) => setRemoveFor({ tournamentId: t.id, regId })} />
              ))
            )}
          </>
        )}
      </div>

      {removeFor && (
        <ConfirmDialog title="Retirer le binôme ?" message="Il sera désinscrit du tournoi. Le premier en attente sera promu."
          confirmLabel="Retirer" onConfirm={doRemove} onCancel={() => setRemoveFor(null)} />
      )}
    </Screen>
  );
}
```

- [ ] **Step 5 : Lancer les tests**

Run: `node node_modules/jest/bin/jest.js __tests__/MeRefereeing.test.tsx --rootDir frontend`
Expected: PASS (3/3).

- [ ] **Step 6 : Commit**

```bash
git add frontend/app/me/refereeing/page.tsx frontend/components/referee/RefereeTournamentCard.tsx frontend/__tests__/MeRefereeing.test.tsx
git commit -m "feat(arbitrage): espace J/A /me/refereeing"
```

---

### Task 11 : `ProfileMenu` — `/me/facets` + entrée « Arbitrage »

**Files:**
- Modify: `frontend/components/ProfileMenu.tsx` (`:58`, `:165`)
- Test: `frontend/__tests__/ProfileMenu.test.tsx`

> ⚠️ **Ces deux fichiers étaient en WIP chez Eric.** Vérifier `git status` avant de toucher, et ne committer que ces deux chemins.

- [ ] **Step 1 : Écrire les tests qui échouent**

Dans `ProfileMenu.test.tsx`, remplacer les mocks `getCoachStatus` par `getMyFacets` (lignes 22, 59, 156, 165) et ajouter :

```tsx
it('affiche « Arbitrage » pour un J/A', async () => {
  (api.getMyFacets as jest.Mock).mockResolvedValue({ isCoach: false, isReferee: true });
  renderMenu();
  await userEvent.click(screen.getByRole('button', { name: /profil/i }));
  expect(await screen.findByText('Arbitrage')).toBeInTheDocument();
});

it('masque « Arbitrage » pour un non-J/A', async () => {
  (api.getMyFacets as jest.Mock).mockResolvedValue({ isCoach: false, isReferee: false });
  renderMenu();
  await userEvent.click(screen.getByRole('button', { name: /profil/i }));
  await screen.findByText('Mon profil');
  expect(screen.queryByText('Arbitrage')).not.toBeInTheDocument();
});

it('n’appelle les facettes qu’à l’ouverture du menu (paresse)', () => {
  renderMenu();
  expect(api.getMyFacets).not.toHaveBeenCalled();
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `node node_modules/jest/bin/jest.js __tests__/ProfileMenu.test.tsx --rootDir frontend`
Expected: FAIL — `api.getMyFacets is not a function`.

- [ ] **Step 3 : Implémenter**

Ajouter l'état à côté de `isCoach` :
```tsx
  const [isReferee, setIsReferee] = useState(false);
```

Remplacer la ligne `:58` :
```tsx
        api.getMyFacets(slug, token).then((r) => { setIsCoach(r.isCoach); setIsReferee(r.isReferee); }).catch(() => {});
```

Après l'entrée « Mes cours » (`:165`) :
```tsx
        {slug && isReferee && <MenuItem icon="trophy" label="Arbitrage" onClick={() => go('/me/refereeing')} />}
```

> **Conserver impérativement la paresse** (appel dans `toggle`, jamais au montage) : c'est elle qui a évité de casser les suites *real-mount* `ClubNav`.

- [ ] **Step 4 : Lancer les tests + le typage**

Run: `node node_modules/jest/bin/jest.js __tests__/ProfileMenu.test.tsx --rootDir frontend`
Expected: PASS.

Run: `node node_modules/typescript/bin/tsc --noEmit -p frontend/tsconfig.json`
Expected: plus aucune erreur `getCoachStatus`.

- [ ] **Step 5 : Commit**

```bash
git add frontend/components/ProfileMenu.tsx frontend/__tests__/ProfileMenu.test.tsx
git commit -m "feat(menu): entree Arbitrage + getMyFacets (remplace getCoachStatus)"
```

---

### Task 12 : Admin — case J/A sur la fiche membre, segment, CSV

**Files:**
- Modify: `frontend/components/admin/members/MemberPanel.tsx` (`:100-106`)
- Modify: `frontend/app/admin/members/page.tsx` (`:183-187`, `:220`)
- Modify: `frontend/lib/members.ts` (`:8`, `:17-27`, `:40-47`, `:120`)
- Test: `frontend/__tests__/members.test.ts`, `frontend/__tests__/AdminMembersStaff.test.tsx`

- [ ] **Step 1 : Écrire les tests qui échouent**

Dans `frontend/__tests__/members.test.ts` :
```ts
it('segment referee : ne garde que les J/A', () => {
  const ms = [mk({ userId: 'a', isReferee: true }), mk({ userId: 'b', isReferee: false })];
  expect(filterMembers(ms, '', 'referee').map((m) => m.userId)).toEqual(['a']);
});

it('segCounts compte les J/A', () => {
  const ms = [mk({ isReferee: true }), mk({ isReferee: true }), mk({ isReferee: false })];
  expect(segCounts(ms).referee).toBe(2);
});

it('le CSV porte une colonne J/A', () => {
  const csv = membersToCsv([mk({ isReferee: true })]);
  expect(csv.split('\n')[0]).toContain('J/A');
  expect(csv.split('\n')[1]).toContain('Oui');
});
```

Dans `frontend/__tests__/AdminMembersStaff.test.tsx` :
```tsx
it('coche la facette J/A', async () => {
  (api.adminSetMemberReferee as jest.Mock).mockResolvedValue({ userId: 'u1', isReferee: true });
  renderPage({ role: 'ADMIN' });
  await userEvent.click(await screen.findByText(/Léa Girard/));
  await userEvent.click(screen.getByLabelText(/Juge-arbitre/i));
  await waitFor(() => expect(api.adminSetMemberReferee).toHaveBeenCalledWith('club-1', 'u1', true, 't'));
});

it('la case J/A est masquée pour un STAFF', async () => {
  renderPage({ role: 'STAFF' });
  await userEvent.click(await screen.findByText(/Léa Girard/));
  expect(screen.queryByLabelText(/Juge-arbitre/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Expected: FAIL — `'referee'` n'est pas un `MemberSeg` valide (erreur TS/jest).

- [ ] **Step 3 : Implémenter `lib/members.ts`**

```ts
export type MemberSeg = 'all' | 'subs' | 'staff' | 'coach' | 'referee' | 'watch' | 'blocked';
```
Dans `inSeg` (`:17`), à côté de `case 'coach'` :
```ts
    case 'referee': return !!m.isReferee;
```
Dans `segCounts` (`:41`), initialiser et compter :
```ts
  const c: Record<MemberSeg, number> = { all: 0, subs: 0, staff: 0, coach: 0, referee: 0, watch: 0, blocked: 0 };
```
```ts
    if (m.isReferee) c.referee++;
```
Dans la ligne CSV (`:120`), après la colonne Coach — **et ajouter `'J/A'` à l'en-tête au même rang** :
```ts
    m.isReferee ? 'Oui' : 'Non',
```

- [ ] **Step 4 : Implémenter `MemberPanel.tsx`**

Ajouter la prop `onSetReferee: (v: boolean) => void` à la signature, puis, sous la case Coach (`:105`) :

```tsx
          <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 14, color: th.text }}>
            <input type="checkbox" checked={!!member.isReferee} onChange={(e) => onSetReferee(e.target.checked)} style={{ width: 18, height: 18, accentColor: th.accent, cursor: 'pointer' }} />
            Juge-arbitre — pilote des tournois
          </label>
```

- [ ] **Step 5 : Implémenter `app/admin/members/page.tsx`**

À côté de `setCoach` (`:183`) :
```tsx
  const setReferee = async (userId: string, isReferee: boolean) => {
    if (!token || !club) return;
    try { await api.adminSetMemberReferee(club.id, userId, isReferee, token); await load(); }
    catch (e) { setError((e as Error).message); }
  };
```
Passer `onSetReferee={(v) => setReferee(selected.userId, v)}` au `MemberPanel`, et ajouter la pastille de segment à côté de « Coachs » (`:220`) :
```tsx
  { value: 'referee', label: `J/A (${counts.referee})` },
```

- [ ] **Step 6 : Lancer les tests**

Run: `node node_modules/jest/bin/jest.js __tests__/members.test.ts __tests__/AdminMembersStaff.test.tsx --rootDir frontend`
Expected: PASS.

- [ ] **Step 7 : Commit**

```bash
git add frontend/lib/members.ts frontend/components/admin/members/MemberPanel.tsx frontend/app/admin/members/page.tsx frontend/__tests__/members.test.ts frontend/__tests__/AdminMembersStaff.test.tsx
git commit -m "feat(admin): case J/A sur la fiche membre + segment + CSV"
```

---

### Task 13 : Admin — picker du J/A dans le formulaire du tournoi

**Files:**
- Modify: `frontend/app/admin/tournaments/page.tsx` (près du champ `contactInfo`, `:196`)
- Test: `frontend/__tests__/AdminTournaments.test.tsx`

- [ ] **Step 1 : Écrire les tests qui échouent**

```tsx
it('désigne un J/A dans le formulaire', async () => {
  (api.adminGetReferees as jest.Mock).mockResolvedValue([
    { userId: 'u1', firstName: 'Léa', lastName: 'Girard', avatarUrl: null },
  ]);
  renderPage();
  await userEvent.selectOptions(await screen.findByLabelText(/Juge-arbitre/i), 'u1');
  await userEvent.click(screen.getByRole('button', { name: /créer/i }));
  await waitFor(() => expect(api.adminCreateTournament).toHaveBeenCalledWith(
    'club-1', expect.objectContaining({ refereeUserId: 'u1' }), 't',
  ));
});

it('« Aucun » envoie refereeUserId null', async () => {
  (api.adminGetReferees as jest.Mock).mockResolvedValue([]);
  renderPage();
  await userEvent.click(screen.getByRole('button', { name: /créer/i }));
  await waitFor(() => expect(api.adminCreateTournament).toHaveBeenCalledWith(
    'club-1', expect.objectContaining({ refereeUserId: null }), 't',
  ));
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Expected: FAIL — pas de champ « Juge-arbitre ».

- [ ] **Step 3 : Implémenter**

Charger le vivier dans le `load()` existant de la page :
```tsx
  const [referees, setReferees] = useState<ClubReferee[]>([]);
```
```tsx
    setReferees(await api.adminGetReferees(club.id, token).catch(() => []));
```

Ajouter le champ à côté de « Contact » (le vivier est court : un `<select>` suffit, pas de picker de recherche) :
```tsx
  <label style={label} htmlFor="referee">Juge-arbitre</label>
  <select id="referee" value={form.refereeUserId ?? ''} onChange={(e) => setForm({ ...form, refereeUserId: e.target.value || null })} style={input}>
    <option value="">Aucun</option>
    {referees.map((r) => <option key={r.userId} value={r.userId}>{r.firstName} {r.lastName}</option>)}
  </select>
  <span style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute }}>
    Il pourra gérer les inscrits de ce tournoi depuis son espace Arbitrage, sans autre accès au club.
    Cochez « Juge-arbitre » sur la fiche d’un membre pour l’ajouter à cette liste.
  </span>
```

Inclure `refereeUserId: form.refereeUserId ?? null` dans le body de création **et** d'édition.

- [ ] **Step 4 : Lancer les tests**

Run: `node node_modules/jest/bin/jest.js __tests__/AdminTournaments.test.tsx --rootDir frontend`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add frontend/app/admin/tournaments/page.tsx frontend/__tests__/AdminTournaments.test.tsx
git commit -m "feat(admin): designation du J/A dans le formulaire tournoi"
```

---

### Task 14 : Fiche publique du tournoi — le J/A affiché

**Files:**
- Modify: `backend/src/services/tournament.service.ts` (`getById`)
- Modify: `frontend/app/tournois/[id]/page.tsx`
- Test: `backend/src/services/__tests__/tournament.service.test.ts`

**Règle :** **nom seul**. Ni téléphone, ni e-mail, ni licence — `contactInfo` reste le canal du club.

- [ ] **Step 1 : Écrire le test backend qui échoue**

```ts
it('getById expose le nom du J/A, jamais son userId ni son contact', async () => {
  (prisma.tournament.findUnique as jest.Mock).mockResolvedValue({
    id: 't1', clubId: 'club-1', name: 'P100', registrations: [],
    referee: { firstName: 'Julien', lastName: 'Martin' },
    clubSport: { sport: { key: 'padel', name: 'Padel' } },
  });
  const dto = await tournamentService.getById('t1');
  expect(dto.referee).toEqual({ name: 'Julien Martin' });
  expect(JSON.stringify(dto)).not.toContain('userId');
});

it('getById : referee null si aucun J/A désigné', async () => {
  (prisma.tournament.findUnique as jest.Mock).mockResolvedValue({
    id: 't1', clubId: 'club-1', name: 'P100', registrations: [], referee: null,
    clubSport: { sport: { key: 'padel', name: 'Padel' } },
  });
  expect((await tournamentService.getById('t1')).referee).toBeNull();
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Expected: FAIL — `dto.referee` est `undefined`.

- [ ] **Step 3 : Implémenter**

Dans le `select`/`include` de `getById`, ajouter :
```ts
        referee: { select: { firstName: true, lastName: true } },
```
Dans la projection de sortie, à côté de `contactInfo` :
```ts
      referee: t.referee ? { name: `${t.referee.firstName} ${t.referee.lastName}`.trim() } : null,
```
et **retirer `refereeUserId` de la projection publique** s'il y transite (jamais exposé).

- [ ] **Step 4 : Afficher côté front**

Type `Tournament` dans `frontend/lib/api.ts` :
```ts
  referee?: { name: string } | null;
```
Dans `frontend/app/tournois/[id]/page.tsx`, ajouter une carte méta à la rangée existante (`MetaCardsRow`), rendue **seulement si** `tournament.referee` :
```tsx
  ...(tournament.referee ? [{ label: 'Juge-arbitre', value: tournament.referee.name }] : []),
```

- [ ] **Step 5 : Lancer les tests**

Run: `node node_modules/jest/bin/jest.js src/services/__tests__/tournament.service.test.ts -t "getById"`
Expected: PASS.

- [ ] **Step 6 : Commit**

```bash
git add backend/src/services/tournament.service.ts backend/src/services/__tests__/tournament.service.test.ts frontend/lib/api.ts frontend/app/tournois/\[id\]/page.tsx
git commit -m "feat(tournois): J/A affiche sur la fiche publique"
```

---

### Task 15 : Amendement de la spec du moteur + CLAUDE.md

**Files:**
- Modify: `docs/superpowers/specs/2026-07-07-tournois-tableaux-scores-design.md`
- Modify: `docs/superpowers/plans/2026-07-07-tournois-tableaux-scores.md`
- Modify: `CLAUDE.md`

**C'est le cœur du bénéfice de timing** : sans cet amendement, le moteur naîtra staff-only et il faudra le rétrofitter.

- [ ] **Step 1 : Amender la spec du moteur**

Dans le tableau « Décisions clés », remplacer la ligne :
```
| Scores | **Staff seul** (OWNER/ADMIN/STAFF), pas de flux joueur |
```
par :
```
| Scores | **Staff + le J/A du tournoi** (`Tournament.refereeUserId`, cf. `2026-07-17-juge-arbitre-tournoi-design.md`), pas de flux joueur |
```

Dans la section Routes (« sous `/api/clubs/:clubId/admin/tournaments/:id/draw`, staff existant »), ajouter :

> **Deux chemins d'autorité.** La surface du tableau accepte le staff (gate `requireClubMember('STAFF')` hérité) **et** le J/A désigné du tournoi (gate `resolveReferee` + `assertRefereeOwnsTournament`, cf. la spec J/A). Un J/A n'est pas staff : prévoir les routes `/me/referee/tournaments/:id/draw*` en miroir, ou un gate composite. À trancher au brainstorming du moteur — mais **pas après**.

- [ ] **Step 2 : Amender le plan du moteur**

Ajouter un encadré en tête, sous le header :

> ⚠️ **Ce plan précède la spec J/A du 2026-07-17.** Sa décision « scores = staff seul » est **amendée** : le J/A du tournoi doit aussi pouvoir piloter le tableau. Re-cadrer les tâches de routes admin avant exécution.

- [ ] **Step 3 : Documenter dans CLAUDE.md**

Ajouter, sous la section « ## Tournois (v1 — inscriptions) ✅ implémenté », un paragraphe d'évolution résumant : facette `ClubMembership.isReferee` + `Tournament.refereeUserId`, migration `add_tournament_referee`, gate à deux étages, espace `/me/refereeing`, `/me/facets` (remplace `/me/coach`), garde `REFEREE_INVALID`, J/A sur la fiche publique, **aucun rôle ajouté**, et le renvoi vers spec + plan.

- [ ] **Step 4 : Commit**

```bash
git add docs/superpowers/specs/2026-07-07-tournois-tableaux-scores-design.md docs/superpowers/plans/2026-07-07-tournois-tableaux-scores.md CLAUDE.md
git commit -m "docs(tournois): amendement moteur (staff + J/A) + CLAUDE.md"
```

---

### Task 16 : Vérification de bout en bout

- [ ] **Step 1 : Suites backend**

Run: `cd backend && node ../node_modules/jest/bin/jest.js` (ou le runner du repo)
Expected: vert. **Baseline connue** : 3 échecs `icon.routes` sont pré-existants hors worktree principal — ne pas les imputer à ce travail.

- [ ] **Step 2 : Suites frontend ciblées**

Run: `node node_modules/jest/bin/jest.js __tests__/MeRefereeing.test.tsx __tests__/ProfileMenu.test.tsx __tests__/members.test.ts __tests__/AdminMembersStaff.test.tsx __tests__/AdminTournaments.test.tsx --rootDir frontend`
Expected: vert.

> ⚠️ La suite frontend **complète** montre ~6 échecs `BookingModal` qui sont un **flake d'isolation pré-existant** (vert en isolation). Ne pas les imputer à ce travail.

- [ ] **Step 3 : Portes de typage** (jest ne type-check pas : `ts-jest` + `isolatedModules`)

Run: `node node_modules/typescript/bin/tsc --noEmit -p backend/tsconfig.json`
Run: `node node_modules/typescript/bin/tsc --noEmit -p frontend/tsconfig.json`
Expected: aucune erreur sur les fichiers de ce plan (grep ciblé — du WIP parallèle peut bruiter).

- [ ] **Step 4 : Vérification live contre la vraie base**

```bash
# 1. Cocher la facette sur un membre depuis /admin/members
# 2. Le désigner J/A d'un tournoi depuis /admin/tournaments
# 3. Se connecter avec CE compte (non-staff) → « Arbitrage » dans le menu profil
# 4. /me/refereeing : le tournoi apparaît, les inscrits aussi (licence + téléphone)
# 5. Promouvoir un binôme en attente → il passe CONFIRMED
# 6. Décocher la facette → l'accès tombe (NOT_A_REFEREE), le tournoi garde son refereeUserId
# 7. Recocher → l'accès revient
# 8. Vérifier qu'un STAFF voit toujours TOUS les tournois dans /admin/tournaments
```
Expected: les 8 étapes passent. Le point 6 est **le test le plus important** : c'est le kill-switch.

- [ ] **Step 5 : Vérification visuelle (skill `verify`)**

`/me/refereeing` et `/admin/members` (panneau), **clair + sombre**, **desktop 1280 + mobile 390**.
Expected: aucun débordement horizontal (`scrollWidth <= viewport`).

> ⚠️ Émulation mobile : utiliser **`mobile:false` + largeur fixe 390** — `mobile:true` auto-fit le viewport et **masque** les vrais débordements.

---

## Self-Review

**Couverture de la spec :** §3 modèle → T1 · §4 gate → T2 · §5 service+routes → T3/T4/T8 · §6 front (page, menu, admin) → T10/T11/T12/T13 · §7 fiche publique → T14 · §8 amendement moteur → T15 · §9 « ce qui ne change pas » → vérifié en T16 étape 4.8 (le staff garde l'accès). **Ajout hors spec, assumé :** la garde `REFEREE_INVALID` (T5) — la spec décrivait la désignation sans dire qu'elle devait être validée serveur ; sans ça, `PATCH` désignerait n'importe quel `User` de la plateforme. C'est un trou de sécurité, pas une extension de périmètre.

**Cohérence des types :** `resolveReferee` renvoie un `boolean` partout (T2, T5, T8) — noter l'écart **volontaire** avec `resolveCoach` qui renvoie `{ id } | null` (le coach a une ligne à identifier ; le J/A est un `userId` qu'on a déjà). `refereeUserId: string | null` cohérent T1/T5/T9/T13. `RefereeTournamentRow`/`RefereeRegistrationRow`/`RefereePlayerRow` identiques back (T3) et front (T9), aux `Date`→`string` près de la sérialisation JSON.

**Points d'attention notés :** `Avatar`/`formatDateShortTimeRange` (T10) à vérifier avant compilation ; l'en-tête CSV et la ligne CSV doivent bouger **ensemble** (T12) ; `MemberHistory.test.tsx` n'a pas de `clearAllMocks`.
