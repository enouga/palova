'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { revenueChartModel, euros } from '@/lib/memberStats';

// Barres « CA par mois » en SVG pur, auto-zoomées sur [0, max]. Même langage
// visuel que LevelHistoryChart (viewBox + largeur 100 %, couleurs du thème).
export function MonthlyRevenueChart({ series }: { series: ReadonlyArray<{ month: string; net: string }> }) {
  const { th } = useTheme();

  if (series.length === 0) {
    return <p style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textFaint, margin: 0 }}>Pas encore d&apos;encaissement.</p>;
  }

  const W = 320, H = 120, LABEL_H = 18;
  const { max, bars } = revenueChartModel(series, W, H);
  const aria = `Chiffre d'affaires par mois — maximum ${euros(max)}`;

  return (
    <svg viewBox={`0 0 ${W} ${H + LABEL_H}`} width="100%" role="img" aria-label={aria} style={{ display: 'block' }}>
      {bars.map((b) => (
        <g key={b.month}>
          <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={3} fill={th.accent}>
            <title>{`${b.label} : ${euros(b.value)}`}</title>
          </rect>
          {b.w >= 14 && (
            <text x={b.x + b.w / 2} y={H + LABEL_H - 5} textAnchor="middle"
              fontFamily={th.fontMono} fontSize={9} fill={th.textFaint}>{b.label}</text>
          )}
        </g>
      ))}
    </svg>
  );
}
