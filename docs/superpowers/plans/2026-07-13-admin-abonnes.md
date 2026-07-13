# Admin « Abonnés » — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner à l'admin/staff une page « Abonnés » (registre + stats par forfait) et le cycle de vie complet d'un abonnement (renouveler / changer de forfait / résilier), plus un onglet « Abonnement » sur la fiche membre.

**Architecture :** Aucune migration — on exploite `Subscription`/`SubscriptionPlan` existants. Backend : `SubscriptionService` gagne `overview`, `renewSubscription`, `changeSubscription` (transactions Serializable, DRY via un helper privé `createPeriodTx`) et la méthode orpheline `cancelSubscription` est enfin routée ; 4 routes ajoutées au routeur admin (déjà gaté STAFF au niveau du `router.use`). Frontend : page `/admin/abonnes`, dialogs partagés `SubscriptionActions`, onglet fiche membre, helpers purs testés.

**Tech Stack :** Express 5 + Prisma 7 (backend, jest+prismaMock), Next.js 16 + React 19 (frontend, jest+RTL), Luxon absent ici (arithmétique Date/mois native comme `sellSubscription`).

**Sémantiques validées (spec) :**
- **Renouveler** = prolonge LA MÊME `Subscription` : `expiresAt = max(now, expiresAt) + commitmentMonths`, + un `Payment` « mensualité » au **tarif snapshot du membre** (`monthlyPriceSnapshot`). Refusé si `status !== ACTIVE` → `SUBSCRIPTION_NOT_RENEWABLE`.
- **Changer** = 1 transaction : résilie l'actuel (CANCELLED) + vend le nouveau (nouvelle ligne, snapshot du nouveau plan, démarre aujourd'hui, plein tarif). Pas de prorata.
- **Résilier** = immédiat (CANCELLED), pas de remboursement auto.

---

## File Structure

**Backend**
- Modify `backend/src/services/subscription.service.ts` — refactor `sellSubscription` + add `createPeriodTx`, `buildSaleMethod`, `overview`, `renewSubscription`, `changeSubscription`.
- Modify `backend/src/routes/admin.ts` — add 4 routes + 1 error code.
- Modify `backend/src/services/__tests__/subscription.service.test.ts` — new cases.
- Create `backend/src/routes/__tests__/admin.subscriptions.routes.test.ts`.

**Frontend**
- Modify `frontend/lib/api.ts` — types + 4 methods.
- Create `frontend/lib/subscriptionAdmin.ts` + `frontend/__tests__/subscriptionAdmin.test.ts` — pure helpers.
- Create `frontend/components/admin/subscriptions/SubscriptionActions.tsx` + `frontend/__tests__/SubscriptionActions.test.tsx` — Renouveler/Changer/Résilier dialogs (shared).
- Create `frontend/app/admin/abonnes/page.tsx` + `frontend/__tests__/AdminSubscribers.test.tsx`.
- Modify `frontend/app/admin/layout.tsx` — nav entry (+ `AdminLayout.test.tsx` assertion).
- Modify `frontend/app/admin/members/[userId]/page.tsx` — « Abonnement » tab (+ `frontend/__tests__/MemberHistory.test.tsx` or dedicated).

---

## Task 1: Backend — `overview` + refactor sale (DRY helpers)

**Files:**
- Modify: `backend/src/services/subscription.service.ts` (class body; `sellSubscription` at ~114, add methods)
- Test: `backend/src/services/__tests__/subscription.service.test.ts`

- [ ] **Step 1: Write failing tests for `overview`**

Add to `subscription.service.test.ts` (new `describe`):

```ts
describe('overview', () => {
  const svc = new SubscriptionService();
  const now = Date.now();
  const activeSub = (over = {}) => ({
    id: 's1', userId: 'u1', clubId: 'club-1', planId: 'p1', status: 'ACTIVE',
    startedAt: new Date(now - 5 * 86400000), expiresAt: new Date(now + 20 * 86400000),
    monthlyPriceSnapshot: '39.00', sportKeys: ['padel'],
    user: { id: 'u1', firstName: 'Jean', lastName: 'Dupont', avatarUrl: null },
    plan: { name: 'Padel illimité' }, ...over,
  });

  it('KPIs : abonnés actifs distincts, revenu mensuel, expirations < 30 j', async () => {
    prismaMock.subscription.findMany.mockResolvedValue([
      activeSub(),
      activeSub({ id: 's2', userId: 'u1', expiresAt: new Date(now + 10 * 86400000) }), // même user
      activeSub({ id: 's3', userId: 'u2', monthlyPriceSnapshot: '29.00' }),
      activeSub({ id: 's4', userId: 'u3', status: 'CANCELLED' }),                       // exclu
      activeSub({ id: 's5', userId: 'u4', expiresAt: new Date(now - 86400000) }),       // ACTIVE mais expiré → exclu
    ] as any);
    prismaMock.subscriptionPlan.findMany.mockResolvedValue([
      { id: 'p1', name: 'Padel illimité', monthlyPrice: '39.00', benefit: 'INCLUDED', discountPercent: null, sportKeys: ['padel'], isActive: true, createdAt: new Date() },
    ] as any);

    const out = await svc.overview('club-1');
    expect(out.kpis.activeCount).toBe(2);                 // u1 (2 subs) + u2
    expect(out.kpis.monthlyRevenueCents).toBe(39_00 + 39_00 + 29_00);
    expect(out.kpis.expiringSoonCount).toBe(2);           // s1 (20j) + s2 (10j)
    expect(out.plans[0].activeCount).toBe(3);             // s1+s2+s3 sur p1
    expect(out.subscribers).toHaveLength(5);
    expect(out.subscribers[0].planName).toBe('Padel illimité');
  });
});
```

- [ ] **Step 2: Run it — expect fail** — `node node_modules/jest/bin/jest.js src/services/__tests__/subscription.service.test.ts -t "overview"` → FAIL (`overview is not a function`).

- [ ] **Step 3: Add `overview` + DRY helpers**

In `subscription.service.ts`, add inside the class. First the shared helpers, then `overview`:

```ts
  /** Valide/normalise le moyen d'une VENTE d'abonnement (whitelist SALE_METHODS ; VOUCHER ⇒ réf.). */
  private buildSaleMethod(body: { method?: string; voucherRef?: string }): PaymentMethod {
    const method = (SALE_METHODS.includes(body.method as typeof SALE_METHODS[number]) ? body.method : 'CASH') as PaymentMethod;
    if (method === 'VOUCHER' && !body.voucherRef?.trim()) throw new Error('VALIDATION_ERROR');
    return method;
  }

  /** Crée une période d'abonnement (snapshot du plan) + son paiement, dans une transaction fournie. */
  private async createPeriodTx(
    tx: Prisma.TransactionClient,
    args: { clubId: string; userId: string; plan: { id: string; name: string; monthlyPrice: Prisma.Decimal; sportKeys: string[]; offPeakOnly: boolean; benefit: SubscriptionBenefit; discountPercent: number | null; dailyCap: number | null; weeklyCap: number | null };
      method: PaymentMethod; body: { payerName?: string; voucherRef?: string; voucherIssuer?: string; createdByUserId?: string }; expiresAt: Date; note: string },
  ) {
    const { clubId, userId, plan, method, body, expiresAt, note } = args;
    const membership = await tx.clubMembership.findUnique({ where: { userId_clubId: { userId, clubId } } });
    if (!membership) throw new Error('MEMBER_NOT_FOUND');
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
        clubId, amount: plan.monthlyPrice, method, subscriptionId: sub.id,
        payerName: body.payerName?.trim() || null, note,
        voucherRef:    method === 'VOUCHER' ? body.voucherRef!.trim() : null,
        voucherIssuer: method === 'VOUCHER' ? body.voucherIssuer?.trim() || null : null,
        voucherStatus: method === 'VOUCHER' ? 'PENDING_REIMBURSEMENT' : null,
        createdByUserId: body.createdByUserId ?? null, receiptNo,
      },
    });
    return { subscription: sub, payment };
  }

  /** Pilotage : KPIs, forfaits (avec compteur d'abonnés actifs), registre complet des abonnements. */
  async overview(clubId: string) {
    const [subs, plans] = await Promise.all([
      prisma.subscription.findMany({
        where: { clubId },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
          plan: { select: { name: true } },
        },
        orderBy: { expiresAt: 'asc' },
      }),
      prisma.subscriptionPlan.findMany({ where: { clubId }, orderBy: { createdAt: 'asc' } }),
    ]);
    const now = Date.now();
    const isActive = (s: { status: string; expiresAt: Date }) => s.status === 'ACTIVE' && s.expiresAt.getTime() > now;
    const active = subs.filter(isActive);
    const countByPlan = new Map<string, number>();
    for (const s of active) countByPlan.set(s.planId, (countByPlan.get(s.planId) ?? 0) + 1);
    return {
      kpis: {
        activeCount: new Set(active.map((s) => s.userId)).size,
        monthlyRevenueCents: active.reduce((sum, s) => sum + Math.round(Number(s.monthlyPriceSnapshot) * 100), 0),
        expiringSoonCount: active.filter((s) => s.expiresAt.getTime() <= now + 30 * 86_400_000).length,
      },
      plans: plans.map((p) => ({
        id: p.id, name: p.name, monthlyPrice: p.monthlyPrice.toString(), benefit: p.benefit,
        discountPercent: p.discountPercent, sportKeys: p.sportKeys, isActive: p.isActive,
        activeCount: countByPlan.get(p.id) ?? 0,
      })),
      subscribers: subs.map((s) => ({
        id: s.id, user: s.user, planId: s.planId, planName: s.plan.name, status: s.status,
        startedAt: s.startedAt.toISOString(), expiresAt: s.expiresAt.toISOString(),
        monthlyPriceSnapshot: s.monthlyPriceSnapshot.toString(), sportKeys: s.sportKeys,
      })),
    };
  }
```

Add `SubscriptionBenefit` to the existing import from `@prisma/client` if not already there (it is, line 3).

- [ ] **Step 4: Refactor `sellSubscription` onto `createPeriodTx` (DRY)**

Replace the body of `sellSubscription` (keeps identical behavior; membership check now inside the tx):

```ts
  async sellSubscription(clubId: string, userId: string, body: {
    planId?: string; method?: string; payerName?: string;
    voucherRef?: string; voucherIssuer?: string; createdByUserId?: string;
  }) {
    const plan = await prisma.subscriptionPlan.findUnique({ where: { id: body.planId ?? '' } });
    if (!plan || plan.clubId !== clubId || !plan.isActive) throw new Error('PLAN_NOT_FOUND');
    const method = this.buildSaleMethod(body);
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + plan.commitmentMonths);
    return prisma.$transaction((tx) =>
      this.createPeriodTx(tx, { clubId, userId, plan, method, body, expiresAt, note: `Vente abonnement ${plan.name} — 1re mensualité` }),
    );
  }
```

- [ ] **Step 5: Run `overview` + existing sell tests — expect pass**

Run: `node node_modules/jest/bin/jest.js src/services/__tests__/subscription.service.test.ts`
Expected: all PASS (the existing `sellSubscription` cases must stay green — they mock `subscriptionPlan.findUnique` + `clubMembership.findUnique` + `payment.create`, all still called).

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/subscription.service.ts backend/src/services/__tests__/subscription.service.test.ts
git commit -m "feat(abonnes): SubscriptionService.overview + DRY createPeriodTx"
```

---

## Task 2: Backend — `renewSubscription`

**Files:**
- Modify: `backend/src/services/subscription.service.ts`
- Test: `backend/src/services/__tests__/subscription.service.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
describe('renewSubscription', () => {
  const svc = new SubscriptionService();
  beforeEach(() => {
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
    prismaMock.clubCounter.upsert.mockResolvedValue({ value: 7 } as any);
    prismaMock.payment.create.mockResolvedValue({ id: 'pay-r' } as any);
  });

  it('prolonge depuis expiresAt futur + paiement au tarif snapshot', async () => {
    const future = new Date(Date.now() + 10 * 86400000);
    prismaMock.subscription.findUnique.mockResolvedValue({
      id: 's1', clubId: 'club-1', userId: 'u1', status: 'ACTIVE', expiresAt: future,
      monthlyPriceSnapshot: '39.00', plan: { name: 'Padel illimité', commitmentMonths: 1 },
    } as any);
    prismaMock.subscription.update.mockResolvedValue({ id: 's1' } as any);

    const out = await svc.renewSubscription('s1', 'club-1', { method: 'CARD', createdByUserId: 'staff-1' });

    const newExpiry = (prismaMock.subscription.update.mock.calls[0][0].data as any).expiresAt as Date;
    const expected = new Date(future); expected.setMonth(expected.getMonth() + 1);
    expect(newExpiry.getTime()).toBe(expected.getTime());
    expect(prismaMock.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ method: 'CARD', subscriptionId: 's1', amount: '39.00' }),
    }));
    expect(out.subscription.id).toBe('s1');
  });

  it('abo expiré (ACTIVE) : prolonge depuis MAINTENANT (pas de trou)', async () => {
    const past = new Date(Date.now() - 5 * 86400000);
    prismaMock.subscription.findUnique.mockResolvedValue({
      id: 's1', clubId: 'club-1', userId: 'u1', status: 'ACTIVE', expiresAt: past,
      monthlyPriceSnapshot: '39.00', plan: { name: 'X', commitmentMonths: 1 },
    } as any);
    prismaMock.subscription.update.mockResolvedValue({ id: 's1' } as any);

    await svc.renewSubscription('s1', 'club-1', { method: 'CASH' });
    const newExpiry = (prismaMock.subscription.update.mock.calls[0][0].data as any).expiresAt as Date;
    expect(newExpiry.getTime()).toBeGreaterThan(Date.now());
  });

  it('CANCELLED → SUBSCRIPTION_NOT_RENEWABLE', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue({ id: 's1', clubId: 'club-1', status: 'CANCELLED', plan: { name: 'X', commitmentMonths: 1 } } as any);
    await expect(svc.renewSubscription('s1', 'club-1', {})).rejects.toThrow('SUBSCRIPTION_NOT_RENEWABLE');
  });

  it('autre club → SUBSCRIPTION_NOT_FOUND', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue({ id: 's1', clubId: 'autre', status: 'ACTIVE', plan: { name: 'X', commitmentMonths: 1 } } as any);
    await expect(svc.renewSubscription('s1', 'club-1', {})).rejects.toThrow('SUBSCRIPTION_NOT_FOUND');
  });

  it('VOUCHER sans référence → VALIDATION_ERROR', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue({ id: 's1', clubId: 'club-1', status: 'ACTIVE', expiresAt: new Date(), monthlyPriceSnapshot: '39.00', plan: { name: 'X', commitmentMonths: 1 } } as any);
    await expect(svc.renewSubscription('s1', 'club-1', { method: 'VOUCHER' })).rejects.toThrow('VALIDATION_ERROR');
  });
});
```

- [ ] **Step 2: Run — expect fail** — `... -t "renewSubscription"` → FAIL.

- [ ] **Step 3: Implement**

```ts
  async renewSubscription(id: string, clubId: string, body: {
    method?: string; payerName?: string; voucherRef?: string; voucherIssuer?: string; createdByUserId?: string;
  }) {
    const sub = await prisma.subscription.findUnique({ where: { id }, include: { plan: { select: { name: true, commitmentMonths: true } } } });
    if (!sub || sub.clubId !== clubId) throw new Error('SUBSCRIPTION_NOT_FOUND');
    if (sub.status !== 'ACTIVE')       throw new Error('SUBSCRIPTION_NOT_RENEWABLE');
    const method = this.buildSaleMethod(body);
    const base = new Date(Math.max(Date.now(), sub.expiresAt.getTime()));
    base.setMonth(base.getMonth() + sub.plan.commitmentMonths);
    const newExpiry = base;
    return prisma.$transaction(async (tx) => {
      const updated = await tx.subscription.update({ where: { id }, data: { expiresAt: newExpiry } });
      const receiptNo = await PackageService.nextReceiptNo(tx, clubId);
      const payment = await tx.payment.create({
        data: {
          clubId, amount: sub.monthlyPriceSnapshot, method, subscriptionId: sub.id,
          payerName: body.payerName?.trim() || null,
          note: `Renouvellement abonnement ${sub.plan.name} — mensualité`,
          voucherRef:    method === 'VOUCHER' ? body.voucherRef!.trim() : null,
          voucherIssuer: method === 'VOUCHER' ? body.voucherIssuer?.trim() || null : null,
          voucherStatus: method === 'VOUCHER' ? 'PENDING_REIMBURSEMENT' : null,
          createdByUserId: body.createdByUserId ?? null, receiptNo,
        },
      });
      return { subscription: updated, payment };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
```

- [ ] **Step 4: Run — expect pass** — `... -t "renewSubscription"` → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/subscription.service.ts backend/src/services/__tests__/subscription.service.test.ts
git commit -m "feat(abonnes): renewSubscription (prolonge la même période au tarif snapshot)"
```

---

## Task 3: Backend — `changeSubscription`

**Files:**
- Modify: `backend/src/services/subscription.service.ts`
- Test: `backend/src/services/__tests__/subscription.service.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
describe('changeSubscription', () => {
  const svc = new SubscriptionService();
  beforeEach(() => {
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
    prismaMock.clubCounter.upsert.mockResolvedValue({ value: 8 } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ id: 'm1' } as any);
    prismaMock.subscription.update.mockResolvedValue({ id: 's1', status: 'CANCELLED' } as any);
    prismaMock.subscription.create.mockResolvedValue({ id: 's-new', status: 'ACTIVE' } as any);
    prismaMock.payment.create.mockResolvedValue({ id: 'pay-c' } as any);
  });

  it('résilie l\'actuel et vend le nouveau (snapshot du nouveau plan)', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue({ id: 's1', clubId: 'club-1', userId: 'u1' } as any);
    prismaMock.subscriptionPlan.findUnique.mockResolvedValue({
      id: 'p2', clubId: 'club-1', isActive: true, name: 'Padel illimité', monthlyPrice: '39.00',
      commitmentMonths: 1, sportKeys: ['padel'], offPeakOnly: false, benefit: 'INCLUDED', discountPercent: null, dailyCap: null, weeklyCap: null,
    } as any);

    const out = await svc.changeSubscription('s1', 'club-1', { planId: 'p2', method: 'CARD', createdByUserId: 'staff-1' });

    expect(prismaMock.subscription.update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { status: 'CANCELLED' } });
    expect(prismaMock.subscription.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ planId: 'p2', userId: 'u1', monthlyPriceSnapshot: '39.00', status: 'ACTIVE' }),
    }));
    expect(out.subscription.id).toBe('s-new');
  });

  it('plan inactif/autre club → PLAN_NOT_FOUND', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue({ id: 's1', clubId: 'club-1', userId: 'u1' } as any);
    prismaMock.subscriptionPlan.findUnique.mockResolvedValue({ id: 'p2', clubId: 'club-1', isActive: false } as any);
    await expect(svc.changeSubscription('s1', 'club-1', { planId: 'p2' })).rejects.toThrow('PLAN_NOT_FOUND');
  });

  it('abo introuvable / autre club → SUBSCRIPTION_NOT_FOUND', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue({ id: 's1', clubId: 'autre', userId: 'u1' } as any);
    await expect(svc.changeSubscription('s1', 'club-1', { planId: 'p2' })).rejects.toThrow('SUBSCRIPTION_NOT_FOUND');
  });
});
```

- [ ] **Step 2: Run — expect fail** — `... -t "changeSubscription"` → FAIL.

- [ ] **Step 3: Implement**

```ts
  async changeSubscription(id: string, clubId: string, body: {
    planId?: string; method?: string; payerName?: string; voucherRef?: string; voucherIssuer?: string; createdByUserId?: string;
  }) {
    const current = await prisma.subscription.findUnique({ where: { id }, select: { id: true, clubId: true, userId: true } });
    if (!current || current.clubId !== clubId) throw new Error('SUBSCRIPTION_NOT_FOUND');
    const plan = await prisma.subscriptionPlan.findUnique({ where: { id: body.planId ?? '' } });
    if (!plan || plan.clubId !== clubId || !plan.isActive) throw new Error('PLAN_NOT_FOUND');
    const method = this.buildSaleMethod(body);
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + plan.commitmentMonths);
    return prisma.$transaction(async (tx) => {
      await tx.subscription.update({ where: { id }, data: { status: 'CANCELLED' } });
      return this.createPeriodTx(tx, { clubId, userId: current.userId, plan, method, body, expiresAt, note: `Changement d'abonnement → ${plan.name} — 1re mensualité` });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
```

- [ ] **Step 4: Run — expect pass** — `... -t "changeSubscription"` → PASS. Then run the whole file: `node node_modules/jest/bin/jest.js src/services/__tests__/subscription.service.test.ts` → all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/subscription.service.ts backend/src/services/__tests__/subscription.service.test.ts
git commit -m "feat(abonnes): changeSubscription (résilie + revend, sans prorata)"
```

---

## Task 4: Backend — routes + error code

**Files:**
- Modify: `backend/src/routes/admin.ts` (add code at ~line 118; add routes after the existing `POST /members/:userId/subscriptions` at ~line 922)
- Create: `backend/src/routes/__tests__/admin.subscriptions.routes.test.ts`

- [ ] **Step 1: Add the missing error code**

In `admin.ts` `ERROR_STATUS` map (after `SUBSCRIPTION_NOT_FOUND: 404,`):

```ts
  SUBSCRIPTION_NOT_RENEWABLE: 409,
```

- [ ] **Step 2: Add the 4 routes**

After the existing `router.post('/members/:userId/subscriptions', ...)`:

```ts
// --- Cycle de vie d'un abonnement (pilotage /admin/abonnes) ---
router.get('/subscriptions/overview', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await subscriptionService.overview(req.membership!.clubId)); } catch (e) { handleError(e, res, next); }
});
router.post('/subscriptions/:id/renew', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await subscriptionService.renewSubscription(asString(req.params.id), req.membership!.clubId, { ...req.body, createdByUserId: req.user!.id })); } catch (e) { handleError(e, res, next); }
});
router.post('/subscriptions/:id/change', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await subscriptionService.changeSubscription(asString(req.params.id), req.membership!.clubId, { ...req.body, createdByUserId: req.user!.id })); } catch (e) { handleError(e, res, next); }
});
router.post('/subscriptions/:id/cancel', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try { res.json(await subscriptionService.cancelSubscription(asString(req.params.id), req.membership!.clubId)); } catch (e) { handleError(e, res, next); }
});
```

- [ ] **Step 3: Write route tests** (mirror `reservations.routes.test.ts` idiom — supertest + prismaMock, real service). Create `admin.subscriptions.routes.test.ts`:

```ts
import '../../__mocks__/prisma';
import '../../__mocks__/redis';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';

const SECRET = process.env.JWT_SECRET!;
const token = jwt.sign({ id: 'staff-1', email: 's@x.fr' }, SECRET, { expiresIn: '1h' });
const base = '/api/clubs/club-demo/admin';

// requireClubMember('STAFF') : l'utilisateur doit être membre staff du club.
beforeEach(() => {
  prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', slug: 'club-demo', status: 'ACTIVE' } as any);
  prismaMock.clubMember.findFirst.mockResolvedValue({ clubId: 'club-demo', userId: 'staff-1', role: 'OWNER' } as any);
  prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
  prismaMock.clubCounter.upsert.mockResolvedValue({ value: 1 } as any);
});

it('GET /subscriptions/overview → 200 (kpis/plans/subscribers)', async () => {
  prismaMock.subscription.findMany.mockResolvedValue([] as any);
  prismaMock.subscriptionPlan.findMany.mockResolvedValue([] as any);
  const res = await request(app).get(`${base}/subscriptions/overview`).set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('kpis');
  expect(res.body).toHaveProperty('subscribers');
});

it('POST /subscriptions/:id/renew → 200', async () => {
  prismaMock.subscription.findUnique.mockResolvedValue({ id: 's1', clubId: 'club-demo', status: 'ACTIVE', expiresAt: new Date(), monthlyPriceSnapshot: '39.00', plan: { name: 'X', commitmentMonths: 1 } } as any);
  prismaMock.subscription.update.mockResolvedValue({ id: 's1' } as any);
  prismaMock.payment.create.mockResolvedValue({ id: 'p' } as any);
  const res = await request(app).post(`${base}/subscriptions/s1/renew`).set('Authorization', `Bearer ${token}`).send({ method: 'CARD' });
  expect(res.status).toBe(200);
});

it('POST /subscriptions/:id/renew sur CANCELLED → 409', async () => {
  prismaMock.subscription.findUnique.mockResolvedValue({ id: 's1', clubId: 'club-demo', status: 'CANCELLED', plan: { name: 'X', commitmentMonths: 1 } } as any);
  const res = await request(app).post(`${base}/subscriptions/s1/renew`).set('Authorization', `Bearer ${token}`).send({});
  expect(res.status).toBe(409);
  expect(res.body.error).toBe('SUBSCRIPTION_NOT_RENEWABLE');
});

it('POST /subscriptions/:id/cancel → 200 CANCELLED', async () => {
  prismaMock.subscription.findUnique.mockResolvedValue({ id: 's1', clubId: 'club-demo' } as any);
  prismaMock.subscription.update.mockResolvedValue({ id: 's1', status: 'CANCELLED' } as any);
  const res = await request(app).post(`${base}/subscriptions/s1/cancel`).set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('CANCELLED');
});
```

> Note: verify how `requireClubMember` resolves the staff membership (`prisma.clubMember.findFirst` vs `findUnique`) by reading `backend/src/middleware/requireClubMember.ts`, and align the mock accordingly.

- [ ] **Step 4: Run — expect pass** — `node node_modules/jest/bin/jest.js src/routes/__tests__/admin.subscriptions.routes.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/admin.ts backend/src/routes/__tests__/admin.subscriptions.routes.test.ts
git commit -m "feat(abonnes): routes admin subscriptions overview/renew/change/cancel"
```

---

## Task 5: Frontend — API types + methods

**Files:**
- Modify: `frontend/lib/api.ts` (types near `SellSubscriptionBody` ~1824; methods near `adminSellSubscription` ~480)

- [ ] **Step 1: Add types** (after `SellSubscriptionBody`):

```ts
export interface SubscriberRow {
  id: string;
  user: { id: string; firstName: string; lastName: string; avatarUrl: string | null };
  planId: string;
  planName: string;
  status: SubscriptionStatus;
  startedAt: string;
  expiresAt: string;
  monthlyPriceSnapshot: string;
  sportKeys: string[];
}
export interface SubscriptionPlanSummary {
  id: string; name: string; monthlyPrice: string; benefit: SubscriptionBenefit;
  discountPercent: number | null; sportKeys: string[]; isActive: boolean; activeCount: number;
}
export interface SubscriptionOverview {
  kpis: { activeCount: number; monthlyRevenueCents: number; expiringSoonCount: number };
  plans: SubscriptionPlanSummary[];
  subscribers: SubscriberRow[];
}
export interface RenewSubscriptionBody { method?: PaymentMethod; payerName?: string; voucherRef?: string; voucherIssuer?: string; }
export interface ChangeSubscriptionBody extends RenewSubscriptionBody { planId: string; }
```

- [ ] **Step 2: Add methods** (after `adminSellSubscription`):

```ts
  adminGetSubscriptionOverview: (clubId: string, token: string) =>
    request<SubscriptionOverview>(`/api/clubs/${clubId}/admin/subscriptions/overview`, {}, token),
  adminRenewSubscription: (clubId: string, id: string, body: RenewSubscriptionBody, token: string) =>
    request<{ subscription: Subscription; payment: Payment }>(`/api/clubs/${clubId}/admin/subscriptions/${id}/renew`, { method: 'POST', body: JSON.stringify(body) }, token),
  adminChangeSubscription: (clubId: string, id: string, body: ChangeSubscriptionBody, token: string) =>
    request<{ subscription: Subscription; payment: Payment }>(`/api/clubs/${clubId}/admin/subscriptions/${id}/change`, { method: 'POST', body: JSON.stringify(body) }, token),
  adminCancelSubscription: (clubId: string, id: string, token: string) =>
    request<{ id: string; status: SubscriptionStatus }>(`/api/clubs/${clubId}/admin/subscriptions/${id}/cancel`, { method: 'POST' }, token),
```

- [ ] **Step 3: Type-check** — `cd frontend && node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` → no new errors on `lib/api.ts`.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(abonnes): types + méthodes API admin subscriptions"
```

---

## Task 6: Frontend — pure helpers `lib/subscriptionAdmin.ts`

**Files:**
- Create: `frontend/lib/subscriptionAdmin.ts`
- Test: `frontend/__tests__/subscriptionAdmin.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { isActiveSub, daysUntil, expiresSoon, filterRegistry, RegistryMode } from '../lib/subscriptionAdmin';
import type { SubscriberRow } from '../lib/api';

const NOW = Date.UTC(2026, 6, 13); // 2026-07-13
const row = (o: Partial<SubscriberRow>): SubscriberRow => ({
  id: 'x', user: { id: 'u', firstName: 'Jean', lastName: 'Dupont', avatarUrl: null },
  planId: 'p1', planName: 'Padel illimité', status: 'ACTIVE',
  startedAt: '2026-06-01T00:00:00Z', expiresAt: '2026-08-12T00:00:00Z',
  monthlyPriceSnapshot: '39.00', sportKeys: ['padel'], ...o,
});

describe('subscriptionAdmin', () => {
  it('isActiveSub : ACTIVE + non expiré', () => {
    expect(isActiveSub(row({}), NOW)).toBe(true);
    expect(isActiveSub(row({ status: 'CANCELLED' }), NOW)).toBe(false);
    expect(isActiveSub(row({ expiresAt: '2026-07-01T00:00:00Z' }), NOW)).toBe(false);
  });
  it('daysUntil : arrondi au jour supérieur', () => {
    expect(daysUntil('2026-07-28T00:00:00Z', NOW)).toBe(15);
  });
  it('expiresSoon : actif ET < 30 j', () => {
    expect(expiresSoon(row({ expiresAt: '2026-07-28T00:00:00Z' }), NOW)).toBe(true);
    expect(expiresSoon(row({ expiresAt: '2026-09-01T00:00:00Z' }), NOW)).toBe(false);
  });
  it('filterRegistry : mode + plan + recherche + tri', () => {
    const subs = [
      row({ id: 'a', user: { id: 'u1', firstName: 'Jean', lastName: 'Dupont', avatarUrl: null }, expiresAt: '2026-08-20T00:00:00Z' }),
      row({ id: 'b', user: { id: 'u2', firstName: 'Marie', lastName: 'Leroy', avatarUrl: null }, expiresAt: '2026-07-28T00:00:00Z' }),
      row({ id: 'c', status: 'CANCELLED', planId: 'p2' }),
    ];
    const active = filterRegistry(subs, { query: '', mode: 'active' as RegistryMode, planId: null }, NOW);
    expect(active.map((s) => s.id)).toEqual(['b', 'a']);            // tri échéance asc
    expect(filterRegistry(subs, { query: 'ler', mode: 'active', planId: null }, NOW).map((s) => s.id)).toEqual(['b']);
    expect(filterRegistry(subs, { query: '', mode: 'history', planId: null }, NOW).map((s) => s.id)).toEqual(['c']);
    expect(filterRegistry(subs, { query: '', mode: 'active', planId: 'p1' }, NOW).map((s) => s.id)).toEqual(['b', 'a']);
    expect(filterRegistry(subs, { query: '', mode: 'soon', planId: null }, NOW).map((s) => s.id)).toEqual(['b']);
  });
});
```

- [ ] **Step 2: Run — expect fail** — `cd frontend && node node_modules/jest/bin/jest.js __tests__/subscriptionAdmin.test.ts` → FAIL.

- [ ] **Step 3: Implement**

```ts
import type { SubscriberRow } from './api';

export type RegistryMode = 'active' | 'soon' | 'history';
const DAY = 86_400_000;

export function isActiveSub(s: SubscriberRow, nowMs: number): boolean {
  return s.status === 'ACTIVE' && new Date(s.expiresAt).getTime() > nowMs;
}
export function daysUntil(iso: string, nowMs: number): number {
  return Math.ceil((new Date(iso).getTime() - nowMs) / DAY);
}
export function expiresSoon(s: SubscriberRow, nowMs: number): boolean {
  return isActiveSub(s, nowMs) && daysUntil(s.expiresAt, nowMs) <= 30;
}
export function filterRegistry(
  subs: SubscriberRow[],
  f: { query: string; mode: RegistryMode; planId: string | null },
  nowMs: number,
): SubscriberRow[] {
  const q = f.query.trim().toLowerCase();
  const rows = subs.filter((s) => {
    if (f.planId && s.planId !== f.planId) return false;
    if (q && !`${s.user.firstName} ${s.user.lastName}`.toLowerCase().includes(q)) return false;
    if (f.mode === 'active')  return isActiveSub(s, nowMs);
    if (f.mode === 'soon')    return expiresSoon(s, nowMs);
    return !isActiveSub(s, nowMs); // history
  });
  const asc = f.mode !== 'history';
  return rows.sort((a, b) =>
    asc ? a.expiresAt.localeCompare(b.expiresAt) : b.expiresAt.localeCompare(a.expiresAt));
}
```

- [ ] **Step 4: Run — expect pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/subscriptionAdmin.ts frontend/__tests__/subscriptionAdmin.test.ts
git commit -m "feat(abonnes): helpers purs registre abonnés"
```

---

## Task 7: Frontend — dialogs `SubscriptionActions.tsx`

**Files:**
- Create: `frontend/components/admin/subscriptions/SubscriptionActions.tsx`
- Test: `frontend/__tests__/SubscriptionActions.test.tsx`

Component: a single controlled dialog host driven by an `action` prop (`'renew' | 'change' | 'cancel' | null`). Renew/Change show sale-method buttons (`SALE_METHODS` = Espèces/CB/Virement/Ticket CE/Autre); VOUCHER reveals a reference input. On confirm it calls the API and reports success via `onDone`.

- [ ] **Step 1: Write failing test**

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '../lib/ThemeProvider';
import { SubscriptionActions } from '../components/admin/subscriptions/SubscriptionActions';
import { api } from '../lib/api';

jest.mock('../lib/api', () => ({
  api: {
    adminRenewSubscription: jest.fn().mockResolvedValue({ subscription: { id: 's1' } }),
    adminChangeSubscription: jest.fn().mockResolvedValue({ subscription: { id: 's-new' } }),
    adminCancelSubscription: jest.fn().mockResolvedValue({ id: 's1', status: 'CANCELLED' }),
  },
}));

const sub = { id: 's1', planId: 'p1', planName: 'Padel illimité', expiresAt: '2026-08-12T00:00:00Z', monthlyPriceSnapshot: '39.00' } as any;
const plans = [
  { id: 'p1', name: 'Padel illimité', monthlyPrice: '39.00', isActive: true } as any,
  { id: 'p2', name: 'Padel HC', monthlyPrice: '29.00', isActive: true } as any,
];
const wrap = (action: 'renew' | 'change' | 'cancel') => render(
  <ThemeProvider>
    <SubscriptionActions action={action} sub={sub} plans={plans} clubId="c1" token="t" onClose={jest.fn()} onDone={jest.fn()} />
  </ThemeProvider>,
);

it('Renouveler → CB appelle adminRenewSubscription', async () => {
  wrap('renew');
  fireEvent.click(screen.getByRole('button', { name: /Carte|CB/ }));
  fireEvent.click(screen.getByRole('button', { name: /Renouveler/ }));
  await waitFor(() => expect(api.adminRenewSubscription).toHaveBeenCalledWith('c1', 's1', expect.objectContaining({ method: 'CARD' }), 't'));
});

it('Changer → choix d\'un autre plan puis confirmer', async () => {
  wrap('change');
  fireEvent.click(screen.getByRole('button', { name: /Padel HC/ }));
  fireEvent.click(screen.getByRole('button', { name: /Confirmer le changement/ }));
  await waitFor(() => expect(api.adminChangeSubscription).toHaveBeenCalledWith('c1', 's1', expect.objectContaining({ planId: 'p2' }), 't'));
});

it('Résilier → confirmation appelle adminCancelSubscription', async () => {
  wrap('cancel');
  fireEvent.click(screen.getByRole('button', { name: /Résilier l’abonnement|Résilier l'abonnement/ }));
  await waitFor(() => expect(api.adminCancelSubscription).toHaveBeenCalledWith('c1', 's1', 't'));
});
```

- [ ] **Step 2: Run — expect fail** — FAIL (module missing).

- [ ] **Step 3: Implement**

```tsx
'use client';
import { useState } from 'react';
import { api, SubscriberRow, SubscriptionPlanSummary, PaymentMethod } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Theme } from '@/lib/theme';
import { Btn } from '@/components/ui/atoms';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

type Action = 'renew' | 'change' | 'cancel' | null;
const SALE_METHODS: { m: PaymentMethod; label: string }[] = [
  { m: 'CARD', label: 'Carte' }, { m: 'CASH', label: 'Espèces' }, { m: 'TRANSFER', label: 'Virement' },
  { m: 'VOUCHER', label: 'Ticket CE' }, { m: 'OTHER', label: 'Autre' },
];
const eur = (s: string) => { const n = Number(s); return n % 1 === 0 ? String(n) : n.toFixed(2).replace('.', ','); };

export function SubscriptionActions({ action, sub, plans, clubId, token, onClose, onDone }: {
  action: Action;
  sub: Pick<SubscriberRow, 'id' | 'planId' | 'planName' | 'expiresAt' | 'monthlyPriceSnapshot'> | null;
  plans: SubscriptionPlanSummary[]; clubId: string; token: string;
  onClose: () => void; onDone: () => void;
}) {
  const { th } = useTheme();
  const [method, setMethod] = useState<PaymentMethod>('CARD');
  const [voucherRef, setVoucherRef] = useState('');
  const [planId, setPlanId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!action || !sub) return null;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr(null);
    try { await fn(); onDone(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  const payBody = () => ({ method, voucherRef: method === 'VOUCHER' ? voucherRef : undefined });
  const canPay = method !== 'VOUCHER' || voucherRef.trim().length > 0;

  if (action === 'cancel') {
    return (
      <ConfirmDialog
        title="Résilier l’abonnement ?"
        body={`« ${sub.planName} » sera résilié immédiatement (échéance perdue : ${new Date(sub.expiresAt).toLocaleDateString('fr-FR')}). Aucun remboursement automatique.`}
        confirmLabel="Résilier l’abonnement" danger busy={busy}
        onConfirm={() => run(() => api.adminCancelSubscription(clubId, sub.id, token))}
        onCancel={onClose}
      />
    );
  }

  const methodRow = (
    <div>
      <div style={label(th)}>Moyen de paiement</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {SALE_METHODS.map(({ m, label: l }) => (
          <button key={m} type="button" onClick={() => setMethod(m)} aria-pressed={method === m}
            style={chip(th, method === m)}>{l}</button>
        ))}
      </div>
      {method === 'VOUCHER' && (
        <input value={voucherRef} onChange={(e) => setVoucherRef(e.target.value)} placeholder="Référence du ticket"
          aria-label="Référence du ticket" style={input(th)} />
      )}
    </div>
  );

  return (
    <Modal th={th} onClose={onClose}>
      {action === 'renew' ? (
        <>
          <h3 style={title(th)}>Renouveler l’abonnement</h3>
          <p style={sub_(th)}>{sub.planName} · {eur(sub.monthlyPriceSnapshot)} € / mois (tarif du membre). Prolonge la période sans perte de jours.</p>
          {methodRow}
          {err && <div style={errBox(th)}>{err}</div>}
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <Btn variant="surface" onClick={onClose} disabled={busy}>Annuler</Btn>
            <Btn onClick={() => run(() => api.adminRenewSubscription(clubId, sub.id, payBody(), token))} disabled={busy || !canPay}>
              Renouveler · {eur(sub.monthlyPriceSnapshot)} €
            </Btn>
          </div>
        </>
      ) : (
        <>
          <h3 style={title(th)}>Changer de forfait</h3>
          <p style={sub_(th)}>L’abonnement actuel est résilié ; le nouveau démarre aujourd’hui au plein tarif (pas de prorata).</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {plans.filter((p) => p.isActive && p.id !== sub.planId).map((p) => (
              <button key={p.id} type="button" onClick={() => setPlanId(p.id)} aria-pressed={planId === p.id}
                style={planCard(th, planId === p.id)}>
                <b>{p.name}</b><span>{eur(p.monthlyPrice)} € / mois</span>
              </button>
            ))}
          </div>
          <div style={{ marginTop: 12 }}>{methodRow}</div>
          {err && <div style={errBox(th)}>{err}</div>}
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <Btn variant="surface" onClick={onClose} disabled={busy}>Annuler</Btn>
            <Btn onClick={() => planId && run(() => api.adminChangeSubscription(clubId, sub.id, { planId, ...payBody() }, token))}
              disabled={busy || !planId || !canPay}>Confirmer le changement</Btn>
          </div>
        </>
      )}
    </Modal>
  );
}

function Modal({ th, onClose, children }: { th: Theme; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.45)' }} />
      <div style={{ position: 'relative', width: '100%', maxWidth: 440, margin: 16, background: th.bgElev, borderRadius: 20, padding: 20, boxShadow: '0 14px 50px rgba(0,0,0,.34)' }}>{children}</div>
    </div>
  );
}
const title = (th: Theme): React.CSSProperties => ({ fontFamily: th.fontDisplay, fontSize: 20, fontWeight: 800, color: th.text, margin: 0 });
const sub_ = (th: Theme): React.CSSProperties => ({ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, margin: '6px 0 14px' });
const label = (th: Theme): React.CSSProperties => ({ fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5, color: th.textMute, marginBottom: 8 });
const chip = (th: Theme, on: boolean): React.CSSProperties => ({ border: `1.5px solid ${on ? th.accent : th.lineStrong}`, background: on ? `${th.accent}14` : th.surface, color: th.text, borderRadius: 10, padding: '8px 12px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700 });
const planCard = (th: Theme, on: boolean): React.CSSProperties => ({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: `1.5px solid ${on ? th.accent : th.lineStrong}`, background: on ? `${th.accent}14` : th.surface, color: th.text, borderRadius: 12, padding: '11px 13px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13 });
const input = (th: Theme): React.CSSProperties => ({ marginTop: 8, width: '100%', border: `1px solid ${th.lineStrong}`, borderRadius: 10, padding: '9px 12px', fontFamily: th.fontUI, fontSize: 13, background: th.surface, color: th.text });
const errBox = (th: Theme): React.CSSProperties => ({ marginTop: 12, background: th.accent, color: th.onAccent, borderRadius: 10, padding: '8px 12px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600 });
```

> Before writing, open `frontend/components/ui/ConfirmDialog.tsx` to confirm its exact prop names (`title`/`body`/`confirmLabel`/`danger`/`busy`/`onConfirm`/`onCancel`) and adjust if they differ. Verify `Theme` exposes `bgElev`, `surface`, `lineStrong`, `accent`, `onAccent`, `textMute`, `fontDisplay`, `fontUI` (all used elsewhere in the codebase).

- [ ] **Step 4: Run — expect pass** — `node node_modules/jest/bin/jest.js __tests__/SubscriptionActions.test.tsx` → PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/admin/subscriptions/SubscriptionActions.tsx frontend/__tests__/SubscriptionActions.test.tsx
git commit -m "feat(abonnes): dialogs renouveler/changer/résilier"
```

---

## Task 8: Frontend — page `/admin/abonnes`

**Files:**
- Create: `frontend/app/admin/abonnes/page.tsx`
- Test: `frontend/__tests__/AdminSubscribers.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import AdminSubscribersPage from '../app/admin/abonnes/page';
import { ThemeProvider } from '../lib/ThemeProvider';
import { api } from '../lib/api';

jest.mock('../lib/useAuth', () => ({ useAuth: () => ({ token: 'tok', ready: true }) }));
jest.mock('../lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'club-1', clubSports: [{ sport: { key: 'padel' } }] } }) }));
jest.mock('../lib/api', () => ({
  api: {
    adminGetSubscriptionOverview: jest.fn(),
    adminRenewSubscription: jest.fn(), adminChangeSubscription: jest.fn(), adminCancelSubscription: jest.fn(),
  },
  assetUrl: (u: string | null) => u,
}));

const overview = {
  kpis: { activeCount: 2, monthlyRevenueCents: 6800, expiringSoonCount: 1 },
  plans: [{ id: 'p1', name: 'Padel illimité', monthlyPrice: '39.00', benefit: 'INCLUDED', discountPercent: null, sportKeys: ['padel'], isActive: true, activeCount: 1 }],
  subscribers: [
    { id: 'a', user: { id: 'u1', firstName: 'Jean', lastName: 'Dupont', avatarUrl: null }, planId: 'p1', planName: 'Padel illimité', status: 'ACTIVE', startedAt: '2099-01-01T00:00:00Z', expiresAt: '2099-12-01T00:00:00Z', monthlyPriceSnapshot: '39.00', sportKeys: ['padel'] },
    { id: 'b', user: { id: 'u2', firstName: 'Marie', lastName: 'Leroy', avatarUrl: null }, planId: 'p1', planName: 'Padel illimité', status: 'CANCELLED', startedAt: '2020-01-01T00:00:00Z', expiresAt: '2020-02-01T00:00:00Z', monthlyPriceSnapshot: '29.00', sportKeys: ['padel'] },
  ],
};

beforeEach(() => { jest.clearAllMocks(); (api.adminGetSubscriptionOverview as jest.Mock).mockResolvedValue(overview); });

it('KPIs + carte forfait + registre (actifs par défaut)', async () => {
  render(<ThemeProvider><AdminSubscribersPage /></ThemeProvider>);
  expect(await screen.findByRole('heading', { name: 'Abonnés' })).toBeInTheDocument();
  expect(screen.getByText('68 €')).toBeInTheDocument();          // revenu/mois
  expect(screen.getByText(/Padel illimité/)).toBeInTheDocument();
  expect(screen.getByText('Jean Dupont')).toBeInTheDocument();   // actif
  expect(screen.queryByText('Marie Leroy')).not.toBeInTheDocument(); // annulée (historique)
});

it('onglet Historique montre les annulées', async () => {
  render(<ThemeProvider><AdminSubscribersPage /></ThemeProvider>);
  await screen.findByText('Jean Dupont');
  fireEvent.click(screen.getByRole('button', { name: /Historique/ }));
  expect(await screen.findByText('Marie Leroy')).toBeInTheDocument();
});

it('clic sur ⟳ ouvre le dialog et renouvelle', async () => {
  (api.adminRenewSubscription as jest.Mock).mockResolvedValue({ subscription: { id: 'a' } });
  render(<ThemeProvider><AdminSubscribersPage /></ThemeProvider>);
  const row = (await screen.findByText('Jean Dupont')).closest('[data-sub-row]')!;
  fireEvent.click(within(row as HTMLElement).getByRole('button', { name: /Renouveler/ }));
  fireEvent.click(await screen.findByRole('button', { name: /Renouveler · / }));
  await waitFor(() => expect(api.adminRenewSubscription).toHaveBeenCalledWith('club-1', 'a', expect.anything(), 'tok'));
});
```

- [ ] **Step 2: Run — expect fail** — FAIL.

- [ ] **Step 3: Implement**

```tsx
'use client';
import { useState, useEffect, useCallback } from 'react';
import { api, SubscriptionOverview, SubscriberRow } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS, inkOn } from '@/lib/theme';
import { Icon } from '@/components/ui/Icon';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';
import { clubIsMultiSport } from '@/lib/sportBadge';
import { filterRegistry, isActiveSub, expiresSoon, daysUntil, RegistryMode } from '@/lib/subscriptionAdmin';
import { SubscriptionActions } from '@/components/admin/subscriptions/SubscriptionActions';

const eur = (cents: number) => (cents % 100 === 0 ? `${cents / 100} €` : `${(cents / 100).toFixed(2).replace('.', ',')} €`);
const eurStr = (s: string) => { const n = Number(s); return n % 1 === 0 ? String(n) : n.toFixed(2).replace('.', ','); };
const fdate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR');

export default function AdminSubscribersPage() {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { club } = useClub();
  const clubId = club?.id;
  const multiSport = clubIsMultiSport(club as any);
  const [data, setData] = useState<SubscriptionOverview | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<RegistryMode>('active');
  const [planId, setPlanId] = useState<string | null>(null);
  const [action, setAction] = useState<{ kind: 'renew' | 'change' | 'cancel'; sub: SubscriberRow } | null>(null);

  const load = useCallback(async () => {
    if (!token || !clubId) return;
    setData(await api.adminGetSubscriptionOverview(clubId, token));
  }, [token, clubId]);
  useEffect(() => { if (ready && token && clubId) load(); }, [ready, token, clubId, load]);
  useEffect(() => { setNow(Date.now()); }, []);

  if (!data || now === null) return <div style={{ padding: 24, color: th.textMute }}>Chargement…</div>;
  const rows = filterRegistry(data.subscribers, { query, mode, planId }, now);
  const totalActive = data.kpis.activeCount || 1;

  return (
    <div style={{ padding: '20px 22px', maxWidth: 900, margin: '0 auto' }}>
      <h1 style={{ fontFamily: th.fontDisplay, fontSize: 28, fontWeight: 800, letterSpacing: -0.6, color: th.text, margin: '0 0 4px' }}>Abonnés</h1>
      <p style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, marginBottom: 18 }}>Les abonnements vendus par le club — qui, à quel forfait, jusqu’à quand.</p>

      {/* KPIs */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <Kpi th={th} icon="bolt" tint={ACCENTS.blue} value={String(data.kpis.activeCount)} label="Abonnés actifs" />
        <Kpi th={th} icon="euro" tint="#5bbd6e" value={eur(data.kpis.monthlyRevenueCents)} label="Revenu / mois" />
        <Kpi th={th} icon="clock" tint={ACCENTS.coral} value={String(data.kpis.expiringSoonCount)} label="Expirent sous 30 j" />
      </div>

      {/* Cartes forfait */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {data.plans.map((p, i) => {
          const c = ACCENTS[(['blue', 'coral', 'apricot', 'cyan', 'emerald'] as const)[i % 5]] ?? th.accent;
          const on = planId === p.id;
          return (
            <button key={p.id} type="button" onClick={() => setPlanId(on ? null : p.id)}
              style={{ flex: '1 1 200px', textAlign: 'left', background: th.surface, borderRadius: 14, padding: '13px 15px',
                boxShadow: on ? `0 0 0 2px ${c}` : th.shadow, borderLeft: `4px solid ${c}`, opacity: p.activeCount === 0 ? 0.6 : 1, cursor: 'pointer' }}>
              <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 13, color: th.text }}>{p.name}
                {multiSport && p.sportKeys[0] && <span style={{ marginLeft: 6, fontSize: 10.5, color: th.textFaint }}>· {p.sportKeys.join(', ')}</span>}
              </div>
              <div style={{ fontFamily: th.fontUI, fontSize: 11, color: th.textMute }}>{eurStr(p.monthlyPrice)} €/mois</div>
              <div style={{ fontFamily: th.fontDisplay, fontSize: 20, fontWeight: 800, letterSpacing: -0.6, color: th.text, marginTop: 4 }}>{p.activeCount} <small style={{ fontSize: 11, color: th.textMute, fontWeight: 600 }}>abonné{p.activeCount > 1 ? 's' : ''}</small></div>
              <div style={{ height: 5, background: th.surface2, borderRadius: 3, marginTop: 8 }}>
                <div style={{ height: '100%', width: `${Math.round((p.activeCount / totalActive) * 100)}%`, background: c, borderRadius: 3 }} />
              </div>
            </button>
          );
        })}
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher un membre…"
          style={{ flex: '1 1 200px', border: `1px solid ${th.lineStrong}`, borderRadius: 999, padding: '8px 14px', background: th.surface, color: th.text, fontFamily: th.fontUI, fontSize: 12.5 }} />
        {(['active', 'soon', 'history'] as RegistryMode[]).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m}
            style={{ border: `1px solid ${mode === m ? th.text : th.lineStrong}`, background: mode === m ? th.text : th.surface, color: mode === m ? th.bg : th.textMute, borderRadius: 999, padding: '7px 13px', fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
            {m === 'active' ? 'Actifs' : m === 'soon' ? 'Expirent bientôt' : 'Historique'}
          </button>
        ))}
      </div>

      {/* Registre */}
      {rows.length === 0 ? (
        <div style={{ padding: 30, textAlign: 'center', color: th.textFaint, fontFamily: th.fontUI, fontSize: 13, background: th.surface, borderRadius: 14 }}>Aucun abonné.</div>
      ) : rows.map((s) => {
        const soon = expiresSoon(s, now);
        const active = isActiveSub(s, now);
        return (
          <div key={s.id} data-sub-row style={{ display: 'flex', alignItems: 'center', gap: 12, background: th.surface, borderRadius: 12, padding: '11px 13px', marginBottom: 6, borderLeft: `4px solid ${soon ? ACCENTS.coral : 'transparent'}`, boxShadow: th.shadow }}>
            <Avatar name={`${s.user.firstName} ${s.user.lastName}`} url={s.user.avatarUrl} color={colorForSeed(s.user.id)} size={30} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 13, color: th.text }}>{s.user.firstName} {s.user.lastName}</div>
              <div style={{ fontFamily: th.fontUI, fontSize: 11.5, color: th.textMute }}>{s.planName} · depuis le {fdate(s.startedAt)}</div>
            </div>
            <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
              {active
                ? <span style={{ fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 700, borderRadius: 999, padding: '2px 9px', background: soon ? '#fdeee2' : '#e3f0e6', color: soon ? '#b45309' : '#2c7a44' }}>{soon ? `Expire J-${daysUntil(s.expiresAt, now)}` : 'Actif'}</span>
                : <span style={{ fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 700, borderRadius: 999, padding: '2px 9px', background: th.surface2, color: th.textMute }}>Terminé</span>}
              <div style={{ fontFamily: th.fontUI, fontSize: 11, color: th.textFaint, marginTop: 2 }}>{fdate(s.expiresAt)}</div>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {active && <>
                <IconBtn th={th} label="Renouveler" onClick={() => setAction({ kind: 'renew', sub: s })}><Icon name="arrowR" size={14} color={th.textMute} /></IconBtn>
                <IconBtn th={th} label="Changer" onClick={() => setAction({ kind: 'change', sub: s })}><Icon name="settings" size={14} color={th.textMute} /></IconBtn>
                <IconBtn th={th} label="Résilier" onClick={() => setAction({ kind: 'cancel', sub: s })}><Icon name="x" size={14} color={ACCENTS.coral} /></IconBtn>
              </>}
            </div>
          </div>
        );
      })}

      {action && (
        <SubscriptionActions action={action.kind} sub={action.sub} plans={data.plans} clubId={clubId!} token={token!}
          onClose={() => setAction(null)} onDone={() => { setAction(null); load(); }} />
      )}
    </div>
  );
}

function Kpi({ th, icon, tint, value, label }: { th: any; icon: any; tint: string; value: string; label: string }) {
  return (
    <div style={{ flex: '1 1 180px', display: 'flex', alignItems: 'center', gap: 12, background: th.surface, borderRadius: 14, padding: '14px 16px', boxShadow: th.shadow }}>
      <span style={{ width: 38, height: 38, borderRadius: 11, background: `${tint}22`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={17} color={tint} /></span>
      <div>
        <div style={{ fontFamily: th.fontDisplay, fontSize: 22, fontWeight: 800, letterSpacing: -0.7, color: th.text }}>{value}</div>
        <div style={{ fontFamily: th.fontUI, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: th.textMute }}>{label}</div>
      </div>
    </div>
  );
}
function IconBtn({ th, label, onClick, children }: { th: any; label: string; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-label={label} onClick={onClick} style={{ width: 30, height: 30, borderRadius: 9, border: `1px solid ${th.lineStrong}`, background: th.surface, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{children}</button>;
}
```

> Verify `Avatar` prop names (`name`/`url`/`color`/`size`) in `frontend/components/ui/Avatar.tsx` and `th.shadow`/`th.surface2` exist; align if the codebase uses different names. `ACCENTS` keys used: `blue`, `coral`, `apricot`, `cyan`, `emerald` — confirm in `lib/theme.ts`, drop any missing key from the cycle array.

- [ ] **Step 4: Run — expect pass** — `node node_modules/jest/bin/jest.js __tests__/AdminSubscribers.test.tsx` → PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/admin/abonnes/page.tsx frontend/__tests__/AdminSubscribers.test.tsx
git commit -m "feat(abonnes): page /admin/abonnes (KPIs, forfaits, registre)"
```

---

## Task 9: Frontend — nav entry

**Files:**
- Modify: `frontend/app/admin/layout.tsx` (Finances section, ~line 152)
- Test: `frontend/__tests__/AdminLayout.test.tsx`

- [ ] **Step 1: Add failing assertion** to `AdminLayout.test.tsx` (in an existing render-nav test):

```tsx
expect(screen.getByText('Abonnés')).toBeInTheDocument();
```

- [ ] **Step 2: Run — expect fail.**

- [ ] **Step 3: Add the nav item** in the `Finances` section items array, before `Offres prépayées`:

```tsx
{ href: '/admin/abonnes', label: 'Abonnés', icon: 'bolt' },
```

> `bolt` est déjà le glyphe « abonnement » de Palova (avenue « Couvert par votre abonnement » de BookingModal) ; il est réutilisé ici volontairement bien qu'Events l'emploie aussi (sections distinctes). Si Eric préfère un pictogramme dédié, ajouter une icône `star`/`repeat` à `Icon.tsx` et l'utiliser.

- [ ] **Step 4: Run — expect pass.**

- [ ] **Step 5: Commit**

```bash
git add frontend/app/admin/layout.tsx frontend/__tests__/AdminLayout.test.tsx
git commit -m "feat(abonnes): entrée nav Abonnés (Finances)"
```

---

## Task 10: Frontend — onglet « Abonnement » fiche membre

**Files:**
- Modify: `frontend/app/admin/members/[userId]/page.tsx` (`type Tab` ~24, `Segmented` options ~217, tab render blocks, header chip ~192)
- Test: `frontend/__tests__/MemberHistory.test.tsx` (or a new `MemberSubscriptionTab.test.tsx`)

- [ ] **Step 1: Write failing test**

Add to the member-detail test (mock already stubs `api`; add the method + assert):

```tsx
// in the api mock: adminGetMemberSubscriptions: jest.fn().mockResolvedValue([
//   { id: 's1', planId: 'p1', status: 'ACTIVE', startedAt: '2099-01-01T00:00:00Z', expiresAt: '2099-12-01T00:00:00Z', monthlyPriceSnapshot: '39.00', sportKeys: ['padel'], offPeakOnly: false, benefit: 'INCLUDED', discountPercent: null, dailyCap: null, weeklyCap: null, plan: { name: 'Padel illimité' } },
// ]),
// adminRenewSubscription/adminChangeSubscription/adminCancelSubscription: jest.fn().mockResolvedValue({}),
// adminGetSubscriptionPlans: jest.fn().mockResolvedValue([{ id: 'p1', name: 'Padel illimité', monthlyPrice: '39.00', isActive: true, sportKeys: ['padel'], benefit: 'INCLUDED', discountPercent: null }]),

it('onglet Abonnement : affiche l’abo actif', async () => {
  renderMemberPage(); // existing helper
  fireEvent.click(await screen.findByRole('tab', { name: /Abonnement/ }) ?? screen.getByText('Abonnement'));
  expect(await screen.findByText('Padel illimité')).toBeInTheDocument();
  expect(screen.getByText(/gratuit|39/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run — expect fail.**

- [ ] **Step 3: Implement**

1. `type Tab = 'activite' | 'finances' | 'niveau' | 'fidelite' | 'notes' | 'abonnement';`
2. Add to `Segmented` options: `{ value: 'abonnement', label: 'Abonnement' }`.
3. Add state + load:

```tsx
const [subs, setSubs] = useState<import('@/lib/api').Subscription[]>([]);
const [plans, setPlans] = useState<import('@/lib/api').SubscriptionPlanSummary[]>([]);
const [subAction, setSubAction] = useState<{ kind: 'renew' | 'change' | 'cancel'; sub: any } | null>(null);
const loadSubs = useCallback(async () => {
  if (!token || !clubId || !userId) return;
  const [s, p] = await Promise.all([api.adminGetMemberSubscriptions(clubId, userId, token), api.adminGetSubscriptionPlans(clubId, token)]);
  setSubs(s); setPlans(p.map((pl) => ({ ...pl, monthlyPrice: pl.monthlyPrice, activeCount: 0 })) as any);
}, [token, clubId, userId]);
useEffect(() => { if (tab === 'abonnement') loadSubs(); }, [tab, loadSubs]);
```

4. Render block (`{tab === 'abonnement' && (...)}`): map `subs`, active first, show plan name, price snapshot, benefit (`coverageLabel`), période, and for the active one the `⟳ ✎ ✕` buttons → `setSubAction`. Reuse `SubscriptionActions` (adapt a `Subscription` into the `sub` shape it expects: `{ id, planId, planName: s.plan.name, expiresAt, monthlyPriceSnapshot }`). On `onDone` → `loadSubs()`.
5. Header chip: wrap the `Abonné` chip (line ~192) in a button that `setTab('abonnement')`.

```tsx
{tab === 'abonnement' && (
  <div>
    {subs.length === 0 && <p style={{ color: th.textMute }}>Aucun abonnement.</p>}
    {subs.map((s) => {
      const active = s.status === 'ACTIVE' && new Date(s.expiresAt).getTime() > Date.now();
      return (
        <div key={s.id} style={{ background: th.surface, borderRadius: 14, padding: 14, marginBottom: 8, borderLeft: `4px solid ${active ? th.accent : th.lineStrong}`, boxShadow: th.shadow }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
            <div>
              <b style={{ fontFamily: th.fontUI, fontSize: 14, color: th.text }}>{s.plan.name}</b>{' '}
              <span style={{ fontFamily: th.fontUI, fontSize: 11, color: th.textMute }}>{active ? 'Actif' : 'Terminé'}</span>
              <div style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute, marginTop: 3 }}>
                {Number(s.monthlyPriceSnapshot)} €/mois · {coverageLabel(s)} · du {new Date(s.startedAt).toLocaleDateString('fr-FR')} au {new Date(s.expiresAt).toLocaleDateString('fr-FR')}
              </div>
            </div>
            {active && (
              <div style={{ display: 'flex', gap: 6 }}>
                <Btn variant="surface" onClick={() => setSubAction({ kind: 'renew', sub: { id: s.id, planId: s.planId, planName: s.plan.name, expiresAt: s.expiresAt, monthlyPriceSnapshot: s.monthlyPriceSnapshot } })}>Renouveler</Btn>
                <Btn variant="surface" onClick={() => setSubAction({ kind: 'change', sub: { id: s.id, planId: s.planId, planName: s.plan.name, expiresAt: s.expiresAt, monthlyPriceSnapshot: s.monthlyPriceSnapshot } })}>Changer</Btn>
                <Btn variant="surface" onClick={() => setSubAction({ kind: 'cancel', sub: { id: s.id, planId: s.planId, planName: s.plan.name, expiresAt: s.expiresAt, monthlyPriceSnapshot: s.monthlyPriceSnapshot } })}>Résilier</Btn>
              </div>
            )}
          </div>
        </div>
      );
    })}
    {subAction && (
      <SubscriptionActions action={subAction.kind} sub={subAction.sub} plans={plans} clubId={clubId!} token={token!}
        onClose={() => setSubAction(null)} onDone={() => { setSubAction(null); loadSubs(); }} />
    )}
  </div>
)}
```

Imports to add: `import { SubscriptionActions } from '@/components/admin/subscriptions/SubscriptionActions';` and `import { coverageLabel } from '@/lib/subscriptions';`.

> `coverageLabel` (from `lib/subscriptions.ts`) takes `{ benefit, discountPercent }` — `Subscription` has both. Confirm `useCallback`/`clubId`/`userId`/`token` are already available in this component (they are — used by other tabs).

- [ ] **Step 4: Run — expect pass** — `node node_modules/jest/bin/jest.js __tests__/MemberHistory.test.tsx` → PASS.

- [ ] **Step 5: Commit**

```bash
git add "frontend/app/admin/members/[userId]/page.tsx" frontend/__tests__/MemberHistory.test.tsx
git commit -m "feat(abonnes): onglet Abonnement sur la fiche membre"
```

---

## Task 11: Final verification

- [ ] **Step 1: Backend suites + tsc**

```bash
cd backend
node node_modules/jest/bin/jest.js src/services/__tests__/subscription.service.test.ts src/routes/__tests__/admin.subscriptions.routes.test.ts
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json 2>&1 | grep -E "subscription|admin\.ts" || echo "backend tsc clean on touched"
```
Expected: all PASS; tsc clean on touched files.

- [ ] **Step 2: Frontend suites + tsc**

```bash
cd frontend
node node_modules/jest/bin/jest.js __tests__/subscriptionAdmin.test.tsx __tests__/SubscriptionActions.test.tsx __tests__/AdminSubscribers.test.tsx __tests__/AdminLayout.test.tsx __tests__/MemberHistory.test.tsx
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json 2>&1 | grep -E "abonnes|subscriptionAdmin|SubscriptionActions|members" || echo "frontend tsc clean on touched"
```
Expected: all PASS; tsc clean on touched files.

- [ ] **Step 3: Visual check (verify skill)** — screenshot `/admin/abonnes` (clair + sombre, desktop + mobile 390) and the member `Abonnement` tab; confirm KPIs, plan cards, registry, and dialogs render with no horizontal overflow.

- [ ] **Step 4: Update CLAUDE.md** — add a short evolution note under the Caisse section documenting the new « Abonnés » surface and the cycle-de-vie routes; and correct the 2026-07-13 note (auto-apply covers **une part nominale**, not the participant's real share).

---

## Self-review notes

- **Spec coverage:** overview/KPIs (T1), renew (T2), change (T3), cancel wiring (T4), API (T5), helpers (T6), dialogs (T7), page (T8), nav (T9), member tab (T10), verify+docs (T11). Multi-sport chips: T8 (plan cards) via `clubIsMultiSport`. ✓
- **Method names consistent:** `overview`/`renewSubscription`/`changeSubscription`/`cancelSubscription`, `adminGetSubscriptionOverview`/`adminRenewSubscription`/`adminChangeSubscription`/`adminCancelSubscription`, helpers `isActiveSub`/`expiresSoon`/`daysUntil`/`filterRegistry` — used identically across tasks. ✓
- **No prorata / no auto-refund** are explicit in dialog copy + backend behavior. ✓
- **Assumptions to verify at execution** (called out inline): `requireClubMember` staff-mock shape, `ConfirmDialog`/`Avatar` prop names, `Theme` token names, `ACCENTS` keys.
