# Reco « parties pour toi » — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pousser au joueur les parties ouvertes à son niveau, via un bloc « Parties pour toi » sur le Club-house et une section « Pour toi » en tête de `/parties` — 100% frontend, à partir des endpoints existants.

**Architecture:** Un helper pur `lib/recommend.ts` (filtre + tri par proximité de niveau) consommé par deux surfaces. On extrait d'abord la carte de partie inline de `OpenMatches.tsx` vers `OpenMatchCard.tsx` (refactor sans changement de comportement) pour la réutiliser dans la section « Pour toi ». Le bloc Club-house est un nouveau composant compact. Aucun backend, aucune migration.

**Tech Stack:** Next.js 16 (Turbopack, client components), React 19, TypeScript, Jest + React Testing Library.

**Spec :** `docs/superpowers/specs/2026-06-16-reco-parties-pour-toi-design.md`

**Conventions du repo (rappels) :**
- Styles inline via `useTheme()` `th` ; commentaires en français ; alias d'import `@/`.
- Tests front : `npm test` dans `frontend/` ; wrapper `<ThemeProvider>` requis pour les composants qui utilisent `useTheme`.
- **GIT HYGIENE :** WIP utilisateur non-committé `frontend/components/clubhouse/PartnerOffers.tsx` — ne JAMAIS le toucher/stager ; jamais `git add -A`/`.`/`-u` ; `git add` ciblé sur les fichiers de chaque tâche. Chaque message de commit finit par `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

- `frontend/lib/recommend.ts` — helper pur `rangeCenter` + `recommendMatches`.
- `frontend/__tests__/recommend.test.ts` — tests du helper.
- `frontend/components/openmatch/OpenMatchCard.tsx` — carte de partie extraite (réutilisable).
- `frontend/components/openmatch/OpenMatches.tsx` — consomme `OpenMatchCard`, ajoute « Pour toi » + dé-dup.
- `frontend/components/clubhouse/MatchesForYou.tsx` — bloc compact Club-house.
- `frontend/__tests__/MatchesForYou.test.tsx` — tests du bloc.
- `frontend/components/ClubHouse.tsx` — câble le bloc (loaders + rendu).

---

## Task 1: Helper pur `recommendMatches`

**Files:**
- Create: `frontend/lib/recommend.ts`
- Test: `frontend/__tests__/recommend.test.ts`

- [ ] **Step 1: Écrire le test (échoue d'abord)**

Créer `frontend/__tests__/recommend.test.ts` :

```ts
import { recommendMatches, rangeCenter } from '@/lib/recommend';
import type { OpenMatch } from '@/lib/api';

const NOW = new Date('2026-06-20T10:00:00Z');
const future = (h: number) => new Date(NOW.getTime() + h * 3600_000).toISOString();
const past = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();

function m(over: Partial<OpenMatch> & { id: string }): OpenMatch {
  return {
    id: over.id, resourceName: 'Court 1', startTime: future(2), endTime: future(3),
    maxPlayers: 4, spotsLeft: 2, full: false, viewerIsParticipant: false, viewerIsOrganizer: false,
    players: [], targetLevelMin: null, targetLevelMax: null, ...over,
  };
}

describe('rangeCenter', () => {
  it('moyenne des deux bornes', () => expect(rangeCenter(4, 6)).toBe(5));
  it('borne unique', () => { expect(rangeCenter(4, null)).toBe(4); expect(rangeCenter(null, 6)).toBe(6); });
  it('aucune borne → null', () => expect(rangeCenter(null, null)).toBeNull());
});

describe('recommendMatches', () => {
  it('niveau inconnu → []', () => {
    expect(recommendMatches([m({ id: 'a' })], null, NOW)).toEqual([]);
  });

  it('exclut complète, passée, déjà inscrit, hors fourchette', () => {
    const matches = [
      m({ id: 'full', full: true, targetLevelMin: 4, targetLevelMax: 6 }),
      m({ id: 'past', startTime: past(2), endTime: past(1), targetLevelMin: 4, targetLevelMax: 6 }),
      m({ id: 'in', viewerIsParticipant: true, targetLevelMin: 4, targetLevelMax: 6 }),
      m({ id: 'low', targetLevelMin: 1, targetLevelMax: 2 }),
      m({ id: 'ok', targetLevelMin: 4, targetLevelMax: 6 }),
    ];
    expect(recommendMatches(matches, 5, NOW).map((x) => x.id)).toEqual(['ok']);
  });

  it('trie par proximité au centre, « tous niveaux » relégué', () => {
    const matches = [
      m({ id: 'all' }),                                       // tous niveaux → relégué
      m({ id: 'far', targetLevelMin: 4, targetLevelMax: 4 }), // centre 4, dist 1
      m({ id: 'near', targetLevelMin: 5, targetLevelMax: 5 }),// centre 5, dist 0
    ];
    expect(recommendMatches(matches, 5, NOW).map((x) => x.id)).toEqual(['near', 'far', 'all']);
  });

  it('à distance égale, la plus tôt d’abord', () => {
    const matches = [
      m({ id: 'late', startTime: future(5), endTime: future(6), targetLevelMin: 5, targetLevelMax: 5 }),
      m({ id: 'soon', startTime: future(1), endTime: future(2), targetLevelMin: 5, targetLevelMax: 5 }),
    ];
    expect(recommendMatches(matches, 5, NOW).map((x) => x.id)).toEqual(['soon', 'late']);
  });
});
```

- [ ] **Step 2: Lancer pour voir échouer**

Run (dans `frontend/`) : `npm test -- recommend.test.ts`
Expected: FAIL (module `@/lib/recommend` introuvable).

- [ ] **Step 3: Implémenter le helper**

Créer `frontend/lib/recommend.ts` :

```ts
import type { OpenMatch } from '@/lib/api';
import { inRange } from '@/lib/levelMatch';

/** Centre d'une fourchette de niveau ; null si aucune borne (« tous niveaux »). */
export function rangeCenter(min: number | null | undefined, max: number | null | undefined): number | null {
  const lo = min ?? null;
  const hi = max ?? null;
  if (lo != null && hi != null) return (lo + hi) / 2;
  if (lo != null) return lo;
  if (hi != null) return hi;
  return null;
}

/**
 * Parties ouvertes « pour toi » : non complètes, à venir, où le joueur n'est pas inscrit,
 * et dont la fourchette l'inclut. Triées par proximité du niveau au centre de la fourchette
 * (« tous niveaux » relégués, distance +∞), puis par heure de début croissante.
 * Niveau inconnu → [].
 */
export function recommendMatches(matches: OpenMatch[], myLevel: number | null, now: Date): OpenMatch[] {
  if (myLevel == null) return [];
  const nowMs = now.getTime();
  const eligible = matches.filter((m) =>
    !m.full
    && new Date(m.startTime).getTime() > nowMs
    && !m.viewerIsParticipant
    && inRange(myLevel, m.targetLevelMin ?? null, m.targetLevelMax ?? null),
  );
  const dist = (m: OpenMatch) => {
    const c = rangeCenter(m.targetLevelMin, m.targetLevelMax);
    return c == null ? Infinity : Math.abs(myLevel - c);
  };
  return [...eligible].sort((a, b) =>
    dist(a) - dist(b) || new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
  );
}
```

- [ ] **Step 4: Lancer pour voir passer**

Run (dans `frontend/`) : `npm test -- recommend.test.ts`
Expected: PASS (toutes).

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/recommend.ts frontend/__tests__/recommend.test.ts
git commit -m "feat(reco): helper pur recommendMatches (parties à ton niveau)"
```

---

## Task 2: Extraire `OpenMatchCard` (refactor, sans changement de comportement)

**Files:**
- Create: `frontend/components/openmatch/OpenMatchCard.tsx`
- Modify: `frontend/components/openmatch/OpenMatches.tsx`

But : sortir la carte de partie (le `<div key={m.id}>…</div>` rendu dans `visibleMatches.map`) vers un composant réutilisable, **sans changer le rendu ni le comportement**. Les tests OpenMatches existants doivent rester verts.

- [ ] **Step 1: Créer le composant carte**

Créer `frontend/components/openmatch/OpenMatchCard.tsx` :

```tsx
'use client';
import { OpenMatch, OpenMatchPlayer } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Btn, Chip } from '@/components/ui/atoms';
import { Icon } from '@/components/ui/Icon';
import { PartnerSearch } from '@/components/tournament/PartnerSearch';
import { PlayerPills } from '@/components/player/PlayerPills';
import { AddPlayerPill } from '@/components/player/AddPlayerPill';
import { rangeLabel } from '@/lib/levelMatch';

function formatWhen(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz })
    .format(new Date(iso)).replace(':', 'h');
}

export interface OpenMatchCardProps {
  match: OpenMatch;
  timezone: string;
  slug: string;
  token: string;
  busy: boolean;
  addingOpen: boolean;
  onJoin: (m: OpenMatch) => void;
  onLeave: (m: OpenMatch) => void;
  onRemovePlayer: (m: OpenMatch, p: OpenMatchPlayer) => void;
  onAddPlayer: (m: OpenMatch, memberId: string) => void;
  onToggleAdd: (m: OpenMatch) => void;
  onCancelAdd: () => void;
  onRecordResult: (m: OpenMatch) => void;
}

// Carte d'une partie ouverte (terrain, créneau, fourchette, joueurs, actions).
// Extraite d'OpenMatches pour être réutilisée dans la section « Pour toi ».
export function OpenMatchCard({
  match: m, timezone, slug, token, busy, addingOpen,
  onJoin, onLeave, onRemovePlayer, onAddPlayer, onToggleAdd, onCancelAdd, onRecordResult,
}: OpenMatchCardProps) {
  const { th } = useTheme();
  return (
    <div style={{ background: th.surface, borderRadius: 16, padding: '14px 16px', boxShadow: `inset 0 0 0 1px ${th.line}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <Icon name="users" size={18} color={th.accent} />
        <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 15, color: th.text }}>{m.resourceName}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          {(m.targetLevelMin != null || m.targetLevelMax != null) && (
            <Chip tone="line">{rangeLabel(m.targetLevelMin ?? null, m.targetLevelMax ?? null)}</Chip>
          )}
          <Chip tone={m.full ? 'mute' : 'accent'}>{m.full ? 'Complet' : `${m.spotsLeft} place${m.spotsLeft > 1 ? 's' : ''}`}</Chip>
        </span>
      </div>
      <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, marginBottom: 12 }}>
        {formatWhen(m.startTime, timezone)} → {formatWhen(m.endTime, timezone)}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <PlayerPills
            players={m.players}
            spotsLeft={m.spotsLeft}
            onRemove={(p) => onRemovePlayer(m, p)}
            canRemove={(p) => m.viewerIsOrganizer && !p.isOrganizer}
            busy={busy}
            firstSpotSlot={m.viewerIsOrganizer ? (
              <AddPlayerPill disabled={busy} ariaLabel={`Ajouter un joueur à ${m.resourceName}`}
                onClick={() => onToggleAdd(m)} />
            ) : undefined}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
          {m.viewerIsOrganizer ? (
            <Chip tone="line" icon="check">Vous organisez</Chip>
          ) : m.viewerIsParticipant ? (
            <Btn variant="surface" disabled={busy} onClick={() => onLeave(m)}>Quitter</Btn>
          ) : (
            <Btn icon="plus" disabled={busy || m.full} onClick={() => onJoin(m)}>Rejoindre</Btn>
          )}
          {new Date(m.endTime).getTime() <= Date.now() && m.players.length === 4 && (
            <Btn variant="surface" disabled={busy} onClick={() => onRecordResult(m)}>Saisir le résultat</Btn>
          )}
        </div>
      </div>
      {m.viewerIsOrganizer && addingOpen && (
        <div style={{ marginTop: 12 }}>
          <PartnerSearch
            slug={slug} token={token} selected={null}
            excludeIds={m.players.map((p) => p.userId)}
            onSelect={(member) => onAddPlayer(m, member.id)}
            onClear={() => {}}
            disabled={busy}
          />
          <button type="button" onClick={onCancelAdd} style={{ marginTop: 8, border: 'none', background: 'transparent', color: th.textMute, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13 }}>Annuler</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Remplacer la carte inline dans `OpenMatches.tsx` par `<OpenMatchCard>`**

Dans `frontend/components/openmatch/OpenMatches.tsx` :

1. Ajouter l'import : `import { OpenMatchCard } from '@/components/openmatch/OpenMatchCard';`
2. Dans le `visibleMatches.map((m) => { … })`, remplacer tout le corps (depuis `const busy = busyId === m.id;` et le `return (<div key={m.id}>…</div>)`) par :

```tsx
          ) : visibleMatches.map((m) => (
            <OpenMatchCard
              key={m.id}
              match={m}
              timezone={club.timezone}
              slug={club.slug}
              token={token!}
              busy={busyId === m.id}
              addingOpen={addingId === m.id}
              onJoin={handleJoin}
              onLeave={(mm) => act(mm, () => api.leaveOpenMatch(club.slug, mm.id, token!))}
              onRemovePlayer={(mm, p) => act(mm, () => api.removeOpenMatchPlayer(club.slug, mm.id, p.userId, token!))}
              onAddPlayer={(mm, memberId) => { setAddingId(null); act(mm, () => api.addOpenMatchPlayer(club.slug, mm.id, memberId, token!)); }}
              onToggleAdd={(mm) => setAddingId((prev) => (prev === mm.id ? null : mm.id))}
              onCancelAdd={() => setAddingId(null)}
              onRecordResult={(mm) => setRecordingFor(mm)}
            />
          ))}
```

3. Supprimer les imports devenus inutilisés dans `OpenMatches.tsx` **uniquement s'ils ne servent plus ailleurs dans le fichier** : `PartnerSearch`, `PlayerPills`, `AddPlayerPill`, `Icon`, et `formatWhen` (la fonction locale). **Attention :** `Chip` et `Btn` et `rangeLabel`/`inRange` peuvent encore servir (chips d'en-tête, filtre, warning). Vérifier chaque import avec une recherche dans le fichier avant de le retirer ; en cas de doute, le laisser (TypeScript signalera les imports inutilisés via le lint, pas via tsc — laisser un import inutilisé ne casse pas le build).

- [ ] **Step 3: Vérifier compilation + tests OpenMatches (comportement inchangé)**

Run (dans `frontend/`) : `npx tsc --noEmit`
Expected: aucune erreur.
Run (dans `frontend/`) : `npm test -- OpenMatches`
Expected: tous les tests OpenMatches existants PASSENT (rendu identique).

- [ ] **Step 4: Commit**

```bash
git add frontend/components/openmatch/OpenMatchCard.tsx frontend/components/openmatch/OpenMatches.tsx
git commit -m "refactor(openmatch): extraire OpenMatchCard d'OpenMatches"
```

---

## Task 3: Section « Pour toi » + dé-duplication dans `/parties`

**Files:**
- Modify: `frontend/components/openmatch/OpenMatches.tsx`
- Test: `frontend/__tests__/OpenMatches.test.tsx`

- [ ] **Step 1: Écrire le test (échoue d'abord)**

Repérer comment `OpenMatches.test.tsx` monte le composant et mocke `@/lib/api` (suivre le motif existant : mock `getOpenMatches`/`getMyRating`, wrapper `<ThemeProvider>`). Ajouter un test :

```tsx
it('met les parties à mon niveau dans « Pour toi » et les retire des « Autres »', async () => {
  // myLevel = 5 ; une partie ciblée niveau 5 (recommandée) + une « tous niveaux »
  getMyRating.mockResolvedValue({ level: 5, tier: 'Confirmé', isProvisional: false, matchesPlayed: 10, calibrated: true });
  getOpenMatches.mockResolvedValue([
    { id: 'reco', resourceName: 'Court A', startTime: future(2), endTime: future(3), maxPlayers: 4, spotsLeft: 2, full: false, viewerIsParticipant: false, viewerIsOrganizer: false, players: [], targetLevelMin: 5, targetLevelMax: 5 },
    { id: 'alllvl', resourceName: 'Court B', startTime: future(4), endTime: future(5), maxPlayers: 4, spotsLeft: 2, full: false, viewerIsParticipant: false, viewerIsOrganizer: false, players: [], targetLevelMin: null, targetLevelMax: null },
  ]);
  // … monter le composant comme les autres tests du fichier, attendre le chargement …
  // « Pour toi » présent et contient Court A ; la section « Autres parties » ne re-liste pas 'reco'.
  await screen.findByText('Pour toi');
  expect(screen.getByText('Court A')).toBeInTheDocument();
  // Court A n'apparaît qu'une fois (dé-dup) :
  expect(screen.getAllByText('Court A')).toHaveLength(1);
});
```

(Adapter `future(h)` et le montage au style exact du fichier. Si le fichier n'a pas de helper `future`, en ajouter un local : `const future = (h) => new Date(Date.now()+h*3600_000).toISOString();`.)

- [ ] **Step 2: Lancer pour voir échouer**

Run (dans `frontend/`) : `npm test -- OpenMatches`
Expected: FAIL (« Pour toi » absent).

- [ ] **Step 3: Implémenter les deux sections**

Dans `frontend/components/openmatch/OpenMatches.tsx` :

1. Ajouter l'import : `import { recommendMatches } from '@/lib/recommend';`
2. Calculer, après `visibleMatches` :

```tsx
  const recommended = recommendMatches(matches, myLevel, new Date());
  const recoIds = new Set(recommended.map((m) => m.id));
  const otherMatches = visibleMatches.filter((m) => !recoIds.has(m.id));
```

3. Dans la vue « Parties » (`view === 'parties'`), juste avant le bloc liste (le `<div style={{ padding: '14px 20px 0', display:'flex', flexDirection:'column', gap:12 }}>`), insérer la section « Pour toi » (visible seulement si recos) :

```tsx
        {token && recommended.length > 0 && (
          <div style={{ padding: '14px 20px 0' }}>
            <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 13, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute, marginBottom: 12 }}>Pour toi</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {recommended.map((m) => (
                <OpenMatchCard
                  key={m.id} match={m} timezone={club.timezone} slug={club.slug} token={token}
                  busy={busyId === m.id} addingOpen={addingId === m.id}
                  onJoin={handleJoin}
                  onLeave={(mm) => act(mm, () => api.leaveOpenMatch(club.slug, mm.id, token))}
                  onRemovePlayer={(mm, p) => act(mm, () => api.removeOpenMatchPlayer(club.slug, mm.id, p.userId, token))}
                  onAddPlayer={(mm, memberId) => { setAddingId(null); act(mm, () => api.addOpenMatchPlayer(club.slug, mm.id, memberId, token)); }}
                  onToggleAdd={(mm) => setAddingId((prev) => (prev === mm.id ? null : mm.id))}
                  onCancelAdd={() => setAddingId(null)}
                  onRecordResult={(mm) => setRecordingFor(mm)}
                />
              ))}
            </div>
          </div>
        )}
```

4. Dans le bloc liste, remplacer l'itération sur `visibleMatches` par `otherMatches`, et donner un titre de section quand « Pour toi » est affiché. Concrètement : remplacer `visibleMatches.length === 0 ? (…) : visibleMatches.map(…)` par une logique sur `otherMatches`, et ajouter au-dessus de la liste un libellé conditionnel :

```tsx
          {token && recommended.length > 0 && otherMatches.length > 0 && (
            <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 13, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute, marginBottom: 0 }}>Autres parties</div>
          )}
```

puis l'itération et le message vide basculent sur `otherMatches` :

```tsx
          ) : otherMatches.length === 0 ? (
            <div style={{ padding: '24px 0', textAlign: 'center', fontFamily: th.fontUI, color: th.textMute }}>
              {recommended.length > 0 ? 'Pas d’autre partie ouverte.' : (filterMyLevel && matches.length > 0 ? 'Aucune partie à ton niveau pour le moment.' : 'Aucune partie ouverte pour le moment.')}
            </div>
          ) : otherMatches.map((m) => (
            <OpenMatchCard key={m.id} match={m} timezone={club.timezone} slug={club.slug} token={token!}
              busy={busyId === m.id} addingOpen={addingId === m.id}
              onJoin={handleJoin}
              onLeave={(mm) => act(mm, () => api.leaveOpenMatch(club.slug, mm.id, token!))}
              onRemovePlayer={(mm, p) => act(mm, () => api.removeOpenMatchPlayer(club.slug, mm.id, p.userId, token!))}
              onAddPlayer={(mm, memberId) => { setAddingId(null); act(mm, () => api.addOpenMatchPlayer(club.slug, mm.id, memberId, token!)); }}
              onToggleAdd={(mm) => setAddingId((prev) => (prev === mm.id ? null : mm.id))}
              onCancelAdd={() => setAddingId(null)}
              onRecordResult={(mm) => setRecordingFor(mm)}
            />
          ))}
```

(Garde-fou : la condition d'« empty global » qui affichait « Aucune partie » quand `visibleMatches` était vide doit désormais tenir compte de `recommended` — si `recommended.length > 0`, ne pas afficher « Aucune partie ouverte ».)

- [ ] **Step 4: Lancer les tests + tsc**

Run (dans `frontend/`) : `npx tsc --noEmit` → aucune erreur.
Run (dans `frontend/`) : `npm test -- OpenMatches` → tout vert (existants + nouveau).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/openmatch/OpenMatches.tsx frontend/__tests__/OpenMatches.test.tsx
git commit -m "feat(reco): section « Pour toi » + dé-dup dans /parties"
```

---

## Task 4: Bloc Club-house `MatchesForYou`

**Files:**
- Create: `frontend/components/clubhouse/MatchesForYou.tsx`
- Test: `frontend/__tests__/MatchesForYou.test.tsx`

- [ ] **Step 1: Écrire le test (échoue d'abord)**

Créer `frontend/__tests__/MatchesForYou.test.tsx` :

```tsx
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { MatchesForYou } from '@/components/clubhouse/MatchesForYou';
import type { OpenMatch } from '@/lib/api';

const wrap = (ui: React.ReactNode) => render(<ThemeProvider>{ui}</ThemeProvider>);
const future = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

function m(over: Partial<OpenMatch> & { id: string }): OpenMatch {
  return {
    id: over.id, resourceName: over.resourceName ?? 'Court 1', startTime: future(2), endTime: future(3),
    maxPlayers: 4, spotsLeft: 2, full: false, viewerIsParticipant: false, viewerIsOrganizer: false,
    players: [], targetLevelMin: 5, targetLevelMax: 5, ...over,
  };
}

it('affiche jusqu’à 3 recos + lien Voir tout', () => {
  wrap(<MatchesForYou matches={[m({ id: 'a', resourceName: 'Court A' }), m({ id: 'b', resourceName: 'Court B' })]} myLevel={5} timezone="Europe/Paris" />);
  expect(screen.getByText('Parties pour toi')).toBeInTheDocument();
  expect(screen.getByText('Court A')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Voir tout/i })).toHaveAttribute('href', '/parties');
});

it('masqué si aucune reco', () => {
  const { container } = wrap(<MatchesForYou matches={[m({ id: 'x', full: true })]} myLevel={5} timezone="Europe/Paris" />);
  expect(container).toBeEmptyDOMElement();
});

it('masqué si niveau inconnu', () => {
  const { container } = wrap(<MatchesForYou matches={[m({ id: 'a' })]} myLevel={null} timezone="Europe/Paris" />);
  expect(container).toBeEmptyDOMElement();
});
```

- [ ] **Step 2: Lancer pour voir échouer**

Run (dans `frontend/`) : `npm test -- MatchesForYou`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Implémenter le composant**

Créer `frontend/components/clubhouse/MatchesForYou.tsx` :

```tsx
'use client';
import Link from 'next/link';
import { OpenMatch } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Icon } from '@/components/ui/Icon';
import { recommendMatches } from '@/lib/recommend';
import { rangeLabel } from '@/lib/levelMatch';

function formatWhen(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: tz })
    .format(new Date(iso)).replace(':', 'h');
}

// Bloc Club-house « Parties pour toi » : top 3 des parties ouvertes à ton niveau.
// Masqué (null) si aucune reco ou niveau inconnu. Cartes compactes → /parties.
export function MatchesForYou({ matches, myLevel, timezone }: { matches: OpenMatch[]; myLevel: number | null; timezone: string }) {
  const { th } = useTheme();
  const recos = recommendMatches(matches, myLevel, new Date()).slice(0, 3);
  if (recos.length === 0) return null;
  return (
    <div style={{ background: th.surface, borderRadius: 16, padding: '14px 16px', boxShadow: `inset 0 0 0 1px ${th.line}` }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 12.5, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon name="users" size={14} color={th.accent} />Parties pour toi
        </div>
        <Link href="/parties" style={{ marginLeft: 'auto', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, color: th.accent, textDecoration: 'none' }}>Voir tout →</Link>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {recos.map((m) => (
          <Link key={m.id} href="/parties" style={{ textDecoration: 'none', background: th.surface2, borderRadius: 10, padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ flex: 1, minWidth: 0, fontFamily: th.fontUI, fontSize: 14, color: th.text }}>
              <strong>{m.resourceName}</strong> · {formatWhen(m.startTime, timezone)}
              <span style={{ color: th.textMute, fontSize: 12.5 }}> · {rangeLabel(m.targetLevelMin ?? null, m.targetLevelMax ?? null)}</span>
            </span>
            <span style={{ background: th.accent, color: th.onAccent, borderRadius: 999, padding: '3px 9px', fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
              {m.spotsLeft} place{m.spotsLeft > 1 ? 's' : ''}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Lancer pour voir passer**

Run (dans `frontend/`) : `npm test -- MatchesForYou`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/clubhouse/MatchesForYou.tsx frontend/__tests__/MatchesForYou.test.tsx
git commit -m "feat(reco): bloc Club-house « Parties pour toi »"
```

---

## Task 5: Câbler `MatchesForYou` dans `ClubHouse`

**Files:**
- Modify: `frontend/components/ClubHouse.tsx`

- [ ] **Step 1: Charger parties ouvertes + niveau**

Dans `frontend/components/ClubHouse.tsx` :

1. Importer : `import { MatchesForYou } from '@/components/clubhouse/MatchesForYou';` et ajouter `OpenMatch` à l'import depuis `@/lib/api`.
2. Ajouter deux états près des autres : 

```tsx
  const [openMatches, setOpenMatches] = useState<OpenMatch[]>([]);
  const [myLevel, setMyLevel] = useState<number | null>(null);
```

3. Ajouter deux effets (gardés par `token`, comme `loadNext`) :

```tsx
  useEffect(() => { if (!token) return; api.getOpenMatches(club.slug, token).then(setOpenMatches).catch(() => setOpenMatches([])); }, [club.slug, token]);
  useEffect(() => { if (!token) return; api.getMyRating(token).then((r) => setMyLevel(r?.level ?? null)).catch(() => {}); }, [token]);
```

- [ ] **Step 2: Rendre le bloc + l'inclure dans le calcul `empty`**

1. Calculer les recos pour le calcul `empty` (réutilise le helper) — ajouter près des autres dérivés (`slots`, `nextEvents`) :

```tsx
  const matchRecos = recommendMatches(openMatches, myLevel, now).slice(0, 3);
```

(et importer `recommendMatches` depuis `@/lib/recommend`.)

2. Étendre la condition `empty` pour inclure les recos :

```tsx
  const empty = !hero && slots.length === 0 && nextEvents.length === 0 && restAnn.length === 0 && spons.length === 0 && next.length === 0 && matchRecos.length === 0;
```

3. Rendre le bloc en section juste après la grille d'action (le `<div className="ch-grid">…</div>`), avant « Vos prochaines réservations » :

```tsx
      {matchRecos.length > 0 && (
        <div style={{ padding: '22px 20px 0' }}>
          <MatchesForYou matches={openMatches} myLevel={myLevel} timezone={club.timezone} />
        </div>
      )}
```

(Le composant re-filtre en interne ; passer `openMatches`/`myLevel` bruts est volontaire — `matchRecos` ne sert qu'aux gardes `empty`/affichage.)

- [ ] **Step 3: Vérifier compilation + tests**

Run (dans `frontend/`) : `npx tsc --noEmit` → aucune erreur.
Run (dans `frontend/`) : `npm test -- ClubHouse` → vert (si un test ClubHouse existe ; sinon, lancer la suite complète à l'étape gate). Vérifier qu'aucun test existant ne casse.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/ClubHouse.tsx
git commit -m "feat(reco): câbler le bloc « Parties pour toi » dans le Club-house"
```

---

## Vérification finale (gate)

- [ ] **Front complet** — Run (dans `frontend/`) : `npm test` → tout vert (baseline 458 + nouveaux).
- [ ] **Front types** — Run (dans `frontend/`) : `npx tsc --noEmit` → aucune erreur.
- [ ] **Vérif visuelle** (si back+front tournent) : Club-house → bloc « Parties pour toi » (ou masqué si rien) ; `/parties` → section « Pour toi » en tête + « Autres parties » sans doublon ; non-calibré → rien de personnalisé.
- [ ] **Revue de code** via superpowers:requesting-code-review avant intégration.
- [ ] Confirmer que `frontend/components/clubhouse/PartnerOffers.tsx` (WIP utilisateur) n'a jamais été touché ni committé.

---

## Notes

- Aucune migration, aucun changement backend.
- `OpenMatch` et les endpoints existants sont la seule source ; si leur forme change, ce code suit.
- Hors v1 : email/push, deep-link vers une partie précise, reco par niveau des joueurs présents.
