import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { MessagingService } from '../messaging.service';
import { SSEService } from '../sse.service';

const mockNotify = jest.fn();
jest.mock('../../email/notifications', () => ({
  notifyDirectMessage: (...a: unknown[]) => mockNotify(...a),
}));

const U = (id: string) => ({ id, firstName: 'P', lastName: id.toUpperCase(), avatarUrl: null });

describe('MessagingService — getOrCreateConversation', () => {
  let service: MessagingService;
  beforeEach(() => {
    service = new MessagingService();
    mockNotify.mockReset().mockResolvedValue(undefined);
    prismaMock.user.findUnique.mockResolvedValue({ ...U('u2'), deletedAt: null } as any);
    prismaMock.clubMembership.findMany.mockResolvedValue([{ clubId: 'club-demo' }] as any);
    prismaMock.clubMembership.findFirst.mockResolvedValue({ clubId: 'club-demo' } as any);
    prismaMock.userBlock.findFirst.mockResolvedValue(null);
    prismaMock.conversationParticipant.createMany.mockResolvedValue({ count: 2 } as any);
  });

  it('refuse le self-DM', async () => {
    await expect(service.getOrCreateConversation('u1', 'u1')).rejects.toThrow('CANNOT_MESSAGE_SELF');
  });

  it('refuse sans club actif commun', async () => {
    prismaMock.clubMembership.findFirst.mockResolvedValue(null);
    prismaMock.conversation.findUnique.mockResolvedValue(null);
    await expect(service.getOrCreateConversation('u1', 'u2')).rejects.toThrow('NOT_CO_MEMBERS');
  });

  it('crée la conversation avec la paire canonique (a < b) et les 2 participants', async () => {
    prismaMock.conversation.findUnique.mockResolvedValue(null);
    prismaMock.conversation.create.mockResolvedValue({ id: 'c1', clubId: 'club-demo', lastMessageAt: null } as any);
    const conv = await service.getOrCreateConversation('z9', 'u2');
    expect(prismaMock.conversation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: { userAId: 'u2', userBId: 'z9', clubId: 'club-demo' },
    }));
    expect(prismaMock.conversationParticipant.createMany).toHaveBeenCalledWith({
      data: [
        { conversationId: 'c1', userId: 'u2' },
        { conversationId: 'c1', userId: 'z9' },
      ],
      skipDuplicates: true,
    });
    expect(conv.id).toBe('c1');
    expect(conv.other.userId).toBe('u2');
  });

  it('est idempotent : renvoie la conversation existante sans create', async () => {
    prismaMock.conversation.findUnique.mockResolvedValue({ id: 'c1', clubId: 'club-demo', lastMessageAt: null } as any);
    const conv = await service.getOrCreateConversation('u1', 'u2');
    expect(prismaMock.conversation.create).not.toHaveBeenCalled();
    expect(conv.id).toBe('c1');
  });

  it('refuse de CRÉER une conversation avec un utilisateur bloqué (mais renvoie l\'existante)', async () => {
    prismaMock.userBlock.findFirst.mockResolvedValue({ id: 'b1' } as any);
    prismaMock.conversation.findUnique.mockResolvedValue(null);
    await expect(service.getOrCreateConversation('u1', 'u2')).rejects.toThrow('USER_BLOCKED');
    prismaMock.conversation.findUnique.mockResolvedValue({ id: 'c1', clubId: 'club-demo', lastMessageAt: null } as any);
    await expect(service.getOrCreateConversation('u1', 'u2')).resolves.toMatchObject({ id: 'c1' });
  });

  it('interlocuteur supprimé (RGPD) → CONVERSATION_NOT_FOUND', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ ...U('u2'), deletedAt: new Date() } as any);
    await expect(service.getOrCreateConversation('u1', 'u2')).rejects.toThrow('CONVERSATION_NOT_FOUND');
  });
});

describe('MessagingService — listConversations / unreadTotal', () => {
  let service: MessagingService;
  const conv = (id: string, otherId: string, lastBody: string | null) => ({
    userId: 'u1', lastReadAt: null,
    conversation: {
      id, clubId: 'club-demo', lastMessageAt: lastBody ? new Date('2026-07-04T10:00:00Z') : null,
      userAId: 'u1' < otherId ? 'u1' : otherId, userBId: 'u1' < otherId ? otherId : 'u1',
      participants: [
        { userId: 'u1', lastReadAt: null, user: U('u1') },
        { userId: otherId, lastReadAt: null, user: U(otherId) },
      ],
      messages: lastBody ? [{ body: lastBody, imageUrl: null, authorId: otherId, deletedAt: null }] : [],
    },
  });

  beforeEach(() => { service = new MessagingService(); });

  it('liste triée par lastMessageAt, avec interlocuteur, aperçu et unreadCount', async () => {
    prismaMock.conversationParticipant.findMany.mockResolvedValue([conv('c1', 'u2', 'salut')] as any);
    prismaMock.directMessage.count.mockResolvedValue(3);
    const list = await service.listConversations('u1');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: 'c1', unreadCount: 3,
      other: { userId: 'u2' },
      lastMessage: { body: 'salut', hasImage: false, mine: false, deleted: false },
    });
    // le comptage exclut mes propres messages et les supprimés
    expect(prismaMock.directMessage.count).toHaveBeenCalledWith({
      where: { conversationId: 'c1', deletedAt: null, authorId: { not: 'u1' } },
    });
  });

  it('unreadTotal additionne les non-lus de toutes mes conversations', async () => {
    prismaMock.conversationParticipant.findMany.mockResolvedValue([
      { conversationId: 'c1', userId: 'u1', lastReadAt: new Date('2026-07-01T00:00:00Z') },
      { conversationId: 'c2', userId: 'u1', lastReadAt: null },
    ] as any);
    prismaMock.directMessage.count.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    await expect(service.unreadTotal('u1')).resolves.toEqual({ count: 3 });
    expect(prismaMock.directMessage.count).toHaveBeenCalledWith({
      where: { conversationId: 'c1', deletedAt: null, authorId: { not: 'u1' }, createdAt: { gt: new Date('2026-07-01T00:00:00Z') } },
    });
  });
});
