# Sport à côté des abonnements/soldes/offres — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the sport(s) a subscription, wallet balance, or club-house offer applies to, everywhere a player or admin currently sees it, on multi-sport clubs only.

**Architecture:** `SubscriptionPlan`/`Subscription` already carry `sportKeys: string[]` but nothing renders it. `PackageTemplate` (carnets/porte-monnaie) gets a new **optional** `sportKeys String[] @default([])` column (empty = "all sports", no chip — unlike the mandatory `SubscriptionPlan.sportKeys`). `MemberPackage` stays column-less; it already joins the template live for its `name`, we add `sportKeys` to the same select. Four frontend surfaces (ProfileMenu, WalletSection, OffersShowcase, admin `/admin/packages`) resolve the keys to display names via a new pure helper and gate the chip on the existing `clubIsMultiSport(club)` check so mono-sport clubs see nothing new.

**Tech Stack:** Prisma 7 (PostgreSQL), Express 5, Next.js 16 / React 19, Jest + ts-jest, jest-mock-extended (`prismaMock`).

**Reference:** Spec at `docs/superpowers/specs/2026-07-05-sport-abonnements-soldes-offres-design.md`.

---

## Environment notes (read before starting)

- Run `npx jest` may fail with a shim error ("jest n'est pas reconnu") on this Windows box — if that happens, run `node node_modules/jest/bin/jest.js <args>` instead. Same for `tsc`: use `node node_modules/typescript/bin/tsc --noEmit` if `npx tsc` fails.
- Frontend: a full unscoped `npx jest` run shows ~6 pre-existing `BookingModal` failures unrelated to this work (test-isolation flake, passes in isolation). Verify with **scoped** test file paths, not the full suite, then confirm with `tsc --noEmit`.
- The dev DB has drift from several already-uncommitted, unrelated migrations (`prisma migrate status` will list ~10 pending ones). Do **not** run `prisma migrate dev` (destructive reset) or try to reconcile those. Apply only the new migration file directly with `prisma db execute --file <path>`.

---

### Task 1: Schema + migration — `PackageTemplate.sportKeys`

**Files:**
- Modify: `backend/prisma/schema.prisma` (`PackageTemplate` model, currently lines 872-892)
- Create: `backend/prisma/migrations/20260705140000_add_package_template_sport_keys/migration.sql`

- [ ] **Step 1: Add the field to the Prisma schema**

In `backend/prisma/schema.prisma`, inside `model PackageTemplate`, add `sportKeys` right after `walletAmount`:

```prisma
  entriesCount Int?        @map("entries_count")                    // si ENTRIES
  walletAmount Decimal?    @map("wallet_amount") @db.Decimal(10, 2) // si WALLET : montant crédité
  sportKeys    String[]    @default([]) @map("sport_keys")          // optionnel : [] = tous sports (affichage seulement, pas de gate fonctionnel)
  validityDays Int?        @map("validity_days")                    // null = sans expiration
```

- [ ] **Step 2: Write the migration file**

Create `backend/prisma/migrations/20260705140000_add_package_template_sport_keys/migration.sql`:

```sql
-- Sport(s) tagué(s) sur une offre carnet/porte-monnaie (affichage seulement, tableau vide = tous sports).
ALTER TABLE "package_templates" ADD COLUMN "sport_keys" TEXT[] NOT NULL DEFAULT '{}';
```

- [ ] **Step 3: Apply the migration to the dev DB and regenerate the client**

Run (from `backend/`):
```bash
npx prisma db execute --file prisma/migrations/20260705140000_add_package_template_sport_keys/migration.sql
npx prisma generate
```
Expected: both report success; `node_modules/.prisma/client` regenerated with `sportKeys` on `PackageTemplate`.

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260705140000_add_package_template_sport_keys
git commit -m "feat(packages): sportKeys optionnel sur PackageTemplate"
```

---

### Task 2: Backend — `PackageService.createTemplate` accepts `sportKeys`

**Files:**
- Modify: `backend/src/services/package.service.ts:29-56` (`createTemplate`)
- Test: `backend/src/services/__tests__/package.service.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to the `describe('PackageService — offres (templates)', ...)` block in `backend/src/services/__tests__/package.service.test.ts`, right before its closing `});` (after the last existing test, `'updateTemplate avec imageUrl:null supprime le fichier existant'`):

```ts
  it('crée une offre avec sportKeys validés', async () => {
    prismaMock.sport.findMany.mockResolvedValue([{ key: 'padel' }, { key: 'tennis' }] as any);
    prismaMock.packageTemplate.create.mockResolvedValue({ id: 'tpl-4' } as any);
    await service.createTemplate('club-1', { kind: 'ENTRIES', name: '10 entrées', price: 200, entriesCount: 10, sportKeys: ['padel'] });
    expect(prismaMock.packageTemplate.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sportKeys: ['padel'] }),
    }));
  });

  it('sportKeys absent → tableau vide par défaut (générique, tous sports)', async () => {
    prismaMock.packageTemplate.create.mockResolvedValue({ id: 'tpl-5' } as any);
    await service.createTemplate('club-1', { kind: 'ENTRIES', name: '10 entrées', price: 200, entriesCount: 10 });
    expect(prismaMock.packageTemplate.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sportKeys: [] }),
    }));
    expect(prismaMock.sport.findMany).not.toHaveBeenCalled(); // pas de validation si absent
  });

  it('refuse un sportKeys avec une clé inconnue', async () => {
    prismaMock.sport.findMany.mockResolvedValue([{ key: 'padel' }] as any);
    await expect(service.createTemplate('club-1', { kind: 'ENTRIES', name: 'x', price: 200, entriesCount: 10, sportKeys: ['squash'] }))
      .rejects.toThrow('VALIDATION_ERROR');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `backend/`): `node node_modules/jest/bin/jest.js src/services/__tests__/package.service.test.ts -t "sportKeys"`
Expected: FAIL — `sportKeys` not accepted / not written to `data`.

- [ ] **Step 3: Implement**

Replace the `createTemplate` method in `backend/src/services/package.service.ts`:

```ts
  async createTemplate(clubId: string, body: {
    kind?: string; name?: string; description?: string | null; price?: number;
    entriesCount?: number; walletAmount?: number; validityDays?: number | null; sportKeys?: string[];
  }) {
    const { kind, name, description, price, entriesCount, walletAmount, validityDays, sportKeys } = body;
    if (kind !== 'ENTRIES' && kind !== 'WALLET')                          throw new Error('VALIDATION_ERROR');
    if (!name?.trim())                                                    throw new Error('VALIDATION_ERROR');
    if (typeof price !== 'number' || isNaN(price) || price <= 0)          throw new Error('VALIDATION_ERROR');
    if (kind === 'ENTRIES' && (!Number.isInteger(entriesCount) || (entriesCount as number) <= 0))
                                                                          throw new Error('VALIDATION_ERROR');
    if (kind === 'WALLET' && (typeof walletAmount !== 'number' || isNaN(walletAmount) || walletAmount <= 0))
                                                                          throw new Error('VALIDATION_ERROR');
    if (validityDays != null && (!Number.isInteger(validityDays) || validityDays <= 0))
                                                                          throw new Error('VALIDATION_ERROR');
    if (sportKeys !== undefined) {
      if (!Array.isArray(sportKeys))                                     throw new Error('VALIDATION_ERROR');
      if (sportKeys.length > 0) {
        const known = await prisma.sport.findMany({ where: { key: { in: sportKeys } }, select: { key: true } });
        const knownKeys = new Set(known.map(s => s.key));
        if (!sportKeys.every(k => knownKeys.has(k)))                     throw new Error('VALIDATION_ERROR');
      }
    }

    return prisma.packageTemplate.create({
      data: {
        clubId,
        kind: kind as PackageKind,
        name: name.trim(),
        description: description?.trim() || null,
        price: new Prisma.Decimal(price),
        entriesCount: kind === 'ENTRIES' ? (entriesCount as number) : null,
        walletAmount: kind === 'WALLET' ? new Prisma.Decimal(walletAmount as number) : null,
        validityDays: validityDays ?? null,
        sportKeys: sportKeys ?? [],
      },
    });
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node node_modules/jest/bin/jest.js src/services/__tests__/package.service.test.ts`
Expected: PASS, all tests in the file (including the pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/package.service.ts backend/src/services/__tests__/package.service.test.ts
git commit -m "feat(packages): createTemplate valide et persiste sportKeys"
```

---

### Task 3: Backend — `listMyPackagesBySlug` exposes `template.sportKeys`

**Files:**
- Modify: `backend/src/services/package.service.ts` (`listMyPackagesBySlug`, currently lines 201-217)
- Test: `backend/src/services/__tests__/package.service.test.ts`

- [ ] **Step 1: Write the failing test**

Add to the `describe('PackageService — consommation & soldes', ...)` block in `backend/src/services/__tests__/package.service.test.ts`:

```ts
  it('listMyPackagesBySlug sélectionne sportKeys du template', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'c1', status: 'ACTIVE' } as any);
    prismaMock.memberPackage.findMany.mockResolvedValue([] as any);
    await service.listMyPackagesBySlug('padel-arena', 'user-1');
    const arg = prismaMock.memberPackage.findMany.mock.calls[0][0] as any;
    expect(arg.include.template.select).toEqual({ name: true, sportKeys: true });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/jest/bin/jest.js src/services/__tests__/package.service.test.ts -t "listMyPackagesBySlug sélectionne"`
Expected: FAIL — `arg.include.template.select` is `{ name: true }`, missing `sportKeys`.

- [ ] **Step 3: Implement**

In `backend/src/services/package.service.ts`, change the `include` in `listMyPackagesBySlug`:

```ts
      orderBy: { purchasedAt: 'asc' },
      include: { template: { select: { name: true, sportKeys: true } } },
    });
  }
```

(This is the only `include`/`select` touched — `listMemberPackages` and `listActiveByClub` stay as-is, they feed admin surfaces out of scope for this feature.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_modules/jest/bin/jest.js src/services/__tests__/package.service.test.ts`
Expected: PASS (full file).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/package.service.ts backend/src/services/__tests__/package.service.test.ts
git commit -m "feat(packages): expose sportKeys du template dans listMyPackagesBySlug"
```

---

### Task 4: Backend — `OfferService.listPublicOffers` exposes package `sportKeys`

**Files:**
- Modify: `backend/src/services/offer.service.ts:29-33`
- Test: `backend/src/services/__tests__/offer.service.test.ts`

- [ ] **Step 1: Write the failing test**

Modify the existing test `'opt-in → plans + packages actifs, onlinePurchase reflète Stripe ACTIVE'` in `backend/src/services/__tests__/offer.service.test.ts` — change the `packageTemplate.findMany` assertion:

```ts
    expect(prismaMock.packageTemplate.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ description: true, imageUrl: true, sportKeys: true }),
    }));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/jest/bin/jest.js src/services/__tests__/offer.service.test.ts -t "opt-in"`
Expected: FAIL — `select` doesn't contain `sportKeys: true`.

- [ ] **Step 3: Implement**

In `backend/src/services/offer.service.ts`, add `sportKeys: true` to the `packageTemplate.findMany` select:

```ts
      prisma.packageTemplate.findMany({
        where: { clubId: club.id, isActive: true },
        orderBy: { price: 'asc' },
        select: { id: true, name: true, description: true, imageUrl: true, kind: true, price: true, entriesCount: true, walletAmount: true, validityDays: true, sportKeys: true },
      }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_modules/jest/bin/jest.js src/services/__tests__/offer.service.test.ts`
Expected: PASS (full file).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/offer.service.ts backend/src/services/__tests__/offer.service.test.ts
git commit -m "feat(offers): expose sportKeys des carnets dans listPublicOffers"
```

---

### Task 5: Frontend types — `lib/api.ts`

**Files:**
- Modify: `frontend/lib/api.ts` (`PackageTemplate`, `MemberPackage`, `PublicPackageTemplate`, `CreatePackageTemplateBody`)
- Fix (compile-only, no behavior change): `frontend/__tests__/WalletSection.test.tsx`, `frontend/__tests__/packages.test.ts`, `frontend/__tests__/BookingModal.packages.test.tsx`, `frontend/__tests__/OffersShowcase.test.tsx`

This task only widens types and repairs the object literals that are explicitly typed against them (`MemberPackage`, `PublicOffers`) so the frontend keeps compiling. No behavior changes yet — those come in later tasks.

- [ ] **Step 1: Widen the types**

In `frontend/lib/api.ts`, update `PackageTemplate` (currently lines 1671-1683):

```ts
export interface PackageTemplate {
  id: string;
  kind: PackageKind;
  name: string;
  description: string | null;
  imageUrl: string | null;
  sportKeys: string[];
  price: string;
  entriesCount: number | null;
  walletAmount: string | null;
  validityDays: number | null;
  isActive: boolean;
  createdAt: string;
}
```

Update `MemberPackage` (currently lines 1685-1695):

```ts
export interface MemberPackage {
  id: string;
  kind: PackageKind;
  creditsTotal: number | null;
  creditsRemaining: number | null;
  amountTotal: string | null;
  amountRemaining: string | null;
  purchasedAt: string;
  expiresAt: string | null;
  template: { name: string; sportKeys: string[] };
}
```

Update `CreatePackageTemplateBody` (currently lines 1761-1764):

```ts
export type CreatePackageTemplateBody = {
  kind: PackageKind; name: string; description?: string | null; price: number;
  entriesCount?: number; walletAmount?: number; validityDays?: number | null; sportKeys?: string[];
};
```

Update `PublicPackageTemplate` (currently lines 1800-1803):

```ts
export interface PublicPackageTemplate {
  id: string; name: string; description: string | null; imageUrl: string | null; kind: 'ENTRIES' | 'WALLET'; price: string;
  entriesCount: number | null; walletAmount: string | null; validityDays: number | null; sportKeys: string[];
}
```

- [ ] **Step 2: Run tsc to see the resulting compile errors**

Run (from `frontend/`): `node node_modules/typescript/bin/tsc --noEmit`
Expected: errors in `__tests__/WalletSection.test.tsx`, `__tests__/packages.test.ts`, `__tests__/BookingModal.packages.test.tsx`, `__tests__/OffersShowcase.test.tsx` — object literals missing `sportKeys`. (`__tests__/ProfileMenu.test.tsx` will **not** error — its `api` mock is typed as `Record<string, jest.Mock>`, not checked against `MemberPackage`; it still needs a fix in Task 7 to avoid a *runtime* crash, not a compile error.)

- [ ] **Step 3: Fix `frontend/__tests__/WalletSection.test.tsx`**

Change line 9:
```ts
const wallet: MemberPackage = { id: 'w1', kind: 'WALLET', creditsTotal: null, creditsRemaining: null, amountTotal: '50.00', amountRemaining: '53.50', purchasedAt: '2026-01-01', expiresAt: null, template: { name: 'Porte-monnaie', sportKeys: [] } };
```

- [ ] **Step 4: Fix `frontend/__tests__/packages.test.ts`**

Update the 4 factory functions (lines 4-14, 89-98) to include `sportKeys: []` in every `template` object:

```ts
const entries = (remaining: number, expiresAt: string | null = null): MemberPackage => ({
  id: 'p1', kind: 'ENTRIES', creditsTotal: 10, creditsRemaining: remaining,
  amountTotal: null, amountRemaining: null, purchasedAt: '2026-06-01T00:00:00Z',
  expiresAt, template: { name: '10 entrées', sportKeys: [] },
});

const wallet = (remaining: string): MemberPackage => ({
  id: 'p2', kind: 'WALLET', creditsTotal: null, creditsRemaining: null,
  amountTotal: '200.00', amountRemaining: remaining, purchasedAt: '2026-06-01T00:00:00Z',
  expiresAt: null, template: { name: 'Avoir 200 €', sportKeys: [] },
});
```

and:

```ts
const mkWallet = (over: Partial<MemberPackage> = {}): MemberPackage => ({
  id: 'pk-w', kind: 'WALLET', creditsTotal: null, creditsRemaining: null,
  amountTotal: '130.00', amountRemaining: '130.00', purchasedAt: '', expiresAt: null,
  template: { name: 'Porte-monnaie', sportKeys: [] }, ...over,
} as MemberPackage);
const mkCarnet = (over: Partial<MemberPackage> = {}): MemberPackage => ({
  id: 'pk-c', kind: 'ENTRIES', creditsTotal: 10, creditsRemaining: 5,
  amountTotal: null, amountRemaining: null, purchasedAt: '', expiresAt: null,
  template: { name: 'Carnet', sportKeys: [] }, ...over,
} as MemberPackage);
```

- [ ] **Step 5: Fix `frontend/__tests__/BookingModal.packages.test.tsx`**

Update lines 32-42:

```ts
const pkg: MemberPackage = {
  id: 'pkg-1', kind: 'ENTRIES', creditsTotal: 10, creditsRemaining: 7,
  amountTotal: null, amountRemaining: null, purchasedAt: '2026-06-01T00:00:00Z',
  expiresAt: null, template: { name: '10 entrées', sportKeys: [] },
};

const poorWallet: MemberPackage = {
  id: 'w-1', kind: 'WALLET', creditsTotal: null, creditsRemaining: null,
  amountTotal: '10.00', amountRemaining: '10.00', purchasedAt: '2026-06-01T00:00:00Z',
  expiresAt: null, template: { name: 'Porte-monnaie', sportKeys: [] },
};
```

- [ ] **Step 6: Fix `frontend/__tests__/OffersShowcase.test.tsx`**

Update line 22 (the `packages` array in the `offers` fixture):

```ts
  packages: [{ id: 'tp1', name: 'Carnet 10', description: null, imageUrl: null, kind: 'ENTRIES', price: '90.00', entriesCount: 10, walletAmount: null, validityDays: 365, sportKeys: [] }],
```

- [ ] **Step 7: Run tsc again to confirm it's clean**

Run: `node node_modules/typescript/bin/tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Run the touched suites to confirm no runtime regressions**

Run: `node node_modules/jest/bin/jest.js packages.test.ts WalletSection.test.tsx BookingModal.packages.test.tsx OffersShowcase.test.tsx`
Expected: all PASS (these are pure type fixes, behavior unchanged).

- [ ] **Step 9: Commit**

```bash
git add frontend/lib/api.ts frontend/__tests__/WalletSection.test.tsx frontend/__tests__/packages.test.ts frontend/__tests__/BookingModal.packages.test.tsx frontend/__tests__/OffersShowcase.test.tsx
git commit -m "chore(types): sportKeys sur PackageTemplate/MemberPackage/PublicPackageTemplate"
```

---

### Task 6: Frontend — `sportNames` helper in `lib/sportBadge.ts`

**Files:**
- Modify: `frontend/lib/sportBadge.ts`
- Test: `frontend/__tests__/sportBadge.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `frontend/__tests__/sportBadge.test.ts`:

```ts
import { clubIsMultiSport, setSpansMultipleSports, sportNames } from '@/lib/sportBadge';
```

(replace the existing import line), then add a new `it` inside the `describe('sportBadge', ...)` block:

```ts
  it('sportNames : résout les clés via clubSports, repli sur la clé brute', () => {
    const club = { clubSports: [{ sport: { key: 'padel', name: 'Padel' } }, { sport: { key: 'tennis', name: 'Tennis' } }] };
    expect(sportNames(club, ['padel', 'tennis'])).toEqual(['Padel', 'Tennis']);
    expect(sportNames(club, ['squash'])).toEqual(['squash']); // clé inconnue → repli brut
    expect(sportNames(null, ['padel'])).toEqual(['padel']);
    expect(sportNames({}, ['padel'])).toEqual(['padel']); // clubSports absent → pas de crash
    expect(sportNames(club, [])).toEqual([]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/jest/bin/jest.js sportBadge.test.ts`
Expected: FAIL — `sportNames` is not exported.

- [ ] **Step 3: Implement**

Add to `frontend/lib/sportBadge.ts` (end of file):

```ts
/** Résout des clés sport en noms affichables via les sports actifs du club — repli sur la clé
 *  brute si introuvable (sport désactivé entre-temps, catalogue non chargé, etc.). */
export function sportNames(
  club: { clubSports?: { sport: { key: string; name: string } }[] } | null | undefined,
  keys: string[],
): string[] {
  return keys.map((k) => club?.clubSports?.find((cs) => cs.sport.key === k)?.sport.name ?? k);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_modules/jest/bin/jest.js sportBadge.test.ts`
Expected: PASS (full file).

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/sportBadge.ts frontend/__tests__/sportBadge.test.ts
git commit -m "feat(sport): helper sportNames (clés → noms affichables)"
```

---

### Task 7: Frontend — `ProfileMenu.tsx` shows sport next to soldes/abonnements

**Files:**
- Modify: `frontend/components/ProfileMenu.tsx:1-14, 136-151`
- Test: `frontend/__tests__/ProfileMenu.test.tsx`

- [ ] **Step 1: Widen the test's club type and fix the existing multi-sport-unsafe fixture**

In `frontend/__tests__/ProfileMenu.test.tsx`, change the `clubCtx` type declaration (currently line 11):

```ts
let clubCtx: { slug: string | null; club: { id: string; slug: string; name: string; clubSports?: { id: string; sport: { key: string; name: string } }[] } | null; loading: boolean } =
  { slug: null, club: null, loading: false };
```

Then fix the existing test `'hôte club : chip Abonné et soldes utilisables'` (currently lines 119-122) so the `template` objects carry `sportKeys` — this club stays mono-sport (no `clubSports` override) so the chip won't show, but the field must exist so the component's `.length` access doesn't crash at runtime once Step 3 lands:

```ts
    api.getMyClubPackages.mockResolvedValue([
      { id: 'p1', kind: 'ENTRIES', creditsTotal: 10, creditsRemaining: 7, amountTotal: null, amountRemaining: null, purchasedAt: '2026-01-01', expiresAt: null, template: { name: 'Carnet 10', sportKeys: [] } },
      { id: 'p2', kind: 'ENTRIES', creditsTotal: 10, creditsRemaining: 0, amountTotal: null, amountRemaining: null, purchasedAt: '2026-01-01', expiresAt: null, template: { name: 'Carnet épuisé', sportKeys: [] } },
    ]);
```

- [ ] **Step 2: Write the new failing test**

Add a new test right after `'hôte club : chip Abonné et soldes utilisables'`:

```ts
  it('club multi-sport : le sport apparaît à côté des soldes et abonnements', async () => {
    document.cookie = 'token=abc; path=/';
    clubCtx = {
      slug: 'demo', loading: false,
      club: { id: 'c1', slug: 'demo', name: 'Club Démo', clubSports: [
        { id: 'cs1', sport: { key: 'padel', name: 'Padel' } },
        { id: 'cs2', sport: { key: 'tennis', name: 'Tennis' } },
      ] },
    };
    api.getMyClubPackages.mockResolvedValue([
      { id: 'p1', kind: 'WALLET', creditsTotal: null, creditsRemaining: null, amountTotal: '100', amountRemaining: '90', purchasedAt: '2026-01-01', expiresAt: null, template: { name: 'Avoir', sportKeys: ['tennis'] } },
    ]);
    api.getMyClubSubscriptions.mockResolvedValue([
      { id: 's1', planId: 'pl1', status: 'ACTIVE', startedAt: '2026-01-01', expiresAt: '2027-01-01', monthlyPriceSnapshot: '30', sportKeys: ['padel'], offPeakOnly: true, benefit: 'INCLUDED', discountPercent: null, dailyCap: null, weeklyCap: null, plan: { name: 'Abonnement Padel' } },
    ]);
    wrap();
    openMenu();
    expect(await screen.findByText('Porte-monnaie — 90,00 € · Tennis')).toBeInTheDocument();
    expect(screen.getByText('Abonnement Padel · Padel')).toBeInTheDocument();
  });
```

- [ ] **Step 3: Run tests to verify the new one fails**

Run: `node node_modules/jest/bin/jest.js ProfileMenu.test.tsx -t "multi-sport"`
Expected: FAIL — text `'Porte-monnaie — 90,00 € · Tennis'` not found (currently rendered without the suffix).

- [ ] **Step 4: Implement**

In `frontend/components/ProfileMenu.tsx`, add the import (next to the existing `packageLabel` import, currently line 11):

```ts
import { packageLabel, isUsable } from '@/lib/packages';
import { clubIsMultiSport, sportNames } from '@/lib/sportBadge';
```

Replace the soldes and abonnements rendering (currently lines 134-151):

```tsx
          {/* Soldes prépayés du club courant */}
          {soldes.length > 0 && (
            <div style={{ borderBottom: `1px solid ${th.line}`, paddingBottom: 10 }}>
              <div style={sectionTitle}>Mes soldes</div>
              <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 4, fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute }}>
                {soldes.map((p) => {
                  const sport = clubIsMultiSport(club) && p.template.sportKeys.length > 0
                    ? ` · ${sportNames(club, p.template.sportKeys).join(', ')}` : '';
                  return <span key={p.id}>{packageLabel(p)}{sport}</span>;
                })}
              </div>
            </div>
          )}

          {/* Abonnements actifs du club courant */}
          {subs.length > 0 && (
            <div style={{ borderBottom: `1px solid ${th.line}`, paddingBottom: 10 }}>
              <div style={sectionTitle}>Mes abonnements</div>
              <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 4, fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute }}>
                {subs.map((s) => {
                  const sport = clubIsMultiSport(club) && s.sportKeys.length > 0
                    ? ` · ${sportNames(club, s.sportKeys).join(', ')}` : '';
                  return <span key={s.id}>{s.plan.name}{sport}</span>;
                })}
              </div>
            </div>
          )}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node node_modules/jest/bin/jest.js ProfileMenu.test.tsx`
Expected: PASS (full file).

- [ ] **Step 6: Commit**

```bash
git add frontend/components/ProfileMenu.tsx frontend/__tests__/ProfileMenu.test.tsx
git commit -m "feat(profile-menu): affiche le sport a cote des soldes/abonnements (clubs multi-sport)"
```

---

### Task 8: Frontend — `WalletSection.tsx` shows sport next to soldes/abonnements

**Files:**
- Modify: `frontend/components/profile/WalletSection.tsx`
- Test: `frontend/__tests__/WalletSection.test.tsx`

- [ ] **Step 1: Add a controllable `useClub` mock and write the failing test**

At the top of `frontend/__tests__/WalletSection.test.tsx`, add (after the existing `ThemeProvider` mock):

```ts
let clubCtx: { slug: string | null; club: { clubSports?: { sport: { key: string; name: string } }[] } | null; loading: boolean } =
  { slug: null, club: null, loading: false };
jest.mock('@/lib/ClubProvider', () => ({ useClub: () => clubCtx }));
```

Add a `beforeEach` to reset it before each test (Jest runs tests in this file top-to-bottom otherwise carrying state across):

```ts
beforeEach(() => { clubCtx = { slug: null, club: null, loading: false }; });
```

Then add a new test after the existing two:

```ts
it('club multi-sport : sport affiché à côté du solde et de l’abonnement', () => {
  clubCtx = { slug: 'demo', loading: false, club: { clubSports: [{ sport: { key: 'padel', name: 'Padel' } }, { sport: { key: 'tennis', name: 'Tennis' } }] } };
  const taggedWallet: MemberPackage = { ...wallet, template: { name: 'Porte-monnaie', sportKeys: ['tennis'] } };
  const taggedSub = { ...sub, sportKeys: ['padel'] } as Subscription;
  render(<WalletSection packages={[taggedWallet]} subscriptions={[taggedSub]} />);
  expect(screen.getByText(/Porte-monnaie.*· Tennis/)).toBeInTheDocument();
  expect(screen.getByText('Mensuel · Padel')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/jest/bin/jest.js WalletSection.test.tsx -t "multi-sport"`
Expected: FAIL — no `· Tennis`/`· Padel` suffix rendered yet.

- [ ] **Step 3: Implement**

In `frontend/components/profile/WalletSection.tsx`, add imports:

```ts
import { useClub } from '@/lib/ClubProvider';
import { clubIsMultiSport, sportNames } from '@/lib/sportBadge';
```

Update the component body — add `club`/`multiSport` right after the `useTheme()` call, and use them in both `.map()` calls:

```tsx
export function WalletSection({ packages, subscriptions }: Props) {
  const { th } = useTheme();
  const { club } = useClub();
  const multiSport = clubIsMultiSport(club);

  if (packages.length === 0 && subscriptions.length === 0) {
    return <AccountEmpty icon="wallet" title="Aucun abonnement ni solde prépayé"
      hint="Vos abonnements et carnets de ce club s’afficheront ici." />;
  }

  const row: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 12,
    background: th.surface2, borderRadius: 13, padding: '11px 13px',
  };
  const tile = (accent: boolean): React.CSSProperties => ({
    width: 36, height: 36, flexShrink: 0, borderRadius: 10,
    background: accent ? th.accent : th.surface,
    boxShadow: accent ? 'none' : `inset 0 0 0 1px ${th.line}`,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  });
  const name: React.CSSProperties = { fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, color: th.text };
  const meta: React.CSSProperties = { fontFamily: th.fontUI, fontSize: 12.5, color: th.textFaint };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {subscriptions.map((s) => {
        const sport = multiSport && s.sportKeys.length > 0 ? ` · ${sportNames(club, s.sportKeys).join(', ')}` : '';
        return (
          <div key={s.id} style={row}>
            <span aria-hidden="true" style={tile(true)}><Icon name="check" size={18} color={th.onAccent} /></span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
              <span style={name}>{s.plan.name}{sport}</span>
              <span style={meta}>{s.benefit === 'INCLUDED' ? 'Inclus' : `-${s.discountPercent ?? 0}%`}</span>
            </div>
            <span style={{ ...meta, flexShrink: 0 }}>jusqu’au {new Date(s.expiresAt).toLocaleDateString('fr-FR')}</span>
          </div>
        );
      })}

      {packages.map((p) => {
        const usable = isUsable(p);
        const sport = multiSport && p.template.sportKeys.length > 0 ? ` · ${sportNames(club, p.template.sportKeys).join(', ')}` : '';
        return (
          <div key={p.id} style={row}>
            <span aria-hidden="true" style={tile(false)}>
              <Icon name={p.kind === 'ENTRIES' ? 'ticket' : 'wallet'} size={18} color={usable ? th.textMute : th.textFaint} />
            </span>
            <span style={{ ...name, flex: 1, minWidth: 0, color: usable ? th.text : th.textFaint }}>{packageLabel(p)}{sport}</span>
            {!usable && <span style={{ ...meta, flexShrink: 0 }}>expiré / épuisé</span>}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node node_modules/jest/bin/jest.js WalletSection.test.tsx`
Expected: PASS (full file, including the pre-existing 2 tests — `clubCtx.club` defaults to `null` so they're unaffected).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/profile/WalletSection.tsx frontend/__tests__/WalletSection.test.tsx
git commit -m "feat(wallet-section): affiche le sport a cote des soldes/abonnements (clubs multi-sport)"
```

---

### Task 9: Frontend — `OffersShowcase.tsx` shows sport on plan/carnet cards

**Files:**
- Modify: `frontend/components/clubhouse/OffersShowcase.tsx`
- Test: `frontend/__tests__/OffersShowcase.test.tsx`

- [ ] **Step 1: Make the mocked `useClub` controllable and write the failing test**

In `frontend/__tests__/OffersShowcase.test.tsx`, replace the static mock (currently line 10):

```ts
let clubCtx: { club: { clubSports?: { sport: { key: string; name: string } }[] } | null; slug: string } =
  { club: null, slug: 'padel-arena' };
jest.mock('@/lib/ClubProvider', () => ({ useClub: () => clubCtx }));
```

Add a `beforeEach` inside the `describe('OffersShowcase', ...)` block (before the first `it`) to reset it:

```ts
  beforeEach(() => { clubCtx = { club: null, slug: 'padel-arena' }; });
```

Add a new test at the end of the `describe` block:

```ts
  it('club multi-sport : le sport apparaît sur la carte et dans la modale', () => {
    clubCtx = {
      slug: 'padel-arena',
      club: { clubSports: [{ sport: { key: 'padel', name: 'Padel' } }, { sport: { key: 'tennis', name: 'Tennis' } }] },
    };
    wrap({ offers: { ...offers, packages: [{ ...offers.packages[0], sportKeys: ['tennis'] }] } });
    // Sur la carte, les lignes d'avantages sont jointes en une seule chaîne (`lines.join(' · ')`) —
    // la ligne sport est en tête, d'où le match par regex plutôt qu'un texte exact.
    expect(screen.getByText(/^Padel ·/)).toBeInTheDocument(); // carte abonnement
    expect(screen.getByText(/^Tennis ·/)).toBeInTheDocument(); // carte carnet
    // Dans la modale, chaque avantage est un <li> séparé — la ligne sport y est un texte exact isolé.
    fireEvent.click(screen.getAllByRole('button', { name: /Souscrire/i })[0]);
    expect(within(screen.getByRole('dialog')).getByText('Padel')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/jest/bin/jest.js OffersShowcase.test.tsx -t "multi-sport"`
Expected: FAIL — no `'Padel'`/`'Tennis'` text rendered by the benefit lines yet.

- [ ] **Step 3: Implement**

In `frontend/components/clubhouse/OffersShowcase.tsx`, update the imports:

```ts
import { api, assetUrl, ClubDetail, PublicOffers, PublicPlan, PublicPackageTemplate } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { useClub } from '@/lib/ClubProvider';
import { clubIsMultiSport, sportNames } from '@/lib/sportBadge';
```

Change `planBenefits`/`packageBenefits` to take the club and prepend the sport line:

```ts
const planBenefits = (p: PublicPlan, club: ClubDetail | null): string[] => [
  ...(clubIsMultiSport(club) && p.sportKeys.length > 0 ? [sportNames(club, p.sportKeys).join(', ')] : []),
  p.offPeakOnly ? 'Heures creuses' : 'Toutes heures',
  p.benefit === 'INCLUDED' ? 'Réservations incluses' : `−${p.discountPercent ?? 0} % sur les réservations`,
  ...(p.dailyCap ? [`${p.dailyCap} résa/jour max`] : []),
  ...(p.weeklyCap ? [`${p.weeklyCap} résa/sem. max`] : []),
  `Engagement ${p.commitmentMonths} mois`,
];

const packageBenefits = (t: PublicPackageTemplate, club: ClubDetail | null): string[] => [
  ...(clubIsMultiSport(club) && t.sportKeys.length > 0 ? [sportNames(club, t.sportKeys).join(', ')] : []),
  t.kind === 'ENTRIES' ? `${t.entriesCount} entrées` : `${euros(t.walletAmount ?? '0')} crédités`,
  t.validityDays ? `Valable ${t.validityDays} jours` : 'Sans expiration',
];
```

Update the component to destructure `club` (currently `const { slug } = useClub();`):

```ts
  const { th } = useTheme();
  const { slug, club } = useClub();
```

Update the 3 call sites — the card loops (currently `lines={planBenefits(p)}` and `lines={packageBenefits(t)}` — note: keep the existing `i`-based tint logic untouched, only the benefits call changes):

```tsx
        {plans.map((p, i) => (
          <OfferCard key={p.id} name={p.name} price={euros(p.monthlyPrice)} suffix="/ mois"
            kindLabel="Abonnement" tint={OFFER_TINTS[i % OFFER_TINTS.length]}
            lines={planBenefits(p, club)} onOpen={() => openDetails({ kind: 'plan', plan: p })} />
        ))}
        {offers.packages.map((t, i) => (
          <OfferCard key={t.id} name={t.name} price={euros(t.price)} suffix={null}
            kindLabel={t.kind === 'ENTRIES' ? 'Carnet' : 'Porte-monnaie'}
            tint={OFFER_TINTS[(plans.length + i) % OFFER_TINTS.length]}
            lines={packageBenefits(t, club)}
            onOpen={() => openDetails({ kind: 'package', tpl: t })} />
        ))}
```

And the modal's `targetLines` (currently `target?.kind === 'plan' ? planBenefits(target.plan) : target?.kind === 'package' ? packageBenefits(target.tpl) : [];`):

```ts
  const targetLines = target?.kind === 'plan' ? planBenefits(target.plan, club) : target?.kind === 'package' ? packageBenefits(target.tpl, club) : [];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node node_modules/jest/bin/jest.js OffersShowcase.test.tsx`
Expected: PASS (full file — pre-existing tests keep `clubCtx.club: null` via the new `beforeEach`, so `clubIsMultiSport` is `false` and no line is added, preserving their exact benefit-line assertions).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/clubhouse/OffersShowcase.tsx frontend/__tests__/OffersShowcase.test.tsx
git commit -m "feat(club-house): affiche le sport sur les cartes offres (clubs multi-sport)"
```

---

### Task 10: Admin `/admin/packages` — pick sportKeys at creation, show them on existing rows

**Files:**
- Modify: `frontend/app/admin/packages/page.tsx`

No existing test suite covers this page (`frontend/__tests__` has no `AdminPackages*.test.tsx`) — per YAGNI this task is verified by `tsc --noEmit` and a manual read-through, not a new test file written from scratch.

- [ ] **Step 1: Add state and a toggle function for the template's sport selection**

In `frontend/app/admin/packages/page.tsx`, add a new state variable next to the other template-creation state (currently lines 165-172, after `const [validity, setValidity] = useState('');`):

```ts
  const [tSportKeys, setTSportKeys] = useState<string[]>([]);
```

Right after the existing `const sportOptions = [...]` / `const toggleSport = ...` block (currently lines 252-254), add:

```ts
  const toggleTemplateSport = (k: string) =>
    setTSportKeys((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
```

- [ ] **Step 2: Send `sportKeys` on creation and reset the field**

In the `create` function (currently lines 205-226), add `sportKeys: tSportKeys` to the `adminCreatePackageTemplate` call and reset the state on success:

```ts
      const created = await api.adminCreatePackageTemplate(clubId, {
        kind, name: name.trim(), description: description.trim() || undefined, price: Number(price),
        entriesCount: kind === 'ENTRIES' ? Number(entries) : undefined,
        walletAmount: kind === 'WALLET' ? Number(walletAmount) : undefined,
        validityDays: validity ? Number(validity) : null,
        sportKeys: tSportKeys,
      }, token);
      const pendingImage = imageFile;
      setName(''); setDescription(''); setPrice(''); setWallet(''); setImageFile(null); setTSportKeys([]);
```

- [ ] **Step 3: Add the sport picker row to the "Nouvelle offre" form**

In the JSX, right after the Carnet/Porte-monnaie kind toggle (currently lines 315-322, the `{(['ENTRIES', 'WALLET'] as PackageKind[]).map(...)}` block) and before `<PendingImagePicker file={imageFile} onChange={setImageFile} />`, insert:

```tsx
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {sportOptions.map((k) => (
            <button key={k} type="button" onClick={() => toggleTemplateSport(k)}
              style={{ border: `1.5px solid ${tSportKeys.includes(k) ? th.accent : th.line}`, background: tSportKeys.includes(k) ? th.surface2 : 'transparent', borderRadius: 10, padding: '6px 11px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.text }}>
              {k}
            </button>
          ))}
        </div>
```

- [ ] **Step 4: Show `sportKeys` on each existing offer row**

In the template list rendering (currently lines 362-367), append the sport info to the meta line:

```tsx
                <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute }}>
                  {t.kind === 'ENTRIES' ? `${t.entriesCount} entrées` : `${euro(t.walletAmount ?? 0)} crédités`}
                  {' · '}{euro(t.price)}
                  {t.validityDays ? ` · valable ${t.validityDays} j` : ' · sans expiration'}
                  {' · '}{t.sportKeys.length > 0 ? t.sportKeys.join(', ') : 'Tous sports'}
                </div>
```

- [ ] **Step 5: Verify with tsc and a manual read-through**

Run (from `frontend/`): `node node_modules/typescript/bin/tsc --noEmit`
Expected: no errors.

Read through the diff once more: confirm `sportOptions`/`toggleTemplateSport` don't collide with the existing `pSports`/`toggleSport` (subscription plans) — they're separate state (`tSportKeys` vs `pSports`) sharing only the read-only `sportOptions` array.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/admin/packages/page.tsx
git commit -m "feat(admin-packages): choix du sport a la creation d'un carnet/porte-monnaie"
```

---

### Task 11: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Backend — run the two touched suites together**

Run (from `backend/`):
```bash
node node_modules/jest/bin/jest.js src/services/__tests__/package.service.test.ts src/services/__tests__/offer.service.test.ts
```
Expected: PASS, 0 failures.

- [ ] **Step 2: Backend — full backend suite**

Run: `node node_modules/jest/bin/jest.js`
Expected: PASS (aside from any pre-existing unrelated failures already present before this work — if any appear, confirm via `git stash` that they predate this change before investigating further).

- [ ] **Step 3: Frontend — run all touched suites together**

Run (from `frontend/`):
```bash
node node_modules/jest/bin/jest.js sportBadge.test.ts ProfileMenu.test.tsx WalletSection.test.tsx OffersShowcase.test.tsx packages.test.ts BookingModal.packages.test.tsx
```
Expected: PASS, 0 failures.

- [ ] **Step 4: Frontend — tsc**

Run: `node node_modules/typescript/bin/tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Confirm the migration is applied and the Prisma client matches**

Run (from `backend/`):
```bash
npx prisma validate
```
Expected: schema valid. (The migration itself was already applied in Task 1, Step 3 — this just confirms the schema file and DB haven't diverged since.)

- [ ] **Step 6: Manual smoke check (optional but recommended given no admin-page test suite)**

With the dev stack running (`docker-compose` + backend + frontend, per the project's `CLAUDE.md` startup instructions), open `/admin/packages` on a club and confirm:
- The sport toggle buttons appear under "Nouvelle offre" (carnet/porte-monnaie) and creating one with a sport selected shows `padel` (or whichever was picked) on the new row, `Tous sports` when none picked.
- On a **mono-sport** club (e.g. `padel-arena-paris`), the Club-house offers, `/me/profile`, and the profile menu show **no** sport chip anywhere (unchanged from before this work) — the seeded dev club has only padel active, so this is the only scenario directly smoke-testable without seeding a second sport.
