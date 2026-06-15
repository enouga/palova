# Phase 2 — Remboursement automatique à l'annulation — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Quand un club l'active, l'annulation d'une réservation **dans la fenêtre d'annulation** rembourse automatiquement tous les paiements encaissés (recrédit carnet/€ pour le prépayé), avec email au joueur — réutilise `RefundService.refund` (Phase 1).

**Architecture:** Flag opt-in `Club.refundOnCancelWithinCutoff` (défaut `false` → comportement actuel inchangé). Dans `cancelReservation` (joueur) et `adminCancelReservation` (gérant), après `performCancel`, si le flag est on **et** qu'on est dans la fenêtre (`now ≤ startTime − cancellationCutoffHours`), on rembourse chaque `Payment` encaissé restant via `RefundService.refund`. Email best-effort post-commit. Réponse enrichie de `{ refunded: [...] }`.

**Conventions :** worktree isolé `C:/Users/e.nougayrede/palova-wt-payments`, branche `feat/payments-refund-on-cancel` — **ne jamais changer de branche, ne jamais toucher OneDrive**. Migrations additives. Calculs en centimes. Erreurs `throw new Error('CODE')`. Tests Prisma mockés (`prismaMock`).

---

## Task 1: Schéma — flag `refundOnCancelWithinCutoff`

**Files:** `backend/prisma/schema.prisma`, nouvelle migration.

- [ ] **Step 1:** dans `model Club`, après `cancellationCutoffHours Int @default(0) @map("cancellation_cutoff_hours")` (ligne ~155), ajouter :
```prisma
  // Rembourse automatiquement les paiements d'une réservation annulée dans la fenêtre d'annulation. Opt-in.
  refundOnCancelWithinCutoff Boolean @default(false) @map("refund_on_cancel_within_cutoff")
```
- [ ] **Step 2:** générer + appliquer la migration : depuis `backend/`, `npx prisma migrate dev --name add_club_refund_policy` (Docker up). SQL attendu : `ALTER TABLE "clubs" ADD COLUMN "refund_on_cancel_within_cutoff" BOOLEAN NOT NULL DEFAULT false;` (additif). Régénère le client.
- [ ] **Step 3:** `npm test --prefix .` → suite verte (additif). 
- [ ] **Step 4:** commit `feat(db): Club.refundOnCancelWithinCutoff (politique de remboursement annulation)` (+ trailer Co-Authored-By).

---

## Task 2: Backend — auto-refund à l'annulation (TDD)

**Files:** `backend/src/services/reservation.service.ts`, test `backend/src/services/__tests__/reservation.service.test.ts`.

### Step 0 — READ
Lire `reservation.service.ts` : `cancelReservation` (~369-381), `adminCancelReservation` (~384-395), `performCancel` (~348-367), et le haut du fichier (imports). Lire dans le test la façon dont les tests d'annulation existants mockent **redis** et **SSEService** (chercher `cancelReservation`/`performCancel`/`slot_released`) pour réutiliser exactement le même setup.

- [ ] **Step 1 — instancier RefundService.** En tête de `reservation.service.ts`, ajouter l'import :
```typescript
import { RefundService } from './refund.service';
```
et `import { notifyReservationRefunded } from '../email/notifications';` à la ligne d'import des notifications existantes (ajouter le nom à l'import existant depuis `'../email/notifications'`). Dans la classe `ReservationService`, ajouter un champ privé :
```typescript
  private refundService = new RefundService();
```

- [ ] **Step 2 — helper d'auto-refund.** Ajouter cette méthode privée (après `performCancel`) :
```typescript
  /**
   * Si le club l'active ET qu'on annule dans la fenêtre d'annulation, rembourse tous les
   * paiements encaissés restants de la résa (recrédit prépayé géré par RefundService).
   * Renvoie le détail des remboursements effectués (vide si politique off / hors fenêtre).
   */
  private async autoRefundOnCancel(
    reservationId: string,
    clubId: string,
    startTime: Date,
    club: { cancellationCutoffHours: number; refundOnCancelWithinCutoff: boolean },
  ): Promise<Array<{ paymentId: string; amount: string; method: string }>> {
    if (!club.refundOnCancelWithinCutoff) return [];
    const deadline = startTime.getTime() - Math.max(0, club.cancellationCutoffHours) * 3_600_000;
    if (Date.now() > deadline) return []; // hors fenêtre (annulation tardive, ex. admin) → pas de remboursement auto

    const cents = (v: unknown) => { const n = Math.round(Number(v) * 100); return Number.isFinite(n) ? n : 0; };
    const payments = await prisma.payment.findMany({
      where: { reservationId, status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED'] }, method: { not: 'MEMBER' } },
      select: { id: true, amount: true, refundedAmount: true, method: true },
    });
    const refunded: Array<{ paymentId: string; amount: string; method: string }> = [];
    for (const p of payments) {
      const refundableCents = cents(p.amount) - cents(p.refundedAmount);
      if (refundableCents <= 0) continue;
      await this.refundService.refund({
        paymentId: p.id,
        clubId,
        amount: refundableCents / 100,
        reason: 'Annulation de la réservation',
        method: p.method,
      });
      refunded.push({ paymentId: p.id, amount: (refundableCents / 100).toFixed(2), method: p.method });
    }
    return refunded;
  }
```

- [ ] **Step 3 — câbler dans `cancelReservation`.** Charger le flag + le cutoff (étendre l'`include`), puis après `performCancel` rembourser et notifier :
```typescript
  async cancelReservation(reservationId: string, userId: string) {
    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { resource: { select: { clubId: true, club: { select: { cancellationCutoffHours: true, refundOnCancelWithinCutoff: true } } } } },
    });
    if (!reservation)                       throw new Error('RESERVATION_NOT_FOUND');
    if (reservation.userId !== userId)      throw new Error('UNAUTHORIZED');
    if (reservation.status === 'CANCELLED') throw new Error('ALREADY_CANCELLED');
    this.assertWithinCutoff(reservation.startTime, reservation.resource.club.cancellationCutoffHours, 'CANCELLATION_TOO_LATE');

    const cancelled = await this.performCancel(reservation);
    const refunded = await this.autoRefundOnCancel(
      reservationId, reservation.resource.clubId, reservation.startTime, reservation.resource.club,
    );
    if (refunded.length) await this.safeNotify(() => notifyReservationRefunded(reservationId, refunded));
    return { ...cancelled, refunded };
  }
```

- [ ] **Step 4 — câbler dans `adminCancelReservation`.** Étendre l'`include` pour charger le club (cutoff + flag) et faire de même :
```typescript
  async adminCancelReservation(reservationId: string, adminClubId: string) {
    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { resource: { select: { clubId: true, club: { select: { cancellationCutoffHours: true, refundOnCancelWithinCutoff: true } } } } },
    });
    if (!reservation)                                throw new Error('RESERVATION_NOT_FOUND');
    if (reservation.resource.clubId !== adminClubId) throw new Error('CLUB_MISMATCH');
    if (reservation.status === 'CANCELLED')          throw new Error('ALREADY_CANCELLED');

    const cancelled = await this.performCancel(reservation);
    const refunded = await this.autoRefundOnCancel(
      reservationId, reservation.resource.clubId, reservation.startTime, reservation.resource.club,
    );
    if (refunded.length) await this.safeNotify(() => notifyReservationRefunded(reservationId, refunded));
    return { ...cancelled, refunded };
  }
```
> Note : `adminCancelReservation` ne fait pas d'`assertWithinCutoff` (le gérant peut annuler à tout moment) — `autoRefundOnCancel` ne rembourse alors QUE si on est encore dans la fenêtre. Annulation tardive admin → pas de remboursement auto (le gérant a le bouton « Rembourser/corriger » manuel de la Phase 1).

- [ ] **Step 5 — tests.** Dans `reservation.service.test.ts`, ajouter un `describe('remboursement à l'annulation (Phase 2)')` qui réutilise le setup redis/SSE des tests d'annulation existants, et `jest.spyOn(RefundService.prototype, 'refund')`. Cas :
  - **politique off** : `refundOnCancelWithinCutoff:false` → `refund` PAS appelé, réponse `refunded:[]`.
  - **politique on + dans la fenêtre + paiement CASH** : `payment.findMany` renvoie `[{ id:'pay-1', amount: Decimal(20), refundedAmount: Decimal(0), method:'CASH' }]` → `refund` appelé avec `{ paymentId:'pay-1', amount:20, method:'CASH' }`, réponse `refunded` longueur 1.
  - **politique on + prépayé** : payment `method:'PACK_CREDIT'` → `refund` appelé (le recrédit est testé côté RefundService).
  - **politique on mais hors fenêtre** (startTime déjà passé / cutoff dépassé via adminCancel) → `refund` PAS appelé.
  - **email best-effort** : `jest.spyOn` sur le notifier qui rejette → `cancelReservation` ne throw pas.

  Exemple (adapter au setup redis/SSE réel du fichier) :
```typescript
  it('politique on : rembourse les paiements à l’annulation dans la fenêtre', async () => {
    const refundSpy = jest.spyOn(RefundService.prototype, 'refund').mockResolvedValue({ id: 'ref-1' } as any);
    const future = new Date(Date.now() + 48 * 3_600_000);
    prismaMock.reservation.findUnique.mockResolvedValue({
      id: 'r1', userId: 'u1', status: 'CONFIRMED', startTime: future, endTime: future, resourceId: 'res-1',
      resource: { clubId: 'club-1', club: { cancellationCutoffHours: 24, refundOnCancelWithinCutoff: true } },
    } as any);
    prismaMock.reservation.update.mockResolvedValue({ id: 'r1', status: 'CANCELLED', resourceId: 'res-1', startTime: future, endTime: future } as any);
    prismaMock.payment.findMany.mockResolvedValue([
      { id: 'pay-1', amount: new Prisma.Decimal(20), refundedAmount: new Prisma.Decimal(0), method: 'CASH' },
    ] as any);

    const out = await service.cancelReservation('r1', 'u1');
    expect(refundSpy).toHaveBeenCalledWith(expect.objectContaining({ paymentId: 'pay-1', amount: 20, method: 'CASH' }));
    expect(out.refunded).toHaveLength(1);
    refundSpy.mockRestore();
  });
```

- [ ] **Step 6:** `npm test --prefix . -- reservation.service` puis `npm test --prefix .` → vert. `npx tsc --noEmit`.
- [ ] **Step 7:** commit `feat(reservation): remboursement auto à l'annulation dans la fenêtre (opt-in club)`.

---

## Task 3: Email de remboursement (TDD)

**Files:** `backend/src/email/templates/emails.ts`, `backend/src/email/notifications.ts`, test `backend/src/email/__tests__/emails.test.ts`.

- [ ] **Step 1 — builder pur** dans `emails.ts` (suivre le style des autres `buildXxxEmail`) :
```typescript
export interface RefundEmailInput {
  recipientFirstName: string;
  resourceName: string;
  dateLabel: string;
  clubName: string;
  amountLabel: string;     // ex. "20,00 €"
  prepaid: boolean;        // true si (au moins) un remboursement a recrédité un carnet/porte-monnaie
  url: string;
  brand: Brand;
}

/** Email au joueur quand sa réservation annulée est remboursée automatiquement. */
export function buildRefundEmail(i: RefundEmailInput): BuiltEmail {
  const subject = `Remboursement de votre réservation — ${i.clubName}`;
  const heading = 'Réservation remboursée 💶';
  const intro = i.prepaid
    ? `Votre réservation annulée a été remboursée : <strong>${escapeHtml(i.amountLabel)}</strong> recrédité sur votre solde (carnet / porte-monnaie).`
    : `Votre réservation annulée a été remboursée : <strong>${escapeHtml(i.amountLabel)}</strong>.`;
  const infoRows: InfoRow[] = [
    { label: 'Terrain', value: i.resourceName },
    { label: 'Date', value: i.dateLabel },
    { label: 'Club', value: i.clubName },
    { label: 'Remboursé', value: i.amountLabel },
  ];
  const introHtml = `<p style="margin:0 0 12px;">Bonjour ${escapeHtml(i.recipientFirstName)},</p><p style="margin:0;">${intro}</p>`;
  const html = renderLayout({ brand: i.brand, preheader: subject, heading, introHtml, infoRows, ctaLabel: 'Voir mes réservations', ctaUrl: i.url });
  const text = [
    `Bonjour ${i.recipientFirstName},`, '',
    stripTags(intro), '',
    `Terrain : ${i.resourceName}`, `Date : ${i.dateLabel}`, `Club : ${i.clubName}`, `Remboursé : ${i.amountLabel}`, '',
    `Voir mes réservations : ${i.url}`,
  ].join('\n');
  return { subject, html, text };
}
```

- [ ] **Step 2 — orchestration** dans `notifications.ts` (réutilise `brandOf`, `formatDateRangeFr`, `clubAppUrl`, `fmtEuros`-équivalent — il n'y en a pas côté back, formate en JS) :
```typescript
/** Prévient le joueur (propriétaire de la résa) du remboursement automatique à l'annulation. */
export async function notifyReservationRefunded(
  reservationId: string,
  refunds: Array<{ amount: string; method: string }>,
): Promise<void> {
  if (refunds.length === 0) return;
  const resa = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: {
      user: { select: { firstName: true, email: true } },
      resource: { select: { name: true, club: { select: { name: true, slug: true, logoUrl: true, accentColor: true, timezone: true } } } },
    },
  });
  if (!resa?.user?.email) return;
  const totalCents = refunds.reduce((s, r) => s + Math.round(Number(r.amount) * 100), 0);
  const amountLabel = (totalCents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 }) + ' €';
  const prepaid = refunds.some((r) => r.method === 'PACK_CREDIT' || r.method === 'WALLET');
  const club = resa.resource.club;
  const mail = buildRefundEmail({
    recipientFirstName: resa.user.firstName,
    resourceName: resa.resource.name,
    dateLabel: formatDateRangeFr(resa.startTime, resa.endTime, club.timezone),
    clubName: club.name, amountLabel, prepaid,
    url: clubAppUrl(club.slug, '/me/reservations'), brand: brandOf(club),
  });
  await sendMail({ to: resa.user.email, subject: mail.subject, html: mail.html, text: mail.text });
}
```
Ajouter `buildRefundEmail` à l'import depuis `'./templates/emails'`.

- [ ] **Step 3 — test** dans `emails.test.ts` : `buildRefundEmail` produit le bon `subject`, un `amountLabel` dans le HTML, et le wording « recrédité » quand `prepaid:true`. (Suivre les cas existants du fichier.)
- [ ] **Step 4:** `npm test --prefix . -- emails` + suite complète. Commit `feat(email): notification de remboursement à l'annulation`.

---

## Task 4: Plomberie config + UI

**Files:** `backend/src/services/club.service.ts` (read first), `frontend/app/admin/settings/page.tsx`, `frontend/lib/api.ts`, et l'affichage `frontend/app/me/reservations/*` (+ `frontend/components/calendar/DayPanel.tsx`). **Lire avant d'éditer.**

- [ ] **Step 1 — backend config.** Dans `club.service.ts` : `getClubForAdmin` doit exposer `refundOnCancelWithinCutoff` (l'ajouter au `select` si select explicite), et `updateClub` doit accepter/persister `refundOnCancelWithinCutoff` (booléen) — suivre exactement la façon dont `cancellationCutoffHours`/`playerChangeCutoffHours` sont gérés (validation + whitelist). Si ces champs passent par un mapping, ajouter le nouveau au même endroit.
- [ ] **Step 2 — types front.** `frontend/lib/api.ts` : ajouter `refundOnCancelWithinCutoff?: boolean` au type du club admin (là où `cancellationCutoffHours` est déclaré) ; le PATCH des réglages doit pouvoir l'envoyer.
- [ ] **Step 3 — UI réglages.** `frontend/app/admin/settings/page.tsx` : ajouter une case à cocher « Rembourser automatiquement en cas d'annulation dans les délais » près des champs de délais d'annulation, câblée comme les autres réglages (state + PATCH `/admin`). Suivre le style existant.
- [ ] **Step 4 — affichage joueur (léger).** Dans `me/reservations` / `DayPanel`, après une annulation dont la réponse contient `refunded` non vide, afficher un message « Remboursé : X € » (ou « recrédité sur votre solde »). Optionnel/léger — ne pas restructurer la page ; si risqué, le noter et s'arrêter au backend+réglages.
- [ ] **Step 5:** `npx tsc --noEmit` (front+back) + `npm test --prefix .` (front et back) verts. Commit `feat(caisse): réglage + affichage du remboursement auto à l'annulation`.

---

## Vérification de bout en bout
- Tests back + front verts, `tsc` clean des deux côtés.
- Manuel : activer la case dans `/admin/settings` ; créer une résa, l'encaisser (ex. carnet), puis l'annuler depuis « Mes réservations » dans la fenêtre → le solde du carnet **réaugmente**, la caisse est nette, et un email de remboursement part (console en dev). Annuler hors fenêtre (admin, créneau proche) → **pas** de remboursement auto.
- Politique off (défaut) → comportement strictement identique à avant (aucun remboursement auto).

## Séquencement
Task 1 (schéma) → Task 2 (cœur backend, dépend du flag) → Task 3 (email, branché par Task 2) → Task 4 (config+UI). Réutilise `RefundService.refund` de la Phase 1 (déjà sur la branche parente).
