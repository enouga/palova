import { prisma } from '../db/prisma';
import { notifyNewFollower } from '../email/notifications';
import { RatingService } from './rating.service';
import { resolvePreferredSportKey } from './rating/preferredSport';
import type { UserLevel } from './rating.service';

export interface FollowRelation {
  iFollow: boolean;
  followsMe: boolean;
  mutual: boolean;
}

export interface Friend {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  mutual: boolean;
}

export interface ClubFriend extends Friend {
  level: UserLevel | null;
}

export class FollowService {
  private ratingService = new RatingService();
  /** Vérifie que le club existe/ACTIVE et renvoie son id. */
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

  /** Relation entre deux joueurs (lue en une requête). */
  async getRelationship(a: string, b: string): Promise<FollowRelation> {
    const rows = await prisma.follow.findMany({
      where: { OR: [{ followerId: a, followingId: b }, { followerId: b, followingId: a }] },
      select: { followerId: true, followingId: true },
    });
    const iFollow   = rows.some((r) => r.followerId === a && r.followingId === b);
    const followsMe = rows.some((r) => r.followerId === b && r.followingId === a);
    return { iFollow, followsMe, mutual: iFollow && followsMe };
  }

  /** Suit un joueur depuis le contexte d'un club (co-membres actifs requis). Idempotent. */
  async follow(slug: string, followerId: string, targetUserId: string): Promise<FollowRelation> {
    if (followerId === targetUserId) throw new Error('CANNOT_FOLLOW_SELF');
    const clubId = await this.activeClubId(slug);
    await this.assertActiveMember(followerId, clubId, 'MEMBERSHIP_REQUIRED');
    await this.assertActiveMember(targetUserId, clubId, 'NOT_A_MEMBER');

    const existing = await prisma.follow.findUnique({
      where: { followerId_followingId: { followerId, followingId: targetUserId } },
      select: { id: true },
    });
    if (!existing) {
      try {
        await prisma.follow.create({ data: { followerId, followingId: targetUserId } });
        // best-effort, après écriture : ne jamais faire échouer le suivi sur une notif.
        notifyNewFollower(followerId, targetUserId, clubId).catch(() => {});
      } catch (err) {
        // Course concurrente : un autre 1er-suivi a gagné entre le findUnique et le create.
        // P2002 = violation d'unicité → déjà suivi, no-op (et surtout : pas de notif).
        if ((err as { code?: string })?.code !== 'P2002') throw err;
      }
    }
    return this.getRelationship(followerId, targetUserId);
  }

  /** Cesse de suivre. Idempotent (deleteMany). Aucune appartenance requise : on peut toujours se désabonner. */
  async unfollow(_slug: string, followerId: string, targetUserId: string): Promise<FollowRelation> {
    await prisma.follow.deleteMany({ where: { followerId, followingId: targetUserId } });
    return this.getRelationship(followerId, targetUserId);
  }

  /** Mes amis (joueurs que je suis), filtrables par nom, avec flag mutual. Global. */
  async listFollowing(userId: string, q?: string): Promise<Friend[]> {
    const query = (q ?? '').trim();
    const rows = await prisma.follow.findMany({
      where: {
        followerId: userId,
        ...(query
          ? { following: { OR: [{ firstName: { contains: query, mode: 'insensitive' } }, { lastName: { contains: query, mode: 'insensitive' } }] } }
          : {}),
      },
      orderBy: [{ following: { lastName: 'asc' } }, { following: { firstName: 'asc' } }],
      select: { following: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
    });
    const ids = rows.map((r) => r.following.id);
    const back = await prisma.follow.findMany({
      where: { followerId: { in: ids }, followingId: userId },
      select: { followerId: true },
    });
    const mutualSet = new Set(back.map((b) => b.followerId));
    return rows.map((r) => ({ ...r.following, mutual: mutualSet.has(r.following.id) }));
  }

  /** Ceux qui me suivent, avec flag mutual. Global. */
  async listFollowers(userId: string): Promise<Friend[]> {
    const rows = await prisma.follow.findMany({
      where: { followingId: userId },
      orderBy: [{ follower: { lastName: 'asc' } }, { follower: { firstName: 'asc' } }],
      select: { follower: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
    });
    const ids = rows.map((r) => r.follower.id);
    const mine = await prisma.follow.findMany({
      where: { followerId: userId, followingId: { in: ids } },
      select: { followingId: true },
    });
    const mutualSet = new Set(mine.map((m) => m.followingId));
    return rows.map((r) => ({ ...r.follower, mutual: mutualSet.has(r.follower.id) }));
  }

  /** Mes amis ∩ membres ACTIFS du club, avec niveau (sport préféré du caller) + avatar. */
  async listClubFriends(slug: string, userId: string, q?: string): Promise<ClubFriend[]> {
    const clubId = await this.activeClubId(slug);
    await this.assertActiveMember(userId, clubId, 'MEMBERSHIP_REQUIRED');
    const query = (q ?? '').trim();

    const rows = await prisma.follow.findMany({
      where: {
        followerId: userId,
        following: {
          clubMemberships: { some: { clubId, status: 'ACTIVE' } },
          ...(query
            ? { OR: [{ firstName: { contains: query, mode: 'insensitive' } }, { lastName: { contains: query, mode: 'insensitive' } }] }
            : {}),
        },
      },
      orderBy: [{ following: { lastName: 'asc' } }, { following: { firstName: 'asc' } }],
      take: 30,
      select: { following: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
    });
    const ids = rows.map((r) => r.following.id);
    if (ids.length === 0) return [];

    const back = await prisma.follow.findMany({
      where: { followerId: { in: ids }, followingId: userId },
      select: { followerId: true },
    });
    const mutualSet = new Set(back.map((b) => b.followerId));
    const sportKey = await resolvePreferredSportKey(userId);
    const levels = await this.ratingService.getLevelsForUsers(ids, sportKey);

    return rows.map((r) => ({
      id: r.following.id,
      firstName: r.following.firstName,
      lastName: r.following.lastName,
      avatarUrl: r.following.avatarUrl,
      level: levels[r.following.id] ?? null,
      mutual: mutualSet.has(r.following.id),
    }));
  }
}
