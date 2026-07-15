import { prisma } from '../db/prisma';

/**
 * Nom/photo affichés d'un coach : dérivés du compte user lié quand présent (l'avatar est géré
 * par le joueur lui-même) ; repli sur les colonnes historiques pour un coach legacy sans compte.
 */
export function coachDisplay(c: {
  name: string;
  photoUrl?: string | null;
  user?: { firstName: string; lastName: string; avatarUrl?: string | null } | null;
}): { name: string; photoUrl: string | null } {
  if (c.user) return { name: `${c.user.firstName} ${c.user.lastName}`.trim(), photoUrl: c.user.avatarUrl ?? null };
  return { name: c.name, photoUrl: c.photoUrl ?? null };
}

export class CoachService {
  /** Liste back-office : actifs d'abord, puis ordre choisi, puis alphabétique. Nom/photo dérivés du user lié. */
  async listAdmin(clubId: string) {
    const rows = await prisma.coach.findMany({
      where: { clubId },
      orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      include: { user: { select: { firstName: true, lastName: true, avatarUrl: true } } },
    });
    return rows.map((c) => ({
      id: c.id, clubId: c.clubId, isActive: c.isActive, sortOrder: c.sortOrder,
      ...coachDisplay(c),
    }));
  }

  /**
   * Statut « coach » d'un membre. Coché : crée (nom snapshoté depuis le user) ou réactive sa
   * ligne Coach ; décoché : soft-disable (idempotent). Pas de garde self/owner — être coach ne
   * confère aucun privilège d'accès, un admin peut se marquer lui-même coach.
   * Lève : MEMBER_NOT_FOUND si la cible n'est pas membre du club.
   */
  async setMemberCoach(clubId: string, userId: string, isCoach: boolean) {
    const membership = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId, clubId } }, select: { id: true },
    });
    if (!membership) throw new Error('MEMBER_NOT_FOUND');

    if (!isCoach) {
      await prisma.coach.updateMany({ where: { clubId, userId }, data: { isActive: false } });
      return { userId, isCoach: false };
    }

    const existing = await prisma.coach.findUnique({
      where: { clubId_userId: { clubId, userId } }, select: { id: true, isActive: true },
    });
    if (existing) {
      if (!existing.isActive) await prisma.coach.update({ where: { id: existing.id }, data: { isActive: true } });
    } else {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true } });
      await prisma.coach.create({
        data: { clubId, userId, name: `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim(), isActive: true },
      });
    }
    return { userId, isCoach: true };
  }
}
