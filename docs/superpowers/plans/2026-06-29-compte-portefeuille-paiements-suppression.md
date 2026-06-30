# Mon compte — Portefeuille, méthodes de paiement, historique & suppression — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner au joueur connecté, dans `/me/profile`, quatre nouvelles sections — Portefeuille (abos + soldes), Méthodes de paiement (carte enregistrée + retrait), Mes paiements (historique), et Supprimer mon compte (anonymisation avec garde-fous).

**Architecture:** Données club-scopées (carte, paiements) servies par de nouveaux services backend + routes sous `/api/clubs/:slug/me/*` ; suppression de compte (globale) sous `/api/me`. Front = nouvelles sections de la page profil existante, helpers purs testables, composants isolés. Deux migrations additives.

**Tech Stack:** Express 5 + Prisma 7 (PrismaPg adapter) + Stripe (compte connecté), Jest/supertest (backend), Next.js 16 + React 19 + React Testing Library (frontend).

**Spec:** `docs/superpowers/specs/2026-06-29-compte-portefeuille-paiements-suppression-design.md`

---

## ⚠️ Conventions de ce repo (à lire avant de commencer)

- **Prisma 7** : jamais `new PrismaClient()` seul — l'app utilise déjà l'adapter `PrismaPg` via `src/db/prisma.ts`. Tu n'instancies pas Prisma, tu importes `prisma`.
- **Migrations (dérive de base connue)** : `npx prisma migrate dev` veut RESET (interdit). Pour chaque migration : (1) éditer `schema.prisma`, (2) hand-author le fichier `migration.sql` (pour la prod / le versionnage), (3) en DEV appliquer via `npx prisma db push` (le repo l'a fait pour `add_member_notes_and_watch` à cause de la dérive), (4) `npx prisma generate`. Le SQL utilise `ADD COLUMN IF NOT EXISTS` pour cohabiter avec `db push`.
- **Docker** : `"C:\Program Files\Docker\Docker\resources\bin\docker-compose-v1.exe" up -d` (postgres+redis) si la base n'est pas démarrée.
- **OneDrive** : peut réverter des fichiers en cours de session. Après une désync : `npm install` + `npx prisma generate`. Vérifier que les fichiers ont bien persisté après chaque tâche.
- **Commits** : committer avec un pathspec explicite (`git commit -- <fichiers> -m …`), JAMAIS `git add -A`/`.` ni `git add <f> && git commit` (l'index peut déjà contenir le travail parallèle de l'utilisateur). Vérifier `git branch --show-current` avant chaque commit.
- **Tests backend** : `cd backend && npx jest <pattern>`. Mock Prisma = `import { prismaMock } from '../../__mocks__/prisma'` (cf. `me.routes.test.ts`).
- **Tests frontend** : `cd frontend && npx jest <pattern>`. Les suites qui mockent `@/lib/api` doivent exposer TOUTES les méthodes utilisées (sinon `undefined`).
- **tsc** : `cd backend && npx tsc --noEmit` et `cd frontend && npx tsc --noEmit` après chaque phase.

---

## File Structure

**Backend — créés :**
- `backend/prisma/migrations/20260629000001_add_saved_card_details/migration.sql` — colonnes carte sur `club_stripe_customers`.
- `backend/prisma/migrations/20260629000002_add_user_deleted_at/migration.sql` — colonne `deleted_at` sur `users`.
- `backend/src/services/paymentMethod.service.ts` — lecture/retrait de la carte enregistrée (compte connecté).
- `backend/src/services/paymentHistory.service.ts` — liste des paiements d'un joueur sur un club.
- `backend/src/services/account.service.ts` — résumé + anonymisation du compte.
- `backend/src/services/__tests__/paymentMethod.service.test.ts`
- `backend/src/services/__tests__/paymentHistory.service.test.ts`
- `backend/src/services/__tests__/account.service.test.ts`

**Backend — modifiés :**
- `backend/prisma/schema.prisma` — `ClubStripeCustomer` (+4 champs carte), `User` (+`deletedAt`).
- `backend/src/services/stripe.service.ts` — `getCardDetails`, `detachCard`.
- `backend/src/services/reservation.service.ts` — `cancelFutureReservationsForUser`.
- `backend/src/routes/clubs.ts` — `GET`/`DELETE /:slug/me/payment-method`, `GET /:slug/me/payments`.
- `backend/src/routes/me.ts` — `GET /account-deletion-summary`, `DELETE /`.
- `backend/src/routes/auth.ts` — login refuse `deletedAt`.
- `backend/src/services/__tests__/stripe.service.test.ts`, `backend/src/routes/__tests__/me.routes.test.ts`, `backend/src/routes/__tests__/auth.routes.test.ts` (ou nouveau).

**Frontend — créés :**
- `frontend/lib/payments.ts` — helpers purs (format euro, libellé méthode, libellé carte).
- `frontend/lib/__tests__/payments.test.ts`
- `frontend/components/profile/WalletSection.tsx`
- `frontend/components/profile/PaymentMethodSection.tsx`
- `frontend/components/profile/PaymentsHistory.tsx`
- `frontend/components/profile/DeleteAccountSection.tsx`
- `frontend/__tests__/WalletSection.test.tsx`, `PaymentMethodSection.test.tsx`, `PaymentsHistory.test.tsx`, `DeleteAccountSection.test.tsx`

**Frontend — modifiés :**
- `frontend/lib/api.ts` — types + méthodes.
- `frontend/app/me/profile/page.tsx` — chargements + sections + `navItems`.

---

## PHASE A — Backend : carte enregistrée (méthodes de paiement)

### Task A1: Migration + schéma `add_saved_card_details`

**Files:**
- Modify: `backend/prisma/schema.prisma` (model `ClubStripeCustomer`, ~ligne 800)
- Create: `backend/prisma/migrations/20260629000001_add_saved_card_details/migration.sql`

- [ ] **Step 1: Ajouter les champs au schéma**

Dans `model ClubStripeCustomer`, après `defaultPaymentMethodId`, ajouter :

```prisma
  cardBrand              String?  @map("card_brand")
  cardLast4              String?  @map("card_last4")
  cardExpMonth           Int?     @map("card_exp_month")
  cardExpYear            Int?     @map("card_exp_year")
```

- [ ] **Step 2: Écrire le SQL de migration**

Créer `backend/prisma/migrations/20260629000001_add_saved_card_details/migration.sql` :

```sql
-- Détails de la carte enregistrée (affichage « Visa •••• 4242 · exp 04/27 »).
-- Additif, nullable, backfill paresseux côté lecture.
ALTER TABLE "club_stripe_customers" ADD COLUMN IF NOT EXISTS "card_brand" TEXT;
ALTER TABLE "club_stripe_customers" ADD COLUMN IF NOT EXISTS "card_last4" TEXT;
ALTER TABLE "club_stripe_customers" ADD COLUMN IF NOT EXISTS "card_exp_month" INTEGER;
ALTER TABLE "club_stripe_customers" ADD COLUMN IF NOT EXISTS "card_exp_year" INTEGER;
```

- [ ] **Step 3: Appliquer en DEV + régénérer le client**

Run:
```bash
cd backend && npx prisma db push && npx prisma generate
```
Expected: « Your database is now in sync with your Prisma schema » + « Generated Prisma Client ». (Si `db push` propose une perte de données → STOP, ce ne devrait pas arriver pour des colonnes nullables.)

- [ ] **Step 4: Vérifier que ça compile**

Run: `cd backend && npx tsc --noEmit`
Expected: pas d'erreur (les nouveaux champs sont reconnus).

- [ ] **Step 5: Commit**

```bash
git commit -- backend/prisma/schema.prisma backend/prisma/migrations/20260629000001_add_saved_card_details/migration.sql -m "feat(compte): schéma — détails de carte enregistrée (ClubStripeCustomer)"
```

---

### Task A2: `StripeService.getCardDetails` + `detachCard`

**Files:**
- Modify: `backend/src/services/stripe.service.ts`
- Test: `backend/src/services/__tests__/stripe.service.test.ts`

- [ ] **Step 1: Écrire les tests (échouent)**

Dans `stripe.service.test.ts`, le mock `stripe` doit exposer `paymentMethods`. Repérer l'objet mock (au début du fichier, ex. `setupIntents: { create, retrieve }`) et ajouter :

```typescript
    paymentMethods: { retrieve: jest.fn(), detach: jest.fn() },
```

Puis ajouter ces blocs (en bas du fichier) :

```typescript
describe('getCardDetails', () => {
  it('retourne brand/last4/exp depuis le PaymentMethod du compte connecté', async () => {
    (prisma.club.findUnique as jest.Mock).mockResolvedValue({ stripeAccountId: 'acct_1' });
    (stripe.paymentMethods.retrieve as jest.Mock).mockResolvedValue({
      card: { brand: 'visa', last4: '4242', exp_month: 4, exp_year: 2027 },
    });
    const svc = new StripeService();
    const res = await svc.getCardDetails('club-1', 'pm_123');
    expect(res).toEqual({ brand: 'visa', last4: '4242', expMonth: 4, expYear: 2027 });
    expect(stripe.paymentMethods.retrieve).toHaveBeenCalledWith('pm_123', { stripeAccount: 'acct_1' });
  });

  it('lève STRIPE_NOT_CONFIGURED si le club n a pas de compte', async () => {
    (prisma.club.findUnique as jest.Mock).mockResolvedValue({ stripeAccountId: null });
    await expect(new StripeService().getCardDetails('club-1', 'pm_123')).rejects.toThrow('STRIPE_NOT_CONFIGURED');
  });
});

describe('detachCard', () => {
  it('détache le PaymentMethod sur le compte connecté', async () => {
    (prisma.club.findUnique as jest.Mock).mockResolvedValue({ stripeAccountId: 'acct_1' });
    (stripe.paymentMethods.detach as jest.Mock).mockResolvedValue({ id: 'pm_123' });
    await new StripeService().detachCard('club-1', 'pm_123');
    expect(stripe.paymentMethods.detach).toHaveBeenCalledWith('pm_123', undefined, { stripeAccount: 'acct_1' });
  });
});
```

- [ ] **Step 2: Lancer → échec**

Run: `cd backend && npx jest stripe.service -t "getCardDetails|detachCard"`
Expected: FAIL (`getCardDetails is not a function`).

- [ ] **Step 3: Implémenter**

Dans `stripe.service.ts`, ajouter ces méthodes dans la classe (avant `refundPaymentIntent`) :

```typescript
  /** Détails (marque/4 chiffres/expiration) d'une carte enregistrée, lus sur le compte connecté. */
  async getCardDetails(clubId: string, paymentMethodId: string): Promise<{ brand: string | null; last4: string | null; expMonth: number | null; expYear: number | null } | null> {
    const club = await prisma.club.findUnique({ where: { id: clubId }, select: { stripeAccountId: true } });
    if (!club?.stripeAccountId) throw new Error('STRIPE_NOT_CONFIGURED');
    const pm = await stripe.paymentMethods.retrieve(paymentMethodId, { stripeAccount: club.stripeAccountId });
    const card = pm.card;
    if (!card) return null;
    return { brand: card.brand ?? null, last4: card.last4 ?? null, expMonth: card.exp_month ?? null, expYear: card.exp_year ?? null };
  }

  /** Délie une carte du Customer (compte connecté). À appeler avant de nullifier defaultPaymentMethodId. */
  async detachCard(clubId: string, paymentMethodId: string): Promise<void> {
    const club = await prisma.club.findUnique({ where: { id: clubId }, select: { stripeAccountId: true } });
    if (!club?.stripeAccountId) throw new Error('STRIPE_NOT_CONFIGURED');
    await stripe.paymentMethods.detach(paymentMethodId, undefined, { stripeAccount: club.stripeAccountId });
  }
```

- [ ] **Step 4: Lancer → succès**

Run: `cd backend && npx jest stripe.service -t "getCardDetails|detachCard"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -- backend/src/services/stripe.service.ts backend/src/services/__tests__/stripe.service.test.ts -m "feat(compte): StripeService.getCardDetails + detachCard (compte connecté)"
```

---

### Task A3: `PaymentMethodService` (lecture + retrait)

**Files:**
- Create: `backend/src/services/paymentMethod.service.ts`
- Test: `backend/src/services/__tests__/paymentMethod.service.test.ts`

- [ ] **Step 1: Écrire les tests (échouent)**

Créer `backend/src/services/__tests__/paymentMethod.service.test.ts` :

```typescript
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';

const getCardDetails = jest.fn();
const detachCard = jest.fn();
jest.mock('../stripe.service', () => ({
  StripeService: jest.fn().mockImplementation(() => ({ getCardDetails, detachCard })),
}));

import { PaymentMethodService } from '../paymentMethod.service';

const ACTIVE = { id: 'club-1', status: 'ACTIVE' };

beforeEach(() => { getCardDetails.mockReset(); detachCard.mockReset(); });

describe('PaymentMethodService.getMyPaymentMethod', () => {
  it('null si aucune carte (defaultPaymentMethodId null)', async () => {
    prismaMock.club.findUnique.mockResolvedValue(ACTIVE as any);
    prismaMock.clubStripeCustomer.findUnique.mockResolvedValue({ defaultPaymentMethodId: null } as any);
    expect(await new PaymentMethodService().getMyPaymentMethod('demo', 'u1')).toBeNull();
  });

  it('renvoie les détails stockés sans appeler Stripe', async () => {
    prismaMock.club.findUnique.mockResolvedValue(ACTIVE as any);
    prismaMock.clubStripeCustomer.findUnique.mockResolvedValue({
      defaultPaymentMethodId: 'pm_1', cardBrand: 'visa', cardLast4: '4242', cardExpMonth: 4, cardExpYear: 2027,
    } as any);
    const res = await new PaymentMethodService().getMyPaymentMethod('demo', 'u1');
    expect(res).toEqual({ brand: 'visa', last4: '4242', expMonth: 4, expYear: 2027 });
    expect(getCardDetails).not.toHaveBeenCalled();
  });

  it('backfill depuis Stripe quand last4 absent (carte legacy)', async () => {
    prismaMock.club.findUnique.mockResolvedValue(ACTIVE as any);
    prismaMock.clubStripeCustomer.findUnique.mockResolvedValue({ defaultPaymentMethodId: 'pm_1', cardLast4: null } as any);
    getCardDetails.mockResolvedValue({ brand: 'mastercard', last4: '1111', expMonth: 1, expYear: 2030 });
    prismaMock.clubStripeCustomer.update.mockResolvedValue({} as any);
    const res = await new PaymentMethodService().getMyPaymentMethod('demo', 'u1');
    expect(getCardDetails).toHaveBeenCalledWith('club-1', 'pm_1');
    expect(prismaMock.clubStripeCustomer.update).toHaveBeenCalled();
    expect(res).toEqual({ brand: 'mastercard', last4: '1111', expMonth: 1, expYear: 2030 });
  });

  it('forme dégradée non bloquante si Stripe échoue au backfill', async () => {
    prismaMock.club.findUnique.mockResolvedValue(ACTIVE as any);
    prismaMock.clubStripeCustomer.findUnique.mockResolvedValue({ defaultPaymentMethodId: 'pm_1', cardLast4: null } as any);
    getCardDetails.mockRejectedValue(new Error('stripe down'));
    const res = await new PaymentMethodService().getMyPaymentMethod('demo', 'u1');
    expect(res).toEqual({ brand: null, last4: null, expMonth: null, expYear: null });
  });

  it('CLUB_NOT_FOUND si club inexistant ou suspendu', async () => {
    prismaMock.club.findUnique.mockResolvedValue(null as any);
    await expect(new PaymentMethodService().getMyPaymentMethod('demo', 'u1')).rejects.toThrow('CLUB_NOT_FOUND');
  });
});

describe('PaymentMethodService.removeMyPaymentMethod', () => {
  it('détache puis nullifie la carte', async () => {
    prismaMock.club.findUnique.mockResolvedValue(ACTIVE as any);
    prismaMock.clubStripeCustomer.findUnique.mockResolvedValue({ defaultPaymentMethodId: 'pm_1' } as any);
    detachCard.mockResolvedValue(undefined);
    prismaMock.clubStripeCustomer.update.mockResolvedValue({} as any);
    const res = await new PaymentMethodService().removeMyPaymentMethod('demo', 'u1');
    expect(detachCard).toHaveBeenCalledWith('club-1', 'pm_1');
    expect(prismaMock.clubStripeCustomer.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { defaultPaymentMethodId: null, cardBrand: null, cardLast4: null, cardExpMonth: null, cardExpYear: null },
    }));
    expect(res).toEqual({ ok: true });
  });

  it('nullifie même si le détachement Stripe échoue (best-effort)', async () => {
    prismaMock.club.findUnique.mockResolvedValue(ACTIVE as any);
    prismaMock.clubStripeCustomer.findUnique.mockResolvedValue({ defaultPaymentMethodId: 'pm_1' } as any);
    detachCard.mockRejectedValue(new Error('already detached'));
    prismaMock.clubStripeCustomer.update.mockResolvedValue({} as any);
    const res = await new PaymentMethodService().removeMyPaymentMethod('demo', 'u1');
    expect(prismaMock.clubStripeCustomer.update).toHaveBeenCalled();
    expect(res).toEqual({ ok: true });
  });

  it('ok:true sans rien faire si aucune carte', async () => {
    prismaMock.club.findUnique.mockResolvedValue(ACTIVE as any);
    prismaMock.clubStripeCustomer.findUnique.mockResolvedValue({ defaultPaymentMethodId: null } as any);
    const res = await new PaymentMethodService().removeMyPaymentMethod('demo', 'u1');
    expect(detachCard).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Lancer → échec**

Run: `cd backend && npx jest paymentMethod.service`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Implémenter le service**

Créer `backend/src/services/paymentMethod.service.ts` :

```typescript
import { prisma } from '../db/prisma';
import { StripeService } from './stripe.service';

export interface MyPaymentMethod {
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
}

/** Carte enregistrée du joueur sur un club (compte Stripe connecté). Lecture + retrait. */
export class PaymentMethodService {
  private stripe = new StripeService();

  private async clubActive(slug: string): Promise<{ id: string }> {
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, status: true } });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    return { id: club.id };
  }

  async getMyPaymentMethod(slug: string, userId: string): Promise<MyPaymentMethod | null> {
    const club = await this.clubActive(slug);
    const sc = await prisma.clubStripeCustomer.findUnique({
      where: { clubId_userId: { clubId: club.id, userId } },
      select: { defaultPaymentMethodId: true, cardBrand: true, cardLast4: true, cardExpMonth: true, cardExpYear: true },
    });
    if (!sc?.defaultPaymentMethodId) return null;
    if (sc.cardLast4) {
      return { brand: sc.cardBrand, last4: sc.cardLast4, expMonth: sc.cardExpMonth, expYear: sc.cardExpYear };
    }
    // Carte « legacy » (enregistrée avant le stockage des détails) : backfill paresseux, best-effort.
    try {
      const details = await this.stripe.getCardDetails(club.id, sc.defaultPaymentMethodId);
      if (details) {
        await prisma.clubStripeCustomer.update({
          where: { clubId_userId: { clubId: club.id, userId } },
          data: { cardBrand: details.brand, cardLast4: details.last4, cardExpMonth: details.expMonth, cardExpYear: details.expYear },
        });
        return details;
      }
    } catch {
      // Jamais bloquant : on renvoie une forme dégradée plutôt que de casser le profil.
    }
    return { brand: null, last4: null, expMonth: null, expYear: null };
  }

  async removeMyPaymentMethod(slug: string, userId: string): Promise<{ ok: true }> {
    const club = await this.clubActive(slug);
    const sc = await prisma.clubStripeCustomer.findUnique({
      where: { clubId_userId: { clubId: club.id, userId } },
      select: { defaultPaymentMethodId: true },
    });
    if (!sc?.defaultPaymentMethodId) return { ok: true };
    try {
      await this.stripe.detachCard(club.id, sc.defaultPaymentMethodId);
    } catch {
      // Best-effort : carte déjà détachée / erreur transitoire ne doit pas bloquer le retrait local.
    }
    await prisma.clubStripeCustomer.update({
      where: { clubId_userId: { clubId: club.id, userId } },
      data: { defaultPaymentMethodId: null, cardBrand: null, cardLast4: null, cardExpMonth: null, cardExpYear: null },
    });
    return { ok: true };
  }
}
```

- [ ] **Step 4: Lancer → succès**

Run: `cd backend && npx jest paymentMethod.service`
Expected: PASS (toutes).

- [ ] **Step 5: Commit**

```bash
git commit -- backend/src/services/paymentMethod.service.ts backend/src/services/__tests__/paymentMethod.service.test.ts -m "feat(compte): PaymentMethodService — lecture (backfill) + retrait de la carte"
```

---

### Task A4: Routes `GET`/`DELETE /api/clubs/:slug/me/payment-method`

**Files:**
- Modify: `backend/src/routes/clubs.ts` (instancier le service + 2 routes, près de `/:slug/me/card-status` ~ligne 314)
- Test: `backend/src/routes/__tests__/clubs.payment-method.routes.test.ts` (créé)

- [ ] **Step 1: Écrire le test de routes (échoue)**

Créer `backend/src/routes/__tests__/clubs.payment-method.routes.test.ts` :

```typescript
import '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const getMyPaymentMethod = jest.fn();
const removeMyPaymentMethod = jest.fn();
jest.mock('../../services/paymentMethod.service', () => ({
  PaymentMethodService: jest.fn().mockImplementation(() => ({ getMyPaymentMethod, removeMyPaymentMethod })),
}));

import app from '../../app';
const token = () => jwt.sign({ id: 'u1', email: 't@x.fr' }, process.env.JWT_SECRET!);

beforeEach(() => { getMyPaymentMethod.mockReset(); removeMyPaymentMethod.mockReset(); });

describe('GET /api/clubs/:slug/me/payment-method', () => {
  it('401 sans token', async () => {
    const res = await request(app).get('/api/clubs/demo/me/payment-method');
    expect(res.status).toBe(401);
  });
  it('200 + la carte', async () => {
    getMyPaymentMethod.mockResolvedValue({ brand: 'visa', last4: '4242', expMonth: 4, expYear: 2027 });
    const res = await request(app).get('/api/clubs/demo/me/payment-method').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body.last4).toBe('4242');
    expect(getMyPaymentMethod).toHaveBeenCalledWith('demo', 'u1');
  });
});

describe('DELETE /api/clubs/:slug/me/payment-method', () => {
  it('200 ok:true', async () => {
    removeMyPaymentMethod.mockResolvedValue({ ok: true });
    const res = await request(app).delete('/api/clubs/demo/me/payment-method').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(removeMyPaymentMethod).toHaveBeenCalledWith('demo', 'u1');
  });
});
```

- [ ] **Step 2: Lancer → échec**

Run: `cd backend && npx jest clubs.payment-method.routes`
Expected: FAIL (routes 404 / service introuvable).

- [ ] **Step 3: Implémenter**

Dans `clubs.ts`, ajouter l'import + l'instance (près des autres, ~ligne 39) :

```typescript
import { PaymentMethodService } from '../services/paymentMethod.service';
```
```typescript
const paymentMethodService = new PaymentMethodService();
```

Puis, après la route `/:slug/me/card-status` (~ligne 317), ajouter :

```typescript
// Carte enregistrée du joueur (marque + 4 chiffres + expiration).
router.get('/:slug/me/payment-method', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await paymentMethodService.getMyPaymentMethod(asString(req.params.slug), req.user!.id)); }
  catch (err) { handleError(err, res, next); }
});

// Retrait de la carte enregistrée du joueur.
router.delete('/:slug/me/payment-method', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await paymentMethodService.removeMyPaymentMethod(asString(req.params.slug), req.user!.id)); }
  catch (err) { handleError(err, res, next); }
});
```

- [ ] **Step 4: Lancer → succès + tsc**

Run: `cd backend && npx jest clubs.payment-method.routes && npx tsc --noEmit`
Expected: PASS + pas d'erreur tsc.

- [ ] **Step 5: Commit**

```bash
git commit -- backend/src/routes/clubs.ts backend/src/routes/__tests__/clubs.payment-method.routes.test.ts -m "feat(compte): routes GET/DELETE /api/clubs/:slug/me/payment-method"
```

---

## PHASE B — Backend : historique de paiements

### Task B1: `PaymentHistoryService.listMyPaymentsBySlug`

**Files:**
- Create: `backend/src/services/paymentHistory.service.ts`
- Test: `backend/src/services/__tests__/paymentHistory.service.test.ts`

- [ ] **Step 1: Écrire les tests (échouent)**

Créer `backend/src/services/__tests__/paymentHistory.service.test.ts` :

```typescript
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { PaymentHistoryService } from '../paymentHistory.service';

const ACTIVE = { id: 'club-1', status: 'ACTIVE', timezone: 'Europe/Paris' };

describe('PaymentHistoryService.listMyPaymentsBySlug', () => {
  it('CLUB_NOT_FOUND si club inexistant', async () => {
    prismaMock.club.findUnique.mockResolvedValue(null as any);
    await expect(new PaymentHistoryService().listMyPaymentsBySlug('demo', 'u1')).rejects.toThrow('CLUB_NOT_FOUND');
  });

  it('mappe montants en centimes + libellés selon la source', async () => {
    prismaMock.club.findUnique.mockResolvedValue(ACTIVE as any);
    prismaMock.payment.findMany.mockResolvedValue([
      { id: 'p1', amount: '25.00', refundedAmount: '0', method: 'CARD', status: 'CAPTURED',
        createdAt: new Date('2026-06-14T12:00:00Z'),
        reservation: { startTime: new Date('2026-06-14T16:00:00Z'), resource: { name: 'Court 2' } },
        memberPackage: null, sourcePackage: null, subscriptionSale: null, tournamentRegistration: null, eventRegistration: null },
      { id: 'p2', amount: '80.00', refundedAmount: '10.00', method: 'ONLINE', status: 'PARTIALLY_REFUNDED',
        createdAt: new Date('2026-06-01T09:00:00Z'),
        reservation: null, memberPackage: { template: { name: 'Carnet 10' } },
        sourcePackage: null, subscriptionSale: null, tournamentRegistration: null, eventRegistration: null },
    ] as any);

    const res = await new PaymentHistoryService().listMyPaymentsBySlug('demo', 'u1');
    expect(res[0]).toMatchObject({ id: 'p1', amountCents: 2500, refundedCents: 0, method: 'CARD' });
    expect(res[0].label).toContain('Court 2');
    expect(res[1]).toMatchObject({ id: 'p2', amountCents: 8000, refundedCents: 1000 });
    expect(res[1].label).toContain('Carnet 10');
  });

  it('scope la requête au club et au joueur (OR multi-relations)', async () => {
    prismaMock.club.findUnique.mockResolvedValue(ACTIVE as any);
    prismaMock.payment.findMany.mockResolvedValue([] as any);
    await new PaymentHistoryService().listMyPaymentsBySlug('demo', 'u1');
    const arg = (prismaMock.payment.findMany as jest.Mock).mock.calls[0][0];
    expect(arg.where.OR.length).toBeGreaterThanOrEqual(6);
    expect(arg.orderBy).toEqual({ createdAt: 'desc' });
    expect(arg.take).toBe(100);
  });
});
```

- [ ] **Step 2: Lancer → échec**

Run: `cd backend && npx jest paymentHistory.service`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Implémenter**

Créer `backend/src/services/paymentHistory.service.ts` :

```typescript
import { DateTime } from 'luxon';
import { prisma } from '../db/prisma';

const cents = (v: unknown): number => Math.round(Number(v ?? 0) * 100);

export interface MyPayment {
  id: string;
  date: string;          // ISO
  amountCents: number;
  refundedCents: number;
  method: string;
  status: string;
  label: string;
}

/** Historique des paiements d'un joueur sur un club. Attribution multi-source (cf. MemberStatsService). */
export class PaymentHistoryService {
  async listMyPaymentsBySlug(slug: string, userId: string): Promise<MyPayment[]> {
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, status: true, timezone: true } });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    const clubId = club.id;
    const tz = club.timezone;

    const payments = await prisma.payment.findMany({
      where: {
        OR: [
          { reservation: { is: { userId, resource: { clubId } } }, participantId: null },
          { participant: { is: { userId, reservation: { resource: { clubId } } } } },
          { memberPackage: { is: { userId, clubId } } },
          { sourcePackage: { is: { userId, clubId } } },
          { subscriptionSale: { is: { userId, clubId } } },
          { sourceSubscription: { is: { userId, clubId } } },
          { tournamentRegistration: { is: { captainUserId: userId, tournament: { clubId } } } },
          { eventRegistration: { is: { userId, event: { clubId } } } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true, amount: true, refundedAmount: true, method: true, status: true, createdAt: true,
        reservation: { select: { startTime: true, resource: { select: { name: true } } } },
        memberPackage: { select: { template: { select: { name: true } } } },
        sourcePackage: { select: { template: { select: { name: true } } } },
        subscriptionSale: { select: { plan: { select: { name: true } } } },
        tournamentRegistration: { select: { tournament: { select: { name: true } } } },
        eventRegistration: { select: { event: { select: { name: true } } } },
      },
    });

    const shortDate = (d: Date) => DateTime.fromJSDate(d).setZone(tz).toFormat('dd/MM/yyyy');

    return payments.map((p) => ({
      id: p.id,
      date: p.createdAt.toISOString(),
      amountCents: cents(p.amount),
      refundedCents: cents(p.refundedAmount),
      method: p.method,
      status: p.status,
      label: this.label(p, shortDate),
    }));
  }

  // Priorité de libellé : réservation > vente carnet > vente abo > inscription > consommation carnet.
  private label(p: {
    reservation: { startTime: Date; resource: { name: string } } | null;
    memberPackage: { template: { name: string } } | null;
    sourcePackage: { template: { name: string } } | null;
    subscriptionSale: { plan: { name: string } } | null;
    tournamentRegistration: { tournament: { name: string } } | null;
    eventRegistration: { event: { name: string } } | null;
  }, shortDate: (d: Date) => string): string {
    if (p.reservation) return `Réservation ${p.reservation.resource.name} · ${shortDate(p.reservation.startTime)}`;
    if (p.memberPackage) return `Achat — ${p.memberPackage.template.name}`;
    if (p.subscriptionSale) return `Abonnement — ${p.subscriptionSale.plan.name}`;
    if (p.tournamentRegistration) return `Inscription — ${p.tournamentRegistration.tournament.name}`;
    if (p.eventRegistration) return `Inscription — ${p.eventRegistration.event.name}`;
    if (p.sourcePackage) return `Conso. — ${p.sourcePackage.template.name}`;
    return 'Paiement';
  }
}
```

- [ ] **Step 4: Lancer → succès**

Run: `cd backend && npx jest paymentHistory.service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -- backend/src/services/paymentHistory.service.ts backend/src/services/__tests__/paymentHistory.service.test.ts -m "feat(compte): PaymentHistoryService — historique de paiements joueur/club"
```

---

### Task B2: Route `GET /api/clubs/:slug/me/payments`

**Files:**
- Modify: `backend/src/routes/clubs.ts`
- Test: `backend/src/routes/__tests__/clubs.payment-method.routes.test.ts` (réutilise le fichier de A4)

- [ ] **Step 1: Étendre le test (échoue)**

Dans `clubs.payment-method.routes.test.ts`, en haut ajouter au mock un service d'historique :

```typescript
const listMyPaymentsBySlug = jest.fn();
jest.mock('../../services/paymentHistory.service', () => ({
  PaymentHistoryService: jest.fn().mockImplementation(() => ({ listMyPaymentsBySlug })),
}));
```
Ajouter `listMyPaymentsBySlug.mockReset();` dans `beforeEach`, puis le bloc :

```typescript
describe('GET /api/clubs/:slug/me/payments', () => {
  it('200 + liste', async () => {
    listMyPaymentsBySlug.mockResolvedValue([{ id: 'p1', date: '2026-06-14T12:00:00.000Z', amountCents: 2500, refundedCents: 0, method: 'CARD', status: 'CAPTURED', label: 'Réservation Court 2 · 14/06/2026' }]);
    const res = await request(app).get('/api/clubs/demo/me/payments').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body[0].amountCents).toBe(2500);
    expect(listMyPaymentsBySlug).toHaveBeenCalledWith('demo', 'u1');
  });
});
```

- [ ] **Step 2: Lancer → échec**

Run: `cd backend && npx jest clubs.payment-method.routes -t "me/payments"`
Expected: FAIL (404).

- [ ] **Step 3: Implémenter**

Dans `clubs.ts`, ajouter l'import + instance :

```typescript
import { PaymentHistoryService } from '../services/paymentHistory.service';
```
```typescript
const paymentHistoryService = new PaymentHistoryService();
```
Puis, après les routes payment-method :

```typescript
// Historique des paiements du joueur sur ce club.
router.get('/:slug/me/payments', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await paymentHistoryService.listMyPaymentsBySlug(asString(req.params.slug), req.user!.id)); }
  catch (err) { handleError(err, res, next); }
});
```

- [ ] **Step 4: Lancer → succès + tsc**

Run: `cd backend && npx jest clubs.payment-method.routes && npx tsc --noEmit`
Expected: PASS + pas d'erreur.

- [ ] **Step 5: Commit**

```bash
git commit -- backend/src/routes/clubs.ts backend/src/routes/__tests__/clubs.payment-method.routes.test.ts -m "feat(compte): route GET /api/clubs/:slug/me/payments"
```

---

## PHASE C — Backend : suppression de compte

### Task C1: Migration + schéma `add_user_deleted_at`

**Files:**
- Modify: `backend/prisma/schema.prisma` (model `User`)
- Create: `backend/prisma/migrations/20260629000002_add_user_deleted_at/migration.sql`

- [ ] **Step 1: Ajouter le champ au schéma**

Dans `model User`, après `updatedAt`, ajouter :

```prisma
  deletedAt DateTime? @map("deleted_at")
```

- [ ] **Step 2: SQL de migration**

Créer `backend/prisma/migrations/20260629000002_add_user_deleted_at/migration.sql` :

```sql
-- Marqueur d'anonymisation (soft delete). Login refusé si non null.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);
```

- [ ] **Step 3: Appliquer + générer**

Run: `cd backend && npx prisma db push && npx prisma generate`
Expected: en sync + client généré.

- [ ] **Step 4: tsc**

Run: `cd backend && npx tsc --noEmit`
Expected: pas d'erreur.

- [ ] **Step 5: Commit**

```bash
git commit -- backend/prisma/schema.prisma backend/prisma/migrations/20260629000002_add_user_deleted_at/migration.sql -m "feat(compte): schéma — User.deletedAt (soft delete)"
```

---

### Task C2: Login refuse un compte supprimé

**Files:**
- Modify: `backend/src/routes/auth.ts` (login, ~ligne 60)
- Test: `backend/src/routes/__tests__/auth.deleted.routes.test.ts` (créé)

- [ ] **Step 1: Écrire le test (échoue)**

Créer `backend/src/routes/__tests__/auth.deleted.routes.test.ts` :

```typescript
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import bcrypt from 'bcrypt';
import app from '../../app';

it('login refuse un compte supprimé (deletedAt non null) → 401', async () => {
  const password = await bcrypt.hash('password123', 10);
  prismaMock.user.findUnique.mockResolvedValue({
    id: 'u1', email: 't@x.fr', password, emailVerified: true, deletedAt: new Date(), isSuperAdmin: false,
    firstName: 'X', lastName: 'Y',
  } as any);
  const res = await request(app).post('/api/auth/login').send({ email: 't@x.fr', password: 'password123' });
  expect(res.status).toBe(401);
});
```

- [ ] **Step 2: Lancer → échec**

Run: `cd backend && npx jest auth.deleted.routes`
Expected: FAIL (renvoie 200, le compte se connecte).

- [ ] **Step 3: Implémenter**

Dans `auth.ts`, route login, juste après le bloc `if (!user || !(await bcrypt.compare(...)))` (avant le check `emailVerified`), ajouter :

```typescript
  if (user.deletedAt) {
    res.status(401).json({ error: 'Identifiants invalides' });
    return;
  }
```

- [ ] **Step 4: Lancer → succès**

Run: `cd backend && npx jest auth.deleted.routes`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -- backend/src/routes/auth.ts backend/src/routes/__tests__/auth.deleted.routes.test.ts -m "feat(compte): login refuse un compte anonymisé (deletedAt)"
```

---

### Task C3: `ReservationService.cancelFutureReservationsForUser`

**Files:**
- Modify: `backend/src/services/reservation.service.ts` (méthode publique réutilisant `performCancel`)
- Test: `backend/src/services/__tests__/reservation.service.test.ts` (bloc ajouté)

- [ ] **Step 1: Écrire le test (échoue)**

Dans `reservation.service.test.ts`, ajouter un bloc. Adapter l'import du SSE/redis si nécessaire — le fichier mocke déjà `redis` et `SSEService` (vérifier en haut du fichier ; sinon copier le pattern des tests d'annulation existants). Test :

```typescript
describe('cancelFutureReservationsForUser', () => {
  it('annule chaque résa future (CONFIRMED/PENDING) de l organisateur', async () => {
    prismaMock.reservation.findMany.mockResolvedValue([
      { id: 'r1', resourceId: 'res-1', startTime: new Date(Date.now() + 86400000), endTime: new Date(Date.now() + 90000000) },
      { id: 'r2', resourceId: 'res-2', startTime: new Date(Date.now() + 172800000), endTime: new Date(Date.now() + 176400000) },
    ] as any);
    prismaMock.reservation.update.mockResolvedValue({ id: 'r1' } as any);

    const n = await new ReservationService().cancelFutureReservationsForUser('u1');
    expect(n).toBe(2);
    expect(prismaMock.reservation.update).toHaveBeenCalledTimes(2);
    expect(prismaMock.reservation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: 'u1', status: { in: ['CONFIRMED', 'PENDING'] } }),
    }));
  });
});
```

- [ ] **Step 2: Lancer → échec**

Run: `cd backend && npx jest reservation.service -t "cancelFutureReservationsForUser"`
Expected: FAIL (méthode absente).

- [ ] **Step 3: Implémenter**

Dans `reservation.service.ts`, ajouter une méthode publique (près de `cancelReservation`) :

```typescript
  /**
   * Annule toutes les réservations À VENIR dont l'utilisateur est organisateur
   * (suppression de compte). Bypass volontaire du délai d'annulation. Réutilise
   * `performCancel` (libère le verrou Redis + SSE slot_released). Pas de remboursement
   * auto ici (le club garde le remboursement manuel). Renvoie le nombre annulé.
   */
  async cancelFutureReservationsForUser(userId: string): Promise<number> {
    const future = await prisma.reservation.findMany({
      where: { userId, status: { in: ['CONFIRMED', 'PENDING'] }, startTime: { gt: new Date() } },
      select: { id: true, resourceId: true, startTime: true, endTime: true },
    });
    for (const r of future) {
      await this.performCancel(r);
    }
    return future.length;
  }
```

- [ ] **Step 4: Lancer → succès**

Run: `cd backend && npx jest reservation.service -t "cancelFutureReservationsForUser"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -- backend/src/services/reservation.service.ts backend/src/services/__tests__/reservation.service.test.ts -m "feat(compte): ReservationService.cancelFutureReservationsForUser"
```

---

### Task C4: `AccountService` (résumé + anonymisation)

**Files:**
- Create: `backend/src/services/account.service.ts`
- Test: `backend/src/services/__tests__/account.service.test.ts`

- [ ] **Step 1: Écrire les tests (échouent)**

Créer `backend/src/services/__tests__/account.service.test.ts` :

```typescript
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import bcrypt from 'bcrypt';

const cancelFutureReservationsForUser = jest.fn();
jest.mock('../reservation.service', () => ({
  ReservationService: jest.fn().mockImplementation(() => ({ cancelFutureReservationsForUser })),
}));

import { AccountService } from '../account.service';

beforeEach(() => { cancelFutureReservationsForUser.mockReset(); });

describe('AccountService.getDeletionSummary', () => {
  it('signale les clubs où je suis unique OWNER', async () => {
    prismaMock.clubMember.findMany.mockResolvedValue([
      { clubId: 'c1', club: { name: 'Club A' } },
    ] as any);
    // 1 seul OWNER sur c1 → bloquant
    prismaMock.clubMember.count.mockResolvedValue(1 as any);
    prismaMock.reservation.count.mockResolvedValue(2 as any);
    prismaMock.subscription.count.mockResolvedValue(1 as any);
    prismaMock.memberPackage.findMany.mockResolvedValue([] as any);

    const res = await new AccountService().getDeletionSummary('u1');
    expect(res.blockingClubs).toEqual(['Club A']);
    expect(res.futureReservations).toBe(2);
    expect(res.activeSubscriptions).toBe(1);
  });

  it('ne bloque pas si un autre OWNER existe', async () => {
    prismaMock.clubMember.findMany.mockResolvedValue([{ clubId: 'c1', club: { name: 'Club A' } }] as any);
    prismaMock.clubMember.count.mockResolvedValue(2 as any);
    prismaMock.reservation.count.mockResolvedValue(0 as any);
    prismaMock.subscription.count.mockResolvedValue(0 as any);
    prismaMock.memberPackage.findMany.mockResolvedValue([] as any);
    const res = await new AccountService().getDeletionSummary('u1');
    expect(res.blockingClubs).toEqual([]);
  });
});

describe('AccountService.deleteAccount', () => {
  const userRow = async () => ({ id: 'u1', password: await bcrypt.hash('password123', 10), avatarUrl: null });

  it('401 si mot de passe faux', async () => {
    prismaMock.user.findUnique.mockResolvedValue(await userRow() as any);
    await expect(new AccountService().deleteAccount('u1', 'wrong')).rejects.toThrow('INVALID_PASSWORD');
  });

  it('OWNS_CLUB si unique OWNER', async () => {
    prismaMock.user.findUnique.mockResolvedValue(await userRow() as any);
    prismaMock.clubMember.findMany.mockResolvedValue([{ clubId: 'c1', club: { name: 'Club A' } }] as any);
    prismaMock.clubMember.count.mockResolvedValue(1 as any);
    await expect(new AccountService().deleteAccount('u1', 'password123')).rejects.toThrow('OWNS_CLUB');
  });

  it('anonymise : annule les résas futures, scrub PII, deletedAt, push supprimées', async () => {
    prismaMock.user.findUnique.mockResolvedValue(await userRow() as any);
    prismaMock.clubMember.findMany.mockResolvedValue([] as any);
    cancelFutureReservationsForUser.mockResolvedValue(3);
    // $transaction reçoit un callback (tx) → on lui passe prismaMock
    (prismaMock.$transaction as jest.Mock).mockImplementation(async (fn: any) => fn(prismaMock));
    prismaMock.user.update.mockResolvedValue({} as any);
    prismaMock.pushSubscription.deleteMany.mockResolvedValue({ count: 1 } as any);

    const res = await new AccountService().deleteAccount('u1', 'password123');
    expect(cancelFutureReservationsForUser).toHaveBeenCalledWith('u1');
    expect(prismaMock.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'u1' },
      data: expect.objectContaining({
        firstName: 'Joueur', lastName: 'supprimé', email: 'deleted-u1@deleted.palova.invalid',
        phone: null, avatarUrl: null, birthDate: null, sex: null, locale: null, isSuperAdmin: false,
      }),
    }));
    expect(prismaMock.user.update.mock.calls[0][0].data.deletedAt).toBeInstanceOf(Date);
    expect(prismaMock.pushSubscription.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    expect(res).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Lancer → échec**

Run: `cd backend && npx jest account.service`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Implémenter**

Créer `backend/src/services/account.service.ts` :

```typescript
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { prisma } from '../db/prisma';
import { ReservationService } from './reservation.service';
import { AVATARS_DIR } from '../utils/uploads';

export interface AccountDeletionSummary {
  blockingClubs: string[];      // clubs où je suis l'unique OWNER → suppression bloquée
  futureReservations: number;
  activeSubscriptions: number;
  balances: string[];           // libellés des soldes non nuls (avertissement « perdu »)
}

export class AccountService {
  private reservations = new ReservationService();

  /** Clubs où l'utilisateur est l'unique OWNER (suppression interdite tant qu'il reste). */
  private async soleOwnerClubs(userId: string): Promise<string[]> {
    const ownerRoles = await prisma.clubMember.findMany({
      where: { userId, role: 'OWNER' },
      select: { clubId: true, club: { select: { name: true } } },
    });
    const blocking: string[] = [];
    for (const r of ownerRoles) {
      const owners = await prisma.clubMember.count({ where: { clubId: r.clubId, role: 'OWNER' } });
      if (owners <= 1) blocking.push(r.club.name);
    }
    return blocking;
  }

  async getDeletionSummary(userId: string): Promise<AccountDeletionSummary> {
    const [blockingClubs, futureReservations, activeSubscriptions, packages] = await Promise.all([
      this.soleOwnerClubs(userId),
      prisma.reservation.count({ where: { userId, status: { in: ['CONFIRMED', 'PENDING'] }, startTime: { gt: new Date() } } }),
      prisma.subscription.count({ where: { userId, status: 'ACTIVE', expiresAt: { gt: new Date() } } }),
      prisma.memberPackage.findMany({
        where: { userId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        select: { kind: true, creditsRemaining: true, amountRemaining: true, template: { select: { name: true } } },
      }),
    ]);
    const balances = packages
      .filter((p) => (p.creditsRemaining ?? 0) > 0 || Number(p.amountRemaining ?? 0) > 0)
      .map((p) => p.kind === 'ENTRIES'
        ? `${p.template.name} — ${p.creditsRemaining} entrée(s)`
        : `${p.template.name} — ${Number(p.amountRemaining ?? 0).toFixed(2).replace('.', ',')} €`);
    return { blockingClubs, futureReservations, activeSubscriptions, balances };
  }

  /** Anonymise le compte. Vérifie le mot de passe, bloque si unique OWNER, annule les résas futures. */
  async deleteAccount(userId: string, password: string): Promise<{ ok: true }> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, password: true, avatarUrl: true } });
    if (!user || !(await bcrypt.compare(password, user.password))) throw new Error('INVALID_PASSWORD');

    const blocking = await this.soleOwnerClubs(userId);
    if (blocking.length) throw Object.assign(new Error('OWNS_CLUB'), { clubs: blocking });

    // Annulation hors transaction (libère verrous Redis + SSE), avant le scrub atomique.
    await this.reservations.cancelFutureReservationsForUser(userId);

    const randomPassword = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          firstName: 'Joueur', lastName: 'supprimé',
          email: `deleted-${userId}@deleted.palova.invalid`,
          phone: null, avatarUrl: null, birthDate: null, sex: null, locale: null,
          password: randomPassword, isSuperAdmin: false, deletedAt: new Date(),
        },
      });
      await tx.pushSubscription.deleteMany({ where: { userId } });
    });

    // Nettoyage best-effort du fichier avatar (hors transaction).
    if (user.avatarUrl?.startsWith('/uploads/avatars/')) {
      fs.promises.unlink(path.join(AVATARS_DIR, path.basename(user.avatarUrl))).catch(() => {});
    }
    return { ok: true };
  }
}
```

- [ ] **Step 4: Lancer → succès**

Run: `cd backend && npx jest account.service`
Expected: PASS (toutes).

- [ ] **Step 5: Commit**

```bash
git commit -- backend/src/services/account.service.ts backend/src/services/__tests__/account.service.test.ts -m "feat(compte): AccountService — résumé + anonymisation avec garde-fous"
```

---

### Task C5: Routes `GET /api/me/account-deletion-summary` + `DELETE /api/me`

**Files:**
- Modify: `backend/src/routes/me.ts`
- Test: `backend/src/routes/__tests__/me.routes.test.ts` (bloc ajouté)

- [ ] **Step 1: Écrire le test (échoue)**

Dans `me.routes.test.ts`, en haut (avant `import app`), mocker `AccountService` :

```typescript
const getDeletionSummary = jest.fn();
const deleteAccount = jest.fn();
jest.mock('../../services/account.service', () => ({
  AccountService: jest.fn().mockImplementation(() => ({ getDeletionSummary, deleteAccount })),
}));
```

Ajouter le bloc de tests :

```typescript
describe('Account deletion routes', () => {
  beforeEach(() => { getDeletionSummary.mockReset(); deleteAccount.mockReset(); });

  it('GET /api/me/account-deletion-summary → 200', async () => {
    getDeletionSummary.mockResolvedValue({ blockingClubs: [], futureReservations: 1, activeSubscriptions: 0, balances: [] });
    const res = await request(app).get('/api/me/account-deletion-summary').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body.futureReservations).toBe(1);
    expect(getDeletionSummary).toHaveBeenCalledWith('u1');
  });

  it('DELETE /api/me sans mot de passe → 400', async () => {
    const res = await request(app).delete('/api/me').set('Authorization', `Bearer ${token()}`).send({});
    expect(res.status).toBe(400);
  });

  it('DELETE /api/me mauvais mot de passe → 401', async () => {
    deleteAccount.mockRejectedValue(new Error('INVALID_PASSWORD'));
    const res = await request(app).delete('/api/me').set('Authorization', `Bearer ${token()}`).send({ password: 'x' });
    expect(res.status).toBe(401);
  });

  it('DELETE /api/me unique OWNER → 409 OWNS_CLUB', async () => {
    deleteAccount.mockRejectedValue(Object.assign(new Error('OWNS_CLUB'), { clubs: ['Club A'] }));
    const res = await request(app).delete('/api/me').set('Authorization', `Bearer ${token()}`).send({ password: 'password123' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('OWNS_CLUB');
    expect(res.body.clubs).toEqual(['Club A']);
  });

  it('DELETE /api/me succès → 200 ok:true', async () => {
    deleteAccount.mockResolvedValue({ ok: true });
    const res = await request(app).delete('/api/me').set('Authorization', `Bearer ${token()}`).send({ password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(deleteAccount).toHaveBeenCalledWith('u1', 'password123');
  });
});
```

- [ ] **Step 2: Lancer → échec**

Run: `cd backend && npx jest me.routes -t "Account deletion"`
Expected: FAIL (routes 404).

- [ ] **Step 3: Implémenter**

Dans `me.ts`, ajouter l'import + instance :

```typescript
import { AccountService } from '../services/account.service';
```
```typescript
const accountService = new AccountService();
```
Puis ajouter les routes (avant `export default router;`) :

```typescript
// Résumé avant suppression : blocages (unique OWNER) + avertissements (résas/abos/soldes).
router.get('/account-deletion-summary', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await accountService.getDeletionSummary(req.user!.id)); }
  catch (err) { next(err); }
});

// Suppression (anonymisation) du compte. Re-saisie du mot de passe requise.
router.delete('/', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { password } = req.body;
    if (!password || typeof password !== 'string') {
      return void res.status(400).json({ error: 'password requis' });
    }
    res.json(await accountService.deleteAccount(req.user!.id, password));
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'INVALID_PASSWORD') return void res.status(401).json({ error: 'INVALID_PASSWORD' });
    if (msg === 'OWNS_CLUB') return void res.status(409).json({ error: 'OWNS_CLUB', clubs: (err as Error & { clubs?: string[] }).clubs ?? [] });
    next(err);
  }
});
```

- [ ] **Step 4: Lancer → succès + tsc**

Run: `cd backend && npx jest me.routes && npx tsc --noEmit`
Expected: PASS + pas d'erreur.

- [ ] **Step 5: Commit**

```bash
git commit -- backend/src/routes/me.ts backend/src/routes/__tests__/me.routes.test.ts -m "feat(compte): routes GET /api/me/account-deletion-summary + DELETE /api/me"
```

---

## PHASE D — Frontend : API + helpers

### Task D1: `lib/api.ts` — types + méthodes

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Ajouter les types**

Près des autres interfaces (ex. après `MemberPackage`), ajouter :

```typescript
export interface MyPaymentMethod {
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
}

export interface MyPayment {
  id: string;
  date: string;            // ISO
  amountCents: number;
  refundedCents: number;
  method: PaymentMethod;
  status: PaymentStatus;
  label: string;
}

export interface AccountDeletionSummary {
  blockingClubs: string[];
  futureReservations: number;
  activeSubscriptions: number;
  balances: string[];
}
```

- [ ] **Step 2: Ajouter les méthodes**

Dans l'objet `api`, près de `getMyClubPackages`/`getMyCardStatus` :

```typescript
  // Carte enregistrée du joueur (club courant).
  getMyPaymentMethod: (slug: string, token: string) =>
    request<MyPaymentMethod | null>(`/api/clubs/${slug}/me/payment-method`, {}, token),
  removeMyPaymentMethod: (slug: string, token: string) =>
    request<{ ok: boolean }>(`/api/clubs/${slug}/me/payment-method`, { method: 'DELETE' }, token),

  // Historique des paiements du joueur (club courant).
  getMyPayments: (slug: string, token: string) =>
    request<MyPayment[]>(`/api/clubs/${slug}/me/payments`, {}, token),
```

Et près de `changePassword` (méthodes `/api/me`) :

```typescript
  getAccountDeletionSummary: (token: string) =>
    request<AccountDeletionSummary>('/api/me/account-deletion-summary', {}, token),
  deleteMyAccount: (password: string, token: string) =>
    request<{ ok: boolean }>('/api/me', { method: 'DELETE', body: JSON.stringify({ password }) }, token),
```

- [ ] **Step 3: Vérifier tsc**

Run: `cd frontend && npx tsc --noEmit`
Expected: pas d'erreur.

- [ ] **Step 4: Commit**

```bash
git commit -- frontend/lib/api.ts -m "feat(compte): api — payment-method, payments, account-deletion"
```

---

### Task D2: `lib/payments.ts` — helpers purs

**Files:**
- Create: `frontend/lib/payments.ts`
- Test: `frontend/lib/__tests__/payments.test.ts`

- [ ] **Step 1: Écrire les tests (échouent)**

Créer `frontend/lib/__tests__/payments.test.ts` :

```typescript
import { eurosFromCents, paymentMethodLabel, cardLabel } from '@/lib/payments';

describe('eurosFromCents', () => {
  it('formate en euros virgule', () => {
    expect(eurosFromCents(2500)).toBe('25,00 €');
    expect(eurosFromCents(0)).toBe('0,00 €');
    expect(eurosFromCents(1234)).toBe('12,34 €');
  });
});

describe('paymentMethodLabel', () => {
  it('libellés FR', () => {
    expect(paymentMethodLabel('CARD')).toBe('Carte');
    expect(paymentMethodLabel('CASH')).toBe('Espèces');
    expect(paymentMethodLabel('VOUCHER')).toBe('Ticket CE');
    expect(paymentMethodLabel('ONLINE')).toBe('Carte en ligne');
  });
});

describe('cardLabel', () => {
  it('marque + 4 chiffres + expiration', () => {
    expect(cardLabel({ brand: 'visa', last4: '4242', expMonth: 4, expYear: 2027 })).toBe('Visa •••• 4242 · exp 04/2027');
  });
  it('repli quand détails partiels', () => {
    expect(cardLabel({ brand: null, last4: null, expMonth: null, expYear: null })).toBe('Carte enregistrée');
  });
});
```

- [ ] **Step 2: Lancer → échec**

Run: `cd frontend && npx jest payments.test`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Implémenter**

Créer `frontend/lib/payments.ts` :

```typescript
import type { MyPaymentMethod, PaymentMethod } from '@/lib/api';

/** Centimes → « 25,00 € ». */
export function eurosFromCents(cents: number): string {
  return `${(cents / 100).toFixed(2).replace('.', ',')} €`;
}

const METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Espèces',
  CARD: 'Carte',
  TRANSFER: 'Virement',
  ONLINE: 'Carte en ligne',
  OTHER: 'Autre',
  VOUCHER: 'Ticket CE',
  PACK_CREDIT: 'Carnet',
  WALLET: 'Porte-monnaie',
  MEMBER: 'Abonnement',
  SUBSCRIPTION: 'Abonnement',
};

export function paymentMethodLabel(method: PaymentMethod): string {
  return METHOD_LABELS[method] ?? method;
}

/** « Visa •••• 4242 · exp 04/2027 », repli « Carte enregistrée » si détails manquants. */
export function cardLabel(pm: MyPaymentMethod): string {
  if (!pm.last4) return 'Carte enregistrée';
  const brand = pm.brand ? pm.brand.charAt(0).toUpperCase() + pm.brand.slice(1) : 'Carte';
  const exp = pm.expMonth && pm.expYear ? ` · exp ${String(pm.expMonth).padStart(2, '0')}/${pm.expYear}` : '';
  return `${brand} •••• ${pm.last4}${exp}`;
}
```

- [ ] **Step 4: Lancer → succès**

Run: `cd frontend && npx jest payments.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -- frontend/lib/payments.ts frontend/lib/__tests__/payments.test.ts -m "feat(compte): lib/payments — helpers purs (euros, libellés, carte)"
```

---

## PHASE E — Frontend : composants

> **Pattern commun :** chaque composant reçoit `slug`/`token` (ou ses données) en props et rend une carte au style profil (fond `th.surface`, titre `cardTitle`). S'inspirer du style inline de `app/me/profile/page.tsx`. Les tests RTL mockent `@/lib/api` ET `@/lib/ThemeProvider` (cf. tests existants comme `MeProfile.test.tsx`/`ProfileMenu.test.tsx` pour le shape exact des mocks de thème).

### Task E1: `WalletSection`

**Files:**
- Create: `frontend/components/profile/WalletSection.tsx`
- Test: `frontend/__tests__/WalletSection.test.tsx`

- [ ] **Step 1: Écrire le test (échoue)**

Créer `frontend/__tests__/WalletSection.test.tsx` :

```typescript
import { render, screen } from '@testing-library/react';
import { WalletSection } from '@/components/profile/WalletSection';
import type { MemberPackage, Subscription } from '@/lib/api';

jest.mock('@/lib/ThemeProvider', () => ({
  useTheme: () => ({ th: { surface: '#fff', surface2: '#eee', line: '#ddd', text: '#000', textMute: '#555', textFaint: '#999', fontUI: 'ui', accent: '#06c', onAccent: '#fff' } }),
}));

const wallet: MemberPackage = { id: 'w1', kind: 'WALLET', creditsTotal: null, creditsRemaining: null, amountTotal: '50.00', amountRemaining: '53.50', purchasedAt: '2026-01-01', expiresAt: null, template: { name: 'Porte-monnaie' } };
const sub = { id: 's1', planId: 'p1', status: 'ACTIVE', startedAt: '2026-01-01', expiresAt: '2026-12-31', monthlyPriceSnapshot: '30.00', sportKeys: ['padel'], offPeakOnly: false, benefit: 'INCLUDED', discountPercent: null, dailyCap: null, weeklyCap: null, plan: { name: 'Mensuel' } } as Subscription;

it('affiche soldes et abonnements', () => {
  render(<WalletSection packages={[wallet]} subscriptions={[sub]} />);
  expect(screen.getByText(/Porte-monnaie/)).toBeInTheDocument();
  expect(screen.getByText(/53,50/)).toBeInTheDocument();
  expect(screen.getByText('Mensuel')).toBeInTheDocument();
});

it('état vide neutre', () => {
  render(<WalletSection packages={[]} subscriptions={[]} />);
  expect(screen.getByText(/Aucun solde|Aucun abonnement|rien/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Lancer → échec**

Run: `cd frontend && npx jest WalletSection`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Implémenter**

Créer `frontend/components/profile/WalletSection.tsx` :

```tsx
'use client';
import { useTheme } from '@/lib/ThemeProvider';
import type { MemberPackage, Subscription } from '@/lib/api';
import { packageLabel, isUsable } from '@/lib/packages';

interface Props { packages: MemberPackage[]; subscriptions: Subscription[]; }

/** Portefeuille (lecture seule) : abonnements actifs + soldes prépayés du club courant. */
export function WalletSection({ packages, subscriptions }: Props) {
  const { th } = useTheme();
  const row: React.CSSProperties = {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
    background: th.surface2, borderRadius: 12, padding: '11px 14px', fontFamily: th.fontUI, fontSize: 14, color: th.text,
  };
  const faint: React.CSSProperties = { fontFamily: th.fontUI, fontSize: 13, color: th.textFaint };
  const empty = packages.length === 0 && subscriptions.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {empty && <span style={faint}>Aucun abonnement ni solde prépayé pour ce club.</span>}

      {subscriptions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {subscriptions.map((s) => (
            <div key={s.id} style={row}>
              <span style={{ fontWeight: 600 }}>{s.plan.name}</span>
              <span style={faint}>
                {s.benefit === 'INCLUDED' ? 'Inclus' : `-${s.discountPercent ?? 0}%`}
                {' · '}jusqu’au {new Date(s.expiresAt).toLocaleDateString('fr-FR')}
              </span>
            </div>
          ))}
        </div>
      )}

      {packages.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {packages.map((p) => (
            <div key={p.id} style={row}>
              <span style={{ fontWeight: 600 }}>{packageLabel(p)}</span>
              {!isUsable(p) && <span style={faint}>expiré / épuisé</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Lancer → succès**

Run: `cd frontend && npx jest WalletSection`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -- frontend/components/profile/WalletSection.tsx frontend/__tests__/WalletSection.test.tsx -m "feat(compte): WalletSection (abos + soldes)"
```

---

### Task E2: `PaymentMethodSection`

**Files:**
- Create: `frontend/components/profile/PaymentMethodSection.tsx`
- Test: `frontend/__tests__/PaymentMethodSection.test.tsx`

- [ ] **Step 1: Écrire le test (échoue)**

Créer `frontend/__tests__/PaymentMethodSection.test.tsx` :

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PaymentMethodSection } from '@/components/profile/PaymentMethodSection';

jest.mock('@/lib/ThemeProvider', () => ({
  useTheme: () => ({ th: { surface: '#fff', surface2: '#eee', line: '#ddd', lineStrong: '#bbb', text: '#000', textMute: '#555', textFaint: '#999', fontUI: 'ui', fontDisplay: 'd', accent: '#06c', onAccent: '#fff', bgElev: '#fff' } }),
}));
jest.mock('@/lib/api', () => ({
  api: { getMyPaymentMethod: jest.fn(), removeMyPaymentMethod: jest.fn() },
}));
import { api } from '@/lib/api';

it('affiche la carte puis la retire', async () => {
  (api.getMyPaymentMethod as jest.Mock).mockResolvedValue({ brand: 'visa', last4: '4242', expMonth: 4, expYear: 2027 });
  (api.removeMyPaymentMethod as jest.Mock).mockResolvedValue({ ok: true });
  render(<PaymentMethodSection slug="demo" token="t" />);
  expect(await screen.findByText(/Visa •••• 4242/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /Retirer/i }));
  fireEvent.click(screen.getByRole('button', { name: /Confirmer|Retirer ma carte/i }));
  await waitFor(() => expect(api.removeMyPaymentMethod).toHaveBeenCalledWith('demo', 't'));
});

it('état vide si pas de carte', async () => {
  (api.getMyPaymentMethod as jest.Mock).mockResolvedValue(null);
  render(<PaymentMethodSection slug="demo" token="t" />);
  expect(await screen.findByText(/Aucune carte/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Lancer → échec**

Run: `cd frontend && npx jest PaymentMethodSection`
Expected: FAIL.

- [ ] **Step 3: Implémenter**

Créer `frontend/components/profile/PaymentMethodSection.tsx` :

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { api, MyPaymentMethod } from '@/lib/api';
import { cardLabel } from '@/lib/payments';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

interface Props { slug: string; token: string; }

/** Carte enregistrée du club courant : affichage + retrait (ConfirmDialog). */
export function PaymentMethodSection({ slug, token }: Props) {
  const { th } = useTheme();
  const [card, setCard] = useState<MyPaymentMethod | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getMyPaymentMethod(slug, token).then((c) => { setCard(c); setLoaded(true); }).catch(() => setLoaded(true));
  }, [slug, token]);

  const remove = async () => {
    setBusy(true);
    try {
      await api.removeMyPaymentMethod(slug, token);
      setCard(null);
      setConfirming(false);
    } finally { setBusy(false); }
  };

  const faint: React.CSSProperties = { fontFamily: th.fontUI, fontSize: 13, color: th.textFaint };

  if (!loaded) return <span style={faint}>Chargement…</span>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {card ? (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, background: th.surface2, borderRadius: 12, padding: '12px 14px' }}>
            <span style={{ fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, color: th.text }}>{cardLabel(card)}</span>
            <button onClick={() => setConfirming(true)}
              style={{ cursor: 'pointer', background: 'none', border: 'none', textDecoration: 'underline', fontFamily: th.fontUI, fontSize: 13, color: th.text }}>
              Retirer
            </button>
          </div>
          <span style={faint}>Cette carte sert d’empreinte (anti no-show) et aux débits liste d’attente. Le club pourra la redemander à votre prochaine réservation.</span>
        </>
      ) : (
        <span style={faint}>Aucune carte enregistrée.</span>
      )}

      {confirming && (
        <ConfirmDialog
          title="Retirer ma carte ?"
          message="Votre carte enregistrée sera supprimée. Vous pourrez en enregistrer une nouvelle lors d’une prochaine réservation."
          confirmLabel="Retirer ma carte"
          busy={busy}
          onConfirm={remove}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Lancer → succès**

Run: `cd frontend && npx jest PaymentMethodSection`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -- frontend/components/profile/PaymentMethodSection.tsx frontend/__tests__/PaymentMethodSection.test.tsx -m "feat(compte): PaymentMethodSection (affichage + retrait carte)"
```

---

### Task E3: `PaymentsHistory`

**Files:**
- Create: `frontend/components/profile/PaymentsHistory.tsx`
- Test: `frontend/__tests__/PaymentsHistory.test.tsx`

- [ ] **Step 1: Écrire le test (échoue)**

Créer `frontend/__tests__/PaymentsHistory.test.tsx` :

```typescript
import { render, screen } from '@testing-library/react';
import { PaymentsHistory } from '@/components/profile/PaymentsHistory';
import type { MyPayment } from '@/lib/api';

jest.mock('@/lib/ThemeProvider', () => ({
  useTheme: () => ({ th: { surface: '#fff', surface2: '#eee', line: '#ddd', text: '#000', textMute: '#555', textFaint: '#999', fontUI: 'ui' } }),
}));

const payments: MyPayment[] = [
  { id: 'p1', date: '2026-06-14T12:00:00.000Z', amountCents: 2500, refundedCents: 0, method: 'CARD', status: 'CAPTURED', label: 'Réservation Court 2 · 14/06/2026' },
  { id: 'p2', date: '2026-06-01T09:00:00.000Z', amountCents: 8000, refundedCents: 1000, method: 'ONLINE', status: 'PARTIALLY_REFUNDED', label: 'Achat — Carnet 10' },
];

it('liste les paiements avec montant et libellé', () => {
  render(<PaymentsHistory payments={payments} />);
  expect(screen.getByText('Réservation Court 2 · 14/06/2026')).toBeInTheDocument();
  expect(screen.getByText('25,00 €')).toBeInTheDocument();
  expect(screen.getByText(/remboursé/i)).toBeInTheDocument(); // p2 a un refund
});

it('état vide', () => {
  render(<PaymentsHistory payments={[]} />);
  expect(screen.getByText(/Aucun paiement/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Lancer → échec**

Run: `cd frontend && npx jest PaymentsHistory`
Expected: FAIL.

- [ ] **Step 3: Implémenter**

Créer `frontend/components/profile/PaymentsHistory.tsx` :

```tsx
'use client';
import { useTheme } from '@/lib/ThemeProvider';
import type { MyPayment } from '@/lib/api';
import { eurosFromCents, paymentMethodLabel } from '@/lib/payments';

interface Props { payments: MyPayment[]; }

/** Historique de paiements du club courant (lecture seule, 100 derniers). */
export function PaymentsHistory({ payments }: Props) {
  const { th } = useTheme();
  const faint: React.CSSProperties = { fontFamily: th.fontUI, fontSize: 13, color: th.textFaint };

  if (payments.length === 0) return <span style={faint}>Aucun paiement pour ce club.</span>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {payments.map((p) => (
        <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, background: th.surface2, borderRadius: 12, padding: '11px 14px' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, color: th.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.label}</div>
            <div style={faint}>
              {new Date(p.date).toLocaleDateString('fr-FR')} · {paymentMethodLabel(p.method)}
              {p.refundedCents > 0 && ` · remboursé ${eurosFromCents(p.refundedCents)}`}
            </div>
          </div>
          <span style={{ fontFamily: th.fontUI, fontSize: 14, fontWeight: 700, color: th.text, flexShrink: 0 }}>{eurosFromCents(p.amountCents)}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Lancer → succès**

Run: `cd frontend && npx jest PaymentsHistory`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -- frontend/components/profile/PaymentsHistory.tsx frontend/__tests__/PaymentsHistory.test.tsx -m "feat(compte): PaymentsHistory (historique paiements)"
```

---

### Task E4: `DeleteAccountSection`

**Files:**
- Create: `frontend/components/profile/DeleteAccountSection.tsx`
- Test: `frontend/__tests__/DeleteAccountSection.test.tsx`

- [ ] **Step 1: Écrire le test (échoue)**

Créer `frontend/__tests__/DeleteAccountSection.test.tsx` :

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DeleteAccountSection } from '@/components/profile/DeleteAccountSection';

jest.mock('@/lib/ThemeProvider', () => ({
  useTheme: () => ({ th: { surface: '#fff', surface2: '#eee', line: '#ddd', lineStrong: '#bbb', text: '#000', textMute: '#555', textFaint: '#999', fontUI: 'ui', fontDisplay: 'd', accent: '#06c', onAccent: '#fff', bgElev: '#fff' } }),
}));
const logout = jest.fn();
jest.mock('@/lib/useAuth', () => ({ logout: () => logout() }));
jest.mock('@/lib/api', () => ({ api: { getAccountDeletionSummary: jest.fn(), deleteMyAccount: jest.fn() } }));
import { api } from '@/lib/api';

beforeEach(() => { logout.mockReset(); (api.deleteMyAccount as jest.Mock).mockReset(); });

it('bloque si je gère un club (unique OWNER)', async () => {
  (api.getAccountDeletionSummary as jest.Mock).mockResolvedValue({ blockingClubs: ['Club A'], futureReservations: 0, activeSubscriptions: 0, balances: [] });
  render(<DeleteAccountSection token="t" />);
  fireEvent.click(await screen.findByRole('button', { name: /Supprimer mon compte/i }));
  expect(screen.getByText(/Club A/)).toBeInTheDocument();
  // bouton de confirmation désactivé
  const confirm = screen.getByRole('button', { name: /Supprimer définitivement|Confirmer/i });
  expect(confirm).toBeDisabled();
});

it('supprime après saisie du mot de passe puis logout', async () => {
  (api.getAccountDeletionSummary as jest.Mock).mockResolvedValue({ blockingClubs: [], futureReservations: 2, activeSubscriptions: 1, balances: ['Porte-monnaie — 10,00 €'] });
  (api.deleteMyAccount as jest.Mock).mockResolvedValue({ ok: true });
  render(<DeleteAccountSection token="t" />);
  fireEvent.click(await screen.findByRole('button', { name: /Supprimer mon compte/i }));
  expect(screen.getByText(/2 réservation/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/mot de passe/i), { target: { value: 'password123' } });
  fireEvent.click(screen.getByRole('button', { name: /Supprimer définitivement|Confirmer/i }));
  await waitFor(() => expect(api.deleteMyAccount).toHaveBeenCalledWith('password123', 't'));
  await waitFor(() => expect(logout).toHaveBeenCalled());
});
```

- [ ] **Step 2: Lancer → échec**

Run: `cd frontend && npx jest DeleteAccountSection`
Expected: FAIL.

- [ ] **Step 3: Implémenter**

Créer `frontend/components/profile/DeleteAccountSection.tsx` :

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { api, AccountDeletionSummary } from '@/lib/api';
import { logout } from '@/lib/useAuth';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

interface Props { token: string; }

const DELETE_ERR_FR: Record<string, string> = {
  INVALID_PASSWORD: 'Mot de passe incorrect.',
  OWNS_CLUB: 'Vous gérez encore un club : transférez la gestion avant de supprimer votre compte.',
};

/** Suppression (anonymisation) du compte — globale, avec avertissements + re-saisie du mot de passe. */
export function DeleteAccountSection({ token }: Props) {
  const { th } = useTheme();
  const [summary, setSummary] = useState<AccountDeletionSummary | null>(null);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.getAccountDeletionSummary(token).then(setSummary).catch(() => {}); }, [token]);

  const blocked = (summary?.blockingClubs.length ?? 0) > 0;

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await api.deleteMyAccount(password, token);
      logout();
    } catch (e) {
      setError(DELETE_ERR_FR[(e as Error).message] ?? (e as Error).message);
    } finally { setBusy(false); }
  };

  const warnings: React.ReactNode = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {blocked ? (
        <span>Vous êtes l’unique gestionnaire de : <strong>{summary!.blockingClubs.join(', ')}</strong>. Transférez la gestion avant de supprimer votre compte.</span>
      ) : (
        <>
          {summary && summary.futureReservations > 0 && <span>{summary.futureReservations} réservation(s) à venir seront annulées.</span>}
          {summary && summary.activeSubscriptions > 0 && <span>Votre abonnement actif sera perdu (aucun remboursement).</span>}
          {summary && summary.balances.length > 0 && <span>Soldes perdus (aucun remboursement) : {summary.balances.join(', ')}.</span>}
          <span>Cette action est définitive. Saisissez votre mot de passe pour confirmer.</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            aria-label="Mot de passe" placeholder="Mot de passe"
            style={{ width: '100%', boxSizing: 'border-box', background: th.surface2, border: `1px solid ${th.line}`, borderRadius: 11, padding: '10px 12px', fontFamily: th.fontUI, fontSize: 14, color: th.text }} />
          {error && <span style={{ color: th.accent, fontWeight: 600 }}>{error}</span>}
        </>
      )}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textFaint }}>
        Supprime définitivement votre compte. Vos informations personnelles sont effacées ; l’historique comptable des clubs est conservé de façon anonyme.
      </span>
      <button onClick={() => { setOpen(true); setError(null); setPassword(''); }}
        style={{ alignSelf: 'flex-start', cursor: 'pointer', border: `1px solid ${th.line}`, background: 'transparent', color: th.accent, borderRadius: 11, padding: '10px 18px', fontFamily: th.fontUI, fontWeight: 700, fontSize: 13.5 }}>
        Supprimer mon compte
      </button>

      {open && (
        <ConfirmDialog
          title="Supprimer mon compte"
          message={warnings}
          confirmLabel="Supprimer définitivement"
          cancelLabel="Annuler"
          busy={busy}
          confirmDisabled={blocked || password.length === 0}
          onConfirm={submit}
          onCancel={() => setOpen(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Lancer → succès**

Run: `cd frontend && npx jest DeleteAccountSection`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -- frontend/components/profile/DeleteAccountSection.tsx frontend/__tests__/DeleteAccountSection.test.tsx -m "feat(compte): DeleteAccountSection (anonymisation + garde-fous)"
```

---

## PHASE F — Frontend : intégration dans la page profil

### Task F1: Câbler les 4 sections dans `/me/profile`

**Files:**
- Modify: `frontend/app/me/profile/page.tsx`

- [ ] **Step 1: Importer les composants + types**

En haut de `page.tsx`, ajouter aux imports :

```typescript
import { WalletSection } from '@/components/profile/WalletSection';
import { PaymentMethodSection } from '@/components/profile/PaymentMethodSection';
import { PaymentsHistory } from '@/components/profile/PaymentsHistory';
import { DeleteAccountSection } from '@/components/profile/DeleteAccountSection';
import { MemberPackage, Subscription, MyPayment } from '@/lib/api';
```
(Compléter la ligne d'import `@/lib/api` existante plutôt que dupliquer si plus simple.)

- [ ] **Step 2: Ajouter l'état + le chargement**

Dans le composant, ajouter des états :

```typescript
  const [walletPackages, setWalletPackages] = useState<MemberPackage[]>([]);
  const [walletSubs, setWalletSubs] = useState<Subscription[]>([]);
  const [payments, setPayments] = useState<MyPayment[]>([]);
```

Dans le `useEffect` de chargement (celui qui dépend de `[token, slug]`, après le bloc membership), ajouter — uniquement quand `slug` :

```typescript
        if (slug) {
          api.getMyClubPackages(slug, token).then(setWalletPackages).catch(() => {});
          api.getMyClubSubscriptions(slug, token).then(setWalletSubs).catch(() => {});
          api.getMyPayments(slug, token).then(setPayments).catch(() => {});
        }
```

> Note : le chargement de la carte est encapsulé dans `PaymentMethodSection` (il fait son propre `getMyPaymentMethod`). Le résumé de suppression est encapsulé dans `DeleteAccountSection`.

- [ ] **Step 3: Étendre `navItems`**

Remplacer le tableau `navItems` pour insérer les nouvelles ancres (Portefeuille/Paiement/Paiements seulement si `slug && membership` ; Suppression toujours) :

```typescript
  const navItems: ProfileNavItem[] = [
    { id: 'identite', icon: 'user', label: 'Identité' },
    ...(sports.length > 0 ? ([{ id: 'sport', icon: 'ball', label: 'Sport' }] satisfies ProfileNavItem[]) : []),
    ...(club?.levelSystemEnabled !== false ? ([{ id: 'niveau', icon: 'chart', label: 'Niveau' }] satisfies ProfileNavItem[]) : []),
    { id: 'infos', icon: 'info', label: 'Infos' },
    { id: 'preferences', icon: 'settings', label: 'Préf.' },
    ...(slug && club && membership ? ([
      { id: 'portefeuille', icon: 'wallet', label: 'Solde' },
      { id: 'paiement', icon: 'card', label: 'Carte' },
      { id: 'paiements', icon: 'euro', label: 'Paie.' },
    ] satisfies ProfileNavItem[]) : []),
    { id: 'securite', icon: 'lock', label: 'Sécu.' },
    ...(slug && club && membership ? ([{ id: 'licence', icon: 'ticket', label: 'Licence' }] satisfies ProfileNavItem[]) : []),
    { id: 'suppression', icon: 'trash', label: 'Suppr.' },
  ];
```

- [ ] **Step 4: Rendre les sections**

Dans le JSX, après la section `preferences` (et avant `securite`), ajouter les trois sections club-scopées :

```tsx
              {slug && club && membership && (
                <>
                  <section id="portefeuille" style={{ ...card, scrollMarginTop: 'var(--profile-anchor, 72px)' }} aria-label="Portefeuille">
                    <div style={cardTitle}>Portefeuille</div>
                    <WalletSection packages={walletPackages} subscriptions={walletSubs} />
                  </section>

                  <section id="paiement" style={{ ...card, scrollMarginTop: 'var(--profile-anchor, 72px)' }} aria-label="Méthodes de paiement">
                    <div style={cardTitle}>Méthodes de paiement</div>
                    {token && <PaymentMethodSection slug={slug} token={token} />}
                  </section>

                  <section id="paiements" style={{ ...card, scrollMarginTop: 'var(--profile-anchor, 72px)' }} aria-label="Mes paiements">
                    <div style={cardTitle}>Mes paiements</div>
                    <PaymentsHistory payments={payments} />
                  </section>
                </>
              )}
```

Après la dernière section (après `licence`), ajouter la section de suppression (toujours rendue) :

```tsx
              {token && (
                <section id="suppression" style={{ ...card, scrollMarginTop: 'var(--profile-anchor, 72px)' }} aria-label="Supprimer mon compte">
                  <div style={cardTitle}>Supprimer mon compte</div>
                  <DeleteAccountSection token={token} />
                </section>
              )}
```

- [ ] **Step 5: Vérifier tsc + suite profil**

Run: `cd frontend && npx tsc --noEmit && npx jest MeProfile ProfileSectionNav`
Expected: pas d'erreur tsc ; suites profil toujours vertes (si `MeProfile.test.tsx` mocke `@/lib/api`, ajouter `getMyClubPackages`, `getMyClubSubscriptions`, `getMyPayments`, `getMyPaymentMethod`, `getAccountDeletionSummary` au mock — sinon `undefined`).

- [ ] **Step 6: Commit**

```bash
git commit -- frontend/app/me/profile/page.tsx -m "feat(compte): câblage des sections portefeuille/paiement/paiements/suppression dans /me/profile"
```

---

## Vérification finale (après toutes les phases)

- [ ] **Backend complet** : `cd backend && npx jest && npx tsc --noEmit` → vert.
- [ ] **Frontend ciblé** : `cd frontend && npx jest payments WalletSection PaymentMethodSection PaymentsHistory DeleteAccountSection MeProfile && npx tsc --noEmit` → vert. (Éviter de juger sur la suite `npx jest` complète : flake pré-existant BookingModal en suite complète, cf. mémoire `frontend-full-suite-bookingmodal-flake`.)
- [ ] **Manuel** (optionnel) : démarrer back+front, se connecter sur un sous-domaine club, ouvrir `/me/profile` → vérifier les 4 sections ; tester retrait de carte (si carte enregistrée) ; tester le dialog de suppression (sans aller jusqu'au bout sur un compte réel).

---

## Notes de cohérence (self-review intégré)

- **Couverture spec** : Portefeuille (E1/F1), Méthodes de paiement + migration + lazy backfill (A1–A4, E2, F1), Mes paiements (B1–B2, E3, F1), Suppression anonymisée + 4 garde-fous (C1–C5, E4, F1 : annulation résas futures = C3, blocage unique OWNER = C4, avertissement solde/abo = C4 summary + E4, re-saisie mot de passe = E4 + C4/C5).
- **Types cohérents** : `MyPaymentMethod`/`MyPayment`/`AccountDeletionSummary` identiques entre backend (DTO) et `lib/api.ts` ; `getCardDetails` renvoie `{brand,last4,expMonth,expYear}` consommé tel quel par `PaymentMethodService`.
- **Hors périmètre (rappel)** : pas de vue multi-clubs, pas d'ajout de carte depuis le profil, pas de remboursement auto à la suppression, pas d'export comptable.
