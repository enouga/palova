import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';

const dispatchMock = jest.fn();
jest.mock('../../services/notification/dispatcher', () => ({ dispatch: (...a: unknown[]) => dispatchMock(...a) }));

import { notifyTournamentRegistration } from '../notifications';

const club = {
  id: 'club-1',
  name: 'Padel Arena',
  slug: 'arena',
  logoUrl: null,
  accentColor: '#d6ff3f',
  timezone: 'Europe/Paris',
};

const mockReg = {
  id: 'reg-1',
  tournamentId: 't-1',
  status: 'CONFIRMED',
  tournament: {
    id: 't-1',
    name: 'Open Padel Paris',
    clubId: 'club-1',
    startTime: new Date('2026-08-01T09:00:00Z'),
    endTime: new Date('2026-08-01T18:00:00Z'),
    club,
  },
  captain: { id: 'u-cap', email: 'captain@x.fr', firstName: 'Alice', lastName: 'Martin' },
  partner: { id: 'u-par', email: 'partner@x.fr', firstName: 'Bob', lastName: 'Dupont' },
} as any;

describe('notifyTournamentRegistration → dispatch MY_REGISTRATIONS', () => {
  beforeEach(() => dispatchMock.mockReset());

  it('dispatch une notif MY_REGISTRATIONS au capitaine ET au partenaire', async () => {
    prismaMock.tournamentRegistration.findUnique.mockResolvedValue(mockReg);
    prismaMock.tournamentRegistration.count.mockResolvedValue(1);
    prismaMock.clubMember.findMany.mockResolvedValue([
      { userId: 'staff-1', user: { id: 'staff-1', email: 'admin@club.fr', firstName: 'Admin' } },
    ] as any);

    await notifyTournamentRegistration('reg-1');

    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u-cap',
        category: 'MY_REGISTRATIONS',
        type: 'registration.confirmed',
        email: expect.objectContaining({ to: 'captain@x.fr' }),
      }),
    );
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u-par',
        category: 'MY_REGISTRATIONS',
        type: 'registration.confirmed',
        email: expect.objectContaining({ to: 'partner@x.fr' }),
      }),
    );
  });

  it('dispatch une notif ORGANIZER/organizer.registration au staff du club', async () => {
    prismaMock.tournamentRegistration.findUnique.mockResolvedValue(mockReg);
    prismaMock.tournamentRegistration.count.mockResolvedValue(1);
    prismaMock.clubMember.findMany.mockResolvedValue([
      { userId: 'staff-1', user: { id: 'staff-1', email: 'admin@club.fr', firstName: 'Admin' } },
    ] as any);

    await notifyTournamentRegistration('reg-1');

    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'staff-1',
        category: 'ORGANIZER',
        type: 'organizer.registration',
        email: expect.objectContaining({ to: 'admin@club.fr' }),
      }),
    );
  });
});
