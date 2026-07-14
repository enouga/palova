# Mes amis — hub social vivant : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refondre `/me/friends` en hub social à sections (recherche-annuaire, demandes, « Ça joue bientôt », amis enrichis, suggestions, Favoris ★, « Qui me suit »), renommer le suivi en « Favoris » partout, passer l'opt-in demandes d'ami à ON par défaut, et ajouter « Inviter à jouer » (DM pré-rempli).

**Architecture:** Backend additif — 1 migration (défaut opt-in), 1 nouveau service `SocialHubService` (agenda des amis + suggestions) avec 2 routes club-scoped, enrichissement de `FriendshipService.listFriends` (stats « joué ensemble » + niveau), reformulation de la notif `follow.new`. Frontend — `FriendsHub` réécrit en orchestrateur de 6 composants de section, helpers purs `lib/social.ts`, `openDm` gagne un `draft`, renommages Favoris dans 3 composants existants.

**Tech Stack:** Express + Prisma 7 (adapter pg), Next.js 16, React Testing Library + Jest (⚠️ shims `node_modules/.bin` cassés : lancer `node node_modules/jest/bin/jest.js` et `node node_modules/typescript/bin/tsc` directement).

**Spec:** `docs/superpowers/specs/2026-07-14-mes-amis-hub-redesign-design.md`

---

## Structure des fichiers

**Backend**
- Create: `backend/prisma/migrations/20260714120000_friend_requests_default_on/migration.sql`
- Modify: `backend/prisma/schema.prisma` (ligne 473 : `acceptsFriendRequests`)
- Create: `backend/src/services/socialHub.service.ts` (agenda amis + suggestions)
- Create: `backend/src/services/__tests__/socialHub.service.test.ts`
- Modify: `backend/src/services/friendship.service.ts` (enrichissement `listFriends`)
- Modify: `backend/src/services/__tests__/friendship.service.test.ts`
- Modify: `backend/src/routes/clubs.ts` (2 routes après le bloc « Amitiés confirmées », ~l.312)
- Create: `backend/src/routes/__tests__/social-hub.routes.test.ts`
- Modify: `backend/src/email/notifications.ts` (`notifyNewFollower`, ~l.1285)
- Modify: `backend/src/email/__tests__/notifications.follow.test.ts`

**Frontend**
- Modify: `frontend/lib/api.ts` (types + 2 méthodes, `Friend` enrichi)
- Create: `frontend/lib/social.ts` + `frontend/__tests__/social.test.ts`
- Modify: `frontend/lib/messages.ts` (`openDm` draft) + test `frontend/__tests__/openDm.test.ts` (create)
- Modify: `frontend/components/messages/MessageComposer.tsx` (`initialDraft`) + `MessageThread.tsx` + `DmWidgetHost.tsx` + `MessagesHub.tsx` + `frontend/app/me/messages/page.tsx`
- Create: `frontend/__tests__/MessageComposer.draft.test.tsx`
- Modify: `frontend/components/social/FriendsQuickRow.tsx`, `frontend/components/social/FollowButton.tsx`, `frontend/components/openmatch/OpenMatchCard.tsx` (renommages) + leurs tests
- Create: `frontend/components/social/FriendRequestsBanner.tsx`, `FriendsAgendaRail.tsx`, `FriendCard.tsx`, `SuggestionsRow.tsx`, `FavoritesRow.tsx`, `FollowersFooter.tsx` + tests
- Rewrite: `frontend/components/social/FriendsHub.tsx` + `frontend/__tests__/FriendsHub.test.tsx`
- Modify: `frontend/app/me/friends/page.tsx`

**Conventions du repo à respecter**
- Migrations : JAMAIS `prisma db push` ni `migrate dev` (dérive de la base dev) — écrire le SQL, l'appliquer via `npx prisma db execute --file …`, puis `npx prisma generate`.
- PowerShell : le cwd se réinitialise à chaque commande — préfixer chaque commande par `cd backend` ou `cd frontend` (ou utiliser Git Bash avec des chemins absolus).
- Les tests frontend ne type-checkent pas (ts-jest isolatedModules) : `tsc --noEmit` est la porte de types séparée.

---

### Task 1 : Migration — opt-in demandes d'ami à ON par défaut

**Files:**
- Create: `backend/prisma/migrations/20260714120000_friend_requests_default_on/migration.sql`
- Modify: `backend/prisma/schema.prisma:473`

- [ ] **Step 1 : Écrire le SQL de migration**

Créer `backend/prisma/migrations/20260714120000_friend_requests_default_on/migration.sql` :

```sql
-- Opt-in demandes d'ami : défaut ON + backfill (personne n'avait explicitement choisi OFF,
-- c'était le défaut — l'interrupteur du profil reste pour se retirer).
ALTER TABLE users ALTER COLUMN "accepts_friend_requests" SET DEFAULT true;
UPDATE users SET "accepts_friend_requests" = true;
```

⚠️ Vérifier le nom réel de la colonne avant d'exécuter : `schema.prisma:473` dit `@map("accepts_friend_requests")` — le SQL ci-dessus utilise ce nom mappé.

- [ ] **Step 2 : Mettre à jour le schéma Prisma**

Dans `backend/prisma/schema.prisma` ligne 473, remplacer :

```prisma
  acceptsFriendRequests Boolean @default(false) @map("accepts_friend_requests")
```

par :

```prisma
  acceptsFriendRequests Boolean @default(true) @map("accepts_friend_requests")
```

- [ ] **Step 3 : Appliquer en DEV + régénérer le client**

Run (depuis `backend/`) :
```bash
npx prisma db execute --file prisma/migrations/20260714120000_friend_requests_default_on/migration.sql
npx prisma generate
```
Expected: exécution sans erreur, client régénéré.

- [ ] **Step 4 : Vérifier que le seed ne force pas `false`**

Run (depuis la racine) :
```bash
grep -rn "acceptsFriendRequests" backend/prisma/ backend/scripts/
```
Expected: aucun résultat (le seed s'appuie sur le défaut DB). S'il y a un `acceptsFriendRequests: false` explicite, le retirer.

- [ ] **Step 5 : Lancer les tests friendship existants (non-régression)**

Run (depuis `backend/`) :
```bash
node node_modules/jest/bin/jest.js src/services/__tests__/friendship.service.test.ts
```
Expected: PASS (les tests mockent Prisma, le défaut DB ne les affecte pas ; le test « refuse si la cible n'a pas activé l'opt-in » reste valide — la garde `FRIEND_REQUESTS_DISABLED` ne change pas).

- [ ] **Step 6 : Commit**

```bash
git add backend/prisma/migrations/20260714120000_friend_requests_default_on/migration.sql backend/prisma/schema.prisma
git commit -m "feat(amis): opt-in demandes d'ami ON par defaut (migration + backfill)"
```

---

### Task 2 : Backend — `SocialHubService.friendsAgenda` (« Ça joue bientôt »)

**Files:**
- Create: `backend/src/services/socialHub.service.ts`
- Create: `backend/src/services/__tests__/socialHub.service.test.ts`

- [ ] **Step 1 : Écrire les tests (échec attendu)**

Créer `backend/src/services/__tests__/socialHub.service.test.ts` :

```typescript
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { SocialHubService } from '../socialHub.service';

jest.mock('../rating/preferredSport', () => ({ resolvePreferredSportKey: jest.fn().mockResolvedValue('padel') }));
jest.mock('../rating.service', () => ({
  RatingService: jest.fn().mockImplementation(() => ({ getLevelsForUsers: jest.fn().mockResolvedValue({}) })),
}));

const U = (id: string) => ({ id, firstName: id.toUpperCase(), lastName: 'X', avatarUrl: null });

describe('SocialHubService — friendsAgenda', () => {
  let service: SocialHubService;
  const now = new Date('2026-07-14T10:00:00Z');

  beforeEach(() => {
    service = new SocialHubService();
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
    prismaMock.friendship.findMany.mockResolvedValue([]);
    prismaMock.follow.findMany.mockResolvedValue([]);
    prismaMock.reservation.findMany.mockResolvedValue([]);
    prismaMock.tournament.findMany.mockResolvedValue([]);
    prismaMock.clubEvent.findMany.mockResolvedValue([]);
  });

  it('club inconnu ou suspendu → CLUB_NOT_FOUND', async () => {
    prismaMock.club.findUnique.mockResolvedValue(null);
    await expect(service.friendsAgenda('nope', 'u1', now)).rejects.toThrow('CLUB_NOT_FOUND');
  });

  it('cercle vide → [] sans requête agenda', async () => {
    const items = await service.friendsAgenda('demo', 'u1', now);
    expect(items).toEqual([]);
    expect(prismaMock.reservation.findMany).not.toHaveBeenCalled();
  });

  it('cercle = amis confirmés ∪ follows, sans soi-même', async () => {
    prismaMock.friendship.findMany.mockResolvedValue([{ userAId: 'u1', userBId: 'ami1' }] as any);
    prismaMock.follow.findMany.mockResolvedValue([{ followingId: 'fav1' }, { followingId: 'ami1' }] as any);
    await service.friendsAgenda('demo', 'u1', now);
    const resArgs = prismaMock.reservation.findMany.mock.calls[0][0];
    const ids = resArgs.where.participants.some.userId.in as string[];
    expect(ids.sort()).toEqual(['ami1', 'fav1']);
  });

  it('mappe les 3 sources, filtre les items sans ami du cercle, trie chrono, cap 6', async () => {
    prismaMock.follow.findMany.mockResolvedValue([{ followingId: 'fav1' }] as any);
    prismaMock.reservation.findMany.mockResolvedValue([{
      id: 'r1', startTime: new Date('2026-07-15T18:00:00Z'), endTime: new Date('2026-07-15T19:00:00Z'),
      resource: { name: 'Court 1' },
      participants: [{ userId: 'fav1', user: U('fav1') }, { userId: 'autre', user: U('autre') }],
    }] as any);
    prismaMock.tournament.findMany.mockResolvedValue([{
      id: 't1', name: 'P100 du club', startTime: new Date('2026-07-15T08:00:00Z'), endTime: null,
      registrations: [{ captain: U('fav1'), partner: U('autre') }],
    }] as any);
    prismaMock.clubEvent.findMany.mockResolvedValue([{
      id: 'e1', name: 'Mêlée', startTime: new Date('2026-07-16T08:00:00Z'), endTime: null,
      registrations: [{ user: U('autre') }], // personne du cercle → item filtré
    }] as any);

    const items = await service.friendsAgenda('demo', 'u1', now);
    expect(items.map((i) => i.kind)).toEqual(['tournament', 'match']); // chrono, event filtré
    expect(items[0].label).toBe('P100 du club');
    expect(items[1].label).toBe('Partie ouverte · Court 1');
    // seuls les joueurs du cercle apparaissent dans friends
    expect(items[1].friends.map((f) => f.id)).toEqual(['fav1']);
  });

  it('cap 4 amis par item, sans doublon', async () => {
    prismaMock.follow.findMany.mockResolvedValue(
      ['a', 'b', 'c', 'd', 'e'].map((id) => ({ followingId: id })) as any);
    prismaMock.reservation.findMany.mockResolvedValue([{
      id: 'r1', startTime: new Date('2026-07-15T18:00:00Z'), endTime: null, resource: { name: 'C1' },
      participants: ['a', 'a', 'b', 'c', 'd', 'e'].map((id) => ({ userId: id, user: U(id) })),
    }] as any);
    const items = await service.friendsAgenda('demo', 'u1', now);
    expect(items[0].friends.map((f) => f.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run (depuis `backend/`) :
```bash
node node_modules/jest/bin/jest.js src/services/__tests__/socialHub.service.test.ts
```
Expected: FAIL — `Cannot find module '../socialHub.service'`.

- [ ] **Step 3 : Implémenter le service**

Créer `backend/src/services/socialHub.service.ts` :

```typescript
import { prisma } from '../db/prisma';
import { RatingService } from './rating.service';
import { resolvePreferredSportKey } from './rating/preferredSport';
import type { UserLevel } from './rating.service';

const USER_SEL = { id: true, firstName: true, lastName: true, avatarUrl: true } as const;

export interface AgendaFriend { id: string; firstName: string; lastName: string; avatarUrl: string | null }
export interface FriendsAgendaItem {
  kind: 'match' | 'tournament' | 'event';
  id: string;
  startTime: Date;
  endTime: Date | null;
  label: string;
  friends: AgendaFriend[];
}
export interface PlayerSuggestion {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  level: UserLevel | null;
  lastPlayedAt: Date;
  playedCount: number;
  requestable: boolean;
}

const AGENDA_CAP = 6;
const AGENDA_FRIENDS_CAP = 4;
const SUGGESTIONS_CAP = 8;
const SUGGESTION_WINDOW_DAYS = 90;

/** Hub social « Mes amis » : agenda du cercle (amis ∪ favoris) + suggestions de joueurs. */
export class SocialHubService {
  private ratingService = new RatingService();

  private async activeClubId(slug: string): Promise<string> {
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, status: true } });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    return club.id;
  }

  /** Cercle social = amis confirmés ∪ favoris (follows sortants), sans soi-même. */
  private async circleIds(userId: string): Promise<string[]> {
    const [friendships, follows] = await Promise.all([
      prisma.friendship.findMany({
        where: { status: 'ACCEPTED', OR: [{ userAId: userId }, { userBId: userId }] },
        select: { userAId: true, userBId: true },
      }),
      prisma.follow.findMany({ where: { followerId: userId }, select: { followingId: true } }),
    ]);
    const ids = new Set<string>();
    for (const f of friendships) ids.add(f.userAId === userId ? f.userBId : f.userAId);
    for (const f of follows) ids.add(f.followingId);
    ids.delete(userId);
    return [...ids];
  }

  /** « Ça joue bientôt » : parties ouvertes + tournois + events à venir du club où figure mon cercle. */
  async friendsAgenda(slug: string, userId: string, now: Date = new Date()): Promise<FriendsAgendaItem[]> {
    const clubId = await this.activeClubId(slug);
    const ids = await this.circleIds(userId);
    if (ids.length === 0) return [];

    const [matches, tournaments, events] = await Promise.all([
      prisma.reservation.findMany({
        where: {
          visibility: 'PUBLIC', status: 'CONFIRMED', startTime: { gt: now },
          resource: { clubId },
          participants: { some: { userId: { in: ids } } },
        },
        orderBy: { startTime: 'asc' },
        take: AGENDA_CAP,
        select: {
          id: true, startTime: true, endTime: true,
          resource: { select: { name: true } },
          participants: { select: { userId: true, user: { select: USER_SEL } } },
        },
      }),
      prisma.tournament.findMany({
        where: {
          clubId, status: 'PUBLISHED', startTime: { gt: now },
          registrations: {
            some: { status: { not: 'CANCELLED' }, OR: [{ captainUserId: { in: ids } }, { partnerUserId: { in: ids } }] },
          },
        },
        orderBy: { startTime: 'asc' },
        take: AGENDA_CAP,
        select: {
          id: true, name: true, startTime: true, endTime: true,
          registrations: {
            where: { status: { not: 'CANCELLED' } },
            select: { captain: { select: USER_SEL }, partner: { select: USER_SEL } },
          },
        },
      }),
      prisma.clubEvent.findMany({
        where: {
          clubId, status: 'PUBLISHED', startTime: { gt: now },
          registrations: { some: { status: { not: 'CANCELLED' }, userId: { in: ids } } },
        },
        orderBy: { startTime: 'asc' },
        take: AGENDA_CAP,
        select: {
          id: true, name: true, startTime: true, endTime: true,
          registrations: { where: { status: { not: 'CANCELLED' } }, select: { user: { select: USER_SEL } } },
        },
      }),
    ]);

    const circle = new Set(ids);
    const inCircle = (users: AgendaFriend[]): AgendaFriend[] => {
      const out: AgendaFriend[] = [];
      const seen = new Set<string>();
      for (const u of users) {
        if (!circle.has(u.id) || seen.has(u.id)) continue;
        seen.add(u.id);
        out.push(u);
        if (out.length >= AGENDA_FRIENDS_CAP) break;
      }
      return out;
    };

    const items: FriendsAgendaItem[] = [
      ...matches.map((m) => ({
        kind: 'match' as const, id: m.id, startTime: m.startTime, endTime: m.endTime,
        label: `Partie ouverte · ${m.resource.name}`,
        friends: inCircle(m.participants.map((p) => p.user)),
      })),
      ...tournaments.map((t) => ({
        kind: 'tournament' as const, id: t.id, startTime: t.startTime, endTime: t.endTime,
        label: t.name,
        friends: inCircle(t.registrations.flatMap((r) => [r.captain, r.partner])),
      })),
      ...events.map((e) => ({
        kind: 'event' as const, id: e.id, startTime: e.startTime, endTime: e.endTime,
        label: e.name,
        friends: inCircle(e.registrations.map((r) => r.user)),
      })),
    ].filter((i) => i.friends.length > 0);

    items.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
    return items.slice(0, AGENDA_CAP);
  }

  /** Suggestions « vous avez joué ensemble » : partenaires récents pas encore dans mon cercle. */
  async playerSuggestions(slug: string, userId: string, now: Date = new Date()): Promise<PlayerSuggestion[]> {
    const clubId = await this.activeClubId(slug);
    const since = new Date(now.getTime() - SUGGESTION_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const myReservations = await prisma.reservation.findMany({
      where: {
        status: 'CONFIRMED', startTime: { gte: since, lt: now },
        resource: { clubId },
        OR: [{ userId }, { participants: { some: { userId } } }],
      },
      orderBy: { startTime: 'desc' },
      take: 200,
      select: { userId: true, startTime: true, participants: { select: { userId: true } } },
    });

    // Agrège les co-joueurs : dernier match partagé + nombre de matchs partagés.
    const byPlayer = new Map<string, { lastPlayedAt: Date; playedCount: number }>();
    for (const r of myReservations) {
      const others = new Set<string>();
      if (r.userId && r.userId !== userId) others.add(r.userId);
      for (const p of r.participants) if (p.userId !== userId) others.add(p.userId);
      for (const other of others) {
        const cur = byPlayer.get(other);
        if (cur) {
          cur.playedCount += 1;
          if (r.startTime > cur.lastPlayedAt) cur.lastPlayedAt = r.startTime;
        } else {
          byPlayer.set(other, { lastPlayedAt: r.startTime, playedCount: 1 });
        }
      }
    }
    const candidates = [...byPlayer.keys()];
    if (candidates.length === 0) return [];

    // Exclusions : déjà suivi (favori) OU toute relation d'amitié (PENDING comme ACCEPTED).
    const [follows, friendships] = await Promise.all([
      prisma.follow.findMany({
        where: { followerId: userId, followingId: { in: candidates } },
        select: { followingId: true },
      }),
      prisma.friendship.findMany({
        where: { OR: [{ userAId: userId, userBId: { in: candidates } }, { userBId: userId, userAId: { in: candidates } }] },
        select: { userAId: true, userBId: true },
      }),
    ]);
    const excluded = new Set<string>(follows.map((f) => f.followingId));
    for (const f of friendships) excluded.add(f.userAId === userId ? f.userBId : f.userAId);

    const keptIds = candidates.filter((id) => !excluded.has(id));
    if (keptIds.length === 0) return [];

    const users = await prisma.user.findMany({
      where: { id: { in: keptIds }, deletedAt: null, isSuperAdmin: false },
      select: { ...USER_SEL, acceptsFriendRequests: true },
    });
    const sportKey = await resolvePreferredSportKey(userId);
    const levels = await this.ratingService.getLevelsForUsers(users.map((u) => u.id), sportKey);

    return users
      .map((u) => ({
        id: u.id, firstName: u.firstName, lastName: u.lastName, avatarUrl: u.avatarUrl,
        level: levels[u.id] ?? null,
        requestable: u.acceptsFriendRequests,
        ...byPlayer.get(u.id)!,
      }))
      .sort((a, b) => b.lastPlayedAt.getTime() - a.lastPlayedAt.getTime())
      .slice(0, SUGGESTIONS_CAP);
  }
}
```

⚠️ Si `getLevelsForUsers` ne renvoie pas un Record indexé par id, s'aligner sur la consommation de `listClubFriends` (`backend/src/services/follow.service.ts:152-159`) — c'est la référence.

- [ ] **Step 4 : Vérifier que les tests agenda passent**

Run (depuis `backend/`) :
```bash
node node_modules/jest/bin/jest.js src/services/__tests__/socialHub.service.test.ts
```
Expected: PASS (5 tests).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/socialHub.service.ts backend/src/services/__tests__/socialHub.service.test.ts
git commit -m "feat(amis): SocialHubService.friendsAgenda — ca joue bientot chez mon cercle"
```

---

### Task 3 : Backend — `SocialHubService.playerSuggestions` (tests)

Le code de `playerSuggestions` est déjà écrit en Task 2 (même fichier). Cette tâche ajoute ses tests.

**Files:**
- Modify: `backend/src/services/__tests__/socialHub.service.test.ts`

- [ ] **Step 1 : Ajouter le bloc de tests suggestions**

Ajouter à la fin de `socialHub.service.test.ts` :

```typescript
describe('SocialHubService — playerSuggestions', () => {
  let service: SocialHubService;
  const now = new Date('2026-07-14T10:00:00Z');

  beforeEach(() => {
    service = new SocialHubService();
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
    prismaMock.follow.findMany.mockResolvedValue([]);
    prismaMock.friendship.findMany.mockResolvedValue([]);
    prismaMock.user.findMany.mockResolvedValue([]);
  });

  it('aucune résa récente → []', async () => {
    prismaMock.reservation.findMany.mockResolvedValue([]);
    expect(await service.playerSuggestions('demo', 'u1', now)).toEqual([]);
  });

  it('agrège les co-joueurs (organisateur + participants), compte et date du dernier match', async () => {
    prismaMock.reservation.findMany.mockResolvedValue([
      { userId: 'orga', startTime: new Date('2026-07-12T10:00:00Z'), participants: [{ userId: 'u1' }, { userId: 'p1' }] },
      { userId: 'u1', startTime: new Date('2026-07-10T10:00:00Z'), participants: [{ userId: 'u1' }, { userId: 'p1' }] },
    ] as any);
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'orga', firstName: 'O', lastName: 'X', avatarUrl: null, acceptsFriendRequests: true },
      { id: 'p1', firstName: 'P', lastName: 'X', avatarUrl: null, acceptsFriendRequests: false },
    ] as any);
    const out = await service.playerSuggestions('demo', 'u1', now);
    expect(out.map((s) => s.id)).toEqual(['orga', 'p1']); // tri lastPlayedAt desc… ex-aequo p1 12/07 aussi
    const p1 = out.find((s) => s.id === 'p1')!;
    expect(p1.playedCount).toBe(2);
    expect(p1.lastPlayedAt).toEqual(new Date('2026-07-12T10:00:00Z'));
    expect(p1.requestable).toBe(false);
  });

  it('exclut les joueurs déjà suivis ou en relation d\'amitié (PENDING compris)', async () => {
    prismaMock.reservation.findMany.mockResolvedValue([
      { userId: null, startTime: new Date('2026-07-12T10:00:00Z'), participants: [{ userId: 'u1' }, { userId: 'suivi' }, { userId: 'pending' }, { userId: 'neuf' }] },
    ] as any);
    prismaMock.follow.findMany.mockResolvedValue([{ followingId: 'suivi' }] as any);
    prismaMock.friendship.findMany.mockResolvedValue([{ userAId: 'pending', userBId: 'u1' }] as any);
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'neuf', firstName: 'N', lastName: 'X', avatarUrl: null, acceptsFriendRequests: true },
    ] as any);
    const out = await service.playerSuggestions('demo', 'u1', now);
    expect(out.map((s) => s.id)).toEqual(['neuf']);
    // le filtre users ne reçoit que les candidats non exclus
    const userArgs = prismaMock.user.findMany.mock.calls[0][0];
    expect(userArgs.where.id.in).toEqual(['neuf']);
    expect(userArgs.where.deletedAt).toBeNull();
  });

  it('cap 8 suggestions', async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `p${i}`);
    prismaMock.reservation.findMany.mockResolvedValue([
      { userId: null, startTime: new Date('2026-07-12T10:00:00Z'), participants: [{ userId: 'u1' }, ...ids.map((id) => ({ userId: id }))] },
    ] as any);
    prismaMock.user.findMany.mockResolvedValue(
      ids.map((id) => ({ id, firstName: id, lastName: 'X', avatarUrl: null, acceptsFriendRequests: true })) as any);
    const out = await service.playerSuggestions('demo', 'u1', now);
    expect(out).toHaveLength(8);
  });
});
```

⚠️ Note sur le 2ᵉ test : `orga` et `p1` ont tous deux leur dernier match le 12/07 — le tri les départage par ordre d'insertion. Si l'assertion d'ordre est fragile, remplacer par `expect(out.map((s) => s.id).sort()).toEqual(['orga', 'p1'])`.

- [ ] **Step 2 : Lancer les tests**

Run (depuis `backend/`) :
```bash
node node_modules/jest/bin/jest.js src/services/__tests__/socialHub.service.test.ts
```
Expected: PASS (9 tests).

- [ ] **Step 3 : Commit**

```bash
git add backend/src/services/__tests__/socialHub.service.test.ts
git commit -m "test(amis): couverture playerSuggestions (agregat, exclusions, cap)"
```

---

### Task 4 : Backend — routes `friends-agenda` + `player-suggestions`

**Files:**
- Modify: `backend/src/routes/clubs.ts` (~l.19 import, ~l.312 routes)
- Create: `backend/src/routes/__tests__/social-hub.routes.test.ts`

- [ ] **Step 1 : Écrire le test de routes (échec attendu)**

Créer `backend/src/routes/__tests__/social-hub.routes.test.ts` (calque exact de `friends.routes.test.ts`) :

```typescript
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';

let mockAgenda: jest.Mock;
let mockSuggestions: jest.Mock;

jest.mock('../../services/socialHub.service', () => ({
  SocialHubService: jest.fn().mockImplementation(() => ({
    friendsAgenda:     (...a: unknown[]) => mockAgenda(...a),
    playerSuggestions: (...a: unknown[]) => mockSuggestions(...a),
  })),
}));

const token = jwt.sign({ id: 'u1', email: 'u1@test.fr' }, process.env.JWT_SECRET!);

describe('routes social hub', () => {
  beforeEach(() => {
    mockAgenda = jest.fn();
    mockSuggestions = jest.fn();
  });

  it('GET /api/clubs/:slug/me/friends-agenda', async () => {
    mockAgenda.mockResolvedValue([{ kind: 'match', id: 'r1' }]);
    const res = await request(app).get('/api/clubs/demo/me/friends-agenda').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(mockAgenda).toHaveBeenCalledWith('demo', 'u1');
    expect(res.body).toEqual([{ kind: 'match', id: 'r1' }]);
  });

  it('GET /api/clubs/:slug/me/friends-agenda — 401 anonyme', async () => {
    const res = await request(app).get('/api/clubs/demo/me/friends-agenda');
    expect(res.status).toBe(401);
  });

  it('GET /api/clubs/:slug/me/player-suggestions', async () => {
    mockSuggestions.mockResolvedValue([{ id: 'p1' }]);
    const res = await request(app).get('/api/clubs/demo/me/player-suggestions').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(mockSuggestions).toHaveBeenCalledWith('demo', 'u1');
  });

  it('GET /api/clubs/:slug/me/player-suggestions — 401 anonyme', async () => {
    const res = await request(app).get('/api/clubs/demo/me/player-suggestions');
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run (depuis `backend/`) :
```bash
node node_modules/jest/bin/jest.js src/routes/__tests__/social-hub.routes.test.ts
```
Expected: FAIL — 404 sur les deux routes.

- [ ] **Step 3 : Ajouter les routes**

Dans `backend/src/routes/clubs.ts` :

1. Ajouter l'import à côté de celui de `FriendshipService` (~l.19) :
```typescript
import { SocialHubService } from '../services/socialHub.service';
```
2. Instancier à côté de `friendshipService` (chercher `new FriendshipService()`) :
```typescript
const socialHubService = new SocialHubService();
```
3. Après le bloc « Amitiés confirmées » (après la route `DELETE /:slug/friends/:userId`, ~l.312), ajouter :
```typescript
// --- Hub social : « ça joue bientôt » chez mon cercle + suggestions de joueurs ---
router.get('/:slug/me/friends-agenda', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await socialHubService.friendsAgenda(asString(req.params.slug), req.user!.id)); }
  catch (err) { handleError(err, res, next); }
});
router.get('/:slug/me/player-suggestions', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await socialHubService.playerSuggestions(asString(req.params.slug), req.user!.id)); }
  catch (err) { handleError(err, res, next); }
});
```

- [ ] **Step 4 : Vérifier que les tests passent**

Run (depuis `backend/`) :
```bash
node node_modules/jest/bin/jest.js src/routes/__tests__/social-hub.routes.test.ts
```
Expected: PASS (4 tests).

- [ ] **Step 5 : Commit**

```bash
git add backend/src/routes/clubs.ts backend/src/routes/__tests__/social-hub.routes.test.ts
git commit -m "feat(amis): routes friends-agenda + player-suggestions"
```

---

### Task 5 : Backend — enrichir `FriendshipService.listFriends` (stats + niveau)

**Files:**
- Modify: `backend/src/services/friendship.service.ts`
- Modify: `backend/src/services/__tests__/friendship.service.test.ts`

- [ ] **Step 1 : Écrire le test (échec attendu)**

Ajouter à `friendship.service.test.ts` (le mock rating est nécessaire — l'ajouter en tête du fichier s'il n'y est pas) :

```typescript
jest.mock('../rating/preferredSport', () => ({ resolvePreferredSportKey: jest.fn().mockResolvedValue('padel') }));
jest.mock('../rating.service', () => ({
  RatingService: jest.fn().mockImplementation(() => ({
    getLevelsForUsers: jest.fn().mockResolvedValue({ u2: { value: 3.7, tier: 'CONFIRMED' } }),
  })),
}));
```

puis le bloc :

```typescript
describe('FriendshipService — listFriends enrichi', () => {
  let service: FriendshipService;
  const now = new Date('2026-07-14T10:00:00Z');

  beforeEach(() => {
    service = new FriendshipService();
    prismaMock.friendship.findMany.mockResolvedValue([
      { userAId: 'u1', userA: { id: 'u1', firstName: 'Moi', lastName: 'A', avatarUrl: null }, userB: { id: 'u2', firstName: 'Léa', lastName: 'M', avatarUrl: null } },
    ] as any);
    prismaMock.reservationParticipant.findMany.mockResolvedValue([]);
    prismaMock.reservation.findMany.mockResolvedValue([]);
  });

  it('renvoie level + playedTogetherCount + lastPlayedTogetherAt', async () => {
    prismaMock.reservationParticipant.findMany.mockResolvedValue([
      { userId: 'u2', reservationId: 'r1', reservation: { startTime: new Date('2026-07-01T10:00:00Z') } },
      { userId: 'u2', reservationId: 'r2', reservation: { startTime: new Date('2026-07-08T10:00:00Z') } },
    ] as any);
    const [lea] = await service.listFriends('u1', undefined, now);
    expect(lea.level).toEqual({ value: 3.7, tier: 'CONFIRMED' });
    expect(lea.playedTogetherCount).toBe(2);
    expect(lea.lastPlayedTogetherAt).toEqual(new Date('2026-07-08T10:00:00Z'));
  });

  it('déduplique une résa comptée deux fois (participant + organisateur)', async () => {
    prismaMock.reservationParticipant.findMany.mockResolvedValue([
      { userId: 'u2', reservationId: 'r1', reservation: { startTime: new Date('2026-07-01T10:00:00Z') } },
    ] as any);
    prismaMock.reservation.findMany.mockResolvedValue([
      { id: 'r1', userId: 'u2', startTime: new Date('2026-07-01T10:00:00Z') },
    ] as any);
    const [lea] = await service.listFriends('u1', undefined, now);
    expect(lea.playedTogetherCount).toBe(1);
  });

  it('ami sans partie commune → count 0, last null', async () => {
    const [lea] = await service.listFriends('u1', undefined, now);
    expect(lea.playedTogetherCount).toBe(0);
    expect(lea.lastPlayedTogetherAt).toBeNull();
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run (depuis `backend/`) :
```bash
node node_modules/jest/bin/jest.js src/services/__tests__/friendship.service.test.ts
```
Expected: FAIL — `level`/`playedTogetherCount` undefined.

- [ ] **Step 3 : Implémenter l'enrichissement**

Dans `backend/src/services/friendship.service.ts` :

1. Compléter les imports :
```typescript
import { RatingService } from './rating.service';
import { resolvePreferredSportKey } from './rating/preferredSport';
import type { UserLevel } from './rating.service';
```
2. Étendre l'interface `Friend` :
```typescript
export interface Friend {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  mutual: boolean;
  level?: UserLevel | null;
  playedTogetherCount?: number;
  lastPlayedTogetherAt?: Date | null;
}
```
3. Ajouter le champ d'instance dans la classe :
```typescript
  private ratingService = new RatingService();
```
4. Remplacer intégralement `listFriends` par :
```typescript
  /** Mes amitiés confirmées (ACCEPTED). Global. Filtrable par nom.
   *  Enrichi : niveau (sport préféré du caller) + stats « joué ensemble »
   *  (résas CONFIRMED passées, tous clubs — une requête groupée, pas de N+1). */
  async listFriends(userId: string, q?: string, now: Date = new Date()): Promise<Friend[]> {
    const query = (q ?? '').trim().toLowerCase();
    const rows = await prisma.friendship.findMany({
      where: { status: 'ACCEPTED', OR: [{ userAId: userId }, { userBId: userId }] },
      select: { userAId: true, userA: { select: USER_SEL }, userB: { select: USER_SEL } },
    });
    let others = rows.map((r) => (r.userAId === userId ? r.userB : r.userA));
    if (query) others = others.filter((o) => `${o.firstName} ${o.lastName}`.toLowerCase().includes(query));
    others.sort((x, y) => `${x.lastName}${x.firstName}`.localeCompare(`${y.lastName}${y.firstName}`));
    if (others.length === 0) return [];
    const ids = others.map((o) => o.id);

    // « joué ensemble » : l'ami figure comme participant (moi organisateur OU participant)…
    // …ou comme organisateur d'une résa où je suis participant (vieilles résas sans sa ligne participant).
    const [viaParticipants, viaOrganizer, sportKey] = await Promise.all([
      prisma.reservationParticipant.findMany({
        where: {
          userId: { in: ids },
          reservation: {
            status: 'CONFIRMED', startTime: { lt: now },
            OR: [{ userId }, { participants: { some: { userId } } }],
          },
        },
        select: { userId: true, reservationId: true, reservation: { select: { startTime: true } } },
      }),
      prisma.reservation.findMany({
        where: { userId: { in: ids }, status: 'CONFIRMED', startTime: { lt: now }, participants: { some: { userId } } },
        select: { id: true, userId: true, startTime: true },
      }),
      resolvePreferredSportKey(userId),
    ]);

    const stats = new Map<string, { count: number; last: Date; seen: Set<string> }>();
    const add = (friendId: string, resId: string, startTime: Date) => {
      const cur = stats.get(friendId) ?? { count: 0, last: startTime, seen: new Set<string>() };
      if (cur.seen.has(resId)) return;
      cur.seen.add(resId);
      cur.count += 1;
      if (startTime > cur.last) cur.last = startTime;
      stats.set(friendId, cur);
    };
    for (const p of viaParticipants) add(p.userId, p.reservationId, p.reservation.startTime);
    for (const r of viaOrganizer) if (r.userId) add(r.userId, r.id, r.startTime);

    const levels = await this.ratingService.getLevelsForUsers(ids, sportKey);

    return others.map((o) => ({
      id: o.id, firstName: o.firstName, lastName: o.lastName, avatarUrl: o.avatarUrl, mutual: true,
      level: levels[o.id] ?? null,
      playedTogetherCount: stats.get(o.id)?.count ?? 0,
      lastPlayedTogetherAt: stats.get(o.id)?.last ?? null,
    }));
  }
```

- [ ] **Step 4 : Vérifier que tous les tests friendship passent**

Run (depuis `backend/`) :
```bash
node node_modules/jest/bin/jest.js src/services/__tests__/friendship.service.test.ts
```
Expected: PASS (anciens + 3 nouveaux). ⚠️ Si d'anciens tests de `listFriends` échouent parce que Prisma mocke `reservationParticipant.findMany` non configuré, ajouter les `mockResolvedValue([])` correspondants dans leur `beforeEach`.

- [ ] **Step 5 : Commit**

```bash
git add backend/src/services/friendship.service.ts backend/src/services/__tests__/friendship.service.test.ts
git commit -m "feat(amis): listFriends enrichi — niveau + parties jouees ensemble"
```

---

### Task 6 : Backend — reformuler la notif `follow.new` (« favori »)

**Files:**
- Modify: `backend/src/email/notifications.ts:1285-1286`
- Modify: `backend/src/email/__tests__/notifications.follow.test.ts`

- [ ] **Step 1 : Modifier les chaînes**

Dans `notifyNewFollower` (`backend/src/email/notifications.ts`, ~l.1285), remplacer :

```typescript
    title: `${name} vous suit`,
    body: `${name} vous a ajouté à ses amis. Suivez-le en retour pour vous retrouver plus vite.`,
```

par :

```typescript
    title: `${name} vous a ajouté en favori`,
    body: `${name} vous a ajouté à ses favoris. Ajoutez-le en retour pour vous retrouver plus vite.`,
```

- [ ] **Step 2 : Mettre à jour le test**

Run (depuis `backend/`) :
```bash
node node_modules/jest/bin/jest.js src/email/__tests__/notifications.follow.test.ts
```
Si FAIL : remplacer dans le fichier de test les attentes `vous suit` / `ajouté à ses amis` par les nouvelles chaînes ci-dessus, puis relancer.
Expected: PASS.

- [ ] **Step 3 : Commit**

```bash
git add backend/src/email/notifications.ts backend/src/email/__tests__/notifications.follow.test.ts
git commit -m "feat(amis): notif follow.new reformulee en favori"
```

---

### Task 7 : Frontend — types et méthodes `lib/api.ts`

**Files:**
- Modify: `frontend/lib/api.ts` (interface `Friend` ~l.2302, méthodes près de `listClubFriends` ~l.738)

- [ ] **Step 1 : Étendre `Friend` et ajouter les nouveaux types**

Dans `frontend/lib/api.ts`, remplacer l'interface `Friend` (~l.2302) par :

```typescript
export interface Friend {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  level?: UserLevel | null;
  mutual: boolean;
  playedTogetherCount?: number;
  lastPlayedTogetherAt?: string | null;
}
```

Ajouter juste après `FriendRequests` (~l.2325) :

```typescript
// --- Hub social « Mes amis » ---
export interface FriendsAgendaItem {
  kind: 'match' | 'tournament' | 'event';
  id: string;
  startTime: string;
  endTime: string | null;
  label: string;
  friends: { id: string; firstName: string; lastName: string; avatarUrl: string | null }[];
}
export interface PlayerSuggestion {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  level: UserLevel | null;
  lastPlayedAt: string;
  playedCount: number;
  requestable: boolean;
}
```

- [ ] **Step 2 : Ajouter les méthodes**

Après `listFriendRequests` (~l.757), ajouter :

```typescript
  getFriendsAgenda: (slug: string, token: string) =>
    request<FriendsAgendaItem[]>(`/api/clubs/${slug}/me/friends-agenda`, {}, token),
  getPlayerSuggestions: (slug: string, token: string) =>
    request<PlayerSuggestion[]>(`/api/clubs/${slug}/me/player-suggestions`, {}, token),
```

- [ ] **Step 3 : Type-check**

Run (depuis `frontend/`) :
```bash
node node_modules/typescript/bin/tsc --noEmit
```
Expected: 0 erreur sur `lib/api.ts` (ignorer les erreurs pré-existantes d'autres fichiers WIP s'il y en a — vérifier par grep sur `api.ts`).

- [ ] **Step 4 : Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(amis): types + methodes api friends-agenda / player-suggestions"
```

---

### Task 8 : Frontend — helpers purs `lib/social.ts`

**Files:**
- Create: `frontend/lib/social.ts`
- Create: `frontend/__tests__/social.test.ts`

- [ ] **Step 1 : Écrire les tests (échec attendu)**

Créer `frontend/__tests__/social.test.ts` :

```typescript
import { relativeDayLabel, playedTogetherLine, suggestionReason, dedupFavorites, friendsAnchor, agendaWhenLabel } from '@/lib/social';
import type { Friend } from '@/lib/api';

const NOW = new Date('2026-07-14T10:00:00'); // mardi

describe('relativeDayLabel', () => {
  it('aujourd\'hui / hier', () => {
    expect(relativeDayLabel('2026-07-14T08:00:00', NOW)).toBe("aujourd'hui");
    expect(relativeDayLabel('2026-07-13T22:00:00', NOW)).toBe('hier');
  });
  it('moins de 7 jours → jour de la semaine', () => {
    expect(relativeDayLabel('2026-07-11T10:00:00', NOW)).toBe('samedi');
  });
  it('semaines puis mois', () => {
    expect(relativeDayLabel('2026-06-30T10:00:00', NOW)).toBe('il y a 2 sem.');
    expect(relativeDayLabel('2026-05-01T10:00:00', NOW)).toBe('il y a 2 mois');
  });
});

describe('playedTogetherLine', () => {
  it('null sans partie commune ou sans horloge', () => {
    expect(playedTogetherLine({ playedTogetherCount: 0, lastPlayedTogetherAt: null }, NOW)).toBeNull();
    expect(playedTogetherLine({ playedTogetherCount: 3, lastPlayedTogetherAt: '2026-07-11T10:00:00' }, null)).toBeNull();
  });
  it('singulier / pluriel', () => {
    expect(playedTogetherLine({ playedTogetherCount: 1, lastPlayedTogetherAt: '2026-07-13T10:00:00' }, NOW)).toBe('1 partie ensemble · hier');
    expect(playedTogetherLine({ playedTogetherCount: 12, lastPlayedTogetherAt: '2026-07-11T10:00:00' }, NOW)).toBe('12 parties ensemble · samedi');
  });
});

describe('suggestionReason', () => {
  it('avec et sans horloge', () => {
    expect(suggestionReason('2026-07-11T10:00:00', NOW)).toBe('Vous avez joué ensemble samedi');
    expect(suggestionReason('2026-07-11T10:00:00', null)).toBe('Vous avez joué ensemble récemment');
  });
});

describe('dedupFavorites', () => {
  const f = (id: string): Friend => ({ id, firstName: id, lastName: 'X', avatarUrl: null, mutual: false });
  it('retire les amis confirmés des favoris', () => {
    expect(dedupFavorites([f('a'), f('b')], [f('b')]).map((x) => x.id)).toEqual(['a']);
  });
});

describe('friendsAnchor', () => {
  it('demandes / followers / le reste', () => {
    expect(friendsAnchor('demandes')).toBe('demandes');
    expect(friendsAnchor('followers')).toBe('followers');
    expect(friendsAnchor('amis')).toBeNull();
    expect(friendsAnchor(null)).toBeNull();
  });
});

describe('agendaWhenLabel', () => {
  it('jour + heure au fuseau du club', () => {
    // 18h30 heure de Paris en été = 16:30 UTC
    expect(agendaWhenLabel('2026-07-18T16:30:00Z', 'Europe/Paris')).toBe('sam. 18 · 18h30');
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run (depuis `frontend/`) :
```bash
node node_modules/jest/bin/jest.js __tests__/social.test.ts
```
Expected: FAIL — module `@/lib/social` introuvable.

- [ ] **Step 3 : Implémenter les helpers**

Créer `frontend/lib/social.ts` :

```typescript
import { Friend } from './api';

// Helpers PURS du hub social « Mes amis » — testés, paramétrés par `now` (hydration-safe :
// jamais de new Date() ici, l'horloge est posée en effet par le composant).

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

/** Libellé relatif d'une date passée : « aujourd'hui », « hier », « samedi », « il y a 3 sem. », « il y a 2 mois ». */
export function relativeDayLabel(iso: string, now: Date): string {
  const d = new Date(iso);
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(d)) / DAY_MS);
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return 'hier';
  if (days < 7) return WEEKDAYS_FR[d.getDay()];
  if (days < 30) return `il y a ${Math.floor(days / 7)} sem.`;
  const months = Math.floor(days / 30);
  return months <= 1 ? 'il y a 1 mois' : `il y a ${months} mois`;
}

/** Ligne vivante d'une carte ami : « 12 parties ensemble · samedi ». null si rien à dire. */
export function playedTogetherLine(
  f: Pick<Friend, 'playedTogetherCount' | 'lastPlayedTogetherAt'>,
  now: Date | null,
): string | null {
  if (!now || !f.playedTogetherCount || !f.lastPlayedTogetherAt) return null;
  const n = f.playedTogetherCount;
  return `${n} partie${n > 1 ? 's' : ''} ensemble · ${relativeDayLabel(f.lastPlayedTogetherAt, now)}`;
}

/** Raison d'une suggestion : « Vous avez joué ensemble samedi ». */
export function suggestionReason(lastPlayedAtIso: string, now: Date | null): string {
  if (!now) return 'Vous avez joué ensemble récemment';
  return `Vous avez joué ensemble ${relativeDayLabel(lastPlayedAtIso, now)}`;
}

/** Favoris affichés = follows − amis confirmés (un ami n'apparaît que dans la section Amis). */
export function dedupFavorites(follows: Friend[], friends: Friend[]): Friend[] {
  const friendIds = new Set(friends.map((f) => f.id));
  return follows.filter((f) => !friendIds.has(f.id));
}

/** Ancre du deep-link ?tab= : seules demandes/followers ont une cible, le reste = haut de page. */
export type FriendsAnchor = 'demandes' | 'followers' | null;
export function friendsAnchor(tabParam: string | null): FriendsAnchor {
  if (tabParam === 'demandes') return 'demandes';
  if (tabParam === 'followers') return 'followers';
  return null;
}

/** Quand d'un item d'agenda au fuseau du club : « sam. 18 · 18h30 ». */
export function agendaWhenLabel(iso: string, timezone: string): string {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', timeZone: timezone }).format(d);
  const time = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(d).replace(':', 'h');
  return `${day} · ${time}`;
}
```

- [ ] **Step 4 : Vérifier que les tests passent**

Run (depuis `frontend/`) :
```bash
node node_modules/jest/bin/jest.js __tests__/social.test.ts
```
Expected: PASS. ⚠️ Si `agendaWhenLabel` rend « sam. 18 » avec un format différent selon la version ICU de Node, ajuster l'assertion au rendu réel (le helper reste correct — c'est l'assertion qui suit l'ICU locale).

- [ ] **Step 5 : Commit**

```bash
git add frontend/lib/social.ts frontend/__tests__/social.test.ts
git commit -m "feat(amis): helpers purs lib/social (libelles relatifs, dedup favoris, ancre)"
```

---

### Task 9 : Frontend — « Inviter à jouer » : `openDm(draft)` + `initialDraft`

**Files:**
- Modify: `frontend/lib/messages.ts:52-56`
- Modify: `frontend/components/messages/MessageComposer.tsx`
- Modify: `frontend/components/messages/MessageThread.tsx` (signature l.21, composer l.256)
- Modify: `frontend/components/messages/DmWidgetHost.tsx`
- Modify: `frontend/components/messages/MessagesHub.tsx` (prop + l.113)
- Modify: `frontend/app/me/messages/page.tsx` (l.18, l.41)
- Create: `frontend/__tests__/openDm.test.ts`
- Create: `frontend/__tests__/MessageComposer.draft.test.tsx`

- [ ] **Step 1 : Test `openDm` (échec attendu)**

Créer `frontend/__tests__/openDm.test.ts` :

```typescript
import { openDm } from '@/lib/messages';

describe('openDm — draft', () => {
  it('desktop : event window avec userId + draft', () => {
    const seen: unknown[] = [];
    const listener = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener('palova:open-dm', listener);
    openDm('u2', { isDesktop: true, navigate: () => {}, draft: 'On se fait une partie ?' });
    window.removeEventListener('palova:open-dm', listener);
    expect(seen).toEqual([{ userId: 'u2', draft: 'On se fait une partie ?' }]);
  });

  it('mobile : navigation avec ?draft= encodé', () => {
    const navigate = jest.fn();
    openDm('u2', { isDesktop: false, navigate, draft: 'On se fait une partie ?' });
    expect(navigate).toHaveBeenCalledWith('/me/messages?with=u2&draft=On%20se%20fait%20une%20partie%20%3F');
  });

  it('sans draft : comportement historique', () => {
    const navigate = jest.fn();
    openDm('u2', { isDesktop: false, navigate });
    expect(navigate).toHaveBeenCalledWith('/me/messages?with=u2');
  });
});
```

Run (depuis `frontend/`) : `node node_modules/jest/bin/jest.js __tests__/openDm.test.ts`
Expected: FAIL (draft absent de l'event / de l'URL).

- [ ] **Step 2 : Étendre `openDm`**

Dans `frontend/lib/messages.ts`, remplacer la fonction `openDm` par :

```typescript
/** Ouvre une conversation : widget ancré en desktop (event window), page en mobile.
 *  `draft` (optionnel) pré-remplit le composer — appliqué seulement si le brouillon est vide. */
export function openDm(userId: string, opts: { isDesktop: boolean; navigate: (href: string) => void; draft?: string }): void {
  if (opts.isDesktop) {
    window.dispatchEvent(new CustomEvent('palova:open-dm', { detail: { userId, draft: opts.draft } }));
  } else {
    opts.navigate(`/me/messages?with=${userId}${opts.draft ? `&draft=${encodeURIComponent(opts.draft)}` : ''}`);
  }
}
```

Run le test → Expected: PASS.

- [ ] **Step 3 : Test `MessageComposer.initialDraft` (échec attendu)**

Créer `frontend/__tests__/MessageComposer.draft.test.tsx` :

```tsx
import { render, screen } from '@testing-library/react';
import { MessageComposer } from '@/components/messages/MessageComposer';

jest.mock('@/lib/ThemeProvider', () => ({ useTheme: () => ({ th: { line: '#ccc', surface: '#fff', text: '#111', textMute: '#666', accent: '#06c', onAccent: '#fff', fontUI: 'sans-serif' } }) }));
jest.mock('@/lib/useIsDesktop', () => ({ useIsDesktop: () => true }));

const noop = async () => true;

describe('MessageComposer — initialDraft', () => {
  it('pré-remplit le brouillon', () => {
    render(<MessageComposer onSend={noop} onSendImage={noop} onTyping={() => {}} initialDraft="On se fait une partie ?" />);
    expect(screen.getByPlaceholderText('Votre message…')).toHaveValue('On se fait une partie ?');
  });

  it('sans initialDraft : vide', () => {
    render(<MessageComposer onSend={noop} onSendImage={noop} onTyping={() => {}} />);
    expect(screen.getByPlaceholderText('Votre message…')).toHaveValue('');
  });
});
```

Run : `node node_modules/jest/bin/jest.js __tests__/MessageComposer.draft.test.tsx`
Expected: FAIL (prop inconnue, valeur vide).

- [ ] **Step 4 : Implémenter `initialDraft` et la plomberie**

1. `frontend/components/messages/MessageComposer.tsx` — signature et état :

```typescript
export function MessageComposer({ disabled, onSend, onSendImage, onTyping, initialDraft }: {
  disabled?: boolean;
  onSend: (body: string) => Promise<boolean>; // false = échec → draft restauré
  onSendImage: (file: File, caption: string) => Promise<boolean>;
  onTyping: () => void;
  /** Brouillon initial (ex. « Inviter à jouer ») — appliqué seulement si le brouillon est vide. */
  initialDraft?: string;
}) {
```
et remplacer `const [draft, setDraft] = useState('');` par :
```typescript
  const [draft, setDraft] = useState((initialDraft ?? '').slice(0, 2000));
  useEffect(() => {
    if (initialDraft) setDraft((d) => (d ? d : initialDraft.slice(0, 2000)));
  }, [initialDraft]);
```
(ajouter `useEffect` à l'import React de la ligne 2).

2. `frontend/components/messages/MessageThread.tsx` — ajouter `initialDraft?: string` à la signature (l.21) et le transmettre au composer (l.256) :
```tsx
        <MessageComposer onSend={send} onSendImage={sendImage} onTyping={typing} initialDraft={initialDraft} />
```

3. `frontend/components/messages/DmWidgetHost.tsx` — état + handler + passage :
```typescript
  const [draft, setDraft] = useState<string | undefined>(undefined);
```
dans `onOpen`, remplacer la lecture du detail par :
```typescript
      const { userId, draft: draftText } = (e as CustomEvent<{ userId?: string; draft?: string }>).detail ?? {};
      if (!userId) return;
      if (!isDesktop) {
        router.push(`/me/messages?with=${userId}${draftText ? `&draft=${encodeURIComponent(draftText)}` : ''}`);
        return;
      }
      setDraft(draftText);
```
et transmettre au thread :
```tsx
        <MessageThread conversationId={conv.id} token={token} viewerUserId={viewerId} other={conv.other} initialDraft={draft} />
```

4. `frontend/components/messages/MessagesHub.tsx` — prop `initialDraft?: string | null` dans la signature (l.16-21), et au rendu du thread (l.113), passer le draft **seulement** pour la conversation du deeplink :
```tsx
      <MessageThread conversationId={selected.id} token={token} viewerUserId={viewerUserId}
        other={selected.other} onMeta={setMeta} onUnreadCleared={reload}
        initialDraft={selected.other.userId === initialWith ? initialDraft ?? undefined : undefined} />
```

5. `frontend/app/me/messages/page.tsx` — lire le paramètre (l.18) :
```typescript
  const sp = useSearchParams();
  const initialWith = sp.get('with');
  const initialDraft = sp.get('draft');
```
et le passer (l.41) : `<MessagesHub token={token} viewerUserId={viewerUserId} clubSlug={slug} initialWith={initialWith} initialDraft={initialDraft} />`.

- [ ] **Step 5 : Lancer les tests messages**

Run (depuis `frontend/`) :
```bash
node node_modules/jest/bin/jest.js __tests__/openDm.test.ts __tests__/MessageComposer.draft.test.tsx __tests__/MessagesHub.test.tsx
```
Expected: PASS (les suites MessagesHub existantes ne passent pas `initialDraft` — prop optionnelle, rien ne casse).

- [ ] **Step 6 : Commit**

```bash
git add frontend/lib/messages.ts frontend/components/messages/ frontend/app/me/messages/page.tsx frontend/__tests__/openDm.test.ts frontend/__tests__/MessageComposer.draft.test.tsx
git commit -m "feat(amis): inviter a jouer — openDm(draft) + composer initialDraft"
```

---

### Task 10 : Frontend — renommage « Favoris » (3 composants)

**Files:**
- Modify: `frontend/components/social/FriendsQuickRow.tsx:42`
- Modify: `frontend/components/social/FollowButton.tsx:42-53`
- Modify: `frontend/components/openmatch/OpenMatchCard.tsx:101`
- Modify: leurs tests (`FriendsQuickRow.test.tsx`, `FollowButton.test.tsx`, `OpenMatchCard.friends.test.tsx`, `PartnerSearch.friends.test.tsx` si concerné)

- [ ] **Step 1 : Renommer les libellés**

1. `FriendsQuickRow.tsx` l.42 : `Mes amis` → `Favoris ★`.
2. `FollowButton.tsx` : remplacer la ligne `const label = iFollow ? 'Suivi(e)' : 'Suivre';` par :
```typescript
  const label = iFollow ? '★ Favori' : '☆ Favori';
```
et dans le JSX du bouton, supprimer la ligne `<Icon name={iFollow ? 'check' : 'plus'} … />` (l'étoile du libellé suffit) ainsi que l'import `Icon` devenu inutile.
3. `OpenMatchCard.tsx` l.101 :
```tsx
          {friendCount === 1 ? '1 de vos favoris joue ici' : `${friendCount} de vos favoris jouent ici`}
```

- [ ] **Step 2 : Mettre à jour les tests qui assertent les anciens libellés**

Run (depuis la racine) :
```bash
grep -rln "Suivi(e)\|'Suivre'\|Mes amis\|de vos amis" frontend/__tests__/
```
Pour chaque fichier trouvé, remplacer les attentes : `Suivre` → `☆ Favori`, `Suivi(e)` → `★ Favori`, titre de rangée `Mes amis` → `Favoris ★`, `de vos amis` → `de vos favoris`. (⚠️ `AssociateMemberPicker.test.tsx` asserte l'ABSENCE de « Mes amis » — mettre à jour vers l'absence de « Favoris ★ » pour garder le sens du test.)

- [ ] **Step 3 : Lancer les suites concernées**

Run (depuis `frontend/`) :
```bash
node node_modules/jest/bin/jest.js __tests__/FriendsQuickRow.test.tsx __tests__/FollowButton.test.tsx __tests__/OpenMatchCard.friends.test.tsx __tests__/PartnerSearch.friends.test.tsx __tests__/AddPlayerSheet.test.tsx __tests__/AssociateMemberPicker.test.tsx
```
Expected: PASS.

- [ ] **Step 4 : Commit**

```bash
git add frontend/components/social/FriendsQuickRow.tsx frontend/components/social/FollowButton.tsx frontend/components/openmatch/OpenMatchCard.tsx frontend/__tests__/
git commit -m "feat(amis): le suivi devient Favoris (quick row, bouton, cartes parties)"
```

---

### Task 11 : Frontend — composants Bannière demandes + Rail agenda + Carte ami

**Files:**
- Create: `frontend/components/social/FriendRequestsBanner.tsx`
- Create: `frontend/components/social/FriendsAgendaRail.tsx`
- Create: `frontend/components/social/FriendCard.tsx`
- Create: `frontend/__tests__/FriendRequestsBanner.test.tsx`, `frontend/__tests__/FriendsAgendaRail.test.tsx`, `frontend/__tests__/FriendCard.test.tsx`

- [ ] **Step 1 : `FriendRequestsBanner.tsx`**

```tsx
'use client';
import { useState } from 'react';
import { FriendRequests } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';
import { HERO_GRADIENT, HERO_INK, HERO_INK_MUTED } from '@/components/agenda/AgendaHero';

// Bannière « brume bleue » des demandes d'ami : reçues (Accepter/Refuser inline)
// + envoyées repliées derrière une ligne discrète. Rien si aucune demande.
export function FriendRequestsBanner({ requests, busyId, onRespond, onCancelSent }: {
  requests: FriendRequests;
  busyId: string | null;
  onRespond: (userId: string, accept: boolean) => void;
  onCancelSent: (userId: string) => void;
}) {
  const { th } = useTheme();
  const [sentOpen, setSentOpen] = useState(false);
  if (requests.received.length === 0 && requests.sent.length === 0) return null;

  const btn = (fill: boolean): React.CSSProperties => ({
    border: `1px solid ${HERO_INK}`, background: fill ? HERO_INK : 'transparent',
    color: fill ? '#fff' : HERO_INK, borderRadius: 999, padding: '6px 12px',
    fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
  });

  return (
    <section id="fh-demandes" aria-label="Demandes d'ami"
      style={{ background: HERO_GRADIENT, borderRadius: 18, padding: '14px 16px' }}>
      {requests.received.map((f) => (
        <div key={f.id} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, rowGap: 8, padding: '6px 0' }}>
          <Avatar firstName={f.firstName} lastName={f.lastName} avatarUrl={f.avatarUrl} size={38} color={colorForSeed(f.id)} />
          <div style={{ flex: 1, minWidth: 140 }}>
            <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 14.5, color: HERO_INK }}>{f.firstName} {f.lastName}</div>
            <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: HERO_INK_MUTED }}>souhaite devenir votre ami(e)</div>
          </div>
          <span style={{ display: 'inline-flex', gap: 8 }}>
            <button type="button" disabled={busyId === f.id} style={btn(true)} onClick={() => onRespond(f.id, true)}>Accepter</button>
            <button type="button" disabled={busyId === f.id} style={btn(false)} onClick={() => onRespond(f.id, false)}>Refuser</button>
          </span>
        </div>
      ))}
      {requests.sent.length > 0 && (
        <div style={{ marginTop: requests.received.length > 0 ? 8 : 0 }}>
          <button type="button" onClick={() => setSentOpen((o) => !o)} aria-expanded={sentOpen}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0,
              fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, color: HERO_INK_MUTED }}>
            {requests.sent.length} demande{requests.sent.length > 1 ? 's' : ''} envoyée{requests.sent.length > 1 ? 's' : ''} {sentOpen ? '▴' : '▾'}
          </button>
          {sentOpen && requests.sent.map((f) => (
            <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
              <Avatar firstName={f.firstName} lastName={f.lastName} avatarUrl={f.avatarUrl} size={30} color={colorForSeed(f.id)} />
              <span style={{ flex: 1, fontFamily: th.fontUI, fontSize: 13.5, color: HERO_INK }}>{f.firstName} {f.lastName}</span>
              <button type="button" disabled={busyId === f.id} style={btn(false)} onClick={() => onCancelSent(f.id)}>Annuler</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2 : `FriendsAgendaRail.tsx`**

```tsx
'use client';
import { useRouter } from 'next/navigation';
import { FriendsAgendaItem } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';
import { cardStyle, SectionHeader } from '@/components/clubhouse/SectionHeader';
import { agendaWhenLabel } from '@/lib/social';

const HREF: Record<FriendsAgendaItem['kind'], (id: string) => string> = {
  match: (id) => `/parties/${id}`,
  tournament: (id) => `/tournois/${id}`,
  event: (id) => `/events/${id}`,
};

// Rail « Ça joue bientôt » : où jouent mes amis/favoris prochainement. Masqué si vide.
export function FriendsAgendaRail({ items, timezone }: { items: FriendsAgendaItem[]; timezone: string }) {
  const { th } = useTheme();
  const router = useRouter();
  if (items.length === 0) return null;
  return (
    <section aria-label="Ça joue bientôt">
      <SectionHeader title="Ça joue bientôt" />
      <div className="sp-scroll-x" style={{ display: 'flex', gap: 10, scrollSnapType: 'x proximity', paddingBottom: 4 }}>
        {items.map((it) => (
          <button key={`${it.kind}-${it.id}`} type="button" onClick={() => router.push(HREF[it.kind](it.id))}
            style={{ ...cardStyle(th), scrollSnapAlign: 'start', flex: '0 0 auto', width: 190,
              padding: '12px 13px', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
            <div style={{ fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 800, letterSpacing: 0.3, color: th.accent, textTransform: 'uppercase' }}>
              {agendaWhenLabel(it.startTime, timezone)}
            </div>
            <div style={{ fontFamily: th.fontUI, fontSize: 14, fontWeight: 700, color: th.text, margin: '4px 0 8px',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {it.label}
            </div>
            <div style={{ display: 'flex' }}>
              {it.friends.map((f, i) => (
                <span key={f.id} style={{ marginLeft: i === 0 ? 0 : -8, display: 'inline-flex', borderRadius: '50%', boxShadow: `0 0 0 2px ${th.surface}` }}>
                  <Avatar firstName={f.firstName} lastName={f.lastName} avatarUrl={f.avatarUrl} size={26} color={colorForSeed(f.id)} />
                </span>
              ))}
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 3 : `FriendCard.tsx`**

```tsx
'use client';
import { Friend } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';
import { LevelChip } from '@/components/player/LevelChip';
import { colorForSeed } from '@/lib/playerColors';
import { cardStyle } from '@/components/clubhouse/SectionHeader';
import { playedTogetherLine } from '@/lib/social';

// Carte riche d'un ami confirmé : identité + niveau + ligne vivante « N parties ensemble »
// + actions ⚡ Inviter à jouer / 💬 message / Retirer.
export function FriendCard({ friend, now, busy, onInvite, onMessage, onRemove }: {
  friend: Friend;
  now: Date | null;
  busy?: boolean;
  onInvite: (f: Friend) => void;
  onMessage: (f: Friend) => void;
  onRemove: (f: Friend) => void;
}) {
  const { th } = useTheme();
  const line = playedTogetherLine(friend, now);
  return (
    <div style={{ ...cardStyle(th), padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Avatar firstName={friend.firstName} lastName={friend.lastName} avatarUrl={friend.avatarUrl} size={40} color={colorForSeed(friend.id)} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: th.fontUI, fontSize: 15, fontWeight: 700, color: th.text }}>{friend.firstName} {friend.lastName}</div>
          {line && <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginTop: 1 }}>{line}</div>}
        </div>
        {friend.level != null && <LevelChip level={friend.level} />}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" disabled={busy} onClick={() => onInvite(friend)}
          style={{ border: `1px solid ${th.accent}`, background: 'transparent', color: th.accent, borderRadius: 999,
            padding: '6px 12px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
          ⚡ Inviter à jouer
        </button>
        <button type="button" aria-label={`Écrire à ${friend.firstName} ${friend.lastName}`} title="Envoyer un message"
          onClick={() => onMessage(friend)}
          style={{ border: `1px solid ${th.line}`, background: 'transparent', borderRadius: 999, padding: '6px 10px',
            cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}>
          <Icon name="chat" size={15} color={th.textMute} />
        </button>
        <button type="button" disabled={busy} onClick={() => onRemove(friend)}
          style={{ marginLeft: 'auto', border: 'none', background: 'transparent', color: th.textMute,
            fontFamily: th.fontUI, fontSize: 12.5, cursor: 'pointer' }}>
          Retirer
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4 : Tests des 3 composants**

Mock thème commun (recopier dans chaque fichier) :
```tsx
jest.mock('@/lib/ThemeProvider', () => ({ useTheme: () => ({ th: {
  accent: '#06c', onAccent: '#fff', surface: '#fff', surface2: '#eee', line: '#ccc',
  text: '#111', textMute: '#666', fontUI: 'sans-serif', fontDisplay: 'serif', mode: 'light',
} }) }));
jest.mock('@/lib/api', () => ({ assetUrl: (p: string | null) => p }));
```

`frontend/__tests__/FriendRequestsBanner.test.tsx` :
```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { FriendRequestsBanner } from '@/components/social/FriendRequestsBanner';
// … mocks thème + api ci-dessus …

const f = (id: string, first: string) => ({ id, firstName: first, lastName: 'X', avatarUrl: null, mutual: false });

it('rien sans demande', () => {
  const { container } = render(<FriendRequestsBanner requests={{ received: [], sent: [] }} busyId={null} onRespond={jest.fn()} onCancelSent={jest.fn()} />);
  expect(container.firstChild).toBeNull();
});

it('reçue : Accepter/Refuser appellent onRespond', () => {
  const onRespond = jest.fn();
  render(<FriendRequestsBanner requests={{ received: [f('u2', 'Léa')], sent: [] }} busyId={null} onRespond={onRespond} onCancelSent={jest.fn()} />);
  fireEvent.click(screen.getByText('Accepter'));
  expect(onRespond).toHaveBeenCalledWith('u2', true);
  fireEvent.click(screen.getByText('Refuser'));
  expect(onRespond).toHaveBeenCalledWith('u2', false);
});

it('envoyées : repliées, Annuler appelle onCancelSent', () => {
  const onCancelSent = jest.fn();
  render(<FriendRequestsBanner requests={{ received: [], sent: [f('u3', 'Tom')] }} busyId={null} onRespond={jest.fn()} onCancelSent={onCancelSent} />);
  expect(screen.queryByText('Tom X')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText(/1 demande envoyée/));
  fireEvent.click(screen.getByText('Annuler'));
  expect(onCancelSent).toHaveBeenCalledWith('u3');
});
```

`frontend/__tests__/FriendsAgendaRail.test.tsx` :
```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { FriendsAgendaRail } from '@/components/social/FriendsAgendaRail';
// … mocks thème + api …
const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const item = {
  kind: 'match' as const, id: 'r1', startTime: '2026-07-18T16:30:00Z', endTime: null,
  label: 'Partie ouverte · Court 1',
  friends: [{ id: 'u2', firstName: 'Léa', lastName: 'M', avatarUrl: null }],
};

it('rien si vide', () => {
  const { container } = render(<FriendsAgendaRail items={[]} timezone="Europe/Paris" />);
  expect(container.firstChild).toBeNull();
});

it('carte → navigation vers la partie', () => {
  render(<FriendsAgendaRail items={[item]} timezone="Europe/Paris" />);
  fireEvent.click(screen.getByText('Partie ouverte · Court 1'));
  expect(push).toHaveBeenCalledWith('/parties/r1');
});

it('tournoi → /tournois/:id', () => {
  render(<FriendsAgendaRail items={[{ ...item, kind: 'tournament', id: 't1', label: 'P100' }]} timezone="Europe/Paris" />);
  fireEvent.click(screen.getByText('P100'));
  expect(push).toHaveBeenCalledWith('/tournois/t1');
});
```

`frontend/__tests__/FriendCard.test.tsx` :
```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { FriendCard } from '@/components/social/FriendCard';
// … mocks thème + api …
jest.mock('@/lib/useLevelSystem', () => ({ useLevelSystemEnabled: () => true }));

const friend = { id: 'u2', firstName: 'Léa', lastName: 'M', avatarUrl: null, mutual: true,
  playedTogetherCount: 12, lastPlayedTogetherAt: '2026-07-11T10:00:00', level: null };
const NOW = new Date('2026-07-14T10:00:00');

it('affiche la ligne vivante et déclenche les actions', () => {
  const onInvite = jest.fn(); const onMessage = jest.fn(); const onRemove = jest.fn();
  render(<FriendCard friend={friend} now={NOW} onInvite={onInvite} onMessage={onMessage} onRemove={onRemove} />);
  expect(screen.getByText('12 parties ensemble · samedi')).toBeInTheDocument();
  fireEvent.click(screen.getByText('⚡ Inviter à jouer'));
  expect(onInvite).toHaveBeenCalledWith(friend);
  fireEvent.click(screen.getByLabelText('Écrire à Léa M'));
  expect(onMessage).toHaveBeenCalledWith(friend);
  fireEvent.click(screen.getByText('Retirer'));
  expect(onRemove).toHaveBeenCalledWith(friend);
});

it('sans historique commun : pas de ligne vivante', () => {
  render(<FriendCard friend={{ ...friend, playedTogetherCount: 0, lastPlayedTogetherAt: null }} now={NOW}
    onInvite={jest.fn()} onMessage={jest.fn()} onRemove={jest.fn()} />);
  expect(screen.queryByText(/ensemble/)).not.toBeInTheDocument();
});
```

⚠️ Si `LevelChip` ou `Avatar` importent d'autres hooks non mockés, s'aligner sur les mocks des suites existantes (`FriendsQuickRow.test.tsx` est la référence).

- [ ] **Step 5 : Lancer les tests**

Run (depuis `frontend/`) :
```bash
node node_modules/jest/bin/jest.js __tests__/FriendRequestsBanner.test.tsx __tests__/FriendsAgendaRail.test.tsx __tests__/FriendCard.test.tsx
```
Expected: PASS.

- [ ] **Step 6 : Commit**

```bash
git add frontend/components/social/FriendRequestsBanner.tsx frontend/components/social/FriendsAgendaRail.tsx frontend/components/social/FriendCard.tsx frontend/__tests__/FriendRequestsBanner.test.tsx frontend/__tests__/FriendsAgendaRail.test.tsx frontend/__tests__/FriendCard.test.tsx
git commit -m "feat(amis): banniere demandes + rail ca joue bientot + carte ami"
```

---

### Task 12 : Frontend — Suggestions, Favoris ★, « Qui me suit »

**Files:**
- Create: `frontend/components/social/SuggestionsRow.tsx`
- Create: `frontend/components/social/FavoritesRow.tsx`
- Create: `frontend/components/social/FollowersFooter.tsx`
- Create: `frontend/__tests__/FriendsHubSections.test.tsx`

- [ ] **Step 1 : `SuggestionsRow.tsx`**

```tsx
'use client';
import { PlayerSuggestion } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';
import { LevelChip } from '@/components/player/LevelChip';
import { colorForSeed } from '@/lib/playerColors';
import { SectionHeader } from '@/components/clubhouse/SectionHeader';
import { FollowButton } from '@/components/social/FollowButton';
import { FriendButton } from '@/components/social/FriendButton';
import { suggestionReason } from '@/lib/social';

// « Suggestions » : partenaires récents pas encore dans mon cercle. Masqué si vide.
export function SuggestionsRow({ suggestions, slug, token, now, onChange, onMessage }: {
  suggestions: PlayerSuggestion[];
  slug: string;
  token: string;
  now: Date | null;
  onChange: () => void;
  onMessage: (s: { id: string }) => void;
}) {
  const { th } = useTheme();
  if (suggestions.length === 0) return null;
  return (
    <section aria-label="Suggestions">
      <SectionHeader title="Suggestions" />
      {suggestions.map((s) => (
        <div key={s.id} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, rowGap: 6, padding: '8px 4px', borderBottom: `1px solid ${th.line}` }}>
          <Avatar firstName={s.firstName} lastName={s.lastName} avatarUrl={s.avatarUrl} size={36} color={colorForSeed(s.id)} />
          <div style={{ flex: 1, minWidth: 150 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ fontFamily: th.fontUI, fontSize: 14.5, color: th.text, fontWeight: 600 }}>{s.firstName} {s.lastName}</span>
              {s.level != null && <LevelChip level={s.level} size="xs" />}
            </div>
            <div style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute, marginTop: 1 }}>{suggestionReason(s.lastPlayedAt, now)}</div>
          </div>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
            <button type="button" aria-label={`Écrire à ${s.firstName} ${s.lastName}`} title="Envoyer un message" onClick={() => onMessage(s)}
              style={{ border: `1px solid ${th.line}`, background: 'transparent', color: th.text, borderRadius: 999, padding: '5px 9px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}>
              <Icon name="chat" size={15} color={th.textMute} />
            </button>
            <FollowButton slug={slug} userId={s.id} token={token} initial={{ iFollow: false }} size="xs" onChange={onChange} />
            {s.requestable && <FriendButton slug={slug} userId={s.id} token={token} relation={{ status: 'none', requestable: true }} onChange={onChange} />}
          </span>
        </div>
      ))}
    </section>
  );
}
```

- [ ] **Step 2 : `FavoritesRow.tsx`**

```tsx
'use client';
import { useState } from 'react';
import { Friend } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';
import { SectionHeader } from '@/components/clubhouse/SectionHeader';

// « Favoris ★ » : chips compactes (avatar + prénom). Tap = barre d'actions rapides
// sous la rangée (💬 message / ⚡ inviter / retirer ★). Masqué si vide.
export function FavoritesRow({ favorites, onMessage, onInvite, onRemove }: {
  favorites: Friend[];
  onMessage: (f: Friend) => void;
  onInvite: (f: Friend) => void;
  onRemove: (f: Friend) => void;
}) {
  const { th } = useTheme();
  const [openId, setOpenId] = useState<string | null>(null);
  if (favorites.length === 0) return null;
  const selected = favorites.find((f) => f.id === openId) ?? null;

  const action: React.CSSProperties = {
    border: `1px solid ${th.line}`, background: 'transparent', color: th.text, borderRadius: 999,
    padding: '5px 11px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
  };

  return (
    <section aria-label="Favoris">
      <SectionHeader title={`Favoris ★ · ${favorites.length}`} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {favorites.map((f) => (
          <button key={f.id} type="button" aria-expanded={openId === f.id}
            onClick={() => setOpenId((o) => (o === f.id ? null : f.id))}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7,
              border: `1px solid ${openId === f.id ? th.accent : th.line}`, background: th.surface,
              borderRadius: 999, padding: '5px 12px 5px 5px', cursor: 'pointer' }}>
            <Avatar firstName={f.firstName} lastName={f.lastName} avatarUrl={f.avatarUrl} size={28} color={colorForSeed(f.id)} />
            <span style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, color: th.text }}>{f.firstName}</span>
          </button>
        ))}
      </div>
      {selected && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>{selected.firstName} {selected.lastName} :</span>
          <button type="button" style={action} onClick={() => onInvite(selected)}>⚡ Inviter</button>
          <button type="button" style={action} onClick={() => onMessage(selected)}>💬 Message</button>
          <button type="button" style={action} onClick={() => { onRemove(selected); setOpenId(null); }}>Retirer ★</button>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 3 : `FollowersFooter.tsx`**

```tsx
'use client';
import { useEffect, useState } from 'react';
import { Friend } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';
import { FollowButton } from '@/components/social/FollowButton';

// Pied discret « Qui me suit · N » (remplace l'onglet Abonnés) : repliable,
// « ★ Favori » en retour pour ceux que je ne suis pas encore.
export function FollowersFooter({ followers, slug, token, anchorOpen, onChange }: {
  followers: Friend[];
  slug: string;
  token: string;
  anchorOpen?: boolean;
  onChange: () => void;
}) {
  const { th } = useTheme();
  const [open, setOpen] = useState(!!anchorOpen);
  useEffect(() => { if (anchorOpen) setOpen(true); }, [anchorOpen]);

  return (
    <section id="fh-followers" aria-label="Qui me suit" style={{ borderTop: `1px solid ${th.line}`, paddingTop: 12 }}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0,
          fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, color: th.textMute }}>
        Qui me suit · {followers.length} {open ? '▴' : '▾'}
      </button>
      {open && (followers.length === 0
        ? <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, padding: '10px 0' }}>Personne ne vous suit pour l'instant.</div>
        : followers.map((f) => (
          <div key={f.id} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, rowGap: 6, padding: '8px 4px', borderBottom: `1px solid ${th.line}` }}>
            <Avatar firstName={f.firstName} lastName={f.lastName} avatarUrl={f.avatarUrl} size={32} color={colorForSeed(f.id)} />
            <span style={{ flex: 1, fontFamily: th.fontUI, fontSize: 14, color: th.text, fontWeight: 600 }}>{f.firstName} {f.lastName}</span>
            {!f.mutual && <FollowButton slug={slug} userId={f.id} token={token} initial={{ iFollow: false }} size="xs" onChange={onChange} />}
          </div>
        )))}
    </section>
  );
}
```

- [ ] **Step 4 : Tests des 3 sections**

Créer `frontend/__tests__/FriendsHubSections.test.tsx` :

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { SuggestionsRow } from '@/components/social/SuggestionsRow';
import { FavoritesRow } from '@/components/social/FavoritesRow';
import { FollowersFooter } from '@/components/social/FollowersFooter';

jest.mock('@/lib/ThemeProvider', () => ({ useTheme: () => ({ th: {
  accent: '#06c', onAccent: '#fff', surface: '#fff', surface2: '#eee', line: '#ccc',
  text: '#111', textMute: '#666', fontUI: 'sans-serif', fontDisplay: 'serif', mode: 'light',
} }) }));
jest.mock('@/lib/useLevelSystem', () => ({ useLevelSystemEnabled: () => true }));
jest.mock('@/lib/api', () => ({ assetUrl: (p: string | null) => p, api: {
  followUser: jest.fn().mockResolvedValue({ iFollow: true, followsMe: false, mutual: false }),
  unfollowUser: jest.fn().mockResolvedValue({ iFollow: false, followsMe: false, mutual: false }),
  requestFriend: jest.fn().mockResolvedValue({ status: 'pending_out', requestable: false }),
} }));

const friend = (id: string, first: string) => ({ id, firstName: first, lastName: 'X', avatarUrl: null, mutual: false });
const NOW = new Date('2026-07-14T10:00:00');

describe('SuggestionsRow', () => {
  const sugg = { id: 'p1', firstName: 'Karim', lastName: 'B', avatarUrl: null, level: null,
    lastPlayedAt: '2026-07-11T10:00:00', playedCount: 2, requestable: false };

  it('rien si vide', () => {
    const { container } = render(<SuggestionsRow suggestions={[]} slug="demo" token="t" now={NOW} onChange={jest.fn()} onMessage={jest.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('raison + pas de bouton ami si non requestable (jamais de bouton grisé)', () => {
    render(<SuggestionsRow suggestions={[sugg]} slug="demo" token="t" now={NOW} onChange={jest.fn()} onMessage={jest.fn()} />);
    expect(screen.getByText('Vous avez joué ensemble samedi')).toBeInTheDocument();
    expect(screen.getByText('☆ Favori')).toBeInTheDocument();
    expect(screen.queryByText(/N'accepte pas/)).not.toBeInTheDocument();
    expect(screen.queryByText('Ajouter')).not.toBeInTheDocument();
  });

  it('bouton ami présent si requestable', () => {
    render(<SuggestionsRow suggestions={[{ ...sugg, requestable: true }]} slug="demo" token="t" now={NOW} onChange={jest.fn()} onMessage={jest.fn()} />);
    // le libellé exact vient de FriendButton (état none/requestable)
    expect(screen.getByText(/Ajouter/)).toBeInTheDocument();
  });
});

describe('FavoritesRow', () => {
  it("chip → barre d'actions", () => {
    const onInvite = jest.fn();
    render(<FavoritesRow favorites={[friend('u2', 'Léa')]} onMessage={jest.fn()} onInvite={onInvite} onRemove={jest.fn()} />);
    fireEvent.click(screen.getByText('Léa'));
    fireEvent.click(screen.getByText('⚡ Inviter'));
    expect(onInvite).toHaveBeenCalled();
  });
});

describe('FollowersFooter', () => {
  it('replié par défaut, déplié par anchorOpen, ★ en retour si pas mutuel', () => {
    const { rerender } = render(<FollowersFooter followers={[friend('u2', 'Léa')]} slug="demo" token="t" onChange={jest.fn()} />);
    expect(screen.queryByText('Léa X')).not.toBeInTheDocument();
    rerender(<FollowersFooter followers={[friend('u2', 'Léa')]} slug="demo" token="t" anchorOpen onChange={jest.fn()} />);
    expect(screen.getByText('Léa X')).toBeInTheDocument();
    expect(screen.getByText('☆ Favori')).toBeInTheDocument();
  });
});
```

⚠️ Le libellé du `FriendButton` en état `none/requestable` est celui du composant existant (« Ajouter » ou similaire) — vérifier dans `frontend/components/social/FriendButton.tsx` et ajuster l'assertion au libellé réel.

- [ ] **Step 5 : Lancer les tests**

Run (depuis `frontend/`) :
```bash
node node_modules/jest/bin/jest.js __tests__/FriendsHubSections.test.tsx
```
Expected: PASS.

- [ ] **Step 6 : Commit**

```bash
git add frontend/components/social/SuggestionsRow.tsx frontend/components/social/FavoritesRow.tsx frontend/components/social/FollowersFooter.tsx frontend/__tests__/FriendsHubSections.test.tsx
git commit -m "feat(amis): sections suggestions + favoris + qui me suit"
```

---

### Task 13 : Frontend — réécriture de `FriendsHub` + page

**Files:**
- Rewrite: `frontend/components/social/FriendsHub.tsx`
- Modify: `frontend/app/me/friends/page.tsx`
- Rewrite: `frontend/__tests__/FriendsHub.test.tsx`

- [ ] **Step 1 : Réécrire `FriendsHub.tsx`**

Remplacer intégralement le contenu par :

```tsx
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ClubMemberSearchResult, Friend, FriendRequests, FriendsAgendaItem, PlayerSuggestion } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SectionHeader } from '@/components/clubhouse/SectionHeader';
import { FollowButton } from '@/components/social/FollowButton';
import { FriendButton } from '@/components/social/FriendButton';
import { LevelChip } from '@/components/player/LevelChip';
import { colorForSeed } from '@/lib/playerColors';
import { openDm } from '@/lib/messages';
import { dedupFavorites, FriendsAnchor } from '@/lib/social';
import { FriendRequestsBanner } from './FriendRequestsBanner';
import { FriendsAgendaRail } from './FriendsAgendaRail';
import { FriendCard } from './FriendCard';
import { SuggestionsRow } from './SuggestionsRow';
import { FavoritesRow } from './FavoritesRow';
import { FollowersFooter } from './FollowersFooter';

export const INVITE_DRAFT = 'On se fait une partie ?';

// Hub social « Mes amis » : scroll unique sans onglet — recherche (filtre mes joueurs +
// annuaire), bannière demandes, « ça joue bientôt », amis enrichis, suggestions,
// favoris ★ (dédupliqués des amis), pied « qui me suit ». Actions club-scoped via `slug`.
export function FriendsHub({ slug, token, timezone, anchor = null }: {
  slug: string;
  token: string;
  timezone: string;
  anchor?: FriendsAnchor;
}) {
  const { th } = useTheme();
  const isDesktop = useIsDesktop();
  const router = useRouter();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [requests, setRequests] = useState<FriendRequests>({ received: [], sent: [] });
  const [following, setFollowing] = useState<Friend[]>([]);
  const [followers, setFollowers] = useState<Friend[]>([]);
  const [agenda, setAgenda] = useState<FriendsAgendaItem[]>([]);
  const [suggestions, setSuggestions] = useState<PlayerSuggestion[]>([]);
  const [q, setQ] = useState('');
  const [searchResults, setSearchResults] = useState<ClubMemberSearchResult[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Friend | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); }, []);

  // Chaque brique échoue en silence : une section en erreur n'empêche pas le reste.
  const reload = useCallback(() => {
    Promise.allSettled([
      api.listFriendships(token).then(setFriends),
      api.listFriendRequests(token).then(setRequests),
      api.listFollowing(token).then(setFollowing),
      api.listFollowers(token).then(setFollowers),
      api.getFriendsAgenda(slug, token).then(setAgenda),
      api.getPlayerSuggestions(slug, token).then(setSuggestions),
    ]).then(() => setLoaded(true));
  }, [slug, token]);
  useEffect(() => { reload(); }, [reload]);

  // Annuaire débouncé (250 ms) dès qu'on tape — remplace l'onglet « Trouver ».
  useEffect(() => {
    const query = q.trim();
    if (!query) { setSearchResults([]); return; }
    const handle = setTimeout(() => {
      api.searchClubMembers(slug, query, token).then(setSearchResults).catch(() => setSearchResults([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [q, slug, token]);

  // Deep-link ?tab= : scroll une seule fois, une fois les données chargées.
  const didAnchor = useRef(false);
  useEffect(() => {
    if (!anchor || !loaded || didAnchor.current) return;
    didAnchor.current = true;
    document.getElementById(anchor === 'demandes' ? 'fh-demandes' : 'fh-followers')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [anchor, loaded]);

  const respond = async (userId: string, accept: boolean) => {
    setBusyId(userId);
    try { await api.respondFriend(slug, userId, accept, token); reload(); }
    catch { /* noop */ }
    finally { setBusyId(null); }
  };
  const cancelSent = async (userId: string) => {
    setBusyId(userId);
    try { await api.removeFriend(slug, userId, token); reload(); }
    catch { /* noop */ }
    finally { setBusyId(null); }
  };
  const removeFriend = async (f: Friend) => {
    setBusyId(f.id);
    try { await api.removeFriend(slug, f.id, token); reload(); }
    catch { /* noop */ }
    finally { setBusyId(null); setRemoveTarget(null); }
  };
  const removeFavorite = async (f: Friend) => {
    setBusyId(f.id);
    try { await api.unfollowUser(slug, f.id, token); reload(); }
    catch { /* noop */ }
    finally { setBusyId(null); }
  };
  const message = (f: { id: string }) => openDm(f.id, { isDesktop, navigate: (h) => router.push(h) });
  const invite = (f: { id: string }) => openDm(f.id, { isDesktop, navigate: (h) => router.push(h), draft: INVITE_DRAFT });

  const searching = q.trim().length > 0;
  const norm = q.trim().toLowerCase();
  const matchName = (f: Friend) => `${f.firstName} ${f.lastName}`.toLowerCase().includes(norm);
  const visibleFriends = searching ? friends.filter(matchName) : friends;
  const favorites = dedupFavorites(following, friends);
  const visibleFavorites = searching ? favorites.filter(matchName) : favorites;
  const emptyHub = loaded && !searching && friends.length === 0 && favorites.length === 0
    && suggestions.length === 0 && requests.received.length === 0 && requests.sent.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher ou ajouter un joueur…"
        aria-label="Rechercher un joueur"
        style={{ border: `1px solid ${th.line}`, background: th.surface2, color: th.text, borderRadius: 12,
          padding: '11px 13px', fontFamily: th.fontUI, fontSize: 14.5 }} />

      <FriendRequestsBanner requests={requests} busyId={busyId} onRespond={respond} onCancelSent={cancelSent} />

      {!searching && <FriendsAgendaRail items={agenda} timezone={timezone} />}

      {emptyHub && (
        <div style={{ fontFamily: th.fontUI, fontSize: 14.5, color: th.textMute, lineHeight: 1.5 }}>
          Retrouvez ici vos partenaires de jeu : cherchez un joueur ci-dessus pour l'ajouter en favori ★ ou en ami.
        </div>
      )}

      {visibleFriends.length > 0 && (
        <section aria-label="Amis">
          <SectionHeader title={`Amis · ${visibleFriends.length}`} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
            {visibleFriends.map((f) => (
              <FriendCard key={f.id} friend={f} now={now} busy={busyId === f.id}
                onInvite={invite} onMessage={message} onRemove={setRemoveTarget} />
            ))}
          </div>
        </section>
      )}

      {!searching && (
        <SuggestionsRow suggestions={suggestions} slug={slug} token={token} now={now} onChange={reload} onMessage={message} />
      )}

      <FavoritesRow favorites={visibleFavorites} onMessage={message} onInvite={invite} onRemove={removeFavorite} />

      {searching && (
        <section aria-label="Dans le club">
          <SectionHeader title="Dans le club" />
          {searchResults.length === 0
            ? <div style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute }}>Aucun membre trouvé.</div>
            : searchResults.map((r) => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, rowGap: 6, padding: '8px 4px', borderBottom: `1px solid ${th.line}` }}>
                <Avatar firstName={r.firstName} lastName={r.lastName} avatarUrl={r.avatarUrl ?? null} size={36} color={colorForSeed(r.id)} />
                <span style={{ flex: 1, fontFamily: th.fontUI, fontSize: 14.5, color: th.text, fontWeight: 600 }}>{r.firstName} {r.lastName}</span>
                {r.level != null && <LevelChip level={r.level} />}
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
                  <button type="button" aria-label={`Écrire à ${r.firstName} ${r.lastName}`} title="Envoyer un message" onClick={() => message(r)}
                    style={{ border: `1px solid ${th.line}`, background: 'transparent', color: th.text, borderRadius: 999,
                      padding: '5px 9px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}>
                    <Icon name="chat" size={15} color={th.textMute} />
                  </button>
                  <FollowButton slug={slug} userId={r.id} token={token} initial={{ iFollow: !!r.iFollow, mutual: !!r.mutual }} onChange={reload} />
                  {/* opt-out → aucun bouton ami (plus jamais de gros bouton grisé négatif) */}
                  {r.friend && (r.friend.requestable || r.friend.status !== 'none') && (
                    <FriendButton slug={slug} userId={r.id} token={token} relation={r.friend} onChange={reload} />
                  )}
                </span>
              </div>
            ))}
        </section>
      )}

      {!searching && <FollowersFooter followers={followers} slug={slug} token={token} anchorOpen={anchor === 'followers'} onChange={reload} />}

      {removeTarget && (
        <ConfirmDialog title="Retirer cet ami ?" detail={`${removeTarget.firstName} ${removeTarget.lastName}`}
          message="Vous pourrez renvoyer une demande plus tard."
          confirmLabel="Retirer" busy={busyId === removeTarget.id}
          onConfirm={() => removeFriend(removeTarget)} onCancel={() => setRemoveTarget(null)} />
      )}
    </div>
  );
}
```

- [ ] **Step 2 : Mettre à jour la page**

Dans `frontend/app/me/friends/page.tsx` :

```tsx
'use client';
import { useSearchParams } from 'next/navigation';
import { useTheme } from '@/lib/ThemeProvider';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { Screen } from '@/components/ui/Screen';
import { ClubNav } from '@/components/ClubNav';
import { FriendsHub } from '@/components/social/FriendsHub';
import { friendsAnchor } from '@/lib/social';

// Hub social du joueur. Disponible sur un hôte club (les actions sont club-scoped).
// Shell calqué sur /me/profile. ?tab=demandes|followers = ancre de scroll (deep-links notifs).
export default function FriendsPage() {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { slug, club } = useClub();

  const anchor = friendsAnchor(useSearchParams().get('tab'));

  if (!ready) return null;
  if (!token || !slug || !club) return null; // hub disponible sur un hôte club, connecté

  return (
    <Screen>
      <div style={{ paddingBottom: 48 }}>
        <ClubNav club={club} />

        <div style={{ padding: '18px 20px 0', fontFamily: th.fontDisplay, fontWeight: 500, fontSize: 38, lineHeight: 1.05, color: th.text, letterSpacing: -0.5 }}>
          Mes amis
        </div>

        <div style={{ padding: '18px 20px 0' }}>
          <FriendsHub slug={slug} token={token} timezone={club.timezone ?? 'Europe/Paris'} anchor={anchor} />
        </div>
      </div>
    </Screen>
  );
}
```

⚠️ Si le type du `club` de `useClub()` n'expose pas `timezone`, l'ajouter au type (champ déjà renvoyé par l'API club) plutôt que de caster.

- [ ] **Step 3 : Réécrire `FriendsHub.test.tsx`**

Remplacer intégralement par :

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FriendsHub, INVITE_DRAFT } from '@/components/social/FriendsHub';

jest.mock('@/lib/ThemeProvider', () => ({ useTheme: () => ({ th: {
  accent: '#06c', onAccent: '#fff', surface: '#fff', surface2: '#eee', line: '#ccc', bgElev: '#fff',
  text: '#111', textMute: '#666', fontUI: 'sans-serif', fontDisplay: 'serif', mode: 'light',
} }) }));
jest.mock('@/lib/useLevelSystem', () => ({ useLevelSystemEnabled: () => true }));
jest.mock('@/lib/useIsDesktop', () => ({ useIsDesktop: () => false }));
const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
const openDm = jest.fn();
jest.mock('@/lib/messages', () => ({ openDm: (...a: unknown[]) => openDm(...a) }));

const listFriendships = jest.fn();
const listFriendRequests = jest.fn();
const listFollowing = jest.fn();
const listFollowers = jest.fn();
const getFriendsAgenda = jest.fn();
const getPlayerSuggestions = jest.fn();
const searchClubMembers = jest.fn();
const respondFriend = jest.fn();
const removeFriend = jest.fn();
const unfollowUser = jest.fn();
jest.mock('@/lib/api', () => ({ assetUrl: (p: string | null) => p, api: {
  listFriendships: (...a: unknown[]) => listFriendships(...a),
  listFriendRequests: (...a: unknown[]) => listFriendRequests(...a),
  listFollowing: (...a: unknown[]) => listFollowing(...a),
  listFollowers: (...a: unknown[]) => listFollowers(...a),
  getFriendsAgenda: (...a: unknown[]) => getFriendsAgenda(...a),
  getPlayerSuggestions: (...a: unknown[]) => getPlayerSuggestions(...a),
  searchClubMembers: (...a: unknown[]) => searchClubMembers(...a),
  respondFriend: (...a: unknown[]) => respondFriend(...a),
  removeFriend: (...a: unknown[]) => removeFriend(...a),
  unfollowUser: (...a: unknown[]) => unfollowUser(...a),
  requestFriend: jest.fn(),
  followUser: jest.fn().mockResolvedValue({ iFollow: true, followsMe: false, mutual: false }),
} }));

const friend = (id: string, first: string, extra: object = {}) =>
  ({ id, firstName: first, lastName: 'X', avatarUrl: null, mutual: true, ...extra });

describe('FriendsHub (hub à sections)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    listFriendships.mockResolvedValue([friend('u2', 'Léa', { playedTogetherCount: 12, lastPlayedTogetherAt: '2026-07-11T10:00:00' })]);
    listFriendRequests.mockResolvedValue({ received: [], sent: [] });
    listFollowing.mockResolvedValue([friend('u2', 'Léa'), friend('u5', 'Adrien', { mutual: false })]);
    listFollowers.mockResolvedValue([]);
    getFriendsAgenda.mockResolvedValue([]);
    getPlayerSuggestions.mockResolvedValue([]);
    searchClubMembers.mockResolvedValue([]);
  });

  const mount = (props: object = {}) =>
    render(<FriendsHub slug="demo" token="t" timezone="Europe/Paris" {...props} />);

  it('amis en cartes riches, favoris dédupliqués des amis', async () => {
    mount();
    expect(await screen.findByText('Léa X')).toBeInTheDocument();
    expect(screen.getByText(/12 parties ensemble/)).toBeInTheDocument();
    // Léa est amie ET suivie → elle n'apparaît PAS dans Favoris ; Adrien si.
    expect(screen.getByText('Favoris ★ · 1')).toBeInTheDocument();
    expect(screen.getByText('Adrien')).toBeInTheDocument();
  });

  it('sections vides masquées (pas de bannière, pas de rail, pas de suggestions)', async () => {
    mount();
    await screen.findByText('Léa X');
    expect(screen.queryByText('Ça joue bientôt')).not.toBeInTheDocument();
    expect(screen.queryByText('Suggestions')).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Demandes d'ami")).not.toBeInTheDocument();
  });

  it('bannière demandes : accepter', async () => {
    listFriendRequests.mockResolvedValue({ received: [friend('u3', 'Tom', { mutual: false })], sent: [] });
    respondFriend.mockResolvedValue({ status: 'friends', requestable: false });
    mount();
    fireEvent.click(await screen.findByText('Accepter'));
    await waitFor(() => expect(respondFriend).toHaveBeenCalledWith('demo', 'u3', true, 't'));
  });

  it('rail agenda affiché quand il y a des items', async () => {
    getFriendsAgenda.mockResolvedValue([{ kind: 'match', id: 'r1', startTime: '2026-07-18T16:30:00Z', endTime: null,
      label: 'Partie ouverte · Court 1', friends: [{ id: 'u2', firstName: 'Léa', lastName: 'M', avatarUrl: null }] }]);
    mount();
    expect(await screen.findByText('Partie ouverte · Court 1')).toBeInTheDocument();
  });

  it('recherche → annuaire « Dans le club », opt-out sans bouton ami', async () => {
    searchClubMembers.mockResolvedValue([
      { id: 'm1', firstName: 'Ines', lastName: 'A', avatarUrl: null, iFollow: false, mutual: false, friend: { status: 'none', requestable: false } },
    ]);
    mount();
    await screen.findByText('Léa X');
    fireEvent.change(screen.getByLabelText('Rechercher un joueur'), { target: { value: 'ines' } });
    expect(await screen.findByText('Ines A')).toBeInTheDocument();
    expect(screen.getByText('Dans le club')).toBeInTheDocument();
    expect(screen.queryByText(/N'accepte pas/)).not.toBeInTheDocument();
    // le rail et le pied disparaissent pendant la recherche
    expect(screen.queryByText(/Qui me suit/)).not.toBeInTheDocument();
  });

  it('⚡ Inviter à jouer ouvre le DM avec le brouillon', async () => {
    mount();
    fireEvent.click(await screen.findByText('⚡ Inviter à jouer'));
    expect(openDm).toHaveBeenCalledWith('u2', expect.objectContaining({ draft: INVITE_DRAFT }));
  });

  it('retirer un ami passe par la confirmation', async () => {
    removeFriend.mockResolvedValue({ status: 'none', requestable: true });
    mount();
    fireEvent.click(await screen.findByText('Retirer'));
    expect(screen.getByText('Retirer cet ami ?')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Retirer', { selector: 'button:not([aria-label])' }));
    await waitFor(() => expect(removeFriend).toHaveBeenCalledWith('demo', 'u2', 't'));
  });

  it('deep-link ?tab=followers déplie le pied', async () => {
    listFollowers.mockResolvedValue([friend('u9', 'Zoé', { mutual: false })]);
    mount({ anchor: 'followers' });
    expect(await screen.findByText('Zoé X')).toBeInTheDocument();
  });

  it("état d'accueil quand tout est vide", async () => {
    listFriendships.mockResolvedValue([]);
    listFollowing.mockResolvedValue([]);
    mount();
    expect(await screen.findByText(/Retrouvez ici vos partenaires de jeu/)).toBeInTheDocument();
  });
});
```

⚠️ Deux pièges connus : (1) `scrollIntoView` n'existe pas en jsdom — s'il jette, le stubber en tête de suite : `window.HTMLElement.prototype.scrollIntoView = jest.fn();`. (2) Le sélecteur du bouton « Retirer » de la ConfirmDialog : si l'assertion `{ selector: … }` est fragile, utiliser `screen.getAllByText('Retirer')` et cliquer le dernier.

- [ ] **Step 4 : Lancer la suite**

Run (depuis `frontend/`) :
```bash
node node_modules/jest/bin/jest.js __tests__/FriendsHub.test.tsx
```
Expected: PASS (9 tests).

- [ ] **Step 5 : Type-check global frontend**

Run (depuis `frontend/`) :
```bash
node node_modules/typescript/bin/tsc --noEmit
```
Expected: 0 erreur sur les fichiers touchés (filtrer par grep si du WIP parallèle pollue).

- [ ] **Step 6 : Commit**

```bash
git add frontend/components/social/FriendsHub.tsx frontend/app/me/friends/page.tsx frontend/__tests__/FriendsHub.test.tsx
git commit -m "feat(amis): FriendsHub reecrit en hub a sections (zero onglet)"
```

---

### Task 14 : Vérifications finales

**Files:**
- Modify: `CLAUDE.md` (note d'évolution)

- [ ] **Step 1 : Suites complètes ciblées**

Run (depuis `backend/`) :
```bash
node node_modules/jest/bin/jest.js src/services/__tests__/socialHub.service.test.ts src/services/__tests__/friendship.service.test.ts src/services/__tests__/follow.service.test.ts src/routes/__tests__/social-hub.routes.test.ts src/routes/__tests__/friends.routes.test.ts src/routes/__tests__/follows.routes.test.ts src/email/__tests__/notifications.follow.test.ts
```
Run (depuis `frontend/`) :
```bash
node node_modules/jest/bin/jest.js __tests__/social.test.ts __tests__/FriendsHub.test.tsx __tests__/FriendsHubSections.test.tsx __tests__/FriendRequestsBanner.test.tsx __tests__/FriendsAgendaRail.test.tsx __tests__/FriendCard.test.tsx __tests__/openDm.test.ts __tests__/MessageComposer.draft.test.tsx __tests__/MessagesHub.test.tsx __tests__/FollowButton.test.tsx __tests__/FriendButton.test.tsx __tests__/FriendsQuickRow.test.tsx __tests__/OpenMatchCard.friends.test.tsx __tests__/PartnerSearch.friends.test.tsx __tests__/AddPlayerSheet.test.tsx __tests__/AssociateMemberPicker.test.tsx
```
Expected: PASS partout.

- [ ] **Step 2 : Type-check backend**

Run (depuis `backend/`) :
```bash
node node_modules/typescript/bin/tsc --noEmit
```
Expected: 0 erreur sur les fichiers touchés.

- [ ] **Step 3 : Vérification visuelle (skill `verify`)**

Démarrer la stack (`start.ps1`), puis vérifier avec la skill **verify** (compte `test@palova.fr` / `password123`, club `padel-arena-paris`) :
- `/me/friends` en clair + sombre, desktop 1280 + mobile 390 (⚠️ mobile : CDP `mobile:false` + width fixe 390 pour attraper un vrai débordement) ;
- état riche (amis + favoris + demandes — utiliser le seed / créer des follows en SQL si besoin) ET état vide ;
- recherche → annuaire, « ⚡ Inviter à jouer » → composer pré-rempli (widget desktop + page mobile) ;
- deep-links `/me/friends?tab=demandes` et `?tab=followers`.
Expected: aucun scroll horizontal, sections cohérentes, aucun bouton « N'accepte pas les demandes ».

- [ ] **Step 4 : Note CLAUDE.md**

Ajouter sous la section « Système d'amis (suivi de joueurs) (v1) » de `CLAUDE.md` une évolution datée 2026-07-14 résumant : hub à sections sans onglet, renommage Favoris (quick row / FollowButton / OpenMatchCard / notif follow.new), opt-in défaut ON (migration `friend_requests_default_on`), `SocialHubService` + routes `friends-agenda`/`player-suggestions`, `listFriends` enrichi, `openDm(draft)`/`initialDraft`, helpers `lib/social.ts`, composants `components/social/*`, et le pointeur spec/plan.

- [ ] **Step 5 : Commit final**

```bash
git add CLAUDE.md
git commit -m "docs: evolution Mes amis — hub social vivant (CLAUDE.md)"
```
