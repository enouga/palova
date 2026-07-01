'use client';
import { useEffect, useState, useCallback } from 'react';
import { api, ClubDetail, ClubLeaderboard } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { useAuth } from '@/lib/useAuth';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';

// Classement des joueurs du club par niveau. Content-only (pas de Screen/ClubNav) :
// rendu dans l'onglet « Classement » d'OpenMatches.
export function Leaderboard({ club, viewerUserId }: { club: ClubDetail; viewerUserId: string | null }) {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const [data, setData] = useState<ClubLeaderboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [optingIn, setOptingIn] = useState(false);

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
    try { setData(await api.getClubLeaderboard(club.slug, token, lbSport)); }
    catch { setData(null); }
    finally { setLoading(false); }
  }, [club.slug, token, lbSport]);

  // Charge le leaderboard dès que ready ET sport initialisé
  useEffect(() => {
    if (!ready || !sportInitialized) return;
    load();
  }, [ready, load, sportInitialized]);

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
  const decided = (me.wins ?? 0) + (me.losses ?? 0);
  const winRate = decided > 0 ? Math.round((me.wins / decided) * 100) : 0;
  const streakN = Math.abs(me.streak ?? 0);
  const streakWin = (me.streak ?? 0) > 0;

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

      {/* Panneau « moi » */}
      <div style={{ ...card, background: th.accent, color: th.onAccent, boxShadow: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {me.ranked ? (
          <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 15 }}>
            Vous êtes {me.rank}<sup>e</sup> sur {entries.length} · niveau {me.level!.toFixed(1)}
          </span>
        ) : me.optedIn && me.matchesToGo > 0 ? (
          <span style={{ fontFamily: th.fontUI, fontWeight: 600, fontSize: 14.5 }}>
            Encore {me.matchesToGo} match{me.matchesToGo > 1 ? 's' : ''} pour être classé.
          </span>
        ) : !me.optedIn ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{ fontFamily: th.fontUI, fontWeight: 600, fontSize: 14.5 }}>Vous n&apos;apparaissez pas dans le classement.</span>
            <button onClick={optIn} disabled={optingIn}
              style={{ alignSelf: 'flex-start', background: th.onAccent, color: th.accent, border: 'none', borderRadius: 999, padding: '8px 16px', fontFamily: th.fontUI, fontWeight: 700, fontSize: 13.5, cursor: 'pointer', opacity: optingIn ? 0.6 : 1 }}>
              Apparaître dans le classement
            </button>
          </div>
        ) : (
          <span style={{ fontFamily: th.fontUI, fontWeight: 600, fontSize: 14.5 }}>Vous figurez au classement dès qu&apos;il y aura des joueurs classés.</span>
        )}
        {decided > 0 && (
          <div style={{ borderTop: `1px solid ${th.onAccent}33`, paddingTop: 10, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 14px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>
            <span>{decided} match{decided > 1 ? 's' : ''}</span>
            <span>{winRate}% de victoires</span>
            <span>{me.wins} V · {me.losses} D</span>
            {streakN > 0 && (
              <span style={{ borderRadius: 999, padding: '2px 9px', fontSize: 12.5, fontWeight: 700, background: streakWin ? th.onAccent : ACCENTS.coral, color: streakWin ? th.accent : '#fff' }}>
                {streakN} {streakWin ? 'victoire' : 'défaite'}{streakN > 1 ? 's' : ''} d&apos;affilée
              </span>
            )}
          </div>
        )}
      </div>

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
