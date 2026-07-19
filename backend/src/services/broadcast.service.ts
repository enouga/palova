import { prisma } from '../db/prisma';
import { dispatch } from './notification/dispatcher';
import { buildBroadcastEmail } from '../email/templates/emails';
import { clubAppUrl, absoluteAsset, apiPublicUrl } from '../email/links';
import { Brand } from '../email/templates/layout';
import { unsubscribeToken } from './unsubscribeToken';

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
  ): Promise<{ recipientCount: number; broadcastId: string; emailOptOuts: number }> {
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

    // Brand commun (logo/couleur), le lien de désinscription est ajouté PAR destinataire
    // ci-dessous (signé par userId — cf. unsubscribeToken.ts).
    const brand: Brand = {
      name: club.name,
      logoUrl: absoluteAsset(club.logoUrl),
      accentColor: club.accentColor || '#5e93da',
    };
    const targetUrl = input.url ?? clubAppUrl(club.slug, '/');

    // Informationnel seulement : dispatch()/resolveChannels() font DÉJÀ le vrai filtrage
    // par préférence (cf. dispatcher.ts) — ce compte ne change qui reçoit quoi.
    const optOuts = await prisma.notificationPreference.count({
      where: {
        category: 'CLUB_MESSAGES',
        channel: 'EMAIL',
        enabled: false,
        userId: { in: members.map((m) => m.user.id) },
      },
    });

    // V1: synchronous fan-out (one dispatch per member). Fine for typical club sizes.
    // A queue-based approach is explicitly out of scope for V1.
    for (const m of members) {
      const unsubscribeUrl = apiPublicUrl(`/api/unsubscribe?token=${unsubscribeToken(m.user.id)}`);
      const { subject, html, text } = buildBroadcastEmail({
        title,
        body,
        url: targetUrl,
        brand: { ...brand, unsubscribeUrl },
      });
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

    return { recipientCount: members.length, broadcastId: broadcast.id, emailOptOuts: optOuts };
  }

  async history(clubId: string) {
    return prisma.clubBroadcast.findMany({
      where: { clubId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
