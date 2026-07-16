# Logos du club multi-formats — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner à l'admin trois emplacements de logo clairement expliqués (icône carrée obligatoire, logotype horizontal, variante fond sombre), avec ré-encodage serveur + avertissements, et brancher les surfaces qui en dépendent (favicon club, badge de notification monochrome, bandeau thème-aware, sidebar `contain`).

**Architecture :** `Club.logoUrl` devient officiellement « l'icône carrée » ; deux colonnes additives (`logoWideUrl`, `logoWideDarkUrl`) portent les logotypes. Une règle de repli unique (`lib/clubLogos.ts` côté front, documentée côté back) alimente chaque surface. Les uploads sont ré-encodés par sharp (module `clubLogo.ts`, pattern photos DM) et renvoient des warnings non bloquants mesurés sur l'image réelle. Le badge Android monochrome et le favicon club sont **dérivés** (variante `badge-96` de `icon.service`, route d'icône existante).

**Tech Stack :** Prisma 7 (migration additive), sharp, Express (multer existant), Next.js 16, React Testing Library, Jest.

**Spec :** `docs/superpowers/specs/2026-07-16-logos-club-multi-formats-design.md`

---

## Notes d'environnement (lire avant de commencer)

- **Windows / shims cassés** : si `npx jest`/`npx tsc` répondent « n'est pas reconnu », lancer depuis le dossier du package : `node node_modules/jest/bin/jest.js <chemin>` et `node node_modules/typescript/bin/tsc --noEmit`. Le cwd PowerShell se réinitialise entre commandes — préfixer chaque commande de `cd backend`/`cd frontend`.
- **Migration Prisma** : base dev en dérive → **jamais** `prisma migrate dev`/`db push`. Colonnes additives appliquées en DEV via `prisma db execute` du SQL fourni ; en prod `prisma migrate deploy` (dossier de migration horodaté versionné). Cf. mémoire « Prisma: migrate deploy, not migrate dev ».
- **Jest ne type-check pas** (ts-jest isolatedModules) → `tsc --noEmit` est la barrière de types, à lancer séparément.
- **Suites *real-mount* ClubNav** : `ClubReserve.{deeplink,persport,pastslots,persport,balances,view}` + `OpenMatches` montent le vrai `ClubNav`. Ce plan **n'ajoute aucun nouvel appel `api.*` dans ClubNav** (il ne lit que des champs déjà présents sur `ClubDetail`), donc ces mocks ne cassent pas — mais ne pas introduire d'appel réseau dans ClubNav.
- **Branche** : travailler sur la branche courante `feat/annonces-drag-drop-kiosque` (WIP push déjà présent). Vérifier `git branch --show-current` avant chaque commit (mémoire « Concurrent branch-switching hazard »).

## Structure des fichiers

**Backend (créés)**
- `backend/src/services/clubLogo.ts` — ré-encodage sharp + warnings (pur, testable)
- `backend/src/services/__tests__/clubLogo.test.ts`
- `backend/prisma/migrations/20260716120000_add_club_logo_variants/migration.sql`
- `backend/assets/pwa/icon-badge-96.png` + `frontend/public/icon-badge-96.png` (générés)

**Backend (modifiés)**
- `backend/prisma/schema.prisma` — 2 colonnes
- `backend/src/services/icon.service.ts` — variante `badge-96` monochrome
- `backend/src/routes/admin.ts` — `POST /club-logo/:variant?` + `DELETE /club-logo/wide[-dark]`
- `backend/src/services/club.service.ts` — selects + `updateClub` params
- `backend/src/email/registry.ts` — `brandFromClub` (wide ?? icon)
- `backend/src/email/notifications.ts` — `EMAIL_CLUB_SELECT`
- `backend/src/services/emailTemplate.service.ts` — `loadBrand` select
- `backend/src/services/notification/push.ts` — `resolvePushBadge` + `PushPayload.badge`
- `backend/src/services/notification/dispatcher.ts` — passe le badge
- `backend/scripts/generate-pwa-icons.ts` — asset badge Palova de repli

**Frontend (créés)**
- `frontend/lib/clubLogos.ts` + `frontend/__tests__/clubLogos.test.ts`
- `frontend/components/admin/settings/LogoStudio.tsx` + `frontend/__tests__/LogoStudio.test.tsx`

**Frontend (modifiés)**
- `frontend/lib/api.ts` — types `ClubDetail`/`ClubAdminDetail` + `uploadClubLogo(variant)` + `deleteClubLogoVariant`
- `frontend/components/admin/settings/SettingsIdentity.tsx` — monte `LogoStudio`
- `frontend/app/admin/settings/page.tsx` — `pickLogo(variant)` + `deleteLogo(variant)`
- `frontend/components/ClubNav.tsx` — logotype thème-aware
- `frontend/app/admin/layout.tsx` — sidebar `contain` sur tuile blanche
- `frontend/app/layout.tsx` — favicon par club
- `frontend/public/sw.js` — badge

---

## Task 1 : Migration + schéma Prisma (2 colonnes)

**Files:**
- Modify: `backend/prisma/schema.prisma:30-31`
- Create: `backend/prisma/migrations/20260716120000_add_club_logo_variants/migration.sql`

- [ ] **Step 1 : Ajouter les colonnes au schéma**

Dans `model Club`, juste après la ligne `coverImageUrl` (schema.prisma:31) :

```prisma
  logoWideUrl      String?    @map("logo_wide_url")      // logotype horizontal (fond clair) — bandeau + emails
  logoWideDarkUrl  String?    @map("logo_wide_dark_url") // logotype pour fond sombre (bandeau en thème floodlit)
```

- [ ] **Step 2 : Écrire le fichier de migration (prod)**

Create `backend/prisma/migrations/20260716120000_add_club_logo_variants/migration.sql` :

```sql
-- Logos multi-formats : logoUrl reste l'icône carrée, on ajoute les logotypes horizontaux.
ALTER TABLE "clubs" ADD COLUMN "logo_wide_url" TEXT;
ALTER TABLE "clubs" ADD COLUMN "logo_wide_dark_url" TEXT;
```

- [ ] **Step 3 : Appliquer en DEV + régénérer le client**

Run (depuis `backend/`) :
```bash
cd backend
npx prisma db execute --file prisma/migrations/20260716120000_add_club_logo_variants/migration.sql --schema prisma/schema.prisma
npx prisma generate
```
Expected : « Script executed successfully » puis « Generated Prisma Client ». (Si `--schema` refuse en Prisma 7, la config vient de `prisma.config.ts` — retenter sans le flag.)

- [ ] **Step 4 : Vérifier que le client connaît les champs**

Run :
```bash
cd backend && node -e "const{PrismaClient}=require('@prisma/client');console.log('logoWideUrl' in new PrismaClient().club.fields)"
```
Expected : `true`

- [ ] **Step 5 : Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260716120000_add_club_logo_variants
git commit -m "feat(logos): colonnes logoWideUrl / logoWideDarkUrl (migration additive)"
```

---

## Task 2 : Service `clubLogo.ts` (ré-encodage + warnings)

**Files:**
- Create: `backend/src/services/clubLogo.ts`
- Test: `backend/src/services/__tests__/clubLogo.test.ts`

- [ ] **Step 1 : Écrire les tests**

Create `backend/src/services/__tests__/clubLogo.test.ts` :

```typescript
import sharp from 'sharp';
import { processClubLogo } from '../clubLogo';

async function png(w: number, h: number): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } } }).png().toBuffer();
}

describe('processClubLogo', () => {
  it('rejette un buffer non-image', async () => {
    await expect(processClubLogo(Buffer.from('nope'), 'icon')).rejects.toThrow('VALIDATION_ERROR');
  });

  it('icône : carrée ≥512 → aucun warning, sortie PNG plafonnée à 1024', async () => {
    const out = await processClubLogo(await png(2000, 2000), 'icon');
    expect(out.warnings).toEqual([]);
    expect(out.width).toBe(1024);
    const meta = await sharp(out.png).metadata();
    expect(meta.format).toBe('png');
  });

  it('icône non carrée + trop petite → NOT_SQUARE et TOO_SMALL', async () => {
    const out = await processClubLogo(await png(300, 120), 'icon');
    expect(out.warnings).toEqual(expect.arrayContaining(['NOT_SQUARE', 'TOO_SMALL']));
  });

  it('logotype carré → LOOKS_SQUARE', async () => {
    const out = await processClubLogo(await png(400, 400), 'wide');
    expect(out.warnings).toContain('LOOKS_SQUARE');
  });

  it('logotype trop bas → TOO_SMALL, plafonné à 320 de haut', async () => {
    const out = await processClubLogo(await png(1200, 100), 'wide');
    expect(out.warnings).toContain('TOO_SMALL');
    expect(out.height).toBeLessThanOrEqual(320);
  });

  it('accepte le JPEG (format réel, pas le mimetype)', async () => {
    const jpeg = await sharp({ create: { width: 600, height: 200, channels: 3, background: '#fff' } }).jpeg().toBuffer();
    const out = await processClubLogo(jpeg, 'wide');
    const meta = await sharp(out.png).metadata();
    expect(meta.format).toBe('png');
  });
});
```

- [ ] **Step 2 : Lancer les tests (échec attendu)**

Run : `cd backend && npx jest src/services/__tests__/clubLogo.test.ts`
Expected : FAIL — « Cannot find module '../clubLogo' ».

- [ ] **Step 3 : Implémenter le service**

Create `backend/src/services/clubLogo.ts` :

```typescript
import sharp from 'sharp';

// Ré-encodage d'un logo de club uploadé (pattern photos DM) : format réel détecté par sharp
// (le mimetype client n'est plus source de vérité), rotation EXIF appliquée puis métadonnées
// retirées (défaut sharp), redimensionnement plafonné, sortie PNG (transparence + Outlook).

export type LogoKind = 'icon' | 'wide' | 'wideDark';
export type LogoWarning = 'NOT_SQUARE' | 'TOO_SMALL' | 'LOOKS_SQUARE';

export interface ProcessedLogo {
  png: Buffer;
  width: number;
  height: number;
  warnings: LogoWarning[];
}

const CAPS: Record<'icon' | 'wide', [number, number]> = {
  icon: [1024, 1024],
  wide: [1600, 320],
};

export async function processClubLogo(buffer: Buffer, kind: LogoKind): Promise<ProcessedLogo> {
  let meta: sharp.Metadata;
  try {
    meta = await sharp(buffer).metadata();
  } catch {
    throw new Error('VALIDATION_ERROR');
  }
  if (meta.format !== 'jpeg' && meta.format !== 'png' && meta.format !== 'webp') {
    throw new Error('VALIDATION_ERROR');
  }
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (!w || !h) throw new Error('VALIDATION_ERROR');

  const warnings: LogoWarning[] = [];
  if (kind === 'icon') {
    if (Math.max(w, h) / Math.min(w, h) > 1.05) warnings.push('NOT_SQUARE');
    if (Math.min(w, h) < 512) warnings.push('TOO_SMALL');
  } else {
    if (h < 160) warnings.push('TOO_SMALL');
    if (w / h < 1.5) warnings.push('LOOKS_SQUARE');
  }

  const [maxW, maxH] = kind === 'icon' ? CAPS.icon : CAPS.wide;
  let png: Buffer;
  try {
    png = await sharp(buffer)
      .rotate() // oriente selon EXIF puis .png() retire les métadonnées
      .resize(maxW, maxH, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
  } catch {
    throw new Error('VALIDATION_ERROR');
  }
  const out = await sharp(png).metadata();
  return { png, width: out.width ?? 0, height: out.height ?? 0, warnings };
}
```

- [ ] **Step 4 : Lancer les tests (succès attendu)**

Run : `cd backend && npx jest src/services/__tests__/clubLogo.test.ts`
Expected : PASS (6 tests).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/clubLogo.ts backend/src/services/__tests__/clubLogo.test.ts
git commit -m "feat(logos): service de re-encodage + warnings des logos club"
```

---

## Task 3 : Variante `badge-96` monochrome (icon.service + asset de repli)

**Files:**
- Modify: `backend/src/services/icon.service.ts:16-36,69-87`
- Modify: `backend/scripts/generate-pwa-icons.ts:30-51`
- Test: `backend/src/routes/__tests__/icon.routes.test.ts` (ajout)

- [ ] **Step 1 : Ajouter la variante + le rendu badge**

Dans `icon.service.ts`, remplacer l'interface et `ICON_VARIANTS` (lignes 16-23) par :

```typescript
interface IconVariant { size: number; markRatio: number; transparent?: boolean; monochrome?: boolean }
export const ICON_VARIANTS: Record<string, IconVariant> = {
  '192': { size: 192, markRatio: 0.86, transparent: true },
  '512': { size: 512, markRatio: 0.86, transparent: true },
  'maskable-192': { size: 192, markRatio: 0.62 },
  'maskable-512': { size: 512, markRatio: 0.62 },
  'apple-180': { size: 180, markRatio: 0.74 },
  'badge-96': { size: 96, markRatio: 0.9, monochrome: true }, // silhouette blanche Android
};
```

Bump `RENDER_VERSION` (ligne 32) : `const RENDER_VERSION = 'v3-badge';`

Après la fonction `renderIcon` (après la ligne 67), ajouter :

```typescript
// Badge de notification Android : silhouette BLANCHE dérivée du canal alpha du logo.
// null = logo sans transparence réelle (JPEG/PNG à fond plein) → l'appelant sert le
// badge Palova de repli (jamais un carré blanc plein).
async function renderBadge(logo: Buffer, size: number, markRatio: number): Promise<Buffer | null> {
  const inner = Math.round(size * markRatio);
  const resized = await sharp(logo)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha().png().toBuffer();
  const alpha = await sharp(resized).extractChannel(3).toBuffer(); // niveaux de gris = alpha
  const stats = await sharp(alpha).stats();
  if ((stats.channels[0]?.min ?? 255) >= 250) return null; // opaque partout → pas de silhouette
  const whiteMark = await sharp({ create: { width: inner, height: inner, channels: 3, background: '#ffffff' } })
    .joinChannel(alpha).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: whiteMark, gravity: 'centre' }]).png().toBuffer();
}
```

Dans `getClubIconPath`, remplacer le bloc `try` (lignes 78-85) par :

```typescript
    try {
      const logo = await fetchLogo(club.logoUrl);
      const v = ICON_VARIANTS[variant];
      const png = v.monochrome
        ? await renderBadge(logo, v.size, v.markRatio)
        : await renderIcon(logo, club.accentColor, v);
      if (!png) return fallbackIconPath(variant); // badge sans alpha → repli Palova
      fs.writeFileSync(cached, png);
      return cached;
    } catch {
      return fallbackIconPath(variant); // logo injoignable/illisible → icône Palova
    }
```

- [ ] **Step 2 : Générer les PNG de repli badge (Palova)**

Dans `generate-pwa-icons.ts`, après `renderFullBleed` (ligne 28), ajouter :

```typescript
// Badge monochrome Palova : pictogramme blanc sur transparent (repli si le logo club n'a pas d'alpha).
async function renderBadgeMono(size: number, markRatio: number): Promise<Buffer> {
  const markSvg = fs.readFileSync(path.join(FRONT_PUBLIC, 'palova-mark-white.svg'));
  const markSize = Math.round(size * markRatio);
  const mark = await sharp(markSvg, { density: 300 }).resize(markSize, markSize).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: mark, gravity: 'centre' }]).png().toBuffer();
}
```

Dans le tableau `out` (après la ligne 42), ajouter deux entrées :

```typescript
    [path.join(FRONT_PUBLIC, 'icon-badge-96.png'), await renderBadgeMono(96, 0.9)],
    [path.join(BACK_ASSETS, 'icon-badge-96.png'), await renderBadgeMono(96, 0.9)],
```

- [ ] **Step 3 : Exécuter le script + vérifier les assets**

Run : `cd backend && npx ts-node scripts/generate-pwa-icons.ts`
Expected : lignes `OK pwa/icon-badge-96.png — 96x96` et `OK public/icon-badge-96.png — 96x96` (+ les autres inchangées).

- [ ] **Step 4 : Ajouter un test de route pour le badge**

Dans `icon.routes.test.ts`, ajouter avant la dernière accolade du `describe` (après la ligne 111) :

```typescript
  it('badge-96 : logo transparent → silhouette blanche (coin alpha 0)', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ ...CLUB, logoUrl: 'https://logos.example/x.png' } as any);
    const logo = await sharp({ create: { width: 80, height: 80, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } })
      .extend({ top: 20, bottom: 20, left: 20, right: 20, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(new Uint8Array(logo), { status: 200 }) as any);
    const res = await request(app).get('/api/clubs/demo/icon/badge-96.png');
    expect(res.status).toBe(200);
    const meta = await sharp(res.body as Buffer).metadata();
    expect([meta.width, meta.height]).toEqual([96, 96]);
    fetchMock.mockRestore();
  });

  it('badge-96 : logo opaque (sans alpha) → repli Palova (200)', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ ...CLUB, logoUrl: 'https://logos.example/opaque.png' } as any);
    const opaque = await sharp({ create: { width: 96, height: 96, channels: 3, background: '#123456' } }).png().toBuffer();
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(new Uint8Array(opaque), { status: 200 }) as any);
    const res = await request(app).get('/api/clubs/demo/icon/badge-96.png');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    fetchMock.mockRestore();
  });
```

- [ ] **Step 5 : Lancer les tests de route**

Run : `cd backend && npx jest src/routes/__tests__/icon.routes.test.ts`
Expected : PASS (les 2 nouveaux + les existants ; cf. mémoire « 3 icon.routes failures baseline » = à ignorer seulement en worktree isolé, ici en repo principal ils passent).

- [ ] **Step 6 : Commit**

```bash
git add backend/src/services/icon.service.ts backend/scripts/generate-pwa-icons.ts backend/src/routes/__tests__/icon.routes.test.ts backend/assets/pwa/icon-badge-96.png frontend/public/icon-badge-96.png
git commit -m "feat(logos): variante badge-96 monochrome (silhouette alpha, repli Palova)"
```

---

## Task 4 : Routes admin d'upload/suppression par variante

**Files:**
- Modify: `backend/src/routes/admin.ts:654-683`
- Modify: `backend/src/services/club.service.ts:309-311,368` (params `updateClub`)
- Test: `backend/src/routes/__tests__/admin.club-logo.routes.test.ts`

- [ ] **Step 1 : Étendre les params de `updateClub`**

Dans `club.service.ts`, dans le type des params de `updateClub` (ligne 311), après `logoUrl?: string;` ajouter :

```typescript
    logoWideUrl?: string | null; logoWideDarkUrl?: string | null;
```

Dans le `data` de l'update (après la ligne 368, `...(params.logoUrl !== undefined ...`), ajouter :

```typescript
        ...(params.logoWideUrl !== undefined ? { logoWideUrl: params.logoWideUrl } : {}),
        ...(params.logoWideDarkUrl !== undefined ? { logoWideDarkUrl: params.logoWideDarkUrl } : {}),
```

- [ ] **Step 2 : Écrire les tests de route**

Create `backend/src/routes/__tests__/admin.club-logo.routes.test.ts` :

```typescript
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import sharp from 'sharp';

jest.mock('../../utils/uploads', () => {
  const fsm = require('fs'); const pathm = require('path'); const osm = require('os');
  const actual = jest.requireActual('../../utils/uploads');
  const UPLOADS_DIR = fsm.mkdtempSync(pathm.join(osm.tmpdir(), 'palova-logos-'));
  const LOGOS_DIR = pathm.join(UPLOADS_DIR, 'logos');
  return { ...actual, UPLOADS_DIR, LOGOS_DIR, ensureUploadDirs: () => fsm.mkdirSync(LOGOS_DIR, { recursive: true }) };
});

// Auth + appartenance club : le membership est posé par le middleware ; on le mocke ADMIN.
jest.mock('../../middleware/auth', () => ({ authMiddleware: (req: any, _res: any, next: any) => { req.user = { id: 'u1' }; next(); } }));
jest.mock('../../middleware/requireClubMember', () => ({
  requireClubMember: () => (req: any, _res: any, next: any) => { req.membership = { clubId: 'club-1', role: 'ADMIN' }; next(); },
}));

import app from '../../app';

const squarePng = () => sharp({ create: { width: 600, height: 600, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } } }).png().toBuffer();

describe('POST/DELETE /api/clubs/:clubId/admin/club-logo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.club.findUnique.mockResolvedValue({ logoUrl: null, logoWideUrl: null, logoWideDarkUrl: null } as any);
    prismaMock.club.update.mockResolvedValue({} as any);
  });

  it('POST sans variante → persiste logoUrl (icône) + renvoie warnings', async () => {
    const res = await request(app).post('/api/clubs/club-1/admin/club-logo').attach('logo', await squarePng(), 'l.png');
    expect(res.status).toBe(200);
    expect(res.body.logoUrl).toMatch(/^\/uploads\/logos\/club-1-icon-/);
    expect(Array.isArray(res.body.warnings)).toBe(true);
  });

  it('POST /wide → persiste logoWideUrl', async () => {
    const res = await request(app).post('/api/clubs/club-1/admin/club-logo/wide').attach('logo', await squarePng(), 'l.png');
    expect(res.status).toBe(200);
    expect(res.body.logoWideUrl).toMatch(/^\/uploads\/logos\/club-1-wide-/);
  });

  it('POST variante inconnue → 404', async () => {
    const res = await request(app).post('/api/clubs/club-1/admin/club-logo/bogus').attach('logo', await squarePng(), 'l.png');
    expect(res.status).toBe(404);
  });

  it('POST fichier non-image → 400', async () => {
    const res = await request(app).post('/api/clubs/club-1/admin/club-logo').attach('logo', Buffer.from('nope'), 'x.png');
    expect(res.status).toBe(400);
  });

  it('DELETE /wide → remet logoWideUrl à null', async () => {
    const res = await request(app).delete('/api/clubs/club-1/admin/club-logo/wide');
    expect(res.status).toBe(200);
    expect(prismaMock.club.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ logoWideUrl: null }) }));
  });
});
```

- [ ] **Step 3 : Lancer les tests (échec attendu)**

Run : `cd backend && npx jest src/routes/__tests__/admin.club-logo.routes.test.ts`
Expected : FAIL (routes `/wide` et DELETE inexistantes → 404/erreur).

- [ ] **Step 4 : Remplacer le handler `POST /club-logo`**

Dans `admin.ts`, importer le service en tête (à côté des autres imports de services, après la ligne 12) :

```typescript
import { processClubLogo, LogoKind } from '../services/clubLogo';
```

Remplacer tout le bloc `POST /club-logo` (lignes 654-683) par :

```typescript
// Upload d'un logo du club, ré-encodé (PNG, EXIF retirés, plafonné) : icône carrée par défaut,
// ou logotype horizontal (`wide`) / version fond sombre (`wide-dark`). Persiste la colonne
// correspondante immédiatement et renvoie les avertissements non bloquants.
const LOGO_VARIANTS: Record<string, { kind: LogoKind; column: 'logoUrl' | 'logoWideUrl' | 'logoWideDarkUrl' }> = {
  icon:        { kind: 'icon',     column: 'logoUrl' },
  wide:        { kind: 'wide',     column: 'logoWideUrl' },
  'wide-dark': { kind: 'wideDark', column: 'logoWideDarkUrl' },
};
router.post('/club-logo/:variant?', (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  logoUpload.single('logo')(req, res, async (err: unknown) => {
    try {
      if (err) {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          return void res.status(400).json({ error: 'Image trop lourde (2 Mo max)' });
        }
        return next(err as Error);
      }
      const spec = LOGO_VARIANTS[asString(req.params.variant ?? 'icon')];
      if (!spec) return void res.status(404).json({ error: 'Variante de logo inconnue' });
      const file = req.file;
      if (!file) return void res.status(400).json({ error: 'Aucun fichier reçu' });

      let processed;
      try { processed = await processClubLogo(file.buffer, spec.kind); }
      catch { return void res.status(400).json({ error: 'Format d’image non supporté (JPEG, PNG ou WebP)' }); }

      const clubId = req.membership!.clubId;
      const prev = await prisma.club.findUnique({ where: { id: clubId }, select: { [spec.column]: true } as any });
      const filename = `${clubId}-${spec.kind === 'wideDark' ? 'wide-dark' : spec.kind}-${Date.now()}.png`;
      ensureUploadDirs();
      await fs.promises.writeFile(path.join(LOGOS_DIR, filename), processed.png);
      const url = `/uploads/logos/${filename}`;
      await clubService.updateClub(clubId, { [spec.column]: url } as any);

      const prevUrl = (prev as any)?.[spec.column] as string | null | undefined;
      if (prevUrl?.startsWith('/uploads/logos/')) {
        fs.promises.unlink(path.join(LOGOS_DIR, path.basename(prevUrl))).catch(() => {});
      }
      res.json({ [spec.column]: url, warnings: processed.warnings });
    } catch (e) { handleError(e, res, next); }
  });
});

// Suppression d'un logotype optionnel (l'icône carrée n'est que remplaçable).
router.delete('/club-logo/:variant', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const spec = LOGO_VARIANTS[asString(req.params.variant)];
    if (!spec || spec.column === 'logoUrl') return void res.status(404).json({ error: 'Variante de logo inconnue' });
    const clubId = req.membership!.clubId;
    const prev = await prisma.club.findUnique({ where: { id: clubId }, select: { [spec.column]: true } as any });
    await clubService.updateClub(clubId, { [spec.column]: null } as any);
    const prevUrl = (prev as any)?.[spec.column] as string | null | undefined;
    if (prevUrl?.startsWith('/uploads/logos/')) {
      fs.promises.unlink(path.join(LOGOS_DIR, path.basename(prevUrl))).catch(() => {});
    }
    res.json({ [spec.column]: null });
  } catch (e) { handleError(e, res, next); }
});
```

- [ ] **Step 5 : Lancer les tests (succès attendu)**

Run : `cd backend && npx jest src/routes/__tests__/admin.club-logo.routes.test.ts`
Expected : PASS (5 tests).

- [ ] **Step 6 : Commit**

```bash
git add backend/src/routes/admin.ts backend/src/services/club.service.ts backend/src/routes/__tests__/admin.club-logo.routes.test.ts
git commit -m "feat(logos): routes upload/suppression des logos par variante (re-encode + warnings)"
```

---

## Task 5 : Exposer les nouveaux champs (selects club + emails)

**Files:**
- Modify: `backend/src/services/club.service.ts:219,286`
- Modify: `backend/src/email/registry.ts:73-86`
- Modify: `backend/src/email/notifications.ts:17-20`
- Modify: `backend/src/services/emailTemplate.service.ts:99`
- Test: `backend/src/services/__tests__/club.service.test.ts` (ajout), `backend/src/email/__tests__/emails.test.ts` (ajout)

- [ ] **Step 1 : Écrire le test brand (email = wide ?? icon)**

Dans `backend/src/email/__tests__/emails.test.ts`, ajouter un `describe` :

```typescript
import { brandFromClub } from '../registry';

describe('brandFromClub — logotype email', () => {
  const base = { name: 'Padel Arena', accentColor: '#5e93da', slug: 'padel-arena' };
  it('préfère logoWideUrl à logoUrl', () => {
    const b = brandFromClub({ ...base, logoUrl: '/uploads/logos/i.png', logoWideUrl: '/uploads/logos/w.png' } as any);
    expect(b.logoUrl).toContain('/uploads/logos/w.png');
  });
  it('repli sur logoUrl si pas de wide', () => {
    const b = brandFromClub({ ...base, logoUrl: '/uploads/logos/i.png', logoWideUrl: null } as any);
    expect(b.logoUrl).toContain('/uploads/logos/i.png');
  });
});
```

- [ ] **Step 2 : Lancer (échec attendu)**

Run : `cd backend && npx jest src/email/__tests__/emails.test.ts -t "logotype email"`
Expected : FAIL — le second test reçoit `w.png`-agnostic mais le premier échoue (wide ignoré).

- [ ] **Step 3 : Modifier `brandFromClub`**

Dans `registry.ts`, dans la signature (ligne 73-77) ajouter `logoWideUrl` :

```typescript
export function brandFromClub(club: {
  name: string; logoUrl: string | null; logoWideUrl?: string | null; accentColor: string;
  slug?: string | null; address?: string | null; city?: string | null;
  contactPhone?: string | null; contactEmail?: string | null;
}): Brand {
```

Ligne 81, remplacer :

```typescript
    logoUrl: absoluteAsset(club.logoWideUrl ?? club.logoUrl),
```

- [ ] **Step 4 : Ajouter `logoWideUrl` aux selects email**

`notifications.ts` ligne 18 — ajouter `logoWideUrl: true` :

```typescript
  id: true, name: true, slug: true, logoUrl: true, logoWideUrl: true, accentColor: true, timezone: true,
```

`emailTemplate.service.ts` ligne 99 — ajouter `logoWideUrl: true` :

```typescript
      select: { name: true, slug: true, logoUrl: true, logoWideUrl: true, accentColor: true, address: true, city: true, contactPhone: true, contactEmail: true },
```

- [ ] **Step 5 : Ajouter les champs aux selects club public/admin + test**

`club.service.ts` ligne 219 (`getClubBySlug` select), ajouter après `logoUrl: true` :

```typescript
        logoWideUrl: true, logoWideDarkUrl: true,
```

`club.service.ts` ligne 286 (`getClubForAdmin` select), ajouter après `logoUrl: true, coverImageUrl: true,` :

```typescript
        logoWideUrl: true, logoWideDarkUrl: true,
```

Dans `club.service.test.ts`, repérer le test de `getClubForAdmin` (grep `getClubForAdmin`) et ajouter au mock `club.findUniqueOrThrow` retour + assertion que `logoWideUrl`/`logoWideDarkUrl` sont présents dans le select. Modèle minimal si un tel test manque — ajouter :

```typescript
  it('getClubForAdmin sélectionne les logotypes', async () => {
    prismaMock.club.findUniqueOrThrow.mockResolvedValue({ id: 'c', logoWideUrl: '/w.png', logoWideDarkUrl: null } as any);
    await clubService.getClubForAdmin('c');
    const arg = prismaMock.club.findUniqueOrThrow.mock.calls[0][0] as any;
    expect(arg.select.logoWideUrl).toBe(true);
    expect(arg.select.logoWideDarkUrl).toBe(true);
  });
```

- [ ] **Step 6 : Lancer les tests concernés**

Run :
```bash
cd backend && npx jest src/email/__tests__/emails.test.ts src/services/__tests__/club.service.test.ts
```
Expected : PASS.

- [ ] **Step 7 : Commit**

```bash
git add backend/src/services/club.service.ts backend/src/email/registry.ts backend/src/email/notifications.ts backend/src/services/emailTemplate.service.ts backend/src/services/__tests__/club.service.test.ts backend/src/email/__tests__/emails.test.ts
git commit -m "feat(logos): exposer logoWide* dans les selects club + emails (wide ?? icon)"
```

---

## Task 6 : Badge de notification push

**Files:**
- Modify: `backend/src/services/notification/push.ts:27-47`
- Modify: `backend/src/services/notification/dispatcher.ts:79-86`
- Test: `backend/src/services/notification/__tests__/push.test.ts` (ajout), `.../dispatcher.test.ts` (ajout)

- [ ] **Step 1 : Écrire le test `resolvePushBadge`**

Dans `push.test.ts`, ajouter :

```typescript
import { resolvePushBadge } from '../push';

describe('resolvePushBadge', () => {
  it('sans clubId → asset Palova', async () => {
    expect(await resolvePushBadge(null)).toContain('/icon-badge-96.png');
  });
  it('avec clubId → route badge-96 du club', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ slug: 'demo' } as any);
    expect(await resolvePushBadge('c1')).toContain('/api/clubs/demo/icon/badge-96.png');
  });
});
```
(Le fichier importe déjà `prismaMock` — sinon reprendre l'en-tête de `resolvePushIcon`.)

- [ ] **Step 2 : Lancer (échec attendu)**

Run : `cd backend && npx jest src/services/notification/__tests__/push.test.ts -t resolvePushBadge`
Expected : FAIL — « resolvePushBadge is not a function ».

- [ ] **Step 3 : Implémenter le badge**

Dans `push.ts`, ajouter `badge` à `PushPayload` (après la ligne 31) :

```typescript
  badge?: string | null;
```

Après `resolvePushIcon` (après la ligne 47), ajouter :

```typescript
/**
 * Badge Android (silhouette monochrome dans la barre d'état) : variante badge-96 du club
 * (repli Palova géré par la route), ou asset Palova hors contexte club.
 */
export async function resolvePushBadge(clubId?: string | null): Promise<string | null> {
  if (!clubId) return platformAsset('/icon-badge-96.png');
  try {
    const club = await prisma.club.findUnique({ where: { id: clubId }, select: { slug: true } });
    if (!club) return platformAsset('/icon-badge-96.png');
    return absoluteAsset(`/api/clubs/${club.slug}/icon/badge-96.png`);
  } catch {
    return platformAsset('/icon-badge-96.png');
  }
}
```

- [ ] **Step 4 : Transmettre le badge dans le dispatcher**

Dans `dispatcher.ts`, importer `resolvePushBadge` (ligne 6) :

```typescript
import { deliverPush, resolvePushIcon, resolvePushBadge, PushSub } from './push';
```

Remplacer le bloc push (lignes 79-86) :

```typescript
  if (channels.push && subs.length) {
    try {
      const [icon, badge] = await Promise.all([resolvePushIcon(input.clubId), resolvePushBadge(input.clubId)]);
      await deliverPush(subs, { title: input.title, body: input.body, url: input.url ?? null, icon, badge });
    } catch (e) {
      console.error('[notif:push]', (e as Error).message);
    }
  }
```

- [ ] **Step 5 : Compléter le test dispatcher**

Dans `dispatcher.test.ts`, repérer le test qui vérifie l'appel à `deliverPush` et ajouter l'assertion que le payload contient `badge` (ou ajouter un cas). Exemple d'assertion à insérer là où `deliverPush` est mocké :

```typescript
    expect(deliverPush).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ badge: expect.anything() }));
```

- [ ] **Step 6 : Lancer les tests**

Run : `cd backend && npx jest src/services/notification/__tests__/push.test.ts src/services/notification/__tests__/dispatcher.test.ts`
Expected : PASS.

- [ ] **Step 7 : Mettre à jour `sw.js` + commit**

Dans `frontend/public/sw.js` ligne 6, remplacer `badge: '/icon-192.png'` par :

```javascript
    body: data.body || '', data: { url: data.url || '/' }, icon: data.icon || '/icon-192.png', badge: data.badge || '/icon-badge-96.png',
```

```bash
git add backend/src/services/notification/push.ts backend/src/services/notification/dispatcher.ts backend/src/services/notification/__tests__/push.test.ts backend/src/services/notification/__tests__/dispatcher.test.ts frontend/public/sw.js
git commit -m "feat(logos): badge push monochrome par club (resolvePushBadge + sw.js)"
```

---

## Task 7 : Helpers front `lib/clubLogos.ts`

**Files:**
- Create: `frontend/lib/clubLogos.ts`
- Test: `frontend/__tests__/clubLogos.test.ts`

- [ ] **Step 1 : Écrire les tests**

Create `frontend/__tests__/clubLogos.test.ts` :

```typescript
import { iconLogo, wideLogo, LOGO_WARNING_LABEL, clientRatioWarning } from '@/lib/clubLogos';

const c = (o: Partial<{ logoUrl: string | null; logoWideUrl: string | null; logoWideDarkUrl: string | null }>) =>
  ({ logoUrl: null, logoWideUrl: null, logoWideDarkUrl: null, ...o });

describe('clubLogos', () => {
  it('iconLogo lit logoUrl', () => {
    expect(iconLogo(c({ logoUrl: '/i.png', logoWideUrl: '/w.png' }))).toBe('/i.png');
  });
  it('wideLogo clair : wide ?? icon', () => {
    expect(wideLogo(c({ logoUrl: '/i.png' }), 'daylight')).toBe('/i.png');
    expect(wideLogo(c({ logoUrl: '/i.png', logoWideUrl: '/w.png' }), 'daylight')).toBe('/w.png');
  });
  it('wideLogo sombre : dark ?? wide ?? icon', () => {
    expect(wideLogo(c({ logoUrl: '/i.png', logoWideUrl: '/w.png', logoWideDarkUrl: '/d.png' }), 'floodlit')).toBe('/d.png');
    expect(wideLogo(c({ logoUrl: '/i.png', logoWideUrl: '/w.png' }), 'floodlit')).toBe('/w.png');
  });
  it('clientRatioWarning : icône non carrée', () => {
    expect(clientRatioWarning(300, 100, 'icon')).toBe('NOT_SQUARE');
    expect(clientRatioWarning(300, 300, 'icon')).toBeNull();
  });
  it('LOGO_WARNING_LABEL couvre les 3 codes', () => {
    expect(LOGO_WARNING_LABEL.NOT_SQUARE).toBeTruthy();
    expect(LOGO_WARNING_LABEL.TOO_SMALL).toBeTruthy();
    expect(LOGO_WARNING_LABEL.LOOKS_SQUARE).toBeTruthy();
  });
});
```

- [ ] **Step 2 : Lancer (échec attendu)**

Run : `cd frontend && npx jest __tests__/clubLogos.test.ts`
Expected : FAIL — module introuvable.

- [ ] **Step 3 : Implémenter les helpers**

Create `frontend/lib/clubLogos.ts` :

```typescript
import type { ThemeMode } from './theme';

// Règle de repli unique des logos (miroir de la spec) : logoUrl = icône carrée ;
// logotype clair = wide ?? icon ; logotype sombre = dark ?? wide ?? icon.

export type LogoWarning = 'NOT_SQUARE' | 'TOO_SMALL' | 'LOOKS_SQUARE';
export type LogoKind = 'icon' | 'wide' | 'wideDark';

interface ClubLogos {
  logoUrl: string | null;
  logoWideUrl: string | null;
  logoWideDarkUrl: string | null;
}

export function iconLogo(club: ClubLogos): string | null {
  return club.logoUrl;
}

export function wideLogo(club: ClubLogos, mode: ThemeMode): string | null {
  if (mode === 'floodlit') return club.logoWideDarkUrl ?? club.logoWideUrl ?? club.logoUrl;
  return club.logoWideUrl ?? club.logoUrl;
}

export const LOGO_WARNING_LABEL: Record<LogoWarning, string> = {
  NOT_SQUARE: "Votre image n'est pas carrée — elle sera affichée dans un carré.",
  TOO_SMALL: 'Image un peu petite : elle risque d’être floue sur les grands écrans.',
  LOOKS_SQUARE: 'Cette image semble carrée — utilisez plutôt l’emplacement « Icône ».',
};

// Miroir client des seuils serveur (processClubLogo) pour l'alerte persistante sur l'icône en place.
export function clientRatioWarning(w: number, h: number, kind: LogoKind): LogoWarning | null {
  if (!w || !h) return null;
  if (kind === 'icon') {
    if (Math.max(w, h) / Math.min(w, h) > 1.05) return 'NOT_SQUARE';
    if (Math.min(w, h) < 512) return 'TOO_SMALL';
    return null;
  }
  if (h < 160) return 'TOO_SMALL';
  if (w / h < 1.5) return 'LOOKS_SQUARE';
  return null;
}
```

- [ ] **Step 4 : Lancer (succès attendu)**

Run : `cd frontend && npx jest __tests__/clubLogos.test.ts`
Expected : PASS (5 tests).

- [ ] **Step 5 : Commit**

```bash
git add frontend/lib/clubLogos.ts frontend/__tests__/clubLogos.test.ts
git commit -m "feat(logos): helpers front de repli + libellés de warning"
```

---

## Task 8 : Types + client API (variantes + delete)

**Files:**
- Modify: `frontend/lib/api.ts:1308-1309,1599-1600,364-377`

- [ ] **Step 1 : Ajouter les champs aux types**

Dans `ClubDetail` (après la ligne 1308 `logoUrl: string | null;`) :

```typescript
  logoWideUrl: string | null;
  logoWideDarkUrl: string | null;
```

Dans `ClubAdminDetail` (après la ligne 1599 `logoUrl: string | null;`) :

```typescript
  logoWideUrl: string | null;
  logoWideDarkUrl: string | null;
```

- [ ] **Step 2 : Étendre `uploadClubLogo` + ajouter `deleteClubLogoVariant`**

Remplacer `uploadClubLogo` (lignes 364-377) par une version paramétrée. Le type de retour couvre les 3 colonnes possibles + warnings :

```typescript
  // Upload du logo du club en FormData. variant: 'icon' (défaut) | 'wide' | 'wide-dark'.
  uploadClubLogo: async (
    clubId: string, file: File, token: string, variant: 'icon' | 'wide' | 'wide-dark' = 'icon',
  ): Promise<{ logoUrl?: string; logoWideUrl?: string; logoWideDarkUrl?: string; warnings: string[] }> => {
    const form = new FormData();
    form.append('logo', file);
    const path = variant === 'icon' ? 'club-logo' : `club-logo/${variant}`;
    const res = await fetch(`${BASE_URL}/api/clubs/${clubId}/admin/${path}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Upload échoué');
    return res.json();
  },

  // Suppression d'un logotype optionnel (l'icône n'est que remplaçable).
  deleteClubLogoVariant: async (
    clubId: string, variant: 'wide' | 'wide-dark', token: string,
  ): Promise<void> => {
    const res = await fetch(`${BASE_URL}/api/clubs/${clubId}/admin/club-logo/${variant}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Suppression échouée');
  },
```

> ⚠️ Vérifier que l'ancien corps (lignes 364-377, `Promise<{ logoUrl: string }>`) est bien entièrement remplacé — pas de doublon de clé `uploadClubLogo`.

- [ ] **Step 3 : Vérifier les types**

Run : `cd frontend && npx tsc --noEmit 2>&1 | grep -E "api\.ts|clubLogos" | head`
Expected : aucune ligne (les usages existants de `uploadClubLogo(clubId,file,token)` restent valides — 4ᵉ arg optionnel).

- [ ] **Step 4 : Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(logos): types ClubDetail/AdminDetail + uploadClubLogo(variant) + delete"
```

---

## Task 9 : Composant `LogoStudio` (uploads + aperçus)

**Files:**
- Create: `frontend/components/admin/settings/LogoStudio.tsx`
- Test: `frontend/__tests__/LogoStudio.test.tsx`

- [ ] **Step 1 : Écrire les tests**

Create `frontend/__tests__/LogoStudio.test.tsx` :

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { LogoStudio } from '@/components/admin/settings/LogoStudio';

jest.mock('@/lib/theme', () => ({
  useTheme: () => ({ th: new Proxy({}, { get: () => '#000' }) }),
}));
jest.mock('@/lib/api', () => ({ assetUrl: (p: string | null) => p }));

const club = { logoUrl: '/uploads/logos/i.png', logoWideUrl: null, logoWideDarkUrl: null, name: 'Padel Arena', accentColor: '#5e93da' };

function setup(over: Partial<Parameters<typeof LogoStudio>[0]> = {}) {
  const onPick = jest.fn(); const onDelete = jest.fn();
  render(<LogoStudio club={club as any} uploading={null} warnings={{}} onPick={onPick} onDelete={onDelete} {...over} />);
  return { onPick, onDelete };
}

describe('LogoStudio', () => {
  it('affiche les 3 emplacements (icône, logotype, avancé)', () => {
    setup();
    expect(screen.getByText(/Icône carrée/i)).toBeInTheDocument();
    expect(screen.getByText(/Logotype horizontal/i)).toBeInTheDocument();
    expect(screen.getByText(/fond sombre/i)).toBeInTheDocument();
  });

  it('upload icône appelle onPick("icon")', () => {
    const { onPick } = setup();
    const input = screen.getByLabelText(/Choisir l’icône/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'i.png', { type: 'image/png' })] } });
    expect(onPick).toHaveBeenCalledWith('icon', expect.any(File));
  });

  it('affiche le warning serveur sous l’emplacement', () => {
    setup({ warnings: { wide: 'LOOKS_SQUARE' } });
    expect(screen.getByText(/semble carrée/i)).toBeInTheDocument();
  });

  it('Retirer le logotype appelle onDelete("wide")', () => {
    const { onDelete } = setup({ club: { ...club, logoWideUrl: '/uploads/logos/w.png' } as any });
    fireEvent.click(screen.getByRole('button', { name: /Retirer le logotype/i }));
    expect(onDelete).toHaveBeenCalledWith('wide');
  });
});
```

- [ ] **Step 2 : Lancer (échec attendu)**

Run : `cd frontend && npx jest __tests__/LogoStudio.test.tsx`
Expected : FAIL — module introuvable.

- [ ] **Step 3 : Implémenter le composant**

Create `frontend/components/admin/settings/LogoStudio.tsx`. Composant **contrôlé** : reçoit `club`, `uploading` (la variante en cours ou null), `warnings` (par variante), `onPick(variant,file)`, `onDelete(variant)`. Colonne gauche = 3 emplacements ; colonne droite = aperçus sur `HERO_GRADIENT`.

```tsx
'use client';
import { useRef, useState } from 'react';
import { useTheme } from '@/lib/theme';
import { assetUrl } from '@/lib/api';
import { Btn } from '@/components/ui/atoms';
import { HERO_GRADIENT, HERO_INK, HERO_INK_MUTED } from '@/components/agenda/AgendaHero';
import { LOGO_WARNING_LABEL, wideLogo, iconLogo, type LogoWarning } from '@/lib/clubLogos';

type Variant = 'icon' | 'wide' | 'wide-dark';
interface ClubLike {
  logoUrl: string | null; logoWideUrl: string | null; logoWideDarkUrl: string | null;
  name: string; accentColor: string;
}
interface Props {
  club: ClubLike;
  uploading: Variant | null;
  warnings: Partial<Record<Variant, LogoWarning>>;
  onPick: (variant: Variant, file: File) => void;
  onDelete: (variant: Variant) => void;
}

const CHIP: React.CSSProperties = { display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600 };

export function LogoStudio({ club, uploading, warnings, onPick, onDelete }: Props) {
  const { th } = useTheme();
  const [showAdvanced, setShowAdvanced] = useState(!!club.logoWideDarkUrl);
  const iconRef = useRef<HTMLInputElement>(null);
  const wideRef = useRef<HTMLInputElement>(null);
  const darkRef = useRef<HTMLInputElement>(null);

  const chip = (text: string, bg: string, color: string) => (
    <span style={{ ...CHIP, background: bg, color }}>{text}</span>
  );
  const warn = (v: Variant) => warnings[v] ? (
    <div style={{ marginTop: 8, padding: '7px 10px', borderRadius: 9, background: `${th.accentWarm}22`, color: th.text, fontSize: 12.5 }}>
      {LOGO_WARNING_LABEL[warnings[v]!]}
    </div>
  ) : null;

  const hiddenInput = (ref: React.RefObject<HTMLInputElement | null>, v: Variant, label: string) => (
    <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} aria-label={label}
      onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(v, f); e.target.value = ''; }} />
  );

  const iconUrl = assetUrl(iconLogo(club));
  const wideUrlLight = assetUrl(club.logoWideUrl ?? club.logoUrl);
  const wideUrlDark = assetUrl(wideLogo(club, 'floodlit'));

  return (
    <div className="pl-create-grid" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16 }}>
      {/* Colonne gauche — emplacements */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* Icône carrée */}
        <div style={{ background: th.surface2, borderRadius: 14, padding: 14, boxShadow: th.shadow }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            {iconUrl
              ? <img src={iconUrl} alt="Icône du club" style={{ width: 64, height: 64, borderRadius: 14, objectFit: 'contain', background: '#fff', flexShrink: 0 }} />
              : <span style={{ width: 64, height: 64, borderRadius: 14, background: club.accentColor, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 24, flexShrink: 0 }}>{(club.name[0] ?? '?').toUpperCase()}</span>}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <strong style={{ fontSize: 14 }}>Icône carrée</strong>
                {chip('En place ✓', `${th.accent}1f`, th.accent)}
              </div>
              <div style={{ fontSize: 12.5, color: th.textFaint, margin: '3px 0 7px' }}>Le symbole seul, sans texte fin — app installée, notifications, favicon, pastilles.</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
                {chip('PNG / WebP', th.bg, th.text)}{chip('Carré ≥ 512 px', th.bg, th.text)}{chip('Fond transparent', th.bg, th.text)}
              </div>
              <Btn type="button" variant="surface" disabled={uploading === 'icon'} onClick={() => iconRef.current?.click()}>
                {uploading === 'icon' ? 'Envoi…' : 'Changer l’icône'}
              </Btn>
            </div>
          </div>
          {hiddenInput(iconRef, 'icon', 'Choisir l’icône du club')}
          {warn('icon')}
        </div>

        {/* Logotype horizontal */}
        <div style={{ background: th.surface2, borderRadius: 14, padding: 14, boxShadow: th.shadow }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            {wideUrlLight
              ? <img src={wideUrlLight} alt="Logotype du club" style={{ height: 34, maxWidth: 150, objectFit: 'contain', background: '#fff', borderRadius: 8, padding: '2px 6px', flexShrink: 0 }} />
              : <span style={{ fontSize: 12, color: th.textFaint, width: 150 }}>Aucun logotype</span>}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <strong style={{ fontSize: 14 }}>Logotype horizontal</strong>
                {!club.logoWideUrl && chip('Recommandé', `${th.accentWarm}26`, th.text)}
              </div>
              <div style={{ fontSize: 12.5, color: th.textFaint, margin: '3px 0 7px' }}>Votre logo avec le nom — bandeau du site et en-tête des emails. À défaut, l’icône est utilisée.</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
                {chip('PNG / WebP', th.bg, th.text)}{chip('Hauteur ≥ 160 px', th.bg, th.text)}{chip('Fond transparent', th.bg, th.text)}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn type="button" variant="surface" disabled={uploading === 'wide'} onClick={() => wideRef.current?.click()}>
                  {uploading === 'wide' ? 'Envoi…' : club.logoWideUrl ? 'Changer' : 'Ajouter'}
                </Btn>
                {club.logoWideUrl && <Btn type="button" variant="ghost" onClick={() => onDelete('wide')} aria-label="Retirer le logotype">Retirer</Btn>}
              </div>
            </div>
          </div>
          {hiddenInput(wideRef, 'wide', 'Choisir le logotype horizontal')}
          {warn('wide')}
        </div>

        {/* Avancé — version fond sombre */}
        <div style={{ background: th.surface2, borderRadius: 14, padding: 14, boxShadow: th.shadow }}>
          <button type="button" onClick={() => setShowAdvanced((s) => !s)}
            style={{ all: 'unset', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', fontSize: 13, fontWeight: 600, color: th.text }}>
            <span>Avancé — version pour fond sombre</span><span aria-hidden>{showAdvanced ? '▾' : '▸'}</span>
          </button>
          {showAdvanced && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12.5, color: th.textFaint, marginBottom: 8 }}>Si votre logotype est sombre, il disparaît en thème sombre. Uploadez une version claire pour le bandeau nocturne.</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn type="button" variant="surface" disabled={uploading === 'wide-dark'} onClick={() => darkRef.current?.click()}>
                  {uploading === 'wide-dark' ? 'Envoi…' : club.logoWideDarkUrl ? 'Changer' : 'Ajouter'}
                </Btn>
                {club.logoWideDarkUrl && <Btn type="button" variant="ghost" onClick={() => onDelete('wide-dark')} aria-label="Retirer la version sombre">Retirer</Btn>}
              </div>
              {hiddenInput(darkRef, 'wide-dark', 'Choisir le logotype pour fond sombre')}
              {warn('wide-dark')}
            </div>
          )}
        </div>
      </div>

      {/* Colonne droite — aperçus en direct */}
      <div style={{ background: HERO_GRADIENT, borderRadius: 16, padding: 16, color: HERO_INK }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: HERO_INK_MUTED, marginBottom: 10 }}>Aperçu — où vos logos apparaissent</div>

        {/* Bandeau clair */}
        <Preview label="Bandeau du site (clair)" bg="#ffffff" ink="#23314a">
          {wideUrlLight ? <img src={wideUrlLight} alt="" style={{ height: 20, objectFit: 'contain' }} /> : <em style={{ fontSize: 11 }}>logo</em>}
        </Preview>
        {/* Bandeau sombre */}
        <Preview label="Bandeau du site (sombre)" bg="#1c2430" ink="#cfd6e0">
          {wideUrlDark ? <img src={wideUrlDark} alt="" style={{ height: 20, objectFit: 'contain' }} /> : <em style={{ fontSize: 11 }}>logo</em>}
        </Preview>
        {/* Écran d'accueil */}
        <Preview label="Écran d’accueil du téléphone" bg="#1c2430" ink="#cfd6e0">
          <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
            <span style={{ width: 34, height: 34, borderRadius: 9, background: club.accentColor, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              {iconUrl ? <img src={iconUrl} alt="" style={{ width: 28, height: 28, objectFit: 'contain' }} /> : <strong style={{ color: '#fff' }}>{(club.name[0] ?? 'P').toUpperCase()}</strong>}
            </span>
            <span style={{ fontSize: 9 }}>{club.name.slice(0, 12)}</span>
          </span>
        </Preview>
        {/* Notification */}
        <Preview label="Notification" bg="#ffffff" ink="#23314a">
          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ width: 22, height: 22, borderRadius: 6, background: club.accentColor, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {iconUrl ? <img src={iconUrl} alt="" style={{ width: 18, height: 18, objectFit: 'contain' }} /> : null}
            </span>
            <span style={{ fontSize: 10.5, fontWeight: 700 }}>Partie confirmée 🎾</span>
          </span>
        </Preview>
        {/* Email */}
        <Preview label="En-tête des emails" bg="#ffffff" ink="#23314a" last>
          <span style={{ display: 'block', textAlign: 'center' }}>
            {wideUrlLight ? <img src={wideUrlLight} alt="" style={{ height: 18, objectFit: 'contain' }} /> : <strong style={{ fontSize: 11 }}>{club.name}</strong>}
          </span>
        </Preview>
      </div>
    </div>
  );
}

function Preview({ label, bg, ink, last, children }: { label: string; bg: string; ink: string; last?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ background: bg, color: ink, borderRadius: 10, padding: '8px 10px', marginBottom: last ? 0 : 8 }}>
      <div style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 1, opacity: 0.6, marginBottom: 5 }}>{label}</div>
      {children}
    </div>
  );
}
```

> Note : la grille `.pl-create-grid` passe à 2 colonnes ≥ 700 px via `globals.css` (classe existante utilisée par OfferStudio / CreateEventModal). Rien à ajouter au CSS.

- [ ] **Step 4 : Lancer (succès attendu)**

Run : `cd frontend && npx jest __tests__/LogoStudio.test.tsx`
Expected : PASS (4 tests).

- [ ] **Step 5 : Commit**

```bash
git add frontend/components/admin/settings/LogoStudio.tsx frontend/__tests__/LogoStudio.test.tsx
git commit -m "feat(logos): composant LogoStudio (3 emplacements + apercus en contexte)"
```

---

## Task 10 : Brancher `LogoStudio` dans les Réglages

**Files:**
- Modify: `frontend/components/admin/settings/SettingsIdentity.tsx:9-58`
- Modify: `frontend/app/admin/settings/page.tsx:46,117-125,204-205`
- Test: `frontend/__tests__/AdminSettings.test.tsx` (ajout), `AdminSettings.refresh.test.tsx` (mocks)

- [ ] **Step 1 : Adapter la page (état upload par variante + delete)**

Dans `page.tsx`, remplacer l'état `uploading` (ligne 46) par une variante ciblée :

```typescript
  const [uploading, setUploading] = useState<'icon' | 'wide' | 'wide-dark' | null>(null);
```

Remplacer `pickLogo` (lignes 117-125) par un handler paramétré + `deleteLogo` + `logoWarnings` :

```typescript
  const [logoWarnings, setLogoWarnings] = useState<Partial<Record<'icon' | 'wide' | 'wide-dark', string>>>({});

  const pickLogo = async (variant: 'icon' | 'wide' | 'wide-dark', file: File) => {
    if (!token || !clubId) return;
    if (!LOGO_TYPES.includes(file.type)) { setError('Format d’image non supporté (JPEG, PNG ou WebP)'); return; }
    if (file.size > MAX_LOGO_BYTES) { setError('Image trop lourde (2 Mo max)'); return; }
    setError(null); setUploading(variant);
    try {
      const res = await api.uploadClubLogo(clubId, file, token, variant);
      const col = variant === 'icon' ? 'logoUrl' : variant === 'wide' ? 'logoWideUrl' : 'logoWideDarkUrl';
      syncImage({ [col]: (res as any)[col] } as Partial<ClubAdminDetail>);
      setLogoWarnings((w) => ({ ...w, [variant]: res.warnings?.[0] }));
    } catch (e) { setError((e as Error).message); }
    finally { setUploading(null); }
  };

  const deleteLogo = async (variant: 'wide' | 'wide-dark') => {
    if (!token || !clubId) return;
    setUploading(variant);
    try {
      await api.deleteClubLogoVariant(clubId, variant, token);
      const col = variant === 'wide' ? 'logoWideUrl' : 'logoWideDarkUrl';
      syncImage({ [col]: null } as Partial<ClubAdminDetail>);
      setLogoWarnings((w) => ({ ...w, [variant]: undefined }));
    } catch (e) { setError((e as Error).message); }
    finally { setUploading(null); }
  };
```

> ⚠️ `pickCover` reste inchangé mais utilise `setUploading(true)` — remplacer par `setUploading('icon')` ? Non : la couverture n'est pas une variante. Laisser `pickCover` piloter son propre booléen. **Ajouter un état séparé** `const [coverUploading, setCoverUploading] = useState(false);` et faire pointer `pickCover` dessus (remplacer ses `setUploading(true/false)` par `setCoverUploading`). Passer `coverUploading` à `SettingsIdentity` pour le bouton couverture.

- [ ] **Step 2 : Remplacer le bloc logo de `SettingsIdentity`**

Dans `SettingsIdentity.tsx`, changer la signature des props (remplacer `logoInputRef`/`pickLogo`) :

```typescript
interface Props extends SettingsTabProps {
  coverUploading: boolean;
  logoUploading: 'icon' | 'wide' | 'wide-dark' | null;
  logoWarnings: Partial<Record<'icon' | 'wide' | 'wide-dark', string>>;
  onPickLogo: (variant: 'icon' | 'wide' | 'wide-dark', file: File) => void;
  onDeleteLogo: (variant: 'wide' | 'wide-dark') => void;
  coverInputRef: RefObject<HTMLInputElement | null>;
  pickCover: (f: File | undefined) => void;
}
```

Remplacer le bloc « Logo du club » (l'ancien `<div>` lignes 37-58) par :

```tsx
          <LogoStudio
            club={club}
            uploading={logoUploading}
            warnings={logoWarnings as any}
            onPick={onPickLogo}
            onDelete={onDeleteLogo}
          />
```

Ajouter l'import en tête : `import { LogoStudio } from './LogoStudio';`
Adapter le bouton couverture existant pour lire `coverUploading` au lieu de `uploading`.

- [ ] **Step 3 : Câbler la page**

Dans `page.tsx`, le rendu de l'onglet identité (lignes 204-205) :

```tsx
        <SettingsIdentity club={draft} set={set}
          coverUploading={coverUploading} logoUploading={uploading} logoWarnings={logoWarnings}
          onPickLogo={pickLogo} onDeleteLogo={deleteLogo}
          coverInputRef={coverInputRef} pickCover={pickCover} />
```

- [ ] **Step 4 : Mettre à jour les mocks des suites qui montent la page**

Dans `AdminSettings.test.tsx` **et** `AdminSettings.refresh.test.tsx`, le mock `@/lib/api` doit exposer `deleteClubLogoVariant` (et `uploadClubLogo` accepte un 4ᵉ arg — déjà couvert). Ajouter au mock :

```typescript
  deleteClubLogoVariant: jest.fn().mockResolvedValue(undefined),
  uploadClubLogo: jest.fn().mockResolvedValue({ logoUrl: '/uploads/logos/x.png', warnings: [] }),
```

Ajouter un test dans `AdminSettings.test.tsx` :

```typescript
  it('l’onglet Identité rend le studio de logos (3 emplacements)', async () => {
    renderPage(); // helper existant qui monte la page sur ?tab=identite
    expect(await screen.findByText(/Icône carrée/i)).toBeInTheDocument();
    expect(screen.getByText(/Logotype horizontal/i)).toBeInTheDocument();
  });
```

- [ ] **Step 5 : Lancer les suites Réglages**

Run : `cd frontend && npx jest __tests__/AdminSettings.test.tsx __tests__/AdminSettings.refresh.test.tsx`
Expected : PASS.

- [ ] **Step 6 : Vérifier les types**

Run : `cd frontend && npx tsc --noEmit 2>&1 | grep -E "SettingsIdentity|settings/page|LogoStudio" | head`
Expected : aucune ligne.

- [ ] **Step 7 : Commit**

```bash
git add frontend/components/admin/settings/SettingsIdentity.tsx frontend/app/admin/settings/page.tsx frontend/__tests__/AdminSettings.test.tsx frontend/__tests__/AdminSettings.refresh.test.tsx
git commit -m "feat(logos): studio de logos dans l'onglet Identite des Reglages"
```

---

## Task 11 : ClubNav — logotype thème-aware

**Files:**
- Modify: `frontend/components/ClubNav.tsx:43,188-193`
- Test: `frontend/__tests__/ClubNav.test.tsx` (ajout)

- [ ] **Step 1 : Écrire le test**

Dans `ClubNav.test.tsx`, ajouter (adapter au helper de rendu existant qui fournit `club` + `useTheme` mode) :

```typescript
  it('utilise le logotype sombre en thème floodlit', () => {
    // rendre ClubNav avec th.mode = 'floodlit' et un club { logoUrl, logoWideUrl, logoWideDarkUrl }
    renderNav({ mode: 'floodlit', club: { logoUrl: '/i.png', logoWideUrl: '/w.png', logoWideDarkUrl: '/d.png' } });
    const img = screen.getByAltText(/Logo Padel/i) as HTMLImageElement;
    expect(img.src).toContain('/d.png');
  });
```
(Si `ClubNav.test.tsx` n'a pas de helper `renderNav` avec contrôle du mode, utiliser le mock `useTheme` en tête de fichier pour forcer `mode: 'floodlit'` et rendre une seule fois.)

- [ ] **Step 2 : Lancer (échec attendu)**

Run : `cd frontend && npx jest __tests__/ClubNav.test.tsx -t "logotype sombre"`
Expected : FAIL — l'img pointe encore sur `/i.png` (logoUrl).

- [ ] **Step 3 : Modifier ClubNav**

En tête, importer : `import { wideLogo } from '@/lib/clubLogos';`

Ligne 43, remplacer :

```typescript
  const bannerLogo = wideLogo(club, th.mode);
  const showClubLogo = !!bannerLogo && !logoFailed;
```

Lignes 189-192, remplacer la source de l'`img` :

```tsx
            <Link href="/" style={{ display: 'inline-flex', flexShrink: 0 }}>
              <img src={assetUrl(bannerLogo) ?? undefined} alt={`Logo ${club.name}`}
                onError={() => setLogoFailed(true)}
                style={{ height: 24, width: 'auto', objectFit: 'contain', display: 'block' }} />
            </Link>
```

> `club` est de type `ClubDetail` qui porte désormais `logoWideUrl`/`logoWideDarkUrl` (Task 8) — `wideLogo` accepte l'objet tel quel.

- [ ] **Step 4 : Lancer (succès attendu)**

Run : `cd frontend && npx jest __tests__/ClubNav.test.tsx`
Expected : PASS.

- [ ] **Step 5 : Commit**

```bash
git add frontend/components/ClubNav.tsx frontend/__tests__/ClubNav.test.tsx
git commit -m "feat(logos): bandeau ClubNav choisit le logotype selon le theme"
```

---

## Task 12 : Sidebar admin `contain` + favicon club + sw.js

**Files:**
- Modify: `frontend/app/admin/layout.tsx:221-222`
- Modify: `frontend/app/layout.tsx:53-56`
- Test: `frontend/__tests__/AdminLayout.test.tsx` (ajout)

- [ ] **Step 1 : Test sidebar (logo en `contain`, pas `cover`)**

Dans `AdminLayout.test.tsx`, ajouter :

```typescript
  it('le logo de la sidebar est en contain sur tuile blanche (pas rogné)', async () => {
    // monter le layout avec un club { logoUrl: '/i.png' }
    await mountLayout({ club: { logoUrl: '/i.png', name: 'Padel Arena' } });
    const img = screen.getByAltText('Padel Arena') as HTMLImageElement;
    expect(img.style.objectFit).toBe('contain');
  });
```
(Réutiliser le harnais de montage existant du fichier — mocks `useRouter`/`useClub` à identité stable, cf. mémoire.)

- [ ] **Step 2 : Lancer (échec attendu)**

Run : `cd frontend && npx jest __tests__/AdminLayout.test.tsx -t "contain sur tuile"`
Expected : FAIL — `objectFit` vaut `cover`.

- [ ] **Step 3 : Corriger la sidebar**

Dans `admin/layout.tsx`, remplacer le rendu logo (lignes 221-222) par une tuile blanche `contain` :

```tsx
          {club.logoUrl
            ? <span style={{ width: 34, height: 34, borderRadius: 9, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                <img src={assetUrl(club.logoUrl) ?? undefined} alt={club.name} title={club.name} style={{ width: 28, height: 28, objectFit: 'contain' }} />
              </span>
```
(Garder la branche `: ( … pastille initiale … )` existante inchangée.)

- [ ] **Step 4 : Favicon par club**

Dans `app/layout.tsx`, dans `generateMetadata` (lignes 53-56), remplacer `icon: '/favicon.svg'` par un favicon club sur hôte club :

```tsx
    icons: {
      icon: slug ? `${API_URL}/api/clubs/${slug}/icon/192.png` : '/favicon.svg',
      apple: slug ? `${API_URL}/api/clubs/${slug}/icon/apple-180.png` : '/apple-touch-icon.png',
    },
```

- [ ] **Step 5 : Lancer les tests + types**

Run :
```bash
cd frontend && npx jest __tests__/AdminLayout.test.tsx
cd frontend && npx tsc --noEmit 2>&1 | grep -E "admin/layout|app/layout" | head
```
Expected : PASS ; aucune erreur de type.

- [ ] **Step 6 : Commit**

```bash
git add frontend/app/admin/layout.tsx frontend/app/layout.tsx frontend/__tests__/AdminLayout.test.tsx
git commit -m "fix(logos): sidebar admin en contain + favicon par club"
```

---

## Task 13 : Vérification finale (suites + types + visuel)

**Files:** aucun (validation).

- [ ] **Step 1 : Suites backend touchées**

Run :
```bash
cd backend && npx jest src/services/__tests__/clubLogo.test.ts src/routes/__tests__/admin.club-logo.routes.test.ts src/routes/__tests__/icon.routes.test.ts src/services/__tests__/club.service.test.ts src/email/__tests__/emails.test.ts src/services/notification/__tests__/push.test.ts src/services/notification/__tests__/dispatcher.test.ts
```
Expected : toutes PASS.

- [ ] **Step 2 : Suites frontend touchées**

Run :
```bash
cd frontend && npx jest __tests__/clubLogos.test.tsx __tests__/LogoStudio.test.tsx __tests__/AdminSettings.test.tsx __tests__/AdminSettings.refresh.test.tsx __tests__/ClubNav.test.tsx __tests__/AdminLayout.test.tsx
```
Expected : toutes PASS. (Si des suites *real-mount* voisines de ClubNav échouent sur un mock `api` manquant, ajouter `deleteClubLogoVariant` à leur mock — mémoire « ClubNav real-mount test suites ».)

- [ ] **Step 3 : Barrière de types (fichiers modifiés)**

Run :
```bash
cd frontend && npx tsc --noEmit 2>&1 | grep -E "clubLogos|LogoStudio|SettingsIdentity|settings/page|ClubNav|admin/layout|app/layout|api\.ts" | head
cd backend && npx tsc --noEmit 2>&1 | grep -E "clubLogo|icon.service|admin\.ts|club.service|registry|notifications|emailTemplate|push|dispatcher" | head
```
Expected : aucune ligne.

- [ ] **Step 4 : Vérification visuelle (CDP)**

Démarrer la stack (`start.ps1`), se connecter comme OWNER du club seedé (`owner@palova.fr` / `password123` sur `padel-arena-paris.localhost:3000`), aller sur `/admin/settings?tab=identite`. Utiliser le skill **verify** (ou CDP) pour capturer clair + sombre, desktop 1280 + mobile 390 :
- les 3 emplacements sont présents, la colonne d'aperçus se met à jour à l'upload ;
- studio empilé en 390 sans débordement horizontal (`scrollWidth ≤ viewport`) ;
- le favicon d'onglet et le bandeau ClubNav reflètent le logo du club, y compris en thème sombre.

- [ ] **Step 5 : Mettre à jour CLAUDE.md**

Ajouter une entrée « Logos du club multi-formats » dans `CLAUDE.md` (section appropriée) résumant : 3 emplacements, `logoUrl`=icône + `logoWideUrl`/`logoWideDarkUrl`, ré-encodage sharp + warnings, badge-96 monochrome, favicon club, migration `add_club_logo_variants`, fichiers clés et tests. Puis :

```bash
git add CLAUDE.md
git commit -m "docs: logos club multi-formats"
```

---

## Self-review (rempli à l'écriture du plan)

- **Couverture spec** : §1 modèle → Task 1,4,5,8 ; §2.1 ré-encodage → Task 2 ; §2.2 routes → Task 4 ; §2.3 badge → Task 3 ; §2.4 push → Task 6 ; §2.5 emails → Task 5 ; §3 correctifs (sidebar/favicon/ClubNav/badge) → Task 11,12,6 ; §4 UI studio → Task 9,10 ; §5 tests → chaque task + Task 13. ✓
- **Types cohérents** : `LogoKind` (`'icon'|'wide'|'wideDark'`) côté service ; variantes d'URL/route (`'icon'|'wide'|'wide-dark'`) côté HTTP/UI — distinction volontaire (le service prend le *kind*, la route prend le *segment d'URL*). `LogoWarning` partagé (mêmes 3 codes back/front). `wideLogo(club, mode)` prend `ThemeMode` (`'floodlit'|'daylight'`). ✓
- **Pas de placeholder** : chaque step porte le code réel. ✓
- **Point d'attention exécution** : Task 10 Step 1 introduit un `coverUploading` séparé — bien remplacer les `setUploading(true/false)` de `pickCover` par `setCoverUploading`, sinon le bouton couverture partagerait l'état des logos.
