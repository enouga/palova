'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api, MyMatch } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { Screen } from '@/components/ui/Screen';
import { BackButton, ThemeToggle } from '@/components/ui/atoms';
import { ProfileMenu } from '@/components/ProfileMenu';
import { ClubNav } from '@/components/ClubNav';
import { MyMatchesList } from '@/components/match/MyMatchesList';

// Page joueur dédiée « Mes matchs à confirmer » : liste les matchs où je dois confirmer ou
// contester un résultat (et l'historique). Cible des notifications match.pending_confirmation /
// match.comment et accessible depuis le menu profil. Réutilise MyMatchesList (déjà utilisé en
// onglet dans /me/reservations).
export default function MyMatchesPage() {
  const router = useRouter();
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { slug, club } = useClub();
  // Sur un hôte club, le système de niveau peut être désactivé : il n'y a alors pas de matchs.
  // (club non chargé / hôte plateforme → on n'empêche rien, comme partout ailleurs dans l'app.)
  const levelEnabled = club?.levelSystemEnabled !== false;
  const [matches, setMatches] = useState<MyMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (ready && !token) router.replace('/login'); }, [ready, token, router]);

  // Club sans niveau (ex. arrivée via un vieux lien de notif) : pas de page orpheline,
  // on rebascule vers la page réservations comme l'onglet « Matchs » indisponible le fait.
  useEffect(() => { if (slug && club && !levelEnabled) router.replace('/me/reservations'); }, [slug, club, levelEnabled, router]);

  const load = useCallback(async (t: string) => {
    setLoading(true);
    try {
      setError(null);
      setMatches(await api.getMyMatches(t));
    }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (token) load(token); }, [token, load]);

  return (
    <Screen>
      <div style={{ paddingBottom: 40 }}>
        {slug && club ? (
          <ClubNav club={club} />
        ) : (
          <div style={{ padding: '28px 20px 6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <BackButton href="/clubs" />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <ThemeToggle />
                <ProfileMenu />
              </div>
            </div>
          </div>
        )}
        <div style={{ padding: '18px 20px 0', fontFamily: th.fontDisplay, fontWeight: 500, fontSize: 38, lineHeight: 1.05, color: th.text, letterSpacing: -0.5 }}>
          Mes matchs
        </div>

        {error && <div style={{ margin: '14px 20px 0', background: th.accent, color: th.onAccent, borderRadius: 12, padding: '11px 14px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>{error}</div>}

        <div style={{ padding: '18px 20px 0' }}>
          {loading ? (
            <div style={{ padding: '30px 0', textAlign: 'center', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>
          ) : (
            <MyMatchesList
              matches={matches}
              token={token!}
              onChanged={() => { if (token) api.getMyMatches(token).then(setMatches).catch(() => {}); }}
            />
          )}
        </div>
      </div>
    </Screen>
  );
}
