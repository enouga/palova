# Promotions datées sur les terrains — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à un club de créer des promotions bornées dans le temps (période + terrains ciblés + plage horaire optionnelle, remise en % ou prix fixe) qui baissent automatiquement le prix des créneaux à la réservation, avec affichage « prix barré + nom de la promo » côté joueur.

**Architecture :** Un modèle `Promotion` (+ jointure `PromotionResource`) scopé au club. Un helper **pur** `effectiveSlotPriceCents` (dans `pricing.ts`) enveloppe le prix de base calculé par `slotPriceCents` aux **deux seuls** points qui facturent le joueur : la grille de disponibilité (`availability.service`) et le hold (`reservation.service.holdSlot`, qui fige le prix dans `totalPrice`). Tout le reste (dû, abonnement, carnet, caisse) lit le `totalPrice` déjà remisé — aucune autre modification. CRUD admin via une page `/admin/promotions`.

**Tech Stack :** Backend Express + Prisma 7 (driver adapter pg) + luxon ; Frontend Next.js 16 + React ; tests Jest (backend : supertest + `prismaMock` ; frontend : React Testing Library).

**Spec de référence :** `docs/superpowers/specs/2026-07-15-promotions-terrains-datees-design.md`

---

## Conventions maison à respecter (vérifiées dans le code)

- **Argent = `Prisma.Decimal` (euros)** dans les modèles/services (comme `Resource.price`), PAS des centimes. Le helper pur `pricing.ts` travaille en **centimes** (les appelants convertissent `Decimal → cents` via `Math.round(Number(x) * 100)`).
- **Validation dans le service**, qui `throw new Error('VALIDATION_ERROR')` / `throw new Error('PROMOTION_NOT_FOUND')`. La route ne valide pas le métier.
- **Garde d'appartenance** : dans le service, `findUnique({ where: { id } })` puis `if (!row || row.clubId !== clubId) throw new Error('PROMOTION_NOT_FOUND')`.
- **Routes admin** : `admin.ts` a déjà `router.use(authMiddleware, requireClubMember('STAFF'))` en tête ; une route ADMIN ajoute `requireClubMember('ADMIN')` **en 1er middleware inline**. Erreurs mappées via le record `ERROR_STATUS` + le helper `handleError(e, res, next)`.
- **Services instanciés en `new PromotionService()`** en tête de `admin.ts` (comme `PackageService`/`SubscriptionService`).
- **Front** : pages admin lisent `useClub()` (`club?.id`) + `useAuth()` (`token`, `ready`) ; méthodes `api.*` en `(clubId, [id], body, token)` ; type `Update = Partial<Create & {...}>`.
- **Migration** : additive, hand-authored (dérive de base connue). DEV = `prisma db execute` du SQL + `prisma generate` ; prod = `migrate deploy`. Si les shims `npx` sont cassés : `node node_modules/prisma/build/index.js ...`.
- **tsc est le seul type-gate** (jest n'échoue pas sur les types) : lancer `node node_modules/typescript/bin/tsc --noEmit -p <tsconfig>` sur backend ET frontend après les tâches.

---

## File Structure

**Backend — créés :**
- `backend/prisma/migrations/20260715000000_add_promotions/migration.sql` — table `promotions` + `promotion_resources` + enum `PromotionKind`.
- `backend/src/services/promotion.service.ts` — `PromotionService` (CRUD + validation) + `loadActivePromotions()` (loader pour le pricing) + mapper `toActivePromo`/`toDTO`.
- `backend/src/services/__tests__/promotion.service.test.ts`.
- `backend/src/routes/__tests__/admin.promotions.routes.test.ts`.

**Backend — modifiés :**
- `backend/prisma/schema.prisma` — modèles `Promotion`/`PromotionResource` + enum + back-refs sur `Club` et `Resource`.
- `backend/src/services/pricing.ts` — type `ActivePromo` + fonction pure `effectiveSlotPriceCents`.
- `backend/src/services/__tests__/pricing.test.ts` — cas `effectiveSlotPriceCents`.
- `backend/src/services/availability.service.ts` — `TimeSlot` gagne `originalPrice?`/`promoName?` ; charge et applique les promos.
- `backend/src/services/__tests__/availability.service.test.ts` — cas promo.
- `backend/src/services/reservation.service.ts` — `holdSlot` applique la promo au `totalPrice`.
- `backend/src/services/__tests__/reservation.service.test.ts` — cas holdSlot avec promo.
- `backend/src/routes/admin.ts` — import + `new PromotionService()` + section de routes + `PROMOTION_NOT_FOUND: 404`.

**Frontend — créés :**
- `frontend/lib/adminPromotions.ts` — helpers purs (statut/groupage/libellés).
- `frontend/__tests__/adminPromotions.test.ts`.
- `frontend/app/admin/promotions/page.tsx` — page vitrine + studio.
- `frontend/components/admin/promotions/PromotionCard.tsx`.
- `frontend/components/admin/promotions/PromotionForm.tsx`.
- `frontend/__tests__/AdminPromotions.test.tsx`.

**Frontend — modifiés :**
- `frontend/lib/api.ts` — type `Promotion` + bodies + méthodes CRUD ; `TimeSlot` gagne `originalPrice?`/`promoName?`.
- `frontend/app/admin/layout.tsx` — entrée nav « Promotions ».
- `frontend/components/ClubReserve.tsx` — pastille promo sur la pill.
- `frontend/components/BookingModal.tsx` — prix barré + badge promo dans l'en-tête.

---

## Task 1 : Migration + schéma Prisma

**Files:**
- Create: `backend/prisma/migrations/20260715000000_add_promotions/migration.sql`
- Modify: `backend/prisma/schema.prisma` (ajout enum + 2 modèles + 2 back-refs)

- [ ] **Step 1 : Ajouter l'enum + les modèles au schéma**

Dans `backend/prisma/schema.prisma`, ajouter l'enum près des autres enums (ex. après `enum AnnouncementKind { ... }`, ligne ~202) :

```prisma
enum PromotionKind {
  PERCENT
  FIXED
}
```

Ajouter les 2 modèles (ex. juste après le modèle `Resource`, après sa ligne `@@map("resources")`) :

```prisma
/// Promotion datée sur des terrains : remise (% ou prix fixe) sur une période, terrains
/// (vide = tous), et plage horaire optionnelle. Appliquée au prix du créneau à la réservation.
model Promotion {
  id          String        @id @default(cuid())
  clubId      String        @map("club_id")
  name        String
  startDate   DateTime      @map("start_date") @db.Date // bornes incluses, date locale du club
  endDate     DateTime      @map("end_date")   @db.Date
  windowStart Int?          @map("window_start") // minutes depuis minuit ; null = toute la journée
  windowEnd   Int?          @map("window_end")
  kind        PromotionKind
  percentOff  Int?          @map("percent_off") // 1..100 si kind=PERCENT
  fixedPrice  Decimal?      @map("fixed_price") @db.Decimal(10, 2) // euros si kind=FIXED
  enabled     Boolean       @default(true)
  createdAt   DateTime      @default(now()) @map("created_at")
  updatedAt   DateTime      @updatedAt @map("updated_at")

  club      Club                @relation(fields: [clubId], references: [id], onDelete: Cascade)
  resources PromotionResource[]

  @@index([clubId])
  @@map("promotions")
}

/// Ciblage d'une promo : liste de terrains. Aucune ligne = tous les terrains du club.
model PromotionResource {
  promotionId String @map("promotion_id")
  resourceId  String @map("resource_id")

  promotion Promotion @relation(fields: [promotionId], references: [id], onDelete: Cascade)
  resource  Resource  @relation(fields: [resourceId], references: [id], onDelete: Cascade)

  @@id([promotionId, resourceId])
  @@index([resourceId])
  @@map("promotion_resources")
}
```

Ajouter les back-références :
- Modèle `Club` (bloc de relations, après `platformInvoices PlatformInvoice[]`, ligne ~355) : `promotions Promotion[]`
- Modèle `Resource` (bloc de relations, après `series ReservationSeries[]`, ligne ~450) : `promotionResources PromotionResource[]`

- [ ] **Step 2 : Écrire le SQL de migration**

`backend/prisma/migrations/20260715000000_add_promotions/migration.sql` :

```sql
-- add_promotions : promotions datées sur les terrains (remise % ou prix fixe).
DO $$ BEGIN
  CREATE TYPE "PromotionKind" AS ENUM ('PERCENT', 'FIXED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "promotions" (
  "id"           TEXT NOT NULL,
  "club_id"      TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "start_date"   DATE NOT NULL,
  "end_date"     DATE NOT NULL,
  "window_start" INTEGER,
  "window_end"   INTEGER,
  "kind"         "PromotionKind" NOT NULL,
  "percent_off"  INTEGER,
  "fixed_price"  DECIMAL(10,2),
  "enabled"      BOOLEAN NOT NULL DEFAULT true,
  "created_at"   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "promotions_club_id_idx" ON "promotions"("club_id");

CREATE TABLE IF NOT EXISTS "promotion_resources" (
  "promotion_id" TEXT NOT NULL,
  "resource_id"  TEXT NOT NULL,
  CONSTRAINT "promotion_resources_pkey" PRIMARY KEY ("promotion_id", "resource_id")
);
CREATE INDEX IF NOT EXISTS "promotion_resources_resource_id_idx" ON "promotion_resources"("resource_id");

DO $$ BEGIN
  ALTER TABLE "promotions" ADD CONSTRAINT "promotions_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "promotion_resources" ADD CONSTRAINT "promotion_resources_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "promotion_resources" ADD CONSTRAINT "promotion_resources_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

- [ ] **Step 3 : Appliquer en DEV + régénérer le client**

Depuis `backend/` :

```bash
npx prisma db execute --file prisma/migrations/20260715000000_add_promotions/migration.sql --schema prisma/schema.prisma
npx prisma generate
```

Expected : `db execute` termine sans erreur ; `generate` régénère le client (le type `Promotion`/`PromotionKind` devient disponible). Si `npx` est cassé : `node node_modules/prisma/build/index.js db execute ...` puis `node node_modules/prisma/build/index.js generate`.

- [ ] **Step 4 : Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260715000000_add_promotions/
git commit -m "feat(promotions): modèle Promotion + PromotionResource (migration add_promotions)"
```

---

## Task 2 : Helper pur `effectiveSlotPriceCents`

**Files:**
- Modify: `backend/src/services/pricing.ts`
- Test: `backend/src/services/__tests__/pricing.test.ts`

- [ ] **Step 1 : Écrire les tests (échouent)**

Ajouter à la fin de `backend/src/services/__tests__/pricing.test.ts` (importer `effectiveSlotPriceCents, ActivePromo` en tête du fichier depuis `'../pricing'`) :

```ts
import { effectiveSlotPriceCents, ActivePromo } from '../pricing';

describe('effectiveSlotPriceCents', () => {
  const TZ = 'Europe/Paris';
  const d = (iso: string) => new Date(iso);
  const promo = (p: Partial<ActivePromo>): ActivePromo => ({
    name: 'P', kind: 'PERCENT', percentOff: null, fixedPriceCents: null,
    windowStart: null, windowEnd: null, resourceIds: [], ...p,
  });
  // créneau 18:00–19:00 heure de Paris (UTC+2 l'été) = 16:00–17:00 UTC
  const S = d('2026-07-15T16:00:00Z'), E = d('2026-07-15T17:00:00Z');

  it('sans promo → prix de base, pas de nom', () => {
    expect(effectiveSlotPriceCents(2500, [], 'court-1', S, E, TZ)).toEqual({ priceCents: 2500 });
  });

  it('pourcentage → base × (100−p)/100 + nom', () => {
    expect(effectiveSlotPriceCents(2500, [promo({ name: 'Été', percentOff: 20 })], 'court-1', S, E, TZ))
      .toEqual({ priceCents: 2000, promoName: 'Été' });
  });

  it('prix fixe → écrase la base', () => {
    expect(effectiveSlotPriceCents(2500, [promo({ name: 'Fixe', kind: 'FIXED', fixedPriceCents: 1500 })], 'court-1', S, E, TZ))
      .toEqual({ priceCents: 1500, promoName: 'Fixe' });
  });

  it('prix fixe supérieur à la base → ignoré (min)', () => {
    expect(effectiveSlotPriceCents(2500, [promo({ name: 'Cher', kind: 'FIXED', fixedPriceCents: 3000 })], 'court-1', S, E, TZ))
      .toEqual({ priceCents: 2500 });
  });

  it('ciblage : promo restreinte à un autre terrain → ignorée', () => {
    expect(effectiveSlotPriceCents(2500, [promo({ percentOff: 50, resourceIds: ['court-2'] })], 'court-1', S, E, TZ))
      .toEqual({ priceCents: 2500 });
  });

  it('ciblage : promo restreinte au terrain courant → appliquée', () => {
    expect(effectiveSlotPriceCents(2500, [promo({ name: 'C1', percentOff: 50, resourceIds: ['court-1'] })], 'court-1', S, E, TZ))
      .toEqual({ priceCents: 1250, promoName: 'C1' });
  });

  it('fenêtre : créneau entièrement dedans → appliquée', () => {
    // fenêtre 17:00–20:00 (1020–1200 min), créneau 18:00–19:00 dedans
    expect(effectiveSlotPriceCents(2500, [promo({ name: 'HH', percentOff: 20, windowStart: 1020, windowEnd: 1200 })], 'court-1', S, E, TZ))
      .toEqual({ priceCents: 2000, promoName: 'HH' });
  });

  it('fenêtre : créneau qui déborde → ignorée', () => {
    // fenêtre 18:30–20:00 (1110–1200), créneau 18:00–19:00 commence avant → non applicable
    expect(effectiveSlotPriceCents(2500, [promo({ percentOff: 20, windowStart: 1110, windowEnd: 1200 })], 'court-1', S, E, TZ))
      .toEqual({ priceCents: 2500 });
  });

  it('chevauchement → meilleur prix (le plus bas) gagne', () => {
    const promos = [promo({ name: 'A', percentOff: 20 }), promo({ name: 'B', kind: 'FIXED', fixedPriceCents: 1200 })];
    expect(effectiveSlotPriceCents(2500, promos, 'court-1', S, E, TZ)).toEqual({ priceCents: 1200, promoName: 'B' });
  });
});
```

- [ ] **Step 2 : Lancer les tests → échec**

Run: `node node_modules/jest/bin/jest.js pricing.test --silent` (depuis `backend/`)
Expected : FAIL (`effectiveSlotPriceCents` introuvable).

- [ ] **Step 3 : Implémenter le helper**

Ajouter à la fin de `backend/src/services/pricing.ts` :

```ts
// ------------------------------------------------------- Promotions datées
/** Promo active (déjà filtrée sur la date) prête pour le calcul de prix. */
export interface ActivePromo {
  name: string;
  kind: 'PERCENT' | 'FIXED';
  percentOff: number | null;
  fixedPriceCents: number | null;
  windowStart: number | null; // minutes depuis minuit, heure locale ; null = toute la journée
  windowEnd: number | null;
  resourceIds: string[];       // vide = tous les terrains
}

/**
 * Prix effectif d'un créneau en CENTIMES après application des promotions actives.
 * `baseCents` = prix normal (déjà calculé par slotPriceCents). `promos` doit déjà être
 * filtré sur la date du créneau (cf. loadActivePromotions). Le client gagne : on retient
 * le prix le plus bas, et une promo ne fait jamais monter le prix.
 */
export function effectiveSlotPriceCents(
  baseCents: number,
  promos: ActivePromo[],
  resourceId: string,
  start: Date,
  end: Date,
  tz: string,
): { priceCents: number; promoName?: string } {
  const s = DateTime.fromJSDate(start, { zone: tz });
  const e = DateTime.fromJSDate(end, { zone: tz });
  const startMin = s.hour * 60 + s.minute;
  const endMin = e.hour * 60 + e.minute;

  let bestCents = baseCents;
  let bestName: string | undefined;
  for (const p of promos) {
    if (p.resourceIds.length > 0 && !p.resourceIds.includes(resourceId)) continue;
    if (p.windowStart != null && p.windowEnd != null) {
      if (endMin <= startMin) continue;                       // créneau à cheval sur minuit : hors périmètre
      if (startMin < p.windowStart || endMin > p.windowEnd) continue; // pas entièrement dans la fenêtre
    }
    let candidate: number;
    if (p.kind === 'PERCENT' && p.percentOff != null) {
      candidate = Math.round((baseCents * (100 - p.percentOff)) / 100);
    } else if (p.kind === 'FIXED' && p.fixedPriceCents != null) {
      candidate = p.fixedPriceCents;
    } else {
      continue;
    }
    if (candidate < bestCents) { bestCents = candidate; bestName = p.name; }
  }
  return bestName ? { priceCents: bestCents, promoName: bestName } : { priceCents: bestCents };
}
```

- [ ] **Step 4 : Lancer les tests → succès**

Run: `node node_modules/jest/bin/jest.js pricing.test --silent`
Expected : PASS (tous les cas `effectiveSlotPriceCents` verts, les cas `slotPriceCents` existants restent verts).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/pricing.ts backend/src/services/__tests__/pricing.test.ts
git commit -m "feat(promotions): effectiveSlotPriceCents (helper pur de prix remisé)"
```

---

## Task 3 : `PromotionService` (CRUD + validation + loader)

**Files:**
- Create: `backend/src/services/promotion.service.ts`
- Test: `backend/src/services/__tests__/promotion.service.test.ts`

- [ ] **Step 1 : Écrire les tests (échouent)**

`backend/src/services/__tests__/promotion.service.test.ts` :

```ts
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { PromotionService, loadActivePromotions } from '../promotion.service';

const svc = new PromotionService();
const validBody = {
  name: 'Promo été', startDate: '2026-08-01', endDate: '2026-08-31',
  kind: 'PERCENT' as const, percentOff: 20, resourceIds: [] as string[],
};

beforeEach(() => { jest.clearAllMocks(); });

describe('createPromotion — validation', () => {
  it('refuse un nom vide', async () => {
    await expect(svc.createPromotion('club-1', { ...validBody, name: '  ' })).rejects.toThrow('VALIDATION_ERROR');
  });
  it('refuse startDate > endDate', async () => {
    await expect(svc.createPromotion('club-1', { ...validBody, startDate: '2026-09-01', endDate: '2026-08-01' })).rejects.toThrow('VALIDATION_ERROR');
  });
  it('refuse percentOff hors 1..100', async () => {
    await expect(svc.createPromotion('club-1', { ...validBody, percentOff: 0 })).rejects.toThrow('VALIDATION_ERROR');
    await expect(svc.createPromotion('club-1', { ...validBody, percentOff: 150 })).rejects.toThrow('VALIDATION_ERROR');
  });
  it('refuse FIXED sans fixedPrice valide', async () => {
    await expect(svc.createPromotion('club-1', { ...validBody, kind: 'FIXED', percentOff: undefined, fixedPrice: -1 })).rejects.toThrow('VALIDATION_ERROR');
  });
  it('refuse une fenêtre incohérente (start >= end)', async () => {
    await expect(svc.createPromotion('club-1', { ...validBody, windowStart: 1200, windowEnd: 1080 })).rejects.toThrow('VALIDATION_ERROR');
  });
  it('refuse un terrain n’appartenant pas au club', async () => {
    prismaMock.resource.findMany.mockResolvedValue([] as any); // aucun terrain trouvé pour ce club
    await expect(svc.createPromotion('club-1', { ...validBody, resourceIds: ['court-x'] })).rejects.toThrow('VALIDATION_ERROR');
  });
  it('crée une promo % valide (DTO shape)', async () => {
    prismaMock.promotion.create.mockResolvedValue({
      id: 'promo-1', clubId: 'club-1', name: 'Promo été',
      startDate: new Date('2026-08-01T00:00:00Z'), endDate: new Date('2026-08-31T00:00:00Z'),
      windowStart: null, windowEnd: null, kind: 'PERCENT', percentOff: 20, fixedPrice: null,
      enabled: true, createdAt: new Date('2026-07-15T00:00:00Z'), resources: [],
    } as any);
    const dto = await svc.createPromotion('club-1', validBody);
    expect(dto).toMatchObject({ id: 'promo-1', kind: 'PERCENT', percentOff: 20, startDate: '2026-08-01', endDate: '2026-08-31', resourceIds: [] });
  });
});

describe('updatePromotion / deletePromotion — garde club', () => {
  it('update d’une promo d’un autre club → PROMOTION_NOT_FOUND', async () => {
    prismaMock.promotion.findUnique.mockResolvedValue({ id: 'promo-1', clubId: 'autre', resources: [] } as any);
    await expect(svc.updatePromotion('promo-1', 'club-1', { name: 'X' })).rejects.toThrow('PROMOTION_NOT_FOUND');
  });
  it('delete d’une promo inconnue → PROMOTION_NOT_FOUND', async () => {
    prismaMock.promotion.findUnique.mockResolvedValue(null as any);
    await expect(svc.deletePromotion('promo-1', 'club-1')).rejects.toThrow('PROMOTION_NOT_FOUND');
  });
});

describe('loadActivePromotions', () => {
  it('mappe les lignes en ActivePromo (Decimal→cents, resources→ids)', async () => {
    prismaMock.promotion.findMany.mockResolvedValue([
      { name: 'Fixe', kind: 'FIXED', percentOff: null, fixedPrice: '15.00', windowStart: 1080, windowEnd: 1200, resources: [{ resourceId: 'court-1' }] },
    ] as any);
    const promos = await loadActivePromotions('club-1', '2026-08-15');
    expect(promos).toEqual([
      { name: 'Fixe', kind: 'FIXED', percentOff: null, fixedPriceCents: 1500, windowStart: 1080, windowEnd: 1200, resourceIds: ['court-1'] },
    ]);
    // filtre date : startDate <= jour <= endDate autour de minuit UTC de la date locale
    const where = (prismaMock.promotion.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where).toMatchObject({ clubId: 'club-1', enabled: true });
    expect(where.startDate.lte).toEqual(new Date('2026-08-15T00:00:00.000Z'));
    expect(where.endDate.gte).toEqual(new Date('2026-08-15T00:00:00.000Z'));
  });
});
```

- [ ] **Step 2 : Lancer les tests → échec**

Run: `node node_modules/jest/bin/jest.js promotion.service --silent`
Expected : FAIL (module `promotion.service` introuvable).

- [ ] **Step 3 : Implémenter le service**

`backend/src/services/promotion.service.ts` :

```ts
import { Prisma, PromotionKind } from '@prisma/client';
import { prisma } from '../db/prisma';
import { ActivePromo } from './pricing';

export type PromotionBody = {
  name?: string;
  startDate?: string;          // 'YYYY-MM-DD' (heure locale du club)
  endDate?: string;
  kind?: 'PERCENT' | 'FIXED';
  percentOff?: number | null;
  fixedPrice?: number | null;  // euros
  windowStart?: number | null; // minutes depuis minuit
  windowEnd?: number | null;
  enabled?: boolean;
  resourceIds?: string[];
};

const isYmd = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const dayUTC = (s: string) => new Date(`${s}T00:00:00.000Z`);

/** Ligne Prisma (avec resources incluses) → DTO sérialisable pour le front. */
function toDTO(p: {
  id: string; clubId: string; name: string; startDate: Date; endDate: Date;
  windowStart: number | null; windowEnd: number | null; kind: PromotionKind;
  percentOff: number | null; fixedPrice: Prisma.Decimal | null; enabled: boolean;
  createdAt: Date; resources: { resourceId: string }[];
}) {
  return {
    id: p.id, clubId: p.clubId, name: p.name,
    startDate: ymd(p.startDate), endDate: ymd(p.endDate),
    windowStart: p.windowStart, windowEnd: p.windowEnd,
    kind: p.kind, percentOff: p.percentOff,
    fixedPrice: p.fixedPrice != null ? p.fixedPrice.toFixed(2) : null,
    enabled: p.enabled, resourceIds: p.resources.map((r) => r.resourceId),
    createdAt: p.createdAt.toISOString(),
  };
}

/** Promo Prisma → ActivePromo (pour le pricing). */
function toActivePromo(p: {
  name: string; kind: PromotionKind; percentOff: number | null; fixedPrice: Prisma.Decimal | null;
  windowStart: number | null; windowEnd: number | null; resources: { resourceId: string }[];
}): ActivePromo {
  return {
    name: p.name, kind: p.kind, percentOff: p.percentOff,
    fixedPriceCents: p.fixedPrice != null ? Math.round(Number(p.fixedPrice) * 100) : null,
    windowStart: p.windowStart, windowEnd: p.windowEnd,
    resourceIds: p.resources.map((r) => r.resourceId),
  };
}

/** Promotions actives d'un club pour une date locale ('YYYY-MM-DD'). Filtre enabled + période. */
export async function loadActivePromotions(clubId: string, localDate: string): Promise<ActivePromo[]> {
  if (!isYmd(localDate)) return [];
  const day = dayUTC(localDate);
  const rows = await prisma.promotion.findMany({
    where: { clubId, enabled: true, startDate: { lte: day }, endDate: { gte: day } },
    include: { resources: { select: { resourceId: true } } },
  });
  return rows.map(toActivePromo);
}

export class PromotionService {
  async listPromotions(clubId: string) {
    const rows = await prisma.promotion.findMany({
      where: { clubId },
      orderBy: { startDate: 'desc' },
      include: { resources: { select: { resourceId: true } } },
    });
    return rows.map(toDTO);
  }

  /** Valide un corps (création OU état fusionné en màj). Lève VALIDATION_ERROR. */
  private async validate(clubId: string, b: PromotionBody): Promise<void> {
    if (!b.name?.trim())                              throw new Error('VALIDATION_ERROR');
    if (!isYmd(b.startDate) || !isYmd(b.endDate))     throw new Error('VALIDATION_ERROR');
    if (b.startDate! > b.endDate!)                    throw new Error('VALIDATION_ERROR'); // compare lexical = chrono
    if (b.kind !== 'PERCENT' && b.kind !== 'FIXED')   throw new Error('VALIDATION_ERROR');
    if (b.kind === 'PERCENT' && (!Number.isInteger(b.percentOff) || (b.percentOff as number) < 1 || (b.percentOff as number) > 100))
                                                      throw new Error('VALIDATION_ERROR');
    if (b.kind === 'FIXED' && (typeof b.fixedPrice !== 'number' || isNaN(b.fixedPrice) || b.fixedPrice < 0))
                                                      throw new Error('VALIDATION_ERROR');
    const hasWindow = b.windowStart != null || b.windowEnd != null;
    if (hasWindow) {
      if (!Number.isInteger(b.windowStart) || !Number.isInteger(b.windowEnd)) throw new Error('VALIDATION_ERROR');
      if ((b.windowStart as number) < 0 || (b.windowEnd as number) > 1440 || (b.windowStart as number) >= (b.windowEnd as number))
                                                      throw new Error('VALIDATION_ERROR');
    }
    if (b.resourceIds !== undefined) {
      if (!Array.isArray(b.resourceIds)) throw new Error('VALIDATION_ERROR');
      const ids = [...new Set(b.resourceIds)];
      if (ids.length > 0) {
        const owned = await prisma.resource.findMany({ where: { id: { in: ids }, clubId }, select: { id: true } });
        if (owned.length !== ids.length) throw new Error('VALIDATION_ERROR');
      }
    }
  }

  async createPromotion(clubId: string, body: PromotionBody) {
    await this.validate(clubId, body);
    const ids = [...new Set(body.resourceIds ?? [])];
    const created = await prisma.promotion.create({
      data: {
        clubId,
        name: body.name!.trim(),
        startDate: dayUTC(body.startDate!),
        endDate: dayUTC(body.endDate!),
        kind: body.kind as PromotionKind,
        percentOff: body.kind === 'PERCENT' ? body.percentOff! : null,
        fixedPrice: body.kind === 'FIXED' ? new Prisma.Decimal(body.fixedPrice!) : null,
        windowStart: body.windowStart ?? null,
        windowEnd: body.windowEnd ?? null,
        enabled: body.enabled ?? true,
        resources: { create: ids.map((resourceId) => ({ resourceId })) },
      },
      include: { resources: { select: { resourceId: true } } },
    });
    return toDTO(created);
  }

  async updatePromotion(id: string, clubId: string, body: PromotionBody) {
    const existing = await prisma.promotion.findUnique({
      where: { id }, include: { resources: { select: { resourceId: true } } },
    });
    if (!existing || existing.clubId !== clubId) throw new Error('PROMOTION_NOT_FOUND');

    // Revalide sur l'état fusionné (champs omis → existant).
    const merged: PromotionBody = {
      name: body.name ?? existing.name,
      startDate: body.startDate ?? ymd(existing.startDate),
      endDate: body.endDate ?? ymd(existing.endDate),
      kind: (body.kind ?? existing.kind) as 'PERCENT' | 'FIXED',
      percentOff: body.percentOff !== undefined ? body.percentOff : existing.percentOff,
      fixedPrice: body.fixedPrice !== undefined ? body.fixedPrice : (existing.fixedPrice != null ? Number(existing.fixedPrice) : null),
      windowStart: body.windowStart !== undefined ? body.windowStart : existing.windowStart,
      windowEnd: body.windowEnd !== undefined ? body.windowEnd : existing.windowEnd,
      resourceIds: body.resourceIds !== undefined ? body.resourceIds : existing.resources.map((r) => r.resourceId),
    };
    await this.validate(clubId, merged);

    const data: Prisma.PromotionUpdateInput = {};
    if (body.name !== undefined) data.name = body.name.trim();
    if (body.startDate !== undefined) data.startDate = dayUTC(body.startDate);
    if (body.endDate !== undefined) data.endDate = dayUTC(body.endDate);
    if (body.kind !== undefined) data.kind = body.kind as PromotionKind;
    if (body.kind !== undefined || body.percentOff !== undefined || body.fixedPrice !== undefined) {
      data.percentOff = merged.kind === 'PERCENT' ? merged.percentOff! : null;
      data.fixedPrice = merged.kind === 'FIXED' ? new Prisma.Decimal(merged.fixedPrice!) : null;
    }
    if (body.windowStart !== undefined) data.windowStart = body.windowStart;
    if (body.windowEnd !== undefined) data.windowEnd = body.windowEnd;
    if (body.enabled !== undefined) data.enabled = body.enabled;

    if (body.resourceIds !== undefined) {
      const ids = [...new Set(body.resourceIds)];
      await prisma.promotionResource.deleteMany({ where: { promotionId: id } });
      if (ids.length > 0) {
        await prisma.promotionResource.createMany({ data: ids.map((resourceId) => ({ promotionId: id, resourceId })) });
      }
    }

    const updated = await prisma.promotion.update({
      where: { id }, data, include: { resources: { select: { resourceId: true } } },
    });
    return toDTO(updated);
  }

  async deletePromotion(id: string, clubId: string) {
    const existing = await prisma.promotion.findUnique({ where: { id } });
    if (!existing || existing.clubId !== clubId) throw new Error('PROMOTION_NOT_FOUND');
    await prisma.promotion.delete({ where: { id } }); // cascade promotion_resources
    return { ok: true };
  }
}
```

- [ ] **Step 4 : Lancer les tests → succès**

Run: `node node_modules/jest/bin/jest.js promotion.service --silent`
Expected : PASS.

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/promotion.service.ts backend/src/services/__tests__/promotion.service.test.ts
git commit -m "feat(promotions): PromotionService (CRUD + validation + loadActivePromotions)"
```

---

## Task 4 : Routes admin CRUD

**Files:**
- Modify: `backend/src/routes/admin.ts`
- Test: `backend/src/routes/__tests__/admin.promotions.routes.test.ts`

- [ ] **Step 1 : Écrire les tests (échouent)**

`backend/src/routes/__tests__/admin.promotions.routes.test.ts` :

```ts
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';

const SECRET = process.env.JWT_SECRET!;
if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET manquant');
const token = (id = 'admin-1') => jwt.sign({ id, email: 'a@x.fr' }, SECRET, { expiresIn: '1h' });
const auth = { Authorization: `Bearer ${token()}` };
const base = '/api/clubs/club-demo/admin';

const memberRoles = (roles: Record<string, 'OWNER' | 'ADMIN' | 'STAFF'>) =>
  prismaMock.clubMember.findUnique.mockImplementation(((args: any) => {
    const userId = args?.where?.userId_clubId?.userId as string;
    const role = roles[userId];
    return Promise.resolve(role ? { userId, clubId: 'club-demo', role } : null);
  }) as any);

beforeEach(() => {
  jest.clearAllMocks();
  memberRoles({ 'admin-1': 'ADMIN', 'staff-1': 'STAFF' });
});

it('GET /promotions → 200 (liste)', async () => {
  prismaMock.promotion.findMany.mockResolvedValue([] as any);
  const res = await request(app).get(`${base}/promotions`).set(auth);
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
});

it('401 sans token', async () => {
  const res = await request(app).get(`${base}/promotions`);
  expect(res.status).toBe(401);
});

it('403 pour un STAFF (route ADMIN)', async () => {
  const res = await request(app).get(`${base}/promotions`).set({ Authorization: `Bearer ${token('staff-1')}` });
  expect(res.status).toBe(403);
});

it('POST /promotions → 201', async () => {
  prismaMock.promotion.create.mockResolvedValue({
    id: 'promo-1', clubId: 'club-demo', name: 'Été', startDate: new Date('2026-08-01T00:00:00Z'), endDate: new Date('2026-08-31T00:00:00Z'),
    windowStart: null, windowEnd: null, kind: 'PERCENT', percentOff: 20, fixedPrice: null, enabled: true, createdAt: new Date(), resources: [],
  } as any);
  const res = await request(app).post(`${base}/promotions`).set(auth)
    .send({ name: 'Été', startDate: '2026-08-01', endDate: '2026-08-31', kind: 'PERCENT', percentOff: 20, resourceIds: [] });
  expect(res.status).toBe(201);
  expect(res.body.id).toBe('promo-1');
});

it('POST /promotions invalide → 400', async () => {
  const res = await request(app).post(`${base}/promotions`).set(auth)
    .send({ name: '', startDate: '2026-08-01', endDate: '2026-08-31', kind: 'PERCENT', percentOff: 20 });
  expect(res.status).toBe(400);
  expect(res.body.error).toBe('VALIDATION_ERROR');
});

it('PATCH /promotions/:id d’un autre club → 404', async () => {
  prismaMock.promotion.findUnique.mockResolvedValue({ id: 'promo-1', clubId: 'autre', resources: [] } as any);
  const res = await request(app).patch(`${base}/promotions/promo-1`).set(auth).send({ enabled: false });
  expect(res.status).toBe(404);
  expect(res.body.error).toBe('PROMOTION_NOT_FOUND');
});

it('DELETE /promotions/:id → 200', async () => {
  prismaMock.promotion.findUnique.mockResolvedValue({ id: 'promo-1', clubId: 'club-demo' } as any);
  prismaMock.promotion.delete.mockResolvedValue({ id: 'promo-1' } as any);
  const res = await request(app).delete(`${base}/promotions/promo-1`).set(auth);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: true });
});
```

- [ ] **Step 2 : Lancer → échec**

Run: `node node_modules/jest/bin/jest.js admin.promotions.routes --silent`
Expected : FAIL (routes absentes → 404/handler manquant).

- [ ] **Step 3 : Câbler les routes + service + erreur**

Dans `backend/src/routes/admin.ts` :

1. Importer la classe en tête (près des autres imports de services) :
```ts
import { PromotionService } from '../services/promotion.service';
```

2. Instancier près des autres singletons (~ ligne 47-60) :
```ts
const promotionService = new PromotionService();
```

3. Ajouter `PROMOTION_NOT_FOUND: 404` dans le record `ERROR_STATUS` (~ ligne 67-128) :
```ts
  PROMOTION_NOT_FOUND: 404,
```

4. Ajouter la section de routes (ex. juste après les routes `/subscription-plans`, ~ ligne 897). **Toutes en `requireClubMember('ADMIN')`** :
```ts
// --- Promotions datées (remise sur terrains) ---
router.get('/promotions', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await promotionService.listPromotions(req.membership!.clubId)); } catch (e) { handleError(e, res, next); }
});
router.post('/promotions', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.status(201).json(await promotionService.createPromotion(req.membership!.clubId, req.body)); } catch (e) { handleError(e, res, next); }
});
router.patch('/promotions/:id', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await promotionService.updatePromotion(asString(req.params.id), req.membership!.clubId, req.body)); } catch (e) { handleError(e, res, next); }
});
router.delete('/promotions/:id', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await promotionService.deletePromotion(asString(req.params.id), req.membership!.clubId)); } catch (e) { handleError(e, res, next); }
});
```

- [ ] **Step 4 : Lancer → succès**

Run: `node node_modules/jest/bin/jest.js admin.promotions.routes --silent`
Expected : PASS.

- [ ] **Step 5 : Commit**

```bash
git add backend/src/routes/admin.ts backend/src/routes/__tests__/admin.promotions.routes.test.ts
git commit -m "feat(promotions): routes admin CRUD /promotions (ADMIN)"
```

---

## Task 5 : Intégration `availability` (prix affiché + originalPrice/promoName)

**Files:**
- Modify: `backend/src/services/availability.service.ts`
- Test: `backend/src/services/__tests__/availability.service.test.ts`

- [ ] **Step 1 : Écrire les tests (échouent)**

Dans `availability.service.test.ts` : (a) ajouter `clubId: 'club-1'` au mock `mockResource` (dans l'objet passé à `findUniqueOrThrow.mockResolvedValue`), (b) ajouter un **`beforeEach` de fichier (top-level, hors des deux `describe`)** qui pose le mock par défaut `prismaMock.promotion.findMany.mockResolvedValue([])` — sinon TOUS les tests existants (getAvailableSlots ET getClubAvailability) appelleraient le vrai loader et `.map` planterait sur `undefined`. Ajouter en tête du fichier, après les imports :

```ts
beforeEach(() => { prismaMock.promotion.findMany.mockResolvedValue([] as any); });
```

(Les `beforeEach` internes des `describe` qui font `service = new AvailabilityService()` restent inchangés — Jest exécute le `beforeEach` de fichier puis celui du describe.)

Puis ajouter :

```ts
it('applique une promo pourcentage au prix (originalPrice + promoName)', async () => {
  mockResource('Europe/Paris', { price: 25 });
  prismaMock.reservation.findMany.mockResolvedValue([]);
  prismaMock.promotion.findMany.mockResolvedValue([
    { name: 'Promo été', kind: 'PERCENT', percentOff: 20, fixedPrice: null, windowStart: null, windowEnd: null, resources: [] },
  ] as any);

  const slots = await service.getAvailableSlots('court-1', '2025-06-15', 60);

  expect(slots[0].price).toBe('20.00');
  expect(slots[0].originalPrice).toBe('25.00');
  expect(slots[0].promoName).toBe('Promo été');
});

it('sans promo → pas de originalPrice/promoName', async () => {
  mockResource('Europe/Paris', { price: 25 });
  prismaMock.reservation.findMany.mockResolvedValue([]);
  const slots = await service.getAvailableSlots('court-1', '2025-06-15', 60);
  expect(slots[0].price).toBe('25.00');
  expect(slots[0].originalPrice).toBeUndefined();
  expect(slots[0].promoName).toBeUndefined();
});
```

- [ ] **Step 2 : Lancer → échec**

Run: `node node_modules/jest/bin/jest.js availability.service --silent`
Expected : FAIL (`originalPrice`/`promoName` absents, `promotion.findMany` non appelé).

- [ ] **Step 3 : Implémenter**

Dans `backend/src/services/availability.service.ts` :

1. Import en tête :
```ts
import { slotPriceCents, classifySlot, effectiveSlotPriceCents, OffPeakHours, ActivePromo } from './pricing';
import { loadActivePromotions } from './promotion.service';
```

2. Étendre l'interface `TimeSlot` :
```ts
export interface TimeSlot {
  startTime: string;
  endTime: string;
  available: boolean;
  price: string;
  offPeak: boolean;
  originalPrice?: string; // prix de base (avant promo), présent seulement si remisé
  promoName?: string;     // nom de la promo appliquée, présent seulement si remisé
}
```

3. `getAvailableSlots` : ajouter le paramètre `promos?`, sélectionner `clubId`, charger les promos si absentes, appliquer le helper. Remplacer la signature et le corps concerné :
```ts
  async getAvailableSlots(
    resourceId: string,
    date: string,
    durationMinutes: number,
    promos?: ActivePromo[],
  ): Promise<TimeSlot[]> {
    const resource = await prisma.resource.findUniqueOrThrow({
      where: { id: resourceId },
      select: {
        openHour: true,
        closeHour: true,
        price: true,
        offPeakPrice: true,
        clubId: true,
        club: { select: { timezone: true, offPeakHours: true } },
      },
    });

    const tz = resource.club.timezone;
    const peak = resource.club.offPeakHours as OffPeakHours | null;
    const basePrice = Number(resource.price);
    const offPrice = resource.offPeakPrice != null ? Number(resource.offPeakPrice) : null;
    const activePromos = promos ?? await loadActivePromotions(resource.clubId, date);
```

Puis, dans la boucle, remplacer le calcul `priceCents` + le `slots.push` :
```ts
      const baseCents = slotPriceCents(
        peak, slotStart, slotEnd, tz,
        Math.round(basePrice * 100),
        offPrice != null ? Math.round(offPrice * 100) : null,
      );
      const { priceCents, promoName } = effectiveSlotPriceCents(baseCents, activePromos, resourceId, slotStart, slotEnd, tz);

      slots.push({
        startTime: cursor.toISO()!,
        endTime: cursor.plus({ minutes: durationMinutes }).toISO()!,
        available: !hasConflict,
        price: (priceCents / 100).toFixed(2),
        offPeak: classifySlot(peak, slotStart, slotEnd, tz) === 'OFF_PEAK',
        ...(priceCents < baseCents ? { originalPrice: (baseCents / 100).toFixed(2), promoName } : {}),
      });
```

4. `getClubAvailability` : charger les promos une fois et les passer :
```ts
  async getClubAvailability(clubId: string, date: string, durationMinutes: number, clubSportId?: string) {
    const resources = (await prisma.resource.findMany({ /* inchangé */ })).sort(bySortOrder);
    const promos = await loadActivePromotions(clubId, date);
    const result = [];
    for (const r of resources) {
      result.push({
        resource: { /* inchangé */ },
        slots: await this.getAvailableSlots(r.id, date, durationMinutes, promos),
      });
    }
    return result;
  }
```

- [ ] **Step 4 : Lancer → succès**

Run: `node node_modules/jest/bin/jest.js availability.service --silent`
Expected : PASS (nouveaux cas + anciens verts).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/availability.service.ts backend/src/services/__tests__/availability.service.test.ts
git commit -m "feat(promotions): grille de dispo applique les promos (originalPrice/promoName)"
```

---

## Task 6 : Intégration `holdSlot` (prix figé remisé)

**Files:**
- Modify: `backend/src/services/reservation.service.ts`
- Test: `backend/src/services/__tests__/reservation.service.test.ts`

- [ ] **Step 1 : Écrire le test (échoue)**

D'abord Read le `describe('holdSlot', ...)` existant dans `reservation.service.test.ts` pour réutiliser son échafaudage de mocks (redis, membership, transaction, `resource.findUniqueOrThrow`). Ajouter un cas qui reprend le happy-path et ajoute une promo. Modèle (adapter les mocks aux noms exacts du happy-path existant) :

```ts
it('holdSlot applique une promo % au totalPrice stocké', async () => {
  // Réutiliser tous les mocks du test happy-path holdSlot existant (resource 25€, membership OK, pas de conflit, transaction passthrough).
  // La resource sélectionnée doit exposer clubId + club.timezone/offPeakHours.
  prismaMock.promotion.findMany.mockResolvedValue([
    { name: 'Été', kind: 'PERCENT', percentOff: 20, fixedPrice: null, windowStart: null, windowEnd: null, resources: [] },
  ] as any);

  let createdData: any;
  prismaMock.reservation.create.mockImplementation((async (args: any) => { createdData = args.data; return { id: 'r1', ...args.data }; }) as any);
  prismaMock.reservationParticipant.createMany.mockResolvedValue({ count: 1 } as any);

  await service.holdSlot({
    resourceId: 'court-1', userId: 'u1',
    startTime: new Date('2026-08-15T16:00:00Z'), endTime: new Date('2026-08-15T17:00:00Z'),
  } as any);

  // 25€ − 20% = 20.00
  expect(Number(createdData.totalPrice)).toBe(20);
});
```

Ajouter aussi `prismaMock.promotion.findMany.mockResolvedValue([])` au `beforeEach` global de ce fichier de test pour que les autres cas holdSlot ne cassent pas.

- [ ] **Step 2 : Lancer → échec**

Run: `node node_modules/jest/bin/jest.js reservation.service --silent -t "holdSlot applique une promo"`
Expected : FAIL (`totalPrice` = 25, promo non appliquée).

- [ ] **Step 3 : Implémenter**

Dans `backend/src/services/reservation.service.ts` :

1. Compléter l'import pricing + ajouter le loader :
```ts
import { slotPriceCents, classifySlot, effectiveSlotPriceCents, OffPeakHours } from './pricing';
import { loadActivePromotions } from './promotion.service';
```

2. Dans `holdSlot`, remplacer le bloc « Prix du créneau » (~ ligne 278-285) :
```ts
      // Prix du créneau (tarif creux ssi entièrement en heures creuses), puis promotions actives.
      const baseCents = slotPriceCents(
        resource.club.offPeakHours as OffPeakHours | null,
        startTime, endTime, resource.club.timezone,
        Math.round(Number(resource.price) * 100),
        resource.offPeakPrice != null ? Math.round(Number(resource.offPeakPrice) * 100) : null,
      );
      const localDate = DateTime.fromJSDate(startTime, { zone: resource.club.timezone }).toISODate()!;
      const promos = await loadActivePromotions(resource.clubId, localDate);
      const { priceCents } = effectiveSlotPriceCents(baseCents, promos, resourceId, startTime, endTime, resource.club.timezone);
      const totalPrice = new Prisma.Decimal(priceCents).div(100);
```

(La variable `resource` sélectionne déjà `clubId` et `club.{timezone, offPeakHours}` — vérifié lignes 241-250. `DateTime` est déjà importé de luxon en tête du fichier.)

- [ ] **Step 4 : Lancer → succès**

Run: `node node_modules/jest/bin/jest.js reservation.service --silent`
Expected : PASS (nouveau cas + suite holdSlot existante verte).

- [ ] **Step 5 : Type-check backend + commit**

Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` (depuis `backend/`)
Expected : aucune erreur sur les fichiers touchés.

```bash
git add backend/src/services/reservation.service.ts backend/src/services/__tests__/reservation.service.test.ts
git commit -m "feat(promotions): holdSlot fige le totalPrice remisé"
```

---

## Task 7 : Front — `lib/api.ts` (types + méthodes + TimeSlot)

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1 : Étendre `TimeSlot`**

Dans l'interface `TimeSlot` (~ ligne 1456), ajouter :
```ts
  originalPrice?: string; // prix avant promo (présent si remisé)
  promoName?: string;     // nom de la promo (présent si remisé)
```

- [ ] **Step 2 : Ajouter le type `Promotion` + bodies**

Près des autres types admin (ex. après `PackageTemplate`) :
```ts
export interface Promotion {
  id: string;
  name: string;
  startDate: string;   // 'YYYY-MM-DD'
  endDate: string;     // 'YYYY-MM-DD'
  windowStart: number | null; // minutes depuis minuit
  windowEnd: number | null;
  kind: 'PERCENT' | 'FIXED';
  percentOff: number | null;
  fixedPrice: string | null;  // Decimal sérialisé (euros)
  enabled: boolean;
  resourceIds: string[];
  createdAt: string;
}
export type CreatePromotionBody = {
  name: string; startDate: string; endDate: string;
  kind: 'PERCENT' | 'FIXED'; percentOff?: number | null; fixedPrice?: number | null;
  windowStart?: number | null; windowEnd?: number | null; enabled?: boolean; resourceIds?: string[];
};
export type UpdatePromotionBody = Partial<CreatePromotionBody>;
```

- [ ] **Step 3 : Ajouter les méthodes CRUD**

Dans l'objet `api` (près des méthodes admin offres/abonnements) :
```ts
  adminGetPromotions: (clubId: string, token: string) =>
    request<Promotion[]>(`/api/clubs/${clubId}/admin/promotions`, {}, token),
  adminCreatePromotion: (clubId: string, body: CreatePromotionBody, token: string) =>
    request<Promotion>(`/api/clubs/${clubId}/admin/promotions`, { method: 'POST', body: JSON.stringify(body) }, token),
  adminUpdatePromotion: (clubId: string, id: string, body: UpdatePromotionBody, token: string) =>
    request<Promotion>(`/api/clubs/${clubId}/admin/promotions/${id}`, { method: 'PATCH', body: JSON.stringify(body) }, token),
  adminDeletePromotion: (clubId: string, id: string, token: string) =>
    request<{ ok: true }>(`/api/clubs/${clubId}/admin/promotions/${id}`, { method: 'DELETE' }, token),
```

- [ ] **Step 4 : Type-check + commit**

Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` (depuis `frontend/`)
Expected : aucune nouvelle erreur (filtrer sur `lib/api.ts` en cas de WIP parallèle).

```bash
git add frontend/lib/api.ts
git commit -m "feat(promotions): types + méthodes API + TimeSlot.originalPrice/promoName"
```

---

## Task 8 : Front — helpers purs `lib/adminPromotions.ts`

**Files:**
- Create: `frontend/lib/adminPromotions.ts`
- Test: `frontend/__tests__/adminPromotions.test.ts`

- [ ] **Step 1 : Écrire les tests (échouent)**

`frontend/__tests__/adminPromotions.test.ts` :

```ts
import { promoStatus, groupPromotions, discountLabel, windowLabel, targetLabel } from '../lib/adminPromotions';
import type { Promotion } from '../lib/api';

const mk = (o: Partial<Promotion>): Promotion => ({
  id: 'p', name: 'P', startDate: '2026-08-01', endDate: '2026-08-31', windowStart: null, windowEnd: null,
  kind: 'PERCENT', percentOff: 20, fixedPrice: null, enabled: true, resourceIds: [], createdAt: '2026-07-01T00:00:00Z', ...o,
});

describe('promoStatus', () => {
  const now = Date.parse('2026-08-15T12:00:00Z');
  it('en cours si now dans [start, end]', () => { expect(promoStatus(mk({}), now)).toBe('running'); });
  it('à venir si start futur', () => { expect(promoStatus(mk({ startDate: '2026-09-01', endDate: '2026-09-30' }), now)).toBe('upcoming'); });
  it('passée si end révolu', () => { expect(promoStatus(mk({ startDate: '2026-07-01', endDate: '2026-07-31' }), now)).toBe('past'); });
});

describe('groupPromotions', () => {
  it('range en running / upcoming / past', () => {
    const now = Date.parse('2026-08-15T12:00:00Z');
    const g = groupPromotions([mk({ id: 'a' }), mk({ id: 'b', startDate: '2026-09-01', endDate: '2026-09-30' }), mk({ id: 'c', startDate: '2026-07-01', endDate: '2026-07-31' })], now);
    expect(g.running.map(p => p.id)).toEqual(['a']);
    expect(g.upcoming.map(p => p.id)).toEqual(['b']);
    expect(g.past.map(p => p.id)).toEqual(['c']);
  });
});

describe('discountLabel', () => {
  it('% → "−20 %"', () => { expect(discountLabel(mk({ kind: 'PERCENT', percentOff: 20 }))).toBe('−20 %'); });
  it('fixe → "15 €"', () => { expect(discountLabel(mk({ kind: 'FIXED', percentOff: null, fixedPrice: '15.00' }))).toBe('15 €'); });
});

describe('windowLabel', () => {
  it('null si pas de fenêtre', () => { expect(windowLabel(mk({}))).toBeNull(); });
  it('"18h–20h" si fenêtre', () => { expect(windowLabel(mk({ windowStart: 1080, windowEnd: 1200 }))).toBe('18h–20h'); });
});

describe('targetLabel', () => {
  it('tous les terrains si vide', () => { expect(targetLabel(mk({ resourceIds: [] }), 5)).toBe('Tous les terrains'); });
  it('n terrains sinon', () => { expect(targetLabel(mk({ resourceIds: ['a', 'b'] }), 5)).toBe('2 terrains'); });
  it('accord singulier', () => { expect(targetLabel(mk({ resourceIds: ['a'] }), 5)).toBe('1 terrain'); });
});
```

- [ ] **Step 2 : Lancer → échec**

Run: `node node_modules/jest/bin/jest.js adminPromotions.test --silent` (depuis `frontend/`)
Expected : FAIL (module absent).

- [ ] **Step 3 : Implémenter**

`frontend/lib/adminPromotions.ts` :

```ts
import type { Promotion } from './api';

export type PromoStatus = 'upcoming' | 'running' | 'past';

/** Statut d'une promo vs un instant (ms). Bornes de dates incluses (jour entier). */
export function promoStatus(p: Promotion, nowMs: number): PromoStatus {
  const startMs = Date.parse(`${p.startDate}T00:00:00Z`);
  const endMs = Date.parse(`${p.endDate}T23:59:59Z`);
  if (nowMs < startMs) return 'upcoming';
  if (nowMs > endMs) return 'past';
  return 'running';
}

/** Groupe par statut ; running d'abord (début croissant), upcoming (début croissant), past (fin décroissante). */
export function groupPromotions(promos: Promotion[], nowMs: number) {
  const running: Promotion[] = [], upcoming: Promotion[] = [], past: Promotion[] = [];
  for (const p of promos) {
    const s = promoStatus(p, nowMs);
    (s === 'running' ? running : s === 'upcoming' ? upcoming : past).push(p);
  }
  running.sort((a, b) => a.startDate.localeCompare(b.startDate));
  upcoming.sort((a, b) => a.startDate.localeCompare(b.startDate));
  past.sort((a, b) => b.endDate.localeCompare(a.endDate));
  return { running, upcoming, past };
}

/** Libellé de remise : "−20 %" ou "15 €". */
export function discountLabel(p: Promotion): string {
  if (p.kind === 'PERCENT' && p.percentOff != null) return `−${p.percentOff} %`;
  if (p.kind === 'FIXED' && p.fixedPrice != null) return `${Number(p.fixedPrice)} €`;
  return '';
}

/** Libellé fenêtre horaire "18h–20h", ou null si toute la journée. */
export function windowLabel(p: Promotion): string | null {
  if (p.windowStart == null || p.windowEnd == null) return null;
  const h = (min: number) => { const hh = Math.floor(min / 60), mm = min % 60; return mm === 0 ? `${hh}h` : `${hh}h${String(mm).padStart(2, '0')}`; };
  return `${h(p.windowStart)}–${h(p.windowEnd)}`;
}

/** Libellé cible : "Tous les terrains" ou "N terrain(s)". */
export function targetLabel(p: Promotion, _totalCourts: number): string {
  const n = p.resourceIds.length;
  if (n === 0) return 'Tous les terrains';
  return `${n} terrain${n > 1 ? 's' : ''}`;
}
```

- [ ] **Step 4 : Lancer → succès**

Run: `node node_modules/jest/bin/jest.js adminPromotions.test --silent`
Expected : PASS.

- [ ] **Step 5 : Commit**

```bash
git add frontend/lib/adminPromotions.ts frontend/__tests__/adminPromotions.test.ts
git commit -m "feat(promotions): helpers purs adminPromotions (statut/groupage/libellés)"
```

---

## Task 9 : Front — page admin `/admin/promotions` + composants + nav

**Files:**
- Create: `frontend/app/admin/promotions/page.tsx`
- Create: `frontend/components/admin/promotions/PromotionCard.tsx`
- Create: `frontend/components/admin/promotions/PromotionForm.tsx`
- Modify: `frontend/app/admin/layout.tsx` (entrée nav)
- Test: `frontend/__tests__/AdminPromotions.test.tsx`

- [ ] **Step 1 : Ajouter l'entrée de nav**

Dans `frontend/app/admin/layout.tsx`, section `{ title: 'Finances', color: '#5bbd6e', items: [ ... ] }`, ajouter (après « Offres ») :
```tsx
      { href: '/admin/promotions', label: 'Promotions', icon: 'euro' },
```

- [ ] **Step 2 : `PromotionForm` (modale de création/édition)**

`frontend/components/admin/promotions/PromotionForm.tsx` — modale contrôlée qui émet un `CreatePromotionBody` ; la page fait create OU update. Champs : nom, période (2× `DateField`), interrupteur « Tous les terrains » ↔ cases de terrains (depuis `adminGetResources`), fenêtre optionnelle (2× `TimePicker`, `minuteChips={[0, 30]}`), type en chips `%`/`Prix fixe` + valeur, interrupteur « Activer ». Props :
```tsx
'use client';
import { useEffect, useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { DateField } from '@/components/ui/DateField';
import { TimePicker } from '@/components/ui/TimePicker';
import type { Promotion, CreatePromotionBody, AdminResource } from '@/lib/api';

export interface PromotionFormProps {
  open: boolean;
  editing?: Promotion;
  courts: AdminResource[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (body: CreatePromotionBody) => void;
}
```
Comportement clé (à implémenter dans le composant) :
- État local hydraté depuis `editing` dans un `useEffect` (nom, startDate/endDate en 'YYYY-MM-DD', `allCourts = editing.resourceIds.length === 0`, set des ids cochés, `hasWindow`, windowStart/End en 'HH:MM', kind, percentOff/fixedPrice, enabled). Vide si création.
- Conversion 'HH:MM' ↔ minutes : `toMin('18:00') = 1080` / `fromMin(1080) = '18:00'`.
- Au submit, construire le body : `resourceIds: allCourts ? [] : checkedIds`, `windowStart/End: hasWindow ? toMin(...) : null`, `percentOff/fixedPrice` selon `kind`. Appeler `onSubmit(body)`.
- Afficher `error` (bannière coral) ; désactiver le bouton quand `busy`.

> Détail visuel : suivre le langage de `OfferStudio` (fond modale `th.bgElev`, boutons pill). Pas de gabarit sombre.

- [ ] **Step 3 : `PromotionCard`**

`frontend/components/admin/promotions/PromotionCard.tsx` — carte liste montrant nom, période (`startDate → endDate`), `targetLabel`, `windowLabel` (si présent), `discountLabel` en gros, interrupteur `enabled`, boutons « Modifier » / « Supprimer ». Props :
```tsx
export interface PromotionCardProps {
  promo: Promotion;
  totalCourts: number;
  faded?: boolean;          // section « passées »
  busy: boolean;
  onEdit: () => void;
  onToggleEnabled: () => void;
  onDelete: () => void;
}
```
Utiliser `discountLabel/windowLabel/targetLabel` de `@/lib/adminPromotions`. Liseré latéral coloré selon statut (running=emerald, upcoming=apricot, past=faint). Estomper `opacity: .6` si `faded`.

- [ ] **Step 4 : La page**

`frontend/app/admin/promotions/page.tsx` — calquée sur `app/admin/packages/page.tsx` :
```tsx
'use client';
import { useState, useEffect, useCallback } from 'react';
import { api, Promotion, CreatePromotionBody, AdminResource } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { groupPromotions } from '@/lib/adminPromotions';
import { PromotionCard } from '@/components/admin/promotions/PromotionCard';
import { PromotionForm } from '@/components/admin/promotions/PromotionForm';

export default function AdminPromotionsPage() {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { club } = useClub();
  const clubId = club?.id;

  const [promos, setPromos] = useState<Promotion[]>([]);
  const [courts, setCourts] = useState<AdminResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nowMs, setNowMs] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Promotion | undefined>(undefined);

  const load = useCallback(async () => {
    if (!token || !clubId) return;
    setLoading(true);
    try {
      setError(null);
      const [ps, rs] = await Promise.all([api.adminGetPromotions(clubId, token), api.adminGetResources(clubId, token)]);
      setPromos(ps); setCourts(rs); setNowMs(Date.now());
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [token, clubId]);
  useEffect(() => { if (ready && token && clubId) load(); }, [ready, token, clubId, load]);

  const submit = async (body: CreatePromotionBody) => {
    if (!token || !clubId) return;
    setBusy(true);
    try {
      setError(null);
      if (editing) await api.adminUpdatePromotion(clubId, editing.id, body, token);
      else await api.adminCreatePromotion(clubId, body, token);
      setFormOpen(false); setEditing(undefined); await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const toggle = async (p: Promotion) => {
    if (!token || !clubId) return;
    setBusy(true);
    try { await api.adminUpdatePromotion(clubId, p.id, { enabled: !p.enabled }, token); await load(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const remove = async (p: Promotion) => {
    if (!token || !clubId) return;
    setBusy(true);
    try { await api.adminDeletePromotion(clubId, p.id, token); await load(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const groups = groupPromotions(promos, nowMs);
  // Rendu : <h1>Promotions</h1> + bouton « Créer une promotion » (openCreate) ;
  // bannière d'erreur ; loading / empty / sections « En cours » (running), « À venir » (upcoming),
  // « Passées » (past, faded) — chaque section masquée si vide — en grille de <PromotionCard/> ;
  // <PromotionForm open={formOpen} editing={editing} courts={courts} busy={busy} error={formOpen ? error : null}
  //   onClose={...} onSubmit={submit} />.
  // (Implémenter le JSX en suivant app/admin/packages/page.tsx.)
}
```

- [ ] **Step 5 : Écrire le test**

`frontend/__tests__/AdminPromotions.test.tsx` (modèle `AdminPackages.test.tsx`) :
```tsx
import { render, screen, waitFor } from '@testing-library/react';
import AdminPromotionsPage from '../app/admin/promotions/page';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));
jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'club-1' } }) }));
jest.mock('../lib/api', () => ({
  api: {
    adminGetPromotions: jest.fn(),
    adminGetResources: jest.fn(),
    adminCreatePromotion: jest.fn(),
    adminUpdatePromotion: jest.fn(),
    adminDeletePromotion: jest.fn(),
  },
}));
import { api } from '../lib/api';

const promo = {
  id: 'promo-1', name: 'Promo été', startDate: '2026-08-01', endDate: '2026-08-31',
  windowStart: null, windowEnd: null, kind: 'PERCENT', percentOff: 20, fixedPrice: null,
  enabled: true, resourceIds: [], createdAt: '2026-07-01T00:00:00Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  (api.adminGetPromotions as jest.Mock).mockResolvedValue([promo]);
  (api.adminGetResources as jest.Mock).mockResolvedValue([{ id: 'court-1', name: 'Court 1' }]);
});

const mount = () => render(<ThemeProvider><AdminPromotionsPage /></ThemeProvider>);

it('affiche le titre et la promo', async () => {
  mount();
  expect(await screen.findByRole('heading', { name: 'Promotions' })).toBeInTheDocument();
  expect(await screen.findByText('Promo été')).toBeInTheDocument();
});

it('charge les promotions et les terrains au montage', async () => {
  mount();
  await waitFor(() => expect(api.adminGetPromotions).toHaveBeenCalledWith('club-1', 'tok'));
  expect(api.adminGetResources).toHaveBeenCalledWith('club-1', 'tok');
});
```

- [ ] **Step 6 : Lancer les tests page + nav**

Run: `node node_modules/jest/bin/jest.js AdminPromotions AdminLayout --silent` (depuis `frontend/`)
Expected : PASS (AdminPromotions verts ; AdminLayout reste vert avec la nouvelle entrée).

- [ ] **Step 7 : Type-check + commit**

Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` (frontend)
Expected : aucune nouvelle erreur sur les fichiers touchés.

```bash
git add frontend/app/admin/promotions/ frontend/components/admin/promotions/ frontend/app/admin/layout.tsx frontend/__tests__/AdminPromotions.test.tsx
git commit -m "feat(promotions): page admin /admin/promotions (vitrine + studio) + nav"
```

---

## Task 10 : Front — affichage promo (grille cartes + BookingModal)

**Files:**
- Modify: `frontend/components/ClubReserve.tsx`
- Modify: `frontend/components/BookingModal.tsx`

- [ ] **Step 1 : Pastille promo sur la pill (ClubReserve)**

Dans `frontend/components/ClubReserve.tsx`, `renderSlot` : la pill disponible porte déjà une pastille d'angle heures creuses `{s.offPeak && resource.offPeakPrice && <span …>{Number(s.price)}€</span>}`. La remplacer par une pastille qui **préfère la promo** (coral, avec le prix remisé ; titre = nom de la promo) :
```tsx
{s.promoName ? (
  <span title={s.promoName} style={{ position: 'absolute', top: -7, right: -4, background: ACCENTS.coral, color: inkOn(ACCENTS.coral), fontFamily: th.fontUI, fontSize: 9.5, fontWeight: 800, lineHeight: 1.2, padding: '2px 7px', borderRadius: 999, boxShadow: '0 1px 3px rgba(0,0,0,.22)' }}>{Number(s.price)}€</span>
) : s.offPeak && resource.offPeakPrice ? (
  <span style={{ position: 'absolute', top: -7, right: -4, background: th.accentWarm, color: inkOn(th.accentWarm), fontFamily: th.fontUI, fontSize: 9.5, fontWeight: 800, lineHeight: 1.2, padding: '2px 7px', borderRadius: 999, boxShadow: '0 1px 3px rgba(0,0,0,.22)' }}>{Number(s.price)}€</span>
) : null}
```
S'assurer que `ACCENTS` est importé depuis `@/lib/theme` (l'ajouter à l'import existant si absent — `inkOn` l'est déjà).

> Note : la vue grille (`SportGrid.tsx`) n'affiche aucun prix par cellule (seulement l'en-tête de ligne) — pas de traitement promo par cellule. Le prix remisé y transite quand même vers `BookingModal` au tap (via `slot.price`).

- [ ] **Step 2 : Prix barré + badge dans BookingModal**

Dans `frontend/components/BookingModal.tsx`, en-tête (le bloc prix `{totalPrice}€`, ~ ligne 110) : ajouter, au-dessus du grand prix, un prix barré quand `slot.originalPrice && slot.promoName` :
```tsx
{slot.originalPrice && slot.promoName && (
  <div style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, textDecoration: 'line-through', lineHeight: 1 }}>{Number(slot.originalPrice)}€</div>
)}
```
Et, à côté du badge « heures creuses » (~ lignes 125-129), ajouter un badge au nom de la promo quand `slot.promoName` :
```tsx
{slot.promoName && (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 700, color: inkOn(ACCENTS.coral), background: ACCENTS.coral, borderRadius: 6, padding: '2px 7px' }}>{slot.promoName}</span>
)}
```
Vérifier les imports `ACCENTS`/`inkOn` depuis `@/lib/theme` (ajouter si absent).

- [ ] **Step 3 : Vérifier les suites Réserver + type-check**

Run: `node node_modules/jest/bin/jest.js ClubReserve BookingModal --silent` (frontend)
Expected : PASS (aucune assertion de couleur dans les suites existantes ; changements cosmétiques). Puis `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`.

> ⚠️ Rappel mémoire : en full-suite `jest`, ~6 échecs BookingModal sont un flake de pré-existant (isolation) ; vérifier BookingModal **en suite isolée**.

- [ ] **Step 4 : Commit**

```bash
git add frontend/components/ClubReserve.tsx frontend/components/BookingModal.tsx
git commit -m "feat(promotions): affichage prix barré + pastille promo (grille + modale)"
```

---

## Task 11 : Vérification finale (bout en bout)

- [ ] **Step 1 : Suites backend touchées**

Run (backend) : `node node_modules/jest/bin/jest.js pricing promotion.service admin.promotions.routes availability.service reservation.service --silent`
Expected : toutes PASS.

- [ ] **Step 2 : Suites frontend touchées**

Run (frontend) : `node node_modules/jest/bin/jest.js adminPromotions AdminPromotions AdminLayout ClubReserve BookingModal --silent`
Expected : toutes PASS (BookingModal en isolé).

- [ ] **Step 3 : Type-check des deux côtés**

Run : `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` (backend PUIS frontend)
Expected : aucune nouvelle erreur (filtrer sur les fichiers touchés en cas de WIP parallèle).

- [ ] **Step 4 : Fumée manuelle (optionnel mais recommandé)**

`start.ps1`, puis : créer une promo `−20%` « tous terrains » couvrant aujourd'hui dans `/admin/promotions`, ouvrir `/reserver` → vérifier la pastille coral sur les pills + le prix barré dans la modale ; confirmer une réservation → vérifier que le `totalPrice` enregistré est remisé (planning/Paiements). Vérifier CDP clair + sombre via la skill `verify`.

---

## Self-Review (couverture spec)

- Modèle `Promotion` + `PromotionResource` (période/terrains/fenêtre/%|fixe/enabled) → **Task 1**.
- Helper pur meilleur-prix + fenêtre « entièrement dedans » + `min` avec base → **Task 2**.
- CRUD + validation + garde club + loader date-filtré → **Task 3**, **Task 4**.
- Intégration prix (availability + holdSlot uniquement, cf. spec) → **Task 5**, **Task 6**.
- Front API/types/TimeSlot → **Task 7** ; helpers → **Task 8** ; page admin `/admin/promotions` + nav → **Task 9** ; affichage prix barré + pastille → **Task 10**.
- Hors périmètre respecté : pas de reschedule/repli-dû/stats, pas de récurrence hebdo, pas de par-sport, pas de code promo joueur, pas de rétroactif.
