# Carte « Feuille de match » (Résultat à saisir) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformer la ligne générique « Résultat à saisir » en une carte « feuille de match » éditoriale (deux paires face à face, cases de sets en pointillés, footer teinté), sans toucher au backend ni au comportement.

**Architecture:** 100 % frontend. La logique dérivée (abréviation des noms, répartition des joueurs en deux rangées d'équipe ordonnées par slot) sort dans un module pur testé `frontend/lib/resultsToRecord.ts`. Le composant `frontend/components/match/ResultsToRecord.tsx` garde sa signature (`{ token, clubSlug?, onRecorded? }`), son fetch et son wiring de modale : **seul son rendu est réécrit**. La variante compacte (mobile) passe par le hook existant `useIsDesktop(560)`.

**Tech Stack:** Next.js 16 / React (client components), TypeScript, tokens de thème via `useTheme()` (`@/lib/ThemeProvider`), composants partagés `Avatar` + `Chip`, `colorForSeed`, Jest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-16-resultat-a-saisir-feuille-de-match-design.md`

---

## Contexte indispensable pour l'exécutant

**Ce que le backend garantit déjà** (`MatchService.listToRecord`, `backend/src/services/match.service.ts:96`) : chaque ligne `MatchToRecord` a **exactement 4 participants** padel, chacun avec un `team` (1 ou 2) et un `slot` (0 ou 1) **concrets** (résolus par `effectiveTeams`). Ne rien changer côté backend.

**Le type** (déjà présent dans `frontend/lib/api.ts:1224`) :

```ts
export interface MatchToRecordPlayer {
  userId: string;
  isOrganizer: boolean;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  team: 1 | 2;
  slot: number;
}

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

**Écart assumé vs maquette — le chip de type réutilise le composant partagé `Chip`.** La maquette montrait une pill custom (radius 99, 11px). Le repo a déjà un `Chip` (`components/ui/atoms.tsx:119`) et **`OpenMatchCard` rend déjà exactement ce badge** : `<Chip tone="line">Amicale</Chip>` / `<Chip tone="accent">Compétitive</Chip>` (`components/openmatch/OpenMatchCard.tsx:97-99`). Son ton `accent` gère la lisibilité dans les deux thèmes (encre `th.ink` sur lavis fort en clair ; texte accent sur lavis discret en sombre) — un chip fait main recréerait ce piège de contraste. On réutilise `Chip` : radius 8 au lieu d'une pill, mais **cohérent avec le même badge ailleurs dans l'app**, et DRY.

**Pièges connus de ce repo :**
- Les shims `node_modules/.bin` sont cassés : lancer Jest via `node node_modules/jest/bin/jest.js`, jamais `npx jest`.
- Le flag de filtre de cette version de Jest est **`--testPathPatterns`** (au pluriel) ; `--testPathPattern` est **rejeté**. Ancrer le motif (`"resultsToRecord\.test\.ts$"`) : Windows étant insensible à la casse, un motif non ancré attrape aussi `ResultsToRecord.test.tsx`.
- Jest ne type-check pas (ts-jest `isolatedModules`) → passer `node node_modules/typescript/bin/tsc --noEmit` séparément.
- `matchMedia` est stubé dans `jest.setup.ts` avec `matches: false` **toujours** → `useIsDesktop()` renvoie `false` dans tous les tests : le rendu testé par défaut est la **variante compacte**. Pour tester le desktop il faut surcharger `window.matchMedia` localement (fourni en Task 2).
- Le texte DOM doit rester en casse normale (« Résultat à saisir ») ; la mise en petites capitales se fait en CSS (`textTransform: 'uppercase'`), sinon le test existant qui cherche `/Résultat à saisir/` casse.

**Règle absolue du projet :** aucun débordement horizontal, en clair comme en sombre, à 390 px comme à 1280 px.

## ⚠️ Protocole de commit (obligatoire — Eric édite le repo EN PARALLÈLE)

Eric travaille dans ce repo pendant l'exécution : il committe et son WIP non committé grossit entre deux appels. Ne jamais toucher, stager, committer ou « réparer » un fichier qui n'est pas explicitement le vôtre.

1. **Avant chaque commit**, vérifier la branche : `git branch --show-current` doit imprimer `feat/annonces-drag-drop-kiosque`. Sinon → **STOP, reporter BLOCKED** (la branche a basculé).
2. **`git add X && git commit -m "…"` est INTERDIT** : `git commit` sans pathspec committe **tout l'index**, or le WIP d'Eric peut déjà y être stagé (ça a déjà emporté 4 fichiers étrangers par le passé).
3. **Forme correcte** — `-m` **AVANT** le `--`, sinon git prend le message pour un pathspec littéral et la commande échoue :
   ```
   git add <mes fichiers>
   git commit -m "message" -- <mes fichiers>
   ```
4. **Après le commit**, `git show --stat --format="" HEAD` doit lister **exactement** vos fichiers. Sinon → reporter DONE_WITH_CONCERNS avec la sortie.

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `frontend/lib/resultsToRecord.ts` **(créer)** | Helpers purs : `abbrevName`, `teamRows`. Aucune dépendance React. |
| `frontend/__tests__/resultsToRecord.test.ts` **(créer)** | Tests unitaires des helpers purs. |
| `frontend/__tests__/ResultsToRecord.test.tsx` **(modifier)** | Tests de rendu : équipes, chips, CTA desktop/compact. |
| `frontend/components/match/ResultsToRecord.tsx` **(modifier)** | Rendu de la carte. Fetch + modale inchangés. |

---

### Task 1: Helpers purs (`abbrevName`, `teamRows`)

**Files:**
- Create: `frontend/lib/resultsToRecord.ts`
- Test: `frontend/__tests__/resultsToRecord.test.ts`

- [ ] **Step 1: Write the failing test**

Créer `frontend/__tests__/resultsToRecord.test.ts` :

```ts
import { abbrevName, teamRows } from '@/lib/resultsToRecord';
import type { MatchToRecordPlayer } from '@/lib/api';

const p = (userId: string, firstName: string, lastName: string, team: 1 | 2, slot: number): MatchToRecordPlayer =>
  ({ userId, isOrganizer: false, firstName, lastName, avatarUrl: null, team, slot });

describe('abbrevName', () => {
  it('abrège le prénom en initiale', () => {
    expect(abbrevName('Jean', 'Dupont')).toBe('J. Dupont');
  });

  it('renvoie le nom seul quand le prénom est vide', () => {
    expect(abbrevName('', 'Dupont')).toBe('Dupont');
  });

  it('renvoie le prénom seul quand le nom est vide', () => {
    expect(abbrevName('Jean', '')).toBe('Jean');
  });
});

describe('teamRows', () => {
  it('sépare les joueurs en deux rangées ordonnées par slot', () => {
    const players = [
      p('u2', 'Marie', 'Leroy', 1, 1),
      p('u3', 'Paul', 'Roux', 2, 0),
      p('u1', 'Jean', 'Dupont', 1, 0),
      p('u4', 'Lea', 'Girard', 2, 1),
    ];
    const [team1, team2] = teamRows(players);
    expect(team1.map((x) => x.userId)).toEqual(['u1', 'u2']);
    expect(team2.map((x) => x.userId)).toEqual(['u3', 'u4']);
  });

  it('verse un team inattendu dans la rangée la moins remplie', () => {
    const players = [
      p('u1', 'Jean', 'Dupont', 1, 0),
      p('u2', 'Marie', 'Leroy', 1, 1),
      p('u3', 'Paul', 'Roux', 2, 0),
      { ...p('u4', 'Lea', 'Girard', 2, 1), team: 3 as unknown as 1 },
    ];
    const [team1, team2] = teamRows(players);
    expect(team1.map((x) => x.userId)).toEqual(['u1', 'u2']);
    expect(team2.map((x) => x.userId)).toEqual(['u3', 'u4']);
  });

  it('respecte toujours un team explicite, même déséquilibré', () => {
    const players = [
      p('u1', 'Jean', 'Dupont', 1, 0),
      p('u2', 'Marie', 'Leroy', 1, 1),
      p('u3', 'Paul', 'Roux', 1, 2),
      p('u4', 'Lea', 'Girard', 2, 0),
    ];
    const [team1, team2] = teamRows(players);
    // Un 3v1 s'affiche tel quel : mieux vaut un rendu visiblement cassé qu'un
    // 2v2 plausible obtenu en déplaçant silencieusement un joueur valide.
    expect(team1.map((x) => x.userId)).toEqual(['u1', 'u2', 'u3']);
    expect(team2.map((x) => x.userId)).toEqual(['u4']);
  });

  it('renvoie deux rangées vides pour une liste vide', () => {
    expect(teamRows([])).toEqual([[], []]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/resultsToRecord.test.ts`
Expected: FAIL — `Cannot find module '@/lib/resultsToRecord'`.

- [ ] **Step 3: Write minimal implementation**

Créer `frontend/lib/resultsToRecord.ts` :

```ts
// Helpers purs de la carte « Résultat à saisir » (components/match/ResultsToRecord.tsx).
// Aucune dépendance React : testables directement.
import type { MatchToRecordPlayer } from '@/lib/api';

/** « Jean Dupont » → « J. Dupont ». Tolère un prénom ou un nom vide. */
export function abbrevName(firstName: string, lastName: string): string {
  const first = firstName.trim();
  const last = lastName.trim();
  if (!first) return last;
  if (!last) return first;
  return `${first[0].toUpperCase()}. ${last}`;
}

/**
 * Sépare les joueurs en deux rangées d'équipe ordonnées par `slot` (gauche puis droite).
 * Le backend garantit un 2v2 avec team/slot concrets (effectiveTeams) ; par défense en
 * profondeur, un `team` inattendu est versé dans la rangée la moins remplie.
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/resultsToRecord.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/resultsToRecord.ts frontend/__tests__/resultsToRecord.test.ts
git commit -m "feat(matchs): helpers purs de la carte feuille de match (abbrevName, teamRows)" -- frontend/lib/resultsToRecord.ts frontend/__tests__/resultsToRecord.test.ts
```

---

### Task 2: Tests de rendu de la carte (rouge)

**Files:**
- Modify: `frontend/__tests__/ResultsToRecord.test.tsx`

- [ ] **Step 1: Run the existing suite to capture the baseline**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/ResultsToRecord.test.tsx`
Expected: PASS — 3 tests. (Si ça échoue déjà, arrêter et le signaler : régression pré-existante, hors périmètre.)

- [ ] **Step 2: Write the failing tests**

Ajouter ces tests **à la fin** de `frontend/__tests__/ResultsToRecord.test.tsx`. Garder les 3 tests existants et le harnais du haut du fichier **intacts** (fixture `row`, mock `@/lib/api`, `wrap`, `beforeEach`).

```tsx
const namedRow = {
  ...row,
  players: [
    { userId: 'u1', isOrganizer: true, firstName: 'Jean', lastName: 'Dupont', avatarUrl: null, team: 1, slot: 0 },
    { userId: 'u2', isOrganizer: false, firstName: 'Marie', lastName: 'Leroy', avatarUrl: null, team: 1, slot: 1 },
    { userId: 'u3', isOrganizer: false, firstName: 'Paul', lastName: 'Roux', avatarUrl: null, team: 2, slot: 0 },
    { userId: 'u4', isOrganizer: false, firstName: 'Lea', lastName: 'Girard', avatarUrl: null, team: 2, slot: 1 },
  ],
};

it('affiche les deux paires face à face avec le séparateur VS', async () => {
  (api.getMatchesToRecord as jest.Mock).mockResolvedValue([namedRow]);
  wrap();
  // Variante compacte en test (matchMedia stubé à matches:false) → noms abrégés.
  await waitFor(() => expect(screen.getByText('J. Dupont & M. Leroy')).toBeInTheDocument());
  expect(screen.getByText('P. Roux & L. Girard')).toBeInTheDocument();
  expect(screen.getByText('vs')).toBeInTheDocument();
});

it('affiche le chip Compétitive par défaut', async () => {
  (api.getMatchesToRecord as jest.Mock).mockResolvedValue([row]);
  wrap();
  await waitFor(() => expect(screen.getByText('Compétitive')).toBeInTheDocument());
  expect(screen.queryByText('Amicale')).not.toBeInTheDocument();
});

it('affiche le chip Amicale quand competitive est false', async () => {
  (api.getMatchesToRecord as jest.Mock).mockResolvedValue([{ ...row, competitive: false }]);
  wrap();
  await waitFor(() => expect(screen.getByText('Amicale')).toBeInTheDocument());
  expect(screen.queryByText('Compétitive')).not.toBeInTheDocument();
});

it('affiche le terrain et l\'horaire dans le pied de carte', async () => {
  (api.getMatchesToRecord as jest.Mock).mockResolvedValue([row]);
  wrap();
  await waitFor(() => expect(screen.getByText(/Court 1 ·/)).toBeInTheDocument());
});

it('rend le CTA long et les noms complets en desktop', async () => {
  const original = window.matchMedia;
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: true, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }),
  });
  try {
    (api.getMatchesToRecord as jest.Mock).mockResolvedValue([namedRow]);
    wrap();
    await waitFor(() => expect(screen.getByText('Saisir le score')).toBeInTheDocument());
    expect(screen.getByText('Jean Dupont & Marie Leroy')).toBeInTheDocument();
  } finally {
    Object.defineProperty(window, 'matchMedia', { writable: true, value: original });
  }
});
```

- [ ] **Step 3: Run tests to verify the new ones fail**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/ResultsToRecord.test.tsx`
Expected: les 3 tests d'origine PASS ; les 5 nouveaux FAIL (« Unable to find an element with the text: J. Dupont & M. Leroy », etc.) — la carte actuelle n'affiche aucun nom de joueur.

- [ ] **Step 4: Commit the red tests**

```bash
git add frontend/__tests__/ResultsToRecord.test.tsx
git commit -m "test(matchs): rendu attendu de la carte feuille de match (rouge)" -- frontend/__tests__/ResultsToRecord.test.tsx
```

---

### Task 3: Réécriture du rendu de la carte (vert)

**Files:**
- Modify: `frontend/components/match/ResultsToRecord.tsx` (rendu ; fetch et modale inchangés)

- [ ] **Step 1: Rewrite the component**

Remplacer **tout** le contenu de `frontend/components/match/ResultsToRecord.tsx` par :

```tsx
'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, MatchToRecord, MatchToRecordPlayer } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import type { Theme } from '@/lib/theme';
import { colorForSeed } from '@/lib/playerColors';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { Avatar } from '@/components/ui/Avatar';
import { Chip } from '@/components/ui/atoms';
import { MatchResultModal } from '@/components/match/MatchResultModal';
import { abbrevName, teamRows } from '@/lib/resultsToRecord';

function fmtWhen(iso: string, tz: string): string {
  const date = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).format(new Date(iso));
  const hour = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso)).replace(':', 'h');
  return `${date} · ${hour}`;
}

// Trois cases de set vides, en pointillés : elles annoncent la saisie sans être
// cliquables (le CTA reste l'unique chemin). La 3e est estompée — le 3e set est optionnel.
function SetBoxes({ th, compact }: { th: Theme; compact: boolean }) {
  return (
    <div aria-hidden="true" style={{ display: 'flex', gap: compact ? 6 : 7, flexShrink: 0 }}>
      {[0, 1, 2].map((i) => (
        <span key={i} style={{
          width: compact ? 28 : 34, height: compact ? 32 : 38, borderRadius: 9, flexShrink: 0,
          border: `1.5px dashed ${i === 2 ? th.line : th.lineStrong}`,
        }} />
      ))}
    </div>
  );
}

// Une rangée d'équipe : la paire d'avatars qui se chevauchent, les deux noms, les cases de sets.
function TeamRow({ th, players, compact }: { th: Theme; players: MatchToRecordPlayer[]; compact: boolean }) {
  const size = compact ? 28 : 34;
  const label = players
    .map((p) => (compact ? abbrevName(p.firstName, p.lastName) : `${p.firstName} ${p.lastName}`))
    .join(' & ');
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: compact ? 10 : 14, padding: '6px 0' }}>
      <span style={{ display: 'flex', flexShrink: 0 }}>
        {players.map((p, i) => (
          <span key={p.userId} style={{
            marginLeft: i === 0 ? 0 : -(size * 0.28), borderRadius: '50%',
            border: `2px solid ${th.surface}`, display: 'flex', flexShrink: 0,
          }}>
            <Avatar firstName={p.firstName} lastName={p.lastName} avatarUrl={p.avatarUrl} size={size} color={colorForSeed(p.userId)} />
          </span>
        ))}
      </span>
      <div style={{
        flex: 1, minWidth: 0, fontFamily: th.fontUI, fontWeight: 700, fontSize: compact ? 13 : 14.5,
        color: th.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {label}
      </div>
      <SetBoxes th={th} compact={compact} />
    </div>
  );
}

// Prompt personnel « Résultat à saisir » : liste les matchs padel joués sans résultat et
// ouvre la modale de saisie avec les équipes pré-remplies. Rendu null si rien à saisir.
// `clubSlug` restreint au club courant ; `onRecorded` laisse la surface parente se rafraîchir.
export function ResultsToRecord({ token, clubSlug, onRecorded }: {
  token: string | null;
  clubSlug?: string;
  onRecorded?: () => void;
}) {
  const { th } = useTheme();
  const compact = !useIsDesktop(560);
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

  const pad = compact ? 16 : 20;
  const kicker = {
    fontFamily: th.fontUI, fontSize: compact ? 10 : 10.5, letterSpacing: '2.2px',
    textTransform: 'uppercase' as const, fontWeight: 700,
  };
  const rule = { height: 1, background: th.line };

  return (
    <div style={{ padding: '18px 20px 0' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {rows.map((m) => {
          const [team1, team2] = teamRows(m.players);
          return (
            <div key={m.reservationId} style={{ background: th.surface, borderRadius: 18, boxShadow: th.shadow, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: `13px ${pad}px` }}>
                <span style={{ ...kicker, color: th.textMute }}>Résultat à saisir</span>
                {m.competitive === false
                  ? <Chip tone="line">Amicale</Chip>
                  : <Chip tone="accent">Compétitive</Chip>}
              </div>

              <div style={rule} />

              <div style={{ padding: `${compact ? 8 : 10}px ${pad}px ${compact ? 4 : 6}px` }}>
                {!compact && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', paddingRight: 2 }}>
                    <span aria-hidden="true" style={{ ...kicker, fontSize: 9, letterSpacing: '3px', color: th.textFaint, width: 116, textAlign: 'center' }}>Sets</span>
                  </div>
                )}
                <TeamRow th={th} players={team1} compact={compact} />
                <div style={{ display: 'flex', alignItems: 'center', gap: compact ? 10 : 12 }}>
                  <div style={{ flex: 1, ...rule }} />
                  <span style={{ ...kicker, fontSize: compact ? 9.5 : 10.5, letterSpacing: '3px', color: th.textFaint }}>vs</span>
                  <div style={{ flex: 1, ...rule }} />
                </div>
                <TeamRow th={th} players={team2} compact={compact} />
              </div>

              <div style={rule} />

              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: compact ? 10 : 12,
                padding: `${compact ? 10 : 12}px ${pad}px`, background: th.surface2,
              }}>
                <span style={{
                  fontFamily: th.fontMono, fontSize: compact ? 11 : 12, color: th.textMute,
                  minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {m.resourceName} · {fmtWhen(m.startTime, m.club.timezone)}
                </span>
                <button type="button" onClick={() => setRecordingFor(m)}
                  style={{
                    flexShrink: 0, border: 'none', cursor: 'pointer', borderRadius: 99,
                    padding: compact ? '8px 15px' : '9px 18px', background: th.accent, color: th.onAccent,
                    fontFamily: th.fontUI, fontSize: compact ? 12.5 : 13, fontWeight: 700,
                  }}>
                  {compact ? 'Saisir' : 'Saisir le score'}
                </button>
              </div>
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

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/ResultsToRecord.test.tsx`
Expected: PASS — 8 tests (3 d'origine + 5 nouveaux). Le stub `matchMedia` (`matches:false`) rend `compact = true` → le CTA est « Saisir », ce que cherche le test d'origine.

- [ ] **Step 3: Run the neighbouring suites**

Run: `cd frontend && node node_modules/jest/bin/jest.js __tests__/resultsToRecord.test.ts __tests__/ResultsToRecord.test.tsx __tests__/OpenMatches.test.tsx`
Expected: PASS partout. `OpenMatches.test.tsx` monte `ResultsToRecord` — il valide que les surfaces parentes ne cassent pas.

- [ ] **Step 4: Type-check**

Run: `cd frontend && node node_modules/typescript/bin/tsc --noEmit`
Expected: aucune erreur mentionnant `ResultsToRecord.tsx` ni `resultsToRecord.ts`. (Le repo peut avoir du WIP parallèle bruyant : filtrer sur ces deux fichiers.)

- [ ] **Step 5: Commit**

```bash
git add frontend/components/match/ResultsToRecord.tsx
git commit -m "feat(matchs): carte Resultat a saisir en feuille de match (equipes, cases de sets, footer)" -- frontend/components/match/ResultsToRecord.tsx
```

---

### Task 4: Vérification visuelle (CDP)

**Files:** aucun (vérification uniquement).

- [ ] **Step 1: Invoke the project's visual verification skill**

Utiliser la skill `verify` (screenshots Chrome headless + CDP, session authentifiée) sur le **Club-house** (`/`) du club seedé `padel-arena-paris`, où `ResultsToRecord` est monté (`components/ClubHouse.tsx:180`).

Le compte de démo `test@palova.fr` / `password123` a des matchs à saisir (cf. capture d'origine : « Padel int 2 · mer. 15 juil. · 22h30 » et « Padel int 6 · mar. 14 juil. · 09h30 »). Si la liste est vide, vérifier d'abord que le backend tourne (`curl http://localhost:3001/health`).

Quatre passes obligatoires :
1. **desktop 1280, thème clair** — la carte doit montrer : kicker en petites capitales, chip « Compétitive », label « SETS », noms complets, 3 cases de sets en pointillés (la 3ᵉ plus pâle), footer teinté avec date en mono + CTA « Saisir le score ».
2. **desktop 1280, thème sombre** — mêmes éléments lisibles ; les cases de sets doivent rester visibles sur `th.surface`.
3. **mobile 390, thème clair** — noms abrégés, CTA « Saisir », pas de label « SETS ».
4. **mobile 390, thème sombre**.

⚠️ Piège connu (mémoire projet) : en CDP, `mobile: true` auto-ajuste le viewport et **masque** un vrai débordement à 390 px. Utiliser `mobile: false` + largeur fixe 390.

- [ ] **Step 2: Assert no horizontal overflow**

Sur chaque passe mobile, évaluer dans la page :

```js
document.documentElement.scrollWidth <= window.innerWidth
```

Expected: `true`. Si `false`, trouver l'élément trop large et corriger (candidats : la rangée de noms sans `minWidth:0`, les cases de sets ou le CTA sans `flexShrink:0`).

- [ ] **Step 3: Commit any fix**

S'il a fallu corriger quelque chose :

```bash
git add frontend/components/match/ResultsToRecord.tsx
git commit -m "fix(matchs): carte feuille de match - corrige le rendu apres verification visuelle" -- frontend/components/match/ResultsToRecord.tsx
```

S'il n'y a rien à corriger, ne pas faire de commit vide — passer à la Task 5.

---

### Task 5: Documentation

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add the evolution note**

Dans `CLAUDE.md`, ajouter ce paragraphe d'évolution (même style dense que les autres, en français) à la suite des sections traitant des matchs :

> **Évolution (2026-07-16) — carte « Résultat à saisir » en feuille de match :** le prompt personnel (`components/match/ResultsToRecord.tsx`, monté sur Club-house + `/parties` ×2 + `/me/matches`) passe d'une ligne générique (tuile trophée + bouton) à une **carte « feuille de match »** : kicker petites capitales + **chip Compétitive/Amicale** (réutilise le `Chip` partagé, `tone="accent"`/`tone="line"` — **mêmes tons que le badge d'`OpenMatchCard`**, lisibles dans les 2 thèmes), **deux rangées d'équipe face à face** (paires d'avatars chevauchés `colorForSeed`, noms joints par « & », ellipsis) séparées par un **« VS » à filets**, **3 cases de sets vides en pointillés** (la 3ᵉ estompée — 3ᵉ set optionnel ; décoratives, non cliquables, `aria-hidden`), et **footer teinté `surface2`** (terrain · date en `fontMono` + CTA pill accent). **Variante compacte** sous 560 px (`useIsDesktop(560)`) : avatars 28, noms abrégés « J. Dupont » (helper `abbrevName`), label « SETS » masqué, CTA « Saisir ». **100 % frontend, aucune migration, aucun changement backend** (`listToRecord` garantit déjà le 2v2 avec `team`/`slot` concrets via `effectiveTeams`) ; fetch, wiring `MatchResultModal` (`initialTeams`/`locked`/`competitive`) et surfaces de montage **inchangés**. Helpers purs testés `frontend/lib/resultsToRecord.ts` (`abbrevName`, `teamRows` — ordre par slot, `team` inattendu versé dans la rangée la moins remplie). Direction retenue par Eric sur **3 maquettes comparées dans le companion visuel** (A « feuille de match » / B brume bleue / C talon-ticket — A retenue, v2 affinée validée sur desktop/empilement/mobile 390/sombre). Tests : `__tests__/resultsToRecord.test.ts` (7), `__tests__/ResultsToRecord.test.tsx` (8). Vérifié CDP clair+sombre, 1280 + 390. Spec & plan : `docs/superpowers/{specs,plans}/2026-07-16-resultat-a-saisir-feuille-de-match*`.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: carte Resultat a saisir en feuille de match" -- CLAUDE.md
```

---

## Definition of Done

- [ ] `node node_modules/jest/bin/jest.js __tests__/resultsToRecord.test.ts __tests__/ResultsToRecord.test.tsx __tests__/OpenMatches.test.tsx` : tout vert (7 + 8 + suite OpenMatches).
- [ ] `node node_modules/typescript/bin/tsc --noEmit` : aucune erreur sur `ResultsToRecord.tsx` / `resultsToRecord.ts`.
- [ ] Vérification visuelle CDP passée sur les 4 combinaisons (clair/sombre × 1280/390), sans débordement horizontal.
- [ ] `CLAUDE.md` documente l'évolution.
- [ ] Aucun fichier backend, aucune migration, aucun test backend touché.
