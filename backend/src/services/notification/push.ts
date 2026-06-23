import webpush from 'web-push';
import { prisma } from '../../db/prisma';

// Configure VAPID on module load — only if all 3 vars are present.
// Skipped silently in tests/dev when vars are absent.
const _subject = process.env.VAPID_SUBJECT;
const _publicKey = process.env.VAPID_PUBLIC_KEY;
const _privateKey = process.env.VAPID_PRIVATE_KEY;

if (_subject && _publicKey && _privateKey) {
  webpush.setVapidDetails(_subject, _publicKey, _privateKey);
}

/** Returns the VAPID public key, or null if not configured. */
export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY ?? null;
}

export interface PushSub {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string | null;
}

/**
 * Deliver a push notification to each subscription.
 * Best-effort: never throws. Expired subscriptions (HTTP 404/410) are deleted.
 */
export async function deliverPush(subs: PushSub[], payload: PushPayload): Promise<void> {
  if (!vapidPublicKey()) {
    // VAPID not configured — push is a no-op
    return;
  }

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
      );
    } catch (err: any) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        // Stale subscription — delete it quietly
        await prisma.pushSubscription.delete({ where: { endpoint: sub.endpoint } }).catch(() => {});
      } else {
        console.error('[notif:push]', err instanceof Error ? err.message : String(err));
      }
    }
  }
}
