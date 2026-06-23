'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { heatmapModel, WEEKDAY_INITIALS, weekdayLabel } from '@/lib/memberStats';

// Heatmap des habitudes de jeu : 7 jours (lignes) × 24 heures (colonnes).
// Opacité de chaque case ∝ intensité ; couleur d'accent du club. SVG pur.
export function DayHourHeatmap({ matrix }: { matrix: number[][] }) {
  const { th } = useTheme();
  const { max, peak } = heatmapModel(matrix);

  if (max === 0) {
    return <p style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textFaint, margin: 0 }}>Pas encore d&apos;historique de jeu.</p>;
  }

  const ROWS = 7, COLS = 24;
  const cell = 12, gap = 2, padL = 30, padT = 0, padB = 14;
  const gridW = COLS * (cell + gap) - gap;
  const W = padL + gridW;
  const H = padT + ROWS * (cell + gap) - gap + padB;
  const aria = peak
    ? `Créneau préféré : ${weekdayLabel(peak.weekday)} ${peak.hour}h (${peak.count} réservations)`
    : 'Heatmap des réservations';

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={aria} style={{ display: 'block', maxWidth: W }}>
      {Array.from({ length: ROWS }).map((_, d) => (
        <text key={`r${d}`} x={0} y={padT + d * (cell + gap) + cell - 2}
          fontFamily={th.fontMono} fontSize={9} fill={th.textFaint}>{WEEKDAY_INITIALS[d]}</text>
      ))}
      {[0, 6, 12, 18, 23].map((h) => (
        <text key={`h${h}`} x={padL + h * (cell + gap) + cell / 2} y={H - 3} textAnchor="middle"
          fontFamily={th.fontMono} fontSize={8} fill={th.textFaint}>{h}h</text>
      ))}
      {matrix.map((row, d) =>
        row.map((count, h) => {
          const intensity = count / max;
          return (
            <rect key={`${d}-${h}`} x={padL + h * (cell + gap)} y={padT + d * (cell + gap)}
              width={cell} height={cell} rx={2}
              fill={count === 0 ? th.surface2 : th.accent}
              opacity={count === 0 ? 1 : 0.25 + intensity * 0.75}>
              {count > 0 && <title>{`${weekdayLabel(d + 1)} ${h}h : ${count}`}</title>}
            </rect>
          );
        }),
      )}
    </svg>
  );
}
