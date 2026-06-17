'use client';
import { useState } from 'react';
import { tierForLevel } from '@/lib/level';
import { LevelSourceNote } from '@/components/player/LevelSourceNote';

interface Props {
  onSelect: (level: number) => void;
  onSkip: () => void;
  busy: boolean;
}

const MIN = 1;
const MAX = 8;
const DEFAULT = 4;

// Auto-évaluation : curseur 1,0–8,0 au dixième (référentiel padel 0–8). Le palier et sa
// description s'actualisent en direct ; « Valider » envoie le niveau exact choisi.
export function LevelCalibration({ onSelect, onSkip, busy }: Props) {
  const [value, setValue] = useState(DEFAULT);
  const tier = tierForLevel(value);
  return (
    <div>
      <p className="mb-3 text-sm opacity-70">
        Place le curseur sur le niveau qui te ressemble le plus (au dixième). Tu te recaleras vite sur tes premiers matchs.
      </p>

      <div className="mb-2 flex items-baseline gap-2">
        <strong className="text-2xl tabular-nums">{value.toFixed(1).replace('.', ',')}</strong>
        <span className="font-semibold">{tier.name}</span>
      </div>

      <input
        type="range"
        min={MIN}
        max={MAX}
        step={0.1}
        value={value}
        disabled={busy}
        aria-label="Niveau"
        onChange={(e) => setValue(Number(e.target.value))}
        className="w-full disabled:opacity-50"
      />
      <div className="mt-1 flex justify-between text-[11px] opacity-50">
        <span>1 · Débutant</span>
        <span>8 · Élite</span>
      </div>

      <p className="mt-2 text-sm opacity-70">{tier.blurb}</p>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => onSelect(value)}
          className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          Valider mon niveau
        </button>
        <button type="button" disabled={busy} onClick={onSkip} className="text-sm underline opacity-70 disabled:opacity-50">
          Passer
        </button>
      </div>

      <div className="mt-3"><LevelSourceNote /></div>
    </div>
  );
}
