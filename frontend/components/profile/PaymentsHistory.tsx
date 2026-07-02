'use client';
import { useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import type { MyPayment } from '@/lib/api';
import { eurosFromCents, paymentMethodLabel } from '@/lib/payments';
import { Icon } from '@/components/ui/Icon';
import { AccountEmpty } from './AccountEmpty';

interface Props { payments: MyPayment[]; }

// Nombre de paiements affichés avant de replier le reste derrière « Voir tout ».
const INITIAL_COUNT = 5;

/** Historique de paiements du club courant (lecture seule, 100 derniers). */
export function PaymentsHistory({ payments }: Props) {
  const { th } = useTheme();
  const [expanded, setExpanded] = useState(false);

  if (payments.length === 0) {
    return <AccountEmpty icon="euro" title="Aucun paiement"
      hint="Vos règlements dans ce club s’afficheront ici." />;
  }

  const faint: React.CSSProperties = { fontFamily: th.fontUI, fontSize: 12.5, color: th.textFaint };
  const visible = expanded ? payments : payments.slice(0, INITIAL_COUNT);
  const hasMore = payments.length > INITIAL_COUNT;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {visible.map((p) => (
        <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: th.surface2, borderRadius: 13, padding: '11px 13px' }}>
          <span aria-hidden="true" style={{
            width: 36, height: 36, flexShrink: 0, borderRadius: 10, background: th.surface,
            boxShadow: `inset 0 0 0 1px ${th.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name="euro" size={17} color={th.textMute} />
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, color: th.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.label}</div>
            <div style={faint}>
              {new Date(p.date).toLocaleDateString('fr-FR')} · {paymentMethodLabel(p.method)}
              {p.refundedCents > 0 && ` · remboursé ${eurosFromCents(p.refundedCents)}`}
            </div>
          </div>
          <span style={{ fontFamily: th.fontUI, fontSize: 14.5, fontWeight: 700, color: th.text, flexShrink: 0 }}>{eurosFromCents(p.amountCents)}</span>
        </div>
      ))}

      {hasMore && (
        <button type="button" onClick={() => setExpanded((v) => !v)}
          style={{
            alignSelf: 'center', marginTop: 2, cursor: 'pointer', background: 'none', border: 'none',
            fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.textMute, padding: '6px 10px',
          }}>
          {expanded ? 'Réduire ▴' : `Voir tout (${payments.length}) ▾`}
        </button>
      )}
    </div>
  );
}
