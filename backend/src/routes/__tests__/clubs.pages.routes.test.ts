import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import app from '../../app';

const activeSocleClub = {
  id: 'club-1', status: 'ACTIVE', name: 'Padel Arena', slug: 'arena',
  publicBookingDays: 7, memberBookingDays: 14, cancellationCutoffHours: 24, playerChangeCutoffHours: 0,
  refundOnCancelWithinCutoff: true, requireOnlinePayment: false, legalEmail: 'c@a.fr', legalPhone: null,
};

describe('public — FAQ', () => {
  it('GET /api/clubs/:slug/faq → 200 { socle, custom }', async () => {
    prismaMock.club.findUnique.mockResolvedValue(activeSocleClub as any);
    prismaMock.clubFaqItem.findMany.mockResolvedValue([
      { id: 'f1', question: 'Parking ?', answerMarkdown: 'Oui', category: 'Accès' },
    ] as any);
    const res = await request(app).get('/api/clubs/arena/faq');
    expect(res.status).toBe(200);
    expect(res.body.socle.length).toBeGreaterThan(5);
    expect(res.body.custom).toEqual([{ id: 'f1', category: 'Accès', question: 'Parking ?', answer: 'Oui' }]);
  });

  it('GET /api/clubs/:slug/faq club inconnu → 404', async () => {
    prismaMock.club.findUnique.mockResolvedValue(null as any);
    const res = await request(app).get('/api/clubs/inconnu/faq');
    expect(res.status).toBe(404);
  });
});

describe('public — pages de contenu', () => {
  it('GET /api/clubs/:slug/pages/:kind publiée → 200', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-1', status: 'ACTIVE' } as any);
    prismaMock.clubPage.findFirst.mockResolvedValue({ kind: 'CGV', bodyMarkdown: '# CGV', updatedAt: new Date() } as any);
    const res = await request(app).get('/api/clubs/arena/pages/CGV');
    expect(res.status).toBe(200);
    expect(res.body.bodyMarkdown).toBe('# CGV');
  });

  it('GET /api/clubs/:slug/pages/:kind non publiée → 404', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-1', status: 'ACTIVE' } as any);
    prismaMock.clubPage.findFirst.mockResolvedValue(null as any);
    const res = await request(app).get('/api/clubs/arena/pages/CGV');
    expect(res.status).toBe(404);
  });

  it('GET /api/clubs/:slug/pages/:kind type inconnu → 400', async () => {
    const res = await request(app).get('/api/clubs/arena/pages/BADKIND');
    expect(res.status).toBe(400);
  });
});
