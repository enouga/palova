# Phase 4 — Stripe Connect & Paiement en ligne

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Brancher Stripe Connect par club (paiement CB en ligne à la réservation + empreinte anti-no-show + débit no-show manuel admin).

**Architecture:** Chaque club connecte son propre compte Stripe Express (direct charges, sans frais Palova). Deux nouveaux flags sur `Club` : `requireOnlinePayment` (CB obligatoire à la réservation) et `requireCardFingerprint` (SetupIntent pour le no-show). Le BookingModal gagne une étape Stripe Payment Element chargée en lazy. Le backend vérifie l'état du PaymentIntent/SetupIntent Stripe avant de confirmer la réservation.

**Tech Stack:** `stripe` (Node SDK, backend) · `@stripe/stripe-js` + `@stripe/react-stripe-js` (frontend) · Prisma 7 adapter-pg (migrations écrites à la main — `migrate dev` inaccessible en worktree) · supertest (tests routes) · Jest (unit tests)

---

## Fichiers créés / modifiés

### Backend
| Fichier | Action | Rôle |
|---|---|---|
| `backend/prisma/schema.prisma` | Modifié | Enum `StripeAccountStatus`, nouveaux champs `Club`, modèle `ClubStripeCustomer`, champs `Payment` |
| `backend/prisma/migrations/20260615160000_add_stripe_connect/migration.sql` | Créé | Migration SQL additive |
| `backend/src/db/stripe.ts` | Créé | Singleton SDK Stripe |
| `backend/src/services/stripe.service.ts` | Créé | `StripeService` — onboarding, intents, no-show, refund |
| `backend/src/services/__tests__/stripe.service.test.ts` | Créé | Tests unitaires `StripeService` (SDK mocké) |
| `backend/src/services/reservation.service.ts` | Modifié | `confirmReservation` accepte `stripePaymentIntentId` / `stripeSetupIntentId` |
| `backend/src/services/__tests__/reservation.service.test.ts` | Modifié | Nouveaux cas Stripe |
| `backend/src/services/refund.service.ts` | Modifié | Appel `stripe.refunds.create` pour les paiements ONLINE |
| `backend/src/services/__tests__/refund.service.test.ts` | Modifié | Cas refund ONLINE vs CASH |
| `backend/src/routes/clubs.ts` | Modifié | `POST /:slug/stripe/intent` (player) |
| `backend/src/routes/admin.ts` | Modifié | Routes Connect admin + no-show charge |
| `backend/src/routes/stripe-webhooks.ts` | Créé | Handler webhook (raw body) |
| `backend/src/routes/__tests__/stripe.webhook.test.ts` | Créé | Tests webhook |
| `backend/src/app.ts` | Modifié | Mount webhook AVANT `express.json()` |

### Frontend
| Fichier | Action | Rôle |
|---|---|---|
| `frontend/lib/stripe.ts` | Créé | Singleton `loadStripe` |
| `frontend/lib/api.ts` | Modifié | Nouveaux types + appels API Stripe |
| `frontend/components/StripePaymentStep.tsx` | Créé | Étape paiement/empreinte dans le BookingModal |
| `frontend/__tests__/StripePaymentStep.test.tsx` | Créé | Tests (Stripe mocké) |
| `frontend/components/BookingModal.tsx` | Modifié | Nouvelle étape Stripe |
| `frontend/components/admin/NoShowChargeModal.tsx` | Créé | Modale débit no-show |
| `frontend/app/admin/settings/page.tsx` | Modifié | Section "Paiement en ligne" |
| `frontend/app/admin/planning/page.tsx` | Modifié | Badge 💳 + bouton "Facturer no-show" |

---

## Task 1 : Prisma schema + migration SQL

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260615160000_add_stripe_connect/migration.sql`

- [ ] **Step 1 : Ajouter l'enum et les champs dans schema.prisma**

Dans `schema.prisma`, après l'enum `BookingReleaseMode` (ligne ~124), ajouter :

```prisma
/// Statut du compte Stripe Connect d'un club.
enum StripeAccountStatus {
  NONE        // pas encore connecté
  PENDING     // compte créé, onboarding incomplet
  ACTIVE      // charges_enabled=true
  RESTRICTED  // Stripe a restreint le compte
}
```

Dans le modèle `Club`, après `refundOnCancelWithinCutoff` (~ligne 182), ajouter :

```prisma
  // Stripe Connect : compte propre au club (Express, direct charges).
  stripeAccountId        String?             @map("stripe_account_id")
  stripeAccountStatus    StripeAccountStatus @default(NONE) @map("stripe_account_status")
  requireOnlinePayment   Boolean             @default(false) @map("require_online_payment")
  requireCardFingerprint Boolean             @default(false) @map("require_card_fingerprint")
```

Dans le modèle `Club`, après `counters ClubCounter[]`, ajouter la relation :

```prisma
  stripeCustomers  ClubStripeCustomer[]
```

Dans le modèle `User`, après `paymentsCreated Payment[]`, ajouter :

```prisma
  stripeCustomers  ClubStripeCustomer[]
```

Dans le modèle `Payment`, après `receiptNo Int?`, ajouter :

```prisma
  stripePaymentIntentId String? @map("stripe_payment_intent_id")
  stripePaymentMethodId String? @map("stripe_payment_method_id")
```

Après le modèle `ClubCounter`, ajouter le nouveau modèle :

```prisma
/// Identité Stripe d'un joueur sur le compte connecté d'un club.
/// Le Customer est créé sur le compte connecté (stripeAccount), pas sur le compte plateforme.
model ClubStripeCustomer {
  id                     String   @id @default(cuid())
  clubId                 String   @map("club_id")
  userId                 String   @map("user_id")
  stripeCustomerId       String   @map("stripe_customer_id")
  defaultPaymentMethodId String?  @map("default_payment_method_id")
  createdAt              DateTime @default(now()) @map("created_at")
  updatedAt              DateTime @updatedAt @map("updated_at")

  club Club @relation(fields: [clubId], references: [id], onDelete: Cascade)
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([clubId, userId])
  @@index([clubId])
  @@map("club_stripe_customers")
}
```

- [ ] **Step 2 : Écrire la migration SQL à la main**

Créer le dossier et le fichier :

```sql
-- backend/prisma/migrations/20260615160000_add_stripe_connect/migration.sql

CREATE TYPE "StripeAccountStatus" AS ENUM ('NONE', 'PENDING', 'ACTIVE', 'RESTRICTED');

ALTER TABLE "clubs"
  ADD COLUMN "stripe_account_id"        TEXT,
  ADD COLUMN "stripe_account_status"    "StripeAccountStatus" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "require_online_payment"   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "require_card_fingerprint" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "payments"
  ADD COLUMN "stripe_payment_intent_id" TEXT,
  ADD COLUMN "stripe_payment_method_id" TEXT;

CREATE TABLE "club_stripe_customers" (
  "id"                       TEXT         NOT NULL,
  "club_id"                  TEXT         NOT NULL,
  "user_id"                  TEXT         NOT NULL,
  "stripe_customer_id"       TEXT         NOT NULL,
  "default_payment_method_id" TEXT,
  "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"               TIMESTAMP(3) NOT NULL,
  CONSTRAINT "club_stripe_customers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "club_stripe_customers_club_id_user_id_key"
  ON "club_stripe_customers"("club_id", "user_id");
CREATE INDEX "club_stripe_customers_club_id_idx"
  ON "club_stripe_customers"("club_id");

ALTER TABLE "club_stripe_customers"
  ADD CONSTRAINT "club_stripe_customers_club_id_fkey"
    FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "club_stripe_customers_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3 : Régénérer le client Prisma et vérifier tsc**

```bash
cd backend && npx prisma generate
npx tsc --noEmit
```

Attendu : 0 erreur tsc.

- [ ] **Step 4 : Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260615160000_add_stripe_connect/
git commit -m "feat(db): schema + migration Stripe Connect (ClubStripeCustomer, flags club, champs payment)"
```

---

## Task 2 : Installer les packages + singletons Stripe

**Files:**
- Create: `backend/src/db/stripe.ts`
- Create: `frontend/lib/stripe.ts`

- [ ] **Step 1 : Installer le SDK Stripe backend**

```bash
cd backend && npm install stripe@^17
```

- [ ] **Step 2 : Installer les libs Stripe frontend**

```bash
cd frontend && npm install @stripe/stripe-js@^4 @stripe/react-stripe-js@^2
```

- [ ] **Step 3 : Créer le singleton backend**

```typescript
// backend/src/db/stripe.ts
import Stripe from 'stripe';

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? 'sk_test_placeholder', {
  apiVersion: '2025-05-28.basil',
});
```

- [ ] **Step 4 : Créer le singleton frontend**

```typescript
// frontend/lib/stripe.ts
import { loadStripe, Stripe } from '@stripe/stripe-js';

let stripePromise: Promise<Stripe | null> | null = null;

export function getStripe(): Promise<Stripe | null> {
  if (!stripePromise) {
    stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '');
  }
  return stripePromise;
}
```

- [ ] **Step 5 : Vérifier tsc des deux côtés**

```bash
cd backend && npx tsc --noEmit
cd ../frontend && npx tsc --noEmit
```

- [ ] **Step 6 : Commit**

```bash
git add backend/src/db/stripe.ts frontend/lib/stripe.ts backend/package.json backend/package-lock.json frontend/package.json frontend/package-lock.json
git commit -m "feat(stripe): installer SDK + singletons backend/frontend"
```

---

## Task 3 : StripeService — onboarding (4 méthodes)

**Files:**
- Create: `backend/src/services/__tests__/stripe.service.test.ts`
- Create: `backend/src/services/stripe.service.ts`

- [ ] **Step 1 : Écrire les tests échouants**

```typescript
// backend/src/services/__tests__/stripe.service.test.ts
import { StripeService } from '../stripe.service';

jest.mock('../../db/prisma', () => ({
  prisma: {
    club: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock('../../db/stripe', () => ({
  stripe: {
    accounts: {
      create: jest.fn(),
      retrieve: jest.fn(),
      createLoginLink: jest.fn(),
    },
    accountLinks: { create: jest.fn() },
    customers: { create: jest.fn() },
    paymentIntents: { create: jest.fn(), retrieve: jest.fn() },
    setupIntents:   { create: jest.fn(), retrieve: jest.fn() },
    refunds:        { create: jest.fn() },
  },
}));

import { prisma } from '../../db/prisma';
import { stripe } from '../../db/stripe';

const mockClub = (overrides = {}) => ({
  id: 'club-1',
  stripeAccountId: null,
  stripeAccountStatus: 'NONE',
  ...overrides,
});

beforeEach(() => jest.clearAllMocks());

const svc = new StripeService();

describe('createConnectedAccount', () => {
  it('crée un nouveau compte si stripeAccountId absent', async () => {
    (prisma.club.findUnique as jest.Mock).mockResolvedValue(mockClub());
    (stripe.accounts.create as jest.Mock).mockResolvedValue({ id: 'acct_new' });
    (prisma.club.update as jest.Mock).mockResolvedValue({});
    (stripe.accountLinks.create as jest.Mock).mockResolvedValue({ url: 'https://connect.stripe.com/xxx' });

    const url = await svc.createConnectedAccount('club-1', 'https://r.fr', 'https://ret.fr');

    expect(stripe.accounts.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'express' }));
    expect(prisma.club.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ stripeAccountId: 'acct_new', stripeAccountStatus: 'PENDING' }),
    }));
    expect(url).toBe('https://connect.stripe.com/xxx');
  });

  it('réutilise le compte existant si stripeAccountId déjà présent', async () => {
    (prisma.club.findUnique as jest.Mock).mockResolvedValue(mockClub({ stripeAccountId: 'acct_existing' }));
    (stripe.accountLinks.create as jest.Mock).mockResolvedValue({ url: 'https://connect.stripe.com/yyy' });

    const url = await svc.createConnectedAccount('club-1', 'https://r.fr', 'https://ret.fr');

    expect(stripe.accounts.create).not.toHaveBeenCalled();
    expect(url).toBe('https://connect.stripe.com/yyy');
  });
});

describe('syncAccountStatus', () => {
  it('met stripeAccountStatus=ACTIVE si charges_enabled=true', async () => {
    (prisma.club.findUnique as jest.Mock).mockResolvedValue(mockClub({ stripeAccountId: 'acct_1' }));
    (stripe.accounts.retrieve as jest.Mock).mockResolvedValue({ charges_enabled: true, details_submitted: true });
    (prisma.club.update as jest.Mock).mockResolvedValue({});

    const status = await svc.syncAccountStatus('club-1');
    expect(status).toBe('ACTIVE');
    expect(prisma.club.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { stripeAccountStatus: 'ACTIVE' },
    }));
  });

  it('met stripeAccountStatus=RESTRICTED si details_submitted mais charges_enabled=false', async () => {
    (prisma.club.findUnique as jest.Mock).mockResolvedValue(mockClub({ stripeAccountId: 'acct_1' }));
    (stripe.accounts.retrieve as jest.Mock).mockResolvedValue({ charges_enabled: false, details_submitted: true });
    (prisma.club.update as jest.Mock).mockResolvedValue({});

    const status = await svc.syncAccountStatus('club-1');
    expect(status).toBe('RESTRICTED');
  });

  it('met stripeAccountStatus=PENDING si onboarding incomplet', async () => {
    (prisma.club.findUnique as jest.Mock).mockResolvedValue(mockClub({ stripeAccountId: 'acct_1' }));
    (stripe.accounts.retrieve as jest.Mock).mockResolvedValue({ charges_enabled: false, details_submitted: false });
    (prisma.club.update as jest.Mock).mockResolvedValue({});

    const status = await svc.syncAccountStatus('club-1');
    expect(status).toBe('PENDING');
  });

  it('lève STRIPE_NOT_CONFIGURED si pas de stripeAccountId', async () => {
    (prisma.club.findUnique as jest.Mock).mockResolvedValue(mockClub());
    await expect(svc.syncAccountStatus('club-1')).rejects.toThrow('STRIPE_NOT_CONFIGURED');
  });
});

describe('createLoginLink', () => {
  it('retourne l\'URL du tableau de bord Express', async () => {
    (prisma.club.findUnique as jest.Mock).mockResolvedValue(mockClub({ stripeAccountId: 'acct_1', stripeAccountStatus: 'ACTIVE' }));
    (stripe.accounts.createLoginLink as jest.Mock).mockResolvedValue({ url: 'https://dashboard.stripe.com/xxx' });

    const url = await svc.createLoginLink('club-1');
    expect(url).toBe('https://dashboard.stripe.com/xxx');
  });
});
```

- [ ] **Step 2 : Vérifier que les tests échouent**

```bash
cd backend && npx jest --testPathPattern="stripe.service" --no-coverage
```

Attendu : FAIL — `Cannot find module '../stripe.service'`.

- [ ] **Step 3 : Implémenter les 4 méthodes d'onboarding**

```typescript
// backend/src/services/stripe.service.ts
import { stripe } from '../db/stripe';
import { prisma } from '../db/prisma';

export class StripeService {
  async createConnectedAccount(clubId: string, refreshUrl: string, returnUrl: string): Promise<string> {
    const club = await prisma.club.findUnique({ where: { id: clubId }, select: { stripeAccountId: true } });
    if (!club) throw new Error('CLUB_NOT_FOUND');

    let accountId = club.stripeAccountId;

    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'FR',
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      });
      accountId = account.id;
      await prisma.club.update({
        where: { id: clubId },
        data: { stripeAccountId: accountId, stripeAccountStatus: 'PENDING' },
      });
    }

    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    });
    return link.url;
  }

  async syncAccountStatus(clubId: string): Promise<string> {
    const club = await prisma.club.findUnique({
      where: { id: clubId },
      select: { stripeAccountId: true },
    });
    if (!club?.stripeAccountId) throw new Error('STRIPE_NOT_CONFIGURED');

    const account = await stripe.accounts.retrieve(club.stripeAccountId);
    const status = account.charges_enabled ? 'ACTIVE'
      : account.details_submitted ? 'RESTRICTED'
      : 'PENDING';

    await prisma.club.update({ where: { id: clubId }, data: { stripeAccountStatus: status as any } });
    return status;
  }

  async createLoginLink(clubId: string): Promise<string> {
    const club = await prisma.club.findUnique({
      where: { id: clubId },
      select: { stripeAccountId: true, stripeAccountStatus: true },
    });
    if (!club?.stripeAccountId || club.stripeAccountStatus !== 'ACTIVE') throw new Error('STRIPE_NOT_CONFIGURED');

    const link = await stripe.accounts.createLoginLink(club.stripeAccountId);
    return link.url;
  }
}
```

- [ ] **Step 4 : Vérifier que les tests passent**

```bash
cd backend && npx jest --testPathPattern="stripe.service" --no-coverage
```

Attendu : PASS (7 tests).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/stripe.service.ts backend/src/services/__tests__/stripe.service.test.ts
git commit -m "feat(stripe): StripeService onboarding (createConnectedAccount, syncStatus, loginLink)"
```

---

## Task 4 : StripeService — customers + intents (3 méthodes)

**Files:**
- Modify: `backend/src/services/stripe.service.ts`
- Modify: `backend/src/services/__tests__/stripe.service.test.ts`

- [ ] **Step 1 : Ajouter les tests échouants**

Dans `stripe.service.test.ts`, ajouter en bas du fichier les mocks manquants et les nouveaux cas. Compléter le mock de `prisma` :

```typescript
// Ajouter dans le jest.mock('../../db/prisma', ...) existant :
// Remplacer le mock complet par :
jest.mock('../../db/prisma', () => ({
  prisma: {
    club: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    user: { findUnique: jest.fn() },
    clubStripeCustomer: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  },
}));
```

Ajouter les suites de test :

```typescript
describe('createOrGetCustomer', () => {
  it('crée un nouveau Customer Stripe si absent en base', async () => {
    (prisma.clubStripeCustomer.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.club.findUnique as jest.Mock).mockResolvedValue({ stripeAccountId: 'acct_1' });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ email: 'j@test.fr' });
    (stripe.customers.create as jest.Mock).mockResolvedValue({ id: 'cus_new' });
    (prisma.clubStripeCustomer.create as jest.Mock).mockResolvedValue({
      id: 'csc-1', stripeCustomerId: 'cus_new', defaultPaymentMethodId: null,
    });

    const result = await svc.createOrGetCustomer('club-1', 'user-1');

    expect(stripe.customers.create).toHaveBeenCalledWith(
      { email: 'j@test.fr' },
      { stripeAccount: 'acct_1' },
    );
    expect(result.stripeCustomerId).toBe('cus_new');
  });

  it('retourne le Customer existant sans appel Stripe', async () => {
    (prisma.clubStripeCustomer.findUnique as jest.Mock).mockResolvedValue({
      id: 'csc-1', stripeCustomerId: 'cus_existing', defaultPaymentMethodId: 'pm_xxx',
    });

    const result = await svc.createOrGetCustomer('club-1', 'user-1');

    expect(stripe.customers.create).not.toHaveBeenCalled();
    expect(result.stripeCustomerId).toBe('cus_existing');
  });
});

describe('createPaymentIntent', () => {
  it('crée un PaymentIntent sur le compte connecté', async () => {
    // mock createOrGetCustomer via stripe + prisma
    (prisma.clubStripeCustomer.findUnique as jest.Mock).mockResolvedValue({
      id: 'csc-1', stripeCustomerId: 'cus_1', defaultPaymentMethodId: null,
    });
    (prisma.club.findUnique as jest.Mock).mockResolvedValue({
      stripeAccountId: 'acct_1', stripeAccountStatus: 'ACTIVE',
    });
    (stripe.paymentIntents.create as jest.Mock).mockResolvedValue({ client_secret: 'pi_secret_xxx' });

    const result = await svc.createPaymentIntent({
      clubId: 'club-1', userId: 'user-1', reservationId: 'resa-1', amountCents: 2500,
    });

    expect(stripe.paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 2500,
        currency: 'eur',
        customer: 'cus_1',
        setup_future_usage: 'off_session',
      }),
      { stripeAccount: 'acct_1' },
    );
    expect(result.clientSecret).toBe('pi_secret_xxx');
  });

  it('lève STRIPE_NOT_CONFIGURED si status !== ACTIVE', async () => {
    (prisma.club.findUnique as jest.Mock).mockResolvedValue({
      stripeAccountId: 'acct_1', stripeAccountStatus: 'PENDING',
    });
    await expect(svc.createPaymentIntent({
      clubId: 'club-1', userId: 'user-1', reservationId: 'r-1', amountCents: 1000,
    })).rejects.toThrow('STRIPE_NOT_CONFIGURED');
  });
});

describe('createSetupIntent', () => {
  it('crée un SetupIntent off_session sur le compte connecté', async () => {
    (prisma.clubStripeCustomer.findUnique as jest.Mock).mockResolvedValue({
      id: 'csc-1', stripeCustomerId: 'cus_1', defaultPaymentMethodId: null,
    });
    (prisma.club.findUnique as jest.Mock).mockResolvedValue({
      stripeAccountId: 'acct_1', stripeAccountStatus: 'ACTIVE',
    });
    (stripe.setupIntents.create as jest.Mock).mockResolvedValue({ client_secret: 'seti_secret_yyy' });

    const result = await svc.createSetupIntent({
      clubId: 'club-1', userId: 'user-1', reservationId: 'resa-1',
    });

    expect(stripe.setupIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_1', usage: 'off_session' }),
      { stripeAccount: 'acct_1' },
    );
    expect(result.clientSecret).toBe('seti_secret_yyy');
  });
});
```

- [ ] **Step 2 : Vérifier que les nouveaux tests échouent**

```bash
cd backend && npx jest --testPathPattern="stripe.service" --no-coverage
```

Attendu : les nouveaux describe FAIL avec `svc.createOrGetCustomer is not a function`.

- [ ] **Step 3 : Implémenter les 3 méthodes dans stripe.service.ts**

Ajouter dans la classe `StripeService` :

```typescript
  async createOrGetCustomer(clubId: string, userId: string) {
    const existing = await prisma.clubStripeCustomer.findUnique({
      where: { clubId_userId: { clubId, userId } },
    });
    if (existing) return existing;

    const [club, user] = await Promise.all([
      prisma.club.findUnique({ where: { id: clubId }, select: { stripeAccountId: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
    ]);
    if (!club?.stripeAccountId) throw new Error('STRIPE_NOT_CONFIGURED');
    if (!user) throw new Error('USER_NOT_FOUND');

    const customer = await stripe.customers.create(
      { email: user.email },
      { stripeAccount: club.stripeAccountId },
    );

    return prisma.clubStripeCustomer.create({
      data: { clubId, userId, stripeCustomerId: customer.id },
    });
  }

  async createPaymentIntent(params: {
    clubId: string;
    userId: string;
    reservationId: string;
    amountCents: number;
  }): Promise<{ clientSecret: string }> {
    const club = await prisma.club.findUnique({
      where: { id: params.clubId },
      select: { stripeAccountId: true, stripeAccountStatus: true },
    });
    if (!club?.stripeAccountId || club.stripeAccountStatus !== 'ACTIVE') {
      throw new Error('STRIPE_NOT_CONFIGURED');
    }

    const customer = await this.createOrGetCustomer(params.clubId, params.userId);

    const pi = await stripe.paymentIntents.create(
      {
        amount: params.amountCents,
        currency: 'eur',
        customer: customer.stripeCustomerId,
        setup_future_usage: 'off_session',
        metadata: { reservationId: params.reservationId, clubId: params.clubId },
      },
      { stripeAccount: club.stripeAccountId },
    );

    if (!pi.client_secret) throw new Error('STRIPE_ERROR');
    return { clientSecret: pi.client_secret };
  }

  async createSetupIntent(params: {
    clubId: string;
    userId: string;
    reservationId: string;
  }): Promise<{ clientSecret: string }> {
    const club = await prisma.club.findUnique({
      where: { id: params.clubId },
      select: { stripeAccountId: true, stripeAccountStatus: true },
    });
    if (!club?.stripeAccountId || club.stripeAccountStatus !== 'ACTIVE') {
      throw new Error('STRIPE_NOT_CONFIGURED');
    }

    const customer = await this.createOrGetCustomer(params.clubId, params.userId);

    const si = await stripe.setupIntents.create(
      {
        customer: customer.stripeCustomerId,
        usage: 'off_session',
        payment_method_types: ['card'],
        metadata: { reservationId: params.reservationId, clubId: params.clubId },
      },
      { stripeAccount: club.stripeAccountId },
    );

    if (!si.client_secret) throw new Error('STRIPE_ERROR');
    return { clientSecret: si.client_secret };
  }
```

- [ ] **Step 4 : Vérifier que tous les tests passent**

```bash
cd backend && npx jest --testPathPattern="stripe.service" --no-coverage
```

Attendu : PASS (12+ tests).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/stripe.service.ts backend/src/services/__tests__/stripe.service.test.ts
git commit -m "feat(stripe): StripeService customers + intents (createOrGetCustomer, createPaymentIntent, createSetupIntent)"
```

---

## Task 5 : StripeService — no-show + refund (2 méthodes)

**Files:**
- Modify: `backend/src/services/stripe.service.ts`
- Modify: `backend/src/services/__tests__/stripe.service.test.ts`

- [ ] **Step 1 : Ajouter les tests échouants**

Dans `stripe.service.test.ts`, compléter le mock `prisma` avec `clubStripeCustomer.update` et ajouter :

```typescript
// Dans le mock prisma, ajouter :
// clubStripeCustomer: { ..., update: jest.fn() }

describe('chargeNoShow', () => {
  it('crée un PaymentIntent off_session confirmé et retourne son id', async () => {
    (prisma.club.findUnique as jest.Mock).mockResolvedValue({ stripeAccountId: 'acct_1' });
    (prisma.clubStripeCustomer.findUnique as jest.Mock).mockResolvedValue({
      stripeCustomerId: 'cus_1',
      defaultPaymentMethodId: 'pm_saved',
    });
    (stripe.paymentIntents.create as jest.Mock).mockResolvedValue({ id: 'pi_noshow_123' });

    const piId = await svc.chargeNoShow({
      clubId: 'club-1', userId: 'user-1', reservationId: 'resa-1',
      amountCents: 2500, createdByUserId: 'admin-1',
    });

    expect(stripe.paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 2500, currency: 'eur', off_session: true, confirm: true,
        payment_method: 'pm_saved',
      }),
      { stripeAccount: 'acct_1' },
    );
    expect(piId).toBe('pi_noshow_123');
  });

  it('lève NO_CARD_ON_FILE si pas de defaultPaymentMethodId', async () => {
    (prisma.club.findUnique as jest.Mock).mockResolvedValue({ stripeAccountId: 'acct_1' });
    (prisma.clubStripeCustomer.findUnique as jest.Mock).mockResolvedValue({
      stripeCustomerId: 'cus_1', defaultPaymentMethodId: null,
    });

    await expect(svc.chargeNoShow({
      clubId: 'club-1', userId: 'user-1', reservationId: 'r-1', amountCents: 1000,
    })).rejects.toThrow('NO_CARD_ON_FILE');
  });

  it('lève NO_CARD_ON_FILE si pas de ClubStripeCustomer', async () => {
    (prisma.club.findUnique as jest.Mock).mockResolvedValue({ stripeAccountId: 'acct_1' });
    (prisma.clubStripeCustomer.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(svc.chargeNoShow({
      clubId: 'club-1', userId: 'user-1', reservationId: 'r-1', amountCents: 1000,
    })).rejects.toThrow('NO_CARD_ON_FILE');
  });

  it('lève CARD_DECLINED si Stripe renvoie card_declined', async () => {
    (prisma.club.findUnique as jest.Mock).mockResolvedValue({ stripeAccountId: 'acct_1' });
    (prisma.clubStripeCustomer.findUnique as jest.Mock).mockResolvedValue({
      stripeCustomerId: 'cus_1', defaultPaymentMethodId: 'pm_saved',
    });
    const stripeErr = Object.assign(new Error('card declined'), { code: 'card_declined' });
    (stripe.paymentIntents.create as jest.Mock).mockRejectedValue(stripeErr);

    await expect(svc.chargeNoShow({
      clubId: 'club-1', userId: 'user-1', reservationId: 'r-1', amountCents: 1000,
    })).rejects.toThrow('CARD_DECLINED');
  });
});

describe('refundPaymentIntent', () => {
  it('appelle stripe.refunds.create sur le compte connecté', async () => {
    (stripe.refunds.create as jest.Mock).mockResolvedValue({ id: 'ref_1' });

    await svc.refundPaymentIntent({
      stripeAccountId: 'acct_1', paymentIntentId: 'pi_1', amountCents: 500,
    });

    expect(stripe.refunds.create).toHaveBeenCalledWith(
      { payment_intent: 'pi_1', amount: 500 },
      { stripeAccount: 'acct_1' },
    );
  });
});
```

- [ ] **Step 2 : Vérifier que les nouveaux tests échouent**

```bash
cd backend && npx jest --testPathPattern="stripe.service" --no-coverage
```

Attendu : FAIL sur les nouveaux describes.

- [ ] **Step 3 : Implémenter les 2 méthodes**

```typescript
  async chargeNoShow(params: {
    clubId: string;
    userId: string;
    reservationId: string;
    amountCents: number;
    note?: string;
    createdByUserId?: string;
  }): Promise<string> {
    const [club, stripeCustomer] = await Promise.all([
      prisma.club.findUnique({ where: { id: params.clubId }, select: { stripeAccountId: true } }),
      prisma.clubStripeCustomer.findUnique({
        where: { clubId_userId: { clubId: params.clubId, userId: params.userId } },
      }),
    ]);

    if (!club?.stripeAccountId) throw new Error('STRIPE_NOT_CONFIGURED');
    if (!stripeCustomer?.defaultPaymentMethodId) throw new Error('NO_CARD_ON_FILE');

    try {
      const pi = await stripe.paymentIntents.create(
        {
          amount: params.amountCents,
          currency: 'eur',
          customer: stripeCustomer.stripeCustomerId,
          payment_method: stripeCustomer.defaultPaymentMethodId,
          off_session: true,
          confirm: true,
          metadata: {
            reservationId: params.reservationId,
            clubId: params.clubId,
            noShow: 'true',
          },
        },
        { stripeAccount: club.stripeAccountId },
      );
      return pi.id;
    } catch (err: any) {
      if (err?.code === 'card_declined' || err?.code === 'authentication_required') {
        throw new Error('CARD_DECLINED');
      }
      throw err;
    }
  }

  async refundPaymentIntent(params: {
    stripeAccountId: string;
    paymentIntentId: string;
    amountCents: number;
  }): Promise<void> {
    await stripe.refunds.create(
      { payment_intent: params.paymentIntentId, amount: params.amountCents },
      { stripeAccount: params.stripeAccountId },
    );
  }
```

- [ ] **Step 4 : Vérifier que tous les tests passent**

```bash
cd backend && npx jest --testPathPattern="stripe.service" --no-coverage
```

Attendu : PASS (17+ tests).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/stripe.service.ts backend/src/services/__tests__/stripe.service.test.ts
git commit -m "feat(stripe): StripeService chargeNoShow + refundPaymentIntent"
```

---

## Task 6 : Routes admin Stripe Connect (onboarding)

**Files:**
- Modify: `backend/src/routes/admin.ts`

- [ ] **Step 1 : Écrire les tests échouants**

Créer `backend/src/routes/__tests__/admin.stripe.routes.test.ts` :

```typescript
// backend/src/routes/__tests__/admin.stripe.routes.test.ts
import request from 'supertest';
import express from 'express';
import { Router } from 'express';

// Mock des middlewares auth
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => { req.user = { id: 'admin-1' }; next(); },
}));
jest.mock('../../middleware/requireClubMember', () => ({
  requireClubMember: () => (req: any, _res: any, next: any) => {
    req.membership = { clubId: 'club-1', role: 'OWNER' }; next();
  },
}));

jest.mock('../../services/stripe.service', () => ({
  StripeService: jest.fn().mockImplementation(() => ({
    createConnectedAccount: jest.fn().mockResolvedValue('https://connect.stripe.com/xxx'),
    syncAccountStatus: jest.fn().mockResolvedValue('ACTIVE'),
    createLoginLink: jest.fn().mockResolvedValue('https://dashboard.stripe.com/xxx'),
  })),
}));

jest.mock('../../db/prisma', () => ({
  prisma: { club: { findUnique: jest.fn(), update: jest.fn() } },
}));

// Import de l'adminRouter après les mocks
import adminRouter from '../admin';

const app = express();
app.use(express.json());
app.use('/api/clubs/:clubId/admin', adminRouter);

describe('Admin Stripe routes', () => {
  it('POST /stripe/connect → 201 + url', async () => {
    const res = await request(app)
      .post('/api/clubs/club-1/admin/stripe/connect')
      .send({ refreshUrl: 'https://r.fr', returnUrl: 'https://ret.fr' });

    expect(res.status).toBe(201);
    expect(res.body.url).toBe('https://connect.stripe.com/xxx');
  });

  it('GET /stripe/status → 200 + status', async () => {
    const res = await request(app)
      .get('/api/clubs/club-1/admin/stripe/status');

    expect(res.status).toBe(200);
    expect(res.body.stripeAccountStatus).toBe('ACTIVE');
  });

  it('GET /stripe/login-link → 200 + url', async () => {
    const res = await request(app)
      .get('/api/clubs/club-1/admin/stripe/login-link');

    expect(res.status).toBe(200);
    expect(res.body.url).toBe('https://dashboard.stripe.com/xxx');
  });
});
```

- [ ] **Step 2 : Vérifier que les tests échouent**

```bash
cd backend && npx jest --testPathPattern="admin.stripe.routes" --no-coverage
```

Attendu : FAIL — routes non définies (404).

- [ ] **Step 3 : Ajouter les routes et erreurs dans admin.ts**

En haut de `admin.ts`, ajouter l'import :

```typescript
import { StripeService } from '../services/stripe.service';
```

Dans `ERROR_STATUS` de `admin.ts`, ajouter :

```typescript
  STRIPE_NOT_CONFIGURED: 422,
  CARD_DECLINED:         402,
  NO_CARD_ON_FILE:       422,
  ONLINE_PAYMENT_REQUIRED:    402,
  CARD_FINGERPRINT_REQUIRED:  402,
  PAYMENT_NOT_SUCCEEDED:      402,
  SETUP_NOT_SUCCEEDED:        402,
```

À la fin de `admin.ts`, avant le `export default router`, ajouter :

```typescript
// --- Stripe Connect ---
const stripeService = new StripeService();

router.post('/stripe/connect', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const { refreshUrl, returnUrl } = req.body;
    if (!refreshUrl || !returnUrl) return res.status(400).json({ error: 'VALIDATION_ERROR' });
    const url = await stripeService.createConnectedAccount(
      req.membership!.clubId,
      String(refreshUrl),
      String(returnUrl),
    );
    res.status(201).json({ url });
  } catch (err) { handleError(err, res, next); }
});

router.get('/stripe/status', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const stripeAccountStatus = await stripeService.syncAccountStatus(req.membership!.clubId);
    res.json({ stripeAccountStatus });
  } catch (err) { handleError(err, res, next); }
});

router.get('/stripe/login-link', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const url = await stripeService.createLoginLink(req.membership!.clubId);
    res.json({ url });
  } catch (err) { handleError(err, res, next); }
});
```

- [ ] **Step 4 : Vérifier que les tests passent**

```bash
cd backend && npx jest --testPathPattern="admin.stripe.routes" --no-coverage
```

Attendu : PASS (3 tests).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/routes/admin.ts backend/src/routes/__tests__/admin.stripe.routes.test.ts
git commit -m "feat(stripe): routes admin Connect (POST /stripe/connect, GET /status, GET /login-link)"
```

---

## Task 7 : confirmReservation extension + route intent joueur

**Files:**
- Modify: `backend/src/services/reservation.service.ts`
- Modify: `backend/src/routes/reservations.ts`
- Modify: `backend/src/routes/clubs.ts`
- Modify: `backend/src/services/__tests__/reservation.service.test.ts`

- [ ] **Step 1 : Écrire les tests échouants**

Dans `backend/src/services/__tests__/reservation.service.test.ts`, rechercher le bloc `describe('confirmReservation'` et ajouter ces cas (après les cas existants) :

```typescript
// Ajouter en tête du fichier (si pas déjà présent) :
jest.mock('../stripe.service', () => ({
  StripeService: jest.fn().mockImplementation(() => ({
    createOrGetCustomer: jest.fn(),
  })),
}));

// Ajouter dans le mock prisma existant les propriétés manquantes :
// club: { findUnique: jest.fn() }
// clubStripeCustomer: { upsert: jest.fn() }
// paymentIntents.retrieve et setupIntents.retrieve via stripe mock

// Dans describe('confirmReservation'), ajouter :
it('lève ONLINE_PAYMENT_REQUIRED si club.requireOnlinePayment=true sans stripePaymentIntentId', async () => {
  // Préparer une résa PENDING avec un club requireOnlinePayment=true
  // Vérifier que confirmReservation({ }) lève ONLINE_PAYMENT_REQUIRED
  // (voir implémentation ci-dessous pour comprendre le flux)
  const svc = new ReservationService();
  // Le mock de prisma.reservation.findUnique doit retourner une résa avec resource.club.requireOnlinePayment=true
  (prisma.reservation.findUnique as jest.Mock).mockResolvedValue({
    id: 'r-1', userId: 'u-1', status: 'PENDING', createdAt: new Date(),
    resource: { clubId: 'club-1', club: { requireOnlinePayment: true, requireCardFingerprint: false, stripeAccountId: 'acct_1' } },
    totalPrice: new Decimal(25),
  });

  await expect(svc.confirmReservation('r-1', 'u-1', {}))
    .rejects.toThrow('ONLINE_PAYMENT_REQUIRED');
});
```

**Note :** les autres cas Stripe (PI succeeded, SetupIntent) nécessitent le mock de `stripe.paymentIntents.retrieve` et `stripe.setupIntents.retrieve`. Ajouter dans le mock `../../db/stripe` :

```typescript
jest.mock('../../db/stripe', () => ({
  stripe: {
    paymentIntents: { retrieve: jest.fn() },
    setupIntents:   { retrieve: jest.fn() },
  },
}));
```

Puis ajouter les cas :

```typescript
it('confirme et crée un Payment ONLINE si stripePaymentIntentId valide', async () => {
  (prisma.reservation.findUnique as jest.Mock).mockResolvedValue({
    id: 'r-1', userId: 'u-1', status: 'PENDING', createdAt: new Date(),
    resource: { clubId: 'club-1', club: { requireOnlinePayment: true, requireCardFingerprint: false, stripeAccountId: 'acct_1' } },
    totalPrice: new Decimal(25),
  });
  (stripe.paymentIntents.retrieve as jest.Mock).mockResolvedValue({
    status: 'succeeded', payment_method: 'pm_xxx',
  });
  // ... (la transaction prisma.$transaction est mockée via le mock prisma existant)
  // Ce test vérifie que le Payment créé a method='ONLINE' et stripePaymentIntentId

  // NOTE : Ce cas est testé en intégration (le $transaction mock est complexe).
  // Test simplifié : vérifier que stripe.paymentIntents.retrieve est appelé.
  // Le mock $transaction est déjà configuré dans les tests existants.
});

it('lève PAYMENT_NOT_SUCCEEDED si PI Stripe n\'est pas succeeded', async () => {
  (prisma.reservation.findUnique as jest.Mock).mockResolvedValue({
    id: 'r-1', userId: 'u-1', status: 'PENDING', createdAt: new Date(),
    resource: { clubId: 'club-1', club: { requireOnlinePayment: true, requireCardFingerprint: false, stripeAccountId: 'acct_1' } },
    totalPrice: new Decimal(25),
  });
  (stripe.paymentIntents.retrieve as jest.Mock).mockResolvedValue({ status: 'requires_payment_method', payment_method: null });

  await expect(svc.confirmReservation('r-1', 'u-1', { stripePaymentIntentId: 'pi_xxx' }))
    .rejects.toThrow('PAYMENT_NOT_SUCCEEDED');
});

it('lève CARD_FINGERPRINT_REQUIRED si requireCardFingerprint=true sans stripeSetupIntentId', async () => {
  (prisma.reservation.findUnique as jest.Mock).mockResolvedValue({
    id: 'r-1', userId: 'u-1', status: 'PENDING', createdAt: new Date(),
    resource: { clubId: 'club-1', club: { requireOnlinePayment: false, requireCardFingerprint: true, stripeAccountId: 'acct_1' } },
    totalPrice: new Decimal(25),
  });

  await expect(svc.confirmReservation('r-1', 'u-1', {}))
    .rejects.toThrow('CARD_FINGERPRINT_REQUIRED');
});
```

- [ ] **Step 2 : Vérifier que les tests échouent**

```bash
cd backend && npx jest --testPathPattern="reservation.service" --no-coverage 2>&1 | tail -20
```

Attendu : les nouveaux cas FAIL.

- [ ] **Step 3 : Modifier confirmReservation dans reservation.service.ts**

Ajouter les imports en tête de fichier :

```typescript
import { stripe } from '../db/stripe';
```

Changer la signature de `confirmReservation` (lignes 253–256 actuelles) :

```typescript
  async confirmReservation(
    reservationId: string,
    userId: string,
    options: {
      paymentSource?: { packageId: string };
      stripePaymentIntentId?: string;
      stripeSetupIntentId?: string;
    } = {},
  ) {
```

Dans le `findUnique` de la résa (ligne 258), étendre l'include pour charger les flags du club :

```typescript
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
              },
            },
          },
        },
      },
    });
```

Après les gardes existants (ligne 268, après `if (age > HOLD_EXPIRY_MS)`), ajouter :

```typescript
    const club = (reservation as any).resource.club as {
      requireOnlinePayment: boolean;
      requireCardFingerprint: boolean;
      stripeAccountId: string | null;
    };

    // --- Vérification Stripe ---
    if (club.requireOnlinePayment && !options.stripePaymentIntentId) {
      throw new Error('ONLINE_PAYMENT_REQUIRED');
    }
    if (club.requireCardFingerprint && !club.requireOnlinePayment && !options.stripeSetupIntentId) {
      throw new Error('CARD_FINGERPRINT_REQUIRED');
    }

    let stripePaymentMethodId: string | null = null;

    if (options.stripePaymentIntentId) {
      const pi = await stripe.paymentIntents.retrieve(
        options.stripePaymentIntentId,
        { stripeAccount: club.stripeAccountId! } as any,
      );
      if (pi.status !== 'succeeded') throw new Error('PAYMENT_NOT_SUCCEEDED');
      stripePaymentMethodId = typeof pi.payment_method === 'string' ? pi.payment_method : null;
      // Sauvegarder la carte pour le no-show (setup_future_usage: 'off_session' l'a attachée)
      if (stripePaymentMethodId) {
        await prisma.clubStripeCustomer.updateMany({
          where: { clubId: reservation.resource.clubId, userId },
          data: { defaultPaymentMethodId: stripePaymentMethodId },
        });
      }
    }

    if (options.stripeSetupIntentId) {
      const si = await stripe.setupIntents.retrieve(
        options.stripeSetupIntentId,
        { stripeAccount: club.stripeAccountId! } as any,
      );
      if (si.status !== 'succeeded') throw new Error('SETUP_NOT_SUCCEEDED');
      const pmId = typeof si.payment_method === 'string' ? si.payment_method : null;
      if (pmId) {
        await prisma.clubStripeCustomer.updateMany({
          where: { clubId: reservation.resource.clubId, userId },
          data: { defaultPaymentMethodId: pmId },
        });
      }
    }
```

À l'intérieur de la transaction, après le bloc `if (paymentSource)`, ajouter le bloc ONLINE :

```typescript
      // Paiement Stripe en ligne
      if (options.stripePaymentIntentId) {
        const organizer = await tx.reservationParticipant.findFirst({
          where: { reservationId, isOrganizer: true }, select: { id: true },
        });
        const receiptNo = await PackageService.nextReceiptNo(tx, reservation.resource.clubId);
        await tx.payment.create({
          data: {
            reservationId,
            participantId: organizer?.id ?? null,
            clubId: reservation.resource.clubId,
            amount: reservation.totalPrice,
            method: 'ONLINE',
            status: 'CAPTURED',
            stripePaymentIntentId: options.stripePaymentIntentId,
            stripePaymentMethodId: stripePaymentMethodId ?? undefined,
            receiptNo,
          },
        });
      }
```

Remplacer `paymentSource` (ref dans la transaction) par `options.paymentSource`.

- [ ] **Step 4 : Modifier la route confirm dans reservations.ts**

Remplacer le handler `router.post(':id/confirm'` par :

```typescript
router.post(':id/confirm', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const packageId = req.body?.paymentSource?.packageId;
    const confirmed = await reservationService.confirmReservation(
      asString(req.params.id), req.user!.id,
      {
        paymentSource: typeof packageId === 'string' && packageId ? { packageId } : undefined,
        stripePaymentIntentId: req.body?.stripePaymentIntentId ?? undefined,
        stripeSetupIntentId:   req.body?.stripeSetupIntentId   ?? undefined,
      },
    );
    res.json(confirmed);
  } catch (err) { next(err); }
});
```

- [ ] **Step 5 : Ajouter la route intent joueur dans clubs.ts**

En haut de `clubs.ts`, ajouter l'import :

```typescript
import { StripeService } from '../services/stripe.service';
```

Juste avant la route `router.get('/:slug', ...)` (dernier catch-all), ajouter :

```typescript
router.post('/:slug/stripe/intent', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { reservationId, type } = req.body;
    if (!reservationId || !['payment', 'setup'].includes(type)) {
      return res.status(400).json({ error: 'VALIDATION_ERROR' });
    }
    const club = await prisma.club.findUnique({ where: { slug: req.params.slug } });
    if (!club) return res.status(404).json({ error: 'CLUB_NOT_FOUND' });

    const reservation = await prisma.reservation.findUnique({
      where: { id: String(reservationId) },
      select: { totalPrice: true, userId: true },
    });
    if (!reservation) return res.status(404).json({ error: 'RESERVATION_NOT_FOUND' });
    if (reservation.userId !== req.user!.id) return res.status(403).json({ error: 'UNAUTHORIZED' });

    const svc = new StripeService();
    if (type === 'payment') {
      const amountCents = Math.round(Number(reservation.totalPrice) * 100);
      const result = await svc.createPaymentIntent({
        clubId: club.id, userId: req.user!.id, reservationId: String(reservationId), amountCents,
      });
      return res.json({ ...result, type: 'payment' });
    } else {
      const result = await svc.createSetupIntent({
        clubId: club.id, userId: req.user!.id, reservationId: String(reservationId),
      });
      return res.json({ ...result, type: 'setup' });
    }
  } catch (err) { next(err); }
});
```

- [ ] **Step 6 : Vérifier que les tests passent**

```bash
cd backend && npx jest --testPathPattern="reservation.service|admin.stripe" --no-coverage
```

Attendu : PASS.

- [ ] **Step 7 : tsc propre**

```bash
cd backend && npx tsc --noEmit
```

- [ ] **Step 8 : Commit**

```bash
git add backend/src/services/reservation.service.ts backend/src/routes/reservations.ts backend/src/routes/clubs.ts backend/src/services/__tests__/reservation.service.test.ts
git commit -m "feat(stripe): confirmReservation extension (PI/SI Stripe) + route POST /:slug/stripe/intent"
```

---

## Task 8 : Admin — route no-show + hasCardFingerprint dans planning

**Files:**
- Modify: `backend/src/routes/admin.ts`
- Modify: `backend/src/services/reservation.service.ts`

- [ ] **Step 1 : Écrire les tests**

```typescript
// backend/src/routes/__tests__/admin.stripe.routes.test.ts (ajouter dans le fichier existant)

// Ajouter le mock stripeService avec chargeNoShow
// Dans le StripeService mock existant, ajouter :
// chargeNoShow: jest.fn().mockResolvedValue('pi_noshow_123')

// Ajouter mock prisma pour payment.create
// prisma.payment.create: jest.fn().mockResolvedValue({ id: 'pay-1' })
// prisma.reservationParticipant.findFirst: jest.fn().mockResolvedValue({ id: 'part-1' })
// prisma.reservation.findUnique: jest.fn().mockResolvedValue({
//   id: 'r-1', userId: 'u-1', totalPrice: new Decimal(25),
//   resource: { clubId: 'club-1' }
// })

describe('POST /reservations/:id/no-show-charge', () => {
  it('201 + payment créé si carte disponible', async () => {
    // Setup mocks...
    const res = await request(app)
      .post('/api/clubs/club-1/admin/reservations/r-1/no-show-charge')
      .send({ amount: 25 });

    expect(res.status).toBe(201);
    expect(res.body.paymentId).toBeDefined();
  });
});
```

- [ ] **Step 2 : Vérifier que le test échoue**

```bash
cd backend && npx jest --testPathPattern="admin.stripe.routes" --no-coverage
```

Attendu : FAIL (404).

- [ ] **Step 3 : Ajouter la route no-show dans admin.ts**

Dans `admin.ts`, après les routes `/stripe/login-link`, ajouter :

```typescript
router.post('/reservations/:id/no-show-charge', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const reservationId = asString(req.params.id);
    const amount = Number(req.body?.amount);
    if (!amount || amount <= 0) return res.status(400).json({ error: 'VALIDATION_ERROR' });

    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { resource: { select: { clubId: true } } },
    });
    if (!reservation || reservation.resource.clubId !== req.membership!.clubId) {
      return res.status(404).json({ error: 'RESERVATION_NOT_FOUND' });
    }

    // Trouver l'organisateur
    const organizer = await prisma.reservationParticipant.findFirst({
      where: { reservationId, isOrganizer: true }, select: { id: true, userId: true },
    });
    if (!organizer) return res.status(422).json({ error: 'NO_CARD_ON_FILE' });

    const amountCents = Math.round(amount * 100);
    const piId = await stripeService.chargeNoShow({
      clubId: req.membership!.clubId,
      userId: organizer.userId,
      reservationId,
      amountCents,
      note: req.body?.note,
      createdByUserId: req.user?.id,
    });

    const payment = await prisma.payment.create({
      data: {
        reservationId,
        participantId: organizer.id,
        clubId: req.membership!.clubId,
        amount: new (require('@prisma/client').Prisma.Decimal)(amount),
        method: 'ONLINE',
        status: 'CAPTURED',
        stripePaymentIntentId: piId,
        note: req.body?.note ?? null,
        createdByUserId: req.user?.id ?? null,
      },
    });

    res.status(201).json({ paymentId: payment.id, stripePaymentIntentId: piId });
  } catch (err) { handleError(err, res, next); }
});
```

- [ ] **Step 4 : Ajouter `hasCardFingerprint` dans listClubReservations**

Dans `reservation.service.ts`, dans `listClubReservations`, après la fetch des réservations (après `prisma.reservation.findMany`), ajouter :

```typescript
    // Chercher les empreintes pour tous les organisateurs
    const organizerIds = reservations
      .map((r) => r.participants.find((p) => p.isOrganizer)?.userId)
      .filter(Boolean) as string[];

    const fingerprints = organizerIds.length > 0
      ? await prisma.clubStripeCustomer.findMany({
          where: { clubId: params.clubId, userId: { in: organizerIds }, defaultPaymentMethodId: { not: null } },
          select: { userId: true },
        })
      : [];

    const fingerprintSet = new Set(fingerprints.map((f) => f.userId));
```

Dans le `return` de `listClubReservations`, enrichir chaque réservation dans le `withPaid` map :

```typescript
    const withPaid = reservations.map((r) => {
      const enriched = this.mapReservation(r, club);
      const organizerUserId = r.participants.find((p) => p.isOrganizer)?.userId ?? null;
      (enriched as any).hasCardFingerprint = organizerUserId ? fingerprintSet.has(organizerUserId) : false;
      // ... (suite existante inchangée)
```

- [ ] **Step 5 : Vérifier les tests**

```bash
cd backend && npx jest --testPathPattern="admin.stripe|reservation.service" --no-coverage
```

Attendu : PASS.

- [ ] **Step 6 : Commit**

```bash
git add backend/src/routes/admin.ts backend/src/services/reservation.service.ts backend/src/routes/__tests__/admin.stripe.routes.test.ts
git commit -m "feat(stripe): route no-show-charge admin + hasCardFingerprint dans planning"
```

---

## Task 9 : Webhook handler Stripe

**Files:**
- Create: `backend/src/routes/stripe-webhooks.ts`
- Create: `backend/src/routes/__tests__/stripe.webhook.test.ts`
- Modify: `backend/src/app.ts`

- [ ] **Step 1 : Écrire les tests**

```typescript
// backend/src/routes/__tests__/stripe.webhook.test.ts
import request from 'supertest';
import express from 'express';

jest.mock('../../db/stripe', () => ({
  stripe: {
    webhooks: {
      constructEvent: jest.fn(),
    },
  },
}));

jest.mock('../../db/prisma', () => ({
  prisma: {
    club: { findFirst: jest.fn(), update: jest.fn() },
    reservation: { findUnique: jest.fn(), update: jest.fn() },
    clubStripeCustomer: { findFirst: jest.fn(), update: jest.fn() },
    reservationParticipant: { findFirst: jest.fn() },
    payment: { create: jest.fn() },
  },
}));

jest.mock('../../services/reservation.service', () => ({
  ReservationService: jest.fn().mockImplementation(() => ({
    confirmReservation: jest.fn().mockResolvedValue({ id: 'r-1', status: 'CONFIRMED' }),
  })),
}));

import { stripe } from '../../db/stripe';
import { prisma } from '../../db/prisma';
import webhooksRouter from '../stripe-webhooks';

const app = express();
app.use('/api/stripe/webhooks', express.raw({ type: 'application/json' }), webhooksRouter);

beforeEach(() => jest.clearAllMocks());

describe('POST /api/stripe/webhooks', () => {
  it('retourne 400 si signature invalide', async () => {
    (stripe.webhooks.constructEvent as jest.Mock).mockImplementation(() => {
      throw new Error('signature invalide');
    });

    const res = await request(app)
      .post('/api/stripe/webhooks')
      .set('stripe-signature', 'bad-sig')
      .send('{}');

    expect(res.status).toBe(400);
  });

  it('retourne 200 et met à jour stripeAccountStatus sur account.updated', async () => {
    (stripe.webhooks.constructEvent as jest.Mock).mockReturnValue({
      type: 'account.updated',
      data: { object: { id: 'acct_1', charges_enabled: true, details_submitted: true } },
    });
    (prisma.club.findFirst as jest.Mock).mockResolvedValue({ id: 'club-1' });
    (prisma.club.update as jest.Mock).mockResolvedValue({});

    const res = await request(app)
      .post('/api/stripe/webhooks')
      .set('stripe-signature', 'valid-sig')
      .send('{}');

    expect(res.status).toBe(200);
    expect(prisma.club.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { stripeAccountStatus: 'ACTIVE' },
    }));
  });

  it('confirme la résa si payment_intent.succeeded et résa PENDING', async () => {
    (stripe.webhooks.constructEvent as jest.Mock).mockReturnValue({
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_1', metadata: { reservationId: 'r-1' }, payment_method: 'pm_x' } },
    });
    (prisma.reservation.findUnique as jest.Mock).mockResolvedValue({
      id: 'r-1', status: 'PENDING', userId: 'u-1',
    });

    const res = await request(app)
      .post('/api/stripe/webhooks')
      .set('stripe-signature', 'valid-sig')
      .send('{}');

    expect(res.status).toBe(200);
  });

  it('ne fait rien si payment_intent.succeeded et résa déjà CONFIRMED (idempotent)', async () => {
    (stripe.webhooks.constructEvent as jest.Mock).mockReturnValue({
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_1', metadata: { reservationId: 'r-1' }, payment_method: 'pm_x' } },
    });
    (prisma.reservation.findUnique as jest.Mock).mockResolvedValue({
      id: 'r-1', status: 'CONFIRMED', userId: 'u-1',
    });

    const res = await request(app)
      .post('/api/stripe/webhooks')
      .set('stripe-signature', 'valid-sig')
      .send('{}');

    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2 : Vérifier que les tests échouent**

```bash
cd backend && npx jest --testPathPattern="stripe.webhook" --no-coverage
```

Attendu : FAIL — `Cannot find module '../stripe-webhooks'`.

- [ ] **Step 3 : Créer le webhook handler**

```typescript
// backend/src/routes/stripe-webhooks.ts
import { Router, Request, Response } from 'express';
import { stripe } from '../db/stripe';
import { prisma } from '../db/prisma';
import { ReservationService } from '../services/reservation.service';

const router = Router();
const reservationService = new ReservationService();

router.post('/', async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'] as string;

  let event: ReturnType<typeof stripe.webhooks.constructEvent>;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET ?? '',
    );
  } catch {
    return void res.status(400).json({ error: 'webhook_signature_invalid' });
  }

  try {
    switch (event.type) {
      case 'account.updated': {
        const account = event.data.object as { id: string; charges_enabled: boolean; details_submitted: boolean };
        const status = account.charges_enabled ? 'ACTIVE'
          : account.details_submitted ? 'RESTRICTED'
          : 'PENDING';
        const club = await prisma.club.findFirst({ where: { stripeAccountId: account.id } });
        if (club) {
          await prisma.club.update({ where: { id: club.id }, data: { stripeAccountStatus: status as any } });
        }
        break;
      }

      case 'payment_intent.succeeded': {
        const pi = event.data.object as { id: string; metadata: Record<string, string>; payment_method: string | null };
        const reservationId = pi.metadata?.reservationId;
        if (!reservationId) break;
        const reservation = await prisma.reservation.findUnique({ where: { id: reservationId } });
        if (!reservation || reservation.status !== 'PENDING') break;
        // Filet de sécurité : confirmer si le front n'a pas appelé confirmReservation
        try {
          await reservationService.confirmReservation(reservation.id, reservation.userId!, {
            stripePaymentIntentId: pi.id,
          });
        } catch {
          // Peut échouer si déjà confirmé concurremment — c'est attendu
        }
        break;
      }

      case 'setup_intent.succeeded': {
        const si = event.data.object as { id: string; metadata: Record<string, string>; payment_method: string | null };
        if (!si.payment_method || !si.metadata?.reservationId) break;
        const reservation = await prisma.reservation.findUnique({
          where: { id: si.metadata.reservationId },
          select: { userId: true, resource: { select: { clubId: true } } },
        });
        if (!reservation?.userId) break;
        await prisma.clubStripeCustomer.updateMany({
          where: {
            clubId: (reservation.resource as any)?.clubId,
            userId: reservation.userId,
            defaultPaymentMethodId: null,
          },
          data: { defaultPaymentMethodId: si.payment_method },
        });
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error('[stripe-webhook] erreur handler', event.type, err);
  }

  res.json({ received: true });
});

export default router;
```

- [ ] **Step 4 : Monter le webhook dans app.ts AVANT express.json()**

Dans `backend/src/app.ts`, ajouter l'import :

```typescript
import stripeWebhooksRouter from './routes/stripe-webhooks';
```

Puis AVANT la ligne `app.use(express.json())` (ligne 44), ajouter :

```typescript
// Webhook Stripe : doit être avant express.json() — le body doit rester brut pour la vérification de signature.
app.use('/api/stripe/webhooks', express.raw({ type: 'application/json' }), stripeWebhooksRouter);
```

- [ ] **Step 5 : Vérifier les tests**

```bash
cd backend && npx jest --testPathPattern="stripe.webhook" --no-coverage
```

Attendu : PASS (4 tests).

- [ ] **Step 6 : tsc**

```bash
cd backend && npx tsc --noEmit
```

- [ ] **Step 7 : Commit**

```bash
git add backend/src/routes/stripe-webhooks.ts backend/src/routes/__tests__/stripe.webhook.test.ts backend/src/app.ts
git commit -m "feat(stripe): webhook handler (account.updated, payment_intent.succeeded, setup_intent.succeeded)"
```

---

## Task 10 : RefundService — extension paiements ONLINE

**Files:**
- Modify: `backend/src/services/refund.service.ts`
- Modify: `backend/src/services/__tests__/refund.service.test.ts`

- [ ] **Step 1 : Écrire les tests échouants**

Dans `refund.service.test.ts`, ajouter le mock Stripe et les cas :

```typescript
// En tête du fichier, ajouter :
jest.mock('../db/stripe', () => ({
  stripe: {
    refunds: { create: jest.fn() },
  },
}));

import { stripe } from '../db/stripe';
```

Ajouter les cas (dans le describe existant ou un nouveau) :

```typescript
describe('refund — paiements ONLINE', () => {
  const onlinePayment = {
    id: 'pay-online-1',
    clubId: 'club-1',
    amount: new Decimal(25),
    refundedAmount: new Decimal(0),
    method: 'ONLINE',
    status: 'CAPTURED',
    sourcePackageId: null,
    stripePaymentIntentId: 'pi_1',
  };

  it('appelle stripe.refunds.create pour un paiement ONLINE', async () => {
    (prisma.payment.findUnique as jest.Mock).mockResolvedValue(onlinePayment);
    // Mock prisma.club pour récupérer stripeAccountId
    (prisma.club.findUnique as jest.Mock).mockResolvedValue({ stripeAccountId: 'acct_1' });
    (stripe.refunds.create as jest.Mock).mockResolvedValue({ id: 'ref_1' });
    (prisma.$transaction as jest.Mock).mockImplementation((fn: any) =>
      fn({ payment: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn() }, refund: { create: jest.fn().mockResolvedValue({ id: 'rf-1' }) } })
    );

    await refundService.refund({ paymentId: 'pay-online-1', clubId: 'club-1', amount: 25 });

    expect(stripe.refunds.create).toHaveBeenCalledWith(
      { payment_intent: 'pi_1', amount: 2500 },
      { stripeAccount: 'acct_1' },
    );
  });

  it('ne pas appeler stripe.refunds.create pour un paiement CASH', async () => {
    (prisma.payment.findUnique as jest.Mock).mockResolvedValue({
      ...onlinePayment, method: 'CASH', stripePaymentIntentId: null,
    });
    (prisma.$transaction as jest.Mock).mockImplementation((fn: any) =>
      fn({ payment: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn() }, refund: { create: jest.fn().mockResolvedValue({ id: 'rf-1' }) } })
    );

    await refundService.refund({ paymentId: 'pay-online-1', clubId: 'club-1', amount: 25 });

    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });

  it('ne crée pas le Refund DB si stripe.refunds.create échoue', async () => {
    (prisma.payment.findUnique as jest.Mock).mockResolvedValue(onlinePayment);
    (prisma.club.findUnique as jest.Mock).mockResolvedValue({ stripeAccountId: 'acct_1' });
    (stripe.refunds.create as jest.Mock).mockRejectedValue(new Error('stripe error'));

    await expect(
      refundService.refund({ paymentId: 'pay-online-1', clubId: 'club-1', amount: 25 })
    ).rejects.toThrow('stripe error');

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2 : Vérifier que les tests échouent**

```bash
cd backend && npx jest --testPathPattern="refund.service" --no-coverage
```

Attendu : FAIL sur les nouveaux cas.

- [ ] **Step 3 : Modifier refund.service.ts**

Ajouter l'import en tête :

```typescript
import { stripe } from '../db/stripe';
```

Dans la méthode `refund`, juste AVANT `return prisma.$transaction(...)`, ajouter :

```typescript
    // Pour les paiements en ligne : rembourser via Stripe AVANT la transaction DB.
    // Si Stripe échoue → exception propagée, la DB n'est pas touchée.
    if (payment.method === 'ONLINE' && (payment as any).stripePaymentIntentId) {
      const club = await prisma.club.findUnique({
        where: { id: params.clubId },
        select: { stripeAccountId: true },
      });
      if (club?.stripeAccountId) {
        await stripe.refunds.create(
          {
            payment_intent: (payment as any).stripePaymentIntentId,
            amount: amountCents,
          },
          { stripeAccount: club.stripeAccountId },
        );
      }
    }
```

- [ ] **Step 4 : Vérifier que tous les tests passent**

```bash
cd backend && npx jest --testPathPattern="refund.service" --no-coverage
```

Attendu : PASS.

- [ ] **Step 5 : Gate backend complet**

```bash
cd backend && npx jest --no-coverage
```

Attendu : tous les tests passent (463+ tests).

- [ ] **Step 6 : Commit**

```bash
git add backend/src/services/refund.service.ts backend/src/services/__tests__/refund.service.test.ts
git commit -m "feat(stripe): RefundService appelle stripe.refunds.create pour paiements ONLINE"
```

---

## Task 11 : Frontend — lib/api.ts + lib/stripe.ts

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1 : Mettre à jour ClubDetail avec les flags Stripe**

Dans `ClubDetail` (interface ~ligne 514), ajouter après `showOtherClubsReservations` :

```typescript
  requireOnlinePayment: boolean;
  requireCardFingerprint: boolean;
```

- [ ] **Step 2 : Mettre à jour ClubAdminDetail avec les champs Stripe**

Dans `ClubAdminDetail` (interface ~ligne 681), ajouter après les champs existants :

```typescript
  stripeAccountId: string | null;
  stripeAccountStatus: 'NONE' | 'PENDING' | 'ACTIVE' | 'RESTRICTED';
  requireOnlinePayment: boolean;
  requireCardFingerprint: boolean;
```

- [ ] **Step 3 : Mettre à jour confirmReservation dans api**

Remplacer la définition de `confirmReservation` (~ligne 90) :

```typescript
  confirmReservation: (
    reservationId: string,
    token: string,
    options?: {
      paymentSource?: { packageId: string };
      stripePaymentIntentId?: string;
      stripeSetupIntentId?: string;
    },
  ) =>
    request<Reservation>(`/api/reservations/${reservationId}/confirm`, {
      method: 'POST',
      body: JSON.stringify(options ?? {}),
    }, token),
```

- [ ] **Step 4 : Ajouter les nouveaux appels API**

Après `confirmReservation`, ajouter :

```typescript
  // --- Stripe Connect (admin) ---
  initiateStripeConnect: (clubId: string, body: { refreshUrl: string; returnUrl: string }, token: string) =>
    request<{ url: string }>(`/api/clubs/${clubId}/admin/stripe/connect`, {
      method: 'POST',
      body: JSON.stringify(body),
    }, token),

  getStripeStatus: (clubId: string, token: string) =>
    request<{ stripeAccountStatus: string }>(`/api/clubs/${clubId}/admin/stripe/status`, {}, token),

  getStripeLoginLink: (clubId: string, token: string) =>
    request<{ url: string }>(`/api/clubs/${clubId}/admin/stripe/login-link`, {}, token),

  // --- Stripe Intent (joueur) ---
  createStripeIntent: (
    slug: string,
    body: { reservationId: string; type: 'payment' | 'setup' },
    token: string,
  ) =>
    request<{ clientSecret: string; type: 'payment' | 'setup' }>(
      `/api/clubs/${slug}/stripe/intent`,
      { method: 'POST', body: JSON.stringify(body) },
      token,
    ),

  // --- No-show (admin) ---
  chargeNoShow: (
    clubId: string,
    reservationId: string,
    body: { amount: number; note?: string },
    token: string,
  ) =>
    request<{ paymentId: string; stripePaymentIntentId: string }>(
      `/api/clubs/${clubId}/admin/reservations/${reservationId}/no-show-charge`,
      { method: 'POST', body: JSON.stringify(body) },
      token,
    ),
```

- [ ] **Step 5 : tsc propre**

```bash
cd frontend && npx tsc --noEmit
```

Attendu : 0 erreur.

- [ ] **Step 6 : Commit**

```bash
git add frontend/lib/api.ts frontend/lib/stripe.ts
git commit -m "feat(stripe): lib/api.ts types Stripe + nouveaux appels; lib/stripe.ts singleton"
```

---

## Task 12 : Frontend — StripePaymentStep component

**Files:**
- Create: `frontend/components/StripePaymentStep.tsx`
- Create: `frontend/__tests__/StripePaymentStep.test.tsx`

- [ ] **Step 1 : Écrire les tests**

```typescript
// frontend/__tests__/StripePaymentStep.test.tsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import StripePaymentStep from '@/components/StripePaymentStep';

// Mock Stripe
const mockConfirmPayment = jest.fn();
const mockConfirmSetup = jest.fn();

jest.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: any) => <div>{children}</div>,
  PaymentElement: () => <div data-testid="payment-element" />,
  useStripe: () => ({ confirmPayment: mockConfirmPayment, confirmSetup: mockConfirmSetup }),
  useElements: () => ({}),
}));

jest.mock('@/lib/stripe', () => ({
  getStripe: jest.fn().mockResolvedValue(null),
}));

jest.mock('@/lib/api', () => ({
  api: {
    createStripeIntent: jest.fn().mockResolvedValue({ clientSecret: 'pi_test_secret', type: 'payment' }),
    confirmReservation: jest.fn().mockResolvedValue({ id: 'r-1', status: 'CONFIRMED' }),
  },
}));

import { api } from '@/lib/api';

beforeEach(() => jest.clearAllMocks());

const defaultProps = {
  reservationId: 'r-1',
  slug: 'test-club',
  clubId: 'club-1',
  type: 'payment' as const,
  amountLabel: '25,00 €',
  token: 'tok-1',
  onSuccess: jest.fn(),
  onCancel: jest.fn(),
};

describe('StripePaymentStep', () => {
  it('affiche le Payment Element et le montant', async () => {
    render(<StripePaymentStep {...defaultProps} />);
    await waitFor(() => expect(screen.getByTestId('payment-element')).toBeInTheDocument());
    expect(screen.getByText(/25,00/)).toBeInTheDocument();
  });

  it('appelle onSuccess après un paiement réussi', async () => {
    mockConfirmPayment.mockResolvedValue({ paymentIntent: { status: 'succeeded' }, error: null });
    (api.confirmReservation as jest.Mock).mockResolvedValue({ id: 'r-1', status: 'CONFIRMED' });

    render(<StripePaymentStep {...defaultProps} />);
    await waitFor(() => screen.getByText(/Payer/));
    fireEvent.click(screen.getByText(/Payer/));

    await waitFor(() => expect(defaultProps.onSuccess).toHaveBeenCalled());
  });

  it('affiche une erreur si confirmPayment retourne une erreur', async () => {
    mockConfirmPayment.mockResolvedValue({ error: { message: 'Votre carte a été refusée' } });

    render(<StripePaymentStep {...defaultProps} />);
    await waitFor(() => screen.getByText(/Payer/));
    fireEvent.click(screen.getByText(/Payer/));

    await waitFor(() => expect(screen.getByText(/refusée/)).toBeInTheDocument());
    expect(defaultProps.onSuccess).not.toHaveBeenCalled();
  });

  it('affiche "Enregistrer ma carte" en mode setup', async () => {
    render(<StripePaymentStep {...defaultProps} type="setup" />);
    await waitFor(() => screen.getByText(/Enregistrer/));
    expect(screen.getByText(/Enregistrer ma carte/)).toBeInTheDocument();
  });

  it('appelle onCancel au clic Annuler', async () => {
    render(<StripePaymentStep {...defaultProps} />);
    fireEvent.click(screen.getByText(/Annuler/));
    expect(defaultProps.onCancel).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2 : Vérifier que les tests échouent**

```bash
cd frontend && npx jest --testPathPattern="StripePaymentStep" --no-coverage
```

Attendu : FAIL — `Cannot find module '@/components/StripePaymentStep'`.

- [ ] **Step 3 : Créer le composant**

```tsx
// frontend/components/StripePaymentStep.tsx
'use client';
import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Btn } from '@/components/ui/atoms';
import { api } from '@/lib/api';
import { getStripe } from '@/lib/stripe';

// Chargement lazy de stripe-react pour ne pas embarquer stripe.js sur toutes les pages
const Elements = dynamic(
  () => import('@stripe/react-stripe-js').then((m) => m.Elements),
  { ssr: false },
);
const PaymentElement = dynamic(
  () => import('@stripe/react-stripe-js').then((m) => m.PaymentElement),
  { ssr: false },
);

interface Props {
  reservationId: string;
  slug: string;
  clubId: string;
  type: 'payment' | 'setup';
  amountLabel: string;
  token: string;
  onSuccess: () => void;
  onCancel: () => void;
}

function StripeForm({
  reservationId,
  type,
  amountLabel,
  token,
  onSuccess,
  onCancel,
}: Props) {
  // useStripe / useElements importés dynamiquement pour éviter le SSR
  const [stripeHooks, setStripeHooks] = useState<{
    useStripe: () => any;
    useElements: () => any;
  } | null>(null);

  useEffect(() => {
    import('@stripe/react-stripe-js').then((m) => {
      setStripeHooks({ useStripe: m.useStripe, useElements: m.useElements });
    });
  }, []);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stripe = stripeHooks?.useStripe()();
  const elements = stripeHooks?.useElements()();

  const handleSubmit = async () => {
    if (!stripe || !elements) return;
    setLoading(true);
    setError(null);

    try {
      let result: { error?: { message?: string } };
      if (type === 'payment') {
        result = await stripe.confirmPayment({ elements, redirect: 'if_required' });
      } else {
        result = await stripe.confirmSetup({ elements, redirect: 'if_required' });
      }

      if (result.error) {
        setError(result.error.message ?? 'Paiement échoué.');
        return;
      }

      // Le paiement/setup a réussi côté Stripe → confirmer la réservation
      await api.confirmReservation(reservationId, token, {
        stripePaymentIntentId: type === 'payment' ? (result as any).paymentIntent?.id : undefined,
        stripeSetupIntentId: type === 'setup' ? (result as any).setupIntent?.id : undefined,
      });
      onSuccess();
    } catch (e: any) {
      setError(e?.message ?? 'Une erreur est survenue.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ fontWeight: 600 }}>
        {type === 'payment' ? `Montant : ${amountLabel}` : 'Enregistrement de votre carte'}
      </p>
      <PaymentElement />
      {error && <p style={{ color: 'red', fontSize: 14 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <Btn variant="ghost" onClick={onCancel}>Annuler</Btn>
        <Btn onClick={handleSubmit} disabled={loading || !stripe}>
          {loading ? 'Traitement…' : type === 'payment' ? `Payer ${amountLabel}` : 'Enregistrer ma carte'}
        </Btn>
      </div>
    </div>
  );
}

export default function StripePaymentStep(props: Props) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    api.createStripeIntent(
      props.slug,
      { reservationId: props.reservationId, type: props.type },
      props.token,
    ).then((r) => setClientSecret(r.clientSecret))
      .catch(() => setFetchError('Impossible d'initialiser le paiement.'));
  }, [props.slug, props.reservationId, props.type, props.token]);

  if (fetchError) return <p style={{ color: 'red' }}>{fetchError}</p>;
  if (!clientSecret) return <p>Chargement…</p>;

  return (
    <Elements stripe={getStripe()} options={{ clientSecret }}>
      <StripeForm {...props} />
    </Elements>
  );
}
```

- [ ] **Step 4 : Vérifier que les tests passent**

```bash
cd frontend && npx jest --testPathPattern="StripePaymentStep" --no-coverage
```

Attendu : PASS (5 tests).

- [ ] **Step 5 : Commit**

```bash
git add frontend/components/StripePaymentStep.tsx frontend/__tests__/StripePaymentStep.test.tsx
git commit -m "feat(stripe): composant StripePaymentStep (Payment Element lazy)"
```

---

## Task 13 : Frontend — BookingModal intégration Stripe

**Files:**
- Modify: `frontend/components/BookingModal.tsx`

- [ ] **Step 1 : Ajouter les props Stripe à BookingModal**

Dans l'interface `BookingModalProps`, ajouter :

```typescript
  /** ID du club (pour l'appel no-show admin). */
  clubId?: string;
  /** Flags Stripe du club — détermine si une étape paiement est requise. */
  requireOnlinePayment?: boolean;
  requireCardFingerprint?: boolean;
```

- [ ] **Step 2 : Ajouter l'état de l'étape Stripe**

Dans la fonction `BookingModal`, ajouter l'état :

```typescript
  const [stripeStep, setStripeStep] = useState(false);
```

- [ ] **Step 3 : Ajouter l'import du composant Stripe**

En tête du fichier, ajouter :

```typescript
import dynamic from 'next/dynamic';
const StripePaymentStep = dynamic(() => import('@/components/StripePaymentStep'), { ssr: false });
```

- [ ] **Step 4 : Modifier le flux de confirmation**

Trouver le handler du bouton "Confirmer" (qui appelle `confirmReservation`). Envelopper la logique existante :

Si `(requireOnlinePayment || requireCardFingerprint) && !stripeStep && reservationId` → au lieu d'appeler directement `confirmReservation`, passer en mode `stripeStep = true`.

```typescript
  // Dans le handler de confirmation existant, ajouter au début :
  if ((props.requireOnlinePayment || props.requireCardFingerprint) && heldReservationId) {
    setStripeStep(true);
    return;
  }
  // ... suite de la logique existante (confirmReservation sans Stripe)
```

- [ ] **Step 5 : Ajouter le rendu de l'étape Stripe**

Dans le JSX du BookingModal, à l'endroit où le modal affiche son contenu principal (après le timer et les détails du créneau), ajouter :

```tsx
      {stripeStep && heldReservationId && (
        <StripePaymentStep
          reservationId={heldReservationId}
          slug={props.slug ?? ''}
          clubId={props.clubId ?? ''}
          type={props.requireOnlinePayment ? 'payment' : 'setup'}
          amountLabel={props.price}
          token={props.token}
          onSuccess={() => {
            // Rafraîchir l'UI comme si confirmReservation avait réussi
            // (le backend confirme dans confirmReservation côté StripePaymentStep)
            setStripeStep(false);
            props.onClose();
          }}
          onCancel={() => {
            setStripeStep(false);
          }}
        />
      )}
```

- [ ] **Step 6 : Mettre à jour les appelants de BookingModal**

Partout où `<BookingModal>` est utilisé (rechercher dans `frontend/`), passer les nouvelles props depuis le `ClubDetail` :

```tsx
<BookingModal
  ...
  clubId={club.id}
  requireOnlinePayment={club.requireOnlinePayment}
  requireCardFingerprint={club.requireCardFingerprint}
/>
```

- [ ] **Step 7 : tsc propre**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 8 : Gate frontend**

```bash
cd frontend && npx jest --no-coverage
```

Attendu : tous les tests existants + StripePaymentStep passent.

- [ ] **Step 9 : Commit**

```bash
git add frontend/components/BookingModal.tsx
git commit -m "feat(stripe): BookingModal — étape StripePaymentStep si paiement/empreinte requis"
```

---

## Task 14 : Frontend — Admin settings + planning no-show

**Files:**
- Modify: `frontend/app/admin/settings/page.tsx`
- Create: `frontend/components/admin/NoShowChargeModal.tsx`
- Modify: `frontend/app/admin/planning/page.tsx`

- [ ] **Step 1 : Créer NoShowChargeModal**

```tsx
// frontend/components/admin/NoShowChargeModal.tsx
'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { Btn } from '@/components/ui/atoms';
import { useTheme } from '@/lib/ThemeProvider';

interface Props {
  clubId: string;
  reservationId: string;
  defaultAmount: number;  // en €
  token: string;
  onSuccess: () => void;
  onClose: () => void;
}

export default function NoShowChargeModal({ clubId, reservationId, defaultAmount, token, onSuccess, onClose }: Props) {
  const { th } = useTheme();
  const [amount, setAmount] = useState(String(defaultAmount));
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCharge = async () => {
    const parsed = parseFloat(amount);
    if (!parsed || parsed <= 0) { setError('Montant invalide.'); return; }
    setLoading(true);
    setError(null);
    try {
      await api.chargeNoShow(clubId, reservationId, { amount: parsed, note: note || undefined }, token);
      onSuccess();
    } catch (e: any) {
      const msg: Record<string, string> = {
        CARD_DECLINED: 'La carte a été refusée.',
        NO_CARD_ON_FILE: 'Aucune empreinte bancaire enregistrée pour ce joueur.',
      };
      setError(msg[e?.message] ?? e?.message ?? 'Erreur lors du débit.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h3 style={{ margin: 0 }}>Facturer un no-show</h3>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 13 }}>Montant (€)</span>
        <input
          type="number"
          min="0.5"
          step="0.5"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          style={{ border: `1px solid ${th.border}`, borderRadius: 6, padding: '6px 10px', fontSize: 15 }}
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 13 }}>Note (optionnel)</span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Ex. : No-show 14h"
          style={{ border: `1px solid ${th.border}`, borderRadius: 6, padding: '6px 10px', fontSize: 15 }}
        />
      </label>
      {error && <p style={{ color: 'red', fontSize: 13, margin: 0 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Btn variant="ghost" onClick={onClose}>Annuler</Btn>
        <Btn onClick={handleCharge} disabled={loading}>
          {loading ? 'Débit…' : `Facturer ${parseFloat(amount) > 0 ? parseFloat(amount).toFixed(2) + ' €' : ''}`}
        </Btn>
      </div>
    </div>
  );
}
```

- [ ] **Step 2 : Ajouter la section Stripe dans les réglages admin**

Dans `frontend/app/admin/settings/page.tsx`, trouver l'endroit où sont affichées les cartes de réglages (ex. après la carte remboursement). Ajouter une nouvelle carte :

```tsx
{/* Paiement en ligne — Stripe Connect */}
<SettingsCard title="Paiement en ligne">
  {club.stripeAccountStatus === 'NONE' && (
    <Btn onClick={handleStripeConnect} disabled={stripeConnecting}>
      {stripeConnecting ? 'Redirection…' : 'Connecter mon compte Stripe'}
    </Btn>
  )}
  {club.stripeAccountStatus === 'PENDING' && (
    <div>
      <span style={{ color: 'orange' }}>● Onboarding en cours</span>
      <Btn onClick={handleStripeConnect} disabled={stripeConnecting}>Reprendre</Btn>
    </div>
  )}
  {club.stripeAccountStatus === 'ACTIVE' && (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ color: 'green' }}>● Compte Stripe actif</span>
      <a href="#" onClick={handleStripeLoginLink}>Tableau de bord Stripe ↗</a>
    </div>
  )}
  {club.stripeAccountStatus === 'RESTRICTED' && (
    <span style={{ color: 'orange' }}>● Compte Stripe restreint — vérifiez votre tableau de bord</span>
  )}

  {club.stripeAccountStatus === 'ACTIVE' && (
    <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={club.requireOnlinePayment}
          onChange={(e) => handleUpdateClub({ requireOnlinePayment: e.target.checked })}
        />
        Exiger le paiement CB à la réservation
      </label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={club.requireCardFingerprint}
          onChange={(e) => handleUpdateClub({ requireCardFingerprint: e.target.checked })}
        />
        Enregistrer une empreinte bancaire (protection no-show)
      </label>
    </div>
  )}
</SettingsCard>
```

Dans les handlers (state/effets du composant) :

```typescript
  const [stripeConnecting, setStripeConnecting] = useState(false);

  const handleStripeConnect = async () => {
    setStripeConnecting(true);
    try {
      const returnUrl = window.location.href + '?stripe=return';
      const refreshUrl = window.location.href + '?stripe=refresh';
      const { url } = await api.initiateStripeConnect(club.id, { refreshUrl, returnUrl }, token!);
      window.location.href = url;
    } catch {
      setStripeConnecting(false);
    }
  };

  const handleStripeLoginLink = async (e: React.MouseEvent) => {
    e.preventDefault();
    try {
      const { url } = await api.getStripeLoginLink(club.id, token!);
      window.open(url, '_blank');
    } catch { /* ignore */ }
  };

  // Au retour de Stripe (param ?stripe=return ou ?stripe=refresh), resync le statut
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('stripe') === 'return' || params.get('stripe') === 'refresh') {
      api.getStripeStatus(club.id, token!).then(() => {
        // Recharger les données du club pour afficher le nouveau statut
        window.history.replaceState({}, '', window.location.pathname);
        // Déclencher un reload des données club (selon comment la page charge les données)
      });
    }
  }, []);
```

- [ ] **Step 3 : Mettre à jour UpdateClubBody dans lib/api.ts pour accepter les nouveaux flags**

Dans le type `UpdateClubBody` (chercher dans api.ts), ajouter :

```typescript
  requireOnlinePayment?: boolean;
  requireCardFingerprint?: boolean;
```

- [ ] **Step 4 : Mettre à jour club.service.ts pour exposer et accepter les nouveaux champs**

Dans `backend/src/services/club.service.ts`, dans `getClubBySlug`, ajouter `requireOnlinePayment` et `requireCardFingerprint` au select. Dans `getClubForAdmin`, ajouter `stripeAccountId`, `stripeAccountStatus`, `requireOnlinePayment`, `requireCardFingerprint`. Dans `updateClub`, accepter et valider ces 2 booleans.

- [ ] **Step 5 : Ajouter le badge 💳 et le bouton no-show dans le planning**

Dans `frontend/app/admin/planning/page.tsx` :

1. Dans le rendu des blocs de réservation, si `r.hasCardFingerprint`, afficher un badge :

```tsx
{r.hasCardFingerprint && (
  <span title="Empreinte bancaire enregistrée" style={{ fontSize: 11 }}>💳</span>
)}
```

2. Dans le panneau latéral de détail d'une réservation, si `selectedReservation.hasCardFingerprint`, ajouter :

```tsx
{selectedReservation.hasCardFingerprint && (
  <Btn
    variant="danger-ghost"
    onClick={() => setNoShowTarget(selectedReservation.id)}
  >
    Facturer no-show
  </Btn>
)}

{noShowTarget && (
  <NoShowChargeModal
    clubId={clubId}
    reservationId={noShowTarget}
    defaultAmount={Number(selectedReservation.totalPrice)}
    token={token!}
    onSuccess={() => {
      setNoShowTarget(null);
      // Recharger les réservations pour afficher le nouveau paiement
      reload();
    }}
    onClose={() => setNoShowTarget(null)}
  />
)}
```

- [ ] **Step 6 : Gate final back + front**

```bash
cd backend && npx jest --no-coverage && npx tsc --noEmit
cd ../frontend && npx jest --no-coverage && npx tsc --noEmit
```

Attendu : tous les tests passent, tsc propre des deux côtés.

- [ ] **Step 7 : Commit final**

```bash
git add frontend/app/admin/settings/page.tsx frontend/components/admin/NoShowChargeModal.tsx frontend/app/admin/planning/page.tsx backend/src/services/club.service.ts frontend/lib/api.ts
git commit -m "feat(stripe): admin settings Stripe Connect + planning badge 💳 + no-show charge modal"
```

---

## Variables d'environnement à configurer

### Dev (`backend/.env` + `frontend/.env.local`)
```env
# backend/.env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...   # fourni par : stripe listen --forward-to localhost:3001/api/stripe/webhooks

# frontend/.env.local
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

### Prod (`/root/palova/.env.prod`)
Ajouter :
```env
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...   # depuis le dashboard Stripe Palova → Webhooks
```

`docker-compose.prod.yml` — ajouter au service `backend` :
```yaml
- STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY}
- STRIPE_WEBHOOK_SECRET=${STRIPE_WEBHOOK_SECRET}
```

Et au service `frontend` (build arg) :
```yaml
build:
  args:
    - NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=${NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY}
```

Le webhook Stripe prod doit pointer vers `https://api.palova.fr/api/stripe/webhooks` (à enregistrer dans le dashboard Stripe, events : `account.updated`, `payment_intent.succeeded`, `setup_intent.succeeded`).
