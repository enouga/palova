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
      club: { id: 'club1', name: 'Padel Arena', slug: 'demo', logoUrl: null, accentColor: '#5e93da', timezone: 'Europe/Paris' },
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

  // Auteurs distincts de messages : 'author' (filtré ensuite) + 'curious' (non-participant ayant écrit)
  prismaMock.openMatchMessage.findMany.mockResolvedValue([{ userId: 'author' }, { userId: 'curious' }] as any);

  // 'present' is connected to the SSE feed → excluded
  getMatchUserIdsMock.mockReturnValue(new Set(['present']));

  // user.findMany returns the two absent recipients with email addresses
  prismaMock.user.findMany.mockResolvedValue([
    { id: 'absent', email: 'absent@x.com', firstName: 'Absent' },
    { id: 'curious', email: 'curious@x.com', firstName: 'Curious' },
  ] as any);

  await notifyOpenMatchChatMessage('resa1', 'm1', 'author');

  // author excluded (is author), present excluded (connected), absent + curious notified
  const targets = (dispatchMock as jest.Mock).mock.calls.map((c: any[]) => c[0].userId).sort();
  expect(targets).toEqual(['absent', 'curious']);

  // Each dispatch call must carry an email payload with a 'to' address
  for (const call of (dispatchMock as jest.Mock).mock.calls) {
    expect(call[0].email).toBeDefined();
    expect(call[0].email.to).toBeTruthy();
  }
});

it('envoie une notif par message meme si une notif non lue existe deja (pas de coalescing)', async () => {
  // Even if there was a previous unread notification for this match, dispatch must still be called.
  prismaMock.reservation.findUnique.mockResolvedValue({
    startTime: new Date('2026-07-01T10:00:00Z'),
    endTime: new Date('2026-07-01T11:30:00Z'),
    resource: {
      name: 'Court 1',
      club: { id: 'club1', name: 'Padel Arena', slug: 'demo', logoUrl: null, accentColor: '#5e93da', timezone: 'Europe/Paris' },
    },
    participants: [
      { userId: 'author' },
      { userId: 'absent' },
    ],
    openMatchMessages: [
      { id: 'm2', body: 'second message', user: { firstName: 'A', lastName: 'B' } },
    ],
  } as any);

  prismaMock.openMatchMessage.findMany.mockResolvedValue([{ userId: 'author' }] as any);

  // user.findMany returns the absent recipient
  prismaMock.user.findMany.mockResolvedValue([
    { id: 'absent', email: 'absent@x.com', firstName: 'Absent' },
  ] as any);

  // Note: no notification.findFirst mock needed — coalescing is gone.

  await notifyOpenMatchChatMessage('resa1', 'm2', 'author');

  // absent is NOT skipped: one dispatch per message
  expect(dispatchMock).toHaveBeenCalledTimes(1);
  expect((dispatchMock as jest.Mock).mock.calls[0][0].userId).toBe('absent');
  expect((dispatchMock as jest.Mock).mock.calls[0][0].email.to).toBe('absent@x.com');
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
    resource: { name: 'Court 1', club: { id: 'club1', name: 'Padel Arena', slug: 'demo', logoUrl: null, accentColor: '#5e93da' } },
    participants: [{ userId: 'author' }, { userId: 'absent' }],
    openMatchMessages: [], // message not found
  } as any);
  prismaMock.openMatchMessage.findMany.mockResolvedValue([] as any);

  await notifyOpenMatchChatMessage('resa1', 'missing-msg', 'author');
  expect(dispatchMock).not.toHaveBeenCalled();
});
