# Contacter le juge-arbitre (J/A) d'un tournoi — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** les inscrits d'un tournoi peuvent écrire au J/A via la messagerie privée existante, selon un réglage 3 états du J/A (Toujours / Après clôture / Jamais, défaut Après clôture), sans jamais exposer son userId dans le payload public.

**Architecture :** colonne enum additive `ClubMembership.refereeContactPolicy` ; `getById()` expose un booléen calculé `referee.contactable` (le userId reste hors payload — la membership du J/A est lue via la relation `referee.clubMemberships`, jamais via `refereeUserId`) ; un endpoint dédié `POST /api/tournaments/:id/contact-referee` vérifie inscrit + politique + facette côté serveur puis délègue à `MessagingService.getOrCreateConversation` (toutes les gardes DM restent souveraines). Front : bouton « Contacter » sur la carte méta J/A de la fiche, réglage `Segmented` dans `/me/refereeing`.

**Tech stack :** Express + Prisma 7 (backend), Next.js 16 + React Testing Library (front), messagerie DM existante (`messaging.service.ts`, `lib/messages.ts`).

**Spec :** `docs/superpowers/specs/2026-07-22-contacter-juge-arbitre-design.md`

**⚠️ Conventions repo à respecter :**
- Migrations : JAMAIS `prisma db push` ni `migrate dev` (dérive connue de la base dev). SQL additif appliqué via `prisma db execute`, prod = `migrate deploy`.
- Shims npm cassés possibles : si `npx jest` échoue (« jest n'est pas reconnu »), utiliser `node node_modules/jest/bin/jest.js` et `node node_modules/typescript/bin/tsc`.
- Jest backend se lance depuis `backend/`, frontend depuis `frontend/`. Cibler un fichier précis : `--runTestsByPath`.
- Ne PAS utiliser `git stash` (pile partagée entre worktrees/sessions).
- Le user (Eric) peut avoir du WIP dans le repo : commits ciblés (`git add <fichiers>`), jamais `git add -A`.

---

### Task 1 : Migration additive `add_referee_contact_policy`

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260722100000_add_referee_contact_policy/migration.sql`

- [ ] **Step 1 : Ajouter l'enum + la colonne au schéma Prisma**

Dans `backend/prisma/schema.prisma`, ajouter l'enum juste AVANT `model ClubMembership` (ligne ~754) :

```prisma
/// Disponibilité au contact du J/A par les inscrits de ses tournois (réglage personnel, par club).
enum RefereeContactPolicy {
  ALWAYS
  AFTER_DEADLINE
  NEVER
}
```

Et dans `model ClubMembership`, juste après la ligne `isReferee` (ligne 763) :

```prisma
  refereeContactPolicy RefereeContactPolicy @default(AFTER_DEADLINE) @map("referee_contact_policy") // dispo au contact (facette J/A)
```

- [ ] **Step 2 : Écrire le SQL de migration**

Créer `backend/prisma/migrations/20260722100000_add_referee_contact_policy/migration.sql` :

```sql
-- Disponibilité au contact du J/A (réglage personnel, par club — miroir de is_referee).
CREATE TYPE "RefereeContactPolicy" AS ENUM ('ALWAYS', 'AFTER_DEADLINE', 'NEVER');
ALTER TABLE "club_subscribers" ADD COLUMN IF NOT EXISTS "referee_contact_policy" "RefereeContactPolicy" NOT NULL DEFAULT 'AFTER_DEADLINE';
```

- [ ] **Step 3 : Appliquer en DEV + régénérer le client**

Depuis `backend/` :

```bash
npx prisma db execute --file prisma/migrations/20260722100000_add_referee_contact_policy/migration.sql --schema prisma/schema.prisma
npx prisma generate
```

Attendu : les deux commandes sortent sans erreur. (⚠️ si le backend dev tourne, il garde l'ancien client Prisma en mémoire — `touch src/app.ts` ou redémarrer via `start.ps1` plus tard ; ne bloque pas la suite.)

- [ ] **Step 4 : Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260722100000_add_referee_contact_policy/migration.sql
git commit -m "feat(referee): migration add_referee_contact_policy (enum + colonne ClubMembership)"
```

---

### Task 2 : Backend — réglage GET/PATCH du J/A

**Files:**
- Modify: `backend/src/services/tournament.service.ts` (section « Espace juge-arbitre », ~ligne 804)
- Modify: `backend/src/routes/clubs.ts` (après la route `GET /:slug/me/referee/tournaments/:id/registrations`, ~ligne 390)
- Test: `backend/src/services/__tests__/tournament.service.test.ts`
- Test: `backend/src/routes/__tests__/clubs.referee.routes.test.ts`

- [ ] **Step 1 : Écrire les tests service (échouants)**

Dans `tournament.service.test.ts`, ajouter en fin de fichier :

```ts
// Réglage de contactabilité du J/A (par club, sur ClubMembership — miroir de isReferee).
describe('réglage de contactabilité du J/A', () => {
  let svc: TournamentService;
  beforeEach(() => { jest.clearAllMocks(); svc = new TournamentService(); });

  it('getRefereeContactPolicy lit la colonne du membre', async () => {
    prismaMock.clubMembership.findUnique.mockResolvedValue({ refereeContactPolicy: 'NEVER' } as any);
    await expect(svc.getRefereeContactPolicy('club-1', 'u1')).resolves.toEqual({ policy: 'NEVER' });
    const arg = (prismaMock.clubMembership.findUnique as jest.Mock).mock.calls[0][0];
    expect(arg.where).toEqual({ userId_clubId: { userId: 'u1', clubId: 'club-1' } });
  });

  it('getRefereeContactPolicy sans adhésion → défaut AFTER_DEADLINE (jamais un crash)', async () => {
    prismaMock.clubMembership.findUnique.mockResolvedValue(null as any);
    await expect(svc.getRefereeContactPolicy('club-1', 'u1')).resolves.toEqual({ policy: 'AFTER_DEADLINE' });
  });

  it('setRefereeContactPolicy écrit la valeur sur la bonne adhésion', async () => {
    prismaMock.clubMembership.update.mockResolvedValue({ refereeContactPolicy: 'ALWAYS' } as any);
    await expect(svc.setRefereeContactPolicy('club-1', 'u1', 'ALWAYS')).resolves.toEqual({ policy: 'ALWAYS' });
    const arg = (prismaMock.clubMembership.update as jest.Mock).mock.calls[0][0];
    expect(arg.where).toEqual({ userId_clubId: { userId: 'u1', clubId: 'club-1' } });
    expect(arg.data).toEqual({ refereeContactPolicy: 'ALWAYS' });
  });

  it('setRefereeContactPolicy refuse une valeur hors enum', async () => {
    await expect(svc.setRefereeContactPolicy('club-1', 'u1', 'SOMETIMES')).rejects.toThrow('VALIDATION_ERROR');
    expect(prismaMock.clubMembership.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2 : Vérifier qu'ils échouent**

Depuis `backend/` : `npx jest --runTestsByPath src/services/__tests__/tournament.service.test.ts -t "contactabilité"`
Attendu : FAIL (`getRefereeContactPolicy is not a function`).

- [ ] **Step 3 : Implémenter dans le service**

Dans `tournament.service.ts` :
1. Ligne 1, élargir l'import : `import { Prisma, RefereeContactPolicy, TournamentGender, TournamentStatus } from '@prisma/client';`
2. Après `PUBLIC_TOURNAMENT_SELECT` (~ligne 50), ajouter :

```ts
/** Valeurs admises du réglage de contactabilité du J/A (validation du PATCH). */
const REFEREE_CONTACT_POLICIES: readonly RefereeContactPolicy[] = ['ALWAYS', 'AFTER_DEADLINE', 'NEVER'];
```

3. Dans la section « Espace juge-arbitre », après `resolveReferee` (~ligne 815) :

```ts
  /** Réglage de contactabilité du J/A (par club). Gate resolveReferee posé par la route. */
  async getRefereeContactPolicy(clubId: string, userId: string) {
    const m = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId, clubId } },
      select: { refereeContactPolicy: true },
    });
    return { policy: m?.refereeContactPolicy ?? 'AFTER_DEADLINE' };
  }

  async setRefereeContactPolicy(clubId: string, userId: string, policy: string) {
    if (!REFEREE_CONTACT_POLICIES.includes(policy as RefereeContactPolicy)) throw new Error('VALIDATION_ERROR');
    const m = await prisma.clubMembership.update({
      where: { userId_clubId: { userId, clubId } },
      data: { refereeContactPolicy: policy as RefereeContactPolicy },
      select: { refereeContactPolicy: true },
    });
    return { policy: m.refereeContactPolicy };
  }
```

- [ ] **Step 4 : Vérifier que les tests service passent**

`npx jest --runTestsByPath src/services/__tests__/tournament.service.test.ts -t "contactabilité"` → PASS.

- [ ] **Step 5 : Écrire les tests routes (échouants)**

Dans `clubs.referee.routes.test.ts` :
1. Ligne 38-39, ajouter les deux mocks à la liste : `getRefereeContactPolicy = jest.fn(), setRefereeContactPolicy = jest.fn(),`
2. Dans la factory `jest.mock('../../services/tournament.service', …)` (~ligne 50), ajouter `getRefereeContactPolicy, setRefereeContactPolicy,` à l'objet retourné.
3. En fin de fichier :

```ts
// Réglage de contactabilité : famille /me/referee/*, gate resolveReferee (étage 1 seul —
// pas de tournoi en jeu, donc pas d'étage 2).
describe('GET/PATCH /me/referee/contact-policy', () => {
  it('GET renvoie le réglage du J/A', async () => {
    resolveReferee.mockResolvedValue(true);
    getRefereeContactPolicy.mockResolvedValue({ policy: 'AFTER_DEADLINE' });
    const res = await request(app).get(`${base}/contact-policy`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ policy: 'AFTER_DEADLINE' });
    expect(getRefereeContactPolicy).toHaveBeenCalledWith('club-1', 'u-ref');
  });

  it('GET sans facette → 403 NOT_A_REFEREE', async () => {
    resolveReferee.mockResolvedValue(false);
    const res = await request(app).get(`${base}/contact-policy`).set(auth);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('NOT_A_REFEREE');
    expect(getRefereeContactPolicy).not.toHaveBeenCalled();
  });

  it('PATCH relaie la nouvelle valeur', async () => {
    resolveReferee.mockResolvedValue(true);
    setRefereeContactPolicy.mockResolvedValue({ policy: 'NEVER' });
    const res = await request(app).patch(`${base}/contact-policy`).set(auth).send({ policy: 'NEVER' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ policy: 'NEVER' });
    expect(setRefereeContactPolicy).toHaveBeenCalledWith('club-1', 'u-ref', 'NEVER');
  });

  it('PATCH sans facette → 403, service jamais appelé', async () => {
    resolveReferee.mockResolvedValue(false);
    const res = await request(app).patch(`${base}/contact-policy`).set(auth).send({ policy: 'NEVER' });
    expect(res.status).toBe(403);
    expect(setRefereeContactPolicy).not.toHaveBeenCalled();
  });

  it('PATCH valeur invalide → 400 (VALIDATION_ERROR du service)', async () => {
    resolveReferee.mockResolvedValue(true);
    setRefereeContactPolicy.mockRejectedValue(new Error('VALIDATION_ERROR'));
    const res = await request(app).patch(`${base}/contact-policy`).set(auth).send({ policy: 'XX' });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 6 : Vérifier qu'ils échouent** (`npx jest --runTestsByPath src/routes/__tests__/clubs.referee.routes.test.ts -t "contact-policy"` → FAIL 404)

- [ ] **Step 7 : Implémenter les routes**

Dans `clubs.ts`, juste APRÈS le commentaire de section « --- Espace juge-arbitre … » (~ligne 370) et AVANT la route `GET /:slug/me/referee/tournaments` (pas de collision : chemins distincts, mais autant garder le réglage en tête de section) :

```ts
// Réglage de contactabilité du J/A (par club) — lu/écrit depuis l'espace Arbitrage.
// Étage 1 seul (facette) : pas de tournoi en jeu, donc pas d'assertRefereeOwnsTournament.
router.get('/:slug/me/referee/contact-policy', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id: clubId } = await ensureActiveMembership(asString(req.params.slug), req.user!.id);
    if (!(await tournamentService.resolveReferee(clubId, req.user!.id))) throw new Error('NOT_A_REFEREE');
    res.json(await tournamentService.getRefereeContactPolicy(clubId, req.user!.id));
  } catch (err) { handleError(err, res, next); }
});

router.patch('/:slug/me/referee/contact-policy', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id: clubId } = await ensureActiveMembership(asString(req.params.slug), req.user!.id);
    if (!(await tournamentService.resolveReferee(clubId, req.user!.id))) throw new Error('NOT_A_REFEREE');
    res.json(await tournamentService.setRefereeContactPolicy(clubId, req.user!.id, asString(req.body?.policy)));
  } catch (err) { handleError(err, res, next); }
});
```

(`VALIDATION_ERROR: 400` figure déjà dans `ERROR_STATUS` de clubs.ts ligne 63 — rien à ajouter.)

- [ ] **Step 8 : Vérifier que les deux suites passent en entier**

```bash
npx jest --runTestsByPath src/services/__tests__/tournament.service.test.ts src/routes/__tests__/clubs.referee.routes.test.ts
```
Attendu : PASS (aucune régression).

- [ ] **Step 9 : Commit**

```bash
git add backend/src/services/tournament.service.ts backend/src/routes/clubs.ts backend/src/services/__tests__/tournament.service.test.ts backend/src/routes/__tests__/clubs.referee.routes.test.ts
git commit -m "feat(referee): reglage de contactabilite GET/PATCH /me/referee/contact-policy"
```

---

### Task 3 : Backend — `referee.contactable` dans le détail public

**Files:**
- Modify: `backend/src/services/tournament.service.ts` (`getById`, lignes 438-455)
- Test: `backend/src/services/__tests__/tournament.service.test.ts` (describe « getById — J/A public (nom seul) », lignes 1226-1255)

- [ ] **Step 1 : Adapter les tests existants + écrire les nouveaux (échouants)**

Dans le describe `'getById — J/A public (nom seul)'` (~ligne 1226) :
1. Le mock `mockTournament` doit gagner `clubId: 'club-1'` et `registrationDeadline: new Date('2099-01-01T00:00:00Z')` dans l'objet tournoi (le calcul de contactabilité les lit).
2. Le test `'expose le nom du J/A désigné…'` : le referee mocké gagne `clubMemberships: []`, et l'assertion devient :

```ts
expect(dto.referee).toEqual({ name: 'Julien Martin', contactable: false });
```

3. Ajouter un nouveau describe à la suite :

```ts
// La contactabilité est un booléen CALCULÉ serveur : politique du membre + clôture +
// kill-switch facette (miroir de resolveReferee). La membership du J/A est lue via la
// relation referee.clubMemberships — refereeUserId n'est jamais lu sur ce chemin public.
describe('getById — contactabilité du J/A', () => {
  let svc: TournamentService;
  beforeEach(() => { jest.clearAllMocks(); svc = new TournamentService(); });

  const FUTURE = '2099-01-01T00:00:00Z', PAST = '2000-01-01T00:00:00Z';
  const referee = (policy: string, over: Record<string, unknown> = {}) => ({
    firstName: 'Julien', lastName: 'Martin',
    clubMemberships: [{ clubId: 'club-1', status: 'ACTIVE', isReferee: true, refereeContactPolicy: policy, ...over }],
  });
  const mockT = (ref: unknown, deadline: string) => {
    prismaMock.tournament.findUnique.mockResolvedValue({
      id: 't1', clubId: 'club-1', name: 'Open', status: 'PUBLISHED',
      registrationDeadline: new Date(deadline), referee: ref,
      club: { slug: 'demo', name: 'Demo', timezone: 'Europe/Paris' },
      clubSport: { sport: { key: 'padel', name: 'Padel' } },
    } as any);
    (prismaMock.tournamentRegistration.groupBy as jest.Mock).mockResolvedValue([] as any);
  };

  it('ALWAYS → contactable même avant la clôture', async () => {
    mockT(referee('ALWAYS'), FUTURE);
    const dto = await svc.getById('t1');
    expect(dto.referee).toEqual({ name: 'Julien Martin', contactable: true });
  });

  it('AFTER_DEADLINE avant clôture → non contactable', async () => {
    mockT(referee('AFTER_DEADLINE'), FUTURE);
    expect((await svc.getById('t1')).referee?.contactable).toBe(false);
  });

  it('AFTER_DEADLINE après clôture → contactable', async () => {
    mockT(referee('AFTER_DEADLINE'), PAST);
    expect((await svc.getById('t1')).referee?.contactable).toBe(true);
  });

  it('NEVER → jamais contactable, même clôturé', async () => {
    mockT(referee('NEVER'), PAST);
    expect((await svc.getById('t1')).referee?.contactable).toBe(false);
  });

  it('facette retirée → non contactable (kill-switch, comme resolveReferee)', async () => {
    mockT(referee('ALWAYS', { isReferee: false }), PAST);
    expect((await svc.getById('t1')).referee?.contactable).toBe(false);
  });

  it('adhésion non-ACTIVE → non contactable', async () => {
    mockT(referee('ALWAYS', { status: 'BLOCKED' }), PAST);
    expect((await svc.getById('t1')).referee?.contactable).toBe(false);
  });

  it("la membership d'un AUTRE club ne compte pas", async () => {
    mockT(referee('ALWAYS', { clubId: 'club-2' }), PAST);
    expect((await svc.getById('t1')).referee?.contactable).toBe(false);
  });

  it('ni userId ni memberships ne fuitent dans le payload', async () => {
    mockT({ id: 'u-referee', ...referee('ALWAYS') }, PAST);
    const dto = await svc.getById('t1');
    const json = JSON.stringify(dto);
    expect(json).not.toContain('u-referee');
    expect(json).not.toContain('clubMemberships');
    expect(json).not.toContain('refereeContactPolicy');
  });
});
```

- [ ] **Step 2 : Vérifier qu'ils échouent** (`npx jest --runTestsByPath src/services/__tests__/tournament.service.test.ts -t "contactabilité du J/A"` → FAIL)

- [ ] **Step 3 : Implémenter**

Dans `tournament.service.ts` :
1. Après `REFEREE_CONTACT_POLICIES` (Task 2), ajouter la fonction module :

```ts
/**
 * Contactabilité du J/A d'un tournoi par ses inscrits.
 * Kill-switch d'abord (adhésion ACTIVE + facette, miroir de resolveReferee) : décocher la
 * facette coupe le contact même si la mission refereeUserId reste posée. Puis la politique
 * personnelle — AFTER_DEADLINE ne s'ouvre qu'une fois les inscriptions closes.
 */
function refereeContactable(
  m: { status: string; isReferee: boolean; refereeContactPolicy: RefereeContactPolicy } | null | undefined,
  registrationDeadline: Date,
  now: Date,
): boolean {
  if (!m || m.status !== 'ACTIVE' || !m.isReferee) return false;
  if (m.refereeContactPolicy === 'NEVER') return false;
  if (m.refereeContactPolicy === 'AFTER_DEADLINE') return now >= registrationDeadline;
  return true;
}
```

2. Réécrire `getById` (lignes 438-455) :

```ts
  async getById(tournamentId: string) {
    const t = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: {
        ...PUBLIC_TOURNAMENT_SELECT,
        club: { select: { slug: true, name: true, timezone: true } },
        clubSport: { select: { sport: { select: { key: true, name: true } } } },
        // La contactabilité se calcule via la relation (clubMemberships du J/A, filtrée sur
        // t.clubId en JS) : refereeUserId n'est jamais lu sur ce chemin public.
        referee: { select: { firstName: true, lastName: true, clubMemberships: { select: { clubId: true, status: true, isReferee: true, refereeContactPolicy: true } } } },
      },
    });
    if (!t || t.status === 'DRAFT') throw new Error('TOURNAMENT_NOT_FOUND');
    const { referee, ...rest } = t;
    const [withCount] = await this.withCounts([rest]);
    const membership = referee?.clubMemberships.find((m) => m.clubId === t.clubId) ?? null;
    return {
      ...withCount,
      referee: referee ? {
        name: `${referee.firstName} ${referee.lastName}`.trim(),
        contactable: refereeContactable(membership, t.registrationDeadline, new Date()),
      } : null,
    };
  }
```

(Conserver le commentaire JSDoc existant de `getById` en le complétant d'une ligne sur `contactable`.)

- [ ] **Step 4 : Vérifier la suite entière** (`npx jest --runTestsByPath src/services/__tests__/tournament.service.test.ts` → PASS, y compris « projection publique — refereeUserId ne fuite pas »)

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/tournament.service.ts backend/src/services/__tests__/tournament.service.test.ts
git commit -m "feat(referee): getById expose referee.contactable (calcule serveur, userId toujours masque)"
```

---

### Task 4 : Backend — porte de contact `POST /api/tournaments/:id/contact-referee`

**Files:**
- Modify: `backend/src/services/tournament.service.ts` (section « Espace juge-arbitre »)
- Modify: `backend/src/routes/tournaments.ts`
- Test: `backend/src/services/__tests__/tournament.service.test.ts`
- Test: `backend/src/routes/__tests__/tournaments.routes.test.ts`

- [ ] **Step 1 : Tests service (échouants)**

Dans `tournament.service.test.ts`, en fin de fichier :

```ts
// La porte du bouton « Contacter le J/A » : inscrit non-annulé + J/A désigné + politique
// re-vérifiée serveur. Le userId du J/A ne sort de cette méthode que contact autorisé.
describe('assertRefereeContactable — porte du contact J/A', () => {
  let svc: TournamentService;
  beforeEach(() => { jest.clearAllMocks(); svc = new TournamentService(); });

  const PAST = new Date('2000-01-01T00:00:00Z'), FUTURE = new Date('2099-01-01T00:00:00Z');
  const mockT = (over: Record<string, unknown> = {}) => {
    prismaMock.tournament.findUnique.mockResolvedValue({
      status: 'PUBLISHED', clubId: 'club-1', refereeUserId: 'u-ref',
      registrationDeadline: PAST, club: { slug: 'demo' }, ...over,
    } as any);
  };
  const mockReg = (found: boolean) =>
    prismaMock.tournamentRegistration.findFirst.mockResolvedValue(found ? ({ id: 'r1' } as any) : null);
  const membership = (over: Record<string, unknown> = {}) =>
    prismaMock.clubMembership.findUnique.mockResolvedValue({
      status: 'ACTIVE', isReferee: true, refereeContactPolicy: 'AFTER_DEADLINE', ...over,
    } as any);

  it('tournoi introuvable → TOURNAMENT_NOT_FOUND', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(null as any);
    await expect(svc.assertRefereeContactable('t1', 'me')).rejects.toThrow('TOURNAMENT_NOT_FOUND');
  });

  it('tournoi DRAFT → TOURNAMENT_NOT_FOUND (pas de fuite d’existence)', async () => {
    mockT({ status: 'DRAFT' });
    await expect(svc.assertRefereeContactable('t1', 'me')).rejects.toThrow('TOURNAMENT_NOT_FOUND');
  });

  it('viewer non inscrit → NOT_REGISTERED, la membership n’est jamais lue', async () => {
    mockT(); mockReg(false);
    await expect(svc.assertRefereeContactable('t1', 'me')).rejects.toThrow('NOT_REGISTERED');
    expect(prismaMock.clubMembership.findUnique).not.toHaveBeenCalled();
  });

  it('le comptage d’inscription exclut les annulées et couvre capitaine OU partenaire', async () => {
    mockT(); mockReg(true); membership();
    await svc.assertRefereeContactable('t1', 'me');
    const arg = (prismaMock.tournamentRegistration.findFirst as jest.Mock).mock.calls[0][0];
    expect(arg.where.status).toEqual({ not: 'CANCELLED' });
    expect(arg.where.OR).toEqual([{ captainUserId: 'me' }, { partnerUserId: 'me' }]);
  });

  it('pas de J/A désigné → TOURNAMENT_NO_REFEREE', async () => {
    mockT({ refereeUserId: null }); mockReg(true);
    await expect(svc.assertRefereeContactable('t1', 'me')).rejects.toThrow('TOURNAMENT_NO_REFEREE');
  });

  it('politique NEVER → REFEREE_NOT_CONTACTABLE', async () => {
    mockT(); mockReg(true); membership({ refereeContactPolicy: 'NEVER' });
    await expect(svc.assertRefereeContactable('t1', 'me')).rejects.toThrow('REFEREE_NOT_CONTACTABLE');
  });

  it('AFTER_DEADLINE avant clôture → REFEREE_NOT_CONTACTABLE', async () => {
    mockT({ registrationDeadline: FUTURE }); mockReg(true); membership();
    await expect(svc.assertRefereeContactable('t1', 'me')).rejects.toThrow('REFEREE_NOT_CONTACTABLE');
  });

  it('facette retirée → REFEREE_NOT_CONTACTABLE (kill-switch)', async () => {
    mockT(); mockReg(true); membership({ isReferee: false });
    await expect(svc.assertRefereeContactable('t1', 'me')).rejects.toThrow('REFEREE_NOT_CONTACTABLE');
  });

  it('contact autorisé → renvoie refereeUserId + clubSlug (pour la messagerie)', async () => {
    mockT(); mockReg(true); membership();
    await expect(svc.assertRefereeContactable('t1', 'me'))
      .resolves.toEqual({ refereeUserId: 'u-ref', clubSlug: 'demo' });
  });
});
```

- [ ] **Step 2 : Vérifier qu'ils échouent** (FAIL `assertRefereeContactable is not a function`)

- [ ] **Step 3 : Implémenter la méthode service**

Dans `tournament.service.ts`, section « Espace juge-arbitre » (après `setRefereeContactPolicy`) :

```ts
  /**
   * Porte du bouton « Contacter le J/A » : inscrit non-annulé (capitaine ou partenaire) +
   * J/A désigné + politique re-calculée serveur (jamais confiée au client). Renvoie
   * l'identité à passer à la messagerie — le userId du J/A ne sort d'ici que contact autorisé.
   */
  async assertRefereeContactable(tournamentId: string, meId: string): Promise<{ refereeUserId: string; clubSlug: string }> {
    const t = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: {
        status: true, clubId: true, refereeUserId: true, registrationDeadline: true,
        club: { select: { slug: true } },
      },
    });
    if (!t || t.status === 'DRAFT') throw new Error('TOURNAMENT_NOT_FOUND');
    const reg = await prisma.tournamentRegistration.findFirst({
      where: { tournamentId, status: { not: 'CANCELLED' }, OR: [{ captainUserId: meId }, { partnerUserId: meId }] },
      select: { id: true },
    });
    if (!reg) throw new Error('NOT_REGISTERED');
    if (!t.refereeUserId) throw new Error('TOURNAMENT_NO_REFEREE');
    const membership = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId: t.refereeUserId, clubId: t.clubId } },
      select: { status: true, isReferee: true, refereeContactPolicy: true },
    });
    if (!refereeContactable(membership, t.registrationDeadline, new Date())) throw new Error('REFEREE_NOT_CONTACTABLE');
    return { refereeUserId: t.refereeUserId, clubSlug: t.club.slug };
  }
```

- [ ] **Step 4 : Tests service PASS** (`-t "porte du contact"`)

- [ ] **Step 5 : Tests route (échouants)**

Dans `tournaments.routes.test.ts` :
1. En tête (après le mock StripeService, ~ligne 18), ajouter le mock MessagingService — même pattern que le fichier (const déclarées avant `import app`) :

```ts
// La route contact-referee délègue à la messagerie : on la stubbe (gardes DM testées chez elle).
const getOrCreateConversation = jest.fn();
jest.mock('../../services/messaging.service', () => ({
  MessagingService: jest.fn().mockImplementation(() => ({ getOrCreateConversation })),
}));
```

⚠️ `jest.mock` est hoisté : suivre EXACTEMENT le pattern du fichier (const `jest.fn()` déclarée au top niveau AVANT `import app from '../../app'` — c'est le pattern déjà en place dans `clubs.referee.routes.test.ts` lignes 38-57, il fonctionne avec ts-jest).
2. Ajouter `getOrCreateConversation.mockClear();` dans le `beforeEach` existant (~ligne 31).
3. En fin de fichier :

```ts
// ---------------------------------------------------------------------------
// POST /api/tournaments/:id/contact-referee
// ---------------------------------------------------------------------------
describe('POST /api/tournaments/:id/contact-referee', () => {
  it('401 sans token', async () => {
    const res = await request(app).post('/api/tournaments/t1/contact-referee');
    expect(res.status).toBe(401);
  });

  it('200 — porte OK → délègue à la messagerie et renvoie la conversation', async () => {
    const spy = jest.spyOn(TournamentService.prototype, 'assertRefereeContactable')
      .mockResolvedValue({ refereeUserId: 'u-ref', clubSlug: 'demo' });
    getOrCreateConversation.mockResolvedValue({ id: 'conv-1', other: { userId: 'u-ref' } });

    const res = await request(app)
      .post('/api/tournaments/t1/contact-referee')
      .set('Authorization', `Bearer ${token1}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('conv-1');
    expect(getOrCreateConversation).toHaveBeenCalledWith('user-1', 'u-ref', 'demo');
    spy.mockRestore();
  });

  it('403 NOT_REGISTERED (réservé aux inscrits)', async () => {
    const spy = jest.spyOn(TournamentService.prototype, 'assertRefereeContactable')
      .mockRejectedValue(new Error('NOT_REGISTERED'));
    const res = await request(app)
      .post('/api/tournaments/t1/contact-referee')
      .set('Authorization', `Bearer ${token1}`);
    expect(res.status).toBe(403);
    expect(getOrCreateConversation).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('409 REFEREE_NOT_CONTACTABLE', async () => {
    const spy = jest.spyOn(TournamentService.prototype, 'assertRefereeContactable')
      .mockRejectedValue(new Error('REFEREE_NOT_CONTACTABLE'));
    const res = await request(app)
      .post('/api/tournaments/t1/contact-referee')
      .set('Authorization', `Bearer ${token1}`);
    expect(res.status).toBe(409);
    spy.mockRestore();
  });

  it('les gardes DM restent souveraines : DM_DISABLED relayé en 409', async () => {
    const spy = jest.spyOn(TournamentService.prototype, 'assertRefereeContactable')
      .mockResolvedValue({ refereeUserId: 'u-ref', clubSlug: 'demo' });
    getOrCreateConversation.mockRejectedValue(new Error('DM_DISABLED'));
    const res = await request(app)
      .post('/api/tournaments/t1/contact-referee')
      .set('Authorization', `Bearer ${token1}`);
    expect(res.status).toBe(409);
    spy.mockRestore();
  });
});
```

- [ ] **Step 6 : Vérifier qu'ils échouent** (404 sur la route)

- [ ] **Step 7 : Implémenter la route**

Dans `tournaments.ts` :
1. Import + instance (comme `conversations.ts` ligne 9) :

```ts
import { MessagingService } from '../services/messaging.service';
```
et après `const service = new TournamentService();` :
```ts
const messaging = new MessagingService();
```

2. Compléter `ERROR_STATUS` (codes de la porte + codes DM relayés, mêmes statuts que `conversations.ts`) :

```ts
  NOT_REGISTERED:               403,
  TOURNAMENT_NO_REFEREE:        404,
  REFEREE_NOT_CONTACTABLE:      409,
  NOT_CO_MEMBERS:               403,
  USER_BLOCKED:                 409,
  DM_DISABLED:                  409,
  CANNOT_MESSAGE_SELF:          400,
  CONVERSATION_NOT_FOUND:       404,
  RATE_LIMITED:                 429,
```

3. La route, après `DELETE /:id/registration` (~ligne 89) :

```ts
// Contacter le J/A : réservé aux inscrits, politique du J/A re-vérifiée serveur, puis
// délégation intégrale à la messagerie (gardes DM souveraines : blocage, opt-out, rate-limit).
// Le userId du J/A n'est jamais dans le payload public — il ne sort que via la conversation.
router.post('/:id/contact-referee', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { refereeUserId, clubSlug } = await service.assertRefereeContactable(asString(req.params.id), req.user!.id);
    res.json(await messaging.getOrCreateConversation(req.user!.id, refereeUserId, clubSlug));
  } catch (err) { handleError(err, res, next); }
});
```

- [ ] **Step 8 : Les deux suites backend passent en entier**

```bash
npx jest --runTestsByPath src/services/__tests__/tournament.service.test.ts src/routes/__tests__/tournaments.routes.test.ts
```

- [ ] **Step 9 : Commit**

```bash
git add backend/src/services/tournament.service.ts backend/src/routes/tournaments.ts backend/src/services/__tests__/tournament.service.test.ts backend/src/routes/__tests__/tournaments.routes.test.ts
git commit -m "feat(referee): POST /api/tournaments/:id/contact-referee (porte inscrits + delegation messagerie)"
```

---

### Task 5 : Front — types API + bouton « Contacter » sur la carte méta (hero)

**Files:**
- Modify: `frontend/lib/api.ts` (type ligne ~2372, méthodes après ligne 1162)
- Modify: `frontend/components/agenda/AgendaHero.tsx` (interface `MetaCard` ligne ~111, bande méta lignes 95-105)
- Modify: `frontend/components/tournament/TournamentHero.tsx`
- Test: `frontend/__tests__/TournamentHero.test.tsx`

- [ ] **Step 1 : Tests TournamentHero (échouants)**

Dans `TournamentHero.test.tsx` :
1. Ligne 1 : ajouter `fireEvent` à l'import de `@testing-library/react`.
2. En fin de fichier :

```ts
// Le bouton « Contacter » n'est qu'un relais : le GATING (contactable + inscrit) vit dans
// la page — le hero rend le bouton ssi la page lui passe onContactReferee.
describe('TournamentHero — contact du J/A', () => {
  it('onContactReferee fourni → bouton « Contacter » sur la carte J/A', () => {
    const onContact = jest.fn();
    wrap(<TournamentHero t={tournament({ referee: { name: 'Julien Martin', contactable: true } })} now={NOW} onContactReferee={onContact} />);
    fireEvent.click(screen.getByRole('button', { name: 'Contacter' }));
    expect(onContact).toHaveBeenCalled();
  });

  it('sans onContactReferee → nom seul, pas de bouton', () => {
    wrap(<TournamentHero t={tournament({ referee: { name: 'Julien Martin', contactable: true } })} now={NOW} />);
    expect(screen.getByText('Julien Martin')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Contacter' })).not.toBeInTheDocument();
  });

  it('sans J/A → pas de bouton même avec le callback', () => {
    wrap(<TournamentHero t={tournament({ referee: null })} now={NOW} onContactReferee={jest.fn()} />);
    expect(screen.queryByRole('button', { name: 'Contacter' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2 : Vérifier qu'ils échouent** — depuis `frontend/` : `npx jest --runTestsByPath __tests__/TournamentHero.test.tsx` (FAIL : prop inconnue / bouton absent)

- [ ] **Step 3 : Implémenter**

1. `frontend/lib/api.ts` :
   - Ligne ~2372, remplacer le type du champ :

```ts
  referee?: { name: string; contactable?: boolean } | null; // J/A public : nom seul + contactabilité calculée serveur, jamais le userId
```

   - Près des types de l'espace J/A (~ligne 3080), ajouter :

```ts
export type RefereeContactPolicy = 'ALWAYS' | 'AFTER_DEADLINE' | 'NEVER';
```

   - Après `refereeRemoveRegistration` (ligne ~1162) :

```ts
  // Réglage de contactabilité du J/A (par club) + porte de contact depuis la fiche tournoi.
  getRefereeContactPolicy: (slug: string, token: string) =>
    request<{ policy: RefereeContactPolicy }>(`/api/clubs/${slug}/me/referee/contact-policy`, {}, token),
  setRefereeContactPolicy: (slug: string, policy: RefereeContactPolicy, token: string) =>
    request<{ policy: RefereeContactPolicy }>(`/api/clubs/${slug}/me/referee/contact-policy`, { method: 'PATCH', body: JSON.stringify({ policy }) }, token),
  contactTournamentReferee: (tournamentId: string, token: string) =>
    request<ConversationSummary>(`/api/tournaments/${tournamentId}/contact-referee`, { method: 'POST' }, token),
```

2. `frontend/components/agenda/AgendaHero.tsx` :
   - Interface `MetaCard` (ligne ~111) :

```ts
export interface MetaCard {
  icon: IconName;
  label: string;
  value: string;
  action?: { label: string; onClick: () => void }; // petit bouton après la valeur (bande méta du hero seulement)
}
```

   - Dans la bande méta (lignes 97-103), après le `<span>` de la valeur, à l'intérieur du `<span>` conteneur :

```tsx
                {m.action && (
                  <button type="button" onClick={m.action.onClick}
                    style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, color: HERO_INK, textDecoration: 'underline', textUnderlineOffset: 2 }}>
                    {m.action.label}
                  </button>
                )}
```

   (`MetaCardsRow` n'affiche pas `action` — seule la bande du hero le rend.)

3. `frontend/components/tournament/TournamentHero.tsx` :

```ts
export function TournamentHero({ t, now, multiSport = false, onContactReferee }: { t: TournamentDetail; now: Date | null; multiSport?: boolean; onContactReferee?: () => void }) {
```

et la carte J/A (ligne 19) devient :

```ts
    // Nom seul : le J/A répond du tournoi, mais ses coordonnées restent l'affaire de `contactInfo`.
    // `onContactReferee` (fourni par la page ssi contactable + inscrit) → action « Contacter ».
    ...(t.referee ? [{
      icon: 'whistle', label: 'Juge-arbitre', value: t.referee.name,
      ...(onContactReferee ? { action: { label: 'Contacter', onClick: onContactReferee } } : {}),
    } as MetaCard] : []),
```

- [ ] **Step 4 : Tests PASS** (`npx jest --runTestsByPath __tests__/TournamentHero.test.tsx` — toute la suite)

- [ ] **Step 5 : Commit**

```bash
git add frontend/lib/api.ts frontend/components/agenda/AgendaHero.tsx frontend/components/tournament/TournamentHero.tsx frontend/__tests__/TournamentHero.test.tsx
git commit -m "feat(referee): bouton Contacter sur la carte meta J/A (MetaCard.action) + types/methodes api"
```

---

### Task 6 : Front — câblage fiche `/tournois/[id]` (gating + openDm)

**Files:**
- Modify: `frontend/app/tournois/[id]/TournamentDetailClient.tsx`
- Test: `frontend/__tests__/TournamentDetail.test.tsx`

- [ ] **Step 1 : Tests (échouants)**

Dans `TournamentDetail.test.tsx` :
1. Remplacer le stub `TournamentHero` (lignes 10-13) par un stub qui expose la prop :

```tsx
jest.mock('../components/tournament/TournamentHero', () => ({
  TournamentHero: ({ onContactReferee }: { onContactReferee?: () => void }) => (
    <div data-testid="tournament-hero">
      {onContactReferee && <button onClick={onContactReferee}>Contacter</button>}
    </div>
  ),
  MetaCards: () => null,
}));
```

2. Mocker `lib/messages` (après les mocks composants) :

```ts
const openDm = jest.fn();
jest.mock('../lib/messages', () => ({
  openDm: (...a: unknown[]) => openDm(...a),
  DM_ERRORS: { DM_DISABLED: "Ce joueur n'accepte pas les messages privés." },
}));
```

3. Ajouter au mock api (lignes 70-88) : `const contactTournamentReferee = jest.fn();` (avec les autres const ligne 63-68) et `contactTournamentReferee: (...a: unknown[]) => contactTournamentReferee(...a),` dans l'objet `api`.
4. En fin de fichier (réutiliser le helper de rendu du fichier — `render(<ThemeProvider><TournamentDetailClient id="t1" /></ThemeProvider>)` ou le helper local existant, et les mocks par défaut du `beforeEach` existant) :

```tsx
// Gating du bouton : token + referee.contactable + inscription active. Le clic passe par la
// porte serveur (contactTournamentReferee) puis ouvre le DM avec un brouillon pré-rempli.
describe('contact du J/A', () => {
  const withReferee = { referee: { name: 'Julien Martin', contactable: true } };
  const myReg = { id: 'reg-1', status: 'CONFIRMED', tournament: { id: 't1' } };

  it('inscrit + contactable → Contacter → porte serveur puis openDm (brouillon pré-rempli)', async () => {
    getTournament.mockResolvedValue({ ...baseTournament, ...withReferee });
    getMyTournaments.mockResolvedValue([myReg]);
    contactTournamentReferee.mockResolvedValue({ id: 'conv-1', other: { userId: 'u-ref' } });

    render(<ThemeProvider><TournamentDetailClient id="t1" /></ThemeProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Contacter' }));

    await waitFor(() => expect(contactTournamentReferee).toHaveBeenCalledWith('t1', 'tok'));
    await waitFor(() => expect(openDm).toHaveBeenCalledWith('u-ref',
      expect.objectContaining({ draft: expect.stringContaining('Tournoi Test P100') })));
  });

  it('non inscrit → pas de bouton Contacter', async () => {
    getTournament.mockResolvedValue({ ...baseTournament, ...withReferee });
    getMyTournaments.mockResolvedValue([]);
    render(<ThemeProvider><TournamentDetailClient id="t1" /></ThemeProvider>);
    await screen.findByTestId('tournament-hero');
    expect(screen.queryByRole('button', { name: 'Contacter' })).not.toBeInTheDocument();
  });

  it('J/A non contactable → pas de bouton, même inscrit', async () => {
    getTournament.mockResolvedValue({ ...baseTournament, referee: { name: 'Julien Martin', contactable: false } });
    getMyTournaments.mockResolvedValue([myReg]);
    render(<ThemeProvider><TournamentDetailClient id="t1" /></ThemeProvider>);
    await screen.findByTestId('tournament-hero');
    expect(screen.queryByRole('button', { name: 'Contacter' })).not.toBeInTheDocument();
  });

  it('porte refusée → message lisible, jamais le code brut', async () => {
    getTournament.mockResolvedValue({ ...baseTournament, ...withReferee });
    getMyTournaments.mockResolvedValue([myReg]);
    contactTournamentReferee.mockRejectedValue(new Error('REFEREE_NOT_CONTACTABLE'));

    render(<ThemeProvider><TournamentDetailClient id="t1" /></ThemeProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Contacter' }));

    expect(await screen.findByText(/n'est pas joignable/)).toBeInTheDocument();
    expect(openDm).not.toHaveBeenCalled();
  });
});
```

⚠️ Adapter les `beforeEach`/fixtures au harnais réel du fichier (profil/membership mockés) — le squelette ci-dessus suit les mocks lignes 63-100 existants ; `baseTournament.name` vaut `'Tournoi Test P100'`.

- [ ] **Step 2 : Vérifier qu'ils échouent** (`npx jest --runTestsByPath __tests__/TournamentDetail.test.tsx -t "contact du J/A"`)

- [ ] **Step 3 : Implémenter dans `TournamentDetailClient.tsx`**

1. Ligne 22, élargir l'import : `import { openDm, DM_ERRORS } from '@/lib/messages';`
2. Compléter `ERROR_FR` (lignes 25-38) :

```ts
  NOT_REGISTERED: 'Réservé aux inscrits du tournoi.',
  REFEREE_NOT_CONTACTABLE: "Le juge-arbitre n'est pas joignable pour le moment.",
  TOURNAMENT_NO_REFEREE: "Ce tournoi n'a pas de juge-arbitre désigné.",
  RATE_LIMITED: 'Trop de nouvelles conversations, réessayez plus tard.',
  ...DM_ERRORS,
```

3. Après le handler `cancel` (~ligne 164) :

```ts
  // Contact du J/A : la porte (inscrit + politique) est re-vérifiée serveur ; la conversation
  // renvoyée porte le userId du J/A (révélé seulement contact autorisé) → openDm + brouillon.
  const contactReferee = async () => {
    if (!token) return;
    setError(null);
    try {
      const conv = await api.contactTournamentReferee(id, token);
      openDm(conv.other.userId, { isDesktop, navigate: (h) => router.push(h), draft: `Bonjour, à propos du tournoi ${t.name}…` });
    } catch (e) { setError(messageFor(e)); }
  };
```

4. Le rendu du hero (ligne 182) devient :

```tsx
        <TournamentHero t={t} now={now} multiSport={clubIsMultiSport(club)}
          onContactReferee={token && t.referee?.contactable && myReg ? contactReferee : undefined} />
```

(`myReg` vient de `getMyTournaments` qui ne renvoie que les inscriptions actives — une annulation locale fait `setMyReg(null)` : le gating « non annulée » est déjà porté par l'état.)

- [ ] **Step 4 : Suite entière PASS** (`npx jest --runTestsByPath __tests__/TournamentDetail.test.tsx`)

- [ ] **Step 5 : Commit**

```bash
git add frontend/app/tournois/[id]/TournamentDetailClient.tsx frontend/__tests__/TournamentDetail.test.tsx
git commit -m "feat(referee): fiche tournoi — bouton Contacter gate (inscrit + contactable) vers le DM"
```

---

### Task 7 : Front — réglage 3 états dans `/me/refereeing`

**Files:**
- Modify: `frontend/app/me/refereeing/page.tsx`
- Test: `frontend/__tests__/MeRefereeing.test.tsx`

- [ ] **Step 1 : Tests (échouants)**

Dans `MeRefereeing.test.tsx` :
1. Ajouter au mock api (lignes 11-19) : `getRefereeContactPolicy: jest.fn(), setRefereeContactPolicy: jest.fn(),`
2. Dans le `beforeEach` (lignes 46-50) : `(api.getRefereeContactPolicy as jest.Mock).mockResolvedValue({ policy: 'AFTER_DEADLINE' });`
3. En fin de fichier :

```tsx
// Réglage de contactabilité : Segmented 3 états, persistance immédiate optimiste
// (la page n'a pas d'infrastructure brouillon/SaveBar — pattern ClubHouseSectionsCard).
describe('réglage de contactabilité', () => {
  it('affiche le réglage chargé avec ses 3 états', async () => {
    render(<ThemeProvider><MeRefereeingPage /></ThemeProvider>);
    await screen.findByText('Open de Paris');
    expect(await screen.findByRole('button', { name: 'Après clôture' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Toujours' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Jamais' })).toBeInTheDocument();
  });

  it('changer le réglage → PATCH avec la nouvelle valeur', async () => {
    (api.setRefereeContactPolicy as jest.Mock).mockResolvedValue({ policy: 'NEVER' });
    render(<ThemeProvider><MeRefereeingPage /></ThemeProvider>);
    await screen.findByText('Open de Paris');
    fireEvent.click(await screen.findByRole('button', { name: 'Jamais' }));
    await waitFor(() => expect(api.setRefereeContactPolicy).toHaveBeenCalledWith('demo', 'NEVER', 't'));
  });

  it('échec du PATCH → erreur affichée (et pas de crash)', async () => {
    (api.setRefereeContactPolicy as jest.Mock).mockRejectedValue(new Error('VALIDATION_ERROR'));
    render(<ThemeProvider><MeRefereeingPage /></ThemeProvider>);
    await screen.findByText('Open de Paris');
    fireEvent.click(await screen.findByRole('button', { name: 'Jamais' }));
    expect(await screen.findByText(/VALIDATION_ERROR/)).toBeInTheDocument();
  });

  it('pas J/A → pas de bloc Contact', async () => {
    (api.getRefereeTournaments as jest.Mock).mockRejectedValue(new Error('NOT_A_REFEREE'));
    (api.getRefereeContactPolicy as jest.Mock).mockRejectedValue(new Error('NOT_A_REFEREE'));
    render(<ThemeProvider><MeRefereeingPage /></ThemeProvider>);
    await screen.findByText(/réservé aux juges-arbitres/i);
    expect(screen.queryByRole('button', { name: 'Jamais' })).not.toBeInTheDocument();
  });
});
```

(Le fichier a déjà un helper `mount()` — l'utiliser à la place des `render(...)` explicites. Si les options du `Segmented` ne sont pas des `role="button"`, remplacer par `screen.getByText('Jamais')` — vérifier `components/ui/atoms.tsx`.)

- [ ] **Step 2 : Vérifier qu'ils échouent** (`npx jest --runTestsByPath __tests__/MeRefereeing.test.tsx -t "contactabilité"`)

- [ ] **Step 3 : Implémenter dans `page.tsx`**

1. Élargir l'import api : `import { api, RefereeTournamentRow, RefereeRegistrationRow, RefereeContactPolicy } from '@/lib/api';`
2. États + chargement (après l'état `now`, ~ligne 45) :

```ts
  // Réglage de contactabilité (null tant que non chargé → bloc masqué ; un 403 NOT_A_REFEREE
  // laisse null, cohérent avec l'écran « réservé aux juges-arbitres »).
  const [policy, setPolicy] = useState<RefereeContactPolicy | null>(null);
  useEffect(() => {
    if (!ready || !token || !slug) return;
    api.getRefereeContactPolicy(slug, token).then((r) => setPolicy(r.policy)).catch(() => {});
  }, [ready, token, slug]);

  const changePolicy = async (next: RefereeContactPolicy) => {
    if (!token || !slug || policy === null || next === policy) return;
    const prev = policy;
    setPolicy(next); // optimiste — revert si le PATCH échoue
    try { await api.setRefereeContactPolicy(slug, next, token); }
    catch (e) { setPolicy(prev); setError(errorLabel(e)); }
  };
```

3. Rendu, dans la branche `!notReferee`, AVANT le `Segmented` de scope (~ligne 113) :

```tsx
            {policy !== null && (
              <section aria-label="Contact" style={{ background: th.surface, borderRadius: 14, padding: '12px 14px', boxShadow: th.shadow, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontFamily: th.fontUI, fontSize: 12, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textFaint }}>Contact</span>
                <Segmented<RefereeContactPolicy> value={policy} onChange={changePolicy}
                  options={[{ value: 'ALWAYS', label: 'Toujours' }, { value: 'AFTER_DEADLINE', label: 'Après clôture' }, { value: 'NEVER', label: 'Jamais' }]} />
                <p style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, margin: 0, lineHeight: 1.5 }}>
                  Les inscrits de vos tournois peuvent vous écrire via la messagerie.
                </p>
              </section>
            )}
```

- [ ] **Step 4 : Suite entière PASS** (`npx jest --runTestsByPath __tests__/MeRefereeing.test.tsx`)

- [ ] **Step 5 : Commit**

```bash
git add frontend/app/me/refereeing/page.tsx frontend/__tests__/MeRefereeing.test.tsx
git commit -m "feat(referee): reglage de contactabilite 3 etats dans l'espace Arbitrage"
```

---

### Task 8 : Vérifications finales + documentation

**Files:**
- Modify: `CLAUDE.md` (section Tournois, après l'évolution « table de marque »)

- [ ] **Step 1 : Type-check des deux côtés**

```bash
cd backend && node node_modules/typescript/bin/tsc --noEmit
cd ../frontend && node node_modules/typescript/bin/tsc --noEmit
```
Attendu : 0 erreur dans les fichiers touchés (du WIP parallèle peut exister — ne juger que nos fichiers).

- [ ] **Step 2 : Toutes les suites du périmètre**

```bash
cd backend && npx jest --runTestsByPath src/services/__tests__/tournament.service.test.ts src/routes/__tests__/clubs.referee.routes.test.ts src/routes/__tests__/tournaments.routes.test.ts
cd ../frontend && npx jest --runTestsByPath __tests__/TournamentHero.test.tsx __tests__/TournamentDetail.test.tsx __tests__/MeRefereeing.test.tsx
```
Attendu : tout PASS. (Rappel : le full-run frontend a un flake BookingModal pré-existant, hors périmètre.)

- [ ] **Step 3 : Documenter dans CLAUDE.md**

Ajouter une courte évolution après le bloc « table de marque du juge-arbitre » :

```markdown
> **Évolution (2026-07-22) — contacter le J/A d'un tournoi :** les **inscrits** (capitaine/partenaire non annulés) peuvent écrire au J/A via la **messagerie DM existante** — bouton « Contacter » sur la carte méta J/A de `/tournois/[id]`, gaté par `referee.contactable` (booléen **calculé serveur** dans `getById` : politique + clôture + kill-switch facette, la membership du J/A est lue via `referee.clubMemberships`, **`refereeUserId` jamais lu sur le chemin public**). Porte serveur `POST /api/tournaments/:id/contact-referee` (`assertRefereeContactable` : `NOT_REGISTERED` 403 / `TOURNAMENT_NO_REFEREE` 404 / `REFEREE_NOT_CONTACTABLE` 409) puis **délégation intégrale à `MessagingService.getOrCreateConversation`** (gardes DM souveraines, y compris `acceptsDirectMessages` — la politique J/A n'outrepasse pas l'opt-out DM global) ; le userId du J/A ne sort que via la conversation, contact autorisé. **Réglage 3 états** `ClubMembership.refereeContactPolicy` (enum `RefereeContactPolicy` ALWAYS/AFTER_DEADLINE/NEVER, **défaut AFTER_DEADLINE**, migration additive `add_referee_contact_policy`) édité en tête de `/me/refereeing` (`Segmented` optimiste, routes `GET/PATCH /:slug/me/referee/contact-policy` gate `resolveReferee`). `MetaCard` gagne une prop additive `action?` (bande méta du hero seulement). Le brouillon DM est pré-rempli « Bonjour, à propos du tournoi {nom}… ». Tests : `tournament.service` (policy/contactable/porte), `clubs.referee.routes`, `tournaments.routes` (back) ; `TournamentHero`/`TournamentDetail`/`MeRefereeing` (front). Spec & plan : `docs/superpowers/{specs,plans}/2026-07-22-contacter-juge-arbitre*`.
```

- [ ] **Step 4 : Commit final**

```bash
git add CLAUDE.md
git commit -m "docs(claude): evolution contacter le J/A d'un tournoi"
```

---

## Vérification de bout en bout (manuelle, après implémentation)

1. Redémarrer la stack (`start.ps1` — le backend doit recharger le client Prisma régénéré).
2. En SQL ou via l'admin, désigner un J/A sur un tournoi de `club-demo` (compte avec facette `isReferee`) et s'inscrire au tournoi avec `test@palova.fr` (+ binôme).
3. `/me/refereeing` (compte J/A) : le bloc « Contact » affiche « Après clôture » ; passer sur « Toujours ».
4. Fiche `/tournois/[id]` (compte inscrit) : bouton « Contacter » sur la carte J/A → clic → le widget DM s'ouvre avec le brouillon « Bonjour, à propos du tournoi… » ; envoyer un message, vérifier la réception côté J/A (`/me/messages`).
5. Repasser le réglage sur « Jamais » → recharger la fiche : bouton absent ; forcer `POST /api/tournaments/:id/contact-referee` (curl avec le token de l'inscrit) → 409 `REFEREE_NOT_CONTACTABLE`.
6. Compte NON inscrit : pas de bouton ; curl → 403 `NOT_REGISTERED`.
7. Vérif visuelle (skill `verify` / CDP) clair + sombre, desktop 1280 + mobile 390 : carte méta avec bouton (pas de débordement), bloc Contact de l'espace Arbitrage.
