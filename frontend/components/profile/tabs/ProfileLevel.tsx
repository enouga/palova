'use client';
import type { ClubMatchStats, MyRating, RatingPoint, Sport } from '@/lib/api';
import { PillTabs } from '@/components/ui/atoms';
import { LevelBadge } from '@/components/player/LevelBadge';
import { ReliabilityMeter } from '@/components/player/ReliabilityMeter';
import { LevelCalibration } from '@/components/player/LevelCalibration';
import { LevelSourceNote } from '@/components/player/LevelSourceNote';
import { LevelHistoryChart } from '@/components/player/LevelHistoryChart';
import { ResultStats } from '@/components/player/ResultStats';
import { CardKicker } from '@/components/profile/CardKicker';
import { useProfileStyles } from '@/components/profile/shared';

interface Props {
  sports: Sport[];
  ratingSport: string;
  onRatingSport: (key: string) => void;
  rating: MyRating | null;
  history: RatingPoint[];
  matchStats: ClubMatchStats | null;
  clubName: string | null;
  calibrating: boolean;
  ratingBusy: boolean;
  onStartCalibrate: () => void;
  onCalibrate: (level: number | null) => void;
}

// Niveau : padel uniquement aujourd'hui. Le sélecteur de sport réapparaîtra quand
// l'utilisateur aura un niveau sur 2+ sports (drapeau à repasser true à ce moment-là).
const showLevelSportPicker = false;

export function ProfileLevel({
  sports, ratingSport, onRatingSport, rating, history, matchStats, clubName,
  calibrating, ratingBusy, onStartCalibrate, onCalibrate,
}: Props) {
  const { th, card, label } = useProfileStyles();
  const levelSportName = sports.find((s) => s.key === ratingSport)?.name ?? 'Padel';
  const linkBtn = {
    fontFamily: th.fontUI, fontSize: 13, textDecoration: 'underline', opacity: 0.7,
    background: 'none', border: 'none', cursor: 'pointer', color: th.text,
  };

  return (
    <section style={card} aria-label="Mon niveau">
      <CardKicker>Mon niveau · {levelSportName}</CardKicker>
      {showLevelSportPicker && sports.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={label}>Sport du niveau</span>
          <div role="group" aria-label="Sport du niveau">
            <PillTabs options={sports.map((s) => ({ value: s.key, label: s.name }))} value={ratingSport} onChange={onRatingSport} size="sm" />
          </div>
        </div>
      )}
      {calibrating ? (
        <LevelCalibration onSelect={(l) => onCalibrate(l)} onSkip={() => onCalibrate(null)} busy={ratingBusy} />
      ) : rating && rating.level != null ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <LevelBadge rating={rating} />
            <button type="button" onClick={onStartCalibrate} style={linkBtn}>Réévaluer</button>
          </div>
          {matchStats && matchStats.wins + matchStats.losses > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textFaint, marginBottom: 4 }}>Résultats · {clubName}</div>
              <ResultStats tone="onSurface" wins={matchStats.wins} losses={matchStats.losses} streak={matchStats.streak} />
            </div>
          )}
          {rating.calibrated && <div style={{ marginTop: 10 }}><LevelHistoryChart points={history} /></div>}
          <LevelSourceNote style={{ marginTop: 10 }} />
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.text, margin: 0 }}>
            Niveau en cours de calibrage — joue tes premiers matchs et ton niveau s’affinera tout seul.
          </p>
          {rating && <ReliabilityMeter pct={rating.reliability} />}
          <button type="button" onClick={onStartCalibrate} style={{ ...linkBtn, alignSelf: 'flex-start' }}>
            Affiner mon niveau (optionnel)
          </button>
        </div>
      )}
    </section>
  );
}
