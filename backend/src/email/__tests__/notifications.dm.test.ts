import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { SSEService } from '../../services/sse.service';

const mockDispatch = jest.fn();
jest.mock('../../services/notification/dispatcher', () => ({
  dispatch: (...a: unknown[]) => mockDispatch(...a),
}));
jest.mock('../../services/emailTemplate.service', () => ({
  emailTemplates: { getOverride: jest.fn().mockResolvedValue(null) },
}));

import { notifyDirectMessage } from '../notifications';

const CONV = {
  clubId: 'club-demo', userAId: 'u1', userBId: 'u2',
  messages: [{ body: 'on joue samedi ?', imageUrl: null, author: { firstName: 'Éric', lastName: 'N' } }],
};
const CLUB = { id: 'club-demo', name: 'Padel Arena', slug: 'demo', logoUrl: null, accentColor: '#123456' };

describe('notifyDirectMessage', () => {
  beforeEach(() => {
    mockDispatch.mockReset().mockResolvedValue(undefined);
    prismaMock.conversation.findUnique.mockResolvedValue(CONV as any);
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u2', email: 'u2@test.fr', firstName: 'Marie', deletedAt: null } as any);
    prismaMock.notification.findFirst.mockResolvedValue(null);
    prismaMock.club.findUnique.mockResolvedValue(CLUB as any);
    jest.spyOn(SSEService.getInstance(), 'getConversationUserIds').mockReturnValue(new Set());
  });
  afterEach(() => jest.restoreAllMocks());

  it('notifie le destinataire absent : catégorie DIRECT_MESSAGES, data.conversationId, email brandé', async () => {
    await notifyDirectMessage('c1', 'm1', 'u1');
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'u2', clubId: 'club-demo', category: 'DIRECT_MESSAGES', type: 'dm.message',
      url: '/me/messages?with=u1',
      data: { conversationId: 'c1' },
      email: expect.objectContaining({ to: 'u2@test.fr' }),
    }));
  });

  it('destinataire connecté au flux de la conversation → aucune notif', async () => {
    (SSEService.getInstance().getConversationUserIds as jest.Mock).mockReturnValue(new Set(['u2']));
    await notifyDirectMessage('c1', 'm1', 'u1');
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('email coalescé : notif dm non lue existante pour la conversation → dispatch avec email null', async () => {
    prismaMock.notification.findFirst.mockResolvedValue({ id: 'n1' } as any);
    await notifyDirectMessage('c1', 'm1', 'u1');
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({ email: null }));
  });

  it('message photo sans texte → aperçu « 📷 Photo »', async () => {
    prismaMock.conversation.findUnique.mockResolvedValue({
      ...CONV, messages: [{ body: '', imageUrl: 'c1/x.jpg', author: { firstName: 'Éric', lastName: 'N' } }],
    } as any);
    await notifyDirectMessage('c1', 'm1', 'u1');
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({ body: '📷 Photo' }));
  });

  it('destinataire supprimé (RGPD) → rien', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u2', email: 'x', firstName: 'M', deletedAt: new Date() } as any);
    await notifyDirectMessage('c1', 'm1', 'u1');
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});
