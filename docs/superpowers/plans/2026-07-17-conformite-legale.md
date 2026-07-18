# Conformité légale — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** implémenter la spec `docs/superpowers/specs/2026-07-17-conformite-legale-design.md` — corpus légal Tolaris Studio (mentions/CGU/CGV SaaS+DPA/confidentialité), preuves d'acceptation versionnées, CGV club sur tout le parcours d'achat en ligne, repli légal permanent des pages club, médiateur de la consommation, désinscription broadcasts, export RGPD.

**Architecture :** documents plateforme dans le code (`platformContent.ts`) + table `LegalAcceptance` insert-only + versions dans `LEGAL_VERSIONS` ; extension du pattern existant `cgvAcceptedAt` aux 3 parcours d'achat ; l'infra `ClubPage`/admin « Contenu & mentions » est conservée et enrichie.

**Tech stack :** Express + Prisma 7 (driver adapter), Next.js 16, Jest (back + front).

---

## Contexte d'exécution (à lire avant toute tâche)

- **JAMAIS `git stash`** (la pile est partagée avec d'autres sessions/worktrees). Ne committer QUE les fichiers de sa tâche (du WIP tiers existe dans le working tree : `seed-offers.ts`, `OffersShowcase*`, `ClubHouse.tsx` — ne pas les toucher ni les committer).
- **Migrations DEV** : jamais `prisma migrate dev`/`db push` (dérive de base connue). Créer le dossier de migration + `npx prisma db execute --file prisma/migrations/<dossier>/migration.sql` puis `npx prisma generate` (Prisma 7 : sans `--schema`, la config vient de `prisma.config.ts`). Prod = `migrate deploy` (rien à faire ici).
- **Shims npm cassés** : `npx jest`/`npx tsc` échouent. Utiliser `node node_modules/jest/bin/jest.js` et `node node_modules/typescript/bin/tsc` (cwd = `backend/` ou `frontend/`).
- **Jest frontend ne type-check pas** : après chaque tâche front, `node node_modules/typescript/bin/tsc --noEmit` dans `frontend/`.
- **Jest traite un chemin comme un motif** : pour cibler un seul fichier front, `--runTestsByPath`.
- **Suite front complète** : ~6 échecs BookingModal préexistants (flake d'isolation) — vérifier par suites ciblées.
- Erreurs métier backend : `throw new Error('CODE')` dans les services, mapping HTTP via la table `ERROR_STATUS` + `handleError` du routeur concerné.

**Ordre** : tâches 1→12 = backend, 13→19 = frontend, 20 = vérification finale. Les tâches front 14-19 dépendent des types ajoutés en 13b (`lib/api.ts`).

---

### Task 1 : Migrations Prisma (schéma + SQL + client)

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260718090000_add_legal_acceptances/migration.sql`
- Create: `backend/prisma/migrations/20260718090100_add_cgv_accepted_columns/migration.sql`
- Create: `backend/prisma/migrations/20260718090200_add_club_mediator/migration.sql`

- [ ] **Step 1 : ajouter au schéma Prisma** — dans `backend/prisma/schema.prisma` :

Près des autres enums (vers `NotificationCategory`, l.~1293) :

```prisma
/// Documents légaux plateforme dont l'acceptation est tracée (versions dans src/content/legalVersions.ts).
enum LegalDocument {
  CGU
  CGV_SAAS
  PRIVACY
}
```

Nouveau modèle (près de `NotificationPreference`) :

```prisma
/// Preuve d'acceptation d'un document légal — INSERT-ONLY : on n'update ni ne supprime
/// jamais une ligne (historique = piste d'audit). clubId renseigné pour CGV_SAAS
/// acceptées à la création d'un club (le club qui contracte).
model LegalAcceptance {
  id         String        @id @default(cuid())
  userId     String        @map("user_id")
  clubId     String?       @map("club_id")
  document   LegalDocument
  version    String
  context    String        // 'register' | 'club_create' | 'update_banner'
  acceptedAt DateTime      @default(now()) @map("accepted_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, document])
  @@map("legal_acceptances")
}
```

Dans `model User`, ajouter la relation (avec les autres relations) : `legalAcceptances LegalAcceptance[]`.

Dans `model TournamentRegistration` (après `paymentDeadline`) : `cgvAcceptedAt DateTime? @map("cgv_accepted_at")`.
Dans `model EventRegistration` (après `paymentDeadline`) : `cgvAcceptedAt DateTime? @map("cgv_accepted_at")`.
Dans `model Payment` (après `stripePaymentMethodId`) : `cgvAcceptedAt DateTime? @map("cgv_accepted_at")`.
Dans `model Club`, à côté de `legalPhone` : 

```prisma
  /// Médiation de la consommation (obligation B2C du club) — injecté dans le modèle CGV.
  mediatorName String? @map("mediator_name")
  mediatorUrl  String? @map("mediator_url")
```

- [ ] **Step 2 : écrire les 3 migrations SQL**

`20260718090000_add_legal_acceptances/migration.sql` :

```sql
-- Preuves d'acceptation des documents legaux plateforme (spec 2026-07-17-conformite-legale).
-- Insert-only : une ligne = qui a accepte quoi, quelle version, quand, dans quel contexte.
CREATE TYPE "LegalDocument" AS ENUM ('CGU', 'CGV_SAAS', 'PRIVACY');
CREATE TABLE IF NOT EXISTS "legal_acceptances" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "club_id" TEXT,
  "document" "LegalDocument" NOT NULL,
  "version" TEXT NOT NULL,
  "context" TEXT NOT NULL,
  "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "legal_acceptances_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "legal_acceptances_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "legal_acceptances_user_id_document_idx"
  ON "legal_acceptances"("user_id", "document");
```

`20260718090100_add_cgv_accepted_columns/migration.sql` :

```sql
-- Etend la trace CGV (pattern Reservation.cgv_accepted_at) aux 3 autres parcours d'achat en ligne.
ALTER TABLE "tournament_registrations" ADD COLUMN IF NOT EXISTS "cgv_accepted_at" TIMESTAMP(3);
ALTER TABLE "event_registrations" ADD COLUMN IF NOT EXISTS "cgv_accepted_at" TIMESTAMP(3);
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "cgv_accepted_at" TIMESTAMP(3);
```

`20260718090200_add_club_mediator/migration.sql` :

```sql
-- Mediation de la consommation (art. L612-1 code conso) : nom + site du mediateur du club,
-- injectes dans le modele CGV et saisis dans /admin/pages (Coordonnees legales).
ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "mediator_name" TEXT;
ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "mediator_url" TEXT;
```

- [ ] **Step 3 : appliquer en DEV + régénérer le client**

```bash
cd backend
npx prisma db execute --file prisma/migrations/20260718090000_add_legal_acceptances/migration.sql
npx prisma db execute --file prisma/migrations/20260718090100_add_cgv_accepted_columns/migration.sql
npx prisma db execute --file prisma/migrations/20260718090200_add_club_mediator/migration.sql
npx prisma generate
```

Attendu : 3 exécutions sans erreur, `Generated Prisma Client`.

- [ ] **Step 4 : vérifier la compilation** — `cd backend; node node_modules/typescript/bin/tsc --noEmit` → propre.

- [ ] **Step 5 : commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260718090000_add_legal_acceptances backend/prisma/migrations/20260718090100_add_cgv_accepted_columns backend/prisma/migrations/20260718090200_add_club_mediator
git commit -m "feat(db): acceptations legales, cgv multi-parcours, mediateur club"
```

---

### Task 2 : `LEGAL_VERSIONS` + `LegalService`

**Files:**
- Create: `backend/src/content/legalVersions.ts`
- Create: `backend/src/services/legal.service.ts`
- Create: `backend/src/services/__tests__/legal.service.test.ts`

- [ ] **Step 1 : test en échec** — `backend/src/services/__tests__/legal.service.test.ts` :

```ts
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { LegalService } from '../legal.service';
import { LEGAL_VERSIONS } from '../../content/legalVersions';

describe('LegalService', () => {
  const svc = new LegalService();
  beforeEach(() => jest.clearAllMocks());

  it('record écrit la version courante du document (insert-only)', async () => {
    prismaMock.legalAcceptance.create.mockResolvedValue({ id: 'la1' });
    await svc.record({ userId: 'u1', document: 'CGU', context: 'register' });
    expect(prismaMock.legalAcceptance.create).toHaveBeenCalledWith({
      data: { userId: 'u1', clubId: null, document: 'CGU', version: LEGAL_VERSIONS.CGU, context: 'register' },
    });
  });

  it('statusFor renvoie la dernière version acceptée par document + la courante', async () => {
    prismaMock.legalAcceptance.findMany.mockResolvedValue([
      { document: 'CGU', version: '2026-07-18' },
      { document: 'CGU', version: '2026-01-01' },
    ]);
    prismaMock.clubMember.findFirst.mockResolvedValue(null);
    const s = await svc.statusFor('u1');
    expect(s.cgu).toEqual({ accepted: '2026-07-18', current: LEGAL_VERSIONS.CGU });
    expect(s.privacy.accepted).toBeNull();
    expect(s).not.toHaveProperty('cgvSaas');
  });

  it('statusFor expose cgvSaas seulement pour un OWNER de club', async () => {
    prismaMock.legalAcceptance.findMany.mockResolvedValue([]);
    prismaMock.clubMember.findFirst.mockResolvedValue({ id: 'cm1' });
    const s = await svc.statusFor('u1');
    expect(s.cgvSaas).toEqual({ accepted: null, current: LEGAL_VERSIONS.CGV_SAAS });
  });
});
```

- [ ] **Step 2 : vérifier l'échec** — `cd backend; node node_modules/jest/bin/jest.js src/services/__tests__/legal.service.test.ts` → FAIL (module introuvable).

- [ ] **Step 3 : implémenter**

`backend/src/content/legalVersions.ts` :

```ts
import { LegalDocument } from '@prisma/client';

/**
 * Versions courantes des documents légaux plateforme. Convention : date ISO de mise en
 * vigueur. Toute modification SUBSTANTIELLE d'un document dans frontend/lib/platformContent.ts
 * doit bumper la version ici (déclenche le bandeau « Nos conditions ont évolué »)
 * ET la ligne « Version du … » en tête du document.
 */
export const LEGAL_VERSIONS: Record<LegalDocument, string> = {
  CGU: '2026-07-18',
  CGV_SAAS: '2026-07-18',
  PRIVACY: '2026-07-18',
};
```

`backend/src/services/legal.service.ts` :

```ts
import { LegalDocument, Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { LEGAL_VERSIONS } from '../content/legalVersions';

type Db = Prisma.TransactionClient | typeof prisma;

export interface LegalDocStatus { accepted: string | null; current: string }

export class LegalService {
  /** Enregistre une acceptation (insert-only — jamais d'update ni de delete). */
  async record(
    input: { userId: string; document: LegalDocument; context: string; clubId?: string | null },
    db: Db = prisma,
  ) {
    return db.legalAcceptance.create({
      data: {
        userId: input.userId,
        clubId: input.clubId ?? null,
        document: input.document,
        version: LEGAL_VERSIONS[input.document],
        context: input.context,
      },
    });
  }

  /** Dernière version acceptée par document + version courante. cgvSaas : OWNER seulement. */
  async statusFor(userId: string) {
    const [rows, ownsClub] = await Promise.all([
      prisma.legalAcceptance.findMany({
        where: { userId },
        orderBy: { acceptedAt: 'desc' },
        select: { document: true, version: true },
      }),
      prisma.clubMember.findFirst({ where: { userId, role: 'OWNER' }, select: { id: true } }),
    ]);
    const latest = (doc: LegalDocument): string | null =>
      rows.find((r) => r.document === doc)?.version ?? null;
    return {
      cgu: { accepted: latest('CGU'), current: LEGAL_VERSIONS.CGU } as LegalDocStatus,
      privacy: { accepted: latest('PRIVACY'), current: LEGAL_VERSIONS.PRIVACY } as LegalDocStatus,
      ...(ownsClub ? { cgvSaas: { accepted: latest('CGV_SAAS'), current: LEGAL_VERSIONS.CGV_SAAS } as LegalDocStatus } : {}),
    };
  }
}

export const legalService = new LegalService();
```

- [ ] **Step 4 : test vert** — même commande qu'au step 2 → PASS (3 tests).

- [ ] **Step 5 : commit**

```bash
git add backend/src/content/legalVersions.ts backend/src/services/legal.service.ts backend/src/services/__tests__/legal.service.test.ts
git commit -m "feat(legal): versions des documents + service d'acceptation insert-only"
```

---

### Task 3 : acceptation CGU à l'inscription (backend)

**Files:**
- Modify: `backend/src/routes/auth.ts` (handler `POST /register`, l.86-129)
- Test: `backend/src/routes/__tests__/auth.routes.test.ts` (étendre le fichier existant ; s'il n'existe pas, chercher `Glob backend/src/routes/__tests__/auth*.test.ts` — un test de rate-limit auth existe depuis l'audit pré-MEP — et ajouter le `describe` ci-dessous dedans)

- [ ] **Step 1 : test en échec** — ajouter au fichier de test des routes auth :

```ts
describe('POST /register — acceptation CGU', () => {
  it('refuse sans acceptTerms (400 CGU_NOT_ACCEPTED)', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: 'new@test.fr', password: 'motdepasse', firstName: 'A', lastName: 'B',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CGU_NOT_ACCEPTED');
  });

  it('écrit les acceptations CGU + PRIVACY à la création du compte', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({ id: 'u-new', email: 'new@test.fr' });
    prismaMock.legalAcceptance.createMany.mockResolvedValue({ count: 2 });
    prismaMock.emailVerification.upsert.mockResolvedValue({});
    const res = await request(app).post('/api/auth/register').send({
      email: 'new@test.fr', password: 'motdepasse', firstName: 'A', lastName: 'B', acceptTerms: true,
    });
    expect(res.status).toBe(201);
    expect(prismaMock.legalAcceptance.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ userId: 'u-new', document: 'CGU', context: 'register' }),
        expect.objectContaining({ userId: 'u-new', document: 'PRIVACY', context: 'register' }),
      ],
    });
  });
});
```

(Adapter les mocks d'entête au pattern du fichier hôte : `import '../../__mocks__/prisma'` + `prismaMock`, `supertest` sur `app`. Si le fichier hôte mocke `sendVerificationEmail`, le conserver.)

- [ ] **Step 2 : vérifier l'échec** — `cd backend; node node_modules/jest/bin/jest.js src/routes/__tests__/auth` → FAIL (200/201 au lieu de 400, createMany non appelé).

- [ ] **Step 3 : implémenter** — dans `backend/src/routes/auth.ts` :

Imports en tête : `import { LEGAL_VERSIONS } from '../content/legalVersions';`

Dans le handler `POST /register` :
1. Déstructurer `acceptTerms` : `const { email, password, firstName, lastName, phone, preferredSportId, acceptTerms } = req.body;`
2. Juste après la garde « mot de passe trop court », ajouter :

```ts
    // Preuve d'acceptation obligatoire (spec conformité légale) — la case du formulaire.
    if (acceptTerms !== true) {
      res.status(400).json({ error: 'CGU_NOT_ACCEPTED' });
      return;
    }
```

3. Juste après la création/mise à jour du `user` (avant `issueCode`) :

```ts
    // Trace d'acceptation insert-only (CGU + politique de confidentialité). Une reprise
    // d'inscription (compte non vérifié) ré-écrit des lignes : historique, pas doublon.
    await prisma.legalAcceptance.createMany({
      data: (['CGU', 'PRIVACY'] as const).map((document) => ({
        userId: user.id, document, version: LEGAL_VERSIONS[document], context: 'register',
      })),
    });
```

- [ ] **Step 4 : tests verts** — `node node_modules/jest/bin/jest.js src/routes/__tests__/auth` → PASS (nouveaux + existants — les tests existants de register doivent être mis à jour pour envoyer `acceptTerms: true`).

- [ ] **Step 5 : commit**

```bash
git add backend/src/routes/auth.ts backend/src/routes/__tests__/
git commit -m "feat(auth): acceptation CGU+confidentialite obligatoire et tracee a l'inscription"
```

---

### Task 4 : acceptation CGV SaaS à la création de club (backend)

**Files:**
- Modify: `backend/src/services/club.service.ts` (`createClub`, l.131-195 + interface `CreateClubParams` l.117-126)
- Modify: `backend/src/routes/clubs.ts` (handler `POST /`, l.139-145 + table `ERROR_STATUS`)
- Test: `backend/src/services/__tests__/club.service.test.ts`

⚠️ Vérifier d'abord que `PlatformService` (création superadmin) n'appelle PAS `clubService.createClub` : `Grep "createClub" backend/src/services/platform.service.ts`. Attendu : il a sa propre transaction (le SIRET requis de `createClub` l'aurait déjà cassé sinon). Si contre toute attente il l'appelle, lui faire passer `acceptSaasTerms: true` avec `context: 'superadmin'` — mais ne pas s'y attendre.

- [ ] **Step 1 : test en échec** — dans `club.service.test.ts`, bloc `createClub` existant, ajouter :

```ts
it('refuse la création sans acceptation des CGV SaaS', async () => {
  await expect(service.createClub({
    ownerId: 'u1', name: 'Club Test', siret: SIRET_VALIDE, ownerPhone: '0600000000',
  })).rejects.toThrow('CGV_NOT_ACCEPTED');
});

it('trace l\'acceptation CGV_SAAS dans la transaction de création', async () => {
  // Réutiliser le setup de mock de transaction du test de création existant (tx.club.create etc.)
  // et ajouter tx.legalAcceptance.create au mock de transaction.
  await service.createClub({
    ownerId: 'u1', name: 'Club Test', siret: SIRET_VALIDE, ownerPhone: '0600000000', acceptSaasTerms: true,
  });
  expect(txMock.legalAcceptance.create).toHaveBeenCalledWith({
    data: expect.objectContaining({ userId: 'u1', clubId: expect.any(String), document: 'CGV_SAAS', context: 'club_create' }),
  });
});
```

(`SIRET_VALIDE` et `txMock` : reprendre les constantes/helpers du bloc createClub existant du fichier — il mocke déjà `serializableTx` et `checkSiret`.)

- [ ] **Step 2 : vérifier l'échec** — `node node_modules/jest/bin/jest.js src/services/__tests__/club.service.test.ts -t "CGV"` → FAIL.

- [ ] **Step 3 : implémenter** — dans `club.service.ts` :

1. `CreateClubParams` gagne `acceptSaasTerms?: boolean;`
2. Import : `import { LEGAL_VERSIONS } from '../content/legalVersions';`
3. En tête de `createClub`, après la garde `ownerPhone` :

```ts
    // Contrat SaaS : la case « J'accepte les CGV Palova (incluant l'annexe de
    // sous-traitance des données) » est obligatoire en self-service.
    if (params.acceptSaasTerms !== true) throw new Error('CGV_NOT_ACCEPTED');
```

4. Dans la transaction, après `tx.clubMember.create(...)` :

```ts
        await tx.legalAcceptance.create({
          data: {
            userId: params.ownerId, clubId: created.id, document: 'CGV_SAAS',
            version: LEGAL_VERSIONS.CGV_SAAS, context: 'club_create',
          },
        });
```

Dans `clubs.ts` : handler `POST /` — déstructurer `acceptSaasTerms` du body et le passer à `createClub` ; ajouter `CGV_NOT_ACCEPTED: 400` à `ERROR_STATUS`.

- [ ] **Step 4 : tests verts** — suite `club.service.test.ts` complète (les tests createClub existants doivent passer `acceptSaasTerms: true`).

- [ ] **Step 5 : commit**

```bash
git add backend/src/services/club.service.ts backend/src/routes/clubs.ts backend/src/services/__tests__/club.service.test.ts
git commit -m "feat(club): acceptation CGV SaaS obligatoire et tracee a la creation de club"
```

---

### Task 5 : statut légal du profil + acceptation depuis le bandeau (backend)

**Files:**
- Modify: `backend/src/routes/me.ts` (handler `GET /profile` l.105-111 + nouvelle route `POST /legal/accept`)
- Test: `backend/src/routes/__tests__/me.routes.test.ts`

- [ ] **Step 1 : tests en échec** — ajouter à `me.routes.test.ts` (le fichier a déjà `PROFILE`, `token()`, `prismaMock`) :

```ts
describe('statut légal', () => {
  it('GET /profile expose legal { accepted, current } par document', async () => {
    prismaMock.user.findUnique.mockResolvedValue(PROFILE);
    prismaMock.legalAcceptance.findMany.mockResolvedValue([{ document: 'CGU', version: '2026-07-18' }]);
    prismaMock.clubMember.findFirst.mockResolvedValue(null);
    const res = await request(app).get('/api/me/profile').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body.legal.cgu.accepted).toBe('2026-07-18');
    expect(res.body.legal.privacy.accepted).toBeNull();
    expect(res.body.legal.cgvSaas).toBeUndefined();
  });

  it('POST /legal/accept écrit la version courante avec context update_banner', async () => {
    prismaMock.legalAcceptance.create.mockResolvedValue({ id: 'la1' });
    const res = await request(app).post('/api/me/legal/accept')
      .set('Authorization', `Bearer ${token()}`).send({ document: 'CGU' });
    expect(res.status).toBe(200);
    expect(prismaMock.legalAcceptance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'u1', document: 'CGU', context: 'update_banner' }),
    });
  });

  it('POST /legal/accept refuse un document inconnu', async () => {
    const res = await request(app).post('/api/me/legal/accept')
      .set('Authorization', `Bearer ${token()}`).send({ document: 'NIMPORTE' });
    expect(res.status).toBe(400);
  });
});
```

⚠️ Si `me.routes.test.ts` a des tests `GET /profile` existants, leur ajouter les mocks `legalAcceptance.findMany` / `clubMember.findFirst` (sinon `undefined.find` casse).

- [ ] **Step 2 : vérifier l'échec** — `node node_modules/jest/bin/jest.js src/routes/__tests__/me.routes.test.ts -t "légal"` → FAIL.

- [ ] **Step 3 : implémenter** — dans `me.ts` :

Import : `import { legalService } from '../services/legal.service';`

`GET /profile` devient :

```ts
router.get('/profile', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: PROFILE_SELECT });
    if (!user) return void res.json(user);
    const legal = await legalService.statusFor(req.user!.id);
    res.json({ ...user, legal });
  } catch (err) { next(err); }
});
```

Nouvelle route (à placer près des autres routes simples, AVANT tout `router.get('/:param')` s'il en existe) :

```ts
// Acceptation d'une nouvelle version d'un document légal depuis le bandeau « conditions ont évolué ».
router.post('/legal/accept', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const document = String(req.body?.document ?? '');
    if (!['CGU', 'PRIVACY', 'CGV_SAAS'].includes(document)) {
      return void res.status(400).json({ error: 'VALIDATION_ERROR' });
    }
    await legalService.record({ userId: req.user!.id, document: document as 'CGU' | 'PRIVACY' | 'CGV_SAAS', context: 'update_banner' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});
```

- [ ] **Step 4 : tests verts** — suite `me.routes.test.ts` complète.

- [ ] **Step 5 : commit**

```bash
git add backend/src/routes/me.ts backend/src/routes/__tests__/me.routes.test.ts
git commit -m "feat(me): statut legal dans le profil + acceptation depuis le bandeau"
```

---

### Task 6 : médiateur + modèles club enrichis (backend)

**Files:**
- Modify: `backend/src/content/clubPageTemplates.ts`
- Modify: `backend/src/services/club.service.ts` (écriture/lecture des champs légaux)
- Modify: `backend/src/services/clubPage.service.ts` (`renderTemplate`, select élargi)
- Test: `backend/src/content/__tests__/clubPageTemplates.test.ts`, `backend/src/services/__tests__/club.service.test.ts`

- [ ] **Step 1 : tests en échec** — dans `clubPageTemplates.test.ts` :

```ts
const CLUB_MEDIATEUR = { ...CLUB_COMPLET, mediatorName: 'CM2C', mediatorUrl: 'https://cm2c.net' };

it('CGV : nomme le médiateur de la consommation quand renseigné', () => {
  const md = renderClubPageTemplate('CGV', CLUB_MEDIATEUR);
  expect(md).toContain('CM2C');
  expect(md).toContain('https://cm2c.net');
});

it('CGV : médiateur absent → [à compléter]', () => {
  const md = renderClubPageTemplate('CGV', { ...CLUB_COMPLET, mediatorName: null, mediatorUrl: null });
  expect(md).toContain('médiateur');
  expect(md).toContain('[à compléter]');
});

it('CGV : renvoie aux CGU Palova et couvre les achats au comptoir', () => {
  const md = renderClubPageTemplate('CGV', CLUB_COMPLET);
  expect(md).toContain('conditions générales d\'utilisation de la plateforme Palova');
  expect(md).toContain('y compris effectuée à l\'accueil du club');
});
```

(`CLUB_COMPLET` = la fixture existante du fichier, à laquelle on ajoute `mediatorName: null, mediatorUrl: null` pour satisfaire le type.)

Dans `club.service.test.ts` (bloc updateClub/getClubForAdmin existant) : vérifier que `updateClub` accepte et persiste `mediatorName`/`mediatorUrl` et que `getClubForAdmin` les expose (calquer les assertions sur celles de `legalEntityName`).

- [ ] **Step 2 : vérifier l'échec** — `node node_modules/jest/bin/jest.js src/content/__tests__/clubPageTemplates.test.ts` → FAIL (type + contenu).

- [ ] **Step 3 : implémenter**

`clubPageTemplates.ts` :
1. `TemplateClubContext` gagne `mediatorName: string | null; mediatorUrl: string | null;`
2. Dans `renderCgv`, remplacer la section « ## 7. Litiges » par :

```ts
  const mediator = club.mediatorName?.trim()
    ? `**${club.mediatorName.trim()}**${club.mediatorUrl?.trim() ? ` — ${club.mediatorUrl.trim()}` : ''}`
    : TODO;
```

et le markdown :

```markdown
## 7. Médiation de la consommation et litiges
Les présentes CGV sont soumises au droit français. En cas de litige, une solution amiable sera
recherchée avant toute action. Conformément aux articles L611-1 et suivants du Code de la
consommation, le consommateur peut saisir gratuitement le médiateur de la consommation dont
relève le club : ${mediator}.

## 8. Plateforme
Le site du club est fourni par la plateforme Palova : l'utilisation du site (compte joueur,
messagerie, réservation en ligne) est également régie par les
[conditions générales d'utilisation de la plateforme Palova](https://palova.fr/cgu).
```

3. Dans `renderCgv`, compléter la section « ## 4. Annulation et remboursement » d'une phrase : `Les conditions d'annulation applicables sont celles affichées au moment de la réservation.` et ajouter à « ## 1. Objet » : `Toute réservation ou tout achat, y compris effectuée à l'accueil du club, implique l'adhésion aux présentes CGV.`
4. Dans `renderConfidentialite`, ajouter à la fin de la section « Sous-traitants » : `L'utilisation de la plateforme elle-même (compte joueur) est décrite dans la [politique de confidentialité de Palova](https://palova.fr/confidentialite).`

`club.service.ts` : ajouter `mediatorName`/`mediatorUrl` partout où `legalEntityName` est géré — `Grep "legalEntityName" backend/src/services/club.service.ts` (helper `legal()` d'updateClub + select de `getClubForAdmin`). Même normalisation trim-ou-null que les autres champs légaux.

`clubPage.service.ts` : dans `renderTemplate`, ajouter `mediatorName: true, mediatorUrl: true` au select.

- [ ] **Step 4 : tests verts** — `clubPageTemplates.test.ts` + `club.service.test.ts` complets. Puis `node node_modules/typescript/bin/tsc --noEmit` (le type `TemplateClubContext` élargi impose la mise à jour de tous les appels — le compilateur les liste).

- [ ] **Step 5 : commit**

```bash
git add backend/src/content/clubPageTemplates.ts backend/src/content/__tests__/clubPageTemplates.test.ts backend/src/services/club.service.ts backend/src/services/clubPage.service.ts backend/src/services/__tests__/club.service.test.ts
git commit -m "feat(club): mediateur de la consommation + modeles CGV/confidentialite enrichis"
```

---

### Task 7 : repli légal permanent des pages publiques club (backend)

**Files:**
- Modify: `backend/src/services/clubPage.service.ts` (`getPublicPage`, l.20-29)
- Test: `backend/src/services/__tests__/clubPage.service.test.ts`

- [ ] **Step 1 : tests en échec** :

```ts
describe('getPublicPage — repli légal', () => {
  it('page non publiée + kind légal → modèle rendu avec isFallback', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'c1', status: 'ACTIVE', name: 'Padel Arena',
      legalEntityName: 'Arena SAS', legalForm: 'SAS', siret: '123', vatNumber: null,
      legalRepresentative: null, legalEmail: null, legalPhone: null, address: '12 rue', city: 'Paris',
      mediatorName: null, mediatorUrl: null });
    prismaMock.clubPage.findFirst.mockResolvedValue(null);
    const p = await service.getPublicPage('padel-arena', 'CGV');
    expect(p.isFallback).toBe(true);
    expect(p.updatedAt).toBeNull();
    expect(p.bodyMarkdown).toContain('Arena SAS');
  });

  it('page publiée → contenu du club, isFallback false', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'c1', status: 'ACTIVE', name: 'X',
      legalEntityName: null, legalForm: null, siret: null, vatNumber: null, legalRepresentative: null,
      legalEmail: null, legalPhone: null, address: '', city: null, mediatorName: null, mediatorUrl: null });
    prismaMock.clubPage.findFirst.mockResolvedValue({ kind: 'CGV', bodyMarkdown: '# Mes CGV', updatedAt: new Date() });
    const p = await service.getPublicPage('x', 'CGV');
    expect(p.isFallback).toBe(false);
    expect(p.bodyMarkdown).toBe('# Mes CGV');
  });

  it('OFFRES non publiée → PAGE_NOT_FOUND (pas de repli commercial)', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'c1', status: 'ACTIVE', name: 'X',
      legalEntityName: null, legalForm: null, siret: null, vatNumber: null, legalRepresentative: null,
      legalEmail: null, legalPhone: null, address: '', city: null, mediatorName: null, mediatorUrl: null });
    prismaMock.clubPage.findFirst.mockResolvedValue(null);
    await expect(service.getPublicPage('x', 'OFFRES')).rejects.toThrow('PAGE_NOT_FOUND');
  });
});
```

- [ ] **Step 2 : vérifier l'échec** — `node node_modules/jest/bin/jest.js src/services/__tests__/clubPage.service.test.ts` → FAIL.

- [ ] **Step 3 : implémenter** — remplacer `getPublicPage` :

```ts
  private static readonly LEGAL_KINDS: ClubPageKind[] = ['CGV', 'MENTIONS_LEGALES', 'CONFIDENTIALITE'];

  /** Contenu publié d'une page ; pages LÉGALES : repli permanent sur le modèle Palova
   *  rendu avec les coordonnées du club (un site club a TOUJOURS des pages opposables).
   *  OFFRES (commercial) garde son 404. */
  async getPublicPage(slug: string, kind: ClubPageKind) {
    const club = await this.activeClubBySlug(slug, {
      id: true, status: true, name: true, legalEntityName: true, legalForm: true, siret: true,
      vatNumber: true, legalRepresentative: true, legalEmail: true, legalPhone: true,
      address: true, city: true, mediatorName: true, mediatorUrl: true,
    });
    const page = await prisma.clubPage.findFirst({
      where: { clubId: club.id, kind, published: true },
      select: { kind: true, bodyMarkdown: true, updatedAt: true },
    });
    if (page) return { kind: page.kind, bodyMarkdown: page.bodyMarkdown, updatedAt: page.updatedAt, isFallback: false };
    if (!ClubPageService.LEGAL_KINDS.includes(kind)) throw new Error('PAGE_NOT_FOUND');
    const body = renderClubPageTemplate(kind, club as unknown as Parameters<typeof renderClubPageTemplate>[1]);
    return { kind, bodyMarkdown: body, updatedAt: null, isFallback: true };
  }
```

(Si la classe ne s'appelle pas `ClubPageService`, adapter le nom du statique.)

- [ ] **Step 4 : tests verts** — suite `clubPage.service.test.ts` complète (les tests existants de `getPublicPage` qui attendaient `PAGE_NOT_FOUND` sur un kind légal non publié doivent être mis à jour → repli).

- [ ] **Step 5 : commit**

```bash
git add backend/src/services/clubPage.service.ts backend/src/services/__tests__/clubPage.service.test.ts
git commit -m "feat(pages): repli legal permanent des pages CGV/mentions/confidentialite d'un club"
```

---

### Task 8 : gate CGV sur les intents d'inscription tournoi/event (backend)

**Files:**
- Modify: `backend/src/routes/tournaments.ts` (handler intent l.90-116 + `ERROR_STATUS`)
- Modify: `backend/src/routes/events.ts` (handler intent l.62-88 + `ERROR_STATUS`)
- Test: fichiers de tests de routes existants (Glob `backend/src/routes/__tests__/*tournament*`, `*event*` — étendre celui qui couvre déjà `/intent`)

- [ ] **Step 1 : tests en échec** — dans chacun des deux fichiers de tests de routes (pattern identique, montré pour tournoi) :

```ts
it('intent refuse sans cgvAccepted (400 CGV_NOT_ACCEPTED)', async () => {
  const res = await request(app).post('/api/tournaments/t1/registrations/r1/intent')
    .set('Authorization', `Bearer ${token()}`).send({});
  expect(res.status).toBe(400);
  expect(res.body.error).toBe('CGV_NOT_ACCEPTED');
});

it('intent horodate cgvAcceptedAt une seule fois (updateMany conditionnel)', async () => {
  prismaMock.tournamentRegistration.findUnique.mockResolvedValue(REG_DUE); // fixture existante du fichier
  prismaMock.tournamentRegistration.updateMany.mockResolvedValue({ count: 1 });
  await request(app).post('/api/tournaments/t1/registrations/r1/intent')
    .set('Authorization', `Bearer ${token()}`).send({ cgvAccepted: true });
  expect(prismaMock.tournamentRegistration.updateMany).toHaveBeenCalledWith({
    where: { id: 'r1', cgvAcceptedAt: null },
    data: { cgvAcceptedAt: expect.any(Date) },
  });
});
```

- [ ] **Step 2 : vérifier l'échec** — jest sur les deux fichiers → FAIL.

- [ ] **Step 3 : implémenter** — dans les DEUX handlers intent, juste après la garde `NOT_PAYABLE` :

```ts
    // L'acceptation des CGV du club précède tout paiement CB (pattern confirmReservation).
    if (req.body?.cgvAccepted !== true) return void res.status(400).json({ error: 'CGV_NOT_ACCEPTED' });
    await prisma.tournamentRegistration.updateMany({
      where: { id: regId, cgvAcceptedAt: null },
      data: { cgvAcceptedAt: new Date() },
    });
```

(events.ts : `prisma.eventRegistration.updateMany`.) Ajouter `CGV_NOT_ACCEPTED: 400` aux `ERROR_STATUS` des deux routeurs (cohérence, même si la garde répond inline).

- [ ] **Step 4 : tests verts** — les tests existants d'intent doivent envoyer `{ cgvAccepted: true }` (les mettre à jour).

- [ ] **Step 5 : commit**

```bash
git add backend/src/routes/tournaments.ts backend/src/routes/events.ts backend/src/routes/__tests__/
git commit -m "feat(inscriptions): acceptation CGV club obligatoire et tracee avant paiement en ligne"
```

---

### Task 9 : gate CGV sur les achats d'offres (backend)

**Files:**
- Modify: `backend/src/routes/clubs.ts` (2 handlers intents offres, l.228-256)
- Modify: `backend/src/services/stripe.service.ts` (`createOfferPaymentIntent`, l.259-282)
- Modify: `backend/src/services/offer.service.ts` (`OfferIntentMeta` + `fulfillPaidIntent` l.42-96)
- Modify: le webhook qui parse la metadata d'offre (`Grep "offerPlanId" backend/src/services backend/src/routes` → `stripe-webhooks.ts` et/ou `offer.service.ts` : partout où `OfferIntentMeta` est construit depuis `pi.metadata`, relayer le nouveau champ)
- Test: `backend/src/services/__tests__/offer.service.test.ts` + fichier de routes offres existant

- [ ] **Step 1 : tests en échec** —

Routes (fichier de test des routes offres existant) :

```ts
it('intent plan refuse sans cgvAccepted', async () => {
  const res = await request(app).post('/api/clubs/padel-arena-paris/offers/plans/p1/intent')
    .set('Authorization', `Bearer ${token()}`).send({});
  expect(res.status).toBe(400);
  expect(res.body.error).toBe('CGV_NOT_ACCEPTED');
});
```

Service (`offer.service.test.ts`) :

```ts
it('fulfillPaidIntent pose cgvAcceptedAt sur le Payment quand la metadata le porte', async () => {
  // Réutiliser le setup du test « crée MemberPackage + Payment » existant,
  // avec meta = { ...META_PACKAGE, offerCgvAcceptedAt: '2026-07-18T10:00:00.000Z' }.
  await service.fulfillPaidIntent(meta, 'pi_1', 4000);
  expect(txMock.payment.create).toHaveBeenCalledWith({
    data: expect.objectContaining({ cgvAcceptedAt: new Date('2026-07-18T10:00:00.000Z') }),
  });
});
```

- [ ] **Step 2 : vérifier l'échec** — jest sur les deux fichiers → FAIL.

- [ ] **Step 3 : implémenter**

Routes `clubs.ts` (les 2 handlers intents offres) — après la garde `AMOUNT_TOO_SMALL` :

```ts
    if (req.body?.cgvAccepted !== true) return void res.status(400).json({ error: 'CGV_NOT_ACCEPTED' });
```

et passer l'horodatage à l'intent : `createOfferPaymentIntent({ ..., cgvAcceptedAtIso: new Date().toISOString() })`.

`stripe.service.ts` — `createOfferPaymentIntent` : param optionnel `cgvAcceptedAtIso?: string`, ajouté à la metadata du PaymentIntent : `...(params.cgvAcceptedAtIso ? { offerCgvAcceptedAt: params.cgvAcceptedAtIso } : {})`.

`offer.service.ts` — `OfferIntentMeta` gagne `offerCgvAcceptedAt?: string`. Chaque endroit qui construit la meta depuis `pi.metadata` (confirmFromClient + webhook) relaie le champ. Dans `fulfillPaidIntent`, les DEUX `tx.payment.create` ajoutent :

```ts
            ...(meta.offerCgvAcceptedAt ? { cgvAcceptedAt: new Date(meta.offerCgvAcceptedAt) } : {}),
```

- [ ] **Step 4 : tests verts** — suites offer.service + routes offres (tests d'intent existants → `{ cgvAccepted: true }`).

- [ ] **Step 5 : commit**

```bash
git add backend/src/routes/clubs.ts backend/src/services/stripe.service.ts backend/src/services/offer.service.ts backend/src/services/__tests__/offer.service.test.ts backend/src/routes/__tests__/
git commit -m "feat(offres): acceptation CGV club tracee sur l'achat en ligne (metadata Stripe)"
```

---

### Task 10 : désinscription des broadcasts en un clic (backend)

**Files:**
- Create: `backend/src/services/unsubscribeToken.ts`
- Create: `backend/src/routes/unsubscribe.ts`
- Modify: `backend/src/app.ts` (montage — `Grep "app.use('/api"` pour l'emplacement)
- Modify: `backend/src/email/templates/layout.ts` (`Brand` + footer, l.6-16 et l.134-169)
- Modify: `backend/src/email/links.ts` (helper URL API publique)
- Modify: `backend/src/services/broadcast.service.ts` (`send`, l.18-69)
- Test: `backend/src/services/__tests__/unsubscribeToken.test.ts` + `backend/src/routes/__tests__/unsubscribe.routes.test.ts` + suite broadcast existante

Avant de coder : `Grep "API_PUBLIC_URL\|API_URL" backend/.env.example backend/.env .env.prod.example` — réutiliser la variable existante qui porte l'URL publique de l'API si elle existe, sinon introduire `API_PUBLIC_URL` (fallback `http://localhost:3001`) et l'ajouter à `.env.prod.example` avec un commentaire.

- [ ] **Step 1 : tests en échec**

`unsubscribeToken.test.ts` :

```ts
import { unsubscribeToken, verifyUnsubscribeToken } from '../unsubscribeToken';

describe('unsubscribeToken', () => {
  it('aller-retour : le token signé rend le userId', () => {
    const t = unsubscribeToken('user-123');
    expect(verifyUnsubscribeToken(t)).toBe('user-123');
  });
  it('signature altérée → null', () => {
    const t = unsubscribeToken('user-123');
    expect(verifyUnsubscribeToken(t.slice(0, -2) + 'aa')).toBeNull();
    expect(verifyUnsubscribeToken('nimporte')).toBeNull();
    expect(verifyUnsubscribeToken('')).toBeNull();
  });
});
```

`unsubscribe.routes.test.ts` (pattern mock-auth inutile : route publique) :

```ts
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import app from '../../app';
import { unsubscribeToken } from '../../services/unsubscribeToken';

describe('GET /api/unsubscribe', () => {
  beforeEach(() => jest.clearAllMocks());

  it('token valide → opt-out CLUB_MESSAGES/EMAIL + page de confirmation', async () => {
    prismaMock.notificationPreference.upsert.mockResolvedValue({});
    const res = await request(app).get(`/api/unsubscribe?token=${unsubscribeToken('u1')}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('désinscrit');
    expect(prismaMock.notificationPreference.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId_category_channel: { userId: 'u1', category: 'CLUB_MESSAGES', channel: 'EMAIL' } },
      create: expect.objectContaining({ enabled: false }),
      update: { enabled: false },
    }));
  });

  it('action=resubscribe → enabled true', async () => {
    prismaMock.notificationPreference.upsert.mockResolvedValue({});
    const res = await request(app).get(`/api/unsubscribe?token=${unsubscribeToken('u1')}&action=resubscribe`);
    expect(res.status).toBe(200);
    expect(prismaMock.notificationPreference.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { enabled: true } }));
  });

  it('token invalide → 400 sans écriture', async () => {
    const res = await request(app).get('/api/unsubscribe?token=xxx');
    expect(res.status).toBe(400);
    expect(prismaMock.notificationPreference.upsert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2 : vérifier l'échec** — jest sur les 2 fichiers → FAIL.

- [ ] **Step 3 : implémenter**

`backend/src/services/unsubscribeToken.ts` :

```ts
import crypto from 'crypto';

// Secret dédié si présent, sinon repli JWT_SECRET (dev). Un lien de désinscription
// n'expire JAMAIS (il doit toujours marcher) — la révocation n'a pas de sens ici :
// le pire usage abusif est de (dés)inscrire la personne de ses emails d'annonces.
const secret = () => process.env.UNSUBSCRIBE_SECRET || process.env.JWT_SECRET || '';

export function unsubscribeToken(userId: string): string {
  const payload = Buffer.from(userId, 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

/** userId si la signature est valide, null sinon (comparaison en temps constant). */
export function verifyUnsubscribeToken(token: string): string | null {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { return Buffer.from(payload, 'base64url').toString('utf8'); } catch { return null; }
}
```

`backend/src/routes/unsubscribe.ts` :

```ts
import { Router, Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { verifyUnsubscribeToken } from '../services/unsubscribeToken';

const router = Router();

const page = (title: string, body: string, extra = '') =>
  `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>` +
  `<body style="font-family:system-ui,sans-serif;max-width:480px;margin:80px auto;padding:0 20px;color:#1d2433;">` +
  `<h1 style="font-size:20px;">${title}</h1><p style="line-height:1.6;color:#5d6675;">${body}</p>${extra}</body></html>`;

// Désinscription en un clic depuis un email de diffusion — publique, sans login, idempotente.
// L'opt-out est GLOBAL (catégorie CLUB_MESSAGES, canal EMAIL) : se désinscrire coupe les
// emails d'annonces de tous les clubs (choix v1, la préférence n'est pas par club).
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = verifyUnsubscribeToken(String(req.query.token ?? ''));
    if (!userId) return void res.status(400).send(page('Lien invalide', 'Ce lien de désinscription est invalide ou incomplet.'));
    const resub = req.query.action === 'resubscribe';
    try {
      await prisma.notificationPreference.upsert({
        where: { userId_category_channel: { userId, category: 'CLUB_MESSAGES', channel: 'EMAIL' } },
        create: { userId, category: 'CLUB_MESSAGES', channel: 'EMAIL', enabled: resub },
        update: { enabled: resub },
      });
    } catch (e) {
      // Compte supprimé (FK) → on affiche quand même la confirmation (pas d'énumération).
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003')) throw e;
    }
    if (resub) return void res.send(page('Réinscription confirmée', 'Vous recevrez de nouveau les emails d\'annonces des clubs.'));
    const resubUrl = `/api/unsubscribe?token=${encodeURIComponent(String(req.query.token))}&action=resubscribe`;
    res.send(page('Vous êtes désinscrit', 'Vous ne recevrez plus les emails d\'annonces des clubs. Les emails liés à vos réservations et paiements continuent d\'arriver.',
      `<p><a href="${resubUrl}" style="color:#3866b0;">Se réinscrire</a></p>`));
  } catch (err) { next(err); }
});

export default router;
```

`app.ts` : `import unsubscribeRouter from './routes/unsubscribe';` + `app.use('/api/unsubscribe', unsubscribeRouter);` (à côté des autres montages `/api/*`).

`email/links.ts` : ajouter

```ts
/** URL absolue de l'API publique (liens contenus dans les emails : désinscription…). */
export function apiPublicUrl(path: string): string {
  const base = process.env.API_PUBLIC_URL || 'http://localhost:3001';
  return base.replace(/\/$/, '') + path;
}
```

`layout.ts` : `Brand` gagne `unsubscribeUrl?: string | null;` ; à côté de `manageLink` :

```ts
  const unsubLink = brand.unsubscribeUrl
    ? `<a href="${escapeHtml(brand.unsubscribeUrl)}" style="color:${FAINT};text-decoration:underline;">Se désabonner</a> · `
    : '';
```

et dans le bloc footer : `${manageLink}${unsubLink}Envoyé avec Palova`.

`broadcast.service.ts` — dans `send`, remplacer la construction unique de l'email par une construction PAR destinataire (le lien est signé par userId) :

```ts
    const optOuts = await prisma.notificationPreference.count({
      where: { category: 'CLUB_MESSAGES', channel: 'EMAIL', enabled: false, userId: { in: members.map((m) => m.user.id) } },
    });

    for (const m of members) {
      const unsubscribeUrl = apiPublicUrl(`/api/unsubscribe?token=${unsubscribeToken(m.user.id)}`);
      const { subject, html, text } = buildBroadcastEmail({ title, body, url: targetUrl, brand: { ...brand, unsubscribeUrl } });
      await dispatch({ /* champs existants inchangés */ email: m.user.email ? { to: m.user.email, subject, html, text } : null });
    }
```

et enrichir le retour de `send` d'un champ additif `emailOptOuts: optOuts` (conserver les champs existants du retour tels quels). NB : l'exclusion effective des désinscrits est DÉJÀ assurée par `dispatch` → `resolveChannels` (aucun changement là).

- [ ] **Step 4 : tests verts** — les 2 nouveaux fichiers + la suite broadcast existante (adapter ses assertions si elles comparaient l'email construit une seule fois).

- [ ] **Step 5 : commit**

```bash
git add backend/src/services/unsubscribeToken.ts backend/src/routes/unsubscribe.ts backend/src/app.ts backend/src/email/templates/layout.ts backend/src/email/links.ts backend/src/services/broadcast.service.ts backend/src/services/__tests__/ backend/src/routes/__tests__/ .env.prod.example
git commit -m "feat(broadcast): lien de desinscription signe en un clic (HMAC, sans login)"
```

---

### Task 11 : export de données RGPD (backend)

**Files:**
- Create: `backend/src/services/dataExport.service.ts`
- Create: `backend/src/services/__tests__/dataExport.service.test.ts`
- Modify: `backend/src/routes/me.ts` (route `GET /export`)
- Test: `backend/src/routes/__tests__/me.routes.test.ts`

⚠️ Avant d'écrire les requêtes : ouvrir `backend/prisma/schema.prisma` et vérifier les noms EXACTS des champs auteur de `DirectMessage` et `OpenMatchMessage` (probablement `senderId`/`authorId`) et des modèles sociaux (`Follow`, `Friendship`, `MatchAlert`) — n'exporter QUE les messages dont l'utilisateur est l'auteur (jamais ceux des tiers).

- [ ] **Step 1 : test en échec** — `dataExport.service.test.ts` :

```ts
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { DataExportService } from '../dataExport.service';

describe('DataExportService', () => {
  it('agrège les données du seul demandeur', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', email: 'e@x.fr', firstName: 'E', lastName: 'N' });
    // Tous les findMany renvoient [] par défaut dans le mock partagé ; sinon les stubber à [].
    const out = await new DataExportService().buildExport('u1');
    expect(out.profile).toEqual(expect.objectContaining({ email: 'e@x.fr' }));
    expect(out).toHaveProperty('reservations');
    expect(out).toHaveProperty('legalAcceptances');
    expect(typeof out.generatedAt).toBe('string');
  });

  it('les requêtes messages ne ciblent que les messages ENVOYÉS par le demandeur', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1' });
    await new DataExportService().buildExport('u1');
    const dmCall = prismaMock.directMessage.findMany.mock.calls[0][0];
    expect(JSON.stringify(dmCall.where)).toContain('u1'); // where auteur = u1, jamais "conversation in"
  });
});
```

- [ ] **Step 2 : vérifier l'échec** — jest → FAIL.

- [ ] **Step 3 : implémenter** — `dataExport.service.ts` (adapter les noms de champs vérifiés au step 0 ; TOUTES les requêtes filtrent par l'id du demandeur) :

```ts
import { prisma } from '../db/prisma';

/** Export RGPD (portabilité, art. 20) : JSON des données du demandeur, et de lui seul.
 *  Jamais les messages/identités de tiers ; l'avatar est une URL (pas de fichiers). */
export class DataExportService {
  async buildExport(userId: string) {
    const [
      profile, memberships, reservations, participations, tournamentRegs, eventRegs,
      payments, packages, subscriptions, ratings, follows, friendships, alerts,
      dmSent, matchMessages, prefs, acceptances,
    ] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: {
        id: true, email: true, firstName: true, lastName: true, phone: true, sex: true,
        birthDate: true, avatarUrl: true, locale: true, createdAt: true,
        showInLeaderboard: true, autoMatchProposals: true, acceptsFriendRequests: true, acceptsDirectMessages: true,
      } }),
      prisma.clubMembership.findMany({ where: { userId }, select: { clubId: true, status: true, membershipNo: true, createdAt: true } }),
      prisma.reservation.findMany({ where: { userId }, select: { id: true, startTime: true, endTime: true, status: true, totalPrice: true, resource: { select: { name: true } } } }),
      prisma.reservationParticipant.findMany({ where: { userId }, select: { reservationId: true, joinedAt: true, team: true, slot: true } }),
      prisma.tournamentRegistration.findMany({ where: { OR: [{ captainUserId: userId }, { partnerUserId: userId }] }, select: { tournamentId: true, status: true, paymentStatus: true, createdAt: true } }),
      prisma.eventRegistration.findMany({ where: { userId }, select: { eventId: true, status: true, paymentStatus: true, createdAt: true } }),
      prisma.payment.findMany({
        where: { OR: [
          { reservation: { userId } }, { participant: { userId } }, { memberPackage: { userId } },
          { subscriptionSale: { userId } }, { eventRegistration: { userId } },
          { tournamentRegistration: { OR: [{ captainUserId: userId }, { partnerUserId: userId }] } },
        ] },
        select: { id: true, amount: true, method: true, status: true, createdAt: true, receiptNo: true },
      }),
      prisma.memberPackage.findMany({ where: { userId }, select: { clubId: true, kind: true, creditsRemaining: true, amountRemaining: true, expiresAt: true } }),
      prisma.subscription.findMany({ where: { userId }, select: { clubId: true, status: true, expiresAt: true, monthlyPriceSnapshot: true } }),
      prisma.playerRating.findMany({ where: { userId } }),
      prisma.follow.findMany({ where: { followerId: userId }, select: { followingId: true, createdAt: true } }),
      prisma.friendship.findMany({ where: { OR: [{ userAId: userId }, { userBId: userId }] }, select: { status: true, requestedById: true, respondedAt: true } }),
      prisma.matchAlert.findMany({ where: { userId }, select: { clubId: true, windowStart: true, windowEnd: true } }),
      prisma.directMessage.findMany({ where: { senderId: userId }, select: { conversationId: true, body: true, createdAt: true } }),
      prisma.openMatchMessage.findMany({ where: { authorId: userId }, select: { reservationId: true, body: true, createdAt: true } }),
      prisma.notificationPreference.findMany({ where: { userId }, select: { category: true, channel: true, enabled: true } }),
      prisma.legalAcceptance.findMany({ where: { userId }, select: { document: true, version: true, context: true, acceptedAt: true } }),
    ]);
    return {
      generatedAt: new Date().toISOString(),
      profile, memberships, reservations, participations,
      tournamentRegistrations: tournamentRegs, eventRegistrations: eventRegs,
      payments, packages, subscriptions, ratings,
      follows, friendships, matchAlerts: alerts,
      messagesSent: { direct: dmSent, openMatch: matchMessages },
      notificationPreferences: prefs, legalAcceptances: acceptances,
    };
  }
}
```

Route dans `me.ts` (import `assertRateLimit` + `DataExportService`) :

```ts
// Export RGPD (portabilité) — JSON synchrone, 1 export / heure.
router.get('/export', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await assertRateLimit('data-export', req.user!.id, 1, 3600);
    const data = await new DataExportService().buildExport(req.user!.id);
    res.setHeader('Content-Disposition', 'attachment; filename="palova-mes-donnees.json"');
    res.json(data);
  } catch (err) {
    if ((err as Error).message === 'RATE_LIMITED') return void res.status(429).json({ error: 'RATE_LIMITED' });
    next(err);
  }
});
```

Test route (dans `me.routes.test.ts`) : mocker `DataExportService` comme `AccountService` l'est déjà (jest.mock au top), vérifier 200 + header `Content-Disposition` + 429 quand `assertRateLimit` rejette (mocker `../../services/rateLimit`).

- [ ] **Step 4 : tests verts** — les 2 suites.

- [ ] **Step 5 : commit**

```bash
git add backend/src/services/dataExport.service.ts backend/src/services/__tests__/dataExport.service.test.ts backend/src/routes/me.ts backend/src/routes/__tests__/me.routes.test.ts
git commit -m "feat(rgpd): export JSON des donnees du joueur (GET /api/me/export, rate-limite)"
```

---

### Task 12 : jalon « Infos légales » du statut d'onboarding (backend)

**Files:**
- Modify: `backend/src/services/onboarding.service.ts` (l.1-35)
- Test: `backend/src/services/__tests__/onboarding.service.test.ts`

- [ ] **Step 1 : test en échec** :

```ts
it('hasLegalInfo vrai ssi les 4 champs clés sont remplis', async () => {
  prismaMock.club.findUnique.mockResolvedValue({
    logoUrl: null, presentationText: null, stripeAccountStatus: 'NONE',
    legalEntityName: 'Arena SAS', siret: '12345678901234', legalEmail: 'c@x.fr', mediatorName: 'CM2C',
  });
  // …counts existants mockés à 0 (reprendre le setup du test getStatus existant)
  const s = await service.getStatus('c1');
  expect(s.hasLegalInfo).toBe(true);
});
```

(+ le cas inverse : un des 4 champs vide → `false`.)

- [ ] **Step 2 : échec vérifié.**

- [ ] **Step 3 : implémenter** — dans `getStatus` : élargir le select club (`legalEntityName: true, siret: true, legalEmail: true, mediatorName: true`) et ajouter au retour :

```ts
      hasLegalInfo: [club.legalEntityName, club.siret, club.legalEmail, club.mediatorName]
        .every((v) => (v ?? '').trim().length > 0),
```

- [ ] **Step 4 : tests verts** (suite onboarding.service + route admin.onboarding si elle snapshot le retour).

- [ ] **Step 5 : commit**

```bash
git add backend/src/services/onboarding.service.ts backend/src/services/__tests__/onboarding.service.test.ts
git commit -m "feat(onboarding): jalon infos legales dans le statut serveur"
```

---

### Task 13 : textes plateforme Tolaris Studio + page `/cgu` + footer (frontend)

**Files:**
- Modify: `frontend/lib/platformContent.ts` (remplacer `PLATFORM_MENTIONS`, `PLATFORM_CGV`, `PLATFORM_CONFIDENTIALITE` ; créer `PLATFORM_CGU`)
- Create: `frontend/app/cgu/page.tsx`
- Modify: `frontend/lib/authGate.ts` (`PUBLIC_PATHS`, l.3-7)
- Modify: `frontend/components/Footer.tsx` (l.19-34 + rendu des liens)
- Test: `frontend/__tests__/authGate.test.ts` + Create: `frontend/__tests__/platformContent.test.ts`

> Les 4 documents ci-dessous sont **le contenu à coller tel quel** (constantes template-literal — échapper les backticks s'il y en a ; il n'y en a pas). Placeholders `[à compléter]` = liste fermée à remplir au Kbis. **Rappel porté par la spec : modèles à faire relire par un avocat avant ouverture.**

- [ ] **Step 1 : test en échec** — `frontend/__tests__/platformContent.test.ts` :

```ts
import { PLATFORM_MENTIONS, PLATFORM_CGU, PLATFORM_CGV, PLATFORM_CONFIDENTIALITE } from '../lib/platformContent';

describe('documents légaux plateforme', () => {
  it('sont édités par Tolaris Studio et datés', () => {
    for (const doc of [PLATFORM_MENTIONS, PLATFORM_CGU, PLATFORM_CGV, PLATFORM_CONFIDENTIALITE]) {
      expect(doc).toContain('Version du 18 juillet 2026');
    }
    expect(PLATFORM_MENTIONS).toContain('Tolaris Studio');
    expect(PLATFORM_MENTIONS).toContain('cours d\'immatriculation');
  });
  it('CGU : âge minimum et modération présents', () => {
    expect(PLATFORM_CGU).toContain('15 ans');
    expect(PLATFORM_CGU).toContain('Signaler');
  });
  it('CGV SaaS : annexe de sous-traitance (DPA) présente', () => {
    expect(PLATFORM_CGV).toContain('Annexe');
    expect(PLATFORM_CGV).toContain('sous-traitance');
    expect(PLATFORM_CGV).toContain('article 28');
  });
  it('confidentialité : cookies documentés sans bandeau', () => {
    expect(PLATFORM_CONFIDENTIALITE).toContain('token');
    expect(PLATFORM_CONFIDENTIALITE).toContain('aucun cookie publicitaire');
  });
});
```

Et dans `authGate.test.ts`, ajouter : `expect(isPublicPath('/cgu')).toBe(true);` dans le bloc existant.

- [ ] **Step 2 : vérifier l'échec** — `cd frontend; node node_modules/jest/bin/jest.js --runTestsByPath __tests__/platformContent.test.ts` → FAIL.

- [ ] **Step 3 : remplacer les 4 constantes** de `frontend/lib/platformContent.ts` (les autres exports — `PLATFORM_FAQ`, interfaces — ne changent pas) :

```ts
export const PLATFORM_MENTIONS = `# Mentions légales

*Version du 18 juillet 2026*

## Éditeur
Le site palova.fr et les sites de clubs hébergés sur ses sous-domaines sont édités par
**Tolaris Studio**, société en cours d'immatriculation au registre du commerce et des sociétés
de **[à compléter : ville du RCS]**.

- Forme juridique : [à compléter]
- Capital social : [à compléter]
- SIRET : [à compléter]
- Siège social : [à compléter]
- Téléphone : [à compléter]
- Contact : contact@palova.fr
- Directeur de la publication : Eric Nougayrède

Ces informations seront complétées dès l'immatriculation de la société.

**Sites de clubs** : chaque club dispose de son propre site sur un sous-domaine
(votreclub.palova.fr). Le contenu de ce site (présentation, offres, annonces, tarifs) est édité
par le club, qui publie ses propres mentions légales, accessibles depuis le pied de page de son site.

## Hébergement
Le site est hébergé par **Hetzner Online GmbH** — Industriestr. 25, 91710 Gunzenhausen,
Allemagne — tél. +49 (0)9831 505-0 — https://www.hetzner.com.

## Propriété intellectuelle
La marque Palova, le logo et l'ensemble des éléments originaux du site (textes, visuels,
interfaces, code) sont protégés par le droit de la propriété intellectuelle. Toute reproduction
non autorisée est interdite.

## Signaler un contenu
Chaque message publié sur la plateforme (chat de partie, messagerie) peut être signalé via le
bouton « Signaler ». Vous pouvez aussi nous écrire à contact@palova.fr en décrivant précisément
le contenu concerné.
`;

export const PLATFORM_CGU = `# Conditions générales d'utilisation

*Version du 18 juillet 2026*

Les présentes conditions générales d'utilisation (CGU) régissent l'utilisation de la plateforme
**Palova**, éditée par **Tolaris Studio** (société en cours d'immatriculation — voir les
[mentions légales](/mentions-legales)), par toute personne disposant d'un compte (« l'utilisateur »).

## 1. Objet
Palova permet de réserver des terrains, de s'inscrire à des tournois et événements, de rejoindre
des parties ouvertes et d'échanger avec les autres membres des clubs équipés de la plateforme.

## 2. Compte
La création d'un compte requiert une adresse e-mail valide. L'utilisateur garantit l'exactitude
des informations fournies et la confidentialité de son mot de passe ; toute activité effectuée
depuis son compte est réputée effectuée par lui. L'inscription est réservée aux personnes d'au
moins **15 ans** ; en dessous, l'accord d'un titulaire de l'autorité parentale est requis.

## 3. Rôle de Palova et rôle des clubs
Palova est un **outil technique**. Les prestations (réservations, tournois, cours, offres) sont
vendues par **chaque club**, seul cocontractant de l'utilisateur pour ces achats : prix,
conditions d'annulation et de remboursement relèvent des **CGV du club**, accessibles sur son
site. Les paiements en ligne sont encaissés directement par le club via son compte Stripe ;
Palova n'est pas partie à la transaction.

## 4. Comportement
L'utilisateur s'interdit tout contenu ou comportement illicite, injurieux, discriminatoire,
harcelant ou contraire à l'ordre public, dans les chats de partie, la messagerie privée comme
dans tout contenu soumis à la plateforme, ainsi que toute perturbation du service (accès non
autorisé, extraction massive de données, usurpation).

## 5. Signalement et modération
Tout message peut être **signalé**. Les signalements d'un chat de partie sont examinés par le
staff du club ; ceux de la messagerie privée par l'équipe Palova. Un contenu illicite peut être
retiré et le compte de son auteur suspendu, dans le respect du cadre légal applicable.

## 6. Suspension et résiliation
L'utilisateur peut supprimer son compte à tout moment depuis son profil (les données sont alors
anonymisées — voir la [politique de confidentialité](/confidentialite)). En cas de manquement
grave ou répété aux présentes CGU, Palova peut suspendre ou résilier le compte après, sauf
urgence, une mise en demeure restée sans effet. Un club peut par ailleurs restreindre l'accès
de ses propres espaces (statut de membre) selon ses règles internes.

## 7. Propriété intellectuelle
La plateforme reste la propriété de Tolaris Studio. L'utilisateur conserve ses droits sur les
contenus qu'il publie et concède à Palova une licence limitée, nécessaire au seul fonctionnement
du service (affichage aux autres membres concernés).

## 8. Disponibilité et responsabilité
Palova met en œuvre des moyens raisonnables pour assurer la disponibilité du service, sans
garantie d'absence d'interruption. Palova n'est pas responsable des prestations des clubs, de la
conduite des autres utilisateurs, ni des dommages indirects. Rien dans les présentes n'exclut la
responsabilité qui ne peut l'être légalement.

## 9. Données personnelles
Le traitement des données est décrit dans la [politique de confidentialité](/confidentialite).

## 10. Évolution des CGU
Les CGU peuvent évoluer. La version en vigueur, datée, est publiée sur cette page ; en cas de
changement substantiel, l'utilisateur en est informé lors de sa prochaine visite. La poursuite
de l'utilisation vaut acceptation.

## 11. Droit applicable
Les présentes CGU sont soumises au droit français. Tout litige relève des tribunaux compétents ;
le consommateur peut saisir celui de son lieu de résidence.
`;

export const PLATFORM_CGV = `# Conditions générales de vente — abonnement Palova (clubs)

*Version du 18 juillet 2026*

Les présentes conditions générales de vente (CGV) régissent la fourniture de la plateforme
**Palova** par **Tolaris Studio** (société en cours d'immatriculation — voir les
[mentions légales](/mentions-legales)) à tout club professionnel (« le Club »). Elles s'adressent
à des professionnels (B2B).

## 1. Service
Palova fournit au Club un site de réservation à son enseigne (sous-domaine dédié), la gestion de
ses membres, plannings, tournois, événements et encaissements, en mode SaaS. Le détail des
fonctionnalités et des paliers est décrit sur la page [Tarifs](/tarifs).

## 2. Compte club et gérant
Le compte gérant, créé avec le club, contracte au nom du Club et garantit disposer du pouvoir de
l'engager. Le Club garantit l'exactitude de ses informations (dont SIRET).

## 3. Abonnement et tarifs
Un seul plan, dont le prix mensuel dépend du nombre de **membres actifs** du Club (joueurs ayant
réservé ou participé dans les 90 derniers jours), par paliers publiés sur la page Tarifs, en
euros **hors taxes**. Le palier est réévalué mensuellement : montée après deux mois consécutifs
de dépassement, descente dès un mois, sans prorata en cours de période. Cadence mensuelle ou
annuelle (remise affichée).

## 4. Facturation et paiement
La facturation est opérée via Stripe Billing ; les factures sont accessibles depuis l'espace
d'administration. Paiement à échéance, TVA en sus au taux en vigueur. **Retard de paiement** :
pénalités au taux de la BCE majoré de 10 points et indemnité forfaitaire de recouvrement de
40 € (articles L441-10 et D441-5 du Code de commerce). En cas d'impayé persistant, l'accès au
service peut être suspendu après mise en demeure.

## 5. Encaissement des adhérents
Les ventes du Club à ses adhérents (réservations, inscriptions, offres) sont encaissées sur le
**compte Stripe du Club**. Palova n'est ni vendeur, ni intermédiaire de paiement, ni partie à
ces transactions. Le Club fait son affaire de ses obligations de vendeur (CGV, médiation de la
consommation, facturation, remboursements).

## 6. Obligations du Club
Le Club s'engage à : publier ses informations légales et ses CGV (des modèles pré-remplis sont
fournis dans son espace d'administration) ; adhérer à un dispositif de **médiation de la
consommation** ; ne diffuser que des contenus licites dont il détient les droits ; utiliser les
données de ses membres conformément au RGPD (voir l'Annexe).

## 7. Disponibilité et support
Palova met en œuvre des moyens raisonnables pour assurer la disponibilité du service (sauvegardes
régulières, hébergement européen), sans engagement de niveau de service chiffré. Support par
e-mail : contact@palova.fr.

## 8. Durée et résiliation
Abonnement à durée indéterminée, résiliable à tout moment depuis l'espace d'administration,
effectif à la fin de la période en cours (pas de remboursement au prorata). À la résiliation, le
Club peut demander la restitution de ses données (voir l'Annexe) ; passé 90 jours, elles sont
supprimées ou anonymisées.

## 9. Responsabilité
La responsabilité totale de Tolaris Studio, toutes causes confondues, est plafonnée aux sommes
versées par le Club au titre des 12 derniers mois. Les dommages indirects (perte de chiffre
d'affaires, de clientèle, de données imputable au Club) sont exclus.

## 10. Droit applicable
Droit français. Compétence exclusive des tribunaux du ressort du siège de Tolaris Studio, y
compris en référé.

---

## Annexe — Accord de sous-traitance des données (article 28 RGPD)

Pour les données personnelles des membres du Club traitées via la plateforme, le **Club est
responsable de traitement** et **Tolaris Studio sous-traitant**.

1. **Objet et durée** : hébergement et traitement des données des membres pour la fourniture du
   service, pendant toute la durée de l'abonnement.
2. **Nature et finalités** : gestion des comptes membres, réservations, inscriptions, paiements,
   communications du Club.
3. **Données et personnes concernées** : identité, coordonnées, données d'activité sportive et
   de paiement des membres et prospects du Club.
4. **Instructions** : Tolaris Studio ne traite ces données que sur instruction documentée du
   Club (l'utilisation de la plateforme valant instruction) et n'en fait aucun usage propre.
5. **Confidentialité et sécurité** : accès limité aux personnes habilitées, chiffrement en
   transit, sauvegardes, hébergement dans l'Union européenne (Hetzner, Allemagne).
6. **Sous-traitants ultérieurs** : le Club autorise le recours à Hetzner (hébergement), Stripe
   (paiements) et OVH (envoi d'e-mails). Tolaris Studio informera le Club de tout changement,
   qui pourra s'y opposer pour motif légitime.
7. **Assistance** : Tolaris Studio aide le Club à répondre aux demandes d'exercice de droits des
   personnes et lui notifie **toute violation de données** dans les meilleurs délais après en
   avoir eu connaissance.
8. **Sort des données** : à la fin du contrat, restitution des données du Club dans un format
   structuré sur demande, puis suppression ou anonymisation sous 90 jours.
9. **Audit** : Tolaris Studio met à disposition les informations raisonnablement nécessaires
   pour démontrer le respect de la présente annexe.
`;

export const PLATFORM_CONFIDENTIALITE = `# Politique de confidentialité

*Version du 18 juillet 2026*

**Tolaris Studio** (société en cours d'immatriculation — voir les
[mentions légales](/mentions-legales)) traite vos données personnelles conformément au RGPD.
Contact : contact@palova.fr.

## Qui est responsable de quoi ?
- Pour votre **compte Palova** (identité, connexion, préférences, messagerie), **Tolaris Studio
  est responsable de traitement**.
- Pour les données liées à votre **vie de membre d'un club** (réservations, inscriptions,
  paiements au club, communications du club), **le club est responsable de traitement** et
  Tolaris Studio agit comme **sous-traitant** pour son compte. La politique de confidentialité
  du club s'applique en complément.

## Quelles données, pourquoi, combien de temps ?

| Traitement | Données | Base légale | Conservation |
|---|---|---|---|
| Compte et connexion | identité, e-mail, mot de passe haché, téléphone | contrat | jusqu'à suppression du compte, puis anonymisation |
| Réservations et inscriptions | créneaux, participations, niveau | contrat | durée de vie du compte |
| Paiements en ligne | montants, 4 derniers chiffres de carte (via Stripe) | contrat, obligation légale | 10 ans (pièces comptables, côté club) |
| Messagerie et chats | messages envoyés | contrat | jusqu'à suppression du message ou du compte |
| Notifications et e-mails | préférences, envois | contrat, intérêt légitime | durée de vie du compte |
| Facturation SaaS des clubs | coordonnées de facturation | contrat, obligation légale | 10 ans |
| Sécurité et journaux techniques | adresses IP, journaux | intérêt légitime | 12 mois |

Aucune donnée n'est vendue ni utilisée à des fins publicitaires.

## Destinataires et transferts
Sous-traitants : **Hetzner** (hébergement, Allemagne), **Stripe** (paiements — des transferts
hors UE peuvent intervenir, encadrés par des clauses contractuelles types), **OVH** (e-mails,
France). Les membres d'un même club voient les informations que vous rendez visibles (nom,
avatar, niveau, participation aux parties).

## Vos droits
Accès, rectification, effacement, limitation, opposition, portabilité : depuis votre profil
(**Télécharger mes données**, **Supprimer mon compte**) ou par e-mail à contact@palova.fr.
Vous pouvez saisir la CNIL (cnil.fr) à tout moment.

## Cookies
Le site n'utilise que des traceurs **strictement nécessaires**, exemptés de consentement :

- cookie \`token\` (session de connexion, 7 jours) ;
- cookie \`clubId\` (contexte du club courant, 7 jours) ;
- stockage local du navigateur pour vos préférences d'affichage (thème, vues).

**Aucun cookie publicitaire, aucun traceur de mesure d'audience.** C'est pourquoi aucun bandeau
de consentement n'est affiché. Si cela changeait, un recueil de consentement serait mis en place
au préalable.

## Suppression de compte
La suppression (profil → Sécurité) anonymise vos données personnelles ; les traces comptables
des clubs (paiements) sont conservées le temps de leurs obligations légales.
`;
```

⚠️ Dans la section Cookies ci-dessus, les backticks markdown autour de `token`/`clubId` sont **échappés d'un backslash** (le document vit dans un template literal TS) — coller tel quel, puis vérifier le rendu sur `/confidentialite`.

- [ ] **Step 4 : créer `frontend/app/cgu/page.tsx`** (document plateforme pur — pas de version club, donc pas de `ClubPageView`) :

```tsx
import { ContentShell } from '@/components/content/ContentShell';
import { Markdown } from '@/components/ui/Markdown';
import { PLATFORM_CGU } from '@/lib/platformContent';

// CGU de la plateforme : identiques sur l'hôte plateforme et les sous-domaines club
// (le joueur d'un club est aussi utilisateur de Palova).
export default function CguPage() {
  return (
    <ContentShell>
      <Markdown>{PLATFORM_CGU}</Markdown>
    </ContentShell>
  );
}
```

- [ ] **Step 5 : `authGate.ts`** — ajouter `'/cgu'` à `PUBLIC_PATHS` (à côté de `'/cgv'`).

- [ ] **Step 6 : `Footer.tsx`** — liste plateforme : insérer `{ href: '/cgu', label: 'CGU' }` avant CGV ; liste club : insérer `{ href: \`https://${CANONICAL_ROOT}/cgu\`, label: 'CGU Palova' }` avant Mentions légales. Le rendu doit gérer les liens absolus :

```tsx
{links.map((l) => l.href.startsWith('http') ? (
  <a key={l.href} href={l.href} style={{ color: th.textMute, textDecoration: 'none', fontSize: 13.5, fontWeight: 500 }}>{l.label}</a>
) : (
  <Link key={l.href} href={l.href} style={{ color: th.textMute, textDecoration: 'none', fontSize: 13.5, fontWeight: 500 }}>{l.label}</Link>
))}
```

- [ ] **Step 7 : tests verts** — `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/platformContent.test.ts __tests__/authGate.test.ts` → PASS. Puis `node node_modules/typescript/bin/tsc --noEmit`.

- [ ] **Step 8 : commit**

```bash
git add frontend/lib/platformContent.ts frontend/app/cgu frontend/lib/authGate.ts frontend/components/Footer.tsx frontend/__tests__/platformContent.test.ts frontend/__tests__/authGate.test.ts
git commit -m "feat(legal): documents plateforme Tolaris Studio (mentions, CGU, CGV SaaS+DPA, confidentialite)"
```

---

### Task 14 : case CGU sur `/register` (frontend)

**Files:**
- Modify: `frontend/lib/api.ts` (`RegisterBody`, l.1623-1630)
- Modify: `frontend/app/register/page.tsx`
- Test: `frontend/__tests__/RegisterPage.test.tsx`

- [ ] **Step 1 : tests en échec** — dans `RegisterPage.test.tsx` (pattern existant du fichier : `wrap()`, `api.*` mockés) :

```tsx
it('bloque la soumission tant que la case CGU n\'est pas cochée', async () => {
  wrap();
  fireEvent.change(screen.getByLabelText('Prénom'), { target: { value: 'Alice' } });
  fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Martin' } });
  fireEvent.change(screen.getByLabelText('Adresse e-mail'), { target: { value: 'alice@test.fr' } });
  fireEvent.change(screen.getByLabelText('Mot de passe (8+ caractères)'), { target: { value: 'motdepasse' } });
  fireEvent.click(screen.getByRole('button', { name: /Créer mon compte/ }));
  await waitFor(() => expect(screen.getByText(/accepter les conditions/i)).toBeInTheDocument());
  expect(api.register).not.toHaveBeenCalled();
});

it('envoie acceptTerms: true quand la case est cochée', async () => {
  wrap();
  fireEvent.change(screen.getByLabelText('Prénom'), { target: { value: 'Alice' } });
  fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Martin' } });
  fireEvent.change(screen.getByLabelText('Adresse e-mail'), { target: { value: 'alice@test.fr' } });
  fireEvent.change(screen.getByLabelText('Mot de passe (8+ caractères)'), { target: { value: 'motdepasse' } });
  fireEvent.click(screen.getByRole('checkbox', { name: /J'accepte les conditions générales d'utilisation/ }));
  fireEvent.click(screen.getByRole('button', { name: /Créer mon compte/ }));
  await waitFor(() => expect(api.register).toHaveBeenCalledWith(expect.objectContaining({ acceptTerms: true })));
});
```

- [ ] **Step 2 : vérifier l'échec** — `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/RegisterPage.test.tsx` → FAIL.

- [ ] **Step 3 : implémenter**

`lib/api.ts` — `RegisterBody` gagne `acceptTerms: boolean;` (requis : tout appel doit désormais le fournir — le compilateur listera les appels à mettre à jour, dont `clubs/new`, traité en Task 15 ; pour compiler entre les deux tâches, faire les DEUX modifications d'api.ts ici : `RegisterBody.acceptTerms` ET `CreateClubBody.acceptSaasTerms`).

`register/page.tsx` :
1. État : `const [accepted, setAccepted] = useState(false);`
2. Dans `handleSubmit`, après le check mot de passe : `if (!accepted) { setError('Merci d\'accepter les conditions générales d\'utilisation et la politique de confidentialité.'); return; }`
3. Appel : `api.register({ email, password, firstName, lastName, acceptTerms: true, ...(preferredSportId ? { preferredSportId } : {}) });`
4. JSX, juste avant `<div style={{ height: 4 }} />` :

```tsx
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, cursor: 'pointer' }}>
            <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)}
              aria-label="J'accepte les conditions générales d'utilisation et la politique de confidentialité"
              style={{ width: 15, height: 15, marginTop: 2, accentColor: th.accent, flex: '0 0 auto', cursor: 'pointer' }} />
            <span style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, lineHeight: 1.5 }}>
              J&apos;accepte les{' '}
              <a href="/cgu" target="_blank" rel="noopener noreferrer" style={{ color: th.text, textDecoration: 'underline' }}>conditions générales d&apos;utilisation</a>
              {' '}et la{' '}
              <a href="/confidentialite" target="_blank" rel="noopener noreferrer" style={{ color: th.text, textDecoration: 'underline' }}>politique de confidentialité</a>.
            </span>
          </label>
```

- [ ] **Step 4 : tests verts** — suite `RegisterPage.test.tsx` complète (les tests de soumission existants doivent cocher la case ; helper local `checkTerms()` si besoin). Puis `tsc --noEmit` — il révélera l'appel `register` de `clubs/new/page.tsx` : y passer `acceptTerms: accepted` (l'état arrive en Task 15 ; provisoirement `acceptTerms: true` est INTERDIT — faire Task 15 dans la foulée avant de committer si le typage bloque, OU committer les deux tâches ensemble).

- [ ] **Step 5 : commit** (avec Task 15 si le typage a imposé de les faire ensemble)

```bash
git add frontend/lib/api.ts frontend/app/register/page.tsx frontend/__tests__/RegisterPage.test.tsx
git commit -m "feat(register): case CGU+confidentialite obligatoire a l'inscription"
```

---

### Task 15 : case CGV Palova sur `/clubs/new` (frontend)

**Files:**
- Modify: `frontend/app/clubs/new/page.tsx`
- Test: `frontend/__tests__/NewClubPage.test.tsx`

- [ ] **Step 1 : tests en échec** — dans `NewClubPage.test.tsx` (le stub actif `VerifyCodeForm` du fichier déclenche `finishClub`) :

```tsx
it('bloque la soumission sans acceptation des conditions', async () => {
  wrap(); // helper de rendu du fichier
  remplirFormulaireValide(); // reprendre la séquence fireEvent des tests existants
  fireEvent.click(screen.getByRole('button', { name: /Créer mon club/ }));
  await waitFor(() => expect(screen.getByText(/accepter les CGV/i)).toBeInTheDocument());
  expect(api.register).not.toHaveBeenCalled();
});

it('createClub reçoit acceptSaasTerms: true', async () => {
  api.createClub.mockResolvedValue({ id: 'c1', slug: 'club-test' });
  wrap();
  remplirFormulaireValide();
  fireEvent.click(screen.getByRole('checkbox', { name: /J'accepte les conditions générales d'utilisation, les CGV Palova/ }));
  fireEvent.click(screen.getByRole('button', { name: /Créer mon club/ }));
  await waitFor(() => screen.getByRole('button', { name: 'Déclencher la vérification' }));
  fireEvent.click(screen.getByRole('button', { name: 'Déclencher la vérification' }));
  await waitFor(() => expect(api.createClub).toHaveBeenCalledWith(
    expect.objectContaining({ acceptSaasTerms: true }), 'tok',
  ));
});
```

- [ ] **Step 2 : vérifier l'échec.**

- [ ] **Step 3 : implémenter** — `clubs/new/page.tsx` :
1. État `accepted` + garde dans `handleSubmit` : `if (!accepted) { setError('Merci d\'accepter les CGV Palova pour créer votre club.'); return; }`
2. `api.register({ email, password, firstName, lastName, acceptTerms: true })` (le gérant accepte CGU+CGV d'une seule case, cf. libellé).
3. `finishClub` : `api.createClub({ name: clubName, city: city || undefined, siret: siret.trim(), ownerPhone: phone.trim(), acceptSaasTerms: true }, auth.token)`.
4. JSX avant `<div style={{ height: 4 }} />` — une seule case couvrant les trois documents :

```tsx
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, cursor: 'pointer' }}>
            <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)}
              aria-label="J'accepte les conditions générales d'utilisation, les CGV Palova et l'annexe de sous-traitance des données"
              style={{ width: 15, height: 15, marginTop: 2, accentColor: th.accent, flex: '0 0 auto', cursor: 'pointer' }} />
            <span style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, lineHeight: 1.5 }}>
              J&apos;accepte les{' '}
              <a href="/cgu" target="_blank" rel="noopener noreferrer" style={{ color: th.text, textDecoration: 'underline' }}>CGU</a>,{' '}
              les <a href="/cgv" target="_blank" rel="noopener noreferrer" style={{ color: th.text, textDecoration: 'underline' }}>CGV Palova</a>{' '}
              et leur annexe de sous-traitance des données (RGPD).
            </span>
          </label>
```

- [ ] **Step 4 : tests verts** — suite `NewClubPage.test.tsx` complète (tests existants → cocher la case) + `tsc --noEmit` propre (plus d'appel `register`/`createClub` sans les nouveaux champs).

- [ ] **Step 5 : commit**

```bash
git add frontend/app/clubs/new/page.tsx frontend/__tests__/NewClubPage.test.tsx
git commit -m "feat(clubs/new): acceptation CGU + CGV SaaS + annexe DPA a la creation de club"
```

---

### Task 16 : `CgvGate` + case CGV sur les 3 parcours d'achat (frontend)

**Files:**
- Create: `frontend/components/CgvGate.tsx`
- Modify: `frontend/lib/api.ts` (`createRegistrationIntent` l.216-226, `createOfferPlanIntent`/`createOfferPackageIntent` l.654-662)
- Modify: `frontend/app/tournois/[id]/page.tsx` (l.220-235), `frontend/app/events/[id]/page.tsx` (l.177-189), `frontend/components/clubhouse/OffersShowcase.tsx` (l.219-233)
- Test: Create `frontend/__tests__/CgvGate.test.tsx` + suites existantes des 3 surfaces

⚠️ `OffersShowcase.tsx` porte du WIP tiers dans le working tree — ne toucher QUE le bloc `StripePaymentStep` et ne committer que ce diff (`git add -p` si nécessaire).

- [ ] **Step 1 : test en échec** — `CgvGate.test.tsx` :

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { CgvGate } from '../components/CgvGate';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ slug: 'padel-arena', club: null, loading: false }) }));

const wrap = () => render(
  <ThemeProvider><CgvGate><div>formulaire-stripe</div></CgvGate></ThemeProvider>,
);

describe('CgvGate', () => {
  beforeEach(() => window.localStorage.clear());

  it('masque les enfants tant que la case n\'est pas cochée', () => {
    wrap();
    expect(screen.queryByText('formulaire-stripe')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByText('formulaire-stripe')).toBeInTheDocument();
  });

  it('mémorise l\'acceptation par club (pré-cochage au prochain montage)', () => {
    wrap();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(window.localStorage.getItem('palova:cgv-accepted:padel-arena')).toBe('1');
  });

  it('pointe vers les CGV du club', () => {
    wrap();
    expect(screen.getByRole('link', { name: /conditions générales de vente/ })).toHaveAttribute('href', '/cgv');
  });
});
```

- [ ] **Step 2 : vérifier l'échec.**

- [ ] **Step 3 : implémenter**

`frontend/components/CgvGate.tsx` :

```tsx
'use client';
import { ReactNode, useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { useClub } from '@/lib/ClubProvider';
import { hasAcceptedCgv, rememberCgvAccepted } from '@/lib/cgv';

/**
 * Case CGV obligatoire avant tout paiement CB en ligne (pattern BookingModal, partagé par
 * les inscriptions tournoi/event et les offres). Les enfants — le formulaire Stripe — ne
 * sont montés qu'une fois la case cochée : l'intent n'est donc créé qu'après acceptation.
 * Grâce au repli légal backend, /cgv du club rend TOUJOURS un texte opposable.
 */
export function CgvGate({ children }: { children: ReactNode }) {
  const { th } = useTheme();
  const { slug } = useClub();
  const [accepted, setAccepted] = useState(() => hasAcceptedCgv(slug));

  return (
    <div>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
        <input type="checkbox" checked={accepted}
          onChange={(e) => { const v = e.target.checked; setAccepted(v); if (v) rememberCgvAccepted(slug); }}
          aria-label="J'accepte les conditions générales de vente et la politique de confidentialité"
          style={{ width: 15, height: 15, marginTop: 1, accentColor: th.accent, flex: '0 0 auto', cursor: 'pointer' }} />
        <span style={{ fontFamily: th.fontUI, fontSize: 11.5, color: th.textFaint, lineHeight: 1.4 }}>
          J&apos;accepte les{' '}
          <a href="/cgv" target="_blank" rel="noopener noreferrer" style={{ color: th.textMute, textDecoration: 'underline' }}>conditions générales de vente</a>
          {' '}et la{' '}
          <a href="/confidentialite" target="_blank" rel="noopener noreferrer" style={{ color: th.textMute, textDecoration: 'underline' }}>politique de confidentialité</a>.
        </span>
      </label>
      {accepted ? (
        <div style={{ marginTop: 14 }}>{children}</div>
      ) : (
        <p style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textFaint, margin: '10px 0 0' }}>
          Acceptez les conditions pour continuer.
        </p>
      )}
    </div>
  );
}
```

`lib/api.ts` :
- `createRegistrationIntent` : le `{ method: 'POST' }` devient `{ method: 'POST', body: JSON.stringify({ cgvAccepted: true }) }` (l'appel n'est atteignable que derrière la case — le flag est donc toujours vrai côté client).
- `createOfferPlanIntent` / `createOfferPackageIntent` : idem.

Les 3 surfaces : envelopper chaque `<StripePaymentStep …/>` existant dans `<CgvGate>…</CgvGate>` (import `import { CgvGate } from '@/components/CgvGate';`). Aucune autre modification des props.

- [ ] **Step 4 : tests verts** — `CgvGate.test.tsx` + suites des 3 surfaces : y ajouter un cas « la case CGV apparaît avant le formulaire de paiement » et adapter les tests existants du parcours paiement (cocher la case avant d'attendre le formulaire Stripe ; les fichiers mockent déjà `StripePaymentStep` ou Stripe). Puis `tsc --noEmit`.

- [ ] **Step 5 : commit**

```bash
git add frontend/components/CgvGate.tsx frontend/__tests__/CgvGate.test.tsx frontend/lib/api.ts frontend/app/tournois frontend/app/events frontend/components/clubhouse/OffersShowcase.tsx frontend/__tests__/
git commit -m "feat(paiement): case CGV partagee (CgvGate) sur tournois, events et offres"
```

---

### Task 17 : bandeau « Nos conditions ont évolué » (frontend)

**Files:**
- Modify: `frontend/lib/api.ts` (`MyProfile` l.2329-2345 + méthode `acceptLegal`)
- Create: `frontend/components/LegalUpdateBanner.tsx`
- Modify: `frontend/app/layout.tsx` (montage, l.62-96)
- Test: Create `frontend/__tests__/LegalUpdateBanner.test.tsx`

- [ ] **Step 1 : test en échec** :

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LegalUpdateBanner } from '../components/LegalUpdateBanner';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));
jest.mock('../lib/api', () => ({ api: { getMyProfile: jest.fn(), acceptLegal: jest.fn() } }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { api } = require('../lib/api') as { api: Record<string, jest.Mock> };

const PROFILE_BASE = { id: 'u1', email: 'e@x.fr', firstName: 'E', lastName: 'N' };
const wrap = () => render(<ThemeProvider><LegalUpdateBanner /></ThemeProvider>);

describe('LegalUpdateBanner', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rien quand tout est à jour', async () => {
    api.getMyProfile.mockResolvedValue({ ...PROFILE_BASE, legal: {
      cgu: { accepted: '2026-07-18', current: '2026-07-18' },
      privacy: { accepted: '2026-07-18', current: '2026-07-18' },
    } });
    wrap();
    await waitFor(() => expect(api.getMyProfile).toHaveBeenCalled());
    expect(screen.queryByText(/conditions ont évolué/)).not.toBeInTheDocument();
  });

  it('document en retard → bandeau, « J\'ai compris » accepte et masque', async () => {
    api.getMyProfile.mockResolvedValue({ ...PROFILE_BASE, legal: {
      cgu: { accepted: null, current: '2026-07-18' },
      privacy: { accepted: '2026-07-18', current: '2026-07-18' },
    } });
    api.acceptLegal.mockResolvedValue({ ok: true });
    wrap();
    await screen.findByText(/conditions ont évolué/);
    expect(screen.getByRole('link', { name: 'CGU' })).toHaveAttribute('href', '/cgu');
    fireEvent.click(screen.getByRole('button', { name: /J'ai compris/ }));
    await waitFor(() => expect(api.acceptLegal).toHaveBeenCalledWith('CGU', 'tok'));
    expect(screen.queryByText(/conditions ont évolué/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2 : vérifier l'échec.**

- [ ] **Step 3 : implémenter**

`lib/api.ts` :

```ts
export interface LegalDocStatus { accepted: string | null; current: string }
export type LegalDocumentKey = 'CGU' | 'PRIVACY' | 'CGV_SAAS';
// MyProfile gagne :
//   legal?: { cgu: LegalDocStatus; privacy: LegalDocStatus; cgvSaas?: LegalDocStatus };
// et la méthode :
acceptLegal: (document: LegalDocumentKey, token: string) =>
  request<{ ok: boolean }>('/api/me/legal/accept', { method: 'POST', body: JSON.stringify({ document }) }, token),
```

`frontend/components/LegalUpdateBanner.tsx` :

```tsx
'use client';
import { useEffect, useState } from 'react';
import { api, LegalDocumentKey, MyProfile } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useTheme } from '@/lib/ThemeProvider';

const DOCS: { key: 'cgu' | 'privacy' | 'cgvSaas'; api: LegalDocumentKey; label: string; href: string }[] = [
  { key: 'cgu', api: 'CGU', label: 'CGU', href: '/cgu' },
  { key: 'privacy', api: 'PRIVACY', label: 'politique de confidentialité', href: '/confidentialite' },
  { key: 'cgvSaas', api: 'CGV_SAAS', label: 'CGV Palova', href: '/cgv' },
];

/**
 * Bandeau global non bloquant : la version courante d'un document légal dépasse la dernière
 * version acceptée (ou aucune acceptation — comptes antérieurs à la feature). « J'ai compris »
 * écrit l'acceptation (context update_banner). Réaffiché à chaque session tant que non acté.
 */
export function LegalUpdateBanner() {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const [legal, setLegal] = useState<MyProfile['legal'] | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ready || !token) return;
    let cancelled = false;
    api.getMyProfile(token)
      .then((p) => { if (!cancelled) setLegal(p.legal ?? null); })
      .catch(() => { /* silencieux : le bandeau est best-effort */ });
    return () => { cancelled = true; };
  }, [ready, token]);

  if (!token || hidden || !legal) return null;
  const outdated = DOCS.filter((d) => {
    const s = legal[d.key];
    return s && (s.accepted === null || s.accepted < s.current);
  });
  if (outdated.length === 0) return null;

  const acknowledge = async () => {
    if (!token) return;
    setBusy(true);
    try {
      await Promise.all(outdated.map((d) => api.acceptLegal(d.api, token)));
      setHidden(true);
    } finally { setBusy(false); }
  };

  return (
    <div role="status" style={{
      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      background: th.surface2, borderBottom: `1px solid ${th.line}`, padding: '10px 16px',
      fontFamily: th.fontUI, fontSize: 13.5, color: th.text,
    }}>
      <span style={{ flex: 1, minWidth: 220 }}>
        Nos conditions ont évolué :{' '}
        {outdated.map((d, i) => (
          <span key={d.key}>{i > 0 && ' · '}<a href={d.href} target="_blank" rel="noopener noreferrer" style={{ color: th.accent, textDecoration: 'underline' }}>{d.label}</a></span>
        ))}
        . En continuant à utiliser Palova, vous les acceptez.
      </span>
      <button onClick={acknowledge} disabled={busy} style={{
        border: 'none', cursor: 'pointer', borderRadius: 9, padding: '7px 14px',
        background: th.accent, color: th.onAccent, fontFamily: th.fontUI, fontWeight: 700, fontSize: 13,
      }}>J&apos;ai compris</button>
    </div>
  );
}
```

`app/layout.tsx` : `import { LegalUpdateBanner } from '@/components/LegalUpdateBanner';` et monter `<LegalUpdateBanner />` en premier enfant du `<div style={{ flex: '1 0 auto' }}>` (au-dessus de `{children}`).

- [ ] **Step 4 : tests verts** + `tsc --noEmit`. ⚠️ Si des suites *real-mount* (ClubNav/ClubReserve) montent le layout complet, elles ne montent PAS `app/layout.tsx` (server component) — aucun mock à ajouter a priori ; vérifier avec les suites `ClubReserve.*` si un échec `getMyProfile` apparaît.

- [ ] **Step 5 : commit**

```bash
git add frontend/components/LegalUpdateBanner.tsx frontend/__tests__/LegalUpdateBanner.test.tsx frontend/lib/api.ts frontend/app/layout.tsx
git commit -m "feat(legal): bandeau global de re-acceptation des conditions"
```

---

### Task 18 : repli légal côté front + champs médiateur dans l'admin (frontend)

**Files:**
- Modify: `frontend/lib/api.ts` (`PublicClubPage` l.1705-1711, `ClubAdminDetail` l.1683-1690, `UpdateClubBody` l.1758-1796)
- Modify: `frontend/components/content/ClubPageView.tsx`
- Modify: `frontend/app/admin/pages/page.tsx` (`LegalForm`, l.110-162)
- Test: suites existantes (Glob `frontend/__tests__/*ClubPageView*` / `*AdminPages*` — créer `ClubPageView.test.tsx` si aucune n'existe)

- [ ] **Step 1 : tests en échec** — `ClubPageView` :

```tsx
it('page en repli → bandeau « Document type fourni par Palova »', async () => {
  api.getClubPage.mockResolvedValue({ kind: 'CGV', bodyMarkdown: '# CGV type', updatedAt: null, isFallback: true });
  render(<ThemeProvider><ClubPageView pageKind="CGV" platformBody="" /></ThemeProvider>);
  await screen.findByText('CGV type');
  expect(screen.getByText(/Document type fourni par Palova/)).toBeInTheDocument();
});
```

(mocks : `useClub` → `{ slug: 'padel-arena' }`, `api.getClubPage` jest.fn.)

`LegalForm` (suite admin pages si elle existe, sinon cas ajouté à la nouvelle suite) : le formulaire affiche « Médiateur de la consommation » et l'envoie dans le PATCH.

- [ ] **Step 2 : vérifier l'échec.**

- [ ] **Step 3 : implémenter**

`lib/api.ts` :
- `PublicClubPage` : `updatedAt: string | null; isFallback?: boolean;`
- `ClubAdminDetail` : ajouter `mediatorName: string | null; mediatorUrl: string | null;` au bloc légal.
- `UpdateClubBody` : ajouter `mediatorName: string; mediatorUrl: string;`.

`ClubPageView.tsx` — l'état `club` gagne `isFallback` ; rendu :

```tsx
      {state.kind === 'club' && state.isFallback && (
        <p style={{ background: th.surface2, border: `1px solid ${th.line}`, borderRadius: 10,
          padding: '8px 12px', fontSize: 12.5, color: th.textMute, margin: '0 0 14px' }}>
          Document type fourni par Palova, rendu avec les coordonnées du club — le club peut le
          personnaliser à tout moment.
        </p>
      )}
      {state.kind === 'club' && !state.isFallback && <UpdatedAt iso={state.updatedAt} />}
```

(le fetch passe `isFallback: p.isFallback === true` et `updatedAt` nullable dans l'état ; l'état `empty` ne subsiste que pour OFFRES.)

`app/admin/pages/page.tsx` — `LegalForm` : ajouter au state `mediatorName: club.mediatorName ?? '', mediatorUrl: club.mediatorUrl ?? ''` et 2 entrées à `fields` :

```ts
    ['mediatorName', 'Médiateur de la consommation', 'ex. CM2C — obligatoire pour vendre aux particuliers'],
    ['mediatorUrl', 'Site du médiateur', 'https://…'],
```

- [ ] **Step 4 : tests verts** + `tsc --noEmit`.

- [ ] **Step 5 : commit**

```bash
git add frontend/lib/api.ts frontend/components/content/ClubPageView.tsx frontend/app/admin/pages/page.tsx frontend/__tests__/
git commit -m "feat(pages): bandeau de repli legal + champs mediateur dans Contenu & mentions"
```

---

### Task 19 : bannière légale admin + jalon checklist (frontend)

**Files:**
- Create: `frontend/components/admin/LegalBanner.tsx`
- Modify: `frontend/app/admin/page.tsx` (montage, l.84-86)
- Modify: `frontend/lib/onboarding.ts` (`ChecklistItem`/`buildChecklist`, l.4-45) + `frontend/lib/api.ts` (`OnboardingStatus` l.1693-1701 : `hasLegalInfo: boolean;`)
- Test: Create `frontend/__tests__/LegalBanner.test.tsx` + Modify `frontend/__tests__/onboarding.test.ts`

- [ ] **Step 1 : tests en échec**

`onboarding.test.ts` : `buildChecklist({ ...STATUS, hasLegalInfo: false })` contient un jalon `{ key: 'legal', done: false, href: '/admin/pages' }` placé après `page` ; `checklistProgress` passe à 9 items.

`LegalBanner.test.tsx` (pattern BillingBanner : self-fetch, `null` sinon) :

```tsx
it('affichée quand Stripe est ACTIVE et les infos légales incomplètes', async () => {
  api.adminGetClub.mockResolvedValue({ stripeAccountStatus: 'ACTIVE', legalEntityName: null, siret: '123', legalEmail: null, mediatorName: null });
  render(<ThemeProvider><LegalBanner clubId="c1" token="t" /></ThemeProvider>);
  await screen.findByText(/complétez vos informations légales/i);
});

it('rien quand les 4 champs sont remplis', async () => {
  api.adminGetClub.mockResolvedValue({ stripeAccountStatus: 'ACTIVE', legalEntityName: 'X', siret: '1', legalEmail: 'a@b.fr', mediatorName: 'CM2C' });
  const { container } = render(<ThemeProvider><LegalBanner clubId="c1" token="t" /></ThemeProvider>);
  await waitFor(() => expect(api.adminGetClub).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});

it('rien quand Stripe n\'est pas actif', async () => { /* stripeAccountStatus: 'NONE' → vide */ });
```

- [ ] **Step 2 : vérifier l'échec.**

- [ ] **Step 3 : implémenter**

`onboarding.ts` — jalon inséré après `page` :

```ts
    { key: 'legal',  label: 'Vos informations légales (mentions, CGV, médiateur)', done: s.hasLegalInfo, href: '/admin/pages' },
```

(+ `'legal'` dans l'union `ChecklistItem['key']`.)

`LegalBanner.tsx` (calqué sur `BillingBanner` — self-fetch `adminGetClub`, `null` par défaut) :

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from '@/lib/ThemeProvider';
import { api, ClubAdminDetail } from '@/lib/api';

/** Un club encaisse en ligne (Stripe ACTIVE) sans coordonnées légales complètes : ses pages
 *  légales (repli compris) affichent des « [à compléter] ». Invitation, jamais un verrou. */
export function LegalBanner({ clubId, token }: { clubId: string; token: string }) {
  const { th } = useTheme();
  const router = useRouter();
  const [club, setClub] = useState<ClubAdminDetail | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.adminGetClub(clubId, token)
      .then((c) => { if (!cancelled) setClub(c); })
      .catch(() => { if (!cancelled) setClub(null); });
    return () => { cancelled = true; };
  }, [clubId, token]);

  if (!club || club.stripeAccountStatus !== 'ACTIVE') return null;
  const complete = [club.legalEntityName, club.siret, club.legalEmail, club.mediatorName]
    .every((v) => (v ?? '').trim().length > 0);
  if (complete) return null;

  return (
    <div role="status" style={{
      display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
      background: 'rgba(56,102,176,0.10)', border: `1px solid rgba(56,102,176,0.45)`,
      borderRadius: 12, padding: '12px 16px', margin: '0 0 18px',
    }}>
      <span style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.text, flex: 1, minWidth: 220 }}>
        Vous encaissez en ligne : complétez vos informations légales (raison sociale, SIRET,
        contact, médiateur de la consommation) — elles apparaissent sur vos mentions légales et vos CGV.
      </span>
      <button onClick={() => router.push('/admin/pages')} style={{
        padding: '8px 14px', borderRadius: 9, border: 'none', cursor: 'pointer',
        fontFamily: th.fontUI, fontWeight: 700, fontSize: 13, background: th.accent, color: th.onAccent,
      }}>Compléter</button>
    </div>
  );
}
```

`app/admin/page.tsx` — sous `BillingBanner` : `{isClubAdmin(role) && clubId && token && <LegalBanner clubId={clubId} token={token} />}`.

- [ ] **Step 4 : tests verts** — `LegalBanner`, `onboarding`, `StartChecklist` (fixture du test : ajouter `hasLegalInfo`) + `tsc --noEmit`.

- [ ] **Step 5 : commit**

```bash
git add frontend/components/admin/LegalBanner.tsx frontend/__tests__/LegalBanner.test.tsx frontend/lib/onboarding.ts frontend/lib/api.ts frontend/app/admin/page.tsx frontend/__tests__/onboarding.test.ts frontend/__tests__/StartChecklist.test.tsx
git commit -m "feat(admin): banniere infos legales + jalon checklist de demarrage"
```

---

### Task 20 : « Télécharger mes données » dans le profil (frontend)

**Files:**
- Modify: `frontend/lib/api.ts` (méthode `exportMyData`)
- Modify: `frontend/components/profile/tabs/ProfileSecurity.tsx` (l.46-70 : 3ᵉ section entre Mot de passe et Zone sensible)
- Test: `frontend/__tests__/MeProfile.test.tsx` (onglet Sécurité)

- [ ] **Step 1 : test en échec** — dans `MeProfile.test.tsx` (⚠️ ce fichier stubbe déjà `URL.createObjectURL` **localement** — ne PAS le déplacer dans `jest.setup.ts`) :

```tsx
it('Sécurité : télécharge l\'export JSON de mes données', async () => {
  api.exportMyData.mockResolvedValue({ generatedAt: '2026-07-18T10:00:00Z', profile: {} });
  await ouvrirOnglet('Sécurité'); // helper existant de la suite (navigation par pills du hero)
  fireEvent.click(screen.getByRole('button', { name: /Télécharger mes données/ }));
  await waitFor(() => expect(api.exportMyData).toHaveBeenCalledWith('tok'));
});
```

(+ mock `api.exportMyData` dans le mock api du fichier.)

- [ ] **Step 2 : vérifier l'échec.**

- [ ] **Step 3 : implémenter**

`lib/api.ts` : `exportMyData: (token: string) => request<Record<string, unknown>>('/api/me/export', {}, token),`

`ProfileSecurity.tsx` — nouvelle section entre « Mot de passe » et « Zone sensible » :

```tsx
      <section style={card} aria-label="Mes données">
        <CardKicker>Mes données</CardKicker>
        <p style={{ margin: 0, fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, lineHeight: 1.55 }}>
          Téléchargez une copie de vos données personnelles (profil, réservations, inscriptions,
          paiements, messages envoyés) au format JSON — droit à la portabilité (RGPD).
        </p>
        {exportError && (
          <div style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: inkOn(ACCENTS.coral), background: ACCENTS.coral, borderRadius: 11, padding: '9px 12px' }}>{exportError}</div>
        )}
        <button onClick={downloadExport} disabled={exporting} style={primaryBtn(exporting)}>
          {exporting ? 'Préparation…' : 'Télécharger mes données'}
        </button>
      </section>
```

avec dans le composant :

```tsx
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const downloadExport = async () => {
    setExporting(true); setExportError(null);
    try {
      const data = await api.exportMyData(token);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'palova-mes-donnees.json'; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError((e as Error).message === 'RATE_LIMITED'
        ? 'Un export a déjà été généré il y a moins d\'une heure. Réessayez plus tard.'
        : 'L\'export a échoué. Réessayez.');
    } finally { setExporting(false); }
  };
```

- [ ] **Step 4 : tests verts** — `--runTestsByPath __tests__/MeProfile.test.tsx` + `tsc --noEmit`.

- [ ] **Step 5 : commit**

```bash
git add frontend/lib/api.ts frontend/components/profile/tabs/ProfileSecurity.tsx frontend/__tests__/MeProfile.test.tsx
git commit -m "feat(profil): telechargement de mes donnees (export RGPD)"
```

---

### Task 21 : vérification finale + documentation

**Files:**
- Modify: `CLAUDE.md` (nouvelle section de jalon)

- [ ] **Step 1 : type-check des deux mondes**

```bash
cd backend; node node_modules/typescript/bin/tsc --noEmit
cd ../frontend; node node_modules/typescript/bin/tsc --noEmit
```

Attendu : 0 erreur (scoper la lecture aux fichiers du chantier si du WIP tiers pollue).

- [ ] **Step 2 : suites ciblées du chantier**

```bash
cd backend; node node_modules/jest/bin/jest.js legal clubPage clubPageTemplates auth me.routes club.service offer unsubscribe dataExport onboarding broadcast
cd ../frontend; node node_modules/jest/bin/jest.js --runTestsByPath __tests__/platformContent.test.ts __tests__/authGate.test.ts __tests__/RegisterPage.test.tsx __tests__/NewClubPage.test.tsx __tests__/CgvGate.test.tsx __tests__/LegalUpdateBanner.test.tsx __tests__/LegalBanner.test.tsx __tests__/onboarding.test.ts __tests__/StartChecklist.test.tsx __tests__/MeProfile.test.tsx
```

Attendu : tout vert (la suite front COMPLÈTE a ~6 échecs BookingModal préexistants — ne pas s'y arrêter).

- [ ] **Step 3 : vérification visuelle** (skill `verify` si session CDP disponible, sinon manuelle par Eric) : `/cgu`, `/mentions-legales`, `/confidentialite` (plateforme + hôte club en repli avec bandeau), case CGU sur `/register`, case sur `/clubs/new`, bandeau conditions (compte seedé antérieur → visible), export depuis le profil. Clair + sombre, 1280 + 390.

- [ ] **Step 4 : CLAUDE.md** — ajouter une section jalon « Conformité légale (2026-07-18) ✅ implémenté » résumant : corpus Tolaris Studio (4 documents scindés, versions `LEGAL_VERSIONS`), `LegalAcceptance` insert-only + gates `CGU_NOT_ACCEPTED`/`CGV_NOT_ACCEPTED`, bandeau global, CGV multi-parcours (`cgvAcceptedAt` sur TournamentRegistration/EventRegistration/Payment), repli légal permanent des pages club (`isFallback`), médiateur, unsubscribe HMAC, export RGPD, 3 migrations. Mentionner la checklist opérationnelle d'Eric (Kbis → placeholders, Stripe dashboard, médiateur par club, relecture avocat, SMTP).

- [ ] **Step 5 : commit final**

```bash
git add CLAUDE.md
git commit -m "docs: entree CLAUDE.md - conformite legale (mentions, CGU/CGV, RGPD)"
```

---

## Couverture spec → tâches

| Spec | Tâches |
|---|---|
| §4.1 corpus plateforme (4 docs, /cgu, footer) | 13 |
| §4.2 médiateur + modèles enrichis + repli + jalon + bannière | 6, 7, 12, 18, 19 |
| §4.3 LegalAcceptance + gates register/club + bandeau | 1, 2, 3, 4, 5, 14, 15, 17 |
| §4.4 CGV multi-parcours | 1, 8, 9, 16 |
| §4.5 unsubscribe broadcasts | 10 |
| §4.6 export RGPD | 11, 20 |
| §5 migrations | 1 |
| §7 tests | chaque tâche |
| §8 checklist opérationnelle (hors code) | 21 (rappel CLAUDE.md) — actions d'Eric |






