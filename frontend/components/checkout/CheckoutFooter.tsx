'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { Btn } from '@/components/ui/atoms';

export interface CheckoutFooterProps {
  confirmLabel: string;
  busy: boolean;
  phase: 'holding' | 'held' | 'error';
  disabled: boolean;
  onConfirm: () => void;
  onExit: () => void;
}

/**
 * Pied d'action du chemin non-carte — port fidèle de BookingModal (lignes 766-776) :
 * « Abandonner » + bouton de confirmation dont le libellé dépend du mode de paiement.
 */
export function CheckoutFooter({ confirmLabel, busy, phase, disabled, onConfirm, onExit }: CheckoutFooterProps) {
  const { th } = useTheme();
  return (
    <div style={{ display: 'flex', gap: 11, marginTop: 20, paddingTop: 16, borderTop: `1px solid ${th.line}` }}>
      <Btn variant="surface" onClick={onExit} disabled={busy} style={{ flex: '0 0 38%' }}>Abandonner</Btn>
      <Btn icon="arrowR" onClick={onConfirm}
        disabled={phase !== 'held' || busy || disabled}
        style={{ flex: 1 }}>
        {confirmLabel}
      </Btn>
    </div>
  );
}
