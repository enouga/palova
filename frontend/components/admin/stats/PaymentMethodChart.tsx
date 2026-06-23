'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { PLAYER_COLORS } from '@/lib/playerColors';
import { donutSegments, euros } from '@/lib/memberStats';

// Donut SVG des encaissements par méthode (stroke-dasharray) + légende.
// Couleurs stables de la palette joueur ; départ à 12 h (rotation -90°).
export function PaymentMethodChart({ byMethod }: { byMethod: Record<string, string> }) {
  const { th } = useTheme();
  const R = 52, STROKE = 16, SIZE = R * 2 + STROKE;
  const { total, segments } = donutSegments(byMethod, R);

  if (total === 0) {
    return <p style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textFaint, margin: 0 }}>Aucun encaissement.</p>;
  }

  const color = (i: number) => PLAYER_COLORS[i % PLAYER_COLORS.length];

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} role="img" aria-label="Répartition des encaissements par méthode">
        <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
          <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke={th.surface2} strokeWidth={STROKE} />
          {segments.map((s, i) => (
            <circle key={s.key} cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none"
              stroke={color(i)} strokeWidth={STROKE}
              strokeDasharray={s.dashArray} strokeDashoffset={s.dashOffset}>
              <title>{`${s.label} : ${euros(s.value)}`}</title>
            </circle>
          ))}
        </g>
        <text x={SIZE / 2} y={SIZE / 2} textAnchor="middle" dominantBaseline="central"
          fontFamily={th.fontDisplay} fontSize={16} fontWeight={600} fill={th.text}>{euros(total)}</text>
      </svg>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {segments.map((s, i) => (
          <li key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: th.fontUI, fontSize: 13, color: th.text }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: color(i), flexShrink: 0 }} />
            <span style={{ color: th.textMute }}>{s.label}</span>
            <span style={{ marginLeft: 'auto', fontWeight: 600 }}>{euros(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
