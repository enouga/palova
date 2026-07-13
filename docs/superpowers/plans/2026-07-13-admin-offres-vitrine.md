# Page admin « Offres » — vitrine miroir + studio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer `/admin/packages` (formulaire envahissant + listes plates) par une vitrine « miroir » où chaque offre s'affiche comme les joueurs la voient, porte son pouls business, et s'édite dans un studio 2 colonnes avec aperçu joueur en direct.

**Architecture :** Backend additif (aucune migration, aucune route nouvelle) — `PackageService.listTemplates` renvoie des `stats` agrégées sur `MemberPackage`, `updateTemplate` accepte enfin `sportKeys/entriesCount/walletAmount`. Frontend : helpers purs testés (`lib/adminOffers.ts`), 3 composants (`OfferPreviewCard`, `OfferStudio`, `OfferCard`), page réécrite en orchestrateur, nav renommée « Offres ». La page Membres apprend à lire `?plan=<id>`.

**Tech Stack :** Express 5 + Prisma 7 (backend), Next.js 16 + React 19 + inline styles + theme system (frontend), Jest + RTL, ts-jest.

**Contexte spec :** `docs/superpowers/specs/2026-07-13-admin-offres-vitrine-design.md`

**Conventions du repo à respecter :**
- Backend jest via `node node_modules/jest/bin/jest.js <fichier>` (les shims npx sont cassés).
- Frontend jest via `node node_modules/jest/bin/jest.js <fichier>` ; **jest ne type-check pas** → passer `node node_modules/typescript/bin/tsc --noEmit -p .` séparément.
- `PowerShell`/`Bash` : le cwd retombe sur la racine repo à chaque commande ; utiliser des chemins absolus.
- Décimaux Prisma sérialisés en **string**. Montants business manipulés en **centimes** côté helpers.
- Ne jamais lancer `npm install` à la racine (casse Turbopack).

---

## File Structure

**Backend (modifiés) :**
- `backend/src/services/package.service.ts` — `listTemplates` (+stats), `updateTemplate` (+3 champs).
- `backend/src/services/__tests__/package.service.test.ts` — nouveaux cas.

**Frontend (créés) :**
- `frontend/lib/adminOffers.ts` — helpers purs (accents, pouls, revenu/plan, split actif/inactif, modèle d'aperçu).
- `frontend/__tests__/adminOffers.test.ts` — tests des helpers.
- `frontend/components/admin/offers/OfferPreviewCard.tsx` — carte joueur pure (aperçu + réutilisable).
- `frontend/components/admin/offers/OfferStudio.tsx` — modale 2 colonnes (création/édition), émet un brouillon.
- `frontend/components/admin/offers/OfferCard.tsx` — carte-miroir admin (pouls + actions).

**Frontend (modifiés) :**
- `frontend/lib/api.ts` — `PackageTemplate.stats`, `UpdatePackageTemplateBody` élargi.
- `frontend/app/admin/packages/page.tsx` — réécriture complète (orchestrateur).
- `frontend/app/admin/layout.tsx` — libellé nav « Offres prépayées » → « Offres ».
- `frontend/app/admin/members/page.tsx` — lecture `?plan=<id>` au montage.
- `frontend/__tests__/AdminPackages.test.tsx` — réécrit.
- `frontend/__tests__/AdminMembersFilters.test.tsx` — +1 cas `?plan=`.

---

## Task 1: Backend — `listTemplates` renvoie les stats carnets

**Files:**
- Modify: `backend/src/services/package.service.ts:25-27`
- Test: `backend/src/services/__tests__/package.service.test.ts`

- [ ] **Step 1: Write the failing test**

Ajouter ce bloc à la fin de `package.service.test.ts` (avant la dernière ligne du fichier, après le dernier `describe`) :

```typescript
describe('PackageService — listTemplates + stats', () => {
  let service: PackageService;
  beforeEach(() => { service = new PackageService(); });

  it('agrège vendus / actifs / outstanding par template', async () => {
    prismaMock.packageTemplate.findMany.mockResolvedValue([
      { id: 'tpl-e', clubId: 'club-1', kind: 'ENTRIES', name: 'Carte 10' },
      { id: 'tpl-w', clubId: 'club-1', kind: 'WALLET', name: 'Avoir 200' },
      { id: 'tpl-none', clubId: 'club-1', kind: 'ENTRIES', name: 'Jamais vendue' },
    ] as any);
    const future = new Date(Date.now() + 86_400_000);
    const past = new Date(Date.now() - 86_400_000);
    prismaMock.memberPackage.findMany.mockResolvedValue([
      // carnet : 2 vendus, 1 actif (l'autre épuisé)
      { templateId: 'tpl-e', kind: 'ENTRIES', creditsRemaining: 3, amountRemaining: null, expiresAt: future },
      { templateId: 'tpl-e', kind: 'ENTRIES', creditsRemaining: 0, amountRemaining: null, expiresAt: future },
      // porte-monnaie : 2 vendus, 1 actif à 130 € (l'autre expiré)
      { templateId: 'tpl-w', kind: 'WALLET', creditsRemaining: null, amountRemaining: new Prisma.Decimal(130), expiresAt: future },
      { templateId: 'tpl-w', kind: 'WALLET', creditsRemaining: null, amountRemaining: new Prisma.Decimal(50), expiresAt: past },
    ] as any);

    const out = await service.listTemplates('club-1');

    const byId = Object.fromEntries(out.map((t: any) => [t.id, t.stats]));
    expect(byId['tpl-e']).toEqual({ soldCount: 2, activeCount: 1, outstandingAmount: '0.00' });
    expect(byId['tpl-w']).toEqual({ soldCount: 2, activeCount: 1, outstandingAmount: '130.00' });
    expect(byId['tpl-none']).toEqual({ soldCount: 0, activeCount: 0, outstandingAmount: '0.00' });
  });

  it('ne lit que les member_packages du club', async () => {
    prismaMock.packageTemplate.findMany.mockResolvedValue([] as any);
    prismaMock.memberPackage.findMany.mockResolvedValue([] as any);
    await service.listTemplates('club-1');
    const arg = prismaMock.memberPackage.findMany.mock.calls[0][0] as any;
    expect(arg.where.clubId).toBe('club-1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/jest/bin/jest.js src/services/__tests__/package.service.test.ts -t "listTemplates"` (cwd `backend/`)
Expected: FAIL — `t.stats` is undefined (le `listTemplates` actuel ne renvoie pas `stats`).

- [ ] **Step 3: Replace `listTemplates`**

Remplacer `backend/src/services/package.service.ts:25-27` :

```typescript
  async listTemplates(clubId: string) {
    return prisma.packageTemplate.findMany({ where: { clubId }, orderBy: { createdAt: 'asc' } });
  }
```

par :

```typescript
  /**
   * Offres du club, chacune enrichie du pouls de ventes (agrégat MemberPackage) :
   * soldCount = tous les exemplaires vendus, activeCount = encore utilisables,
   * outstandingAmount = € restant en circulation (WALLET actifs). Le détail vit
   * sur /admin/members ; ici juste le chiffre au moment de décider.
   */
  async listTemplates(clubId: string) {
    const templates = await prisma.packageTemplate.findMany({ where: { clubId }, orderBy: { createdAt: 'asc' } });
    const pkgs = await prisma.memberPackage.findMany({
      where: { clubId },
      select: { templateId: true, kind: true, creditsRemaining: true, amountRemaining: true, expiresAt: true },
    });
    const now = Date.now();
    const acc = new Map<string, { soldCount: number; activeCount: number; outstanding: Prisma.Decimal }>();
    for (const p of pkgs) {
      const s = acc.get(p.templateId) ?? { soldCount: 0, activeCount: 0, outstanding: new Prisma.Decimal(0) };
      s.soldCount += 1;
      const notExpired = !p.expiresAt || p.expiresAt.getTime() > now;
      const usable = notExpired && (
        (p.kind === 'ENTRIES' && (p.creditsRemaining ?? 0) >= 1) ||
        (p.kind === 'WALLET' && p.amountRemaining != null && p.amountRemaining.greaterThan(0))
      );
      if (usable) {
        s.activeCount += 1;
        if (p.kind === 'WALLET' && p.amountRemaining) s.outstanding = s.outstanding.plus(p.amountRemaining);
      }
      acc.set(p.templateId, s);
    }
    return templates.map((t) => {
      const s = acc.get(t.id);
      return {
        ...t,
        stats: {
          soldCount: s?.soldCount ?? 0,
          activeCount: s?.activeCount ?? 0,
          outstandingAmount: (s?.outstanding ?? new Prisma.Decimal(0)).toFixed(2),
        },
      };
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_modules/jest/bin/jest.js src/services/__tests__/package.service.test.ts -t "listTemplates"` (cwd `backend/`)
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/package.service.ts backend/src/services/__tests__/package.service.test.ts
git commit -m "feat(offres): listTemplates renvoie le pouls de ventes par offre"
```

---

## Task 2: Backend — `updateTemplate` accepte sportKeys / entriesCount / walletAmount

**Files:**
- Modify: `backend/src/services/package.service.ts:67-96`
- Test: `backend/src/services/__tests__/package.service.test.ts`

- [ ] **Step 1: Write the failing test**

Ajouter dans le `describe('PackageService — offres (templates)')` existant (après le cas « updateTemplate ne modifie que name/description/price/validityDays/isActive » ligne ~55) :

```typescript
  it('updateTemplate met à jour sportKeys (validés)', async () => {
    prismaMock.packageTemplate.findUnique.mockResolvedValue({ id: 'tpl-1', clubId: 'club-1', kind: 'ENTRIES' } as any);
    prismaMock.sport.findMany.mockResolvedValue([{ key: 'padel' }, { key: 'tennis' }] as any);
    prismaMock.packageTemplate.update.mockResolvedValue({ id: 'tpl-1' } as any);
    await service.updateTemplate('tpl-1', 'club-1', { sportKeys: ['padel', 'tennis'] });
    expect(prismaMock.packageTemplate.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sportKeys: ['padel', 'tennis'] }),
    }));
  });

  it('updateTemplate refuse un sportKeys inconnu', async () => {
    prismaMock.packageTemplate.findUnique.mockResolvedValue({ id: 'tpl-1', clubId: 'club-1', kind: 'ENTRIES' } as any);
    prismaMock.sport.findMany.mockResolvedValue([{ key: 'padel' }] as any);
    await expect(service.updateTemplate('tpl-1', 'club-1', { sportKeys: ['inconnu'] }))
      .rejects.toThrow('VALIDATION_ERROR');
  });

  it('updateTemplate met à jour entriesCount sur un carnet, refuse ≤ 0', async () => {
    prismaMock.packageTemplate.findUnique.mockResolvedValue({ id: 'tpl-1', clubId: 'club-1', kind: 'ENTRIES' } as any);
    prismaMock.packageTemplate.update.mockResolvedValue({ id: 'tpl-1' } as any);
    await service.updateTemplate('tpl-1', 'club-1', { entriesCount: 12 });
    expect(prismaMock.packageTemplate.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ entriesCount: 12 }),
    }));
    await expect(service.updateTemplate('tpl-1', 'club-1', { entriesCount: 0 })).rejects.toThrow('VALIDATION_ERROR');
  });

  it('updateTemplate ignore entriesCount sur un porte-monnaie et walletAmount sur un carnet', async () => {
    prismaMock.packageTemplate.findUnique.mockResolvedValue({ id: 'tpl-w', clubId: 'club-1', kind: 'WALLET' } as any);
    prismaMock.packageTemplate.update.mockResolvedValue({ id: 'tpl-w' } as any);
    await service.updateTemplate('tpl-w', 'club-1', { entriesCount: 99, walletAmount: 250 });
    const data = prismaMock.packageTemplate.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data).not.toHaveProperty('entriesCount');
    expect(Number(data.walletAmount)).toBe(250);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/jest/bin/jest.js src/services/__tests__/package.service.test.ts -t "updateTemplate"` (cwd `backend/`)
Expected: FAIL — les nouveaux champs ne sont pas écrits (`sportKeys`/`entriesCount`/`walletAmount` absents du `data`).

- [ ] **Step 3: Élargir `updateTemplate`**

Remplacer la signature + le corps `backend/src/services/package.service.ts:67-96` :

```typescript
  /** kind est immuable (des soldes vendus y réfèrent) ; le reste est éditable. */
  async updateTemplate(id: string, clubId: string, body: {
    name?: string; description?: string | null; imageUrl?: string | null; price?: number;
    validityDays?: number | null; isActive?: boolean; sportKeys?: string[];
    entriesCount?: number; walletAmount?: number;
  }) {
    const tpl = await prisma.packageTemplate.findUnique({ where: { id } });
    if (!tpl || tpl.clubId !== clubId) throw new Error('TEMPLATE_NOT_FOUND');

    const data: Prisma.PackageTemplateUpdateInput = {};
    if (body.name !== undefined) {
      if (!body.name.trim()) throw new Error('VALIDATION_ERROR');
      data.name = body.name.trim();
    }
    if (body.description !== undefined) data.description = body.description?.trim() || null;
    if (body.imageUrl !== undefined) {
      const next = body.imageUrl?.trim() || null;
      if (next !== tpl.imageUrl) deleteUploadedOfferImage(tpl.imageUrl);
      data.imageUrl = next;
    }
    if (body.price !== undefined) {
      if (typeof body.price !== 'number' || isNaN(body.price) || body.price <= 0) throw new Error('VALIDATION_ERROR');
      data.price = new Prisma.Decimal(body.price);
    }
    if (body.validityDays !== undefined) {
      if (body.validityDays != null && (!Number.isInteger(body.validityDays) || body.validityDays <= 0)) throw new Error('VALIDATION_ERROR');
      data.validityDays = body.validityDays;
    }
    if (body.sportKeys !== undefined) {
      if (!Array.isArray(body.sportKeys)) throw new Error('VALIDATION_ERROR');
      if (body.sportKeys.length > 0) {
        const known = await prisma.sport.findMany({ where: { key: { in: body.sportKeys } }, select: { key: true } });
        const knownKeys = new Set(known.map(s => s.key));
        if (!body.sportKeys.every(k => knownKeys.has(k))) throw new Error('VALIDATION_ERROR');
      }
      data.sportKeys = body.sportKeys;
    }
    // entriesCount ne s'applique qu'à un carnet, walletAmount qu'à un porte-monnaie (kind figé).
    if (body.entriesCount !== undefined && tpl.kind === 'ENTRIES') {
      if (!Number.isInteger(body.entriesCount) || body.entriesCount <= 0) throw new Error('VALIDATION_ERROR');
      data.entriesCount = body.entriesCount;
    }
    if (body.walletAmount !== undefined && tpl.kind === 'WALLET') {
      if (typeof body.walletAmount !== 'number' || isNaN(body.walletAmount) || body.walletAmount <= 0) throw new Error('VALIDATION_ERROR');
      data.walletAmount = new Prisma.Decimal(body.walletAmount);
    }
    if (body.isActive !== undefined) data.isActive = body.isActive;

    return prisma.packageTemplate.update({ where: { id }, data });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_modules/jest/bin/jest.js src/services/__tests__/package.service.test.ts` (cwd `backend/`)
Expected: PASS (toute la suite, y compris les anciens cas — le cas « ne modifie que name/description/price/validityDays/isActive » reste vert : il n'envoie que `name`/`isActive`).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/package.service.ts backend/src/services/__tests__/package.service.test.ts
git commit -m "feat(offres): updateTemplate accepte sportKeys/entriesCount/walletAmount"
```

---

## Task 3: Frontend — types `PackageTemplate.stats` + `UpdatePackageTemplateBody` élargi

**Files:**
- Modify: `frontend/lib/api.ts:1870-1883` (interface `PackageTemplate`)
- Modify: `frontend/lib/api.ts:1973` (`UpdatePackageTemplateBody`)

- [ ] **Step 1: Ajouter `stats` à `PackageTemplate`**

Dans `frontend/lib/api.ts`, remplacer l'interface `PackageTemplate` (lignes ~1870-1883) — ajouter le champ `stats` avant la fermeture `}` :

```typescript
export interface PackageTemplate {
  id: string;
  kind: PackageKind;
  name: string;
  sportKeys: string[];
  description: string | null;
  imageUrl: string | null;
  price: string;
  entriesCount: number | null;
  walletAmount: string | null;
  validityDays: number | null;
  isActive: boolean;
  createdAt: string;
  /** Pouls de ventes (agrégat serveur). Absent des vieux payloads → optionnel. */
  stats?: { soldCount: number; activeCount: number; outstandingAmount: string };
}
```

- [ ] **Step 2: Élargir `UpdatePackageTemplateBody`**

Remplacer `frontend/lib/api.ts:1973` :

```typescript
export type UpdatePackageTemplateBody = Partial<{ name: string; description: string | null; imageUrl: string | null; price: number; validityDays: number | null; isActive: boolean }>;
```

par :

```typescript
export type UpdatePackageTemplateBody = Partial<{
  name: string; description: string | null; imageUrl: string | null; price: number;
  validityDays: number | null; isActive: boolean; sportKeys: string[];
  entriesCount: number; walletAmount: number;
}>;
```

- [ ] **Step 3: Type-check**

Run: `node node_modules/typescript/bin/tsc --noEmit -p .` (cwd `frontend/`)
Expected: aucune erreur nouvelle sur `api.ts` (des erreurs pré-existantes dans d'autres WIP peuvent subsister — vérifier qu'aucune ne cite `api.ts` lignes touchées).

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(offres): types PackageTemplate.stats + UpdatePackageTemplateBody elargi"
```

---

## Task 4: Frontend — helpers purs `lib/adminOffers.ts`

**Files:**
- Create: `frontend/lib/adminOffers.ts`
- Test: `frontend/__tests__/adminOffers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/__tests__/adminOffers.test.ts` :

```typescript
import {
  OFFER_TINTS, offerAccent, planPulse, packagePulse, planRevenueCents, splitByActive,
} from '../lib/adminOffers';
import type { PackageTemplate, SubscriberRow } from '../lib/api';

describe('offerAccent', () => {
  it('cycle sur la palette', () => {
    expect(offerAccent(0)).toBe(OFFER_TINTS[0]);
    expect(offerAccent(OFFER_TINTS.length)).toBe(OFFER_TINTS[0]);
    expect(offerAccent(OFFER_TINTS.length + 2)).toBe(OFFER_TINTS[2]);
  });
});

describe('planPulse', () => {
  it('abonnés + revenu quand il y a des ventes', () => {
    expect(planPulse(12, 58800)).toBe('12 abonnés actifs · 588 €/mois');
    expect(planPulse(1, 4900)).toBe('1 abonné actif · 49 €/mois');
  });
  it('message neutre à zéro', () => {
    expect(planPulse(0, 0)).toBe('Aucune vente pour l’instant');
  });
});

describe('packagePulse', () => {
  const stats = (o: Partial<{ soldCount: number; activeCount: number; outstandingAmount: string }>) =>
    ({ soldCount: 0, activeCount: 0, outstandingAmount: '0.00', ...o });
  it('carnet : en circulation + vendus', () => {
    expect(packagePulse(stats({ soldCount: 23, activeCount: 8 }), 'ENTRIES'))
      .toBe('8 en circulation · 23 vendus');
  });
  it('porte-monnaie : € en circulation + vendus', () => {
    expect(packagePulse(stats({ soldCount: 9, activeCount: 5, outstandingAmount: '1240.00' }), 'WALLET'))
      .toBe('1 240 € en circulation · 9 vendus');
  });
  it('message neutre à zéro vente', () => {
    expect(packagePulse(stats({}), 'ENTRIES')).toBe('Aucune vente pour l’instant');
    expect(packagePulse(undefined, 'ENTRIES')).toBe('Aucune vente pour l’instant');
  });
});

describe('planRevenueCents', () => {
  const now = Date.parse('2026-07-13T00:00:00Z');
  const sub = (o: Partial<SubscriberRow>): SubscriberRow => ({
    id: 'x', user: { id: 'u', firstName: 'A', lastName: 'B', avatarUrl: null },
    planId: 'p1', planName: 'P', status: 'ACTIVE',
    startedAt: '2026-01-01T00:00:00Z', expiresAt: '2027-01-01T00:00:00Z',
    monthlyPriceSnapshot: '49.00', sportKeys: ['padel'], ...o,
  });
  it('somme les mensualités des abonnés ACTIFS non expirés du plan', () => {
    const subs = [
      sub({ planId: 'p1', monthlyPriceSnapshot: '49.00' }),
      sub({ planId: 'p1', monthlyPriceSnapshot: '49.00' }),
      sub({ planId: 'p2', monthlyPriceSnapshot: '99.00' }),              // autre plan
      sub({ planId: 'p1', status: 'CANCELLED' }),                        // pas actif
      sub({ planId: 'p1', expiresAt: '2026-01-01T00:00:00Z' }),          // expiré
    ];
    expect(planRevenueCents(subs, 'p1', now)).toBe(9800);
  });
});

describe('splitByActive', () => {
  it('sépare actifs / inactifs en préservant l’ordre', () => {
    const items = [
      { id: 'a', isActive: true }, { id: 'b', isActive: false }, { id: 'c', isActive: true },
    ] as Pick<PackageTemplate, 'id' | 'isActive'>[];
    const { active, inactive } = splitByActive(items);
    expect(active.map(i => i.id)).toEqual(['a', 'c']);
    expect(inactive.map(i => i.id)).toEqual(['b']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/jest/bin/jest.js __tests__/adminOffers.test.ts` (cwd `frontend/`)
Expected: FAIL — `Cannot find module '../lib/adminOffers'`.

- [ ] **Step 3: Créer `frontend/lib/adminOffers.ts`**

```typescript
import { ACCENTS } from '@/lib/theme';
import type { PackageKind, SubscriberRow } from '@/lib/api';

/** Teintes cyclées des cartes (miroir de OffersShowcase, même ordre). */
export const OFFER_TINTS = [ACCENTS.blue, ACCENTS.apricot, ACCENTS.emerald, ACCENTS.violet, ACCENTS.cyan];
export const offerAccent = (index: number): string => OFFER_TINTS[((index % OFFER_TINTS.length) + OFFER_TINTS.length) % OFFER_TINTS.length];

const NO_SALE = 'Aucune vente pour l’instant';

/** Espace fine insécable entre milliers : « 1 240 € ». */
function eurosInt(cents: number): string {
  const euros = Math.round(cents / 100);
  return `${euros.toLocaleString('fr-FR').replace(/ /g, ' ')} €`;
}

/** Pouls d'un abonnement : « 12 abonnés actifs · 588 €/mois ». */
export function planPulse(activeCount: number, revenueCents: number): string {
  if (activeCount <= 0) return NO_SALE;
  const noun = activeCount === 1 ? 'abonné actif' : 'abonnés actifs';
  return `${activeCount} ${noun} · ${eurosInt(revenueCents)}/mois`;
}

/** Pouls d'un carnet/porte-monnaie depuis les stats serveur. */
export function packagePulse(
  stats: { soldCount: number; activeCount: number; outstandingAmount: string } | undefined,
  kind: PackageKind,
): string {
  if (!stats || stats.soldCount <= 0) return NO_SALE;
  if (kind === 'WALLET') {
    const cents = Math.round(Number(stats.outstandingAmount) * 100);
    return `${eurosInt(cents)} en circulation · ${stats.soldCount} vendus`;
  }
  return `${stats.activeCount} en circulation · ${stats.soldCount} vendus`;
}

/** Revenu mensuel récurrent d'un plan = Σ mensualités des abonnés ACTIFS non expirés. */
export function planRevenueCents(subscribers: SubscriberRow[], planId: string, nowMs: number): number {
  return subscribers
    .filter((s) => s.planId === planId && s.status === 'ACTIVE' && Date.parse(s.expiresAt) > nowMs)
    .reduce((sum, s) => sum + Math.round(Number(s.monthlyPriceSnapshot) * 100), 0);
}

/** Sépare actifs (en vente) / inactifs (retirés) en préservant l'ordre d'entrée. */
export function splitByActive<T extends { isActive: boolean }>(items: T[]): { active: T[]; inactive: T[] } {
  const active: T[] = []; const inactive: T[] = [];
  for (const it of items) (it.isActive ? active : inactive).push(it);
  return { active, inactive };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_modules/jest/bin/jest.js __tests__/adminOffers.test.ts` (cwd `frontend/`)
Expected: PASS. Note : `eurosInt` normalise l'espace des milliers (`toLocaleString('fr-FR')` peut produire une espace fine ` ` selon l'ICU de Node) pour matcher « 1 240 » avec une espace ordinaire.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/adminOffers.ts frontend/__tests__/adminOffers.test.ts
git commit -m "feat(offres): helpers purs adminOffers (accents, pouls, revenu/plan)"
```

---

## Task 5: Frontend — composant `OfferPreviewCard` (carte joueur pure)

**Files:**
- Create: `frontend/components/admin/offers/OfferPreviewCard.tsx`

Ce composant reproduit visuellement la carte joueur de `OffersShowcase` (accent, lavis, chip type, prix display, lignes, CTA). Il est **pur** (aucun fetch), piloté par un modèle `OfferPreview`.

- [ ] **Step 1: Créer le composant**

```tsx
'use client';
import { CSSProperties } from 'react';
import { useTheme } from '@/lib/ThemeProvider';

export interface OfferPreview {
  kindLabel: string;        // « Abonnement » / « Carnet » / « Porte-monnaie »
  tint: string;             // accent hex
  name: string;
  price: string;            // « 49 € »
  priceSuffix: string | null; // « /mois » | null
  lines: string[];          // caractéristiques (sports, créneaux, avantage, validité…)
  description: string;
  ctaLabel: string;         // « Souscrire · 49 € »
  imageUrl: string | null;  // object URL (aperçu local) ou asset URL
}

/** Carte « ce que verront vos joueurs » — miroir statique de OffersShowcase. */
export function OfferPreviewCard({ preview }: { preview: OfferPreview }) {
  const { th } = useTheme();
  const { kindLabel, tint, name, price, priceSuffix, lines, description, ctaLabel, imageUrl } = preview;
  const card: CSSProperties = {
    background: th.surface, borderRadius: 16, boxShadow: th.shadow,
    width: 236, overflow: 'hidden', position: 'relative',
    padding: '16px 16px 14px', display: 'flex', flexDirection: 'column', gap: 4,
  };
  return (
    <div style={card}>
      <span aria-hidden style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 72, background: `linear-gradient(180deg, ${tint}${th.mode === 'floodlit' ? '26' : '33'}, transparent)`, pointerEvents: 'none' }} />
      <span aria-hidden style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: tint }} />
      {imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="" style={{ position: 'relative', display: 'block', width: '100%', height: 'auto', maxHeight: 120, objectFit: 'cover', borderRadius: 10, marginBottom: 4 }} />
      )}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', borderRadius: 999, padding: '3px 8px', background: th.mode === 'floodlit' ? `${tint}26` : `${tint}40`, color: th.mode === 'floodlit' ? tint : th.ink }}>
          {kindLabel}
        </span>
      </div>
      <div style={{ position: 'relative', fontFamily: th.fontUI, fontWeight: 700, fontSize: 13.5, color: th.text, marginTop: 6 }}>{name || 'Sans nom'}</div>
      <div style={{ position: 'relative', fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 27, letterSpacing: -0.5, color: th.text }}>
        <span>{price}</span>{priceSuffix && <span style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.textMute, letterSpacing: 0 }}> {priceSuffix}</span>}
      </div>
      {lines.length > 0 && (
        <div style={{ position: 'relative', fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, lineHeight: 1.55 }}>{lines.join(' · ')}</div>
      )}
      {description && (
        <div style={{ position: 'relative', fontFamily: th.fontUI, fontSize: 12, color: th.textMute, lineHeight: 1.5, marginTop: 4, whiteSpace: 'pre-wrap' }}>{description}</div>
      )}
      <div style={{ position: 'relative', marginTop: 10, border: `1.5px solid ${tint}`, textAlign: 'center', color: th.mode === 'floodlit' ? tint : th.ink, borderRadius: 10, padding: '8px 12px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 700 }}>
        {ctaLabel}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `node node_modules/typescript/bin/tsc --noEmit -p .` (cwd `frontend/`)
Expected: aucune erreur nouvelle citant `OfferPreviewCard.tsx`.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/admin/offers/OfferPreviewCard.tsx
git commit -m "feat(offres): OfferPreviewCard (carte joueur pure pour l'apercu)"
```

---

## Task 6: Frontend — composant `OfferStudio` (modale 2 colonnes)

**Files:**
- Create: `frontend/components/admin/offers/OfferStudio.tsx`

La modale tient son propre état, affiche l'aperçu joueur en direct (colonne droite, `.pl-create-grid` réutilisé — 2 colonnes ≥ 700px, empilé avant, aperçu sous le formulaire en mobile), et **émet un brouillon typé** au submit (la page compose les appels API). Type discriminé plan/package. En édition, le type est verrouillé et les champs sont préremplis.

- [ ] **Step 1: Créer le composant**

```tsx
'use client';
import { useEffect, useRef, useState, CSSProperties } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { assetUrl, CreatePackageTemplateBody, CreateSubscriptionPlanBody, PackageKind, PackageTemplate, SubscriptionBenefit, SubscriptionPlan } from '@/lib/api';
import { offerAccent } from '@/lib/adminOffers';
import { HERO_GRADIENT, HERO_INK_MUTED } from '@/components/agenda/AgendaHero';
import { OfferPreviewCard, OfferPreview } from '@/components/admin/offers/OfferPreviewCard';

type StudioKind = 'PLAN' | 'ENTRIES' | 'WALLET';

/** Brouillon émis au submit ; la page fait create OU update selon `editing`. */
export type OfferStudioResult =
  | { kind: 'plan'; body: CreateSubscriptionPlanBody; imageFile: File | null; removeImage: boolean }
  | { kind: 'package'; body: CreatePackageTemplateBody; imageFile: File | null; removeImage: boolean };

export interface OfferStudioProps {
  open: boolean;
  /** Offre en édition (préremplissage) ; absent = création. */
  editing?: { kind: 'plan'; plan: SubscriptionPlan } | { kind: 'package'; tpl: PackageTemplate };
  /** Position d'affichage prévue (fin de section) → accent de l'aperçu. */
  previewIndex: number;
  sportOptions: string[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (result: OfferStudioResult) => void;
}

const euro = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;

export function OfferStudio(props: OfferStudioProps) {
  const { th } = useTheme();
  const { open, editing, previewIndex, sportOptions, busy, error, onClose, onSubmit } = props;
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Type : verrouillé en édition, choisi par chips en création.
  const initialKind: StudioKind = editing ? (editing.kind === 'plan' ? 'PLAN' : editing.tpl.kind) : 'PLAN';
  const [kind, setKind] = useState<StudioKind>(initialKind);

  // Champs communs
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sports, setSports] = useState<string[]>(['padel']);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [previewFileUrl, setPreviewFileUrl] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Champs plan
  const [price, setPrice] = useState('');          // sert de prix (plan: /mois ; package: vente)
  const [months, setMonths] = useState('12');
  const [offPeak, setOffPeak] = useState(false);
  const [benefit, setBenefit] = useState<SubscriptionBenefit>('INCLUDED');
  const [discount, setDiscount] = useState('50');
  const [dailyCap, setDailyCap] = useState('');
  const [weeklyCap, setWeeklyCap] = useState('');
  // Champs package
  const [entries, setEntries] = useState('10');
  const [walletAmount, setWalletAmount] = useState('');
  const [validity, setValidity] = useState('');

  // (Ré)initialise depuis `editing` à chaque ouverture.
  useEffect(() => {
    if (!open) return;
    if (editing?.kind === 'plan') {
      const p = editing.plan;
      setKind('PLAN'); setName(p.name); setDescription(p.description ?? ''); setSports(p.sportKeys);
      setPrice(String(Number(p.monthlyPrice))); setMonths(String(p.commitmentMonths));
      setOffPeak(p.offPeakOnly); setBenefit(p.benefit); setDiscount(String(p.discountPercent ?? 50));
      setDailyCap(p.dailyCap != null ? String(p.dailyCap) : ''); setWeeklyCap(p.weeklyCap != null ? String(p.weeklyCap) : '');
    } else if (editing?.kind === 'package') {
      const t = editing.tpl;
      setKind(t.kind); setName(t.name); setDescription(t.description ?? ''); setSports(t.sportKeys);
      setPrice(String(Number(t.price))); setEntries(String(t.entriesCount ?? 10));
      setWalletAmount(t.walletAmount != null ? String(Number(t.walletAmount)) : '');
      setValidity(t.validityDays != null ? String(t.validityDays) : '');
    } else {
      setKind('PLAN'); setName(''); setDescription(''); setSports(['padel']);
      setPrice(''); setMonths('12'); setOffPeak(false); setBenefit('INCLUDED'); setDiscount('50');
      setDailyCap(''); setWeeklyCap(''); setEntries('10'); setWalletAmount(''); setValidity('');
    }
    setPendingFile(null); setRemoveImage(false); setShowAdvanced(false);
    if (fileRef.current) fileRef.current.value = '';
  }, [open, editing]);

  // Aperçu du fichier local choisi.
  useEffect(() => {
    if (!pendingFile || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') { setPreviewFileUrl(null); return; }
    const url = URL.createObjectURL(pendingFile);
    setPreviewFileUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingFile]);

  if (!open) return null;

  const existingImageUrl = editing?.kind === 'plan' ? editing.plan.imageUrl : editing?.kind === 'package' ? editing.tpl.imageUrl : null;
  const shownImageUrl = previewFileUrl ?? (!removeImage && existingImageUrl ? assetUrl(existingImageUrl) : null);
  const toggleSport = (k: string) => setSports((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));

  // ── Modèle d'aperçu live ──
  const tint = offerAccent(previewIndex);
  const priceNum = Number(price) || 0;
  const kindLabel = kind === 'PLAN' ? 'Abonnement' : kind === 'ENTRIES' ? 'Carnet' : 'Porte-monnaie';
  const sportsLine = sports.length > 0 ? sports.join(', ') : 'Tous sports';
  const lines = kind === 'PLAN'
    ? [sportsLine, offPeak ? 'Heures creuses' : 'Toutes heures', benefit === 'INCLUDED' ? 'Inclus' : `−${Number(discount) || 0} %`, `${Number(months) || 0} mois`]
    : kind === 'ENTRIES'
      ? [sportsLine, `${Number(entries) || 0} entrées`, validity ? `Valable ${validity} j` : 'Sans expiration']
      : [sportsLine, `${euro(Number(walletAmount) || 0)} crédités`, validity ? `Valable ${validity} j` : 'Sans expiration'];
  const preview: OfferPreview = {
    kindLabel, tint, name, description,
    price: euro(priceNum), priceSuffix: kind === 'PLAN' ? '/mois' : null,
    lines, ctaLabel: `Souscrire · ${euro(priceNum)}`,
    imageUrl: shownImageUrl,
  };

  // ── Soumission ──
  const handleSubmit = () => {
    if (kind === 'PLAN') {
      const body: CreateSubscriptionPlanBody = {
        name: name.trim(), description: description.trim() || null, sportKeys: sports,
        monthlyPrice: priceNum, commitmentMonths: Number(months) || 1, offPeakOnly: offPeak,
        benefit, discountPercent: benefit === 'DISCOUNT' ? Number(discount) || null : null,
        dailyCap: dailyCap ? Number(dailyCap) : null, weeklyCap: weeklyCap ? Number(weeklyCap) : null,
      };
      onSubmit({ kind: 'plan', body, imageFile: pendingFile, removeImage });
    } else {
      const body: CreatePackageTemplateBody = {
        kind: kind as PackageKind, name: name.trim(), description: description.trim() || null, price: priceNum,
        entriesCount: kind === 'ENTRIES' ? Number(entries) : undefined,
        walletAmount: kind === 'WALLET' ? Number(walletAmount) : undefined,
        validityDays: validity ? Number(validity) : null, sportKeys: sports,
      };
      onSubmit({ kind: 'package', body, imageFile: pendingFile, removeImage });
    }
  };

  // ── Styles ──
  const label: CSSProperties = { fontSize: 12, color: th.textMute, display: 'flex', flexDirection: 'column', gap: 4 };
  const input: CSSProperties = { border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 8, padding: '8px 10px', fontFamily: th.fontUI, fontSize: 14 };
  const chip = (active: boolean): CSSProperties => ({
    border: `1.5px solid ${active ? th.accent : th.line}`, background: active ? th.surface2 : 'transparent',
    color: th.text, borderRadius: 999, padding: '6px 12px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600,
  });
  const seg = (active: boolean): CSSProperties => ({
    border: 'none', background: active ? th.accent : 'transparent', color: active ? th.onAccent : th.text,
    borderRadius: 999, padding: '6px 12px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700,
  });
  const submitLabel = editing ? 'Enregistrer' : 'Mettre en vente';

  const KIND_CHIPS: { k: StudioKind; label: string }[] = [
    { k: 'PLAN', label: '⚡ Abonnement' }, { k: 'ENTRIES', label: '🎟 Carnet' }, { k: 'WALLET', label: '💰 Porte-monnaie' },
  ];

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true"
        style={{ width: '100%', maxWidth: 860, background: th.surface, borderRadius: 20, boxShadow: th.shadow, overflow: 'hidden', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px 0', flexWrap: 'wrap' }}>
          <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 20, color: th.text }}>{editing ? 'Modifier l’offre' : 'Nouvelle offre'}</div>
          <span style={{ flex: 1 }} />
          {KIND_CHIPS.filter((c) => !editing || c.k === kind).map((c) => (
            <button key={c.k} type="button" disabled={!!editing} onClick={() => setKind(c.k)} style={chip(kind === c.k)}>{c.label}</button>
          ))}
          <button onClick={onClose} aria-label="Fermer" style={{ border: 'none', background: th.surface2, cursor: 'pointer', borderRadius: 9, width: 30, height: 30, color: th.textMute, fontSize: 16 }}>✕</button>
        </div>

        {error && (
          <div style={{ margin: '12px 20px 0', background: '#ff7a4d', color: '#fff', borderRadius: 12, padding: '10px 13px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600 }}>{error}</div>
        )}

        <div className="pl-create-grid" style={{ padding: 20, overflow: 'auto' }}>
          {/* ── Formulaire ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
            <label style={label}>Nom
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Padel illimité" style={input} />
            </label>

            <div>
              <div style={{ ...label, marginBottom: 6 }}>Sports</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {sportOptions.map((k) => (
                  <button key={k} type="button" onClick={() => toggleSport(k)} style={chip(sports.includes(k))}>{k}</button>
                ))}
              </div>
            </div>

            {kind === 'PLAN' ? (
              <>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <label style={{ ...label, flex: 1, minWidth: 110 }}>Prix / mois €
                    <input type="number" min={0} step="1" value={price} onChange={(e) => setPrice(e.target.value)} style={input} />
                  </label>
                  <label style={{ ...label, flex: 1, minWidth: 110 }}>Engagement (mois)
                    <input type="number" min={1} step="1" value={months} onChange={(e) => setMonths(e.target.value)} style={input} />
                  </label>
                </div>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ ...label, marginBottom: 6 }}>Créneaux</div>
                    <div style={{ display: 'inline-flex', border: `1px solid ${th.line}`, borderRadius: 999, overflow: 'hidden' }}>
                      <button type="button" onClick={() => setOffPeak(false)} style={seg(!offPeak)}>Toutes heures</button>
                      <button type="button" onClick={() => setOffPeak(true)} style={seg(offPeak)}>Heures creuses</button>
                    </div>
                  </div>
                  <div>
                    <div style={{ ...label, marginBottom: 6 }}>Avantage</div>
                    <div style={{ display: 'inline-flex', border: `1px solid ${th.line}`, borderRadius: 999, overflow: 'hidden' }}>
                      <button type="button" onClick={() => setBenefit('INCLUDED')} style={seg(benefit === 'INCLUDED')}>Inclus</button>
                      <button type="button" onClick={() => setBenefit('DISCOUNT')} style={seg(benefit === 'DISCOUNT')}>Remise %</button>
                    </div>
                  </div>
                  {benefit === 'DISCOUNT' && (
                    <label style={label}>Remise %
                      <input type="number" min={1} max={100} step="1" value={discount} onChange={(e) => setDiscount(e.target.value)} style={{ ...input, width: 90 }} />
                    </label>
                  )}
                </div>
              </>
            ) : (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <label style={{ ...label, flex: 1, minWidth: 110 }}>Prix de vente €
                  <input type="number" min={0} step="0.5" value={price} onChange={(e) => setPrice(e.target.value)} style={input} />
                </label>
                {kind === 'ENTRIES' ? (
                  <label style={{ ...label, flex: 1, minWidth: 110 }}>Entrées
                    <input type="number" min={1} step="1" value={entries} onChange={(e) => setEntries(e.target.value)} style={input} />
                  </label>
                ) : (
                  <label style={{ ...label, flex: 1, minWidth: 110 }}>Montant crédité €
                    <input type="number" min={0} step="0.5" value={walletAmount} onChange={(e) => setWalletAmount(e.target.value)} style={input} />
                  </label>
                )}
              </div>
            )}

            <label style={label}>Description (affichée aux joueurs)
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
                placeholder="Ex. Réservez sans compter, toute l'année…" style={{ ...input, resize: 'vertical', lineHeight: 1.5 }} />
            </label>

            {/* Affiche */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0] ?? null; setPendingFile(f); if (f) setRemoveImage(false); }} />
              <button type="button" onClick={() => fileRef.current?.click()} style={{ ...chip(false), display: 'inline-flex', gap: 6 }}>
                🖼 {shownImageUrl ? "Changer l'affiche" : 'Ajouter une affiche'}
              </button>
              {shownImageUrl && (
                <button type="button" onClick={() => { setPendingFile(null); setRemoveImage(true); if (fileRef.current) fileRef.current.value = ''; }} style={{ ...chip(false), color: '#ff7a4d' }}>
                  Retirer l'affiche
                </button>
              )}
            </div>

            {/* Réglages avancés */}
            <button type="button" onClick={() => setShowAdvanced((v) => !v)} style={{ border: 'none', background: 'transparent', color: th.accent, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, alignSelf: 'flex-start', padding: 0 }}>
              Réglages avancés {showAdvanced ? '▴' : '▾'}
            </button>
            {showAdvanced && (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {kind === 'PLAN' ? (
                  <>
                    <label style={label}>Plafond / jour
                      <input type="number" min={1} step="1" value={dailyCap} onChange={(e) => setDailyCap(e.target.value)} placeholder="∞" style={{ ...input, width: 100 }} />
                    </label>
                    <label style={label}>Plafond / sem.
                      <input type="number" min={1} step="1" value={weeklyCap} onChange={(e) => setWeeklyCap(e.target.value)} placeholder="∞" style={{ ...input, width: 100 }} />
                    </label>
                  </>
                ) : (
                  <label style={label}>Validité (jours, vide = sans)
                    <input type="number" min={1} step="1" value={validity} onChange={(e) => setValidity(e.target.value)} style={{ ...input, width: 150 }} />
                  </label>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
              <button type="button" disabled={busy} onClick={handleSubmit}
                style={{ border: 'none', background: th.accent, color: th.onAccent, borderRadius: 999, padding: '10px 20px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 800 }}>
                {busy ? '…' : submitLabel}
              </button>
              <button type="button" disabled={busy} onClick={onClose} style={{ border: 'none', background: 'transparent', color: th.textMute, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13, fontWeight: 700 }}>Annuler</button>
            </div>
          </div>

          {/* ── Aperçu joueur en direct ── */}
          <div className="pl-create-recap" style={{ background: HERO_GRADIENT, borderRadius: 16, padding: 18, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            <div style={{ fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', color: HERO_INK_MUTED }}>Ce que verront vos joueurs</div>
            <OfferPreviewCard preview={preview} />
            <div style={{ fontFamily: th.fontUI, fontSize: 11, color: HERO_INK_MUTED, textAlign: 'center' }}>Mise à jour en direct ✨</div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `node node_modules/typescript/bin/tsc --noEmit -p .` (cwd `frontend/`)
Expected: aucune erreur nouvelle citant `OfferStudio.tsx`.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/admin/offers/OfferStudio.tsx
git commit -m "feat(offres): OfferStudio (modale 2 colonnes, apercu joueur en direct)"
```

---

## Task 7: Frontend — composant `OfferCard` (carte-miroir admin)

**Files:**
- Create: `frontend/components/admin/offers/OfferCard.tsx`

Carte affichée dans la grille : liseré accent, lavis + chip type, nom, prix display, caractéristiques, **ligne de pouls** (cliquable pour les plans → callback), pied avec statut + actions Modifier / Retirer-Remettre.

- [ ] **Step 1: Créer le composant**

```tsx
'use client';
import { CSSProperties, ReactNode } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';

export interface OfferCardProps {
  tint: string;
  kindLabel: string;      // « Abonnement » / « Carnet » / « Porte-monnaie »
  name: string;
  price: string;          // « 49 € »
  priceSuffix: string | null; // « /mois · 12 mois » | « · 10 entrées » | …
  features: string;       // ligne de caractéristiques (déjà jointe au « · »)
  pulse: ReactNode;       // ligne de pouls (string ou bouton)
  isActive: boolean;
  busy: boolean;
  onEdit: () => void;
  onToggleActive: () => void;
}

export function OfferCard(props: OfferCardProps) {
  const { th } = useTheme();
  const { tint, kindLabel, name, price, priceSuffix, features, pulse, isActive, busy, onEdit, onToggleActive } = props;
  const card: CSSProperties = {
    position: 'relative', overflow: 'hidden', background: th.surface, borderRadius: 16, boxShadow: th.shadow,
    display: 'flex', flexDirection: 'column', opacity: isActive ? 1 : 0.55,
  };
  const mini: CSSProperties = {
    border: `1px solid ${th.line}`, background: 'transparent', color: th.text, borderRadius: 9,
    padding: '6px 11px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12, fontWeight: 700,
  };
  return (
    <div style={card}>
      <span aria-hidden style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: isActive ? tint : th.textFaint }} />
      <span aria-hidden style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 52, background: `linear-gradient(180deg, ${tint}${th.mode === 'floodlit' ? '20' : '2e'}, transparent)`, pointerEvents: 'none' }} />
      <div style={{ position: 'relative', padding: '13px 15px 12px', display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ alignSelf: 'flex-start', fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', borderRadius: 999, padding: '3px 8px', background: th.mode === 'floodlit' ? `${tint}26` : `${tint}40`, color: th.mode === 'floodlit' ? tint : th.ink }}>
          {kindLabel}
        </span>
        <div style={{ fontFamily: th.fontUI, fontWeight: 800, fontSize: 15, letterSpacing: -0.2, color: th.text, marginTop: 6 }}>{name}</div>
        <div style={{ fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 24, letterSpacing: -1, color: th.text }}>
          <span>{price}</span>{priceSuffix && <span style={{ fontFamily: th.fontUI, fontSize: 12, fontWeight: 600, color: th.textMute, letterSpacing: 0 }}> {priceSuffix}</span>}
        </div>
        <div style={{ fontFamily: th.fontUI, fontSize: 11.5, color: th.textMute, lineHeight: 1.45, marginTop: 2 }}>{features}</div>
        <div style={{ fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, color: isActive ? tint : th.textMute, marginTop: 8 }}>{pulse}</div>
      </div>
      <div style={{ position: 'relative', borderTop: `1px solid ${th.line}`, padding: '9px 15px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span aria-hidden style={{ width: 7, height: 7, borderRadius: 99, background: isActive ? ACCENTS.emerald : th.textFaint }} />
        <span style={{ fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, color: th.textMute, marginRight: 'auto' }}>{isActive ? 'En vente' : 'Retirée de la vente'}</span>
        <button type="button" onClick={onEdit} disabled={busy} style={mini}>Modifier</button>
        <button type="button" onClick={onToggleActive} disabled={busy} style={{ ...mini, color: isActive ? '#ff7a4d' : th.text }}>
          {isActive ? 'Retirer' : 'Remettre en vente'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `node node_modules/typescript/bin/tsc --noEmit -p .` (cwd `frontend/`)
Expected: aucune erreur nouvelle citant `OfferCard.tsx`.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/admin/offers/OfferCard.tsx
git commit -m "feat(offres): OfferCard (carte-miroir admin + pouls + actions)"
```

---

## Task 8: Frontend — réécriture de la page + renommage nav + tests

**Files:**
- Rewrite: `frontend/app/admin/packages/page.tsx`
- Modify: `frontend/app/admin/layout.tsx:156`
- Rewrite: `frontend/__tests__/AdminPackages.test.tsx`

- [ ] **Step 1: Write the failing test**

Remplacer entièrement `frontend/__tests__/AdminPackages.test.tsx` par :

```tsx
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import AdminPackagesPage from '../app/admin/packages/page';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));
jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'club-1', clubSports: [{ sport: { key: 'padel', name: 'Padel' } }, { sport: { key: 'tennis', name: 'Tennis' } }] } }) }));
jest.mock('../lib/api', () => ({
  api: {
    adminGetPackageTemplates: jest.fn(),
    adminGetSubscriptionPlans: jest.fn(),
    adminGetSubscriptionOverview: jest.fn(),
    adminCreatePackageTemplate: jest.fn(),
    adminUpdatePackageTemplate: jest.fn(),
    adminUploadPackageTemplateImage: jest.fn(),
    adminCreateSubscriptionPlan: jest.fn(),
    adminUpdateSubscriptionPlan: jest.fn(),
    adminUploadSubscriptionPlanImage: jest.fn(),
  },
  assetUrl: (u: string | null) => u,
}));
import { api } from '../lib/api';

const tpl = {
  id: 'tpl-1', kind: 'ENTRIES', name: 'Carte 10 parties', sportKeys: ['padel'], description: null, imageUrl: null,
  price: '117.00', entriesCount: 10, walletAmount: null, validityDays: 180, isActive: true, createdAt: '2026-01-01T00:00:00Z',
  stats: { soldCount: 23, activeCount: 8, outstandingAmount: '0.00' },
};
const plan = {
  id: 'plan-1', name: 'Padel illimité', description: null, imageUrl: null, sportKeys: ['padel'],
  monthlyPrice: '49.00', commitmentMonths: 12, offPeakOnly: false, benefit: 'INCLUDED', discountPercent: null,
  dailyCap: null, weeklyCap: null, isActive: true, createdAt: '2026-01-01T00:00:00Z',
};
const overview = {
  kpis: { activeCount: 12, monthlyRevenueCents: 58800, expiringSoonCount: 0 },
  plans: [{ id: 'plan-1', name: 'Padel illimité', monthlyPrice: '49.00', benefit: 'INCLUDED', discountPercent: null, sportKeys: ['padel'], isActive: true, activeCount: 12 }],
  subscribers: Array.from({ length: 12 }, (_, i) => ({
    id: `s${i}`, user: { id: `u${i}`, firstName: 'A', lastName: 'B', avatarUrl: null }, planId: 'plan-1', planName: 'Padel illimité',
    status: 'ACTIVE', startedAt: '2026-01-01T00:00:00Z', expiresAt: '2027-01-01T00:00:00Z', monthlyPriceSnapshot: '49.00', sportKeys: ['padel'],
  })),
};

beforeEach(() => {
  jest.clearAllMocks();
  (api.adminGetPackageTemplates as jest.Mock).mockResolvedValue([tpl]);
  (api.adminGetSubscriptionPlans as jest.Mock).mockResolvedValue([plan]);
  (api.adminGetSubscriptionOverview as jest.Mock).mockResolvedValue(overview);
});

const mount = () => render(<ThemeProvider><AdminPackagesPage /></ThemeProvider>);

it('affiche le titre « Offres » et les deux sections', async () => {
  mount();
  expect(await screen.findByRole('heading', { name: 'Offres' })).toBeInTheDocument();
  expect(screen.getByText('Abonnements')).toBeInTheDocument();
  expect(screen.getByText('Carnets & Porte-monnaie')).toBeInTheDocument();
});

it('rend une carte par offre avec son pouls', async () => {
  mount();
  expect(await screen.findByText('Carte 10 parties')).toBeInTheDocument();
  expect(screen.getByText('Padel illimité')).toBeInTheDocument();
  expect(screen.getByText('8 en circulation · 23 vendus')).toBeInTheDocument();
  expect(screen.getByText('12 abonnés actifs · 588 €/mois')).toBeInTheDocument();
});

it('« Créer une offre » ouvre le studio', async () => {
  mount();
  fireEvent.click(await screen.findByRole('button', { name: /Créer une offre/ }));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  expect(screen.getByText('Ce que verront vos joueurs')).toBeInTheDocument();
});

it('crée un carnet via le studio (create + upload image sauté sans fichier)', async () => {
  (api.adminCreatePackageTemplate as jest.Mock).mockResolvedValue({ ...tpl, id: 'tpl-new' });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: /Créer une offre/ }));
  await screen.findByRole('dialog');
  // Passe en Carnet
  fireEvent.click(screen.getByRole('button', { name: /Carnet/ }));
  fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Carte 5' } });
  fireEvent.change(screen.getByLabelText('Prix de vente €'), { target: { value: '60' } });
  fireEvent.change(screen.getByLabelText('Entrées'), { target: { value: '5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Mettre en vente' }));
  await waitFor(() => expect(api.adminCreatePackageTemplate).toHaveBeenCalledWith(
    'club-1', expect.objectContaining({ kind: 'ENTRIES', name: 'Carte 5', price: 60, entriesCount: 5 }), 'tok',
  ));
  expect(api.adminUploadPackageTemplateImage).not.toHaveBeenCalled();
});

it('« Modifier » un abonnement préremplit le studio et enregistre via update', async () => {
  (api.adminUpdateSubscriptionPlan as jest.Mock).mockResolvedValue(plan);
  mount();
  await screen.findByText('Padel illimité');
  // La carte du plan porte un bouton Modifier ; on prend celui dans la section Abonnements.
  const planCard = screen.getByText('Padel illimité').closest('div')!.parentElement!.parentElement!;
  fireEvent.click(within(planCard).getByRole('button', { name: 'Modifier' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByDisplayValue('Padel illimité')).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.adminUpdateSubscriptionPlan).toHaveBeenCalledWith(
    'club-1', 'plan-1', expect.objectContaining({ name: 'Padel illimité', monthlyPrice: 49 }), 'tok',
  ));
});

it('« Retirer » désactive l’offre', async () => {
  (api.adminUpdatePackageTemplate as jest.Mock).mockResolvedValue({ ...tpl, isActive: false });
  mount();
  await screen.findByText('Carte 10 parties');
  const tplCard = screen.getByText('Carte 10 parties').closest('div')!.parentElement!.parentElement!;
  fireEvent.click(within(tplCard).getByRole('button', { name: 'Retirer' }));
  await waitFor(() => expect(api.adminUpdatePackageTemplate).toHaveBeenCalledWith(
    'club-1', 'tpl-1', { isActive: false }, 'tok',
  ));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/jest/bin/jest.js __tests__/AdminPackages.test.tsx` (cwd `frontend/`)
Expected: FAIL — la page actuelle affiche « Offres prépayées », pas de studio ni de pouls.

- [ ] **Step 3: Réécrire la page**

Remplacer entièrement `frontend/app/admin/packages/page.tsx` :

```tsx
'use client';
import { useState, useEffect, useCallback, CSSProperties } from 'react';
import { api, PackageTemplate, SubscriptionPlan, SubscriptionOverview } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { offerAccent, planPulse, packagePulse, planRevenueCents, splitByActive } from '@/lib/adminOffers';
import { OfferCard } from '@/components/admin/offers/OfferCard';
import { OfferStudio, OfferStudioResult } from '@/components/admin/offers/OfferStudio';

const euro = (s: string | number) => `${Number(s).toFixed(2).replace('.', ',')} €`;
const SPORT_OPTIONS = ['padel', 'squash', 'tennis', 'badminton', 'pickleball', 'pingpong'];

type Editing = { kind: 'plan'; plan: SubscriptionPlan } | { kind: 'package'; tpl: PackageTemplate };

export default function AdminPackagesPage() {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { club } = useClub();
  const clubId = club?.id;

  const [templates, setTemplates] = useState<PackageTemplate[]>([]);
  const [plans, setPlans]         = useState<SubscriptionPlan[]>([]);
  const [overview, setOverview]   = useState<SubscriptionOverview | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [busy, setBusy]           = useState(false);
  const [nowMs, setNowMs]         = useState(0);

  // Studio : fermé | création | édition.
  const [studioOpen, setStudioOpen] = useState(false);
  const [editing, setEditing]       = useState<Editing | undefined>(undefined);

  const load = useCallback(async () => {
    if (!token || !clubId) return;
    setLoading(true);
    try {
      setError(null);
      const [tpls, pls, ov] = await Promise.all([
        api.adminGetPackageTemplates(clubId, token),
        api.adminGetSubscriptionPlans(clubId, token),
        api.adminGetSubscriptionOverview(clubId, token),
      ]);
      setTemplates(tpls); setPlans(pls); setOverview(ov); setNowMs(Date.now());
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [token, clubId]);

  useEffect(() => { if (ready && token && clubId) load(); }, [ready, token, clubId, load]);

  const openCreate = () => { setEditing(undefined); setStudioOpen(true); };
  const openEditPlan = (p: SubscriptionPlan) => { setEditing({ kind: 'plan', plan: p }); setStudioOpen(true); };
  const openEditTpl = (t: PackageTemplate) => { setEditing({ kind: 'package', tpl: t }); setStudioOpen(true); };

  const submitStudio = async (r: OfferStudioResult) => {
    if (!token || !clubId) return;
    setBusy(true);
    try {
      setError(null);
      if (r.kind === 'plan') {
        if (editing?.kind === 'plan') {
          await api.adminUpdateSubscriptionPlan(clubId, editing.plan.id, {
            ...r.body, ...(r.removeImage && !r.imageFile ? { imageUrl: null } : {}),
          }, token);
          if (r.imageFile) await api.adminUploadSubscriptionPlanImage(clubId, editing.plan.id, r.imageFile, token);
        } else {
          const created = await api.adminCreateSubscriptionPlan(clubId, r.body, token);
          if (r.imageFile) await api.adminUploadSubscriptionPlanImage(clubId, created.id, r.imageFile, token);
        }
      } else {
        if (editing?.kind === 'package') {
          await api.adminUpdatePackageTemplate(clubId, editing.tpl.id, {
            ...r.body, ...(r.removeImage && !r.imageFile ? { imageUrl: null } : {}),
          }, token);
          if (r.imageFile) await api.adminUploadPackageTemplateImage(clubId, editing.tpl.id, r.imageFile, token);
        } else {
          const created = await api.adminCreatePackageTemplate(clubId, r.body, token);
          if (r.imageFile) await api.adminUploadPackageTemplateImage(clubId, created.id, r.imageFile, token);
        }
      }
      setStudioOpen(false); setEditing(undefined);
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const toggleTpl = async (t: PackageTemplate) => {
    if (!token || !clubId) return;
    setBusy(true);
    try { setError(null); await api.adminUpdatePackageTemplate(clubId, t.id, { isActive: !t.isActive }, token); await load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const togglePlan = async (p: SubscriptionPlan) => {
    if (!token || !clubId) return;
    setBusy(true);
    try { setError(null); await api.adminUpdateSubscriptionPlan(clubId, p.id, { isActive: !p.isActive }, token); await load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const subscribers = overview?.subscribers ?? [];
  const activeCountFor = (planId: string) => overview?.plans.find((p) => p.id === planId)?.activeCount ?? 0;

  // Lien profond vers Membres pré-filtré sur un plan (même sous-domaine club → href relatif).
  const membersHref = (planId: string) => `/admin/members?plan=${planId}`;

  // Ordre d'affichage : abonnements d'abord (indices 0..n), puis carnets — accents cyclés en continu.
  const { active: activePlans, inactive: inactivePlans } = splitByActive(plans);
  const { active: activeTpls, inactive: inactiveTpls } = splitByActive(templates);
  const orderedPlans = [...activePlans, ...inactivePlans];
  const orderedTpls = [...activeTpls, ...inactiveTpls];

  const h1: CSSProperties = { fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 34, letterSpacing: -0.5, margin: 0, color: th.text };
  const kicker: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, fontFamily: th.fontUI, fontSize: 12, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', color: th.textMute, margin: '26px 0 12px' };
  const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 12 };
  const Kicker = ({ children }: { children: React.ReactNode }) => (
    <div style={kicker}><span>{children}</span><span aria-hidden style={{ flex: 1, height: 1, background: th.line }} /></div>
  );

  const empty = !loading && plans.length === 0 && templates.length === 0;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h1 style={h1}>Offres</h1>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={openCreate}
          style={{ border: 'none', background: th.accent, color: th.onAccent, borderRadius: 999, padding: '10px 18px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 800, boxShadow: th.shadowSoft }}>
          ＋ Créer une offre
        </button>
      </div>

      {error && <div style={{ marginTop: 16, background: '#ff7a4d', color: '#fff', borderRadius: 12, padding: '11px 14px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>{error}</div>}

      {loading ? (
        <div style={{ marginTop: 20, fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>
      ) : empty ? (
        <div style={{ marginTop: 30, background: th.surface, borderRadius: 16, boxShadow: th.shadow, padding: '40px 20px', textAlign: 'center' }}>
          <div style={{ fontFamily: th.fontUI, fontSize: 15, fontWeight: 700, color: th.text }}>Créez votre première offre</div>
          <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, marginTop: 6 }}>Abonnements, carnets d’entrées ou porte-monnaie — vos joueurs les verront sur le Club-house.</div>
          <button type="button" onClick={openCreate} style={{ marginTop: 16, border: 'none', background: th.accent, color: th.onAccent, borderRadius: 999, padding: '10px 18px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 800 }}>＋ Créer une offre</button>
        </div>
      ) : (
        <>
          {orderedPlans.length > 0 && (
            <>
              <Kicker>Abonnements</Kicker>
              <div style={grid}>
                {orderedPlans.map((p, i) => (
                  <OfferCard key={p.id} tint={offerAccent(i)} kindLabel="Abonnement" name={p.name}
                    price={euro(p.monthlyPrice)} priceSuffix={`/mois · ${p.commitmentMonths} mois`}
                    features={[
                      p.sportKeys.length > 0 ? p.sportKeys.join(', ') : 'Tous sports',
                      p.offPeakOnly ? 'Heures creuses' : 'Toutes heures',
                      p.benefit === 'INCLUDED' ? 'inclus' : `−${p.discountPercent} %`,
                    ].join(' · ')}
                    pulse={
                      activeCountFor(p.id) > 0 ? (
                        <a href={membersHref(p.id)} style={{ color: 'inherit', textDecoration: 'none' }}>
                          {planPulse(activeCountFor(p.id), planRevenueCents(subscribers, p.id, nowMs))} →
                        </a>
                      ) : planPulse(0, 0)
                    }
                    isActive={p.isActive} busy={busy} onEdit={() => openEditPlan(p)} onToggleActive={() => togglePlan(p)} />
                ))}
              </div>
            </>
          )}

          {orderedTpls.length > 0 && (
            <>
              <Kicker>Carnets &amp; Porte-monnaie</Kicker>
              <div style={grid}>
                {orderedTpls.map((t, i) => (
                  <OfferCard key={t.id} tint={offerAccent(orderedPlans.length + i)}
                    kindLabel={t.kind === 'ENTRIES' ? 'Carnet' : 'Porte-monnaie'} name={t.name}
                    price={euro(t.price)}
                    priceSuffix={t.kind === 'ENTRIES' ? `· ${t.entriesCount} entrées` : `· ${euro(t.walletAmount ?? 0)} crédités`}
                    features={[
                      t.sportKeys.length > 0 ? t.sportKeys.join(', ') : 'Tous sports',
                      t.validityDays ? `valable ${t.validityDays} j` : 'sans expiration',
                    ].join(' · ')}
                    pulse={packagePulse(t.stats, t.kind)}
                    isActive={t.isActive} busy={busy} onEdit={() => openEditTpl(t)} onToggleActive={() => toggleTpl(t)} />
                ))}
              </div>
            </>
          )}
        </>
      )}

      <OfferStudio open={studioOpen} editing={editing} previewIndex={editing ? 0 : orderedPlans.length + orderedTpls.length}
        sportOptions={SPORT_OPTIONS} busy={busy} error={studioOpen ? error : null}
        onClose={() => { setStudioOpen(false); setEditing(undefined); }} onSubmit={submitStudio} />
    </div>
  );
}
```

- [ ] **Step 4: Renommer l'entrée de nav**

Modifier `frontend/app/admin/layout.tsx:156` :

```typescript
      { href: '/admin/packages',     label: 'Offres prépayées', icon: 'card' },
```

en :

```typescript
      { href: '/admin/packages',     label: 'Offres', icon: 'card' },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node node_modules/jest/bin/jest.js __tests__/AdminPackages.test.tsx` (cwd `frontend/`)
Expected: PASS (6 tests). Si un `closest('div')` de test ne cible pas la bonne carte, ajuster la remontée DOM dans le test (les cartes ont bouton « Modifier » + « Retirer »/« Remettre en vente » — cibler via `within(card)`).

- [ ] **Step 6: Type-check**

Run: `node node_modules/typescript/bin/tsc --noEmit -p .` (cwd `frontend/`)
Expected: aucune erreur nouvelle citant `app/admin/packages/page.tsx`.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/admin/packages/page.tsx frontend/app/admin/layout.tsx frontend/__tests__/AdminPackages.test.tsx
git commit -m "feat(offres): page vitrine miroir + studio, nav « Offres »"
```

---

## Task 9: Frontend — page Membres lit `?plan=<id>`

**Files:**
- Modify: `frontend/app/admin/members/page.tsx` (ajouter un effet de montage après le bloc d'état, ~ligne 93)
- Modify: `frontend/__tests__/AdminMembersFilters.test.tsx` (+1 cas)

- [ ] **Step 1: Write the failing test**

Ajouter à la fin de `frontend/__tests__/AdminMembersFilters.test.tsx` :

```tsx
it('?plan=<id> ouvre le contexte Abonnés pré-filtré sur le forfait', async () => {
  window.history.replaceState({}, '', '/admin/members?plan=p1');
  mount();
  await screen.findByText('Ana Bernard');
  // Le segment Abonnés est actif → seule Ana (abonnée p1) est visible
  expect(screen.getByText('Ana Bernard')).toBeInTheDocument();
  expect(screen.queryByText('Zoé Diaz')).toBeNull();
  // Nettoyage
  window.history.replaceState({}, '', '/admin/members');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/jest/bin/jest.js __tests__/AdminMembersFilters.test.tsx -t "plan"` (cwd `frontend/`)
Expected: FAIL — sans lecture de `?plan=`, le segment reste « Tous » et Zoé est visible.

- [ ] **Step 3: Ajouter l'effet de montage**

Dans `frontend/app/admin/members/page.tsx`, juste après la ligne 93 (`useEffect(() => { if (ready && token && clubId) load(); }, [ready, token, clubId, load]);`), insérer :

```typescript
  // Lien profond depuis /admin/offres : ?plan=<id> → contexte Abonnés pré-filtré (one-shot au montage).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const planId = new URLSearchParams(window.location.search).get('plan');
    if (planId) { setSeg('subs'); setPlanFilter(planId); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

**Note d'ordre des effets :** l'effet de reset des sous-filtres (`if (seg !== 'subs') { setPlanFilter(null)… }`, ligne ~96) a `[seg]` en dépendances. Comme cet effet-ci pose `seg='subs'` ET `planFilter` dans le même tick (batch React), aucun rendu intermédiaire à `seg='all' + planFilter='p1'` ne survient ; le reset voit `seg==='subs'` et ne s'exécute pas. Ne pas déplacer cet effet avant la déclaration de `setSeg`/`setPlanFilter`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_modules/jest/bin/jest.js __tests__/AdminMembersFilters.test.tsx` (cwd `frontend/`)
Expected: PASS (toute la suite — les cas existants n'ont pas de `?plan=` dans l'URL, donc l'effet est inerte pour eux).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/admin/members/page.tsx frontend/__tests__/AdminMembersFilters.test.tsx
git commit -m "feat(offres): Membres lit ?plan= pour le lien profond du pouls"
```

---

## Task 10: Vérification finale (type-check, suites, visuel)

**Files:** aucun (vérification).

- [ ] **Step 1: Type-check frontend complet**

Run: `node node_modules/typescript/bin/tsc --noEmit -p .` (cwd `frontend/`)
Expected: aucune erreur citant les fichiers touchés (`adminOffers.ts`, `OfferPreviewCard.tsx`, `OfferStudio.tsx`, `OfferCard.tsx`, `app/admin/packages/page.tsx`, `app/admin/members/page.tsx`, `lib/api.ts`). Des erreurs pré-existantes d'autres WIP parallèles peuvent subsister — les ignorer si elles ne citent pas ces fichiers.

- [ ] **Step 2: Suites frontend ciblées**

Run: `node node_modules/jest/bin/jest.js __tests__/adminOffers.test.ts __tests__/AdminPackages.test.tsx __tests__/AdminMembersFilters.test.tsx __tests__/AdminLayout.test.tsx` (cwd `frontend/`)
Expected: PASS. Si `AdminLayout.test.tsx` asserte le libellé « Offres prépayées », le mettre à jour en « Offres ».

- [ ] **Step 3: Suite backend package.service**

Run: `node node_modules/jest/bin/jest.js src/services/__tests__/package.service.test.ts` (cwd `backend/`)
Expected: PASS (toute la suite).

- [ ] **Step 4: Vérification visuelle CDP**

Lancer la stack si besoin (`start.ps1`) puis utiliser le skill **verify** pour capturer `/admin/packages` (hôte club, session staff) en **clair + sombre**, **desktop 1280 + mobile 390** :
- grille des cartes-miroir (liseré/lavis/accent, pouls lisible) ;
- ouverture du studio (2 colonnes desktop, aperçu joueur en direct qui suit la saisie ; empilé en mobile 390, aperçu sous le formulaire) ;
- `scrollWidth ≤ viewport` partout (aucun débordement horizontal) ;
- une offre désactivée estompée en fin de section.

Corriger tout écart visuel constaté (contraste des lavis en thème sombre notamment) avant de clore.

- [ ] **Step 5: Commit final si retouches visuelles**

```bash
git add -A
git commit -m "fix(offres): retouches visuelles apres verification CDP"
```

---

## Notes d'implémentation & écarts assumés

- **Mobile studio** : l'aperçu s'empile **sous** le formulaire (réutilise `.pl-create-grid`, pattern éprouvé de la modale planning) plutôt que d'être replié derrière « Voir l'aperçu ✨ ». Écart mineur au spec, choisi pour la robustesse (pas de toggle mobile-only fragile). Si Eric veut le repli, l'ajouter en v1.1.
- **Pouls carnet non cliquable** : conforme au spec (la page Membres n'a pas de filtre carnet).
- **Lien profond Membres** : href relatif `/admin/members?plan=<id>` — `/admin/packages` et `/admin/members` sont sur le même sous-domaine club, pas besoin de `clubUrl`.
- **Aucune migration, aucune route nouvelle** : les routes `PATCH /packages/templates/:id` et `/subscription-plans/:id` passent déjà `req.body` au service ; l'élargissement de `updateTemplate` suffit.
```
