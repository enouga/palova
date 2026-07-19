# Page « Découvrir » v2 — page unique (sections + ancres) + recherche CP/département

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** Remplacer les onglets de `/decouvrir` par une page unique à 3 sections empilées (Parties → Tournois → Clubs) avec ancres collantes, et étendre la recherche de localisation au code postal et au département.

**Architecture :** La v1 (branche `feat/page-decouvrir`, HEAD `8ffdc9f`) reste acquise — composants `DiscoverMatches`/`TournamentFinder`/`ClubDirectory` réutilisés. La page orchestratrice est réécrite : plus de `?tab=`, 3 sections toujours rendues, rangée d'ancres sticky avec scroll-spy (`IntersectionObserver`, stubé dans `jest.setup.ts`), deep-links en `#hash`. Nouveau helper pur `parseLocationQuery` (ville | CP→département | code) appliqué aux 3 sections ; 2 ajouts backend additifs (projection dept des parties nationales, param `dept` de l'annuaire).

**Tech Stack :** Next.js 16 (app router client), Jest + RTL, Express + Prisma (mocks en tests).

**Spec :** `docs/superpowers/specs/2026-07-19-page-decouvrir-design.md`, section « Révision v2 ».

---

## Règles transverses (IMPÉRATIVES pour chaque subagent)

- **TDD** : test AVANT le code, le voir ÉCHOUER, puis implémenter.
- **Jamais de `new Date()` au rendu React** — horloge posée en effet.
- **Commandes** (shims `.bin` cassés) : `node node_modules/jest/bin/jest.js --runTestsByPath <fichiers>` + `node node_modules/typescript/bin/tsc --noEmit` (depuis `frontend/` ou `backend/`).
- **Git** : le working tree porte du WIP parallèle non lié (Caddyfile, `backend/src/services/{announcement,icon,sponsor}.service.ts`, composants/tests admin, `safeLink.ts`, `url.ts`…). Commits **PAR CHEMINS EXPLICITES** uniquement — jamais `git add -A`, **jamais `git stash`**.
- Full-suite frontend : flake connue BookingModal → vérifier par suites ciblées uniquement.
- Branche : rester sur `feat/page-decouvrir`.

## Écarts micro vs spec (assumés, décidés au planning)

1. **`deptCodes: string[]`** (pas `deptCode: string`) — la Corse (`20xxx` → `2A` ET `2B`) impose une liste ; partout (helper, props, param serveur CSV).
2. **Compteurs d'ancres = items actuellement visibles** dans chaque section (après TOUS ses filtres, pas seulement la localisation) — plus honnête pour l'utilisateur et implémentable par un callback uniforme `onCount` ; la spec disait « après filtre de localisation ».
3. **`TournamentFinder` gagne aussi `items?`** (données préchargées, pattern `UpcomingTournaments`) — la page fetch les tournois elle-même (nécessaire pour le scroll `#clubs` fiable : on ne scrolle qu'une fois les sections du dessus dimensionnées).
4. Le `writeUrl` du Finder **préserve désormais le hash** (un `replaceState('?…')` le supprimait — bug latent v1 sans conséquence, réel en v2).

---

### Task 1 : Backend — `department`/`departmentCode` dans la projection des parties nationales

**Files:**
- Modify: `backend/src/services/openMatch.service.ts` (constante `NATIONAL_INCLUDE`, club select ~ligne 32)
- Test: `backend/src/services/__tests__/openMatch.service.test.ts` (bloc `describe('listNationalOpenMatches')`, `clubProj` ~ligne 815)

- [ ] **Step 1 : Étendre le test (AVANT le code)** — dans `clubProj`, ajouter `department: 'Paris', departmentCode: '75'` ; dans le test « filtre … fenêtre 14 jours », étendre l'assertion de projection :

```ts
expect(args.include.resource.select.club.select).toEqual(
  expect.objectContaining({ latitude: true, longitude: true, department: true, departmentCode: true }),
);
```

- [ ] **Step 2 : Vérifier l'échec** — Run (depuis `backend/`) : `node node_modules/jest/bin/jest.js --runTestsByPath src/services/__tests__/openMatch.service.test.ts` → FAIL (projection sans department, et `out[0].club` ≠ clubProj enrichi).

- [ ] **Step 3 : Implémenter** — dans `NATIONAL_INCLUDE`, le `club.select` devient :

```ts
club: { select: { slug: true, name: true, city: true, timezone: true, accentColor: true, logoUrl: true, latitude: true, longitude: true, department: true, departmentCode: true } },
```

- [ ] **Step 4 : Vert + types** — même commande → PASS ; `node node_modules/typescript/bin/tsc --noEmit` → 0 erreur.
- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/openMatch.service.ts backend/src/services/__tests__/openMatch.service.test.ts
git commit -m "feat(open-matches): departement dans la projection club nationale (recherche CP/dept)"
```

### Task 2 : Backend — param `dept` + nom de département sur l'annuaire clubs

**Files:**
- Modify: `backend/src/services/club.service.ts` (`listClubs`, ligne ~230)
- Modify: `backend/src/routes/clubs.ts` (route `GET /`, ligne ~149)
- Test: `backend/src/services/__tests__/club.service.test.ts` (bloc listClubs existant — le localiser par grep `listClubs`)

- [ ] **Step 1 : Tests (AVANT le code)** — ajouter au bloc listClubs existant (adapter aux helpers/mocks du fichier, `prismaMock.club.findMany`) :

```ts
it('listClubs filtre par codes departement (dept)', async () => {
  prismaMock.club.findMany.mockResolvedValue([]);
  await service.listClubs({ dept: ['2A', '2B'] });
  const args = prismaMock.club.findMany.mock.calls[0][0];
  expect(args.where.departmentCode).toEqual({ in: ['2A', '2B'] });
});

it('listClubs : le filtre city matche aussi le nom de departement', async () => {
  prismaMock.club.findMany.mockResolvedValue([]);
  await service.listClubs({ city: 'gironde' });
  const args = prismaMock.club.findMany.mock.calls[0][0];
  expect(args.where.OR).toEqual(expect.arrayContaining([
    { city: { contains: 'gironde', mode: 'insensitive' } },
    { region: { contains: 'gironde', mode: 'insensitive' } },
    { department: { contains: 'gironde', mode: 'insensitive' } },
  ]));
});
```

- [ ] **Step 2 : Vérifier l'échec** — Run : `node node_modules/jest/bin/jest.js --runTestsByPath src/services/__tests__/club.service.test.ts` → 2 FAIL.
- [ ] **Step 3 : Implémenter** —

`club.service.ts`, signature : `listClubs(filters: { sport?: string; city?: string; q?: string; region?: string; lat?: number; lng?: number; dept?: string[] })` ; dans le corps :

```ts
if (filters.city) where.OR = [
  { city:       { contains: filters.city, mode: 'insensitive' } },
  { region:     { contains: filters.city, mode: 'insensitive' } },
  { department: { contains: filters.city, mode: 'insensitive' } },
];
if (filters.dept?.length) where.departmentCode = { in: filters.dept };
```

`routes/clubs.ts`, dans le handler `GET /` (après `region:`) :

```ts
dept: asString(req.query.dept) ? asString(req.query.dept).split(',').filter(Boolean) : undefined,
```

- [ ] **Step 4 : Vert + types** — suite club.service PASS + `tsc --noEmit` backend → 0 erreur.
- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/club.service.ts backend/src/routes/clubs.ts backend/src/services/__tests__/club.service.test.ts
git commit -m "feat(annuaire): filtre departement (codes CSV + nom) sur listClubs"
```

### Task 3 : `parseLocationQuery` + filtre localisation dans `lib/discover.ts` + types front

**Files:**
- Modify: `frontend/lib/discover.ts`
- Modify: `frontend/lib/api.ts` (`NationalOpenMatchClub` + `listClubs`)
- Test: `frontend/__tests__/discover.test.ts`
- Modify (fixtures, gate tsc) : `frontend/__tests__/NationalOpenMatches.test.tsx`, `frontend/__tests__/NationalMatchCard.test.tsx`, `frontend/__tests__/DiscoverMatches.test.tsx`, `frontend/__tests__/DiscoverPage.test.tsx` (ajouter `department: null, departmentCode: null` aux fixtures club — SEULEMENT les fixtures à ce stade)

- [ ] **Step 1 : Tests `parseLocationQuery` (AVANT le code)** — nouveau describe dans `discover.test.ts` :

```ts
import { parseLocationQuery } from '@/lib/discover';

describe('parseLocationQuery — ville, code postal ou département', () => {
  it('vide → aucun filtre', () => {
    expect(parseLocationQuery('')).toEqual({ city: null, deptCodes: [] });
    expect(parseLocationQuery('   ')).toEqual({ city: null, deptCodes: [] });
  });
  it('code postal 5 chiffres → département (2 premiers chiffres)', () => {
    expect(parseLocationQuery('31770')).toEqual({ city: null, deptCodes: ['31'] });
  });
  it('code postal DOM 97x → département 3 chiffres', () => {
    expect(parseLocationQuery('97400')).toEqual({ city: null, deptCodes: ['974'] });
  });
  it('code postal corse 20xxx → 2A et 2B', () => {
    expect(parseLocationQuery('20090')).toEqual({ city: null, deptCodes: ['2A', '2B'] });
  });
  it('code département direct (2 ou 3 chiffres)', () => {
    expect(parseLocationQuery('31')).toEqual({ city: null, deptCodes: ['31'] });
    expect(parseLocationQuery('974')).toEqual({ city: null, deptCodes: ['974'] });
  });
  it('20 seul → 2A et 2B ; 2a/2b → code corse majuscule', () => {
    expect(parseLocationQuery('20')).toEqual({ city: null, deptCodes: ['2A', '2B'] });
    expect(parseLocationQuery('2a')).toEqual({ city: null, deptCodes: ['2A'] });
    expect(parseLocationQuery('2B')).toEqual({ city: null, deptCodes: ['2B'] });
  });
  it('texte → recherche par nom (ville ou département)', () => {
    expect(parseLocationQuery('Colomiers')).toEqual({ city: 'Colomiers', deptCodes: [] });
  });
});
```

- [ ] **Step 2 : Tests du filtre localisation** — dans le describe `filterNationalMatches` existant, la fabrique de match gagne `department`/`departmentCode` paramétrables (`over.department ?? null`, `over.departmentCode ?? null` dans le club). Adapter TOUS les appels existants : `city: 'X'` du filtre devient `location: { city: 'X', deptCodes: [] }` (période/niveau : `location: { city: null, deptCodes: [] }`). Ajouter :

```ts
it('deptCodes filtre sur club.departmentCode (insensible casse)', () => {
  const inDept  = m({ id: 'a', departmentCode: '31' });
  const outDept = m({ id: 'b', departmentCode: '75' });
  const noDept  = m({ id: 'c' }); // departmentCode null → exclu quand filtre actif
  const out = filterNationalMatches([inDept, outDept, noDept], { period: 'all', location: { city: null, deptCodes: ['31'] }, myLevel: null }, now);
  expect(out.map((x) => x.id)).toEqual(['a']);
});
it('city texte matche aussi le nom du département', () => {
  const byDeptName = m({ id: 'a', city: 'Muret', department: 'Haute-Garonne' });
  const other      = m({ id: 'b', city: 'Paris', department: 'Paris' });
  const out = filterNationalMatches([byDeptName, other], { period: 'all', location: { city: 'haute-garonne', deptCodes: [] }, myLevel: null }, now);
  expect(out.map((x) => x.id)).toEqual(['a']);
});
```

- [ ] **Step 3 : Vérifier l'échec** — Run (depuis `frontend/`) : `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/discover.test.ts` → FAIL (export absent + signature).
- [ ] **Step 4 : Implémenter** —

`lib/api.ts` : `NationalOpenMatchClub` gagne `department: string | null; departmentCode: string | null;` ; `listClubs` gagne `dept?: string[]` dans son type de filtres et :

```ts
if (filters.dept && filters.dept.length) qs.set('dept', filters.dept.join(','));
```

`lib/discover.ts` :

```ts
/** Requête de localisation parsée : ville OU codes département (exclusifs). */
export interface LocationQuery { city: string | null; deptCodes: string[] }

/** « Ville, code postal ou département » : un CP est réduit à son département (97x → 3 chiffres,
 *  Corse 20xxx → 2A+2B) ; un code 2-3 chiffres passe tel quel ; sinon recherche par nom. */
export function parseLocationQuery(q: string): LocationQuery {
  const t = q.trim();
  if (!t) return { city: null, deptCodes: [] };
  if (/^\d{5}$/.test(t)) {
    if (t.startsWith('20')) return { city: null, deptCodes: ['2A', '2B'] };
    if (t.startsWith('97')) return { city: null, deptCodes: [t.slice(0, 3)] };
    return { city: null, deptCodes: [t.slice(0, 2)] };
  }
  if (/^2[abAB]$/.test(t)) return { city: null, deptCodes: [t.toUpperCase()] };
  if (t === '20') return { city: null, deptCodes: ['2A', '2B'] };
  if (/^\d{2,3}$/.test(t)) return { city: null, deptCodes: [t] };
  return { city: t, deptCodes: [] };
}
```

`DiscoverMatchFilter` : `{ period: DiscoverPeriod; location: LocationQuery; myLevel: number | null }`. Dans `filterNationalMatches`, remplacer le bloc ville par :

```ts
const { city, deptCodes } = f.location;
const needle = city ? norm(city) : null;
const locOk = (m: NationalOpenMatch) => {
  if (deptCodes.length) return m.club.departmentCode != null && deptCodes.includes(m.club.departmentCode.toUpperCase());
  if (needle) return (m.club.city != null && norm(m.club.city).includes(needle))
    || (m.club.department != null && norm(m.club.department).includes(needle));
  return true;
};
```

Fixtures des 4 suites listées : + `department: null, departmentCode: null` (aucune autre modification à ce stade — `DiscoverMatches.test`/`DiscoverPage.test` seront adaptés en Task 4/7 ; si la prop `city` casse la compilation ici, ne PAS l'adapter encore : ce step ne doit toucher que les fixtures, l'échec de suite est traité en Task 4).

- [ ] **Step 5 : Verts + types** — `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/discover.test.ts __tests__/NationalOpenMatches.test.tsx __tests__/NationalMatchCard.test.tsx` → PASS. (`tsc` global passera en fin de Task 4, la signature de `DiscoverMatches` changeant juste après.)
- [ ] **Step 6 : Commit**

```bash
git add frontend/lib/discover.ts frontend/lib/api.ts frontend/__tests__/discover.test.ts frontend/__tests__/NationalOpenMatches.test.tsx frontend/__tests__/NationalMatchCard.test.tsx
git commit -m "feat(decouvrir): parseLocationQuery (ville/CP/departement) + filtre localisation des parties"
```

### Task 4 : `DiscoverMatches` — prop `location` (remplace `city`) + callback `onCount`

**Files:**
- Modify: `frontend/components/discover/DiscoverMatches.tsx`
- Test: `frontend/__tests__/DiscoverMatches.test.tsx`

- [ ] **Step 1 : Adapter les tests (AVANT le code)** — remplacer partout la prop `city="…"` par `location={{ city: '…', deptCodes: [] }}` (défaut : `location={{ city: null, deptCodes: [] }}`) ; ajouter :

```ts
it('location.deptCodes filtre par code département', async () => {
  render(wrap(<DiscoverMatches matches={[matchParis, matchLyon]} location={{ city: null, deptCodes: ['69'] }} coords={null} now={now} onSeeClubs={jest.fn()} />));
  // fixtures : matchParis.club.departmentCode = '75', matchLyon = '69'
  expect(await screen.findByText('Padel Lyon')).toBeInTheDocument();
  expect(screen.queryByText('Padel Paris')).not.toBeInTheDocument();
});
it('onCount reçoit le nombre de cartes affichées', async () => {
  const onCount = jest.fn();
  render(wrap(<DiscoverMatches matches={[matchParis, matchLyon]} location={{ city: null, deptCodes: [] }} coords={null} now={now} onSeeClubs={jest.fn()} onCount={onCount} />));
  await screen.findByText('Padel Paris');
  expect(onCount).toHaveBeenLastCalledWith(2);
});
```

(fixtures Paris/Lyon : ajouter `departmentCode: '75'` / `'69'`.)

- [ ] **Step 2 : Vérifier l'échec** — `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/DiscoverMatches.test.tsx` → FAIL.
- [ ] **Step 3 : Implémenter** — signature :

```ts
export function DiscoverMatches({ matches, location, coords, now, onSeeClubs, onCount }: {
  matches: NationalOpenMatch[] | null;
  location: LocationQuery;
  coords: { lat: number; lng: number } | null;
  now: Date | null;
  onSeeClubs: () => void;
  onCount?: (n: number) => void;
})
```

Pipeline : `filterNationalMatches(matches, { period, location, myLevel }, now)` ; après calcul de `ranked`, effet :

```ts
useEffect(() => { if (ranked) onCount?.(ranked.length); }, [ranked?.length, onCount]);
```

(quand `matches === null || now === null`, ne pas appeler `onCount` — compteur inconnu.)

- [ ] **Step 4 : Verts + types** — suite PASS + `node node_modules/typescript/bin/tsc --noEmit` (frontend) → il ne doit rester d'erreur que dans `app/decouvrir/page.tsx` (encore en v1 avec `city=`) — c'est attendu, la page est réécrite en Task 7 ; si d'autres fichiers cassent, les corriger ici.

Note : pour que `tsc` reste vert d'ici Task 7, adapter DANS CETTE TÂCHE l'appel dans `app/decouvrir/page.tsx` : `<DiscoverMatches matches={matches} location={{ city, deptCodes: [] }} …/>` (pont temporaire minimal, la page v1 fonctionne toujours).

- [ ] **Step 5 : Commit**

```bash
git add frontend/components/discover/DiscoverMatches.tsx frontend/__tests__/DiscoverMatches.test.tsx frontend/app/decouvrir/page.tsx
git commit -m "feat(decouvrir): DiscoverMatches filtre par LocationQuery + onCount"
```

### Task 5 : `TournamentFinder` — props `items`/`deptCodes`/`onCount`, département dans le filtre texte, hash préservé

**Files:**
- Modify: `frontend/components/calendar/TournamentFinder.tsx`
- Test: `frontend/__tests__/TournamentFinder.test.tsx`

- [ ] **Step 1 : Tests (AVANT le code)** — la fixture `NAT` gagne `department: 'Paris'/'Rhône'` (les `departmentCode: '75'/'69'` y sont déjà). Ajouter :

```ts
it('prop items : données préchargées, aucun fetch', async () => {
  render(<ThemeProvider><TournamentFinder items={NAT} /></ThemeProvider>);
  expect(await screen.findByText('GP Paris')).toBeInTheDocument();
  expect(api.listNationalTournaments).not.toHaveBeenCalled();
});
it('prop deptCodes filtre par code département (facettes comprises)', async () => {
  render(<ThemeProvider><TournamentFinder items={NAT} deptCodes={['69']} /></ThemeProvider>);
  expect(await screen.findByText('Open Lyon')).toBeInTheDocument();
  expect(screen.queryByText('GP Paris')).not.toBeInTheDocument();
});
it('prop city matche aussi le nom du département', async () => {
  render(<ThemeProvider><TournamentFinder items={NAT} city="rhone" /></ThemeProvider>);
  expect(await screen.findByText('Open Lyon')).toBeInTheDocument();
  expect(screen.queryByText('GP Paris')).not.toBeInTheDocument();
});
it('onCount reçoit le nombre de résultats affichés', async () => {
  const onCount = jest.fn();
  render(<ThemeProvider><TournamentFinder items={NAT} onCount={onCount} /></ThemeProvider>);
  await screen.findByText('GP Paris');
  await waitFor(() => expect(onCount).toHaveBeenLastCalledWith(2));
});
it('writeUrl préserve le hash', async () => {
  window.history.replaceState(null, '', '/decouvrir#tournois');
  render(<ThemeProvider><TournamentFinder items={NAT} /></ThemeProvider>);
  await screen.findByText('GP Paris');
  fireEvent.click(screen.getByText(/Paris 1/));
  await waitFor(() => expect(window.location.search).toContain('dept=75'));
  expect(window.location.hash).toBe('#tournois');
});
```

- [ ] **Step 2 : Vérifier l'échec** — `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/TournamentFinder.test.tsx` → 5 nouveaux FAIL, 6 anciens PASS.
- [ ] **Step 3 : Implémenter** — signature :

```ts
export function TournamentFinder({ coords = null, city = '', deptCodes = [], hideTitle = false, items: preloaded, onCount }: {
  coords?: { lat: number; lng: number } | null;
  city?: string;
  deptCodes?: string[];
  hideTitle?: boolean;
  items?: NationalTournament[] | null;
  onCount?: (n: number) => void;
} = {})
```

1. **items** (pattern `UpcomingTournaments`) : `const selfFetch = preloaded === undefined;` — l'effet de fetch existant devient `useEffect(() => { if (!selfFetch) return; api.listNationalTournaments()… }, [selfFetch])` ; la donnée consommée : `const items = selfFetch ? fetched : (preloaded ?? null);`.
2. **Filtre localisation** — le mémo `cityItems` existant devient `locItems` :

```ts
const locItems = useMemo(() => {
  if (!items) return items;
  let out = items;
  if (deptCodes.length) out = out.filter((t) => t.club.departmentCode != null && deptCodes.includes(t.club.departmentCode.toUpperCase()));
  if (city.trim()) {
    const needle = norm(city.trim());
    out = out.filter((t) => (t.club.city != null && norm(t.club.city).includes(needle))
      || (t.club.department != null && norm(t.club.department).includes(needle)));
  }
  return out;
}, [items, city, deptCodes]);
```

(⚠️ `deptCodes` array recréé par le parent à chaque render → le parent (Task 7) le mémoïse ; ici mettre `deptCodes.join(',')` dans les deps si on veut blinder : `[items, city, deptCodes.join(',')]`.) `facets` et `results` consomment `locItems`.
3. **onCount** : `useEffect(() => { if (results) onCount?.(results.length); }, [results?.length, onCount]);`
4. **hash préservé** dans writeUrl :

```ts
window.history.replaceState(null, '', (qs ? `?${qs}` : window.location.pathname) + window.location.hash);
```

- [ ] **Step 4 : 11 tests verts + types** — suite PASS + `tsc --noEmit` frontend (0 erreur hors éventuel pont page réglé en Task 4).
- [ ] **Step 5 : Commit**

```bash
git add frontend/components/calendar/TournamentFinder.tsx frontend/__tests__/TournamentFinder.test.tsx
git commit -m "feat(tournois): TournamentFinder items/deptCodes/onCount + hash preserve"
```

### Task 6 : `ClubDirectory` — props `deptCodes`/`onCount`

**Files:**
- Modify: `frontend/components/ClubDirectory.tsx`
- Test: `frontend/__tests__/ClubDirectory.test.tsx`

- [ ] **Step 1 : Tests (AVANT le code)** :

```ts
it('prop deptCodes → listClubs reçoit dept', async () => {
  render(<ThemeProvider><ClubDirectory deptCodes={['2A', '2B']} /></ThemeProvider>);
  await waitFor(() => expect(listClubs).toHaveBeenCalledWith(expect.objectContaining({ dept: ['2A', '2B'] })));
});
it('onCount reçoit le nombre de clubs affichés', async () => {
  listClubs.mockResolvedValue([clubFixture]); // réutiliser la fixture club du fichier
  const onCount = jest.fn();
  render(<ThemeProvider><ClubDirectory onCount={onCount} /></ThemeProvider>);
  await waitFor(() => expect(onCount).toHaveBeenLastCalledWith(1));
});
```

- [ ] **Step 2 : Vérifier l'échec** — `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/ClubDirectory.test.tsx` → 2 FAIL.
- [ ] **Step 3 : Implémenter** — signature : `ClubDirectory({ city, coords, deptCodes, onCount }: { city?: string; coords?: {lat,lng} | null; deptCodes?: string[]; onCount?: (n: number) => void } = {})`. `deptCodes` fourni (non-undefined) compte dans `controlled` (`controlled = cityProp !== undefined || coordsProp !== undefined || deptCodes !== undefined`). Dans `load` : `...(deptCodes && deptCodes.length ? { dept: deptCodes } : {})` passé à `api.listClubs` ; deps du `useCallback` : ajouter `deptCodes?.join(',')`. Après `setClubs(...)` dans `load` : `onCount?.(list.length)` (et `onCount?.(0)` dans le catch). `onCount` ajouté aux deps.
- [ ] **Step 4 : Verts + types** — suite PASS (les tests existants inchangés) + `tsc --noEmit`.
- [ ] **Step 5 : Commit**

```bash
git add frontend/components/ClubDirectory.tsx frontend/__tests__/ClubDirectory.test.tsx
git commit -m "feat(annuaire): ClubDirectory deptCodes + onCount"
```

### Task 7 : Page `/decouvrir` v2 — sections empilées + ancres collantes + hash

**Files:**
- Create: `frontend/components/discover/DiscoverAnchors.tsx`
- Rewrite: `frontend/app/decouvrir/page.tsx`
- Rewrite test: `frontend/__tests__/DiscoverPage.test.tsx`
- Create test: `frontend/__tests__/DiscoverAnchors.test.tsx`

- [ ] **Step 1 : Tests `DiscoverAnchors` (AVANT le code)** :

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { DiscoverAnchors } from '@/components/discover/DiscoverAnchors';

const items = [
  { id: 'parties', label: 'Parties', count: 4 },
  { id: 'tournois', label: 'Tournois', count: 2 },
  { id: 'clubs', label: 'Clubs', count: null }, // null = compteur inconnu (pas encore chargé)
];

it('rend une ancre par section avec compteur (masqué si null)', () => {
  render(<ThemeProvider><DiscoverAnchors items={items} active="parties" onJump={jest.fn()} /></ThemeProvider>);
  expect(screen.getByRole('button', { name: 'Parties 4' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Tournois 2' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Clubs' })).toBeInTheDocument(); // pas de compteur
});
it('signale la section active (aria-current)', () => {
  render(<ThemeProvider><DiscoverAnchors items={items} active="tournois" onJump={jest.fn()} /></ThemeProvider>);
  expect(screen.getByRole('button', { name: 'Tournois 2' })).toHaveAttribute('aria-current', 'true');
  expect(screen.getByRole('button', { name: 'Parties 4' })).not.toHaveAttribute('aria-current');
});
it('clic → onJump(id)', () => {
  const onJump = jest.fn();
  render(<ThemeProvider><DiscoverAnchors items={items} active="parties" onJump={onJump} /></ThemeProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Clubs' }));
  expect(onJump).toHaveBeenCalledWith('clubs');
});
```

- [ ] **Step 2 : Vérifier l'échec** → « Cannot find module ».
- [ ] **Step 3 : Implémenter `DiscoverAnchors.tsx`** (présentationnel pur — le scroll-spy vit dans la page) :

```tsx
'use client';
import { useTheme } from '@/lib/ThemeProvider';

export interface DiscoverAnchorItem { id: string; label: string; count: number | null }

// Rangée d'ancres collante de /decouvrir : navigation dans le scroll (PAS des onglets —
// les sections restent toutes rendues). Le parent fournit la section active (scroll-spy).
export function DiscoverAnchors({ items, active, onJump }: {
  items: DiscoverAnchorItem[];
  active: string;
  onJump: (id: string) => void;
}) {
  const { th } = useTheme();
  return (
    <div style={{ position: 'sticky', top: 0, zIndex: 30, background: th.bg, padding: '8px 20px' }}>
      <div style={{ display: 'flex', gap: 4, background: th.surface2, borderRadius: 999, padding: 4 }}>
        {items.map((it) => {
          const isActive = it.id === active;
          return (
            <button key={it.id} onClick={() => onJump(it.id)} aria-current={isActive ? 'true' : undefined}
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                border: 'none', cursor: 'pointer', borderRadius: 999, padding: '9px 6px',
                fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap',
                background: isActive ? th.surface : 'transparent',
                color: isActive ? th.text : th.textMute,
                boxShadow: isActive ? th.shadowSoft : 'none' }}>
              {it.label}
              {it.count != null && (
                <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '1px 7px',
                  background: isActive ? `${th.accent}26` : th.surface, color: th.textMute }}>{it.count}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4 : Verts** — `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/DiscoverAnchors.test.tsx` → PASS. Commit intermédiaire :

```bash
git add frontend/components/discover/DiscoverAnchors.tsx frontend/__tests__/DiscoverAnchors.test.tsx
git commit -m "feat(decouvrir): rangee d'ancres collante DiscoverAnchors"
```

- [ ] **Step 5 : Réécrire `__tests__/DiscoverPage.test.tsx` (AVANT la page)** — garder les mocks v1 (next/navigation, ClubProvider, @/lib/nav→hardNavigate, useAuth, @/lib/api complet + assetUrl) et les fixtures Paris/Lyon (avec `department`/`departmentCode: '75'/'69'`). `listNationalTournaments` résout `[]` par défaut. `beforeEach` : reset URL `'/decouvrir'` (et hash vide). Stub scrollIntoView : `beforeAll(() => { Element.prototype.scrollIntoView = jest.fn(); });`. Cas :

```tsx
it('rend les 3 sections simultanément (plus d\'onglets)', async () => {
  wrap();
  expect(await screen.findAllByRole('link', { name: /Rejoindre la partie/ })).toHaveLength(2);
  await waitFor(() => expect(listNationalTournaments).toHaveBeenCalledTimes(1)); // fetch page, dès l'arrivée
  await waitFor(() => expect(listClubs).toHaveBeenCalled());
  expect(screen.queryByRole('button', { name: 'Parties' })).not.toBeInTheDocument(); // plus de PillTabs onglets
});
it('les ancres portent les compteurs et scrollent vers la section', async () => {
  wrap();
  const anchor = await screen.findByRole('button', { name: 'Parties 2' });
  fireEvent.click(screen.getByRole('button', { name: /Clubs/ }));
  expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  expect(anchor).toBeInTheDocument();
});
it('#clubs au chargement scrolle vers la section clubs une fois les données arrivées', async () => {
  window.history.replaceState(null, '', '/decouvrir#clubs');
  wrap();
  await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
});
it('champ localisation : un code postal filtre les 3 sections par département', async () => {
  wrap();
  await screen.findAllByRole('link', { name: /Rejoindre la partie/ });
  fireEvent.change(screen.getByPlaceholderText('Ville, code postal ou département'), { target: { value: '69000' } });
  await waitFor(() => expect(screen.queryByText('Padel Paris')).not.toBeInTheDocument());
  expect(screen.getByText('Padel Lyon')).toBeInTheDocument();
  await waitFor(() => expect(listClubs).toHaveBeenLastCalledWith(expect.objectContaining({ dept: ['69'] })));
});
it('champ localisation : une ville filtre par nom', async () => {
  wrap();
  await screen.findAllByRole('link', { name: /Rejoindre la partie/ });
  fireEvent.change(screen.getByPlaceholderText('Ville, code postal ou département'), { target: { value: 'Lyon' } });
  await waitFor(() => expect(screen.queryByText('Padel Paris')).not.toBeInTheDocument());
  await waitFor(() => expect(listClubs).toHaveBeenLastCalledWith(expect.objectContaining({ city: 'Lyon' })));
});
it('hôte club : redirige vers la plateforme (hash préservé), rien rendu', () => {
  window.history.replaceState(null, '', '/decouvrir#clubs');
  clubCtx = { slug: 'demo', club: null, loading: false };
  const { container } = wrap();
  expect(hardNavigate).toHaveBeenCalledTimes(1);
  const url = hardNavigate.mock.calls[0][0] as string;
  expect(url).toContain('/decouvrir');
  expect(url).toContain('#clubs');
  expect(url).not.toContain('demo.');
  expect(container).toBeEmptyDOMElement();
});
it('anonyme : pas de chip « À mon niveau », getMyRating jamais appelé', async () => {
  wrap();
  await screen.findAllByRole('link', { name: /Rejoindre la partie/ });
  expect(screen.queryByRole('button', { name: 'À mon niveau' })).not.toBeInTheDocument();
  expect(getMyRating).not.toHaveBeenCalled();
});
it('état vide parties : « Voir les clubs » scrolle vers la section clubs', async () => {
  listNationalOpenMatches.mockResolvedValue([]);
  wrap();
  const btn = await screen.findByRole('button', { name: /Voir les clubs/ });
  fireEvent.click(btn);
  expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
});
```

- [ ] **Step 6 : Vérifier l'échec** — `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/DiscoverPage.test.tsx` → FAIL (page encore en v1 onglets).
- [ ] **Step 7 : Réécrire `app/decouvrir/page.tsx`** :

```tsx
'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, NationalOpenMatch, NationalTournament } from '@/lib/api';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { hardNavigate } from '@/lib/nav';
import { platformUrl } from '@/lib/clubUrl';
import { parseLocationQuery } from '@/lib/discover';
import { Screen } from '@/components/ui/Screen';
import { Logotype, MyBookingsButton, ThemeToggle } from '@/components/ui/atoms';
import { ProfileMenu } from '@/components/ProfileMenu';
import { DiscoverAnchors } from '@/components/discover/DiscoverAnchors';
import { DiscoverMatches } from '@/components/discover/DiscoverMatches';
import { TournamentFinder } from '@/components/calendar/TournamentFinder';
import { ClubDirectory } from '@/components/ClubDirectory';

const SECTION_IDS = ['parties', 'tournois', 'clubs'] as const;
type SectionId = (typeof SECTION_IDS)[number];

// Page « Découvrir » v2 : UNE page, trois sections empilées (Parties → Tournois → Clubs),
// rangée d'ancres collante (navigation dans le scroll, pas des onglets), barre de
// localisation unique (ville / code postal / département + géoloc) qui filtre tout.
// Deep-links : #parties / #tournois / #clubs (les redirections /clubs et /tournois les posent).
export default function DiscoverPage() {
  const { th } = useTheme();
  const { slug } = useClub();

  const [locInput, setLocInput] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [geoState, setGeoState] = useState<'idle' | 'locating' | 'denied'>('idle');
  const location = useMemo(() => parseLocationQuery(locInput), [locInput]);

  const [matches, setMatches] = useState<NationalOpenMatch[] | null>(null);
  const [tournaments, setTournaments] = useState<NationalTournament[] | null>(null);
  const [now, setNow] = useState<Date | null>(null);

  // Compteurs remontés par chaque section (items actuellement affichés).
  const [counts, setCounts] = useState<Record<SectionId, number | null>>({ parties: null, tournois: null, clubs: null });
  const countFor = useCallback((id: SectionId) => (n: number) => setCounts((c) => (c[id] === n ? c : { ...c, [id]: n })), []);
  const onCountParties = useMemo(() => countFor('parties'), [countFor]);
  const onCountTournois = useMemo(() => countFor('tournois'), [countFor]);
  const onCountClubs = useMemo(() => countFor('clubs'), [countFor]);

  // Scroll-spy : section active = la plus visible (IntersectionObserver, stubé en jsdom).
  const [active, setActive] = useState<SectionId>('parties');
  const sectionRefs = useRef<Record<SectionId, HTMLElement | null>>({ parties: null, tournois: null, clubs: null });

  // /decouvrir n'existe que sur la plateforme : un hôte club renvoie vers le domaine racine
  // (query + hash conservés) — et les effets data restent inertes pendant la redirection.
  useEffect(() => {
    if (slug) hardNavigate(platformUrl('/decouvrir' + window.location.search + window.location.hash));
  }, [slug]);

  useEffect(() => {
    if (slug) return;
    const tick = () => setNow(new Date());
    const t = setTimeout(tick, 0);
    const h = setInterval(tick, 60_000);
    return () => { clearTimeout(t); clearInterval(h); };
  }, [slug]);

  useEffect(() => {
    if (slug) return;
    api.listNationalOpenMatches().then(setMatches).catch(() => setMatches([]));
    api.listNationalTournaments().then(setTournaments).catch(() => setTournaments([]));
  }, [slug]);

  useEffect(() => {
    if (slug) return;
    const io = new IntersectionObserver((entries) => {
      const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      const id = visible?.target.getAttribute('data-section') as SectionId | undefined;
      if (id) setActive(id);
    }, { rootMargin: '-96px 0px -55% 0px' });
    for (const id of SECTION_IDS) { const el = sectionRefs.current[id]; if (el) io.observe(el); }
    return () => io.disconnect();
  }, [slug]);

  const jumpTo = useCallback((id: string) => {
    sectionRefs.current[id as SectionId]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // Deep-link #hash : on ne scrolle qu'une fois les sections du dessus dimensionnées
  // (parties + tournois chargés), sinon l'ancre dérive pendant que la page grandit.
  const jumpedRef = useRef(false);
  useEffect(() => {
    if (slug || jumpedRef.current || matches === null || tournaments === null) return;
    const target = window.location.hash.slice(1) as SectionId;
    if ((SECTION_IDS as readonly string[]).includes(target)) { jumpedRef.current = true; jumpTo(target); }
  }, [slug, matches, tournaments, jumpTo]);

  const locateMe = () => {
    if (!navigator.geolocation) { setGeoState('denied'); return; }
    setGeoState('locating');
    navigator.geolocation.getCurrentPosition(
      (p) => { setCoords({ lat: p.coords.latitude, lng: p.coords.longitude }); setGeoState('idle'); },
      () => setGeoState('denied'),
      { timeout: 8000 },
    );
  };

  if (slug) return null; // hôte club : redirection vers la plateforme en cours

  const sectionTitle: React.CSSProperties = { fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 22, color: th.text, letterSpacing: -0.3, scrollMarginTop: 72 };

  return (
    <Screen>
      <div style={{ paddingBottom: 40 }}>
        <div style={{ padding: '28px 20px 6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Logotype size={22} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <MyBookingsButton />
              <ThemeToggle />
              <ProfileMenu />
            </div>
          </div>
          <div style={{ fontFamily: th.fontDisplay, fontWeight: 500, fontSize: 38, lineHeight: 1.05, color: th.text, marginTop: 22, letterSpacing: -0.5 }}>
            Découvrir
          </div>
          <p style={{ fontFamily: th.fontUI, fontSize: 14.5, color: th.textMute, marginTop: 8 }}>
            Clubs, parties et tournois, partout sur Palova.
          </p>
        </div>

        {/* Barre de localisation unique : ville, code postal ou département + géoloc. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '14px 20px 0' }}>
          <input
            value={locInput}
            onChange={(e) => setLocInput(e.target.value)}
            placeholder="Ville, code postal ou département"
            style={{ flex: '1 1 220px', minWidth: 0, height: 46, padding: '0 14px', borderRadius: 12,
              background: th.surface, color: th.text, border: 'none', boxShadow: `inset 0 0 0 1.5px ${th.line}`,
              fontFamily: th.fontUI, fontSize: 15 }}
          />
          <button onClick={locateMe} style={locateBtnStyle(th, !!coords)}>
            📍 {coords ? 'Autour de moi ✓' : geoState === 'locating' ? 'Localisation…' : 'Autour de moi'}
          </button>
          {geoState === 'denied' && (
            <span style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textFaint }}>
              Localisation indisponible — cherchez par ville ou département.
            </span>
          )}
        </div>

        <DiscoverAnchors
          items={[
            { id: 'parties', label: 'Parties', count: counts.parties },
            { id: 'tournois', label: 'Tournois', count: counts.tournois },
            { id: 'clubs', label: 'Clubs', count: counts.clubs },
          ]}
          active={active}
          onJump={jumpTo}
        />

        <section id="parties" data-section="parties" ref={(el) => { sectionRefs.current.parties = el; }} style={{ paddingTop: 10 }}>
          <div style={{ padding: '0 20px' }}>
            <h2 style={sectionTitle}>Ça joue bientôt</h2>
            <DiscoverMatches matches={matches} location={location} coords={coords} now={now}
              onSeeClubs={() => jumpTo('clubs')} onCount={onCountParties} />
          </div>
        </section>

        <section id="tournois" data-section="tournois" ref={(el) => { sectionRefs.current.tournois = el; }} style={{ paddingTop: 26 }}>
          <div style={{ padding: '0 20px' }}>
            <h2 style={sectionTitle}>Tournois</h2>
          </div>
          <TournamentFinder hideTitle items={tournaments} coords={coords}
            city={location.city ?? ''} deptCodes={location.deptCodes} onCount={onCountTournois} />
        </section>

        <section id="clubs" data-section="clubs" ref={(el) => { sectionRefs.current.clubs = el; }} style={{ paddingTop: 26 }}>
          <div style={{ padding: '0 20px' }}>
            <h2 style={sectionTitle}>Clubs</h2>
          </div>
          <ClubDirectory city={location.city ?? ''} coords={coords} deptCodes={location.deptCodes} onCount={onCountClubs} />
        </section>
      </div>
    </Screen>
  );
}

function locateBtnStyle(th: ReturnType<typeof useTheme>['th'], active: boolean): React.CSSProperties {
  return {
    flexShrink: 0, border: 'none', cursor: 'pointer', borderRadius: 10, padding: '10px 16px',
    fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap',
    background: active ? th.ink : th.surface2,
    color: active ? (th.mode === 'floodlit' ? th.text : '#f7f5ee') : th.textMute,
  };
}
```

⚠️ Pièges : `location.deptCodes` est recréé par `parseLocationQuery` à chaque frappe mais `location` est mémoïsé sur `locInput` → identité stable entre renders sans frappe ; le Finder blinde de toute façon ses deps avec `deptCodes.join(',')` (Task 5). `PillTabs` n'est plus importé.

- [ ] **Step 8 : Verts + types** — `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/DiscoverPage.test.tsx __tests__/DiscoverMatches.test.tsx __tests__/DiscoverAnchors.test.tsx` → PASS ; `node node_modules/typescript/bin/tsc --noEmit` → 0 erreur.
- [ ] **Step 9 : Commit**

```bash
git add frontend/app/decouvrir/page.tsx frontend/__tests__/DiscoverPage.test.tsx
git commit -m "feat(decouvrir): page unique v2 - sections empilees + ancres collantes + recherche CP/departement"
```

### Task 8 : Deep-links `#hash` — redirections et liens

**Files:**
- Modify: `frontend/app/clubs/page.tsx` (cible du stub)
- Modify: `frontend/app/tournois/page.tsx` (cible plateforme)
- Modify: `frontend/components/calendar/UpcomingTournaments.tsx` (lien « Voir tout le calendrier »)
- Modify: `frontend/app/me/reservations/page.tsx` (3 occurrences `/decouvrir?tab=clubs` : `BackButton`, bouton Réserver, `reserveHref`)
- Test: `frontend/__tests__/DiscoverRedirects.test.tsx`, `frontend/__tests__/UpcomingTournaments.test.tsx`

- [ ] **Step 1 : Adapter les tests (AVANT le code)** — dans `DiscoverRedirects.test.tsx` : `replace('/decouvrir?tab=clubs')` → `replace('/decouvrir#clubs')` et `replace('/decouvrir?tab=tournois')` → `replace('/decouvrir#tournois')` (branche hôte club `/events?filtre=competitions` inchangée). Dans `UpcomingTournaments.test.tsx` : le href attendu contient `/decouvrir#tournois`.
- [ ] **Step 2 : Vérifier l'échec** — `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/DiscoverRedirects.test.tsx __tests__/UpcomingTournaments.test.tsx` → FAIL.
- [ ] **Step 3 : Implémenter** — remplacer les cibles : `app/clubs/page.tsx` → `router.replace('/decouvrir#clubs')` ; `app/tournois/page.tsx` → `router.replace(slug ? '/events?filtre=competitions' : '/decouvrir#tournois')` ; `UpcomingTournaments.tsx` → `platformUrl('/decouvrir#tournois')` ; `me/reservations/page.tsx` → les 3 occurrences `'/decouvrir?tab=clubs'` deviennent `'/decouvrir#clubs'`.
- [ ] **Step 4 : Verts + non-régression** — les 2 suites PASS + `node node_modules/jest/bin/jest.js --runTestsByPath __tests__/MyReservationsCalendar.test.tsx __tests__/MyReservationsScoping.test.tsx __tests__/MyReservationsChat.test.tsx __tests__/AnonymousView.test.tsx` → PASS ; `tsc --noEmit` → 0 erreur. Grep de contrôle : `grep -rn "decouvrir?tab=" frontend/ --include=*.tsx --include=*.ts` → 0 occurrence hors specs/plans.
- [ ] **Step 5 : Commit**

```bash
git add frontend/app/clubs/page.tsx frontend/app/tournois/page.tsx frontend/components/calendar/UpcomingTournaments.tsx frontend/app/me/reservations/page.tsx frontend/__tests__/DiscoverRedirects.test.tsx frontend/__tests__/UpcomingTournaments.test.tsx
git commit -m "feat(decouvrir): deep-links en #hash (/clubs -> #clubs, /tournois -> #tournois)"
```

### Task 9 : Vérification finale

- [ ] **Step 1 : Suites frontend ciblées** (depuis `frontend/`) :

```bash
node node_modules/jest/bin/jest.js --runTestsByPath __tests__/discover.test.ts __tests__/NationalMatchCard.test.tsx __tests__/NationalOpenMatches.test.tsx __tests__/DiscoverMatches.test.tsx __tests__/DiscoverAnchors.test.tsx __tests__/DiscoverPage.test.tsx __tests__/DiscoverRedirects.test.tsx __tests__/UpcomingTournaments.test.tsx __tests__/TournamentFinder.test.tsx __tests__/ClubDirectory.test.tsx __tests__/AnonymousView.test.tsx __tests__/PlatformLanding.test.tsx __tests__/ClubNav.test.tsx __tests__/ProfileMenu.test.tsx __tests__/Logotype.test.tsx __tests__/authGate.test.ts __tests__/postAuth.test.ts __tests__/MyReservationsCalendar.test.tsx __tests__/MyReservationsScoping.test.tsx __tests__/MyReservationsChat.test.tsx
```

Attendu : tout PASS.
- [ ] **Step 2 : Backend ciblé + types des deux côtés** — depuis `backend/` : `node node_modules/jest/bin/jest.js --runTestsByPath src/services/__tests__/openMatch.service.test.ts src/services/__tests__/club.service.test.ts` puis `node node_modules/typescript/bin/tsc --noEmit` ; depuis `frontend/` : `node node_modules/typescript/bin/tsc --noEmit`.
- [ ] **Step 3 : Vérification visuelle CDP** (skill `/verify` du repo ; relancer `start.ps1` d'abord — un `globals.css`/page servie périmée par Turbopack est un piège connu). Clair ET sombre, 1280 et 390 :
  - `/decouvrir` : 3 sections empilées visibles, ancres collantes qui suivent le scroll (section active), compteurs affichés.
  - Champ localisation : taper `31` puis une ville → les 3 sections se filtrent.
  - `/clubs` et `/tournois` (plateforme) → redirection vers `/decouvrir#clubs` / `#tournois` + scroll vers la bonne section.
  - Mobile 390 : aucun débordement horizontal (`document.documentElement.scrollWidth <= innerWidth`), ancres lisibles.
- [ ] **Step 4 : Clôture** — `git status` : seuls les fichiers du WIP parallèle restent modifiés. Self-review vs la spec « Révision v2 » : structure (Task 7), ancres (Task 7), deep-links hash (Task 8), parseLocationQuery + 3 sections (Tasks 3-7), backend dept (Tasks 1-2).

---

## Auto-revue du plan (faite à l'écriture)

- **Couverture spec v2** : structure page unique + ancres + scroll-spy (T7), deep-links hash (T8), parseLocationQuery avec CP/DOM/Corse/code/ville/nom-de-département (T3), application aux 3 sections (T4/T5/T6 + T7), backend dept parties (T1) et annuaire (T2), hash préservé par writeUrl (T5).
- **Types cohérents** : `LocationQuery { city: string | null; deptCodes: string[] }` défini T3, consommé T4 (`location`), T5/T6 (`city`/`deptCodes` séparés — les composants gardent des props plates), T7 (parse unique).
- **Écarts assumés** listés en tête (deptCodes pluriel, compteurs=affichés, prop items du Finder, fix hash writeUrl).
- **Conséquence v1 → v2 documentée** : plus de montage paresseux (3 fetches à l'arrivée) ; `PillTabs` retiré de la page ; `?tab=` mort (grep de contrôle en T8).
