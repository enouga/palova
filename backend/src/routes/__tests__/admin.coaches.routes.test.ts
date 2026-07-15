import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET manquant dans l environnement de test (.env)');
const token = () => jwt.sign({ id: 'u1', email: 'owner@x.fr' }, process.env.JWT_SECRET!);
const auth = { Authorization: `Bearer ${token()}` };
const base = '/api/clubs/club-demo/admin';

beforeEach(() => {
  prismaMock.clubMember.findUnique.mockResolvedValue({ userId: 'u1', clubId: 'club-demo', role: 'OWNER' } as any);
});

describe('routes admin /coaches (lecture seule)', () => {
  it('GET /coaches → 200 liste (STAFF suffit, pas de garde ADMIN)', async () => {
    prismaMock.coach.findMany.mockResolvedValue([
      { id: 'c1', clubId: 'club-demo', name: 'Paul', photoUrl: null, isActive: true, sortOrder: 0, user: null },
    ] as any);
    const res = await request(app).get(`${base}/coaches`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'c1', clubId: 'club-demo', name: 'Paul', photoUrl: null, isActive: true, sortOrder: 0 }]);
  });
});
