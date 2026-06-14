import '../../__mocks__/prisma';
import '../../__mocks__/redis';
import { prismaMock } from '../../__mocks__/prisma';
import { redisMock } from '../../__mocks__/redis';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';

const SECRET = process.env.JWT_SECRET!;
if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET manquant dans l environnement de test (.env)');
const token = jwt.sign({ id: 'user-1', email: 'u@x.fr' }, SECRET, { expiresIn: '1h' });

const slot = () => {
  const start = new Date(Date.now() + 2 * 24 * 3600 * 1000); // J+2 (dans la fenêtre publique)
  return { startTime: start.toISOString(), endTime: new Date(start.getTime() + 3_600_000).toISOString() };
};
const mockDouble = () => prismaMock.resource.findUniqueOrThrow.mockResolvedValue({
  price: 25, offPeakPrice: null, clubId: 'club-demo', attributes: { format: 'double' },
  club: { timezone: 'Europe/Paris', offPeakHours: null, publicBookingDays: 7, memberBookingDays: 14, bookingQuotas: null },
} as any);

describe('POST /api/reservations/hold (multi-joueurs)', () => {
  beforeEach(() => {
    redisMock.set.mockResolvedValue('OK');
    prismaMock.reservation.count.mockResolvedValue(0 as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE', isSubscriber: false } as any);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.reservationParticipant.createMany.mockResolvedValue({ count: 1 } as any);
  });

  it('201 : transmet partnerUserIds + visibility (résa PUBLIC + lignes participant)', async () => {
    mockDouble();
    prismaMock.clubMembership.findMany.mockResolvedValue([{ userId: 'user-2' }] as any);
    prismaMock.reservation.create.mockResolvedValue({ id: 'res-1', resourceId: 'court-1', status: 'PENDING', totalPrice: 25, visibility: 'PUBLIC', startTime: new Date(), endTime: new Date(), createdAt: new Date() } as any);

    const res = await request(app).post('/api/reservations/hold').set('Authorization', `Bearer ${token}`)
      .send({ resourceId: 'court-1', ...slot(), partnerUserIds: ['user-2'], visibility: 'PUBLIC' });

    expect(res.status).toBe(201);
    expect(prismaMock.reservation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ visibility: 'PUBLIC' }),
    }));
    const rows = (prismaMock.reservationParticipant.createMany as jest.Mock).mock.calls[0][0].data as any[];
    expect(rows).toHaveLength(2);
  });

  it('409 TOO_MANY_PLAYERS quand trop de partenaires pour le format', async () => {
    mockDouble();
    const res = await request(app).post('/api/reservations/hold').set('Authorization', `Bearer ${token}`)
      .send({ resourceId: 'court-1', ...slot(), partnerUserIds: ['user-2', 'user-3', 'user-4', 'user-5'] });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('TOO_MANY_PLAYERS');
  });

  it('400 si visibility est invalide', async () => {
    mockDouble();
    const res = await request(app).post('/api/reservations/hold').set('Authorization', `Bearer ${token}`)
      .send({ resourceId: 'court-1', ...slot(), visibility: 'SECRET' });

    expect(res.status).toBe(400);
  });
});
