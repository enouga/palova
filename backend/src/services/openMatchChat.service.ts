import { prisma } from '../db/prisma';
import { SSEService } from './sse.service';
import { notifyOpenMatchChatMessage } from '../email/notifications';
import { ensureActiveMembership } from './membership';

const MAX_BODY = 2000;

export interface ChatMessageDTO {
  id: string;
  author: { userId: string; firstName: string; lastName: string; avatarUrl: string | null };
  body: string;
  createdAt: string;
  deleted: boolean;
}

interface ChatContext {
  clubId: string;
  isParticipant: boolean;
  isOrganizer: boolean;
}

type MsgRow = {
  id: string; body: string; createdAt: Date; deletedAt: Date | null;
  user: { id: string; firstName: string; lastName: string; avatarUrl: string | null };
};

function toDTO(m: MsgRow): ChatMessageDTO {
  const deleted = m.deletedAt != null;
  return {
    id: m.id,
    author: { userId: m.user.id, firstName: m.user.firstName, lastName: m.user.lastName, avatarUrl: m.user.avatarUrl },
    body: deleted ? '' : m.body,
    createdAt: m.createdAt.toISOString(),
    deleted,
  };
}

export class OpenMatchChatService {
  /** Accès au chat : adhésion ACTIVE (créée à la volée, refus BLOCKED) + résa PUBLIC/CONFIRMED.
   *  Ouvert à tout utilisateur connecté du club — plus de condition participant/intéressé. */
  private async assertChatAccess(slug: string, reservationId: string, userId: string): Promise<ChatContext> {
    const { id: clubId } = await ensureActiveMembership(slug, userId);

    const resa = await prisma.reservation.findUnique({
      where: { id: reservationId },
      select: {
        visibility: true, status: true,
        resource: { select: { clubId: true } },
        participants: { select: { userId: true, isOrganizer: true } },
      },
    });
    if (!resa || resa.resource.clubId !== clubId) throw new Error('RESERVATION_NOT_FOUND');
    if (resa.visibility !== 'PUBLIC' || resa.status !== 'CONFIRMED') throw new Error('MATCH_NOT_JOINABLE');

    const part = resa.participants.find((p) => p.userId === userId);
    return { clubId, isParticipant: !!part, isOrganizer: !!part?.isOrganizer };
  }

  /** Variante publique de la garde d'accès, pour la route SSE (lève si pas d'accès). */
  async assertChatAccessPublic(slug: string, reservationId: string, userId: string): Promise<void> {
    await this.assertChatAccess(slug, reservationId, userId);
  }

  /** Fil chronologique (messages supprimés en pierre tombale). */
  async listMessages(slug: string, reservationId: string, userId: string): Promise<ChatMessageDTO[]> {
    await this.assertChatAccess(slug, reservationId, userId);
    const rows = await prisma.openMatchMessage.findMany({
      where: { reservationId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, body: true, createdAt: true, deletedAt: true,
        user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
      },
    });
    return rows.map(toDTO);
  }

  /** Poste un message : valide, crée, diffuse en SSE, notifie les absents (best-effort). */
  async postMessage(slug: string, reservationId: string, userId: string, rawBody: string): Promise<ChatMessageDTO> {
    await this.assertChatAccess(slug, reservationId, userId);
    const body = (rawBody ?? '').trim();
    if (!body || body.length > MAX_BODY) throw new Error('VALIDATION_ERROR');

    const created = await prisma.openMatchMessage.create({
      data: { reservationId, userId, body },
      select: {
        id: true, body: true, createdAt: true, deletedAt: true,
        user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
      },
    });
    const dto = toDTO(created);
    SSEService.getInstance().broadcastMatch(reservationId, { type: 'chat_message', message: dto });
    try { await notifyOpenMatchChatMessage(reservationId, created.id, userId); }
    catch (err) { console.error('[openMatchChat] notification échouée', err); }
    return dto;
  }

  /** Marque lus les messages de chat de cette partie pour l'utilisateur (notifications serveur). */
  async markRead(_slug: string, reservationId: string, userId: string): Promise<{ count: number }> {
    const res = await prisma.notification.updateMany({
      where: { userId, type: 'open_match.message', readAt: null, data: { path: ['matchId'], equals: reservationId } } as any,
      data: { readAt: new Date() },
    });
    return { count: res.count };
  }

  /** Nombre total de messages de chat non lus du club pour l'utilisateur (badge de l'onglet). */
  async unreadCount(slug: string, userId: string): Promise<{ count: number }> {
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true } });
    if (!club) return { count: 0 };
    const count = await prisma.notification.count({
      where: { userId, type: 'open_match.message', readAt: null, clubId: club.id },
    });
    return { count };
  }

  /** Supprime un message : auteur, organisateur de la partie, ou staff OWNER/ADMIN du club.
   *  N'exige PAS d'être participant/intéressé (un modérateur du club peut agir). */
  async deleteMessage(slug: string, reservationId: string, userId: string, messageId: string): Promise<ChatMessageDTO> {
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, status: true } });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');

    const resa = await prisma.reservation.findUnique({
      where: { id: reservationId },
      select: {
        resource: { select: { clubId: true } },
        participants: { select: { userId: true, isOrganizer: true } },
      },
    });
    if (!resa || resa.resource.clubId !== club.id) throw new Error('RESERVATION_NOT_FOUND');

    const msg = await prisma.openMatchMessage.findUnique({
      where: { id: messageId },
      select: {
        id: true, reservationId: true, userId: true, body: true, createdAt: true, deletedAt: true,
        user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
      },
    });
    if (!msg || msg.reservationId !== reservationId) throw new Error('MESSAGE_NOT_FOUND');

    const isAuthor = msg.userId === userId;
    const isOrganizer = resa.participants.some((p) => p.isOrganizer && p.userId === userId);
    let allowed = isAuthor || isOrganizer;
    if (!allowed) {
      const staff = await prisma.clubMember.findFirst({
        where: { userId, clubId: club.id, role: { in: ['OWNER', 'ADMIN'] } },
        select: { id: true },
      });
      allowed = !!staff;
    }
    if (!allowed) throw new Error('NOT_ALLOWED');

    if (msg.deletedAt) return toDTO(msg); // déjà supprimé : idempotent, pas de re-broadcast

    const updated = await prisma.openMatchMessage.update({
      where: { id: messageId },
      data: { deletedAt: new Date(), deletedById: userId },
      select: {
        id: true, body: true, createdAt: true, deletedAt: true,
        user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
      },
    });
    const dto = toDTO(updated);
    SSEService.getInstance().broadcastMatch(reservationId, { type: 'chat_deleted', message: dto });
    return dto;
  }
}
