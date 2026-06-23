import { ClubEventKind, ClubEventStatus, Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import * as notify from '../email/notifications';
import { RatingService } from './rating.service';

export interface CreateEventInput {
  name: string;
  kind: ClubEventKind;
  description?: string | null;
  startTime: string | Date;
  endTime?: string | Date | null;
  registrationDeadline: string | Date;
  capacity?: number | null;
  price?: number | null;
  memberOnly?: boolean;
  clubSportId?: string | null;
}
export type UpdateEventInput = Partial<CreateEventInput & { status: ClubEventStatus }>;

// utilisé en Task 5 (validation du CRUD admin)
const KINDS: ClubEventKind[] = ['MELEE', 'STAGE', 'SOIREE', 'INITIATION', 'AUTRE'];

export class EventService {
  // ---------------------------------------------------------------- Inscription

  /** Inscrit le joueur connecté (individuel). Réinscription après annulation = la ligne repart en fin de file. */
  async register(eventId: string, userId: string) {
    const event = await prisma.clubEvent.findUnique({
      where: { id: eventId },
      select: { id: true, clubId: true, status: true, registrationDeadline: true, capacity: true, memberOnly: true },
    });
    if (!event) throw new Error('EVENT_NOT_FOUND');
    if (event.status !== 'PUBLISHED') throw new Error('EVENT_NOT_OPEN');
    if (new Date() >= event.registrationDeadline) throw new Error('REGISTRATION_CLOSED');

    const membership = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId, clubId: event.clubId } },
      select: { status: true },
    });
    if (membership?.status === 'BLOCKED') throw new Error('MEMBERSHIP_BLOCKED');
    if (event.memberOnly && membership?.status !== 'ACTIVE') throw new Error('MEMBERSHIP_REQUIRED');

    const registration = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM club_events WHERE id = ${eventId} FOR UPDATE`;
      const existing = await tx.eventRegistration.findUnique({
        where: { eventId_userId: { eventId, userId } },
        select: { id: true, status: true },
      });
      if (existing && existing.status !== 'CANCELLED') throw new Error('ALREADY_REGISTERED');

      const confirmed = await tx.eventRegistration.count({ where: { eventId, status: 'CONFIRMED' } });
      const status = event.capacity == null || confirmed < event.capacity ? 'CONFIRMED' : 'WAITLISTED';

      if (existing) {
        // Réinscription : la ligne CANCELLED est réutilisée, createdAt repart à
        // maintenant — le joueur ne récupère pas son ancienne position d'attente.
        return tx.eventRegistration.update({
          where: { id: existing.id },
          data: { status, cancelledAt: null, createdAt: new Date() },
        });
      }
      return tx.eventRegistration.create({ data: { eventId, userId, status } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 });

    // Emails hors transaction, best-effort (ne fait jamais échouer l'inscription).
    await this.safeNotify(() => notify.notifyEventRegistration(registration.id));
    return registration;
  }

  /** Exécute un envoi d'email en best-effort : un échec est loggé, jamais propagé. */
  private async safeNotify(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      console.error('[notifications] envoi email échoué (événement) :', err);
    }
  }

  /** Le joueur se désinscrit avant la deadline ; promotion auto du 1er en attente. */
  async cancelRegistration(eventId: string, userId: string) {
    const event = await prisma.clubEvent.findUnique({
      where: { id: eventId },
      select: { registrationDeadline: true },
    });
    if (!event) throw new Error('EVENT_NOT_FOUND');
    if (new Date() >= event.registrationDeadline) throw new Error('REGISTRATION_LOCKED');

    const { cancelled, promotedRegistrationId } = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM club_events WHERE id = ${eventId} FOR UPDATE`;
      const reg = await tx.eventRegistration.findFirst({
        where: { eventId, userId, status: { not: 'CANCELLED' } },
        select: { id: true, status: true },
      });
      if (!reg) throw new Error('REGISTRATION_NOT_FOUND');
      return this.cancelAndPromoteTx(tx, eventId, reg.id, reg.status === 'CONFIRMED');
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 });

    await this.notifyCancellation(cancelled.id, promotedRegistrationId);
    return cancelled;
  }

  /** Notifie désinscription + éventuelle promotion auto. Best-effort, hors transaction. */
  private async notifyCancellation(cancelledRegId: string, promotedRegistrationId: string | null): Promise<void> {
    await this.safeNotify(() => notify.notifyEventCancellation(cancelledRegId));
    if (promotedRegistrationId) await this.safeNotify(() => notify.notifyEventPromotion(promotedRegistrationId));
  }

  /** Passe une inscription CANCELLED et, si elle était CONFIRMED, promeut le 1er WAITLISTED. Renvoie l'inscription annulée + l'id éventuellement promu. À appeler sous verrou de l'événement. */
  private async cancelAndPromoteTx(tx: Prisma.TransactionClient, eventId: string, regId: string, wasConfirmed: boolean) {
    const cancelled = await tx.eventRegistration.update({
      where: { id: regId },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    let promotedRegistrationId: string | null = null;
    if (wasConfirmed) {
      const next = await tx.eventRegistration.findFirst({
        where: { eventId, status: 'WAITLISTED' },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (next) {
        await tx.eventRegistration.update({ where: { id: next.id }, data: { status: 'CONFIRMED' } });
        promotedRegistrationId = next.id;
      }
    }
    return { cancelled, promotedRegistrationId };
  }

  // --------------------------------------------------------- Lectures publiques

  /** Animations PUBLISHED d'un club (par slug), triées par date, avec compteurs. */
  async listPublicByClubSlug(slug: string) {
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, status: true } });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    const events = await prisma.clubEvent.findMany({
      where: { clubId: club.id, status: 'PUBLISHED' },
      orderBy: { startTime: 'asc' },
    });
    return this.withCounts(events);
  }

  /** Détail public (DRAFT masqué) + compteurs + infos club. */
  async getById(eventId: string) {
    const e = await prisma.clubEvent.findUnique({
      where: { id: eventId },
      include: { club: { select: { slug: true, name: true, timezone: true } } },
    });
    if (!e || e.status === 'DRAFT') throw new Error('EVENT_NOT_FOUND');
    const [withCount] = await this.withCounts([e]);
    return withCount;
  }

  /** Liste publique des inscrits (noms + avatar + niveau), confirmés puis liste d'attente. DRAFT masqué. */
  async listParticipants(eventId: string) {
    const e = await prisma.clubEvent.findUnique({
      where: { id: eventId },
      select: { status: true, clubSport: { select: { sport: { select: { key: true } } } } },
    });
    if (!e || e.status === 'DRAFT') throw new Error('EVENT_NOT_FOUND');
    const registrations = await prisma.eventRegistration.findMany({
      where: { eventId, status: { not: 'CANCELLED' } },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }], // CONFIRMED avant WAITLISTED, puis ordre d'inscription
      select: {
        id: true,
        status: true,
        userId: true,
        user: { select: { firstName: true, lastName: true, avatarUrl: true } },
      },
    });
    const allUserIds = registrations.map((r) => r.userId);
    const sportKey = e.clubSport?.sport.key ?? null;
    const ratingService = new RatingService();
    const levels = sportKey && allUserIds.length ? await ratingService.getLevelsForUsers(allUserIds, sportKey) : {};
    return registrations.map(({ userId, ...r }) => ({
      ...r,
      level: levels[userId] ?? null,
    }));
  }

  /** Inscriptions actives du joueur connecté, tous clubs, avec event + club. */
  async listUserRegistrations(userId: string) {
    return prisma.eventRegistration.findMany({
      where: { userId, status: { not: 'CANCELLED' } },
      orderBy: { event: { startTime: 'asc' } },
      include: { event: { include: { club: { select: { slug: true, name: true, timezone: true } } } } },
    });
  }

  /** Ajoute confirmedCount / waitlistCount à une liste d'événements. */
  private async withCounts<T extends { id: string }>(events: T[]) {
    if (events.length === 0) return [] as (T & { confirmedCount: number; waitlistCount: number })[];
    const grouped = await prisma.eventRegistration.groupBy({
      by: ['eventId', 'status'],
      where: { eventId: { in: events.map((e) => e.id) }, status: { not: 'CANCELLED' } },
      _count: { _all: true },
    });
    const count = (id: string, status: string) =>
      grouped.find((g) => g.eventId === id && g.status === status)?._count._all ?? 0;
    return events.map((e) => ({ ...e, confirmedCount: count(e.id, 'CONFIRMED'), waitlistCount: count(e.id, 'WAITLISTED') }));
  }

  // ----------------------------------------------------------- Admin (club)

  /** Tous les événements du club (DRAFT inclus) + compteurs. */
  async listForAdmin(clubId: string) {
    const events = await prisma.clubEvent.findMany({ where: { clubId }, orderBy: { startTime: 'desc' } });
    return this.withCounts(events);
  }

  /** Détail admin : event + inscriptions actives avec coordonnées. */
  async getForAdmin(eventId: string, clubId: string) {
    const e = await prisma.clubEvent.findFirst({ where: { id: eventId, clubId } });
    if (!e) throw new Error('EVENT_NOT_FOUND');
    const registrations = await prisma.eventRegistration.findMany({
      where: { eventId, status: { not: 'CANCELLED' } },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }], // CONFIRMED avant WAITLISTED
      include: { user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } } },
    });
    const [event] = await this.withCounts([e]);
    return { event, registrations };
  }

  async createEvent(clubId: string, input: CreateEventInput) {
    const data = this.validateEventInput(input, true);
    if (input.clubSportId != null) {
      const cs = await prisma.clubSport.findFirst({ where: { id: input.clubSportId, clubId } });
      if (!cs) throw new Error('VALIDATION_ERROR');
    }
    (data as Record<string, unknown>).clubSportId = input.clubSportId ?? null;
    return prisma.clubEvent.create({ data: { clubId, ...data } as Prisma.ClubEventUncheckedCreateInput });
  }

  async updateEvent(eventId: string, clubId: string, input: UpdateEventInput) {
    const found = await prisma.clubEvent.findFirst({ where: { id: eventId, clubId }, select: { id: true } });
    if (!found) throw new Error('EVENT_NOT_FOUND');
    const data = this.validateEventInput(input, false);
    if (input.status !== undefined) {
      if (!['DRAFT', 'PUBLISHED', 'CANCELLED'].includes(input.status as string)) throw new Error('VALIDATION_ERROR');
      (data as Record<string, unknown>).status = input.status;
    }
    if ('clubSportId' in input) {
      if (input.clubSportId != null) {
        const cs = await prisma.clubSport.findFirst({ where: { id: input.clubSportId, clubId } });
        if (!cs) throw new Error('VALIDATION_ERROR');
      }
      (data as Record<string, unknown>).clubSportId = input.clubSportId ?? null;
    }
    const updated = await prisma.clubEvent.update({ where: { id: eventId }, data });
    if (input.status === 'CANCELLED') {
      await this.safeNotify(() => notify.notifyActivityCancelledByClub('event', eventId));
    }
    return updated;
  }

  async deleteEvent(eventId: string, clubId: string) {
    const found = await prisma.clubEvent.findFirst({ where: { id: eventId, clubId }, select: { id: true } });
    if (!found) throw new Error('EVENT_NOT_FOUND');
    const active = await prisma.eventRegistration.count({ where: { eventId, status: { not: 'CANCELLED' } } });
    if (active > 0) throw new Error('HAS_REGISTRATIONS'); // utiliser status=CANCELLED pour annuler à la place
    await prisma.clubEvent.delete({ where: { id: eventId } });
  }

  /** Promotion manuelle par le club (override, sans contrôle de place). */
  async adminPromoteRegistration(eventId: string, regId: string, clubId: string) {
    const reg = await this.findClubRegistration(eventId, regId, clubId);
    if (reg.status !== 'WAITLISTED') throw new Error('VALIDATION_ERROR');
    const promoted = await prisma.eventRegistration.update({ where: { id: regId }, data: { status: 'CONFIRMED' } });
    await this.safeNotify(() => notify.notifyEventPromotion(promoted.id));
    return promoted;
  }

  /** Désinscription manuelle par le club (promeut le 1er en attente si CONFIRMED). */
  async adminRemoveRegistration(eventId: string, regId: string, clubId: string) {
    await this.findClubRegistration(eventId, regId, clubId); // vérifie l'appartenance au club
    const { cancelled, promotedRegistrationId } = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM club_events WHERE id = ${eventId} FOR UPDATE`;
      const reg = await tx.eventRegistration.findFirst({
        where: { id: regId, status: { not: 'CANCELLED' } },
        select: { id: true, status: true },
      });
      if (!reg) throw new Error('REGISTRATION_NOT_FOUND');
      return this.cancelAndPromoteTx(tx, eventId, regId, reg.status === 'CONFIRMED');
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 });

    await this.notifyCancellation(cancelled.id, promotedRegistrationId);
    return cancelled;
  }

  private async findClubRegistration(eventId: string, regId: string, clubId: string) {
    const reg = await prisma.eventRegistration.findFirst({
      where: { id: regId, eventId, event: { clubId } },
      select: { id: true, status: true },
    });
    if (!reg) throw new Error('REGISTRATION_NOT_FOUND');
    return reg;
  }

  /** Valide + normalise les champs. `requireAll` pour la création. */
  private validateEventInput(input: UpdateEventInput, requireAll: boolean) {
    const data: Record<string, unknown> = {};

    if (requireAll || input.name !== undefined) {
      const v = (input.name ?? '').trim();
      if (!v) throw new Error('VALIDATION_ERROR');
      data.name = v;
    }
    if (requireAll || input.kind !== undefined) {
      if (!KINDS.includes(input.kind as ClubEventKind)) throw new Error('VALIDATION_ERROR');
      data.kind = input.kind;
    }
    if (input.description !== undefined) data.description = (input.description ?? '')?.toString().trim() || null;

    const parseDate = (v: string | Date) => { const d = new Date(v); if (isNaN(d.getTime())) throw new Error('VALIDATION_ERROR'); return d; };
    if (requireAll || input.startTime !== undefined) data.startTime = parseDate(input.startTime as string | Date);
    if (requireAll || input.registrationDeadline !== undefined) data.registrationDeadline = parseDate(input.registrationDeadline as string | Date);
    if (input.endTime !== undefined) data.endTime = input.endTime ? parseDate(input.endTime) : null;

    if (input.capacity !== undefined) {
      if (input.capacity === null) data.capacity = null;
      else { const n = Math.trunc(Number(input.capacity)); if (isNaN(n) || n < 1) throw new Error('VALIDATION_ERROR'); data.capacity = n; }
    }
    if (input.price !== undefined) {
      if (input.price === null) data.price = null;
      else { const f = Number(input.price); if (isNaN(f) || f < 0) throw new Error('VALIDATION_ERROR'); data.price = new Prisma.Decimal(f); }
    }
    if (input.memberOnly !== undefined) {
      if (typeof input.memberOnly !== 'boolean') throw new Error('VALIDATION_ERROR');
      data.memberOnly = input.memberOnly;
    }
    return data;
  }
}
