'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { api, ClubDetail, OpenMatch, MyMatch, notificationsStreamUrl } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { useAuth } from '@/lib/useAuth';
import { Screen } from '@/components/ui/Screen';
import { ClubNav } from '@/components/ClubNav';
import { Segmented } from '@/components/ui/atoms';
import { Icon } from '@/components/ui/Icon';
import { Leaderboard } from '@/components/openmatch/Leaderboard';
import { MyMatchesList } from '@/components/match/MyMatchesList';
import { OpenMatchCard } from '@/components/openmatch/OpenMatchCard';
import { clubIsMultiSport } from '@/lib/sportBadge';
import { rangesOverlap } from '@/lib/levelMatch';
import { LevelRangeSlider } from '@/components/player/LevelRangeSlider';
import { recommendMatches } from '@/lib/recommend';
import { useOpenMatchActions } from '@/components/openmatch/useOpenMatchActions';
import { OpenMatchModals } from '@/components/openmatch/OpenMatchModals';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { ResultsToRecord } from '@/components/match/ResultsToRecord';
import { MatchAlertSheet } from '@/components/openmatch/MatchAlertSheet';
import { alertChipLabel } from '@/lib/matchAlerts';
import type { MatchAlert } from '@/lib/api';

// Chip de filtre — même langage que `FacetChip` d'EventsFilterBar (tournois/events) :
// actif = encre pleine + coche, inactif = pill fine contourée.
function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  const { th } = useTheme();
  const fg = active ? (th.mode === 'floodlit' ? th.text : '#f7f5ee') : th.textMute;
  return (
    <button type="button" aria-pressed={active} onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      border: 'none', cursor: 'pointer', borderRadius: 999, padding: '5px 11px',
      fontFamily: th.fontUI, fontSize: 12, fontWeight: active ? 700 : 600,
      background: active ? th.ink : 'transparent', color: fg,
      boxShadow: active ? 'none' : `inset 0 0 0 1px ${th.line}`,
      transition: 'all .15s', WebkitTapHighlightColor: 'transparent',
    }}>
      {active && <Icon name="check" size={11} color={fg} />}
      {label}
    </button>
  );
}

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
  // Filtre par niveau = jauge (fourchette) ; [1,8] = tous. Une partie passe si sa fourchette
  // chevauche [fMin,fMax] (les parties « ouvertes à tous » passent toujours).
  const [fMin, setFMin] = useState(1);
  const [fMax, setFMax] = useState(8);
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

  // Défaut « à mon niveau » dès que le niveau du joueur est connu — sauf si l'utilisateur a
  // déjà touché le filtre lui-même (chip « Tous », curseur…), auquel cas son choix prime.
  const filterTouchedRef = useRef(false);
  useEffect(() => {
    if (filterTouchedRef.current || myLevel == null) return;
    setFMin(Math.max(1, Math.round(myLevel) - 1));
    setFMax(Math.min(8, Math.round(myLevel) + 1));
  }, [myLevel]);
  const setLevelFilter = (min: number, max: number) => { filterTouchedRef.current = true; setFMin(min); setFMax(max); };

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

  const levelFilterActive = fMin > 1 || fMax < 8;
  // Fourchette « à mon niveau » (±1 autour du niveau arrondi) — sert à savoir si ce raccourci
  // est la sélection courante, pour le chip « rempli » (même langage que les filtres Events).
  const myLevelMin = myLevel != null ? Math.max(1, Math.round(myLevel) - 1) : null;
  const myLevelMax = myLevel != null ? Math.min(8, Math.round(myLevel) + 1) : null;
  const atMyLevel = myLevelMin != null && fMin === myLevelMin && fMax === myLevelMax;
  const filtered = levelFilterActive
    ? matches.filter((m) => rangesOverlap(m.targetLevelMin ?? null, m.targetLevelMax ?? null, fMin, fMax))
    : matches;

  // Section « Pour toi » : parties recommandées à mon niveau, retirées de la liste « Autres ».
  // Désactivée si le club n'utilise pas le système de niveau. Respecte le filtre de la jauge.
  const recommended = levelEnabled ? recommendMatches(filtered, myLevel, new Date()) : [];
  const recoIds = new Set(recommended.map((m) => m.id));
  const otherMatches = filtered.filter((m) => !recoIds.has(m.id));

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
            <div style={{ marginTop: 14, maxWidth: 430 }}>
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 4 }}>
                <span style={{ fontFamily: th.fontUI, fontSize: 12, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase', color: th.textMute }}>Filtrer par niveau</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  {myLevel != null && myLevelMin != null && myLevelMax != null && (
                    <FilterChip label="À mon niveau" active={atMyLevel}
                      onClick={() => setLevelFilter(myLevelMin, myLevelMax)} />
                  )}
                  <FilterChip label="Tous" active={!levelFilterActive}
                    onClick={() => setLevelFilter(1, 8)} />
                </div>
              </div>
              <LevelRangeSlider compact min={fMin} max={fMax} onChange={setLevelFilter} />
            </div>
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
                {levelFilterActive && matches.length > 0 ? 'Aucune partie dans cette fourchette de niveau.' : 'Aucune partie ouverte pour le moment.'}
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
