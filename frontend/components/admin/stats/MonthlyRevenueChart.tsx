'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { revenueChartModel, euros } from '@/lib/memberStats';

// Barres « CA par mois » en SVG pur, auto-zoomées sur [0, max]. Le SVG remplit la
// largeur à hauteur FIXE (preserveAspectRatio="none" — sinon la hauteur serait
// verrouillée à la largeur du conteneur et le graphe explosait dans une carte
// large). Les libellés de mois sont rendus en HTML sous le graphe pour ne pas être
// étirés par le stretch horizontal.
export function MonthlyRevenueChart({ series }: { series: ReadonlyArray<{ month: string; net: string }> }) {
  const { th } = useTheme();

  if (series.length === 0) {
    return <p style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textFaint, margin: 0 }}>Pas encore d&apos;encaissement.</p>;
  }

  const W = 320, H = 120, BAR_PX = 150;
  const { max, bars } = revenueChartModel(series, W, H);
  const aria = `Chiffre d'affaires par mois — maximum ${euros(max)}`;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={BAR_PX} preserveAspectRatio="none"
        role="img" aria-label={aria} style={{ display: 'block' }}>
        {bars.map((b) => (
          <rect key={b.month} x={b.x} y={b.y} width={b.w} height={b.h} rx={3} fill={th.accent}>
            <title>{`${b.label} : ${euros(b.value)}`}</title>
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
