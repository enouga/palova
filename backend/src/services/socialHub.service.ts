import { prisma } from '../db/prisma';

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

const AGENDA_CAP = 6;
const AGENDA_FRIENDS_CAP = 4;

/** Hub social « Mes amis » : agenda du cercle (amis ∪ favoris). */
export class SocialHubService {
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
          resource: { clubId },
          participants: { some: { userId: { in: ids } } },
        },
        orderBy: { startTime: 'asc' },
        take: AGENDA_CAP,
        select: {
          id: true, startTime: true, endTime: true,
          resource: { select: { name: true } },
          participants: { select: { userId: true, user: { select: USER_SEL } } },
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
            where: { status: { not: 'CANCELLED' } },
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
          registrations: { where: { status: { not: 'CANCELLED' } }, select: { user: { select: USER_SEL } } },
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
}
