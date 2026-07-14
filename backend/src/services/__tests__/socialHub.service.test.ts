import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { SocialHubService } from '../socialHub.service';

jest.mock('../rating/preferredSport', () => ({ resolvePreferredSportKey: jest.fn().mockResolvedValue('padel') }));
jest.mock('../rating.service', () => ({
  RatingService: jest.fn().mockImplementation(() => ({ getLevelsForUsers: jest.fn().mockResolvedValue({}) })),
}));

const U = (id: string) => ({ id, firstName: id.toUpperCase(), lastName: 'X', avatarUrl: null });

describe('SocialHubService — friendsAgenda', () => {
  let service: SocialHubService;
  const now = new Date('2026-07-14T10:00:00Z');

  beforeEach(() => {
    service = new SocialHubService();
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
    prismaMock.friendship.findMany.mockResolvedValue([]);
    prismaMock.follow.findMany.mockResolvedValue([]);
    prismaMock.reservation.findMany.mockResolvedValue([]);
    prismaMock.tournament.findMany.mockResolvedValue([]);
    prismaMock.clubEvent.findMany.mockResolvedValue([]);
  });

  it('club inconnu ou suspendu → CLUB_NOT_FOUND', async () => {
    prismaMock.club.findUnique.mockResolvedValue(null);
    await expect(service.friendsAgenda('nope', 'u1', now)).rejects.toThrow('CLUB_NOT_FOUND');
  });

  it('cercle vide → [] sans requête agenda', async () => {
    const items = await service.friendsAgenda('demo', 'u1', now);
    expect(items).toEqual([]);
    expect(prismaMock.reservation.findMany).not.toHaveBeenCalled();
  });

  it('cercle = amis confirmés ∪ follows, sans soi-même', async () => {
    prismaMock.friendship.findMany.mockResolvedValue([{ userAId: 'u1', userBId: 'ami1' }] as any);
    prismaMock.follow.findMany.mockResolvedValue([{ followingId: 'fav1' }, { followingId: 'ami1' }] as any);
    await service.friendsAgenda('demo', 'u1', now);
    const resArgs = prismaMock.reservation.findMany.mock.calls[0][0] as any;
    const ids = resArgs.where.participants.some.userId.in as string[];
    expect(ids.sort()).toEqual(['ami1', 'fav1']);
  });

  it('mappe les 3 sources, filtre les items sans ami du cercle, trie chrono, cap 6', async () => {
    prismaMock.follow.findMany.mockResolvedValue([{ followingId: 'fav1' }] as any);
    prismaMock.reservation.findMany.mockResolvedValue([{
      id: 'r1', startTime: new Date('2026-07-15T18:00:00Z'), endTime: new Date('2026-07-15T19:00:00Z'),
      resource: { name: 'Court 1' },
      participants: [{ userId: 'fav1', user: U('fav1') }, { userId: 'autre', user: U('autre') }],
    }] as any);
    prismaMock.tournament.findMany.mockResolvedValue([{
      id: 't1', name: 'P100 du club', startTime: new Date('2026-07-15T08:00:00Z'), endTime: null,
      registrations: [{ captain: U('fav1'), partner: U('autre') }],
    }] as any);
    prismaMock.clubEvent.findMany.mockResolvedValue([{
      id: 'e1', name: 'Mêlée', startTime: new Date('2026-07-16T08:00:00Z'), endTime: null,
      registrations: [{ user: U('autre') }], // personne du cercle → item filtré
    }] as any);

    const items = await service.friendsAgenda('demo', 'u1', now);
    expect(items.map((i) => i.kind)).toEqual(['tournament', 'match']); // chrono, event filtré
    expect(items[0].label).toBe('P100 du club');
    expect(items[1].label).toBe('Partie ouverte · Court 1');
    // seuls les joueurs du cercle apparaissent dans friends
    expect(items[1].friends.map((f) => f.id)).toEqual(['fav1']);
  });

  it('cap 4 amis par item, sans doublon', async () => {
    prismaMock.follow.findMany.mockResolvedValue(
      ['a', 'b', 'c', 'd', 'e'].map((id) => ({ followingId: id })) as any);
    prismaMock.reservation.findMany.mockResolvedValue([{
      id: 'r1', startTime: new Date('2026-07-15T18:00:00Z'), endTime: null, resource: { name: 'C1' },
      participants: ['a', 'a', 'b', 'c', 'd', 'e'].map((id) => ({ userId: id, user: U(id) })),
    }] as any);
    const items = await service.friendsAgenda('demo', 'u1', now);
    expect(items[0].friends.map((f) => f.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});
