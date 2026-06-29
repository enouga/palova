import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';

const dispatchMock = jest.fn();
jest.mock('../../services/notification/dispatcher', () => ({ dispatch: (...a: unknown[]) => dispatchMock(...a) }));

// Mock SSEService so notifications.ts can call getInstance().getMatchUserIds() without a real server.
const getMatchUserIdsMock = jest.fn<Set<string>, [string]>().mockReturnValue(new Set<string>());
jest.mock('../../services/sse.service', () => ({
  SSEService: {
    getInstance: () => ({ getMatchUserIds: getMatchUserIdsMock }),
  },
}));

import { notifyOpenMatchChatMessage } from '../notifications';

beforeEach(() => {
  jest.clearAllMocks();
  getMatchUserIdsMock.mockReturnValue(new Set<string>());
});

it('notifie les membres du chat sauf l auteur et sauf les connectes au SSE', async () => {
  // Reservation with 3 participants: author, present (connected via SSE), absent
  prismaMock.reservation.findUnique.mockResolvedValue({
    startTime: new Date('2026-07-01T10:00:00Z'),
    endTime: new Date('2026-07-01T11:30:00Z'),
    resource: {
      name: 'Court 1',
      club: { id: 'club1', slug: 'demo' },
    },
    participants: [
      { userId: 'author' },
      { userId: 'present' },
      { userId: 'absent' },
    ],
    openMatchMessages: [
      { id: 'm1', body: 'coucou', user: { firstName: 'A', lastName: 'B' } },
    ],
  } as any);

  // 'curious' is interested (not a participant)
  prismaMock.openMatchInterest.findMany.mockResolvedValue([{ userId: 'curious' }] as any);

  // No existing unread notifications for any recipient
  prismaMock.notification.findFirst.mockResolvedValue(null as any);

  // 'present' is connected to the SSE feed → excluded
  getMatchUserIdsMock.mockReturnValue(new Set(['present']));

  await notifyOpenMatchChatMessage('resa1', 'm1', 'author');

  // author excluded (is author), present excluded (connected), absent + curious notified
  const targets = (dispatchMock as jest.Mock).mock.calls.map((c: any[]) => c[0].userId).sort();
  expect(targets).toEqual(['absent', 'curious']);
});

it('saute un destinataire qui a deja une notif message non lue (coalescing)', async () => {
  prismaMock.reservation.findUnique.mockResolvedValue({
    startTime: new Date('2026-07-01T10:00:00Z'),
    endTime: new Date('2026-07-01T11:30:00Z'),
    resource: {
      name: 'Court 1',
      club: { id: 'club1', slug: 'demo' },
    },
    participants: [
      { userId: 'author' },
      { userId: 'absent' },
    ],
    openMatchMessages: [
      { id: 'm2', body: 'second message', user: { firstName: 'A', lastName: 'B' } },
    ],
  } as any);

  prismaMock.openMatchInterest.findMany.mockResolvedValue([] as any);

  // 'absent' already has an unread notification for this match
  prismaMock.notification.findFirst.mockResolvedValue({ id: 'existing-notif' } as any);

  await notifyOpenMatchChatMessage('resa1', 'm2', 'author');

  // absent is skipped due to coalescing
  expect(dispatchMock).not.toHaveBeenCalled();
});

it('ne fait rien si la reservation est introuvable', async () => {
  prismaMock.reservation.findUnique.mockResolvedValue(null as any);

  await expect(notifyOpenMatchChatMessage('nope', 'm1', 'author')).resolves.toBeUndefined();
  expect(dispatchMock).not.toHaveBeenCalled();
});

it('ne fait rien si le message est introuvable dans la reservation', async () => {
  prismaMock.reservation.findUnique.mockResolvedValue({
    startTime: new Date('2026-07-01T10:00:00Z'),
    endTime: new Date('2026-07-01T11:30:00Z'),
    resource: { name: 'Court 1', club: { id: 'club1', slug: 'demo' } },
    participants: [{ userId: 'author' }, { userId: 'absent' }],
    openMatchMessages: [], // message not found
  } as any);
  prismaMock.openMatchInterest.findMany.mockResolvedValue([] as any);

  await notifyOpenMatchChatMessage('resa1', 'missing-msg', 'author');
  expect(dispatchMock).not.toHaveBeenCalled();
});
