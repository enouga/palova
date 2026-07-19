import { ClubEventKind, ClubEventStatus, Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { serializableTx } from '../db/serializable';
import * as notify from '../email/notifications';
import { RatingService } from './rating.service';
import { occupiesSpotWhere, holdDeadline, entryFeeCents } from './registrationPayment';
import { PackageService } from './package.service';
import { StripeService } from './stripe.service';
import { RefundService } from './refund.service';

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
  requirePrepayment?: boolean;
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
      select: { id: true, clubId: true, status: true, registrationDeadline: true, capacity: true, memberOnly: true, requirePrepayment: true, price: true },
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

    const paid = event.requirePrepayment;

    const registration = await serializableTx(async (tx) => {
      await tx.$queryRaw`SELECT id FROM club_events WHERE id = ${eventId} FOR UPDATE`;
      const existing = await tx.eventRegistration.findUnique({
        where: { eventId_userId: { eventId, userId } },
        select: { id: true, status: true },
      });
      if (existing && existing.status !== 'CANCELLED') throw new Error('ALREADY_REGISTERED');

      const now = new Date();
      const confirmed = await tx.eventRegistration.count({ where: { eventId, ...(occupiesSpotWhere(now) as any) } });
      const status = event.capacity == null || confirmed < event.capacity ? 'CONFIRMED' : 'WAITLISTED';

      if (existing) {
        // Réinscription : la ligne CANCELLED est réutilisée, createdAt repart à
        // maintenant — le joueur ne récupère pas son ancienne position d'attente.
        return tx.eventRegistration.update({
          where: { id: existing.id },
          data: {
            status, cancelledAt: null, createdAt: new Date(),
            ...(paid ? { paymentStatus: 'DUE', paymentDeadline: paid && status === 'CONFIRMED' ? holdDeadline(now) : null } : { paymentStatus: 'NONE', paymentDeadline: null }),
          },
        });
      }
      return tx.eventRegistration.create({
        data: {
          eventId, userId, status,
          ...(paid ? { paymentStatus: 'DUE', paymentDeadline: status === 'CONFIRMED' ? holdDeadline(now) : null } : {}),
        },
      });
    }, { timeout: 10_000 });

    // Pour une place CONFIRMED payante, la notif d'inscription part au paiement confirmé.
    if (!paid || registration.status === 'WAITLISTED') {
      await this.safeNotify(() => notify.notifyEventRegistration(registration.id));
    }
    const payment = paid ? { mode: (registration.status === 'CONFIRMED' ? 'payment' : 'setup') as 'payment' | 'setup' } : null;
    return { registration, payment };
  }

  /** Confirme le paiement d'une inscription DUE → PAID + Payment ONLINE. Idempotent (client + webhook). */
  async confirmRegistrationPayment(regId: string, opts: { stripePaymentIntentId: string }) {
    const reg = await prisma.eventRegistration.findUnique({
      where: { id: regId },
      select: { id: true, paymentStatus: true, event: { select: { clubId: true, price: true } } },
    });
    if (!reg) throw new Error('REGISTRATION_NOT_FOUND');
    if (reg.paymentStatus !== 'DUE') return reg; // déjà confirmé / non payant → no-op idempotent

    const amountCents = entryFeeCents(reg.event.price);
    const result = await serializableTx(async (tx) => {
      const flip = await tx.eventRegistration.updateMany({
        where: { id: regId, paymentStatus: 'DUE' },
        data: { paymentStatus: 'PAID', paymentDeadline: null },
      });
      if (flip.count === 0) return null; // confirmé concurremment
      const receiptNo = await PackageService.nextReceiptNo(tx, reg.event.clubId);
      await tx.payment.create({
        data: {
          clubId: reg.event.clubId, eventRegistrationId: regId,
          amount: new Prisma.Decimal(amountCents).div(100),
          method: 'ONLINE', status: 'CAPTURED', stripePaymentIntentId: opts.stripePaymentIntentId, receiptNo,
        },
      });
      return tx.eventRegistration.findUnique({ where: { id: regId } });
    }, { timeout: 10_000 });

    if (result) await this.safeNotify(() => notify.notifyEventRegistration(regId));
    return result ?? reg;
  }

  /** Exécute un envoi d'email en best-effort : un échec est loggé, jamais propagé. */
  private async safeNotify(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      console.error('[notifications] envoi email échoué (événement) :', err);
    }
  }

  /** Refuse d'activer le paiement en ligne si le club n'a pas Stripe ACTIVE ou si le montant est < 0,50 €. */
  private async assertPrepaymentAllowed(clubId: string, priceCents: number): Promise<void> {
    const club = await prisma.club.findUnique({ where: { id: clubId }, select: { stripeAccountStatus: true } });
    if (club?.stripeAccountStatus !== 'ACTIVE') throw new Error('ONLINE_PAYMENT_NOT_ENABLED');
    if (priceCents < 50) throw new Error('ONLINE_PAYMENT_NOT_ENABLED');
  }

  /** Libère une place dont le paiement initial a expiré (CONFIRMED+DUE échue) et promeut le suivant. */
  async releaseExpiredRegistration(regId: string): Promise<void> {
    const reg = await prisma.eventRegistration.findUnique({
      where: { id: regId },
      select: { id: true, status: true, paymentStatus: true, eventId: true, event: { select: { requirePrepayment: true } } },
    });
    if (!reg || reg.status !== 'CONFIRMED' || reg.paymentStatus !== 'DUE') return;
    const { cancelled, promotedRegistrationId } = await serializableTx(async (tx) => {
      await tx.$queryRaw`SELECT id FROM club_events WHERE id = ${reg.eventId} FOR UPDATE`;
      return this.cancelAndPromoteTx(tx, reg.eventId, regId, true, reg.event.requirePrepayment);
    }, { timeout: 10_000 });
    if (promotedRegistrationId && reg.event.requirePrepayment) {
      // Payant : la notif de promotion part du débit réussi (safeCharge), pas ici, pour ne pas doubler.
      await this.safeNotify(() => notify.notifyEventCancellation(cancelled.id));
      await this.safeCharge(promotedRegistrationId);
    } else {
      await this.notifyCancellation(cancelled.id, promotedRegistrationId);
    }
  }

  /** Le joueur se désinscrit avant la deadline ; promotion auto du 1er en attente. */
  async cancelRegistration(eventId: string, userId: string) {
    const event = await prisma.clubEvent.findUnique({
      where: { id: eventId },
      select: { registrationDeadline: true, clubId: true, requirePrepayment: true },
    });
    if (!event) throw new Error('EVENT_NOT_FOUND');
    if (new Date() >= event.registrationDeadline) throw new Error('REGISTRATION_LOCKED');

    const { cancelled, promotedRegistrationId, refundInfo } = await serializableTx(async (tx) => {
      await tx.$queryRaw`SELECT id FROM club_events WHERE id = ${eventId} FOR UPDATE`;
      const reg = await tx.eventRegistration.findFirst({
        where: { eventId, userId, status: { not: 'CANCELLED' } },
        select: { id: true, status: true, paymentStatus: true },
      });
      if (!reg) throw new Error('REGISTRATION_NOT_FOUND');
      const res = await this.cancelAndPromoteTx(tx, eventId, reg.id, reg.status === 'CONFIRMED', event.requirePrepayment);
      let refundInfo: { paymentId: string; amount: number; regId: string } | null = null;
      if (reg.paymentStatus === 'PAID') {
        const pay = await tx.payment.findFirst({ where: { eventRegistrationId: reg.id, method: 'ONLINE' }, select: { id: true, amount: true } });
        if (pay) refundInfo = { paymentId: pay.id, amount: Number(pay.amount), regId: reg.id };
      }
      return { ...res, refundInfo };
    }, { timeout: 10_000 });

    if (promotedRegistrationId && event.requirePrepayment) {
      // Payant : la notif de promotion part du débit réussi (chargePromotedRegistration), pas ici, pour ne pas doubler.
      await this.safeNotify(() => notify.notifyEventCancellation(cancelled.id));
      await this.safeCharge(promotedRegistrationId);
    } else {
      await this.notifyCancellation(cancelled.id, promotedRegistrationId);
    }
    // Remboursement best-effort post-commit (seulement si paiement ONLINE trouvé).
    if (refundInfo) await this.safeRefund(refundInfo, event.clubId);
    return cancelled;
  }

  /** Notifie désinscription + éventuelle promotion auto. Best-effort, hors transaction. */
  private async notifyCancellation(cancelledRegId: string, promotedRegistrationId: string | null): Promise<void> {
    await this.safeNotify(() => notify.notifyEventCancellation(cancelledRegId));
    if (promotedRegistrationId) await this.safeNotify(() => notify.notifyEventPromotion(promotedRegistrationId));
  }

  /** Débite la place promue en best-effort : un échec post-commit ne doit jamais casser la réponse de désinscription. */
  private async safeCharge(regId: string): Promise<void> {
    try {
      await this.chargePromotedRegistration(regId);
    } catch (err) {
      console.error('[paiement] débit promotion échoué (réconciliation par webhook) :', err);
    }
  }

  /** Remboursement best-effort ; ne fait jamais échouer l'annulation. Motif traçable. */
  private async safeRefund(info: { paymentId: string; amount: number; regId: string }, clubId: string, reason = 'Désinscription avant clôture'): Promise<void> {
    try {
      await new RefundService().refund({ paymentId: info.paymentId, clubId, amount: info.amount, reason });
      await prisma.eventRegistration.update({ where: { id: info.regId }, data: { paymentStatus: 'REFUNDED' } });
    } catch (err) {
      console.error('[refund] remboursement event échoué', err);
    }
  }

  /** Passe une inscription CANCELLED et, si elle était CONFIRMED, promeut le 1er WAITLISTED. Renvoie l'inscription annulée + l'id éventuellement promu. À appeler sous verrou de l'événement. */
  private async cancelAndPromoteTx(tx: Prisma.TransactionClient, eventId: string, regId: string, wasConfirmed: boolean, paid = false) {
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
        await tx.eventRegistration.update({
          where: { id: next.id },
          data: { status: 'CONFIRMED', ...(paid ? { paymentDeadline: holdDeadline(new Date()) } : {}) },
        });
        promotedRegistrationId = next.id;
      }
    }
    return { cancelled, promotedRegistrationId };
  }

  /** Débite off-session une place promue payante (DUE). Échec → libère la place et promeut le suivant. Best-effort, post-commit. */
  async chargePromotedRegistration(regId: string): Promise<void> {
    const reg = await prisma.eventRegistration.findUnique({
      where: { id: regId },
      select: { id: true, status: true, paymentStatus: true, userId: true, eventId: true, event: { select: { clubId: true, price: true } } },
    });
    if (!reg || reg.status !== 'CONFIRMED' || reg.paymentStatus !== 'DUE') return;
    const amountCents = entryFeeCents(reg.event.price);

    let piId: string;
    try {
      piId = await new StripeService().chargeRegistrationOffSession({
        clubId: reg.event.clubId, userId: reg.userId, registrationId: regId, kind: 'event', amountCents,
        idempotencyKey: `reg-charge-${regId}`,
      });
    } catch {
      // Carte refusée / absente → on libère cette place et on promeut le suivant.
      const { cancelled, promotedRegistrationId } = await serializableTx(async (tx) => {
        await tx.$queryRaw`SELECT id FROM club_events WHERE id = ${reg.eventId} FOR UPDATE`;
        return this.cancelAndPromoteTx(tx, reg.eventId, regId, true, true);
      }, { timeout: 10_000 });
      await this.safeNotify(() => notify.notifyEventCancellation(cancelled.id));
      // La récursion notifiera elle-même la promotion du suivant (sur débit réussi) — ne pas pré-notifier ici (doublon).
      if (promotedRegistrationId) await this.chargePromotedRegistration(promotedRegistrationId);
      return;
    }

    await serializableTx(async (tx) => {
      const flip = await tx.eventRegistration.updateMany({ where: { id: regId, paymentStatus: 'DUE' }, data: { paymentStatus: 'PAID', paymentDeadline: null } });
      if (flip.count === 0) return;
      const receiptNo = await PackageService.nextReceiptNo(tx, reg.event.clubId);
      await tx.payment.create({
        data: { clubId: reg.event.clubId, eventRegistrationId: regId, amount: new Prisma.Decimal(amountCents).div(100), method: 'ONLINE', status: 'CAPTURED', stripePaymentIntentId: piId, receiptNo },
      });
    }, { timeout: 10_000 });
    await this.safeNotify(() => notify.notifyEventPromotion(regId));
  }

  // --------------------------------------------------------- Lectures publiques

  /** Animations PUBLISHED d'un club (par slug), triées par date, avec compteurs. */
  async listPublicByClubSlug(slug: string) {
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, status: true } });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    const events = await prisma.clubEvent.findMany({
      where: { clubId: club.id, status: 'PUBLISHED' },
      orderBy: { startTime: 'asc' },
      include: { clubSport: { select: { sport: { select: { key: true, name: true } } } } },
    });
    const withCounts = await this.withCounts(events);
    return withCounts.map(({ clubSport, ...e }) => ({ ...e, sport: clubSport?.sport ?? null }));
  }

  /** Détail public (DRAFT masqué) + compteurs + infos club. */
  async getById(eventId: string) {
    const e = await prisma.clubEvent.findUnique({
      where: { id: eventId },
      include: {
        club: { select: { slug: true, name: true, timezone: true } },
        clubSport: { select: { sport: { select: { key: true, name: true } } } },
      },
    });
    if (!e || e.status === 'DRAFT') throw new Error('EVENT_NOT_FOUND');
    const [withCount] = await this.withCounts([e]);
    const { clubSport, ...rest } = withCount;
    return { ...rest, sport: clubSport?.sport ?? null };
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
    // userId exposé (additif) : entrée « Envoyer un message » côté front — jamais l'e-mail.
    return registrations.map((r) => ({
      ...r,
      level: levels[r.userId] ?? null,
    }));
  }

  /** Inscriptions actives du joueur connecté, tous clubs, avec event + club. */
  async listUserRegistrations(userId: string) {
    const regs = await prisma.eventRegistration.findMany({
      where: { userId, status: { not: 'CANCELLED' } },
      orderBy: { event: { startTime: 'asc' } },
      include: { event: { include: {
        club: { select: { slug: true, name: true, timezone: true } },
        clubSport: { select: { sport: { select: { key: true, name: true } } } },
      } } },
    });
    return regs.map((r) => {
      const { clubSport, ...event } = r.event;
      return { ...r, event: { ...event, sport: clubSport?.sport ?? null } };
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
    if (data.requirePrepayment) {
      await this.assertPrepaymentAllowed(clubId, Math.round(Number((data as any).price ?? 0) * 100));
    }
    return prisma.clubEvent.create({ data: { clubId, ...data } as Prisma.ClubEventUncheckedCreateInput });
  }

  async updateEvent(eventId: string, clubId: string, input: UpdateEventInput) {
    const found = await prisma.clubEvent.findFirst({
      where: { id: eventId, clubId },
      select: { id: true, status: true, price: true, requirePrepayment: true },
    });
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
    // Effective requirePrepayment après cette màj : si on l'active, exiger Stripe ACTIVE + montant valide.
    const willRequire = input.requirePrepayment !== undefined ? Boolean(input.requirePrepayment) : found.requirePrepayment;
    if (willRequire) {
      const price = input.price !== undefined ? Number(input.price) : Number(found.price);
      await this.assertPrepaymentAllowed(clubId, Math.round(price * 100));
    }
    const updated = await prisma.clubEvent.update({ where: { id: eventId }, data });
    if (input.status === 'CANCELLED' && found.status !== 'CANCELLED') {
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
    const e = await prisma.clubEvent.findUnique({ where: { id: eventId }, select: { requirePrepayment: true } });
    if (e?.requirePrepayment) {
      // Verrou + bascule conditionnelle : deux promotions concurrentes de la même place ne posent DUE qu'une fois → un seul débit.
      const promoted = await serializableTx(async (tx) => {
        await tx.$queryRaw`SELECT id FROM club_events WHERE id = ${eventId} FOR UPDATE`;
        return tx.eventRegistration.updateMany({
          where: { id: regId, status: 'WAITLISTED' },
          data: { status: 'CONFIRMED', paymentStatus: 'DUE', paymentDeadline: holdDeadline(new Date()) },
        });
      }, { timeout: 10_000 });
      // Une autre promotion a déjà gagné → ne pas re-débiter.
      if (promoted.count > 0) await this.chargePromotedRegistration(regId);
      return prisma.eventRegistration.findUnique({ where: { id: regId } });
    }
    const promoted = await prisma.eventRegistration.update({ where: { id: regId }, data: { status: 'CONFIRMED' } });
    await this.safeNotify(() => notify.notifyEventPromotion(promoted.id));
    return promoted;
  }

  /** Désinscription manuelle par le club (promeut le 1er en attente si CONFIRMED). */
  async adminRemoveRegistration(eventId: string, regId: string, clubId: string) {
    await this.findClubRegistration(eventId, regId, clubId); // vérifie l'appartenance au club
    const e = await prisma.clubEvent.findUnique({ where: { id: eventId }, select: { requirePrepayment: true } });
    const { cancelled, promotedRegistrationId } = await serializableTx(async (tx) => {
      await tx.$queryRaw`SELECT id FROM club_events WHERE id = ${eventId} FOR UPDATE`;
      const reg = await tx.eventRegistration.findFirst({
        where: { id: regId, status: { not: 'CANCELLED' } },
        select: { id: true, status: true },
      });
      if (!reg) throw new Error('REGISTRATION_NOT_FOUND');
      return this.cancelAndPromoteTx(tx, eventId, regId, reg.status === 'CONFIRMED', e?.requirePrepayment ?? false);
    }, { timeout: 10_000 });

    if (promotedRegistrationId && e?.requirePrepayment) {
      // Payant : la notif de promotion part du débit réussi (chargePromotedRegistration), pas ici, pour ne pas doubler.
      await this.safeNotify(() => notify.notifyEventCancellation(cancelled.id));
      await this.safeCharge(promotedRegistrationId);
    } else {
      await this.notifyCancellation(cancelled.id, promotedRegistrationId);
    }
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
    if (input.requirePrepayment !== undefined) data.requirePrepayment = Boolean(input.requirePrepayment);
    return data;
  }
}
