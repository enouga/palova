'use client';
import { CSSProperties, useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';

interface Props {
  presets: number[];
  value: number;
  onChange: (v: number) => void;
  /** Suffixe des libellés par défaut (« 14 jours »). Ignoré si `format` fourni. */
  unit?: string;
  /** Libellé custom par valeur (ex. 0 → « Jusqu'au début »). */
  format?: (n: number) => string;
  min?: number;
  max?: number;
}

/** Presets numériques en chips + « Autre… » révélant un champ. Contrôlé par `value`. */
export function PresetChips({ presets, value, onChange, unit = '', format, min = 0, max = 999 }: Props) {
  const { th } = useTheme();
  const onPreset = presets.includes(value);
  // « Autre… » forcé dès que value est hors presets, ou après clic explicite.
  const [otherOpen, setOtherOpen] = useState(false);
  const showInput = !onPreset || otherOpen;

  const label = (n: number) => (format ? format(n) : `${n}${unit ? ` ${unit}` : ''}`);

  const chip = (active: boolean): CSSProperties => ({
    border: `1px solid ${active ? th.accent : th.line}`,
    background: active ? th.accent : th.surface2,
    color: active ? th.onAccent : th.textMute,
    borderRadius: 999, padding: '8px 14px', cursor: 'pointer',
    fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        {presets.map((p) => (
          <button key={p} type="button" aria-pressed={value === p && !otherOpen}
            onClick={() => { setOtherOpen(false); onChange(p); }} style={chip(value === p && !otherOpen)}>
            {label(p)}
          </button>
        ))}
        <button type="button" aria-pressed={showInput} onClick={() => setOtherOpen(true)} style={chip(showInput)}>
          Autre…
        </button>
      </div>
      {showInput && (
        <input
          type="number" min={min} max={max} value={value}
          aria-label="Valeur personnalisée"
          onChange={(e) => onChange(Math.max(min, Math.min(max, Math.trunc(Number(e.target.value) || 0))))}
          style={{
            width: 120, height: 44, padding: '0 12px', borderRadius: 12,
            background: th.bg, color: th.text, border: `1px solid ${th.line}`,
            fontFamily: th.fontUI, fontSize: 15,
          }}
        />
      )}
    </div>
  );
}
