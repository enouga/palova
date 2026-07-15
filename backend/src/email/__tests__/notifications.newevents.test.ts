import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';

const dispatchMock = jest.fn();
jest.mock('../../services/notification/dispatcher', () => ({ dispatch: (...a: unknown[]) => dispatchMock(...a) }));

import { notifyReservationCancelled, notifyActivityCancelledByClub, notifyReservationRescheduled } from '../notifications';

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

describe('notifyActivityCancelledByClub(tournament) → dispatch', () => {
  beforeEach(() => dispatchMock.mockReset());

  it('dispatch MY_REGISTRATIONS/activity.cancelled_by_club au capitaine et partenaire (dédupliqués)', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue({
      id: 'tourn-1',
      name: 'Open Été',
      startTime: new Date('2026-09-01T09:00:00Z'),
      endTime: new Date('2026-09-01T18:00:00Z'),
      club,
      registrations: [
        {
          status: 'CONFIRMED',
          captain: { id: 'cap-1', email: 'captain@x.fr', firstName: 'Luc' },
          partner: { id: 'par-1', email: 'partner@x.fr', firstName: 'Marc' },
        },
        {
          status: 'WAITLISTED',
          captain: { id: 'cap-2', email: 'captain2@x.fr', firstName: 'Anne' },
          partner: { id: 'par-1', email: 'partner@x.fr', firstName: 'Marc' }, // Marc already seen above
        },
      ],
    } as any);

    await notifyActivityCancelledByClub('tournament', 'tourn-1');

    // cap-1, par-1, cap-2 → 3 dispatches (par-1 deduplicated)
    expect(dispatchMock).toHaveBeenCalledTimes(3);
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'cap-1',
      category: 'MY_REGISTRATIONS',
      type: 'activity.cancelled_by_club',
      clubId: 'club-1',
      email: expect.objectContaining({ to: 'captain@x.fr' }),
    }));
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'par-1',
      category: 'MY_REGISTRATIONS',
      type: 'activity.cancelled_by_club',
      clubId: 'club-1',
    }));
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'cap-2',
      category: 'MY_REGISTRATIONS',
      type: 'activity.cancelled_by_club',
      clubId: 'club-1',
    }));
  });
});

describe('notifyActivityCancelledByClub(lesson) → dispatch', () => {
  beforeEach(() => dispatchMock.mockReset());

  it('dispatch MY_REGISTRATIONS/activity.cancelled_by_club à chaque inscrit du cours', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue({
      id: 'lesson-1',
      club,
      coach: { name: 'Jean Dupont' },
      reservation: {
        startTime: new Date('2026-07-15T10:00:00Z'),
        endTime: new Date('2026-07-15T11:00:00Z'),
      },
      enrollments: [
        { status: 'CONFIRMED', user: { id: 'student-1', email: 'student1@x.fr', firstName: 'Sophie' } },
        { status: 'WAITLISTED', user: { id: 'student-2', email: 'student2@x.fr', firstName: 'Emma' } },
      ],
    } as any);

    await notifyActivityCancelledByClub('lesson', 'lesson-1');

    expect(dispatchMock).toHaveBeenCalledTimes(2);
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'student-1',
      category: 'MY_REGISTRATIONS',
      type: 'activity.cancelled_by_club',
      clubId: 'club-1',
      email: expect.objectContaining({ to: 'student1@x.fr' }),
    }));
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'student-2',
      category: 'MY_REGISTRATIONS',
      type: 'activity.cancelled_by_club',
      clubId: 'club-1',
      email: expect.objectContaining({ to: 'student2@x.fr' }),
    }));
  });

  it('utilise le nom du user lié au coach si présent (coach rattaché à un membre)', async () => {
    prismaMock.lesson.findUnique.mockResolvedValue({
      id: 'lesson-2',
      club,
      coach: { name: 'Ancien nom', user: { firstName: 'Paul', lastName: 'Martin' } },
      reservation: {
        startTime: new Date('2026-07-15T10:00:00Z'),
        endTime: new Date('2026-07-15T11:00:00Z'),
      },
      enrollments: [
        { status: 'CONFIRMED', user: { id: 'student-3', email: 'student3@x.fr', firstName: 'Léa' } },
      ],
    } as any);

    await notifyActivityCancelledByClub('lesson', 'lesson-2');

    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'student-3',
      body: '« Cours — Paul Martin » a été annulé par le club.',
    }));
  });
});

describe('notifyReservationRescheduled → dispatch', () => {
  beforeEach(() => dispatchMock.mockReset());

  it('dispatch MY_GAMES/reservation.rescheduled à chaque participant sauf l acteur', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue({
      id: 'resa-2',
      startTime: new Date('2026-07-20T14:00:00Z'),
      endTime: new Date('2026-07-20T15:30:00Z'),
      resource: { name: 'Court 2', club },
      participants: [
        { userId: 'mover-uid', user: { id: 'mover-uid', firstName: 'Théo' } },
        { userId: 'other-uid', user: { id: 'other-uid', firstName: 'Chloe' } },
      ],
    } as any);

    await notifyReservationRescheduled('resa-2', 'mover-uid');

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'other-uid',
      category: 'MY_GAMES',
      type: 'reservation.rescheduled',
      clubId: 'club-1',
    }));
    expect(dispatchMock).not.toHaveBeenCalledWith(expect.objectContaining({ userId: 'mover-uid' }));
  });
});
