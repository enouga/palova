import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';

jest.mock('../notification/dispatcher', () => ({ dispatch: jest.fn() }));
const { dispatch } = require('../notification/dispatcher') as { dispatch: jest.Mock };

import { BroadcastService } from '../broadcast.service';

describe('BroadcastService', () => {
  let service: BroadcastService;

  beforeEach(() => {
    service = new BroadcastService();
  });

  const club = {
    name: 'Padel Arena', slug: 'padel-arena', logoUrl: null,
    accentColor: '#1a2b3c', timezone: 'Europe/Paris',
  };

  describe('countActiveMembers', () => {
    it('returns the count of ACTIVE memberships', async () => {
      prismaMock.clubMembership.count.mockResolvedValue(7);
      const count = await service.countActiveMembers('club-1');
      expect(count).toBe(7);
      expect(prismaMock.clubMembership.count).toHaveBeenCalledWith({
        where: { clubId: 'club-1', status: 'ACTIVE' },
      });
    });
  });

  describe('send', () => {
    it('throws VALIDATION_ERROR on empty title', async () => {
      await expect(service.send('c1', 'u1', { title: '  ', body: 'Hello' }))
        .rejects.toThrow('VALIDATION_ERROR');
    });

    it('throws VALIDATION_ERROR on empty body', async () => {
      await expect(service.send('c1', 'u1', { title: 'Hi', body: '' }))
        .rejects.toThrow('VALIDATION_ERROR');
    });

    it('creates ClubBroadcast with recipientCount and calls dispatch once per active member', async () => {
      const members = [
        { user: { id: 'u1', email: 'a@x.fr', firstName: 'Alice' } },
        { user: { id: 'u2', email: null, firstName: 'Bob' } },
      ];
      prismaMock.club.findUniqueOrThrow.mockResolvedValue(club as any);
      prismaMock.clubMembership.findMany.mockResolvedValue(members as any);
      prismaMock.clubBroadcast.create.mockResolvedValue({ id: 'bc-1', ...{} } as any);

      dispatch.mockResolvedValue(undefined);

      const result = await service.send('club-1', 'staff-1', { title: 'News', body: 'Content' });

      expect(result.broadcastId).toBe('bc-1');
      expect(result.recipientCount).toBe(2);

      expect(prismaMock.clubBroadcast.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          clubId: 'club-1',
          sentByUserId: 'staff-1',
          title: 'News',
          body: 'Content',
          recipientCount: 2,
        }),
      });

      expect(dispatch).toHaveBeenCalledTimes(2);

      // member with email gets email payload
      expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'u1',
        category: 'CLUB_MESSAGES',
        type: 'club.broadcast',
        email: expect.objectContaining({ to: 'a@x.fr' }),
      }));

      // member without email gets null email
      expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'u2',
        category: 'CLUB_MESSAGES',
        type: 'club.broadcast',
        email: null,
      }));
    });
  });
});
