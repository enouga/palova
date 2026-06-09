# Tournois — Licence joueur + annuaire de coéquipier — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre au joueur de saisir lui-même sa licence (n° adhérent) à ce club, et remplacer le champ e-mail du coéquipier par un annuaire de recherche par nom (sélection par identifiant, sans exposer d'e-mail).

**Architecture:** Backend Express 5 + Prisma 7. Le service `TournamentService` passe d'une inscription par `partnerEmail` à une inscription par `partnerUserId`. Trois nouvelles routes club-scoped (`clubs.ts` + `ClubService`) : recherche de membres, lecture et écriture de sa propre adhésion (licence). Frontend Next.js 16 : la page `/tournois/[id]` gagne un champ licence et un composant de recherche `PartnerSearch`. Migration Prisma : **aucune** (`membershipNo` existe déjà). Spec : `docs/superpowers/specs/2026-06-09-tournois-licence-annuaire-design.md`.

**Tech Stack:** TypeScript, Prisma 7 (adapter-pg), PostgreSQL, Jest + jest-mock-extended (deep mock Prisma via `__mocks__/prisma`), React 19.

**Conventions respectées (vérifiées dans le code) :**
- Service : classe, `import { prisma } from '../db/prisma'`, `throw new Error('CODE')`, erreurs métier avec `subject` via `appError`.
- Tests service : `import '../../__mocks__/prisma'` + `prismaMock`, pas de vraie DB.
- Routes : table `ERROR_STATUS` + `handleError` + helper `asString`. Auth via `authMiddleware` + `AuthRequest` (`req.user!.id`).
- Décimaux/dates renvoyés bruts.

---

## File Structure

**Backend (modifiés) :**
- `backend/src/services/tournament.service.ts` — `register`/`changePartner`/`resolveAndAssertEligible` par `partnerUserId`.
- `backend/src/services/__tests__/tournament.service.test.ts` — tests adaptés.
- `backend/src/services/club.service.ts` — `searchMembers`, `getMyMembership`, `setMyMembership`.
- `backend/src/routes/tournaments.ts` — body `partnerUserId`.
- `backend/src/routes/clubs.ts` — 3 routes + entrées `ERROR_STATUS`.

**Backend (créés) :**
- `backend/src/services/__tests__/club.service.test.ts` — tests des 3 méthodes `ClubService`.

**Frontend (modifiés) :**
- `frontend/lib/api.ts` — types + méthodes (recherche, adhésion) ; `partnerUserId`.
- `frontend/app/tournois/[id]/page.tsx` — licence dans `ProfileCompletion` + composant `PartnerSearch`.

---

## Task 1 : Service — inscription par `partnerUserId`

**Files:**
- Modify: `backend/src/services/tournament.service.ts`
- Test: `backend/src/services/__tests__/tournament.service.test.ts`

- [ ] **Step 1 : Adapter les tests pour exprimer la résolution par id** (le coéquipier est passé par son `userId`, pas son e-mail)

Dans `backend/src/services/__tests__/tournament.service.test.ts`, remplacer le helper `mockEligibleHappyPath` :

```typescript
/** Configure le chemin nominal d'éligibilité (2 hommes membres ACTIVE, tél + licence + sexe OK). */
function mockEligibleHappyPath() {
  prismaMock.user.findUnique.mockImplementation((args: any) => {
    if (args.where.id === 'captain') return Promise.resolve({ id: 'captain', sex: 'MALE', phone: '0600000001' }) as any;
    if (args.where.id === 'partner') return Promise.resolve({ id: 'partner', sex: 'MALE', phone: '0600000002' }) as any;
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
```

Dans le `describe('TournamentService.register', …)`, remplacer chaque appel `service.register('t1', 'captain', 'partner@x.fr')` par `service.register('t1', 'captain', 'partner')`. Puis remplacer les 2 tests suivants par ces versions (résolution par id) :

```typescript
  it('lève PARTNER_NOT_FOUND si le coéquipier n a pas de compte', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(tournament() as any);
    prismaMock.user.findUnique.mockImplementation((args: any) =>
      (args.where.id === 'captain' ? Promise.resolve({ id: 'captain', sex: 'MALE', phone: '0600' }) : Promise.resolve(null)) as any);
    await expect(service.register('t1', 'captain', 'ghost')).rejects.toThrow('PARTNER_NOT_FOUND');
  });

  it('lève MEMBERSHIP_REQUIRED si le coéquipier n est pas membre', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(tournament() as any);
    prismaMock.user.findUnique.mockImplementation((args: any) => {
      if (args.where.id === 'captain') return Promise.resolve({ id: 'captain', sex: 'MALE', phone: '0600' }) as any;
      if (args.where.id === 'partner') return Promise.resolve({ id: 'partner', sex: 'MALE', phone: '0601' }) as any;
      return Promise.resolve(null) as any;
    });
    prismaMock.clubMembership.findUnique.mockImplementation((args: any) =>
      (args.where.userId_clubId.userId === 'captain' ? Promise.resolve({ status: 'ACTIVE', membershipNo: 'L1' }) : Promise.resolve(null)) as any);
    await expect(service.register('t1', 'captain', 'partner')).rejects.toThrow('MEMBERSHIP_REQUIRED');
  });
```

Et le test `SEX_REQUIRED`, remplacer le bloc `prismaMock.user.findUnique.mockImplementation` par :

```typescript
    prismaMock.user.findUnique.mockImplementation((args: any) => {
      if (args.where.id === 'captain') return Promise.resolve({ id: 'captain', sex: null, phone: '0600' }) as any;
      if (args.where.id === 'partner') return Promise.resolve({ id: 'partner', sex: 'MALE', phone: '0601' }) as any;
      return Promise.resolve(null) as any;
    });
```
(et l'appel devient `service.register('t1', 'captain', 'partner')`)

Dans le `describe('TournamentService.changePartner / cancelRegistration', …)`, test « change de coéquipier » : remplacer le mock user + l'appel :

```typescript
    prismaMock.user.findUnique.mockImplementation((args: any) => {
      if (args.where.id === 'captain') return Promise.resolve({ id: 'captain', sex: 'MALE', phone: '0600' }) as any;
      if (args.where.id === 'newp') return Promise.resolve({ id: 'newp', sex: 'MALE', phone: '0602' }) as any;
      return Promise.resolve(null) as any;
    });
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE', membershipNo: 'L' } as any);
    prismaMock.tournamentRegistration.update.mockResolvedValue({ id: 'reg-1', partnerUserId: 'newp' } as any);

    await service.changePartner('t1', 'captain', 'newp');
```

Et le test `REGISTRATION_LOCKED` : `await expect(service.changePartner('t1', 'captain', 'newp')).rejects.toThrow('REGISTRATION_LOCKED');`

- [ ] **Step 2 : Lancer les tests, vérifier qu'ils ÉCHOUENT**

Run (depuis `backend/`) : `npm test -- tournament.service`
Expected : FAIL — la signature actuelle résout par e-mail (`args.where.email`), les mocks par `id` renvoient `null` → `PARTNER_NOT_FOUND`.

- [ ] **Step 3 : Refactorer le service vers `partnerUserId`**

Dans `backend/src/services/tournament.service.ts`, remplacer la méthode `register` (commentaire inclus) :

```typescript
  /** Inscrit un binôme (capitaine connecté + coéquipier par identifiant). */
  async register(tournamentId: string, captainUserId: string, partnerUserId: string) {
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { id: true, clubId: true, gender: true, status: true, registrationDeadline: true, maxTeams: true },
    });
    if (!tournament) throw new Error('TOURNAMENT_NOT_FOUND');
    if (tournament.status !== 'PUBLISHED') throw new Error('TOURNAMENT_NOT_OPEN');
    if (new Date() >= tournament.registrationDeadline) throw new Error('REGISTRATION_CLOSED');

    await this.resolveAndAssertEligible(tournament, captainUserId, partnerUserId);

    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tournaments WHERE id = ${tournamentId} FOR UPDATE`;
      await this.assertNoActiveRegistration(tx, tournamentId, [captainUserId, partnerUserId]);
      const confirmed = await tx.tournamentRegistration.count({ where: { tournamentId, status: 'CONFIRMED' } });
      const status = tournament.maxTeams == null || confirmed < tournament.maxTeams ? 'CONFIRMED' : 'WAITLISTED';
      return tx.tournamentRegistration.create({
        data: { tournamentId, captainUserId, partnerUserId, status },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 });
  }
```

Remplacer la méthode `changePartner` (commentaire inclus) :

```typescript
  /** Change de coéquipier : conserve statut + place en liste d'attente (createdAt inchangé). */
  async changePartner(tournamentId: string, captainUserId: string, partnerUserId: string) {
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { id: true, clubId: true, gender: true, status: true, registrationDeadline: true },
    });
    if (!tournament) throw new Error('TOURNAMENT_NOT_FOUND');
    if (tournament.status !== 'PUBLISHED') throw new Error('TOURNAMENT_NOT_OPEN');
    if (new Date() >= tournament.registrationDeadline) throw new Error('REGISTRATION_LOCKED');

    await this.resolveAndAssertEligible(tournament, captainUserId, partnerUserId);

    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tournaments WHERE id = ${tournamentId} FOR UPDATE`;
      const reg = await tx.tournamentRegistration.findFirst({
        where: { tournamentId, captainUserId, status: { not: 'CANCELLED' } },
        select: { id: true },
      });
      if (!reg) throw new Error('REGISTRATION_NOT_FOUND');
      await this.assertNoActiveRegistration(tx, tournamentId, [captainUserId, partnerUserId], reg.id);
      return tx.tournamentRegistration.update({ where: { id: reg.id }, data: { partnerUserId } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 });
  }
```

Remplacer la méthode privée `resolveAndAssertEligible` (commentaire inclus) :

```typescript
  /** Vérifie l'éligibilité du capitaine et du coéquipier (résolus par id). */
  private async resolveAndAssertEligible(
    tournament: { clubId: string; gender: TournamentGender },
    captainUserId: string,
    partnerUserId: string,
  ): Promise<void> {
    if (!partnerUserId) throw appError('PARTNER_NOT_FOUND', 'partner');
    if (partnerUserId === captainUserId) throw new Error('PARTNER_IS_SELF');

    const [captain, partner] = await Promise.all([
      prisma.user.findUnique({ where: { id: captainUserId }, select: { id: true, sex: true, phone: true } }),
      prisma.user.findUnique({ where: { id: partnerUserId }, select: { id: true, sex: true, phone: true } }),
    ]);
    if (!captain) throw new Error('USER_NOT_FOUND');
    if (!partner) throw appError('PARTNER_NOT_FOUND', 'partner');

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
  }
```

- [ ] **Step 4 : Lancer les tests, vérifier qu'ils PASSENT**

Run (depuis `backend/`) : `npm test -- tournament.service`
Expected : tous les `describe` PASS.

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/tournament.service.ts backend/src/services/__tests__/tournament.service.test.ts
git commit -m "refactor(tournois): inscription par partnerUserId (au lieu de l'e-mail)"
```

---

## Task 2 : Route joueur — body `partnerUserId`

**Files:**
- Modify: `backend/src/routes/tournaments.ts`

- [ ] **Step 1 : Remplacer le handler POST `/:id/register`**

Dans `backend/src/routes/tournaments.ts`, remplacer le handler `router.post('/:id/register', …)` par :

```typescript
router.post('/:id/register', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partnerUserId } = req.body;
    if (!partnerUserId) return void res.status(400).json({ error: 'partnerUserId requis' });
    res.status(201).json(await service.register(asString(req.params.id), req.user!.id, asString(partnerUserId)));
  } catch (err) { handleError(err, res, next); }
});
```

- [ ] **Step 2 : Remplacer le handler PATCH `/:id/registration`**

```typescript
router.patch('/:id/registration', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partnerUserId } = req.body;
    if (!partnerUserId) return void res.status(400).json({ error: 'partnerUserId requis' });
    res.json(await service.changePartner(asString(req.params.id), req.user!.id, asString(partnerUserId)));
  } catch (err) { handleError(err, res, next); }
});
```

- [ ] **Step 3 : Vérifier la compilation**

Run (depuis `backend/`) : `npx tsc --noEmit`
Expected : aucune erreur.

- [ ] **Step 4 : Commit**

```bash
git add backend/src/routes/tournaments.ts
git commit -m "feat(tournois): route inscription par partnerUserId"
```

---

## Task 3 : `ClubService` — recherche de membres + lecture/écriture d'adhésion

**Files:**
- Modify: `backend/src/services/club.service.ts`
- Test: `backend/src/services/__tests__/club.service.test.ts` (créer)

- [ ] **Step 1 : Écrire les tests (échec attendu)**

Créer `backend/src/services/__tests__/club.service.test.ts` :

```typescript
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { ClubService } from '../club.service';

describe('ClubService — recherche de membres', () => {
  let service: ClubService;
  beforeEach(() => { service = new ClubService(); });

  it('refuse un non-membre (MEMBERSHIP_REQUIRED)', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue(null as any);
    await expect(service.searchMembers('demo', 'caller', 'dup')).rejects.toThrow('MEMBERSHIP_REQUIRED');
  });

  it('renvoie [] si la requête fait moins de 2 caractères', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);
    expect(await service.searchMembers('demo', 'caller', 'a')).toEqual([]);
  });

  it('renvoie les membres correspondants (id + nom uniquement, sans e-mail)', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findMany.mockResolvedValue([
      { user: { id: 'u1', firstName: 'Jean', lastName: 'Dupont' } },
      { user: { id: 'u2', firstName: 'Julie', lastName: 'Dupond' } },
    ] as any);

    const result = await service.searchMembers('demo', 'caller', 'dup');

    expect(result).toEqual([
      { id: 'u1', firstName: 'Jean', lastName: 'Dupont' },
      { id: 'u2', firstName: 'Julie', lastName: 'Dupond' },
    ]);
    // exclut l'appelant + statut ACTIF
    const arg = (prismaMock.clubMembership.findMany as jest.Mock).mock.calls[0][0];
    expect(arg.where.userId).toEqual({ not: 'caller' });
    expect(arg.where.status).toBe('ACTIVE');
    expect(arg.take).toBe(20);
  });
});

describe('ClubService — mon adhésion (licence)', () => {
  let service: ClubService;
  beforeEach(() => { service = new ClubService(); });

  it('getMyMembership renvoie la licence du joueur', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ membershipNo: 'LIC-9', status: 'ACTIVE', isSubscriber: false } as any);
    expect(await service.getMyMembership('demo', 'caller')).toMatchObject({ membershipNo: 'LIC-9' });
  });

  it('getMyMembership lève MEMBERSHIP_REQUIRED si pas membre', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue(null as any);
    await expect(service.getMyMembership('demo', 'caller')).rejects.toThrow('MEMBERSHIP_REQUIRED');
  });

  it('setMyMembership écrit la licence (trim) sur sa propre adhésion', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ id: 'm1', status: 'ACTIVE' } as any);
    prismaMock.clubMembership.update.mockResolvedValue({ membershipNo: 'LIC-9', status: 'ACTIVE', isSubscriber: false } as any);

    await service.setMyMembership('demo', 'caller', '  LIC-9  ');

    expect(prismaMock.clubMembership.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { membershipNo: 'LIC-9' },
      select: { membershipNo: true, status: true, isSubscriber: true },
    });
  });

  it('setMyMembership refuse une licence vide (VALIDATION_ERROR)', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ id: 'm1', status: 'ACTIVE' } as any);
    await expect(service.setMyMembership('demo', 'caller', '   ')).rejects.toThrow('VALIDATION_ERROR');
  });

  it('setMyMembership refuse un membre bloqué (MEMBERSHIP_BLOCKED)', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ id: 'm1', status: 'BLOCKED' } as any);
    await expect(service.setMyMembership('demo', 'caller', 'LIC-9')).rejects.toThrow('MEMBERSHIP_BLOCKED');
  });
});
```

- [ ] **Step 2 : Lancer les tests, vérifier qu'ils ÉCHOUENT**

Run (depuis `backend/`) : `npm test -- club.service`
Expected : FAIL — `service.searchMembers is not a function` (méthodes non définies).

- [ ] **Step 3 : Implémenter les 3 méthodes**

Dans `backend/src/services/club.service.ts`, ajouter ces méthodes dans la classe `ClubService`, juste après `listMembers` (vers la ligne 178) :

```typescript
  /** Recherche de membres actifs par nom/prénom (pour choisir un coéquipier). Réservé aux membres actifs du club. */
  async searchMembers(slug: string, callerUserId: string, q: string) {
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, status: true } });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    const caller = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId: callerUserId, clubId: club.id } },
      select: { status: true },
    });
    if (!caller || caller.status === 'BLOCKED') throw new Error('MEMBERSHIP_REQUIRED');

    const query = (q ?? '').trim();
    if (query.length < 2) return [];

    const members = await prisma.clubMembership.findMany({
      where: {
        clubId: club.id,
        status: 'ACTIVE',
        userId: { not: callerUserId },
        user: { OR: [{ firstName: { contains: query, mode: 'insensitive' } }, { lastName: { contains: query, mode: 'insensitive' } }] },
      },
      orderBy: [{ user: { lastName: 'asc' } }, { user: { firstName: 'asc' } }],
      take: 20,
      select: { user: { select: { id: true, firstName: true, lastName: true } } },
    });
    return members.map((m) => m.user);
  }

  /** Adhésion du joueur connecté à ce club (licence / statut). */
  async getMyMembership(slug: string, userId: string) {
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, status: true } });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    const m = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId, clubId: club.id } },
      select: { membershipNo: true, status: true, isSubscriber: true },
    });
    if (!m) throw new Error('MEMBERSHIP_REQUIRED');
    return m;
  }

  /** Le joueur renseigne / corrige sa propre licence (n° adhérent) pour ce club. */
  async setMyMembership(slug: string, userId: string, membershipNo: string) {
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, status: true } });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    const m = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId, clubId: club.id } },
      select: { id: true, status: true },
    });
    if (!m) throw new Error('MEMBERSHIP_REQUIRED');
    if (m.status === 'BLOCKED') throw new Error('MEMBERSHIP_BLOCKED');
    const value = (membershipNo ?? '').trim();
    if (!value) throw new Error('VALIDATION_ERROR');
    return prisma.clubMembership.update({
      where: { id: m.id },
      data: { membershipNo: value },
      select: { membershipNo: true, status: true, isSubscriber: true },
    });
  }
```

- [ ] **Step 4 : Lancer les tests, vérifier qu'ils PASSENT**

Run (depuis `backend/`) : `npm test -- club.service`
Expected : tous PASS.

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/club.service.ts backend/src/services/__tests__/club.service.test.ts
git commit -m "feat(clubs): recherche de membres + lecture/ecriture de sa propre licence"
```

---

## Task 4 : Routes club — recherche + `me/membership`

**Files:**
- Modify: `backend/src/routes/clubs.ts`

- [ ] **Step 1 : Compléter `ERROR_STATUS`**

Dans `backend/src/routes/clubs.ts`, remplacer l'objet `ERROR_STATUS` par :

```typescript
const ERROR_STATUS: Record<string, number> = {
  VALIDATION_ERROR:    400,
  SLUG_TAKEN:          409,
  CLUB_NOT_FOUND:      404,
  MEMBERSHIP_REQUIRED: 403,
  MEMBERSHIP_BLOCKED:  403,
};
```

- [ ] **Step 2 : Ajouter les 3 routes avant `router.get('/:slug', …)`**

Dans `backend/src/routes/clubs.ts`, juste **avant** la ligne `// Détail public d'un club par slug.` (le handler `router.get('/:slug', …)`), insérer :

```typescript
// Recherche de membres du club par nom (réservé aux membres ; pour choisir un coéquipier de tournoi).
router.get('/:slug/members/search', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await clubService.searchMembers(asString(req.params.slug), req.user!.id, asString(req.query.q))); }
  catch (err) { handleError(err, res, next); }
});

// Adhésion du joueur connecté à ce club (licence / statut).
router.get('/:slug/me/membership', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await clubService.getMyMembership(asString(req.params.slug), req.user!.id)); }
  catch (err) { handleError(err, res, next); }
});

// Le joueur renseigne / corrige sa propre licence (n° adhérent) pour ce club.
router.patch('/:slug/me/membership', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { membershipNo } = req.body;
    res.json(await clubService.setMyMembership(asString(req.params.slug), req.user!.id, asString(membershipNo)));
  } catch (err) { handleError(err, res, next); }
});
```

- [ ] **Step 3 : Vérifier la compilation**

Run (depuis `backend/`) : `npx tsc --noEmit`
Expected : aucune erreur.

- [ ] **Step 4 : Smoke test** (Docker + backend lancés : `npm run dev`)

Run : `curl "http://localhost:3001/api/clubs/club-demo/members/search?q=du"`
Expected : HTTP 401 (route protégée, sans token) — confirme que la route est montée et gardée. Avec un token valide d'un membre : `[]` ou des membres.

- [ ] **Step 5 : Commit**

```bash
git add backend/src/routes/clubs.ts
git commit -m "feat(clubs): routes recherche membres + me/membership (licence joueur)"
```

---

## Task 5 : Client API frontend (`lib/api.ts`)

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1 : Ajouter les types** (dans la section des types, à côté de `MyProfile`)

```typescript
export interface ClubMemberSearchResult {
  id: string;
  firstName: string;
  lastName: string;
}

export interface MyClubMembership {
  membershipNo: string | null;
  status: 'ACTIVE' | 'BLOCKED';
  isSubscriber: boolean;
}
```

- [ ] **Step 2 : Passer `registerTournament` / `changeTournamentPartner` à `partnerUserId`**

Dans `frontend/lib/api.ts`, remplacer les 2 méthodes (en gardant le style d'URL existant `/api/...`) :

```typescript
  registerTournament: (id: string, partnerUserId: string, token: string) =>
    request<TournamentRegistrationRecord>(`/api/tournaments/${id}/register`, { method: 'POST', body: JSON.stringify({ partnerUserId }) }, token),

  changeTournamentPartner: (id: string, partnerUserId: string, token: string) =>
    request<TournamentRegistrationRecord>(`/api/tournaments/${id}/registration`, { method: 'PATCH', body: JSON.stringify({ partnerUserId }) }, token),
```

- [ ] **Step 3 : Ajouter les méthodes recherche + adhésion** (juste après `updateMyProfile`)

```typescript
  // --- Annuaire & adhésion (club courant) ---
  searchClubMembers: (slug: string, q: string, token: string) =>
    request<ClubMemberSearchResult[]>(`/api/clubs/${slug}/members/search?q=${encodeURIComponent(q)}`, {}, token),

  getMyClubMembership: (slug: string, token: string) =>
    request<MyClubMembership>(`/api/clubs/${slug}/me/membership`, {}, token),

  updateMyClubMembership: (slug: string, membershipNo: string, token: string) =>
    request<MyClubMembership>(`/api/clubs/${slug}/me/membership`, { method: 'PATCH', body: JSON.stringify({ membershipNo }) }, token),
```

- [ ] **Step 4 : Vérifier la compilation**

Run (depuis `frontend/`) : `npx tsc --noEmit`
Expected : erreurs **attendues** dans `app/tournois/[id]/page.tsx` (les appels passent encore `partnerEmail`/n'utilisent pas les nouvelles méthodes) — elles seront corrigées Tasks 6-7. `lib/api.ts` lui-même ne doit pas avoir d'erreur.

- [ ] **Step 5 : Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(tournois): types/methodes API (recherche membres, licence, partnerUserId)"
```

---

## Task 6 : Page détail — licence dans « Complétez votre profil »

**Files:**
- Modify: `frontend/app/tournois/[id]/page.tsx`

- [ ] **Step 1 : Importer les types et la signature de profil**

Dans `frontend/app/tournois/[id]/page.tsx`, modifier l'import de `@/lib/api` pour inclure `MyClubMembership` :

```typescript
import { api, TournamentDetail, MyProfile, MyTournamentRegistration, MyClubMembership } from '@/lib/api';
```

- [ ] **Step 2 : Ajouter l'état adhésion + le chargement**

Après la ligne `const [profile, setProfile] = useState<MyProfile | null>(null);`, ajouter :

```typescript
  // undefined = en cours de chargement ; null = pas membre de ce club ; sinon l'adhésion.
  const [membership, setMembership] = useState<MyClubMembership | null | undefined>(undefined);
```

Dans le `useEffect` qui charge le profil (celui qui contient `api.getMyProfile(token)`), ajouter le chargement de l'adhésion. Remplacer ce `useEffect` par :

```typescript
  useEffect(() => {
    if (!ready || !token) return;
    api.getMyProfile(token).then(setProfile).catch(() => {});
    api.getMyTournaments(token).then((rs) => setMyReg(rs.find((r) => r.tournament.id === id) ?? null)).catch(() => {});
    if (club) api.getMyClubMembership(club.slug, token).then(setMembership).catch(() => setMembership(null));
  }, [ready, token, id, club?.slug]);
```

- [ ] **Step 3 : Intégrer la licence dans `profileIncomplete` + `saveProfile`**

Remplacer la ligne `const profileIncomplete = …` par :

```typescript
  // On attend que profil ET adhésion soient chargés. Si le joueur n'est pas membre (membership null),
  // on ne bloque pas ici : l'inscription renverra MEMBERSHIP_REQUIRED.
  const profileIncomplete =
    !!token && profile != null && membership !== undefined && membership !== null &&
    (!profile.phone || !profile.sex || !membership.membershipNo);
```

Remplacer la fonction `saveProfile` par (signature avec licence, écrit profil + adhésion) :

```typescript
  const saveProfile = async (phone: string, sex: 'MALE' | 'FEMALE', license: string) => {
    if (!token || !club) return;
    setBusy(true); setError(null);
    try {
      const [p, m] = await Promise.all([
        api.updateMyProfile({ phone, sex }, token),
        api.updateMyClubMembership(club.slug, license, token),
      ]);
      setProfile(p);
      setMembership(m);
    } catch (e) { setError(messageFor(e)); }
    finally { setBusy(false); }
  };
```

- [ ] **Step 4 : Passer la licence courante à `ProfileCompletion`**

Remplacer la balise `<ProfileCompletion busy={busy} onSave={saveProfile} />` par :

```tsx
                <ProfileCompletion busy={busy} initialLicense={membership?.membershipNo ?? ''} onSave={saveProfile} />
```

- [ ] **Step 5 : Ajouter le champ Licence au composant `ProfileCompletion`**

Remplacer entièrement la fonction `ProfileCompletion` (jusqu'à sa `}` finale) par :

```tsx
function ProfileCompletion({ busy, initialLicense, onSave }: {
  busy: boolean;
  initialLicense: string;
  onSave: (phone: string, sex: 'MALE' | 'FEMALE', license: string) => void;
}) {
  const { th } = useTheme();
  const [phone, setPhone] = useState('');
  const [sex, setSex] = useState<'MALE' | 'FEMALE' | ''>('');
  const [license, setLicense] = useState(initialLicense);
  const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', background: th.surface2, border: `1px solid ${th.line}`, borderRadius: 11, padding: '11px 13px', fontFamily: th.fontUI, fontSize: 14, color: th.text };
  const primaryBtn: React.CSSProperties = { border: 'none', cursor: 'pointer', background: th.accent, color: th.onAccent, borderRadius: 11, padding: '12px 16px', fontFamily: th.fontUI, fontWeight: 700, fontSize: 14.5, opacity: busy ? 0.6 : 1 };
  return (
    <div style={{ background: th.surface, borderRadius: 16, padding: '16px 18px', boxShadow: `inset 0 0 0 1px ${th.line}`, marginBottom: 16 }}>
      <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 14.5, color: th.text }}>Complétez votre profil</div>
      <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, marginTop: 4, marginBottom: 12 }}>Téléphone, sexe et licence sont requis pour s&apos;inscrire à un tournoi.</div>
      <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Téléphone" style={{ ...inputStyle, marginBottom: 8 }} />
      <input value={license} onChange={(e) => setLicense(e.target.value)} placeholder="N° de licence / adhérent" style={{ ...inputStyle, marginBottom: 8 }} />
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {(['MALE', 'FEMALE'] as const).map((s) => (
          <button key={s} onClick={() => setSex(s)} style={{ flex: 1, cursor: 'pointer', borderRadius: 11, padding: '10px', fontFamily: th.fontUI, fontSize: 14, border: `1px solid ${sex === s ? th.accent : th.line}`, background: sex === s ? th.surface2 : 'transparent', color: th.text }}>
            {s === 'MALE' ? 'Homme' : 'Femme'}
          </button>
        ))}
      </div>
      <button onClick={() => sex && onSave(phone.trim(), sex, license.trim())} disabled={busy || !phone.trim() || !sex || !license.trim()} style={{ ...primaryBtn, width: '100%' }}>Enregistrer mon profil</button>
    </div>
  );
}
```

- [ ] **Step 6 : Vérifier la compilation**

Run (depuis `frontend/`) : `npx tsc --noEmit`
Expected : il reste les erreurs liées à `partnerEmail` (corrigées Task 7), mais aucune nouvelle erreur sur `ProfileCompletion`/`saveProfile`/`membership`.

- [ ] **Step 7 : Commit**

```bash
git add "frontend/app/tournois/[id]/page.tsx"
git commit -m "feat(tournois): saisie de la licence par le joueur dans la completion de profil"
```

---

## Task 7 : Page détail — annuaire de recherche du coéquipier

**Files:**
- Modify: `frontend/app/tournois/[id]/page.tsx`

> Remplace les 2 champs e-mail (inscription + changement de coéquipier) par un composant de recherche par nom. Le coéquipier sélectionné est mémorisé par son `id`.

- [ ] **Step 1 : Remplacer l'état `partnerEmail` par un coéquipier sélectionné**

Remplacer la ligne `const [partnerEmail, setPartnerEmail] = useState('');` par :

```typescript
  const [partner, setPartner] = useState<{ id: string; firstName: string; lastName: string } | null>(null);
```

- [ ] **Step 2 : Adapter `register` et `changePartner` pour envoyer `partner.id`**

Remplacer la fonction `register` par :

```typescript
  const register = async () => {
    if (!token) { router.push('/login'); return; }
    if (!partner) return;
    setBusy(true); setError(null);
    try {
      await api.registerTournament(id, partner.id, token);
      setPartner(null);
      await load();
      const rs = await api.getMyTournaments(token);
      setMyReg(rs.find((r) => r.tournament.id === id) ?? null);
    } catch (e) { setError(messageFor(e)); }
    finally { setBusy(false); }
  };
```

Remplacer la fonction `changePartner` par :

```typescript
  const changePartner = async () => {
    if (!token || !partner) return;
    setBusy(true); setError(null);
    try {
      await api.changeTournamentPartner(id, partner.id, token);
      setPartner(null);
      const rs = await api.getMyTournaments(token);
      setMyReg(rs.find((r) => r.tournament.id === id) ?? null);
    } catch (e) { setError(messageFor(e)); }
    finally { setBusy(false); }
  };
```

- [ ] **Step 3 : Remplacer le champ e-mail du bloc « changer de coéquipier »**

Dans le bloc « Déjà inscrit » (`{token && myReg && …}`), remplacer le `<div style={{ display: 'flex', gap: 8 }}>…</div>` qui contient l'`<input>` e-mail + le bouton « Changer » par :

```tsx
                  <PartnerSearch slug={club.slug} token={token} selected={partner} onSelect={setPartner} onClear={() => setPartner(null)} disabled={busy} />
                  <button onClick={changePartner} disabled={busy || !partner} style={{ ...primaryBtn, marginTop: 8 }}>Changer de coéquipier</button>
```

- [ ] **Step 4 : Remplacer le champ e-mail du bloc « inscription »**

Dans le bloc « Pas encore inscrit, inscriptions ouvertes » (`{token && !myReg && !closed && …}`), remplacer le `<div style={{ fontFamily: th.fontUI, fontSize: 12.5, … }}>E-mail du coéquipier</div>` et le `<div style={{ display: 'flex', gap: 8 }}>…</div>` (input + bouton S'inscrire) par :

```tsx
                <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginBottom: 6 }}>Coéquipier (recherche par nom)</div>
                <PartnerSearch slug={club.slug} token={token!} selected={partner} onSelect={setPartner} onClear={() => setPartner(null)} disabled={busy} />
                <button onClick={register} disabled={busy || !partner} style={{ ...primaryBtn, marginTop: 8 }}>S&apos;inscrire</button>
```

Et corriger le texte d'aide juste au-dessus : remplacer
`Votre coéquipier doit avoir un compte, être membre du club, et avoir renseigné téléphone, licence et sexe.`
par
`Votre coéquipier doit être membre du club et avoir renseigné téléphone, licence et sexe.`

- [ ] **Step 5 : Ajouter le composant `PartnerSearch`** (à la fin du fichier, après `ProfileCompletion`)

```tsx
function PartnerSearch({ slug, token, selected, onSelect, onClear, disabled }: {
  slug: string;
  token: string;
  selected: { id: string; firstName: string; lastName: string } | null;
  onSelect: (m: { id: string; firstName: string; lastName: string }) => void;
  onClear: () => void;
  disabled?: boolean;
}) {
  const { th } = useTheme();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ id: string; firstName: string; lastName: string }[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (selected) return;
    const query = q.trim();
    if (query.length < 2) { setResults([]); setOpen(false); return; }
    const handle = setTimeout(() => {
      api.searchClubMembers(slug, query, token)
        .then((rs) => { setResults(rs); setOpen(true); })
        .catch(() => { setResults([]); setOpen(false); });
    }, 250);
    return () => clearTimeout(handle);
  }, [q, slug, token, selected]);

  const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', background: th.surface2, border: `1px solid ${th.line}`, borderRadius: 11, padding: '11px 13px', fontFamily: th.fontUI, fontSize: 14, color: th.text };

  if (selected) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ ...inputStyle, flex: 1, display: 'flex', alignItems: 'center' }}>{selected.firstName} {selected.lastName}</div>
        <button onClick={onClear} disabled={disabled} style={{ border: `1px solid ${th.line}`, background: 'transparent', color: th.textMute, cursor: 'pointer', borderRadius: 11, padding: '10px 14px', fontFamily: th.fontUI, fontSize: 13.5, whiteSpace: 'nowrap' }}>Changer</button>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <input value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => results.length > 0 && setOpen(true)} placeholder="Rechercher par nom…" disabled={disabled} style={inputStyle} />
      {open && results.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30, marginTop: 4, background: th.surface, borderRadius: 11, boxShadow: `0 8px 24px rgba(0,0,0,0.25), inset 0 0 0 1px ${th.line}`, overflow: 'hidden' }}>
          {results.map((m) => (
            <button key={m.id} onClick={() => { onSelect(m); setOpen(false); setQ(''); }} style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'transparent', cursor: 'pointer', padding: '10px 13px', fontFamily: th.fontUI, fontSize: 14, color: th.text }}>
              {m.firstName} {m.lastName}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6 : Vérifier la compilation + le lint**

Run (depuis `frontend/`) : `npx tsc --noEmit`
Expected : aucune erreur.
Run : `npx eslint "app/tournois/[id]/page.tsx"`
Expected : aucune **erreur** (les warnings `exhaustive-deps` éventuels sont tolérés, comme ailleurs).

- [ ] **Step 7 : Commit**

```bash
git add "frontend/app/tournois/[id]/page.tsx"
git commit -m "feat(tournois): annuaire de recherche du coequipier par nom (selection par id)"
```

---

## Task 8 : Vérification end-to-end + doc

**Files:** `palova/CLAUDE.md`

- [ ] **Step 1 : Suite de tests backend complète**

Run (depuis `backend/`) : `npm test`
Expected : toutes les suites PASS (existantes + `tournament.service` + nouvelle `club.service`).

- [ ] **Step 2 : Typecheck des deux côtés**

Run : `cd backend && npx tsc --noEmit` puis `cd ../frontend && npx tsc --noEmit`
Expected : aucune erreur.

- [ ] **Step 3 : Parcours manuel** (Docker + backend + frontend lancés ; host club `<slug>.localhost:3000`)

Checklist :
1. Joueur **membre sans licence** ouvre un tournoi publié → la boîte « Complétez votre profil » demande tél + **licence** + sexe → enregistrer → la boîte disparaît.
2. Vérifier dans `/admin/members` que le **n° adhérent** du joueur est bien la valeur saisie.
3. Champ coéquipier : taper ≥ 2 lettres d'un nom → liste déroulante → cliquer un membre → son nom s'affiche → **S'inscrire** → binôme « Inscrit ».
4. La recherche **n'affiche pas** le joueur lui-même ; taper 1 lettre → aucune liste.
5. Déjà inscrit : « Changer de coéquipier » via la recherche → met à jour le binôme.
6. Binôme invalide (mauvais sexe pour la catégorie) → message d'erreur clair (`GENDER_MISMATCH`).

- [ ] **Step 4 : Mettre à jour la doc projet**

Dans `palova/CLAUDE.md`, sous la section « Tournois (v1 — inscriptions) ✅ implémenté », ajouter une ligne :

```
> **Évolution (2026-06-09) :** le joueur saisit lui-même sa licence (`PATCH /api/clubs/:slug/me/membership`, écrit `ClubMembership.membershipNo`), et l'inscription choisit le coéquipier via un **annuaire de recherche par nom** (`GET /api/clubs/:slug/members/search`, sélection par `partnerUserId` — l'inscription ne passe plus par l'e-mail). Spec/plan : `docs/superpowers/{specs,plans}/2026-06-09-tournois-licence-annuaire*`.
```

- [ ] **Step 5 : Commit final**

```bash
git add palova/CLAUDE.md
git commit -m "docs(tournois): maj CLAUDE.md (licence joueur + annuaire coequipier)"
```

---

## Notes de vérification (self-review)

- **Couverture spec :** A (licence) → Tasks 3-4 (backend `setMyMembership`/`getMyMembership` + routes) + Task 6 (UI champ licence) ✓ ; B (annuaire) → Task 3-4 (`searchMembers` + route) + Task 1-2 (`partnerUserId`) + Task 5 (API) + Task 7 (UI `PartnerSearch`) ✓ ; privacy (pas d'e-mail renvoyé, gate membre) → `searchMembers` select id+nom, `MEMBERSHIP_REQUIRED` ✓ ; « remplir si vide, modifiable » → écriture libre + champ pré-rempli (`initialLicense`) ✓.
- **Cohérence des types/signatures :** `partnerUserId` (service ↔ route ↔ api.ts) ; `resolveAndAssertEligible(tournament, captainUserId, partnerUserId): Promise<void>` ; `ClubMemberSearchResult { id, firstName, lastName }` (backend select ↔ api ↔ `PartnerSearch`) ; `MyClubMembership { membershipNo, status, isSubscriber }` (backend select ↔ api ↔ page).
- **Migration :** aucune (`membershipNo` existe déjà sur `ClubMembership`).
- **TDD :** Tasks 1 et 3 écrivent/adaptent les tests d'abord (rouge), puis l'implémentation (vert).
