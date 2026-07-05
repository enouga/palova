import { Announcement, ClubAvailability, Sponsor, TimeSlot, Tournament } from '@/lib/api';

export interface UpcomingSlot {
  resourceId: string;
  resourceName: string;
  slot: TimeSlot;
}

/** Date du jour (clé YYYY-MM-DD) — même convention que ClubReserve. */
export function todayISO(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Décale une clé jour YYYY-MM-DD de `days` jours (arithmétique UTC pure). */
export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Les `max` prochains créneaux libres (tous terrains confondus), postérieurs à `now`, triés par heure. */
export function pickUpcomingSlots(avail: ClubAvailability[], now: Date, max = 3): UpcomingSlot[] {
  return avail
    .flatMap((a) =>
      a.slots
        .filter((s) => s.available && new Date(s.startTime) > now)
        .map((slot) => ({ resourceId: a.resource.id, resourceName: a.resource.name, slot })),
    )
    // ISO UTC : ordre lexicographique = ordre chronologique
    .sort((x, y) => x.slot.startTime.localeCompare(y.slot.startTime))
    .slice(0, max);
}

// NB : le bloc « Prochains events » du Club-house fusionne désormais tournois +
// animations via mergeAgenda (lib/events.ts) — l'ancien pickUpcomingTournaments a disparu.

/** Annonce expirée (masquée partout : hero, bento, liste texte). */
export function announcementExpired(a: Pick<Announcement, 'validUntil'>, now: Date): boolean {
  return !!a.validUntil && new Date(a.validUntil) <= now;
}

/** Affiches actives : annonces AVEC image, non expirées, hors hero épinglé, plafond 5. */
export function activePosters(anns: Announcement[], now: Date, heroId: string | null = null): Announcement[] {
  return anns
    .filter((a) => a.imageUrl && a.id !== heroId && !announcementExpired(a, now))
    .slice(0, 5);
}

export type PosterLayout = 'single' | 'duo' | 'bento';

/** Forme de la mosaïque selon le nombre d'affiches. */
export function posterLayout(n: number): PosterLayout {
  return n <= 1 ? 'single' : n === 2 ? 'duo' : 'bento';
}

/** L'offre d'un partenaire est-elle affichable ? Texte présent et date de fin non dépassée. */
export function offerIsActive(s: Pick<Sponsor, 'offerText' | 'offerUntil'>, now: Date): boolean {
  if (!s.offerText) return false;
  return s.offerUntil == null || new Date(s.offerUntil) > now;
}

export interface PulseChip { kind: 'slot' | 'matches' | 'event'; label: string; }

/** Jour + heure courte au fuseau du club (« dim. 20h00 »). */
function pulseWhen(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz })
    .format(new Date(iso)).replace(':', 'h');
}

/** Rangée « pouls du club » du hero — une chip par donnée existante ; now null (avant mount) → []. */
export function clubPulse({ slots, matchCount, nextEventStart, now, timezone }: {
  slots: UpcomingSlot[]; matchCount: number; nextEventStart: string | null; now: Date | null; timezone: string;
}): PulseChip[] {
  if (!now) return [];
  const chips: PulseChip[] = [];
  if (slots.length > 0) chips.push({ kind: 'slot', label: `Prochain créneau ${pulseWhen(slots[0].slot.startTime, timezone)}` });
  if (matchCount > 0) chips.push({ kind: 'matches', label: matchCount === 1 ? '1 partie cherche des joueurs' : `${matchCount} parties cherchent des joueurs` });
  if (nextEventStart) {
    const days = Math.ceil((new Date(nextEventStart).getTime() - now.getTime()) / 86_400_000);
    chips.push({ kind: 'event', label: days <= 0 ? "Prochain event aujourd'hui" : `Prochain event J-${days}` });
  }
  return chips;
}

/** Sièges vides à dessiner sur une carte partie (capacité bornée à 6 pour l'affichage). */
export function matchSeats(m: { maxPlayers: number; players: unknown[] }): number {
  return Math.max(0, Math.min(6, m.maxPlayers) - m.players.length);
}

/** Libellé des places d'un tournoi — urgent (rouge) quand il reste ≤ 5 places. */
export function tournamentPlacesLabel(t: Tournament): { text: string; urgent: boolean } {
  if (t.maxTeams != null) {
    const left = t.maxTeams - t.confirmedCount;
    if (left <= 0) return { text: "Complet · liste d'attente possible", urgent: false };
    if (left <= 5) return { text: `Plus que ${left} place${left > 1 ? 's' : ''}`, urgent: true };
    return { text: `${left} places restantes`, urgent: false };
  }
  const n = t.confirmedCount;
  return { text: `${n} binôme${n > 1 ? 's' : ''} inscrit${n > 1 ? 's' : ''}`, urgent: false };
}
