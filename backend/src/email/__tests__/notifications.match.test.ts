import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';

const dispatchMock = jest.fn();
jest.mock('../../services/notification/dispatcher', () => ({ dispatch: (...a: unknown[]) => dispatchMock(...a) }));

import { notifyMatchPendingConfirmation, notifyReservationRefunded } from '../notifications';

const club = { id: 'club-1', name: 'Padel Arena', slug: 'arena', logoUrl: null, accentColor: '#d6ff3f', timezone: 'Europe/Paris' };

describe('notifyMatchPendingConfirmation → dispatch', () => {
  beforeEach(() => dispatchMock.mockReset());

  it('dispatch MY_MATCHES/match.pending_confirmation à chaque joueur non-auteur', async () => {
    prismaMock.match.findUnique.mockResolvedValue({
      id: 'match-1',
      sets: [[6, 4], [6, 3]],
      club,
      createdByUserId: 'author-uid',
      creator: { firstName: 'Paul', lastName: 'Martin' },
      players: [
        { userId: 'author-uid', user: { email: 'paul@x.fr', firstName: 'Paul' } },
        { userId: 'player2', user: { email: 'alice@x.fr', firstName: 'Alice' } },
        { userId: 'player3', user: { email: 'bob@x.fr', firstName: 'Bob' } },
        { userId: 'player4', user: { email: 'carol@x.fr', firstName: 'Carol' } },
      ],
    } as any);

    await notifyMatchPendingConfirmation('match-1');

    expect(dispatchMock).toHaveBeenCalledTimes(3);

    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'player2',
      category: 'MY_MATCHES',
      type: 'match.pending_confirmation',
      clubId: 'club-1',
      email: expect.objectContaining({ to: 'alice@x.fr' }),
    }));

    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'player3',
      category: 'MY_MATCHES',
      type: 'match.pending_confirmation',
      clubId: 'club-1',
      email: expect.objectContaining({ to: 'bob@x.fr' }),
    }));

    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'player4',
      category: 'MY_MATCHES',
      type: 'match.pending_confirmation',
      clubId: 'club-1',
      email: expect.objectContaining({ to: 'carol@x.fr' }),
    }));
  });
});

describe('notifyReservationRefunded → dispatch', () => {
  beforeEach(() => dispatchMock.mockReset());

  it('dispatch PAYMENTS/payment.refunded au propriétaire de la réservation', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue({
      id: 'resa-1',
      userId: 'owner-uid',
      startTime: new Date('2026-07-01T10:00:00Z'),
      endTime: new Date('2026-07-01T11:30:00Z'),
      user: { id: 'owner-uid', firstName: 'Sophie', email: 'sophie@x.fr' },
      resource: {
        name: 'Court 2',
        club: { id: 'club-1', name: 'Padel Arena', slug: 'arena', logoUrl: null, accentColor: '#d6ff3f', timezone: 'Europe/Paris' },
      },
    } as any);

    await notifyReservationRefunded('resa-1', [{ amount: '20.00', method: 'STRIPE' }]);

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'owner-uid',
      category: 'PAYMENTS',
      type: 'payment.refunded',
      clubId: 'club-1',
      email: expect.objectContaining({ to: 'sophie@x.fr' }),
    }));
  });
});
