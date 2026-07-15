'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { TrendModel } from '@/lib/caisse';
import { HERO_GRADIENT, HERO_INK, HERO_INK_MUTED } from '@/components/agenda/AgendaHero';

// Marques bleu encre fixes sur la brume (même convention que MemberGauge) ;
// delta sur pastille blanche → encres foncées lisibles (pas les accents vifs).
const BAR_FILL = '#2c4668';
const BAR_FAINT = 'rgba(44,70,104,0.26)';
const UP_INK = '#1f7a4f';
const DOWN_INK = '#b23c17';

const euros = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;

function MiniKpi({ label, value }: { label: string; value: string }) {
  const { th } = useTheme();
  return (
    <div>
      <div style={{ fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: HERO_INK_MUTED }}>{label}</div>
      <div style={{ fontFamily: th.fontDisplay, fontSize: 22, fontWeight: 700, letterSpacing: -0.4, color: HERO_INK, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

/** Bandeau KPI du jour sur brume bleue + sparkline 7 jours. Purement présentationnel (le calcul vit dans trendSeries). */
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
    <div style={{ background: HERO_GRADIENT, borderRadius: 18, padding: '18px 22px', marginBottom: 18, display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
      {/* Encaissé — la stat vedette du jour */}
      <div>
        <div style={{ fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: HERO_INK_MUTED }}>Encaissé</div>
        <div style={{ fontFamily: th.fontDisplay, fontSize: 38, fontWeight: 700, letterSpacing: -0.9, lineHeight: 1.08, color: HERO_INK, fontVariantNumeric: 'tabular-nums' }}>
          {euros(collectedCents / 100)}
        </div>
      </div>
      <div aria-hidden style={{ width: 1, alignSelf: 'stretch', background: 'rgba(24,21,14,0.13)', margin: '4px 0' }} />
      <MiniKpi label="Reste dû (jour)" value={euros(Number(outstanding))} />
      <MiniKpi label="Encaissements" value={String(count)} />

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14 }}>
        <div aria-hidden style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 44 }}>
          {trend.points.map((p) => (
            <div key={p.key} title={p.key}
              style={{ width: 12, height: Math.max(5, Math.round((Math.max(0, p.cents) / max) * 44)), borderRadius: '4px 4px 0 0',
                background: p.key === lastKey ? BAR_FILL : BAR_FAINT }} />
          ))}
        </div>
        {trend.deltaPct !== null && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ display: 'inline-flex', background: '#fff', borderRadius: 999, padding: '4px 11px', fontFamily: th.fontUI, fontSize: 12, fontWeight: 700, color: up ? UP_INK : DOWN_INK, whiteSpace: 'nowrap', boxShadow: '0 1px 3px rgba(24,21,14,0.10)' }}>
              {up ? '▲ +' : '▼ '}{trend.deltaPct} %
            </div>
            <div style={{ marginTop: 4, fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 600, color: HERO_INK_MUTED, whiteSpace: 'nowrap' }}>vs {weekday} dernier</div>
          </div>
        )}
      </div>
    </div>
  );
}
