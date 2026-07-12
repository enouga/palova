'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { fmtEuros, popoverPosition } from '@/lib/caisse';
import type { PastillesModel, PopoverAnchor } from '@/lib/caisse';
import { SETTLED_COLOR } from '@/components/admin/PaymentDots';

const PANEL_W = 230;

/** Panneau détaillé (qui a payé, combien) affiché au survol prolongé d'un bloc du planning. */
export function TilePaymentPopover({ model, anchor }: { model: PastillesModel; anchor: PopoverAnchor }) {
  const { th } = useTheme();
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
  const estimatedPanelHeight = 54 + model.seats.length * 20;
  const { left, top } = popoverPosition(anchor, viewportWidth, PANEL_W, 8, viewportHeight, estimatedPanelHeight);
  const remaining = model.totalDueCents - model.totalPaidCents;
  return (
    <div role="tooltip" style={{
      position: 'fixed', left, top, zIndex: 45, width: PANEL_W, boxSizing: 'border-box',
      background: th.surface, borderRadius: 10, boxShadow: th.shadow, border: `1px solid ${th.line}`,
      padding: '9px 12px', fontFamily: th.fontUI, fontSize: 12, pointerEvents: 'none',
    }}>
      {model.seats.map((seat, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '2px 0' }}>
          {seat ? (
            <>
              <span style={{ color: seat.paid ? th.text : '#c0392b' }}>{seat.paid ? '✓' : '○'} {seat.name}</span>
              <span style={{ fontFamily: th.fontMono, fontSize: 11, color: seat.paid ? th.textMute : '#c0392b' }}>
                {seat.paid ? fmtEuros(seat.paidCents) : `reste ${fmtEuros(seat.outstandingCents)}`}
              </span>
            </>
          ) : (
            <span style={{ color: th.textFaint }}>○ place libre</span>
          )}
        </div>
      ))}
      <div style={{ marginTop: 5, paddingTop: 5, borderTop: `1px solid ${th.line}`, fontWeight: 700 }}>
        {model.settled
          ? <span style={{ color: SETTLED_COLOR }}>✓ Soldé</span>
          : <span>Payé {fmtEuros(model.totalPaidCents)} / {fmtEuros(model.totalDueCents)} · <span style={{ color: '#c0392b' }}>reste {fmtEuros(remaining)}</span></span>}
      </div>
    </div>
  );
}
