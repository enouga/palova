'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { Segmented } from '@/components/ui/atoms';
import { LevelRangeSlider } from '@/components/player/LevelRangeSlider';

export interface CheckoutMatchOptionsProps {
  isPadel: boolean;
  visibility: 'PRIVATE' | 'PUBLIC';
  setVisibility: (v: 'PRIVATE' | 'PUBLIC') => void;
  spotsLeft: number;
  levelForSport: boolean;
  levelLimited: boolean;
  setLevelLimited: (v: boolean) => void;
  levelMin: number;
  levelMax: number;
  setLevel: (lo: number, hi: number) => void;
}

/**
 * Bloc « Partie privée / Partie ouverte » + fourchette de niveau — port fidèle de
 * BookingModal (lignes 569-598). Ne rend rien hors padel.
 */
export function CheckoutMatchOptions({
  isPadel, visibility, setVisibility, spotsLeft, levelForSport,
  levelLimited, setLevelLimited, levelMin, levelMax, setLevel,
}: CheckoutMatchOptionsProps) {
  const { th } = useTheme();

  if (!isPadel) return null;

  return (
    <div style={{ marginTop: 14 }}>
      <Segmented<'PRIVATE' | 'PUBLIC'> value={visibility} onChange={setVisibility}
        options={[{ value: 'PRIVATE', label: 'Partie privée' }, { value: 'PUBLIC', label: 'Partie ouverte' }]} />
      <div style={{ fontFamily: th.fontUI, fontSize: 11.5, color: th.textFaint, marginTop: 6, lineHeight: 1.4 }}>
        {visibility === 'PUBLIC'
          ? `Visible par les membres du club, qui peuvent rejoindre (${spotsLeft} place${spotsLeft > 1 ? 's' : ''} restante${spotsLeft > 1 ? 's' : ''}).`
          : 'Visible uniquement par vous et vos partenaires.'}
      </div>

      {visibility === 'PUBLIC' && levelForSport && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, fontWeight: 600 }}>Limiter le niveau des joueurs</span>
            <button type="button" role="switch" aria-checked={levelLimited} aria-label="Limiter le niveau"
              onClick={() => setLevelLimited(!levelLimited)}
              style={{ width: 42, height: 24, borderRadius: 999, border: 'none', cursor: 'pointer', padding: 0, position: 'relative', background: levelLimited ? th.accent : th.lineStrong, transition: 'background .15s' }}>
              <span style={{ position: 'absolute', top: 3, left: levelLimited ? 21 : 3, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
            </button>
          </div>
          {levelLimited && (
            <div style={{ marginTop: 14 }}>
              <LevelRangeSlider min={levelMin} max={levelMax}
                onChange={(lo, hi) => setLevel(lo, hi)} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
