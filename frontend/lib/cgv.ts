// Mémoire locale (par club) de l'acceptation des CGV, pour pré-cocher la case du
// paiement en ligne dans BookingModal. Ne remplace JAMAIS la trace légale par
// transaction (cgvAccepted: true envoyé au confirmReservation côté serveur) — c'est
// uniquement un confort d'UI pour les joueurs récurrents.
//
// Clé par club (slug) : accepter chez le club A ne pré-coche pas chez le club B.

const PREFIX = 'palova:cgv-accepted:';

/** Le joueur a-t-il déjà accepté les CGV de ce club ? (SSR-safe, sans slug → false) */
export function hasAcceptedCgv(slug?: string | null): boolean {
  if (!slug || typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(PREFIX + slug) === '1';
  } catch {
    return false; // localStorage indisponible (mode privé, quota) → on retombe sur « non accepté »
  }
}

/** Mémorise l'acceptation des CGV pour ce club (best-effort, sans slug → no-op). */
export function rememberCgvAccepted(slug?: string | null): void {
  if (!slug || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PREFIX + slug, '1');
  } catch {
    /* localStorage indisponible — best-effort, on ignore */
  }
}
