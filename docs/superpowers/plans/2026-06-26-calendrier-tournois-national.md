# Calendrier national des tournois — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agréger les tournois `PUBLISHED` des clubs **volontaires** dans un calendrier national présenté comme un chercheur à facettes multi-sélection (Autour de moi · Quand · Département · Catégorie · Genre), accessible publiquement sur l'hôte plateforme `/tournois`.

**Architecture:** Backend additif — 3 champs sur `Club` (`department`, `departmentCode`, `listTournamentsNationally`), extension du géocodeur BAN au département, un agrégat public `listNationalTournaments()` + route `GET /api/tournaments/national`. Frontend — l'endpoint renvoie **toute** la liste nationale à venir ; **facettes, filtrage et tri se font côté client** (mêmes principes que `lib/events.ts`) dans `lib/tournamentCalendar.ts` (pur, testé), composants `TournamentFinder`/`FacetPanel`/`UpcomingTournaments`, page `app/tournois/page.tsx` (branche hôte plateforme).

**Tech Stack:** Backend Express 5 + Prisma 7 (driver adapter PrismaPg) + Jest (prismaMock). Frontend Next.js 16 + React 19 + Tailwind v4 + Jest/RTL.

**Spec:** `docs/superpowers/specs/2026-06-26-calendrier-tournois-national-design.md`

---

## File Structure

**Backend**
- `backend/prisma/schema.prisma` — 3 champs additifs sur `Club`.
- `backend/prisma/migrations/20260626130000_add_national_tournament_calendar/migration.sql` — **nouveau**.
- `backend/src/services/geo.service.ts` — `GeoResult` + parsing `department`/`departmentCode`.
- `backend/src/services/club.service.ts` — persistance create/update + select admin + param update.
- `backend/src/services/platform.service.ts` — persistance à la création super-admin.
- `backend/scripts/geocode-clubs.ts` — backfill élargi (re-géocode pour le département).
- `backend/src/services/tournament.service.ts` — `listNationalTournaments()` + projection club.
- `backend/src/routes/tournaments.ts` — route `GET /national` (**avant** `/:id`).
- `backend/prisma/seed.ts`, `backend/prisma/seed-demo.ts` — clubs en opt-in (dev).
- Tests : `geo.service.test.ts`, `club.service.test.ts`, `platform.service.test.ts`, `tournament.service.test.ts`.

**Frontend**
- `frontend/lib/tournamentCalendar.ts` — **nouveau** (helpers purs, testés).
- `frontend/lib/api.ts` — type `NationalTournament` + `api.listNationalTournaments` + champ admin.
- `frontend/components/agenda/AgendaCard.tsx` — prop optionnelle `subtitle`.
- `frontend/components/calendar/FacetPanel.tsx` — **nouveau** (panneau présentation pure).
- `frontend/components/calendar/TournamentFinder.tsx` — **nouveau** (orchestrateur).
- `frontend/components/calendar/UpcomingTournaments.tsx` — **nouveau** (section accueil).
- `frontend/app/tournois/page.tsx` — branche hôte plateforme (rend le Finder).
- `frontend/lib/authGate.ts` — `/tournois` public sur l'hôte plateforme.
- `frontend/components/platform/AnonymousView.tsx` — section « Prochains tournois ».
- `frontend/app/admin/settings/page.tsx` — case opt-in.
- Tests : `tournamentCalendar.test.ts`, `FacetPanel.test.tsx`, `TournamentFinder.test.tsx`, `AgendaCard.test.tsx` (maj), `authGate.test.ts` (maj), `AnonymousView.test.tsx` (maj).

---

## Task 1: Migration + schema (champs Club)

**Files:**
- Modify: `backend/prisma/schema.prisma` (modèle `Club`, après `postalCode`, ~ligne 230)
- Create: `backend/prisma/migrations/20260626130000_add_national_tournament_calendar/migration.sql`

> **⚠️ Drift de la base de dev** (cf. mémoire `prisma-migrate-deploy-not-dev`) : ne **jamais** lancer `prisma migrate dev` (il veut un reset destructif). On hand-authore le SQL additif + `prisma migrate deploy`.

- [ ] **Step 1: Ajouter les 3 champs au modèle `Club`**

Dans `backend/prisma/schema.prisma`, repérer dans le modèle `Club` la ligne :

```prisma
  postalCode       String?    @map("postal_code")
```

L'remplacer par (ajout des 3 champs juste après) :

```prisma
  postalCode       String?    @map("postal_code")
  // Calendrier national des tournois (opt-in club + département pour la facette)
  department                String?  @map("department")
  departmentCode            String?  @map("department_code")
  listTournamentsNationally Boolean  @default(false) @map("list_tournaments_nationally")
```

- [ ] **Step 2: Écrire la migration SQL**

Créer `backend/prisma/migrations/20260626130000_add_national_tournament_calendar/migration.sql` :

```sql
-- AlterTable
ALTER TABLE "clubs" ADD COLUMN     "department" TEXT,
ADD COLUMN     "department_code" TEXT,
ADD COLUMN     "list_tournaments_nationally" BOOLEAN NOT NULL DEFAULT false;
```

- [ ] **Step 3: Appliquer + régénérer le client**

Run (depuis `backend/`) :
```bash
cd backend && npx prisma migrate deploy && npx prisma generate
```
Expected: « 1 migration applied » (ou « No pending migrations » si déjà appliquée), puis « Generated Prisma Client ».

> **Fallback si `migrate deploy` échoue sur la dérive** (P3005 / migrations antérieures appliquées par `db push`) : `cd backend && npx prisma db push && npx prisma generate` (additif → non destructif), la migration SQL restant en place pour la prod.

- [ ] **Step 4: Vérifier que le client typpe les nouveaux champs**

Run (depuis `backend/`) :
```bash
cd backend && npx tsc --noEmit
```
Expected: PASS (aucune erreur). Les champs `department`, `departmentCode`, `listTournamentsNationally` sont désormais sur le type `Club`.

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260626130000_add_national_tournament_calendar
git commit -m "feat(db): champs Club department/departmentCode/listTournamentsNationally (calendrier national)"
```

---

## Task 2: `geo.service` — département + code

**Files:**
- Modify: `backend/src/services/geo.service.ts` (`GeoResult`, `geocodeAddress`)
- Test: `backend/src/services/__tests__/geo.service.test.ts`

- [ ] **Step 1: Mettre à jour le test existant + ajouter le cas « contexte court »**

Dans `backend/src/services/__tests__/geo.service.test.ts`, remplacer l'assertion du 1er test (ligne ~17) :

```typescript
    expect(r).toEqual({ latitude: 48.8566, longitude: 2.3522, region: 'Île-de-France', postalCode: '75011', city: 'Paris' });
```

par (ajout `department`/`departmentCode`) :

```typescript
    expect(r).toEqual({ latitude: 48.8566, longitude: 2.3522, region: 'Île-de-France', department: 'Paris', departmentCode: '75', postalCode: '75011', city: 'Paris' });
```

Puis ajouter, juste après ce test (après la ligne ~18) :

```typescript
  it('contexte BAN < 3 segments → department/departmentCode null, region = dernier segment', async () => {
    const body = {
      features: [{
        geometry: { coordinates: [2.3522, 48.8566] },
        properties: { context: 'Île-de-France', postcode: '75011', city: 'Paris' },
      }],
    };
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => body }) as any;
    const r = await geocodeAddress({ address: 'x', city: 'Paris' });
    expect(r).toMatchObject({ region: 'Île-de-France', department: null, departmentCode: null });
  });
```

- [ ] **Step 2: Lancer le test → échec attendu**

Run: `cd backend && npx jest src/services/__tests__/geo.service.test.ts`
Expected: FAIL (le résultat n'a pas encore `department`/`departmentCode`).

- [ ] **Step 3: Étendre `GeoResult` et le parsing**

Dans `backend/src/services/geo.service.ts`, remplacer l'interface :

```typescript
export interface GeoResult {
  latitude: number;
  longitude: number;
  region: string | null;
  postalCode: string | null;
  city: string | null;
}
```

par :

```typescript
export interface GeoResult {
  latitude: number;
  longitude: number;
  region: string | null;
  department: string | null;
  departmentCode: string | null;
  postalCode: string | null;
  city: string | null;
}
```

Puis remplacer le bloc de parsing + return :

```typescript
    // context = "75, Paris, Île-de-France" → région = dernier segment.
    const region = (f.properties.context ?? '').split(',').map((s) => s.trim()).filter(Boolean).pop() ?? null;
    return { latitude: lat, longitude: lon, region, postalCode: f.properties.postcode ?? null, city: f.properties.city ?? null };
```

par :

```typescript
    // context = "75, Paris, Île-de-France" = [code, département, région].
    // région = dernier segment (inchangé) ; département/code = 1er/2e segment si ≥ 3 segments.
    const parts = (f.properties.context ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const region = parts.length ? parts[parts.length - 1] : null;
    const departmentCode = parts.length >= 3 ? parts[0] : null;
    const department = parts.length >= 3 ? parts[1] : null;
    return { latitude: lat, longitude: lon, region, department, departmentCode, postalCode: f.properties.postcode ?? null, city: f.properties.city ?? null };
```

- [ ] **Step 4: Lancer le test → succès attendu**

Run: `cd backend && npx jest src/services/__tests__/geo.service.test.ts`
Expected: PASS (tous les cas, y compris « contexte court »).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/geo.service.ts backend/src/services/__tests__/geo.service.test.ts
git commit -m "feat(geo): geocodeAddress renvoie department + departmentCode (segments BAN)"
```

---

## Task 3: Persistance `department`/`departmentCode` (club.service)

**Files:**
- Modify: `backend/src/services/club.service.ts` (`createClub` ~ligne 109, `updateClub` ~lignes 270-272)
- Test: `backend/src/services/__tests__/club.service.test.ts`

- [ ] **Step 1: Écrire les tests (create + update persistent le département)**

Dans `backend/src/services/__tests__/club.service.test.ts`, ajouter un bloc `describe`. Adapter le mock `geocodeAddress` au pattern déjà utilisé dans ce fichier (chercher `jest.mock('../geo.service'` en tête ; s'il existe, configurer le retour ; sinon ajouter le mock). Test :

```typescript
describe('club.service — persistance du département', () => {
  beforeEach(() => jest.clearAllMocks());

  it('createClub persiste department/departmentCode quand le géocodage réussit', async () => {
    (geocodeAddress as jest.Mock).mockResolvedValue({
      latitude: 48.85, longitude: 2.35, region: 'Île-de-France', department: 'Paris', departmentCode: '75', postalCode: '75011', city: 'Paris',
    });
    prismaMock.clubSlugAlias.findUnique.mockResolvedValue(null as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.club.create.mockResolvedValue({ id: 'c1' } as any);
    prismaMock.clubMember.create.mockResolvedValue({} as any);

    await clubService.createClub({ name: 'Test', address: '1 rue', city: 'Paris', ownerId: 'u1' } as any);

    const data = prismaMock.club.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ department: 'Paris', departmentCode: '75' });
  });
});
```

> Vérifier en tête de fichier que `geocodeAddress`, `prismaMock` et `clubService` sont importés comme dans les tests existants ; sinon, copier les imports du haut du fichier (`import { prismaMock } from '../../__mocks__/prisma';` etc.) et `import { geocodeAddress } from '../geo.service';` + `jest.mock('../geo.service');`.

- [ ] **Step 2: Lancer → échec attendu**

Run: `cd backend && npx jest src/services/__tests__/club.service.test.ts -t "département"`
Expected: FAIL (`data` ne contient pas encore `department`).

- [ ] **Step 3: Ajouter les champs à `createClub`**

Dans `backend/src/services/club.service.ts`, dans `createClub`, remplacer :

```typescript
          ...(geo ? { latitude: geo.latitude, longitude: geo.longitude, region: geo.region, postalCode: geo.postalCode } : {}),
```

par :

```typescript
          ...(geo ? { latitude: geo.latitude, longitude: geo.longitude, region: geo.region, department: geo.department, departmentCode: geo.departmentCode, postalCode: geo.postalCode } : {}),
```

- [ ] **Step 4: Ajouter les champs à `updateClub`**

Toujours dans `club.service.ts`, dans `updateClub`, remplacer le bloc geoData (lignes ~270-272) :

```typescript
        geoData = geo
          ? { latitude: geo.latitude, longitude: geo.longitude, region: geo.region, postalCode: geo.postalCode }
          : { latitude: null, longitude: null, region: null, postalCode: null };
```

par :

```typescript
        geoData = geo
          ? { latitude: geo.latitude, longitude: geo.longitude, region: geo.region, department: geo.department, departmentCode: geo.departmentCode, postalCode: geo.postalCode }
          : { latitude: null, longitude: null, region: null, department: null, departmentCode: null, postalCode: null };
```

- [ ] **Step 5: Lancer → succès attendu**

Run: `cd backend && npx jest src/services/__tests__/club.service.test.ts`
Expected: PASS (tous les tests du fichier).

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/club.service.ts backend/src/services/__tests__/club.service.test.ts
git commit -m "feat(club): persiste department/departmentCode au géocodage (create + update)"
```

---

## Task 4: Persistance à la création super-admin (platform.service)

**Files:**
- Modify: `backend/src/services/platform.service.ts` (`createClubWithOwner`, bloc geo ~ligne 150)
- Test: `backend/src/services/__tests__/platform.service.test.ts`

- [ ] **Step 1: Écrire le test**

Dans `backend/src/services/__tests__/platform.service.test.ts`, ajouter (en respectant les imports/mocks existants du fichier, comme en Task 3) :

```typescript
describe('platform.service — création de club géocodée', () => {
  beforeEach(() => jest.clearAllMocks());

  it('createClubWithOwner persiste department/departmentCode', async () => {
    (geocodeAddress as jest.Mock).mockResolvedValue({
      latitude: 45.76, longitude: 4.83, region: 'Auvergne-Rhône-Alpes', department: 'Rhône', departmentCode: '69', postalCode: '69001', city: 'Lyon',
    });
    prismaMock.clubSlugAlias.findUnique.mockResolvedValue(null as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.club.create.mockResolvedValue({ id: 'c1' } as any);
    prismaMock.user.findUnique.mockResolvedValue({ id: 'owner' } as any);
    prismaMock.clubMember.create.mockResolvedValue({} as any);

    await platformService.createClubWithOwner({ club: { name: 'Lyon', address: '1', city: 'Lyon' }, owner: { id: 'owner' } } as any);

    const data = prismaMock.club.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ department: 'Rhône', departmentCode: '69' });
  });
});
```

> Aligner la forme de l'argument `createClubWithOwner({...})` sur la signature réelle (regarder un test existant de ce fichier ou la fonction). L'essentiel testé = `data` contient `department`/`departmentCode`.

- [ ] **Step 2: Lancer → échec attendu**

Run: `cd backend && npx jest src/services/__tests__/platform.service.test.ts -t "department"`
Expected: FAIL.

- [ ] **Step 3: Ajouter les champs**

Dans `backend/src/services/platform.service.ts`, dans `createClubWithOwner`, remplacer :

```typescript
        ...(geo ? { latitude: geo.latitude, longitude: geo.longitude, region: geo.region, postalCode: geo.postalCode } : {}),
```

par :

```typescript
        ...(geo ? { latitude: geo.latitude, longitude: geo.longitude, region: geo.region, department: geo.department, departmentCode: geo.departmentCode, postalCode: geo.postalCode } : {}),
```

- [ ] **Step 4: Lancer → succès attendu**

Run: `cd backend && npx jest src/services/__tests__/platform.service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/platform.service.ts backend/src/services/__tests__/platform.service.test.ts
git commit -m "feat(platform): persiste department/departmentCode à la création de club"
```

---

## Task 5: Backfill `geocode-clubs.ts` (re-géocode pour le département)

**Files:**
- Modify: `backend/scripts/geocode-clubs.ts`

- [ ] **Step 1: Élargir la cible + écrire le département**

Dans `backend/scripts/geocode-clubs.ts`, remplacer :

```typescript
  const clubs = await prisma.club.findMany({
    where: { latitude: null },
    select: { id: true, name: true, address: true, city: true },
  });
```

par (cible aussi les clubs déjà géocodés mais sans département — idempotent) :

```typescript
  const clubs = await prisma.club.findMany({
    where: { OR: [{ latitude: null }, { department: null }] },
    select: { id: true, name: true, address: true, city: true },
  });
```

Puis remplacer le bloc `update` :

```typescript
    await prisma.club.update({
      where: { id: c.id },
      data: { latitude: geo.latitude, longitude: geo.longitude, region: geo.region, postalCode: geo.postalCode },
    });
    console.log(`  ✓ ${c.name} — ${geo.region ?? '?'} (${geo.latitude.toFixed(3)}, ${geo.longitude.toFixed(3)})`);
```

par :

```typescript
    await prisma.club.update({
      where: { id: c.id },
      data: { latitude: geo.latitude, longitude: geo.longitude, region: geo.region, department: geo.department, departmentCode: geo.departmentCode, postalCode: geo.postalCode },
    });
    console.log(`  ✓ ${c.name} — ${geo.department ?? '?'} (${geo.departmentCode ?? '?'})`);
```

- [ ] **Step 2: Compiler (pas de test unitaire pour ce script)**

Run: `cd backend && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/geocode-clubs.ts
git commit -m "chore(geo): backfill re-géocode les clubs sans département"
```

---

## Task 6: Agrégat national (tournament.service)

**Files:**
- Modify: `backend/src/services/tournament.service.ts` (nouvelle méthode publique, près de `listPublicByClubSlug` ~ligne 290)
- Test: `backend/src/services/__tests__/tournament.service.test.ts`

- [ ] **Step 1: Écrire le test**

Dans `backend/src/services/__tests__/tournament.service.test.ts`, ajouter à la fin :

```typescript
describe('TournamentService.listNationalTournaments', () => {
  let svc: TournamentService;
  beforeEach(() => { jest.clearAllMocks(); svc = new TournamentService(); });

  it('filtre PUBLISHED + à venir + club ACTIVE & opt-in ; renvoie club + compteurs', async () => {
    prismaMock.tournament.findMany.mockResolvedValue([
      { id: 't1', name: 'GP Paris', category: 'P500', gender: 'MEN', startTime: FUTURE, maxTeams: 16,
        club: { slug: 'paris', name: 'Padel Paris', city: 'Paris', department: 'Paris', departmentCode: '75', timezone: 'Europe/Paris', accentColor: '#5e93da', logoUrl: null, latitude: 48.85, longitude: 2.35 } },
    ] as any);
    prismaMock.tournamentRegistration.groupBy.mockResolvedValue([
      { tournamentId: 't1', status: 'CONFIRMED', _count: { _all: 3 } },
    ] as any);

    const res = await svc.listNationalTournaments();

    const where = prismaMock.tournament.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('PUBLISHED');
    expect(where.club).toEqual({ status: 'ACTIVE', listTournamentsNationally: true });
    expect(where.startTime.gte).toBeInstanceOf(Date);
    expect(where.startTime.lte).toBeInstanceOf(Date);
    expect(res[0]).toMatchObject({ id: 't1', confirmedCount: 3, waitlistCount: 0, club: { departmentCode: '75', timezone: 'Europe/Paris' } });
  });

  it('liste vide si aucun tournoi', async () => {
    prismaMock.tournament.findMany.mockResolvedValue([] as any);
    const res = await svc.listNationalTournaments();
    expect(res).toEqual([]);
  });
});
```

- [ ] **Step 2: Lancer → échec attendu**

Run: `cd backend && npx jest src/services/__tests__/tournament.service.test.ts -t "listNationalTournaments"`
Expected: FAIL (`svc.listNationalTournaments` n'existe pas).

- [ ] **Step 3: Implémenter `listNationalTournaments`**

Dans `backend/src/services/tournament.service.ts`, ajouter juste après `listPublicByClubSlug` (après sa `}` de fermeture, ~ligne 299) :

```typescript
  /**
   * Agrégat public : tournois PUBLISHED à venir des clubs ACTIVE ayant opté pour le
   * calendrier national. Tout le filtrage/tri fin se fait côté client (volume modeste).
   * La projection `club` inclut le département (facette) + la timezone (libellé de date).
   */
  async listNationalTournaments(opts?: { monthsAhead?: number }) {
    const now = new Date();
    const horizon = new Date(now);
    horizon.setMonth(horizon.getMonth() + (opts?.monthsAhead ?? 6));
    const tournaments = await prisma.tournament.findMany({
      where: {
        status: 'PUBLISHED',
        startTime: { gte: now, lte: horizon },
        club: { status: 'ACTIVE', listTournamentsNationally: true },
      },
      include: {
        club: { select: { slug: true, name: true, city: true, department: true, departmentCode: true, timezone: true, accentColor: true, logoUrl: true, latitude: true, longitude: true } },
      },
      orderBy: { startTime: 'asc' },
    });
    return this.withCounts(tournaments);
  }
```

- [ ] **Step 4: Lancer → succès attendu**

Run: `cd backend && npx jest src/services/__tests__/tournament.service.test.ts -t "listNationalTournaments"`
Expected: PASS (les 2 cas).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/tournament.service.ts backend/src/services/__tests__/tournament.service.test.ts
git commit -m "feat(tournament): listNationalTournaments (agrégat public des clubs opt-in)"
```

---

## Task 7: Route `GET /api/tournaments/national`

**Files:**
- Modify: `backend/src/routes/tournaments.ts` (ajouter **avant** `router.get('/:id', …)`)

> **⚠️ Ordre des routes** : `/national` DOIT être déclarée **avant** `router.get('/:id', …)`, sinon Express matche `/:id` avec `id='national'` → 404. La placer en toute première route.

- [ ] **Step 1: Ajouter la route**

Dans `backend/src/routes/tournaments.ts`, repérer la première route :

```typescript
// Détail public d'un tournoi (pas d'auth ; le DRAFT est masqué par le service).
router.get('/:id', async (req, res, next) => {
  try { res.json(await service.getById(asString(req.params.id))); }
  catch (err) { handleError(err, res, next); }
});
```

L'remplacer par (insertion de `/national` AVANT) :

```typescript
// Calendrier national : tournois à venir des clubs opt-in (public, pas d'auth).
// DOIT rester avant `/:id` pour ne pas être capturée comme un id.
router.get('/national', async (_req, res, next) => {
  try { res.json(await service.listNationalTournaments()); }
  catch (err) { handleError(err, res, next); }
});

// Détail public d'un tournoi (pas d'auth ; le DRAFT est masqué par le service).
router.get('/:id', async (req, res, next) => {
  try { res.json(await service.getById(asString(req.params.id))); }
  catch (err) { handleError(err, res, next); }
});
```

- [ ] **Step 2: Compiler**

Run: `cd backend && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Vérification manuelle de la route (backend démarré)**

Avec le backend lancé (`npm run dev` dans `backend/`), Run :
```bash
curl -s http://localhost:3001/api/tournaments/national
```
Expected: un tableau JSON (vide `[]` tant que les seeds ne sont pas en opt-in — corrigé en Task 8). Surtout : **pas** d'erreur 404 « TOURNAMENT_NOT_FOUND » (ce qui prouverait que `/national` est mal ordonnée).

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/tournaments.ts
git commit -m "feat(api): GET /api/tournaments/national (calendrier public)"
```

---

## Task 8: Seeds en opt-in (dev)

**Files:**
- Modify: `backend/prisma/seed.ts` (club-demo, ~lignes 45-56)
- Modify: `backend/prisma/seed-demo.ts` (boucle clubs, ~lignes 111-117)

- [ ] **Step 1: `seed.ts` — club-demo opt-in**

Dans `backend/prisma/seed.ts`, remplacer le bloc `upsert` du club de démo :

```typescript
  const club = await prisma.club.upsert({
    where: { id: 'club-demo' },
    // Branding Palova autoritaire pour la démo (bleu + mode clair/paper).
    update: { accentColor: '#5e93da', defaultThemeMode: 'daylight' },
    create: {
      id: 'club-demo',
      slug: 'padel-arena-paris',
      name: 'Padel Arena Paris',
      address: '12 rue du Padel, 75011 Paris',
      city: 'Paris',
      country: 'FR',
      timezone: 'Europe/Paris',
      accentColor: '#5e93da',
      defaultThemeMode: 'daylight',
    },
  });
```

par (ajout `listTournamentsNationally: true` dans `update` ET `create`) :

```typescript
  const club = await prisma.club.upsert({
    where: { id: 'club-demo' },
    // Branding Palova autoritaire pour la démo (bleu + mode clair/paper).
    update: { accentColor: '#5e93da', defaultThemeMode: 'daylight', listTournamentsNationally: true },
    create: {
      id: 'club-demo',
      slug: 'padel-arena-paris',
      name: 'Padel Arena Paris',
      address: '12 rue du Padel, 75011 Paris',
      city: 'Paris',
      country: 'FR',
      timezone: 'Europe/Paris',
      accentColor: '#5e93da',
      defaultThemeMode: 'daylight',
      listTournamentsNationally: true,
    },
  });
```

- [ ] **Step 2: `seed-demo.ts` — tous les clubs opt-in**

Dans `backend/prisma/seed-demo.ts`, remplacer le bloc `upsert` de la boucle clubs :

```typescript
    const club = await prisma.club.upsert({
      where: { slug: cdef.slug },
      update: { accentColor: cdef.accent, defaultThemeMode: cdef.theme },
      create: {
        slug: cdef.slug, name: cdef.name, city: cdef.city, country: 'FR',
        address: `1 avenue du Padel, ${cdef.city}`, timezone: 'Europe/Paris',
        accentColor: cdef.accent, defaultThemeMode: cdef.theme,
        description: `Club de padel à ${cdef.city} — réservations et tournois.`,
      },
    });
```

par :

```typescript
    const club = await prisma.club.upsert({
      where: { slug: cdef.slug },
      update: { accentColor: cdef.accent, defaultThemeMode: cdef.theme, listTournamentsNationally: true },
      create: {
        slug: cdef.slug, name: cdef.name, city: cdef.city, country: 'FR',
        address: `1 avenue du Padel, ${cdef.city}`, timezone: 'Europe/Paris',
        accentColor: cdef.accent, defaultThemeMode: cdef.theme,
        description: `Club de padel à ${cdef.city} — réservations et tournois.`,
        listTournamentsNationally: true,
      },
    });
```

- [ ] **Step 3: Re-seeder + backfill département + vérifier l'API**

Run (depuis `backend/`) :
```bash
cd backend && npm run db:seed && npx ts-node scripts/geocode-clubs.ts && curl -s http://localhost:3001/api/tournaments/national
```
Expected: le `curl` renvoie un tableau **non vide** (si des tournois PUBLISHED à venir existent dans les seeds) ; chaque entrée a `club.departmentCode` non null.

> Si `db:seed` ne lance que `seed.ts`, lancer aussi le seed de démo selon la convention du projet (script `db:seed:demo` ou `npx ts-node prisma/seed-demo.ts`).

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/seed.ts backend/prisma/seed-demo.ts
git commit -m "chore(seed): clubs en opt-in calendrier national (dev)"
```

---

## Task 9: Plomberie admin backend (opt-in)

**Files:**
- Modify: `backend/src/services/club.service.ts` (`getClubForAdmin` select ~ligne 217, params `updateClub` ~ligne 239, data `updateClub` ~ligne 296)

Calque exact du booléen `listedInDirectory`, déjà câblé de bout en bout.

- [ ] **Step 1: `getClubForAdmin` — exposer le champ**

Dans `backend/src/services/club.service.ts`, dans le `select` de `getClubForAdmin`, remplacer :

```typescript
        listedInDirectory: true, publicBookingDays: true, memberBookingDays: true, offPeakHours: true,
```

par :

```typescript
        listedInDirectory: true, listTournamentsNationally: true, publicBookingDays: true, memberBookingDays: true, offPeakHours: true,
```

- [ ] **Step 2: `updateClub` — accepter le param**

Dans la signature de `updateClub`, remplacer :

```typescript
    listedInDirectory?: boolean; publicBookingDays?: number; memberBookingDays?: number;
```

par :

```typescript
    listedInDirectory?: boolean; listTournamentsNationally?: boolean; publicBookingDays?: number; memberBookingDays?: number;
```

- [ ] **Step 3: `updateClub` — persister le champ**

Dans le `data` de `updateClub`, remplacer :

```typescript
        ...(typeof params.listedInDirectory === 'boolean' ? { listedInDirectory: params.listedInDirectory } : {}),
```

par :

```typescript
        ...(typeof params.listedInDirectory === 'boolean' ? { listedInDirectory: params.listedInDirectory } : {}),
        ...(typeof params.listTournamentsNationally === 'boolean' ? { listTournamentsNationally: params.listTournamentsNationally } : {}),
```

- [ ] **Step 4: Compiler**

Run: `cd backend && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/club.service.ts
git commit -m "feat(admin): updateClub/getClubForAdmin gèrent listTournamentsNationally"
```

---

## Task 10: Frontend — types + client API

**Files:**
- Modify: `frontend/lib/api.ts` (type `NationalTournament`, méthode `listNationalTournaments`, champs admin)

- [ ] **Step 1: Ajouter le type `NationalTournament`**

Dans `frontend/lib/api.ts`, juste après l'interface `Tournament` (qui se termine ~ligne 1608), ajouter :

```typescript
/** Projection club renvoyée par le calendrier national (publique, sans données privées). */
export interface NationalTournamentClub {
  slug: string;
  name: string;
  city: string | null;
  department: string | null;
  departmentCode: string | null;
  timezone: string;
  accentColor: string;
  logoUrl: string | null;
  latitude: number | null;
  longitude: number | null;
}

/** Un tournoi du calendrier national = tournoi public + son club. */
export interface NationalTournament extends Tournament {
  club: NationalTournamentClub;
}
```

- [ ] **Step 2: Ajouter la méthode publique**

Dans l'objet `api`, dans la zone `// --- Public ---` (près de `getClub`, ~ligne 51), ajouter :

```typescript
  listNationalTournaments: () => request<NationalTournament[]>('/api/tournaments/national'),
```

- [ ] **Step 3: Champ admin `listTournamentsNationally`**

Dans `ClubAdminDetail`, remplacer :

```typescript
  listedInDirectory: boolean;
```

par :

```typescript
  listedInDirectory: boolean;
  listTournamentsNationally: boolean;
```

Dans `UpdateClubBody`, remplacer :

```typescript
  listedInDirectory: boolean;
```

par :

```typescript
  listedInDirectory: boolean;
  listTournamentsNationally: boolean;
```

- [ ] **Step 4: Compiler**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(api): type NationalTournament + listNationalTournaments + champ admin opt-in"
```

---

## Task 11: `lib/tournamentCalendar.ts` (helpers purs, testés)

**Files:**
- Create: `frontend/lib/tournamentCalendar.ts`
- Test: `frontend/__tests__/tournamentCalendar.test.ts`

- [ ] **Step 1: Écrire les tests**

Créer `frontend/__tests__/tournamentCalendar.test.ts` :

```typescript
import {
  emptyCalendarState, resolveDateWindow, applyFilters, calendarFacets, distanceKm,
  CalendarFilterState,
} from '@/lib/tournamentCalendar';
import { NationalTournament } from '@/lib/api';

const NOW = new Date('2026-07-01T10:00:00Z'); // mercredi

function tourn(over: Partial<NationalTournament> & { id: string; startTime: string; deptCode: string | null; deptName?: string; category?: string; gender?: any; lat?: number | null; lng?: number | null }): NationalTournament {
  return {
    id: over.id, clubId: 'c', clubSportId: 'cs', name: `T-${over.id}`,
    category: over.category ?? 'P500', gender: over.gender ?? 'MEN', openToWomen: true,
    description: null, contactInfo: null, startTime: over.startTime, endTime: null,
    registrationDeadline: over.startTime, maxTeams: 16, entryFee: null, status: 'PUBLISHED',
    confirmedCount: 0, waitlistCount: 0,
    club: {
      slug: `club-${over.id}`, name: `Club ${over.id}`, city: 'Ville',
      department: over.deptName ?? (over.deptCode ? `Dép ${over.deptCode}` : null), departmentCode: over.deptCode,
      timezone: 'Europe/Paris', accentColor: '#000', logoUrl: null,
      latitude: over.lat ?? null, longitude: over.lng ?? null,
    },
  } as NationalTournament;
}

const items: NationalTournament[] = [
  tourn({ id: 'a', startTime: '2026-07-02T12:00:00Z', deptCode: '75', category: 'P500', gender: 'MEN', lat: 48.85, lng: 2.35 }),
  tourn({ id: 'b', startTime: '2026-07-20T12:00:00Z', deptCode: '69', category: 'P1000', gender: 'WOMEN', lat: 45.76, lng: 4.83 }),
  tourn({ id: 'c', startTime: '2026-09-15T12:00:00Z', deptCode: '75', category: 'P500', gender: 'MIXED', lat: null, lng: null }),
];

describe('resolveDateWindow', () => {
  it('preset days30 = [now, now+30j]', () => {
    const w = resolveDateWindow({ ...emptyCalendarState(), datePreset: 'days30' }, NOW)!;
    expect(w.from.getTime()).toBe(NOW.getTime());
    expect(w.to!.getTime()).toBe(NOW.getTime() + 30 * 86_400_000);
  });
  it('aucun preset ni plage → null', () => {
    expect(resolveDateWindow(emptyCalendarState(), NOW)).toBeNull();
  });
  it('plage custom from/to prime sur le preset', () => {
    const w = resolveDateWindow({ ...emptyCalendarState(), datePreset: 'days30', from: '2026-07-10', to: '2026-07-15' }, NOW)!;
    expect(w.from.getFullYear()).toBe(2026);
    expect(w.to).not.toBeNull();
  });
});

describe('applyFilters', () => {
  it('OU intra-département, ET inter-dimensions', () => {
    const st: CalendarFilterState = { ...emptyCalendarState(), deptCodes: new Set(['75']), categories: new Set(['P500']) };
    const res = applyFilters(items, st, NOW);
    expect(res.map((r) => r.tournament.id).sort()).toEqual(['a', 'c']);
  });
  it('preset thisMonth ne garde que juillet', () => {
    const st: CalendarFilterState = { ...emptyCalendarState(), datePreset: 'thisMonth' };
    const res = applyFilters(items, st, NOW);
    expect(res.map((r) => r.tournament.id).sort()).toEqual(['a', 'b']);
  });
  it('sans nearMe → tri par date', () => {
    const res = applyFilters(items, emptyCalendarState(), NOW);
    expect(res.map((r) => r.tournament.id)).toEqual(['a', 'b', 'c']);
  });
  it('nearMe + coords → tri par distance, distanceKm renseignée, nulls en dernier', () => {
    const st: CalendarFilterState = { ...emptyCalendarState(), nearMe: true };
    const res = applyFilters(items, st, NOW, { lat: 45.76, lng: 4.83 }); // proche de Lyon (b)
    expect(res[0].tournament.id).toBe('b');
    expect(res[res.length - 1].tournament.id).toBe('c'); // pas de coords → dernier
    expect(res[0].distanceKm).toBeCloseTo(0, 0);
  });
});

describe('calendarFacets', () => {
  it('valeurs présentes + compteurs ne se contraignant pas eux-mêmes', () => {
    const st: CalendarFilterState = { ...emptyCalendarState(), deptCodes: new Set(['75']) };
    const f = calendarFacets(items, st, NOW);
    // catégories comptées sous le filtre dept=75 → P500 ×2 (a,c)
    const p500 = f.categories.find((c) => c.value === 'P500');
    expect(p500?.count).toBe(2);
    // départements comptés SANS se contraindre → 75 ×2, 69 ×1
    expect(f.departments.find((d) => d.code === '75')?.count).toBe(2);
    expect(f.departments.find((d) => d.code === '69')?.count).toBe(1);
  });
});

describe('distanceKm', () => {
  it('Paris→Lyon ≈ 390 km', () => {
    const d = distanceKm({ lat: 48.8566, lng: 2.3522 }, { lat: 45.764, lng: 4.8357 });
    expect(d).toBeGreaterThan(370);
    expect(d).toBeLessThan(410);
  });
});
```

- [ ] **Step 2: Lancer → échec attendu**

Run: `cd frontend && npx jest __tests__/tournamentCalendar.test.ts`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Implémenter le module**

Créer `frontend/lib/tournamentCalendar.ts` :

```typescript
import { NationalTournament, TournamentGender } from './api';

// ── État de filtre ────────────────────────────────────────────────────────────
export type DatePreset = 'weekend' | 'thisMonth' | 'days30' | 'months3';

export interface CalendarFilterState {
  deptCodes: Set<string>;
  categories: Set<string>;
  genders: Set<TournamentGender>;
  datePreset: DatePreset | null;
  from: string | null; // 'YYYY-MM-DD' (heure locale du visiteur)
  to: string | null;   // 'YYYY-MM-DD'
  nearMe: boolean;
}

export function emptyCalendarState(): CalendarFilterState {
  return { deptCodes: new Set(), categories: new Set(), genders: new Set(), datePreset: null, from: null, to: null, nearMe: false };
}

// P25→P2000 (réutilise l'ordre canonique des catégories)
export const CATEGORY_ORDER = ['P25', 'P50', 'P100', 'P250', 'P500', 'P1000', 'P1500', 'P2000'];
const GENDER_ORDER: TournamentGender[] = ['MEN', 'WOMEN', 'MIXED'];

// ── Fenêtre de date ─────────────────────────────────────────────────────────
function startOfLocalDay(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}
function endOfLocalDay(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}

/** Fenêtre [from, to] (to nullable = pas de borne haute). Plage custom prime sur le preset. */
export function resolveDateWindow(state: CalendarFilterState, now: Date): { from: Date; to: Date | null } | null {
  if (state.from || state.to) {
    return {
      from: state.from ? startOfLocalDay(state.from) : now,
      to: state.to ? endOfLocalDay(state.to) : null,
    };
  }
  if (!state.datePreset) return null;
  const day = 86_400_000;
  switch (state.datePreset) {
    case 'days30':
      return { from: now, to: new Date(now.getTime() + 30 * day) };
    case 'months3': {
      const to = new Date(now); to.setMonth(to.getMonth() + 3);
      return { from: now, to };
    }
    case 'thisMonth': {
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999); // dernier jour du mois
      return { from: now, to };
    }
    case 'weekend': {
      const dow = now.getDay(); // 0=dim … 6=sam
      if (dow === 0) { // dimanche en cours
        return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0), to: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999) };
      }
      const daysToSat = 6 - dow; // sam=0 … lun=5
      const sat = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysToSat, 0, 0, 0, 0);
      const sun = new Date(sat.getFullYear(), sat.getMonth(), sat.getDate() + 1, 23, 59, 59, 999);
      return { from: sat, to: sun };
    }
  }
}

// ── Prédicats de dimension ────────────────────────────────────────────────────
function inWindow(t: NationalTournament, win: { from: Date; to: Date | null } | null): boolean {
  if (!win) return true;
  const start = new Date(t.startTime).getTime();
  if (start < win.from.getTime()) return false;
  if (win.to && start > win.to.getTime()) return false;
  return true;
}
const inDepts = (t: NationalTournament, s: CalendarFilterState) => s.deptCodes.size === 0 || (t.club.departmentCode != null && s.deptCodes.has(t.club.departmentCode));
const inCats = (t: NationalTournament, s: CalendarFilterState) => s.categories.size === 0 || s.categories.has(t.category);
const inGenders = (t: NationalTournament, s: CalendarFilterState) => s.genders.size === 0 || s.genders.has(t.gender);

// ── Distance (haversine, miroir de geo.service backend) ───────────────────────
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// ── Application des filtres + tri ─────────────────────────────────────────────
export interface RankedTournament { tournament: NationalTournament; distanceKm: number | null }

export function applyFilters(
  items: NationalTournament[],
  state: CalendarFilterState,
  now: Date,
  coords?: { lat: number; lng: number },
): RankedTournament[] {
  const win = resolveDateWindow(state, now);
  const kept = items.filter((t) => inWindow(t, win) && inDepts(t, state) && inCats(t, state) && inGenders(t, state));
  const ranked: RankedTournament[] = kept.map((t) => {
    const hasCoords = state.nearMe && coords && t.club.latitude != null && t.club.longitude != null;
    return { tournament: t, distanceKm: hasCoords ? distanceKm(coords!, { lat: t.club.latitude!, lng: t.club.longitude! }) : null };
  });
  if (state.nearMe && coords) {
    // tri par distance (nulls en dernier), tiebreak date
    ranked.sort((a, b) => {
      if (a.distanceKm == null && b.distanceKm == null) return a.tournament.startTime.localeCompare(b.tournament.startTime);
      if (a.distanceKm == null) return 1;
      if (b.distanceKm == null) return -1;
      return a.distanceKm - b.distanceKm || a.tournament.startTime.localeCompare(b.tournament.startTime);
    });
  } else {
    ranked.sort((a, b) => a.tournament.startTime.localeCompare(b.tournament.startTime));
  }
  return ranked;
}

// ── Facettes (valeurs présentes + compteurs ne se contraignant pas eux-mêmes) ──
export interface DeptFacet { code: string; name: string; count: number }
export interface ValueFacet<T = string> { value: T; count: number }

export function calendarFacets(items: NationalTournament[], state: CalendarFilterState, now: Date): {
  departments: DeptFacet[];
  categories: ValueFacet[];
  genders: ValueFacet<TournamentGender>[];
} {
  const win = resolveDateWindow(state, now);

  // Département : compte sous (date + cat + genre), PAS sous lui-même.
  const deptNames = new Map<string, string>();
  const deptCount = new Map<string, number>();
  for (const t of items) {
    if (!(inWindow(t, win) && inCats(t, state) && inGenders(t, state))) continue;
    const code = t.club.departmentCode;
    if (!code) continue;
    if (!deptNames.has(code)) deptNames.set(code, t.club.department ?? code);
    deptCount.set(code, (deptCount.get(code) ?? 0) + 1);
  }
  const departments = [...deptCount.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((code) => ({ code, name: deptNames.get(code)!, count: deptCount.get(code)! }));

  // Catégorie : compte sous (date + dept + genre).
  const catCount = new Map<string, number>();
  for (const t of items) {
    if (!(inWindow(t, win) && inDepts(t, state) && inGenders(t, state))) continue;
    catCount.set(t.category, (catCount.get(t.category) ?? 0) + 1);
  }
  const categories = [...catCount.keys()]
    .sort((a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b))
    .map((value) => ({ value, count: catCount.get(value)! }));

  // Genre : compte sous (date + dept + cat).
  const genCount = new Map<TournamentGender, number>();
  for (const t of items) {
    if (!(inWindow(t, win) && inDepts(t, state) && inCats(t, state))) continue;
    genCount.set(t.gender, (genCount.get(t.gender) ?? 0) + 1);
  }
  const genders = [...genCount.keys()]
    .sort((a, b) => GENDER_ORDER.indexOf(a) - GENDER_ORDER.indexOf(b))
    .map((value) => ({ value, count: genCount.get(value)! }));

  return { departments, categories, genders };
}
```

- [ ] **Step 4: Lancer → succès attendu**

Run: `cd frontend && npx jest __tests__/tournamentCalendar.test.ts`
Expected: PASS (tous les `describe`).

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/tournamentCalendar.ts frontend/__tests__/tournamentCalendar.test.ts
git commit -m "feat(calendar): lib/tournamentCalendar (facettes, filtres, présets date, distance)"
```

---

## Task 12: `AgendaCard` — prop optionnelle `subtitle`

**Files:**
- Modify: `frontend/components/agenda/AgendaCard.tsx`
- Test: `frontend/__tests__/AgendaCard.test.tsx`

Additif et rétro-compatible : `subtitle` rendu sous le titre (club · ville · distance pour le calendrier national).

- [ ] **Step 1: Ajouter un test**

Dans `frontend/__tests__/AgendaCard.test.tsx`, ajouter dans le `describe('AgendaCard', …)` :

```typescript
  it('affiche le subtitle quand fourni', () => {
    wrap({ now: NOW, subtitle: 'Padel Paris · Paris · 8 km' });
    expect(screen.getByText('Padel Paris · Paris · 8 km')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Lancer → échec attendu**

Run: `cd frontend && npx jest __tests__/AgendaCard.test.tsx`
Expected: FAIL (subtitle non rendu).

- [ ] **Step 3: Implémenter la prop**

Dans `frontend/components/agenda/AgendaCard.tsx`, dans `AgendaCardProps`, ajouter après `extra` :

```typescript
  extra?: string | null;       // « 40 € » / « Membres » — chip discret
  subtitle?: string | null;    // « Club · Ville · 8 km » — ligne secondaire (calendrier national)
```

Mettre à jour la déstructuration :

```typescript
export function AgendaCard({ icon, accent, tag, title, dateLabel, deadline, now, ratio, places, extra, subtitle, onClick }: AgendaCardProps) {
```

Puis, entre la ligne du titre et celle de la date, insérer le rendu du subtitle. Remplacer :

```typescript
        <span style={{ fontFamily: th.fontUI, fontSize: 16.5, fontWeight: 700, color: th.text }}>{title}</span>
        <span style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute }}>
          {dateLabel}{extra ? ` · ${extra}` : ''}
        </span>
```

par :

```typescript
        <span style={{ fontFamily: th.fontUI, fontSize: 16.5, fontWeight: 700, color: th.text }}>{title}</span>
        {subtitle && (
          <span style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textFaint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subtitle}</span>
        )}
        <span style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute }}>
          {dateLabel}{extra ? ` · ${extra}` : ''}
        </span>
```

- [ ] **Step 4: Lancer → succès attendu**

Run: `cd frontend && npx jest __tests__/AgendaCard.test.tsx`
Expected: PASS (anciens + nouveau cas).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/agenda/AgendaCard.tsx frontend/__tests__/AgendaCard.test.tsx
git commit -m "feat(agenda): AgendaCard accepte un subtitle optionnel"
```

---

## Task 13: `FacetPanel.tsx` (panneau de facettes)

**Files:**
- Create: `frontend/components/calendar/FacetPanel.tsx`
- Test: `frontend/__tests__/FacetPanel.test.tsx`

Présentation pure, contrôlée (état remonté au parent).

- [ ] **Step 1: Écrire le test**

Créer `frontend/__tests__/FacetPanel.test.tsx` :

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '../lib/ThemeProvider';
import { FacetPanel } from '../components/calendar/FacetPanel';
import { emptyCalendarState } from '../lib/tournamentCalendar';

const facets = {
  departments: [{ code: '75', name: 'Paris', count: 2 }, { code: '69', name: 'Rhône', count: 1 }],
  categories: [{ value: 'P500', count: 2 }, { value: 'P1000', count: 1 }],
  genders: [{ value: 'MEN' as const, count: 1 }, { value: 'WOMEN' as const, count: 1 }],
};

function setup(over: Partial<React.ComponentProps<typeof FacetPanel>> = {}) {
  const props = {
    facets, state: emptyCalendarState(),
    onToggleDept: jest.fn(), onToggleCategory: jest.fn(), onToggleGender: jest.fn(),
    onSetPreset: jest.fn(), onSetRange: jest.fn(), onToggleNearMe: jest.fn(), onClear: jest.fn(),
    ...over,
  };
  render(<ThemeProvider><FacetPanel {...props} /></ThemeProvider>);
  return props;
}

describe('FacetPanel', () => {
  it('rend les chips de département avec compteur et déclenche le toggle', () => {
    const p = setup();
    fireEvent.click(screen.getByText(/Paris/));
    expect(p.onToggleDept).toHaveBeenCalledWith('75');
  });

  it('le bouton « Autour de moi » déclenche onToggleNearMe', () => {
    const p = setup();
    fireEvent.click(screen.getByRole('button', { name: /Autour de moi/i }));
    expect(p.onToggleNearMe).toHaveBeenCalled();
  });

  it('« Effacer » apparaît quand un filtre est actif', () => {
    const state = { ...emptyCalendarState(), deptCodes: new Set(['75']) };
    const p = setup({ state });
    fireEvent.click(screen.getByText('Effacer'));
    expect(p.onClear).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Lancer → échec attendu**

Run: `cd frontend && npx jest __tests__/FacetPanel.test.tsx`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Implémenter le composant**

Créer `frontend/components/calendar/FacetPanel.tsx` :

```typescript
'use client';
import { useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { Pill } from '@/components/ui/atoms';
import { CalendarFilterState, DatePreset, calendarFacets } from '@/lib/tournamentCalendar';
import { TournamentGender } from '@/lib/api';

const GENDER_LABEL: Record<string, string> = { MEN: 'Messieurs', WOMEN: 'Dames', MIXED: 'Mixte' };
const PRESETS: { key: DatePreset; label: string }[] = [
  { key: 'weekend', label: 'Ce week-end' },
  { key: 'thisMonth', label: 'Ce mois-ci' },
  { key: 'days30', label: '30 jours' },
  { key: 'months3', label: '3 mois' },
];
const DEPT_VISIBLE = 8; // nombre de départements montrés avant « + tous »

export interface FacetPanelProps {
  facets: ReturnType<typeof calendarFacets>;
  state: CalendarFilterState;
  onToggleDept: (code: string) => void;
  onToggleCategory: (c: string) => void;
  onToggleGender: (g: TournamentGender) => void;
  onSetPreset: (p: DatePreset | null) => void;
  onSetRange: (from: string | null, to: string | null) => void;
  onToggleNearMe: () => void;
  onClear: () => void;
  nearMeBusy?: boolean;
}

export function FacetPanel({ facets, state, onToggleDept, onToggleCategory, onToggleGender, onSetPreset, onSetRange, onToggleNearMe, onClear, nearMeBusy }: FacetPanelProps) {
  const { th } = useTheme();
  const [showAllDepts, setShowAllDepts] = useState(false);

  const hasActive = state.deptCodes.size > 0 || state.categories.size > 0 || state.genders.size > 0 || state.datePreset != null || !!state.from || !!state.to || state.nearMe;
  const depts = showAllDepts ? facets.departments : facets.departments.slice(0, DEPT_VISIBLE);

  const Group = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute, marginBottom: 7 }}>{label}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>{children}</div>
    </div>
  );

  return (
    <div style={{ padding: '4px 20px 0' }}>
      {/* Autour de moi */}
      <button
        onClick={onToggleNearMe}
        aria-pressed={state.nearMe}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', border: 'none',
          borderRadius: 999, padding: '9px 15px', fontFamily: th.fontUI, fontSize: 14, fontWeight: 700,
          background: state.nearMe ? th.accent : th.surface, color: state.nearMe ? th.ink : th.text,
          boxShadow: `inset 0 0 0 1px ${th.line}`,
        }}
      >
        📍 {nearMeBusy ? 'Localisation…' : state.nearMe ? 'Autour de moi ✓' : 'Autour de moi'}
      </button>

      {/* Quand */}
      <Group label="Quand">
        {PRESETS.map((p) => (
          <Pill key={p.key} size="sm" activeBg={th.text} label={p.label} active={state.datePreset === p.key && !state.from && !state.to}
            onClick={() => onSetPreset(state.datePreset === p.key ? null : p.key)} />
        ))}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 4 }}>
          <input type="date" aria-label="Du" value={state.from ?? ''} onChange={(e) => onSetRange(e.target.value || null, state.to)}
            style={dateInput(th)} />
          <span style={{ color: th.textFaint, fontFamily: th.fontUI, fontSize: 13 }}>→</span>
          <input type="date" aria-label="au" value={state.to ?? ''} onChange={(e) => onSetRange(state.from, e.target.value || null)}
            style={dateInput(th)} />
        </span>
      </Group>

      {/* Département */}
      {facets.departments.length > 0 && (
        <Group label="Département">
          {depts.map((d) => (
            <Pill key={d.code} size="sm" activeBg={th.text} label={`${d.name} ${d.count}`} active={state.deptCodes.has(d.code)} onClick={() => onToggleDept(d.code)} />
          ))}
          {facets.departments.length > DEPT_VISIBLE && (
            <button onClick={() => setShowAllDepts((v) => !v)} style={linkBtn(th)}>
              {showAllDepts ? 'voir moins' : `+ ${facets.departments.length - DEPT_VISIBLE}`}
            </button>
          )}
        </Group>
      )}

      {/* Catégorie */}
      {facets.categories.length > 0 && (
        <Group label="Catégorie">
          {facets.categories.map((c) => (
            <Pill key={c.value} size="sm" activeBg={th.text} label={`${c.value} ${c.count}`} active={state.categories.has(c.value)} onClick={() => onToggleCategory(c.value)} />
          ))}
        </Group>
      )}

      {/* Genre */}
      {facets.genders.length > 0 && (
        <Group label="Genre">
          {facets.genders.map((g) => (
            <Pill key={g.value} size="sm" activeBg={th.text} label={`${GENDER_LABEL[g.value]} ${g.count}`} active={state.genders.has(g.value)} onClick={() => onToggleGender(g.value)} />
          ))}
        </Group>
      )}

      {hasActive && (
        <button onClick={onClear} style={{ ...linkBtn(th), marginTop: 12, display: 'block' }}>Effacer</button>
      )}
    </div>
  );
}

function dateInput(th: ReturnType<typeof useTheme>['th']): React.CSSProperties {
  return { fontFamily: th.fontUI, fontSize: 13, color: th.text, background: th.surface, border: `1px solid ${th.line}`, borderRadius: 8, padding: '5px 8px' };
}
function linkBtn(th: ReturnType<typeof useTheme>['th']): React.CSSProperties {
  return { border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.textFaint, padding: '5px 8px' };
}
```

> **Localisation = emoji `📍`** (pas d'icône SVG) : `Icon.tsx` n'a pas d'icône de localisation et `ClubDirectory` utilise déjà l'emoji `📍` pour son bouton « Autour de moi » — on suit la même convention (d'où l'absence d'import `Icon` dans ce composant).

- [ ] **Step 4: Lancer → succès attendu**

Run: `cd frontend && npx jest __tests__/FacetPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/calendar/FacetPanel.tsx frontend/__tests__/FacetPanel.test.tsx
git commit -m "feat(calendar): FacetPanel (Autour de moi + chips multi Quand/Département/Catégorie/Genre)"
```

---

## Task 14: `TournamentFinder.tsx` (orchestrateur)

**Files:**
- Create: `frontend/components/calendar/TournamentFinder.tsx`
- Test: `frontend/__tests__/TournamentFinder.test.tsx`

- [ ] **Step 1: Écrire le test**

Créer `frontend/__tests__/TournamentFinder.test.tsx` :

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '../lib/ThemeProvider';
import { TournamentFinder } from '../components/calendar/TournamentFinder';

const NAT = [
  { id: 'a', clubId: 'c', clubSportId: 'cs', name: 'GP Paris', category: 'P500', gender: 'MEN', openToWomen: true,
    description: null, contactInfo: null, startTime: '2026-07-02T12:00:00Z', endTime: null, registrationDeadline: '2026-07-01T12:00:00Z',
    maxTeams: 16, entryFee: null, status: 'PUBLISHED', confirmedCount: 0, waitlistCount: 0,
    club: { slug: 'paris', name: 'Padel Paris', city: 'Paris', department: 'Paris', departmentCode: '75', timezone: 'Europe/Paris', accentColor: '#000', logoUrl: null, latitude: 48.85, longitude: 2.35 } },
  { id: 'b', clubId: 'c2', clubSportId: 'cs', name: 'Open Lyon', category: 'P1000', gender: 'WOMEN', openToWomen: true,
    description: null, contactInfo: null, startTime: '2026-07-20T12:00:00Z', endTime: null, registrationDeadline: '2026-07-19T12:00:00Z',
    maxTeams: 16, entryFee: null, status: 'PUBLISHED', confirmedCount: 0, waitlistCount: 0,
    club: { slug: 'lyon', name: 'Lyon Padel', city: 'Lyon', department: 'Rhône', departmentCode: '69', timezone: 'Europe/Paris', accentColor: '#000', logoUrl: null, latitude: 45.76, longitude: 4.83 } },
];

jest.mock('@/lib/api', () => ({
  api: { listNationalTournaments: jest.fn(() => Promise.resolve(NAT)) },
  assetUrl: (p: string | null) => p,
}));

describe('TournamentFinder', () => {
  it('charge et liste les tournois nationaux', async () => {
    render(<ThemeProvider><TournamentFinder /></ThemeProvider>);
    expect(await screen.findByText('GP Paris')).toBeInTheDocument();
    expect(screen.getByText('Open Lyon')).toBeInTheDocument();
  });

  it('filtrer par département 75 ne garde que Paris', async () => {
    render(<ThemeProvider><TournamentFinder /></ThemeProvider>);
    await screen.findByText('GP Paris');
    fireEvent.click(screen.getByText(/Paris 1/)); // chip « Paris 1 » (compteur)
    await waitFor(() => expect(screen.queryByText('Open Lyon')).not.toBeInTheDocument());
    expect(screen.getByText('GP Paris')).toBeInTheDocument();
  });

  it('« Autour de moi » via géoloc trie par distance (Lyon en premier)', async () => {
    (navigator.geolocation.getCurrentPosition as any) = (ok: PositionCallback) =>
      ok({ coords: { latitude: 45.76, longitude: 4.83 } } as GeolocationPosition);
    render(<ThemeProvider><TournamentFinder /></ThemeProvider>);
    await screen.findByText('GP Paris');
    fireEvent.click(screen.getByRole('button', { name: /Autour de moi/i }));
    await waitFor(() => {
      const titles = screen.getAllByText(/GP Paris|Open Lyon/).map((n) => n.textContent);
      expect(titles[0]).toBe('Open Lyon');
    });
  });
});
```

- [ ] **Step 2: Lancer → échec attendu**

Run: `cd frontend && npx jest __tests__/TournamentFinder.test.tsx`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Implémenter le composant**

Créer `frontend/components/calendar/TournamentFinder.tsx` :

```typescript
'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { api, NationalTournament, TournamentGender } from '@/lib/api';
import { clubUrl } from '@/lib/clubUrl';
import { ACCENTS } from '@/lib/theme';
import { AgendaCard } from '@/components/agenda/AgendaCard';
import { FacetPanel } from '@/components/calendar/FacetPanel';
import { tournamentPlacesLabel } from '@/lib/clubhouse';
import { fillRatio, formatDateTimeRange } from '@/lib/tournament';
import {
  CalendarFilterState, DatePreset, emptyCalendarState, applyFilters, calendarFacets,
} from '@/lib/tournamentCalendar';

const GENDER_LABEL: Record<string, string> = { MEN: 'Messieurs', WOMEN: 'Dames', MIXED: 'Mixte' };

export function TournamentFinder() {
  const { th } = useTheme();
  const [items, setItems] = useState<NationalTournament[] | null>(null);
  const [state, setState] = useState<CalendarFilterState>(emptyCalendarState());
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [nearBusy, setNearBusy] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  const urlReady = useRef(false);

  // Chargement
  useEffect(() => { api.listNationalTournaments().then(setItems).catch(() => setItems([])); }, []);

  // Horloge (hydration-safe : null au 1er rendu)
  useEffect(() => {
    const tick = () => setNow(new Date());
    const t = setTimeout(tick, 0);
    const h = setInterval(tick, 60_000);
    return () => { clearTimeout(t); clearInterval(h); };
  }, []);

  // Lecture initiale de l'URL : ?quand=&du=&au=&dept=&cat=&genre=&near=
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const split = (k: string) => (q.get(k) ? q.get(k)!.split(',').filter(Boolean) : []);
    const preset = q.get('quand') as DatePreset | null;
    setState((s) => ({
      ...s,
      datePreset: (['weekend', 'thisMonth', 'days30', 'months3'] as string[]).includes(preset ?? '') ? preset : null,
      from: q.get('du') || null,
      to: q.get('au') || null,
      deptCodes: new Set(split('dept')),
      categories: new Set(split('cat')),
      genders: new Set(split('genre') as TournamentGender[]),
      nearMe: q.get('near') === '1',
    }));
    urlReady.current = true;
  }, []);

  // Écriture de l'URL (replaceState : lien partageable)
  useEffect(() => {
    if (!urlReady.current) return;
    const q = new URLSearchParams();
    if (state.datePreset && !state.from && !state.to) q.set('quand', state.datePreset);
    if (state.from) q.set('du', state.from);
    if (state.to) q.set('au', state.to);
    if (state.deptCodes.size) q.set('dept', [...state.deptCodes].join(','));
    if (state.categories.size) q.set('cat', [...state.categories].join(','));
    if (state.genders.size) q.set('genre', [...state.genders].join(','));
    if (state.nearMe) q.set('near', '1');
    const qs = q.toString();
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
  }, [state]);

  // Toggle d'une valeur dans un Set d'une dimension
  function toggleIn(key: 'deptCodes' | 'categories' | 'genders', value: string) {
    setState((s) => {
      const next = new Set(s[key] as Set<string>);
      if (next.has(value)) next.delete(value); else next.add(value);
      return { ...s, [key]: next };
    });
  }

  const toggleNearMe = () => {
    if (state.nearMe) { setState((s) => ({ ...s, nearMe: false })); return; }
    if (coords) { setState((s) => ({ ...s, nearMe: true })); return; }
    setNearBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setState((s) => ({ ...s, nearMe: true })); setNearBusy(false); },
      () => { setNearBusy(false); }, // refus → nearMe reste false
      { timeout: 8000 },
    );
  };

  const facets = useMemo(() => (items && now ? calendarFacets(items, state, now) : null), [items, state, now]);
  const results = useMemo(() => (items && now ? applyFilters(items, state, now, coords ?? undefined) : null), [items, state, now, coords]);

  return (
    <div style={{ paddingBottom: 48, background: th.bg, minHeight: '100vh' }}>
      <div style={{ padding: '22px 20px 0' }}>
        <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 30, color: th.text, letterSpacing: -0.5 }}>Calendrier des tournois</div>
        <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, marginTop: 6 }}>Toutes les épreuves des clubs Palova, partout en France.</p>
      </div>

      {facets && (
        <FacetPanel
          facets={facets}
          state={state}
          onToggleDept={(c) => toggleIn('deptCodes', c)}
          onToggleCategory={(c) => toggleIn('categories', c)}
          onToggleGender={(g) => toggleIn('genders', g)}
          onSetPreset={(p) => setState((s) => ({ ...s, datePreset: p, from: null, to: null }))}
          onSetRange={(from, to) => setState((s) => ({ ...s, from, to, datePreset: null }))}
          onToggleNearMe={toggleNearMe}
          onClear={() => setState((s) => ({ ...emptyCalendarState(), nearMe: s.nearMe }))}
          nearMeBusy={nearBusy}
        />
      )}

      <div style={{ padding: '18px 20px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {results === null && <div style={{ fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>}
        {results?.length === 0 && <div style={{ fontFamily: th.fontUI, color: th.textMute }}>Aucun tournoi ne correspond à votre recherche.</div>}
        {results?.map(({ tournament: t, distanceKm }) => {
          const subtitle = [t.club.name, t.club.city, distanceKm != null ? `${Math.round(distanceKm)} km` : null].filter(Boolean).join(' · ');
          return (
            <AgendaCard
              key={t.id}
              icon="trophy"
              accent={ACCENTS.apricot}
              tag={`${t.category} · ${GENDER_LABEL[t.gender]}`}
              title={t.name}
              subtitle={subtitle}
              dateLabel={formatDateTimeRange(t.startTime, t.endTime, t.club.timezone)}
              deadline={t.registrationDeadline}
              now={now}
              ratio={fillRatio(t)}
              places={tournamentPlacesLabel(t)}
              extra={t.entryFee ? `${t.entryFee} €` : null}
              onClick={() => { window.location.href = clubUrl(t.club.slug, `/tournois/${t.id}`); }}
            />
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Lancer → succès attendu**

Run: `cd frontend && npx jest __tests__/TournamentFinder.test.tsx`
Expected: PASS (chargement, filtre département, tri distance).

> Si le test « filtre 75 » ne trouve pas le libellé `Paris 1`, vérifier le format exact du chip dans `FacetPanel` (`${d.name} ${d.count}`) et ajuster le sélecteur du test au libellé réel.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/calendar/TournamentFinder.tsx frontend/__tests__/TournamentFinder.test.tsx
git commit -m "feat(calendar): TournamentFinder (chargement, facettes, géoloc, URL partageable)"
```

---

## Task 15: Page `/tournois` (hôte plateforme) + accès public

**Files:**
- Modify: `frontend/app/tournois/page.tsx`
- Modify: `frontend/lib/authGate.ts` (`isPlatformPublicPath`)
- Test: `frontend/__tests__/authGate.test.ts`

- [ ] **Step 1: Test — `/tournois` public sur l'hôte plateforme**

Dans `frontend/__tests__/authGate.test.ts`, ajouter dans le `describe` de `isPlatformPublicPath` (importer `isPlatformPublicPath` s'il ne l'est pas déjà) :

```typescript
  it('/tournois est public sur l\'hôte plateforme', () => {
    expect(isPlatformPublicPath('/tournois')).toBe(true);
  });
  it('/tournois/abc (fiche) n\'est PAS forcé public par cette règle', () => {
    // la fiche vit sur l'hôte club ; sur la plateforme seule la liste /tournois est ouverte
    expect(isPlatformPublicPath('/tournois/abc')).toBe(false);
  });
```

- [ ] **Step 2: Lancer → échec attendu**

Run: `cd frontend && npx jest __tests__/authGate.test.ts`
Expected: FAIL (`/tournois` pas encore public).

- [ ] **Step 3: Rendre `/tournois` public (plateforme uniquement)**

Dans `frontend/lib/authGate.ts`, remplacer :

```typescript
export function isPlatformPublicPath(pathname: string): boolean {
  return pathname === '/' || isPublicPath(pathname);
}
```

par :

```typescript
export function isPlatformPublicPath(pathname: string): boolean {
  // `/` = vitrine, `/tournois` = calendrier national public (la fiche /tournois/[id] vit sur l'hôte club).
  return pathname === '/' || pathname === '/tournois' || isPublicPath(pathname);
}
```

- [ ] **Step 4: Lancer → succès attendu**

Run: `cd frontend && npx jest __tests__/authGate.test.ts`
Expected: PASS.

- [ ] **Step 5: Brancher la page selon l'hôte**

Remplacer **tout** le contenu de `frontend/app/tournois/page.tsx` :

```typescript
'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useClub } from '@/lib/ClubProvider';
import { TournamentFinder } from '@/components/calendar/TournamentFinder';

// L'hôte est décidé par `slug` (posé par le layout depuis x-club-slug) : null = plateforme.
// Hôte plateforme → calendrier national public. Hôte club → /tournois est devenu /events.
export default function TournoisPage() {
  const { slug } = useClub();
  const router = useRouter();

  useEffect(() => {
    if (slug) router.replace('/events?filtre=competitions');
  }, [slug, router]);

  if (slug) return null;            // hôte club : redirection en cours vers /events
  return <TournamentFinder />;      // hôte plateforme (slug === null)
}
```

- [ ] **Step 6: Compiler**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS.

> `useClub()` renvoie `{ slug, club, loading }` (`ClubProvider.tsx`) ; `slug === null` ⇔ hôte plateforme (résolu synchronement, sans attendre le fetch du club).

- [ ] **Step 7: Commit**

```bash
git add frontend/app/tournois/page.tsx frontend/lib/authGate.ts frontend/__tests__/authGate.test.ts
git commit -m "feat(tournois): page calendrier national (hôte plateforme) + accès public"
```

---

## Task 16: Accueil visiteur — section « Prochains tournois »

**Files:**
- Create: `frontend/components/calendar/UpcomingTournaments.tsx`
- Modify: `frontend/components/platform/AnonymousView.tsx`
- Test: `frontend/__tests__/AnonymousView.test.tsx`

- [ ] **Step 1: Implémenter `UpcomingTournaments`**

Créer `frontend/components/calendar/UpcomingTournaments.tsx` :

```typescript
'use client';
import { useEffect, useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { api, NationalTournament } from '@/lib/api';
import { clubUrl } from '@/lib/clubUrl';
import { platformUrl } from '@/lib/clubUrl';
import { ACCENTS } from '@/lib/theme';
import { AgendaCard } from '@/components/agenda/AgendaCard';
import { tournamentPlacesLabel } from '@/lib/clubhouse';
import { fillRatio, formatDateTimeRange } from '@/lib/tournament';

const GENDER_LABEL: Record<string, string> = { MEN: 'Messieurs', WOMEN: 'Dames', MIXED: 'Mixte' };
const MAX = 4;

// Aperçu des prochains tournois nationaux sur la vitrine visiteur. Vide → rien rendu.
export function UpcomingTournaments() {
  const { th } = useTheme();
  const [items, setItems] = useState<NationalTournament[] | null>(null);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => { api.listNationalTournaments().then(setItems).catch(() => setItems([])); }, []);
  useEffect(() => { const t = setTimeout(() => setNow(new Date()), 0); return () => clearTimeout(t); }, []);

  if (!items || items.length === 0) return null; // déjà trié par date côté backend

  const top = items.slice(0, MAX);
  return (
    <>
      <div style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute, padding: '30px 20px 0' }}>
        📅 Prochains tournois
      </div>
      <div style={{ padding: '12px 20px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {top.map((t) => (
          <AgendaCard
            key={t.id}
            icon="trophy"
            accent={ACCENTS.apricot}
            tag={`${t.category} · ${GENDER_LABEL[t.gender]}`}
            title={t.name}
            subtitle={[t.club.name, t.club.city].filter(Boolean).join(' · ')}
            dateLabel={formatDateTimeRange(t.startTime, t.endTime, t.club.timezone)}
            deadline={t.registrationDeadline}
            now={now}
            ratio={fillRatio(t)}
            places={tournamentPlacesLabel(t)}
            extra={t.entryFee ? `${t.entryFee} €` : null}
            onClick={() => { window.location.href = clubUrl(t.club.slug, `/tournois/${t.id}`); }}
          />
        ))}
        <a href={platformUrl('/tournois')} style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 14.5, color: th.text, textDecoration: 'none', marginTop: 2 }}>
          Voir tout le calendrier →
        </a>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Brancher dans `AnonymousView`**

Dans `frontend/components/platform/AnonymousView.tsx`, ajouter l'import en tête (après la ligne `import { ClubDirectory } …`) :

```typescript
import { UpcomingTournaments } from '@/components/calendar/UpcomingTournaments';
```

Puis remplacer le bloc « emplacement chantier 2 » :

```typescript
        <SectionTitle th={th}>📅 Le calendrier des tournois</SectionTitle>
        <SoonCard th={th} label="Le calendrier des tournois de tous les clubs arrive bientôt." />
```

par :

```typescript
        <UpcomingTournaments />
```

- [ ] **Step 3: Mettre à jour le test `AnonymousView`**

Dans `frontend/__tests__/AnonymousView.test.tsx`, ajouter le mock (sous le mock `ClubDirectory` existant) pour isoler la section du réseau :

```typescript
jest.mock('@/components/calendar/UpcomingTournaments', () => ({ UpcomingTournaments: () => <div data-testid="upcoming-tournaments" /> }));
```

Et ajouter une assertion dans le 1er `it` :

```typescript
    expect(screen.getByTestId('upcoming-tournaments')).toBeInTheDocument();
```

- [ ] **Step 4: Lancer → succès attendu**

Run: `cd frontend && npx jest __tests__/AnonymousView.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/calendar/UpcomingTournaments.tsx frontend/components/platform/AnonymousView.tsx frontend/__tests__/AnonymousView.test.tsx
git commit -m "feat(accueil): section « Prochains tournois » (remplace le SoonCard)"
```

---

## Task 17: Admin — case opt-in `/admin/settings`

**Files:**
- Modify: `frontend/app/admin/settings/page.tsx` (carte « Visibilité », ~lignes 245-252, et `save()` body ~ligne 122)

- [ ] **Step 1: Inclure le champ dans le payload `save()`**

Dans `frontend/app/admin/settings/page.tsx`, dans l'objet `body` de `save()`, repérer :

```typescript
        listedInDirectory: club.listedInDirectory,
```

et ajouter en dessous :

```typescript
        listedInDirectory: club.listedInDirectory,
        listTournamentsNationally: club.listTournamentsNationally,
```

- [ ] **Step 2: Ajouter la case dans la carte « Visibilité »**

Toujours dans la même page, dans la carte « Visibilité », après le `<label>` de `listedInDirectory` (la `</label>` qui suit la ligne `checked={club.listedInDirectory}`), ajouter un second label :

```typescript
  <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', marginTop: 12 }}>
    <input type="checkbox" checked={club.listTournamentsNationally} onChange={(e) => set('listTournamentsNationally', e.target.checked)} style={{ width: 18, height: 18, accentColor: th.accent, cursor: 'pointer' }} />
    <span style={{ fontFamily: th.fontUI, fontSize: 15, color: th.text }}>Publier mes tournois dans le calendrier national Palova</span>
  </label>
```

- [ ] **Step 3: Compiler**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS (le type `ClubAdminDetail` a bien `listTournamentsNationally`, ajouté en Task 10).

- [ ] **Step 4: Vérifier la non-régression des tests admin settings (s'ils existent)**

Run: `cd frontend && npx jest __tests__ -t "settings" || true`
Expected: PASS (ou aucun test ciblé — la compilation TS est la garantie principale ici).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/admin/settings/page.tsx
git commit -m "feat(admin): case « Publier mes tournois dans le calendrier national »"
```

---

## Task 18: Vérification d'ensemble (manuelle)

**Files:** aucun (validation).

- [ ] **Step 1: Suites de tests complètes**

Run:
```bash
cd backend && npm test
```
Expected: PASS (geo, club, platform, tournament).

Run:
```bash
cd frontend && npm test
```
Expected: PASS (tournamentCalendar, FacetPanel, TournamentFinder, AgendaCard, authGate, AnonymousView + le reste non régressé).

- [ ] **Step 2: Type-check global**

Run: `cd backend && npx tsc --noEmit` puis `cd frontend && npx tsc --noEmit`
Expected: PASS des deux côtés.

- [ ] **Step 3: Parcours manuel (backend + frontend démarrés, données seedées + géocodées)**

Suivre la checklist de la spec (`## Vérification`) :
1. `curl http://localhost:3001/api/tournaments/national` → tournois à venir des clubs opt-in, `club.departmentCode` + compteurs présents ; un club non opt-in/suspendu absent.
2. Hôte plateforme `/tournois` (sans login) : panneau de facettes, multi-sélection Quand/Département/Catégorie/Genre (compteurs, valeurs présentes), « Autour de moi » trie par distance, filtres dans l'URL, clic carte → sous-domaine club `/tournois/[id]`.
3. Accueil visiteur : section « Prochains tournois » remplie + lien « Voir tout le calendrier → » ; liste vide → section masquée.
4. `/admin/settings` : la case opt-in bascule `listTournamentsNationally` (re-vérifier via l'API national).
5. Non-régression : `/tournois` sur un sous-domaine club redirige toujours vers `/events`.

- [ ] **Step 4: Mettre à jour la doc projet (CLAUDE.md)**

Ajouter une section « Calendrier national des tournois (v1) ✅ implémenté » dans `CLAUDE.md` résumant : opt-in club (`listTournamentsNationally`), champs géo `department`/`departmentCode`, endpoint `GET /api/tournaments/national`, page `/tournois` plateforme publique, helpers `lib/tournamentCalendar.ts`, composants `components/calendar/*`. Renvoyer vers la spec et ce plan.

- [ ] **Step 5: Commit final**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-06-26-calendrier-tournois-national-design.md docs/superpowers/plans/2026-06-26-calendrier-tournois-national.md
git commit -m "docs(calendrier-national): spec + plan + section CLAUDE.md"
```

---

## Self-Review

**Spec coverage**
- Opt-in club → Tasks 1, 9, 10, 17. ✅
- Champs géo département → Tasks 1, 2, 3, 4, 5. ✅
- Agrégat + route → Tasks 6, 7. ✅
- Seeds opt-in (dev) → Task 8. ✅
- Helpers purs facettes/filtres/présets/distance → Task 11. ✅
- FacetPanel multi-sélection + Autour de moi + Effacer → Task 13. ✅
- TournamentFinder (charge, facettes, géoloc, URL, carte→fiche club) → Task 14. ✅
- Page plateforme + accès public proxy/authGate → Task 15. ✅
- Accueil « Prochains tournois » (masquée si vide) → Task 16. ✅
- Pas de filtre Région → respecté (facettes = Quand/Département/Catégorie/Genre uniquement). ✅
- Hors périmètre (events, poules, pagination serveur) → non traité, conforme. ✅

**Cohérence des types**
- `NationalTournament` = `Tournament & { club: NationalTournamentClub }` (Task 10) ; la projection backend (Task 6) inclut exactement `slug, name, city, department, departmentCode, timezone, accentColor, logoUrl, latitude, longitude` + counts (via `withCounts`) → aligné.
- `CalendarFilterState` (Sets) utilisé identiquement dans `tournamentCalendar.ts` (Task 11), `FacetPanel` (Task 13), `TournamentFinder` (Task 14).
- `calendarFacets(items, state, now)` → `{ departments: {code,name,count}[], categories: {value,count}[], genders: {value,count}[] }` : même forme consommée par `FacetPanel` (`d.code`/`d.name`/`d.count`, `c.value`/`c.count`, `g.value`/`g.count`) et testée en Task 11/13. ✅
- `applyFilters(items, state, now, coords?)` → `RankedTournament[]` (`{ tournament, distanceKm }`) consommé par `TournamentFinder`. ✅

**Notes de risque consignées dans les tâches** : ordre `/national` avant `/:id` (Task 7) ; drift Prisma → `migrate deploy`/`db push` (Task 1) ; libellé exact des chips dans les sélecteurs de test (Tasks 13/14). *Résolus pendant l'écriture du plan :* localisation = emoji `📍` (pas d'icône SVG, conforme à `ClubDirectory`) ; `useClub()` expose `{ slug, club, loading }` → décision d'hôte par `slug === null` (Task 15).

**Placeholders** : aucun — chaque étape de code montre le code complet (nouveaux fichiers en entier, modifications en remplacement exact ancien→nouveau).
