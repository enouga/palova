import { AgendaListItem, agendaItemClub } from '@/lib/calendar';
import { MyRating, NationalOpenMatch, UserLevel } from '@/lib/api';
import { clubUrl } from '@/lib/clubUrl';

const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;

export interface HomeAgendaSplit { hero: AgendaListItem | null; next: AgendaListItem[] }

/** Hero = 1re entrée à venir ; next = les `count` suivantes (le hero n'y figure jamais). */
export function splitHomeAgenda(list: AgendaListItem[], count = 3): HomeAgendaSplit {
  const upcoming = list.filter((i) => !i.past);
  return { hero: upcoming[0] ?? null, next: upcoming.slice(1, 1 + count) };
}

/** Chip de compte à rebours du hero — null dès que c'est commencé (le hero garde l'entrée). */
export function startsInLabel(startIso: string, now: Date): string | null {
  const diff = new Date(startIso).getTime() - now.getTime();
  if (diff <= 0) return null;
  if (diff < HOUR) return `dans ${Math.max(1, Math.round(diff / MIN))} min`;
  if (diff < 48 * HOUR) return `dans ${Math.round(diff / HOUR)} h`;
  return `J-${Math.floor(diff / DAY)}`;
}

/** Rail « Parties à rejoindre » : mes clubs d'abord (ordre du flux conservé), puis le reste, cap. */
export function sortMatchesForHome(matches: NationalOpenMatch[], myClubSlugs: Set<string>, cap = 6): NationalOpenMatch[] {
  const mine = matches.filter((m) => myClubSlugs.has(m.club.slug));
  const others = matches.filter((m) => !myClubSlugs.has(m.club.slug));
  return [...mine, ...others].slice(0, cap);
}

/** `LevelChip` attend un UserLevel — MyRating (level nullable) doit être mappé. */
export function ratingToLevel(r: MyRating | null): UserLevel | null {
  if (!r || r.level == null) return null;
  return { level: r.level, tier: r.tier, isProvisional: r.isProvisional, reliability: r.reliability };
}

/** Titre + lien profond d'une entrée d'agenda (cartes du hero et de « À venir »). */
export function agendaItemHeading(item: AgendaListItem): { title: string; href: string } {
  const slug = agendaItemClub(item).slug;
  if (item.kind === 'reservation') return { title: item.r.resource.name, href: '/me/reservations' };
  if (item.kind === 'tournament') return { title: item.reg.tournament.name, href: clubUrl(slug, `/tournois/${item.reg.tournament.id}`) };
  if (item.kind === 'event') return { title: item.ev.event.name, href: clubUrl(slug, `/events/${item.ev.event.id}`) };
  return { title: `Cours · ${item.enrollment.lesson.coach.name}`, href: `/cours/${item.enrollment.lesson.id}` };
}

/** « jeu. 23 juil. · 18h00 » au fuseau du club de CHAQUE entrée (multi-clubs = multi-fuseaux). */
export function agendaWhenLabel(item: AgendaListItem): string {
  const tz = item.kind === 'reservation' ? item.r.resource.club.timezone
    : item.kind === 'tournament' ? item.reg.tournament.club.timezone
    : item.kind === 'lesson' ? item.enrollment.lesson.club.timezone
    : item.ev.event.club.timezone;
  const d = new Date(item.start);
  const date = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).format(d);
  const hour = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(d).replace(':', 'h');
  return `${date} · ${hour}`;
}
