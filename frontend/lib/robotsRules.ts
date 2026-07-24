import type { MetadataRoute } from 'next';

// Chemins de repli dupliqué entre clubs (gabarit Palova générique quand le club n'a rien
// personnalisé — cf. spec) : jamais indexés côté club, la copie plateforme reste canonique.
const FALLBACK_TEMPLATE_PATHS = ['/cgu', '/cgv', '/mentions-legales', '/confidentialite', '/offres', '/aide', '/faq'];

function clubRules(): NonNullable<MetadataRoute.Robots['rules']> {
  return [{
    userAgent: '*',
    allow: ['/', '/club', '/events', '/events/*', '/tournois/*', '/parties', '/register', '/clubs/new'],
    disallow: [
      '/reserver', '/cours', '/me', '/admin', '/superadmin', '/login', '/forgot-password',
      '/session-bridge', '/clubs',
      ...FALLBACK_TEMPLATE_PATHS,
    ],
  }];
}

function platformRules(): NonNullable<MetadataRoute.Robots['rules']> {
  return [{
    userAgent: '*',
    // `/decouvrir` a fusionné dans l'accueil `/` (il n'y redirige plus que par compatibilité) ;
    // `/archive` = copies figées des accueils d'avant la fusion, à ne jamais indexer.
    allow: ['/', '/tarifs', '/offres', '/faq', '/cgu', '/cgv', '/mentions-legales', '/confidentialite', '/register', '/clubs/new'],
    disallow: ['/login', '/forgot-password', '/clubs', '/me', '/admin', '/superadmin', '/session-bridge', '/tournois', '/decouvrir', '/aide', '/archive'],
  }];
}

/** Règles robots.txt pour l'hôte donné — pur, testable sans mocker next/headers. */
export function buildRobots(slug: string | null, host: string): MetadataRoute.Robots {
  return {
    rules: slug ? clubRules() : platformRules(),
    sitemap: `https://${host}/sitemap.xml`,
  };
}
