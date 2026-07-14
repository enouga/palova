import { DateTime } from 'luxon';
import { prisma } from '../db/prisma';
import { playerCount } from '../utils/courtType';
import { RatingService } from './rating.service';
import { inRange } from './rating/range';
import { dispatch } from './notification/dispatcher';
import { renderClubEmail, brandFromClub } from '../email/registry';
import { emailTemplates } from './emailTemplate.service';
import { clubAppUrl, formatDateRangeFr } from '../email/links';
import { placesPhrase, levelRangeLabel, EMAIL_CLUB_SELECT } from '../email/notifications';

export const MAX_ACTIVE_ALERTS = 5;
export const MAX_WINDOW_DAYS = 7;
export const MAX_LEAD_DAYS = 30;

export interface AlertWindowInput { date: string; from: string; to: string; } // date=YYYY-MM-DD, from/to=HH:mm (heure du club)

interface AlertDTO { id: string; windowStart: string; windowEnd: string; }

const toDTO = (a: { id: string; windowStart: Date; windowEnd: Date }): AlertDTO => ({
  id: a.id, windowStart: a.windowStart.toISOString(), windowEnd: a.windowEnd.toISOString(),
});

export class MatchAlertService {
  private ratingService = new RatingService();

  /** Résout un club ACTIVE + garantit l'adhésion (créée si absente, refus BLOCKED). */
  private async resolveClub(slug: string, userId: string): Promise<{ id: string; timezone: string }> {
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, status: true, timezone: true } });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    const member = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId, clubId: club.id } }, select: { status: true },
    });
    if (member?.status === 'BLOCKED') throw new Error('MEMBERSHIP_BLOCKED');
    if (!member) await prisma.clubMembership.create({ data: { userId, clubId: club.id } });
    return { id: club.id, timezone: club.timezone };
  }

  async create(slug: string, userId: string, input: AlertWindowInput): Promise<AlertDTO> {
    const club = await this.resolveClub(slug, userId);

    const start = DateTime.fromISO(`${input.date}T${input.from}`, { zone: club.timezone });
    const end   = DateTime.fromISO(`${input.date}T${input.to}`,   { zone: club.timezone });
    if (!start.isValid || !end.isValid || end <= start) throw new Error('ALERT_WINDOW_INVALID');

    const now = DateTime.now().setZone(club.timezone);
    if (end <= now) throw new Error('ALERT_WINDOW_INVALID');                       // fenêtre déjà passée
    if (end.diff(start, 'days').days > MAX_WINDOW_DAYS) throw new Error('ALERT_WINDOW_INVALID');
    if (start.diff(now, 'days').days > MAX_LEAD_DAYS) throw new Error('ALERT_WINDOW_INVALID');

    const active = await prisma.matchAlert.count({ where: { userId, clubId: club.id, windowEnd: { gt: new Date() } } });
    if (active >= MAX_ACTIVE_ALERTS) throw new Error('ALERT_LIMIT_REACHED');

    const created = await prisma.matchAlert.create({
      data: { userId, clubId: club.id, windowStart: start.toUTC().toJSDate(), windowEnd: end.toUTC().toJSDate() },
      select: { id: true, windowStart: true, windowEnd: true },
    });
    return toDTO(created);
  }

  async listMine(slug: string, userId: string): Promise<AlertDTO[]> {
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, status: true } });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    const rows = await prisma.matchAlert.findMany({
      where: { clubId: club.id, userId, windowEnd: { gt: new Date() } },
      orderBy: { windowStart: 'asc' },
      select: { id: true, windowStart: true, windowEnd: true },
    });
    return rows.map(toDTO);
  }

  async remove(slug: string, userId: string, alertId: string): Promise<{ ok: true }> {
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true } });
    if (!club) throw new Error('CLUB_NOT_FOUND');
    await prisma.matchAlert.deleteMany({ where: { id: alertId, userId, clubId: club.id } });
    return { ok: true };
  }

  /** Purge les alertes expirées (appelé par le job minute). */
  async purgeExpired(): Promise<number> {
    const res = await prisma.matchAlert.deleteMany({ where: { windowEnd: { lt: new Date() } } });
    return res.count;
  }

  /**
   * Notifie les titulaires d'alertes actives dont la fenêtre CONTIENT cette partie
   * (padel, PUBLIC/CONFIRMED, à venir, ≥1 place). Niveau : fourchette contenant le
   * niveau connu, OU partie sans fourchette (ouverte à tous → tout le monde). Crée un
   * hit par (alerte, partie) pour ne jamais re-notifier. Renvoie les userId notifiés
   * (pour dédupliquer avec notifyOpenMatchProposed). Best-effort par destinataire.
   */
  async matchAndNotify(reservationId: string): Promise<string[]> {
    const resa = await prisma.reservation.findUnique({
      where: { id: reservationId },
      select: {
        id: true, status: true, visibility: true, startTime: true, endTime: true,
        targetLevelMin: true, targetLevelMax: true,
        resource: {
          select: {
            clubId: true, name: true, attributes: true,
            club: { select: EMAIL_CLUB_SELECT },
            clubSport: { select: { sport: { select: { key: true } } } },
          },
        },
        participants: { select: { userId: true } },
      },
    });
    if (!resa) return [];

    // Auto-garde : uniquement une vraie partie ouverte padel, à venir, avec place libre.
    const sportKey = resa.resource.clubSport.sport.key;
    if (resa.visibility !== 'PUBLIC' || resa.status !== 'CONFIRMED' || sportKey !== 'padel') return [];
    if (resa.startTime.getTime() <= Date.now()) return [];
    const maxPlayers = playerCount((resa.resource.attributes as { format?: string } | null)?.format);
    if (maxPlayers - resa.participants.length <= 0) return [];

    // Alertes actives du club dont la fenêtre CONTIENT entièrement la partie.
    const alerts = await prisma.matchAlert.findMany({
      where: {
        clubId: resa.resource.clubId,
        windowStart: { lte: resa.startTime },
        windowEnd:   { gte: resa.endTime },
      },
      select: { id: true, userId: true },
    });
    if (alerts.length === 0) return [];

    // Retire l'organisateur / participants présents.
    const present = new Set(resa.participants.map((p) => p.userId));
    let candidates = alerts.filter((a) => !present.has(a.userId));
    if (candidates.length === 0) return [];

    // Retire les alertes déjà notifiées pour cette partie (hit existant).
    const hits = await prisma.matchAlertHit.findMany({
      where: { reservationId, alertId: { in: candidates.map((a) => a.id) } },
      select: { alertId: true },
    });
    const hitSet = new Set(hits.map((h) => h.alertId));
    candidates = candidates.filter((a) => !hitSet.has(a.id));
    if (candidates.length === 0) return [];

    // Ne garde que les membres ACTIVE (un BLOCKED / retiré ne reçoit rien).
    const userIds = [...new Set(candidates.map((a) => a.userId))];
    const active = await prisma.clubMembership.findMany({
      where: { clubId: resa.resource.clubId, status: 'ACTIVE', userId: { in: userIds } },
      select: { userId: true },
    });
    const activeSet = new Set(active.map((m) => m.userId));

    // Niveaux (batch). Sans fourchette → tout le monde ; avec fourchette → niveau connu in-range.
    const levels = await this.ratingService.getLevelsBySport(userIds.map((userId) => ({ userId, sportKey })));
    const min = resa.targetLevelMin, max = resa.targetLevelMax;
    const levelOk = (userId: string): boolean => {
      if (min == null && max == null) return true;
      const lvl = levels[`${userId}:${sportKey}`]?.level ?? null;
      return lvl != null && inRange(lvl, min, max);
    };

    // Regroupe par utilisateur retenu : hits pour TOUTES ses alertes couvrantes, 1 notif.
    const keep = candidates.filter((a) => activeSet.has(a.userId) && levelOk(a.userId));
    if (keep.length === 0) return [];

    await prisma.matchAlertHit.createMany({
      data: keep.map((a) => ({ alertId: a.id, reservationId })),
      skipDuplicates: true,
    });

    const club = resa.resource.club;
    const brand = brandFromClub(club);
    const dateLabel = formatDateRangeFr(resa.startTime, resa.endTime, club.timezone);
    const levelLabel = levelRangeLabel(min, max);
    const spotsLeft = maxPlayers - resa.participants.length;
    const url = clubAppUrl(club.slug, `/parties/${resa.id}`);
    const override = await emailTemplates.getOverride(club.id, 'open_match.alert');

    // Une notif par utilisateur retenu (on a besoin de son prénom/email → requête légère).
    const notifyIds = [...new Set(keep.map((a) => a.userId))];
    const users = await prisma.user.findMany({
      where: { id: { in: notifyIds } },
      select: { id: true, firstName: true, email: true },
    });

    const notified: string[] = [];
    for (const u of users) {
      if (!u.email) continue;
      const mail = renderClubEmail('open_match.alert', {
        prenom: u.firstName, terrain: resa.resource.name, date: dateLabel,
        club: club.name, niveau: levelLabel, phrase_places: placesPhrase(spotsLeft), lien: url,
      }, brand, override);
      try {
        await dispatch({
          userId: u.id, clubId: club.id, category: 'MY_GAMES', type: 'open_match.alert',
          title: 'Une partie correspond à ton alerte',
          body: `Une partie ouverte du ${dateLabel} correspond à ton alerte.`,
          url, data: { matchId: resa.id },
          email: { to: u.email, subject: mail.subject, html: mail.html, text: mail.text },
        });
        notified.push(u.id);
      } catch (err) {
        console.error('[matchAndNotify] envoi destinataire échoué', { userId: u.id, err });
      }
    }
    return notified;
  }
}
