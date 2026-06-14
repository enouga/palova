// Source de vérité des domaines racines de la plateforme (multi-domaines).
// Ex. prod : "palova.fr,palova.app" — la 1re entrée est la racine CANONIQUE
// (liens emails, repli SSR, canonical SEO). En dev : repli sur "localhost".
//
// NEXT_PUBLIC_ROOT_DOMAINS est inliné au build par Next ; repli rétro-compat sur
// l'ancienne variable singulière NEXT_PUBLIC_ROOT_DOMAIN.
export const ROOT_DOMAINS: string[] = (process.env.NEXT_PUBLIC_ROOT_DOMAINS || '')
  .split(',')
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

if (ROOT_DOMAINS.length === 0) {
  ROOT_DOMAINS.push((process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'localhost').toLowerCase());
}

/** Racine canonique (1re de la liste) : emails, repli SSR, canonical SEO. */
export const CANONICAL_ROOT = ROOT_DOMAINS[0];

/** Racine de la liste qui matche l'hôte donné (apex ou sous-domaine), sinon null. */
export function rootForHost(host: string): string | null {
  const h = host.split(':')[0].toLowerCase();
  for (const root of ROOT_DOMAINS) {
    if (h === root || h.endsWith(`.${root}`)) return root;
  }
  return null;
}
