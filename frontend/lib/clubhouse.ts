import { Announcement, ClubAvailability, ClubHouseSectionKey, ClubHouseSectionSetting, Sponsor, TimeSlot, Tournament } from '@/lib/api';

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

// --- Sections configurables du Club-house (miroir écriture : backend normalizeClubHouseSections) ---

/** Toutes les clés de sections. */
export const SECTION_KEYS: ClubHouseSectionKey[] = ['matches', 'agenda', 'posters', 'top', 'offers', 'clubCard', 'announcements', 'sponsors'];

/** Libellés admin des sections réordonnables (l'ordre ici = ordre par défaut membre). */
export const SECTION_DEFS: { key: ClubHouseSectionKey; label: string; hint?: string }[] = [
  { key: 'matches', label: 'Ça joue bientôt', hint: 'Parties ouvertes qui cherchent des joueurs' },
  { key: 'agenda', label: 'Prochains events & vos réservations' },
  { key: 'posters', label: 'À l’affiche', hint: 'Annonces avec image (mosaïque)' },
  { key: 'top', label: 'Top du mois', hint: 'Podium des victoires du mois' },
  { key: 'offers', label: 'Offres du club', hint: 'Dépend aussi de « Vendre les offres en ligne » (Réglages)' },
  { key: 'clubCard', label: 'Le club', hint: 'Présentation et photos' },
  { key: 'announcements', label: 'Annonces', hint: 'Annonces sans image (liste)' },
];

/** La rivière partenaires : visibilité configurable, position fixe en bas de page. */
export const SPONSORS_DEF: { key: ClubHouseSectionKey; label: string; hint: string } =
  { key: 'sponsors', label: 'Partenaires', hint: 'Rivière de logos' };

const MEMBER_ORDER: ClubHouseSectionKey[] = ['matches', 'agenda', 'posters', 'top', 'offers', 'clubCard', 'announcements'];
const VISITOR_ORDER: ClubHouseSectionKey[] = ['matches', 'clubCard', 'agenda', 'posters', 'offers', 'top', 'announcements'];

/** Ordre + visibilité effectifs. config null → ordre adaptatif historique (visiteur/membre) ;
 *  sinon la config s'applique à tous. Clé inconnue ignorée, clé connue absente ajoutée en
 *  fin visible (une section livrée après la sauvegarde de la config s'affiche quand même). */
export function resolveSections(
  config: ClubHouseSectionSetting[] | null | undefined,
  isMember: boolean,
): { order: ClubHouseSectionKey[]; sponsorsVisible: boolean } {
  if (!Array.isArray(config) || config.length === 0) {
    return { order: isMember ? MEMBER_ORDER : VISITOR_ORDER, sponsorsVisible: true };
  }
  const seen = new Set<string>();
  const order: ClubHouseSectionKey[] = [];
  let sponsorsVisible = true;
  for (const e of config) {
    const key = e?.key as ClubHouseSectionKey | undefined;
    if (!key || seen.has(key) || !SECTION_KEYS.includes(key)) continue;
    seen.add(key);
    if (key === 'sponsors') { sponsorsVisible = e.visible !== false; continue; }
    if (e.visible !== false) order.push(key);
  }
  for (const key of SECTION_KEYS) {
    if (key !== 'sponsors' && !seen.has(key)) order.push(key);
  }
  return { order, sponsorsVisible };
}

/** Clés masquées par la config (sert à sauter les fetchs inutiles). null → rien de masqué. */
export function hiddenSectionKeys(config: ClubHouseSectionSetting[] | null | undefined): Set<ClubHouseSectionKey> {
  const { order, sponsorsVisible } = resolveSections(config, true); // la visibilité ne dépend pas de l'audience
  const hidden = new Set<ClubHouseSectionKey>();
  for (const key of SECTION_KEYS) {
    if (key === 'sponsors') { if (!sponsorsVisible) hidden.add(key); }
    else if (!order.includes(key)) hidden.add(key);
  }
  return hidden;
}

/** Liste complète (8 entrées) pour l'éditeur admin : config complétée ; null → défaut membre + sponsors en fin. */
export function fullSectionSettings(config: ClubHouseSectionSetting[] | null | undefined): ClubHouseSectionSetting[] {
  if (!Array.isArray(config) || config.length === 0) {
    return [...MEMBER_ORDER, 'sponsors' as ClubHouseSectionKey].map((key) => ({ key, visible: true }));
  }
  const seen = new Set<string>();
  const out: ClubHouseSectionSetting[] = [];
  for (const e of config) {
    const key = e?.key as ClubHouseSectionKey | undefined;
    if (!key || seen.has(key) || !SECTION_KEYS.includes(key)) continue;
    seen.add(key);
    out.push({ key, visible: e.visible !== false });
  }
  for (const key of SECTION_KEYS) if (!seen.has(key)) out.push({ key, visible: true });
  return out;
}
