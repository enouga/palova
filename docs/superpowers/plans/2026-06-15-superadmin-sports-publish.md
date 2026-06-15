# Bouton « Publier » pour les sports — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter un état `Sport.published` et un bouton « Publier / Dépublier » dans `/superadmin/sports`, de sorte que seuls les sports publiés soient proposés aux clubs.

**Architecture :** Booléen `Sport.published` (défaut `false` = brouillon ; sports existants backfillés à `true`). `GET /api/sports` (public) filtre `published: true` ; un nouvel endpoint superadmin `GET /api/platform/sports` renvoie tout ; la bascule passe par `PATCH /api/platform/sports/:id { published }`. La page superadmin gagne un badge « Brouillon » et un bouton de bascule.

**Tech Stack :** Express 5 + Prisma 7 (adapter-pg), Jest + supertest + jest-mock-extended (Prisma **mocké** dans les tests de routes), Next.js 16 (App Router, `'use client'`), React Testing Library.

**Spec de référence :** `docs/superpowers/specs/2026-06-15-superadmin-sports-publish-design.md`

**Avant de commencer :** travailler depuis `backend/` (tests : `npx jest`) et `frontend/` (tests : `npx jest`). Gate de départ : back 394, front 333, tsc propre. L'utilisateur développe en parallèle → `git add` **uniquement** les fichiers de la tâche, jamais `git add -A`.

---

## Task 1 : Colonne `Sport.published` (schéma + migration + seed)

**Files:**
- Modify: `backend/prisma/schema.prisma` (modèle `Sport`)
- Create: `backend/prisma/migrations/20260615120000_add_sport_published/migration.sql`
- Modify: `backend/prisma/seed.ts` (boucle `SPORTS` upsert)
- Modify: `backend/prisma/seed-demo.ts` (upsert padel)

- [ ] **Step 1 : Ajouter le champ au schéma**

Dans `model Sport`, sous la ligne `surfaces String[] @default([])`, ajouter :

```prisma
  published           Boolean  @default(false)
```

- [ ] **Step 2 : Écrire la migration**

`backend/prisma/migrations/20260615120000_add_sport_published/migration.sql` :

```sql
-- Disponibilité d'un sport aux clubs. Nouveaux sports = brouillon (false) ;
-- les sports déjà présents restent disponibles (backfill true).
ALTER TABLE "sports" ADD COLUMN "published" BOOLEAN NOT NULL DEFAULT false;
UPDATE "sports" SET "published" = true;
```

- [ ] **Step 3 : Appliquer + régénérer le client**

Run: `cd backend && npx prisma migrate deploy && npx prisma generate`
Expected: « 1 migration … applied » puis « Generated Prisma Client ».

- [ ] **Step 4 : Seed — sports publiés**

Dans `backend/prisma/seed.ts`, dans la boucle `for (const s of SPORTS)`, le `upsert` doit poser `published: true` (les sports du catalogue de base sont publiés). Modifier les clauses `update` et `create` :

```ts
    await prisma.sport.upsert({
      where: { key: s.key },
      update: { name: s.name, resourceNoun: s.resourceNoun, defaultSlotStepMin: s.defaultSlotStepMin, defaultDurationsMin: s.defaultDurationsMin, icon: s.icon, published: true, ...(s.surfaces ? { surfaces: s.surfaces } : {}) },
      create: { ...s, published: true },
    });
```

Dans `backend/prisma/seed-demo.ts`, l'upsert padel pose aussi `published: true` (update + create) :

```ts
  const padel = await prisma.sport.upsert({
    where: { key: 'padel' },
    update: { surfaces: [...PADEL_SURFACES], published: true },
    create: { key: 'padel', name: 'Padel', resourceNoun: 'terrain', defaultSlotStepMin: 30, defaultDurationsMin: [90], icon: '🎾', surfaces: [...PADEL_SURFACES], published: true },
  });
```

- [ ] **Step 5 : Vérifier que la suite back compile/passe**

Run: `cd backend && npx tsc --noEmit && npx jest`
Expected: tsc propre ; **394 tests** toujours verts (rien ne lit encore `published`).

- [ ] **Step 6 : Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260615120000_add_sport_published backend/prisma/seed.ts backend/prisma/seed-demo.ts
git commit -m "feat(sports): colonne Sport.published (brouillon/publié)"
```

---

## Task 2 : `GET /api/sports` ne renvoie que les sports publiés

On teste au niveau route avec Prisma **mocké** (pattern maison) : on vérifie que la route filtre `published: true` et expose le champ.

**Files:**
- Create: `backend/src/routes/__tests__/sports.routes.test.ts`
- Modify: `backend/src/routes/sports.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

`backend/src/routes/__tests__/sports.routes.test.ts` :

```ts
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import app from '../../app';

describe('GET /api/sports', () => {
  it('ne renvoie que les sports publiés (where published:true) et expose le champ', async () => {
    prismaMock.sport.findMany.mockResolvedValue([
      { id: 's1', key: 'padel', name: 'Padel', resourceNoun: 'terrain', defaultSlotStepMin: 30, defaultDurationsMin: [90], icon: '🎾', surfaces: [], published: true },
    ] as any);
    const res = await request(app).get('/api/sports');
    expect(res.status).toBe(200);
    const arg = (prismaMock.sport.findMany as jest.Mock).mock.calls[0][0];
    expect(arg.where).toEqual({ published: true });
    expect(arg.select.published).toBe(true);
    expect(res.body[0].published).toBe(true);
  });
});
```

- [ ] **Step 2 : Lancer → échec attendu**

Run: `cd backend && npx jest sports.routes`
Expected: FAIL (la route ne pose pas encore `where` ni `published` dans le select).

- [ ] **Step 3 : Implémenter le filtre**

Dans `backend/src/routes/sports.ts`, le `findMany` devient :

```ts
    const sports = await prisma.sport.findMany({
      where: { published: true },
      orderBy: { name: 'asc' },
      select: {
        id: true, key: true, name: true, resourceNoun: true,
        defaultSlotStepMin: true, defaultDurationsMin: true, icon: true, surfaces: true, published: true,
      },
    });
```

- [ ] **Step 4 : Lancer → succès attendu**

Run: `cd backend && npx jest sports.routes`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add backend/src/routes/sports.ts backend/src/routes/__tests__/sports.routes.test.ts
git commit -m "feat(sports): GET /api/sports filtre les sports publiés"
```

---

## Task 3 : `GET /api/platform/sports` (liste superadmin = tous les sports)

**Files:**
- Modify: `backend/src/services/sport-catalog.service.ts` (ajout `listSports`)
- Modify: `backend/src/routes/platform.ts` (ajout route GET `/sports`)
- Modify: `backend/src/routes/__tests__/platform.sports.routes.test.ts` (ajout describe)

- [ ] **Step 1 : Écrire les tests qui échouent**

Dans `backend/src/routes/__tests__/platform.sports.routes.test.ts`, ajouter (le fichier a déjà `superToken`, `asSuper`, `prismaMock` importés en tête) :

```ts
describe('GET /api/platform/sports', () => {
  it('200 renvoie TOUS les sports (publiés + brouillons) pour un super-admin', async () => {
    asSuper();
    prismaMock.sport.findMany.mockResolvedValue([
      { id: 's1', key: 'padel', name: 'Padel', resourceNoun: 'terrain', defaultSlotStepMin: 30, defaultDurationsMin: [90], icon: '🎾', surfaces: [], published: true },
      { id: 's2', key: 'beach', name: 'Beach', resourceNoun: 'terrain', defaultSlotStepMin: 30, defaultDurationsMin: [60], icon: null, surfaces: [], published: false },
    ] as any);
    const res = await request(app).get('/api/platform/sports').set('Authorization', `Bearer ${superToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    const arg = (prismaMock.sport.findMany as jest.Mock).mock.calls[0][0];
    expect(arg.where).toBeUndefined();           // pas de filtre published
    expect(arg.select.published).toBe(true);
  });

  it('403 pour un non super-admin', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ isSuperAdmin: false } as any);
    const res = await request(app).get('/api/platform/sports').set('Authorization', `Bearer ${superToken}`);
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2 : Lancer → échec attendu**

Run: `cd backend && npx jest platform.sports.routes`
Expected: FAIL (route 404 / `listSports` inexistant).

- [ ] **Step 3 : Ajouter `listSports` au service**

Dans `backend/src/services/sport-catalog.service.ts`, ajouter une méthode à la classe `SportCatalogService` :

```ts
  async listSports() {
    return prisma.sport.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true, key: true, name: true, resourceNoun: true,
        defaultSlotStepMin: true, defaultDurationsMin: true, icon: true, surfaces: true, published: true,
      },
    });
  }
```

- [ ] **Step 4 : Brancher la route**

Dans `backend/src/routes/platform.ts` (le routeur est déjà monté derrière `authMiddleware` + `requireSuperAdmin` dans `app.ts`), ajouter avant les routes `post/patch/delete '/sports'` :

```ts
router.get('/sports', async (_req, res, next) => {
  try { res.json(await sportCatalog.listSports()); }
  catch (err) { handleError(err, res, next); }
});
```

- [ ] **Step 5 : Lancer → succès attendu**

Run: `cd backend && npx jest platform.sports.routes`
Expected: PASS (les nouveaux `it` + les anciens).

- [ ] **Step 6 : Commit**

```bash
git add backend/src/services/sport-catalog.service.ts backend/src/routes/platform.ts backend/src/routes/__tests__/platform.sports.routes.test.ts
git commit -m "feat(platform): GET /api/platform/sports (catalogue complet superadmin)"
```

---

## Task 4 : `updateSport` accepte `published` (bascule publier/dépublier)

**Files:**
- Modify: `backend/src/services/sport-catalog.service.ts` (`updateSport` + `SportInput`)
- Modify: `backend/src/routes/__tests__/platform.sports.routes.test.ts` (ajout `it`)

- [ ] **Step 1 : Écrire les tests qui échouent**

Dans le `describe('PATCH /api/platform/sports/:id', …)` existant, ajouter :

```ts
  it('200 dépublie un sport (published:false) sans toucher au reste', async () => {
    asSuper();
    prismaMock.sport.update.mockResolvedValue({ id: 's1', key: 'padel', name: 'Padel' } as any);
    const res = await request(app).patch('/api/platform/sports/s1').set('Authorization', `Bearer ${superToken}`)
      .send({ published: false });
    expect(res.status).toBe(200);
    const arg = (prismaMock.sport.update as jest.Mock).mock.calls[0][0];
    expect(arg.data.published).toBe(false);
  });

  it('200 publie un sport (published:true)', async () => {
    asSuper();
    prismaMock.sport.update.mockResolvedValue({ id: 's1', key: 'padel', name: 'Padel' } as any);
    const res = await request(app).patch('/api/platform/sports/s1').set('Authorization', `Bearer ${superToken}`)
      .send({ published: true });
    expect(res.status).toBe(200);
    const arg = (prismaMock.sport.update as jest.Mock).mock.calls[0][0];
    expect(arg.data.published).toBe(true);
  });
```

- [ ] **Step 2 : Lancer → échec attendu**

Run: `cd backend && npx jest platform.sports.routes`
Expected: FAIL (`data.published` absent — `updateSport` ignore le champ).

- [ ] **Step 3 : Gérer `published` dans `updateSport`**

Dans `backend/src/services/sport-catalog.service.ts` :

1. Étendre l'interface `SportInput` — ajouter `published?: unknown;` à la liste des champs.
2. Dans `updateSport`, avant le `try { return await prisma.sport.update(...) }`, ajouter (à la suite des autres `if (input.X !== undefined)`) :

```ts
    if (input.published !== undefined) data.published = Boolean(input.published);
```

- [ ] **Step 4 : Lancer → succès attendu**

Run: `cd backend && npx jest platform.sports.routes`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/sport-catalog.service.ts backend/src/routes/__tests__/platform.sports.routes.test.ts
git commit -m "feat(platform): PATCH sport accepte published (bascule)"
```

---

## Task 5 : Frontend — type `Sport.published` + helpers API

**Files:**
- Modify: `frontend/lib/api.ts` (interface `Sport` ; objet `api`)

- [ ] **Step 1 : Étendre le type `Sport`**

Dans `frontend/lib/api.ts`, l'interface `Sport` gagne `published` :

```ts
export interface Sport {
  id: string;
  key: string;
  name: string;
  resourceNoun: string;
  defaultSlotStepMin: number;
  defaultDurationsMin: number[];
  icon: string | null;
  surfaces: string[];
  published: boolean;
}
```

- [ ] **Step 2 : Ajouter les helpers plateforme**

Dans l'objet `api`, à côté des autres helpers `platformXxxSport` (cf. `platformCreateSport`), ajouter :

```ts
  platformListSports: (token: string) =>
    request<Sport[]>('/api/platform/sports', {}, token),
  platformSetSportPublished: (id: string, published: boolean, token: string) =>
    request<Sport>(`/api/platform/sports/${id}`, { method: 'PATCH', body: JSON.stringify({ published }) }, token),
```

- [ ] **Step 3 : Compilation TS**

Run: `cd frontend && npx tsc --noEmit`
Expected: pas d'erreur. ⚠️ Si `tsc` signale qu'un **mock de test** construit un objet `Sport` sans `published` (ex. dans `__tests__/ClubHouse.test.tsx`, `SlotsAlaUne.test.tsx`), ajouter `published: true` à ces objets littéraux. Ne corriger QUE ce que `tsc` signale.

- [ ] **Step 4 : Vérifier la suite front**

Run: `cd frontend && npx jest`
Expected: 333 tests verts (ou +N si des mocks ont été complétés ; aucun en échec).

- [ ] **Step 5 : Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(api): Sport.published + helpers list/setPublished plateforme"
```

(Si des fichiers de test ont dû gagner `published: true`, les ajouter au même `git add`.)

---

## Task 6 : Frontend — page superadmin : liste complète + badge « Brouillon » + bouton Publier/Dépublier

**Files:**
- Create: `frontend/__tests__/SuperAdminSports.test.tsx`
- Modify: `frontend/app/superadmin/sports/page.tsx`

- [ ] **Step 1 : Écrire le test qui échoue**

`frontend/__tests__/SuperAdminSports.test.tsx` (calqué sur `SuperAdminClubsSlug.test.tsx`) :

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SuperAdminSportsPage from '../app/superadmin/sports/page';
import { ThemeProvider } from '../lib/ThemeProvider';

const platformListSports = jest.fn();
const platformSetSportPublished = jest.fn();
jest.mock('../lib/api', () => ({
  api: {
    platformListSports: (...a: unknown[]) => platformListSports(...a),
    platformSetSportPublished: (...a: unknown[]) => platformSetSportPublished(...a),
    platformCreateSport: jest.fn(),
    platformUpdateSport: jest.fn(),
    platformDeleteSport: jest.fn(),
  },
}));
jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));

const sport = (over: Record<string, unknown>) => ({
  id: 's1', key: 'padel', name: 'Padel', resourceNoun: 'terrain',
  defaultSlotStepMin: 30, defaultDurationsMin: [90], icon: '🎾', surfaces: [], published: true, ...over,
});

function renderPage() {
  return render(<ThemeProvider><SuperAdminSportsPage /></ThemeProvider>);
}

beforeEach(() => { jest.clearAllMocks(); });

it('affiche le badge Brouillon + bouton Publier pour un sport non publié, et publie au clic', async () => {
  platformListSports.mockResolvedValue([sport({ id: 's2', name: 'Beach', published: false })]);
  platformSetSportPublished.mockResolvedValue(sport({ id: 's2', name: 'Beach', published: true }));
  renderPage();
  expect(await screen.findByText('Brouillon')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Publier' }));
  await waitFor(() => expect(platformSetSportPublished).toHaveBeenCalledWith('s2', true, 'tok'));
});

it('affiche « Dépublier » pour un sport publié', async () => {
  platformListSports.mockResolvedValue([sport({ name: 'Padel', published: true })]);
  renderPage();
  expect(await screen.findByRole('button', { name: 'Dépublier' })).toBeInTheDocument();
  expect(screen.queryByText('Brouillon')).not.toBeInTheDocument();
});
```

- [ ] **Step 2 : Lancer → échec attendu**

Run: `cd frontend && npx jest SuperAdminSports`
Expected: FAIL (la page charge encore via `getSports`, pas de badge ni de bouton).

- [ ] **Step 3 : Charger via `platformListSports`**

Dans `frontend/app/superadmin/sports/page.tsx`, remplacer le corps de `load` (qui utilise `api.getSports()`) pour exiger le token et appeler le nouvel endpoint :

```ts
  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try { setError(null); setSports(await api.platformListSports(token)); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { if (ready) load(); }, [ready, load]);
```

- [ ] **Step 4 : Ajouter la bascule publier/dépublier**

Toujours dans `page.tsx`, ajouter un handler à côté de `remove` :

```ts
  const togglePublished = async (s: Sport) => {
    if (!token) return;
    setBusy(true);
    try { setError(null); await api.platformSetSportPublished(s.id, !s.published, token); await load(); }
    catch { setError('Changement de statut impossible.'); }
    finally { setBusy(false); }
  };
```

- [ ] **Step 5 : Badge + bouton dans la carte sport**

Dans le rendu de la liste (`sports.map((s) => …)`), à côté du nom, afficher le badge « Brouillon » quand `!s.published`, et ajouter le bouton de bascule dans la rangée d'actions (avant « Modifier »). Le titre de la carte devient :

```tsx
              <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 16, color: th.text, display: 'flex', alignItems: 'center', gap: 8 }}>
                {s.name} <span style={{ color: th.textFaint, fontWeight: 400 }}>· {s.resourceNoun}</span>
                {!s.published && <span style={{ fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, color: th.textMute, background: th.bg, border: `1px solid ${th.line}`, borderRadius: 6, padding: '2px 7px' }}>Brouillon</span>}
              </div>
```

et la rangée d'actions (les `<Btn>` Modifier/Suppr.) gagne en tête :

```tsx
              <Btn variant="surface" onClick={() => togglePublished(s)} disabled={busy}>{s.published ? 'Dépublier' : 'Publier'}</Btn>
```

- [ ] **Step 6 : Lancer → succès attendu**

Run: `cd frontend && npx jest SuperAdminSports`
Expected: PASS (les 2 `it`).

- [ ] **Step 7 : Gate complet front**

Run: `cd frontend && npx tsc --noEmit && npx jest`
Expected: tsc propre ; toute la suite verte.

- [ ] **Step 8 : Commit**

```bash
git add frontend/app/superadmin/sports/page.tsx frontend/__tests__/SuperAdminSports.test.tsx
git commit -m "feat(superadmin): badge Brouillon + bouton Publier/Dépublier (sports)"
```

---

## Vérification finale

- [ ] `cd backend && npx tsc --noEmit && npx jest` — vert (≥ 398 : +1 sports.routes, +4 platform.sports).
- [ ] `cd frontend && npx tsc --noEmit && npx jest` — vert (+2 SuperAdminSports).
- [ ] Parcours manuel (si Postgres up + reseed) : superadmin crée un sport → il apparaît « Brouillon » et **n'est PAS** dans la liste activable d'un club (`/admin/sports`) → clic « Publier » → il y apparaît → « Dépublier » → il en disparaît, sans casser un club qui l'utilisait déjà.

## Couverture du spec

- Champ `published` + migration backfill + seed publié → Task 1.
- `GET /api/sports` filtre les publiés → Task 2.
- `GET /api/platform/sports` (superadmin voit tout) → Task 3.
- Bascule `PATCH { published }` → Task 4.
- Type + helpers front → Task 5.
- Page : chargement complet + badge + bouton, création = brouillon (héritée du défaut backend) → Task 6.
