'use client';
import { LEVEL_TIERS } from '@/lib/level';

interface Props {
  onSelect: (level: number) => void;
  onSkip: () => void;
  busy: boolean;
}

// Auto-évaluation : le joueur choisit le palier qui lui ressemble (référentiel padel 0–8).
export function LevelCalibration({ onSelect, onSkip, busy }: Props) {
  return (
    <div>
      <p className="mb-3 text-sm opacity-70">
        Choisis le niveau qui te ressemble le plus. Tu te recaleras vite sur tes premiers matchs.
      </p>
      <ul className="flex flex-col gap-2">
        {LEVEL_TIERS.map((t) => (
          <li key={t.level}>
            <button
              type="button"
              disabled={busy}
              onClick={() => onSelect(t.level)}
              className="flex w-full items-start gap-3 rounded-xl border p-3 text-left disabled:opacity-50"
              style={{ borderColor: 'rgba(0,0,0,0.12)' }}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-bold"
                    style={{ background: 'rgba(0,0,0,0.08)' }}>
                {t.level}
              </span>
              <span>
                <span className="block font-semibold">{t.name}</span>
                <span className="block text-sm opacity-70">{t.blurb}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" disabled={busy} onClick={onSkip} className="mt-3 text-sm underline opacity-70 disabled:opacity-50">
        Passer
      </button>
    </div>
  );
}
