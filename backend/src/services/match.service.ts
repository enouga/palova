import { prisma } from '../db/prisma';
import { Prisma } from '@prisma/client';
import { SetScore, winningTeam } from './rating/score';
import { applyMatchRatings, decayForInactivity, TeamPlayer } from './rating/match-rating';
import {
  DEFAULT_RD, DEFAULT_VOLATILITY, SKIP_DEFAULT_LEVEL,
  isProvisional, levelToRating, ratingToLevel,
} from './rating/level';
import { notifyMatchPendingConfirmation } from '../email/notifications';

const CONFIRM_WINDOW_HOURS = 72;

export interface CreateMatchInput {
  teams: Record<1 | 2, string[]>;
  sets: SetScore[];
  now: Date;
}

export class MatchService {
  /** Crée un résultat PENDING depuis une réservation COURT à 4 joueurs. L'auteur est confirmé d'office. */
  async createFromReservation(reservationId: string, authorUserId: string, input: CreateMatchInput) {
    const { teams, sets, now } = input;

    const t1 = teams[1] ?? [];
    const t2 = teams[2] ?? [];
    const all = [...t1, ...t2];
    if (t1.length !== 2 || t2.length !== 2 || new Set(all).size !== 4) throw new Error('VALIDATION_ERROR');
    if (!Array.isArray(sets) || sets.length === 0) throw new Error('VALIDATION_ERROR');

    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: {
        participants: { select: { userId: true } },
        resource: { select: { clubId: true, clubSport: { select: { sportId: true } } } },
      },
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

    const match = await prisma.match.create({
      data: {
        clubId: reservation.resource.clubId,
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
    this.safeNotify(() => notifyMatchPendingConfirmation(match.id));
    return match;
  }

  /** Exécute un envoi d'email en best-effort : un échec est loggé, jamais propagé. */
  private safeNotify(fn: () => Promise<void>): void {
    Promise.resolve(fn()).catch((err) => console.error('[notifications] envoi email échoué (match) :', err));
  }

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

  /** Résolution staff d'un litige (scopée au club). VALIDATE (avec sets corrigés optionnels) ou CANCEL. */
  async resolveDispute(matchId: string, clubId: string, action: 'VALIDATE' | 'CANCEL', sets?: SetScore[]): Promise<void> {
    const match = await prisma.match.findUnique({ where: { id: matchId }, select: { clubId: true, status: true } });
    if (!match || match.clubId !== clubId) throw new Error('MATCH_NOT_FOUND');
    if (match.status !== 'DISPUTED') throw new Error('MATCH_NOT_DISPUTED');

    if (action === 'CANCEL') {
      await prisma.match.update({ where: { id: matchId }, data: { status: 'CANCELLED' } });
      return;
    }
    const data: { status: 'PENDING'; sets?: object; winningTeam?: number } = { status: 'PENDING' };
    if (sets && sets.length) { data.sets = sets as unknown as object; data.winningTeam = winningTeam(sets); }
    await prisma.match.update({ where: { id: matchId }, data });
    await this.finalize(matchId);
  }

  /** Finalise un match confirmé : applique Glicko aux 4 joueurs (idempotent, transaction Serializable). */
  async finalize(matchId: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const match = await tx.match.findUnique({
        where: { id: matchId },
        include: { players: { select: { userId: true, team: true } } },
      });
      if (!match) throw new Error('MATCH_NOT_FOUND');
      if (match.ratingsAppliedAt) return; // déjà appliqué → idempotent
      if (match.status === 'CANCELLED') return; // ne jamais appliquer un match annulé

      const playedAt = match.playedAt;
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
}
