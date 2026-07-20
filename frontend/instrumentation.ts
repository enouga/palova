import * as Sentry from '@sentry/nextjs';
import { initSentry } from '@/lib/observability';

// Hook standard Next : capture les erreurs survenant pendant le rendu serveur / les
// route handlers. Named export reconnu automatiquement par Next.
export const onRequestError = Sentry.captureRequestError;

export function register() {
  // process.on n'existe que dans le runtime Node.js, pas dans l'Edge Runtime.
  // Next compile instrumentation.ts pour les deux → on garde l'API Node derrière ce test.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Capture serveur (SSR / handlers). No-op sans DSN.
    initSentry(process.env.NEXT_PUBLIC_GLITCHTIP_DSN);

    // Suppress EPIPE errors from broken streaming connections in Next.js 16 dev mode.
    // These occur when the browser closes a connection while the server is still streaming.
    process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EPIPE') return; // flux fermé côté client (streaming) — sans gravité
      // Toute AUTRE exception non capturée = état indéfini : la logguer et sortir proprement
      // (le gestionnaire de process / Docker redémarre) plutôt que de la laisser filer.
      console.error('[instrumentation] uncaughtException', err);
      process.exit(1);
    });
  }
}
