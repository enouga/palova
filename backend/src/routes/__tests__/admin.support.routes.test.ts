import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import '../../__mocks__/redis'; // cache auth (merge perfs 2026-07-18) — inoffensif si inutile
import request from 'supertest';
import jwt from 'jsonwebtoken';

const assertRateLimitMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/rateLimit', () => ({ assertRateLimit: (...a: unknown[]) => assertRateLimitMock(...a) }));
jest.mock('../../email/mailer', () => ({ sendMail: jest.fn().mockResolvedValue(undefined) }));

import app from '../../app';

const SECRET = process.env.JWT_SECRET!;
if (!SECRET) throw new Error('JWT_SECRET manquant');
const token = jwt.sign({ id: 'user-1', email: 'jean@x.fr' }, SECRET, { expiresIn: '1h' });
const url = '/api/clubs/club-demo/admin/support/tickets';
const BODY = { category: 'BUG', subject: 'Planning cassé', description: 'Le planning ne charge plus sur mobile.' };

const fetchMock = jest.fn();
global.fetch = fetchMock as unknown as typeof fetch;

const asMember = (role = 'STAFF') => prismaMock.clubMember.findUnique.mockResolvedValue({ role } as any);

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ number: 42 }) });
  assertRateLimitMock.mockClear().mockResolvedValue(undefined);
  process.env.GITHUB_SUPPORT_TOKEN = 'ghp_test';
  process.env.GITHUB_SUPPORT_REPO = 'enouga/palova-support';
  prismaMock.club.findUnique.mockResolvedValue({ name: 'Padel Arena Paris', slug: 'padel-arena-paris' } as any);
  prismaMock.user.findUnique.mockResolvedValue({ deletedAt: null, firstName: 'Jean', lastName: 'Dupont', email: 'jean@x.fr' } as any);
});

afterEach(() => { delete process.env.GITHUB_SUPPORT_TOKEN; delete process.env.GITHUB_SUPPORT_REPO; });

describe('POST /admin/support/tickets', () => {
  it('201 pour un STAFF, renvoie le numéro, applique le rate limit', async () => {
    asMember('STAFF');
    const res = await request(app).post(url).set('Authorization', `Bearer ${token}`).send(BODY);
    expect(res.status).toBe(201);
    expect(res.body.number).toBe(42);
    expect(assertRateLimitMock).toHaveBeenCalledWith('support', 'user-1', 5, 3600);
  });

  it('403 si non membre du club', async () => {
    prismaMock.clubMember.findUnique.mockResolvedValue(null as any);
    const res = await request(app).post(url).set('Authorization', `Bearer ${token}`).send(BODY);
    expect(res.status).toBe(403);
  });

  it('400 sur catégorie inconnue', async () => {
    asMember('STAFF');
    const res = await request(app).post(url).set('Authorization', `Bearer ${token}`).send({ ...BODY, category: 'NOPE' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('429 quand le rate limit lève', async () => {
    asMember('STAFF');
    assertRateLimitMock.mockRejectedValue(new Error('RATE_LIMITED'));
    const res = await request(app).post(url).set('Authorization', `Bearer ${token}`).send(BODY);
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('RATE_LIMITED');
    expect(fetchMock).not.toHaveBeenCalled(); // rate-limited AVANT tout travail couteux (GitHub)
  });
});
