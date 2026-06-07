// Chemins accessibles sans être connecté (portes d'entrée de l'app).
export const PUBLIC_PATHS = ['/login', '/register', '/clubs/new'];

/** true si le chemin est public (exact ou sous-chemin d'un PUBLIC_PATHS). */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
}
