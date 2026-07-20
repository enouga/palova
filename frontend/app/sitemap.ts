import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { api } from '@/lib/api';
import { clubSlugFromHost } from '@/lib/host';
import { ROOT_DOMAINS } from '@/lib/roots';
import { clubStaticEntries, clubDynamicEntries, platformEntries } from '@/lib/sitemapEntries';

// sitemap.xml par hôte (même résolution que app/robots.ts et app/manifest.ts). Toute erreur
// de fetch (club suspendu/introuvable, API indisponible) → repli sur les pages statiques
// seules, jamais d'exception (comportement défensif, comme le manifest et les icônes).
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const host = (await headers()).get('host') || '';
  const slug = clubSlugFromHost(host, ROOT_DOMAINS);
  if (!slug) return platformEntries(host);
  try {
    const [tournaments, events] = await Promise.all([api.getClubTournaments(slug), api.getClubEvents(slug)]);
    return [...clubStaticEntries(host), ...clubDynamicEntries(host, tournaments, events)];
  } catch {
    return clubStaticEntries(host);
  }
}
