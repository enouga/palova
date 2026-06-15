'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';

interface Props {
  clubId: string;
  reservationId: string;
  defaultAmount: number;
  token: string;
  onSuccess: () => void;
  onClose: () => void;
}

export default function NoShowChargeModal({ clubId, reservationId, defaultAmount, token, onSuccess, onClose }: Props) {
  const { th } = useTheme();
  const [amount, setAmount] = useState(String(defaultAmount));
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCharge = async () => {
    const parsed = parseFloat(amount);
    if (!parsed || parsed <= 0) { setError('Montant invalide.'); return; }
    setLoading(true);
    setError(null);
    try {
      await api.chargeNoShow(clubId, reservationId, { amount: parsed, note: note || undefined }, token);
      onSuccess();
    } catch (e: unknown) {
      const msg: Record<string, string> = {
        CARD_DECLINED: 'La carte a été refusée.',
        NO_CARD_ON_FILE: 'Aucune empreinte bancaire enregistrée pour ce joueur.',
      };
      const errMsg = e instanceof Error ? e.message : String(e);
      setError(msg[errMsg] ?? errMsg ?? 'Erreur lors du débit.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)' }}
      onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: th.bgElev, borderRadius: 18, padding: 24, width: '100%', maxWidth: 380, display: 'flex', flexDirection: 'column', gap: 16, boxShadow: th.shadow }}>
        <h3 style={{ margin: 0, fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 20, color: th.text }}>Facturer un no-show</h3>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>
          Montant (€)
          <input
            type="number" min="0.5" step="0.5" value={amount}
            onChange={(e) => setAmount(e.target.value)}
            style={{ border: `1px solid ${th.line}`, borderRadius: 6, padding: '6px 10px', fontSize: 15, background: th.bg, color: th.text, fontFamily: th.fontUI }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>
          Note (optionnel)
          <input
            value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="Ex. : No-show 14h"
            style={{ border: `1px solid ${th.line}`, borderRadius: 6, padding: '6px 10px', fontSize: 15, background: th.bg, color: th.text, fontFamily: th.fontUI }}
          />
        </label>
        {error && <p style={{ color: '#ff7a4d', fontSize: 13, margin: 0 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ border: `1px solid ${th.line}`, background: 'transparent', color: th.textMute, borderRadius: 9, padding: '8px 16px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 14 }}>Annuler</button>
          <button onClick={handleCharge} disabled={loading}
            style={{ border: 'none', background: '#ff7a4d', color: '#fff', borderRadius: 9, padding: '8px 16px', cursor: loading ? 'default' : 'pointer', fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Débit…' : `Facturer ${parseFloat(amount) > 0 ? parseFloat(amount).toFixed(2) + ' €' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
