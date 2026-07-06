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

// clubMember.findUnique sert au middleware (rôle de l'ACTEUR) ET au service (rôle de la CIBLE) :
// on répond par userId pour distinguer les deux.
const memberRoles = (roles: Record<string, 'OWNER' | 'ADMIN' | 'STAFF'>) =>
  prismaMock.clubMember.findUnique.mockImplementation(((args: any) => {
    const userId = args?.where?.userId_clubId?.userId as string;
    const role = roles[userId];
    return Promise.resolve(role ? { userId, clubId: 'club-demo', role } : null);
  }) as any);

beforeEach(() => {
  jest.clearAllMocks();
  memberRoles({ admin1: 'ADMIN' }); // acteur ADMIN, cible sans rôle staff
  prismaMock.clubMembership.findUnique.mockResolvedValue({ id: 'mb1' } as any); // cible dans le fichier
  prismaMock.clubMember.upsert.mockResolvedValue({} as any);
  prismaMock.clubMember.deleteMany.mockResolvedValue({ count: 1 } as any);
});

describe('PATCH /api/clubs/:clubId/admin/members/:userId/staff-role', () => {
  it('401 sans token', async () => {
    const res = await request(app).patch(`${base}/members/u9/staff-role`).send({ role: 'STAFF' });
    expect(res.status).toBe(401);
  });

  it('403 pour un viewer STAFF (route réservée ADMIN+)', async () => {
    memberRoles({ admin1: 'STAFF' });
    const res = await request(app).patch(`${base}/members/u9/staff-role`).set(auth).send({ role: 'STAFF' });
    expect(res.status).toBe(403);
  });

  it('200 : un ADMIN promeut un membre en STAFF', async () => {
    const res = await request(app).patch(`${base}/members/u9/staff-role`).set(auth).send({ role: 'STAFF' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId: 'u9', staffRole: 'STAFF' });
    expect(prismaMock.clubMember.upsert).toHaveBeenCalled();
  });

  it('200 : révocation avec role null (deleteMany non-OWNER)', async () => {
    memberRoles({ admin1: 'ADMIN', u9: 'STAFF' });
    const res = await request(app).patch(`${base}/members/u9/staff-role`).set(auth).send({ role: null });
    expect(res.status).toBe(200);
    expect(res.body.staffRole).toBeNull();
    expect(prismaMock.clubMember.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u9', clubId: 'club-demo', role: { not: 'OWNER' } },
    });
  });

  it('403 CANNOT_CHANGE_OWNER si la cible est le gérant', async () => {
    memberRoles({ admin1: 'ADMIN', u9: 'OWNER' });
    const res = await request(app).patch(`${base}/members/u9/staff-role`).set(auth).send({ role: 'STAFF' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('CANNOT_CHANGE_OWNER');
  });

  it('409 CANNOT_CHANGE_SELF sur sa propre ligne', async () => {
    const res = await request(app).patch(`${base}/members/admin1/staff-role`).set(auth).send({ role: null });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('CANNOT_CHANGE_SELF');
  });

  it('404 MEMBER_NOT_FOUND si la cible est hors fichier-membres', async () => {
    prismaMock.clubMembership.findUnique.mockResolvedValue(null as any);
    const res = await request(app).patch(`${base}/members/u9/staff-role`).set(auth).send({ role: 'ADMIN' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('MEMBER_NOT_FOUND');
  });

  it('400 VALIDATION_ERROR pour un rôle inconnu ou absent', async () => {
    const res = await request(app).patch(`${base}/members/u9/staff-role`).set(auth).send({ role: 'SUPER' });
    expect(res.status).toBe(400);
    const res2 = await request(app).patch(`${base}/members/u9/staff-role`).set(auth).send({});
    expect(res2.status).toBe(400);
  });
});
