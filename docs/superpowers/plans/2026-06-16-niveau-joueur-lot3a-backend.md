# Niveau de joueur — Lot 3a (Backend : niveau exposé partout + fourchette parties ouvertes + historique) — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Exposer le niveau des joueurs dans tous les payloads d'affichage (parties ouvertes, annuaire membres, inscrits tournois/events, participants de « Mes réservations »), ajouter la **fourchette de niveau cible** des parties ouvertes, et un endpoint d'**historique de progression**. Backend seulement (l'UI = Lot 3b).

**Architecture :** Un seul nouvel utilitaire `RatingService.getLevelsForUsers(userIds, sportKey)` (1 requête → map `userId → {level, tier, isProvisional}`) que tous les services réutilisent pour annoter leurs payloads. Une migration additive pour `Reservation.targetLevelMin/Max`. Un endpoint historique lisant les snapshots `MatchPlayer.ratingAfter`.

**Tech Stack :** Express 5, Prisma 7, Jest + supertest. Prisma mocké (`mockDeep`).

**Spec :** `docs/superpowers/specs/2026-06-16-systeme-niveau-joueur-design.md`
**Pré-requis (sur origin/main `d569485`)** : `PlayerRating`, `RatingService` (getForDisplay/calibrate), modules `rating/level.ts` (`namedTier`), `Match`/`MatchPlayer`.

**Machine :** worktree `C:\dev\palova-wt-niveau`, branche `feat/player-rating-lot1`. Postgres up. Backend depuis `backend`. **Ne jamais reset la DB partagée.**

---

### Task 1: `RatingService.getLevelsForUsers` (lookup batch)

**Files:**
- Modify: `backend/src/services/rating.service.ts`
- Modify: `backend/src/services/__tests__/rating.service.test.ts`

- [ ] **Step 1: Add failing test**

```ts
describe('getLevelsForUsers', () => {
  it('renvoie une map userId → niveau pour les joueurs ayant un rating', async () => {
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-padel' } as any);
    prismaMock.playerRating.findMany.mockResolvedValue([
      { userId: 'u1', displayLevel: 4, isProvisional: false },
      { userId: 'u2', displayLevel: 2.4, isProvisional: true },
    ] as any);
    const map = await service.getLevelsForUsers(['u1', 'u2', 'u3'], 'padel');
    expect(map.u1).toEqual({ level: 4, tier: 'Intermédiaire', isProvisional: false });
    expect(map.u2.level).toBeCloseTo(2.4);
    expect(map.u3).toBeUndefined(); // pas de rating
  });

  it('liste vide → map vide, sans requête', async () => {
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-padel' } as any);
    const map = await service.getLevelsForUsers([], 'padel');
    expect(map).toEqual({});
  });
});
```

- [ ] **Step 2: Run, verify FAIL** : `cd C:\dev\palova-wt-niveau\backend && npx jest src/services/__tests__/rating.service.test.ts -t getLevelsForUsers`

- [ ] **Step 3: Implementation** — add to `RatingService` (and export the small type):

```ts
export interface UserLevel { level: number; tier: string; isProvisional: boolean; }
```
(add `namedTier` to the existing import from `./rating/level`)

```ts
  /** Niveaux d'un lot de joueurs pour un sport. Map userId → niveau (absent si pas de rating). */
  async getLevelsForUsers(userIds: string[], sportKey: string): Promise<Record<string, UserLevel>> {
    if (userIds.length === 0) return {};
    const sportId = await this.sportId(sportKey);
    const rows = await prisma.playerRating.findMany({
      where: { sportId, userId: { in: userIds } },
      select: { userId: true, displayLevel: true, isProvisional: true },
    });
    const map: Record<string, UserLevel> = {};
    for (const r of rows) map[r.userId] = { level: r.displayLevel, tier: namedTier(r.displayLevel), isProvisional: r.isProvisional };
    return map;
  }
```

- [ ] **Step 4: Run, verify PASS** (the whole rating.service.test.ts).

- [ ] **Step 5: Commit**

```bash
cd C:\dev\palova-wt-niveau
git add backend/src/services/rating.service.ts backend/src/services/__tests__/rating.service.test.ts
git commit -m "feat(rating): RatingService.getLevelsForUsers (lookup batch)"
```

---

### Task 2: Migration `Reservation.targetLevelMin/Max`

**Files:**
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1: Add columns** to `model Reservation` (près des autres champs scalaires) :

```prisma
  // Fourchette de niveau cible (0–8) d'une partie ouverte (visibility PUBLIC). null = pas de cible.
  targetLevelMin Float? @map("target_level_min")
  targetLevelMax Float? @map("target_level_max")
```

- [ ] **Step 2: Migrate** : `cd C:\dev\palova-wt-niveau\backend && npx prisma migrate dev --name add_reservation_target_level`
Additive (ADD COLUMN ×2). **Si reset demandé → BLOCKED.** Vérifier le SQL = uniquement `ALTER TABLE "reservations" ADD COLUMN`.

- [ ] **Step 3: tsc** : `npx tsc --noEmit` → PASS.

- [ ] **Step 4: Commit**

```bash
cd C:\dev\palova-wt-niveau
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(rating): fourchette de niveau cible des parties ouvertes (migration)"
```

---

### Task 3: Parties ouvertes — niveau des joueurs + fourchette cible

**Files:**
- Modify: `backend/src/services/openMatch.service.ts`
- Modify: `backend/src/services/__tests__/openMatch.service.test.ts`

Comportement : `listOpenMatches` annote chaque `players[i]` d'un `level: UserLevel | null` (via `getLevelsForUsers` sur tous les userIds des matchs, 1 requête), et expose `targetLevelMin/targetLevelMax` de la réservation. La **création** d'une partie ouverte accepte une fourchette (voir Task 7 pour la route ; ici on s'assure que le service la lit/écrit — si la création se fait dans `reservation.service`, ajuster là).

- [ ] **Step 1: Lire** `openMatch.service.ts` (`listOpenMatches`) et son test. Repérer où `players` est construit (le `select` inclut déjà userId/firstName/lastName/avatarUrl/isOrganizer) et la requête `findMany` des matchs.

- [ ] **Step 2: Add failing test** (dans le test existant) : monter un open match avec 2 participants ayant des ratings mockés et asserter que `players[].level` est renseigné et `targetLevelMin/Max` présents. Mocker `prismaMock.playerRating.findMany` + `prismaMock.sport.findUnique`. (S'inspirer du test existant pour la forme du mock de `reservation.findMany`.)

- [ ] **Step 3: Implementation** :
  - importer `RatingService` (instancier une fois dans le service ou injecter), ajouter `targetLevelMin: true, targetLevelMax: true` au `select` de la réservation.
  - après avoir construit la liste des matchs, collecter tous les `userId` des participants, appeler `const levels = await this.ratingService.getLevelsForUsers(allUserIds, 'padel')`, puis dans le map `players`, ajouter `level: levels[p.userId] ?? null`, et au niveau du match ajouter `targetLevelMin: m.targetLevelMin, targetLevelMax: m.targetLevelMax`.

- [ ] **Step 4: Run, verify PASS** : `npx jest src/services/__tests__/openMatch.service.test.ts`

- [ ] **Step 5: Commit**

```bash
cd C:\dev\palova-wt-niveau
git add backend/src/services/openMatch.service.ts backend/src/services/__tests__/openMatch.service.test.ts
git commit -m "feat(rating): niveau des joueurs + fourchette cible sur les parties ouvertes"
```

---

### Task 4: Annuaire membres — niveau dans `searchMembers`

**Files:**
- Modify: `backend/src/services/club.service.ts` (`searchMembers`)
- Modify: le test correspondant (chercher `club.service` ou `searchMembers`)

- [ ] **Step 1: Lire** `searchMembers` — note la forme de retour (id + nom). 

- [ ] **Step 2: Add failing test** : asserter qu'un membre renvoyé a un champ `level` (UserLevel|null) quand il a un rating. Mocker `playerRating.findMany`.

- [ ] **Step 3: Implementation** : après avoir récupéré les membres, appeler `getLevelsForUsers(memberUserIds, 'padel')` et ajouter `level: levels[userId] ?? null` à chaque entrée. Importer/instancier `RatingService`.

- [ ] **Step 4: Run, verify PASS + tsc**

- [ ] **Step 5: Commit**

```bash
cd C:\dev\palova-wt-niveau
git add backend/src/services/club.service.ts backend/src/services/__tests__/
git commit -m "feat(rating): niveau dans l'annuaire de recherche des membres"
```

---

### Task 5: Inscrits tournois & events — niveau

**Files:**
- Modify: `backend/src/services/tournament.service.ts` (`listParticipants`)
- Modify: `backend/src/services/event.service.ts` (`listParticipants`)
- Modify: les tests correspondants

- [ ] **Step 1: Lire** les deux `listParticipants`. Tournoi = binômes (captain+partner) ; event = individuel (user).

- [ ] **Step 2: Add failing tests** : asserter `captainLevel`/`partnerLevel` (tournoi) et `level` (event) présents quand rating existe.

- [ ] **Step 3: Implementation** :
  - Tournoi : collecter tous les `captainUserId`+`partnerUserId`, `getLevelsForUsers`, ajouter `captainLevel`/`partnerLevel` (UserLevel|null) au payload de chaque binôme.
  - Event : collecter les `userId`, ajouter `level`.
  (Le payload public n'expose pas l'userId — c'est OK, on ajoute juste les champs de niveau.)

- [ ] **Step 4: Run, verify PASS + tsc**

- [ ] **Step 5: Commit**

```bash
cd C:\dev\palova-wt-niveau
git add backend/src/services/tournament.service.ts backend/src/services/event.service.ts backend/src/services/__tests__/
git commit -m "feat(rating): niveau des inscrits sur tournois et events"
```

---

### Task 6: Participants de « Mes réservations » — niveau (pour les pastilles)

**Files:**
- Modify: `backend/src/services/reservation.service.ts` (`listUserReservations`)
- Modify: le test correspondant

- [ ] **Step 1: Lire** `listUserReservations` (déjà vu : renvoie `participants[{id,userId,isOrganizer,firstName,lastName,avatarUrl}]`).

- [ ] **Step 2: Add failing test** : un participant renvoyé porte un `level` quand il a un rating.

- [ ] **Step 3: Implementation** : collecter les userId de tous les participants de toutes les résas, `getLevelsForUsers`, ajouter `level: levels[p.userId] ?? null` à chaque participant.

- [ ] **Step 4: Run, verify PASS + tsc**

- [ ] **Step 5: Commit**

```bash
cd C:\dev\palova-wt-niveau
git add backend/src/services/reservation.service.ts backend/src/services/__tests__/
git commit -m "feat(rating): niveau des participants sur Mes réservations"
```

---

### Task 7: Création d'une partie ouverte avec fourchette + endpoint historique

**Files:**
- Modify: la route/service qui crée une partie ouverte (chercher `visibility: 'PUBLIC'` / open-match create) pour accepter `targetLevelMin/Max`
- Modify: `backend/src/routes/me.ts` (nouvel `GET /rating/history`)
- Modify/Create: tests

- [ ] **Step 1: Fourchette à la création** — localiser où une réservation PUBLIC est créée (probablement `reservation.service.ts` `holdSlot`/`confirm` avec un flag visibility, ou une route open-match). Accepter `targetLevelMin/targetLevelMax` (0–8, min ≤ max, optionnels) et les stocker. Valider : nombres dans [0,8], `min ≤ max`, sinon `VALIDATION_ERROR`. Ajouter un test ciblé.

- [ ] **Step 2: Endpoint historique** — `GET /api/me/rating/history?sport=padel` : lit les `MatchPlayer` du joueur (via `match.playedAt`) pour le sport, renvoie la série `[{ playedAt, level }]` (depuis `ratingAfter`, en ignorant les null), triée croissant.

```ts
router.get('/rating/history', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sport = typeof req.query.sport === 'string' ? req.query.sport : 'padel';
    const rows = await prisma.matchPlayer.findMany({
      where: { userId: req.user!.id, ratingAfter: { not: null }, match: { sport: { key: sport }, status: 'CONFIRMED' } },
      orderBy: { match: { playedAt: 'asc' } },
      select: { ratingAfter: true, match: { select: { playedAt: true } } },
    });
    res.json(rows.map((r) => ({ playedAt: r.match.playedAt, level: r.ratingAfter })));
  } catch (err) { next(err); }
});
```

- [ ] **Step 3: Add failing test** (route history) : mock `prismaMock.matchPlayer.findMany` renvoyant 2 lignes → la réponse est `[{playedAt, level}]` ordonnée. (supertest + JWT, comme `rating.routes.test.ts`.)

- [ ] **Step 4: Run, verify PASS + tsc**

- [ ] **Step 5: Commit**

```bash
cd C:\dev\palova-wt-niveau
git add backend/src/routes/me.ts backend/src/services backend/src/routes/__tests__ backend/src/services/__tests__
git commit -m "feat(rating): fourchette à la création de partie ouverte + GET /me/rating/history"
```

---

### Task 8: Vérification finale Lot 3a

- [ ] **Step 1: Gate backend** : `cd C:\dev\palova-wt-niveau\backend && npx tsc --noEmit && npx jest`
Expected: tout vert.

---

## Notes de périmètre (Lot 3a)

- Backend seulement. L'affichage (pastilles, fourchette/avertissement à la création, filtre « à mon niveau », courbe) = **Lot 3b**.
- `getLevelsForUsers` = 1 requête par payload (pas de N+1).
- La **reco active** « parties pour toi » reste au **Lot 4**.
- Tous les ajouts de champ sont **additifs** (UI tolère leur absence).
