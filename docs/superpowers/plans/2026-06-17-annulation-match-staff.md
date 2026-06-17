# Annulation de match par le staff (Lot 4 — 3/3) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre au staff d'annuler un match (litige, en attente, ou déjà confirmé), avec un motif tracé, en recalculant les niveaux Glicko des joueurs concernés par rejeu complet de l'historique.

**Architecture:** L'état des niveaux est une fonction pure et déterministe de l'historique des matchs CONFIRMED. Annuler = retirer le match de l'historique + rejouer. Cœur pur `replayRatings` (sans DB), enveloppe DB `recomputeSportRatings(tx, …)`, action `MatchService.voidMatch`, route admin club-scopée, UI à deux segments dans `/admin/matches`. Trace d'audit en champs additifs sur `Match` (pas de nouvelle table).

**Tech Stack:** Backend Express 5 + Prisma 7 (adapter-pg), Jest + jest-mock-extended (`prismaMock`). Frontend Next.js 16 + React 19, React Testing Library. Moteur Glicko-2 pur existant (`backend/src/services/rating/*`).

**Spec :** `docs/superpowers/specs/2026-06-17-annulation-match-staff-design.md`

---

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `backend/prisma/schema.prisma` | + champs `cancelledAt/cancelledByUserId/cancelledReason` sur `Match` (+ relation User) |
| `backend/prisma/migrations/<ts>_add_match_cancellation/migration.sql` | migration additive |
| `backend/src/services/rating/recompute.ts` (nouveau) | cœur pur `replayRatings` + enveloppe DB `recomputeSportRatings(tx, …)` |
| `backend/src/services/rating/__tests__/recompute.test.ts` (nouveau) | tests purs du rejeu |
| `backend/src/services/match.service.ts` | + méthode `voidMatch` |
| `backend/src/services/__tests__/match.service.test.ts` | + tests `voidMatch` + `recomputeSportRatings` (DB) |
| `backend/src/routes/admin.ts` | + route `POST …/matches/:matchId/void` |
| `backend/src/routes/__tests__/match-admin.routes.test.ts` | + tests route void |
| `frontend/lib/api.ts` | + `voidClubMatch` ; champs `cancelled*` optionnels sur `ClubMatch` |
| `frontend/components/ui/ConfirmDialog.tsx` | + prop optionnelle `confirmDisabled` |
| `frontend/app/admin/matches/page.tsx` | deux segments « Litiges » / « Matchs confirmés » + dialogue d'annulation avec motif |
| `frontend/__tests__/AdminMatches.test.tsx` | + tests segment confirmés + annulation avec motif |

**Rappel environnement (CLAUDE.md) :** Docker via `docker-compose-v1.exe`. Backend tests : `cd backend && npm test` (Prisma mocké, pas besoin de DB). Frontend tests : `cd frontend && npm test`. Migration : `cd backend && npm run db:migrate`.

---

## Task 1 : Schéma — champs d'annulation sur `Match`

**Files:**
- Modify: `backend/prisma/schema.prisma` (modèle `Match` ~ lignes 416-441, modèle `User` pour la relation inverse)
- Create (généré): `backend/prisma/migrations/<ts>_add_match_cancellation/migration.sql`

- [ ] **Step 1 : Ajouter les champs au modèle `Match`**

Dans `model Match { … }`, après `ratingsAppliedAt`, ajouter :

```prisma
  cancelledAt       DateTime? @map("cancelled_at")
  cancelledByUserId String?   @map("cancelled_by_user_id")
  cancelledReason   String?   @map("cancelled_reason")
```

Et dans le bloc des relations du même modèle, ajouter la relation vers l'utilisateur staff :

```prisma
  cancelledBy User?         @relation("MatchCancelledBy", fields: [cancelledByUserId], references: [id], onDelete: SetNull)
```

- [ ] **Step 2 : Déclarer la relation inverse sur `User`**

Dans `model User { … }`, ajouter une ligne de relation inverse (à côté des autres relations match, ex. `MatchCreator`) :

```prisma
  cancelledMatches Match[] @relation("MatchCancelledBy")
```

- [ ] **Step 3 : Générer la migration**

Run: `cd backend && npx prisma migrate dev --name add_match_cancellation --create-only`
Puis appliquer : `npx prisma migrate dev`
Expected: nouveau dossier `migrations/<ts>_add_match_cancellation/` avec `ALTER TABLE "matches" ADD COLUMN …` (3 colonnes nullables). Aucune perte de données (additif).

> Si Postgres n'est pas lancé : `"C:\Program Files\Docker\Docker\resources\bin\docker-compose-v1.exe" up -d` d'abord.

- [ ] **Step 4 : Régénérer le client + vérifier la compilation**

Run: `cd backend && npx prisma generate && npx tsc --noEmit`
Expected: pas d'erreur TypeScript.

- [ ] **Step 5 : Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(niveau): champs d'audit d'annulation sur Match (migration additive)"
```

---

## Task 2 : Cœur pur du rejeu — `replayRatings`

Le cœur ne touche pas la DB : il prend les calibrations de départ + la liste des matchs et renvoie l'état final de chaque joueur + les niveaux avant/après par match. Il **réutilise exactement** les primitives de `finalize` (`decayForInactivity` puis `applyMatchRatings`) dans l'ordre chronologique, ce qui garantit la fidélité au chemin incrémental.

**Files:**
- Create: `backend/src/services/rating/recompute.ts`
- Test: `backend/src/services/rating/__tests__/recompute.test.ts`

- [ ] **Step 1 : Écrire les tests qui échouent**

```typescript
// backend/src/services/rating/__tests__/recompute.test.ts
import { replayRatings, ReplayBaseline, ReplayMatchInput } from '../recompute';
import { levelToRating, SKIP_DEFAULT_LEVEL } from '../level';

const d = (s: string) => new Date(s);

// u1+u2 (équipe 1) battent u3+u4 (équipe 2) 6-2 6-2 le 10/06.
const m1: ReplayMatchInput = {
  matchId: 'm1', playedAt: d('2026-06-10T10:00:00Z'), sets: [[6, 2], [6, 2]],
  players: [
    { userId: 'u1', team: 1 }, { userId: 'u2', team: 1 },
    { userId: 'u3', team: 2 }, { userId: 'u4', team: 2 },
  ],
};
const m2: ReplayMatchInput = {
  matchId: 'm2', playedAt: d('2026-06-12T10:00:00Z'), sets: [[6, 3], [6, 4]],
  players: [
    { userId: 'u1', team: 1 }, { userId: 'u3', team: 1 },
    { userId: 'u2', team: 2 }, { userId: 'u4', team: 2 },
  ],
};
const baselines: ReplayBaseline[] = ['u1', 'u2', 'u3', 'u4'].map((userId) => ({ userId, initialSelfLevel: null }));

describe('replayRatings', () => {
  it('un seul match : le gagnant monte au-dessus du perdant, matchesPlayed=1', () => {
    const out = replayRatings(baselines, [m1]);
    const byId = Object.fromEntries(out.players.map((p) => [p.userId, p]));
    expect(byId.u1.displayLevel).toBeGreaterThan(byId.u3.displayLevel);
    expect(byId.u1.matchesPlayed).toBe(1);
    expect(byId.u1.lastMatchAt).toEqual(m1.playedAt);
    // un point de courbe par joueur et par match
    expect(out.matchPlayers.filter((mp) => mp.matchId === 'm1')).toHaveLength(4);
  });

  it('est déterministe et indépendant de l ordre du tableau (tri par playedAt)', () => {
    const a = replayRatings(baselines, [m1, m2]);
    const b = replayRatings(baselines, [m2, m1]); // ordre inversé en entrée
    expect(b.players).toEqual(a.players);
  });

  it('retirer un match = « comme s il n avait pas eu lieu »', () => {
    const withBoth = replayRatings(baselines, [m1, m2]);
    const withoutM2 = replayRatings(baselines, [m1]); // m2 « annulé »
    const a = Object.fromEntries(withBoth.players.map((p) => [p.userId, p.displayLevel]));
    const b = Object.fromEntries(withoutM2.players.map((p) => [p.userId, p.displayLevel]));
    expect(b.u1).not.toEqual(a.u1); // l état change quand on enlève un match joué
  });

  it('joueur sans match restant : retombe sur sa calibration', () => {
    const withCal: ReplayBaseline[] = [{ userId: 'solo', initialSelfLevel: 5 }];
    const out = replayRatings(withCal, []); // aucun match
    expect(out.players).toHaveLength(1);
    expect(out.players[0].rating).toBeCloseTo(levelToRating(5), 6);
    expect(out.players[0].matchesPlayed).toBe(0);
    expect(out.players[0].lastMatchAt).toBeNull();
    expect(out.players[0].isProvisional).toBe(true);
  });

  it('initialSelfLevel null => départ neutre (SKIP_DEFAULT_LEVEL)', () => {
    const out = replayRatings([{ userId: 'x', initialSelfLevel: null }], []);
    expect(out.players[0].rating).toBeCloseTo(levelToRating(SKIP_DEFAULT_LEVEL), 6);
  });
});
```

- [ ] **Step 2 : Lancer les tests pour vérifier l'échec**

Run: `cd backend && npm test -- recompute.test.ts`
Expected: FAIL — `Cannot find module '../recompute'`.

- [ ] **Step 3 : Implémenter le cœur pur**

```typescript
// backend/src/services/rating/recompute.ts
import { SetScore } from './score';
import { applyMatchRatings, decayForInactivity, TeamPlayer } from './match-rating';
import { RatingState } from './glicko2';
import {
  DEFAULT_RD, DEFAULT_VOLATILITY, SKIP_DEFAULT_LEVEL,
  isProvisional, levelToRating, ratingToLevel,
} from './level';

export interface ReplayBaseline { userId: string; initialSelfLevel: number | null; }

export interface ReplayMatchInput {
  matchId: string;
  playedAt: Date;
  sets: [number, number][];
  players: { userId: string; team: 1 | 2 }[];
}

export interface ReplayPlayerState {
  userId: string;
  rating: number; rd: number; volatility: number;
  displayLevel: number; isProvisional: boolean;
  matchesPlayed: number; lastMatchAt: Date | null;
}

export interface ReplayMatchPlayerState { matchId: string; userId: string; before: number; after: number; }

export interface ReplayOutput { players: ReplayPlayerState[]; matchPlayers: ReplayMatchPlayerState[]; }

interface Live extends RatingState { last: Date | null; matchesPlayed: number; }

/**
 * Rejoue l'historique des matchs (déjà filtré CONFIRMED) sur des calibrations de départ.
 * Pur et déterministe : aucune dépendance à la DB ni à l'horloge.
 * Réutilise les mêmes primitives que MatchService.finalize, dans l'ordre des playedAt.
 */
export function replayRatings(baselines: ReplayBaseline[], matches: ReplayMatchInput[]): ReplayOutput {
  const live = new Map<string, Live>();
  for (const b of baselines) {
    const rating = levelToRating(b.initialSelfLevel ?? SKIP_DEFAULT_LEVEL);
    live.set(b.userId, { rating, rd: DEFAULT_RD, volatility: DEFAULT_VOLATILITY, last: null, matchesPlayed: 0 });
  }

  const matchPlayers: ReplayMatchPlayerState[] = [];
  const ordered = [...matches].sort((a, b) => a.playedAt.getTime() - b.playedAt.getTime());

  for (const m of ordered) {
    const states: (TeamPlayer & { userId: string; before: number })[] = [];
    for (const p of m.players) {
      const s = live.get(p.userId);
      if (!s) throw new Error(`REPLAY_MISSING_BASELINE:${p.userId}`);
      const days = s.last ? Math.max(0, (m.playedAt.getTime() - s.last.getTime()) / 86400000) : 0;
      const decayed = decayForInactivity({ rating: s.rating, rd: s.rd, volatility: s.volatility }, days);
      states.push({ ...decayed, team: p.team, userId: p.userId, before: ratingToLevel(decayed.rating) });
    }
    const updated = applyMatchRatings(states, m.sets as unknown as SetScore[]);
    for (let i = 0; i < states.length; i++) {
      const s = states[i];
      const u = updated[i];
      const after = ratingToLevel(u.rating);
      matchPlayers.push({ matchId: m.matchId, userId: s.userId, before: s.before, after });
      const cur = live.get(s.userId)!;
      cur.rating = u.rating; cur.rd = u.rd; cur.volatility = u.volatility;
      cur.last = m.playedAt; cur.matchesPlayed += 1;
    }
  }

  const players: ReplayPlayerState[] = [...live.entries()].map(([userId, s]) => ({
    userId,
    rating: s.rating, rd: s.rd, volatility: s.volatility,
    displayLevel: ratingToLevel(s.rating), isProvisional: isProvisional(s.rd),
    matchesPlayed: s.matchesPlayed, lastMatchAt: s.last,
  }));

  return { players, matchPlayers };
}
```

> Note : `applyMatchRatings(states, sets)` — `states` est un `TeamPlayer[]` ; les champs supplémentaires (`userId`, `before`) sont ignorés par la fonction, exactement comme dans `finalize`.

- [ ] **Step 4 : Lancer les tests pour vérifier le succès**

Run: `cd backend && npm test -- recompute.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/rating/recompute.ts backend/src/services/rating/__tests__/recompute.test.ts
git commit -m "feat(niveau): cœur pur de rejeu des niveaux (replayRatings)"
```

---

## Task 3 : Enveloppe DB — `recomputeSportRatings(tx, sportId, extraUserIds)`

Charge depuis la DB, appelle le cœur pur, persiste. Tourne dans la transaction passée par l'appelant.

**Files:**
- Modify: `backend/src/services/rating/recompute.ts` (ajout en fin de fichier)
- Test: `backend/src/services/__tests__/match.service.test.ts` (nouveau `describe`)

- [ ] **Step 1 : Écrire le test qui échoue**

Ajouter à `backend/src/services/__tests__/match.service.test.ts` :

```typescript
import { recomputeSportRatings } from '../rating/recompute';

describe('recomputeSportRatings', () => {
  function txMock(confirmed: any[], ratingRows: any[]) {
    const updated: Record<string, any> = {};
    return {
      match: { findMany: jest.fn().mockResolvedValue(confirmed) },
      playerRating: {
        findMany: jest.fn().mockResolvedValue(ratingRows),
        update: jest.fn().mockImplementation((a: any) => { updated[a.where.userId_sportId.userId] = a.data; return Promise.resolve(a.data); }),
      },
      matchPlayer: { update: jest.fn().mockResolvedValue({}) },
      _updated: updated,
    };
  }

  it('réinitialise + rejoue les confirmés et persiste chaque joueur concerné', async () => {
    const confirmed = [{
      id: 'm1', playedAt: new Date('2026-06-10T10:00:00Z'), sets: [[6, 2], [6, 2]],
      players: [
        { userId: 'u1', team: 1 }, { userId: 'u2', team: 1 },
        { userId: 'u3', team: 2 }, { userId: 'u4', team: 2 },
      ],
    }];
    const ratingRows = ['u1', 'u2', 'u3', 'u4'].map((userId) => ({ userId, initialSelfLevel: null }));
    const tx = txMock(confirmed, ratingRows);
    await recomputeSportRatings(tx as any, 'sport-padel', []);
    // 4 joueurs persistés, 4 points de courbe réécrits
    expect(tx.playerRating.update).toHaveBeenCalledTimes(4);
    expect(tx.matchPlayer.update).toHaveBeenCalledTimes(4);
    expect(tx._updated.u1.matchesPlayed).toBe(1);
    expect(tx._updated.u1.displayLevel).toBeGreaterThan(tx._updated.u3.displayLevel);
  });

  it('inclut extraUserIds (joueurs du match annulé, désormais sans match) et les remet à leur calibration', async () => {
    const tx = txMock([], [{ userId: 'solo', initialSelfLevel: 5 }]);
    await recomputeSportRatings(tx as any, 'sport-padel', ['solo']);
    expect(tx.playerRating.update).toHaveBeenCalledTimes(1);
    expect(tx._updated.solo.matchesPlayed).toBe(0);
    expect(tx._updated.solo.lastMatchAt).toBeNull();
  });
});
```

- [ ] **Step 2 : Lancer le test pour vérifier l'échec**

Run: `cd backend && npm test -- match.service.test.ts -t recomputeSportRatings`
Expected: FAIL — `recomputeSportRatings is not a function` / import manquant.

- [ ] **Step 3 : Implémenter l'enveloppe DB**

Ajouter en fin de `backend/src/services/rating/recompute.ts` :

```typescript
import { Prisma } from '@prisma/client';

/**
 * Recalcule les niveaux d'un sport par rejeu complet des matchs CONFIRMED, dans la transaction `tx`.
 * `extraUserIds` = joueurs à inclure même s'ils n'ont plus de match confirmé (ex. les 4 du match
 * qu'on vient d'annuler) afin qu'ils retombent sur leur calibration.
 */
export async function recomputeSportRatings(
  tx: Prisma.TransactionClient,
  sportId: string,
  extraUserIds: string[] = [],
): Promise<void> {
  const confirmed = await tx.match.findMany({
    where: { sportId, status: 'CONFIRMED' },
    orderBy: { playedAt: 'asc' },
    select: { id: true, playedAt: true, sets: true, players: { select: { userId: true, team: true } } },
  });

  const userIds = new Set<string>(extraUserIds);
  for (const m of confirmed) for (const p of m.players) userIds.add(p.userId);

  const rows = await tx.playerRating.findMany({
    where: { sportId, userId: { in: [...userIds] } },
    select: { userId: true, initialSelfLevel: true },
  });
  const selfLevel = new Map(rows.map((r) => [r.userId, r.initialSelfLevel]));
  const baselines: ReplayBaseline[] = [...userIds].map((userId) => ({
    userId, initialSelfLevel: selfLevel.get(userId) ?? null,
  }));

  const matches: ReplayMatchInput[] = confirmed.map((m) => ({
    matchId: m.id,
    playedAt: m.playedAt,
    sets: m.sets as unknown as [number, number][],
    players: m.players.map((p) => ({ userId: p.userId, team: p.team as 1 | 2 })),
  }));

  const out = replayRatings(baselines, matches);

  for (const p of out.players) {
    await tx.playerRating.update({
      where: { userId_sportId: { userId: p.userId, sportId } },
      data: {
        rating: p.rating, rd: p.rd, volatility: p.volatility,
        displayLevel: p.displayLevel, isProvisional: p.isProvisional,
        matchesPlayed: p.matchesPlayed, lastMatchAt: p.lastMatchAt,
      },
    });
  }
  for (const mp of out.matchPlayers) {
    await tx.matchPlayer.update({
      where: { matchId_userId: { matchId: mp.matchId, userId: mp.userId } },
      data: { ratingBefore: mp.before, ratingAfter: mp.after },
    });
  }
}
```

> `Prisma.TransactionClient` couvre le client transactionnel passé par `prisma.$transaction(async (tx) => …)`.

- [ ] **Step 4 : Lancer le test pour vérifier le succès**

Run: `cd backend && npm test -- match.service.test.ts -t recomputeSportRatings`
Expected: PASS (2 tests).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/rating/recompute.ts backend/src/services/__tests__/match.service.test.ts
git commit -m "feat(niveau): recomputeSportRatings — rejeu DB transactionnel"
```

---

## Task 4 : Action service — `MatchService.voidMatch`

**Files:**
- Modify: `backend/src/services/match.service.ts` (import + nouvelle méthode après `resolveDispute`)
- Test: `backend/src/services/__tests__/match.service.test.ts` (nouveau `describe`)

- [ ] **Step 1 : Écrire les tests qui échouent**

```typescript
describe('voidMatch', () => {
  function txMock(match: any) {
    return {
      match: { findUnique: jest.fn().mockResolvedValue(match), update: jest.fn().mockResolvedValue({}) },
      matchPlayer: { updateMany: jest.fn().mockResolvedValue({}) },
      // surfaces utilisées par recomputeSportRatings si appelé :
      playerRating: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn().mockResolvedValue({}) },
    };
  }
  // recomputeSportRatings lit aussi tx.match.findMany ; on l'ajoute à la volée par test si besoin.

  it('refuse un motif vide (400)', async () => {
    await expect(service.voidMatch('m1', 'c1', 'staff1', '   ')).rejects.toThrow('VALIDATION_ERROR');
  });

  it('refuse un motif trop long (>200)', async () => {
    await expect(service.voidMatch('m1', 'c1', 'staff1', 'x'.repeat(201))).rejects.toThrow('VALIDATION_ERROR');
  });

  it('404 si le match est d un autre club', async () => {
    const tx = txMock({ clubId: 'AUTRE', sportId: 's', status: 'CONFIRMED', ratingsAppliedAt: new Date(), players: [] });
    (prismaMock.$transaction as jest.Mock).mockImplementation((fn: any) => fn(tx));
    await expect(service.voidMatch('m1', 'c1', 'staff1', 'erreur de saisie')).rejects.toThrow('MATCH_NOT_FOUND');
  });

  it('409 si déjà annulé', async () => {
    const tx = txMock({ clubId: 'c1', sportId: 's', status: 'CANCELLED', ratingsAppliedAt: null, players: [] });
    (prismaMock.$transaction as jest.Mock).mockImplementation((fn: any) => fn(tx));
    await expect(service.voidMatch('m1', 'c1', 'staff1', 'erreur de saisie')).rejects.toThrow('ALREADY_CANCELLED');
  });

  it('PENDING : annule, pose l audit, NE recalcule PAS', async () => {
    const tx: any = txMock({ clubId: 'c1', sportId: 's', status: 'PENDING', ratingsAppliedAt: null, players: [{ userId: 'u1' }] });
    tx.match.findMany = jest.fn().mockResolvedValue([]); // garde-fou si recompute appelé par erreur
    (prismaMock.$transaction as jest.Mock).mockImplementation((fn: any) => fn(tx));
    await service.voidMatch('m1', 'c1', 'staff1', 'doublon');
    expect(tx.match.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'CANCELLED', cancelledByUserId: 'staff1', cancelledReason: 'doublon' }),
    }));
    expect(tx.match.findMany).not.toHaveBeenCalled(); // pas de rejeu
    expect(tx.matchPlayer.updateMany).toHaveBeenCalledWith({ where: { matchId: 'm1' }, data: { ratingBefore: null, ratingAfter: null } });
  });

  it('CONFIRMED : annule ET recalcule (lit l historique confirmé)', async () => {
    const tx: any = txMock({ clubId: 'c1', sportId: 's', status: 'CONFIRMED', ratingsAppliedAt: new Date(), players: [{ userId: 'u1' }] });
    tx.match.findMany = jest.fn().mockResolvedValue([]); // historique restant vide
    (prismaMock.$transaction as jest.Mock).mockImplementation((fn: any) => fn(tx));
    await service.voidMatch('m1', 'c1', 'staff1', 'score truqué');
    expect(tx.match.findMany).toHaveBeenCalled(); // recompute déclenché
  });
});
```

- [ ] **Step 2 : Lancer les tests pour vérifier l'échec**

Run: `cd backend && npm test -- match.service.test.ts -t voidMatch`
Expected: FAIL — `service.voidMatch is not a function`.

- [ ] **Step 3 : Implémenter `voidMatch`**

Dans `backend/src/services/match.service.ts`, ajouter l'import en tête :

```typescript
import { recomputeSportRatings } from './rating/recompute';
```

Puis, après `resolveDispute` (avant `finalize`), ajouter :

```typescript
  /** Annulation staff d'un match (scopée club). Motif obligatoire. Recalcule les niveaux si le match était confirmé. */
  async voidMatch(matchId: string, clubId: string, staffUserId: string, reason: string): Promise<void> {
    const trimmed = (reason ?? '').trim();
    if (!trimmed || trimmed.length > 200) throw new Error('VALIDATION_ERROR');

    await prisma.$transaction(async (tx) => {
      const match = await tx.match.findUnique({
        where: { id: matchId },
        select: { clubId: true, sportId: true, status: true, ratingsAppliedAt: true, players: { select: { userId: true } } },
      });
      if (!match || match.clubId !== clubId) throw new Error('MATCH_NOT_FOUND');
      if (match.status === 'CANCELLED') throw new Error('ALREADY_CANCELLED');

      await tx.match.update({
        where: { id: matchId },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledByUserId: staffUserId, cancelledReason: trimmed },
      });
      await tx.matchPlayer.updateMany({ where: { matchId }, data: { ratingBefore: null, ratingAfter: null } });

      if (match.ratingsAppliedAt) {
        await recomputeSportRatings(tx, match.sportId, match.players.map((p) => p.userId));
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
```

- [ ] **Step 4 : Lancer les tests pour vérifier le succès**

Run: `cd backend && npm test -- match.service.test.ts -t voidMatch`
Expected: PASS (6 tests).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/match.service.ts backend/src/services/__tests__/match.service.test.ts
git commit -m "feat(niveau): MatchService.voidMatch — annulation tracée + recalcul si confirmé"
```

---

## Task 5 : Route admin — `POST …/matches/:matchId/void`

**Files:**
- Modify: `backend/src/routes/admin.ts` (après la route `…/matches/:matchId/resolve`, ~ ligne 746)
- Test: `backend/src/routes/__tests__/match-admin.routes.test.ts`

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter à `backend/src/routes/__tests__/match-admin.routes.test.ts` :

```typescript
describe('POST /api/clubs/:clubId/admin/matches/:matchId/void', () => {
  it('annule avec un motif (200) et passe l id staff', async () => {
    const spy = jest.spyOn(require('../../services/match.service').matchService, 'voidMatch').mockResolvedValue(undefined);
    const res = await request(app)
      .post('/api/clubs/c1/admin/matches/m1/void')
      .set('Authorization', `Bearer ${token()}`)
      .send({ reason: 'score truqué' });
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith('m1', 'c1', 'staff1', 'score truqué');
    spy.mockRestore();
  });

  it('400 si motif manquant', async () => {
    jest.spyOn(require('../../services/match.service').matchService, 'voidMatch')
      .mockRejectedValue(new Error('VALIDATION_ERROR'));
    const res = await request(app)
      .post('/api/clubs/c1/admin/matches/m1/void')
      .set('Authorization', `Bearer ${token()}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('404 si match introuvable / autre club', async () => {
    jest.spyOn(require('../../services/match.service').matchService, 'voidMatch')
      .mockRejectedValue(new Error('MATCH_NOT_FOUND'));
    const res = await request(app)
      .post('/api/clubs/c1/admin/matches/mX/void')
      .set('Authorization', `Bearer ${token()}`)
      .send({ reason: 'x' });
    expect(res.status).toBe(404);
  });

  it('409 si déjà annulé', async () => {
    jest.spyOn(require('../../services/match.service').matchService, 'voidMatch')
      .mockRejectedValue(new Error('ALREADY_CANCELLED'));
    const res = await request(app)
      .post('/api/clubs/c1/admin/matches/m1/void')
      .set('Authorization', `Bearer ${token()}`)
      .send({ reason: 'x' });
    expect(res.status).toBe(409);
  });
});
```

> Vérifier en tête de fichier que `matchService` est bien l'instance importée par `admin.ts` (même module `../../services/match.service`). Si `admin.ts` importe `matchService` (instance) — c'est le cas pour `resolveDispute` — le `jest.spyOn` ci-dessus cible la bonne instance.

- [ ] **Step 2 : Lancer les tests pour vérifier l'échec**

Run: `cd backend && npm test -- match-admin.routes.test.ts -t void`
Expected: FAIL — la route renvoie 404 (route inexistante) au lieu des codes attendus / spy jamais appelé.

- [ ] **Step 3 : Implémenter la route**

Dans `backend/src/routes/admin.ts`, juste après la route `…/matches/:matchId/resolve` :

```typescript
router.post('/matches/:matchId/void', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const reason = typeof req.body.reason === 'string' ? req.body.reason : '';
    await matchService.voidMatch(asString(req.params.matchId), asString(req.params.clubId), req.user!.id, reason);
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'VALIDATION_ERROR') { res.status(400).json({ error: 'VALIDATION_ERROR' }); return; }
    if (err instanceof Error && err.message === 'MATCH_NOT_FOUND') { res.status(404).json({ error: 'MATCH_NOT_FOUND' }); return; }
    if (err instanceof Error && err.message === 'ALREADY_CANCELLED') { res.status(409).json({ error: 'ALREADY_CANCELLED' }); return; }
    next(err as Error);
  }
});
```

> `req.user` est disponible : `ClubScopedRequest extends AuthRequest`, et `authMiddleware` s'exécute avant `requireClubMember`.

- [ ] **Step 4 : Lancer les tests pour vérifier le succès**

Run: `cd backend && npm test -- match-admin.routes.test.ts`
Expected: PASS (anciens tests + 4 nouveaux). Puis le run complet : `cd backend && npm test` → vert.

- [ ] **Step 5 : Commit**

```bash
git add backend/src/routes/admin.ts backend/src/routes/__tests__/match-admin.routes.test.ts
git commit -m "feat(niveau): route POST /admin/matches/:id/void"
```

---

## Task 6 : Frontend — client API + champs `cancelled*` + prop `ConfirmDialog`

**Files:**
- Modify: `frontend/lib/api.ts` (helper `voidClubMatch` ; interface `ClubMatch`)
- Modify: `frontend/components/ui/ConfirmDialog.tsx` (prop `confirmDisabled`)

- [ ] **Step 1 : Ajouter le helper API et les champs**

Dans `frontend/lib/api.ts`, après `resolveClubMatch` (~ ligne 86) :

```typescript
  voidClubMatch: (clubId: string, matchId: string, body: { reason: string }, token: string) =>
    request<{ ok: true }>(`/api/clubs/${clubId}/admin/matches/${matchId}/void`, { method: 'POST', body: JSON.stringify(body) }, token),
```

> Vérifier la forme exacte de `request(...)` utilisée par les POST voisins (ex. `resolveClubMatch`) et la recopier (méthode/headers/body identiques).

Et compléter l'interface `ClubMatch` (~ ligne 587) avec les champs optionnels (lecture future / affichage) :

```typescript
  cancelledAt?: string | null;
  cancelledReason?: string | null;
```

- [ ] **Step 2 : Ajouter la prop `confirmDisabled` à `ConfirmDialog`**

Dans `frontend/components/ui/ConfirmDialog.tsx` :
- Ajouter à l'interface : `confirmDisabled?: boolean;`
- Déstructurer avec défaut : `confirmDisabled = false,`
- Sur le bouton de confirmation, combiner avec `busy` : `disabled={busy || confirmDisabled}` (repérer le `<Btn>`/`button` d'action et ajouter la condition).

- [ ] **Step 3 : Vérifier la compilation**

Run: `cd frontend && npx tsc --noEmit`
Expected: pas d'erreur.

- [ ] **Step 4 : Commit**

```bash
git add frontend/lib/api.ts frontend/components/ui/ConfirmDialog.tsx
git commit -m "feat(niveau): api.voidClubMatch + ConfirmDialog.confirmDisabled"
```

---

## Task 7 : Frontend — `/admin/matches` deux segments + annulation avec motif

**Files:**
- Modify: `frontend/app/admin/matches/page.tsx`
- Test: `frontend/__tests__/AdminMatches.test.tsx`

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter à `frontend/__tests__/AdminMatches.test.tsx` (et compléter le mock `lib/api` avec `voidClubMatch`) :

```typescript
const voidClubMatch = jest.fn();
// dans le jest.mock('../lib/api', …) ajouter : voidClubMatch: (...a: unknown[]) => voidClubMatch(...a),
```

```typescript
it('le segment « Matchs confirmés » charge les confirmés et permet d annuler avec motif', async () => {
  voidClubMatch.mockResolvedValue({ ok: true });
  getClubMatches.mockImplementation((_c: string, status: string) =>
    Promise.resolve(status === 'CONFIRMED'
      ? [{ id: 'm9', status: 'CONFIRMED', sets: [[6, 1]], playedAt: '2026-06-09T10:00:00Z', winningTeam: 1, confirmDeadline: '',
          players: [
            { userId: 'u1', team: 1, confirmation: 'CONFIRMED', user: { firstName: 'Alice', lastName: 'A' } },
            { userId: 'u3', team: 2, confirmation: 'CONFIRMED', user: { firstName: 'Carl', lastName: 'C' } },
          ] }]
      : []));
  renderPage();
  // basculer sur le segment confirmés
  fireEvent.click(screen.getByText('Matchs confirmés'));
  expect(await screen.findByText('6-1')).toBeInTheDocument();
  // ouvrir le dialogue d annulation
  fireEvent.click(screen.getByText('Annuler le match'));
  // saisir un motif puis confirmer
  fireEvent.change(screen.getByPlaceholderText(/motif/i), { target: { value: 'score truqué' } });
  fireEvent.click(screen.getByText('Annuler le match', { selector: 'button' }) ?? screen.getByText('Confirmer'));
  await waitFor(() => expect(voidClubMatch).toHaveBeenCalledWith('c1', 'm9', { reason: 'score truqué' }, 'tok'));
});
```

> Adapter les libellés exacts (texte du bouton de confirmation du `ConfirmDialog`, placeholder du champ) à l'implémentation de l'étape 3 ; garder les sélecteurs cohérents avec ce que tu rends.

- [ ] **Step 2 : Lancer les tests pour vérifier l'échec**

Run: `cd frontend && npm test -- AdminMatches`
Expected: FAIL — pas de texte « Matchs confirmés ».

- [ ] **Step 3 : Implémenter les segments + le dialogue**

Réécrire `frontend/app/admin/matches/page.tsx` pour :
- un état `tab: 'DISPUTED' | 'CONFIRMED'` (défaut `'DISPUTED'` — préserve les tests existants), avec deux boutons-segments stylés (réutiliser le style inline existant ; le segment actif sur `th.accent`/`th.onAccent`) ;
- `reload` charge `getClubMatches(club.id, tab, token)` (dépendances `[club?.id, token, tab]`) ;
- segment `DISPUTED` : rendu **inchangé** (titre « Litiges de matchs », boutons Valider/Annuler via `resolve`) ;
- segment `CONFIRMED` : même carte (score/équipes/date) + un seul bouton **« Annuler le match »** qui ouvre un `ConfirmDialog` ; état vide « Aucun match confirmé. » ;
- état du dialogue : `voiding: ClubMatch | null` + `reason: string` + `busy` ; le `ConfirmDialog` rend un `<textarea placeholder="Motif de l'annulation (obligatoire)" …>` via la prop `message`, `confirmLabel="Annuler le match"`, `confirmDisabled={!reason.trim()}`, `onConfirm` appelle `api.voidClubMatch(club.id, voiding.id, { reason: reason.trim() }, token)` puis recharge et ferme.

Exemple du cœur du segment confirmés + dialogue (à intégrer dans le composant) :

```tsx
const [tab, setTab] = useState<'DISPUTED' | 'CONFIRMED'>('DISPUTED');
const [voiding, setVoiding] = useState<ClubMatch | null>(null);
const [reason, setReason] = useState('');

const reload = useCallback(() => {
  if (!club || !token) return;
  api.getClubMatches(club.id, tab, token).then(setList).catch(() => setList([]));
}, [club?.id, token, tab]);

const doVoid = async () => {
  if (!voiding || !club || !token) return;
  setBusy(voiding.id); setError(null);
  try {
    await api.voidClubMatch(club.id, voiding.id, { reason: reason.trim() }, token);
    setVoiding(null); setReason(''); reload();
  } catch (e) { setError((e as Error).message); }
  finally { setBusy(null); }
};

// … boutons-segments :
// <button onClick={() => { setTab('DISPUTED'); }}>Litiges</button>
// <button onClick={() => { setTab('CONFIRMED'); }}>Matchs confirmés</button>

// … dans la carte du segment CONFIRMED :
// <button onClick={() => { setVoiding(m); setReason(''); }}>Annuler le match</button>

// … en bas du composant :
{voiding && (
  <ConfirmDialog
    title="Annuler ce match ?"
    detail={`${scoreLine(voiding.sets)} · ${new Date(voiding.playedAt).toLocaleDateString('fr-FR')}`}
    message={
      <>
        <p>L&apos;annulation recalcule les niveaux des joueurs concernés et retire le match de leur courbe de progression.</p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Motif de l'annulation (obligatoire)"
          maxLength={200}
          rows={3}
          style={{ width: '100%', marginTop: 10, fontFamily: th.fontUI, padding: 10, borderRadius: 10, border: `1px solid ${th.line}`, background: th.surface, color: th.text }}
        />
      </>
    }
    confirmLabel="Annuler le match"
    cancelLabel="Retour"
    busy={busy === voiding.id}
    confirmDisabled={!reason.trim()}
    onConfirm={doVoid}
    onCancel={() => { setVoiding(null); setReason(''); }}
  />
)}
```

> Le `Btn` danger du `ConfirmDialog` portera le libellé « Annuler le match » ; veiller à ce que le bouton « Annuler le match » de la carte (qui ouvre le dialogue) et celui du dialogue (qui confirme) ne créent pas d'ambiguïté de sélecteur dans le test — préférer dans le test un `getAllByText` ou cibler le bouton du dialogue par son rôle.

- [ ] **Step 4 : Lancer les tests pour vérifier le succès**

Run: `cd frontend && npm test -- AdminMatches`
Expected: PASS (3 anciens tests + le nouveau). Ajuster les sélecteurs du test si besoin pour lever toute ambiguïté de libellé.

- [ ] **Step 5 : Vérifier la compilation et le build**

Run: `cd frontend && npx tsc --noEmit`
Expected: pas d'erreur.

- [ ] **Step 6 : Commit**

```bash
git add frontend/app/admin/matches/page.tsx frontend/__tests__/AdminMatches.test.tsx
git commit -m "feat(niveau): /admin/matches — annuler un match confirmé avec motif"
```

---

## Vérification finale (avant revue)

- [ ] `cd backend && npm test` → vert (gate complet).
- [ ] `cd frontend && npm test` → vert.
- [ ] `cd backend && npx tsc --noEmit` et `cd frontend && npx tsc --noEmit` → propres.
- [ ] Migration `add_match_cancellation` appliquée en dev (`npm run db:migrate`).
- [ ] Relire le diff : pas de fichier WIP utilisateur embarqué (`frontend/components/clubhouse/PartnerOffers.tsx` ne doit PAS être commité).

## Notes de couverture (spec → tâches)

- Périmètre « annuler, pas d'override » : design — aucune tâche d'override (volontaire). ✅
- Rejeu pur déterministe : Task 2. ✅
- Recalcul DB transactionnel + réinit calibration : Task 3. ✅
- Annulation tracée (audit) + recompute conditionnel + scope/idempotence/motif : Tasks 1, 4, 5. ✅
- UI deux segments + motif obligatoire : Tasks 6, 7. ✅
- Courbe exclut les annulés : déjà acquis (`GET /me/rating/history` filtre `CONFIRMED`) — pas de code, vérifié implicitement. ✅
