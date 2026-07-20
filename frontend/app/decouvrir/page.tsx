import type { Metadata } from 'next';
import { PLATFORM_OG_IMAGE } from '@/lib/seo';
import { DiscoverClient } from './DiscoverClient';

const TITLE = 'Trouvez un club de padel près de chez vous | Palova';
const DESCRIPTION = 'Parties ouvertes, tournois et clubs de padel partout en France — cherchez par ville, département ou autour de vous.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, images: [{ url: PLATFORM_OG_IMAGE, width: 1200, height: 630 }] },
};

export default function DecouvrirPage() {
  return <DiscoverClient />;
}
