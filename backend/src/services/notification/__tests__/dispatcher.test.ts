import '../../../__mocks__/prisma';
import { prismaMock } from '../../../__mocks__/prisma';

jest.mock('../../../email/mailer', () => ({ sendMail: jest.fn() }));
jest.mock('../../sse.service', () => ({
  SSEService: { getInstance: () => ({ notifyUser: jest.fn() }) },
}));

import { dispatch } from '../dispatcher';
import { sendMail } from '../../../email/mailer';

const base = {
  userId: 'user-1', clubId: 'club-demo', category: 'MY_GAMES' as const,
  type: 'open_match.joined', title: 'T', body: 'B', url: '/parties',
};

describe('dispatch', () => {
  beforeEach(() => {
    (sendMail as jest.Mock).mockClear();
    prismaMock.notificationPreference.findMany.mockResolvedValue([] as any);
    prismaMock.notification.create.mockResolvedValue({ id: 'n1' } as any);
    (sendMail as jest.Mock).mockResolvedValue(undefined);
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
});
