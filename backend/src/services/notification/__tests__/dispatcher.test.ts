import '../../../__mocks__/prisma';
import { prismaMock } from '../../../__mocks__/prisma';

jest.mock('../../../email/mailer', () => ({ sendMail: jest.fn() }));
jest.mock('../../sse.service', () => ({
  SSEService: { getInstance: () => ({ notifyUser: jest.fn() }) },
}));
jest.mock('../push', () => ({ deliverPush: jest.fn(), resolvePushIcon: jest.fn(), resolvePushBadge: jest.fn() }));

import { dispatch } from '../dispatcher';
import { sendMail } from '../../../email/mailer';
import { deliverPush, resolvePushIcon, resolvePushBadge } from '../push';

const base = {
  userId: 'user-1', clubId: 'club-demo', category: 'MY_GAMES' as const,
  type: 'open_match.joined', title: 'T', body: 'B', url: '/parties',
};

describe('dispatch', () => {
  beforeEach(() => {
    (sendMail as jest.Mock).mockClear();
    (deliverPush as jest.Mock).mockClear();
    (resolvePushIcon as jest.Mock).mockClear();
    (resolvePushBadge as jest.Mock).mockClear();
    prismaMock.notificationPreference.findMany.mockResolvedValue([] as any);
    prismaMock.notification.create.mockResolvedValue({ id: 'n1' } as any);
    prismaMock.pushSubscription.findMany.mockResolvedValue([] as any);
    (sendMail as jest.Mock).mockResolvedValue(undefined);
    (deliverPush as jest.Mock).mockResolvedValue(undefined);
    (resolvePushIcon as jest.Mock).mockResolvedValue('http://localhost:3001/api/clubs/padel-arena-paris/icon/192.png');
    (resolvePushBadge as jest.Mock).mockResolvedValue('http://localhost:3001/api/clubs/padel-arena-paris/icon/badge-96.png');
  });

  it('crée la Notification in-app (défaut ON)', async () => {
    await dispatch(base);
    expect(prismaMock.notification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'user-1', category: 'MY_GAMES', type: 'open_match.joined' }),
    }));
  });

  it('envoie l email quand un payload email est fourni et le canal actif', async () => {
    await dispatch({ ...base, email: { to: 'u@x.fr', subject: 'S', html: '<b/>', text: 'S' } });
    expect(sendMail).toHaveBeenCalledWith({ to: 'u@x.fr', subject: 'S', html: '<b/>', text: 'S' });
  });

  it('respecte l opt-out email (ligne enabled=false) sans bloquer la cloche', async () => {
    prismaMock.notificationPreference.findMany.mockResolvedValue(
      [{ category: 'MY_GAMES', channel: 'EMAIL', enabled: false }] as any);
    await dispatch({ ...base, email: { to: 'u@x.fr', subject: 'S', html: '', text: 'S' } });
    expect(sendMail).not.toHaveBeenCalled();
    expect(prismaMock.notification.create).toHaveBeenCalled();
  });

  it('opt-out INAPP : pas de Notification créée', async () => {
    prismaMock.notificationPreference.findMany.mockResolvedValue(
      [{ category: 'MY_GAMES', channel: 'INAPP', enabled: false }] as any);
    await dispatch(base);
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });

  it('best-effort : un échec email ne lève pas', async () => {
    (sendMail as jest.Mock).mockRejectedValue(new Error('SMTP down'));
    await expect(dispatch({ ...base, email: { to: 'u@x.fr', subject: 'S', html: '', text: 'S' } }))
      .resolves.toBeUndefined();
  });

  it('appelle deliverPush avec l icône résolue (club ou repli Palova) quand l utilisateur a un abonnement et PUSH est actif (défaut)', async () => {
    const sub = { endpoint: 'https://push.example.com/s1', p256dh: 'key1', auth: 'auth1' };
    prismaMock.pushSubscription.findMany.mockResolvedValue([sub] as any);

    await dispatch(base);

    expect(resolvePushIcon).toHaveBeenCalledWith(base.clubId);
    expect(deliverPush).toHaveBeenCalledWith(
      [sub],
      {
        title: base.title, body: base.body, url: base.url ?? null,
        icon: 'http://localhost:3001/api/clubs/padel-arena-paris/icon/192.png',
        badge: 'http://localhost:3001/api/clubs/padel-arena-paris/icon/badge-96.png',
      },
    );
  });

  it('résout l icône Palova quand la notif n est rattachée à aucun club', async () => {
    const sub = { endpoint: 'https://push.example.com/s1', p256dh: 'key1', auth: 'auth1' };
    prismaMock.pushSubscription.findMany.mockResolvedValue([sub] as any);
    (resolvePushIcon as jest.Mock).mockResolvedValue('http://localhost:3000/icon-192.png');
    (resolvePushBadge as jest.Mock).mockResolvedValue('http://localhost:3000/icon-badge-96.png');

    await dispatch({ ...base, clubId: null });

    expect(resolvePushIcon).toHaveBeenCalledWith(null);
    expect(deliverPush).toHaveBeenCalledWith(
      [sub],
      {
        title: base.title, body: base.body, url: base.url ?? null,
        icon: 'http://localhost:3000/icon-192.png', badge: 'http://localhost:3000/icon-badge-96.png',
      },
    );
  });

  it('appelle deliverPush avec le badge Android résolu (silhouette monochrome)', async () => {
    const sub = { endpoint: 'https://push.example.com/s1', p256dh: 'key1', auth: 'auth1' };
    prismaMock.pushSubscription.findMany.mockResolvedValue([sub] as any);

    await dispatch(base);

    expect(resolvePushBadge).toHaveBeenCalledWith(base.clubId);
    expect(deliverPush).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ badge: expect.anything() }));
  });

  it('ne appelle PAS deliverPush quand l utilisateur n a pas d abonnement', async () => {
    prismaMock.pushSubscription.findMany.mockResolvedValue([] as any);

    await dispatch(base);

    expect(deliverPush).not.toHaveBeenCalled();
  });

  // Plafond appelant (ex. diffusion club : le club choisit les canaux).
  it('allowChannels.inapp=false coupe la cloche (plafond appelant)', async () => {
    await dispatch({ ...base, allowChannels: { inapp: false } });
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });

  it('allowChannels.email=false coupe l email même avec un payload', async () => {
    await dispatch({ ...base, email: { to: 'u@x.fr', subject: 'S', html: '', text: 'S' }, allowChannels: { email: false } });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('allowChannels.push=false coupe le push (abonnement présent)', async () => {
    prismaMock.pushSubscription.findMany.mockResolvedValue([{ endpoint: 'https://p/1', p256dh: 'k', auth: 'a' }] as any);
    await dispatch({ ...base, allowChannels: { push: false } });
    expect(deliverPush).not.toHaveBeenCalled();
  });

  it('allowChannels tous true : comportement inchangé (cloche + push)', async () => {
    prismaMock.pushSubscription.findMany.mockResolvedValue([{ endpoint: 'https://p/1', p256dh: 'k', auth: 'a' }] as any);
    await dispatch({ ...base, allowChannels: { inapp: true, email: true, push: true } });
    expect(prismaMock.notification.create).toHaveBeenCalled();
    expect(deliverPush).toHaveBeenCalled();
  });
});
