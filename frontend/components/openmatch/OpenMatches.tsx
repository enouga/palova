'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api, ClubDetail, OpenMatch, notificationsStreamUrl } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { useAuth } from '@/lib/useAuth';
import { Screen } from '@/components/ui/Screen';
import { ClubNav } from '@/components/ClubNav';
import { Segmented } from '@/components/ui/atoms';
import { Leaderboard } from '@/components/openmatch/Leaderboard';
import { OpenMatchCard } from '@/components/openmatch/OpenMatchCard';
import { clubIsMultiSport } from '@/lib/sportBadge';
import { OpenMatchChatSheet } from '@/components/openmatch/OpenMatchChatSheet';
import { AuthPromptDialog } from '@/components/openmatch/AuthPromptDialog';
import { MatchResultModal } from '@/components/match/MatchResultModal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { inRange } from '@/lib/levelMatch';
import { recommendMatches } from '@/lib/recommend';

const JOIN_ERRORS: Record<string, string> = {
  MATCH_FULL:            'Cette partie est complète.',
  MATCH_IN_PAST:         'Cette partie a déjà eu lieu.',
  MATCH_NOT_JOINABLE:    "Cette partie n'est plus ouverte.",
  ALREADY_JOINED:        'Vous participez déjà à cette partie.',
  ORGANIZER_CANNOT_LEAVE: "Vous organisez cette partie : annulez la réservation pour la retirer.",
  MEMBERSHIP_REQUIRED:   'Réservé aux membres du club.',
  MEMBERSHIP_BLOCKED:    'Votre accès au club est bloqué.',
  NOT_ORGANIZER:          "Seul l'organisateur peut retirer un joueur.",
  CANNOT_REMOVE_ORGANIZER: "L'organisateur ne peut pas être retiré.",
  PARTICIPANT_NOT_FOUND:  "Ce joueur n'est plus dans la partie.",
  ALREADY_PARTICIPANT:   'Vous participez déjà à cette partie.',
  CHAT_FORBIDDEN:        'Réservé aux inscrits et aux intéressés.',
  NOT_ALLOWED:           'Action non autorisée.',
  RESERVATION_NOT_FOUND: "Cette partie n'existe plus.",
};

// /parties — découverte des parties ouvertes (PUBLIC) du club : rejoindre / quitter.
export function OpenMatches({ club }: { club: ClubDetail }) {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const router = useRouter();
  const levelEnabled = club.levelSystemEnabled !== false;
  const multiSport = clubIsMultiSport(club);
  const [matches, setMatches] = useState<OpenMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId]   = useState<string | null>(null);
  const [error, setError]     = useState('');
  const [addingId, setAddingId] = useState<string | null>(null);
  const [recordingFor, setRecordingFor] = useState<OpenMatch | null>(null);
  const [myLevel, setMyLevel] = useState<number | null>(null);
  const [filterMyLevel, setFilterMyLevel] = useState(false);
  const [joinWarning, setJoinWarning] = useState<OpenMatch | null>(null);
  const [view, setView] = useState<'parties' | 'classement'>('parties');
  const [chatting, setChatting] = useState<OpenMatch | null>(null);
  const [authPrompt, setAuthPrompt] = useState<OpenMatch | null>(null);
  const [viewerUserId, setViewerUserId] = useState('');
  const [canModerate, setCanModerate] = useState(false);
  const [friendIds, setFriendIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try { setMatches(await api.getOpenMatches(club.slug, token ?? undefined)); }
    catch { setMatches([]); }
    finally { setLoading(false); }
  }, [club.slug, token]);

  useEffect(() => { if (ready) load(); }, [ready, load]);

  useEffect(() => {
    if (!token) return;
    api.getMyRating(token, 'padel').then((r) => setMyLevel(r?.level ?? null)).catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!token) return;
    api.getMyProfile(token).then((p) => setViewerUserId(p.id)).catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!token) return;
    api.getMyClubs(token)
      .then((list) => setCanModerate(list.some((c) => c.slug === club.slug && (c.role === 'OWNER' || c.role === 'ADMIN'))))
      .catch(() => {});
  }, [token, club.slug]);

  useEffect(() => {
    if (!token) return;
    api.listFollowing(token).then((fs) => setFriendIds(new Set(fs.map((f) => f.id)))).catch(() => {});
  }, [token]);

  const act = async (m: OpenMatch, fn: () => Promise<unknown>) => {
    if (!token) return;
    setBusyId(m.id); setError('');
    try { await fn(); await load(); }
    catch (e) { setError(JOIN_ERRORS[(e as Error).message] ?? (e as Error).message); }
    finally { setBusyId(null); }
  };

  const openChat = (m: OpenMatch) => {
    setChatting(m);
    if (token) api.markOpenMatchChatRead(club.slug, m.id, token)
      .then(() => { load(); window.dispatchEvent(new Event('palova:openmatch-unread')); })
      .catch(() => {});
  };

  useEffect(() => {
    if (!token) return;
    const es = new EventSource(notificationsStreamUrl(token));
    es.onmessage = (e) => {
      try { if (JSON.parse(e.data)?.type === 'notification') { load(); window.dispatchEvent(new Event('palova:openmatch-unread')); } }
      catch { /* ping/connected */ }
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [token, load]);
  const toggleInterest = (m: OpenMatch) =>
    act(m, () => (m.viewerIsInterested ? api.removeInterested(club.slug, m.id, token!) : api.setInterested(club.slug, m.id, token!)));

  const handleJoin = (m: OpenMatch) => {
    const min = m.targetLevelMin ?? null;
    const max = m.targetLevelMax ?? null;
    if (!inRange(myLevel, min, max)) {
      setJoinWarning(m);
    } else {
      act(m, () => api.joinOpenMatch(club.slug, m.id, token!));
    }
  };

  const visibleMatches = filterMyLevel
    ? matches.filter((m) => inRange(myLevel, m.targetLevelMin ?? null, m.targetLevelMax ?? null))
    : matches;

  // Section « Pour toi » : parties recommandées à mon niveau, retirées de la liste « Autres ».
  // Désactivée si le club n'utilise pas le système de niveau.
  const recommended = levelEnabled ? recommendMatches(matches, myLevel, new Date()) : [];
  const recoIds = new Set(recommended.map((m) => m.id));
  const otherMatches = visibleMatches.filter((m) => !recoIds.has(m.id));

  return (
    <Screen>
      <div style={{ paddingBottom: 40 }}>
        <ClubNav club={club} />
        {levelEnabled && token && (
          <div style={{ padding: '16px 20px 0' }}>
            <Segmented<'parties' | 'classement'>
              value={view}
              onChange={setView}
              options={[{ value: 'parties', label: 'Parties' }, { value: 'classement', label: 'Classement' }]}
            />
          </div>
        )}
        {!levelEnabled || view === 'parties' ? (
          <>
        <div style={{ padding: '18px 20px 0' }}>
          <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 26, color: th.text, margin: 0, letterSpacing: -0.4 }}>Parties ouvertes</h1>
          <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, lineHeight: 1.5, margin: '8px 0 0' }}>
            Rejoignez la partie publique d&apos;un autre membre, ou créez la vôtre en choisissant « Partie ouverte » au moment de réserver.
          </p>
          {levelEnabled && token && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 12, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, userSelect: 'none' }}>
              <input type="checkbox" checked={filterMyLevel} onChange={(e) => setFilterMyLevel(e.target.checked)}
                style={{ width: 16, height: 16, accentColor: th.accent, cursor: 'pointer' }} />
              À mon niveau
            </label>
          )}
        </div>

        {error && (
          <div style={{ margin: '14px 20px 0', background: th.accent, color: th.onAccent, borderRadius: 12, padding: '10px 14px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>{error}</div>
        )}

        {token && recommended.length > 0 && (
          <div style={{ padding: '14px 20px 0' }}>
            <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 13, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute, marginBottom: 12 }}>Pour toi</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {recommended.map((m) => (
                <OpenMatchCard
                  key={m.id} match={m} friendIds={friendIds} timezone={club.timezone} slug={club.slug} token={token}
                  busy={busyId === m.id} addingOpen={addingId === m.id}
                  onJoin={handleJoin}
                  onLeave={(mm) => act(mm, () => api.leaveOpenMatch(club.slug, mm.id, token))}
                  onRemovePlayer={(mm, p) => act(mm, () => api.removeOpenMatchPlayer(club.slug, mm.id, p.userId, token))}
                  onSetTeams={(mm, teams) => act(mm, () => api.setOpenMatchTeams(club.slug, mm.id, teams, token))}
                  onAddPlayer={(mm, memberId) => { setAddingId(null); act(mm, () => api.addOpenMatchPlayer(club.slug, mm.id, memberId, token)); }}
                  onToggleAdd={(mm) => setAddingId((prev) => (prev === mm.id ? null : mm.id))}
                  onCancelAdd={() => setAddingId(null)}
                  onRecordResult={(mm) => setRecordingFor(mm)}
                  canRecordResult={levelEnabled}
                  onToggleInterest={toggleInterest}
                  onOpenChat={openChat}
                  showSport={multiSport}
                  isAnonymous={false}
                  onAuthPrompt={setAuthPrompt}
                />
              ))}
            </div>
          </div>
        )}

        <div style={{ padding: '14px 20px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {token && recommended.length > 0 && otherMatches.length > 0 && (
            <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 13, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute, marginBottom: 0 }}>Autres parties</div>
          )}
          {!ready || loading ? (
            <div style={{ padding: '24px 0', textAlign: 'center', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>
          ) : otherMatches.length === 0 ? (
            recommended.length > 0 ? (
              <div style={{ padding: '24px 0', textAlign: 'center', fontFamily: th.fontUI, color: th.textMute }}>Pas d&apos;autre partie ouverte.</div>
            ) : (
              <div style={{ padding: '24px 0', textAlign: 'center', fontFamily: th.fontUI, color: th.textMute }}>
                {filterMyLevel && matches.length > 0 ? 'Aucune partie à ton niveau pour le moment.' : 'Aucune partie ouverte pour le moment.'}
              </div>
            )
          ) : otherMatches.map((m) => (
            <OpenMatchCard
              key={m.id}
              match={m}
              friendIds={friendIds}
              timezone={club.timezone}
              slug={club.slug}
              token={token ?? ''}
              busy={busyId === m.id}
              addingOpen={addingId === m.id}
              onJoin={handleJoin}
              onLeave={(mm) => act(mm, () => api.leaveOpenMatch(club.slug, mm.id, token!))}
              onRemovePlayer={(mm, p) => act(mm, () => api.removeOpenMatchPlayer(club.slug, mm.id, p.userId, token!))}
              onSetTeams={(mm, teams) => act(mm, () => api.setOpenMatchTeams(club.slug, mm.id, teams, token!))}
              onAddPlayer={(mm, memberId) => { setAddingId(null); act(mm, () => api.addOpenMatchPlayer(club.slug, mm.id, memberId, token!)); }}
              onToggleAdd={(mm) => setAddingId((prev) => (prev === mm.id ? null : mm.id))}
              onCancelAdd={() => setAddingId(null)}
              onRecordResult={(mm) => setRecordingFor(mm)}
              canRecordResult={levelEnabled}
              onToggleInterest={toggleInterest}
              onOpenChat={openChat}
              showSport={multiSport}
              isAnonymous={!token}
              onAuthPrompt={setAuthPrompt}
            />
          ))}
        </div>
          </>
        ) : (
          <Leaderboard club={club} viewerUserId={null} />
        )}
      </div>
      {recordingFor && token && (
        <MatchResultModal
          reservationId={recordingFor.id}
          players={recordingFor.players.map(({ userId, firstName, lastName, avatarUrl }) => ({ userId, firstName, lastName, avatarUrl }))}
          token={token}
          context={{ whenIso: recordingFor.startTime, tz: club.timezone, courtName: recordingFor.resourceName }}
          initialTeams={Object.fromEntries(recordingFor.players.filter((p) => p.team === 1 || p.team === 2).map((p) => [p.userId, p.team as 1 | 2]))}
          onClose={() => setRecordingFor(null)}
          onSaved={() => { setRecordingFor(null); load(); }}
        />
      )}
      {joinWarning && (
        <ConfirmDialog
          title="Niveau hors fourchette"
          message="Cette partie est hors de ta fourchette de niveau. Rejoindre quand même ?"
          confirmLabel="Rejoindre quand même"
          cancelLabel="Annuler"
          busy={busyId === joinWarning.id}
          onConfirm={() => { const m = joinWarning; setJoinWarning(null); act(m, () => api.joinOpenMatch(club.slug, m.id, token!)); }}
          onCancel={() => setJoinWarning(null)}
        />
      )}
      {chatting && token && (
        <OpenMatchChatSheet
          slug={club.slug} token={token} reservationId={chatting.id} viewerUserId={viewerUserId}
          viewerIsOrganizer={chatting.viewerIsOrganizer}
          canModerate={canModerate}
          title={`${chatting.resourceName} · ${new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: club.timezone }).format(new Date(chatting.startTime)).replace(':', 'h')}`}
          timezone={club.timezone}
          onClose={() => { setChatting(null); load(); window.dispatchEvent(new Event('palova:openmatch-unread')); }}
        />
      )}
      {authPrompt && (
        <AuthPromptDialog
          detail={authPrompt.resourceName}
          onRegister={() => router.push('/register?next=/parties')}
          onLogin={() => router.push('/login?next=/parties')}
          onClose={() => setAuthPrompt(null)}
        />
      )}
    </Screen>
  );
}
