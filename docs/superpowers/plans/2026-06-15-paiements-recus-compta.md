# Phase 3 — Reçus & comptabilité — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Donner au club un **récap comptable mensuel net des remboursements + export CSV**, et au joueur/gérant un **reçu imprimable** (HTML → impression/PDF navigateur) avec un **numéro de reçu séquentiel par club**.

**Décisions actées :** reçu = **HTML imprimable côté front** (zéro dépendance backend, le navigateur fait le PDF) ; numéro de reçu = **compteur séquentiel par club** (table `ClubCounter`, allocation atomique dans la transaction d'encaissement).

**Conventions :** worktree isolé `C:/Users/e.nougayrede/palova-wt-payments`, branche **`feat/payments-recus-compta`** (à créer depuis `feat/payments-refund-on-cancel`) — ne jamais changer de branche / toucher OneDrive. Migrations **additives, écrites à la main** (`migrate dev` impossible : DB dev partagée divergente — faire `npx prisma generate` après). Montants en centimes. Tests Prisma mockés.

---

## Task 1: Schéma — `ClubCounter` + `Payment.receiptNo`

**Files:** `backend/prisma/schema.prisma`, nouvelle migration `…_add_receipt_numbering`.

- [ ] **Step 1 — `Payment`** : ajouter le champ (après `createdByUserId`) :
```prisma
  receiptNo       Int?           @map("receipt_no") // numéro de reçu séquentiel par club
```
et un index unique par club (à côté des `@@index` de Payment) :
```prisma
  @@unique([clubId, receiptNo])
```

- [ ] **Step 2 — nouveau modèle `ClubCounter`** (compteurs séquentiels par club, ex. reçus) après `model Payment` :
```prisma
/// Compteurs séquentiels par club (ex. numéro de reçu). Incrément atomique (upsert) dans
/// la transaction d'encaissement → numérotation sans trou (les rollbacks n'incrémentent pas).
model ClubCounter {
  id        String   @id @default(cuid())
  clubId    String   @map("club_id")
  kind      String   // ex. "RECEIPT"
  value     Int      @default(0)
  updatedAt DateTime @updatedAt @map("updated_at")

  club Club @relation(fields: [clubId], references: [id], onDelete: Cascade)

  @@unique([clubId, kind])
  @@map("club_counters")
}
```

- [ ] **Step 3 — back-relation `Club`** : dans `model Club`, à côté des autres relations (ex. `memberPackages`), ajouter :
```prisma
  counters    ClubCounter[]
```

- [ ] **Step 4 — migration manuelle** `backend/prisma/migrations/20260615140000_add_receipt_numbering/migration.sql` :
```sql
-- AlterTable : numéro de reçu (séquentiel par club, nullable pour l'historique)
ALTER TABLE "payments" ADD COLUMN "receipt_no" INTEGER;

-- CreateTable : compteurs séquentiels par club
CREATE TABLE "club_counters" (
    "id" TEXT NOT NULL,
    "club_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "club_counters_pkey" PRIMARY KEY ("id")
);

-- Index
CREATE UNIQUE INDEX "payments_club_id_receipt_no_key" ON "payments"("club_id", "receipt_no");
CREATE UNIQUE INDEX "club_counters_club_id_kind_key" ON "club_counters"("club_id", "kind");

-- FK
ALTER TABLE "club_counters" ADD CONSTRAINT "club_counters_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 5** : `cd backend && npx prisma generate` (PAS `migrate dev`). Puis `npm test --prefix .` → suite verte (additif). Commit `feat(db): ClubCounter + Payment.receiptNo (numérotation des reçus)`.

---

## Task 2: Allocation du numéro de reçu (TDD)

**Files:** `backend/src/services/reservation.service.ts` (`addPayment`, `confirmReservation`), `backend/src/services/package.service.ts` (`sellPackage`), tests associés.

But : à chaque création de `Payment` en caisse / vente / confirmation prépayée, allouer le prochain `receiptNo` du club **dans la même transaction**.

- [ ] **Step 1 — helper partagé.** Dans `package.service.ts`, ajouter une fonction statique réutilisable (ou un util exporté) :
```typescript
  /** Alloue le prochain numéro de reçu du club (séquentiel, dans la transaction appelante). */
  static async nextReceiptNo(tx: Prisma.TransactionClient, clubId: string): Promise<number> {
    const c = await tx.clubCounter.upsert({
      where: { clubId_kind: { clubId, kind: 'RECEIPT' } },
      create: { clubId, kind: 'RECEIPT', value: 1 },
      update: { value: { increment: 1 } },
    });
    return c.value;
  }
```
> Concurrence : l'`update { increment }` est atomique (verrou de ligne) → numéros distincts. Seule la toute première création concurrente d'un club (branche `create`) peut entrer en collision unique (rarissime) ; l'appelant échoue et l'utilisateur réessaie. Acceptable.

- [ ] **Step 2 — câbler dans `addPayment`** (`reservation.service.ts`) : dans les DEUX branches transactionnelles (non-prépayé et prépayé), allouer puis poser `receiptNo` :
  - branche non-prépayé :
```typescript
      return prisma.$transaction(async (tx) => {
        await assertNotOverpaid(tx);
        const receiptNo = await PackageService.nextReceiptNo(tx, params.clubId);
        return tx.payment.create({ data: { ...base, receiptNo } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
```
  - branche prépayé :
```typescript
    return prisma.$transaction(async (tx) => {
      await assertNotOverpaid(tx);
      await PackageService.consume(tx, pkg, new Prisma.Decimal(params.amount));
      const receiptNo = await PackageService.nextReceiptNo(tx, params.clubId);
      return tx.payment.create({ data: { ...base, sourcePackageId: pkg.id, receiptNo } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
```

- [ ] **Step 3 — câbler dans `sellPackage`** (`package.service.ts`) : dans la transaction, avant `tx.payment.create`, `const receiptNo = await PackageService.nextReceiptNo(tx, clubId);` et ajouter `receiptNo` au `data`.

- [ ] **Step 4 — câbler dans `confirmReservation`** (`reservation.service.ts`, branche `if (paymentSource)`) : avant le `tx.payment.create`, `const receiptNo = await PackageService.nextReceiptNo(tx, reservation.resource.clubId);` et l'ajouter au `data`.

- [ ] **Step 5 — exposer `receiptNo`** dans les selects de paiements lus par la caisse/planning : `dailySummary` (`package.service.ts` `paymentInclude`/findMany select), `listClubReservations` et `loadClubReservation` (`reservation.service.ts`, le `payments: { select: {...} }`) — ajouter `receiptNo: true`.

- [ ] **Step 6 — tests.** Dans `package.service.test.ts` : `nextReceiptNo` appelle `clubCounter.upsert` avec `{ clubId_kind: { clubId, kind:'RECEIPT' } }` et renvoie `c.value` ; `sellPackage` pose `receiptNo`. Dans `reservation.service.test.ts` (describe addPayment) : mock `prismaMock.clubCounter.upsert.mockResolvedValue({ value: 7 })` dans le `beforeEach` du describe (sinon les tests existants cassent — `upsert` non mocké renvoie undefined → `c.value` throw) et un test « addPayment pose receiptNo ». 
  ⚠️ **Important** : ajouter le mock par défaut `clubCounter.upsert` aux `beforeEach` des describes addPayment (étendu + participant) pour ne pas casser l'existant.

- [ ] **Step 7** : `npm test --prefix .` vert + `npx tsc --noEmit`. Commit `feat(caisse): numéro de reçu séquentiel à chaque encaissement`.

---

## Task 3: Service comptable + endpoints (TDD)

**Files:** `backend/src/services/accounting.service.ts` (créer), `backend/src/routes/admin.ts`, test `backend/src/services/__tests__/accounting.service.test.ts`.

- [ ] **Step 1 — service** `backend/src/services/accounting.service.ts` :
```typescript
import { Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import { prisma } from '../db/prisma';

const MONEY_METHODS = ['CASH', 'CARD', 'TRANSFER', 'ONLINE', 'OTHER', 'VOUCHER'];

export class AccountingService {
  /** Récap mensuel net des remboursements, fuseau du club. */
  async monthlySummary(clubId: string, year: number, month: number) {
    const club = await prisma.club.findUnique({ where: { id: clubId }, select: { timezone: true } });
    if (!club) throw new Error('CLUB_NOT_FOUND');
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) throw new Error('VALIDATION_ERROR');
    const start = DateTime.fromObject({ year, month, day: 1 }, { zone: club.timezone }).startOf('month');
    if (!start.isValid) throw new Error('VALIDATION_ERROR');
    const end = start.plus({ months: 1 });

    const [payments, refunds] = await Promise.all([
      prisma.payment.findMany({ where: { clubId, createdAt: { gte: start.toJSDate(), lt: end.toJSDate() } }, select: { amount: true, method: true, createdAt: true } }),
      prisma.refund.findMany({ where: { clubId, createdAt: { gte: start.toJSDate(), lt: end.toJSDate() } }, select: { amount: true, method: true, createdAt: true } }),
    ]);

    const totals: Record<string, Prisma.Decimal> = {};
    let collected = new Prisma.Decimal(0);
    let refunded = new Prisma.Decimal(0);
    const byDay: Record<string, Prisma.Decimal> = {};
    const dayKey = (d: Date) => DateTime.fromJSDate(d).setZone(club.timezone).toISODate()!;
    for (const p of payments) {
      totals[p.method] = (totals[p.method] ?? new Prisma.Decimal(0)).plus(p.amount);
      collected = collected.plus(p.amount);
      byDay[dayKey(p.createdAt)] = (byDay[dayKey(p.createdAt)] ?? new Prisma.Decimal(0)).plus(p.amount);
    }
    for (const r of refunds) {
      totals[r.method] = (totals[r.method] ?? new Prisma.Decimal(0)).minus(r.amount);
      collected = collected.minus(r.amount);
      refunded = refunded.plus(r.amount);
      byDay[dayKey(r.createdAt)] = (byDay[dayKey(r.createdAt)] ?? new Prisma.Decimal(0)).minus(r.amount);
    }
    const totalsByMethod: Record<string, string> = {};
    for (const [m, v] of Object.entries(totals)) totalsByMethod[m] = v.toFixed(2);
    const byDayArr = Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, net: v.toFixed(2) }));
    return { year, month, totalsByMethod, collected: collected.toFixed(2), refunded: refunded.toFixed(2), byDay: byDayArr };
  }

  /** Export CSV des encaissements (et remboursements en lignes négatives) sur une période [from, to] incluse, fuseau club. */
  async exportCsv(clubId: string, from: string, to: string): Promise<string> {
    const club = await prisma.club.findUnique({ where: { id: clubId }, select: { timezone: true } });
    if (!club) throw new Error('CLUB_NOT_FOUND');
    const start = DateTime.fromISO(from, { zone: club.timezone }).startOf('day');
    const end = DateTime.fromISO(to, { zone: club.timezone }).endOf('day');
    if (!start.isValid || !end.isValid) throw new Error('VALIDATION_ERROR');

    const payments = await prisma.payment.findMany({
      where: { clubId, createdAt: { gte: start.toJSDate(), lt: end.plus({ milliseconds: 1 }).toJSDate() } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true, receiptNo: true, method: true, amount: true, payerName: true, refundedAmount: true },
    });
    const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const fmtDate = (d: Date) => DateTime.fromJSDate(d).setZone(club.timezone).toFormat('yyyy-MM-dd HH:mm');
    const header = ['Date', 'Recu', 'Methode', 'Montant', 'Rembourse', 'Payeur'];
    const lines = payments.map((p) => [
      fmtDate(p.createdAt), p.receiptNo ?? '', p.method, Number(p.amount).toFixed(2), Number(p.refundedAmount).toFixed(2), p.payerName ?? '',
    ].map(esc).join(','));
    return [header.join(','), ...lines].join('\n');
  }
}
```

- [ ] **Step 2 — endpoints** dans `admin.ts` : importer + instancier `AccountingService` ; ajouter :
```typescript
router.get('/accounting/summary', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const year = Number(asString(req.query.year)); const month = Number(asString(req.query.month));
    res.json(await accountingService.monthlySummary(req.membership!.clubId, year, month));
  } catch (e) { handleError(e, res, next); }
});
router.get('/accounting/export', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const from = asString(req.query.from); const to = asString(req.query.to);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return void res.status(400).json({ error: 'from/to YYYY-MM-DD requis' });
    const csv = await accountingService.exportCsv(req.membership!.clubId, from, to);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="caisse_${from}_${to}.csv"`);
    res.send(csv);
  } catch (e) { handleError(e, res, next); }
});
```

- [ ] **Step 3 — tests** `accounting.service.test.ts` : monthlySummary net (payments CASH 20 + CARD 30, refund CASH 5 → CASH '15.00', collected '45.00', refunded '5.00', byDay trié) ; date invalide → VALIDATION_ERROR ; exportCsv déterministe (header + lignes échappées). Mock `prismaMock.club.findUnique` (timezone), `payment.findMany`, `refund.findMany`.

- [ ] **Step 4** : `npm test --prefix .` + `npx tsc --noEmit` verts. Commit `feat(compta): AccountingService (récap mensuel net + export CSV) + endpoints`.

---

## Task 4: Frontend — page Comptabilité + reçu imprimable

**Files:** `frontend/lib/accounting.ts` (créer), `frontend/lib/api.ts`, `frontend/app/admin/comptabilite/page.tsx` (créer), un composant reçu imprimable (ex. `frontend/components/admin/Receipt.tsx`), lien dans la sidebar admin. **Lire les fichiers voisins avant d'éditer** (suivre le style de `/admin/caisse/page.tsx`).

- [ ] **Step 1 — types + API** (`lib/api.ts`) : type `MonthlySummary` (`{ year, month, totalsByMethod: Record<string,string>, collected, refunded, byDay: {date,net}[] }`) ; `api.adminAccountingSummary(clubId, year, month, token)` (GET) ; `api.adminAccountingExportUrl(clubId, from, to)` renvoyant l'URL (téléchargement direct) OU un fetch blob. Ajouter `receiptNo?: number | null` au type `Payment`. Suivre le pattern `request<T>` existant.

- [ ] **Step 2 — helpers purs** `frontend/lib/accounting.ts` : `monthLabel(year, month)` (fr), regroupement/format pour l'affichage par moyen et par jour (réutiliser `fmtEuros`/`toCents` de `lib/caisse.ts`). Tests `frontend/__tests__/accounting.test.ts`.

- [ ] **Step 3 — page** `frontend/app/admin/comptabilite/page.tsx` (shell identique à `/admin/caisse`) : sélecteur mois/année → appelle `adminAccountingSummary` → cartes « Encaissé net », « Remboursé », totaux **par moyen**, mini barres par jour (`byDay`), et un bouton **« Exporter CSV »** (période = le mois, déclenche le téléchargement). Réutiliser le bloc « Tickets CE à rembourser » existant de la caisse si pertinent (ou lien). Lien « Comptabilité » dans la sidebar `/admin`.

- [ ] **Step 4 — reçu imprimable** : composant `Receipt.tsx` qui rend un reçu (en-tête club : nom + adresse depuis le club admin ; n° de reçu `receiptNo` ; date ; moyen ; montant ; objet = terrain+créneau ou nom du package ; mention « Reçu » non-facture). Bouton « Reçu » sur chaque ligne de paiement de `/admin/caisse` qui ouvre le reçu dans une vue imprimable (`window.print()` avec une feuille de style print, OU une route `/admin/recu/[paymentId]` minimale). Garder simple : pas de dépendance ; le navigateur gère l'impression/PDF.

- [ ] **Step 5** : `npx tsc --noEmit` (front) + `npm test --prefix .` (front) verts. Commit `feat(compta): page Comptabilité (récap mensuel + export CSV) + reçu imprimable`.

---

## Vérification de bout en bout
- Tests back + front verts, `tsc` clean.
- Manuel : encaisser plusieurs paiements (vérifier que `receiptNo` s'incrémente par club) ; ouvrir `/admin/comptabilite`, choisir le mois → totaux **nets** des remboursements ; exporter le CSV ; imprimer un reçu depuis la caisse (aperçu navigateur).

## Séquencement
Task 1 (schéma) → Task 2 (allocation receiptNo) → Task 3 (service+endpoints) → Task 4 (front). Tasks 3 et 4 indépendantes de 2 (mais 4 affiche `receiptNo` produit par 2). Réutilise le netting des refunds (Phase 1.1) et `RefundService` (Phase 1).
