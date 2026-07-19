# Remboursement auto quand le club annule — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Câbler le `RefundService` existant sur les 4 chemins d'annulation à l'initiative du club (tournoi/event complet annulé + retrait d'un binôme/inscrit par admin/J-A), pour rembourser automatiquement les inscriptions payées en ligne.

**Architecture:** Réutilisation du pattern `safeRefund` déjà présent dans `TournamentService` et `EventService`. Les deux services restent parallèles (modèles séparés), pas de helper transverse. Remboursement best-effort post-commit, jamais bloquant. Une inscription est remboursable si `paymentStatus === 'PAID'` + `Payment` `method:'ONLINE'` lié — les listes d'attente (carte via SetupIntent, jamais débitée) sont exclues d'office.

**Tech Stack:** TypeScript, Prisma, Jest (`prismaMock` + `jest.spyOn(RefundService.prototype, 'refund')`), Stripe (via RefundService).

**Spec :** `docs/superpowers/specs/2026-07-19-remboursement-annulation-club-design.md`

---

## Contexte de référence (à lire avant de commencer)

- `backend/src/services/tournament.service.ts` :
  - `safeRefund(info, clubId)` ~ligne 271 : appelle `RefundService.refund` puis passe la reg en `REFUNDED`. Le motif est codé en dur `'Désinscription avant clôture'`.
  - `cancelRegistration` ~ligne 218 : **modèle de référence** pour construire `refundInfo` dans la transaction (filtre `paymentStatus === 'PAID'` + `payment.findFirst method:'ONLINE'`).
  - `adminRemoveRegistration` ~ligne 597 : à étendre (capturer `refundInfo`, rembourser post-commit).
  - `updateTournament` ~ligne 540 : transition vers `CANCELLED` détectée ~ligne 559 (appelle déjà `notifyActivityCancelledByClub`).
- `backend/src/services/event.service.ts` : structure **symétrique** (`safeRefund` ~ligne 210, `cancelRegistration` ~158, `adminRemoveRegistration` ~465, `updateEvent` ~402, transition CANCELLED ~427).
- Tests : `backend/src/services/__tests__/{tournament,event}.service.test.ts`. Mocks en place : `jest.mock('../../email/notifications')`, `prismaMock`, `RefundService.prototype.refund` via `jest.spyOn`.
- Lancer un seul fichier de test : `npx jest --runTestsByPath src/services/__tests__/tournament.service.test.ts`

---

## Task 1 : Paramétrer le motif de `safeRefund` (tournoi + event)

Changement habilitant, sans effet de comportement : ajoute un argument `reason` optionnel qui garde la valeur actuelle par défaut. Les appels existants restent identiques.

**Files:**
- Modify: `backend/src/services/tournament.service.ts` (méthode `safeRefund`)
- Modify: `backend/src/services/event.service.ts` (méthode `safeRefund`)

- [ ] **Step 1 : Modifier `safeRefund` dans `tournament.service.ts`**

Remplacer la méthode existante par :

```ts
  /** Remboursement best-effort ; ne fait jamais échouer l'annulation. Motif traçable. */
  private async safeRefund(info: { paymentId: string; amount: number; regId: string }, clubId: string, reason = 'Désinscription avant clôture'): Promise<void> {
    try {
      await new RefundService().refund({ paymentId: info.paymentId, clubId, amount: info.amount, reason });
      await prisma.tournamentRegistration.update({ where: { id: info.regId }, data: { paymentStatus: 'REFUNDED' } });
    } catch (err) {
      console.error('[refund] remboursement tournoi échoué', err);
    }
  }
```

- [ ] **Step 2 : Modifier `safeRefund` dans `event.service.ts`**

Remplacer la méthode existante par :

```ts
  /** Remboursement best-effort ; ne fait jamais échouer l'annulation. Motif traçable. */
  private async safeRefund(info: { paymentId: string; amount: number; regId: string }, clubId: string, reason = 'Désinscription avant clôture'): Promise<void> {
    try {
      await new RefundService().refund({ paymentId: info.paymentId, clubId, amount: info.amount, reason });
      await prisma.eventRegistration.update({ where: { id: info.regId }, data: { paymentStatus: 'REFUNDED' } });
    } catch (err) {
      console.error('[refund] remboursement event échoué', err);
    }
  }
```

- [ ] **Step 3 : Vérifier que les suites existantes passent toujours (aucune régression)**

Run: `npx jest --runTestsByPath src/services/__tests__/tournament.service.test.ts src/services/__tests__/event.service.test.ts`
Expected: PASS (toutes les suites vertes, dont les tests « remboursement » existants qui utilisent le motif par défaut).

- [ ] **Step 4 : Commit**

```bash
git add backend/src/services/tournament.service.ts backend/src/services/event.service.ts
git commit -m "refactor(refund): safeRefund accepte un motif (défaut inchangé)"
```

---

## Task 2 : Rembourser le binôme retiré par l'admin/J-A (tournoi)

**Files:**
- Modify: `backend/src/services/tournament.service.ts` (`adminRemoveRegistration`)
- Test: `backend/src/services/__tests__/tournament.service.test.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

Ajouter en fin de fichier `tournament.service.test.ts`, avant la dernière ligne, ce bloc :

```ts
describe('TournamentService.adminRemoveRegistration — remboursement', () => {
  beforeEach(() => { jest.clearAllMocks(); });
  afterEach(() => { jest.restoreAllMocks(); });

  it('retrait admin d une inscription PAID → RefundService.refund appelé (motif club) + REFUNDED', async () => {
    prismaMock.tournamentRegistration.findFirst
      .mockResolvedValueOnce({ id: 'r1', status: 'CONFIRMED' } as any) // findClubRegistration
      .mockResolvedValueOnce({ id: 'r1', status: 'CONFIRMED', paymentStatus: 'PAID' } as any); // dans la tx
    prismaMock.tournament.findUnique.mockResolvedValue({ requirePrepayment: true } as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([] as any);
    prismaMock.tournamentRegistration.update.mockResolvedValue({ id: 'r1', status: 'CANCELLED' } as any);
    // 3e appel findFirst (recherche de promotion dans cancelAndPromoteTx) → undefined = pas de promu.
    prismaMock.payment.findFirst.mockResolvedValue({ id: 'pay1', amount: 12 } as any);
    const refundSpy = jest.spyOn(RefundService.prototype, 'refund').mockResolvedValue({ id: 'rf1' } as any);

    await new TournamentService().adminRemoveRegistration('t1', 'r1', 'club-demo');

    expect(refundSpy).toHaveBeenCalledWith(expect.objectContaining({ paymentId: 'pay1', clubId: 'club-demo', amount: 12, reason: 'Retrait par le club' }));
  });

  it('retrait admin d une inscription non payée → pas de remboursement', async () => {
    prismaMock.tournamentRegistration.findFirst
      .mockResolvedValueOnce({ id: 'r1', status: 'CONFIRMED' } as any)
      .mockResolvedValueOnce({ id: 'r1', status: 'CONFIRMED', paymentStatus: 'NONE' } as any);
    prismaMock.tournament.findUnique.mockResolvedValue({ requirePrepayment: false } as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([] as any);
    prismaMock.tournamentRegistration.update.mockResolvedValue({ id: 'r1', status: 'CANCELLED' } as any);
    const refundSpy = jest.spyOn(RefundService.prototype, 'refund');

    await new TournamentService().adminRemoveRegistration('t1', 'r1', 'club-demo');

    expect(refundSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run: `npx jest --runTestsByPath src/services/__tests__/tournament.service.test.ts -t "adminRemoveRegistration — remboursement"`
Expected: FAIL (le 1er test : `refundSpy` jamais appelé car `adminRemoveRegistration` ne rembourse pas encore).

- [ ] **Step 3 : Modifier `adminRemoveRegistration` dans `tournament.service.ts`**

Remplacer le corps de la méthode par :

```ts
  /** Désinscription manuelle par le club (promeut le 1er en attente si c'était un CONFIRMED). */
  async adminRemoveRegistration(tournamentId: string, regId: string, clubId: string) {
    await this.findClubRegistration(tournamentId, regId, clubId); // vérifie l'appartenance au club
    const t = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { requirePrepayment: true } });
    const { cancelled, promotedRegistrationId, refundInfo } = await serializableTx(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tournaments WHERE id = ${tournamentId} FOR UPDATE`;
      const reg = await tx.tournamentRegistration.findFirst({
        where: { id: regId, status: { not: 'CANCELLED' } },
        select: { id: true, status: true, paymentStatus: true },
      });
      if (!reg) throw new Error('REGISTRATION_NOT_FOUND');
      const res = await this.cancelAndPromoteTx(tx, tournamentId, regId, reg.status === 'CONFIRMED', t?.requirePrepayment ?? false);
      let refundInfo: { paymentId: string; amount: number; regId: string } | null = null;
      if (reg.paymentStatus === 'PAID') {
        const pay = await tx.payment.findFirst({ where: { tournamentRegistrationId: reg.id, method: 'ONLINE' }, select: { id: true, amount: true } });
        if (pay) refundInfo = { paymentId: pay.id, amount: Number(pay.amount), regId: reg.id };
      }
      return { ...res, refundInfo };
    }, { timeout: 10_000 });

    if (promotedRegistrationId && t?.requirePrepayment) {
      // Payant : la notif de promotion part du débit réussi (chargePromotedRegistration), pas ici, pour ne pas doubler.
      await this.safeNotify(() => notify.notifyTournamentCancellation(cancelled.id));
      await this.safeCharge(promotedRegistrationId);
    } else {
      await this.notifyCancellation(cancelled.id, promotedRegistrationId);
    }
    // Remboursement best-effort du binôme retiré (post-commit, seulement si paiement ONLINE trouvé).
    if (refundInfo) await this.safeRefund(refundInfo, clubId, 'Retrait par le club');
    return cancelled;
  }
```

- [ ] **Step 4 : Lancer le test pour vérifier qu'il passe**

Run: `npx jest --runTestsByPath src/services/__tests__/tournament.service.test.ts -t "adminRemoveRegistration — remboursement"`
Expected: PASS (2 tests).

- [ ] **Step 5 : Lancer toute la suite tournoi (non-régression)**

Run: `npx jest --runTestsByPath src/services/__tests__/tournament.service.test.ts`
Expected: PASS.

- [ ] **Step 6 : Commit**

```bash
git add backend/src/services/tournament.service.ts backend/src/services/__tests__/tournament.service.test.ts
git commit -m "feat(tournois): rembourse le binôme retiré par admin/J-A (paiement en ligne)"
```

---

## Task 3 : Rembourser tous les inscrits quand le club annule le tournoi complet

**Files:**
- Modify: `backend/src/services/tournament.service.ts` (nouvelle méthode `refundAllPaidRegistrations` + `updateTournament`)
- Test: `backend/src/services/__tests__/tournament.service.test.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

Ajouter ce bloc en fin de `tournament.service.test.ts` :

```ts
describe('TournamentService.updateTournament — remboursement à l annulation', () => {
  beforeEach(() => { jest.clearAllMocks(); });
  afterEach(() => { jest.restoreAllMocks(); });

  it('annulation du tournoi par le club → rembourse chaque inscription PAID (motif club)', async () => {
    prismaMock.tournament.findFirst.mockResolvedValue({ id: 't1', status: 'PUBLISHED', entryFee: 12, requirePrepayment: true } as any);
    prismaMock.club.findUnique.mockResolvedValue({ stripeAccountStatus: 'ACTIVE' } as any); // assertPrepaymentAllowed
    prismaMock.tournament.update.mockResolvedValue({ id: 't1', status: 'CANCELLED' } as any);
    prismaMock.tournamentRegistration.findMany.mockResolvedValue([{ id: 'r1' }, { id: 'r2' }] as any);
    prismaMock.payment.findFirst
      .mockResolvedValueOnce({ id: 'pay1', amount: 12 } as any)
      .mockResolvedValueOnce({ id: 'pay2', amount: 12 } as any);
    prismaMock.tournamentRegistration.update.mockResolvedValue({} as any);
    const refundSpy = jest.spyOn(RefundService.prototype, 'refund').mockResolvedValue({ id: 'rf' } as any);

    await new TournamentService().updateTournament('t1', 'club-demo', { status: 'CANCELLED' });

    expect(refundSpy).toHaveBeenCalledTimes(2);
    expect(refundSpy).toHaveBeenCalledWith(expect.objectContaining({ paymentId: 'pay1', clubId: 'club-demo', amount: 12, reason: 'Annulation par le club' }));
    expect(refundSpy).toHaveBeenCalledWith(expect.objectContaining({ paymentId: 'pay2', amount: 12, reason: 'Annulation par le club' }));
  });

  it('mise à jour SANS transition vers CANCELLED → aucun remboursement', async () => {
    prismaMock.tournament.findFirst.mockResolvedValue({ id: 't1', status: 'PUBLISHED', entryFee: 12, requirePrepayment: false } as any);
    prismaMock.tournament.update.mockResolvedValue({ id: 't1', status: 'PUBLISHED' } as any);
    const refundSpy = jest.spyOn(RefundService.prototype, 'refund');

    await new TournamentService().updateTournament('t1', 'club-demo', { name: 'Nouveau nom' });

    expect(refundSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run: `npx jest --runTestsByPath src/services/__tests__/tournament.service.test.ts -t "remboursement à l annulation"`
Expected: FAIL (1er test : `refundSpy` jamais appelé).

- [ ] **Step 3 : Ajouter la méthode `refundAllPaidRegistrations` dans `tournament.service.ts`**

Juste avant `adminRemoveRegistration`, ajouter :

```ts
  /** Rembourse (best-effort) toutes les inscriptions payées en ligne d'un tournoi — utilisé quand le club annule l'épreuve entière. */
  private async refundAllPaidRegistrations(tournamentId: string, clubId: string, reason: string): Promise<void> {
    const paid = await prisma.tournamentRegistration.findMany({
      where: { tournamentId, status: { not: 'CANCELLED' }, paymentStatus: 'PAID' },
      select: { id: true },
    });
    for (const reg of paid) {
      const pay = await prisma.payment.findFirst({ where: { tournamentRegistrationId: reg.id, method: 'ONLINE' }, select: { id: true, amount: true } });
      if (pay) await this.safeRefund({ paymentId: pay.id, amount: Number(pay.amount), regId: reg.id }, clubId, reason);
    }
  }
```

- [ ] **Step 4 : Câbler l'appel dans `updateTournament`**

Dans `updateTournament`, remplacer le bloc de transition CANCELLED :

```ts
    if (input.status === 'CANCELLED' && found.status !== 'CANCELLED') {
      await this.safeNotify(() => notify.notifyActivityCancelledByClub('tournament', tournamentId));
    }
```

par :

```ts
    if (input.status === 'CANCELLED' && found.status !== 'CANCELLED') {
      await this.safeNotify(() => notify.notifyActivityCancelledByClub('tournament', tournamentId));
      // Rembourse les inscrits payés en ligne APRÈS la notif (la notif cible les regs par
      // status, pas paymentStatus — aucune interférence). Best-effort, jamais bloquant.
      await this.refundAllPaidRegistrations(tournamentId, clubId, 'Annulation par le club');
    }
```

- [ ] **Step 5 : Lancer le test pour vérifier qu'il passe**

Run: `npx jest --runTestsByPath src/services/__tests__/tournament.service.test.ts -t "remboursement à l annulation"`
Expected: PASS (2 tests).

- [ ] **Step 6 : Lancer toute la suite tournoi (non-régression)**

Run: `npx jest --runTestsByPath src/services/__tests__/tournament.service.test.ts`
Expected: PASS.

- [ ] **Step 7 : Commit**

```bash
git add backend/src/services/tournament.service.ts backend/src/services/__tests__/tournament.service.test.ts
git commit -m "feat(tournois): rembourse les inscrits payés quand le club annule l'épreuve"
```

---

## Task 4 : Rembourser l'inscrit retiré par l'admin (event)

**Files:**
- Modify: `backend/src/services/event.service.ts` (`adminRemoveRegistration`)
- Test: `backend/src/services/__tests__/event.service.test.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

Ajouter ce bloc en fin de `event.service.test.ts` :

```ts
describe('EventService.adminRemoveRegistration — remboursement', () => {
  beforeEach(() => { jest.clearAllMocks(); });
  afterEach(() => { jest.restoreAllMocks(); });

  it('retrait admin d une inscription PAID → RefundService.refund appelé (motif club) + REFUNDED', async () => {
    prismaMock.eventRegistration.findFirst
      .mockResolvedValueOnce({ id: 'r1', status: 'CONFIRMED' } as any) // findClubRegistration
      .mockResolvedValueOnce({ id: 'r1', status: 'CONFIRMED', paymentStatus: 'PAID' } as any); // dans la tx
    prismaMock.clubEvent.findUnique.mockResolvedValue({ requirePrepayment: true } as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([] as any);
    prismaMock.eventRegistration.update.mockResolvedValue({ id: 'r1', status: 'CANCELLED' } as any);
    // 3e appel findFirst (recherche de promotion dans cancelAndPromoteTx) → undefined = pas de promu.
    prismaMock.payment.findFirst.mockResolvedValue({ id: 'pay1', amount: 8 } as any);
    const refundSpy = jest.spyOn(RefundService.prototype, 'refund').mockResolvedValue({ id: 'rf1' } as any);

    await new EventService().adminRemoveRegistration('e1', 'r1', 'club-demo');

    expect(refundSpy).toHaveBeenCalledWith(expect.objectContaining({ paymentId: 'pay1', clubId: 'club-demo', amount: 8, reason: 'Retrait par le club' }));
  });

  it('retrait admin d une inscription non payée → pas de remboursement', async () => {
    prismaMock.eventRegistration.findFirst
      .mockResolvedValueOnce({ id: 'r1', status: 'CONFIRMED' } as any)
      .mockResolvedValueOnce({ id: 'r1', status: 'CONFIRMED', paymentStatus: 'NONE' } as any);
    prismaMock.clubEvent.findUnique.mockResolvedValue({ requirePrepayment: false } as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([] as any);
    prismaMock.eventRegistration.update.mockResolvedValue({ id: 'r1', status: 'CANCELLED' } as any);
    const refundSpy = jest.spyOn(RefundService.prototype, 'refund');

    await new EventService().adminRemoveRegistration('e1', 'r1', 'club-demo');

    expect(refundSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run: `npx jest --runTestsByPath src/services/__tests__/event.service.test.ts -t "adminRemoveRegistration — remboursement"`
Expected: FAIL (1er test).

- [ ] **Step 3 : Modifier `adminRemoveRegistration` dans `event.service.ts`**

Remplacer le corps de la méthode par :

```ts
  async adminRemoveRegistration(eventId: string, regId: string, clubId: string) {
    await this.findClubRegistration(eventId, regId, clubId); // vérifie l'appartenance au club
    const e = await prisma.clubEvent.findUnique({ where: { id: eventId }, select: { requirePrepayment: true } });
    const { cancelled, promotedRegistrationId, refundInfo } = await serializableTx(async (tx) => {
      await tx.$queryRaw`SELECT id FROM club_events WHERE id = ${eventId} FOR UPDATE`;
      const reg = await tx.eventRegistration.findFirst({
        where: { id: regId, status: { not: 'CANCELLED' } },
        select: { id: true, status: true, paymentStatus: true },
      });
      if (!reg) throw new Error('REGISTRATION_NOT_FOUND');
      const res = await this.cancelAndPromoteTx(tx, eventId, regId, reg.status === 'CONFIRMED', e?.requirePrepayment ?? false);
      let refundInfo: { paymentId: string; amount: number; regId: string } | null = null;
      if (reg.paymentStatus === 'PAID') {
        const pay = await tx.payment.findFirst({ where: { eventRegistrationId: reg.id, method: 'ONLINE' }, select: { id: true, amount: true } });
        if (pay) refundInfo = { paymentId: pay.id, amount: Number(pay.amount), regId: reg.id };
      }
      return { ...res, refundInfo };
    }, { timeout: 10_000 });

    if (promotedRegistrationId && e?.requirePrepayment) {
      // Payant : la notif de promotion part du débit réussi (chargePromotedRegistration), pas ici, pour ne pas doubler.
      await this.safeNotify(() => notify.notifyEventCancellation(cancelled.id));
      await this.safeCharge(promotedRegistrationId);
    } else {
      await this.notifyCancellation(cancelled.id, promotedRegistrationId);
    }
    // Remboursement best-effort de l'inscrit retiré (post-commit, seulement si paiement ONLINE trouvé).
    if (refundInfo) await this.safeRefund(refundInfo, clubId, 'Retrait par le club');
    return cancelled;
  }
```

- [ ] **Step 4 : Lancer le test pour vérifier qu'il passe**

Run: `npx jest --runTestsByPath src/services/__tests__/event.service.test.ts -t "adminRemoveRegistration — remboursement"`
Expected: PASS (2 tests).

- [ ] **Step 5 : Lancer toute la suite event (non-régression)**

Run: `npx jest --runTestsByPath src/services/__tests__/event.service.test.ts`
Expected: PASS.

- [ ] **Step 6 : Commit**

```bash
git add backend/src/services/event.service.ts backend/src/services/__tests__/event.service.test.ts
git commit -m "feat(events): rembourse l'inscrit retiré par l'admin (paiement en ligne)"
```

---

## Task 5 : Rembourser tous les inscrits quand le club annule l'event complet

**Files:**
- Modify: `backend/src/services/event.service.ts` (nouvelle méthode `refundAllPaidRegistrations` + `updateEvent`)
- Test: `backend/src/services/__tests__/event.service.test.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

Ajouter ce bloc en fin de `event.service.test.ts` :

```ts
describe('EventService.updateEvent — remboursement à l annulation', () => {
  beforeEach(() => { jest.clearAllMocks(); });
  afterEach(() => { jest.restoreAllMocks(); });

  it('annulation de l event par le club → rembourse chaque inscription PAID (motif club)', async () => {
    prismaMock.clubEvent.findFirst.mockResolvedValue({ id: 'e1', status: 'PUBLISHED', price: 8, requirePrepayment: true } as any);
    prismaMock.club.findUnique.mockResolvedValue({ stripeAccountStatus: 'ACTIVE' } as any); // assertPrepaymentAllowed
    prismaMock.clubEvent.update.mockResolvedValue({ id: 'e1', status: 'CANCELLED' } as any);
    prismaMock.eventRegistration.findMany.mockResolvedValue([{ id: 'r1' }, { id: 'r2' }] as any);
    prismaMock.payment.findFirst
      .mockResolvedValueOnce({ id: 'pay1', amount: 8 } as any)
      .mockResolvedValueOnce({ id: 'pay2', amount: 8 } as any);
    prismaMock.eventRegistration.update.mockResolvedValue({} as any);
    const refundSpy = jest.spyOn(RefundService.prototype, 'refund').mockResolvedValue({ id: 'rf' } as any);

    await new EventService().updateEvent('e1', 'club-demo', { status: 'CANCELLED' });

    expect(refundSpy).toHaveBeenCalledTimes(2);
    expect(refundSpy).toHaveBeenCalledWith(expect.objectContaining({ paymentId: 'pay1', clubId: 'club-demo', amount: 8, reason: 'Annulation par le club' }));
    expect(refundSpy).toHaveBeenCalledWith(expect.objectContaining({ paymentId: 'pay2', amount: 8, reason: 'Annulation par le club' }));
  });

  it('mise à jour SANS transition vers CANCELLED → aucun remboursement', async () => {
    prismaMock.clubEvent.findFirst.mockResolvedValue({ id: 'e1', status: 'PUBLISHED', price: 8, requirePrepayment: false } as any);
    prismaMock.clubEvent.update.mockResolvedValue({ id: 'e1', status: 'PUBLISHED' } as any);
    const refundSpy = jest.spyOn(RefundService.prototype, 'refund');

    await new EventService().updateEvent('e1', 'club-demo', { name: 'Nouveau nom' });

    expect(refundSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run: `npx jest --runTestsByPath src/services/__tests__/event.service.test.ts -t "remboursement à l annulation"`
Expected: FAIL (1er test).

- [ ] **Step 3 : Ajouter la méthode `refundAllPaidRegistrations` dans `event.service.ts`**

Juste avant `adminRemoveRegistration`, ajouter :

```ts
  /** Rembourse (best-effort) toutes les inscriptions payées en ligne d'un event — utilisé quand le club annule l'épreuve entière. */
  private async refundAllPaidRegistrations(eventId: string, clubId: string, reason: string): Promise<void> {
    const paid = await prisma.eventRegistration.findMany({
      where: { eventId, status: { not: 'CANCELLED' }, paymentStatus: 'PAID' },
      select: { id: true },
    });
    for (const reg of paid) {
      const pay = await prisma.payment.findFirst({ where: { eventRegistrationId: reg.id, method: 'ONLINE' }, select: { id: true, amount: true } });
      if (pay) await this.safeRefund({ paymentId: pay.id, amount: Number(pay.amount), regId: reg.id }, clubId, reason);
    }
  }
```

- [ ] **Step 4 : Câbler l'appel dans `updateEvent`**

Dans `updateEvent`, remplacer le bloc de transition CANCELLED :

```ts
    if (input.status === 'CANCELLED' && found.status !== 'CANCELLED') {
      await this.safeNotify(() => notify.notifyActivityCancelledByClub('event', eventId));
    }
```

par :

```ts
    if (input.status === 'CANCELLED' && found.status !== 'CANCELLED') {
      await this.safeNotify(() => notify.notifyActivityCancelledByClub('event', eventId));
      // Rembourse les inscrits payés en ligne APRÈS la notif (la notif cible les regs par
      // status, pas paymentStatus — aucune interférence). Best-effort, jamais bloquant.
      await this.refundAllPaidRegistrations(eventId, clubId, 'Annulation par le club');
    }
```

- [ ] **Step 5 : Lancer le test pour vérifier qu'il passe**

Run: `npx jest --runTestsByPath src/services/__tests__/event.service.test.ts -t "remboursement à l annulation"`
Expected: PASS (2 tests).

- [ ] **Step 6 : Lancer toute la suite event (non-régression)**

Run: `npx jest --runTestsByPath src/services/__tests__/event.service.test.ts`
Expected: PASS.

- [ ] **Step 7 : Commit**

```bash
git add backend/src/services/event.service.ts backend/src/services/__tests__/event.service.test.ts
git commit -m "feat(events): rembourse les inscrits payés quand le club annule l'épreuve"
```

---

## Task 6 : Vérification finale (typecheck + suites complètes)

- [ ] **Step 1 : Typecheck backend**

Run: `npx tsc --noEmit` (depuis `backend/`)
Expected: aucune sortie (0 erreur).

- [ ] **Step 2 : Relancer les deux suites ensemble**

Run: `npx jest --runTestsByPath src/services/__tests__/tournament.service.test.ts src/services/__tests__/event.service.test.ts`
Expected: PASS (toutes suites vertes).

- [ ] **Step 3 : (aucun commit — vérification seule)**

---

## Notes d'implémentation

- **Ordre des mocks `findFirst`** dans les tests admin : le 1er `mockResolvedValueOnce` répond à `findClubRegistration` (hors transaction), le 2e à la lecture intra-transaction. Respecter l'ordre.
- **`assertPrepaymentAllowed`** est appelée par `updateTournament`/`updateEvent` quand `requirePrepayment` reste actif → mocker `prismaMock.club.findUnique` avec `{ stripeAccountStatus: 'ACTIVE' }` dans les tests d'annulation payante.
- **Aucune migration, aucun changement de route, aucun changement front** — purement service backend. Les routes admin existantes (`updateTournament`/`updateEvent`/`adminRemoveRegistration`) appellent déjà ces méthodes.
- **Liste d'attente** : jamais remboursée car `paymentStatus` reste `NONE` (carte enregistrée via SetupIntent, jamais débitée) → exclue par le filtre `paymentStatus: 'PAID'`.
