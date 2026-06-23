import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';

jest.mock('../../email/notifications', () => ({
  notifyReservationReminder: jest.fn(),
}));

import { notifyReservationReminder } from '../../email/notifications';
import { runReminders, REMINDER_WINDOWS, REMINDER_PERIOD_MIN } from '../reminders.job';

const notifyMock = notifyReservationReminder as jest.Mock;
const fixedNow = new Date('2026-07-01T12:00:00Z');

describe('runReminders', () => {
  beforeEach(() => {
    notifyMock.mockReset();
    prismaMock.reservation.findMany.mockResolvedValue([{ id: 'r1' }] as any);
  });

  it('calls notifyReservationReminder for J-1 and H-2 windows', async () => {
    await runReminders(fixedNow);
    expect(notifyMock).toHaveBeenCalledWith('r1', 'J-1');
    expect(notifyMock).toHaveBeenCalledWith('r1', 'H-2');
  });

  it('queries correct startTime bounds for each window', async () => {
    await runReminders(fixedNow);

    for (const w of REMINDER_WINDOWS) {
      const expectedFrom = new Date(fixedNow.getTime() + (w.leadMin - REMINDER_PERIOD_MIN) * 60000);
      const expectedTo = new Date(fixedNow.getTime() + w.leadMin * 60000);

      expect(prismaMock.reservation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'CONFIRMED',
            startTime: { gt: expectedFrom, lte: expectedTo },
          }),
        }),
      );
    }
  });

  it('catches errors per reservation and continues', async () => {
    notifyMock.mockRejectedValueOnce(new Error('network error'));
    await expect(runReminders(fixedNow)).resolves.not.toThrow();
    // Still calls for both windows (2 calls total)
    expect(notifyMock).toHaveBeenCalledTimes(2);
  });
});
