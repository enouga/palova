import { CANONICAL_ROOT } from './roots';
import { API_BASE_URL } from './api';

/** Titre d'une page club : "{page} · {nom du club}". */
export function clubTitle(page: string, clubName: string): string {
  return `${page} · ${clubName}`;
}

/** Titre d'une page plateforme : "{page} | Palova". */
export function platformTitle(page: string): string {
  return `${page} | Palova`;
}

/**
 * URL canonique d'une page club — même règle que app/layout.tsx, mais autonome :
 * chaque page la calcule elle-même plutôt que de compter sur la fusion de
 * métadonnées Next parent/enfant.
 */
export function canonicalFor(slug: string | null, path: string): string | undefined {
  return slug ? `https://${slug}.${CANONICAL_ROOT}${path}` : undefined;
}

/** Image Open Graph de marque d'un club (logo + couleur, 1200×630, backend icon.service). */
export function clubOgImage(slug: string): string {
  return `${API_BASE_URL}/api/clubs/${slug}/icon/og.png`;
}

/** Image Open Graph par défaut de la plateforme (asset statique, aucun contexte club). */
export const PLATFORM_OG_IMAGE = '/og-default.png';
