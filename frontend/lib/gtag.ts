// Effets de bord Google Analytics 4 (chargement + pages vues). Séparé de lib/consent.ts
// (logique pure) pour rester mockable. GA n'est appelé qu'APRÈS consentement accordé.

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

/** ID de mesure GA4 (G-XXXX), injecté au build via NEXT_PUBLIC_GA_ID. Vide → GA désactivé. */
export function gaId(): string {
  return process.env.NEXT_PUBLIC_GA_ID || '';
}

/** Injecte gtag.js et configure GA4 en « mesure d'audience seule » (pas de pub, IP anonymisée,
 *  pas de page_view auto — on les émet nous-mêmes à chaque navigation SPA). Idempotent. */
export function loadGtag(id: string): void {
  if (typeof window === 'undefined') return;
  if (document.getElementById('ga-gtag')) return; // déjà chargé

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    // gtag pousse ses arguments bruts dans dataLayer (contrat Google).
    window.dataLayer!.push(arguments);
  };
  window.gtag('js', new Date());
  window.gtag('config', id, {
    anonymize_ip: true,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    send_page_view: false,
  });

  const s = document.createElement('script');
  s.id = 'ga-gtag';
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(s);
}

/** Émet une page vue GA4 pour le chemin donné (navigation cliente App Router). */
export function pageview(path: string): void {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;
  window.gtag('event', 'page_view', { page_path: path });
}
