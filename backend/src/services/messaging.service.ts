import { prisma } from '../db/prisma';
import { SSEService } from './sse.service';
import { notifyDirectMessage } from '../email/notifications';

const MAX_BODY = 2000;
const PAGE_DEFAULT = 50;
const PAGE_MAX = 100;

export interface DmUser { userId: string; firstName: string; lastName: string; avatarUrl: string | null }
export interface DmReactionDTO { emoji: string; userIds: string[] }
export interface DmMessageDTO {
  id: string; author: DmUser; body: string; imageUrl: string | null;
  createdAt: string; deleted: boolean; reactions: DmReactionDTO[];
}
export interface ConversationSummaryDTO {
  id: string; other: DmUser; clubId: string | null; lastMessageAt: string | null;
  unreadCount: number;
  lastMessage: { body: string; hasImage: boolean; mine: boolean; deleted: boolean } | null;
}
export interface DmListMeta { myLastReadAt: string | null; otherLastReadAt: string | null; blocked: boolean; hasMore: boolean }

/** Paire canonique (comme Friendship) : une seule conversation par paire. */
function canonical(a: string, b: string): { userAId: string; userBId: string } {
  return a < b ? { userAId: a, userBId: b } : { userAId: b, userBId: a };
}

const USER_SELECT = { id: true, firstName: true, lastName: true, avatarUrl: true } as const;
const MSG_SELECT = {
  id: true, body: true, imageUrl: true, createdAt: true, deletedAt: true,
  author: { select: USER_SELECT },
  reactions: { select: { emoji: true, userId: true } },
} as const;

type MsgRow = {
  id: string; body: string; imageUrl: string | null; createdAt: Date; deletedAt: Date | null;
  author: { id: string; firstName: string; lastName: string; avatarUrl: string | null };
  reactions: { emoji: string; userId: string }[];
};

function toUser(u: { id: string; firstName: string; lastName: string; avatarUrl: string | null }): DmUser {
  return { userId: u.id, firstName: u.firstName, lastName: u.lastName, avatarUrl: u.avatarUrl };
}

function toMessageDTO(m: MsgRow): DmMessageDTO {
  const deleted = m.deletedAt != null;
  const byEmoji = new Map<string, string[]>();
  if (!deleted) for (const r of m.reactions) {
    if (!byEmoji.has(r.emoji)) byEmoji.set(r.emoji, []);
    byEmoji.get(r.emoji)!.push(r.userId);
  }
  return {
    id: m.id,
    author: toUser(m.author),
    body: deleted ? '' : m.body,
    imageUrl: deleted ? null : m.imageUrl,
    createdAt: m.createdAt.toISOString(),
    deleted,
    reactions: [...byEmoji.entries()].map(([emoji, userIds]) => ({ emoji, userIds })),
  };
}

export class MessagingService {
  /** Club ACTIF où les deux sont membres ACTIFS (slug préféré honoré s'il convient), sinon NOT_CO_MEMBERS. */
  private async sharedActiveClubId(a: string, b: string, preferredSlug?: string | null): Promise<string> {
    if (preferredSlug) {
      const club = await prisma.club.findUnique({ where: { slug: preferredSlug }, select: { id: true, status: true } });
      if (club?.status === 'ACTIVE') {
        const both = await prisma.clubMembership.count({ where: { clubId: club.id, status: 'ACTIVE', userId: { in: [a, b] } } });
        if (both === 2) return club.id;
      }
    }
    const mine = await prisma.clubMembership.findMany({ where: { userId: a, status: 'ACTIVE' }, select: { clubId: true } });
    const shared = mine.length === 0 ? null : await prisma.clubMembership.findFirst({
      where: { userId: b, status: 'ACTIVE', clubId: { in: mine.map((m) => m.clubId) }, club: { status: 'ACTIVE' } },
      select: { clubId: true },
    });
    if (!shared) throw new Error('NOT_CO_MEMBERS');
    return shared.clubId;
  }

  /** Blocage dans un sens OU l'autre → USER_BLOCKED (générique, sens non révélé). */
  private async assertNotBlocked(a: string, b: string): Promise<void> {
    if (await this.pairBlocked(a, b)) throw new Error('USER_BLOCKED');
  }

  private async pairBlocked(a: string, b: string): Promise<boolean> {
    const block = await prisma.userBlock.findFirst({
      where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] },
      select: { id: true },
    });
    return !!block;
  }

  /** Conversation + mes droits ; CONVERSATION_NOT_FOUND pour un tiers (pas de fuite d'existence). */
  private async assertParticipant(conversationId: string, userId: string) {
    const conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true, clubId: true, userAId: true, userBId: true,
        participants: { select: { userId: true, lastReadAt: true, user: { select: USER_SELECT } } },
      },
    });
    if (!conv || (conv.userAId !== userId && conv.userBId !== userId)) throw new Error('CONVERSATION_NOT_FOUND');
    const otherId = conv.userAId === userId ? conv.userBId : conv.userAId;
    return { conv, otherId };
  }

  /** Get-or-create idempotent par paire canonique. Bloqué ⇒ pas de création (l'existante reste lisible). */
  async getOrCreateConversation(meId: string, otherUserId: string, clubSlug?: string | null): Promise<ConversationSummaryDTO> {
    if (!otherUserId || otherUserId === meId) throw new Error('CANNOT_MESSAGE_SELF');
    const other = await prisma.user.findUnique({ where: { id: otherUserId }, select: { ...USER_SELECT, deletedAt: true } });
    if (!other || other.deletedAt) throw new Error('CONVERSATION_NOT_FOUND');

    const pair = canonical(meId, otherUserId);
    let conv = await prisma.conversation.findUnique({
      where: { userAId_userBId: pair },
      select: { id: true, clubId: true, lastMessageAt: true },
    });
    if (!conv) {
      const clubId = await this.sharedActiveClubId(meId, otherUserId, clubSlug);
      await this.assertNotBlocked(meId, otherUserId);
      try {
        conv = await prisma.conversation.create({
          data: { ...pair, clubId },
          select: { id: true, clubId: true, lastMessageAt: true },
        });
      } catch {
        // course P2002 : l'autre l'a créée en même temps
        conv = await prisma.conversation.findUnique({
          where: { userAId_userBId: pair },
          select: { id: true, clubId: true, lastMessageAt: true },
        });
        if (!conv) throw new Error('CONVERSATION_NOT_FOUND');
      }
    }
    await prisma.conversationParticipant.createMany({
      data: [
        { conversationId: conv.id, userId: pair.userAId },
        { conversationId: conv.id, userId: pair.userBId },
      ],
      skipDuplicates: true,
    });
    return {
      id: conv.id, clubId: conv.clubId,
      lastMessageAt: conv.lastMessageAt?.toISOString() ?? null,
      unreadCount: 0, lastMessage: null,
      other: toUser(other),
    };
  }

  private unreadWhere(conversationId: string, meId: string, lastReadAt: Date | null) {
    return {
      conversationId, deletedAt: null, authorId: { not: meId },
      ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
    };
  }

  /** Boîte de réception : conversations avec ≥ 1 message, tri lastMessageAt desc. */
  async listConversations(meId: string): Promise<ConversationSummaryDTO[]> {
    const parts = await prisma.conversationParticipant.findMany({
      where: { userId: meId, conversation: { lastMessageAt: { not: null } } },
      select: {
        userId: true, lastReadAt: true,
        conversation: {
          select: {
            id: true, clubId: true, lastMessageAt: true, userAId: true, userBId: true,
            participants: { select: { userId: true, lastReadAt: true, user: { select: USER_SELECT } } },
            messages: {
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1,
              select: { body: true, imageUrl: true, authorId: true, deletedAt: true },
            },
          },
        },
      },
    });
    const rows = await Promise.all(parts.map(async (p) => {
      const c = p.conversation;
      const other = c.participants.find((x) => x.userId !== meId)?.user;
      const last = c.messages[0] ?? null;
      const unreadCount = await prisma.directMessage.count({ where: this.unreadWhere(c.id, meId, p.lastReadAt) });
      return {
        id: c.id, clubId: c.clubId,
        lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
        unreadCount,
        other: other ? toUser(other) : { userId: '', firstName: 'Utilisateur', lastName: 'supprimé', avatarUrl: null },
        lastMessage: last ? {
          body: last.deletedAt ? '' : last.body,
          hasImage: !last.deletedAt && !!last.imageUrl,
          mine: last.authorId === meId,
          deleted: last.deletedAt != null,
        } : null,
      };
    }));
    return rows.sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''));
  }

  /** Total global de non-lus (badge 💬 du header). */
  async unreadTotal(meId: string): Promise<{ count: number }> {
    const parts = await prisma.conversationParticipant.findMany({
      where: { userId: meId },
      select: { conversationId: true, lastReadAt: true },
    });
    const counts = await Promise.all(parts.map((p) =>
      prisma.directMessage.count({ where: this.unreadWhere(p.conversationId, meId, p.lastReadAt) })));
    return { count: counts.reduce((s, n) => s + n, 0) };
  }
}
