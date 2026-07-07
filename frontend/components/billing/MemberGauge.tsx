'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { PLATFORM_TIERS } from '@/lib/platformTiers';
import { HERO_GRADIENT, HERO_INK, HERO_INK_MUTED } from '@/components/agenda/AgendaHero';

// Encre bleue fixe de la jauge (lisible sur la brume bleue dans les 2 thèmes).
const GAUGE_FILL = '#2c4668';

/**
 * Position (%) sur la jauge SEGMENTÉE : chaque palier occupe 20 % de la largeur,
 * la position est proportionnelle à l'intérieur de son segment (au-delà de 800,
 * progression douce vers 100 %). Échelle non linéaire mais lisible : les seuils
 * tombent pile sur les frontières de segments.
 */
export function gaugePercent(count: number): number {
  for (let i = 0; i < PLATFORM_TIERS.length; i++) {
    const t = PLATFORM_TIERS[i];
    if (t.maxMembers === null) {
      return 80 + Math.min(1, Math.max(0, (count - 800) / 800)) * 20;
    }
    const min = i === 0 ? 0 : (PLATFORM_TIERS[i - 1].maxMembers as number);
    if (count <= t.maxMembers) return i * 20 + ((count - min) / (t.maxMembers - min)) * 20;
  }
  return 100;
}

/** Jauge segmentée par palier, sur fond brume bleue (encre fixe). Partagée admin ↔ superadmin. */
export function MemberGauge({ count, countedAt }: { count: number; countedAt: string | null }) {
  const { th } = useTheme();
  const pct = gaugePercent(count);
  const boundaries = [20, 40, 60, 80]; // frontières de segments (50/150/400/800)
  const boundaryLabels = ['50', '150', '400', '800'];
  return (
    <section style={{
      background: HERO_GRADIENT, borderRadius: 18, padding: '22px 24px', marginBottom: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: th.fontDisplay, fontSize: 46, fontWeight: 700, color: HERO_INK, lineHeight: 1 }}>
          {count}
        </span>
        <span style={{ fontFamily: th.fontUI, fontSize: 13.5, color: HERO_INK_MUTED, fontWeight: 600 }}>
          membres actifs sur les 90 derniers jours
        </span>
      </div>

      <div style={{ position: 'relative', height: 12, borderRadius: 7, background: 'rgba(24,21,14,0.10)', marginTop: 18 }}>
        {/* Remplissage */}
        <div style={{
          position: 'absolute', top: 0, bottom: 0, left: 0, width: `${pct}%`,
          borderRadius: 7, background: GAUGE_FILL, transition: 'width .4s ease',
        }} />
        {/* Frontières de paliers */}
        {boundaries.map((b) => (
          <div key={b} style={{
            position: 'absolute', left: `${b}%`, top: -4, bottom: -4, width: 2,
            background: 'rgba(24,21,14,0.28)', borderRadius: 1,
          }} />
        ))}
        {/* Curseur */}
        <div aria-hidden style={{
          position: 'absolute', left: `${pct}%`, top: '50%', transform: 'translate(-50%, -50%)',
          width: 20, height: 20, borderRadius: '50%', background: '#fff',
          border: `4px solid ${GAUGE_FILL}`, boxShadow: '0 2px 8px rgba(24,21,14,0.25)',
        }} />
      </div>

      {/* Libellés des seuils, alignés sur les frontières */}
      <div style={{ position: 'relative', height: 16, marginTop: 7 }}>
        <span style={{ position: 'absolute', left: 0, fontFamily: th.fontUI, fontSize: 11.5, color: HERO_INK_MUTED }}>0</span>
        {boundaries.map((b, i) => (
          <span key={b} style={{
            position: 'absolute', left: `${b}%`, transform: 'translateX(-50%)',
            fontFamily: th.fontUI, fontSize: 11.5, color: HERO_INK_MUTED, fontWeight: 600,
          }}>{boundaryLabels[i]}</span>
        ))}
        <span style={{ position: 'absolute', right: 0, fontFamily: th.fontUI, fontSize: 11.5, color: HERO_INK_MUTED }}>800+</span>
      </div>

      {countedAt && (
        <div style={{ marginTop: 10, fontFamily: th.fontUI, fontSize: 11.5, color: HERO_INK_MUTED }}>
          Compté le {new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' }).format(new Date(countedAt))}
        </div>
      )}
    </section>
  );
}
