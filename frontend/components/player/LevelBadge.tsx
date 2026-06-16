'use client';
import { MyRating } from '@/lib/api';

// Pastille niveau réutilisable (profil v1 ; pastilles joueurs au Lot 3).
export function LevelBadge({ rating }: { rating: MyRating }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold"
      style={{ background: 'rgba(0,0,0,0.06)' }}
    >
      <strong>{rating.level.toFixed(1)}</strong>
      <span className="opacity-70">{rating.tier}</span>
      {rating.isProvisional && (
        <span className="rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase" style={{ background: '#ffb020', color: '#1a1a1a' }}>
          en calibrage
        </span>
      )}
    </span>
  );
}
