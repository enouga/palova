# Gérer les joueurs & annuler une réservation depuis « Mes réservations » — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à l'organisateur d'une réservation à venir d'ajouter/retirer des membres du club et d'annuler, depuis « Mes réservations », avec des délais configurables par le club.

**Architecture:** On réutilise `ReservationParticipant` + la répartition `splitShares` existante. Le cœur transactionnel (membership + capacité + répartition) est factorisé en helpers privés partagés entre le flux admin (caisse) et un nouveau flux propriétaire (organisateur). Deux colonnes `Club` portent les délais (heures avant le début) ; les gardes de délai s'ajoutent à l'annulation et aux changements de joueurs.

**Tech Stack:** Backend Express 5 + Prisma 7 (PostgreSQL), Jest + ts-jest (Prisma mocké, sans DB) + supertest. Frontend Next.js 16 (App Router, client components) + React 19 + Tailwind v4, Jest + RTL.

**Conventions :**
- Commandes backend depuis `palova/backend`, frontend depuis `palova/frontend`.
- `npm test -- <motif>` lance un seul fichier de test (Jest).
- Commits : `git add` **uniquement** les fichiers listés (l'utilisateur développe en parallèle — ne jamais `git add -A`).
- Messages de commit en français, terminés par la ligne `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

## Task 1: Schéma — délais configurables sur `Club`

**Files:**
- Modify: `backend/prisma/schema.prisma` (modèle `Club`, après `bookingQuotas` ligne ~149)
- Create: `backend/prisma/migrations/20260614130000_add_reservation_change_cutoffs/migration.sql`

- [ ] **Step 1: Ajouter les deux colonnes au modèle `Club`**

Dans `backend/prisma/schema.prisma`, juste après la ligne `bookingQuotas    Json?      @map("booking_quotas")` :

```prisma
  // Délais (heures avant le début d'une réservation) au-delà desquels le joueur ne
  // peut plus, respectivement, changer les joueurs de la partie / annuler. 0 = jusqu'au début.
  playerChangeCutoffHours Int @default(0) @map("player_change_cutoff_hours")
  cancellationCutoffHours Int @default(0) @map("cancellation_cutoff_hours")
```

- [ ] **Step 2: Créer le fichier de migration**

Créer `backend/prisma/migrations/20260614130000_add_reservation_change_cutoffs/migration.sql` :

```sql
-- AlterTable
ALTER TABLE "clubs" ADD COLUMN     "player_change_cutoff_hours" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cancellation_cutoff_hours" INTEGER NOT NULL DEFAULT 0;
```

- [ ] **Step 3: Régénérer le client Prisma (types)**

Run (depuis `palova/backend`) : `npx prisma generate`
Expected: « Generated Prisma Client » sans erreur. (Ne nécessite pas de base de données.)

> Si PostgreSQL tourne (`docker-compose-v1.exe up -d`), tu peux à la place faire `npx prisma migrate dev --name add_reservation_change_cutoffs` qui crée la migration **et** l'applique **et** régénère le client en une fois — vérifie alors que le SQL généré correspond au Step 2.

- [ ] **Step 4: Vérifier que le backend compile**

Run (depuis `palova/backend`) : `npx tsc --noEmit`
Expected: aucune erreur (les nouveaux champs `Club.playerChangeCutoffHours` / `cancellationCutoffHours` sont connus du client).

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma "backend/prisma/migrations/20260614130000_add_reservation_change_cutoffs/migration.sql"
git commit -m "feat(reservations): colonnes Club délai changement joueurs & annulation

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 2: `club.service` — lire & écrire les délais

**Files:**
- Modify: `backend/src/services/club.service.ts` (`getClubForAdmin` ~163, `updateClub` ~176)
- Test: `backend/src/services/__tests__/club.service.test.ts`

- [ ] **Step 1: Écrire le test d'écriture (clamp 0–365)**

Ajouter à la fin de `backend/src/services/__tests__/club.service.test.ts`, **avant** le dernier `});` du fichier si le `describe` englobe tout — sinon en nouveau bloc top-level :

```ts
describe('ClubService — updateClub délais', () => {
  let svc: ClubService;
  beforeEach(() => { svc = new ClubService(); });

  it('clampe les délais entre 0 et 365', async () => {
    prismaMock.club.update.mockResolvedValue({} as any);
    await svc.updateClub('club-1', { playerChangeCutoffHours: 999, cancellationCutoffHours: -5 });
    const arg = (prismaMock.club.update as jest.Mock).mock.calls[0][0];
    expect(arg.data.playerChangeCutoffHours).toBe(365);
    expect(arg.data.cancellationCutoffHours).toBe(0);
  });

  it('ignore les délais absents', async () => {
    prismaMock.club.update.mockResolvedValue({} as any);
    await svc.updateClub('club-1', { name: 'X' });
    const arg = (prismaMock.club.update as jest.Mock).mock.calls[0][0];
    expect(arg.data.playerChangeCutoffHours).toBeUndefined();
    expect(arg.data.cancellationCutoffHours).toBeUndefined();
  });
});
```

- [ ] **Step 2: Lancer le test → échec attendu**

Run (depuis `palova/backend`) : `npm test -- club.service`
Expected: FAIL (`updateClub` ne gère pas encore ces champs ; `data.playerChangeCutoffHours` vaut `undefined`).

- [ ] **Step 3: Étendre `getClubForAdmin` (select)**

Dans `backend/src/services/club.service.ts`, méthode `getClubForAdmin`, ajouter les deux champs au `select` (après `bookingQuotas: true,`) :

```ts
        bookingQuotas: true,
        playerChangeCutoffHours: true, cancellationCutoffHours: true,
```

- [ ] **Step 4: Étendre `updateClub` (params + data)**

Dans la signature `params` de `updateClub`, après `bookingQuotas?: unknown;` :

```ts
    bookingQuotas?: unknown;
    playerChangeCutoffHours?: number;
    cancellationCutoffHours?: number;
```

Dans l'objet `data` de `updateClub`, après la ligne `...(typeof params.memberBookingDays === 'number' ? { memberBookingDays: clamp(params.memberBookingDays) } : {}),` :

```ts
        ...(typeof params.playerChangeCutoffHours === 'number' ? { playerChangeCutoffHours: clamp(params.playerChangeCutoffHours) } : {}),
        ...(typeof params.cancellationCutoffHours === 'number' ? { cancellationCutoffHours: clamp(params.cancellationCutoffHours) } : {}),
```

- [ ] **Step 5: Lancer le test → succès**

Run (depuis `palova/backend`) : `npm test -- club.service`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/club.service.ts backend/src/services/__tests__/club.service.test.ts
git commit -m "feat(club): getClubForAdmin/updateClub gèrent les délais (clamp 0-365)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 3: `reservation.service` — factoriser le cœur participants (refactor sans changement de comportement)

But : extraire la logique de `addReservationParticipant` / `removeReservationParticipant` en helpers privés `applyAddParticipant` / `applyRemoveParticipant`, réutilisables par le flux propriétaire. **Aucun changement de comportement** — les tests existants doivent rester verts.

**Files:**
- Modify: `backend/src/services/reservation.service.ts`

- [ ] **Step 1: Ajouter les helpers privés**

Dans `backend/src/services/reservation.service.ts`, **juste avant** la méthode `async addReservationParticipant(`, insérer :

```ts
  /**
   * Cœur partagé d'ajout d'un participant : valide le membre + la capacité et
   * (re)répartit les parts (transaction Serializable). Suppose `reservation` chargée
   * avec resource.{clubId,attributes,price,offPeakPrice,club.{offPeakHours,timezone}}.
   */
  private async applyAddParticipant(
    reservation: {
      id: string; userId: string | null; type: ReservationType;
      totalPrice: Prisma.Decimal | null; startTime: Date; endTime: Date;
      resource: {
        clubId: string; attributes: Prisma.JsonValue; price: Prisma.Decimal; offPeakPrice: Prisma.Decimal | null;
        club: { offPeakHours: Prisma.JsonValue | null; timezone: string };
      };
    },
    memberUserId: string,
  ): Promise<void> {
    const membership = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId: memberUserId, clubId: reservation.resource.clubId } },
    });
    if (!membership || membership.status === 'BLOCKED') throw new Error('MEMBER_NOT_FOUND');

    const format   = (reservation.resource.attributes as { format?: string } | null)?.format;
    const max      = playerCount(format);
    const dueCents = this.effectiveDueCents(reservation, reservation.resource.club);

    await prisma.$transaction(async (tx) => {
      const existing = await tx.reservationParticipant.findMany({
        where: { reservationId: reservation.id }, orderBy: { joinedAt: 'asc' },
        select: { id: true, userId: true, isOrganizer: true },
      });
      if (existing.some((p) => p.userId === memberUserId)) return; // déjà participant → no-op

      if (existing.length === 0) {
        if (!reservation.userId)                 throw new Error('RESERVATION_HAS_NO_MEMBER');
        if (reservation.userId === memberUserId) throw new Error('PARTNER_DUPLICATE');
        if (2 > max)                             throw new Error('TOO_MANY_PLAYERS');
        await tx.reservationParticipant.createMany({
          data: this.participantRows(reservation.id, reservation.userId, [memberUserId], dueCents),
        });
        return;
      }

      if (existing.length + 1 > max) throw new Error('TOO_MANY_PLAYERS');
      const organizer  = existing.find((p) => p.isOrganizer) ?? existing[0];
      const partnerIds = [...existing.filter((p) => p.id !== organizer.id).map((p) => p.userId), memberUserId];
      const shares     = this.splitShares(organizer.userId, partnerIds, dueCents);
      const byUser     = new Map(shares.map((s) => [s.userId, s]));
      for (const p of existing) {
        const s = byUser.get(p.userId)!;
        await tx.reservationParticipant.update({ where: { id: p.id }, data: { share: s.share, isOrganizer: s.isOrganizer } });
      }
      const ns = byUser.get(memberUserId)!;
      await tx.reservationParticipant.create({ data: { reservationId: reservation.id, userId: memberUserId, isOrganizer: ns.isOrganizer, share: ns.share } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  /**
   * Cœur partagé de retrait d'un participant : recalcule les parts des survivants.
   * Suppose `reservation` chargée avec resource.{price,offPeakPrice,club.{offPeakHours,timezone}}.
   */
  private async applyRemoveParticipant(
    reservation: {
      id: string; type: ReservationType; totalPrice: Prisma.Decimal | null; startTime: Date; endTime: Date;
      resource: { price: Prisma.Decimal; offPeakPrice: Prisma.Decimal | null; club: { offPeakHours: Prisma.JsonValue | null; timezone: string } };
    },
    participantId: string,
  ): Promise<void> {
    const dueCents = this.effectiveDueCents(reservation, reservation.resource.club);
    await prisma.$transaction(async (tx) => {
      const existing = await tx.reservationParticipant.findMany({
        where: { reservationId: reservation.id }, orderBy: { joinedAt: 'asc' },
        select: { id: true, userId: true, isOrganizer: true },
      });
      const target = existing.find((p) => p.id === participantId);
      if (!target)                                   throw new Error('PARTICIPANT_NOT_FOUND');
      if (target.isOrganizer && existing.length > 1) throw new Error('CANNOT_REMOVE_ORGANIZER');

      await tx.reservationParticipant.delete({ where: { id: participantId } });
      const remaining = existing.filter((p) => p.id !== participantId);
      if (remaining.length === 0) return;
      const organizer  = remaining.find((p) => p.isOrganizer) ?? remaining[0];
      const partnerIds = remaining.filter((p) => p.id !== organizer.id).map((p) => p.userId);
      const shares     = this.splitShares(organizer.userId, partnerIds, dueCents);
      const byUser     = new Map(shares.map((s) => [s.userId, s]));
      for (const p of remaining) {
        const s = byUser.get(p.userId)!;
        await tx.reservationParticipant.update({ where: { id: p.id }, data: { share: s.share, isOrganizer: s.isOrganizer } });
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
```

- [ ] **Step 2: Remplacer le corps de `addReservationParticipant` par un appel au helper**

Remplacer toute la méthode `addReservationParticipant` (du `async addReservationParticipant(` jusqu'à son `}` fermant, ~lignes 593–648) par :

```ts
  async addReservationParticipant(reservationId: string, clubId: string, memberUserId: string) {
    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: {
        resource: {
          select: { clubId: true, attributes: true, price: true, offPeakPrice: true, club: { select: { offPeakHours: true, timezone: true } } },
        },
      },
    });
    if (!reservation)                           throw new Error('RESERVATION_NOT_FOUND');
    if (reservation.resource.clubId !== clubId) throw new Error('CLUB_MISMATCH');

    await this.applyAddParticipant(reservation, memberUserId);

    // Best-effort : prévenir le membre qu'il a été ajouté à la partie.
    await this.safeNotify(() => notifyReservationMemberAssigned(reservationId, memberUserId));
    return this.loadClubReservation(reservationId, clubId);
  }
```

- [ ] **Step 3: Remplacer le corps de `removeReservationParticipant` par un appel au helper**

Remplacer toute la méthode `removeReservationParticipant` (~lignes 656–694) par :

```ts
  async removeReservationParticipant(reservationId: string, clubId: string, participantId: string) {
    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: {
        resource: {
          select: { clubId: true, price: true, offPeakPrice: true, club: { select: { offPeakHours: true, timezone: true } } },
        },
      },
    });
    if (!reservation)                           throw new Error('RESERVATION_NOT_FOUND');
    if (reservation.resource.clubId !== clubId) throw new Error('CLUB_MISMATCH');

    await this.applyRemoveParticipant(reservation, participantId);
    return this.loadClubReservation(reservationId, clubId);
  }
```

- [ ] **Step 4: Lancer les tests existants → toujours verts (aucune régression)**

Run (depuis `palova/backend`) : `npm test -- reservation.service`
Expected: PASS — y compris les blocs `addReservationParticipant` et `removeReservationParticipant` existants (le comportement externe est identique).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/reservation.service.ts
git commit -m "refactor(reservations): factorise le cœur add/remove participant

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 4: `reservation.service` — délai d'annulation

**Files:**
- Modify: `backend/src/services/reservation.service.ts` (`cancelReservation` ~363)
- Test: `backend/src/services/__tests__/reservation.service.test.ts` (bloc `cancelReservation` ~276)

- [ ] **Step 1: Mettre à jour le test de succès `cancelReservation` (mock enrichi + date future)**

Dans `backend/src/services/__tests__/reservation.service.test.ts`, remplacer le test `it('annule une réservation CONFIRMED et broadcast slot_released', …)` par :

```ts
    it('annule une réservation CONFIRMED et broadcast slot_released', async () => {
      const future = new Date(Date.now() + 3_600_000);
      prismaMock.reservation.findUnique.mockResolvedValue({
        id: 'res-1', resourceId: 'court-1', userId: 'user-1', status: 'CONFIRMED',
        startTime: future, endTime: new Date(future.getTime() + 3_600_000),
        resource: { club: { cancellationCutoffHours: 0 } },
      } as any);
      prismaMock.reservation.update.mockResolvedValue({
        id: 'res-1', status: 'CANCELLED', resourceId: 'court-1',
        startTime: future, endTime: new Date(future.getTime() + 3_600_000),
      } as any);
      redisMock.del.mockResolvedValue(1);

      await service.cancelReservation('res-1', 'user-1');

      expect(prismaMock.reservation.update).toHaveBeenCalledWith({
        where: { id: 'res-1' },
        data: { status: 'CANCELLED', cancelledAt: expect.any(Date) },
      });
      expect(sseBroadcast()).toHaveBeenCalledWith(
        'court-1',
        expect.objectContaining({ type: 'slot_released' }),
      );
    });
```

- [ ] **Step 2: Ajouter un test « trop tard » dans le même bloc**

Juste après le test précédent, ajouter :

```ts
    it('lève CANCELLATION_TOO_LATE après le délai du club', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue({
        id: 'res-1', resourceId: 'court-1', userId: 'user-1', status: 'CONFIRMED',
        startTime: new Date(Date.now() + 3_600_000),       // début dans 1h
        endTime:   new Date(Date.now() + 7_200_000),
        resource: { club: { cancellationCutoffHours: 2 } }, // clôture 2h avant → déjà fermé
      } as any);

      await expect(service.cancelReservation('res-1', 'user-1')).rejects.toThrow('CANCELLATION_TOO_LATE');
    });
```

- [ ] **Step 3: Lancer le test → échec attendu**

Run (depuis `palova/backend`) : `npm test -- reservation.service -t cancelReservation`
Expected: FAIL (le délai n'est pas encore vérifié ; le test « trop tard » échoue, et le test de succès peut lever sur `reservation.resource.club` non lu).

- [ ] **Step 4: Ajouter le helper de délai**

Dans `backend/src/services/reservation.service.ts`, **juste avant** `private async performCancel(`, insérer :

```ts
  /** Refuse l'action si on est à moins de `cutoffHours` du début (cutoff 0 = autorisé jusqu'au début). */
  private assertWithinCutoff(startTime: Date, cutoffHours: number, errorCode: string): void {
    const deadline = startTime.getTime() - Math.max(0, cutoffHours) * 3_600_000;
    if (Date.now() > deadline) throw new Error(errorCode);
  }
```

- [ ] **Step 5: Brancher le délai dans `cancelReservation`**

Remplacer la méthode `cancelReservation` (~363–373) par :

```ts
  async cancelReservation(reservationId: string, userId: string) {
    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { resource: { select: { club: { select: { cancellationCutoffHours: true } } } } },
    });

    if (!reservation)                       throw new Error('RESERVATION_NOT_FOUND');
    if (reservation.userId !== userId)      throw new Error('UNAUTHORIZED');
    if (reservation.status === 'CANCELLED') throw new Error('ALREADY_CANCELLED');
    this.assertWithinCutoff(reservation.startTime, reservation.resource.club.cancellationCutoffHours, 'CANCELLATION_TOO_LATE');

    return this.performCancel(reservation);
  }
```

> `performCancel` lit seulement `id/resourceId/startTime/endTime` — l'objet enrichi (avec `resource`/`status`) reste compatible.

- [ ] **Step 6: Lancer le test → succès**

Run (depuis `palova/backend`) : `npm test -- reservation.service -t cancelReservation`
Expected: PASS (succès + « trop tard » + UNAUTHORIZED/ALREADY_CANCELLED/NOT_FOUND inchangés).

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/reservation.service.ts backend/src/services/__tests__/reservation.service.test.ts
git commit -m "feat(reservations): délai d'annulation configurable par club

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 5: `reservation.service` — flux propriétaire (joueurs) + délai de changement

**Files:**
- Modify: `backend/src/services/reservation.service.ts` (nouvelles méthodes + `listUserReservations` ~697)
- Test: `backend/src/services/__tests__/reservation.service.test.ts`

- [ ] **Step 1: Écrire les tests des méthodes propriétaire**

Ajouter dans `backend/src/services/__tests__/reservation.service.test.ts`, à l'intérieur du `describe('ReservationService', …)`, après le bloc `removeReservationParticipant` :

```ts
  describe('getOwnReservationPlayers', () => {
    it('renvoie capacité + joueurs pour le propriétaire', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue({
        id: 'res-1', userId: 'user-1',
        resource: { attributes: { format: 'double' } },
        participants: [
          { id: 'p1', userId: 'user-1', isOrganizer: true,  share: 25, user: { firstName: 'Eric', lastName: 'N' } },
          { id: 'p2', userId: 'user-2', isOrganizer: false, share: 0,  user: { firstName: 'Sam',  lastName: 'P' } },
        ],
      } as any);

      const out = await service.getOwnReservationPlayers('res-1', 'user-1');

      expect(out.capacity).toBe(4);
      expect(out.participants).toHaveLength(2);
      expect(out.participants[0]).toMatchObject({ id: 'p1', isOrganizer: true, firstName: 'Eric', share: '25.00' });
    });

    it('lève UNAUTHORIZED si ce n est pas le propriétaire', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue({
        id: 'res-1', userId: 'autre', resource: { attributes: {} }, participants: [],
      } as any);
      await expect(service.getOwnReservationPlayers('res-1', 'user-1')).rejects.toThrow('UNAUTHORIZED');
    });

    it('lève RESERVATION_NOT_FOUND si inexistante', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(null);
      await expect(service.getOwnReservationPlayers('res-x', 'user-1')).rejects.toThrow('RESERVATION_NOT_FOUND');
    });
  });

  describe('addOwnReservationParticipant', () => {
    const future = new Date(Date.now() + 24 * 3_600_000);
    const resa = (over: any = {}) => ({
      id: 'res-1', userId: 'user-1', status: 'CONFIRMED', type: 'COURT', totalPrice: 25,
      startTime: future, endTime: new Date(future.getTime() + 3_600_000),
      resource: { clubId: 'club-1', attributes: { format: 'double' }, price: 25, offPeakPrice: null, club: { offPeakHours: null, timezone: 'Europe/Paris', playerChangeCutoffHours: 0 } },
      ...over,
    });

    beforeEach(() => {
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
      prismaMock.clubMembership.findUnique.mockResolvedValue({ id: 'mb-1', status: 'ACTIVE' } as any);
      jest.spyOn(service as any, 'getOwnReservationPlayers').mockResolvedValue({ id: 'res-1', capacity: 4, participants: [] } as any);
    });

    it('ajoute un joueur pour le propriétaire (organisateur matérialisé)', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(resa() as any);
      prismaMock.reservationParticipant.findMany.mockResolvedValue([] as any);

      await service.addOwnReservationParticipant('res-1', 'user-1', 'user-2');

      expect(prismaMock.reservationParticipant.createMany).toHaveBeenCalled();
    });

    it('lève UNAUTHORIZED si ce n est pas le propriétaire', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(resa({ userId: 'autre' }) as any);
      await expect(service.addOwnReservationParticipant('res-1', 'user-1', 'user-2')).rejects.toThrow('UNAUTHORIZED');
    });

    it('lève RESERVATION_NOT_ACTIVE si la résa n est pas CONFIRMED', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(resa({ status: 'PENDING' }) as any);
      await expect(service.addOwnReservationParticipant('res-1', 'user-1', 'user-2')).rejects.toThrow('RESERVATION_NOT_ACTIVE');
    });

    it('lève PLAYER_CHANGE_TOO_LATE après le délai', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(
        resa({ startTime: new Date(Date.now() - 3_600_000) }) as any, // début passé, cutoff 0 → fermé
      );
      await expect(service.addOwnReservationParticipant('res-1', 'user-1', 'user-2')).rejects.toThrow('PLAYER_CHANGE_TOO_LATE');
    });
  });

  describe('removeOwnReservationParticipant', () => {
    const future = new Date(Date.now() + 24 * 3_600_000);
    const resa = (over: any = {}) => ({
      id: 'res-1', userId: 'user-1', status: 'CONFIRMED', type: 'COURT', totalPrice: 25,
      startTime: future, endTime: new Date(future.getTime() + 3_600_000),
      resource: { clubId: 'club-1', price: 25, offPeakPrice: null, club: { offPeakHours: null, timezone: 'Europe/Paris', playerChangeCutoffHours: 0 } },
      ...over,
    });

    beforeEach(() => {
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
      jest.spyOn(service as any, 'getOwnReservationPlayers').mockResolvedValue({ id: 'res-1', capacity: 4, participants: [] } as any);
    });

    it('retire un joueur pour le propriétaire', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(resa() as any);
      prismaMock.reservationParticipant.findMany.mockResolvedValue([
        { id: 'p1', userId: 'user-1', isOrganizer: true },
        { id: 'p2', userId: 'user-2', isOrganizer: false },
      ] as any);

      await service.removeOwnReservationParticipant('res-1', 'user-1', 'p2');

      expect(prismaMock.reservationParticipant.delete).toHaveBeenCalledWith({ where: { id: 'p2' } });
    });

    it('lève UNAUTHORIZED si ce n est pas le propriétaire', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue(resa({ userId: 'autre' }) as any);
      await expect(service.removeOwnReservationParticipant('res-1', 'user-1', 'p2')).rejects.toThrow('UNAUTHORIZED');
    });
  });
```

- [ ] **Step 2: Lancer les tests → échec attendu**

Run (depuis `palova/backend`) : `npm test -- reservation.service -t "Own"`
Expected: FAIL (méthodes inexistantes).

- [ ] **Step 3: Ajouter le lecteur + les méthodes propriétaire**

Dans `backend/src/services/reservation.service.ts`, **juste avant** `async listUserReservations(`, insérer :

```ts
  /** Forme JSON du modal « Gérer les joueurs » : capacité + joueurs (id/nom/part/organisateur). */
  private mapOwnPlayers(r: {
    id: string;
    resource: { attributes: Prisma.JsonValue };
    participants: Array<{ id: string; userId: string; isOrganizer: boolean; share: Prisma.Decimal; user: { firstName: string; lastName: string } }>;
  }) {
    const format = (r.resource.attributes as { format?: string } | null)?.format;
    return {
      id: r.id,
      capacity: playerCount(format),
      participants: r.participants.map((p) => ({
        id: p.id, userId: p.userId, isOrganizer: p.isOrganizer,
        firstName: p.user.firstName, lastName: p.user.lastName,
        share: Number(p.share).toFixed(2),
      })),
    };
  }

  /** Lecture des joueurs d'une résa, réservée à son organisateur (modal « Gérer les joueurs »). */
  async getOwnReservationPlayers(reservationId: string, userId: string) {
    const r = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: {
        resource: { select: { attributes: true } },
        participants: {
          orderBy: { joinedAt: 'asc' },
          select: { id: true, userId: true, isOrganizer: true, share: true, user: { select: { firstName: true, lastName: true } } },
        },
      },
    });
    if (!r)                  throw new Error('RESERVATION_NOT_FOUND');
    if (r.userId !== userId) throw new Error('UNAUTHORIZED');
    return this.mapOwnPlayers(r);
  }

  /** Ajout d'un joueur par l'organisateur depuis « Mes réservations » (membre du club, délai respecté). */
  async addOwnReservationParticipant(reservationId: string, userId: string, memberUserId: string) {
    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: {
        resource: {
          select: { clubId: true, attributes: true, price: true, offPeakPrice: true, club: { select: { offPeakHours: true, timezone: true, playerChangeCutoffHours: true } } },
        },
      },
    });
    if (!reservation)                       throw new Error('RESERVATION_NOT_FOUND');
    if (reservation.userId !== userId)      throw new Error('UNAUTHORIZED');
    if (reservation.status !== 'CONFIRMED') throw new Error('RESERVATION_NOT_ACTIVE');
    this.assertWithinCutoff(reservation.startTime, reservation.resource.club.playerChangeCutoffHours, 'PLAYER_CHANGE_TOO_LATE');

    await this.applyAddParticipant(reservation, memberUserId);
    await this.safeNotify(() => notifyReservationMemberAssigned(reservationId, memberUserId));
    return this.getOwnReservationPlayers(reservationId, userId);
  }

  /** Retrait d'un joueur par l'organisateur depuis « Mes réservations » (délai respecté). */
  async removeOwnReservationParticipant(reservationId: string, userId: string, participantId: string) {
    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: {
        resource: {
          select: { clubId: true, price: true, offPeakPrice: true, club: { select: { offPeakHours: true, timezone: true, playerChangeCutoffHours: true } } },
        },
      },
    });
    if (!reservation)                       throw new Error('RESERVATION_NOT_FOUND');
    if (reservation.userId !== userId)      throw new Error('UNAUTHORIZED');
    if (reservation.status !== 'CONFIRMED') throw new Error('RESERVATION_NOT_ACTIVE');
    this.assertWithinCutoff(reservation.startTime, reservation.resource.club.playerChangeCutoffHours, 'PLAYER_CHANGE_TOO_LATE');

    await this.applyRemoveParticipant(reservation, participantId);
    return this.getOwnReservationPlayers(reservationId, userId);
  }
```

- [ ] **Step 4: Exposer les délais club dans `listUserReservations` (pour l'UX liste)**

Dans `listUserReservations`, remplacer le bloc `include` par :

```ts
      include: {
        resource: { select: { id: true, name: true, club: { select: { name: true, slug: true, timezone: true, playerChangeCutoffHours: true, cancellationCutoffHours: true } } } },
      },
```

- [ ] **Step 5: Lancer les tests → succès**

Run (depuis `palova/backend`) : `npm test -- reservation.service`
Expected: PASS (tous les blocs, anciens et nouveaux).

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/reservation.service.ts backend/src/services/__tests__/reservation.service.test.ts
git commit -m "feat(reservations): flux propriétaire ajout/retrait joueurs + délai de changement

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 6: Routes joueur + mapping d'erreurs

**Files:**
- Modify: `backend/src/routes/reservations.ts`
- Create: `backend/src/routes/__tests__/reservations.routes.test.ts`

- [ ] **Step 1: Ajouter les nouveaux codes d'erreur**

Dans `backend/src/routes/reservations.ts`, dans l'objet `ERROR_STATUS`, après `PARTNER_DUPLICATE:           400,` ajouter :

```ts
  PLAYER_CHANGE_TOO_LATE:   409,
  CANCELLATION_TOO_LATE:    409,
  MEMBER_NOT_FOUND:         404,
  PARTICIPANT_NOT_FOUND:    404,
  CANNOT_REMOVE_ORGANIZER:  409,
  RESERVATION_HAS_NO_MEMBER: 409,
```

- [ ] **Step 2: Ajouter les routes joueur**

Dans `backend/src/routes/reservations.ts`, **juste avant** `export default router;`, insérer :

```ts
// Joueurs d'une réservation (organisateur uniquement) : lecture.
router.get('/:id/players', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await reservationService.getOwnReservationPlayers(asString(req.params.id), req.user!.id));
  } catch (err) { handleError(err, res, next); }
});

// Ajoute un membre du club à sa partie (répartit les parts).
router.post('/:id/players', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const memberUserId = asString(req.body?.memberUserId);
    if (!memberUserId) return void res.status(400).json({ error: 'memberUserId requis' });
    res.json(await reservationService.addOwnReservationParticipant(asString(req.params.id), req.user!.id, memberUserId));
  } catch (err) { handleError(err, res, next); }
});

// Retire un joueur de sa partie (recalcule les parts).
router.delete('/:id/players/:participantId', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await reservationService.removeOwnReservationParticipant(asString(req.params.id), req.user!.id, asString(req.params.participantId)));
  } catch (err) { handleError(err, res, next); }
});
```

- [ ] **Step 3: Écrire le test de routes**

Créer `backend/src/routes/__tests__/reservations.routes.test.ts` :

```ts
import '../../__mocks__/prisma';
import '../../__mocks__/redis';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET manquant dans l environnement de test (.env)');
const token = () => jwt.sign({ id: 'u1', email: 'test@x.fr' }, process.env.JWT_SECRET!);

describe('GET /api/reservations/:id/players', () => {
  it('404 si la réservation est introuvable', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue(null);
    const res = await request(app).get('/api/reservations/res-1/players').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('RESERVATION_NOT_FOUND');
  });

  it('403 si ce n est pas le propriétaire', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue({
      id: 'res-1', userId: 'autre', resource: { attributes: {} }, participants: [],
    } as any);
    const res = await request(app).get('/api/reservations/res-1/players').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('UNAUTHORIZED');
  });
});

describe('POST /api/reservations/:id/players', () => {
  it('400 sans memberUserId', async () => {
    const res = await request(app).post('/api/reservations/res-1/players').set('Authorization', `Bearer ${token()}`).send({});
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/reservations/:id (annulation)', () => {
  it('409 CANCELLATION_TOO_LATE après le délai', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue({
      id: 'res-1', resourceId: 'court-1', userId: 'u1', status: 'CONFIRMED',
      startTime: new Date(Date.now() + 3_600_000), endTime: new Date(Date.now() + 7_200_000),
      resource: { club: { cancellationCutoffHours: 2 } },
    } as any);
    const res = await request(app).delete('/api/reservations/res-1').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('CANCELLATION_TOO_LATE');
  });
});
```

- [ ] **Step 4: Lancer le test → succès**

Run (depuis `palova/backend`) : `npm test -- reservations.routes`
Expected: PASS.

- [ ] **Step 5: Vérifier la non-régression backend complète + types**

Run (depuis `palova/backend`) : `npm test` puis `npx tsc --noEmit`
Expected: tous verts, aucune erreur de type.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/reservations.ts backend/src/routes/__tests__/reservations.routes.test.ts
git commit -m "feat(reservations): routes joueur (GET/POST/DELETE players) + mapping erreurs

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 7: Frontend `api.ts` — types & client

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Enrichir `MyReservation` (délais club, optionnels)**

Dans `frontend/lib/api.ts`, remplacer le champ `resource` de `interface MyReservation` par :

```ts
  resource: { id: string; name: string; club: { name: string; slug: string; timezone: string; playerChangeCutoffHours?: number; cancellationCutoffHours?: number } };
```

- [ ] **Step 2: Ajouter les types joueurs**

Juste après `interface MyReservation { … }`, ajouter :

```ts
export interface ReservationPlayer {
  id: string;
  userId: string;
  isOrganizer: boolean;
  firstName: string;
  lastName: string;
  share: string;
}
export interface ReservationPlayers {
  id: string;
  capacity: number;
  participants: ReservationPlayer[];
}
```

- [ ] **Step 3: Ajouter les fonctions client**

Dans l'objet `api`, juste après `cancelReservation: (…) => …,` (~ligne 97), ajouter :

```ts
  getReservationPlayers: (reservationId: string, token: string) =>
    request<ReservationPlayers>(`/api/reservations/${reservationId}/players`, {}, token),
  addReservationPlayer: (reservationId: string, memberUserId: string, token: string) =>
    request<ReservationPlayers>(`/api/reservations/${reservationId}/players`, { method: 'POST', body: JSON.stringify({ memberUserId }) }, token),
  removeReservationPlayer: (reservationId: string, participantId: string, token: string) =>
    request<ReservationPlayers>(`/api/reservations/${reservationId}/players/${participantId}`, { method: 'DELETE' }, token),
```

- [ ] **Step 4: Enrichir `ClubAdminDetail` et `UpdateClubBody`**

Dans `interface ClubAdminDetail`, après `bookingQuotas: BookingQuotas | null;` ajouter :

```ts
  playerChangeCutoffHours: number;
  cancellationCutoffHours: number;
```

Dans `export type UpdateClubBody = Partial<{ … }>`, après `bookingQuotas: BookingQuotas | null;` ajouter :

```ts
  playerChangeCutoffHours: number;
  cancellationCutoffHours: number;
```

- [ ] **Step 5: Vérifier la compilation TS**

Run (depuis `palova/frontend`) : `npx tsc --noEmit`
Expected: aucune erreur (les nouveaux champs `ClubAdminDetail` sont fournis par le backend ; ils seront consommés dans la Task 11).

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(api): types & client gestion des joueurs + délais club

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 8: Frontend — helpers purs d'ouverture des actions

**Files:**
- Create: `frontend/lib/reservations.ts`
- Test: `frontend/__tests__/reservations.test.ts`

- [ ] **Step 1: Écrire le test**

Créer `frontend/__tests__/reservations.test.ts` :

```ts
import { isPlayerChangeOpen, isCancellationOpen } from '@/lib/reservations';
import { MyReservation } from '@/lib/api';

const NOW = Date.now();
const r = (startInHours: number, cutoff: number, status: MyReservation['status'] = 'CONFIRMED'): MyReservation => ({
  id: 'r1',
  startTime: new Date(NOW + startInHours * 3_600_000).toISOString(),
  endTime: new Date(NOW + (startInHours + 1) * 3_600_000).toISOString(),
  status,
  totalPrice: '25',
  resource: { id: 'c1', name: 'Court 1', club: { name: 'Club', slug: 'club', timezone: 'Europe/Paris', playerChangeCutoffHours: cutoff, cancellationCutoffHours: cutoff } },
});

describe('isPlayerChangeOpen / isCancellationOpen', () => {
  it('ouvert quand on est avant la clôture', () => {
    expect(isPlayerChangeOpen(r(5, 2), NOW)).toBe(true);
    expect(isCancellationOpen(r(5, 2), NOW)).toBe(true);
  });
  it('fermé une fois la clôture passée', () => {
    expect(isPlayerChangeOpen(r(1, 2), NOW)).toBe(false);
    expect(isCancellationOpen(r(1, 2), NOW)).toBe(false);
  });
  it('cutoff 0 (ou absent) = ouvert jusqu au début', () => {
    expect(isPlayerChangeOpen(r(1, 0), NOW)).toBe(true);
    expect(isPlayerChangeOpen(r(-1, 0), NOW)).toBe(false); // déjà commencé
  });
  it('fermé si la réservation est annulée / non confirmée', () => {
    expect(isPlayerChangeOpen(r(5, 0, 'CANCELLED'), NOW)).toBe(false);
    expect(isCancellationOpen(r(5, 0, 'CANCELLED'), NOW)).toBe(false);
    expect(isPlayerChangeOpen(r(5, 0, 'PENDING'), NOW)).toBe(false);
  });
});
```

- [ ] **Step 2: Lancer le test → échec attendu**

Run (depuis `palova/frontend`) : `npm test -- reservations`
Expected: FAIL (module `@/lib/reservations` inexistant).

- [ ] **Step 3: Implémenter les helpers**

Créer `frontend/lib/reservations.ts` :

```ts
import { MyReservation } from './api';

/** Vrai tant qu'on est à plus de `cutoffHours` du début. cutoff 0/absent = jusqu'au début. */
function withinWindow(startTimeIso: string, cutoffHours: number | undefined, now: number): boolean {
  const deadline = new Date(startTimeIso).getTime() - Math.max(0, cutoffHours ?? 0) * 3_600_000;
  return now <= deadline;
}

/** L'organisateur peut-il encore changer les joueurs ? (résa confirmée + délai non dépassé) */
export function isPlayerChangeOpen(r: MyReservation, now: number): boolean {
  return r.status === 'CONFIRMED' && withinWindow(r.startTime, r.resource.club.playerChangeCutoffHours, now);
}

/** L'organisateur peut-il encore annuler ? (résa non annulée + délai non dépassé) */
export function isCancellationOpen(r: MyReservation, now: number): boolean {
  return r.status !== 'CANCELLED' && withinWindow(r.startTime, r.resource.club.cancellationCutoffHours, now);
}
```

- [ ] **Step 4: Lancer le test → succès**

Run (depuis `palova/frontend`) : `npm test -- reservations`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/reservations.ts frontend/__tests__/reservations.test.ts
git commit -m "feat(reservations): helpers purs d'ouverture changement/annulation

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 9: Frontend — composant `ManagePlayersModal`

**Files:**
- Create: `frontend/components/reservations/ManagePlayersModal.tsx`

- [ ] **Step 1: Créer le composant**

Créer `frontend/components/reservations/ManagePlayersModal.tsx` :

```tsx
'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, MyReservation, ReservationPlayers } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { PartnerSearch } from '@/components/tournament/PartnerSearch';

const ERR: Record<string, string> = {
  PLAYER_CHANGE_TOO_LATE: 'Trop tard pour modifier les joueurs.',
  RESERVATION_NOT_ACTIVE: "Cette réservation n'est pas modifiable.",
  TOO_MANY_PLAYERS: 'La partie est complète.',
  MEMBER_NOT_FOUND: "Ce joueur n'est pas membre du club.",
  PARTNER_DUPLICATE: 'Ce joueur est déjà dans la partie.',
  CANNOT_REMOVE_ORGANIZER: "L'organisateur ne peut pas être retiré.",
  PARTICIPANT_NOT_FOUND: 'Joueur introuvable.',
  UNAUTHORIZED: "Seul l'organisateur peut modifier cette réservation.",
};
const msg = (e: string) => ERR[e] ?? e;

export function ManagePlayersModal({ reservation, token, canEdit, onClose, onChanged }: {
  reservation: MyReservation;
  token: string;
  canEdit: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { th } = useTheme();
  const [data, setData]       = useState<ReservationPlayers | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const apply = useCallback((next: ReservationPlayers) => { setData(next); onChanged(); }, [onChanged]);

  useEffect(() => {
    let alive = true;
    api.getReservationPlayers(reservation.id, token)
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setError(msg((e as Error).message)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [reservation.id, token]);

  const add = async (memberUserId: string) => {
    setBusy(true);
    try { setError(null); apply(await api.addReservationPlayer(reservation.id, memberUserId, token)); }
    catch (e) { setError(msg((e as Error).message)); }
    finally { setBusy(false); }
  };
  const remove = async (participantId: string) => {
    setBusy(true);
    try { setError(null); apply(await api.removeReservationPlayer(reservation.id, participantId, token)); }
    catch (e) { setError(msg((e as Error).message)); }
    finally { setBusy(false); }
  };

  const participants = data?.participants ?? [];
  const organizer    = participants.find((p) => p.isOrganizer);
  const others       = participants.filter((p) => !p.isOrganizer);
  const capacity     = data?.capacity ?? 0;
  const full         = capacity > 0 && participants.length >= capacity;
  const excludeIds   = participants.map((p) => p.userId);

  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: th.surface, borderRadius: 12, padding: '11px 14px', boxShadow: `inset 0 0 0 1px ${th.line}` };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 440, background: th.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, boxShadow: '0 -8px 30px rgba(0,0,0,0.3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 22, color: th.text }}>Joueurs de la partie</span>
          <button onClick={onClose} aria-label="Fermer" style={{ border: 'none', background: 'transparent', color: th.textMute, cursor: 'pointer', fontSize: 22, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, marginBottom: 16 }}>
          {reservation.resource.name} · {reservation.resource.club.name}
          {capacity > 0 && <> · {participants.length}/{capacity} joueurs</>}
        </div>

        {error && <div style={{ marginBottom: 12, background: th.accent, color: th.onAccent, borderRadius: 12, padding: '10px 13px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>{error}</div>}

        {loading ? (
          <div style={{ padding: '24px 0', textAlign: 'center', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {organizer && (
              <div style={row}>
                <span style={{ fontFamily: th.fontUI, fontSize: 14.5, color: th.text }}>{organizer.firstName} {organizer.lastName}</span>
                <span style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute }}>Organisateur</span>
              </div>
            )}
            {others.map((p) => (
              <div key={p.id} style={row}>
                <span style={{ fontFamily: th.fontUI, fontSize: 14.5, color: th.text }}>{p.firstName} {p.lastName}</span>
                {canEdit && (
                  <button onClick={() => remove(p.id)} disabled={busy} style={{ border: `1px solid ${th.line}`, background: 'transparent', cursor: 'pointer', borderRadius: 9, padding: '4px 10px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: '#ff7a4d' }}>Retirer</button>
                )}
              </div>
            ))}

            {!canEdit ? (
              <div style={{ marginTop: 8, fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>
                La modification des joueurs est fermée pour cette réservation.
              </div>
            ) : full ? (
              <div style={{ marginTop: 8, fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>La partie est complète.</div>
            ) : (
              <div style={{ marginTop: 10 }}>
                <span style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.textMute, display: 'block', marginBottom: 7 }}>Ajouter un joueur</span>
                <PartnerSearch
                  slug={reservation.resource.club.slug}
                  token={token}
                  selected={null}
                  onSelect={(m) => add(m.id)}
                  onClear={() => {}}
                  disabled={busy}
                  excludeIds={excludeIds}
                  keepOpenOnSelect
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Vérifier la compilation TS**

Run (depuis `palova/frontend`) : `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/reservations/ManagePlayersModal.tsx
git commit -m "feat(reservations): modal de gestion des joueurs (organisateur)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 10: Frontend — câbler le modal dans la page & le calendrier

**Files:**
- Modify: `frontend/app/me/reservations/page.tsx`
- Modify: `frontend/components/calendar/DayPanel.tsx`

- [ ] **Step 1: Imports + état dans la page**

Dans `frontend/app/me/reservations/page.tsx`, après l'import de `DayPanel` (ligne 15), ajouter :

```tsx
import { ManagePlayersModal } from '@/components/reservations/ManagePlayersModal';
import { isCancellationOpen, isPlayerChangeOpen } from '@/lib/reservations';
```

Après l'état `const [cancelling, setCancelling] = useState(false);` (ligne 40), ajouter :

```tsx
  const [managePlayers, setManagePlayers] = useState<MyReservation | null>(null);
```

- [ ] **Step 2: Boutons sur les cartes « À venir » (liste)**

Dans le rendu liste, remplacer le bloc :

```tsx
                      {upcoming && (
                        <button onClick={() => setConfirmCancel(r)} style={{ marginLeft: 'auto', border: `1px solid ${th.line}`, background: 'transparent', cursor: 'pointer', borderRadius: 9, padding: '5px 11px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: '#ff7a4d' }}>Annuler</button>
                      )}
```

par :

```tsx
                      {upcoming && (
                        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                          <button onClick={() => setManagePlayers(r)} style={{ border: `1px solid ${th.line}`, background: 'transparent', cursor: 'pointer', borderRadius: 9, padding: '5px 11px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.text }}>Joueurs</button>
                          <button onClick={() => setConfirmCancel(r)} disabled={!isCancellationOpen(r, now)} style={{ border: `1px solid ${th.line}`, background: 'transparent', cursor: isCancellationOpen(r, now) ? 'pointer' : 'not-allowed', borderRadius: 9, padding: '5px 11px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: isCancellationOpen(r, now) ? '#ff7a4d' : th.textFaint }}>Annuler</button>
                        </span>
                      )}
```

- [ ] **Step 3: Passer le handler au `DayPanel`**

Dans l'appel `<DayPanel … />` (calendrier), ajouter la prop `onManagePlayers` :

```tsx
                <DayPanel
                  dayKey={selectedDay}
                  entries={byDay.get(selectedDay) ?? []}
                  onCancel={setConfirmCancel}
                  onManagePlayers={setManagePlayers}
                  onReserve={() => router.push(reserveHref)}
                  reserveLabel={slug ? 'Réserver un créneau' : 'Trouver un club'}
                />
```

- [ ] **Step 4: Rendre le modal**

Juste après le bloc `{confirmCancel && ( <ConfirmDialog … /> )}` (avant le `</Screen>` final), ajouter :

```tsx
      {managePlayers && token && (
        <ManagePlayersModal
          reservation={managePlayers}
          token={token}
          canEdit={isPlayerChangeOpen(managePlayers, now)}
          onClose={() => setManagePlayers(null)}
          onChanged={() => { if (token) load(token); }}
        />
      )}
```

- [ ] **Step 5: DayPanel — prop optionnelle + boutons**

Dans `frontend/components/calendar/DayPanel.tsx`, ajouter l'import (après la ligne `import { MyReservation } from '@/lib/api';`) :

```tsx
import { isCancellationOpen } from '@/lib/reservations';
```

Dans la signature de `DayPanel`, ajouter la prop optionnelle. Remplacer :

```tsx
export function DayPanel({
  dayKey, entries, onCancel, onReserve, reserveLabel,
}: {
  dayKey: string;
  entries: CalendarEntry[];
  onCancel: (r: MyReservation) => void;
  onReserve: () => void;
  reserveLabel: string;
}) {
```

par :

```tsx
export function DayPanel({
  dayKey, entries, onCancel, onManagePlayers, onReserve, reserveLabel,
}: {
  dayKey: string;
  entries: CalendarEntry[];
  onCancel: (r: MyReservation) => void;
  onManagePlayers?: (r: MyReservation) => void;
  onReserve: () => void;
  reserveLabel: string;
}) {
```

Dans le rendu d'une entrée `reservation`, remplacer le bloc :

```tsx
                    {!e.past && (
                      <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                        <button onClick={() => onCancel(r)}
                          style={{ border: `1px solid ${th.line}`, background: 'transparent', cursor: 'pointer', borderRadius: 9, padding: '5px 11px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: '#ff7a4d' }}>
                          Annuler
                        </button>
                      </span>
                    )}
```

par :

```tsx
                    {!e.past && (
                      <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                        {onManagePlayers && (
                          <button onClick={() => onManagePlayers(r)}
                            style={{ border: `1px solid ${th.line}`, background: 'transparent', cursor: 'pointer', borderRadius: 9, padding: '5px 11px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.text }}>
                            Joueurs
                          </button>
                        )}
                        <button onClick={() => onCancel(r)} disabled={!isCancellationOpen(r, Date.now())}
                          style={{ border: `1px solid ${th.line}`, background: 'transparent', cursor: isCancellationOpen(r, Date.now()) ? 'pointer' : 'not-allowed', borderRadius: 9, padding: '5px 11px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: isCancellationOpen(r, Date.now()) ? '#ff7a4d' : th.textFaint }}>
                          Annuler
                        </button>
                      </span>
                    )}
```

- [ ] **Step 6: Vérifier la compilation + tests frontend (et corriger les retombées)**

Run (depuis `palova/frontend`) : `npx tsc --noEmit` puis `npm test`
Expected: TS sans erreur. Les tests existants `DayPanel.test.tsx` / `MyReservationsCalendar.test.tsx` peuvent nécessiter de **mocker `@/lib/reservations`** ou d'exposer `api.getReservationPlayers` dans leurs mocks de `@/lib/api`. Corriger uniquement ces retombées (le nouveau bouton « Joueurs » n'apparaît dans le calendrier que parce que la page passe `onManagePlayers`).

- [ ] **Step 7: Commit**

```bash
git add frontend/app/me/reservations/page.tsx frontend/components/calendar/DayPanel.tsx
git commit -m "feat(reservations): bouton Joueurs + Annuler désactivé hors délai (liste & calendrier)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 11: Admin — carte de réglage des délais

**Files:**
- Modify: `frontend/app/admin/settings/page.tsx`

- [ ] **Step 1: Ajouter la carte « Délais »**

Dans `frontend/app/admin/settings/page.tsx`, juste **après** la carte « Réservation à l'avance » (le `</div>` qui ferme ce bloc `card`, avant la carte « Heures pleines / creuses »), insérer :

```tsx
      <div style={card}>
        <h2 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 20, margin: '0 0 6px', color: th.text }}>Délais (annulation & changement de joueurs)</h2>
        <p style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, margin: '0 0 16px' }}>
          Nombre d&apos;heures avant le début d&apos;une réservation au-delà duquel le joueur ne peut plus, respectivement, modifier les joueurs de sa partie ou l&apos;annuler. <strong>0 = autorisé jusqu&apos;au début.</strong>
        </p>
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}><span style={label}>Changement de joueurs (h)</span><input type="number" min={0} max={365} value={club.playerChangeCutoffHours} onChange={(e) => set('playerChangeCutoffHours', Number(e.target.value))} style={field} /></div>
          <div style={{ flex: 1 }}><span style={label}>Annulation (h)</span><input type="number" min={0} max={365} value={club.cancellationCutoffHours} onChange={(e) => set('cancellationCutoffHours', Number(e.target.value))} style={field} /></div>
        </div>
      </div>
```

- [ ] **Step 2: Inclure les champs dans le `body` de `save`**

Dans la fonction `save`, dans l'objet `body: UpdateClubBody`, après `bookingQuotas: club.bookingQuotas ?? null,` ajouter :

```tsx
        playerChangeCutoffHours: Number(club.playerChangeCutoffHours),
        cancellationCutoffHours: Number(club.cancellationCutoffHours),
```

- [ ] **Step 3: Vérifier la compilation + tests frontend**

Run (depuis `palova/frontend`) : `npx tsc --noEmit` puis `npm test`
Expected: aucun échec.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/admin/settings/page.tsx
git commit -m "feat(admin): carte de réglage des délais (annulation & changement de joueurs)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Vérification finale (end-to-end manuelle)

- [ ] **Backend complet** : depuis `palova/backend`, `npm test` (tout vert) + `npx tsc --noEmit`.
- [ ] **Frontend complet** : depuis `palova/frontend`, `npm test` (tout vert) + `npx tsc --noEmit`.
- [ ] **Migration en dev** : démarrer Docker (`docker-compose-v1.exe up -d`), depuis `palova/backend` `npx prisma migrate deploy` (ou `migrate dev`), puis `npm run dev`.
- [ ] **Parcours réel** (frontend + backend lancés, compte `test@palova.fr`) :
  - Régler les deux délais dans `/admin/settings` (ex. 2h chacun), enregistrer.
  - Sur `/me/reservations` (onglet « À venir » et « Calendrier »), ouvrir « Joueurs » sur une réservation à venir, ajouter un membre via la recherche par nom, vérifier l'apparition + l'indicateur de capacité, retirer le membre.
  - Vérifier qu'au-delà du délai le modal passe en lecture seule et que « Annuler » est désactivé ; et qu'une tentative serveur renvoie bien `PLAYER_CHANGE_TOO_LATE` / `CANCELLATION_TOO_LATE` (message FR affiché).

## Notes de portée
- Couvert par tests automatisés : services (club + reservation), routes joueur, helpers purs front. Le composant `ManagePlayersModal` et le câblage de page sont vérifiés par la compilation TS + la passe de tests existante + la vérif manuelle (pas de test RTL dédié dans ce plan — à ajouter si souhaité, en mockant `@/lib/api`).
- La notification de **retrait** d'un joueur n'est pas envoyée (seul l'ajout réutilise `notifyReservationMemberAssigned`) — conforme à la spec (hors v1).
