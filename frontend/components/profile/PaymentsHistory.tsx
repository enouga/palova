'use client';
import { useTheme } from '@/lib/ThemeProvider';
import type { MyPayment } from '@/lib/api';
import { eurosFromCents, paymentMethodLabel } from '@/lib/payments';

interface Props { payments: MyPayment[]; }

/** Historique de paiements du club courant (lecture seule, 100 derniers). */
export function PaymentsHistory({ payments }: Props) {
  const { th } = useTheme();
  const faint: React.CSSProperties = { fontFamily: th.fontUI, fontSize: 13, color: th.textFaint };

  if (payments.length === 0) return <span style={faint}>Aucun paiement pour ce club.</span>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {payments.map((p) => (
        <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, background: th.surface2, borderRadius: 12, padding: '11px 14px' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, color: th.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.label}</div>
            <div style={faint}>
              {new Date(p.date).toLocaleDateString('fr-FR')} · {paymentMethodLabel(p.method)}
              {p.refundedCents > 0 && ` · remboursé ${eurosFromCents(p.refundedCents)}`}
            </div>
          </div>
          <span style={{ fontFamily: th.fontUI, fontSize: 14, fontWeight: 700, color: th.text, flexShrink: 0 }}>{eurosFromCents(p.amountCents)}</span>
        </div>
      ))}
    </div>
  );
}
