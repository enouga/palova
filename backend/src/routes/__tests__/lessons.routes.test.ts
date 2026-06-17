import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET manquant dans l environnement de test (.env)');
const token = jwt.sign({ id: 'u1', email: 'a@b.fr' }, process.env.JWT_SECRET!);

// Lesson complète pour getPublicLesson (findUnique + groupBy)
const fullLesson = {
  id: 'l1',
  clubId: 'c1',
  allowSelfEnroll: true,
  capacity: 2,
  seriesId: null,
  series: null,
  coach: { name: 'Coach X', photoUrl: null },
  reservation: {
    startTime: new Date(Date.now() + 86400000),
    endTime: new Date(Date.now() + 90000000),
    resource: { name: 'Terrain 1' },
  },
  club: { slug: 's', name: 'Club N', timezone: 'Europe/Paris' },
} as any;

describe('routes lessons joueur', () => {
  it('GET /api/lessons/:id → 200', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue(fullLesson);
    // groupBy type is overloaded — cast to any to mock it
    (prismaMock.lessonEnrollment.groupBy as any).mockResolvedValue([]);
    const res = await request(app).get('/api/lessons/l1');
    expect(res.status).toBe(200);
  });

  it('GET /api/lessons/:id → 404 si inexistante', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue(null);
    const res = await request(app).get('/api/lessons/missing');
    expect(res.status).toBe(404);
  });

  it('GET /api/lessons/:id/participants → 200', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue({
      id: 'l1',
      clubId: 'c1',
      capacity: 2,
      seriesId: null,
      series: null,
      reservation: { startTime: new Date(Date.now() + 86400000) },
    } as any);
    prismaMock.lessonEnrollment.findMany.mockResolvedValue([] as any);
    const res = await request(app).get('/api/lessons/l1/participants');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('POST /api/lessons/:id/enrollment refuse 403 si fermé (allowSelfEnroll=false)', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue({
      id: 'l1',
      clubId: 'c1',
      allowSelfEnroll: false,
      capacity: 2,
      seriesId: null,
      series: null,
      reservation: { startTime: new Date(Date.now() + 86400000) },
    } as any);
    const res = await request(app)
      .post('/api/lessons/l1/enrollment')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('POST /api/lessons/:id/enrollment sans auth → 401', async () => {
    const res = await request(app).post('/api/lessons/l1/enrollment');
    expect(res.status).toBe(401);
  });

  it('POST /api/lessons/:id/enrollment → 201 si ok', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue({
      ...fullLesson,
      allowSelfEnroll: true,
    });
    prismaMock.clubMembership.findFirst.mockResolvedValue(null as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([] as any);
    prismaMock.lessonEnrollment.findUnique.mockResolvedValue(null);
    prismaMock.lessonEnrollment.count.mockResolvedValue(0);
    prismaMock.lessonEnrollment.create.mockResolvedValue({ id: 'e1', status: 'CONFIRMED' } as any);
    const res = await request(app)
      .post('/api/lessons/l1/enrollment')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(201);
  });

  it('DELETE /api/lessons/:id/enrollment sans auth → 401', async () => {
    const res = await request(app).delete('/api/lessons/l1/enrollment');
    expect(res.status).toBe(401);
  });

  it('DELETE /api/lessons/:id/enrollment → 200 si ok', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue({
      ...fullLesson,
      reservation: { startTime: new Date(Date.now() + 86400000) },
    });
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([] as any);
    prismaMock.lessonEnrollment.findFirst.mockResolvedValue({ id: 'e1', status: 'CONFIRMED' } as any);
    prismaMock.lessonEnrollment.update.mockResolvedValue({} as any);
    const res = await request(app)
      .delete('/api/lessons/l1/enrollment')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('GET /api/me/lessons → 200', async () => {
    prismaMock.lessonEnrollment.findMany.mockResolvedValue([] as any);
    const res = await request(app)
      .get('/api/me/lessons')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('GET /api/me/lessons sans auth → 401', async () => {
    const res = await request(app).get('/api/me/lessons');
    expect(res.status).toBe(401);
  });
});
