'use client';
import { useTheme } from '@/lib/ThemeProvider';
import type { PastillesModel } from '@/lib/caisse';
import { SETTLED_COLOR } from './PaymentDots';

/**
 * Pastilles-initiales de paiement d'un bloc du planning : verte + initiales
 * quand la place est réglée, contour clair sinon, pointillés si la place est
 * vide. `compact` (petits créneaux) plafonne l'aperçu aux 2 premières places.
 */
export function PaymentInitials({ model, compact }: { model: PastillesModel; compact?: boolean }) {
  const { th } = useTheme();
  const seats = compact ? model.seats.slice(0, 2) : model.seats;
  const size = compact ? 12 : 15;
  const fontSize = compact ? 6.5 : 7.5;
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 3, height: size }}>
      {seats.map((seat, i) => seat ? (
        <span key={i} style={{
          width: size, height: size, borderRadius: '50%', boxSizing: 'border-box',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: th.fontUI, fontWeight: 800, fontSize, lineHeight: 1,
          background: seat.paid ? SETTLED_COLOR : th.surface,
          color: seat.paid ? '#fff' : th.textMute,
          border: seat.paid ? 'none' : `1px solid ${th.line}`,
        }}>{seat.initials}</span>
      ) : (
        <span key={i} style={{ width: size, height: size, borderRadius: '50%', boxSizing: 'border-box', border: `1px dashed ${th.textFaint}` }} />
      ))}
      {!compact && model.settled && <span style={{ fontSize: 9, fontWeight: 700, color: SETTLED_COLOR, lineHeight: 1 }}>✓</span>}
    </span>
  );
}
