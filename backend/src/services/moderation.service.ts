import { ClubRole, ReportReason, ReportResolution, ReportStatus } from '@prisma/client';
import { prisma } from '../db/prisma';
import { OpenMatchChatService } from './openMatchChat.service';
import { MessagingService } from './messaging.service';
import { assertRateLimit } from './rateLimit';
import { dispatch } from './notification/dispatcher';
import { brandFromClub } from '../email/registry';
import { PALOVA_BRAND } from '../email/templates/layout';
import { clubAppUrl, formatDateFr, platformAsset } from '../email/links';
import { buildClubMessageReportEmail, buildPlatformMessageReportEmail } from '../email/templates/moderation';
import { EMAIL_CLUB_SELECT } from '../email/notifications';

const openMatchChatService = new OpenMatchChatService();
const messagingService = new MessagingService();

const REASONS = new Set<ReportReason>(['HARASSMENT', 'ILLEGAL', 'SPAM', 'OTHER']);

function normalizeReason(v: unknown): ReportReason {
  if (typeof v !== 'string' || !REASONS.has(v as ReportReason)) throw new Error('VALIDATION_ERROR');
  return v as ReportReason;
}

function normalizeDetail(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v !== 'string') throw new Error('VALIDATION_ERROR');
  const trimmed = v.trim();
  if (trimmed.length > 500) throw new Error('VALIDATION_ERROR');
  return trimmed || null;
}

function normalizeStatusFilter(v?: string): ReportStatus | undefined {
  return v === 'OPEN' || v === 'RESOLVED' ? v : undefined;
}

function excerptOf(body: string): string {
  return body.length > 280 ? body.slice(0, 277) + '…' : body;
}

export interface ReportedByDTO { id: string; firstName: string; lastName: string }

export interface ClubReportRow {
  id: string; reason: ReportReason; detail: string | null; status: ReportStatus; resolution: ReportResolution | null;
  createdAt: string; resolvedAt: string | null;
  reporter: ReportedByDTO;
  message: { id: string; body: string; deleted: boolean; createdAt: string; author: ReportedByDTO };
  match: { reservationId: string; startTime: string; resourceName: string };
}

export interface PlatformReportRow {
  id: string; reason: ReportReason; detail: string | null; status: ReportStatus; resolution: ReportResolution | null;
  createdAt: string; resolvedAt: string | null;
  reporter: ReportedByDTO;
  message: { id: string; body: string; deleted: boolean; createdAt: string; author: ReportedByDTO; hasImage: boolean };
  conversationId: string;
}

const CLUB_REPORT_INCLUDE = {
  reporter: { select: { id: true, firstName: true, lastName: true } },
  openMatchMessage: {
    select: {
      id: true, body: true, createdAt: true, deletedAt: true, reservationId: true,
      user: { select: { id: true, firstName: true, lastName: true } },
      reservation: { select: { startTime: true, resource: { select: { name: true } } } },
    },
  },
} as const;

type ClubReportSrc = {
  id: string; reason: ReportReason; detail: string | null; status: ReportStatus; resolution: ReportResolution | null;
  createdAt: Date; resolvedAt: Date | null;
  reporter: { id: string; firstName: string; lastName: string };
  openMatchMessage: {
    id: string; body: string; createdAt: Date; deletedAt: Date | null; reservationId: string;
    user: { id: string; firstName: string; lastName: string };
    reservation: { startTime: Date; resource: { name: string } };
  } | null;
};

function toClubReportRow(r: ClubReportSrc): ClubReportRow {
  const m = r.openMatchMessage!;
  return {
    id: r.id, reason: r.reason, detail: r.detail, status: r.status, resolution: r.resolution,
    createdAt: r.createdAt.toISOString(), resolvedAt: r.resolvedAt?.toISOString() ?? null,
    reporter: r.reporter,
    // body TOUJOURS visible (même supprimé) : vue staff de modération, pas le chat public —
    // le contenu réel du message signalé doit rester consultable pour l'audit/la décision.
    message: { id: m.id, body: m.body, deleted: m.deletedAt != null, createdAt: m.createdAt.toISOString(), author: m.user },
    match: { reservationId: m.reservationId, startTime: m.reservation.startTime.toISOString(), resourceName: m.reservation.resource.name },
  };
}

const PLATFORM_REPORT_INCLUDE = {
  reporter: { select: { id: true, firstName: true, lastName: true } },
  directMessage: {
    select: {
      id: true, body: true, imageUrl: true, createdAt: true, deletedAt: true, conversationId: true,
      author: { select: { id: true, firstName: true, lastName: true } },
    },
  },
} as const;

type PlatformReportSrc = {
  id: string; reason: ReportReason; detail: string | null; status: ReportStatus; resolution: ReportResolution | null;
  createdAt: Date; resolvedAt: Date | null;
  reporter: { id: string; firstName: string; lastName: string };
  directMessage: {
    id: string; body: string; imageUrl: string | null; createdAt: Date; deletedAt: Date | null; conversationId: string;
    author: { id: string; firstName: string; lastName: string };
  } | null;
};

function toPlatformReportRow(r: PlatformReportSrc): PlatformReportRow {
  const m = r.directMessage!;
  return {
    id: r.id, reason: r.reason, detail: r.detail, status: r.status, resolution: r.resolution,
    createdAt: r.createdAt.toISOString(), resolvedAt: r.resolvedAt?.toISOString() ?? null,
    reporter: r.reporter,
    // body TOUJOURS visible (même supprimé) : vue superadmin de modération, pas le fil privé —
    // hasImage reste conditionné à deletedAt car le FICHIER est réellement effacé du disque
    // à la suppression (unlinkImage), contrairement au texte qui reste en base.
    message: {
      id: m.id, body: m.body, deleted: m.deletedAt != null, createdAt: m.createdAt.toISOString(),
      author: m.author, hasImage: !m.deletedAt && !!m.imageUrl,
    },
    conversationId: m.conversationId,
  };
}

export class ModerationService {
  // ---------------------------------------------------------- Chat de partie ouverte

  async reportOpenMatchMessage(
    slug: string, reservationId: string, messageId: string, reporterId: string,
    input: { reason: unknown; detail: unknown },
  ): Promise<{ id: string }> {
    await openMatchChatService.assertChatAccessPublic(slug, reservationId, reporterId);
    await assertRateLimit('report', reporterId, 10, 3600);

    const msg = await prisma.openMatchMessage.findUnique({
      where: { id: messageId },
      select: { id: true, reservationId: true, userId: true, deletedAt: true },
    });
    if (!msg || msg.reservationId !== reservationId || msg.deletedAt) throw new Error('MESSAGE_NOT_FOUND');
    if (msg.userId === reporterId) throw new Error('VALIDATION_ERROR');

    const reason = normalizeReason(input.reason);
    const detail = normalizeDetail(input.detail);

    const resa = await prisma.reservation.findUnique({ where: { id: reservationId }, select: { resource: { select: { clubId: true } } } });
    const clubId = resa!.resource.clubId;

    let report: { id: string };
    try {
      report = await prisma.messageReport.create({ data: { openMatchMessageId: messageId, reporterId, clubId, reason, detail } });
    } catch (err) {
      if ((err as { code?: string }).code !== 'P2002') throw err;
      report = await prisma.messageReport.findUniqueOrThrow({
        where: { openMatchMessageId_reporterId: { openMatchMessageId: messageId, reporterId } },
      });
    }
    this.notifyClubStaff(clubId, messageId).catch((e) => console.error('[moderation] notification club échouée', e));
    return { id: report.id };
  }

  private async notifyClubStaff(clubId: string, messageId: string): Promise<void> {
    const msg = await prisma.openMatchMessage.findUnique({
      where: { id: messageId },
      select: {
        body: true, user: { select: { firstName: true, lastName: true } },
        reservation: { select: { startTime: true, resource: { select: { name: true } } } },
      },
    });
    if (!msg) return;
    const club = await prisma.club.findUnique({ where: { id: clubId }, select: EMAIL_CLUB_SELECT });
    if (!club) return;
    const staff = await prisma.clubMember.findMany({
      where: { clubId, role: { in: [ClubRole.OWNER, ClubRole.ADMIN] } },
      select: { user: { select: { id: true, email: true } } },
    });
    if (!staff.length) return;
    const brand = brandFromClub(club);
    const authorName = `${msg.user.firstName} ${msg.user.lastName}`.trim();
    const url = clubAppUrl(club.slug, '/admin/moderation');
    const mail = buildClubMessageReportEmail({
      authorName,
      excerpt: excerptOf(msg.body),
      court: msg.reservation.resource.name,
      when: formatDateFr(msg.reservation.startTime, club.timezone),
      url,
      brand,
    });
    for (const s of staff) {
      await dispatch({
        userId: s.user.id,
        clubId,
        category: 'MODERATION',
        type: 'moderation.report',
        title: 'Nouveau signalement',
        body: `Message de ${authorName} signalé dans le chat d'une partie (${msg.reservation.resource.name}).`,
        url,
        email: s.user.email ? { to: s.user.email, subject: mail.subject, html: mail.html, text: mail.text } : null,
      });
    }
  }

  async listClubReports(clubId: string, opts: { status?: string } = {}): Promise<ClubReportRow[]> {
    const status = normalizeStatusFilter(opts.status);
    const rows = await prisma.messageReport.findMany({
      where: { clubId, openMatchMessageId: { not: null }, ...(status ? { status } : {}) },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: CLUB_REPORT_INCLUDE,
    });
    return rows.map((r) => toClubReportRow(r as ClubReportSrc));
  }

  private async fetchClubReport(reportId: string): Promise<ClubReportRow> {
    const r = await prisma.messageReport.findUniqueOrThrow({ where: { id: reportId }, include: CLUB_REPORT_INCLUDE });
    return toClubReportRow(r as ClubReportSrc);
  }

  async resolveClubReport(clubId: string, reportId: string, moderatorUserId: string, action: 'DELETE' | 'REJECT'): Promise<ClubReportRow> {
    const report = await prisma.messageReport.findUnique({
      where: { id: reportId },
      select: { id: true, clubId: true, openMatchMessageId: true, status: true },
    });
    if (!report || report.clubId !== clubId || !report.openMatchMessageId) throw new Error('REPORT_NOT_FOUND');

    if (report.status !== 'RESOLVED') {
      const resolution: ReportResolution = action === 'DELETE' ? 'DELETED' : 'REJECTED';
      await prisma.messageReport.updateMany({
        where: { openMatchMessageId: report.openMatchMessageId, status: 'OPEN' },
        data: { status: 'RESOLVED', resolution, resolvedById: moderatorUserId, resolvedAt: new Date() },
      });
      if (action === 'DELETE') {
        const msg = await prisma.openMatchMessage.findUnique({
          where: { id: report.openMatchMessageId },
          select: { reservationId: true, deletedAt: true },
        });
        if (msg && !msg.deletedAt) {
          const club = await prisma.club.findUnique({ where: { id: clubId }, select: { slug: true } });
          if (club) await openMatchChatService.deleteMessage(club.slug, msg.reservationId, moderatorUserId, report.openMatchMessageId);
        }
      }
    }
    return this.fetchClubReport(reportId);
  }

  // ---------------------------------------------------------- Messagerie privée

  async reportDirectMessage(
    conversationId: string, messageId: string, reporterId: string,
    input: { reason: unknown; detail: unknown },
  ): Promise<{ id: string }> {
    await messagingService.assertParticipantPublic(conversationId, reporterId);
    await assertRateLimit('report', reporterId, 10, 3600);

    const msg = await prisma.directMessage.findUnique({
      where: { id: messageId },
      select: { id: true, conversationId: true, authorId: true, deletedAt: true },
    });
    if (!msg || msg.conversationId !== conversationId || msg.deletedAt) throw new Error('MESSAGE_NOT_FOUND');
    if (msg.authorId === reporterId) throw new Error('VALIDATION_ERROR');

    const reason = normalizeReason(input.reason);
    const detail = normalizeDetail(input.detail);

    const conv = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { clubId: true } });

    let report: { id: string };
    try {
      report = await prisma.messageReport.create({ data: { directMessageId: messageId, reporterId, clubId: conv?.clubId ?? null, reason, detail } });
    } catch (err) {
      if ((err as { code?: string }).code !== 'P2002') throw err;
      report = await prisma.messageReport.findUniqueOrThrow({
        where: { directMessageId_reporterId: { directMessageId: messageId, reporterId } },
      });
    }
    this.notifySuperAdmins(messageId).catch((e) => console.error('[moderation] notification superadmin échouée', e));
    return { id: report.id };
  }

  private async notifySuperAdmins(messageId: string): Promise<void> {
    const msg = await prisma.directMessage.findUnique({
      where: { id: messageId },
      select: { body: true, imageUrl: true, author: { select: { firstName: true, lastName: true } } },
    });
    if (!msg) return;
    const admins = await prisma.user.findMany({ where: { isSuperAdmin: true, deletedAt: null }, select: { id: true, email: true } });
    if (!admins.length) return;
    const authorName = `${msg.author.firstName} ${msg.author.lastName}`.trim();
    const url = platformAsset('/superadmin/moderation');
    const mail = buildPlatformMessageReportEmail({
      authorName,
      excerpt: excerptOf(msg.body),
      hasImage: !!msg.imageUrl,
      url,
      brand: PALOVA_BRAND,
    });
    for (const admin of admins) {
      await dispatch({
        userId: admin.id,
        clubId: null,
        category: 'MODERATION',
        type: 'moderation.report_dm',
        title: 'Nouveau signalement (message privé)',
        body: `Message privé de ${authorName} signalé.`,
        url,
        email: admin.email ? { to: admin.email, subject: mail.subject, html: mail.html, text: mail.text } : null,
      });
    }
  }

  async listPlatformReports(opts: { status?: string } = {}): Promise<PlatformReportRow[]> {
    const status = normalizeStatusFilter(opts.status);
    const rows = await prisma.messageReport.findMany({
      where: { directMessageId: { not: null }, ...(status ? { status } : {}) },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: PLATFORM_REPORT_INCLUDE,
    });
    return rows.map((r) => toPlatformReportRow(r as PlatformReportSrc));
  }

  private async fetchPlatformReport(reportId: string): Promise<PlatformReportRow> {
    const r = await prisma.messageReport.findUniqueOrThrow({ where: { id: reportId }, include: PLATFORM_REPORT_INCLUDE });
    return toPlatformReportRow(r as PlatformReportSrc);
  }

  async resolvePlatformReport(reportId: string, superAdminUserId: string, action: 'DELETE' | 'REJECT'): Promise<PlatformReportRow> {
    const report = await prisma.messageReport.findUnique({
      where: { id: reportId },
      select: { id: true, directMessageId: true, status: true },
    });
    if (!report || !report.directMessageId) throw new Error('REPORT_NOT_FOUND');

    if (report.status !== 'RESOLVED') {
      const resolution: ReportResolution = action === 'DELETE' ? 'DELETED' : 'REJECTED';
      await prisma.messageReport.updateMany({
        where: { directMessageId: report.directMessageId, status: 'OPEN' },
        data: { status: 'RESOLVED', resolution, resolvedById: superAdminUserId, resolvedAt: new Date() },
      });
      if (action === 'DELETE') {
        const msg = await prisma.directMessage.findUnique({ where: { id: report.directMessageId }, select: { conversationId: true, deletedAt: true } });
        if (msg && !msg.deletedAt) await messagingService.deleteMessageAsModerator(msg.conversationId, report.directMessageId, superAdminUserId);
      }
    }
    return this.fetchPlatformReport(reportId);
  }

  async platformReportImagePath(reportId: string): Promise<{ absPath: string; mime: string }> {
    const report = await prisma.messageReport.findUnique({ where: { id: reportId }, select: { directMessageId: true } });
    if (!report?.directMessageId) throw new Error('MESSAGE_NOT_FOUND');
    return messagingService.imagePathForModerator(report.directMessageId);
  }
}
