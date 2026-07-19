'use client';
import { useEffect, useState } from 'react';
import { api, NationalOpenMatch, MyRating } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useTheme } from '@/lib/ThemeProvider';
import { PillTabs, Pill } from '@/components/ui/atoms';
import { NationalMatchCard } from '@/components/platform/NationalMatchCard';
import { filterNationalMatches, sortMatchesByDistance, DiscoverPeriod } from '@/lib/discover';

const PERIOD_OPTIONS: { value: DiscoverPeriod; label: string }[] = [
  { value: 'today', label: "Aujourd'hui" },
  { value: 'weekend', label: 'Week-end' },
  { value: 'all', label: '14 jours' },
];

// Onglet « Parties » de la future page /decouvrir : grille de parties ouvertes nationales
// (GET /api/open-matches/national, chargées par le parent) filtrées par période/ville/niveau
// et triées par distance. Pur côté données — `matches`/`city`/`coords`/`now` arrivent en
// props, seuls `period`/`levelOn`/`rating` sont un état local à ce composant.
export function DiscoverMatches({
  matches,
  city,
  coords,
  now,
  onSeeClubs,
}: {
  matches: NationalOpenMatch[] | null;
  city: string;
  coords: { lat: number; lng: number } | null;
  now: Date | null;
  onSeeClubs: () => void;
}) {
  const { th } = useTheme();
  const { token } = useAuth();
  const [period, setPeriod] = useState<DiscoverPeriod>('all');
  const [levelOn, setLevelOn] = useState(false);
  const [rating, setRating] = useState<MyRating | null>(null);

  useEffect(() => {
    if (!token) { setRating(null); return; }
    api.getMyRating(token, 'padel').then(setRating).catch(() => setRating(null));
  }, [token]);

  if (matches == null || now == null) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', fontFamily: th.fontUI, color: th.textMute }}>
        Chargement…
      </div>
    );
  }

  const levelChipVisible = Boolean(token) && rating?.level != null;
  const myLevel = levelChipVisible && levelOn ? rating!.level : null;
  const filtered = filterNationalMatches(matches, { period, city, myLevel }, now);
  const ranked = sortMatchesByDistance(filtered, coords);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
        <PillTabs options={PERIOD_OPTIONS} value={period} onChange={setPeriod} />
        {levelChipVisible && (
          <Pill label="À mon niveau" active={levelOn} onClick={() => setLevelOn((v) => !v)} />
        )}
      </div>

      {ranked.length === 0 ? (
        <div style={{ padding: '32px 0', textAlign: 'center', fontFamily: th.fontUI, color: th.textMute }}>
          <div>Aucune partie ne correspond pour le moment.</div>
          <button
            onClick={onSeeClubs}
            style={{
              marginTop: 14, border: 'none', cursor: 'pointer', borderRadius: 999, padding: '10px 20px',
              fontFamily: th.fontUI, fontSize: 14, fontWeight: 700, background: th.accent, color: th.onAccent,
            }}
          >
            Voir les clubs →
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: 14 }}>
          {ranked.map((r) => (
            <NationalMatchCard key={r.match.id} match={r.match} distanceKm={r.distanceKm} />
          ))}
        </div>
      )}
    </div>
  );
}
