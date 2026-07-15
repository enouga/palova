import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';

const dispatchMock = jest.fn();
jest.mock('../../services/notification/dispatcher', () => ({ dispatch: (...a: unknown[]) => dispatchMock(...a) }));

import { notifyEventRegistration } from '../notifications';

const club = {
  id: 'club-1',
  name: 'Padel Arena',
  slug: 'arena',
  logoUrl: null,
  accentColor: '#d6ff3f',
  timezone: 'Europe/Paris',
};

const mockReg = {
  id: 'ereg-1',
  eventId: 'e-1',
  status: 'CONFIRMED',
  event: {
    id: 'e-1',
    name: 'Mêlée du dimanche',
    clubId: 'club-1',
    startTime: new Date('2026-08-01T09:00:00Z'),
    endTime: new Date('2026-08-01T11:00:00Z'),
    registrationDeadline: new Date('2026-07-30T21:59:00Z'),
    club,
  },
  user: { id: 'u-1', email: 'joueur@x.fr', firstName: 'Marie', lastName: 'Curie' },
} as any;

describe('notifyEventRegistration → date limite d’annulation', () => {
  beforeEach(() => dispatchMock.mockReset());

  it('inclut la date limite d’annulation (registrationDeadline) dans le mail de confirmation', async () => {
    prismaMock.eventRegistration.findUnique.mockResolvedValue(mockReg);
    prismaMock.eventRegistration.count.mockResolvedValue(1);
    prismaMock.clubMember.findMany.mockResolvedValue([]);

    await notifyEventRegistration('ereg-1');

    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u-1',
        type: 'registration.confirmed',
        email: expect.objectContaining({
          html: expect.stringContaining('Annulable jusqu’au'),
        }),
      }),
    );
  });
});
