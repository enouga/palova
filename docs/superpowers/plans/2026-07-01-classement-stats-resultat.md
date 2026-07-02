# Stats de résultat + classement en tête du Classement — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Afficher, dans le bandeau « moi » en tête de l'onglet Classement, les stats de résultat du joueur (V/D, taux de victoire, matchs joués, série en cours) scopées à ce club, en plus de son rang.

**Architecture:** Un helper pur backend `computeResultStats` calcule bilan + série à partir des `MatchPlayer`. `club.service.clubLeaderboard` fait une requête `matchPlayer` supplémentaire pour l'appelant et enrichit le payload `me` (champs additifs `wins`/`losses`/`streak`). Le composant `Leaderboard.tsx` rend une rangée de stats sous la ligne de rang, dès que `wins+losses>0`.

**Tech Stack:** Backend Express + Prisma + Jest ; Frontend Next.js/React + React Testing Library. Tests exécutés depuis le worktree (`node_modules` en jonction depuis `main`).

**Spec :** `docs/superpowers/specs/2026-07-01-classement-stats-resultat-design.md`

---

## Task 1 : Helper pur `computeResultStats`

**Files:**
- Create: `backend/src/services/rating/resultStats.ts`
- Test: `backend/src/services/rating/__tests__/resultStats.test.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

Create `backend/src/services/rating/__tests__/resultStats.test.ts` :

```ts
import { computeResultStats } from '../resultStats';

// rows triés par playedAt DÉCROISSANT (plus récent en premier).
const d = (s: string) => new Date(s);

describe('computeResultStats', () => {
  it('bilan V/D + série de victoires en tête', () => {
    const res = computeResultStats([
      { team: 1, winningTeam: 1, playedAt: d('2026-06-05') }, // W (le + récent)
      { team: 1, winningTeam: 1, playedAt: d('2026-06-04') }, // W
      { team: 1, winningTeam: 1, playedAt: d('2026-06-03') }, // W
      { team: 1, winningTeam: 2, playedAt: d('2026-06-02') }, // L
    ]);
    expect(res).toEqual({ wins: 3, losses: 1, streak: 3 });
  });

  it('série de défaites → streak négatif', () => {
    const res = computeResultStats([
      { team: 2, winningTeam: 1, playedAt: d('2026-06-05') }, // L
      { team: 2, winningTeam: 1, playedAt: d('2026-06-04') }, // L
      { team: 2, winningTeam: 2, playedAt: d('2026-06-03') }, // W
    ]);
    expect(res).toEqual({ wins: 1, losses: 2, streak: -2 });
  });

  it('série mixte : streak = suite consécutive de tête seulement', () => {
    const res = computeResultStats([
      { team: 1, winningTeam: 1, playedAt: d('2026-06-05') }, // W
      { team: 1, winningTeam: 2, playedAt: d('2026-06-04') }, // L
      { team: 1, winningTeam: 1, playedAt: d('2026-06-03') }, // W
    ]);
    expect(res).toEqual({ wins: 2, losses: 1, streak: 1 });
  });

  it('ignore les matchs non décidés (winningTeam null)', () => {
    const res = computeResultStats([
      { team: 1, winningTeam: null, playedAt: d('2026-06-05') }, // en attente → ignoré
      { team: 1, winningTeam: 1, playedAt: d('2026-06-04') },    // W
      { team: 1, winningTeam: 1, playedAt: d('2026-06-03') },    // W
    ]);
    expect(res).toEqual({ wins: 2, losses: 0, streak: 2 });
  });

  it('aucun match décidé → 0/0/0', () => {
    expect(computeResultStats([])).toEqual({ wins: 0, losses: 0, streak: 0 });
    expect(computeResultStats([{ team: 1, winningTeam: null, playedAt: d('2026-06-05') }]))
      .toEqual({ wins: 0, losses: 0, streak: 0 });
  });
});
```

- [ ] **Step 2 : Lancer le test, vérifier l'échec**

Run: `cd backend && npx jest resultStats -c jest.config.js`
Expected: FAIL — `Cannot find module '../resultStats'`.

- [ ] **Step 3 : Écrire l'implémentation minimale**

Create `backend/src/services/rating/resultStats.ts` :

```ts
export interface ResultStatRow {
  team: number;
  winningTeam: number | null;
  playedAt: Date;
}

export interface ResultStats {
  wins: number;
  losses: number;
  /** Entier signé : +N victoires d'affilée en tête, -N défaites, 0 si aucune. */
  streak: number;
}

/**
 * Bilan V/D + série en cours d'un joueur, à partir de ses lignes de match
 * TRIÉES par playedAt DÉCROISSANT (plus récent en premier).
 * Seuls les matchs décidés (winningTeam != null) sont pris en compte.
 */
export function computeResultStats(rows: ResultStatRow[]): ResultStats {
  const decided = rows.filter((r) => r.winningTeam != null);
  let wins = 0;
  let losses = 0;
  for (const r of decided) {
    if (r.winningTeam === r.team) wins++;
    else losses++;
  }
  let streak = 0;
  for (const r of decided) {
    const won = r.winningTeam === r.team;
    if (streak === 0) streak = won ? 1 : -1;
    else if (won && streak > 0) streak++;
    else if (!won && streak < 0) streak--;
    else break;
  }
  return { wins, losses, streak };
}
```

- [ ] **Step 4 : Lancer le test, vérifier le succès**

Run: `cd backend && npx jest resultStats -c jest.config.js`
Expected: PASS (5 tests).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/rating/resultStats.ts backend/src/services/rating/__tests__/resultStats.test.ts
git commit -m "feat(classement): helper pur computeResultStats (bilan V/D + série)"
```

---

## Task 2 : Enrichir `clubLeaderboard` avec les stats de résultat

**Files:**
- Modify: `backend/src/services/club.service.ts` (import + fonction `clubLeaderboard`, ~ll. 475-540)
- Test: `backend/src/services/__tests__/club.service.test.ts` (bloc `describe('clubLeaderboard', …)`, ~ll. 206-267)

- [ ] **Step 1 : Mettre à jour les tests existants + ajouter le test des stats**

Dans `backend/src/services/__tests__/club.service.test.ts`, remplacer le helper `mockBase` (l. 210-214) pour mocker aussi `matchPlayer.findMany` par défaut (aucun match → 0/0/0) :

```ts
  function mockBase() {
    prismaMock.club.findUnique.mockResolvedValue(activeClub as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-padel' } as any);
    prismaMock.matchPlayer.findMany.mockResolvedValue([] as any);
  }
```

Mettre à jour les 3 assertions `toEqual` de `res.me` pour inclure les nouveaux champs `wins/losses/streak` :

- l. 228 →
```ts
    expect(res.me).toEqual({ optedIn: true, ranked: true, rank: 1, level: 6.2, matchesPlayed: 30, matchesToGo: 0, wins: 0, losses: 0, streak: 0 });
```
- l. 238 →
```ts
    expect(res.me).toEqual({ optedIn: true, ranked: false, rank: null, level: 3.4, matchesPlayed: 3, matchesToGo: 2, wins: 0, losses: 0, streak: 0 });
```
- l. 247 →
```ts
    expect(res.me).toEqual({ optedIn: false, ranked: false, rank: null, level: null, matchesPlayed: 0, matchesToGo: 5, wins: 0, losses: 0, streak: 0 });
```

Ajouter, juste après le test `me non opté` (après l. 248), le nouveau test :

```ts
  it('me : bilan V/D + série depuis les matchs du club', async () => {
    mockBase();
    prismaMock.clubMembership.findMany.mockResolvedValue([] as any);
    prismaMock.user.findUnique.mockResolvedValue({ showInLeaderboard: true, playerRatings: [{ displayLevel: 5.2, matchesPlayed: 25 }] } as any);
    // desc : 3 victoires récentes puis 1 défaite → wins 3, losses 1, streak 3
    prismaMock.matchPlayer.findMany.mockResolvedValue([
      { team: 1, match: { winningTeam: 1, playedAt: new Date('2026-06-05') } },
      { team: 1, match: { winningTeam: 1, playedAt: new Date('2026-06-04') } },
      { team: 1, match: { winningTeam: 1, playedAt: new Date('2026-06-03') } },
      { team: 1, match: { winningTeam: 2, playedAt: new Date('2026-06-02') } },
    ] as any);

    const res = await service.clubLeaderboard('padel-arena', 'u1', 'padel');
    expect(res.me).toEqual({ optedIn: true, ranked: false, rank: null, level: 5.2, matchesPlayed: 25, matchesToGo: 0, wins: 3, losses: 1, streak: 3 });
    // Scoping : requête matchPlayer filtrée club + sport + confirmés
    expect(prismaMock.matchPlayer.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'u1', match: { clubId: 'club-1', status: 'CONFIRMED', sport: { key: 'padel' } } },
    }));
  });
```

- [ ] **Step 2 : Lancer le bloc de tests, vérifier l'échec**

Run: `cd backend && npx jest club.service -c jest.config.js -t clubLeaderboard`
Expected: FAIL — le nouveau test attend `wins/losses/streak` (absents) et les `toEqual` mis à jour ne matchent pas encore.

- [ ] **Step 3 : Implémenter l'enrichissement du service**

Dans `backend/src/services/club.service.ts`, ajouter l'import (après la ligne 8 `import { namedTier, MIN_RANKED_MATCHES } from './rating/level';`) :

```ts
import { computeResultStats } from './rating/resultStats';
```

Puis, dans `clubLeaderboard`, remplacer le bloc `const me = { … };` + `return …` (ll. 530-539) par :

```ts
    const myMatches = await prisma.matchPlayer.findMany({
      where: { userId: callerUserId, match: { clubId: club.id, status: 'CONFIRMED', sport: { key: sportKey } } },
      orderBy: { match: { playedAt: 'desc' } },
      select: { team: true, match: { select: { winningTeam: true, playedAt: true } } },
    });
    const stats = computeResultStats(
      myMatches.map((mp) => ({ team: mp.team, winningTeam: mp.match.winningTeam, playedAt: mp.match.playedAt })),
    );

    const me = {
      optedIn: meUser?.showInLeaderboard ?? false,
      ranked: myRank !== null,
      rank: myRank,
      level: myRating?.displayLevel ?? null,
      matchesPlayed,
      matchesToGo: Math.max(0, MIN_RANKED_MATCHES - matchesPlayed),
      wins: stats.wins,
      losses: stats.losses,
      streak: stats.streak,
    };

    return { sport: sportKey, entries, me };
```

- [ ] **Step 4 : Lancer les tests, vérifier le succès**

Run: `cd backend && npx jest club.service -c jest.config.js`
Expected: PASS (tout le fichier, y compris le nouveau test et les `toEqual` mis à jour).

- [ ] **Step 5 : Vérifier la compilation TypeScript**

Run: `cd backend && npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 6 : Commit**

```bash
git add backend/src/services/club.service.ts backend/src/services/__tests__/club.service.test.ts
git commit -m "feat(classement): expose wins/losses/streak (club) dans le payload me du leaderboard"
```

---

## Task 3 : Rangée de stats dans `Leaderboard.tsx`

**Files:**
- Modify: `frontend/lib/api.ts` (interface `LeaderboardMe`, ~ll. 1842-1849)
- Modify: `frontend/components/openmatch/Leaderboard.tsx`
- Test: `frontend/__tests__/Leaderboard.test.tsx`

- [ ] **Step 1 : Étendre le type `LeaderboardMe`**

Dans `frontend/lib/api.ts`, remplacer l'interface `LeaderboardMe` (ll. 1842-1849) par :

```ts
export interface LeaderboardMe {
  optedIn: boolean;
  ranked: boolean;
  rank: number | null;
  level: number | null;
  matchesPlayed: number;
  matchesToGo: number;
  wins: number;
  losses: number;
  streak: number; // signé : +N victoires d'affilée, -N défaites, 0 aucune
}
```

- [ ] **Step 2 : Écrire les tests front (échec attendu)**

Dans `frontend/__tests__/Leaderboard.test.tsx`, mettre à jour le `me` par défaut du helper `payload()` (l. 35) pour inclure les nouveaux champs :

```ts
    me: { optedIn: true, ranked: true, rank: 1, level: 6.2, matchesPlayed: 30, matchesToGo: 0, wins: 0, losses: 0, streak: 0 },
```

Ajouter ces deux tests à la fin du fichier (avant la dernière `});` de clôture du fichier) :

```ts
it('bandeau moi : rangée de stats V/D quand il y a des matchs', async () => {
  getClubLeaderboard.mockResolvedValue(payload({
    me: { optedIn: true, ranked: true, rank: 3, level: 5.2, matchesPlayed: 25, matchesToGo: 0, wins: 18, losses: 7, streak: 3 },
  }));
  wrap(<Leaderboard club={club} viewerUserId="u1" />);
  await screen.findByText(/25 matchs/i);
  expect(screen.getByText(/72\s*% de victoires/i)).toBeInTheDocument();
  expect(screen.getByText(/18 V/)).toBeInTheDocument();
  expect(screen.getByText(/3 victoires d'affilée/i)).toBeInTheDocument();
});

it('bandeau moi : pas de rangée de stats sans match décidé', async () => {
  getClubLeaderboard.mockResolvedValue(payload({
    entries: [],
    me: { optedIn: true, ranked: false, rank: null, level: 5.0, matchesPlayed: 9, matchesToGo: 0, wins: 0, losses: 0, streak: 0 },
  }));
  wrap(<Leaderboard club={club} viewerUserId="u9" />);
  await screen.findByText(/Aucun joueur classé/i);
  expect(screen.queryByText(/de victoires/i)).toBeNull();
});
```

- [ ] **Step 3 : Lancer les tests, vérifier l'échec**

Run: `cd frontend && npx jest Leaderboard`
Expected: FAIL — « 25 matchs » / « 72 % de victoires » introuvables (rangée pas encore rendue).

- [ ] **Step 4 : Implémenter la rangée de stats**

Dans `frontend/components/openmatch/Leaderboard.tsx` :

1. Ajouter `ACCENTS` à l'import du thème (l. 4) :
```ts
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
```

2. Juste après `const { entries, me } = data;` (l. 77), ajouter les dérivés :
```ts
  const decided = (me.wins ?? 0) + (me.losses ?? 0);
  const winRate = decided > 0 ? Math.round((me.wins / decided) * 100) : 0;
  const streakN = Math.abs(me.streak ?? 0);
  const streakWin = (me.streak ?? 0) > 0;
```

3. Remplacer le conteneur du panneau « moi » (l. 105) pour l'empiler en colonne :
```tsx
      {/* Panneau « moi » */}
      <div style={{ ...card, background: th.accent, color: th.onAccent, boxShadow: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
```

4. Juste avant le `</div>` de fermeture de ce panneau (la ligne `</div>` située après le bloc conditionnel `me.ranked ? … : …`, avant le commentaire `{/* Liste */}`), insérer la rangée de stats :
```tsx
        {decided > 0 && (
          <div style={{ borderTop: `1px solid ${th.onAccent}33`, paddingTop: 10, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 14px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>
            <span>{decided} match{decided > 1 ? 's' : ''}</span>
            <span>{winRate}% de victoires</span>
            <span>{me.wins} V · {me.losses} D</span>
            {streakN > 0 && (
              <span style={{ borderRadius: 999, padding: '2px 9px', fontSize: 12.5, fontWeight: 700, background: streakWin ? th.onAccent : ACCENTS.coral, color: streakWin ? th.accent : '#fff' }}>
                {streakN} {streakWin ? 'victoire' : 'défaite'}{streakN > 1 ? 's' : ''} d&apos;affilée
              </span>
            )}
          </div>
        )}
```

- [ ] **Step 5 : Lancer les tests, vérifier le succès**

Run: `cd frontend && npx jest Leaderboard`
Expected: PASS (9 tests : les 7 existants + les 2 nouveaux).

- [ ] **Step 6 : Vérifier la compilation TypeScript**

Run: `cd frontend && npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 7 : Commit**

```bash
git add frontend/lib/api.ts frontend/components/openmatch/Leaderboard.tsx frontend/__tests__/Leaderboard.test.tsx
git commit -m "feat(classement): rangée de stats de résultat (V/D, taux, série) dans le bandeau moi"
```

---

## Vérification finale

- [ ] `cd backend && npx jest resultStats club.service -c jest.config.js` → tout PASS
- [ ] `cd frontend && npx jest Leaderboard` → tout PASS
- [ ] `cd backend && npx tsc --noEmit` et `cd frontend && npx tsc --noEmit` → aucune erreur
- [ ] (Optionnel, manuel) Onglet Classement d'une partie : le bandeau « moi » affiche « N matchs · X% de victoires · V·D » + la pastille de série quand le joueur a des matchs confirmés dans le club.

## Notes d'exécution

- **Champs additifs uniquement**, aucune migration DB.
- **Rétro-compatibilité** : sans stats (`wins+losses===0`), la rangée n'est pas rendue → contrat de rendu existant (rang, CTA opt-in, état vide) préservé.
- Commits ciblés (fichiers explicites) — l'utilisateur édite le repo en parallèle ; ne jamais `git add -A`.
