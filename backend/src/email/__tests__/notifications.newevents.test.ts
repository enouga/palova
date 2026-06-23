import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';

const dispatchMock = jest.fn();
jest.mock('../../services/notification/dispatcher', () => ({ dispatch: (...a: unknown[]) => dispatchMock(...a) }));

import { notifyReservationCancelled, notifyActivityCancelledByClub } from '../notifications';

const club = { id: 'club-1', name: 'Padel Club', slug: 'padel-club', logoUrl: null, accentColor: '#00ff00', timezone: 'Europe/Paris' };

describe('notifyReservationCancelled → dispatch', () => {
  beforeEach(() => dispatchMock.mockReset());

  it('dispatch MY_GAMES/reservation.cancelled à chaque participant sauf l acteur', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue({
      id: 'resa-1',
      startTime: new Date('2026-07-10T10:00:00Z'),
      endTime: new Date('2026-07-10T11:30:00Z'),
      resource: { name: 'Court 1', club },
      participants: [
        { userId: 'actor-uid', user: { id: 'actor-uid', firstName: 'Alice' } },
        { userId: 'participant-2', user: { id: 'participant-2', firstName: 'Bob' } },
        { userId: 'participant-3', user: { id: 'participant-3', firstName: 'Carol' } },
      ],
    } as any);

    await notifyReservationCancelled('resa-1', 'actor-uid');

    expect(dispatchMock).toHaveBeenCalledTimes(2);
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'participant-2',
      category: 'MY_GAMES',
      type: 'reservation.cancelled',
      clubId: 'club-1',
    }));
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'participant-3',
      category: 'MY_GAMES',
      type: 'reservation.cancelled',
      clubId: 'club-1',
    }));
    expect(dispatchMock).not.toHaveBeenCalledWith(expect.objectContaining({ userId: 'actor-uid' }));
  });

  it('ne dispatch rien si la réservation n existe pas', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue(null);
    await notifyReservationCancelled('unknown', 'actor-uid');
    expect(dispatchMock).not.toHaveBeenCalled();
  });
});

describe('notifyActivityCancelledByClub(event) → dispatch', () => {
  beforeEach(() => dispatchMock.mockReset());

  it('dispatch MY_REGISTRATIONS/activity.cancelled_by_club à chaque inscrit avec email payload', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue({
      id: 'event-1',
      name: 'Tournoi Été',
      startTime: new Date('2026-08-01T09:00:00Z'),
      endTime: new Date('2026-08-01T18:00:00Z'),
      club,
      registrations: [
        { status: 'CONFIRMED', user: { id: 'user-1', email: 'alice@x.fr', firstName: 'Alice' } },
        { status: 'WAITLISTED', user: { id: 'user-2', email: 'bob@x.fr', firstName: 'Bob' } },
      ],
    } as any);

    await notifyActivityCancelledByClub('event', 'event-1');

    expect(dispatchMock).toHaveBeenCalledTimes(2);
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      category: 'MY_REGISTRATIONS',
      type: 'activity.cancelled_by_club',
      clubId: 'club-1',
      email: expect.objectContaining({ to: 'alice@x.fr' }),
    }));
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-2',
      category: 'MY_REGISTRATIONS',
      type: 'activity.cancelled_by_club',
      clubId: 'club-1',
      email: expect.objectContaining({ to: 'bob@x.fr' }),
    }));
  });

  it('ne dispatch rien si l event n existe pas', async () => {
    prismaMock.clubEvent.findUnique.mockResolvedValue(null);
    await notifyActivityCancelledByClub('event', 'unknown');
    expect(dispatchMock).not.toHaveBeenCalled();
  });
});
