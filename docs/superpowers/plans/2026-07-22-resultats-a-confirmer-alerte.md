# Alerte « Résultats à confirmer » Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter une carte `ResultsToConfirm` (miroir de `ResultsToRecord`) qui alerte proactivement un joueur des matchs padel où quelqu'un d'autre a saisi un score et où sa confirmation est encore en attente, sur les mêmes 3 surfaces que « Résultats à saisir ».

**Architecture:** Un endpoint backend léger dédié (`GET /api/me/matches/to-confirm`, miroir de `/matches/to-record`) renvoie les matchs `PENDING` où ma `MatchPlayer.confirmation` est `PENDING`. Un composant frontend autonome (`ResultsToConfirm.tsx`) affiche ces matchs avec un bouton Confirmer (1 clic) et Contester (motif obligatoire, réutilise les routes `confirm`/`dispute` déjà existantes) ; il est posé au-dessus de `ResultsToRecord` sur Mon Palova, Club-house et `/parties` (les deux onglets).

**Tech Stack:** Node/Express/Prisma (backend), Next.js/React/TypeScript (frontend), Jest partout.

**Spec:** `docs/superpowers/specs/2026-07-22-resultats-a-confirmer-alerte-design.md`

---

## Contexte pour l'exécutant

- Le flux `confirm`/`dispute`/`finalize` existe déjà dans `backend/src/services/match.service.ts`
  (méthodes `MatchService.confirm`, `MatchService.dispute`) et les routes
  `POST /api/matches/:id/{confirm,dispute}` existent déjà — **ce plan ne les touche pas**.
- Ce plan ajoute UNIQUEMENT : une méthode de lecture (`listToConfirm`), une route de lecture
  (`GET /api/me/matches/to-confirm`), et un composant frontend qui consomme ces deux existants +
  ce nouveau.
- **Piège Windows/Jest connu** : `npx jest <chemin>` traite l'argument comme un motif, pas un
  chemin exact — sur un système de fichiers insensible à la casse, `resultsToConfirm.test.ts` et
  `ResultsToConfirm.test.tsx` se collisionnent tous les deux. Utiliser
  `npx jest --runTestsByPath <chemin exact>` pour cibler un seul fichier dans ce plan.
- Tous les chemins sont relatifs à `C:\ProjetsIA\05_PERSO\RESERVE\palova`.

---

### Task 1: Backend — `MatchService.listToConfirm`

**Files:**
- Modify: `backend/src/services/match.service.ts`
- Test: `backend/src/services/__tests__/match.service.test.ts`

- [ ] **Step 1: Write the failing test**

Ajouter ce bloc `describe` à la fin de `backend/src/services/__tests__/match.service.test.ts` (après le
`describe('remind', ...)` existant, donc en toute fin de fichier) :

```ts
describe('listToConfirm', () => {
  const matchRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
    match: {
      id: 'm1', playedAt: new Date('2026-07-20T18:00:00Z'), sets: [[6, 4], [6, 2]],
      competitive: true, confirmDeadline: new Date('2026-07-23T18:00:00Z'),
      club: { slug: 'arena', name: 'Padel Arena', timezone: 'Europe/Paris' },
      reservation: { resource: { name: 'Court 1' } },
      players: [
        { userId: 'u1', team: 1, user: { firstName: 'Lucas', lastName: 'Moreau', avatarUrl: null } },
        { userId: 'u2', team: 1, user: { firstName: 'Jean', lastName: 'Dupont', avatarUrl: null } },
        { userId: 'u3', team: 2, user: { firstName: 'Celine', lastName: 'Barbier', avatarUrl: null } },
        { userId: 'u4', team: 2, user: { firstName: 'Melanie', lastName: 'Bernard', avatarUrl: null } },
      ],
      ...overrides,
    },
  });

  it('renvoie un match en attente de ma confirmation avec club/terrain/joueurs', async () => {
    prismaMock.matchPlayer.findMany.mockResolvedValue([matchRow()] as any);
    const rows = await service.listToConfirm('u4');
    expect(rows).toHaveLength(1);
    expect(rows[0].matchId).toBe('m1');
    expect(rows[0].club.slug).toBe('arena');
    expect(rows[0].resourceName).toBe('Court 1');
    expect(rows[0].competitive).toBe(true);
    expect(rows[0].players).toHaveLength(4);
    expect(rows[0].players.find((p) => p.userId === 'u3')!.team).toBe(2);
  });

  it('resourceName null si la réservation source a été supprimée', async () => {
    prismaMock.matchPlayer.findMany.mockResolvedValue([matchRow({ reservation: null })] as any);
    const rows = await service.listToConfirm('u4');
    expect(rows[0].resourceName).toBeNull();
  });

  it('filtre sur ma confirmation PENDING et le match PENDING, trié par échéance croissante', async () => {
    prismaMock.matchPlayer.findMany.mockResolvedValue([] as any);
    await service.listToConfirm('u4');
    const arg = (prismaMock.matchPlayer.findMany as jest.Mock).mock.calls[0][0];
    expect(arg.where).toEqual({ userId: 'u4', confirmation: 'PENDING', match: { status: 'PENDING' } });
    expect(arg.orderBy).toEqual({ match: { confirmDeadline: 'asc' } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest --runTestsByPath src/services/__tests__/match.service.test.ts`
Expected: FAIL — `TypeError: service.listToConfirm is not a function` (les 3 nouveaux tests échouent, tous les autres tests du fichier restent verts).

- [ ] **Step 3: Write minimal implementation**

Dans `backend/src/services/match.service.ts`, ajouter cette méthode publique juste après
`listToRecord` (donc entre la fin de `listToRecord` et le commentaire `/** Exécute un envoi
d'email en best-effort... */` qui précède `safeNotify`) :

```ts
  /**
   * Matchs PENDING en attente de MA confirmation (= `needsMyConfirmation` de l'historique
   * complet /api/me/matches), triés par échéance croissante (le plus urgent d'abord). DTO
   * léger, pensé pour l'alerte proactive — pas l'historique complet.
   */
  async listToConfirm(userId: string) {
    const rows = await prisma.matchPlayer.findMany({
      where: { userId, confirmation: 'PENDING', match: { status: 'PENDING' } },
      orderBy: { match: { confirmDeadline: 'asc' } },
      select: {
        match: {
          select: {
            id: true, playedAt: true, sets: true, competitive: true, confirmDeadline: true,
            club: { select: { slug: true, name: true, timezone: true } },
            reservation: { select: { resource: { select: { name: true } } } },
            players: {
              select: {
                userId: true, team: true,
                user: { select: { firstName: true, lastName: true, avatarUrl: true } },
              },
            },
          },
        },
      },
    });

    return rows.map((r) => ({
      matchId: r.match.id,
      playedAt: r.match.playedAt,
      sets: r.match.sets,
      competitive: r.match.competitive,
      confirmDeadline: r.match.confirmDeadline,
      club: r.match.club,
      resourceName: r.match.reservation?.resource?.name ?? null,
      players: r.match.players.map((p) => ({
        userId: p.userId, team: p.team,
        firstName: p.user.firstName, lastName: p.user.lastName, avatarUrl: p.user.avatarUrl,
      })),
    }));
  }

```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest --runTestsByPath src/services/__tests__/match.service.test.ts`
Expected: PASS — tous les tests du fichier (existants + 3 nouveaux) sont verts.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/match.service.ts backend/src/services/__tests__/match.service.test.ts
git commit -m "feat(match): ajoute MatchService.listToConfirm (matchs en attente de ma confirmation)"
```

---

### Task 2: Backend — route `GET /api/me/matches/to-confirm`

**Files:**
- Modify: `backend/src/routes/me.ts`
- Test: `backend/src/routes/__tests__/me.routes.test.ts`

- [ ] **Step 1: Write the failing test**

Dans `backend/src/routes/__tests__/me.routes.test.ts`, ajouter ce bloc juste après le
`describe('GET /api/me/matches/to-record', ...)` existant (donc avant `describe('statut
légal', ...)`) :

```ts
describe('GET /api/me/matches/to-confirm', () => {
  it('401 sans token', async () => {
    const res = await request(app).get('/api/me/matches/to-confirm');
    expect(res.status).toBe(401);
  });

  it('renvoie la liste des matchs en attente de ma confirmation', async () => {
    prismaMock.matchPlayer.findMany.mockResolvedValue([{
      match: {
        id: 'm1', playedAt: new Date('2026-07-20T18:00:00Z'), sets: [[6, 4], [6, 2]],
        competitive: true, confirmDeadline: new Date('2026-07-23T18:00:00Z'),
        club: { slug: 'arena', name: 'Padel Arena', timezone: 'Europe/Paris' },
        reservation: { resource: { name: 'Court 1' } },
        players: [
          { userId: 'u1', team: 1, user: { firstName: 'Lucas', lastName: 'Moreau', avatarUrl: null } },
          { userId: 'u2', team: 1, user: { firstName: 'Jean', lastName: 'Dupont', avatarUrl: null } },
          { userId: 'u3', team: 2, user: { firstName: 'Celine', lastName: 'Barbier', avatarUrl: null } },
          { userId: 'u4', team: 2, user: { firstName: 'Melanie', lastName: 'Bernard', avatarUrl: null } },
        ],
      },
    }] as any);
    const res = await request(app).get('/api/me/matches/to-confirm').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].matchId).toBe('m1');
    expect(res.body[0].players).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest --runTestsByPath src/routes/__tests__/me.routes.test.ts`
Expected: FAIL — 404 (route inexistante) sur les deux nouveaux tests.

- [ ] **Step 3: Write minimal implementation**

Dans `backend/src/routes/me.ts`, la route existante ressemble à ceci (autour de la ligne 319) :

```ts
// Réservations padel jouées, prêtes à saisir (participant, pas seulement organisateur).
router.get('/matches/to-record', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await matchService.listToRecord(req.user!.id, new Date()));
  } catch (err) { next(err); }
});
```

Ajouter la nouvelle route juste après (avant le commentaire `// Portefeuille cross-club...`) :

```ts
// Matchs en attente de MA confirmation (alerte, DTO léger — historique complet sur /matches).
router.get('/matches/to-confirm', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await matchService.listToConfirm(req.user!.id));
  } catch (err) { next(err); }
});

```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest --runTestsByPath src/routes/__tests__/me.routes.test.ts`
Expected: PASS — tous les tests du fichier sont verts.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/me.ts backend/src/routes/__tests__/me.routes.test.ts
git commit -m "feat(match): route GET /api/me/matches/to-confirm"
```

---

### Task 3: Frontend — types + méthode API

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Ajouter la méthode API**

Dans `frontend/lib/api.ts`, la ligne existante (autour de la ligne 128) :

```ts
  getMatchesToRecord: (token: string) => request<MatchToRecord[]>('/api/me/matches/to-record', {}, token),
```

devient (nouvelle ligne ajoutée juste après) :

```ts
  getMatchesToRecord: (token: string) => request<MatchToRecord[]>('/api/me/matches/to-record', {}, token),
  getMatchesToConfirm: (token: string) => request<MatchToConfirm[]>('/api/me/matches/to-confirm', {}, token),
```

- [ ] **Step 2: Ajouter les types**

Dans `frontend/lib/api.ts`, le bloc de types existant (autour de la ligne 1360-1370) :

```ts
export interface MatchToRecord {
  reservationId: string;
  startTime: string;
  endTime: string;
  competitive?: boolean;
  visibility?: 'PRIVATE' | 'PUBLIC';
  club: { slug: string; name: string; timezone: string };
  resourceName: string;
  sport: { key: string; name: string };
  players: MatchToRecordPlayer[];
}
```

devient (nouveau bloc ajouté juste après, avant `export interface ClubMatchPlayer`) :

```ts
export interface MatchToRecord {
  reservationId: string;
  startTime: string;
  endTime: string;
  competitive?: boolean;
  visibility?: 'PRIVATE' | 'PUBLIC';
  club: { slug: string; name: string; timezone: string };
  resourceName: string;
  sport: { key: string; name: string };
  players: MatchToRecordPlayer[];
}

export interface MatchToConfirmPlayer {
  userId: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  team: 1 | 2;
}

export interface MatchToConfirm {
  matchId: string;
  playedAt: string;
  sets: [number, number][];
  competitive: boolean;
  confirmDeadline: string;
  club: { slug: string; name: string; timezone: string };
  resourceName: string | null;
  players: MatchToConfirmPlayer[];
}
```

- [ ] **Step 3: Vérifier la compilation TypeScript**

Run: `cd frontend && npx tsc --noEmit`
Expected: aucune nouvelle erreur (le fichier compile — `MatchToConfirm`/`MatchToConfirmPlayer` ne
sont pas encore utilisés ailleurs, ce qui ne produit pas d'erreur TS pour un `export`).

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(match): types MatchToConfirm + api.getMatchesToConfirm"
```

---

### Task 4: Frontend — helpers purs `lib/resultsToConfirm.ts`

**Files:**
- Create: `frontend/lib/resultsToConfirm.ts`
- Test: `frontend/__tests__/resultsToConfirm.test.ts`

- [ ] **Step 1: Write the failing test**

Créer `frontend/__tests__/resultsToConfirm.test.ts` :

```ts
import { teamRows, teamLabel, scoreSummary } from '@/lib/resultsToConfirm';
import type { MatchToConfirmPlayer } from '@/lib/api';

const p = (userId: string, firstName: string, lastName: string, team: 1 | 2): MatchToConfirmPlayer =>
  ({ userId, firstName, lastName, avatarUrl: null, team });

const roster: MatchToConfirmPlayer[] = [
  p('u1', 'Lucas', 'Moreau', 1),
  p('u2', 'Jean', 'Dupont', 1),
  p('u3', 'Celine', 'Barbier', 2),
  p('u4', 'Melanie', 'Bernard', 2),
];

describe('teamRows', () => {
  it('sépare les deux équipes, ordre de tableau préservé', () => {
    const [t1, t2] = teamRows(roster);
    expect(t1.map((x) => x.userId)).toEqual(['u1', 'u2']);
    expect(t2.map((x) => x.userId)).toEqual(['u3', 'u4']);
  });

  it('verse un team inattendu dans la rangée la moins remplie', () => {
    const odd = [p('a', 'A', 'A', 3 as 1), p('b', 'B', 'B', 3 as 1)];
    const [t1, t2] = teamRows(odd);
    expect(t1).toHaveLength(1);
    expect(t2).toHaveLength(1);
  });
});

describe('teamLabel', () => {
  it('joint les prénoms d\'une équipe', () => {
    const [t1] = teamRows(roster);
    expect(teamLabel(t1, roster)).toBe('Lucas & Jean');
  });

  it('désambiguïse par l\'initiale du nom en cas de prénom en double', () => {
    const dup = [
      p('u1', 'Jean', 'Dupont', 1), p('u2', 'Marie', 'Leroy', 1),
      p('u3', 'Jean', 'Martin', 2), p('u4', 'Paul', 'Roux', 2),
    ];
    const [t1, t2] = teamRows(dup);
    expect(teamLabel(t1, dup)).toBe('Jean D. & Marie');
    expect(teamLabel(t2, dup)).toBe('Jean M. & Paul');
  });
});

describe('scoreSummary', () => {
  it('formate les sets en "a-b, a-b"', () => {
    expect(scoreSummary([[6, 4], [6, 2]])).toBe('6-4, 6-2');
  });

  it('gère un set unique', () => {
    expect(scoreSummary([[6, 4]])).toBe('6-4');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx jest --runTestsByPath __tests__/resultsToConfirm.test.ts`
Expected: FAIL — `Cannot find module '@/lib/resultsToConfirm'`.

- [ ] **Step 3: Write minimal implementation**

Créer `frontend/lib/resultsToConfirm.ts` :

```ts
// Helpers purs de la carte « Résultat à confirmer » (components/match/ResultsToConfirm.tsx).
// Aucune dépendance React : testables directement.
import type { MatchToConfirmPlayer } from '@/lib/api';

/**
 * Sépare les joueurs en deux équipes (team 1 puis team 2), ordre de tableau préservé au sein
 * de chaque équipe (le backend n'expose pas de `slot` pour ce DTO). Un `team` inattendu
 * (défense en profondeur — l'application garantit team 1|2) est versé dans l'équipe la moins
 * remplie plutôt que de perdre le joueur.
 */
export function teamRows(players: MatchToConfirmPlayer[]): [MatchToConfirmPlayer[], MatchToConfirmPlayer[]] {
  const team1: MatchToConfirmPlayer[] = [];
  const team2: MatchToConfirmPlayer[] = [];
  for (const p of players) {
    if (p.team === 1) team1.push(p);
    else if (p.team === 2) team2.push(p);
    else (team1.length <= team2.length ? team1 : team2).push(p);
  }
  return [team1, team2];
}

/**
 * Libellé d'une équipe en prénoms : « Lucas & Jean ». En cas de prénom en double DANS LE
 * MATCH (`allPlayers` = les 4 joueurs), on ajoute l'initiale du nom pour lever l'ambiguïté :
 * « Jean D. & Jean M. ». Un joueur sans nom garde son prénom seul.
 */
export function teamLabel(team: MatchToConfirmPlayer[], allPlayers: MatchToConfirmPlayer[]): string {
  const counts = new Map<string, number>();
  for (const p of allPlayers) {
    const key = p.firstName.trim().toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return team
    .map((p) => {
      const first = p.firstName.trim();
      const last = p.lastName.trim();
      const collides = (counts.get(first.toLowerCase()) ?? 0) > 1;
      return collides && last ? `${first} ${last[0].toUpperCase()}.` : first;
    })
    .join(' & ');
}

/** Score compact affiché sur la carte : « 6-4, 6-2 ». */
export function scoreSummary(sets: [number, number][]): string {
  return sets.map(([a, b]) => `${a}-${b}`).join(', ');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx jest --runTestsByPath __tests__/resultsToConfirm.test.ts`
Expected: PASS — 6 tests verts.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/resultsToConfirm.ts frontend/__tests__/resultsToConfirm.test.ts
git commit -m "feat(match): helpers purs lib/resultsToConfirm (teamRows/teamLabel/scoreSummary)"
```

---

### Task 5: Frontend — composant `ResultsToConfirm.tsx`

**Files:**
- Create: `frontend/components/match/ResultsToConfirm.tsx`
- Test: `frontend/__tests__/ResultsToConfirm.test.tsx`

- [ ] **Step 1: Write the failing test**

Créer `frontend/__tests__/ResultsToConfirm.test.tsx` :

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { ResultsToConfirm } from '@/components/match/ResultsToConfirm';

jest.mock('@/lib/api', () => ({
  __esModule: true,
  api: { getMatchesToConfirm: jest.fn(), confirmMatch: jest.fn(), disputeMatch: jest.fn() },
  assetUrl: (u: string) => u,
}));
import { api } from '@/lib/api';

const row = {
  matchId: 'm1', playedAt: '2026-07-20T18:00:00Z', sets: [[6, 4], [6, 2]],
  competitive: true, confirmDeadline: '2026-07-23T18:00:00Z',
  club: { slug: 'arena', name: 'Padel Arena', timezone: 'Europe/Paris' },
  resourceName: 'Court 1',
  players: [
    { userId: 'u1', firstName: 'Lucas', lastName: 'Moreau', avatarUrl: null, team: 1 },
    { userId: 'u2', firstName: 'Jean', lastName: 'Dupont', avatarUrl: null, team: 1 },
    { userId: 'u3', firstName: 'Celine', lastName: 'Barbier', avatarUrl: null, team: 2 },
    { userId: 'u4', firstName: 'Melanie', lastName: 'Bernard', avatarUrl: null, team: 2 },
  ],
};

const wrap = (props = {}) => render(<ThemeProvider><ResultsToConfirm token="t" {...props} /></ThemeProvider>);

beforeEach(() => {
  (api.getMatchesToConfirm as jest.Mock).mockReset();
  (api.confirmMatch as jest.Mock).mockReset().mockResolvedValue({ ok: true });
  (api.disputeMatch as jest.Mock).mockReset().mockResolvedValue({ ok: true });
});

it('n\'affiche rien quand la liste est vide', async () => {
  (api.getMatchesToConfirm as jest.Mock).mockResolvedValue([]);
  const { container } = wrap();
  await waitFor(() => expect(api.getMatchesToConfirm).toHaveBeenCalled());
  expect(container.textContent).not.toContain('confirmer');
});

it('regroupe les matchs dans une seule carte (en-tête compté) et filtre par club', async () => {
  (api.getMatchesToConfirm as jest.Mock).mockResolvedValue([
    row,
    { ...row, matchId: 'm2' },
    { ...row, matchId: 'm3', club: { ...row.club, slug: 'autre' } },
  ]);
  wrap({ clubSlug: 'arena' });
  await waitFor(() => expect(screen.getByText('Résultats à confirmer · 2')).toBeInTheDocument());
});

it('titre singulier quand un seul match', async () => {
  (api.getMatchesToConfirm as jest.Mock).mockResolvedValue([row]);
  wrap();
  await waitFor(() => expect(screen.getByText('Résultat à confirmer')).toBeInTheDocument());
});

it('affiche les deux équipes, le score et la chip Pour le fun si amicale', async () => {
  (api.getMatchesToConfirm as jest.Mock).mockResolvedValue([{ ...row, competitive: false }]);
  wrap();
  await waitFor(() => expect(screen.getByText('Lucas & Jean')).toBeInTheDocument());
  expect(screen.getByText('Celine & Melanie')).toBeInTheDocument();
  expect(screen.getByText(/6-4, 6-2/)).toBeInTheDocument();
  expect(screen.getByText('Pour le fun')).toBeInTheDocument();
});

it('confirmer appelle l\'API et rafraîchit', async () => {
  (api.getMatchesToConfirm as jest.Mock)
    .mockResolvedValueOnce([row])
    .mockResolvedValueOnce([]);
  const onChanged = jest.fn();
  wrap({ onChanged });
  await waitFor(() => expect(screen.getByText('Confirmer')).toBeInTheDocument());
  fireEvent.click(screen.getByText('Confirmer'));
  await waitFor(() => expect(api.confirmMatch).toHaveBeenCalledWith('m1', 't'));
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  expect(api.getMatchesToConfirm).toHaveBeenCalledTimes(2);
});

it('contester déplie le motif, bloque l\'envoi vide, envoie et referme', async () => {
  (api.getMatchesToConfirm as jest.Mock)
    .mockResolvedValueOnce([row])
    .mockResolvedValueOnce([]);
  wrap();
  await waitFor(() => expect(screen.getByText('Contester')).toBeInTheDocument());
  fireEvent.click(screen.getByText('Contester'));
  const send = screen.getByLabelText('Envoyer la contestation');
  expect(send).toBeDisabled();
  fireEvent.change(screen.getByPlaceholderText(/Expliquez le litige/), { target: { value: 'Le score est faux' } });
  expect(send).not.toBeDisabled();
  fireEvent.click(send);
  await waitFor(() => expect(api.disputeMatch).toHaveBeenCalledWith('m1', 'Le score est faux', 't'));
  await waitFor(() => expect(screen.queryByLabelText('Envoyer la contestation')).not.toBeInTheDocument());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx jest --runTestsByPath __tests__/ResultsToConfirm.test.tsx`
Expected: FAIL — `Cannot find module '@/components/match/ResultsToConfirm'`.

- [ ] **Step 3: Write minimal implementation**

Créer `frontend/components/match/ResultsToConfirm.tsx` :

```tsx
'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, MatchToConfirm } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { colorForSeed } from '@/lib/playerColors';
import { Avatar } from '@/components/ui/Avatar';
import { Chip } from '@/components/ui/atoms';
import { teamRows, teamLabel, scoreSummary } from '@/lib/resultsToConfirm';

function fmtWhen(iso: string, tz: string): string {
  const date = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).format(new Date(iso));
  const hour = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso)).replace(':', 'h');
  return `${date} · ${hour}`;
}

function fmtDeadline(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: tz }).format(new Date(iso));
}

// Prompt personnel « Résultats à confirmer » : miroir de ResultsToRecord pour les matchs PENDING
// où quelqu'un d'autre a saisi le score et où ma confirmation est encore PENDING. « Confirmer »
// valide en 1 tap ; « Contester » déplie un motif obligatoire (même comportement que
// MyMatchesList, en état local propre à ce composant — MyMatchesList reste inchangée). Rendu
// null si rien à confirmer. `clubSlug` restreint au club courant ; `onChanged` rafraîchit le parent.
export function ResultsToConfirm({ token, clubSlug, onChanged }: {
  token: string | null;
  clubSlug?: string;
  onChanged?: () => void;
}) {
  const { th } = useTheme();
  const [rows, setRows] = useState<MatchToConfirm[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [disputingId, setDisputingId] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const reload = useCallback(() => {
    if (!token) { setRows([]); return; }
    api.getMatchesToConfirm(token)
      .then((r) => setRows(clubSlug ? r.filter((m) => m.club.slug === clubSlug) : r))
      .catch(() => setRows([]));
  }, [token, clubSlug]);

  useEffect(() => { reload(); }, [reload]);

  const confirm = async (matchId: string) => {
    if (!token) return;
    setBusy(matchId);
    try { await api.confirmMatch(matchId, token); reload(); onChanged?.(); }
    finally { setBusy(null); }
  };

  const submitDispute = async (matchId: string) => {
    const msg = reason.trim();
    if (!msg || !token) return;
    setBusy(matchId);
    try {
      await api.disputeMatch(matchId, msg, token);
      setDisputingId(null);
      setReason('');
      reload();
      onChanged?.();
    } finally { setBusy(null); }
  };

  if (!token || rows.length === 0) return null;

  const kicker = {
    fontFamily: th.fontUI, fontSize: 10.5, letterSpacing: '2.2px',
    textTransform: 'uppercase' as const, fontWeight: 700, color: th.textMute,
  };

  return (
    <div style={{ padding: '18px 20px 0' }}>
      <div style={{ background: th.surface, borderRadius: 18, boxShadow: th.shadow, overflow: 'hidden' }}>
        <div style={{ padding: '13px 18px 11px' }}>
          <span style={kicker}>
            {rows.length > 1 ? `Résultats à confirmer · ${rows.length}` : 'Résultat à confirmer'}
          </span>
        </div>

        {rows.map((m) => {
          const [team1, team2] = teamRows(m.players);
          const avatars = [...team1, ...team2];
          const disputing = disputingId === m.matchId;
          const metaParts = [scoreSummary(m.sets)];
          if (m.resourceName) metaParts.push(m.resourceName);
          metaParts.push(fmtWhen(m.playedAt, m.club.timezone));
          metaParts.push(`Auto-confirmé ${fmtDeadline(m.confirmDeadline, m.club.timezone)}`);

          return (
            <div key={m.matchId} style={{ padding: '11px 18px', borderTop: `1px solid ${th.line}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ display: 'flex', flexShrink: 0 }}>
                  {avatars.map((p, i) => (
                    <span key={p.userId} style={{
                      marginLeft: i === 0 ? 0 : -7, borderRadius: '50%',
                      border: `2px solid ${th.surface}`, display: 'flex', flexShrink: 0,
                    }}>
                      <Avatar firstName={p.firstName} lastName={p.lastName} avatarUrl={p.avatarUrl} size={26} color={colorForSeed(p.userId)} />
                    </span>
                  ))}
                </span>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily: th.fontUI, fontWeight: 700, fontSize: 13.5, color: th.text,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    <span>{teamLabel(team1, m.players)}</span>
                    <span style={{ color: th.textFaint, fontWeight: 600, fontSize: 11.5, margin: '0 6px' }}>vs</span>
                    <span>{teamLabel(team2, m.players)}</span>
                  </div>
                  <div style={{
                    fontFamily: th.fontMono, fontSize: 11, color: th.textMute, marginTop: 2,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {metaParts.join(' · ')}
                  </div>
                </div>

                {m.competitive === false && <Chip tone="line">Pour le fun</Chip>}
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button type="button" disabled={busy === m.matchId} onClick={() => confirm(m.matchId)} style={{
                  border: 'none', cursor: 'pointer', borderRadius: 99, padding: '8px 16px',
                  background: th.accent, color: th.onAccent, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700,
                  opacity: busy === m.matchId ? 0.5 : 1,
                }}>
                  Confirmer
                </button>
                <button type="button" disabled={busy === m.matchId}
                  onClick={() => { setDisputingId(disputing ? null : m.matchId); setReason(''); }} style={{
                    border: 'none', cursor: 'pointer', borderRadius: 99, padding: '8px 16px',
                    background: th.surface2, color: th.text, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700,
                    opacity: busy === m.matchId ? 0.5 : 1,
                  }}>
                  Contester
                </button>
              </div>

              {disputing && (
                <div style={{ marginTop: 8 }}>
                  <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} rows={2}
                    placeholder="Expliquez le litige (score, joueurs…)" autoFocus
                    style={{ width: '100%', borderRadius: 10, border: `1px solid ${th.line}`, padding: 8, fontFamily: th.fontUI, fontSize: 13, color: th.text, background: th.bg }} />
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button type="button" disabled={busy === m.matchId || !reason.trim()} onClick={() => submitDispute(m.matchId)}
                      aria-label="Envoyer la contestation" style={{
                        border: 'none', cursor: 'pointer', borderRadius: 99, padding: '7px 14px',
                        background: th.text, color: th.bg, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700,
                        opacity: (busy === m.matchId || !reason.trim()) ? 0.5 : 1,
                      }}>
                      Envoyer la contestation
                    </button>
                    <button type="button" onClick={() => { setDisputingId(null); setReason(''); }} style={{
                      border: 'none', cursor: 'pointer', borderRadius: 99, padding: '7px 14px',
                      background: th.surface2, color: th.text, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700,
                    }}>
                      Annuler
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx jest --runTestsByPath __tests__/ResultsToConfirm.test.tsx`
Expected: PASS — 6 tests verts.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/match/ResultsToConfirm.tsx frontend/__tests__/ResultsToConfirm.test.tsx
git commit -m "feat(match): composant ResultsToConfirm (carte + confirmer/contester)"
```

---

### Task 6: Placement — Mon Palova

**Files:**
- Modify: `frontend/components/platform/MonPalova.tsx`
- Modify: `frontend/__tests__/MonPalova.test.tsx`

- [ ] **Step 1: Ajouter le composant à la page**

Dans `frontend/components/platform/MonPalova.tsx`, la ligne d'import (ligne 17) :

```ts
import { ResultsToRecord } from '@/components/match/ResultsToRecord';
```

devient :

```ts
import { ResultsToRecord } from '@/components/match/ResultsToRecord';
import { ResultsToConfirm } from '@/components/match/ResultsToConfirm';
```

Et le JSX (ligne 81), actuellement :

```tsx
          <ResultsToRecord token={token} />
```

devient (la carte à confirmer AU-DESSUS, car bornée dans le temps) :

```tsx
          <ResultsToConfirm token={token} />
          <ResultsToRecord token={token} />
```

- [ ] **Step 2: Mettre à jour le test d'orchestration**

Dans `frontend/__tests__/MonPalova.test.tsx`, la ligne (ligne 8) :

```tsx
jest.mock('../components/match/ResultsToRecord', () => ({ ResultsToRecord: () => <div data-testid="results" /> }));
```

devient (nouvelle ligne ajoutée juste après) :

```tsx
jest.mock('../components/match/ResultsToRecord', () => ({ ResultsToRecord: () => <div data-testid="results" /> }));
jest.mock('../components/match/ResultsToConfirm', () => ({ ResultsToConfirm: () => <div data-testid="results-confirm" /> }));
```

Et la ligne (ligne 53) :

```tsx
    for (const id of ['managed', 'results', 'rail', 'wallet', 'level', 'discover']) {
```

devient :

```tsx
    for (const id of ['managed', 'results-confirm', 'results', 'rail', 'wallet', 'level', 'discover']) {
```

- [ ] **Step 3: Run test to verify it passes**

Run: `cd frontend && npx jest --runTestsByPath __tests__/MonPalova.test.tsx`
Expected: PASS — 3 tests verts.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/platform/MonPalova.tsx frontend/__tests__/MonPalova.test.tsx
git commit -m "feat(match): affiche ResultsToConfirm sur Mon Palova"
```

---

### Task 7: Placement — Club-house

**Files:**
- Modify: `frontend/components/ClubHouse.tsx`
- Modify: `frontend/__tests__/ClubHouse.test.tsx`

- [ ] **Step 1: Ajouter le composant à la page**

Dans `frontend/components/ClubHouse.tsx`, la ligne d'import (ligne 22) :

```ts
import { ResultsToRecord } from '@/components/match/ResultsToRecord';
```

devient :

```ts
import { ResultsToRecord } from '@/components/match/ResultsToRecord';
import { ResultsToConfirm } from '@/components/match/ResultsToConfirm';
```

Et le JSX (lignes 173-175), actuellement :

```tsx
      {club.levelSystemEnabled !== false && (
        <ResultsToRecord token={token} clubSlug={club.slug} />
      )}
```

devient :

```tsx
      {club.levelSystemEnabled !== false && (
        <>
          <ResultsToConfirm token={token} clubSlug={club.slug} />
          <ResultsToRecord token={token} clubSlug={club.slug} />
        </>
      )}
```

- [ ] **Step 2: Mettre à jour le mock API du test**

Dans `frontend/__tests__/ClubHouse.test.tsx`, la ligne (ligne 30) :

```ts
    getMatchesToRecord: jest.fn().mockResolvedValue([]),
```

devient :

```ts
    getMatchesToRecord: jest.fn().mockResolvedValue([]),
    getMatchesToConfirm: jest.fn().mockResolvedValue([]),
```

- [ ] **Step 3: Run test to verify it passes**

Run: `cd frontend && npx jest --runTestsByPath __tests__/ClubHouse.test.tsx`
Expected: PASS — tous les tests du fichier restent verts.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/ClubHouse.tsx frontend/__tests__/ClubHouse.test.tsx
git commit -m "feat(match): affiche ResultsToConfirm sur le Club-house"
```

---

### Task 8: Placement — `/parties` (onglets Parties et Mes matchs)

**Files:**
- Modify: `frontend/components/openmatch/OpenMatches.tsx`
- Modify: `frontend/__tests__/OpenMatches.test.tsx`

- [ ] **Step 1: Ajouter l'import**

Dans `frontend/components/openmatch/OpenMatches.tsx`, la ligne d'import (ligne 21) :

```ts
import { ResultsToRecord } from '@/components/match/ResultsToRecord';
```

devient :

```ts
import { ResultsToRecord } from '@/components/match/ResultsToRecord';
import { ResultsToConfirm } from '@/components/match/ResultsToConfirm';
```

- [ ] **Step 2: Ajouter le composant dans l'onglet « Parties »**

Le JSX (lignes 234-236), actuellement :

```tsx
        {levelEnabled && (
          <ResultsToRecord token={token} clubSlug={club.slug} />
        )}
```

devient :

```tsx
        {levelEnabled && (
          <>
            <ResultsToConfirm token={token} clubSlug={club.slug} />
            <ResultsToRecord token={token} clubSlug={club.slug} />
          </>
        )}
```

- [ ] **Step 3: Ajouter le composant dans l'onglet « Mes matchs »**

Le JSX (lignes 318-319), actuellement :

```tsx
            <ResultsToRecord token={token} clubSlug={club.slug}
              onRecorded={() => api.getMyMatches(token).then(setMyMatches).catch(() => {})} />
```

devient :

```tsx
            <ResultsToConfirm token={token} clubSlug={club.slug}
              onChanged={() => api.getMyMatches(token).then(setMyMatches).catch(() => {})} />
            <ResultsToRecord token={token} clubSlug={club.slug}
              onRecorded={() => api.getMyMatches(token).then(setMyMatches).catch(() => {})} />
```

- [ ] **Step 4: Mettre à jour le mock API du test**

Dans `frontend/__tests__/OpenMatches.test.tsx`, la ligne (ligne 23) :

```ts
    getMatchesToRecord: jest.fn().mockResolvedValue([]),
```

devient :

```ts
    getMatchesToRecord: jest.fn().mockResolvedValue([]),
    getMatchesToConfirm: jest.fn().mockResolvedValue([]),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx jest --runTestsByPath __tests__/OpenMatches.test.tsx`
Expected: PASS — tous les tests du fichier restent verts.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/openmatch/OpenMatches.tsx frontend/__tests__/OpenMatches.test.tsx
git commit -m "feat(match): affiche ResultsToConfirm sur /parties (2 onglets)"
```

---

### Task 9: Documentation + vérification finale

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Documenter l'évolution dans CLAUDE.md**

Dans `CLAUDE.md`, le bloc existant (juste avant `## Conformité légale`) :

```
> **Évolution (2026-07-21) — renommage « Pour de vrai / Pour le fun » :** les libellés joueurs « Compétitive / Amicale » deviennent **« Pour de vrai » / « Pour le fun »** partout (inspiré du passage de Pista à « Partie classée / Partie loisir » — on garde la clarté de la conséquence sans reprendre leurs mots ; la pédagogie reste portée par les sous-titres « Compte pour le niveau » / « Le niveau ne bouge pas », conservés tels quels). **100 % frontend, 7 composants + tests** (`OpenMatchQuickSwitch`, `OpenMatchToggle`, `OpenMatchCard`, `MatchesFilterBar` + intégration `OpenMatches`, `MatchResultModal`, `MyMatchesList`, `ResultsToRecord`) ; le champ API `competitive`, le défaut (`true`), le verrouillage à la saisie et le gate Glicko backend sont **inchangés** (les commentaires backend parlant d'« amicale » restent valides — vocabulaire interne non affiché). Spec : `docs/superpowers/specs/2026-07-21-renommage-pour-de-vrai-pour-le-fun-design.md`.

## Conformité légale (mentions, CGU/CGV, RGPD) (2026-07-18) ✅ implémenté
```

devient (nouveau bloc ajouté avant le `##`) :

```
> **Évolution (2026-07-21) — renommage « Pour de vrai / Pour le fun » :** les libellés joueurs « Compétitive / Amicale » deviennent **« Pour de vrai » / « Pour le fun »** partout (inspiré du passage de Pista à « Partie classée / Partie loisir » — on garde la clarté de la conséquence sans reprendre leurs mots ; la pédagogie reste portée par les sous-titres « Compte pour le niveau » / « Le niveau ne bouge pas », conservés tels quels). **100 % frontend, 7 composants + tests** (`OpenMatchQuickSwitch`, `OpenMatchToggle`, `OpenMatchCard`, `MatchesFilterBar` + intégration `OpenMatches`, `MatchResultModal`, `MyMatchesList`, `ResultsToRecord`) ; le champ API `competitive`, le défaut (`true`), le verrouillage à la saisie et le gate Glicko backend sont **inchangés** (les commentaires backend parlant d'« amicale » restent valides — vocabulaire interne non affiché). Spec : `docs/superpowers/specs/2026-07-21-renommage-pour-de-vrai-pour-le-fun-design.md`.

> **Évolution (2026-07-22) — alerte « Résultats à confirmer » (miroir de « Résultats à saisir ») :** nouvelle carte **`components/match/ResultsToConfirm.tsx`**, posée **au-dessus** de `ResultsToRecord` sur les 3 mêmes surfaces (Mon Palova, Club-house, `/parties` — onglets Parties et Mes matchs) : liste les matchs `PENDING` où ma `MatchPlayer.confirmation` est encore `PENDING` (= `needsMyConfirmation` de l'historique complet `/api/me/matches`), triés par échéance croissante. **Confirmer** en 1 clic, **Contester** déplie un motif obligatoire (comportement de `MyMatchesList` repris en état local — `MyMatchesList` elle-même **reste inchangée**, seule vue avec historique complet + fil de discussion + relance des autres joueurs). Backend additif, aucune migration : **`MatchService.listToConfirm(userId)`** (DTO léger, miroir de `listToRecord`) derrière **`GET /api/me/matches/to-confirm`** (miroir de `/matches/to-record`) ; réutilise les routes `confirm`/`dispute` déjà existantes, sans y toucher. Helpers purs testés `frontend/lib/resultsToConfirm.ts` (`teamRows`/`teamLabel`, variantes sans `slot` de `lib/resultsToRecord.ts` ; `scoreSummary`). Tests : `match.service`/`me.routes` (back), `resultsToConfirm`/`ResultsToConfirm`/`MonPalova`/`ClubHouse`/`OpenMatches` (front). Spec & plan : `docs/superpowers/{specs,plans}/2026-07-22-resultats-a-confirmer-alerte*`.

## Conformité légale (mentions, CGU/CGV, RGPD) (2026-07-18) ✅ implémenté
```

- [ ] **Step 2: Vérification finale — backend**

Run: `cd backend && npx jest --runTestsByPath src/services/__tests__/match.service.test.ts src/routes/__tests__/me.routes.test.ts`
Expected: PASS — tous les tests des deux fichiers verts.

- [ ] **Step 3: Vérification finale — frontend (fichiers touchés uniquement, pas la suite complète — flake pré-existant connu sur BookingModal en suite complète)**

Run: `cd frontend && npx jest --runTestsByPath __tests__/resultsToConfirm.test.ts __tests__/ResultsToConfirm.test.tsx __tests__/MonPalova.test.tsx __tests__/ClubHouse.test.tsx __tests__/OpenMatches.test.tsx`
Expected: PASS — tous les tests des 5 fichiers verts.

- [ ] **Step 4: Vérification TypeScript**

Run: `cd frontend && npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: alerte resultats a confirmer (miroir resultats a saisir)"
```
