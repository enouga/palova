import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { api, API_BASE_URL } from '@/lib/api';
import { rangeLabel } from '@/lib/levelMatch';
import { OpenMatchDetail } from '@/components/openmatch/OpenMatchDetail';

const API_URL = API_BASE_URL;

// Métadonnées Open Graph : aperçu riche du lien partagé (WhatsApp/SMS). Fetch anonyme
// (crawler) ; tout échec → repli neutre, jamais d'exception (pas de page 500 pour un aperçu).
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const slug = (await headers()).get('x-club-slug');
  if (!slug) return { title: 'Partie ouverte · Palova', robots: { index: false, follow: true } };
  try {
    const [club, match] = await Promise.all([api.getClub(slug), api.getOpenMatch(slug, id)]);
    const when = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: club.timezone }).format(new Date(match.startTime));
    const places = match.full ? 'Complet' : `${match.spotsLeft} place${match.spotsLeft > 1 ? 's' : ''}`;
    const level = (match.targetLevelMin != null || match.targetLevelMax != null) ? rangeLabel(match.targetLevelMin ?? null, match.targetLevelMax ?? null) : null;
    const title = `Partie ouverte · ${match.resourceName}`;
    const description = [when, places, level, club.name].filter(Boolean).join(' · ');
    // Carte OG dynamique 1200×630 (état réel du match), versionnée par ?v=<cardVersion>
    // pour que les crawlers (qui cachent par URL) re-crawlent à chaque nouvel état.
    const image = `${API_URL}/api/clubs/${slug}/open-matches/${id}/card.png${match.cardVersion ? `?v=${match.cardVersion}` : ''}`;
    return {
      title,
      description,
      // Contenu éphémère (créneau daté) : aucune valeur de référencement durable, mais on
      // reste crawlable (pas de robots.txt disallow) pour que l'unfurling social continue
      // de marcher — cf. spec.
      robots: { index: false, follow: true },
      openGraph: { title, description, images: [{ url: image, width: 1200, height: 630 }], type: 'website' },
      twitter: { card: 'summary_large_image', title, description, images: [image] },
    };
  } catch {
    return { title: 'Partie ouverte · Palova', robots: { index: false, follow: true } };
  }
}

export default async function OpenMatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OpenMatchDetail matchId={id} />;
}
