'use client';
import { useEffect, useState, useCallback } from 'react';
import { api, ClubDetail, OpenMatch, MyMatch, notificationsStreamUrl } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { useAuth } from '@/lib/useAuth';
import { Screen } from '@/components/ui/Screen';
import { ClubNav } from '@/components/ClubNav';
import { Segmented } from '@/components/ui/atoms';
import { Leaderboard } from '@/components/openmatch/Leaderboard';
import { MyMatchesList } from '@/components/match/MyMatchesList';
import { OpenMatchCard } from '@/components/openmatch/OpenMatchCard';
import { clubIsMultiSport } from '@/lib/sportBadge';
import { inRange } from '@/lib/levelMatch';
import { recommendMatches } from '@/lib/recommend';
import { useOpenMatchActions } from '@/components/openmatch/useOpenMatchActions';
import { OpenMatchModals } from '@/components/openmatch/OpenMatchModals';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { ResultsToRecord } from '@/components/match/ResultsToRecord';
import { MatchAlertSheet } from '@/components/openmatch/MatchAlertSheet';
import { alertChipLabel } from '@/lib/matchAlerts';
import type { MatchAlert } from '@/lib/api';

// /parties — découverte des parties ouvertes (PUBLIC) du club : rejoindre / quitter.
export function OpenMatches({ club }: { club: ClubDetail }) {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const levelEnabled = club.levelSystemEnabled !== false;
  const multiSport = clubIsMultiSport(club);
  // Écran large (le Screen fait 820px) : cartes en grille 2 colonnes — une carte
  // pleine largeur étire le mini-terrain pour rien ; en mobile, 1 colonne.
  const isDesktop = useIsDesktop(700);
  const matchGrid = {
    display: 'grid',
    gridTemplateColumns: isDesktop ? '1fr 1fr' : '1fr',
    gap: 12,
    alignItems: 'start',
  } as const;
  const [matches, setMatches] = useState<OpenMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [myLevel, setMyLevel] = useState<number | null>(null);
  const [filterMyLevel, setFilterMyLevel] = useState(false);
  const [view, setView] = useState<'parties' | 'matchs' | 'classement'>('parties');
  // Mes matchs (résultats) : chargés à la 1re ouverture de la vue. null = pas encore chargé.
  const [myMatches, setMyMatches] = useState<MyMatch[] | null>(null);
  const [viewerUserId, setViewerUserId] = useState('');
  const [canModerate, setCanModerate] = useState(false);
  const [friendIds, setFriendIds] = useState<Set<string>>(new Set());
  const [alerts, setAlerts] = useState<MatchAlert[]>([]);
  const [alertSheet, setAlertSheet] = useState<{ date: string; from: string; to: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setMatches(await api.getOpenMatches(club.slug, token ?? undefined)); }
    catch { setMatches([]); }
    finally { setLoading(false); }
  }, [club.slug, token]);

  useEffect(() => { if (ready) load(); }, [ready, load]);

  const loadAlerts = useCallback(() => {
    if (!token) { setAlerts([]); return; }
    api.listMyMatchAlerts(club.slug, token).then(setAlerts).catch(() => setAlerts([]));
  }, [token, club.slug]);
  useEffect(() => { loadAlerts(); }, [loadAlerts]);

  // Deeplink ?vue=matchs (menu profil, redirection de /me/matches, notifications).
  // L'event window couvre le cas « déjà sur /parties » : router.push ne remonte pas le composant.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('vue') === 'matchs') setView('matchs');
    const onVue = (e: Event) => { if ((e as CustomEvent).detail === 'matchs') setView('matchs'); };
    window.addEventListener('palova:parties-vue', onVue);
    return () => window.removeEventListener('palova:parties-vue', onVue);
  }, []);

  useEffect(() => {
    if (view !== 'matchs' || !token) return;
    api.getMyMatches(token).then(setMyMatches).catch(() => setMyMatches([]));
  }, [view, token]);

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

  const a = useOpenMatchActions({ club, token, myLevel, reload: load });

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
            <Segmented<'parties' | 'matchs' | 'classement'>
              value={view}
              onChange={setView}
              options={[
                { value: 'parties', label: 'Parties' },
                { value: 'matchs', label: 'Mes matchs' },
                { value: 'classement', label: 'Stats' },
              ]}
            />
          </div>
        )}
        {!levelEnabled || !token || view === 'parties' ? (
          <>
        {levelEnabled && (
          <ResultsToRecord token={token} clubSlug={club.slug} />
        )}
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
          {token && (
            <div style={{ marginTop: 14 }}>
              <button
                onClick={() => setAlertSheet({ date: new Date().toISOString().slice(0, 10), from: '18:00', to: '21:00' })}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: `1px solid ${th.line}`, background: th.surface, borderRadius: 999, padding: '8px 14px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600, color: th.text }}>
                🔔 Créer une alerte
              </button>
              {alerts.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                  {alerts.map((al) => (
                    <span key={al.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: th.surface2, borderRadius: 999, padding: '6px 10px 6px 12px', fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute }}>
                      {alertChipLabel(al, club.timezone)}
                      <button aria-label="Supprimer l'alerte" onClick={async () => {
                        setAlerts((xs) => xs.filter((x) => x.id !== al.id)); // optimiste
                        try { await api.deleteMatchAlert(club.slug, al.id, token); } catch { loadAlerts(); }
                      }} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textFaint, fontSize: 15, lineHeight: 1 }}>✕</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {a.error && (
          <div style={{ margin: '14px 20px 0', background: th.accent, color: th.onAccent, borderRadius: 12, padding: '10px 14px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>{a.error}</div>
        )}

        {token && recommended.length > 0 && (
          <div style={{ padding: '14px 20px 0' }}>
            <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 13, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute, marginBottom: 12 }}>Pour toi</div>
            <div data-match-grid style={matchGrid}>
              {recommended.map((m) => (
                <OpenMatchCard
                  key={m.id} match={m} friendIds={friendIds} timezone={club.timezone} slug={club.slug} token={token}
                  busy={a.busyId === m.id} addingOpen={a.addingId === m.id}
                  onJoin={a.join}
                  onLeave={a.leave}
                  onRemovePlayer={a.removePlayer}
                  onSetTeams={a.setTeams}
                  onAddPlayer={a.addPlayerToTeam}
                  onReplacePlayer={a.replacePlayer}
                  onToggleAdd={a.onToggleAdd}
                  onCancelAdd={a.onCancelAdd}
                  onRecordResult={(mm) => a.setRecordingFor(mm)}
                  canRecordResult={levelEnabled}
                  onOpenChat={a.openChat}
                  showSport={multiSport}
                  isAnonymous={false}
                  onAuthPrompt={a.setAuthPrompt}
                  viewerUserId={viewerUserId || undefined}
                />
              ))}
            </div>
          </div>
        )}

        <div style={{ padding: '14px 20px 0' }}>
          {token && recommended.length > 0 && otherMatches.length > 0 && (
            <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 13, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute, marginBottom: 12 }}>Autres parties</div>
          )}
          {!ready || loading ? (
            <div style={{ padding: '24px 0', textAlign: 'center', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>
          ) : otherMatches.length === 0 ? (
            recommended.length > 0 ? (
              <div style={{ padding: '24px 0', textAlign: 'center', fontFamily: th.fontUI, color: th.textMute }}>Pas d&apos;autre partie ouverte.</div>
            ) : (
              <div style={{ padding: '24px 0', textAlign: 'center', fontFamily: th.fontUI, color: th.textMute }}>
                {filterMyLevel && matches.length > 0 ? 'Aucune partie à ton niveau pour le moment.' : 'Aucune partie ouverte pour le moment.'}
                {token && (
                  <div style={{ marginTop: 12 }}>
                    <button onClick={() => setAlertSheet({ date: new Date().toISOString().slice(0, 10), from: '18:00', to: '21:00' })}
                      style={{ border: 'none', background: th.accent, color: th.onAccent, borderRadius: 999, padding: '9px 16px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700 }}>
                      🔔 Créer une alerte
                    </button>
                  </div>
                )}
              </div>
            )
          ) : (
            <div data-match-grid style={matchGrid}>
              {otherMatches.map((m) => (
                <OpenMatchCard
                  key={m.id}
                  match={m}
                  friendIds={friendIds}
                  timezone={club.timezone}
                  slug={club.slug}
                  token={token ?? ''}
                  busy={a.busyId === m.id}
                  addingOpen={a.addingId === m.id}
                  onJoin={a.join}
                  onLeave={a.leave}
                  onRemovePlayer={a.removePlayer}
                  onSetTeams={a.setTeams}
                  onAddPlayer={a.addPlayerToTeam}
                  onReplacePlayer={a.replacePlayer}
                  onToggleAdd={a.onToggleAdd}
                  onCancelAdd={a.onCancelAdd}
                  onRecordResult={(mm) => a.setRecordingFor(mm)}
                  canRecordResult={levelEnabled}
                  onOpenChat={a.openChat}
                  showSport={multiSport}
                  isAnonymous={!token}
                  onAuthPrompt={a.setAuthPrompt}
                  viewerUserId={viewerUserId || undefined}
                />
              ))}
            </div>
          )}
        </div>
          </>
        ) : view === 'matchs' ? (
          <>
            <ResultsToRecord token={token} clubSlug={club.slug}
              onRecorded={() => api.getMyMatches(token).then(setMyMatches).catch(() => {})} />
            <div style={{ padding: '18px 20px 0' }}>
              <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 26, color: th.text, margin: 0, letterSpacing: -0.4 }}>Mes matchs</h1>
              <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, lineHeight: 1.5, margin: '8px 0 0' }}>
                Vos résultats enregistrés : confirmez ou contestez ceux en attente.
              </p>
            </div>
            <div style={{ padding: '14px 20px 0' }}>
              {myMatches === null ? (
                <div style={{ padding: '24px 0', textAlign: 'center', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>
              ) : (
                <MyMatchesList
                  matches={myMatches}
                  token={token}
                  onChanged={() => api.getMyMatches(token).then(setMyMatches).catch(() => {})}
                />
              )}
            </div>
          </>
        ) : (
          <Leaderboard club={club} viewerUserId={viewerUserId || null} />
        )}
      </div>
      <OpenMatchModals club={club} token={token} viewerUserId={viewerUserId} canModerate={canModerate} actions={a} reload={load} authNextPath="/parties" />
      {alertSheet && token && (
        <MatchAlertSheet club={club} token={token} initial={alertSheet}
          onClose={() => setAlertSheet(null)}
          onCreated={() => { setAlertSheet(null); loadAlerts(); }} />
      )}
    </Screen>
  );
}
