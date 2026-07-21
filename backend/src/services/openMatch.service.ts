import { Prisma } from '@prisma/client';
import { reportError } from '../observability/reportError';
import { prisma } from '../db/prisma';
import { playerCount } from '../utils/courtType';
import { notifyOpenMatchJoin, notifyOpenMatchLeft, notifyOpenMatchRemoved, notifyOpenMatchAdded } from '../email/notifications';
import { RatingService, UserLevel } from './rating.service';
import { effectiveTeams, applyTeams } from './matchTeams';
import { ensureActiveMembership } from './membership';
import { matchCardStateHash } from './matchCardState';
import { MatchAlertService } from './matchAlert.service';
import { serializableTx } from '../db/serializable';

// Include commun à la liste et à la lecture unitaire d'une partie ouverte.
const MATCH_INCLUDE = {
  resource: { select: { id: true, name: true, attributes: true, clubId: true, clubSport: { select: { sport: { select: { key: true, name: true } } } } } },
  participants: {
    orderBy: { joinedAt: 'asc' },
    select: { userId: true, isOrganizer: true, team: true, slot: true, user: { select: { firstName: true, lastName: true, avatarUrl: true } } },
  },
  openMatchMessages: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
  _count: { select: { openMatchMessages: { where: { deletedAt: null } } } },
} satisfies Prisma.ReservationInclude;

type MatchRow = Prisma.ReservationGetPayload<{ include: typeof MATCH_INCLUDE }>;

// Include de l'agrégat national (vitrine palova.fr) : identité du club en plus,
// pas de chat ni de données viewer — le DTO est mappé à part, plus léger que toDTO.
const NATIONAL_INCLUDE = {
  resource: {
    select: {
      id: true, name: true, attributes: true, clubId: true,
      clubSport: { select: { sport: { select: { key: true, name: true } } } },
      club: { select: { slug: true, name: true, city: true, timezone: true, accentColor: true, logoUrl: true, latitude: true, longitude: true, department: true, departmentCode: true } },
    },
  },
  participants: {
    orderBy: { joinedAt: 'asc' },
    select: { userId: true, isOrganizer: true, team: true, slot: true, user: { select: { firstName: true, lastName: true, avatarUrl: true } } },
  },
} satisfies Prisma.ReservationInclude;

// « Parties ouvertes » : les réservations PUBLIC qu'un membre du club peut découvrir
// et rejoindre jusqu'à complet. Repose sur les participants (ReservationParticipant).
export class OpenMatchService {
  private ratingService = new RatingService();
  private matchAlerts = new MatchAlertService();
  /** Résout un club ACTIVE par slug et vérifie que l'appelant en est membre ACTIVE. */
  private async resolveActiveMember(slug: string, userId: string): Promise<{ id: string }> {
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, status: true } });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    const member = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId, clubId: club.id } },
      select: { status: true },
    });
    if (!member) throw new Error('MEMBERSHIP_REQUIRED');
    if (member.status === 'BLOCKED') throw new Error('MEMBERSHIP_BLOCKED');
    return { id: club.id };
  }

  /** Résout un club ACTIVE par slug, SANS exiger d'adhésion (lecture publique des parties). */
  private async resolveActiveClub(slug: string): Promise<{ id: string; accentColor: string; logoUrl: string | null }> {
    const club = await prisma.club.findUnique({
      where: { slug },
      select: { id: true, status: true, accentColor: true, logoUrl: true },
    });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    return { id: club.id, accentColor: club.accentColor, logoUrl: club.logoUrl };
  }

  /** Met à jour les parts de tous les participants : organisateur = reste au centime, autres = part égale. */
  private async applyShares(
    tx: Prisma.TransactionClient,
    parts: Array<{ id: string; isOrganizer: boolean }>,
    priceCents: number,
  ): Promise<void> {
    const n = parts.length;
    if (n === 0) return;
    const baseCents = Math.floor(priceCents / n);
    const organizerCents = priceCents - baseCents * (n - 1);
    for (const p of parts) {
      await tx.reservationParticipant.update({
        where: { id: p.id },
        data: { share: new Prisma.Decimal(p.isOrganizer ? organizerCents : baseCents).div(100) },
      });
    }
  }

  /** Envoi d'email best-effort : un échec est avalé, jamais propagé (ne casse pas le join). */
  private async safeNotify(fn: () => Promise<void>): Promise<void> {
    try { await fn(); }
    catch (err) { reportError(err, { source: 'safeNotify:openMatch' }); }
  }

  /** Sérialise une réservation-partie en DTO. Partagé par listOpenMatches et getOpenMatch. */
  private toDTO(
    m: MatchRow,
    levels: Record<string, UserLevel>,
    unreadCount: number,
    viewerUserId: string | null,
    club: { accentColor: string; logoUrl: string | null },
  ) {
    const maxPlayers = playerCount((m.resource.attributes as { format?: string } | null)?.format);
    const teamed = effectiveTeams(m.participants, maxPlayers);
    const sportKey = m.resource.clubSport.sport.key;
    const spotsLeft = Math.max(0, maxPlayers - m.participants.length);
    const players = teamed.map((p) => ({
      userId: p.userId, firstName: p.user.firstName, lastName: p.user.lastName, avatarUrl: p.user.avatarUrl, isOrganizer: p.isOrganizer,
      level: levels[`${p.userId}:${sportKey}`] ?? null,
      team: p.team,
      slot: p.slot,
    }));
    return {
      id: m.id,
      resourceName: m.resource.name,
      sport: { key: m.resource.clubSport.sport.key, name: m.resource.clubSport.sport.name },
      startTime: m.startTime.toISOString(),
      endTime: m.endTime.toISOString(),
      maxPlayers,
      spotsLeft,
      full: m.participants.length >= maxPlayers,
      viewerIsParticipant: viewerUserId != null && m.participants.some((p) => p.userId === viewerUserId),
      viewerIsOrganizer: viewerUserId != null && m.participants.some((p) => p.userId === viewerUserId && p.isOrganizer),
      targetLevelMin: m.targetLevelMin ?? null,
      targetLevelMax: m.targetLevelMax ?? null,
      competitive: m.competitive,
      players,
      lastMessageAt: m.openMatchMessages[0]?.createdAt.toISOString() ?? null,
      messageCount: m._count.openMatchMessages,
      unreadCount,
      // Hash d'état de la carte OG : versionne l'og:image et l'URL de partage (?s=).
      cardVersion: matchCardStateHash({
        players: players.map((p) => ({ userId: p.userId, team: p.team, slot: p.slot, avatarUrl: p.avatarUrl, level: p.level })),
        spotsLeft,
        targetLevelMin: m.targetLevelMin ?? null,
        targetLevelMax: m.targetLevelMax ?? null,
        startTime: m.startTime.toISOString(),
        endTime: m.endTime.toISOString(),
        resourceName: m.resource.name,
        accentColor: club.accentColor,
        logoUrl: club.logoUrl,
      }),
    };
  }

  /** Parties ouvertes à venir d'un club, visibles de tous (membre, non-membre ou anonyme). */
  async listOpenMatches(slug: string, viewerUserId: string | null) {
    const club = await this.resolveActiveClub(slug);
    const matches = await prisma.reservation.findMany({
      where: {
        visibility: 'PUBLIC',
        status: 'CONFIRMED',
        startTime: { gt: new Date() },
        resource: { clubId: club.id, clubSport: { sport: { key: 'padel' } } },
      },
      orderBy: { startTime: 'asc' },
      include: MATCH_INCLUDE,
    });

    // Collect (userId, sportKey) pairs — one per participant per match — for a single batched lookup.
    const pairs = matches.flatMap((m) =>
      m.participants.map((p) => ({ userId: p.userId, sportKey: m.resource.clubSport.sport.key })),
    );
    const levels = pairs.length > 0
      ? await this.ratingService.getLevelsBySport(pairs)
      : {};

    // Compteur de messages de chat non lus par partie (notifications serveur) — vide pour un visiteur anonyme.
    const unreadNotifs = viewerUserId != null
      ? await prisma.notification.findMany({
          where: { userId: viewerUserId, type: 'open_match.message', readAt: null, clubId: club.id },
          select: { data: true },
        })
      : [];
    const unreadByMatch = new Map<string, number>();
    for (const n of unreadNotifs) {
      const mid = (n.data as { matchId?: string } | null)?.matchId;
      if (mid) unreadByMatch.set(mid, (unreadByMatch.get(mid) ?? 0) + 1);
    }

    return matches.map((m) => this.toDTO(m, levels, unreadByMatch.get(m.id) ?? 0, viewerUserId, club));
  }

  /**
   * Agrégat public de la vitrine palova.fr : parties ouvertes padel à venir (14 jours)
   * des clubs ACTIVE ayant opté pour la publication nationale de leurs parties
   * (`listOpenMatchesNationally`), jamais pleines (la vitrine vend des places
   * à prendre). Miroir du calendrier national des tournois — la projection `club`
   * (slug/timezone/couleur/lat/lng) permet le lien cross-sous-domaine, la date au bon
   * fuseau et le tri/filtre par distance côté page /decouvrir.
   */
  async listNationalOpenMatches() {
    const now = new Date();
    const horizon = new Date(now.getTime() + 14 * 24 * 3_600_000);
    const matches = await prisma.reservation.findMany({
      where: {
        visibility: 'PUBLIC',
        status: 'CONFIRMED',
        startTime: { gt: now, lte: horizon },
        resource: { club: { status: 'ACTIVE', listOpenMatchesNationally: true }, clubSport: { sport: { key: 'padel' } } },
      },
      orderBy: { startTime: 'asc' },
      take: 120,
      include: NATIONAL_INCLUDE,
    });

    const pairs = matches.flatMap((m) =>
      m.participants.map((p) => ({ userId: p.userId, sportKey: m.resource.clubSport.sport.key })),
    );
    const levels = pairs.length > 0 ? await this.ratingService.getLevelsBySport(pairs) : {};

    return matches
      .map((m) => {
        const maxPlayers = playerCount((m.resource.attributes as { format?: string } | null)?.format);
        const sportKey = m.resource.clubSport.sport.key;
        return {
          id: m.id,
          resourceName: m.resource.name,
          sport: { key: sportKey, name: m.resource.clubSport.sport.name },
          startTime: m.startTime.toISOString(),
          endTime: m.endTime.toISOString(),
          maxPlayers,
          spotsLeft: Math.max(0, maxPlayers - m.participants.length),
          full: m.participants.length >= maxPlayers,
          targetLevelMin: m.targetLevelMin ?? null,
          targetLevelMax: m.targetLevelMax ?? null,
          competitive: m.competitive,
          players: effectiveTeams(m.participants, maxPlayers).map((p) => ({
            userId: p.userId, firstName: p.user.firstName, lastName: p.user.lastName, avatarUrl: p.user.avatarUrl,
            isOrganizer: p.isOrganizer, level: levels[`${p.userId}:${sportKey}`] ?? null, team: p.team, slot: p.slot,
          })),
          club: m.resource.club,
        };
      })
      .filter((m) => m.spotsLeft > 0)
      .slice(0, 60);
  }

  /** Lecture d'UNE partie ouverte (page /parties/[id]) — publique, autorise les parties passées. */
  async getOpenMatch(slug: string, id: string, viewerUserId: string | null) {
    const club = await this.resolveActiveClub(slug);
    const m = await prisma.reservation.findUnique({ where: { id }, include: MATCH_INCLUDE });
    if (
      !m ||
      m.visibility !== 'PUBLIC' ||
      m.status !== 'CONFIRMED' ||
      m.resource.clubId !== club.id ||
      m.resource.clubSport.sport.key !== 'padel'
    ) throw new Error('RESERVATION_NOT_FOUND');

    const sportKey = m.resource.clubSport.sport.key;
    const pairs = m.participants.map((p) => ({ userId: p.userId, sportKey }));
    const levels = pairs.length > 0 ? await this.ratingService.getLevelsBySport(pairs) : {};

    const unreadNotifs = viewerUserId != null
      ? await prisma.notification.findMany({
          where: { userId: viewerUserId, type: 'open_match.message', readAt: null, clubId: club.id },
          select: { data: true },
        })
      : [];
    const unreadCount = unreadNotifs.filter((n) => (n.data as { matchId?: string } | null)?.matchId === id).length;

    return this.toDTO(m, levels, unreadCount, viewerUserId, club);
  }

  /**
   * Rejoindre une partie ouverte : transaction Serializable + FOR UPDATE (anti sur-réservation).
   * `target` (tap sur une place libre) = place précise demandée, validée contre le layout
   * effectif — celui que le front affiche : TEAM_INVALID / TEAM_SIDE_FULL / TEAM_SLOT_TAKEN.
   * Sans `target`, comportement historique (team/slot null, dérivés à la lecture).
   */
  async joinOpenMatch(
    slug: string,
    reservationId: string,
    userId: string,
    target?: { team: number; slot?: number },
  ) {
    const club = await ensureActiveMembership(slug, userId);

    const result = await serializableTx(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ status: string; visibility: string; start_time: Date; resource_id: string; total_price: string }>>`
        SELECT status, visibility, start_time, resource_id, total_price FROM reservations WHERE id = ${reservationId} FOR UPDATE
      `;
      const r = locked[0];
      if (!r) throw new Error('RESERVATION_NOT_FOUND');

      const resource = await tx.resource.findUnique({ where: { id: r.resource_id }, select: { clubId: true, attributes: true } });
      if (!resource || resource.clubId !== club.id) throw new Error('CLUB_MISMATCH');
      if (r.visibility !== 'PUBLIC' || r.status !== 'CONFIRMED') throw new Error('MATCH_NOT_JOINABLE');
      if (new Date(r.start_time).getTime() <= Date.now()) throw new Error('MATCH_IN_PAST');

      const maxPlayers = playerCount((resource.attributes as { format?: string } | null)?.format);
      const parts = await tx.reservationParticipant.findMany({
        where: { reservationId },
        orderBy: { joinedAt: 'asc' },
        select: { id: true, userId: true, isOrganizer: true, team: true, slot: true },
      });
      if (parts.length >= maxPlayers) throw new Error('MATCH_FULL');
      if (parts.some((p) => p.userId === userId)) throw new Error('ALREADY_JOINED');

      // Place ciblée : validée contre le layout effectif (même dérivation que le DTO,
      // ordre joinedAt) — une place « libre » à l'écran l'est aussi ici, sinon course perdue.
      let placement: { team: number; slot: number | null } | undefined;
      if (target) {
        const half = Math.max(1, Math.floor(maxPlayers / 2));
        if (target.team !== 1 && target.team !== 2) throw new Error('TEAM_INVALID');
        if (target.slot !== undefined && (!Number.isInteger(target.slot) || target.slot < 0 || target.slot >= half)) throw new Error('TEAM_INVALID');
        const layout = effectiveTeams(parts, maxPlayers);
        if (layout.filter((p) => p.team === target.team).length >= half) throw new Error('TEAM_SIDE_FULL');
        if (target.slot !== undefined && layout.some((p) => p.team === target.team && p.slot === target.slot)) throw new Error('TEAM_SLOT_TAKEN');
        placement = { team: target.team, slot: target.slot ?? null };
      }

      const created = await tx.reservationParticipant.create({
        data: { reservationId, userId, isOrganizer: false, share: new Prisma.Decimal(0), ...(placement ?? {}) },
      });
      const priceCents = Math.round(Number(r.total_price) * 100);
      await this.applyShares(tx, [...parts.map((p) => ({ id: p.id, isOrganizer: p.isOrganizer })), { id: created.id, isOrganizer: false }], priceCents);
      return { id: reservationId };
    }, { timeout: 10_000 });

    // Après commit, best-effort : prévenir l'organisateur qu'un joueur a rejoint.
    // Fire-and-forget (pas de await) : un SMTP lent/injoignable ne doit jamais retarder
    // la réponse au joueur qui vient de rejoindre.
    void this.safeNotify(() => notifyOpenMatchJoin(reservationId, userId));
    return result;
  }

  /**
   * Retrait d'un joueur d'une partie ouverte.
   * - target == acteur : départ volontaire (« Quitter »).
   * - target ≠ acteur : seul l'organisateur peut retirer un autre joueur (NOT_ORGANIZER sinon).
   * On ne retire jamais l'organisateur (il annule la résa pour dissoudre la partie).
   */
  async removeOpenMatchPlayer(slug: string, reservationId: string, actorUserId: string, targetUserId: string) {
    const club = await this.resolveActiveMember(slug, actorUserId);

    const outcome = await serializableTx(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ start_time: Date; resource_id: string; total_price: string }>>`
        SELECT start_time, resource_id, total_price FROM reservations WHERE id = ${reservationId} FOR UPDATE
      `;
      const r = locked[0];
      if (!r) throw new Error('RESERVATION_NOT_FOUND');
      const resource = await tx.resource.findUnique({ where: { id: r.resource_id }, select: { clubId: true } });
      if (!resource || resource.clubId !== club.id) throw new Error('CLUB_MISMATCH');
      if (new Date(r.start_time).getTime() <= Date.now()) throw new Error('MATCH_IN_PAST');

      const parts = await tx.reservationParticipant.findMany({
        where: { reservationId },
        select: { id: true, userId: true, isOrganizer: true },
      });
      const actor = parts.find((p) => p.userId === actorUserId);
      if (!actor) throw new Error('PARTICIPANT_NOT_FOUND');
      const isSelf = actorUserId === targetUserId;
      if (!isSelf && !actor.isOrganizer) throw new Error('NOT_ORGANIZER');

      const target = parts.find((p) => p.userId === targetUserId);
      if (!target) throw new Error('PARTICIPANT_NOT_FOUND');
      if (target.isOrganizer) throw new Error(isSelf ? 'ORGANIZER_CANNOT_LEAVE' : 'CANNOT_REMOVE_ORGANIZER');

      await tx.reservationParticipant.delete({ where: { id: target.id } });
      const remaining = parts.filter((p) => p.id !== target.id).map((p) => ({ id: p.id, isOrganizer: p.isOrganizer }));
      await this.applyShares(tx, remaining, Math.round(Number(r.total_price) * 100));
      return { isSelf };
    }, { timeout: 10_000 });

    // Best-effort après commit, fire-and-forget : prévenir la bonne personne sans retarder la réponse.
    if (outcome.isSelf) void this.safeNotify(() => notifyOpenMatchLeft(reservationId, targetUserId));
    else                void this.safeNotify(() => notifyOpenMatchRemoved(reservationId, targetUserId));
    // Une place vient de se libérer : prévenir les alertes horaires correspondantes.
    void this.safeNotify(() => this.matchAlerts.matchAndNotify(reservationId).then(() => undefined));
    return { id: reservationId };
  }

  /**
   * Ajout d'un joueur à une partie ouverte par l'organisateur.
   * Seul l'organisateur peut ajouter (NOT_ORGANIZER sinon) ; la cible doit être membre ACTIVE.
   * Miroir du join : transaction Serializable + FOR UPDATE, recalcul des parts, notif best-effort.
   */
  async addOpenMatchPlayer(slug: string, reservationId: string, organizerUserId: string, targetUserId: string) {
    if (!targetUserId || typeof targetUserId !== 'string') throw new Error('VALIDATION_ERROR');

    const club = await this.resolveActiveMember(slug, organizerUserId);

    const result = await serializableTx(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ status: string; visibility: string; start_time: Date; resource_id: string; total_price: string }>>`
        SELECT status, visibility, start_time, resource_id, total_price FROM reservations WHERE id = ${reservationId} FOR UPDATE
      `;
      const r = locked[0];
      if (!r) throw new Error('RESERVATION_NOT_FOUND');

      const resource = await tx.resource.findUnique({ where: { id: r.resource_id }, select: { clubId: true, attributes: true } });
      if (!resource || resource.clubId !== club.id) throw new Error('CLUB_MISMATCH');
      if (r.visibility !== 'PUBLIC' || r.status !== 'CONFIRMED') throw new Error('MATCH_NOT_JOINABLE');
      if (new Date(r.start_time).getTime() <= Date.now()) throw new Error('MATCH_IN_PAST');

      const maxPlayers = playerCount((resource.attributes as { format?: string } | null)?.format);
      const parts = await tx.reservationParticipant.findMany({
        where: { reservationId },
        select: { id: true, userId: true, isOrganizer: true },
      });
      const actor = parts.find((p) => p.userId === organizerUserId);
      if (!actor || !actor.isOrganizer) throw new Error('NOT_ORGANIZER');

      const targetMembership = await tx.clubMembership.findUnique({
        where: { userId_clubId: { userId: targetUserId, clubId: club.id } },
        select: { status: true },
      });
      if (!targetMembership) throw new Error('MEMBERSHIP_REQUIRED');
      if (targetMembership.status === 'BLOCKED') throw new Error('MEMBERSHIP_BLOCKED');

      // ALREADY_JOINED avant MATCH_FULL (diagnostic plus clair quand la cible est déjà présente).
      if (parts.some((p) => p.userId === targetUserId)) throw new Error('ALREADY_JOINED');
      if (parts.length >= maxPlayers) throw new Error('MATCH_FULL');

      const created = await tx.reservationParticipant.create({
        data: { reservationId, userId: targetUserId, isOrganizer: false, share: new Prisma.Decimal(0) },
      });
      const priceCents = Math.round(Number(r.total_price) * 100);
      await this.applyShares(tx, [...parts.map((p) => ({ id: p.id, isOrganizer: p.isOrganizer })), { id: created.id, isOrganizer: false }], priceCents);
      return { id: reservationId };
    }, { timeout: 10_000 });

    void this.safeNotify(() => notifyOpenMatchAdded(reservationId, targetUserId));
    return result;
  }

  /** Réorganise les équipes (+ places G/D) d'une partie ouverte (organisateur seul). Transaction Serializable + FOR UPDATE. */
  async setTeams(slug: string, reservationId: string, organizerUserId: string, teams: Record<string, number>, slots?: Record<string, number>) {
    const club = await this.resolveActiveMember(slug, organizerUserId);
    await serializableTx(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ start_time: Date; resource_id: string }>>`
        SELECT start_time, resource_id FROM reservations WHERE id = ${reservationId} FOR UPDATE
      `;
      const r = locked[0];
      if (!r) throw new Error('RESERVATION_NOT_FOUND');
      const resource = await tx.resource.findUnique({ where: { id: r.resource_id }, select: { clubId: true, attributes: true } });
      if (!resource || resource.clubId !== club.id) throw new Error('CLUB_MISMATCH');
      const parts = await tx.reservationParticipant.findMany({ where: { reservationId }, select: { userId: true, isOrganizer: true } });
      const actor = parts.find((p) => p.userId === organizerUserId);
      if (!actor || !actor.isOrganizer) throw new Error('NOT_ORGANIZER');
      const maxPlayers = playerCount((resource.attributes as { format?: string } | null)?.format);
      await applyTeams(tx, reservationId, teams, maxPlayers, slots);
    }, { timeout: 10_000 });
    return { id: reservationId };
  }

  /** Quitter une partie ouverte (départ volontaire) — délègue au retrait unifié. */
  async leaveOpenMatch(slug: string, reservationId: string, userId: string) {
    return this.removeOpenMatchPlayer(slug, reservationId, userId, userId);
  }
}
