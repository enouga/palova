import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';

// Capturées par la closure de la factory du mock (jest.mock hoisté, corps évalué au 1er require).
let getAdminImpl = jest.fn().mockResolvedValue({ presentationText: 'Bienvenue', photos: [] });
let updateTextImpl = jest.fn().mockResolvedValue({ presentationText: 'Nouveau', photos: [] });

jest.mock('../../services/presentation.service', () => ({
  PresentationService: jest.fn().mockImplementation(() => ({
    getAdmin: (...args: any[]) => getAdminImpl(...args),
    updateText: (...args: any[]) => updateTextImpl(...args),
  })),
}));

import app from '../../app';

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET manquant dans l environnement de test (.env)');

const token = () => jwt.sign({ id: 'u1', email: 'staff@x.fr' }, process.env.JWT_SECRET!);
const auth = { Authorization: `Bearer ${token()}` };
const base = '/api/clubs/club-demo/admin';

beforeEach(() => {
  prismaMock.clubMember.findUnique.mockResolvedValue({ userId: 'u1', clubId: 'club-demo', role: 'STAFF' } as any);
  getAdminImpl.mockClear();
  updateTextImpl.mockClear();
});

// Page club ouverte au staff (2026-07-13) — même mouvement que les routes /emails.
describe('GET /api/clubs/:clubId/admin/presentation', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get(`${base}/presentation`);
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-member', async () => {
    prismaMock.clubMember.findUnique.mockResolvedValue(null as any);
    const res = await request(app).get(`${base}/presentation`).set(auth);
    expect(res.status).toBe(403);
  });

  it('returns 200 for STAFF member', async () => {
    const res = await request(app).get(`${base}/presentation`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ presentationText: 'Bienvenue', photos: [] });
  });
});

describe('PATCH /api/clubs/:clubId/admin/presentation', () => {
  it('returns 200 for STAFF member', async () => {
    const res = await request(app).patch(`${base}/presentation`).set(auth).send({ presentationText: 'Nouveau' });
    expect(res.status).toBe(200);
    expect(updateTextImpl).toHaveBeenCalledWith('club-demo', { presentationText: 'Nouveau' });
  });
});
