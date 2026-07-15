// Indirections minimales autour de `window.location`, isolées pour la testabilité
// (jsdom verrouille `window.location` — impossible à espionner directement en test).

/** Navigation plein-écran (change d'origine/sous-domaine). Remplace `window.location.assign`. */
export function hardNavigate(url: string): void {
  window.location.assign(url);
}

/** Remplace l'entrée d'historique courante par `url` (le fragment n'y reste pas). */
export function hardReplace(url: string): void {
  window.location.replace(url);
}

/** Hôte courant (`window.location.host`), '' côté serveur. */
export function currentHost(): string {
  return typeof window !== 'undefined' ? window.location.host : '';
}
