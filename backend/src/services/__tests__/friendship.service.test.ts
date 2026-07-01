import '../../__mocks__/prisma';
import { prismaMock } from '../../__mocks__/prisma';
import { FriendshipService } from '../friendship.service';

const mockNotifyRequest = jest.fn();
const mockNotifyAccepted = jest.fn();
jest.mock('../../email/notifications', () => ({
  notifyFriendRequest:  (...a: unknown[]) => mockNotifyRequest(...a),
  notifyFriendAccepted: (...a: unknown[]) => mockNotifyAccepted(...a),
}));

const ACTIVE = { status: 'ACTIVE' } as any;

describe('FriendshipService — requestFriend', () => {
  let service: FriendshipService;
  beforeEach(() => {
    service = new FriendshipService();
    mockNotifyRequest.mockReset().mockResolvedValue(undefined);
    mockNotifyAccepted.mockReset().mockResolvedValue(undefined);
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
    prismaMock.clubMembership.findUnique.mockResolvedValue(ACTIVE);
    prismaMock.user.findUnique.mockResolvedValue({ acceptsFriendRequests: true } as any);
  });

  it('refuse de s\'ajouter soi-même', async () => {
    await expect(service.requestFriend('demo', 'u1', 'u1')).rejects.toThrow('CANNOT_FRIEND_SELF');
  });

  it('refuse si la cible n\'a pas activé l\'opt-in', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ acceptsFriendRequests: false } as any);
    prismaMock.friendship.findUnique.mockResolvedValue(null);
    await expect(service.requestFriend('demo', 'u1', 'u2')).rejects.toThrow('FRIEND_REQUESTS_DISABLED');
  });

  it('crée une demande PENDING et notifie la cible', async () => {
    prismaMock.friendship.findUnique.mockResolvedValueOnce(null);
    prismaMock.friendship.create.mockResolvedValue({ id: 'fr1' } as any);
    prismaMock.friendship.findUnique.mockResolvedValueOnce({ status: 'PENDING', requestedById: 'u1' } as any);
    const rel = await service.requestFriend('demo', 'u1', 'u2');
    expect(prismaMock.friendship.create).toHaveBeenCalledWith({ data: { userAId: 'u1', userBId: 'u2', requestedById: 'u1', status: 'PENDING' } });
    expect(mockNotifyRequest).toHaveBeenCalledWith('u1', 'u2', 'club-demo');
    expect(rel).toEqual({ status: 'pending_out', requestable: false });
  });

  it('accepte directement si une demande inverse est en attente', async () => {
    prismaMock.friendship.findUnique.mockResolvedValueOnce({ id: 'fr1', status: 'PENDING', requestedById: 'u2' } as any);
    prismaMock.friendship.update.mockResolvedValue({} as any);
    prismaMock.friendship.findUnique.mockResolvedValueOnce({ status: 'ACCEPTED', requestedById: 'u2' } as any);
    const rel = await service.requestFriend('demo', 'u1', 'u2');
    expect(prismaMock.friendship.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'fr1' }, data: expect.objectContaining({ status: 'ACCEPTED' }) }));
    expect(mockNotifyAccepted).toHaveBeenCalledWith('u1', 'u2', 'club-demo');
    expect(rel).toEqual({ status: 'friends', requestable: false });
  });

  it('canonicalise la paire (userA < userB) même si le demandeur est « plus grand »', async () => {
    prismaMock.friendship.findUnique.mockResolvedValueOnce(null);
    prismaMock.friendship.create.mockResolvedValue({ id: 'fr1' } as any);
    prismaMock.friendship.findUnique.mockResolvedValueOnce({ status: 'PENDING', requestedById: 'z9' } as any);
    await service.requestFriend('demo', 'z9', 'a1');
    expect(prismaMock.friendship.create).toHaveBeenCalledWith({ data: { userAId: 'a1', userBId: 'z9', requestedById: 'z9', status: 'PENDING' } });
  });
});

describe('FriendshipService — respond / remove / relations', () => {
  let service: FriendshipService;
  beforeEach(() => {
    service = new FriendshipService();
    mockNotifyAccepted.mockReset().mockResolvedValue(undefined);
    prismaMock.club.findUnique.mockResolvedValue({ id: 'club-demo', status: 'ACTIVE' } as any);
  });

  it('respond(accept) passe la demande reçue en ACCEPTED et notifie le demandeur', async () => {
    prismaMock.friendship.findUnique.mockResolvedValueOnce({ id: 'fr1', status: 'PENDING', requestedById: 'u2' } as any);
    prismaMock.friendship.update.mockResolvedValue({} as any);
    prismaMock.friendship.findUnique.mockResolvedValueOnce({ status: 'ACCEPTED', requestedById: 'u2' } as any);
    const rel = await service.respond('demo', 'u1', 'u2', true);
    expect(prismaMock.friendship.update).toHaveBeenCalled();
    expect(mockNotifyAccepted).toHaveBeenCalledWith('u1', 'u2', 'club-demo');
    expect(rel).toEqual({ status: 'friends', requestable: false });
  });

  it('respond(refuse) supprime la demande', async () => {
    prismaMock.friendship.findUnique.mockResolvedValueOnce({ id: 'fr1', status: 'PENDING', requestedById: 'u2' } as any);
    prismaMock.friendship.delete.mockResolvedValue({} as any);
    prismaMock.friendship.findUnique.mockResolvedValueOnce(null);
    prismaMock.user.findUnique.mockResolvedValue({ acceptsFriendRequests: true } as any);
    await service.respond('demo', 'u1', 'u2', false);
    expect(prismaMock.friendship.delete).toHaveBeenCalledWith({ where: { id: 'fr1' } });
  });

  it('respond échoue si aucune demande reçue en attente', async () => {
    prismaMock.friendship.findUnique.mockResolvedValueOnce({ status: 'PENDING', requestedById: 'u1' } as any);
    await expect(service.respond('demo', 'u1', 'u2', true)).rejects.toThrow('REQUEST_NOT_FOUND');
  });

  it('removeFriend supprime (deleteMany canonique, idempotent)', async () => {
    prismaMock.friendship.deleteMany.mockResolvedValue({ count: 1 } as any);
    prismaMock.friendship.findUnique.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue({ acceptsFriendRequests: true } as any);
    await service.removeFriend('u1', 'u2');
    expect(prismaMock.friendship.deleteMany).toHaveBeenCalledWith({ where: { userAId: 'u1', userBId: 'u2' } });
  });

  it('getRelationship: none + requestable selon l\'opt-in cible', async () => {
    prismaMock.friendship.findUnique.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue({ acceptsFriendRequests: true } as any);
    expect(await service.getRelationship('u1', 'u2')).toEqual({ status: 'none', requestable: true });
  });
});

describe('FriendshipService — listes', () => {
  let service: FriendshipService;
  beforeEach(() => { service = new FriendshipService(); });

  it('listFriends renvoie « l\'autre » de chaque amitié ACCEPTED', async () => {
    prismaMock.friendship.findMany.mockResolvedValue([
      { userAId: 'u1', userBId: 'u2', userA: { id: 'u1', firstName: 'Moi', lastName: 'X', avatarUrl: null }, userB: { id: 'u2', firstName: 'Léa', lastName: 'M', avatarUrl: null } },
      { userAId: 'u0', userBId: 'u1', userA: { id: 'u0', firstName: 'Tom', lastName: 'B', avatarUrl: 'a.png' }, userB: { id: 'u1', firstName: 'Moi', lastName: 'X', avatarUrl: null } },
    ] as any);
    const list = await service.listFriends('u1');
    expect(list.map((f) => f.id).sort()).toEqual(['u0', 'u2']);
    expect(list.every((f) => f.mutual === true)).toBe(true);
  });

  it('listRequests ventile reçues (autre a demandé) et envoyées (moi)', async () => {
    prismaMock.friendship.findMany.mockResolvedValue([
      { userAId: 'u1', userBId: 'u2', requestedById: 'u2', userA: { id: 'u1', firstName: 'Moi', lastName: 'X', avatarUrl: null }, userB: { id: 'u2', firstName: 'Léa', lastName: 'M', avatarUrl: null } },
      { userAId: 'u1', userBId: 'u3', requestedById: 'u1', userA: { id: 'u1', firstName: 'Moi', lastName: 'X', avatarUrl: null }, userB: { id: 'u3', firstName: 'Tom', lastName: 'B', avatarUrl: null } },
    ] as any);
    const { received, sent } = await service.listRequests('u1');
    expect(received.map((f) => f.id)).toEqual(['u2']);
    expect(sent.map((f) => f.id)).toEqual(['u3']);
  });
});
