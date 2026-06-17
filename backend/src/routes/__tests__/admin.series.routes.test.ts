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
  prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
  prismaMock.resource.findUnique.mockResolvedValue({ clubId: 'club-demo', club: { timezone: 'Europe/Paris' } } as any);
  prismaMock.reservationSeries.create.mockResolvedValue({ id: 'ser1' } as any);
  prismaMock.reservation.count.mockResolvedValue(0);
  prismaMock.reservation.create.mockResolvedValue({ id: 'r1' } as any);
});

describe('routes admin /reservation-series', () => {
  const validBody = {
    resourceId: 'res1',
    type: 'COACHING',
    weekday: 2,
    startLocal: '18:00',
    durationMin: 90,
    startDate: '2026-06-02',
    endDate: '2026-06-16',
  };

  it('POST /reservation-series valid body → 201, seriesId + created', async () => {
    const res = await request(app)
      .post(`${base}/reservation-series`)
      .set(auth)
      .send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.seriesId).toBe('ser1');
    expect(res.body.created).toBe(3);
  });

  it('POST with type NOPE → 400', async () => {
    const res = await request(app)
      .post(`${base}/reservation-series`)
      .set(auth)
      .send({ ...validBody, type: 'NOPE' });
    expect(res.status).toBe(400);
  });

  it('POST with startDate in wrong format → 400', async () => {
    const res = await request(app)
      .post(`${base}/reservation-series`)
      .set(auth)
      .send({ ...validBody, startDate: '02/06/2026' });
    expect(res.status).toBe(400);
  });

  it('DELETE /reservation-series/:id → 200, cancelled count', async () => {
    prismaMock.reservationSeries.findUnique.mockResolvedValue({ id: 'ser1', clubId: 'club-demo' } as any);
    prismaMock.reservation.findMany.mockResolvedValue([] as any);
    prismaMock.reservation.updateMany.mockResolvedValue({ count: 0 } as any);
    prismaMock.reservationSeries.update.mockResolvedValue({ id: 'ser1' } as any);
    const res = await request(app)
      .delete(`${base}/reservation-series/ser1`)
      .set(auth);
    expect(res.status).toBe(200);
    expect(res.body.cancelled).toBe(0);
  });
});
