import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import '../../__mocks__/redis';

const mockDispatch = jest.fn();
jest.mock('../notification/dispatcher', () => ({ dispatch: (...a: unknown[]) => mockDispatch(...a) }));

import { ModerationService } from '../moderation.service';

const CLUB = { id: 'club-1', name: 'Padel Arena', slug: 'padel-arena', logoUrl: null, accentColor: '#000', timezone: 'Europe/Paris', address: null, city: null, contactPhone: null, contactEmail: null };

describe('ModerationService — reportOpenMatchMessage', () => {
  let service: ModerationService;
  beforeEach(() => {
    service = new ModerationService();
    mockDispatch.mockReset().mockResolvedValue(undefined);
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-1', status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);
    prismaMock.reservation.findUnique.mockResolvedValue({
      visibility: 'PUBLIC', status: 'CONFIRMED',
      resource: { clubId: 'club-1' },
      participants: [{ userId: 'org', isOrganizer: true }],
    } as any);
    prismaMock.openMatchMessage.findUnique.mockResolvedValue({
      id: 'm1', reservationId: 'resa-1', userId: 'author-1', deletedAt: null,
    } as any);
  });

  it('crée le signalement et notifie le staff par email + notification in-app (dispatch)', async () => {
    prismaMock.messageReport.create.mockResolvedValue({ id: 'rep-1' } as any);
    prismaMock.openMatchMessage.findUnique
      .mockResolvedValueOnce({ id: 'm1', reservationId: 'resa-1', userId: 'author-1', deletedAt: null } as any)
      .mockResolvedValueOnce({
        body: 'propos', user: { firstName: 'A', lastName: 'B' },
        reservation: { startTime: new Date('2026-07-14T18:00:00Z'), resource: { name: 'Court 1' } },
      } as any);
    prismaMock.club.findUnique.mockResolvedValueOnce({ id: 'club-1', status: 'ACTIVE' } as any).mockResolvedValueOnce(CLUB as any);
    prismaMock.clubMember.findMany.mockResolvedValue([{ user: { id: 'owner-1', email: 'owner@x.fr' } }] as any);

    const r = await service.reportOpenMatchMessage('club-demo', 'resa-1', 'm1', 'reporter-1', { reason: 'SPAM', detail: 'gênant' });
    expect(r.id).toBe('rep-1');
    expect(prismaMock.messageReport.create).toHaveBeenCalledWith({
      data: { openMatchMessageId: 'm1', reporterId: 'reporter-1', clubId: 'club-1', reason: 'SPAM', detail: 'gênant' },
    });
    await new Promise((r2) => setImmediate(r2)); // laisse le .catch best-effort se résoudre
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'owner-1', clubId: 'club-1', category: 'MODERATION', type: 'moderation.report',
      email: expect.objectContaining({ to: 'owner@x.fr' }),
    }));
  });

  it('auto-signalement refusé → VALIDATION_ERROR', async () => {
    await expect(
      service.reportOpenMatchMessage('club-demo', 'resa-1', 'm1', 'author-1', { reason: 'SPAM', detail: null }),
    ).rejects.toThrow('VALIDATION_ERROR');
  });

  it('message d une autre résa ou supprimé → MESSAGE_NOT_FOUND', async () => {
    prismaMock.openMatchMessage.findUnique.mockResolvedValue({ id: 'm1', reservationId: 'resa-X', userId: 'author-1', deletedAt: null } as any);
    await expect(
      service.reportOpenMatchMessage('club-demo', 'resa-1', 'm1', 'reporter-1', { reason: 'SPAM', detail: null }),
    ).rejects.toThrow('MESSAGE_NOT_FOUND');
  });

  it('motif invalide → VALIDATION_ERROR', async () => {
    await expect(
      service.reportOpenMatchMessage('club-demo', 'resa-1', 'm1', 'reporter-1', { reason: 'NAWAK', detail: null }),
    ).rejects.toThrow('VALIDATION_ERROR');
  });

  it('détail > 500 caractères → VALIDATION_ERROR', async () => {
    await expect(
      service.reportOpenMatchMessage('club-demo', 'resa-1', 'm1', 'reporter-1', { reason: 'SPAM', detail: 'x'.repeat(501) }),
    ).rejects.toThrow('VALIDATION_ERROR');
  });

  it('non-membre du club → refusé par la garde d accès (RESERVATION_NOT_FOUND)', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue({
      visibility: 'PUBLIC', status: 'CONFIRMED', resource: { clubId: 'club-AUTRE' }, participants: [],
    } as any);
    await expect(
      service.reportOpenMatchMessage('club-demo', 'resa-1', 'm1', 'reporter-1', { reason: 'SPAM', detail: null }),
    ).rejects.toThrow('RESERVATION_NOT_FOUND');
  });

  it('doublon (P2002) → idempotent, renvoie le signalement existant', async () => {
    prismaMock.messageReport.create.mockRejectedValue({ code: 'P2002' });
    prismaMock.messageReport.findUniqueOrThrow.mockResolvedValue({ id: 'rep-existant' } as any);
    const r = await service.reportOpenMatchMessage('club-demo', 'resa-1', 'm1', 'reporter-1', { reason: 'SPAM', detail: null });
    expect(r.id).toBe('rep-existant');
  });
});

describe('ModerationService — resolveClubReport', () => {
  let service: ModerationService;
  beforeEach(() => {
    service = new ModerationService();
  });

  it('DELETE : tombstone le message via OpenMatchChatService, clôt tous les OPEN du même message', async () => {
    prismaMock.messageReport.findUnique.mockResolvedValue({ id: 'rep-1', clubId: 'club-1', openMatchMessageId: 'm1', status: 'OPEN' } as any);
    prismaMock.messageReport.updateMany.mockResolvedValue({ count: 2 } as any);
    prismaMock.club.findUnique
      .mockResolvedValueOnce({ slug: 'padel-arena' } as any) // resolveClubReport : lookup du slug par id
      .mockResolvedValueOnce({ id: 'club-1', status: 'ACTIVE' } as any); // OpenMatchChatService.deleteMessage : lookup par slug
    prismaMock.clubMember.findFirst.mockResolvedValue({ id: 'cm1' } as any); // mod-1 est staff OWNER/ADMIN
    prismaMock.reservation.findUnique.mockResolvedValue({
      resource: { clubId: 'club-1' }, participants: [{ userId: 'org', isOrganizer: true }],
    } as any);
    prismaMock.openMatchMessage.findUnique
      .mockResolvedValueOnce({ reservationId: 'resa-1', deletedAt: null } as any) // 1er appel : lookup du message rapporté
      .mockResolvedValueOnce({
        id: 'm1', reservationId: 'resa-1', userId: 'author-1', deletedAt: null,
        user: { id: 'author-1', firstName: 'A', lastName: 'B', avatarUrl: null },
      } as any); // 2e appel : dans OpenMatchChatService.deleteMessage
    prismaMock.openMatchMessage.update.mockResolvedValue({
      id: 'm1', body: 'x', createdAt: new Date(), deletedAt: new Date(),
      user: { id: 'author-1', firstName: 'A', lastName: 'B', avatarUrl: null },
    } as any);
    prismaMock.messageReport.findUniqueOrThrow.mockResolvedValue({
      id: 'rep-1', reason: 'SPAM', detail: null, status: 'RESOLVED', resolution: 'DELETED',
      createdAt: new Date(), resolvedAt: new Date(),
      reporter: { id: 'r1', firstName: 'R', lastName: 'P' },
      openMatchMessage: {
        id: 'm1', body: 'x', createdAt: new Date(), deletedAt: new Date(), reservationId: 'resa-1',
        user: { id: 'author-1', firstName: 'A', lastName: 'B' },
        reservation: { startTime: new Date(), resource: { name: 'Court 1' } },
      },
    } as any);

    const row = await service.resolveClubReport('club-1', 'rep-1', 'mod-1', 'DELETE');
    expect(row.status).toBe('RESOLVED');
    expect(prismaMock.messageReport.updateMany).toHaveBeenCalledWith({
      where: { openMatchMessageId: 'm1', status: 'OPEN' },
      data: { status: 'RESOLVED', resolution: 'DELETED', resolvedById: 'mod-1', resolvedAt: expect.any(Date) },
    });
  });

  it('REJECT : ne touche pas au message', async () => {
    prismaMock.messageReport.findUnique.mockResolvedValue({ id: 'rep-1', clubId: 'club-1', openMatchMessageId: 'm1', status: 'OPEN' } as any);
    prismaMock.messageReport.updateMany.mockResolvedValue({ count: 1 } as any);
    prismaMock.messageReport.findUniqueOrThrow.mockResolvedValue({
      id: 'rep-1', reason: 'SPAM', detail: null, status: 'RESOLVED', resolution: 'REJECTED',
      createdAt: new Date(), resolvedAt: new Date(),
      reporter: { id: 'r1', firstName: 'R', lastName: 'P' },
      openMatchMessage: {
        id: 'm1', body: 'x', createdAt: new Date(), deletedAt: null, reservationId: 'resa-1',
        user: { id: 'author-1', firstName: 'A', lastName: 'B' },
        reservation: { startTime: new Date(), resource: { name: 'Court 1' } },
      },
    } as any);

    const row = await service.resolveClubReport('club-1', 'rep-1', 'mod-1', 'REJECT');
    expect(row.resolution).toBe('REJECTED');
    expect(prismaMock.openMatchMessage.update).not.toHaveBeenCalled();
  });

  it('report d un AUTRE club → REPORT_NOT_FOUND', async () => {
    prismaMock.messageReport.findUnique.mockResolvedValue({ id: 'rep-1', clubId: 'club-AUTRE', openMatchMessageId: 'm1', status: 'OPEN' } as any);
    await expect(service.resolveClubReport('club-1', 'rep-1', 'mod-1', 'REJECT')).rejects.toThrow('REPORT_NOT_FOUND');
  });

  it('déjà RESOLVED → idempotent, ne relance pas updateMany', async () => {
    prismaMock.messageReport.findUnique.mockResolvedValue({ id: 'rep-1', clubId: 'club-1', openMatchMessageId: 'm1', status: 'RESOLVED' } as any);
    prismaMock.messageReport.findUniqueOrThrow.mockResolvedValue({
      id: 'rep-1', reason: 'SPAM', detail: null, status: 'RESOLVED', resolution: 'REJECTED',
      createdAt: new Date(), resolvedAt: new Date(),
      reporter: { id: 'r1', firstName: 'R', lastName: 'P' },
      openMatchMessage: {
        id: 'm1', body: 'x', createdAt: new Date(), deletedAt: null, reservationId: 'resa-1',
        user: { id: 'author-1', firstName: 'A', lastName: 'B' },
        reservation: { startTime: new Date(), resource: { name: 'Court 1' } },
      },
    } as any);
    const row = await service.resolveClubReport('club-1', 'rep-1', 'mod-1', 'DELETE');
    expect(row.status).toBe('RESOLVED');
    expect(prismaMock.messageReport.updateMany).not.toHaveBeenCalled();
  });
});

describe('ModerationService — reportDirectMessage / platform', () => {
  let service: ModerationService;
  beforeEach(() => {
    service = new ModerationService();
    mockDispatch.mockReset().mockResolvedValue(undefined);
    prismaMock.conversation.findUnique.mockResolvedValue({
      id: 'c1', clubId: 'club-1', userAId: 'reporter-1', userBId: 'author-1',
      participants: [{ userId: 'reporter-1', lastReadAt: null, user: {} }, { userId: 'author-1', lastReadAt: null, user: {} }],
    } as any);
    prismaMock.directMessage.findUnique.mockResolvedValue({
      id: 'dm1', conversationId: 'c1', authorId: 'author-1', deletedAt: null,
    } as any);
  });

  it('crée le signalement DM et notifie les superadmins par email + notification in-app (dispatch, clubId null)', async () => {
    prismaMock.messageReport.create.mockResolvedValue({ id: 'rep-2' } as any);
    prismaMock.directMessage.findUnique
      .mockResolvedValueOnce({ id: 'dm1', conversationId: 'c1', authorId: 'author-1', deletedAt: null } as any)
      .mockResolvedValueOnce({ body: 'message', imageUrl: null, author: { firstName: 'A', lastName: 'B' } } as any);
    prismaMock.user.findMany.mockResolvedValue([{ id: 'super-1', email: 'super@palova.fr' }] as any);

    const r = await service.reportDirectMessage('c1', 'dm1', 'reporter-1', { reason: 'HARASSMENT', detail: null });
    expect(r.id).toBe('rep-2');
    await new Promise((r2) => setImmediate(r2));
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'super-1', clubId: null, category: 'MODERATION', type: 'moderation.report_dm',
      email: expect.objectContaining({ to: 'super@palova.fr' }),
    }));
  });

  it('tiers non-participant → CONVERSATION_NOT_FOUND', async () => {
    prismaMock.conversation.findUnique.mockResolvedValue({
      id: 'c1', clubId: 'club-1', userAId: 'author-1', userBId: 'other',
      participants: [],
    } as any);
    await expect(
      service.reportDirectMessage('c1', 'dm1', 'reporter-1', { reason: 'SPAM', detail: null }),
    ).rejects.toThrow('CONVERSATION_NOT_FOUND');
  });

  it('auto-signalement refusé → VALIDATION_ERROR', async () => {
    await expect(
      service.reportDirectMessage('c1', 'dm1', 'author-1', { reason: 'SPAM', detail: null }),
    ).rejects.toThrow('VALIDATION_ERROR');
  });

  it('resolvePlatformReport DELETE : tombstone via MessagingService.deleteMessageAsModerator', async () => {
    prismaMock.messageReport.findUnique.mockResolvedValue({ id: 'rep-2', directMessageId: 'dm1', status: 'OPEN' } as any);
    prismaMock.messageReport.updateMany.mockResolvedValue({ count: 1 } as any);
    prismaMock.directMessage.findUnique
      .mockResolvedValueOnce({ conversationId: 'c1', deletedAt: null } as any) // lookup pour connaître la conversation
      .mockResolvedValueOnce({ // dans deleteMessageAsModerator
        id: 'dm1', body: 'msg', imageUrl: null, createdAt: new Date(), deletedAt: null,
        author: { id: 'author-1', firstName: 'A', lastName: 'B', avatarUrl: null },
        reactions: [], conversationId: 'c1',
      } as any);
    prismaMock.directMessage.update.mockResolvedValue({
      id: 'dm1', body: 'msg', imageUrl: null, createdAt: new Date(), deletedAt: new Date(),
      author: { id: 'author-1', firstName: 'A', lastName: 'B', avatarUrl: null }, reactions: [],
    } as any);
    prismaMock.messageReport.findUniqueOrThrow.mockResolvedValue({
      id: 'rep-2', reason: 'SPAM', detail: null, status: 'RESOLVED', resolution: 'DELETED',
      createdAt: new Date(), resolvedAt: new Date(),
      reporter: { id: 'r1', firstName: 'R', lastName: 'P' },
      directMessage: {
        id: 'dm1', body: 'msg', imageUrl: null, createdAt: new Date(), deletedAt: new Date(), conversationId: 'c1',
        author: { id: 'author-1', firstName: 'A', lastName: 'B' },
      },
    } as any);

    const row = await service.resolvePlatformReport('rep-2', 'super-1', 'DELETE');
    expect(row.status).toBe('RESOLVED');
    expect(row.message.deleted).toBe(true);
  });

  it('platformReportImagePath : anti-traversée déjà couverte par imagePathForModerator', async () => {
    prismaMock.messageReport.findUnique.mockResolvedValue({ directMessageId: 'dm1' } as any);
    prismaMock.directMessage.findUnique.mockResolvedValue({ imageUrl: '../../etc/passwd', deletedAt: null } as any);
    await expect(service.platformReportImagePath('rep-2')).rejects.toThrow('MESSAGE_NOT_FOUND');
  });
});
