/**
 * Tests for the web-push wrapper (push.ts).
 * VAPID env vars are set BEFORE the module is imported so VAPID is considered configured.
 */

// Set VAPID env vars before any imports so module-load configures VAPID
process.env.VAPID_PUBLIC_KEY = 'test-public-key';
process.env.VAPID_PRIVATE_KEY = 'test-private-key';
process.env.VAPID_SUBJECT = 'mailto:test@example.com';

import '../../../__mocks__/prisma';
import { prismaMock } from '../../../__mocks__/prisma';

jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
}));

import webpush from 'web-push';
import { deliverPush, PushSub, PushPayload } from '../push';

const mockSendNotification = webpush.sendNotification as jest.Mock;

const sub1: PushSub = { endpoint: 'https://push.example.com/sub1', p256dh: 'key1', auth: 'auth1' };
const sub2: PushSub = { endpoint: 'https://push.example.com/sub2', p256dh: 'key2', auth: 'auth2' };
const payload: PushPayload = { title: 'Test Title', body: 'Test body', url: '/test' };

describe('deliverPush', () => {
  beforeEach(() => {
    mockSendNotification.mockClear();
    prismaMock.pushSubscription.delete.mockResolvedValue({} as any);
  });

  it('appelle sendNotification une fois par abonnement avec les bons endpoint/keys et payload JSON', async () => {
    mockSendNotification.mockResolvedValue({});

    await deliverPush([sub1, sub2], payload);

    expect(mockSendNotification).toHaveBeenCalledTimes(2);
    expect(mockSendNotification).toHaveBeenCalledWith(
      { endpoint: sub1.endpoint, keys: { p256dh: sub1.p256dh, auth: sub1.auth } },
      JSON.stringify(payload),
    );
    expect(mockSendNotification).toHaveBeenCalledWith(
      { endpoint: sub2.endpoint, keys: { p256dh: sub2.p256dh, auth: sub2.auth } },
      JSON.stringify(payload),
    );
  });

  it('supprime l abonnement et ne lève pas quand sendNotification rejette avec statusCode 410', async () => {
    const expiredError = Object.assign(new Error('Gone'), { statusCode: 410 });
    mockSendNotification.mockRejectedValue(expiredError);

    await expect(deliverPush([sub1], payload)).resolves.toBeUndefined();

    expect(prismaMock.pushSubscription.delete).toHaveBeenCalledWith({ where: { endpoint: sub1.endpoint } });
  });

  it('supprime l abonnement et ne lève pas quand sendNotification rejette avec statusCode 404', async () => {
    const notFoundError = Object.assign(new Error('Not Found'), { statusCode: 404 });
    mockSendNotification.mockRejectedValue(notFoundError);

    await expect(deliverPush([sub1], payload)).resolves.toBeUndefined();

    expect(prismaMock.pushSubscription.delete).toHaveBeenCalledWith({ where: { endpoint: sub1.endpoint } });
  });

  it('ne supprime PAS l abonnement et ne lève pas pour une erreur non-410/404', async () => {
    const serverError = Object.assign(new Error('Internal Server Error'), { statusCode: 500 });
    mockSendNotification.mockRejectedValue(serverError);

    await expect(deliverPush([sub1], payload)).resolves.toBeUndefined();

    expect(prismaMock.pushSubscription.delete).not.toHaveBeenCalled();
  });
});
