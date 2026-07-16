import webpush from 'web-push';
import { prisma } from '../../db/prisma';
import { absoluteAsset, platformAsset } from '../../email/links';

// Configure VAPID on module load — only if all 3 vars are present.
// Skipped silently in tests/dev when vars are absent.
const _subject = process.env.VAPID_SUBJECT;
const _publicKey = process.env.VAPID_PUBLIC_KEY;
const _privateKey = process.env.VAPID_PRIVATE_KEY;

if (_subject && _publicKey && _privateKey) {
  webpush.setVapidDetails(_subject, _publicKey, _privateKey);
}
const isPushConfigured = !!(_subject && _publicKey && _privateKey);

/** Returns the VAPID public key, or null if not configured. */
export function vapidPublicKey(): string | null {
  return isPushConfigured ? _publicKey : null;
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
  icon?: string | null;
  badge?: string | null;
}

/**
 * Icône à afficher dans la notification : logo du club (la route d'icône gère déjà le
 * repli Palova si le club n'a pas de logo), ou repli direct Palova hors contexte club.
 */
export async function resolvePushIcon(clubId?: string | null): Promise<string | null> {
  if (!clubId) return platformAsset('/icon-192.png');
  try {
    const club = await prisma.club.findUnique({ where: { id: clubId }, select: { slug: true } });
    if (!club) return platformAsset('/icon-192.png');
    return absoluteAsset(`/api/clubs/${club.slug}/icon/192.png`);
  } catch {
    return platformAsset('/icon-192.png');
  }
}

/**
 * Badge Android (silhouette monochrome dans la barre d'état) : variante badge-96 du club
 * (repli Palova géré par la route), ou asset Palova hors contexte club.
 */
export async function resolvePushBadge(clubId?: string | null): Promise<string | null> {
  if (!clubId) return platformAsset('/icon-badge-96.png');
  try {
    const club = await prisma.club.findUnique({ where: { id: clubId }, select: { slug: true } });
    if (!club) return platformAsset('/icon-badge-96.png');
    return absoluteAsset(`/api/clubs/${club.slug}/icon/badge-96.png`);
  } catch {
    return platformAsset('/icon-badge-96.png');
  }
}

/**
 * Deliver a push notification to each subscription.
 * Best-effort: never throws. Expired subscriptions (HTTP 404/410) are deleted.
 */
export async function deliverPush(subs: PushSub[], payload: PushPayload): Promise<void> {
  if (!isPushConfigured) {
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
