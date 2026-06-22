# Cartes de match enrichies — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Afficher sur chaque carte de l'onglet « Matchs » de `/me/reservations` les joueurs (partenaire + adversaires), la date+heure, le club et le terrain, pour identifier la partie.

**Architecture:** Enrichissement **additif** de l'endpoint `GET /api/me/matches` (les relations `players`/`club`/`sport`/`reservation.resource` existent déjà — aucune migration). Un helper pur sépare partenaire/adversaires côté front, et `MyMatchesList` rend les pastilles colorées via `Avatar` + `colorForSeed`.

**Tech Stack:** Express 5 + Prisma 7 (backend), Next.js 16 + React 19 + Jest/RTL (frontend).

---

## File Structure

- `backend/src/routes/me.ts` — élargir le `select` + le mapper de `GET /api/me/matches` (ajout `players`, `club`, `sport`, `resource`, `isMe`).
- `backend/src/routes/__tests__/me.routes.test.ts` — test du nouveau payload.
- `frontend/lib/api.ts` — étendre l'interface `MyMatch`.
- `frontend/lib/match.ts` — helper pur `splitTeams` (partenaire vs adversaires).
- `frontend/__tests__/match.test.ts` (ou fichier existant des helpers match) — test de `splitTeams`.
- `frontend/components/match/MyMatchesList.tsx` — refonte de la carte.
- `frontend/__tests__/MyMatchesList.test.tsx` — tests d'affichage enrichis.

---

## Task 1 : Backend — enrichir `GET /api/me/matches`

**Files:**
- Modify: `backend/src/routes/me.ts:197-214`
- Test: `backend/src/routes/__tests__/me.routes.test.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

Ajouter à la fin de `backend/src/routes/__tests__/me.routes.test.ts` :

```ts
describe('GET /api/me/matches', () => {
  it('renvoie joueurs, club, sport, terrain et isMe', async () => {
    prismaMock.matchPlayer.findMany.mockResolvedValue([
      {
        confirmation: 'PENDING', team: 2, ratingAfter: null,
        match: {
          id: 'm1', status: 'PENDING', sets: [[6, 4], [6, 3]],
          playedAt: new Date('2026-06-20T16:30:00Z'), winningTeam: 1,
          confirmDeadline: new Date('2026-06-23T16:30:00Z'), reservationId: 'r1',
          club: { name: 'Padel Arena Paris' },
          sport: { name: 'Padel' },
          reservation: { resource: { name: 'Court 2' } },
          players: [
            { userId: 'u1', team: 2, user: { firstName: 'Eric', lastName: 'Nougayrede' } },
            { userId: 'u2', team: 2, user: { firstName: 'Marie', lastName: 'Durand' } },
            { userId: 'u3', team: 1, user: { firstName: 'Paul', lastName: 'Roy' } },
            { userId: 'u4', team: 1, user: { firstName: 'Lea', lastName: 'Martin' } },
          ],
        },
      },
    ] as any);
    const res = await request(app).get('/api/me/matches').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body[0]).toEqual(expect.objectContaining({
      matchId: 'm1',
      club: { name: 'Padel Arena Paris' },
      sport: { name: 'Padel' },
      resource: { name: 'Court 2' },
    }));
    expect(res.body[0].players).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: 'u1', team: 2, firstName: 'Eric', lastName: 'Nougayrede', isMe: true }),
      expect.objectContaining({ userId: 'u2', team: 2, firstName: 'Marie', lastName: 'Durand', isMe: false }),
    ]));
  });

  it('resource = null si le match n a pas de réservation', async () => {
    prismaMock.matchPlayer.findMany.mockResolvedValue([
      {
        confirmation: 'CONFIRMED', team: 1, ratingAfter: 6.2,
        match: {
          id: 'm2', status: 'CONFIRMED', sets: [[6, 0], [6, 0]],
          playedAt: new Date('2026-06-15T10:00:00Z'), winningTeam: 1,
          confirmDeadline: new Date('2026-06-18T10:00:00Z'), reservationId: null,
          club: { name: 'Padel Arena Paris' }, sport: { name: 'Padel' },
          reservation: null,
          players: [
            { userId: 'u1', team: 1, user: { firstName: 'Eric', lastName: 'N' } },
            { userId: 'u2', team: 1, user: { firstName: 'A', lastName: 'B' } },
            { userId: 'u3', team: 2, user: { firstName: 'C', lastName: 'D' } },
            { userId: 'u4', team: 2, user: { firstName: 'E', lastName: 'F' } },
          ],
        },
      },
    ] as any);
    const res = await request(app).get('/api/me/matches').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body[0].resource).toBeNull();
  });
});
```

- [ ] **Step 2 : Lancer le test, vérifier l'échec**

Run: `cd backend && npm test -- me.routes`
Expected: FAIL — `players`/`club`/`sport`/`resource` absents du body, `isMe` undefined.

- [ ] **Step 3 : Élargir le select et le mapper**

Dans `backend/src/routes/me.ts`, remplacer le bloc `router.get('/matches', …)` (lignes ~197-214) par :

```ts
router.get('/matches', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const meId = req.user!.id;
    const rows = await prisma.matchPlayer.findMany({
      where: { userId: meId },
      orderBy: { match: { playedAt: 'desc' } },
      select: {
        confirmation: true, team: true, ratingAfter: true,
        match: {
          select: {
            id: true, status: true, sets: true, playedAt: true, winningTeam: true,
            confirmDeadline: true, reservationId: true,
            club: { select: { name: true } },
            sport: { select: { name: true } },
            reservation: { select: { resource: { select: { name: true } } } },
            players: { select: { userId: true, team: true, user: { select: { firstName: true, lastName: true } } } },
          },
        },
      },
    });
    res.json(rows.map((r) => ({
      matchId: r.match.id, status: r.match.status, sets: r.match.sets, playedAt: r.match.playedAt,
      winningTeam: r.match.winningTeam, myTeam: r.team, myConfirmation: r.confirmation,
      ratingAfter: r.ratingAfter,
      needsMyConfirmation: r.match.status === 'PENDING' && r.confirmation === 'PENDING',
      reservationId: r.match.reservationId,
      club: { name: r.match.club.name },
      sport: { name: r.match.sport.name },
      resource: r.match.reservation?.resource ? { name: r.match.reservation.resource.name } : null,
      players: r.match.players.map((p) => ({
        userId: p.userId, team: p.team, firstName: p.user.firstName, lastName: p.user.lastName,
        isMe: p.userId === meId,
      })),
    })));
  } catch (err) { next(err); }
});
```

> Note : `ratingAfter` est désormais explicitement renvoyé (il manquait avant alors que le type front le déclare — corrige une incohérence au passage).

- [ ] **Step 4 : Lancer le test, vérifier le succès**

Run: `cd backend && npm test -- me.routes`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add backend/src/routes/me.ts backend/src/routes/__tests__/me.routes.test.ts
git commit -m "feat(api): enrichir GET /api/me/matches (joueurs, club, sport, terrain)"
```

---

## Task 2 : Frontend — type `MyMatch` + helper `splitTeams`

**Files:**
- Modify: `frontend/lib/api.ts:625-636`
- Modify: `frontend/lib/match.ts`
- Test: `frontend/__tests__/match.test.ts`

- [ ] **Step 1 : Étendre l'interface `MyMatch`**

Dans `frontend/lib/api.ts`, remplacer l'interface `MyMatch` par :

```ts
export interface MyMatchPlayer {
  userId: string;
  team: number;
  firstName: string;
  lastName: string;
  isMe: boolean;
}

export interface MyMatch {
  matchId: string;
  reservationId: string | null;
  status: 'PENDING' | 'CONFIRMED' | 'DISPUTED' | 'CANCELLED';
  sets: [number, number][];
  playedAt: string;
  winningTeam: number | null;
  myTeam: number;
  myConfirmation: 'PENDING' | 'CONFIRMED' | 'DISPUTED';
  ratingAfter: number | null;
  needsMyConfirmation: boolean;
  club: { name: string };
  sport: { name: string };
  resource: { name: string } | null;
  players: MyMatchPlayer[];
}
```

- [ ] **Step 2 : Écrire le test du helper (échoue)**

`frontend/__tests__/match.test.ts` existe déjà. **Ajouter `splitTeams`** à l'import existant en tête de fichier :

```ts
import { scoreLine, canRecordResult, validSets, winnerFromSets, splitTeams } from '@/lib/match';
```

Puis **ajouter à la fin du fichier** ce bloc :

```ts
const players = [
  { userId: 'u1', team: 2, firstName: 'Eric', lastName: 'Nougayrede', isMe: true },
  { userId: 'u2', team: 2, firstName: 'Marie', lastName: 'Durand', isMe: false },
  { userId: 'u3', team: 1, firstName: 'Paul', lastName: 'Roy', isMe: false },
  { userId: 'u4', team: 1, firstName: 'Lea', lastName: 'Martin', isMe: false },
];

it('sépare partenaire (mon équipe sans moi) et adversaires', () => {
  const { partners, opponents } = splitTeams(players, 2);
  expect(partners.map((p) => p.userId)).toEqual(['u2']);
  expect(opponents.map((p) => p.userId).sort()).toEqual(['u3', 'u4']);
});

it('tolère une liste partielle (pas de partenaire)', () => {
  const { partners, opponents } = splitTeams([players[0], players[2]], 2);
  expect(partners).toEqual([]);
  expect(opponents.map((p) => p.userId)).toEqual(['u3']);
});
```

- [ ] **Step 3 : Lancer le test, vérifier l'échec**

Run: `cd frontend && npm test -- match.test`
Expected: FAIL — `splitTeams` n'existe pas.

- [ ] **Step 4 : Implémenter `splitTeams`**

Ajouter à la fin de `frontend/lib/match.ts` :

```ts
export interface MatchPlayerLite {
  userId: string;
  team: number;
  firstName: string;
  lastName: string;
  isMe: boolean;
}

/** Partenaire(s) = ma propre équipe sans moi ; adversaires = l'autre équipe. */
export function splitTeams(players: MatchPlayerLite[], myTeam: number): {
  partners: MatchPlayerLite[];
  opponents: MatchPlayerLite[];
} {
  return {
    partners: players.filter((p) => p.team === myTeam && !p.isMe),
    opponents: players.filter((p) => p.team !== myTeam),
  };
}
```

- [ ] **Step 5 : Lancer le test, vérifier le succès**

Run: `cd frontend && npm test -- match.test`
Expected: PASS.

- [ ] **Step 6 : Commit**

```bash
git add frontend/lib/api.ts frontend/lib/match.ts frontend/__tests__/match.test.ts
git commit -m "feat(match): type MyMatch enrichi + helper splitTeams"
```

---

## Task 3 : Frontend — refonte de la carte `MyMatchesList`

**Files:**
- Modify: `frontend/components/match/MyMatchesList.tsx`
- Test: `frontend/__tests__/MyMatchesList.test.tsx`

- [ ] **Step 1 : Mettre à jour les fixtures + ajouter les assertions (échoue)**

Remplacer le contenu de `frontend/__tests__/MyMatchesList.test.tsx` par :

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MyMatchesList } from '@/components/match/MyMatchesList';

jest.mock('@/lib/api', () => ({
  __esModule: true,
  assetUrl: () => null,
  api: { confirmMatch: jest.fn().mockResolvedValue({ ok: true }), disputeMatch: jest.fn().mockResolvedValue({ ok: true }) },
}));
import { api } from '@/lib/api';

const base = {
  matchId: 'm1', reservationId: 'r1', status: 'PENDING',
  sets: [[6, 4], [6, 3]] as [number, number][],
  playedAt: '2026-06-20T16:30:00Z', winningTeam: 1, myTeam: 2,
  myConfirmation: 'PENDING', ratingAfter: null, needsMyConfirmation: true,
  club: { name: 'Padel Arena Paris' }, sport: { name: 'Padel' },
  resource: { name: 'Court 2' },
  players: [
    { userId: 'u1', team: 2, firstName: 'Eric', lastName: 'Nougayrede', isMe: true },
    { userId: 'u2', team: 2, firstName: 'Marie', lastName: 'Durand', isMe: false },
    { userId: 'u3', team: 1, firstName: 'Paul', lastName: 'Roy', isMe: false },
    { userId: 'u4', team: 1, firstName: 'Lea', lastName: 'Martin', isMe: false },
  ],
};
const matches = [base];

it('affiche score, partenaire, adversaires, club et terrain', async () => {
  const onChanged = jest.fn();
  render(<MyMatchesList matches={matches as any} token="t" onChanged={onChanged} />);
  expect(screen.getByText('6-4 / 6-3')).toBeInTheDocument();
  expect(screen.getByText(/Marie Durand/)).toBeInTheDocument();
  expect(screen.getByText(/Paul Roy/)).toBeInTheDocument();
  expect(screen.getByText(/Lea Martin/)).toBeInTheDocument();
  expect(screen.getByText(/Padel Arena Paris/)).toBeInTheDocument();
  expect(screen.getByText(/Court 2/)).toBeInTheDocument();
  fireEvent.click(screen.getByText('Confirmer'));
  await waitFor(() => expect(api.confirmMatch).toHaveBeenCalledWith('m1', 't'));
  expect(onChanged).toHaveBeenCalled();
});

it('un match sans confirmation requise ne montre pas les boutons', () => {
  render(<MyMatchesList matches={[{ ...base, needsMyConfirmation: false }] as any} token="t" onChanged={() => {}} />);
  expect(screen.queryByText('Confirmer')).toBeNull();
});

it('affiche Victoire quand mon équipe gagne', () => {
  render(<MyMatchesList matches={[{ ...base, status: 'CONFIRMED', winningTeam: 2, needsMyConfirmation: false }] as any} token="t" onChanged={() => {}} />);
  expect(screen.getByText('Victoire')).toBeInTheDocument();
});
```

> Note : le mock de `@/lib/api` doit exposer `assetUrl` car `Avatar` l'importe.

- [ ] **Step 2 : Lancer le test, vérifier l'échec**

Run: `cd frontend && npm test -- MyMatchesList`
Expected: FAIL — partenaire/adversaires/club/terrain absents.

- [ ] **Step 3 : Réécrire le composant**

Remplacer le contenu de `frontend/components/match/MyMatchesList.tsx` par :

```tsx
'use client';
import { useState } from 'react';
import { api, MyMatch } from '@/lib/api';
import { scoreLine, splitTeams } from '@/lib/match';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';

function PlayerChip({ p }: { p: { userId: string; firstName: string; lastName: string } }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Avatar firstName={p.firstName} lastName={p.lastName} avatarUrl={null} size={22} color={colorForSeed(p.userId)} />
      <span>{p.firstName} {p.lastName}</span>
    </span>
  );
}

function resultLabel(m: MyMatch): { text: string; tone: 'win' | 'loss' | 'muted' } {
  if (m.status === 'CONFIRMED') {
    const won = m.winningTeam === m.myTeam;
    return won ? { text: 'Victoire', tone: 'win' } : { text: 'Défaite', tone: 'loss' };
  }
  if (m.status === 'DISPUTED') return { text: 'En litige', tone: 'muted' };
  if (m.status === 'CANCELLED') return { text: 'Annulé', tone: 'muted' };
  return { text: 'En attente de confirmation', tone: 'muted' };
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString('fr-FR')} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
}

export function MyMatchesList({ matches, token, onChanged }: { matches: MyMatch[]; token: string; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (id: string, kind: 'confirm' | 'dispute') => {
    setBusy(id);
    try { await (kind === 'confirm' ? api.confirmMatch(id, token) : api.disputeMatch(id, token)); onChanged(); }
    finally { setBusy(null); }
  };
  if (!matches.length) return <p className="p-4 text-sm opacity-60">Aucun match enregistré.</p>;
  return (
    <ul className="space-y-2">
      {matches.map((m) => {
        const { partners, opponents } = splitTeams(m.players ?? [], m.myTeam);
        const result = resultLabel(m);
        const resultColor = result.tone === 'win' ? '#1a8f4c' : result.tone === 'loss' ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.55)';
        return (
          <li key={m.matchId} className="rounded-xl border p-3" style={{ borderColor: 'rgba(0,0,0,0.1)' }}>
            <div className="flex items-center justify-between">
              <span className="font-semibold">{scoreLine(m.sets)}</span>
              <span className="text-xs font-semibold" style={{ color: resultColor }}>{result.text}</span>
            </div>

            <div className="mt-2 space-y-1 text-sm">
              {partners.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="opacity-50">Avec</span>
                  {partners.map((p) => <PlayerChip key={p.userId} p={p} />)}
                </div>
              )}
              {opponents.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="opacity-50">Contre</span>
                  {opponents.map((p) => <PlayerChip key={p.userId} p={p} />)}
                </div>
              )}
            </div>

            <div className="mt-2 text-xs opacity-60">
              {formatDateTime(m.playedAt)} · {m.sport.name}
            </div>
            <div className="text-xs opacity-60">
              {m.club.name}{m.resource ? ` · ${m.resource.name}` : ''}
            </div>

            {m.needsMyConfirmation && (
              <div className="mt-2 flex gap-2">
                <button type="button" disabled={busy === m.matchId} onClick={() => act(m.matchId, 'confirm')}
                  className="rounded-lg bg-black px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40">Confirmer</button>
                <button type="button" disabled={busy === m.matchId} onClick={() => act(m.matchId, 'dispute')}
                  className="rounded-lg bg-black/10 px-3 py-1.5 text-sm disabled:opacity-40">Contester</button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 4 : Lancer le test, vérifier le succès**

Run: `cd frontend && npm test -- MyMatchesList`
Expected: PASS.

- [ ] **Step 5 : Vérifier le typecheck + le reste de la suite front**

Run: `cd frontend && npx tsc --noEmit && npm test`
Expected: tsc clean, tous les tests verts.

- [ ] **Step 6 : Commit**

```bash
git add frontend/components/match/MyMatchesList.tsx frontend/__tests__/MyMatchesList.test.tsx
git commit -m "feat(match): cartes de match enrichies (joueurs, club, terrain, heure)"
```

---

## Vérification finale

- [ ] `cd backend && npm test` — vert.
- [ ] `cd frontend && npx tsc --noEmit && npm test` — vert.
- [ ] Revue end-to-end : le payload backend (`players/club/sport/resource/isMe`) correspond exactement à ce que `MyMatchesList` consomme via `MyMatch` + `splitTeams` (cohérence des noms de champs cross-layer).
- [ ] Aucune migration introduite (`git diff --stat` ne touche pas `prisma/`).
