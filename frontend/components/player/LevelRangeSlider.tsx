'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { tierForLevel } from '@/lib/level';
import { fmtLevel } from '@/lib/levelMatch';

interface Props {
  min: number;                       // borne basse courante (1–8)
  max: number;                       // borne haute courante (1–8)
  onChange: (min: number, max: number) => void;
  myLevel?: number | null;           // niveau de l'organisateur → repère « moi » sur la piste
  disabled?: boolean;
}

const MIN = 1;
const MAX = 8;
const STEP = 0.1;
const pct = (v: number) => ((Math.max(MIN, Math.min(MAX, v)) - MIN) / (MAX - MIN)) * 100;

// Curseur double (fourchette de niveau d'une partie ouverte), 1,0–8,0 au dixième.
// Deux <input range> superposés (clavier + a11y natifs) + piste/poignées thémées via
// variables CSS lues sur le conteneur (accent du club). Les poignées ne se croisent pas.
export function LevelRangeSlider({ min, max, onChange, myLevel, disabled }: Props) {
  const { th } = useTheme();
  const tierLo = tierForLevel(min);
  const tierHi = tierForLevel(max);

  const onMin = (v: number) => onChange(Math.min(v, max), max);
  const onMax = (v: number) => onChange(min, Math.max(v, min));

  const cssVars = {
    '--lvl-accent': th.accent,
    '--lvl-band': th.surface2,
    '--lvl-track': th.lineStrong,
  } as React.CSSProperties;

  return (
    <div style={{ opacity: disabled ? 0.4 : 1, pointerEvents: disabled ? 'none' : 'auto', ...cssVars }}>
      <style>{`
        .lvlrange{position:absolute;top:26px;left:0;width:100%;margin:0;height:16px;background:transparent;-webkit-appearance:none;appearance:none;pointer-events:none;}
        .lvlrange::-webkit-slider-thumb{-webkit-appearance:none;pointer-events:auto;width:20px;height:20px;border-radius:50%;background:#fff;border:3px solid var(--lvl-accent);cursor:pointer;}
        .lvlrange::-moz-range-thumb{pointer-events:auto;width:20px;height:20px;border-radius:50%;background:#fff;border:3px solid var(--lvl-accent);cursor:pointer;}
        .lvlrange::-webkit-slider-runnable-track{background:transparent;}
        .lvlrange::-moz-range-track{background:transparent;}
      `}</style>

      <div style={{ textAlign: 'center', marginBottom: 14 }}>
        <div style={{ fontFamily: th.fontUI, fontSize: 16, fontWeight: 600, color: th.text }}>
          {tierLo.name} <span style={{ color: th.textFaint, fontWeight: 400 }}>→</span> {tierHi.name}
        </div>
        <div style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute, marginTop: 2 }}>
          niveau {fmtLevel(min)} à {fmtLevel(max)}
        </div>
      </div>

      <div style={{ position: 'relative', height: 52, padding: '0 2px' }}>
        {/* bulles de valeur collées aux poignées */}
        <div style={{ position: 'absolute', top: 0, left: `${pct(min)}%`, transform: 'translateX(-50%)', background: th.accent, color: th.onAccent, fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, padding: '2px 7px', borderRadius: 7, whiteSpace: 'nowrap' }}>{fmtLevel(min)}</div>
        <div style={{ position: 'absolute', top: 0, left: `${pct(max)}%`, transform: 'translateX(-50%)', background: th.accent, color: th.onAccent, fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, padding: '2px 7px', borderRadius: 7, whiteSpace: 'nowrap' }}>{fmtLevel(max)}</div>

        {/* piste : 7 bandes de paliers discrètes */}
        <div style={{ position: 'absolute', top: 30, left: 0, right: 0, height: 8, borderRadius: 999, overflow: 'hidden', display: 'flex' }}>
          {Array.from({ length: 7 }, (_, i) => (
            <span key={i} style={{ flex: 1, background: i % 2 === 0 ? th.surface2 : 'transparent' }} />
          ))}
        </div>
        {/* segment sélectionné */}
        <div style={{ position: 'absolute', top: 30, height: 8, borderRadius: 999, background: th.accent, left: `${pct(min)}%`, width: `${pct(max) - pct(min)}%` }} />

        {/* repère « moi » */}
        {myLevel != null && (
          <div style={{ position: 'absolute', top: 23, left: `${pct(myLevel)}%`, transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ width: 2, height: 20, background: th.text }} />
            <span style={{ fontFamily: th.fontUI, fontSize: 10, color: th.textMute, marginTop: 1, whiteSpace: 'nowrap' }}>moi · {fmtLevel(myLevel)}</span>
          </div>
        )}

        <input className="lvlrange" type="range" min={MIN} max={MAX} step={STEP} value={min} disabled={disabled}
          aria-label="Niveau minimum" onChange={(e) => onMin(Number(e.target.value))} />
        <input className="lvlrange" type="range" min={MIN} max={MAX} step={STEP} value={max} disabled={disabled}
          aria-label="Niveau maximum" onChange={(e) => onMax(Number(e.target.value))} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: th.fontUI, fontSize: 11, color: th.textFaint }}>
        <span>1 · Débutant</span><span>8 · Élite</span>
      </div>
    </div>
  );
}
