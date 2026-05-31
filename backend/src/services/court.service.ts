import { prisma } from '../db/prisma';

interface CreateCourtParams {
  clubId: string;
  name: string;
  surface?: string;
  pricePerHour: number;
  openHour?: number;
  closeHour?: number;
}

interface UpdateCourtParams {
  name?: string;
  surface?: string;
  pricePerHour?: number;
  openHour?: number;
  closeHour?: number;
}

/** Valide les horaires/tarif. Lève VALIDATION_ERROR si invalide. */
function validateHoursAndPrice(open: number, close: number, price: number): void {
  if (!Number.isInteger(open) || !Number.isInteger(close) || open < 0 || close > 24 || open >= close) {
    throw new Error('VALIDATION_ERROR');
  }
  if (typeof price !== 'number' || isNaN(price) || price <= 0) {
    throw new Error('VALIDATION_ERROR');
  }
}

export class CourtService {
  /** Liste tous les terrains d'un club, y compris désactivés. */
  async listClubCourts(clubId: string) {
    return prisma.court.findMany({
      where: { clubId },
      orderBy: { name: 'asc' },
      select: {
        id: true, name: true, surface: true, isActive: true,
        pricePerHour: true, openHour: true, closeHour: true,
      },
    });
  }

  async createCourt(params: CreateCourtParams) {
    const name = (params.name ?? '').trim();
    if (!name) throw new Error('VALIDATION_ERROR');

    const openHour  = params.openHour  ?? 8;
    const closeHour = params.closeHour ?? 22;
    validateHoursAndPrice(openHour, closeHour, params.pricePerHour);

    return prisma.court.create({
      data: {
        clubId:       params.clubId,
        name,
        surface:      params.surface ?? 'indoor',
        pricePerHour: params.pricePerHour,
        openHour,
        closeHour,
      },
    });
  }

  /** Modifie un terrain en vérifiant qu'il appartient bien au club de l'admin. */
  async updateCourt(courtId: string, clubId: string, params: UpdateCourtParams) {
    const court = await prisma.court.findUnique({ where: { id: courtId } });
    // 404 plutôt que 403 si autre club : ne pas divulguer l'existence.
    if (!court || court.clubId !== clubId) throw new Error('COURT_NOT_FOUND');

    // Valide sur les valeurs effectives (merge avec l'existant).
    const openHour  = params.openHour  ?? court.openHour;
    const closeHour = params.closeHour ?? court.closeHour;
    const price     = params.pricePerHour ?? Number(court.pricePerHour);
    validateHoursAndPrice(openHour, closeHour, price);

    if (params.name !== undefined && !params.name.trim()) throw new Error('VALIDATION_ERROR');

    return prisma.court.update({
      where: { id: courtId },
      data: {
        ...(params.name         !== undefined ? { name: params.name.trim() } : {}),
        ...(params.surface      !== undefined ? { surface: params.surface } : {}),
        ...(params.pricePerHour !== undefined ? { pricePerHour: params.pricePerHour } : {}),
        ...(params.openHour     !== undefined ? { openHour: params.openHour } : {}),
        ...(params.closeHour    !== undefined ? { closeHour: params.closeHour } : {}),
      },
    });
  }

  async setCourtActive(courtId: string, clubId: string, isActive: boolean) {
    const court = await prisma.court.findUnique({ where: { id: courtId } });
    if (!court || court.clubId !== clubId) throw new Error('COURT_NOT_FOUND');

    return prisma.court.update({
      where: { id: courtId },
      data:  { isActive },
    });
  }
}
