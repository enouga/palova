# Phase 1 — Fondations paiement (PaymentStatus + Refund + audit) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner au système d'encaissement un cycle de vie de l'argent : statut de paiement, remboursement/correction tracé (modèle `Refund`), recrédit du prépayé, audit `createdByUserId`, et plafond d'encaissement calculé **net des remboursements** — sans casser l'existant.

**Architecture:** Migration Prisma **additive** (les paiements existants deviennent `CAPTURED`). Nouveau `Refund` = table dédiée à montants **positifs** liée au `Payment` parent (jamais de `Payment` négatif → le récap caisse `sum(amount)` reste juste). Nouveau `RefundService.refund()` en transaction `Serializable` avec `updateMany` conditionnel (anti-double remboursement) + recrédit du `MemberPackage` (miroir de `PackageService.consume`). `addPayment` compte désormais NET. Front : validation du montant + affichage net dans `lib/caisse.ts`, action « Rembourser / corriger » dans les pages caisse/planning.

**Tech Stack:** Node 22 + Express 5 + Prisma 7 (adapter-pg) + PostgreSQL ; Jest (Prisma mocké via `src/__mocks__/prisma`) ; frontend Next.js 16 + React 19, tests RTL/Jest.

**Conventions repo (vérifiées) :** montants en **centimes entiers** côté logique ; erreurs métier = `throw new Error('CODE')` mappées dans `ERROR_STATUS` (`backend/src/routes/admin.ts:32`) ; `req.user!.id` (posé par `authMiddleware`) = staff connecté pour l'audit ; mocks de test via `import '../../__mocks__/prisma'` + `prismaMock`, `$transaction` simulé par `prismaMock.$transaction.mockImplementation(async (fn) => fn(prismaMock))`.

**Pré-requis d'exécution :** Postgres + Redis up (`"C:\Program Files\Docker\Docker\resources\bin\docker-compose-v1.exe" up -d`) pour les migrations ; les tests unitaires Jest n'ont PAS besoin de Docker (Prisma est mocké).

---

## Structure des fichiers

| Fichier | Rôle | Action |
|---|---|---|
| `backend/prisma/schema.prisma` | Enum `PaymentStatus`, champs `Payment`, modèle `Refund`, relation `User` | Modifier |
| `backend/prisma/migrations/<ts>_add_payment_status_refund_audit/migration.sql` | Migration additive | Créer |
| `backend/src/services/refund.service.ts` | `RefundService.refund()` | Créer |
| `backend/src/services/__tests__/refund.service.test.ts` | Tests du RefundService | Créer |
| `backend/src/services/reservation.service.ts` | `addPayment` : plafond NET + `createdByUserId` | Modifier |
| `backend/src/services/package.service.ts` | `sellPackage` : `createdByUserId` | Modifier |
| `backend/src/services/__tests__/reservation.service.test.ts` | plafond net + createdBy | Modifier |
| `backend/src/routes/admin.ts` | route `POST .../payments/:paymentId/refunds`, `ERROR_STATUS`, câblage `createdByUserId` | Modifier |
| `frontend/lib/caisse.ts` | `validatePaymentAmount`, net des refunds | Modifier |
| `frontend/__tests__/caisse.test.ts` | tests des helpers | Modifier |
| `frontend/lib/api.ts` | types `Refund`/`Payment` + `api.refundPayment` | Modifier |
| `frontend/app/admin/caisse/page.tsx`, `frontend/app/admin/planning/page.tsx` | action « Rembourser / corriger » + bornage input | Modifier |

---

## Task 1: Schéma & migration (PaymentStatus, champs Payment, modèle Refund, audit)

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_add_payment_status_refund_audit/migration.sql`

> Pas de test unitaire sur le schéma. Cette tâche pose le modèle et régénère le client Prisma (les tâches suivantes en dépendent : `prismaMock.refund` n'existe qu'après régénération).

- [ ] **Step 1: Ajouter l'enum `PaymentStatus`** dans `schema.prisma`, juste après `enum PaymentMethod { … }` (vers la ligne 51) :

```prisma
/// Cycle de vie d'un paiement. Les encaissements caisse naissent CAPTURED ;
/// PENDING/AUTHORIZED/FAILED serviront au paiement en ligne (phase ultérieure).
enum PaymentStatus {
  PENDING
  AUTHORIZED
  CAPTURED
  FAILED
  REFUNDED
  PARTIALLY_REFUNDED
}
```

- [ ] **Step 2: Étendre le modèle `Payment`** (bloc `model Payment` vers la ligne 368). Ajouter les 3 champs après `createdAt` et 2 relations + 1 index :

```prisma
  status          PaymentStatus  @default(CAPTURED) @map("status")
  refundedAmount  Decimal        @default(0) @db.Decimal(10, 2) @map("refunded_amount")
  createdByUserId String?        @map("created_by_user_id") // staff ayant saisi l'encaissement (audit)
```

Dans le bloc relations de `Payment`, ajouter :

```prisma
  createdBy     User?                   @relation("PaymentsCreated", fields: [createdByUserId], references: [id], onDelete: SetNull)
  refunds       Refund[]
```

Et un index, à côté des `@@index` existants :

```prisma
  @@index([clubId, status])
```

- [ ] **Step 3: Ajouter le modèle `Refund`** juste après le `model Payment { … }` (après la ligne 393) :

```prisma
/// Remboursement (total ou partiel) d'un Payment. Montant POSITIF + lien parent —
/// jamais un Payment négatif, pour que le récap caisse (sum(amount)) reste juste.
/// La caisse nette d'une journée = sum(payments.amount) - sum(refunds.amount).
model Refund {
  id              String        @id @default(cuid())
  paymentId       String        @map("payment_id")
  clubId          String        @map("club_id")
  amount          Decimal       @db.Decimal(10, 2) // > 0
  reason          String?
  method          PaymentMethod @default(CASH)      // moyen par lequel l'argent est rendu
  createdByUserId String?       @map("created_by_user_id")
  createdAt       DateTime      @default(now()) @map("created_at")

  payment Payment @relation(fields: [paymentId], references: [id], onDelete: Cascade)

  @@index([paymentId])
  @@index([clubId, createdAt])
  @@map("refunds")
}
```

- [ ] **Step 4: Ajouter la back-relation sur `User`** (bloc `model User`, vers la ligne 258, à côté de `memberPackages MemberPackage[]`) :

```prisma
  paymentsCreated Payment[] @relation("PaymentsCreated")
```

- [ ] **Step 5: Créer la migration SQL** dans un nouveau dossier `backend/prisma/migrations/<timestamp>_add_payment_status_refund_audit/migration.sql` (timestamp au format `AAAAMMJJHHMMSS`, ex. `20260615150000`). Contenu :

```sql
-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- AlterTable : champs additifs (les paiements existants prennent les defaults → CAPTURED / 0)
ALTER TABLE "payments" ADD COLUMN "status" "PaymentStatus" NOT NULL DEFAULT 'CAPTURED',
ADD COLUMN "refunded_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN "created_by_user_id" TEXT;

-- CreateTable
CREATE TABLE "refunds" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "club_id" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "reason" TEXT,
    "method" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payments_club_id_status_idx" ON "payments"("club_id", "status");

-- CreateIndex
CREATE INDEX "refunds_payment_id_idx" ON "refunds"("payment_id");

-- CreateIndex
CREATE INDEX "refunds_club_id_created_at_idx" ON "refunds"("club_id", "created_at");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 6: Appliquer la migration + régénérer le client.**

Run (depuis `backend/`, Docker up) : `npx prisma migrate dev --name add_payment_status_refund_audit` (ou, si la migration est déjà écrite à la main, `npx prisma migrate deploy` puis `npx prisma generate`).
Expected: migration appliquée, `Generated Prisma Client`. `prismaMock.refund` devient disponible dans les tests.

- [ ] **Step 7: Vérifier que le typecheck/tests existants passent** (rien ne doit casser : tout est additif).

Run (depuis `backend/`) : `npm test`
Expected: PASS (suite back inchangée et verte).

- [ ] **Step 8: Commit.**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(db): PaymentStatus, Refund, audit createdByUserId (migration additive)"
```

---

## Task 2: `RefundService.refund()` (TDD)

**Files:**
- Create: `backend/src/services/refund.service.ts`
- Test: `backend/src/services/__tests__/refund.service.test.ts`

Comportement : rembourse un `Payment` d'un montant ≤ (montant − déjà remboursé). Transaction `Serializable` : `updateMany` conditionnel sur le `Payment` (incrémente `refundedAmount`, anti-course/anti-double) → si `count===0` ⇒ `REFUND_EXCEEDS_PAID` ; crée le `Refund` ; recalcule `status` (`REFUNDED` si net 0, sinon `PARTIALLY_REFUNDED`) ; **si le paiement source est `PACK_CREDIT`/`WALLET`, recrédite le `MemberPackage`** (incrément, miroir de `consume`).

- [ ] **Step 1: Écrire le test qui échoue** — `backend/src/services/__tests__/refund.service.test.ts` :

```typescript
import '../../__mocks__/prisma';
import { Prisma } from '@prisma/client';
import { prismaMock } from '../../__mocks__/prisma';
import { RefundService } from '../refund.service';

describe('RefundService.refund', () => {
  let service: RefundService;
  beforeEach(() => {
    service = new RefundService();
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
  });

  const cashPayment = {
    id: 'pay-1', clubId: 'club-1', amount: new Prisma.Decimal(25),
    refundedAmount: new Prisma.Decimal(0), method: 'CASH', sourcePackageId: null,
  };

  it('refuse un paiement inconnu ou d’un autre club', async () => {
    prismaMock.payment.findUnique.mockResolvedValue(null as any);
    await expect(service.refund({ paymentId: 'x', clubId: 'club-1', amount: 5 }))
      .rejects.toThrow('PAYMENT_NOT_FOUND');

    prismaMock.payment.findUnique.mockResolvedValue({ ...cashPayment, clubId: 'autre' } as any);
    await expect(service.refund({ paymentId: 'pay-1', clubId: 'club-1', amount: 5 }))
      .rejects.toThrow('PAYMENT_NOT_FOUND');
  });

  it('refuse un montant <= 0 ou supérieur au remboursable', async () => {
    prismaMock.payment.findUnique.mockResolvedValue(cashPayment as any);
    await expect(service.refund({ paymentId: 'pay-1', clubId: 'club-1', amount: 0 }))
      .rejects.toThrow('VALIDATION_ERROR');
    await expect(service.refund({ paymentId: 'pay-1', clubId: 'club-1', amount: 30 }))
      .rejects.toThrow('REFUND_EXCEEDS_PAID');
  });

  it('remboursement partiel : updateMany conditionnel + Refund + status PARTIALLY_REFUNDED', async () => {
    prismaMock.payment.findUnique.mockResolvedValue(cashPayment as any);
    prismaMock.payment.updateMany.mockResolvedValue({ count: 1 } as any);
    prismaMock.refund.create.mockResolvedValue({ id: 'ref-1' } as any);
    prismaMock.payment.update.mockResolvedValue({ id: 'pay-1' } as any);

    await service.refund({ paymentId: 'pay-1', clubId: 'club-1', amount: 10, createdByUserId: 'staff-1' });

    expect(prismaMock.payment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'pay-1' }),
      data: { refundedAmount: { increment: new Prisma.Decimal(10) } },
    }));
    expect(prismaMock.refund.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ paymentId: 'pay-1', clubId: 'club-1', createdByUserId: 'staff-1' }),
    }));
    expect(prismaMock.payment.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'pay-1' }, data: { status: 'PARTIALLY_REFUNDED' },
    }));
  });

  it('remboursement total : status REFUNDED', async () => {
    prismaMock.payment.findUnique.mockResolvedValue(cashPayment as any);
    prismaMock.payment.updateMany.mockResolvedValue({ count: 1 } as any);
    prismaMock.refund.create.mockResolvedValue({ id: 'ref-1' } as any);
    prismaMock.payment.update.mockResolvedValue({ id: 'pay-1' } as any);

    await service.refund({ paymentId: 'pay-1', clubId: 'club-1', amount: 25 });

    expect(prismaMock.payment.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: 'REFUNDED' },
    }));
  });

  it('course concurrente : count===0 → ALREADY_REFUNDED', async () => {
    prismaMock.payment.findUnique.mockResolvedValue(cashPayment as any);
    prismaMock.payment.updateMany.mockResolvedValue({ count: 0 } as any);
    await expect(service.refund({ paymentId: 'pay-1', clubId: 'club-1', amount: 10 }))
      .rejects.toThrow('ALREADY_REFUNDED');
  });

  it('paiement prépayé (PACK_CREDIT) : recrédite le MemberPackage', async () => {
    prismaMock.payment.findUnique.mockResolvedValue({
      ...cashPayment, method: 'PACK_CREDIT', sourcePackageId: 'pkg-1',
    } as any);
    prismaMock.memberPackage.findUnique.mockResolvedValue({ id: 'pkg-1', kind: 'ENTRIES' } as any);
    prismaMock.payment.updateMany.mockResolvedValue({ count: 1 } as any);
    prismaMock.memberPackage.update.mockResolvedValue({ id: 'pkg-1' } as any);
    prismaMock.refund.create.mockResolvedValue({ id: 'ref-1' } as any);
    prismaMock.payment.update.mockResolvedValue({ id: 'pay-1' } as any);

    await service.refund({ paymentId: 'pay-1', clubId: 'club-1', amount: 25 });

    expect(prismaMock.memberPackage.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'pkg-1' }, data: { creditsRemaining: { increment: 1 } },
    }));
  });
});
```

- [ ] **Step 2: Lancer le test → échec attendu** (`Cannot find module '../refund.service'`).

Run (depuis `backend/`) : `npm test -- refund.service`
Expected: FAIL.

- [ ] **Step 3: Implémenter** `backend/src/services/refund.service.ts` :

```typescript
import { Prisma, PaymentMethod } from '@prisma/client';
import { prisma } from '../db/prisma';

const cents = (v: unknown) => { const n = Math.round(Number(v) * 100); return Number.isFinite(n) ? n : 0; };

export class RefundService {
  /**
   * Rembourse (total ou partiel) un Payment. Montant positif, ≤ (payé − déjà remboursé).
   * Transaction Serializable : incrément conditionnel de refundedAmount (anti-double /
   * anti-course, count===0 → ALREADY_REFUNDED), création du Refund, recalcul du status,
   * et recrédit du MemberPackage si le paiement source était du prépayé.
   */
  async refund(params: {
    paymentId: string;
    clubId: string;
    amount: number;
    reason?: string;
    method?: string;
    createdByUserId?: string;
  }) {
    if (typeof params.amount !== 'number' || isNaN(params.amount) || params.amount <= 0) {
      throw new Error('VALIDATION_ERROR');
    }
    const payment = await prisma.payment.findUnique({ where: { id: params.paymentId } });
    if (!payment || payment.clubId !== params.clubId) throw new Error('PAYMENT_NOT_FOUND');

    const amountCents     = cents(params.amount);
    const paidCents       = cents(payment.amount);
    const alreadyCents     = cents(payment.refundedAmount);
    const refundableCents = paidCents - alreadyCents;
    if (amountCents > refundableCents) throw new Error('REFUND_EXCEEDS_PAID');

    const newRefundedCents = alreadyCents + amountCents;
    const newStatus = newRefundedCents >= paidCents ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    const amount = new Prisma.Decimal(params.amount);

    const refundMethod = (['CASH', 'CARD', 'TRANSFER', 'ONLINE', 'OTHER', 'VOUCHER', 'PACK_CREDIT', 'WALLET', 'MEMBER']
      .includes(params.method ?? '') ? params.method : payment.method) as PaymentMethod;

    // Recrédit prépayé : on relit le package AVANT la transaction (lecture seule).
    const pkg = (payment.method === 'PACK_CREDIT' || payment.method === 'WALLET') && payment.sourcePackageId
      ? await prisma.memberPackage.findUnique({ where: { id: payment.sourcePackageId } })
      : null;

    return prisma.$transaction(async (tx) => {
      // Incrément conditionnel : ne touche la ligne que si le déjà-remboursé n'a pas bougé.
      const res = await tx.payment.updateMany({
        where: { id: payment.id, refundedAmount: payment.refundedAmount },
        data: { refundedAmount: { increment: amount } },
      });
      if (res.count === 0) throw new Error('ALREADY_REFUNDED');

      const refund = await tx.refund.create({
        data: {
          paymentId: payment.id,
          clubId: params.clubId,
          amount,
          reason: params.reason?.trim() || null,
          method: refundMethod,
          createdByUserId: params.createdByUserId ?? null,
        },
      });

      await tx.payment.update({ where: { id: payment.id }, data: { status: newStatus } });

      if (pkg) {
        await tx.memberPackage.update({
          where: { id: pkg.id },
          data: pkg.kind === 'ENTRIES'
            ? { creditsRemaining: { increment: 1 } }
            : { amountRemaining: { increment: amount } },
        });
      }

      return refund;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
```

- [ ] **Step 4: Lancer le test → vert.**

Run : `npm test -- refund.service`
Expected: PASS (tous les cas).

- [ ] **Step 5: Commit.**

```bash
git add backend/src/services/refund.service.ts backend/src/services/__tests__/refund.service.test.ts
git commit -m "feat(refund): RefundService.refund (Serializable, anti-double, recredit prepaye)"
```

---

## Task 3: `addPayment` plafond NET + audit, `sellPackage` audit (TDD)

**Files:**
- Modify: `backend/src/services/reservation.service.ts` (`addPayment`, lignes 894-998)
- Modify: `backend/src/services/package.service.ts` (`sellPackage`, lignes 75-121)
- Test: `backend/src/services/__tests__/reservation.service.test.ts`

But : le plafond d'encaissement (`assertNotOverpaid`) doit retrancher les remboursements ; `addPayment` et `sellPackage` doivent persister `createdByUserId`.

- [ ] **Step 1: Écrire les tests qui échouent** — ajouter dans `backend/src/services/__tests__/reservation.service.test.ts`, à l'intérieur du `describe('addPayment'...)` existant (lire le fichier pour le `beforeEach` qui pose `prismaMock.$transaction`) :

```typescript
  it('persiste createdByUserId quand fourni', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue({
      id: 'r1', totalPrice: new Prisma.Decimal(20), type: 'COURT',
      startTime: new Date(), endTime: new Date(),
      resource: { clubId: 'club-1', price: new Prisma.Decimal(20), offPeakPrice: null, club: { offPeakHours: null, timezone: 'Europe/Paris' } },
    } as any);
    prismaMock.payment.aggregate.mockResolvedValue({ _sum: { amount: new Prisma.Decimal(0) } } as any);
    prismaMock.refund.aggregate.mockResolvedValue({ _sum: { amount: new Prisma.Decimal(0) } } as any);
    prismaMock.payment.create.mockResolvedValue({ id: 'pay-1' } as any);

    await service.addPayment({ reservationId: 'r1', clubId: 'club-1', amount: 10, method: 'CASH', createdByUserId: 'staff-9' });
    expect(prismaMock.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ createdByUserId: 'staff-9' }),
    }));
  });

  it('plafond NET : un remboursement rouvre du dû encaissable', async () => {
    // Dû 20 € ; déjà encaissé 20 € ; remboursé 8 € → encaissable = 8 €. Encaisser 8 € passe.
    prismaMock.reservation.findUnique.mockResolvedValue({
      id: 'r1', totalPrice: new Prisma.Decimal(20), type: 'COURT',
      startTime: new Date(), endTime: new Date(),
      resource: { clubId: 'club-1', price: new Prisma.Decimal(20), offPeakPrice: null, club: { offPeakHours: null, timezone: 'Europe/Paris' } },
    } as any);
    prismaMock.payment.aggregate.mockResolvedValue({ _sum: { amount: new Prisma.Decimal(20) } } as any);
    prismaMock.refund.aggregate.mockResolvedValue({ _sum: { amount: new Prisma.Decimal(8) } } as any);
    prismaMock.payment.create.mockResolvedValue({ id: 'pay-2' } as any);

    await expect(service.addPayment({ reservationId: 'r1', clubId: 'club-1', amount: 8, method: 'CASH' }))
      .resolves.toBeDefined();
    await expect(service.addPayment({ reservationId: 'r1', clubId: 'club-1', amount: 9, method: 'CASH' }))
      .rejects.toThrow('PAYMENT_EXCEEDS_DUE');
  });
```

> NB : si le `describe('addPayment')` existant ne pose pas déjà `prismaMock.refund.aggregate`, l'ajouter dans son `beforeEach` (défaut `{ _sum: { amount: new Prisma.Decimal(0) } }`) pour ne pas casser les tests existants. Lire le fichier avant d'éditer.

- [ ] **Step 2: Lancer → échec** (`createdByUserId` non passé / refund.aggregate non appelé).

Run : `npm test -- reservation.service`
Expected: FAIL.

- [ ] **Step 3: Modifier `addPayment`** dans `backend/src/services/reservation.service.ts` :

(a) Ajouter `createdByUserId?: string;` au type des `params` (après `participantId?: string;`, ligne 904).

(b) Rendre `assertNotOverpaid` NET — remplacer le corps (lignes 958-963) par :

```typescript
    const assertNotOverpaid = async (tx: Prisma.TransactionClient) => {
      if (dueCents <= 0) return;
      const [paidAgg, refundAgg] = await Promise.all([
        tx.payment.aggregate({ _sum: { amount: true }, where: overpaidWhere }),
        tx.refund.aggregate({ _sum: { amount: true }, where: { payment: overpaidWhere } }),
      ]);
      const paidCents = Math.round(num(paidAgg._sum.amount) * 100) - Math.round(num(refundAgg._sum.amount) * 100);
      if (paidCents + amountCents > dueCents) throw new Error('PAYMENT_EXCEEDS_DUE');
    };
```

(c) Ajouter `createdByUserId` à l'objet `base` (après `voucherStatus`, ligne 975) :

```typescript
      createdByUserId: params.createdByUserId ?? null,
```

- [ ] **Step 4: Modifier `sellPackage`** dans `backend/src/services/package.service.ts` :

(a) Ajouter `createdByUserId?: string;` au type `body` de `sellPackage` (après `voucherIssuer?: string;`, ligne 77).

(b) Ajouter `createdByUserId: body.createdByUserId ?? null,` dans le `data` du `tx.payment.create` (après `voucherStatus`, ligne 116).

- [ ] **Step 5: Lancer → vert.**

Run : `npm test -- reservation.service package.service`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add backend/src/services/reservation.service.ts backend/src/services/package.service.ts backend/src/services/__tests__/reservation.service.test.ts
git commit -m "feat(caisse): plafond net des remboursements + audit createdByUserId"
```

---

## Task 4: Endpoint de remboursement + câblage audit (route)

**Files:**
- Modify: `backend/src/routes/admin.ts`

- [ ] **Step 1: Importer le service** — en tête de `admin.ts` (après la ligne 16) :

```typescript
import { RefundService } from '../services/refund.service';
```

et instancier (après la ligne 27) :

```typescript
const refundService = new RefundService();
```

- [ ] **Step 2: Étendre `ERROR_STATUS`** (bloc lignes 32-61) — ajouter :

```typescript
  REFUND_EXCEEDS_PAID:    409,
  ALREADY_REFUNDED:       409,
```

- [ ] **Step 3: Câbler `createdByUserId`** dans les 2 routes d'encaissement existantes :

Dans `POST /reservations/:id/payments` (l'appel `reservationService.addPayment({…})`, ligne 332), ajouter le champ :

```typescript
      createdByUserId: req.user!.id,
```

Dans `POST /members/:userId/packages` (ligne 489), passer l'audit au body :

```typescript
  try { res.status(201).json(await packageService.sellPackage(req.membership!.clubId, asString(req.params.userId), { ...req.body, createdByUserId: req.user!.id })); } catch (e) { handleError(e, res, next); }
```

- [ ] **Step 4: Ajouter la route de remboursement** — juste après la route `POST /reservations/:id/payments` (après la ligne 344) :

```typescript
// Remboursement / correction d'un encaissement (total ou partiel).
router.post('/payments/:paymentId/refunds', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const { amount, reason, method } = req.body;
    const refund = await refundService.refund({
      paymentId: asString(req.params.paymentId),
      clubId: req.membership!.clubId,
      amount: Number(amount),
      reason: typeof reason === 'string' ? reason : undefined,
      method: typeof method === 'string' ? method : undefined,
      createdByUserId: req.user!.id,
    });
    res.status(201).json(refund);
  } catch (err) { handleError(err, res, next); }
});
```

> Vérifier que `req.user` est typé sur `ClubScopedRequest` (sinon `req.user!.id` peut nécessiter un cast — lire `middleware/requireClubMember.ts` et `middleware/auth.ts`). Si `ClubScopedRequest` n'expose pas `user`, utiliser `(req as any).user.id` ou étendre le type ; préférer l'extension de type propre.

- [ ] **Step 5: Vérifier le typecheck.**

Run (depuis `backend/`) : `npx tsc --noEmit` puis `npm test`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add backend/src/routes/admin.ts
git commit -m "feat(api): POST refunds + audit createdByUserId sur les encaissements"
```

---

## Task 5: Helpers caisse front — validation + net des remboursements (TDD)

**Files:**
- Modify: `frontend/lib/caisse.ts`
- Test: `frontend/__tests__/caisse.test.ts`

But : exposer `validatePaymentAmount` (borner l'input à encaisser) et faire que `paymentDots` (et le « payé ») tiennent compte du remboursé. Le `paidAmount` exposé par le backend reste brut ; on introduit `refundedAmount` côté résa pour calculer le net.

- [ ] **Step 1: Écrire les tests qui échouent** — ajouter dans `frontend/__tests__/caisse.test.ts` :

```typescript
import { validatePaymentAmount } from '@/lib/caisse';

describe('validatePaymentAmount', () => {
  it('refuse 0, négatif, NaN', () => {
    expect(validatePaymentAmount(0, 1000)).toBe(false);
    expect(validatePaymentAmount(-5, 1000)).toBe(false);
    expect(validatePaymentAmount(NaN, 1000)).toBe(false);
  });
  it('accepte un montant dans le reste dû', () => {
    expect(validatePaymentAmount(1000, 1000)).toBe(true);
    expect(validatePaymentAmount(500, 1000)).toBe(true);
  });
  it('refuse un dépassement du reste dû', () => {
    expect(validatePaymentAmount(1001, 1000)).toBe(false);
  });
  it('autorise tout montant > 0 si le reste dû est inconnu (0 = pas de plafond)', () => {
    expect(validatePaymentAmount(5000, 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Lancer → échec** (`validatePaymentAmount` non exporté).

Run (depuis `frontend/`) : `npm test -- caisse`
Expected: FAIL.

- [ ] **Step 3: Implémenter** — ajouter à la fin de `frontend/lib/caisse.ts` :

```typescript
/**
 * Le montant (centimes) à encaisser est-il valide ? > 0 et, si un plafond
 * `remainingCents` est fourni (> 0), n'excède pas le reste dû. `remainingCents`
 * = 0 → pas de plafond (événement libre).
 */
export function validatePaymentAmount(cents: number, remainingCents: number): boolean {
  if (!Number.isFinite(cents) || cents <= 0) return false;
  if (remainingCents > 0 && cents > remainingCents) return false;
  return true;
}
```

- [ ] **Step 4: Lancer → vert.**

Run : `npm test -- caisse`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add frontend/lib/caisse.ts frontend/__tests__/caisse.test.ts
git commit -m "feat(front): validatePaymentAmount (bornage du montant a encaisser)"
```

---

## Task 6: Types API + UI « Rembourser / corriger »

**Files:**
- Modify: `frontend/lib/api.ts`
- Modify: `frontend/app/admin/caisse/page.tsx` (priorité) et/ou `frontend/app/admin/planning/page.tsx`

> Ces fichiers sont volumineux et spécifiques. **Lire chaque fichier avant de l'éditer** ; suivre les patterns existants (`api.*` fetch, `ConfirmDialog`, état React, libellés FR). Pas de placeholders à l'exécution : écrire le vrai code après lecture.

- [ ] **Step 1: Types + appel API** dans `frontend/lib/api.ts` : ajouter le type `Refund` (`id, paymentId, amount, reason?, method, createdAt`), ajouter `status` et `refundedAmount` au type `Payment` existant, et la fonction :

```typescript
// (dans l'objet api / le module, suivant le style existant des autres appels)
async refundPayment(clubId: string, paymentId: string, body: { amount: number; reason?: string; method?: string }, token: string) {
  return apiFetch(`/api/clubs/${clubId}/admin/payments/${paymentId}/refunds`, {
    method: 'POST', token, body: JSON.stringify(body),
  });
}
```

> Adapter `apiFetch`/la signature au helper réel du fichier (lire `api.ts` : certains appels prennent `(path, { method, token, body })`, d'autres un client typé). Respecter l'existant.

- [ ] **Step 2: UI remboursement** dans `frontend/app/admin/caisse/page.tsx` : pour chaque encaissement de la liste du jour, ajouter un bouton « Rembourser / corriger » (masqué si `status === 'REFUNDED'`) ouvrant un dialog (montant prérempli au remboursable = `amount − refundedAmount`, motif optionnel) qui appelle `api.refundPayment(...)` puis recharge le récap. Afficher le remboursé (`refundedAmount`) et le statut sur la ligne.

- [ ] **Step 3: (Option) Bornage du montant** dans `frontend/app/admin/planning/page.tsx` (panneau « Encaisser ») : importer `validatePaymentAmount` et désactiver le bouton d'encaissement (et bord rouge) quand `!validatePaymentAmount(saisiCents, resteDûCents)`. Confirmer le comportement existant avant d'éditer.

- [ ] **Step 4: Tests front** (si un test de page existe pour la caisse, ajouter un cas « clic Rembourser → api.refundPayment appelé »). Sinon, la couverture du helper (Task 5) suffit pour cette phase.

Run (depuis `frontend/`) : `npm test`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add frontend/lib/api.ts frontend/app/admin/caisse/page.tsx frontend/app/admin/planning/page.tsx frontend/__tests__
git commit -m "feat(front): action Rembourser / corriger + bornage du montant en caisse"
```

---

## Vérification de bout en bout

1. **Tests** — `cd backend && npm test` (vert) ; `cd frontend && npm test` (vert) ; `cd backend && npx tsc --noEmit`.
2. **Migration** — Docker up, `cd backend && npx prisma migrate deploy` applique `add_payment_status_refund_audit` sans erreur ; les paiements existants sont `CAPTURED`, `refunded_amount = 0`.
3. **Manuel** — back (`npm run dev` :3001) + front (:3000) :
   - encaisser 25 € sur une résa au planning → caisse du jour montre 25 € ;
   - « Rembourser / corriger » 10 € → le paiement passe `PARTIALLY_REFUNDED`, la caisse nette doit refléter 15 € (selon l'affichage choisi) ;
   - un encaissement payé par **carnet** puis remboursé → le solde du carnet du joueur **réaugmente** de 1 entrée (vérifier via `GET /api/clubs/:slug/me/packages`) ;
   - tenter de rembourser plus que le payé → 409 `REFUND_EXCEEDS_PAID`.
4. Sanity : `curl http://localhost:3001/health`.

## Notes de séquencement
- Tâches 1→4 strictement backend (indépendantes du front) ; 5→6 front. 6 peut être affinée après coup.
- Tout est additif : aucune rupture sur la caisse existante. Le plafond `addPayment` ne change de valeur que s'il existe des `Refund` (jusque-là `sum(refunds)=0` ⇒ comportement identique).
- Prochaine phase (2 — remboursement auto à l'annulation) réutilise `RefundService.refund` créé ici.
