import { Prisma, TournamentGender, TournamentStatus } from '@prisma/client';
import { prisma } from '../db/prisma';
import { serializableTx } from '../db/serializable';
import * as notify from '../email/notifications';
import { RatingService } from './rating.service';
import { occupiesSpotWhere, holdDeadline, entryFeeCents } from './registrationPayment';
import { PackageService } from './package.service';
import { StripeService } from './stripe.service';
import { RefundService } from './refund.service';

type Sex = 'MALE' | 'FEMALE';

export interface CreateTournamentInput {
  clubSportId: string;
  name: string;
  category: string;
  gender: TournamentGender;
  openToWomen?: boolean;
  description?: string | null;
  contactInfo?: string | null;
  refereeUserId?: string | null; // J/A désigné — validé serveur (assertRefereeValid), null = aucun
  startTime: string | Date;
  endTime?: string | Date | null;
  registrationDeadline: string | Date;
  maxTeams?: number | null;
  entryFee?: number | null;
  requirePrepayment?: boolean;
}
export type UpdateTournamentInput = Partial<CreateTournamentInput & { status: TournamentStatus }>;

/**
 * Colonnes d'un tournoi exposables sans authentification.
 *
 * ALLOWLIST, et non retrait a posteriori : les lectures publiques sont anonymes
 * (`GET /api/clubs/:slug/tournaments`, `/api/tournaments/:id`, `/api/tournaments/national`),
 * or un `include` renvoie *toutes* les colonnes du modèle — donc `refereeUserId`, un userId
 * interne, en clair (spec §7 : « nom seul, jamais le userId »). Énumérer ce qui sort plutôt
 * que ce qui reste garantit qu'une colonne privée *future* ne fuitera pas par défaut.
 *
 * Le nom du J/A s'expose via la relation `referee` projetée en `{ name }` (cf. `getById`).
 * Les chemins ADMIN (`listForAdmin`, `getForAdmin`) n'utilisent pas cette projection : le
 * picker de `/admin/tournaments` a besoin de `refereeUserId` pour se pré-sélectionner.
 */
const PUBLIC_TOURNAMENT_SELECT = {
  id: true, clubId: true, clubSportId: true, name: true, category: true, gender: true,
  openToWomen: true, description: true, contactInfo: true, startTime: true, endTime: true,
  registrationDeadline: true, maxTeams: true, entryFee: true, requirePrepayment: true,
  status: true, createdAt: true, updatedAt: true,
} satisfies Prisma.TournamentSelect;

/** Un joueur vu par le juge-arbitre à la table de marque. `userId` volontairement absent. */
export interface RefereePlayerRow {
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  phone: string | null;
  membershipNo: string | null; // licence — le J/A la vérifie à la table de marque
}

export interface RefereeRegistrationRow {
  id: string;
  status: string;
  paymentStatus: string;
  waitlistPosition: number | null;
  captain: RefereePlayerRow;
  partner: RefereePlayerRow; // toujours présent : TournamentRegistration.partnerUserId est requis
}

export interface RefereeTournamentRow {
  id: string;
  name: string;
  category: string;
  gender: string;
  status: string;
  startTime: Date;
  endTime: Date | null;
  registrationDeadline: Date;
  maxTeams: number | null;
  confirmedCount: number;
  waitlistCount: number;
}

/** Erreur métier avec, optionnellement, le joueur concerné ("self" | "partner"). */
function appError(code: string, subject?: 'self' | 'partner'): Error {
  return Object.assign(new Error(code), subject ? { subject } : {});
}

export class TournamentService {
  // ---------------------------------------------------------------- Inscription

  /** Inscrit un binôme (capitaine connecté + coéquipier par identifiant). */
  async register(tournamentId: string, captainUserId: string, partnerUserId: string) {
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { id: true, clubId: true, gender: true, openToWomen: true, status: true, registrationDeadline: true, maxTeams: true, requirePrepayment: true },
    });
    if (!tournament) throw new Error('TOURNAMENT_NOT_FOUND');
    if (tournament.status !== 'PUBLISHED') throw new Error('TOURNAMENT_NOT_OPEN');
    if (new Date() >= tournament.registrationDeadline) throw new Error('REGISTRATION_CLOSED');

    await this.resolveAndAssertEligible(tournament, captainUserId, partnerUserId);

    const paid = tournament.requirePrepayment;
    const registration = await serializableTx(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tournaments WHERE id = ${tournamentId} FOR UPDATE`;
      await this.assertNoActiveRegistration(tx, tournamentId, [captainUserId, partnerUserId]);
      const now = new Date();
      const confirmed = await tx.tournamentRegistration.count({ where: { tournamentId, ...occupiesSpotWhere(now) } });
      const status = tournament.maxTeams == null || confirmed < tournament.maxTeams ? 'CONFIRMED' : 'WAITLISTED';
      return tx.tournamentRegistration.create({
        data: {
          tournamentId, captainUserId, partnerUserId, status,
          ...(paid ? { paymentStatus: 'DUE', paymentDeadline: status === 'CONFIRMED' ? holdDeadline(now) : null } : {}),
        },
      });
    }, { timeout: 10_000 });

    // Pour une place CONFIRMED payante, la notif d'inscription part au paiement confirmé.
    if (!paid || registration.status === 'WAITLISTED') {
      await this.safeNotify(() => notify.notifyTournamentRegistration(registration.id));
    }
    const payment = paid ? { mode: (registration.status === 'CONFIRMED' ? 'payment' : 'setup') as 'payment' | 'setup' } : null;
    return { registration, payment };
  }

  /** Confirme le paiement d'une inscription DUE → PAID + Payment ONLINE. Idempotent (client + webhook). */
  async confirmRegistrationPayment(regId: string, opts: { stripePaymentIntentId: string }) {
    const reg = await prisma.tournamentRegistration.findUnique({
      where: { id: regId },
      select: { id: true, paymentStatus: true, tournament: { select: { clubId: true, entryFee: true } } },
    });
    if (!reg) throw new Error('REGISTRATION_NOT_FOUND');
    if (reg.paymentStatus !== 'DUE') return reg; // déjà confirmé / non payant → no-op idempotent

    const amountCents = entryFeeCents(reg.tournament.entryFee);
    const result = await serializableTx(async (tx) => {
      const flip = await tx.tournamentRegistration.updateMany({
        where: { id: regId, paymentStatus: 'DUE' },
        data: { paymentStatus: 'PAID', paymentDeadline: null },
      });
      if (flip.count === 0) return null; // confirmé concurremment
      const receiptNo = await PackageService.nextReceiptNo(tx, reg.tournament.clubId);
      await tx.payment.create({
        data: {
          clubId: reg.tournament.clubId, tournamentRegistrationId: regId,
          amount: new Prisma.Decimal(amountCents).div(100),
          method: 'ONLINE', status: 'CAPTURED', stripePaymentIntentId: opts.stripePaymentIntentId, receiptNo,
        },
      });
      return tx.tournamentRegistration.findUnique({ where: { id: regId } });
    }, { timeout: 10_000 });

    if (result) await this.safeNotify(() => notify.notifyTournamentRegistration(regId));
    return result ?? reg;
  }

  /** Exécute un envoi d'email en best-effort : un échec est loggé, jamais propagé. */
  private async safeNotify(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      console.error('[notifications] envoi email échoué (tournoi) :', err);
    }
  }

  /** Refuse d'activer le paiement en ligne si le club n'a pas Stripe ACTIVE ou si le montant est < 0,50 €. */
  private async assertPrepaymentAllowed(clubId: string, entryFeeCentsValue: number): Promise<void> {
    const club = await prisma.club.findUnique({ where: { id: clubId }, select: { stripeAccountStatus: true } });
    if (club?.stripeAccountStatus !== 'ACTIVE') throw new Error('ONLINE_PAYMENT_NOT_ENABLED');
    if (entryFeeCentsValue < 50) throw new Error('ONLINE_PAYMENT_NOT_ENABLED');
  }

  /** Change de coéquipier : conserve statut + place en liste d'attente (createdAt inchangé). */
  async changePartner(tournamentId: string, captainUserId: string, partnerUserId: string) {
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { id: true, clubId: true, gender: true, openToWomen: true, status: true, registrationDeadline: true },
    });
    if (!tournament) throw new Error('TOURNAMENT_NOT_FOUND');
    if (tournament.status !== 'PUBLISHED') throw new Error('TOURNAMENT_NOT_OPEN');
    if (new Date() >= tournament.registrationDeadline) throw new Error('REGISTRATION_LOCKED');

    await this.resolveAndAssertEligible(tournament, captainUserId, partnerUserId);

    return serializableTx(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tournaments WHERE id = ${tournamentId} FOR UPDATE`;
      const reg = await tx.tournamentRegistration.findFirst({
        where: { tournamentId, captainUserId, status: { not: 'CANCELLED' } },
        select: { id: true },
      });
      if (!reg) throw new Error('REGISTRATION_NOT_FOUND');
      await this.assertNoActiveRegistration(tx, tournamentId, [captainUserId, partnerUserId], reg.id);
      return tx.tournamentRegistration.update({ where: { id: reg.id }, data: { partnerUserId } });
    }, { timeout: 10_000 });
  }

  /** Libère une place dont le paiement initial a expiré (CONFIRMED+DUE échue) et promeut le suivant. */
  async releaseExpiredRegistration(regId: string): Promise<void> {
    const reg = await prisma.tournamentRegistration.findUnique({
      where: { id: regId },
      select: { id: true, status: true, paymentStatus: true, tournamentId: true, tournament: { select: { requirePrepayment: true } } },
    });
    if (!reg || reg.status !== 'CONFIRMED' || reg.paymentStatus !== 'DUE') return;
    const { cancelled, promotedRegistrationId } = await serializableTx(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tournaments WHERE id = ${reg.tournamentId} FOR UPDATE`;
      return this.cancelAndPromoteTx(tx, reg.tournamentId, regId, true, reg.tournament.requirePrepayment);
    }, { timeout: 10_000 });
    if (promotedRegistrationId && reg.tournament.requirePrepayment) {
      // Payant : la notif de promotion part du débit réussi (safeCharge), pas ici, pour ne pas doubler.
      await this.safeNotify(() => notify.notifyTournamentCancellation(cancelled.id));
      await this.safeCharge(promotedRegistrationId);
    } else {
      await this.notifyCancellation(cancelled.id, promotedRegistrationId);
    }
  }

  /** Le capitaine se désinscrit avant la deadline ; promotion auto du 1er en attente. */
  async cancelRegistration(tournamentId: string, captainUserId: string) {
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { registrationDeadline: true, clubId: true, requirePrepayment: true },
    });
    if (!tournament) throw new Error('TOURNAMENT_NOT_FOUND');
    if (new Date() >= tournament.registrationDeadline) throw new Error('REGISTRATION_LOCKED');

    const { cancelled, promotedRegistrationId, refundInfo } = await serializableTx(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tournaments WHERE id = ${tournamentId} FOR UPDATE`;
      const reg = await tx.tournamentRegistration.findFirst({
        where: { tournamentId, captainUserId, status: { not: 'CANCELLED' } },
        select: { id: true, status: true, paymentStatus: true },
      });
      if (!reg) throw new Error('REGISTRATION_NOT_FOUND');
      const res = await this.cancelAndPromoteTx(tx, tournamentId, reg.id, reg.status === 'CONFIRMED', tournament.requirePrepayment);
      let refundInfo: { paymentId: string; amount: number; regId: string } | null = null;
      if (reg.paymentStatus === 'PAID') {
        const pay = await tx.payment.findFirst({ where: { tournamentRegistrationId: reg.id, method: 'ONLINE' }, select: { id: true, amount: true } });
        if (pay) refundInfo = { paymentId: pay.id, amount: Number(pay.amount), regId: reg.id };
      }
      return { ...res, refundInfo };
    }, { timeout: 10_000 });

    if (promotedRegistrationId && tournament.requirePrepayment) {
      // Payant : la notif de promotion part du débit réussi (chargePromotedRegistration), pas ici, pour ne pas doubler.
      await this.safeNotify(() => notify.notifyTournamentCancellation(cancelled.id));
      await this.safeCharge(promotedRegistrationId);
    } else {
      await this.notifyCancellation(cancelled.id, promotedRegistrationId);
    }
    // Remboursement best-effort post-commit (seulement si paiement ONLINE trouvé).
    if (refundInfo) await this.safeRefund(refundInfo, tournament.clubId);
    return cancelled;
  }

  /** Notifie désinscription + éventuelle promotion auto. Best-effort, hors transaction. */
  private async notifyCancellation(cancelledRegId: string, promotedRegistrationId: string | null): Promise<void> {
    await this.safeNotify(() => notify.notifyTournamentCancellation(cancelledRegId));
    if (promotedRegistrationId) await this.safeNotify(() => notify.notifyTournamentPromotion(promotedRegistrationId));
  }

  /** Débite la place promue en best-effort : un échec post-commit ne doit jamais casser la réponse de désinscription. */
  private async safeCharge(regId: string): Promise<void> {
    try {
      await this.chargePromotedRegistration(regId);
    } catch (err) {
      console.error('[paiement] débit promotion échoué (réconciliation par webhook) :', err);
    }
  }

  /** Remboursement best-effort (avant clôture) ; ne fait jamais échouer la désinscription. */
  private async safeRefund(info: { paymentId: string; amount: number; regId: string }, clubId: string): Promise<void> {
    try {
      await new RefundService().refund({ paymentId: info.paymentId, clubId, amount: info.amount, reason: 'Désinscription avant clôture' });
      await prisma.tournamentRegistration.update({ where: { id: info.regId }, data: { paymentStatus: 'REFUNDED' } });
    } catch (err) {
      console.error('[refund] désinscription tournoi : remboursement échoué', err);
    }
  }

  /** Passe une inscription CANCELLED et, si elle était CONFIRMED, promeut le 1er WAITLISTED. Renvoie l'inscription annulée + l'id éventuellement promu. À appeler dans une transaction qui détient déjà le verrou du tournoi. */
  private async cancelAndPromoteTx(tx: Prisma.TransactionClient, tournamentId: string, regId: string, wasConfirmed: boolean, paid = false) {
    const cancelled = await tx.tournamentRegistration.update({
      where: { id: regId },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    let promotedRegistrationId: string | null = null;
    if (wasConfirmed) {
      const next = await tx.tournamentRegistration.findFirst({
        where: { tournamentId, status: 'WAITLISTED' },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (next) {
        await tx.tournamentRegistration.update({
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
    const reg = await prisma.tournamentRegistration.findUnique({
      where: { id: regId },
      select: { id: true, status: true, paymentStatus: true, captainUserId: true, tournamentId: true, tournament: { select: { clubId: true, entryFee: true } } },
    });
    if (!reg || reg.status !== 'CONFIRMED' || reg.paymentStatus !== 'DUE') return;
    const amountCents = entryFeeCents(reg.tournament.entryFee);

    let piId: string;
    try {
      piId = await new StripeService().chargeRegistrationOffSession({
        clubId: reg.tournament.clubId, userId: reg.captainUserId, registrationId: regId, kind: 'tournament', amountCents,
        idempotencyKey: `reg-charge-${regId}`,
      });
    } catch {
      // Carte refusée / absente → on libère cette place et on promeut le suivant.
      const { cancelled, promotedRegistrationId } = await serializableTx(async (tx) => {
        await tx.$queryRaw`SELECT id FROM tournaments WHERE id = ${reg.tournamentId} FOR UPDATE`;
        return this.cancelAndPromoteTx(tx, reg.tournamentId, regId, true, true);
      }, { timeout: 10_000 });
      await this.safeNotify(() => notify.notifyTournamentCancellation(cancelled.id));
      // La récursion notifiera elle-même la promotion du suivant (sur débit réussi) — ne pas pré-notifier ici (doublon).
      if (promotedRegistrationId) await this.chargePromotedRegistration(promotedRegistrationId);
      return;
    }

    await serializableTx(async (tx) => {
      const flip = await tx.tournamentRegistration.updateMany({ where: { id: regId, paymentStatus: 'DUE' }, data: { paymentStatus: 'PAID', paymentDeadline: null } });
      if (flip.count === 0) return;
      const receiptNo = await PackageService.nextReceiptNo(tx, reg.tournament.clubId);
      await tx.payment.create({
        data: { clubId: reg.tournament.clubId, tournamentRegistrationId: regId, amount: new Prisma.Decimal(amountCents).div(100), method: 'ONLINE', status: 'CAPTURED', stripePaymentIntentId: piId, receiptNo },
      });
    }, { timeout: 10_000 });
    await this.safeNotify(() => notify.notifyTournamentPromotion(regId));
  }

  // --------------------------------------------------------- Lectures publiques

  /** Tournois PUBLISHED à venir d'un club (par slug), avec compteurs de places. */
  async listPublicByClubSlug(slug: string) {
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, status: true } });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    const tournaments = await prisma.tournament.findMany({
      where: { clubId: club.id, status: 'PUBLISHED' },
      orderBy: { startTime: 'asc' },
      select: { ...PUBLIC_TOURNAMENT_SELECT, clubSport: { select: { sport: { select: { key: true, name: true } } } } },
    });
    const withCounts = await this.withCounts(tournaments);
    return withCounts.map(({ clubSport, ...t }) => ({ ...t, sport: clubSport?.sport ?? null }));
  }

  /**
   * Agrégat public : tournois PUBLISHED à venir des clubs ACTIVE ayant opté pour le
   * calendrier national. Tout le filtrage/tri fin se fait côté client (volume modeste).
   * La projection `club` inclut le département (facette) + la timezone (libellé de date).
   */
  async listNationalTournaments(opts?: { monthsAhead?: number }) {
    const now = new Date();
    const horizon = new Date(now);
    horizon.setMonth(horizon.getMonth() + (opts?.monthsAhead ?? 6));
    const tournaments = await prisma.tournament.findMany({
      where: {
        status: 'PUBLISHED',
        startTime: { gte: now, lte: horizon },
        club: { status: 'ACTIVE', listTournamentsNationally: true },
      },
      select: {
        ...PUBLIC_TOURNAMENT_SELECT,
        club: { select: { slug: true, name: true, city: true, department: true, departmentCode: true, timezone: true, accentColor: true, logoUrl: true, latitude: true, longitude: true } },
        clubSport: { select: { sport: { select: { key: true, name: true } } } },
      },
      orderBy: { startTime: 'asc' },
    });
    const withCounts = await this.withCounts(tournaments);
    return withCounts.map(({ clubSport, ...t }) => ({ ...t, sport: clubSport?.sport ?? null }));
  }

  /**
   * Détail public d'un tournoi (DRAFT masqué) + compteurs.
   * Le J/A désigné y est exposé **par son nom seul** (spec §7) : c'est lui qui répond du
   * tournoi, mais son userId reste interne — d'où la projection `{ name }` plutôt que l'objet.
   */
  async getById(tournamentId: string) {
    const t = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: {
        ...PUBLIC_TOURNAMENT_SELECT,
        club: { select: { slug: true, name: true, timezone: true } },
        clubSport: { select: { sport: { select: { key: true, name: true } } } },
        referee: { select: { firstName: true, lastName: true } },
      },
    });
    if (!t || t.status === 'DRAFT') throw new Error('TOURNAMENT_NOT_FOUND');
    const { referee, ...rest } = t;
    const [withCount] = await this.withCounts([rest]);
    return {
      ...withCount,
      referee: referee ? { name: `${referee.firstName} ${referee.lastName}`.trim() } : null,
    };
  }

  /** Liste publique des binômes inscrits (noms + avatar + niveau), confirmés puis liste d'attente. DRAFT masqué. */
  async listParticipants(tournamentId: string) {
    const t = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { status: true, clubSport: { select: { sport: { select: { key: true } } } } },
    });
    if (!t || t.status === 'DRAFT') throw new Error('TOURNAMENT_NOT_FOUND');
    const registrations = await prisma.tournamentRegistration.findMany({
      where: { tournamentId, status: { not: 'CANCELLED' } },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }], // CONFIRMED avant WAITLISTED, puis ordre d'inscription
      select: {
        id: true,
        status: true,
        captainUserId: true,
        partnerUserId: true,
        captain: { select: { firstName: true, lastName: true, avatarUrl: true } },
        partner: { select: { firstName: true, lastName: true, avatarUrl: true } },
      },
    });
    const allUserIds = [...new Set(registrations.flatMap((r) => [r.captainUserId, r.partnerUserId]))];
    const ratingService = new RatingService();
    const sportKey = t.clubSport?.sport?.key ?? 'padel';
    const levels = allUserIds.length ? await ratingService.getLevelsForUsers(allUserIds, sportKey) : {};
    // captainUserId/partnerUserId exposés (additif) : entrée « Envoyer un message » côté front.
    return registrations.map((r) => ({
      ...r,
      captainLevel: levels[r.captainUserId] ?? null,
      partnerLevel: levels[r.partnerUserId] ?? null,
    }));
  }

  /** Inscriptions actives du joueur connecté (capitaine OU partenaire), tous clubs, avec tél + licence du binôme. */
  async listUserRegistrations(userId: string) {
    const regs = await prisma.tournamentRegistration.findMany({
      where: { status: { not: 'CANCELLED' }, OR: [{ captainUserId: userId }, { partnerUserId: userId }] },
      orderBy: { tournament: { startTime: 'asc' } },
      include: {
        // Payload joueur (pas admin) : même projection publique que les autres lectures.
        tournament: {
          select: {
            ...PUBLIC_TOURNAMENT_SELECT,
            club: { select: { slug: true, name: true, timezone: true } },
            clubSport: { select: { sport: { select: { key: true, name: true } } } },
          },
        },
        captain: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
        partner: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
      },
    });

    // Licence (membershipNo) de chaque joueur dans le club du tournoi concerné.
    const wanted = new Map<string, { userId: string; clubId: string }>();
    for (const r of regs) {
      wanted.set(`${r.captainUserId}:${r.tournament.clubId}`, { userId: r.captainUserId, clubId: r.tournament.clubId });
      wanted.set(`${r.partnerUserId}:${r.tournament.clubId}`, { userId: r.partnerUserId, clubId: r.tournament.clubId });
    }
    const memberships = wanted.size
      ? await prisma.clubMembership.findMany({
          where: { OR: [...wanted.values()].map((k) => ({ userId: k.userId, clubId: k.clubId })) },
          select: { userId: true, clubId: true, membershipNo: true },
        })
      : [];
    const licByKey = new Map(memberships.map((m) => [`${m.userId}:${m.clubId}`, m.membershipNo]));

    return regs.map((r) => {
      const { clubSport, ...tournament } = r.tournament;
      return {
        ...r,
        tournament: { ...tournament, sport: clubSport?.sport ?? null },
        captain: { ...r.captain, phone: r.captainUserId === userId ? r.captain.phone : null },
        partner: { ...r.partner, phone: r.partnerUserId === userId ? r.partner.phone : null },
        captainLicense: licByKey.get(`${r.captainUserId}:${r.tournament.clubId}`) ?? null,
        partnerLicense: licByKey.get(`${r.partnerUserId}:${r.tournament.clubId}`) ?? null,
      };
    });
  }

  /** Ajoute confirmedCount / waitlistCount à une liste de tournois. */
  private async withCounts<T extends { id: string }>(tournaments: T[]) {
    if (tournaments.length === 0) return [] as (T & { confirmedCount: number; waitlistCount: number })[];
    const grouped = await prisma.tournamentRegistration.groupBy({
      by: ['tournamentId', 'status'],
      where: { tournamentId: { in: tournaments.map((t) => t.id) }, status: { not: 'CANCELLED' } },
      _count: { _all: true },
    });
    const count = (id: string, status: string) =>
      grouped.find((g) => g.tournamentId === id && g.status === status)?._count._all ?? 0;
    return tournaments.map((t) => ({ ...t, confirmedCount: count(t.id, 'CONFIRMED'), waitlistCount: count(t.id, 'WAITLISTED') }));
  }

  // ----------------------------------------------------------- Admin (club)

  /** Tous les tournois du club (DRAFT inclus) + compteurs. */
  async listForAdmin(clubId: string) {
    const tournaments = await prisma.tournament.findMany({ where: { clubId }, orderBy: { startTime: 'desc' } });
    return this.withCounts(tournaments);
  }

  /** Détail admin : tournoi + inscriptions actives avec coordonnées (nom/tél/sexe/licence). */
  async getForAdmin(tournamentId: string, clubId: string) {
    const t = await prisma.tournament.findFirst({ where: { id: tournamentId, clubId } });
    if (!t) throw new Error('TOURNAMENT_NOT_FOUND');
    const registrations = await prisma.tournamentRegistration.findMany({
      where: { tournamentId, status: { not: 'CANCELLED' } },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      include: {
        captain: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, sex: true } },
        partner: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, sex: true } },
      },
    });
    const userIds = [...new Set(registrations.flatMap((r) => [r.captainUserId, r.partnerUserId]))];
    const memberships = userIds.length
      ? await prisma.clubMembership.findMany({ where: { clubId, userId: { in: userIds } }, select: { userId: true, membershipNo: true } })
      : [];
    const licenseByUser = new Map(memberships.map((m) => [m.userId, m.membershipNo]));
    return {
      tournament: t,
      registrations: registrations.map((r) => ({
        ...r,
        captainLicense: licenseByUser.get(r.captainUserId) ?? null,
        partnerLicense: licenseByUser.get(r.partnerUserId) ?? null,
      })),
    };
  }

  async createTournament(clubId: string, input: CreateTournamentInput) {
    const data = this.validateTournamentInput(input, true);
    const cs = await prisma.clubSport.findFirst({ where: { id: input.clubSportId, clubId }, select: { id: true } });
    if (!cs) throw new Error('CLUB_SPORT_NOT_FOUND');
    if (data.requirePrepayment) await this.assertPrepaymentAllowed(clubId, Math.round(Number((data as any).entryFee ?? 0) * 100));
    if (data.refereeUserId !== undefined) await this.assertRefereeValid(clubId, data.refereeUserId as string | null);
    return prisma.tournament.create({ data: { clubId, clubSportId: input.clubSportId, ...data } as Prisma.TournamentUncheckedCreateInput });
  }

  async updateTournament(tournamentId: string, clubId: string, input: UpdateTournamentInput) {
    const found = await prisma.tournament.findFirst({
      where: { id: tournamentId, clubId },
      select: { id: true, status: true, entryFee: true, requirePrepayment: true },
    });
    if (!found) throw new Error('TOURNAMENT_NOT_FOUND');
    const data = this.validateTournamentInput(input, false);
    if (input.status !== undefined) {
      if (!['DRAFT', 'PUBLISHED', 'CANCELLED'].includes(input.status as string)) throw new Error('VALIDATION_ERROR');
      (data as Record<string, unknown>).status = input.status;
    }
    // Effective requirePrepayment après cette màj : si on l'active, exiger Stripe ACTIVE + montant valide.
    const willRequire = input.requirePrepayment !== undefined ? Boolean(input.requirePrepayment) : found.requirePrepayment;
    if (willRequire) {
      const fee = input.entryFee !== undefined ? Number(input.entryFee) : Number(found.entryFee);
      await this.assertPrepaymentAllowed(clubId, Math.round(fee * 100));
    }
    if (data.refereeUserId !== undefined) await this.assertRefereeValid(clubId, data.refereeUserId as string | null);
    const updated = await prisma.tournament.update({ where: { id: tournamentId }, data });
    if (input.status === 'CANCELLED' && found.status !== 'CANCELLED') {
      await this.safeNotify(() => notify.notifyActivityCancelledByClub('tournament', tournamentId));
    }
    return updated;
  }

  async deleteTournament(tournamentId: string, clubId: string) {
    const found = await prisma.tournament.findFirst({ where: { id: tournamentId, clubId }, select: { id: true } });
    if (!found) throw new Error('TOURNAMENT_NOT_FOUND');
    const active = await prisma.tournamentRegistration.count({ where: { tournamentId, status: { not: 'CANCELLED' } } });
    if (active > 0) throw new Error('HAS_REGISTRATIONS'); // utiliser status=CANCELLED pour annuler à la place
    await prisma.tournament.delete({ where: { id: tournamentId } });
  }

  /** Promotion manuelle d'un binôme en attente par le club (override, sans contrôle de place). */
  async adminPromoteRegistration(tournamentId: string, regId: string, clubId: string) {
    const reg = await this.findClubRegistration(tournamentId, regId, clubId);
    if (reg.status !== 'WAITLISTED') throw new Error('VALIDATION_ERROR');
    const t = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { requirePrepayment: true } });
    if (t?.requirePrepayment) {
      // Verrou + bascule conditionnelle : deux promotions concurrentes de la même place ne posent DUE qu'une fois → un seul débit.
      const promoted = await serializableTx(async (tx) => {
        await tx.$queryRaw`SELECT id FROM tournaments WHERE id = ${tournamentId} FOR UPDATE`;
        return tx.tournamentRegistration.updateMany({
          where: { id: regId, status: 'WAITLISTED' },
          data: { status: 'CONFIRMED', paymentStatus: 'DUE', paymentDeadline: holdDeadline(new Date()) },
        });
      }, { timeout: 10_000 });
      // Une autre promotion a déjà gagné → ne pas re-débiter.
      if (promoted.count > 0) await this.chargePromotedRegistration(regId);
      return prisma.tournamentRegistration.findUnique({ where: { id: regId } });
    }
    const promoted = await prisma.tournamentRegistration.update({ where: { id: regId }, data: { status: 'CONFIRMED' } });
    await this.safeNotify(() => notify.notifyTournamentPromotion(promoted.id));
    return promoted;
  }

  /** Désinscription manuelle par le club (promeut le 1er en attente si c'était un CONFIRMED). */
  async adminRemoveRegistration(tournamentId: string, regId: string, clubId: string) {
    await this.findClubRegistration(tournamentId, regId, clubId); // vérifie l'appartenance au club
    const t = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { requirePrepayment: true } });
    const { cancelled, promotedRegistrationId } = await serializableTx(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tournaments WHERE id = ${tournamentId} FOR UPDATE`;
      const reg = await tx.tournamentRegistration.findFirst({
        where: { id: regId, status: { not: 'CANCELLED' } },
        select: { id: true, status: true },
      });
      if (!reg) throw new Error('REGISTRATION_NOT_FOUND');
      return this.cancelAndPromoteTx(tx, tournamentId, regId, reg.status === 'CONFIRMED', t?.requirePrepayment ?? false);
    }, { timeout: 10_000 });

    if (promotedRegistrationId && t?.requirePrepayment) {
      // Payant : la notif de promotion part du débit réussi (chargePromotedRegistration), pas ici, pour ne pas doubler.
      await this.safeNotify(() => notify.notifyTournamentCancellation(cancelled.id));
      await this.safeCharge(promotedRegistrationId);
    } else {
      await this.notifyCancellation(cancelled.id, promotedRegistrationId);
    }
    return cancelled;
  }

  private async findClubRegistration(tournamentId: string, regId: string, clubId: string) {
    const reg = await prisma.tournamentRegistration.findFirst({
      where: { id: regId, tournamentId, tournament: { clubId } },
      select: { id: true, status: true },
    });
    if (!reg) throw new Error('REGISTRATION_NOT_FOUND');
    return reg;
  }

  /** Valide + normalise les champs d'un tournoi. `requireAll` pour la création. */
  private validateTournamentInput(input: UpdateTournamentInput, requireAll: boolean) {
    const data: Record<string, unknown> = {};
    const setStr = (key: 'name' | 'category', value?: string) => {
      const v = (value ?? '').trim();
      if (requireAll && !v) throw new Error('VALIDATION_ERROR');
      if (value !== undefined) { if (!v) throw new Error('VALIDATION_ERROR'); data[key] = v; }
    };
    setStr('name', input.name);
    setStr('category', input.category);

    if (requireAll || input.gender !== undefined) {
      if (!['MEN', 'WOMEN', 'MIXED'].includes(input.gender as string)) throw new Error('VALIDATION_ERROR');
      data.gender = input.gender;
    }
    if (input.openToWomen !== undefined) data.openToWomen = Boolean(input.openToWomen);
    if (input.description !== undefined) data.description = (input.description ?? '')?.toString().trim() || null;
    if (input.contactInfo !== undefined) data.contactInfo = (input.contactInfo ?? '')?.toString().trim() || null;
    if (input.refereeUserId !== undefined) data.refereeUserId = (input.refereeUserId ?? '').toString().trim() || null;

    const parseDate = (v: string | Date) => { const d = new Date(v); if (isNaN(d.getTime())) throw new Error('VALIDATION_ERROR'); return d; };
    if (requireAll || input.startTime !== undefined) data.startTime = parseDate(input.startTime as string | Date);
    if (requireAll || input.registrationDeadline !== undefined) data.registrationDeadline = parseDate(input.registrationDeadline as string | Date);
    if (input.endTime !== undefined) data.endTime = input.endTime ? parseDate(input.endTime) : null;

    if (input.maxTeams !== undefined) {
      if (input.maxTeams === null) data.maxTeams = null;
      else { const n = Math.trunc(Number(input.maxTeams)); if (isNaN(n) || n < 1) throw new Error('VALIDATION_ERROR'); data.maxTeams = n; }
    }
    if (input.entryFee !== undefined) {
      if (input.entryFee === null) data.entryFee = null;
      else { const f = Number(input.entryFee); if (isNaN(f) || f < 0) throw new Error('VALIDATION_ERROR'); data.entryFee = new Prisma.Decimal(f); }
    }
    if (input.requirePrepayment !== undefined) data.requirePrepayment = Boolean(input.requirePrepayment);
    return data;
  }

  // ----------------------------------------------------------------- Helpers

  /** Vérifie l'éligibilité du capitaine et du coéquipier (résolus par id). */
  private async resolveAndAssertEligible(
    tournament: { clubId: string; gender: TournamentGender; openToWomen: boolean },
    captainUserId: string,
    partnerUserId: string,
  ): Promise<void> {
    if (!partnerUserId) throw appError('PARTNER_NOT_FOUND', 'partner');
    if (partnerUserId === captainUserId) throw new Error('PARTNER_IS_SELF');

    const [captain, partner] = await Promise.all([
      prisma.user.findUnique({ where: { id: captainUserId }, select: { id: true, sex: true, phone: true } }),
      prisma.user.findUnique({ where: { id: partnerUserId }, select: { id: true, sex: true, phone: true } }),
    ]);
    if (!captain) throw new Error('USER_NOT_FOUND');
    if (!partner) throw appError('PARTNER_NOT_FOUND', 'partner');

    const [capM, partM] = await Promise.all([
      prisma.clubMembership.findUnique({ where: { userId_clubId: { userId: captain.id, clubId: tournament.clubId } }, select: { status: true, membershipNo: true } }),
      prisma.clubMembership.findUnique({ where: { userId_clubId: { userId: partner.id, clubId: tournament.clubId } }, select: { status: true, membershipNo: true } }),
    ]);

    if (capM?.status === 'BLOCKED') throw appError('MEMBERSHIP_BLOCKED', 'self');
    if (!capM) throw appError('MEMBERSHIP_REQUIRED', 'self');
    if (partM?.status === 'BLOCKED') throw appError('MEMBERSHIP_BLOCKED', 'partner');
    if (!partM) throw appError('MEMBERSHIP_REQUIRED', 'partner');

    if (!captain.phone) throw appError('PHONE_REQUIRED', 'self');
    if (!partner.phone) throw appError('PHONE_REQUIRED', 'partner');

    if (!capM.membershipNo) throw appError('LICENSE_REQUIRED', 'self');
    if (!partM.membershipNo) throw appError('LICENSE_REQUIRED', 'partner');

    if (!captain.sex) throw appError('SEX_REQUIRED', 'self');
    if (!partner.sex) throw appError('SEX_REQUIRED', 'partner');

    this.assertGender(tournament.gender, captain.sex as Sex, partner.sex as Sex, tournament.openToWomen);
  }

  private assertGender(gender: TournamentGender, a: Sex, b: Sex, openToWomen: boolean): void {
    // Tableau "Messieurs" ouvert aux femmes (convention FFT) = tableau open : toute composition acceptée.
    if (gender === 'MEN' && openToWomen) return;
    const ok =
      gender === 'MEN'   ? a === 'MALE' && b === 'MALE' :
      gender === 'WOMEN' ? a === 'FEMALE' && b === 'FEMALE' :
      /* MIXED */          (a === 'MALE' && b === 'FEMALE') || (a === 'FEMALE' && b === 'MALE');
    if (!ok) throw new Error('GENDER_MISMATCH');
  }

  /** Aucun des userIds donnés ne doit déjà figurer dans un binôme actif du tournoi. */
  private async assertNoActiveRegistration(client: Prisma.TransactionClient, tournamentId: string, userIds: string[], excludeRegId?: string): Promise<void> {
    const dup = await client.tournamentRegistration.findFirst({
      where: {
        tournamentId,
        status: { not: 'CANCELLED' },
        ...(excludeRegId ? { id: { not: excludeRegId } } : {}),
        OR: [{ captainUserId: { in: userIds } }, { partnerUserId: { in: userIds } }],
      },
      select: { id: true },
    });
    if (dup) throw new Error('ALREADY_REGISTERED');
  }

  // ------------------------------------------------------- Espace juge-arbitre
  // Gate = facette ClubMembership.isReferee + propriété du tournoi. PAS un rôle : un J/A
  // n'a aucun droit sur le reste du club. Miroir de l'espace coach (lesson.service.ts).

  /** Étage 1 — « es-tu J/A de ce club ? ». Adhésion ACTIVE + facette. Gate de l'espace arbitrage. */
  async resolveReferee(clubId: string, userId: string): Promise<boolean> {
    const m = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId, clubId } },
      select: { status: true, isReferee: true },
    });
    return !!m && m.status === 'ACTIVE' && m.isReferee;
  }

  /**
   * Étage 2 — « ce tournoi est-il le tien ? ».
   * TOURNAMENT_NOT_FOUND (inexistant / autre club) | TOURNAMENT_NOT_YOURS (autre J/A).
   */
  private async assertRefereeOwnsTournament(tournamentId: string, clubId: string, userId: string) {
    const t = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { clubId: true, refereeUserId: true },
    });
    if (!t || t.clubId !== clubId) throw new Error('TOURNAMENT_NOT_FOUND');
    if (t.refereeUserId !== userId) throw new Error('TOURNAMENT_NOT_YOURS');
    return t;
  }

  /**
   * Le J/A désigné doit être un membre ACTIVE du club portant la facette. REFEREE_INVALID sinon.
   * Sans ce contrôle, désigner un `refereeUserId` arbitraire ouvrirait l'espace J/A du club à
   * n'importe quel User de la plateforme, non-membre compris : c'est une garde de sécurité.
   */
  private async assertRefereeValid(clubId: string, refereeUserId: string | null) {
    if (!refereeUserId) return; // null = retirer le J/A, rien à vérifier
    if (!(await this.resolveReferee(clubId, refereeUserId))) throw new Error('REFEREE_INVALID');
  }

  /**
   * Promotion d'un binôme en attente par le J/A (sur SON tournoi). Délègue au cœur admin.
   * Pas de verrou temporel : le J/A doit pouvoir agir PENDANT le tournoi. Les règles de
   * deadline / tableau lancé sont portées par le cœur — on ne les redouble pas ici.
   */
  async refereePromoteRegistration(clubId: string, userId: string, tournamentId: string, regId: string) {
    await this.assertRefereeOwnsTournament(tournamentId, clubId, userId);
    return this.adminPromoteRegistration(tournamentId, regId, clubId);
  }

  /** Retrait d'un binôme par le J/A (sur SON tournoi). Délègue au cœur admin. */
  async refereeRemoveRegistration(clubId: string, userId: string, tournamentId: string, regId: string) {
    await this.assertRefereeOwnsTournament(tournamentId, clubId, userId);
    return this.adminRemoveRegistration(tournamentId, regId, clubId);
  }

  /**
   * Tournois du J/A (à venir asc ; passés desc, cap 30).
   * « À venir » = PAS ENCORE FINI, càd `endTime ?? startTime >= now` — jamais `startTime` seul :
   * `endTime` est nullable (le repli sur startTime est obligatoire) et le J/A doit agir PENDANT son
   * tournoi, qui doit donc rester là où il va le chercher. Ni trou, ni doublon entre les deux scopes.
   */
  async listRefereeTournaments(clubId: string, userId: string, scope: 'upcoming' | 'past'): Promise<RefereeTournamentRow[]> {
    const now = new Date();
    const tournaments = await prisma.tournament.findMany({
      where: {
        clubId,
        refereeUserId: userId,
        OR: scope === 'upcoming'
          ? [{ endTime: { gte: now } }, { endTime: null, startTime: { gte: now } }]
          : [{ endTime: { lt: now } }, { endTime: null, startTime: { lt: now } }],
      },
      orderBy: { startTime: scope === 'upcoming' ? 'asc' : 'desc' },
      ...(scope === 'past' ? { take: 30 } : {}),
      select: {
        id: true, name: true, category: true, gender: true, status: true,
        startTime: true, endTime: true, registrationDeadline: true, maxTeams: true,
      },
    });
    return this.withCounts(tournaments);
  }

  /** Roster J/A d'un tournoi : binômes + contacts + licence. `userId` jamais exposé. */
  async refereeListRegistrations(clubId: string, userId: string, tournamentId: string): Promise<RefereeRegistrationRow[]> {
    await this.assertRefereeOwnsTournament(tournamentId, clubId, userId);

    const registrations = await prisma.tournamentRegistration.findMany({
      where: { tournamentId, status: { not: 'CANCELLED' } },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }], // CONFIRMED avant WAITLISTED, puis ordre d'inscription
      select: {
        id: true,
        status: true,
        paymentStatus: true,
        captainUserId: true,
        partnerUserId: true,
        captain: { select: { firstName: true, lastName: true, avatarUrl: true, phone: true } },
        partner: { select: { firstName: true, lastName: true, avatarUrl: true, phone: true } },
      },
    });

    // Licences en une requête groupée pour tous les joueurs du tableau (pas de N+1).
    const userIds = [...new Set(registrations.flatMap((r) => [r.captainUserId, r.partnerUserId]))];
    const memberships = userIds.length
      ? await prisma.clubMembership.findMany({ where: { clubId, userId: { in: userIds } }, select: { userId: true, membershipNo: true } })
      : [];
    const licenseByUser = new Map(memberships.map((m) => [m.userId, m.membershipNo]));

    const toPlayer = (u: Omit<RefereePlayerRow, 'membershipNo'>, playerId: string): RefereePlayerRow => ({
      ...u,
      membershipNo: licenseByUser.get(playerId) ?? null,
    });

    let waitlistIdx = 0;
    return registrations.map((r) => ({
      id: r.id,
      status: r.status,
      paymentStatus: r.paymentStatus,
      waitlistPosition: r.status === 'WAITLISTED' ? ++waitlistIdx : null,
      captain: toPlayer(r.captain, r.captainUserId),
      partner: toPlayer(r.partner, r.partnerUserId),
    }));
  }
}
