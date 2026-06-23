import { NotifPrefRow } from './api';

export type NotifCategory =
  | 'MY_GAMES' | 'MY_REGISTRATIONS' | 'MY_MATCHES' | 'PAYMENTS'
  | 'CLUB_MESSAGES' | 'ORGANIZER' | 'REMINDERS';
export type NotifChannel = 'INAPP' | 'PUSH' | 'EMAIL';

export interface CategoryMeta { key: NotifCategory; label: string; desc: string; staffOnly?: boolean }

// Ordre d'affichage dans la grille de préférences.
export const CATEGORY_META: CategoryMeta[] = [
  { key: 'MY_GAMES', label: 'Mes parties', desc: "Ajout/retrait, arrivée/départ d’un joueur, statut de mes réservations" },
  { key: 'MY_REGISTRATIONS', label: 'Mes inscriptions', desc: "Tournois, events, cours : confirmation, liste d’attente, annulation" },
  { key: 'MY_MATCHES', label: 'Mes matchs', desc: 'Confirmation de résultat, litige' },
  { key: 'PAYMENTS', label: 'Paiements', desc: 'Remboursements' },
  { key: 'CLUB_MESSAGES', label: 'Messages du club', desc: "Annonces de l’équipe du club" },
  { key: 'ORGANIZER', label: 'Activité de mes events', desc: "Inscriptions/désinscriptions sur ce que j’organise", staffOnly: true },
  { key: 'REMINDERS', label: 'Rappels', desc: 'Avant une partie ou un event' },
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
