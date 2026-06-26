# Paiement en ligne obligatoire des inscriptions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre qu'une inscription à un tournoi ou un event exige un règlement CB en ligne (Stripe Connect), au choix du club et par épreuve, sans jamais encaisser un joueur sans place.

**Architecture:** On réutilise l'infra Stripe Connect des réservations. Une inscription payante est créée en état `paymentStatus = DUE` qui **tient la place** jusqu'à `paymentDeadline` (15 min), puis passe `PAID` au paiement (PaymentIntent + webhook idempotent). La liste d'attente est gratuite (carte enregistrée via SetupIntent) et débitée **off-session** à la promotion. Le `cleanup.job` libère les `DUE` expirées. Remboursement auto à la désinscription avant clôture.

**Tech Stack:** Express 5, Prisma 7 (`PrismaPg`), Stripe Connect (Express accounts), Jest + `prismaMock`, Next.js 16 / React 19 (Stripe Elements), TypeScript.

**Référence spec :** `docs/superpowers/specs/2026-06-25-paiement-en-ligne-inscriptions-design.md`

**Conventions vérifiées dans le code :**
- Inscriptions : transactions `Serializable` + `SELECT … FOR UPDATE`, promotion auto via `cancelAndPromoteTx`, emails best-effort via `safeNotify` après commit.
- `Payment` ONLINE existant : `{ clubId, method:'ONLINE', status:'CAPTURED', stripePaymentIntentId, receiptNo }`, `receiptNo` via `PackageService.nextReceiptNo(tx, clubId)`.
- Stripe : `StripeService.createPaymentIntent/createSetupIntent/chargeNoShow` (metadata `{ reservationId, clubId }`), webhook route sur `metadata`.
- Tests backend = unitaires avec `prismaMock` (`$transaction.mockImplementation(async cb => cb(prismaMock))`).

---

## Mapping des fichiers

| Fichier | Responsabilité | Action |
|---|---|---|
| `backend/prisma/schema.prisma` | Modèle | Modifier (enum + champs) |
| `backend/prisma/migrations/*_add_registration_online_payment/` | Migration | Créer |
| `backend/src/services/registrationPayment.ts` | Helpers purs partagés (constante hold, clause occupe-place, cents) | Créer |
| `backend/src/services/stripe.service.ts` | Intents + débit off-session inscription | Modifier |
| `backend/src/services/tournament.service.ts` | register/confirm/promotion/cancel/update payants | Modifier |
| `backend/src/services/event.service.ts` | idem (miroir individuel) | Modifier |
| `backend/src/routes/tournaments.ts` | Réponse register + intent + confirm-payment | Modifier |
| `backend/src/routes/events.ts` | idem | Modifier |
| `backend/src/routes/stripe-webhooks.ts` | Routage paiement/setup vers inscriptions | Modifier |
| `backend/src/routes/admin.ts` | Mapping erreur `ONLINE_PAYMENT_NOT_ENABLED` | Modifier |
| `backend/src/jobs/cleanup.job.ts` | Libération des `DUE` expirées | Modifier |
| `frontend/lib/api.ts` | Types register + `createRegistrationIntent`/`confirmRegistrationPayment` | Modifier |
| `frontend/components/StripePaymentStep.tsx` | Rendu target-agnostic (callbacks) | Modifier |
| `frontend/app/tournois/[id]/page.tsx` | Parcours paiement / card-setup | Modifier |
| `frontend/app/events/[id]/page.tsx` | idem | Modifier |
| `frontend/app/admin/tournaments/page.tsx` | Case « Inscription à régler en ligne » | Modifier |
| `frontend/app/admin/events/page.tsx` | idem | Modifier |

Tests associés à côté de chaque fichier (`__tests__/`).

---

## Task 1 : Migration & schéma Prisma

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_add_registration_online_payment/migration.sql` (généré)

- [ ] **Step 1 : Ajouter l'enum `RegistrationPaymentStatus`** dans `schema.prisma`, juste après l'enum `RegistrationStatus` (vers la ligne 115) :

```prisma
/// Statut de paiement d'une inscription payante (tournoi/event). NONE = épreuve gratuite.
enum RegistrationPaymentStatus {
  NONE
  DUE
  PAID
  REFUNDED
}
```

- [ ] **Step 2 : Ajouter `requirePrepayment` à `Tournament` et `ClubEvent`.** Dans `model Tournament` (après `entryFee`) et `model ClubEvent` (après `price`) :

```prisma
  requirePrepayment Boolean @default(false) @map("require_prepayment")
```

- [ ] **Step 3 : Ajouter les champs paiement aux deux modèles d'inscription.** Dans `model TournamentRegistration` et `model EventRegistration`, ajouter :

```prisma
  paymentStatus   RegistrationPaymentStatus @default(NONE) @map("payment_status")
  paymentDeadline DateTime?                 @map("payment_deadline") @db.Timestamptz
  payments        Payment[]
```

- [ ] **Step 4 : Ajouter les 2 FK nullables sur `Payment`** (model `Payment`, près de `reservationId`) :

```prisma
  tournamentRegistrationId String? @map("tournament_registration_id")
  eventRegistrationId      String? @map("event_registration_id")
```

et dans la section relations du modèle `Payment` :

```prisma
  tournamentRegistration TournamentRegistration? @relation(fields: [tournamentRegistrationId], references: [id], onDelete: SetNull)
  eventRegistration      EventRegistration?      @relation(fields: [eventRegistrationId], references: [id], onDelete: SetNull)
```

et dans les `@@index` du modèle `Payment` :

```prisma
  @@index([tournamentRegistrationId])
  @@index([eventRegistrationId])
```

- [ ] **Step 5 : Générer la migration et le client.**

Run (dossier `backend/`) :
```bash
npm run db:migrate -- --name add_registration_online_payment
npx prisma generate
```
Expected : migration créée (colonnes additives, aucun renommage), `prisma generate` OK.

> ⚠️ Mémoire projet : en cas de dérive de migration préexistante, basculer sur `npx prisma db push` pour le DEV (cf. note OneDrive du CLAUDE.md). Couper OneDrive si `.prisma` est amputé, puis `npm install && npx prisma generate`.

- [ ] **Step 6 : Vérifier la compilation TypeScript.**

Run (dossier `backend/`) : `npx tsc --noEmit`
Expected : PASS (les nouveaux champs existent dans les types Prisma).

- [ ] **Step 7 : Commit.**
```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(db): champs paiement en ligne des inscriptions (migration additive)"
```

---

## Task 2 : Helpers purs partagés `registrationPayment.ts`

**Files:**
- Create: `backend/src/services/registrationPayment.ts`
- Test: `backend/src/services/__tests__/registrationPayment.test.ts`

- [ ] **Step 1 : Écrire le test (échouant).**

```ts
import { REGISTRATION_HOLD_MINUTES, holdDeadline, occupiesSpotWhere, entryFeeCents, MIN_STRIPE_CENTS } from '../registrationPayment';

describe('registrationPayment helpers', () => {
  it('holdDeadline ajoute REGISTRATION_HOLD_MINUTES minutes', () => {
    const now = new Date('2026-06-25T10:00:00.000Z');
    expect(holdDeadline(now).toISOString()).toBe(new Date(now.getTime() + REGISTRATION_HOLD_MINUTES * 60_000).toISOString());
  });

  it('occupiesSpotWhere couvre PAID/NONE et DUE non expirée', () => {
    const now = new Date('2026-06-25T10:00:00.000Z');
    const w = occupiesSpotWhere(now);
    expect(w.status).toBe('CONFIRMED');
    expect(w.OR).toEqual([
      { paymentStatus: { in: ['PAID', 'NONE'] } },
      { paymentStatus: 'DUE', paymentDeadline: { gt: now } },
    ]);
  });

  it('entryFeeCents convertit un Decimal-like en centimes arrondis', () => {
    expect(entryFeeCents(12)).toBe(1200);
    expect(entryFeeCents('0.5')).toBe(50);
    expect(entryFeeCents(null)).toBe(0);
  });

  it('MIN_STRIPE_CENTS vaut 50', () => { expect(MIN_STRIPE_CENTS).toBe(50); });
});
```

- [ ] **Step 2 : Lancer le test → échoue** (module absent).

Run (backend/) : `npx jest registrationPayment.test -i`
Expected : FAIL "Cannot find module '../registrationPayment'".

- [ ] **Step 3 : Implémenter le module.**

```ts
import type { Prisma } from '@prisma/client';

/** Fenêtre de paiement d'une place confirmée provisoire (minutes). */
export const REGISTRATION_HOLD_MINUTES = 15;

/** Montant minimal encaissable par Stripe (centimes). */
export const MIN_STRIPE_CENTS = 50;

export function holdDeadline(now: Date): Date {
  return new Date(now.getTime() + REGISTRATION_HOLD_MINUTES * 60_000);
}

/**
 * Clause Prisma identifiant une inscription qui OCCUPE une place :
 * CONFIRMED ET (payée/gratuite, ou DUE dont le délai de paiement n'est pas écoulé).
 * Une DUE expirée ne tient pas la place (sera libérée par le cleanup job).
 */
export function occupiesSpotWhere(now: Date) {
  return {
    status: 'CONFIRMED',
    OR: [
      { paymentStatus: { in: ['PAID', 'NONE'] } },
      { paymentStatus: 'DUE', paymentDeadline: { gt: now } },
    ],
  } satisfies Prisma.TournamentRegistrationWhereInput;
}

/** Convertit entryFee/price (Decimal | number | string | null) en centimes arrondis. */
export function entryFeeCents(fee: unknown): number {
  const n = Math.round(Number(fee) * 100);
  return Number.isFinite(n) ? n : 0;
}
```

> `occupiesSpotWhere` est typée `TournamentRegistrationWhereInput` mais la même forme est valide pour `EventRegistrationWhereInput` (champs identiques) — on la réutilise telle quelle côté event via un cast structurel implicite (les deux acceptent `status`/`paymentStatus`/`paymentDeadline`/`OR`).

- [ ] **Step 4 : Lancer le test → PASS.**

Run (backend/) : `npx jest registrationPayment.test -i`
Expected : PASS (4 tests).

- [ ] **Step 5 : Commit.**
```bash
git add backend/src/services/registrationPayment.ts backend/src/services/__tests__/registrationPayment.test.ts
git commit -m "feat(backend): helpers purs paiement des inscriptions"
```

---

## Task 3 : `StripeService` — intents inscription + débit off-session

**Files:**
- Modify: `backend/src/services/stripe.service.ts`
- Test: `backend/src/services/__tests__/stripe.service.test.ts` (ajouts)

- [ ] **Step 1 : Écrire les tests (échouants)** dans `stripe.service.test.ts`. Suivre le style existant (mock du module `../db/stripe`). Ajouter :

```ts
describe('StripeService — inscriptions', () => {
  it('createRegistrationPaymentIntent passe la metadata tournamentRegistrationId', async () => {
    // arrange : club ACTIVE + customer existant (réutiliser les mocks du fichier)
    // act
    await new StripeService().createRegistrationPaymentIntent({
      clubId: 'club-demo', userId: 'u1', registrationId: 'reg1', kind: 'tournament', amountCents: 1200,
    });
    // assert : stripe.paymentIntents.create appelé avec metadata.tournamentRegistrationId === 'reg1'
    expect(stripeMock.paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1200, metadata: expect.objectContaining({ tournamentRegistrationId: 'reg1', clubId: 'club-demo' }) }),
      expect.objectContaining({ stripeAccount: expect.any(String) }),
    );
  });

  it('chargeRegistrationOffSession lève CARD_DECLINED si la carte est refusée', async () => {
    stripeMock.paymentIntents.create.mockRejectedValueOnce(Object.assign(new Error('declined'), { code: 'card_declined' }));
    await expect(new StripeService().chargeRegistrationOffSession({
      clubId: 'club-demo', userId: 'u1', registrationId: 'reg1', kind: 'event', amountCents: 1500,
    })).rejects.toThrow('CARD_DECLINED');
  });
});
```

> Adapter les noms de mocks (`stripeMock`) à ceux déjà présents dans le fichier (vérifier l'en-tête `jest.mock('../db/stripe', …)`). Reprendre la mise en place de `club` ACTIVE + `clubStripeCustomer` des tests `chargeNoShow` existants.

- [ ] **Step 2 : Lancer → échoue** (méthodes absentes).

Run (backend/) : `npx jest stripe.service.test -i`
Expected : FAIL "createRegistrationPaymentIntent is not a function".

- [ ] **Step 3 : Implémenter les 3 méthodes** dans `StripeService` (après `createSetupIntent`, avant `chargeNoShow`). Helper privé pour la clé de metadata :

```ts
  private regMetaKey(kind: 'tournament' | 'event'): 'tournamentRegistrationId' | 'eventRegistrationId' {
    return kind === 'tournament' ? 'tournamentRegistrationId' : 'eventRegistrationId';
  }

  async createRegistrationPaymentIntent(params: {
    clubId: string; userId: string; registrationId: string; kind: 'tournament' | 'event'; amountCents: number;
  }): Promise<{ clientSecret: string }> {
    const club = await prisma.club.findUnique({
      where: { id: params.clubId }, select: { stripeAccountId: true, stripeAccountStatus: true },
    });
    if (!club?.stripeAccountId || club.stripeAccountStatus !== 'ACTIVE') throw new Error('STRIPE_NOT_CONFIGURED');
    const customer = await this.createOrGetCustomer(params.clubId, params.userId);
    const pi = await stripe.paymentIntents.create(
      {
        amount: params.amountCents, currency: 'eur', customer: customer.stripeCustomerId,
        setup_future_usage: 'off_session',
        metadata: { [this.regMetaKey(params.kind)]: params.registrationId, clubId: params.clubId },
      },
      { stripeAccount: club.stripeAccountId },
    );
    if (!pi.client_secret) throw new Error('STRIPE_ERROR');
    return { clientSecret: pi.client_secret };
  }

  async createRegistrationSetupIntent(params: {
    clubId: string; userId: string; registrationId: string; kind: 'tournament' | 'event';
  }): Promise<{ clientSecret: string }> {
    const club = await prisma.club.findUnique({
      where: { id: params.clubId }, select: { stripeAccountId: true, stripeAccountStatus: true },
    });
    if (!club?.stripeAccountId || club.stripeAccountStatus !== 'ACTIVE') throw new Error('STRIPE_NOT_CONFIGURED');
    const customer = await this.createOrGetCustomer(params.clubId, params.userId);
    const si = await stripe.setupIntents.create(
      {
        customer: customer.stripeCustomerId, usage: 'off_session', payment_method_types: ['card'],
        metadata: { [this.regMetaKey(params.kind)]: params.registrationId, clubId: params.clubId },
      },
      { stripeAccount: club.stripeAccountId },
    );
    if (!si.client_secret) throw new Error('STRIPE_ERROR');
    return { clientSecret: si.client_secret };
  }

  async chargeRegistrationOffSession(params: {
    clubId: string; userId: string; registrationId: string; kind: 'tournament' | 'event'; amountCents: number;
  }): Promise<string> {
    const [club, sc] = await Promise.all([
      prisma.club.findUnique({ where: { id: params.clubId }, select: { stripeAccountId: true } }),
      prisma.clubStripeCustomer.findUnique({ where: { clubId_userId: { clubId: params.clubId, userId: params.userId } } }),
    ]);
    if (!club?.stripeAccountId) throw new Error('STRIPE_NOT_CONFIGURED');
    if (!sc?.defaultPaymentMethodId) throw new Error('NO_CARD_ON_FILE');
    try {
      const pi = await stripe.paymentIntents.create(
        {
          amount: params.amountCents, currency: 'eur', customer: sc.stripeCustomerId,
          payment_method: sc.defaultPaymentMethodId, off_session: true, confirm: true,
          metadata: { [this.regMetaKey(params.kind)]: params.registrationId, clubId: params.clubId },
        },
        { stripeAccount: club.stripeAccountId },
      );
      return pi.id;
    } catch (err: any) {
      if (err?.code === 'card_declined' || err?.code === 'authentication_required') throw new Error('CARD_DECLINED');
      throw err;
    }
  }
```

- [ ] **Step 4 : Lancer → PASS.**

Run (backend/) : `npx jest stripe.service.test -i`
Expected : PASS (suite complète, dont les 2 nouveaux cas).

- [ ] **Step 5 : Commit.**
```bash
git add backend/src/services/stripe.service.ts backend/src/services/__tests__/stripe.service.test.ts
git commit -m "feat(backend): intents Stripe et debit off-session pour les inscriptions"
```

---

## Task 4 : Tournoi — `register` payant + garde-fou `update`

**Files:**
- Modify: `backend/src/services/tournament.service.ts`
- Test: `backend/src/services/__tests__/tournament.service.test.ts` (ajouts + mise à jour des cas existants)

- [ ] **Step 1 : Mettre à jour les tests existants de `register`** (la réponse devient `{ registration, payment }`). Dans les 2 cas existants (`CONFIRMED` reste à la ligne ~49, `WAITLISTED` ~63), remplacer `result.status` par `result.registration.status` ; le `create` reste appelé avec `status`. Puis ajouter les nouveaux cas :

```ts
it('épreuve payante + place dispo → CONFIRMED + DUE + paymentDeadline, mode payment, pas de notif', async () => {
  prismaMock.tournament.findUnique.mockResolvedValue(tournament({ maxTeams: 8, requirePrepayment: true, entryFee: 12 }) as any);
  mockEligibleHappyPath();
  prismaMock.tournamentRegistration.count.mockResolvedValue(3 as any);
  prismaMock.tournamentRegistration.create.mockResolvedValue({ id: 'r1', status: 'CONFIRMED', paymentStatus: 'DUE' } as any);

  const res = await service.register('t1', 'captain', 'partner');

  expect(prismaMock.tournamentRegistration.create).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ status: 'CONFIRMED', paymentStatus: 'DUE', paymentDeadline: expect.any(Date) }) }),
  );
  expect(res.payment).toEqual({ mode: 'payment' });
  expect(notifyTournamentRegistration).not.toHaveBeenCalled();
});

it('épreuve payante + complet → WAITLISTED + DUE (deadline null), mode setup, notif liste d\'attente', async () => {
  prismaMock.tournament.findUnique.mockResolvedValue(tournament({ maxTeams: 8, requirePrepayment: true, entryFee: 12 }) as any);
  mockEligibleHappyPath();
  prismaMock.tournamentRegistration.count.mockResolvedValue(8 as any);
  prismaMock.tournamentRegistration.create.mockResolvedValue({ id: 'r1', status: 'WAITLISTED', paymentStatus: 'DUE' } as any);

  const res = await service.register('t1', 'captain', 'partner');

  expect(prismaMock.tournamentRegistration.create).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ status: 'WAITLISTED', paymentStatus: 'DUE', paymentDeadline: null }) }),
  );
  expect(res.payment).toEqual({ mode: 'setup' });
  expect(notifyTournamentRegistration).toHaveBeenCalledWith('r1');
});

it('épreuve gratuite → payment null, notif immédiate (comportement actuel)', async () => {
  prismaMock.tournament.findUnique.mockResolvedValue(tournament({ maxTeams: 8 }) as any);
  mockEligibleHappyPath();
  prismaMock.tournamentRegistration.count.mockResolvedValue(0 as any);
  prismaMock.tournamentRegistration.create.mockResolvedValue({ id: 'r1', status: 'CONFIRMED', paymentStatus: 'NONE' } as any);

  const res = await service.register('t1', 'captain', 'partner');
  expect(res.payment).toBeNull();
  expect(notifyTournamentRegistration).toHaveBeenCalledWith('r1');
});
```

Mettre à jour le helper `tournament()` (ligne ~15) pour accepter les nouveaux champs (déjà via `...overrides`, OK ; `requirePrepayment` défaut absent → `undefined` se comporte comme falsy, mais ajouter `requirePrepayment: false, entryFee: null` au défaut pour la clarté).

- [ ] **Step 2 : Lancer → échoue** (réponse encore = registration brute).

Run (backend/) : `npx jest tournament.service.test -i -t register`
Expected : FAIL (`res.payment` undefined).

- [ ] **Step 3 : Modifier `register`** dans `tournament.service.ts`. Importer en tête :

```ts
import { occupiesSpotWhere, holdDeadline } from './registrationPayment';
```

Remplacer le corps de `register` (lignes ~33-57) par :

```ts
  async register(tournamentId: string, captainUserId: string, partnerUserId: string) {
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { id: true, clubId: true, gender: true, openToWomen: true, status: true, registrationDeadline: true, maxTeams: true, requirePrepayment: true },
    });
    if (!tournament) throw new Error('TOURNAMENT_NOT_FOUND');
    if (tournament.status !== 'PUBLISHED') throw new Error('TOURNAMENT_NOT_OPEN');
    if (new Date() >= tournament.registrationDeadline) throw new Error('REGISTRATION_CLOSED');

    await this.resolveAndAssertEligible(tournament, captainUserId, partnerUserId);

    const paid = tournament.requirePrepayment;
    const registration = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tournaments WHERE id = ${tournamentId} FOR UPDATE`;
      await this.assertNoActiveRegistration(tx, tournamentId, [captainUserId, partnerUserId]);
      const now = new Date();
      const confirmed = await tx.tournamentRegistration.count({ where: { tournamentId, ...occupiesSpotWhere(now) } });
      const status = tournament.maxTeams == null || confirmed < tournament.maxTeams ? 'CONFIRMED' : 'WAITLISTED';
      return tx.tournamentRegistration.create({
        data: {
          tournamentId, captainUserId, partnerUserId, status,
          ...(paid ? { paymentStatus: 'DUE', paymentDeadline: status === 'CONFIRMED' ? holdDeadline(now) : null } : {}),
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 });

    // Pour une place CONFIRMED payante, la notif d'inscription part au paiement confirmé.
    if (!paid || registration.status === 'WAITLISTED') {
      await this.safeNotify(() => notify.notifyTournamentRegistration(registration.id));
    }
    const payment = paid ? { mode: (registration.status === 'CONFIRMED' ? 'payment' : 'setup') as 'payment' | 'setup' } : null;
    return { registration, payment };
  }
```

- [ ] **Step 4 : Lancer → PASS** (register).

Run (backend/) : `npx jest tournament.service.test -i -t register`
Expected : PASS.

- [ ] **Step 5 : Garde-fou `requirePrepayment` à la création/màj.** Ajouter dans `validateTournamentInput` (avant le `return data`, après le bloc `entryFee`) :

```ts
    if (input.requirePrepayment !== undefined) data.requirePrepayment = Boolean(input.requirePrepayment);
```

Ajouter une méthode privée et l'appeler depuis `createTournament` et `updateTournament` :

```ts
  /** Refuse d'activer le paiement en ligne si le club n'a pas Stripe ACTIVE ou si le montant est < 0,50 €. */
  private async assertPrepaymentAllowed(clubId: string, entryFeeCentsValue: number) {
    const club = await prisma.club.findUnique({ where: { id: clubId }, select: { stripeAccountStatus: true } });
    if (club?.stripeAccountStatus !== 'ACTIVE') throw new Error('ONLINE_PAYMENT_NOT_ENABLED');
    if (entryFeeCentsValue < 50) throw new Error('ONLINE_PAYMENT_NOT_ENABLED');
  }
```

Dans `updateTournament`, étendre le `findFirst` initial pour récupérer l'état courant et vérifier :

```ts
  async updateTournament(tournamentId: string, clubId: string, input: UpdateTournamentInput) {
    const found = await prisma.tournament.findFirst({
      where: { id: tournamentId, clubId },
      select: { id: true, status: true, entryFee: true, requirePrepayment: true },
    });
    if (!found) throw new Error('TOURNAMENT_NOT_FOUND');
    const data = this.validateTournamentInput(input, false);
    if (input.status !== undefined) {
      if (!['DRAFT', 'PUBLISHED', 'CANCELLED'].includes(input.status as string)) throw new Error('VALIDATION_ERROR');
      (data as Record<string, unknown>).status = input.status;
    }
    // Effective requirePrepayment après cette màj : si on l'active, exiger Stripe ACTIVE + montant valide.
    const willRequire = input.requirePrepayment !== undefined ? Boolean(input.requirePrepayment) : found.requirePrepayment;
    if (willRequire) {
      const fee = input.entryFee !== undefined ? Number(input.entryFee) : Number(found.entryFee);
      await this.assertPrepaymentAllowed(clubId, Math.round(fee * 100));
    }
    const updated = await prisma.tournament.update({ where: { id: tournamentId }, data });
    if (input.status === 'CANCELLED' && found.status !== 'CANCELLED') {
      await this.safeNotify(() => notify.notifyActivityCancelledByClub('tournament', tournamentId));
    }
    return updated;
  }
```

Dans `createTournament`, après validation et avant le `create`, si `requirePrepayment` est demandé :

```ts
    if (data.requirePrepayment) await this.assertPrepaymentAllowed(clubId, Math.round(Number((data as any).entryFee ?? 0) * 100));
```

Ajouter `requirePrepayment?: boolean` à `CreateTournamentInput` (interface, ligne ~21).

- [ ] **Step 6 : Tests garde-fou.** Ajouter dans `tournament.service.test.ts` :

```ts
describe('TournamentService.updateTournament — garde-fou paiement', () => {
  it('refuse requirePrepayment=true si Stripe pas ACTIVE', async () => {
    prismaMock.tournament.findFirst.mockResolvedValue({ id: 't1', status: 'PUBLISHED', entryFee: 12, requirePrepayment: false } as any);
    prismaMock.club.findUnique.mockResolvedValue({ stripeAccountStatus: 'NONE' } as any);
    await expect(new TournamentService().updateTournament('t1', 'club-demo', { requirePrepayment: true }))
      .rejects.toThrow('ONLINE_PAYMENT_NOT_ENABLED');
  });

  it('refuse requirePrepayment=true si entryFee < 0,50 €', async () => {
    prismaMock.tournament.findFirst.mockResolvedValue({ id: 't1', status: 'PUBLISHED', entryFee: 0, requirePrepayment: false } as any);
    prismaMock.club.findUnique.mockResolvedValue({ stripeAccountStatus: 'ACTIVE' } as any);
    await expect(new TournamentService().updateTournament('t1', 'club-demo', { requirePrepayment: true }))
      .rejects.toThrow('ONLINE_PAYMENT_NOT_ENABLED');
  });

  it('accepte requirePrepayment=true si Stripe ACTIVE + montant OK', async () => {
    prismaMock.tournament.findFirst.mockResolvedValue({ id: 't1', status: 'PUBLISHED', entryFee: 12, requirePrepayment: false } as any);
    prismaMock.club.findUnique.mockResolvedValue({ stripeAccountStatus: 'ACTIVE' } as any);
    prismaMock.tournament.update.mockResolvedValue({ id: 't1' } as any);
    await expect(new TournamentService().updateTournament('t1', 'club-demo', { requirePrepayment: true })).resolves.toBeTruthy();
  });
});
```

- [ ] **Step 7 : Lancer → PASS, puis commit.**

Run (backend/) : `npx jest tournament.service.test -i`
Expected : PASS.
```bash
git add backend/src/services/tournament.service.ts backend/src/services/__tests__/tournament.service.test.ts
git commit -m "feat(tournoi): inscription payante (DUE/hold) + garde-fou activation paiement"
```

---

## Task 5 : Tournoi — `confirmRegistrationPayment` (idempotent)

**Files:**
- Modify: `backend/src/services/tournament.service.ts`
- Test: `backend/src/services/__tests__/tournament.service.test.ts` (ajouts)

- [ ] **Step 1 : Test (échouant).**

```ts
describe('TournamentService.confirmRegistrationPayment', () => {
  it('DUE → PAID, crée un Payment ONLINE et notifie', async () => {
    prismaMock.tournamentRegistration.findUnique.mockResolvedValue({
      id: 'r1', paymentStatus: 'DUE', captainUserId: 'captain', tournament: { clubId: 'club-demo', entryFee: 12 },
    } as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.tournamentRegistration.updateMany.mockResolvedValue({ count: 1 } as any);
    // PackageService.nextReceiptNo est statique → mocker via spyOn dans le test (voir note)
    prismaMock.payment.create.mockResolvedValue({ id: 'pay1' } as any);
    prismaMock.tournamentRegistration.findUnique.mockResolvedValueOnce({
      id: 'r1', paymentStatus: 'DUE', captainUserId: 'captain', tournament: { clubId: 'club-demo', entryFee: 12 },
    } as any).mockResolvedValueOnce({ id: 'r1', status: 'CONFIRMED', paymentStatus: 'PAID' } as any);

    await new TournamentService().confirmRegistrationPayment('r1', { stripePaymentIntentId: 'pi_1' });

    expect(prismaMock.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tournamentRegistrationId: 'r1', method: 'ONLINE', status: 'CAPTURED', stripePaymentIntentId: 'pi_1' }) }),
    );
    expect(notifyTournamentRegistration).toHaveBeenCalledWith('r1');
  });

  it('idempotent : si déjà PAID, ne recrée pas de Payment', async () => {
    prismaMock.tournamentRegistration.findUnique.mockResolvedValue({
      id: 'r1', paymentStatus: 'PAID', captainUserId: 'captain', tournament: { clubId: 'club-demo', entryFee: 12 },
    } as any);
    await new TournamentService().confirmRegistrationPayment('r1', { stripePaymentIntentId: 'pi_1' });
    expect(prismaMock.payment.create).not.toHaveBeenCalled();
  });
});
```

> Note : `PackageService.nextReceiptNo` est statique. En tête du test : `import { PackageService } from '../package.service'; jest.spyOn(PackageService, 'nextReceiptNo').mockResolvedValue(1 as any);` (dans `beforeEach`).

- [ ] **Step 2 : Lancer → échoue.**

Run : `npx jest tournament.service.test -i -t confirmRegistrationPayment`
Expected : FAIL "confirmRegistrationPayment is not a function".

- [ ] **Step 3 : Implémenter.** Imports en tête :

```ts
import { entryFeeCents } from './registrationPayment';
import { PackageService } from './package.service';
```

Méthode (après `register`) :

```ts
  /** Confirme le paiement d'une inscription DUE → PAID + Payment ONLINE. Idempotent (client + webhook). */
  async confirmRegistrationPayment(regId: string, opts: { stripePaymentIntentId: string }) {
    const reg = await prisma.tournamentRegistration.findUnique({
      where: { id: regId },
      select: { id: true, paymentStatus: true, tournament: { select: { clubId: true, entryFee: true } } },
    });
    if (!reg) throw new Error('REGISTRATION_NOT_FOUND');
    if (reg.paymentStatus !== 'DUE') return reg; // déjà confirmé / non payant → no-op idempotent

    const amountCents = entryFeeCents(reg.tournament.entryFee);
    const result = await prisma.$transaction(async (tx) => {
      const flip = await tx.tournamentRegistration.updateMany({
        where: { id: regId, paymentStatus: 'DUE' },
        data: { paymentStatus: 'PAID', paymentDeadline: null },
      });
      if (flip.count === 0) return null; // confirmé concurremment
      const receiptNo = await PackageService.nextReceiptNo(tx, reg.tournament.clubId);
      await tx.payment.create({
        data: {
          clubId: reg.tournament.clubId, tournamentRegistrationId: regId,
          amount: new Prisma.Decimal(amountCents).div(100),
          method: 'ONLINE', status: 'CAPTURED', stripePaymentIntentId: opts.stripePaymentIntentId, receiptNo,
        },
      });
      return tx.tournamentRegistration.findUnique({ where: { id: regId } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 });

    if (result) await this.safeNotify(() => notify.notifyTournamentRegistration(regId));
    return result ?? reg;
  }
```

- [ ] **Step 4 : Lancer → PASS, commit.**

Run : `npx jest tournament.service.test -i -t confirmRegistrationPayment`
Expected : PASS.
```bash
git add backend/src/services/tournament.service.ts backend/src/services/__tests__/tournament.service.test.ts
git commit -m "feat(tournoi): confirmation idempotente du paiement d'inscription"
```

---

## Task 6 : Tournoi — promotion payante (débit off-session + bascule au suivant)

**Files:**
- Modify: `backend/src/services/tournament.service.ts`
- Test: `backend/src/services/__tests__/tournament.service.test.ts` (ajouts)

- [ ] **Step 1 : Tests (échouants).**

```ts
describe('TournamentService.chargePromotedRegistration', () => {
  const reg = (over = {}) => ({ id: 'r1', status: 'CONFIRMED', paymentStatus: 'DUE', captainUserId: 'captain', tournamentId: 't1', tournament: { clubId: 'club-demo', entryFee: 12 }, ...over });

  it('débit OK → PAID + Payment + notif promotion', async () => {
    prismaMock.tournamentRegistration.findUnique.mockResolvedValue(reg() as any);
    jest.spyOn(StripeService.prototype, 'chargeRegistrationOffSession').mockResolvedValue('pi_ok');
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.tournamentRegistration.updateMany.mockResolvedValue({ count: 1 } as any);
    jest.spyOn(PackageService, 'nextReceiptNo').mockResolvedValue(1 as any);

    await new TournamentService().chargePromotedRegistration('r1');

    expect(prismaMock.payment.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tournamentRegistrationId: 'r1', stripePaymentIntentId: 'pi_ok' }) }));
    expect(notifyTournamentPromotion).toHaveBeenCalledWith('r1');
  });

  it('carte refusée → annule la place et promeut le suivant', async () => {
    prismaMock.tournamentRegistration.findUnique
      .mockResolvedValueOnce(reg() as any)            // 1er appel : reg à débiter
      .mockResolvedValueOnce(reg({ id: 'r2' }) as any); // récursion sur le suivant promu
    jest.spyOn(StripeService.prototype, 'chargeRegistrationOffSession')
      .mockRejectedValueOnce(new Error('CARD_DECLINED'))
      .mockResolvedValueOnce('pi_ok');
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([] as any);
    prismaMock.tournamentRegistration.update.mockResolvedValue({ id: 'r1', status: 'CANCELLED' } as any);
    prismaMock.tournamentRegistration.findFirst.mockResolvedValue({ id: 'r2' } as any); // suivant WAITLISTED
    prismaMock.tournamentRegistration.updateMany.mockResolvedValue({ count: 1 } as any);
    jest.spyOn(PackageService, 'nextReceiptNo').mockResolvedValue(1 as any);

    await new TournamentService().chargePromotedRegistration('r1');

    expect(notifyTournamentCancellation).toHaveBeenCalledWith('r1');
    expect(notifyTournamentPromotion).toHaveBeenCalledWith('r2');
  });
});
```

- [ ] **Step 2 : Lancer → échoue.**

Run : `npx jest tournament.service.test -i -t chargePromotedRegistration`
Expected : FAIL.

- [ ] **Step 3 : Implémenter.** Import en tête : `import { StripeService } from './stripe.service';`. Modifier `cancelAndPromoteTx` pour accepter un drapeau `paid` (et poser le `paymentDeadline` du promu) :

```ts
  private async cancelAndPromoteTx(tx: Prisma.TransactionClient, tournamentId: string, regId: string, wasConfirmed: boolean, paid = false) {
    const cancelled = await tx.tournamentRegistration.update({
      where: { id: regId },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    let promotedRegistrationId: string | null = null;
    if (wasConfirmed) {
      const next = await tx.tournamentRegistration.findFirst({
        where: { tournamentId, status: 'WAITLISTED' },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (next) {
        await tx.tournamentRegistration.update({
          where: { id: next.id },
          data: { status: 'CONFIRMED', ...(paid ? { paymentDeadline: holdDeadline(new Date()) } : {}) },
        });
        promotedRegistrationId = next.id;
      }
    }
    return { cancelled, promotedRegistrationId };
  }
```

Ajouter la méthode de débit du promu :

```ts
  /** Débite off-session une place promue payante (DUE). Échec → libère la place et promeut le suivant. Best-effort, post-commit. */
  async chargePromotedRegistration(regId: string): Promise<void> {
    const reg = await prisma.tournamentRegistration.findUnique({
      where: { id: regId },
      select: { id: true, status: true, paymentStatus: true, captainUserId: true, tournamentId: true, tournament: { select: { clubId: true, entryFee: true } } },
    });
    if (!reg || reg.status !== 'CONFIRMED' || reg.paymentStatus !== 'DUE') return;
    const amountCents = entryFeeCents(reg.tournament.entryFee);

    let piId: string;
    try {
      piId = await new StripeService().chargeRegistrationOffSession({
        clubId: reg.tournament.clubId, userId: reg.captainUserId, registrationId: regId, kind: 'tournament', amountCents,
      });
    } catch {
      // Carte refusée / absente → on libère cette place et on promeut le suivant.
      const { cancelled, promotedRegistrationId } = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM tournaments WHERE id = ${reg.tournamentId} FOR UPDATE`;
        return this.cancelAndPromoteTx(tx, reg.tournamentId, regId, true, true);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 });
      await this.safeNotify(() => notify.notifyTournamentCancellation(cancelled.id)); // v1 : email « désinscription » (carte refusée)
      if (promotedRegistrationId) {
        await this.safeNotify(() => notify.notifyTournamentPromotion(promotedRegistrationId));
        await this.chargePromotedRegistration(promotedRegistrationId);
      }
      return;
    }

    await prisma.$transaction(async (tx) => {
      const flip = await tx.tournamentRegistration.updateMany({ where: { id: regId, paymentStatus: 'DUE' }, data: { paymentStatus: 'PAID', paymentDeadline: null } });
      if (flip.count === 0) return;
      const receiptNo = await PackageService.nextReceiptNo(tx, reg.tournament.clubId);
      await tx.payment.create({
        data: { clubId: reg.tournament.clubId, tournamentRegistrationId: regId, amount: new Prisma.Decimal(amountCents).div(100), method: 'ONLINE', status: 'CAPTURED', stripePaymentIntentId: piId, receiptNo },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 });
    await this.safeNotify(() => notify.notifyTournamentPromotion(regId));
  }
```

Brancher la promotion sur les chemins d'annulation. Dans `cancelRegistration` et `adminRemoveRegistration`, après `notifyCancellation`, si une place a été promue et que le tournoi est payant, débiter. Pour cela, récupérer `requirePrepayment` du tournoi. Modifier le `findUnique` initial de `cancelRegistration` :

```ts
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { registrationDeadline: true, clubId: true, requirePrepayment: true },
    });
```

Passer `paid` à `cancelAndPromoteTx` (4ᵉ arg `tournament.requirePrepayment`) dans les deux transactions, puis après `this.notifyCancellation(...)` :

```ts
    if (promotedRegistrationId && tournament.requirePrepayment) {
      await this.chargePromotedRegistration(promotedRegistrationId);
    }
```

Pour `adminRemoveRegistration`, charger aussi `requirePrepayment` (le `findClubRegistration` ne le donne pas → faire un `prisma.tournament.findUnique({ where: { id: tournamentId }, select: { requirePrepayment: true } })` avant la transaction) et appliquer la même logique.

Pour `adminPromoteRegistration` (promotion manuelle), si le tournoi est payant, poser `DUE + deadline` puis débiter :

```ts
  async adminPromoteRegistration(tournamentId: string, regId: string, clubId: string) {
    const reg = await this.findClubRegistration(tournamentId, regId, clubId);
    if (reg.status !== 'WAITLISTED') throw new Error('VALIDATION_ERROR');
    const t = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { requirePrepayment: true } });
    if (t?.requirePrepayment) {
      await prisma.tournamentRegistration.update({ where: { id: regId }, data: { status: 'CONFIRMED', paymentStatus: 'DUE', paymentDeadline: holdDeadline(new Date()) } });
      await this.chargePromotedRegistration(regId);
      return prisma.tournamentRegistration.findUnique({ where: { id: regId } });
    }
    const promoted = await prisma.tournamentRegistration.update({ where: { id: regId }, data: { status: 'CONFIRMED' } });
    await this.safeNotify(() => notify.notifyTournamentPromotion(promoted.id));
    return promoted;
  }
```

- [ ] **Step 4 : Lancer → PASS, commit.**

Run : `npx jest tournament.service.test -i`
Expected : PASS.
```bash
git add backend/src/services/tournament.service.ts backend/src/services/__tests__/tournament.service.test.ts
git commit -m "feat(tournoi): debit off-session a la promotion (bascule au suivant si carte refusee)"
```

---

## Task 7 : Tournoi — remboursement auto à la désinscription avant clôture

**Files:**
- Modify: `backend/src/services/tournament.service.ts`
- Test: `backend/src/services/__tests__/tournament.service.test.ts` (ajouts)

- [ ] **Step 1 : Tests (échouants).**

```ts
describe('TournamentService.cancelRegistration — remboursement', () => {
  it('inscription PAID annulée avant clôture → RefundService.refund appelé + REFUNDED', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue({ registrationDeadline: FUTURE, clubId: 'club-demo', requirePrepayment: true } as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([] as any);
    prismaMock.tournamentRegistration.findFirst.mockResolvedValue({ id: 'r1', status: 'CONFIRMED', paymentStatus: 'PAID' } as any);
    prismaMock.tournamentRegistration.update.mockResolvedValue({ id: 'r1', status: 'CANCELLED' } as any);
    prismaMock.payment.findFirst.mockResolvedValue({ id: 'pay1', amount: 12 } as any);
    const refundSpy = jest.spyOn(RefundService.prototype, 'refund').mockResolvedValue({ id: 'rf1' } as any);

    await new TournamentService().cancelRegistration('t1', 'captain');

    expect(refundSpy).toHaveBeenCalledWith(expect.objectContaining({ paymentId: 'pay1', clubId: 'club-demo', amount: 12 }));
    expect(prismaMock.tournamentRegistration.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'r1' }, data: { paymentStatus: 'REFUNDED' } }));
  });

  it('inscription NONE (gratuite) → pas de remboursement', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue({ registrationDeadline: FUTURE, clubId: 'club-demo', requirePrepayment: false } as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([] as any);
    prismaMock.tournamentRegistration.findFirst.mockResolvedValue({ id: 'r1', status: 'CONFIRMED', paymentStatus: 'NONE' } as any);
    prismaMock.tournamentRegistration.update.mockResolvedValue({ id: 'r1', status: 'CANCELLED' } as any);
    const refundSpy = jest.spyOn(RefundService.prototype, 'refund');
    await new TournamentService().cancelRegistration('t1', 'captain');
    expect(refundSpy).not.toHaveBeenCalled();
  });
});
```

En tête du fichier de test : `import { RefundService } from '../refund.service';`.

- [ ] **Step 2 : Lancer → échoue.**

Run : `npx jest tournament.service.test -i -t "cancelRegistration — remboursement"`
Expected : FAIL.

- [ ] **Step 3 : Implémenter.** Import en tête : `import { RefundService } from './refund.service';`. Réécrire `cancelRegistration` :

```ts
  async cancelRegistration(tournamentId: string, captainUserId: string) {
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { registrationDeadline: true, clubId: true, requirePrepayment: true },
    });
    if (!tournament) throw new Error('TOURNAMENT_NOT_FOUND');
    if (new Date() >= tournament.registrationDeadline) throw new Error('REGISTRATION_LOCKED');

    const { cancelled, promotedRegistrationId, refund } = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tournaments WHERE id = ${tournamentId} FOR UPDATE`;
      const reg = await tx.tournamentRegistration.findFirst({
        where: { tournamentId, captainUserId, status: { not: 'CANCELLED' } },
        select: { id: true, status: true, paymentStatus: true },
      });
      if (!reg) throw new Error('REGISTRATION_NOT_FOUND');
      const res = await this.cancelAndPromoteTx(tx, tournamentId, reg.id, reg.status === 'CONFIRMED', tournament.requirePrepayment);
      let refund: { paymentId: string; amount: number; regId: string } | null = null;
      if (reg.paymentStatus === 'PAID') {
        const pay = await tx.payment.findFirst({ where: { tournamentRegistrationId: reg.id, method: 'ONLINE' }, select: { id: true, amount: true } });
        if (pay) refund = { paymentId: pay.id, amount: Number(pay.amount), regId: reg.id };
      }
      return { ...res, refund };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 });

    await this.notifyCancellation(cancelled.id, promotedRegistrationId);
    if (promotedRegistrationId && tournament.requirePrepayment) await this.chargePromotedRegistration(promotedRegistrationId);
    if (refund) await this.safeRefund(refund, tournament.clubId);
    return cancelled;
  }

  /** Remboursement best-effort (avant clôture) ; ne fait jamais échouer la désinscription. */
  private async safeRefund(info: { paymentId: string; amount: number; regId: string }, clubId: string): Promise<void> {
    try {
      await new RefundService().refund({ paymentId: info.paymentId, clubId, amount: info.amount, reason: 'Désinscription avant clôture' });
      await prisma.tournamentRegistration.update({ where: { id: info.regId }, data: { paymentStatus: 'REFUNDED' } });
    } catch (err) {
      console.error('[refund] désinscription tournoi : remboursement échoué', err);
    }
  }
```

- [ ] **Step 4 : Lancer → PASS, commit.**

Run : `npx jest tournament.service.test -i`
Expected : PASS.
```bash
git add backend/src/services/tournament.service.ts backend/src/services/__tests__/tournament.service.test.ts
git commit -m "feat(tournoi): remboursement auto a la desinscription avant cloture"
```

---

## Task 8 : Event — `register` payant + garde-fou `update`

**Files:**
- Modify: `backend/src/services/event.service.ts`
- Test: `backend/src/services/__tests__/event.service.test.ts`

Miroir de la Task 4, côté inscription **individuelle**.

- [ ] **Step 1 : Tests** (adapter le helper `event()` du fichier ; ajouter `requirePrepayment`/`price`). Cas : payant place dispo → `{ registration: CONFIRMED+DUE+deadline, payment:{mode:'payment'} }`, pas de `notifyEventRegistration` ; payant complet → `WAITLISTED+DUE` (deadline null), `payment:{mode:'setup'}`, notif ; gratuit → `payment:null`, notif. Plus garde-fou `updateEvent` (Stripe inactif / price<0,50 → `ONLINE_PAYMENT_NOT_ENABLED`). Reprendre les assertions de la Task 4 en remplaçant `tournamentRegistration`→`eventRegistration`, `notifyTournamentRegistration`→`notifyEventRegistration`, `entryFee`→`price`.

- [ ] **Step 2 : Lancer → échoue.** Run : `npx jest event.service.test -i -t register`.

- [ ] **Step 3 : Implémenter.** Imports : `import { occupiesSpotWhere, holdDeadline } from './registrationPayment';`. Réécrire la fin de `register` (le bloc transaction + notif + return) :

```ts
    const event = await prisma.clubEvent.findUnique({
      where: { id: eventId },
      select: { id: true, clubId: true, status: true, registrationDeadline: true, capacity: true, memberOnly: true, requirePrepayment: true },
    });
    // … (gardes existantes inchangées) …
    const paid = event.requirePrepayment;
    const registration = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM club_events WHERE id = ${eventId} FOR UPDATE`;
      const existing = await tx.eventRegistration.findUnique({
        where: { eventId_userId: { eventId, userId } }, select: { id: true, status: true },
      });
      if (existing && existing.status !== 'CANCELLED') throw new Error('ALREADY_REGISTERED');
      const now = new Date();
      const confirmed = await tx.eventRegistration.count({ where: { eventId, ...(occupiesSpotWhere(now) as any) } });
      const status = event.capacity == null || confirmed < event.capacity ? 'CONFIRMED' : 'WAITLISTED';
      const paymentFields = paid
        ? { paymentStatus: 'DUE' as const, paymentDeadline: status === 'CONFIRMED' ? holdDeadline(now) : null }
        : {};
      if (existing) {
        return tx.eventRegistration.update({
          where: { id: existing.id },
          data: { status, cancelledAt: null, createdAt: new Date(), paymentStatus: paid ? 'DUE' : 'NONE', paymentDeadline: paid && status === 'CONFIRMED' ? holdDeadline(now) : null },
        });
      }
      return tx.eventRegistration.create({ data: { eventId, userId, status, ...paymentFields } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 });

    if (!paid || registration.status === 'WAITLISTED') {
      await this.safeNotify(() => notify.notifyEventRegistration(registration.id));
    }
    const payment = paid ? { mode: (registration.status === 'CONFIRMED' ? 'payment' : 'setup') as 'payment' | 'setup' } : null;
    return { registration, payment };
```

> `occupiesSpotWhere` est typée tournoi ; côté event, caster `as any` (forme structurelle identique) comme montré.

Garde-fou : ajouter `if (input.requirePrepayment !== undefined) data.requirePrepayment = Boolean(input.requirePrepayment);` dans `validateEventInput`, la méthode privée `assertPrepaymentAllowed(clubId, priceCents)` (identique à la Task 4) et l'appel dans `updateEvent`/`createEvent` en utilisant `price` au lieu d'`entryFee`. Ajouter `requirePrepayment?: boolean` à `CreateEventInput`.

- [ ] **Step 4 : Lancer → PASS, commit.**
```bash
git add backend/src/services/event.service.ts backend/src/services/__tests__/event.service.test.ts
git commit -m "feat(event): inscription payante (DUE/hold) + garde-fou activation paiement"
```

---

## Task 9 : Event — `confirmRegistrationPayment` (idempotent)

**Files:** Modify `backend/src/services/event.service.ts` ; Test `event.service.test.ts`.

Miroir de la Task 5. Imports : `entryFeeCents` (sur `price`), `PackageService`. La requête `findUnique` sélectionne `event: { select: { clubId, price } }`. Le `Payment` créé porte `eventRegistrationId: regId`. Notif = `notifyEventRegistration(regId)`.

- [ ] **Step 1 : Tests** (miroir Task 5, `eventRegistration`/`price`/`notifyEventRegistration`).
- [ ] **Step 2 : Lancer → échoue.**
- [ ] **Step 3 : Implémenter** `confirmRegistrationPayment(regId, { stripePaymentIntentId })` (copie de la Task 5, `tournamentRegistration`→`eventRegistration`, `tournament`→`event`, `entryFee`→`price`, `tournamentRegistrationId`→`eventRegistrationId`, notif event).
- [ ] **Step 4 : Lancer → PASS, commit.**
```bash
git commit -am "feat(event): confirmation idempotente du paiement d'inscription"
```

---

## Task 10 : Event — promotion payante (débit off-session)

**Files:** Modify `backend/src/services/event.service.ts` ; Test `event.service.test.ts`.

Miroir de la Task 6. `cancelAndPromoteTx` reçoit `paid` et pose `paymentDeadline` du promu. `chargePromotedRegistration(regId)` : `kind: 'event'`, `eventRegistrationId`, notif `notifyEventPromotion`/`notifyEventCancellation`, lock `SELECT id FROM club_events … FOR UPDATE`. Brancher dans `cancelRegistration` (charger `requirePrepayment`), `adminRemoveRegistration`, `adminPromoteRegistration`.

- [ ] **Step 1 : Tests** (miroir Task 6).
- [ ] **Step 2 : Lancer → échoue.**
- [ ] **Step 3 : Implémenter** (copie adaptée de la Task 6).
- [ ] **Step 4 : Lancer → PASS, commit.**
```bash
git commit -am "feat(event): debit off-session a la promotion (bascule au suivant)"
```

---

## Task 11 : Event — remboursement auto à la désinscription

**Files:** Modify `backend/src/services/event.service.ts` ; Test `event.service.test.ts`.

Miroir de la Task 7. `cancelRegistration` charge `requirePrepayment` + `clubId` ; détecte le `Payment` ONLINE (`eventRegistrationId`) si `paymentStatus === 'PAID'` ; `safeRefund` → `RefundService.refund` + `eventRegistration.update({ paymentStatus: 'REFUNDED' })`.

- [ ] **Step 1 : Tests** (miroir Task 7).
- [ ] **Step 2 : Lancer → échoue.**
- [ ] **Step 3 : Implémenter.**
- [ ] **Step 4 : Lancer → PASS, commit.**
```bash
git commit -am "feat(event): remboursement auto a la desinscription avant cloture"
```

---

## Task 12 : Webhook Stripe — routage vers les inscriptions

**Files:**
- Modify: `backend/src/routes/stripe-webhooks.ts`
- Test: `backend/src/routes/__tests__/stripe.webhook.test.ts` (ajouts)

- [ ] **Step 1 : Tests (échouants).** Suivre le style du fichier (construction d'event mockée). Ajouter :

```ts
it('payment_intent.succeeded avec tournamentRegistrationId → confirme l\'inscription tournoi', async () => {
  const spy = jest.spyOn(TournamentService.prototype, 'confirmRegistrationPayment').mockResolvedValue({} as any);
  // event : metadata { tournamentRegistrationId: 'reg1' }, id 'pi_1'
  await postWebhook(makeEvent('payment_intent.succeeded', { id: 'pi_1', metadata: { tournamentRegistrationId: 'reg1' } }));
  expect(spy).toHaveBeenCalledWith('reg1', { stripePaymentIntentId: 'pi_1' });
});

it('payment_intent.succeeded avec eventRegistrationId → confirme l\'inscription event', async () => {
  const spy = jest.spyOn(EventService.prototype, 'confirmRegistrationPayment').mockResolvedValue({} as any);
  await postWebhook(makeEvent('payment_intent.succeeded', { id: 'pi_2', metadata: { eventRegistrationId: 'reg2' } }));
  expect(spy).toHaveBeenCalledWith('reg2', { stripePaymentIntentId: 'pi_2' });
});
```

> Réutiliser les helpers `makeEvent`/`postWebhook` existants du fichier ; sinon les écrire en miroir du test `reservationId` déjà présent.

- [ ] **Step 2 : Lancer → échoue.**

Run : `npx jest stripe.webhook.test -i`
Expected : FAIL.

- [ ] **Step 3 : Implémenter.** En tête : `import { TournamentService } from '../services/tournament.service'; import { EventService } from '../services/event.service';`. Dans le `case 'payment_intent.succeeded'`, **avant** le bloc `reservationId`, ajouter le routage inscription :

```ts
      case 'payment_intent.succeeded': {
        const pi = event.data.object as { id: string; metadata: Record<string, string>; payment_method: string | null };

        if (pi.metadata?.tournamentRegistrationId) {
          try { await new TournamentService().confirmRegistrationPayment(pi.metadata.tournamentRegistrationId, { stripePaymentIntentId: pi.id }); } catch { /* idempotent */ }
          break;
        }
        if (pi.metadata?.eventRegistrationId) {
          try { await new EventService().confirmRegistrationPayment(pi.metadata.eventRegistrationId, { stripePaymentIntentId: pi.id }); } catch { /* idempotent */ }
          break;
        }

        const reservationId = pi.metadata?.reservationId;
        if (!reservationId) break;
        // … bloc réservation existant inchangé …
      }
```

Dans le `case 'setup_intent.succeeded'`, généraliser l'enregistrement de la carte aux inscriptions : si `si.metadata.tournamentRegistrationId` ou `eventRegistrationId`, résoudre `(clubId, userId)` de l'inscription et faire le même `clubStripeCustomer.updateMany` que pour la réservation :

```ts
      case 'setup_intent.succeeded': {
        const si = event.data.object as { id: string; metadata: Record<string, string>; payment_method: string | null };
        if (!si.payment_method) break;
        const clubId = si.metadata?.clubId;

        if (si.metadata?.tournamentRegistrationId && clubId) {
          const reg = await prisma.tournamentRegistration.findUnique({ where: { id: si.metadata.tournamentRegistrationId }, select: { captainUserId: true } });
          if (reg) await prisma.clubStripeCustomer.updateMany({ where: { clubId, userId: reg.captainUserId, defaultPaymentMethodId: null }, data: { defaultPaymentMethodId: si.payment_method } });
          break;
        }
        if (si.metadata?.eventRegistrationId && clubId) {
          const reg = await prisma.eventRegistration.findUnique({ where: { id: si.metadata.eventRegistrationId }, select: { userId: true } });
          if (reg) await prisma.clubStripeCustomer.updateMany({ where: { clubId, userId: reg.userId, defaultPaymentMethodId: null }, data: { defaultPaymentMethodId: si.payment_method } });
          break;
        }

        // … bloc réservation existant (si.metadata.reservationId) inchangé …
      }
```

- [ ] **Step 4 : Lancer → PASS, commit.**

Run : `npx jest stripe.webhook.test -i`
Expected : PASS.
```bash
git add backend/src/routes/stripe-webhooks.ts backend/src/routes/__tests__/stripe.webhook.test.ts
git commit -m "feat(webhook): routage paiement/setup Stripe vers les inscriptions"
```

---

## Task 13 : Job de nettoyage — libérer les `DUE` expirées

**Files:**
- Modify: `backend/src/jobs/cleanup.job.ts`
- Test: `backend/src/jobs/__tests__/cleanup.job.test.ts` (créer si absent)

- [ ] **Step 1 : Extraire la logique testable.** Le job actuel est un `cron.schedule` non testable directement. Ajouter une fonction exportée `releaseExpiredRegistrations(now: Date)` appelée par le cron, qui :
  1. cherche les `TournamentRegistration` et `EventRegistration` `status='CONFIRMED' AND paymentStatus='DUE' AND paymentDeadline < now` ;
  2. pour chacune, exécute un cancel+promote (réutiliser le service : `new TournamentService()` expose une méthode publique de libération, ou refaire la transaction lock+cancelAndPromote). Le plus simple et cohérent : appeler `adminRemoveRegistration` n'est pas adapté (clubId requis). Ajouter à chaque service une méthode `releaseExpired(regId)` qui annule + promeut + (si paid) déclenche `chargePromotedRegistration`.

Ajouter dans `TournamentService` (et miroir Event) :

```ts
  /** Libère une place dont le paiement initial a expiré (CONFIRMED+DUE échue) et promeut le suivant. */
  async releaseExpiredRegistration(regId: string): Promise<void> {
    const reg = await prisma.tournamentRegistration.findUnique({
      where: { id: regId },
      select: { id: true, status: true, paymentStatus: true, tournamentId: true, tournament: { select: { requirePrepayment: true } } },
    });
    if (!reg || reg.status !== 'CONFIRMED' || reg.paymentStatus !== 'DUE') return;
    const { cancelled, promotedRegistrationId } = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tournaments WHERE id = ${reg.tournamentId} FOR UPDATE`;
      return this.cancelAndPromoteTx(tx, reg.tournamentId, regId, true, reg.tournament.requirePrepayment);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 });
    await this.notifyCancellation(cancelled.id, promotedRegistrationId);
    if (promotedRegistrationId && reg.tournament.requirePrepayment) await this.chargePromotedRegistration(promotedRegistrationId);
  }
```

- [ ] **Step 2 : Test** (`cleanup.job.test.ts`) ciblant une nouvelle fonction `releaseExpiredRegistrations(now)` :

```ts
it('annule les inscriptions CONFIRMED+DUE expirées et appelle releaseExpiredRegistration', async () => {
  prismaMock.tournamentRegistration.findMany.mockResolvedValue([{ id: 'r1' }] as any);
  prismaMock.eventRegistration.findMany.mockResolvedValue([] as any);
  const tSpy = jest.spyOn(TournamentService.prototype, 'releaseExpiredRegistration').mockResolvedValue();
  await releaseExpiredRegistrations(new Date());
  expect(tSpy).toHaveBeenCalledWith('r1');
});
```

- [ ] **Step 3 : Implémenter `releaseExpiredRegistrations`** dans `cleanup.job.ts` et l'appeler dans le `cron.schedule` (nouveau bloc `try/catch`, après le bloc match) :

```ts
export async function releaseExpiredRegistrations(now: Date): Promise<void> {
  const tournamentSvc = new TournamentService();
  const eventSvc = new EventService();
  const [tRegs, eRegs] = await Promise.all([
    prisma.tournamentRegistration.findMany({ where: { status: 'CONFIRMED', paymentStatus: 'DUE', paymentDeadline: { lt: now } }, select: { id: true } }),
    prisma.eventRegistration.findMany({ where: { status: 'CONFIRMED', paymentStatus: 'DUE', paymentDeadline: { lt: now } }, select: { id: true } }),
  ]);
  for (const r of tRegs) await tournamentSvc.releaseExpiredRegistration(r.id);
  for (const r of eRegs) await eventSvc.releaseExpiredRegistration(r.id);
  if (tRegs.length + eRegs.length > 0) console.log(`[cleanup] ${tRegs.length + eRegs.length} inscription(s) DUE expirée(s) libérée(s)`);
}
```

Imports en tête : `TournamentService`, `EventService`. Dans le `cron.schedule`, ajouter :

```ts
    try { await releaseExpiredRegistrations(new Date()); }
    catch (err) { console.error('[cleanup] inscriptions DUE:', (err as Error).message); }
```

- [ ] **Step 4 : Lancer → PASS, commit.**

Run : `npx jest cleanup.job.test -i`
Expected : PASS.
```bash
git add backend/src/jobs/cleanup.job.ts backend/src/jobs/__tests__/cleanup.job.test.ts backend/src/services/tournament.service.ts backend/src/services/event.service.ts
git commit -m "feat(job): liberation des inscriptions DUE expirees + promotion"
```

---

## Task 14 : Routes inscriptions — réponse + intent + confirm

**Files:**
- Modify: `backend/src/routes/tournaments.ts`, `backend/src/routes/events.ts`, `backend/src/routes/admin.ts`
- Test: `backend/src/routes/__tests__/tournaments.routes.test.ts`, `events.routes.test.ts` (créer/compléter)

- [ ] **Step 1 : Tests** (au style supertest des routes existantes, sinon tests d'appels service mockés). Vérifier : `POST /:id/register` renvoie `{ registration, payment }` ; `POST /:id/registrations/:regId/intent` renvoie `{ clientSecret, stripeAccountId }` ; `POST /:id/registrations/:regId/confirm-payment` confirme. Garde 403 si la ligne n'appartient pas à l'appelant.

- [ ] **Step 2 : Lancer → échoue.**

- [ ] **Step 3 : Implémenter `tournaments.ts`.** Ajouter `ONLINE_PAYMENT_NOT_ENABLED: 409`, `STRIPE_NOT_CONFIGURED: 409`, `AMOUNT_TOO_SMALL: 400` à `ERROR_STATUS`. `register` renvoie déjà l'objet `{ registration, payment }` (la ligne 58 `res.status(201).json(await service.register(...))` fonctionne telle quelle). Ajouter les routes :

```ts
import { StripeService } from '../services/stripe.service';
import { prisma } from '../db/prisma';
import { entryFeeCents } from '../services/registrationPayment';

// Créer l'intent (paiement ou empreinte) pour une inscription DUE de l'appelant.
router.post('/:id/registrations/:regId/intent', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const regId = asString(req.params.regId);
    const reg = await prisma.tournamentRegistration.findUnique({
      where: { id: regId },
      select: { captainUserId: true, status: true, paymentStatus: true, paymentDeadline: true, tournament: { select: { clubId: true, entryFee: true, club: { select: { stripeAccountId: true } } } } },
    });
    if (!reg) return void res.status(404).json({ error: 'REGISTRATION_NOT_FOUND' });
    if (reg.captainUserId !== req.user!.id) return void res.status(403).json({ error: 'UNAUTHORIZED' });
    if (reg.paymentStatus !== 'DUE') return void res.status(409).json({ error: 'NOT_PAYABLE' });

    const svc = new StripeService();
    const clubId = reg.tournament.clubId;
    if (reg.status === 'CONFIRMED') {
      const amountCents = entryFeeCents(reg.tournament.entryFee);
      if (amountCents < 50) return void res.status(400).json({ error: 'AMOUNT_TOO_SMALL' });
      const r = await svc.createRegistrationPaymentIntent({ clubId, userId: req.user!.id, registrationId: regId, kind: 'tournament', amountCents });
      return void res.json({ ...r, type: 'payment', stripeAccountId: reg.tournament.club.stripeAccountId });
    }
    const r = await svc.createRegistrationSetupIntent({ clubId, userId: req.user!.id, registrationId: regId, kind: 'tournament' });
    return void res.json({ ...r, type: 'setup', stripeAccountId: reg.tournament.club.stripeAccountId });
  } catch (err) { handleError(err, res, next); }
});

// Confirmer le paiement côté client (le webhook le fait aussi ; idempotent).
router.post('/:id/registrations/:regId/confirm-payment', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { stripePaymentIntentId } = req.body;
    if (!stripePaymentIntentId) return void res.status(400).json({ error: 'VALIDATION_ERROR' });
    res.json(await service.confirmRegistrationPayment(asString(req.params.regId), { stripePaymentIntentId: asString(stripePaymentIntentId) }));
  } catch (err) { handleError(err, res, next); }
});
```

- [ ] **Step 4 : Implémenter `events.ts`** en miroir (`eventRegistration`, `event.price`, `kind: 'event'`, garde `userId` au lieu de `captainUserId`). Ajouter les mêmes codes à `ERROR_STATUS`.

- [ ] **Step 5 : `admin.ts`** — ajouter `ONLINE_PAYMENT_NOT_ENABLED: 409` à la table d'erreurs des routes admin (celle qui mappe les erreurs de `updateTournament`/`updateEvent`).

- [ ] **Step 6 : Lancer → PASS, commit.**

Run : `npx jest tournaments.routes events.routes -i`
Expected : PASS.
```bash
git add backend/src/routes
git commit -m "feat(routes): intent + confirm paiement des inscriptions, reponse register enrichie"
```

---

## Task 15 : Front — `lib/api.ts`

**Files:**
- Modify: `frontend/lib/api.ts`
- Test: couvert indirectement par les tests de pages (Tasks 17-18)

- [ ] **Step 1 : Mettre à jour les types et fonctions register.** Localiser `registerTournament` / `registerEvent` (ou équivalents) et changer leur type de retour en `{ registration: <Reg>; payment: { mode: 'payment' | 'setup' } | null }`. Ajouter le type `RegistrationPaymentInfo`:

```ts
export type RegistrationPaymentInfo = { mode: 'payment' | 'setup' } | null;
```

- [ ] **Step 2 : Ajouter les fonctions API inscription** (à côté de `createStripeIntent`) :

```ts
  createRegistrationIntent: (
    kind: 'tournaments' | 'events',
    eventId: string,
    regId: string,
    token: string,
  ) =>
    request<{ clientSecret: string; type: 'payment' | 'setup'; stripeAccountId: string | null }>(
      `/api/${kind}/${eventId}/registrations/${regId}/intent`,
      { method: 'POST' },
      token,
    ),

  confirmRegistrationPayment: (
    kind: 'tournaments' | 'events',
    eventId: string,
    regId: string,
    stripePaymentIntentId: string,
    token: string,
  ) =>
    request(`/api/${kind}/${eventId}/registrations/${regId}/confirm-payment`, {
      method: 'POST',
      body: JSON.stringify({ stripePaymentIntentId }),
    }, token),
```

- [ ] **Step 3 : Vérifier la compilation.** Run (frontend/) : `npx tsc --noEmit`. Expected : PASS (corriger les call-sites de register cassés par le nouveau type → traités Tasks 17).

- [ ] **Step 4 : Commit.**
```bash
git add frontend/lib/api.ts
git commit -m "feat(front): API intent/confirm paiement des inscriptions + type register"
```

---

## Task 16 : Front — `StripePaymentStep` target-agnostic

**Files:**
- Modify: `frontend/components/StripePaymentStep.tsx`
- Test: `frontend/__tests__/StripePaymentStep.test.tsx` (mettre à jour)

- [ ] **Step 1 : Mettre à jour le test** pour la nouvelle interface à callbacks (le chemin réservation reste couvert via un wrapper). Le composant ne référence plus `api.createStripeIntent`/`api.confirmReservation` directement : il reçoit `createIntent` et `confirm`.

- [ ] **Step 2 : Refactor.** Remplacer les props `reservationId`/`slug`/`payShare` par des callbacks injectés. Nouvelle interface :

```ts
interface Props {
  type: 'payment' | 'setup';
  amountLabel: string;
  cgvAccepted?: boolean;
  beforeSubmit?: () => Promise<void>;
  /** Crée l'intent côté serveur et renvoie le client secret + le compte connecté. */
  createIntent: () => Promise<{ clientSecret: string; stripeAccountId: string | null }>;
  /** Confirme côté serveur après succès Stripe (passe l'id du PaymentIntent/SetupIntent). */
  confirm: (ids: { stripePaymentIntentId?: string; stripeSetupIntentId?: string }) => Promise<void>;
  onSuccess: () => void;
  onCancel: () => void;
}
```

`StripeForm.handleSubmit` appelle `confirm({ stripePaymentIntentId, stripeSetupIntentId })` au lieu de `api.confirmReservation`. Le wrapper `StripePaymentStep` appelle `props.createIntent()` dans l'effet (au lieu de `api.createStripeIntent`).

- [ ] **Step 3 : Adapter l'appelant existant `BookingModal.tsx`.** Là où `StripePaymentStep` est monté, passer :

```tsx
<StripePaymentStep
  type={type}
  amountLabel={amountLabel}
  cgvAccepted={cgvAccepted}
  beforeSubmit={beforeSubmit}
  createIntent={async () => {
    const r = await api.createStripeIntent(slug, { reservationId, type, payShare: type === 'payment' ? payShare : undefined }, token);
    return { clientSecret: r.clientSecret, stripeAccountId: r.stripeAccountId };
  }}
  confirm={(ids) => api.confirmReservation(reservationId, token, { ...ids, cgvAccepted })}
  onSuccess={onSuccess}
  onCancel={onCancel}
/>
```

- [ ] **Step 4 : Lancer les tests front concernés → PASS.**

Run (frontend/) : `npx jest StripePaymentStep BookingModal -i`
Expected : PASS.

- [ ] **Step 5 : Commit.**
```bash
git add frontend/components/StripePaymentStep.tsx frontend/components/BookingModal.tsx frontend/__tests__/StripePaymentStep.test.tsx
git commit -m "refactor(front): StripePaymentStep agnostique (callbacks createIntent/confirm)"
```

---

## Task 17 : Front — parcours d'inscription payante (`/tournois/[id]`, `/events/[id]`)

**Files:**
- Modify: `frontend/app/tournois/[id]/page.tsx`, `frontend/app/events/[id]/page.tsx`
- Test: `frontend/__tests__/TournamentDetail*.test.tsx` / `EventDetail*.test.tsx` (compléter)

> ⚠️ Lire le fichier de page **en entier** avant d'éditer (structure du bouton « S'inscrire », gestion du token via `useAuth`, du slug du club). Suivre exactement le pattern existant.

- [ ] **Step 1 : Tests** : sur une épreuve `requirePrepayment` avec place dispo, après `register` (réponse `{ registration, payment:{mode:'payment'} }`), l'étape Stripe (`StripePaymentStep`) s'affiche avec un montant ; sur complet (`mode:'setup'`), l'étape « Enregistrer ma carte » s'affiche.

- [ ] **Step 2 : Lancer → échoue.**

- [ ] **Step 3 : Implémenter.** Après l'appel `register`, brancher sur `res.payment` :

```tsx
const res = await api.registerTournament(id, partnerUserId, token); // renvoie { registration, payment }
if (res.payment) {
  setPayStep({ regId: res.registration.id, mode: res.payment.mode });
} else {
  // flux gratuit actuel (refresh liste/inscription)
}
```

Rendre l'étape de paiement (réutilise `StripePaymentStep` de la Task 16) :

```tsx
{payStep && (
  <StripePaymentStep
    type={payStep.mode}
    amountLabel={formatEuros(tournament.entryFee)}
    createIntent={async () => {
      const r = await api.createRegistrationIntent('tournaments', id, payStep.regId, token);
      return { clientSecret: r.clientSecret, stripeAccountId: r.stripeAccountId };
    }}
    confirm={(ids) => api.confirmRegistrationPayment('tournaments', id, payStep.regId, ids.stripePaymentIntentId ?? '', token)}
    onSuccess={() => { setPayStep(null); reloadRegistration(); }}
    onCancel={() => { setPayStep(null); /* la ligne DUE expirera seule via le job */ }}
  />
)}
```

Pour `mode:'setup'` (liste d'attente), afficher une copie explicite « Votre carte sera débitée seulement si une place se libère » (le `type='setup'` du composant gère déjà le libellé « Enregistrement de votre carte » ; ajouter la phrase au-dessus). `confirm` côté setup ne reçoit pas de PaymentIntent → passer `{ stripeSetupIntentId }` ; pour le setup, la confirmation serveur n'est pas requise (le webhook `setup_intent.succeeded` enregistre la carte) — `confirm` peut être un no-op `async () => {}` côté setup. Sur les fiches, afficher `entryFee`/`price` comme « à régler en ligne » quand `requirePrepayment`.

- [ ] **Step 4 : Faire la même chose dans `/events/[id]`** (`kind: 'events'`, `price`, inscription individuelle).

- [ ] **Step 5 : Lancer → PASS, commit.**
```bash
git add frontend/app/tournois/[id]/page.tsx frontend/app/events/[id]/page.tsx frontend/__tests__
git commit -m "feat(front): parcours inscription payante + card-setup liste d'attente"
```

---

## Task 18 : Front — case « Inscription à régler en ligne » (admin)

**Files:**
- Modify: `frontend/app/admin/tournaments/page.tsx`, `frontend/app/admin/events/page.tsx`
- Test: suites admin correspondantes (compléter)

> ⚠️ Lire la page admin en entier (structure du formulaire create/update, comment `adminGetClub`/le statut Stripe est obtenu). La mémoire projet indique que `useClub().refresh()` n'existe pas : lire l'état Stripe frais via `api.adminGetClub(clubId, token)` (`ClubAdminDetail.stripeAccountStatus`).

- [ ] **Step 1 : Tests** : la case `requirePrepayment` est **désactivée** quand `stripeAccountStatus !== 'ACTIVE'` (avec le libellé/lien vers `/admin/payments`) ; activable sinon ; la valeur est envoyée dans `adminUpdate{Tournament,Event}`.

- [ ] **Step 2 : Lancer → échoue.**

- [ ] **Step 3 : Implémenter.** Charger `stripeAccountStatus` via `adminGetClub`. Dans le formulaire, ajouter la case :

```tsx
<label style={{ display: 'flex', gap: 8, alignItems: 'center', opacity: stripeActive ? 1 : 0.5 }}>
  <input
    type="checkbox"
    checked={form.requirePrepayment}
    disabled={!stripeActive}
    onChange={(e) => setForm({ ...form, requirePrepayment: e.target.checked })}
  />
  Inscription à régler en ligne (CB)
</label>
{!stripeActive && (
  <p className="hint">Activez d'abord le paiement en ligne dans <a href="/admin/payments">Paiement en ligne →</a></p>
)}
```

Inclure `requirePrepayment` dans le payload de `adminCreateTournament`/`adminUpdateTournament` (et events). Ajouter le champ aux types `Tournament`/`ClubEvent` côté `lib/api.ts` si nécessaire (lecture).

- [ ] **Step 4 : Lancer → PASS, commit.**
```bash
git add frontend/app/admin/tournaments/page.tsx frontend/app/admin/events/page.tsx frontend/lib/api.ts frontend/__tests__
git commit -m "feat(admin): case 'inscription a regler en ligne' (gatee sur Stripe ACTIVE)"
```

---

## Task 19 : Vérification finale

- [ ] **Step 1 : Suite backend complète.** Run (backend/) : `npm test`. Expected : PASS.
- [ ] **Step 2 : Suite frontend complète.** Run (frontend/) : `npm test`. Expected : PASS.
- [ ] **Step 3 : Typecheck.** Run : `npx tsc --noEmit` (backend et frontend). Expected : PASS.
- [ ] **Step 4 : Revue manuelle** : relire le diff vs la spec (Task = section). Vérifier qu'une épreuve gratuite suit strictement le flux actuel.
- [ ] **Step 5 : Mettre à jour `CLAUDE.md`** (section « Caisse / À implémenter ») avec un résumé de la fonctionnalité + référence spec/plan.
- [ ] **Step 6 : Commit final.**
```bash
git add CLAUDE.md
git commit -m "docs: paiement en ligne des inscriptions tournois/events"
```

---

## Notes d'exécution

- **DRY** : `registrationPayment.ts` partage la constante de hold, la clause occupe-place et la conversion cents entre les deux services et le job.
- **Concurrence** : toutes les bascules d'état passent par `updateMany` conditionnel (`paymentStatus: 'DUE'`) ou transaction Serializable — pas de double encaissement ni double promotion.
- **Best-effort** : notifications et remboursements sont post-commit et n'échouent jamais le flux métier (try/catch + log), comme `safeNotify`.
- **v1 — notification « carte refusée »** : on réutilise l'e-mail de désinscription existant pour le joueur bumpé (pas de nouveau template). Un e-mail dédié « paiement refusé » est un suivi hors-v1.
- **Mémoire projet** : couper OneDrive pendant le dev ; après désync → `npm install && npx prisma generate`. `useClub().refresh()` n'existe pas → lire l'état club frais via `adminGetClub`.
