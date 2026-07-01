import { prisma } from '../db/prisma';
import { notifyFriendRequest, notifyFriendAccepted } from '../email/notifications';

export type FriendStatus = 'none' | 'pending_out' | 'pending_in' | 'friends';
export interface FriendRelation {
  status: FriendStatus;
  requestable: boolean;
}
export interface Friend {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  mutual: boolean;
}

const USER_SEL = { id: true, firstName: true, lastName: true, avatarUrl: true } as const;

export class FriendshipService {
  /** Paire canonique (userAId < userBId) pour l'unicité. */
  private pair(a: string, b: string): { userAId: string; userBId: string } {
    return a < b ? { userAId: a, userBId: b } : { userAId: b, userBId: a };
  }

  private async activeClubId(slug: string): Promise<string> {
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, status: true } });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    return club.id;
  }

  private async assertActiveMember(userId: string, clubId: string, error: string): Promise<void> {
    const m = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId, clubId } },
      select: { status: true },
    });
    if (!m || m.status !== 'ACTIVE') throw new Error(error);
  }

  /** Envoie une demande d'ami (ou accepte directement une demande inverse en attente). */
  async requestFriend(slug: string, requesterId: string, targetId: string): Promise<FriendRelation> {
    if (requesterId === targetId) throw new Error('CANNOT_FRIEND_SELF');
    const clubId = await this.activeClubId(slug);
    await this.assertActiveMember(requesterId, clubId, 'MEMBERSHIP_REQUIRED');
    await this.assertActiveMember(targetId, clubId, 'NOT_A_MEMBER');

    const key = this.pair(requesterId, targetId);
    const existing = await prisma.friendship.findUnique({
      where: { userAId_userBId: key },
      select: { id: true, status: true, requestedById: true },
    });
    if (existing) {
      if (existing.status === 'PENDING' && existing.requestedById === targetId) {
        await prisma.friendship.update({ where: { id: existing.id }, data: { status: 'ACCEPTED', respondedAt: new Date() } });
        notifyFriendAccepted(requesterId, targetId, clubId).catch(() => {});
      }
      return this.getRelationship(requesterId, targetId);
    }

    const target = await prisma.user.findUnique({ where: { id: targetId }, select: { acceptsFriendRequests: true } });
    if (!target?.acceptsFriendRequests) throw new Error('FRIEND_REQUESTS_DISABLED');
    try {
      await prisma.friendship.create({ data: { ...key, requestedById: requesterId, status: 'PENDING' } });
      notifyFriendRequest(requesterId, targetId, clubId).catch(() => {});
    } catch (err) {
      if ((err as { code?: string })?.code !== 'P2002') throw err;
    }
    return this.getRelationship(requesterId, targetId);
  }

  /** Répond à une demande REÇUE (initiée par l'autre) : accepte ou refuse (supprime). */
  async respond(slug: string, userId: string, otherUserId: string, accept: boolean): Promise<FriendRelation> {
    const clubId = await this.activeClubId(slug);
    const row = await prisma.friendship.findUnique({
      where: { userAId_userBId: this.pair(userId, otherUserId) },
      select: { id: true, status: true, requestedById: true },
    });
    if (!row || row.status !== 'PENDING' || row.requestedById !== otherUserId) throw new Error('REQUEST_NOT_FOUND');
    if (accept) {
      await prisma.friendship.update({ where: { id: row.id }, data: { status: 'ACCEPTED', respondedAt: new Date() } });
      notifyFriendAccepted(userId, otherUserId, clubId).catch(() => {});
    } else {
      await prisma.friendship.delete({ where: { id: row.id } });
    }
    return this.getRelationship(userId, otherUserId);
  }

  /** Retire un ami OU annule une demande envoyée (idempotent, aucune appartenance requise). */
  async removeFriend(userId: string, otherUserId: string): Promise<FriendRelation> {
    await prisma.friendship.deleteMany({ where: this.pair(userId, otherUserId) });
    return this.getRelationship(userId, otherUserId);
  }

  /** Relation entre deux joueurs, du point de vue de `a`. */
  async getRelationship(a: string, b: string): Promise<FriendRelation> {
    const row = await prisma.friendship.findUnique({
      where: { userAId_userBId: this.pair(a, b) },
      select: { status: true, requestedById: true },
    });
    if (!row) {
      const target = await prisma.user.findUnique({ where: { id: b }, select: { acceptsFriendRequests: true } });
      return { status: 'none', requestable: !!target?.acceptsFriendRequests };
    }
    if (row.status === 'ACCEPTED') return { status: 'friends', requestable: false };
    return { status: row.requestedById === a ? 'pending_out' : 'pending_in', requestable: false };
  }

  /** Mes amitiés confirmées (ACCEPTED). Global. Filtrable par nom. */
  async listFriends(userId: string, q?: string): Promise<Friend[]> {
    const query = (q ?? '').trim().toLowerCase();
    const rows = await prisma.friendship.findMany({
      where: { status: 'ACCEPTED', OR: [{ userAId: userId }, { userBId: userId }] },
      select: { userAId: true, userA: { select: USER_SEL }, userB: { select: USER_SEL } },
    });
    let others = rows.map((r) => (r.userAId === userId ? r.userB : r.userA));
    if (query) others = others.filter((o) => `${o.firstName} ${o.lastName}`.toLowerCase().includes(query));
    others.sort((x, y) => `${x.lastName}${x.firstName}`.localeCompare(`${y.lastName}${y.firstName}`));
    return others.map((o) => ({ id: o.id, firstName: o.firstName, lastName: o.lastName, avatarUrl: o.avatarUrl, mutual: true }));
  }

  /** Demandes en attente : reçues (l'autre a demandé) et envoyées (moi). Global. */
  async listRequests(userId: string): Promise<{ received: Friend[]; sent: Friend[] }> {
    const rows = await prisma.friendship.findMany({
      where: { status: 'PENDING', OR: [{ userAId: userId }, { userBId: userId }] },
      orderBy: { createdAt: 'desc' },
      select: { userAId: true, requestedById: true, userA: { select: USER_SEL }, userB: { select: USER_SEL } },
    });
    const received: Friend[] = [];
    const sent: Friend[] = [];
    for (const r of rows) {
      const other = r.userAId === userId ? r.userB : r.userA;
      const entry: Friend = { id: other.id, firstName: other.firstName, lastName: other.lastName, avatarUrl: other.avatarUrl, mutual: false };
      if (r.requestedById === userId) sent.push(entry);
      else received.push(entry);
    }
    return { received, sent };
  }
}
