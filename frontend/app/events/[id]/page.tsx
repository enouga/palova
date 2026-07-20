import type { Metadata } from 'next';
import { api } from '@/lib/api';
import { canonicalFor, clubOgImage, clubTitle } from '@/lib/seo';
import { KIND_LABEL } from '@/lib/events';
import { formatDateShortTimeRange, heroPlacesLabel } from '@/lib/tournament';
import { EventDetailClient } from './EventDetailClient';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  try {
    const event = await api.getEvent(id);
    const title = clubTitle(event.name, event.club.name);
    const dateLabel = formatDateShortTimeRange(event.startTime, event.endTime, event.club.timezone);
    const places = heroPlacesLabel(event.confirmedCount, event.capacity);
    const description = [KIND_LABEL[event.kind], dateLabel, places?.text, event.club.name].filter(Boolean).join(' · ');
    const image = clubOgImage(event.club.slug);
    return {
      title, description,
      alternates: { canonical: canonicalFor(event.club.slug, `/events/${id}`) },
      openGraph: { title, description, images: [{ url: image, width: 1200, height: 630 }] },
      twitter: { card: 'summary_large_image', title, description, images: [image] },
    };
  } catch {
    return { title: 'Event · Palova' };
  }
}

export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EventDetailClient id={id} />;
}
