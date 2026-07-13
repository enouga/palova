import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';
import { ReservationService } from '../../services/reservation.service';

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

  it('forwarde lessonParams à adminCreateReservation', async () => {
    asMember(); okResource();
    const spy = jest.spyOn(ReservationService.prototype, 'adminCreateReservation').mockResolvedValue({ id: 'res1' } as any);
    await request(app)
      .post(url)
      .set('Authorization', `Bearer ${token}`)
      .send({
        resourceId: 'r1', date: '2026-09-01', startTime: '18:00', endTime: '19:00', type: 'COACHING',
        lessonParams: { coachId: 'c1', capacity: 1, lessonKind: 'INDIVIDUAL', allowSelfEnroll: false },
      });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      lessonParams: expect.objectContaining({ coachId: 'c1', capacity: 1, lessonKind: 'INDIVIDUAL' }),
    }));
    spy.mockRestore();
  });
});

describe('PATCH /api/clubs/:clubId/admin/reservations/:id/member', () => {
  const murl = `${url}/res-1/member`;

  it('200 affecte un membre actif', async () => {
    asMember();
    prismaMock.reservation.findUnique.mockResolvedValue({ id: 'res-1', resource: { clubId: 'club-demo' } } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ id: 'mb-1', status: 'ACTIVE' } as any);
    prismaMock.reservation.update.mockResolvedValue({ id: 'res-1', userId: 'user-1' } as any);
    const res = await request(app).patch(murl).set('Authorization', `Bearer ${token}`).send({ memberUserId: 'user-1' });
    expect(res.status).toBe(200);
    // La route renvoie la réservation enrichie (loadClubReservation) — pas la ligne brute.
    expect(res.body.id).toBe('res-1');
  });

  it('400 si memberUserId manquant', async () => {
    asMember();
    const res = await request(app).patch(murl).set('Authorization', `Bearer ${token}`).send({});
    expect(res.status).toBe(400);
  });

  it('404 MEMBER_NOT_FOUND si le joueur n\'est pas membre', async () => {
    asMember();
    prismaMock.reservation.findUnique.mockResolvedValue({ id: 'res-1', resource: { clubId: 'club-demo' } } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue(null as any);
    const res = await request(app).patch(murl).set('Authorization', `Bearer ${token}`).send({ memberUserId: 'user-1' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('MEMBER_NOT_FOUND');
  });

  it('200 crée le membre à la volée (newMember) puis l\'affecte — un seul aller-retour client', async () => {
    asMember();
    prismaMock.user.findFirst.mockResolvedValue(null as any);           // pas de compte existant sur cet email
    prismaMock.user.create.mockResolvedValue({ id: 'user-new' } as any);
    prismaMock.clubMembership.create.mockResolvedValue({} as any);
    prismaMock.reservation.findUnique.mockResolvedValue({ id: 'res-1', resource: { clubId: 'club-demo' } } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ id: 'mb-1', status: 'ACTIVE' } as any);
    prismaMock.reservation.update.mockResolvedValue({ id: 'res-1', userId: 'user-new' } as any);
    const res = await request(app).patch(murl).set('Authorization', `Bearer ${token}`)
      .send({ newMember: { firstName: 'Jo', lastName: 'Doe', email: 'jo@x.fr' } });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('res-1');
    expect(res.body.createdMember).toMatchObject({ userId: 'user-new', tempPassword: expect.any(String), existed: false });
    expect(prismaMock.user.create).toHaveBeenCalledTimes(1);
    // la réservation est bien affectée au userId fraîchement créé, pas à un id fourni par le client
    expect(prismaMock.reservation.update).toHaveBeenCalledWith(expect.objectContaining({ data: { userId: 'user-new' } }));
  });
});

describe('PATCH /api/clubs/:clubId/admin/reservations/:id/schedule', () => {
  const surl = `${url}/res-1/schedule`;
  const scheduleBody = { resourceId: 'court-2', date: '2026-06-16', startTime: '18:00', endTime: '19:30' };

  it('200 déplace la réservation', async () => {
    asMember();
    const spy = jest.spyOn(ReservationService.prototype, 'adminRescheduleReservation')
      .mockResolvedValue({ id: 'res-1', resourceId: 'court-2' } as any);
    const res = await request(app).patch(surl).set('Authorization', `Bearer ${token}`).send(scheduleBody);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('res-1');
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      clubId: 'club-demo', reservationId: 'res-1', resourceId: 'court-2', date: '2026-06-16', startTime: '18:00', endTime: '19:30',
    }));
    spy.mockRestore();
  });

  it('400 si resourceId manquant', async () => {
    asMember();
    const res = await request(app).patch(surl).set('Authorization', `Bearer ${token}`).send({ ...scheduleBody, resourceId: undefined });
    expect(res.status).toBe(400);
  });

  it('409 SLOT_NOT_AVAILABLE si le créneau cible est pris', async () => {
    asMember();
    jest.spyOn(ReservationService.prototype, 'adminRescheduleReservation').mockRejectedValue(new Error('SLOT_NOT_AVAILABLE'));
    const res = await request(app).patch(surl).set('Authorization', `Bearer ${token}`).send(scheduleBody);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('SLOT_NOT_AVAILABLE');
  });

  it('403 si l utilisateur n est pas membre du club', async () => {
    prismaMock.clubMember.findUnique.mockResolvedValue(null as any);
    const res = await request(app).patch(surl).set('Authorization', `Bearer ${token}`).send(scheduleBody);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/clubs/:clubId/admin/reservations/auto-apply-subscriptions', () => {
  const aurl = `${url}/auto-apply-subscriptions`;

  it('200 balaye le jour donné et renvoie le nombre appliqué', async () => {
    asMember();
    const spy = jest.spyOn(ReservationService.prototype, 'autoApplySubscriptionCoverage')
      .mockResolvedValue({ applied: 2 });
    const res = await request(app).post(aurl).set('Authorization', `Bearer ${token}`).send({ date: '2026-07-12' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ applied: 2 });
    expect(spy).toHaveBeenCalledWith('club-demo', '2026-07-12');
    spy.mockRestore();
  });

  it('sans date : appelle le service avec undefined', async () => {
    asMember();
    const spy = jest.spyOn(ReservationService.prototype, 'autoApplySubscriptionCoverage')
      .mockResolvedValue({ applied: 0 });
    const res = await request(app).post(aurl).set('Authorization', `Bearer ${token}`).send({});
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith('club-demo', undefined);
    spy.mockRestore();
  });

  it('403 si l utilisateur n est pas membre du club', async () => {
    prismaMock.clubMember.findUnique.mockResolvedValue(null as any);
    const res = await request(app).post(aurl).set('Authorization', `Bearer ${token}`).send({ date: '2026-07-12' });
    expect(res.status).toBe(403);
  });
});
