'use client';
import { useEffect, useState } from 'react';
import { api, NationalOpenMatch, MyRating } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useTheme } from '@/lib/ThemeProvider';
import { FacetChip, FacetGroup, FILTER_TINTS } from '@/components/ui/FacetChip';
import { NationalMatchCard } from '@/components/platform/NationalMatchCard';
import { filterNationalMatches, sortMatchesByDistance, LocationQuery } from '@/lib/discover';
import { DatePreset, DATE_PRESETS } from '@/lib/tournamentCalendar';
import { DateRangeChip } from '@/components/calendar/DateRangeChip';
import { useScrollRail } from '@/lib/useScrollRail';
import { RailArrows } from '@/components/ui/RailArrows';

// Rail de découverte, pas un flux exhaustif : on plafonne l'affichage (comme les autres
// rails de la vitrine — OpenMatchesShowcase à 6, UpcomingTournaments à 4).
const MAX_VISIBLE = 9;

// Onglet « Parties » de la page /decouvrir : étagère 2 lignes de parties ouvertes nationales
// (GET /api/open-matches/national, chargées par le parent) filtrées par date/localisation/
// niveau et triées par distance. Le sélecteur de date (puces Aujourd'hui/Cette semaine/Ce
// mois-ci + calendrier « Dates ») est EXACTEMENT celui de la section Tournois (DATE_PRESETS/
// DateRangeChip partagés, cf. lib/tournamentCalendar.ts) — un seul sélecteur, pas deux
// comportements sous un même nom. Pur côté données — `matches`/`location`/`coords`/`now`
// arrivent en props, l'état de date/niveau est local à ce composant. `onCount` (optionnel)
// reporte au parent le nombre de cartes affichées après filtrage — pas appelé tant que
// `matches`/`now` ne sont pas chargés (compteur inconnu).
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
  const [datePreset, setDatePreset] = useState<DatePreset | null>(null);
  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const [dateTo, setDateTo] = useState<string | null>(null);
  const [levelOn, setLevelOn] = useState(false);
  const [rating, setRating] = useState<MyRating | null>(null);

  useEffect(() => {
    if (!token) { setRating(null); return; }
    api.getMyRating(token, 'padel').then(setRating).catch(() => setRating(null));
  }, [token]);

  const levelChipVisible = Boolean(token) && rating?.level != null;
  const myLevel = levelChipVisible && levelOn ? rating!.level : null;

  // `ranked` reste `null` tant que `matches`/`now` ne sont pas chargés (compteur inconnu) —
  // calculé AVANT les hooks ci-dessous pour respecter les règles des hooks (ils doivent être
  // appelés à chaque rendu, jamais conditionnellement, donc avant l'early return plus bas).
  const ranked = matches != null && now != null
    ? sortMatchesByDistance(filterNationalMatches(matches, { datePreset, dateFrom, dateTo, location, myLevel }, now), coords).slice(0, MAX_VISIBLE)
    : null;

  useEffect(() => {
    if (ranked) onCount?.(ranked.length);
  }, [ranked?.length, onCount]);

  const { railRef, edges, scrollByPage } = useScrollRail([ranked?.length ?? 0]);

  if (matches == null || now == null) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', fontFamily: th.fontUI, color: th.textMute }}>
        Chargement…
      </div>
    );
  }

  const list = ranked ?? [];
  const count = `${list.length} partie${list.length > 1 ? 's' : ''}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Même tiroir compact que les filtres Tournois (FacetPanel) — langage partagé. */}
      <div style={{ borderRadius: 16, background: th.bgElev, boxShadow: `inset 0 0 0 1px ${th.line}` }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 26px', padding: '12px 14px' }}>
          <FacetGroup label="Quand" tint={FILTER_TINTS.quand}>
            {DATE_PRESETS.map((p) => (
              <FacetChip key={p.key} label={p.label} tint={FILTER_TINTS.quand}
                active={datePreset === p.key && !dateFrom && !dateTo}
                onClick={() => setDatePreset(datePreset === p.key ? null : p.key)} />
            ))}
            <DateRangeChip from={dateFrom} to={dateTo} onChange={(f, t) => { setDateFrom(f); setDateTo(t); }} tint={FILTER_TINTS.quand} />
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
        <div>
          {/* Rail sur UNE ligne (cartes à largeur fixe qui défilent) — le nombre de colonnes
              n'a pas changé avec l'ajout du sélecteur de date ; seuls les filtres ont évolué. */}
          <div style={{ textAlign: 'right', fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginBottom: 4 }}>{count}</div>
          <div style={{ position: 'relative', margin: '0 -20px' }}>
            <div ref={railRef} className="sp-scroll-x" style={{ display: 'flex', gap: 14, padding: '4px 20px 8px', scrollSnapType: 'x proximity', scrollPaddingLeft: 20 }}>
              {list.map((r) => (
                <NationalMatchCard key={r.match.id} match={r.match} distanceKm={r.distanceKm} style={{ flex: '0 0 270px', scrollSnapAlign: 'start' }} />
              ))}
            </div>
            <RailArrows edges={edges} onPrev={() => scrollByPage(-1)} onNext={() => scrollByPage(1)} prevLabel="Parties précédentes" nextLabel="Parties suivantes" fadeBottom={8} />
          </div>
        </div>
      )}
    </div>
  );
}
