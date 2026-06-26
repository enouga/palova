# Accueil plateforme — Fondation (landing visiteur + adaptatif + géoloc) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire de `palova.fr/` une page d'accueil marketing adaptative (Visiteur / Joueur / Gérant), avec une couche de géolocalisation des clubs (« autour de moi » / par région).

**Architecture:** Une couche géo backend neuve (champs `Club` + `geo.service` qui géocode via la Base Adresse Nationale, branché à la création/màj de club ; `listClubs` filtre par région et trie par distance). Côté front, on ajoute la branche `AnonymousView` au dispatcher `PlatformLanding` (qui aujourd'hui redirige l'anonyme vers `/login`), on enrichit `ClubDirectory` d'un bouton « Autour de moi », et on déverrouille `/` sur l'hôte plateforme dans `proxy.ts` (host-aware, sans toucher aux sous-domaines club).

**Tech Stack:** Backend Express 5 + Prisma 7 (adapter PrismaPg) + Jest/jest-mock-extended (prismaMock). Front Next.js 16 + React 19 + Jest/RTL. Géocodage : `api-adresse.data.gouv.fr` (gratuit, FR, sans clé), via `fetch` global.

**Spec :** `docs/superpowers/specs/2026-06-26-accueil-plateforme-fondation-design.md`.

---

## Structure des fichiers

**Backend**
- `backend/prisma/schema.prisma` — **modifier** : 4 champs géo sur `Club`.
- `backend/prisma/migrations/<ts>_add_club_geolocation/` — **créer** (via `prisma migrate dev`).
- `backend/src/services/geo.service.ts` — **créer** : `geocodeAddress()` + `haversineKm()`.
- `backend/src/services/__tests__/geo.service.test.ts` — **créer**.
- `backend/src/services/club.service.ts` — **modifier** : `listClubs` (filtres `region`/`lat`/`lng`, tri distance, projection +géo), géocodage dans `createClub` et `updateClub`.
- `backend/src/services/__tests__/club.service.test.ts` — **modifier** : nouveaux cas.
- `backend/src/services/platform.service.ts` — **modifier** : géocodage dans `createClubWithOwner`.
- `backend/src/services/__tests__/platform.service.test.ts` — **modifier** : 1 cas.
- `backend/src/routes/clubs.ts` — **modifier** : route `GET /` lit `region`/`lat`/`lng`.
- `backend/scripts/geocode-clubs.ts` — **créer** : backfill one-shot.

**Frontend**
- `frontend/lib/api.ts` — **modifier** : `listClubs` accepte `region`/`lat`/`lng` ; `ClubSummary` + champs géo.
- `frontend/lib/authGate.ts` — **modifier** : `isPlatformPublicPath()`.
- `frontend/proxy.ts` — **modifier** : branche hôte plateforme utilise `isPlatformPublicPath`.
- `frontend/components/ClubDirectory.tsx` — **modifier** : bouton « Autour de moi » + libellé « Ville ou région » + tri distance.
- `frontend/components/platform/AnonymousView.tsx` — **créer** : vitrine visiteur.
- `frontend/components/PlatformLanding.tsx` — **modifier** : dispatch vers `AnonymousView` (retrait du redirect `/login`).
- `frontend/jest.setup.ts` — **modifier** : stub `navigator.geolocation`.
- `frontend/__tests__/authGate.test.ts` — **créer**.
- `frontend/__tests__/ClubDirectory.test.tsx` — **modifier** : cas « Autour de moi ».
- `frontend/__tests__/AnonymousView.test.tsx` — **créer**.
- `frontend/__tests__/PlatformLanding.test.tsx` — **créer** (ou modifier s'il existe).

> ⚠️ **Prisma 7** : après toute modif de `schema.prisma`, lancer `npx prisma generate` (adapter PrismaPg obligatoire au runtime, déjà configuré).
> ⚠️ **OneDrive / dérive de migration** (cf. CLAUDE.md) : si `prisma migrate dev` échoue pour cause de dérive, replier en DEV sur `npx prisma db push` puis écrire le dossier de migration à la main. Après désync : `npm install` + `npx prisma generate`.

---

## Task 1 : Migration — champs géo sur `Club`

**Files:**
- Modify: `backend/prisma/schema.prisma` (modèle `Club`, après `country`)
- Create: `backend/prisma/migrations/<ts>_add_club_geolocation/`

- [ ] **Step 1 : Ajouter les champs au schéma**

Dans `backend/prisma/schema.prisma`, modèle `Club`, juste après la ligne `country  String?  @default("FR")` :

```prisma
  // Géolocalisation (annuaire « près de moi » / par région). Renseignés par géocodage
  // de l'adresse (Base Adresse Nationale) à la création/màj ; null si géocodage indisponible.
  latitude   Float?  @map("latitude")
  longitude  Float?  @map("longitude")
  region     String? @map("region")
  postalCode String? @map("postal_code")
```

- [ ] **Step 2 : Générer la migration + le client**

Run (dans `backend/`) :
```bash
npx prisma migrate dev --name add_club_geolocation
npx prisma generate
```
Expected : migration `add_club_geolocation` créée et appliquée ; client régénéré. (Si dérive OneDrive → `npx prisma db push` + dossier de migration manuel, cf. avertissement plus haut.)

- [ ] **Step 3 : Vérifier que le client connaît les champs**

Run :
```bash
npx tsc --noEmit -p backend/tsconfig.json
```
Expected : PASS (aucune erreur ; les nouveaux champs existent sur le type `Club`).

- [ ] **Step 4 : Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(club): champs geo (latitude/longitude/region/postalCode)"
```

---

## Task 2 : `geo.service.ts` — géocodage BAN + haversine

**Files:**
- Create: `backend/src/services/geo.service.ts`
- Test: `backend/src/services/__tests__/geo.service.test.ts`

- [ ] **Step 1 : Écrire les tests (qui échouent)**

Créer `backend/src/services/__tests__/geo.service.test.ts` :

```ts
import { geocodeAddress, haversineKm } from '../geo.service';

describe('geo.service — geocodeAddress', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  const okBody = {
    features: [{
      geometry: { coordinates: [2.3522, 48.8566] },
      properties: { context: '75, Paris, Île-de-France', postcode: '75011', city: 'Paris' },
    }],
  };

  it('parse une réponse BAN (lat/lon/region/postalCode/city)', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => okBody }) as any;
    const r = await geocodeAddress({ address: '12 rue du Padel', city: 'Paris' });
    expect(r).toEqual({ latitude: 48.8566, longitude: 2.3522, region: 'Île-de-France', postalCode: '75011', city: 'Paris' });
  });

  it('renvoie null si aucune adresse (pas d\'appel réseau)', async () => {
    const spy = jest.fn();
    global.fetch = spy as any;
    expect(await geocodeAddress({ address: '', city: '' })).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('renvoie null si la réponse n\'a pas de feature', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ features: [] }) }) as any;
    expect(await geocodeAddress({ address: 'nowhere' })).toBeNull();
  });

  it('renvoie null sur HTTP non-ok', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({}) }) as any;
    expect(await geocodeAddress({ address: 'x' })).toBeNull();
  });

  it('renvoie null si fetch jette (réseau / timeout)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network')) as any;
    expect(await geocodeAddress({ address: 'x' })).toBeNull();
  });
});

describe('geo.service — haversineKm', () => {
  it('≈ 0 pour deux points identiques', () => {
    expect(haversineKm({ lat: 48.85, lng: 2.35 }, { lat: 48.85, lng: 2.35 })).toBeCloseTo(0, 5);
  });
  it('Paris→Lyon ≈ 390 km (±20)', () => {
    const d = haversineKm({ lat: 48.8566, lng: 2.3522 }, { lat: 45.7640, lng: 4.8357 });
    expect(d).toBeGreaterThan(370);
    expect(d).toBeLessThan(410);
  });
});
```

- [ ] **Step 2 : Lancer → échec**

Run : `cd backend && npx jest geo.service`
Expected : FAIL (`Cannot find module '../geo.service'`).

- [ ] **Step 3 : Implémenter `geo.service.ts`**

Créer `backend/src/services/geo.service.ts` :

```ts
// Géocodage d'adresses françaises via la Base Adresse Nationale (gratuit, sans clé).
// Seule porte vers le géocodeur : swappable sans toucher au reste du code.
const BAN_URL = 'https://api-adresse.data.gouv.fr/search/';
const TIMEOUT_MS = 5000;

export interface GeoResult {
  latitude: number;
  longitude: number;
  region: string | null;
  postalCode: string | null;
  city: string | null;
}

interface BanFeature {
  geometry: { coordinates: [number, number] };
  properties: { context?: string; postcode?: string; city?: string };
}
interface BanResponse { features?: BanFeature[] }

/** Géocode une adresse FR. Renvoie null si vide, indisponible ou en échec (jamais d'exception). */
export async function geocodeAddress(input: { address?: string | null; city?: string | null; postalCode?: string | null }): Promise<GeoResult | null> {
  const q = [input.address, input.postalCode, input.city].map((s) => (s ?? '').trim()).filter(Boolean).join(' ');
  if (!q) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${BAN_URL}?q=${encodeURIComponent(q)}&limit=1`, { signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return null;
    const data = (await res.json()) as BanResponse;
    const f = data.features?.[0];
    if (!f) return null;
    const [lon, lat] = f.geometry.coordinates;
    if (typeof lat !== 'number' || typeof lon !== 'number') return null;
    // context = "75, Paris, Île-de-France" → région = dernier segment.
    const region = (f.properties.context ?? '').split(',').map((s) => s.trim()).filter(Boolean).pop() ?? null;
    return { latitude: lat, longitude: lon, region, postalCode: f.properties.postcode ?? null, city: f.properties.city ?? null };
  } catch {
    return null;
  }
}

/** Distance grand-cercle (km) entre deux points lat/lng. */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
```

- [ ] **Step 4 : Lancer → succès**

Run : `cd backend && npx jest geo.service`
Expected : PASS.

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/geo.service.ts backend/src/services/__tests__/geo.service.test.ts
git commit -m "feat(geo): geocodeAddress (Base Adresse Nationale) + haversineKm"
```

---

## Task 3 : `listClubs` — filtres région / distance + projection géo

**Files:**
- Modify: `backend/src/services/club.service.ts:118-141`
- Test: `backend/src/services/__tests__/club.service.test.ts`

- [ ] **Step 1 : Écrire les tests (qui échouent)**

Ajouter à la fin de `backend/src/services/__tests__/club.service.test.ts` (le fichier importe déjà `prismaMock` et `ClubService`) :

```ts
describe('ClubService — listClubs (géo)', () => {
  const service = new ClubService();
  const row = (over: Record<string, unknown>) => ({
    id: 'c', slug: 's', name: 'N', city: 'V', region: 'R', latitude: null, longitude: null,
    description: null, accentColor: '#000', logoUrl: null, coverImageUrl: null,
    clubSports: [], _count: { resources: 0 }, ...over,
  });

  it('filtre « city » matche ville OU région (contains, insensitive)', async () => {
    prismaMock.club.findMany.mockResolvedValue([] as any);
    await service.listClubs({ city: 'occ' });
    const arg = (prismaMock.club.findMany as jest.Mock).mock.calls[0][0];
    expect(arg.where.OR).toEqual([
      { city:   { contains: 'occ', mode: 'insensitive' } },
      { region: { contains: 'occ', mode: 'insensitive' } },
    ]);
  });

  it('trie par distance croissante quand lat/lng fournis ; clubs sans coords en dernier', async () => {
    prismaMock.club.findMany.mockResolvedValue([
      row({ id: 'lyon',  latitude: 45.764, longitude: 4.8357 }),
      row({ id: 'paris', latitude: 48.8566, longitude: 2.3522 }),
      row({ id: 'nocoord', latitude: null, longitude: null }),
    ] as any);
    const res = await service.listClubs({ lat: 48.86, lng: 2.35 }); // proche de Paris
    expect(res.map((c) => c.id)).toEqual(['paris', 'lyon', 'nocoord']);
  });

  it('expose latitude/longitude/region dans la projection', async () => {
    prismaMock.club.findMany.mockResolvedValue([row({ latitude: 1, longitude: 2 })] as any);
    const res = await service.listClubs({});
    expect(res[0]).toMatchObject({ latitude: 1, longitude: 2, region: 'R' });
  });
});
```

- [ ] **Step 2 : Lancer → échec**

Run : `cd backend && npx jest club.service`
Expected : FAIL (filtre `city` actuel pose `where.city`, pas `where.OR` ; pas de tri distance ; projection sans `latitude`).

- [ ] **Step 3 : Réécrire `listClubs`**

Remplacer `backend/src/services/club.service.ts:118-141` par :

```ts
  /** Annuaire public : clubs actifs. `city` matche ville OU région ; `lat`/`lng` trient par distance. */
  async listClubs(filters: { sport?: string; city?: string; q?: string; region?: string; lat?: number; lng?: number }) {
    const where: Prisma.ClubWhereInput = { status: 'ACTIVE', listedInDirectory: true };
    if (filters.q)    where.name = { contains: filters.q, mode: 'insensitive' };
    if (filters.city) where.OR = [
      { city:   { contains: filters.city, mode: 'insensitive' } },
      { region: { contains: filters.city, mode: 'insensitive' } },
    ];
    if (filters.region) where.region = { equals: filters.region, mode: 'insensitive' };
    if (filters.sport)  where.clubSports = { some: { sport: { key: filters.sport } } };

    const clubs = await prisma.club.findMany({
      where,
      orderBy: { name: 'asc' },
      select: {
        id: true, slug: true, name: true, city: true, region: true, latitude: true, longitude: true,
        description: true, accentColor: true, logoUrl: true, coverImageUrl: true,
        clubSports: { select: { sport: { select: { key: true, name: true, icon: true } } } },
        _count: { select: { resources: true } },
      },
    });

    let mapped = clubs.map((c) => ({
      id: c.id, slug: c.slug, name: c.name, city: c.city, region: c.region,
      latitude: c.latitude, longitude: c.longitude,
      description: c.description, accentColor: c.accentColor, logoUrl: c.logoUrl, coverImageUrl: c.coverImageUrl,
      sports: c.clubSports.map((cs) => cs.sport),
      resourceCount: c._count.resources,
    }));

    // Tri par distance (clubs sans coordonnées repoussés en fin de liste).
    if (typeof filters.lat === 'number' && typeof filters.lng === 'number') {
      const origin = { lat: filters.lat, lng: filters.lng };
      mapped = mapped
        .map((c) => ({ c, d: c.latitude != null && c.longitude != null ? haversineKm(origin, { lat: c.latitude, lng: c.longitude }) : Infinity }))
        .sort((a, b) => a.d - b.d)
        .map((x) => x.c);
    }
    return mapped;
  }
```

Ajouter l'import en tête de fichier (après les imports existants) — **seulement `haversineKm`** ici (`geocodeAddress` sera ajouté à l'import en Task 4, pour éviter un import inutilisé) :
```ts
import { haversineKm } from './geo.service';
```

- [ ] **Step 4 : Lancer → succès**

Run : `cd backend && npx jest club.service`
Expected : PASS.

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/club.service.ts backend/src/services/__tests__/club.service.test.ts
git commit -m "feat(club): listClubs filtre ville-ou-region + tri par distance"
```

---

## Task 4 : Géocodage à `createClub` et `updateClub`

**Files:**
- Modify: `backend/src/services/club.service.ts` (`createClub`, `updateClub`)
- Test: `backend/src/services/__tests__/club.service.test.ts`

- [ ] **Step 1 : Écrire les tests (qui échouent)**

En **tête** de `backend/src/services/__tests__/club.service.test.ts`, sous les imports existants, ajouter le mock du géocodeur :

```ts
jest.mock('../geo.service', () => ({
  ...jest.requireActual('../geo.service'),
  geocodeAddress: jest.fn(),
}));
import { geocodeAddress } from '../geo.service';
const geocodeMock = geocodeAddress as jest.Mock;
```

Puis ajouter ce bloc de tests :

```ts
describe('ClubService — géocodage create/update', () => {
  const service = new ClubService();
  beforeEach(() => {
    geocodeMock.mockReset();
    // $transaction(cb) exécute le callback avec prismaMock comme tx.
    (prismaMock.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(prismaMock));
  });

  it('createClub géocode l\'adresse et persiste lat/long/region/postalCode', async () => {
    geocodeMock.mockResolvedValue({ latitude: 48.8, longitude: 2.3, region: 'Île-de-France', postalCode: '75011', city: 'Paris' });
    prismaMock.clubSlugAlias.findUnique.mockResolvedValue(null as any);
    prismaMock.club.create.mockResolvedValue({ id: 'c1' } as any);
    prismaMock.clubMember.create.mockResolvedValue({} as any);

    await service.createClub({ ownerId: 'o1', name: 'Le Padel', address: '12 rue X', city: 'Paris' });

    expect(geocodeMock).toHaveBeenCalledWith({ address: '12 rue X', city: 'Paris' });
    const data = (prismaMock.club.create as jest.Mock).mock.calls[0][0].data;
    expect(data).toMatchObject({ latitude: 48.8, longitude: 2.3, region: 'Île-de-France', postalCode: '75011' });
  });

  it('createClub : géocodage en échec → club créé sans coordonnées', async () => {
    geocodeMock.mockResolvedValue(null);
    prismaMock.clubSlugAlias.findUnique.mockResolvedValue(null as any);
    prismaMock.club.create.mockResolvedValue({ id: 'c1' } as any);
    prismaMock.clubMember.create.mockResolvedValue({} as any);

    await service.createClub({ ownerId: 'o1', name: 'Le Padel', address: '12 rue X', city: 'Paris' });

    const data = (prismaMock.club.create as jest.Mock).mock.calls[0][0].data;
    expect(data.latitude).toBeUndefined();
  });

  it('updateClub re-géocode quand l\'adresse change', async () => {
    geocodeMock.mockResolvedValue({ latitude: 1, longitude: 2, region: 'R', postalCode: '12345', city: 'V' });
    prismaMock.club.findUnique.mockResolvedValue({ address: 'ancienne', city: 'V' } as any);
    prismaMock.club.update.mockResolvedValue({} as any);

    await service.updateClub('c1', { address: 'nouvelle' });

    expect(geocodeMock).toHaveBeenCalled();
    const data = (prismaMock.club.update as jest.Mock).mock.calls[0][0].data;
    expect(data).toMatchObject({ latitude: 1, longitude: 2, region: 'R', postalCode: '12345' });
  });

  it('updateClub ne géocode pas si l\'adresse est inchangée', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ address: 'pareille', city: 'V' } as any);
    prismaMock.club.update.mockResolvedValue({} as any);

    await service.updateClub('c1', { address: 'pareille', city: 'V' });

    expect(geocodeMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2 : Lancer → échec**

Run : `cd backend && npx jest club.service`
Expected : FAIL (createClub ne géocode pas ; updateClub n'a pas de logique géo).

- [ ] **Step 3 : Brancher le géocodage dans `createClub`**

D'abord, compléter l'import de géo en tête de fichier (ajouter `geocodeAddress` à la ligne posée en Task 3) :
```ts
import { geocodeAddress, haversineKm } from './geo.service';
```
Puis, dans `createClub`, juste avant `return await prisma.$transaction(...)`, insérer :
```ts
    // Géocodage HORS transaction (réseau) ; null si indisponible.
    const geo = await geocodeAddress({ address: params.address, city: params.city });
```
Puis, dans `tx.club.create({ data: { ... } })`, ajouter après `timezone:` :
```ts
            ...(geo ? { latitude: geo.latitude, longitude: geo.longitude, region: geo.region, postalCode: geo.postalCode } : {}),
```

- [ ] **Step 4 : Brancher le géocodage dans `updateClub`**

Au tout début du corps de `updateClub` (avant le `return prisma.club.update(...)`), insérer :
```ts
    // Re-géocode uniquement si l'adresse ou la ville change (BAN gratuit mais on évite le bruit).
    let geoData: Record<string, unknown> = {};
    if (params.address !== undefined || params.city !== undefined) {
      const current = await prisma.club.findUnique({ where: { id: clubId }, select: { address: true, city: true } });
      const newAddress = params.address !== undefined ? params.address : current?.address ?? '';
      const newCity = params.city !== undefined ? params.city : current?.city ?? null;
      const changed = (newAddress ?? '') !== (current?.address ?? '') || (newCity ?? '') !== (current?.city ?? '');
      if (changed) {
        const geo = await geocodeAddress({ address: newAddress, city: newCity });
        geoData = geo
          ? { latitude: geo.latitude, longitude: geo.longitude, region: geo.region, postalCode: geo.postalCode }
          : { latitude: null, longitude: null, region: null, postalCode: null };
      }
    }
```
Puis, dans le `data: { ... }` du `prisma.club.update`, ajouter `...geoData,` en **première** position (avant les spreads existants), afin que les champs géo soient inclus.

- [ ] **Step 5 : Lancer → succès**

Run : `cd backend && npx jest club.service`
Expected : PASS.

- [ ] **Step 6 : Commit**

```bash
git add backend/src/services/club.service.ts backend/src/services/__tests__/club.service.test.ts
git commit -m "feat(club): geocode l'adresse a la creation et a la mise a jour"
```

---

## Task 5 : Géocodage à `createClubWithOwner` (super-admin)

**Files:**
- Modify: `backend/src/services/platform.service.ts:142-150`
- Test: `backend/src/services/__tests__/platform.service.test.ts`

- [ ] **Step 1 : Écrire le test (qui échoue)**

Dans `backend/src/services/__tests__/platform.service.test.ts`, ajouter le mock du géocodeur en tête (sous les imports) s'il n'y est pas déjà :
```ts
jest.mock('../geo.service', () => ({ ...jest.requireActual('../geo.service'), geocodeAddress: jest.fn() }));
import { geocodeAddress } from '../geo.service';
const geocodeMock = geocodeAddress as jest.Mock;
```
Puis un cas (adapter les mocks aux helpers existants du fichier — `$transaction` exécute le callback avec `prismaMock`) :
```ts
it('createClubWithOwner géocode l\'adresse du club', async () => {
  geocodeMock.mockResolvedValue({ latitude: 9, longitude: 8, region: 'Bretagne', postalCode: '35000', city: 'Rennes' });
  (prismaMock.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(prismaMock));
  prismaMock.user.findFirst.mockResolvedValue(null as any);
  prismaMock.clubSlugAlias.findUnique.mockResolvedValue(null as any);
  prismaMock.user.create.mockResolvedValue({ id: 'o', email: 'o@x.fr', firstName: 'A', lastName: 'B' } as any);
  prismaMock.club.create.mockResolvedValue({ id: 'c' } as any);
  prismaMock.clubMember.create.mockResolvedValue({} as any);

  const svc = new PlatformService();
  await svc.createClubWithOwner({
    club: { name: 'Club Rennes', address: '1 rue Y', city: 'Rennes' },
    owner: { firstName: 'A', lastName: 'B', email: 'o@x.fr', password: 'password123' },
  });

  const data = (prismaMock.club.create as jest.Mock).mock.calls[0][0].data;
  expect(data).toMatchObject({ latitude: 9, longitude: 8, region: 'Bretagne', postalCode: '35000' });
});
```
> Adapter `new PlatformService()` / le nom d'import au fichier existant.

- [ ] **Step 2 : Lancer → échec**

Run : `cd backend && npx jest platform.service`
Expected : FAIL.

- [ ] **Step 3 : Implémenter**

Dans `createClubWithOwner`, juste avant `return await prisma.$transaction(...)`, insérer :
```ts
    const geo = await geocodeAddress({ address: params.club.address, city: params.club.city });
```
Dans `tx.club.create({ data: { ... } })`, après `status: 'ACTIVE',`, ajouter :
```ts
            ...(geo ? { latitude: geo.latitude, longitude: geo.longitude, region: geo.region, postalCode: geo.postalCode } : {}),
```
Ajouter en tête de fichier l'import :
```ts
import { geocodeAddress } from './geo.service';
```

- [ ] **Step 4 : Lancer → succès**

Run : `cd backend && npx jest platform.service`
Expected : PASS.

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/platform.service.ts backend/src/services/__tests__/platform.service.test.ts
git commit -m "feat(platform): geocode l'adresse a la creation de club par le super-admin"
```

---

## Task 6 : Route annuaire — lire `region`/`lat`/`lng`

**Files:**
- Modify: `backend/src/routes/clubs.ts:91-100`

- [ ] **Step 1 : Modifier la route `GET /`**

Remplacer le corps de `router.get('/', ...)` (lignes 91-100) par :
```ts
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const latRaw = asString(req.query.lat), lngRaw = asString(req.query.lng);
    const lat = latRaw ? Number(latRaw) : undefined;
    const lng = lngRaw ? Number(lngRaw) : undefined;
    const clubs = await clubService.listClubs({
      sport:  asString(req.query.sport) || undefined,
      city:   asString(req.query.city) || undefined,
      q:      asString(req.query.q) || undefined,
      region: asString(req.query.region) || undefined,
      lat: Number.isFinite(lat) ? lat : undefined,
      lng: Number.isFinite(lng) ? lng : undefined,
    });
    res.json(clubs);
  } catch (err) { handleError(err, res, next); }
});
```

- [ ] **Step 2 : Vérifier la compilation + manuel**

Run : `npx tsc --noEmit -p backend/tsconfig.json`
Expected : PASS.

Run (backend démarré) :
```bash
curl "http://localhost:3001/api/clubs?lat=48.86&lng=2.35"
```
Expected : 200, clubs triés par distance (clubs géocodés d'abord).

- [ ] **Step 3 : Commit**

```bash
git add backend/src/routes/clubs.ts
git commit -m "feat(clubs): l'annuaire public accepte region/lat/lng"
```

---

## Task 7 : Backfill — géocoder les clubs existants

**Files:**
- Create: `backend/scripts/geocode-clubs.ts`

- [ ] **Step 1 : Écrire le script**

Créer `backend/scripts/geocode-clubs.ts` :
```ts
// Backfill one-shot : géocode tous les clubs sans latitude. Idempotent (rejouable).
// Usage : npx ts-node backend/scripts/geocode-clubs.ts   (depuis la racine ou backend/)
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { geocodeAddress } from '../src/services/geo.service';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const clubs = await prisma.club.findMany({
    where: { latitude: null },
    select: { id: true, name: true, address: true, city: true },
  });
  console.log(`${clubs.length} club(s) à géocoder.`);
  for (const c of clubs) {
    const geo = await geocodeAddress({ address: c.address, city: c.city });
    if (!geo) { console.log(`  ✗ ${c.name} — non géocodé`); continue; }
    await prisma.club.update({
      where: { id: c.id },
      data: { latitude: geo.latitude, longitude: geo.longitude, region: geo.region, postalCode: geo.postalCode },
    });
    console.log(`  ✓ ${c.name} — ${geo.region ?? '?'} (${geo.latitude.toFixed(3)}, ${geo.longitude.toFixed(3)})`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
```

- [ ] **Step 2 : Lancer le backfill (vérification manuelle)**

Run (Docker + DB up) :
```bash
npx ts-node backend/scripts/geocode-clubs.ts
```
Expected : les clubs seedés affichent `✓` avec leur région/coordonnées.

- [ ] **Step 3 : Commit**

```bash
git add backend/scripts/geocode-clubs.ts
git commit -m "chore(geo): script de backfill geocode-clubs"
```

---

## Task 8 : Types front — `listClubs` géo + `ClubSummary`

**Files:**
- Modify: `frontend/lib/api.ts:39-46` (listClubs), `frontend/lib/api.ts:885-896` (ClubSummary)

- [ ] **Step 1 : Étendre `listClubs`**

Remplacer `frontend/lib/api.ts:39-46` par :
```ts
  listClubs: (filters: { sport?: string; city?: string; q?: string; region?: string; lat?: number; lng?: number } = {}) => {
    const qs = new URLSearchParams();
    if (filters.sport)  qs.set('sport', filters.sport);
    if (filters.city)   qs.set('city', filters.city);
    if (filters.q)      qs.set('q', filters.q);
    if (filters.region) qs.set('region', filters.region);
    if (typeof filters.lat === 'number' && typeof filters.lng === 'number') {
      qs.set('lat', String(filters.lat));
      qs.set('lng', String(filters.lng));
    }
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<ClubSummary[]>(`/api/clubs${suffix}`);
  },
```

- [ ] **Step 2 : Étendre `ClubSummary`**

Dans l'interface `ClubSummary` (`frontend/lib/api.ts:885-896`), ajouter après `city: string | null;` :
```ts
  region: string | null;
  latitude: number | null;
  longitude: number | null;
```

- [ ] **Step 3 : Vérifier la compilation**

Run : `cd frontend && npx tsc --noEmit`
Expected : PASS.

- [ ] **Step 4 : Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(api): listClubs accepte region/lat/lng ; ClubSummary expose la geo"
```

---

## Task 9 : Déverrouillage host-aware de `/`

**Files:**
- Modify: `frontend/lib/authGate.ts`
- Modify: `frontend/proxy.ts:50`
- Test: `frontend/__tests__/authGate.test.ts`

- [ ] **Step 1 : Écrire le test (qui échoue)**

Créer `frontend/__tests__/authGate.test.ts` :
```ts
import { isPublicPath, isPlatformPublicPath } from '@/lib/authGate';

describe('authGate', () => {
  it('isPublicPath : `/` n\'est PAS public (hôte club inchangé)', () => {
    expect(isPublicPath('/')).toBe(false);
  });
  it('isPlatformPublicPath : `/` est public (vitrine plateforme)', () => {
    expect(isPlatformPublicPath('/')).toBe(true);
  });
  it('isPlatformPublicPath hérite des chemins publics existants', () => {
    expect(isPlatformPublicPath('/tarifs')).toBe(true);
    expect(isPlatformPublicPath('/me/reservations')).toBe(false);
  });
});
```

- [ ] **Step 2 : Lancer → échec**

Run : `cd frontend && npx jest authGate`
Expected : FAIL (`isPlatformPublicPath` n'existe pas).

- [ ] **Step 3 : Ajouter `isPlatformPublicPath`**

Dans `frontend/lib/authGate.ts`, après la fonction `isPublicPath`, ajouter :
```ts
/** true si le chemin est accessible sans login sur l'HÔTE PLATEFORME (la racine `/` = vitrine
 * marketing, en plus des pages publiques communes). N'affecte PAS les sous-domaines club. */
export function isPlatformPublicPath(pathname: string): boolean {
  return pathname === '/' || isPublicPath(pathname);
}
```

- [ ] **Step 4 : Utiliser le helper dans `proxy.ts`**

Dans `frontend/proxy.ts`, modifier l'import (ligne 2) :
```ts
import { isPublicPath, isPlatformPublicPath } from './lib/authGate';
```
Puis, dans la branche hôte plateforme (`if (!slug)`), remplacer la ligne 50 :
```ts
    if (!token && !isPublicPath(url.pathname)) return redirectToLogin();
```
par :
```ts
    if (!token && !isPlatformPublicPath(url.pathname)) return redirectToLogin();
```
> ⚠️ Ne PAS toucher la ligne de la branche hôte club (qui garde `isPublicPath`).

- [ ] **Step 5 : Lancer → succès + compile**

Run : `cd frontend && npx jest authGate && npx tsc --noEmit`
Expected : PASS.

- [ ] **Step 6 : Commit**

```bash
git add frontend/lib/authGate.ts frontend/proxy.ts frontend/__tests__/authGate.test.ts
git commit -m "feat(proxy): la racine palova.fr est publique (host-aware), hote club inchange"
```

---

## Task 10 : `ClubDirectory` — bouton « Autour de moi »

**Files:**
- Modify: `frontend/jest.setup.ts` (stub géoloc)
- Modify: `frontend/components/ClubDirectory.tsx`
- Test: `frontend/__tests__/ClubDirectory.test.tsx`

- [ ] **Step 1 : Stub `navigator.geolocation` (jsdom)**

À la fin de `frontend/jest.setup.ts`, ajouter :
```ts
// jsdom n'implémente pas la géolocalisation : stub par défaut « refuse » (les tests
// qui veulent un succès surchargent navigator.geolocation.getCurrentPosition localement).
Object.defineProperty(global.navigator, 'geolocation', {
  configurable: true,
  value: { getCurrentPosition: (_ok: PositionCallback, err?: PositionErrorCallback) => err?.({ code: 1 } as GeolocationPositionError) },
});
```

- [ ] **Step 2 : Écrire le test (qui échoue)**

Le fichier `frontend/__tests__/ClubDirectory.test.tsx` existe déjà : il mocke `@/lib/api` (jest.fn locale `listClubs`), `useAuth`, `next/navigation`, et expose un helper `wrap = () => render(<ThemeProvider><ClubDirectory /></ThemeProvider>)`.

1. Élargir l'import de `@testing-library/react` (ligne 1) pour inclure `screen` et `fireEvent` :
```ts
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
```
2. Ajouter ce cas (il s'appuie sur le `listClubs` jest.fn local du fichier et sur `wrap()`) :
```ts
it('« Autour de moi » relance listClubs avec lat/lng', async () => {
  const ok = (cb: PositionCallback) => cb({ coords: { latitude: 48.86, longitude: 2.35 } } as GeolocationPosition);
  Object.defineProperty(global.navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: ok } });

  wrap();
  fireEvent.click(await screen.findByRole('button', { name: /autour de moi/i }));

  await waitFor(() =>
    expect(listClubs).toHaveBeenCalledWith(expect.objectContaining({ lat: 48.86, lng: 2.35 })),
  );
});
```

- [ ] **Step 3 : Lancer → échec**

Run : `cd frontend && npx jest ClubDirectory`
Expected : FAIL (pas de bouton « Autour de moi »).

- [ ] **Step 4 : Implémenter dans `ClubDirectory.tsx`**

Ajouter un état coords + un bouton, et passer les coords à `load` :
1. Après `const [sport, setSport] = useState('');`, ajouter :
```ts
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [geoState, setGeoState] = useState<'idle' | 'locating' | 'denied'>('idle');
```
2. Dans le `useCallback load`, passer les coords et ajouter `coords` aux deps :
```ts
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setClubs(await api.listClubs({
        q: q || undefined, city: city || undefined, sport: sport || undefined,
        ...(coords ? { lat: coords.lat, lng: coords.lng } : {}),
      }));
    } catch { setClubs([]); }
    finally { setLoading(false); }
  }, [q, city, sport, coords]);
```
3. Ajouter le handler géoloc :
```ts
  const locateMe = () => {
    if (!navigator.geolocation) { setGeoState('denied'); return; }
    setGeoState('locating');
    navigator.geolocation.getCurrentPosition(
      (p) => { setCoords({ lat: p.coords.latitude, lng: p.coords.longitude }); setGeoState('idle'); },
      () => setGeoState('denied'),
      { timeout: 8000 },
    );
  };
```
4. Changer le placeholder du champ ville en `"Ville ou région"`, et ajouter le bouton sous la rangée des chips de sport :
```tsx
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={locateMe} style={chipBtn(th, !!coords)}>
            📍 {coords ? 'Autour de moi ✓' : geoState === 'locating' ? 'Localisation…' : 'Autour de moi'}
          </button>
          {geoState === 'denied' && (
            <span style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textFaint }}>
              Localisation indisponible — cherchez par ville ou région.
            </span>
          )}
        </div>
```
(placer ce bloc juste après le `<div>` des chips de sport, à l'intérieur du conteneur « recherche ».)

- [ ] **Step 5 : Lancer → succès**

Run : `cd frontend && npx jest ClubDirectory`
Expected : PASS.

- [ ] **Step 6 : Commit**

```bash
git add frontend/jest.setup.ts frontend/components/ClubDirectory.tsx frontend/__tests__/ClubDirectory.test.tsx
git commit -m "feat(annuaire): bouton Autour de moi (geoloc) + recherche ville-ou-region"
```

---

## Task 11 : `AnonymousView` — la vitrine visiteur

**Files:**
- Create: `frontend/components/platform/AnonymousView.tsx`
- Test: `frontend/__tests__/AnonymousView.test.tsx`

- [ ] **Step 1 : Écrire le test (qui échoue)**

Créer `frontend/__tests__/AnonymousView.test.tsx` (⚠️ envelopper dans `<ThemeProvider>` : `useTheme` lève une exception sinon) :
```tsx
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import AnonymousView from '@/components/platform/AnonymousView';

// ClubDirectory est mocké : AnonymousView n'a alors besoin que du thème.
jest.mock('@/components/ClubDirectory', () => ({ ClubDirectory: () => <div data-testid="club-directory" /> }));

const wrap = () => render(<ThemeProvider><AnonymousView /></ThemeProvider>);

describe('AnonymousView', () => {
  it('rend le hero, l\'annuaire et le pitch club', () => {
    wrap();
    expect(screen.getByText(/Trouvez un terrain/i)).toBeInTheDocument();
    expect(screen.getByTestId('club-directory')).toBeInTheDocument();
    expect(screen.getByText(/Vous gérez un club/i)).toBeInTheDocument();
  });

  it('le CTA « Découvrir » pointe vers /offres et « Connexion » vers /login', () => {
    wrap();
    expect(screen.getByRole('link', { name: /Connexion/i })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: /Découvrir/i })).toHaveAttribute('href', '/offres');
  });
});
```

- [ ] **Step 2 : Lancer → échec**

Run : `cd frontend && npx jest AnonymousView`
Expected : FAIL (module absent).

- [ ] **Step 3 : Implémenter `AnonymousView.tsx`**

Créer `frontend/components/platform/AnonymousView.tsx` :
```tsx
'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { Screen } from '@/components/ui/Screen';
import { Logotype, ThemeToggle } from '@/components/ui/atoms';
import { ClubDirectory } from '@/components/ClubDirectory';

// Vitrine publique de palova.fr (visiteur non connecté). Joueur-d'abord, ambiance éditoriale claire.
// Les sections « Parties » et « Tournois » sont des emplacements (chantiers 3 et 2).
export default function AnonymousView() {
  const { th } = useTheme();
  return (
    <Screen>
      <div style={{ paddingBottom: 56 }}>
        {/* Nav */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '24px 24px 0' }}>
          <Logotype size={26} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ThemeToggle />
            <a href="/login" style={linkPill(th)}>Connexion</a>
          </div>
        </div>

        {/* Hero */}
        <div style={{ padding: '28px 24px 8px' }}>
          <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 40, lineHeight: 1.03, letterSpacing: -1, color: th.text, margin: 0 }}>
            Trouvez un terrain,<br />une partie, un tournoi.
          </h1>
          <p style={{ fontFamily: th.fontUI, fontSize: 16, color: th.textMute, marginTop: 14, lineHeight: 1.5, maxWidth: 520 }}>
            Le padel près de chez vous — réservez, rejoignez une partie ouverte, inscrivez-vous aux tournois.
          </p>
          <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textFaint, marginTop: 10, fontWeight: 600 }}>
            Des clubs partout en France
          </div>
        </div>

        {/* Recherche + annuaire (réutilise ClubDirectory : recherche + « Autour de moi ») */}
        <SectionTitle th={th}>Clubs près de chez vous</SectionTitle>
        <ClubDirectory />

        {/* Emplacements chantiers 3 & 2 */}
        <SectionTitle th={th}>Parties ouvertes près de moi</SectionTitle>
        <SoonCard th={th} label="Les parties ouvertes près de chez vous arrivent bientôt." />
        <SectionTitle th={th}>📅 Le calendrier des tournois</SectionTitle>
        <SoonCard th={th} label="Le calendrier des tournois de tous les clubs arrive bientôt." />

        {/* Bandeau B2B */}
        <div style={{ margin: '34px 20px 0', borderRadius: 22, background: th.ink, color: th.mode === 'floodlit' ? th.text : '#f7f5ee', padding: '26px 22px', textAlign: 'center' }}>
          <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 26, letterSpacing: -0.4 }}>Vous gérez un club ?</div>
          <p style={{ fontFamily: th.fontUI, fontSize: 14.5, opacity: 0.82, marginTop: 8, lineHeight: 1.5 }}>
            Réservations, caisse, tournois, membres — tout au même endroit.
          </p>
          <a href="/offres" style={{ display: 'inline-block', marginTop: 16, background: th.mode === 'floodlit' ? th.text : '#f7f5ee', color: th.ink, borderRadius: 30, padding: '11px 22px', fontFamily: th.fontUI, fontWeight: 800, fontSize: 14.5, textDecoration: 'none' }}>
            Découvrir Palova pour les clubs →
          </a>
        </div>

        {/* Fonctionnalités club */}
        <SectionTitle th={th}>Ce que Palova fait pour votre club</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, padding: '4px 20px 0' }}>
          {[
            { t: 'Réservation & planning', e: '📆' },
            { t: 'Caisse & carnets', e: '💳' },
            { t: 'Tournois & events', e: '🏆' },
          ].map((f) => (
            <div key={f.t} style={{ background: th.surface, borderRadius: 16, padding: '16px 14px', boxShadow: `inset 0 0 0 1px ${th.line}` }}>
              <div style={{ fontSize: 22 }}>{f.e}</div>
              <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 14.5, color: th.text, marginTop: 8 }}>{f.t}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', padding: '16px 20px 0', fontFamily: th.fontUI, fontWeight: 700, fontSize: 14.5 }}>
          <a href="/tarifs" style={{ color: th.text }}>Voir les tarifs →</a>
          <a href="/clubs/new" style={{ color: th.text }}>Créer mon club →</a>
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center', padding: '40px 20px 0', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.textMute }}>
          {[['FAQ', '/faq'], ['Tarifs', '/tarifs'], ['CGV', '/cgv'], ['Mentions légales', '/mentions-legales'], ['Confidentialité', '/confidentialite']].map(([t, h]) => (
            <a key={h} href={h} style={{ color: th.textMute, textDecoration: 'none' }}>{t}</a>
          ))}
        </div>
      </div>
    </Screen>
  );
}

function SectionTitle({ children, th }: { children: React.ReactNode; th: ReturnType<typeof useTheme>['th'] }) {
  return (
    <div style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute, padding: '30px 20px 0' }}>
      {children}
    </div>
  );
}

function SoonCard({ label, th }: { label: string; th: ReturnType<typeof useTheme>['th'] }) {
  return (
    <div style={{ margin: '12px 20px 0', borderRadius: 16, padding: '18px 16px', background: th.surface2, color: th.textMute, fontFamily: th.fontUI, fontSize: 14, textAlign: 'center', boxShadow: `inset 0 0 0 1px ${th.line}` }}>
      {label} <span style={{ fontWeight: 700, color: th.textFaint }}>· Bientôt</span>
    </div>
  );
}

function linkPill(th: ReturnType<typeof useTheme>['th']): React.CSSProperties {
  return { background: th.ink, color: th.mode === 'floodlit' ? th.text : '#f7f5ee', borderRadius: 30, padding: '8px 16px', fontFamily: th.fontUI, fontWeight: 700, fontSize: 13, textDecoration: 'none' };
}
```
> Si un token de thème utilisé ici (`th.ink`, `th.surface2`, `th.line`, `th.mode`) n'existe pas exactement sous ce nom, l'aligner sur `lib/theme.ts` (mêmes tokens que `PlatformLanding`/`ClubCard`).

- [ ] **Step 4 : Lancer → succès**

Run : `cd frontend && npx jest AnonymousView`
Expected : PASS.

- [ ] **Step 5 : Commit**

```bash
git add frontend/components/platform/AnonymousView.tsx frontend/__tests__/AnonymousView.test.tsx
git commit -m "feat(accueil): vitrine visiteur AnonymousView (joueur-d'abord, editorial)"
```

---

## Task 12 : Dispatcher — router l'anonyme vers `AnonymousView`

**Files:**
- Modify: `frontend/components/PlatformLanding.tsx:18-33`
- Test: `frontend/__tests__/PlatformLanding.test.tsx`

- [ ] **Step 1 : Écrire le test (qui échoue)**

Créer `frontend/__tests__/PlatformLanding.test.tsx` (envelopper dans `<ThemeProvider>` par sécurité — le squelette utilise `useTheme`) :
```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import PlatformLanding from '@/components/PlatformLanding';

const replace = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));
jest.mock('@/components/platform/AnonymousView', () => ({ __esModule: true, default: () => <div data-testid="anon" /> }));
jest.mock('@/lib/api', () => ({ api: { getMyClubs: jest.fn(), getMyMemberships: jest.fn() }, assetUrl: (u: string) => u }));

const useAuthMock = jest.fn();
jest.mock('@/lib/useAuth', () => ({ useAuth: () => useAuthMock() }));

const wrap = () => render(<ThemeProvider><PlatformLanding /></ThemeProvider>);

describe('PlatformLanding (dispatch anonyme)', () => {
  beforeEach(() => { replace.mockReset(); });

  it('visiteur non connecté → AnonymousView, jamais de redirection /login', async () => {
    useAuthMock.mockReturnValue({ token: null, ready: true });
    wrap();
    expect(await screen.findByTestId('anon')).toBeInTheDocument();
    await waitFor(() => expect(replace).not.toHaveBeenCalled());
  });
});
```

- [ ] **Step 2 : Lancer → échec**

Run : `cd frontend && npx jest PlatformLanding`
Expected : FAIL (le code actuel redirige `!token` vers `/login`).

- [ ] **Step 3 : Modifier le dispatcher**

Dans `frontend/components/PlatformLanding.tsx` :

1. Ajouter l'import :
```ts
import AnonymousView from '@/components/platform/AnonymousView';
```
2. Remplacer le `useEffect` (lignes ~23-27) par (ne plus rediriger, ne fetch que si token) :
```ts
  useEffect(() => {
    if (!ready || !token) return;                 // visiteur → AnonymousView (pas de fetch)
    api.getMyClubs(token).then(setManaged).catch(() => setManaged([]));
  }, [ready, token]);
```
3. Remplacer le bloc de dispatch (lignes ~30-32) par :
```ts
  if (!ready) return <PlatformSkeleton />;
  if (!token) return <AnonymousView />;
  if (managed === null) return <PlatformSkeleton />; // rôle en cours de résolution
  if (managed.length > 0) return <ManagerView clubs={managed} />;
  return <PlayerView token={token} />;
```

- [ ] **Step 4 : Lancer → succès + non-régression**

Run : `cd frontend && npx jest PlatformLanding ClubDirectory AnonymousView`
Expected : PASS.

- [ ] **Step 5 : Commit**

```bash
git add frontend/components/PlatformLanding.tsx frontend/__tests__/PlatformLanding.test.tsx
git commit -m "feat(accueil): l'anonyme voit la vitrine (plus de redirection /login)"
```

---

## Task 13 : Vérification d'ensemble

- [ ] **Step 1 : Suites complètes**

Run :
```bash
cd backend && npx jest
cd ../frontend && npx jest
```
Expected : PASS (back + front).

- [ ] **Step 2 : Compilation**

Run :
```bash
npx tsc --noEmit -p backend/tsconfig.json
cd frontend && npx tsc --noEmit
```
Expected : PASS.

- [ ] **Step 3 : Vérification manuelle (cf. spec § Vérification)**

1. Docker up, backend + frontend, `npx ts-node backend/scripts/geocode-clubs.ts`.
2. `curl "http://localhost:3001/api/clubs?lat=48.86&lng=2.35"` → tri distance ; `?city=Paris` → matche ville/région.
3. Hôte plateforme `localhost:3000` **sans cookie token** : `/` rend la vitrine (plus de redirection `/login`), « Autour de moi » trie par distance (ou repli texte si refus), bandeau + fonctionnalités → `/offres` `/tarifs` `/clubs/new`.
4. Joueur connecté : `/` rend ses clubs + annuaire (« Autour de moi » présent). Gérant : boutons admin. Anti-flash conservé.
5. Non-régression : `<slug>.localhost:3000/` rend toujours le Club-house ; un sous-domaine club anonyme garde son comportement (inchangé) ; `/clubs` et `/reserver` OK.

- [ ] **Step 4 : Commit final éventuel** (si ajustements)

```bash
git add -A
git commit -m "test(accueil): verification d'ensemble fondation"
```

---

## Auto-revue (couverture spec)

- **Déverrouillage host-aware** → Task 9 (`isPlatformPublicPath` + `proxy.ts`, hôte club intact). ✅
- **AnonymousView joueur-d'abord, éditorial clair** → Task 11 (hero + recherche + emplacements + B2B + footer). ✅
- **Couche géo** : modèle (Task 1), géocodage BAN (Task 2), create/update (Tasks 4-5), backfill (Task 7), filtres/tri (Task 3, 6). ✅
- **« Autour de moi » / par région** → Task 10 (géoloc + ville-ou-région) ; Task 8 (types). ✅
- **Emplacements Parties (chantier 3) / Tournois (chantier 2)** → Task 11 (cartes « Bientôt »). ✅
- **Adaptatif Joueur/Gérant conservés** → Task 12 (dispatch ; PlayerView/ManagerView inchangés, l'annuaire du joueur hérite du bouton géoloc via ClubDirectory). ✅
- **Tests** : geo.service, club.service (filtres + géocodage), platform.service, authGate, ClubDirectory, AnonymousView, PlatformLanding. ✅
