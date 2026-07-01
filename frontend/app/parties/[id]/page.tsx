import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { api } from '@/lib/api';
import { rangeLabel } from '@/lib/levelMatch';
import { OpenMatchDetail } from '@/components/openmatch/OpenMatchDetail';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// Métadonnées Open Graph : aperçu riche du lien partagé (WhatsApp/SMS). Fetch anonyme
// (crawler) ; tout échec → repli neutre, jamais d'exception (pas de page 500 pour un aperçu).
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const slug = (await headers()).get('x-club-slug');
  if (!slug) return { title: 'Partie ouverte · Palova' };
  try {
    const [club, match] = await Promise.all([api.getClub(slug), api.getOpenMatch(slug, id)]);
    const when = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: club.timezone }).format(new Date(match.startTime));
    const places = match.full ? 'Complet' : `${match.spotsLeft} place${match.spotsLeft > 1 ? 's' : ''}`;
    const level = (match.targetLevelMin != null || match.targetLevelMax != null) ? rangeLabel(match.targetLevelMin ?? null, match.targetLevelMax ?? null) : null;
    const title = `Partie ouverte · ${match.resourceName}`;
    const description = [when, places, level, club.name].filter(Boolean).join(' · ');
    const image = `${API_URL}/api/clubs/${slug}/icon/512.png`;
    return {
      title,
      description,
      openGraph: { title, description, images: [image], type: 'website' },
      twitter: { card: 'summary', title, description, images: [image] },
    };
  } catch {
    return { title: 'Partie ouverte · Palova' };
  }
}

export default async function OpenMatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OpenMatchDetail matchId={id} />;
}
