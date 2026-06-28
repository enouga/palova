import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
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
    it('refuse un membre ni participant ni interesse → CHAT_FORBIDDEN', async () => {
      prismaMock.club.findUnique.mockResolvedValue({ id: 'club-1', status: 'ACTIVE' } as any);
      prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);
      prismaMock.reservation.findUnique.mockResolvedValue({
        visibility: 'PUBLIC',
        status: 'CONFIRMED',
        resource: { clubId: 'club-1' },
        participants: [{ userId: 'org', isOrganizer: true }], // viewer 'stranger' not in list
      } as any);
      // viewer is NOT a participant → check interest
      prismaMock.openMatchInterest.findUnique.mockResolvedValue(null as any);
      prismaMock.openMatchMessage.findMany.mockResolvedValue([] as any);

      await expect(
        service.listMessages('club-demo', 'resa-1', 'stranger'),
      ).rejects.toThrow('CHAT_FORBIDDEN');
    });

    it('permet à un participant de lire les messages', async () => {
      primeAccessOk({ participantUserId: 'viewer', isOrganizer: false });
      prismaMock.openMatchMessage.findMany.mockResolvedValue([] as any);

      const result = await service.listMessages('club-demo', 'resa-1', 'viewer');
      expect(result).toEqual([]);
    });

    it('permet à un membre intéressé de lire les messages', async () => {
      prismaMock.club.findUnique.mockResolvedValue({ id: 'club-1', status: 'ACTIVE' } as any);
      prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);
      prismaMock.reservation.findUnique.mockResolvedValue({
        visibility: 'PUBLIC',
        status: 'CONFIRMED',
        resource: { clubId: 'club-1' },
        participants: [{ userId: 'org', isOrganizer: true }],
      } as any);
      // interested member
      prismaMock.openMatchInterest.findUnique.mockResolvedValue({ id: 'interest-1' } as any);
      prismaMock.openMatchMessage.findMany.mockResolvedValue([] as any);

      const result = await service.listMessages('club-demo', 'resa-1', 'interested-user');
      expect(result).toEqual([]);
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
  });
});
