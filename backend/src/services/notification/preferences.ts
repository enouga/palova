import { NotificationCategory, NotificationChannel } from '@prisma/client';

export interface PrefRow {
  category: NotificationCategory;
  channel: NotificationChannel;
  enabled: boolean;
}

/** Canal activé par défaut (opt-out). CLUB_MESSAGES+INAPP est toujours forcé ON. */
export function channelEnabled(
  prefs: PrefRow[],
  category: NotificationCategory,
  channel: NotificationChannel,
): boolean {
  if (category === 'CLUB_MESSAGES' && channel === 'INAPP') return true;
  const row = prefs.find((p) => p.category === category && p.channel === channel);
  return row ? row.enabled : true;
}

export interface ResolvedChannels { inapp: boolean; email: boolean; push: boolean; }

/** Push effectif seulement si le destinataire a au moins un abonnement (hasPushSub). */
export function resolveChannels(
  prefs: PrefRow[],
  category: NotificationCategory,
  hasPushSub: boolean,
): ResolvedChannels {
  return {
    inapp: channelEnabled(prefs, category, 'INAPP'),
    email: channelEnabled(prefs, category, 'EMAIL'),
    push: channelEnabled(prefs, category, 'PUSH') && hasPushSub,
  };
}
