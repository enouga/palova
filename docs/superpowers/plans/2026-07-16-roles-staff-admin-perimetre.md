# Périmètre STAFF → ADMIN du back-office — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rehausser sous ADMIN les routes/pages de « structure » du club (réglages, terrains, offres/prix, export comptable, contenu & mentions), le STAFF gardant tout le quotidien.

**Architecture:** La vérité est la garde backend `requireClubMember('ADMIN')` posée route par route (défense en profondeur, pattern des routes Stripe/level/staff-role existantes). Le frontend masque les entrées de nav et pose une garde deep-link « page réservée aux administrateurs » via `useAdminRole()`/`isClubAdmin` — sans déclencher de fetch pour un non-admin (pattern `/admin/payments`). Aucune migration, aucune route nouvelle.

**Tech Stack:** Express + `requireClubMember` middleware (backend), Jest + supertest (tests routes) ; Next.js client components + `AdminRoleContext` (frontend), Jest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-16-roles-staff-admin-perimetre-design.md`

**Conventions de test (rappel mémoire) :**
- Backend : `node node_modules/jest/bin/jest.js <path>` (les shims npx sont cassés).
- Frontend : `node node_modules/jest/bin/jest.js <path>` depuis `frontend/`, puis `node node_modules/typescript/bin/tsc --noEmit` comme gate de types séparé (jest ne type-check pas).
- Le middleware `requireClubMember` lit UNIQUEMENT `prismaMock.clubMember.findUnique` → mocker son `role` suffit pour tester la garde.

---

## Task 1 : Fichier de test des gardes de rôle (RED complet)

Crée un fichier de test unique qui vérifie, pour chaque route déplacée : STAFF → 403, non-membre → 403, ADMIN → **pas** 403 (la garde laisse passer, peu importe que le handler réussisse ensuite) ; et en non-régression, les lectures qui RESTENT STAFF → **pas** 403 pour un STAFF. Ce fichier échoue tant que les gardes ne sont pas posées (Tasks 2-6).

**Files:**
- Create: `backend/src/routes/__tests__/admin.role-gates.routes.test.ts`

- [ ] **Step 1: Écrire le fichier de test complet**

```typescript
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';

const SECRET = process.env.JWT_SECRET!;
if (!SECRET) throw new Error('JWT_SECRET manquant');
const token = jwt.sign({ id: 'actor-1', email: 'a@x.fr' }, SECRET, { expiresIn: '1h' });
const auth = { Authorization: `Bearer ${token}` };
const base = '/api/clubs/club-demo/admin';

// La garde requireClubMember lit clubMember.findUnique → on pilote le rôle de l'acteur.
const asRole = (role: 'OWNER' | 'ADMIN' | 'STAFF' | null) =>
  prismaMock.clubMember.findUnique.mockResolvedValue(role ? { role } : null as any);

beforeEach(() => { jest.clearAllMocks(); });

// Chaque entrée : [méthode, chemin, corps éventuel]
type Call = ['get' | 'post' | 'patch' | 'put' | 'delete', string, object?];
const send = (c: Call) => {
  const [m, p, body] = c;
  const r = request(app)[m](`${base}${p}`).set(auth);
  return body ? r.send(body) : r;
};

// Routes qui DOIVENT devenir ADMIN (Tasks 2-6).
const ADMIN_ROUTES: Call[] = [
  // Réglages (Task 2)
  ['patch', '/', { name: 'X' }],
  ['post', '/sports', { sportId: 's1' }],
  ['patch', '/sports/cs1', { durationsMin: [60] }],
  // Terrains (Task 3)
  ['post', '/resources', { clubSportId: 'cs1' }],
  ['patch', '/resources/reorder', { orderedIds: ['r1'] }],
  ['patch', '/resources/r1', { name: 'Court 1' }],
  ['patch', '/resources/r1/active', { isActive: false }],
  ['delete', '/resources/r1'],
  // Offres (Task 4)
  ['post', '/packages/templates', { name: 'P' }],
  ['patch', '/packages/templates/t1', { name: 'P' }],
  ['post', '/subscription-plans', { name: 'A' }],
  ['patch', '/subscription-plans/p1', { name: 'A' }],
  // Comptabilité (Task 5)
  ['get', '/accounting/export?from=2026-01-01&to=2026-01-31'],
  // Contenu & mentions (Task 6)
  ['get', '/pages'],
  ['get', '/pages/CGV/template'],
  ['put', '/pages/CGV', { bodyMarkdown: '# x', published: true }],
  ['get', '/faq'],
  ['post', '/faq', { question: 'Q', answer: 'A' }],
  ['patch', '/faq/reorder', { orderedIds: ['f1'] }],
  ['patch', '/faq/f1', { question: 'Q' }],
  ['delete', '/faq/f1'],
];

// Uploads multipart gatés ADMIN (mêmes gardes ; on teste seulement le refus STAFF,
// un STAFF ne doit jamais atteindre le handler multer).
const ADMIN_UPLOADS: Call[] = [
  ['post', '/club-logo'],
  ['post', '/club-cover'],
  ['post', '/packages/templates/t1/image'],
  ['post', '/subscription-plans/p1/image'],
];

// Lectures qui RESTENT STAFF (non-régression : des surfaces staff en dépendent).
const STAFF_READS: Call[] = [
  ['get', '/'],
  ['get', '/resources'],
  ['get', '/sports'],
  ['get', '/packages/templates'],
  ['get', '/packages/active'],
  ['get', '/subscription-plans'],
  ['get', '/accounting/summary?year=2026&month=1'],
];

describe('Gardes de rôle — routes devenues ADMIN', () => {
  it.each([...ADMIN_ROUTES, ...ADMIN_UPLOADS])('STAFF → 403 sur %s %s', async (...c) => {
    asRole('STAFF');
    const res = await send(c as Call);
    expect(res.status).toBe(403);
  });

  it.each([...ADMIN_ROUTES, ...ADMIN_UPLOADS])('non-membre → 403 sur %s %s', async (...c) => {
    asRole(null);
    const res = await send(c as Call);
    expect(res.status).toBe(403);
  });

  it.each(ADMIN_ROUTES)('ADMIN → pas 403 (garde franchie) sur %s %s', async (...c) => {
    asRole('ADMIN');
    const res = await send(c as Call);
    expect(res.status).not.toBe(403);
  });
});

describe('Non-régression — lectures qui restent STAFF', () => {
  it.each(STAFF_READS)('STAFF → pas 403 sur %s %s', async (...c) => {
    asRole('STAFF');
    const res = await send(c as Call);
    expect(res.status).not.toBe(403);
  });
});
```

- [ ] **Step 2: Lancer le test, vérifier qu'il échoue**

Run (depuis `backend/`) : `node node_modules/jest/bin/jest.js src/routes/__tests__/admin.role-gates.routes.test.ts`
Expected: les blocs `STAFF → 403` et `non-membre → 403` ÉCHOUENT (les routes répondent aujourd'hui 200/400/500, pas 403). Les blocs `ADMIN → pas 403` et `Non-régression` PASSENT déjà. C'est le RED attendu.

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/__tests__/admin.role-gates.routes.test.ts
git commit -m "test(admin): gardes de role STAFF vers ADMIN (RED, lot B)"
```

---

## Task 2 : Garde ADMIN sur les Réglages

**Files:**
- Modify: `backend/src/routes/admin.ts` (routes `PATCH /`, `POST /club-logo`, `POST /club-cover`, `POST /sports`, `PATCH /sports/:clubSportId`)

- [ ] **Step 1: Poser les gardes**

`requireClubMember` est déjà importé dans `admin.ts`. Appliquer ces 5 remplacements exacts (chaînes uniques) :

```
router.patch('/', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```
→
```
router.patch('/', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```

```
router.post('/club-logo', (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```
→
```
router.post('/club-logo', requireClubMember('ADMIN'), (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```

```
router.post('/club-cover', (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```
→
```
router.post('/club-cover', requireClubMember('ADMIN'), (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```

```
router.post('/sports', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```
→
```
router.post('/sports', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```

```
router.patch('/sports/:clubSportId', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```
→
```
router.patch('/sports/:clubSportId', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```

⚠️ Ne PAS toucher `router.get('/', async …` (getClubForAdmin, reste STAFF) ni `router.get('/sports', async …`.

- [ ] **Step 2: Vérifier le test des réglages passe + non-régression GET /**

Run : `node node_modules/jest/bin/jest.js src/routes/__tests__/admin.role-gates.routes.test.ts -t "/sports|patch . |club-logo|club-cover| / "`
Puis lancer aussi les suites touchées pour non-régression :
`node node_modules/jest/bin/jest.js src/routes/__tests__/admin.club-logo.routes.test.ts src/routes/__tests__/admin.club-cover.routes.test.ts`
Expected: les cas `PATCH /`, `/sports`, `/club-logo`, `/club-cover` passent en STAFF→403 ; les suites club-logo/cover (acteur OWNER) restent vertes ; `GET /` STAFF reste non-403.

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/admin.ts
git commit -m "fix(admin): reglages du club reserves ADMIN (PATCH /, logo, cover, sports)"
```

---

## Task 3 : Garde ADMIN sur les écritures Terrains

**Files:**
- Modify: `backend/src/routes/admin.ts` (5 écritures `/resources*`)

- [ ] **Step 1: Poser les gardes**

Cinq remplacements exacts :

```
router.post('/resources', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```
→
```
router.post('/resources', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```

```
router.patch('/resources/reorder', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```
→
```
router.patch('/resources/reorder', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```

```
router.patch('/resources/:id', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```
→
```
router.patch('/resources/:id', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```

```
router.patch('/resources/:id/active', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```
→
```
router.patch('/resources/:id/active', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```

```
router.delete('/resources/:id', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```
→
```
router.delete('/resources/:id', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```

⚠️ Ne PAS toucher `router.get('/resources', async …` (reste STAFF).

- [ ] **Step 2: Vérifier**

Run : `node node_modules/jest/bin/jest.js src/routes/__tests__/admin.role-gates.routes.test.ts -t "resources"`
Expected: tous les cas `resources` (POST/reorder/:id/:id/active/DELETE) passent STAFF→403 ; `GET /resources` STAFF reste non-403.

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/admin.ts
git commit -m "fix(admin): ecritures terrains reservees ADMIN (create/update/reorder/active/delete)"
```

---

## Task 4 : Garde ADMIN sur les écritures Offres & plans

**Files:**
- Modify: `backend/src/routes/admin.ts` (`POST/PATCH /packages/templates*`, `POST/PATCH /subscription-plans*` + leurs images)

- [ ] **Step 1: Poser les gardes**

Six remplacements exacts :

```
router.post('/packages/templates', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```
→
```
router.post('/packages/templates', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```

```
router.patch('/packages/templates/:id', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```
→
```
router.patch('/packages/templates/:id', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```

```
router.post('/packages/templates/:id/image', (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```
→
```
router.post('/packages/templates/:id/image', requireClubMember('ADMIN'), (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```

```
router.post('/subscription-plans', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```
→
```
router.post('/subscription-plans', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```

```
router.patch('/subscription-plans/:id', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```
→
```
router.patch('/subscription-plans/:id', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```

```
router.post('/subscription-plans/:id/image', (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```
→
```
router.post('/subscription-plans/:id/image', requireClubMember('ADMIN'), (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```

⚠️ Ne PAS toucher `GET /packages/templates`, `GET /packages/active`, `GET /subscription-plans` (lectures dont dépend la vente en caisse — restent STAFF).

- [ ] **Step 2: Vérifier + non-régression packages/subscriptions**

Run : `node node_modules/jest/bin/jest.js src/routes/__tests__/admin.role-gates.routes.test.ts -t "templates|subscription-plans|packages"`
Puis : `node node_modules/jest/bin/jest.js src/routes/__tests__/admin.packages.routes.test.ts src/routes/__tests__/admin.subscriptions.routes.test.ts`
Expected: écritures offres/plans STAFF→403 ; lectures `GET /packages/*` et `GET /subscription-plans` STAFF non-403 ; suites packages (recharge/adjust STAFF) et subscriptions (lifecycle STAFF) restent vertes (elles portent sur des routes qui restent STAFF).

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/admin.ts
git commit -m "fix(admin): ecritures offres et plans reservees ADMIN (create/update/image)"
```

---

## Task 5 : Garde ADMIN sur l'export comptable

**Files:**
- Modify: `backend/src/routes/admin.ts` (`GET /accounting/export`)

- [ ] **Step 1: Poser la garde**

```
router.get('/accounting/export', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```
→
```
router.get('/accounting/export', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```

⚠️ Ne PAS toucher `GET /accounting/summary` (consommé par Ventes & journée — reste STAFF).

- [ ] **Step 2: Vérifier**

Run : `node node_modules/jest/bin/jest.js src/routes/__tests__/admin.role-gates.routes.test.ts -t "accounting"`
Expected: `/accounting/export` STAFF→403 ; `/accounting/summary` STAFF non-403.

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/admin.ts
git commit -m "fix(admin): export comptable reserve ADMIN (summary reste STAFF)"
```

---

## Task 6 : Garde ADMIN sur Contenu & mentions (pages + FAQ)

**Files:**
- Modify: `backend/src/routes/admin.ts` (bloc `/pages*` + `/faq*`)

- [ ] **Step 1: Poser les gardes (8 routes)**

```
router.get('/pages', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```
→
```
router.get('/pages', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```

```
router.get('/pages/:kind/template', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```
→
```
router.get('/pages/:kind/template', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```

```
router.put('/pages/:kind', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```
→
```
router.put('/pages/:kind', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```

```
router.get('/faq', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```
→
```
router.get('/faq', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```

```
router.post('/faq', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```
→
```
router.post('/faq', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```

```
router.patch('/faq/reorder', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```
→
```
router.patch('/faq/reorder', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```

```
router.patch('/faq/:id', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```
→
```
router.patch('/faq/:id', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```

```
router.delete('/faq/:id', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```
→
```
router.delete('/faq/:id', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
```

- [ ] **Step 2: Mettre l'acteur de la suite pages existante à ADMIN + vérifier**

`admin.pages.routes.test.ts` utilise déjà l'acteur `OWNER` (ligne 13, `role: 'OWNER'`) → il reste vert sans changement. Vérifier :
Run : `node node_modules/jest/bin/jest.js src/routes/__tests__/admin.role-gates.routes.test.ts src/routes/__tests__/admin.pages.routes.test.ts`
Expected: le fichier de gardes est ENTIÈREMENT vert (toutes les routes ADMIN → STAFF 403 / non-membre 403 / ADMIN non-403, non-régression STAFF non-403) ; la suite pages reste verte.

- [ ] **Step 3: Lancer toute la suite routes backend (garde-fou)**

Run : `node node_modules/jest/bin/jest.js src/routes/__tests__/`
Expected: tout vert (les 3 échecs icon.routes connus de la baseline worktree ne s'appliquent pas sur la stack principale ; sur main, 0 échec attendu).

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/admin.ts
git commit -m "fix(admin): bloc contenu et mentions (pages + FAQ) reserve ADMIN"
```

---

## Task 7 : Frontend — masquer les entrées de nav + sections vides

**Files:**
- Modify: `frontend/app/admin/layout.tsx` (construction `sections`, rendu du map)
- Modify: `frontend/__tests__/AdminLayout.test.tsx`

- [ ] **Step 1: Écrire les tests de nav (RED)**

Ajouter dans `AdminLayout.test.tsx`, dans le `describe('AdminLayout — toggle de la sidebar', …)` (après le test `club ON : lien nav « Matchs » présent`) :

```typescript
it('viewer STAFF : les 5 entrées de structure sont masquées + section Configuration absente', async () => {
  api.getMyClubs.mockResolvedValue([{ clubId: 'c1', role: 'STAFF' }]);
  await wrap();
  expect(screen.getByText('Tableau de bord')).toBeInTheDocument(); // sidebar rendue
  for (const label of ['Ressources', 'Réglages', 'Contenu & mentions', 'Offres', 'Comptabilité']) {
    expect(screen.queryByText(label)).not.toBeInTheDocument();
  }
  expect(screen.queryByText('Configuration')).not.toBeInTheDocument(); // section devenue vide
});

it('viewer ADMIN : les 5 entrées de structure sont présentes', async () => {
  api.getMyClubs.mockResolvedValue([{ clubId: 'c1', role: 'ADMIN' }]);
  await wrap();
  for (const label of ['Ressources', 'Réglages', 'Contenu & mentions', 'Offres', 'Comptabilité']) {
    expect(screen.getByText(label)).toBeInTheDocument();
  }
});
```

- [ ] **Step 2: Lancer, vérifier RED**

Run (depuis `frontend/`) : `node node_modules/jest/bin/jest.js __tests__/AdminLayout.test.tsx -t "viewer STAFF|viewer ADMIN"`
Expected: le test STAFF échoue (les entrées sont aujourd'hui visibles pour tous).

- [ ] **Step 3: Gater les 5 entrées + filtrer les sections vides**

Dans `frontend/app/admin/layout.tsx`, les 5 items concernés vivent dans les sections « Finances » (Offres, Comptabilité) et « Configuration » (Ressources, Réglages, Contenu & mentions). Les rendre conditionnels à `isClubAdmin(role)` en utilisant le spread conditionnel déjà employé pour « Signalements »/« Abonnement Palova ».

Section Finances — remplacer les items `Comptabilité` et `Offres` par des spreads :
```
    { title: 'Finances', color: '#5bbd6e', items: [
      { href: '/admin/reservations', label: 'Paiements',         icon: 'ticket' },
      ...(isClubAdmin(role)
        ? [{ href: '/admin/comptabilite', label: 'Comptabilité', icon: 'chart' } as NavItem,
           { href: '/admin/packages',     label: 'Offres',       icon: 'card' } as NavItem]
        : []),
      ...(isClubAdmin(role)
        ? [{ href: '/admin/billing', label: 'Abonnement Palova', icon: 'wallet' } as NavItem]
        : []),
    ] },
```

Section Configuration — remplacer par un spread complet :
```
    { title: 'Configuration', color: '#9b8cf0', items: [
      ...(isClubAdmin(role)
        ? [{ href: '/admin/courts',   label: 'Ressources',         icon: 'indoor' } as NavItem,
           { href: '/admin/pages',    label: 'Contenu & mentions', icon: 'info' } as NavItem,
           { href: '/admin/settings', label: 'Réglages',           icon: 'settings' } as NavItem]
        : []),
    ] },
```

Puis filtrer les sections vides avant le rendu. Repérer `{sections.map((sec, i) => {` et le remplacer par un map sur une liste filtrée. Juste avant le `return (` du composant (ou à l'endroit où `sections` est utilisé dans le JSX), remplacer `sections.map(` par `visibleSections.map(` et définir au-dessus du JSX :
```
  // Une section sans items (ex. Configuration pour un STAFF) ne doit pas afficher son titre seul.
  const visibleSections = sections.filter((s) => s.items.length > 0);
```
Adapter aussi `titledSections` pour qu'il dérive de `visibleSections` (sinon le bouton « Tout replier » compterait une section masquée) :
```
  const titledSections = visibleSections.map((s) => s.title).filter((t): t is string => !!t);
```

- [ ] **Step 4: Vérifier GREEN (toute la suite layout)**

Run : `node node_modules/jest/bin/jest.js __tests__/AdminLayout.test.tsx`
Expected: 28 tests verts (26 existants + 2 nouveaux).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/admin/layout.tsx frontend/__tests__/AdminLayout.test.tsx
git commit -m "feat(admin): masquer les entrees de structure aux staff + sections vides"
```

---

## Task 8 : Garde deep-link — /admin/settings

**Files:**
- Modify: `frontend/app/admin/settings/page.tsx`
- Modify: `frontend/__tests__/AdminSettings.test.tsx`, `frontend/__tests__/AdminSettings.refresh.test.tsx`

- [ ] **Step 1: Adapter les `wrap`/`render` à un rôle ADMIN + ajouter un test STAFF (RED)**

Dans `AdminSettings.test.tsx`, remplacer le helper de montage `const wrap = () => render(<AdminSettingsPage />);` par :
```typescript
import { AdminRoleContext } from '../lib/adminRole';
const wrap = (role: 'OWNER' | 'ADMIN' | 'STAFF' | null = 'ADMIN') =>
  render(<AdminRoleContext.Provider value={role}><AdminSettingsPage /></AdminRoleContext.Provider>);
```
Ajouter un test (après le premier test existant de la suite) :
```typescript
it('viewer STAFF : page réservée aux administrateurs, aucun fetch club', async () => {
  wrap('STAFF');
  expect(screen.getByText(/réservée aux administrateurs/i)).toBeInTheDocument();
  expect(api.adminGetClub).not.toHaveBeenCalled();
});
```
Dans `AdminSettings.refresh.test.tsx`, faire le même remplacement du `render(<AdminSettingsPage />)` par un wrap fournissant `AdminRoleContext.Provider value="ADMIN"` (importer `AdminRoleContext`). Ce fichier n'a pas besoin de test STAFF supplémentaire.

- [ ] **Step 2: Lancer, vérifier RED**

Run : `node node_modules/jest/bin/jest.js __tests__/AdminSettings.test.tsx -t "réservée aux administrateurs"`
Expected: échec (le message n'existe pas encore).

- [ ] **Step 3: Poser la garde dans la page**

Dans `frontend/app/admin/settings/page.tsx` :
- Ajouter l'import : `import { isClubAdmin, useAdminRole } from '@/lib/adminRole';`
- Après `const clubId = hostClub?.id;` ajouter : `const admin = isClubAdmin(useAdminRole());`
- Gater le fetch : remplacer `useEffect(() => { if (ready && token && clubId) load(); }, [ready, token, clubId, load]);` par `useEffect(() => { if (ready && token && clubId && admin) load(); }, [ready, token, clubId, admin, load]);`
- Garde deep-link : juste avant `if (!draft) {` (le bloc « Chargement… »), insérer :
```tsx
  if (!admin) {
    return <div style={{ fontFamily: th.fontUI, color: th.textMute, padding: '32px 0' }}>Cette page est réservée aux administrateurs du club.</div>;
  }
```

- [ ] **Step 4: Vérifier GREEN**

Run : `node node_modules/jest/bin/jest.js __tests__/AdminSettings.test.tsx __tests__/AdminSettings.refresh.test.tsx`
Expected: tout vert (les tests existants passent avec le rôle ADMIN injecté, + le nouveau test STAFF).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/admin/settings/page.tsx frontend/__tests__/AdminSettings.test.tsx frontend/__tests__/AdminSettings.refresh.test.tsx
git commit -m "feat(admin): reglages reserves ADMIN (garde deep-link, aucun fetch staff)"
```

---

## Task 9 : Garde deep-link — /admin/courts (Ressources)

**Files:**
- Modify: `frontend/app/admin/courts/page.tsx`
- Modify: `frontend/__tests__/AdminResources.test.tsx`

- [ ] **Step 1: Adapter le montage + test STAFF (RED)**

Dans `AdminResources.test.tsx`, repérer le helper de montage (`return render(<ThemeProvider>…</ThemeProvider>)`) et l'envelopper d'un `AdminRoleContext.Provider value={role}` avec `role: … = 'ADMIN'` par défaut. Importer `AdminRoleContext` depuis `@/lib/adminRole`. Exemple :
```typescript
import { AdminRoleContext } from '@/lib/adminRole';
const mount = (role: 'OWNER' | 'ADMIN' | 'STAFF' | null = 'ADMIN') =>
  render(
    <AdminRoleContext.Provider value={role}>
      <ThemeProvider>
        <AdminResourcesPage />
      </ThemeProvider>
    </AdminRoleContext.Provider>,
  );
```
(Adapter la signature existante : si les tests appellent `mount()` sans argument, le défaut ADMIN préserve leur comportement.)
Ajouter un test :
```typescript
it('viewer STAFF : page réservée aux administrateurs, aucun fetch ressources', async () => {
  mount('STAFF');
  expect(screen.getByText(/réservée aux administrateurs/i)).toBeInTheDocument();
  expect(api.adminGetResources).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: RED**

Run : `node node_modules/jest/bin/jest.js __tests__/AdminResources.test.tsx -t "réservée aux administrateurs"`
Expected: échec.

- [ ] **Step 3: Poser la garde dans la page**

Dans `frontend/app/admin/courts/page.tsx` :
- Import : `import { isClubAdmin, useAdminRole } from '@/lib/adminRole';`
- Après `const clubId = club?.id;` : `const admin = isClubAdmin(useAdminRole());`
- Gater le fetch : `useEffect(() => { if (ready && token && clubId && admin) load(); }, [ready, token, clubId, admin, load]);`
- Garde deep-link : juste avant le `return (` principal (ligne ~217), insérer :
```tsx
  if (!admin) {
    return <div style={{ padding: '32px 0', fontFamily: th.fontUI, color: th.textMute }}>Cette page est réservée aux administrateurs du club.</div>;
  }
```

- [ ] **Step 4: GREEN**

Run : `node node_modules/jest/bin/jest.js __tests__/AdminResources.test.tsx`
Expected: tout vert.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/admin/courts/page.tsx frontend/__tests__/AdminResources.test.tsx
git commit -m "feat(admin): ressources reservees ADMIN (garde deep-link)"
```

---

## Task 10 : Garde deep-link — /admin/packages (Offres)

**Files:**
- Modify: `frontend/app/admin/packages/page.tsx`
- Modify: `frontend/__tests__/AdminPackages.test.tsx`

- [ ] **Step 1: Adapter le montage + test STAFF (RED)**

Dans `AdminPackages.test.tsx`, remplacer `const mount = () => render(<ThemeProvider><AdminPackagesPage /></ThemeProvider>);` par :
```typescript
import { AdminRoleContext } from '../lib/adminRole';
const mount = (role: 'OWNER' | 'ADMIN' | 'STAFF' | null = 'ADMIN') =>
  render(<AdminRoleContext.Provider value={role}><ThemeProvider><AdminPackagesPage /></ThemeProvider></AdminRoleContext.Provider>);
```
Ajouter :
```typescript
it('viewer STAFF : page réservée aux administrateurs, aucun fetch offres', async () => {
  mount('STAFF');
  expect(screen.getByText(/réservée aux administrateurs/i)).toBeInTheDocument();
  expect(api.adminGetPackageTemplates).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: RED**

Run : `node node_modules/jest/bin/jest.js __tests__/AdminPackages.test.tsx -t "réservée aux administrateurs"`
Expected: échec.

- [ ] **Step 3: Poser la garde**

Dans `frontend/app/admin/packages/page.tsx` :
- Import : `import { isClubAdmin, useAdminRole } from '@/lib/adminRole';`
- Après `const clubId = club?.id;` : `const admin = isClubAdmin(useAdminRole());`
- Gater le fetch : `useEffect(() => { if (ready && token && clubId && admin) load(); }, [ready, token, clubId, admin, load]);`
- Garde deep-link : juste avant le `return (` principal (ligne ~119), insérer :
```tsx
  if (!admin) {
    return <div style={{ marginTop: 20, fontFamily: th.fontUI, color: th.textMute }}>Cette page est réservée aux administrateurs du club.</div>;
  }
```

- [ ] **Step 4: GREEN**

Run : `node node_modules/jest/bin/jest.js __tests__/AdminPackages.test.tsx`
Expected: tout vert.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/admin/packages/page.tsx frontend/__tests__/AdminPackages.test.tsx
git commit -m "feat(admin): offres reservees ADMIN (garde deep-link)"
```

---

## Task 11 : Garde deep-link — /admin/comptabilite

**Files:**
- Modify: `frontend/app/admin/comptabilite/page.tsx`
- Create: `frontend/__tests__/AdminComptabilite.test.tsx`

- [ ] **Step 1: Créer le test (RED)**

```typescript
import { render, screen, waitFor } from '@testing-library/react';
import AdminComptabilitePage from '../app/admin/comptabilite/page';
import { ThemeProvider } from '../lib/ThemeProvider';
import { AdminRoleContext } from '../lib/adminRole';

jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));
jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'c1' } }) }));
jest.mock('../lib/api', () => ({
  api: { adminAccountingSummary: jest.fn(), adminAccountingExport: jest.fn() },
}));
import { api } from '../lib/api';

const mount = (role: 'ADMIN' | 'STAFF' = 'ADMIN') =>
  render(<AdminRoleContext.Provider value={role}><ThemeProvider><AdminComptabilitePage /></ThemeProvider></AdminRoleContext.Provider>);

beforeEach(() => {
  jest.clearAllMocks();
  (api.adminAccountingSummary as jest.Mock).mockResolvedValue({ byMethod: [], total: '0.00' });
});

it('viewer STAFF : page réservée aux administrateurs, aucun fetch', async () => {
  mount('STAFF');
  expect(screen.getByText(/réservée aux administrateurs/i)).toBeInTheDocument();
  expect(api.adminAccountingSummary).not.toHaveBeenCalled();
});

it('viewer ADMIN : charge le récap mensuel', async () => {
  mount('ADMIN');
  await waitFor(() => expect(api.adminAccountingSummary).toHaveBeenCalled());
});
```

- [ ] **Step 2: RED**

Run : `node node_modules/jest/bin/jest.js __tests__/AdminComptabilite.test.tsx`
Expected: le test STAFF échoue (le message n'existe pas ; le fetch part).

- [ ] **Step 3: Poser la garde**

Dans `frontend/app/admin/comptabilite/page.tsx` :
- Import : `import { isClubAdmin, useAdminRole } from '@/lib/adminRole';`
- Après `const clubId = club?.id;` : `const admin = isClubAdmin(useAdminRole());`
- Gater le fetch : remplacer la condition de l'effet de chargement par `if (ready && token && clubId && admin && year !== null && month !== null) load();` (et ajouter `admin` aux deps).
- Garde deep-link : juste avant le `return (` principal du composant, insérer :
```tsx
  if (!admin) {
    return <div style={{ padding: 24, fontFamily: th.fontUI, color: th.textMute }}>Cette page est réservée aux administrateurs du club.</div>;
  }
```

- [ ] **Step 4: GREEN**

Run : `node node_modules/jest/bin/jest.js __tests__/AdminComptabilite.test.tsx`
Expected: 2 tests verts.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/admin/comptabilite/page.tsx frontend/__tests__/AdminComptabilite.test.tsx
git commit -m "feat(admin): comptabilite reservee ADMIN (garde deep-link)"
```

---

## Task 12 : Garde deep-link — /admin/pages (Contenu & mentions)

**Files:**
- Modify: `frontend/app/admin/pages/page.tsx`
- Create: `frontend/__tests__/AdminPages.test.tsx`

- [ ] **Step 1: Créer le test (RED)**

```typescript
import { render, screen, waitFor } from '@testing-library/react';
import AdminPagesPage from '../app/admin/pages/page';
import { ThemeProvider } from '../lib/ThemeProvider';
import { AdminRoleContext } from '../lib/adminRole';

jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));
jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'c1' } }) }));
jest.mock('../lib/api', () => ({
  api: { adminGetClub: jest.fn(), adminGetPages: jest.fn(), adminGetFaq: jest.fn() },
  assetUrl: (u: string | null) => u,
}));
import { api } from '../lib/api';

const mount = (role: 'ADMIN' | 'STAFF' = 'ADMIN') =>
  render(<AdminRoleContext.Provider value={role}><ThemeProvider><AdminPagesPage /></ThemeProvider></AdminRoleContext.Provider>);

beforeEach(() => {
  jest.clearAllMocks();
  (api.adminGetClub as jest.Mock).mockResolvedValue({ id: 'c1', name: 'Club' });
  (api.adminGetPages as jest.Mock).mockResolvedValue([]);
  (api.adminGetFaq as jest.Mock).mockResolvedValue([]);
});

it('viewer STAFF : page réservée aux administrateurs, aucun fetch', async () => {
  mount('STAFF');
  expect(screen.getByText(/réservée aux administrateurs/i)).toBeInTheDocument();
  expect(api.adminGetClub).not.toHaveBeenCalled();
});

it('viewer ADMIN : charge le contenu', async () => {
  mount('ADMIN');
  await waitFor(() => expect(api.adminGetPages).toHaveBeenCalled());
});
```

- [ ] **Step 2: RED**

Run : `node node_modules/jest/bin/jest.js __tests__/AdminPages.test.tsx`
Expected: le test STAFF échoue.

- [ ] **Step 3: Poser la garde**

Dans `frontend/app/admin/pages/page.tsx` :
- Import : `import { isClubAdmin, useAdminRole } from '@/lib/adminRole';`
- Après `const clubId = hostClub?.id;` : `const admin = isClubAdmin(useAdminRole());`
- Gater le fetch : `useEffect(() => { if (ready && token && clubId && admin) load(); }, [ready, token, clubId, admin, load]);`
- Garde deep-link : la page a un premier `return` de chargement `if (!ready || loading || !club || !clubId || !token) {`. Insérer AVANT ce return :
```tsx
  if (!admin) {
    return <div style={{ padding: 24, fontFamily: th.fontUI, color: th.textMute }}>Cette page est réservée aux administrateurs du club.</div>;
  }
```
(`th` est déjà en scope : `const { th } = useTheme();` en tête du composant, ligne 32.)

- [ ] **Step 4: GREEN**

Run : `node node_modules/jest/bin/jest.js __tests__/AdminPages.test.tsx`
Expected: 2 tests verts.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/admin/pages/page.tsx frontend/__tests__/AdminPages.test.tsx
git commit -m "feat(admin): contenu et mentions reserves ADMIN (garde deep-link)"
```

---

## Task 13 : Masquer la carte « Sections du Club-house » au STAFF

La page `/admin/club` reste STAFF (présentation + galerie), mais sa carte `ClubHouseSectionsCard` écrit via `PATCH /` (désormais ADMIN) → la masquer pour un staff.

**Files:**
- Modify: `frontend/app/admin/club/page.tsx`
- Modify: `frontend/__tests__/AdminClub.test.tsx`

- [ ] **Step 1: Adapter le `wrap` (rôle ADMIN par défaut) + test STAFF (RED)**

Dans `AdminClub.test.tsx`, remplacer `const wrap = () => render(<ThemeProvider><AdminClubPage /></ThemeProvider>);` par :
```typescript
import { AdminRoleContext } from '@/lib/adminRole';
const wrap = (role: 'OWNER' | 'ADMIN' | 'STAFF' | null = 'ADMIN') =>
  render(<AdminRoleContext.Provider value={role}><ThemeProvider><AdminClubPage /></ThemeProvider></AdminRoleContext.Provider>);
```
(Les tests existants appellent `wrap()` sans argument → défaut ADMIN, la carte reste présente, ils restent verts.)
Ajouter un test :
```typescript
it('viewer STAFF : la carte « Sections du Club-house » est masquée (le reste de la page rendu)', async () => {
  wrap('STAFF');
  // Ancre stable : le compteur de photos vient de la présentation (1 photo mockée) → prouve
  // que la page a monté et fait son fetch adminGetPresentation (elle n'est PAS gatée).
  await waitFor(() => expect(screen.getByText(/1\/12/)).toBeInTheDocument());
  expect(screen.queryByText('Sections du Club-house')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: RED**

Run : `node node_modules/jest/bin/jest.js __tests__/AdminClub.test.tsx -t "Sections du Club-house . est masquée"`
Expected: échec (la carte est rendue pour tous aujourd'hui).

- [ ] **Step 3: Gater la carte**

Dans `frontend/app/admin/club/page.tsx` :
- Import : `import { isClubAdmin, useAdminRole } from '@/lib/adminRole';`
- Dans le composant, calculer `const admin = isClubAdmin(useAdminRole());`
- Remplacer `{token && clubId && <ClubHouseSectionsCard clubId={clubId} token={token} />}` par `{admin && token && clubId && <ClubHouseSectionsCard clubId={clubId} token={token} />}`

- [ ] **Step 4: GREEN**

Run : `node node_modules/jest/bin/jest.js __tests__/AdminClub.test.tsx`
Expected: tout vert (tests existants en ADMIN + nouveau test STAFF).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/admin/club/page.tsx frontend/__tests__/AdminClub.test.tsx
git commit -m "feat(admin): carte Sections du Club-house masquee au staff (ecrit via PATCH / ADMIN)"
```

---

## Task 14 : Reformuler le hint de rôle + vérification finale

**Files:**
- Modify: `frontend/components/admin/members/MemberPanel.tsx` (constante `ROLE_HINT`)

- [ ] **Step 1: Reformuler le hint**

Dans `frontend/components/admin/members/MemberPanel.tsx`, remplacer :
```
const ROLE_HINT: Record<RoleSeg, string> = {
  NONE: "Membre simple, pas d'accès au back-office",
  STAFF: 'Accès au back-office du club',
  ADMIN: 'Back-office + gestion du staff et des niveaux',
};
```
par :
```
const ROLE_HINT: Record<RoleSeg, string> = {
  NONE: "Membre simple, pas d'accès au back-office",
  STAFF: 'Comptoir & quotidien (planning, caisse, membres, annonces)',
  ADMIN: 'Staff + structure du club (réglages, terrains, offres, comptabilité, staff, niveaux)',
};
```

- [ ] **Step 2: Vérifier la suite MemberPanel/Staff (non-régression du libellé)**

Run : `node node_modules/jest/bin/jest.js __tests__/AdminMembersStaff.test.tsx`
Expected: vert (les tests ne dépendent pas du texte exact du hint ; si un test assert le hint, l'ajuster au nouveau libellé).

- [ ] **Step 3: Vérification finale — backend routes + frontend admin + types**

Run backend (depuis `backend/`) : `node node_modules/jest/bin/jest.js src/routes/__tests__/admin.role-gates.routes.test.ts src/routes/__tests__/admin.packages.routes.test.ts src/routes/__tests__/admin.pages.routes.test.ts src/routes/__tests__/admin.subscriptions.routes.test.ts src/routes/__tests__/admin.club-logo.routes.test.ts src/routes/__tests__/admin.club-cover.routes.test.ts`
Expected: tout vert.

Run frontend (depuis `frontend/`) : `node node_modules/jest/bin/jest.js __tests__/AdminLayout.test.tsx __tests__/AdminSettings.test.tsx __tests__/AdminSettings.refresh.test.tsx __tests__/AdminResources.test.tsx __tests__/AdminPackages.test.tsx __tests__/AdminComptabilite.test.tsx __tests__/AdminPages.test.tsx __tests__/AdminClub.test.tsx __tests__/AdminMembersStaff.test.tsx`
Expected: tout vert.

Run types (depuis `frontend/`) : `node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep -E "admin/(settings|courts|packages|comptabilite|pages|club|layout)|MemberPanel|AdminComptabilite|AdminPages"`
Expected: aucune ligne (pas d'erreur de type dans les fichiers touchés ; l'erreur pré-existante `MatchesFilterBar.test.tsx` du WIP amicale/compétitive n'est pas concernée).

Run types (depuis `backend/`) : `node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep -E "routes/admin"`
Expected: aucune ligne.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/admin/members/MemberPanel.tsx frontend/__tests__/AdminMembersStaff.test.tsx
git commit -m "chore(admin): reformuler le hint de role (staff = comptoir, admin = + structure)"
```

---

## Self-review checklist (à valider en fin d'exécution)

- [ ] **Réglages** (PATCH /, logo, cover, sports) → ADMIN + garde page settings ✅ Tasks 2, 8
- [ ] **Terrains** (5 écritures, GET reste STAFF) → ADMIN + garde page courts ✅ Tasks 3, 9
- [ ] **Offres & plans** (écritures + images, GET restent STAFF) → ADMIN + garde page packages ✅ Tasks 4, 10
- [ ] **Comptabilité** (export ADMIN, summary reste STAFF) + page comptabilite ADMIN ✅ Tasks 5, 11
- [ ] **Contenu & mentions** (pages + FAQ, bloc entier) → ADMIN + garde page pages ✅ Tasks 6, 12
- [ ] **Nav** : 5 entrées gatées + sections vides filtrées ✅ Task 7
- [ ] **Page club** : carte Sections du Club-house masquée au staff ✅ Task 13
- [ ] **Restent STAFF** (non-régression testée) : GET /, GET /resources, GET /packages/*, GET /subscription-plans, GET /accounting/summary ✅ Task 1
- [ ] Hint de rôle reformulé ✅ Task 14
- [ ] Aucune migration, aucune route nouvelle, aucune garde OWNER modifiée ✅
```
