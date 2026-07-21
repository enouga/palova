'use client';
import { useEffect, useState } from 'react';
import { api, NationalOpenMatch, MyRating } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useTheme } from '@/lib/ThemeProvider';
import { FacetChip, FacetGroup, FILTER_TINTS } from '@/components/ui/FacetChip';
import { NationalMatchCard } from '@/components/platform/NationalMatchCard';
import { filterNationalMatches, sortMatchesByDistance, DiscoverPeriod, LocationQuery } from '@/lib/discover';

const PERIOD_OPTIONS: { value: DiscoverPeriod; label: string }[] = [
  { value: 'today', label: "Aujourd'hui" },
  { value: 'weekend', label: 'Week-end' },
  { value: 'all', label: '14 jours' },
];

// Onglet « Parties » de la future page /decouvrir : grille de parties ouvertes nationales
// (GET /api/open-matches/national, chargées par le parent) filtrées par période/localisation/
// niveau et triées par distance. Pur côté données — `matches`/`location`/`coords`/`now`
// arrivent en props, seuls `period`/`levelOn`/`rating` sont un état local à ce composant.
// `onCount` (optionnel) reporte au parent le nombre de cartes affichées après filtrage —
// pas appelé tant que `matches`/`now` ne sont pas chargés (compteur inconnu).
export function DiscoverMatches({
  matches,
  location,
  coords,
  now,
  onSeeClubs,
  onCount,
}: {
  matches: NationalOpenMatch[] | null;
  location: LocationQuery;
  coords: { lat: number; lng: number } | null;
  now: Date | null;
  onSeeClubs: () => void;
  onCount?: (n: number) => void;
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

  const levelChipVisible = Boolean(token) && rating?.level != null;
  const myLevel = levelChipVisible && levelOn ? rating!.level : null;

  // `ranked` reste `null` tant que `matches`/`now` ne sont pas chargés (compteur inconnu) —
  // calculé AVANT l'early return de chargement pour respecter les règles des hooks (le
  // useEffect ci-dessous doit être appelé à chaque rendu, jamais conditionnellement).
  const ranked = matches != null && now != null
    ? sortMatchesByDistance(filterNationalMatches(matches, { period, location, myLevel }, now), coords)
    : null;

  useEffect(() => {
    if (ranked) onCount?.(ranked.length);
  }, [ranked?.length, onCount]);

  if (matches == null || now == null) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', fontFamily: th.fontUI, color: th.textMute }}>
        Chargement…
      </div>
    );
  }

  const list = ranked ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Même tiroir compact que les filtres Tournois (FacetPanel) — langage partagé. */}
      <div style={{ borderRadius: 16, background: th.bgElev, boxShadow: `inset 0 0 0 1px ${th.line}` }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 26px', padding: '12px 14px' }}>
          <FacetGroup label="Quand" tint={FILTER_TINTS.quand}>
            {PERIOD_OPTIONS.map((o) => (
              <FacetChip key={o.value} label={o.label} tint={FILTER_TINTS.quand} active={period === o.value} onClick={() => setPeriod(o.value)} />
            ))}
          </FacetGroup>
          {levelChipVisible && (
            <FacetGroup label="Niveau" tint={FILTER_TINTS.niveau}>
              <FacetChip label="À mon niveau" tint={FILTER_TINTS.niveau} active={levelOn} onClick={() => setLevelOn((v) => !v)} />
            </FacetGroup>
          )}
        </div>
      </div>

      {list.length === 0 ? (
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
          {list.map((r) => (
            <NationalMatchCard key={r.match.id} match={r.match} distanceKm={r.distanceKm} />
          ))}
        </div>
      )}
    </div>
  );
}
