# Parties ouvertes genrées (Féminine / Mixte) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à un organisateur de créer une partie ouverte padel **Féminine** ou **Mixte** (1H+1F par équipe), avec blocage dur à l'inscription, badge sur les cartes et filtre sur `/parties`.

**Architecture :** Colonne nullable `Reservation.matchGender` (`null` = ouverte à tous). Deux helpers **purs** dans `matchTeams.ts` (`assertOpenMatchGender` pour un join unitaire, `assertRosterGender` pour valider un ensemble à la création/ouverture), branchés dans tous les chemins qui ajoutent/déplacent un joueur (join, ajout organisateur, réorg d'équipes, `applyHoldSetup`, `setReservationVisibility`). Front : sélecteur 3 chips partagé (`GenderPicker`), badge sur `OpenMatchCard`, dimension de filtre Genre dans `MatchesFilterBar` (client-side).

**Tech Stack :** Prisma 7 (driver adapter), Express, Jest (backend), Next.js 16 + React Testing Library (frontend).

**Spec :** `docs/superpowers/specs/2026-07-21-parties-ouvertes-genrees-design.md`

---

## Rappels d'environnement (lire avant de commencer)

- **Tests backend ciblés :** `cd backend && node node_modules/jest/bin/jest.js <chemin> --runInBand` (les shims `npx` peuvent être cassés — cf. mémoire *broken-node-modules-bin-shims*).
- **Tests frontend ciblés :** `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath <chemin>` (`--runTestsByPath` pour éviter que Jest attrape des fichiers voisins par motif).
- **Type-check :** jest frontend ne type-check pas (`isolatedModules`) → `cd frontend && node node_modules/typescript/bin/tsc --noEmit` en garde séparée. Idem backend : `cd backend && node node_modules/typescript/bin/tsc --noEmit`.
- **Migration Prisma :** base DEV dérivée → **ne pas** utiliser `migrate dev`/`db push`. Écrire le SQL additif à la main et l'appliquer via `prisma db execute`, puis `prisma generate` (cf. mémoire *prisma-migrate-deploy-not-dev*). Après `prisma generate`, le backend en cours peut garder l'ancien client (500 « Unknown field ») → `touch backend/src/app.ts` pour forcer le reload.
- **Répondre/commenter en français.**

---

## File Structure

**Backend**
- `backend/prisma/schema.prisma` — enum `OpenMatchGender` + colonne `Reservation.matchGender`.
- `backend/prisma/migrations/20260721180000_add_open_match_gender/migration.sql` — migration additive.
- `backend/src/services/matchTeams.ts` — helpers purs `assertOpenMatchGender` + `assertRosterGender`.
- `backend/src/services/openMatch.service.ts` — enforcement join / add / setTeams + champ `gender` dans les DTO.
- `backend/src/services/reservation.service.ts` — `applyHoldSetup` + `setReservationVisibility` (matchGender).
- `backend/src/routes/reservations.ts` — passthrough + validation de `matchGender` sur `/setup` et `/visibility`.

**Frontend**
- `frontend/lib/api.ts` — types (`OpenMatch.gender`, `NationalOpenMatch.gender`) + signatures `matchGender?`.
- `frontend/components/reservations/GenderPicker.tsx` — sélecteur 3 chips partagé (nouveau).
- `frontend/components/reservations/OpenMatchToggle.tsx` — câblage sélecteur.
- `frontend/components/reservations/OpenMatchQuickSwitch.tsx` — câblage sélecteur.
- `frontend/components/openmatch/OpenMatchCard.tsx` — badge.
- `frontend/components/openmatch/OpenMatchDetail.tsx` — badge (fiche).
- `frontend/components/openmatch/MatchesFilterBar.tsx` — groupe de filtre Genre.
- `frontend/components/openmatch/OpenMatches.tsx` — état `genderFilter` + filtrage.
- `frontend/components/openmatch/useOpenMatchActions.ts` — messages d'erreur `GENDER_*`.
- `frontend/components/platform/NationalOpenMatches.tsx` + `frontend/components/clubhouse/OpenMatchesShowcase.tsx` — badge.

---

## Task 1: Schéma + migration `matchGender`

**Files:**
- Modify: `backend/prisma/schema.prisma` (enum + colonne, cf. `enum Sex` L96 et `model Reservation` L804-816)
- Create: `backend/prisma/migrations/20260721180000_add_open_match_gender/migration.sql`

- [ ] **Step 1: Ajouter l'enum et la colonne au schéma**

Dans `backend/prisma/schema.prisma`, après le bloc `enum Sex { MALE FEMALE }` (L96-99), ajouter :

```prisma
enum OpenMatchGender {
  WOMEN
  MIXED
}
```

Dans `model Reservation`, juste après `targetLevelMax Float? @map("target_level_max")` (L816), ajouter :

```prisma
  // Genre d'une partie ouverte (visibility PUBLIC, padel). null = ouverte à tous.
  matchGender    OpenMatchGender? @map("match_gender")
```

- [ ] **Step 2: Écrire la migration SQL additive**

`backend/prisma/migrations/20260721180000_add_open_match_gender/migration.sql` :

```sql
-- Genre des parties ouvertes (Féminine / Mixte). Additif, null = ouverte à tous.
CREATE TYPE "OpenMatchGender" AS ENUM ('WOMEN', 'MIXED');
ALTER TABLE "reservations" ADD COLUMN "match_gender" "OpenMatchGender";
```

- [ ] **Step 3: Appliquer en DEV + régénérer le client**

Run (depuis `backend/`) :
```bash
node node_modules/prisma/build/index.js db execute --file prisma/migrations/20260721180000_add_open_match_gender/migration.sql --schema prisma/schema.prisma
node node_modules/prisma/build/index.js generate
```
Expected: `db execute` OK, `generate` régénère `@prisma/client` avec `matchGender` et `OpenMatchGender`.
Si le backend tourne : `touch src/app.ts` (reload du client).

- [ ] **Step 4: Vérifier la compilation des types Prisma**

Run: `cd backend && node node_modules/typescript/bin/tsc --noEmit`
Expected: PASS (aucune erreur ; `Prisma.OpenMatchGender` et `reservation.matchGender` reconnus).

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260721180000_add_open_match_gender/
git commit -m "feat(open-match): schema matchGender (feminine/mixte)"
```

---

## Task 2: Helpers purs de validation de genre

**Files:**
- Modify: `backend/src/services/matchTeams.ts` (ajout en fin de fichier, après `applyTeams` L100)
- Test: `backend/src/services/__tests__/matchTeams.test.ts` (fichier existant — ajouter un `describe`)

- [ ] **Step 1: Écrire les tests des deux helpers**

Ajouter à `backend/src/services/__tests__/matchTeams.test.ts` :

```typescript
import { assertOpenMatchGender, assertRosterGender } from '../matchTeams';

describe('assertOpenMatchGender (join unitaire)', () => {
  it('null = aucune contrainte', () => {
    expect(() => assertOpenMatchGender(null, null, 3)).not.toThrow();
  });
  it('WOMEN : femme OK, homme refusé, sexe manquant refusé', () => {
    expect(() => assertOpenMatchGender('WOMEN', 'FEMALE', 0)).not.toThrow();
    expect(() => assertOpenMatchGender('WOMEN', 'MALE', 0)).toThrow('GENDER_NOT_FEMALE');
    expect(() => assertOpenMatchGender('WOMEN', null, 0)).toThrow('SEX_REQUIRED');
  });
  it('MIXED : sexe requis ; côté saturé pour ce sexe refusé', () => {
    expect(() => assertOpenMatchGender('MIXED', null, 0)).toThrow('SEX_REQUIRED');
    expect(() => assertOpenMatchGender('MIXED', 'MALE', 0)).not.toThrow();
    expect(() => assertOpenMatchGender('MIXED', 'MALE', 1)).toThrow('GENDER_TEAM_FULL');
  });
});

describe('assertRosterGender (création / ouverture)', () => {
  it('null = aucune contrainte', () => {
    expect(() => assertRosterGender(null, [{ sex: 'MALE', team: 1 }])).not.toThrow();
  });
  it('WOMEN : roster 100% féminin OK, un homme refusé', () => {
    expect(() => assertRosterGender('WOMEN', [{ sex: 'FEMALE', team: 1 }, { sex: 'FEMALE', team: 2 }])).not.toThrow();
    expect(() => assertRosterGender('WOMEN', [{ sex: 'MALE', team: 1 }])).toThrow('GENDER_PARTICIPANTS_CONFLICT');
  });
  it('WOMEN : sexe manquant refusé', () => {
    expect(() => assertRosterGender('WOMEN', [{ sex: null, team: 1 }])).toThrow('GENDER_PARTICIPANTS_CONFLICT');
  });
  it('MIXED : 1H+1F par équipe OK, 2H sur une équipe refusé', () => {
    expect(() => assertRosterGender('MIXED', [
      { sex: 'MALE', team: 1 }, { sex: 'FEMALE', team: 1 },
      { sex: 'MALE', team: 2 }, { sex: 'FEMALE', team: 2 },
    ])).not.toThrow();
    expect(() => assertRosterGender('MIXED', [
      { sex: 'MALE', team: 1 }, { sex: 'MALE', team: 1 },
    ])).toThrow('GENDER_PARTICIPANTS_CONFLICT');
  });
});
```

- [ ] **Step 2: Lancer les tests → échec attendu**

Run: `cd backend && node node_modules/jest/bin/jest.js src/services/__tests__/matchTeams.test.ts --runInBand`
Expected: FAIL (`assertOpenMatchGender is not a function`).

- [ ] **Step 3: Implémenter les helpers**

Ajouter à la fin de `backend/src/services/matchTeams.ts` :

```typescript
export type OpenMatchGenderValue = 'WOMEN' | 'MIXED';
type Sx = 'MALE' | 'FEMALE' | null | undefined;

// Validation d'UN joueur qui rejoint une partie ouverte genrée.
// `sameSexOnTargetTeam` = nb de joueurs déjà présents du MÊME sexe, sur l'équipe visée
// (mixte seulement ; passer 0 pour WOMEN). Pur.
export function assertOpenMatchGender(
  matchGender: OpenMatchGenderValue | null,
  newSex: Sx,
  sameSexOnTargetTeam: number,
): void {
  if (matchGender == null) return;
  if (!newSex) throw new Error('SEX_REQUIRED');
  if (matchGender === 'WOMEN') {
    if (newSex !== 'FEMALE') throw new Error('GENDER_NOT_FEMALE');
    return;
  }
  // MIXED : au plus 1 joueur de chaque sexe par équipe.
  if (sameSexOnTargetTeam >= 1) throw new Error('GENDER_TEAM_FULL');
}

// Validation d'un ENSEMBLE de participants (avec leur équipe effective) contre un genre —
// à la création (applyHoldSetup) et à l'ouverture (setReservationVisibility). Toute
// violation (sexe manquant, sexe interdit, 2 mêmes sexes sur une équipe mixte) →
// GENDER_PARTICIPANTS_CONFLICT. Pur.
export function assertRosterGender(
  matchGender: OpenMatchGenderValue | null,
  roster: Array<{ sex: Sx; team: 1 | 2 }>,
): void {
  if (matchGender == null) return;
  for (const p of roster) {
    if (!p.sex) throw new Error('GENDER_PARTICIPANTS_CONFLICT');
    if (matchGender === 'WOMEN' && p.sex !== 'FEMALE') throw new Error('GENDER_PARTICIPANTS_CONFLICT');
  }
  if (matchGender === 'MIXED') {
    for (const team of [1, 2] as const) {
      const side = roster.filter((p) => p.team === team);
      const males = side.filter((p) => p.sex === 'MALE').length;
      const females = side.filter((p) => p.sex === 'FEMALE').length;
      if (males > 1 || females > 1) throw new Error('GENDER_PARTICIPANTS_CONFLICT');
    }
  }
}
```

- [ ] **Step 4: Lancer les tests → succès attendu**

Run: `cd backend && node node_modules/jest/bin/jest.js src/services/__tests__/matchTeams.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/matchTeams.ts backend/src/services/__tests__/matchTeams.test.ts
git commit -m "feat(open-match): helpers purs de validation de genre"
```

---

## Task 3: Enforcement dans `joinOpenMatch`

**Files:**
- Modify: `backend/src/services/openMatch.service.ts` (`joinOpenMatch` L271-326)
- Test: `backend/src/services/__tests__/openMatch.service.test.ts`

- [ ] **Step 1: Écrire les tests de join genré**

Ajouter à `openMatch.service.test.ts` un `describe('join genré', ...)`. S'inspirer des mocks de join existants (recherche `joinOpenMatch` dans le fichier). Cas :

```typescript
// Helper local de ce describe : monte les mocks d'un join sur une résa PUBLIC padel.
// (Adapter aux mocks du fichier : ensureActiveMembership, serializableTx, $queryRaw, resource.findUnique.)
it('WOMEN : un homme est refusé (GENDER_NOT_FEMALE)', async () => {
  // matchGender = 'WOMEN' via reservation.findUnique ; joiner.sex = 'MALE'
  await expect(service.joinOpenMatch('padel-arena-paris', 'r1', 'u-male'))
    .rejects.toThrow('GENDER_NOT_FEMALE');
});
it('WOMEN : une femme rejoint', async () => {
  await expect(service.joinOpenMatch('padel-arena-paris', 'r1', 'u-female')).resolves.toEqual({ id: 'r1' });
});
it('MIXED : un 2e homme sur la même équipe est refusé (GENDER_TEAM_FULL)', async () => {
  // Équipe 1 contient déjà un homme ; le joiner (homme) cible l'équipe 1
  await expect(service.joinOpenMatch('padel-arena-paris', 'r1', 'u-male2', { team: 1 }))
    .rejects.toThrow('GENDER_TEAM_FULL');
});
it('MIXED sans cible : un homme est placé sur une équipe compatible', async () => {
  // Équipe 1 = 1 homme, équipe 2 vide → placement équipe 2
  await service.joinOpenMatch('padel-arena-paris', 'r1', 'u-male2');
  const created = (prismaMock.reservationParticipant.create as jest.Mock).mock.calls[0][0].data;
  expect(created.team).toBe(2);
});
it('matchGender null : comportement inchangé (join sans contrainte)', async () => {
  await expect(service.joinOpenMatch('padel-arena-paris', 'r1', 'u-male')).resolves.toEqual({ id: 'r1' });
});
```

> Note : le fichier mocke Prisma requête par requête. Pour ces cas, mocker `prismaMock.reservation.findUnique` (matchGender) et faire en sorte que la requête `reservationParticipant.findMany` du join renvoie les participants **avec leur `user.sex`** (nouveau `select`).

- [ ] **Step 2: Lancer → échec attendu**

Run: `cd backend && node node_modules/jest/bin/jest.js src/services/__tests__/openMatch.service.test.ts --runInBand -t "genré"`
Expected: FAIL.

- [ ] **Step 3: Implémenter l'enforcement dans `joinOpenMatch`**

Dans `openMatch.service.ts`, importer les helpers en tête (à côté de `effectiveTeams, applyTeams`) :

```typescript
import { effectiveTeams, applyTeams, assertOpenMatchGender } from './matchTeams';
```

Dans `joinOpenMatch`, la requête `parts` doit charger le sexe (ligne ~292) :

```typescript
      const parts = await tx.reservationParticipant.findMany({
        where: { reservationId },
        orderBy: { joinedAt: 'asc' },
        select: { id: true, userId: true, isOrganizer: true, team: true, slot: true, user: { select: { sex: true } } },
      });
```

Après le bloc `if (parts.length >= maxPlayers)` / `ALREADY_JOINED` (L297-298), et **avant** le bloc `if (target)` existant (L302), charger le genre + le sexe du joueur :

```typescript
      const meta = await tx.reservation.findUnique({ where: { id: reservationId }, select: { matchGender: true } });
      const matchGender = meta?.matchGender ?? null;
      const half = Math.max(1, Math.floor(maxPlayers / 2));

      let genderPlacement: { team: number; slot: number | null } | undefined;
      if (matchGender) {
        const joiner = await tx.user.findUnique({ where: { id: userId }, select: { sex: true } });
        const joinerSex = joiner?.sex ?? null;
        const layout = effectiveTeams(parts, maxPlayers);
        const sexOf = (uid: string) => parts.find((p) => p.userId === uid)?.user?.sex ?? null;
        if (matchGender === 'WOMEN') {
          assertOpenMatchGender('WOMEN', joinerSex, 0);
        } else {
          // MIXED : équipe cible = celle demandée sinon la 1re compatible (place libre + pas
          // de joueur du même sexe). Sans compatible → GENDER_TEAM_FULL.
          let team = (target?.team === 1 || target?.team === 2) ? target.team : null;
          if (team == null) {
            for (const t of [1, 2] as const) {
              const onSide = layout.filter((p) => p.team === t);
              if (onSide.length < half && !onSide.some((p) => sexOf(p.userId) === joinerSex)) { team = t; break; }
            }
            if (team == null) throw new Error('GENDER_TEAM_FULL');
            genderPlacement = { team, slot: null };
          }
          const sameSex = layout.filter((p) => p.team === team && sexOf(p.userId) === joinerSex).length;
          assertOpenMatchGender('MIXED', joinerSex, sameSex);
        }
      }
```

Remplacer la construction du participant (L302-314) pour qu'elle prenne en compte `genderPlacement` quand aucune cible explicite n'a été fournie :

```typescript
      // Place explicite (tap sur une case libre) — validée contre le layout effectif.
      let placement: { team: number; slot: number | null } | undefined = genderPlacement;
      if (target) {
        if (target.team !== 1 && target.team !== 2) throw new Error('TEAM_INVALID');
        if (target.slot !== undefined && (!Number.isInteger(target.slot) || target.slot < 0 || target.slot >= half)) throw new Error('TEAM_INVALID');
        const layout = effectiveTeams(parts, maxPlayers);
        if (layout.filter((p) => p.team === target.team).length >= half) throw new Error('TEAM_SIDE_FULL');
        if (target.slot !== undefined && layout.some((p) => p.team === target.team && p.slot === target.slot)) throw new Error('TEAM_SLOT_TAKEN');
        placement = { team: target.team, slot: target.slot ?? null };
      }

      const created = await tx.reservationParticipant.create({
        data: { reservationId, userId, isOrganizer: false, share: new Prisma.Decimal(0), ...(placement ?? {}) },
      });
```

> La déclaration `const half` d'origine (dans l'ancien bloc `if (target)`) est supprimée puisqu'elle est désormais calculée plus haut.

- [ ] **Step 4: Lancer → succès attendu**

Run: `cd backend && node node_modules/jest/bin/jest.js src/services/__tests__/openMatch.service.test.ts --runInBand`
Expected: PASS (les cas de join existants restent verts).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/openMatch.service.ts backend/src/services/__tests__/openMatch.service.test.ts
git commit -m "feat(open-match): blocage genre a l'inscription (join)"
```

---

## Task 4: Enforcement dans `addOpenMatchPlayer`

**Files:**
- Modify: `backend/src/services/openMatch.service.ts` (`addOpenMatchPlayer` L379-425)
- Test: `backend/src/services/__tests__/openMatch.service.test.ts`

- [ ] **Step 1: Écrire les tests**

```typescript
describe('addOpenMatchPlayer genré', () => {
  it('WOMEN : ajout d’un homme refusé', async () => {
    await expect(service.addOpenMatchPlayer('padel-arena-paris', 'r1', 'org', 'u-male'))
      .rejects.toThrow('GENDER_NOT_FEMALE');
  });
  it('MIXED : ajout d’un 2e homme (aucune équipe compatible) refusé', async () => {
    await expect(service.addOpenMatchPlayer('padel-arena-paris', 'r1', 'org', 'u-male2'))
      .rejects.toThrow('GENDER_TEAM_FULL');
  });
});
```

- [ ] **Step 2: Lancer → échec attendu**

Run: `cd backend && node node_modules/jest/bin/jest.js src/services/__tests__/openMatch.service.test.ts --runInBand -t "addOpenMatchPlayer genré"`
Expected: FAIL.

- [ ] **Step 3: Implémenter**

Dans `addOpenMatchPlayer`, charger le sexe dans `parts` (L397-400) :

```typescript
      const parts = await tx.reservationParticipant.findMany({
        where: { reservationId },
        select: { id: true, userId: true, isOrganizer: true, team: true, slot: true, user: { select: { sex: true } } },
      });
```

Après le contrôle `ALREADY_JOINED` / `MATCH_FULL` (L411-413), ajouter la validation genre + placement (miroir du join) :

```typescript
      const meta = await tx.reservation.findUnique({ where: { id: reservationId }, select: { matchGender: true } });
      const matchGender = meta?.matchGender ?? null;
      let genderPlacement: { team: number; slot: number | null } | undefined;
      if (matchGender) {
        const targetUser = await tx.user.findUnique({ where: { id: targetUserId }, select: { sex: true } });
        const targetSex = targetUser?.sex ?? null;
        const half = Math.max(1, Math.floor(maxPlayers / 2));
        const layout = effectiveTeams(parts, maxPlayers);
        const sexOf = (uid: string) => parts.find((p) => p.userId === uid)?.user?.sex ?? null;
        if (matchGender === 'WOMEN') {
          assertOpenMatchGender('WOMEN', targetSex, 0);
        } else {
          let team: 1 | 2 | null = null;
          for (const t of [1, 2] as const) {
            const onSide = layout.filter((p) => p.team === t);
            if (onSide.length < half && !onSide.some((p) => sexOf(p.userId) === targetSex)) { team = t; break; }
          }
          if (team == null) throw new Error('GENDER_TEAM_FULL');
          assertOpenMatchGender('MIXED', targetSex, 0);
          genderPlacement = { team, slot: null };
        }
      }
```

Et intégrer `genderPlacement` à la création (L415-417) :

```typescript
      const created = await tx.reservationParticipant.create({
        data: { reservationId, userId: targetUserId, isOrganizer: false, share: new Prisma.Decimal(0), ...(genderPlacement ?? {}) },
      });
```

- [ ] **Step 4: Lancer → succès attendu**

Run: `cd backend && node node_modules/jest/bin/jest.js src/services/__tests__/openMatch.service.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/openMatch.service.ts backend/src/services/__tests__/openMatch.service.test.ts
git commit -m "feat(open-match): blocage genre a l'ajout organisateur"
```

---

## Task 5: Enforcement dans `setTeams` (réorg mixte)

**Files:**
- Modify: `backend/src/services/openMatch.service.ts` (`setTeams` L428-445)
- Test: `backend/src/services/__tests__/openMatch.service.test.ts`

- [ ] **Step 1: Écrire le test**

```typescript
describe('setTeams genré (mixte)', () => {
  it('refuse un layout mettant 2 hommes sur la même équipe (GENDER_TEAM_FULL)', async () => {
    // matchGender = 'MIXED' ; participants : 2 hommes + 2 femmes
    // teams = { homme1: 1, homme2: 1, femme1: 2, femme2: 2 } → équipe 1 = 2 hommes
    await expect(service.setTeams('padel-arena-paris', 'r1', 'org',
      { homme1: 1, homme2: 1, femme1: 2, femme2: 2 })).rejects.toThrow('GENDER_TEAM_FULL');
  });
  it('accepte 1H+1F par équipe', async () => {
    await expect(service.setTeams('padel-arena-paris', 'r1', 'org',
      { homme1: 1, femme1: 1, homme2: 2, femme2: 2 })).resolves.toEqual({ id: 'r1' });
  });
});
```

- [ ] **Step 2: Lancer → échec attendu**

Run: `cd backend && node node_modules/jest/bin/jest.js src/services/__tests__/openMatch.service.test.ts --runInBand -t "setTeams genré"`
Expected: FAIL.

- [ ] **Step 3: Implémenter**

Dans `setTeams`, charger le sexe des participants et le genre, valider avant `applyTeams` (L438-442) :

```typescript
      const parts = await tx.reservationParticipant.findMany({ where: { reservationId }, select: { userId: true, isOrganizer: true, user: { select: { sex: true } } } });
      const actor = parts.find((p) => p.userId === organizerUserId);
      if (!actor || !actor.isOrganizer) throw new Error('NOT_ORGANIZER');
      const maxPlayers = playerCount((resource.attributes as { format?: string } | null)?.format);

      const meta = await tx.reservation.findUnique({ where: { id: reservationId }, select: { matchGender: true } });
      if (meta?.matchGender === 'MIXED') {
        for (const t of [1, 2] as const) {
          const side = parts.filter((p) => teams[p.userId] === t);
          const males = side.filter((p) => p.user?.sex === 'MALE').length;
          const females = side.filter((p) => p.user?.sex === 'FEMALE').length;
          if (males > 1 || females > 1) throw new Error('GENDER_TEAM_FULL');
        }
      }

      await applyTeams(tx, reservationId, teams, maxPlayers, slots);
```

> Pour WOMEN, aucune contrainte d'équipe (tous déjà femmes) → pas de check ici.

- [ ] **Step 4: Lancer → succès attendu**

Run: `cd backend && node node_modules/jest/bin/jest.js src/services/__tests__/openMatch.service.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/openMatch.service.ts backend/src/services/__tests__/openMatch.service.test.ts
git commit -m "feat(open-match): reorg d'equipes respecte la mixite"
```

---

## Task 6: `applyHoldSetup` — poser + valider le genre à la création

**Files:**
- Modify: `backend/src/services/reservation.service.ts` (`applyHoldSetup` L336-416)
- Test: `backend/src/services/__tests__/reservation.service.test.ts`

- [ ] **Step 1: Écrire les tests**

```typescript
describe('applyHoldSetup genré', () => {
  it('écrit matchGender quand PUBLIC + padel', async () => {
    // organisateur FEMALE, setup { visibility:'PUBLIC', matchGender:'WOMEN' }
    await service.applyHoldSetup('r1', 'u-female', { visibility: 'PUBLIC', matchGender: 'WOMEN' });
    const upd = (prismaMock.reservation.update as jest.Mock).mock.calls.at(-1)![0];
    expect(upd.data.matchGender).toBe('WOMEN');
  });
  it('Féminine : organisateur homme refusé (GENDER_PARTICIPANTS_CONFLICT)', async () => {
    await expect(service.applyHoldSetup('r1', 'u-male', { visibility: 'PUBLIC', matchGender: 'WOMEN' }))
      .rejects.toThrow('GENDER_PARTICIPANTS_CONFLICT');
  });
  it('PRIVATE : matchGender forcé à null', async () => {
    await service.applyHoldSetup('r1', 'u-male', { visibility: 'PRIVATE', matchGender: 'WOMEN' });
    const upd = (prismaMock.reservation.update as jest.Mock).mock.calls.at(-1)![0];
    expect(upd.data.matchGender).toBeNull();
  });
});
```

- [ ] **Step 2: Lancer → échec attendu**

Run: `cd backend && node node_modules/jest/bin/jest.js src/services/__tests__/reservation.service.test.ts --runInBand -t "applyHoldSetup genré"`
Expected: FAIL.

- [ ] **Step 3: Implémenter**

Importer le helper en tête de `reservation.service.ts` (à côté de `effectiveTeams, applyTeams`) :

```typescript
import { effectiveTeams, applyTeams, assertRosterGender, type OpenMatchGenderValue } from './matchTeams';
```

Ajouter `matchGender?` au type de `setup` (L339-347) :

```typescript
      competitive?: boolean;
      matchGender?: OpenMatchGenderValue | null;
```

Dans le corps, après le calcul de `levelOk` (L378), calculer le genre effectif + valider l'organisateur (seul participant à ce stade — les partners passés sont [] dans le flux « confirmer puis organiser », mais on valide tous les futurs participants pour être robuste) :

```typescript
    // Genre : conservé uniquement en PUBLIC + padel (comme la fourchette de niveau).
    const genderOk = setup.visibility === 'PUBLIC' && levelOk;
    const matchGender: OpenMatchGenderValue | null = genderOk ? (setup.matchGender ?? null) : null;
    if (matchGender) {
      const rosterIds = [userId, ...partners];
      const rosterUsers = await prisma.user.findMany({ where: { id: { in: rosterIds } }, select: { id: true, sex: true } });
      const sexById = new Map(rosterUsers.map((u) => [u.id, u.sex]));
      // À la création tous les participants tiennent sur l'équipe 1 ; pour WOMEN c'est sans
      // effet, pour MIXED cela n'accepte qu'un organisateur seul (les partners éventuels
      // seront revalidés à la réorg d'équipes). On valide le sexe de chacun.
      assertRosterGender(matchGender, rosterIds.map((id) => ({ sex: sexById.get(id) ?? null, team: 1 as 1 | 2 })));
    }
```

Puis, dans le `tx.reservation.update` final (L406-414), ajouter :

```typescript
        data: {
          visibility: setup.visibility === 'PUBLIC' ? 'PUBLIC' : 'PRIVATE',
          targetLevelMin: levelOk ? (setup.targetLevelMin ?? null) : null,
          targetLevelMax: levelOk ? (setup.targetLevelMax ?? null) : null,
          competitive: setup.competitive ?? undefined,
          matchGender,
        },
```

> Note MIXED-à-la-création : valider tout le roster sur `team:1` rejetterait un organisateur seul + 1 partenaire de même sexe. C'est acceptable — le flux réel envoie `partnerUserIds: []`. Documenté ici pour l'implémenteur.

- [ ] **Step 4: Lancer → succès attendu**

Run: `cd backend && node node_modules/jest/bin/jest.js src/services/__tests__/reservation.service.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/reservation.service.ts backend/src/services/__tests__/reservation.service.test.ts
git commit -m "feat(open-match): applyHoldSetup pose et valide le genre"
```

---

## Task 7: `setReservationVisibility` — poser + valider le genre à l'ouverture

**Files:**
- Modify: `backend/src/services/reservation.service.ts` (`setReservationVisibility` L1639-1684)
- Test: `backend/src/services/__tests__/reservation.service.test.ts`

- [ ] **Step 1: Écrire les tests**

```typescript
describe('setReservationVisibility genré', () => {
  it('écrit matchGender en PUBLIC quand les participants sont conformes', async () => {
    // participants tous FEMALE ; input { visibility:'PUBLIC', matchGender:'WOMEN' }
    const upd = await service.setReservationVisibility('r1', 'owner', { visibility: 'PUBLIC', matchGender: 'WOMEN' });
    expect(upd.matchGender).toBe('WOMEN');
  });
  it('refuse si un participant présent ne correspond pas (GENDER_PARTICIPANTS_CONFLICT)', async () => {
    // un participant MALE présent
    await expect(service.setReservationVisibility('r1', 'owner', { visibility: 'PUBLIC', matchGender: 'WOMEN' }))
      .rejects.toThrow('GENDER_PARTICIPANTS_CONFLICT');
  });
  it('efface matchGender en repassant PRIVATE', async () => {
    const upd = await service.setReservationVisibility('r1', 'owner', { visibility: 'PRIVATE' });
    expect(upd.matchGender).toBeNull();
  });
});
```

> Le `select` du `update` renvoie déjà `visibility/targetLevel*/competitive` — il faudra y ajouter `matchGender` (cf. Step 3) pour que le test lise `upd.matchGender`.

- [ ] **Step 2: Lancer → échec attendu**

Run: `cd backend && node node_modules/jest/bin/jest.js src/services/__tests__/reservation.service.test.ts --runInBand -t "setReservationVisibility genré"`
Expected: FAIL.

- [ ] **Step 3: Implémenter**

Ajouter `matchGender?` au type `input` (L1642) :

```typescript
    input: { visibility: 'PRIVATE' | 'PUBLIC'; targetLevelMin?: number | null; targetLevelMax?: number | null; competitive?: boolean; matchGender?: OpenMatchGenderValue | null },
```

Charger les participants (avec sexe + team) dans le `findUnique` (L1644-1647) :

```typescript
    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: {
        resource: { select: { clubSport: { select: { sport: { select: { key: true } } } }, attributes: true } },
        participants: { select: { userId: true, team: true, user: { select: { sex: true } } } },
      },
    });
```

Après le calcul de `keepLevel` (L1667), calculer le genre + valider les participants existants :

```typescript
    const matchGender: OpenMatchGenderValue | null = (input.visibility === 'PUBLIC' && sportHasLevels(sportKey))
      ? (input.matchGender ?? null)
      : null;
    if (matchGender) {
      const maxPlayers = playerCount((reservation.resource.attributes as { format?: string } | null)?.format);
      const layout = effectiveTeams(reservation.participants.map((p) => ({ ...p, team: p.team, slot: null })), maxPlayers);
      assertRosterGender(matchGender, layout.map((p) => ({ sex: p.user?.sex ?? null, team: p.team })));
    }
```

Ajouter `matchGender` au `data` et au `select` du `update` (L1671-1677) :

```typescript
      data: {
        visibility: input.visibility === 'PUBLIC' ? 'PUBLIC' : 'PRIVATE',
        targetLevelMin: keepLevel ? (input.targetLevelMin ?? null) : null,
        targetLevelMax: keepLevel ? (input.targetLevelMax ?? null) : null,
        competitive: input.competitive ?? reservation.competitive,
        matchGender,
      },
      select: { id: true, visibility: true, targetLevelMin: true, targetLevelMax: true, competitive: true, matchGender: true },
```

- [ ] **Step 4: Lancer → succès attendu**

Run: `cd backend && node node_modules/jest/bin/jest.js src/services/__tests__/reservation.service.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/reservation.service.ts backend/src/services/__tests__/reservation.service.test.ts
git commit -m "feat(open-match): setReservationVisibility pose et valide le genre"
```

---

## Task 8: Exposer `gender` dans les DTO (liste, détail, national)

**Files:**
- Modify: `backend/src/services/openMatch.service.ts` (`toDTO` L112-142 ; mapper national L214-232)
- Test: `backend/src/services/__tests__/openMatch.service.test.ts`

- [ ] **Step 1: Écrire le test**

```typescript
it('toDTO expose gender (matchGender de la résa)', async () => {
  // reservation.matchGender = 'MIXED'
  const [dto] = await service.listOpenMatches('padel-arena-paris', null);
  expect(dto.gender).toBe('MIXED');
});
it('gender = null quand la résa n’est pas genrée', async () => {
  const [dto] = await service.listOpenMatches('padel-arena-paris', null);
  expect(dto.gender).toBeNull();
});
```

- [ ] **Step 2: Lancer → échec attendu**

Run: `cd backend && node node_modules/jest/bin/jest.js src/services/__tests__/openMatch.service.test.ts --runInBand -t "gender"`
Expected: FAIL.

- [ ] **Step 3: Implémenter**

Dans `toDTO`, ajouter au retour (après `competitive: m.competitive,` L125) :

```typescript
      gender: m.matchGender ?? null,
```

Dans le mapper de `listNationalOpenMatches` (retour de `.map`, après `competitive: m.competitive,` L226) :

```typescript
          gender: m.matchGender ?? null,
```

> `m.matchGender` est disponible : les `findMany` utilisent `include` (pas `select`), donc tous les scalaires de `Reservation` sont retournés.

- [ ] **Step 4: Lancer → succès attendu**

Run: `cd backend && node node_modules/jest/bin/jest.js src/services/__tests__/openMatch.service.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/openMatch.service.ts backend/src/services/__tests__/openMatch.service.test.ts
git commit -m "feat(open-match): expose gender dans les DTO"
```

---

## Task 9: Routes — passthrough + validation de `matchGender`

**Files:**
- Modify: `backend/src/routes/reservations.ts` (`/:id/setup` L130-168 ; `/:id/visibility` L172-199)
- Test: `backend/src/routes/__tests__/reservations.routes.test.ts`

- [ ] **Step 1: Écrire les tests**

```typescript
it('POST /:id/setup rejette un matchGender invalide (400)', async () => {
  const res = await request(app).post('/api/reservations/r1/setup')
    .set('Authorization', 'Bearer t').send({ visibility: 'PUBLIC', matchGender: 'MEN' });
  expect(res.status).toBe(400);
});
it('POST /:id/setup transmet matchGender au service', async () => {
  await request(app).post('/api/reservations/r1/setup')
    .set('Authorization', 'Bearer t').send({ visibility: 'PUBLIC', matchGender: 'WOMEN' });
  expect(applyHoldSetupSpy).toHaveBeenCalledWith('r1', expect.any(String),
    expect.objectContaining({ matchGender: 'WOMEN' }));
});
it('POST /:id/visibility transmet matchGender au service', async () => {
  await request(app).post('/api/reservations/r1/visibility')
    .set('Authorization', 'Bearer t').send({ visibility: 'PUBLIC', matchGender: 'MIXED' });
  expect(setVisibilitySpy).toHaveBeenCalledWith('r1', expect.any(String),
    expect.objectContaining({ matchGender: 'MIXED' }));
});
```

- [ ] **Step 2: Lancer → échec attendu**

Run: `cd backend && node node_modules/jest/bin/jest.js src/routes/__tests__/reservations.routes.test.ts --runInBand -t "matchGender"`
Expected: FAIL.

- [ ] **Step 3: Implémenter**

Route `/:id/setup` : destructurer `matchGender` (L132), valider, transmettre (L155-165) :

```typescript
    const { partnerUserIds, visibility, targetLevelMin, targetLevelMax, teams, slots, competitive, matchGender } = req.body ?? {};
```

Ajouter après la validation `targetLevel` (avant l'appel service, ~L154) :

```typescript
    if (matchGender !== undefined && matchGender !== null && matchGender !== 'WOMEN' && matchGender !== 'MIXED') {
      return void res.status(400).json({ error: 'VALIDATION_ERROR' });
    }
```

Et dans l'objet passé à `applyHoldSetup` (L155-165), ajouter :

```typescript
      matchGender: matchGender === undefined ? undefined : (matchGender === null ? null : matchGender),
```

Route `/:id/visibility` : idem — destructurer `matchGender` (L174), même garde 400, et l'ajouter à l'appel `setReservationVisibility` (L191-196) :

```typescript
    const { visibility, targetLevelMin, targetLevelMax, competitive, matchGender } = req.body ?? {};
```
```typescript
      matchGender: matchGender === undefined ? undefined : (matchGender === null ? null : matchGender),
```
(avec la même garde `VALIDATION_ERROR` que ci-dessus insérée avant l'appel).

- [ ] **Step 4: Lancer → succès attendu**

Run: `cd backend && node node_modules/jest/bin/jest.js src/routes/__tests__/reservations.routes.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Type-check backend + commit**

Run: `cd backend && node node_modules/typescript/bin/tsc --noEmit` → PASS.
```bash
git add backend/src/routes/reservations.ts backend/src/routes/__tests__/reservations.routes.test.ts
git commit -m "feat(open-match): routes /setup et /visibility acceptent matchGender"
```

---

## Task 10: Types frontend (`lib/api.ts`)

**Files:**
- Modify: `frontend/lib/api.ts` (`applyHoldSetup` L175-191 ; `setReservationVisibility` L279-289 ; `OpenMatch` L1667-1686 ; type national)

- [ ] **Step 1: Ajouter le type de genre + champs**

Définir un type partagé, près de `interface OpenMatch` (L1667) :

```typescript
export type OpenMatchGender = 'WOMEN' | 'MIXED';
```

Dans `interface OpenMatch`, après `competitive?: boolean;` (L1680) :

```typescript
  gender?: OpenMatchGender | null; // Féminine / Mixte ; null = ouverte à tous
```

Chercher `interface NationalOpenMatch` et y ajouter le même champ `gender?: OpenMatchGender | null;`.

- [ ] **Step 2: Ajouter `matchGender` aux signatures d'appel**

`applyHoldSetup` (L178-186), dans le type `setup` après `competitive?: boolean;` :

```typescript
      matchGender?: OpenMatchGender | null;
```

`setReservationVisibility` (L283), étendre `opts` :

```typescript
    opts?: { targetLevelMin?: number | null; targetLevelMax?: number | null; competitive?: boolean; matchGender?: OpenMatchGender | null },
```

- [ ] **Step 3: Type-check**

Run: `cd frontend && node node_modules/typescript/bin/tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(open-match): types frontend gender/matchGender"
```

---

## Task 11: Composant partagé `GenderPicker`

**Files:**
- Create: `frontend/components/reservations/GenderPicker.tsx`
- Test: `frontend/__tests__/GenderPicker.test.tsx`

- [ ] **Step 1: Écrire le test**

`frontend/__tests__/GenderPicker.test.tsx` :

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { GenderPicker } from '@/components/reservations/GenderPicker';

const wrap = (ui: React.ReactNode) => render(<ThemeProvider>{ui}</ThemeProvider>);

it('rend les 3 options et surligne la valeur active', () => {
  wrap(<GenderPicker value={null} onChange={() => {}} />);
  expect(screen.getByRole('button', { name: 'Ouverte à tous' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'Féminine' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Mixte' })).toBeInTheDocument();
});

it('émet la valeur choisie', () => {
  const onChange = jest.fn();
  wrap(<GenderPicker value={null} onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: 'Féminine' }));
  expect(onChange).toHaveBeenCalledWith('WOMEN');
  fireEvent.click(screen.getByRole('button', { name: 'Mixte' }));
  expect(onChange).toHaveBeenCalledWith('MIXED');
});
```

- [ ] **Step 2: Lancer → échec attendu**

Run: `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/GenderPicker.test.tsx`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Implémenter**

`frontend/components/reservations/GenderPicker.tsx` :

```tsx
'use client';
import { useTheme } from '@/lib/ThemeProvider';
import type { OpenMatchGender } from '@/lib/api';

const OPTIONS: Array<{ value: OpenMatchGender | null; label: string; sub: string }> = [
  { value: null,    label: 'Ouverte à tous', sub: 'Tout le monde peut rejoindre' },
  { value: 'WOMEN', label: 'Féminine',       sub: 'Réservée aux femmes' },
  { value: 'MIXED', label: 'Mixte',          sub: 'Un homme et une femme par équipe' },
];

// Sélecteur de genre d'une partie ouverte padel — 3 chips segmentées, partagé par
// OpenMatchToggle et OpenMatchQuickSwitch. Contrôlé (value/onChange), pur.
export function GenderPicker({ value, onChange, disabled }: {
  value: OpenMatchGender | null;
  onChange: (v: OpenMatchGender | null) => void;
  disabled?: boolean;
}) {
  const { th } = useTheme();
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {OPTIONS.map((o) => {
        const active = o.value === value;
        return (
          <button key={o.label} type="button" aria-pressed={active} disabled={disabled}
            onClick={() => onChange(o.value)}
            style={{ flex: 1, textAlign: 'left', cursor: disabled ? 'not-allowed' : 'pointer', borderRadius: 12,
              padding: '9px 12px', border: `1.5px solid ${active ? th.accent : th.line}`,
              background: active ? `${th.accent}14` : 'transparent', opacity: disabled ? 0.6 : 1 }}>
            <div style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, color: active ? th.accent : th.text }}>{o.label}</div>
            <div style={{ fontFamily: th.fontUI, fontSize: 10.5, color: th.textFaint, marginTop: 2, lineHeight: 1.3 }}>{o.sub}</div>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Lancer → succès attendu**

Run: `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/GenderPicker.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/reservations/GenderPicker.tsx frontend/__tests__/GenderPicker.test.tsx
git commit -m "feat(open-match): composant GenderPicker partage"
```

---

## Task 12: Câbler `GenderPicker` dans `OpenMatchToggle`

**Files:**
- Modify: `frontend/components/reservations/OpenMatchToggle.tsx`
- Test: `frontend/__tests__/OpenMatchToggle.test.tsx` (créer si absent)

- [ ] **Step 1: Écrire le test**

`frontend/__tests__/OpenMatchToggle.test.tsx` (mock `@/lib/api` : `setReservationVisibility`). Vérifier que publier avec Féminine envoie `matchGender: 'WOMEN'`, et qu'une erreur `GENDER_NOT_FEMALE` s'affiche.

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { OpenMatchToggle } from '@/components/reservations/OpenMatchToggle';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({ api: { setReservationVisibility: jest.fn().mockResolvedValue({ id: 'r1' }) } }));

const resa = {
  id: 'r1', visibility: 'PRIVATE', status: 'CONFIRMED', competitive: true,
  startTime: new Date(Date.now() + 3600_000).toISOString(),
  capacity: 4, participants: [{}],
  resource: { sport: { key: 'padel' } },
} as any;

it('publie avec le genre choisi', async () => {
  render(<ThemeProvider><OpenMatchToggle reservation={resa} token="t" now={Date.now()} onChanged={() => {}} /></ThemeProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Ouvrir la partie' }));
  fireEvent.click(screen.getByRole('button', { name: 'Féminine' }));
  fireEvent.click(screen.getByRole('button', { name: 'Publier' }));
  await waitFor(() => expect(api.setReservationVisibility).toHaveBeenCalledWith(
    'r1', 'PUBLIC', 't', expect.objectContaining({ matchGender: 'WOMEN' })));
});
```

- [ ] **Step 2: Lancer → échec attendu**

Run: `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/OpenMatchToggle.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implémenter**

Dans `OpenMatchToggle.tsx` : importer `GenderPicker` et le type ; ajouter un état + inclure `matchGender` à `publish` + un message d'erreur.

Import (après L7) :
```tsx
import { GenderPicker } from '@/components/reservations/GenderPicker';
import type { OpenMatchGender } from '@/lib/api';
```

État (après L33) :
```tsx
  const [gender, setGender] = useState<OpenMatchGender | null>(null);
```

Étendre la map `ERR` (L11-16) :
```tsx
  SEX_REQUIRED: 'Renseignez votre sexe dans votre profil pour les parties genrées.',
  GENDER_NOT_FEMALE: 'Cette partie est réservée aux femmes.',
  GENDER_TEAM_FULL: 'Cette partie mixte n’a plus de place pour votre catégorie.',
  GENDER_PARTICIPANTS_CONFLICT: 'Les joueurs déjà présents ne correspondent pas à ce type de partie.',
```

Dans `publish` (L63-71), passer `matchGender` :
```tsx
    return api.setReservationVisibility(
      reservation.id, 'PUBLIC', token,
      { competitive, matchGender: gender, ...(limit ? { targetLevelMin: lmin, targetLevelMax: lmax } : { targetLevelMin: null, targetLevelMax: null }) },
    );
```

Dans la feuille dépliée, insérer le sélecteur au-dessus des chips Pour de vrai/Pour le fun (avant la `<div>` de L112) :
```tsx
          <div style={{ marginTop: 14 }}>
            <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, fontWeight: 600, marginBottom: 8 }}>Genre de la partie</div>
            <GenderPicker value={gender} onChange={setGender} disabled={busy} />
          </div>
```

- [ ] **Step 4: Lancer → succès attendu**

Run: `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/OpenMatchToggle.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/reservations/OpenMatchToggle.tsx frontend/__tests__/OpenMatchToggle.test.tsx
git commit -m "feat(open-match): selecteur de genre dans OpenMatchToggle"
```

---

## Task 13: Câbler `GenderPicker` dans `OpenMatchQuickSwitch`

**Files:**
- Modify: `frontend/components/reservations/OpenMatchQuickSwitch.tsx`
- Test: `frontend/__tests__/OpenMatchQuickSwitch.test.tsx` (créer si absent)

- [ ] **Step 1: Écrire le test**

Vérifier que, résa non ouverte, choisir Mixte puis basculer « Partie ouverte aux membres » envoie `matchGender: 'MIXED'`.

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { OpenMatchQuickSwitch } from '@/components/reservations/OpenMatchQuickSwitch';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({ api: {
  setReservationVisibility: jest.fn().mockResolvedValue({ id: 'r1' }),
  getMyRating: jest.fn().mockResolvedValue({ level: 4 }),
} }));
jest.mock('@/lib/useLevelSystem', () => ({ useLevelSystemEnabled: () => true }));

const resa = { id: 'r1', visibility: 'PRIVATE', competitive: true, resource: { sport: { key: 'padel' } } } as any;

it('ouvre avec le genre choisi', async () => {
  render(<ThemeProvider><OpenMatchQuickSwitch reservation={resa} token="t" onChanged={() => {}} /></ThemeProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Mixte' }));
  fireEvent.click(screen.getByRole('switch', { name: 'Partie ouverte aux membres' }));
  await waitFor(() => expect(api.setReservationVisibility).toHaveBeenCalledWith(
    'r1', 'PUBLIC', 't', expect.objectContaining({ matchGender: 'MIXED' })));
});
```

- [ ] **Step 2: Lancer → échec attendu**

Run: `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/OpenMatchQuickSwitch.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implémenter**

Imports (après L11) :
```tsx
import { GenderPicker } from '@/components/reservations/GenderPicker';
import type { OpenMatchGender } from '@/lib/api';
```

État (après L44) :
```tsx
  const [gender, setGender] = useState<OpenMatchGender | null>(reservation.gender ?? null);
```

Préremplir depuis la résa quand elle est déjà PUBLIC — dans l'effet de préremplissage (bloc L55-70, branche `reservation.visibility === 'PUBLIC'`) ajouter :
```tsx
      setGender(reservation.gender ?? null);
```

Étendre la map `ERR` (L13-18) avec les 4 mêmes entrées `SEX_REQUIRED`/`GENDER_NOT_FEMALE`/`GENDER_TEAM_FULL`/`GENDER_PARTICIPANTS_CONFLICT` que Task 12 Step 3.

Dans `toggle`, branche d'ouverture (L100-107), ajouter `matchGender: gender` :
```tsx
        await api.setReservationVisibility(reservation.id, 'PUBLIC', token, {
          targetLevelMin: limiting ? levelMin : null,
          targetLevelMax: limiting ? levelMax : null,
          matchGender: gender,
        });
```

Rendre le `GenderPicker` **avant** l'interrupteur « Partie ouverte aux membres » (juste après l'en-tête « VOTRE PARTIE », avant la `<div>` de L129), pour qu'il soit choisi avant l'activation :
```tsx
      {!openMatch && isPadel && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, fontWeight: 600, marginBottom: 8 }}>Genre de la partie</div>
          <GenderPicker value={gender} onChange={setGender} disabled={busy} />
        </div>
      )}
```

> `reservation.gender` doit exister sur le type `MyReservation`. Ajouter `gender?: OpenMatchGender | null;` à `MyReservation` dans `frontend/lib/api.ts` (chercher `interface MyReservation`) et l'exposer côté backend dans `listUserReservations` (le scalaire `matchGender` est déjà retourné par le `findMany` avec `include` ; ajouter `gender: r.matchGender ?? null` au mapping de `MyReservation`). Faire cet ajout dans ce même commit.

- [ ] **Step 4: Lancer → succès attendu**

Run: `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/OpenMatchQuickSwitch.test.tsx`
Expected: PASS. Puis `cd backend && node node_modules/jest/bin/jest.js src/services/__tests__/reservation.service.test.ts --runInBand` → PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/reservations/OpenMatchQuickSwitch.tsx frontend/__tests__/OpenMatchQuickSwitch.test.tsx frontend/lib/api.ts backend/src/services/reservation.service.ts
git commit -m "feat(open-match): selecteur de genre dans OpenMatchQuickSwitch"
```

---

## Task 14: Badge de genre sur `OpenMatchCard` + `OpenMatchDetail`

**Files:**
- Modify: `frontend/components/openmatch/OpenMatchCard.tsx` (rangée chips L106-128)
- Modify: `frontend/components/openmatch/OpenMatchDetail.tsx` (rangée méta — chercher les Chip `Pour de vrai`/niveau)
- Test: `frontend/__tests__/OpenMatchCard.test.tsx`

- [ ] **Step 1: Écrire le test**

Ajouter à `OpenMatchCard.test.tsx` :

```tsx
it('affiche le badge Féminine', () => {
  renderCard({ ...baseMatch, gender: 'WOMEN' });
  expect(screen.getByText('Féminine')).toBeInTheDocument();
});
it('affiche le badge Mixte', () => {
  renderCard({ ...baseMatch, gender: 'MIXED' });
  expect(screen.getByText('Mixte')).toBeInTheDocument();
});
it('aucun badge de genre si null', () => {
  renderCard({ ...baseMatch, gender: null });
  expect(screen.queryByText('Féminine')).not.toBeInTheDocument();
  expect(screen.queryByText('Mixte')).not.toBeInTheDocument();
});
```

> Adapter `renderCard`/`baseMatch` aux helpers du fichier existant.

- [ ] **Step 2: Lancer → échec attendu**

Run: `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/OpenMatchCard.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implémenter**

Dans `OpenMatchCard.tsx`, insérer le badge juste après le chip de niveau (après L109) :

```tsx
        {m.gender === 'WOMEN' && <Chip tone="line">Féminine</Chip>}
        {m.gender === 'MIXED' && <Chip tone="line">Mixte</Chip>}
```

Dans `OpenMatchDetail.tsx`, ajouter le même couple de `<Chip>` dans la rangée méta où figurent le niveau et Pour de vrai/Pour le fun (repérer par recherche `Pour de vrai` / `rangeLabel`).

- [ ] **Step 4: Lancer → succès attendu**

Run: `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/OpenMatchCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/openmatch/OpenMatchCard.tsx frontend/components/openmatch/OpenMatchDetail.tsx frontend/__tests__/OpenMatchCard.test.tsx
git commit -m "feat(open-match): badge Feminine/Mixte sur les cartes"
```

---

## Task 15: Filtre Genre (`MatchesFilterBar` + `OpenMatches`) + messages d'erreur

**Files:**
- Modify: `frontend/components/openmatch/MatchesFilterBar.tsx`
- Modify: `frontend/components/openmatch/OpenMatches.tsx`
- Modify: `frontend/components/openmatch/useOpenMatchActions.ts` (map `JOIN_ERRORS`)
- Test: `frontend/__tests__/MatchesFilterBar.test.tsx`, `frontend/__tests__/OpenMatches.test.tsx`

- [ ] **Step 1: Écrire les tests**

`MatchesFilterBar.test.tsx` — le groupe Genre est rendu et émet la valeur :

```tsx
it('rend le groupe Genre et émet le choix', () => {
  const onGenderChange = jest.fn();
  renderBar({ genderFilter: 'all', onGenderChange });
  fireEvent.click(screen.getByRole('button', { name: 'Féminine' }));
  expect(onGenderChange).toHaveBeenCalledWith('WOMEN');
});
```

`OpenMatches.test.tsx` — filtrer sur Mixte ne garde que les parties mixtes (adapter au harnais du fichier ; deux matches, un `gender:'MIXED'`, un `gender:null`).

- [ ] **Step 2: Lancer → échec attendu**

Run: `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/MatchesFilterBar.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implémenter**

`MatchesFilterBar.tsx` : ajouter le type et les props :

```tsx
export type GenderFilter = 'all' | 'WOMEN' | 'MIXED';
```
Dans `MatchesFilterBarProps`, après `onKindChange` :
```tsx
  genderFilter: GenderFilter;
  onGenderChange: (g: GenderFilter) => void;
```
Déstructurer `genderFilter, onGenderChange` dans les params. Ajouter un `FacetGroup` après le groupe « Type de partie » (après L80) :
```tsx
          <FacetGroup label="Genre" tint={FILTER_TINTS.genre}>
            <FacetChip label="Tous" tint={FILTER_TINTS.genre} active={genderFilter === 'all'} onClick={() => onGenderChange('all')} />
            <FacetChip label="Féminine" tint={FILTER_TINTS.genre} active={genderFilter === 'WOMEN'} onClick={() => onGenderChange('WOMEN')} />
            <FacetChip label="Mixte" tint={FILTER_TINTS.genre} active={genderFilter === 'MIXED'} onClick={() => onGenderChange('MIXED')} />
          </FacetGroup>
```
Mettre à jour `hasActiveFilter` (L51) pour inclure le genre :
```tsx
  const hasActiveFilter = kindFilter !== 'all' || genderFilter !== 'all';
```

`OpenMatches.tsx` : ajouter l'état (après L48) :
```tsx
  const [genderFilter, setGenderFilter] = useState<'all' | 'WOMEN' | 'MIXED'>('all');
```
Étendre le filtrage (L171-173) — appliquer le genre après le type :
```tsx
  const filtered = (kindFilter === 'all'
    ? byLevel
    : byLevel.filter((m) => (m.competitive === false) === (kindFilter === 'friendly'))
  ).filter((m) => genderFilter === 'all' || (m.gender ?? null) === genderFilter);
```
Passer les props à `<MatchesFilterBar>` (L240-250) :
```tsx
            genderFilter={genderFilter}
            onGenderChange={setGenderFilter}
```

`useOpenMatchActions.ts` : ajouter à `JOIN_ERRORS` (L10-28) :
```tsx
  SEX_REQUIRED:          'Renseignez votre sexe dans votre profil pour les parties genrées.',
  GENDER_NOT_FEMALE:     'Cette partie est réservée aux femmes.',
  GENDER_TEAM_FULL:      'Cette partie mixte n’a plus de place pour votre catégorie.',
  GENDER_PARTICIPANTS_CONFLICT: 'Les joueurs déjà présents ne correspondent pas à ce type de partie.',
```

- [ ] **Step 4: Lancer → succès attendu**

Run:
```
cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/MatchesFilterBar.test.tsx __tests__/OpenMatches.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/openmatch/MatchesFilterBar.tsx frontend/components/openmatch/OpenMatches.tsx frontend/components/openmatch/useOpenMatchActions.ts frontend/__tests__/MatchesFilterBar.test.tsx frontend/__tests__/OpenMatches.test.tsx
git commit -m "feat(open-match): filtre Genre + messages d'erreur"
```

---

## Task 16: Badge sur les cartes nationales / vitrine

**Files:**
- Modify: `frontend/components/platform/NationalOpenMatches.tsx`
- Modify: `frontend/components/clubhouse/OpenMatchesShowcase.tsx`
- Test: `frontend/__tests__/OpenMatchesShowcase.test.tsx` (existant) ; `frontend/__tests__/NationalOpenMatches.test.tsx` (existant si présent, sinon étendre)

- [ ] **Step 1: Écrire/étendre le test**

Dans `OpenMatchesShowcase.test.tsx`, ajouter un cas : une carte avec `gender:'WOMEN'` affiche « Féminine ».

- [ ] **Step 2: Lancer → échec attendu**

Run: `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/OpenMatchesShowcase.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implémenter**

Dans chaque composant, là où la carte affiche déjà des méta (sièges/niveau), ajouter un petit libellé conditionnel :
```tsx
{m.gender === 'WOMEN' && <span /* même style que les autres chips locales */>Féminine</span>}
{m.gender === 'MIXED' && <span /* idem */>Mixte</span>}
```
> Reprendre le style de chip/pastille déjà utilisé localement dans chaque composant (ne pas importer un nouveau style). `NationalOpenMatch.gender` a été typé en Task 10.

- [ ] **Step 4: Lancer → succès attendu**

Run: `cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/OpenMatchesShowcase.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/platform/NationalOpenMatches.tsx frontend/components/clubhouse/OpenMatchesShowcase.tsx frontend/__tests__/OpenMatchesShowcase.test.tsx
git commit -m "feat(open-match): badge genre sur vitrine et cartes nationales"
```

---

## Task 17: Vérification finale (types + suites ciblées)

**Files:** aucun changement (garde qualité).

- [ ] **Step 1: Type-check des deux paquets**

Run:
```
cd backend && node node_modules/typescript/bin/tsc --noEmit
cd frontend && node node_modules/typescript/bin/tsc --noEmit
```
Expected: PASS des deux côtés.

- [ ] **Step 2: Suites backend ciblées**

Run:
```
cd backend && node node_modules/jest/bin/jest.js src/services/__tests__/matchTeams.test.ts src/services/__tests__/openMatch.service.test.ts src/services/__tests__/reservation.service.test.ts src/routes/__tests__/reservations.routes.test.ts --runInBand
```
Expected: PASS.

- [ ] **Step 3: Suites frontend ciblées**

Run:
```
cd frontend && node node_modules/jest/bin/jest.js --runTestsByPath __tests__/GenderPicker.test.tsx __tests__/OpenMatchToggle.test.tsx __tests__/OpenMatchQuickSwitch.test.tsx __tests__/OpenMatchCard.test.tsx __tests__/MatchesFilterBar.test.tsx __tests__/OpenMatches.test.tsx __tests__/OpenMatchesShowcase.test.tsx
```
Expected: PASS.

- [ ] **Step 4: Vérification visuelle (CDP)**

Utiliser la skill `verify` : ouvrir `/parties` (badge + filtre Genre), l'écran de succès de réservation (sélecteur), et l'ouverture d'une partie via le calendrier. Vérifier clair + sombre, mobile 390 + desktop 1280, aucun débordement horizontal.

- [ ] **Step 5: Commit (si retouches visuelles)**

```bash
git add -A && git commit -m "chore(open-match): retouches apres verif visuelle"
```

---

## Self-review (fait par l'auteur du plan)

- **Couverture spec :** §1 modèle → Task 1 ; §2 règles → Task 2 ; §3 application (join/add/setTeams/applyHoldSetup/setReservationVisibility) → Tasks 3-7 ; §5 DTO+badge+filtre → Tasks 8,10,14,15,16 ; §4 surfaces création → Tasks 11-13 ; §6 erreurs → Tasks 12,13,15 ; §7 tests → chaque task. ✅
- **Codes d'erreur cohérents :** `SEX_REQUIRED`, `GENDER_NOT_FEMALE`, `GENDER_TEAM_FULL` (join/add/setTeams), `GENDER_PARTICIPANTS_CONFLICT` (roster create/open) — identiques backend (Task 2) et libellés front (Tasks 12/13/15). ✅
- **Signatures :** `assertOpenMatchGender(matchGender, newSex, sameSexOnTargetTeam)` et `assertRosterGender(matchGender, roster)` utilisées telles quelles partout. `OpenMatchGender = 'WOMEN'|'MIXED'` (front) / `OpenMatchGenderValue` (back). ✅
- **Écart spec assumé :** la spec évoquait `GENDER_PARTICIPANTS_CONFLICT` ; le plan le conserve pour create/open et ajoute les 3 codes granulaires pour join/add/setTeams — cohérent avec §6. ✅
- **MyReservation.gender :** ajouté en Task 13 (front type + mapping backend `listUserReservations`) car requis par `OpenMatchQuickSwitch`. ✅
