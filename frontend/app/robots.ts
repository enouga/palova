import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { clubSlugFromHost } from '@/lib/host';
import { ROOT_DOMAINS } from '@/lib/roots';
import { buildRobots } from '@/lib/robotsRules';

// robots.txt par hôte (club vs plateforme). Le proxy ne réécrit pas ce chemin (extension
// .txt exclue de son matcher, comme app/manifest.ts) : le slug se résout depuis Host.
export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = (await headers()).get('host') || '';
  const slug = clubSlugFromHost(host, ROOT_DOMAINS);
  return buildRobots(slug, host);
}
