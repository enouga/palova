import { prisma } from '../db/prisma';
import { reportError } from '../observability/reportError';
import { Prisma } from '@prisma/client';
import { SetScore, winningTeam } from './rating/score';
import { applyMatchRatings, decayForInactivity, TeamPlayer } from './rating/match-rating';
import {
  DEFAULT_RD, DEFAULT_VOLATILITY, SKIP_DEFAULT_LEVEL,
  isProvisional, levelToRating, ratingToLevel,
} from './rating/level';
import { notifyMatchPendingConfirmation, notifyNewMatchComment } from '../email/notifications';
import { recomputeSportRatings } from './rating/recompute';
import { effectiveTeams } from './matchTeams';
import { playerCount } from '../utils/courtType';
import { serializableTx } from '../db/serializable';

const CONFIRM_WINDOW_HOURS = 72;

export interface CreateMatchInput {
  teams: Record<1 | 2, string[]>;
  sets: SetScore[];
  now: Date;
  competitive?: boolean; // pris en compte SEULEMENT pour une résa privée ; PUBLIC hérite de la résa
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
        resource: { select: { clubId: true, clubSport: { select: { sportId: true } }, club: { select: { levelSystemEnabled: true } } } },
      },
    });
    if (!reservation) throw new Error('RESERVATION_NOT_FOUND');
    if (reservation.type !== 'COURT') throw new Error('NOT_A_COURT_RESERVATION');

    const participantIds = new Set(reservation.participants.map((p) => p.userId));
    if (!participantIds.has(authorUserId)) throw new Error('NOT_A_PARTICIPANT');
    if (participantIds.size !== 4) throw new Error('NEEDS_FOUR_PLAYERS');
    if (!all.every((id) => participantIds.has(id))) throw new Error('VALIDATION_ERROR');
    if (reservation.startTime.getTime() > now.getTime()) throw new Error('MATCH_NOT_PLAYED_YET');
    if (!reservation.resource.club.levelSystemEnabled) throw new Error('LEVEL_SYSTEM_DISABLED');

    const existing = await prisma.match.findFirst({
      where: { reservationId, status: { in: ['PENDING', 'CONFIRMED'] } },
      select: { id: true },
    });
    if (existing) throw new Error('MATCH_ALREADY_EXISTS');

    const teamOf = (userId: string): number => (t1.includes(userId) ? 1 : 2);
    const confirmDeadline = new Date(now.getTime() + CONFIRM_WINDOW_HOURS * 3600 * 1000);
    // PUBLIC (partie ouverte) → hérite du type déclaré, verrouillé (l'input ne peut pas
    // basculer en amicale à la saisie pour esquiver une défaite). Privé → input, défaut true.
    const competitive = reservation.visibility === 'PUBLIC'
      ? reservation.competitive
      : (input.competitive ?? true);

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
        competitive,
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

  /**
   * Réservations padel jouées (< 7 j) où `userId` est PARTICIPANT (pas seulement organisateur),
   * à 4 joueurs, sans résultat non annulé, club à niveau activé — prêtes à saisir.
   * Le côté/slot d'équipe est résolu à la lecture (effectiveTeams), comme listUserReservations.
   */
  async listToRecord(userId: string, now: Date) {
    const from = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
    const rows = await prisma.reservation.findMany({
      where: {
        type: 'COURT',
        status: 'CONFIRMED',
        endTime: { lte: now, gte: from },
        participants: { some: { userId } },
        resource: { club: { levelSystemEnabled: true }, clubSport: { sport: { key: 'padel' } } },
      },
      orderBy: { endTime: 'desc' },
      select: {
        id: true, startTime: true, endTime: true, competitive: true, visibility: true,
        resource: {
          select: {
            name: true, attributes: true,
            clubSport: { select: { sport: { select: { key: true, name: true } } } },
            club: { select: { slug: true, name: true, timezone: true } },
          },
        },
        participants: {
          orderBy: { joinedAt: 'asc' },
          select: { userId: true, isOrganizer: true, team: true, slot: true, user: { select: { firstName: true, lastName: true, avatarUrl: true } } },
        },
        matches: { select: { status: true } },
      },
    });

    return rows
      .filter((r) => r.participants.length === 4 && r.matches.every((m) => m.status === 'CANCELLED'))
      .map((r) => {
        const capacity = playerCount((r.resource.attributes as { format?: string } | null)?.format);
        const teamed = effectiveTeams(r.participants, capacity);
        return {
          reservationId: r.id,
          startTime: r.startTime,
          endTime: r.endTime,
          competitive: r.competitive,
          visibility: r.visibility,
          club: { slug: r.resource.club.slug, name: r.resource.club.name, timezone: r.resource.club.timezone },
          resourceName: r.resource.name,
          sport: { key: r.resource.clubSport.sport.key, name: r.resource.clubSport.sport.name },
          players: teamed.map((p) => ({
            userId: p.userId, isOrganizer: p.isOrganizer,
            firstName: p.user.firstName, lastName: p.user.lastName, avatarUrl: p.user.avatarUrl,
            team: p.team, slot: p.slot,
          })),
        };
      });
  }

  /** Exécute un envoi d'email en best-effort : un échec est loggé, jamais propagé. */
  private safeNotify(fn: () => Promise<void>): void {
    Promise.resolve(fn()).catch((err) => reportError(err, { source: 'safeNotify:match' }));
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

  /** Le joueur conteste : motif obligatoire (= 1er message), match → DISPUTED, aucun impact niveaux. */
  async dispute(matchId: string, userId: string, message: string): Promise<void> {
    const trimmed = (message ?? '').trim();
    if (!trimmed || trimmed.length > 1000) throw new Error('VALIDATION_ERROR');
    await this.loadPending(matchId, userId);
    await prisma.$transaction(async (tx) => {
      await tx.matchPlayer.update({
        where: { matchId_userId: { matchId, userId } },
        data: { confirmation: 'DISPUTED' },
      });
      await tx.match.update({ where: { id: matchId }, data: { status: 'DISPUTED' } });
      await tx.matchComment.create({ data: { matchId, userId, body: trimmed } });
    });
    this.safeNotify(() => notifyNewMatchComment(matchId, userId, { isFirst: true }));
  }

  /** Autorise l'accès au fil d'un match : l'un des 4 joueurs, OU un staff du club. Sinon jette. */
  private async assertMatchAccess(matchId: string, userId: string) {
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      select: { id: true, clubId: true, status: true, players: { select: { userId: true } } },
    });
    if (!match) throw new Error('MATCH_NOT_FOUND');
    const isPlayer = match.players.some((p) => p.userId === userId);
    if (!isPlayer) {
      const staff = await prisma.clubMember.findUnique({
        where: { userId_clubId: { userId, clubId: match.clubId } },
        select: { role: true },
      });
      if (!staff) throw new Error('FORBIDDEN'); // toute adhésion ClubMember = staff (OWNER/ADMIN/STAFF)
    }
    return match;
  }

  /** Fil de discussion d'un match (lecture). `isStaff` qualifie l'AUTEUR de chaque message. */
  async listComments(matchId: string, userId: string) {
    const match = await this.assertMatchAccess(matchId, userId);
    const [comments, staff] = await Promise.all([
      prisma.matchComment.findMany({
        where: { matchId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true, userId: true, body: true, createdAt: true,
          user: { select: { firstName: true, lastName: true, avatarUrl: true } },
        },
      }),
      prisma.clubMember.findMany({ where: { clubId: match.clubId }, select: { userId: true } }),
    ]);
    const staffIds = new Set(staff.map((s) => s.userId));
    return {
      status: match.status,
      comments: comments.map((c) => ({
        id: c.id,
        body: c.body,
        createdAt: c.createdAt,
        isStaff: staffIds.has(c.userId),
        author: { firstName: c.user.firstName, lastName: c.user.lastName, avatarUrl: c.user.avatarUrl },
      })),
    };
  }

  /** Ajoute un message au fil. Écriture autorisée seulement tant que le match est DISPUTED. */
  async addComment(matchId: string, userId: string, body: string): Promise<void> {
    const trimmed = (body ?? '').trim();
    if (!trimmed || trimmed.length > 1000) throw new Error('VALIDATION_ERROR');
    const match = await this.assertMatchAccess(matchId, userId);
    if (match.status !== 'DISPUTED') throw new Error('MATCH_NOT_DISPUTED');
    await prisma.matchComment.create({ data: { matchId, userId, body: trimmed } });
    this.safeNotify(() => notifyNewMatchComment(matchId, userId, { isFirst: false }));
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

  /** Annulation staff d'un match (scopée club). Motif obligatoire. Recalcule les niveaux si le match était confirmé. */
  async voidMatch(matchId: string, clubId: string, staffUserId: string, reason: string): Promise<void> {
    const trimmed = (reason ?? '').trim();
    if (!trimmed || trimmed.length > 200) throw new Error('VALIDATION_ERROR');

    await serializableTx(async (tx) => {
      const match = await tx.match.findUnique({
        where: { id: matchId },
        select: { clubId: true, sportId: true, status: true, ratingsAppliedAt: true, players: { select: { userId: true } } },
      });
      if (!match || match.clubId !== clubId) throw new Error('MATCH_NOT_FOUND');
      if (match.status === 'CANCELLED') throw new Error('ALREADY_CANCELLED');

      await tx.match.update({
        where: { id: matchId },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledByUserId: staffUserId, cancelledReason: trimmed },
      });
      await tx.matchPlayer.updateMany({ where: { matchId }, data: { ratingBefore: null, ratingAfter: null } });

      if (match.ratingsAppliedAt) {
        await recomputeSportRatings(tx, match.sportId, match.players.map((p) => p.userId));
      }
    });
  }

  /** Finalise un match confirmé : applique Glicko aux 4 joueurs (idempotent, transaction Serializable). */
  async finalize(matchId: string): Promise<void> {
    await serializableTx(async (tx) => {
      const match = await tx.match.findUnique({
        where: { id: matchId },
        include: { players: { select: { userId: true, team: true } } },
      });
      if (!match) throw new Error('MATCH_NOT_FOUND');
      if (match.ratingsAppliedAt) return; // déjà appliqué → idempotent
      if (match.status === 'CANCELLED') return; // ne jamais appliquer un match annulé
      // Amicale : on confirme le résultat mais on n'applique JAMAIS le niveau.
      // ratingsAppliedAt reste null → voidMatch ne recalculera rien. Idempotent.
      if (!match.competitive) {
        if (match.status !== 'CONFIRMED') {
          await tx.match.update({ where: { id: matchId }, data: { status: 'CONFIRMED' } });
        }
        return;
      }

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
    });
  }
}

/** Singleton partagé (routes + tests). */
export const matchService = new MatchService();
