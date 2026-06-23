import { NotificationCategory, Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { sendMail } from '../../email/mailer';
import { SSEService } from '../sse.service';
import { resolveChannels } from './preferences';
import { deliverPush, PushSub } from './push';

export interface DispatchEmail { to: string; subject: string; html: string; text: string; }

export interface DispatchInput {
  userId: string;
  clubId?: string | null;
  category: NotificationCategory;
  type: string;
  title: string;
  body: string;
  url?: string | null;
  data?: Prisma.InputJsonValue;
  /** Payload email optionnel : si fourni ET canal EMAIL actif, on l'envoie. */
  email?: DispatchEmail | null;
}

/**
 * Aiguille une notification vers les canaux activés du destinataire (best-effort).
 * À appeler APRÈS commit. Ne lève jamais : chaque canal est isolé.
 * Lot 1 : push inactif (aucun abonnement) — le canal existe mais n'est jamais effectif.
 */
export async function dispatch(input: DispatchInput): Promise<void> {
  let channels;
  let subs: PushSub[] = [];
  try {
    const prefs = await prisma.notificationPreference.findMany({
      where: { userId: input.userId, category: input.category },
      select: { category: true, channel: true, enabled: true },
    });
    try {
      subs = await prisma.pushSubscription.findMany({
        where: { userId: input.userId },
        select: { endpoint: true, p256dh: true, auth: true },
      });
    } catch (e) {
      console.error('[notif:push:load]', (e as Error).message);
      subs = [];
    }
    channels = resolveChannels(prefs, input.category, subs.length > 0);
  } catch (e) {
    console.error('[notif:prefs]', (e as Error).message);
    return;
  }

  if (channels.inapp) {
    try {
      await prisma.notification.create({
        data: {
          userId: input.userId,
          clubId: input.clubId ?? null,
          category: input.category,
          type: input.type,
          title: input.title,
          body: input.body,
          url: input.url ?? null,
          data: input.data ?? undefined,
        },
      });
      SSEService.getInstance().notifyUser(input.userId, { type: 'notification' });
    } catch (e) {
      console.error('[notif:inapp]', (e as Error).message);
    }
  }

  if (channels.email && input.email) {
    try {
      await sendMail(input.email);
    } catch (e) {
      console.error('[notif:email]', (e as Error).message);
    }
  }

  if (channels.push && subs.length) {
    try {
      await deliverPush(subs, { title: input.title, body: input.body, url: input.url ?? null });
    } catch (e) {
      console.error('[notif:push]', (e as Error).message);
    }
  }
}
