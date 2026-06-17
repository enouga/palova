import { Prisma } from '@prisma/client';
import { SetScore } from './score';
import { applyMatchRatings, decayForInactivity, TeamPlayer } from './match-rating';
import { RatingState } from './glicko2';
import {
  DEFAULT_RD, DEFAULT_VOLATILITY, SKIP_DEFAULT_LEVEL,
  isProvisional, levelToRating, ratingToLevel,
} from './level';

export interface ReplayBaseline { userId: string; initialSelfLevel: number | null; }

export interface ReplayMatchInput {
  matchId: string;
  playedAt: Date;
  sets: [number, number][];
  players: { userId: string; team: 1 | 2 }[];
}

export interface ReplayPlayerState {
  userId: string;
  rating: number; rd: number; volatility: number;
  displayLevel: number; isProvisional: boolean;
  matchesPlayed: number; lastMatchAt: Date | null;
}

export interface ReplayMatchPlayerState { matchId: string; userId: string; before: number; after: number; }

export interface ReplayOutput { players: ReplayPlayerState[]; matchPlayers: ReplayMatchPlayerState[]; }

interface Live extends RatingState { last: Date | null; matchesPlayed: number; }

/**
 * Rejoue l'historique des matchs (déjà filtré CONFIRMED) sur des calibrations de départ.
 * Pur et déterministe : aucune dépendance à la DB ni à l'horloge.
 * Réutilise les mêmes primitives que MatchService.finalize, dans l'ordre des playedAt.
 */
export function replayRatings(baselines: ReplayBaseline[], matches: ReplayMatchInput[]): ReplayOutput {
  const live = new Map<string, Live>();
  for (const b of baselines) {
    const rating = levelToRating(b.initialSelfLevel ?? SKIP_DEFAULT_LEVEL);
    live.set(b.userId, { rating, rd: DEFAULT_RD, volatility: DEFAULT_VOLATILITY, last: null, matchesPlayed: 0 });
  }

  const matchPlayers: ReplayMatchPlayerState[] = [];
  const ordered = [...matches].sort((a, b) => a.playedAt.getTime() - b.playedAt.getTime());

  for (const m of ordered) {
    const states: (TeamPlayer & { userId: string; before: number })[] = [];
    for (const p of m.players) {
      const s = live.get(p.userId);
      if (!s) throw new Error(`REPLAY_MISSING_BASELINE:${p.userId}`);
      const days = s.last ? Math.max(0, (m.playedAt.getTime() - s.last.getTime()) / 86400000) : 0;
      const decayed = decayForInactivity({ rating: s.rating, rd: s.rd, volatility: s.volatility }, days);
      states.push({ ...decayed, team: p.team, userId: p.userId, before: ratingToLevel(decayed.rating) });
    }
    const updated = applyMatchRatings(states, m.sets as unknown as SetScore[]);
    for (let i = 0; i < states.length; i++) {
      const s = states[i];
      const u = updated[i];
      const after = ratingToLevel(u.rating);
      matchPlayers.push({ matchId: m.matchId, userId: s.userId, before: s.before, after });
      const cur = live.get(s.userId)!;
      cur.rating = u.rating; cur.rd = u.rd; cur.volatility = u.volatility;
      cur.last = m.playedAt; cur.matchesPlayed += 1;
    }
  }

  const players: ReplayPlayerState[] = [...live.entries()].map(([userId, s]) => ({
    userId,
    rating: s.rating, rd: s.rd, volatility: s.volatility,
    displayLevel: ratingToLevel(s.rating), isProvisional: isProvisional(s.rd),
    matchesPlayed: s.matchesPlayed, lastMatchAt: s.last,
  }));

  return { players, matchPlayers };
}

/**
 * Recalcule les niveaux d'un sport par rejeu complet des matchs CONFIRMED, dans la transaction `tx`.
 * `extraUserIds` = joueurs à inclure même s'ils n'ont plus de match confirmé (ex. les 4 du match
 * qu'on vient d'annuler) afin qu'ils retombent sur leur calibration.
 */
export async function recomputeSportRatings(
  tx: Prisma.TransactionClient,
  sportId: string,
  extraUserIds: string[] = [],
): Promise<void> {
  const confirmed = await tx.match.findMany({
    where: { sportId, status: 'CONFIRMED' },
    orderBy: { playedAt: 'asc' },
    select: { id: true, playedAt: true, sets: true, players: { select: { userId: true, team: true } } },
  });

  const userIds = new Set<string>(extraUserIds);
  for (const m of confirmed) for (const p of m.players) userIds.add(p.userId);

  const rows = await tx.playerRating.findMany({
    where: { sportId, userId: { in: [...userIds] } },
    select: { userId: true, initialSelfLevel: true },
  });
  const selfLevel = new Map(rows.map((r) => [r.userId, r.initialSelfLevel]));
  const baselines: ReplayBaseline[] = [...userIds].map((userId) => ({
    userId, initialSelfLevel: selfLevel.get(userId) ?? null,
  }));

  const matches: ReplayMatchInput[] = confirmed.map((m) => ({
    matchId: m.id,
    playedAt: m.playedAt,
    sets: m.sets as unknown as [number, number][],
    players: m.players.map((p) => ({ userId: p.userId, team: p.team as 1 | 2 })),
  }));

  const out = replayRatings(baselines, matches);

  for (const p of out.players) {
    await tx.playerRating.update({
      where: { userId_sportId: { userId: p.userId, sportId } },
      data: {
        rating: p.rating, rd: p.rd, volatility: p.volatility,
        displayLevel: p.displayLevel, isProvisional: p.isProvisional,
        matchesPlayed: p.matchesPlayed, lastMatchAt: p.lastMatchAt,
      },
    });
  }
  for (const mp of out.matchPlayers) {
    await tx.matchPlayer.update({
      where: { matchId_userId: { matchId: mp.matchId, userId: mp.userId } },
      data: { ratingBefore: mp.before, ratingAfter: mp.after },
    });
  }
}
