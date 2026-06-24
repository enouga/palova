# Image de couverture du club — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner à chaque club une image de couverture (photo importée OU illustration générée localement) affichée sur la carte d'annuaire et en tête de la page du club.

**Architecture :** Un champ additif `Club.coverImageUrl` (`null` = illustration auto, valeur = photo). Un composant front `ClubCover` rend soit la photo (`<img>`) soit une illustration déterministe (dégradé dérivé de l'accent + nom + sports). Upload calqué sur le logo de club existant. Réglage dans `/admin/settings`.

**Tech Stack :** Prisma 7 (+ PrismaPg), Express 5, multer ; Next.js 16 / React 19, Jest + React Testing Library.

> ⚠️ **OneDrive** : si le repo est synchronisé OneDrive, coupez la synchro avant de coder (cf. CLAUDE.md). Après toute désync : `npm install` + `npx prisma generate`.

---

## File Structure

**Backend**
- `backend/prisma/schema.prisma` — ajoute `coverImageUrl` au modèle `Club` (+ migration).
- `backend/src/utils/uploads.ts` — ajoute `COVERS_DIR` + création du dossier.
- `backend/src/services/club.service.ts` — expose `coverImageUrl` (listClubs / getClubBySlug / getClubForAdmin) + l'accepte dans `updateClub`.
- `backend/src/routes/admin.ts` — route `POST /club-cover` (calquée sur `/club-logo`).
- `backend/src/services/__tests__/club.service.test.ts` — test mapping `listClubs`.
- `backend/src/routes/__tests__/admin.club-cover.routes.test.ts` — test upload (nouveau).

**Frontend**
- `frontend/lib/api.ts` — `coverImageUrl` sur `ClubSummary`/`ClubDetail`/`ClubAdminDetail`/`UpdateClubBody` + `api.uploadClubCover`.
- `frontend/lib/clubCover.ts` — helpers purs (hash, dégradé, initiales) **[nouveau]**.
- `frontend/components/ClubCover.tsx` — rendu photo / illustration **[nouveau]**.
- `frontend/components/ClubCard.tsx` — remplace `<Placeholder>` par `<ClubCover variant="card">`.
- `frontend/components/ClubHouse.tsx` — bannière `<ClubCover variant="banner">` en tête.
- `frontend/app/admin/settings/page.tsx` — bloc « Image de couverture ».
- `frontend/__tests__/clubCover.test.ts` — helpers purs **[nouveau]**.
- `frontend/__tests__/ClubCover.test.tsx` — rendu **[nouveau]**.

---

## Task 1: Champ `coverImageUrl` + migration

**Files:**
- Modify: `backend/prisma/schema.prisma` (modèle `Club`, après `logoUrl`)

- [ ] **Step 1: Ajouter le champ au schéma**

Dans `backend/prisma/schema.prisma`, juste après la ligne `logoUrl String? @map("logo_url")` du modèle `Club` :

```prisma
  coverImageUrl    String?    @map("cover_image_url") // couverture club (annuaire + page) ; null = illustration auto-générée
```

- [ ] **Step 2: Créer et appliquer la migration**

Depuis `backend/` :

Run: `npx prisma migrate dev --name add_club_cover_image`
Expected: migration créée + appliquée, puis `prisma generate` auto. 

> Si la commande échoue pour cause de dérive d'historique (cf. note `reservation_series` dans CLAUDE.md), repli **DEV uniquement** : `npx prisma db push` puis `npx prisma generate`.

- [ ] **Step 3: Vérifier la génération du client**

Run: `npx prisma generate`
Expected: « Generated Prisma Client ». Le type `Club` connaît désormais `coverImageUrl`.

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(reserve): champ Club.coverImageUrl (migration add_club_cover_image)"
```

---

## Task 2: Service expose et accepte `coverImageUrl`

**Files:**
- Test: `backend/src/services/__tests__/club.service.test.ts`
- Modify: `backend/src/services/club.service.ts`

- [ ] **Step 1: Écrire le test (mapping listClubs)**

Ajouter à la fin de `backend/src/services/__tests__/club.service.test.ts` :

```ts
describe('ClubService — annuaire (listClubs)', () => {
  let svc: ClubService;
  beforeEach(() => { svc = new ClubService(); });

  it('demande et expose coverImageUrl pour chaque club', async () => {
    prismaMock.club.findMany.mockResolvedValue([
      {
        id: 'c1', slug: 'demo', name: 'Padel Arena', city: 'Paris', description: null,
        accentColor: '#d6ff3f', logoUrl: null, coverImageUrl: '/uploads/covers/c1-1.jpg',
        clubSports: [{ sport: { key: 'padel', name: 'Padel', icon: '🎾' } }],
        _count: { resources: 3 },
      },
    ] as any);

    const [club] = await svc.listClubs({});
    expect(club.coverImageUrl).toBe('/uploads/covers/c1-1.jpg');
    const arg = (prismaMock.club.findMany as jest.Mock).mock.calls[0][0];
    expect(arg.select.coverImageUrl).toBe(true);
  });
});
```

- [ ] **Step 2: Lancer le test → échec**

Run (depuis `backend/`): `npx jest club.service -t "annuaire" `
Expected: FAIL — `club.coverImageUrl` vaut `undefined` (select ne le demande pas, mapping ne le renvoie pas).

- [ ] **Step 3: Implémenter**

Dans `backend/src/services/club.service.ts`, méthode `listClubs` :

- Dans le `select`, ajouter `coverImageUrl: true,` à côté de `logoUrl: true,` :

```ts
        id: true, slug: true, name: true, city: true, description: true, accentColor: true, logoUrl: true, coverImageUrl: true,
```

- Dans le `.map(...)`, ajouter `coverImageUrl`:

```ts
    return clubs.map((c) => ({
      id: c.id, slug: c.slug, name: c.name, city: c.city, description: c.description,
      accentColor: c.accentColor, logoUrl: c.logoUrl, coverImageUrl: c.coverImageUrl,
      sports: c.clubSports.map((cs) => cs.sport),
      resourceCount: c._count.resources,
    }));
```

Méthode `getClubBySlug` : ajouter `coverImageUrl: true,` dans le `select` (à côté de `logoUrl: true`).

Méthode `getClubForAdmin` : ajouter `coverImageUrl: true,` dans le `select` (à côté de `logoUrl: true`).

Méthode `updateClub` :
- Dans la signature `params`, après `logoUrl?: string;`, ajouter :

```ts
    coverImageUrl?: string | null;
```

- Dans l'objet `data`, après la ligne `...(params.logoUrl !== undefined ? { logoUrl: params.logoUrl } : {}),`, ajouter :

```ts
        ...(params.coverImageUrl !== undefined ? { coverImageUrl: params.coverImageUrl || null } : {}),
```

(`|| null` : une chaîne vide « efface » → illustration auto.)

- [ ] **Step 4: Lancer le test → succès**

Run: `npx jest club.service -t "annuaire"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/club.service.ts backend/src/services/__tests__/club.service.test.ts
git commit -m "feat(reserve): expose/accepte coverImageUrl dans ClubService"
```

---

## Task 3: Route d'upload `POST /club-cover`

**Files:**
- Modify: `backend/src/utils/uploads.ts`
- Test: `backend/src/routes/__tests__/admin.club-cover.routes.test.ts` (créer)
- Modify: `backend/src/routes/admin.ts`

- [ ] **Step 1: Ajouter `COVERS_DIR`**

Dans `backend/src/utils/uploads.ts`, après `export const LOGOS_DIR = ...` :

```ts
export const COVERS_DIR = path.join(UPLOADS_DIR, 'covers'); // couvertures de clubs uploadées
```

Et dans `ensureUploadDirs()`, après `fs.mkdirSync(LOGOS_DIR, { recursive: true });` :

```ts
  fs.mkdirSync(COVERS_DIR, { recursive: true });
```

- [ ] **Step 2: Écrire le test d'upload**

Créer `backend/src/routes/__tests__/admin.club-cover.routes.test.ts` :

```ts
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';

// Les fichiers uploadés vont dans un tmpdir (jamais dans le repo pendant les tests).
jest.mock('../../utils/uploads', () => {
  const fsm = require('fs');
  const pathm = require('path');
  const osm = require('os');
  const actual = jest.requireActual('../../utils/uploads');
  const UPLOADS_DIR = fsm.mkdtempSync(pathm.join(osm.tmpdir(), 'palova-covers-'));
  const COVERS_DIR = pathm.join(UPLOADS_DIR, 'covers');
  return {
    ...actual,
    UPLOADS_DIR, COVERS_DIR,
    ensureUploadDirs: () => { fsm.mkdirSync(COVERS_DIR, { recursive: true }); },
  };
});

import app from '../../app';

const SECRET = process.env.JWT_SECRET!;
if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET manquant dans l environnement de test (.env)');
const token = jwt.sign({ id: 'admin-1', email: 'a@x.fr' }, SECRET, { expiresIn: '1h' });
const url = '/api/clubs/club-demo/admin/club-cover';
const asMember = (role = 'OWNER') => prismaMock.clubMember.findUnique.mockResolvedValue({ role } as any);

describe('POST /api/clubs/:clubId/admin/club-cover', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('200 enregistre la couverture et renvoie un chemin /uploads/covers/...', async () => {
    asMember();
    prismaMock.club.findUnique.mockResolvedValue({ coverImageUrl: null } as any);
    prismaMock.club.update.mockResolvedValue({ id: 'club-demo' } as any);

    const res = await request(app).post(url)
      .set('Authorization', `Bearer ${token}`)
      .attach('cover', Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'cover.png');

    expect(res.status).toBe(200);
    expect(res.body.coverImageUrl).toMatch(/^\/uploads\/covers\/club-demo-\d+\.png$/);
    expect(prismaMock.club.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'club-demo' },
      data: expect.objectContaining({ coverImageUrl: res.body.coverImageUrl }),
    }));
  });

  it('400 si le format n est pas une image supportée', async () => {
    asMember();
    const res = await request(app).post(url)
      .set('Authorization', `Bearer ${token}`)
      .attach('cover', Buffer.from('coucou'), 'note.txt');
    expect(res.status).toBe(400);
  });

  it('403 si l utilisateur n est pas membre du club', async () => {
    prismaMock.clubMember.findUnique.mockResolvedValue(null as any);
    const res = await request(app).post(url)
      .set('Authorization', `Bearer ${token}`)
      .attach('cover', Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'cover.png');
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 3: Lancer le test → échec**

Run: `npx jest admin.club-cover`
Expected: FAIL — route 404 (n'existe pas encore).

- [ ] **Step 4: Implémenter la route**

Dans `backend/src/routes/admin.ts` :

- Compléter l'import depuis `../utils/uploads` en ajoutant `COVERS_DIR` :

```ts
import { SPONSORS_DIR, LOGOS_DIR, COVERS_DIR, EXT_BY_MIME, ensureUploadDirs } from '../utils/uploads';
```

- Juste après la route `router.post('/club-logo', ...)` (qui se termine par `});`), ajouter :

```ts
// Upload de la couverture du club (JPEG/PNG/WebP, 2 Mo max) : persiste club.coverImageUrl immédiatement.
router.post('/club-cover', (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  logoUpload.single('cover')(req, res, async (err: unknown) => {
    try {
      if (err) {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          return void res.status(400).json({ error: 'Image trop lourde (2 Mo max)' });
        }
        return next(err as Error);
      }
      const file = req.file;
      const ext = file && EXT_BY_MIME[file.mimetype];
      if (!file || !ext) {
        return void res.status(400).json({ error: 'Format d’image non supporté (JPEG, PNG ou WebP)' });
      }
      const clubId = req.membership!.clubId;
      const prev = await prisma.club.findUnique({ where: { id: clubId }, select: { coverImageUrl: true } });
      const filename = `${clubId}-${Date.now()}.${ext}`;
      ensureUploadDirs();
      await fs.promises.writeFile(path.join(COVERS_DIR, filename), file.buffer);
      const coverImageUrl = `/uploads/covers/${filename}`;
      await clubService.updateClub(clubId, { coverImageUrl });
      // Nettoyage best-effort de l'ancienne couverture uploadée (jamais bloquant).
      if (prev?.coverImageUrl?.startsWith('/uploads/covers/')) {
        fs.promises.unlink(path.join(COVERS_DIR, path.basename(prev.coverImageUrl))).catch(() => {});
      }
      res.json({ coverImageUrl });
    } catch (e) { handleError(e, res, next); }
  });
});
```

- [ ] **Step 5: Lancer le test → succès**

Run: `npx jest admin.club-cover`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/src/utils/uploads.ts backend/src/routes/admin.ts backend/src/routes/__tests__/admin.club-cover.routes.test.ts
git commit -m "feat(reserve): route POST /admin/club-cover (upload couverture club)"
```

---

## Task 4: Types front + `api.uploadClubCover`

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Ajouter le champ aux 4 interfaces**

Dans `frontend/lib/api.ts` :

- `interface ClubSummary` — après `logoUrl: string | null;` ajouter :

```ts
  coverImageUrl: string | null;
```

- `interface ClubDetail` — après `logoUrl: string | null;` ajouter `coverImageUrl: string | null;`.

- `interface ClubAdminDetail` — après `logoUrl: string | null;` ajouter `coverImageUrl: string | null;`.

- `type UpdateClubBody = Partial<{ ... }>` — après `logoUrl: string;` ajouter `coverImageUrl: string | null;`.

- [ ] **Step 2: Ajouter `api.uploadClubCover`**

Dans l'objet `api`, juste après la méthode `uploadClubLogo: async (...) => { ... },`, ajouter :

```ts
  // Upload de la couverture du club en FormData — fetch dédié. Persiste côté serveur.
  uploadClubCover: async (clubId: string, file: File, token: string): Promise<{ coverImageUrl: string }> => {
    const form = new FormData();
    form.append('cover', file);
    const res = await fetch(`${BASE_URL}/api/clubs/${clubId}/admin/club-cover`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.json();
  },
```

- [ ] **Step 3: Vérifier la compilation des types**

Run (depuis `frontend/`): `npx tsc --noEmit`
Expected: aucune erreur **nouvelle** liée à `coverImageUrl` (les mocks de tests seront mis à jour aux tâches suivantes).

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(reserve): types coverImageUrl + api.uploadClubCover"
```

---

## Task 5: Helpers purs `lib/clubCover.ts`

**Files:**
- Test: `frontend/__tests__/clubCover.test.ts` (créer)
- Create: `frontend/lib/clubCover.ts`

- [ ] **Step 1: Écrire le test**

Créer `frontend/__tests__/clubCover.test.ts` :

```ts
import { coverHash, coverGradient, coverInitials } from '../lib/clubCover';

describe('coverHash', () => {
  it('est déterministe', () => {
    expect(coverHash('demo')).toBe(coverHash('demo'));
  });
});

describe('coverGradient', () => {
  it('est déterministe pour un même (slug, accent)', () => {
    expect(coverGradient('demo', '#d6ff3f')).toEqual(coverGradient('demo', '#d6ff3f'));
  });

  it('from = la couleur d’accent normalisée en hex', () => {
    expect(coverGradient('demo', '#d6ff3f').from.toLowerCase()).toBe('#d6ff3f');
  });

  it('renvoie un angle multiple de 45 dans [0,360)', () => {
    const { angle } = coverGradient('demo', '#d6ff3f');
    expect(angle % 45).toBe(0);
    expect(angle).toBeGreaterThanOrEqual(0);
    expect(angle).toBeLessThan(360);
  });

  it('distingue des slugs différents (≥2 dégradés distincts sur 6 slugs)', () => {
    const css = ['a', 'b', 'c', 'd', 'e', 'f'].map((s) => JSON.stringify(coverGradient(s, '#d6ff3f')));
    expect(new Set(css).size).toBeGreaterThanOrEqual(2);
  });

  it('accent invalide → ne jette pas (repli gris)', () => {
    expect(() => coverGradient('demo', 'pas-une-couleur')).not.toThrow();
  });
});

describe('coverInitials', () => {
  it('deux mots → deux initiales', () => {
    expect(coverInitials('Padel Arena')).toBe('PA');
  });
  it('un mot → deux premières lettres', () => {
    expect(coverInitials('Padelclub')).toBe('PA');
  });
  it('vide → ?', () => {
    expect(coverInitials('   ')).toBe('?');
  });
});
```

- [ ] **Step 2: Lancer le test → échec**

Run (depuis `frontend/`): `npx jest clubCover.test`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter `lib/clubCover.ts`**

Créer `frontend/lib/clubCover.ts` :

```ts
// Illustration de couverture déterministe d'un club (le « par IA », 100 % local) :
// dégradé dérivé de la couleur d'accent + slug, jamais stocké. Même (slug, accent) → même rendu.

// Hash FNV-1a 32 bits (même algo que lib/playerColors), local pour rester pur et sans dépendance.
export function coverHash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function clampByte(n: number): number { return Math.max(0, Math.min(255, Math.round(n))); }

function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [128, 128, 128]; // repli gris si couleur invalide
  const int = parseInt(m[1], 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

function toHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((x) => clampByte(x).toString(16).padStart(2, '0')).join('');
}

function mix(a: [number, number, number], b: [number, number, number], t: number): string {
  return toHex(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
}

const DARK: [number, number, number] = [16, 19, 26]; // #10131a

export function coverGradient(seed: string, accentColor: string): { angle: number; from: string; to: string } {
  const h = coverHash(seed);
  const angle = (h % 8) * 45;                     // 0,45,…,315 — direction variée par club
  const factor = 0.45 + ((h >>> 3) % 21) / 100;   // 0.45..0.65 — profondeur du fondu vers le sombre
  const accent = parseHex(accentColor);
  return { angle, from: toHex(accent[0], accent[1], accent[2]), to: mix(accent, DARK, factor) };
}

export function coverInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
```

- [ ] **Step 4: Lancer le test → succès**

Run: `npx jest clubCover.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/clubCover.ts frontend/__tests__/clubCover.test.ts
git commit -m "feat(reserve): helpers purs clubCover (hash, dégradé, initiales)"
```

---

## Task 6: Composant `ClubCover.tsx`

**Files:**
- Test: `frontend/__tests__/ClubCover.test.tsx` (créer)
- Create: `frontend/components/ClubCover.tsx`

- [ ] **Step 1: Écrire le test de rendu**

Créer `frontend/__tests__/ClubCover.test.tsx` :

```tsx
import { render, screen } from '@testing-library/react';
import { ClubCover } from '../components/ClubCover';
import { ThemeProvider } from '../lib/ThemeProvider';

const base = { name: 'Padel Arena', slug: 'demo', accentColor: '#d6ff3f', coverImageUrl: null as string | null };
const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('ClubCover', () => {
  it('avec coverImageUrl → rend une <img> de la photo', () => {
    wrap(<ClubCover variant="card" club={{ ...base, coverImageUrl: '/uploads/covers/c1.jpg' }} />);
    const img = screen.getByRole('img', { name: /Couverture Padel Arena/ });
    expect(img.getAttribute('src')).toContain('/uploads/covers/c1.jpg');
  });

  it('sans coverImageUrl (card) → illustration générée avec les initiales', () => {
    wrap(<ClubCover variant="card" club={base} />);
    expect(screen.getByTestId('club-cover')).toBeInTheDocument();
    expect(screen.getByText('PA')).toBeInTheDocument();
  });

  it('variant banner → superpose le nom du club', () => {
    wrap(<ClubCover variant="banner" club={base} />);
    expect(screen.getByText('Padel Arena')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Lancer le test → échec**

Run: `npx jest ClubCover.test`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter `components/ClubCover.tsx`**

Créer `frontend/components/ClubCover.tsx` :

```tsx
'use client';
import { assetUrl } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { coverGradient, coverInitials } from '@/lib/clubCover';

export type CoverClub = {
  name: string;
  slug: string;
  accentColor: string;
  coverImageUrl: string | null;
  sportIcons?: (string | null)[];
  logoUrl?: string | null;
};

// Couverture d'un club : photo importée (<img>) ou illustration générée déterministe
// (dégradé accent + lignes de court + emoji sport + initiales). variant=card (annuaire)
// ou banner (en-tête de page club, avec logo + nom superposés).
export function ClubCover({ club, variant }: { club: CoverClub; variant: 'card' | 'banner' }) {
  const { th } = useTheme();
  const height = variant === 'banner' ? 160 : 104;
  const src = assetUrl(club.coverImageUrl);

  if (src) {
    return (
      <div data-testid="club-cover" style={{ position: 'relative', height, overflow: 'hidden' }}>
        <img src={src} alt={`Couverture ${club.name}`}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        {variant === 'banner' && <BannerOverlay club={club} />}
      </div>
    );
  }

  const { angle, from, to } = coverGradient(club.slug, club.accentColor);
  const sportIcon = (club.sportIcons ?? []).find(Boolean) ?? null;
  return (
    <div data-testid="club-cover" style={{
      position: 'relative', height, overflow: 'hidden',
      background: `linear-gradient(${angle}deg, ${from}, ${to})`,
    }}>
      <svg viewBox="0 0 200 120" preserveAspectRatio="none" aria-hidden="true"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.16 }}>
        <g fill="none" stroke="#ffffff" strokeWidth="1.5">
          <rect x="14" y="10" width="172" height="100" />
          <line x1="100" y1="10" x2="100" y2="110" />
          <line x1="14" y1="40" x2="186" y2="40" />
          <line x1="14" y1="80" x2="186" y2="80" />
        </g>
      </svg>
      {sportIcon && (
        <span aria-hidden="true" style={{ position: 'absolute', right: 12, bottom: 8, fontSize: variant === 'banner' ? 44 : 30, opacity: 0.5 }}>{sportIcon}</span>
      )}
      {variant === 'card' ? (
        <span style={{ position: 'absolute', left: 14, bottom: 6, fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 34, color: '#ffffff', opacity: 0.92, letterSpacing: -1, textShadow: '0 1px 8px rgba(0,0,0,0.25)' }}>
          {coverInitials(club.name)}
        </span>
      ) : (
        <BannerOverlay club={club} />
      )}
    </div>
  );
}

function BannerOverlay({ club }: { club: CoverClub }) {
  const { th } = useTheme();
  const logo = assetUrl(club.logoUrl ?? null);
  return (
    <>
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.55), rgba(0,0,0,0) 60%)' }} />
      <div style={{ position: 'absolute', left: 16, right: 16, bottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
        {logo ? (
          <img src={logo} alt="" style={{ width: 44, height: 44, borderRadius: 12, objectFit: 'contain', background: '#fff', flexShrink: 0 }} />
        ) : (
          <span style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0, background: club.accentColor, color: '#10131a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 20 }}>
            {coverInitials(club.name)}
          </span>
        )}
        <span style={{ fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 26, color: '#ffffff', letterSpacing: -0.4, textShadow: '0 1px 10px rgba(0,0,0,0.4)' }}>{club.name}</span>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Lancer le test → succès**

Run: `npx jest ClubCover.test`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/ClubCover.tsx frontend/__tests__/ClubCover.test.tsx
git commit -m "feat(reserve): composant ClubCover (photo ou illustration générée)"
```

---

## Task 7: Carte d'annuaire — utiliser `ClubCover`

**Files:**
- Modify: `frontend/components/ClubCard.tsx`

- [ ] **Step 1: Remplacer le Placeholder**

Dans `frontend/components/ClubCard.tsx` :

- Import : remplacer `import { Chip, Placeholder } from '@/components/ui/atoms';` par :

```tsx
import { Chip } from '@/components/ui/atoms';
import { ClubCover } from '@/components/ClubCover';
```

- Dans le JSX, remplacer la ligne :

```tsx
          <Placeholder label={club.name} height={104} radius={0} />
```

par :

```tsx
          <ClubCover variant="card" club={{
            name: club.name, slug: club.slug, accentColor: club.accentColor,
            coverImageUrl: club.coverImageUrl, sportIcons: club.sports.map((s) => s.icon),
          }} />
```

- [ ] **Step 2: Vérifier la suite d'annuaire**

Run (depuis `frontend/`): `npx jest ClubDirectory.test`
Expected: PASS (la suite mocke `ClubCard`, donc inchangée — sert de garde-fou).

- [ ] **Step 3: Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: pas d'erreur sur `ClubCard`.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/ClubCard.tsx
git commit -m "feat(reserve): carte d'annuaire illustrée par ClubCover"
```

---

## Task 8: Bannière en tête de la page club

**Files:**
- Modify: `frontend/components/ClubHouse.tsx`

- [ ] **Step 1: Ajouter l'import**

Dans `frontend/components/ClubHouse.tsx`, après les imports de composants clubhouse (après `import { MatchesForYou } ...`) :

```tsx
import { ClubCover } from '@/components/ClubCover';
```

- [ ] **Step 2: Insérer la bannière en tête du rendu**

Repérer le `return (` du composant et le fragment `<>`. Juste après `<>`, **avant** `{hero && <HeroAnnouncement announcement={hero} />}`, insérer :

```tsx
      <ClubCover variant="banner" club={{
        name: club.name, slug: club.slug, accentColor: club.accentColor,
        coverImageUrl: club.coverImageUrl,
        sportIcons: club.clubSports.map((cs) => cs.sport.icon),
        logoUrl: club.logoUrl,
      }} />
```

- [ ] **Step 3: Vérifier la compilation + tests existants**

Run (depuis `frontend/`): `npx tsc --noEmit`
Expected: pas d'erreur (`ClubDetail` expose désormais `coverImageUrl`, `clubSports[].sport.icon`, `logoUrl`).

Run: `npx jest ClubHouse`
Expected: PASS si une suite existe ; sinon « No tests found » (acceptable — pas de suite dédiée).

- [ ] **Step 4: Commit**

```bash
git add frontend/components/ClubHouse.tsx
git commit -m "feat(reserve): bannière de couverture en tête de la page club"
```

---

## Task 9: Réglage admin « Image de couverture »

**Files:**
- Modify: `frontend/app/admin/settings/page.tsx`

- [ ] **Step 1: Importer `ClubCover`**

Dans `frontend/app/admin/settings/page.tsx`, après `import { Btn } from '@/components/ui/atoms';` :

```tsx
import { ClubCover } from '@/components/ClubCover';
```

- [ ] **Step 2: Ref + handler d'upload**

Après `const logoInputRef = useRef<HTMLInputElement>(null);`, ajouter :

```tsx
  const coverInputRef = useRef<HTMLInputElement>(null);
```

Après la fonction `pickLogo` (juste avant le commentaire « Plages d'heures creuses… »), ajouter :

```tsx
  // Upload de la couverture du club : persiste côté serveur puis met à jour l'aperçu.
  const pickCover = async (file: File | undefined) => {
    if (!file || !token || !clubId) return;
    if (!LOGO_TYPES.includes(file.type)) { setError('Format d’image non supporté (JPEG, PNG ou WebP)'); return; }
    if (file.size > MAX_LOGO_BYTES) { setError('Image trop lourde (2 Mo max)'); return; }
    setError(null);
    setUploading(true);
    try {
      const res = await api.uploadClubCover(clubId, file, token);
      set('coverImageUrl', res.coverImageUrl);
    } catch (e) { setError((e as Error).message); }
    finally { setUploading(false); }
  };
```

- [ ] **Step 3: Envoyer `coverImageUrl` dans la sauvegarde**

Dans la fonction `save`, dans l'objet `body: UpdateClubBody`, après `logoUrl: club.logoUrl ?? '',`, ajouter :

```tsx
        coverImageUrl: club.coverImageUrl,
```

(Le bouton « illustration automatique » met `coverImageUrl` à `null` ; `updateClub` mappe `null`/'' → illustration auto.)

- [ ] **Step 4: Ajouter le bloc UI**

Dans la section « Identité visuelle », **après** le bloc du logo (le `<div>` qui se termine après le bouton « Changer le logo » et son `<span>` d'aide) et **avant** le bloc « Couleur d'accent », insérer :

```tsx
          <div>
            <span style={label}>Image de couverture</span>
            <p style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, margin: '0 0 10px' }}>
              Illustre votre club dans l’annuaire et en tête de votre page. Sans photo, une illustration est générée automatiquement à partir de votre couleur et de vos sports.
            </p>
            <div style={{ borderRadius: 14, overflow: 'hidden', border: `1px solid ${th.line}`, marginBottom: 10, opacity: uploading ? 0.5 : 1 }}>
              <ClubCover variant="card" club={{
                name: club.name, slug: club.slug, accentColor: club.accentColor,
                coverImageUrl: club.coverImageUrl, logoUrl: club.logoUrl, sportIcons: [],
              }} />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input ref={coverInputRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }}
                aria-label="Choisir une image de couverture"
                onChange={(e) => { pickCover(e.target.files?.[0]); e.target.value = ''; }} />
              <Btn type="button" variant="surface" disabled={uploading} onClick={() => coverInputRef.current?.click()}>
                {uploading ? 'Envoi…' : 'Importer une photo'}
              </Btn>
              {club.coverImageUrl && (
                <Btn type="button" variant="ghost" disabled={uploading} onClick={() => set('coverImageUrl', null)}>
                  Utiliser l’illustration automatique
                </Btn>
              )}
            </div>
            <span style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textFaint, display: 'block', marginTop: 6 }}>JPEG, PNG ou WebP · 2 Mo max</span>
          </div>
```

- [ ] **Step 5: Vérifier la compilation**

Run (depuis `frontend/`): `npx tsc --noEmit`
Expected: pas d'erreur (`ClubAdminDetail` expose `coverImageUrl`, `slug`, `logoUrl`).

> Si une suite de tests mocke `@/lib/api` pour la page settings et tombe en échec, exposer `uploadClubCover` et `assetUrl` dans le mock (cf. note CLAUDE.md sur `assetUrl`). Aucune suite n'existe à ce jour pour cette page.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/admin/settings/page.tsx
git commit -m "feat(reserve): réglage admin « Image de couverture » (photo ou illustration auto)"
```

---

## Task 10: Vérification finale

- [ ] **Step 1: Suite backend**

Run (depuis `backend/`): `npm test`
Expected: vert (dont `club.service`, `admin.club-cover`).

- [ ] **Step 2: Suite frontend**

Run (depuis `frontend/`): `npm test`
Expected: vert (dont `clubCover`, `ClubCover`, `ClubDirectory`).

- [ ] **Step 3: Lint / types front**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 4: Vérification manuelle (optionnelle mais recommandée)**

Démarrer back + front (cf. CLAUDE.md), puis :
- `/clubs` → les cartes montrent l'illustration générée (clubs sans photo).
- Page d'un club → bannière en tête avec logo + nom.
- `/admin/settings` → « Image de couverture » : importer une photo (apparaît partout), puis « Utiliser l'illustration automatique » + Enregistrer (revient à l'illustration).

---

## Spec coverage (self-review)

- Modèle additif `coverImageUrl` → Task 1. ✔
- Exposition listClubs / getClubBySlug / getClubForAdmin + updateClub → Task 2. ✔
- Upload `/club-cover` + `COVERS_DIR` (prod : volume `backend_uploads` déjà monté) → Task 3. ✔
- Types front + `uploadClubCover` → Task 4. ✔
- Helpers purs déterministes → Task 5. ✔
- Composant `ClubCover` (photo / illustration, variant card+banner) → Task 6. ✔
- Carte d'annuaire → Task 7. ✔
- Bannière page club (logo + nom superposés, défaut = illustration auto) → Task 8. ✔
- Réglage admin (importer / illustration auto) → Task 9. ✔
- Tests backend + frontend → Tasks 2,3,5,6 + vérif 10. ✔

Hors périmètre (non implémenté, conforme à la spec) : génération via API externe, variantes multiples, recadrage.
