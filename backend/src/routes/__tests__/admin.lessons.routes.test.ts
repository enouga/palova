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

describe('routes lessons students', () => {
  it('POST /lessons/:id/students → 201 CONFIRMED', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue({ id: 'l1', clubId: 'club-demo', capacity: 2, seriesId: null, series: null } as any);
    prismaMock.clubMembership.findFirst.mockResolvedValue(null as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([] as any);
    prismaMock.lessonEnrollment.findUnique.mockResolvedValue(null);
    prismaMock.lessonEnrollment.count.mockResolvedValue(0);
    prismaMock.lessonEnrollment.create.mockResolvedValue({ id: 'e1', status: 'CONFIRMED' } as any);
    const res = await request(app).post(`${base}/lessons/l1/students`).set(auth).send({ userId: 'u9' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('CONFIRMED');
  });

  it('POST /lessons/:id/students avec newMember → crée le membre puis l\'inscrit, en un seul appel client', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue({ id: 'l1', clubId: 'club-demo', capacity: 2, seriesId: null, series: null } as any);
    prismaMock.user.findFirst.mockResolvedValue(null as any);
    prismaMock.user.create.mockResolvedValue({ id: 'u-new', firstName: 'Jo', lastName: 'Doe', email: 'jo@x.fr', phone: null, avatarUrl: null } as any);
    prismaMock.clubMembership.create.mockResolvedValue({ id: 'mb-new', isSubscriber: false, membershipNo: null, status: 'ACTIVE', note: null, watch: false, createdAt: new Date() } as any);
    prismaMock.clubMembership.findFirst.mockResolvedValue(null as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([] as any);
    prismaMock.lessonEnrollment.findUnique.mockResolvedValue(null);
    prismaMock.lessonEnrollment.count.mockResolvedValue(0);
    prismaMock.lessonEnrollment.create.mockResolvedValue({ id: 'e1', status: 'CONFIRMED' } as any);
    const res = await request(app).post(`${base}/lessons/l1/students`).set(auth)
      .send({ newMember: { firstName: 'Jo', lastName: 'Doe', email: 'jo@x.fr' } });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('CONFIRMED');
    expect(res.body.createdMember.userId).toBe('u-new');
    expect(prismaMock.user.create).toHaveBeenCalledTimes(1);
  });

  it('GET /lessons/:id/students → 200 liste', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue({ id: 'l1', clubId: 'club-demo', capacity: 2, seriesId: null, series: null } as any);
    prismaMock.lessonEnrollment.findMany.mockResolvedValue([] as any);
    const res = await request(app).get(`${base}/lessons/l1/students`).set(auth);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('lesson absente → 404', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue(null);
    const res = await request(app).post(`${base}/lessons/x/students`).set(auth).send({ userId: 'u9' });
    expect(res.status).toBe(404);
  });

  it('DELETE /lessons/:id/students/:enrollId → 200', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue({ id: 'l1', clubId: 'club-demo', capacity: 2, seriesId: null, series: null } as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([] as any);
    prismaMock.lessonEnrollment.findFirst.mockResolvedValue({ id: 'e1', status: 'CONFIRMED', lessonId: 'l1', seriesId: null } as any);
    prismaMock.lessonEnrollment.update.mockResolvedValue({} as any);
    const res = await request(app).delete(`${base}/lessons/l1/students/e1`).set(auth);
    expect(res.status).toBe(200);
  });
});
