# Parties Amicale / Compétitive — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à l'organisateur de déclarer une partie **Amicale** ou **Compétitive** (comme Playtomic) ; seul le niveau Glicko est gaté (une amicale confirmée ne fait pas bouger le rating), tout le reste (stats, Top du mois) compte comme avant.

**Architecture:** Deux booléens additifs `Reservation.competitive` (type déclaré, défaut `true`) et `Match.competitive` (snapshot à la création du résultat). Le gate vit dans `MatchService.finalize` : une amicale passe `CONFIRMED` **sans** appliquer les ratings (`ratingsAppliedAt` reste `null`). Pour une partie ouverte (PUBLIC) le résultat **hérite** du flag de la résa (verrouillé, l'input client est ignoré) ; pour une résa privée le flag vient de la modale de saisie (défaut Compétitive).

**Tech Stack:** Prisma 7 (driver adapter pg), Express, TypeScript, Jest (backend) ; Next.js 16, React, React Testing Library (frontend).

**Spec:** `docs/superpowers/specs/2026-07-15-parties-amicale-competitive-design.md`

---

## ⚠️ Écart assumé vs spec (à connaître avant de commencer)

La spec dit « BookingModal (interrupteur ON) : deux chips ». En réalité, le flux actuel « Confirmer d'abord, organiser ensuite » a **déplacé** le choix « Partie ouverte aux membres » **après** la confirmation, dans deux composants qui appellent `setReservationVisibility` :
- `frontend/components/reservations/OpenMatchQuickSwitch.tsx` (écran de succès de `BookingModal` via `BookingSuccess`),
- `frontend/components/reservations/OpenMatchToggle.tsx` (page « Mes réservations » / calendrier).

`BookingModal.tsx` n'a plus d'interrupteur open-match ni d'appel `applyHoldSetup` de publication. **Donc : le choix Amicale/Compétitive vit dans ces deux composants** (câblé via `setReservationVisibility`), pas dans BookingModal. On ajoute quand même `competitive` à `applyHoldSetup` (Task 5) par cohérence/défense, mais ce n'est pas le chemin UI principal.

---

## File Structure

**Backend (modify):**
- `backend/prisma/schema.prisma` — 2 colonnes `competitive`
- `backend/prisma/migrations/20260715100000_add_match_competitive/migration.sql` — créer
- `backend/src/services/match.service.ts` — `CreateMatchInput`, `createFromReservation` (snapshot), `finalize` (gate)
- `backend/src/services/reservation.service.ts` — `setReservationVisibility` (+ garde), `applyHoldSetup`
- `backend/src/services/openMatch.service.ts` — `toDTO` + mapper national (exposer `competitive`)
- `backend/src/routes/reservations.ts` — `/:id/match`, `/:id/visibility`, `/:id/setup` (passthrough)
- `backend/src/routes/me.ts` — `GET /matches` expose `competitive` (Task 12)

**Backend (modify tests):**
- `backend/src/services/__tests__/match.service.test.ts`
- `backend/src/services/__tests__/reservation.service.test.ts`
- `backend/src/services/__tests__/openMatch.service.test.ts`
- `backend/src/routes/__tests__/reservations.routes.test.ts`

**Frontend (modify):**
- `frontend/lib/api.ts` — types `OpenMatch`/`MyReservation`/`MatchToRecord`, signatures `setReservationVisibility`/`applyHoldSetup`/`recordMatchResult`
- `frontend/components/reservations/OpenMatchQuickSwitch.tsx` — chips + envoi
- `frontend/components/reservations/OpenMatchToggle.tsx` — chips + envoi
- `frontend/components/openmatch/OpenMatchCard.tsx` — badge
- `frontend/components/openmatch/OpenMatches.tsx` — filtre
- `frontend/components/match/MatchResultModal.tsx` — segmented / verrou
- `frontend/components/openmatch/OpenMatchModals.tsx`, `frontend/components/match/ResultsToRecord.tsx`, `frontend/app/me/reservations/page.tsx` — passer `competitive`/`locked`
- `frontend/components/match/MyMatchesList.tsx` — puce « Amicale » sur le résultat confirmé (Task 12)

**Frontend (create/modify tests):**
- `frontend/__tests__/OpenMatchCard.test.tsx`, `OpenMatches.test.tsx`, `MatchResultModal.test.tsx`, `OpenMatchQuickSwitch.test.tsx`, `MyMatchesList.test.tsx`

---

## Task 1: Schéma + migration `add_match_competitive`

**Files:**
- Modify: `backend/prisma/schema.prisma` (model `Reservation` ~L739, model `Match` ~L588)
- Create: `backend/prisma/migrations/20260715100000_add_match_competitive/migration.sql`

- [ ] **Step 1: Ajouter la colonne au modèle `Reservation`**

Dans `backend/prisma/schema.prisma`, juste après la ligne `visibility  ReservationVisibility @default(PRIVATE) ...` (≈ L741) :

```prisma
  competitive Boolean @default(true) // Amicale (false) vs Compétitive (true) : gate le niveau du résultat
```

- [ ] **Step 2: Ajouter la colonne au modèle `Match`**

Dans le modèle `Match`, juste après `winningTeam Int? @map("winning_team")` (≈ L588) :

```prisma
  competitive      Boolean     @default(true) @map("competitive") // snapshot du type de la résa à la saisie
```

- [ ] **Step 3: Écrire le SQL de migration**

Créer `backend/prisma/migrations/20260715100000_add_match_competitive/migration.sql` :

```sql
-- add_match_competitive : type Amicale/Compétitive d'une partie (gate le niveau du résultat).
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "competitive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "competitive" BOOLEAN NOT NULL DEFAULT true;
```

- [ ] **Step 4: Appliquer en DEV puis régénérer le client**

Run (depuis `backend/`) :
```bash
node node_modules/prisma/build/index.js db execute --file prisma/migrations/20260715100000_add_match_competitive/migration.sql --schema prisma/schema.prisma
node node_modules/prisma/build/index.js generate
```
Expected: `db execute` → succès silencieux ; `generate` → `Generated Prisma Client`.
(Si les shims `npx` fonctionnent, `npx prisma db execute ...` équivaut. Ne PAS utiliser `migrate dev` — la base DEV a une dérive, cf. mémoire « Prisma: migrate deploy, not migrate dev ».)

- [ ] **Step 5: Vérifier que le client typé connaît le champ**

Run (depuis `backend/`) :
```bash
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json 2>&1 | grep -i competitive
```
Expected: aucune sortie (pas d'erreur ; le champ existe côté types).

- [ ] **Step 6: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260715100000_add_match_competitive
git commit -m "feat(db): add Reservation.competitive + Match.competitive (amicale/competitive)"
```

---

## Task 2: `createFromReservation` — snapshot du type (PUBLIC hérite, privé accepte)

**Files:**
- Modify: `backend/src/services/match.service.ts` (`CreateMatchInput` L16-20, `createFromReservation` L24-82)
- Test: `backend/src/services/__tests__/match.service.test.ts`

- [ ] **Step 1: Écrire le test d'échec**

Dans `backend/src/services/__tests__/match.service.test.ts`, ajouter un `describe` (adapter les mocks au style existant du fichier — `prismaMock.reservation.findUnique`, `prismaMock.match.findFirst`, `prismaMock.match.create`) :

```ts
describe('createFromReservation — snapshot competitive', () => {
  const baseReservation = (over: any = {}) => ({
    id: 'res-1', type: 'COURT', visibility: 'PRIVATE', competitive: true,
    startTime: new Date(Date.now() - 3600_000),
    participants: [{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }, { userId: 'u4' }],
    resource: { clubId: 'c1', clubSport: { sportId: 's1' }, club: { levelSystemEnabled: true } },
    ...over,
  });
  const input = { teams: { 1: ['u1', 'u2'], 2: ['u3', 'u4'] } as any, sets: [[6, 4]] as any, now: new Date() };

  beforeEach(() => {
    prismaMock.match.findFirst.mockResolvedValue(null);
    prismaMock.match.create.mockResolvedValue({ id: 'm1', status: 'PENDING', players: [] } as any);
  });

  it('résa PRIVÉE : honore input.competitive=false', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue(baseReservation({ visibility: 'PRIVATE', competitive: true }) as any);
    await service.createFromReservation('res-1', 'u1', { ...input, competitive: false } as any);
    expect(prismaMock.match.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ competitive: false }),
    }));
  });

  it('résa PRIVÉE sans input : défaut true', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue(baseReservation({ visibility: 'PRIVATE' }) as any);
    await service.createFromReservation('res-1', 'u1', input as any);
    expect(prismaMock.match.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ competitive: true }),
    }));
  });

  it('résa PUBLIC : hérite de la résa (input contraire IGNORÉ)', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue(baseReservation({ visibility: 'PUBLIC', competitive: false }) as any);
    await service.createFromReservation('res-1', 'u1', { ...input, competitive: true } as any);
    expect(prismaMock.match.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ competitive: false }),
    }));
  });
});
```

- [ ] **Step 2: Lancer le test → échec attendu**

Run (depuis `backend/`) :
```bash
node node_modules/jest/bin/jest.js src/services/__tests__/match.service.test.ts -t "snapshot competitive"
```
Expected: FAIL — `competitive` absent des `data` de `match.create` (les 3 cas échouent).

- [ ] **Step 3: Étendre `CreateMatchInput`**

`backend/src/services/match.service.ts`, L16-20 :

```ts
export interface CreateMatchInput {
  teams: Record<1 | 2, string[]>;
  sets: SetScore[];
  now: Date;
  competitive?: boolean; // pris en compte SEULEMENT pour une résa privée ; PUBLIC hérite de la résa
}
```

- [ ] **Step 4: Snapshot dans `createFromReservation`**

Dans `createFromReservation`, remplacer la destructuration L25 et l'objet `data` de `match.create` (L60-77). D'abord L25 :

```ts
    const { teams, sets, now } = input;
```
devient :
```ts
    const { teams, sets, now } = input;
    // PUBLIC (partie ouverte) → hérite du type déclaré, verrouillé (l'input ne peut pas
    // basculer en amicale à la saisie pour esquiver une défaite). Privé → input, défaut true.
    const competitive = reservation.visibility === 'PUBLIC'
      ? reservation.competitive
      : (input.competitive ?? true);
```
Puis dans `data:` de `prisma.match.create` (après `winningTeam: winningTeam(sets),` L68), ajouter :
```ts
        competitive,
```

- [ ] **Step 5: Lancer le test → succès**

Run (depuis `backend/`) :
```bash
node node_modules/jest/bin/jest.js src/services/__tests__/match.service.test.ts -t "snapshot competitive"
```
Expected: PASS (3/3).

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/match.service.ts backend/src/services/__tests__/match.service.test.ts
git commit -m "feat(matchs): createFromReservation snapshotte competitive (PUBLIC herite, prive accepte)"
```

---

## Task 3: `finalize` — gate du niveau sur `match.competitive`

**Files:**
- Modify: `backend/src/services/match.service.ts` (`finalize` L293-348)
- Test: `backend/src/services/__tests__/match.service.test.ts`

- [ ] **Step 1: Écrire le test d'échec**

Ajouter dans `match.service.test.ts` (mêmes helpers de tx que `describe('finalize'...)` existant ; sinon calquer sur le mock de `$transaction`) :

```ts
describe('finalize — amicale ne bouge pas le niveau', () => {
  function txMock(match: any) {
    return {
      match: { findUnique: jest.fn().mockResolvedValue(match), update: jest.fn().mockResolvedValue({}) },
      matchPlayer: { update: jest.fn().mockResolvedValue({}) },
      playerRating: { findUnique: jest.fn(), upsert: jest.fn() },
    };
  }

  it('amicale PENDING : passe CONFIRMED sans toucher playerRating ni ratingsAppliedAt', async () => {
    const tx: any = txMock({ id: 'm1', status: 'PENDING', competitive: false, ratingsAppliedAt: null, sportId: 's1', sets: [[6, 4]], players: [{ userId: 'u1', team: 1 }] });
    (prismaMock.$transaction as jest.Mock).mockImplementation((fn: any) => fn(tx));
    await service.finalize('m1');
    expect(tx.playerRating.upsert).not.toHaveBeenCalled();
    expect(tx.matchPlayer.update).not.toHaveBeenCalled();
    expect(tx.match.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { status: 'CONFIRMED' } });
  });

  it('amicale DÉJÀ CONFIRMED : idempotent (aucune écriture)', async () => {
    const tx: any = txMock({ id: 'm1', status: 'CONFIRMED', competitive: false, ratingsAppliedAt: null, sportId: 's1', sets: [[6, 4]], players: [{ userId: 'u1', team: 1 }] });
    (prismaMock.$transaction as jest.Mock).mockImplementation((fn: any) => fn(tx));
    await service.finalize('m1');
    expect(tx.match.update).not.toHaveBeenCalled();
    expect(tx.playerRating.upsert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Lancer le test → échec attendu**

Run (depuis `backend/`) :
```bash
node node_modules/jest/bin/jest.js src/services/__tests__/match.service.test.ts -t "amicale ne bouge"
```
Expected: FAIL — `finalize` applique les ratings (upsert appelé) car le gate n'existe pas.

- [ ] **Step 3: Ajouter le gate dans `finalize`**

`backend/src/services/match.service.ts`, juste après la ligne `if (match.status === 'CANCELLED') return;` (L301) :

```ts
      // Amicale : on confirme le résultat mais on n'applique JAMAIS le niveau.
      // ratingsAppliedAt reste null → voidMatch ne recalculera rien. Idempotent.
      if (!match.competitive) {
        if (match.status !== 'CONFIRMED') {
          await tx.match.update({ where: { id: matchId }, data: { status: 'CONFIRMED' } });
        }
        return;
      }
```

(Le `findUnique` de `finalize` utilise `include`, donc `match.competitive` est chargé automatiquement — aucun `select` à modifier.)

- [ ] **Step 4: Lancer le test → succès**

Run (depuis `backend/`) :
```bash
node node_modules/jest/bin/jest.js src/services/__tests__/match.service.test.ts -t "amicale ne bouge"
```
Expected: PASS (2/2).

- [ ] **Step 5: Lancer toute la suite match.service → non-régression**

Run (depuis `backend/`) :
```bash
node node_modules/jest/bin/jest.js src/services/__tests__/match.service.test.ts
```
Expected: PASS (toute la suite, y compris les cas compétitifs existants).

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/match.service.ts backend/src/services/__tests__/match.service.test.ts
git commit -m "feat(matchs): finalize gate le niveau sur competitive (amicale = CONFIRMED sans rating)"
```

---

## Task 4: `setReservationVisibility` — accepte `competitive` + garde `MATCH_ALREADY_RECORDED`

**Files:**
- Modify: `backend/src/services/reservation.service.ts` (`setReservationVisibility` L1627-1661)
- Test: `backend/src/services/__tests__/reservation.service.test.ts`

- [ ] **Step 1: Écrire les tests d'échec**

Dans `reservation.service.test.ts`, ajouter (adapter les mocks au style du fichier — `prismaMock.reservation.findUnique/update`, `prismaMock.match.findFirst`) :

```ts
describe('setReservationVisibility — competitive', () => {
  const future = () => new Date(Date.now() + 48 * 3600_000);
  const resa = (over: any = {}) => ({
    id: 'res-1', userId: 'u1', status: 'CONFIRMED', startTime: future(), competitive: true,
    resource: { clubSport: { sport: { key: 'padel' } } }, ...over,
  });

  it('transmet competitive=false à update', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue(resa() as any);
    prismaMock.match.findFirst.mockResolvedValue(null);
    prismaMock.reservation.update.mockResolvedValue({ id: 'res-1', visibility: 'PUBLIC', targetLevelMin: null, targetLevelMax: null, competitive: false } as any);
    await service.setReservationVisibility('res-1', 'u1', { visibility: 'PUBLIC', competitive: false });
    expect(prismaMock.reservation.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ competitive: false }),
    }));
  });

  it('refuse le changement de type si un résultat existe déjà', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue(resa({ competitive: true }) as any);
    prismaMock.match.findFirst.mockResolvedValue({ id: 'm1' } as any); // match non annulé
    await expect(service.setReservationVisibility('res-1', 'u1', { visibility: 'PUBLIC', competitive: false }))
      .rejects.toThrow('MATCH_ALREADY_RECORDED');
  });

  it('autorise un appel qui ne change PAS competitive même avec un résultat', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue(resa({ competitive: true }) as any);
    prismaMock.match.findFirst.mockResolvedValue({ id: 'm1' } as any);
    prismaMock.reservation.update.mockResolvedValue({ id: 'res-1', visibility: 'PUBLIC', targetLevelMin: null, targetLevelMax: null, competitive: true } as any);
    await expect(service.setReservationVisibility('res-1', 'u1', { visibility: 'PUBLIC', competitive: true }))
      .resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Lancer les tests → échec attendu**

Run (depuis `backend/`) :
```bash
node node_modules/jest/bin/jest.js src/services/__tests__/reservation.service.test.ts -t "setReservationVisibility — competitive"
```
Expected: FAIL — `competitive` non transmis, garde absente.

- [ ] **Step 3: Étendre la signature + la garde + l'update**

`backend/src/services/reservation.service.ts`, `setReservationVisibility`.

Signature (L1627-1631) :
```ts
  async setReservationVisibility(
    reservationId: string,
    userId: string,
    input: { visibility: 'PRIVATE' | 'PUBLIC'; targetLevelMin?: number | null; targetLevelMax?: number | null; competitive?: boolean },
  ) {
```

Le `findUnique` (L1632-1635) utilise déjà `include`, donc `reservation.competitive` est disponible. Après le check `RESERVATION_IN_PAST` (L1639), ajouter la garde :
```ts
    // Changer le type Amicale/Compétitive après qu'un résultat a été saisi fausserait
    // l'audit : refusé s'il diffère ET qu'un match non annulé existe déjà.
    if (input.competitive !== undefined && input.competitive !== reservation.competitive) {
      const recorded = await prisma.match.findFirst({
        where: { reservationId, status: { not: 'CANCELLED' } },
        select: { id: true },
      });
      if (recorded) throw new Error('MATCH_ALREADY_RECORDED');
    }
```

Dans le `data:` de `prisma.reservation.update` (L1649-1653), ajouter après `targetLevelMax: ...` :
```ts
        competitive: input.competitive ?? reservation.competitive,
```
et ajouter `competitive: true` au `select:` (L1654) :
```ts
      select: { id: true, visibility: true, targetLevelMin: true, targetLevelMax: true, competitive: true },
```

- [ ] **Step 4: Lancer les tests → succès**

Run (depuis `backend/`) :
```bash
node node_modules/jest/bin/jest.js src/services/__tests__/reservation.service.test.ts -t "setReservationVisibility — competitive"
```
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/reservation.service.ts backend/src/services/__tests__/reservation.service.test.ts
git commit -m "feat(reservations): setReservationVisibility accepte competitive + garde MATCH_ALREADY_RECORDED"
```

---

## Task 5: `applyHoldSetup` — accepte `competitive` (additif, défense)

**Files:**
- Modify: `backend/src/services/reservation.service.ts` (`applyHoldSetup` L329-407)
- Test: `backend/src/services/__tests__/reservation.service.test.ts`

- [ ] **Step 1: Écrire le test d'échec**

```ts
describe('applyHoldSetup — competitive', () => {
  it('transmet competitive à update', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue({
      id: 'res-1', userId: 'u1', status: 'PENDING', createdAt: new Date(), totalPrice: 20,
      resource: { clubId: 'c1', attributes: { format: 'double' }, clubSport: { sport: { key: 'padel' } } },
    } as any);
    prismaMock.clubMembership.findMany.mockResolvedValue([] as any);
    const tx: any = {
      reservationParticipant: { deleteMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
      reservation: { update: jest.fn().mockResolvedValue({ id: 'res-1' }) },
    };
    (prismaMock.$transaction as jest.Mock).mockImplementation((fn: any) => fn(tx));
    await service.applyHoldSetup('res-1', 'u1', { visibility: 'PUBLIC', competitive: false });
    expect(tx.reservation.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ competitive: false }),
    }));
  });
});
```

- [ ] **Step 2: Lancer le test → échec attendu**

Run (depuis `backend/`) :
```bash
node node_modules/jest/bin/jest.js src/services/__tests__/reservation.service.test.ts -t "applyHoldSetup — competitive"
```
Expected: FAIL — `competitive` non transmis.

- [ ] **Step 3: Étendre la signature + l'update**

`backend/src/services/reservation.service.ts`, `applyHoldSetup`. Ajouter à l'objet `setup` (L332-339) :
```ts
      competitive?: boolean;
```
Dans le `tx.reservation.update` (L398-405), ajouter au `data:` après les `targetLevel*` :
```ts
          competitive: setup.competitive ?? undefined,
```
(`undefined` = ne pas toucher la colonne si non fourni ; défaut DB `true` s'applique à la création.)

- [ ] **Step 4: Lancer le test → succès**

Run (depuis `backend/`) :
```bash
node node_modules/jest/bin/jest.js src/services/__tests__/reservation.service.test.ts -t "applyHoldSetup — competitive"
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/reservation.service.ts backend/src/services/__tests__/reservation.service.test.ts
git commit -m "feat(reservations): applyHoldSetup accepte competitive (additif)"
```

---

## Task 6: Exposer `competitive` dans les DTO + routes

**Files:**
- Modify: `backend/src/services/openMatch.service.ts` (`toDTO` L110-139, mapper national L210-226)
- Modify: `backend/src/services/reservation.service.ts` (`listUserReservations` map ~L1694, `listToRecord` non concerné — voir note)
- Modify: `backend/src/routes/reservations.ts` (`/:id/match` L239-245, `/:id/visibility` L171-195, `/:id/setup` L130-166)
- Test: `backend/src/services/__tests__/openMatch.service.test.ts`, `backend/src/routes/__tests__/reservations.routes.test.ts`

- [ ] **Step 1: Écrire le test d'échec DTO**

Dans `openMatch.service.test.ts`, dans la suite qui teste `listOpenMatches`/`getOpenMatch`, ajouter une assertion sur un cas existant (ou nouveau) : le DTO contient `competitive`. Exemple minimal en s'appuyant sur le harnais du fichier (adapter le mock `prismaMock.reservation.findMany` pour renvoyer `competitive: false` sur la résa) :

```ts
it('expose competitive dans le DTO', async () => {
  // ... setup club ACTIVE + 1 réservation PUBLIC padel avec competitive: false ...
  const res = await service.listOpenMatches('padel-arena-paris', null);
  expect(res[0]).toHaveProperty('competitive', false);
});
```

- [ ] **Step 2: Lancer → échec attendu**

Run (depuis `backend/`) :
```bash
node node_modules/jest/bin/jest.js src/services/__tests__/openMatch.service.test.ts -t "competitive"
```
Expected: FAIL — `competitive` absent du DTO.

- [ ] **Step 3: Ajouter `competitive` au DTO `toDTO`**

`backend/src/services/openMatch.service.ts`. Le `MATCH_INCLUDE` et `NATIONAL_INCLUDE` utilisent `include` au niveau réservation → `m.competitive` est déjà chargé (aucun `select` à changer). Dans `toDTO` (objet retourné L110-139), ajouter après `targetLevelMax: m.targetLevelMax ?? null,` (L122) :
```ts
      competitive: m.competitive,
```
Dans le mapper national (objet L210-226), ajouter après `targetLevelMax: m.targetLevelMax ?? null,` (L220) :
```ts
          competitive: m.competitive,
```

- [ ] **Step 4: Lancer → succès**

Run (depuis `backend/`) :
```bash
node node_modules/jest/bin/jest.js src/services/__tests__/openMatch.service.test.ts -t "competitive"
```
Expected: PASS.

- [ ] **Step 5: Exposer `competitive` sur `listUserReservations` (calendrier / MatchResultModal privé)**

`backend/src/services/reservation.service.ts`, `listUserReservations`. Le `findMany` (L1665) utilise `include` → `rest.competitive` est présent. Le map final `return { ...rest, ... }` (L1694) propage donc `competitive` automatiquement — **vérifier** qu'il n'est pas exclu par une destructuration. Il ne l'est pas (`const { participants, resource, ...rest } = row`), donc rien à faire ici, mais **noter** dans le type frontend (Task 7) que `MyReservation.competitive` arrive.

Note `listToRecord` (`match.service.ts` L89-133) : utilise un `select` explicite. Pour que `ResultsToRecord` sache verrouiller, ajouter `competitive: true` et `visibility: true` au `select` (L100-114) et les propager dans le `.map` de sortie. Ajouter au `select` racine :
```ts
        competitive: true, visibility: true,
```
et à l'objet retourné par le `.map` (chercher le `return {` dans le map, y ajouter) :
```ts
          competitive: r.competitive,
          visibility: r.visibility,
```

- [ ] **Step 6: Écrire le test route `/:id/match` (passthrough competitive)**

Dans `reservations.routes.test.ts`, ajouter un cas dans le `describe('POST /api/reservations/:id/match'...)` (ou créer) mockant `matchService.createFromReservation` :

```ts
it('transmet competitive au service', async () => {
  const spy = jest.spyOn(MatchService.prototype, 'createFromReservation').mockResolvedValue({ id: 'm1', status: 'PENDING' } as any);
  await request(app).post('/api/reservations/res-1/match').set('Authorization', `Bearer ${token}`)
    .send({ teams: { 1: ['u1', 'u2'], 2: ['u3', 'u4'] }, sets: [[6, 4]], competitive: false });
  expect(spy).toHaveBeenCalledWith('res-1', expect.any(String), expect.objectContaining({ competitive: false }));
  spy.mockRestore();
});
```

- [ ] **Step 7: Lancer → échec attendu**

Run (depuis `backend/`) :
```bash
node node_modules/jest/bin/jest.js src/routes/__tests__/reservations.routes.test.ts -t "transmet competitive au service"
```
Expected: FAIL — la route ne lit pas `competitive` du body.

- [ ] **Step 8: Câbler les routes**

`backend/src/routes/reservations.ts`.

`/:id/match` (L241-242) :
```ts
    const { teams, sets, competitive } = req.body;
    const match = await matchService.createFromReservation(asString(req.params.id), req.user!.id, { teams, sets, competitive, now: new Date() });
```

`/:id/visibility` (L173, L190-194) — lire `competitive` du body et le passer :
```ts
    const { visibility, targetLevelMin, targetLevelMax, competitive } = req.body ?? {};
```
puis dans l'appel `setReservationVisibility(...)`, ajouter :
```ts
      competitive: typeof competitive === 'boolean' ? competitive : undefined,
```

`/:id/setup` (L132, L155-161) — idem :
```ts
    const { partnerUserIds, visibility, targetLevelMin, targetLevelMax, teams, slots, competitive } = req.body ?? {};
```
puis dans l'appel `applyHoldSetup(...)`, ajouter :
```ts
      competitive: typeof competitive === 'boolean' ? competitive : undefined,
```

- [ ] **Step 9: Lancer → succès + non-régression routes**

Run (depuis `backend/`) :
```bash
node node_modules/jest/bin/jest.js src/routes/__tests__/reservations.routes.test.ts
```
Expected: PASS (nouveau cas + tous les existants).

- [ ] **Step 10: Type-check backend complet**

Run (depuis `backend/`) :
```bash
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
```
Expected: aucune erreur.

- [ ] **Step 11: Commit**

```bash
git add backend/src/services/openMatch.service.ts backend/src/services/reservation.service.ts backend/src/services/match.service.ts backend/src/routes/reservations.ts backend/src/services/__tests__/openMatch.service.test.ts backend/src/routes/__tests__/reservations.routes.test.ts
git commit -m "feat(matchs): expose competitive dans les DTO + passthrough routes match/visibility/setup"
```

---

## Task 7: Frontend — types & signatures `lib/api.ts`

**Files:**
- Modify: `frontend/lib/api.ts` (`recordMatchResult` L119-120, `applyHoldSetup` L167-182, `setReservationVisibility` L263-273, `MyReservation` L1155-1167, `OpenMatch` L1521-1539, `MatchToRecord`, `NationalOpenMatch` L2211+)

- [ ] **Step 1: Étendre les types de payload**

`OpenMatch` (après `targetLevelMax?` L1533) :
```ts
  competitive?: boolean; // Amicale (false) / Compétitive (true) ; défaut true si absent
```
`MyReservation` (après `targetLevelMax?` L1165) :
```ts
  competitive?: boolean;
```
`NationalOpenMatch` (après `targetLevelMax` L2216) :
```ts
  competitive?: boolean;
```
`MatchToRecord` — repérer l'interface (elle porte `reservationId`, `players`, `visibility?`) et ajouter :
```ts
  competitive?: boolean;
  visibility?: 'PRIVATE' | 'PUBLIC';
```
(si `visibility` y est déjà, n'ajouter que `competitive`.)

- [ ] **Step 2: Étendre les signatures de méthodes**

`recordMatchResult` (L119-120) :
```ts
  recordMatchResult: (reservationId: string, body: { teams: Record<1 | 2, string[]>; sets: [number, number][]; competitive?: boolean }, token: string) =>
    request<{ id: string; status: string }>(`/api/reservations/${reservationId}/match`, { method: 'POST', body: JSON.stringify(body) }, token),
```
`applyHoldSetup` `setup` (L170-177) — ajouter :
```ts
      competitive?: boolean;
```
`setReservationVisibility` `opts` (L267) :
```ts
    opts?: { targetLevelMin?: number | null; targetLevelMax?: number | null; competitive?: boolean },
```
et le type de retour (L269) — ajouter `competitive: boolean` :
```ts
    request<{ id: string; visibility: 'PRIVATE' | 'PUBLIC'; targetLevelMin: number | null; targetLevelMax: number | null; competitive: boolean }>(
```

- [ ] **Step 3: Type-check frontend**

Run (depuis `frontend/`) :
```bash
node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep -E "api\.ts|competitive"
```
Expected: aucune sortie (les callers existants restent valides car tout est optionnel).

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(front): types competitive sur OpenMatch/MyReservation/MatchToRecord + signatures API"
```

---

## Task 8: Frontend — chips Amicale/Compétitive dans les deux switches

**Files:**
- Modify: `frontend/components/reservations/OpenMatchQuickSwitch.tsx`, `frontend/components/reservations/OpenMatchToggle.tsx`
- Test: `frontend/__tests__/OpenMatchQuickSwitch.test.tsx`

Design des chips (identique dans les deux) : deux boutons segmentés sous le bloc niveau, rendus **seulement quand la partie est/va être ouverte**. `Compétitive` (accent) sous-texte « Le résultat compte pour le niveau » ; `Amicale` (neutre) sous-texte « Juste pour le plaisir — le niveau ne bouge pas ». État local `competitive` (défaut `reservation.competitive ?? true`), envoyé dans chaque `setReservationVisibility('PUBLIC', ...)`.

- [ ] **Step 1: Écrire le test d'échec (OpenMatchQuickSwitch)**

Dans `frontend/__tests__/OpenMatchQuickSwitch.test.tsx` (créer si absent, calquer le mock `api` sur les tests voisins), ajouter :

```tsx
it('publie une partie AMICALE avec competitive=false', async () => {
  const setVis = jest.fn().mockResolvedValue({});
  (api.setReservationVisibility as jest.Mock) = setVis;
  render(<ThemeProvider><OpenMatchQuickSwitch
    reservation={{ id: 'r1', visibility: 'PRIVATE', competitive: true, status: 'CONFIRMED',
      startTime: new Date(Date.now() + 3600_000).toISOString(),
      resource: { sport: { key: 'padel' } }, participants: [], capacity: 4 } as any}
    token="t" onChanged={() => {}} /></ThemeProvider>);
  fireEvent.click(screen.getByRole('switch', { name: 'Partie ouverte aux membres' }));
  fireEvent.click(screen.getByRole('button', { name: /Amicale/ }));
  await waitFor(() => expect(setVis).toHaveBeenCalled());
  const lastCall = setVis.mock.calls.at(-1)!;
  expect(lastCall[3]).toEqual(expect.objectContaining({ competitive: false }));
});
```

- [ ] **Step 2: Lancer → échec attendu**

Run (depuis `frontend/`) :
```bash
node node_modules/jest/bin/jest.js __tests__/OpenMatchQuickSwitch.test.tsx -t "AMICALE"
```
Expected: FAIL — pas de bouton « Amicale », `competitive` non transmis.

- [ ] **Step 3: Ajouter l'état + les chips dans OpenMatchQuickSwitch**

`frontend/components/reservations/OpenMatchQuickSwitch.tsx`.

Ajouter l'état après `const [levelMax, setLevelMax] = useState(5);` (L42) :
```ts
  const [competitive, setCompetitive] = useState(reservation.competitive ?? true);
```

Ajouter `competitive` à TOUS les appels `api.setReservationVisibility(reservation.id, 'PUBLIC', token, {...})` (dans l'effet de republication L80-83 et dans `toggle` L101-104) — dans chaque objet `opts`, ajouter :
```ts
      competitive,
```

Rendre le segmenté quand `openMatch` est vrai (dans le bloc `openMatch && ...`, après le bloc niveau, avant la fermeture) — placer juste avant le `{error && ...}` final. La partie est déjà ouverte à ce stade, donc chaque clic **republie en direct** (comme le fait déjà l'ajustement de niveau) :
```tsx
      {openMatch && isPadel && (
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          {([['competitive', 'Compétitive', 'Le résultat compte pour le niveau'],
             ['friendly', 'Amicale', 'Le niveau ne bouge pas']] as const).map(([key, label, sub]) => {
            const active = (key === 'competitive') === competitive;
            return (
              <button key={key} type="button" disabled={busy}
                onClick={() => {
                  const next = key === 'competitive';
                  setCompetitive(next);
                  setBusy(true); setError(null);
                  api.setReservationVisibility(reservation.id, 'PUBLIC', token, {
                    targetLevelMin: levelForSport && levelLimited ? levelMin : null,
                    targetLevelMax: levelForSport && levelLimited ? levelMax : null,
                    competitive: next,
                  }).then(() => onChanged()).catch((e) => setError(msg((e as Error).message))).finally(() => setBusy(false));
                }}
                style={{ flex: 1, textAlign: 'left', cursor: busy ? 'not-allowed' : 'pointer', borderRadius: 12,
                  padding: '9px 12px', border: `1.5px solid ${active ? th.accent : th.line}`,
                  background: active ? `${th.accent}14` : 'transparent' }}>
                <div style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, color: active ? th.accent : th.text }}>{label}</div>
                <div style={{ fontFamily: th.fontUI, fontSize: 10.5, color: th.textFaint, marginTop: 2, lineHeight: 1.3 }}>{sub}</div>
              </button>
            );
          })}
        </div>
      )}
```

- [ ] **Step 4: Lancer → succès (OpenMatchQuickSwitch)**

Run (depuis `frontend/`) :
```bash
node node_modules/jest/bin/jest.js __tests__/OpenMatchQuickSwitch.test.tsx -t "AMICALE"
```
Expected: PASS.

- [ ] **Step 5: Répliquer dans OpenMatchToggle**

`frontend/components/reservations/OpenMatchToggle.tsx`. Ajouter l'état après `const [lmax, setLmax] = useState(6);` (L31) :
```ts
  const [competitive, setCompetitive] = useState(reservation.competitive ?? true);
```
Dans `publish()` (L61-69), ajouter `competitive` à l'objet `opts` de `setReservationVisibility` :
```ts
    return api.setReservationVisibility(
      reservation.id, 'PUBLIC', token,
      { competitive, ...(limit ? { targetLevelMin: lmin, targetLevelMax: lmax } : { targetLevelMin: null, targetLevelMax: null }) },
    );
```
Dans la feuille dépliée (bloc `sheet` L100-121), sous le bloc niveau et avant les boutons Publier/Annuler, ajouter le même segmenté (réutiliser le JSX de Step 3, version sans republication en direct — ici on ne publie qu'au clic « Publier ») :
```tsx
          <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
            {([['competitive', 'Compétitive', 'Compte pour le niveau'],
               ['friendly', 'Amicale', 'Le niveau ne bouge pas']] as const).map(([key, label, sub]) => {
              const active = (key === 'competitive') === competitive;
              return (
                <button key={key} type="button" onClick={() => setCompetitive(key === 'competitive')} disabled={busy}
                  style={{ flex: 1, textAlign: 'left', cursor: 'pointer', borderRadius: 12, padding: '9px 12px',
                    border: `1.5px solid ${active ? th.accent : th.line}`, background: active ? `${th.accent}14` : 'transparent' }}>
                  <div style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, color: active ? th.accent : th.text }}>{label}</div>
                  <div style={{ fontFamily: th.fontUI, fontSize: 10.5, color: th.textFaint, marginTop: 2 }}>{sub}</div>
                </button>
              );
            })}
          </div>
```

- [ ] **Step 6: Type-check + non-régression des deux suites**

Run (depuis `frontend/`) :
```bash
node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep -E "OpenMatchQuickSwitch|OpenMatchToggle"
node node_modules/jest/bin/jest.js __tests__/OpenMatchQuickSwitch.test.tsx
```
Expected: pas d'erreur tsc ; suite verte.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/reservations/OpenMatchQuickSwitch.tsx frontend/components/reservations/OpenMatchToggle.tsx frontend/__tests__/OpenMatchQuickSwitch.test.tsx
git commit -m "feat(front): chips Amicale/Competitive a la publication d'une partie ouverte"
```

---

## Task 9: Frontend — badge Amicale/Compétitive sur `OpenMatchCard`

**Files:**
- Modify: `frontend/components/openmatch/OpenMatchCard.tsx` (rangée de chips L92-97)
- Test: `frontend/__tests__/OpenMatchCard.test.tsx`

- [ ] **Step 1: Écrire le test d'échec**

Dans `frontend/__tests__/OpenMatchCard.test.tsx`, ajouter :
```tsx
it('affiche le badge Amicale', () => {
  renderCard({ competitive: false }); // helper existant du fichier ; sinon render direct
  expect(screen.getByText('Amicale')).toBeInTheDocument();
});
it('affiche le badge Compétitive', () => {
  renderCard({ competitive: true });
  expect(screen.getByText('Compétitive')).toBeInTheDocument();
});
```
(Si le fichier n'a pas de helper `renderCard`, calquer sur un test existant qui rend `<OpenMatchCard m={...} />` et surcharger `competitive`.)

- [ ] **Step 2: Lancer → échec attendu**

Run (depuis `frontend/`) :
```bash
node node_modules/jest/bin/jest.js __tests__/OpenMatchCard.test.tsx -t "badge"
```
Expected: FAIL — badge absent.

- [ ] **Step 3: Ajouter le badge**

`frontend/components/openmatch/OpenMatchCard.tsx`, dans la rangée de chips (après le bloc niveau L94-96) :
```tsx
        {m.competitive === false
          ? <Chip tone="line">Amicale</Chip>
          : <Chip tone="accent">Compétitive</Chip>}
```
(`competitive === false` explicite : un DTO ancien sans le champ affiche « Compétitive », le défaut.)

- [ ] **Step 4: Lancer → succès + non-régression**

Run (depuis `frontend/`) :
```bash
node node_modules/jest/bin/jest.js __tests__/OpenMatchCard.test.tsx
```
Expected: PASS (nouveaux + existants).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/openmatch/OpenMatchCard.tsx frontend/__tests__/OpenMatchCard.test.tsx
git commit -m "feat(front): badge Amicale/Competitive sur la carte de partie ouverte"
```

---

## Task 10: Frontend — filtre `Toutes | Compétitives | Amicales` sur `/parties`

**Files:**
- Modify: `frontend/components/openmatch/OpenMatches.tsx` (état filtre ~L112-164, rangée `FilterChip` ~L199-202)
- Test: `frontend/__tests__/OpenMatches.test.tsx`

- [ ] **Step 1: Écrire le test d'échec**

Dans `frontend/__tests__/OpenMatches.test.tsx`, ajouter un cas : deux parties (une `competitive:true`, une `competitive:false`), cliquer « Amicales » ne laisse que l'amicale.
```tsx
it('filtre les parties amicales', async () => {
  // getOpenMatches mock renvoie [{id:'a', competitive:true,...}, {id:'b', competitive:false,...}]
  // ... render OpenMatches ...
  fireEvent.click(await screen.findByRole('button', { name: 'Amicales' }));
  // la carte 'a' (compétitive) disparaît, 'b' reste
});
```
(Adapter aux helpers du fichier : mock `api.getOpenMatches`, `renderMatches`, sélecteurs de carte existants.)

- [ ] **Step 2: Lancer → échec attendu**

Run (depuis `frontend/`) :
```bash
node node_modules/jest/bin/jest.js __tests__/OpenMatches.test.tsx -t "amicales"
```
Expected: FAIL — pas de chip « Amicales ».

- [ ] **Step 3: Ajouter l'état + le filtre + les chips**

`frontend/components/openmatch/OpenMatches.tsx`.

État (près de `filterTouchedRef` L112) :
```ts
  const [kindFilter, setKindFilter] = useState<'all' | 'competitive' | 'friendly'>('all');
```
Appliquer le filtre APRÈS le filtre de niveau. À l'endroit où `filtered` est calculé (L156-158), envelopper :
```ts
  const byLevel = levelFilterActive
    ? matches.filter((m) => rangesOverlap(m.targetLevelMin ?? null, m.targetLevelMax ?? null, fMin, fMax))
    : matches;
  const filtered = kindFilter === 'all'
    ? byLevel
    : byLevel.filter((m) => (m.competitive === false) === (kindFilter === 'friendly'));
```
(Remplacer l'ancienne affectation de `filtered`.)

Chips (dans la rangée `FilterChip` L199-202, après « Tous ») :
```tsx
                  <FilterChip label="Toutes" active={kindFilter === 'all'} onClick={() => setKindFilter('all')} />
                  <FilterChip label="Compétitives" active={kindFilter === 'competitive'} onClick={() => setKindFilter('competitive')} />
                  <FilterChip label="Amicales" active={kindFilter === 'friendly'} onClick={() => setKindFilter('friendly')} />
```
(Placer ces 3 chips à côté des chips niveau existantes ; réutiliser le composant `FilterChip` déjà présent.)

- [ ] **Step 4: Lancer → succès + non-régression**

Run (depuis `frontend/`) :
```bash
node node_modules/jest/bin/jest.js __tests__/OpenMatches.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/openmatch/OpenMatches.tsx frontend/__tests__/OpenMatches.test.tsx
git commit -m "feat(front): filtre Toutes/Competitives/Amicales sur /parties"
```

---

## Task 11: Frontend — `MatchResultModal` segmenté (privé) / verrouillé (public) + callers

**Files:**
- Modify: `frontend/components/match/MatchResultModal.tsx` (Props L12-20, corps L31+, submit L73)
- Modify: `frontend/components/openmatch/OpenMatchModals.tsx` (L19-25), `frontend/components/match/ResultsToRecord.tsx` (L63-65), `frontend/app/me/reservations/page.tsx` (L287-289)
- Test: `frontend/__tests__/MatchResultModal.test.tsx`

- [ ] **Step 1: Écrire les tests d'échec**

Dans `frontend/__tests__/MatchResultModal.test.tsx`, ajouter :
```tsx
it('résa privée : segmented par défaut Compétitive, envoie competitive au submit', async () => {
  render(<ThemeProvider><MatchResultModal reservationId="r1" players={players} token="t"
    onClose={() => {}} onSaved={() => {}} initialTeams={fullTeams} /></ThemeProvider>);
  fireEvent.click(screen.getByRole('button', { name: /Amicale/ }));
  for (let i = 0; i < 4; i++) fireEvent.click(screen.getByTestId('set0-team2-plus'));
  fireEvent.click(screen.getByText('Enregistrer'));
  await waitFor(() => expect(api.recordMatchResult).toHaveBeenCalled());
  const call = (api.recordMatchResult as jest.Mock).mock.calls.at(-1)!;
  expect(call[1].competitive).toBe(false);
});

it('partie ouverte (locked) : badge statique, pas de bouton de bascule', () => {
  render(<ThemeProvider><MatchResultModal reservationId="r1" players={players} token="t"
    onClose={() => {}} onSaved={() => {}} initialTeams={fullTeams} locked competitive={false} /></ThemeProvider>);
  expect(screen.getByText(/Partie amicale/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Compétitive/ })).not.toBeInTheDocument();
});
```
(`players`/`fullTeams` sont déjà définis en tête du fichier de test.)

- [ ] **Step 2: Lancer → échec attendu**

Run (depuis `frontend/`) :
```bash
node node_modules/jest/bin/jest.js __tests__/MatchResultModal.test.tsx -t "competitive|locked|amicale"
```
Expected: FAIL — pas de segmented, `competitive` non envoyé.

- [ ] **Step 3: Étendre les Props + l'état + le rendu + le submit**

`frontend/components/match/MatchResultModal.tsx`.

Props (L12-20) — ajouter :
```ts
  competitive?: boolean; // valeur initiale (privé) OU type déclaré (public, verrouillé)
  locked?: boolean;      // true = partie ouverte : type hérité, non modifiable ici
```
Signature (L31) — ajouter `competitive, locked` à la destructuration.

État (après `const [team, ...] = useState(...)` L33) :
```ts
  const [competitiveState, setCompetitiveState] = useState(competitive ?? true);
```

Submit (L73) — passer le flag :
```ts
      await api.recordMatchResult(reservationId, { teams: { 1: t1, 2: t2 }, sets, competitive: competitiveState }, token);
```

Rendu — insérer avant les boutons Annuler/Enregistrer (repérer le bloc `sets`/actions). Deux cas :
```tsx
      {locked ? (
        <div style={{ margin: '12px 0', fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute }}>
          {competitiveState ? 'Partie compétitive — le résultat compte pour le niveau.' : 'Partie amicale — le niveau ne bouge pas.'}
        </div>
      ) : (
        <div style={{ margin: '12px 0', display: 'flex', gap: 8 }}>
          {([['competitive', 'Compétitive', 'Compte pour le niveau'],
             ['friendly', 'Amicale', 'Le niveau ne bouge pas']] as const).map(([key, label, sub]) => {
            const active = (key === 'competitive') === competitiveState;
            return (
              <button key={key} type="button" onClick={() => setCompetitiveState(key === 'competitive')} disabled={busy}
                style={{ flex: 1, textAlign: 'left', cursor: 'pointer', borderRadius: 12, padding: '9px 12px',
                  border: `1.5px solid ${active ? th.accent : th.line}`, background: active ? `${th.accent}14` : 'transparent' }}>
                <div style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, color: active ? th.accent : th.text }}>{label}</div>
                <div style={{ fontFamily: th.fontUI, fontSize: 10.5, color: th.textFaint, marginTop: 2 }}>{sub}</div>
              </button>
            );
          })}
        </div>
      )}
```

- [ ] **Step 4: Câbler les 3 callers**

`frontend/components/openmatch/OpenMatchModals.tsx` (L19-25) — une partie ouverte est TOUJOURS verrouillée :
```tsx
        <MatchResultModal
          reservationId={a.recordingFor.id}
          players={...}
          locked
          competitive={a.recordingFor.competitive ?? true}
          ...
```
`frontend/components/match/ResultsToRecord.tsx` (L63-65) — dépend de la visibilité de la ligne :
```tsx
        <MatchResultModal
          reservationId={recordingFor.reservationId}
          players={...}
          locked={recordingFor.visibility === 'PUBLIC'}
          competitive={recordingFor.competitive ?? true}
          ...
```
`frontend/app/me/reservations/page.tsx` (L287-289) :
```tsx
        <MatchResultModal
          reservationId={recordingFor.id}
          players={recordingFor.participants ?? []}
          locked={recordingFor.visibility === 'PUBLIC'}
          competitive={recordingFor.competitive ?? true}
          ...
```

- [ ] **Step 5: Lancer → succès + non-régression MatchResultModal**

Run (depuis `frontend/`) :
```bash
node node_modules/jest/bin/jest.js __tests__/MatchResultModal.test.tsx
```
Expected: PASS (nouveaux + existants — les tests existants ne passent ni `locked` ni `competitive`, donc segmented visible, défaut Compétitive, submit inchangé côté teams/sets).

- [ ] **Step 6: Type-check frontend complet**

Run (depuis `frontend/`) :
```bash
node node_modules/typescript/bin/tsc --noEmit 2>&1 | grep -E "MatchResultModal|OpenMatchModals|ResultsToRecord|reservations/page"
```
Expected: aucune sortie.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/match/MatchResultModal.tsx frontend/components/openmatch/OpenMatchModals.tsx frontend/components/match/ResultsToRecord.tsx frontend/app/me/reservations/page.tsx frontend/__tests__/MatchResultModal.test.tsx
git commit -m "feat(front): MatchResultModal segmente (prive) / verrouille (partie ouverte)"
```

---

## Task 12: `MyMatchesList` — mention « Amicale » sur le résultat confirmé

But : qu'un joueur qui a confirmé une amicale comprenne, dans son historique, pourquoi son niveau n'a pas bougé (exigence spec « personne ne cherche pourquoi sa courbe n'a pas bougé »).

**Files:**
- Modify: `backend/src/routes/me.ts` (`GET /matches` select L264-266 + map L277-289)
- Modify: `frontend/lib/api.ts` (interface `MyMatch`)
- Modify: `frontend/components/match/MyMatchesList.tsx` (rangée d'en-tête du résultat ~L96-107)
- Test: `backend/src/routes/__tests__/me.routes.test.ts`, `frontend/__tests__/MyMatchesList.test.tsx`

- [ ] **Step 1: Test backend d'échec (route expose competitive)**

Dans `me.routes.test.ts`, dans `describe('GET /api/me/matches'...)`, étendre le mock `prismaMock.matchPlayer.findMany` pour que `match` porte `competitive: false`, et asserter :
```ts
expect(res.body[0]).toHaveProperty('competitive', false);
```

- [ ] **Step 2: Lancer → échec**

Run (depuis `backend/`) :
```bash
node node_modules/jest/bin/jest.js src/routes/__tests__/me.routes.test.ts -t "matches"
```
Expected: FAIL — `competitive` absent de la réponse.

- [ ] **Step 3: Exposer `competitive` dans la route**

`backend/src/routes/me.ts`. Au `select` du `match` (L265), ajouter `competitive: true` :
```ts
            id: true, status: true, sets: true, playedAt: true, winningTeam: true, competitive: true,
```
Dans l'objet mappé (après `winningTeam: r.match.winningTeam,` L278) :
```ts
      competitive: r.match.competitive,
```

- [ ] **Step 4: Lancer → succès backend**

Run (depuis `backend/`) :
```bash
node node_modules/jest/bin/jest.js src/routes/__tests__/me.routes.test.ts -t "matches"
```
Expected: PASS.

- [ ] **Step 5: Type + test frontend d'échec**

`frontend/lib/api.ts` : ajouter à l'interface `MyMatch` :
```ts
  competitive?: boolean;
```
Dans `frontend/__tests__/MyMatchesList.test.tsx`, ajouter un cas : un match `CONFIRMED` `competitive:false` affiche « Amicale » ; un `competitive:true` ne l'affiche pas.
```tsx
it('marque un résultat amical', () => {
  renderList([{ ...baseMatch, status: 'CONFIRMED', competitive: false }]); // helper/fixture du fichier
  expect(screen.getByText('Amicale')).toBeInTheDocument();
});
```

- [ ] **Step 6: Lancer → échec**

Run (depuis `frontend/`) :
```bash
node node_modules/jest/bin/jest.js __tests__/MyMatchesList.test.tsx -t "amical"
```
Expected: FAIL — pas de mention « Amicale ».

- [ ] **Step 7: Ajouter la puce dans MyMatchesList**

`frontend/components/match/MyMatchesList.tsx`, dans la rangée qui affiche le libellé de résultat (près de la pastille `result` L96-107), ajouter à côté, quand `m.competitive === false` :
```tsx
                {m.competitive === false && (
                  <span style={{ fontFamily: th.fontUI, fontSize: 11, fontWeight: 600, color: th.textMute,
                    background: th.surface2, borderRadius: 8, padding: '2px 8px' }}>Amicale</span>
                )}
```
(Placer dans le conteneur de l'en-tête de carte, à côté de la pastille Victoire/Défaite.)

- [ ] **Step 8: Lancer → succès + non-régression**

Run (depuis `frontend/`) :
```bash
node node_modules/jest/bin/jest.js __tests__/MyMatchesList.test.tsx
```
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/src/routes/me.ts backend/src/routes/__tests__/me.routes.test.ts frontend/lib/api.ts frontend/components/match/MyMatchesList.tsx frontend/__tests__/MyMatchesList.test.tsx
git commit -m "feat(matchs): mention Amicale sur le resultat confirme (historique joueur)"
```

---

## Task 13: Vérification finale + documentation

**Files:**
- Modify: `CLAUDE.md` (nouvelle sous-section sous « Chat de partie ouverte » ou « À implémenter »)

- [ ] **Step 1: Suites backend ciblées (non-régression complète du périmètre)**

Run (depuis `backend/`) :
```bash
node node_modules/jest/bin/jest.js src/services/__tests__/match.service.test.ts src/services/__tests__/reservation.service.test.ts src/services/__tests__/openMatch.service.test.ts src/routes/__tests__/reservations.routes.test.ts src/routes/__tests__/me.routes.test.ts
```
Expected: toutes vertes.

- [ ] **Step 2: Suites frontend ciblées**

Run (depuis `frontend/`) :
```bash
node node_modules/jest/bin/jest.js __tests__/MatchResultModal.test.tsx __tests__/OpenMatchCard.test.tsx __tests__/OpenMatches.test.tsx __tests__/OpenMatchQuickSwitch.test.tsx __tests__/MyMatchesList.test.tsx
```
Expected: toutes vertes.

- [ ] **Step 3: Type-check complet des deux côtés**

Run :
```bash
cd backend && node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
cd ../frontend && node node_modules/typescript/bin/tsc --noEmit
```
Expected: aucune erreur.

- [ ] **Step 4: Vérification visuelle (skill verify)**

Vérifier `/parties` (badges Amicale/Compétitive + filtre) et l'écran de succès de réservation (chips) en clair et sombre, mobile 390 + desktop 1280. Publier une partie amicale de bout en bout et confirmer qu'aucun débordement horizontal n'apparaît.

- [ ] **Step 5: Documenter dans CLAUDE.md**

Ajouter une sous-section « Parties Amicale / Compétitive (v1) ✅ implémenté » résumant : les 2 colonnes additives, le gate dans `finalize`, l'héritage verrouillé PUBLIC, le choix privé dans la modale, le badge, le filtre, la garde `MATCH_ALREADY_RECORDED`, et les fichiers de tests. Lien vers spec + plan.

- [ ] **Step 6: Commit final**

```bash
git add CLAUDE.md
git commit -m "docs(matchs): documente les parties Amicale/Competitive dans CLAUDE.md"
```

---

## Notes d'exécution

- **Branche** : le travail continue sur `feat/alertes-parties-ouvertes` (branche courante) sauf demande contraire d'Eric. La base a des conflits `UU` non résolus au départ (WIP parallèle) — ne committer QUE les fichiers listés par tâche (jamais `git add -A`), cf. mémoire « Concurrent branch-switching hazard ».
- **Shims cassés** : utiliser `node node_modules/jest/bin/jest.js` et `node node_modules/typescript/bin/tsc` (cf. mémoire « Broken node_modules/.bin shims »). PowerShell réinitialise le cwd entre commandes.
- **jest ≠ type-check** : ts-jest tolère des types faux ; le vrai garde est `tsc --noEmit` (cf. mémoire « Frontend jest doesn't type-check »).
- **Après le changement de schéma** : si le backend dev tourne, redémarrer (`start.ps1`) pour recharger le client Prisma régénéré (cf. mémoire « Stale backend → new routes 404 »).
