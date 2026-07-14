import { Friend } from './api';

// Helpers PURS du hub social « Mes amis » — testés, paramétrés par `now` (hydration-safe :
// jamais de new Date() ici, l'horloge est posée en effet par le composant).

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

/** Libellé relatif d'une date passée : « aujourd'hui », « hier », « samedi », « il y a 3 sem. », « il y a 2 mois ». */
export function relativeDayLabel(iso: string, now: Date): string {
  const d = new Date(iso);
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(d)) / DAY_MS);
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return 'hier';
  if (days < 7) return WEEKDAYS_FR[d.getDay()];
  if (days < 30) return `il y a ${Math.floor(days / 7)} sem.`;
  const months = Math.floor(days / 30);
  return months <= 1 ? 'il y a 1 mois' : `il y a ${months} mois`;
}

/** Ligne vivante d'une carte ami : « 12 parties ensemble · samedi ». null si rien à dire. */
export function playedTogetherLine(
  f: Pick<Friend, 'playedTogetherCount' | 'lastPlayedTogetherAt'>,
  now: Date | null,
): string | null {
  if (!now || !f.playedTogetherCount || !f.lastPlayedTogetherAt) return null;
  const n = f.playedTogetherCount;
  return `${n} partie${n > 1 ? 's' : ''} ensemble · ${relativeDayLabel(f.lastPlayedTogetherAt, now)}`;
}

/** Raison d'une suggestion : « Vous avez joué ensemble samedi ». */
export function suggestionReason(lastPlayedAtIso: string, now: Date | null): string {
  if (!now) return 'Vous avez joué ensemble récemment';
  return `Vous avez joué ensemble ${relativeDayLabel(lastPlayedAtIso, now)}`;
}

/** Favoris affichés = follows − amis confirmés (un ami n'apparaît que dans la section Amis). */
export function dedupFavorites(follows: Friend[], friends: Friend[]): Friend[] {
  const friendIds = new Set(friends.map((f) => f.id));
  return follows.filter((f) => !friendIds.has(f.id));
}

/** Ancre du deep-link ?tab= : seules demandes/followers ont une cible, le reste = haut de page. */
export type FriendsAnchor = 'demandes' | 'followers' | null;
export function friendsAnchor(tabParam: string | null): FriendsAnchor {
  if (tabParam === 'demandes') return 'demandes';
  if (tabParam === 'followers') return 'followers';
  return null;
}

/** Quand d'un item d'agenda au fuseau du club : « sam. 18 · 18h30 ». */
export function agendaWhenLabel(iso: string, timezone: string): string {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', timeZone: timezone }).format(d);
  const time = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(d).replace(':', 'h');
  return `${day} · ${time}`;
}
