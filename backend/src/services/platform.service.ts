import { prisma } from '../db/prisma';

export interface PlatformStats {
  clubs: { total: number; active: number; suspended: number };
  users: number;
  reservations: number;
  tournaments: number;
}

export class PlatformService {
  /** Statistiques globales de la plateforme. */
  async getStats(): Promise<PlatformStats> {
    const [total, active, suspended, users, reservations, tournaments] = await Promise.all([
      prisma.club.count(),
      prisma.club.count({ where: { status: 'ACTIVE' } }),
      prisma.club.count({ where: { status: 'SUSPENDED' } }),
      prisma.user.count(),
      prisma.reservation.count(),
      prisma.tournament.count(),
    ]);
    return { clubs: { total, active, suspended }, users, reservations, tournaments };
  }
}
