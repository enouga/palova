import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';

jest.mock('../../email/notifications', () => ({ __esModule: true, notifyMatchPendingConfirmation: jest.fn() }));

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET manquant');
const token = (id = 'u1') => jwt.sign({ id, email: 'x@x.fr' }, process.env.JWT_SECRET!);

beforeEach(() => jest.clearAllMocks());

describe('POST /api/reservations/:id/match', () => {
  it('401 sans token', async () => {
    const res = await request(app).post('/api/reservations/r1/match').send({});
    expect(res.status).toBe(401);
  });

  it('409 si un match existe déjà', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue({
      id: 'r1', type: 'COURT', startTime: new Date('2020-01-01T00:00:00Z'),
      resource: { clubId: 'c1', clubSport: { sportId: 'sport-padel' }, club: { levelSystemEnabled: true } },
      participants: [{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }, { userId: 'u4' }],
    } as any);
    prismaMock.match.findFirst.mockResolvedValue({ id: 'existing' } as any);
    const res = await request(app).post('/api/reservations/r1/match')
      .set('Authorization', `Bearer ${token()}`)
      .send({ teams: { 1: ['u1', 'u2'], 2: ['u3', 'u4'] }, sets: [[6, 4], [6, 3]] });
    expect(res.status).toBe(409);
  });

  it('POST /:id/match → 403 si système de niveau désactivé', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue({
      id: 'r1', type: 'COURT', startTime: new Date('2020-01-01T00:00:00Z'),
      resource: { clubId: 'c1', clubSport: { sportId: 'sport-padel' }, club: { levelSystemEnabled: false } },
      participants: [{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }, { userId: 'u4' }],
    } as any);
    const res = await request(app).post('/api/reservations/r1/match')
      .set('Authorization', `Bearer ${token()}`)
      .send({ teams: { 1: ['u1', 'u2'], 2: ['u3', 'u4'] }, sets: [[6, 4], [6, 3]] });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/matches/:id/confirm', () => {
  it('confirme (200)', async () => {
    prismaMock.match.findUnique.mockResolvedValue({
      id: 'm1', status: 'PENDING',
      players: [
        { userId: 'u1', confirmation: 'CONFIRMED' }, { userId: 'u2', confirmation: 'CONFIRMED' },
        { userId: 'u3', confirmation: 'CONFIRMED' }, { userId: 'u4', confirmation: 'PENDING' },
      ],
    } as any);
    prismaMock.matchPlayer.update.mockResolvedValue({} as any);
    (prismaMock.$transaction as jest.Mock).mockImplementation(async (fn: any) => fn({
      match: { findUnique: jest.fn().mockResolvedValue({ id: 'm1', ratingsAppliedAt: new Date(), players: [], sets: [] }), update: jest.fn() },
      playerRating: { findUnique: jest.fn(), upsert: jest.fn() }, matchPlayer: { update: jest.fn() },
    }));
    const res = await request(app).post('/api/matches/m1/confirm').set('Authorization', `Bearer ${token('u4')}`);
    expect(res.status).toBe(200);
  });
});
