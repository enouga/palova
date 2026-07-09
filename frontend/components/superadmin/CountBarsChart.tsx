'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { countBarsModel } from '@/lib/platformStats';

// Barres d'un compteur mensuel (nouveaux clubs, réservations…) en SVG pur, même
// langage visuel que MonthlyRevenueChart : SVG plein largeur à hauteur FIXE
// (preserveAspectRatio="none") + libellés de mois en HTML sous le graphe.
export function CountBarsChart({ series, unit }: {
  series: ReadonlyArray<{ month: string; count: number }>;
  unit?: string;
}) {
  const { th } = useTheme();

  if (series.length === 0) {
    return <p style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textFaint, margin: 0 }}>Aucune donnée.</p>;
  }

  const W = 320, H = 120, BAR_PX = 150;
  const { max, bars } = countBarsModel(series, W, H);
  const suffix = unit ? ` ${unit}` : '';
  const aria = `Évolution mensuelle — maximum ${max}${suffix}`;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={BAR_PX} preserveAspectRatio="none"
        role="img" aria-label={aria} style={{ display: 'block' }}>
        {bars.map((b) => (
          <rect key={b.month} x={b.x} y={b.y} width={b.w} height={b.h} rx={3} fill={th.accent}>
            <title>{`${b.label} : ${b.value}${suffix}`}</title>
          </rect>
        ))}
      </svg>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${bars.length}, 1fr)`, marginTop: 6 }}>
        {bars.map((b) => (
          <span key={b.month} style={{
            fontFamily: th.fontMono, fontSize: 10, color: th.textFaint, textAlign: 'center',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{b.label}</span>
        ))}
      </div>
    </div>
  );
}
