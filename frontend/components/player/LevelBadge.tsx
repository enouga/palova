'use client';
import { MyRating } from '@/lib/api';
import { useLevelSystemEnabled } from '@/lib/useLevelSystem';
import { useTheme } from '@/lib/ThemeProvider';
import { inkOn } from '@/lib/theme';
import { ReliabilityMeter } from './ReliabilityMeter';

// Pastille niveau réutilisable (profil v1 ; pastilles joueurs au Lot 3).
export function LevelBadge({ rating }: { rating: MyRating }) {
  if (!useLevelSystemEnabled()) return null;
  const { th } = useTheme();
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 999, padding: '4px 12px', fontSize: 14, fontWeight: 600, background: th.surface2 }}>
      {rating.level != null ? (
        <>
          <strong>{rating.level.toFixed(1)}</strong>
          <span style={{ opacity: 0.7 }}>{rating.tier}</span>
        </>
      ) : (
        <span style={{ opacity: 0.7 }}>Non calibré</span>
      )}
      <ReliabilityMeter pct={rating.reliability} />
      {rating.isProvisional && (
        <span style={{ borderRadius: 999, padding: '2px 6px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', background: th.warning, color: inkOn(th.warning) }}>
          en calibrage
        </span>
      )}
    </span>
  );
}
