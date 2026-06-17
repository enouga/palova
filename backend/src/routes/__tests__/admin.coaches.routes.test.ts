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

describe('routes admin /coaches', () => {
  it('GET /coaches → 200 liste', async () => {
    prismaMock.coach.findMany.mockResolvedValue([{ id: 'c1', name: 'Paul' }] as any);
    const res = await request(app).get(`${base}/coaches`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'c1', name: 'Paul' }]);
  });

  it('POST /coaches → 201', async () => {
    prismaMock.coach.create.mockResolvedValue({ id: 'c1', name: 'Paul' } as any);
    const res = await request(app).post(`${base}/coaches`).set(auth).send({ name: 'Paul' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe('c1');
  });

  it('PATCH /coaches/:id → 200', async () => {
    prismaMock.coach.findUnique.mockResolvedValue({ clubId: 'club-demo' } as any);
    prismaMock.coach.update.mockResolvedValue({ id: 'c1', name: 'Paul Pro' } as any);
    const res = await request(app).patch(`${base}/coaches/c1`).set(auth).send({ name: 'Paul Pro' });
    expect(res.status).toBe(200);
  });

  it('PATCH coach d un autre club → 404 COACH_NOT_FOUND', async () => {
    prismaMock.coach.findUnique.mockResolvedValue({ clubId: 'autre' } as any);
    const res = await request(app).patch(`${base}/coaches/c1`).set(auth).send({ name: 'x' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('COACH_NOT_FOUND');
  });

  it('DELETE /coaches/:id → 200', async () => {
    prismaMock.coach.findUnique.mockResolvedValue({ clubId: 'club-demo' } as any);
    prismaMock.coach.update.mockResolvedValue({ id: 'c1' } as any);
    const res = await request(app).delete(`${base}/coaches/c1`).set(auth);
    expect(res.status).toBe(200);
  });
});
