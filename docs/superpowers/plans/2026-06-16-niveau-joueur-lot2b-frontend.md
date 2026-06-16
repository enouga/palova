# Niveau de joueur — Lot 2b (Frontend : saisie, confirmation, file de litiges) — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Rendre les matchs utilisables : saisir un résultat (assignation des 2 équipes + score set-par-set) depuis **Mes réservations / Calendrier** ET depuis une **partie ouverte** passée ; confirmer/contester ses matchs ; et une **file de litiges** dans `/admin`.

**Architecture :** Un helper pur `lib/match.ts` (libellés de score, éligibilité d'une résa). Un composant réutilisable `MatchResultModal` (équipes 2+2 + steppers de score) ouvert par la page. Une section/onglet « Matchs » dans `/me/reservations` (confirmation). Une page `/admin/matches`. Glue backend minime : exposer `reservationId` sur `GET /api/me/matches` pour savoir quelles réservations ont déjà un résultat.

**Tech Stack :** Next.js 16 / React 19 / TS / Tailwind v4, Jest + RTL. Backend Express (Lot 2a déjà poussé).

**Spec :** `docs/superpowers/specs/2026-06-16-systeme-niveau-joueur-design.md`
**Pré-requis (Lot 2a, sur origin/main `6d4a6b3`)** : routes `POST /api/reservations/:id/match`, `POST /api/matches/:id/{confirm,dispute}`, `GET /api/me/matches`, admin `GET/POST /api/clubs/:clubId/admin/matches[/:id/resolve]`.

**Machine :** worktree `C:\dev\palova-wt-niveau`, branche `feat/player-rating-lot1`. Frontend depuis `C:\dev\palova-wt-niveau\frontend` (`npx jest <file>`, `npx tsc --noEmit`). Backend depuis `backend`.

---

### Task 1: Glue backend — exposer `reservationId` sur `GET /api/me/matches`

**Files:**
- Modify: `backend/src/routes/me.ts` (la route `GET /matches`)
- Modify: `backend/src/routes/__tests__/match.routes.test.ts` (si elle teste la forme — sinon ajouter une assertion légère)

- [ ] **Step 1: Mettre à jour la route** — dans `GET /matches` de `me.ts`, ajouter `reservationId` au `select` du match et au mapping :
  - dans `match: { select: { ... } }` ajouter `reservationId: true`,
  - dans l'objet renvoyé ajouter `reservationId: r.match.reservationId,`.

- [ ] **Step 2: tsc + test backend** : `cd C:\dev\palova-wt-niveau\backend && npx tsc --noEmit && npx jest src/routes/__tests__/match.routes.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd C:\dev\palova-wt-niveau
git add backend/src/routes/me.ts backend/src/routes/__tests__/match.routes.test.ts
git commit -m "feat(rating): expose reservationId sur GET /me/matches"
```

---

### Task 2: Client API + types (front)

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Ajouter les types** près des autres interfaces :

```ts
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
}

export interface ClubMatchPlayer {
  userId: string; team: number; confirmation: 'PENDING' | 'CONFIRMED' | 'DISPUTED';
  user: { firstName: string; lastName: string };
}
export interface ClubMatch {
  id: string; status: 'PENDING' | 'CONFIRMED' | 'DISPUTED' | 'CANCELLED';
  sets: [number, number][]; playedAt: string; winningTeam: number | null; confirmDeadline: string;
  players: ClubMatchPlayer[];
}
```

- [ ] **Step 2: Ajouter les méthodes** dans l'objet `api` (suivre le style de `getMyReservations`/`request`) :

```ts
  recordMatchResult: (reservationId: string, body: { teams: Record<1 | 2, string[]>; sets: [number, number][] }, token: string) =>
    request<{ id: string; status: string }>(`/api/reservations/${reservationId}/match`, { method: 'POST', body: JSON.stringify(body) }, token),
  getMyMatches: (token: string) => request<MyMatch[]>('/api/me/matches', {}, token),
  confirmMatch: (matchId: string, token: string) =>
    request<{ ok: true }>(`/api/matches/${matchId}/confirm`, { method: 'POST' }, token),
  disputeMatch: (matchId: string, token: string) =>
    request<{ ok: true }>(`/api/matches/${matchId}/dispute`, { method: 'POST' }, token),
  getClubMatches: (clubId: string, status: string, token: string) =>
    request<ClubMatch[]>(`/api/clubs/${clubId}/admin/matches?status=${encodeURIComponent(status)}`, {}, token),
  resolveClubMatch: (clubId: string, matchId: string, body: { action: 'VALIDATE' | 'CANCEL'; sets?: [number, number][] }, token: string) =>
    request<{ ok: true }>(`/api/clubs/${clubId}/admin/matches/${matchId}/resolve`, { method: 'POST', body: JSON.stringify(body) }, token),
```

- [ ] **Step 3: tsc** : `cd C:\dev\palova-wt-niveau\frontend && npx tsc --noEmit` → PASS.

- [ ] **Step 4: Commit**

```bash
cd C:\dev\palova-wt-niveau
git add frontend/lib/api.ts
git commit -m "feat(rating): client API matchs (saisie/confirmation/litiges)"
```

---

### Task 3: Helper pur `lib/match.ts`

**Files:**
- Create: `frontend/lib/match.ts`
- Test: `frontend/__tests__/match.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/__tests__/match.test.ts
import { scoreLine, canRecordResult, validSets, winnerFromSets } from '@/lib/match';

describe('scoreLine', () => {
  it('formate les sets', () => expect(scoreLine([[6, 4], [3, 6], [7, 5]])).toBe('6-4 / 3-6 / 7-5'));
  it('vide → tiret', () => expect(scoreLine([])).toBe('—'));
});

describe('canRecordResult', () => {
  const base = { endTime: '2026-06-10T11:00:00Z', participants: [1, 2, 3, 4].map((i) => ({ userId: `u${i}` })) } as any;
  it('résa passée à 4 joueurs → true', () => expect(canRecordResult(base, new Date('2026-06-11T00:00:00Z'))).toBe(true));
  it('résa future → false', () => expect(canRecordResult(base, new Date('2026-06-09T00:00:00Z'))).toBe(false));
  it('moins de 4 joueurs → false', () =>
    expect(canRecordResult({ ...base, participants: [{ userId: 'u1' }] }, new Date('2026-06-11T00:00:00Z'))).toBe(false));
});

describe('validSets / winnerFromSets', () => {
  it('au moins un set, scores 0-7, pas d égalité', () => {
    expect(validSets([[6, 4]])).toBe(true);
    expect(validSets([])).toBe(false);
    expect(validSets([[6, 6]])).toBe(false);
    expect(validSets([[8, 4]])).toBe(false);
  });
  it('vainqueur au nombre de sets', () => {
    expect(winnerFromSets([[6, 4], [3, 6], [6, 2]])).toBe(1);
    expect(winnerFromSets([[4, 6], [3, 6]])).toBe(2);
  });
});
```

- [ ] **Step 2: Run, verify FAIL** : `cd C:\dev\palova-wt-niveau\frontend && npx jest __tests__/match.test.ts`

- [ ] **Step 3: Implementation**

```ts
// frontend/lib/match.ts
// Helpers purs pour la saisie/affichage des résultats de match. Miroir léger de la logique backend.

export type SetScore = [number, number];

export function scoreLine(sets: SetScore[]): string {
  if (!sets.length) return '—';
  return sets.map(([a, b]) => `${a}-${b}`).join(' / ');
}

/** Une réservation peut donner lieu à un résultat si elle est passée et a exactement 4 participants. */
export function canRecordResult(
  reservation: { endTime: string; participants: { userId: string }[] },
  now: Date,
): boolean {
  return new Date(reservation.endTime).getTime() <= now.getTime() && reservation.participants.length === 4;
}

/** Sets valides : ≥1 set, chaque jeu 0–7, pas d'égalité dans un set. */
export function validSets(sets: SetScore[]): boolean {
  if (!sets.length) return false;
  return sets.every(([a, b]) =>
    Number.isInteger(a) && Number.isInteger(b) && a >= 0 && a <= 7 && b >= 0 && b <= 7 && a !== b);
}

export function winnerFromSets(sets: SetScore[]): 1 | 2 {
  let s1 = 0, s2 = 0;
  for (const [a, b] of sets) { if (a > b) s1++; else if (b > a) s2++; }
  return s1 >= s2 ? 1 : 2;
}
```

- [ ] **Step 4: Run, verify PASS**

- [ ] **Step 5: Commit**

```bash
cd C:\dev\palova-wt-niveau
git add frontend/lib/match.ts frontend/__tests__/match.test.ts
git commit -m "feat(rating): helpers purs match (score, éligibilité, validation)"
```

---

### Task 4: Composant `MatchResultModal` (assignation équipes + score set-par-set)

**Files:**
- Create: `frontend/components/match/MatchResultModal.tsx`
- Test: `frontend/__tests__/MatchResultModal.test.tsx`

Contrat : props `{ reservationId, players: {userId, firstName, lastName, avatarUrl}[], token, onClose, onSaved }`. L'utilisateur affecte les 4 joueurs à l'équipe 1 ou 2 (exactement 2+2), saisit 1 à 3 sets (steppers 0–7), puis « Enregistrer » → `api.recordMatchResult`. Le bouton est désactivé tant que la composition n'est pas 2+2 ou les sets invalides.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/__tests__/MatchResultModal.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MatchResultModal } from '@/components/match/MatchResultModal';

jest.mock('@/lib/api', () => ({
  __esModule: true,
  api: { recordMatchResult: jest.fn().mockResolvedValue({ id: 'm1', status: 'PENDING' }) },
  assetUrl: (u: string) => u,
}));
import { api } from '@/lib/api';

const players = [
  { userId: 'u1', firstName: 'A', lastName: 'A', avatarUrl: null },
  { userId: 'u2', firstName: 'B', lastName: 'B', avatarUrl: null },
  { userId: 'u3', firstName: 'C', lastName: 'C', avatarUrl: null },
  { userId: 'u4', firstName: 'D', lastName: 'D', avatarUrl: null },
];

it('enregistre un résultat 2+2 avec un set', async () => {
  const onSaved = jest.fn();
  render(<MatchResultModal reservationId="r1" players={players} token="t" onClose={() => {}} onSaved={onSaved} />);
  // affecter u1,u2 → équipe 1 ; u3,u4 → équipe 2 (les boutons portent un libellé "Équipe 1"/"Équipe 2" par joueur)
  fireEvent.click(screen.getByTestId('team1-u1'));
  fireEvent.click(screen.getByTestId('team1-u2'));
  fireEvent.click(screen.getByTestId('team2-u3'));
  fireEvent.click(screen.getByTestId('team2-u4'));
  // set 1 : 6-4 via les steppers (boutons +)
  fireEvent.click(screen.getByTestId('set0-team1-plus')); // 1
  // ... le test pousse jusqu'à des valeurs valides
  for (let i = 0; i < 6; i++) fireEvent.click(screen.getByTestId('set0-team1-plus'));
  for (let i = 0; i < 4; i++) fireEvent.click(screen.getByTestId('set0-team2-plus'));
  fireEvent.click(screen.getByText('Enregistrer'));
  await waitFor(() => expect(api.recordMatchResult).toHaveBeenCalled());
  const call = (api.recordMatchResult as jest.Mock).mock.calls[0];
  expect(call[0]).toBe('r1');
  expect(call[1].teams[1]).toEqual(expect.arrayContaining(['u1', 'u2']));
  expect(call[1].teams[2]).toEqual(expect.arrayContaining(['u3', 'u4']));
  expect(onSaved).toHaveBeenCalled();
});

it('désactive Enregistrer si composition incomplète', () => {
  render(<MatchResultModal reservationId="r1" players={players} token="t" onClose={() => {}} onSaved={() => {}} />);
  expect(screen.getByText('Enregistrer')).toBeDisabled();
});
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implementation**

```tsx
// frontend/components/match/MatchResultModal.tsx
'use client';
import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { SetScore, validSets } from '@/lib/match';

interface Player { userId: string; firstName: string; lastName: string; avatarUrl: string | null; }
interface Props {
  reservationId: string;
  players: Player[];
  token: string;
  onClose: () => void;
  onSaved: () => void;
}

export function MatchResultModal({ reservationId, players, token, onClose, onSaved }: Props) {
  const [team, setTeam] = useState<Record<string, 1 | 2 | undefined>>({});
  const [sets, setSets] = useState<SetScore[]>([[0, 0]]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const t1 = players.filter((p) => team[p.userId] === 1).map((p) => p.userId);
  const t2 = players.filter((p) => team[p.userId] === 2).map((p) => p.userId);
  const compositionOk = t1.length === 2 && t2.length === 2;
  const setsOk = validSets(sets);
  const canSave = compositionOk && setsOk && !busy;

  const assign = (userId: string, t: 1 | 2) =>
    setTeam((prev) => ({ ...prev, [userId]: prev[userId] === t ? undefined : t }));

  const bump = (i: number, side: 0 | 1, delta: number) =>
    setSets((prev) => prev.map((s, idx) => (idx === i
      ? (side === 0 ? [Math.max(0, Math.min(7, s[0] + delta)), s[1]] : [s[0], Math.max(0, Math.min(7, s[1] + delta))]) as SetScore
      : s)));

  const teamFull = (t: 1 | 2, userId: string) => (t === 1 ? t1 : t2).length >= 2 && team[userId] !== t;

  const save = async () => {
    setBusy(true); setError(null);
    try {
      await api.recordMatchResult(reservationId, { teams: { 1: t1, 2: t2 }, sets }, token);
      onSaved();
    } catch {
      setError('Échec de l’enregistrement.');
    } finally { setBusy(false); }
  };

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="w-full max-w-md rounded-t-2xl bg-white p-4 sm:rounded-2xl">
        <h2 className="mb-3 text-lg font-semibold">Saisir le résultat</h2>

        <div className="mb-4 space-y-2">
          {players.map((p) => (
            <div key={p.userId} className="flex items-center justify-between gap-2">
              <span className="truncate">{p.firstName} {p.lastName}</span>
              <span className="flex gap-1">
                <button type="button" data-testid={`team1-${p.userId}`} disabled={teamFull(1, p.userId)}
                  onClick={() => assign(p.userId, 1)}
                  className={`rounded-lg px-2 py-1 text-sm ${team[p.userId] === 1 ? 'bg-black text-white' : 'bg-black/10'} disabled:opacity-40`}>
                  Équipe 1
                </button>
                <button type="button" data-testid={`team2-${p.userId}`} disabled={teamFull(2, p.userId)}
                  onClick={() => assign(p.userId, 2)}
                  className={`rounded-lg px-2 py-1 text-sm ${team[p.userId] === 2 ? 'bg-black text-white' : 'bg-black/10'} disabled:opacity-40`}>
                  Équipe 2
                </button>
              </span>
            </div>
          ))}
        </div>

        <div className="mb-4 space-y-2">
          {sets.map((s, i) => (
            <div key={i} className="flex items-center justify-center gap-3">
              <span className="w-12 text-right text-sm opacity-70">Set {i + 1}</span>
              {[0, 1].map((sideRaw) => {
                const side = sideRaw as 0 | 1;
                return (
                  <span key={side} className="flex items-center gap-1">
                    <button type="button" data-testid={`set${i}-team${side + 1}-minus`} onClick={() => bump(i, side, -1)} className="rounded bg-black/10 px-2">−</button>
                    <span className="w-6 text-center font-semibold">{s[side]}</span>
                    <button type="button" data-testid={`set${i}-team${side + 1}-plus`} onClick={() => bump(i, side, +1)} className="rounded bg-black/10 px-2">+</button>
                  </span>
                );
              })}
            </div>
          ))}
          {sets.length < 3 && (
            <button type="button" onClick={() => setSets((p) => [...p, [0, 0]])} className="text-sm underline opacity-70">+ Ajouter un set</button>
          )}
        </div>

        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
        {!compositionOk && <p className="mb-2 text-xs opacity-60">Affecte 2 joueurs par équipe.</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm">Annuler</button>
          <button type="button" disabled={!canSave} onClick={save}
            className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run, verify PASS** (+ `npx tsc --noEmit`)

- [ ] **Step 5: Commit**

```bash
cd C:\dev\palova-wt-niveau
git add frontend/components/match/MatchResultModal.tsx frontend/__tests__/MatchResultModal.test.tsx
git commit -m "feat(rating): MatchResultModal (équipes + score set-par-set)"
```

---

### Task 5: Entrée « Saisir le résultat » dans Mes réservations (liste passée + Calendrier)

**Files:**
- Modify: `frontend/app/me/reservations/page.tsx`
- Modify: `frontend/components/calendar/DayPanel.tsx`

Comportement : la page charge aussi `api.getMyMatches(token)` ; pour chaque réservation passée à 4 joueurs **sans match existant** (aucun `MyMatch.reservationId === reservation.id`), afficher un bouton **« Saisir le résultat »** qui ouvre `MatchResultModal` (la page détient l'état `recordingFor: MyReservation | null`). Si un match existe déjà, afficher un libellé discret (« Résultat enregistré » / « À confirmer »).

- [ ] **Step 1: Page** — dans `frontend/app/me/reservations/page.tsx` :
  - état : `const [matches, setMatches] = useState<MyMatch[]>([]);` et `const [recordingFor, setRecordingFor] = useState<MyReservation | null>(null);`
  - au chargement (là où `getMyReservations` est appelé), ajouter `api.getMyMatches(token).then(setMatches).catch(() => {});`
  - helper local : `const matchFor = (rid: string) => matches.find((m) => m.reservationId === rid);`
  - passer aux sous-listes (liste passée + DayPanel) une prop d'action `onRecordResult={(r) => setRecordingFor(r)}` et le set `matches` (ou `matchFor`).
  - rendu du modal en bas de page :
    ```tsx
    {recordingFor && (
      <MatchResultModal
        reservationId={recordingFor.id}
        players={recordingFor.participants}
        token={token!}
        onClose={() => setRecordingFor(null)}
        onSaved={() => { setRecordingFor(null); api.getMyMatches(token!).then(setMatches).catch(() => {}); }}
      />
    )}
    ```
  - imports : `MatchResultModal`, `MyMatch`, `canRecordResult` (de `@/lib/match`).
  - Dans la branche « past » (liste), pour chaque réservation `r` : si `canRecordResult(r, new Date(now ?? Date.now()))` et `!matchFor(r.id)` → bouton « Saisir le résultat » (`onClick={() => setRecordingFor(r)}`) ; sinon si `matchFor(r.id)` → petit libellé selon `status` (`PENDING`→« À confirmer », `CONFIRMED`→« Résultat enregistré », `DISPUTED`→« En litige »).

- [ ] **Step 2: DayPanel** — `frontend/components/calendar/DayPanel.tsx` : ajouter à ses props `onRecordResult?: (r: MyReservation) => void;` et `matchByReservation?: (id: string) => MyMatch | undefined;` ; pour une réservation passée à 4 joueurs sans match, afficher le même bouton « Saisir le résultat » (à côté de « Annuler »/« Déplacer »). Garder le composant rétro-compatible (props optionnelles).

- [ ] **Step 3: tsc + tests existants** : `cd C:\dev\palova-wt-niveau\frontend && npx tsc --noEmit && npx jest __tests__/` (relancer la suite ; corriger les mocks `lib/api` des tests de cette page s'ils cassent — ajouter `getMyMatches: jest.fn().mockResolvedValue([])` et `recordMatchResult: jest.fn()`).

- [ ] **Step 4: Commit**

```bash
cd C:\dev\palova-wt-niveau
git add frontend/app/me/reservations/page.tsx frontend/components/calendar/DayPanel.tsx
git commit -m "feat(rating): saisie du résultat depuis Mes réservations + Calendrier"
```

---

### Task 6: Entrée « Saisir le résultat » sur une partie ouverte passée

**Files:**
- Modify: `frontend/components/openmatch/OpenMatches.tsx`

Comportement : sur une partie ouverte **passée** et **complète (4 joueurs)**, afficher « Saisir le résultat » qui ouvre `MatchResultModal` (état local au composant). Réutiliser `canRecordResult`. (Si `OpenMatches` ne connaît pas le résultat existant, se reposer sur le 409 backend : en cas d'échec « match déjà enregistré », afficher un message ; sinon succès.)

- [ ] **Step 1: Implementation** — dans `OpenMatches.tsx`, ajouter un état `recordingFor` + le bouton conditionné par `canRecordResult(match, new Date())` et 4 participants ; rendre `MatchResultModal` avec les participants de la partie ; `onSaved` rafraîchit la liste / affiche une confirmation. Suivre le style des cartes existantes.

- [ ] **Step 2: tsc + test léger** — ajouter/мettre à jour un test `OpenMatches` si présent (au minimum : le bouton apparaît pour une partie passée complète). `cd C:\dev\palova-wt-niveau\frontend && npx tsc --noEmit && npx jest __tests__/` (corriger mocks `lib/api` si besoin).

- [ ] **Step 3: Commit**

```bash
cd C:\dev\palova-wt-niveau
git add frontend/components/openmatch/OpenMatches.tsx frontend/__tests__/
git commit -m "feat(rating): saisie du résultat depuis une partie ouverte passée"
```

---

### Task 7: Onglet « Matchs » (confirmation / contestation)

**Files:**
- Modify: `frontend/app/me/reservations/page.tsx`
- Create: `frontend/components/match/MyMatchesList.tsx`
- Test: `frontend/__tests__/MyMatchesList.test.tsx`

Comportement : un 4e onglet **« Matchs »** dans `/me/reservations` (le `Segmented` passe à 4 valeurs) qui liste `matches` (déjà chargés Task 5). Chaque match : score (`scoreLine`), date, statut, badge « Mon équipe a gagné/perdu ». Si `needsMyConfirmation` → boutons **Confirmer** / **Contester** (`api.confirmMatch` / `api.disputeMatch`), puis recharge.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/__tests__/MyMatchesList.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MyMatchesList } from '@/components/match/MyMatchesList';

jest.mock('@/lib/api', () => ({
  __esModule: true,
  api: { confirmMatch: jest.fn().mockResolvedValue({ ok: true }), disputeMatch: jest.fn().mockResolvedValue({ ok: true }) },
}));
import { api } from '@/lib/api';

const matches = [{
  matchId: 'm1', reservationId: 'r1', status: 'PENDING', sets: [[6, 4], [6, 3]] as [number, number][],
  playedAt: '2026-06-10T10:00:00Z', winningTeam: 1, myTeam: 2, myConfirmation: 'PENDING', ratingAfter: null, needsMyConfirmation: true,
}];

it('affiche le score et permet de confirmer', async () => {
  const onChanged = jest.fn();
  render(<MyMatchesList matches={matches as any} token="t" onChanged={onChanged} />);
  expect(screen.getByText('6-4 / 6-3')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Confirmer'));
  await waitFor(() => expect(api.confirmMatch).toHaveBeenCalledWith('m1', 't'));
  expect(onChanged).toHaveBeenCalled();
});

it('un match sans confirmation requise ne montre pas les boutons', () => {
  render(<MyMatchesList matches={[{ ...matches[0], needsMyConfirmation: false }] as any} token="t" onChanged={() => {}} />);
  expect(screen.queryByText('Confirmer')).toBeNull();
});
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implementation**

```tsx
// frontend/components/match/MyMatchesList.tsx
'use client';
import { useState } from 'react';
import { api, MyMatch } from '@/lib/api';
import { scoreLine } from '@/lib/match';

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
        const won = m.winningTeam === m.myTeam;
        return (
          <li key={m.matchId} className="rounded-xl border p-3" style={{ borderColor: 'rgba(0,0,0,0.1)' }}>
            <div className="flex items-center justify-between">
              <span className="font-semibold">{scoreLine(m.sets)}</span>
              <span className="text-xs opacity-60">{new Date(m.playedAt).toLocaleDateString('fr-FR')}</span>
            </div>
            <div className="mt-1 text-sm opacity-70">
              {m.status === 'CONFIRMED' ? (won ? 'Victoire' : 'Défaite')
                : m.status === 'DISPUTED' ? 'En litige'
                : m.status === 'CANCELLED' ? 'Annulé' : 'En attente de confirmation'}
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

- [ ] **Step 4: Brancher l'onglet** dans `page.tsx` : étendre le type du `Segmented` à `'upcoming' | 'past' | 'calendar' | 'matches'`, ajouter l'option `{ value: 'matches', label: 'Matchs' }`, et `{tab === 'matches' && <MyMatchesList matches={matches} token={token!} onChanged={() => api.getMyMatches(token!).then(setMatches)} />}`.

- [ ] **Step 5: Run, verify PASS + tsc**

- [ ] **Step 6: Commit**

```bash
cd C:\dev\palova-wt-niveau
git add frontend/components/match/MyMatchesList.tsx frontend/app/me/reservations/page.tsx frontend/__tests__/MyMatchesList.test.tsx
git commit -m "feat(rating): onglet Matchs (confirmation/contestation)"
```

---

### Task 8: File de litiges admin `/admin/matches`

**Files:**
- Create: `frontend/app/admin/matches/page.tsx`
- Modify: la navigation admin (sidebar) pour ajouter le lien « Matchs »
- Test: `frontend/__tests__/AdminMatches.test.tsx`

Comportement : page `/admin` listant les matchs **DISPUTED** du club (`api.getClubMatches(clubId, 'DISPUTED', token)`), chaque ligne avec score + joueurs + boutons **Valider** / **Annuler** (`api.resolveClubMatch(clubId, id, { action }, token)`), puis recharge. Suivre le shell/garde des autres pages `/admin` (récupérer `clubId` via le contexte admin existant, comme les autres pages).

- [ ] **Step 1: Write the failing test** (rendu liste + action). S'inspirer d'un test de page `/admin` existant pour le wrapper/mocks (`useClub`, `useAuth`, `api`). Au minimum :

```tsx
// frontend/__tests__/AdminMatches.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
jest.mock('@/lib/api', () => ({
  __esModule: true,
  api: {
    getClubMatches: jest.fn().mockResolvedValue([{ id: 'm1', status: 'DISPUTED', sets: [[6, 4]], playedAt: '2026-06-10T10:00:00Z', winningTeam: 1, confirmDeadline: '', players: [] }]),
    resolveClubMatch: jest.fn().mockResolvedValue({ ok: true }),
  },
}));
// + mocks useClub/useAuth selon le pattern d'un test admin existant
```

(Adapter au harnais admin réel ; l'essentiel testé : la liste s'affiche et « Annuler » appelle `resolveClubMatch` avec `{ action: 'CANCEL' }`.)

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implementation** — créer `frontend/app/admin/matches/page.tsx` en copiant la structure d'une page `/admin` simple existante (shell, garde server-verified, accès `clubId`/`token`), afficher la liste et les actions. Ajouter l'entrée « Matchs » dans la sidebar admin (là où sont déclarés les liens, ex. à côté de « Tournois »/« Events »).

- [ ] **Step 4: Run, verify PASS + tsc**

- [ ] **Step 5: Commit**

```bash
cd C:\dev\palova-wt-niveau
git add frontend/app/admin/matches/page.tsx frontend/__tests__/AdminMatches.test.tsx frontend/components/  # + le fichier de nav modifié
git commit -m "feat(rating): file de litiges admin /admin/matches"
```

---

### Task 9: Vérification finale Lot 2b (gate + visuel)

- [ ] **Step 1: Gate frontend** : `cd C:\dev\palova-wt-niveau\frontend && npx tsc --noEmit && npx jest`
Expected: tout vert.

- [ ] **Step 2: Gate backend** (la glue Task 1) : `cd C:\dev\palova-wt-niveau\backend && npx jest src/routes/__tests__/match.routes.test.ts`

- [ ] **Step 3: Vérif visuelle** (navigateur) : démarrer back+front (Docker up), se connecter, créer/charger une réservation passée à 4 joueurs, vérifier le bouton « Saisir le résultat » → modal → soumission ; vérifier l'onglet « Matchs » (confirmation) ; vérifier `/admin/matches`. Confirmer que les niveaux des joueurs bougent après confirmation des 4 (carte profil « Mon niveau padel »).

---

## Notes de périmètre (Lot 2b)

- **Les deux entrées de saisie** (Mes réservations/Calendrier + partie ouverte) comme demandé.
- Le bouton « Saisir le résultat » n'apparaît que pour une **réservation passée à 4 joueurs sans match existant** (cross-référence via `MyMatch.reservationId`).
- L'**affichage du niveau sur les pastilles joueurs / annuaire / leaderboard** n'est PAS dans ce lot — c'est le **Lot 3**.
- Pas d'édition de la composition d'équipe après coup côté joueur (seul le staff corrige via la file de litiges).
