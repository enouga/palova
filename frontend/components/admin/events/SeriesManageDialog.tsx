'use client';
import { useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { Icon } from '@/components/ui/Icon';
import { DateField } from '@/components/ui/DateField';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

interface SeriesManageDialogProps {
  onExtend: (endDate: string) => void;
  onCancelSeries: () => void;
  onClose: () => void;
}

/** Petit panneau « Gérer la série » (prolonger / annuler en bloc) posé sur une carte AgendaAdminCard. */
export function SeriesManageDialog({ onExtend, onCancelSeries, onClose }: SeriesManageDialogProps) {
  const { th } = useTheme();
  const [newEndDate, setNewEndDate] = useState('');
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const btn = { border: 'none', cursor: 'pointer', background: th.accent, color: th.onAccent, borderRadius: 10, padding: '9px 14px', fontFamily: th.fontUI, fontWeight: 700, fontSize: 13.5 };
  const ghost = { border: `1px solid ${th.line}`, cursor: 'pointer', background: 'transparent', color: th.danger, borderRadius: 9, padding: '9px 14px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700 };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: th.bgElev, borderRadius: 18, padding: 20, width: 340, maxWidth: '92vw' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 17, color: th.text }}>Gérer la série</div>
          <button aria-label="Fermer" onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}>
            <Icon name="x" size={18} color={th.textMute} />
          </button>
        </div>

        <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginBottom: 6 }}>Nouvelle date de fin</div>
        <DateField value={newEndDate} onChange={setNewEndDate} placeholder="date de fin" ariaLabel="Nouvelle date de fin" />
        <button
          onClick={() => newEndDate && onExtend(newEndDate)}
          disabled={!newEndDate}
          style={{ ...btn, marginTop: 10, width: '100%', opacity: newEndDate ? 1 : 0.5 }}
        >
          Prolonger
        </button>

        <button onClick={() => setConfirmingCancel(true)} style={{ ...ghost, marginTop: 18, width: '100%' }}>
          Annuler la série
        </button>
      </div>

      {confirmingCancel && (
        <ConfirmDialog
          title="Annuler toute la série ?"
          message="Toutes les occurrences futures seront annulées, y compris celles qui ont déjà des inscrits — les inscrits seront notifiés par email et remboursés si besoin."
          confirmLabel="Confirmer"
          onConfirm={() => { setConfirmingCancel(false); onCancelSeries(); }}
          onCancel={() => setConfirmingCancel(false)}
        />
      )}
    </div>
  );
}
