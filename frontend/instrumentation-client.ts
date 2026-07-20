// Point d'entrée client Next (exécuté au boot du bundle navigateur). Capture les crashs
// React et erreurs JS non gérées. No-op sans NEXT_PUBLIC_GLITCHTIP_DSN (dev).
import { initSentry } from '@/lib/observability';

initSentry(process.env.NEXT_PUBLIC_GLITCHTIP_DSN);
