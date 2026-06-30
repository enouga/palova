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
});
