# Résultats à saisir compacts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer les grosses cartes « feuille de match » par UNE carte compacte (une ligne par match) et remplacer la modale de saisie à steppers −/+ par une feuille « tableau de score + pavé 0–7 ».

**Architecture:** 100 % frontend. Deux helpers purs testés (`teamLabel` dans `lib/resultsToRecord.ts` ; nouveau module `lib/scoreGrid.ts` pour la grille de score) portent la logique ; les deux composants (`ResultsToRecord.tsx`, `MatchResultModal.tsx`) sont réécrits pour les consommer. Le contrat des props et le payload `api.recordMatchResult` restent inchangés — aucun backend, aucune migration, aucune route.

**Tech Stack:** Next.js 16 (React client components), TypeScript, Jest + Testing Library, thème via `useTheme()`/`ThemeProvider`.

**Spec de référence :** `docs/superpowers/specs/2026-07-16-resultats-a-saisir-compact-design.md`

---

## Notes d'exécution (à lire avant de commencer)

- **Branche partagée** : le repo est édité en parallèle. Avant chaque `git commit`, `git add` **uniquement les chemins exacts** listés dans la tâche (jamais `git add -A`). Vérifie `git branch --show-current` = `feat/annonces-drag-drop-kiosque`.
- **Lancer les tests** : les shims `.bin` sont parfois cassés sur ce poste. Utilise le binaire directement :
  `node node_modules/jest/bin/jest.js <chemin> --no-coverage`
  Le type-check : `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` (bruité par le WIP parallèle ; grep tes fichiers).
- **jsdom** : `matchMedia`, `IntersectionObserver`, `ResizeObserver` sont déjà stubés dans `jest.setup.ts`.
- **Ordre** : Task 1 (helper) avant Task 2 (carte) ; Task 3 (scoreGrid) avant Task 4 (modale). Task 2 et Task 4 sont indépendantes l'une de l'autre.

---

## Structure des fichiers

- **Modifie** `frontend/lib/resultsToRecord.ts` — retire `abbrevName`, garde `teamRows`, ajoute `teamLabel` (prénoms + désambiguïsation par initiale).
- **Réécrit** `frontend/__tests__/resultsToRecord.test.ts` — tests de `teamRows` (conservés) + `teamLabel` (nouveaux) ; tests `abbrevName` retirés.
- **Réécrit** `frontend/components/match/ResultsToRecord.tsx` — une seule carte, une ligne par match.
- **Réécrit** `frontend/__tests__/ResultsToRecord.test.tsx` — nouvelle structure (carte unique), modale stubée pour découpler.
- **Crée** `frontend/lib/scoreGrid.ts` — modèle de grille pur (curseur, auto-avance, ⌫, conversion en `SetScore[]`).
- **Crée** `frontend/__tests__/scoreGrid.test.ts` — tests du modèle.
- **Réécrit** `frontend/components/match/MatchResultModal.tsx` — tableau de score + pavé, deux phases (affectation / score).
- **Réécrit** `frontend/__tests__/MatchResultModal.test.tsx` — pavé, auto-avance, correction, ⌫, CTA résumé, type Amicale/Compétitive, phase d'affectation.

Consommateurs de `ResultsToRecord` (inchangés, aucune édition) : `components/ClubHouse.tsx`, `components/openmatch/OpenMatches.tsx`, `app/me/matches/page.tsx`.
Consommateurs de `MatchResultModal` (inchangés — même contrat de props) : `ResultsToRecord.tsx`, `app/me/reservations/page.tsx`, `components/openmatch/OpenMatchModals.tsx`.

---

## Task 1: Helper `teamLabel` (prénoms + désambiguïsation)

**Files:**
- Modify: `frontend/lib/resultsToRecord.ts`
- Test: `frontend/__tests__/resultsToRecord.test.ts`

- [ ] **Step 1: Réécrire le test**

Remplace **tout** le contenu de `frontend/__tests__/resultsToRecord.test.ts` par :

```ts
import { teamRows, teamLabel } from '@/lib/resultsToRecord';
import type { MatchToRecordPlayer } from '@/lib/api';

const p = (userId: string, firstName: string, lastName: string, team: 1 | 2, slot: number): MatchToRecordPlayer =>
  ({ userId, firstName, lastName, avatarUrl: null, isOrganizer: false, team, slot });

const roster: MatchToRecordPlayer[] = [
  p('u1', 'Lucas', 'Moreau', 1, 0),
  p('u2', 'Jean', 'Dupont', 1, 1),
  p('u3', 'Celine', 'Barbier', 2, 0),
  p('u4', 'Melanie', 'Bernard', 2, 1),
];

describe('teamRows', () => {
  it('sépare les deux équipes triées par slot', () => {
    const [t1, t2] = teamRows(roster);
    expect(t1.map((x) => x.userId)).toEqual(['u1', 'u2']);
    expect(t2.map((x) => x.userId)).toEqual(['u3', 'u4']);
  });

  it('verse un team inattendu dans la rangée la moins remplie', () => {
    const odd = [p('a', 'A', 'A', 3 as 1, 0), p('b', 'B', 'B', 3 as 1, 0)];
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
      p('u1', 'Jean', 'Dupont', 1, 0),
      p('u2', 'Marie', 'Leroy', 1, 1),
      p('u3', 'Jean', 'Martin', 2, 0),
      p('u4', 'Paul', 'Roux', 2, 1),
    ];
    const [t1, t2] = teamRows(dup);
    expect(teamLabel(t1, dup)).toBe('Jean D. & Marie');
    expect(teamLabel(t2, dup)).toBe('Jean M. & Paul');
  });
});
```

- [ ] **Step 2: Lancer le test → échec attendu**

Run: `node node_modules/jest/bin/jest.js __tests__/resultsToRecord.test.ts --no-coverage`
Expected: FAIL — `teamLabel` n'est pas exporté (`teamLabel is not a function`).

- [ ] **Step 3: Implémenter**

Dans `frontend/lib/resultsToRecord.ts` : **supprime** la fonction `abbrevName` (lignes 5–12) et **ajoute** `teamLabel` sous `teamRows`. Le fichier complet devient :

```ts
// Helpers purs de la carte « Résultat à saisir » (components/match/ResultsToRecord.tsx).
// Aucune dépendance React : testables directement.
import type { MatchToRecordPlayer } from '@/lib/api';

/**
 * Sépare les joueurs en deux rangées d'équipe ordonnées par `slot` (gauche puis droite).
 * Le backend garantit un 2v2 avec team/slot concrets (effectiveTeams) ; par défense en
 * profondeur, un `team` inattendu est versé dans la rangée la moins remplie. Un `team`
 * explicite est toujours respecté — un rendu déséquilibré visible vaut mieux qu'un 2v2
 * plausible obtenu en déplaçant silencieusement un joueur valide.
 */
export function teamRows(players: MatchToRecordPlayer[]): [MatchToRecordPlayer[], MatchToRecordPlayer[]] {
  const team1: MatchToRecordPlayer[] = [];
  const team2: MatchToRecordPlayer[] = [];
  for (const p of players) {
    if (p.team === 1) team1.push(p);
    else if (p.team === 2) team2.push(p);
    else (team1.length <= team2.length ? team1 : team2).push(p);
  }
  const bySlot = (a: MatchToRecordPlayer, b: MatchToRecordPlayer) => a.slot - b.slot;
  return [team1.sort(bySlot), team2.sort(bySlot)];
}

/**
 * Libellé d'une équipe en prénoms : « Lucas & Jean ». En cas de prénom en double DANS LE
 * MATCH (`allPlayers` = les 4 joueurs), on ajoute l'initiale du nom pour lever l'ambiguïté :
 * « Jean D. & Jean M. ». Un joueur sans nom garde son prénom seul.
 */
export function teamLabel(team: MatchToRecordPlayer[], allPlayers: MatchToRecordPlayer[]): string {
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
```

- [ ] **Step 4: Lancer le test → succès**

Run: `node node_modules/jest/bin/jest.js __tests__/resultsToRecord.test.ts --no-coverage`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/resultsToRecord.ts frontend/__tests__/resultsToRecord.test.ts
git commit -m "refactor(matchs): teamLabel (prenoms + desambiguisation), retire abbrevName"
```

---

## Task 2: Carte « Résultats à saisir » compacte

**Files:**
- Modify: `frontend/components/match/ResultsToRecord.tsx` (réécriture complète)
- Test: `frontend/__tests__/ResultsToRecord.test.tsx` (réécriture complète)

- [ ] **Step 1: Réécrire le test**

Remplace **tout** le contenu de `frontend/__tests__/ResultsToRecord.test.tsx` par :

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { ResultsToRecord } from '@/components/match/ResultsToRecord';

// Modale stubée : découple la carte du pavé de saisie (testé séparément).
jest.mock('@/components/match/MatchResultModal', () => ({
  __esModule: true,
  MatchResultModal: ({ onSaved }: { onSaved: () => void }) => (
    <button onClick={onSaved}>stub-save</button>
  ),
}));

jest.mock('@/lib/api', () => ({
  __esModule: true,
  api: { getMatchesToRecord: jest.fn() },
  assetUrl: (u: string) => u,
}));
import { api } from '@/lib/api';

const row = {
  reservationId: 'r1', startTime: '2026-06-10T18:00:00Z', endTime: '2026-06-10T19:30:00Z',
  club: { slug: 'arena', name: 'Padel Arena', timezone: 'Europe/Paris' },
  resourceName: 'Court 1', sport: { key: 'padel', name: 'Padel' },
  players: [
    { userId: 'u1', isOrganizer: true, firstName: 'Lucas', lastName: 'Moreau', avatarUrl: null, team: 1, slot: 0 },
    { userId: 'u2', isOrganizer: false, firstName: 'Jean', lastName: 'Dupont', avatarUrl: null, team: 1, slot: 1 },
    { userId: 'u3', isOrganizer: false, firstName: 'Celine', lastName: 'Barbier', avatarUrl: null, team: 2, slot: 0 },
    { userId: 'u4', isOrganizer: false, firstName: 'Melanie', lastName: 'Bernard', avatarUrl: null, team: 2, slot: 1 },
  ],
};

const wrap = (props = {}) => render(<ThemeProvider><ResultsToRecord token="t" {...props} /></ThemeProvider>);

beforeEach(() => (api.getMatchesToRecord as jest.Mock).mockReset());

it('n\'affiche rien quand la liste est vide', async () => {
  (api.getMatchesToRecord as jest.Mock).mockResolvedValue([]);
  const { container } = wrap();
  await waitFor(() => expect(api.getMatchesToRecord).toHaveBeenCalled());
  expect(container.textContent).not.toContain('Résultat');
});

it('regroupe les matchs dans une seule carte (en-tête compté) et filtre par club', async () => {
  (api.getMatchesToRecord as jest.Mock).mockResolvedValue([
    row,
    { ...row, reservationId: 'r2', resourceName: 'Court 6' },
    { ...row, reservationId: 'r3', club: { ...row.club, slug: 'autre' } },
  ]);
  wrap({ clubSlug: 'arena' });
  await waitFor(() => expect(screen.getByText('Résultats à saisir · 2')).toBeInTheDocument());
  expect(screen.getByText(/Court 1 ·/)).toBeInTheDocument();
  expect(screen.getByText(/Court 6 ·/)).toBeInTheDocument();
  expect(screen.getAllByText('Saisir')).toHaveLength(2);
});

it('titre singulier quand un seul match', async () => {
  (api.getMatchesToRecord as jest.Mock).mockResolvedValue([row]);
  wrap();
  await waitFor(() => expect(screen.getByText('Résultat à saisir')).toBeInTheDocument());
});

it('affiche les deux équipes en prénoms avec le séparateur vs', async () => {
  (api.getMatchesToRecord as jest.Mock).mockResolvedValue([row]);
  wrap();
  await waitFor(() => expect(screen.getByText('Lucas & Jean')).toBeInTheDocument());
  expect(screen.getByText('Celine & Melanie')).toBeInTheDocument();
  expect(screen.getByText('vs')).toBeInTheDocument();
});

it('pas de chip Compétitive sur la carte (défaut), chip Amicale si competitive=false', async () => {
  (api.getMatchesToRecord as jest.Mock).mockResolvedValue([row, { ...row, reservationId: 'r2', competitive: false }]);
  wrap();
  await waitFor(() => expect(screen.getByText('Amicale')).toBeInTheDocument());
  expect(screen.queryByText('Compétitive')).not.toBeInTheDocument();
});

it('ouvre la modale au clic sur Saisir et se rafraîchit après enregistrement', async () => {
  (api.getMatchesToRecord as jest.Mock)
    .mockResolvedValueOnce([row])
    .mockResolvedValueOnce([]);
  const onRecorded = jest.fn();
  wrap({ onRecorded });
  await waitFor(() => expect(screen.getByText('Saisir')).toBeInTheDocument());
  fireEvent.click(screen.getByText('Saisir'));
  fireEvent.click(screen.getByText('stub-save'));
  await waitFor(() => expect(onRecorded).toHaveBeenCalled());
  expect(api.getMatchesToRecord).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Lancer le test → échec attendu**

Run: `node node_modules/jest/bin/jest.js __tests__/ResultsToRecord.test.tsx --no-coverage`
Expected: FAIL — la carte rend encore l'ancienne structure (« Résultats à saisir · 2 » absent, chip Compétitive présent).

- [ ] **Step 3: Réécrire le composant**

Remplace **tout** le contenu de `frontend/components/match/ResultsToRecord.tsx` par :

```tsx
'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, MatchToRecord } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { colorForSeed } from '@/lib/playerColors';
import { Avatar } from '@/components/ui/Avatar';
import { Chip } from '@/components/ui/atoms';
import { MatchResultModal } from '@/components/match/MatchResultModal';
import { teamRows, teamLabel } from '@/lib/resultsToRecord';

function fmtWhen(iso: string, tz: string): string {
  const date = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).format(new Date(iso));
  const hour = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso)).replace(':', 'h');
  return `${date} · ${hour}`;
}

// Prompt personnel « Résultats à saisir » : UNE carte, une ligne fine par match padel joué sans
// résultat. Le clic « Saisir » ouvre la feuille de saisie avec les équipes pré-remplies.
// Rendu null si rien à saisir. `clubSlug` restreint au club courant ; `onRecorded` rafraîchit le parent.
export function ResultsToRecord({ token, clubSlug, onRecorded }: {
  token: string | null;
  clubSlug?: string;
  onRecorded?: () => void;
}) {
  const { th } = useTheme();
  const [rows, setRows] = useState<MatchToRecord[]>([]);
  const [recordingFor, setRecordingFor] = useState<MatchToRecord | null>(null);

  const reload = useCallback(() => {
    if (!token) { setRows([]); return; }
    api.getMatchesToRecord(token)
      .then((r) => setRows(clubSlug ? r.filter((m) => m.club.slug === clubSlug) : r))
      .catch(() => setRows([]));
  }, [token, clubSlug]);

  useEffect(() => { reload(); }, [reload]);

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
            {rows.length > 1 ? `Résultats à saisir · ${rows.length}` : 'Résultat à saisir'}
          </span>
        </div>

        {rows.map((m) => {
          const [team1, team2] = teamRows(m.players);
          const avatars = [...team1, ...team2];
          return (
            <div key={m.reservationId} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '11px 18px', borderTop: `1px solid ${th.line}`,
            }}>
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
                  {teamLabel(team1, m.players)}
                  <span style={{ color: th.textFaint, fontWeight: 600, fontSize: 11.5, margin: '0 6px' }}>vs</span>
                  {teamLabel(team2, m.players)}
                </div>
                <div style={{
                  fontFamily: th.fontMono, fontSize: 11, color: th.textMute, marginTop: 2,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {m.resourceName} · {fmtWhen(m.startTime, m.club.timezone)}
                </div>
              </div>

              {m.competitive === false && <Chip tone="line">Amicale</Chip>}

              <button type="button" onClick={() => setRecordingFor(m)} style={{
                flexShrink: 0, border: 'none', cursor: 'pointer', borderRadius: 99,
                padding: '8px 16px', background: th.accent, color: th.onAccent,
                fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700,
              }}>
                Saisir
              </button>
            </div>
          );
        })}
      </div>

      {recordingFor && token && (
        <MatchResultModal
          reservationId={recordingFor.reservationId}
          players={recordingFor.players.map((p) => ({ userId: p.userId, firstName: p.firstName, lastName: p.lastName, avatarUrl: p.avatarUrl }))}
          token={token}
          context={{ whenIso: recordingFor.startTime, tz: recordingFor.club.timezone, courtName: recordingFor.resourceName }}
          initialTeams={Object.fromEntries(recordingFor.players.map((p) => [p.userId, p.team]))}
          locked={recordingFor.visibility === 'PUBLIC'}
          competitive={recordingFor.competitive ?? true}
          onClose={() => setRecordingFor(null)}
          onSaved={() => { setRecordingFor(null); reload(); onRecorded?.(); }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Lancer le test → succès**

Run: `node node_modules/jest/bin/jest.js __tests__/ResultsToRecord.test.tsx --no-coverage`
Expected: PASS (6 tests).

- [ ] **Step 5: Type-check ciblé**

Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json 2>&1 | grep -E "ResultsToRecord|resultsToRecord"`
Expected: aucune ligne (pas d'erreur sur ces fichiers).

- [ ] **Step 6: Commit**

```bash
git add frontend/components/match/ResultsToRecord.tsx frontend/__tests__/ResultsToRecord.test.tsx
git commit -m "feat(matchs): carte Resultats a saisir compacte (une carte, une ligne par match)"
```

---

## Task 3: Modèle pur `scoreGrid` (curseur, auto-avance, ⌫)

**Files:**
- Create: `frontend/lib/scoreGrid.ts`
- Test: `frontend/__tests__/scoreGrid.test.ts`

- [ ] **Step 1: Écrire le test**

Crée `frontend/__tests__/scoreGrid.test.ts` :

```ts
import { emptyGrid, applyDigit, backspace, gridToSets, setWinner, nextCursor } from '@/lib/scoreGrid';

// Enchaîne des chiffres depuis le curseur 0 et renvoie l'état final.
function typeAll(digits: number[]) {
  let grid = emptyGrid();
  let cursor = 0;
  for (const d of digits) { const r = applyDigit(grid, cursor, d); grid = r.grid; cursor = r.cursor; }
  return { grid, cursor };
}

it('applyDigit remplit la case active et avance le curseur', () => {
  const r = applyDigit(emptyGrid(), 0, 6);
  expect(r.grid[0]).toBe(6);
  expect(r.cursor).toBe(1);
});

it('gridToSets ne renvoie que les sets aux deux cases remplies', () => {
  let g = applyDigit(emptyGrid(), 0, 6).grid; // s0 Éq.1 = 6, Éq.2 vide
  expect(gridToSets(g)).toEqual([]);
  g = applyDigit(g, 1, 4).grid;
  expect(gridToSets(g)).toEqual([[6, 4]]);
});

it('un score 6-4 6-3 remplit deux sets et saute le set 3 (2-0)', () => {
  const { grid, cursor } = typeAll([6, 4, 6, 3]);
  expect(gridToSets(grid)).toEqual([[6, 4], [6, 3]]);
  expect(cursor).toBe(-1);
});

it('à 1-1 le curseur avance vers le set 3', () => {
  const { cursor } = typeAll([6, 4, 4, 6]);
  expect(cursor).toBe(4); // set 3, Éq.1
});

it('setWinner donne le vainqueur d\'un set complet', () => {
  const { grid } = typeAll([6, 4]);
  expect(setWinner(grid, 0)).toBe(1);
  expect(setWinner(grid, 1)).toBeNull();
});

it('nextCursor plafonne à -1 en fin de grille', () => {
  const g = emptyGrid();
  expect(nextCursor(g, 5)).toBe(-1);
});

it('backspace efface la case active si elle est remplie', () => {
  const r = backspace([6, null, null, null, null, null], 0);
  expect(r.grid[0]).toBeNull();
  expect(r.cursor).toBe(0);
});

it('backspace recule et efface la dernière case remplie si la case active est vide', () => {
  const { grid, cursor } = typeAll([6, 4]); // curseur 2 (vide)
  const r = backspace(grid, cursor);
  expect(r.grid[1]).toBeNull(); // s0 Éq.2 effacée
  expect(r.cursor).toBe(1);
});
```

- [ ] **Step 2: Lancer le test → échec attendu**

Run: `node node_modules/jest/bin/jest.js __tests__/scoreGrid.test.ts --no-coverage`
Expected: FAIL — `Cannot find module '@/lib/scoreGrid'`.

- [ ] **Step 3: Implémenter**

Crée `frontend/lib/scoreGrid.ts` :

```ts
// Modèle pur de la grille de score de la feuille de saisie (MatchResultModal).
// La grille = 6 cases : index = set*2 + team (team 0 = Éq.1, team 1 = Éq.2). Une case null
// est « pas encore saisie » (à distinguer d'un 0 réel). Aucune dépendance React.
import type { SetScore } from './match';

export type Cell = number | null;
export type Grid = [Cell, Cell, Cell, Cell, Cell, Cell];

export function emptyGrid(): Grid {
  return [null, null, null, null, null, null];
}

/** Vainqueur d'un set complet (deux cases remplies, distinctes), sinon null. */
export function setWinner(grid: Grid, setIndex: number): 1 | 2 | null {
  const a = grid[setIndex * 2];
  const b = grid[setIndex * 2 + 1];
  if (a == null || b == null || a === b) return null;
  return a > b ? 1 : 2;
}

/** Sets complets (deux cases remplies) → SetScore[] pour validation / vainqueur / payload. */
export function gridToSets(grid: Grid): SetScore[] {
  const out: SetScore[] = [];
  for (let s = 0; s < 3; s++) {
    const a = grid[s * 2];
    const b = grid[s * 2 + 1];
    if (a != null && b != null) out.push([a, b]);
  }
  return out;
}

/**
 * Prochaine case à éditer après `from`. -1 = plus de case (fin de grille, ou match déjà
 * décidé 2-0 après le 2e set → le 3e set reste facultatif et vide).
 */
export function nextCursor(grid: Grid, from: number): number {
  if (from === 3) {
    const w1 = setWinner(grid, 0);
    const w2 = setWinner(grid, 1);
    if (w1 && w1 === w2) return -1;
  }
  return from >= 5 ? -1 : from + 1;
}

/** Écrit `digit` dans la case active et renvoie le curseur avancé. No-op si curseur hors grille. */
export function applyDigit(grid: Grid, cursor: number, digit: number): { grid: Grid; cursor: number } {
  if (cursor < 0 || cursor > 5) return { grid, cursor };
  const next = [...grid] as Grid;
  next[cursor] = digit;
  return { grid: next, cursor: nextCursor(next, cursor) };
}

/**
 * ⌫ : efface la case active si elle porte une valeur ; sinon recule jusqu'à la dernière
 * case remplie et l'efface. Le curseur suit la case effacée.
 */
export function backspace(grid: Grid, cursor: number): { grid: Grid; cursor: number } {
  const next = [...grid] as Grid;
  if (cursor >= 0 && cursor <= 5 && next[cursor] != null) {
    next[cursor] = null;
    return { grid: next, cursor };
  }
  const start = cursor < 0 ? 5 : cursor - 1;
  for (let i = start; i >= 0; i--) {
    if (next[i] != null) { next[i] = null; return { grid: next, cursor: i }; }
  }
  return { grid: next, cursor: cursor < 0 ? 0 : cursor };
}
```

- [ ] **Step 4: Lancer le test → succès**

Run: `node node_modules/jest/bin/jest.js __tests__/scoreGrid.test.ts --no-coverage`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/scoreGrid.ts frontend/__tests__/scoreGrid.test.ts
git commit -m "feat(matchs): modele pur scoreGrid (curseur, auto-avance, backspace)"
```

---

## Task 4: Feuille de saisie « tableau de score + pavé »

**Files:**
- Modify: `frontend/components/match/MatchResultModal.tsx` (réécriture complète)
- Test: `frontend/__tests__/MatchResultModal.test.tsx` (réécriture complète)

- [ ] **Step 1: Réécrire le test**

Remplace **tout** le contenu de `frontend/__tests__/MatchResultModal.test.tsx` par :

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
const fullTeams = { u1: 1, u2: 1, u3: 2, u4: 2 } as Record<string, 1 | 2>;

const renderModal = (extra: Record<string, unknown> = {}) =>
  render(<ThemeProvider><MatchResultModal reservationId="r1" players={players} token="t" onClose={() => {}} onSaved={() => {}} {...extra} /></ThemeProvider>);

const type = (digits: number[]) => digits.forEach((d) => fireEvent.click(screen.getByTestId(`key-${d}`)));

beforeEach(() => (api.recordMatchResult as jest.Mock).mockClear());

it('saisit un 6-4 6-3 au pavé et enregistre le bon payload', async () => {
  const onSaved = jest.fn();
  renderModal({ initialTeams: fullTeams, onSaved });
  type([6, 4, 6, 3]);
  fireEvent.click(screen.getByRole('button', { name: /Enregistrer/ }));
  await waitFor(() => expect(api.recordMatchResult).toHaveBeenCalled());
  const call = (api.recordMatchResult as jest.Mock).mock.calls.at(-1)!;
  expect(call[0]).toBe('r1');
  expect(call[1].teams[1]).toEqual(expect.arrayContaining(['u1', 'u2']));
  expect(call[1].teams[2]).toEqual(expect.arrayContaining(['u3', 'u4']));
  expect(call[1].sets).toEqual([[6, 4], [6, 3]]);
  expect(onSaved).toHaveBeenCalled();
});

it('Enregistrer désactivé tant que le score ne désigne pas un vainqueur', () => {
  renderModal({ initialTeams: fullTeams });
  expect(screen.getByRole('button', { name: /Enregistrer/ })).toBeDisabled();
  type([6, 4]); // un set gagné par l'Éq.1
  expect(screen.getByRole('button', { name: /Enregistrer/ })).toBeEnabled();
});

it('taper une case la resélectionne pour corriger', () => {
  renderModal({ initialTeams: fullTeams });
  type([6, 4]);
  fireEvent.click(screen.getByTestId('cell-0-1'));
  type([7]);
  expect(screen.getByTestId('cell-0-1')).toHaveTextContent('7');
});

it('⌫ efface la dernière case remplie', () => {
  renderModal({ initialTeams: fullTeams });
  type([6, 4]); // curseur sur s1 Éq.1 (vide)
  fireEvent.click(screen.getByTestId('key-back'));
  expect(screen.getByTestId('cell-0-2')).toHaveTextContent('');
});

it('le CTA porte le résumé du vainqueur', () => {
  renderModal({ initialTeams: fullTeams });
  type([6, 4, 6, 3]);
  expect(screen.getByRole('button', { name: /Victoire Alice/ })).toBeInTheDocument();
});

it('affiche la ligne de contexte quand context est fourni', () => {
  renderModal({ initialTeams: fullTeams, context: { whenIso: '2026-06-20T16:30:00Z', tz: 'Europe/Paris', courtName: 'Court 2' } });
  expect(screen.getByText(/Court 2/)).toBeInTheDocument();
});

describe('affectation des équipes', () => {
  it('mode résumé quand initialTeams complet, « Modifier les équipes » révèle l\'affectation', () => {
    renderModal({ initialTeams: fullTeams });
    expect(screen.getByText('Modifier les équipes')).toBeInTheDocument();
    expect(screen.queryByTestId('team1-u1')).toBeNull();
    fireEvent.click(screen.getByText('Modifier les équipes'));
    expect(screen.getByTestId('team1-u1')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('team2-u3')).toHaveAttribute('data-active', 'true');
  });

  it('initialTeams incomplet : affectation d\'abord, pavé après « Continuer »', () => {
    renderModal({ initialTeams: { u1: 1, u2: 1 } });
    expect(screen.getByTestId('team1-u1')).toBeInTheDocument();
    expect(screen.queryByTestId('key-6')).toBeNull();
    fireEvent.click(screen.getByTestId('team2-u3'));
    fireEvent.click(screen.getByTestId('team2-u4'));
    fireEvent.click(screen.getByRole('button', { name: /Continuer/ }));
    expect(screen.getByTestId('key-6')).toBeInTheDocument();
  });
});

describe('Amicale / Compétitive', () => {
  it('résa privée : segmented Compétitive par défaut, envoie competitive=false si Amicale', async () => {
    renderModal({ initialTeams: fullTeams });
    fireEvent.click(screen.getByRole('button', { name: /Amicale/ }));
    type([6, 4]);
    fireEvent.click(screen.getByRole('button', { name: /Enregistrer/ }));
    await waitFor(() => expect(api.recordMatchResult).toHaveBeenCalled());
    expect((api.recordMatchResult as jest.Mock).mock.calls.at(-1)![1].competitive).toBe(false);
  });

  it('partie ouverte (locked) : badge statique, pas de bouton de bascule', () => {
    renderModal({ initialTeams: fullTeams, locked: true, competitive: false });
    expect(screen.getByText(/Partie amicale/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Compétitive/ })).toBeNull();
  });
});
```

- [ ] **Step 2: Lancer le test → échec attendu**

Run: `node node_modules/jest/bin/jest.js __tests__/MatchResultModal.test.tsx --no-coverage`
Expected: FAIL — les testids `key-6` / `cell-0-1` n'existent pas (ancienne modale à steppers).

- [ ] **Step 3: Réécrire le composant**

Remplace **tout** le contenu de `frontend/components/match/MatchResultModal.tsx` par :

```tsx
'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { validSets, winnerFromSets } from '@/lib/match';
import { emptyGrid, applyDigit, backspace as gridBackspace, gridToSets, setWinner, type Grid } from '@/lib/scoreGrid';
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
  initialTeams?: Record<string, 1 | 2>;
  competitive?: boolean; // valeur initiale (privé) OU type déclaré (partie ouverte, verrouillé)
  locked?: boolean;      // true = partie ouverte : type hérité de la résa, non modifiable ici
}

const TEAM_COLORS: Record<1 | 2, string> = { 1: ACCENTS.blue, 2: ACCENTS.coral };

function fmtContext(ctx: MatchContext): string {
  const d = new Date(ctx.whenIso);
  const date = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: ctx.tz }).format(d);
  const hour = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: ctx.tz }).format(d).replace(':', 'h');
  return `${date} · ${hour} · ${ctx.courtName}`;
}

export function MatchResultModal({ reservationId, players, token, onClose, onSaved, context, initialTeams, competitive, locked }: Props) {
  const { th } = useTheme();

  // Équipes pré-remplies complètes (4 joueurs, 2/2) → on démarre au tableau de score ; sinon affectation.
  const preFilled2v2 = (() => {
    if (!initialTeams) return false;
    const assigned = players.filter((p) => initialTeams[p.userId] === 1 || initialTeams[p.userId] === 2);
    if (assigned.length !== players.length || players.length !== 4) return false;
    return assigned.filter((p) => initialTeams[p.userId] === 1).length === 2
      && assigned.filter((p) => initialTeams[p.userId] === 2).length === 2;
  })();

  const [team, setTeam] = useState<Record<string, 1 | 2 | undefined>>(() => ({ ...(initialTeams ?? {}) }));
  const [competitiveState, setCompetitiveState] = useState(competitive ?? true);
  const [phase, setPhase] = useState<'assign' | 'score'>(preFilled2v2 ? 'score' : 'assign');
  const [grid, setGrid] = useState<Grid>(emptyGrid);
  const [cursor, setCursor] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showAssignment = phase === 'assign';

  const t1 = players.filter((p) => team[p.userId] === 1).map((p) => p.userId);
  const t2 = players.filter((p) => team[p.userId] === 2).map((p) => p.userId);
  const compositionOk = t1.length === 2 && t2.length === 2;

  const sets = gridToSets(grid);
  const setsOk = validSets(sets);
  const wins: [number, number] = sets.reduce<[number, number]>(
    (acc, [a, b]) => { if (a > b) acc[0]++; else if (b > a) acc[1]++; return acc; }, [0, 0]);
  const winner = compositionOk && setsOk && wins[0] !== wins[1] ? winnerFromSets(sets) : null;
  const canSave = compositionOk && setsOk && winner != null && !busy;

  const assign = (userId: string, t: 1 | 2) =>
    setTeam((prev) => ({ ...prev, [userId]: prev[userId] === t ? undefined : t }));
  const teamFull = (t: 1 | 2, userId: string) => (t === 1 ? t1 : t2).length >= 2 && team[userId] !== t;
  const teamNames = (n: 1 | 2) => players.filter((p) => team[p.userId] === n);

  const pressDigit = (d: number) => { const r = applyDigit(grid, cursor, d); setGrid(r.grid); setCursor(r.cursor); };
  const pressBack = () => { const r = gridBackspace(grid, cursor); setGrid(r.grid); setCursor(r.cursor); };

  const save = async () => {
    setBusy(true); setError(null);
    try {
      await api.recordMatchResult(reservationId, { teams: { 1: t1, 2: t2 }, sets, competitive: competitiveState }, token);
      onSaved();
    } catch {
      setError('Échec de l’enregistrement.');
    } finally { setBusy(false); }
  };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="match-result-title" className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" style={{ background: 'rgba(0,0,0,0.45)' }}>
      <div className="w-full max-w-md rounded-t-2xl p-4 sm:rounded-2xl" style={{ background: th.surface, color: th.text, fontFamily: th.fontUI, maxHeight: '92vh', overflowY: 'auto' }}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 id="match-result-title" className="text-lg font-semibold">Saisir le résultat</h2>
            {context && <p className="mt-0.5 text-sm" style={{ color: th.textMute }}>{fmtContext(context)}</p>}
          </div>
          {locked ? (
            <span style={{
              flexShrink: 0, fontFamily: th.fontUI, fontSize: 12, fontWeight: 700, borderRadius: 99, padding: '5px 10px',
              background: competitiveState ? `${th.accent}22` : 'transparent', color: competitiveState ? th.accent : th.textMute,
              border: competitiveState ? 'none' : `1px solid ${th.line}`,
            }}>
              {competitiveState ? 'Compétitive' : 'Amicale'}
            </span>
          ) : (
            <span style={{ display: 'inline-flex', flexShrink: 0, borderRadius: 99, overflow: 'hidden', border: `1px solid ${th.line}` }}>
              {([['competitive', 'Compétitive'], ['friendly', 'Amicale']] as const).map(([key, label]) => {
                const active = (key === 'competitive') === competitiveState;
                return (
                  <button key={key} type="button" onClick={() => setCompetitiveState(key === 'competitive')} disabled={busy}
                    style={{
                      cursor: 'pointer', border: 'none', padding: '5px 12px', fontFamily: th.fontUI, fontSize: 12, fontWeight: 700,
                      background: active ? th.accent : 'transparent', color: active ? th.onAccent : th.textMute,
                    }}>
                    {label}
                  </button>
                );
              })}
            </span>
          )}
        </div>

        <p className="mb-3 text-xs" style={{ color: th.textFaint }}>
          {locked
            ? (competitiveState ? 'Partie compétitive — le résultat compte pour le niveau.' : 'Partie amicale — le niveau ne bouge pas.')
            : (competitiveState ? 'Compte pour le niveau.' : 'Le niveau ne bouge pas.')}
        </p>

        {showAssignment ? (
          <>
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
                        <button key={t} type="button" data-testid={`team${t}-${p.userId}`} data-active={active ? 'true' : 'false'} aria-label={`Équipe ${t}`} disabled={teamFull(t, p.userId)}
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

            {!compositionOk && <p className="mb-3 text-xs" style={{ color: th.textMute }}>Affecte 2 joueurs par équipe.</p>}

            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm" style={{ color: th.textMute }}>Annuler</button>
              <button type="button" disabled={!compositionOk} onClick={() => setPhase('score')}
                className="rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-40"
                style={{ background: th.accent, color: th.onAccent }}>
                Continuer
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mb-3 flex flex-col gap-2">
              {([1, 2] as const).map((n) => {
                const names = teamNames(n).map((p) => `${p.firstName} ${p.lastName}`).join(' & ');
                return (
                  <div key={n} className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: th.surface2 }}>
                    <span style={{ width: 9, height: 9, borderRadius: '50%', background: TEAM_COLORS[n], flexShrink: 0 }} />
                    <span className="text-xs font-semibold" style={{ color: th.textMute }}>Éq. {n}</span>
                    <span className="ml-1 truncate text-sm font-medium">{names}</span>
                  </div>
                );
              })}
              <button type="button" onClick={() => setPhase('assign')} className="self-start text-sm underline" style={{ color: th.textMute }}>
                Modifier les équipes
              </button>
            </div>

            <div className="mb-1 flex items-center justify-end gap-2 pr-1">
              {['S1', 'S2', 'S3'].map((s) => (
                <span key={s} style={{ width: 34, textAlign: 'center', fontSize: 9, letterSpacing: '2px', fontWeight: 700, color: th.textFaint }}>{s}</span>
              ))}
            </div>

            {([1, 2] as const).map((n) => (
              <div key={n} className="flex items-center gap-2 py-1">
                <span className="flex-1 truncate text-sm font-semibold">
                  {teamNames(n).map((p) => p.firstName).join(' & ')}
                </span>
                <div className="flex gap-2">
                  {[0, 1, 2].map((s) => {
                    const idx = s * 2 + (n - 1);
                    const val = grid[idx];
                    const w = setWinner(grid, s);
                    const isActive = cursor === idx;
                    const isWinner = w === n;
                    return (
                      <button key={s} type="button" data-testid={`cell-${s}-${n}`} onClick={() => setCursor(idx)}
                        style={{
                          width: 34, height: 40, borderRadius: 9, flexShrink: 0, cursor: 'pointer',
                          fontFamily: th.fontUI, fontWeight: 800, fontSize: 16,
                          color: isWinner ? inkOn(th.accent) : th.text,
                          background: isWinner ? th.accent : (val != null ? th.surface2 : 'transparent'),
                          border: isActive ? `2px solid ${th.accent}` : (val != null ? `1.5px solid ${th.line}` : `1.5px dashed ${s === 2 ? th.line : th.lineStrong}`),
                        }}>
                        {val ?? ''}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 6, marginTop: 14, marginBottom: 4 }}>
              {[0, 1, 2, 3, 4, 5, 6, 7].map((d) => (
                <button key={d} type="button" data-testid={`key-${d}`} onClick={() => pressDigit(d)}
                  style={{ width: 34, height: 38, borderRadius: 9, border: 'none', cursor: 'pointer', background: th.surface2, color: th.text, fontFamily: th.fontUI, fontWeight: 700, fontSize: 15 }}>
                  {d}
                </button>
              ))}
              <button type="button" data-testid="key-back" aria-label="Effacer" onClick={pressBack}
                style={{ width: 44, height: 38, borderRadius: 9, border: 'none', cursor: 'pointer', background: th.surface2, color: th.textMute, fontFamily: th.fontUI, fontWeight: 700, fontSize: 15 }}>
                ⌫
              </button>
            </div>

            {error && <p className="mb-2 mt-2 text-sm" style={{ color: ACCENTS.coral }}>{error}</p>}

            <div className="mt-3 flex items-center gap-2">
              <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm" style={{ color: th.textMute }}>Annuler</button>
              <button type="button" disabled={!canSave} onClick={save}
                className="flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-40"
                style={{ background: th.accent, color: th.onAccent }}>
                {winner
                  ? `Enregistrer — Victoire ${teamNames(winner).map((p) => p.firstName).join(' & ')} ${wins[winner - 1]}–${wins[winner === 1 ? 1 : 0]}`
                  : 'Enregistrer'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Lancer le test → succès**

Run: `node node_modules/jest/bin/jest.js __tests__/MatchResultModal.test.tsx --no-coverage`
Expected: PASS (10 tests).

- [ ] **Step 5: Type-check ciblé**

Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json 2>&1 | grep -E "MatchResultModal|scoreGrid"`
Expected: aucune ligne.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/match/MatchResultModal.tsx frontend/__tests__/MatchResultModal.test.tsx
git commit -m "feat(matchs): feuille de saisie tableau de score + pave 0-7"
```

---

## Task 5: Vérification globale + contrôle visuel

**Files:** aucun (validation).

- [ ] **Step 1: Suites impactées vertes ensemble**

Run: `node node_modules/jest/bin/jest.js __tests__/resultsToRecord.test.ts __tests__/ResultsToRecord.test.tsx __tests__/scoreGrid.test.ts __tests__/MatchResultModal.test.tsx --no-coverage`
Expected: PASS (4 suites, 29 tests).

- [ ] **Step 2: Suites consommatrices non régressées**

Les consommateurs montent `ResultsToRecord` / la modale sans piloter leurs internes ; vérifie qu'ils passent toujours.
Run: `node node_modules/jest/bin/jest.js __tests__/OpenMatches.test.tsx --no-coverage`
Expected: PASS (si cette suite mocke `getMatchesToRecord`, rien à changer ; sinon elle ne dépend pas de la structure interne de la carte).

- [ ] **Step 3: Type-check ciblé global**

Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json 2>&1 | grep -E "match/ResultsToRecord|match/MatchResultModal|lib/scoreGrid|lib/resultsToRecord"`
Expected: aucune ligne.

- [ ] **Step 4: Contrôle visuel (CDP)**

Démarre la stack (`start.ps1` si besoin), connecte-toi (`test@palova.fr` / `password123`) sur `padel-arena-paris.localhost:3000`. La carte « Résultats à saisir » apparaît en tête du Club-house / `/parties` / `/me/matches` quand des matchs padel passés n'ont pas de résultat (les données seedées en contiennent — cf. capture d'Eric).

Vérifie **en clair et en sombre, desktop 1280 + mobile 390** :
- Carte unique, une ligne par match, aucun débordement horizontal (la ligne de noms tronque proprement).
- Chip « Amicale » présent uniquement sur un match amical ; jamais « Compétitive » sur la carte.
- Clic « Saisir » → feuille : pavé 0–7, l'auto-avance enchaîne les cases, un set complet colore la case du gagnant, le CTA affiche « Victoire … 2–0 », « Annuler » ferme sans enregistrer.
- Type Compétitive/Amicale bascule (résa privée) ou badge figé (partie ouverte).

- [ ] **Step 5: Mettre à jour CLAUDE.md**

Ajoute une entrée d'évolution sous la section matchs de `CLAUDE.md` résumant : carte « Résultats à saisir » compacte (une carte, une ligne/match) + feuille de saisie tableau de score + pavé 0–7 (`lib/scoreGrid.ts`), 100 % frontend, tests `resultsToRecord`/`ResultsToRecord`/`scoreGrid`/`MatchResultModal`.

```bash
git add CLAUDE.md
git commit -m "docs(matchs): note evolution resultats a saisir compacts"
```

---

## Self-Review (fait à l'écriture)

- **Couverture spec** : carte une-ligne (Task 2) ✓ ; chip Amicale seulement (Task 2) ✓ ; `teamLabel` prénoms + désambiguïsation (Task 1) ✓ ; feuille tableau+pavé, auto-avance, skip S3 à 2-0, correction, ⌫ (Task 3+4) ✓ ; type Compétitive/Amicale figé si `locked` (Task 4) ✓ ; CTA résumé (Task 4) ✓ ; phase d'affectation si équipes incomplètes (Task 4) ✓ ; contrat de props + payload inchangés (Task 4, `api.recordMatchResult` identique) ✓ ; `validSets`/`winnerFromSets` inchangés (importés tels quels) ✓.
- **Placeholders** : aucun — tout le code des composants et helpers est complet.
- **Cohérence des types** : `Grid` = `[Cell×6]`, `applyDigit`/`backspace` renvoient `{ grid, cursor }`, `gridToSets` → `SetScore[]`, `setWinner` → `1|2|null` — mêmes signatures entre `scoreGrid.ts` (Task 3), ses tests, et la modale (Task 4). `teamLabel(team, allPlayers)` identique entre helper (Task 1) et carte (Task 2). `MatchToRecordPlayer`/`MatchToRecord` importés depuis `@/lib/api` (existants).
- **Écart assumé vs spec** : la spec dit « l'état reste des `SetScore[]` » ; pour distinguer « case vide » de « 0 », l'état React est la `Grid` (Cell = number|null) et `SetScore[]` en est **dérivé** (`gridToSets`) pour validation et payload — ce qui satisfait « un set existe dès qu'une case a une valeur » sans casser `validSets`/`winnerFromSets`. Un set n'est validé/gagné qu'à **deux** cases remplies (évite d'activer « Enregistrer » sur un `6-∅` en cours de frappe).
