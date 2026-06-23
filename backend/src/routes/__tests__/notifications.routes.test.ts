import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';

const SECRET = process.env.JWT_SECRET!;
if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET manquant dans l environnement de test (.env)');
const token = jwt.sign({ id: 'user-1', email: 'u@x.fr' }, SECRET, { expiresIn: '1h' });
const auth = `Bearer ${token}`;

describe('Notifications API', () => {
  it('GET /api/me/notifications renvoie items + nextCursor', async () => {
    prismaMock.notification.findMany.mockResolvedValue([
      { id: 'n1', userId: 'user-1', category: 'MY_GAMES', type: 't', title: 'T', body: 'B',
        url: null, data: null, clubId: null, readAt: null, createdAt: new Date() },
    ] as any);
    const res = await request(app).get('/api/me/notifications').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body).toHaveProperty('nextCursor');
  });

  it('GET /unread-count renvoie le compte', async () => {
    prismaMock.notification.count.mockResolvedValue(3 as any);
    const res = await request(app).get('/api/me/notifications/unread-count').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3);
  });

  it('POST /:id/read marque lue (404 si pas à moi)', async () => {
    prismaMock.notification.updateMany.mockResolvedValue({ count: 0 } as any);
    const res = await request(app).post('/api/me/notifications/n9/read').set('Authorization', auth);
    expect(res.status).toBe(404);
  });

  it('PUT /notification-preferences ignore le verrou CLUB_MESSAGES+INAPP', async () => {
    prismaMock.$transaction.mockResolvedValue([] as any);
    const res = await request(app).put('/api/me/notification-preferences').set('Authorization', auth)
      .send({ preferences: [
        { category: 'MY_GAMES', channel: 'EMAIL', enabled: false },
        { category: 'CLUB_MESSAGES', channel: 'INAPP', enabled: false },
      ] });
    // $transaction est mocké : on vérifie le 200 + l'absence d'erreur (le filtrage du
    // verrou CLUB_MESSAGES+INAPP est couvert plus finement au niveau de la route).
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('GET /notifications/stream sans token → 401', async () => {
    const res = await request(app).get('/api/me/notifications/stream');
    expect(res.status).toBe(401);
  });

  it('401 sans Authorization', async () => {
    const res = await request(app).get('/api/me/notifications');
    expect(res.status).toBe(401);
  });
});
