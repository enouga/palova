'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { countBarsModel } from '@/lib/platformStats';

// Barres d'un compteur mensuel (nouveaux clubs, réservations…) en SVG pur, même
// langage visuel que MonthlyRevenueChart (viewBox, couleurs du thème, <title>).
export function CountBarsChart({ series, unit }: {
  series: ReadonlyArray<{ month: string; count: number }>;
  unit?: string;
}) {
  const { th } = useTheme();

  if (series.length === 0) {
    return <p style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textFaint, margin: 0 }}>Aucune donnée.</p>;
  }

  const W = 320, H = 120, LABEL_H = 18;
  const { max, bars } = countBarsModel(series, W, H);
  const suffix = unit ? ` ${unit}` : '';
  const aria = `Évolution mensuelle — maximum ${max}${suffix}`;

  return (
    <svg viewBox={`0 0 ${W} ${H + LABEL_H}`} width="100%" role="img" aria-label={aria} style={{ display: 'block' }}>
      {bars.map((b) => (
        <g key={b.month}>
          <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={3} fill={th.accent}>
            <title>{`${b.label} : ${b.value}${suffix}`}</title>
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
