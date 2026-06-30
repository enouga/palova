import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';

const mockDispatch = jest.fn();
jest.mock('../../services/notification/dispatcher', () => ({ dispatch: (...a: unknown[]) => mockDispatch(...a) }));

import { notifyNewFollower } from '../notifications';

describe('notifyNewFollower', () => {
  beforeEach(() => {
    mockDispatch.mockReset().mockResolvedValue(undefined);
    prismaMock.user.findUnique.mockResolvedValue({ firstName: 'Léa', lastName: 'M' } as any);
    prismaMock.notification.findFirst.mockResolvedValue(null); // pas de notif non lue existante
  });

  it('dispatche une notif SOCIAL in-app/push sans email', async () => {
    await notifyNewFollower('u1', 'u2', 'club-demo');
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    const arg = mockDispatch.mock.calls[0][0];
    expect(arg).toMatchObject({
      userId: 'u2',
      clubId: 'club-demo',
      category: 'SOCIAL',
      type: 'follow.new',
      data: { followerId: 'u1' },
    });
    expect(arg.email).toBeFalsy();
    expect(arg.url).toBe('/me/friends?tab=followers');
  });

  it('coalesce : ne renotifie pas si une notif follow.new non lue du même suiveur existe', async () => {
    prismaMock.notification.findFirst.mockResolvedValue({ id: 'n1' } as any);
    await notifyNewFollower('u1', 'u2', 'club-demo');
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});
