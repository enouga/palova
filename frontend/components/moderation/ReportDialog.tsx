'use client';
import { useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { Btn } from '@/components/ui/atoms';
import { ReportReason } from '@/lib/api';

const REASONS: { value: ReportReason; label: string }[] = [
  { value: 'HARASSMENT', label: 'Harcèlement' },
  { value: 'ILLEGAL', label: 'Contenu illicite' },
  { value: 'SPAM', label: 'Spam' },
  { value: 'OTHER', label: 'Autre' },
];

export function ReportDialog({ onSubmit, onCancel }: {
  onSubmit: (reason: ReportReason, detail: string) => Promise<void>;
  onCancel: () => void;
}) {
  const { th } = useTheme();
  const [reason, setReason] = useState<ReportReason>('HARASSMENT');
  const [detail, setDetail] = useState('');
  const [phase, setPhase] = useState<'form' | 'sending' | 'sent'>('form');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setPhase('sending'); setError(null);
    try {
      await onSubmit(reason, detail.trim());
      setPhase('sent');
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg === 'RATE_LIMITED' ? 'Trop de signalements, réessayez plus tard.' : 'Échec de l\'envoi, réessayez.');
      setPhase('form');
    }
  };

  return (
    <div onClick={(e) => e.stopPropagation()}
      style={{ position: 'fixed', inset: 0, zIndex: 96, display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', pointerEvents: 'auto' }}>
      <div onClick={phase === 'sending' ? undefined : onCancel} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)' }} />
      <div role="dialog" aria-modal="true" aria-label="Signaler ce message" style={{ position: 'relative', width: '100%', maxWidth: 460, margin: '0 auto', background: th.bgElev, borderRadius: '0 0 24px 24px', padding: '20px 20px 28px', boxShadow: '0 10px 40px rgba(0,0,0,0.3)' }}>
        {phase === 'sent' ? (
          <>
            <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 22, color: th.text }}>Signalement envoyé</div>
            <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, marginTop: 8 }}>
              Merci, il sera examiné rapidement.
            </div>
            <Btn variant="surface" onClick={onCancel} style={{ marginTop: 20, width: '100%' }}>Fermer</Btn>
          </>
        ) : (
          <>
            <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 22, color: th.text }}>Signaler ce message</div>
            <div role="radiogroup" aria-label="Motif" style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 14 }}>
              {REASONS.map((r) => (
                <button key={r.value} type="button" role="radio" aria-checked={reason === r.value}
                  onClick={() => setReason(r.value)}
                  style={{
                    textAlign: 'left', border: `1px solid ${reason === r.value ? th.accent : th.line}`,
                    background: reason === r.value ? `${th.accent}1a` : th.surface, borderRadius: 12,
                    padding: '10px 14px', fontFamily: th.fontUI, fontSize: 14, color: th.text, cursor: 'pointer',
                  }}>
                  {r.label}
                </button>
              ))}
            </div>
            <textarea value={detail} onChange={(e) => setDetail(e.target.value.slice(0, 500))}
              placeholder="Précisions (optionnel)" rows={3}
              style={{ width: '100%', marginTop: 12, border: `1px solid ${th.line}`, borderRadius: 12, padding: '10px 12px', resize: 'vertical', fontFamily: th.fontUI, fontSize: 14, background: th.surface, color: th.text }} />
            {error && <div style={{ marginTop: 8, fontFamily: th.fontUI, fontSize: 12.5, color: th.danger }}>{error}</div>}
            <div style={{ display: 'flex', gap: 11, marginTop: 18 }}>
              <Btn variant="surface" onClick={onCancel} disabled={phase === 'sending'} style={{ flex: '0 0 42%' }}>Annuler</Btn>
              <Btn variant="danger" onClick={submit} disabled={phase === 'sending'} style={{ flex: 1 }}>
                {phase === 'sending' ? '…' : 'Envoyer le signalement'}
              </Btn>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
