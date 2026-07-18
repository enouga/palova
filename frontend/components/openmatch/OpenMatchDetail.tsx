'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, OpenMatch } from '@/lib/api';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { dangerBanner } from '@/lib/theme';
import { useAuth } from '@/lib/useAuth';
import { Screen } from '@/components/ui/Screen';
import { ClubNav } from '@/components/ClubNav';
import { Icon } from '@/components/ui/Icon';
import { clubHasPadel } from '@/lib/sport';
import { clubIsMultiSport } from '@/lib/sportBadge';
import { rangeLabel } from '@/lib/levelMatch';
import { OpenMatchCard } from '@/components/openmatch/OpenMatchCard';
import { OpenMatchModals } from '@/components/openmatch/OpenMatchModals';
import { useOpenMatchActions } from '@/components/openmatch/useOpenMatchActions';
import { ShareActions } from '@/components/tournament/ShareActions';
import { matchShareUrl, matchShareText } from '@/lib/matchShare';
import { useIsDesktop } from '@/lib/useIsDesktop';

// /parties/[id] — vue détaillée d'une partie ouverte (cible d'un lien partagé).
export function OpenMatchDetail({ matchId }: { matchId: string }) {
  const { club, loading } = useClub();
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const router = useRouter();
  // Même grille que /parties (2 colonnes dès 700px) : seule sur sa page, la carte garde
  // la largeur qu'elle aurait à côté d'une autre — pleine largeur, le mini-terrain s'étire
  // pour rien. Garder le breakpoint synchro avec OpenMatches.tsx.
  const isDesktop = useIsDesktop(700);

  const [match, setMatch] = useState<OpenMatch | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'notfound'>('loading');
  const [myLevel, setMyLevel] = useState<number | null>(null);
  const [viewerUserId, setViewerUserId] = useState('');
  const [canModerate, setCanModerate] = useState(false);
  const [friendIds, setFriendIds] = useState<Set<string>>(new Set());

  const noPadel = !!club && !clubHasPadel(club);
  useEffect(() => { if (noPadel) router.replace('/'); }, [noPadel, router]);

  const reload = useCallback(async () => {
    if (!club) return;
    try { setMatch(await api.getOpenMatch(club.slug, matchId, token ?? undefined)); setStatus('ready'); }
    catch { setStatus('notfound'); }
  }, [club, matchId, token]);

  useEffect(() => { if (ready && club) reload(); }, [ready, club, reload]);

  useEffect(() => { if (token) api.getMyRating(token, 'padel').then((r) => setMyLevel(r?.level ?? null)).catch(() => {}); }, [token]);
  useEffect(() => { if (token) api.getMyProfile(token).then((p) => setViewerUserId(p.id)).catch(() => {}); }, [token]);
  useEffect(() => { if (token && club) api.getMyClubs(token).then((list) => setCanModerate(list.some((c) => c.slug === club.slug && (c.role === 'OWNER' || c.role === 'ADMIN')))).catch(() => {}); }, [token, club]);
  useEffect(() => { if (token) api.listFollowing(token).then((fs) => setFriendIds(new Set(fs.map((f) => f.id)))).catch(() => {}); }, [token]);

  const a = useOpenMatchActions({ club: club!, token, myLevel, reload });

  if (loading || !club) return <div style={{ minHeight: '100vh', background: th.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>;
  if (noPadel) return <div style={{ minHeight: '100vh', background: th.bg }} />;

  const back = (
    <Link href="/parties" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: th.fontUI, fontSize: 14, color: th.textMute, textDecoration: 'none', padding: '16px 20px 0' }}>
      <Icon name="chevL" size={16} color={th.textMute} /> Parties
    </Link>
  );

  return (
    <Screen>
      <div style={{ paddingBottom: 40 }}>
        <ClubNav club={club} />
        {back}
        {status === 'loading' && (
          <div style={{ padding: '40px 0', textAlign: 'center', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>
        )}
        {status === 'notfound' && (
          <div style={{ padding: '40px 20px', textAlign: 'center', fontFamily: th.fontUI, color: th.textMute }}>
            Cette partie n&apos;existe plus.
          </div>
        )}
        {status === 'ready' && match && (
          <>
            <ShareActions
              uidPrefix="match"
              shareUrl={typeof window !== 'undefined' ? matchShareUrl(window.location.origin, match) : undefined}
              shareText={matchShareText(match, club.name, club.timezone)}
              item={{
                id: match.id,
                name: `Partie ouverte · ${match.resourceName}`,
                description: [
                  match.full ? 'Complet' : `${match.spotsLeft} place${match.spotsLeft > 1 ? 's' : ''}`,
                  (match.targetLevelMin != null || match.targetLevelMax != null) ? rangeLabel(match.targetLevelMin ?? null, match.targetLevelMax ?? null) : null,
                  club.name,
                ].filter(Boolean).join(' · '),
                startTime: match.startTime,
                endTime: match.endTime,
                club: { name: club.name },
              }}
            />
            {a.error && (
              <div style={{ ...dangerBanner(th), margin: '14px 20px 0' }}>{a.error}</div>
            )}
            <div data-match-grid style={{ padding: '14px 20px 0', display: 'grid', gridTemplateColumns: isDesktop ? '1fr 1fr' : '1fr', gap: 12, alignItems: 'start' }}>
              <OpenMatchCard
                match={match} friendIds={friendIds} timezone={club.timezone} slug={club.slug} token={token ?? ''}
                busy={a.busyId === match.id} addingOpen={a.addingId === match.id}
                onJoin={a.join} onLeave={a.leave} onRemovePlayer={a.removePlayer} onSetTeams={a.setTeams}
                onAddPlayer={a.addPlayerToTeam} onReplacePlayer={a.replacePlayer}
                onToggleAdd={a.onToggleAdd} onCancelAdd={a.onCancelAdd}
                onRecordResult={(mm) => a.setRecordingFor(mm)} canRecordResult={club.levelSystemEnabled !== false}
                onOpenChat={a.openChat}
                showSport={clubIsMultiSport(club)} isAnonymous={!token} onAuthPrompt={a.setAuthPrompt}
                viewerUserId={viewerUserId || undefined}
              />
            </div>
          </>
        )}
      </div>
      <OpenMatchModals club={club} token={token} viewerUserId={viewerUserId} canModerate={canModerate} actions={a} reload={reload} authNextPath={`/parties/${matchId}`} />
    </Screen>
  );
}
