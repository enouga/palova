import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';

// authMiddleware revérifie l'identité en base (tokenVersion/deletedAt, audit pré-MEP §2.2) ;
// cette suite mocke déjà les services, rien d'autre à faire avec Prisma.
jest.mock('../../db/prisma', () => ({
  __esModule: true,
  prisma: { user: { findUnique: jest.fn().mockResolvedValue({ deletedAt: null }) } },
}));

let mockRequestFriend: jest.Mock;
let mockRespond: jest.Mock;
let mockRemove: jest.Mock;
let mockListFriends: jest.Mock;
let mockListRequests: jest.Mock;

jest.mock('../../services/friendship.service', () => ({
  FriendshipService: jest.fn().mockImplementation(() => ({
    requestFriend: (...a: unknown[]) => mockRequestFriend(...a),
    respond:       (...a: unknown[]) => mockRespond(...a),
    removeFriend:  (...a: unknown[]) => mockRemove(...a),
    listFriends:   (...a: unknown[]) => mockListFriends(...a),
    listRequests:  (...a: unknown[]) => mockListRequests(...a),
  })),
}));

const token = jwt.sign({ id: 'u1', email: 'u1@test.fr' }, process.env.JWT_SECRET!);

describe('routes friends', () => {
  beforeEach(() => {
    mockRequestFriend = jest.fn();
    mockRespond = jest.fn();
    mockRemove = jest.fn();
    mockListFriends = jest.fn();
    mockListRequests = jest.fn();
  });

  it('POST /api/clubs/:slug/friends/:userId/request', async () => {
    mockRequestFriend.mockResolvedValue({ status: 'pending_out', requestable: false });
    const res = await request(app).post('/api/clubs/demo/friends/u2/request').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(mockRequestFriend).toHaveBeenCalledWith('demo', 'u1', 'u2');
  });

  it('POST /respond passe accept=true depuis le body', async () => {
    mockRespond.mockResolvedValue({ status: 'friends', requestable: false });
    const res = await request(app).post('/api/clubs/demo/friends/u2/respond').send({ accept: true }).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(mockRespond).toHaveBeenCalledWith('demo', 'u1', 'u2', true);
  });

  it('DELETE /api/clubs/:slug/friends/:userId', async () => {
    mockRemove.mockResolvedValue({ status: 'none', requestable: true });
    const res = await request(app).delete('/api/clubs/demo/friends/u2').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(mockRemove).toHaveBeenCalledWith('u1', 'u2');
  });

  it('mappe FRIEND_REQUESTS_DISABLED sur 409', async () => {
    mockRequestFriend.mockRejectedValue(new Error('FRIEND_REQUESTS_DISABLED'));
    const res = await request(app).post('/api/clubs/demo/friends/u2/request').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'FRIEND_REQUESTS_DISABLED' });
  });

  it('GET /api/me/friendships', async () => {
    mockListFriends.mockResolvedValue([]);
    const res = await request(app).get('/api/me/friendships?q=lea').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(mockListFriends).toHaveBeenCalledWith('u1', 'lea');
  });

  it('GET /api/me/friend-requests', async () => {
    mockListRequests.mockResolvedValue({ received: [], sent: [] });
    const res = await request(app).get('/api/me/friend-requests').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(mockListRequests).toHaveBeenCalledWith('u1');
  });
});
