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

  it('club introuvable → CLUB_NOT_FOUND', async () => {
    prismaMock.club.findUnique.mockResolvedValue(null);
    await expect(service.friendsAgenda('nope', 'u1', now)).rejects.toThrow('CLUB_NOT_FOUND');
  });

  it('club suspendu → CLUB_NOT_FOUND', async () => {
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'SUSPENDED' } as any);
    await expect(service.friendsAgenda('demo', 'u1', now)).rejects.toThrow('CLUB_NOT_FOUND');
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

  it('cap 6 items au total, en ordre chronologique', async () => {
    prismaMock.follow.findMany.mockResolvedValue([{ followingId: 'fav1' }] as any);
    prismaMock.reservation.findMany.mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => ({
        id: `r${i}`,
        startTime: new Date(`2026-07-15T${String(10 + i).padStart(2, '0')}:00:00Z`),
        endTime: null,
        resource: { name: `C${i}` },
        participants: [{ user: U('fav1') }],
      })) as any,
    );
    const items = await service.friendsAgenda('demo', 'u1', now);
    expect(items).toHaveLength(6);
    expect(items.map((i) => i.id)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4', 'r5']);
    const times = items.map((i) => i.startTime.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('sans 3e argument « now » → utilise la date courante, ne jette pas', async () => {
    const items = await service.friendsAgenda('demo', 'u1');
    expect(items).toEqual([]);
  });
});

describe('SocialHubService — playerSuggestions', () => {
  let service: SocialHubService;
  const now = new Date('2026-07-14T10:00:00Z');

  beforeEach(() => {
    service = new SocialHubService();
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
    prismaMock.follow.findMany.mockResolvedValue([]);
    prismaMock.friendship.findMany.mockResolvedValue([]);
    prismaMock.user.findMany.mockResolvedValue([]);
  });

  it('aucune résa récente → []', async () => {
    prismaMock.reservation.findMany.mockResolvedValue([]);
    expect(await service.playerSuggestions('demo', 'u1', now)).toEqual([]);
  });

  it('agrège les co-joueurs (organisateur + participants), compte et date du dernier match', async () => {
    prismaMock.reservation.findMany.mockResolvedValue([
      { userId: 'orga', startTime: new Date('2026-07-12T10:00:00Z'), participants: [{ userId: 'u1' }, { userId: 'p1' }] },
      { userId: 'u1', startTime: new Date('2026-07-10T10:00:00Z'), participants: [{ userId: 'u1' }, { userId: 'p1' }] },
    ] as any);
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'orga', firstName: 'O', lastName: 'X', avatarUrl: null, acceptsFriendRequests: true },
      { id: 'p1', firstName: 'P', lastName: 'X', avatarUrl: null, acceptsFriendRequests: false },
    ] as any);
    const out = await service.playerSuggestions('demo', 'u1', now);
    expect(out.map((s) => s.id).sort()).toEqual(['orga', 'p1']);
    const p1 = out.find((s) => s.id === 'p1')!;
    expect(p1.playedCount).toBe(2);
    expect(p1.lastPlayedAt).toEqual(new Date('2026-07-12T10:00:00Z'));
    expect(p1.requestable).toBe(false);
  });

  it('exclut les joueurs déjà suivis ou en relation d\'amitié (PENDING compris)', async () => {
    prismaMock.reservation.findMany.mockResolvedValue([
      { userId: null, startTime: new Date('2026-07-12T10:00:00Z'), participants: [{ userId: 'u1' }, { userId: 'suivi' }, { userId: 'pending' }, { userId: 'neuf' }] },
    ] as any);
    prismaMock.follow.findMany.mockResolvedValue([{ followingId: 'suivi' }] as any);
    prismaMock.friendship.findMany.mockResolvedValue([{ userAId: 'pending', userBId: 'u1' }] as any);
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'neuf', firstName: 'N', lastName: 'X', avatarUrl: null, acceptsFriendRequests: true },
    ] as any);
    const out = await service.playerSuggestions('demo', 'u1', now);
    expect(out.map((s) => s.id)).toEqual(['neuf']);
    // le filtre users ne reçoit que les candidats non exclus
    const userArgs = prismaMock.user.findMany.mock.calls[0][0] as any;
    expect(userArgs.where.id.in).toEqual(['neuf']);
    expect(userArgs.where.deletedAt).toBeNull();
  });

  it('cap 8 suggestions', async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `p${i}`);
    prismaMock.reservation.findMany.mockResolvedValue([
      { userId: null, startTime: new Date('2026-07-12T10:00:00Z'), participants: [{ userId: 'u1' }, ...ids.map((id) => ({ userId: id }))] },
    ] as any);
    prismaMock.user.findMany.mockResolvedValue(
      ids.map((id) => ({ id, firstName: id, lastName: 'X', avatarUrl: null, acceptsFriendRequests: true })) as any);
    const out = await service.playerSuggestions('demo', 'u1', now);
    expect(out).toHaveLength(8);
  });
});
