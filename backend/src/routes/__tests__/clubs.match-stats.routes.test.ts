import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET manquant');
const token = () => jwt.sign({ id: 'u1', email: 'test@x.fr' }, process.env.JWT_SECRET!);

describe('GET /api/clubs/:slug/me/match-stats', () => {
  beforeEach(() => jest.clearAllMocks());

  it('200 renvoie le bilan V/D + série du club', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-1', status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-padel' } as any);
    prismaMock.matchPlayer.findMany.mockResolvedValue([
      { team: 1, match: { winningTeam: 1, playedAt: new Date('2026-06-05') } },
      { team: 1, match: { winningTeam: 2, playedAt: new Date('2026-06-04') } },
    ] as any);

    const res = await request(app)
      .get('/api/clubs/arena/me/match-stats?sport=padel')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ wins: 1, losses: 1, streak: 1 });
  });

  it('401 sans token', async () => {
    const res = await request(app).get('/api/clubs/arena/me/match-stats');
    expect(res.status).toBe(401);
  });
});
