import { Announcement, ClubHouseSectionKey, ClubHouseSectionSetting, Sponsor, Tournament } from '@/lib/api';

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

/** Annonce expirée (masquée partout, dont le kiosque). */
export function announcementExpired(a: Pick<Announcement, 'validUntil'>, now: Date): boolean {
  return !!a.validUntil && new Date(a.validUntil) <= now;
}

/** Diapos du kiosque « À la une » : toutes les annonces actives (avec ou sans image),
 *  ordre de l'API conservé (= l'ordre manuel choisi par l'admin), plafond 6. */
export function kiosqueSlides(anns: Announcement[], now: Date): Announcement[] {
  return anns.filter((a) => !announcementExpired(a, now)).slice(0, 6);
}

/** L'offre d'un partenaire est-elle affichable ? Texte présent et date de fin non dépassée. */
export function offerIsActive(s: Pick<Sponsor, 'offerText' | 'offerUntil'>, now: Date): boolean {
  if (!s.offerText) return false;
  return s.offerUntil == null || new Date(s.offerUntil) > now;
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

/** Toutes les clés de sections. `kiosk` = le kiosque « À la une » (les annonces). */
export const SECTION_KEYS: ClubHouseSectionKey[] = ['kiosk', 'matches', 'agenda', 'top', 'offers', 'clubCard', 'sponsors'];

/** Libellés admin des sections réordonnables (l'ordre ici = ordre par défaut membre). */
export const SECTION_DEFS: { key: ClubHouseSectionKey; label: string; hint?: string }[] = [
  { key: 'kiosk', label: 'À la une', hint: 'Vos annonces (kiosque) · défilement réglable' },
  { key: 'matches', label: 'Ça joue bientôt', hint: 'Parties ouvertes qui cherchent des joueurs' },
  { key: 'agenda', label: 'Prochains events & vos réservations' },
  { key: 'top', label: 'Top du mois', hint: 'Podium des victoires du mois' },
  { key: 'offers', label: 'Offres du club', hint: 'Dépend aussi de « Vendre les offres en ligne » (Réglages)' },
  { key: 'clubCard', label: 'Le club', hint: 'Présentation et photos' },
  { key: 'sponsors', label: 'Partenaires', hint: 'Rivière de logos' },
];

const MEMBER_ORDER: ClubHouseSectionKey[] = ['kiosk', 'matches', 'agenda', 'top', 'offers', 'clubCard', 'sponsors'];
const VISITOR_ORDER: ClubHouseSectionKey[] = ['kiosk', 'matches', 'clubCard', 'agenda', 'offers', 'top', 'sponsors'];

/** Ordre + visibilité effectifs. config null → ordre adaptatif historique (visiteur/membre) ;
 *  sinon la config s'applique à tous. Clé inconnue ignorée, clé connue absente ajoutée en
 *  fin visible (une section livrée après la sauvegarde de la config s'affiche quand même) —
 *  SAUF `kiosk`, ajouté EN TÊTE quand il manque (config antérieure à la clé : le kiosque
 *  restait en haut). Miroir : backend normalizeClubHouseSections. */
export function resolveSections(
  config: ClubHouseSectionSetting[] | null | undefined,
  isMember: boolean,
): { order: ClubHouseSectionKey[] } {
  if (!Array.isArray(config) || config.length === 0) {
    return { order: isMember ? MEMBER_ORDER : VISITOR_ORDER };
  }
  const seen = new Set<string>();
  const order: ClubHouseSectionKey[] = [];
  for (const e of config) {
    const key = e?.key as ClubHouseSectionKey | undefined;
    if (!key || seen.has(key) || !SECTION_KEYS.includes(key)) continue;
    seen.add(key);
    if (e.visible !== false) order.push(key);
  }
  // Kiosque absent de la config → en tête (et visible) ; s'il y figure, sa position/visibilité gagnent.
  if (!seen.has('kiosk')) { seen.add('kiosk'); order.unshift('kiosk'); }
  for (const key of SECTION_KEYS) {
    if (!seen.has(key)) order.push(key);
  }
  return { order };
}

/** Clés masquées par la config (sert à sauter les fetchs inutiles). null → rien de masqué. */
export function hiddenSectionKeys(config: ClubHouseSectionSetting[] | null | undefined): Set<ClubHouseSectionKey> {
  const { order } = resolveSections(config, true); // la visibilité ne dépend pas de l'audience
  const hidden = new Set<ClubHouseSectionKey>();
  for (const key of SECTION_KEYS) if (!order.includes(key)) hidden.add(key);
  return hidden;
}

/** Liste complète (7 entrées) pour l'éditeur admin : config complétée ; null → défaut membre. */
export function fullSectionSettings(config: ClubHouseSectionSetting[] | null | undefined): ClubHouseSectionSetting[] {
  if (!Array.isArray(config) || config.length === 0) {
    return MEMBER_ORDER.map((key) => ({ key, visible: true }));
  }
  const seen = new Set<string>();
  const out: ClubHouseSectionSetting[] = [];
  for (const e of config) {
    const key = e?.key as ClubHouseSectionKey | undefined;
    if (!key || seen.has(key) || !SECTION_KEYS.includes(key)) continue;
    seen.add(key);
    out.push({ key, visible: e.visible !== false });
  }
  // Kiosque absent de la config → en tête, visible (miroir de resolveSections / backend).
  if (!seen.has('kiosk')) { seen.add('kiosk'); out.unshift({ key: 'kiosk', visible: true }); }
  for (const key of SECTION_KEYS) if (!seen.has(key)) out.push({ key, visible: true });
  return out;
}
