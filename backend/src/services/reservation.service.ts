import { Prisma, ReservationType } from '@prisma/client';
import { DateTime } from 'luxon';
import { weeklyOccurrences } from './recurrence';
import { prisma } from '../db/prisma';
import { redis } from '../redis/client';
import { stripe } from '../db/stripe';
import { SSEService } from './sse.service';
import { slotPriceCents, classifySlot, OffPeakHours } from './pricing';
import { BookingQuotas, QuotaStatus } from './quotas';
import { PackageService } from './package.service';
import { SubscriptionService } from './subscription.service';
import { maxBookableInstant, BookingReleaseMode } from './booking-window';
import { playerCount } from '../utils/courtType';
import { notifyMatchPartnersInvited, notifyReservationMemberAssigned, notifyReservationRefunded, notifyReservationCancelled, notifyActivityCancelledByClub, notifyOpenMatchProposed } from '../email/notifications';
import { RefundService } from './refund.service';
import { RatingService } from './rating.service';
import { HOLD_TTL_SECONDS } from './holdWindow';
import { sportHasLevels } from './rating/level';
import { effectiveTeams, applyTeams } from './matchTeams';

interface HoldSlotParams {
  resourceId: string;
  userId: string;
  startTime: Date;
  endTime: Date;
  partnerUserIds?: string[];               // partenaires invités (membres du club)
  visibility?: 'PRIVATE' | 'PUBLIC';       // PUBLIC = partie ouverte (rejoignable)
  targetLevelMin?: number | null;          // fourchette de niveau cible (parties ouvertes)
  targetLevelMax?: number | null;
}

const HOLD_EXPIRY_MS = HOLD_TTL_SECONDS * 1000;

export class ReservationService {
  private refundService = new RefundService();
  private ratingService = new RatingService();

  private lockKey(resourceId: string, startTime: Date): string {
    return `lock:resource:${resourceId}:${startTime.toISOString()}`;
  }

  /** Envoi d'email best-effort : un échec est loggé, jamais propagé (ne casse pas l'action). */
  private async safeNotify(fn: () => Promise<void>): Promise<void> {
    try { await fn(); }
    catch (err) { console.error('[reservation] notification échouée', err); }
  }

  /**
   * Lignes participant d'une réservation : l'organisateur (isOrganizer, part = reste
   * au centime) + ses partenaires (part égale). La somme des parts == prix total.
   */
  private splitShares(organizerId: string, partnerIds: string[], priceCents: number) {
    const nb = 1 + partnerIds.length;
    const baseCents = Math.floor(priceCents / nb);
    const organizerCents = priceCents - baseCents * partnerIds.length;
    const dec = (c: number) => new Prisma.Decimal(c).div(100);
    return [
      { userId: organizerId, isOrganizer: true, share: dec(organizerCents) },
      ...partnerIds.map((userId) => ({ userId, isOrganizer: false, share: dec(baseCents) })),
    ];
  }

  private participantRows(reservationId: string, organizerId: string, partnerIds: string[], priceCents: number) {
    return this.splitShares(organizerId, partnerIds, priceCents).map((row) => ({ reservationId, ...row }));
  }

  /**
   * Valide les partenaires invités (membres du club uniquement) : pas de doublon ni
   * l'organisateur lui-même (PARTNER_DUPLICATE), capacité du terrain selon son format
   * (TOO_MANY_PLAYERS), tous membres ACTIVE du club (PARTNER_NOT_MEMBER).
   * Renvoie la liste dédoublonnée des partenaires.
   */
  private async validatePartners(
    organizerId: string, clubId: string, format: string | undefined, partnerUserIds: string[] | undefined,
  ): Promise<string[]> {
    const raw = partnerUserIds ?? [];
    const partners = [...new Set(raw)];
    if (raw.length !== partners.length || partners.includes(organizerId)) {
      throw new Error('PARTNER_DUPLICATE');
    }
    if (1 + partners.length > playerCount(format)) throw new Error('TOO_MANY_PLAYERS');
    if (partners.length > 0) {
      const members = await prisma.clubMembership.findMany({
        where: { clubId, status: 'ACTIVE', userId: { in: partners } },
        select: { userId: true },
      });
      if (members.length !== partners.length) throw new Error('PARTNER_NOT_MEMBER');
    }
    return partners;
  }

  /**
   * Gating « membre = peut réserver » + fenêtre de réservation.
   * - Membership BLOCKED → refus (MEMBERSHIP_BLOCKED).
   * - Fenêtre élargie si le membre est abonné (isSubscriber).
   * - Adhésion automatique (ACTIVE) au 1er accès/réservation si absente.
   */
  private async assertMembershipAndWindow(
    resource: { clubId: string; club: { timezone: string; publicBookingDays: number; memberBookingDays: number; bookingReleaseMode: BookingReleaseMode; publicReleaseHour: number; memberReleaseHour: number } },
    userId: string,
    startTime: Date,
  ): Promise<{ isSubscriber: boolean }> {
    const where = { userId_clubId: { userId, clubId: resource.clubId } };
    const membership = await prisma.clubMembership.findUnique({ where });
    if (membership?.status === 'BLOCKED') throw new Error('MEMBERSHIP_BLOCKED');

    const isSubscriber = membership?.isSubscriber ?? false;
    const windowDays  = isSubscriber ? resource.club.memberBookingDays : resource.club.publicBookingDays;
    const releaseHour = isSubscriber ? resource.club.memberReleaseHour  : resource.club.publicReleaseHour;
    const tz = resource.club.timezone;
    const now = DateTime.now().setZone(tz);
    const maxInstant = maxBookableInstant(now, windowDays, resource.club.bookingReleaseMode, releaseHour);
    const startLocal = DateTime.fromJSDate(startTime).setZone(tz);
    if (startLocal > maxInstant) throw new Error('BOOKING_TOO_FAR');

    if (!membership) {
      await prisma.clubMembership.create({ data: { userId, clubId: resource.clubId } });
    }
    return { isSubscriber };
  }

  /**
   * Quotas de réservations COURT choisis par le club (Club.bookingQuotas).
   * Classe du créneau via classifySlot (creux ssi 100 % des minutes en creuses) ;
   * comptage des résas actives du joueur dans le club (CONFIRMED + PENDING
   * récentes, même filtre que les conflits). UPCOMING = à venir ; WEEKLY =
   * semaine calendaire lun-dim du créneau, fuseau club (résas passées incluses).
   * `excludeReservationId` : la résa déplacée ne compte pas contre elle-même.
   * NB : check hors transaction — deux holds simultanés peuvent dépasser de 1 (accepté).
   */
  private async assertQuota(
    club: { timezone: string; offPeakHours: unknown; bookingQuotas: unknown },
    clubId: string,
    userId: string,
    isSubscriber: boolean,
    startTime: Date,
    endTime: Date,
    excludeReservationId?: string,
  ) {
    const quotas = club.bookingQuotas as BookingQuotas | null;
    if (!quotas) return;

    const off = club.offPeakHours as OffPeakHours | null;
    const tz = club.timezone;
    const cls = classifySlot(off, startTime, endTime, tz);
    const limits = isSubscriber ? quotas.subscriber : quotas.nonSubscriber;
    const limit = cls === 'OFF_PEAK' ? limits?.offPeak : limits?.peak;
    if (limit == null) return;
    const errCode = cls === 'OFF_PEAK' ? 'QUOTA_OFFPEAK_REACHED' : 'QUOTA_PEAK_REACHED';
    if (limit === 0) throw new Error(errCode);

    const window = this.quotaWindow(quotas.model, startTime, tz);
    const counts = await this.countActiveByClass(off, tz, clubId, userId, window, excludeReservationId);
    if (counts[cls] >= limit) throw new Error(errCode);
  }

  /** Fenêtre de comptage d'un quota : semaine calendaire du `ref` (WEEKLY) ou futur (UPCOMING). */
  private quotaWindow(model: 'UPCOMING' | 'WEEKLY', ref: Date, tz: string): Prisma.DateTimeFilter {
    if (model === 'WEEKLY') {
      const weekStart = DateTime.fromJSDate(ref).setZone(tz).startOf('week'); // Luxon : lundi
      return { gte: weekStart.toJSDate(), lt: weekStart.plus({ days: 7 }).toJSDate() };
    }
    return { gt: new Date() };
  }

  /**
   * Compte les résas COURT actives du joueur (CONFIRMED + PENDING < 5 min, même filtre
   * que les conflits) dans une fenêtre, ventilées par classe d'heures. Source unique de
   * vérité partagée par l'enforcement (assertQuota) et l'affichage (getMyQuotaStatus).
   */
  private async countActiveByClass(
    off: OffPeakHours | null,
    tz: string,
    clubId: string,
    userId: string,
    window: Prisma.DateTimeFilter,
    excludeReservationId?: string,
  ): Promise<{ PEAK: number; OFF_PEAK: number }> {
    const holdExpiryCutoff = new Date(Date.now() - HOLD_EXPIRY_MS);
    const existing = await prisma.reservation.findMany({
      where: {
        userId,
        type: 'COURT',
        resource: { clubId },
        ...(excludeReservationId ? { id: { not: excludeReservationId } } : {}),
        OR: [
          { status: 'CONFIRMED' },
          { status: 'PENDING', createdAt: { gt: holdExpiryCutoff } },
        ],
        startTime: window,
      },
      select: { startTime: true, endTime: true },
    });
    const counts = { PEAK: 0, OFF_PEAK: 0 };
    for (const r of existing) counts[classifySlot(off, r.startTime, r.endTime, tz)]++;
    return counts;
  }

  /**
   * État des quotas du joueur sur ce club, pour affichage (« 3/5 cette semaine »).
   * null si le club n'a pas de quotas ou si toutes les limites du joueur sont illimitées.
   * Pas de membership → non-abonné (comme l'enforcement, qui crée le membership à la volée).
   */
  async getMyQuotaStatus(slug: string, userId: string): Promise<QuotaStatus | null> {
    const club = await prisma.club.findUnique({
      where: { slug },
      select: { id: true, status: true, timezone: true, offPeakHours: true, bookingQuotas: true },
    });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');

    const quotas = club.bookingQuotas as BookingQuotas | null;
    if (!quotas) return null;

    const membership = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId, clubId: club.id } },
      select: { isSubscriber: true },
    });
    const limits = membership?.isSubscriber ? quotas.subscriber : quotas.nonSubscriber;
    if (limits.peak == null && limits.offPeak == null) return null;

    const off = club.offPeakHours as OffPeakHours | null;
    const window = this.quotaWindow(quotas.model, new Date(), club.timezone);
    const counts = await this.countActiveByClass(off, club.timezone, club.id, userId, window);

    return {
      model: quotas.model,
      peak: limits.peak == null ? null : { used: counts.PEAK, limit: limits.peak },
      offPeak: limits.offPeak == null ? null : { used: counts.OFF_PEAK, limit: limits.offPeak },
    };
  }

  async holdSlot({ resourceId, userId, startTime, endTime, partnerUserIds, visibility, targetLevelMin, targetLevelMax }: HoldSlotParams) {
    const lockKey = this.lockKey(resourceId, startTime);

    const acquired = await redis.set(lockKey, userId, 'EX', HOLD_TTL_SECONDS, 'NX');
    if (!acquired) throw new Error('SLOT_ALREADY_HELD');

    try {
      const resource = await prisma.resource.findUniqueOrThrow({
        where: { id: resourceId },
        select: {
          price: true,
          offPeakPrice: true,
          clubId: true,
          attributes: true,
          club: { select: { timezone: true, offPeakHours: true, publicBookingDays: true, memberBookingDays: true, bookingQuotas: true, bookingReleaseMode: true, publicReleaseHour: true, memberReleaseHour: true } },
        },
      });

      const { isSubscriber } = await this.assertMembershipAndWindow(resource, userId, startTime);
      await this.assertQuota(resource.club, resource.clubId, userId, isSubscriber, startTime, endTime);

      const holdExpiryCutoff = new Date(Date.now() - HOLD_EXPIRY_MS);

      const conflicts = await prisma.reservation.count({
        where: {
          resourceId,
          OR: [
            { status: 'CONFIRMED' },
            { status: 'PENDING', createdAt: { gt: holdExpiryCutoff } },
          ],
          startTime: { lt: endTime },
          endTime: { gt: startTime },
        },
      });

      if (conflicts > 0) {
        await redis.del(lockKey);
        throw new Error('SLOT_NOT_AVAILABLE');
      }

      // Partenaires (membres du club) : validés avant création, dans le try → lock relâché si erreur.
      const format = (resource.attributes as { format?: string } | null)?.format;
      const partners = await this.validatePartners(userId, resource.clubId, format, partnerUserIds);

      // Prix du créneau (tarif creux ssi entièrement en heures creuses).
      const priceCents = slotPriceCents(
        resource.club.offPeakHours as OffPeakHours | null,
        startTime, endTime, resource.club.timezone,
        Math.round(Number(resource.price) * 100),
        resource.offPeakPrice != null ? Math.round(Number(resource.offPeakPrice) * 100) : null,
      );
      const totalPrice = new Prisma.Decimal(priceCents).div(100);

      // Résa + lignes participant (organisateur + partenaires) dans une transaction.
      const reservation = await prisma.$transaction(async (tx) => {
        const created = await tx.reservation.create({
          data: {
            resourceId, userId, startTime, endTime, status: 'PENDING', totalPrice,
            visibility: visibility === 'PUBLIC' ? 'PUBLIC' : 'PRIVATE',
            targetLevelMin: targetLevelMin ?? null,
            targetLevelMax: targetLevelMax ?? null,
          },
        });
        await tx.reservationParticipant.createMany({
          data: this.participantRows(created.id, userId, partners, priceCents),
        });
        return created;
      });

      SSEService.getInstance().broadcast(resourceId, {
        type: 'slot_held',
        resourceId,
        reservationId: reservation.id,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        expiresAt: new Date(Date.now() + HOLD_EXPIRY_MS).toISOString(),
      });

      return reservation;

    } catch (err) {
      if ((err as Error).message !== 'SLOT_NOT_AVAILABLE') {
        await redis.del(lockKey);
      }
      throw err;
    }
  }

  /**
   * Applique les joueurs/visibilité/niveau choisis APRÈS le blocage (modale page unique)
   * sur une réservation encore PENDING. Appelé avant la confirmation/paiement → les
   * participants sont persistés quel que soit le confirmeur (client OU webhook Stripe),
   * sans re-poser le hold (pas de fenêtre de course). Réutilise validatePartners /
   * participantRows. Aucun paiement n'existe encore sur une PENDING → suppression sûre.
   */
  async applyHoldSetup(
    reservationId: string,
    userId: string,
    setup: {
      partnerUserIds?: string[];
      visibility?: 'PRIVATE' | 'PUBLIC';
      targetLevelMin?: number | null;
      targetLevelMax?: number | null;
      teams?: Record<string, number>;
      slots?: Record<string, number>;
    },
  ) {
    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: {
        resource: {
          select: {
            clubId: true,
            attributes: true,
            clubSport: { select: { sport: { select: { key: true } } } },
          },
        },
      },
    });
    if (!reservation)                     throw new Error('RESERVATION_NOT_FOUND');
    if (reservation.userId !== userId)    throw new Error('UNAUTHORIZED');
    if (reservation.status !== 'PENDING') throw new Error('RESERVATION_NOT_PENDING');

    const age = Date.now() - reservation.createdAt.getTime();
    if (age > HOLD_EXPIRY_MS)             throw new Error('RESERVATION_NOT_PENDING');

    // Parties ouvertes = padel uniquement : pas de visibilité PUBLIC sur un autre sport.
    if (setup.visibility === 'PUBLIC' && reservation.resource.clubSport.sport.key !== 'padel') {
      throw new Error('OPEN_MATCH_PADEL_ONLY');
    }

    const format = (reservation.resource.attributes as { format?: string } | null)?.format;
    const partners = await this.validatePartners(userId, reservation.resource.clubId, format, setup.partnerUserIds);
    const priceCents = Math.round(Number(reservation.totalPrice) * 100);
    // Le système de niveau (grille Padel Magazine) ne vaut que pour le padel :
    // hors padel, on ignore toute fourchette demandée.
    const levelOk = sportHasLevels(reservation.resource.clubSport?.sport?.key);

    return prisma.$transaction(async (tx) => {
      await tx.reservationParticipant.deleteMany({ where: { reservationId } });
      await tx.reservationParticipant.createMany({
        data: this.participantRows(reservationId, userId, partners, priceCents),
      });
      // Répartition d'équipes (+ place G/D) proposée par l'organisateur À LA CRÉATION :
      // indice d'affichage BEST-EFFORT. À la différence d'applyTeams (strict, throw), on
      // n'exige rien : une map incomplète/malformée ne doit JAMAIS faire échouer
      // la confirmation. On ignore les entrées inconnues/hors {1,2} (resp. hors
      // [0, half[) ; à la lecture, effectiveTeams comble les côtés/places non assignés.
      if (setup.teams || setup.slots) {
        const created = await tx.reservationParticipant.findMany({
          where: { reservationId }, select: { id: true, userId: true },
        });
        const half = Math.max(1, Math.floor(playerCount(format) / 2));
        for (const cp of created) {
          const t = setup.teams?.[cp.userId];
          const s = setup.slots?.[cp.userId];
          const data: { team?: number; slot?: number } = {};
          if (t === 1 || t === 2) data.team = t;
          if (typeof s === 'number' && Number.isInteger(s) && s >= 0 && s < half) data.slot = s;
          if (Object.keys(data).length > 0) {
            await tx.reservationParticipant.update({ where: { id: cp.id }, data });
          }
        }
      }
      return tx.reservation.update({
        where: { id: reservationId },
        data: {
          visibility: setup.visibility === 'PUBLIC' ? 'PUBLIC' : 'PRIVATE',
          targetLevelMin: levelOk ? (setup.targetLevelMin ?? null) : null,
          targetLevelMax: levelOk ? (setup.targetLevelMax ?? null) : null,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async confirmReservation(
    reservationId: string,
    userId: string,
    options?: {
      paymentSource?: { packageId: string } | { subscriptionId: string };
      stripePaymentIntentId?: string;
      stripeSetupIntentId?: string;
      cgvAccepted?: boolean;
    },
  ) {
    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: {
        resource: {
          select: {
            clubId: true,
            club: {
              select: {
                requireOnlinePayment: true,
                requireCardFingerprint: true,
                stripeAccountId: true,
                offPeakHours: true,
                timezone: true,
              },
            },
            clubSport: { select: { sport: { select: { key: true } } } },
          },
        },
      },
    });

    if (!reservation)                     throw new Error('RESERVATION_NOT_FOUND');
    if (reservation.userId !== userId)    throw new Error('UNAUTHORIZED');
    if (reservation.status !== 'PENDING') throw new Error('RESERVATION_NOT_PENDING');

    const age = Date.now() - reservation.createdAt.getTime();
    if (age > HOLD_EXPIRY_MS)             throw new Error('RESERVATION_NOT_PENDING');

    const club = (reservation as any).resource?.club as {
      requireOnlinePayment: boolean;
      requireCardFingerprint: boolean;
      stripeAccountId: string | null;
    } | undefined;

    // Vérifications Stripe (hors transaction — appels HTTP interdits dans $transaction)
    if (club?.requireOnlinePayment && !options?.stripePaymentIntentId) {
      throw new Error('ONLINE_PAYMENT_REQUIRED');
    }
    // fingerprint seulement si paiement en ligne non requis (sinon le PI couvre les deux)
    // et hors paiement prépayé : régler d'avance par carnet/porte-monnaie = pas de risque
    // de no-show → l'empreinte n'est pas exigée (un solde insuffisant échouera plus bas).
    if (club?.requireCardFingerprint && !club.requireOnlinePayment && !options?.stripeSetupIntentId && !options?.paymentSource) {
      const hasCardOnFile = !!(await prisma.clubStripeCustomer.findUnique({
        where: { clubId_userId: { clubId: reservation.resource.clubId, userId } },
        select: { defaultPaymentMethodId: true },
      }))?.defaultPaymentMethodId;
      if (!hasCardOnFile) throw new Error('CARD_FINGERPRINT_REQUIRED');
    }
    // CGV obligatoires dès qu'une carte est en jeu (PI = paiement, ou SI = empreinte/enregistrement).
    // Pas d'intent = réglé au club (ou solde/carnet) : aucun contrat Stripe, CGV non requises.
    const hasCardIntent = !!(options?.stripePaymentIntentId || options?.stripeSetupIntentId);
    if (hasCardIntent && !options?.cgvAccepted) {
      throw new Error('CGV_NOT_ACCEPTED');
    }
    const cgvAcceptedAt = (hasCardIntent && options?.cgvAccepted) ? new Date() : undefined;

    let stripePaymentMethodId: string | null = null;
    let chargedCents: number | null = null;

    if (options?.stripePaymentIntentId && club?.stripeAccountId) {
      const pi = await stripe.paymentIntents.retrieve(
        options.stripePaymentIntentId,
        {},
        { stripeAccount: club.stripeAccountId },
      );
      if (pi.status !== 'succeeded') throw new Error('PAYMENT_NOT_SUCCEEDED');
      // Montant réellement encaissé (peut n'être que la part par personne) ; le
      // dû résiduel = totalPrice − Σ paiements capturés est dérivé ailleurs.
      chargedCents = pi.amount_received ?? pi.amount;
      stripePaymentMethodId = typeof pi.payment_method === 'string' ? pi.payment_method : null;
      if (stripePaymentMethodId) {
        await prisma.clubStripeCustomer.updateMany({
          where: { clubId: reservation.resource.clubId, userId },
          data: { defaultPaymentMethodId: stripePaymentMethodId },
        });
      }
    }

    if (options?.stripeSetupIntentId && club?.stripeAccountId) {
      const si = await stripe.setupIntents.retrieve(
        options.stripeSetupIntentId,
        {},
        { stripeAccount: club.stripeAccountId },
      );
      if (si.status !== 'succeeded') throw new Error('SETUP_NOT_SUCCEEDED');
      const pmId = typeof si.payment_method === 'string' ? si.payment_method : null;
      if (pmId) {
        await prisma.clubStripeCustomer.updateMany({
          where: { clubId: reservation.resource.clubId, userId },
          data: { defaultPaymentMethodId: pmId },
        });
      }
    }

    const confirmed = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<any[]>`
        SELECT id, status, resource_id, start_time, end_time
        FROM reservations WHERE id = ${reservationId} FOR UPDATE
      `;

      if (!locked[0] || locked[0].status !== 'PENDING') {
        throw new Error('RESERVATION_NOT_PENDING');
      }

      // Pas de FOR UPDATE ici : illégal sur un agrégat en PostgreSQL, et inutile —
      // l'isolation Serializable protège déjà des conflits fantômes concurrents.
      const conflicts = await tx.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) as count FROM reservations
        WHERE resource_id = ${locked[0].resource_id}
          AND id        != ${reservationId}
          AND status    = 'CONFIRMED'
          AND start_time < ${locked[0].end_time}
          AND end_time   > ${locked[0].start_time}
      `;

      if (Number(conflicts[0].count) > 0) throw new Error('SLOT_NO_LONGER_AVAILABLE');

      // Paiement par carnet / porte-monnaie : consommation dans la MÊME
      // transaction Serializable — solde insuffisant → tout rollback, la
      // résa reste PENDING et payable autrement.
      if (options?.paymentSource && 'packageId' in options.paymentSource) {
        const pkg = await tx.memberPackage.findUnique({ where: { id: options.paymentSource.packageId } });
        if (!pkg || pkg.userId !== userId || pkg.clubId !== reservation.resource.clubId) {
          throw new Error('PACKAGE_NOT_FOUND');
        }
        const amount = new Prisma.Decimal(reservation.totalPrice);
        await PackageService.consume(tx, pkg, amount);
        // Attribue le paiement au participant organisateur (le joueur qui confirme/paie).
        const organizer = await tx.reservationParticipant.findFirst({
          where: { reservationId, isOrganizer: true }, select: { id: true },
        });
        const receiptNo = await PackageService.nextReceiptNo(tx, reservation.resource.clubId);
        await tx.payment.create({
          data: {
            reservationId,
            participantId: organizer?.id ?? null,
            clubId: reservation.resource.clubId,
            amount,
            method: pkg.kind === 'ENTRIES' ? 'PACK_CREDIT' : 'WALLET',
            sourcePackageId: pkg.id,
            receiptNo,
          },
        });
      }

      // Couverture par un abonnement actif : pas de décrément, on enregistre un
      // paiement « sans argent » (method SUBSCRIPTION) qui éteint (INCLUDED) ou
      // réduit (DISCOUNT) le dû. Snapshot lu sur la Subscription (jamais le plan).
      if (options?.paymentSource && 'subscriptionId' in options.paymentSource) {
        const sub = await tx.subscription.findUnique({ where: { id: options.paymentSource.subscriptionId } });
        if (!sub || sub.userId !== userId || sub.clubId !== reservation.resource.clubId
            || sub.status !== 'ACTIVE' || sub.expiresAt <= new Date()) {
          throw new Error('SUBSCRIPTION_NOT_FOUND');
        }
        const off = (reservation as any).resource.club.offPeakHours as OffPeakHours | null;
        const tz  = (reservation as any).resource.club.timezone as string;
        const sportKey = (reservation as any).resource.clubSport?.sport?.key as string | undefined;
        const isOffPeak = classifySlot(off, reservation.startTime, reservation.endTime, tz) === 'OFF_PEAK';
        const dueCents = Math.round(Number(reservation.totalPrice) * 100);

        const { covered, coverCents } = SubscriptionService.coverageFor(
          { sportKeys: sub.sportKeys, offPeakOnly: sub.offPeakOnly, benefit: sub.benefit, discountPercent: sub.discountPercent },
          { sportKey: sportKey ?? '', isOffPeak, dueCents },
        );
        if (!covered) throw new Error('SUBSCRIPTION_NOT_APPLICABLE');

        // Plafond : compte les résas déjà couvertes par cet abo dans le jour / la semaine (fuseau club).
        const day = DateTime.fromJSDate(reservation.startTime, { zone: tz });
        for (const [cap, start, end] of [
          [sub.dailyCap, day.startOf('day'), day.startOf('day').plus({ days: 1 })] as const,
          [sub.weeklyCap, day.startOf('week'), day.startOf('week').plus({ weeks: 1 })] as const,
        ]) {
          if (cap == null) continue;
          const used = await tx.payment.count({
            where: {
              method: 'SUBSCRIPTION', sourceSubscriptionId: sub.id,
              reservation: { id: { not: reservationId }, startTime: { gte: start.toJSDate(), lt: end.toJSDate() } },
            },
          });
          if (used >= cap) throw new Error('SUBSCRIPTION_CAP_REACHED');
        }

        const organizer = await tx.reservationParticipant.findFirst({
          where: { reservationId, isOrganizer: true }, select: { id: true },
        });
        const receiptNo = await PackageService.nextReceiptNo(tx, reservation.resource.clubId);
        await tx.payment.create({
          data: {
            reservationId,
            participantId: organizer?.id ?? null,
            clubId: reservation.resource.clubId,
            amount: new Prisma.Decimal(coverCents / 100),
            method: 'SUBSCRIPTION',
            sourceSubscriptionId: sub.id,
            receiptNo,
          },
        });
      }

      // Paiement Stripe en ligne — le PI a déjà été vérifié hors transaction.
      if (options?.stripePaymentIntentId) {
        const organizer = await tx.reservationParticipant.findFirst({
          where: { reservationId, isOrganizer: true }, select: { id: true },
        });
        const receiptNo = await PackageService.nextReceiptNo(tx, reservation.resource.clubId);
        await tx.payment.create({
          data: {
            reservationId,
            participantId: organizer?.id ?? null,
            clubId: reservation.resource.clubId,
            amount: new Prisma.Decimal(
              chargedCents != null ? chargedCents : Math.round(Number(reservation.totalPrice) * 100),
            ).div(100),
            method: 'ONLINE',
            status: 'CAPTURED',
            stripePaymentIntentId: options.stripePaymentIntentId,
            stripePaymentMethodId: stripePaymentMethodId ?? undefined,
            receiptNo,
          },
        });
      }

      return tx.reservation.update({
        where: { id: reservationId },
        data:  { status: 'CONFIRMED', ...(cgvAcceptedAt ? { cgvAcceptedAt } : {}) },
      });
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 10_000,
    });

    await redis.del(this.lockKey(confirmed.resourceId, confirmed.startTime));

    SSEService.getInstance().broadcast(confirmed.resourceId, {
      type: 'slot_confirmed',
      resourceId:    confirmed.resourceId,
      reservationId: confirmed.id,
      startTime:     confirmed.startTime.toISOString(),
      endTime:       confirmed.endTime.toISOString(),
    });

    // Best-effort : prévenir les partenaires qu'ils ont été ajoutés à la partie.
    await this.safeNotify(() => notifyMatchPartnersInvited(reservationId));

    // Best-effort : à la CONFIRMATION (1er moment où d'autres membres peuvent rejoindre via
    // joinOpenMatch, qui exige status CONFIRMED), proposer la partie ouverte aux membres opt-in
    // « à mon niveau » dont le niveau est dans la fourchette. La fonction s'auto-garde : elle ne
    // fait rien si la résa n'est pas PUBLIC avec fourchette. Jamais d'inscription auto — notif seule.
    await this.safeNotify(() => notifyOpenMatchProposed(reservationId));

    return confirmed;
  }

  /**
   * Effets de bord communs à toute annulation : passage en CANCELLED,
   * suppression du lock Redis, et broadcast SSE slot_released.
   */
  /** Refuse l'action si on est à moins de `cutoffHours` du début (cutoff 0 = autorisé jusqu'au début). */
  private assertWithinCutoff(startTime: Date, cutoffHours: number, errorCode: string): void {
    const deadline = startTime.getTime() - Math.max(0, cutoffHours) * 3_600_000;
    if (Date.now() > deadline) throw new Error(errorCode);
  }

  private async performCancel(reservation: {
    id: string; resourceId: string; startTime: Date; endTime: Date;
  }) {
    const cancelled = await prisma.reservation.update({
      where: { id: reservation.id },
      data:  { status: 'CANCELLED', cancelledAt: new Date() },
    });

    await redis.del(this.lockKey(reservation.resourceId, reservation.startTime));

    SSEService.getInstance().broadcast(reservation.resourceId, {
      type: 'slot_released',
      resourceId:    reservation.resourceId,
      reservationId: cancelled.id,
      startTime:     reservation.startTime.toISOString(),
      endTime:       reservation.endTime.toISOString(),
    });

    return cancelled;
  }

  /**
   * Si le club l'active ET qu'on annule dans la fenêtre d'annulation, rembourse tous les
   * paiements encaissés restants de la résa (recrédit prépayé géré par RefundService).
   * Renvoie le détail des remboursements (vide si politique off / hors fenêtre).
   */
  private async autoRefundOnCancel(
    reservationId: string,
    clubId: string,
    startTime: Date,
    club: { cancellationCutoffHours: number; refundOnCancelWithinCutoff: boolean },
  ): Promise<Array<{ paymentId: string; amount: string; method: string }>> {
    if (!club.refundOnCancelWithinCutoff) return [];
    const deadline = startTime.getTime() - Math.max(0, club.cancellationCutoffHours) * 3_600_000;
    if (Date.now() > deadline) return []; // hors fenêtre (annulation tardive) → pas de remboursement auto

    const cents = (v: unknown) => { const n = Math.round(Number(v) * 100); return Number.isFinite(n) ? n : 0; };
    const payments = await prisma.payment.findMany({
      where: { reservationId, status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED'] }, method: { notIn: ['MEMBER', 'SUBSCRIPTION'] } },
      select: { id: true, amount: true, refundedAmount: true, method: true },
    });
    const refunded: Array<{ paymentId: string; amount: string; method: string }> = [];
    for (const p of payments) {
      const refundableCents = cents(p.amount) - cents(p.refundedAmount);
      if (refundableCents <= 0) continue;
      // Best-effort : l'annulation est DÉJÀ committée. Un remboursement qui échoue
      // (course avec le bouton « Rembourser » manuel, erreur transitoire…) ne doit
      // pas faire échouer l'annulation — le club a le remboursement manuel en repli.
      try {
        await this.refundService.refund({
          paymentId: p.id, clubId, amount: refundableCents / 100,
          reason: 'Annulation de la réservation', method: p.method,
        });
        refunded.push({ paymentId: p.id, amount: (refundableCents / 100).toFixed(2), method: p.method });
      } catch (err) {
        console.error('[reservation] remboursement auto échoué', { paymentId: p.id, err });
      }
    }
    return refunded;
  }

  /**
   * Annule toutes les réservations À VENIR dont l'utilisateur est organisateur
   * (suppression de compte). Bypass volontaire du délai d'annulation. Réutilise
   * `performCancel` (libère le verrou Redis + SSE slot_released). Pas de remboursement
   * auto ici (le club garde le remboursement manuel). Renvoie le nombre annulé.
   */
  async cancelFutureReservationsForUser(userId: string): Promise<number> {
    const future = await prisma.reservation.findMany({
      where: { userId, status: { in: ['CONFIRMED', 'PENDING'] }, startTime: { gt: new Date() } },
      select: { id: true, resourceId: true, startTime: true, endTime: true },
    });
    for (const r of future) {
      await this.performCancel(r);
    }
    return future.length;
  }

  async cancelReservation(reservationId: string, userId: string) {
    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: {
        resource: { select: { clubId: true, club: { select: { cancellationCutoffHours: true, refundOnCancelWithinCutoff: true } } } },
        lesson: { select: { id: true } },
      },
    });

    if (!reservation)                       throw new Error('RESERVATION_NOT_FOUND');
    if (reservation.userId !== userId)      throw new Error('UNAUTHORIZED');
    if (reservation.status === 'CANCELLED') throw new Error('ALREADY_CANCELLED');
    // La fenêtre d'annulation ne concerne QUE les réservations confirmées (interdit d'annuler
    // une vraie résa trop proche du début). Un hold PENDING = blocage transitoire du tunnel de
    // réservation : l'abandonner doit TOUJOURS libérer le créneau, même s'il commence bientôt.
    if (reservation.status === 'CONFIRMED') {
      this.assertWithinCutoff(reservation.startTime, reservation.resource.club.cancellationCutoffHours, 'CANCELLATION_TOO_LATE');
    }

    const cancelled = await this.performCancel(reservation);
    const refunded = await this.autoRefundOnCancel(
      reservationId, reservation.resource.clubId, reservation.startTime, reservation.resource.club,
    );
    if (refunded.length) await this.safeNotify(() => notifyReservationRefunded(reservationId, refunded));
    await this.safeNotify(() => notifyReservationCancelled(reservationId, userId));
    if (reservation.lesson?.id) {
      await this.safeNotify(() => notifyActivityCancelledByClub('lesson', reservation.lesson!.id));
    }
    return { ...cancelled, refunded };
  }

  /** Annulation par un gestionnaire : n'importe quelle résa d'une ressource de SON club. */
  async adminCancelReservation(reservationId: string, adminClubId: string) {
    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: {
        resource: { select: { clubId: true, club: { select: { cancellationCutoffHours: true, refundOnCancelWithinCutoff: true } } } },
        lesson: { select: { id: true } },
      },
    });

    if (!reservation)                                throw new Error('RESERVATION_NOT_FOUND');
    if (reservation.resource.clubId !== adminClubId) throw new Error('CLUB_MISMATCH');
    if (reservation.status === 'CANCELLED')          throw new Error('ALREADY_CANCELLED');

    const cancelled = await this.performCancel(reservation);
    const refunded = await this.autoRefundOnCancel(
      reservationId, reservation.resource.clubId, reservation.startTime, reservation.resource.club,
    );
    if (refunded.length) await this.safeNotify(() => notifyReservationRefunded(reservationId, refunded));
    await this.safeNotify(() => notifyReservationCancelled(reservationId));
    if (reservation.lesson?.id) {
      await this.safeNotify(() => notifyActivityCancelledByClub('lesson', reservation.lesson!.id));
    }
    return { ...cancelled, refunded };
  }

  /**
   * Création par un gestionnaire depuis le planning : réservation CONFIRMED qui bloque
   * le créneau. Type libre (Terrain/Coaching/Tournoi/Événement), membre optionnel
   * (sinon userId = null), intitulé optionnel. Non soumise aux limites joueur.
   * Le membre rattaché n'a pas besoin d'être ACTIVE : l'admin peut réserver pour
   * n'importe quel membre du club (override volontaire, contrairement au flux joueur).
   */
  async adminCreateReservation(params: {
    clubId: string;
    resourceId: string;
    date: string;       // YYYY-MM-DD (heure locale du club)
    startTime: string;  // HH:mm
    endTime: string;    // HH:mm
    type: ReservationType;
    title?: string;
    memberUserId?: string;
    price?: number;
    lessonParams?: {
      coachId: string;
      capacity: number;
      lessonKind: 'INDIVIDUAL' | 'COLLECTIVE';
      allowSelfEnroll: boolean;
    };
  }) {
    const { clubId, resourceId, date, startTime, endTime, type, title, memberUserId, price } = params;

    const resource = await prisma.resource.findUnique({
      where: { id: resourceId },
      select: { clubId: true, club: { select: { timezone: true } } },
    });
    if (!resource)                  throw new Error('RESOURCE_NOT_FOUND');
    if (resource.clubId !== clubId) throw new Error('CLUB_MISMATCH');

    const tz = resource.club.timezone;
    const start = DateTime.fromISO(`${date}T${startTime}`, { zone: tz });
    const end   = DateTime.fromISO(`${date}T${endTime}`, { zone: tz });
    if (!start.isValid || !end.isValid || end <= start) throw new Error('VALIDATION_ERROR');
    if (price !== undefined && (Number.isNaN(price) || price < 0)) throw new Error('VALIDATION_ERROR');
    if (params.lessonParams && type !== 'COACHING') throw new Error('VALIDATION_ERROR');
    if (params.lessonParams && params.lessonParams.capacity < 1) throw new Error('VALIDATION_ERROR');

    const startUtc = start.toUTC().toJSDate();
    const endUtc   = end.toUTC().toJSDate();
    const totalPrice = new Prisma.Decimal(price ?? 0); // négatif déjà rejeté plus haut

    let userId: string | null = null;
    if (memberUserId) {
      const membership = await prisma.clubMembership.findUnique({
        where: { userId_clubId: { userId: memberUserId, clubId } },
      });
      if (!membership) throw new Error('VALIDATION_ERROR');
      userId = memberUserId;
    }

    const holdExpiryCutoff = new Date(Date.now() - HOLD_EXPIRY_MS);
    const created = await prisma.$transaction(async (tx) => {
      const conflicts = await tx.reservation.count({
        where: {
          resourceId,
          OR: [
            { status: 'CONFIRMED' },
            { status: 'PENDING', createdAt: { gt: holdExpiryCutoff } },
          ],
          startTime: { lt: endUtc },
          endTime:   { gt: startUtc },
        },
      });
      if (conflicts > 0) throw new Error('SLOT_NOT_AVAILABLE');

      const reservation = await tx.reservation.create({
        data: {
          resourceId,
          userId,
          startTime: startUtc,
          endTime: endUtc,
          status: 'CONFIRMED',
          type,
          title: title?.trim() || null,
          totalPrice,
        },
      });

      if (params.lessonParams) {
        await tx.lesson.create({ data: {
          reservationId: reservation.id,
          clubId,
          coachId: params.lessonParams.coachId,
          capacity: params.lessonParams.capacity,
          lessonKind: params.lessonParams.lessonKind,
          allowSelfEnroll: params.lessonParams.allowSelfEnroll,
          seriesId: null,
        } });
      }

      return reservation;
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 10_000,
    });

    SSEService.getInstance().broadcast(resourceId, {
      type: 'slot_confirmed',
      resourceId,
      reservationId: created.id,
      startTime: created.startTime.toISOString(),
      endTime: created.endTime.toISOString(),
    });

    return created;
  }

  /**
   * Création d'une SÉRIE récurrente hebdo par un gestionnaire (tous types). Génère une
   * Reservation CONFIRMED par occurrence (totalPrice 0, userId null), liée par seriesId.
   * Les créneaux déjà occupés sont SAUTÉS et remontés dans `skipped` (un conflit isolé
   * ne bloque pas la série). Lot 1 : pas de Lesson ni de params cours (Lot 2).
   */
  async adminCreateSeries(params: {
    clubId: string;
    resourceId: string;
    type: ReservationType;
    title?: string;
    weekday: number;
    startLocal: string;   // "HH:mm"
    durationMin: number;
    startDate: string;    // "YYYY-MM-DD"
    endDate: string;      // "YYYY-MM-DD"
    lessonParams?: {
      coachId: string;
      capacity: number;
      lessonKind: 'INDIVIDUAL' | 'COLLECTIVE';
      allowSelfEnroll: boolean;
      enrollmentMode: 'SERIES' | 'PER_SESSION';
    };
  }): Promise<{ seriesId: string; created: number; skipped: Array<{ start: string; reason: string }> }> {
    const resource = await prisma.resource.findUnique({
      where: { id: params.resourceId },
      select: { clubId: true, club: { select: { timezone: true } } },
    });
    if (!resource)                          throw new Error('RESOURCE_NOT_FOUND');
    if (resource.clubId !== params.clubId)  throw new Error('CLUB_MISMATCH');

    if (params.lessonParams) {
      if (params.type !== 'COACHING') throw new Error('VALIDATION_ERROR');
      if (params.lessonParams.capacity < 1) throw new Error('VALIDATION_ERROR');
    }

    // Calcule les occurrences AVANT toute écriture (lève VALIDATION_ERROR / SERIES_TOO_LONG).
    const occurrences = weeklyOccurrences({
      weekday: params.weekday, startLocal: params.startLocal, durationMin: params.durationMin,
      startDate: params.startDate, endDate: params.endDate, tz: resource.club.timezone,
    });

    const title = params.title?.trim() || null;
    const holdExpiryCutoff = new Date(Date.now() - HOLD_EXPIRY_MS);

    const { seriesId, createdList, skipped } = await prisma.$transaction(async (tx) => {
      const series = await tx.reservationSeries.create({
        data: {
          clubId: params.clubId,
          resourceId: params.resourceId,
          type: params.type,
          title,
          weekday: params.weekday,
          startLocal: params.startLocal,
          durationMin: params.durationMin,
          startDate: new Date(`${params.startDate}T00:00:00.000Z`),
          endDate:   new Date(`${params.endDate}T00:00:00.000Z`),
          ...(params.lessonParams ? {
            coachId: params.lessonParams.coachId,
            capacity: params.lessonParams.capacity,
            lessonKind: params.lessonParams.lessonKind,
            allowSelfEnroll: params.lessonParams.allowSelfEnroll,
            enrollmentMode: params.lessonParams.enrollmentMode,
          } : {}),
        },
      });

      const createdList: Array<{ id: string; startUtc: Date; endUtc: Date }> = [];
      const skipped: Array<{ start: string; reason: string }> = [];

      for (const occ of occurrences) {
        const conflicts = await tx.reservation.count({
          where: {
            resourceId: params.resourceId,
            OR: [
              { status: 'CONFIRMED' },
              { status: 'PENDING', createdAt: { gt: holdExpiryCutoff } },
            ],
            startTime: { lt: occ.endUtc },
            endTime:   { gt: occ.startUtc },
          },
        });
        if (conflicts > 0) {
          skipped.push({ start: occ.startUtc.toISOString(), reason: 'SLOT_NOT_AVAILABLE' });
          continue;
        }
        const created = await tx.reservation.create({
          data: {
            resourceId: params.resourceId,
            userId: null,
            startTime: occ.startUtc,
            endTime: occ.endUtc,
            status: 'CONFIRMED',
            type: params.type,
            title,
            totalPrice: new Prisma.Decimal(0),
            seriesId: series.id,
          },
        });
        createdList.push({ id: created.id, startUtc: occ.startUtc, endUtc: occ.endUtc });
        if (params.lessonParams) {
          await tx.lesson.create({ data: {
            reservationId: created.id,
            clubId: params.clubId,
            coachId: params.lessonParams.coachId,
            capacity: params.lessonParams.capacity,
            lessonKind: params.lessonParams.lessonKind,
            allowSelfEnroll: params.lessonParams.allowSelfEnroll,
            seriesId: series.id,
          } });
        }
      }

      return { seriesId: series.id, createdList, skipped };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 20_000,
    });

    // SSE après commit : les vues live des autres clients se mettent à jour.
    for (const r of createdList) {
      SSEService.getInstance().broadcast(params.resourceId, {
        type: 'slot_confirmed',
        resourceId: params.resourceId,
        reservationId: r.id,
        startTime: r.startUtc.toISOString(),
        endTime: r.endUtc.toISOString(),
      });
    }

    return { seriesId, created: createdList.length, skipped };
  }

  /**
   * Annulation d'une série par un gestionnaire : passe en CANCELLED toutes les occurrences
   * FUTURES (startTime > maintenant) encore actives, conserve le passé, clôt la série
   * (cancelledAt). Libère les locks Redis + SSE slot_released par occurrence. Vérifie le club.
   */
  async adminCancelSeries(seriesId: string, adminClubId: string): Promise<{ cancelled: number }> {
    const series = await prisma.reservationSeries.findUnique({
      where: { id: seriesId },
      select: { id: true, clubId: true },
    });
    if (!series)                          throw new Error('SERIES_NOT_FOUND');
    if (series.clubId !== adminClubId)    throw new Error('CLUB_MISMATCH');

    const now = new Date();
    const future = await prisma.reservation.findMany({
      where: { seriesId, status: { not: 'CANCELLED' }, startTime: { gt: now } },
      select: { id: true, resourceId: true, startTime: true, endTime: true },
    });

    await prisma.$transaction(async (tx) => {
      await tx.reservation.updateMany({
        where: { seriesId, status: { not: 'CANCELLED' }, startTime: { gt: now } },
        data: { status: 'CANCELLED', cancelledAt: now },
      });
      await tx.reservationSeries.update({ where: { id: seriesId }, data: { cancelledAt: now } });
    });

    for (const r of future) {
      await redis.del(this.lockKey(r.resourceId, r.startTime));
      SSEService.getInstance().broadcast(r.resourceId, {
        type: 'slot_released',
        resourceId: r.resourceId,
        reservationId: r.id,
        startTime: r.startTime.toISOString(),
        endTime: r.endTime.toISOString(),
      });
    }

    return { cancelled: future.length };
  }

  /** Change le type d'une réservation (Terrain/Coaching/Tournoi/Événement). Vérifie le club. */
  async setReservationType(reservationId: string, adminClubId: string, type: ReservationType) {
    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { resource: { select: { clubId: true } } },
    });
    if (!reservation)                                throw new Error('RESERVATION_NOT_FOUND');
    if (reservation.resource.clubId !== adminClubId) throw new Error('CLUB_MISMATCH');
    return prisma.reservation.update({ where: { id: reservationId }, data: { type } });
  }

  /** Dû d'une résa en centimes : prix, sinon tarif du terrain (COURT, creux ssi
   * entièrement en heures creuses), sinon 0. Source unique du « montant à régler ». */
  private effectiveDueCents(
    r: { totalPrice: Prisma.Decimal | null; type: ReservationType; startTime: Date; endTime: Date; resource: { price: Prisma.Decimal; offPeakPrice: Prisma.Decimal | null } },
    club: { offPeakHours: Prisma.JsonValue | null; timezone: string },
  ): number {
    const cents = (v: unknown) => { const n = Math.round(Number(v) * 100); return Number.isFinite(n) ? n : 0; };
    let dueC = cents(r.totalPrice);
    if (dueC <= 0) {
      dueC = r.type === 'COURT'
        ? slotPriceCents(
            club.offPeakHours as OffPeakHours | null,
            r.startTime, r.endTime, club.timezone,
            cents(r.resource.price),
            r.resource.offPeakPrice != null ? cents(r.resource.offPeakPrice) : null,
          )
        : 0;
    }
    return dueC;
  }

  /** Sérialise une réservation au format planning/caisse : dueAmount, paidAmount,
   * et le détail par joueur (part / payé / reste). Utilisé par listClubReservations
   * et loadClubReservation pour une forme de sortie identique. */
  private mapReservation<
    R extends {
      totalPrice: Prisma.Decimal | null; type: ReservationType; startTime: Date; endTime: Date;
      resource: { price: Prisma.Decimal; offPeakPrice: Prisma.Decimal | null };
      payments?: Array<{ amount: Prisma.Decimal; refundedAmount?: Prisma.Decimal; participantId: string | null }>;
      participants?: Array<{ id: string; userId: string; share: Prisma.Decimal; isOrganizer: boolean; user: { firstName: string; lastName: string } }>;
    }
  >(r: R, club: { offPeakHours: Prisma.JsonValue | null; timezone: string }) {
    const cents = (v: unknown) => { const n = Math.round(Number(v) * 100); return Number.isFinite(n) ? n : 0; };
    const p = (r.payments ?? []).reduce(
      (s, x) => s.plus(x.amount).minus(new Prisma.Decimal((x as any).refundedAmount ?? 0)),
      new Prisma.Decimal(0),
    );
    const dueC = this.effectiveDueCents(r, club);
    const participants = (r.participants ?? []).map((pp) => {
      const ppPaid = (r.payments ?? [])
        .filter((x) => x.participantId === pp.id)
        .reduce(
          (s, x) => s.plus(x.amount).minus(new Prisma.Decimal((x as any).refundedAmount ?? 0)),
          new Prisma.Decimal(0),
        );
      const shareC = cents(pp.share);
      return {
        id: pp.id, userId: pp.userId, isOrganizer: pp.isOrganizer,
        firstName: pp.user.firstName, lastName: pp.user.lastName,
        share: (shareC / 100).toFixed(2),
        paid: cents(ppPaid) === 0 ? '0.00' : ppPaid.toFixed(2),
        outstanding: (Math.max(0, shareC - cents(ppPaid)) / 100).toFixed(2),
      };
    });
    return { ...r, paidAmount: p.toFixed(2), dueAmount: (dueC / 100).toFixed(2), participants };
  }

  /** Recharge une réservation seule au format planning/caisse (gardes club/existence).
   * Renvoyé par les endpoints d'encaissement pour que le front fasse setSelected sans recharger. */
  private async loadClubReservation(reservationId: string, clubId: string) {
    const r = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: {
        resource: { select: { id: true, name: true, price: true, offPeakPrice: true, clubId: true } },
        user:     { select: { id: true, firstName: true, lastName: true, email: true } },
        payments: {
          select: { id: true, amount: true, refundedAmount: true, method: true, payerName: true, note: true, createdAt: true, participantId: true, receiptNo: true },
          orderBy: { createdAt: 'asc' },
        },
        participants: {
          orderBy: { joinedAt: 'asc' },
          select: { id: true, userId: true, share: true, isOrganizer: true, user: { select: { firstName: true, lastName: true } } },
        },
      },
    });
    if (!r)                           throw new Error('RESERVATION_NOT_FOUND');
    if (r.resource.clubId !== clubId) throw new Error('CLUB_MISMATCH');
    const club = await prisma.club.findUniqueOrThrow({ where: { id: clubId }, select: { timezone: true, offPeakHours: true } });
    return this.mapReservation(r, club);
  }

  /**
   * (Ré)affecte le joueur principal d'une réservation — action admin au comptoir,
   * pour associer un joueur à l'encaissement. Le joueur doit être membre ACTIF du
   * club. La répartition par joueur se gère via add/removeReservationParticipant.
   * Pas de re-check quota (cohérent avec le bypass admin de adminCreateReservation).
   */
  async assignReservationMember(reservationId: string, clubId: string, memberUserId: string) {
    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { resource: { select: { clubId: true } } },
    });
    if (!reservation)                           throw new Error('RESERVATION_NOT_FOUND');
    if (reservation.resource.clubId !== clubId) throw new Error('CLUB_MISMATCH');

    const membership = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId: memberUserId, clubId } },
    });
    if (!membership || membership.status === 'BLOCKED') throw new Error('MEMBER_NOT_FOUND');

    await prisma.reservation.update({ where: { id: reservationId }, data: { userId: memberUserId } });
    // Best-effort : prévenir le membre qu'il a été rattaché à la réservation.
    await this.safeNotify(() => notifyReservationMemberAssigned(reservationId, memberUserId));
    // Forme enrichie (resource/user/participants/dueAmount) comme les 3 méthodes sœurs : le front
    // patche l'objet renvoyé tel quel dans la caisse/planning — la ligne brute cassait le rendu
    // (reservation.resource.name sur un objet sans `resource`).
    return this.loadClubReservation(reservationId, clubId);
  }

  /**
   * Cœur partagé d'ajout d'un participant : valide le membre + la capacité et
   * (re)répartit les parts (transaction Serializable). Suppose `reservation` chargée
   * avec resource.{clubId,attributes,price,offPeakPrice,club.{offPeakHours,timezone}}.
   */
  private async applyAddParticipant(
    reservation: {
      id: string; userId: string | null; type: ReservationType;
      totalPrice: Prisma.Decimal | null; startTime: Date; endTime: Date;
      resource: {
        clubId: string; attributes: Prisma.JsonValue; price: Prisma.Decimal; offPeakPrice: Prisma.Decimal | null;
        club: { offPeakHours: Prisma.JsonValue | null; timezone: string };
      };
    },
    memberUserId: string,
  ): Promise<void> {
    const membership = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId: memberUserId, clubId: reservation.resource.clubId } },
    });
    if (!membership || membership.status === 'BLOCKED') throw new Error('MEMBER_NOT_FOUND');

    const format   = (reservation.resource.attributes as { format?: string } | null)?.format;
    const max      = playerCount(format);
    const dueCents = this.effectiveDueCents(reservation, reservation.resource.club);

    await prisma.$transaction(async (tx) => {
      const existing = await tx.reservationParticipant.findMany({
        where: { reservationId: reservation.id }, orderBy: { joinedAt: 'asc' },
        select: { id: true, userId: true, isOrganizer: true },
      });
      if (existing.some((p) => p.userId === memberUserId)) return; // déjà participant → no-op

      if (existing.length === 0) {
        if (!reservation.userId)                 throw new Error('RESERVATION_HAS_NO_MEMBER');
        if (reservation.userId === memberUserId) throw new Error('PARTNER_DUPLICATE');
        if (2 > max)                             throw new Error('TOO_MANY_PLAYERS');
        await tx.reservationParticipant.createMany({
          data: this.participantRows(reservation.id, reservation.userId, [memberUserId], dueCents),
        });
        return;
      }

      if (existing.length + 1 > max) throw new Error('TOO_MANY_PLAYERS');
      const organizer  = existing.find((p) => p.isOrganizer) ?? existing[0];
      const partnerIds = [...existing.filter((p) => p.id !== organizer.id).map((p) => p.userId), memberUserId];
      const shares     = this.splitShares(organizer.userId, partnerIds, dueCents);
      const byUser     = new Map(shares.map((s) => [s.userId, s]));
      for (const p of existing) {
        const s = byUser.get(p.userId)!;
        await tx.reservationParticipant.update({ where: { id: p.id }, data: { share: s.share, isOrganizer: s.isOrganizer } });
      }
      const ns = byUser.get(memberUserId)!;
      await tx.reservationParticipant.create({ data: { reservationId: reservation.id, userId: memberUserId, isOrganizer: ns.isOrganizer, share: ns.share } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  /**
   * Cœur partagé de retrait d'un participant : recalcule les parts des survivants.
   * Suppose `reservation` chargée avec resource.{price,offPeakPrice,club.{offPeakHours,timezone}}.
   */
  private async applyRemoveParticipant(
    reservation: {
      id: string; type: ReservationType; totalPrice: Prisma.Decimal | null; startTime: Date; endTime: Date;
      resource: { price: Prisma.Decimal; offPeakPrice: Prisma.Decimal | null; club: { offPeakHours: Prisma.JsonValue | null; timezone: string } };
    },
    participantId: string,
  ): Promise<void> {
    const dueCents = this.effectiveDueCents(reservation, reservation.resource.club);
    await prisma.$transaction(async (tx) => {
      const existing = await tx.reservationParticipant.findMany({
        where: { reservationId: reservation.id }, orderBy: { joinedAt: 'asc' },
        select: { id: true, userId: true, isOrganizer: true },
      });
      const target = existing.find((p) => p.id === participantId);
      if (!target)                                   throw new Error('PARTICIPANT_NOT_FOUND');
      if (target.isOrganizer && existing.length > 1) throw new Error('CANNOT_REMOVE_ORGANIZER');

      await tx.reservationParticipant.delete({ where: { id: participantId } });
      const remaining = existing.filter((p) => p.id !== participantId);
      if (remaining.length === 0) return;
      const organizer  = remaining.find((p) => p.isOrganizer) ?? remaining[0];
      const partnerIds = remaining.filter((p) => p.id !== organizer.id).map((p) => p.userId);
      const shares     = this.splitShares(organizer.userId, partnerIds, dueCents);
      const byUser     = new Map(shares.map((s) => [s.userId, s]));
      for (const p of remaining) {
        const s = byUser.get(p.userId)!;
        await tx.reservationParticipant.update({ where: { id: p.id }, data: { share: s.share, isOrganizer: s.isOrganizer } });
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  /**
   * Ajoute un membre comme participant d'une réservation (répartition du paiement
   * par joueur, au comptoir). Membre ACTIF requis. Part recalculée (égale,
   * l'organisateur garde le reste). Si la résa n'a aucune ligne participant, la
   * première matérialise l'organisateur (membre principal) puis ajoute le membre.
   */
  async addReservationParticipant(reservationId: string, clubId: string, memberUserId: string) {
    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: {
        resource: {
          select: { clubId: true, attributes: true, price: true, offPeakPrice: true, club: { select: { offPeakHours: true, timezone: true } } },
        },
      },
    });
    if (!reservation)                           throw new Error('RESERVATION_NOT_FOUND');
    if (reservation.resource.clubId !== clubId) throw new Error('CLUB_MISMATCH');

    await this.applyAddParticipant(reservation, memberUserId);

    // Best-effort : prévenir le membre qu'il a été ajouté à la partie.
    await this.safeNotify(() => notifyReservationMemberAssigned(reservationId, memberUserId));
    return this.loadClubReservation(reservationId, clubId);
  }

  /**
   * Retire un participant d'une réservation et recalcule les parts des survivants.
   * On ne peut pas retirer l'organisateur tant qu'il reste d'autres joueurs
   * (CANNOT_REMOVE_ORGANIZER). Les paiements déjà attribués au joueur retiré sont
   * conservés (participantId → null via onDelete: SetNull) : l'argent reste compté.
   */
  async removeReservationParticipant(reservationId: string, clubId: string, participantId: string) {
    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: {
        resource: {
          select: { clubId: true, price: true, offPeakPrice: true, club: { select: { offPeakHours: true, timezone: true } } },
        },
      },
    });
    if (!reservation)                           throw new Error('RESERVATION_NOT_FOUND');
    if (reservation.resource.clubId !== clubId) throw new Error('CLUB_MISMATCH');

    await this.applyRemoveParticipant(reservation, participantId);
    return this.loadClubReservation(reservationId, clubId);
  }

  /**
   * Remplace un participant (non-organisateur) par un autre membre, en UNE seule
   * transaction Serializable : supprime l'ancienne ligne (ses paiements deviennent
   * anonymes via onDelete: SetNull — l'argent reste compté sur la résa), crée le
   * nouveau joueur et recalcule les parts. Membre ACTIF requis. On ne change pas
   * l'organisateur par cette voie (réassigner le titulaire via `assignReservationMember`).
   */
  async changeReservationParticipant(reservationId: string, clubId: string, participantId: string, newMemberUserId: string) {
    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: {
        resource: {
          select: { clubId: true, attributes: true, price: true, offPeakPrice: true, club: { select: { offPeakHours: true, timezone: true } } },
        },
      },
    });
    if (!reservation)                           throw new Error('RESERVATION_NOT_FOUND');
    if (reservation.resource.clubId !== clubId) throw new Error('CLUB_MISMATCH');

    const membership = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId: newMemberUserId, clubId } },
    });
    if (!membership || membership.status === 'BLOCKED') throw new Error('MEMBER_NOT_FOUND');

    const dueCents = this.effectiveDueCents(reservation, reservation.resource.club);
    await prisma.$transaction(async (tx) => {
      const existing = await tx.reservationParticipant.findMany({
        where: { reservationId }, orderBy: { joinedAt: 'asc' },
        select: { id: true, userId: true, isOrganizer: true },
      });
      const target = existing.find((p) => p.id === participantId);
      if (!target)                                  throw new Error('PARTICIPANT_NOT_FOUND');
      if (target.isOrganizer)                       throw new Error('CANNOT_REMOVE_ORGANIZER');
      if (target.userId === newMemberUserId)        return;                       // déjà ce joueur → no-op
      if (existing.some((p) => p.userId === newMemberUserId)) throw new Error('PARTNER_DUPLICATE');

      await tx.reservationParticipant.delete({ where: { id: participantId } });
      const survivors  = existing.filter((p) => p.id !== participantId);
      const organizer  = survivors.find((p) => p.isOrganizer) ?? survivors[0];
      const partnerIds = [...survivors.filter((p) => p.id !== organizer.id).map((p) => p.userId), newMemberUserId];
      const shares     = this.splitShares(organizer.userId, partnerIds, dueCents);
      const byUser     = new Map(shares.map((s) => [s.userId, s]));
      for (const p of survivors) {
        const s = byUser.get(p.userId)!;
        await tx.reservationParticipant.update({ where: { id: p.id }, data: { share: s.share, isOrganizer: s.isOrganizer } });
      }
      const ns = byUser.get(newMemberUserId)!;
      await tx.reservationParticipant.create({ data: { reservationId, userId: newMemberUserId, isOrganizer: ns.isOrganizer, share: ns.share } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    await this.safeNotify(() => notifyReservationMemberAssigned(reservationId, newMemberUserId));
    return this.loadClubReservation(reservationId, clubId);
  }

  /** Forme JSON du modal « Gérer les joueurs » : capacité + joueurs (id/nom/part/organisateur). */
  private mapOwnPlayers(r: {
    id: string;
    resource: { attributes: Prisma.JsonValue; clubSport: { sport: { key: string } } };
    participants: Array<{ id: string; userId: string; isOrganizer: boolean; share: Prisma.Decimal; team: number | null; slot: number | null; user: { firstName: string; lastName: string; avatarUrl: string | null } }>;
  }) {
    const format = (r.resource.attributes as { format?: string } | null)?.format;
    const capacity = playerCount(format);
    const sportKey = r.resource.clubSport.sport.key;
    const teamed = sportKey === 'padel'
      ? effectiveTeams(r.participants, capacity)
      : r.participants.map((p) => ({ ...p, team: null as 1 | 2 | null, slot: null as number | null }));
    return {
      id: r.id,
      sportKey,
      capacity,
      participants: teamed.map((p) => ({
        id: p.id, userId: p.userId, isOrganizer: p.isOrganizer,
        firstName: p.user.firstName, lastName: p.user.lastName, avatarUrl: p.user.avatarUrl,
        share: Number(p.share).toFixed(2),
        team: p.team,
        slot: p.slot,
      })),
    };
  }

  /** Lecture des joueurs d'une résa, réservée à son organisateur (modal « Gérer les joueurs »). */
  async getOwnReservationPlayers(reservationId: string, userId: string) {
    const r = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: {
        resource: { select: { attributes: true, clubSport: { select: { sport: { select: { key: true } } } } } },
        participants: {
          orderBy: { joinedAt: 'asc' },
          select: { id: true, userId: true, isOrganizer: true, share: true, team: true, slot: true, user: { select: { firstName: true, lastName: true, avatarUrl: true } } },
        },
      },
    });
    if (!r)                  throw new Error('RESERVATION_NOT_FOUND');
    if (r.userId !== userId) throw new Error('UNAUTHORIZED');
    return this.mapOwnPlayers(r);
  }

  /** Ajout d'un joueur par l'organisateur depuis « Mes réservations » (membre du club, délai respecté). */
  async addOwnReservationParticipant(reservationId: string, userId: string, memberUserId: string) {
    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: {
        resource: {
          select: { clubId: true, attributes: true, price: true, offPeakPrice: true, club: { select: { offPeakHours: true, timezone: true, playerChangeCutoffHours: true } } },
        },
      },
    });
    if (!reservation)                       throw new Error('RESERVATION_NOT_FOUND');
    if (reservation.userId !== userId)      throw new Error('UNAUTHORIZED');
    if (reservation.status !== 'CONFIRMED') throw new Error('RESERVATION_NOT_ACTIVE');
    this.assertWithinCutoff(reservation.startTime, reservation.resource.club.playerChangeCutoffHours, 'PLAYER_CHANGE_TOO_LATE');

    await this.applyAddParticipant(reservation, memberUserId);
    await this.safeNotify(() => notifyReservationMemberAssigned(reservationId, memberUserId));
    return this.getOwnReservationPlayers(reservationId, userId);
  }

  /** Retrait d'un joueur par l'organisateur depuis « Mes réservations » (délai respecté). */
  async removeOwnReservationParticipant(reservationId: string, userId: string, participantId: string) {
    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: {
        resource: {
          select: { clubId: true, price: true, offPeakPrice: true, club: { select: { offPeakHours: true, timezone: true, playerChangeCutoffHours: true } } },
        },
      },
    });
    if (!reservation)                       throw new Error('RESERVATION_NOT_FOUND');
    if (reservation.userId !== userId)      throw new Error('UNAUTHORIZED');
    if (reservation.status !== 'CONFIRMED') throw new Error('RESERVATION_NOT_ACTIVE');
    this.assertWithinCutoff(reservation.startTime, reservation.resource.club.playerChangeCutoffHours, 'PLAYER_CHANGE_TOO_LATE');

    await this.applyRemoveParticipant(reservation, participantId);
    return this.getOwnReservationPlayers(reservationId, userId);
  }

  /** Réorganise les équipes (+ places G/D) d'une réservation (propriétaire seul). */
  async setReservationTeams(
    reservationId: string,
    userId: string,
    teams: Record<string, number>,
    slots?: Record<string, number>,
  ) {
    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { resource: { select: { attributes: true } } },
    });
    if (!reservation)                  throw new Error('RESERVATION_NOT_FOUND');
    if (reservation.userId !== userId) throw new Error('UNAUTHORIZED');
    const maxPlayers = playerCount((reservation.resource.attributes as { format?: string } | null)?.format);
    await prisma.$transaction(async (tx) => {
      await applyTeams(tx, reservationId, teams, maxPlayers, slots);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return this.getOwnReservationPlayers(reservationId, userId);
  }

  /**
   * Ouvre/ferme une réservation confirmée en « partie ouverte » (bascule de visibilité,
   * après coup — la contrepartie post-confirmation d'applyHoldSetup). Owner-only. La place
   * étant déjà tenue par une résa CONFIRMED, on ne pose aucun verrou Redis et on ne touche
   * pas aux participants : simple update. PUBLIC réservé au padel ; la fourchette de niveau
   * (grille Padel Magazine) ne vaut qu'en padel et est effacée en repassant PRIVATE.
   */
  async setReservationVisibility(
    reservationId: string,
    userId: string,
    input: { visibility: 'PRIVATE' | 'PUBLIC'; targetLevelMin?: number | null; targetLevelMax?: number | null },
  ) {
    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { resource: { select: { clubSport: { select: { sport: { select: { key: true } } } } } } },
    });
    if (!reservation)                       throw new Error('RESERVATION_NOT_FOUND');
    if (reservation.userId !== userId)      throw new Error('UNAUTHORIZED');
    if (reservation.status !== 'CONFIRMED') throw new Error('RESERVATION_NOT_ACTIVE');
    if (reservation.startTime.getTime() <= Date.now()) throw new Error('RESERVATION_IN_PAST');

    const sportKey = reservation.resource.clubSport.sport.key;
    if (input.visibility === 'PUBLIC' && !sportHasLevels(sportKey)) throw new Error('OPEN_MATCH_PADEL_ONLY');

    // Fourchette de niveau conservée uniquement en PUBLIC + padel ; sinon effacée.
    const keepLevel = input.visibility === 'PUBLIC' && sportHasLevels(sportKey);

    return prisma.reservation.update({
      where: { id: reservationId },
      data: {
        visibility: input.visibility === 'PUBLIC' ? 'PUBLIC' : 'PRIVATE',
        targetLevelMin: keepLevel ? (input.targetLevelMin ?? null) : null,
        targetLevelMax: keepLevel ? (input.targetLevelMax ?? null) : null,
      },
      select: { id: true, visibility: true, targetLevelMin: true, targetLevelMax: true },
    });
  }

  /** Réservations d'un joueur (les siennes), pour l'espace « Mes réservations ». */
  async listUserReservations(userId: string) {
    const rows = await prisma.reservation.findMany({
      where: { userId },
      orderBy: { startTime: 'desc' },
      include: {
        resource: {
          select: {
            id: true, name: true, attributes: true,
            clubSport: { select: { sport: { select: { key: true, name: true } } } },
            club: { select: { name: true, slug: true, timezone: true, playerChangeCutoffHours: true, cancellationCutoffHours: true } },
          },
        },
        participants: {
          orderBy: { joinedAt: 'asc' },
          select: { id: true, userId: true, isOrganizer: true, team: true, slot: true, user: { select: { firstName: true, lastName: true, avatarUrl: true } } },
        },
      },
    });

    // Collecte les paires (participant, sport du terrain) pour un seul appel multi-sport.
    const pairs = rows.flatMap((r) => r.participants.map((p) => ({ userId: p.userId, sportKey: r.resource.clubSport.sport.key })));
    const levels = await this.ratingService.getLevelsBySport(pairs);

    return rows.map(({ participants, resource, ...rest }) => {
      const { attributes, clubSport, ...resourcePublic } = resource;
      const sportKey = clubSport.sport.key;
      const capacity = playerCount((attributes as { format?: string } | null)?.format);
      const teamed = sportKey === 'padel'
        ? effectiveTeams(participants, capacity)
        : participants.map((p) => ({ ...p, team: null as 1 | 2 | null, slot: null as number | null }));
      return {
        ...rest,
        resource: { ...resourcePublic, sport: { key: clubSport.sport.key, name: clubSport.sport.name } },
        capacity,
        participants: teamed.map((p) => ({
          id: p.id, userId: p.userId, isOrganizer: p.isOrganizer,
          firstName: p.user.firstName, lastName: p.user.lastName, avatarUrl: p.user.avatarUrl,
          level: levels[`${p.userId}:${sportKey}`] ?? null,
          team: p.team,
          slot: p.slot,
        })),
      };
    });
  }

  /** Planning club : toutes les réservations d'un club, filtrables. */
  async listClubReservations(params: {
    clubId: string;
    date?: string;
    resourceId?: string;
    status?: 'PENDING' | 'CONFIRMED' | 'CANCELLED';
  }) {
    const where: Prisma.ReservationWhereInput = {
      resource: { clubId: params.clubId },
    };
    if (params.resourceId) where.resourceId = params.resourceId;
    if (params.status)     where.status = params.status;
    if (params.date) {
      const dayStart = new Date(`${params.date}T00:00:00.000Z`);
      const dayEnd   = new Date(`${params.date}T23:59:59.999Z`);
      where.startTime = { lt: dayEnd };
      where.endTime   = { gt: dayStart };
    }

    const club = await prisma.club.findUniqueOrThrow({
      where: { id: params.clubId },
      select: { timezone: true, offPeakHours: true },
    });

    const reservations = await prisma.reservation.findMany({
      where,
      orderBy: { startTime: 'asc' },
      include: {
        resource: { select: { id: true, name: true, price: true, offPeakPrice: true } },
        user:     { select: { id: true, firstName: true, lastName: true, email: true } },
        payments: {
          select: { id: true, amount: true, refundedAmount: true, method: true, payerName: true, note: true, createdAt: true, participantId: true, receiptNo: true },
          orderBy: { createdAt: 'asc' },
        },
        participants: {
          orderBy: { joinedAt: 'asc' },
          select: { id: true, userId: true, share: true, isOrganizer: true, user: { select: { firstName: true, lastName: true } } },
        },
        lesson: { select: { id: true, capacity: true, lessonKind: true } },
      },
    });

    // Empreintes Stripe : quels organisateurs ont une carte enregistrée ?
    const organizerUserIds = reservations
      .flatMap((r) => (r.participants ?? []).filter((p) => p.isOrganizer).map((p) => p.userId))
      .filter((id): id is string => id != null);

    const withFingerprint = organizerUserIds.length > 0
      ? await prisma.clubStripeCustomer.findMany({
          where: {
            clubId: params.clubId,
            userId: { in: organizerUserIds },
            defaultPaymentMethodId: { not: null },
          },
          select: { userId: true },
        })
      : [];

    const fingerprintSet = new Set(withFingerprint.map((f) => f.userId));

    // Dû par résa = prix, sinon prix du créneau au tarif du terrain (COURT), sinon 0 —
    // exposé en `dueAmount` (cf. mapReservation) : le frontend ne recalcule plus.
    let totalC = 0, paidC = 0, outstandingC = 0;
    const withPaid = reservations.map((r) => {
      const enriched = this.mapReservation(r, club);
      const organizerUserId = (r.participants ?? []).find((p) => p.isOrganizer)?.userId ?? null;
      (enriched as any).hasCardFingerprint = organizerUserId != null && fingerprintSet.has(organizerUserId);
      if (r.status !== 'CANCELLED') {
        const dueC = Math.round(Number(enriched.dueAmount) * 100);
        const pC   = Math.round(Number(enriched.paidAmount) * 100);
        totalC += dueC;
        paidC  += pC;
        outstandingC += Math.max(0, dueC - pC); // clamp PAR résa : une surpayée ne masque pas le dû d'une autre
      }
      return enriched;
    });

    const euros = (c: number) => (c / 100).toFixed(2);
    return {
      reservations: withPaid,
      summary: {
        total:       euros(totalC),
        paid:        euros(paidC),
        paidTotal:   euros(paidC), // compat ascendante
        outstanding: euros(outstandingC),
      },
    };
  }

  /**
   * Encaissement manuel sur une réservation (vérifie le club).
   * Plafond : le total encaissé ne peut pas dépasser le prix de la résa —
   * ou, pour une résa COURT sans prix, le tarif du terrain (heures pleines/creuses).
   * VOUCHER : référence optionnelle, statut « à rembourser ».
   * PACK_CREDIT / WALLET : consomme le package du joueur (décrément conditionnel)
   * et crée le paiement dans la même transaction.
   */
  async addPayment(params: {
    reservationId: string;
    clubId: string;
    amount: number;
    method?: string;
    payerName?: string;
    note?: string;
    sourcePackageId?: string;
    voucherRef?: string;
    voucherIssuer?: string;
    participantId?: string;
    createdByUserId?: string;
  }) {
    if (!(typeof params.amount === 'number') || isNaN(params.amount) || params.amount <= 0) {
      throw new Error('VALIDATION_ERROR');
    }
    const reservation = await prisma.reservation.findUnique({
      where: { id: params.reservationId },
      include: {
        resource: {
          select: {
            clubId: true, price: true, offPeakPrice: true,
            club: { select: { offPeakHours: true, timezone: true } },
          },
        },
      },
    });
    if (!reservation)                                  throw new Error('RESERVATION_NOT_FOUND');
    if (reservation.resource.clubId !== params.clubId) throw new Error('CLUB_MISMATCH');

    const methods = ['CASH', 'CARD', 'TRANSFER', 'ONLINE', 'OTHER', 'VOUCHER', 'CHEQUE', 'CLUB', 'PACK_CREDIT', 'WALLET', 'MEMBER'];
    const method = (methods.includes(params.method ?? '') ? params.method : 'CASH') as
      'CASH' | 'CARD' | 'TRANSFER' | 'ONLINE' | 'OTHER' | 'VOUCHER' | 'CHEQUE' | 'CLUB' | 'PACK_CREDIT' | 'WALLET' | 'MEMBER';

    const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

    // Paiement attribué à un joueur (participantId) : dû = sa part ; le solde prépayé
    // doit appartenir à CE joueur. Sinon (participantId absent) : paiement « résa » global.
    let participant: { id: string; userId: string } | null = null;
    let dueCents: number;
    if (params.participantId) {
      const p = await prisma.reservationParticipant.findUnique({
        where: { id: params.participantId },
        select: { id: true, reservationId: true, userId: true, share: true },
      });
      if (!p || p.reservationId !== params.reservationId) throw new Error('PARTICIPANT_NOT_FOUND');
      participant = { id: p.id, userId: p.userId };
      dueCents = Math.round(num(p.share) * 100);
    } else {
      // Montant dû en centimes : prix de la résa, sinon prix du créneau au tarif
      // du terrain (creux ssi entièrement en heures creuses) pour un créneau COURT.
      dueCents = Math.round(num(reservation.totalPrice) * 100);
      if (dueCents <= 0 && reservation.type === 'COURT') {
        dueCents = slotPriceCents(
          reservation.resource.club.offPeakHours as OffPeakHours | null,
          reservation.startTime, reservation.endTime, reservation.resource.club.timezone,
          Math.round(num(reservation.resource.price) * 100),
          reservation.resource.offPeakPrice != null ? Math.round(num(reservation.resource.offPeakPrice) * 100) : null,
        );
      }
    }
    const amountCents = Math.round(params.amount * 100);
    // Re-lit le total payé dans la transaction (Serializable) pour bloquer deux encaissements concurrents.
    // Scopé au participant si attribué, sinon à la résa entière.
    const overpaidWhere = participant ? { participantId: participant.id } : { reservationId: params.reservationId };
    const assertNotOverpaid = async (tx: Prisma.TransactionClient) => {
      if (dueCents <= 0) return;
      const [paidAgg, refundAgg] = await Promise.all([
        tx.payment.aggregate({ _sum: { amount: true }, where: overpaidWhere }),
        tx.refund.aggregate({ _sum: { amount: true }, where: { payment: overpaidWhere } }),
      ]);
      const paidCents = Math.round(num(paidAgg._sum.amount) * 100) - Math.round(num(refundAgg._sum.amount) * 100);
      if (paidCents + amountCents > dueCents) throw new Error('PAYMENT_EXCEEDS_DUE');
    };

    const base = {
      reservationId: params.reservationId,
      participantId: params.participantId ?? null,
      clubId: params.clubId,
      amount: new Prisma.Decimal(params.amount),
      method,
      payerName: params.payerName?.trim() || null,
      note: params.note?.trim() || null,
      voucherRef:    method === 'VOUCHER' ? params.voucherRef?.trim() || null : null,
      voucherIssuer: method === 'VOUCHER' ? params.voucherIssuer?.trim() || null : null,
      voucherStatus: method === 'VOUCHER' ? ('PENDING_REIMBURSEMENT' as const) : null,
      createdByUserId: params.createdByUserId ?? null,
    };

    if (method !== 'PACK_CREDIT' && method !== 'WALLET') {
      return prisma.$transaction(async (tx) => {
        await assertNotOverpaid(tx);
        const receiptNo = await PackageService.nextReceiptNo(tx, params.clubId);
        return tx.payment.create({ data: { ...base, receiptNo } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }

    // Paiement par solde prépayé : le package doit appartenir au joueur de la résa.
    if (!params.sourcePackageId) throw new Error('VALIDATION_ERROR');
    const pkg = await prisma.memberPackage.findUnique({ where: { id: params.sourcePackageId } });
    const expectedUserId = participant ? participant.userId : reservation.userId;
    if (!pkg || pkg.clubId !== params.clubId)                    throw new Error('PACKAGE_NOT_FOUND');
    if (expectedUserId && pkg.userId !== expectedUserId)         throw new Error('PACKAGE_NOT_FOUND');
    if ((method === 'PACK_CREDIT') !== (pkg.kind === 'ENTRIES')) throw new Error('VALIDATION_ERROR');

    return prisma.$transaction(async (tx) => {
      await assertNotOverpaid(tx);
      await PackageService.consume(tx, pkg, new Prisma.Decimal(params.amount));
      const receiptNo = await PackageService.nextReceiptNo(tx, params.clubId);
      return tx.payment.create({ data: { ...base, sourcePackageId: pkg.id, receiptNo } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
