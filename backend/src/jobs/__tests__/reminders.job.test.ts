import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';

jest.mock('../../email/notifications', () => ({
  notifyReservationReminder: jest.fn(),
  notifyMatchResultPrompt: jest.fn(),
}));

import { notifyReservationReminder, notifyMatchResultPrompt } from '../../email/notifications';
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

describe('runReminders — passe post-match', () => {
  const promptMock = notifyMatchResultPrompt as jest.Mock;
  const fixedNow2 = new Date('2026-07-01T12:00:00Z');

  beforeEach(() => {
    promptMock.mockReset();
    (notifyReservationReminder as jest.Mock).mockReset();
    // 1er appel findMany = fenêtre J-1, 2e = H-2, 3e = passe post-match.
    prismaMock.reservation.findMany.mockResolvedValue([{ id: 'rp1' }] as any);
  });

  it('notifie le résultat pour les réservations finies dans la tranche [-30min, -15min]', async () => {
    await runReminders(fixedNow2);
    expect(promptMock).toHaveBeenCalledWith('rp1');
    // La requête post-match cible endTime dans la bonne tranche.
    const postCall = (prismaMock.reservation.findMany as jest.Mock).mock.calls.find(
      (c) => c[0]?.where?.endTime,
    );
    expect(postCall).toBeTruthy();
    const expectedFrom = new Date(fixedNow2.getTime() - 30 * 60000);
    const expectedTo = new Date(fixedNow2.getTime() - 15 * 60000);
    expect(postCall[0].where.endTime).toEqual({ gt: expectedFrom, lte: expectedTo });
    expect(postCall[0].where.status).toBe('CONFIRMED');
  });

  it('un échec de notification post-match ne casse pas le job', async () => {
    promptMock.mockRejectedValueOnce(new Error('boom'));
    await expect(runReminders(fixedNow2)).resolves.not.toThrow();
  });
});
