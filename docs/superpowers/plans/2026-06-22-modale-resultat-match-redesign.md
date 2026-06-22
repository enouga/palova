# Refonte modale « Saisir le résultat » — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refonte visuelle de `MatchResultModal` (thème + avatars colorés + bascule 1|2 + bandeau équipes + colonnes colorées + badge vainqueur live + ligne contexte), sans changer la logique métier ni le payload.

**Architecture:** Réécriture du composant client `MatchResultModal.tsx` en réutilisant les briques existantes (`useTheme`, `Avatar`, `colorForSeed`, `ACCENTS`/`inkOn`, helpers `lib/match`). Ajout d'une prop optionnelle `context`. Les deux appelants la passent. Aucun backend.

**Tech Stack:** Next.js 16 + React 19 + TypeScript + Tailwind, Jest + React Testing Library.

---

## File Structure

- `frontend/components/match/MatchResultModal.tsx` — réécriture (logique d'état inchangée, présentation refondue, prop `context`).
- `frontend/__tests__/MatchResultModal.test.tsx` — réécriture (wrap `ThemeProvider`, conserve les 2 tests existants, ajoute avatars/vainqueur/contexte).
- `frontend/app/me/reservations/page.tsx` — passe `context` à la modale.
- `frontend/components/openmatch/OpenMatches.tsx` — passe `context` à la modale.

---

## Task 1 : Réécriture du composant + tests

**Files:**
- Modify (rewrite): `frontend/components/match/MatchResultModal.tsx`
- Modify (rewrite): `frontend/__tests__/MatchResultModal.test.tsx`

- [ ] **Step 1 : Réécrire le fichier de test**

D'abord vérifier le chemin d'import de `ThemeProvider` en regardant un test frère qui l'utilise (ex. `frontend/__tests__/MyMatchesList.test.tsx` ou `PlayerPills.test.tsx`) — utiliser le même chemin. Le plan suppose `@/lib/ThemeProvider` ; corriger si le frère diffère.

Remplacer tout le contenu de `frontend/__tests__/MatchResultModal.test.tsx` par :

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { MatchResultModal } from '@/components/match/MatchResultModal';

jest.mock('@/lib/api', () => ({
  __esModule: true,
  api: { recordMatchResult: jest.fn().mockResolvedValue({ id: 'm1', status: 'PENDING' }) },
  assetUrl: (u: string) => u,
}));
import { api } from '@/lib/api';

const players = [
  { userId: 'u1', firstName: 'Alice', lastName: 'Martin', avatarUrl: null },
  { userId: 'u2', firstName: 'Bob', lastName: 'Durand', avatarUrl: null },
  { userId: 'u3', firstName: 'Chloe', lastName: 'Roy', avatarUrl: null },
  { userId: 'u4', firstName: 'David', lastName: 'Petit', avatarUrl: null },
];

const renderModal = (extra: Record<string, unknown> = {}) =>
  render(
    <ThemeProvider>
      <MatchResultModal reservationId="r1" players={players} token="t" onClose={() => {}} onSaved={() => {}} {...extra} />
    </ThemeProvider>,
  );

function assignTeams() {
  fireEvent.click(screen.getByTestId('team1-u1'));
  fireEvent.click(screen.getByTestId('team1-u2'));
  fireEvent.click(screen.getByTestId('team2-u3'));
  fireEvent.click(screen.getByTestId('team2-u4'));
}

it('enregistre un résultat 2+2 avec un set', async () => {
  const onSaved = jest.fn();
  render(
    <ThemeProvider>
      <MatchResultModal reservationId="r1" players={players} token="t" onClose={() => {}} onSaved={onSaved} />
    </ThemeProvider>,
  );
  assignTeams();
  for (let i = 0; i < 6; i++) fireEvent.click(screen.getByTestId('set0-team1-plus'));
  for (let i = 0; i < 4; i++) fireEvent.click(screen.getByTestId('set0-team2-plus'));
  fireEvent.click(screen.getByText('Enregistrer'));
  await waitFor(() => expect(api.recordMatchResult).toHaveBeenCalled());
  const call = (api.recordMatchResult as jest.Mock).mock.calls[0];
  expect(call[0]).toBe('r1');
  expect(call[1].teams[1]).toEqual(expect.arrayContaining(['u1', 'u2']));
  expect(call[1].teams[2]).toEqual(expect.arrayContaining(['u3', 'u4']));
  expect(call[1].sets[0]).toEqual([6, 4]);
  expect(onSaved).toHaveBeenCalled();
});

it('désactive Enregistrer si composition incomplète', () => {
  renderModal();
  expect(screen.getByText('Enregistrer')).toBeDisabled();
});

it('affiche les noms des joueurs', () => {
  renderModal();
  expect(screen.getByText('Alice Martin')).toBeInTheDocument();
  expect(screen.getByText('David Petit')).toBeInTheDocument();
});

it('affiche le badge vainqueur après une saisie valide', () => {
  renderModal();
  assignTeams();
  for (let i = 0; i < 6; i++) fireEvent.click(screen.getByTestId('set0-team1-plus'));
  for (let i = 0; i < 4; i++) fireEvent.click(screen.getByTestId('set0-team2-plus'));
  expect(screen.getByText(/Équipe 1 gagne/)).toBeInTheDocument();
});

it('affiche la ligne de contexte quand context est fourni', () => {
  renderModal({ context: { whenIso: '2026-06-20T16:30:00Z', tz: 'Europe/Paris', courtName: 'Court 2' } });
  expect(screen.getByText(/Court 2/)).toBeInTheDocument();
});

it('aucune ligne de contexte quand context est absent', () => {
  renderModal();
  expect(screen.queryByText(/Court 2/)).toBeNull();
});
```

- [ ] **Step 2 : Lancer les tests, vérifier l'échec**

Run: `cd frontend && npm test -- MatchResultModal`
Expected: FAIL — badge vainqueur / ligne contexte absents (et erreur `useTheme` si le composant n'est pas encore adapté).

- [ ] **Step 3 : Réécrire le composant**

Remplacer tout le contenu de `frontend/components/match/MatchResultModal.tsx` par :

```tsx
'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { SetScore, validSets, winnerFromSets } from '@/lib/match';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS, inkOn } from '@/lib/theme';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';

interface Player { userId: string; firstName: string; lastName: string; avatarUrl: string | null; }
interface MatchContext { whenIso: string; tz: string; courtName: string; }
interface Props {
  reservationId: string;
  players: Player[];
  token: string;
  onClose: () => void;
  onSaved: () => void;
  context?: MatchContext;
}

const TEAM_COLORS: Record<1 | 2, string> = { 1: ACCENTS.blue, 2: ACCENTS.coral };

function fmtContext(ctx: MatchContext): string {
  const d = new Date(ctx.whenIso);
  const date = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: ctx.tz }).format(d);
  const hour = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: ctx.tz }).format(d).replace(':', 'h');
  return `${date} · ${hour} · ${ctx.courtName}`;
}

export function MatchResultModal({ reservationId, players, token, onClose, onSaved, context }: Props) {
  const { th } = useTheme();
  const [team, setTeam] = useState<Record<string, 1 | 2 | undefined>>({});
  const [sets, setSets] = useState<SetScore[]>([[0, 0]]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const t1 = players.filter((p) => team[p.userId] === 1).map((p) => p.userId);
  const t2 = players.filter((p) => team[p.userId] === 2).map((p) => p.userId);
  const compositionOk = t1.length === 2 && t2.length === 2;
  const setsOk = validSets(sets);
  const canSave = compositionOk && setsOk && !busy;

  const wins: [number, number] = sets.reduce<[number, number]>(
    (acc, [a, b]) => { if (a > b) acc[0]++; else if (b > a) acc[1]++; return acc; }, [0, 0]);
  const showWinner = compositionOk && setsOk;
  const winner = showWinner ? winnerFromSets(sets) : null;

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

  const stepBtn = { border: `1px solid ${th.lineStrong}`, color: th.textMute } as const;

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" style={{ background: 'rgba(0,0,0,0.45)' }}>
      <div className="w-full max-w-md rounded-t-2xl p-4 sm:rounded-2xl" style={{ background: th.surface, color: th.text, fontFamily: th.fontUI }}>
        <div className="mb-4">
          <h2 className="text-lg font-semibold">Saisir le résultat</h2>
          {context && <p className="mt-0.5 text-sm" style={{ color: th.textMute }}>{fmtContext(context)}</p>}
        </div>

        <div className="mb-3 flex gap-2">
          {([1, 2] as const).map((n) => {
            const count = (n === 1 ? t1 : t2).length;
            return (
              <div key={n} className="flex flex-1 items-center gap-2 rounded-lg px-3 py-2" style={{ background: th.surface2 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: TEAM_COLORS[n] }} />
                <span className="text-xs font-semibold">Équipe {n}</span>
                <span className="ml-auto text-xs" style={{ color: th.textMute }}>{count}/2</span>
              </div>
            );
          })}
        </div>

        <div className="mb-4 flex flex-col gap-2">
          {players.map((p) => (
            <div key={p.userId} className="flex items-center gap-3">
              <Avatar firstName={p.firstName} lastName={p.lastName} avatarUrl={p.avatarUrl} size={30} color={colorForSeed(p.userId)} />
              <span className="flex-1 truncate text-sm">{p.firstName} {p.lastName}</span>
              <span className="inline-flex overflow-hidden rounded-lg" style={{ border: `1px solid ${th.lineStrong}` }}>
                {([1, 2] as const).map((t) => {
                  const active = team[p.userId] === t;
                  return (
                    <button key={t} type="button" data-testid={`team${t}-${p.userId}`} disabled={teamFull(t, p.userId)}
                      onClick={() => assign(p.userId, t)}
                      className="px-3 py-1 text-sm font-semibold disabled:opacity-40"
                      style={active ? { background: TEAM_COLORS[t], color: inkOn(TEAM_COLORS[t]) } : { background: th.surface2, color: th.textMute }}>
                      {t}
                    </button>
                  );
                })}
              </span>
            </div>
          ))}
        </div>

        <div className="mb-1 flex items-center gap-3">
          <span className="w-12" />
          <div className="ml-auto flex items-center gap-4">
            <span className="w-[92px] text-center text-xs font-semibold" style={{ color: TEAM_COLORS[1] }}>Éq. 1</span>
            <span className="w-[92px] text-center text-xs font-semibold" style={{ color: TEAM_COLORS[2] }}>Éq. 2</span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {sets.map((s, i) => (
            <div key={i} className="flex items-center gap-3">
              <span className="w-12 text-sm" style={{ color: th.textMute }}>Set {i + 1}</span>
              <div className="ml-auto flex items-center gap-4">
                {[0, 1].map((sideRaw) => {
                  const side = sideRaw as 0 | 1;
                  return (
                    <span key={side} className="flex w-[92px] items-center justify-center gap-2">
                      <button type="button" data-testid={`set${i}-team${side + 1}-minus`} onClick={() => bump(i, side, -1)} className="rounded-md px-2" style={stepBtn}>−</button>
                      <span className="w-5 text-center font-semibold">{s[side]}</span>
                      <button type="button" data-testid={`set${i}-team${side + 1}-plus`} onClick={() => bump(i, side, +1)} className="rounded-md px-2" style={stepBtn}>+</button>
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="mb-3 mt-3 flex items-center justify-between">
          {sets.length < 3
            ? <button type="button" onClick={() => setSets((p) => [...p, [0, 0]])} className="text-sm underline" style={{ color: th.textMute }}>+ Ajouter un set</button>
            : <span />}
          {winner && (
            <span className="rounded-md px-2.5 py-1 text-xs font-semibold" style={{ background: TEAM_COLORS[winner], color: inkOn(TEAM_COLORS[winner]) }}>
              Équipe {winner} gagne {wins[winner - 1]}–{wins[winner === 1 ? 1 : 0]}
            </span>
          )}
        </div>

        {error && <p className="mb-2 text-sm" style={{ color: ACCENTS.coral }}>{error}</p>}
        {!compositionOk && <p className="mb-2 text-xs" style={{ color: th.textMute }}>Affecte 2 joueurs par équipe.</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm" style={{ color: th.textMute }}>Annuler</button>
          <button type="button" disabled={!canSave} onClick={save}
            className="rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-40"
            style={{ background: th.accent, color: th.onAccent }}>
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4 : Lancer les tests, vérifier le succès**

Run: `cd frontend && npm test -- MatchResultModal`
Expected: PASS (les 6 tests).

- [ ] **Step 5 : Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: pas d'erreur dans `MatchResultModal.tsx` ni le test (erreurs confinées à `.next/` générées = préexistantes, à ignorer). Vérifier en particulier que `ACCENTS`, `inkOn`, `useTheme`, `Avatar`, `colorForSeed`, `winnerFromSets`, `validSets`, `SetScore` sont bien exportés aux chemins importés ; corriger un chemin si l'import échoue.

- [ ] **Step 6 : Commit**

```bash
git add frontend/components/match/MatchResultModal.tsx frontend/__tests__/MatchResultModal.test.tsx
git commit -m "feat(match): refonte modale Saisir le résultat (thème, avatars, équipes, vainqueur)"
```

---

## Task 2 : Câbler la prop `context` dans les deux appelants

**Files:**
- Modify: `frontend/app/me/reservations/page.tsx` (rendu de `MatchResultModal`, ~ligne 274)
- Modify: `frontend/components/openmatch/OpenMatches.tsx` (rendu de `MatchResultModal`, ~ligne 185)

- [ ] **Step 1 : Passer `context` depuis `/me/reservations`**

Dans `frontend/app/me/reservations/page.tsx`, au rendu `<MatchResultModal ... />`, ajouter la prop `context` (le `recordingFor` est un `MyReservation` qui a `startTime` et `resource.{name,club.timezone}`) :

```tsx
<MatchResultModal
  reservationId={recordingFor.id}
  players={recordingFor.participants ?? []}
  token={token}
  context={{ whenIso: recordingFor.startTime, tz: recordingFor.resource.club.timezone, courtName: recordingFor.resource.name }}
  onClose={() => setRecordingFor(null)}
  onSaved={() => { setRecordingFor(null); api.getMyMatches(token).then(setMatches).catch(() => {}); }}
/>
```

- [ ] **Step 2 : Passer `context` depuis `OpenMatches`**

Dans `frontend/components/openmatch/OpenMatches.tsx`, au rendu `<MatchResultModal ... />` (le composant reçoit `club: ClubDetail` en prop ; `recordingFor` est un `OpenMatch` avec `startTime`/`resourceName`). Vérifier que `club.timezone` existe sur `ClubDetail` (sinon utiliser le bon accès au fuseau) :

```tsx
<MatchResultModal
  reservationId={recordingFor.id}
  players={recordingFor.players.map(({ userId, firstName, lastName, avatarUrl }) => ({ userId, firstName, lastName, avatarUrl }))}
  token={token}
  context={{ whenIso: recordingFor.startTime, tz: club.timezone, courtName: recordingFor.resourceName }}
  onClose={() => setRecordingFor(null)}
  onSaved={() => { setRecordingFor(null); load(); }}
/>
```

- [ ] **Step 3 : Typecheck + suite complète**

Run: `cd frontend && npx tsc --noEmit && npm test`
Expected: tsc sans erreur hors `.next/` ; toute la suite front verte (la ligne de contexte est rendue, rien d'autre cassé).

- [ ] **Step 4 : Commit**

```bash
git add frontend/app/me/reservations/page.tsx frontend/components/openmatch/OpenMatches.tsx
git commit -m "feat(match): passer le contexte (date/heure/terrain) à la modale de résultat"
```

---

## Vérification finale

- [ ] `cd frontend && npx tsc --noEmit` — clean (hors `.next/`).
- [ ] `cd frontend && npm test` — toute la suite verte.
- [ ] Revue end-to-end : la prop `context` envoyée par les deux appelants correspond au type `MatchContext` ({whenIso, tz, courtName}) ; les `data-testid` (`team1-/team2-/set{i}-team{n}-minus|plus`) sont intacts ; logique de save et payload inchangés.
- [ ] Aucune modification backend / `prisma/`.
