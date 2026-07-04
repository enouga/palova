import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';

let mocks: Record<string, jest.Mock>;
jest.mock('../../services/messaging.service', () => ({
  MessagingService: jest.fn().mockImplementation(() => new Proxy({}, {
    get: (_t, prop: string) => (...a: unknown[]) => mocks[prop]?.(...a),
  })),
}));

const token = jwt.sign({ id: 'u1', email: 'u1@test.fr' }, process.env.JWT_SECRET!);

describe('routes conversations', () => {
  beforeEach(() => { mocks = {
    getOrCreateConversation: jest.fn(), listConversations: jest.fn(), unreadTotal: jest.fn(),
    listMessages: jest.fn(), postMessage: jest.fn(), deleteMessage: jest.fn(),
    addReaction: jest.fn(), removeReaction: jest.fn(), markRead: jest.fn(), typing: jest.fn(),
    block: jest.fn(), unblock: jest.fn(), listBlocks: jest.fn(),
    assertParticipantPublic: jest.fn(),
  }; });

  it('GET /api/me/conversations (auth requise)', async () => {
    mocks.listConversations.mockResolvedValue([]);
    expect((await request(app).get('/api/me/conversations')).status).toBe(401);
    const res = await request(app).get('/api/me/conversations').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(mocks.listConversations).toHaveBeenCalledWith('u1');
  });

  it('GET /api/me/conversations/unread-count', async () => {
    mocks.unreadTotal.mockResolvedValue({ count: 3 });
    const res = await request(app).get('/api/me/conversations/unread-count').set('Authorization', `Bearer ${token}`);
    expect(res.body).toEqual({ count: 3 });
  });

  it('POST /api/me/conversations passe otherUserId + clubSlug', async () => {
    mocks.getOrCreateConversation.mockResolvedValue({ id: 'c1' });
    const res = await request(app).post('/api/me/conversations')
      .send({ otherUserId: 'u2', clubSlug: 'demo' }).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(mocks.getOrCreateConversation).toHaveBeenCalledWith('u1', 'u2', 'demo');
  });

  it('GET /api/conversations/:id/messages relaie before/limit', async () => {
    mocks.listMessages.mockResolvedValue({ messages: [], meta: {} });
    await request(app).get('/api/conversations/c1/messages?before=m9&limit=20').set('Authorization', `Bearer ${token}`);
    expect(mocks.listMessages).toHaveBeenCalledWith('c1', 'u1', 'm9', '20');
  });

  it('POST message / DELETE message / réactions / read / typing', async () => {
    mocks.postMessage.mockResolvedValue({ id: 'm1' });
    await request(app).post('/api/conversations/c1/messages').send({ body: 'yo' }).set('Authorization', `Bearer ${token}`);
    expect(mocks.postMessage).toHaveBeenCalledWith('c1', 'u1', 'yo');

    mocks.deleteMessage.mockResolvedValue({ id: 'm1', deleted: true });
    await request(app).delete('/api/conversations/c1/messages/m1').set('Authorization', `Bearer ${token}`);
    expect(mocks.deleteMessage).toHaveBeenCalledWith('c1', 'u1', 'm1');

    mocks.addReaction.mockResolvedValue([]);
    await request(app).post('/api/conversations/c1/messages/m1/reactions').send({ emoji: '👍' }).set('Authorization', `Bearer ${token}`);
    expect(mocks.addReaction).toHaveBeenCalledWith('c1', 'u1', 'm1', '👍');

    mocks.removeReaction.mockResolvedValue([]);
    await request(app).delete('/api/conversations/c1/messages/m1/reactions?emoji=%F0%9F%91%8D').set('Authorization', `Bearer ${token}`);
    expect(mocks.removeReaction).toHaveBeenCalledWith('c1', 'u1', 'm1', '👍');

    mocks.markRead.mockResolvedValue({ lastReadAt: 'x' });
    await request(app).post('/api/conversations/c1/read').set('Authorization', `Bearer ${token}`);
    expect(mocks.markRead).toHaveBeenCalledWith('c1', 'u1');

    mocks.typing.mockResolvedValue({ ok: true });
    await request(app).post('/api/conversations/c1/typing').set('Authorization', `Bearer ${token}`);
    expect(mocks.typing).toHaveBeenCalledWith('c1', 'u1');
  });

  it('blocs : POST/DELETE /api/me/blocks/:userId + GET /api/me/blocks', async () => {
    mocks.block.mockResolvedValue({ blocked: true });
    await request(app).post('/api/me/blocks/u2').set('Authorization', `Bearer ${token}`);
    expect(mocks.block).toHaveBeenCalledWith('u1', 'u2');
    mocks.unblock.mockResolvedValue({ blocked: false });
    await request(app).delete('/api/me/blocks/u2').set('Authorization', `Bearer ${token}`);
    expect(mocks.unblock).toHaveBeenCalledWith('u1', 'u2');
    mocks.listBlocks.mockResolvedValue([]);
    await request(app).get('/api/me/blocks').set('Authorization', `Bearer ${token}`);
    expect(mocks.listBlocks).toHaveBeenCalledWith('u1');
  });

  it('mapping erreurs : NOT_CO_MEMBERS 403, USER_BLOCKED 409, CANNOT_MESSAGE_SELF 400, CONVERSATION_NOT_FOUND 404', async () => {
    for (const [code, status] of [
      ['NOT_CO_MEMBERS', 403], ['USER_BLOCKED', 409], ['CANNOT_MESSAGE_SELF', 400], ['CONVERSATION_NOT_FOUND', 404],
    ] as const) {
      mocks.getOrCreateConversation.mockRejectedValue(new Error(code));
      const res = await request(app).post('/api/me/conversations').send({ otherUserId: 'u2' }).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(status);
      expect(res.body).toEqual({ error: code });
    }
  });

  it('SSE : token invalide → 401 ; non-participant → 403', async () => {
    const bad = await request(app).get('/api/conversations/c1/stream?token=nope');
    expect(bad.status).toBe(401);
    mocks.assertParticipantPublic.mockRejectedValue(new Error('CONVERSATION_NOT_FOUND'));
    const forbidden = await request(app).get(`/api/conversations/c1/stream?token=${token}`);
    expect(forbidden.status).toBe(403);
  });
});
