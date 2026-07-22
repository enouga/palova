import { NotificationCategory, Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { sendMail } from '../../email/mailer';
import { SSEService } from '../sse.service';
import { resolveChannels } from './preferences';
import { deliverPush, resolvePushIcon, resolvePushBadge, PushSub } from './push';

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
  /**
   * Plafond de canaux imposé par l'appelant (ex. diffusion : le club choisit email/cloche/push).
   * Intersecté avec les préférences du destinataire. Absent = aucun plafond (comportement historique).
   */
  allowChannels?: { inapp?: boolean; email?: boolean; push?: boolean };
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

  // Plafond appelant (ex. diffusion club) : un canal ne part que s'il est autorisé
  // À LA FOIS par les préférences du membre ET par l'appelant.
  if (input.allowChannels) {
    const a = input.allowChannels;
    channels = {
      inapp: channels.inapp && a.inapp !== false,
      email: channels.email && a.email !== false,
      push: channels.push && a.push !== false,
    };
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
      const [icon, badge] = await Promise.all([resolvePushIcon(input.clubId), resolvePushBadge(input.clubId)]);
      await deliverPush(subs, { title: input.title, body: input.body, url: input.url ?? null, icon, badge });
    } catch (e) {
      console.error('[notif:push]', (e as Error).message);
    }
  }
}
