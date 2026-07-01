# Équipes gauche/droite pour les matchs padel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Afficher et gérer les joueurs d'un match padel (hors tournois/events) en **deux équipes gauche/droite** avec séparateur « VS », réorganisables par tap-pour-permuter, partout où l'on crée, modifie ou affiche un match.

**Architecture:** Une colonne nullable `team` sur `ReservationParticipant`, jamais écrite par les flux existants ; un helper pur `effectiveTeams()` attribue un côté 1/2 à chaque joueur **à la lecture**. Un composant frontend partagé `MatchTeams` (deux colonnes + VS, côte à côte même sur mobile, tap-pour-permuter) remplace `PlayerPills` sur les surfaces padel. La persistance des équipes passe par des endpoints « set teams » explicites (organisateur / propriétaire / création).

**Tech Stack:** Backend Express 5 + Prisma 7 (PostgreSQL), Jest. Frontend Next.js 16 + React 19, React Testing Library. Padel uniquement.

**Références :** Spec `docs/superpowers/specs/2026-07-01-equipes-matchs-padel-design.md`.

**Contraintes projet importantes :**
- Prisma 7 : le client est déjà configuré via `PrismaPg` adapter — ne pas y toucher.
- Base DEV en dérive : on applique la migration additive via `prisma db execute` (pas `migrate dev`). Le dossier de migration est créé pour la prod (`migrate deploy`).
- Après tout changement de schéma : `npx prisma generate`.
- Frontend : suites qui montent le vrai `ClubNav`/`OpenMatches`/`BookingModal` cassent si un `api.*` manque au mock — chaque tâche frontend ajoute la méthode au mock concerné.
- Lancer les suites de façon **ciblée** (le run complet frontend a un flake connu sur BookingModal).

---

## Phase 1 — Fondation backend (colonne + helper + exposition de `team`)

### Task 1: Migration additive `team` sur reservation_participants

**Files:**
- Modify: `backend/prisma/schema.prisma` (modèle `ReservationParticipant`, ~ligne 718)
- Create: `backend/prisma/migrations/20260701000000_add_reservation_participant_team/migration.sql`

- [ ] **Step 1: Ajouter le champ au schéma Prisma**

Dans `backend/prisma/schema.prisma`, modèle `ReservationParticipant`, ajouter le champ après `joinedAt` :

```prisma
  joinedAt      DateTime @default(now()) @map("joined_at")
  team          Int?     // 1 = côté gauche (Éq.1), 2 = côté droit (Éq.2) ; null = non assigné (dérivé à la lecture)
```

- [ ] **Step 2: Créer le fichier de migration (pour la prod)**

Créer `backend/prisma/migrations/20260701000000_add_reservation_participant_team/migration.sql` :

```sql
-- Ajoute le côté d'équipe (padel) sur les participants de réservation. Additif, nullable.
ALTER TABLE "reservation_participants" ADD COLUMN "team" INTEGER;
```

- [ ] **Step 3: Appliquer à la base DEV (dérive → db execute, pas migrate dev)**

Run:
```bash
cd backend && npx prisma db execute --schema prisma/schema.prisma --file prisma/migrations/20260701000000_add_reservation_participant_team/migration.sql
```
Expected: `Script executed successfully.` (si « column already exists », la migration est déjà appliquée — continuer.)

- [ ] **Step 4: Régénérer le client Prisma**

Run: `cd backend && npx prisma generate`
Expected: `Generated Prisma Client` sans erreur.

- [ ] **Step 5: Vérifier la compilation TypeScript**

Run: `cd backend && npx tsc --noEmit`
Expected: aucune erreur (le champ `team` est reconnu sur `ReservationParticipant`).

- [ ] **Step 6: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260701000000_add_reservation_participant_team
git commit -m "feat(match): add nullable team column on reservation_participants"
```

---

### Task 2: Helper pur `effectiveTeams`

**Files:**
- Create: `backend/src/services/matchTeams.ts`
- Test: `backend/src/services/__tests__/matchTeams.test.ts`

- [ ] **Step 1: Écrire le test qui échoue**

Créer `backend/src/services/__tests__/matchTeams.test.ts` :

```ts
import { effectiveTeams } from '../matchTeams';

const p = (team: number | null) => ({ team });

describe('effectiveTeams', () => {
  it('remplit les null côté 1 puis côté 2 dans l’ordre (double, 4 joueurs)', () => {
    const out = effectiveTeams([p(null), p(null), p(null), p(null)], 4);
    expect(out.map((x) => x.team)).toEqual([1, 1, 2, 2]);
  });

  it('honore les team explicites et complète les null (double)', () => {
    // A=2 explicite, B=null, C=null, D=null → A:2 ; puis remplissage 1,1,2
    const out = effectiveTeams([p(2), p(null), p(null), p(null)], 4);
    expect(out.map((x) => x.team)).toEqual([2, 1, 1, 2]);
  });

  it('clampe un côté sur-rempli et bascule le surplus (double)', () => {
    // trois joueurs demandent le côté 1 : le 3e est repoussé côté 2
    const out = effectiveTeams([p(1), p(1), p(1), p(2)], 4);
    expect(out.map((x) => x.team)).toEqual([1, 1, 2, 2]);
  });

  it('gère le single (2 joueurs, un par côté)', () => {
    const out = effectiveTeams([p(null), p(null)], 2);
    expect(out.map((x) => x.team)).toEqual([1, 2]);
  });

  it('préserve l’ordre d’entrée et propage les autres champs', () => {
    const out = effectiveTeams([{ team: null, userId: 'a' }, { team: null, userId: 'b' }], 4);
    expect(out).toEqual([{ team: 1, userId: 'a' }, { team: 1, userId: 'b' }]);
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier l’échec**

Run: `cd backend && npx jest src/services/__tests__/matchTeams.test.ts`
Expected: FAIL — `Cannot find module '../matchTeams'`.

- [ ] **Step 3: Implémenter le helper**

Créer `backend/src/services/matchTeams.ts` :

```ts
// Attribue un côté d'équipe (1 = gauche, 2 = droite) à CHAQUE participant d'un match padel.
// `team` explicite (1/2) est honoré tant que le côté n'est pas plein (maxPlayers/2) ;
// les `null` (et tout surplus) sont répartis dans l'ordre d'entrée (joinedAt) : côté 1 tant
// qu'il reste de la place, sinon côté 2. Pur, déterministe, sans effet de bord.
export function effectiveTeams<T extends { team: number | null }>(
  participants: T[],
  maxPlayers: number,
): Array<T & { team: 1 | 2 }> {
  const half = Math.max(1, Math.floor(maxPlayers / 2));
  const count: Record<1 | 2, number> = { 1: 0, 2: 0 };
  const out: Array<1 | 2 | undefined> = new Array(participants.length);

  // Passe 1 : team explicite qui tient dans son côté.
  participants.forEach((p, i) => {
    if ((p.team === 1 || p.team === 2) && count[p.team] < half) {
      count[p.team]++;
      out[i] = p.team;
    }
  });
  // Passe 2 : remplissage des non-assignés, ordre d'entrée.
  participants.forEach((_p, i) => {
    if (out[i]) return;
    const side: 1 | 2 = count[1] < half ? 1 : 2;
    count[side]++;
    out[i] = side;
  });

  return participants.map((p, i) => ({ ...p, team: out[i]! }));
}
```

- [ ] **Step 4: Lancer le test pour vérifier le succès**

Run: `cd backend && npx jest src/services/__tests__/matchTeams.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/matchTeams.ts backend/src/services/__tests__/matchTeams.test.ts
git commit -m "feat(match): pure effectiveTeams helper (1/2 side assignment)"
```

---

### Task 3: Exposer `team` dans `listOpenMatches`

**Files:**
- Modify: `backend/src/services/openMatch.service.ts` (include ~ligne 81-84 ; map ~ligne 137-140)
- Test: `backend/src/services/__tests__/openMatch.service.test.ts` (ajout d'assertions)

- [ ] **Step 1: Ajouter une assertion `team` au test existant**

Dans `backend/src/services/__tests__/openMatch.service.test.ts`, repérer un test de `listOpenMatches` qui crée une partie avec plusieurs participants et ajouter, sur le résultat, une assertion :

```ts
    // Chaque joueur reçoit un côté concret 1 ou 2 (dérivé), jamais null.
    const match = result[0];
    for (const player of match.players) {
      expect([1, 2]).toContain(player.team);
    }
    // Répartition par défaut (null → 1,1,2,2) : au plus la moitié par côté.
    const side1 = match.players.filter((p) => p.team === 1).length;
    expect(side1).toBeLessThanOrEqual(match.maxPlayers / 2);
```

(Si aucun test n'a ≥2 participants, ajouter un `it` dédié qui seed une résa PUBLIC padel avec 2 participants et vérifie `players.map(p => p.team)` = `[1, 2]`.)

- [ ] **Step 2: Lancer le test pour vérifier l’échec**

Run: `cd backend && npx jest src/services/__tests__/openMatch.service.test.ts -t listOpenMatches`
Expected: FAIL — `player.team` est `undefined`.

- [ ] **Step 3: Implémenter — importer le helper, sélectionner `team`, dériver**

Dans `backend/src/services/openMatch.service.ts` :

En tête de fichier, après les imports existants :
```ts
import { effectiveTeams } from './matchTeams';
```

Dans l'`include.participants.select` de `listOpenMatches` (~ligne 83), ajouter `team: true` :
```ts
        participants: {
          orderBy: { joinedAt: 'asc' },
          select: { userId: true, isOrganizer: true, team: true, user: { select: { firstName: true, lastName: true, avatarUrl: true } } },
        },
```

Dans le `.map((m) => { ... })` (~ligne 120), juste après le calcul de `maxPlayers` (ligne 121), dériver les équipes :
```ts
      const teamed = effectiveTeams(m.participants, maxPlayers);
```

Puis remplacer le bloc `players: m.participants.map((p) => ({ ... }))` (~ligne 137) par une map sur `teamed`, en ajoutant `team` :
```ts
        players: teamed.map((p) => ({
          userId: p.userId, firstName: p.user.firstName, lastName: p.user.lastName, avatarUrl: p.user.avatarUrl, isOrganizer: p.isOrganizer,
          level: levels[`${p.userId}:${sportKey}`] ?? null,
          team: p.team,
        })),
```

- [ ] **Step 4: Lancer le test pour vérifier le succès**

Run: `cd backend && npx jest src/services/__tests__/openMatch.service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/openMatch.service.ts backend/src/services/__tests__/openMatch.service.test.ts
git commit -m "feat(match): expose team on open match players"
```

---

### Task 4: Exposer `team` dans `listUserReservations` et `getOwnReservationPlayers` (padel uniquement)

**Files:**
- Modify: `backend/src/services/reservation.service.ts` (`listUserReservations` ~1456-1493 ; `getOwnReservationPlayers` ~1400-1414 ; `mapOwnPlayers` ~1380-1397)
- Test: `backend/src/services/__tests__/reservation.service.test.ts` (ajout d'assertions)

- [ ] **Step 1: Écrire les assertions qui échouent**

Dans `backend/src/services/__tests__/reservation.service.test.ts`, dans (ou à côté de) la suite `listUserReservations`, ajouter un test :

```ts
  it('attribue une équipe (1/2) aux participants d’une résa padel, null hors padel', async () => {
    // Suit le pattern de seed existant de ce fichier pour créer une résa padel CONFIRMED
    // avec 2 participants (organisateur + 1). Adapter aux helpers de seed du fichier.
    const list = await service.listUserReservations(organizerUserId);
    const padel = list.find((r) => r.resource.sport.key === 'padel');
    expect(padel).toBeTruthy();
    for (const p of padel!.participants) expect([1, 2]).toContain(p.team);
  });
```

- [ ] **Step 2: Lancer le test pour vérifier l’échec**

Run: `cd backend && npx jest src/services/__tests__/reservation.service.test.ts -t "équipe"`
Expected: FAIL — `p.team` est `undefined`.

- [ ] **Step 3: Implémenter dans `listUserReservations`**

Dans `backend/src/services/reservation.service.ts`, importer le helper en tête (près des autres imports de services) :
```ts
import { effectiveTeams } from './matchTeams';
```

Dans `listUserReservations`, ajouter `team: true` au `select` des participants (~ligne 1470) :
```ts
        participants: {
          orderBy: { joinedAt: 'asc' },
          select: { id: true, userId: true, isOrganizer: true, team: true, user: { select: { firstName: true, lastName: true, avatarUrl: true } } },
        },
```

Dans le `.map(...)` de retour (~ligne 1479-1492), remplacer la construction de `participants` par une version qui dérive les équipes en padel, `null` sinon :
```ts
    return rows.map(({ participants, resource, ...rest }) => {
      const { attributes, clubSport, ...resourcePublic } = resource;
      const sportKey = clubSport.sport.key;
      const capacity = playerCount((attributes as { format?: string } | null)?.format);
      const teamed = sportKey === 'padel'
        ? effectiveTeams(participants, capacity)
        : participants.map((p) => ({ ...p, team: null as 1 | 2 | null }));
      return {
        ...rest,
        resource: { ...resourcePublic, sport: { key: clubSport.sport.key, name: clubSport.sport.name } },
        capacity,
        participants: teamed.map((p) => ({
          id: p.id, userId: p.userId, isOrganizer: p.isOrganizer,
          firstName: p.user.firstName, lastName: p.user.lastName, avatarUrl: p.user.avatarUrl,
          level: levels[`${p.userId}:${sportKey}`] ?? null,
          team: p.team,
        })),
      };
    });
```

- [ ] **Step 4: Implémenter dans `getOwnReservationPlayers` + `mapOwnPlayers`**

Dans `getOwnReservationPlayers` (~ligne 1401), enrichir l'`include` :
```ts
      include: {
        resource: { select: { attributes: true, clubSport: { select: { sport: { select: { key: true } } } } } },
        participants: {
          orderBy: { joinedAt: 'asc' },
          select: { id: true, userId: true, isOrganizer: true, share: true, team: true, user: { select: { firstName: true, lastName: true, avatarUrl: true } } },
        },
      },
```

Remplacer `mapOwnPlayers` (~ligne 1380-1397) par une version qui dérive `team` (padel) et expose `sportKey` :
```ts
  private mapOwnPlayers(r: {
    id: string;
    resource: { attributes: Prisma.JsonValue; clubSport: { sport: { key: string } } };
    participants: Array<{ id: string; userId: string; isOrganizer: boolean; share: Prisma.Decimal; team: number | null; user: { firstName: string; lastName: string; avatarUrl: string | null } }>;
  }) {
    const format = (r.resource.attributes as { format?: string } | null)?.format;
    const capacity = playerCount(format);
    const sportKey = r.resource.clubSport.sport.key;
    const teamed = sportKey === 'padel'
      ? effectiveTeams(r.participants, capacity)
      : r.participants.map((p) => ({ ...p, team: null as 1 | 2 | null }));
    return {
      id: r.id,
      sportKey,
      capacity,
      participants: teamed.map((p) => ({
        id: p.id, userId: p.userId, isOrganizer: p.isOrganizer,
        firstName: p.user.firstName, lastName: p.user.lastName, avatarUrl: p.user.avatarUrl,
        share: Number(p.share).toFixed(2),
        team: p.team,
      })),
    };
  }
```

- [ ] **Step 5: Lancer les tests pour vérifier le succès + compilation**

Run: `cd backend && npx jest src/services/__tests__/reservation.service.test.ts && npx tsc --noEmit`
Expected: PASS + aucune erreur TS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/reservation.service.ts backend/src/services/__tests__/reservation.service.test.ts
git commit -m "feat(match): expose team on my-reservations and own-players (padel)"
```

---

### Task 5: Types frontend `team` sur les DTO participants

**Files:**
- Modify: `frontend/lib/api.ts` (types `OpenMatchPlayer`, `MyReservation.participants`, `ReservationPlayer`, `ReservationPlayers`)

- [ ] **Step 1: Ajouter `team` aux types**

Dans `frontend/lib/api.ts` :

`OpenMatchPlayer` (~ligne 1166) — ajouter :
```ts
  team?: 1 | 2 | null;
```

Le type inline des participants de `MyReservation` (chercher `participants:` dans l'interface `MyReservation`) — ajouter `team?: 1 | 2 | null;` à l'objet participant.

`ReservationPlayer` (interface avec `share`) — ajouter `team?: 1 | 2 | null;`.

`ReservationPlayers` (retour de `getOwnReservationPlayers`/add/remove) — ajouter `sportKey?: string;` à côté de `capacity`.

- [ ] **Step 2: Vérifier la compilation**

Run: `cd frontend && npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(match): frontend team fields on participant DTOs"
```

---

## Phase 2 — Composant partagé `MatchTeams` + affichage

### Task 6: Composant `MatchTeams` (affichage deux côtés + tap-pour-permuter)

**Files:**
- Create: `frontend/components/match/MatchTeams.tsx`
- Test: `frontend/__tests__/MatchTeams.test.tsx`

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `frontend/__tests__/MatchTeams.test.tsx` :

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { MatchTeams, MatchPlayerData } from '@/components/match/MatchTeams';

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

const players: MatchPlayerData[] = [
  { userId: 'a', firstName: 'Marc', lastName: 'A', isOrganizer: true, team: 1 },
  { userId: 'b', firstName: 'Paul', lastName: 'B', team: 1 },
  { userId: 'c', firstName: 'Lea',  lastName: 'C', team: 2 },
];

describe('MatchTeams', () => {
  it('rend deux colonnes d’équipe avec un séparateur VS', () => {
    wrap(<MatchTeams players={players} capacity={4} />);
    expect(screen.getByText('VS')).toBeInTheDocument();
    expect(screen.getByText('Marc A')).toBeInTheDocument();
    expect(screen.getByText('Lea C')).toBeInTheDocument();
  });

  it('affiche une « Place libre » pour chaque slot vide (côté 2 incomplet)', () => {
    wrap(<MatchTeams players={players} capacity={4} />);
    // 3 joueurs, capacité 4 → 1 place libre côté 2
    expect(screen.getAllByText('Place libre')).toHaveLength(1);
  });

  it('en mode editable, tap joueur puis tap joueur adverse émet la nouvelle map d’équipes', () => {
    const onSetTeams = jest.fn();
    wrap(<MatchTeams players={players} capacity={4} editable onSetTeams={onSetTeams} />);
    fireEvent.click(screen.getByText('Marc A'));   // pick Marc (team 1)
    fireEvent.click(screen.getByText('Lea C'));     // swap avec Lea (team 2)
    expect(onSetTeams).toHaveBeenCalledWith(
      expect.objectContaining({ a: 2, c: 1, b: 1 }),
    );
  });

  it('non editable : cliquer un joueur n’émet rien', () => {
    const onSetTeams = jest.fn();
    wrap(<MatchTeams players={players} capacity={4} onSetTeams={onSetTeams} />);
    fireEvent.click(screen.getByText('Marc A'));
    expect(onSetTeams).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Lancer les tests pour vérifier l’échec**

Run: `cd frontend && npx jest __tests__/MatchTeams.test.tsx`
Expected: FAIL — `Cannot find module '@/components/match/MatchTeams'`.

- [ ] **Step 3: Implémenter le composant**

Créer `frontend/components/match/MatchTeams.tsx` :

```tsx
'use client';
import { Fragment, useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';
import { UserLevel } from '@/lib/api';
import { LevelChip } from '@/components/player/LevelChip';

export interface MatchPlayerData {
  userId: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
  isOrganizer?: boolean;
  participantId?: string;
  level?: UserLevel | null;
  team: 1 | 2;
}

const SIDE_COLOR: Record<1 | 2, string> = { 1: ACCENTS.blue, 2: ACCENTS.coral };

// Deux équipes côte à côte (Éq.1 gauche / Éq.2 droite) avec « VS » central. Padel : 2 slots par côté
// (single : 1). Côte à côte même sur mobile (flex, pas de scroll horizontal). Prop `editable` :
// tap-pour-permuter (toucher un joueur puis un 2e pour échanger, ou une place libre pour déplacer).
export function MatchTeams({
  players, capacity, friendIds, size = 'md', busy = false,
  onRemove, canRemove, addSlot, editable = false, onSetTeams,
}: {
  players: MatchPlayerData[];
  capacity: number;
  friendIds?: Set<string>;
  size?: 'sm' | 'md';
  busy?: boolean;
  onRemove?: (player: MatchPlayerData) => void;
  canRemove?: (player: MatchPlayerData) => boolean;
  addSlot?: React.ReactNode;               // ex. AddPlayerPill, posé dans le 1er slot libre (côté 1 d'abord)
  editable?: boolean;
  onSetTeams?: (teamsByUserId: Record<string, 1 | 2>) => void;
}) {
  const { th } = useTheme();
  const [picked, setPicked] = useState<string | null>(null);
  const av = size === 'sm' ? 20 : 22;
  const fs = size === 'sm' ? 12.5 : 13;
  const half = Math.max(1, Math.floor(capacity / 2));

  const sideOf = (t: 1 | 2) => players.filter((p) => p.team === t);
  const currentTeams = (): Record<string, 1 | 2> =>
    Object.fromEntries(players.map((p) => [p.userId, p.team]));

  // 1er slot libre global : côté 1 s'il reste de la place, sinon côté 2 (là où va `addSlot`).
  const firstFreeSide: 1 | 2 | null =
    sideOf(1).length < half ? 1 : sideOf(2).length < half ? 2 : null;

  const commit = (next: Record<string, 1 | 2>) => { setPicked(null); onSetTeams?.(next); };

  const onPick = (p: MatchPlayerData) => {
    if (!editable || busy) return;
    if (picked === null) { setPicked(p.userId); return; }
    if (picked === p.userId) { setPicked(null); return; }
    // échange des deux côtés
    const a = players.find((x) => x.userId === picked)!;
    const next = currentTeams();
    next[a.userId] = p.team;
    next[p.userId] = a.team;
    commit(next);
  };

  const onPickFree = (side: 1 | 2) => {
    if (!editable || busy || picked === null) return;
    const a = players.find((x) => x.userId === picked)!;
    if (a.team === side) { setPicked(null); return; }
    if (sideOf(side).length >= half) return;   // côté plein : pas de place libre à occuper
    const next = currentTeams();
    next[a.userId] = side;
    commit(next);
  };

  const renderPlayer = (p: MatchPlayerData) => {
    const c = colorForSeed(p.userId);
    const removable = !!onRemove && (canRemove ? canRemove(p) : true);
    const isFriend = !!friendIds?.has(p.userId);
    const isPicked = picked === p.userId;
    const avatar = <Avatar firstName={p.firstName} lastName={p.lastName} avatarUrl={p.avatarUrl ?? null} size={av} color={c} />;
    return (
      <span
        key={p.userId}
        onClick={editable ? () => onPick(p) : undefined}
        role={editable ? 'button' : undefined}
        tabIndex={editable ? 0 : undefined}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: `${c}22`, border: `1px solid ${isPicked ? th.accent : c}`,
          outline: isPicked ? `2px solid ${th.accent}` : 'none',
          borderRadius: 999, padding: '4px 11px 4px 4px',
          fontFamily: th.fontUI, fontSize: fs, fontWeight: 600, color: th.text,
          cursor: editable ? 'pointer' : 'default',
        }}
      >
        {isFriend ? (
          <span title="Vous suivez ce joueur" style={{ display: 'inline-flex', borderRadius: '50%', padding: 1.5, background: th.accent, flexShrink: 0 }}>{avatar}</span>
        ) : avatar}
        {p.firstName} {p.lastName}
        <LevelChip level={p.level} size="xs" />
        {p.isOrganizer && (
          <span style={{ fontSize: 10, fontWeight: 700, color: th.textMute, textTransform: 'uppercase', letterSpacing: 0.3 }}>orga</span>
        )}
        {removable && (
          <button type="button" disabled={busy} aria-label={`Retirer ${p.firstName} ${p.lastName}`} title="Retirer ce joueur"
            onClick={(e) => { e.stopPropagation(); onRemove!(p); }}
            style={{ border: 'none', background: 'transparent', cursor: busy ? 'default' : 'pointer', color: th.textMute, fontSize: 15, lineHeight: 1, padding: 0, marginLeft: 2 }}>×</button>
        )}
      </span>
    );
  };

  const renderFree = (side: 1 | 2, key: string, withAdd: boolean) =>
    withAdd && addSlot ? (
      <Fragment key={key}>{addSlot}</Fragment>
    ) : (
      <span key={key}
        onClick={editable ? () => onPickFree(side) : undefined}
        role={editable && picked ? 'button' : undefined}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 999, padding: '4px 12px 4px 4px', border: `1.5px dashed ${th.lineStrong}`, fontFamily: th.fontUI, fontSize: 12.5, color: th.textFaint, cursor: editable && picked ? 'pointer' : 'default' }}>
        <span aria-hidden="true" style={{ width: av, height: av, borderRadius: '50%', flexShrink: 0, border: `1.5px dashed ${th.lineStrong}` }} />
        Place libre
      </span>
    );

  const column = (side: 1 | 2) => {
    const list = sideOf(side);
    const freeCount = Math.max(0, half - list.length);
    return (
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: SIDE_COLOR[side], flexShrink: 0 }} />
          <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 11.5, letterSpacing: 0.3, textTransform: 'uppercase', color: th.textMute }}>Équipe {side}</span>
        </div>
        {list.map(renderPlayer)}
        {Array.from({ length: freeCount }).map((_, i) =>
          renderFree(side, `free-${side}-${i}`, i === 0 && firstFreeSide === side),
        )}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: 10 }}>
      {column(1)}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <span style={{ fontFamily: th.fontUI, fontWeight: 800, fontSize: 12, color: th.textFaint, letterSpacing: 0.5 }}>VS</span>
      </div>
      {column(2)}
    </div>
  );
}
```

- [ ] **Step 4: Lancer les tests pour vérifier le succès**

Run: `cd frontend && npx jest __tests__/MatchTeams.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/match/MatchTeams.tsx frontend/__tests__/MatchTeams.test.tsx
git commit -m "feat(match): shared MatchTeams component (two sides + VS + tap-swap)"
```

---

### Task 7: Afficher `MatchTeams` sur le calendrier (Mes réservations)

**Files:**
- Modify: `frontend/components/calendar/MyAgendaListItem.tsx` (rendu joueurs ~102-110)
- Modify: `frontend/components/calendar/DayPanel.tsx` (rendu joueurs ~101-110)
- Test: `frontend/__tests__/` (suites calendrier existantes, si présentes)

- [ ] **Step 1: Remplacer `PlayerPills` par `MatchTeams` (padel), sinon garder `PlayerPills`**

Dans `MyAgendaListItem.tsx` et `DayPanel.tsx`, là où `PlayerPills` est monté avec `reservation.participants`, ajouter le gating padel. Exemple (adapter au nom de variable local de la réservation) :

```tsx
import { MatchTeams } from '@/components/match/MatchTeams';
// ...
{r.resource.sport?.key === 'padel' ? (
  <MatchTeams
    players={(r.participants ?? []).map((p) => ({
      userId: p.userId, firstName: p.firstName, lastName: p.lastName,
      avatarUrl: p.avatarUrl, isOrganizer: p.isOrganizer, level: p.level,
      team: (p.team ?? 1) as 1 | 2,
    }))}
    capacity={r.capacity ?? 4}
    size="sm"
  />
) : (
  /* rendu PlayerPills existant, inchangé */
)}
```

Conserver l'affichage `PlayerPills` d'origine dans la branche `else`.

- [ ] **Step 2: Vérifier la compilation + suites calendrier**

Run:
```bash
cd frontend && npx tsc --noEmit && npx jest __tests__/MonthCalendar.test.tsx __tests__/DayPanel 2>/dev/null || true
```
Expected: TS OK. (Si des suites `DayPanel`/agenda existent, elles passent ; sinon, pas de suite → ne pas bloquer.)

- [ ] **Step 3: Commit**

```bash
git add frontend/components/calendar/MyAgendaListItem.tsx frontend/components/calendar/DayPanel.tsx
git commit -m "feat(match): show team layout on calendar reservations (padel)"
```

---

### Task 8: Afficher `MatchTeams` dans `OpenMatchCard` (lecture, édition en Phase 3)

**Files:**
- Modify: `frontend/components/openmatch/OpenMatchCard.tsx` (bloc `PlayerPills` ~89-100)
- Test: `frontend/__tests__/OpenMatchCard.test.tsx`

- [ ] **Step 1: Mettre à jour les fixtures du test avec `team` + assertion VS**

Dans `frontend/__tests__/OpenMatchCard.test.tsx`, ajouter `team: 1` (et `team: 2` s'il y a plusieurs joueurs) aux objets `players` des fixtures, puis ajouter une assertion :

```tsx
    expect(screen.getByText('VS')).toBeInTheDocument();
```

- [ ] **Step 2: Lancer pour vérifier l’échec**

Run: `cd frontend && npx jest __tests__/OpenMatchCard.test.tsx`
Expected: FAIL — pas de « VS » (PlayerPills encore utilisé).

- [ ] **Step 3: Remplacer `PlayerPills` par `MatchTeams`**

Dans `OpenMatchCard.tsx`, remplacer l'import `PlayerPills`/`PlayerPillData` par `MatchTeams` (garder l'import `AddPlayerPill`) :

```tsx
import { MatchTeams } from '@/components/match/MatchTeams';
```

Remplacer le bloc `<PlayerPills ... />` (~89-100) par :

```tsx
      <MatchTeams
        players={m.players.map((p) => ({
          userId: p.userId, firstName: p.firstName, lastName: p.lastName,
          avatarUrl: p.avatarUrl, isOrganizer: p.isOrganizer, level: p.level,
          team: (p.team ?? 1) as 1 | 2,
        }))}
        capacity={m.maxPlayers}
        friendIds={friendIds}
        busy={busy}
        onRemove={(p) => onRemovePlayer(m, { userId: p.userId, firstName: p.firstName, lastName: p.lastName, isOrganizer: p.isOrganizer })}
        canRemove={(p) => m.viewerIsOrganizer && !p.isOrganizer}
        addSlot={m.viewerIsOrganizer ? (
          <AddPlayerPill disabled={busy} ariaLabel={`Ajouter un joueur à ${m.resourceName}`} onClick={() => onToggleAdd(m)} />
        ) : undefined}
      />
```

Note : `onRemovePlayer` attend un `PlayerPillData` ; on reconstruit l'objet minimal depuis `p`. Adapter la signature côté `OpenMatches` si nécessaire (elle n'utilise que `p.userId`).

- [ ] **Step 4: Lancer pour vérifier le succès**

Run: `cd frontend && npx jest __tests__/OpenMatchCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/openmatch/OpenMatchCard.tsx frontend/__tests__/OpenMatchCard.test.tsx
git commit -m "feat(match): open match card uses MatchTeams layout"
```

---

## Phase 3 — Édition des équipes (endpoints + tap-swap actif)

### Task 9: Endpoint organisateur `setTeams` (partie ouverte) + tap-swap dans OpenMatchCard

**Files:**
- Modify: `backend/src/services/matchTeams.ts` (ajout de `applyTeams`)
- Modify: `backend/src/services/openMatch.service.ts` (méthode `setTeams`)
- Modify: `backend/src/routes/clubs.ts` (route ~après ligne 259)
- Modify: `frontend/lib/api.ts` (méthode `setOpenMatchTeams`)
- Modify: `frontend/components/openmatch/OpenMatchCard.tsx` + `frontend/components/openmatch/OpenMatches.tsx`
- Test: `backend/src/services/__tests__/openMatch.service.test.ts`

- [ ] **Step 1: Écrire le test service qui échoue**

Dans `backend/src/services/__tests__/openMatch.service.test.ts`, ajouter :

```ts
  describe('setTeams', () => {
    it('persiste les côtés choisis pour une partie 2v2 (organisateur)', async () => {
      // seed : résa PUBLIC padel double + 4 participants (org + 3). Réutiliser les helpers du fichier.
      await service.setTeams(slug, reservationId, organizerUserId, {
        [organizerUserId]: 2, [p2]: 2, [p3]: 1, [p4]: 1,
      });
      const list = await service.listOpenMatches(slug, organizerUserId);
      const match = list.find((m) => m.id === reservationId)!;
      const team1 = match.players.filter((p) => p.team === 1).map((p) => p.userId).sort();
      expect(team1).toEqual([p3, p4].sort());
    });

    it('refuse un côté sur-rempli (TEAM_SIDE_FULL)', async () => {
      await expect(service.setTeams(slug, reservationId, organizerUserId, {
        [organizerUserId]: 1, [p2]: 1, [p3]: 1, [p4]: 2,
      })).rejects.toThrow('TEAM_SIDE_FULL');
    });

    it('refuse un non-organisateur (NOT_ORGANIZER)', async () => {
      await expect(service.setTeams(slug, reservationId, p2, {
        [organizerUserId]: 1, [p2]: 2, [p3]: 1, [p4]: 2,
      })).rejects.toThrow('NOT_ORGANIZER');
    });
  });
```

- [ ] **Step 2: Lancer pour vérifier l’échec**

Run: `cd backend && npx jest src/services/__tests__/openMatch.service.test.ts -t setTeams`
Expected: FAIL — `service.setTeams is not a function`.

- [ ] **Step 3: Ajouter `applyTeams` au helper**

Dans `backend/src/services/matchTeams.ts`, ajouter (le helper devient aussi un module d'écriture, mais reste pur pour `effectiveTeams`) :

```ts
import type { Prisma } from '@prisma/client';

// Valide + persiste l'assignation complète d'équipes d'un match. `teamsByUserId` DOIT couvrir
// tous les participants ; chaque côté ≤ maxPlayers/2 ; valeurs ∈ {1,2}. Transactionnel (tx fourni).
export async function applyTeams(
  tx: Prisma.TransactionClient,
  reservationId: string,
  teamsByUserId: Record<string, number>,
  maxPlayers: number,
): Promise<void> {
  const parts = await tx.reservationParticipant.findMany({
    where: { reservationId },
    select: { id: true, userId: true },
  });
  const half = Math.max(1, Math.floor(maxPlayers / 2));
  const count: Record<number, number> = { 1: 0, 2: 0 };
  for (const p of parts) {
    const t = teamsByUserId[p.userId];
    if (t !== 1 && t !== 2) throw new Error('TEAM_INVALID');
    count[t]++;
    if (count[t] > half) throw new Error('TEAM_SIDE_FULL');
  }
  for (const p of parts) {
    await tx.reservationParticipant.update({ where: { id: p.id }, data: { team: teamsByUserId[p.userId] } });
  }
}
```

- [ ] **Step 4: Ajouter `setTeams` au service open match**

Dans `backend/src/services/openMatch.service.ts`, importer `applyTeams` (compléter l'import existant) :
```ts
import { effectiveTeams, applyTeams } from './matchTeams';
```

Ajouter la méthode (après `addOpenMatchPlayer`) :
```ts
  /** Réorganise les équipes d'une partie ouverte (organisateur seul). Transaction Serializable + FOR UPDATE. */
  async setTeams(slug: string, reservationId: string, organizerUserId: string, teams: Record<string, number>) {
    const club = await this.resolveActiveMember(slug, organizerUserId);
    await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ start_time: Date; resource_id: string }>>`
        SELECT start_time, resource_id FROM reservations WHERE id = ${reservationId} FOR UPDATE
      `;
      const r = locked[0];
      if (!r) throw new Error('RESERVATION_NOT_FOUND');
      const resource = await tx.resource.findUnique({ where: { id: r.resource_id }, select: { clubId: true, attributes: true } });
      if (!resource || resource.clubId !== club.id) throw new Error('CLUB_MISMATCH');
      const parts = await tx.reservationParticipant.findMany({ where: { reservationId }, select: { userId: true, isOrganizer: true } });
      const actor = parts.find((p) => p.userId === organizerUserId);
      if (!actor || !actor.isOrganizer) throw new Error('NOT_ORGANIZER');
      const maxPlayers = playerCount((resource.attributes as { format?: string } | null)?.format);
      await applyTeams(tx, reservationId, teams, maxPlayers);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 });
    return { id: reservationId };
  }
```

- [ ] **Step 5: Lancer pour vérifier le succès**

Run: `cd backend && npx jest src/services/__tests__/openMatch.service.test.ts -t setTeams`
Expected: PASS (3 tests).

- [ ] **Step 6: Ajouter la route**

Dans `backend/src/routes/clubs.ts`, après la route `POST /:slug/open-matches/:id/participants` (~ligne 259) :
```ts
router.post('/:slug/open-matches/:id/participants/teams', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await openMatchService.setTeams(asString(req.params.slug), asString(req.params.id), req.user!.id, (req.body as { teams?: Record<string, number> }).teams ?? {})); }
  catch (err) { handleError(err, res, next); }
});
```

- [ ] **Step 7: Test de route (400 sur côté plein)**

Dans la suite de routes open-match (`backend/src/routes/__tests__/clubs.openmatch-chat.routes.test.ts` ou la suite de routes clubs open-match existante), ajouter un test qui appelle `POST /:slug/open-matches/:id/participants/teams` en tant qu'organisateur et vérifie 200, puis un cas côté plein → 400. (Suivre le pattern d'auth/seed du fichier.)

Run: `cd backend && npx jest src/routes/__tests__/clubs.openmatch-chat.routes.test.ts`
Expected: PASS.

- [ ] **Step 8: Méthode API frontend**

Dans `frontend/lib/api.ts`, après `removeOpenMatchPlayer` (~ligne 264) :
```ts
  setOpenMatchTeams: (slug: string, id: string, teams: Record<string, 1 | 2>, token: string) =>
    request<{ id: string }>(`/api/clubs/${slug}/open-matches/${id}/participants/teams`, { method: 'POST', body: JSON.stringify({ teams }) }, token),
```

- [ ] **Step 9: Activer le tap-swap dans OpenMatchCard + handler dans OpenMatches**

Dans `OpenMatchCard.tsx`, ajouter à `MatchTeams` (Task 8) les props d'édition :
```tsx
        editable={m.viewerIsOrganizer}
        onSetTeams={(teams) => onSetTeams(m, teams)}
```
Ajouter `onSetTeams: (m: OpenMatch, teams: Record<string, 1 | 2>) => void;` à `OpenMatchCardProps` et au déstructuring.

Dans `OpenMatches.tsx`, passer le handler aux deux `<OpenMatchCard>` (recommandé + autres) :
```tsx
                  onSetTeams={(mm, teams) => act(mm, () => api.setOpenMatchTeams(club.slug, mm.id, teams, token!))}
```
(Pour la liste « recommandée » qui utilise `token` non-nul, utiliser `token`.)

- [ ] **Step 10: Mettre à jour le mock `api` des suites OpenMatches/OpenMatchCard**

Dans les mocks `lib/api` de `frontend/__tests__/OpenMatchCard.test.tsx` (et toute suite montant `OpenMatches`), ajouter `setOpenMatchTeams: jest.fn().mockResolvedValue({ id: 'r1' })`. Ajouter un test : en mode organisateur, tap deux joueurs adverses → `api.setOpenMatchTeams` appelé avec la bonne map.

Run: `cd frontend && npx jest __tests__/OpenMatchCard.test.tsx && npx tsc --noEmit`
Expected: PASS + TS OK.

- [ ] **Step 11: Commit**

```bash
git add backend/src/services/matchTeams.ts backend/src/services/openMatch.service.ts backend/src/routes/clubs.ts backend/src/routes/__tests__ backend/src/services/__tests__/openMatch.service.test.ts frontend/lib/api.ts frontend/components/openmatch/OpenMatchCard.tsx frontend/components/openmatch/OpenMatches.tsx frontend/__tests__/OpenMatchCard.test.tsx
git commit -m "feat(match): organizer can reassign open-match teams (tap-to-swap)"
```

---

### Task 10: Endpoint propriétaire `setTeams` (sa réservation) + tap-swap dans ReservationPlayersInline

**Files:**
- Modify: `backend/src/services/reservation.service.ts` (méthode `setReservationTeams`)
- Modify: `backend/src/routes/reservations.ts` (route `/:id/teams`)
- Modify: `frontend/lib/api.ts` (`setReservationTeams`)
- Modify: `frontend/components/reservations/ReservationPlayersInline.tsx`
- Test: `backend/src/services/__tests__/reservation.service.test.ts`, `backend/src/routes/__tests__/reservations.routes.test.ts`

- [ ] **Step 1: Écrire le test service qui échoue**

Dans `backend/src/services/__tests__/reservation.service.test.ts` :
```ts
  describe('setReservationTeams', () => {
    it('persiste les équipes pour le propriétaire d’une résa padel', async () => {
      await service.setReservationTeams(reservationId, ownerUserId, { [ownerUserId]: 2, [p2]: 1 });
      const { participants } = await service.getOwnReservationPlayers(reservationId, ownerUserId);
      expect(participants.find((p) => p.userId === ownerUserId)!.team).toBe(2);
    });
    it('refuse un non-propriétaire (UNAUTHORIZED)', async () => {
      await expect(service.setReservationTeams(reservationId, p2, { [ownerUserId]: 1, [p2]: 2 }))
        .rejects.toThrow('UNAUTHORIZED');
    });
  });
```

- [ ] **Step 2: Lancer pour vérifier l’échec**

Run: `cd backend && npx jest src/services/__tests__/reservation.service.test.ts -t setReservationTeams`
Expected: FAIL — méthode absente.

- [ ] **Step 3: Implémenter `setReservationTeams`**

Dans `backend/src/services/reservation.service.ts`, importer `applyTeams` (compléter l'import de `./matchTeams`), puis ajouter après `removeOwnReservationParticipant` (~ligne 1453) :
```ts
  /** Réorganise les équipes d'une réservation (propriétaire seul). */
  async setReservationTeams(reservationId: string, userId: string, teams: Record<string, number>) {
    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { resource: { select: { attributes: true } } },
    });
    if (!reservation)                  throw new Error('RESERVATION_NOT_FOUND');
    if (reservation.userId !== userId) throw new Error('UNAUTHORIZED');
    const maxPlayers = playerCount((reservation.resource.attributes as { format?: string } | null)?.format);
    await prisma.$transaction(async (tx) => {
      await applyTeams(tx, reservationId, teams, maxPlayers);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return this.getOwnReservationPlayers(reservationId, userId);
  }
```

- [ ] **Step 4: Lancer pour vérifier le succès**

Run: `cd backend && npx jest src/services/__tests__/reservation.service.test.ts -t setReservationTeams`
Expected: PASS.

- [ ] **Step 5: Ajouter la route + test de route**

Dans `backend/src/routes/reservations.ts`, à côté des routes `/:id/players`, ajouter :
```ts
router.post('/:id/teams', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await reservationService.setReservationTeams(asString(req.params.id), req.user!.id, (req.body as { teams?: Record<string, number> }).teams ?? {})); }
  catch (err) { handleError(err, res, next); }
});
```
Dans `backend/src/routes/__tests__/reservations.routes.test.ts`, ajouter un test POST `/:id/teams` (propriétaire → 200 ; autre user → 403/erreur mappée).

Run: `cd backend && npx jest src/routes/__tests__/reservations.routes.test.ts`
Expected: PASS.

- [ ] **Step 6: Méthode API frontend**

Dans `frontend/lib/api.ts`, après `removeReservationPlayer` (~ligne 254) :
```ts
  setReservationTeams: (reservationId: string, teams: Record<string, 1 | 2>, token: string) =>
    request<ReservationPlayers>(`/api/reservations/${reservationId}/teams`, { method: 'POST', body: JSON.stringify({ teams }) }, token),
```

- [ ] **Step 7: Basculer `ReservationPlayersInline` sur `MatchTeams` (padel) éditable**

Dans `frontend/components/reservations/ReservationPlayersInline.tsx`, remplacer le bloc `<PlayerPills ... />` par un rendu conditionnel : si `reservation.resource.sport?.key === 'padel'`, monter `MatchTeams` (avec `editable={canEdit}`, `onSetTeams`, `onRemove`, `addSlot`), sinon garder `PlayerPills`.

```tsx
import { MatchTeams } from '@/components/match/MatchTeams';
// ... dans le rendu, à la place de <PlayerPills ...>
{reservation.resource.sport?.key === 'padel' ? (
  <MatchTeams
    players={participants.map((p) => ({
      userId: p.userId, firstName: p.firstName, lastName: p.lastName,
      avatarUrl: p.avatarUrl, isOrganizer: p.isOrganizer, participantId: p.id, level: p.level,
      team: (p.team ?? 1) as 1 | 2,
    }))}
    capacity={capacity}
    size="sm"
    busy={busy}
    editable={canEdit}
    onSetTeams={(teams) => run(() => api.setReservationTeams(reservation.id, teams, token))}
    onRemove={canEdit ? (p) => run(() => api.removeReservationPlayer(reservation.id, p.participantId!, token)) : undefined}
    canRemove={(p) => canEdit && !p.isOrganizer}
    addSlot={canEdit ? (
      <AddPlayerPill size="sm" disabled={busy} ariaLabel={`Ajouter un joueur à ${reservation.resource.name}`} onClick={() => setAdding((a) => !a)} />
    ) : undefined}
  />
) : (
  /* PlayerPills existant, inchangé */
)}
```

- [ ] **Step 8: Vérifier compilation + suites concernées**

Run: `cd frontend && npx tsc --noEmit && npx jest __tests__/ReservationPlayersInline 2>/dev/null || true`
Expected: TS OK ; suite (si présente) verte. Si une suite monte ce composant et mocke `lib/api`, ajouter `setReservationTeams` au mock.

- [ ] **Step 9: Commit**

```bash
git add backend/src/services/reservation.service.ts backend/src/routes/reservations.ts backend/src/routes/__tests__/reservations.routes.test.ts backend/src/services/__tests__/reservation.service.test.ts frontend/lib/api.ts frontend/components/reservations/ReservationPlayersInline.tsx
git commit -m "feat(match): owner can reassign reservation teams (inline)"
```

---

### Task 11: Assignation d'équipe à la création (`applyHoldSetup.teams`) + BookingModal

**Files:**
- Modify: `backend/src/services/reservation.service.ts` (`applyHoldSetup` ~325-381)
- Modify: `frontend/lib/api.ts` (type `applyHoldSetup.setup.teams`)
- Modify: `frontend/components/BookingModal.tsx`
- Test: `backend/src/services/__tests__/reservation.service.test.ts`, `frontend/__tests__/BookingModal*.test.tsx`

- [ ] **Step 1: Test — `applyHoldSetup` persiste `teams`**

Dans `backend/src/services/__tests__/reservation.service.test.ts`, dans la suite `applyHoldSetup`, ajouter :
```ts
  it('persiste les équipes fournies (padel double)', async () => {
    await service.applyHoldSetup(reservationId, organizerUserId, {
      partnerUserIds: [p2, p3, p4], visibility: 'PUBLIC',
      teams: { [organizerUserId]: 1, [p2]: 2, [p3]: 1, [p4]: 2 },
    });
    const { participants } = await service.getOwnReservationPlayers(reservationId, organizerUserId);
    expect(participants.find((p) => p.userId === p2)!.team).toBe(2);
  });
```

- [ ] **Step 2: Lancer pour vérifier l’échec**

Run: `cd backend && npx jest src/services/__tests__/reservation.service.test.ts -t "persiste les équipes fournies"`
Expected: FAIL — `team` reste dérivé (1,1,2,2), p2 devrait être 2.

- [ ] **Step 3: Implémenter — `teams` optionnel dans `applyHoldSetup`**

Dans `backend/src/services/reservation.service.ts`, ajouter au type du paramètre `setup` (~ligne 330-334) :
```ts
      teams?: Record<string, number>;
```
Dans la transaction (~ligne 367-380), après le `createMany` des participants et avant/après le `reservation.update`, appliquer les équipes si fournies. Comme les participants viennent d'être recréés, on les met à jour par `userId` :
```ts
    return prisma.$transaction(async (tx) => {
      await tx.reservationParticipant.deleteMany({ where: { reservationId } });
      await tx.reservationParticipant.createMany({
        data: this.participantRows(reservationId, userId, partners, priceCents),
      });
      if (setup.teams && Object.keys(setup.teams).length > 0) {
        const format2 = (reservation.resource.attributes as { format?: string } | null)?.format;
        await applyTeams(tx, reservationId, setup.teams, playerCount(format2));
      }
      return tx.reservation.update({ /* inchangé */ });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
```
(`applyTeams` et `playerCount` déjà importés dans ce fichier depuis les tâches précédentes.)

- [ ] **Step 4: Lancer pour vérifier le succès**

Run: `cd backend && npx jest src/services/__tests__/reservation.service.test.ts -t "persiste les équipes fournies"`
Expected: PASS.

- [ ] **Step 5: Type API frontend**

Dans `frontend/lib/api.ts`, `applyHoldSetup` (~163-176), ajouter au type `setup` :
```ts
      teams?: Record<string, 1 | 2>;
```

- [ ] **Step 6: BookingModal — arranger les équipes des partenaires sélectionnés**

Dans `frontend/components/BookingModal.tsx` (zone de sélection des partenaires, ~466-489, et l'appel `persistHoldSetup`/`applyHoldSetup`) :
- Maintenir un état local `teamsDraft: Record<string, 1 | 2>` (clé userId, organisateur = 1 par défaut ; chaque partenaire ajouté prend le 1er côté libre).
- Afficher `MatchTeams` (editable) sur la composition courante (organisateur + `partners`) avec `onSetTeams={setTeamsDraft}` pour le tap-swap.
- Dans l'appel `applyHoldSetup`, passer `teams: teamsDraft`.

Détail d'implémentation (adapter aux noms exacts du composant) :
```tsx
import { MatchTeams } from '@/components/match/MatchTeams';
// état
const [teamsDraft, setTeamsDraft] = useState<Record<string, 1 | 2>>({});
// helper : côté libre pour un nouvel ajout
const nextSide = (draft: Record<string, 1 | 2>): 1 | 2 => {
  const half = Math.max(1, Math.floor(capacity / 2));
  const c1 = Object.values(draft).filter((t) => t === 1).length;
  return c1 < half ? 1 : 2;
};
// à l'ajout d'un partenaire : setTeamsDraft((d) => ({ ...d, [member.id]: nextSide(d) }))
// au retrait : retirer la clé
// organisateur : s'assurer que teamsDraft[viewerUserId] = 1 par défaut
// rendu (padel + ≥1 partenaire) : <MatchTeams players={compositionCourante} capacity={capacity} editable onSetTeams={setTeamsDraft} size="sm" />
// appel : api.applyHoldSetup(reservationId, token, { partnerUserIds, visibility, targetLevelMin, targetLevelMax, teams: teamsDraft })
```

- [ ] **Step 7: Tests BookingModal**

Dans `frontend/__tests__/BookingModal.test.tsx` (ou la suite du chemin applyHoldSetup), vérifier que `api.applyHoldSetup` est appelé avec un objet contenant `teams`. Vérifier au préalable que le mock `lib/api` expose déjà `applyHoldSetup` (oui) — pas de nouvelle méthode à mocker. Lancer **en isolation** (flake connu en run complet) :

Run: `cd frontend && npx jest __tests__/BookingModal.test.tsx`
Expected: PASS (en isolation).

- [ ] **Step 8: Vérifier compilation**

Run: `cd frontend && npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 9: Commit**

```bash
git add backend/src/services/reservation.service.ts backend/src/services/__tests__/reservation.service.test.ts frontend/lib/api.ts frontend/components/BookingModal.tsx frontend/__tests__/BookingModal.test.tsx
git commit -m "feat(match): assign teams at creation via BookingModal"
```

---

## Phase 4 — Saisie du résultat pré-remplie

### Task 12: `MatchResultModal` pré-rempli depuis les équipes assignées

**Files:**
- Modify: `frontend/components/match/MatchResultModal.tsx` (props + init state)
- Modify: `frontend/components/openmatch/OpenMatches.tsx` (passe `initialTeams`)
- Test: `frontend/__tests__/MatchResultModal.test.tsx` (ou suite existante)

- [ ] **Step 1: Test — le modal pré-sélectionne les équipes fournies**

Dans la suite de test de `MatchResultModal` (créer `frontend/__tests__/MatchResultModal.test.tsx` si absente), ajouter :
```tsx
  it('pré-sélectionne les équipes depuis initialTeams', () => {
    render(<ThemeProvider><MatchResultModal
      reservationId="r1" token="t" onClose={() => {}} onSaved={() => {}}
      players={[
        { userId: 'a', firstName: 'A', lastName: 'A', avatarUrl: null },
        { userId: 'b', firstName: 'B', lastName: 'B', avatarUrl: null },
        { userId: 'c', firstName: 'C', lastName: 'C', avatarUrl: null },
        { userId: 'd', firstName: 'D', lastName: 'D', avatarUrl: null },
      ]}
      initialTeams={{ a: 1, b: 1, c: 2, d: 2 }}
    /></ThemeProvider>);
    // Le bouton Éq.1 du joueur 'a' est actif (style de fond ≠ surface2) — vérifier via aria/pressed
    expect(screen.getByTestId('team1-a')).toHaveAttribute('data-active', 'true');
  });
```
(Adapter : ajouter `data-active={active ? 'true' : 'false'}` aux boutons d'équipe dans le composant à l'étape suivante, pour un test stable.)

- [ ] **Step 2: Lancer pour vérifier l’échec**

Run: `cd frontend && npx jest __tests__/MatchResultModal.test.tsx`
Expected: FAIL — prop `initialTeams` inconnue / pas d'attribut `data-active`.

- [ ] **Step 3: Implémenter la prop `initialTeams` + init du state**

Dans `frontend/components/match/MatchResultModal.tsx` :
- Ajouter à `Props` : `initialTeams?: Record<string, 1 | 2>;`
- Initialiser le state avec :
```tsx
const [team, setTeam] = useState<Record<string, 1 | 2 | undefined>>(() => ({ ...(initialTeams ?? {}) }));
```
- Sur le bouton d'équipe (~ligne 101), ajouter `data-active={active ? 'true' : 'false'}`.

- [ ] **Step 4: Lancer pour vérifier le succès**

Run: `cd frontend && npx jest __tests__/MatchResultModal.test.tsx`
Expected: PASS.

- [ ] **Step 5: Passer `initialTeams` depuis `OpenMatches`**

Dans `frontend/components/openmatch/OpenMatches.tsx`, au montage de `<MatchResultModal>` (~244-252), ajouter :
```tsx
          initialTeams={Object.fromEntries(recordingFor.players.filter((p) => p.team === 1 || p.team === 2).map((p) => [p.userId, p.team as 1 | 2]))}
```

- [ ] **Step 6: Vérifier compilation + suites**

Run: `cd frontend && npx tsc --noEmit && npx jest __tests__/MatchResultModal.test.tsx`
Expected: TS OK + PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/match/MatchResultModal.tsx frontend/components/openmatch/OpenMatches.tsx frontend/__tests__/MatchResultModal.test.tsx
git commit -m "feat(match): prefill result entry from assigned teams"
```

---

## Vérification finale (après toutes les tâches)

- [ ] **Backend complet**

Run: `cd backend && npx tsc --noEmit && npx jest src/services/__tests__/matchTeams.test.ts src/services/__tests__/openMatch.service.test.ts src/services/__tests__/reservation.service.test.ts`
Expected: PASS.

- [ ] **Frontend ciblé** (éviter le run complet — flake BookingModal connu)

Run: `cd frontend && npx tsc --noEmit && npx jest __tests__/MatchTeams.test.tsx __tests__/OpenMatchCard.test.tsx __tests__/MatchResultModal.test.tsx`
Expected: PASS.

- [ ] **Documentation** — Ajouter une section « Équipes gauche/droite (matchs padel) » à `CLAUDE.md` résumant : colonne `team` nullable dérivée à la lecture (`effectiveTeams`), composant partagé `MatchTeams`, endpoints `setTeams` (organisateur/propriétaire) + `applyHoldSetup.teams`, pré-remplissage résultat, padel-only, admin inchangé. Committer.

---

## Notes d'implémentation transverses

- **Padel-only** : chaque surface frontend garde `PlayerPills` en branche `else` pour les sports non-padel ; le backend renvoie `team: null` hors padel.
- **Optimisme** : les endpoints `setTeams` renvoient l'état ; le front recharge via `onChanged`/`act` existants — pas d'optimisme réseau nécessaire dans MatchTeams (le tap-swap met à jour via `onSetTeams` → reload).
- **Concurrence** : `applyTeams` valide l'assignation complète dans une transaction Serializable, jamais d'état intermédiaire invalide.
- **Aucune notification** n'est émise sur un changement d'équipe (réarrangement interne).
- **Mocks de tests** : toute suite montant `OpenMatches`, `OpenMatchCard`, `ReservationPlayersInline` ou `BookingModal` doit exposer les nouvelles méthodes `api.*` (`setOpenMatchTeams`, `setReservationTeams`) ; `applyHoldSetup` existe déjà.
