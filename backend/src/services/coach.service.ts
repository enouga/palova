import { prisma } from '../db/prisma';

export interface CoachInput {
  name?: string;
  photoUrl?: string | null;
  bio?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}

export class CoachService {
  /** Liste back-office : actifs d'abord, puis ordre choisi, puis alphabétique. */
  async listAdmin(clubId: string) {
    return prisma.coach.findMany({
      where: { clubId },
      orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async create(clubId: string, data: CoachInput) {
    const name = (data.name ?? '').trim();
    if (!name) throw new Error('VALIDATION_ERROR');
    return prisma.coach.create({
      data: {
        clubId,
        name,
        photoUrl: data.photoUrl?.trim() || null,
        bio: data.bio?.trim() || null,
        sortOrder: Number.isInteger(data.sortOrder) ? data.sortOrder! : 0,
        isActive: data.isActive ?? true,
      },
    });
  }

  async update(id: string, clubId: string, data: CoachInput) {
    const found = await prisma.coach.findUnique({ where: { id }, select: { clubId: true } });
    if (!found || found.clubId !== clubId) throw new Error('COACH_NOT_FOUND');
    return prisma.coach.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.photoUrl !== undefined ? { photoUrl: data.photoUrl?.trim() || null } : {}),
        ...(data.bio !== undefined ? { bio: data.bio?.trim() || null } : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: Number(data.sortOrder) } : {}),
        ...(data.isActive !== undefined ? { isActive: !!data.isActive } : {}),
      },
    });
  }

  /** Suppression douce : un coach peut être référencé par des séries/cours → on désactive. */
  async remove(id: string, clubId: string) {
    const found = await prisma.coach.findUnique({ where: { id }, select: { clubId: true } });
    if (!found || found.clubId !== clubId) throw new Error('COACH_NOT_FOUND');
    await prisma.coach.update({ where: { id }, data: { isActive: false } });
  }
}
