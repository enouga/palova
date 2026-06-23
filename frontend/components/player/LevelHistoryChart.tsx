'use client';
import { RatingPoint } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { summarizeHistory, fmtDelta } from '@/lib/levelHistory';

export function LevelHistoryChart({ points }: { points: RatingPoint[] }) {
  const { th } = useTheme();
  const { state, count, delta, min, max } = summarizeHistory(points);

  if (state === 'empty') {
    return <p style={{ fontSize: 13, opacity: 0.6 }}>Pas encore d&apos;historique — joue des matchs pour voir ta progression.</p>;
  }

  const matchs = `${count} match${count > 1 ? 's' : ''}`;

  // Plat : aucune courbe (l'auto-zoom amplifierait du bruit en fausse montagne).
  if (state === 'flat') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={chip(th.surface2, th.textMute, th.fontUI)}>– stable</span>
        <span style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textFaint }}>{matchs}</span>
      </div>
    );
  }

  // Mouvement réel : puce de delta + sparkline auto-zoomée sur [min, max] (et non 0→8).
  const up = delta >= 0.05;
  const down = delta <= -0.05;
  const arrow = up ? '▲' : down ? '▼' : '→';
  const deltaChip = up
    ? chip('#dcf3e3', '#15803d', th.fontUI)
    : down
      ? chip('#fde2e2', '#b91c1c', th.fontUI)
      : chip(th.surface2, th.textMute, th.fontUI);

  const W = 280, H = 48, padX = 6, padY = 6;
  const n = points.length;
  const pad = Math.max(0.1, (max - min) * 0.15);
  const lo = min - pad, hi = max + pad;
  const x = (i: number) => (n === 1 ? W / 2 : padX + (i * (W - 2 * padX)) / (n - 1));
  const y = (lvl: number) => H - padY - ((lvl - lo) / (hi - lo)) * (H - 2 * padY);
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.level).toFixed(1)}`).join(' ');
  const last = points[n - 1];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={deltaChip}>{arrow} {fmtDelta(delta)}</span>
        <span style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textFaint }}>{matchs}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Courbe de progression du niveau">
        <path d={d} fill="none" stroke="#2563eb" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(n - 1)} cy={y(last.level)} r="3" fill="#2563eb" />
      </svg>
    </div>
  );
}

function chip(bg: string, color: string, font: string): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    background: bg, color, borderRadius: 999, padding: '3px 9px',
    fontFamily: font, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
  };
}
