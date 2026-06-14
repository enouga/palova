import { rootForHost, CANONICAL_ROOT } from './roots';

// Côté client : racine du domaine effectivement visité (l'utilisateur reste sur
// palova.fr OU palova.app selon son entrée). Côté serveur (SSR) : racine canonique.
function currentRoot(): string {
  if (typeof window !== 'undefined') {
    return rootForHost(window.location.host) || CANONICAL_ROOT;
  }
  return CANONICAL_ROOT;
}

/** URL absolue de l'app d'un club (sous-domaine). En SSR, repli https:// + racine canonique. */
export function clubUrl(slug: string, path = '/'): string {
  const root = currentRoot();
  const p = path.startsWith('/') ? path : `/${path}`;
  if (typeof window !== 'undefined') {
    const port = window.location.port ? `:${window.location.port}` : '';
    return `${window.location.protocol}//${slug}.${root}${port}${p}`;
  }
  return `https://${slug}.${root}${p}`;
}

/** URL absolue de la plateforme (domaine racine, sans sous-domaine club). En SSR, repli https://. */
export function platformUrl(path = '/'): string {
  const root = currentRoot();
  const p = path.startsWith('/') ? path : `/${path}`;
  if (typeof window !== 'undefined') {
    const port = window.location.port ? `:${window.location.port}` : '';
    return `${window.location.protocol}//${root}${port}${p}`;
  }
  return `https://${root}${p}`;
}
