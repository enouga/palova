# Abonnements — Plan d'implémentation BACKEND

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backend des abonnements configurables : modèles dédiés `SubscriptionPlan`/`Subscription`, service CRUD + vente, couverture automatique au booking (gratuit/remise en heures creuses), et seed des 2 plans exemples sur tous les clubs de test.

**Architecture:** Modèles **dédiés** (pas de greffe sur les packages → zéro régression prépayé). Le droit d'accès du membre (`Subscription`) **fige un snapshot** des champs de couverture à la vente. La couverture s'applique dans `confirmReservation` via un nouveau `paymentSource: { subscriptionId }` qui enregistre un `Payment(method SUBSCRIPTION)` « sans argent » éteignant (ou réduisant) le dû. Migration 100 % additive.

**Tech Stack:** Express 5, Prisma 7 (adapter `PrismaPg`), PostgreSQL, Luxon (fuseaux), Jest + `jest-mock-extended` (Prisma **mocké** — les tests assertent sur `prismaMock`, pas de vraie DB).

**Spec :** `docs/superpowers/specs/2026-06-23-abonnement-design.md`. **Branche :** `feat/abonnements` (déjà créée).

---

## Structure des fichiers

- **Créer** `backend/src/services/subscription.service.ts` — `SubscriptionService` (CRUD plans, vente, listes, `coverageFor` pur).
- **Créer** `backend/src/services/__tests__/subscription.service.test.ts` — tests service.
- **Modifier** `backend/prisma/schema.prisma` — enums + modèles + champs `Payment`.
- **Modifier** `backend/src/routes/admin.ts` — routes admin (plans + vente + liste membre).
- **Modifier** `backend/src/routes/clubs.ts` — route joueur `/:slug/me/subscriptions`.
- **Modifier** `backend/src/services/reservation.service.ts` — couverture au booking dans `confirmReservation` + exclusion `SUBSCRIPTION` des remboursables.
- **Modifier** `backend/src/services/__tests__/reservation.service.test.ts` — bloc couverture.
- **Modifier** `backend/prisma/seed-offers.ts` — `seedDefaultSubscriptionPlans`.
- **Modifier** `backend/prisma/seed.ts` et `backend/prisma/seed-demo.ts` — appel du seed des plans.

---

## Task 1 : Schéma Prisma — enums, modèles, champs Payment (migration additive)

**Files:**
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1 : Ajouter `SUBSCRIPTION` à l'enum `PaymentMethod`** (après `MEMBER`, `schema.prisma:50`)

```prisma
enum PaymentMethod {
  CASH
  CARD
  TRANSFER
  ONLINE
  OTHER
  VOUCHER      // ticket CE / chèque sport
  PACK_CREDIT  // consommation d'1 entrée d'un carnet
  WALLET       // débit du porte-monnaie €
  MEMBER       // couvert par l'abonnement du membre (pas de flux d'argent)
  SUBSCRIPTION // couverture automatique par un abonnement actif (pas de flux d'argent)
}
```

- [ ] **Step 2 : Ajouter deux enums** (à côté de `PackageKind`, vers `schema.prisma:68`)

```prisma
/// Avantage d'un abonnement sur les créneaux couverts.
enum SubscriptionBenefit {
  INCLUDED  // créneau gratuit
  DISCOUNT  // remise en pourcentage
}

/// Cycle de vie d'un abonnement vendu.
enum SubscriptionStatus {
  ACTIVE
  CANCELLED
}
```

- [ ] **Step 3 : Ajouter les deux modèles** (après le modèle `MemberPackage`, vers `schema.prisma:800`)

```prisma
/// Template d'abonnement configurable par le club (affiché dans /admin/packages).
model SubscriptionPlan {
  id               String              @id @default(cuid())
  clubId           String              @map("club_id")
  name             String
  sportKeys        String[]            @map("sport_keys")        // clés Sport couvertes (['padel'])
  monthlyPrice     Decimal             @map("monthly_price") @db.Decimal(10, 2)
  commitmentMonths Int                 @map("commitment_months")
  offPeakOnly      Boolean             @default(true) @map("off_peak_only")
  benefit          SubscriptionBenefit @default(INCLUDED)
  discountPercent  Int?                @map("discount_percent")  // si DISCOUNT (1..100)
  dailyCap         Int?                @map("daily_cap")         // max résas couvertes / jour (null = illimité)
  weeklyCap        Int?                @map("weekly_cap")        // max / semaine (null = illimité)
  isActive         Boolean             @default(true) @map("is_active")
  createdAt        DateTime            @default(now()) @map("created_at")
  updatedAt        DateTime            @updatedAt @map("updated_at")

  club          Club           @relation(fields: [clubId], references: [id], onDelete: Cascade)
  subscriptions Subscription[]

  @@index([clubId])
  @@map("subscription_plans")
}

/// Droit d'accès d'un membre, vendu une fois. Snapshot de couverture figé à la vente.
model Subscription {
  id                   String              @id @default(cuid())
  clubId               String              @map("club_id")
  userId               String              @map("user_id")
  planId               String              @map("plan_id")
  startedAt            DateTime            @default(now()) @map("started_at")
  expiresAt            DateTime            @map("expires_at")
  status               SubscriptionStatus  @default(ACTIVE)
  monthlyPriceSnapshot Decimal             @map("monthly_price_snapshot") @db.Decimal(10, 2)
  sportKeys            String[]            @map("sport_keys")        // snapshot
  offPeakOnly          Boolean             @map("off_peak_only")     // snapshot
  benefit              SubscriptionBenefit                           // snapshot
  discountPercent      Int?                @map("discount_percent")  // snapshot
  dailyCap             Int?                @map("daily_cap")         // snapshot
  weeklyCap            Int?                @map("weekly_cap")        // snapshot
  createdAt            DateTime            @default(now()) @map("created_at")

  club     Club             @relation(fields: [clubId], references: [id], onDelete: Cascade)
  user     User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  plan     SubscriptionPlan @relation(fields: [planId], references: [id], onDelete: Restrict)
  payments Payment[]

  @@index([clubId, userId])
  @@map("subscriptions")
}
```

- [ ] **Step 4 : Ajouter les deux liens `Payment`** (après `sourcePackageId`, `schema.prisma:703`) et leurs relations (après la relation `sourcePackage`, `:718`)

```prisma
  // (dans model Payment, après sourcePackageId)
  subscriptionId       String? @map("subscription_id")        // = vente de cet abonnement
  sourceSubscriptionId String? @map("source_subscription_id") // = couverture par cet abonnement
```

```prisma
  // (dans model Payment, après la relation sourcePackage)
  subscriptionSale   Subscription? @relation("SubscriptionSale", fields: [subscriptionId], references: [id], onDelete: SetNull)
  sourceSubscription Subscription? @relation("SubscriptionCoverage", fields: [sourceSubscriptionId], references: [id], onDelete: SetNull)
```

Et nommer les deux relations côté `Subscription` (remplacer `payments Payment[]` par les deux back-relations) :

```prisma
  salePayments     Payment[] @relation("SubscriptionSale")
  coveragePayments Payment[] @relation("SubscriptionCoverage")
```

- [ ] **Step 5 : Ajouter les back-relations sur `Club` et `User`**

Dans `model Club` (avec les autres `… []` relations) :

```prisma
  subscriptionPlans SubscriptionPlan[]
  subscriptions     Subscription[]
```

Dans `model User` (avec les autres relations) :

```prisma
  subscriptions Subscription[]
```

- [ ] **Step 6 : Générer la migration**

Run : `cd backend && npx prisma migrate dev --name add_subscriptions`
Expected : nouvelle migration créée + appliquée + client régénéré.
**Si erreur de dérive de migration** (cf. note OneDrive dans CLAUDE.md) : `npx prisma db push` puis `npx prisma generate`.

- [ ] **Step 7 : Vérifier la génération du client**

Run : `cd backend && npx prisma generate && npx tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected : pas d'erreur (les types `SubscriptionPlan`, `Subscription`, `SubscriptionBenefit`, `SubscriptionStatus` existent).

- [ ] **Step 8 : Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(abonnements): modèles SubscriptionPlan/Subscription + méthode paiement SUBSCRIPTION"
```

---

## Task 2 : `SubscriptionService.createPlan` + validation

**Files:**
- Create: `backend/src/services/subscription.service.ts`
- Create: `backend/src/services/__tests__/subscription.service.test.ts`

- [ ] **Step 1 : Écrire les tests qui échouent**

```ts
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { SubscriptionService } from '../subscription.service';

const SPORTS = [{ key: 'padel' }, { key: 'squash' }];

describe('SubscriptionService — createPlan', () => {
  let service: SubscriptionService;
  beforeEach(() => {
    service = new SubscriptionService();
    prismaMock.sport.findMany.mockResolvedValue(SPORTS as any);
  });

  it('crée un plan INCLUDED valide', async () => {
    prismaMock.subscriptionPlan.create.mockResolvedValue({ id: 'plan-1' } as any);
    await service.createPlan('club-1', {
      name: 'Abo Padel', sportKeys: ['padel'], monthlyPrice: 69, commitmentMonths: 12,
      offPeakOnly: true, benefit: 'INCLUDED',
    });
    expect(prismaMock.subscriptionPlan.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        clubId: 'club-1', sportKeys: ['padel'], offPeakOnly: true, benefit: 'INCLUDED', discountPercent: null,
      }),
    }));
  });

  it('exige discountPercent (1..100) si DISCOUNT', async () => {
    await expect(service.createPlan('club-1', {
      name: 'x', sportKeys: ['padel'], monthlyPrice: 69, commitmentMonths: 12, benefit: 'DISCOUNT',
    })).rejects.toThrow('VALIDATION_ERROR');
    await expect(service.createPlan('club-1', {
      name: 'x', sportKeys: ['padel'], monthlyPrice: 69, commitmentMonths: 12, benefit: 'DISCOUNT', discountPercent: 150,
    })).rejects.toThrow('VALIDATION_ERROR');
  });

  it('refuse un sportKey hors catalogue', async () => {
    await expect(service.createPlan('club-1', {
      name: 'x', sportKeys: ['tennis'], monthlyPrice: 69, commitmentMonths: 12, benefit: 'INCLUDED',
    })).rejects.toThrow('VALIDATION_ERROR');
  });

  it('refuse sportKeys vide, prix ≤ 0, engagement < 1, cap ≤ 0', async () => {
    const base = { name: 'x', sportKeys: ['padel'], monthlyPrice: 69, commitmentMonths: 12, benefit: 'INCLUDED' as const };
    await expect(service.createPlan('club-1', { ...base, sportKeys: [] })).rejects.toThrow('VALIDATION_ERROR');
    await expect(service.createPlan('club-1', { ...base, monthlyPrice: 0 })).rejects.toThrow('VALIDATION_ERROR');
    await expect(service.createPlan('club-1', { ...base, commitmentMonths: 0 })).rejects.toThrow('VALIDATION_ERROR');
    await expect(service.createPlan('club-1', { ...base, dailyCap: 0 })).rejects.toThrow('VALIDATION_ERROR');
  });
});
```

- [ ] **Step 2 : Lancer → échec**

Run : `cd backend && npx jest subscription.service -t createPlan`
Expected : FAIL « Cannot find module '../subscription.service' ».

- [ ] **Step 3 : Implémenter le service (squelette + createPlan)**

```ts
import { Prisma, PaymentMethod, SubscriptionBenefit } from '@prisma/client';
import { DateTime } from 'luxon';
import { prisma } from '../db/prisma';
import { PackageService } from './package.service';

/** Méthodes acceptées pour encaisser la VENTE d'un abonnement (1re mensualité). */
const SALE_METHODS = ['CASH', 'CARD', 'TRANSFER', 'VOUCHER', 'OTHER'] as const;

type PlanBody = {
  name?: string; sportKeys?: string[]; monthlyPrice?: number; commitmentMonths?: number;
  offPeakOnly?: boolean; benefit?: string; discountPercent?: number | null;
  dailyCap?: number | null; weeklyCap?: number | null;
};

export class SubscriptionService {
  /** Valide un corps de plan (création/màj). Lève VALIDATION_ERROR. */
  private async validatePlan(body: PlanBody): Promise<void> {
    const { name, sportKeys, monthlyPrice, commitmentMonths, benefit, discountPercent, dailyCap, weeklyCap } = body;
    if (!name?.trim())                                                   throw new Error('VALIDATION_ERROR');
    if (!Array.isArray(sportKeys) || sportKeys.length === 0)             throw new Error('VALIDATION_ERROR');
    const known = await prisma.sport.findMany({ where: { key: { in: sportKeys } }, select: { key: true } });
    if (known.length !== new Set(sportKeys).size)                        throw new Error('VALIDATION_ERROR');
    if (typeof monthlyPrice !== 'number' || isNaN(monthlyPrice) || monthlyPrice <= 0) throw new Error('VALIDATION_ERROR');
    if (!Number.isInteger(commitmentMonths) || (commitmentMonths as number) < 1)      throw new Error('VALIDATION_ERROR');
    if (benefit !== 'INCLUDED' && benefit !== 'DISCOUNT')                throw new Error('VALIDATION_ERROR');
    if (benefit === 'DISCOUNT' && (!Number.isInteger(discountPercent) || (discountPercent as number) < 1 || (discountPercent as number) > 100))
                                                                        throw new Error('VALIDATION_ERROR');
    for (const cap of [dailyCap, weeklyCap]) {
      if (cap != null && (!Number.isInteger(cap) || cap < 1))           throw new Error('VALIDATION_ERROR');
    }
  }

  async listPlans(clubId: string) {
    return prisma.subscriptionPlan.findMany({ where: { clubId }, orderBy: { createdAt: 'asc' } });
  }

  async createPlan(clubId: string, body: PlanBody) {
    await this.validatePlan(body);
    return prisma.subscriptionPlan.create({
      data: {
        clubId,
        name: body.name!.trim(),
        sportKeys: body.sportKeys!,
        monthlyPrice: new Prisma.Decimal(body.monthlyPrice!),
        commitmentMonths: body.commitmentMonths!,
        offPeakOnly: body.offPeakOnly ?? true,
        benefit: body.benefit as SubscriptionBenefit,
        discountPercent: body.benefit === 'DISCOUNT' ? body.discountPercent! : null,
        dailyCap: body.dailyCap ?? null,
        weeklyCap: body.weeklyCap ?? null,
      },
    });
  }
}
```

- [ ] **Step 4 : Lancer → succès**

Run : `cd backend && npx jest subscription.service -t createPlan`
Expected : PASS (4 tests).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/subscription.service.ts backend/src/services/__tests__/subscription.service.test.ts
git commit -m "feat(abonnements): SubscriptionService.createPlan + validation"
```

---

## Task 3 : `updatePlan`

**Files:**
- Modify: `backend/src/services/subscription.service.ts`
- Modify: `backend/src/services/__tests__/subscription.service.test.ts`

- [ ] **Step 1 : Écrire les tests qui échouent**

```ts
describe('SubscriptionService — updatePlan', () => {
  let service: SubscriptionService;
  beforeEach(() => {
    service = new SubscriptionService();
    prismaMock.sport.findMany.mockResolvedValue(SPORTS as any);
  });

  it('refuse un plan d’un autre club', async () => {
    prismaMock.subscriptionPlan.findUnique.mockResolvedValue({ id: 'plan-1', clubId: 'autre' } as any);
    await expect(service.updatePlan('plan-1', 'club-1', { isActive: false })).rejects.toThrow('PLAN_NOT_FOUND');
  });

  it('met à jour les champs fournis (avec revalidation)', async () => {
    prismaMock.subscriptionPlan.findUnique.mockResolvedValue({
      id: 'plan-1', clubId: 'club-1', name: 'Abo', sportKeys: ['padel'], monthlyPrice: 69,
      commitmentMonths: 12, offPeakOnly: true, benefit: 'INCLUDED', discountPercent: null, dailyCap: null, weeklyCap: null,
    } as any);
    prismaMock.subscriptionPlan.update.mockResolvedValue({ id: 'plan-1' } as any);
    await service.updatePlan('plan-1', 'club-1', { monthlyPrice: 75, isActive: false });
    const data = prismaMock.subscriptionPlan.update.mock.calls[0][0].data as any;
    expect(Number(data.monthlyPrice)).toBe(75);
    expect(data.isActive).toBe(false);
  });
});
```

- [ ] **Step 2 : Lancer → échec**

Run : `cd backend && npx jest subscription.service -t updatePlan`
Expected : FAIL « service.updatePlan is not a function ».

- [ ] **Step 3 : Implémenter `updatePlan`** (ajouter à la classe)

```ts
  async updatePlan(id: string, clubId: string, body: PlanBody & { isActive?: boolean }) {
    const existing = await prisma.subscriptionPlan.findUnique({ where: { id } });
    if (!existing || existing.clubId !== clubId) throw new Error('PLAN_NOT_FOUND');

    // Revalide sur l'état fusionné (les champs omis gardent l'existant).
    const merged: PlanBody = {
      name: body.name ?? existing.name,
      sportKeys: body.sportKeys ?? existing.sportKeys,
      monthlyPrice: body.monthlyPrice ?? Number(existing.monthlyPrice),
      commitmentMonths: body.commitmentMonths ?? existing.commitmentMonths,
      benefit: body.benefit ?? existing.benefit,
      discountPercent: body.discountPercent !== undefined ? body.discountPercent : existing.discountPercent,
      dailyCap: body.dailyCap !== undefined ? body.dailyCap : existing.dailyCap,
      weeklyCap: body.weeklyCap !== undefined ? body.weeklyCap : existing.weeklyCap,
    };
    await this.validatePlan(merged);

    const data: Prisma.SubscriptionPlanUpdateInput = {};
    if (body.name !== undefined)             data.name = body.name.trim();
    if (body.sportKeys !== undefined)        data.sportKeys = body.sportKeys;
    if (body.monthlyPrice !== undefined)     data.monthlyPrice = new Prisma.Decimal(body.monthlyPrice);
    if (body.commitmentMonths !== undefined) data.commitmentMonths = body.commitmentMonths;
    if (body.offPeakOnly !== undefined)      data.offPeakOnly = body.offPeakOnly;
    if (body.benefit !== undefined)          data.benefit = body.benefit as SubscriptionBenefit;
    if (body.benefit !== undefined || body.discountPercent !== undefined) {
      data.discountPercent = merged.benefit === 'DISCOUNT' ? (merged.discountPercent ?? null) : null;
    }
    if (body.dailyCap !== undefined)         data.dailyCap = body.dailyCap;
    if (body.weeklyCap !== undefined)        data.weeklyCap = body.weeklyCap;
    if (body.isActive !== undefined)         data.isActive = body.isActive;

    return prisma.subscriptionPlan.update({ where: { id }, data });
  }
```

- [ ] **Step 4 : Lancer → succès**

Run : `cd backend && npx jest subscription.service -t updatePlan`
Expected : PASS.

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/subscription.service.ts backend/src/services/__tests__/subscription.service.test.ts
git commit -m "feat(abonnements): SubscriptionService.updatePlan"
```

---

## Task 4 : `sellSubscription` (snapshot + paiement de vente)

**Files:**
- Modify: `backend/src/services/subscription.service.ts`
- Modify: `backend/src/services/__tests__/subscription.service.test.ts`

- [ ] **Step 1 : Écrire les tests qui échouent**

```ts
describe('SubscriptionService — sellSubscription', () => {
  let service: SubscriptionService;
  const plan = {
    id: 'plan-1', clubId: 'club-1', name: 'Abo Padel', sportKeys: ['padel'], monthlyPrice: 69,
    commitmentMonths: 12, offPeakOnly: true, benefit: 'INCLUDED', discountPercent: null,
    dailyCap: null, weeklyCap: null, isActive: true,
  };
  beforeEach(() => {
    service = new SubscriptionService();
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
    prismaMock.clubCounter.upsert.mockResolvedValue({ value: 1 } as any);
  });

  it('crée la Subscription (snapshot figé) + le Payment de vente = 1re mensualité', async () => {
    prismaMock.subscriptionPlan.findUnique.mockResolvedValue(plan as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ id: 'mb-1' } as any);
    prismaMock.subscription.create.mockResolvedValue({ id: 'sub-1' } as any);
    prismaMock.payment.create.mockResolvedValue({ id: 'pay-1' } as any);

    const out = await service.sellSubscription('club-1', 'user-1', { planId: 'plan-1', method: 'CARD', createdByUserId: 'admin-1' });

    const subData = prismaMock.subscription.create.mock.calls[0][0].data as any;
    expect(subData).toEqual(expect.objectContaining({
      clubId: 'club-1', userId: 'user-1', planId: 'plan-1', status: 'ACTIVE',
      sportKeys: ['padel'], offPeakOnly: true, benefit: 'INCLUDED', discountPercent: null,
    }));
    expect(subData.expiresAt).toBeInstanceOf(Date);
    expect(Number(subData.monthlyPriceSnapshot)).toBe(69);

    expect(prismaMock.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ clubId: 'club-1', subscriptionId: 'sub-1', method: 'CARD', receiptNo: 1 }),
    }));
    expect(out.subscription.id).toBe('sub-1');
  });

  it('refuse un plan inactif / autre club', async () => {
    prismaMock.subscriptionPlan.findUnique.mockResolvedValue({ ...plan, isActive: false } as any);
    await expect(service.sellSubscription('club-1', 'user-1', { planId: 'plan-1' })).rejects.toThrow('PLAN_NOT_FOUND');
  });

  it('refuse un non-membre', async () => {
    prismaMock.subscriptionPlan.findUnique.mockResolvedValue(plan as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue(null);
    await expect(service.sellSubscription('club-1', 'user-1', { planId: 'plan-1' })).rejects.toThrow('MEMBER_NOT_FOUND');
  });
});
```

- [ ] **Step 2 : Lancer → échec**

Run : `cd backend && npx jest subscription.service -t sellSubscription`
Expected : FAIL « service.sellSubscription is not a function ».

- [ ] **Step 3 : Implémenter `sellSubscription`** (ajouter à la classe)

```ts
  async sellSubscription(clubId: string, userId: string, body: {
    planId?: string; method?: string; payerName?: string;
    voucherRef?: string; voucherIssuer?: string; createdByUserId?: string;
  }) {
    const plan = await prisma.subscriptionPlan.findUnique({ where: { id: body.planId ?? '' } });
    if (!plan || plan.clubId !== clubId || !plan.isActive) throw new Error('PLAN_NOT_FOUND');

    const membership = await prisma.clubMembership.findUnique({ where: { userId_clubId: { userId, clubId } } });
    if (!membership) throw new Error('MEMBER_NOT_FOUND');

    const method = (SALE_METHODS.includes(body.method as typeof SALE_METHODS[number]) ? body.method : 'CASH') as PaymentMethod;
    if (method === 'VOUCHER' && !body.voucherRef?.trim()) throw new Error('VALIDATION_ERROR');

    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + plan.commitmentMonths);

    return prisma.$transaction(async (tx) => {
      const sub = await tx.subscription.create({
        data: {
          clubId, userId, planId: plan.id, status: 'ACTIVE', expiresAt,
          monthlyPriceSnapshot: plan.monthlyPrice,
          sportKeys: plan.sportKeys, offPeakOnly: plan.offPeakOnly, benefit: plan.benefit,
          discountPercent: plan.discountPercent, dailyCap: plan.dailyCap, weeklyCap: plan.weeklyCap,
        },
      });
      const receiptNo = await PackageService.nextReceiptNo(tx, clubId);
      const payment = await tx.payment.create({
        data: {
          clubId,
          amount: plan.monthlyPrice,
          method,
          subscriptionId: sub.id,
          payerName: body.payerName?.trim() || null,
          note: `Vente abonnement ${plan.name} — 1re mensualité`,
          voucherRef:    method === 'VOUCHER' ? body.voucherRef!.trim() : null,
          voucherIssuer: method === 'VOUCHER' ? body.voucherIssuer?.trim() || null : null,
          voucherStatus: method === 'VOUCHER' ? 'PENDING_REIMBURSEMENT' : null,
          createdByUserId: body.createdByUserId ?? null,
          receiptNo,
        },
      });
      return { subscription: sub, payment };
    });
  }
```

- [ ] **Step 4 : Lancer → succès**

Run : `cd backend && npx jest subscription.service -t sellSubscription`
Expected : PASS (3 tests).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/subscription.service.ts backend/src/services/__tests__/subscription.service.test.ts
git commit -m "feat(abonnements): SubscriptionService.sellSubscription (snapshot + vente)"
```

---

## Task 5 : Listes joueur/admin + `cancelSubscription`

**Files:**
- Modify: `backend/src/services/subscription.service.ts`
- Modify: `backend/src/services/__tests__/subscription.service.test.ts`

- [ ] **Step 1 : Écrire les tests qui échouent**

```ts
describe('SubscriptionService — listes & cancel', () => {
  let service: SubscriptionService;
  beforeEach(() => { service = new SubscriptionService(); });

  it('listMySubscriptionsBySlug : club ACTIVE, abos ACTIVE non expirés', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-1', status: 'ACTIVE' } as any);
    prismaMock.subscription.findMany.mockResolvedValue([{ id: 'sub-1' }] as any);
    const out = await service.listMySubscriptionsBySlug('mon-club', 'user-1');
    expect(out).toHaveLength(1);
    const where = prismaMock.subscription.findMany.mock.calls[0][0].where as any;
    expect(where.clubId).toBe('club-1');
    expect(where.userId).toBe('user-1');
    expect(where.status).toBe('ACTIVE');
    expect(where.expiresAt).toHaveProperty('gt');
  });

  it('listMySubscriptionsBySlug : club inconnu/suspendu → CLUB_NOT_FOUND', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-1', status: 'SUSPENDED' } as any);
    await expect(service.listMySubscriptionsBySlug('x', 'user-1')).rejects.toThrow('CLUB_NOT_FOUND');
  });

  it('cancelSubscription : passe en CANCELLED', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue({ id: 'sub-1', clubId: 'club-1' } as any);
    prismaMock.subscription.update.mockResolvedValue({ id: 'sub-1', status: 'CANCELLED' } as any);
    await service.cancelSubscription('sub-1', 'club-1');
    expect(prismaMock.subscription.update).toHaveBeenCalledWith({ where: { id: 'sub-1' }, data: { status: 'CANCELLED' } });
  });

  it('cancelSubscription : autre club → SUBSCRIPTION_NOT_FOUND', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue({ id: 'sub-1', clubId: 'autre' } as any);
    await expect(service.cancelSubscription('sub-1', 'club-1')).rejects.toThrow('SUBSCRIPTION_NOT_FOUND');
  });
});
```

- [ ] **Step 2 : Lancer → échec**

Run : `cd backend && npx jest subscription.service -t "listes & cancel"`
Expected : FAIL.

- [ ] **Step 3 : Implémenter les méthodes** (ajouter à la classe)

```ts
  async listMySubscriptionsBySlug(slug: string, userId: string) {
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, status: true } });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    return prisma.subscription.findMany({
      where: { clubId: club.id, userId, status: 'ACTIVE', expiresAt: { gt: new Date() } },
      orderBy: { startedAt: 'desc' },
      include: { plan: { select: { name: true } } },
    });
  }

  async listMemberSubscriptions(clubId: string, userId: string) {
    return prisma.subscription.findMany({
      where: { clubId, userId },
      orderBy: { startedAt: 'desc' },
      include: { plan: { select: { name: true } } },
    });
  }

  async cancelSubscription(id: string, clubId: string) {
    const sub = await prisma.subscription.findUnique({ where: { id } });
    if (!sub || sub.clubId !== clubId) throw new Error('SUBSCRIPTION_NOT_FOUND');
    return prisma.subscription.update({ where: { id }, data: { status: 'CANCELLED' } });
  }
```

- [ ] **Step 4 : Lancer → succès**

Run : `cd backend && npx jest subscription.service -t "listes & cancel"`
Expected : PASS (4 tests).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/subscription.service.ts backend/src/services/__tests__/subscription.service.test.ts
git commit -m "feat(abonnements): listes joueur/admin + cancelSubscription"
```

---

## Task 6 : `coverageFor` (décision de couverture, pur)

**Files:**
- Modify: `backend/src/services/subscription.service.ts`
- Modify: `backend/src/services/__tests__/subscription.service.test.ts`

- [ ] **Step 1 : Écrire les tests qui échouent**

```ts
describe('SubscriptionService.coverageFor', () => {
  const incl = { sportKeys: ['padel'], offPeakOnly: true, benefit: 'INCLUDED' as const, discountPercent: null };
  const disc = { sportKeys: ['padel'], offPeakOnly: true, benefit: 'DISCOUNT' as const, discountPercent: 50 };

  it('INCLUDED creux → couvert, coverCents = dû', () => {
    expect(SubscriptionService.coverageFor(incl, { sportKey: 'padel', isOffPeak: true, dueCents: 1300 }))
      .toEqual({ covered: true, coverCents: 1300 });
  });

  it('offPeakOnly + créneau plein → non couvert', () => {
    expect(SubscriptionService.coverageFor(incl, { sportKey: 'padel', isOffPeak: false, dueCents: 1300 }))
      .toEqual({ covered: false, coverCents: 0 });
  });

  it('sport hors liste → non couvert', () => {
    expect(SubscriptionService.coverageFor(incl, { sportKey: 'squash', isOffPeak: true, dueCents: 1300 }))
      .toEqual({ covered: false, coverCents: 0 });
  });

  it('DISCOUNT 50 % → coverCents = moitié (arrondi)', () => {
    expect(SubscriptionService.coverageFor(disc, { sportKey: 'padel', isOffPeak: true, dueCents: 1300 }))
      .toEqual({ covered: true, coverCents: 650 });
  });
});
```

- [ ] **Step 2 : Lancer → échec**

Run : `cd backend && npx jest subscription.service -t coverageFor`
Expected : FAIL « coverageFor is not a function ».

- [ ] **Step 3 : Implémenter la statique pure** (ajouter à la classe)

```ts
  /** Décision pure de couverture d'un créneau par un abonnement (snapshot). */
  static coverageFor(
    sub: { sportKeys: string[]; offPeakOnly: boolean; benefit: SubscriptionBenefit; discountPercent: number | null },
    ctx: { sportKey: string; isOffPeak: boolean; dueCents: number },
  ): { covered: boolean; coverCents: number } {
    const covered = sub.sportKeys.includes(ctx.sportKey) && (!sub.offPeakOnly || ctx.isOffPeak);
    if (!covered) return { covered: false, coverCents: 0 };
    const coverCents = sub.benefit === 'INCLUDED'
      ? ctx.dueCents
      : Math.round(ctx.dueCents * (sub.discountPercent ?? 0) / 100);
    return { covered: true, coverCents };
  }
```

- [ ] **Step 4 : Lancer → succès**

Run : `cd backend && npx jest subscription.service -t coverageFor`
Expected : PASS (4 tests).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/subscription.service.ts backend/src/services/__tests__/subscription.service.test.ts
git commit -m "feat(abonnements): coverageFor (décision de couverture pure)"
```

---

## Task 7 : Routes admin + route joueur

**Files:**
- Modify: `backend/src/routes/admin.ts`
- Modify: `backend/src/routes/clubs.ts`

- [ ] **Step 1 : Instancier le service dans `admin.ts`** (à côté de `const packageService = new PackageService();`, vers `:39`)

```ts
import { SubscriptionService } from '../services/subscription.service';
const subscriptionService = new SubscriptionService();
```

- [ ] **Step 2 : Ajouter les routes admin** (après les routes `/packages/templates`, vers `admin.ts:693`)

```ts
// --- Abonnements (plans configurables) ---
router.get('/subscription-plans', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await subscriptionService.listPlans(req.membership!.clubId)); } catch (e) { handleError(e, res, next); }
});
router.post('/subscription-plans', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.status(201).json(await subscriptionService.createPlan(req.membership!.clubId, req.body)); } catch (e) { handleError(e, res, next); }
});
router.patch('/subscription-plans/:id', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await subscriptionService.updatePlan(asString(req.params.id), req.membership!.clubId, req.body)); } catch (e) { handleError(e, res, next); }
});

// Vente / liste des abonnements d'un membre
router.get('/members/:userId/subscriptions', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await subscriptionService.listMemberSubscriptions(req.membership!.clubId, asString(req.params.userId))); } catch (e) { handleError(e, res, next); }
});
router.post('/members/:userId/subscriptions', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.status(201).json(await subscriptionService.sellSubscription(req.membership!.clubId, asString(req.params.userId), { ...req.body, createdByUserId: req.user!.id })); } catch (e) { handleError(e, res, next); }
});
```

- [ ] **Step 3 : Ajouter la route joueur dans `clubs.ts`** (après `/:slug/me/packages`, vers `clubs.ts:230`)

```ts
router.get('/:slug/me/subscriptions', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await subscriptionService.listMySubscriptionsBySlug(asString(req.params.slug), req.user!.id)); }
  catch (e) { handleError(e, res, next); }
});
```

Et instancier en tête de `clubs.ts` (à côté de `const packageService = new PackageService();`) :

```ts
import { SubscriptionService } from '../services/subscription.service';
const subscriptionService = new SubscriptionService();
```

- [ ] **Step 4 : Vérifier la compilation + s'assurer que `handleError`/`asString`/`authMiddleware`/`AuthRequest` sont déjà importés dans chaque fichier** (ils le sont — utilisés par les routes packages voisines).

Run : `cd backend && npx tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected : pas d'erreur.

- [ ] **Step 5 : Commit**

```bash
git add backend/src/routes/admin.ts backend/src/routes/clubs.ts
git commit -m "feat(abonnements): routes admin (plans, vente) + route joueur"
```

---

## Task 8 : Couverture au booking dans `confirmReservation`

**Files:**
- Modify: `backend/src/services/reservation.service.ts`
- Modify: `backend/src/services/__tests__/reservation.service.test.ts`

**Contexte :** `confirmReservation` (`reservation.service.ts:317`) accepte `options.paymentSource?: { packageId: string }` (`:321`) et, dans la transaction (`:438-461`), consomme un package. On élargit `paymentSource` à `{ subscriptionId }` et on ajoute un bloc de couverture symétrique. La requête initiale (`:327-343`) doit aussi charger `offPeakHours`, `timezone`, le `sport.key` du terrain, et `startTime/endTime/totalPrice`.

- [ ] **Step 1 : Écrire les tests qui échouent** (nouveau `describe` dans `reservation.service.test.ts`)

> Le fichier a déjà, en tête, les mocks de module pour `redis`, `db/stripe`, `sse.service` (broadcast no-op) et `email/notifications`. Le nouveau `describe` en hérite — **ne pas les redéclarer**. `classifySlot` renvoie `'PEAK' | 'OFF_PEAK'`.

```ts
describe('confirmReservation — couverture abonnement', () => {
  let service: ReservationService;
  const baseRes = {
    id: 'res-1', userId: 'user-1', status: 'PENDING', createdAt: new Date(), totalPrice: '13.00',
    startTime: new Date('2026-07-01T08:00:00Z'), endTime: new Date('2026-07-01T09:30:00Z'),
    resource: {
      clubId: 'club-1',
      club: { requireOnlinePayment: false, requireCardFingerprint: false, stripeAccountId: null, offPeakHours: null, timezone: 'Europe/Paris' },
      clubSport: { sport: { key: 'padel' } },
    },
  };
  beforeEach(() => {
    service = new ReservationService();
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([{ id: 'res-1', status: 'PENDING', resource_id: 'court-1', start_time: baseRes.startTime, end_time: baseRes.endTime }] as any);
    prismaMock.clubCounter.upsert.mockResolvedValue({ value: 1 } as any);
    prismaMock.reservationParticipant.findFirst.mockResolvedValue({ id: 'part-1' } as any);
    prismaMock.reservation.update.mockResolvedValue({ id: 'res-1', status: 'CONFIRMED' } as any);
    prismaMock.payment.count.mockResolvedValue(0);
  });

  // off=null → tout en heures pleines : on rend le créneau « creux » en passant offPeakHours
  // qui couvre 8h-22h pour ce test d'INCLUDED.
  const offAll = { '3': [{ start: 8, end: 22 }] }; // 2026-07-01 = mercredi (weekday Luxon 3)

  it('créneau creux + abo INCLUDED → Payment SUBSCRIPTION = prix, reste dû 0', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue({ ...baseRes, resource: { ...baseRes.resource, club: { ...baseRes.resource.club, offPeakHours: offAll } } } as any);
    prismaMock.subscription.findUnique.mockResolvedValue({
      id: 'sub-1', userId: 'user-1', clubId: 'club-1', status: 'ACTIVE', expiresAt: new Date(Date.now() + 1e9),
      sportKeys: ['padel'], offPeakOnly: true, benefit: 'INCLUDED', discountPercent: null, dailyCap: null, weeklyCap: null,
    } as any);
    prismaMock.payment.create.mockResolvedValue({ id: 'pay-1' } as any);

    await service.confirmReservation('res-1', 'user-1', { paymentSource: { subscriptionId: 'sub-1' } });

    expect(prismaMock.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ method: 'SUBSCRIPTION', sourceSubscriptionId: 'sub-1', amount: expect.anything() }),
    }));
    const amount = Number((prismaMock.payment.create.mock.calls[0][0].data as any).amount);
    expect(amount).toBe(13);
  });

  it('créneau plein + abo offPeakOnly → SUBSCRIPTION_NOT_APPLICABLE', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue(baseRes as any); // offPeakHours null → plein
    prismaMock.subscription.findUnique.mockResolvedValue({
      id: 'sub-1', userId: 'user-1', clubId: 'club-1', status: 'ACTIVE', expiresAt: new Date(Date.now() + 1e9),
      sportKeys: ['padel'], offPeakOnly: true, benefit: 'INCLUDED', discountPercent: null, dailyCap: null, weeklyCap: null,
    } as any);
    await expect(service.confirmReservation('res-1', 'user-1', { paymentSource: { subscriptionId: 'sub-1' } }))
      .rejects.toThrow('SUBSCRIPTION_NOT_APPLICABLE');
  });

  it('plafond jour atteint → SUBSCRIPTION_CAP_REACHED', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue({ ...baseRes, resource: { ...baseRes.resource, club: { ...baseRes.resource.club, offPeakHours: offAll } } } as any);
    prismaMock.subscription.findUnique.mockResolvedValue({
      id: 'sub-1', userId: 'user-1', clubId: 'club-1', status: 'ACTIVE', expiresAt: new Date(Date.now() + 1e9),
      sportKeys: ['padel'], offPeakOnly: true, benefit: 'INCLUDED', discountPercent: null, dailyCap: 1, weeklyCap: null,
    } as any);
    prismaMock.payment.count.mockResolvedValue(1); // déjà 1 couverte ce jour
    await expect(service.confirmReservation('res-1', 'user-1', { paymentSource: { subscriptionId: 'sub-1' } }))
      .rejects.toThrow('SUBSCRIPTION_CAP_REACHED');
  });
});
```

- [ ] **Step 2 : Lancer → échec**

Run : `cd backend && npx jest reservation.service -t "couverture abonnement"`
Expected : FAIL (couverture absente → pas de SUBSCRIPTION_NOT_APPLICABLE, payment.create non appelé avec method SUBSCRIPTION).

- [ ] **Step 3 : Élargir le type `paymentSource`** (`reservation.service.ts:321`)

```ts
      paymentSource?: { packageId: string } | { subscriptionId: string };
```

- [ ] **Step 4 : Charger les champs nécessaires dans la requête initiale** (`reservation.service.ts:327-343`) — étendre le `select` du `club` et ajouter `clubSport.sport.key` + les champs résa

```ts
    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: {
        resource: {
          select: {
            clubId: true,
            club: {
              select: {
                requireOnlinePayment: true,
                requireCardFingerprint: true,
                stripeAccountId: true,
                offPeakHours: true,
                timezone: true,
              },
            },
            clubSport: { select: { sport: { select: { key: true } } } },
          },
        },
      },
    });
```

- [ ] **Step 5 : Ajouter le bloc de couverture dans la transaction** — juste après le bloc `if (options?.paymentSource)` package (`reservation.service.ts:438-461`), en transformant la condition existante pour ne traiter que `packageId`, et ajouter un `else if` pour `subscriptionId`

Remplacer `if (options?.paymentSource) {` (`:438`) par `if (options?.paymentSource && 'packageId' in options.paymentSource) {`, puis ajouter après la fermeture de ce bloc :

```ts
      // Couverture par un abonnement actif : pas de décrément, on enregistre un
      // paiement « sans argent » (method SUBSCRIPTION) qui éteint (INCLUDED) ou
      // réduit (DISCOUNT) le dû. Snapshot lu sur la Subscription (jamais le plan).
      if (options?.paymentSource && 'subscriptionId' in options.paymentSource) {
        const sub = await tx.subscription.findUnique({ where: { id: options.paymentSource.subscriptionId } });
        if (!sub || sub.userId !== userId || sub.clubId !== reservation.resource.clubId
            || sub.status !== 'ACTIVE' || sub.expiresAt <= new Date()) {
          throw new Error('SUBSCRIPTION_NOT_FOUND');
        }
        const off = (reservation as any).resource.club.offPeakHours as OffPeakHours | null;
        const tz  = (reservation as any).resource.club.timezone as string;
        const sportKey = (reservation as any).resource.clubSport?.sport?.key as string | undefined;
        const isOffPeak = classifySlot(off, reservation.startTime, reservation.endTime, tz) === 'OFF_PEAK';
        const dueCents = Math.round(Number(reservation.totalPrice) * 100);

        const { covered, coverCents } = SubscriptionService.coverageFor(
          { sportKeys: sub.sportKeys, offPeakOnly: sub.offPeakOnly, benefit: sub.benefit, discountPercent: sub.discountPercent },
          { sportKey: sportKey ?? '', isOffPeak, dueCents },
        );
        if (!covered) throw new Error('SUBSCRIPTION_NOT_APPLICABLE');

        // Plafond : compte les résas déjà couvertes par cet abo dans le jour / la semaine (fuseau club).
        const day = DateTime.fromJSDate(reservation.startTime, { zone: tz });
        for (const [cap, start, end] of [
          [sub.dailyCap, day.startOf('day'), day.startOf('day').plus({ days: 1 })] as const,
          [sub.weeklyCap, day.startOf('week'), day.startOf('week').plus({ weeks: 1 })] as const,
        ]) {
          if (cap == null) continue;
          const used = await tx.payment.count({
            where: {
              method: 'SUBSCRIPTION', sourceSubscriptionId: sub.id,
              reservation: { id: { not: reservationId }, startTime: { gte: start.toJSDate(), lt: end.toJSDate() } },
            },
          });
          if (used >= cap) throw new Error('SUBSCRIPTION_CAP_REACHED');
        }

        const organizer = await tx.reservationParticipant.findFirst({
          where: { reservationId, isOrganizer: true }, select: { id: true },
        });
        const receiptNo = await PackageService.nextReceiptNo(tx, reservation.resource.clubId);
        await tx.payment.create({
          data: {
            reservationId,
            participantId: organizer?.id ?? null,
            clubId: reservation.resource.clubId,
            amount: new Prisma.Decimal(coverCents / 100),
            method: 'SUBSCRIPTION',
            sourceSubscriptionId: sub.id,
            receiptNo,
          },
        });
      }
```

- [ ] **Step 6 : Vérifier les imports** en tête de `reservation.service.ts` : `classifySlot` et `OffPeakHours` sont déjà importés (`:8`) ; `Prisma` est importé ; ajouter si absents `import { DateTime } from 'luxon';` et `import { SubscriptionService } from './subscription.service';`.

Run : `cd backend && npx tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected : pas d'erreur.

- [ ] **Step 7 : Lancer → succès**

Run : `cd backend && npx jest reservation.service -t "couverture abonnement"`
Expected : PASS (3 tests).

- [ ] **Step 8 : Commit**

```bash
git add backend/src/services/reservation.service.ts backend/src/services/__tests__/reservation.service.test.ts
git commit -m "feat(abonnements): couverture automatique au booking (confirmReservation)"
```

---

## Task 9 : `SUBSCRIPTION` exclue des remboursables (miroir de `MEMBER`)

**Files:**
- Modify: `backend/src/services/reservation.service.ts`

- [ ] **Step 1 : Trouver le filtre des paiements remboursables** (`reservation.service.ts:565`)

```ts
      where: { reservationId, status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED'] }, method: { not: 'MEMBER' } },
```

- [ ] **Step 2 : Exclure aussi `SUBSCRIPTION`** (pas de flux d'argent → non remboursable)

```ts
      where: { reservationId, status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED'] }, method: { notIn: ['MEMBER', 'SUBSCRIPTION'] } },
```

- [ ] **Step 3 : Vérifier la compilation + suite reservation**

Run : `cd backend && npx tsc --noEmit -p tsconfig.json 2>&1 | head -10 && npx jest reservation.service 2>&1 | tail -8`
Expected : compile OK, suite verte.

- [ ] **Step 4 : Commit**

```bash
git add backend/src/services/reservation.service.ts
git commit -m "fix(abonnements): exclure SUBSCRIPTION des paiements remboursables (comme MEMBER)"
```

---

## Task 10 : Seed des 2 plans exemples sur tous les clubs de test

**Files:**
- Modify: `backend/prisma/seed-offers.ts`
- Modify: `backend/prisma/seed.ts`
- Modify: `backend/prisma/seed-demo.ts`

- [ ] **Step 1 : Ajouter le helper dans `seed-offers.ts`** (après `seedDefaultOffers`)

```ts
/** Plans d'abonnement « heures creuses incluses » créés par défaut sur chaque club de test. */
export const DEFAULT_SUBSCRIPTION_PLANS: Array<{
  name: string; sportKeys: string[]; monthlyPrice: number; commitmentMonths: number;
  offPeakOnly: boolean; benefit: 'INCLUDED' | 'DISCOUNT';
}> = [
  { name: 'Abonnement Padel — heures creuses',  sportKeys: ['padel'],  monthlyPrice: 69, commitmentMonths: 12, offPeakOnly: true, benefit: 'INCLUDED' },
  { name: 'Abonnement Squash — heures creuses', sportKeys: ['squash'], monthlyPrice: 59, commitmentMonths: 12, offPeakOnly: true, benefit: 'INCLUDED' },
];

/** Crée (ou met à jour) les plans d'abonnement par défaut d'un club. Idempotent, sans suppression. */
export async function seedDefaultSubscriptionPlans(prisma: PrismaClient, clubId: string): Promise<number> {
  for (const p of DEFAULT_SUBSCRIPTION_PLANS) {
    const existing = await prisma.subscriptionPlan.findFirst({ where: { clubId, name: p.name } });
    if (existing) {
      await prisma.subscriptionPlan.update({
        where: { id: existing.id },
        data: { sportKeys: p.sportKeys, monthlyPrice: p.monthlyPrice, commitmentMonths: p.commitmentMonths, offPeakOnly: p.offPeakOnly, benefit: p.benefit, isActive: true },
      });
    } else {
      await prisma.subscriptionPlan.create({
        data: { clubId, name: p.name, sportKeys: p.sportKeys, monthlyPrice: p.monthlyPrice, commitmentMonths: p.commitmentMonths, offPeakOnly: p.offPeakOnly, benefit: p.benefit },
      });
    }
  }
  return DEFAULT_SUBSCRIPTION_PLANS.length;
}
```

- [ ] **Step 2 : Appeler le helper dans `seed.ts`** (juste après `await seedDefaultOffers(prisma, club.id);`)

```ts
  await seedDefaultSubscriptionPlans(prisma, club.id);
```

Et compléter l'import en tête : `import { seedDefaultOffers, seedDefaultSubscriptionPlans } from './seed-offers';`

- [ ] **Step 3 : Appeler le helper dans `seed-demo.ts`** (juste après `await seedDefaultOffers(prisma, club.id);` dans la boucle club)

```ts
    await seedDefaultSubscriptionPlans(prisma, club.id);
```

Et compléter l'import : `import { seedDefaultOffers, seedDefaultSubscriptionPlans } from './seed-offers';`

- [ ] **Step 4 : Lancer le seed de base + vérifier**

Run : `cd backend && npm run db:seed`
Expected : « Seed terminé. » sans erreur.

Vérif rapide (script temporaire à supprimer après) :
Run : `cd backend && npx ts-node -e "import 'dotenv/config'; import {PrismaClient} from '@prisma/client'; import {PrismaPg} from '@prisma/adapter-pg'; const p=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL!})}); p.subscriptionPlan.findMany({where:{club:{slug:'padel-arena-paris'}}}).then(r=>{console.log(r.length, r.map(x=>x.name)); return p.\$disconnect();});"`
Expected : `2 [ 'Abonnement Padel — heures creuses', 'Abonnement Squash — heures creuses' ]`

- [ ] **Step 5 : Commit**

```bash
git add backend/prisma/seed-offers.ts backend/prisma/seed.ts backend/prisma/seed-demo.ts
git commit -m "feat(abonnements): seed 2 plans par défaut (Padel 69, Squash 59) sur tous les clubs de test"
```

---

## Task 11 : Vérification finale backend

**Files:** —

- [ ] **Step 1 : Suite backend complète**

Run : `cd backend && npx jest 2>&1 | tail -15`
Expected : tous les tests verts (incl. `subscription.service`, bloc couverture de `reservation.service`).

- [ ] **Step 2 : Typecheck global**

Run : `cd backend && npx tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected : aucune erreur.

- [ ] **Step 3 : Commit (si ajustements)** — sinon rien.

---

## Notes pour le frontend (Plan 2, séparé)

Le backend expose : `GET/POST /api/clubs/:clubId/admin/subscription-plans`, `PATCH …/:id`, `GET/POST …/members/:userId/subscriptions`, `GET /api/clubs/:slug/me/subscriptions`. La confirmation de résa accepte `paymentSource: { subscriptionId }`. Le Plan 2 couvrira : types/méthodes `lib/api.ts`, helper pur `lib/subscriptions.ts`, section « Abonnements » dans `/admin/packages`, vente dans `/admin/caisse`, chip Réserver + bloc BookingModal + `ProfileMenu`, et l'exclusion de `SUBSCRIPTION` des totaux « argent » dans `frontend/lib/caisse.ts`.
