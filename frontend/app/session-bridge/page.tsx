'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { setSession, sessionCookieIsHostOnly } from '@/lib/session';
import { safeNext } from '@/lib/postAuth';
import { hardReplace, currentHost } from '@/lib/nav';

// Pont de session — écran transitoire de redirection.
//
// Contourne l'impossibilité (Chrome) de partager le cookie de session entre sous-domaines
// `*.localhost` en DÉVELOPPEMENT : la redirection plateforme→admin du club (finishAuth) arrive
// ici avec le token dans le FRAGMENT (`#`, jamais envoyé au serveur). On repose le cookie côté
// sous-domaine club, puis on file en navigation plein-écran vers la destination (le proxy voit
// alors le cookie fraîchement posé).
//
// ⚠️ N'agit QUE sur un hôte à cookie host-only (localhost). En prod (`.palova.fr`) le cookie
// couvre déjà `*.palova.fr` → le pont n'est jamais utilisé, et un accès direct est neutralisé
// (on ignore le fragment) — pas de vecteur de fixation de session.
export default function SessionBridge() {
  const router = useRouter();
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!sessionCookieIsHostOnly(currentHost())) { router.replace('/'); return; }
    const p = new URLSearchParams(window.location.hash.slice(1));
    const token = p.get('token');
    const to = safeNext(p.get('to') || undefined) || '/admin';
    if (!token) { router.replace('/login'); return; }
    setSession(token, p.get('clubId') || null);
    hardReplace(to); // navigation plein-écran → le proxy voit le cookie qu'on vient de poser
  }, [router]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif', color: '#888', fontSize: 14 }}>
      Connexion…
    </div>
  );
}
