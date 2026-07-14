import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { redisMock } from '../../__mocks__/redis';
import { OpenMatchChatService } from '../openMatchChat.service';
import { SSEService } from '../sse.service';

const mockNotifyOpenMatchChatMessage = jest.fn();
jest.mock('../../email/notifications', () => ({
  notifyOpenMatchChatMessage: (...args: unknown[]) => mockNotifyOpenMatchChatMessage(...args),
}));

// ──────────────────────────────────────────────
// Helper: prime access mocks for "org" user (participant + organizer)
// ──────────────────────────────────────────────
function primeAccessOk(overrides: { participantUserId?: string; isOrganizer?: boolean } = {}) {
  const participantUserId = overrides.participantUserId ?? 'org';
  const isOrganizer = overrides.isOrganizer ?? true;

  prismaMock.club.findUnique.mockResolvedValue({ id: 'club-1', status: 'ACTIVE' } as any);
  prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);
  prismaMock.reservation.findUnique.mockResolvedValue({
    visibility: 'PUBLIC',
    status: 'CONFIRMED',
    resource: { clubId: 'club-1' },
    participants: [{ userId: participantUserId, isOrganizer }],
  } as any);
}

describe('OpenMatchChatService', () => {
  let service: OpenMatchChatService;

  beforeEach(() => {
    service = new OpenMatchChatService();
    mockNotifyOpenMatchChatMessage.mockReset().mockResolvedValue(undefined);
  });

  // ─────────────────────────────
  // ACCESS GUARD
  // ─────────────────────────────

  describe('access guard', () => {
    it('permet à un participant de lire les messages', async () => {
      primeAccessOk({ participantUserId: 'viewer', isOrganizer: false });
      prismaMock.openMatchMessage.findMany.mockResolvedValue([] as any);

      const result = await service.listMessages('club-demo', 'resa-1', 'viewer');
      expect(result).toEqual([]);
    });

    it('permet à un membre NON participant de lire (chat ouvert à tous)', async () => {
      prismaMock.club.findUnique.mockResolvedValue({ id: 'club-1', status: 'ACTIVE' } as any);
      prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);
      prismaMock.reservation.findUnique.mockResolvedValue({
        visibility: 'PUBLIC',
        status: 'CONFIRMED',
        resource: { clubId: 'club-1' },
        participants: [{ userId: 'org', isOrganizer: true }], // 'stranger' absent de la liste
      } as any);
      prismaMock.openMatchMessage.findMany.mockResolvedValue([] as any);

      const result = await service.listMessages('club-demo', 'resa-1', 'stranger');
      expect(result).toEqual([]);
    });

    it('crée l adhésion à la volée pour un non-membre puis autorise l accès', async () => {
      prismaMock.club.findUnique.mockResolvedValue({ id: 'club-1', status: 'ACTIVE' } as any);
      prismaMock.clubMembership.findUnique.mockResolvedValue(null as any);
      prismaMock.clubMembership.create.mockResolvedValue({ id: 'm1' } as any);
      prismaMock.reservation.findUnique.mockResolvedValue({
        visibility: 'PUBLIC',
        status: 'CONFIRMED',
        resource: { clubId: 'club-1' },
        participants: [{ userId: 'org', isOrganizer: true }],
      } as any);
      prismaMock.openMatchMessage.findMany.mockResolvedValue([] as any);

      const result = await service.listMessages('club-demo', 'resa-1', 'newcomer');
      expect(prismaMock.clubMembership.create).toHaveBeenCalledWith({ data: { userId: 'newcomer', clubId: 'club-1' } });
      expect(result).toEqual([]);
    });

    it('refuse un membre BLOCKED → MEMBERSHIP_BLOCKED', async () => {
      prismaMock.club.findUnique.mockResolvedValue({ id: 'club-1', status: 'ACTIVE' } as any);
      prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'BLOCKED' } as any);

      await expect(
        service.listMessages('club-demo', 'resa-1', 'blocked-user'),
      ).rejects.toThrow('MEMBERSHIP_BLOCKED');
    });
  });

  // ─────────────────────────────
  // POST MESSAGE
  // ─────────────────────────────

  describe('postMessage', () => {
    it('refuse un body vide/whitespace → VALIDATION_ERROR', async () => {
      primeAccessOk();

      await expect(
        service.postMessage('club-demo', 'resa-1', 'org', '   '),
      ).rejects.toThrow('VALIDATION_ERROR');
    });

    it('crée le message, renvoie le DTO et diffuse en SSE', async () => {
      primeAccessOk();

      const fakeRow = {
        id: 'msg-1',
        body: 'Salut !',
        createdAt: new Date('2026-06-28T10:00:00Z'),
        deletedAt: null,
        user: { id: 'org', firstName: 'Eric', lastName: 'N', avatarUrl: null },
      };
      prismaMock.openMatchMessage.create.mockResolvedValue(fakeRow as any);

      const broadcastSpy = jest.spyOn(SSEService.getInstance(), 'broadcastMatch').mockImplementation(() => {});

      const dto = await service.postMessage('club-demo', 'resa-1', 'org', 'Salut !');

      expect(dto.body).toBe('Salut !');
      expect(dto.deleted).toBe(false);
      expect(dto.author.userId).toBe('org');
      expect(broadcastSpy).toHaveBeenCalledWith(
        'resa-1',
        expect.objectContaining({ type: 'chat_message' }),
      );

      broadcastSpy.mockRestore();
    });

    it('au-delà de 12 messages/min → RATE_LIMITED', async () => {
      primeAccessOk();
      redisMock.incr.mockResolvedValue(13);
      await expect(service.postMessage('club-demo', 'resa-1', 'org', 'spam')).rejects.toThrow('RATE_LIMITED');
    });
  });

  // ─────────────────────────────
  // EDITION (auteur seul)
  // ─────────────────────────────

  describe('editMessage', () => {
    it("l auteur peut modifier son message, edited=true, rebroadcast chat_message", async () => {
      primeAccessOk({ participantUserId: 'org', isOrganizer: true });
      prismaMock.openMatchMessage.findUnique.mockResolvedValue({
        id: 'm1', reservationId: 'resa-1', userId: 'org', deletedAt: null,
      } as any);
      prismaMock.openMatchMessage.update.mockResolvedValue({
        id: 'm1', body: 'corrigé', createdAt: new Date('2026-06-28T10:00:00Z'), editedAt: new Date('2026-06-28T10:05:00Z'), deletedAt: null,
        user: { id: 'org', firstName: 'A', lastName: 'B', avatarUrl: null },
      } as any);
      const broadcastSpy = jest.spyOn(SSEService.getInstance(), 'broadcastMatch').mockImplementation(() => {});

      const dto = await service.editMessage('club-demo', 'resa-1', 'org', 'm1', '  corrigé  ');

      expect(dto.body).toBe('corrigé');
      expect(dto.edited).toBe(true);
      expect(prismaMock.openMatchMessage.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'm1' }, data: { body: 'corrigé', editedAt: expect.any(Date) },
      }));
      expect(broadcastSpy).toHaveBeenCalledWith('resa-1', expect.objectContaining({ type: 'chat_message' }));
      broadcastSpy.mockRestore();
    });

    it('body vide/whitespace → VALIDATION_ERROR', async () => {
      primeAccessOk();
      await expect(service.editMessage('club-demo', 'resa-1', 'org', 'm1', '   ')).rejects.toThrow('VALIDATION_ERROR');
    });

    it('non-auteur → NOT_ALLOWED', async () => {
      primeAccessOk({ participantUserId: 'curious', isOrganizer: false });
      prismaMock.openMatchMessage.findUnique.mockResolvedValue({
        id: 'm1', reservationId: 'resa-1', userId: 'someoneElse', deletedAt: null,
      } as any);
      await expect(service.editMessage('club-demo', 'resa-1', 'curious', 'm1', 'x')).rejects.toThrow('NOT_ALLOWED');
    });

    it('message supprimé ou étranger → MESSAGE_NOT_FOUND', async () => {
      primeAccessOk();
      prismaMock.openMatchMessage.findUnique.mockResolvedValue({
        id: 'm1', reservationId: 'resa-1', userId: 'org', deletedAt: new Date(),
      } as any);
      await expect(service.editMessage('club-demo', 'resa-1', 'org', 'm1', 'x')).rejects.toThrow('MESSAGE_NOT_FOUND');
    });
  });

  // ─────────────────────────────
  // SUPPRESSION (moderation)
  // ─────────────────────────────

  describe('OpenMatchChatService - suppression', () => {
    /** Prépare findUnique + update pour un message signé par authorId. */
    function msgBy(authorId: string) {
      prismaMock.openMatchMessage.findUnique.mockResolvedValue({
        id: 'm1',
        reservationId: 'resa-1',
        userId: authorId,
        deletedAt: null,
      } as any);
      prismaMock.openMatchMessage.update.mockResolvedValue({
        id: 'm1',
        body: 'ancien message',
        createdAt: new Date('2026-06-28T10:00:00Z'),
        deletedAt: new Date('2026-06-28T10:05:00Z'),
        user: { id: authorId, firstName: 'Cu', lastName: 'Rious', avatarUrl: null },
      } as any);
    }

    let broadcastSpy: jest.SpyInstance;
    beforeEach(() => {
      broadcastSpy = jest.spyOn(SSEService.getInstance(), 'broadcastMatch').mockImplementation(() => {});
    });
    afterEach(() => broadcastSpy.mockRestore());

    it("l auteur peut supprimer son message (tombstone)", async () => {
      // curious a accès (chat ouvert) — la garde de suppression est auteur/organisateur/staff, pas l'accès
      primeAccessOk();
      msgBy('curious');

      const dto = await service.deleteMessage('club-demo', 'resa-1', 'curious', 'm1');
      expect(dto.deleted).toBe(true);
      expect(dto.body).toBe('');
    });

    it("l organisateur peut supprimer le message d un autre", async () => {
      // org is participant + organizer
      primeAccessOk(); // participantUserId='org', isOrganizer=true
      msgBy('curious'); // message authored by curious, not org

      const dto = await service.deleteMessage('club-demo', 'resa-1', 'org', 'm1');
      expect(dto.deleted).toBe(true);
    });

    it("un tiers ne peut pas supprimer (NOT_ALLOWED)", async () => {
      // curious a accès mais le message a été posté par quelqu'un d'autre
      primeAccessOk();
      msgBy('someoneElse'); // message not by curious
      prismaMock.clubMember.findFirst.mockResolvedValue(null as any); // curious is not staff

      await expect(
        service.deleteMessage('club-demo', 'resa-1', 'curious', 'm1'),
      ).rejects.toThrow('NOT_ALLOWED');
    });

    it("un OWNER/ADMIN du club (non participant) peut supprimer", async () => {
      // admin is neither author ('curious') nor organizer ('org') but is OWNER/ADMIN staff
      prismaMock.club.findUnique.mockResolvedValue({ id: 'club-1', status: 'ACTIVE' } as any);
      prismaMock.reservation.findUnique.mockResolvedValue({
        resource: { clubId: 'club-1' },
        participants: [{ userId: 'org', isOrganizer: true }],
      } as any);
      prismaMock.openMatchMessage.findUnique.mockResolvedValue({
        id: 'm1', reservationId: 'resa-1', userId: 'curious',
        body: 'test msg', createdAt: new Date('2026-06-28T10:00:00Z'), deletedAt: null,
        user: { id: 'curious', firstName: 'Cu', lastName: 'Rious', avatarUrl: null },
      } as any);
      prismaMock.clubMember.findFirst.mockResolvedValue({ id: 'cm1' } as any);
      prismaMock.openMatchMessage.update.mockResolvedValue({
        id: 'm1', body: 'test msg', createdAt: new Date('2026-06-28T10:00:00Z'),
        deletedAt: new Date('2026-06-28T10:05:00Z'),
        user: { id: 'curious', firstName: 'Cu', lastName: 'Rious', avatarUrl: null },
      } as any);

      const dto = await service.deleteMessage('club-demo', 'resa-1', 'admin', 'm1');
      expect(dto.deleted).toBe(true);
    });

    it("double suppression est idempotente (pas de re-broadcast)", async () => {
      // message already deleted; author re-tries → returns tombstone without calling update or broadcast
      prismaMock.club.findUnique.mockResolvedValue({ id: 'club-1', status: 'ACTIVE' } as any);
      prismaMock.reservation.findUnique.mockResolvedValue({
        resource: { clubId: 'club-1' },
        participants: [{ userId: 'curious', isOrganizer: false }],
      } as any);
      prismaMock.openMatchMessage.findUnique.mockResolvedValue({
        id: 'm1', reservationId: 'resa-1', userId: 'curious',
        body: 'already deleted msg', createdAt: new Date('2026-06-28T10:00:00Z'),
        deletedAt: new Date('2026-06-28T10:05:00Z'),
        user: { id: 'curious', firstName: 'Cu', lastName: 'Rious', avatarUrl: null },
      } as any);

      const dto = await service.deleteMessage('club-demo', 'resa-1', 'curious', 'm1');
      expect(dto.deleted).toBe(true);
      expect(prismaMock.openMatchMessage.update).not.toHaveBeenCalled();
      expect(broadcastSpy).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────
  // MARK READ
  // ─────────────────────────────

  describe('markRead', () => {
    it('appelle notification.updateMany et renvoie {count}', async () => {
      prismaMock.notification.updateMany.mockResolvedValue({ count: 3 } as any);

      const result = await service.markRead('club-demo', 'resa-1', 'user-1');

      expect(prismaMock.notification.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user-1',
            type: 'open_match.message',
            readAt: null,
          }),
          data: expect.objectContaining({ readAt: expect.any(Date) }),
        }),
      );
      expect(result).toEqual({ count: 3 });
    });

    it('renvoie {count: 0} quand aucune notification non lue', async () => {
      prismaMock.notification.updateMany.mockResolvedValue({ count: 0 } as any);
      const result = await service.markRead('club-demo', 'resa-1', 'user-1');
      expect(result).toEqual({ count: 0 });
    });
  });

  // ─────────────────────────────
  // UNREAD COUNT
  // ─────────────────────────────

  describe('unreadCount', () => {
    it('renvoie le comptage de prisma quand le club existe', async () => {
      prismaMock.club.findUnique.mockResolvedValue({ id: 'club-1' } as any);
      prismaMock.notification.count.mockResolvedValue(5 as any);

      const result = await service.unreadCount('club-demo', 'user-1');

      expect(prismaMock.notification.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user-1',
            type: 'open_match.message',
            readAt: null,
            clubId: 'club-1',
          }),
        }),
      );
      expect(result).toEqual({ count: 5 });
    });

    it('renvoie {count: 0} si le club n\'existe pas', async () => {
      prismaMock.club.findUnique.mockResolvedValue(null as any);

      const result = await service.unreadCount('inconnu', 'user-1');

      expect(prismaMock.notification.count).not.toHaveBeenCalled();
      expect(result).toEqual({ count: 0 });
    });
  });
});
