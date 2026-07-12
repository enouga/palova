// Helpers purs de la vitrine « Le club » (Club-house + page /club).
// Catalogue AMENITIES : miroir backend de AMENITY_KEYS (presentation.service.ts) — garder synchro.
import { ClubPhoto, ClubPresentation, ClubSportPublic } from '@/lib/api';
import type { IconName } from '@/components/ui/Icon';

export interface Amenity { key: string; label: string; icon: IconName }

export const AMENITIES: Amenity[] = [
  { key: 'bar', label: 'Bar & cuisine', icon: 'cup' },
  { key: 'shop', label: 'Boutique', icon: 'cart' },
  { key: 'lockers', label: 'Vestiaires & douches', icon: 'shower' },
  { key: 'parking', label: 'Parking', icon: 'parking' },
  { key: 'rental', label: 'Location de matériel', icon: 'racket' },
  { key: 'terrace', label: 'Terrasse', icon: 'parasol' },
  { key: 'wifi', label: 'Wi-Fi', icon: 'wifi' },
  { key: 'coaching', label: 'Cours & coaching', icon: 'whistle' },
];

export function amenityList(keys: string[] | null | undefined): Amenity[] {
  if (!keys?.length) return [];
  return AMENITIES.filter((a) => keys.includes(a.key));
}

/** Kicker « Paris · Depuis 2021 » — segments absents omis, null si vide. */
export function showcaseKicker(city: string | null | undefined, foundedYear: number | null | undefined): string | null {
  const parts = [city, foundedYear ? `Depuis ${foundedYear}` : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

export interface CourtsSummary { total: number; indoor: number; multiSport: boolean; padel: boolean }

export function courtsSummary(clubSports: ClubSportPublic[] | null | undefined): CourtsSummary | null {
  const withCourts = (clubSports ?? []).filter((s) => s.resources.length > 0);
  const total = withCourts.reduce((n, s) => n + s.resources.length, 0);
  if (total === 0) return null;
  const indoor = withCourts.reduce((n, s) => n + s.resources.filter((r) => r.attributes?.coverage === 'indoor').length, 0);
  return { total, indoor, multiSport: withCourts.length > 1, padel: withCourts.length === 1 && withCourts[0].sport.key === 'padel' };
}

/** « 3 pistes · 2 indoor » (padel) / « 2 terrains » (autre) / « 5 terrains » (multi-sport, sans indoor). */
export function courtsChipLabel(s: CourtsSummary | null): string | null {
  if (!s) return null;
  const noun = !s.multiSport && s.padel ? 'piste' : 'terrain';
  const base = `${s.total} ${noun}${s.total > 1 ? 's' : ''}`;
  return !s.multiSport && s.indoor > 0 ? `${base} · ${s.indoor} indoor` : base;
}

export interface HoursRange { open: number; close: number }

export function hoursRange(clubSports: ClubSportPublic[] | null | undefined): HoursRange | null {
  const res = (clubSports ?? []).flatMap((s) => s.resources);
  if (res.length === 0) return null;
  return { open: Math.min(...res.map((r) => r.openHour)), close: Math.max(...res.map((r) => r.closeHour)) };
}

/** Chip horaires vivante — `now` null (avant hydration) → null, jamais de new Date() au rendu. */
export function openNowChip(hours: HoursRange | null, timezone: string, now: Date | null): { open: boolean; label: string } | null {
  if (!hours || !now) return null;
  // en-GB : rend « 12 » nu (fr-FR rendrait « 12 h » → NaN).
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: timezone }).format(now));
  const open = h >= hours.open && h < hours.close;
  const closeLabel = hours.close >= 24 ? 'minuit' : `${hours.close}h`;
  return open ? { open: true, label: `Ouvert · jusqu'à ${closeLabel}` } : { open: false, label: `Ouvre à ${hours.open}h` };
}

export function coverUrl(p: ClubPresentation): string | null {
  return p.coverImageUrl ?? p.photos[0]?.url ?? null;
}

/** Rail desktop : ≤ 2 tuiles (hors cover) + compteur du reste. */
export function railPhotos(p: ClubPresentation): { tiles: ClubPhoto[]; more: number } {
  const cover = coverUrl(p);
  const rest = p.photos.filter((ph) => ph.url !== cover);
  return { tiles: rest.slice(0, 2), more: Math.max(0, rest.length - 2) };
}

/** La section n'apparaît que si le club a AU MOINS une info propre à montrer. */
export function showShowcase(p: ClubPresentation | null): p is ClubPresentation {
  if (!p) return false;
  return !!(p.presentationText || p.coverImageUrl || p.photos.length > 0 || (p.amenities?.length ?? 0) > 0 || p.foundedYear);
}
