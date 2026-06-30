'use client';
import { useSearchParams } from 'next/navigation';
import { useTheme } from '@/lib/ThemeProvider';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { Screen } from '@/components/ui/Screen';
import { ClubNav } from '@/components/ClubNav';
import { FriendsHub } from '@/components/social/FriendsHub';

// Hub social du joueur (amis / je suis / me suivent). Disponible sur un hôte club
// (le suivi est défini club-scoped). Shell calqué sur /me/profile.
export default function FriendsPage() {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { slug, club } = useClub();

  const tabParam = useSearchParams().get('tab');
  const initialTab = tabParam === 'followers' ? 'followers' : tabParam === 'following' ? 'following' : 'amis';

  if (!ready) return null;
  if (!token || !slug || !club) return null; // hub disponible sur un hôte club, connecté

  return (
    <Screen>
      <div style={{ paddingBottom: 48 }}>
        <ClubNav club={club} />

        <div style={{ padding: '18px 20px 0', fontFamily: th.fontDisplay, fontWeight: 500, fontSize: 38, lineHeight: 1.05, color: th.text, letterSpacing: -0.5 }}>
          Mes amis
        </div>

        <div style={{ padding: '18px 20px 0' }}>
          <FriendsHub slug={slug} token={token} initialTab={initialTab} />
        </div>
      </div>
    </Screen>
  );
}
