'use client';
import { useState, useEffect, useRef } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { tierForLevel } from '@/lib/level';
import { fmtLevel } from '@/lib/levelMatch';
import { randomQuip } from '@/lib/levelQuips';
import { LevelSourceNote } from '@/components/player/LevelSourceNote';

interface Props {
  min: number;                       // borne basse courante (1–8)
  max: number;                       // borne haute courante (1–8)
  onChange: (min: number, max: number) => void;
  disabled?: boolean;
  /** Version filtre : masque la description de palier + la note de source (juste le curseur). */
  compact?: boolean;
}

const MIN = 1;
const MAX = 8;
const STEP = 0.1;
const pct = (v: number) => ((Math.max(MIN, Math.min(MAX, v)) - MIN) / (MAX - MIN)) * 100;

// Curseur double sobre (fourchette de niveau d'une partie ouverte), 1,0–8,0 au dixième.
// Sous le curseur, on n'affiche QUE la description du palier de la poignée déplacée
// (mêmes phrases que la grille d'auto-évaluation des nouveaux — LEVEL_TIERS.blurb).
export function LevelRangeSlider({ min, max, onChange, disabled, compact }: Props) {
  const { th } = useTheme();
  const [active, setActive] = useState<'min' | 'max'>('min'); // poignée décrite (dernière touchée)
  const activeVal = active === 'min' ? min : max;
  const tier = tierForLevel(activeVal);
  const activeLevel = Math.max(1, Math.min(8, Math.round(activeVal))); // palier 1–8 décrit

  // Vanne aléatoire : on en tire une nouvelle à chaque changement de palier OU de poignée
  // décrite ; on garde la même tant qu'on reste sur le même palier (pas de scintillement).
  const [quip, setQuip] = useState(() => randomQuip(activeLevel));
  const quipKey = useRef(`${active}:${activeLevel}`);
  useEffect(() => {
    const key = `${active}:${activeLevel}`;
    if (key === quipKey.current) return;
    quipKey.current = key;
    setQuip((prev) => randomQuip(activeLevel, prev));
  }, [active, activeLevel]);

  const onMin = (v: number) => { setActive('min'); onChange(Math.min(v, max), max); };
  const onMax = (v: number) => { setActive('max'); onChange(min, Math.max(v, min)); };

  const cssVars = { '--lvl-accent': th.accent } as React.CSSProperties;

  return (
    <div style={{ opacity: disabled ? 0.4 : 1, pointerEvents: disabled ? 'none' : 'auto', ...cssVars }}>
      <style>{`
        .lvlrange{position:absolute;top:5px;left:0;width:100%;margin:0;height:16px;background:transparent;-webkit-appearance:none;appearance:none;pointer-events:none;}
        .lvlrange::-webkit-slider-thumb{-webkit-appearance:none;pointer-events:auto;width:16px;height:16px;border-radius:50%;background:var(--lvl-accent);border:none;cursor:pointer;}
        .lvlrange::-moz-range-thumb{pointer-events:auto;width:16px;height:16px;border-radius:50%;background:var(--lvl-accent);border:none;cursor:pointer;}
        .lvlrange::-webkit-slider-runnable-track{background:transparent;}
        .lvlrange::-moz-range-track{background:transparent;}
      `}</style>

      <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, marginBottom: 8 }}>
        Niveau <b style={{ color: th.text, fontWeight: 600 }}>{fmtLevel(min)} à {fmtLevel(max)}</b>
      </div>

      <div style={{ position: 'relative', height: 24 }}>
        <div style={{ position: 'absolute', top: 10, left: 0, right: 0, height: 4, borderRadius: 999, background: th.surface2 }} />
        <div style={{ position: 'absolute', top: 10, height: 4, borderRadius: 999, background: th.accent, left: `${pct(min)}%`, width: `${pct(max) - pct(min)}%` }} />
        <input className="lvlrange" type="range" min={MIN} max={MAX} step={STEP} value={min} disabled={disabled}
          aria-label="Niveau minimum" onFocus={() => setActive('min')} onChange={(e) => onMin(Number(e.target.value))} />
        <input className="lvlrange" type="range" min={MIN} max={MAX} step={STEP} value={max} disabled={disabled}
          aria-label="Niveau maximum" onFocus={() => setActive('max')} onChange={(e) => onMax(Number(e.target.value))} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: th.fontUI, fontSize: 11, color: th.textFaint, marginTop: 2 }}>
        <span>1</span><span>8</span>
      </div>

      {!compact && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${th.line}` }}>
          <div style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute }}>
            {active === 'min' ? 'Niveau minimum' : 'Niveau maximum'} · <b style={{ color: th.text, fontWeight: 600 }}>{tier.name}</b>
          </div>
          <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, lineHeight: 1.45, marginTop: 3, fontStyle: 'italic' }}>{quip}</div>
          <LevelSourceNote humor style={{ marginTop: 10 }} />
        </div>
      )}
    </div>
  );
}
