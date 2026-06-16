# Niveau de joueur — Lot 2a (Backend : matchs, confirmation, application des niveaux) — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Enregistrer un résultat de match (depuis une réservation COURT à 4 joueurs), le faire confirmer par les autres joueurs (auto-validation 72 h), appliquer la mise à jour Glicko-2 des 4 niveaux, et gérer les litiges côté staff — côté **backend uniquement** (l'UI est le Lot 2b).

**Architecture :** Un module PUR `match-rating.ts` câble le moteur Glicko-2 (Lot 1) au format match 2v2 (chaque joueur mis à jour contre l'équipe adverse moyennée, score pondéré par la marge) + une décote d'inactivité. Deux modèles `Match`/`MatchPlayer`. Un `MatchService` orchestre création → confirmation/contestation → finalisation (application des niveaux en transaction Serializable, idempotente). Un job cron auto-valide les matchs périmés. Notifications best-effort réutilisant l'infra email.

**Tech Stack :** Express 5, Prisma 7 (adapter-pg, transactions Serializable), node-cron, Jest + supertest, nodemailer.

**Spec :** `docs/superpowers/specs/2026-06-16-systeme-niveau-joueur-design.md`
**Pré-requis Lot 1 (déjà fait, sur origin/main `f2611cf`)** : `backend/src/services/rating/{glicko2,score,level}.ts`, modèle `PlayerRating`, `RatingService`.

**Machine :** worktree `C:\dev\palova-wt-niveau`, branche `feat/player-rating-lot1` (continue dessus). Postgres up (`palova_postgres_1`). Commandes backend depuis `C:\dev\palova-wt-niveau\backend`. Tests Prisma mockés via `src/__mocks__/prisma.ts` (`mockDeep` → tous les modèles auto-mockés). **Ne JAMAIS reset la DB partagée** (migration additive seulement).

---

### Task 1: Modèle `Match` + `MatchPlayer` + migration

**Files:**
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1: Ajouter les enums + modèles**

Ajouter ces deux enums près des autres enums en haut du schéma :

```prisma
enum MatchStatus {
  PENDING
  CONFIRMED
  DISPUTED
  CANCELLED
}

enum MatchPlayerConfirmation {
  PENDING
  CONFIRMED
  DISPUTED
}
```

Ajouter ces deux modèles après `model PlayerRating { ... }` :

```prisma
/// Résultat d'un match 2v2 enregistré (depuis une réservation COURT à 4 joueurs).
/// Sa confirmation déclenche la mise à jour Glicko des 4 PlayerRating (une seule fois).
model Match {
  id               String      @id @default(cuid())
  clubId           String      @map("club_id")
  sportId          String      @map("sport_id")
  reservationId    String?     @map("reservation_id")
  playedAt         DateTime    @map("played_at") @db.Timestamptz
  status           MatchStatus @default(PENDING)
  createdByUserId  String      @map("created_by_user_id")
  sets             Json        // [[6,4],[3,6],[7,5]] = [jeuxÉquipe1, jeuxÉquipe2] par set
  winningTeam      Int?        @map("winning_team") // 1|2, dérivé des sets
  confirmDeadline  DateTime    @map("confirm_deadline") // createdAt + 72 h
  ratingsAppliedAt DateTime?   @map("ratings_applied_at") // non-null ⇒ niveaux déjà appliqués (idempotence)
  createdAt        DateTime    @default(now()) @map("created_at")
  updatedAt        DateTime    @updatedAt @map("updated_at")

  club        Club          @relation(fields: [clubId], references: [id], onDelete: Cascade)
  sport       Sport         @relation(fields: [sportId], references: [id], onDelete: Restrict)
  reservation Reservation?  @relation(fields: [reservationId], references: [id], onDelete: SetNull)
  creator     User          @relation("MatchCreator", fields: [createdByUserId], references: [id], onDelete: Restrict)
  players     MatchPlayer[]

  @@index([clubId, status, playedAt])
  @@index([status, confirmDeadline]) // sélection des matchs à auto-valider
  @@index([reservationId])
  @@map("matches")
}

/// Un des 4 joueurs d'un match, son équipe et sa confirmation. Snapshots de niveau pour audit/courbe.
model MatchPlayer {
  id           String                  @id @default(cuid())
  matchId      String                  @map("match_id")
  userId       String                  @map("user_id")
  team         Int                     // 1 ou 2
  confirmation MatchPlayerConfirmation @default(PENDING)
  ratingBefore Float?                  @map("rating_before") // displayLevel avant
  ratingAfter  Float?                  @map("rating_after")  // displayLevel après (courbe)
  createdAt    DateTime                @default(now()) @map("created_at")

  match Match @relation(fields: [matchId], references: [id], onDelete: Cascade)
  user  User  @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([matchId, userId])
  @@index([userId])
  @@map("match_players")
}
```

Ajouter les relations inverses :
- `model Club` (après `clubSports ClubSport[]` ou près des autres) : `  matches Match[]`
- `model Sport` (après `playerRatings PlayerRating[]`) : `  matches Match[]`
- `model Reservation` (après `participants ReservationParticipant[]`) : `  matches Match[]`
- `model User` (après `playerRatings PlayerRating[]`) :
  ```prisma
  matchPlayers   MatchPlayer[]
  createdMatches Match[]       @relation("MatchCreator")
  ```

- [ ] **Step 2: Générer + appliquer la migration**

Run: `cd C:\dev\palova-wt-niveau\backend && npx prisma migrate dev --name add_matches`
Expected: migration additive (CREATE TABLE matches + match_players + 2 enums), client régénéré, "in sync".
**GUARD :** si Prisma demande un RESET/DROP de la base → ABANDONNER (ne pas confirmer) et reporter `STATUS: BLOCKED`. Vérifier que le `migration.sql` ne fait que CREATE (aucun DROP/ALTER de table existante).

- [ ] **Step 3: tsc**

Run: `cd C:\dev\palova-wt-niveau\backend && npx tsc --noEmit`
Expected: PASS (client connaît `prisma.match`, `prisma.matchPlayer`).

- [ ] **Step 4: Commit**

```bash
cd C:\dev\palova-wt-niveau
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(rating): modèles Match + MatchPlayer + migration additive"
```

---

### Task 2: Module pur `match-rating.ts` (câblage Glicko 2v2 + décote)

**Files:**
- Create: `backend/src/services/rating/match-rating.ts`
- Test: `backend/src/services/rating/__tests__/match-rating.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/services/rating/__tests__/match-rating.test.ts
import { applyMatchRatings, decayForInactivity, TeamPlayer, RATING_PERIOD_DAYS } from '../match-rating';

const P = (rating: number, team: 1 | 2): TeamPlayer => ({ rating, rd: 200, volatility: 0.06, team });

describe('applyMatchRatings', () => {
  it('les gagnants montent, les perdants descendent', () => {
    // équipe 1 gagne 6-2 6-2
    const players: TeamPlayer[] = [P(1500, 1), P(1500, 1), P(1500, 2), P(1500, 2)];
    const out = applyMatchRatings(players, [[6, 2], [6, 2]]);
    expect(out[0].rating).toBeGreaterThan(1500); // gagnant
    expect(out[2].rating).toBeLessThan(1500);    // perdant
  });

  it('battre une équipe plus forte rapporte plus que battre une plus faible', () => {
    const vsStrong = applyMatchRatings([P(1500, 1), P(1500, 1), P(1800, 2), P(1800, 2)], [[6, 4], [6, 4]]);
    const vsWeak = applyMatchRatings([P(1500, 1), P(1500, 1), P(1200, 2), P(1200, 2)], [[6, 4], [6, 4]]);
    expect(vsStrong[0].rating - 1500).toBeGreaterThan(vsWeak[0].rating - 1500);
  });

  it('préserve l ordre des joueurs en sortie', () => {
    const out = applyMatchRatings([P(1500, 1), P(1600, 1), P(1400, 2), P(1300, 2)], [[6, 0], [6, 0]]);
    expect(out).toHaveLength(4);
  });
});

describe('decayForInactivity', () => {
  it('aucune décote sous une période', () => {
    const s = decayForInactivity({ rating: 1500, rd: 100, volatility: 0.06 }, RATING_PERIOD_DAYS - 1);
    expect(s.rd).toBe(100);
    expect(s.rating).toBe(1500);
  });
  it('le RD remonte après plusieurs périodes, la note ne bouge pas', () => {
    const s = decayForInactivity({ rating: 1500, rd: 100, volatility: 0.06 }, RATING_PERIOD_DAYS * 5);
    expect(s.rd).toBeGreaterThan(100);
    expect(s.rating).toBe(1500);
  });
  it('le RD reste borné à 350', () => {
    const s = decayForInactivity({ rating: 1500, rd: 100, volatility: 0.3 }, RATING_PERIOD_DAYS * 500);
    expect(s.rd).toBeLessThanOrEqual(350);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

`cd C:\dev\palova-wt-niveau\backend && npx jest src/services/rating/__tests__/match-rating.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implementation**

```ts
// backend/src/services/rating/match-rating.ts
// Câble le moteur Glicko-2 (Lot 1) au format match 2v2 : chaque joueur est mis à jour contre
// l'ÉQUIPE adverse (note moyenne + RD quadratique moyen), score pondéré par la marge. Module PUR.
import { updateRating, RatingState, Opponent, MAX_RD } from './glicko2';
import { outcomeScore, SetScore } from './score';

export interface TeamPlayer extends RatingState { team: 1 | 2; }

export const RATING_PERIOD_DAYS = 7; // une « période » Glicko = 1 semaine

/** Regonfle le RD pour `days` d'inactivité (la note ne bouge jamais), borné à MAX_RD. */
export function decayForInactivity(state: RatingState, days: number): RatingState {
  const periods = Math.floor(Math.max(0, days) / RATING_PERIOD_DAYS);
  let s = state;
  for (let i = 0; i < periods && s.rd < MAX_RD; i++) s = updateRating(s, []);
  return s;
}

const teamAggregate = (players: RatingState[]): { rating: number; rd: number } => ({
  rating: players.reduce((sum, p) => sum + p.rating, 0) / players.length,
  rd: Math.sqrt(players.reduce((sum, p) => sum + p.rd * p.rd, 0) / players.length),
});

/** Nouveaux états des joueurs après un match 2v2. Ordre de sortie = ordre d'entrée. */
export function applyMatchRatings(players: TeamPlayer[], sets: SetScore[]): RatingState[] {
  const agg1 = teamAggregate(players.filter((p) => p.team === 1));
  const agg2 = teamAggregate(players.filter((p) => p.team === 2));
  const score1 = outcomeScore(sets, 1);
  const score2 = outcomeScore(sets, 2);
  return players.map((p) => {
    const opp = p.team === 1 ? agg2 : agg1;
    const opponent: Opponent = { rating: opp.rating, rd: opp.rd, score: p.team === 1 ? score1 : score2 };
    return updateRating({ rating: p.rating, rd: p.rd, volatility: p.volatility }, [opponent]);
  });
}
```

- [ ] **Step 4: Run, verify PASS**

`cd C:\dev\palova-wt-niveau\backend && npx jest src/services/rating/__tests__/match-rating.test.ts`

- [ ] **Step 5: Commit**

```bash
cd C:\dev\palova-wt-niveau
git add backend/src/services/rating/match-rating.ts backend/src/services/rating/__tests__/match-rating.test.ts
git commit -m "feat(rating): câblage Glicko 2v2 + décote d'inactivité (module pur)"
```

---

### Task 3: `MatchService.createFromReservation`

**Files:**
- Create: `backend/src/services/match.service.ts`
- Test: `backend/src/services/__tests__/match.service.test.ts`

Comportement : depuis une réservation `COURT` ayant **exactement 4 participants**, un participant crée le résultat. Valide : réservation existe + type COURT + 4 participants + l'auteur est participant + `playedAt` (= startTime) dans le passé + pas de Match actif (PENDING/CONFIRMED) déjà lié + les 2 équipes ont 2 joueurs chacune + sets non vides. Crée `Match` PENDING (`confirmDeadline = now + 72 h`, `winningTeam` dérivé) + 4 `MatchPlayer` (l'auteur `CONFIRMED`, les autres `PENDING`).

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/services/__tests__/match.service.test.ts
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { MatchService } from '../match.service';

const service = new MatchService();

const RES = {
  id: 'r1', type: 'COURT', clubId: 'c1', startTime: new Date('2026-06-10T10:00:00Z'),
  resource: { clubSport: { sportId: 'sport-padel' } },
  participants: [
    { userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }, { userId: 'u4' },
  ],
};
const NOW = new Date('2026-06-11T10:00:00Z');
const teams = { 1: ['u1', 'u2'], 2: ['u3', 'u4'] } as Record<1 | 2, string[]>;
const sets = [[6, 4], [6, 3]];

beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.reservation.findUnique.mockResolvedValue(RES as any);
  prismaMock.match.findFirst.mockResolvedValue(null as any);
  prismaMock.match.create.mockImplementation((args: any) => Promise.resolve({ id: 'm1', ...args.data }) as any);
});

describe('createFromReservation', () => {
  it('crée un Match PENDING + 4 MatchPlayer, auteur confirmé', async () => {
    const m = await service.createFromReservation('r1', 'u1', { teams, sets, now: NOW });
    expect(m.id).toBe('m1');
    const arg = (prismaMock.match.create as jest.Mock).mock.calls[0][0];
    expect(arg.data.status).toBe('PENDING');
    expect(arg.data.winningTeam).toBe(1);
    expect(arg.data.players.create).toHaveLength(4);
    const author = arg.data.players.create.find((p: any) => p.userId === 'u1');
    expect(author.confirmation).toBe('CONFIRMED');
    const other = arg.data.players.create.find((p: any) => p.userId === 'u3');
    expect(other.confirmation).toBe('PENDING');
  });

  it('refuse si l auteur n est pas participant', async () => {
    await expect(service.createFromReservation('r1', 'uX', { teams, sets, now: NOW }))
      .rejects.toThrow('NOT_A_PARTICIPANT');
  });

  it('refuse si la réservation n est pas dans le passé', async () => {
    await expect(service.createFromReservation('r1', 'u1', { teams, sets, now: new Date('2026-06-09T10:00:00Z') }))
      .rejects.toThrow('MATCH_NOT_PLAYED_YET');
  });

  it('refuse si un Match actif existe déjà', async () => {
    prismaMock.match.findFirst.mockResolvedValue({ id: 'existing' } as any);
    await expect(service.createFromReservation('r1', 'u1', { teams, sets, now: NOW }))
      .rejects.toThrow('MATCH_ALREADY_EXISTS');
  });

  it('refuse une composition d équipes invalide (pas 2+2)', async () => {
    const bad = { 1: ['u1', 'u2', 'u3'], 2: ['u4'] } as Record<1 | 2, string[]>;
    await expect(service.createFromReservation('r1', 'u1', { teams: bad, sets, now: NOW }))
      .rejects.toThrow('VALIDATION_ERROR');
  });
});
```

- [ ] **Step 2: Run, verify FAIL** (`Cannot find module '../match.service'`).

`cd C:\dev\palova-wt-niveau\backend && npx jest src/services/__tests__/match.service.test.ts`

- [ ] **Step 3: Implementation** (cette tâche crée le fichier avec `createFromReservation` ; les autres méthodes sont ajoutées aux Tasks 4-5)

```ts
// backend/src/services/match.service.ts
import { prisma } from '../db/prisma';
import { SetScore, winningTeam } from './rating/score';

const CONFIRM_WINDOW_HOURS = 72;

export interface CreateMatchInput {
  teams: Record<1 | 2, string[]>; // userIds par équipe (2 chacun)
  sets: SetScore[];
  now: Date;
}

export class MatchService {
  /** Crée un résultat PENDING depuis une réservation COURT à 4 joueurs. L'auteur est confirmé d'office. */
  async createFromReservation(reservationId: string, authorUserId: string, input: CreateMatchInput) {
    const { teams, sets, now } = input;

    // Composition : 2+2, joueurs distincts.
    const t1 = teams[1] ?? [];
    const t2 = teams[2] ?? [];
    const all = [...t1, ...t2];
    if (t1.length !== 2 || t2.length !== 2 || new Set(all).size !== 4) throw new Error('VALIDATION_ERROR');
    if (!Array.isArray(sets) || sets.length === 0) throw new Error('VALIDATION_ERROR');

    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { participants: { select: { userId: true } }, resource: { select: { clubSport: { select: { sportId: true } } } } },
    });
    if (!reservation) throw new Error('RESERVATION_NOT_FOUND');
    if (reservation.type !== 'COURT') throw new Error('NOT_A_COURT_RESERVATION');

    const participantIds = new Set(reservation.participants.map((p) => p.userId));
    if (!participantIds.has(authorUserId)) throw new Error('NOT_A_PARTICIPANT');
    if (participantIds.size !== 4) throw new Error('NEEDS_FOUR_PLAYERS');
    if (!all.every((id) => participantIds.has(id))) throw new Error('VALIDATION_ERROR');
    if (reservation.startTime.getTime() > now.getTime()) throw new Error('MATCH_NOT_PLAYED_YET');

    const existing = await prisma.match.findFirst({
      where: { reservationId, status: { in: ['PENDING', 'CONFIRMED'] } },
      select: { id: true },
    });
    if (existing) throw new Error('MATCH_ALREADY_EXISTS');

    const teamOf = (userId: string): number => (t1.includes(userId) ? 1 : 2);
    const confirmDeadline = new Date(now.getTime() + CONFIRM_WINDOW_HOURS * 3600 * 1000);

    return prisma.match.create({
      data: {
        clubId: reservation.clubId,
        sportId: reservation.resource.clubSport.sportId,
        reservationId,
        playedAt: reservation.startTime,
        status: 'PENDING',
        createdByUserId: authorUserId,
        sets: sets as unknown as object,
        winningTeam: winningTeam(sets),
        confirmDeadline,
        players: {
          create: all.map((userId) => ({
            userId,
            team: teamOf(userId),
            confirmation: userId === authorUserId ? 'CONFIRMED' : 'PENDING',
          })),
        },
      },
      include: { players: true },
    });
  }
}
```

> Note : `reservation.clubId` n'existe pas directement (la résa porte `resourceId`). Le `include` ci-dessus charge `resource.clubSport.sportId`. Pour `clubId`, étendre l'include : `resource: { select: { clubId: true, clubSport: { select: { sportId: true } } } }` et utiliser `reservation.resource.clubId`. Adapter le code et le mock `RES` (ajouter `resource.clubId: 'c1'`) en conséquence — le test attend `clubId` via la ressource. **Mettre à jour le mock `RES`** : `resource: { clubId: 'c1', clubSport: { sportId: 'sport-padel' } }` et retirer `clubId` du niveau réservation.

- [ ] **Step 4: Run, verify PASS** (ajuster mock/clubId comme indiqué).

- [ ] **Step 5: Commit**

```bash
cd C:\dev\palova-wt-niveau
git add backend/src/services/match.service.ts backend/src/services/__tests__/match.service.test.ts
git commit -m "feat(rating): MatchService.createFromReservation"
```

---

### Task 4: `MatchService.confirm` / `.dispute`

**Files:**
- Modify: `backend/src/services/match.service.ts`
- Modify: `backend/src/services/__tests__/match.service.test.ts`

Comportement : `confirm(matchId, userId)` met le `MatchPlayer` à `CONFIRMED` ; si **tous** les 4 sont CONFIRMED → appelle `finalize` (Task 5). `dispute(matchId, userId)` met le joueur à `DISPUTED` et le `Match` à `DISPUTED` (aucun impact niveau). Refuse si le joueur n'est pas dans le match, ou si le match n'est plus PENDING.

- [ ] **Step 1: Add failing tests** (append to the describe blocks)

```ts
describe('confirm / dispute', () => {
  const matchRow = (overrides = {}) => ({
    id: 'm1', status: 'PENDING',
    players: [
      { userId: 'u1', confirmation: 'CONFIRMED' },
      { userId: 'u2', confirmation: 'CONFIRMED' },
      { userId: 'u3', confirmation: 'CONFIRMED' },
      { userId: 'u4', confirmation: 'PENDING' },
    ],
    ...overrides,
  });

  it('confirmer le dernier joueur déclenche la finalisation', async () => {
    prismaMock.match.findUnique.mockResolvedValue(matchRow() as any);
    prismaMock.matchPlayer.update.mockResolvedValue({} as any);
    const spy = jest.spyOn(service, 'finalize').mockResolvedValue(undefined as any);
    await service.confirm('m1', 'u4');
    expect(prismaMock.matchPlayer.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { confirmation: 'CONFIRMED' },
    }));
    expect(spy).toHaveBeenCalledWith('m1');
    spy.mockRestore();
  });

  it('confirmer un joueur non dernier ne finalise pas', async () => {
    prismaMock.match.findUnique.mockResolvedValue(matchRow({
      players: [
        { userId: 'u1', confirmation: 'CONFIRMED' }, { userId: 'u2', confirmation: 'PENDING' },
        { userId: 'u3', confirmation: 'PENDING' }, { userId: 'u4', confirmation: 'PENDING' },
      ],
    }) as any);
    prismaMock.matchPlayer.update.mockResolvedValue({} as any);
    const spy = jest.spyOn(service, 'finalize').mockResolvedValue(undefined as any);
    await service.confirm('m1', 'u2');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('contester met le match en DISPUTED, pas de finalisation', async () => {
    prismaMock.match.findUnique.mockResolvedValue(matchRow() as any);
    prismaMock.matchPlayer.update.mockResolvedValue({} as any);
    prismaMock.match.update.mockResolvedValue({} as any);
    const spy = jest.spyOn(service, 'finalize').mockResolvedValue(undefined as any);
    await service.dispute('m1', 'u4');
    expect(prismaMock.match.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'DISPUTED' } }));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('refuse de confirmer un match déjà CONFIRMED', async () => {
    prismaMock.match.findUnique.mockResolvedValue(matchRow({ status: 'CONFIRMED' }) as any);
    await expect(service.confirm('m1', 'u4')).rejects.toThrow('MATCH_NOT_PENDING');
  });

  it('refuse un joueur étranger au match', async () => {
    prismaMock.match.findUnique.mockResolvedValue(matchRow() as any);
    await expect(service.confirm('m1', 'uX')).rejects.toThrow('NOT_A_MATCH_PLAYER');
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implementation** (add methods to `MatchService`)

```ts
  private async loadPending(matchId: string, userId: string) {
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      include: { players: { select: { userId: true, confirmation: true } } },
    });
    if (!match) throw new Error('MATCH_NOT_FOUND');
    if (!match.players.some((p) => p.userId === userId)) throw new Error('NOT_A_MATCH_PLAYER');
    if (match.status !== 'PENDING') throw new Error('MATCH_NOT_PENDING');
    return match;
  }

  /** Le joueur confirme le résultat. Si les 4 sont confirmés → finalisation. */
  async confirm(matchId: string, userId: string): Promise<void> {
    const match = await this.loadPending(matchId, userId);
    await prisma.matchPlayer.update({
      where: { matchId_userId: { matchId, userId } },
      data: { confirmation: 'CONFIRMED' },
    });
    const allConfirmed = match.players.every((p) =>
      p.userId === userId ? true : p.confirmation === 'CONFIRMED');
    if (allConfirmed) await this.finalize(matchId);
  }

  /** Le joueur conteste : le match passe DISPUTED, aucun impact sur les niveaux. */
  async dispute(matchId: string, userId: string): Promise<void> {
    await this.loadPending(matchId, userId);
    await prisma.matchPlayer.update({
      where: { matchId_userId: { matchId, userId } },
      data: { confirmation: 'DISPUTED' },
    });
    await prisma.match.update({ where: { id: matchId }, data: { status: 'DISPUTED' } });
  }
```

> `finalize` est défini en Task 5. Pour que ce fichier compile dès maintenant, ajouter un **stub** temporaire `async finalize(_matchId: string): Promise<void> { /* implémenté Task 5 */ }` — il sera remplacé en Task 5. (Les tests de cette tâche le mockent via `jest.spyOn`.)

- [ ] **Step 4: Run, verify PASS**

- [ ] **Step 5: Commit**

```bash
cd C:\dev\palova-wt-niveau
git add backend/src/services/match.service.ts backend/src/services/__tests__/match.service.test.ts
git commit -m "feat(rating): MatchService.confirm/dispute"
```

---

### Task 5: `MatchService.finalize` — application des niveaux (transaction Serializable, idempotente)

**Files:**
- Modify: `backend/src/services/match.service.ts`
- Modify: `backend/src/services/__tests__/match.service.test.ts`

Comportement : charge le match + ses 4 joueurs ; pour chacun, get-or-create du `PlayerRating` (au niveau neutre si absent), applique la **décote d'inactivité** (jours depuis `lastMatchAt`) puis `applyMatchRatings` ; écrit pour chaque joueur `rating/rd/volatility/displayLevel/isProvisional/matchesPlayed+1/lastMatchAt=playedAt` et le snapshot `ratingBefore/After` sur `MatchPlayer` ; passe le `Match` à `CONFIRMED` + `ratingsAppliedAt=now`. **Idempotent** : si `ratingsAppliedAt` déjà non-null, ne refait rien. Le tout dans `prisma.$transaction(..., { isolationLevel: Serializable })`.

- [ ] **Step 1: Add failing test**

```ts
import { Prisma } from '@prisma/client';

describe('finalize', () => {
  const playedAt = new Date('2026-06-10T10:00:00Z');

  function txMock() {
    // tx reproduit les sous-appels utilisés par finalize
    const ratings: Record<string, any> = {};
    return {
      match: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'm1', status: 'PENDING', sportId: 'sport-padel', playedAt, ratingsAppliedAt: null,
          players: [
            { userId: 'u1', team: 1 }, { userId: 'u2', team: 1 },
            { userId: 'u3', team: 2 }, { userId: 'u4', team: 2 },
          ],
          sets: [[6, 2], [6, 2]],
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      playerRating: {
        findUnique: jest.fn().mockResolvedValue(null), // tous nouveaux → niveau neutre
        upsert: jest.fn().mockImplementation((a: any) => { ratings[a.create.userId] = a.create; return Promise.resolve(a.create); }),
      },
      matchPlayer: { update: jest.fn().mockResolvedValue({}) },
      _ratings: ratings,
    };
  }

  it('applique les niveaux des 4 joueurs et passe le match CONFIRMED', async () => {
    const tx = txMock();
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-padel' } as any);
    (prismaMock.$transaction as jest.Mock).mockImplementation((fn: any) => fn(tx));
    await service.finalize('m1');
    expect(tx.match.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'CONFIRMED' }),
    }));
    expect(tx.playerRating.upsert).toHaveBeenCalledTimes(4);
    expect(tx.matchPlayer.update).toHaveBeenCalledTimes(4);
  });

  it('idempotent : si ratingsAppliedAt déjà set, ne réapplique pas', async () => {
    const tx = txMock();
    tx.match.findUnique.mockResolvedValue({ id: 'm1', status: 'CONFIRMED', ratingsAppliedAt: new Date(), players: [], sets: [] } as any);
    (prismaMock.$transaction as jest.Mock).mockImplementation((fn: any) => fn(tx));
    await service.finalize('m1');
    expect(tx.playerRating.upsert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, verify FAIL** (finalize is still a stub → `match.update`/`upsert` not called → assertions fail).

- [ ] **Step 3: Implementation** — replace the `finalize` stub:

```ts
// imports à ajouter en tête de match.service.ts :
import { Prisma } from '@prisma/client';
import { applyMatchRatings, decayForInactivity, TeamPlayer, RATING_PERIOD_DAYS } from './rating/match-rating';
import {
  DEFAULT_RD, DEFAULT_VOLATILITY, SKIP_DEFAULT_LEVEL,
  isProvisional, levelToRating, ratingToLevel,
} from './rating/level';
```

```ts
  /** Finalise un match confirmé : applique Glicko aux 4 joueurs (idempotent, transaction Serializable). */
  async finalize(matchId: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const match = await tx.match.findUnique({
        where: { id: matchId },
        include: { players: { select: { userId: true, team: true } } },
      });
      if (!match) throw new Error('MATCH_NOT_FOUND');
      if (match.ratingsAppliedAt) return; // déjà appliqué → idempotent

      const playedAt = match.playedAt;
      // États courants des 4 joueurs (get-or-create neutre), avec décote d'inactivité.
      const states: (TeamPlayer & { userId: string; before: number })[] = [];
      for (const p of match.players) {
        const existing = await tx.playerRating.findUnique({
          where: { userId_sportId: { userId: p.userId, sportId: match.sportId } },
        });
        const base = existing
          ? { rating: existing.rating, rd: existing.rd, volatility: existing.volatility, last: existing.lastMatchAt }
          : { rating: levelToRating(SKIP_DEFAULT_LEVEL), rd: DEFAULT_RD, volatility: DEFAULT_VOLATILITY, last: null as Date | null };
        const days = base.last ? Math.max(0, (playedAt.getTime() - base.last.getTime()) / 86400000) : 0;
        const decayed = decayForInactivity({ rating: base.rating, rd: base.rd, volatility: base.volatility }, days);
        states.push({ ...decayed, team: p.team as 1 | 2, userId: p.userId, before: ratingToLevel(decayed.rating) });
      }

      const updated = applyMatchRatings(states, match.sets as unknown as [number, number][]);

      for (let i = 0; i < states.length; i++) {
        const s = states[i];
        const u = updated[i];
        const displayLevel = ratingToLevel(u.rating);
        await tx.playerRating.upsert({
          where: { userId_sportId: { userId: s.userId, sportId: match.sportId } },
          create: {
            userId: s.userId, sportId: match.sportId,
            rating: u.rating, rd: u.rd, volatility: u.volatility,
            displayLevel, isProvisional: isProvisional(u.rd),
            matchesPlayed: 1, lastMatchAt: playedAt, initialSelfLevel: null,
          },
          update: {
            rating: u.rating, rd: u.rd, volatility: u.volatility,
            displayLevel, isProvisional: isProvisional(u.rd),
            matchesPlayed: { increment: 1 }, lastMatchAt: playedAt,
          },
        });
        await tx.matchPlayer.update({
          where: { matchId_userId: { matchId, userId: s.userId } },
          data: { ratingBefore: s.before, ratingAfter: displayLevel },
        });
      }

      await tx.match.update({
        where: { id: matchId },
        data: { status: 'CONFIRMED', ratingsAppliedAt: new Date() },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
```

Remove the temporary stub. (The decay uses `RATING_PERIOD_DAYS` indirectly via `decayForInactivity` — keep the import even if not referenced directly; if tsc flags it unused, drop `RATING_PERIOD_DAYS` from the import.)

- [ ] **Step 4: Run, verify PASS** (the whole `match.service.test.ts`).

`cd C:\dev\palova-wt-niveau\backend && npx jest src/services/__tests__/match.service.test.ts`

- [ ] **Step 5: Commit**

```bash
cd C:\dev\palova-wt-niveau
git add backend/src/services/match.service.ts backend/src/services/__tests__/match.service.test.ts
git commit -m "feat(rating): MatchService.finalize — application Glicko (transaction, idempotent)"
```

---

### Task 6: Auto-validation des matchs périmés (72 h) + résolution staff

**Files:**
- Modify: `backend/src/services/match.service.ts`
- Modify: `backend/src/services/__tests__/match.service.test.ts`

Deux méthodes : `autoValidateDue(now)` — finalise tous les matchs `PENDING` dont `confirmDeadline <= now` (boucle sur `finalize`, best-effort par match) ; `resolveDispute(matchId, action, sets?)` pour le staff — `action` ∈ `VALIDATE` (re-PENDING puis finalize avec les sets éventuellement corrigés), `CANCEL` (status CANCELLED, aucun impact).

- [ ] **Step 1: Add failing tests**

```ts
describe('autoValidateDue', () => {
  it('finalise chaque match PENDING périmé', async () => {
    prismaMock.match.findMany.mockResolvedValue([{ id: 'm1' }, { id: 'm2' }] as any);
    const spy = jest.spyOn(service, 'finalize').mockResolvedValue(undefined as any);
    const n = await service.autoValidateDue(new Date('2026-06-20T00:00:00Z'));
    expect(n).toBe(2);
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it('un échec de finalisation n interrompt pas les autres', async () => {
    prismaMock.match.findMany.mockResolvedValue([{ id: 'm1' }, { id: 'm2' }] as any);
    const spy = jest.spyOn(service, 'finalize')
      .mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined as any);
    const n = await service.autoValidateDue(new Date());
    expect(n).toBe(1); // un seul succès
    spy.mockRestore();
  });
});

describe('resolveDispute', () => {
  it('VALIDATE re-PENDING puis finalise', async () => {
    prismaMock.match.update.mockResolvedValue({} as any);
    const spy = jest.spyOn(service, 'finalize').mockResolvedValue(undefined as any);
    await service.resolveDispute('m1', 'VALIDATE');
    expect(prismaMock.match.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'PENDING' }),
    }));
    expect(spy).toHaveBeenCalledWith('m1');
    spy.mockRestore();
  });

  it('CANCEL passe le match CANCELLED sans finaliser', async () => {
    prismaMock.match.update.mockResolvedValue({} as any);
    const spy = jest.spyOn(service, 'finalize').mockResolvedValue(undefined as any);
    await service.resolveDispute('m1', 'CANCEL');
    expect(prismaMock.match.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'CANCELLED' } }));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implementation** (add methods + import `SetScore`, `winningTeam` already imported)

```ts
  /** Finalise tous les matchs PENDING dont le délai de confirmation est passé. Renvoie le nb finalisés. */
  async autoValidateDue(now: Date): Promise<number> {
    const due = await prisma.match.findMany({
      where: { status: 'PENDING', confirmDeadline: { lte: now } },
      select: { id: true },
    });
    let done = 0;
    for (const m of due) {
      try { await this.finalize(m.id); done++; }
      catch (err) { console.error(`[match] auto-validation ${m.id} échouée:`, (err as Error).message); }
    }
    return done;
  }

  /** Résolution staff d'un litige. VALIDATE (avec sets corrigés optionnels) ou CANCEL. */
  async resolveDispute(matchId: string, action: 'VALIDATE' | 'CANCEL', sets?: SetScore[]): Promise<void> {
    if (action === 'CANCEL') {
      await prisma.match.update({ where: { id: matchId }, data: { status: 'CANCELLED' } });
      return;
    }
    const data: { status: 'PENDING'; sets?: object; winningTeam?: number } = { status: 'PENDING' };
    if (sets && sets.length) { data.sets = sets as unknown as object; data.winningTeam = winningTeam(sets); }
    await prisma.match.update({ where: { id: matchId }, data });
    await this.finalize(matchId);
  }
```

- [ ] **Step 4: Run, verify PASS**

- [ ] **Step 5: Brancher l'auto-validation dans le cron existant** — modifier `backend/src/jobs/cleanup.job.ts` : importer `MatchService`, instancier une fois, et dans le `cron.schedule('* * * * *', …)` ajouter, après le bloc d'expiration des holds, un appel best-effort :

```ts
      try {
        const finalized = await matchService.autoValidateDue(new Date());
        if (finalized > 0) console.log(`[match] ${finalized} match(s) auto-validé(s)`);
      } catch (err) {
        console.error('[match] auto-validation:', (err as Error).message);
      }
```

(Ajouter `import { MatchService } from '../services/match.service';` et `const matchService = new MatchService();` en tête du fichier.)

- [ ] **Step 6: Run full service test + tsc**

`cd C:\dev\palova-wt-niveau\backend && npx jest src/services/__tests__/match.service.test.ts && npx tsc --noEmit`

- [ ] **Step 7: Commit**

```bash
cd C:\dev\palova-wt-niveau
git add backend/src/services/match.service.ts backend/src/services/__tests__/match.service.test.ts backend/src/jobs/cleanup.job.ts
git commit -m "feat(rating): auto-validation 72h (cron) + résolution staff des litiges"
```

---

### Task 7: Notifications de match (best-effort)

**Files:**
- Modify: `backend/src/email/templates/emails.ts` (builders)
- Modify: `backend/src/email/notifications.ts` (orchestration `notifyMatchPendingConfirmation`)
- Modify: `backend/src/services/match.service.ts` (appel best-effort après création)
- Test: `backend/src/email/__tests__/match-emails.test.ts`

Périmètre minimal v1 : à la **création** d'un match, notifier les 3 autres joueurs « confirme le résultat ». (Les emails de confirmation finale / litige peuvent venir plus tard ; rester simple.)

- [ ] **Step 1: Write the failing test** for a pure builder

```ts
// backend/src/email/__tests__/match-emails.test.ts
import { buildMatchConfirmEmail } from '../templates/emails';
import { PALOVA_BRAND } from '../templates/layout';

describe('buildMatchConfirmEmail', () => {
  it('produit subject/html/text mentionnant le score et un lien', () => {
    const out = buildMatchConfirmEmail({
      brand: PALOVA_BRAND, recipientFirstName: 'Eric',
      scoreLine: '6-4 / 6-3', matchUrl: 'https://x.palova.fr/me/matchs', authorName: 'Luc',
    });
    expect(out.subject).toMatch(/résultat|confirmer/i);
    expect(out.html).toContain('6-4 / 6-3');
    expect(out.html).toContain('https://x.palova.fr/me/matchs');
    expect(out.text).toContain('Eric');
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implementation**
- In `emails.ts`, add a pure builder following the existing `buildMatch*Email` style (look at `buildMatchInviteEmail` for the layout helper usage). It returns `{ subject, html, text }`, uses `escapeHtml`, the club brand layout, and a CTA button to `matchUrl`.

```ts
export function buildMatchConfirmEmail(opts: {
  brand: Brand; recipientFirstName: string; scoreLine: string; matchUrl: string; authorName: string;
}): BuiltEmail {
  const { brand, recipientFirstName, scoreLine, matchUrl, authorName } = opts;
  const subject = 'Confirme le résultat de ton match';
  const body = `
    <p>Bonjour ${escapeHtml(recipientFirstName)},</p>
    <p>${escapeHtml(authorName)} a saisi le résultat de votre match : <strong>${escapeHtml(scoreLine)}</strong>.</p>
    <p>Confirme-le (ou conteste-le) pour mettre à jour vos niveaux.</p>
    ${ctaButton('Voir le match', matchUrl, brand)}
  `;
  return { subject, html: renderLayout(brand, subject, body), text: `${recipientFirstName}, ${authorName} a saisi ${scoreLine}. Confirme : ${matchUrl}` };
}
```

> Adapter aux helpers réellement exportés par `emails.ts`/`layout.ts` (noms exacts de `BuiltEmail`, `renderLayout`/layout, `ctaButton`, `escapeHtml`). S'aligner sur un builder existant copié-collé puis modifié.

- In `notifications.ts`, add `notifyMatchPendingConfirmation(matchId)` : charge le match + club (brand) + joueurs (email/prénom) + auteur, construit `scoreLine` depuis `sets`, et envoie `buildMatchConfirmEmail` à chaque joueur **sauf l'auteur**. Best-effort interne (peut lever ; l'appelant enveloppe).

- In `match.service.ts`, after `createFromReservation`'s `prisma.match.create`, call best-effort:
```ts
    safeNotify(() => notifyMatchPendingConfirmation(match.id));
```
where `safeNotify` is the existing helper (import it the same way other services do — check `tournament.service.ts`). Import `notifyMatchPendingConfirmation` from `../email/notifications`.

- [ ] **Step 4: Run the builder test + service test (notifications mocked or best-effort) + tsc**

`cd C:\dev\palova-wt-niveau\backend && npx jest src/email/__tests__/match-emails.test.ts src/services/__tests__/match.service.test.ts && npx tsc --noEmit`

> If the service test now imports notifications that hit the DB, mock the notifications module at the top of `match.service.test.ts`: `jest.mock('../../email/notifications', () => ({ notifyMatchPendingConfirmation: jest.fn() }));` and ensure `safeNotify` swallows errors.

- [ ] **Step 5: Commit**

```bash
cd C:\dev\palova-wt-niveau
git add backend/src/email/templates/emails.ts backend/src/email/notifications.ts backend/src/services/match.service.ts backend/src/email/__tests__/match-emails.test.ts backend/src/services/__tests__/match.service.test.ts
git commit -m "feat(rating): notification de confirmation de match (best-effort)"
```

---

### Task 8: Routes joueur (saisie / confirmation / contestation / mes matchs)

**Files:**
- Modify: `backend/src/routes/reservations.ts` (POST `/:id/match`)
- Create: `backend/src/routes/matches.ts` (POST `/:id/confirm`, `/:id/dispute`)
- Modify: `backend/src/routes/me.ts` (GET `/matches`)
- Modify: `backend/src/app.ts` (monter `/api/matches`)
- Test: `backend/src/routes/__tests__/match.routes.test.ts`

Endpoints :
- `POST /api/reservations/:id/match` (auth) — body `{ teams: {1:[],2:[]}, sets }` → `matchService.createFromReservation(:id, userId, { teams, sets, now: new Date() })`. Erreurs → 400/403/404/409 selon le sentinel.
- `POST /api/matches/:id/confirm` (auth) → `confirm`. `POST /api/matches/:id/dispute` (auth) → `dispute`.
- `GET /api/me/matches` (auth) — matchs où le joueur figure, avec son statut de confirmation + flag `needsMyConfirmation` (PENDING & ma ligne PENDING).

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/routes/__tests__/match.routes.test.ts
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';

jest.mock('../../email/notifications', () => ({ __esModule: true, notifyMatchPendingConfirmation: jest.fn() }));

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET manquant');
const token = (id = 'u1') => jwt.sign({ id, email: 'x@x.fr' }, process.env.JWT_SECRET!);

beforeEach(() => jest.clearAllMocks());

describe('POST /api/reservations/:id/match', () => {
  it('401 sans token', async () => {
    const res = await request(app).post('/api/reservations/r1/match').send({});
    expect(res.status).toBe(401);
  });

  it('409 si un match existe déjà', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue({
      id: 'r1', type: 'COURT', startTime: new Date('2020-01-01T00:00:00Z'),
      resource: { clubId: 'c1', clubSport: { sportId: 'sport-padel' } },
      participants: [{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }, { userId: 'u4' }],
    } as any);
    prismaMock.match.findFirst.mockResolvedValue({ id: 'existing' } as any);
    const res = await request(app).post('/api/reservations/r1/match')
      .set('Authorization', `Bearer ${token()}`)
      .send({ teams: { 1: ['u1', 'u2'], 2: ['u3', 'u4'] }, sets: [[6, 4], [6, 3]] });
    expect(res.status).toBe(409);
  });
});

describe('POST /api/matches/:id/confirm', () => {
  it('confirme (200)', async () => {
    prismaMock.match.findUnique.mockResolvedValue({
      id: 'm1', status: 'PENDING',
      players: [
        { userId: 'u1', confirmation: 'CONFIRMED' }, { userId: 'u2', confirmation: 'CONFIRMED' },
        { userId: 'u3', confirmation: 'CONFIRMED' }, { userId: 'u4', confirmation: 'PENDING' },
      ],
    } as any);
    prismaMock.matchPlayer.update.mockResolvedValue({} as any);
    (prismaMock.$transaction as jest.Mock).mockImplementation(async (fn: any) => fn({
      match: { findUnique: jest.fn().mockResolvedValue({ id: 'm1', ratingsAppliedAt: new Date(), players: [], sets: [] }), update: jest.fn() },
      playerRating: { findUnique: jest.fn(), upsert: jest.fn() }, matchPlayer: { update: jest.fn() },
    }));
    const res = await request(app).post('/api/matches/m1/confirm').set('Authorization', `Bearer ${token('u4')}`);
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implementation**

In `reservations.ts` (match its existing import/router style), instantiate `const matchService = new MatchService();` and add:
```ts
router.post('/:id/match', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { teams, sets } = req.body;
    const match = await matchService.createFromReservation(req.params.id, req.user!.id, { teams, sets, now: new Date() });
    res.status(201).json({ id: match.id, status: match.status });
  } catch (err) { return matchError(err, res, next); }
});
```

Create `backend/src/routes/matches.ts`:
```ts
import { Router, Response, NextFunction } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { prisma } from '../db/prisma';
import { MatchService } from '../services/match.service';

const router = Router();
const matchService = new MatchService();

export function matchError(err: unknown, res: Response, next: NextFunction) {
  const map: Record<string, number> = {
    VALIDATION_ERROR: 400, RESERVATION_NOT_FOUND: 404, NOT_A_COURT_RESERVATION: 400,
    NOT_A_PARTICIPANT: 403, NEEDS_FOUR_PLAYERS: 400, MATCH_NOT_PLAYED_YET: 400,
    MATCH_ALREADY_EXISTS: 409, MATCH_NOT_FOUND: 404, NOT_A_MATCH_PLAYER: 403, MATCH_NOT_PENDING: 409,
  };
  if (err instanceof Error && map[err.message]) return void res.status(map[err.message]).json({ error: err.message });
  next(err as Error);
}

router.post('/:id/confirm', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { await matchService.confirm(req.params.id, req.user!.id); res.json({ ok: true }); }
  catch (err) { matchError(err, res, next); }
});

router.post('/:id/dispute', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { await matchService.dispute(req.params.id, req.user!.id); res.json({ ok: true }); }
  catch (err) { matchError(err, res, next); }
});

export default router;
```

In `reservations.ts`, import `{ matchError }` from `./matches` (and `MatchService`). In `app.ts`, mount: `app.use('/api/matches', matchesRouter);` (import `matchesRouter from './routes/matches'`), next to the other route mounts.

In `me.ts`, add `GET /matches`:
```ts
router.get('/matches', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const rows = await prisma.matchPlayer.findMany({
      where: { userId: req.user!.id },
      orderBy: { match: { playedAt: 'desc' } },
      select: {
        confirmation: true, team: true, ratingAfter: true,
        match: { select: { id: true, status: true, sets: true, playedAt: true, winningTeam: true, confirmDeadline: true } },
      },
    });
    res.json(rows.map((r) => ({
      matchId: r.match.id, status: r.match.status, sets: r.match.sets, playedAt: r.match.playedAt,
      winningTeam: r.match.winningTeam, myTeam: r.team, myConfirmation: r.confirmation,
      needsMyConfirmation: r.match.status === 'PENDING' && r.confirmation === 'PENDING',
    })));
  } catch (err) { next(err); }
});
```

- [ ] **Step 4: Run, verify PASS + tsc**

`cd C:\dev\palova-wt-niveau\backend && npx jest src/routes/__tests__/match.routes.test.ts && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
cd C:\dev\palova-wt-niveau
git add backend/src/routes/reservations.ts backend/src/routes/matches.ts backend/src/routes/me.ts backend/src/app.ts backend/src/routes/__tests__/match.routes.test.ts
git commit -m "feat(rating): routes joueur saisie/confirmation/contestation + GET /me/matches"
```

---

### Task 9: Routes admin (file des litiges + résolution)

**Files:**
- Modify: `backend/src/routes/admin.ts`
- Test: `backend/src/routes/__tests__/match-admin.routes.test.ts`

Endpoints sous `/api/clubs/:clubId/admin` (déjà protégé `requireClubMember`) :
- `GET /matches?status=DISPUTED` — liste des matchs du club (filtre statut), avec joueurs + sets.
- `POST /matches/:matchId/resolve` — body `{ action: 'VALIDATE'|'CANCEL', sets? }` → `matchService.resolveDispute`.

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/routes/__tests__/match-admin.routes.test.ts
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET manquant');
const token = () => jwt.sign({ id: 'staff1', email: 's@x.fr' }, process.env.JWT_SECRET!);

beforeEach(() => {
  jest.clearAllMocks();
  // requireClubMember : l'utilisateur est OWNER/ADMIN du club c1
  prismaMock.clubMember.findUnique.mockResolvedValue({ role: 'OWNER' } as any);
});

describe('GET /api/clubs/:clubId/admin/matches', () => {
  it('liste les litiges du club', async () => {
    prismaMock.match.findMany.mockResolvedValue([{ id: 'm1', status: 'DISPUTED', sets: [[6, 4]], players: [] }] as any);
    const res = await request(app).get('/api/clubs/c1/admin/matches?status=DISPUTED').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

describe('POST /api/clubs/:clubId/admin/matches/:matchId/resolve', () => {
  it('CANCEL → 200', async () => {
    prismaMock.match.update.mockResolvedValue({} as any);
    const res = await request(app).post('/api/clubs/c1/admin/matches/m1/resolve')
      .set('Authorization', `Bearer ${token()}`).send({ action: 'CANCEL' });
    expect(res.status).toBe(200);
  });

  it('action invalide → 400', async () => {
    const res = await request(app).post('/api/clubs/c1/admin/matches/m1/resolve')
      .set('Authorization', `Bearer ${token()}`).send({ action: 'NOPE' });
    expect(res.status).toBe(400);
  });
});
```

> Vérifier la forme exacte du mock `requireClubMember` en s'inspirant d'un test admin existant (`*.admin.routes.test.ts` ou équivalent) — adapter le mock prisma utilisé par ce middleware (peut-être `clubMember.findUnique` ou `findFirst`).

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implementation** — dans `admin.ts`, instancier `const matchService = new MatchService();` (import) et ajouter :

```ts
router.get('/matches', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const where: { clubId: string; status?: any } = { clubId: req.params.clubId };
    if (status) where.status = status;
    const matches = await prisma.match.findMany({
      where, orderBy: { playedAt: 'desc' },
      select: {
        id: true, status: true, sets: true, playedAt: true, winningTeam: true, confirmDeadline: true,
        players: { select: { userId: true, team: true, confirmation: true, user: { select: { firstName: true, lastName: true } } } },
      },
    });
    res.json(matches);
  } catch (err) { next(err); }
});

router.post('/matches/:matchId/resolve', async (req: ClubScopedRequest, res: Response, next: NextFunction) => {
  try {
    const { action, sets } = req.body;
    if (action !== 'VALIDATE' && action !== 'CANCEL') return void res.status(400).json({ error: 'VALIDATION_ERROR' });
    await matchService.resolveDispute(req.params.matchId, action, sets);
    res.json({ ok: true });
  } catch (err) { next(err); }
});
```

- [ ] **Step 4: Run, verify PASS + tsc**

`cd C:\dev\palova-wt-niveau\backend && npx jest src/routes/__tests__/match-admin.routes.test.ts && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
cd C:\dev\palova-wt-niveau
git add backend/src/routes/admin.ts backend/src/routes/__tests__/match-admin.routes.test.ts
git commit -m "feat(rating): routes admin file des litiges + résolution"
```

---

### Task 10: Vérification finale du Lot 2a

- [ ] **Step 1: Gate backend complet**

`cd C:\dev\palova-wt-niveau\backend && npx tsc --noEmit && npx jest`
Expected: tout vert (≈ +50 tests vs Lot 1).

- [ ] **Step 2: Vérif manuelle (optionnel)** — backend up, créer un résultat sur une vraie réservation passée à 4 joueurs (via curl/Postman), confirmer avec les 3 autres tokens, vérifier que les 4 `PlayerRating` ont bougé (`matchesPlayed=1`, `displayLevel` mis à jour) et le match `CONFIRMED`.

---

## Notes de périmètre (Lot 2a)

- **Backend seulement.** L'UI (saisie set-par-set, confirmation, file de litiges admin) = **Lot 2b**.
- **Auto-validation** = job cron (toutes les minutes) qui finalise les matchs `PENDING` périmés — pas de lazy-finalisation à la lecture (plus simple, déterministe).
- **Décote d'inactivité** appliquée à la finalisation (jours depuis `lastMatchAt`, période = 7 j).
- **Anti-fermage (rendements décroissants si toujours le même trio)** : **reporté** — non implémenté en 2a (à ajouter plus tard si le besoin se confirme ; la mention spec reste un objectif, pas un bloquant v1).
- **Notifications** : seulement « confirme le résultat » à la création (les emails confirmation finale / litige peuvent venir plus tard).
- Sources de match = réservation **COURT** à 4 participants (PUBLIC **et** PRIVATE). « Match libre » et tournois = hors périmètre.
