import type { Metadata } from 'next';
import { api } from '@/lib/api';
import { canonicalFor, clubOgImage, clubTitle } from '@/lib/seo';
import { GENDER_LABEL } from '@/lib/events';
import { formatDateShortTimeRange, heroPlacesLabel } from '@/lib/tournament';
import { TournamentDetailClient } from './TournamentDetailClient';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  try {
    const t = await api.getTournament(id);
    const title = clubTitle(t.name, t.club.name);
    const dateLabel = formatDateShortTimeRange(t.startTime, t.endTime, t.club.timezone);
    const places = heroPlacesLabel(t.confirmedCount, t.maxTeams);
    const description = [`${t.category} · ${GENDER_LABEL[t.gender]}`, dateLabel, places?.text, t.club.name].filter(Boolean).join(' · ');
    const image = clubOgImage(t.club.slug);
    return {
      title, description,
      alternates: { canonical: canonicalFor(t.club.slug, `/tournois/${id}`) },
      openGraph: { title, description, images: [{ url: image, width: 1200, height: 630 }] },
      twitter: { card: 'summary_large_image', title, description, images: [image] },
    };
  } catch {
    return { title: 'Tournoi · Palova' };
  }
}

export default async function TournamentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TournamentDetailClient id={id} />;
}
