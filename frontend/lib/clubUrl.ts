/** URL absolue de l'app d'un club (sous-domaine). En SSR, repli https://. */
export function clubUrl(slug: string, path = '/'): string {
  const root = process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'localhost';
  const p = path.startsWith('/') ? path : `/${path}`;
  if (typeof window !== 'undefined') {
    const port = window.location.port ? `:${window.location.port}` : '';
    return `${window.location.protocol}//${slug}.${root}${port}${p}`;
  }
  return `https://${slug}.${root}${p}`;
}
