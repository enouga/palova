import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET manquant');
const token = () => jwt.sign({ id: 'u1', email: 'test@x.fr' }, process.env.JWT_SECRET!);

/** Mocks minimaux pour que clubLeaderboard aboutisse (0 entrées dans le classement). */
function mockLeaderboardSuccess(sportKey = 'padel') {
  prismaMock.club.findUnique.mockResolvedValue({
    id: 'club-1',
    status: 'ACTIVE',
    levelSystemEnabled: true,
  } as any);
  prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);
  prismaMock.sport.findUnique.mockResolvedValue({ id: `sport-${sportKey}` } as any);
  prismaMock.clubMembership.findMany.mockResolvedValue([]);
  prismaMock.matchPlayer.findMany.mockResolvedValue([] as any);
  prismaMock.user.findUnique
    // 1er appel : authMiddleware (tokenVersion/deletedAt)
    .mockResolvedValueOnce({ deletedAt: null } as any)
    // 2e appel : meUser (showInLeaderboard + playerRatings)
    .mockResolvedValueOnce({ showInLeaderboard: false, playerRatings: [] } as any);
}

describe('GET /api/clubs/:slug/leaderboard — sport préféré', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sans ?sport utilise le sport préféré de l\'appelant', async () => {
    // 1er appel à user.findUnique : authMiddleware ; 2e : résolution du sport préféré
    // (preferredSport.ts) ; 3e : meUser dans clubLeaderboard.
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ deletedAt: null } as any)
      .mockResolvedValueOnce({ preferredSport: { key: 'tennis' } } as any)
      .mockResolvedValueOnce({ showInLeaderboard: false, playerRatings: [] } as any);

    prismaMock.club.findUnique.mockResolvedValue({
      id: 'club-1',
      status: 'ACTIVE',
      levelSystemEnabled: true,
    } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-tennis' } as any);
    prismaMock.clubMembership.findMany.mockResolvedValue([]);
    prismaMock.matchPlayer.findMany.mockResolvedValue([] as any);

    const res = await request(app)
      .get('/api/clubs/arena/leaderboard')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    // Le service a appelé sport.findUnique avec key:'tennis' (sport préféré)
    expect(prismaMock.sport.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: 'tennis' } }),
    );
    // user.findUnique doit avoir été appelé pour résoudre le sport préféré
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u1' }, select: expect.objectContaining({ preferredSport: expect.anything() }) }),
    );
    expect(res.body.sport).toBe('tennis');
  });

  it('sans préférence retombe sur padel', async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ deletedAt: null } as any)
      .mockResolvedValueOnce({ preferredSport: null } as any)
      .mockResolvedValueOnce({ showInLeaderboard: false, playerRatings: [] } as any);

    prismaMock.club.findUnique.mockResolvedValue({
      id: 'club-1',
      status: 'ACTIVE',
      levelSystemEnabled: true,
    } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-padel' } as any);
    prismaMock.clubMembership.findMany.mockResolvedValue([]);
    prismaMock.matchPlayer.findMany.mockResolvedValue([] as any);

    const res = await request(app)
      .get('/api/clubs/arena/leaderboard')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(prismaMock.sport.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: 'padel' } }),
    );
    expect(res.body.sport).toBe('padel');
  });

  it('?sport=padel explicite court-circuite la résolution des préférences', async () => {
    // 1er appel : authMiddleware. Seul le 2e (meUser) suit, PAS de résolution de sport préféré.
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ deletedAt: null } as any)
      .mockResolvedValueOnce({ showInLeaderboard: false, playerRatings: [] } as any);

    prismaMock.club.findUnique.mockResolvedValue({
      id: 'club-1',
      status: 'ACTIVE',
      levelSystemEnabled: true,
    } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-padel' } as any);
    prismaMock.clubMembership.findMany.mockResolvedValue([]);
    prismaMock.matchPlayer.findMany.mockResolvedValue([] as any);

    const res = await request(app)
      .get('/api/clubs/arena/leaderboard?sport=padel')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(prismaMock.sport.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: 'padel' } }),
    );
    // user.findUnique NE doit PAS avoir été appelé pour résoudre le sport préféré
    // (le seul appel attendu est meUser dans clubLeaderboard, qui ne sélectionne PAS preferredSport)
    const callsWithPreferredSport = prismaMock.user.findUnique.mock.calls.filter(
      (args: any[]) => args[0]?.select?.preferredSport !== undefined,
    );
    expect(callsWithPreferredSport).toHaveLength(0);
    expect(res.body.sport).toBe('padel');
  });

  it('401 sans token', async () => {
    const res = await request(app).get('/api/clubs/arena/leaderboard');
    expect(res.status).toBe(401);
  });
});
