# Offre au membre actif + facturation SaaS (Stripe Billing) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implémenter l'offre Palova indexée sur les membres actifs (0 € ≤ 50, 29/59/99/149 € plafonné, mensuel + annuel -15 %) : metering, abonnement Stripe Billing des clubs, suivi côté gérant (`/admin/billing`) et super-admin, page publique `/tarifs`.

**Architecture:** Un seul plan tout inclus ; le prix dépend du palier de membres actifs (90 j glissants). Constantes pures partagées (`tiers.ts` backend + miroir front). Stripe Billing sur le compte plateforme (`STRIPE_SECRET_KEY` existant) : Checkout pour souscrire, Customer Portal pour carte/factures, webhook dédié pour la synchro. Cron nocturne (compteur) + mensuel (snapshots + règles de palier : montée après 2 mois consécutifs, descente dès 1, jamais de blocage). Spec : `docs/superpowers/specs/2026-07-07-offre-membres-actifs-billing-design.md`.

**Tech Stack:** Express 5, Prisma 7 (PrismaPg), stripe-node ^22, node-cron, Luxon, nodemailer ; Next.js 16 + React 19 côté front. Tests : Jest + supertest + jest-mock-extended (backend), Jest + RTL (frontend).

**Conventions du repo (rappels critiques) :**
- Migrations : **jamais** `prisma migrate dev`/`db push` en dev (dérive de base) — SQL additif appliqué via `npx prisma db execute`, prod `migrate deploy`.
- Commandes de test : `node node_modules/jest/bin/jest.js <suite>` (les shims `.bin` sont cassés) ; type-check front : `node node_modules/typescript/bin/tsc --noEmit`.
- Les tests backend mockent Prisma via `src/__mocks__/prisma.ts` (`mockDeep<PrismaClient>` — les nouveaux modèles marchent automatiquement après `prisma generate`).
- Chaque commande PowerShell repart du repo racine : préfixer `cd backend` / `cd frontend` dans CHAQUE commande.

---

### Task 1: Constantes de paliers backend (`tiers.ts`)

**Files:**
- Create: `backend/src/services/platformBilling/tiers.ts`
- Test: `backend/src/services/__tests__/platformTiers.test.ts`

- [ ] **Step 1: Écrire le test qui échoue**

```typescript
// backend/src/services/__tests__/platformTiers.test.ts
import {
  PLATFORM_TIERS, tierFor, tierPriceCents, tierLabel, priceLookupKey, tierFromLookupKey,
} from '../platformBilling/tiers';

describe('PLATFORM_TIERS', () => {
  it('a 5 paliers, du gratuit au plafond', () => {
    expect(PLATFORM_TIERS).toHaveLength(5);
    expect(PLATFORM_TIERS[0]).toEqual({ tier: 0, maxMembers: 50, monthlyCents: 0, yearlyCents: 0 });
    expect(PLATFORM_TIERS[4].maxMembers).toBeNull();
  });
});

describe('tierFor — bornes exactes', () => {
  it.each([
    [0, 0], [50, 0], [51, 1], [150, 1], [151, 2], [400, 2], [401, 3], [800, 3], [801, 4], [5000, 4],
  ])('%i membres → palier %i', (members, tier) => {
    expect(tierFor(members)).toBe(tier);
  });
});

describe('tierPriceCents', () => {
  it('mensuel : 0/2900/5900/9900/14900', () => {
    expect([0, 1, 2, 3, 4].map((t) => tierPriceCents(t, 'month'))).toEqual([0, 2900, 5900, 9900, 14900]);
  });
  it('annuel (~-15 %) : 29600/60200/101000/152000', () => {
    expect([1, 2, 3, 4].map((t) => tierPriceCents(t, 'year'))).toEqual([29600, 60200, 101000, 152000]);
  });
  it('palier inconnu → TIER_INVALID', () => {
    expect(() => tierPriceCents(9, 'month')).toThrow('TIER_INVALID');
  });
});

describe('tierLabel', () => {
  it('libellés lisibles', () => {
    expect(tierLabel(0)).toBe('0 – 50 membres actifs');
    expect(tierLabel(1)).toBe('51 – 150 membres actifs');
    expect(tierLabel(4)).toBe('801+ membres actifs');
  });
});

describe('lookup keys Stripe', () => {
  it('aller-retour', () => {
    expect(priceLookupKey(2, 'year')).toBe('palova_t2_year');
    expect(tierFromLookupKey('palova_t2_year')).toEqual({ tier: 2, interval: 'year' });
    expect(tierFromLookupKey('palova_t0_month')).toBeNull(); // pas de prix pour le gratuit
    expect(tierFromLookupKey(null)).toBeNull();
    expect(tierFromLookupKey('autre_chose')).toBeNull();
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd backend; node node_modules/jest/bin/jest.js platformTiers`
Expected: FAIL — `Cannot find module '../platformBilling/tiers'`

- [ ] **Step 3: Implémenter `tiers.ts`**

```typescript
// backend/src/services/platformBilling/tiers.ts
/**
 * Paliers de l'offre SaaS Palova : un seul plan tout inclus, prix au nombre de
 * membres actifs (participation sur 90 jours glissants), plafonné au palier 4.
 * ⚠️ Miroir front : frontend/lib/platformTiers.ts — garder les deux synchronisés.
 */

export type BillingInterval = 'month' | 'year';

export interface PlatformTier {
  tier: 0 | 1 | 2 | 3 | 4;
  /** Borne haute INCLUSE de membres actifs (null = plafond, illimité). */
  maxMembers: number | null;
  monthlyCents: number; // HT
  yearlyCents: number;  // HT (~ -15 % vs 12 × mensuel)
}

export const PLATFORM_TIERS: PlatformTier[] = [
  { tier: 0, maxMembers: 50,   monthlyCents: 0,     yearlyCents: 0 },
  { tier: 1, maxMembers: 150,  monthlyCents: 2900,  yearlyCents: 29600 },
  { tier: 2, maxMembers: 400,  monthlyCents: 5900,  yearlyCents: 60200 },
  { tier: 3, maxMembers: 800,  monthlyCents: 9900,  yearlyCents: 101000 },
  { tier: 4, maxMembers: null, monthlyCents: 14900, yearlyCents: 152000 },
];

export function tierFor(activeMembers: number): number {
  for (const t of PLATFORM_TIERS) {
    if (t.maxMembers === null || activeMembers <= t.maxMembers) return t.tier;
  }
  return 4;
}

export function tierPriceCents(tier: number, interval: BillingInterval): number {
  const t = PLATFORM_TIERS.find((x) => x.tier === tier);
  if (!t) throw new Error('TIER_INVALID');
  return interval === 'year' ? t.yearlyCents : t.monthlyCents;
}

export function tierLabel(tier: number): string {
  const t = PLATFORM_TIERS.find((x) => x.tier === tier);
  if (!t) return '';
  const prev = PLATFORM_TIERS.find((x) => x.tier === tier - 1);
  const min = prev?.maxMembers != null ? prev.maxMembers + 1 : 0;
  return t.maxMembers === null
    ? `${min}+ membres actifs`
    : `${min} – ${t.maxMembers} membres actifs`;
}

/** lookup_key du Price Stripe d'un palier payant (aucun prix pour le palier 0). */
export function priceLookupKey(tier: number, interval: BillingInterval): string {
  return `palova_t${tier}_${interval}`;
}

/** Palier + cadence depuis un lookup_key Stripe (null si inconnu). */
export function tierFromLookupKey(
  key: string | null | undefined,
): { tier: number; interval: BillingInterval } | null {
  const m = /^palova_t([1-4])_(month|year)$/.exec(key ?? '');
  if (!m) return null;
  return { tier: Number(m[1]), interval: m[2] as BillingInterval };
}
```

- [ ] **Step 4: Vérifier le PASS**

Run: `cd backend; node node_modules/jest/bin/jest.js platformTiers`
Expected: PASS (5 suites de describe, toutes vertes)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/platformBilling/tiers.ts backend/src/services/__tests__/platformTiers.test.ts
git commit -m "feat(billing): paliers de l'offre au membre actif (constantes pures)"
```

---

### Task 2: Miroir frontend `platformTiers.ts`

**Files:**
- Create: `frontend/lib/platformTiers.ts`
- Test: `frontend/__tests__/platformTiers.test.ts`

- [ ] **Step 1: Écrire le test qui échoue**

```typescript
// frontend/__tests__/platformTiers.test.ts
import { PLATFORM_TIERS, tierFor, tierPriceCents, tierLabel } from '@/lib/platformTiers';

describe('platformTiers (miroir front — garder synchro avec backend/src/services/platformBilling/tiers.ts)', () => {
  it('bornes des paliers', () => {
    expect([0, 50, 51, 150, 151, 400, 401, 800, 801].map(tierFor)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4]);
  });
  it('prix mensuels et annuels', () => {
    expect(PLATFORM_TIERS.map((t) => t.monthlyCents)).toEqual([0, 2900, 5900, 9900, 14900]);
    expect(tierPriceCents(4, 'year')).toBe(152000);
  });
  it('libellés', () => {
    expect(tierLabel(2)).toBe('151 – 400 membres actifs');
    expect(tierLabel(4)).toBe('801+ membres actifs');
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd frontend; node node_modules/jest/bin/jest.js platformTiers`
Expected: FAIL — module introuvable

- [ ] **Step 3: Implémenter le miroir**

Copier le contenu EXACT de `backend/src/services/platformBilling/tiers.ts` dans `frontend/lib/platformTiers.ts`, en remplaçant seulement le commentaire d'en-tête :

```typescript
// frontend/lib/platformTiers.ts
/**
 * Paliers de l'offre SaaS Palova — MIROIR de backend/src/services/platformBilling/tiers.ts
 * (⚠️ garder les deux synchronisés). Un seul plan tout inclus, prix au nombre de
 * membres actifs (90 jours glissants), plafonné au palier 4.
 */
```

Le reste du fichier (types, `PLATFORM_TIERS`, `tierFor`, `tierPriceCents`, `tierLabel`, `priceLookupKey`, `tierFromLookupKey`) est identique au backend, à recopier tel quel depuis la Task 1 Step 3.

- [ ] **Step 4: Vérifier le PASS**

Run: `cd frontend; node node_modules/jest/bin/jest.js platformTiers`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/platformTiers.ts frontend/__tests__/platformTiers.test.ts
git commit -m "feat(billing): miroir front des paliers de l'offre"
```

---

### Task 3: Migration Prisma `add_platform_billing`

**Files:**
- Modify: `backend/prisma/schema.prisma` (modèle `Club` + 2 nouveaux modèles)
- Create: `backend/prisma/migrations/20260707120000_add_platform_billing/migration.sql`

- [ ] **Step 1: Ajouter les champs au modèle `Club`**

Dans `backend/prisma/schema.prisma`, modèle `Club`, juste APRÈS le bloc Stripe Connect (après la ligne `requireCardFingerprint Boolean @default(false) @map("require_card_fingerprint")`), insérer :

```prisma
  // Facturation SaaS Palova (offre au membre actif) — Customer Stripe du COMPTE
  // PLATEFORME (≠ ClubStripeCustomer, qui vit sur les comptes Connect des clubs).
  platformCustomerId  String?   @map("platform_customer_id")
  activeMemberCount   Int       @default(0) @map("active_member_count")    // snapshot metering nocturne
  activeMemberCountAt DateTime? @map("active_member_count_at")
  billingExempt       Boolean   @default(false) @map("billing_exempt")     // club partenaire exonéré (superadmin)
```

Et dans le bloc des relations du même modèle (après `photos ClubPhoto[]`), ajouter :

```prisma
  platformSubscription PlatformSubscription?
  memberSnapshots      ClubMemberSnapshot[]
```

- [ ] **Step 2: Ajouter les 2 nouveaux modèles en fin de schema.prisma**

```prisma
/// Abonnement SaaS du club à Palova (Stripe Billing, compte plateforme).
/// Nom distinct de Subscription (= abonnement d'un JOUEUR à un club).
model PlatformSubscription {
  id                   String    @id @default(cuid())
  clubId               String    @unique @map("club_id")
  stripeSubscriptionId String    @unique @map("stripe_subscription_id")
  status               String // miroir Stripe : active, past_due, canceled, trialing, unpaid…
  tier                 Int    // palier souscrit (1-4)
  interval             String // 'month' | 'year'
  currentPeriodEnd     DateTime? @map("current_period_end")
  cancelAtPeriodEnd    Boolean   @default(false) @map("cancel_at_period_end")
  createdAt            DateTime  @default(now()) @map("created_at")
  updatedAt            DateTime  @updatedAt @map("updated_at")

  club Club @relation(fields: [clubId], references: [id], onDelete: Cascade)

  @@map("platform_subscriptions")
}

/// Photo mensuelle du nombre de membres actifs d'un club (évaluation de palier).
/// Base de la règle « montée après 2 mois consécutifs » + graphes de suivi.
model ClubMemberSnapshot {
  id            String   @id @default(cuid())
  clubId        String   @map("club_id")
  month         String // 'YYYY-MM' (Europe/Paris) — mois écoulé au moment de l'évaluation
  activeMembers Int      @map("active_members")
  observedTier  Int      @map("observed_tier")
  createdAt     DateTime @default(now()) @map("created_at")

  club Club @relation(fields: [clubId], references: [id], onDelete: Cascade)

  @@unique([clubId, month])
  @@map("club_member_snapshots")
}
```

- [ ] **Step 3: Écrire le SQL de migration**

```sql
-- backend/prisma/migrations/20260707120000_add_platform_billing/migration.sql
-- Facturation SaaS Palova : offre au membre actif. 100 % additif.

ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "platform_customer_id" TEXT;
ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "active_member_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "active_member_count_at" TIMESTAMP(3);
ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "billing_exempt" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "platform_subscriptions" (
    "id" TEXT NOT NULL,
    "club_id" TEXT NOT NULL,
    "stripe_subscription_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "tier" INTEGER NOT NULL,
    "interval" TEXT NOT NULL,
    "current_period_end" TIMESTAMP(3),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "platform_subscriptions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "platform_subscriptions_club_id_key" ON "platform_subscriptions"("club_id");
CREATE UNIQUE INDEX IF NOT EXISTS "platform_subscriptions_stripe_subscription_id_key" ON "platform_subscriptions"("stripe_subscription_id");
ALTER TABLE "platform_subscriptions" ADD CONSTRAINT "platform_subscriptions_club_id_fkey"
    FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "club_member_snapshots" (
    "id" TEXT NOT NULL,
    "club_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "active_members" INTEGER NOT NULL,
    "observed_tier" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "club_member_snapshots_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "club_member_snapshots_club_id_month_key" ON "club_member_snapshots"("club_id", "month");
ALTER TABLE "club_member_snapshots" ADD CONSTRAINT "club_member_snapshots_club_id_fkey"
    FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 4: Appliquer en DEV (db execute, PAS migrate dev) + régénérer le client**

Run (PostgreSQL du docker-compose doit tourner) :
```
cd backend; npx prisma db execute --file prisma/migrations/20260707120000_add_platform_billing/migration.sql --schema prisma/schema.prisma
cd backend; npx prisma generate
```
Expected: `Script executed` puis `Generated Prisma Client`. En prod ce dossier de migration passera par `prisma migrate deploy`.

- [ ] **Step 5: Vérifier que le client expose les nouveaux modèles**

Vérifier que les types générés contiennent les nouveaux modèles (⚠️ ne PAS instancier `new PrismaClient()` sans adapter — Prisma 7) :
Run: `cd backend; grep -rl "PlatformSubscription" node_modules/.prisma/client/ | head -1`
Expected: au moins un fichier trouvé (idem pour `ClubMemberSnapshot`)

- [ ] **Step 6: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260707120000_add_platform_billing/migration.sql
git commit -m "feat(billing): migration add_platform_billing (PlatformSubscription, ClubMemberSnapshot, champs Club)"
```

---

### Task 4: Metering + état consolidé (`platformBilling.service.ts` — partie 1)

**Files:**
- Create: `backend/src/services/platformBilling/platformBilling.service.ts`
- Test: `backend/src/services/__tests__/platformBilling.service.test.ts`

- [ ] **Step 1: Écrire les tests qui échouent**

```typescript
// backend/src/services/__tests__/platformBilling.service.test.ts
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import {
  PlatformBillingService, billingState, ACTIVE_WINDOW_DAYS,
} from '../platformBilling/platformBilling.service';

const service = new PlatformBillingService();
const NOW = new Date('2026-07-07T12:00:00Z');

describe('billingState (pur)', () => {
  it('EXEMPT prime sur tout', () => {
    expect(billingState({ billingExempt: true, observedTier: 3, subscription: null })).toBe('EXEMPT');
  });
  it('FREE si palier 0 sans abonnement', () => {
    expect(billingState({ billingExempt: false, observedTier: 0, subscription: null })).toBe('FREE');
  });
  it('TO_REGULARIZE si palier ≥ 1 sans abonnement vivant', () => {
    expect(billingState({ billingExempt: false, observedTier: 1, subscription: null })).toBe('TO_REGULARIZE');
    expect(billingState({ billingExempt: false, observedTier: 2, subscription: { status: 'canceled' } })).toBe('TO_REGULARIZE');
  });
  it('PAST_DUE si impayé', () => {
    expect(billingState({ billingExempt: false, observedTier: 2, subscription: { status: 'past_due' } })).toBe('PAST_DUE');
    expect(billingState({ billingExempt: false, observedTier: 2, subscription: { status: 'unpaid' } })).toBe('PAST_DUE');
  });
  it('OK si abonnement actif', () => {
    expect(billingState({ billingExempt: false, observedTier: 2, subscription: { status: 'active' } })).toBe('OK');
  });
});

describe('countActiveMembers', () => {
  beforeEach(() => {
    prismaMock.reservation.findMany.mockResolvedValue([] as any);
    prismaMock.tournamentRegistration.findMany.mockResolvedValue([] as any);
    prismaMock.eventRegistration.findMany.mockResolvedValue([] as any);
    prismaMock.lessonEnrollment.findMany.mockResolvedValue([] as any);
    prismaMock.memberPackage.findMany.mockResolvedValue([] as any);
    prismaMock.subscription.findMany.mockResolvedValue([] as any);
  });

  it('déduplique les userIds à travers toutes les sources', async () => {
    prismaMock.reservation.findMany.mockResolvedValue([
      { userId: 'u1', participants: [{ userId: 'u2' }, { userId: 'u3' }] },
      { userId: null, participants: [{ userId: 'u1' }] },
    ] as any);
    prismaMock.tournamentRegistration.findMany.mockResolvedValue([
      { captainUserId: 'u2', partnerUserId: 'u4' },
    ] as any);
    prismaMock.eventRegistration.findMany.mockResolvedValue([{ userId: 'u5' }] as any);
    prismaMock.lessonEnrollment.findMany.mockResolvedValue([{ userId: 'u5' }] as any);
    prismaMock.memberPackage.findMany.mockResolvedValue([{ userId: 'u6' }] as any);
    prismaMock.subscription.findMany.mockResolvedValue([{ userId: 'u1' }] as any);

    // u1..u6 distincts = 6
    expect(await service.countActiveMembers('club-1', NOW)).toBe(6);
  });

  it('filtre sur la fenêtre de 90 jours et le club', async () => {
    await service.countActiveMembers('club-1', NOW);
    const since = new Date(NOW.getTime() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    expect(prismaMock.reservation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { resource: { clubId: 'club-1' }, status: 'CONFIRMED', startTime: { gte: since } },
    }));
    expect(prismaMock.tournamentRegistration.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tournament: { clubId: 'club-1' }, status: { not: 'CANCELLED' }, createdAt: { gte: since } },
    }));
  });
});

describe('refreshActiveMemberCount', () => {
  it('écrit le compteur et la date sur le club', async () => {
    prismaMock.reservation.findMany.mockResolvedValue([{ userId: 'u1', participants: [] }] as any);
    prismaMock.tournamentRegistration.findMany.mockResolvedValue([] as any);
    prismaMock.eventRegistration.findMany.mockResolvedValue([] as any);
    prismaMock.lessonEnrollment.findMany.mockResolvedValue([] as any);
    prismaMock.memberPackage.findMany.mockResolvedValue([] as any);
    prismaMock.subscription.findMany.mockResolvedValue([] as any);
    prismaMock.club.update.mockResolvedValue({} as any);

    const count = await service.refreshActiveMemberCount('club-1', NOW);
    expect(count).toBe(1);
    expect(prismaMock.club.update).toHaveBeenCalledWith({
      where: { id: 'club-1' },
      data: { activeMemberCount: 1, activeMemberCountAt: NOW },
    });
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd backend; node node_modules/jest/bin/jest.js platformBilling.service`
Expected: FAIL — module introuvable

- [ ] **Step 3: Implémenter le service (metering + état)**

```typescript
// backend/src/services/platformBilling/platformBilling.service.ts
import { prisma } from '../../db/prisma';
import { tierFor } from './tiers';

/** Fenêtre glissante de la métrique « membre actif ». */
export const ACTIVE_WINDOW_DAYS = 90;

export type BillingState = 'EXEMPT' | 'FREE' | 'OK' | 'TO_REGULARIZE' | 'PAST_DUE';

/**
 * Statut consolidé de facturation d'un club — helper PUR, partagé par l'API admin,
 * le superadmin et l'évaluation mensuelle. `subscription` = la ligne PlatformSubscription
 * (null si jamais souscrit) ; un abonnement `canceled` compte comme absent.
 */
export function billingState(input: {
  billingExempt: boolean;
  observedTier: number;
  subscription: { status: string } | null;
}): BillingState {
  if (input.billingExempt) return 'EXEMPT';
  const live = input.subscription && input.subscription.status !== 'canceled' ? input.subscription : null;
  if (live && (live.status === 'past_due' || live.status === 'unpaid')) return 'PAST_DUE';
  if (live) return 'OK';
  return input.observedTier === 0 ? 'FREE' : 'TO_REGULARIZE';
}

export class PlatformBillingService {
  /**
   * Membres actifs = userIds DISTINCTS ayant participé sur les 90 derniers jours :
   * réservation CONFIRMED (organisateur + participants, résas futures incluses —
   * un joueur qui vient de réserver est actif), inscription tournoi/event/cours
   * non CANCELLED, achat carnet ou abonnement club. Les ClubMembership créées à
   * la volée (chat, visite unique) ne comptent PAS.
   */
  async countActiveMembers(clubId: string, now: Date): Promise<number> {
    const since = new Date(now.getTime() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const [reservations, tournamentRegs, eventRegs, lessonRegs, packages, playerSubs] = await Promise.all([
      prisma.reservation.findMany({
        where: { resource: { clubId }, status: 'CONFIRMED', startTime: { gte: since } },
        select: { userId: true, participants: { select: { userId: true } } },
      }),
      prisma.tournamentRegistration.findMany({
        where: { tournament: { clubId }, status: { not: 'CANCELLED' }, createdAt: { gte: since } },
        select: { captainUserId: true, partnerUserId: true },
      }),
      prisma.eventRegistration.findMany({
        where: { event: { clubId }, status: { not: 'CANCELLED' }, createdAt: { gte: since } },
        select: { userId: true },
      }),
      prisma.lessonEnrollment.findMany({
        where: {
          status: { not: 'CANCELLED' },
          createdAt: { gte: since },
          OR: [{ lesson: { clubId } }, { series: { clubId } }],
        },
        select: { userId: true },
      }),
      prisma.memberPackage.findMany({
        where: { clubId, purchasedAt: { gte: since } },
        select: { userId: true },
      }),
      prisma.subscription.findMany({
        where: { clubId, createdAt: { gte: since } },
        select: { userId: true },
      }),
    ]);

    const users = new Set<string>();
    for (const r of reservations) {
      if (r.userId) users.add(r.userId);
      for (const p of r.participants) users.add(p.userId);
    }
    for (const t of tournamentRegs) { users.add(t.captainUserId); users.add(t.partnerUserId); }
    for (const e of eventRegs) users.add(e.userId);
    for (const l of lessonRegs) users.add(l.userId);
    for (const p of packages) users.add(p.userId);
    for (const s of playerSubs) users.add(s.userId);
    return users.size;
  }

  /** Recompte + persiste le snapshot vivant du club (jauge /admin/billing). */
  async refreshActiveMemberCount(clubId: string, now: Date): Promise<number> {
    const count = await this.countActiveMembers(clubId, now);
    await prisma.club.update({
      where: { id: clubId },
      data: { activeMemberCount: count, activeMemberCountAt: now },
    });
    return count;
  }

  /** Cron nocturne : recompte tous les clubs ACTIVE (les suspendus sont ignorés). */
  async refreshAllClubs(now: Date): Promise<void> {
    const clubs = await prisma.club.findMany({ where: { status: 'ACTIVE' }, select: { id: true, slug: true } });
    for (const club of clubs) {
      try { await this.refreshActiveMemberCount(club.id, now); }
      catch (err) { console.error(`[billing] refresh ${club.slug}:`, err); }
    }
  }
}
```

- [ ] **Step 4: Vérifier le PASS**

Run: `cd backend; node node_modules/jest/bin/jest.js platformBilling.service`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/platformBilling/platformBilling.service.ts backend/src/services/__tests__/platformBilling.service.test.ts
git commit -m "feat(billing): metering des membres actifs (90j glissants) + etat consolide"
```

---

### Task 5: Plomberie Stripe (`stripeBilling.ts`)

**Files:**
- Create: `backend/src/services/platformBilling/stripeBilling.ts`
- Test: `backend/src/services/__tests__/stripeBilling.test.ts`

- [ ] **Step 1: Écrire les tests qui échouent**

```typescript
// backend/src/services/__tests__/stripeBilling.test.ts
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';

const stripeMock = {
  products: { retrieve: jest.fn(), create: jest.fn() },
  prices: { list: jest.fn(), create: jest.fn() },
  taxRates: { list: jest.fn(), create: jest.fn() },
  customers: { create: jest.fn() },
  checkout: { sessions: { create: jest.fn() } },
  billingPortal: {
    configurations: { list: jest.fn(), create: jest.fn() },
    sessions: { create: jest.fn() },
  },
  subscriptions: { retrieve: jest.fn(), update: jest.fn() },
};
jest.mock('../../db/stripe', () => ({ stripe: stripeMock }));

import {
  subscriptionFields, createBillingCheckout, ensurePlatformPrices, syncSubscription,
} from '../platformBilling/stripeBilling';

beforeEach(() => {
  jest.clearAllMocks();
  stripeMock.prices.list.mockResolvedValue({ data: [] });
  stripeMock.products.retrieve.mockResolvedValue({ id: 'palova-club' });
  stripeMock.prices.create.mockImplementation(async (p: any) => ({ id: `price_${p.lookup_key}`, lookup_key: p.lookup_key }));
});

describe('ensurePlatformPrices', () => {
  it('crée les 8 prix manquants par lookup_key', async () => {
    const map = await ensurePlatformPrices();
    expect(stripeMock.prices.create).toHaveBeenCalledTimes(8);
    expect(map['palova_t1_month']).toBe('price_palova_t1_month');
    expect(stripeMock.prices.create).toHaveBeenCalledWith(expect.objectContaining({
      lookup_key: 'palova_t4_year', unit_amount: 152000, currency: 'eur',
      recurring: { interval: 'year' }, tax_behavior: 'exclusive',
    }));
  });

  it('ne recrée pas les prix existants', async () => {
    stripeMock.prices.list.mockResolvedValue({
      data: [{ id: 'price_x', lookup_key: 'palova_t1_month' }],
    });
    const map = await ensurePlatformPrices();
    expect(map['palova_t1_month']).toBe('price_x');
    expect(stripeMock.prices.create).toHaveBeenCalledTimes(7);
  });
});

describe('subscriptionFields', () => {
  it('extrait statut/palier/cadence/période depuis le lookup_key du price', () => {
    const sub: any = {
      status: 'active',
      cancel_at_period_end: false,
      items: { data: [{ price: { lookup_key: 'palova_t2_year' }, current_period_end: 1790000000 }] },
    };
    expect(subscriptionFields(sub)).toEqual({
      status: 'active', tier: 2, interval: 'year',
      currentPeriodEnd: new Date(1790000000 * 1000), cancelAtPeriodEnd: false,
    });
  });
  it('null si le price ne vient pas de Palova', () => {
    expect(subscriptionFields({ status: 'active', items: { data: [{ price: { lookup_key: 'autre' } }] } } as any)).toBeNull();
  });
});

describe('syncSubscription', () => {
  it('upsert la ligne PlatformSubscription', async () => {
    prismaMock.platformSubscription.upsert.mockResolvedValue({} as any);
    const sub: any = {
      id: 'sub_1', status: 'active', cancel_at_period_end: true,
      items: { data: [{ price: { lookup_key: 'palova_t1_month' }, current_period_end: 1790000000 }] },
    };
    await syncSubscription('club-1', sub);
    expect(prismaMock.platformSubscription.upsert).toHaveBeenCalledWith({
      where: { clubId: 'club-1' },
      update: expect.objectContaining({ stripeSubscriptionId: 'sub_1', status: 'active', tier: 1, cancelAtPeriodEnd: true }),
      create: expect.objectContaining({ clubId: 'club-1', stripeSubscriptionId: 'sub_1', tier: 1 }),
    });
  });
});

describe('createBillingCheckout', () => {
  beforeEach(() => {
    prismaMock.club.findUnique.mockResolvedValue({
      activeMemberCount: 200, platformCustomerId: 'cus_1', name: 'Club', slug: 'club',
      legalEmail: null, members: [],
    } as any);
    prismaMock.platformSubscription.findUnique.mockResolvedValue(null);
    stripeMock.taxRates.list.mockResolvedValue({ data: [{ id: 'txr_1', percentage: 20, display_name: 'TVA' }] });
    stripeMock.checkout.sessions.create.mockResolvedValue({ url: 'https://checkout.stripe.com/x' });
  });

  it('crée une session au prix du palier observé (200 membres → t2)', async () => {
    const url = await createBillingCheckout('club-1', 'month', 'https://club.palova.fr/admin/billing');
    expect(url).toBe('https://checkout.stripe.com/x');
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'subscription',
      customer: 'cus_1',
      client_reference_id: 'club-1',
      line_items: [{ price: 'price_palova_t2_month', quantity: 1 }],
      subscription_data: { default_tax_rates: ['txr_1'], metadata: { clubId: 'club-1' } },
    }));
  });

  it('refuse si déjà abonné (non canceled)', async () => {
    prismaMock.platformSubscription.findUnique.mockResolvedValue({ status: 'active' } as any);
    await expect(createBillingCheckout('club-1', 'month', 'https://x')).rejects.toThrow('ALREADY_SUBSCRIBED');
  });

  it('refuse si palier observé = 0', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ activeMemberCount: 10, platformCustomerId: 'cus_1', members: [] } as any);
    await expect(createBillingCheckout('club-1', 'month', 'https://x')).rejects.toThrow('NOTHING_TO_SUBSCRIBE');
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd backend; node node_modules/jest/bin/jest.js stripeBilling`
Expected: FAIL — module introuvable

- [ ] **Step 3: Implémenter `stripeBilling.ts`**

```typescript
// backend/src/services/platformBilling/stripeBilling.ts
// Plomberie Stripe Billing sur le COMPTE PLATEFORME (STRIPE_SECRET_KEY) — rien ici ne
// touche les comptes Connect des clubs. Prix retrouvés par lookup_key (aucun id en .env).
import Stripe from 'stripe';
import { stripe } from '../../db/stripe';
import { prisma } from '../../db/prisma';
import {
  PLATFORM_TIERS, BillingInterval, priceLookupKey, tierFromLookupKey, tierPriceCents, tierFor,
} from './tiers';

const PRODUCT_ID = 'palova-club';

async function ensurePlatformProduct(): Promise<void> {
  try {
    await stripe.products.retrieve(PRODUCT_ID);
  } catch {
    await stripe.products.create({ id: PRODUCT_ID, name: 'Palova Club' });
  }
}

/** Crée/retrouve les 8 Prices (paliers 1-4 × month/year). Renvoie lookup_key → price id. */
export async function ensurePlatformPrices(): Promise<Record<string, string>> {
  const keys: string[] = [];
  for (const t of PLATFORM_TIERS) {
    if (t.tier === 0) continue;
    keys.push(priceLookupKey(t.tier, 'month'), priceLookupKey(t.tier, 'year'));
  }
  const existing = await stripe.prices.list({ lookup_keys: keys, limit: 100 });
  const map: Record<string, string> = {};
  for (const p of existing.data) if (p.lookup_key) map[p.lookup_key] = p.id;

  const missing = keys.filter((k) => !map[k]);
  if (missing.length > 0) {
    await ensurePlatformProduct();
    for (const key of missing) {
      const parsed = tierFromLookupKey(key)!;
      const price = await stripe.prices.create({
        product: PRODUCT_ID,
        currency: 'eur',
        unit_amount: tierPriceCents(parsed.tier, parsed.interval),
        recurring: { interval: parsed.interval },
        lookup_key: key,
        tax_behavior: 'exclusive',
        nickname: `Palova palier ${parsed.tier} (${parsed.interval === 'year' ? 'annuel' : 'mensuel'})`,
      });
      map[key] = price.id;
    }
  }
  return map;
}

/** Tax Rate « TVA 20 % France » (idempotent par display_name + percentage actifs). */
export async function ensureTaxRate(): Promise<string> {
  const list = await stripe.taxRates.list({ active: true, limit: 100 });
  const found = list.data.find((t) => t.percentage === 20 && t.display_name === 'TVA');
  if (found) return found.id;
  const created = await stripe.taxRates.create({
    display_name: 'TVA', percentage: 20, inclusive: false, country: 'FR',
  });
  return created.id;
}

/** Customer du club sur le compte plateforme (créé au 1er besoin, email du gérant OWNER). */
export async function ensurePlatformCustomer(clubId: string): Promise<string> {
  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: {
      platformCustomerId: true, name: true, slug: true, legalEmail: true,
      members: { where: { role: 'OWNER' }, take: 1, select: { user: { select: { email: true } } } },
    },
  });
  if (!club) throw new Error('CLUB_NOT_FOUND');
  if (club.platformCustomerId) return club.platformCustomerId;

  const email = club.members[0]?.user.email ?? club.legalEmail ?? undefined;
  const customer = await stripe.customers.create({ name: club.name, email, metadata: { clubId } });
  await prisma.club.update({ where: { id: clubId }, data: { platformCustomerId: customer.id } });
  return customer.id;
}

/** Session Checkout d'abonnement au palier OBSERVÉ courant. Renvoie l'URL de paiement. */
export async function createBillingCheckout(
  clubId: string, interval: BillingInterval, returnUrl: string,
): Promise<string> {
  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: { activeMemberCount: true, platformCustomerId: true },
  });
  if (!club) throw new Error('CLUB_NOT_FOUND');

  const existing = await prisma.platformSubscription.findUnique({ where: { clubId } });
  if (existing && existing.status !== 'canceled') throw new Error('ALREADY_SUBSCRIBED');

  const tier = tierFor(club.activeMemberCount);
  if (tier === 0) throw new Error('NOTHING_TO_SUBSCRIBE');

  const [prices, taxRateId, customerId] = await Promise.all([
    ensurePlatformPrices(), ensureTaxRate(), ensurePlatformCustomer(clubId),
  ]);
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    client_reference_id: clubId,
    line_items: [{ price: prices[priceLookupKey(tier, interval)], quantity: 1 }],
    subscription_data: { default_tax_rates: [taxRateId], metadata: { clubId } },
    success_url: `${returnUrl}?checkout=success`,
    cancel_url: `${returnUrl}?checkout=cancelled`,
  });
  if (!session.url) throw new Error('STRIPE_NOT_CONFIGURED');
  return session.url;
}

/** Configuration du Customer Portal (factures + carte + annulation à échéance). */
async function ensurePortalConfiguration(): Promise<string> {
  const list = await stripe.billingPortal.configurations.list({ active: true, limit: 1 });
  if (list.data[0]) return list.data[0].id;
  const created = await stripe.billingPortal.configurations.create({
    business_profile: { headline: 'Palova — abonnement club' },
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: 'at_period_end' },
    },
  });
  return created.id;
}

/** Session Customer Portal (gérer carte, factures, annulation). */
export async function createBillingPortal(clubId: string, returnUrl: string): Promise<string> {
  const club = await prisma.club.findUnique({ where: { id: clubId }, select: { platformCustomerId: true } });
  if (!club?.platformCustomerId) throw new Error('NO_BILLING_ACCOUNT');
  const configuration = await ensurePortalConfiguration();
  const session = await stripe.billingPortal.sessions.create({
    customer: club.platformCustomerId, return_url: returnUrl, configuration,
  });
  return session.url;
}

/** Champs DB depuis un objet Subscription Stripe (null si price non-Palova). */
export function subscriptionFields(sub: Stripe.Subscription): {
  status: string; tier: number; interval: BillingInterval;
  currentPeriodEnd: Date | null; cancelAtPeriodEnd: boolean;
} | null {
  const item = sub.items?.data?.[0];
  const parsed = tierFromLookupKey(item?.price?.lookup_key ?? null);
  if (!parsed) return null;
  // current_period_end vit sur l'item depuis l'API Basil (2025-03), sur l'abonnement avant — tolérer les deux.
  const rawEnd = (item as any)?.current_period_end ?? (sub as any).current_period_end ?? null;
  return {
    status: sub.status,
    tier: parsed.tier,
    interval: parsed.interval,
    currentPeriodEnd: rawEnd ? new Date(rawEnd * 1000) : null,
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
  };
}

/** Upsert de la ligne PlatformSubscription depuis l'objet Stripe (webhook + checkout). */
export async function syncSubscription(clubId: string, sub: Stripe.Subscription): Promise<void> {
  const fields = subscriptionFields(sub);
  if (!fields) return;
  await prisma.platformSubscription.upsert({
    where: { clubId },
    update: { stripeSubscriptionId: sub.id, ...fields },
    create: { clubId, stripeSubscriptionId: sub.id, ...fields },
  });
}

/** Change le palier d'un abonnement — SANS prorata : effectif à la prochaine facture. */
export async function changeSubscriptionTier(stripeSubscriptionId: string, newTier: number): Promise<void> {
  const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
  const item = sub.items.data[0];
  const parsed = tierFromLookupKey(item.price.lookup_key ?? null);
  const interval: BillingInterval = parsed?.interval ?? 'month';
  const prices = await ensurePlatformPrices();
  await stripe.subscriptions.update(stripeSubscriptionId, {
    items: [{ id: item.id, price: prices[priceLookupKey(newTier, interval)] }],
    proration_behavior: 'none',
  });
}

/** Programme l'annulation à échéance (retour au palier gratuit). */
export async function cancelAtPeriodEnd(stripeSubscriptionId: string): Promise<void> {
  await stripe.subscriptions.update(stripeSubscriptionId, { cancel_at_period_end: true });
}
```

- [ ] **Step 4: Vérifier le PASS**

Run: `cd backend; node node_modules/jest/bin/jest.js stripeBilling`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/platformBilling/stripeBilling.ts backend/src/services/__tests__/stripeBilling.test.ts
git commit -m "feat(billing): plomberie Stripe Billing (prix lookup_key, checkout, portal, sync)"
```

---

### Task 6: Emails plateforme (`billingEmails.ts`)

**Files:**
- Create: `backend/src/services/platformBilling/billingEmails.ts`
- Test: `backend/src/services/__tests__/billingEmails.test.ts`

- [ ] **Step 1: Écrire les tests qui échouent**

```typescript
// backend/src/services/__tests__/billingEmails.test.ts
import {
  buildOverFreeTierEmail, buildTierChangeEmail, buildSubscribedEmail, eurosLabel,
} from '../platformBilling/billingEmails';

describe('eurosLabel', () => {
  it('formate les centimes en euros FR', () => {
    expect(eurosLabel(2900)).toBe('29 €');
    expect(eurosLabel(29600)).toBe('296 €');
    expect(eurosLabel(2950)).toBe('29,50 €');
  });
});

describe('buildOverFreeTierEmail', () => {
  it('objet + CTA vers /admin/billing du club, montant du palier observé', () => {
    const mail = buildOverFreeTierEmail({ clubName: 'Padel Arena', slug: 'padel-arena', activeMembers: 180, observedTier: 2 });
    expect(mail.subject).toContain('palier gratuit');
    expect(mail.html).toContain('180');
    expect(mail.html).toContain('59');
    expect(mail.html).toContain('/admin/billing');
    expect(mail.text).toContain('59');
  });
  it('échappe le nom du club', () => {
    const mail = buildOverFreeTierEmail({ clubName: '<b>x</b>', slug: 's', activeMembers: 60, observedTier: 1 });
    expect(mail.html).not.toContain('<b>x</b>');
  });
});

describe('buildTierChangeEmail', () => {
  it('montée : préavis avec nouveau montant', () => {
    const mail = buildTierChangeEmail({ clubName: 'C', slug: 's', fromTier: 1, toTier: 2, interval: 'month' });
    expect(mail.subject).toContain('palier');
    expect(mail.html).toContain('59');
  });
  it('retour au gratuit (toTier 0)', () => {
    const mail = buildTierChangeEmail({ clubName: 'C', slug: 's', fromTier: 1, toTier: 0, interval: 'month' });
    expect(mail.html.toLowerCase()).toContain('gratuit');
  });
});

describe('buildSubscribedEmail', () => {
  it('confirme palier + cadence', () => {
    const mail = buildSubscribedEmail({ clubName: 'C', slug: 's', tier: 3, interval: 'year' });
    expect(mail.html).toContain('1 010');
    expect(mail.subject.toLowerCase()).toContain('abonnement');
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd backend; node node_modules/jest/bin/jest.js billingEmails`
Expected: FAIL — module introuvable

- [ ] **Step 3: Implémenter les builders + notifiers**

```typescript
// backend/src/services/platformBilling/billingEmails.ts
// Emails PLATEFORME (identité Palova) envoyés au gérant du club — hors registre des
// emails personnalisables par club (qui sont les emails club → joueurs).
import { prisma } from '../../db/prisma';
import { sendMail } from '../../email/mailer';
import { renderLayout, PALOVA_BRAND, escapeHtml } from '../../email/templates/layout';
import { clubAppUrl } from '../../email/links';
import { tierLabel, tierPriceCents, BillingInterval } from './tiers';

export interface BuiltMail { subject: string; html: string; text: string }

/** 2900 → « 29 € », 2950 → « 29,50 € » (HT). */
export function eurosLabel(cents: number): string {
  const euros = cents / 100;
  const s = Number.isInteger(euros)
    ? euros.toLocaleString('fr-FR')
    : euros.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${s} €`;
}

function intervalLabel(interval: BillingInterval): string {
  return interval === 'year' ? 'annuel' : 'mensuel';
}

function priceLine(tier: number, interval: BillingInterval): string {
  const amount = eurosLabel(tierPriceCents(tier, interval));
  return interval === 'year' ? `${amount} HT/an` : `${amount} HT/mois`;
}

export function buildOverFreeTierEmail(input: {
  clubName: string; slug: string; activeMembers: number; observedTier: number;
}): BuiltMail {
  const url = clubAppUrl(input.slug, '/admin/billing');
  const price = priceLine(input.observedTier, 'month');
  const subject = `Palova — ${input.clubName} dépasse le palier gratuit`;
  const introHtml = `<p>Votre club compte <strong>${input.activeMembers} membres actifs</strong> sur les 90 derniers jours, `
    + `soit le palier <strong>${escapeHtml(tierLabel(input.observedTier))}</strong> de l'offre Palova (${escapeHtml(price)}).</p>`
    + `<p>Toutes vos fonctionnalités restent ouvertes — régularisez votre abonnement quand vous voulez depuis votre espace d'administration.</p>`;
  const html = renderLayout({
    brand: PALOVA_BRAND,
    heading: 'Votre club grandit 🎉',
    introHtml,
    infoRows: [
      { label: 'Membres actifs', value: String(input.activeMembers) },
      { label: 'Palier', value: tierLabel(input.observedTier) },
      { label: 'Tarif', value: price },
    ],
    ctaLabel: 'Souscrire',
    ctaUrl: url,
  });
  const text = `Votre club compte ${input.activeMembers} membres actifs (palier ${tierLabel(input.observedTier)}, ${price}). `
    + `Toutes vos fonctionnalités restent ouvertes — souscrivez depuis ${url}`;
  return { subject, html, text };
}

export function buildTierChangeEmail(input: {
  clubName: string; slug: string; fromTier: number; toTier: number; interval: BillingInterval;
}): BuiltMail {
  const url = clubAppUrl(input.slug, '/admin/billing');
  const subject = `Palova — changement de palier pour ${input.clubName}`;
  const isFree = input.toTier === 0;
  const introHtml = isFree
    ? `<p>Votre club est repassé sous les 50 membres actifs : votre abonnement s'arrêtera à la fin de la période en cours `
      + `et vous repasserez au <strong>palier gratuit</strong>. Rien d'autre ne change.</p>`
    : `<p>Le nombre de membres actifs de votre club correspond désormais au palier `
      + `<strong>${escapeHtml(tierLabel(input.toTier))}</strong>. Votre abonnement passera à `
      + `<strong>${escapeHtml(priceLine(input.toTier, input.interval))}</strong> à votre prochaine facture — `
      + `aucun prorata, le prix de la période en cours ne change pas.</p>`;
  const html = renderLayout({
    brand: PALOVA_BRAND,
    heading: 'Changement de palier',
    introHtml,
    infoRows: isFree ? [] : [
      { label: 'Ancien palier', value: tierLabel(input.fromTier) },
      { label: 'Nouveau palier', value: tierLabel(input.toTier) },
      { label: 'Nouveau tarif', value: priceLine(input.toTier, input.interval) },
    ],
    ctaLabel: 'Voir mon abonnement',
    ctaUrl: url,
  });
  const text = isFree
    ? `Votre club repasse au palier gratuit à la fin de la période en cours. Détails : ${url}`
    : `Nouveau palier ${tierLabel(input.toTier)} : ${priceLine(input.toTier, input.interval)} à la prochaine facture. Détails : ${url}`;
  return { subject, html, text };
}

export function buildSubscribedEmail(input: {
  clubName: string; slug: string; tier: number; interval: BillingInterval;
}): BuiltMail {
  const url = clubAppUrl(input.slug, '/admin/billing');
  const subject = `Palova — abonnement activé pour ${input.clubName}`;
  const introHtml = `<p>Merci ! L'abonnement <strong>${escapeHtml(tierLabel(input.tier))}</strong> `
    + `(${intervalLabel(input.interval)}, ${escapeHtml(priceLine(input.tier, input.interval))}) est actif. `
    + `Vos factures sont disponibles à tout moment depuis « Gérer mon abonnement ».</p>`;
  const html = renderLayout({
    brand: PALOVA_BRAND,
    heading: 'Abonnement activé',
    introHtml,
    infoRows: [
      { label: 'Palier', value: tierLabel(input.tier) },
      { label: 'Cadence', value: intervalLabel(input.interval) },
      { label: 'Tarif', value: priceLine(input.tier, input.interval) },
    ],
    ctaLabel: 'Mon abonnement',
    ctaUrl: url,
  });
  const text = `Abonnement Palova actif : ${tierLabel(input.tier)}, ${priceLine(input.tier, input.interval)}. ${url}`;
  return { subject, html, text };
}

/** Emails des gérants OWNER du club (repli legalEmail). */
async function ownerEmails(clubId: string): Promise<string[]> {
  const owners = await prisma.clubMember.findMany({
    where: { clubId, role: 'OWNER' },
    select: { user: { select: { email: true } } },
  });
  const emails = owners.map((o) => o.user.email).filter((e): e is string => Boolean(e));
  if (emails.length > 0) return emails;
  const club = await prisma.club.findUnique({ where: { id: clubId }, select: { legalEmail: true } });
  return club?.legalEmail ? [club.legalEmail] : [];
}

/** Envoi best-effort aux gérants — un échec SMTP ne casse JAMAIS l'appelant (cron/webhook). */
export async function sendToOwners(clubId: string, mail: BuiltMail): Promise<void> {
  try {
    const emails = await ownerEmails(clubId);
    for (const to of emails) {
      await sendMail({ to, subject: mail.subject, html: mail.html, text: mail.text });
    }
  } catch (err) {
    console.error('[billing] email non envoyé :', err);
  }
}
```

- [ ] **Step 4: Vérifier le PASS**

Run: `cd backend; node node_modules/jest/bin/jest.js billingEmails`
Expected: PASS. Si `renderLayout` exige un champ absent (ex. `preheader`), l'erreur TypeScript le dira — `heading`/`introHtml`/`brand` sont les seuls requis avec `ctaLabel`/`ctaUrl`/`infoRows` optionnels (vérifié dans `layout.ts`).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/platformBilling/billingEmails.ts backend/src/services/__tests__/billingEmails.test.ts
git commit -m "feat(billing): emails plateforme (relance, changement de palier, confirmation)"
```

---

### Task 7: Évaluation mensuelle (règles de palier)

**Files:**
- Modify: `backend/src/services/platformBilling/platformBilling.service.ts`
- Test: `backend/src/services/__tests__/platformBilling.service.test.ts` (bloc ajouté)

- [ ] **Step 1: Ajouter les tests des règles (échouent)**

Ajouter en tête du fichier de test, APRÈS les imports existants :

```typescript
jest.mock('../platformBilling/stripeBilling', () => ({
  changeSubscriptionTier: jest.fn().mockResolvedValue(undefined),
  cancelAtPeriodEnd: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../platformBilling/billingEmails', () => ({
  buildOverFreeTierEmail: jest.fn().mockReturnValue({ subject: 's', html: 'h', text: 't' }),
  buildTierChangeEmail: jest.fn().mockReturnValue({ subject: 's', html: 'h', text: 't' }),
  buildSubscribedEmail: jest.fn().mockReturnValue({ subject: 's', html: 'h', text: 't' }),
  sendToOwners: jest.fn().mockResolvedValue(undefined),
}));
import { changeSubscriptionTier, cancelAtPeriodEnd } from '../platformBilling/stripeBilling';
import { sendToOwners } from '../platformBilling/billingEmails';
```

Puis ajouter le bloc de tests en fin de fichier :

```typescript
describe('evaluateClub (règles de palier)', () => {
  const CLUB = { id: 'club-1', name: 'Club', slug: 'club', billingExempt: false };
  // Évaluation du 2026-08-01 → snapshot du mois écoulé '2026-07', mois précédent '2026-06'.
  const EVAL_NOW = new Date('2026-08-01T02:30:00Z');

  function mockCount(n: number) {
    jest.spyOn(service, 'countActiveMembers').mockResolvedValue(n);
  }
  function mockSub(sub: { status: string; tier: number; stripeSubscriptionId?: string; interval?: string } | null) {
    prismaMock.platformSubscription.findUnique.mockResolvedValue(
      sub ? { stripeSubscriptionId: 'sub_1', interval: 'month', cancelAtPeriodEnd: false, ...sub } as any : null,
    );
  }
  function mockPrevSnapshot(observedTier: number | null) {
    prismaMock.clubMemberSnapshot.findUnique.mockResolvedValue(
      observedTier === null ? null : ({ observedTier } as any),
    );
  }

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    prismaMock.clubMemberSnapshot.upsert.mockResolvedValue({} as any);
    prismaMock.platformSubscription.update.mockResolvedValue({} as any);
    prismaMock.club.update.mockResolvedValue({} as any);
  });

  it('écrit le snapshot du mois écoulé (upsert idempotent)', async () => {
    mockCount(60); mockSub(null); mockPrevSnapshot(null);
    await service.evaluateClub(CLUB, EVAL_NOW);
    expect(prismaMock.clubMemberSnapshot.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { clubId_month: { clubId: 'club-1', month: '2026-07' } },
      create: expect.objectContaining({ activeMembers: 60, observedTier: 1 }),
    }));
  });

  it('exempt → snapshot mais aucune action', async () => {
    mockCount(500); mockSub(null); mockPrevSnapshot(4);
    const action = await service.evaluateClub({ ...CLUB, billingExempt: true }, EVAL_NOW);
    expect(action).toBe('none');
    expect(sendToOwners).not.toHaveBeenCalled();
  });

  it('sans abonnement et palier ≥ 1 → relance email', async () => {
    mockCount(60); mockSub(null); mockPrevSnapshot(null);
    const action = await service.evaluateClub(CLUB, EVAL_NOW);
    expect(action).toBe('remind');
    expect(sendToOwners).toHaveBeenCalledWith('club-1', expect.anything());
  });

  it('sans abonnement et palier 0 → rien', async () => {
    mockCount(30); mockSub(null); mockPrevSnapshot(null);
    expect(await service.evaluateClub(CLUB, EVAL_NOW)).toBe('none');
  });

  it('montée : 1er mois au-dessus → pending (pas de swap)', async () => {
    mockCount(200); mockSub({ status: 'active', tier: 1 }); mockPrevSnapshot(1);
    const action = await service.evaluateClub(CLUB, EVAL_NOW);
    expect(action).toBe('pending_upgrade');
    expect(changeSubscriptionTier).not.toHaveBeenCalled();
  });

  it('montée : 2 mois consécutifs au-dessus → swap + email + maj DB', async () => {
    mockCount(200); mockSub({ status: 'active', tier: 1 }); mockPrevSnapshot(2);
    const action = await service.evaluateClub(CLUB, EVAL_NOW);
    expect(action).toBe('upgrade');
    expect(changeSubscriptionTier).toHaveBeenCalledWith('sub_1', 2);
    expect(prismaMock.platformSubscription.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { clubId: 'club-1' }, data: { tier: 2 },
    }));
    expect(sendToOwners).toHaveBeenCalled();
  });

  it('descente : dès 1 évaluation en dessous → swap', async () => {
    mockCount(100); mockSub({ status: 'active', tier: 2 }); mockPrevSnapshot(2);
    const action = await service.evaluateClub(CLUB, EVAL_NOW);
    expect(action).toBe('downgrade');
    expect(changeSubscriptionTier).toHaveBeenCalledWith('sub_1', 1);
  });

  it('descente à 0 → annulation à échéance', async () => {
    mockCount(30); mockSub({ status: 'active', tier: 1 }); mockPrevSnapshot(1);
    const action = await service.evaluateClub(CLUB, EVAL_NOW);
    expect(action).toBe('cancel');
    expect(cancelAtPeriodEnd).toHaveBeenCalledWith('sub_1');
    expect(prismaMock.platformSubscription.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { cancelAtPeriodEnd: true },
    }));
  });

  it('palier stable → aucune action', async () => {
    mockCount(200); mockSub({ status: 'active', tier: 2 }); mockPrevSnapshot(2);
    expect(await service.evaluateClub(CLUB, EVAL_NOW)).toBe('none');
    expect(changeSubscriptionTier).not.toHaveBeenCalled();
  });

  it('abonnement canceled = comme sans abonnement', async () => {
    mockCount(60); mockSub({ status: 'canceled', tier: 1 }); mockPrevSnapshot(null);
    expect(await service.evaluateClub(CLUB, EVAL_NOW)).toBe('remind');
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd backend; node node_modules/jest/bin/jest.js platformBilling.service`
Expected: FAIL — `evaluateClub is not a function`

- [ ] **Step 3: Implémenter l'évaluation dans le service**

Ajouter dans `platformBilling.service.ts` — imports en tête :

```typescript
import { DateTime } from 'luxon';
import { changeSubscriptionTier, cancelAtPeriodEnd } from './stripeBilling';
import { buildOverFreeTierEmail, buildTierChangeEmail, sendToOwners } from './billingEmails';
```

Et les méthodes/fonctions suivantes (dans la classe, après `refreshAllClubs`) :

```typescript
  /**
   * Évaluation mensuelle d'un club (appelée le 1er du mois) : snapshot du mois écoulé
   * + règles de palier. Montée = 2 mois consécutifs au-dessus ; descente = dès 1 mois ;
   * descente à 0 = annulation à échéance ; sans abonnement et palier ≥ 1 = relance.
   * Renvoie l'action décidée (pour les tests et les logs).
   */
  async evaluateClub(
    club: { id: string; name: string; slug: string; billingExempt: boolean },
    now: Date,
  ): Promise<'none' | 'remind' | 'pending_upgrade' | 'upgrade' | 'downgrade' | 'cancel'> {
    const paris = DateTime.fromJSDate(now, { zone: 'Europe/Paris' });
    const month = paris.minus({ months: 1 }).toFormat('yyyy-LL');     // mois écoulé
    const prevMonth = paris.minus({ months: 2 }).toFormat('yyyy-LL');

    const activeMembers = await this.countActiveMembers(club.id, now);
    const observedTier = tierFor(activeMembers);
    await prisma.clubMemberSnapshot.upsert({
      where: { clubId_month: { clubId: club.id, month } },
      update: { activeMembers, observedTier },
      create: { clubId: club.id, month, activeMembers, observedTier },
    });
    // Rafraîchit aussi la jauge vivante (le nocturne le fait déjà, mais autant être exact).
    await prisma.club.update({
      where: { id: club.id },
      data: { activeMemberCount: activeMembers, activeMemberCountAt: now },
    });

    if (club.billingExempt) return 'none';

    const sub = await prisma.platformSubscription.findUnique({ where: { clubId: club.id } });
    const live = sub && sub.status !== 'canceled' ? sub : null;

    if (!live) {
      if (observedTier === 0) return 'none';
      await sendToOwners(club.id, buildOverFreeTierEmail({
        clubName: club.name, slug: club.slug, activeMembers, observedTier,
      }));
      return 'remind';
    }

    if (observedTier === live.tier) return 'none';
    const interval = live.interval as 'month' | 'year';

    if (observedTier < live.tier) {
      if (observedTier === 0) {
        await cancelAtPeriodEnd(live.stripeSubscriptionId);
        await prisma.platformSubscription.update({
          where: { clubId: club.id }, data: { cancelAtPeriodEnd: true },
        });
        await sendToOwners(club.id, buildTierChangeEmail({
          clubName: club.name, slug: club.slug, fromTier: live.tier, toTier: 0, interval,
        }));
        return 'cancel';
      }
      await changeSubscriptionTier(live.stripeSubscriptionId, observedTier);
      await prisma.platformSubscription.update({
        where: { clubId: club.id }, data: { tier: observedTier },
      });
      await sendToOwners(club.id, buildTierChangeEmail({
        clubName: club.name, slug: club.slug, fromTier: live.tier, toTier: observedTier, interval,
      }));
      return 'downgrade';
    }

    // Montée : exige que le mois PRÉCÉDENT ait déjà été au-dessus du palier souscrit.
    const prev = await prisma.clubMemberSnapshot.findUnique({
      where: { clubId_month: { clubId: club.id, month: prevMonth } },
    });
    if (!prev || prev.observedTier <= live.tier) return 'pending_upgrade';

    await changeSubscriptionTier(live.stripeSubscriptionId, observedTier);
    await prisma.platformSubscription.update({
      where: { clubId: club.id }, data: { tier: observedTier },
    });
    await sendToOwners(club.id, buildTierChangeEmail({
      clubName: club.name, slug: club.slug, fromTier: live.tier, toTier: observedTier, interval,
    }));
    return 'upgrade';
  }

  /** Cron mensuel : évalue tous les clubs ACTIVE (un échec n'arrête pas la boucle). */
  async runMonthlyEvaluation(now: Date): Promise<void> {
    const clubs = await prisma.club.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true, slug: true, billingExempt: true },
    });
    for (const club of clubs) {
      try {
        const action = await this.evaluateClub(club, now);
        if (action !== 'none') console.log(`[billing] ${club.slug}: ${action}`);
      } catch (err) {
        console.error(`[billing] evaluation ${club.slug}:`, err);
      }
    }
  }
```

- [ ] **Step 4: Vérifier le PASS**

Run: `cd backend; node node_modules/jest/bin/jest.js platformBilling.service`
Expected: PASS (metering + billingState + règles)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/platformBilling/platformBilling.service.ts backend/src/services/__tests__/platformBilling.service.test.ts
git commit -m "feat(billing): evaluation mensuelle des paliers (montee 2 mois, descente 1, cancel a 0)"
```

---

### Task 8: Webhook Stripe Billing + montage app.ts

**Files:**
- Create: `backend/src/routes/platform-billing-webhooks.ts`
- Modify: `backend/src/app.ts` (montage raw, à côté du webhook Connect existant ligne ~53)
- Test: `backend/src/routes/__tests__/platform-billing.webhook.test.ts`

⚠️ Le chemin est **`/api/billing/webhooks`** (PAS `/api/platform/...` : `/api/platform` est monté derrière `authMiddleware + requireSuperAdmin` dans app.ts et intercepterait la requête Stripe). La spec est mise à jour en Task 16.

- [ ] **Step 1: Écrire les tests qui échouent**

```typescript
// backend/src/routes/__tests__/platform-billing.webhook.test.ts
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';

jest.mock('../../db/stripe', () => ({
  stripe: {
    webhooks: { constructEvent: jest.fn() },
    subscriptions: { retrieve: jest.fn() },
  },
}));
jest.mock('../../services/platformBilling/billingEmails', () => ({
  buildSubscribedEmail: jest.fn().mockReturnValue({ subject: 's', html: 'h', text: 't' }),
  sendToOwners: jest.fn().mockResolvedValue(undefined),
}));

import { stripe } from '../../db/stripe';
import app from '../../app';

const mockConstructEvent = stripe.webhooks.constructEvent as jest.Mock;
const mockRetrieve = stripe.subscriptions.retrieve as jest.Mock;
const URL = '/api/billing/webhooks';

const SUB = {
  id: 'sub_1', status: 'active', cancel_at_period_end: false,
  metadata: { clubId: 'club-1' },
  items: { data: [{ price: { lookup_key: 'palova_t2_month' }, current_period_end: 1790000000 }] },
};

beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.platformSubscription.upsert.mockResolvedValue({} as any);
  prismaMock.platformSubscription.updateMany.mockResolvedValue({ count: 1 } as any);
});

describe('POST /api/billing/webhooks', () => {
  it('400 sans signature', async () => {
    expect((await request(app).post(URL).send({})).status).toBe(400);
  });

  it('400 si signature invalide', async () => {
    mockConstructEvent.mockImplementation(() => { throw new Error('bad sig'); });
    const res = await request(app).post(URL).set('stripe-signature', 'sig').send({});
    expect(res.status).toBe(400);
  });

  it('checkout.session.completed → retrieve + upsert + email', async () => {
    mockConstructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: { object: { client_reference_id: 'club-1', subscription: 'sub_1' } },
    });
    mockRetrieve.mockResolvedValue(SUB);
    prismaMock.club.findUnique.mockResolvedValue({ name: 'C', slug: 's' } as any);
    const res = await request(app).post(URL).set('stripe-signature', 'sig').send({});
    expect(res.status).toBe(200);
    expect(mockRetrieve).toHaveBeenCalledWith('sub_1');
    expect(prismaMock.platformSubscription.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { clubId: 'club-1' },
    }));
  });

  it('customer.subscription.updated → sync via metadata.clubId', async () => {
    mockConstructEvent.mockReturnValue({ type: 'customer.subscription.updated', data: { object: SUB } });
    const res = await request(app).post(URL).set('stripe-signature', 'sig').send({});
    expect(res.status).toBe(200);
    expect(prismaMock.platformSubscription.upsert).toHaveBeenCalled();
  });

  it('invoice.payment_failed → statut past_due', async () => {
    mockConstructEvent.mockReturnValue({
      type: 'invoice.payment_failed',
      data: { object: { subscription: 'sub_1' } },
    });
    const res = await request(app).post(URL).set('stripe-signature', 'sig').send({});
    expect(res.status).toBe(200);
    expect(prismaMock.platformSubscription.updateMany).toHaveBeenCalledWith({
      where: { stripeSubscriptionId: 'sub_1' },
      data: { status: 'past_due' },
    });
  });

  it('événement inconnu → 200 sans effet', async () => {
    mockConstructEvent.mockReturnValue({ type: 'charge.refunded', data: { object: {} } });
    expect((await request(app).post(URL).set('stripe-signature', 'sig').send({})).status).toBe(200);
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd backend; node node_modules/jest/bin/jest.js platform-billing.webhook`
Expected: FAIL — 404 sur la route

- [ ] **Step 3: Implémenter le routeur webhook**

```typescript
// backend/src/routes/platform-billing-webhooks.ts
// Webhook Stripe Billing PLATEFORME (abonnements SaaS des clubs) — secret DÉDIÉ
// STRIPE_BILLING_WEBHOOK_SECRET, distinct du webhook Connect (stripe-webhooks.ts).
import { Router, Request, Response } from 'express';
import Stripe from 'stripe';
import { stripe } from '../db/stripe';
import { prisma } from '../db/prisma';
import { syncSubscription, subscriptionFields } from '../services/platformBilling/stripeBilling';
import { buildSubscribedEmail, sendToOwners } from '../services/platformBilling/billingEmails';

const router = Router();

/** Retrouve le club d'un abonnement : metadata.clubId, sinon par Customer. */
async function resolveClubId(sub: Stripe.Subscription): Promise<string | null> {
  const fromMeta = (sub.metadata?.clubId as string) || null;
  if (fromMeta) return fromMeta;
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  if (!customerId) return null;
  const club = await prisma.club.findFirst({ where: { platformCustomerId: customerId }, select: { id: true } });
  return club?.id ?? null;
}

router.post('/', async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'] as string;
  if (!sig) return void res.status(400).json({ error: 'Missing stripe-signature' });

  let event: ReturnType<typeof stripe.webhooks.constructEvent>;
  try {
    event = stripe.webhooks.constructEvent(
      req.body as Buffer,
      sig,
      process.env.STRIPE_BILLING_WEBHOOK_SECRET ?? '',
    );
  } catch {
    return void res.status(400).json({ error: 'Invalid webhook signature' });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const clubId = session.client_reference_id;
        const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
        if (clubId && subId) {
          const sub = await stripe.subscriptions.retrieve(subId);
          await syncSubscription(clubId, sub);
          // Email de confirmation best-effort.
          const club = await prisma.club.findUnique({ where: { id: clubId }, select: { name: true, slug: true } });
          const fields = subscriptionFields(sub);
          if (club && fields) {
            await sendToOwners(clubId, buildSubscribedEmail({
              clubName: club.name, slug: club.slug, tier: fields.tier, interval: fields.interval,
            }));
          }
        }
        break;
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const clubId = await resolveClubId(sub);
        if (clubId) await syncSubscription(clubId, sub);
        break;
      }

      case 'invoice.paid':
      case 'invoice.payment_failed': {
        // L'emplacement de l'id d'abonnement sur l'Invoice varie selon la version d'API — tolérer les deux.
        const invoice = event.data.object as any;
        const subId: string | null =
          (typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id)
          ?? invoice.parent?.subscription_details?.subscription ?? null;
        if (subId) {
          await prisma.platformSubscription.updateMany({
            where: { stripeSubscriptionId: subId },
            data: { status: event.type === 'invoice.paid' ? 'active' : 'past_due' },
          });
        }
        break;
      }
    }
  } catch (err) {
    // On répond 200 quand même : Stripe re-livre sinon en boucle ; l'état sera resynchronisé
    // par le prochain événement subscription.updated.
    console.error('[billing-webhook]', err);
  }

  res.json({ received: true });
});

export default router;
```

- [ ] **Step 4: Monter la route dans app.ts**

Dans `backend/src/app.ts` : ajouter l'import à côté de `stripeWebhooksRouter` (ligne ~27) :

```typescript
import platformBillingWebhooksRouter from './routes/platform-billing-webhooks';
```

Et le montage juste SOUS la ligne 53 (`app.use('/api/stripe/webhooks', …)`) :

```typescript
app.use('/api/billing/webhooks', express.raw({ type: 'application/json' }), platformBillingWebhooksRouter);
```

- [ ] **Step 5: Vérifier le PASS**

Run: `cd backend; node node_modules/jest/bin/jest.js platform-billing.webhook`
Expected: PASS (5 cas)

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/platform-billing-webhooks.ts backend/src/app.ts backend/src/routes/__tests__/platform-billing.webhook.test.ts
git commit -m "feat(billing): webhook Stripe Billing dedie (/api/billing/webhooks)"
```

---

### Task 9: Routes admin club (`/admin/billing`)

**Files:**
- Modify: `backend/src/routes/admin.ts` (imports, ERROR_STATUS, 3 routes avant `export default router`)
- Test: `backend/src/routes/__tests__/admin.billing.routes.test.ts`

- [ ] **Step 1: Écrire les tests qui échouent**

```typescript
// backend/src/routes/__tests__/admin.billing.routes.test.ts
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';

jest.mock('../../services/platformBilling/stripeBilling', () => ({
  createBillingCheckout: jest.fn(),
  createBillingPortal: jest.fn(),
}));

import { createBillingCheckout, createBillingPortal } from '../../services/platformBilling/stripeBilling';
import app from '../../app';

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET manquant');
const auth = { Authorization: `Bearer ${jwt.sign({ id: 'u1', email: 'owner@x.fr' }, process.env.JWT_SECRET!)}` };
const BASE = '/api/clubs/club-demo/admin/billing';

function mockRole(role: 'OWNER' | 'ADMIN' | 'STAFF') {
  prismaMock.clubMember.findUnique.mockResolvedValue({ userId: 'u1', clubId: 'club-demo', role } as any);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRole('ADMIN');
  prismaMock.club.findUnique.mockResolvedValue({
    activeMemberCount: 180, activeMemberCountAt: new Date('2026-07-07T04:00:00Z'), billingExempt: false,
  } as any);
  prismaMock.platformSubscription.findUnique.mockResolvedValue(null);
  prismaMock.clubMemberSnapshot.findMany.mockResolvedValue([
    { month: '2026-06', activeMembers: 170, observedTier: 2 },
  ] as any);
});

describe('GET /billing', () => {
  it('401 sans token', async () => {
    expect((await request(app).get(BASE)).status).toBe(401);
  });

  it('403 pour STAFF', async () => {
    mockRole('STAFF');
    expect((await request(app).get(BASE).set(auth)).status).toBe(403);
  });

  it('200 : état consolidé TO_REGULARIZE avec palier observé et prix', async () => {
    const res = await request(app).get(BASE).set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      activeMembers: 180,
      observedTier: 2,
      monthlyPriceCents: 5900,
      yearlyPriceCents: 60200,
      state: 'TO_REGULARIZE',
      subscription: null,
    });
    expect(res.body.snapshots).toHaveLength(1);
  });

  it('200 : abonnement actif → OK + détail', async () => {
    prismaMock.platformSubscription.findUnique.mockResolvedValue({
      status: 'active', tier: 2, interval: 'month',
      currentPeriodEnd: new Date('2026-08-01T00:00:00Z'), cancelAtPeriodEnd: false,
    } as any);
    const res = await request(app).get(BASE).set(auth);
    expect(res.body.state).toBe('OK');
    expect(res.body.subscription).toMatchObject({ tier: 2, interval: 'month', priceCents: 5900 });
  });
});

describe('POST /billing/checkout', () => {
  it('403 pour ADMIN (OWNER requis)', async () => {
    const res = await request(app).post(`${BASE}/checkout`).set(auth)
      .send({ interval: 'month', returnUrl: 'https://club.palova.fr/admin/billing' });
    expect(res.status).toBe(403);
  });

  it('200 pour OWNER : renvoie l URL de checkout', async () => {
    mockRole('OWNER');
    (createBillingCheckout as jest.Mock).mockResolvedValue('https://checkout.stripe.com/x');
    const res = await request(app).post(`${BASE}/checkout`).set(auth)
      .send({ interval: 'year', returnUrl: 'https://club.palova.fr/admin/billing' });
    expect(res.status).toBe(200);
    expect(res.body.url).toBe('https://checkout.stripe.com/x');
    expect(createBillingCheckout).toHaveBeenCalledWith('club-demo', 'year', 'https://club.palova.fr/admin/billing');
  });

  it('400 si interval invalide ou returnUrl non http', async () => {
    mockRole('OWNER');
    expect((await request(app).post(`${BASE}/checkout`).set(auth).send({ interval: 'week', returnUrl: 'https://x' })).status).toBe(400);
    expect((await request(app).post(`${BASE}/checkout`).set(auth).send({ interval: 'month', returnUrl: 'javascript:x' })).status).toBe(400);
  });

  it('409 si ALREADY_SUBSCRIBED', async () => {
    mockRole('OWNER');
    (createBillingCheckout as jest.Mock).mockRejectedValue(new Error('ALREADY_SUBSCRIBED'));
    const res = await request(app).post(`${BASE}/checkout`).set(auth)
      .send({ interval: 'month', returnUrl: 'https://x' });
    expect(res.status).toBe(409);
  });
});

describe('POST /billing/portal', () => {
  it('200 pour OWNER', async () => {
    mockRole('OWNER');
    (createBillingPortal as jest.Mock).mockResolvedValue('https://billing.stripe.com/p');
    const res = await request(app).post(`${BASE}/portal`).set(auth).send({ returnUrl: 'https://x' });
    expect(res.body.url).toBe('https://billing.stripe.com/p');
  });

  it('409 si NO_BILLING_ACCOUNT', async () => {
    mockRole('OWNER');
    (createBillingPortal as jest.Mock).mockRejectedValue(new Error('NO_BILLING_ACCOUNT'));
    expect((await request(app).post(`${BASE}/portal`).set(auth).send({ returnUrl: 'https://x' })).status).toBe(409);
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd backend; node node_modules/jest/bin/jest.js admin.billing.routes`
Expected: FAIL — 404

- [ ] **Step 3: Implémenter les routes dans admin.ts**

Imports à ajouter en tête d'`admin.ts` :

```typescript
import { billingState } from '../services/platformBilling/platformBilling.service';
import { createBillingCheckout, createBillingPortal } from '../services/platformBilling/stripeBilling';
import { tierFor, tierPriceCents, tierLabel } from '../services/platformBilling/tiers';
```

Entrées à ajouter dans `ERROR_STATUS` (celles qui n'y sont pas déjà — vérifier `STRIPE_NOT_CONFIGURED`, probablement présent) :

```typescript
  ALREADY_SUBSCRIBED:    409,
  NOTHING_TO_SUBSCRIBE:  409,
  NO_BILLING_ACCOUNT:    409,
```

Routes à ajouter juste avant `export default router;` :

```typescript
// ---- Abonnement Palova du club (facturation SaaS, offre au membre actif) ----

router.get('/billing', requireClubMember('ADMIN'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const clubId = req.membership!.clubId;
    const club = await prisma.club.findUnique({
      where: { id: clubId },
      select: { activeMemberCount: true, activeMemberCountAt: true, billingExempt: true },
    });
    if (!club) throw new Error('CLUB_NOT_FOUND');
    const [subscription, snapshots] = await Promise.all([
      prisma.platformSubscription.findUnique({ where: { clubId } }),
      prisma.clubMemberSnapshot.findMany({ where: { clubId }, orderBy: { month: 'desc' }, take: 12 }),
    ]);
    const observedTier = tierFor(club.activeMemberCount);
    const live = subscription && subscription.status !== 'canceled' ? subscription : null;
    res.json({
      activeMembers: club.activeMemberCount,
      countedAt: club.activeMemberCountAt,
      observedTier,
      tierLabel: tierLabel(observedTier),
      monthlyPriceCents: tierPriceCents(observedTier, 'month'),
      yearlyPriceCents: tierPriceCents(observedTier, 'year'),
      state: billingState({ billingExempt: club.billingExempt, observedTier, subscription }),
      subscription: live ? {
        status: live.status,
        tier: live.tier,
        tierLabel: tierLabel(live.tier),
        interval: live.interval,
        priceCents: tierPriceCents(live.tier, live.interval as 'month' | 'year'),
        currentPeriodEnd: live.currentPeriodEnd,
        cancelAtPeriodEnd: live.cancelAtPeriodEnd,
      } : null,
      snapshots: snapshots.map((s) => ({ month: s.month, activeMembers: s.activeMembers, tier: s.observedTier })),
    });
  } catch (e) { handleError(e, res, next); }
});

router.post('/billing/checkout', requireClubMember('OWNER'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const { interval, returnUrl } = req.body ?? {};
    if (interval !== 'month' && interval !== 'year') throw new Error('VALIDATION_ERROR');
    if (typeof returnUrl !== 'string' || !/^https?:\/\//.test(returnUrl)) throw new Error('VALIDATION_ERROR');
    const url = await createBillingCheckout(req.membership!.clubId, interval, returnUrl);
    res.json({ url });
  } catch (e) { handleError(e, res, next); }
});

router.post('/billing/portal', requireClubMember('OWNER'), async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const { returnUrl } = req.body ?? {};
    if (typeof returnUrl !== 'string' || !/^https?:\/\//.test(returnUrl)) throw new Error('VALIDATION_ERROR');
    const url = await createBillingPortal(req.membership!.clubId, returnUrl);
    res.json({ url });
  } catch (e) { handleError(e, res, next); }
});
```

- [ ] **Step 4: Vérifier le PASS**

Run: `cd backend; node node_modules/jest/bin/jest.js admin.billing.routes`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/admin.ts backend/src/routes/__tests__/admin.billing.routes.test.ts
git commit -m "feat(billing): routes admin /billing (etat consolide, checkout OWNER, portal)"
```

---

### Task 10: Job cron (nocturne + mensuel)

**Files:**
- Create: `backend/src/jobs/platformBilling.job.ts`
- Modify: `backend/src/app.ts` (démarrage du job, lignes ~22-23 et ~109-110)

- [ ] **Step 1: Implémenter le job**

```typescript
// backend/src/jobs/platformBilling.job.ts
import cron from 'node-cron';
import { PlatformBillingService } from '../services/platformBilling/platformBilling.service';
import { ensurePlatformPrices } from '../services/platformBilling/stripeBilling';

const service = new PlatformBillingService();

export function startPlatformBillingJob(): void {
  // Prix Stripe : best-effort au boot (échoue proprement en dev sans clé réelle).
  ensurePlatformPrices().catch((err) =>
    console.warn('[billing] ensurePlatformPrices ignoré :', (err as Error).message));

  // Nocturne 04:00 Europe/Paris : recompte des membres actifs (jauge /admin/billing).
  cron.schedule('0 4 * * *', async () => {
    try { await service.refreshAllClubs(new Date()); }
    catch (err) { console.error('[billing] refresh nocturne :', err); }
  }, { timezone: 'Europe/Paris' });

  // Mensuel, le 1er à 04:30 Europe/Paris : snapshots + règles de palier + relances.
  cron.schedule('30 4 1 * *', async () => {
    try { await service.runMonthlyEvaluation(new Date()); }
    catch (err) { console.error('[billing] évaluation mensuelle :', err); }
  }, { timezone: 'Europe/Paris' });
}
```

- [ ] **Step 2: Démarrer le job dans app.ts**

Import à côté des autres jobs (lignes ~22-23) :

```typescript
import { startPlatformBillingJob } from './jobs/platformBilling.job';
```

Appel à côté de `startCleanupJob(); startReminderJob();` (lignes ~109-110) :

```typescript
        startPlatformBillingJob();
```

- [ ] **Step 3: Vérifier que la suite backend complète passe toujours**

Run: `cd backend; node node_modules/jest/bin/jest.js`
Expected: PASS (les 3 échecs `icon.routes` connus en worktree sont la baseline acceptée ; en repo principal tout doit passer)

- [ ] **Step 4: Commit**

```bash
git add backend/src/jobs/platformBilling.job.ts backend/src/app.ts
git commit -m "feat(billing): cron nocturne (compteur) + mensuel (evaluation des paliers)"
```

---

### Task 11: Extensions superadmin backend (stats MRR, listClubs, exonération)

**Files:**
- Modify: `backend/src/services/platform.service.ts` (getStats, listClubs, + setBillingExempt)
- Modify: `backend/src/routes/platform.ts` (route PATCH billing-exempt)
- Test: `backend/src/services/__tests__/platform.service.test.ts` (bloc ajouté — le fichier existe déjà ; si son scaffolding diffère, adapter les mocks au style en place)

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter au fichier de test existant `platform.service.test.ts` (créer le bloc en fin de fichier ; les mocks Prisma suivent le pattern `prismaMock` déjà importé en tête du fichier) :

```typescript
describe('billing (stats + listClubs + exonération)', () => {
  it('getStats agrège MRR, paliers, à-régulariser, impayés', async () => {
    prismaMock.club.count.mockResolvedValue(0);
    prismaMock.user.count.mockResolvedValue(0);
    prismaMock.reservation.count.mockResolvedValue(0);
    prismaMock.tournament.count.mockResolvedValue(0);
    prismaMock.club.findMany.mockResolvedValue([
      // actif t2 mensuel → 5900 au MRR
      { activeMemberCount: 200, billingExempt: false, platformSubscription: { status: 'active', tier: 2, interval: 'month' } },
      // actif t3 annuel → 101000/12 arrondi = 8417
      { activeMemberCount: 500, billingExempt: false, platformSubscription: { status: 'active', tier: 3, interval: 'year' } },
      // à régulariser (t1 sans abonnement)
      { activeMemberCount: 60, billingExempt: false, platformSubscription: null },
      // impayé
      { activeMemberCount: 200, billingExempt: false, platformSubscription: { status: 'past_due', tier: 2, interval: 'month' } },
      // gratuit
      { activeMemberCount: 10, billingExempt: false, platformSubscription: null },
      // exonéré (gros club) — pas de MRR, pas de relance
      { activeMemberCount: 900, billingExempt: true, platformSubscription: null },
    ] as any);

    const stats = await new PlatformService().getStats();
    expect(stats.billing).toEqual({
      mrrCents: 5900 + Math.round(101000 / 12) + 5900,
      byTier: [1, 1, 2, 1, 1],
      toRegularize: 1,
      pastDue: 1,
    });
  });

  it('setBillingExempt valide et met à jour', async () => {
    prismaMock.club.update.mockResolvedValue({ id: 'c1', billingExempt: true } as any);
    const out = await new PlatformService().setBillingExempt('c1', true);
    expect(out).toEqual({ id: 'c1', billingExempt: true });
    await expect(new PlatformService().setBillingExempt('c1', 'oui' as any)).rejects.toThrow('VALIDATION_ERROR');
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd backend; node node_modules/jest/bin/jest.js platform.service`
Expected: FAIL — `billing` undefined / `setBillingExempt` absent

- [ ] **Step 3: Implémenter les extensions**

Dans `platform.service.ts` — imports :

```typescript
import { tierFor, tierPriceCents } from './platformBilling/tiers';
import { billingState, BillingState } from './platformBilling/platformBilling.service';
```

Étendre l'interface `PlatformStats` :

```typescript
export interface PlatformStats {
  clubs: { total: number; active: number; suspended: number };
  users: number;
  reservations: number;
  tournaments: number;
  billing: { mrrCents: number; byTier: number[]; toRegularize: number; pastDue: number };
}
```

Dans `getStats()`, ajouter au `Promise.all` existant un 7ᵉ élément puis calculer :

```typescript
    const [total, active, suspended, users, reservations, tournaments, billingClubs] = await Promise.all([
      prisma.club.count(),
      prisma.club.count({ where: { status: 'ACTIVE' } }),
      prisma.club.count({ where: { status: 'SUSPENDED' } }),
      prisma.user.count(),
      prisma.reservation.count(),
      prisma.tournament.count(),
      prisma.club.findMany({
        where: { status: 'ACTIVE' },
        select: {
          activeMemberCount: true, billingExempt: true,
          platformSubscription: { select: { status: true, tier: true, interval: true } },
        },
      }),
    ]);

    let mrrCents = 0; let toRegularize = 0; let pastDue = 0;
    const byTier = [0, 0, 0, 0, 0];
    for (const c of billingClubs) {
      const observedTier = tierFor(c.activeMemberCount);
      byTier[observedTier]++;
      const state = billingState({ billingExempt: c.billingExempt, observedTier, subscription: c.platformSubscription });
      if (state === 'TO_REGULARIZE') toRegularize++;
      if (state === 'PAST_DUE') pastDue++;
      const sub = c.platformSubscription;
      if (sub && sub.status !== 'canceled') {
        mrrCents += sub.interval === 'year'
          ? Math.round(tierPriceCents(sub.tier, 'year') / 12)
          : tierPriceCents(sub.tier, 'month');
      }
    }
    return {
      clubs: { total, active, suspended }, users, reservations, tournaments,
      billing: { mrrCents, byTier, toRegularize, pastDue },
    };
```

Dans `listClubs()` : ajouter au `include` existant :

```typescript
        platformSubscription: { select: { status: true, tier: true, interval: true } },
```

et au mapping de retour (dans l'objet renvoyé par `clubs.map`) :

```typescript
      billing: {
        activeMembers: c.activeMemberCount,
        observedTier: tierFor(c.activeMemberCount),
        state: billingState({
          billingExempt: c.billingExempt,
          observedTier: tierFor(c.activeMemberCount),
          subscription: c.platformSubscription,
        }) as BillingState,
        exempt: c.billingExempt,
        subscribedTier: c.platformSubscription && c.platformSubscription.status !== 'canceled'
          ? c.platformSubscription.tier : null,
      },
```

(`activeMemberCount`/`billingExempt` sont sur le modèle Club, déjà chargés par le findMany avec include — Prisma renvoie tous les scalaires quand on utilise `include`.)

Nouvelle méthode dans la classe :

```typescript
  /** Exonère (ou rétablit) la facturation d'un club — clubs partenaires/pilotes. */
  async setBillingExempt(id: string, exempt: unknown) {
    if (typeof exempt !== 'boolean') throw new Error('VALIDATION_ERROR');
    try {
      const club = await prisma.club.update({
        where: { id }, data: { billingExempt: exempt },
        select: { id: true, billingExempt: true },
      });
      return club;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        throw new Error('CLUB_NOT_FOUND');
      }
      throw err;
    }
  }
```

Dans `platform.ts` (routes), après la route `PATCH /clubs/:id` :

```typescript
// Exonération de facturation SaaS (clubs partenaires/pilotes).
router.patch('/clubs/:id/billing-exempt', async (req, res, next) => {
  try { res.json(await platform.setBillingExempt(req.params.id, req.body?.exempt)); }
  catch (err) { handleError(err, res, next); }
});
```

- [ ] **Step 4: Vérifier le PASS + suite complète**

Run: `cd backend; node node_modules/jest/bin/jest.js platform`
Expected: PASS (platform.service + platform.routes + platform-billing.webhook)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/platform.service.ts backend/src/routes/platform.ts backend/src/services/__tests__/platform.service.test.ts
git commit -m "feat(billing): stats MRR/paliers superadmin + exoneration de club"
```

---

### Task 12: Frontend `lib/api.ts` (types + méthodes)

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Ajouter les types**

À côté de `PlatformStats`/`PlatformClub` (~ligne 2269) :

```typescript
export type BillingState = 'EXEMPT' | 'FREE' | 'OK' | 'TO_REGULARIZE' | 'PAST_DUE';

export interface ClubBillingSubscription {
  status: string;
  tier: number;
  tierLabel: string;
  interval: 'month' | 'year';
  priceCents: number;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export interface ClubBilling {
  activeMembers: number;
  countedAt: string | null;
  observedTier: number;
  tierLabel: string;
  monthlyPriceCents: number;
  yearlyPriceCents: number;
  state: BillingState;
  subscription: ClubBillingSubscription | null;
  snapshots: { month: string; activeMembers: number; tier: number }[];
}

export interface PlatformClubBilling {
  activeMembers: number;
  observedTier: number;
  state: BillingState;
  exempt: boolean;
  subscribedTier: number | null;
}
```

Étendre `PlatformStats` (champ additif) :

```typescript
  billing: { mrrCents: number; byTier: number[]; toRegularize: number; pastDue: number };
```

Étendre `PlatformClub` (champ additif) :

```typescript
  billing: PlatformClubBilling;
```

- [ ] **Step 2: Ajouter les méthodes**

Près des méthodes admin (chercher `adminGetOnboardingStatus` pour le voisinage) :

```typescript
  // --- Abonnement Palova du club (facturation SaaS) ---
  adminGetBilling: (clubId: string, token: string) =>
    request<ClubBilling>(`/api/clubs/${clubId}/admin/billing`, {}, token),

  adminBillingCheckout: (clubId: string, interval: 'month' | 'year', returnUrl: string, token: string) =>
    request<{ url: string }>(`/api/clubs/${clubId}/admin/billing/checkout`, {
      method: 'POST', body: JSON.stringify({ interval, returnUrl }),
    }, token),

  adminBillingPortal: (clubId: string, returnUrl: string, token: string) =>
    request<{ url: string }>(`/api/clubs/${clubId}/admin/billing/portal`, {
      method: 'POST', body: JSON.stringify({ returnUrl }),
    }, token),
```

Près de `platformSetClubStatus` :

```typescript
  platformSetBillingExempt: (id: string, exempt: boolean, token: string) =>
    request<{ id: string; billingExempt: boolean }>(`/api/platform/clubs/${id}/billing-exempt`, {
      method: 'PATCH', body: JSON.stringify({ exempt }),
    }, token),
```

- [ ] **Step 3: Type-check**

Run: `cd frontend; node node_modules/typescript/bin/tsc --noEmit`
Expected: 0 erreur sur les fichiers touchés (scoper le grep aux fichiers modifiés si du WIP parallèle pollue la sortie)

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(billing): types et methodes api front (billing club + exoneration)"
```

---

### Task 13: Page `/admin/billing` + entrée sidebar

**Files:**
- Create: `frontend/app/admin/billing/page.tsx`
- Modify: `frontend/app/admin/layout.tsx` (entrée nav)
- Test: `frontend/__tests__/AdminBilling.test.tsx`

- [ ] **Step 1: Écrire les tests qui échouent**

```tsx
// frontend/__tests__/AdminBilling.test.tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AdminBillingPage from '@/app/admin/billing/page';

jest.mock('@/lib/useAuth', () => ({ useAuth: () => ({ token: 't', ready: true }) }));
jest.mock('@/lib/ClubProvider', () => ({ useClub: () => ({ club: { id: 'club-1', slug: 'club' } }) }));
jest.mock('@/lib/ThemeProvider', () => ({
  useTheme: () => ({ th: {
    fontUI: '', fontDisplay: '', fontMono: '', text: '#000', textMute: '#555', textFaint: '#999',
    bg: '#fff', bgElev: '#fff', line: '#eee', accent: '#06c', inkOn: '#fff',
  } }),
}));

const BILLING = {
  activeMembers: 180, countedAt: '2026-07-07T04:00:00Z',
  observedTier: 2, tierLabel: '151 – 400 membres actifs',
  monthlyPriceCents: 5900, yearlyPriceCents: 60200,
  state: 'TO_REGULARIZE',
  subscription: null,
  snapshots: [{ month: '2026-06', activeMembers: 170, tier: 2 }],
};

jest.mock('@/lib/api', () => ({
  api: {
    adminGetBilling: jest.fn().mockResolvedValue({
      activeMembers: 180, countedAt: '2026-07-07T04:00:00Z',
      observedTier: 2, tierLabel: '151 – 400 membres actifs',
      monthlyPriceCents: 5900, yearlyPriceCents: 60200,
      state: 'TO_REGULARIZE', subscription: null,
      snapshots: [{ month: '2026-06', activeMembers: 170, tier: 2 }],
    }),
    adminBillingCheckout: jest.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/x' }),
    adminBillingPortal: jest.fn().mockResolvedValue({ url: 'https://billing.stripe.com/p' }),
    getMyClubs: jest.fn().mockResolvedValue([{ clubId: 'club-1', slug: 'club', name: 'C', role: 'OWNER' }]),
  },
}));
import { api } from '@/lib/api';

describe('AdminBillingPage', () => {
  beforeEach(() => jest.clearAllMocks());

  it('affiche la jauge, le palier observé et le prix', async () => {
    render(<AdminBillingPage />);
    await waitFor(() => expect(screen.getByText('180')).toBeInTheDocument());
    expect(screen.getByText(/151 – 400 membres actifs/)).toBeInTheDocument();
    expect(screen.getByText(/59 €/)).toBeInTheDocument();
  });

  it('état à régulariser : bouton Souscrire visible pour OWNER, lance le checkout', async () => {
    render(<AdminBillingPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: /souscrire — mensuel/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /souscrire — mensuel/i }));
    await waitFor(() => expect(api.adminBillingCheckout).toHaveBeenCalledWith(
      'club-1', 'month', expect.stringContaining('/admin/billing'), 't',
    ));
  });

  it('ADMIN (non OWNER) : boutons de souscription absents, message à la place', async () => {
    (api.getMyClubs as jest.Mock).mockResolvedValue([{ clubId: 'club-1', slug: 'club', name: 'C', role: 'ADMIN' }]);
    render(<AdminBillingPage />);
    await waitFor(() => expect(screen.getByText('180')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /souscrire/i })).not.toBeInTheDocument();
    expect(screen.getByText(/réservée au gérant/i)).toBeInTheDocument();
  });

  it('abonnement actif : état OK + bouton Gérer (portal)', async () => {
    (api.adminGetBilling as jest.Mock).mockResolvedValue({
      ...BILLING, state: 'OK',
      subscription: {
        status: 'active', tier: 2, tierLabel: '151 – 400 membres actifs', interval: 'month',
        priceCents: 5900, currentPeriodEnd: '2026-08-01T00:00:00Z', cancelAtPeriodEnd: false,
      },
    });
    render(<AdminBillingPage />);
    await waitFor(() => expect(screen.getByText(/abonnement actif/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /gérer mon abonnement/i }));
    await waitFor(() => expect(api.adminBillingPortal).toHaveBeenCalled());
  });

  it('affiche l historique des snapshots', async () => {
    render(<AdminBillingPage />);
    await waitFor(() => expect(screen.getByText('2026-06')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd frontend; node node_modules/jest/bin/jest.js AdminBilling`
Expected: FAIL — module introuvable

- [ ] **Step 3: Implémenter la page**

```tsx
// frontend/app/admin/billing/page.tsx
'use client';
import { useEffect, useState, type CSSProperties } from 'react';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { api, ClubBilling } from '@/lib/api';
import { PLATFORM_TIERS, tierLabel } from '@/lib/platformTiers';
import { eurosFromCents } from '@/lib/payments';

const STATE_LABEL: Record<ClubBilling['state'], string> = {
  EXEMPT: 'Offert — club partenaire',
  FREE: 'Palier gratuit',
  OK: 'Abonnement actif',
  TO_REGULARIZE: 'À régulariser',
  PAST_DUE: 'Paiement en échec',
};

/** Jauge de membres actifs avec les seuils de paliers (50/150/400/800, échelle plafonnée à 1000). */
function MemberGauge({ count }: { count: number }) {
  const { th } = useTheme();
  const MAX = 1000;
  const pct = Math.min(100, (count / MAX) * 100);
  const thresholds = PLATFORM_TIERS.filter((t) => t.maxMembers !== null).map((t) => t.maxMembers as number);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{ fontFamily: th.fontMono, fontSize: 40, fontWeight: 700, color: th.text }}>{count}</span>
        <span style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute }}>membres actifs (90 derniers jours)</span>
      </div>
      <div style={{ position: 'relative', height: 10, borderRadius: 6, background: th.line, marginTop: 12 }}>
        <div style={{ position: 'absolute', inset: 0, width: `${pct}%`, borderRadius: 6, background: th.accent }} />
        {thresholds.map((m) => (
          <div key={m} title={`${m} membres`} style={{
            position: 'absolute', left: `${(m / MAX) * 100}%`, top: -3, bottom: -3, width: 2,
            background: th.textFaint, opacity: 0.6,
          }} />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontFamily: th.fontUI, fontSize: 11.5, color: th.textFaint }}>
        <span>0</span><span>50</span><span>150</span><span>400</span><span>800+</span>
      </div>
    </div>
  );
}

export default function AdminBillingPage() {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { club } = useClub();
  const clubId = club?.id;

  const [billing, setBilling] = useState<ClubBilling | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !token || !clubId) return;
    api.adminGetBilling(clubId, token).then(setBilling).catch(() => setBilling(null));
    api.getMyClubs(token)
      .then((clubs) => setIsOwner(clubs.find((c) => c.clubId === clubId)?.role === 'OWNER'))
      .catch(() => setIsOwner(false));
  }, [ready, token, clubId]);

  async function go(kind: 'checkout-month' | 'checkout-year' | 'portal') {
    if (!token || !clubId || busy) return;
    setBusy(kind); setError(null);
    const returnUrl = `${window.location.origin}/admin/billing`;
    try {
      const { url } = kind === 'portal'
        ? await api.adminBillingPortal(clubId, returnUrl, token)
        : await api.adminBillingCheckout(clubId, kind === 'checkout-year' ? 'year' : 'month', returnUrl, token);
      window.location.assign(url);
    } catch (err) {
      const m = (err as Error).message;
      setError(m === 'ALREADY_SUBSCRIBED' ? 'Votre club a déjà un abonnement actif.'
        : m === 'NOTHING_TO_SUBSCRIBE' ? 'Votre club est dans le palier gratuit : rien à souscrire.'
        : m === 'NO_BILLING_ACCOUNT' ? "Aucun abonnement n'a encore été souscrit pour ce club."
        : 'Le paiement en ligne est indisponible pour le moment. Réessayez plus tard.');
      setBusy(null);
    }
  }

  const card: CSSProperties = {
    background: th.bgElev, border: `1px solid ${th.line}`, borderRadius: 14, padding: '18px 20px', marginBottom: 16,
  };
  const btn: CSSProperties = {
    padding: '10px 18px', borderRadius: 10, border: 'none', cursor: 'pointer',
    fontFamily: th.fontUI, fontWeight: 700, fontSize: 14, background: th.accent, color: '#fff',
  };

  if (!billing) return <div style={{ color: th.textFaint, fontFamily: th.fontUI }}>Chargement…</div>;

  const sub = billing.subscription;
  const needsAction = billing.state === 'TO_REGULARIZE' || billing.state === 'PAST_DUE';

  return (
    <div style={{ maxWidth: 720 }}>
      <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 30, color: th.text, margin: '0 0 4px' }}>
        Abonnement Palova
      </h1>
      <p style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, margin: '0 0 20px' }}>
        Un seul plan tout inclus — le prix dépend du nombre de membres actifs de votre club.
      </p>

      {/* Jauge */}
      <section style={card}>
        <MemberGauge count={billing.activeMembers} />
        <div style={{ marginTop: 12, fontFamily: th.fontUI, fontSize: 13.5, color: th.text }}>
          Palier observé : <strong>{billing.tierLabel}</strong> — {billing.monthlyPriceCents === 0
            ? 'gratuit'
            : `${eurosFromCents(billing.monthlyPriceCents)} HT/mois ou ${eurosFromCents(billing.yearlyPriceCents)} HT/an (−15 %)`}
        </div>
        {billing.countedAt && (
          <div style={{ marginTop: 4, fontFamily: th.fontUI, fontSize: 11.5, color: th.textFaint }}>
            Compté le {new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' }).format(new Date(billing.countedAt))}
          </div>
        )}
      </section>

      {/* État + actions */}
      <section style={{ ...card, borderLeft: needsAction ? '4px solid #e8804f' : `1px solid ${th.line}` }}>
        <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 15, color: th.text }}>
          {STATE_LABEL[billing.state]}
        </div>

        {sub && (
          <div style={{ marginTop: 8, fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute }}>
            {sub.tierLabel} · {sub.interval === 'year' ? 'annuel' : 'mensuel'} · {eurosFromCents(sub.priceCents)} HT
            {sub.currentPeriodEnd && <> · prochaine échéance le {new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' }).format(new Date(sub.currentPeriodEnd))}</>}
            {sub.cancelAtPeriodEnd && <> · <strong>s&apos;arrête à échéance</strong></>}
          </div>
        )}

        {billing.state === 'FREE' && (
          <p style={{ marginTop: 8, fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute }}>
            Palova est gratuit jusqu&apos;à 50 membres actifs — toutes les fonctionnalités sont incluses.
          </p>
        )}
        {billing.state === 'TO_REGULARIZE' && (
          <p style={{ marginTop: 8, fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute }}>
            Votre club dépasse le palier gratuit. Toutes vos fonctionnalités restent ouvertes —
            souscrivez pour régulariser.
          </p>
        )}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
          {isOwner && !sub && billing.observedTier >= 1 && (
            <>
              <button style={btn} disabled={busy !== null} onClick={() => go('checkout-month')}>
                Souscrire — mensuel · {eurosFromCents(billing.monthlyPriceCents)} HT
              </button>
              <button style={{ ...btn, background: 'transparent', color: th.accent, border: `1.5px solid ${th.accent}` }}
                disabled={busy !== null} onClick={() => go('checkout-year')}>
                Souscrire — annuel −15 % · {eurosFromCents(billing.yearlyPriceCents)} HT
              </button>
            </>
          )}
          {isOwner && sub && (
            <button style={btn} disabled={busy !== null} onClick={() => go('portal')}>
              Gérer mon abonnement &amp; factures
            </button>
          )}
          {!isOwner && (billing.observedTier >= 1 || sub) && (
            <span style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textFaint }}>
              La souscription est réservée au gérant du club.
            </span>
          )}
        </div>
        {error && <div style={{ marginTop: 10, fontFamily: th.fontUI, fontSize: 13, color: '#c4472e' }}>{error}</div>}
      </section>

      {/* Historique */}
      {billing.snapshots.length > 0 && (
        <section style={card}>
          <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 14, color: th.text, marginBottom: 10 }}>
            Historique mensuel
          </div>
          {billing.snapshots.map((s) => (
            <div key={s.month} style={{
              display: 'flex', justifyContent: 'space-between', padding: '7px 0',
              borderBottom: `1px solid ${th.line}`, fontFamily: th.fontUI, fontSize: 13.5, color: th.text,
            }}>
              <span style={{ fontFamily: th.fontMono }}>{s.month}</span>
              <span>{s.activeMembers} membres actifs</span>
              <span style={{ color: th.textMute }}>{tierLabel(s.tier)}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Ajouter l'entrée sidebar**

Dans `frontend/app/admin/layout.tsx`, section nav « Paiement en ligne / Comptabilité / Offres prépayées » (~ligne 122-124), ajouter après `{ href: '/admin/packages', … }` :

```typescript
      { href: '/admin/billing',      label: 'Abonnement Palova', icon: 'wallet' },
```

- [ ] **Step 5: Vérifier le PASS**

Run: `cd frontend; node node_modules/jest/bin/jest.js AdminBilling`
Expected: PASS (5 cas)
Run aussi: `cd frontend; node node_modules/jest/bin/jest.js AdminLayout`
Expected: PASS (l'entrée nav ne casse pas la suite du layout)

- [ ] **Step 6: Commit**

```bash
git add frontend/app/admin/billing/page.tsx frontend/app/admin/layout.tsx frontend/__tests__/AdminBilling.test.tsx
git commit -m "feat(billing): page /admin/billing (jauge, etat, checkout/portal) + entree sidebar"
```

---

### Task 14: Bannière « à régulariser » sur le dashboard admin

**Files:**
- Create: `frontend/components/admin/BillingBanner.tsx`
- Modify: `frontend/app/admin/page.tsx` (insertion sous `StartChecklist`)
- Test: `frontend/__tests__/BillingBanner.test.tsx`

- [ ] **Step 1: Écrire les tests qui échouent**

```tsx
// frontend/__tests__/BillingBanner.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import { BillingBanner } from '@/components/admin/BillingBanner';

jest.mock('@/lib/ThemeProvider', () => ({
  useTheme: () => ({ th: { fontUI: '', text: '#000', textMute: '#555', accent: '#06c' } }),
}));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));

const getBilling = jest.fn();
jest.mock('@/lib/api', () => ({ api: { adminGetBilling: (...a: unknown[]) => getBilling(...a) } }));

describe('BillingBanner', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rien si l état est FREE ou OK', async () => {
    getBilling.mockResolvedValue({ state: 'FREE', activeMembers: 10, monthlyPriceCents: 0 });
    const { container } = render(<BillingBanner clubId="c1" token="t" />);
    await waitFor(() => expect(getBilling).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('bandeau si TO_REGULARIZE avec le prix du palier', async () => {
    getBilling.mockResolvedValue({ state: 'TO_REGULARIZE', activeMembers: 180, monthlyPriceCents: 5900 });
    render(<BillingBanner clubId="c1" token="t" />);
    await waitFor(() => expect(screen.getByText(/dépasse le palier gratuit/i)).toBeInTheDocument());
    expect(screen.getByText(/59 €/)).toBeInTheDocument();
  });

  it('bandeau si PAST_DUE', async () => {
    getBilling.mockResolvedValue({ state: 'PAST_DUE', activeMembers: 180, monthlyPriceCents: 5900 });
    render(<BillingBanner clubId="c1" token="t" />);
    await waitFor(() => expect(screen.getByText(/paiement .* échoué/i)).toBeInTheDocument());
  });

  it('rien si l API échoue', async () => {
    getBilling.mockRejectedValue(new Error('x'));
    const { container } = render(<BillingBanner clubId="c1" token="t" />);
    await waitFor(() => expect(getBilling).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd frontend; node node_modules/jest/bin/jest.js BillingBanner`
Expected: FAIL — module introuvable

- [ ] **Step 3: Implémenter la bannière**

```tsx
// frontend/components/admin/BillingBanner.tsx
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from '@/lib/ThemeProvider';
import { api, ClubBilling } from '@/lib/api';
import { eurosFromCents } from '@/lib/payments';

/**
 * Bandeau « relance douce » du dashboard admin : le club dépasse le palier gratuit
 * sans abonnement, ou son paiement échoue. On n'a JAMAIS rien de bloqué — c'est
 * une invitation, pas un verrou. Rien n'est rendu dans tous les autres états.
 */
export function BillingBanner({ clubId, token }: { clubId: string; token: string }) {
  const { th } = useTheme();
  const router = useRouter();
  const [billing, setBilling] = useState<ClubBilling | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.adminGetBilling(clubId, token)
      .then((b) => { if (!cancelled) setBilling(b); })
      .catch(() => { if (!cancelled) setBilling(null); });
    return () => { cancelled = true; };
  }, [clubId, token]);

  if (!billing || (billing.state !== 'TO_REGULARIZE' && billing.state !== 'PAST_DUE')) return null;

  const pastDue = billing.state === 'PAST_DUE';
  return (
    <div role="status" style={{
      display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
      background: 'rgba(232,128,79,0.12)', border: '1px solid rgba(232,128,79,0.5)',
      borderRadius: 12, padding: '12px 16px', margin: '0 0 18px',
    }}>
      <span style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.text, flex: 1, minWidth: 220 }}>
        {pastDue
          ? 'Le paiement de votre abonnement Palova a échoué — mettez votre carte à jour pour régulariser.'
          : <>Votre club dépasse le palier gratuit ({billing.activeMembers} membres actifs).
            Souscrivez pour {eurosFromCents(billing.monthlyPriceCents)} HT/mois — rien n&apos;est bloqué en attendant.</>}
      </span>
      <button onClick={() => router.push('/admin/billing')} style={{
        padding: '8px 14px', borderRadius: 9, border: 'none', cursor: 'pointer',
        fontFamily: th.fontUI, fontWeight: 700, fontSize: 13, background: '#e8804f', color: '#fff',
      }}>
        {pastDue ? 'Mettre à jour' : 'Voir l’offre'}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Insérer dans le dashboard**

Dans `frontend/app/admin/page.tsx` : ajouter l'import `import { BillingBanner } from '@/components/admin/BillingBanner';` puis, juste SOUS la ligne `{clubId && token && <StartChecklist clubId={clubId} token={token} />}` :

```tsx
      {clubId && token && <BillingBanner clubId={clubId} token={token} />}
```

- [ ] **Step 5: Vérifier le PASS**

Run: `cd frontend; node node_modules/jest/bin/jest.js BillingBanner`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/components/admin/BillingBanner.tsx frontend/app/admin/page.tsx frontend/__tests__/BillingBanner.test.tsx
git commit -m "feat(billing): banniere de relance douce sur le dashboard admin"
```

---

### Task 15: Superadmin — cartes MRR + colonnes clubs + exonération

**Files:**
- Modify: `frontend/app/superadmin/page.tsx`
- Modify: `frontend/app/superadmin/clubs/page.tsx`

- [ ] **Step 1: Cartes dashboard**

Dans `frontend/app/superadmin/page.tsx`, ajouter l'import `import { eurosFromCents } from '@/lib/payments';` et, dans la grille de cartes existante (après `<Card label="Tournois" …/>`), ajouter :

```tsx
          <Card label="MRR" value={eurosFromCents(stats.billing.mrrCents)}
            sub={`paliers : ${stats.billing.byTier.map((n, i) => `T${i}·${n}`).join('  ')}`} />
          <Card label="À régulariser" value={stats.billing.toRegularize} sub="clubs au-dessus du gratuit sans abonnement" />
          <Card label="Impayés" value={stats.billing.pastDue} sub="abonnements en échec de paiement" />
```

- [ ] **Step 2: Colonnes + action Exonérer dans la liste des clubs**

Dans `frontend/app/superadmin/clubs/page.tsx` :

1. Ajouter une colonne d'en-tête « Billing » dans le `<thead>` existant (après la colonne Adhérents/Ressources, avant Statut).
2. Dans chaque `<tr>` du `clubs.map`, ajouter la cellule (après les deux cellules compteurs) :

```tsx
                <td style={cell}>
                  <span style={{ fontFamily: th.fontMono, fontSize: 12.5 }}>{c.billing.activeMembers}</span>
                  <span style={{ color: th.textFaint, fontSize: 12 }}> actifs · T{c.billing.observedTier}</span><br />
                  <span style={{ fontSize: 12, fontWeight: 700, color:
                    c.billing.state === 'OK' ? th.accent
                    : c.billing.state === 'PAST_DUE' ? '#c4472e'
                    : c.billing.state === 'TO_REGULARIZE' ? '#e8804f'
                    : th.textFaint }}>
                    {{ EXEMPT: 'Exonéré', FREE: 'Gratuit', OK: 'Actif', TO_REGULARIZE: 'À régulariser', PAST_DUE: 'Impayé' }[c.billing.state]}
                  </span>
                </td>
```

3. Dans la cellule d'actions, ajouter un bouton avant « Changer l'alias » :

```tsx
                  <button onClick={() => toggleExempt(c)} style={{ ...actionBtn, marginRight: 8 }}>
                    {c.billing.exempt ? 'Rétablir la facturation' : 'Exonérer'}
                  </button>
```

4. Ajouter le handler dans le composant (près de `applyStatus`) :

```tsx
  async function toggleExempt(c: PlatformClub) {
    if (!token) return;
    try {
      await api.platformSetBillingExempt(c.id, !c.billing.exempt, token);
      await load(); // recharge la liste (fonction de rechargement existante de la page)
    } catch { /* superadmin : échec silencieux, la liste reste */ }
  }
```

(Si la fonction de rechargement de la page a un autre nom que `load`, utiliser celui du fichier — c'est le callback passé au `useEffect` initial.)

- [ ] **Step 3: Type-check + suite front**

Run: `cd frontend; node node_modules/typescript/bin/tsc --noEmit`
Expected: 0 erreur sur les fichiers touchés
Run: `cd frontend; node node_modules/jest/bin/jest.js superadmin --passWithNoTests`
Expected: PASS (pas de suite dédiée superadmin — le type-check est le filet)

- [ ] **Step 4: Commit**

```bash
git add frontend/app/superadmin/page.tsx frontend/app/superadmin/clubs/page.tsx
git commit -m "feat(billing): suivi superadmin (MRR, paliers, statut billing, exoneration)"
```

---

### Task 16: Page publique `/tarifs` + FAQ + spec

**Files:**
- Modify: `frontend/lib/platformContent.ts` (PLATFORM_TARIFS + entrée FAQ)
- Modify: `docs/superpowers/specs/2026-07-07-offre-membres-actifs-billing-design.md` (chemin webhook)

- [ ] **Step 1: Réécrire PLATFORM_TARIFS**

Remplacer intégralement la constante (pas de tableau markdown — le rendu `Markdown` du repo n'est pas garanti sur les tables ; listes et titres seulement) :

```typescript
export const PLATFORM_TARIFS = `# Tarifs Palova

**Un seul plan, tout inclus.** Vous payez selon la taille réelle de votre club — jamais pour des options. Et jamais plus de 149 € HT/mois.

## Comment ça marche

Le prix dépend de vos **membres actifs** : les joueurs qui ont réservé un terrain, participé à un tournoi, un événement ou un cours, ou acheté une formule dans les **90 derniers jours**. Le compteur est visible en permanence dans votre espace d'administration — pas de déclaration, pas de surprise.

## Les paliers (HT)

- **0 – 50 membres actifs — Gratuit, pour toujours.** Toutes les fonctionnalités incluses.
- **51 – 150 — 29 € / mois** (ou 296 € / an, −15 %)
- **151 – 400 — 59 € / mois** (ou 602 € / an)
- **401 – 800 — 99 € / mois** (ou 1 010 € / an)
- **Plus de 800 — 149 € / mois, plafonné** (ou 1 520 € / an)

Le palier s'ajuste automatiquement à la taille de votre club : à la hausse seulement après deux mois consécutifs au-dessus du seuil, à la baisse dès le premier mois. Aucun prorata en cours de période.

## Tout est inclus, à tous les paliers

Réservations en ligne, page club brandée (PWA installable), gestion des membres, abonnements et carnets, tournois & événements, caisse et comptabilité, encaissement en ligne via votre propre compte Stripe (**0 % de commission Palova**), multi-sports, emails automatiques personnalisables, statistiques.

## Multi-club / franchise

Contactez-nous : **contact@palova.fr**.

---

Chaque club encaisse directement ses adhérents via son propre compte Stripe : **les fonds vont au club**, Palova n'est pas intermédiaire de paiement.
`;
```

- [ ] **Step 2: Mettre à jour la FAQ**

Dans `PLATFORM_FAQ`, remplacer l'entrée `{ category: 'Facturation', question: 'Quelles sont les formules ?', … }` par :

```typescript
  { category: 'Facturation', question: 'Quelles sont les formules ?', answer: 'Un seul plan tout inclus, dont le prix dépend du nombre de membres actifs de votre club (joueurs ayant réservé ou participé dans les 90 derniers jours) : gratuit jusqu\'à 50, puis de 29 à 149 € HT/mois maximum. Voir la page Tarifs.' },
```

- [ ] **Step 3: Corriger le chemin du webhook dans la spec**

Dans `docs/superpowers/specs/2026-07-07-offre-membres-actifs-billing-design.md`, remplacer les deux occurrences de `/api/platform/billing/webhook` par `/api/billing/webhooks` avec la note : `(hors /api/platform, monté derrière requireSuperAdmin)`.

- [ ] **Step 4: Vérifier le rendu + tests contenus**

Run: `cd frontend; node node_modules/jest/bin/jest.js platformContent --passWithNoTests; node node_modules/typescript/bin/tsc --noEmit`
Expected: pas d'erreur

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/platformContent.ts docs/superpowers/specs/2026-07-07-offre-membres-actifs-billing-design.md
git commit -m "feat(billing): page /tarifs et FAQ sur l'offre au membre actif"
```

---

### Task 17: Config prod + documentation

**Files:**
- Modify: `backend/.env.prod.example` (variable webhook)
- Modify: `docker-compose.prod.yml` (pass-through de la variable)
- Modify: `CLAUDE.md` (nouvelle section feature)

- [ ] **Step 1: `.env.prod.example`**

Ajouter à côté de `STRIPE_WEBHOOK_SECRET` (suivre le format/commentaires du fichier existant) :

```
# Webhook Stripe BILLING (abonnements SaaS des clubs) — endpoint dédié
# https://api.palova.fr/api/billing/webhooks (événements : checkout.session.completed,
# customer.subscription.updated/deleted, invoice.paid, invoice.payment_failed).
STRIPE_BILLING_WEBHOOK_SECRET=
```

- [ ] **Step 2: `docker-compose.prod.yml`**

Dans le service backend, bloc `environment`, ajouter à côté de `STRIPE_WEBHOOK_SECRET` (même syntaxe que les lignes voisines) :

```yaml
      STRIPE_BILLING_WEBHOOK_SECRET: "${STRIPE_BILLING_WEBHOOK_SECRET}"
```

- [ ] **Step 3: Section CLAUDE.md**

Ajouter avant la section « À implémenter » :

```markdown
## Offre SaaS au membre actif + facturation Stripe Billing (v1) ✅ implémenté

Un seul plan **tout inclus**, prix au palier de **membres actifs** (90 j glissants : orga/participant de résa CONFIRMED — futures incluses —, inscription tournoi/event/cours non CANCELLED, achat carnet/abo) : 0 € ≤ 50 · 29 € ≤ 150 · 59 € ≤ 400 · 99 € ≤ 800 · **149 € plafonné**, annuel −15 %, HT + TVA 20 %. Source de vérité `backend/src/services/platformBilling/tiers.ts` + **miroir `frontend/lib/platformTiers.ts`** (garder synchro). Migration additive **`add_platform_billing`** (`Club.platformCustomerId/activeMemberCount(+At)/billingExempt`, modèles **`PlatformSubscription`** — ≠ `Subscription` joueur — et **`ClubMemberSnapshot`** `@@unique([clubId,month])`) — DEV via `prisma db execute`, prod `migrate deploy`. **Stripe Billing sur le compte plateforme** (`STRIPE_SECRET_KEY`) : prix par `lookup_key` `palova_t{1-4}_{month,year}` (`ensurePlatformPrices` idempotent au boot du job, produit `palova-club`), TVA 20 % (`ensureTaxRate`), **Checkout** au palier observé (`POST /admin/billing/checkout`, OWNER, gardes `ALREADY_SUBSCRIBED`/`NOTHING_TO_SUBSCRIBE`), **Customer Portal** (factures/carte/annulation), **webhook dédié `POST /api/billing/webhooks`** (`STRIPE_BILLING_WEBHOOK_SECRET` ⚠️ à déclarer en prod, monté en express.raw AVANT /api/platform qui est derrière requireSuperAdmin). **Cron `platformBilling.job`** : nocturne 04:00 (recompte `activeMemberCount`) + mensuel 1er 04:30 Europe/Paris (`runMonthlyEvaluation` : snapshot du mois écoulé + règles — **montée après 2 mois consécutifs**, **descente dès 1**, descente à 0 → `cancel_at_period_end`, price swap `proration_behavior:'none'` = effectif à la prochaine facture, jamais de prorata). **Jamais de blocage** : sans abonnement au-dessus du gratuit → état `TO_REGULARIZE` (helper pur `billingState` : EXEMPT/FREE/OK/TO_REGULARIZE/PAST_DUE) → bannière dashboard + email de relance mensuel aux OWNER (identité Palova, `billingEmails.ts`, best-effort). Front : page **`/admin/billing`** (« Abonnement Palova », jauge à seuils, souscription mensuel/annuel OWNER-only, portal, historique snapshots), `BillingBanner` sur `/admin`, superadmin (cartes MRR/à-régulariser/impayés + colonne billing + **Exonérer** `PATCH /api/platform/clubs/:id/billing-exempt` → `Club.billingExempt`), `/tarifs` réécrit. Tests : `platformTiers`/`platformBilling.service`/`stripeBilling`/`billingEmails`/`platform-billing.webhook`/`admin.billing.routes`/`platform.service` (back), `platformTiers`/`AdminBilling`/`BillingBanner` (front). Hors v1 : prix fondateur, coupons, gating de features, changement de cadence, Stripe Tax auto. Spec & plan : `docs/superpowers/{specs,plans}/2026-07-07-offre-membres-actifs-billing*`.
```

- [ ] **Step 4: Suites complètes des deux côtés**

Run: `cd backend; node node_modules/jest/bin/jest.js`
Expected: PASS
Run: `cd frontend; node node_modules/jest/bin/jest.js`
Expected: PASS (le flake connu BookingModal en suite complète est la baseline — vérifier ces suites isolément si besoin)
Run: `cd frontend; node node_modules/typescript/bin/tsc --noEmit` et `cd backend; node node_modules/typescript/bin/tsc --noEmit`
Expected: 0 erreur

- [ ] **Step 5: Commit final**

```bash
git add backend/.env.prod.example docker-compose.prod.yml CLAUDE.md
git commit -m "docs(billing): config prod (webhook billing) + section CLAUDE.md"
```

---

## Vérification manuelle de bout en bout (après toutes les tasks)

1. `start.ps1` (ou démarrer back+front) ; se connecter en gérant sur `padel-arena-paris` (user seedé OWNER).
2. `/admin/billing` : la jauge affiche 0 (le cron n'a pas tourné) — déclencher un recompte manuel :
   `cd backend; node -e "require('ts-node/register'); const {PlatformBillingService}=require('./src/services/platformBilling/platformBilling.service'); new PlatformBillingService().refreshAllClubs(new Date()).then(()=>process.exit(0))"`
   puis recharger la page → compteur non nul (données seedées).
3. Avec une vraie clé Stripe test dans `backend/.env` : « Souscrire — mensuel » → page Checkout Stripe (carte test 4242…) → retour `?checkout=success`. Lancer `stripe listen --forward-to localhost:3001/api/billing/webhooks` (CLI Stripe) pour la synchro locale, ou vérifier la ligne `platform_subscriptions` après le webhook.
4. Superadmin (`super@palova.fr`) : dashboard → carte MRR ; liste clubs → colonne billing + bouton Exonérer.
5. `/tarifs` (hôte plateforme) : nouvelle grille visible.
```
