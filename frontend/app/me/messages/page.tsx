'use client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { Screen } from '@/components/ui/Screen';
import { ClubNav } from '@/components/ClubNav';
import { MessagesHub } from '@/components/messages/MessagesHub';

// Messagerie privée du joueur. Disponible sur un hôte club (comme /me/friends).
// ?with=<userId> = deeplink d'ouverture/création d'une conversation.
export default function MessagesPage() {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { slug, club } = useClub();
  const sp = useSearchParams();
  const initialWith = sp.get('with');
  const initialDraft = sp.get('draft');

  // useAuth n'expose pas l'id du viewer → résolu via le profil (pattern OpenMatches).
  const [viewerUserId, setViewerUserId] = useState<string | null>(null);
  useEffect(() => {
    if (!token) return;
    api.getMyProfile(token).then((p) => setViewerUserId(p.id)).catch(() => {});
  }, [token]);

  if (!ready) return null;
  if (!token || !slug || !club) return null; // messagerie disponible sur un hôte club, connecté

  return (
    <Screen>
      <div style={{ paddingBottom: 48 }}>
        <ClubNav club={club} />

        <div style={{ padding: '18px 20px 0', fontFamily: th.fontDisplay, fontWeight: 500, fontSize: 38, lineHeight: 1.05, color: th.text, letterSpacing: -0.5 }}>
          Messages
        </div>

        <div style={{ padding: '18px 20px 0' }}>
          {viewerUserId && (
            <MessagesHub token={token} viewerUserId={viewerUserId} clubSlug={slug} initialWith={initialWith} initialDraft={initialDraft} />
          )}
        </div>
      </div>
    </Screen>
  );
}
