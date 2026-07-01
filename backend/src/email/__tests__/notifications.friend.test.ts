import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';

const mockDispatch = jest.fn();
jest.mock('../../services/notification/dispatcher', () => ({ dispatch: (...a: unknown[]) => mockDispatch(...a) }));

import { notifyFriendRequest, notifyFriendAccepted } from '../notifications';

describe('notifyFriendRequest', () => {
  beforeEach(() => {
    mockDispatch.mockReset().mockResolvedValue(undefined);
    prismaMock.user.findUnique.mockResolvedValue({ firstName: 'Léa', lastName: 'M' } as any);
    prismaMock.notification.findFirst.mockResolvedValue(null);
  });

  it('dispatche une notif SOCIAL friend.request in-app/push sans email', async () => {
    await notifyFriendRequest('u1', 'u2', 'club-demo');
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    const arg = mockDispatch.mock.calls[0][0];
    expect(arg).toMatchObject({ userId: 'u2', clubId: 'club-demo', category: 'SOCIAL', type: 'friend.request', data: { requesterId: 'u1' } });
    expect(arg.email).toBeFalsy();
    expect(arg.url).toBe('/me/friends?tab=demandes');
  });

  it('coalesce : ne renotifie pas si une demande non lue du même émetteur existe', async () => {
    prismaMock.notification.findFirst.mockResolvedValue({ id: 'n1' } as any);
    await notifyFriendRequest('u1', 'u2', 'club-demo');
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});

describe('notifyFriendAccepted', () => {
  beforeEach(() => {
    mockDispatch.mockReset().mockResolvedValue(undefined);
    prismaMock.user.findUnique.mockResolvedValue({ firstName: 'Tom', lastName: 'B' } as any);
  });

  it('dispatche friend.accepted au demandeur d\'origine', async () => {
    await notifyFriendAccepted('u2', 'u1', 'club-demo');
    const arg = mockDispatch.mock.calls[0][0];
    expect(arg).toMatchObject({ userId: 'u1', clubId: 'club-demo', category: 'SOCIAL', type: 'friend.accepted', data: { accepterId: 'u2' } });
    expect(arg.url).toBe('/me/friends');
  });
});
