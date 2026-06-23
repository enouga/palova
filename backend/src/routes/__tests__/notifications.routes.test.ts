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

describe('Push Subscriptions API', () => {
  it('POST /api/me/push-subscriptions avec keys imbriquées → 200 { ok: true } + upsert appelé', async () => {
    prismaMock.pushSubscription.upsert.mockResolvedValue({} as any);
    const body = { endpoint: 'https://push.example/sub1', keys: { p256dh: 'key1', auth: 'auth1' } };
    const res = await request(app)
      .post('/api/me/push-subscriptions')
      .set('Authorization', auth)
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(prismaMock.pushSubscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { endpoint: 'https://push.example/sub1' },
        create: expect.objectContaining({ endpoint: 'https://push.example/sub1', p256dh: 'key1', auth: 'auth1', userId: 'user-1' }),
        update: expect.objectContaining({ p256dh: 'key1', auth: 'auth1', userId: 'user-1' }),
      }),
    );
  });

  it('POST /api/me/push-subscriptions avec champs plats → 200 { ok: true }', async () => {
    prismaMock.pushSubscription.upsert.mockResolvedValue({} as any);
    const body = { endpoint: 'https://push.example/sub2', p256dh: 'key2', auth: 'auth2' };
    const res = await request(app)
      .post('/api/me/push-subscriptions')
      .set('Authorization', auth)
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('POST /api/me/push-subscriptions sans clés → 400 INVALID_SUBSCRIPTION', async () => {
    const res = await request(app)
      .post('/api/me/push-subscriptions')
      .set('Authorization', auth)
      .send({ endpoint: 'https://push.example/sub3' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_SUBSCRIPTION');
  });

  it('DELETE /api/me/push-subscriptions → 200 { ok: true } + deleteMany scopé userId', async () => {
    prismaMock.pushSubscription.deleteMany.mockResolvedValue({ count: 1 } as any);
    const body = { endpoint: 'https://push.example/sub1' };
    const res = await request(app)
      .delete('/api/me/push-subscriptions')
      .set('Authorization', auth)
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(prismaMock.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { endpoint: 'https://push.example/sub1', userId: 'user-1' },
    });
  });
});

describe('VAPID Public Key API', () => {
  it('GET /api/push/vapid-public-key → 200 avec propriété publicKey (sans auth)', async () => {
    const res = await request(app).get('/api/push/vapid-public-key');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('publicKey');
  });
});
