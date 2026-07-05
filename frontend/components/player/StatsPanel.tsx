'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS, inkOn } from '@/lib/theme';
import { LeaderboardMe, MyRating, RatingPoint } from '@/lib/api';
import { PlayerStats, LevelPoint, levelTrend, sparkPoints } from '@/lib/playerStats';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';

// Panneau « mes stats » du classement : hero niveau (+ sparkline de progression),
// rangée de tuiles KPI (matchs / victoires / série), forme récente, sets & jeux,
// partenaire favori. Présentation pure — toutes les données arrivent en props.
// Marques : ligne 2px + point terminal cerclé, barres fines à bouts arrondis,
// piste d'un pas plus clair de la même teinte ; le texte reste en tokens texte.

function Sparkline({ points, stroke, ring }: { points: LevelPoint[]; stroke: string; ring: string }) {
  if (points.length < 2) return null;
  const W = 120, H = 44, PAD = 5;
  const lv = points.map((p) => p.level);
  const min = Math.min(...lv), max = Math.max(...lv);
  const span = max - min || 1;
  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / (points.length - 1);
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - 2 * PAD);
  const pts = lv.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${x(0).toFixed(1)},${H - PAD} ${pts} ${x(points.length - 1).toFixed(1)},${H - PAD}`;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" style={{ display: 'block' }}>
      <polygon points={area} fill={stroke} opacity={0.12} />
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(points.length - 1)} cy={y(lv[lv.length - 1])} r={4} fill={stroke} stroke={ring} strokeWidth={2} />
    </svg>
  );
}

/** Barre « gagnés vs perdus » : segment plein + piste, séparés par un liseré surface de 2px. */
function SplitBar({ label, won, lost }: { label: string; won: number; lost: number }) {
  const { th } = useTheme();
  const total = won + lost;
  if (total === 0) return null;
  const pct = (won / total) * 100;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, width: 40, flexShrink: 0 }}>{label}</span>
      <span style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, color: th.text, width: 24, textAlign: 'right', flexShrink: 0 }}>{won}</span>
      <span aria-hidden="true" style={{ flex: 1, display: 'flex', gap: 2, height: 8 }}>
        <span style={{ width: `${pct}%`, minWidth: won > 0 ? 8 : 0, background: ACCENTS.blue, borderRadius: 4 }} />
        <span style={{ flex: 1, background: th.surfaceHi, borderRadius: 4 }} />
      </span>
      <span style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.textMute, width: 24, flexShrink: 0 }}>{lost}</span>
    </div>
  );
}

function StatTile({ label, value, sub, meter, dot }: {
  label: string; value: string; sub?: string; meter?: number; dot?: string;
}) {
  const { th } = useTheme();
  return (
    <div style={{ background: th.surface, borderRadius: 14, padding: '12px 14px', boxShadow: `inset 0 0 0 1px ${th.line}`, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <span style={{ fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 600, letterSpacing: 0.3, textTransform: 'uppercase', color: th.textMute }}>{label}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        {dot && <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0 }} />}
        <span style={{ fontFamily: th.fontUI, fontSize: 22, fontWeight: 700, color: th.text, lineHeight: 1.1 }}>{value}</span>
      </span>
      {meter != null && (
        <span aria-hidden="true" style={{ height: 4, borderRadius: 2, background: `${ACCENTS.blue}2e`, overflow: 'hidden', display: 'block' }}>
          <span style={{ display: 'block', height: '100%', width: `${meter}%`, background: ACCENTS.blue, borderRadius: 2 }} />
        </span>
      )}
      {sub && <span style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute, whiteSpace: 'nowrap' }}>{sub}</span>}
    </div>
  );
}

export function StatsPanel({ me, totalRanked, rating, stats, history, onOptIn, optingIn }: {
  me: LeaderboardMe;
  totalRanked: number;
  rating: MyRating | null;
  stats: PlayerStats | null;
  history: RatingPoint[];
  onOptIn: () => void;
  optingIn: boolean;
}) {
  const { th } = useTheme();
  const decided = me.wins + me.losses;
  const rate = decided > 0 ? Math.round((me.wins / decided) * 100) : null;
  const trend = levelTrend(history);
  const spark = sparkPoints(history);
  const streakN = Math.abs(me.streak);

  const chip: React.CSSProperties = {
    alignSelf: 'flex-end', borderRadius: 999, padding: '3px 10px',
    fontFamily: th.fontUI, fontSize: 12, fontWeight: 700, background: th.onAccent, color: th.accent,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Hero — niveau + progression, sur l'accent du club */}
      <div style={{ background: th.accent, color: th.onAccent, borderRadius: 16, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {me.ranked ? (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', opacity: 0.85 }}>
                  Votre niveau
                </span>
                <span style={{ fontFamily: th.fontUI, fontSize: 44, fontWeight: 800, lineHeight: 1 }}>
                  {me.level!.toFixed(1)}
                </span>
                {rating && (
                  <span style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, opacity: 0.9 }}>
                    {rating.tier}{rating.isProvisional ? ' · provisoire' : ''}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                <Sparkline points={spark} stroke={th.onAccent} ring={th.accent} />
                {trend != null && trend !== 0 && (
                  <span style={chip}>
                    {trend > 0 ? '▲ +' : '▼ '}{trend.toFixed(1)} sur 30 j
                  </span>
                )}
              </div>
            </div>
            <span style={{ borderTop: `1px solid ${th.onAccent}33`, paddingTop: 10, fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>
              {me.rank}<sup>e</sup> sur {totalRanked} au classement du club
            </span>
          </>
        ) : me.optedIn && me.matchesToGo > 0 ? (
          <span style={{ fontFamily: th.fontUI, fontWeight: 600, fontSize: 14.5 }}>
            Encore {me.matchesToGo} match{me.matchesToGo > 1 ? 's' : ''} pour être classé.
          </span>
        ) : !me.optedIn ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{ fontFamily: th.fontUI, fontWeight: 600, fontSize: 14.5 }}>Vous n&apos;apparaissez pas dans le classement.</span>
            <button onClick={onOptIn} disabled={optingIn}
              style={{ alignSelf: 'flex-start', background: th.onAccent, color: th.accent, border: 'none', borderRadius: 999, padding: '8px 16px', fontFamily: th.fontUI, fontWeight: 700, fontSize: 13.5, cursor: 'pointer', opacity: optingIn ? 0.6 : 1 }}>
              Apparaître dans le classement
            </button>
          </div>
        ) : (
          <span style={{ fontFamily: th.fontUI, fontWeight: 600, fontSize: 14.5 }}>Vous figurez au classement dès qu&apos;il y aura des joueurs classés.</span>
        )}
      </div>

      {/* Rangée KPI */}
      {decided > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          <StatTile label="Matchs" value={String(decided)} />
          <StatTile label="Victoires" value={`${rate} %`} sub={`${me.wins} V · ${me.losses} D`} meter={rate ?? 0} />
          <StatTile
            label="Série"
            value={streakN > 0 ? `${streakN} ${me.streak > 0 ? 'V' : 'D'}` : '—'}
            dot={streakN > 0 ? (me.streak > 0 ? ACCENTS.emerald : ACCENTS.coral) : undefined}
            sub={stats && stats.bestWinStreak > 0 ? `record ${stats.bestWinStreak} V` : undefined}
          />
        </div>
      )}

      {/* Détails de jeu (calculés depuis l'historique de matchs) */}
      {stats && stats.played > 0 && (
        <div style={{ background: th.surface, borderRadius: 16, padding: '14px 16px', boxShadow: `inset 0 0 0 1px ${th.line}`, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <span style={{ fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute }}>
            Votre jeu
          </span>

          {stats.form.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, width: 40, flexShrink: 0 }}>Forme</span>
              <span style={{ display: 'flex', gap: 6 }}>
                {stats.form.map((r, i) => {
                  const bg = r === 'W' ? ACCENTS.emerald : ACCENTS.coral;
                  return (
                    <span key={i} title={r === 'W' ? 'Victoire' : 'Défaite'} style={{
                      width: 24, height: 24, borderRadius: '50%', background: bg, color: inkOn(bg),
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 800,
                    }}>{r === 'W' ? 'V' : 'D'}</span>
                  );
                })}
              </span>
              <span style={{ fontFamily: th.fontUI, fontSize: 11.5, color: th.textFaint, marginLeft: 'auto' }}>5 derniers</span>
            </div>
          )}

          <SplitBar label="Sets" won={stats.setsWon} lost={stats.setsLost} />
          <SplitBar label="Jeux" won={stats.gamesWon} lost={stats.gamesLost} />

          {stats.favoritePartner && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, borderTop: `1px solid ${th.line}`, paddingTop: 12 }}>
              <Avatar firstName={stats.favoritePartner.firstName} lastName={stats.favoritePartner.lastName}
                avatarUrl={null} size={30} color={colorForSeed(stats.favoritePartner.userId)} />
              <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span style={{ fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700, color: th.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {stats.favoritePartner.firstName} {stats.favoritePartner.lastName}
                </span>
                <span style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute }}>
                  Partenaire favori · {stats.favoritePartner.played} match{stats.favoritePartner.played > 1 ? 's' : ''} · {stats.favoritePartner.wins} V ensemble
                </span>
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
