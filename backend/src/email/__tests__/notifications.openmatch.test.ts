import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';

const dispatchMock = jest.fn();
jest.mock('../../services/notification/dispatcher', () => ({ dispatch: (...a: unknown[]) => dispatchMock(...a) }));

import { notifyOpenMatchJoin } from '../notifications';

const club = { id: 'club-demo', name: 'Padel Arena', slug: 'arena', logoUrl: null, accentColor: '#d6ff3f', timezone: 'Europe/Paris' };

describe('notifyOpenMatchJoin → dispatch', () => {
  beforeEach(() => dispatchMock.mockReset());

  it('dispatch une notif MY_GAMES à l organisateur avec payload email', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue({
      startTime: new Date('2026-07-01T10:00:00Z'), endTime: new Date('2026-07-01T11:30:00Z'),
      resource: { name: 'Court 1', attributes: { format: 'double' }, club },
      participants: [
        { isOrganizer: true, userId: 'orga', user: { firstName: 'Léa', lastName: 'M', email: 'lea@x.fr' } },
        { isOrganizer: false, userId: 'join', user: { firstName: 'Marie', lastName: 'D', email: 'marie@x.fr' } },
      ],
    } as any);

    await notifyOpenMatchJoin('res-1', 'join');

    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'orga', category: 'MY_GAMES', type: 'open_match.joined', clubId: 'club-demo',
      email: expect.objectContaining({ to: 'lea@x.fr' }),
    }));
  });
});
