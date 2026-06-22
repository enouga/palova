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
});
