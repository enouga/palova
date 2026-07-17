import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET manquant');
const token = () => jwt.sign({ id: 'u1', email: 'test@x.fr' }, process.env.JWT_SECRET!);

beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-padel' } as any);
});

describe('GET /api/me/rating', () => {
  it('200 + état neutre si pas de niveau', async () => {
    prismaMock.playerRating.findUnique.mockResolvedValue(null as any);
    const res = await request(app).get('/api/me/rating?sport=padel').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ calibrated: false, level: null, tier: '', isProvisional: true, reliability: 50, matchesPlayed: 0 });
  });

  it('401 sans token', async () => {
    const res = await request(app).get('/api/me/rating');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/me/rating/calibrate', () => {
  it('crée le niveau et renvoie l affichage', async () => {
    prismaMock.playerRating.findUnique.mockResolvedValue(null as any);
    prismaMock.playerRating.upsert.mockImplementation((args: any) =>
      Promise.resolve({ ...args.create, matchesPlayed: 0 }) as any);
    const res = await request(app).post('/api/me/rating/calibrate')
      .set('Authorization', `Bearer ${token()}`).send({ sport: 'padel', selfLevel: 4 });
    expect(res.status).toBe(200);
    expect(res.body.tier).toBe('Intermédiaire');
  });

  it('400 si palier hors bornes', async () => {
    const res = await request(app).post('/api/me/rating/calibrate')
      .set('Authorization', `Bearer ${token()}`).send({ sport: 'padel', selfLevel: 99 });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/me/rating/history', () => {
  const d1 = new Date('2026-05-01T10:00:00Z');
  const d2 = new Date('2026-06-01T10:00:00Z');

  it('200 + tableau trié par date avec level', async () => {
    prismaMock.matchPlayer.findMany.mockResolvedValue([
      { ratingAfter: 3.6, match: { playedAt: d1 } },
      { ratingAfter: 4.0, match: { playedAt: d2 } },
    ] as any);

    const res = await request(app)
      .get('/api/me/rating/history?sport=padel')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({ playedAt: d1.toISOString(), level: 3.6 });
    expect(res.body[1]).toMatchObject({ playedAt: d2.toISOString(), level: 4.0 });
  });

  it('401 sans token', async () => {
    const res = await request(app).get('/api/me/rating/history');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/me/rating — sport préféré', () => {
  it('sans ?sport utilise le sport préféré du joueur', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ preferredSport: { key: 'tennis' } } as any);
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-tennis' } as any);
    prismaMock.playerRating.findUnique.mockResolvedValue(null);
    const res = await request(app).get('/api/me/rating').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(prismaMock.sport.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { key: 'tennis' } }));
  });

  it('sans préférence retombe sur padel', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ preferredSport: null } as any);
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-padel' } as any);
    prismaMock.playerRating.findUnique.mockResolvedValue(null);
    const res = await request(app).get('/api/me/rating').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(prismaMock.sport.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { key: 'padel' } }));
  });

  it('respecte un ?sport explicite sans consulter les préférences', async () => {
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-padel' } as any);
    prismaMock.playerRating.findUnique.mockResolvedValue(null);
    await request(app).get('/api/me/rating?sport=padel').set('Authorization', `Bearer ${token()}`);
    expect(prismaMock.sport.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { key: 'padel' } }));
    // user.findUnique NE doit PAS avoir été appelé pour résoudre le sport préféré (le seul appel
    // toléré est celui d'authMiddleware, reconnaissable à son select tokenVersion/deletedAt).
    expect(prismaMock.user.findUnique).not.toHaveBeenCalledWith(
      expect.objectContaining({ select: expect.objectContaining({ preferredSport: expect.anything() }) }),
    );
  });
});
