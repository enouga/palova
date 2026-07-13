'use client';

import { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { Icon } from './Icon';

const pad = (n: number) => String(n).padStart(2, '0');

/** Parse "HH:MM" → { h, m } borné, ou null si invalide / vide. */
function parse(value: string): { h: number; m: number } | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { h, m };
}

interface TimePickerProps {
  /** Heure courante "HH:MM" (chaîne vide = non renseignée). */
  value: string;
  onChange: (hhmm: string) => void;
  /** Pas des steppers minutes (défaut 5). */
  minuteStep?: number;
  /** Puces de minutes rapides (défaut :00 :15 :30 :45). [] pour les masquer. */
  minuteChips?: number[];
  /** Puces d'heures pleines "HH:MM" posées d'un clic (optionnel). */
  presets?: string[];
  /** Affichage quand value est vide. */
  placeholder?: string;
  /** Heure adoptée à la 1re interaction quand value est vide. */
  defaultTime?: string;
  /** Élément posé à gauche du champ HH:MM (ex. un input date). */
  leading?: ReactNode;
}

// Sélecteur d'heure « champ unifié » : une pastille arrondie (icône horloge + HH:MM)
// avec micro-steppers −/+ de part et d'autre de chaque nombre, puis une rangée de
// puces de minutes rapides. Styles inline + tokens de thème (aucun picker natif).
export function TimePicker({
  value,
  onChange,
  minuteStep = 5,
  minuteChips = [0, 15, 30, 45],
  presets,
  placeholder = '--:--',
  defaultTime = '18:00',
  leading,
}: TimePickerProps) {
  const { th } = useTheme();
  const has = parse(value) != null;
  const { h, m } = parse(value) ?? parse(defaultTime) ?? { h: 18, m: 0 };

  const emit = (nh: number, nm: number) => onChange(`${pad(nh)}:${pad(nm)}`);

  const stepHour = (delta: number) => emit((h + delta + 24) % 24, m); // bouclage 23↔0
  const stepMinute = (delta: number) => {
    // Retenue sur l'heure (bornée 0–23), minutes alignées sur le pas.
    const total = (((h * 60 + m + delta * minuteStep) % 1440) + 1440) % 1440;
    emit(Math.floor(total / 60), total % 60);
  };

  const stepBtn: CSSProperties = {
    width: 30, height: 30, flexShrink: 0, borderRadius: 8, border: 'none',
    background: th.surfaceHi, color: th.text, cursor: 'pointer',
    fontFamily: th.fontUI, fontSize: 18, fontWeight: 600, lineHeight: 1,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };

  // Un segment : [−] grand nombre (spinbutton) [+].
  const segment = (kind: 'h' | 'm') => {
    const cur = kind === 'h' ? h : m;
    const step = kind === 'h' ? stepHour : stepMinute;
    const noun = kind === 'h' ? 'Heures' : 'Minutes';
    const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'ArrowUp') { e.preventDefault(); step(1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); step(-1); }
    };
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
        <button type="button" aria-label={`${noun} -`} onClick={() => step(-1)} style={stepBtn}>−</button>
        <div role="spinbutton" tabIndex={0} aria-label={noun}
          aria-valuenow={has ? cur : undefined} aria-valuetext={has ? pad(cur) : placeholder}
          onKeyDown={onKey}
          style={{ minWidth: 30, textAlign: 'center', fontFamily: th.fontMono, fontSize: 19, fontWeight: 600, color: has ? th.text : th.textFaint, outline: 'none', userSelect: 'none' }}>
          {has ? pad(cur) : '--'}
        </div>
        <button type="button" aria-label={`${noun} +`} onClick={() => step(1)} style={stepBtn}>+</button>
      </div>
    );
  };

  const chip = (active: boolean): CSSProperties => ({
    border: `1px solid ${active ? th.accent : th.line}`,
    background: active ? th.accent : th.surface2,
    color: active ? th.onAccent : th.textMute,
    borderRadius: 999, padding: '6px 12px', cursor: 'pointer',
    fontFamily: th.fontUI, fontSize: 13, fontWeight: 700,
  });

  const timeField = (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      background: th.surface2, border: `1px solid ${th.line}`, borderRadius: 12, padding: '5px 10px 5px 12px',
    }}>
      <Icon name="clock" size={17} color={th.textMute} style={{ marginRight: 5, flexShrink: 0 }} />
      {segment('h')}
      <span style={{ fontFamily: th.fontMono, fontSize: 19, fontWeight: 600, color: th.textFaint }}>:</span>
      {segment('m')}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Date (leading) + champ heure sur une rangée qui passe à la ligne en mobile. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {leading}
        {timeField}
      </div>

      {minuteChips.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {minuteChips.map((mm) => (
            <button key={mm} type="button" onClick={() => emit(h, mm)} style={chip(has && m === mm)}>
              :{pad(mm)}
            </button>
          ))}
        </div>
      )}

      {presets && presets.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {presets.map((p) => (
            <button key={p} type="button" onClick={() => onChange(p)} style={chip(value === p)}>
              {p.replace(':', 'h')}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
