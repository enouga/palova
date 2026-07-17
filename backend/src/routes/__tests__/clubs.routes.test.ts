import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';

// authMiddleware revérifie l'identité en base (tokenVersion/deletedAt, audit pré-MEP §2.2) ;
// cette suite n'a rien d'autre à faire avec Prisma (createClub est mocké en dessous).
jest.mock('../../db/prisma', () => ({
  __esModule: true,
  prisma: { user: { findUnique: jest.fn().mockResolvedValue({ deletedAt: null }) } },
}));

let mockCreateClub: jest.Mock;

jest.mock('../../services/club.service', () => ({
  ClubService: jest.fn().mockImplementation(() => ({
    createClub: (...a: unknown[]) => mockCreateClub(...a),
  })),
}));

const token = jwt.sign({ id: 'u1', email: 'u1@test.fr' }, process.env.JWT_SECRET!);

describe('routes clubs — POST /api/clubs', () => {
  beforeEach(() => {
    mockCreateClub = jest.fn();
  });

  it('mappe SIRET_INVALID sur 400', async () => {
    mockCreateClub.mockRejectedValue(new Error('SIRET_INVALID'));
    const res = await request(app)
      .post('/api/clubs')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Padel Test', siret: 'bad' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'SIRET_INVALID' });
  });

  it('transmet siret et ownerPhone au service', async () => {
    mockCreateClub.mockResolvedValue({ id: 'club-1', slug: 'padel-test' });
    const res = await request(app)
      .post('/api/clubs')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Padel Test', siret: '44306184100047', ownerPhone: '0600000000' });
    expect(res.status).toBe(201);
    expect(mockCreateClub).toHaveBeenCalledWith(
      expect.objectContaining({ siret: '44306184100047', ownerPhone: '0600000000' }),
    );
  });
});
