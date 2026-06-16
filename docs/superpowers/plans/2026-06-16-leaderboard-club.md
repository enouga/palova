# Leaderboard club — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter un classement des joueurs du club par niveau dans la page `/parties`, visible par tout membre connecté, où l'on ne figure que sur opt-in et avec ≥ 5 matchs joués.

**Architecture:** Un champ global `User.showInLeaderboard` (opt-in). Une méthode `ClubService.clubLeaderboard` (calquée sur `searchMembers`) qui joint membres ACTIFS du club et `PlayerRating` du sport, trie en JS par niveau puis rating, et calcule la situation du viewer. Une route `GET /api/clubs/:slug/leaderboard`. Côté front, `OpenMatches` gagne une bascule `Parties | Classement` qui affiche un nouveau composant content-only `Leaderboard`. L'opt-in se règle dans le panneau « moi » du classement et dans `/me/profile`.

**Tech Stack:** Prisma 7 (adapter-pg), Express 5, Jest + supertest, Next.js 16 (Turbopack), React 19, React Testing Library.

**Spec :** `docs/superpowers/specs/2026-06-16-leaderboard-club-design.md`

**Conventions du repo (rappels) :**
- Prisma : jamais `new PrismaClient()` seul — `src/db/prisma.ts` exporte `prisma`. Migrations additives.
- Docker compose : `docker-compose-v1.exe` (jamais `docker compose`).
- Tests back : `npm test` dans `backend/`, prisma mocké via `src/__mocks__/prisma`.
- Tests front : `npm test` dans `frontend/`.
- Sport par défaut partout : `'padel'`.

---

## File Structure

- `backend/prisma/schema.prisma` — ajout `User.showInLeaderboard`.
- `backend/prisma/migrations/<ts>_add_show_in_leaderboard/migration.sql` — migration additive.
- `backend/src/services/rating/level.ts` — ajout const `MIN_RANKED_MATCHES`.
- `backend/src/services/club.service.ts` — méthode `clubLeaderboard` (responsabilité : requêtes club-scoped + garde membre, déjà en place ici pour `searchMembers`).
- `backend/src/services/__tests__/club.service.test.ts` — tests du tri + calcul `me`.
- `backend/src/routes/clubs.ts` — route `GET /:slug/leaderboard`.
- `backend/src/routes/me.ts` — `PROFILE_SELECT` + `PATCH /` acceptent `showInLeaderboard`.
- `backend/src/routes/__tests__/me.routes.test.ts` — test PATCH du flag.
- `frontend/lib/api.ts` — types `ClubLeaderboard`, champ `showInLeaderboard`, méthode `getClubLeaderboard`.
- `frontend/components/openmatch/Leaderboard.tsx` — nouveau composant content-only.
- `frontend/components/openmatch/OpenMatches.tsx` — bascule `Parties | Classement`.
- `frontend/app/me/profile/page.tsx` — toggle « Apparaître dans les classements ».
- `frontend/__tests__/Leaderboard.test.tsx` — tests du composant.

---

## Task 1: Schéma — champ `User.showInLeaderboard`

**Files:**
- Modify: `backend/prisma/schema.prisma` (modèle `User`)
- Create: `backend/prisma/migrations/<ts>_add_show_in_leaderboard/migration.sql`

- [ ] **Step 1: Ajouter le champ au modèle `User`**

Dans `backend/prisma/schema.prisma`, dans le modèle `User`, ajouter (près des autres champs profil comme `locale`) :

```prisma
  showInLeaderboard Boolean @default(false) @map("show_in_leaderboard")
```

- [ ] **Step 2: Créer la migration additive**

Si Postgres tourne (`docker-compose-v1.exe up -d`), générer la migration :

Run (dans `backend/`) : `npx prisma migrate dev --name add_show_in_leaderboard --create-only`

Sinon, créer le fichier à la main `backend/prisma/migrations/20260616000000_add_show_in_leaderboard/migration.sql` :

```sql
-- AlterTable
ALTER TABLE "users" ADD COLUMN "show_in_leaderboard" BOOLEAN NOT NULL DEFAULT false;
```

- [ ] **Step 3: Régénérer le client Prisma**

Run (dans `backend/`) : `npx prisma generate`
Expected: « Generated Prisma Client » sans erreur.

- [ ] **Step 4: Appliquer la migration si Postgres tourne**

Run (dans `backend/`) : `npx prisma migrate deploy`
Expected: migration `add_show_in_leaderboard` appliquée (ou « No pending migrations » si déjà fait). Si Postgres est down, noter que la migration reste à appliquer au démarrage.

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(leaderboard): champ User.showInLeaderboard (opt-in classement)"
```

---

## Task 2: Backend — `ClubService.clubLeaderboard` + tests

**Files:**
- Modify: `backend/src/services/rating/level.ts` (ajout const)
- Modify: `backend/src/services/club.service.ts`
- Test: `backend/src/services/__tests__/club.service.test.ts`

- [ ] **Step 1: Ajouter la constante de seuil**

Dans `backend/src/services/rating/level.ts`, ajouter près des autres constantes :

```ts
/** Nb minimum de matchs joués pour figurer au classement du club. */
export const MIN_RANKED_MATCHES = 5;
```

- [ ] **Step 2: Écrire le test (échoue d'abord)**

Dans `backend/src/services/__tests__/club.service.test.ts`, ajouter un bloc. En tête du fichier, vérifier que `ClubService` est déjà importé (sinon `import { ClubService } from '../club.service';`) et qu'une instance existe (sinon `const service = new ClubService();`).

```ts
describe('clubLeaderboard', () => {
  const activeClub = { id: 'club-1', status: 'ACTIVE' };

  function mockBase() {
    prismaMock.club.findUnique.mockResolvedValue(activeClub as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-padel' } as any);
  }

  it('classe les joueurs par niveau décroissant puis rating, avec rangs', async () => {
    mockBase();
    prismaMock.clubMembership.findMany.mockResolvedValue([
      { user: { id: 'u2', firstName: 'Bea', lastName: 'B', avatarUrl: null, playerRatings: [{ displayLevel: 5.0, rating: 1700, matchesPlayed: 12 }] } },
      { user: { id: 'u1', firstName: 'Ana', lastName: 'A', avatarUrl: null, playerRatings: [{ displayLevel: 6.2, rating: 1820, matchesPlayed: 30 }] } },
      { user: { id: 'u3', firstName: 'Cy', lastName: 'C', avatarUrl: null, playerRatings: [{ displayLevel: 5.0, rating: 1750, matchesPlayed: 8 }] } },
    ] as any);
    prismaMock.user.findUnique.mockResolvedValue({ showInLeaderboard: true, playerRatings: [{ displayLevel: 6.2, matchesPlayed: 30 }] } as any);

    const res = await service.clubLeaderboard('padel-arena', 'u1', 'padel');
    expect(res.entries.map((e) => [e.rank, e.userId])).toEqual([[1, 'u1'], [2, 'u3'], [3, 'u2']]);
    expect(res.entries[0].tier).toBe('Avancé'); // namedTier(6.2)
    expect(res.me).toEqual({ optedIn: true, ranked: true, rank: 1, level: 6.2, matchesPlayed: 30, matchesToGo: 0 });
  });

  it('me non classé : opt-in mais pas assez de matchs → matchesToGo', async () => {
    mockBase();
    prismaMock.clubMembership.findMany.mockResolvedValue([] as any);
    prismaMock.user.findUnique.mockResolvedValue({ showInLeaderboard: true, playerRatings: [{ displayLevel: 3.4, matchesPlayed: 3 }] } as any);

    const res = await service.clubLeaderboard('padel-arena', 'u1', 'padel');
    expect(res.entries).toEqual([]);
    expect(res.me).toEqual({ optedIn: true, ranked: false, rank: null, level: 3.4, matchesPlayed: 3, matchesToGo: 2 });
  });

  it('me non opté : optedIn false, ranked false', async () => {
    mockBase();
    prismaMock.clubMembership.findMany.mockResolvedValue([] as any);
    prismaMock.user.findUnique.mockResolvedValue({ showInLeaderboard: false, playerRatings: [] } as any);

    const res = await service.clubLeaderboard('padel-arena', 'u1', 'padel');
    expect(res.me).toEqual({ optedIn: false, ranked: false, rank: null, level: null, matchesPlayed: 0, matchesToGo: 5 });
  });

  it('refuse un non-membre (MEMBERSHIP_REQUIRED)', async () => {
    prismaMock.club.findUnique.mockResolvedValue(activeClub as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue(null as any);
    await expect(service.clubLeaderboard('padel-arena', 'uX', 'padel')).rejects.toThrow('MEMBERSHIP_REQUIRED');
  });
});
```

- [ ] **Step 3: Lancer le test pour le voir échouer**

Run (dans `backend/`) : `npm test -- club.service.test.ts -t clubLeaderboard`
Expected: FAIL (`service.clubLeaderboard is not a function`).

- [ ] **Step 4: Implémenter la méthode**

Dans `backend/src/services/club.service.ts` : à l'import des helpers rating en tête du fichier, s'assurer d'importer `namedTier` et `MIN_RANKED_MATCHES` :

```ts
import { namedTier, MIN_RANKED_MATCHES } from './rating/level';
```

(Si un import depuis `./rating/level` existe déjà, ajouter ces noms à la liste.)

Ajouter la méthode dans la classe `ClubService` (après `searchMembers`, qui sert de modèle) :

```ts
  /** Classement du club pour un sport : membres ACTIFS opt-in avec >= MIN_RANKED_MATCHES, triés par niveau. */
  async clubLeaderboard(slug: string, callerUserId: string, sportKey = 'padel') {
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, status: true } });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    const caller = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId: callerUserId, clubId: club.id } },
      select: { status: true },
    });
    if (!caller || caller.status !== 'ACTIVE') throw new Error('MEMBERSHIP_REQUIRED');

    const sport = await prisma.sport.findUnique({ where: { key: sportKey }, select: { id: true } });
    if (!sport) throw new Error('SPORT_NOT_FOUND');

    const rows = await prisma.clubMembership.findMany({
      where: {
        clubId: club.id,
        status: 'ACTIVE',
        user: {
          showInLeaderboard: true,
          playerRatings: { some: { sportId: sport.id, matchesPlayed: { gte: MIN_RANKED_MATCHES } } },
        },
      },
      select: {
        user: {
          select: {
            id: true, firstName: true, lastName: true, avatarUrl: true,
            playerRatings: { where: { sportId: sport.id }, select: { displayLevel: true, rating: true, matchesPlayed: true } },
          },
        },
      },
    });

    const entries = rows
      .map((m) => ({ u: m.user, r: m.user.playerRatings[0] }))
      .filter((x) => x.r)
      .sort((a, b) => b.r.displayLevel - a.r.displayLevel || b.r.rating - a.r.rating)
      .map((x, i) => ({
        rank: i + 1,
        userId: x.u.id,
        firstName: x.u.firstName,
        lastName: x.u.lastName,
        avatarUrl: x.u.avatarUrl,
        level: x.r.displayLevel,
        tier: namedTier(x.r.displayLevel),
        matchesPlayed: x.r.matchesPlayed,
      }));

    const meUser = await prisma.user.findUnique({
      where: { id: callerUserId },
      select: { showInLeaderboard: true, playerRatings: { where: { sportId: sport.id }, select: { displayLevel: true, matchesPlayed: true } } },
    });
    const myRating = meUser?.playerRatings[0] ?? null;
    const matchesPlayed = myRating?.matchesPlayed ?? 0;
    const myRank = entries.find((e) => e.userId === callerUserId)?.rank ?? null;
    const me = {
      optedIn: meUser?.showInLeaderboard ?? false,
      ranked: myRank !== null,
      rank: myRank,
      level: myRating?.displayLevel ?? null,
      matchesPlayed,
      matchesToGo: Math.max(0, MIN_RANKED_MATCHES - matchesPlayed),
    };

    return { sport: sportKey, entries, me };
  }
```

- [ ] **Step 5: Lancer le test pour le voir passer**

Run (dans `backend/`) : `npm test -- club.service.test.ts -t clubLeaderboard`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/rating/level.ts backend/src/services/club.service.ts backend/src/services/__tests__/club.service.test.ts
git commit -m "feat(leaderboard): ClubService.clubLeaderboard (tri par niveau + situation viewer)"
```

---

## Task 3: Backend — route `GET /api/clubs/:slug/leaderboard`

**Files:**
- Modify: `backend/src/routes/clubs.ts`

- [ ] **Step 1: Ajouter la route**

Dans `backend/src/routes/clubs.ts`, près de la route `/:slug/members/search` (même garde `authMiddleware`, même helper `asString`, même `clubService`), ajouter :

```ts
// Classement des joueurs du club par niveau (réservé aux membres ; opt-in pour y figurer).
router.get('/:slug/leaderboard', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sport = typeof req.query.sport === 'string' ? req.query.sport : 'padel';
    res.json(await clubService.clubLeaderboard(asString(req.params.slug), req.user!.id, sport));
  } catch (err) { handleError(err, res, next); }
});
```

- [ ] **Step 2: Vérifier la compilation TypeScript**

Run (dans `backend/`) : `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 3: Lancer la suite back complète**

Run (dans `backend/`) : `npm test`
Expected: tout vert (la baseline était 653 tests + les 4 ajoutés).

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/clubs.ts
git commit -m "feat(leaderboard): route GET /api/clubs/:slug/leaderboard"
```

---

## Task 4: Backend — `PATCH /api/me` accepte `showInLeaderboard`

**Files:**
- Modify: `backend/src/routes/me.ts` (`PROFILE_SELECT` + handler `PATCH /`)
- Test: `backend/src/routes/__tests__/me.routes.test.ts`

- [ ] **Step 1: Écrire le test (échoue d'abord)**

Dans `backend/src/routes/__tests__/me.routes.test.ts` :

1. Ajouter `showInLeaderboard: false` à la constante `PROFILE` (en haut du fichier).
2. Dans le `describe('PATCH /api/me')`, ajouter :

```ts
  it('rejette showInLeaderboard non booléen (400)', async () => {
    const res = await request(app).patch('/api/me').set('Authorization', `Bearer ${token()}`).send({ showInLeaderboard: 'oui' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('showInLeaderboard invalide');
  });

  it('met à jour showInLeaderboard', async () => {
    prismaMock.user.update.mockResolvedValue({ ...PROFILE, showInLeaderboard: true } as any);
    const res = await request(app).patch('/api/me').set('Authorization', `Bearer ${token()}`).send({ showInLeaderboard: true });
    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { showInLeaderboard: true } }));
    expect(res.body.showInLeaderboard).toBe(true);
  });
```

- [ ] **Step 2: Lancer le test pour le voir échouer**

Run (dans `backend/`) : `npm test -- me.routes.test.ts -t showInLeaderboard`
Expected: FAIL (400 non renvoyé / champ absent).

- [ ] **Step 3: Implémenter**

Dans `backend/src/routes/me.ts` :

1. Ajouter `showInLeaderboard: true,` à `PROFILE_SELECT`.
2. Dans le handler `PATCH /`, étendre la destructuration et le type `data`, puis ajouter la validation :

```ts
    const { phone, sex, birthDate, locale, showInLeaderboard } = req.body;
    const data: { phone?: string | null; sex?: 'MALE' | 'FEMALE' | null; birthDate?: Date | null; locale?: string | null; showInLeaderboard?: boolean } = {};
```

Puis, avant l'appel `prisma.user.update`, ajouter :

```ts
    if (showInLeaderboard !== undefined) {
      if (typeof showInLeaderboard !== 'boolean') return void res.status(400).json({ error: 'showInLeaderboard invalide' });
      data.showInLeaderboard = showInLeaderboard;
    }
```

- [ ] **Step 4: Lancer le test pour le voir passer**

Run (dans `backend/`) : `npm test -- me.routes.test.ts`
Expected: PASS (y compris les 2 nouveaux).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/me.ts backend/src/routes/__tests__/me.routes.test.ts
git commit -m "feat(leaderboard): PATCH /api/me accepte showInLeaderboard"
```

---

## Task 5: Frontend — client API (types + méthodes)

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Ajouter le champ au type profil + au payload updateMyProfile**

Dans `frontend/lib/api.ts` :

1. Dans `interface MyProfile`, ajouter : `showInLeaderboard: boolean;`
2. Dans la signature de `updateMyProfile`, ajouter le champ optionnel :

```ts
  updateMyProfile: (body: { phone?: string | null; sex?: Sex | null; birthDate?: string | null; locale?: string | null; showInLeaderboard?: boolean }, token: string) =>
    request<MyProfile>('/api/me', { method: 'PATCH', body: JSON.stringify(body) }, token),
```

- [ ] **Step 2: Ajouter le type `ClubLeaderboard` et la méthode**

Près des autres types rating (après `RatingPoint`), ajouter :

```ts
export interface LeaderboardEntry {
  rank: number;
  userId: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  level: number;
  tier: string;
  matchesPlayed: number;
}

export interface LeaderboardMe {
  optedIn: boolean;
  ranked: boolean;
  rank: number | null;
  level: number | null;
  matchesPlayed: number;
  matchesToGo: number;
}

export interface ClubLeaderboard {
  sport: string;
  entries: LeaderboardEntry[];
  me: LeaderboardMe;
}
```

Dans l'objet `api` (près de `getMyRating`), ajouter :

```ts
  getClubLeaderboard: (slug: string, token: string, sport = 'padel') =>
    request<ClubLeaderboard>(`/api/clubs/${encodeURIComponent(slug)}/leaderboard?sport=${encodeURIComponent(sport)}`, {}, token),
```

- [ ] **Step 3: Vérifier la compilation**

Run (dans `frontend/`) : `npx tsc --noEmit`
Expected: aucune erreur (d'autres fichiers consommant `MyProfile` pourraient exiger le champ — voir Task 8 pour `/me/profile`).

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(leaderboard): client API getClubLeaderboard + showInLeaderboard"
```

---

## Task 6: Frontend — composant `Leaderboard`

**Files:**
- Create: `frontend/components/openmatch/Leaderboard.tsx`
- Test: `frontend/__tests__/Leaderboard.test.tsx`

- [ ] **Step 1: Écrire le test (échoue d'abord)**

Créer `frontend/__tests__/Leaderboard.test.tsx` :

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { Leaderboard } from '@/components/openmatch/Leaderboard';

// useTheme exige un ThemeProvider (cf. PlayerPills.test.tsx).
const wrap = (ui: React.ReactNode) => render(<ThemeProvider>{ui}</ThemeProvider>);

const club = { slug: 'padel-arena', name: 'Padel Arena' } as any;

const updateMyProfile = jest.fn();
const getClubLeaderboard = jest.fn();
jest.mock('@/lib/api', () => ({
  api: {
    getClubLeaderboard: (...a: any[]) => getClubLeaderboard(...a),
    updateMyProfile: (...a: any[]) => updateMyProfile(...a),
  },
  assetUrl: (u: string | null) => u,
}));
jest.mock('@/lib/useAuth', () => ({ useAuth: () => ({ token: 't', ready: true }) }));

function payload(over: any = {}) {
  return {
    sport: 'padel',
    entries: [
      { rank: 1, userId: 'u1', firstName: 'Ana', lastName: 'A', avatarUrl: null, level: 6.2, tier: 'Avancé', matchesPlayed: 30 },
      { rank: 2, userId: 'u2', firstName: 'Bea', lastName: 'B', avatarUrl: null, level: 5.0, tier: 'Confirmé', matchesPlayed: 12 },
    ],
    me: { optedIn: true, ranked: true, rank: 1, level: 6.2, matchesPlayed: 30, matchesToGo: 0 },
    ...over,
  };
}

beforeEach(() => { jest.clearAllMocks(); });

it('affiche les lignes classées dans l ordre', async () => {
  getClubLeaderboard.mockResolvedValue(payload());
  wrap(<Leaderboard club={club} viewerUserId="u1" />);
  await screen.findByText('Ana A');
  const names = screen.getAllByTestId('lb-name').map((n) => n.textContent);
  expect(names).toEqual(['Ana A', 'Bea B']);
});

it('panneau moi : opt-in mais pas assez de matchs → matchesToGo', async () => {
  getClubLeaderboard.mockResolvedValue(payload({ entries: [], me: { optedIn: true, ranked: false, rank: null, level: 3.4, matchesPlayed: 3, matchesToGo: 2 } }));
  wrap(<Leaderboard club={club} viewerUserId="u9" />);
  await screen.findByText(/Encore 2 matchs/i);
});

it('panneau moi : pas opté → CTA qui appelle updateMyProfile', async () => {
  getClubLeaderboard.mockResolvedValue(payload({ entries: [], me: { optedIn: false, ranked: false, rank: null, level: null, matchesPlayed: 0, matchesToGo: 5 } }));
  updateMyProfile.mockResolvedValue({});
  getClubLeaderboard.mockResolvedValueOnce(payload({ entries: [], me: { optedIn: false, ranked: false, rank: null, level: null, matchesPlayed: 0, matchesToGo: 5 } }));
  wrap(<Leaderboard club={club} viewerUserId="u9" />);
  const cta = await screen.findByRole('button', { name: /Apparaître dans le classement/i });
  fireEvent.click(cta);
  await waitFor(() => expect(updateMyProfile).toHaveBeenCalledWith({ showInLeaderboard: true }, 't'));
});

it('état vide quand aucun joueur classé et déjà opté', async () => {
  getClubLeaderboard.mockResolvedValue(payload({ entries: [], me: { optedIn: true, ranked: false, rank: null, level: 6.0, matchesPlayed: 9, matchesToGo: 0 } }));
  wrap(<Leaderboard club={club} viewerUserId="u9" />);
  await screen.findByText(/Aucun joueur classé/i);
});
```

- [ ] **Step 2: Lancer le test pour le voir échouer**

Run (dans `frontend/`) : `npm test -- Leaderboard.test.tsx`
Expected: FAIL (module `Leaderboard` introuvable).

- [ ] **Step 3: Implémenter le composant**

Créer `frontend/components/openmatch/Leaderboard.tsx` :

```tsx
'use client';
import { useEffect, useState, useCallback } from 'react';
import { api, ClubDetail, ClubLeaderboard } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { useAuth } from '@/lib/useAuth';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';

// Classement des joueurs du club par niveau. Content-only (pas de Screen/ClubNav) :
// rendu dans l'onglet « Classement » d'OpenMatches.
export function Leaderboard({ club, viewerUserId }: { club: ClubDetail; viewerUserId: string | null }) {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const [data, setData] = useState<ClubLeaderboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [optingIn, setOptingIn] = useState(false);

  const load = useCallback(async () => {
    if (!token) { setData(null); setLoading(false); return; }
    setLoading(true);
    try { setData(await api.getClubLeaderboard(club.slug, token)); }
    catch { setData(null); }
    finally { setLoading(false); }
  }, [club.slug, token]);

  useEffect(() => { if (ready) load(); }, [ready, load]);

  const optIn = async () => {
    if (!token) return;
    setOptingIn(true);
    try { await api.updateMyProfile({ showInLeaderboard: true }, token); await load(); }
    finally { setOptingIn(false); }
  };

  const card: React.CSSProperties = { background: th.surface, borderRadius: 16, padding: '14px 16px', boxShadow: `inset 0 0 0 1px ${th.line}` };
  const muted: React.CSSProperties = { fontFamily: th.fontUI, fontSize: 14, color: th.textMute, lineHeight: 1.5 };

  if (!ready || loading) {
    return <div style={{ padding: '24px 20px', textAlign: 'center', ...muted }}>Chargement…</div>;
  }
  if (!token || !data) {
    return <div style={{ padding: '24px 20px', textAlign: 'center', ...muted }}>Connectez-vous pour voir le classement.</div>;
  }

  const { entries, me } = data;

  return (
    <div style={{ padding: '14px 20px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Panneau « moi » */}
      <div style={{ ...card, background: th.accent, color: th.onAccent, boxShadow: 'none' }}>
        {me.ranked ? (
          <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 15 }}>
            Vous êtes {me.rank}<sup>e</sup> sur {entries.length} · niveau {me.level!.toFixed(1)}
          </span>
        ) : me.optedIn && me.matchesToGo > 0 ? (
          <span style={{ fontFamily: th.fontUI, fontWeight: 600, fontSize: 14.5 }}>
            Encore {me.matchesToGo} match{me.matchesToGo > 1 ? 's' : ''} pour être classé.
          </span>
        ) : !me.optedIn ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{ fontFamily: th.fontUI, fontWeight: 600, fontSize: 14.5 }}>Vous n&apos;apparaissez pas dans le classement.</span>
            <button onClick={optIn} disabled={optingIn}
              style={{ alignSelf: 'flex-start', background: th.onAccent, color: th.accent, border: 'none', borderRadius: 999, padding: '8px 16px', fontFamily: th.fontUI, fontWeight: 700, fontSize: 13.5, cursor: 'pointer', opacity: optingIn ? 0.6 : 1 }}>
              Apparaître dans le classement
            </button>
          </div>
        ) : (
          <span style={{ fontFamily: th.fontUI, fontWeight: 600, fontSize: 14.5 }}>Vous figurez au classement dès qu&apos;il y aura des joueurs classés.</span>
        )}
      </div>

      {/* Liste */}
      {entries.length === 0 ? (
        <div style={{ padding: '20px 0', textAlign: 'center', ...muted }}>
          Aucun joueur classé pour le moment. Activez l&apos;affichage et jouez des matchs pour apparaître.
        </div>
      ) : entries.map((e) => {
        const mine = e.userId === viewerUserId;
        return (
          <div key={e.userId} style={{ ...card, ...(mine ? { boxShadow: `inset 0 0 0 2px ${th.accent}` } : {}), display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 17, color: th.textMute, width: 28, textAlign: 'center', flexShrink: 0 }}>{e.rank}</span>
            <Avatar firstName={e.firstName} lastName={e.lastName} avatarUrl={e.avatarUrl} size={36} color={colorForSeed(e.userId)} />
            <span data-testid="lb-name" style={{ fontFamily: th.fontUI, fontWeight: 600, fontSize: 15, color: th.text, flex: 1, minWidth: 0 }}>
              {e.firstName} {e.lastName}
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: th.fontUI }}>
              <strong style={{ fontSize: 15, color: th.text }}>{e.level.toFixed(1)}</strong>
              <span style={{ fontSize: 12.5, color: th.textMute }}>{e.tier}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Lancer le test pour le voir passer**

Run (dans `frontend/`) : `npm test -- Leaderboard.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/openmatch/Leaderboard.tsx frontend/__tests__/Leaderboard.test.tsx
git commit -m "feat(leaderboard): composant Leaderboard (panneau moi + liste classée)"
```

---

## Task 7: Frontend — bascule `Parties | Classement` dans `OpenMatches`

**Files:**
- Modify: `frontend/components/openmatch/OpenMatches.tsx`

- [ ] **Step 1: Importer la bascule, le composant et l'identité du viewer**

En tête de `frontend/components/openmatch/OpenMatches.tsx`, ajouter aux imports :

```ts
import { Segmented } from '@/components/ui/atoms';
import { Leaderboard } from '@/components/openmatch/Leaderboard';
```

`useAuth()` est déjà appelé dans ce composant. Récupérer aussi l'id du viewer : repérer la ligne `const { token, ready } = useAuth();` et la remplacer par :

```ts
  const { token, ready, userId } = useAuth();
```

(Vérifier que `useAuth` expose `userId` ; sinon, voir Step 1bis.)

- [ ] **Step 1bis (si besoin) : exposer userId depuis useAuth**

Si `frontend/lib/useAuth.ts` n'expose pas `userId`, l'extraire du token JWT déjà décodé, ou ajouter au retour du hook le champ existant. Inspecter `frontend/lib/useAuth.ts` :

Run : `grep -n "return\|userId\|id" frontend/lib/useAuth.ts`

Si l'id n'y est pas, le plus simple : passer `null` en `viewerUserId` (le surlignage du viewer est cosmétique) — remplacer l'usage par `viewerUserId={null}` et ne pas toucher `useAuth`. Privilégier cette voie si `useAuth` ne fournit pas l'id proprement.

- [ ] **Step 2: Ajouter l'état de vue**

Près des autres `useState` du composant, ajouter :

```ts
  const [view, setView] = useState<'parties' | 'classement'>('parties');
```

- [ ] **Step 3: Insérer la bascule et brancher le rendu**

Juste après `<ClubNav club={club} />` dans le JSX, insérer :

```tsx
        <div style={{ padding: '16px 20px 0' }}>
          <Segmented<'parties' | 'classement'>
            value={view}
            onChange={setView}
            options={[{ value: 'parties', label: 'Parties' }, { value: 'classement', label: 'Classement' }]}
          />
        </div>
```

Puis envelopper tout le bloc existant (du `<div style={{ padding: '18px 20px 0' }}>` titre « Parties ouvertes » jusqu'à la fin de la liste des matchs, inclus le bloc `error`) dans une condition `view === 'parties'`, et rendre le classement sinon. Concrètement, encadrer le contenu existant :

```tsx
        {view === 'parties' ? (
          <>
            {/* …tout le contenu actuel : titre, filtre « À mon niveau », error, liste des matchs… */}
          </>
        ) : (
          <Leaderboard club={club} viewerUserId={userId ?? null} />
        )}
```

(Si Step 1bis a conclu de ne pas toucher `useAuth`, utiliser `viewerUserId={null}`.)

- [ ] **Step 4: Vérifier compilation + tests front**

Run (dans `frontend/`) : `npx tsc --noEmit`
Expected: aucune erreur.
Run (dans `frontend/`) : `npm test -- OpenMatches`
Expected: les tests existants d'OpenMatches passent toujours (le rendu par défaut reste « Parties »).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/openmatch/OpenMatches.tsx frontend/lib/useAuth.ts
git commit -m "feat(leaderboard): bascule Parties | Classement dans /parties"
```

---

## Task 8: Frontend — toggle opt-in dans `/me/profile`

**Files:**
- Modify: `frontend/app/me/profile/page.tsx`

- [ ] **Step 1: Repérer la zone des préférences**

Ouvrir `frontend/app/me/profile/page.tsx` et repérer le bloc « Langue » (`changeLocale`, le `<select>` ligne ~285) et le bloc « Thème » (`<Segmented<ThemeMode> …>` ligne ~292). Le nouveau réglage se place à côté, dans la même carte de préférences.

- [ ] **Step 2: Ajouter le handler optimiste**

Près de `changeLocale`, ajouter (en s'inspirant de son motif optimiste + `savingLocale`) :

```ts
  const [savingLeaderboard, setSavingLeaderboard] = useState(false);
  const changeLeaderboard = async (next: boolean) => {
    if (!token || !profile) return;
    setSavingLeaderboard(true);
    setProfile({ ...profile, showInLeaderboard: next }); // optimiste
    try { setProfile(await api.updateMyProfile({ showInLeaderboard: next }, token)); }
    finally { setSavingLeaderboard(false); }
  };
```

- [ ] **Step 3: Ajouter le contrôle (Segmented Oui/Non)**

À côté du réglage Thème, ajouter une rangée libellée « Apparaître dans les classements » :

```tsx
                <Segmented<'oui' | 'non'>
                  value={profile.showInLeaderboard ? 'oui' : 'non'}
                  onChange={(v) => changeLeaderboard(v === 'oui')}
                  options={[{ value: 'oui', label: 'Oui' }, { value: 'non', label: 'Non' }]}
                />
```

(Reprendre exactement la structure de libellé/rangée utilisée pour « Thème » dans ce fichier, en remplaçant `disabled` éventuel par `savingLeaderboard` si le composant l'accepte ; sinon laisser sans `disabled`.)

- [ ] **Step 4: Vérifier compilation + tests**

Run (dans `frontend/`) : `npx tsc --noEmit`
Expected: aucune erreur (le champ `showInLeaderboard` est désormais requis sur `MyProfile` — vérifier que les mocks de `MeProfile.test.tsx` qui construisent un `MyProfile` incluent le champ ; si un test échoue, ajouter `showInLeaderboard: false` au profil mocké).
Run (dans `frontend/`) : `npm test -- MeProfile`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/me/profile/page.tsx frontend/__tests__/MeProfile.test.tsx
git commit -m "feat(leaderboard): réglage « apparaître dans les classements » dans /me/profile"
```

---

## Vérification finale (gate)

- [ ] **Back complet** — Run (dans `backend/`) : `npm test` → tout vert.
- [ ] **Back types** — Run (dans `backend/`) : `npx tsc --noEmit` → aucune erreur.
- [ ] **Front complet** — Run (dans `frontend/`) : `npm test` → tout vert.
- [ ] **Front types** — Run (dans `frontend/`) : `npx tsc --noEmit` → aucune erreur.
- [ ] **Vérif visuelle** (si Postgres + back + front tournent) : ouvrir `/parties`, basculer sur « Classement », vérifier le panneau « moi » dans ses états (activer/désactiver l'opt-in), le surlignage de sa propre ligne, l'ordre par niveau.
- [ ] **Revue de code** via superpowers:requesting-code-review avant intégration.

---

## Notes d'intégration

- Migration additive `add_show_in_leaderboard` à appliquer au déploiement (au boot, comme les précédentes).
- Aucun changement de forme des réponses existantes (additif partout). `MyProfile.showInLeaderboard` devient requis côté front → seuls les mocks de tests construisant un profil sont impactés.
- Hors périmètre (specs séparées du Lot 4) : reco « parties pour toi », corrections niveau staff, sélecteur multi-sport.
