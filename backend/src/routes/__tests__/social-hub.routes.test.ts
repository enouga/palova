import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';

let mockAgenda: jest.Mock;
let mockSuggestions: jest.Mock;

jest.mock('../../services/socialHub.service', () => ({
  SocialHubService: jest.fn().mockImplementation(() => ({
    friendsAgenda:     (...a: unknown[]) => mockAgenda(...a),
    playerSuggestions: (...a: unknown[]) => mockSuggestions(...a),
  })),
}));

const token = jwt.sign({ id: 'u1', email: 'u1@test.fr' }, process.env.JWT_SECRET!);

describe('routes social hub', () => {
  beforeEach(() => {
    mockAgenda = jest.fn();
    mockSuggestions = jest.fn();
  });

  it('GET /api/clubs/:slug/me/friends-agenda', async () => {
    mockAgenda.mockResolvedValue([{ kind: 'match', id: 'r1' }]);
    const res = await request(app).get('/api/clubs/demo/me/friends-agenda').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(mockAgenda).toHaveBeenCalledWith('demo', 'u1');
    expect(res.body).toEqual([{ kind: 'match', id: 'r1' }]);
  });

  it('GET /api/clubs/:slug/me/friends-agenda — 401 anonyme', async () => {
    const res = await request(app).get('/api/clubs/demo/me/friends-agenda');
    expect(res.status).toBe(401);
  });

  it('GET /api/clubs/:slug/me/player-suggestions', async () => {
    mockSuggestions.mockResolvedValue([{ id: 'p1' }]);
    const res = await request(app).get('/api/clubs/demo/me/player-suggestions').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(mockSuggestions).toHaveBeenCalledWith('demo', 'u1');
  });

  it('GET /api/clubs/:slug/me/player-suggestions — 401 anonyme', async () => {
    const res = await request(app).get('/api/clubs/demo/me/player-suggestions');
    expect(res.status).toBe(401);
  });
});
