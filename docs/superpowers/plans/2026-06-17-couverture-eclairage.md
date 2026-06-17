# Couverture (Intérieur/Extérieur/Semi-couvert) + Éclairage par sport — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer le booléen « Couvert/Découvert » des terrains par une couverture à 3 états (Intérieur / Extérieur / Semi-couvert) et ajouter un attribut « Éclairage » activable par sport.

**Architecture:** `Resource.attributes.covered` (booléen) devient `attributes.coverage` (`indoor`|`outdoor`|`semi`) via une migration de données sur le JSON. Un nouveau champ `Sport.hasLighting` (migration additive) permet au superadmin d'activer l'éclairage par sport ; les terrains des sports activés portent alors `attributes.lighting` (booléen). Le tout est purement additif/rétrocompatible côté lecture (absence de `coverage` ⇒ Extérieur).

**Tech Stack:** Backend Express 5 + Prisma 7 (adapter-pg) + Jest ; Frontend Next.js 16 + React 19 + React Testing Library.

> **Pré-requis exécution :** travailler dans un **worktree hors OneDrive** (cf. habitudes projet : `C:\dev\palova-wt-couverture`). Commiter UNIQUEMENT les fichiers de chaque tâche (WIP utilisateur non commité présent dans l'arbre). `prisma generate` après tout changement de schéma. Gate back + front verts avant FF/push.

> **Choix d'icônes/couleurs (validés dans ce plan, parmi les `IconName` existants de `frontend/components/ui/Icon.tsx`) :**
> - Intérieur → icône `indoor`, couleur `#5e93da` (bleu Palova) — inchangé
> - Extérieur → icône `sun`, couleur `#ef9f6a` (apricot) — inchangé
> - Semi-couvert → icône `home`, couleur `#7aa889` (sauge)
> - Éclairage → icône `bolt`, couleur `#e6b84d` (ambre)

---

## Fichiers touchés

**Backend**
- `backend/prisma/schema.prisma` — `Sport.hasLighting` + commentaire `Resource.attributes`
- `backend/prisma/migrations/20260617120000_add_sport_lighting/migration.sql` — créer
- `backend/prisma/migrations/20260617120100_backfill_resource_coverage/migration.sql` — créer
- `backend/src/services/sport-catalog.service.ts` — `hasLighting` dans SportInput/create/update/list
- `backend/src/routes/sports.ts` — `hasLighting` dans le `select` public
- `backend/src/services/club.service.ts:156` et `:494` — `hasLighting` dans le select `sport`
- `backend/src/services/resource.service.ts:69` — `hasLighting` dans le select `sport`
- `backend/prisma/seed-demo.ts` et `backend/prisma/seed.ts` — `covered` → `coverage`, tennis `hasLighting`
- `backend/src/routes/__tests__/platform.sports.routes.test.ts` — assertions `hasLighting`

**Frontend**
- `frontend/lib/courtType.ts` — `coverageType`, `COVERAGE_OPTIONS`, `LIGHTING_BADGE`
- `frontend/__tests__/courtType.test.ts` — créer
- `frontend/lib/api.ts` — types `Sport`, `SportCatalogBody`, `Resource`, `PublicResource`, `AdminResource`, `AdminClubSport`
- `frontend/app/courts/[id]/page.tsx` — affichage joueur
- `frontend/components/ClubReserve.tsx` — affichage joueur (3 emplacements)
- `frontend/app/admin/courts/page.tsx` — select Couverture + case Éclairage
- `frontend/app/superadmin/sports/page.tsx` — case « Éclairage disponible »
- `frontend/__tests__/SuperAdminSports.test.tsx` — ajustements si besoin

---

## Task 1: Backend — schéma `Sport.hasLighting` + migrations

**Files:**
- Modify: `backend/prisma/schema.prisma` (modèle `Sport`, ~ligne 162-180 ; commentaire `Resource.attributes` ligne 335)
- Create: `backend/prisma/migrations/20260617120000_add_sport_lighting/migration.sql`
- Create: `backend/prisma/migrations/20260617120100_backfill_resource_coverage/migration.sql`

- [ ] **Step 1: Ajouter le champ au schéma**

Dans `model Sport`, après la ligne `published Boolean @default(false)` :

```prisma
  hasLighting         Boolean  @default(false) @map("has_lighting")
```

Mettre à jour le commentaire d'exemple du modèle `Resource` (champ `attributes`) :

```prisma
  attributes   Json     @default("{}") // ex { "surface": "Résine", "coverage": "indoor", "lighting": false, "format": "double" }
```

- [ ] **Step 2: Écrire la migration additive du schéma**

`backend/prisma/migrations/20260617120000_add_sport_lighting/migration.sql` :

```sql
-- Éclairage disponible pour ce sport (ex. tennis). Additif, défaut false.
ALTER TABLE "sports" ADD COLUMN "has_lighting" BOOLEAN NOT NULL DEFAULT false;
```

- [ ] **Step 3: Écrire la migration de backfill de la couverture**

`backend/prisma/migrations/20260617120100_backfill_resource_coverage/migration.sql` :

```sql
-- attributes.covered (booléen) -> attributes.coverage (indoor|outdoor). Le 3e état
-- "semi" est saisi à la main par l'admin. On retire l'ancienne clé covered.
UPDATE "resources"
SET "attributes" = ("attributes" - 'covered')
  || jsonb_build_object(
       'coverage',
       CASE WHEN ("attributes" ->> 'covered') = 'true' THEN 'indoor' ELSE 'outdoor' END
     )
WHERE "attributes" ? 'covered';
```

- [ ] **Step 4: Appliquer les migrations + régénérer le client**

Run (dossier `backend/`, Postgres up via docker-compose-v1) :
```bash
npm run db:migrate
npx prisma generate
```
Expected: deux migrations appliquées (`add_sport_lighting`, `backfill_resource_coverage`), client Prisma régénéré sans erreur.

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260617120000_add_sport_lighting backend/prisma/migrations/20260617120100_backfill_resource_coverage
git commit -m "feat(sports): Sport.hasLighting + migration couverture (covered->coverage)"
```

---

## Task 2: Backend — service catalogue accepte `hasLighting`

**Files:**
- Modify: `backend/src/services/sport-catalog.service.ts`
- Test: `backend/src/routes/__tests__/platform.sports.routes.test.ts`

- [ ] **Step 1: Écrire les assertions de test (échouent)**

Dans `platform.sports.routes.test.ts`, étendre le test de création pour inclure `hasLighting`. Le test de création existant envoie `{ name: 'Beach Tennis', resourceNoun: 'terrain', defaultDurationsMin: [60, 90], surfaces: ['Sable'] }` et vérifie `data: expect.objectContaining({...})`. Ajouter un cas dédié :

```ts
it('crée un sport avec éclairage activé', async () => {
  prismaMock.sport.create.mockResolvedValue({ id: 'sp1' } as never);
  const res = await request(app)
    .post('/api/platform/sports')
    .set('Authorization', `Bearer ${token()}`)
    .send({ name: 'Tennis', resourceNoun: 'court', defaultDurationsMin: [60], surfaces: [], hasLighting: true });
  expect(res.status).toBe(201);
  const arg = prismaMock.sport.create.mock.calls[0][0] as { data: { hasLighting: boolean } };
  expect(arg.data.hasLighting).toBe(true);
});
```

> Si le helper de mock/token diffère, réutiliser exactement les patterns déjà présents en tête de ce fichier de test (mêmes `prismaMock`, `token()`, `app`).

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

Run (dossier `backend/`): `npx jest platform.sports.routes -t "éclairage"`
Expected: FAIL (`arg.data.hasLighting` est `undefined`).

- [ ] **Step 3: Implémenter dans le service**

Dans `sport-catalog.service.ts` :

Étendre l'interface (ligne 7-11) :
```ts
export interface SportInput {
  name?: unknown; key?: unknown; icon?: unknown; resourceNoun?: unknown;
  defaultSlotStepMin?: unknown; defaultDurationsMin?: unknown; surfaces?: unknown;
  published?: unknown; hasLighting?: unknown;
}
```

Dans `listSports()` select (ligne 38-41), ajouter `hasLighting: true,` :
```ts
      select: {
        id: true, key: true, name: true, resourceNoun: true,
        defaultSlotStepMin: true, defaultDurationsMin: true, icon: true, surfaces: true, published: true,
        hasLighting: true,
      },
```

Dans `createSport()` `data` (après `surfaces: parseSurfaces(input.surfaces),`) :
```ts
          hasLighting: Boolean(input.hasLighting),
```

Dans `updateSport()` (après le bloc `if (input.surfaces !== undefined) ...`) :
```ts
    if (input.hasLighting !== undefined) data.hasLighting = Boolean(input.hasLighting);
```

- [ ] **Step 4: Lancer le test pour vérifier le succès**

Run: `npx jest platform.sports.routes`
Expected: PASS (tous, y compris l'existant).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/sport-catalog.service.ts backend/src/routes/__tests__/platform.sports.routes.test.ts
git commit -m "feat(sports): le service catalogue persiste hasLighting"
```

---

## Task 3: Backend — exposer `hasLighting` dans les selects + seeds

**Files:**
- Modify: `backend/src/routes/sports.ts:14`
- Modify: `backend/src/services/club.service.ts:156` et `:494`
- Modify: `backend/src/services/resource.service.ts:69`
- Modify: `backend/prisma/seed-demo.ts`, `backend/prisma/seed.ts`

- [ ] **Step 1: Ajouter `hasLighting` aux selects `sport`**

`sports.ts` ligne 14 (route publique `GET /api/sports`) :
```ts
        defaultSlotStepMin: true, defaultDurationsMin: true, icon: true, surfaces: true, published: true, hasLighting: true,
```

`club.service.ts` ligne 156 — ajouter `hasLighting: true` dans `sport: { select: { ... } }` :
```ts
            sport: { select: { id: true, key: true, name: true, resourceNoun: true, defaultSlotStepMin: true, defaultDurationsMin: true, icon: true, surfaces: true, hasLighting: true } },
```

`club.service.ts` ligne 494 — idem :
```ts
        sport: { select: { id: true, key: true, name: true, resourceNoun: true, defaultDurationsMin: true, surfaces: true, hasLighting: true } },
```

`resource.service.ts` ligne 69 — idem dans `clubSport.sport` :
```ts
        clubSport: { select: { id: true, slotStepMin: true, durationsMin: true, sport: { select: { key: true, name: true, resourceNoun: true, defaultSlotStepMin: true, defaultDurationsMin: true, surfaces: true, hasLighting: true } } } },
```

- [ ] **Step 2: Mettre à jour les seeds (couverture + éclairage tennis)**

Dans `seed-demo.ts`, là où les terrains de démo sont créés (boucle `for (let n = 1; n <= 5; n++)`), remplacer le booléen `covered` par `coverage` et ajouter au moins un terrain semi-couvert :

```ts
for (let n = 1; n <= 5; n++) {
  const coverage = n <= 3 ? 'indoor' : n === 4 ? 'semi' : 'outdoor';
  const material = coverage === 'outdoor' ? PADEL_SURFACES[2] : PADEL_SURFACES[0];
  const format = n <= 3 ? 'double' : 'single';
  await prisma.resource.upsert({
    where: { id: `${cdef.slug}-court-${n}` },
    update: { name: `Terrain ${n}` },
    create: {
      id: `${cdef.slug}-court-${n}`, clubId: club.id, clubSportId: clubSport.id,
      name: `Terrain ${n}`,
      attributes: { coverage, surface: material, format },
      price: n <= 3 ? 25 : 18,
    },
  });
}
```

Si un sport `tennis` est créé dans `seed-demo.ts`/`seed.ts`, ajouter `hasLighting: true` à son upsert (`update` ET `create`). Sinon laisser padel à `hasLighting: false` (défaut) — l'éclairage se testera depuis le superadmin. Vérifier qu'aucun terrain seedé ne pose encore `covered:` (rechercher la chaîne `covered` dans `seed.ts`/`seed-demo.ts` et convertir en `coverage`).

- [ ] **Step 3: Régénérer + reseed (Postgres up)**

Run (dossier `backend/`):
```bash
npx prisma generate
npm run db:seed
```
Expected: seed OK, terrains de démo avec `coverage` (dont un `semi`).

- [ ] **Step 4: Vérifier la compilation backend**

Run: `npx tsc --noEmit`
Expected: 0 erreur.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/sports.ts backend/src/services/club.service.ts backend/src/services/resource.service.ts backend/prisma/seed-demo.ts backend/prisma/seed.ts
git commit -m "feat(sports): exposer hasLighting + seeds coverage/eclairage"
```

---

## Task 4: Frontend — types API

**Files:**
- Modify: `frontend/lib/api.ts` (lignes 536-555, 615-622, 701-711, 950-968)

- [ ] **Step 1: Étendre `Sport` et `SportCatalogBody`**

`Sport` (ligne 536-546) — ajouter après `published: boolean;` :
```ts
  hasLighting: boolean;
```

`SportCatalogBody` (ligne 548-555) — ajouter après `surfaces: string[];` :
```ts
  hasLighting: boolean;
```

- [ ] **Step 2: Étendre les types de ressources (coverage + lighting)**

Remplacer dans `Resource` (ligne 618) :
```ts
  attributes: { surface?: string; coverage?: 'indoor' | 'outdoor' | 'semi'; lighting?: boolean } & Record<string, unknown>;
```

Idem dans `PublicResource` (ligne 704) :
```ts
  attributes: { surface?: string; coverage?: 'indoor' | 'outdoor' | 'semi'; lighting?: boolean } & Record<string, unknown>;
```

Idem dans `AdminResource` (ligne 960) :
```ts
  attributes: { surface?: string; format?: string; coverage?: 'indoor' | 'outdoor' | 'semi'; lighting?: boolean } & Record<string, unknown>;
```

`AdminResource.clubSport.sport` (ligne 967) — ajouter `hasLighting: boolean` :
```ts
  clubSport: { id: string; slotStepMin: number | null; durationsMin: number[]; sport: { key: string; name: string; resourceNoun: string; defaultSlotStepMin: number; defaultDurationsMin: number[]; surfaces: string[]; hasLighting: boolean } };
```

`AdminClubSport.sport` (ligne 954) — ajouter `hasLighting: boolean` :
```ts
  sport: { id: string; key: string; name: string; resourceNoun: string; defaultDurationsMin: number[]; surfaces: string[]; hasLighting: boolean };
```

- [ ] **Step 3: Vérifier la compilation frontend**

Run (dossier `frontend/`): `npx tsc --noEmit`
Expected: des erreurs **attendues** dans `courts/[id]/page.tsx`, `ClubReserve.tsx`, `admin/courts/page.tsx`, `superadmin/sports/page.tsx` (références à `covered`/`coveredType`/`emptyForm` non encore migrées) — elles seront résolues par les tâches 5-8. Aucune autre erreur ne doit apparaître. Si `courtType.ts` n'est pas encore migré, `coveredType` existe toujours → pas d'erreur sur ce point tant que Task 5 n'a pas supprimé `coveredType`.

> Pour éviter une fenêtre rouge, l'ordre recommandé est : Task 5 (helper) puis Tasks 6-8 (consommateurs) immédiatement après. Le commit de Task 4 peut se faire tel quel (les `& Record<string, unknown>` gardent l'accès aux clés legacy).

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(sports): types front coverage/lighting/hasLighting"
```

---

## Task 5: Frontend — helper `courtType.ts` (3 états + badge éclairage)

**Files:**
- Modify: `frontend/lib/courtType.ts`
- Test: `frontend/__tests__/courtType.test.ts` (créer)

- [ ] **Step 1: Écrire le test (échoue)**

`frontend/__tests__/courtType.test.ts` :
```ts
import { coverageType, COVERAGE_OPTIONS, LIGHTING_BADGE } from '@/lib/courtType';

describe('coverageType', () => {
  it('indoor → Intérieur', () => expect(coverageType('indoor').label).toBe('Intérieur'));
  it('semi → Semi-couvert', () => expect(coverageType('semi').label).toBe('Semi-couvert'));
  it('outdoor → Extérieur', () => expect(coverageType('outdoor').label).toBe('Extérieur'));
  it('undefined → Extérieur (fallback rétrocompat)', () => expect(coverageType(undefined).label).toBe('Extérieur'));
  it('chaque cas a une icône et une couleur', () => {
    for (const c of ['indoor', 'outdoor', 'semi'] as const) {
      const t = coverageType(c);
      expect(t.icon).toBeTruthy();
      expect(t.color).toMatch(/^#/);
    }
  });
});

describe('COVERAGE_OPTIONS', () => {
  it('liste les 3 états dans l’ordre Intérieur, Extérieur, Semi-couvert', () => {
    expect(COVERAGE_OPTIONS.map((o) => o.value)).toEqual(['indoor', 'outdoor', 'semi']);
  });
});

describe('LIGHTING_BADGE', () => {
  it('porte le libellé Éclairage', () => expect(LIGHTING_BADGE.label).toBe('Éclairage'));
});
```

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

Run (dossier `frontend/`): `npx jest courtType`
Expected: FAIL (`coverageType` non exporté).

- [ ] **Step 3: Implémenter le helper**

Dans `frontend/lib/courtType.ts`, **remplacer** la fonction `coveredType` (lignes 3-8) par :
```ts
export type Coverage = 'indoor' | 'outdoor' | 'semi';

/** Couverture du terrain (attributes.coverage). Absent ⇒ Extérieur (rétrocompat). */
export function coverageType(coverage?: Coverage): { label: string; icon: IconName; color: string } {
  switch (coverage) {
    case 'indoor': return { label: 'Intérieur', icon: 'indoor', color: '#5e93da' };   // bleu Palova
    case 'semi':   return { label: 'Semi-couvert', icon: 'home', color: '#7aa889' };  // sauge
    default:       return { label: 'Extérieur', icon: 'sun', color: '#ef9f6a' };       // apricot (soleil)
  }
}

export const COVERAGE_OPTIONS = [
  { value: 'indoor',  label: 'Intérieur' },
  { value: 'outdoor', label: 'Extérieur' },
  { value: 'semi',    label: 'Semi-couvert' },
] as const;

/** Badge éclairage (attributes.lighting). */
export const LIGHTING_BADGE = { label: 'Éclairage', icon: 'bolt' as IconName, color: '#e6b84d' };
```

(Garder `courtFormat`, `SINGLE_COLOR`, `playerCount`, `COURT_FORMATS` tels quels.)

- [ ] **Step 4: Lancer le test pour vérifier le succès**

Run: `npx jest courtType`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/courtType.ts frontend/__tests__/courtType.test.ts
git commit -m "feat(sports): helper coverageType 3 états + badge Éclairage"
```

---

## Task 6: Frontend — affichage joueur (détail terrain + planning)

**Files:**
- Modify: `frontend/app/courts/[id]/page.tsx` (ligne 87, 95-102 ; import ligne ~)
- Modify: `frontend/components/ClubReserve.tsx` (lignes 184-198, 238-251 ; import)

- [ ] **Step 1: `courts/[id]/page.tsx` — couverture + badge éclairage**

Adapter l'import (`coveredType` → `coverageType` ; ajouter `LIGHTING_BADGE`). Là où `coveredType` est importé en haut du fichier, remplacer par `coverageType, LIGHTING_BADGE`.

Ligne 87 — remplacer :
```ts
  const ct = coverageType(resource?.attributes?.coverage);
```

Dans le bloc d'en-tête (lignes 97-101), après le `Chip` de couverture, ajouter le badge éclairage :
```tsx
          {resource && <Chip tone="accent" icon={ct.icon}>{ct.label}</Chip>}
          {resource && resource.attributes?.lighting === true && (
            <Chip color={LIGHTING_BADGE.color} icon={LIGHTING_BADGE.icon}>{LIGHTING_BADGE.label}</Chip>
          )}
          {resource && isSingle && <Chip tone="line">Single</Chip>}
```

- [ ] **Step 2: `ClubReserve.tsx` — 3 emplacements**

Adapter l'import (`coveredType` → `coverageType`, ajouter `LIGHTING_BADGE`).

Ligne 184 (planning) :
```ts
                        const ct = coverageType(resource.attributes?.coverage);
```
Après le `Chip` couverture (ligne 189), ajouter :
```tsx
                              <Chip color={ct.color} icon={ct.icon}>{ct.label}</Chip>
                              {resource.attributes?.lighting === true && <Chip color={LIGHTING_BADGE.color} icon={LIGHTING_BADGE.icon}>{LIGHTING_BADGE.label}</Chip>}
```

Ligne 238 (cartes terrains) :
```ts
                  const ct = coverageType(r.attributes?.coverage);
```
Après le `Chip` couverture (ligne 245), ajouter :
```tsx
                            <Chip color={ct.color} icon={ct.icon}>{ct.label}</Chip>
                            {r.attributes?.lighting === true && <Chip color={LIGHTING_BADGE.color} icon={LIGHTING_BADGE.icon}>{LIGHTING_BADGE.label}</Chip>}
```

- [ ] **Step 3: Vérifier compilation + tests existants**

Run (dossier `frontend/`):
```bash
npx tsc --noEmit
npx jest ClubReserve
```
Expected: 0 erreur tsc sur ces fichiers ; tests `ClubReserve.*` PASS (s'ils référencent `covered` dans des fixtures, mettre à jour la fixture en `coverage`). 

- [ ] **Step 4: Commit**

```bash
git add frontend/app/courts/[id]/page.tsx frontend/components/ClubReserve.tsx
git commit -m "feat(sports): affichage joueur couverture 3 états + badge Éclairage"
```

---

## Task 7: Frontend — admin terrains (select Couverture + case Éclairage)

**Files:**
- Modify: `frontend/app/admin/courts/page.tsx`

- [ ] **Step 1: État + helpers**

Import (ligne 7) : ajouter `COVERAGE_OPTIONS` :
```ts
import { COURT_FORMATS, COVERAGE_OPTIONS } from '@/lib/courtType';
```

État `nr` (ligne 23) — remplacer `covered: false` par `coverage: 'outdoor', lighting: false` :
```ts
  const [nr, setNr] = useState({ name: '', clubSportId: '', surface: '', coverage: 'outdoor', lighting: false, format: 'double', price: '25', offPeakPrice: '', openHour: '8', closeHour: '22', slotStepMin: '' });
```

Remplacer le helper `editCovered` (lignes 64-67) par deux helpers :
```ts
  const editCoverage = (id: string, coverage: string) => {
    setResources((prev) => prev.map((r) => (r.id === id ? { ...r, attributes: { ...r.attributes, coverage } } : r)));
    markDirty(id);
  };
  const editLighting = (id: string, lighting: boolean) => {
    setResources((prev) => prev.map((r) => (r.id === id ? { ...r, attributes: { ...r.attributes, lighting } } : r)));
    markDirty(id);
  };
```

Après `surfacesFor` (ligne 69), ajouter :
```ts
  const lightingFor = (clubSportId: string) => sports.find((s) => s.id === clubSportId)?.sport.hasLighting ?? false;
```

- [ ] **Step 2: En-têtes du tableau**

Ligne 168 — remplacer `'Couvert'` par `'Couverture'` et ajouter `'Éclairage'` après :
```ts
                {['', 'Ressource', 'Sport', 'Surface', 'Couverture', 'Éclairage', 'Format', '€ créneau plein', '€ créneau creux', 'Ouv.', 'Ferm.', 'Créneau', 'Statut'].map((h, i) => (
```
Ligne 169 — adapter le centrage : centrer pour `Couverture` et `Éclairage` :
```ts
                  <th key={i} style={{ padding: '14px 18px', fontFamily: th.fontUI, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3, color: th.textMute, whiteSpace: 'nowrap', textAlign: (h === 'Couverture' || h === 'Éclairage') ? 'center' : 'left' }}>{h}</th>
```

- [ ] **Step 3: Cellule Couverture (select) + cellule Éclairage (case conditionnelle)**

Remplacer la cellule « Couvert » (lignes 200-202) par le select Couverture **puis** la cellule Éclairage :
```tsx
                  <td style={{ ...cell, textAlign: 'center' }}>
                    <select aria-label="Couverture" value={typeof r.attributes?.coverage === 'string' ? r.attributes.coverage : 'outdoor'} onChange={(e) => editCoverage(r.id, e.target.value)} style={{ ...input, width: 130 }}>
                      {COVERAGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </td>
                  <td style={{ ...cell, textAlign: 'center' }}>
                    {r.clubSport.sport.hasLighting ? (
                      <input type="checkbox" aria-label="Éclairage" checked={r.attributes?.lighting === true} onChange={(e) => editLighting(r.id, e.target.checked)} />
                    ) : (
                      <span style={{ color: th.textFaint }}>—</span>
                    )}
                  </td>
```

- [ ] **Step 4: Formulaire de création**

Build des attributs à la création (ligne 134) — remplacer :
```ts
        clubSportId: nr.clubSportId, name: nr.name, attributes: { surface: nr.surface || undefined, coverage: nr.coverage, format: nr.format, ...(lightingFor(nr.clubSportId) ? { lighting: nr.lighting } : {}) },
```

Reset après création (ligne 140) — remplacer `covered: false` par `coverage: 'outdoor', lighting: false` :
```ts
      setNr((n) => ({ ...n, name: '', surface: surfacesFor(n.clubSportId)[0] ?? '', coverage: 'outdoor', lighting: false, price: '25', offPeakPrice: '', openHour: '8', closeHour: '22', slotStepMin: '' }));
```

Remplacer le `label` « Couvert » du formulaire (lignes 251-253) par un select Couverture + une case Éclairage conditionnelle :
```tsx
          <label style={label}>Couverture
            <select value={nr.coverage} onChange={(e) => setNr({ ...nr, coverage: e.target.value })} style={input}>
              {COVERAGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          {lightingFor(nr.clubSportId) && (
            <label style={{ ...label, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={nr.lighting} onChange={(e) => setNr({ ...nr, lighting: e.target.checked })} /> Éclairage
            </label>
          )}
```

- [ ] **Step 5: Vérifier compilation + tests**

Run (dossier `frontend/`):
```bash
npx tsc --noEmit
npx jest admin courts
```
Expected: 0 erreur tsc ; tests liés PASS (mettre à jour toute fixture utilisant `covered`).

- [ ] **Step 6: Commit**

```bash
git add frontend/app/admin/courts/page.tsx
git commit -m "feat(sports): admin terrains — select Couverture + case Éclairage par sport"
```

---

## Task 8: Frontend — superadmin catalogue (case « Éclairage disponible »)

**Files:**
- Modify: `frontend/app/superadmin/sports/page.tsx`
- Test: `frontend/__tests__/SuperAdminSports.test.tsx` (ajuster si nécessaire)

- [ ] **Step 1: `emptyForm` + chargement du form en édition**

Ligne 12 — ajouter `hasLighting: false` :
```ts
const emptyForm = (): SportCatalogBody => ({ name: '', icon: '', resourceNoun: 'terrain', defaultSlotStepMin: 30, defaultDurationsMin: [60, 90], surfaces: [], hasLighting: false });
```

`startEdit` (ligne 37) — ajouter `hasLighting: s.hasLighting` au `setForm` :
```ts
    setForm({ name: s.name, icon: s.icon ?? '', resourceNoun: s.resourceNoun, defaultSlotStepMin: s.defaultSlotStepMin, defaultDurationsMin: [...s.defaultDurationsMin], surfaces: [...s.surfaces], hasLighting: s.hasLighting });
```

- [ ] **Step 2: Case dans le formulaire**

Juste après le bloc « Surfaces (matériaux) » (après la `</div>` de fin de ce bloc, avant les boutons Annuler/Enregistrer ligne 135), ajouter :
```tsx
            <label style={{ ...lbl, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={form.hasLighting} onChange={(e) => setForm((f) => ({ ...f, hasLighting: e.target.checked }))} />
              Éclairage disponible (terrains jouables le soir)
            </label>
```

- [ ] **Step 3: Indicateur dans la liste (optionnel mais utile)**

Dans la ligne récap du sport (ligne 155-158), ajouter la mention éclairage :
```tsx
                <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, marginTop: 3 }}>
                  Durées : {s.defaultDurationsMin.map(durationLabel).join(', ')}
                  {s.surfaces.length > 0 && <> · Surfaces : {s.surfaces.join(', ')}</>}
                  {s.hasLighting && <> · Éclairage</>}
                </div>
```

- [ ] **Step 4: Vérifier le test superadmin**

Run (dossier `frontend/`): `npx jest SuperAdminSports`
Expected: PASS. Si une fixture `Sport` du test omet `hasLighting` et que TS s'en plaint, ajouter `hasLighting: false` à la fixture. Si le test asserte la forme exacte du body envoyé à `platformCreateSport`, ajouter `hasLighting: false` à l'objet attendu.

- [ ] **Step 5: Vérifier compilation globale**

Run (dossier `frontend/`): `npx tsc --noEmit`
Expected: 0 erreur.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/superadmin/sports/page.tsx frontend/__tests__/SuperAdminSports.test.tsx
git commit -m "feat(sports): superadmin — activer l'éclairage par sport"
```

---

## Task 9: Gate complète + revue

- [ ] **Step 1: Gate backend**

Run (dossier `backend/`): `npx tsc --noEmit && npx jest`
Expected: tsc clean, suite verte.

- [ ] **Step 2: Gate frontend**

Run (dossier `frontend/`): `npx tsc --noEmit && npx jest`
Expected: tsc clean, suite verte.

- [ ] **Step 3: Vérif visuelle (facultative mais recommandée)**

Lancer back+front (cf. `palova/CLAUDE.md`), vérifier dans le navigateur :
- `/admin/courts` : colonne « Couverture » (select 3 états), colonne « Éclairage » (case si sport activé, `—` sinon).
- `/superadmin/sports` : case « Éclairage disponible » ; activer sur un sport.
- Page terrain `/courts/[id]` + planning : badges Intérieur/Extérieur/Semi-couvert et « Éclairage » le cas échéant.

- [ ] **Step 4: Revue de code**

Lancer la revue (superpowers:requesting-code-review ou `/code-review`). Corriger les retours.

---

## Self-review (auteur du plan)

- **Couverture du spec :**
  - 3 états Intérieur/Extérieur/Semi-couvert → Tasks 1 (migration), 5 (helper), 6 (joueur), 7 (admin). ✓
  - Colonne « Couverture » → Task 7. ✓
  - `Sport.hasLighting` + migration → Task 1. ✓
  - Éclairage activable par sport (superadmin) → Tasks 2, 8. ✓
  - Case éclairage sur tous les terrains du sport activé → Task 7. ✓
  - Badge « Éclairage » joueur → Task 6. ✓
  - Surfaces inchangées → aucune tâche n'y touche. ✓
- **Placeholders :** aucun TODO/TBD ; code fourni à chaque étape. ✓
- **Cohérence des types :** `coverage: 'indoor'|'outdoor'|'semi'` et `lighting?: boolean` utilisés à l'identique côté front (Task 4) et lus par `coverageType` (Task 5) ; `hasLighting` ajouté partout où `sport` est sélectionné (Task 3) et consommé via `r.clubSport.sport.hasLighting` (Task 7) et `sports[].sport.hasLighting` (Task 7) — cohérent avec les selects backend. ✓
- **Rétrocompat :** lecture `coverage` absente ⇒ Extérieur (Task 5) ; backfill convertit les `covered` existants (Task 1). ✓
