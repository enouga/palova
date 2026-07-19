import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';

jest.mock('../../email/notifications', () => ({
  notifyReservationReminder: jest.fn(),
  notifyMatchResultPrompt: jest.fn(),
  notifyTournamentDeadlineReminder: jest.fn(),
  notifyEventDeadlineReminder: jest.fn(),
  notifyTournamentUpcomingReminder: jest.fn(),
  notifyEventUpcomingReminder: jest.fn(),
}));

import {
  notifyReservationReminder,
  notifyMatchResultPrompt,
  notifyTournamentDeadlineReminder,
  notifyEventDeadlineReminder,
  notifyTournamentUpcomingReminder,
  notifyEventUpcomingReminder,
} from '../../email/notifications';
import { runReminders, REMINDER_WINDOWS, REMINDER_PERIOD_MIN, DEADLINE_REMINDER_LEAD_MIN } from '../reminders.job';

const notifyMock = notifyReservationReminder as jest.Mock;
const fixedNow = new Date('2026-07-01T12:00:00Z');

describe('runReminders', () => {
  beforeEach(() => {
    notifyMock.mockReset();
    prismaMock.reservation.findMany.mockResolvedValue([{ id: 'r1' }] as any);
    prismaMock.tournament.findMany.mockResolvedValue([] as any);
    prismaMock.clubEvent.findMany.mockResolvedValue([] as any);
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
    prismaMock.tournament.findMany.mockResolvedValue([] as any);
    prismaMock.clubEvent.findMany.mockResolvedValue([] as any);
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

describe('runReminders — rappel clôture tournoi/event (J-1)', () => {
  const deadlineMock = notifyTournamentDeadlineReminder as jest.Mock;
  const eventDeadlineMock = notifyEventDeadlineReminder as jest.Mock;
  const fixedNow3 = new Date('2026-07-01T12:00:00Z');

  beforeEach(() => {
    deadlineMock.mockReset();
    eventDeadlineMock.mockReset();
    prismaMock.reservation.findMany.mockResolvedValue([] as any);
  });

  it('notifie les tournois et events dont la clôture tombe dans la tranche J-1', async () => {
    prismaMock.tournament.findMany.mockResolvedValue([{ id: 't1' }] as any);
    prismaMock.clubEvent.findMany.mockResolvedValue([{ id: 'e1' }] as any);

    await runReminders(fixedNow3);

    expect(deadlineMock).toHaveBeenCalledWith('t1');
    expect(eventDeadlineMock).toHaveBeenCalledWith('e1');

    const expectedFrom = new Date(fixedNow3.getTime() + (DEADLINE_REMINDER_LEAD_MIN - REMINDER_PERIOD_MIN) * 60000);
    const expectedTo = new Date(fixedNow3.getTime() + DEADLINE_REMINDER_LEAD_MIN * 60000);
    expect(prismaMock.tournament.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'PUBLISHED', registrationDeadline: { gt: expectedFrom, lte: expectedTo } },
      }),
    );
    expect(prismaMock.clubEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'PUBLISHED', registrationDeadline: { gt: expectedFrom, lte: expectedTo } },
      }),
    );
  });

  it('un échec sur un tournoi ne bloque pas les autres', async () => {
    prismaMock.tournament.findMany.mockResolvedValue([{ id: 't1' }, { id: 't2' }] as any);
    prismaMock.clubEvent.findMany.mockResolvedValue([] as any);
    deadlineMock.mockRejectedValueOnce(new Error('smtp down'));

    await expect(runReminders(fixedNow3)).resolves.not.toThrow();
    expect(deadlineMock).toHaveBeenCalledTimes(2);
  });
});

describe('runReminders — rappel jour J tournoi/event (J-1, H-2)', () => {
  const upcomingMock = notifyTournamentUpcomingReminder as jest.Mock;
  const eventUpcomingMock = notifyEventUpcomingReminder as jest.Mock;
  const fixedNow4 = new Date('2026-07-01T12:00:00Z');

  beforeEach(() => {
    upcomingMock.mockReset();
    eventUpcomingMock.mockReset();
    prismaMock.reservation.findMany.mockResolvedValue([] as any);
    prismaMock.tournament.findMany.mockResolvedValue([{ id: 't1' }] as any);
    prismaMock.clubEvent.findMany.mockResolvedValue([{ id: 'e1' }] as any);
  });

  it('notifie pour les fenêtres J-1 ET H-2', async () => {
    await runReminders(fixedNow4);

    expect(upcomingMock).toHaveBeenCalledWith('t1', 'J-1');
    expect(upcomingMock).toHaveBeenCalledWith('t1', 'H-2');
    expect(eventUpcomingMock).toHaveBeenCalledWith('e1', 'J-1');
    expect(eventUpcomingMock).toHaveBeenCalledWith('e1', 'H-2');
  });

  it('interroge startTime avec les mêmes bornes que REMINDER_WINDOWS', async () => {
    await runReminders(fixedNow4);

    for (const w of REMINDER_WINDOWS) {
      const expectedFrom = new Date(fixedNow4.getTime() + (w.leadMin - REMINDER_PERIOD_MIN) * 60000);
      const expectedTo = new Date(fixedNow4.getTime() + w.leadMin * 60000);
      expect(prismaMock.tournament.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'PUBLISHED', startTime: { gt: expectedFrom, lte: expectedTo } },
        }),
      );
    }
  });

  it('un échec sur un event ne bloque pas les autres appels', async () => {
    eventUpcomingMock.mockRejectedValueOnce(new Error('boom'));
    await expect(runReminders(fixedNow4)).resolves.not.toThrow();
    expect(eventUpcomingMock).toHaveBeenCalledTimes(2); // J-1 et H-2 malgré l'échec du premier
  });
});
