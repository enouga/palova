import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';

const dispatchMock = jest.fn();
jest.mock('../../services/notification/dispatcher', () => ({ dispatch: (...a: unknown[]) => dispatchMock(...a) }));

import { notifyReservationReminder } from '../notifications';

const club = {
  id: 'club-1',
  name: 'Padel Arena',
  slug: 'arena',
  timezone: 'Europe/Paris',
};

const mockResa = {
  id: 'r1',
  status: 'CONFIRMED',
  startTime: new Date('2026-07-02T10:00:00Z'),
  endTime: new Date('2026-07-02T11:30:00Z'),
  resource: {
    name: 'Court 1',
    club,
  },
  participants: [
    { userId: 'u-1' },
    { userId: 'u-2' },
  ],
} as any;

describe('notifyReservationReminder', () => {
  beforeEach(() => {
    dispatchMock.mockReset();
  });

  it('dispatches REMINDERS/reminder.upcoming_game to each participant (H-2)', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue(mockResa);
    await notifyReservationReminder('r1', 'H-2');

    expect(dispatchMock).toHaveBeenCalledTimes(2);
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u-1',
        clubId: 'club-1',
        category: 'REMINDERS',
        type: 'reminder.upcoming_game',
        title: "Ta partie est dans 2 h",
        body: expect.stringContaining('Court 1'),
        data: { reservationId: 'r1', window: 'H-2' },
      }),
    );
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u-2',
        category: 'REMINDERS',
        data: { reservationId: 'r1', window: 'H-2' },
      }),
    );
  });

  it('dispatches with J-1 title for J-1 window', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue(mockResa);
    await notifyReservationReminder('r1', 'J-1');

    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Rappel : partie demain",
        data: { reservationId: 'r1', window: 'J-1' },
      }),
    );
  });

  it('returns early if reservation not found', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue(null);
    await notifyReservationReminder('missing', 'H-2');
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('returns early if reservation not CONFIRMED', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue({ ...mockResa, status: 'CANCELLED' });
    await notifyReservationReminder('r1', 'H-2');
    expect(dispatchMock).not.toHaveBeenCalled();
  });
});
