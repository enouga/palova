import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';

const dispatchMock = jest.fn();
jest.mock('../../services/notification/dispatcher', () => ({ dispatch: (...a: unknown[]) => dispatchMock(...a) }));

import { notifyNoShowCharged } from '../notifications';

const club = { id: 'club-1', name: 'Padel Arena', slug: 'arena', logoUrl: null, logoWideUrl: null, accentColor: '#d6ff3f', timezone: 'Europe/Paris', address: null, city: null, contactPhone: null, contactEmail: null };

describe('notifyNoShowCharged → dispatch', () => {
  beforeEach(() => dispatchMock.mockReset());

  it('dispatch PAYMENTS/payment.no_show_charged au joueur débité', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue({
      id: 'resa-1',
      startTime: new Date('2026-07-01T10:00:00Z'),
      endTime: new Date('2026-07-01T11:30:00Z'),
      resource: { name: 'Court 2', club },
    } as any);
    prismaMock.user.findUnique.mockResolvedValue({ firstName: 'Marc', email: 'marc@x.fr' } as any);

    await notifyNoShowCharged('resa-1', 'user-1', 2500);

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      category: 'PAYMENTS',
      type: 'payment.no_show_charged',
      clubId: 'club-1',
      email: expect.objectContaining({ to: 'marc@x.fr' }),
    }));
  });

  it('ne dispatch rien si le joueur débité n\'a pas d\'email', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue({
      id: 'resa-1',
      startTime: new Date('2026-07-01T10:00:00Z'),
      endTime: new Date('2026-07-01T11:30:00Z'),
      resource: { name: 'Court 2', club },
    } as any);
    prismaMock.user.findUnique.mockResolvedValue({ firstName: 'Marc', email: null } as any);

    await notifyNoShowCharged('resa-1', 'user-1', 2500);

    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('ne dispatch rien si la réservation est introuvable', async () => {
    prismaMock.reservation.findUnique.mockResolvedValue(null as any);

    await notifyNoShowCharged('resa-1', 'user-1', 2500);

    expect(dispatchMock).not.toHaveBeenCalled();
  });
});
