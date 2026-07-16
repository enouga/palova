import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';

const SECRET = process.env.JWT_SECRET!;
if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET manquant');
const token = () => jwt.sign({ id: 'staff1', email: 's@x.fr' }, SECRET, { expiresIn: '1h' });
const auth = { Authorization: `Bearer ${token()}` };
const base = '/api/clubs/club-demo/admin';

beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.clubMember.findUnique.mockResolvedValue({ userId: 'staff1', clubId: 'club-demo', role: 'STAFF' } as any);
  prismaMock.$transaction.mockImplementation(((cb: any) => cb(prismaMock)) as any);
});

describe('PUT /api/clubs/:clubId/admin/sports', () => {
  it('401 sans token', async () => {
    const res = await request(app).put(`${base}/sports`).send({ items: [] });
    expect(res.status).toBe(401);
  });

  it('400 si items n\'est pas un tableau', async () => {
    const res = await request(app).put(`${base}/sports`).set(auth).send({});
    expect(res.status).toBe(400);
  });

  it('200 : applique le lot et renvoie la liste à jour', async () => {
    prismaMock.clubSport.findMany
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([{
        id: 'cs-1', slotStepMin: null, durationsMin: [60],
        sport: { id: 'tennis', key: 'tennis', name: 'Tennis', resourceNoun: 'Court', defaultDurationsMin: [60], surfaces: [], hasLighting: false },
      }] as any);
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'tennis', published: true } as any);
    prismaMock.clubSport.create.mockResolvedValue({} as any);

    const res = await request(app).put(`${base}/sports`).set(auth).send({ items: [{ sportId: 'tennis', durationsMin: [60] }] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{
      id: 'cs-1', slotStepMin: null, durationsMin: [60],
      sport: { id: 'tennis', key: 'tennis', name: 'Tennis', resourceNoun: 'Court', defaultDurationsMin: [60], surfaces: [], hasLighting: false },
    }]);
  });

  it('400 VALIDATION_ERROR : durée invalide', async () => {
    prismaMock.clubSport.findMany.mockResolvedValueOnce([{ sportId: 'padel' }] as any);
    const res = await request(app).put(`${base}/sports`).set(auth).send({ items: [{ sportId: 'padel', durationsMin: [10] }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });
});
