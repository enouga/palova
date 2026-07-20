import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { api } from '@/lib/api';
import { canonicalFor, clubOgImage, clubTitle } from '@/lib/seo';
import { ClubPresentationClient } from './ClubPresentationClient';

export async function generateMetadata(): Promise<Metadata> {
  const slug = (await headers()).get('x-club-slug');
  if (!slug) return { title: clubTitle('Le club', 'Palova') };
  try {
    const [club, pres] = await Promise.all([api.getClub(slug), api.getClubPresentation(slug)]);
    const title = clubTitle('Le club', club.name);
    const description = pres.presentationText?.trim().slice(0, 155)
      || club.description?.trim()
      || `Découvrez ${club.name}${club.city ? `, à ${club.city}` : ''}.`;
    const image = clubOgImage(slug);
    return {
      title, description,
      alternates: { canonical: canonicalFor(slug, '/club') },
      openGraph: { title, description, images: [{ url: image, width: 1200, height: 630 }] },
      twitter: { card: 'summary_large_image', title, description, images: [image] },
    };
  } catch {
    return { title: clubTitle('Le club', 'Palova') };
  }
}

export default function ClubPage() {
  return <ClubPresentationClient />;
}
