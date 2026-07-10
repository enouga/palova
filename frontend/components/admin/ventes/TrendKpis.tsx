'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { TrendModel } from '@/lib/caisse';

function Kpi({ label, value, accent }: { label: string; value: string; accent?: string }) {
  const { th } = useTheme();
  return (
    <div>
      <div style={{ fontFamily: th.fontMono, fontSize: 10, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', color: th.textFaint }}>{label}</div>
      <div style={{ fontFamily: th.fontDisplay, fontSize: 24, fontWeight: 700, letterSpacing: -0.4, color: accent ?? th.text }}>{value}</div>
    </div>
  );
}

const euros = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;

/** Bandeau KPI du jour + sparkline 7 jours. Purement présentationnel (le calcul vit dans trendSeries). */
export function TrendKpis({ collectedCents, outstanding, count, trend, weekday }: {
  collectedCents: number;
  outstanding: string;
  count: number;
  trend: TrendModel;
  weekday: string;
}) {
  const { th } = useTheme();
  const max = Math.max(1, ...trend.points.map((p) => p.cents));
  const lastKey = trend.points[trend.points.length - 1].key;
  const up = (trend.deltaPct ?? 0) >= 0;
  return (
    <div style={{ background: th.surface, borderRadius: 16, padding: 18, boxShadow: th.shadow, marginBottom: 18, display: 'flex', gap: 28, alignItems: 'center', flexWrap: 'wrap' }}>
      <Kpi label="Encaissé" value={euros(collectedCents / 100)} accent={th.accent} />
      <Kpi label="Reste dû (jour)" value={euros(Number(outstanding))} />
      <Kpi label="Encaissements" value={String(count)} />
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div aria-hidden style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 34 }}>
          {trend.points.map((p) => (
            <div key={p.key} title={p.key}
              style={{ width: 10, height: Math.max(4, Math.round((Math.max(0, p.cents) / max) * 34)), borderRadius: '3px 3px 0 0',
                background: p.key === lastKey ? th.accent : `${th.accent}40` }} />
          ))}
        </div>
        {trend.deltaPct !== null && (
          <div style={{ fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 600, color: up ? ACCENTS.cyan : ACCENTS.coral, whiteSpace: 'nowrap' }}>
            {up ? '+' : ''}{trend.deltaPct} %<div style={{ color: th.textFaint, fontWeight: 500 }}>vs {weekday} dernier</div>
          </div>
        )}
      </div>
    </div>
  );
}
