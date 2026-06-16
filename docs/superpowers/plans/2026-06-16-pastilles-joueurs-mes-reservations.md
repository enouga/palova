# Pastilles de joueurs uniformes — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Afficher les joueurs en pastilles colorées (avatar + couleur par joueur + cases « Place libre ») façon page Parties, sur les cartes de réservation de « Mes réservations » (DayPanel + MyAgendaListItem) et dans la pop-up « Joueurs ».

**Architecture:** Extraire un composant présentiel partagé `PlayerPills` (source de vérité du look, repris tel quel d'`OpenMatches`), enrichir 2 payloads backend de manière additive (`participants`+`capacity` sur `/api/me/reservations`, `avatarUrl` sur les joueurs de résa), puis consommer `PlayerPills` dans `OpenMatches` (refacto), `DayPanel`, `MyAgendaListItem` et `ManagePlayersModal`.

**Tech Stack:** Backend Express 5 + Prisma 7 (tests Jest, Prisma mocké, sans Docker). Frontend Next.js 16 + React 19 (tests Jest + React Testing Library).

**Spec:** `docs/superpowers/specs/2026-06-16-pastilles-joueurs-mes-reservations-design.md`

**Worktree:** `C:/Users/e.nougayrede/palova-wt-player-pills` (branche `feat/player-pills`). Baseline vert : 505 back + 397 front.

**Convention de commandes (Git Bash) :**
- Backend tests : `cd /c/Users/e.nougayrede/palova-wt-player-pills/backend && npm test`
- Frontend tests : `cd /c/Users/e.nougayrede/palova-wt-player-pills/frontend && npm test`
- Un seul fichier : `npm test -- <chemin>` (jest).

---

## File Structure

**Backend :**
- Modifier `backend/src/services/reservation.service.ts` :
  - `mapOwnPlayers` + select de `getOwnReservationPlayers` → ajouter `avatarUrl` (Task 1).
  - `listUserReservations` → mapper `participants[]` + `capacity` (Task 2).
- Modifier `backend/src/services/__tests__/reservation.service.test.ts` (Tasks 1 & 2).

**Frontend :**
- Modifier `frontend/lib/api.ts` → types `MyReservation` (+participants/capacity) et `ReservationPlayer` (+avatarUrl) (Task 3).
- Créer `frontend/components/player/PlayerPills.tsx` (Task 4).
- Créer `frontend/__tests__/PlayerPills.test.tsx` (Task 4).
- Modifier `frontend/components/openmatch/OpenMatches.tsx` (Task 5).
- Modifier `frontend/components/calendar/DayPanel.tsx` + `frontend/components/calendar/MyAgendaListItem.tsx` (Task 6).
- Créer `frontend/__tests__/DayPanel.test.tsx` (Task 6).
- Modifier `frontend/components/reservations/ManagePlayersModal.tsx` (Task 7).

Aucune migration (données déjà en base).

---

### Task 1 : Backend — `avatarUrl` dans les joueurs de réservation (pop-up)

**Files:**
- Modify: `backend/src/services/reservation.service.ts` (`mapOwnPlayers` ~888-903 ; select de `getOwnReservationPlayers` ~911-914)
- Test: `backend/src/services/__tests__/reservation.service.test.ts` (describe `getOwnReservationPlayers` ~1259)

- [ ] **Step 1 : Écrire le test qui échoue**

Dans le bloc `describe('getOwnReservationPlayers', …)`, remplacer le premier `it(...)` (« renvoie capacité + joueurs pour le propriétaire ») par :

```ts
    it('renvoie capacité + joueurs (avec avatarUrl) pour le propriétaire', async () => {
      prismaMock.reservation.findUnique.mockResolvedValue({
        id: 'res-1', userId: 'user-1',
        resource: { attributes: { format: 'double' } },
        participants: [
          { id: 'p1', userId: 'user-1', isOrganizer: true,  share: 25, user: { firstName: 'Eric', lastName: 'N', avatarUrl: '/uploads/avatars/eric.png' } },
          { id: 'p2', userId: 'user-2', isOrganizer: false, share: 0,  user: { firstName: 'Sam',  lastName: 'P', avatarUrl: null } },
        ],
      } as any);

      const out = await service.getOwnReservationPlayers('res-1', 'user-1');

      expect(out.capacity).toBe(4);
      expect(out.participants).toHaveLength(2);
      expect(out.participants[0]).toMatchObject({ id: 'p1', isOrganizer: true, firstName: 'Eric', share: '25.00', avatarUrl: '/uploads/avatars/eric.png' });
      expect(out.participants[1].avatarUrl).toBeNull();
    });
```

- [ ] **Step 2 : Lancer le test, vérifier l'échec**

Run: `cd /c/Users/e.nougayrede/palova-wt-player-pills/backend && npm test -- reservation.service.test.ts -t "avatarUrl"`
Expected: FAIL — `out.participants[0]` n'a pas `avatarUrl` (undefined ≠ chaîne attendue).

- [ ] **Step 3 : Implémenter**

Dans `mapOwnPlayers`, étendre le type du paramètre `participants` (le `user`) et le mapping :

```ts
  private mapOwnPlayers(r: {
    id: string;
    resource: { attributes: Prisma.JsonValue };
    participants: Array<{ id: string; userId: string; isOrganizer: boolean; share: Prisma.Decimal; user: { firstName: string; lastName: string; avatarUrl: string | null } }>;
  }) {
    const format = (r.resource.attributes as { format?: string } | null)?.format;
    return {
      id: r.id,
      capacity: playerCount(format),
      participants: r.participants.map((p) => ({
        id: p.id, userId: p.userId, isOrganizer: p.isOrganizer,
        firstName: p.user.firstName, lastName: p.user.lastName,
        avatarUrl: p.user.avatarUrl,
        share: Number(p.share).toFixed(2),
      })),
    };
  }
```

Dans le `select` du `user` de `getOwnReservationPlayers`, ajouter `avatarUrl: true` :

```ts
          select: { id: true, userId: true, isOrganizer: true, share: true, user: { select: { firstName: true, lastName: true, avatarUrl: true } } },
```

- [ ] **Step 4 : Lancer le test, vérifier le succès**

Run: `cd /c/Users/e.nougayrede/palova-wt-player-pills/backend && npm test -- reservation.service.test.ts`
Expected: PASS (tout le fichier vert).

- [ ] **Step 5 : Commit**

```bash
cd /c/Users/e.nougayrede/palova-wt-player-pills
git add backend/src/services/reservation.service.ts backend/src/services/__tests__/reservation.service.test.ts
git commit -m "feat(back): avatarUrl dans les joueurs de réservation (pop-up)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2 : Backend — `participants` + `capacity` sur `/api/me/reservations`

**Files:**
- Modify: `backend/src/services/reservation.service.ts` (`listUserReservations` ~962-970)
- Test: `backend/src/services/__tests__/reservation.service.test.ts` (nouveau describe)

- [ ] **Step 1 : Écrire le test qui échoue**

Ajouter, juste après le bloc `describe('getOwnReservationPlayers', …)` (avant sa parenthèse fermante du `describe('ReservationService'…)`), un nouveau bloc :

```ts
  describe('listUserReservations', () => {
    it('mappe participants (avec avatarUrl) + capacity et n expose pas attributes', async () => {
      prismaMock.reservation.findMany.mockResolvedValue([
        {
          id: 'res-1', startTime: new Date('2026-06-16T15:00:00Z'), endTime: new Date('2026-06-16T16:30:00Z'),
          status: 'CONFIRMED', totalPrice: 25, userId: 'user-1', resourceId: 'court-1', type: 'COURT',
          resource: {
            id: 'court-1', name: 'Terrain 2', attributes: { format: 'double' },
            club: { name: 'Bordeaux Pala', slug: 'bordeaux-pala', timezone: 'Europe/Paris', playerChangeCutoffHours: null, cancellationCutoffHours: null },
          },
          participants: [
            { id: 'p1', userId: 'user-1', isOrganizer: true,  user: { firstName: 'Eric', lastName: 'N', avatarUrl: '/uploads/avatars/eric.png' } },
            { id: 'p2', userId: 'user-2', isOrganizer: false, user: { firstName: 'Sam',  lastName: 'P', avatarUrl: null } },
          ],
        },
      ] as any);

      const out = await service.listUserReservations('user-1');

      expect(out).toHaveLength(1);
      expect(out[0].capacity).toBe(4);
      expect(out[0].participants).toEqual([
        { id: 'p1', userId: 'user-1', isOrganizer: true,  firstName: 'Eric', lastName: 'N', avatarUrl: '/uploads/avatars/eric.png' },
        { id: 'p2', userId: 'user-2', isOrganizer: false, firstName: 'Sam',  lastName: 'P', avatarUrl: null },
      ]);
      expect(out[0].resource.name).toBe('Terrain 2');
      expect((out[0].resource as any).attributes).toBeUndefined();
    });
  });
```

- [ ] **Step 2 : Lancer le test, vérifier l'échec**

Run: `cd /c/Users/e.nougayrede/palova-wt-player-pills/backend && npm test -- reservation.service.test.ts -t "mappe participants"`
Expected: FAIL — `out[0].capacity`/`participants` indéfinis (la méthode renvoie l'objet brut Prisma sans mapping).

- [ ] **Step 3 : Implémenter**

Remplacer `listUserReservations` par :

```ts
  async listUserReservations(userId: string) {
    const rows = await prisma.reservation.findMany({
      where: { userId },
      orderBy: { startTime: 'desc' },
      include: {
        resource: { select: { id: true, name: true, attributes: true, club: { select: { name: true, slug: true, timezone: true, playerChangeCutoffHours: true, cancellationCutoffHours: true } } } },
        participants: {
          orderBy: { joinedAt: 'asc' },
          select: { id: true, userId: true, isOrganizer: true, user: { select: { firstName: true, lastName: true, avatarUrl: true } } },
        },
      },
    });
    return rows.map(({ participants, resource, ...rest }) => {
      const { attributes, ...resourcePublic } = resource;
      return {
        ...rest,
        resource: resourcePublic,
        capacity: playerCount((attributes as { format?: string } | null)?.format),
        participants: participants.map((p) => ({
          id: p.id, userId: p.userId, isOrganizer: p.isOrganizer,
          firstName: p.user.firstName, lastName: p.user.lastName, avatarUrl: p.user.avatarUrl,
        })),
      };
    });
  }
```

(`playerCount` est déjà importé dans ce fichier — utilisé par `mapOwnPlayers`.)

- [ ] **Step 4 : Lancer la suite backend, vérifier le succès**

Run: `cd /c/Users/e.nougayrede/palova-wt-player-pills/backend && npm test`
Expected: PASS (505 + 1 nouveau test).

- [ ] **Step 5 : Commit**

```bash
cd /c/Users/e.nougayrede/palova-wt-player-pills
git add backend/src/services/reservation.service.ts backend/src/services/__tests__/reservation.service.test.ts
git commit -m "feat(back): participants + capacity sur /api/me/reservations

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3 : Frontend — types `MyReservation` et `ReservationPlayer`

**Files:**
- Modify: `frontend/lib/api.ts` (`MyReservation` ~506-513 ; `ReservationPlayer` ~515-522)

- [ ] **Step 1 : Implémenter (changement de type, pas de test dédié)**

Dans `MyReservation`, ajouter les deux champs (après `resource: …`) :

```ts
export interface MyReservation {
  id: string;
  startTime: string;
  endTime: string;
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED';
  totalPrice: string;
  resource: { id: string; name: string; club: { name: string; slug: string; timezone: string; playerChangeCutoffHours?: number; cancellationCutoffHours?: number } };
  capacity: number;
  participants: { id: string; userId: string; isOrganizer: boolean; firstName: string; lastName: string; avatarUrl: string | null }[];
}
```

Dans `ReservationPlayer`, ajouter `avatarUrl` :

```ts
export interface ReservationPlayer {
  id: string;
  userId: string;
  isOrganizer: boolean;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  share: string;
}
```

- [ ] **Step 2 : Vérifier la compilation des types**

Run: `cd /c/Users/e.nougayrede/palova-wt-player-pills/frontend && npx tsc --noEmit`
Expected: PASS (les consommateurs actuels ne lisent pas ces champs ; les fixtures de test castent `as never`).

- [ ] **Step 3 : Commit**

```bash
cd /c/Users/e.nougayrede/palova-wt-player-pills
git add frontend/lib/api.ts
git commit -m "feat(front): types MyReservation (participants/capacity) + ReservationPlayer (avatarUrl)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4 : Frontend — composant `PlayerPills` + test

**Files:**
- Create: `frontend/components/player/PlayerPills.tsx`
- Test: `frontend/__tests__/PlayerPills.test.tsx`

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `frontend/__tests__/PlayerPills.test.tsx` :

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { PlayerPills, PlayerPillData } from '../components/player/PlayerPills';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('../lib/api', () => ({ assetUrl: (p: string | null) => p }));

const players: PlayerPillData[] = [
  { userId: 'u-org',  firstName: 'Org',  lastName: 'A',       avatarUrl: null, isOrganizer: true,  participantId: 'p1' },
  { userId: 'u-emma', firstName: 'Emma', lastName: 'Bernard', avatarUrl: null, isOrganizer: false, participantId: 'p2' },
];
const wrap = (ui: React.ReactNode) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('PlayerPills', () => {
  it('affiche les joueurs, le badge orga et les cases « Place libre »', () => {
    wrap(<PlayerPills players={players} spotsLeft={2} />);
    expect(screen.getByText('Org A')).toBeInTheDocument();
    expect(screen.getByText('Emma Bernard')).toBeInTheDocument();
    expect(screen.getByText('orga')).toBeInTheDocument();
    expect(screen.getAllByText('Place libre')).toHaveLength(2);
  });

  it('n affiche aucun × sans onRemove', () => {
    wrap(<PlayerPills players={players} />);
    expect(screen.queryByLabelText('Retirer Emma Bernard')).not.toBeInTheDocument();
  });

  it('affiche le × uniquement pour les joueurs retirables et appelle onRemove', () => {
    const onRemove = jest.fn();
    wrap(<PlayerPills players={players} onRemove={onRemove} canRemove={(p) => !p.isOrganizer} />);
    expect(screen.queryByLabelText('Retirer Org A')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Retirer Emma Bernard'));
    expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ participantId: 'p2', userId: 'u-emma' }));
  });

  it('désactive le × quand busy', () => {
    wrap(<PlayerPills players={players} onRemove={jest.fn()} canRemove={() => true} busy />);
    expect(screen.getByLabelText('Retirer Emma Bernard')).toBeDisabled();
  });
});
```

- [ ] **Step 2 : Lancer le test, vérifier l'échec**

Run: `cd /c/Users/e.nougayrede/palova-wt-player-pills/frontend && npm test -- PlayerPills.test.tsx`
Expected: FAIL — module `../components/player/PlayerPills` introuvable.

- [ ] **Step 3 : Implémenter le composant**

Créer `frontend/components/player/PlayerPills.tsx` :

```tsx
'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';

export interface PlayerPillData {
  userId: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
  isOrganizer?: boolean;
  participantId?: string;
}

// Rangée de pastilles de joueurs façon Parties ouvertes : avatar coloré (couleur par userId),
// badge « orga », × de retrait optionnel, puis N cases « Place libre » en pointillés.
export function PlayerPills({
  players, spotsLeft = 0, onRemove, canRemove, busy = false, size = 'md', showOrgaBadge = true,
}: {
  players: PlayerPillData[];
  spotsLeft?: number;
  onRemove?: (player: PlayerPillData) => void;
  canRemove?: (player: PlayerPillData) => boolean;
  busy?: boolean;
  size?: 'sm' | 'md';
  showOrgaBadge?: boolean;
}) {
  const { th } = useTheme();
  const av = size === 'sm' ? 20 : 22;
  const fs = size === 'sm' ? 12.5 : 13;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {players.map((p) => {
        const c = colorForSeed(p.userId);
        const removable = !!onRemove && (canRemove ? canRemove(p) : true);
        return (
          <span key={p.userId} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: `${c}22`, border: `1px solid ${c}`,
            borderRadius: 999, padding: '4px 11px 4px 4px',
            fontFamily: th.fontUI, fontSize: fs, fontWeight: 600, color: th.text,
          }}>
            <Avatar firstName={p.firstName} lastName={p.lastName} avatarUrl={p.avatarUrl ?? null} size={av} color={c} />
            {p.firstName} {p.lastName}
            {showOrgaBadge && p.isOrganizer && (
              <span style={{ fontSize: 10, fontWeight: 700, color: th.textMute, textTransform: 'uppercase', letterSpacing: 0.3 }}>orga</span>
            )}
            {removable && (
              <button type="button" disabled={busy} aria-label={`Retirer ${p.firstName} ${p.lastName}`} title="Retirer ce joueur"
                onClick={() => onRemove!(p)}
                style={{ border: 'none', background: 'transparent', cursor: busy ? 'default' : 'pointer', color: th.textMute, fontSize: 15, lineHeight: 1, padding: 0, marginLeft: 2 }}>×</button>
            )}
          </span>
        );
      })}
      {Array.from({ length: Math.max(0, spotsLeft) }).map((_, i) => (
        <span key={`e${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 999, padding: '4px 12px 4px 4px', border: `1.5px dashed ${th.lineStrong}`, fontFamily: th.fontUI, fontSize: 12.5, color: th.textFaint }}>
          <span aria-hidden="true" style={{ width: av, height: av, borderRadius: '50%', flexShrink: 0, border: `1.5px dashed ${th.lineStrong}` }} />
          Place libre
        </span>
      ))}
    </div>
  );
}
```

- [ ] **Step 4 : Lancer le test, vérifier le succès**

Run: `cd /c/Users/e.nougayrede/palova-wt-player-pills/frontend && npm test -- PlayerPills.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5 : Commit**

```bash
cd /c/Users/e.nougayrede/palova-wt-player-pills
git add frontend/components/player/PlayerPills.tsx frontend/__tests__/PlayerPills.test.tsx
git commit -m "feat(front): composant partagé PlayerPills (pastilles joueurs)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5 : Frontend — refacto `OpenMatches` sur `PlayerPills`

**Files:**
- Modify: `frontend/components/openmatch/OpenMatches.tsx` (imports ; bloc joueurs ~94-131)

- [ ] **Step 1 : Vérifier le baseline du test OpenMatches**

Run: `cd /c/Users/e.nougayrede/palova-wt-player-pills/frontend && npm test -- OpenMatches.test.tsx`
Expected: PASS (refacto à iso-comportement : ce test doit rester vert après).

- [ ] **Step 2 : Remplacer le bloc joueurs inline par `PlayerPills`**

Dans `OpenMatches.tsx`, remplacer tout le bloc `<div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>` … `</div>` (les joueurs + places libres + bouton d'action, ~94-131) par :

```tsx
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <PlayerPills
                      players={m.players}
                      spotsLeft={m.spotsLeft}
                      onRemove={(p) => act(m, () => api.removeOpenMatchPlayer(club.slug, m.id, p.userId, token!))}
                      canRemove={(p) => m.viewerIsOrganizer && !p.isOrganizer}
                      busy={busy}
                    />
                  </div>
                  {m.viewerIsOrganizer ? (
                    <Chip tone="line" icon="check">Vous organisez</Chip>
                  ) : m.viewerIsParticipant ? (
                    <Btn variant="surface" disabled={busy} onClick={() => act(m, () => api.leaveOpenMatch(club.slug, m.id, token!))}>Quitter</Btn>
                  ) : (
                    <Btn icon="plus" disabled={busy || m.full} onClick={() => act(m, () => api.joinOpenMatch(club.slug, m.id, token!))}>Rejoindre</Btn>
                  )}
                </div>
```

- [ ] **Step 3 : Nettoyer les imports devenus inutiles, ajouter PlayerPills**

Dans l'en-tête de `OpenMatches.tsx` : supprimer `import { Avatar } from '@/components/ui/Avatar';` et `import { colorForSeed } from '@/lib/playerColors';` (devenus inutilisés), et ajouter :

```tsx
import { PlayerPills } from '@/components/player/PlayerPills';
```

(Garder `Btn, Chip`, `Icon`, etc. : toujours utilisés.)

- [ ] **Step 4 : Lancer le test OpenMatches + typecheck**

Run: `cd /c/Users/e.nougayrede/palova-wt-player-pills/frontend && npm test -- OpenMatches.test.tsx && npx tsc --noEmit`
Expected: PASS (les 6 tests OpenMatches verts, aucune erreur de type / import inutilisé).

- [ ] **Step 5 : Commit**

```bash
cd /c/Users/e.nougayrede/palova-wt-player-pills
git add frontend/components/openmatch/OpenMatches.tsx
git commit -m "refactor(front): OpenMatches consomme PlayerPills

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6 : Frontend — pastilles sur `DayPanel` + `MyAgendaListItem` (+ test)

**Files:**
- Modify: `frontend/components/calendar/DayPanel.tsx` (import ; branche réservation ~70-101)
- Modify: `frontend/components/calendar/MyAgendaListItem.tsx` (import ; branche réservation ~58-76)
- Test: `frontend/__tests__/DayPanel.test.tsx`

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `frontend/__tests__/DayPanel.test.tsx` :

```tsx
import { render, screen } from '@testing-library/react';
import { DayPanel } from '../components/calendar/DayPanel';
import { ThemeProvider } from '../lib/ThemeProvider';

jest.mock('../lib/api', () => ({ assetUrl: (p: string | null) => p }));

const future = new Date(Date.now() + 48 * 3600e3).toISOString();
const entry = {
  kind: 'reservation', past: false,
  r: {
    id: 'res-1', startTime: future, endTime: future, status: 'CONFIRMED', totalPrice: '25',
    capacity: 4,
    participants: [
      { id: 'p1', userId: 'u-org',  firstName: 'Org',  lastName: 'A',       avatarUrl: null, isOrganizer: true },
      { id: 'p2', userId: 'u-emma', firstName: 'Emma', lastName: 'Bernard', avatarUrl: null, isOrganizer: false },
    ],
    resource: { id: 'court-1', name: 'Terrain 2', club: { name: 'Bordeaux Pala', slug: 'bordeaux-pala', timezone: 'Europe/Paris' } },
  },
};

describe('DayPanel', () => {
  it('affiche les pastilles joueurs et les places libres pour une réservation', () => {
    render(
      <ThemeProvider>
        <DayPanel dayKey="2026-06-16" entries={[entry] as never} localSlug="bordeaux-pala"
          onCancel={() => {}} onManagePlayers={() => {}} onReserve={() => {}} reserveLabel="Réserver" />
      </ThemeProvider>,
    );
    expect(screen.getByText('Terrain 2')).toBeInTheDocument();
    expect(screen.getByText('Org A')).toBeInTheDocument();
    expect(screen.getByText('Emma Bernard')).toBeInTheDocument();
    expect(screen.getAllByText('Place libre')).toHaveLength(2);
  });
});
```

- [ ] **Step 2 : Lancer le test, vérifier l'échec**

Run: `cd /c/Users/e.nougayrede/palova-wt-player-pills/frontend && npm test -- DayPanel.test.tsx`
Expected: FAIL — « Org A » / « Place libre » absents (DayPanel n'affiche pas encore les joueurs).

- [ ] **Step 3 : Ajouter les pastilles dans `DayPanel`**

Ajouter l'import en tête de `DayPanel.tsx` :

```tsx
import { PlayerPills } from '@/components/player/PlayerPills';
```

Dans la branche `if (e.kind === 'reservation')`, à l'intérieur du fragment `<>…</>`, juste **après** le `</div>` de la ligne heure/prix/boutons (celui qui ferme le `<div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, … }}>`) et **avant** le `</>`, insérer :

```tsx
                  {(r.participants?.length ?? 0) > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <PlayerPills
                        players={r.participants ?? []}
                        spotsLeft={Math.max(0, (r.capacity ?? 0) - (r.participants?.length ?? 0))}
                        size="sm"
                      />
                    </div>
                  )}
```

- [ ] **Step 4 : Ajouter les pastilles dans `MyAgendaListItem`**

Ajouter l'import en tête de `MyAgendaListItem.tsx` :

```tsx
import { PlayerPills } from '@/components/player/PlayerPills';
```

Dans la branche `if (item.kind === 'reservation')`, à l'intérieur du fragment `<>…</>`, juste **après** le `<div style={metaRow}>…</div>` et **avant** le `</>`, insérer :

```tsx
        {(r.participants?.length ?? 0) > 0 && (
          <div style={{ marginTop: 9 }}>
            <PlayerPills
              players={r.participants ?? []}
              spotsLeft={Math.max(0, (r.capacity ?? 0) - (r.participants?.length ?? 0))}
              size="sm"
            />
          </div>
        )}
```

- [ ] **Step 5 : Lancer le test + les tests « Mes réservations » existants + typecheck**

Run: `cd /c/Users/e.nougayrede/palova-wt-player-pills/frontend && npm test -- DayPanel.test.tsx MyReservationsCalendar.test.tsx MyReservationsScoping.test.tsx && npx tsc --noEmit`
Expected: PASS (nouveau test vert ; les tests existants — dont les fixtures n'ont pas `participants` — restent verts grâce au garde `?? []`).

- [ ] **Step 6 : Commit**

```bash
cd /c/Users/e.nougayrede/palova-wt-player-pills
git add frontend/components/calendar/DayPanel.tsx frontend/components/calendar/MyAgendaListItem.tsx frontend/__tests__/DayPanel.test.tsx
git commit -m "feat(front): pastilles joueurs sur les cartes Mes réservations (DayPanel + liste)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7 : Frontend — pop-up `ManagePlayersModal` sur `PlayerPills`

**Files:**
- Modify: `frontend/components/reservations/ManagePlayersModal.tsx` (import ; suppression `rowStyle`/`organizer`/`others` ; bloc liste ~84-98)

- [ ] **Step 1 : Implémenter**

Ajouter l'import en tête :

```tsx
import { PlayerPills } from '@/components/player/PlayerPills';
```

Supprimer les variables devenues inutiles : la ligne `const organizer = participants.find((p) => p.isOrganizer);`, la ligne `const others = participants.filter((p) => !p.isOrganizer);`, et la constante `rowStyle` (le bloc `const rowStyle: React.CSSProperties = { … };`). Conserver `participants`, `capacity`, `full`, `excludeIds`.

Remplacer le contenu de la branche `) : (` du `loading ? … : (` — c'est-à-dire le `<div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>` qui contient `organizer`, `others.map(...)` et le bloc add — par :

```tsx
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <PlayerPills
              players={participants.map((p) => ({
                userId: p.userId, firstName: p.firstName, lastName: p.lastName,
                avatarUrl: p.avatarUrl, isOrganizer: p.isOrganizer, participantId: p.id,
              }))}
              spotsLeft={Math.max(0, capacity - participants.length)}
              onRemove={(p) => remove(p.participantId!)}
              canRemove={(p) => canEdit && !p.isOrganizer}
              busy={busy}
            />

            {!canEdit ? (
              <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>
                La modification des joueurs est fermée pour cette réservation.
              </div>
            ) : full ? (
              <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>La partie est complète.</div>
            ) : (
              <div>
                <span style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.textMute, display: 'block', marginBottom: 7 }}>Ajouter un joueur</span>
                <PartnerSearch
                  slug={reservation.resource.club.slug}
                  token={token}
                  selected={null}
                  onSelect={(m) => add(m.id)}
                  onClear={() => {}}
                  disabled={busy}
                  excludeIds={excludeIds}
                  keepOpenOnSelect
                />
              </div>
            )}
          </div>
```

- [ ] **Step 2 : Typecheck + suite frontend complète**

Run: `cd /c/Users/e.nougayrede/palova-wt-player-pills/frontend && npx tsc --noEmit && npm test`
Expected: PASS (aucune variable inutilisée ; toute la suite frontend verte, nouveaux tests inclus).

- [ ] **Step 3 : Commit**

```bash
cd /c/Users/e.nougayrede/palova-wt-player-pills
git add frontend/components/reservations/ManagePlayersModal.tsx
git commit -m "feat(front): pop-up Joueurs en pastilles PlayerPills

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8 : Vérification finale (gate)

**Files:** aucun (vérification).

- [ ] **Step 1 : Suite backend complète**

Run: `cd /c/Users/e.nougayrede/palova-wt-player-pills/backend && npm test`
Expected: PASS (507 tests : 505 baseline + 2 ajoutés).

- [ ] **Step 2 : Typecheck backend**

Run: `cd /c/Users/e.nougayrede/palova-wt-player-pills/backend && npx tsc --noEmit`
Expected: PASS (0 erreur).

- [ ] **Step 3 : Suite frontend complète + typecheck**

Run: `cd /c/Users/e.nougayrede/palova-wt-player-pills/frontend && npm test && npx tsc --noEmit`
Expected: PASS (402 tests : 397 baseline + 5 ajoutés ; 0 erreur de type).

- [ ] **Step 4 : Revue de code**

Invoquer `superpowers:requesting-code-review` sur le diff de la branche, traiter les retours.

- [ ] **Step 5 : Finalisation**

Invoquer `superpowers:finishing-a-development-branch` pour décider de l'intégration (merge/PR), en tenant compte de la divergence `main` ↔ `origin/main` (à réconcilier séparément avec l'utilisateur).

---

## Self-Review (auteur du plan)

**Couverture spec :**
- PlayerPills (composant + API) → Task 4. ✅
- Backend `participants`+`capacity` sur `/me/reservations` → Task 2. ✅
- Backend `avatarUrl` joueurs de résa (pop-up) → Task 1. ✅
- Types front → Task 3. ✅
- Cartes DayPanel + MyAgendaListItem (lecture seule) → Task 6. ✅
- Pop-up ManagePlayersModal → Task 7. ✅
- Refacto OpenMatches → Task 5. ✅
- Tests : PlayerPills.test (Task 4), DayPanel.test (Task 6), OpenMatches.test vérifié (Task 5), back me/reservations + avatarUrl (Tasks 1-2). ✅
- Pas de migration. ✅

**Cohérence des types :** `PlayerPillData` (userId requis, participantId optionnel) défini Task 4, consommé Tasks 5/6/7 ; `onRemove(player)` reçoit le joueur entier (OpenMatches lit `p.userId`, ManagePlayersModal lit `p.participantId`). `MyReservation.participants`/`capacity` (Task 3) consommés Task 6 ; `ReservationPlayer.avatarUrl` (Task 3) produit Task 1, consommé Task 7. Cohérent.

**Placeholders :** aucun — chaque étape de code montre le code complet.
