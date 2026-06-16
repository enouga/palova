import { prisma } from '../db/prisma';
import { SetScore, winningTeam } from './rating/score';

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

    return prisma.match.create({
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
  }
}
