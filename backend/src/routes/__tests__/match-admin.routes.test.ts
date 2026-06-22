import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';

const SECRET = process.env.JWT_SECRET!;
if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET manquant');
const token = () => jwt.sign({ id: 'staff1', email: 's@x.fr' }, SECRET, { expiresIn: '1h' });

// Reproduit exactement le mock utilisé par les autres tests admin :
// requireClubMember fait prisma.clubMember.findUnique({ where: { userId_clubId: { ... } } })
// et attend { role } en retour.
const asMember = (role = 'OWNER') =>
  prismaMock.clubMember.findUnique.mockResolvedValue({ role } as any);

beforeEach(() => {
  jest.clearAllMocks();
  asMember();
  // Par défaut, le système de niveau est activé pour le club (assertLevelSystem).
  prismaMock.club.findUnique.mockResolvedValue({ levelSystemEnabled: true } as any);
});

describe('GET /api/clubs/:clubId/admin/matches', () => {
  it('liste les litiges du club', async () => {
    prismaMock.match.findMany.mockResolvedValue([
      { id: 'm1', status: 'DISPUTED', sets: [[6, 4]], players: [], _count: { comments: 2 } },
    ] as any);
    const res = await request(app)
      .get('/api/clubs/c1/admin/matches?status=DISPUTED')
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].commentCount).toBe(2);
  });

  it('403 si non membre', async () => {
    prismaMock.clubMember.findUnique.mockResolvedValue(null as any);
    prismaMock.match.findMany.mockResolvedValue([] as any);
    const res = await request(app)
      .get('/api/clubs/c1/admin/matches')
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(403);
  });

  it('GET /admin/matches → 403 si club OFF', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ levelSystemEnabled: false } as any);
    const res = await request(app).get('/api/clubs/c1/admin/matches?status=DISPUTED')
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/clubs/:clubId/admin/matches/:matchId/resolve', () => {
  it('CANCEL → 200', async () => {
    prismaMock.match.findUnique.mockResolvedValue({
      id: 'm1',
      status: 'DISPUTED',
      clubId: 'c1',
      sets: [[6, 4]],
      players: [],
    } as any);
    prismaMock.match.update.mockResolvedValue({} as any);
    const res = await request(app)
      .post('/api/clubs/c1/admin/matches/m1/resolve')
      .set('Authorization', `Bearer ${token()}`)
      .send({ action: 'CANCEL' });
    expect(res.status).toBe(200);
  });

  it('VALIDATE → 200', async () => {
    prismaMock.match.findUnique.mockResolvedValue({
      id: 'm1',
      status: 'DISPUTED',
      clubId: 'c1',
      sets: [[6, 4]],
      players: [
        { userId: 'u1', team: 1 },
        { userId: 'u2', team: 1 },
        { userId: 'u3', team: 2 },
        { userId: 'u4', team: 2 },
      ],
    } as any);
    prismaMock.match.update.mockResolvedValue({} as any);
    prismaMock.playerRating.findMany.mockResolvedValue([] as any);
    prismaMock.playerRating.upsert.mockResolvedValue({} as any);
    const res = await request(app)
      .post('/api/clubs/c1/admin/matches/m1/resolve')
      .set('Authorization', `Bearer ${token()}`)
      .send({ action: 'VALIDATE' });
    expect(res.status).toBe(200);
  });

  it('action invalide → 400', async () => {
    const res = await request(app)
      .post('/api/clubs/c1/admin/matches/m1/resolve')
      .set('Authorization', `Bearer ${token()}`)
      .send({ action: 'NOPE' });
    expect(res.status).toBe(400);
  });

  it('404 si le match appartient à un autre club', async () => {
    prismaMock.match.findUnique.mockResolvedValue({ clubId: 'AUTRE', status: 'DISPUTED' } as any);
    const res = await request(app).post('/api/clubs/c1/admin/matches/m1/resolve')
      .set('Authorization', `Bearer ${token()}`).send({ action: 'CANCEL' });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/clubs/:clubId/admin/matches/:matchId/void', () => {
  it('annule avec un motif (200) et passe l id staff', async () => {
    const spy = jest.spyOn(require('../../services/match.service').matchService, 'voidMatch').mockResolvedValue(undefined);
    const res = await request(app)
      .post('/api/clubs/c1/admin/matches/m1/void')
      .set('Authorization', `Bearer ${token()}`)
      .send({ reason: 'score truqué' });
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith('m1', 'c1', 'staff1', 'score truqué');
    spy.mockRestore();
  });

  it('400 si motif manquant', async () => {
    jest.spyOn(require('../../services/match.service').matchService, 'voidMatch')
      .mockRejectedValue(new Error('VALIDATION_ERROR'));
    const res = await request(app)
      .post('/api/clubs/c1/admin/matches/m1/void')
      .set('Authorization', `Bearer ${token()}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('404 si match introuvable / autre club', async () => {
    jest.spyOn(require('../../services/match.service').matchService, 'voidMatch')
      .mockRejectedValue(new Error('MATCH_NOT_FOUND'));
    const res = await request(app)
      .post('/api/clubs/c1/admin/matches/mX/void')
      .set('Authorization', `Bearer ${token()}`)
      .send({ reason: 'x' });
    expect(res.status).toBe(404);
  });

  it('409 si déjà annulé', async () => {
    jest.spyOn(require('../../services/match.service').matchService, 'voidMatch')
      .mockRejectedValue(new Error('ALREADY_CANCELLED'));
    const res = await request(app)
      .post('/api/clubs/c1/admin/matches/m1/void')
      .set('Authorization', `Bearer ${token()}`)
      .send({ reason: 'x' });
    expect(res.status).toBe(409);
  });
});
