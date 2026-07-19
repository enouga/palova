import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import app from '../../app';
import { unsubscribeToken } from '../../services/unsubscribeToken';

describe('GET /api/unsubscribe', () => {
  beforeEach(() => jest.clearAllMocks());

  it('token valide → opt-out CLUB_MESSAGES/EMAIL + page de confirmation', async () => {
    prismaMock.notificationPreference.upsert.mockResolvedValue({} as never);
    const res = await request(app).get(`/api/unsubscribe?token=${unsubscribeToken('u1')}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('désinscrit');
    expect(prismaMock.notificationPreference.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId_category_channel: { userId: 'u1', category: 'CLUB_MESSAGES', channel: 'EMAIL' } },
      create: expect.objectContaining({ enabled: false }),
      update: { enabled: false },
    }));
  });

  it('action=resubscribe → enabled true', async () => {
    prismaMock.notificationPreference.upsert.mockResolvedValue({} as never);
    const res = await request(app).get(`/api/unsubscribe?token=${unsubscribeToken('u1')}&action=resubscribe`);
    expect(res.status).toBe(200);
    expect(prismaMock.notificationPreference.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { enabled: true } }));
  });

  it('token invalide → 400 sans écriture', async () => {
    const res = await request(app).get('/api/unsubscribe?token=xxx');
    expect(res.status).toBe(400);
    expect(prismaMock.notificationPreference.upsert).not.toHaveBeenCalled();
  });
});
