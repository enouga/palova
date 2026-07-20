/** Défense en profondeur pour les liens externes saisis par un club (annonce, sponsor…) et
 * rendus en `<a href>` : le backend valide déjà le schéma à l'écriture, mais un `linkUrl`
 * historique ou une réponse API inattendue ne doit jamais produire un `javascript:`/`data:`
 * exécutable au clic. */
export function isSafeHttpUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url, typeof window !== 'undefined' ? window.location.href : undefined);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
