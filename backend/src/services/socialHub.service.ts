import { prisma } from '../db/prisma';
import { RatingService } from './rating.service';
import { resolvePreferredSportKey } from './rating/preferredSport';
import type { UserLevel } from './rating.service';

const USER_SEL = { id: true, firstName: true, lastName: true, avatarUrl: true } as const;

export interface AgendaFriend { id: string; firstName: string; lastName: string; avatarUrl: string | null }
export interface FriendsAgendaItem {
  kind: 'match' | 'tournament' | 'event';
  id: string;
  startTime: Date;
  endTime: Date | null;
  label: string;
  friends: AgendaFriend[];
}

export interface PlayerSuggestion {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  level: UserLevel | null;
  lastPlayedAt: Date;
  playedCount: number;
  requestable: boolean;
}

const AGENDA_CAP = 6;
const AGENDA_FRIENDS_CAP = 4;
const SUGGESTIONS_CAP = 8;
const SUGGESTION_WINDOW_DAYS = 90;

/** Hub social « Mes amis » : agenda du cercle (amis ∪ favoris). */
export class SocialHubService {
  private ratingService = new RatingService();

  private async activeClubId(slug: string): Promise<string> {
    const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, status: true } });
    if (!club || club.status !== 'ACTIVE') throw new Error('CLUB_NOT_FOUND');
    return club.id;
  }

  /** Cercle social = amis confirmés ∪ favoris (follows sortants), sans soi-même. */
  private async circleIds(userId: string): Promise<string[]> {
    const [friendships, follows] = await Promise.all([
      prisma.friendship.findMany({
        where: { status: 'ACCEPTED', OR: [{ userAId: userId }, { userBId: userId }] },
        select: { userAId: true, userBId: true },
      }),
      prisma.follow.findMany({ where: { followerId: userId }, select: { followingId: true } }),
    ]);
    const ids = new Set<string>();
    for (const f of friendships) ids.add(f.userAId === userId ? f.userBId : f.userAId);
    for (const f of follows) ids.add(f.followingId);
    ids.delete(userId);
    return [...ids];
  }

  /** « Ça joue bientôt » : parties ouvertes + tournois + events à venir du club où figure mon cercle. */
  async friendsAgenda(slug: string, userId: string, now: Date = new Date()): Promise<FriendsAgendaItem[]> {
    const clubId = await this.activeClubId(slug);
    const ids = await this.circleIds(userId);
    if (ids.length === 0) return [];

    const [matches, tournaments, events] = await Promise.all([
      prisma.reservation.findMany({
        where: {
          visibility: 'PUBLIC', status: 'CONFIRMED', startTime: { gt: now },
          resource: { clubId, clubSport: { sport: { key: 'padel' } } },
          participants: { some: { userId: { in: ids } } },
        },
        orderBy: { startTime: 'asc' },
        take: AGENDA_CAP,
        select: {
          id: true, startTime: true, endTime: true,
          resource: { select: { name: true } },
          participants: { select: { user: { select: USER_SEL } } },
        },
      }),
      prisma.tournament.findMany({
        where: {
          clubId, status: 'PUBLISHED', startTime: { gt: now },
          registrations: {
            some: { status: { not: 'CANCELLED' }, OR: [{ captainUserId: { in: ids } }, { partnerUserId: { in: ids } }] },
          },
        },
        orderBy: { startTime: 'asc' },
        take: AGENDA_CAP,
        select: {
          id: true, name: true, startTime: true, endTime: true,
          registrations: {
            where: { status: { not: 'CANCELLED' }, OR: [{ captainUserId: { in: ids } }, { partnerUserId: { in: ids } }] },
            select: { captain: { select: USER_SEL }, partner: { select: USER_SEL } },
          },
        },
      }),
      prisma.clubEvent.findMany({
        where: {
          clubId, status: 'PUBLISHED', startTime: { gt: now },
          registrations: { some: { status: { not: 'CANCELLED' }, userId: { in: ids } } },
        },
        orderBy: { startTime: 'asc' },
        take: AGENDA_CAP,
        select: {
          id: true, name: true, startTime: true, endTime: true,
          registrations: { where: { status: { not: 'CANCELLED' }, userId: { in: ids } }, select: { user: { select: USER_SEL } } },
        },
      }),
    ]);

    const circle = new Set(ids);
    const inCircle = (users: AgendaFriend[]): AgendaFriend[] => {
      const out: AgendaFriend[] = [];
      const seen = new Set<string>();
      for (const u of users) {
        if (!circle.has(u.id) || seen.has(u.id)) continue;
        seen.add(u.id);
        out.push(u);
        if (out.length >= AGENDA_FRIENDS_CAP) break;
      }
      return out;
    };

    const items: FriendsAgendaItem[] = [
      ...matches.map((m) => ({
        kind: 'match' as const, id: m.id, startTime: m.startTime, endTime: m.endTime,
        label: `Partie ouverte · ${m.resource.name}`,
        friends: inCircle(m.participants.map((p) => p.user)),
      })),
      ...tournaments.map((t) => ({
        kind: 'tournament' as const, id: t.id, startTime: t.startTime, endTime: t.endTime,
        label: t.name,
        friends: inCircle(t.registrations.flatMap((r) => [r.captain, r.partner])),
      })),
      ...events.map((e) => ({
        kind: 'event' as const, id: e.id, startTime: e.startTime, endTime: e.endTime,
        label: e.name,
        friends: inCircle(e.registrations.map((r) => r.user)),
      })),
    ].filter((i) => i.friends.length > 0);

    items.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
    return items.slice(0, AGENDA_CAP);
  }

  /** Suggestions « vous avez joué ensemble » : partenaires récents pas encore dans mon cercle. */
  async playerSuggestions(slug: string, userId: string, now: Date = new Date()): Promise<PlayerSuggestion[]> {
    const clubId = await this.activeClubId(slug);
    const since = new Date(now.getTime() - SUGGESTION_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const myReservations = await prisma.reservation.findMany({
      where: {
        status: 'CONFIRMED', startTime: { gte: since, lt: now },
        resource: { clubId },
        OR: [{ userId }, { participants: { some: { userId } } }],
      },
      orderBy: { startTime: 'desc' },
      take: 200,
      select: { userId: true, startTime: true, participants: { select: { userId: true } } },
    });

    // Agrège les co-joueurs : dernier match partagé + nombre de matchs partagés.
    const byPlayer = new Map<string, { lastPlayedAt: Date; playedCount: number }>();
    for (const r of myReservations) {
      const others = new Set<string>();
      if (r.userId && r.userId !== userId) others.add(r.userId);
      for (const p of r.participants) if (p.userId !== userId) others.add(p.userId);
      for (const other of others) {
        const cur = byPlayer.get(other);
        if (cur) {
          cur.playedCount += 1;
          if (r.startTime > cur.lastPlayedAt) cur.lastPlayedAt = r.startTime;
        } else {
          byPlayer.set(other, { lastPlayedAt: r.startTime, playedCount: 1 });
        }
      }
    }
    const candidates = [...byPlayer.keys()];
    if (candidates.length === 0) return [];

    // Exclusions : déjà suivi (favori) OU toute relation d'amitié (PENDING comme ACCEPTED).
    const [follows, friendships] = await Promise.all([
      prisma.follow.findMany({
        where: { followerId: userId, followingId: { in: candidates } },
        select: { followingId: true },
      }),
      prisma.friendship.findMany({
        where: { OR: [{ userAId: userId, userBId: { in: candidates } }, { userBId: userId, userAId: { in: candidates } }] },
        select: { userAId: true, userBId: true },
      }),
    ]);
    const excluded = new Set<string>(follows.map((f) => f.followingId));
    for (const f of friendships) excluded.add(f.userAId === userId ? f.userBId : f.userAId);

    const keptIds = candidates.filter((id) => !excluded.has(id));
    if (keptIds.length === 0) return [];

    const users = await prisma.user.findMany({
      where: {
        id: { in: keptIds }, deletedAt: null, isSuperAdmin: false,
        clubMemberships: { some: { clubId, status: 'ACTIVE' } },
      },
      select: { ...USER_SEL, acceptsFriendRequests: true },
    });
    const sportKey = await resolvePreferredSportKey(userId);
    const levels = await this.ratingService.getLevelsForUsers(users.map((u) => u.id), sportKey);

    return users
      .map((u) => ({
        id: u.id, firstName: u.firstName, lastName: u.lastName, avatarUrl: u.avatarUrl,
        level: levels[u.id] ?? null,
        requestable: u.acceptsFriendRequests,
        ...byPlayer.get(u.id)!,
      }))
      .sort((a, b) => b.lastPlayedAt.getTime() - a.lastPlayedAt.getTime())
      .slice(0, SUGGESTIONS_CAP);
  }
}
