import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';

const SECRET = process.env.JWT_SECRET!;
if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET manquant');
const token = () => jwt.sign({ id: 'admin1', email: 'a@x.fr' }, SECRET, { expiresIn: '1h' });
const auth = { Authorization: `Bearer ${token()}` };
const base = '/api/clubs/club-demo/admin';

// requireClubMember fait prisma.clubMember.findUnique et attend { role } en retour.
const asMember = (role = 'ADMIN') =>
  prismaMock.clubMember.findUnique.mockResolvedValue({ role, userId: 'admin1', clubId: 'club-demo' } as any);

beforeEach(() => {
  jest.clearAllMocks();
  asMember('ADMIN');
  // Système de niveau activé par défaut (assertLevelSystem).
  prismaMock.club.findUnique.mockResolvedValue({ levelSystemEnabled: true } as any);
  // Par défaut, la cible :userId est bien membre du club (garde d'appartenance).
  prismaMock.clubMembership.findUnique.mockResolvedValue({ id: 'mb1', userId: 'u9', clubId: 'club-demo' } as any);
});

describe('POST /api/clubs/:clubId/admin/members/:userId/level', () => {
  const setLevel = (body: any, role = 'ADMIN') => {
    asMember(role);
    return request(app).post(`${base}/members/u9/level`).set(auth).send(body);
  };

  it('401 sans token', async () => {
    const res = await request(app).post(`${base}/members/u9/level`).send({ sportKey: 'padel', level: 5 });
    expect(res.status).toBe(401);
  });

  it('403 pour un membre STAFF (non ADMIN)', async () => {
    const res = await setLevel({ sportKey: 'padel', level: 5 }, 'STAFF');
    expect(res.status).toBe(403);
  });

  it('200 pour un ADMIN : corrige le niveau et renvoie l affichage', async () => {
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-padel' } as any);
    prismaMock.playerRating.findUnique
      .mockResolvedValueOnce({ displayLevel: 2, matchesPlayed: 4 } as any)
      .mockResolvedValue({ displayLevel: 6, rd: 110, isProvisional: false, matchesPlayed: 4, initialSelfLevel: null } as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb({
      playerRating: { upsert: jest.fn((a: any) => Promise.resolve(a.create)) },
      playerRatingAdjustment: { create: jest.fn().mockResolvedValue({}) },
    }));

    const res = await setLevel({ sportKey: 'padel', level: 6, reason: 'erreur saisie' });
    expect(res.status).toBe(200);
    expect(res.body.level).toBe(6);
    expect(res.body.isProvisional).toBe(false);
  });

  it('400 si niveau hors bornes (> 8)', async () => {
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-padel' } as any);
    const res = await setLevel({ sportKey: 'padel', level: 9 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('403 si le système de niveau est désactivé', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ levelSystemEnabled: false } as any);
    const res = await setLevel({ sportKey: 'padel', level: 5 });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('LEVEL_SYSTEM_DISABLED');
  });

  it('404 si le sport est inconnu', async () => {
    prismaMock.sport.findUnique.mockResolvedValue(null as any);
    const res = await setLevel({ sportKey: 'inconnu', level: 5 });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('SPORT_NOT_FOUND');
  });

  it('404 si la cible n est pas membre du club (niveau global non touché)', async () => {
    prismaMock.clubMembership.findUnique.mockResolvedValue(null as any);
    const res = await setLevel({ sportKey: 'padel', level: 5 });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('MEMBER_NOT_FOUND');
    // on ne doit pas avoir tenté d'écrire le niveau
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});

describe('GET /api/clubs/:clubId/admin/members/:userId/level', () => {
  it('403 pour un membre STAFF (non ADMIN)', async () => {
    asMember('STAFF');
    const res = await request(app).get(`${base}/members/u9/level`).set(auth);
    expect(res.status).toBe(403);
  });

  it('403 si le système de niveau est désactivé', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ levelSystemEnabled: false } as any);
    const res = await request(app).get(`${base}/members/u9/level`).set(auth);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('LEVEL_SYSTEM_DISABLED');
  });

  it('200 pour un ADMIN : niveaux courants + historique', async () => {
    // Sports du club (pour décider la liste des sports).
    prismaMock.clubSport.findMany.mockResolvedValue([{ sport: { key: 'padel' } }] as any);
    prismaMock.sport.findMany.mockResolvedValue([{ id: 'sport-padel', key: 'padel' }] as any);
    prismaMock.playerRating.findMany.mockResolvedValue([
      { userId: 'u9', sportId: 'sport-padel', displayLevel: 6, rd: 110, isProvisional: false },
    ] as any);
    prismaMock.playerRatingAdjustment.findMany.mockResolvedValue([
      {
        id: 'adj1', previousLevel: 2, newLevel: 6, reason: 'erreur', createdAt: new Date('2026-06-23'),
        staffUser: { firstName: 'Eve', lastName: 'Admin' },
        sport: { key: 'padel', name: 'Padel' },
      },
    ] as any);

    const res = await request(app).get(`${base}/members/u9/level`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.levels.padel.level).toBe(6);
    expect(res.body.history).toHaveLength(1);
    expect(res.body.history[0].staffFirstName).toBe('Eve');
  });

  it('404 si la cible n est pas membre du club', async () => {
    prismaMock.clubMembership.findUnique.mockResolvedValue(null as any);
    const res = await request(app).get(`${base}/members/u9/level`).set(auth);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('MEMBER_NOT_FOUND');
  });
});
