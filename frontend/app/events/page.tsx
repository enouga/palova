import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { api } from '@/lib/api';
import { canonicalFor, clubOgImage, clubTitle } from '@/lib/seo';
import { EventsClient } from './EventsClient';

export async function generateMetadata(): Promise<Metadata> {
  const slug = (await headers()).get('x-club-slug');
  if (!slug) return { title: clubTitle('Tournois & animations', 'Palova') };
  try {
    const club = await api.getClub(slug);
    const title = clubTitle('Tournois & animations', club.name);
    const description = `Découvrez les tournois et animations à venir au ${club.name}.`;
    const image = clubOgImage(slug);
    return {
      title, description,
      alternates: { canonical: canonicalFor(slug, '/events') },
      openGraph: { title, description, images: [{ url: image, width: 1200, height: 630 }] },
      twitter: { card: 'summary_large_image', title, description, images: [image] },
    };
  } catch {
    return { title: clubTitle('Tournois & animations', 'Palova') };
  }
}

export default function EventsPage() {
  return <EventsClient />;
}
