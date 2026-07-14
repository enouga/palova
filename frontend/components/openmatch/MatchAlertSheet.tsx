'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { ClubDetail } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';

interface Props {
  club: Pick<ClubDetail, 'slug' | 'timezone'>;
  token: string;
  initial: { date: string; from: string; to: string };
  onClose: () => void;
  onCreated: () => void;
}

const ALERT_ERRORS: Record<string, string> = {
  ALERT_LIMIT_REACHED: 'Vous avez déjà 5 alertes actives. Supprimez-en une pour en créer une nouvelle.',
  ALERT_WINDOW_INVALID: 'Choisissez une plage horaire valide, dans le futur.',
  MEMBERSHIP_BLOCKED: 'Votre accès à ce club est suspendu.',
  CLUB_NOT_FOUND: 'Club introuvable.',
};

export function MatchAlertSheet({ club, token, initial, onClose, onCreated }: Props) {
  const { th } = useTheme();
  const [date, setDate] = useState(initial.date);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await api.createMatchAlert(club.slug, { date, from, to }, token);
      onCreated();
    } catch (e) {
      setError(ALERT_ERRORS[(e as Error).message] ?? 'Impossible de créer l’alerte pour le moment.');
    } finally { setBusy(false); }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '9px 10px', borderRadius: 10, border: `1px solid ${th.line}`,
    background: th.surface, color: th.text, fontFamily: th.fontUI, fontSize: 14, boxSizing: 'border-box',
  };
  const labelStyle: React.CSSProperties = {
    display: 'block', fontFamily: th.fontUI, fontSize: 12, color: th.textMute, marginBottom: 4,
  };

  return (
    <div role="dialog" aria-label="Créer une alerte" aria-modal="true" onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 60, display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: th.bg, width: '100%', maxWidth: 520, borderRadius: '0 0 18px 18px', padding: 20, boxSizing: 'border-box' }}>
        <h2 style={{ fontFamily: th.fontDisplay, fontSize: 20, color: th.text, margin: '0 0 12px' }}>Créer une alerte</h2>
        <p style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, margin: '0 0 14px', lineHeight: 1.45 }}>
          On vous prévient dès qu’une partie à votre niveau s’ouvre — ou libère une place — sur ce créneau.
        </p>

        <label style={labelStyle} htmlFor="alert-date">Jour</label>
        <input id="alert-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />

        <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <label style={labelStyle} htmlFor="alert-from">De</label>
            <input id="alert-from" type="time" value={from} onChange={(e) => setFrom(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <label style={labelStyle} htmlFor="alert-to">À</label>
            <input id="alert-to" type="time" value={to} onChange={(e) => setTo(e.target.value)} style={inputStyle} />
          </div>
        </div>

        {error && (
          <div role="alert" style={{ marginTop: 12, background: th.accent, color: th.onAccent, borderRadius: 10, padding: '9px 12px', fontFamily: th.fontUI, fontSize: 13 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button type="button" onClick={onClose} disabled={busy}
            style={{ flex: 1, padding: '10px 14px', borderRadius: 999, border: `1px solid ${th.line}`, background: 'transparent', color: th.text, fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, cursor: busy ? 'default' : 'pointer' }}>
            Annuler
          </button>
          <button type="button" onClick={submit} disabled={busy}
            style={{ flex: 2, padding: '10px 14px', borderRadius: 999, border: 'none', background: th.accent, color: th.onAccent, fontFamily: th.fontUI, fontSize: 14, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1 }}>
            {busy ? 'Création…' : 'Créer l’alerte'}
          </button>
        </div>
      </div>
    </div>
  );
}
