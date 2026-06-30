import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';

// jest.mock is hoisted — the factory runs before const initialisers.
// Use let + closure so the factory captures the variable by reference.
let mockFollow: jest.Mock;
let mockUnfollow: jest.Mock;
let mockClubFriends: jest.Mock;
let mockFollowing: jest.Mock;
let mockFollowers: jest.Mock;

jest.mock('../../services/follow.service', () => ({
  FollowService: jest.fn().mockImplementation(() => ({
    follow:           (...a: unknown[]) => mockFollow(...a),
    unfollow:         (...a: unknown[]) => mockUnfollow(...a),
    listClubFriends:  (...a: unknown[]) => mockClubFriends(...a),
    listFollowing:    (...a: unknown[]) => mockFollowing(...a),
    listFollowers:    (...a: unknown[]) => mockFollowers(...a),
  })),
}));

const SECRET = process.env.JWT_SECRET!;
const token = jwt.sign({ id: 'u1', email: 'u1@test.fr' }, SECRET);

describe('routes follows', () => {
  beforeEach(() => {
    mockFollow       = jest.fn();
    mockUnfollow     = jest.fn();
    mockClubFriends  = jest.fn();
    mockFollowing    = jest.fn();
    mockFollowers    = jest.fn();
  });

  it('POST /api/clubs/:slug/follows/:userId', async () => {
    mockFollow.mockResolvedValue({ iFollow: true, followsMe: false, mutual: false });
    const res = await request(app)
      .post('/api/clubs/demo/follows/u2')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(mockFollow).toHaveBeenCalledWith('demo', 'u1', 'u2');
    expect(res.body).toEqual({ iFollow: true, followsMe: false, mutual: false });
  });

  it('DELETE /api/clubs/:slug/follows/:userId', async () => {
    mockUnfollow.mockResolvedValue({ iFollow: false, followsMe: false, mutual: false });
    const res = await request(app)
      .delete('/api/clubs/demo/follows/u2')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(mockUnfollow).toHaveBeenCalledWith('demo', 'u1', 'u2');
  });

  it('GET /api/clubs/:slug/friends', async () => {
    mockClubFriends.mockResolvedValue([{ id: 'u2', firstName: 'Lea', lastName: 'M', avatarUrl: null, level: null, mutual: true }]);
    const res = await request(app)
      .get('/api/clubs/demo/friends?q=lea')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(mockClubFriends).toHaveBeenCalledWith('demo', 'u1', 'lea');
  });

  it('GET /api/me/following', async () => {
    mockFollowing.mockResolvedValue([]);
    const res = await request(app)
      .get('/api/me/following?q=lea')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(mockFollowing).toHaveBeenCalledWith('u1', 'lea');
  });

  it('GET /api/me/followers', async () => {
    mockFollowers.mockResolvedValue([]);
    const res = await request(app)
      .get('/api/me/followers')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(mockFollowers).toHaveBeenCalledWith('u1');
  });
});
