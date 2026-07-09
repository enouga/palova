import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { FollowService } from '../follow.service';

const mockNotifyFollow = jest.fn();
jest.mock('../../email/notifications', () => ({
  notifyNewFollower: (...args: unknown[]) => mockNotifyFollow(...args),
}));

const ACTIVE = { status: 'ACTIVE' } as any;

describe('FollowService — follow/unfollow', () => {
  let service: FollowService;
  beforeEach(() => {
    service = new FollowService();
    mockNotifyFollow.mockReset().mockResolvedValue(undefined);
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
    // par défaut : les deux sont membres actifs
    prismaMock.clubMembership.findUnique.mockResolvedValue(ACTIVE);
  });

  it('refuse de se suivre soi-même', async () => {
    await expect(service.follow('demo', 'u1', 'u1')).rejects.toThrow('CANNOT_FOLLOW_SELF');
  });

  it("refuse si la cible n'est pas membre actif du club", async () => {
    prismaMock.clubMembership.findUnique
      .mockResolvedValueOnce(ACTIVE)   // caller
      .mockResolvedValueOnce(null);    // target
    await expect(service.follow('demo', 'u1', 'u2')).rejects.toThrow('NOT_A_MEMBER');
  });

  it('crée le suivi, notifie, et renvoie la relation', async () => {
    prismaMock.follow.findUnique.mockResolvedValue(null); // pas encore suivi
    prismaMock.follow.create.mockResolvedValue({ id: 'f1' } as any);
    prismaMock.follow.findMany.mockResolvedValue([{ followerId: 'u1', followingId: 'u2' }] as any);

    const rel = await service.follow('demo', 'u1', 'u2');

    expect(prismaMock.follow.create).toHaveBeenCalledWith({ data: { followerId: 'u1', followingId: 'u2' } });
    expect(mockNotifyFollow).toHaveBeenCalledWith('u1', 'u2', 'club-demo');
    expect(rel).toEqual({ iFollow: true, followsMe: false, mutual: false });
  });

  it('re-suivre est idempotent et ne renotifie pas', async () => {
    prismaMock.follow.findUnique.mockResolvedValue({ id: 'f1' } as any); // déjà suivi
    prismaMock.follow.findMany.mockResolvedValue([{ followerId: 'u1', followingId: 'u2' }] as any);

    await service.follow('demo', 'u1', 'u2');

    expect(prismaMock.follow.create).not.toHaveBeenCalled();
    expect(mockNotifyFollow).not.toHaveBeenCalled();
  });

  it('détecte la réciprocité (mutual)', async () => {
    prismaMock.follow.findUnique.mockResolvedValue({ id: 'f1' } as any);
    prismaMock.follow.findMany.mockResolvedValue([
      { followerId: 'u1', followingId: 'u2' },
      { followerId: 'u2', followingId: 'u1' },
    ] as any);

    const rel = await service.follow('demo', 'u1', 'u2');
    expect(rel).toEqual({ iFollow: true, followsMe: true, mutual: true });
  });

  it('unfollow supprime (deleteMany, idempotent) et renvoie la relation', async () => {
    prismaMock.follow.deleteMany.mockResolvedValue({ count: 1 } as any);
    prismaMock.follow.findMany.mockResolvedValue([] as any);

    const rel = await service.unfollow('demo', 'u1', 'u2');

    expect(prismaMock.follow.deleteMany).toHaveBeenCalledWith({ where: { followerId: 'u1', followingId: 'u2' } });
    expect(rel).toEqual({ iFollow: false, followsMe: false, mutual: false });
  });

  it('best-effort : un échec de notification ne fait pas échouer le suivi', async () => {
    mockNotifyFollow.mockRejectedValue(new Error('smtp down'));
    prismaMock.follow.findUnique.mockResolvedValue(null);
    prismaMock.follow.create.mockResolvedValue({ id: 'f1' } as any);
    prismaMock.follow.findMany.mockResolvedValue([{ followerId: 'u1', followingId: 'u2' }] as any);

    await expect(service.follow('demo', 'u1', 'u2')).resolves.toBeDefined();
  });
});

describe('FollowService — listes', () => {
  let service: FollowService;
  beforeEach(() => { service = new FollowService(); });

  it('listFollowing renvoie mes suivis avec le flag mutual', async () => {
    prismaMock.follow.findMany
      .mockResolvedValueOnce([ // mes suivis
        { following: { id: 'u2', firstName: 'Léa', lastName: 'M', avatarUrl: null } },
        { following: { id: 'u3', firstName: 'Tom', lastName: 'B', avatarUrl: 'a.png' } },
      ] as any)
      .mockResolvedValueOnce([{ followerId: 'u2' }] as any); // qui me suit en retour (parmi u2,u3)

    const list = await service.listFollowing('u1');

    expect(list).toEqual([
      { id: 'u2', firstName: 'Léa', lastName: 'M', avatarUrl: null,    mutual: true },
      { id: 'u3', firstName: 'Tom', lastName: 'B', avatarUrl: 'a.png', mutual: false },
    ]);
  });

  it('listFollowers renvoie ceux qui me suivent avec le flag mutual', async () => {
    prismaMock.follow.findMany
      .mockResolvedValueOnce([
        { follower: { id: 'u2', firstName: 'Léa', lastName: 'M', avatarUrl: null } },
      ] as any)
      .mockResolvedValueOnce([{ followingId: 'u2' }] as any); // ceux que je suis (parmi mes followers)

    const list = await service.listFollowers('u1');
    expect(list).toEqual([{ id: 'u2', firstName: 'Léa', lastName: 'M', avatarUrl: null, mutual: true }]);
  });
});

describe('FollowService — amis du club (ajout rapide)', () => {
  let service: FollowService;
  beforeEach(() => {
    service = new FollowService();
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);
    prismaMock.sport.findUnique.mockResolvedValue({ id: 'sport-padel' } as any);
    prismaMock.playerRating.findMany.mockResolvedValue([] as any);
  });

  it('renvoie mes amis qui sont membres actifs du club, avec niveau et avatar', async () => {
    // mes amis globaux qui sont aussi membres actifs de ce club
    prismaMock.follow.findMany
      .mockResolvedValueOnce([
        { following: { id: 'u2', firstName: 'Léa', lastName: 'M', avatarUrl: null } },
      ] as any)
      .mockResolvedValueOnce([{ followerId: 'u2' }] as any); // mutual
    const list = await service.listClubFriends('demo', 'u1');
    expect(list).toEqual([{ id: 'u2', firstName: 'Léa', lastName: 'M', avatarUrl: null, level: null, mutual: true }]);
    // le filtre passe bien par la co-appartenance active au club, super-admin plateforme exclu
    const arg = (prismaMock.follow.findMany as jest.Mock).mock.calls[0][0];
    expect(arg.where.following.clubMemberships.some).toEqual({ clubId: 'club-demo', status: 'ACTIVE' });
    expect(arg.where.following.isSuperAdmin).toBe(false);
  });

  it('renvoie [] si je ne suis aucun membre du club', async () => {
    prismaMock.follow.findMany.mockResolvedValueOnce([] as any);
    const list = await service.listClubFriends('demo', 'u1');
    expect(list).toEqual([]);
  });
});
