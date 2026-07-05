'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { api, ClubDetail, ClubLeaderboard, MyMatch, MyRating, RatingPoint } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { useAuth } from '@/lib/useAuth';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';
import { computePlayerStats } from '@/lib/playerStats';
import { StatsPanel } from '@/components/player/StatsPanel';

// Classement des joueurs du club par niveau. Content-only (pas de Screen/ClubNav) :
// rendu dans l'onglet « Classement » d'OpenMatches.
export function Leaderboard({ club, viewerUserId }: { club: ClubDetail; viewerUserId: string | null }) {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const [data, setData] = useState<ClubLeaderboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [optingIn, setOptingIn] = useState(false);
  // Données du panneau stats (best-effort : le classement s'affiche même si elles échouent).
  const [rating, setRating] = useState<MyRating | null>(null);
  const [myMatches, setMyMatches] = useState<MyMatch[]>([]);
  const [history, setHistory] = useState<RatingPoint[]>([]);

  // Liste des sports proposés par le club (key + name)
  const clubSportsList = club.clubSports?.map((cs) => ({ key: cs.sport.key, name: cs.sport.name })) ?? [];
  const firstSportKey = clubSportsList[0]?.key ?? 'padel';

  // Sport sélectionné pour le leaderboard : initialisé à la préférence (si disponible dans le club), sinon 1er sport
  const [lbSport, setLbSport] = useState<string>(firstSportKey);
  const [sportInitialized, setSportInitialized] = useState(false);

  // Charge le profil pour connaître le sport préféré, SEULEMENT si plusieurs sports disponibles
  useEffect(() => {
    if (!token || sportInitialized || clubSportsList.length <= 1) {
      // Pas de choix possible → considéré comme initialisé
      if (!sportInitialized) setSportInitialized(true);
      return;
    }
    api.getMyProfile(token).then((profile) => {
      const preferred = profile?.preferredSport?.key;
      if (preferred && clubSportsList.some((s) => s.key === preferred)) {
        setLbSport(preferred);
      }
      setSportInitialized(true);
    }).catch(() => {
      setSportInitialized(true);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const load = useCallback(async () => {
    if (!token) { setData(null); setLoading(false); return; }
    setLoading(true);
    try {
      const [lb, myRating, matches, ratingHistory] = await Promise.all([
        api.getClubLeaderboard(club.slug, token, lbSport),
        api.getMyRating(token, lbSport).catch(() => null),
        api.getMyMatches(token).catch(() => [] as MyMatch[]),
        api.getRatingHistory(token, lbSport).catch(() => [] as RatingPoint[]),
      ]);
      setData(lb);
      setRating(myRating);
      setMyMatches(matches);
      setHistory(ratingHistory);
    }
    catch { setData(null); }
    finally { setLoading(false); }
  }, [club.slug, token, lbSport]);

  // Charge le leaderboard dès que ready ET sport initialisé
  useEffect(() => {
    if (!ready || !sportInitialized) return;
    load();
  }, [ready, load, sportInitialized]);

  // Stats de jeu dérivées de l'historique de matchs, filtrées sur le sport affiché.
  const sportName = clubSportsList.find((s) => s.key === lbSport)?.name;
  const stats = useMemo(() => computePlayerStats(myMatches, sportName), [myMatches, sportName]);

  const optIn = async () => {
    if (!token) return;
    setOptingIn(true);
    try { await api.updateMyProfile({ showInLeaderboard: true }, token); await load(); }
    catch { /* best-effort : la CTA reste affichée */ }
    finally { setOptingIn(false); }
  };

  const card: React.CSSProperties = { background: th.surface, borderRadius: 16, padding: '14px 16px', boxShadow: `inset 0 0 0 1px ${th.line}` };
  const muted: React.CSSProperties = { fontFamily: th.fontUI, fontSize: 14, color: th.textMute, lineHeight: 1.5 };

  if (!ready || loading) {
    return <div style={{ padding: '24px 20px', textAlign: 'center', ...muted }}>Chargement…</div>;
  }
  if (!token || !data) {
    return <div style={{ padding: '24px 20px', textAlign: 'center', ...muted }}>Connectez-vous pour voir le classement.</div>;
  }

  const { entries, me } = data;
  return (
    <div style={{ padding: '14px 20px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Sélecteur de sport (masqué si un seul sport) */}
      {clubSportsList.length > 1 && (
        <select
          value={lbSport}
          onChange={(e) => setLbSport(e.target.value)}
          style={{
            alignSelf: 'flex-start',
            fontFamily: th.fontUI,
            fontSize: 14,
            color: th.text,
            background: th.surface,
            border: `1px solid ${th.line}`,
            borderRadius: 8,
            padding: '6px 10px',
            cursor: 'pointer',
          }}
        >
          {clubSportsList.map((s) => (
            <option key={s.key} value={s.key}>{s.name}</option>
          ))}
        </select>
      )}

      {/* Panneau « moi » : hero niveau + KPI + détails de jeu */}
      <StatsPanel
        me={me}
        totalRanked={entries.length}
        rating={rating}
        stats={stats}
        history={history}
        onOptIn={optIn}
        optingIn={optingIn}
      />

      {/* Liste */}
      {entries.length === 0 ? (
        <div style={{ padding: '20px 0', textAlign: 'center', ...muted }}>
          Aucun joueur classé pour le moment. Activez l&apos;affichage et jouez des matchs pour apparaître.
        </div>
      ) : entries.map((e) => {
        const mine = e.userId === viewerUserId;
        return (
          <div key={e.userId} style={{ ...card, ...(mine ? { boxShadow: `inset 0 0 0 2px ${th.accent}` } : {}), display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 17, color: th.textMute, width: 28, textAlign: 'center', flexShrink: 0 }}>{e.rank}</span>
            <Avatar firstName={e.firstName} lastName={e.lastName} avatarUrl={e.avatarUrl} size={36} color={colorForSeed(e.userId)} />
            <span data-testid="lb-name" style={{ fontFamily: th.fontUI, fontWeight: 600, fontSize: 15, color: th.text, flex: 1, minWidth: 0 }}>
              {e.firstName} {e.lastName}
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: th.fontUI }}>
              <strong style={{ fontSize: 15, color: th.text }}>{e.level.toFixed(1)}</strong>
              <span style={{ fontSize: 12.5, color: th.textMute }}>{e.tier}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
