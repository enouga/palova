import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { redisMock } from '../../__mocks__/redis';
import sharp from 'sharp';
import fs from 'fs';
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

  it('au-delà de 15 nouvelles conversations/h → RATE_LIMITED (compté SEULEMENT à la création)', async () => {
    prismaMock.conversation.findUnique.mockResolvedValue(null);
    redisMock.incr.mockResolvedValue(16);
    await expect(service.getOrCreateConversation('u1', 'u2')).rejects.toThrow('RATE_LIMITED');
  });

  it('la limite dm:newconv n est PAS vérifiée quand la conversation existe déjà (pas de create)', async () => {
    prismaMock.conversation.findUnique.mockResolvedValue({ id: 'c1', clubId: 'club-demo', lastMessageAt: null } as any);
    redisMock.incr.mockResolvedValue(16); // dépassé, mais ne doit jamais être appelé
    await expect(service.getOrCreateConversation('u1', 'u2')).resolves.toMatchObject({ id: 'c1' });
    expect(redisMock.incr).not.toHaveBeenCalled();
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

  it('liste triée par lastMessageAt desc (plus récent d\'abord)', async () => {
    const older = { ...conv('c1', 'u2', 'vieux') };
    older.conversation = { ...older.conversation, lastMessageAt: new Date('2026-07-01T00:00:00Z') };
    const newer = { ...conv('c2', 'u3', 'récent') };
    newer.conversation = { ...newer.conversation, lastMessageAt: new Date('2026-07-04T00:00:00Z') };
    prismaMock.conversationParticipant.findMany.mockResolvedValue([older, newer] as any);
    prismaMock.directMessage.count.mockResolvedValue(0);
    const list = await service.listConversations('u1');
    expect(list.map((c) => c.id)).toEqual(['c2', 'c1']);
  });
});

describe('MessagingService — getOrCreateConversation P2002', () => {
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

  it('course P2002 : create échoue, le fallback findUnique renvoie la conversation créée entretemps', async () => {
    prismaMock.conversation.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'c1', clubId: 'club-demo', lastMessageAt: null } as any);
    prismaMock.conversation.create.mockRejectedValue({ code: 'P2002' });
    const conv = await service.getOrCreateConversation('u1', 'u2');
    expect(conv.id).toBe('c1');
  });

  it('erreur non-P2002 : create échoue → rejette l\'erreur d\'origine (pas de repli silencieux)', async () => {
    prismaMock.conversation.findUnique.mockResolvedValue(null);
    prismaMock.conversation.create.mockRejectedValue(new Error('boom'));
    await expect(service.getOrCreateConversation('u1', 'u2')).rejects.toThrow('boom');
  });
});

const CONV = {
  id: 'c1', clubId: 'club-demo', userAId: 'u1', userBId: 'u2',
  participants: [
    { userId: 'u1', lastReadAt: null, user: U('u1') },
    { userId: 'u2', lastReadAt: new Date('2026-07-04T09:00:00Z'), user: U('u2') },
  ],
};
const MSG_ROW = (id: string, authorId: string, body: string, over: Record<string, unknown> = {}) => ({
  id, body, imageUrl: null, createdAt: new Date('2026-07-04T10:00:00Z'), deletedAt: null,
  author: U(authorId), reactions: [], ...over,
});

describe('MessagingService — messages', () => {
  let service: MessagingService;
  let broadcast: jest.SpyInstance;
  beforeEach(() => {
    service = new MessagingService();
    mockNotify.mockReset().mockResolvedValue(undefined);
    broadcast = jest.spyOn(SSEService.getInstance(), 'broadcastConversation').mockImplementation(() => {});
    prismaMock.conversation.findUnique.mockResolvedValue(CONV as any);
    prismaMock.userBlock.findFirst.mockResolvedValue(null);
    prismaMock.clubMembership.findMany.mockResolvedValue([{ clubId: 'club-demo' }] as any);
    prismaMock.clubMembership.findFirst.mockResolvedValue({ clubId: 'club-demo' } as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
  });
  afterEach(() => broadcast.mockRestore());

  it('listMessages : tiers → CONVERSATION_NOT_FOUND', async () => {
    await expect(service.listMessages('c1', 'intrus')).rejects.toThrow('CONVERSATION_NOT_FOUND');
  });

  it('listMessages : page chrono + méta (lastReadAt des deux côtés, blocked, hasMore)', async () => {
    prismaMock.directMessage.findMany.mockResolvedValue([MSG_ROW('m2', 'u2', 'b'), MSG_ROW('m1', 'u1', 'a')] as any);
    const r = await service.listMessages('c1', 'u1');
    expect(r.messages.map((m) => m.id)).toEqual(['m1', 'm2']); // ré-ordonné chrono asc
    expect(r.meta).toEqual({
      myLastReadAt: null,
      otherLastReadAt: '2026-07-04T09:00:00.000Z',
      blocked: false,
      hasMore: false,
    });
  });

  it('listMessages : curseur before + hasMore', async () => {
    const rows = Array.from({ length: 51 }, (_, i) => MSG_ROW(`m${51 - i}`, 'u2', `x${i}`));
    prismaMock.directMessage.findMany.mockResolvedValue(rows as any);
    const r = await service.listMessages('c1', 'u1', 'm52');
    expect(prismaMock.directMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { conversationId: 'c1' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 51,
      cursor: { id: 'm52' }, skip: 1,
    }));
    expect(r.messages).toHaveLength(50);
    expect(r.meta.hasMore).toBe(true);
  });

  it('listMessages : limit clampé en ENTIER dans [1..100] (défaut 50 si absent/invalide)', async () => {
    prismaMock.directMessage.findMany.mockResolvedValue([]);
    const cases: Array<[string, number]> = [
      ['0', 51],    // 0 falsy → défaut 50 → take 51
      ['-5', 2],    // clampé à 1 → take 2
      ['999', 101], // clampé à 100 → take 101
      ['12.7', 13], // tronqué à 12 → take 13 (jamais de take non-entier)
      ['abc', 51],  // NaN → défaut 50 → take 51
    ];
    for (const [v, take] of cases) {
      await service.listMessages('c1', 'u1', null, v);
      expect(prismaMock.directMessage.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take }));
    }
  });

  it('postMessage : crée, met à jour lastMessageAt, broadcast + notifie', async () => {
    const created = MSG_ROW('m3', 'u1', 'coucou');
    prismaMock.directMessage.create.mockResolvedValue(created as any);
    prismaMock.conversation.update.mockResolvedValue({} as any);
    const dto = await service.postMessage('c1', 'u1', '  coucou  ');
    expect(prismaMock.directMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: { conversationId: 'c1', authorId: 'u1', body: 'coucou' },
    }));
    expect(prismaMock.conversation.update).toHaveBeenCalledWith({
      where: { id: 'c1' }, data: { lastMessageAt: created.createdAt },
    });
    expect(broadcast).toHaveBeenCalledWith('c1', { type: 'dm_message', message: expect.objectContaining({ id: 'm3' }) });
    expect(mockNotify).toHaveBeenCalledWith('c1', 'm3', 'u1');
    expect(dto.body).toBe('coucou');
  });

  it('postMessage : vide ou > 2000 → VALIDATION_ERROR', async () => {
    await expect(service.postMessage('c1', 'u1', '   ')).rejects.toThrow('VALIDATION_ERROR');
    await expect(service.postMessage('c1', 'u1', 'x'.repeat(2001))).rejects.toThrow('VALIDATION_ERROR');
  });

  it('postMessage : paire bloquée → USER_BLOCKED (quel que soit le sens)', async () => {
    prismaMock.userBlock.findFirst.mockResolvedValue({ id: 'b1' } as any);
    await expect(service.postMessage('c1', 'u1', 'yo')).rejects.toThrow('USER_BLOCKED');
  });

  it('postMessage : un échec de notification ne casse pas l\'envoi', async () => {
    prismaMock.directMessage.create.mockResolvedValue(MSG_ROW('m3', 'u1', 'yo') as any);
    prismaMock.conversation.update.mockResolvedValue({} as any);
    mockNotify.mockRejectedValue(new Error('SMTP down'));
    await expect(service.postMessage('c1', 'u1', 'yo')).resolves.toMatchObject({ id: 'm3' });
  });

  it('deleteMessage : auteur seul, pierre tombale + broadcast', async () => {
    prismaMock.directMessage.findUnique.mockResolvedValue({ ...MSG_ROW('m1', 'u1', 'a'), conversationId: 'c1', authorId: 'u1' } as any);
    prismaMock.directMessage.update.mockResolvedValue(MSG_ROW('m1', 'u1', 'a', { deletedAt: new Date() }) as any);
    const dto = await service.deleteMessage('c1', 'u1', 'm1');
    expect(dto.deleted).toBe(true);
    expect(dto.body).toBe('');
    expect(broadcast).toHaveBeenCalledWith('c1', { type: 'dm_deleted', message: expect.objectContaining({ id: 'm1', deleted: true }) });
  });

  it('deleteMessage : non-auteur → NOT_ALLOWED ; déjà supprimé → idempotent sans re-broadcast', async () => {
    prismaMock.directMessage.findUnique.mockResolvedValue({ ...MSG_ROW('m1', 'u2', 'a'), conversationId: 'c1', authorId: 'u2' } as any);
    await expect(service.deleteMessage('c1', 'u1', 'm1')).rejects.toThrow('NOT_ALLOWED');
    prismaMock.directMessage.findUnique.mockResolvedValue({ ...MSG_ROW('m1', 'u1', 'a', { deletedAt: new Date() }), conversationId: 'c1', authorId: 'u1' } as any);
    const dto = await service.deleteMessage('c1', 'u1', 'm1');
    expect(dto.deleted).toBe(true);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('deleteMessage : id inconnu → MESSAGE_NOT_FOUND', async () => {
    prismaMock.directMessage.findUnique.mockResolvedValue(null);
    await expect(service.deleteMessage('c1', 'u1', 'mX')).rejects.toThrow('MESSAGE_NOT_FOUND');
  });

  it('deleteMessage : message d\'une AUTRE conversation → MESSAGE_NOT_FOUND', async () => {
    prismaMock.directMessage.findUnique.mockResolvedValue({ ...MSG_ROW('m1', 'u1', 'a'), conversationId: 'cX', authorId: 'u1' } as any);
    await expect(service.deleteMessage('c1', 'u1', 'm1')).rejects.toThrow('MESSAGE_NOT_FOUND');
  });

  it('postMessage : plus aucun club actif commun → NOT_CO_MEMBERS', async () => {
    prismaMock.clubMembership.findMany.mockResolvedValue([]);
    await expect(service.postMessage('c1', 'u1', 'yo')).rejects.toThrow('NOT_CO_MEMBERS');
  });

  it('postMessage : club commun mais l autre a perdu son adhésion ACTIVE (BLOCKED) → NOT_CO_MEMBERS', async () => {
    prismaMock.clubMembership.findMany.mockResolvedValue([{ clubId: 'club-demo' }] as any);
    prismaMock.clubMembership.findFirst.mockResolvedValue(null);
    await expect(service.postMessage('c1', 'u1', 'yo')).rejects.toThrow('NOT_CO_MEMBERS');
  });

  it('postMessage : un AUTRE club actif commun suffit encore', async () => {
    prismaMock.clubMembership.findMany.mockResolvedValue([{ clubId: 'club-autre' }] as any);
    prismaMock.clubMembership.findFirst.mockResolvedValue({ clubId: 'club-autre' } as any);
    prismaMock.directMessage.create.mockResolvedValue(MSG_ROW('m3', 'u1', 'yo') as any);
    prismaMock.conversation.update.mockResolvedValue({} as any);
    await expect(service.postMessage('c1', 'u1', 'yo')).resolves.toMatchObject({ id: 'm3' });
  });

  it('postMessage : au-delà de 12 messages/min → RATE_LIMITED', async () => {
    redisMock.incr.mockResolvedValue(13);
    await expect(service.postMessage('c1', 'u1', 'yo')).rejects.toThrow('RATE_LIMITED');
  });

  describe('createImageMessage', () => {
    afterEach(() => jest.restoreAllMocks());

    it('détecte le format RÉEL via sharp (mimetype menteur), stocke la bonne extension, plafonne 2048×2048, retire l EXIF', async () => {
      const bigPng = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 10, g: 200, b: 30 } } })
        .png().toBuffer();
      const writeSpy = jest.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined);
      jest.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined as any);
      prismaMock.directMessage.create.mockResolvedValue(MSG_ROW('m5', 'u1', '') as any);
      prismaMock.conversation.update.mockResolvedValue({} as any);

      await service.createImageMessage('c1', 'u1', { buffer: bigPng, mimetype: 'image/jpeg' }, '');

      expect(prismaMock.directMessage.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ imageUrl: expect.stringMatching(/^c1\/\d+-\d+\.png$/) }),
      }));
      const written = writeSpy.mock.calls[0][1] as Buffer;
      const outMeta = await sharp(written).metadata();
      expect(outMeta.format).toBe('png');
      expect(outMeta.width).toBeLessThanOrEqual(2048);
      expect(outMeta.height).toBeLessThanOrEqual(2048);
      expect(outMeta.exif).toBeUndefined();
    });

    it('fichier corrompu / non-image → VALIDATION_ERROR', async () => {
      await expect(
        service.createImageMessage('c1', 'u1', { buffer: Buffer.from('pas une image'), mimetype: 'image/png' }, ''),
      ).rejects.toThrow('VALIDATION_ERROR');
    });

    it('légende > 2000 caractères → VALIDATION_ERROR (avant même le décodage image)', async () => {
      await expect(
        service.createImageMessage('c1', 'u1', { buffer: Buffer.from('x'), mimetype: 'image/jpeg' }, 'x'.repeat(2001)),
      ).rejects.toThrow('VALIDATION_ERROR');
    });

    it('petite image sous le plafond n est pas agrandie', async () => {
      const small = await sharp({ create: { width: 40, height: 30, channels: 3, background: { r: 5, g: 5, b: 5 } } }).jpeg().toBuffer();
      const writeSpy = jest.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined);
      jest.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined as any);
      prismaMock.directMessage.create.mockResolvedValue(MSG_ROW('m6', 'u1', '') as any);
      prismaMock.conversation.update.mockResolvedValue({} as any);

      await service.createImageMessage('c1', 'u1', { buffer: small, mimetype: 'image/jpeg' }, '');

      const written = writeSpy.mock.calls[0][1] as Buffer;
      const outMeta = await sharp(written).metadata();
      expect(outMeta.width).toBe(40);
      expect(outMeta.height).toBe(30);
    });
  });

  describe('deleteMessageAsModerator / imagePathForModerator', () => {
    it('deleteMessageAsModerator : tombstone sans garde auteur/participant, unlink photo', async () => {
      prismaMock.directMessage.findUnique.mockResolvedValue({
        ...MSG_ROW('m7', 'u2', 'msg', { imageUrl: 'c1/x.jpg' }), conversationId: 'c1',
      } as any);
      prismaMock.directMessage.update.mockResolvedValue(MSG_ROW('m7', 'u2', 'msg', { deletedAt: new Date() }) as any);
      const dto = await service.deleteMessageAsModerator('c1', 'm7', 'super-1');
      expect(dto.deleted).toBe(true);
      expect(broadcast).toHaveBeenCalledWith('c1', { type: 'dm_deleted', message: expect.objectContaining({ id: 'm7' }) });
    });

    it('deleteMessageAsModerator : déjà supprimé → idempotent, pas de re-broadcast', async () => {
      prismaMock.directMessage.findUnique.mockResolvedValue({
        ...MSG_ROW('m7', 'u2', 'msg', { deletedAt: new Date() }), conversationId: 'c1',
      } as any);
      const dto = await service.deleteMessageAsModerator('c1', 'm7', 'super-1');
      expect(dto.deleted).toBe(true);
      expect(prismaMock.directMessage.update).not.toHaveBeenCalled();
      expect(broadcast).not.toHaveBeenCalled();
    });

    it('deleteMessageAsModerator : message d une autre conversation → MESSAGE_NOT_FOUND', async () => {
      prismaMock.directMessage.findUnique.mockResolvedValue({ ...MSG_ROW('m7', 'u2', 'msg'), conversationId: 'cX' } as any);
      await expect(service.deleteMessageAsModerator('c1', 'm7', 'super-1')).rejects.toThrow('MESSAGE_NOT_FOUND');
    });

    it('imagePathForModerator : chemin + mime sans garde participant', async () => {
      prismaMock.directMessage.findUnique.mockResolvedValue({ imageUrl: 'c1/photo.png', deletedAt: null } as any);
      const r = await service.imagePathForModerator('m7');
      expect(r.mime).toBe('image/png');
      expect(r.absPath).toContain('c1');
      expect(r.absPath).toContain('photo.png');
    });

    it('imagePathForModerator : message supprimé ou sans image → MESSAGE_NOT_FOUND', async () => {
      prismaMock.directMessage.findUnique.mockResolvedValue({ imageUrl: null, deletedAt: null } as any);
      await expect(service.imagePathForModerator('m7')).rejects.toThrow('MESSAGE_NOT_FOUND');
    });
  });
});

describe('MessagingService — lecture, réactions, frappe, blocages', () => {
  let service: MessagingService;
  let broadcast: jest.SpyInstance;
  beforeEach(() => {
    service = new MessagingService();
    broadcast = jest.spyOn(SSEService.getInstance(), 'broadcastConversation').mockImplementation(() => {});
    prismaMock.conversation.findUnique.mockResolvedValue(CONV as any);
    prismaMock.userBlock.findFirst.mockResolvedValue(null);
    prismaMock.clubMembership.findMany.mockResolvedValue([{ clubId: 'club-demo' }] as any);
    prismaMock.clubMembership.findFirst.mockResolvedValue({ clubId: 'club-demo' } as any);
  });
  afterEach(() => broadcast.mockRestore());

  it('markRead : pose lastReadAt, marque les notifs dm lues, broadcast dm_read', async () => {
    prismaMock.conversationParticipant.update.mockResolvedValue({ lastReadAt: new Date('2026-07-04T11:00:00Z') } as any);
    prismaMock.notification.updateMany.mockResolvedValue({ count: 2 } as any);
    const r = await service.markRead('c1', 'u1');
    expect(prismaMock.conversationParticipant.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { conversationId_userId: { conversationId: 'c1', userId: 'u1' } },
    }));
    expect(prismaMock.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', type: 'dm.message', readAt: null, data: { path: ['conversationId'], equals: 'c1' } },
      data: { readAt: expect.any(Date) },
    });
    expect(broadcast).toHaveBeenCalledWith('c1', { type: 'dm_read', userId: 'u1', lastReadAt: '2026-07-04T11:00:00.000Z' });
    expect(r.lastReadAt).toBe('2026-07-04T11:00:00.000Z');
  });

  it('addReaction : idempotent (P2002 avalé), broadcast l\'état complet des réactions', async () => {
    prismaMock.directMessage.findUnique.mockResolvedValue({ id: 'm1', conversationId: 'c1', deletedAt: null } as any);
    prismaMock.messageReaction.create.mockRejectedValue({ code: 'P2002' });
    prismaMock.messageReaction.findMany.mockResolvedValue([
      { emoji: '👍', userId: 'u1' }, { emoji: '👍', userId: 'u2' }, { emoji: '❤️', userId: 'u2' },
    ] as any);
    const r = await service.addReaction('c1', 'u1', 'm1', '👍');
    expect(r).toEqual([{ emoji: '👍', userIds: ['u1', 'u2'] }, { emoji: '❤️', userIds: ['u2'] }]);
    expect(broadcast).toHaveBeenCalledWith('c1', { type: 'dm_reaction', messageId: 'm1', reactions: r });
  });

  it('addReaction : message supprimé ou étranger → MESSAGE_NOT_FOUND ; emoji vide → VALIDATION_ERROR', async () => {
    prismaMock.directMessage.findUnique.mockResolvedValue({ id: 'm1', conversationId: 'c1', deletedAt: new Date() } as any);
    await expect(service.addReaction('c1', 'u1', 'm1', '👍')).rejects.toThrow('MESSAGE_NOT_FOUND');
    prismaMock.directMessage.findUnique.mockResolvedValue({ id: 'm1', conversationId: 'c1', deletedAt: null } as any);
    await expect(service.addReaction('c1', 'u1', 'm1', '')).rejects.toThrow('VALIDATION_ERROR');
  });

  it('addReaction : plus de club actif commun → NOT_CO_MEMBERS', async () => {
    prismaMock.clubMembership.findMany.mockResolvedValue([]);
    await expect(service.addReaction('c1', 'u1', 'm1', '👍')).rejects.toThrow('NOT_CO_MEMBERS');
  });

  it('removeReaction et markRead restent accessibles même sans club commun (lecture/nettoyage)', async () => {
    prismaMock.clubMembership.findMany.mockResolvedValue([]);
    prismaMock.directMessage.findUnique.mockResolvedValue({ id: 'm1', conversationId: 'c1', deletedAt: null } as any);
    prismaMock.messageReaction.deleteMany.mockResolvedValue({ count: 1 } as any);
    prismaMock.messageReaction.findMany.mockResolvedValue([] as any);
    await expect(service.removeReaction('c1', 'u1', 'm1', '👍')).resolves.toEqual([]);
    prismaMock.conversationParticipant.update.mockResolvedValue({ lastReadAt: new Date('2026-07-04T11:00:00Z') } as any);
    prismaMock.notification.updateMany.mockResolvedValue({ count: 0 } as any);
    await expect(service.markRead('c1', 'u1')).resolves.toMatchObject({ lastReadAt: expect.any(String) });
  });

  it('removeReaction : deleteMany idempotent + broadcast', async () => {
    prismaMock.directMessage.findUnique.mockResolvedValue({ id: 'm1', conversationId: 'c1', deletedAt: null } as any);
    prismaMock.messageReaction.deleteMany.mockResolvedValue({ count: 1 } as any);
    prismaMock.messageReaction.findMany.mockResolvedValue([] as any);
    const r = await service.removeReaction('c1', 'u1', 'm1', '👍');
    expect(prismaMock.messageReaction.deleteMany).toHaveBeenCalledWith({ where: { messageId: 'm1', userId: 'u1', emoji: '👍' } });
    expect(r).toEqual([]);
  });

  it('typing : broadcast éphémère, rien en base', async () => {
    await service.typing('c1', 'u1');
    expect(broadcast).toHaveBeenCalledWith('c1', { type: 'dm_typing', userId: 'u1' });
  });

  it('block/unblock : self refusé, create idempotent, unblock deleteMany', async () => {
    await expect(service.block('u1', 'u1')).rejects.toThrow('CANNOT_BLOCK_SELF');
    prismaMock.userBlock.create.mockRejectedValue({ code: 'P2002' });
    await expect(service.block('u1', 'u2')).resolves.toEqual({ blocked: true });
    prismaMock.userBlock.deleteMany.mockResolvedValue({ count: 1 } as any);
    await expect(service.unblock('u1', 'u2')).resolves.toEqual({ blocked: false });
    expect(prismaMock.userBlock.deleteMany).toHaveBeenCalledWith({ where: { blockerId: 'u1', blockedId: 'u2' } });
  });

  it('listBlocks : renvoie les utilisateurs que J\'AI bloqués', async () => {
    prismaMock.userBlock.findMany.mockResolvedValue([
      { blocked: U('u2') }, { blocked: U('u3') },
    ] as any);
    const list = await service.listBlocks('u1');
    expect(list.map((b) => b.userId)).toEqual(['u2', 'u3']);
  });
});
