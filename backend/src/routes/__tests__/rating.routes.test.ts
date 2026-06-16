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
  it('200 + null si pas de niveau', async () => {
    prismaMock.playerRating.findUnique.mockResolvedValue(null as any);
    const res = await request(app).get('/api/me/rating?sport=padel').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
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
