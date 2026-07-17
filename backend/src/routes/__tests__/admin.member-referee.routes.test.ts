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

const memberRoles = (roles: Record<string, 'OWNER' | 'ADMIN' | 'STAFF'>) =>
  prismaMock.clubMember.findUnique.mockImplementation(((args: any) => {
    const userId = args?.where?.userId_clubId?.userId as string;
    const role = roles[userId];
    return Promise.resolve(role ? { userId, clubId: 'club-demo', role } : null);
  }) as any);

beforeEach(() => {
  jest.clearAllMocks();
  memberRoles({ admin1: 'ADMIN' });
});

describe('PATCH /api/clubs/:clubId/admin/members/:userId/referee', () => {
  it('401 sans token', async () => {
    const res = await request(app).patch(`${base}/members/u9/referee`).send({ isReferee: true });
    expect(res.status).toBe(401);
  });

  // Le test qui compte : la facette J/A ouvre l'espace arbitrage d'un tournoi.
  // Sans ce gate, un STAFF se nommerait J/A tout seul.
  it('403 pour un viewer STAFF (route réservée ADMIN+)', async () => {
    memberRoles({ admin1: 'STAFF' });
    prismaMock.clubMembership.updateMany.mockResolvedValue({ count: 1 } as any);

    const res = await request(app).patch(`${base}/members/u9/referee`).set(auth).send({ isReferee: true });

    expect(res.status).toBe(403);
    expect(prismaMock.clubMembership.updateMany).not.toHaveBeenCalled();
  });

  it('403 pour un non-membre du club', async () => {
    memberRoles({});
    const res = await request(app).patch(`${base}/members/u9/referee`).set(auth).send({ isReferee: true });
    expect(res.status).toBe(403);
  });

  it('400 si isReferee absent ou non-booléen (service jamais appelé)', async () => {
    const res = await request(app).patch(`${base}/members/u9/referee`).set(auth).send({});
    expect(res.status).toBe(400);
    const res2 = await request(app).patch(`${base}/members/u9/referee`).set(auth).send({ isReferee: 'yes' });
    expect(res2.status).toBe(400);
    expect(prismaMock.clubMembership.updateMany).not.toHaveBeenCalled();
  });

  it('200 : coche la facette', async () => {
    prismaMock.clubMembership.updateMany.mockResolvedValue({ count: 1 } as any);

    const res = await request(app).patch(`${base}/members/u9/referee`).set(auth).send({ isReferee: true });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId: 'u9', isReferee: true });
    expect(prismaMock.clubMembership.updateMany).toHaveBeenCalledWith({
      where: { clubId: 'club-demo', userId: 'u9' }, data: { isReferee: true },
    });
  });

  it('200 : décoche la facette', async () => {
    prismaMock.clubMembership.updateMany.mockResolvedValue({ count: 1 } as any);

    const res = await request(app).patch(`${base}/members/u9/referee`).set(auth).send({ isReferee: false });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId: 'u9', isReferee: false });
  });

  it('404 MEMBER_NOT_FOUND si la cible est hors fichier-membres', async () => {
    prismaMock.clubMembership.updateMany.mockResolvedValue({ count: 0 } as any);

    const res = await request(app).patch(`${base}/members/u9/referee`).set(auth).send({ isReferee: true });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('MEMBER_NOT_FOUND');
  });
});

describe('GET /api/clubs/:clubId/admin/referees', () => {
  const vivier = [
    { user: { id: 'u1', firstName: 'Olivia', lastName: 'Gerante', avatarUrl: '/uploads/avatars/u1.jpg' } },
  ];

  it('200 : renvoie le vivier des J/A', async () => {
    prismaMock.clubMembership.findMany.mockResolvedValue(vivier as any);

    const res = await request(app).get(`${base}/referees`).set(auth);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { userId: 'u1', firstName: 'Olivia', lastName: 'Gerante', avatarUrl: '/uploads/avatars/u1.jpg' },
    ]);
  });

  // Lecture volontairement laissée à STAFF (garde globale du routeur) : un staff qui
  // édite un tournoi doit pouvoir peupler le picker de J/A. Seul le PATCH est ADMIN+.
  it('200 pour un viewer STAFF (lecture héritée de la garde globale)', async () => {
    memberRoles({ admin1: 'STAFF' });
    prismaMock.clubMembership.findMany.mockResolvedValue(vivier as any);

    const res = await request(app).get(`${base}/referees`).set(auth);

    expect(res.status).toBe(200);
  });
});

// Le mapping REFEREE_INVALID vit dans ERROR_STATUS d'admin.ts : sans lui, désigner un J/A
// invalide remonterait en 500 (erreur non mappée → next(err)) au lieu d'un 400 parlant.
describe('PATCH /api/clubs/:clubId/admin/tournaments/:id — désignation du J/A', () => {
  it('400 REFEREE_INVALID si le J/A désigné ne porte pas la facette', async () => {
    prismaMock.tournament.findFirst.mockResolvedValue({
      id: 't1', status: 'DRAFT', entryFee: 0, requirePrepayment: false,
    } as any);
    // resolveReferee → adhésion absente = pas J/A
    prismaMock.clubMembership.findUnique.mockResolvedValue(null as any);

    const res = await request(app).patch(`${base}/tournaments/t1`).set(auth).send({ refereeUserId: 'u9' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('REFEREE_INVALID');
    expect(prismaMock.tournament.update).not.toHaveBeenCalled();
  });
});
