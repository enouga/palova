import { prisma } from '../db/prisma';
import { dispatch } from './notification/dispatcher';
import { buildBroadcastEmail } from '../email/templates/emails';
import { clubAppUrl, absoluteAsset } from '../email/links';
import { Brand } from '../email/templates/layout';

interface SendInput {
  title: string;
  body: string;
  url?: string | null;
}

export class BroadcastService {
  async countActiveMembers(clubId: string): Promise<number> {
    return prisma.clubMembership.count({ where: { clubId, status: 'ACTIVE' } });
  }

  async send(
    clubId: string,
    sentByUserId: string,
    input: SendInput,
  ): Promise<{ recipientCount: number; broadcastId: string }> {
    const title = input.title.trim();
    const body = input.body.trim();
    if (!title || !body) throw new Error('VALIDATION_ERROR');

    // Load club + active members in parallel
    const [club, members] = await Promise.all([
      prisma.club.findUniqueOrThrow({
        where: { id: clubId },
        select: { name: true, slug: true, logoUrl: true, accentColor: true, timezone: true },
      }),
      prisma.clubMembership.findMany({
        where: { clubId, status: 'ACTIVE' },
        select: { user: { select: { id: true, email: true, firstName: true } } },
      }),
    ]);

    // Create audit row
    const broadcast = await prisma.clubBroadcast.create({
      data: { clubId, sentByUserId, title, body, url: input.url ?? null, recipientCount: members.length },
    });

    // Build brand + email once (same for everyone)
    const brand: Brand = {
      name: club.name,
      logoUrl: absoluteAsset(club.logoUrl),
      accentColor: club.accentColor || '#5e93da',
    };
    const targetUrl = input.url ?? clubAppUrl(club.slug, '/');
    const { subject, html, text } = buildBroadcastEmail({ title, body, url: targetUrl, brand });

    // V1: synchronous fan-out (one dispatch per member). Fine for typical club sizes.
    // A queue-based approach is explicitly out of scope for V1.
    for (const m of members) {
      await dispatch({
        userId: m.user.id,
        clubId,
        category: 'CLUB_MESSAGES',
        type: 'club.broadcast',
        title,
        body,
        url: targetUrl,
        email: m.user.email ? { to: m.user.email, subject, html, text } : null,
      });
    }

    return { recipientCount: members.length, broadcastId: broadcast.id };
  }

  async history(clubId: string) {
    return prisma.clubBroadcast.findMany({
      where: { clubId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
