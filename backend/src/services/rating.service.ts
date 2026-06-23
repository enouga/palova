import { prisma } from '../db/prisma';
import {
  DEFAULT_RD, DEFAULT_VOLATILITY, SKIP_DEFAULT_LEVEL,
  isProvisional, levelToRating, namedTier, ratingToLevel,
} from './rating/level';
import { reliability } from './rating/reliability';

export interface UserLevel { level: number; tier: string; isProvisional: boolean; reliability: number; }

export interface RatingDisplay {
  calibrated: boolean;     // a fait l'auto-éval OU a déjà joué
  level: number | null;    // 0–8, ou null si pas encore de niveau (onboarding neutre)
  tier: string;            // palier nommé ('' tant que non calibré)
  isProvisional: boolean;  // « en calibrage »
  reliability: number;     // % de fiabilité (dérivé du RD, façon Pista)
  matchesPlayed: number;
}

// État neutre d'un joueur sans PlayerRating : pas d'auto-éval forcée, les matchs calibreront.
const NEUTRAL_RATING: RatingDisplay = {
  calibrated: false, level: null, tier: '', isProvisional: true,
  reliability: reliability(DEFAULT_RD), matchesPlayed: 0,
};

type Row = {
  displayLevel: number; rd: number; isProvisional: boolean; matchesPlayed: number; initialSelfLevel: number | null;
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
      reliability: reliability(row.rd),
      matchesPlayed: row.matchesPlayed,
    };
  }

  /** Lecture pour affichage. Sans PlayerRating → état neutre (level null, non calibré). */
  async getForDisplay(userId: string, sportKey: string): Promise<RatingDisplay> {
    const sportId = await this.sportId(sportKey);
    const row = await prisma.playerRating.findUnique({ where: { userId_sportId: { userId, sportId } } });
    return row ? this.toDisplay(row as Row) : NEUTRAL_RATING;
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

  /** Niveaux d'un lot de joueurs pour un sport. Map userId → niveau (absent si pas de rating). */
  async getLevelsForUsers(userIds: string[], sportKey: string): Promise<Record<string, UserLevel>> {
    if (userIds.length === 0) return {};
    const sportId = await this.sportId(sportKey);
    const rows = await prisma.playerRating.findMany({
      where: { sportId, userId: { in: userIds } },
      select: { userId: true, displayLevel: true, rd: true, isProvisional: true },
    });
    const map: Record<string, UserLevel> = {};
    for (const r of rows) map[r.userId] = { level: r.displayLevel, tier: namedTier(r.displayLevel), isProvisional: r.isProvisional, reliability: reliability(r.rd) };
    return map;
  }

  /** Niveaux d'un lot de paires (userId, sportKey). Clé de retour : `${userId}:${sportKey}`. Un seul findMany. */
  async getLevelsBySport(pairs: { userId: string; sportKey: string }[]): Promise<Record<string, UserLevel>> {
    if (pairs.length === 0) return {};
    const sportKeys = [...new Set(pairs.map((p) => p.sportKey))];
    const sports = await prisma.sport.findMany({ where: { key: { in: sportKeys } }, select: { id: true, key: true } });
    const keyById = new Map(sports.map((s) => [s.id, s.key]));
    const userIds = [...new Set(pairs.map((p) => p.userId))];
    const rows = await prisma.playerRating.findMany({
      where: { sportId: { in: sports.map((s) => s.id) }, userId: { in: userIds } },
      select: { userId: true, sportId: true, displayLevel: true, rd: true, isProvisional: true },
    });
    const map: Record<string, UserLevel> = {};
    for (const r of rows) {
      const key = keyById.get(r.sportId);
      if (key) map[`${r.userId}:${key}`] = { level: r.displayLevel, tier: namedTier(r.displayLevel), isProvisional: r.isProvisional, reliability: reliability(r.rd) };
    }
    return map;
  }
}
