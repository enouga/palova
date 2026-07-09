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
 *  ordre de l'API conservé (épinglées d'abord), plafond 6. */
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

/** Toutes les clés de sections. */
export const SECTION_KEYS: ClubHouseSectionKey[] = ['matches', 'agenda', 'top', 'offers', 'clubCard', 'sponsors'];

/** Libellés admin des sections réordonnables (l'ordre ici = ordre par défaut membre). */
export const SECTION_DEFS: { key: ClubHouseSectionKey; label: string; hint?: string }[] = [
  { key: 'matches', label: 'Ça joue bientôt', hint: 'Parties ouvertes qui cherchent des joueurs' },
  { key: 'agenda', label: 'Prochains events & vos réservations' },
  { key: 'top', label: 'Top du mois', hint: 'Podium des victoires du mois' },
  { key: 'offers', label: 'Offres du club', hint: 'Dépend aussi de « Vendre les offres en ligne » (Réglages)' },
  { key: 'clubCard', label: 'Le club', hint: 'Présentation et photos' },
];

/** La rivière partenaires : visibilité configurable, position fixe en bas de page. */
export const SPONSORS_DEF: { key: ClubHouseSectionKey; label: string; hint: string } =
  { key: 'sponsors', label: 'Partenaires', hint: 'Rivière de logos' };

const MEMBER_ORDER: ClubHouseSectionKey[] = ['matches', 'agenda', 'top', 'offers', 'clubCard'];
const VISITOR_ORDER: ClubHouseSectionKey[] = ['matches', 'clubCard', 'agenda', 'offers', 'top'];

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
