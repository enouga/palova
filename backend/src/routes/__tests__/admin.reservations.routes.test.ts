import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';

const SECRET = process.env.JWT_SECRET!;
if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET manquant dans l environnement de test (.env)');
const token = jwt.sign({ id: 'admin-1', email: 'a@x.fr' }, SECRET, { expiresIn: '1h' });
const url = '/api/clubs/club-demo/admin/reservations';
const body = { resourceId: 'court-1', date: '2026-06-15', startTime: '18:00', endTime: '19:00', type: 'EVENT', title: 'Maintenance' };

const asMember = (role = 'OWNER') => prismaMock.clubMember.findUnique.mockResolvedValue({ role } as any);
const okResource = () => prismaMock.resource.findUnique.mockResolvedValue({ clubId: 'club-demo', club: { timezone: 'Europe/Paris' } } as any);

describe('POST /api/clubs/:clubId/admin/reservations', () => {
  it('201 crée un événement', async () => {
    asMember(); okResource();
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.reservation.count.mockResolvedValue(0 as any);
    prismaMock.reservation.create.mockResolvedValue({ id: 'r-new', resourceId: 'court-1', startTime: new Date(), endTime: new Date() } as any);
    const res = await request(app).post(url).set('Authorization', `Bearer ${token}`).send(body);
    expect(res.status).toBe(201);
    expect(res.body.id).toBe('r-new');
  });

  it('403 si l utilisateur n est pas membre du club', async () => {
    prismaMock.clubMember.findUnique.mockResolvedValue(null as any);
    const res = await request(app).post(url).set('Authorization', `Bearer ${token}`).send(body);
    expect(res.status).toBe(403);
  });

  it('400 si type invalide', async () => {
    asMember();
    const res = await request(app).post(url).set('Authorization', `Bearer ${token}`).send({ ...body, type: 'XXX' });
    expect(res.status).toBe(400);
  });

  it('403 CLUB_MISMATCH si la ressource est d un autre club', async () => {
    asMember();
    prismaMock.resource.findUnique.mockResolvedValue({ clubId: 'autre', club: { timezone: 'Europe/Paris' } } as any);
    const res = await request(app).post(url).set('Authorization', `Bearer ${token}`).send(body);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('CLUB_MISMATCH');
  });

  it('409 si le créneau est déjà pris', async () => {
    asMember(); okResource();
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.reservation.count.mockResolvedValue(1 as any);
    const res = await request(app).post(url).set('Authorization', `Bearer ${token}`).send(body);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('SLOT_NOT_AVAILABLE');
  });
});
