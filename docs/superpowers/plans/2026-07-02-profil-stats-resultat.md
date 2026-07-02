# Stats de résultat dans « Mon niveau » (`/me/profile`) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Afficher le bilan V/D + taux + série du joueur, scopé au club courant (padel), sous le `LevelBadge` de la section « Mon niveau » du profil.

**Architecture:** Endpoint dédié léger `GET /api/clubs/:slug/me/match-stats` adossé à un helper backend partagé (`computeClubMatchStats`, extrait de `clubLeaderboard`) ; côté front, un composant présentation partagé `ResultStats` (prop `tone`) réutilisé par le classement (refactor) et le profil.

**Tech Stack:** Backend Express/Prisma/Jest ; Frontend Next.js 16/React (client component), React Testing Library. Tests depuis le **worktree** (`node_modules` jonctionné). ⚠️ Cette feature dépend de `computeResultStats` (`backend/src/services/rating/resultStats.ts`) déjà présent sur cette branche.

**Spec :** `docs/superpowers/specs/2026-07-02-profil-stats-resultat-design.md`

> ⚠️ **Pièges de la worktree** : travailler et tester UNIQUEMENT sous `...\palova\.claude\worktrees\emails-personnalisables\...` (les chemins `...\palova\backend|frontend` sont le dépôt principal, code périmé). Backend : `cd backend && npx jest <pattern>` (config `jest.config.ts` auto-détectée). Frontend : `cd frontend && npx jest <pattern>` + `npx tsc --noEmit`. **Ne jamais `git commit`** dans les subagents (le coordinateur commit). Frontend : respecter `frontend/AGENTS.md` (Next.js à breaking changes) — ici on ne touche que du React client standard.

---

## Task 1 : Backend — helper partagé `computeClubMatchStats` + méthode `myClubMatchStats`

**Files:**
- Modify: `backend/src/services/club.service.ts`
- Test: `backend/src/services/__tests__/club.service.test.ts`

- [ ] **Step 1 : Écrire les tests (TDD)**

Dans `backend/src/services/__tests__/club.service.test.ts`, ajouter ce bloc `describe` (par ex. juste après le `describe('clubLeaderboard', …)`) :

```ts
describe('myClubMatchStats', () => {
  const service = new ClubService();
  beforeEach(() => jest.clearAllMocks());

  it('renvoie le bilan V/D + série du club (scopé club+sport+CONFIRMED)', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-1', status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-padel' } as any);
    // desc : W, W, L → wins 2, losses 1, streak 2
    prismaMock.matchPlayer.findMany.mockResolvedValue([
      { team: 1, match: { winningTeam: 1, playedAt: new Date('2026-06-05') } },
      { team: 1, match: { winningTeam: 1, playedAt: new Date('2026-06-04') } },
      { team: 1, match: { winningTeam: 2, playedAt: new Date('2026-06-03') } },
    ] as any);

    const res = await service.myClubMatchStats('arena', 'u1', 'padel');
    expect(res).toEqual({ wins: 2, losses: 1, streak: 2 });
    expect(prismaMock.matchPlayer.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'u1', match: { clubId: 'club-1', status: 'CONFIRMED', sportId: 'sport-padel' } },
    }));
  });

  it('non-membre → MEMBERSHIP_REQUIRED', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-1', status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue(null as any);
    await expect(service.myClubMatchStats('arena', 'uX', 'padel')).rejects.toThrow('MEMBERSHIP_REQUIRED');
  });

  it('club inconnu → CLUB_NOT_FOUND', async () => {
    prismaMock.club.findUnique.mockResolvedValue(null as any);
    await expect(service.myClubMatchStats('nope', 'u1', 'padel')).rejects.toThrow('CLUB_NOT_FOUND');
  });

  it('sport inconnu → SPORT_NOT_FOUND', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-1', status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);
    prismaMock.sport.findUnique.mockResolvedValue(null as any);
    await expect(service.myClubMatchStats('arena', 'u1', 'curling')).rejects.toThrow('SPORT_NOT_FOUND');
  });
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `cd backend && npx jest club.service -t myClubMatchStats`
Expected: FAIL — `service.myClubMatchStats is not a function`.

- [ ] **Step 3 : Implémenter (extraction du helper + nouvelle méthode)**

Dans `backend/src/services/club.service.ts` :

**(3a)** Élargir l'import de `resultStats` pour récupérer le type `ResultStats`. Remplacer :
```ts
import { computeResultStats } from './rating/resultStats';
```
par :
```ts
import { computeResultStats, ResultStats } from './rating/resultStats';
```

**(3b)** Dans `clubLeaderboard`, remplacer le `Promise.all([...])` qui parallélise `meUser` + `myMatches` puis calcule `stats` :
```ts
    // meUser (niveau/opt-in) et myMatches (bilan V/D du club) sont indépendants → en parallèle.
    const [meUser, myMatches] = await Promise.all([
      prisma.user.findUnique({
        where: { id: callerUserId },
        select: { showInLeaderboard: true, playerRatings: { where: { sportId: sport.id }, select: { displayLevel: true, matchesPlayed: true } } },
      }),
      prisma.matchPlayer.findMany({
        where: { userId: callerUserId, match: { clubId: club.id, status: 'CONFIRMED', sportId: sport.id } },
        orderBy: { match: { playedAt: 'desc' } },
        select: { team: true, match: { select: { winningTeam: true, playedAt: true } } },
      }),
    ]);
    const myRating = meUser?.playerRatings[0] ?? null;
    const matchesPlayed = myRating?.matchesPlayed ?? 0;
    const myRank = entries.find((e) => e.userId === callerUserId)?.rank ?? null;
    const stats = computeResultStats(
      myMatches.map((mp) => ({ team: mp.team, winningTeam: mp.match.winningTeam, playedAt: mp.match.playedAt })),
    );
```
par (le helper porte la requête matchPlayer + `computeResultStats`, la parallélisation est préservée) :
```ts
    // meUser (niveau/opt-in) et le bilan V/D du club sont indépendants → en parallèle.
    const [meUser, stats] = await Promise.all([
      prisma.user.findUnique({
        where: { id: callerUserId },
        select: { showInLeaderboard: true, playerRatings: { where: { sportId: sport.id }, select: { displayLevel: true, matchesPlayed: true } } },
      }),
      this.computeClubMatchStats(club.id, callerUserId, sport.id),
    ]);
    const myRating = meUser?.playerRatings[0] ?? null;
    const matchesPlayed = myRating?.matchesPlayed ?? 0;
    const myRank = entries.find((e) => e.userId === callerUserId)?.rank ?? null;
```
(Le reste du `const me = { … wins: stats.wins, losses: stats.losses, streak: stats.streak }` et le `return` restent inchangés.)

**(3c)** Ajouter, juste après la fin de la méthode `clubLeaderboard` (avant `getMyMembership`), le helper privé + la méthode publique :
```ts
  /** Bilan V/D + série d'un joueur pour un club + sport donnés (matchs CONFIRMED). Partagé classement/profil. */
  private async computeClubMatchStats(clubId: string, userId: string, sportId: string): Promise<ResultStats> {
    const rows = await prisma.matchPlayer.findMany({
      where: { userId, match: { clubId, status: 'CONFIRMED', sportId } },
      orderBy: { match: { playedAt: 'desc' } },
      select: { team: true, match: { select: { winningTeam: true, playedAt: true } } },
    });
    return computeResultStats(rows.map((mp) => ({ team: mp.team, winningTeam: mp.match.winningTeam, playedAt: mp.match.playedAt })));
  }

  /** Bilan V/D + série du joueur connecté, scopé à ce club + sport (défaut padel) — pour le profil. */
  async myClubMatchStats(slug: string, userId: string, sportKey = 'padel'): Promise<ResultStats> {
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, status: true } });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    const m = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId, clubId: club.id } },
      select: { status: true },
    });
    if (!m || m.status !== 'ACTIVE') throw new Error('MEMBERSHIP_REQUIRED');
    const sport = await prisma.sport.findUnique({ where: { key: sportKey }, select: { id: true } });
    if (!sport) throw new Error('SPORT_NOT_FOUND');
    return this.computeClubMatchStats(club.id, userId, sport.id);
  }
```

- [ ] **Step 4 : Vérifier**

Run: `cd backend && npx jest club.service` → tout PASS (nouveaux tests + `clubLeaderboard` inchangé).
Run: `cd backend && npx tsc --noEmit` → aucune erreur.

- [ ] **Step 5 : (coordinateur) commit** — `backend/src/services/club.service.ts` + `backend/src/services/__tests__/club.service.test.ts`.

---

## Task 2 : Backend — route `GET /:slug/me/match-stats`

**Files:**
- Modify: `backend/src/routes/clubs.ts`
- Test: `backend/src/routes/__tests__/clubs.match-stats.routes.test.ts` (nouveau)

- [ ] **Step 1 : Écrire le test de route**

Create `backend/src/routes/__tests__/clubs.match-stats.routes.test.ts` (calqué sur `clubs.leaderboard.routes.test.ts`) :
```ts
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET manquant');
const token = () => jwt.sign({ id: 'u1', email: 'test@x.fr' }, process.env.JWT_SECRET!);

describe('GET /api/clubs/:slug/me/match-stats', () => {
  beforeEach(() => jest.clearAllMocks());

  it('200 renvoie le bilan V/D + série du club', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-1', status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-padel' } as any);
    prismaMock.matchPlayer.findMany.mockResolvedValue([
      { team: 1, match: { winningTeam: 1, playedAt: new Date('2026-06-05') } },
      { team: 1, match: { winningTeam: 2, playedAt: new Date('2026-06-04') } },
    ] as any);

    const res = await request(app)
      .get('/api/clubs/arena/me/match-stats?sport=padel')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ wins: 1, losses: 1, streak: 1 });
  });

  it('401 sans token', async () => {
    const res = await request(app).get('/api/clubs/arena/me/match-stats');
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `cd backend && npx jest clubs.match-stats`
Expected: FAIL — le 200 renvoie 404 (route inexistante).

- [ ] **Step 3 : Implémenter la route**

Dans `backend/src/routes/clubs.ts`, ajouter — à la suite des autres routes `/:slug/me/*` (par ex. juste après la route `GET '/:slug/me/payments'`) :
```ts
// Bilan V/D + série du joueur connecté sur ce club (padel par défaut) — pour la carte « Mon niveau ».
router.get('/:slug/me/match-stats', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sport = typeof req.query.sport === 'string' ? req.query.sport : undefined;
    res.json(await clubService.myClubMatchStats(asString(req.params.slug), req.user!.id, sport));
  } catch (err) { handleError(err, res, next); }
});
```
(`clubService`, `authMiddleware`, `asString`, `handleError`, `AuthRequest`, `Response`, `NextFunction` sont déjà importés/instanciés dans ce fichier — vérifier, ne pas ré-importer.)

- [ ] **Step 4 : Vérifier**

Run: `cd backend && npx jest clubs.match-stats` → PASS (2 tests).
Run: `cd backend && npx tsc --noEmit` → aucune erreur.

- [ ] **Step 5 : (coordinateur) commit** — `backend/src/routes/clubs.ts` + le nouveau test.

---

## Task 3 : Frontend — composant `ResultStats` + refactor du classement

**Files:**
- Create: `frontend/components/player/ResultStats.tsx`
- Test: `frontend/__tests__/ResultStats.test.tsx` (nouveau)
- Modify: `frontend/components/openmatch/Leaderboard.tsx`
- (Le test `frontend/__tests__/Leaderboard.test.tsx` NE change PAS mais doit rester vert.)

- [ ] **Step 1 : Test du composant**

Create `frontend/__tests__/ResultStats.test.tsx` :
```tsx
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { ResultStats } from '@/components/player/ResultStats';

const wrap = (ui: React.ReactNode) => render(<ThemeProvider>{ui}</ThemeProvider>);

it('affiche matchs, taux, V/D et pastille de série (victoires)', () => {
  wrap(<ResultStats wins={18} losses={7} streak={3} tone="onSurface" />);
  expect(screen.getByText(/25 matchs/i)).toBeInTheDocument();
  expect(screen.getByText(/72\s*% de victoires/i)).toBeInTheDocument();
  expect(screen.getByText(/18 V/)).toBeInTheDocument();
  expect(screen.getByText(/3 victoires d'affilée/i)).toBeInTheDocument();
});

it('série de défaites → pastille "défaites"', () => {
  wrap(<ResultStats wins={10} losses={12} streak={-2} tone="onSurface" />);
  expect(screen.getByText(/2 défaites d'affilée/i)).toBeInTheDocument();
});

it('ne rend rien sans match décidé', () => {
  const { container } = wrap(<ResultStats wins={0} losses={0} streak={0} tone="onSurface" />);
  expect(container).toBeEmptyDOMElement();
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `cd frontend && npx jest ResultStats`
Expected: FAIL — module `@/components/player/ResultStats` introuvable.

- [ ] **Step 3 : Créer le composant**

Create `frontend/components/player/ResultStats.tsx` :
```tsx
'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { winRate } from '@/lib/memberStats';

// Rangée de stats de résultat (V/D · taux · série). Présentation pure, réutilisée par
// le classement (tone 'onAccent', sur fond accent) et le profil (tone 'onSurface').
export function ResultStats({ wins, losses, streak, tone }: { wins: number; losses: number; streak: number; tone: 'onAccent' | 'onSurface' }) {
  const { th } = useTheme();
  const decided = wins + losses;
  if (decided === 0) return null;
  const rate = winRate(wins, losses) ?? 0;
  const streakN = Math.abs(streak);
  const streakWin = streak > 0;
  const onAccent = tone === 'onAccent';
  const pillBg = streakWin ? (onAccent ? th.onAccent : th.accent) : ACCENTS.coral;
  const pillFg = streakWin ? (onAccent ? th.accent : th.onAccent) : '#fff';
  return (
    <div style={{
      ...(onAccent ? { borderTop: `1px solid ${th.onAccent}33`, paddingTop: 10 } : {}),
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 14px',
      fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600, color: onAccent ? th.onAccent : th.text,
    }}>
      <span>{decided} match{decided > 1 ? 's' : ''}</span>
      <span>{rate}% de victoires</span>
      <span>{wins} V · {losses} D</span>
      {streakN > 0 && (
        <span style={{ borderRadius: 999, padding: '2px 9px', fontSize: 12.5, fontWeight: 700, background: pillBg, color: pillFg }}>
          {streakN} {streakWin ? 'victoire' : 'défaite'}{streakN > 1 ? 's' : ''} d&apos;affilée
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 4 : Refactor du classement pour utiliser `ResultStats`**

Dans `frontend/components/openmatch/Leaderboard.tsx` :

**(4a)** Remplacer les imports `ACCENTS`/`winRate` (devenus inutiles) par l'import du composant. Supprimer les lignes :
```ts
import { ACCENTS } from '@/lib/theme';
```
et
```ts
import { winRate } from '@/lib/memberStats';
```
et ajouter :
```ts
import { ResultStats } from '@/components/player/ResultStats';
```

**(4b)** Supprimer le bloc de constantes dérivées (devenu inutile) juste après `const { entries, me } = data;` :
```ts
  const wins = me.wins ?? 0;
  const losses = me.losses ?? 0;
  const decided = wins + losses;
  const rate = winRate(wins, losses) ?? 0;
  const streakN = Math.abs(me.streak ?? 0);
  const streakWin = (me.streak ?? 0) > 0;
```

**(4c)** Remplacer la rangée inline (le bloc `{decided > 0 && ( <div …> … </div> )}` dans le panneau « moi ») :
```tsx
        {decided > 0 && (
          <div style={{ borderTop: `1px solid ${th.onAccent}33`, paddingTop: 10, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 14px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>
            <span>{decided} match{decided > 1 ? 's' : ''}</span>
            <span>{rate}% de victoires</span>
            <span>{wins} V · {losses} D</span>
            {streakN > 0 && (
              <span style={{ borderRadius: 999, padding: '2px 9px', fontSize: 12.5, fontWeight: 700, background: streakWin ? th.onAccent : ACCENTS.coral, color: streakWin ? th.accent : '#fff' }}>
                {streakN} {streakWin ? 'victoire' : 'défaite'}{streakN > 1 ? 's' : ''} d&apos;affilée
              </span>
            )}
          </div>
        )}
```
par :
```tsx
        <ResultStats tone="onAccent" wins={me.wins ?? 0} losses={me.losses ?? 0} streak={me.streak ?? 0} />
```

- [ ] **Step 5 : Vérifier**

Run: `cd frontend && npx jest ResultStats Leaderboard` → tout PASS (ResultStats 3 tests + Leaderboard 10 tests **inchangés et verts**).
Run: `cd frontend && npx tsc --noEmit` → aucune erreur (vérifier qu'il ne reste aucune référence à `ACCENTS`/`winRate`/`wins`/`decided` dans `Leaderboard.tsx`).

- [ ] **Step 6 : (coordinateur) commit** — `frontend/components/player/ResultStats.tsx`, `frontend/__tests__/ResultStats.test.tsx`, `frontend/components/openmatch/Leaderboard.tsx`.

---

## Task 4 : Frontend — API + section « Mon niveau » du profil

**Files:**
- Modify: `frontend/lib/api.ts`
- Modify: `frontend/app/me/profile/page.tsx`
- Test: `frontend/__tests__/MeProfile.test.tsx`

- [ ] **Step 1 : Type + méthode API**

Dans `frontend/lib/api.ts` :

**(1a)** Ajouter le type (près de `LeaderboardMe`/`ClubLeaderboard`) :
```ts
export interface ClubMatchStats { wins: number; losses: number; streak: number; }
```

**(1b)** Ajouter la méthode dans l'objet `api` (juste après `getClubLeaderboard`) :
```ts
  getMyClubMatchStats: (slug: string, token: string, sport = 'padel') =>
    request<ClubMatchStats>(`/api/clubs/${encodeURIComponent(slug)}/me/match-stats?sport=${encodeURIComponent(sport)}`, {}, token),
```

- [ ] **Step 2 : Écrire les tests profil (échec attendu)**

Dans `frontend/__tests__/MeProfile.test.tsx` :

**(2a)** Ajouter `getMyClubMatchStats: jest.fn(),` dans l'objet `api` du `jest.mock('../lib/api', …)` (au milieu des autres `jest.fn()`).

**(2b)** Dans le `beforeEach`, ajouter un défaut neutre (0/0/0 → rien ne s'affiche) :
```ts
    api.getMyClubMatchStats.mockResolvedValue({ wins: 0, losses: 0, streak: 0 });
```

**(2c)** Ajouter deux tests dans le `describe('Page Mon profil', …)` :
```ts
  it('affiche les stats de résultat du club sous le niveau', async () => {
    clubCtx = { slug: 'arena', club: { id: 'c1', slug: 'arena', name: 'Padel Arena', levelSystemEnabled: true }, loading: false };
    api.getMyRating.mockResolvedValue({ level: 5.2, tier: 'Confirmé', isProvisional: false, reliability: 0.85, calibrated: true, matchesPlayed: 25 });
    api.getMyClubMatchStats.mockResolvedValue({ wins: 18, losses: 7, streak: 3 });
    wrap();
    expect(await screen.findByText(/Résultats · Padel Arena/i)).toBeInTheDocument();
    expect(screen.getByText(/25 matchs/i)).toBeInTheDocument();
    expect(screen.getByText(/72\s*% de victoires/i)).toBeInTheDocument();
    expect(screen.getByText(/3 victoires d'affilée/i)).toBeInTheDocument();
  });

  it("pas de stats de résultat sur l'hôte plateforme (slug null)", async () => {
    // clubCtx reste { slug: null } (défaut du beforeEach)
    api.getMyRating.mockResolvedValue({ level: 5.2, tier: 'Confirmé', isProvisional: false, reliability: 0.85, calibrated: true, matchesPlayed: 25 });
    api.getMyClubMatchStats.mockResolvedValue({ wins: 18, losses: 7, streak: 3 });
    wrap();
    await screen.findByText('Eric');
    expect(screen.queryByText(/Résultats ·/i)).toBeNull();
    expect(api.getMyClubMatchStats).not.toHaveBeenCalled();
  });
```

Run: `cd frontend && npx jest MeProfile` → les 2 nouveaux tests ÉCHOUENT (rangée pas encore rendue / méthode non câblée).

- [ ] **Step 3 : Câbler la page profil**

Dans `frontend/app/me/profile/page.tsx` :

**(3a)** Importer le composant (près des autres imports de composants) :
```ts
import { ResultStats } from '@/components/player/ResultStats';
```
et ajouter le type `ClubMatchStats` à l'import de types depuis `@/lib/api` (ajouter `ClubMatchStats` à la liste existante).

**(3b)** Ajouter l'état, près de `const [rating, setRating] = useState<MyRating | null>(null);` :
```ts
  const [matchStats, setMatchStats] = useState<ClubMatchStats | null>(null);
```

**(3c)** Ajouter un effet, juste après l'effet qui charge `rating`/`history` (deps `[token, ratingSport]`) :
```ts
  // Bilan V/D du club courant (padel) — seulement sur un hôte club où l'on est membre.
  useEffect(() => {
    if (!token || !slug) { setMatchStats(null); return; }
    api.getMyClubMatchStats(slug, token, ratingSport).then(setMatchStats).catch(() => setMatchStats(null));
  }, [token, slug, ratingSport]);
```

**(3d)** Dans la section niveau, brancher le rendu **entre** la rangée `LevelBadge`/« Réévaluer » et l'historique. Trouver :
```tsx
                      {rating.calibrated && <div style={{ marginTop: 10 }}><LevelHistoryChart points={history} /></div>}
```
et insérer **juste avant** cette ligne :
```tsx
                      {matchStats && matchStats.wins + matchStats.losses > 0 && (
                        <div style={{ marginTop: 10 }}>
                          <div style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textFaint, marginBottom: 4 }}>Résultats · {club?.name}</div>
                          <ResultStats tone="onSurface" wins={matchStats.wins} losses={matchStats.losses} streak={matchStats.streak} />
                        </div>
                      )}
```
(`th`, `club`, `slug` sont déjà en scope dans ce composant.)

- [ ] **Step 4 : Vérifier**

Run: `cd frontend && npx jest MeProfile ResultStats Leaderboard` → tout PASS.
Run: `cd frontend && npx tsc --noEmit` → aucune erreur.

- [ ] **Step 5 : (coordinateur) commit** — `frontend/lib/api.ts`, `frontend/app/me/profile/page.tsx`, `frontend/__tests__/MeProfile.test.tsx`.

---

## Vérification finale

- [ ] Back : `cd backend && npx jest club.service clubs.match-stats clubs.leaderboard resultStats` → tout PASS ; `npx tsc --noEmit` clean.
- [ ] Front : `cd frontend && npx jest ResultStats Leaderboard MeProfile` → tout PASS ; `npx tsc --noEmit` clean.
- [ ] (Manuel, optionnel) `/me/profile` sur un hôte club, joueur avec matchs padel confirmés → « Résultats · {club} » + rangée sous le niveau ; sur l'hôte plateforme → pas de rangée.

## Notes

- **Additif, aucune migration.** Le refactor de `clubLeaderboard` et de la rangée du classement préserve le rendu observable (tests classement inchangés).
- Commits ciblés par fichiers explicites (jamais `git add -A`) — dépôt édité en parallèle.
