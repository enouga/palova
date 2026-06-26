// Chemins accessibles sans être connecté (portes d'entrée de l'app + pages de
// contenu public : légales, FAQ, offres/tarifs — lisibles par tout visiteur).
export const PUBLIC_PATHS = [
  '/login', '/register', '/clubs/new', '/forgot-password',
  '/faq', '/cgv', '/mentions-legales', '/confidentialite', '/offres', '/tarifs',
];

/** true si le chemin est public (exact ou sous-chemin d'un PUBLIC_PATHS). */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

/** true si le chemin est accessible sans login sur l'HÔTE PLATEFORME (la racine `/` = vitrine
 * marketing, en plus des pages publiques communes). N'affecte PAS les sous-domaines club. */
export function isPlatformPublicPath(pathname: string): boolean {
  return pathname === '/' || isPublicPath(pathname);
}
