# Club-house v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformer le Club-house en vitrine + hub membre : affiches uploadées (mosaïque bento), présentation du club + galerie + page `/club`, offres & abonnements souscriptibles en ligne (Stripe), parties ouvertes pour tous, top du mois, rivière de partenaires défilante.

**Architecture:** Deux migrations additives (annonces enrichies, présentation club). Backend = extensions de services existants + `PresentationService`/`OfferService` neufs ; l'achat en ligne suit le pattern des inscriptions (intent Stripe avec metadata → fulfillment idempotent à la confirmation client ET au webhook, rien de pré-créé en base). Frontend = 6 nouveaux composants clubhouse + page `/club` + admin (`/admin/club`, annonces avec upload, opt-in settings).

**Tech Stack:** Express 5 + Prisma 7 (`PrismaPg` adapter), multer, Stripe Connect, Luxon ; Next.js 16 + React 19, styles inline `useTheme`, Jest + RTL.

**Spec:** `docs/superpowers/specs/2026-07-05-club-house-v2-design.md`

---

## ⚠️ Consignes transverses (lire avant chaque tâche)

- **Migrations** : base dev en dérive — JAMAIS `prisma migrate dev` ni `db push`. On écrit le SQL à la main, on l'applique avec `npx prisma db execute --file <fichier> --schema prisma/schema.prisma`, puis `npx prisma generate`. En prod : `prisma migrate deploy`.
- **Commits** : du travail non lié est en cours dans le repo. `git add` UNIQUEMENT les fichiers listés dans la tâche, jamais `git add -A`. Vérifier `git branch --show-current` == `main` avant chaque commit.
- **Jest/tsc (shims cassés)** : lancer `node node_modules/jest/bin/jest.js <suite>` et `node node_modules/typescript/bin/tsc --noEmit` (pas `npx jest`/`npx tsc`).
- **Tests frontend** : ts-jest ne type-check pas → toujours finir par `tsc --noEmit`. Les suites qui montent le vrai `ClubNav` cassent si un composant ajoute un appel `api.*` non mocké.
- Chemins relatifs au repo `C:\ProjetsIA\05_PERSO\RESERVE\palova`.

---

### Task 1: Migration `enrich_announcements` (kind + validUntil)

**Files:**
- Create: `backend/prisma/migrations/20260705100000_enrich_announcements/migration.sql`
- Modify: `backend/prisma/schema.prisma` (modèle `Announcement` + enum)

- [ ] **Step 1: Écrire le SQL de migration**

```sql
-- Annonces enrichies : type + fin d'affichage (additif, idempotent).
DO $$ BEGIN
  CREATE TYPE "AnnouncementKind" AS ENUM ('INFO', 'OFFER', 'TOURNAMENT', 'EVENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "announcements" ADD COLUMN IF NOT EXISTS "kind" "AnnouncementKind" NOT NULL DEFAULT 'INFO';
ALTER TABLE "announcements" ADD COLUMN IF NOT EXISTS "valid_until" TIMESTAMP(3);
```

- [ ] **Step 2: Mettre à jour le schéma Prisma**

Dans `backend/prisma/schema.prisma`, ajouter l'enum (près des autres enums en tête de fichier) :

```prisma
/// Type d'une annonce : info simple, offre commerciale, affiche tournoi, événement.
enum AnnouncementKind {
  INFO
  OFFER
  TOURNAMENT
  EVENT
}
```

Et dans le modèle `Announcement` (lignes ~954-970), ajouter après `imageUrl` :

```prisma
  kind        AnnouncementKind @default(INFO)
  validUntil  DateTime?        @map("valid_until") /// fin d'affichage (fin de journée UTC) ; null = sans limite
```

- [ ] **Step 3: Appliquer et régénérer**

```bash
cd backend
npx prisma db execute --file prisma/migrations/20260705100000_enrich_announcements/migration.sql --schema prisma/schema.prisma
npx prisma generate
```
Expected: `Script executed` puis `Generated Prisma Client`.

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260705100000_enrich_announcements/migration.sql
git commit -m "feat(annonces): migration enrich_announcements - kind + valid_until"
```

---

### Task 2: Annonces enrichies — service + upload d'image

**Files:**
- Modify: `backend/src/services/announcement.service.ts`
- Modify: `backend/src/utils/uploads.ts`
- Modify: `backend/src/routes/admin.ts` (route upload + `ANNOUNCEMENT_NOT_FOUND` dans `ERROR_STATUS`)
- Test: `backend/src/services/__tests__/announcement.service.test.ts` (étendre)

- [ ] **Step 1: Écrire les tests qui échouent** (ajouter au fichier de test existant — reprendre son style de mock prisma) :

```ts
describe('annonces enrichies (kind + validUntil)', () => {
  it('create accepte kind + validUntil YYYY-MM-DD stocké fin de journée UTC', async () => {
    prismaMock.announcement.create.mockResolvedValue({ id: 'a1' });
    await service.create('club-1', { title: 'Open P250', body: 'Affiche', kind: 'TOURNAMENT', validUntil: '2026-09-15' });
    expect(prismaMock.announcement.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: 'TOURNAMENT', validUntil: new Date('2026-09-15T23:59:59.999Z') }),
    }));
  });
  it('create refuse un kind inconnu (repli INFO) et une date invalide (VALIDATION_ERROR)', async () => {
    prismaMock.announcement.create.mockResolvedValue({ id: 'a1' });
    await service.create('club-1', { title: 't', body: 'b', kind: 'NIMPORTE' });
    expect(prismaMock.announcement.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: 'INFO' }),
    }));
    await expect(service.create('club-1', { title: 't', body: 'b', validUntil: 'pas-une-date' }))
      .rejects.toThrow('VALIDATION_ERROR');
  });
  it('update efface validUntil quand null explicite', async () => {
    prismaMock.announcement.findUnique.mockResolvedValue({ clubId: 'club-1' });
    prismaMock.announcement.update.mockResolvedValue({ id: 'a1' });
    await service.update('a1', 'club-1', { validUntil: null });
    expect(prismaMock.announcement.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ validUntil: null }),
    }));
  });
});
```

- [ ] **Step 2: Lancer — vérifier l'échec**

```bash
cd backend && node node_modules/jest/bin/jest.js announcement.service -t "enrichies"
```
Expected: FAIL (kind/validUntil non gérés).

- [ ] **Step 3: Implémenter dans `announcement.service.ts`**

En tête du fichier, sous les imports :

```ts
import fs from 'fs';
import path from 'path';
import { ANNOUNCEMENTS_DIR } from '../utils/uploads';

const VALID_KINDS = ['INFO', 'OFFER', 'TOURNAMENT', 'EVENT'] as const;
type Kind = typeof VALID_KINDS[number];

/** YYYY-MM-DD → fin de journée UTC (même convention que Sponsor.offerUntil). */
function parseValidUntil(v: string | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined;      // absent du body → non modifié
  if (v === null || v === '') return null;    // effacement explicite
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error('VALIDATION_ERROR');
  return new Date(`${v}T23:59:59.999Z`);
}

const asKind = (k: string | undefined): Kind | undefined =>
  k === undefined ? undefined : (VALID_KINDS.includes(k as Kind) ? (k as Kind) : 'INFO');

/** Supprime le fichier d'image uploadé d'une annonce (best-effort, jamais bloquant). */
function deleteUploadedImage(imageUrl: string | null | undefined): void {
  if (imageUrl?.startsWith('/uploads/announcements/')) {
    fs.promises.unlink(path.join(ANNOUNCEMENTS_DIR, path.basename(imageUrl))).catch(() => {});
  }
}
```

Étendre `AnnouncementInput` : `kind?: string; validUntil?: string | null;`.

Dans `create()`, ajouter au `data` : `kind: asKind(data.kind) ?? 'INFO', validUntil: parseValidUntil(data.validUntil) ?? null,`.

Dans `update()`, ajouter aux spreads :
```ts
...(data.kind !== undefined ? { kind: asKind(data.kind) } : {}),
...(parseValidUntil(data.validUntil) !== undefined ? { validUntil: parseValidUntil(data.validUntil) } : {}),
```

Dans `remove()`, supprimer aussi le fichier :
```ts
async remove(id: string, clubId: string) {
  const found = await prisma.announcement.findUnique({ where: { id }, select: { clubId: true, imageUrl: true } });
  if (found?.clubId === clubId) deleteUploadedImage(found.imageUrl);
  await prisma.announcement.deleteMany({ where: { id, clubId } });
}
```

Ajouter la méthode d'attache d'image (appelée par la route d'upload) :
```ts
/** Pose l'URL du fichier uploadé sur l'annonce (supprime l'ancien fichier). */
async setImage(id: string, clubId: string, imageUrl: string) {
  const found = await prisma.announcement.findUnique({ where: { id }, select: { clubId: true, imageUrl: true } });
  if (!found || found.clubId !== clubId) throw new Error('ANNOUNCEMENT_NOT_FOUND');
  deleteUploadedImage(found.imageUrl);
  return prisma.announcement.update({ where: { id }, data: { imageUrl } });
}
```

- [ ] **Step 4: Répertoire d'upload** — dans `backend/src/utils/uploads.ts` :

```ts
export const ANNOUNCEMENTS_DIR = path.join(UPLOADS_DIR, 'announcements'); // affiches d'annonces
export const CLUB_PHOTOS_DIR = path.join(UPLOADS_DIR, 'club-photos'); // galerie de présentation des clubs
```
Et dans `ensureUploadDirs()` : `fs.mkdirSync(ANNOUNCEMENTS_DIR, { recursive: true });` + `fs.mkdirSync(CLUB_PHOTOS_DIR, { recursive: true });` (les deux dès maintenant, la Task 4 utilise le second).

- [ ] **Step 5: Route d'upload dans `backend/src/routes/admin.ts`** (près des routes annonces, lignes ~513-525 ; multer/`EXT_BY_MIME`/`ensureUploadDirs` déjà importés pour le logo — sinon reprendre les imports de la route logo lignes ~529-609) :

```ts
const announcementImageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Image d'une annonce : upload (JPEG/PNG/WebP, 5 Mo max), remplace l'ancienne.
router.post('/announcements/:id/image', (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  announcementImageUpload.single('image')(req, res, async (err: unknown) => {
    try {
      if (err) {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          return void res.status(400).json({ error: 'Image trop lourde (5 Mo max)' });
        }
        return next(err as Error);
      }
      const file = req.file;
      const ext = file && EXT_BY_MIME[file.mimetype];
      if (!file || !ext) return void res.status(400).json({ error: 'Format d’image non supporté (JPEG, PNG ou WebP)' });
      ensureUploadDirs();
      const filename = `${asString(req.params.id)}-${Date.now()}.${ext}`;
      await fs.promises.writeFile(path.join(ANNOUNCEMENTS_DIR, filename), file.buffer);
      const ann = await announcementService.setImage(asString(req.params.id), req.membership!.clubId, `/uploads/announcements/${filename}`);
      res.json(ann);
    } catch (e) { handleError(e, res, next); }
  });
});
```
Ajouter `ANNOUNCEMENTS_DIR` à l'import de `../utils/uploads` dans admin.ts, et `ANNOUNCEMENT_NOT_FOUND: 404` à la table `ERROR_STATUS` d'admin.ts (bug préexistant : update/delete d'un id inconnu tombait en 500).

- [ ] **Step 6: Route publique** — dans `announcement.service.ts`, `listPublic` renvoie déjà toutes les colonnes (`findMany` sans select) → `kind`/`validUntil` exposés automatiquement. Rien à faire.

- [ ] **Step 7: Lancer les tests**

```bash
cd backend && node node_modules/jest/bin/jest.js announcement
```
Expected: PASS (anciens + nouveaux).

- [ ] **Step 8: Commit**

```bash
git add backend/src/services/announcement.service.ts backend/src/utils/uploads.ts backend/src/routes/admin.ts backend/src/services/__tests__/announcement.service.test.ts
git commit -m "feat(annonces): kind + validUntil + upload d'image d'affiche"
```

---

### Task 3: Migration `add_club_presentation` (ClubPhoto + champs Club)

**Files:**
- Create: `backend/prisma/migrations/20260705101000_add_club_presentation/migration.sql`
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1: SQL**

```sql
-- Présentation du club : texte long, contact, horaires, opt-in offres publiques, galerie photos.
ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "presentation_text" TEXT;
ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "contact_phone" TEXT;
ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "contact_email" TEXT;
ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "opening_hours_text" TEXT;
ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "show_offers_publicly" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "club_photos" (
  "id" TEXT NOT NULL,
  "club_id" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "caption" TEXT,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "club_photos_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "club_photos_club_id_idx" ON "club_photos"("club_id");
DO $$ BEGIN
  ALTER TABLE "club_photos" ADD CONSTRAINT "club_photos_club_id_fkey"
    FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

- [ ] **Step 2: Schéma Prisma** — dans le modèle `Club`, après `description` :

```prisma
  presentationText String?  @map("presentation_text")   // présentation longue (page « Le club »)
  contactPhone     String?  @map("contact_phone")
  contactEmail     String?  @map("contact_email")
  openingHoursText String?  @map("opening_hours_text")  // texte libre, ex. « Lun-Ven 8h-22h »
  // Opt-in : afficher les formules (abonnements + carnets) sur le Club-house public.
  showOffersPublicly Boolean @default(false) @map("show_offers_publicly")
```

Nouveau modèle (près d'`Announcement`) + relation inverse `photos ClubPhoto[]` dans `Club` :

```prisma
/// Photo de la galerie de présentation d'un club (page « Le club », max 12 côté service).
model ClubPhoto {
  id        String   @id @default(cuid())
  clubId    String   @map("club_id")
  url       String
  caption   String?
  sortOrder Int      @default(0) @map("sort_order")
  createdAt DateTime @default(now()) @map("created_at")

  club Club @relation(fields: [clubId], references: [id], onDelete: Cascade)

  @@index([clubId])
  @@map("club_photos")
}
```

- [ ] **Step 3: Appliquer + generate** (mêmes commandes que Task 1, avec le nouveau fichier). Expected: OK.

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260705101000_add_club_presentation/migration.sql
git commit -m "feat(club): migration add_club_presentation - ClubPhoto + presentation/contact/opt-in offres"
```

---

### Task 4: PresentationService + routes publiques & admin

**Files:**
- Create: `backend/src/services/presentation.service.ts`
- Modify: `backend/src/routes/clubs.ts` (route publique), `backend/src/routes/admin.ts` (routes admin), `backend/src/services/club.service.ts` (opt-in `showOffersPublicly`)
- Test: `backend/src/services/__tests__/presentation.service.test.ts` (créer, style des tests service existants)

- [ ] **Step 1: Tests qui échouent**

```ts
// Reprendre le harnais de mock prisma d'announcement.service.test.ts (jest.mock('../../db/prisma')).
import { PresentationService } from '../presentation.service';

describe('PresentationService', () => {
  it('getPublic renvoie présentation + photos triées, refuse club inconnu/suspendu', async () => {
    prismaMock.club.findUnique.mockResolvedValue({
      id: 'c1', status: 'ACTIVE', presentationText: 'Bienvenue', coverImageUrl: null,
      address: '1 rue', city: 'Paris', latitude: 48.8, longitude: 2.3,
      contactPhone: '01', contactEmail: 'a@b.fr', openingHoursText: '8h-22h',
    });
    prismaMock.clubPhoto.findMany.mockResolvedValue([{ id: 'p1', url: '/uploads/club-photos/x.jpg', caption: null, sortOrder: 0 }]);
    const r = await service.getPublic('slug');
    expect(r.presentationText).toBe('Bienvenue');
    expect(r.photos).toHaveLength(1);
    prismaMock.club.findUnique.mockResolvedValue(null);
    await expect(service.getPublic('nope')).rejects.toThrow('CLUB_NOT_FOUND');
  });
  it('addPhoto refuse au-delà de 12 photos (PHOTO_LIMIT_REACHED)', async () => {
    prismaMock.clubPhoto.count.mockResolvedValue(12);
    await expect(service.addPhoto('c1', '/uploads/club-photos/y.jpg')).rejects.toThrow('PHOTO_LIMIT_REACHED');
  });
  it('removePhoto scoped club (PHOTO_NOT_FOUND si autre club)', async () => {
    prismaMock.clubPhoto.findUnique.mockResolvedValue({ clubId: 'AUTRE', url: '/uploads/club-photos/z.jpg' });
    await expect(service.removePhoto('c1', 'p1')).rejects.toThrow('PHOTO_NOT_FOUND');
  });
});
```

- [ ] **Step 2: Run — FAIL attendu** (`node node_modules/jest/bin/jest.js presentation.service`).

- [ ] **Step 3: Implémenter `presentation.service.ts`**

```ts
import fs from 'fs';
import path from 'path';
import { prisma } from '../db/prisma';
import { CLUB_PHOTOS_DIR } from '../utils/uploads';

export const MAX_CLUB_PHOTOS = 12;

const PHOTO_SELECT = { id: true, url: true, caption: true, sortOrder: true } as const;

function deleteUploadedPhoto(url: string | null | undefined): void {
  if (url?.startsWith('/uploads/club-photos/')) {
    fs.promises.unlink(path.join(CLUB_PHOTOS_DIR, path.basename(url))).catch(() => {});
  }
}

export class PresentationService {
  /** Présentation publique d'un club ACTIF : texte, contact, horaires, galerie triée. */
  async getPublic(slug: string) {
    const club = await prisma.club.findUnique({
      where: { slug },
      select: {
        id: true, status: true, presentationText: true, coverImageUrl: true,
        address: true, city: true, latitude: true, longitude: true,
        contactPhone: true, contactEmail: true, openingHoursText: true,
      },
    });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    const photos = await prisma.clubPhoto.findMany({
      where: { clubId: club.id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: PHOTO_SELECT,
    });
    const { id: _id, status: _status, ...pub } = club;
    return { ...pub, photos };
  }

  /** Vue admin (par clubId, sans gate ACTIVE — le club édite même suspendu). */
  async getAdmin(clubId: string) {
    const club = await prisma.club.findUniqueOrThrow({
      where: { id: clubId },
      select: { presentationText: true, contactPhone: true, contactEmail: true, openingHoursText: true, coverImageUrl: true },
    });
    const photos = await prisma.clubPhoto.findMany({
      where: { clubId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: PHOTO_SELECT,
    });
    return { ...club, photos };
  }

  async updateText(clubId: string, data: { presentationText?: string | null; contactPhone?: string | null; contactEmail?: string | null; openingHoursText?: string | null }) {
    const norm = (v: string | null | undefined) => (v === undefined ? undefined : (v?.trim() || null));
    await prisma.club.update({
      where: { id: clubId },
      data: {
        ...(data.presentationText !== undefined ? { presentationText: norm(data.presentationText) } : {}),
        ...(data.contactPhone !== undefined ? { contactPhone: norm(data.contactPhone) } : {}),
        ...(data.contactEmail !== undefined ? { contactEmail: norm(data.contactEmail) } : {}),
        ...(data.openingHoursText !== undefined ? { openingHoursText: norm(data.openingHoursText) } : {}),
      },
    });
    return this.getAdmin(clubId);
  }

  async addPhoto(clubId: string, url: string, caption?: string) {
    const count = await prisma.clubPhoto.count({ where: { clubId } });
    if (count >= MAX_CLUB_PHOTOS) throw new Error('PHOTO_LIMIT_REACHED');
    return prisma.clubPhoto.create({
      data: { clubId, url, caption: caption?.trim() || null, sortOrder: count },
      select: PHOTO_SELECT,
    });
  }

  async updatePhoto(clubId: string, id: string, data: { caption?: string | null; sortOrder?: number }) {
    const found = await prisma.clubPhoto.findUnique({ where: { id }, select: { clubId: true } });
    if (!found || found.clubId !== clubId) throw new Error('PHOTO_NOT_FOUND');
    return prisma.clubPhoto.update({
      where: { id },
      data: {
        ...(data.caption !== undefined ? { caption: data.caption?.trim() || null } : {}),
        ...(typeof data.sortOrder === 'number' ? { sortOrder: data.sortOrder } : {}),
      },
      select: PHOTO_SELECT,
    });
  }

  async removePhoto(clubId: string, id: string) {
    const found = await prisma.clubPhoto.findUnique({ where: { id }, select: { clubId: true, url: true } });
    if (!found || found.clubId !== clubId) throw new Error('PHOTO_NOT_FOUND');
    deleteUploadedPhoto(found.url);
    await prisma.clubPhoto.delete({ where: { id } });
  }
}
```

- [ ] **Step 4: Route publique dans `clubs.ts`** (avant la route détail `/:slug`, avec les autres routes 2-segments) :

```ts
const presentationService = new PresentationService();

// Présentation publique du club (page « Le club » + teaser Club-house).
router.get('/:slug/presentation', async (req, res, next) => {
  try { res.json(await presentationService.getPublic(asString(req.params.slug))); }
  catch (err) { handleError(err, res, next); }
});
```

- [ ] **Step 5: Routes admin dans `admin.ts`** (gate `requireClubMember('ADMIN')` par route, comme les routes emails ; upload photo = même mécanique multer que Task 2 avec `CLUB_PHOTOS_DIR`, champ `photo`, nom de fichier `${req.membership!.clubId}-${Date.now()}.${ext}`) :

```ts
const presentationService = new PresentationService();
const clubPhotoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// --- Page club (présentation + galerie) — réservé ADMIN/OWNER ---
router.get('/presentation', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await presentationService.getAdmin(req.membership!.clubId)); } catch (e) { handleError(e, res, next); }
});
router.patch('/presentation', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await presentationService.updateText(req.membership!.clubId, req.body)); } catch (e) { handleError(e, res, next); }
});
router.post('/photos', requireClubMember('ADMIN'), (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  clubPhotoUpload.single('photo')(req, res, async (err: unknown) => {
    try {
      if (err) {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          return void res.status(400).json({ error: 'Image trop lourde (5 Mo max)' });
        }
        return next(err as Error);
      }
      const file = req.file;
      const ext = file && EXT_BY_MIME[file.mimetype];
      if (!file || !ext) return void res.status(400).json({ error: 'Format d’image non supporté (JPEG, PNG ou WebP)' });
      ensureUploadDirs();
      const filename = `${req.membership!.clubId}-${Date.now()}.${ext}`;
      await fs.promises.writeFile(path.join(CLUB_PHOTOS_DIR, filename), file.buffer);
      const photo = await presentationService.addPhoto(req.membership!.clubId, `/uploads/club-photos/${filename}`, req.body?.caption);
      res.status(201).json(photo);
    } catch (e) { handleError(e, res, next); }
  });
});
router.patch('/photos/:id', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await presentationService.updatePhoto(req.membership!.clubId, asString(req.params.id), req.body)); } catch (e) { handleError(e, res, next); }
});
router.delete('/photos/:id', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { await presentationService.removePhoto(req.membership!.clubId, asString(req.params.id)); res.json({ ok: true }); } catch (e) { handleError(e, res, next); }
});
```
Ajouter à `ERROR_STATUS` d'admin.ts : `PHOTO_LIMIT_REACHED: 409, PHOTO_NOT_FOUND: 404`. Import `CLUB_PHOTOS_DIR`.

- [ ] **Step 6: Opt-in `showOffersPublicly` dans `club.service.ts`** — 3 points (pattern `listTournamentsNationally`) :
  1. Signature `updateClub` params : `showOffersPublicly?: boolean;`
  2. Spread `data` : `...(typeof params.showOffersPublicly === 'boolean' ? { showOffersPublicly: params.showOffersPublicly } : {}),`
  3. `select` de `getClubForAdmin` : `showOffersPublicly: true,`

- [ ] **Step 7: Run tests + tsc**

```bash
cd backend && node node_modules/jest/bin/jest.js presentation.service && node node_modules/typescript/bin/tsc --noEmit
```
Expected: PASS / 0 erreur.

- [ ] **Step 8: Commit**

```bash
git add backend/src/services/presentation.service.ts backend/src/routes/clubs.ts backend/src/routes/admin.ts backend/src/services/club.service.ts backend/src/services/__tests__/presentation.service.test.ts
git commit -m "feat(club): presentation publique + galerie photos (max 12) + opt-in offres"
```

---

### Task 5: OfferService — vitrine publique des formules

**Files:**
- Create: `backend/src/services/offer.service.ts`
- Modify: `backend/src/routes/clubs.ts`
- Test: `backend/src/services/__tests__/offer.service.test.ts`

- [ ] **Step 1: Tests qui échouent**

```ts
import { OfferService } from '../offer.service';

describe('OfferService.listPublicOffers', () => {
  it('opt-out → listes vides sans énumération', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'c1', status: 'ACTIVE', showOffersPublicly: false, stripeAccountId: null, stripeAccountStatus: 'NONE' });
    expect(await service.listPublicOffers('slug')).toEqual({ plans: [], packages: [], onlinePurchase: false });
  });
  it('opt-in → plans + packages actifs, onlinePurchase reflète Stripe ACTIVE', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'c1', status: 'ACTIVE', showOffersPublicly: true, stripeAccountId: 'acct_1', stripeAccountStatus: 'ACTIVE' });
    prismaMock.subscriptionPlan.findMany.mockResolvedValue([{ id: 'pl1', name: 'Or', monthlyPrice: '39', commitmentMonths: 12 }]);
    prismaMock.packageTemplate.findMany.mockResolvedValue([{ id: 'tp1', name: 'Carnet 10', kind: 'ENTRIES', price: '90' }]);
    const r = await service.listPublicOffers('slug');
    expect(r.plans).toHaveLength(1);
    expect(r.packages).toHaveLength(1);
    expect(r.onlinePurchase).toBe(true);
    expect(prismaMock.subscriptionPlan.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { clubId: 'c1', isActive: true } }));
  });
  it('club suspendu → CLUB_NOT_FOUND', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'c1', status: 'SUSPENDED' });
    await expect(service.listPublicOffers('slug')).rejects.toThrow('CLUB_NOT_FOUND');
  });
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implémenter `offer.service.ts`** (la partie achat arrive en Task 6-7 — créer déjà la classe) :

```ts
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { PackageService } from './package.service';
import { StripeService } from './stripe.service';

/** Metadata posée sur les PaymentIntents d'achat d'offre (plan ou carnet). */
export interface OfferIntentMeta {
  offerPlanId?: string;
  offerPackageTemplateId?: string;
  offerUserId?: string;
  clubId?: string;
}

export class OfferService {
  /** Vitrine publique : formules actives si le club a opté, drapeau achat en ligne. */
  async listPublicOffers(slug: string) {
    const club = await prisma.club.findUnique({
      where: { slug },
      select: { id: true, status: true, showOffersPublicly: true, stripeAccountId: true, stripeAccountStatus: true },
    });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    if (!club.showOffersPublicly) return { plans: [], packages: [], onlinePurchase: false };
    const [plans, packages] = await Promise.all([
      prisma.subscriptionPlan.findMany({
        where: { clubId: club.id, isActive: true },
        orderBy: { monthlyPrice: 'asc' },
        select: { id: true, name: true, monthlyPrice: true, commitmentMonths: true, offPeakOnly: true, benefit: true, discountPercent: true, dailyCap: true, weeklyCap: true, sportKeys: true },
      }),
      prisma.packageTemplate.findMany({
        where: { clubId: club.id, isActive: true },
        orderBy: { price: 'asc' },
        select: { id: true, name: true, kind: true, price: true, entriesCount: true, walletAmount: true, validityDays: true },
      }),
    ]);
    const onlinePurchase = !!club.stripeAccountId && club.stripeAccountStatus === 'ACTIVE';
    return { plans, packages, onlinePurchase };
  }
}
```

- [ ] **Step 4: Route publique dans `clubs.ts`** :

```ts
const offerService = new OfferService();

// Formules du club (abonnements + carnets) — vide si le club n'a pas opté.
router.get('/:slug/offers', async (req, res, next) => {
  try { res.json(await offerService.listPublicOffers(asString(req.params.slug))); }
  catch (err) { handleError(err, res, next); }
});
```

- [ ] **Step 5: Run + commit**

```bash
cd backend && node node_modules/jest/bin/jest.js offer.service
git add backend/src/services/offer.service.ts backend/src/routes/clubs.ts backend/src/services/__tests__/offer.service.test.ts
git commit -m "feat(offres): vitrine publique des formules (opt-in club)"
```

---

### Task 6: Stripe — intents d'achat d'offre

**Files:**
- Modify: `backend/src/services/stripe.service.ts`
- Modify: `backend/src/routes/clubs.ts` (2 routes intent)
- Test: `backend/src/services/__tests__/stripe.service.test.ts` (étendre, style des tests `createRegistrationPaymentIntent`)

- [ ] **Step 1: Test qui échoue** (reprendre le harnais de mock Stripe du fichier existant) :

```ts
it('createOfferPaymentIntent pose la metadata offerPlanId/offerUserId et la CustomerSession', async () => {
  prismaMock.club.findUnique.mockResolvedValue({ stripeAccountId: 'acct_1', stripeAccountStatus: 'ACTIVE' });
  // mock createOrGetCustomer via prismaMock.clubStripeCustomer + stripe.customers comme les tests existants
  const r = await service.createOfferPaymentIntent({ clubId: 'c1', userId: 'u1', kind: 'plan', offerId: 'pl1', amountCents: 3900 });
  expect(stripeMock.paymentIntents.create).toHaveBeenCalledWith(
    expect.objectContaining({ amount: 3900, metadata: { offerPlanId: 'pl1', offerUserId: 'u1', clubId: 'c1' } }),
    { stripeAccount: 'acct_1' },
  );
  expect(r.clientSecret).toBeTruthy();
});
it('createOfferPaymentIntent refuse si Stripe non ACTIVE', async () => {
  prismaMock.club.findUnique.mockResolvedValue({ stripeAccountId: 'acct_1', stripeAccountStatus: 'PENDING' });
  await expect(service.createOfferPaymentIntent({ clubId: 'c1', userId: 'u1', kind: 'package', offerId: 'tp1', amountCents: 900 }))
    .rejects.toThrow('STRIPE_NOT_CONFIGURED');
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implémenter dans `stripe.service.ts`** (calque de `createRegistrationPaymentIntent`, lignes ~184-212) :

```ts
/** PaymentIntent d'achat d'offre (abonnement 1re mensualité ou carnet), metadata pour le webhook. */
async createOfferPaymentIntent(params: {
  clubId: string; userId: string; kind: 'plan' | 'package'; offerId: string; amountCents: number;
}): Promise<{ clientSecret: string; customerSessionClientSecret: string | null }> {
  const club = await prisma.club.findUnique({
    where: { id: params.clubId }, select: { stripeAccountId: true, stripeAccountStatus: true },
  });
  if (!club?.stripeAccountId || club.stripeAccountStatus !== 'ACTIVE') throw new Error('STRIPE_NOT_CONFIGURED');
  const customer = await this.createOrGetCustomer(params.clubId, params.userId);
  const pi = await stripe.paymentIntents.create(
    {
      amount: params.amountCents, currency: 'eur', customer: customer.stripeCustomerId,
      payment_method_types: ['card'],
      metadata: {
        [params.kind === 'plan' ? 'offerPlanId' : 'offerPackageTemplateId']: params.offerId,
        offerUserId: params.userId,
        clubId: params.clubId,
      },
    },
    { stripeAccount: club.stripeAccountId },
  );
  if (!pi.client_secret) throw new Error('STRIPE_ERROR');
  const customerSessionClientSecret = await this.buildCustomerSession(club.stripeAccountId, customer.stripeCustomerId);
  return { clientSecret: pi.client_secret, customerSessionClientSecret };
}

/** Relit un PaymentIntent sur le compte connecté (vérif statut à la confirmation client). */
async retrievePaymentIntent(id: string, stripeAccountId: string) {
  return stripe.paymentIntents.retrieve(id, {}, { stripeAccount: stripeAccountId });
}
```

- [ ] **Step 4: Routes intent dans `clubs.ts`** (imports à ajouter : `ensureActiveMembership` depuis `../services/membership`, `entryFeeCents, MIN_STRIPE_CENTS` depuis `../services/registrationPayment`, `StripeService` ; `authMiddleware` déjà importé) :

```ts
const offerStripe = new StripeService();

// Achat en ligne d'une formule : PaymentIntent (auth requis, adhésion créée à la volée).
router.post('/:slug/offers/plans/:id/intent', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const slug = asString(req.params.slug);
    const { id: clubId } = await ensureActiveMembership(slug, req.user!.id);
    const club = await prisma.club.findUnique({ where: { id: clubId }, select: { showOffersPublicly: true, stripeAccountId: true } });
    if (!club?.showOffersPublicly) return void res.status(404).json({ error: 'OFFER_NOT_FOUND' });
    const plan = await prisma.subscriptionPlan.findUnique({ where: { id: asString(req.params.id) } });
    if (!plan || plan.clubId !== clubId || !plan.isActive) return void res.status(404).json({ error: 'OFFER_NOT_FOUND' });
    const amountCents = entryFeeCents(plan.monthlyPrice);
    if (amountCents < MIN_STRIPE_CENTS) return void res.status(400).json({ error: 'AMOUNT_TOO_SMALL' });
    const r = await offerStripe.createOfferPaymentIntent({ clubId, userId: req.user!.id, kind: 'plan', offerId: plan.id, amountCents });
    res.json({ ...r, type: 'payment', stripeAccountId: club.stripeAccountId });
  } catch (err) { handleError(err, res, next); }
});

router.post('/:slug/offers/packages/:id/intent', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const slug = asString(req.params.slug);
    const { id: clubId } = await ensureActiveMembership(slug, req.user!.id);
    const club = await prisma.club.findUnique({ where: { id: clubId }, select: { showOffersPublicly: true, stripeAccountId: true } });
    if (!club?.showOffersPublicly) return void res.status(404).json({ error: 'OFFER_NOT_FOUND' });
    const tpl = await prisma.packageTemplate.findUnique({ where: { id: asString(req.params.id) } });
    if (!tpl || tpl.clubId !== clubId || !tpl.isActive) return void res.status(404).json({ error: 'OFFER_NOT_FOUND' });
    const amountCents = entryFeeCents(tpl.price);
    if (amountCents < MIN_STRIPE_CENTS) return void res.status(400).json({ error: 'AMOUNT_TOO_SMALL' });
    const r = await offerStripe.createOfferPaymentIntent({ clubId, userId: req.user!.id, kind: 'package', offerId: tpl.id, amountCents });
    res.json({ ...r, type: 'payment', stripeAccountId: club.stripeAccountId });
  } catch (err) { handleError(err, res, next); }
});
```
Ajouter à `ERROR_STATUS` de clubs.ts (si absents) : `OFFER_NOT_FOUND: 404, AMOUNT_TOO_SMALL: 400, STRIPE_NOT_CONFIGURED: 409, NOT_PAYABLE: 409, MEMBERSHIP_BLOCKED: 403, UNAUTHORIZED: 403`.

- [ ] **Step 5: Run + commit**

```bash
cd backend && node node_modules/jest/bin/jest.js stripe.service
git add backend/src/services/stripe.service.ts backend/src/routes/clubs.ts backend/src/services/__tests__/stripe.service.test.ts
git commit -m "feat(offres): PaymentIntent d'achat d'offre (plan/carnet) + routes intent"
```

---

### Task 7: Fulfillment idempotent + confirm + webhook

**Files:**
- Modify: `backend/src/services/offer.service.ts`, `backend/src/routes/clubs.ts`, `backend/src/routes/stripe-webhooks.ts`
- Test: `backend/src/services/__tests__/offer.service.test.ts` (étendre)

- [ ] **Step 1: Tests qui échouent**

```ts
describe('OfferService.fulfillPaidIntent', () => {
  const meta = { offerPlanId: 'pl1', offerUserId: 'u1', clubId: 'c1' };
  it('crée Subscription (snapshot) + Payment ONLINE avec receiptNo', async () => {
    // $transaction mock : exécute le callback avec tx = prismaMock (pattern des tests tournament.service)
    prismaMock.payment.findFirst.mockResolvedValue(null);
    prismaMock.subscriptionPlan.findUnique.mockResolvedValue({
      id: 'pl1', clubId: 'c1', isActive: true, name: 'Or', monthlyPrice: '39',
      commitmentMonths: 12, sportKeys: ['padel'], offPeakOnly: true, benefit: 'INCLUDED',
      discountPercent: null, dailyCap: null, weeklyCap: null,
    });
    prismaMock.clubCounter.upsert.mockResolvedValue({ value: 7 });
    prismaMock.subscription.create.mockResolvedValue({ id: 'sub1' });
    prismaMock.payment.create.mockResolvedValue({ id: 'pay1' });
    const r = await service.fulfillPaidIntent(meta, 'pi_1', 3900);
    expect(r).toEqual({ kind: 'plan', id: 'sub1' });
    expect(prismaMock.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ method: 'ONLINE', status: 'CAPTURED', stripePaymentIntentId: 'pi_1', receiptNo: 7, subscriptionId: 'sub1' }),
    }));
  });
  it('idempotent : Payment existant pour ce PaymentIntent → null, rien créé', async () => {
    prismaMock.payment.findFirst.mockResolvedValue({ id: 'pay1' });
    expect(await service.fulfillPaidIntent(meta, 'pi_1', 3900)).toBeNull();
    expect(prismaMock.subscription.create).not.toHaveBeenCalled();
  });
  it('carnet : crée MemberPackage avec crédits + expiration validityDays', async () => {
    prismaMock.payment.findFirst.mockResolvedValue(null);
    prismaMock.packageTemplate.findUnique.mockResolvedValue({
      id: 'tp1', clubId: 'c1', isActive: true, name: 'Carnet 10', kind: 'ENTRIES',
      price: '90', entriesCount: 10, walletAmount: null, validityDays: 365,
    });
    prismaMock.clubCounter.upsert.mockResolvedValue({ value: 8 });
    prismaMock.memberPackage.create.mockResolvedValue({ id: 'pkg1' });
    prismaMock.payment.create.mockResolvedValue({ id: 'pay2' });
    const r = await service.fulfillPaidIntent({ offerPackageTemplateId: 'tp1', offerUserId: 'u1', clubId: 'c1' }, 'pi_2', 9000);
    expect(r).toEqual({ kind: 'package', id: 'pkg1' });
    expect(prismaMock.memberPackage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ creditsTotal: 10, creditsRemaining: 10 }),
    }));
  });
  it('plan désactivé entre intent et confirm → OFFER_NOT_FOUND', async () => {
    prismaMock.payment.findFirst.mockResolvedValue(null);
    prismaMock.subscriptionPlan.findUnique.mockResolvedValue({ id: 'pl1', clubId: 'c1', isActive: false });
    await expect(service.fulfillPaidIntent(meta, 'pi_3', 3900)).rejects.toThrow('OFFER_NOT_FOUND');
  });
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implémenter dans `offer.service.ts`**

```ts
/** Crée l'achat (Subscription ou MemberPackage + Payment ONLINE) depuis un PaymentIntent réussi.
 *  Idempotent par stripePaymentIntentId — appelé par le client ET le webhook. */
async fulfillPaidIntent(meta: OfferIntentMeta, stripePaymentIntentId: string, amountCents: number) {
  const userId = meta.offerUserId;
  const clubId = meta.clubId;
  if (!userId || !clubId || (!meta.offerPlanId && !meta.offerPackageTemplateId)) throw new Error('VALIDATION_ERROR');
  return prisma.$transaction(async (tx) => {
    const existing = await tx.payment.findFirst({ where: { stripePaymentIntentId }, select: { id: true } });
    if (existing) return null; // déjà traité (client OU webhook)
    const receiptNo = await PackageService.nextReceiptNo(tx, clubId);
    const amount = new Prisma.Decimal(amountCents).div(100);

    if (meta.offerPlanId) {
      const plan = await tx.subscriptionPlan.findUnique({ where: { id: meta.offerPlanId } });
      if (!plan || plan.clubId !== clubId || !plan.isActive) throw new Error('OFFER_NOT_FOUND');
      const expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + plan.commitmentMonths);
      const sub = await tx.subscription.create({
        data: {
          clubId, userId, planId: plan.id, status: 'ACTIVE', expiresAt,
          monthlyPriceSnapshot: plan.monthlyPrice,
          sportKeys: plan.sportKeys, offPeakOnly: plan.offPeakOnly, benefit: plan.benefit,
          discountPercent: plan.discountPercent, dailyCap: plan.dailyCap, weeklyCap: plan.weeklyCap,
        },
      });
      await tx.payment.create({
        data: {
          clubId, subscriptionId: sub.id, amount, method: 'ONLINE', status: 'CAPTURED',
          stripePaymentIntentId, receiptNo, note: `Vente abonnement ${plan.name} — 1re mensualité (en ligne)`,
        },
      });
      return { kind: 'plan' as const, id: sub.id };
    }

    const tpl = await tx.packageTemplate.findUnique({ where: { id: meta.offerPackageTemplateId! } });
    if (!tpl || tpl.clubId !== clubId || !tpl.isActive) throw new Error('OFFER_NOT_FOUND');
    const expiresAt = tpl.validityDays ? new Date(Date.now() + tpl.validityDays * 86_400_000) : null;
    const pkg = await tx.memberPackage.create({
      data: {
        clubId, userId, templateId: tpl.id, kind: tpl.kind,
        creditsTotal: tpl.kind === 'ENTRIES' ? tpl.entriesCount : null,
        creditsRemaining: tpl.kind === 'ENTRIES' ? tpl.entriesCount : null,
        amountTotal: tpl.kind === 'WALLET' ? tpl.walletAmount : null,
        amountRemaining: tpl.kind === 'WALLET' ? tpl.walletAmount : null,
        expiresAt,
      },
    });
    await tx.payment.create({
      data: {
        clubId, memberPackageId: pkg.id, amount, method: 'ONLINE', status: 'CAPTURED',
        stripePaymentIntentId, receiptNo, note: `Vente ${tpl.name} (en ligne)`,
      },
    });
    return { kind: 'package' as const, id: pkg.id };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 });
}

/** Confirmation côté client : vérifie le PaymentIntent auprès de Stripe puis délègue. */
async confirmFromClient(slug: string, userId: string, stripePaymentIntentId: string) {
  const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, status: true, stripeAccountId: true } });
  if (!club || club.status !== 'ACTIVE' || !club.stripeAccountId) throw new Error('CLUB_NOT_FOUND');
  const pi = await new StripeService().retrievePaymentIntent(stripePaymentIntentId, club.stripeAccountId);
  if (!pi || pi.status !== 'succeeded') throw new Error('NOT_PAYABLE');
  const meta = (pi.metadata ?? {}) as OfferIntentMeta;
  if (meta.offerUserId !== userId || meta.clubId !== club.id) throw new Error('UNAUTHORIZED');
  await this.fulfillPaidIntent(meta, pi.id, pi.amount);
  return { ok: true };
}
```

- [ ] **Step 4: Route confirm dans `clubs.ts`**

```ts
// Confirmation client d'un achat d'offre (le webhook fait le même travail — idempotent).
router.post('/:slug/offers/confirm', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { stripePaymentIntentId } = req.body ?? {};
    if (!stripePaymentIntentId) return void res.status(400).json({ error: 'VALIDATION_ERROR' });
    res.json(await offerService.confirmFromClient(asString(req.params.slug), req.user!.id, asString(stripePaymentIntentId)));
  } catch (err) { handleError(err, res, next); }
});
```

- [ ] **Step 5: Webhook** — dans `stripe-webhooks.ts`, case `payment_intent.succeeded`, étendre le cast avec `amount: number` et ajouter AVANT les branches registrations :

```ts
if (pi.metadata?.offerPlanId || pi.metadata?.offerPackageTemplateId) {
  try {
    await new OfferService().fulfillPaidIntent(pi.metadata as OfferIntentMeta, pi.id, pi.amount);
  } catch { /* idempotent / OFFER_NOT_FOUND loggué par le catch global — remboursement manuel */ }
  break;
}
```
Import : `import { OfferService, OfferIntentMeta } from '../services/offer.service';`.

- [ ] **Step 6: Run + tsc + commit**

```bash
cd backend && node node_modules/jest/bin/jest.js offer.service && node node_modules/typescript/bin/tsc --noEmit
git add backend/src/services/offer.service.ts backend/src/routes/clubs.ts backend/src/routes/stripe-webhooks.ts backend/src/services/__tests__/offer.service.test.ts
git commit -m "feat(offres): fulfillment idempotent achat en ligne (confirm client + webhook)"
```

---

### Task 8: Top du mois

**Files:**
- Modify: `backend/src/services/club.service.ts`, `backend/src/routes/clubs.ts`
- Test: `backend/src/services/__tests__/club.service.test.ts` (étendre)

- [ ] **Step 1: Tests qui échouent**

```ts
describe('clubTopOfMonth', () => {
  it('agrège les victoires du mois courant et renvoie le top 3', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'c1', status: 'ACTIVE', timezone: 'Europe/Paris' });
    const mk = (userId: string, team: number, winningTeam: number, name: string) => ({
      userId, team, match: { winningTeam },
      user: { firstName: name, lastName: 'X', avatarUrl: null },
    });
    prismaMock.matchPlayer.findMany.mockResolvedValue([
      mk('u1', 1, 1, 'Ana'), mk('u1', 1, 1, 'Ana'), mk('u1', 2, 1, 'Ana'), // 2 victoires
      mk('u2', 1, 1, 'Bob'), mk('u2', 2, 2, 'Bob'), mk('u2', 1, 1, 'Bob'), // 3 victoires
      mk('u3', 2, 2, 'Cléo'),                                              // 1 victoire
      mk('u4', 1, 2, 'Dan'),                                               // 0 victoire
    ]);
    const top = await service.clubTopOfMonth('slug');
    expect(top.map((t) => [t.userId, t.wins])).toEqual([['u2', 3], ['u1', 2], ['u3', 1]]);
    // fenêtre mensuelle passée au filtre playedAt
    expect(prismaMock.matchPlayer.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        match: expect.objectContaining({ clubId: 'c1', status: 'CONFIRMED', playedAt: expect.objectContaining({ gte: expect.any(Date), lt: expect.any(Date) }) }),
      }),
    }));
  });
  it('moins de 3 joueurs avec une victoire → liste vide (section masquée)', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'c1', status: 'ACTIVE', timezone: 'Europe/Paris' });
    prismaMock.matchPlayer.findMany.mockResolvedValue([
      { userId: 'u1', team: 1, match: { winningTeam: 1 }, user: { firstName: 'A', lastName: 'B', avatarUrl: null } },
    ]);
    expect(await service.clubTopOfMonth('slug')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implémenter dans `club.service.ts`** (Luxon : ajouter `import { DateTime } from 'luxon';` si absent) :

```ts
/** Top 3 du mois : joueurs du club par victoires sur matchs CONFIRMED du mois calendaire
 *  courant (fuseau club). Vide si moins de 3 joueurs ont au moins 1 victoire. */
async clubTopOfMonth(slug: string) {
  const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, status: true, timezone: true } });
  if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
  const monthStart = DateTime.now().setZone(club.timezone).startOf('month');
  const rows = await prisma.matchPlayer.findMany({
    where: {
      match: {
        clubId: club.id, status: 'CONFIRMED', winningTeam: { not: null },
        playedAt: { gte: monthStart.toJSDate(), lt: monthStart.plus({ months: 1 }).toJSDate() },
      },
    },
    select: {
      userId: true, team: true,
      match: { select: { winningTeam: true } },
      user: { select: { firstName: true, lastName: true, avatarUrl: true } },
    },
  });
  const byUser = new Map<string, { userId: string; firstName: string; lastName: string; avatarUrl: string | null; wins: number }>();
  for (const r of rows) {
    if (r.match.winningTeam !== r.team) continue;
    const cur = byUser.get(r.userId) ?? { userId: r.userId, firstName: r.user.firstName, lastName: r.user.lastName, avatarUrl: r.user.avatarUrl, wins: 0 };
    cur.wins += 1;
    byUser.set(r.userId, cur);
  }
  const top = [...byUser.values()].sort((a, b) => b.wins - a.wins).slice(0, 3);
  return top.length >= 3 ? top : [];
}
```

- [ ] **Step 4: Route publique dans `clubs.ts`** (avant `/:slug` détail) :

```ts
// Top du mois : podium 3 joueurs par victoires (public, vide si < 3 joueurs).
router.get('/:slug/top-month', async (req, res, next) => {
  try { res.json(await clubService.clubTopOfMonth(asString(req.params.slug))); }
  catch (err) { handleError(err, res, next); }
});
```

- [ ] **Step 5: Run + commit**

```bash
cd backend && node node_modules/jest/bin/jest.js club.service -t "clubTopOfMonth"
git add backend/src/services/club.service.ts backend/src/routes/clubs.ts backend/src/services/__tests__/club.service.test.ts
git commit -m "feat(club-house): endpoint public top du mois (victoires matchs confirmes)"
```

---

### Task 9: Frontend — lib/api.ts + lib/clubhouse.ts + authGate

**Files:**
- Modify: `frontend/lib/api.ts`, `frontend/lib/clubhouse.ts`, `frontend/lib/authGate.ts`
- Test: `frontend/__tests__/clubhouse.test.ts` (étendre), `frontend/__tests__/authGate.test.ts` (étendre)

- [ ] **Step 1: Tests helpers qui échouent** (dans `clubhouse.test.ts`) :

```ts
import { activePosters, posterLayout } from '@/lib/clubhouse';

const ann = (over: Partial<Announcement>): Announcement => ({
  id: 'a', title: 't', body: 'b', linkUrl: null, imageUrl: null, isPublished: true,
  pinned: false, kind: 'INFO', validUntil: null, createdAt: '', updatedAt: '', ...over,
});

describe('activePosters', () => {
  const now = new Date('2026-07-05T12:00:00Z');
  it('garde les annonces avec image non expirées, exclut le hero, plafond 5', () => {
    const list = [
      ann({ id: 'hero', imageUrl: '/u/h.jpg', pinned: true }),
      ann({ id: 'ok', imageUrl: '/u/1.jpg' }),
      ann({ id: 'expired', imageUrl: '/u/2.jpg', validUntil: '2026-07-01T23:59:59.999Z' }),
      ann({ id: 'noimg' }),
      ...[3, 4, 5, 6, 7, 8].map((i) => ann({ id: `p${i}`, imageUrl: `/u/${i}.jpg` })),
    ];
    const out = activePosters(list, now, 'hero');
    expect(out.map((a) => a.id)).toEqual(['ok', 'p3', 'p4', 'p5', 'p6']);
  });
});

describe('posterLayout', () => {
  it('single / duo / bento', () => {
    expect(posterLayout(1)).toBe('single');
    expect(posterLayout(2)).toBe('duo');
    expect(posterLayout(3)).toBe('bento');
    expect(posterLayout(5)).toBe('bento');
  });
});
```

Dans `authGate.test.ts` : `expect(isPublicPath('/club')).toBe(true);`.

- [ ] **Step 2: Run — FAIL** (`cd frontend && node node_modules/jest/bin/jest.js clubhouse authGate`).

- [ ] **Step 3: `lib/clubhouse.ts`** — ajouter :

```ts
/** Affiches actives : annonces AVEC image, non expirées, hors hero épinglé, plafond 5. */
export function activePosters(anns: Announcement[], now: Date, heroId: string | null = null): Announcement[] {
  return anns
    .filter((a) => a.imageUrl && a.id !== heroId && (!a.validUntil || new Date(a.validUntil) > now))
    .slice(0, 5);
}

export type PosterLayout = 'single' | 'duo' | 'bento';

/** Forme de la mosaïque selon le nombre d'affiches. */
export function posterLayout(n: number): PosterLayout {
  return n <= 1 ? 'single' : n === 2 ? 'duo' : 'bento';
}

/** Annonce expirée (masquée partout : hero, bento, liste texte). */
export function announcementExpired(a: Pick<Announcement, 'validUntil'>, now: Date): boolean {
  return !!a.validUntil && new Date(a.validUntil) <= now;
}
```
(import `Announcement` depuis `./api`.)

- [ ] **Step 4: `lib/authGate.ts`** — ajouter `'/club',` à `PUBLIC_PATHS`.

- [ ] **Step 5: `lib/api.ts`** — types (près d'`Announcement`) :

```ts
export type AnnouncementKind = 'INFO' | 'OFFER' | 'TOURNAMENT' | 'EVENT';
// Étendre l'interface Announcement existante avec :
//   kind: AnnouncementKind;
//   validUntil: string | null;
// Étendre AnnouncementBody avec : kind: AnnouncementKind; validUntil: string | null;

export interface ClubPhoto { id: string; url: string; caption: string | null; sortOrder: number; }

export interface ClubPresentation {
  presentationText: string | null;
  coverImageUrl: string | null;
  address: string; city: string | null;
  latitude: number | null; longitude: number | null;
  contactPhone: string | null; contactEmail: string | null;
  openingHoursText: string | null;
  photos: ClubPhoto[];
}

export interface PublicPlan {
  id: string; name: string; monthlyPrice: string; commitmentMonths: number;
  offPeakOnly: boolean; benefit: 'INCLUDED' | 'DISCOUNT'; discountPercent: number | null;
  dailyCap: number | null; weeklyCap: number | null; sportKeys: string[];
}
export interface PublicPackageTemplate {
  id: string; name: string; kind: 'ENTRIES' | 'WALLET'; price: string;
  entriesCount: number | null; walletAmount: string | null; validityDays: number | null;
}
export interface PublicOffers { plans: PublicPlan[]; packages: PublicPackageTemplate[]; onlinePurchase: boolean; }

export interface TopMonthEntry { userId: string; firstName: string; lastName: string; avatarUrl: string | null; wins: number; }
```

Méthodes (dans l'objet `api`) :

```ts
getClubPresentation: (slug: string) => request<ClubPresentation>(`/api/clubs/${encodeURIComponent(slug)}/presentation`),
getClubOffers: (slug: string) => request<PublicOffers>(`/api/clubs/${encodeURIComponent(slug)}/offers`),
getClubTopMonth: (slug: string) => request<TopMonthEntry[]>(`/api/clubs/${encodeURIComponent(slug)}/top-month`),
createOfferPlanIntent: (slug: string, planId: string, token: string) =>
  request<{ clientSecret: string; stripeAccountId: string | null; customerSessionClientSecret: string | null; type: 'payment' }>(
    `/api/clubs/${encodeURIComponent(slug)}/offers/plans/${planId}/intent`, { method: 'POST' }, token),
createOfferPackageIntent: (slug: string, templateId: string, token: string) =>
  request<{ clientSecret: string; stripeAccountId: string | null; customerSessionClientSecret: string | null; type: 'payment' }>(
    `/api/clubs/${encodeURIComponent(slug)}/offers/packages/${templateId}/intent`, { method: 'POST' }, token),
confirmOfferPayment: (slug: string, stripePaymentIntentId: string, token: string) =>
  request<{ ok: boolean }>(`/api/clubs/${encodeURIComponent(slug)}/offers/confirm`,
    { method: 'POST', body: JSON.stringify({ stripePaymentIntentId }) }, token),
adminGetPresentation: (clubId: string, token: string) =>
  request<ClubPresentation>(`/api/clubs/${clubId}/admin/presentation`, {}, token),
adminUpdatePresentation: (clubId: string, body: Partial<Pick<ClubPresentation, 'presentationText' | 'contactPhone' | 'contactEmail' | 'openingHoursText'>>, token: string) =>
  request<ClubPresentation>(`/api/clubs/${clubId}/admin/presentation`, { method: 'PATCH', body: JSON.stringify(body) }, token),
adminUpdateClubPhoto: (clubId: string, id: string, body: { caption?: string | null; sortOrder?: number }, token: string) =>
  request<ClubPhoto>(`/api/clubs/${clubId}/admin/photos/${id}`, { method: 'PATCH', body: JSON.stringify(body) }, token),
adminDeleteClubPhoto: (clubId: string, id: string, token: string) =>
  request<{ ok: boolean }>(`/api/clubs/${clubId}/admin/photos/${id}`, { method: 'DELETE' }, token),
// Uploads FormData (pattern uploadMyAvatar — fetch dédié, pas request()) :
adminUploadAnnouncementImage: async (clubId: string, id: string, file: File, token: string): Promise<Announcement> => {
  const form = new FormData();
  form.append('image', file);
  const res = await fetch(`${BASE_URL}/api/clubs/${clubId}/admin/announcements/${id}/image`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
},
adminAddClubPhoto: async (clubId: string, file: File, caption: string | undefined, token: string): Promise<ClubPhoto> => {
  const form = new FormData();
  form.append('photo', file);
  if (caption) form.append('caption', caption);
  const res = await fetch(`${BASE_URL}/api/clubs/${clubId}/admin/photos`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
},
```
Ajouter aussi `showOffersPublicly: boolean;` au type `ClubAdminDetail` (près de `listTournamentsNationally`).

- [ ] **Step 6: Run + tsc**

```bash
cd frontend && node node_modules/jest/bin/jest.js clubhouse authGate && node node_modules/typescript/bin/tsc --noEmit
```
Expected: PASS / 0 erreur (dans les fichiers touchés — WIP parallèle possible ailleurs, filtrer au grep).

- [ ] **Step 7: Commit**

```bash
git add frontend/lib/api.ts frontend/lib/clubhouse.ts frontend/lib/authGate.ts frontend/__tests__/clubhouse.test.ts frontend/__tests__/authGate.test.ts
git commit -m "feat(front): types+methodes API club-house v2, helpers affiches, /club public"
```

---

### Task 10: `PosterMosaic` (bento + lightbox)

**Files:**
- Create: `frontend/components/clubhouse/PosterMosaic.tsx`
- Test: `frontend/__tests__/PosterMosaic.test.tsx`

- [ ] **Step 1: Tests qui échouent**

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { PosterMosaic } from '@/components/clubhouse/PosterMosaic';
import type { Announcement } from '@/lib/api';

jest.mock('@/lib/api', () => ({ ...jest.requireActual('@/lib/api'), assetUrl: (p: string | null) => p }));

const poster = (over: Partial<Announcement>): Announcement => ({
  id: 'a1', title: 'Open P250', body: 'Corps', linkUrl: null, imageUrl: '/uploads/announcements/a.jpg',
  isPublished: true, pinned: false, kind: 'TOURNAMENT', validUntil: null, createdAt: '', updatedAt: '', ...over,
});

describe('PosterMosaic', () => {
  it('rend rien sans affiche', () => {
    const { container } = render(<PosterMosaic posters={[]} />);
    expect(container.firstChild).toBeNull();
  });
  it('1 affiche = pleine largeur, chip du type, clic → lightbox avec image entière', () => {
    render(<PosterMosaic posters={[poster({})]} />);
    expect(screen.getByTestId('poster-grid')).toHaveAttribute('data-layout', 'single');
    expect(screen.getByText('Tournoi')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Open P250/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('3 affiches = bento, lien « En savoir plus » dans la lightbox si linkUrl', () => {
    render(<PosterMosaic posters={[poster({ id: 'a1', linkUrl: 'https://x.fr' }), poster({ id: 'a2' }), poster({ id: 'a3' })]} />);
    expect(screen.getByTestId('poster-grid')).toHaveAttribute('data-layout', 'bento');
    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(screen.getByRole('link', { name: /En savoir plus/i })).toHaveAttribute('href', 'https://x.fr');
  });
});
```

- [ ] **Step 2: Run — FAIL** (`node node_modules/jest/bin/jest.js PosterMosaic`).

- [ ] **Step 3: Implémenter `PosterMosaic.tsx`**

```tsx
'use client';
import { useEffect, useState } from 'react';
import { Announcement, AnnouncementKind, assetUrl } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { posterLayout } from '@/lib/clubhouse';
import { Icon } from '@/components/ui/Icon';

const KIND_LABEL: Partial<Record<AnnouncementKind, string>> = {
  OFFER: 'Offre', TOURNAMENT: 'Tournoi', EVENT: 'Event',
};

// Mosaïque « À l'affiche » : visuels uploadés par le club (bento), clic → lightbox plein écran.
export function PosterMosaic({ posters }: { posters: Announcement[] }) {
  const { th } = useTheme();
  const [open, setOpen] = useState<Announcement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (posters.length === 0) return null;
  const layout = posterLayout(posters.length);

  const tile = (a: Announcement, big: boolean) => (
    <button key={a.id} onClick={() => setOpen(a)} aria-label={a.title} style={{
      border: 'none', cursor: 'pointer', padding: 0, position: 'relative', overflow: 'hidden',
      borderRadius: 14, background: th.surface2, textAlign: 'left', width: '100%',
      minHeight: big ? 220 : 106, gridRow: big ? 'span 2' : undefined, display: 'block',
    }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={assetUrl(a.imageUrl) ?? ''} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      <span style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '22px 12px 10px', background: 'linear-gradient(transparent, rgba(0,0,0,0.72))' }}>
        {KIND_LABEL[a.kind] && (
          <span style={{ display: 'inline-block', fontFamily: th.fontUI, fontSize: 10, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', color: '#fff', background: 'rgba(255,255,255,0.22)', borderRadius: 99, padding: '2px 8px', marginBottom: 4 }}>
            {KIND_LABEL[a.kind]}
          </span>
        )}
        <span style={{ display: 'block', fontFamily: th.fontUI, fontSize: big ? 15 : 12.5, fontWeight: 700, color: '#fff' }}>{a.title}</span>
      </span>
    </button>
  );

  return (
    <section>
      <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 13, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 7 }}>
        <Icon name="bolt" size={15} color={th.accentWarm} /> À l&apos;affiche
      </div>
      <div data-testid="poster-grid" data-layout={layout} style={{
        display: 'grid', gap: 8,
        gridTemplateColumns: layout === 'single' ? '1fr' : layout === 'duo' ? '1fr 1fr' : '1.6fr 1fr',
        gridAutoRows: layout === 'bento' ? '106px' : undefined,
      }}>
        {layout === 'bento'
          ? [tile(posters[0], true), ...posters.slice(1).map((a) => tile(a, false))]
          : posters.map((a) => tile(a, layout === 'single'))}
      </div>

      {open && (
        <div role="dialog" aria-modal="true" aria-label={open.title} onClick={() => setOpen(null)} style={{
          position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(0,0,0,0.85)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20, cursor: 'zoom-out',
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={assetUrl(open.imageUrl) ?? ''} alt={open.title} onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '100%', maxHeight: '72vh', borderRadius: 12, cursor: 'default' }} />
          <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560, marginTop: 14, textAlign: 'center', cursor: 'default' }}>
            <div style={{ fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 18, color: '#fff' }}>{open.title}</div>
            {open.body && <p style={{ fontFamily: th.fontUI, fontSize: 13.5, color: 'rgba(255,255,255,0.8)', marginTop: 6, whiteSpace: 'pre-wrap' }}>{open.body}</p>}
            {open.linkUrl && (
              <a href={open.linkUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 10, fontFamily: th.fontUI, fontSize: 14, fontWeight: 700, color: '#fff', textDecoration: 'underline' }}>
                En savoir plus →
              </a>
            )}
          </div>
          <button onClick={() => setOpen(null)} aria-label="Fermer" style={{ position: 'absolute', top: 16, right: 16, border: 'none', background: 'rgba(255,255,255,0.15)', color: '#fff', width: 36, height: 36, borderRadius: 99, fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run — PASS, puis commit**

```bash
git add frontend/components/clubhouse/PosterMosaic.tsx frontend/__tests__/PosterMosaic.test.tsx
git commit -m "feat(club-house): mosaique bento des affiches + lightbox"
```

---

### Task 11: `OpenMatchesRail` + `TopOfMonth`

**Files:**
- Create: `frontend/components/clubhouse/OpenMatchesRail.tsx`, `frontend/components/clubhouse/TopOfMonth.tsx`
- Test: `frontend/__tests__/OpenMatchesRail.test.tsx`, `frontend/__tests__/TopOfMonth.test.tsx`

- [ ] **Step 1: Tests qui échouent**

`OpenMatchesRail.test.tsx` :
```tsx
import { render, screen } from '@testing-library/react';
import { OpenMatchesRail } from '@/components/clubhouse/OpenMatchesRail';
import type { OpenMatch } from '@/lib/api';

const match = (over: Partial<OpenMatch>): OpenMatch => ({
  id: 'm1', resourceName: 'Terrain 1', startTime: '2026-07-06T18:00:00Z', endTime: '2026-07-06T19:30:00Z',
  maxPlayers: 4, spotsLeft: 2, full: false, viewerIsParticipant: false, viewerIsOrganizer: false,
  players: [{ userId: 'u1', firstName: 'Ana', lastName: 'B', avatarUrl: null, isOrganizer: true }],
  targetLevelMin: 4, targetLevelMax: 6, lastMessageAt: null, unreadCount: 0, ...over,
});

describe('OpenMatchesRail', () => {
  it('rend les cartes avec places restantes + niveau, lien vers /parties/[id]', () => {
    render(<OpenMatchesRail matches={[match({})]} timezone="Europe/Paris" />);
    expect(screen.getByText(/2 places/)).toBeInTheDocument();
    expect(screen.getByText(/Niveau 4 à 6/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Terrain 1/i })).toHaveAttribute('href', '/parties/m1');
    expect(screen.getByRole('link', { name: /Toutes les parties/i })).toHaveAttribute('href', '/parties');
  });
  it('rien si aucune partie', () => {
    const { container } = render(<OpenMatchesRail matches={[]} timezone="Europe/Paris" />);
    expect(container.firstChild).toBeNull();
  });
});
```

`TopOfMonth.test.tsx` :
```tsx
import { render, screen } from '@testing-library/react';
import { TopOfMonth } from '@/components/clubhouse/TopOfMonth';

describe('TopOfMonth', () => {
  const top = [
    { userId: 'u1', firstName: 'Bob', lastName: 'K', avatarUrl: null, wins: 5 },
    { userId: 'u2', firstName: 'Ana', lastName: 'L', avatarUrl: null, wins: 3 },
    { userId: 'u3', firstName: 'Cléo', lastName: 'M', avatarUrl: null, wins: 1 },
  ];
  it('podium 3 joueurs avec victoires', () => {
    render(<TopOfMonth entries={top} />);
    expect(screen.getByText('Bob K')).toBeInTheDocument();
    expect(screen.getByText(/5 victoires/)).toBeInTheDocument();
    expect(screen.getByText(/1 victoire$/)).toBeInTheDocument();
  });
  it('rien si moins de 3 entrées', () => {
    const { container } = render(<TopOfMonth entries={top.slice(0, 2)} />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implémenter `OpenMatchesRail.tsx`** (coquille de section identique à `TournamentsAlaUne` : carte `th.surface`, titre uppercase ; formatage via `formatDateShortTimeRange` de `@/lib/tournament` et `rangeLabel` de `@/lib/levelMatch` ; avatars `Avatar` + `colorForSeed`) :

```tsx
'use client';
import Link from 'next/link';
import { OpenMatch } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { formatDateShortTimeRange } from '@/lib/tournament';
import { rangeLabel } from '@/lib/levelMatch';
import { colorForSeed } from '@/lib/playerColors';
import { Avatar } from '@/components/ui/Avatar';
import { Chip } from '@/components/ui/atoms';
import { Icon } from '@/components/ui/Icon';

// Rail « Parties ouvertes » du Club-house : les 3 prochaines, clic → page de la partie.
export function OpenMatchesRail({ matches, timezone }: { matches: OpenMatch[]; timezone: string }) {
  const { th } = useTheme();
  if (matches.length === 0) return null;
  return (
    <section style={{ background: th.surface, borderRadius: 16, padding: '14px 16px', boxShadow: `inset 0 0 0 1px ${th.line}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
        <Icon name="users" size={15} color={th.accent} />
        <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 12.5, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute }}>Parties ouvertes</span>
        <Link href="/parties" style={{ marginLeft: 'auto', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, color: th.accent, textDecoration: 'none' }}>
          Toutes les parties →
        </Link>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {matches.map((m) => (
          <Link key={m.id} href={`/parties/${m.id}`} aria-label={`${m.resourceName} — voir la partie`} style={{
            textDecoration: 'none', background: th.surface2, borderRadius: 10, padding: '10px 12px',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{ display: 'flex' }}>
              {m.players.slice(0, 4).map((p, i) => (
                <span key={p.userId} style={{ marginLeft: i === 0 ? 0 : -8 }}>
                  <Avatar name={`${p.firstName} ${p.lastName}`} url={p.avatarUrl} size={26} color={colorForSeed(p.userId)} />
                </span>
              ))}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600, color: th.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {m.resourceName} · {formatDateShortTimeRange(m.startTime, m.endTime, timezone)}
              </span>
              {(m.targetLevelMin != null || m.targetLevelMax != null) && (
                <span style={{ fontFamily: th.fontUI, fontSize: 11.5, color: th.textMute }}>{rangeLabel(m.targetLevelMin ?? null, m.targetLevelMax ?? null)}</span>
              )}
            </span>
            <Chip tone={m.full ? 'mute' : 'accent'}>{m.full ? 'Complet' : `${m.spotsLeft} place${m.spotsLeft > 1 ? 's' : ''}`}</Chip>
          </Link>
        ))}
      </div>
    </section>
  );
}
```
⚠️ Vérifier la signature réelle d'`Avatar` (`components/ui/Avatar.tsx`) avant usage et adapter les props (`name`/`url`/`size`/`color`) à ce qu'elle expose.

- [ ] **Step 4: Implémenter `TopOfMonth.tsx`**

```tsx
'use client';
import { TopMonthEntry } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { colorForSeed } from '@/lib/playerColors';
import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';

const MEDALS = ['🥇', '🥈', '🥉'];

// Podium des 3 joueurs du mois (victoires sur matchs confirmés) — masqué sous 3 joueurs.
export function TopOfMonth({ entries }: { entries: TopMonthEntry[] }) {
  const { th } = useTheme();
  if (entries.length < 3) return null;
  return (
    <section style={{ background: th.surface, borderRadius: 16, padding: '14px 16px', boxShadow: `inset 0 0 0 1px ${th.line}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
        <Icon name="trophy" size={15} color={th.accentWarm} />
        <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 12.5, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute }}>Le top du mois</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {entries.slice(0, 3).map((e, i) => (
          <div key={e.userId} style={{ display: 'flex', alignItems: 'center', gap: 10, background: th.surface2, borderRadius: 10, padding: '9px 12px' }}>
            <span aria-hidden="true" style={{ fontSize: 18 }}>{MEDALS[i]}</span>
            <Avatar name={`${e.firstName} ${e.lastName}`} url={e.avatarUrl} size={30} color={colorForSeed(e.userId)} />
            <span style={{ flex: 1, fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600, color: th.text }}>{e.firstName} {e.lastName}</span>
            <span style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, color: th.textMute }}>
              {e.wins} victoire{e.wins > 1 ? 's' : ''}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Run + commit**

```bash
cd frontend && node node_modules/jest/bin/jest.js OpenMatchesRail TopOfMonth
git add frontend/components/clubhouse/OpenMatchesRail.tsx frontend/components/clubhouse/TopOfMonth.tsx frontend/__tests__/OpenMatchesRail.test.tsx frontend/__tests__/TopOfMonth.test.tsx
git commit -m "feat(club-house): rail parties ouvertes + podium top du mois"
```

---

### Task 12: `SponsorMarquee` (rivière de cartes riches, remplace `PartnerOffers`)

**Files:**
- Create: `frontend/components/clubhouse/SponsorMarquee.tsx`
- Test: `frontend/__tests__/SponsorMarquee.test.tsx`
- (La suppression de `PartnerOffers.tsx` + `PartnerOffers.test.tsx` se fait en Task 13 lors du câblage.)

- [ ] **Step 1: Tests qui échouent**

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { SponsorMarquee } from '@/components/clubhouse/SponsorMarquee';
import type { Sponsor } from '@/lib/api';

jest.mock('@/lib/api', () => ({ ...jest.requireActual('@/lib/api'), assetUrl: (p: string | null) => p }));

const sponsor = (over: Partial<Sponsor>): Sponsor => ({
  id: 's1', name: 'Head Padel', logoUrl: '/uploads/sponsors/h.png', linkUrl: null,
  offerText: null, offerCode: null, offerUntil: null, pinned: false, sortOrder: 0, isActive: true, createdAt: '', ...over,
});

describe('SponsorMarquee', () => {
  const now = new Date('2026-07-05T12:00:00Z');
  it('rend les cartes riches (nom + offre + code copiable) en piste dupliquée', () => {
    render(<SponsorMarquee sponsors={[sponsor({ offerText: '-15 % raquettes', offerCode: 'PADEL15' }), sponsor({ id: 's2', name: 'Nox' }), sponsor({ id: 's3', name: 'CM' })]} now={now} />);
    expect(screen.getAllByText('Head Padel').length).toBe(2); // piste dupliquée pour la boucle
    expect(screen.getAllByText('-15 % raquettes').length).toBe(2);
    fireEvent.click(screen.getAllByRole('button', { name: /PADEL15/ })[0]);
    // le code est copié (navigator.clipboard mocké dans jest.setup ou inline)
  });
  it('≤ 2 sponsors → grille statique sans duplication', () => {
    render(<SponsorMarquee sponsors={[sponsor({}), sponsor({ id: 's2', name: 'Nox' })]} now={now} />);
    expect(screen.getAllByText('Head Padel').length).toBe(1);
  });
  it('offre expirée → carte sans texte d’offre', () => {
    render(<SponsorMarquee sponsors={[sponsor({ offerText: '-15 %', offerUntil: '2026-07-01T23:59:59.999Z' }), sponsor({ id: 's2' }), sponsor({ id: 's3' })]} now={now} />);
    expect(screen.queryByText('-15 %')).toBeNull();
  });
  it('rien sans sponsor', () => {
    const { container } = render(<SponsorMarquee sponsors={[]} now={now} />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implémenter `SponsorMarquee.tsx`**

```tsx
'use client';
import { useState } from 'react';
import { Sponsor, assetUrl } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { offerIsActive } from '@/lib/clubhouse';
import { deadlineCountdown } from '@/lib/tournament';
import { ACCENTS } from '@/lib/theme';
import { Icon } from '@/components/ui/Icon';

// Rivière des partenaires : cartes riches défilantes (logo + nom + offre + code),
// boucle CSS pure avec pause au survol ; statique si ≤ 2 sponsors ou reduced-motion.
export function SponsorMarquee({ sponsors, now = null }: { sponsors: Sponsor[]; now?: Date | null }) {
  const { th } = useTheme();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  if (sponsors.length === 0) return null;
  const ref = now ?? new Date(0);
  const scrolling = sponsors.length > 2;
  const track = scrolling ? [...sponsors, ...sponsors] : sponsors;

  const copy = async (s: Sponsor) => {
    try { await navigator.clipboard.writeText(s.offerCode ?? ''); setCopiedId(s.id); setTimeout(() => setCopiedId(null), 1600); } catch { /* silencieux */ }
  };

  const card = (s: Sponsor, i: number) => {
    const active = offerIsActive(s, ref);
    const expiry = active && s.offerUntil && now ? deadlineCountdown(s.offerUntil, now) : null;
    const inner = (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={assetUrl(s.logoUrl) ?? ''} alt={s.name} style={{ width: 46, height: 46, borderRadius: 11, objectFit: 'contain', background: '#fff', padding: 4, flexShrink: 0 }} />
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'block', fontFamily: th.fontUI, fontSize: 13, fontWeight: 800, color: th.text, whiteSpace: 'nowrap' }}>{s.name}</span>
          {active && s.offerText && (
            <span style={{ display: 'block', fontFamily: th.fontUI, fontSize: 11.5, color: th.textMute, whiteSpace: 'nowrap', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.offerText}</span>
          )}
          {expiry?.urgent && (
            <span style={{ fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 700, color: ACCENTS.coral }}>{expiry.text}</span>
          )}
        </span>
      </>
    );
    return (
      <span key={`${s.id}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 10, background: th.surface, borderRadius: 14, padding: '10px 14px', boxShadow: `inset 0 0 0 1px ${th.line}`, flexShrink: 0 }}>
        {s.linkUrl
          ? <a href={s.linkUrl} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>{inner}</a>
          : <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>{inner}</span>}
        {active && s.offerCode && (
          <button onClick={() => copy(s)} aria-label={`Copier le code ${s.offerCode}`} style={{
            border: 'none', cursor: 'pointer', fontFamily: th.fontMono, fontSize: 11, fontWeight: 700,
            color: th.accent, background: `${th.accent}1c`, borderRadius: 8, padding: '4px 8px',
          }}>
            {copiedId === s.id ? '✓ Copié' : s.offerCode}
          </button>
        )}
      </span>
    );
  };

  return (
    <section style={{ padding: '26px 0 8px' }}>
      <div style={{ padding: '0 20px', display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
        <Icon name="share" size={15} color={th.textMute} />
        <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 12.5, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute }}>Nos partenaires</span>
      </div>
      <style>{`
        .sp-marquee { overflow: hidden; position: relative; }
        .sp-marquee::before, .sp-marquee::after { content: ''; position: absolute; top: 0; bottom: 0; width: 32px; z-index: 2; pointer-events: none; }
        .sp-marquee::before { left: 0; background: linear-gradient(90deg, ${th.bg}, transparent); }
        .sp-marquee::after { right: 0; background: linear-gradient(-90deg, ${th.bg}, transparent); }
        .sp-track { display: flex; gap: 12px; width: max-content; padding: 2px 20px; }
        .sp-track[data-scrolling='true'] { animation: sp-slide ${Math.max(18, sponsors.length * 6)}s linear infinite; }
        .sp-track[data-scrolling='true']:hover { animation-play-state: paused; }
        @keyframes sp-slide { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        @media (prefers-reduced-motion: reduce) {
          .sp-track[data-scrolling='true'] { animation: none; flex-wrap: wrap; width: auto; }
        }
      `}</style>
      <div className="sp-marquee">
        <div className="sp-track" data-scrolling={scrolling}>
          {track.map((s, i) => card(s, i))}
        </div>
      </div>
    </section>
  );
}
```
⚠️ En reduced-motion la piste dupliquée resterait visible : filtrer aussi la duplication est inutile en test jsdom (media queries non évaluées) mais pour la propreté, la duplication n'est ajoutée que si `scrolling` — le fallback CSS wrap suffit visuellement (les doublons wrappent en dessous ; acceptable v1, noté dans le test uniquement pour ≤ 2).

- [ ] **Step 4: Run + commit**

```bash
cd frontend && node node_modules/jest/bin/jest.js SponsorMarquee
git add frontend/components/clubhouse/SponsorMarquee.tsx frontend/__tests__/SponsorMarquee.test.tsx
git commit -m "feat(club-house): riviere des partenaires (cartes riches defilantes)"
```

---

### Task 13: `OffersShowcase` (vitrine + achat Stripe)

**Files:**
- Create: `frontend/components/clubhouse/OffersShowcase.tsx`
- Test: `frontend/__tests__/OffersShowcase.test.tsx`

- [ ] **Step 1: Tests qui échouent**

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { OffersShowcase } from '@/components/clubhouse/OffersShowcase';
import type { PublicOffers } from '@/lib/api';

jest.mock('next/dynamic', () => () => () => <div data-testid="stripe-step" />);
jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  api: {
    createOfferPlanIntent: jest.fn(),
    createOfferPackageIntent: jest.fn(),
    confirmOfferPayment: jest.fn(),
  },
}));

const offers: PublicOffers = {
  plans: [{ id: 'pl1', name: 'Abo Or', monthlyPrice: '39.00', commitmentMonths: 12, offPeakOnly: true, benefit: 'INCLUDED', discountPercent: null, dailyCap: 1, weeklyCap: null, sportKeys: ['padel'] }],
  packages: [{ id: 'tp1', name: 'Carnet 10', kind: 'ENTRIES', price: '90.00', entriesCount: 10, walletAmount: null, validityDays: 365 }],
  onlinePurchase: true,
};

describe('OffersShowcase', () => {
  it('cartes plan + carnet avec prix et avantages', () => {
    render(<OffersShowcase offers={offers} token="t" hasActiveSubscription={false} onAuthPrompt={() => {}} onPurchased={() => {}} />);
    expect(screen.getByText('Abo Or')).toBeInTheDocument();
    expect(screen.getByText(/39,00 € \/ mois/)).toBeInTheDocument();
    expect(screen.getByText(/Heures creuses/)).toBeInTheDocument();
    expect(screen.getByText('Carnet 10')).toBeInTheDocument();
  });
  it('déjà abonné → cartes plan masquées, carnets conservés', () => {
    render(<OffersShowcase offers={offers} token="t" hasActiveSubscription={true} onAuthPrompt={() => {}} onPurchased={() => {}} />);
    expect(screen.queryByText('Abo Or')).toBeNull();
    expect(screen.getByText('Carnet 10')).toBeInTheDocument();
  });
  it('Souscrire ouvre la feuille de paiement Stripe', () => {
    render(<OffersShowcase offers={offers} token="t" hasActiveSubscription={false} onAuthPrompt={() => {}} onPurchased={() => {}} />);
    fireEvent.click(screen.getAllByRole('button', { name: /Souscrire/i })[0]);
    expect(screen.getByTestId('stripe-step')).toBeInTheDocument();
  });
  it('anonyme → onAuthPrompt, pas de feuille', () => {
    const onAuthPrompt = jest.fn();
    render(<OffersShowcase offers={offers} token={null} hasActiveSubscription={false} onAuthPrompt={onAuthPrompt} onPurchased={() => {}} />);
    fireEvent.click(screen.getAllByRole('button', { name: /Souscrire/i })[0]);
    expect(onAuthPrompt).toHaveBeenCalled();
  });
  it('achat en ligne indisponible → CTA accueil, pas de bouton Souscrire', () => {
    render(<OffersShowcase offers={{ ...offers, onlinePurchase: false }} token="t" hasActiveSubscription={false} onAuthPrompt={() => {}} onPurchased={() => {}} />);
    expect(screen.queryByRole('button', { name: /Souscrire/i })).toBeNull();
    expect(screen.getAllByText(/Renseignez-vous à l’accueil/i).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implémenter `OffersShowcase.tsx`**

```tsx
'use client';
import { useState } from 'react';
import dynamic from 'next/dynamic';
import { api, PublicOffers, PublicPlan, PublicPackageTemplate } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { useClub } from '@/lib/ClubProvider';
import { Icon } from '@/components/ui/Icon';
import { Btn } from '@/components/ui/atoms';

const StripePaymentStep = dynamic(() => import('@/components/StripePaymentStep'), { ssr: false });

const euros = (v: string) => `${Number(v).toFixed(2).replace('.', ',')} €`;

type Target = { kind: 'plan'; plan: PublicPlan } | { kind: 'package'; tpl: PublicPackageTemplate };

// Vitrine des formules : cartes abonnements + carnets, achat en ligne via StripePaymentStep.
export function OffersShowcase({ offers, token, hasActiveSubscription, onAuthPrompt, onPurchased }: {
  offers: PublicOffers;
  token: string | null;
  hasActiveSubscription: boolean;
  onAuthPrompt: () => void;
  onPurchased: () => void;
}) {
  const { th } = useTheme();
  const { slug } = useClub();
  const [target, setTarget] = useState<Target | null>(null);
  const [done, setDone] = useState(false);

  const plans = hasActiveSubscription ? [] : offers.plans;
  if (plans.length === 0 && offers.packages.length === 0) return null;

  const planBenefits = (p: PublicPlan): string[] => [
    p.offPeakOnly ? 'Heures creuses' : 'Toutes heures',
    p.benefit === 'INCLUDED' ? 'Réservations incluses' : `−${p.discountPercent ?? 0} % sur les réservations`,
    ...(p.dailyCap ? [`${p.dailyCap} résa/jour max`] : []),
    ...(p.weeklyCap ? [`${p.weeklyCap} résa/sem. max`] : []),
    `Engagement ${p.commitmentMonths} mois`,
  ];

  const buy = (t: Target) => {
    if (!token) { onAuthPrompt(); return; }
    setDone(false);
    setTarget(t);
  };

  const amountLabel = target?.kind === 'plan'
    ? `1re mensualité · ${euros(target.plan.monthlyPrice)}`
    : target ? euros(target.tpl.price) : '';

  const cardStyle = { background: th.surface2, borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column' as const, gap: 8 };

  return (
    <section style={{ background: th.surface, borderRadius: 16, padding: '14px 16px', boxShadow: `inset 0 0 0 1px ${th.line}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
        <Icon name="wallet" size={15} color={th.accent} />
        <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 12.5, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute }}>Abonnements &amp; offres</span>
      </div>
      <style>{`.of-grid{display:grid;grid-template-columns:1fr;gap:10px}@media(min-width:600px){.of-grid{grid-template-columns:1fr 1fr}}`}</style>
      <div className="of-grid">
        {plans.map((p) => (
          <div key={p.id} style={cardStyle}>
            <div style={{ fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 17, color: th.text }}>{p.name}</div>
            <div style={{ fontFamily: th.fontUI, fontSize: 15, fontWeight: 800, color: th.accent }}>{euros(p.monthlyPrice)} / mois</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, lineHeight: 1.7 }}>
              {planBenefits(p).map((b) => <li key={b}>{b}</li>)}
            </ul>
            {offers.onlinePurchase
              ? <Btn onClick={() => buy({ kind: 'plan', plan: p })}>Souscrire</Btn>
              : <span style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute }}>Renseignez-vous à l&rsquo;accueil du club</span>}
          </div>
        ))}
        {offers.packages.map((t) => (
          <div key={t.id} style={cardStyle}>
            <div style={{ fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 17, color: th.text }}>{t.name}</div>
            <div style={{ fontFamily: th.fontUI, fontSize: 15, fontWeight: 800, color: th.accent }}>{euros(t.price)}</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, lineHeight: 1.7 }}>
              <li>{t.kind === 'ENTRIES' ? `${t.entriesCount} entrées` : `${euros(t.walletAmount ?? '0')} crédités`}</li>
              {t.validityDays ? <li>Valable {t.validityDays} jours</li> : <li>Sans expiration</li>}
            </ul>
            {offers.onlinePurchase
              ? <Btn onClick={() => buy({ kind: 'package', tpl: t })}>Souscrire</Btn>
              : <span style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute }}>Renseignez-vous à l&rsquo;accueil du club</span>}
          </div>
        ))}
      </div>

      {target && token && (
        <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div style={{ background: th.bgElev, borderRadius: '18px 18px 0 0', padding: 20, width: '100%', maxWidth: 520 }}>
            {done ? (
              <div style={{ textAlign: 'center', fontFamily: th.fontUI }}>
                <div style={{ fontSize: 30 }}>✓</div>
                <div style={{ fontWeight: 700, fontSize: 16, color: th.text, marginTop: 6 }}>C&rsquo;est fait !</div>
                <p style={{ fontSize: 13.5, color: th.textMute }}>Votre {target.kind === 'plan' ? 'abonnement est actif' : 'solde est disponible'} — retrouvez-le dans votre profil.</p>
                <Btn onClick={() => { setTarget(null); onPurchased(); }}>Fermer</Btn>
              </div>
            ) : (
              <StripePaymentStep
                type="payment"
                amountLabel={amountLabel}
                createIntent={async () => {
                  const r = target.kind === 'plan'
                    ? await api.createOfferPlanIntent(slug ?? '', target.plan.id, token)
                    : await api.createOfferPackageIntent(slug ?? '', target.tpl.id, token);
                  return { clientSecret: r.clientSecret, stripeAccountId: r.stripeAccountId ?? null, customerSessionClientSecret: r.customerSessionClientSecret ?? null };
                }}
                confirm={async (ids) => {
                  if (ids.stripePaymentIntentId) await api.confirmOfferPayment(slug ?? '', ids.stripePaymentIntentId, token);
                }}
                onSuccess={() => setDone(true)}
                onCancel={() => setTarget(null)}
              />
            )}
          </div>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run + commit**

```bash
cd frontend && node node_modules/jest/bin/jest.js OffersShowcase
git add frontend/components/clubhouse/OffersShowcase.tsx frontend/__tests__/OffersShowcase.test.tsx
git commit -m "feat(club-house): vitrine des formules + achat en ligne Stripe"
```

---

### Task 14: `ClubPresentationCard` + page `/club`

**Files:**
- Create: `frontend/components/clubhouse/ClubPresentationCard.tsx`, `frontend/app/club/page.tsx`
- Test: `frontend/__tests__/ClubPresentationCard.test.tsx`, `frontend/__tests__/ClubPage.test.tsx`

- [ ] **Step 1: Tests qui échouent**

`ClubPresentationCard.test.tsx` :
```tsx
import { render, screen } from '@testing-library/react';
import { ClubPresentationCard } from '@/components/clubhouse/ClubPresentationCard';

jest.mock('@/lib/api', () => ({ ...jest.requireActual('@/lib/api'), assetUrl: (p: string | null) => p }));

const pres = {
  presentationText: 'Le plus beau club du Sud-Ouest.', coverImageUrl: '/uploads/covers/c.jpg',
  address: '1 rue', city: 'Rodez', latitude: null, longitude: null,
  contactPhone: null, contactEmail: null, openingHoursText: null,
  photos: [{ id: 'p1', url: '/uploads/club-photos/1.jpg', caption: null, sortOrder: 0 }],
};

describe('ClubPresentationCard', () => {
  it('teaser : extrait + miniatures + lien vers /club', () => {
    render(<ClubPresentationCard presentation={pres} clubName="Padel Arena" />);
    expect(screen.getByText(/plus beau club/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Découvrir le club/i })).toHaveAttribute('href', '/club');
  });
  it('rien si ni texte ni photos', () => {
    const { container } = render(<ClubPresentationCard presentation={{ ...pres, presentationText: null, photos: [] }} clubName="X" />);
    expect(container.firstChild).toBeNull();
  });
});
```

`ClubPage.test.tsx` (page client — mocker `useClub`, `api.getClubPresentation`) :
```tsx
import { render, screen, waitFor } from '@testing-library/react';
import ClubPage from '@/app/club/page';

jest.mock('@/lib/ClubProvider', () => ({ useClub: () => ({ club: { name: 'Padel Arena', slug: 'padel-arena', timezone: 'Europe/Paris', address: '1 rue du Padel', city: 'Rodez' }, slug: 'padel-arena' }) }));
jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  api: {
    getClubPresentation: jest.fn().mockResolvedValue({
      presentationText: 'Notre histoire…', coverImageUrl: null,
      address: '1 rue du Padel', city: 'Rodez', latitude: 44.35, longitude: 2.57,
      contactPhone: '0565', contactEmail: 'hello@club.fr', openingHoursText: 'Tous les jours 8h-22h',
      photos: [{ id: 'p1', url: '/uploads/club-photos/1.jpg', caption: 'Terrain central', sortOrder: 0 }],
    }),
  },
}));

describe('/club', () => {
  it('affiche présentation, galerie, infos pratiques avec itinéraire', async () => {
    render(<ClubPage />);
    await waitFor(() => expect(screen.getByText('Notre histoire…')).toBeInTheDocument());
    expect(screen.getByText('Tous les jours 8h-22h')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Itinéraire/i })).toHaveAttribute('href', expect.stringContaining('google.com/maps'));
    expect(screen.getByRole('link', { name: /0565/ })).toHaveAttribute('href', 'tel:0565');
  });
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implémenter `ClubPresentationCard.tsx`**

```tsx
'use client';
import Link from 'next/link';
import { ClubPresentation, assetUrl } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';

// Teaser « Le club » du Club-house : cover, extrait de présentation, 3 miniatures → /club.
export function ClubPresentationCard({ presentation, clubName }: { presentation: ClubPresentation; clubName: string }) {
  const { th } = useTheme();
  if (!presentation.presentationText && presentation.photos.length === 0) return null;
  const cover = assetUrl(presentation.coverImageUrl);
  return (
    <Link href="/club" style={{ textDecoration: 'none', display: 'block', background: th.surface, borderRadius: 16, overflow: 'hidden', boxShadow: `inset 0 0 0 1px ${th.line}` }}>
      {cover && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cover} alt="" style={{ width: '100%', height: 140, objectFit: 'cover', display: 'block' }} />
      )}
      <div style={{ padding: '14px 16px' }}>
        <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 12.5, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute, marginBottom: 6 }}>Le club</div>
        <div style={{ fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 19, color: th.text }}>{clubName}</div>
        {presentation.presentationText && (
          <p style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, marginTop: 6, lineHeight: 1.55, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {presentation.presentationText}
          </p>
        )}
        {presentation.photos.length > 0 && (
          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            {presentation.photos.slice(0, 3).map((p) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={p.id} src={assetUrl(p.url) ?? ''} alt={p.caption ?? ''} style={{ width: 72, height: 54, objectFit: 'cover', borderRadius: 8 }} />
            ))}
          </div>
        )}
        <span style={{ display: 'inline-block', marginTop: 10, fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, color: th.accent }}>Découvrir le club →</span>
      </div>
    </Link>
  );
}
```

- [ ] **Step 4: Implémenter `app/club/page.tsx`** (page client, shell habituel avec `ClubNav` — reprendre la coquille d'une page club existante comme `app/events/page.tsx` : `useClub`, header, fond `th.bg`). Corps :

```tsx
'use client';
import { useEffect, useState } from 'react';
import { api, ClubPresentation, assetUrl } from '@/lib/api';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { ClubNav } from '@/components/ClubNav';

export default function ClubPage() {
  const { th } = useTheme();
  const { club, slug } = useClub();
  const [pres, setPres] = useState<ClubPresentation | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  useEffect(() => { if (slug) api.getClubPresentation(slug).then(setPres).catch(() => setPres(null)); }, [slug]);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightbox(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox]);

  if (!club) return null;
  const mapsHref = pres?.latitude != null && pres?.longitude != null
    ? `https://www.google.com/maps/search/?api=1&query=${pres.latitude},${pres.longitude}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${club.address} ${club.city ?? ''}`)}`;

  return (
    <div style={{ minHeight: '100vh', background: th.bg }}>
      <ClubNav />
      {pres?.coverImageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={assetUrl(pres.coverImageUrl) ?? ''} alt="" style={{ width: '100%', height: 200, objectFit: 'cover', display: 'block' }} />
      )}
      <main style={{ maxWidth: 720, margin: '0 auto', padding: '22px 20px 60px' }}>
        <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 26, color: th.text, margin: 0 }}>{club.name}</h1>
        {pres?.presentationText && (
          <div style={{ marginTop: 14 }}>
            {pres.presentationText.split(/\n{2,}/).map((para, i) => (
              <p key={i} style={{ fontFamily: th.fontUI, fontSize: 14.5, color: th.text, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>{para}</p>
            ))}
          </div>
        )}

        {pres && pres.photos.length > 0 && (
          <section style={{ marginTop: 26 }}>
            <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 13, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute, marginBottom: 12 }}>Galerie</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
              {pres.photos.map((p) => (
                <button key={p.id} onClick={() => setLightbox(assetUrl(p.url))} aria-label={p.caption ?? 'Photo du club'} style={{ border: 'none', padding: 0, cursor: 'zoom-in', borderRadius: 10, overflow: 'hidden', background: th.surface2 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={assetUrl(p.url) ?? ''} alt={p.caption ?? ''} style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block' }} />
                </button>
              ))}
            </div>
          </section>
        )}

        <section style={{ marginTop: 26, background: th.surface, borderRadius: 16, padding: '14px 16px', boxShadow: `inset 0 0 0 1px ${th.line}` }}>
          <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 13, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute, marginBottom: 10 }}>Infos pratiques</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontFamily: th.fontUI, fontSize: 14, color: th.text }}>
            <div>{club.address}{club.city ? `, ${club.city}` : ''} — <a href={mapsHref} target="_blank" rel="noreferrer" style={{ color: th.accent, fontWeight: 700 }}>Itinéraire →</a></div>
            {pres?.openingHoursText && <div>{pres.openingHoursText}</div>}
            {pres?.contactPhone && <a href={`tel:${pres.contactPhone}`} style={{ color: th.accent }}>{pres.contactPhone}</a>}
            {pres?.contactEmail && <a href={`mailto:${pres.contactEmail}`} style={{ color: th.accent }}>{pres.contactEmail}</a>}
          </div>
        </section>
      </main>

      {lightbox && (
        <div role="dialog" aria-modal="true" aria-label="Photo" onClick={() => setLightbox(null)} style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, cursor: 'zoom-out' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="Photo du club" style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 12 }} />
        </div>
      )}
    </div>
  );
}
```
⚠️ Si le test monte le vrai `ClubNav`, mocker `@/components/ClubNav` (`jest.mock('@/components/ClubNav', () => ({ ClubNav: () => <nav /> }))`) — sinon il faut mocker tous ses appels `api.*`.

- [ ] **Step 5: Run + commit**

```bash
cd frontend && node node_modules/jest/bin/jest.js ClubPresentationCard ClubPage
git add frontend/components/clubhouse/ClubPresentationCard.tsx frontend/app/club/page.tsx frontend/__tests__/ClubPresentationCard.test.tsx frontend/__tests__/ClubPage.test.tsx
git commit -m "feat(club): teaser presentation + page /club (galerie, infos pratiques)"
```

---

### Task 15: Réassemblage `ClubHouse.tsx` (ordre adaptatif)

**Files:**
- Modify: `frontend/components/ClubHouse.tsx`
- Delete: `frontend/components/clubhouse/MatchesForYou.tsx`, `frontend/components/clubhouse/PartnerOffers.tsx` + leurs suites de test
- Test: `frontend/__tests__/ClubHouse.test.tsx` (créer ou étendre l'existant s'il existe)

- [ ] **Step 1: Tests qui échouent** — mocker tous les `api.*` appelés par `ClubHouse` (`getClubAnnouncements`, `getClubSponsors`, `getClubTournaments`, `getClubEvents`, `getClubAvailability`, `getMyReservations`, `getOpenMatches`, `getClubPresentation`, `getClubOffers`, `getClubTopMonth`, `getMyClubSubscriptions`) et les composants enfants par des stubs à `data-testid` :

```tsx
// Stub des sections pour tester l'ORDRE sans leur logique interne :
jest.mock('@/components/clubhouse/PosterMosaic', () => ({ PosterMosaic: () => <div data-testid="sec-posters" /> }));
jest.mock('@/components/clubhouse/OpenMatchesRail', () => ({ OpenMatchesRail: () => <div data-testid="sec-matches" /> }));
jest.mock('@/components/clubhouse/OffersShowcase', () => ({ OffersShowcase: () => <div data-testid="sec-offers" /> }));
jest.mock('@/components/clubhouse/TopOfMonth', () => ({ TopOfMonth: () => <div data-testid="sec-top" /> }));
jest.mock('@/components/clubhouse/ClubPresentationCard', () => ({ ClubPresentationCard: () => <div data-testid="sec-club" /> }));
jest.mock('@/components/clubhouse/SponsorMarquee', () => ({ SponsorMarquee: () => <div data-testid="sec-sponsors" /> }));

it('visiteur : Le club avant les créneaux, offres avant top', async () => {
  // useAuth mocké → { token: null, ready: true }
  render(<ClubHouse club={clubFixture} />);
  await waitFor(() => expect(screen.getByTestId('sec-club')).toBeInTheDocument());
  const ids = screen.getAllByTestId(/^sec-/).map((el) => el.getAttribute('data-testid'));
  expect(ids.indexOf('sec-club')).toBeLessThan(ids.indexOf('sec-matches'));
  expect(ids.indexOf('sec-offers')).toBeLessThan(ids.indexOf('sec-top'));
  expect(ids.indexOf('sec-sponsors')).toBe(ids.length - 1);
});

it('membre : Le club redescend sous le top, top avant offres', async () => {
  // useAuth mocké → { token: 't', ready: true }
  render(<ClubHouse club={clubFixture} />);
  await waitFor(() => expect(screen.getByTestId('sec-club')).toBeInTheDocument());
  const ids = screen.getAllByTestId(/^sec-/).map((el) => el.getAttribute('data-testid'));
  expect(ids.indexOf('sec-matches')).toBeLessThan(ids.indexOf('sec-club'));
  expect(ids.indexOf('sec-top')).toBeLessThan(ids.indexOf('sec-offers'));
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Modifier `ClubHouse.tsx`**

1. **Nouveaux états + chargements** (pattern des `useEffect` existants, silencieux en erreur) :
```tsx
const [presentation, setPresentation] = useState<ClubPresentation | null>(null);
const [offers, setOffers] = useState<PublicOffers | null>(null);
const [topMonth, setTopMonth] = useState<TopMonthEntry[]>([]);
const [hasSub, setHasSub] = useState(false);
const [authPrompt, setAuthPrompt] = useState(false);

useEffect(() => { api.getClubPresentation(club.slug).then(setPresentation).catch(() => setPresentation(null)); }, [club.slug]);
useEffect(() => { api.getClubOffers(club.slug).then(setOffers).catch(() => setOffers(null)); }, [club.slug]);
useEffect(() => { api.getClubTopMonth(club.slug).then(setTopMonth).catch(() => setTopMonth([])); }, [club.slug]);
useEffect(() => {
  if (!token) { setHasSub(false); return; }
  api.getMyClubSubscriptions(club.slug, token).then((subs) => setHasSub(subs.length > 0)).catch(() => setHasSub(false));
}, [club.slug, token]);
```
2. **Parties ouvertes pour tous** : remplacer le `useEffect` gaté `if (!token) return;` par `api.getOpenMatches(club.slug, token ?? undefined)` (token facultatif) ; supprimer `recommendMatches`, `getMyRating`, `myLevel`, `matchRecos`, l'import et le rendu de `MatchesForYou`.
3. **Affiches + expiration partout** : `const hero = ...` inchangé mais filtré par `!announcementExpired(a, now)` ; `const posters = activePosters(ann, now, hero?.id ?? null);` ; `restAnn` filtre en plus `!a.imageUrl || …` → les annonces AVEC image vivent dans la bento, la liste texte garde les sans-image non expirées : `const restAnn = ann.filter((a) => a !== hero && !posters.includes(a) && !announcementExpired(a, now) && !a.imageUrl);`.
4. **Sections dans l'ordre adaptatif** — construire deux listes de nœuds :
```tsx
const wrap = (key: string, node: React.ReactNode) => node && <div key={key} style={{ padding: '22px 20px 0' }}>{node}</div>;
const sections = {
  clubCard: presentation && <ClubPresentationCard presentation={presentation} clubName={club.name} />,
  actionGrid: /* grille créneaux+events existante, inchangée */,
  matches: openMatches.some((m) => new Date(m.startTime) > now)
    && <OpenMatchesRail matches={openMatches.filter((m) => new Date(m.startTime) > now).slice(0, 3)} timezone={club.timezone} />,
  myReservations: /* bloc « Vos prochaines réservations » existant (token seulement) */,
  posters: posters.length > 0 && <PosterMosaic posters={posters} />,
  offers: offers && <OffersShowcase offers={offers} token={token} hasActiveSubscription={hasSub} onAuthPrompt={() => setAuthPrompt(true)} onPurchased={() => { /* recharge soldes */ }} />,
  top: topMonth.length >= 3 && <TopOfMonth entries={topMonth} />,
  announcements: /* bloc annonces texte existant sur restAnn */,
};
const order = token
  ? ['actionGrid', 'matches', 'myReservations', 'posters', 'top', 'offers', 'clubCard', 'announcements']
  : ['clubCard', 'actionGrid', 'matches', 'posters', 'offers', 'top', 'announcements'];
```
Rendu : `{hero && <HeroAnnouncement …/>}` puis `{order.map((k) => wrap(k, sections[k]))}` puis `<SponsorMarquee sponsors={spons} now={clock} />` (remplace `<PartnerOffers …/>`), puis l'`AuthPromptDialog` :
```tsx
{authPrompt && (
  <AuthPromptDialog detail={club.name}
    onRegister={() => router.push('/register?next=/')}
    onLogin={() => router.push('/login?next=/')}
    onClose={() => setAuthPrompt(false)} />
)}
```
(imports `AuthPromptDialog`, `useRouter` de `next/navigation`.)
5. **Supprimer les fichiers morts** : `git rm frontend/components/clubhouse/MatchesForYou.tsx frontend/components/clubhouse/PartnerOffers.tsx frontend/__tests__/PartnerOffers.test.tsx` (+ `MatchesForYou.test.tsx` s'il existe). Retirer `recommendMatches` de `lib/recommend.ts` **seulement si** plus aucun autre consommateur (`grep -r recommendMatches frontend/`) — sinon laisser.

- [ ] **Step 4: Run ciblé + suites voisines**

```bash
cd frontend && node node_modules/jest/bin/jest.js ClubHouse HeroAnnouncement clubhouse
```
Expected: PASS. Si d'anciennes suites référencent `PartnerOffers`/`MatchesForYou`, les adapter ou supprimer.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/components/ClubHouse.tsx frontend/components/clubhouse/ frontend/__tests__/
git commit -m "feat(club-house): reassemblage v2 - ordre adaptatif visiteur/membre"
```
(⚠️ vérifier `git status` avant : ne stage que les fichiers du chantier.)

---

### Task 16: Admin — annonces enrichies, page « Page club », opt-in settings

**Files:**
- Modify: `frontend/app/admin/announcements/page.tsx`, `frontend/app/admin/layout.tsx`, `frontend/app/admin/settings/page.tsx`
- Create: `frontend/app/admin/club/page.tsx`
- Test: `frontend/__tests__/AdminClub.test.tsx`, étendre `frontend/__tests__/AdminAnnouncements.test.tsx` si existant (sinon créer)

- [ ] **Step 1: Tests qui échouent** (`AdminClub.test.tsx`) :

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminClubPage from '@/app/admin/club/page';

jest.mock('@/lib/useAuth', () => ({ useAuth: () => ({ token: 't', ready: true }) }));
jest.mock('@/lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'c1', name: 'Padel Arena' } }) }));
jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  api: {
    adminGetPresentation: jest.fn().mockResolvedValue({
      presentationText: 'Texte', contactPhone: null, contactEmail: null, openingHoursText: null,
      coverImageUrl: null, photos: [{ id: 'p1', url: '/uploads/club-photos/1.jpg', caption: null, sortOrder: 0 }],
    }),
    adminUpdatePresentation: jest.fn().mockResolvedValue({}),
    adminAddClubPhoto: jest.fn(),
    adminUpdateClubPhoto: jest.fn(),
    adminDeleteClubPhoto: jest.fn().mockResolvedValue({ ok: true }),
  },
}));

describe('/admin/club', () => {
  it('charge la présentation et enregistre les modifications', async () => {
    render(<AdminClubPage />);
    await waitFor(() => expect(screen.getByDisplayValue('Texte')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Présentation/i), { target: { value: 'Nouveau texte' } });
    fireEvent.click(screen.getByRole('button', { name: /Enregistrer/i }));
    await waitFor(() => expect(require('@/lib/api').api.adminUpdatePresentation).toHaveBeenCalledWith(
      'c1', expect.objectContaining({ presentationText: 'Nouveau texte' }), 't',
    ));
  });
  it('affiche la galerie avec compteur x/12 et suppression', async () => {
    render(<AdminClubPage />);
    await waitFor(() => expect(screen.getByText(/1\/12/)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Créer `app/admin/club/page.tsx`** — reprendre la coquille d'`app/admin/announcements/page.tsx` (états `loading`/`saving`/`error`, `useAuth`/`useClub`/`useTheme`, styles `card`/`inputStyle` du repo admin). Contenu :
  - Carte « Présentation » : textarea `presentationText` avec **`aria-label="Présentation du club"`** (requis par `getByLabelText` du test), inputs `openingHoursText` (« Horaires »), `contactPhone` (« Téléphone »), `contactEmail` (« Email de contact »), bouton **Enregistrer** → `api.adminUpdatePresentation(clubId, form, token)`.
  - Carte « Galerie (x/12) » : grille des photos (`adminGetPresentation().photos`), chaque tuile = image + input légende (blur → `adminUpdateClubPhoto`) + flèches ↑/↓ (échange des `sortOrder` des deux photos via 2 appels `adminUpdateClubPhoto`) + bouton Supprimer (avec `ConfirmDialog`) ; `<input type="file" accept="image/jpeg,image/png,image/webp">` → `adminAddClubPhoto(clubId, file, undefined, token)` puis reload ; input désactivé si 12 photos ; erreurs affichées (`PHOTO_LIMIT_REACHED` → « Maximum 12 photos »).

- [ ] **Step 4: Entrée sidebar** — dans `app/admin/layout.tsx`, section « Communauté », ajouter après Annonces :

```tsx
{ href: '/admin/club', label: 'Page club', icon: 'home' },
```
(vérifier que l'icône `home` existe dans `IconName`, sinon `users`.)

- [ ] **Step 5: Annonces admin** — dans `app/admin/announcements/page.tsx` :
  - `EMPTY` : remplacer `imageUrl: ''` par `kind: 'INFO' as AnnouncementKind, validUntil: ''` + nouvel état `const [imageFile, setImageFile] = useState<File | null>(null);`.
  - Formulaire : supprimer le champ URL d'image ; ajouter un `<select>` « Type » (Info / Offre / Tournoi / Event → `INFO/OFFER/TOURNAMENT/EVENT`), un `<input type="date">` « Afficher jusqu'au » (`form.validUntil`), un `<input type="file" accept="image/jpeg,image/png,image/webp">` « Affiche (image) » avec aperçu de l'image actuelle en édition (`assetUrl(a.imageUrl)`).
  - `submit()` : le body inclut `kind` et `validUntil: form.validUntil || null` ; après create/update, si `imageFile` : `await api.adminUploadAnnouncementImage(clubId, saved.id, imageFile, token);` (le create renvoie l'annonce → `saved.id`).
  - Tableau : colonne « Type » (libellé FR) + pastille 🖼 si `imageUrl`.

- [ ] **Step 6: Settings** — dans `app/admin/settings/page.tsx`, calquer la case `listTournamentsNationally` (même carte « Visibilité » ou équivalente) :

```tsx
<label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
  <input type="checkbox" checked={form.showOffersPublicly}
    onChange={(e) => setForm({ ...form, showOffersPublicly: e.target.checked })} />
  Afficher mes formules (abonnements &amp; carnets) sur le Club-house
</label>
```
+ init depuis `adminGetClub` (`showOffersPublicly` ajouté au type en Task 9) + inclusion dans le PATCH de sauvegarde existant.

- [ ] **Step 7: Run + tsc + commit**

```bash
cd frontend && node node_modules/jest/bin/jest.js AdminClub AdminAnnouncements AdminSettings && node node_modules/typescript/bin/tsc --noEmit
git add frontend/app/admin/club/page.tsx frontend/app/admin/announcements/page.tsx frontend/app/admin/layout.tsx frontend/app/admin/settings/page.tsx frontend/__tests__/AdminClub.test.tsx frontend/__tests__/AdminAnnouncements.test.tsx
git commit -m "feat(admin): page club (presentation+galerie), annonces enrichies, opt-in offres"
```

---

### Task 17: Vérification finale

- [ ] **Step 1: Type-check des deux projets**

```bash
cd backend && node node_modules/typescript/bin/tsc --noEmit
cd ../frontend && node node_modules/typescript/bin/tsc --noEmit
```
Expected: 0 erreur dans les fichiers du chantier (ignorer le WIP parallèle non lié — filtrer par chemins touchés).

- [ ] **Step 2: Suites backend ciblées**

```bash
cd backend && node node_modules/jest/bin/jest.js announcement presentation offer stripe.service club.service
```
Expected: PASS (les 3 échecs `icon.routes` sont la baseline connue si la suite complète est lancée).

- [ ] **Step 3: Suites frontend ciblées**

```bash
cd frontend && node node_modules/jest/bin/jest.js clubhouse PosterMosaic OpenMatchesRail TopOfMonth SponsorMarquee OffersShowcase ClubPresentationCard ClubPage ClubHouse AdminClub authGate
```
Expected: PASS. (La suite complète a le flake BookingModal connu — ne pas s'en inquiéter.)

- [ ] **Step 4: Smoke test manuel** (stack démarrée via `./start.ps1`) :

```bash
curl "http://localhost:3001/api/clubs/padel-arena-paris/presentation"
curl "http://localhost:3001/api/clubs/padel-arena-paris/offers"
curl "http://localhost:3001/api/clubs/padel-arena-paris/top-month"
```
Expected: 200 JSON (offers = listes vides tant que l'opt-in n'est pas coché en admin).

- [ ] **Step 5: Commit final éventuel** (fichiers oubliés du chantier uniquement), puis annoncer la fin et proposer la vérification visuelle (`/verify`) sur `/` (visiteur + connecté), `/club`, `/admin/club`.

---

## Notes d'exécution

- **Prod (à faire au déploiement, pas dans ce plan)** : `prisma migrate deploy` (les 2 migrations sont idempotentes), volume `backend_uploads` couvre déjà `uploads/announcements` et `uploads/club-photos`.
- **Hors périmètre (spec)** : récurrence Stripe, remboursement en ligne, mode TV/pouls/météo/QR, WYSIWYG, carte embarquée.
- Si une suite existante casse parce qu'elle référence `PartnerOffers`/`MatchesForYou`, c'est attendu (Task 15) : adapter ou supprimer la suite avec le composant.
