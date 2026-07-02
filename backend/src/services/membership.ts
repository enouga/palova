import { prisma } from '../db/prisma';

/**
 * Résout un club ACTIVE par slug et GARANTIT l'adhésion ACTIVE de l'appelant :
 * créée si absente (comme à la 1re réservation), refus si BLOCKED.
 * Renvoie l'id du club. Utilisé par le join de partie ouverte et l'accès au chat.
 */
export async function ensureActiveMembership(slug: string, userId: string): Promise<{ id: string }> {
  const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, status: true } });
  if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
  const member = await prisma.clubMembership.findUnique({
    where: { userId_clubId: { userId, clubId: club.id } },
    select: { status: true },
  });
  if (member?.status === 'BLOCKED') throw new Error('MEMBERSHIP_BLOCKED');
  if (!member) await prisma.clubMembership.create({ data: { userId, clubId: club.id } });
  return { id: club.id };
}
