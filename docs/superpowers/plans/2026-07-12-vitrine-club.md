# Vitrine club immersive — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer la carte « Le club » du Club-house par une scène « cinéma » immersive (photo + voile + chips auto) avec bande « Sur place », et refondre la page `/club` dans le même langage, avec 2 nouveaux champs auto-gérés (`foundedYear`, `amenities`).

**Architecture:** Backend minimal — migration additive sur `Club` + `PresentationService` étendu (le nb de pistes, l'indoor et les horaires se dérivent **côté client** depuis `ClubDetail.clubSports[].resources` déjà exposé : `openHour/closeHour/attributes.coverage` — écart de simplification vs la spec qui prévoyait de les ajouter au payload présentation). Frontend : helpers purs `lib/clubShowcase.ts` (testés), composant `ClubShowcase` (remplace `ClubPresentationCard`), refonte `app/club/page.tsx`, champs admin dans `/admin/club`, 9 icônes ajoutées.

**Tech Stack:** Express 5 + Prisma 7 (adapter pg), Next.js 16 + React 19, Jest (ts-jest, ne type-check pas → `tsc --noEmit` séparé), styles inline + `<style>` media queries (pattern maison).

**Spec:** `docs/superpowers/specs/2026-07-12-vitrine-club-design.md`

**Rappels environnement (mémoire projet):**
- Shims `.bin` cassés : `node node_modules/jest/bin/jest.js` et `node node_modules/typescript/bin/tsc` (jamais `npx jest`/`npx tsc`). Le cwd PowerShell se réinitialise à chaque commande → toujours préfixer `cd C:\ProjetsIA\05_PERSO\RESERVE\palova\backend;` (ou frontend).
- Migrations : JAMAIS `prisma migrate dev` (dérive de base dev) — SQL additif appliqué via `npx prisma db execute` + `npx prisma generate` (config lue depuis `prisma.config.ts`, lancer depuis `backend/`).
- L'utilisateur édite le repo en parallèle : avant chaque commit, `git status` et ne stager QUE les fichiers du lot.
- Suite complète frontend : flake BookingModal connu — vérifier par suites scoped.

---

### Task 1: Migration + schéma Prisma (`foundedYear`, `amenities`)

**Files:**
- Modify: `backend/prisma/schema.prisma` (model Club, après `showOffersPublicly` ~l.249)
- Create: `backend/prisma/migrations/20260712120000_add_club_showcase/migration.sql`

- [ ] **Step 1: Ajouter les colonnes au schéma**

Dans `model Club`, juste après la ligne `showOffersPublicly` :

```prisma
  // Vitrine club : année de création (kicker « Depuis 2021 ») + équipements cochés
  // (catalogue fermé AMENITY_KEYS — presentation.service, miroir front lib/clubShowcase).
  foundedYear Int?     @map("founded_year")
  amenities   String[] @default([]) @map("amenities")
```

- [ ] **Step 2: Écrire la migration SQL additive**

`backend/prisma/migrations/20260712120000_add_club_showcase/migration.sql` :

```sql
-- Vitrine club : année de création + équipements (catalogue fermé)
ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "founded_year" INTEGER;
ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "amenities" TEXT[] NOT NULL DEFAULT '{}';
```

- [ ] **Step 3: Appliquer en DEV + régénérer le client**

```powershell
cd C:\ProjetsIA\05_PERSO\RESERVE\palova\backend; npx prisma db execute --file prisma/migrations/20260712120000_add_club_showcase/migration.sql
cd C:\ProjetsIA\05_PERSO\RESERVE\palova\backend; npx prisma generate
```

Expected: `Script executed` puis `Generated Prisma Client`. (Prod plus tard : `prisma migrate deploy`.)

- [ ] **Step 4: Commit**

```powershell
git add backend/prisma/schema.prisma backend/prisma/migrations/20260712120000_add_club_showcase/migration.sql
git commit -m "feat(club): colonnes founded_year + amenities (migration additive add_club_showcase)"
```

---

### Task 2: PresentationService — catalogue, validation, exposition (TDD)

**Files:**
- Modify: `backend/src/services/presentation.service.ts`
- Test: `backend/src/services/__tests__/presentation.service.test.ts`

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter au `describe('PresentationService')` existant (et importer `normalizeAmenities` en tête) :

```ts
import { PresentationService, normalizeAmenities } from '../presentation.service';

  it('normalizeAmenities filtre les clés inconnues, déduplique, réordonne selon le catalogue', () => {
    expect(normalizeAmenities(['parking', 'bar', 'spa', 'bar'])).toEqual(['bar', 'parking']);
    expect(normalizeAmenities('nope')).toEqual([]);
    expect(normalizeAmenities(undefined)).toEqual([]);
  });

  it('updateText persiste foundedYear + amenities normalisés', async () => {
    prismaMock.club.update.mockResolvedValue({} as any);
    prismaMock.club.findUniqueOrThrow.mockResolvedValue({ presentationText: null, contactPhone: null, contactEmail: null, openingHoursText: null, coverImageUrl: null, foundedYear: 2021, amenities: ['bar'] } as any);
    prismaMock.clubPhoto.findMany.mockResolvedValue([] as any);
    await service.updateText('c1', { foundedYear: 2021, amenities: ['parking', 'spa', 'bar'] });
    expect(prismaMock.club.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ foundedYear: 2021, amenities: ['bar', 'parking'] }),
    }));
  });

  it('updateText refuse une année hors bornes (VALIDATION_ERROR)', async () => {
    await expect(service.updateText('c1', { foundedYear: 1850 })).rejects.toThrow('VALIDATION_ERROR');
    await expect(service.updateText('c1', { foundedYear: 2.5 as any })).rejects.toThrow('VALIDATION_ERROR');
  });

  it('getPublic expose foundedYear + amenities', async () => {
    prismaMock.club.findUnique.mockResolvedValue({
      id: 'c1', status: 'ACTIVE', presentationText: null, coverImageUrl: null,
      address: '1 rue', city: 'Paris', latitude: null, longitude: null,
      contactPhone: null, contactEmail: null, openingHoursText: null,
      foundedYear: 2021, amenities: ['bar'],
    } as any);
    prismaMock.clubPhoto.findMany.mockResolvedValue([] as any);
    const r = await service.getPublic('slug');
    expect(r.foundedYear).toBe(2021);
    expect(r.amenities).toEqual(['bar']);
  });
```

- [ ] **Step 2: Vérifier l'échec**

```powershell
cd C:\ProjetsIA\05_PERSO\RESERVE\palova\backend; node node_modules/jest/bin/jest.js src/services/__tests__/presentation.service.test.ts
```

Expected: FAIL (`normalizeAmenities` n'existe pas).

- [ ] **Step 3: Implémenter**

Dans `presentation.service.ts` :

```ts
/** Catalogue fermé des équipements « Sur place » — miroir front : frontend/lib/clubShowcase.ts. */
export const AMENITY_KEYS = ['bar', 'shop', 'lockers', 'parking', 'rental', 'terrace', 'wifi', 'coaching'] as const;

/** Filtre les clés inconnues, déduplique et réordonne selon le catalogue. */
export function normalizeAmenities(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const set = new Set(input.filter((k): k is string => typeof k === 'string'));
  return AMENITY_KEYS.filter((k) => set.has(k));
}

function normFoundedYear(v: number | null): number | null {
  if (v === null) return null;
  if (!Number.isInteger(v) || v < 1900 || v > new Date().getFullYear() + 1) throw new Error('VALIDATION_ERROR');
  return v;
}
```

- `getPublic` : ajouter `foundedYear: true, amenities: true` au `select` du `club.findUnique`.
- `getAdmin` : idem dans son `select`.
- `updateText` : élargir la signature et le `data` :

```ts
  async updateText(clubId: string, data: {
    presentationText?: string | null; contactPhone?: string | null; contactEmail?: string | null;
    openingHoursText?: string | null; foundedYear?: number | null; amenities?: string[];
  }) {
    const norm = (v: string | null | undefined) => (v === undefined ? undefined : (v?.trim() || null));
    await prisma.club.update({
      where: { id: clubId },
      data: {
        ...(data.presentationText !== undefined ? { presentationText: norm(data.presentationText) } : {}),
        ...(data.contactPhone !== undefined ? { contactPhone: norm(data.contactPhone) } : {}),
        ...(data.contactEmail !== undefined ? { contactEmail: norm(data.contactEmail) } : {}),
        ...(data.openingHoursText !== undefined ? { openingHoursText: norm(data.openingHoursText) } : {}),
        ...(data.foundedYear !== undefined ? { foundedYear: normFoundedYear(data.foundedYear) } : {}),
        ...(data.amenities !== undefined ? { amenities: normalizeAmenities(data.amenities) } : {}),
      },
    });
    return this.getAdmin(clubId);
  }
```

(La route `PATCH /admin/presentation` passe déjà `req.body` tel quel — aucun changement de route. `VALIDATION_ERROR` est mappé 400 par `handleError`.)

- [ ] **Step 4: Vérifier le vert**

```powershell
cd C:\ProjetsIA\05_PERSO\RESERVE\palova\backend; node node_modules/jest/bin/jest.js src/services/__tests__/presentation.service.test.ts
```

Expected: PASS (7 tests).

- [ ] **Step 5: tsc backend + commit**

```powershell
cd C:\ProjetsIA\05_PERSO\RESERVE\palova\backend; node node_modules/typescript/bin/tsc --noEmit
git add backend/src/services/presentation.service.ts backend/src/services/__tests__/presentation.service.test.ts
git commit -m "feat(club): PresentationService expose foundedYear + amenities (catalogue ferme, validation)"
```

---

### Task 3: Types front + helpers purs `lib/clubShowcase.ts` (TDD)

**Files:**
- Modify: `frontend/lib/api.ts` (interface `ClubPresentation` ~l.1902 ; `adminUpdatePresentation` ~l.591)
- Create: `frontend/lib/clubShowcase.ts`
- Test: `frontend/__tests__/clubShowcase.test.ts`

- [ ] **Step 1: Types api.ts**

Dans `ClubPresentation`, ajouter :

```ts
  foundedYear: number | null;
  amenities: string[];
```

Et élargir le `Pick` d'`adminUpdatePresentation` :

```ts
  adminUpdatePresentation: (clubId: string, body: Partial<Pick<ClubPresentation, 'presentationText' | 'contactPhone' | 'contactEmail' | 'openingHoursText' | 'foundedYear' | 'amenities'>>, token: string) =>
```

- [ ] **Step 2: Écrire les tests des helpers (échec attendu)**

`frontend/__tests__/clubShowcase.test.ts` :

```ts
import {
  AMENITIES, amenityList, showcaseKicker, courtsSummary, courtsChipLabel,
  hoursRange, openNowChip, coverUrl, railPhotos, showShowcase,
} from '@/lib/clubShowcase';
import type { ClubPresentation, ClubSportPublic } from '@/lib/api';

const cs = (key: string, resources: { coverage?: string; openHour?: number; closeHour?: number }[]): ClubSportPublic => ({
  id: `cs-${key}`, slotStepMin: null, durationsMin: [],
  sport: { id: `s-${key}`, key, name: key === 'padel' ? 'Padel' : 'Tennis' } as any,
  resources: resources.map((r, i) => ({
    id: `r${i}`, name: `R${i}`, attributes: r.coverage ? { coverage: r.coverage } : {},
    price: '25', openHour: r.openHour ?? 8, closeHour: r.closeHour ?? 22,
  })) as any,
});

const pres = (over: Partial<ClubPresentation> = {}): ClubPresentation => ({
  presentationText: null, coverImageUrl: null, address: '1 rue', city: 'Paris',
  latitude: null, longitude: null, contactPhone: null, contactEmail: null,
  openingHoursText: null, foundedYear: null, amenities: [], photos: [], ...over,
});

const photo = (id: string) => ({ id, url: `/uploads/club-photos/${id}.jpg`, caption: null, sortOrder: 0 });

describe('clubShowcase helpers', () => {
  it('showcaseKicker assemble ville · Depuis année (segments absents omis)', () => {
    expect(showcaseKicker('Paris', 2021)).toBe('Paris · Depuis 2021');
    expect(showcaseKicker(null, 2021)).toBe('Depuis 2021');
    expect(showcaseKicker('Paris', null)).toBe('Paris');
    expect(showcaseKicker(null, null)).toBeNull();
  });

  it('courtsChipLabel : padel « pistes » + indoor, autre sport « terrains », multi-sport total sans indoor', () => {
    expect(courtsChipLabel(courtsSummary([cs('padel', [{ coverage: 'indoor' }, { coverage: 'indoor' }, {}])]))).toBe('3 pistes · 2 indoor');
    expect(courtsChipLabel(courtsSummary([cs('tennis', [{}])]))).toBe('1 terrain');
    expect(courtsChipLabel(courtsSummary([cs('padel', [{}, {}]), cs('tennis', [{}])]))).toBe('3 terrains');
    expect(courtsChipLabel(courtsSummary([]))).toBeNull();
    expect(courtsChipLabel(courtsSummary(undefined))).toBeNull();
  });

  it('hoursRange agrège min open / max close ; null sans ressource', () => {
    expect(hoursRange([cs('padel', [{ openHour: 9, closeHour: 21 }, { openHour: 8, closeHour: 23 }])])).toEqual({ open: 8, close: 23 });
    expect(hoursRange([])).toBeNull();
  });

  it('openNowChip : ouvert/fermé au fuseau du club, null sans horloge', () => {
    const h = { open: 8, close: 22 };
    expect(openNowChip(h, 'Europe/Paris', new Date('2026-07-12T10:00:00Z'))).toEqual({ open: true, label: "Ouvert · jusqu'à 22h" });
    expect(openNowChip(h, 'Europe/Paris', new Date('2026-07-12T03:00:00Z'))).toEqual({ open: false, label: 'Ouvre à 8h' });
    expect(openNowChip(h, 'Europe/Paris', null)).toBeNull();
    expect(openNowChip(null, 'Europe/Paris', new Date())).toBeNull();
  });

  it('coverUrl : coverImageUrl sinon 1re photo sinon null', () => {
    expect(coverUrl(pres({ coverImageUrl: '/uploads/c.jpg', photos: [photo('a')] }))).toBe('/uploads/c.jpg');
    expect(coverUrl(pres({ photos: [photo('a')] }))).toBe('/uploads/club-photos/a.jpg');
    expect(coverUrl(pres())).toBeNull();
  });

  it('railPhotos : ≤ 2 tuiles hors cover + compteur du reste', () => {
    const p = pres({ photos: [photo('a'), photo('b'), photo('c'), photo('d')] }); // a = cover implicite
    expect(railPhotos(p).tiles.map((t) => t.id)).toEqual(['b', 'c']);
    expect(railPhotos(p).more).toBe(1);
    expect(railPhotos(pres({ photos: [photo('a')] }))).toEqual({ tiles: [], more: 0 });
  });

  it('showShowcase : visible dès qu'une info propre existe, sinon masqué', () => {
    expect(showShowcase(null)).toBe(false);
    expect(showShowcase(pres())).toBe(false);
    expect(showShowcase(pres({ presentationText: 'x' }))).toBe(true);
    expect(showShowcase(pres({ photos: [photo('a')] }))).toBe(true);
    expect(showShowcase(pres({ amenities: ['bar'] }))).toBe(true);
    expect(showShowcase(pres({ foundedYear: 2021 }))).toBe(true);
  });

  it('amenityList mappe les clés vers le catalogue (8 entrées, ordre canonique)', () => {
    expect(AMENITIES).toHaveLength(8);
    expect(amenityList(['parking', 'bar']).map((a) => a.key)).toEqual(['bar', 'parking']);
    expect(amenityList(undefined)).toEqual([]);
  });
});
```

- [ ] **Step 3: Vérifier l'échec**

```powershell
cd C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend; node node_modules/jest/bin/jest.js __tests__/clubShowcase.test.ts
```

Expected: FAIL (module inexistant).

- [ ] **Step 4: Implémenter `frontend/lib/clubShowcase.ts`**

```ts
// Helpers purs de la vitrine « Le club » (Club-house + page /club).
// Catalogue AMENITIES : miroir backend de AMENITY_KEYS (presentation.service.ts) — garder synchro.
import { ClubPhoto, ClubPresentation, ClubSportPublic } from '@/lib/api';
import type { IconName } from '@/components/ui/Icon';

export interface Amenity { key: string; label: string; icon: IconName }

export const AMENITIES: Amenity[] = [
  { key: 'bar', label: 'Bar & cuisine', icon: 'cup' },
  { key: 'shop', label: 'Boutique', icon: 'cart' },
  { key: 'lockers', label: 'Vestiaires & douches', icon: 'shower' },
  { key: 'parking', label: 'Parking', icon: 'parking' },
  { key: 'rental', label: 'Location de matériel', icon: 'racket' },
  { key: 'terrace', label: 'Terrasse', icon: 'parasol' },
  { key: 'wifi', label: 'Wi-Fi', icon: 'wifi' },
  { key: 'coaching', label: 'Cours & coaching', icon: 'whistle' },
];

export function amenityList(keys: string[] | null | undefined): Amenity[] {
  if (!keys?.length) return [];
  return AMENITIES.filter((a) => keys.includes(a.key));
}

/** Kicker « Paris 11ᵉ · Depuis 2021 » — segments absents omis, null si vide. */
export function showcaseKicker(city: string | null | undefined, foundedYear: number | null | undefined): string | null {
  const parts = [city, foundedYear ? `Depuis ${foundedYear}` : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

export interface CourtsSummary { total: number; indoor: number; multiSport: boolean; padel: boolean }

export function courtsSummary(clubSports: ClubSportPublic[] | null | undefined): CourtsSummary | null {
  const withCourts = (clubSports ?? []).filter((s) => s.resources.length > 0);
  const total = withCourts.reduce((n, s) => n + s.resources.length, 0);
  if (total === 0) return null;
  const indoor = withCourts.reduce((n, s) => n + s.resources.filter((r) => r.attributes?.coverage === 'indoor').length, 0);
  return { total, indoor, multiSport: withCourts.length > 1, padel: withCourts.length === 1 && withCourts[0].sport.key === 'padel' };
}

/** « 3 pistes · 2 indoor » (padel) / « 2 terrains » (autre) / « 5 terrains » (multi-sport, sans indoor). */
export function courtsChipLabel(s: CourtsSummary | null): string | null {
  if (!s) return null;
  const noun = !s.multiSport && s.padel ? 'piste' : 'terrain';
  const base = `${s.total} ${noun}${s.total > 1 ? 's' : ''}`;
  return !s.multiSport && s.indoor > 0 ? `${base} · ${s.indoor} indoor` : base;
}

export interface HoursRange { open: number; close: number }

export function hoursRange(clubSports: ClubSportPublic[] | null | undefined): HoursRange | null {
  const res = (clubSports ?? []).flatMap((s) => s.resources);
  if (res.length === 0) return null;
  return { open: Math.min(...res.map((r) => r.openHour)), close: Math.max(...res.map((r) => r.closeHour)) };
}

/** Chip horaires vivante — `now` null (avant hydration) → null, jamais de new Date() au rendu. */
export function openNowChip(hours: HoursRange | null, timezone: string, now: Date | null): { open: boolean; label: string } | null {
  if (!hours || !now) return null;
  const h = Number(new Intl.DateTimeFormat('fr-FR', { hour: 'numeric', hourCycle: 'h23', timeZone: timezone }).format(now));
  const open = h >= hours.open && h < hours.close;
  return open ? { open: true, label: `Ouvert · jusqu'à ${hours.close}h` } : { open: false, label: `Ouvre à ${hours.open}h` };
}

export function coverUrl(p: ClubPresentation): string | null {
  return p.coverImageUrl ?? p.photos[0]?.url ?? null;
}

/** Rail desktop : ≤ 2 tuiles (hors cover) + compteur du reste. */
export function railPhotos(p: ClubPresentation): { tiles: ClubPhoto[]; more: number } {
  const cover = coverUrl(p);
  const rest = p.photos.filter((ph) => ph.url !== cover);
  return { tiles: rest.slice(0, 2), more: Math.max(0, rest.length - 2) };
}

/** La section n'apparaît que si le club a AU MOINS une info propre à montrer. */
export function showShowcase(p: ClubPresentation | null): p is ClubPresentation {
  if (!p) return false;
  return !!(p.presentationText || p.coverImageUrl || p.photos.length > 0 || (p.amenities?.length ?? 0) > 0 || p.foundedYear);
}
```

- [ ] **Step 5: Vérifier le vert (les icônes n'existent pas encore → seul tsc râlera, pas jest)**

```powershell
cd C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend; node node_modules/jest/bin/jest.js __tests__/clubShowcase.test.ts
```

Expected: PASS (8 tests). (`IconName` invalides = erreur de type, pas d'exécution — Task 4 la lève.)

- [ ] **Step 6: Commit**

```powershell
git add frontend/lib/api.ts frontend/lib/clubShowcase.ts frontend/__tests__/clubShowcase.test.ts
git commit -m "feat(clubhouse): helpers purs vitrine club (kicker, chips pistes/horaires, rail, visibilite)"
```

---

### Task 4: 9 icônes ligne (`Icon.tsx`)

**Files:**
- Modify: `frontend/components/ui/Icon.tsx`

- [ ] **Step 1: Ajouter les noms à l'union `IconName`**

```ts
  | 'cup' | 'cart' | 'shower' | 'parking' | 'racket' | 'parasol' | 'wifi' | 'whistle' | 'camera';
```

- [ ] **Step 2: Ajouter les glyphes au `switch` (style ligne 1.7, viewBox 24)**

```tsx
    case 'cup': glyph = <><path d="M4.5 4.5h15L12 12.5v6" {...p} /><path d="M8.5 21h7" {...p} /><path d="M7 8h10" {...p} /></>; break;
    case 'cart': glyph = <><circle cx="9.5" cy="19.5" r="1.4" {...p} /><circle cx="17" cy="19.5" r="1.4" {...p} /><path d="M3.5 4.5h2l2.2 11h10.6l2.2-8H6.4" {...p} /></>; break;
    case 'shower': glyph = <><path d="M4.5 21V6a3 3 0 013-3h2.5" {...p} /><path d="M12 8.5a4.5 4.5 0 019 0z" {...p} /><path d="M13.5 12v.01M16.5 12v.01M19.5 12v.01M15 15.5v.01M18 15.5v.01" {...p} /></>; break;
    case 'parking': glyph = <><rect x="4" y="4" width="16" height="16" rx="3.5" {...p} /><path d="M9.5 17V7.5H13a2.75 2.75 0 010 5.5H9.5" {...p} /></>; break;
    case 'racket': glyph = <><circle cx="14.5" cy="9" r="6" {...p} /><path d="M10.3 13.2L4.5 19" {...p} /><path d="M11.5 5.5l6.5 6.5M9 8.5l6 6" {...p} /></>; break;
    case 'parasol': glyph = <><path d="M12 3.5a9 9 0 019 9H3a9 9 0 019-9z" {...p} /><path d="M12 12.5V19a2 2 0 002 2" {...p} /></>; break;
    case 'wifi': glyph = <><path d="M2.5 9.5a14 14 0 0119 0M5.5 13a9.5 9.5 0 0113 0M8.5 16.2a5 5 0 017 0" {...p} /><circle cx="12" cy="19.4" r="1" fill={color} stroke="none" /></>; break;
    case 'whistle': glyph = <><circle cx="9.5" cy="14" r="5.5" {...p} /><path d="M14.5 11.5L21 8.5v4.5l-6 1.5" {...p} /></>; break;
    case 'camera': glyph = <><rect x="3" y="7" width="18" height="13" rx="2.5" {...p} /><path d="M8.5 7l1.5-2.5h4L15.5 7" {...p} /><circle cx="12" cy="13.5" r="3.5" {...p} /></>; break;
```

- [ ] **Step 3: tsc + commit**

```powershell
cd C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend; node node_modules/typescript/bin/tsc --noEmit
git add frontend/components/ui/Icon.tsx
git commit -m "feat(ui): icones equipements club (cup/cart/shower/parking/racket/parasol/wifi/whistle/camera)"
```

Expected tsc: 0 erreur sur nos fichiers (ignorer d'éventuelles erreurs de WIP parallèle hors périmètre — scoper au grep des fichiers du lot).

---

### Task 5: Composant `ClubShowcase` + câblage ClubHouse (TDD)

**Files:**
- Create: `frontend/components/clubhouse/ClubShowcase.tsx`
- Delete: `frontend/components/clubhouse/ClubPresentationCard.tsx`, `frontend/__tests__/ClubPresentationCard.test.tsx`
- Modify: `frontend/components/ClubHouse.tsx` (import l.18, `showClubCard` l.119, section `clubCard` l.128-133)
- Test: Create `frontend/__tests__/ClubShowcase.test.tsx` ; Modify `frontend/__tests__/ClubHouse.test.tsx`

- [ ] **Step 1: Écrire `ClubShowcase.test.tsx` (échec attendu)**

```tsx
import { render, screen } from '@testing-library/react';
import { ClubShowcase } from '@/components/clubhouse/ClubShowcase';
import { ThemeProvider } from '@/lib/ThemeProvider';

jest.mock('@/lib/api', () => ({ ...jest.requireActual('@/lib/api'), assetUrl: (p: string | null) => p }));

const club = {
  id: 'c1', slug: 'arena', name: 'Padel Arena', address: '1 rue', city: 'Paris',
  timezone: 'Europe/Paris', logoUrl: null, accentColor: '#5e93da',
  clubSports: [{
    id: 'cs1', slotStepMin: null, durationsMin: [], sport: { id: 's1', key: 'padel', name: 'Padel' },
    resources: [
      { id: 'r1', name: 'P1', attributes: { coverage: 'indoor' }, price: '25', openHour: 8, closeHour: 22 },
      { id: 'r2', name: 'P2', attributes: {}, price: '25', openHour: 8, closeHour: 22 },
    ],
  }],
} as any;

const pres = {
  presentationText: 'Le plus beau club du 11e.', coverImageUrl: '/uploads/covers/c.jpg',
  address: '1 rue', city: 'Paris', latitude: null, longitude: null,
  contactPhone: null, contactEmail: null, openingHoursText: null,
  foundedYear: 2021, amenities: ['bar', 'parking'],
  photos: [
    { id: 'p1', url: '/uploads/club-photos/1.jpg', caption: null, sortOrder: 0 },
    { id: 'p2', url: '/uploads/club-photos/2.jpg', caption: 'Terrasse', sortOrder: 1 },
  ],
} as any;

const NOON = new Date('2026-07-12T10:00:00Z'); // 12h à Paris → ouvert (8-22)

describe('ClubShowcase', () => {
  it('scène photo : kicker, titre, chips pistes + horaires vivants, CTA, bande Sur place', () => {
    render(<ThemeProvider><ClubShowcase presentation={pres} club={club} now={NOON} /></ThemeProvider>);
    expect(screen.getByText('Paris · Depuis 2021')).toBeInTheDocument();
    expect(screen.getByText('Padel Arena')).toBeInTheDocument();
    expect(screen.getByText('2 pistes · 1 indoor')).toBeInTheDocument();
    expect(screen.getByText("Ouvert · jusqu'à 22h")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Découvrir Padel Arena/i })).toHaveAttribute('href', '/club');
    expect(screen.getByText('Bar & cuisine')).toBeInTheDocument();
    expect(screen.getByText('2 photos')).toBeInTheDocument();
  });

  it('sans horloge (now null) la chip horaires est absente — hydration-safe', () => {
    render(<ThemeProvider><ClubShowcase presentation={pres} club={club} now={null} /></ThemeProvider>);
    expect(screen.queryByText(/Ouvert ·/)).toBeNull();
  });

  it('repli brume bleue : aucune photo → aucune <img>, contenu intact', () => {
    const { container } = render(
      <ThemeProvider><ClubShowcase presentation={{ ...pres, coverImageUrl: null, photos: [] }} club={club} now={NOON} /></ThemeProvider>,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('Padel Arena')).toBeInTheDocument();
  });

  it('bande « Sur place » masquée si aucun équipement', () => {
    render(<ThemeProvider><ClubShowcase presentation={{ ...pres, amenities: [] }} club={club} now={NOON} /></ThemeProvider>);
    expect(screen.queryByText('Sur place')).toBeNull();
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

```powershell
cd C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend; node node_modules/jest/bin/jest.js __tests__/ClubShowcase.test.tsx
```

Expected: FAIL (composant inexistant).

- [ ] **Step 3: Créer `frontend/components/clubhouse/ClubShowcase.tsx`**

```tsx
'use client';
import Link from 'next/link';
import { ClubDetail, ClubPresentation, assetUrl } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS, inkOn } from '@/lib/theme';
import { Icon } from '@/components/ui/Icon';
import { HERO_GRADIENT, HERO_INK, HERO_INK_MUTED } from '@/components/agenda/AgendaHero';
import { cardStyle } from '@/components/clubhouse/SectionHeader';
import {
  amenityList, courtsChipLabel, courtsSummary, coverUrl, hoursRange, openNowChip,
  railPhotos, showcaseKicker,
} from '@/lib/clubShowcase';

// Vitrine « Le club » du Club-house : scène cinéma (photo du club + voile) ou repli
// « brume bleue » (jamais de grand panneau sombre), chips d'infos automatiques
// (pistes/horaires dérivés de club.clubSports), bande « Sur place ». Tout mène à /club.
export function ClubShowcase({ presentation, club, now }: { presentation: ClubPresentation; club: ClubDetail; now: Date | null }) {
  const { th } = useTheme();
  const cover = assetUrl(coverUrl(presentation));
  const onPhoto = !!cover;
  const kicker = showcaseKicker(club.city, presentation.foundedYear);
  const courts = courtsChipLabel(courtsSummary(club.clubSports));
  const hours = openNowChip(hoursRange(club.clubSports), club.timezone, now);
  const rail = railPhotos(presentation);
  const amenities = amenityList(presentation.amenities);
  const logo = assetUrl(club.logoUrl);

  const ink = onPhoto ? '#fff' : HERO_INK;
  const inkMuted = onPhoto ? 'rgba(255,255,255,0.86)' : HERO_INK_MUTED;
  const chip: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 999,
    fontFamily: th.fontUI, fontSize: 12, fontWeight: 600, color: ink,
    ...(onPhoto
      ? { background: 'rgba(255,255,255,0.16)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.35)', backdropFilter: 'blur(6px)' }
      : { background: 'rgba(255,255,255,0.55)', boxShadow: 'inset 0 0 0 1.4px rgba(24,21,14,0.14)' }),
  };

  return (
    <div>
      <style>{`
        .cs-scene{position:relative;display:block;height:400px;border-radius:18px;overflow:hidden;text-decoration:none}
        .cs-rail{display:none}
        .cs-photochip{position:absolute;top:16px;right:16px;z-index:3}
        @media(min-width:700px){
          .cs-scene{height:340px}
          .cs-rail{display:flex;gap:8px;position:absolute;right:20px;bottom:20px;z-index:3}
          .cs-photochip{display:none}
        }
        .cs-amen-label{font-family:${th.fontUI};font-size:12px;font-weight:600}
        @media(max-width:479px){.cs-amen-label{display:none}}
      `}</style>

      <Link href="/club" aria-label={`Découvrir ${club.name}`} className="cs-scene"
        style={{ boxShadow: th.shadow, ...(onPhoto ? {} : { background: HERO_GRADIENT }) }}>
        {onPhoto && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={cover} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
            <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'linear-gradient(178deg, rgba(10,14,24,0.02) 32%, rgba(10,14,24,0.74) 90%)' }} />
          </>
        )}
        {!onPhoto && (
          <span aria-hidden="true" style={{ position: 'absolute', right: -22, top: -30, opacity: 0.12, pointerEvents: 'none' }}>
            <Icon name="ball" size={190} color={HERO_INK} />
          </span>
        )}

        <span aria-hidden="true" style={{ position: 'absolute', top: 16, left: 18, zIndex: 3, width: 44, height: 44, borderRadius: 13, background: 'rgba(255,255,255,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 14px rgba(0,0,0,0.22)' }}>
          {logo
            /* eslint-disable-next-line @next/next/no-img-element */
            ? <img src={logo} alt="" style={{ width: 32, height: 32, objectFit: 'contain' }} />
            : <Icon name="ball" size={26} color={th.accent} />}
        </span>

        {presentation.photos.length > 0 && (
          <span className="cs-photochip" style={chip}>
            <Icon name="camera" size={13} color={ink} />{presentation.photos.length} photos
          </span>
        )}

        <div style={{ position: 'absolute', inset: 0, zIndex: 2, padding: 20, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'flex-start' }}>
          {kicker && <div style={{ fontFamily: th.fontBrand, fontSize: 11.5, letterSpacing: 2.5, textTransform: 'uppercase', color: onPhoto ? '#cfe0f5' : HERO_INK_MUTED }}>{kicker}</div>}
          <div style={{ fontFamily: th.fontDisplay, fontWeight: 800, fontSize: 'clamp(29px, 5vw, 37px)', letterSpacing: -0.8, color: ink, margin: '4px 0 8px', textShadow: onPhoto ? '0 2px 18px rgba(0,0,0,0.35)' : 'none' }}>
            {club.name}
          </div>
          {presentation.presentationText && (
            <p style={{ fontFamily: th.fontUI, fontSize: 13.5, lineHeight: 1.55, color: inkMuted, maxWidth: 440, margin: '0 0 14px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {presentation.presentationText}
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {courts && <span style={chip}><Icon name="ball" size={13} color={ink} />{courts}</span>}
            {hours && (
              <span style={chip}>
                <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 99, background: hours.open ? ACCENTS.emerald : ACCENTS.apricot, display: 'inline-block' }} />
                {hours.label}
              </span>
            )}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: th.accent, color: inkOn(th.accent), fontFamily: th.fontUI, fontWeight: 700, fontSize: 13, padding: '9px 17px', borderRadius: 999, boxShadow: `0 6px 16px ${th.accent}73` }}>
              Découvrir le club →
            </span>
          </div>
        </div>

        {rail.tiles.length > 0 && (
          <span className="cs-rail">
            {rail.tiles.map((ph) => (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img key={ph.id} src={assetUrl(ph.url) ?? ''} alt={ph.caption ?? ''} style={{ width: 80, height: 60, objectFit: 'cover', borderRadius: 11, boxShadow: '0 5px 16px rgba(0,0,0,0.4), inset 0 0 0 1px rgba(255,255,255,0.45)' }} />
            ))}
            {rail.more > 0 && <span style={{ ...chip, width: 80, height: 60, borderRadius: 11, justifyContent: 'center', padding: 0 }}>+{rail.more}</span>}
          </span>
        )}
      </Link>

      {amenities.length > 0 && (
        <div style={{ ...cardStyle(th), marginTop: 10, padding: '11px 18px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: th.textFaint }}>Sur place</span>
          {amenities.map((a) => (
            <span key={a.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 30, height: 30, borderRadius: 9, background: `${th.accent}21`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={a.icon} size={15} color={th.accent} />
              </span>
              <span className="cs-amen-label" style={{ color: th.text }}>{a.label}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Vérifier le vert**

```powershell
cd C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend; node node_modules/jest/bin/jest.js __tests__/ClubShowcase.test.tsx
```

Expected: PASS (4 tests).

- [ ] **Step 5: Câbler `ClubHouse.tsx` et supprimer l'ancienne carte**

Dans `ClubHouse.tsx` :
- Remplacer l'import l.18 : `import { ClubShowcase } from '@/components/clubhouse/ClubShowcase';` et importer `showShowcase` depuis `@/lib/clubShowcase`.
- l.119 : `const showClubCard = showShowcase(presentation);`
- Section `clubCard` (l.128-133) :

```tsx
    clubCard: showClubCard && presentation && (
      <div>
        <SectionHeader title="Le club" action={{ label: 'Découvrir →', href: '/club' }} />
        <ClubShowcase presentation={presentation} club={club} now={clock} />
      </div>
    ),
```

Supprimer `frontend/components/clubhouse/ClubPresentationCard.tsx` et `frontend/__tests__/ClubPresentationCard.test.tsx` :

```powershell
git rm frontend/components/clubhouse/ClubPresentationCard.tsx frontend/__tests__/ClubPresentationCard.test.tsx
```

- [ ] **Step 6: Mettre à jour `ClubHouse.test.tsx`**

- Si la suite mocke/importe `ClubPresentationCard`, basculer sur `ClubShowcase`.
- Le fixture `club` de la suite doit exposer `clubSports: []` (helpers défensifs, mais le type l'exige) ; les mocks `getClubPresentation` gagnent `foundedYear: null, amenities: []`.
- L'assertion « section clubCard rendue » doit viser le nouveau rendu (le lien `Découvrir …` existe toujours).

```powershell
cd C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend; node node_modules/jest/bin/jest.js __tests__/ClubHouse.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add frontend/components/clubhouse/ClubShowcase.tsx frontend/components/ClubHouse.tsx frontend/__tests__/ClubShowcase.test.tsx frontend/__tests__/ClubHouse.test.tsx
git commit -m "feat(clubhouse): scene cinema Le club (ClubShowcase remplace ClubPresentationCard)"
```

---

### Task 6: Refonte page `/club`

**Files:**
- Modify: `frontend/app/club/page.tsx` (réécriture)
- Test: `frontend/__tests__/ClubPage.test.tsx`

- [ ] **Step 1: Étendre le test existant (échec attendu)**

Dans `ClubPage.test.tsx` : ajouter au mock `getClubPresentation` les champs `foundedYear: 2021, amenities: ['bar']`, au mock `useClub` un `club.clubSports: []` et `club.timezone`, puis ajouter :

```tsx
  it('hero + équipements + encart réserver', async () => {
    render(<ThemeProvider><ClubPage /></ThemeProvider>);
    await waitFor(() => expect(screen.getByText('Notre histoire…')).toBeInTheDocument());
    expect(screen.getByText('Rodez · Depuis 2021')).toBeInTheDocument();
    expect(screen.getByText('Bar & cuisine')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Réserver un terrain/i })[0]).toHaveAttribute('href', '/reserver');
  });
```

(Les 4 assertions historiques — présentation, horaires texte, Itinéraire, tel — restent vraies.)

- [ ] **Step 2: Vérifier l'échec**

```powershell
cd C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend; node node_modules/jest/bin/jest.js __tests__/ClubPage.test.tsx
```

Expected: FAIL (« Rodez · Depuis 2021 » absent).

- [ ] **Step 3: Réécrire `frontend/app/club/page.tsx`**

```tsx
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ClubPresentation, assetUrl } from '@/lib/api';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { inkOn } from '@/lib/theme';
import { ClubNav } from '@/components/ClubNav';
import { Icon } from '@/components/ui/Icon';
import { HERO_GRADIENT, HERO_INK, HERO_INK_MUTED } from '@/components/agenda/AgendaHero';
import { cardStyle } from '@/components/clubhouse/SectionHeader';
import { amenityList, coverUrl, hoursRange, openNowChip, showcaseKicker } from '@/lib/clubShowcase';

// Page publique « Le club » — même langage cinéma que la vitrine du Club-house :
// hero (photo + voile ou brume bleue), récit complet, galerie mosaïque (lightbox),
// équipements, infos pratiques, encart « Envie de jouer ? ».
export default function ClubPage() {
  const { th } = useTheme();
  const { club, slug } = useClub();
  const [pres, setPres] = useState<ClubPresentation | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [now, setNow] = useState<Date | null>(null); // horloge posée en effet — hydration-safe

  useEffect(() => { setNow(new Date()); }, []);
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

  const cover = pres ? assetUrl(coverUrl(pres)) : null;
  const onPhoto = !!cover;
  const sportNames = (club.clubSports ?? []).map((s) => s.sport.name).join(' · ');
  const kickerBase = showcaseKicker(club.city, pres?.foundedYear ?? null);
  const kicker = [kickerBase, sportNames].filter(Boolean).join(' · ');
  const hours = openNowChip(hoursRange(club.clubSports), club.timezone, now);
  const amenities = amenityList(pres?.amenities);
  const ink = onPhoto ? '#fff' : HERO_INK;

  const glassChip: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 999,
    fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: ink, textDecoration: 'none',
    ...(onPhoto
      ? { background: 'rgba(255,255,255,0.16)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.35)', backdropFilter: 'blur(6px)' }
      : { background: 'rgba(255,255,255,0.55)', boxShadow: 'inset 0 0 0 1.4px rgba(24,21,14,0.14)' }),
  };
  const h5: React.CSSProperties = { fontFamily: th.fontUI, fontWeight: 700, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: th.textFaint, margin: '0 0 10px' };
  const cta: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 7, background: th.accent, color: inkOn(th.accent), fontFamily: th.fontUI, fontWeight: 700, fontSize: 13, padding: '9px 17px', borderRadius: 999, textDecoration: 'none', boxShadow: `0 6px 16px ${th.accent}73` };

  const paragraphs = pres?.presentationText ? pres.presentationText.split(/\n{2,}/) : [];

  return (
    <div style={{ minHeight: '100vh', background: th.bg }}>
      <ClubNav club={club} />

      {/* Hero cinéma */}
      <div style={{ position: 'relative', minHeight: 300, display: 'flex', ...(onPhoto ? {} : { background: HERO_GRADIENT }) }}>
        {onPhoto && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={cover ?? ''} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
            <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'linear-gradient(178deg, rgba(10,14,24,0.05) 30%, rgba(10,14,24,0.74) 92%)' }} />
          </>
        )}
        <div style={{ position: 'relative', zIndex: 2, width: '100%', maxWidth: 900, margin: '0 auto', padding: '80px 20px 24px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
          {kicker && <div style={{ fontFamily: th.fontBrand, fontSize: 11.5, letterSpacing: 2.5, textTransform: 'uppercase', color: onPhoto ? '#cfe0f5' : HERO_INK_MUTED }}>{kicker}</div>}
          <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 800, fontSize: 'clamp(28px, 5vw, 36px)', letterSpacing: -0.8, color: ink, margin: '4px 0 12px', textShadow: onPhoto ? '0 2px 18px rgba(0,0,0,0.35)' : 'none' }}>{club.name}</h1>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Link href="/reserver" style={cta}>Réserver un terrain →</Link>
            <a href={mapsHref} target="_blank" rel="noreferrer" style={glassChip}><Icon name="pin" size={13} color={ink} />Itinéraire</a>
            {pres?.contactPhone && <a href={`tel:${pres.contactPhone}`} style={glassChip}>{pres.contactPhone}</a>}
          </div>
        </div>
      </div>

      <main style={{ maxWidth: 900, margin: '0 auto', padding: '22px 20px 60px' }}>
        <style>{`
          .cp-grid{display:grid;grid-template-columns:1fr;gap:14px;align-items:start}
          @media(min-width:800px){.cp-grid{grid-template-columns:1.5fr 1fr}}
          .cp-gal{display:grid;grid-template-columns:repeat(2,1fr);grid-auto-rows:96px;gap:8px}
          @media(min-width:640px){.cp-gal{grid-template-columns:repeat(4,1fr)}}
          .cp-gal .big{grid-column:span 2;grid-row:span 2}
        `}</style>
        <div className="cp-grid">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {paragraphs.length > 0 && (
              <section style={{ ...cardStyle(th), padding: '16px 18px' }}>
                <p style={h5}>Le club</p>
                {paragraphs.map((para, i) => (
                  <p key={i} style={{ fontFamily: th.fontUI, fontSize: 14.5, color: th.text, lineHeight: 1.65, whiteSpace: 'pre-wrap', margin: i === 0 ? 0 : '10px 0 0' }}>{para}</p>
                ))}
              </section>
            )}

            {pres && pres.photos.length > 0 && (
              <section>
                <p style={{ ...h5, margin: '6px 0 10px' }}>La galerie</p>
                <div className="cp-gal">
                  {pres.photos.map((p, i) => (
                    <button key={p.id} onClick={() => setLightbox(assetUrl(p.url))} aria-label={p.caption ?? 'Photo du club'}
                      className={i === 0 ? 'big' : undefined}
                      style={{ border: 'none', padding: 0, cursor: 'zoom-in', borderRadius: 12, overflow: 'hidden', background: th.surface2 }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={assetUrl(p.url) ?? ''} alt={p.caption ?? ''} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {amenities.length > 0 && (
              <section style={{ ...cardStyle(th), padding: '16px 18px' }}>
                <p style={h5}>Sur place</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                  {amenities.map((a) => (
                    <span key={a.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.text }}>
                      <span style={{ width: 34, height: 34, borderRadius: 10, background: `${th.accent}21`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Icon name={a.icon} size={16} color={th.accent} />
                      </span>
                      {a.label}
                    </span>
                  ))}
                </div>
              </section>
            )}

            <section style={{ ...cardStyle(th), padding: '16px 18px' }}>
              <p style={h5}>Infos pratiques</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontFamily: th.fontUI, fontSize: 14, color: th.text }}>
                {hours && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 700 }}>
                    <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 99, background: hours.open ? '#34b27b' : th.textFaint, display: 'inline-block' }} />
                    {hours.label}
                  </div>
                )}
                {pres?.openingHoursText && <div>{pres.openingHoursText}</div>}
                <div>{club.address}{club.city ? `, ${club.city}` : ''} — <a href={mapsHref} target="_blank" rel="noreferrer" style={{ color: th.accent, fontWeight: 700 }}>Itinéraire →</a></div>
                {pres?.contactPhone && <a href={`tel:${pres.contactPhone}`} style={{ color: th.accent }}>{pres.contactPhone}</a>}
                {pres?.contactEmail && <a href={`mailto:${pres.contactEmail}`} style={{ color: th.accent }}>{pres.contactEmail}</a>}
              </div>
            </section>

            <section style={{ borderRadius: 16, padding: '16px 18px', background: HERO_GRADIENT, color: HERO_INK }}>
              <div style={{ fontFamily: th.fontDisplay, fontWeight: 800, fontSize: 15, letterSpacing: -0.3, marginBottom: 10 }}>Envie de jouer ?</div>
              <Link href="/reserver" style={{ ...cta, fontSize: 12.5 }}>Réserver un terrain →</Link>
            </section>
          </div>
        </div>
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

⚠️ Le hero utilise la photo de couverture EN FOND (plus le `<img>` bandeau 200px). La galerie affiche TOUTES les photos (page dédiée — pas de « +N », écart mineur assumé vs maquette).

- [ ] **Step 4: Vérifier le vert**

```powershell
cd C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend; node node_modules/jest/bin/jest.js __tests__/ClubPage.test.tsx
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```powershell
git add frontend/app/club/page.tsx frontend/__tests__/ClubPage.test.tsx
git commit -m "feat(club): page /club immersive (hero cinema, galerie mosaique, sur place, infos)"
```

---

### Task 7: Admin `/admin/club` — année de création + équipements

**Files:**
- Modify: `frontend/app/admin/club/page.tsx`
- Test: `frontend/__tests__/AdminClub.test.tsx`

- [ ] **Step 1: Étendre les tests (échec attendu)**

Dans `AdminClub.test.tsx` : compléter le mock `adminGetPresentation` avec `foundedYear: null, amenities: []` (et le retour d'`adminUpdatePresentation` pareil), puis ajouter :

```tsx
  it('édite année de création + équipements', async () => {
    render(<ThemeProvider><AdminClubPage /></ThemeProvider>);
    await waitFor(() => expect(screen.getByLabelText(/Année de création/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Année de création/i), { target: { value: '2021' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Parking/i }));
    fireEvent.click(screen.getByRole('button', { name: /Enregistrer/i }));
    await waitFor(() => expect(api.adminUpdatePresentation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ foundedYear: 2021, amenities: ['parking'] }),
      expect.anything(),
    ));
  });
```

(Adapter les identifiants render/mocks au harnais existant de la suite.)

- [ ] **Step 2: Vérifier l'échec**

```powershell
cd C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend; node node_modules/jest/bin/jest.js __tests__/AdminClub.test.tsx
```

Expected: FAIL (champ inexistant).

- [ ] **Step 3: Implémenter dans `frontend/app/admin/club/page.tsx`**

- Imports : `import { AMENITIES } from '@/lib/clubShowcase';` et `import { Icon } from '@/components/ui/Icon';`
- État : `const [form, setForm] = useState({ presentationText: '', openingHoursText: '', contactPhone: '', contactEmail: '', foundedYear: '', amenities: [] as string[] });`
- `applyPres` : `foundedYear: p.foundedYear != null ? String(p.foundedYear) : ''` et `amenities: p.amenities ?? []`.
- `save()` : ajouter au body `foundedYear: form.foundedYear ? Number(form.foundedYear) : null, amenities: form.amenities` ; mapper l'erreur : `if ((e as Error).message === 'VALIDATION_ERROR') setError('Année de création invalide');`
- Toggle : `const toggleAmenity = (key: string) => { setSaved(false); setForm((f) => ({ ...f, amenities: f.amenities.includes(key) ? f.amenities.filter((k) => k !== key) : [...f.amenities, key] })); };`
- JSX, dans la carte « Présentation », entre la rangée Téléphone/Email et le bouton Enregistrer :

```tsx
          <label style={{ ...labelStyle, maxWidth: 180 }}>
            Année de création
            <input value={form.foundedYear} onChange={(e) => { setSaved(false); setForm({ ...form, foundedYear: e.target.value.replace(/\D/g, '') }); }}
              placeholder="Ex. 2021" inputMode="numeric" aria-label="Année de création" style={inputStyle} />
          </label>
          <div style={labelStyle}>
            Sur place (équipements & services)
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
              {AMENITIES.map((a) => (
                <label key={a.key} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px', borderRadius: 11, background: th.bg, border: `1px solid ${th.line}`, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.text }}>
                  <input type="checkbox" checked={form.amenities.includes(a.key)} onChange={() => toggleAmenity(a.key)} aria-label={a.label} />
                  <Icon name={a.icon} size={15} color={th.accent} />
                  {a.label}
                </label>
              ))}
            </div>
          </div>
```

- [ ] **Step 4: Vérifier le vert**

```powershell
cd C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend; node node_modules/jest/bin/jest.js __tests__/AdminClub.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add frontend/app/admin/club/page.tsx frontend/__tests__/AdminClub.test.tsx
git commit -m "feat(admin): annee de creation + equipements Sur place dans /admin/club"
```

---

### Task 8: Passe finale — suites, tsc, vérification visuelle

- [ ] **Step 1: Suites scoped des deux côtés**

```powershell
cd C:\ProjetsIA\05_PERSO\RESERVE\palova\backend; node node_modules/jest/bin/jest.js src/services/__tests__/presentation.service.test.ts src/routes/__tests__
cd C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend; node node_modules/jest/bin/jest.js __tests__/clubShowcase.test.ts __tests__/ClubShowcase.test.tsx __tests__/ClubPage.test.tsx __tests__/ClubHouse.test.tsx __tests__/AdminClub.test.tsx
```

Expected: PASS partout (les échecs BookingModal de la suite complète sont un flake connu, hors périmètre).

- [ ] **Step 2: tsc des deux côtés**

```powershell
cd C:\ProjetsIA\05_PERSO\RESERVE\palova\backend; node node_modules/typescript/bin/tsc --noEmit
cd C:\ProjetsIA\05_PERSO\RESERVE\palova\frontend; node node_modules/typescript/bin/tsc --noEmit
```

Expected: 0 erreur imputable aux fichiers du lot (scoper au grep si du WIP parallèle pollue).

- [ ] **Step 3: Vérification visuelle (skill `verify`)**

Pile dev lancée (`start.ps1` si besoin). Vérifier sur le club seedé `padel-arena-paris` :
- Accueil Club-house : scène photo (le club démo a 3 photos) — clair + sombre, desktop 1280 + mobile 390 (⚠️ mobile:false + width fixe, piège d'émulation mémorisé).
- État minimal : retirer temporairement texte/photos via `/admin/club` (ou tester un club sans contenu) → repli brume bleue, puis restaurer.
- `/admin/club` : cocher 4-5 équipements + année 2021 → bande « Sur place » apparaît sur l'accueil, chips à jour.
- `/club` : hero, galerie lightbox, infos pratiques, encart Réserver.
- Zéro scroll horizontal mobile (`document.documentElement.scrollWidth === 390`).

- [ ] **Step 4: Commit d'éventuels ajustements visuels**

```powershell
git add <fichiers ajustés du lot uniquement>
git commit -m "fix(clubhouse): ajustements visuels vitrine club (verif CDP)"
```

---

## Écarts assumés vs spec (à savoir)

1. **Pas d'enrichissement `courts`/`hours` du payload présentation** : dérivés client depuis `ClubDetail.clubSports[].resources` (déjà chargé par le layout) — moins de backend, zéro fetch ajouté.
2. **Galerie /club sans « +N »** : la page dédiée montre toutes les photos (≤ 12).
3. **`prisma migrate deploy`** en prod appliquera la migration `20260712120000_add_club_showcase` (le SQL `IF NOT EXISTS` la rend idempotente avec l'application manuelle dev).
