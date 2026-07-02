import type { OpenMatch } from '@/lib/api';
import { rangeLabel } from '@/lib/levelMatch';

// Partage d'une partie ouverte : URL versionnée par l'état + texte enrichi.
// L'URL porte ?s=<cardVersion> pour que WhatsApp (qui fige l'aperçu PAR URL) re-crawle
// à chaque partage d'un nouvel état — les vieux messages gardent l'aperçu de l'époque.

/** URL à partager pour une partie (page /parties/[id], versionnée par l'état). */
export function matchShareUrl(origin: string, match: Pick<OpenMatch, 'id' | 'cardVersion'>): string {
  const v = match.cardVersion ? `?s=${match.cardVersion}` : '';
  return `${origin}/parties/${match.id}${v}`;
}

/** Texte de partage (canaux sans aperçu riche : SMS…) : date · places · niveau · club. */
export function matchShareText(match: OpenMatch, clubName: string | null, timezone: string): string {
  const when = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: timezone,
  }).format(new Date(match.startTime));
  const places = match.full ? 'Complet' : `${match.spotsLeft} place${match.spotsLeft > 1 ? 's' : ''}`;
  const level = (match.targetLevelMin != null || match.targetLevelMax != null)
    ? rangeLabel(match.targetLevelMin ?? null, match.targetLevelMax ?? null)
    : null;
  return [when, places, level, clubName].filter(Boolean).join(' · ');
}
