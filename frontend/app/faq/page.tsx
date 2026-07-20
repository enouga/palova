import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { api } from '@/lib/api';
import { clubTitle, platformTitle } from '@/lib/seo';
import { ContentShell } from '@/components/content/ContentShell';
import { FaqView } from '@/components/content/FaqView';

export async function generateMetadata(): Promise<Metadata> {
  const slug = (await headers()).get('x-club-slug');
  if (!slug) return { title: platformTitle('FAQ') };
  try {
    const club = await api.getClub(slug);
    return { title: clubTitle('FAQ', club.name) };
  } catch {
    return { title: platformTitle('FAQ') };
  }
}

export default function FaqPage() {
  return (
    <ContentShell>
      <FaqView />
    </ContentShell>
  );
}
