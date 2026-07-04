'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ConversationSummary } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { useAuth } from '@/lib/useAuth';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { useClub } from '@/lib/ClubProvider';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';
import { MessageThread } from './MessageThread';

// Hôte GLOBAL du widget de conversation (monté une fois dans le layout racine).
// Écoute l'event window `palova:open-dm` ({ detail: { userId } }) émis par openDm() :
// desktop → widget ancré bas-droite (pattern OpenMatchChatSheet, la page reste cliquable) ;
// mobile → navigation vers /me/messages?with=. Rien n'est rendu hors connexion.
// L'id du viewer est résolu via getMyProfile AU PREMIER open seulement (mémorisé) —
// pas d'appel systématique au montage : le host est sur toutes les pages.
export function DmWidgetHost() {
  const { th } = useTheme();
  const router = useRouter();
  const { token, ready } = useAuth();
  const { slug } = useClub();
  const isDesktop = useIsDesktop();
  const [conv, setConv] = useState<ConversationSummary | null>(null);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const viewerAsked = useRef(false);

  useEffect(() => {
    if (!ready || !token) return;
    const onOpen = (e: Event) => {
      const userId = (e as CustomEvent<{ userId?: string }>).detail?.userId;
      if (!userId) return;
      if (!isDesktop) { router.push(`/me/messages?with=${userId}`); return; }
      if (!viewerAsked.current) {
        viewerAsked.current = true;
        api.getMyProfile(token).then((p) => setViewerId(p.id)).catch(() => { viewerAsked.current = false; });
      }
      api.openConversation(userId, token, slug ?? null).then(setConv).catch(() => {});
    };
    window.addEventListener('palova:open-dm', onOpen);
    return () => window.removeEventListener('palova:open-dm', onOpen);
  }, [ready, token, isDesktop, router, slug]);

  if (!ready || !token || !conv || !viewerId || !isDesktop) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'flex-end',
      justifyContent: 'flex-end', padding: 24, pointerEvents: 'none' }}>
      <div style={{ background: th.bg, display: 'flex', flexDirection: 'column', pointerEvents: 'auto',
        // minWidth:0 — item d'un flex row : sans lui, min-width:auto laisse le min-content
        // du composer gonfler le panneau au-delà des 380px voulus.
        width: 'min(380px, 92vw)', minWidth: 0, height: 'min(520px, 80vh)', borderRadius: 20,
        boxShadow: '0 24px 64px rgba(0,0,0,0.35)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: `1px solid ${th.line}` }}>
          <Avatar firstName={conv.other.firstName} lastName={conv.other.lastName} avatarUrl={conv.other.avatarUrl}
            size={28} color={colorForSeed(conv.other.userId)} />
          <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 14.5, color: th.text, flex: 1 }}>
            {conv.other.firstName} {conv.other.lastName}
          </span>
          <button type="button" aria-label="Ouvrir la messagerie" title="Ouvrir la messagerie"
            onClick={() => { setConv(null); router.push(`/me/messages?with=${conv.other.userId}`); }}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textMute, fontSize: 15 }}>⤢</button>
          <button type="button" aria-label="Fermer" onClick={() => setConv(null)}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textMute, fontSize: 20 }}>×</button>
        </div>
        <MessageThread conversationId={conv.id} token={token} viewerUserId={viewerId} other={conv.other} />
      </div>
    </div>
  );
}
