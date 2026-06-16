'use client';
import { RatingPoint } from '@/lib/api';

export function LevelHistoryChart({ points }: { points: RatingPoint[] }) {
  if (!points.length) return <p style={{ fontSize: 13, opacity: 0.6 }}>Pas encore d'historique — joue des matchs pour voir ta progression.</p>;
  const W = 280, H = 90, pad = 6;
  const n = points.length;
  const x = (i: number) => n === 1 ? W / 2 : pad + (i * (W - 2 * pad)) / (n - 1);
  const y = (lvl: number) => H - pad - (Math.max(0, Math.min(8, lvl)) / 8) * (H - 2 * pad);
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.level).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Courbe de progression du niveau">
      <path d={d} fill="none" stroke="#2563eb" strokeWidth="2" />
      {points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.level)} r="3" fill="#2563eb" />)}
    </svg>
  );
}
