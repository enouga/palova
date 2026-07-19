import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';
import { EventService } from '../../services/event.service';

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET manquant dans l environnement de test (.env)');
const token = () => jwt.sign({ id: 'u1', email: 'owner@x.fr' }, process.env.JWT_SECRET!);
const auth = { Authorization: `Bearer ${token()}` };
const base = '/api/clubs/club-demo/admin';

beforeEach(() => {
  prismaMock.clubMember.findUnique.mockResolvedValue({ userId: 'u1', clubId: 'club-demo', role: 'OWNER' } as any);
});

const validEventBody = {
  name: 'Mêlée test',
  kind: 'MELEE',
  startTime: new Date(Date.now() + 86400_000).toISOString(),
  registrationDeadline: new Date(Date.now() + 3600_000).toISOString(),
};

const fakeEvent = {
  id: 'ev1',
  clubId: 'club-demo',
  name: 'Mêlée test',
  kind: 'MELEE',
  description: null,
  startTime: new Date(Date.now() + 86400_000),
  endTime: null,
  registrationDeadline: new Date(Date.now() + 3600_000),
  capacity: null,
  price: null,
  memberOnly: true,
  status: 'DRAFT',
  clubSportId: null,
};

describe('routes admin /events', () => {
  describe('POST /events — création', () => {
    it('crée un event sans clubSportId → 201', async () => {
      prismaMock.clubEvent.create.mockResolvedValue(fakeEvent as any);
      const res = await request(app)
        .post(`${base}/events`)
        .set(auth)
        .send(validEventBody);
      expect(res.status).toBe(201);
    });

    it('crée un event avec clubSportId → 201, transmet le clubSportId au service', async () => {
      const spy = jest.spyOn(EventService.prototype, 'createEvent').mockResolvedValue({
        ...fakeEvent,
        clubSportId: 'cs1',
      } as any);

      const res = await request(app)
        .post(`${base}/events`)
        .set(auth)
        .send({ ...validEventBody, clubSportId: 'cs1' });

      expect(res.status).toBe(201);
      expect(spy).toHaveBeenCalledWith(
        'club-demo',
        expect.objectContaining({ clubSportId: 'cs1' }),
      );
      spy.mockRestore();
    });

    it('POST sans token → 401', async () => {
      const res = await request(app).post(`${base}/events`).send(validEventBody);
      expect(res.status).toBe(401);
    });
  });

  describe('PATCH /events/:id — mise à jour', () => {
    it('met à jour le clubSportId → 200, transmet la valeur au service', async () => {
      const spy = jest.spyOn(EventService.prototype, 'updateEvent').mockResolvedValue({
        ...fakeEvent,
        clubSportId: 'cs2',
      } as any);

      const res = await request(app)
        .patch(`${base}/events/ev1`)
        .set(auth)
        .send({ clubSportId: 'cs2' });

      expect(res.status).toBe(200);
      expect(spy).toHaveBeenCalledWith(
        'ev1',
        'club-demo',
        expect.objectContaining({ clubSportId: 'cs2' }),
      );
      spy.mockRestore();
    });

    it('efface le sport (null) → 200', async () => {
      const spy = jest.spyOn(EventService.prototype, 'updateEvent').mockResolvedValue({
        ...fakeEvent,
        clubSportId: null,
      } as any);

      const res = await request(app)
        .patch(`${base}/events/ev1`)
        .set(auth)
        .send({ clubSportId: null });

      expect(res.status).toBe(200);
      expect(spy).toHaveBeenCalledWith(
        'ev1',
        'club-demo',
        expect.objectContaining({ clubSportId: null }),
      );
      spy.mockRestore();
    });
  });

  describe('POST /event-series — création', () => {
    const seriesBody = {
      name: 'Mêlée du jeudi', kind: 'MELEE', weekday: 4, startLocal: '18:00', durationMin: 90,
      deadlineLeadMinutes: 240, startDate: '2026-08-06', endDate: '2026-08-27', status: 'PUBLISHED',
    };

    it('crée une série → 201, transmet le body au service', async () => {
      const spy = jest.spyOn(EventService.prototype, 'adminCreateSeries')
        .mockResolvedValue({ seriesId: 'series-1', created: 4 });
      const res = await request(app).post(`${base}/event-series`).set(auth).send(seriesBody);
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ seriesId: 'series-1', created: 4 });
      expect(spy).toHaveBeenCalledWith('club-demo', expect.objectContaining({ weekday: 4, startLocal: '18:00' }));
      spy.mockRestore();
    });

    it('weekday non entier → 400', async () => {
      const res = await request(app).post(`${base}/event-series`).set(auth).send({ ...seriesBody, weekday: 'jeudi' });
      expect(res.status).toBe(400);
    });

    it('dates au mauvais format → 400', async () => {
      const res = await request(app).post(`${base}/event-series`).set(auth).send({ ...seriesBody, startDate: '06/08/2026' });
      expect(res.status).toBe(400);
    });

    it('série trop longue → 400 SERIES_TOO_LONG', async () => {
      jest.spyOn(EventService.prototype, 'adminCreateSeries').mockRejectedValue(new Error('SERIES_TOO_LONG'));
      const res = await request(app).post(`${base}/event-series`).set(auth).send(seriesBody);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('SERIES_TOO_LONG');
    });
  });

  describe('POST /event-series/:id/extend — prolongation', () => {
    it('prolonge → 200', async () => {
      const spy = jest.spyOn(EventService.prototype, 'adminExtendSeries').mockResolvedValue({ created: 2 });
      const res = await request(app).post(`${base}/event-series/series-1/extend`).set(auth).send({ endDate: '2026-09-10' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ created: 2 });
      expect(spy).toHaveBeenCalledWith('series-1', 'club-demo', '2026-09-10');
      spy.mockRestore();
    });

    it('endDate au mauvais format → 400', async () => {
      const res = await request(app).post(`${base}/event-series/series-1/extend`).set(auth).send({ endDate: '10-09-2026' });
      expect(res.status).toBe(400);
    });

    it('série introuvable → 404', async () => {
      jest.spyOn(EventService.prototype, 'adminExtendSeries').mockRejectedValue(new Error('SERIES_NOT_FOUND'));
      const res = await request(app).post(`${base}/event-series/missing/extend`).set(auth).send({ endDate: '2026-09-10' });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /event-series/:id — annulation en bloc', () => {
    it('annule la série → 200', async () => {
      const spy = jest.spyOn(EventService.prototype, 'adminCancelSeries').mockResolvedValue({ cancelled: 2 });
      const res = await request(app).delete(`${base}/event-series/series-1`).set(auth);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ cancelled: 2 });
      expect(spy).toHaveBeenCalledWith('series-1', 'club-demo');
      spy.mockRestore();
    });

    it('série introuvable → 404', async () => {
      jest.spyOn(EventService.prototype, 'adminCancelSeries').mockRejectedValue(new Error('SERIES_NOT_FOUND'));
      const res = await request(app).delete(`${base}/event-series/missing`).set(auth);
      expect(res.status).toBe(404);
    });
  });
});
