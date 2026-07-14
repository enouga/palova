import { NotifPrefRow } from './api';
import type { IconName } from '@/components/ui/Icon';
import { ACCENTS } from '@/lib/theme';

export type NotifCategory =
  | 'MY_GAMES' | 'OPEN_MATCH_CHAT' | 'DIRECT_MESSAGES' | 'MY_REGISTRATIONS' | 'MY_MATCHES' | 'PAYMENTS'
  | 'CLUB_MESSAGES' | 'ORGANIZER' | 'REMINDERS' | 'SOCIAL' | 'MODERATION';
export type NotifChannel = 'INAPP' | 'PUSH' | 'EMAIL';

export interface CategoryMeta { key: NotifCategory; label: string; desc: string; staffOnly?: boolean }

// Ordre d'affichage dans la grille de préférences.
export const CATEGORY_META: CategoryMeta[] = [
  { key: 'MY_GAMES', label: 'Mes parties', desc: "Ajout/retrait, arrivée/départ d’un joueur, statut de mes réservations" },
  { key: 'OPEN_MATCH_CHAT', label: 'Messages de partie', desc: 'Chat des parties ouvertes que vous suivez ou auxquelles vous participez' },
  { key: 'DIRECT_MESSAGES', label: 'Messages privés', desc: 'Quand un membre vous écrit en privé' },
  { key: 'MY_REGISTRATIONS', label: 'Mes inscriptions', desc: "Tournois, events, cours : confirmation, liste d’attente, annulation" },
  { key: 'MY_MATCHES', label: 'Mes matchs', desc: 'Confirmation de résultat, litige' },
  { key: 'PAYMENTS', label: 'Paiements', desc: 'Remboursements' },
  { key: 'CLUB_MESSAGES', label: 'Messages du club', desc: "Annonces de l’équipe du club" },
  { key: 'ORGANIZER', label: 'Activité de mes events', desc: "Inscriptions/désinscriptions sur ce que j’organise", staffOnly: true },
  { key: 'MODERATION', label: 'Signalements', desc: 'Un message du chat de partie a été signalé', staffOnly: true },
  { key: 'REMINDERS', label: 'Rappels', desc: 'Avant une partie ou un event' },
  { key: 'SOCIAL', label: 'Amis & suivi', desc: 'Quand un joueur commence à vous suivre' },
];

export const CHANNELS: NotifChannel[] = ['INAPP', 'PUSH', 'EMAIL'];
export const CHANNEL_LABEL: Record<NotifChannel, string> = { INAPP: 'Cloche', PUSH: 'Push', EMAIL: 'Email' };

/** Verrou : CLUB_MESSAGES + INAPP est toujours ON, non modifiable. */
export function isLocked(category: NotifCategory, channel: NotifChannel): boolean {
  return category === 'CLUB_MESSAGES' && channel === 'INAPP';
}

/** État effectif d'une case (miroir de la résolution backend, opt-out). */
export function effective(prefs: NotifPrefRow[], category: NotifCategory, channel: NotifChannel): boolean {
  if (isLocked(category, channel)) return true;
  const row = prefs.find((p) => p.category === category && p.channel === channel);
  return row ? row.enabled : true;
}

// --- Présentation d'une notification (cloche + page) ------------------------

export interface NotifVisual {
  icon: IconName;
  accent: string;
}

// Icône + teinte d'une notification, déduites de sa catégorie (avec raffinements par type).
// Le type prime sur la catégorie pour les cas visuellement distincts (annulation, report, remboursement).
export function notificationVisual(category: string, type: string): NotifVisual {
  // Raffinements par type (priorité haute).
  if (type.includes('cancelled') || type.includes('removed') || type.includes('left')) {
    return { icon: 'x', accent: ACCENTS.coral };
  }
  if (type === 'reservation.rescheduled') {
    return { icon: 'calendar', accent: ACCENTS.apricot };
  }
  if (type === 'payment.refunded') {
    return { icon: 'euro', accent: ACCENTS.emerald };
  }

  // Par catégorie.
  switch (category) {
    case 'REMINDERS':         return { icon: 'clock', accent: ACCENTS.blue };
    case 'MY_GAMES':          return { icon: 'users', accent: ACCENTS.emerald };
    case 'MY_REGISTRATIONS':  return { icon: 'trophy', accent: ACCENTS.violet };
    case 'ORGANIZER':         return { icon: 'trophy', accent: ACCENTS.apricot };
    case 'PAYMENTS':          return { icon: 'euro', accent: ACCENTS.emerald };
    case 'MY_MATCHES':        return { icon: 'ball', accent: ACCENTS.blue };
    case 'DIRECT_MESSAGES':   return { icon: 'chat', accent: ACCENTS.blue };
    case 'CLUB_MESSAGES':     return { icon: 'info', accent: ACCENTS.cyan };
    case 'MODERATION':        return { icon: 'flag', accent: ACCENTS.coral };
    default:                  return { icon: 'bell', accent: ACCENTS.blue };
  }
}

const MONTHS_FR = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

// Horodatage relatif court : « à l'instant », « il y a 5 min », « il y a 2 h », « hier »,
// « il y a 3 j », puis date en clair au-delà d'une semaine. Pur (fonction de `now`).
export function relativeTime(iso: string, now: Date): string {
  const ms = now.getTime() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'hier';
  if (d < 7) return `il y a ${d} j`;

  const date = new Date(iso);
  const label = `${date.getUTCDate()} ${MONTHS_FR[date.getUTCMonth()]}`;
  return date.getUTCFullYear() === now.getUTCFullYear() ? label : `${label} ${date.getUTCFullYear()}`;
}
