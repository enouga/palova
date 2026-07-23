import { Prisma, RefereeContactPolicy, TournamentGender, TournamentStatus } from '@prisma/client';
import { reportError } from '../observability/reportError';
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

/** Valeurs admises du réglage de contactabilité du J/A (validation du PATCH). */
const REFEREE_CONTACT_POLICIES: readonly RefereeContactPolicy[] = ['ALWAYS', 'AFTER_DEADLINE', 'NEVER'];

/**
 * Contactabilité du J/A d'un tournoi par ses inscrits.
 * Kill-switch d'abord (adhésion ACTIVE + facette, miroir de resolveReferee) : décocher la
 * facette coupe le contact même si la mission refereeUserId reste posée. Puis la politique
 * personnelle — AFTER_DEADLINE ne s'ouvre qu'une fois les inscriptions closes.
 */
function refereeContactable(
  m: { status: string; isReferee: boolean; refereeContactPolicy: RefereeContactPolicy } | null | undefined,
  registrationDeadline: Date,
  now: Date,
): boolean {
  if (!m || m.status !== 'ACTIVE' || !m.isReferee) return false;
  if (m.refereeContactPolicy === 'NEVER') return false;
  if (m.refereeContactPolicy === 'AFTER_DEADLINE') return now >= registrationDeadline;
  return true;
}

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

export type MarkTablePresence = 'UNSEEN' | 'PRESENT' | 'ABSENT';

/** Un joueur vu à la table de marque. `userId` volontairement présent (cf. bloc « Table de marque »). */
export interface MarkTablePlayer {
  userId: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  phone: string | null;
  membershipNo: string | null;
  presence: MarkTablePresence;
}

export interface MarkTableRegistration {
  id: string;
  status: string;
  paymentStatus: string;
  waitlistPosition: number | null;
  captain: MarkTablePlayer;
  partner: MarkTablePlayer;
}

export interface MarkTableBenchEntry {
  userId: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  phone: string | null;
  membershipNo: string | null;
  source: 'FORFEIT' | 'WALK_IN';
}

export interface MarkTableLogEntry {
  id: string;
  kind: string;
  data: Record<string, unknown>;
  actorName: string | null;
  createdAt: Date;
}

export interface MarkTableView {
  tournament: { id: string; name: string; category: string; gender: string; maxTeams: number | null };
  registrations: MarkTableRegistration[];
  bench: MarkTableBenchEntry[];
  recentLog: MarkTableLogEntry[];
  pointedCount: number;
  totalSlots: number;
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
      reportError(err, { source: 'safeNotify:tournament' });
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

  /** Remboursement best-effort ; ne fait jamais échouer l'annulation. Motif traçable. */
  private async safeRefund(info: { paymentId: string; amount: number; regId: string }, clubId: string, reason = 'Désinscription avant clôture'): Promise<void> {
    try {
      await new RefundService().refund({ paymentId: info.paymentId, clubId, amount: info.amount, reason });
      await prisma.tournamentRegistration.update({ where: { id: info.regId }, data: { paymentStatus: 'REFUNDED' } });
    } catch (err) {
      console.error('[refund] remboursement tournoi échoué', err);
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
   * `contactable` est un booléen CALCULÉ (politique perso + clôture + kill-switch facette,
   * cf. `refereeContactable`) — jamais `refereeUserId`, jamais la relation brute.
   */
  async getById(tournamentId: string) {
    const t = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: {
        ...PUBLIC_TOURNAMENT_SELECT,
        club: { select: { slug: true, name: true, timezone: true } },
        clubSport: { select: { sport: { select: { key: true, name: true } } } },
        // La contactabilité se calcule via la relation (clubMemberships du J/A, filtrée sur
        // t.clubId en JS) : refereeUserId n'est jamais lu sur ce chemin public.
        referee: { select: { firstName: true, lastName: true, clubMemberships: { select: { clubId: true, status: true, isReferee: true, refereeContactPolicy: true } } } },
      },
    });
    if (!t || t.status === 'DRAFT') throw new Error('TOURNAMENT_NOT_FOUND');
    const { referee, ...rest } = t;
    const [withCount] = await this.withCounts([rest]);
    const membership = referee?.clubMemberships.find((m) => m.clubId === t.clubId) ?? null;
    return {
      ...withCount,
      referee: referee ? {
        name: `${referee.firstName} ${referee.lastName}`.trim(),
        contactable: refereeContactable(membership, t.registrationDeadline, new Date()),
      } : null,
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
            club: { select: { slug: true, name: true, timezone: true, accentColor: true } },
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
      // Rembourse les inscrits payés en ligne APRÈS la notif (la notif cible les regs par
      // status, pas paymentStatus — aucune interférence). Best-effort, jamais bloquant.
      await this.refundAllPaidRegistrations(tournamentId, clubId, 'Annulation par le club');
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

  /** Rembourse (best-effort) toutes les inscriptions payées en ligne d'un tournoi — utilisé quand le club annule l'épreuve entière. */
  private async refundAllPaidRegistrations(tournamentId: string, clubId: string, reason: string): Promise<void> {
    const paid = await prisma.tournamentRegistration.findMany({
      where: { tournamentId, status: { not: 'CANCELLED' }, paymentStatus: 'PAID' },
      select: { id: true },
    });
    for (const reg of paid) {
      const pay = await prisma.payment.findFirst({ where: { tournamentRegistrationId: reg.id, method: 'ONLINE' }, select: { id: true, amount: true } });
      if (pay) await this.safeRefund({ paymentId: pay.id, amount: Number(pay.amount), regId: reg.id }, clubId, reason);
    }
  }

  /** Désinscription manuelle par le club (promeut le 1er en attente si c'était un CONFIRMED). */
  async adminRemoveRegistration(tournamentId: string, regId: string, clubId: string) {
    await this.findClubRegistration(tournamentId, regId, clubId); // vérifie l'appartenance au club
    const t = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { requirePrepayment: true } });
    const { cancelled, promotedRegistrationId, refundInfo } = await serializableTx(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tournaments WHERE id = ${tournamentId} FOR UPDATE`;
      const reg = await tx.tournamentRegistration.findFirst({
        where: { id: regId, status: { not: 'CANCELLED' } },
        select: { id: true, status: true, paymentStatus: true },
      });
      if (!reg) throw new Error('REGISTRATION_NOT_FOUND');
      const res = await this.cancelAndPromoteTx(tx, tournamentId, regId, reg.status === 'CONFIRMED', t?.requirePrepayment ?? false);
      let refundInfo: { paymentId: string; amount: number; regId: string } | null = null;
      if (reg.paymentStatus === 'PAID') {
        const pay = await tx.payment.findFirst({ where: { tournamentRegistrationId: reg.id, method: 'ONLINE' }, select: { id: true, amount: true } });
        if (pay) refundInfo = { paymentId: pay.id, amount: Number(pay.amount), regId: reg.id };
      }
      return { ...res, refundInfo };
    }, { timeout: 10_000 });

    if (promotedRegistrationId && t?.requirePrepayment) {
      // Payant : la notif de promotion part du débit réussi (chargePromotedRegistration), pas ici, pour ne pas doubler.
      await this.safeNotify(() => notify.notifyTournamentCancellation(cancelled.id));
      await this.safeCharge(promotedRegistrationId);
    } else {
      await this.notifyCancellation(cancelled.id, promotedRegistrationId);
    }
    // Remboursement best-effort du binôme retiré (post-commit, seulement si paiement ONLINE trouvé).
    if (refundInfo) await this.safeRefund(refundInfo, clubId, 'Retrait par le club');
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

  /** Réglage de contactabilité du J/A (par club). Gate resolveReferee posé par la route. */
  async getRefereeContactPolicy(clubId: string, userId: string) {
    const m = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId, clubId } },
      select: { refereeContactPolicy: true },
    });
    return { policy: m?.refereeContactPolicy ?? 'AFTER_DEADLINE' };
  }

  async setRefereeContactPolicy(clubId: string, userId: string, policy: string) {
    if (!REFEREE_CONTACT_POLICIES.includes(policy as RefereeContactPolicy)) throw new Error('VALIDATION_ERROR');
    const m = await prisma.clubMembership.update({
      where: { userId_clubId: { userId, clubId } },
      data: { refereeContactPolicy: policy as RefereeContactPolicy },
      select: { refereeContactPolicy: true },
    });
    return { policy: m.refereeContactPolicy };
  }

  /**
   * Porte du bouton « Contacter le J/A » : inscrit non-annulé (capitaine ou partenaire) +
   * J/A désigné + politique re-calculée serveur (jamais confiée au client). Renvoie
   * l'identité à passer à la messagerie — le userId du J/A ne sort d'ici que contact autorisé.
   */
  async assertRefereeContactable(tournamentId: string, meId: string): Promise<{ refereeUserId: string; clubSlug: string }> {
    const t = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: {
        status: true, clubId: true, refereeUserId: true, registrationDeadline: true,
        club: { select: { slug: true } },
      },
    });
    if (!t || t.status === 'DRAFT') throw new Error('TOURNAMENT_NOT_FOUND');
    const reg = await prisma.tournamentRegistration.findFirst({
      where: { tournamentId, status: { not: 'CANCELLED' }, OR: [{ captainUserId: meId }, { partnerUserId: meId }] },
      select: { id: true },
    });
    if (!reg) throw new Error('NOT_REGISTERED');
    if (!t.refereeUserId) throw new Error('TOURNAMENT_NO_REFEREE');
    const membership = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId: t.refereeUserId, clubId: t.clubId } },
      select: { status: true, isReferee: true, refereeContactPolicy: true },
    });
    if (!refereeContactable(membership, t.registrationDeadline, new Date())) throw new Error('REFEREE_NOT_CONTACTABLE');
    return { refereeUserId: t.refereeUserId, clubSlug: t.club.slug };
  }

  /**
   * Étage 2 — « ce tournoi est-il le tien ? ».
   * TOURNAMENT_NOT_FOUND (inexistant / autre club) | TOURNAMENT_NOT_YOURS (autre J/A).
   * Publique : appelée aussi bien depuis les méthodes ci-dessous que directement par les
   * routes de la table de marque (clubs.ts), dont le cœur partagé (assertTournamentInClub)
   * ne vérifie que le club, jamais la propriété — l'étage 2 doit donc être posé à la porte J/A.
   */
  async assertRefereeOwnsTournament(tournamentId: string, clubId: string, userId: string) {
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

  // ─────────────────────────────────────────────────────────── Table de marque
  // Gate = fait de la ROUTE appelante (resolveReferee+propriété côté J/A, STAFF côté admin).
  // Les méthodes ci-dessous sont le CŒUR PARTAGÉ, appelé par les deux portes.

  /** Vérifie que le tournoi appartient au club. TOURNAMENT_NOT_FOUND sinon. */
  private async assertTournamentInClub(clubId: string, tournamentId: string) {
    const t = await prisma.tournament.findFirst({
      where: { id: tournamentId, clubId },
      select: { id: true, name: true, category: true, gender: true, maxTeams: true },
    });
    if (!t) throw new Error('TOURNAMENT_NOT_FOUND');
    return t;
  }

  /**
   * `userId` exposé ici (contrairement à `refereeListRegistrations`, en lecture seule) :
   * cette vue sert à AGIR (remplacer/apparier), il faut un identifiant à renvoyer au
   * serveur. Jamais atteignable sans être J/A du tournoi ou STAFF du club — jamais public.
   */
  async listMarkTable(clubId: string, tournamentId: string): Promise<MarkTableView> {
    const t = await this.assertTournamentInClub(clubId, tournamentId);

    const registrations = await prisma.tournamentRegistration.findMany({
      where: { tournamentId, status: { not: 'CANCELLED' } },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true, status: true, paymentStatus: true,
        captainUserId: true, partnerUserId: true, captainPresence: true, partnerPresence: true,
        captain: { select: { firstName: true, lastName: true, avatarUrl: true, phone: true } },
        partner: { select: { firstName: true, lastName: true, avatarUrl: true, phone: true } },
      },
    });
    const bench = await prisma.tournamentBenchEntry.findMany({
      where: { tournamentId },
      orderBy: { createdAt: 'asc' },
      select: {
        userId: true, source: true,
        user: { select: { firstName: true, lastName: true, avatarUrl: true, phone: true } },
      },
    });
    const recentLogRows = await prisma.tournamentLogEntry.findMany({
      where: { tournamentId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, kind: true, data: true, createdAt: true, actor: { select: { firstName: true, lastName: true } } },
    });

    const userIds = [...new Set([
      ...registrations.flatMap((r) => [r.captainUserId, r.partnerUserId]),
      ...bench.map((b) => b.userId),
    ])];
    const memberships = userIds.length
      ? await prisma.clubMembership.findMany({ where: { clubId, userId: { in: userIds } }, select: { userId: true, membershipNo: true } })
      : [];
    const licenseByUser = new Map(memberships.map((m) => [m.userId, m.membershipNo]));

    const toPlayer = (u: { firstName: string; lastName: string; avatarUrl: string | null; phone: string | null }, userId: string, presence: MarkTablePresence): MarkTablePlayer => ({
      userId, firstName: u.firstName, lastName: u.lastName, avatarUrl: u.avatarUrl, phone: u.phone,
      membershipNo: licenseByUser.get(userId) ?? null, presence,
    });

    let waitlistIdx = 0;
    let pointedCount = 0;
    const mapped = registrations.map((r) => {
      if (r.captainPresence === 'PRESENT') pointedCount++;
      if (r.partnerPresence === 'PRESENT') pointedCount++;
      return {
        id: r.id, status: r.status, paymentStatus: r.paymentStatus,
        waitlistPosition: r.status === 'WAITLISTED' ? ++waitlistIdx : null,
        captain: toPlayer(r.captain, r.captainUserId, r.captainPresence),
        partner: toPlayer(r.partner, r.partnerUserId, r.partnerPresence),
      };
    });

    return {
      tournament: t,
      registrations: mapped,
      bench: bench.map((b) => ({
        userId: b.userId, firstName: b.user.firstName, lastName: b.user.lastName,
        avatarUrl: b.user.avatarUrl, phone: b.user.phone,
        membershipNo: licenseByUser.get(b.userId) ?? null, source: b.source,
      })),
      recentLog: recentLogRows.map((l) => ({
        id: l.id, kind: l.kind, data: l.data as Record<string, unknown>, createdAt: l.createdAt,
        actorName: l.actor ? `${l.actor.firstName} ${l.actor.lastName}`.trim() : null,
      })),
      pointedCount,
      totalSlots: mapped.filter((r) => r.status === 'CONFIRMED').length * 2,
      waitlistCount: mapped.filter((r) => r.status === 'WAITLISTED').length,
    };
  }

  /** Journal complet du tournoi, plus récent d'abord. Pas de curseur (v1 : cap simple). */
  async listMarkTableLog(clubId: string, tournamentId: string): Promise<MarkTableLogEntry[]> {
    await this.assertTournamentInClub(clubId, tournamentId);
    const rows = await prisma.tournamentLogEntry.findMany({
      where: { tournamentId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { id: true, kind: true, data: true, createdAt: true, actor: { select: { firstName: true, lastName: true } } },
    });
    return rows.map((l) => ({
      id: l.id, kind: l.kind, data: l.data as Record<string, unknown>, createdAt: l.createdAt,
      actorName: l.actor ? `${l.actor.firstName} ${l.actor.lastName}`.trim() : null,
    }));
  }

  /** Écrit une entrée de journal. À appeler DANS la transaction de l'acte qu'elle documente. */
  private async writeLog(tx: Prisma.TransactionClient, tournamentId: string, actorUserId: string, kind: string, data: Record<string, unknown>) {
    await tx.tournamentLogEntry.create({ data: { tournamentId, actorUserId, kind, data: data as Prisma.InputJsonValue } });
  }

  /** Pointage d'un joueur. Pas de gate temporel — pointer se fait à tout moment. */
  async setPresence(clubId: string, tournamentId: string, regId: string, side: 'CAPTAIN' | 'PARTNER', presence: MarkTablePresence, actorUserId: string) {
    const reg = await prisma.tournamentRegistration.findFirst({
      where: { id: regId, tournamentId, tournament: { clubId }, status: { not: 'CANCELLED' } },
      select: { id: true, captainUserId: true, partnerUserId: true, captain: { select: { firstName: true, lastName: true } }, partner: { select: { firstName: true, lastName: true } } },
    });
    if (!reg) throw new Error('REGISTRATION_NOT_FOUND');
    const player = side === 'CAPTAIN' ? reg.captain : reg.partner;
    await prisma.$transaction(async (tx) => {
      await tx.tournamentRegistration.update({
        where: { id: regId },
        data: side === 'CAPTAIN' ? { captainPresence: presence } : { partnerPresence: presence },
      });
      await this.writeLog(tx, tournamentId, actorUserId, 'CHECK_IN', {
        playerName: `${player.firstName} ${player.lastName}`.trim(), presence,
      });
    });
  }

  /** Promotion depuis la table de marque : délègue au cœur admin, puis journalise. */
  async markTablePromote(clubId: string, tournamentId: string, regId: string, actorUserId: string) {
    const promoted = await this.adminPromoteRegistration(tournamentId, regId, clubId);
    // `adminPromoteRegistration` renvoie nullable côté paiement (re-findUnique après une promotion
    // concurrente qui aurait pu annuler la place entretemps) — cas résiduel, on journalise seulement si trouvé.
    const full = promoted
      ? await prisma.tournamentRegistration.findUnique({
          where: { id: promoted.id },
          select: { captain: { select: { firstName: true, lastName: true } }, partner: { select: { firstName: true, lastName: true } } },
        })
      : null;
    if (full) {
      await prisma.tournamentLogEntry.create({
        data: { tournamentId, actorUserId, kind: 'PROMOTE', data: { nameA: `${full.captain.firstName} ${full.captain.lastName}`.trim(), nameB: `${full.partner.firstName} ${full.partner.lastName}`.trim() } as Prisma.InputJsonValue },
      });
    }
    return promoted;
  }

  /** Retrait depuis la table de marque : délègue au cœur admin, puis journalise. */
  async markTableRemove(clubId: string, tournamentId: string, regId: string, actorUserId: string) {
    const before = await prisma.tournamentRegistration.findUnique({
      where: { id: regId },
      select: { captain: { select: { firstName: true, lastName: true } }, partner: { select: { firstName: true, lastName: true } } },
    });
    const removed = await this.adminRemoveRegistration(tournamentId, regId, clubId);
    if (before) {
      await prisma.tournamentLogEntry.create({
        data: { tournamentId, actorUserId, kind: 'REMOVE', data: { nameA: `${before.captain.firstName} ${before.captain.lastName}`.trim(), nameB: `${before.partner.firstName} ${before.partner.lastName}`.trim() } as Prisma.InputJsonValue },
      });
    }
    return removed;
  }

  // ------------------------------------------------------- Forfait & banc

  /** Adhésion ACTIVE requise (pas BLOCKED, pas absente). NOT_A_MEMBER sinon. Pas de garde phone/licence (spec : le J/A juge). */
  private async assertActiveMember(clubId: string, userId: string): Promise<void> {
    const m = await prisma.clubMembership.findUnique({ where: { userId_clubId: { userId, clubId } }, select: { status: true } });
    if (!m || m.status !== 'ACTIVE') throw new Error('NOT_A_MEMBER');
  }

  /**
   * Forfait d'un côté d'un binôme : annule TOUTE l'inscription (le schéma n'autorise pas un
   * côté vide) et place le coéquipier survivant sur le banc pour qu'il puisse être repêché
   * (appariement ou remplacement ailleurs — hors périmètre ici). Réutilise `cancelAndPromoteTx`
   * (promotion auto du 1er en attente, mêmes règles que `adminRemoveRegistration`).
   */
  async declareForfeit(clubId: string, tournamentId: string, regId: string, side: 'CAPTAIN' | 'PARTNER', actorUserId: string) {
    const reg = await prisma.tournamentRegistration.findFirst({
      where: { id: regId, tournamentId, tournament: { clubId }, status: { not: 'CANCELLED' } },
      select: {
        id: true, status: true, captainUserId: true, partnerUserId: true,
        captain: { select: { firstName: true, lastName: true } }, partner: { select: { firstName: true, lastName: true } },
      },
    });
    if (!reg) throw new Error('REGISTRATION_NOT_FOUND');
    const t = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { requirePrepayment: true } });
    const forfeited = side === 'CAPTAIN' ? reg.captain : reg.partner;
    const remaining = side === 'CAPTAIN' ? { user: reg.partner, id: reg.partnerUserId } : { user: reg.captain, id: reg.captainUserId };

    const { cancelled, promotedRegistrationId } = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tournaments WHERE id = ${tournamentId} FOR UPDATE`;
      const res = await this.cancelAndPromoteTx(tx, tournamentId, regId, reg.status === 'CONFIRMED', t?.requirePrepayment ?? false);
      await tx.tournamentBenchEntry.create({ data: { tournamentId, userId: remaining.id, source: 'FORFEIT', addedById: actorUserId } });
      await this.writeLog(tx, tournamentId, actorUserId, 'FORFEIT', {
        forfeitedName: `${forfeited.firstName} ${forfeited.lastName}`.trim(),
        remainingName: `${remaining.user.firstName} ${remaining.user.lastName}`.trim(),
      });
      return res;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 });

    if (promotedRegistrationId && t?.requirePrepayment) {
      await this.safeNotify(() => notify.notifyTournamentCancellation(cancelled.id));
      await this.safeCharge(promotedRegistrationId);
    } else {
      await this.notifyCancellation(cancelled.id, promotedRegistrationId);
    }
    return cancelled;
  }

  /** Ajoute un retardataire au banc (membre actif requis). Idempotent via l'index unique.
   *  N'assure PAS que `tournamentId` appartient à `clubId` : c'est le rôle de la route
   *  appelante (cf. commentaire d'en-tête « Gate = fait de la ROUTE appelante ») —
   *  `clubId` ne sert ici qu'à vérifier l'adhésion du joueur ajouté. */
  async addToBench(clubId: string, tournamentId: string, userId: string, actorUserId: string) {
    await this.assertActiveMember(clubId, userId);
    const dup = await prisma.tournamentRegistration.findFirst({
      where: { tournamentId, status: { not: 'CANCELLED' }, OR: [{ captainUserId: userId }, { partnerUserId: userId }] },
      select: { id: true },
    });
    if (dup) throw new Error('ALREADY_REGISTERED');
    const already = await prisma.tournamentBenchEntry.findUnique({ where: { tournamentId_userId: { tournamentId, userId } } });
    if (already) throw new Error('ALREADY_ON_BENCH');
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true } });
    await prisma.$transaction(async (tx) => {
      await tx.tournamentBenchEntry.create({ data: { tournamentId, userId, source: 'WALK_IN', addedById: actorUserId } });
      await this.writeLog(tx, tournamentId, actorUserId, 'ADD_LATE', { playerName: user ? `${user.firstName} ${user.lastName}`.trim() : userId });
    });
  }

  /** Retrait manuel du banc. BENCH_ENTRY_NOT_FOUND si absent. L'appartenance au club est
   *  vérifiée dans le `deleteMany` lui-même (`tournament: { clubId }`) plutôt que via un
   *  aller-retour séparé : un tournoi d'un autre club ne supprime simplement rien (count 0). */
  async removeFromBench(clubId: string, tournamentId: string, userId: string, actorUserId: string) {
    const del = await prisma.tournamentBenchEntry.deleteMany({ where: { tournamentId, userId, tournament: { clubId } } });
    if (del.count === 0) throw new Error('BENCH_ENTRY_NOT_FOUND');
    void actorUserId; // pas de journal pour un simple retrait manuel (acte correctif, pas un événement de jeu)
  }

  // ---------------------------------------------------------- Remplacement

  /**
   * Remplace UN côté d'un binôme, sur SA place (même regId, même paiement — intouché).
   * Ne dépend d'aucun forfait/pointage préalable : fonctionne sur n'importe quel côté (absent
   * ou non — aucun gate de présence côté serveur, l'UI ne propose que les côtés ABSENT comme
   * cibles). Téléphone/licence ne sont PAS bloquants (contrairement à l'inscription normale) :
   * seules l'adhésion ACTIVE et la composition (sexe) sont des gardes dures. Outrepasse la
   * clôture des inscriptions (le J/A doit pouvoir agir PENDANT le tournoi). Ne touche JAMAIS
   * `paymentStatus`/`paymentDeadline` : le paiement reste attaché à l'inscription, remplacer
   * un joueur — même le capitaine payeur — ne déclenche aucune charge ni remboursement.
   */
  async replacePlayer(clubId: string, tournamentId: string, regId: string, side: 'CAPTAIN' | 'PARTNER', newUserId: string, actorUserId: string) {
    const reg = await prisma.tournamentRegistration.findFirst({
      where: { id: regId, tournamentId, tournament: { clubId }, status: { not: 'CANCELLED' } },
      select: {
        id: true, captainUserId: true, partnerUserId: true,
        tournament: { select: { gender: true, openToWomen: true } },
        captain: { select: { firstName: true, lastName: true, email: true } },
        partner: { select: { firstName: true, lastName: true, email: true } },
      },
    });
    if (!reg) throw new Error('REGISTRATION_NOT_FOUND');
    if (newUserId === reg.captainUserId || newUserId === reg.partnerUserId) throw new Error('ALREADY_REGISTERED');

    await this.assertActiveMember(clubId, newUserId);
    const dup = await prisma.tournamentRegistration.findFirst({
      where: { tournamentId, status: { not: 'CANCELLED' }, id: { not: regId }, OR: [{ captainUserId: newUserId }, { partnerUserId: newUserId }] },
      select: { id: true },
    });
    if (dup) throw new Error('ALREADY_REGISTERED');

    const newUser = await prisma.user.findUnique({ where: { id: newUserId }, select: { id: true, sex: true, firstName: true, lastName: true, email: true } });
    if (!newUser) throw new Error('USER_NOT_FOUND');
    if (!newUser.sex) throw new Error('SEX_REQUIRED');

    const otherSide = side === 'CAPTAIN' ? reg.partner : reg.captain;
    const otherUserId = side === 'CAPTAIN' ? reg.partnerUserId : reg.captainUserId;
    const otherUser = await prisma.user.findUnique({ where: { id: otherUserId }, select: { sex: true } });
    if (!otherUser?.sex) throw new Error('SEX_REQUIRED');

    const captainSex = side === 'CAPTAIN' ? newUser.sex : otherUser.sex;
    const partnerSex = side === 'CAPTAIN' ? otherUser.sex : newUser.sex;
    this.assertGender(reg.tournament.gender, captainSex as Sex, partnerSex as Sex, reg.tournament.openToWomen);

    const removedPlayer = side === 'CAPTAIN' ? reg.captain : reg.partner;
    const removedPlayerId = side === 'CAPTAIN' ? reg.captainUserId : reg.partnerUserId;

    await prisma.$transaction(async (tx) => {
      await tx.tournamentRegistration.update({
        where: { id: regId },
        data: side === 'CAPTAIN'
          ? { captainUserId: newUserId, captainPresence: 'PRESENT' }
          : { partnerUserId: newUserId, partnerPresence: 'PRESENT' },
      });
      await tx.tournamentBenchEntry.deleteMany({ where: { tournamentId, userId: newUserId } });
      await this.writeLog(tx, tournamentId, actorUserId, 'REPLACE', {
        removedName: `${removedPlayer.firstName} ${removedPlayer.lastName}`.trim(),
        newName: `${newUser.firstName} ${newUser.lastName}`.trim(),
      });
    });

    // Ancien joueur : même email `registration.cancelled` que la désinscription classique,
    // ciblé (le regId a déjà changé de titulaire, notifyTournamentCancellation ne l'atteindrait plus).
    await this.safeNotify(() => notify.notifyTournamentReplacement({
      tournamentId,
      removedPlayer: { id: removedPlayerId, email: removedPlayer.email, firstName: removedPlayer.firstName, lastName: removedPlayer.lastName },
      remainingPlayerName: `${otherSide.firstName} ${otherSide.lastName}`.trim(),
    }));
    // Remplaçant + coéquipier restant : notif d'inscription standard sur la même inscription (même regId).
    await this.safeNotify(() => notify.notifyTournamentRegistration(regId));
  }

  // ------------------------------------------------- Appariement & binôme tardif

  /**
   * Cœur partagé d'appariement/tardif : mêmes validations que `register` SAUF la deadline
   * (le J/A doit pouvoir apparier/ajouter PENDANT le tournoi, après clôture des inscriptions).
   * `fromBench` détermine si les 2 joueurs sont retirés du banc après création.
   */
  private async createPairedRegistration(clubId: string, tournamentId: string, userAId: string, userBId: string, actorUserId: string, logKind: 'PAIR' | 'ADD_LATE', fromBench: boolean) {
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { id: true, clubId: true, gender: true, openToWomen: true, status: true, maxTeams: true, requirePrepayment: true },
    });
    if (!tournament || tournament.clubId !== clubId) throw new Error('TOURNAMENT_NOT_FOUND');
    if (tournament.status !== 'PUBLISHED') throw new Error('TOURNAMENT_NOT_OPEN');
    if (userAId === userBId) throw new Error('PARTNER_IS_SELF');

    await this.assertActiveMember(clubId, userAId);
    await this.assertActiveMember(clubId, userBId);
    const [userA, userB] = await Promise.all([
      prisma.user.findUnique({ where: { id: userAId }, select: { id: true, sex: true, firstName: true, lastName: true } }),
      prisma.user.findUnique({ where: { id: userBId }, select: { id: true, sex: true, firstName: true, lastName: true } }),
    ]);
    if (!userA || !userB) throw new Error('USER_NOT_FOUND');
    if (!userA.sex || !userB.sex) throw new Error('SEX_REQUIRED');
    this.assertGender(tournament.gender, userA.sex as Sex, userB.sex as Sex, tournament.openToWomen);

    const paid = tournament.requirePrepayment;
    const registration = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tournaments WHERE id = ${tournamentId} FOR UPDATE`;
      await this.assertNoActiveRegistration(tx, tournamentId, [userAId, userBId]);
      const now = new Date();
      const confirmed = await tx.tournamentRegistration.count({ where: { tournamentId, ...occupiesSpotWhere(now) } });
      const status = tournament.maxTeams == null || confirmed < tournament.maxTeams ? 'CONFIRMED' : 'WAITLISTED';
      const created = await tx.tournamentRegistration.create({
        data: {
          tournamentId, captainUserId: userAId, partnerUserId: userBId, status,
          ...(paid ? { paymentStatus: 'DUE', paymentDeadline: status === 'CONFIRMED' ? holdDeadline(now) : null } : {}),
        },
      });
      if (fromBench) await tx.tournamentBenchEntry.deleteMany({ where: { tournamentId, userId: { in: [userAId, userBId] } } });
      await this.writeLog(tx, tournamentId, actorUserId, logKind, {
        nameA: `${userA.firstName} ${userA.lastName}`.trim(), nameB: `${userB.firstName} ${userB.lastName}`.trim(),
      });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 });

    // Même règle que `register` : place CONFIRMED payante → la notif part au paiement confirmé.
    if (!paid || registration.status === 'WAITLISTED') {
      await this.safeNotify(() => notify.notifyTournamentRegistration(registration.id));
    }
    return registration;
  }

  /** Deux joueurs du banc forment un nouveau binôme. Ils sortent du banc dans la transaction. Journal `PAIR`. */
  async pairFromBench(clubId: string, tournamentId: string, userAId: string, userBId: string, actorUserId: string) {
    return this.createPairedRegistration(clubId, tournamentId, userAId, userBId, actorUserId, 'PAIR', true);
  }

  /** Binôme tardif direct (sans passer par le banc). Journal `ADD_LATE`. */
  async addLateRegistration(clubId: string, tournamentId: string, captainUserId: string, partnerUserId: string, actorUserId: string) {
    return this.createPairedRegistration(clubId, tournamentId, captainUserId, partnerUserId, actorUserId, 'ADD_LATE', false);
  }
}
