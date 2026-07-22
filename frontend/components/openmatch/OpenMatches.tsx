'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { api, ClubDetail, OpenMatch, MyMatch } from '@/lib/api';
import { subscribeNotifications } from '@/lib/notificationsStream';
import { useTheme } from '@/lib/ThemeProvider';
import { dangerBanner } from '@/lib/theme';
import { useAuth } from '@/lib/useAuth';
import { Screen } from '@/components/ui/Screen';
import { ClubNav } from '@/components/ClubNav';
import { Segmented } from '@/components/ui/atoms';
import { Leaderboard } from '@/components/openmatch/Leaderboard';
import { MyMatchesList } from '@/components/match/MyMatchesList';
import { OpenMatchCard } from '@/components/openmatch/OpenMatchCard';
import { clubIsMultiSport } from '@/lib/sportBadge';
import { rangesOverlap } from '@/lib/levelMatch';
import { recommendMatches } from '@/lib/recommend';
import { useOpenMatchActions } from '@/components/openmatch/useOpenMatchActions';
import { OpenMatchModals } from '@/components/openmatch/OpenMatchModals';
import { MatchesFilterBar } from '@/components/openmatch/MatchesFilterBar';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { ResultsToRecord } from '@/components/match/ResultsToRecord';
import { MatchAlertSheet } from '@/components/openmatch/MatchAlertSheet';
import type { MatchAlert } from '@/lib/api';

// /parties — découverte des parties ouvertes (PUBLIC) du club : rejoindre / quitter.
export function OpenMatches({ club }: { club: ClubDetail }) {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const levelEnabled = club.levelSystemEnabled !== false;
  const multiSport = clubIsMultiSport(club);
  // Écran large (le Screen fait 1080px) : cartes en grille — une carte pleine largeur
  // étire le mini-terrain pour rien. 1 colonne en mobile, 2 dès 700px.
  const isDesktop = useIsDesktop(700);
  const matchGrid = {
    display: 'grid',
    gridTemplateColumns: isDesktop ? '1fr 1fr' : '1fr',
    gap: 12,
    alignItems: 'start',
  } as const;
  const [matches, setMatches] = useState<OpenMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [myLevel, setMyLevel] = useState<number | null>(null);
  // Filtre par niveau = jauge (fourchette) ; [1,8] = tous. Une partie passe si sa fourchette
  // chevauche [fMin,fMax] (les parties « ouvertes à tous » passent toujours).
  const [fMin, setFMin] = useState(1);
  const [fMax, setFMax] = useState(8);
  const [kindFilter, setKindFilter] = useState<'all' | 'competitive' | 'friendly'>('all');
  const [genderFilter, setGenderFilter] = useState<'all' | 'WOMEN' | 'MIXED'>('all');
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
    try { setMatches(await api.getOpenMatches(club.slug, token ?? undefined)); setError(false); }
    catch { setMatches([]); setError(true); }
    finally { setLoading(false); }
  }, [club.slug, token]);

  useEffect(() => { if (ready) load(); }, [ready, load]);

  const loadAlerts = useCallback(() => {
    if (!token) { setAlerts([]); return; }
    api.listMyMatchAlerts(club.slug, token).then(setAlerts).catch(() => setAlerts([]));
  }, [token, club.slug]);
  useEffect(() => { loadAlerts(); }, [loadAlerts]);

  const handleDeleteAlert = async (id: string) => {
    if (!token) return;
    setAlerts((xs) => xs.filter((x) => x.id !== id)); // optimiste
    try { await api.deleteMatchAlert(club.slug, id, token); } catch { loadAlerts(); }
  };
  const handleCreateAlert = () => {
    setAlertSheet({ date: new Date().toISOString().slice(0, 10), from: '18:00', to: '21:00' });
  };

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
    return subscribeNotifications(token, () => { load(); window.dispatchEvent(new Event('palova:openmatch-unread')); });
  }, [token, load]);

  const a = useOpenMatchActions({ club, token, myLevel, reload: load });

  // Rejoindre OU quitter fait migrer la carte de section (vers/hors « Vos parties », rendue en tête) :
  // sur le coup on perd sa trace (elle « disparaît » d'où on a cliqué). On l'amène sous les yeux
  // (défilement doux) et on la fait pulser une fois pour rendre visible OÙ elle est repartie —
  // accent si rejoint, teinte neutre si quitté. flash n'est posé qu'APRÈS le reload → la carte est
  // déjà à sa nouvelle place. Quitté + filtrée hors jauge → carte absente : le toast suffit (el null).
  useEffect(() => {
    const f = a.flash;
    if (!f) return;
    const ring = f.kind === 'joined' ? th.accent : th.textMute;
    const t = setTimeout(() => {
      const el = document.getElementById(`open-match-${f.match.id}`);
      if (!el) return;
      try {
        if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.animate?.(
          [
            { boxShadow: `inset 0 0 0 1px ${th.line}, 0 0 0 0 ${ring}`, offset: 0 },
            { boxShadow: `inset 0 0 0 1px ${th.line}, 0 0 0 5px ${ring}`, offset: 0.35 },
            { boxShadow: `inset 0 0 0 1px ${th.line}, 0 0 0 0 ${ring}`, offset: 1 },
          ],
          { duration: 1400, easing: 'ease-out' },
        );
      } catch { /* jsdom : scrollIntoView/animate non implémentés — sans effet en test */ }
    }, 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.flash]);

  const levelFilterActive = fMin > 1 || fMax < 8;
  // Fourchette « à mon niveau » (±1 autour du niveau arrondi) — passée à MatchesFilterBar
  // pour le chip préset (le composant décide lui-même s'il est actif).
  const myLevelMin = myLevel != null ? Math.max(1, Math.round(myLevel) - 1) : null;
  const myLevelMax = myLevel != null ? Math.min(8, Math.round(myLevel) + 1) : null;
  const byLevel = levelFilterActive
    ? matches.filter((m) => rangesOverlap(m.targetLevelMin ?? null, m.targetLevelMax ?? null, fMin, fMax))
    : matches;
  const filtered = (kindFilter === 'all'
    ? byLevel
    : byLevel.filter((m) => (m.competitive === false) === (kindFilter === 'friendly'))
  ).filter((m) => genderFilter === 'all' || (m.gender ?? null) === genderFilter);

  // Section « Vos parties » : celles où je suis inscrit (organisateur compris), toujours en
  // tête et JAMAIS soumises aux filtres — une partie rejointe ne doit pas disparaître
  // derrière la jauge de niveau. Retirées des deux sections de découverte.
  const mine = token ? matches.filter((m) => m.viewerIsParticipant || m.viewerIsOrganizer) : [];
  const mineIds = new Set(mine.map((m) => m.id));
  const discoverable = filtered.filter((m) => !mineIds.has(m.id));
  // Section « À votre niveau » : parties recommandées, retirées de « Toutes les parties ».
  // Désactivée si le club n'utilise pas le système de niveau. Respecte le filtre de la jauge.
  const recommended = levelEnabled ? recommendMatches(discoverable, myLevel, new Date()) : [];
  const recoIds = new Set(recommended.map((m) => m.id));
  const otherMatches = discoverable.filter((m) => !recoIds.has(m.id));

  const sectionTitle = {
    fontFamily: th.fontUI, fontWeight: 700, fontSize: 13, letterSpacing: 0.4,
    textTransform: 'uppercase', color: th.textMute, marginBottom: 12,
  } as const;
  const renderCard = (m: OpenMatch) => (
    <OpenMatchCard
      key={m.id} match={m} friendIds={friendIds} timezone={club.timezone} slug={club.slug} token={token ?? ''}
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
      isAnonymous={!token}
      onAuthPrompt={a.setAuthPrompt}
      viewerUserId={viewerUserId || undefined}
    />
  );

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
            Rejoignez une partie publique, ou créez la vôtre au moment de réserver.
          </p>
          <MatchesFilterBar
            levelEnabled={levelEnabled}
            authenticated={!!token}
            myLevel={myLevel}
            myLevelMin={myLevelMin}
            myLevelMax={myLevelMax}
            fMin={fMin}
            fMax={fMax}
            onLevelChange={setLevelFilter}
            kindFilter={kindFilter}
            onKindChange={setKindFilter}
            genderFilter={genderFilter}
            onGenderChange={setGenderFilter}
            resultCount={mine.length + discoverable.length}
            alerts={alerts}
            timezone={club.timezone}
            onDeleteAlert={handleDeleteAlert}
            onCreateAlert={handleCreateAlert}
          />
        </div>

        {a.error && (
          <div style={{ ...dangerBanner(th), margin: '14px 20px 0' }}>{a.error}</div>
        )}

        {token && mine.length > 0 && (
          <div style={{ padding: '14px 20px 0' }}>
            <div style={sectionTitle}>Vos parties</div>
            <div data-match-grid style={matchGrid}>
              {mine.map(renderCard)}
            </div>
          </div>
        )}

        {token && recommended.length > 0 && (
          <div style={{ padding: '14px 20px 0' }}>
            <div style={sectionTitle}>À votre niveau</div>
            <div data-match-grid style={matchGrid}>
              {recommended.map(renderCard)}
            </div>
          </div>
        )}

        <div style={{ padding: '14px 20px 0' }}>
          {token && (mine.length > 0 || recommended.length > 0) && otherMatches.length > 0 && (
            <div style={sectionTitle}>Toutes les parties</div>
          )}
          {!ready || loading ? (
            <div style={{ padding: '24px 0', textAlign: 'center', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>
          ) : error ? (
            <div style={{ padding: '24px 0', textAlign: 'center', fontFamily: th.fontUI, color: th.textMute }}>
              Impossible de charger les parties pour le moment.
              <div style={{ marginTop: 12 }}>
                <button onClick={load} style={{ border: 'none', background: th.accent, color: th.onAccent, borderRadius: 999, padding: '9px 16px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700 }}>Réessayer</button>
              </div>
            </div>
          ) : otherMatches.length === 0 ? (
            recommended.length > 0 || mine.length > 0 ? (
              <div style={{ padding: '24px 0', textAlign: 'center', fontFamily: th.fontUI, color: th.textMute }}>Pas d&apos;autre partie ouverte.</div>
            ) : (
              <div style={{ padding: '24px 0', textAlign: 'center', fontFamily: th.fontUI, color: th.textMute }}>
                {levelFilterActive && matches.length > 0 ? 'Aucune partie dans cette fourchette de niveau.' : 'Aucune partie ouverte pour le moment.'}
                {token && (
                  <div style={{ marginTop: 4, fontSize: 13 }}>Créez une alerte pour être prévenu dès qu&apos;une partie correspond.</div>
                )}
              </div>
            )
          ) : (
            <div data-match-grid style={matchGrid}>
              {otherMatches.map(renderCard)}
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
