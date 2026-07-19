import { DateTime } from 'luxon';
import { prisma } from '../db/prisma';
import { bySortOrder } from './resource.service';
import { classifySlot, OffPeakHours } from './pricing';
import { HOLD_EXPIRY_MINUTES } from './holdWindow';
import { cachedClubAvailability } from './availabilityCache';

export interface TimeSlot {
  startTime: string;
  endTime: string;
  available: boolean;
  price: string;    // prix du créneau (tarif creux si entièrement en heures creuses)
  offPeak: boolean; // true si le créneau est ENTIÈREMENT en heures creuses
}

interface SlotResource {
  openHour: number;
  closeHour: number;
  price: unknown;          // Prisma.Decimal
  offPeakPrice: unknown | null;
}

interface ActiveWindow { startTime: Date; endTime: Date }

/** Filtre « réservation qui occupe le créneau » : CONFIRMED, ou hold PENDING récent. */
function activeReservationWhere(now: number) {
  const holdExpiryCutoff = new Date(now - HOLD_EXPIRY_MINUTES * 60 * 1000);
  return {
    OR: [
      { status: 'CONFIRMED' as const },
      { status: 'PENDING' as const, createdAt: { gt: holdExpiryCutoff } },
    ],
  };
}

export class AvailabilityService {
  /**
   * Grille de créneaux d'UN terrain — pur (aucun I/O), partagé par la lecture
   * terrain-seul et la lecture club (qui a déjà chargé réservations et club).
   */
  private buildSlots(
    resource: SlotResource,
    tz: string,
    offPeak: OffPeakHours | null,
    dayStartLocal: DateTime,
    durationMinutes: number,
    reservations: ActiveWindow[],
  ): TimeSlot[] {
    const open = dayStartLocal.set({ hour: resource.openHour }).toUTC();
    const close = dayStartLocal.set({ hour: resource.closeHour }).toUTC();
    const baseCents = Math.round(Number(resource.price) * 100);
    const offCents = resource.offPeakPrice != null ? Math.round(Number(resource.offPeakPrice) * 100) : null;

    const slots: TimeSlot[] = [];
    let cursor = open;
    while (cursor.plus({ minutes: durationMinutes }) <= close) {
      const slotEndDt = cursor.plus({ minutes: durationMinutes });
      const slotStart = cursor.toJSDate();
      const slotEnd = slotEndDt.toJSDate();

      const hasConflict = reservations.some(
        (r) => r.startTime < slotEnd && r.endTime > slotStart,
      );

      // classifySlot UNE seule fois par créneau : le prix en découle directement
      // (slotPriceCents refaisait la même marche luxon en interne → 2× le travail
      // CPU sur le chemin le plus chaud du backend).
      const offPeakSlot = classifySlot(offPeak, slotStart, slotEnd, tz) === 'OFF_PEAK';
      const priceCents = offPeakSlot && offCents != null ? offCents : baseCents;

      slots.push({
        startTime: cursor.toISO()!,
        endTime: slotEndDt.toISO()!,
        available: !hasConflict,
        price: (priceCents / 100).toFixed(2),
        offPeak: offPeakSlot,
      });

      // Créneaux fixes consécutifs : on avance d'une durée pleine (et non d'une
      // granularité fine) — terrain ouvrant à 8h en 1h30 → 8h, 9h30, 11h…
      cursor = slotEndDt;
    }

    return slots;
  }

  async getAvailableSlots(
    resourceId: string,
    date: string,
    durationMinutes: number,
  ): Promise<TimeSlot[]> {
    const resource = await prisma.resource.findUniqueOrThrow({
      where: { id: resourceId },
      select: {
        openHour: true,
        closeHour: true,
        price: true,
        offPeakPrice: true,
        club: { select: { timezone: true, offPeakHours: true } },
      },
    });

    const tz = resource.club.timezone;

    // Ouverture/fermeture exprimées en heure LOCALE du club, converties en instants UTC.
    const dayStartLocal = DateTime.fromISO(date, { zone: tz }).startOf('day');
    if (!dayStartLocal.isValid) throw new Error('INVALID_DATE');

    const open = dayStartLocal.set({ hour: resource.openHour }).toUTC();
    const close = dayStartLocal.set({ hour: resource.closeHour }).toUTC();

    const activeReservations = await prisma.reservation.findMany({
      where: {
        resourceId,
        ...activeReservationWhere(Date.now()),
        startTime: { lt: close.toJSDate() },
        endTime: { gt: open.toJSDate() },
      },
      select: { startTime: true, endTime: true },
    });

    return this.buildSlots(
      resource, tz, resource.club.offPeakHours as OffPeakHours | null,
      dayStartLocal, durationMinutes, activeReservations,
    );
  }

  /**
   * Disponibilités des terrains actifs d'un club (vue planning joueur).
   * `clubSportId` (optionnel) restreint à un sport — la page Réserver charge chaque
   * sport avec sa propre durée. Absent = tous les terrains (comportement historique).
   * Coût constant : 3 requêtes SQL quel que soit le nombre de terrains (club,
   * terrains, réservations groupées) — c'était 2 + 2×terrains avant.
   */
  async getClubAvailability(clubId: string, date: string, durationMinutes: number, clubSportId?: string) {
    const club = await prisma.club.findUniqueOrThrow({
      where: { id: clubId },
      select: { timezone: true, offPeakHours: true },
    });
    const tz = club.timezone;
    const offPeak = club.offPeakHours as OffPeakHours | null;

    const dayStartLocal = DateTime.fromISO(date, { zone: tz }).startOf('day');
    if (!dayStartLocal.isValid) throw new Error('INVALID_DATE');

    const resources = (await prisma.resource.findMany({
      where: { clubId, isActive: true, ...(clubSportId ? { clubSportId } : {}) },
      select: {
        id: true, name: true, attributes: true, price: true, offPeakPrice: true,
        openHour: true, closeHour: true,
        clubSport: { select: { id: true, sport: { select: { key: true, name: true } } } },
      },
    })).sort(bySortOrder);
    if (resources.length === 0) return [];

    // UNE requête de réservations pour TOUS les terrains, sur l'union des fenêtres
    // d'ouverture, puis regroupement par terrain en mémoire.
    const minOpen = Math.min(...resources.map((r) => r.openHour));
    const maxClose = Math.max(...resources.map((r) => r.closeHour));
    const windowStart = dayStartLocal.set({ hour: minOpen }).toUTC().toJSDate();
    const windowEnd = dayStartLocal.set({ hour: maxClose }).toUTC().toJSDate();

    const active = await prisma.reservation.findMany({
      where: {
        resourceId: { in: resources.map((r) => r.id) },
        ...activeReservationWhere(Date.now()),
        startTime: { lt: windowEnd },
        endTime: { gt: windowStart },
      },
      select: { resourceId: true, startTime: true, endTime: true },
    });

    const byResource = new Map<string, ActiveWindow[]>();
    for (const r of active) {
      const list = byResource.get(r.resourceId);
      if (list) list.push(r); else byResource.set(r.resourceId, [r]);
    }

    return resources.map((r) => ({
      resource: {
        id: r.id, name: r.name, attributes: r.attributes, price: r.price, offPeakPrice: r.offPeakPrice,
        sport: r.clubSport.sport, clubSportId: r.clubSport.id,
      },
      slots: this.buildSlots(r, tz, offPeak, dayStartLocal, durationMinutes, byResource.get(r.id) ?? []),
    }));
  }

  /**
   * Lecture par slug servie par le micro-cache (TTL court + single-flight) : c'est
   * l'endpoint public que la page Réserver martèle au rush de minuit. Sur un hit,
   * zéro requête SQL (la résolution slug→club vit dans le calcul mis en cache).
   */
  async getClubAvailabilityBySlug(slug: string, date: string, durationMinutes: number, clubSportId?: string) {
    return cachedClubAvailability(
      `${slug}|${date}|${durationMinutes}|${clubSportId ?? ''}`,
      async () => {
        const club = await prisma.club.findUnique({
          where: { slug },
          select: { id: true, status: true },
        });
        if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
        return {
          clubId: club.id,
          payload: await this.getClubAvailability(club.id, date, durationMinutes, clubSportId),
        };
      },
    );
  }
}
