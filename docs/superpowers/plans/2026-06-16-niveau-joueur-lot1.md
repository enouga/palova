# Niveau de joueur — Lot 1 (Fondations) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poser les fondations du système de niveau padel : moteur Glicko-2 pur, mapping 0–8, modèle `PlayerRating`, calibration par auto-évaluation, et affichage du niveau sur le profil.

**Architecture :** Trois modules **purs** (`glicko2`, `score`, `level`) sans dépendance DB, testés isolément. Un modèle Prisma `PlayerRating` global par `(userId, sportId)`. Un `RatingService` (get/calibrate/display). Deux routes `/api/me/rating*`. Côté front, une carte niveau + une feuille de calibration à 8 paliers sur `/me/profile`. Le moteur de mise à jour existe mais n'est branché sur des matchs qu'au Lot 2.

**Tech Stack :** Express 5, Prisma 7 (adapter-pg), Jest + supertest, Next.js 16 / React 19, Tailwind v4.

**Spec :** `docs/superpowers/specs/2026-06-16-systeme-niveau-joueur-design.md`

**Pré-requis machine :** Postgres up pour la migration — `"C:\Program Files\Docker\Docker\resources\bin\docker-compose-v1.exe" up -d` (jamais `docker compose`).

---

### Task 1: Moteur Glicko-2 (module pur)

**Files:**
- Create: `backend/src/services/rating/glicko2.ts`
- Test: `backend/src/services/rating/__tests__/glicko2.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/services/rating/__tests__/glicko2.test.ts
import { updateRating, RatingState } from '../glicko2';

const fresh: RatingState = { rating: 1500, rd: 200, volatility: 0.06 };

describe('updateRating (Glicko-2)', () => {
  it('gagner contre un égal fait monter la note', () => {
    const r = updateRating(fresh, [{ rating: 1500, rd: 200, score: 1 }]);
    expect(r.rating).toBeGreaterThan(1500);
  });

  it('perdre contre un égal fait baisser la note', () => {
    const r = updateRating(fresh, [{ rating: 1500, rd: 200, score: 0 }]);
    expect(r.rating).toBeLessThan(1500);
  });

  it('un match réduit l incertitude (RD)', () => {
    const r = updateRating(fresh, [{ rating: 1500, rd: 200, score: 1 }]);
    expect(r.rd).toBeLessThan(fresh.rd);
  });

  it('battre plus fort rapporte plus que battre plus faible', () => {
    const vsStrong = updateRating(fresh, [{ rating: 1800, rd: 200, score: 1 }]);
    const vsWeak = updateRating(fresh, [{ rating: 1200, rd: 200, score: 1 }]);
    expect(vsStrong.rating - 1500).toBeGreaterThan(vsWeak.rating - 1500);
  });

  it('aucun match : la note ne bouge pas mais le RD remonte (décote d inactivité)', () => {
    const r = updateRating({ rating: 1500, rd: 80, volatility: 0.06 }, []);
    expect(r.rating).toBe(1500);
    expect(r.rd).toBeGreaterThan(80);
  });

  it('le RD reste plafonné à 350', () => {
    const r = updateRating({ rating: 1500, rd: 349, volatility: 0.2 }, []);
    expect(r.rd).toBeLessThanOrEqual(350);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/services/rating/__tests__/glicko2.test.ts`
Expected: FAIL — `Cannot find module '../glicko2'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/services/rating/glicko2.ts
// Implémentation standard Glicko-2 (Glickman). Unités « affichées » en entrée/sortie
// (rating ~1500, rd ~350) ; conversion interne (µ, φ) faite ici. Module PUR, sans DB.

export const GLICKO_SCALE = 173.7178; // facteur de conversion échelle Glicko ↔ Glicko-2
export const DEFAULT_TAU = 0.5;       // contrainte de volatilité du système
export const MAX_RD = 350;            // incertitude maximale (joueur inconnu)

export interface RatingState { rating: number; rd: number; volatility: number; }
export interface Opponent { rating: number; rd: number; score: number; } // score ∈ [0,1]

const g = (phi: number): number => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
const expected = (mu: number, muJ: number, phiJ: number): number =>
  1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));

/**
 * Met à jour l'état d'un joueur sur une « période » (un ou plusieurs adversaires virtuels).
 * Liste vide = aucun match → seule l'incertitude (RD) remonte (décote d'inactivité).
 */
export function updateRating(state: RatingState, opponents: Opponent[], tau = DEFAULT_TAU): RatingState {
  const phi = state.rd / GLICKO_SCALE;

  if (opponents.length === 0) {
    const phiStar = Math.sqrt(phi * phi + state.volatility * state.volatility);
    return { rating: state.rating, rd: Math.min(phiStar * GLICKO_SCALE, MAX_RD), volatility: state.volatility };
  }

  const mu = (state.rating - 1500) / GLICKO_SCALE;
  let invV = 0;
  let deltaSum = 0;
  for (const o of opponents) {
    const muJ = (o.rating - 1500) / GLICKO_SCALE;
    const phiJ = o.rd / GLICKO_SCALE;
    const gj = g(phiJ);
    const e = expected(mu, muJ, phiJ);
    invV += gj * gj * e * (1 - e);
    deltaSum += gj * (o.score - e);
  }
  const v = 1 / invV;
  const delta = v * deltaSum;

  // Volatilité : résolution f(x)=0 par la méthode d'Illinois.
  const a = Math.log(state.volatility * state.volatility);
  const f = (x: number): number => {
    const ex = Math.exp(x);
    const num = ex * (delta * delta - phi * phi - v - ex);
    const den = 2 * Math.pow(phi * phi + v + ex, 2);
    return num / den - (x - a) / (tau * tau);
  };
  const EPS = 1e-6;
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0) k++;
    B = a - k * tau;
  }
  let fA = f(A);
  let fB = f(B);
  while (Math.abs(B - A) > EPS) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) { A = B; fA = fB; } else { fA = fA / 2; }
    B = C; fB = fC;
  }
  const newVol = Math.exp(A / 2);

  const phiStar = Math.sqrt(phi * phi + newVol * newVol);
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const newMu = mu + newPhi * newPhi * deltaSum;

  return {
    rating: newMu * GLICKO_SCALE + 1500,
    rd: Math.min(newPhi * GLICKO_SCALE, MAX_RD),
    volatility: newVol,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/services/rating/__tests__/glicko2.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/rating/glicko2.ts backend/src/services/rating/__tests__/glicko2.test.ts
git commit -m "feat(rating): moteur Glicko-2 pur"
```

---

### Task 2: Score pondéré par la marge (module pur)

**Files:**
- Create: `backend/src/services/rating/score.ts`
- Test: `backend/src/services/rating/__tests__/score.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/services/rating/__tests__/score.test.ts
import { outcomeScore, winningTeam, SetScore } from '../score';

const crush: SetScore[] = [[6, 0], [6, 0]];
const tight: SetScore[] = [[7, 6], [7, 6]];

describe('winningTeam', () => {
  it('équipe 1 gagne 2 sets', () => expect(winningTeam([[6, 4], [6, 3]])).toBe(1));
  it('équipe 2 gagne 2 sets', () => expect(winningTeam([[4, 6], [3, 6]])).toBe(2));
  it('match en 3 sets gagné par 2', () => expect(winningTeam([[6, 4], [3, 6], [4, 6]])).toBe(2));
});

describe('outcomeScore', () => {
  it('écrasement → score proche de 1 pour le vainqueur', () => {
    expect(outcomeScore(crush, 1)).toBeGreaterThan(0.95);
    expect(outcomeScore(crush, 2)).toBeLessThan(0.05);
  });
  it('victoire serrée → score à peine au-dessus de 0,5', () => {
    expect(outcomeScore(tight, 1)).toBeGreaterThan(0.5);
    expect(outcomeScore(tight, 1)).toBeLessThan(0.6);
  });
  it('battre large rapporte un score plus haut que battre serré', () => {
    expect(outcomeScore(crush, 1)).toBeGreaterThan(outcomeScore(tight, 1));
  });
  it('aucun jeu → 0,5 (neutre)', () => {
    expect(outcomeScore([[0, 0]], 1)).toBe(0.5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/services/rating/__tests__/score.test.ts`
Expected: FAIL — `Cannot find module '../score'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/services/rating/score.ts
// Conversion d'un score set-par-set en score Glicko ∈ [0,1] pondéré par la MARGE.
// [jeuxÉquipe1, jeuxÉquipe2] par set.

export type SetScore = [number, number];

/** Équipe vainqueure (au nombre de sets gagnés ; égalité improbable → équipe 1). */
export function winningTeam(sets: SetScore[]): 1 | 2 {
  let s1 = 0;
  let s2 = 0;
  for (const [a, b] of sets) {
    if (a > b) s1++;
    else if (b > a) s2++;
  }
  return s1 >= s2 ? 1 : 2;
}

/** Score ∈ [0,1] du point de vue de `team`, basé sur le ratio de jeux : 6-0/6-0 ≈ 1, 7-6/7-6 ≈ 0,54. */
export function outcomeScore(sets: SetScore[], team: 1 | 2): number {
  let forG = 0;
  let againstG = 0;
  for (const [a, b] of sets) {
    if (team === 1) { forG += a; againstG += b; }
    else { forG += b; againstG += a; }
  }
  const total = forG + againstG;
  if (total === 0) return 0.5;
  const s = 0.5 + 0.5 * (forG - againstG) / total;
  return Math.max(0, Math.min(1, s));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/services/rating/__tests__/score.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/rating/score.ts backend/src/services/rating/__tests__/score.test.ts
git commit -m "feat(rating): score set-par-set pondéré par la marge"
```

---

### Task 3: Mapping 0–8, paliers, provisoire, niveau initial (module pur)

**Files:**
- Create: `backend/src/services/rating/level.ts`
- Test: `backend/src/services/rating/__tests__/level.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/services/rating/__tests__/level.test.ts
import {
  ratingToLevel, levelToRating, isProvisional, namedTier, TIERS,
  DEFAULT_RD, SKIP_DEFAULT_LEVEL,
} from '../level';

describe('mapping interne ↔ 0–8', () => {
  it('calibrer à un palier puis relire redonne ce palier', () => {
    for (const L of [1, 2, 3, 4, 5, 6, 7, 8]) {
      expect(ratingToLevel(levelToRating(L))).toBeCloseTo(L, 1);
    }
  });
  it('le niveau reste borné dans [0,8]', () => {
    expect(ratingToLevel(50)).toBe(0);
    expect(ratingToLevel(99999)).toBe(8);
  });
});

describe('isProvisional', () => {
  it('RD max → provisoire', () => expect(isProvisional(DEFAULT_RD)).toBe(true));
  it('RD bas → fiabilisé', () => expect(isProvisional(80)).toBe(false));
});

describe('namedTier', () => {
  it('8 paliers nommés', () => expect(TIERS).toHaveLength(8));
  it('niveau ~4 → Intermédiaire', () => expect(namedTier(4)).toBe('Intermédiaire'));
  it('niveau 8 → Élite', () => expect(namedTier(8)).toBe('Élite'));
  it('niveau 0 → Débutant (jamais sous le palier 1)', () => expect(namedTier(0)).toBe('Débutant'));
});

describe('SKIP_DEFAULT_LEVEL', () => {
  it('départ neutre = 3', () => expect(SKIP_DEFAULT_LEVEL).toBe(3));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/services/rating/__tests__/level.test.ts`
Expected: FAIL — `Cannot find module '../level'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/services/rating/level.ts
// Traduction note interne Glicko ↔ échelle padel 0–8 (référentiel French Padel Shop),
// + constantes de départ et statut provisoire. Module PUR.

export const LEVEL_MIN_RATING = 1000; // displayLevel 0
export const LEVEL_MAX_RATING = 2100; // displayLevel 8
export const DEFAULT_RD = 350;        // incertitude initiale (= MAX_RD)
export const DEFAULT_VOLATILITY = 0.06;
export const PROVISIONAL_RD_THRESHOLD = 110; // au-dessus = « en calibrage »
export const SKIP_DEFAULT_LEVEL = 3;  // auto-éval « passée » → départ neutre

// 1 → 8, dans l'ordre du référentiel.
export const TIERS = [
  'Débutant', 'Perfectionnement', 'Élémentaire', 'Intermédiaire',
  'Confirmé', 'Avancé', 'Expert', 'Élite',
] as const;

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Note interne → niveau 0–8 arrondi au dixième. */
export function ratingToLevel(rating: number): number {
  const lvl = ((rating - LEVEL_MIN_RATING) / (LEVEL_MAX_RATING - LEVEL_MIN_RATING)) * 8;
  return Math.round(clamp(lvl, 0, 8) * 10) / 10;
}

/** Niveau 0–8 → note interne (mapping inverse exact). */
export function levelToRating(level: number): number {
  return LEVEL_MIN_RATING + (clamp(level, 0, 8) / 8) * (LEVEL_MAX_RATING - LEVEL_MIN_RATING);
}

export function isProvisional(rd: number): boolean {
  return rd > PROVISIONAL_RD_THRESHOLD;
}

/** Palier nommé d'un niveau (jamais sous le palier 1, jamais au-dessus du 8). */
export function namedTier(level: number): string {
  const idx = clamp(Math.round(level), 1, 8);
  return TIERS[idx - 1];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/services/rating/__tests__/level.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/rating/level.ts backend/src/services/rating/__tests__/level.test.ts
git commit -m "feat(rating): mapping 0-8, paliers nommés, niveau de départ"
```

---

### Task 4: Modèle Prisma `PlayerRating` + migration

**Files:**
- Modify: `backend/prisma/schema.prisma` (nouveau model + 2 relations)

- [ ] **Step 1: Ajouter le modèle au schéma**

Dans `backend/prisma/schema.prisma`, ajouter le modèle (après `model User { … }` pour la lisibilité) :

```prisma
/// Niveau d'un joueur pour un sport, GLOBAL (partagé entre tous ses clubs).
/// Calculé par Glicko-2 ; `displayLevel` (0–8) est dénormalisé pour tri/filtre rapides.
model PlayerRating {
  id               String    @id @default(cuid())
  userId           String    @map("user_id")
  sportId          String    @map("sport_id")
  rating           Float     @default(1500)              // note interne Glicko (µ)
  rd               Float     @default(350)               // incertitude (RD)
  volatility       Float     @default(0.06)              // volatilité Glicko-2 (σ)
  displayLevel     Float     @default(3) @map("display_level") // 0–8 affiché (dénormalisé)
  matchesPlayed    Int       @default(0) @map("matches_played")
  lastMatchAt      DateTime? @map("last_match_at")
  isProvisional    Boolean   @default(true) @map("is_provisional")
  initialSelfLevel Float?    @map("initial_self_level")  // palier d'auto-éval 1–8 ; null si « passé »
  createdAt        DateTime  @default(now()) @map("created_at")
  updatedAt        DateTime  @updatedAt @map("updated_at")

  user  User  @relation(fields: [userId], references: [id], onDelete: Cascade)
  sport Sport @relation(fields: [sportId], references: [id], onDelete: Cascade)

  @@unique([userId, sportId])
  @@index([sportId, displayLevel])
  @@map("player_ratings")
}
```

Ajouter la relation inverse sur `model User` (dans la liste des relations, ex. après `reservationParticipations …`) :

```prisma
  playerRatings   PlayerRating[]
```

Ajouter la relation inverse sur `model Sport` (après `clubSports ClubSport[]`) :

```prisma
  playerRatings PlayerRating[]
```

- [ ] **Step 2: Démarrer Postgres puis générer la migration**

Run:
```bash
"C:\Program Files\Docker\Docker\resources\bin\docker-compose-v1.exe" up -d
cd backend && npm run db:migrate -- --name add_player_rating
```
Expected : Prisma crée `prisma/migrations/<ts>_add_player_rating/migration.sql` (CREATE TABLE additif) et régénère le client. Aucune table existante modifiée.

La migration générée doit ressembler à :

```sql
CREATE TABLE "player_ratings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "sport_id" TEXT NOT NULL,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 1500,
    "rd" DOUBLE PRECISION NOT NULL DEFAULT 350,
    "volatility" DOUBLE PRECISION NOT NULL DEFAULT 0.06,
    "display_level" DOUBLE PRECISION NOT NULL DEFAULT 3,
    "matches_played" INTEGER NOT NULL DEFAULT 0,
    "last_match_at" TIMESTAMP(3),
    "is_provisional" BOOLEAN NOT NULL DEFAULT true,
    "initial_self_level" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "player_ratings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "player_ratings_user_id_sport_id_key" ON "player_ratings"("user_id", "sport_id");
CREATE INDEX "player_ratings_sport_id_display_level_idx" ON "player_ratings"("sport_id", "display_level");
ALTER TABLE "player_ratings" ADD CONSTRAINT "player_ratings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "player_ratings" ADD CONSTRAINT "player_ratings_sport_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "sports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: Vérifier la compilation TypeScript**

Run: `cd backend && npx tsc --noEmit`
Expected: PASS (le client Prisma connaît `prisma.playerRating`).

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(rating): modèle PlayerRating + migration additive"
```

---

### Task 5: `RatingService` (get / calibrate / display)

**Files:**
- Create: `backend/src/services/rating.service.ts`
- Test: `backend/src/services/__tests__/rating.service.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/services/__tests__/rating.service.test.ts
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { RatingService } from '../rating.service';

const service = new RatingService();

beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-padel' } as any);
});

describe('getForDisplay', () => {
  it('renvoie null si le joueur n a pas de niveau', async () => {
    prismaMock.playerRating.findUnique.mockResolvedValue(null as any);
    expect(await service.getForDisplay('u1', 'padel')).toBeNull();
  });

  it('mappe la ligne en affichage (niveau, palier, provisoire)', async () => {
    prismaMock.playerRating.findUnique.mockResolvedValue({
      displayLevel: 4, isProvisional: true, matchesPlayed: 0, initialSelfLevel: 4,
    } as any);
    const d = await service.getForDisplay('u1', 'padel');
    expect(d).toEqual({ calibrated: true, level: 4, tier: 'Intermédiaire', isProvisional: true, matchesPlayed: 0 });
  });
});

describe('calibrate', () => {
  it('crée un niveau provisoire au palier choisi', async () => {
    prismaMock.playerRating.findUnique.mockResolvedValue(null as any);
    prismaMock.playerRating.upsert.mockImplementation((args: any) =>
      Promise.resolve({ ...args.create, matchesPlayed: 0 }) as any);
    const d = await service.calibrate('u1', 'padel', 5);
    expect(d.level).toBeCloseTo(5, 1);
    expect(d.tier).toBe('Confirmé');
    expect(d.isProvisional).toBe(true);
    expect(prismaMock.playerRating.upsert).toHaveBeenCalled();
  });

  it('« passer » (null) → départ neutre niveau 3', async () => {
    prismaMock.playerRating.findUnique.mockResolvedValue(null as any);
    prismaMock.playerRating.upsert.mockImplementation((args: any) =>
      Promise.resolve({ ...args.create, matchesPlayed: 0 }) as any);
    const d = await service.calibrate('u1', 'padel', null);
    expect(d.level).toBeCloseTo(3, 1);
    expect(d.calibrated).toBe(false); // null self-level + 0 match = pas (encore) calibré
  });

  it('ne réécrit pas un niveau déjà rodé par des matchs', async () => {
    prismaMock.playerRating.findUnique.mockResolvedValue({
      displayLevel: 6, isProvisional: false, matchesPlayed: 20, initialSelfLevel: null,
    } as any);
    const d = await service.calibrate('u1', 'padel', 2);
    expect(d.level).toBe(6);
    expect(prismaMock.playerRating.upsert).not.toHaveBeenCalled();
  });

  it('palier hors 1–8 → VALIDATION_ERROR', async () => {
    await expect(service.calibrate('u1', 'padel', 9)).rejects.toThrow('VALIDATION_ERROR');
  });

  it('sport inconnu → SPORT_NOT_FOUND', async () => {
    prismaMock.sport.findUnique.mockResolvedValue(null as any);
    await expect(service.getForDisplay('u1', 'inconnu')).rejects.toThrow('SPORT_NOT_FOUND');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/services/__tests__/rating.service.test.ts`
Expected: FAIL — `Cannot find module '../rating.service'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/services/rating.service.ts
import { prisma } from '../db/prisma';
import {
  DEFAULT_RD, DEFAULT_VOLATILITY, SKIP_DEFAULT_LEVEL,
  isProvisional, levelToRating, namedTier, ratingToLevel,
} from './rating/level';

export interface RatingDisplay {
  calibrated: boolean;     // a fait l'auto-éval OU a déjà joué
  level: number;           // 0–8
  tier: string;            // palier nommé
  isProvisional: boolean;  // « en calibrage »
  matchesPlayed: number;
}

type Row = {
  displayLevel: number; isProvisional: boolean; matchesPlayed: number; initialSelfLevel: number | null;
};

export class RatingService {
  private async sportId(sportKey: string): Promise<string> {
    const sport = await prisma.sport.findUnique({ where: { key: sportKey }, select: { id: true } });
    if (!sport) throw new Error('SPORT_NOT_FOUND');
    return sport.id;
  }

  private toDisplay(row: Row): RatingDisplay {
    return {
      calibrated: row.initialSelfLevel !== null || row.matchesPlayed > 0,
      level: row.displayLevel,
      tier: namedTier(row.displayLevel),
      isProvisional: row.isProvisional,
      matchesPlayed: row.matchesPlayed,
    };
  }

  /** Lecture pour affichage. null = joueur sans niveau (à calibrer). */
  async getForDisplay(userId: string, sportKey: string): Promise<RatingDisplay | null> {
    const sportId = await this.sportId(sportKey);
    const row = await prisma.playerRating.findUnique({ where: { userId_sportId: { userId, sportId } } });
    return row ? this.toDisplay(row as Row) : null;
  }

  /** Auto-évaluation. selfLevel 1–8 ou null (« passer » → départ neutre). N'écrase jamais un niveau déjà rodé. */
  async calibrate(userId: string, sportKey: string, selfLevel: number | null): Promise<RatingDisplay> {
    if (selfLevel !== null && (typeof selfLevel !== 'number' || !Number.isFinite(selfLevel) || selfLevel < 1 || selfLevel > 8)) {
      throw new Error('VALIDATION_ERROR');
    }
    const sportId = await this.sportId(sportKey);
    const existing = await prisma.playerRating.findUnique({ where: { userId_sportId: { userId, sportId } } });
    if (existing && (existing as Row).matchesPlayed > 0) {
      return this.toDisplay(existing as Row); // déjà rodé : l'auto-éval ne réécrit pas
    }
    const rating = levelToRating(selfLevel ?? SKIP_DEFAULT_LEVEL);
    const data = {
      rating, rd: DEFAULT_RD, volatility: DEFAULT_VOLATILITY,
      displayLevel: ratingToLevel(rating), isProvisional: isProvisional(DEFAULT_RD),
      initialSelfLevel: selfLevel,
    };
    const row = await prisma.playerRating.upsert({
      where: { userId_sportId: { userId, sportId } },
      create: { userId, sportId, ...data },
      update: data,
    });
    return this.toDisplay(row as Row);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/services/__tests__/rating.service.test.ts`
Expected: PASS.

> Si `prismaMock.playerRating` n'existe pas, ajouter `playerRating` à la liste des modèles mockés dans `backend/src/__mocks__/prisma.ts` (suivre exactement la forme des modèles déjà présents, ex. `reservation`).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/rating.service.ts backend/src/services/__tests__/rating.service.test.ts backend/src/__mocks__/prisma.ts
git commit -m "feat(rating): RatingService get/calibrate/display"
```

---

### Task 6: Routes API `/api/me/rating`

**Files:**
- Modify: `backend/src/routes/me.ts`
- Test: `backend/src/routes/__tests__/rating.routes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/routes/__tests__/rating.routes.test.ts
import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET manquant');
const token = () => jwt.sign({ id: 'u1', email: 'test@x.fr' }, process.env.JWT_SECRET!);

beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-padel' } as any);
});

describe('GET /api/me/rating', () => {
  it('200 + null si pas de niveau', async () => {
    prismaMock.playerRating.findUnique.mockResolvedValue(null as any);
    const res = await request(app).get('/api/me/rating?sport=padel').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it('401 sans token', async () => {
    const res = await request(app).get('/api/me/rating');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/me/rating/calibrate', () => {
  it('crée le niveau et renvoie l affichage', async () => {
    prismaMock.playerRating.findUnique.mockResolvedValue(null as any);
    prismaMock.playerRating.upsert.mockImplementation((args: any) =>
      Promise.resolve({ ...args.create, matchesPlayed: 0 }) as any);
    const res = await request(app).post('/api/me/rating/calibrate')
      .set('Authorization', `Bearer ${token()}`).send({ sport: 'padel', selfLevel: 4 });
    expect(res.status).toBe(200);
    expect(res.body.tier).toBe('Intermédiaire');
  });

  it('400 si palier hors bornes', async () => {
    const res = await request(app).post('/api/me/rating/calibrate')
      .set('Authorization', `Bearer ${token()}`).send({ sport: 'padel', selfLevel: 99 });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/routes/__tests__/rating.routes.test.ts`
Expected: FAIL — routes 404 (not registered yet).

- [ ] **Step 3: Brancher les routes dans `me.ts`**

En haut de `backend/src/routes/me.ts`, après les imports de services existants :

```ts
import { RatingService } from '../services/rating.service';
```

Après les instanciations existantes (`const eventService = new EventService();`) :

```ts
const ratingService = new RatingService();
```

Ajouter les deux routes (n'importe où parmi les `router.get/post`, ex. après `/memberships`) :

```ts
// Niveau du joueur connecté pour un sport (défaut padel). null = pas encore calibré.
router.get('/rating', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sport = typeof req.query.sport === 'string' ? req.query.sport : 'padel';
    res.json(await ratingService.getForDisplay(req.user!.id, sport));
  } catch (err) {
    if (err instanceof Error && err.message === 'SPORT_NOT_FOUND') return res.status(404).json({ error: 'SPORT_NOT_FOUND' });
    next(err);
  }
});

// Auto-évaluation du niveau. selfLevel 1–8, ou null pour « passer » (départ neutre).
router.post('/rating/calibrate', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sport = typeof req.body.sport === 'string' ? req.body.sport : 'padel';
    const raw = req.body.selfLevel;
    const selfLevel = raw === null || raw === undefined ? null : Number(raw);
    res.json(await ratingService.calibrate(req.user!.id, sport, selfLevel));
  } catch (err) {
    if (err instanceof Error && err.message === 'VALIDATION_ERROR') return res.status(400).json({ error: 'VALIDATION_ERROR' });
    if (err instanceof Error && err.message === 'SPORT_NOT_FOUND') return res.status(404).json({ error: 'SPORT_NOT_FOUND' });
    next(err);
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/routes/__tests__/rating.routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/me.ts backend/src/routes/__tests__/rating.routes.test.ts
git commit -m "feat(rating): routes GET /me/rating + POST /me/rating/calibrate"
```

---

### Task 7: Client API front + référentiel des paliers

**Files:**
- Modify: `frontend/lib/api.ts`
- Create: `frontend/lib/level.ts`

- [ ] **Step 1: Ajouter le type + les méthodes dans `lib/api.ts`**

Près des autres interfaces (ex. après `export interface MyProfile { … }`) :

```ts
export interface MyRating {
  calibrated: boolean;
  level: number;
  tier: string;
  isProvisional: boolean;
  matchesPlayed: number;
}
```

Dans l'objet `api` (à côté de `getMyProfile`) :

```ts
  getMyRating: (token: string, sport = 'padel') =>
    request<MyRating | null>(`/api/me/rating?sport=${encodeURIComponent(sport)}`, {}, token),

  calibrateRating: (selfLevel: number | null, token: string, sport = 'padel') =>
    request<MyRating>('/api/me/rating/calibrate', { method: 'POST', body: JSON.stringify({ sport, selfLevel }) }, token),
```

- [ ] **Step 2: Créer le référentiel des 8 paliers (miroir front)**

```ts
// frontend/lib/level.ts
// Référentiel padel 0–8 (French Padel Shop). Miroir d'affichage de backend/src/services/rating/level.ts.
// Les descriptions servent à l'auto-évaluation.

export interface LevelTier {
  level: number;       // 1–8
  name: string;
  blurb: string;       // résumé court pour l'auto-éval
}

export const LEVEL_TIERS: LevelTier[] = [
  { level: 1, name: 'Débutant',          blurb: 'Je commence à jouer, j’apprends les coups de base.' },
  { level: 2, name: 'Perfectionnement',  blurb: 'Je joue les coups de base, des échanges courts, je commence à volleyer.' },
  { level: 3, name: 'Élémentaire',       blurb: 'Je joue en loisir, je garde la balle en jeu, je commence la vitre de fond.' },
  { level: 4, name: 'Intermédiaire',     blurb: 'Longs échanges, je monte au filet et défends après un lob, placement selon mon partenaire.' },
  { level: 5, name: 'Confirmé',          blurb: 'Service-volée, repli sur lob, contre-attaque, effets et placement avec mon partenaire.' },
  { level: 6, name: 'Avancé',            blurb: 'Jeu rapide et effets, je maîtrise les doubles vitres et contre-attaque les smashs.' },
  { level: 7, name: 'Expert',            blurb: 'Je maîtrise tactique et coups appuyés (bandeja, vibora), bonne contre-attaque.' },
  { level: 8, name: 'Élite',             blurb: 'Niveau compétition national (P1000/P1500/P2000).' },
];
```

- [ ] **Step 3: Vérifier la compilation**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/api.ts frontend/lib/level.ts
git commit -m "feat(rating): client API niveau + référentiel des paliers"
```

---

### Task 8: UI — carte niveau + feuille de calibration sur le profil

**Files:**
- Create: `frontend/components/player/LevelBadge.tsx`
- Create: `frontend/components/player/LevelCalibration.tsx`
- Modify: `frontend/app/me/profile/page.tsx`
- Test: `frontend/__tests__/LevelCalibration.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/__tests__/LevelCalibration.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { LevelCalibration } from '@/components/player/LevelCalibration';

describe('LevelCalibration', () => {
  it('affiche les 8 paliers', () => {
    render(<LevelCalibration onSelect={() => {}} onSkip={() => {}} busy={false} />);
    expect(screen.getByText('Débutant')).toBeInTheDocument();
    expect(screen.getByText('Élite')).toBeInTheDocument();
  });

  it('cliquer un palier appelle onSelect avec son niveau', () => {
    const onSelect = jest.fn();
    render(<LevelCalibration onSelect={onSelect} onSkip={() => {}} busy={false} />);
    fireEvent.click(screen.getByText('Intermédiaire'));
    expect(onSelect).toHaveBeenCalledWith(4);
  });

  it('« Passer » appelle onSkip', () => {
    const onSkip = jest.fn();
    render(<LevelCalibration onSelect={() => {}} onSkip={onSkip} busy={false} />);
    fireEvent.click(screen.getByText('Passer'));
    expect(onSkip).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx jest __tests__/LevelCalibration.test.tsx`
Expected: FAIL — `Cannot find module '@/components/player/LevelCalibration'`.

- [ ] **Step 3: Créer `LevelBadge` puis `LevelCalibration`**

```tsx
// frontend/components/player/LevelBadge.tsx
'use client';
import { MyRating } from '@/lib/api';

// Pastille niveau réutilisable (profil v1 ; pastilles joueurs au Lot 3).
export function LevelBadge({ rating }: { rating: MyRating }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold"
      style={{ background: 'rgba(0,0,0,0.06)' }}
    >
      <strong>{rating.level.toFixed(1)}</strong>
      <span className="opacity-70">{rating.tier}</span>
      {rating.isProvisional && (
        <span className="rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase" style={{ background: '#ffb020', color: '#1a1a1a' }}>
          en calibrage
        </span>
      )}
    </span>
  );
}
```

```tsx
// frontend/components/player/LevelCalibration.tsx
'use client';
import { LEVEL_TIERS } from '@/lib/level';

interface Props {
  onSelect: (level: number) => void;
  onSkip: () => void;
  busy: boolean;
}

// Auto-évaluation : le joueur choisit le palier qui lui ressemble (référentiel padel 0–8).
export function LevelCalibration({ onSelect, onSkip, busy }: Props) {
  return (
    <div>
      <p className="mb-3 text-sm opacity-70">
        Choisis le niveau qui te ressemble le plus. Tu te recaleras vite sur tes premiers matchs.
      </p>
      <ul className="flex flex-col gap-2">
        {LEVEL_TIERS.map((t) => (
          <li key={t.level}>
            <button
              type="button"
              disabled={busy}
              onClick={() => onSelect(t.level)}
              className="flex w-full items-start gap-3 rounded-xl border p-3 text-left disabled:opacity-50"
              style={{ borderColor: 'rgba(0,0,0,0.12)' }}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-bold"
                    style={{ background: 'rgba(0,0,0,0.08)' }}>
                {t.level}
              </span>
              <span>
                <span className="block font-semibold">{t.name}</span>
                <span className="block text-sm opacity-70">{t.blurb}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" disabled={busy} onClick={onSkip} className="mt-3 text-sm underline opacity-70 disabled:opacity-50">
        Passer
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx jest __tests__/LevelCalibration.test.tsx`
Expected: PASS.

- [ ] **Step 5: Brancher la carte « Niveau » dans `/me/profile`**

Dans `frontend/app/me/profile/page.tsx` :

Imports (à côté des imports de composants existants) :

```tsx
import { LevelBadge } from '@/components/player/LevelBadge';
import { LevelCalibration } from '@/components/player/LevelCalibration';
import { MyRating } from '@/lib/api';
```

États (à côté des autres `useState`) :

```tsx
  const [rating, setRating] = useState<MyRating | null>(null);
  const [calibrating, setCalibrating] = useState(false);
  const [ratingBusy, setRatingBusy] = useState(false);
```

Charger le niveau au montage (dans le `useEffect` qui appelle déjà l'API avec `token`, après le chargement du profil) :

```tsx
      api.getMyRating(token).then(setRating).catch(() => {});
```

Handlers (près des autres fonctions du composant) :

```tsx
  const handleCalibrate = async (selfLevel: number | null) => {
    if (!token) return;
    setRatingBusy(true);
    try {
      const r = await api.calibrateRating(selfLevel, token);
      setRating(r);
      setCalibrating(false);
    } finally {
      setRatingBusy(false);
    }
  };
```

Rendu — insérer une carte « Niveau » dans le corps de la page (au-dessus de la carte « Informations »), en suivant le style des cartes existantes (`th`/classes déjà utilisées dans le fichier) :

```tsx
      <section className="rounded-2xl border p-4" style={{ borderColor: 'rgba(0,0,0,0.1)' }}>
        <h2 className="mb-2 font-semibold">Mon niveau padel</h2>
        {rating && !calibrating ? (
          // Un row existe (auto-éval OU « Passer » → niveau neutre) : on montre la pastille.
          <div className="flex items-center justify-between gap-3">
            <LevelBadge rating={rating} />
            <button type="button" className="text-sm underline opacity-70" onClick={() => setCalibrating(true)}>
              Réévaluer
            </button>
          </div>
        ) : (
          // Pas encore de niveau (rating null) ou réévaluation en cours.
          <LevelCalibration onSelect={(l) => handleCalibrate(l)} onSkip={() => handleCalibrate(null)} busy={ratingBusy} />
        )}
      </section>
```

- [ ] **Step 6: Run the full front test suite for regressions**

Run: `cd frontend && npx jest __tests__/LevelCalibration.test.tsx __tests__/MeProfile.test.tsx`
Expected: PASS. Si `MeProfile.test.tsx` mocke `lib/api`, ajouter `getMyRating: jest.fn().mockResolvedValue(null)` et `calibrateRating: jest.fn()` au mock pour éviter un crash.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/player/LevelBadge.tsx frontend/components/player/LevelCalibration.tsx frontend/app/me/profile/page.tsx frontend/__tests__/LevelCalibration.test.tsx frontend/__tests__/MeProfile.test.tsx
git commit -m "feat(rating): carte niveau + calibration sur le profil"
```

---

### Task 9: Vérification finale du Lot 1

- [ ] **Step 1: Gate backend**

Run: `cd backend && npx tsc --noEmit && npm test`
Expected: PASS, aucun test cassé.

- [ ] **Step 2: Gate frontend**

Run: `cd frontend && npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 3: Vérification manuelle (optionnel mais recommandé)**

Docker + back + front lancés, se connecter avec `test@palova.fr` / `password123`, aller sur `/me/profile` :
- la carte « Mon niveau padel » propose l'auto-évaluation ;
- choisir « Intermédiaire » → la carte affiche « 4.0 Intermédiaire · en calibrage » ;
- recharger la page → le niveau persiste.

---

## Notes de périmètre (Lot 1)

- **Pas de mise à jour par match** : `updateRating` (Task 1) est testé et prêt, mais branché sur les vrais matchs au **Lot 2** (`Match`/`MatchPlayer` + confirmation). La décote d'inactivité lazy s'appliquera à ce moment-là, avant chaque mise à jour.
- **Pas de courbe de progression** : elle se lira depuis les snapshots `MatchPlayer.ratingAfter` qui n'existent qu'au Lot 2. La carte profil n'affiche que le niveau courant en v1.
- **Constantes à caler** (`LEVEL_MIN_RATING`/`LEVEL_MAX_RATING`, `PROVISIONAL_RD_THRESHOLD`) : valeurs de départ raisonnables, à ajuster avec de vrais repères de joueurs après le Lot 2.
