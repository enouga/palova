'use client';
import { useEffect, useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { Icon } from '@/components/ui/Icon';
import { TimePicker } from '@/components/ui/TimePicker';
import { HERO_GRADIENT, HERO_INK, HERO_INK_MUTED } from '@/components/agenda/AgendaHero';
import type { OffPeakRange } from '@/lib/api';

interface Props {
  dayLabel: string;
  /** Plage éditée (édition) ou null (ajout → défaut 9h00–12h00). */
  initial: OffPeakRange | null;
  onClose: () => void;
  onSave: (r: OffPeakRange) => void;
}

const toHHMM = (h: number, m?: number) => `${String(h).padStart(2, '0')}:${String(m ?? 0).padStart(2, '0')}`;
const fromHHMM = (s: string): { h: number; m: number } => {
  const [h, m] = s.split(':').map(Number);
  return { h: h || 0, m: m || 0 };
};

/** Feuille « brume bleue » d'édition d'une plage creuse : deux TimePicker De/À. */
export function OffPeakRangeSheet({ dayLabel, initial, onClose, onSave }: Props) {
  const { th } = useTheme();
  const [from, setFrom] = useState(toHHMM(initial?.start ?? 9, initial?.startMin));
  const [to, setTo] = useState(toHHMM(initial?.end ?? 12, initial?.endMin));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = () => {
    const a = fromHHMM(from);
    const b = fromHHMM(to);
    onSave({ start: a.h, startMin: a.m, end: b.h, endMin: b.m });
  };

  const timeLabel: React.CSSProperties = { fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, color: th.textMute, minWidth: 24 };

  return (
    <div role="dialog" aria-label={`Plage creuse — ${dayLabel}`} aria-modal="true" onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(12,10,6,.5)', backdropFilter: 'blur(2px)', zIndex: 60, display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: th.bg, width: '100%', maxWidth: 440, borderRadius: '0 0 22px 22px', boxShadow: th.shadow, boxSizing: 'border-box' }}>
        <div style={{ background: HERO_GRADIENT, padding: '18px 22px', display: 'flex', gap: 13, alignItems: 'center' }}>
          <div style={{ flexShrink: 0, width: 40, height: 40, borderRadius: 12, background: 'rgba(255,255,255,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="clock" size={20} color={HERO_INK} />
          </div>
          <div>
            <h2 style={{ fontFamily: th.fontDisplay, fontSize: 19, fontWeight: 700, color: HERO_INK, margin: 0 }}>Heures creuses — {dayLabel}</h2>
            <p style={{ fontFamily: th.fontUI, fontSize: 12.5, color: HERO_INK_MUTED, margin: '3px 0 0' }}>Tarif réduit sur cette plage.</p>
          </div>
        </div>
        <div style={{ padding: '20px 22px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <TimePicker value={from} onChange={setFrom} minuteChips={[]} leading={<span style={timeLabel}>De</span>} />
          <TimePicker value={to} onChange={setTo} minuteChips={[]} leading={<span style={timeLabel}>À</span>} />
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <button type="button" onClick={onClose}
              style={{ flex: 1, padding: '11px 14px', borderRadius: 999, border: `1px solid ${th.line}`, background: 'transparent', color: th.text, fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              Annuler
            </button>
            <button type="button" onClick={save}
              style={{ flex: 2, padding: '11px 14px', borderRadius: 999, border: 'none', background: th.accent, color: th.onAccent, fontFamily: th.fontUI, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
              {initial ? 'Enregistrer' : 'Ajouter'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
