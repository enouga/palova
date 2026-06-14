'use client';

import { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { useTheme } from '@/lib/ThemeProvider';

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
  /** Élément posé à gauche des tuiles HH:MM (ex. un input date). */
  leading?: ReactNode;
}

// Sélecteur d'heure « affichage géant + raccourcis » : deux grandes tuiles HH:MM
// avec steppers ▲/▼, puces de minutes et presets d'heures pleines. Cohérent avec le
// design Palova (styles inline + tokens de thème), sans dépendre du picker natif.
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

  const stepHour = (delta: number) => {
    const nh = (h + delta + 24) % 24; // bouclage 23↔0
    emit(nh, m);
  };
  const stepMinute = (delta: number) => {
    // Retenue sur l'heure (bornée 0–23), minutes alignées sur le pas.
    const total = (((h * 60 + m + delta * minuteStep) % 1440) + 1440) % 1440;
    emit(Math.floor(total / 60), total % 60);
  };

  const stepBtn: CSSProperties = {
    width: '100%', height: 18, border: `1px solid ${th.line}`, background: 'transparent',
    color: th.textMute, borderRadius: 6, cursor: 'pointer', fontSize: 9, lineHeight: 1,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
  const tileBox: CSSProperties = {
    minWidth: 44, padding: '5px 0', background: th.surface2, borderRadius: 9,
    fontFamily: th.fontMono, fontSize: 17, fontWeight: 600, color: has ? th.text : th.textFaint,
    textAlign: 'center', outline: 'none', userSelect: 'none',
  };

  // Une tuile (heure ou minute) : ▲ / grand nombre (spinbutton) / ▼.
  const tile = (kind: 'h' | 'm') => {
    const cur = kind === 'h' ? h : m;
    const step = kind === 'h' ? stepHour : stepMinute;
    const noun = kind === 'h' ? 'Heures' : 'Minutes';
    const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'ArrowUp') { e.preventDefault(); step(1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); step(-1); }
    };
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 44 }}>
        <button type="button" aria-label={`${noun} +`} onClick={() => step(1)} style={stepBtn}>▲</button>
        <div role="spinbutton" tabIndex={0} aria-label={noun}
          aria-valuenow={has ? cur : undefined} aria-valuetext={has ? pad(cur) : placeholder}
          onKeyDown={onKey} style={tileBox}>
          {has ? pad(cur) : '--'}
        </div>
        <button type="button" aria-label={`${noun} -`} onClick={() => step(-1)} style={stepBtn}>▼</button>
      </div>
    );
  };

  const chip = (active: boolean): CSSProperties => ({
    border: `1px solid ${active ? th.accent : th.line}`,
    background: active ? th.accent : th.surface2,
    color: active ? th.onAccent : th.text,
    borderRadius: 999, padding: '4px 9px', cursor: 'pointer',
    fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 600,
  });

  const caption: CSSProperties = {
    fontFamily: th.fontUI, fontSize: 9.5, fontWeight: 700, letterSpacing: 0.5,
    textTransform: 'uppercase', color: th.textFaint, marginBottom: 4,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Élément optionnel (ex. champ date) posé sur sa propre ligne, au-dessus des
          tuiles : la rangée HH:MM + puces garde alors toute la largeur disponible. */}
      {leading}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {tile('h')}
          <span style={{ fontFamily: th.fontMono, fontSize: 17, fontWeight: 600, color: th.textFaint }}>:</span>
          {tile('m')}
        </div>
        {/* Puces de minutes posées juste à droite de la tuile minutes (même rangée).
            La colonne reprend la rythmique des steppers (caption à hauteur du ▲ + gap 4)
            pour que les puces tombent pile au niveau de la tuile-nombre. */}
        {minuteChips.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ ...caption, marginBottom: 0, height: 18, display: 'flex', alignItems: 'center' }}>Minutes</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'nowrap' }}>
              {minuteChips.map((mm) => (
                <button key={mm} type="button" onClick={() => emit(h, mm)}
                  style={{ ...chip(has && m === mm), padding: '8px 12px', fontSize: 14 }}>
                  :{pad(mm)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {presets && presets.length > 0 && (
        <div>
          <div style={caption}>Raccourcis</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {presets.map((p) => (
              <button key={p} type="button" onClick={() => onChange(p)} style={chip(value === p)}>
                {p.replace(':', 'h')}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
