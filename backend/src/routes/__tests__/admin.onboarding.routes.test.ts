import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';

let getStatusImpl = jest.fn();

jest.mock('../../services/onboarding.service', () => ({
  OnboardingService: jest.fn().mockImplementation(() => ({
    getStatus: (...a: any[]) => getStatusImpl(...a),
  })),
}));

import app from '../../app';

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET manquant');
const auth = { Authorization: `Bearer ${jwt.sign({ id: 'u1', email: 'owner@x.fr' }, process.env.JWT_SECRET!)}` };
const url = '/api/clubs/club-demo/admin/onboarding-status';

beforeEach(() => {
  prismaMock.clubMember.findUnique.mockResolvedValue({ userId: 'u1', clubId: 'club-demo', role: 'ADMIN' } as any);
  getStatusImpl = jest.fn().mockResolvedValue({
    hasLogo: true, sportsCount: 1, resourcesCount: 4,
    hasPresentation: false, stripeStatus: 'NONE', offersCount: 0, eventsCount: 0,
  });
});

describe('GET /api/clubs/:clubId/admin/onboarding-status', () => {
  it('401 sans token', async () => {
    expect((await request(app).get(url)).status).toBe(401);
  });

  it('403 pour STAFF', async () => {
    prismaMock.clubMember.findUnique.mockResolvedValue({ userId: 'u1', clubId: 'club-demo', role: 'STAFF' } as any);
    expect((await request(app).get(url).set(auth)).status).toBe(403);
  });

  it('200 pour ADMIN, renvoie le statut du service', async () => {
    const res = await request(app).get(url).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.resourcesCount).toBe(4);
    expect(getStatusImpl).toHaveBeenCalledWith('club-demo');
  });

  it('404 si le service jette CLUB_NOT_FOUND', async () => {
    getStatusImpl.mockRejectedValue(new Error('CLUB_NOT_FOUND'));
    expect((await request(app).get(url).set(auth)).status).toBe(404);
  });
});
