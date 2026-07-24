import '../../__mocks__/redis';
import { redisMock } from '../../__mocks__/redis';
import request from 'supertest';
import app from '../../app';

// La route de disponibilité est publique et doit passer par la lecture par slug
// mise en cache (getClubAvailabilityBySlug) — plus aucun accès Prisma direct ici.
jest.mock('../../db/prisma', () => ({
  __esModule: true,
  prisma: { user: { findUnique: jest.fn().mockResolvedValue({ deletedAt: null }) } },
}));

let mockBySlug: jest.Mock;

jest.mock('../../services/availability.service', () => ({
  AvailabilityService: jest.fn().mockImplementation(() => ({
    getClubAvailabilityBySlug: (...a: unknown[]) => mockBySlug(...a),
  })),
}));

describe('routes clubs — GET /api/clubs/:slug/availability', () => {
  beforeEach(() => {
    mockBySlug = jest.fn();
  });

  it('sert la disponibilité via la lecture par slug mise en cache', async () => {
    const payload = [{ resource: { id: 'r1' }, slots: [] }];
    mockBySlug.mockResolvedValue(payload);

    const res = await request(app).get('/api/clubs/padel-arena/availability?date=2026-07-18&duration=60');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(payload);
    expect(mockBySlug).toHaveBeenCalledWith('padel-arena', '2026-07-18', 60, undefined);
  });

  it('transmet clubSportId quand fourni', async () => {
    mockBySlug.mockResolvedValue([]);

    await request(app).get('/api/clubs/padel-arena/availability?date=2026-07-18&duration=90&clubSportId=cs-1');

    expect(mockBySlug).toHaveBeenCalledWith('padel-arena', '2026-07-18', 90, 'cs-1');
  });

  it('mappe CLUB_NOT_FOUND sur 404', async () => {
    mockBySlug.mockRejectedValue(new Error('CLUB_NOT_FOUND'));

    const res = await request(app).get('/api/clubs/inconnu/availability?date=2026-07-18&duration=60');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'CLUB_NOT_FOUND' });
  });

  it('mappe INVALID_DATE sur 400 (date bien formée mais inexistante)', async () => {
    mockBySlug.mockRejectedValue(new Error('INVALID_DATE'));

    const res = await request(app).get('/api/clubs/padel-arena/availability?date=2026-02-31&duration=60');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'INVALID_DATE' });
  });

  it('refuse une date mal formée sans appeler le service', async () => {
    const res = await request(app).get('/api/clubs/padel-arena/availability?date=18-07-2026&duration=60');

    expect(res.status).toBe(400);
    expect(mockBySlug).not.toHaveBeenCalled();
  });

  it('renvoie 429 RATE_LIMITED quand la limite par IP est dépassée', async () => {
    redisMock.incr.mockResolvedValue(241); // > 240/min

    const res = await request(app).get('/api/clubs/padel-arena/availability?date=2026-07-18&duration=60');

    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: 'RATE_LIMITED' });
    expect(mockBySlug).not.toHaveBeenCalled();
  });

  it('fail-open : si Redis est indisponible, la lecture n\'est jamais bloquée', async () => {
    redisMock.incr.mockRejectedValue(new Error('Redis down'));
    mockBySlug.mockResolvedValue([]);

    const res = await request(app).get('/api/clubs/padel-arena/availability?date=2026-07-18&duration=60');

    expect(res.status).toBe(200);
  });
});
