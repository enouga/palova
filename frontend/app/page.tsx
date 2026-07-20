import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { api } from '@/lib/api';
import { canonicalFor, clubOgImage, PLATFORM_OG_IMAGE } from '@/lib/seo';
import { HomeClient } from './HomeClient';

const PLATFORM_TITLE = 'Palova — Réservez votre terrain de padel en ligne';
const PLATFORM_DESCRIPTION = 'Réservez votre terrain de padel en quelques secondes, rejoignez des parties ouvertes et suivez vos tournois — sur Palova.';

export async function generateMetadata(): Promise<Metadata> {
  const slug = (await headers()).get('x-club-slug');
  if (!slug) {
    return {
      title: PLATFORM_TITLE,
      description: PLATFORM_DESCRIPTION,
      openGraph: { title: PLATFORM_TITLE, description: PLATFORM_DESCRIPTION, images: [{ url: PLATFORM_OG_IMAGE, width: 1200, height: 630 }] },
    };
  }
  try {
    const club = await api.getClub(slug);
    const title = `${club.name} — Réservez un terrain de padel`;
    const description = club.description?.trim() || `Réservez vos créneaux de padel en ligne au ${club.name}${club.city ? `, ${club.city}` : ''}.`;
    const image = clubOgImage(slug);
    return {
      title, description,
      alternates: { canonical: canonicalFor(slug, '/') },
      openGraph: { title, description, images: [{ url: image, width: 1200, height: 630 }] },
      twitter: { card: 'summary_large_image', title, description, images: [image] },
    };
  } catch {
    return { title: 'Palova' };
  }
}

export default function HomePage() {
  return <HomeClient />;
}
