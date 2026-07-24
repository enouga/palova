'use client';
import { useEffect, useRef, useState } from 'react';
import { api, NationalOpenMatch, MyRating } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useTheme } from '@/lib/ThemeProvider';
import { FacetChip, FacetGroup, FILTER_TINTS } from '@/components/ui/FacetChip';
import { FiltersToggle } from '@/components/ui/FiltersToggle';
import { OpenMatchRailCard } from '@/components/match/OpenMatchRailCard';
import { clubUrl } from '@/lib/clubUrl';
import {
  filterNationalMatches, sortMatchesByDistance, LocationQuery, PartiesKind, PartiesGender,
  DISCOVER_PARTIES_FILTERS_KEY, partiesStateToStored, storedToPartiesState, partiesFilterCount,
} from '@/lib/discover';
import { DatePreset, DATE_PRESETS } from '@/lib/tournamentCalendar';
import { DateRangeChip } from '@/components/calendar/DateRangeChip';
import { AgendaRail } from '@/components/agenda/AgendaRail';

// Rail de découverte, pas un flux exhaustif : on plafonne l'affichage (comme les autres
// rails de la vitrine — OpenMatchesShowcase à 6, UpcomingTournaments à 4).
const MAX_VISIBLE = 9;

// Onglet « Parties » de la page /decouvrir : étagère 2 lignes de parties ouvertes nationales
// (GET /api/open-matches/national, chargées par le parent) filtrées par date/localisation/
// niveau et triées par distance. Le sélecteur de date (puces Aujourd'hui/Cette semaine/Ce
// mois-ci + calendrier « Dates ») est EXACTEMENT celui de la section Tournois (DATE_PRESETS/
// DateRangeChip partagés, cf. lib/tournamentCalendar.ts) — un seul sélecteur, pas deux
// comportements sous un même nom. Le tiroir de facettes est REPLIÉ PAR DÉFAUT (même bouton
// partagé `FiltersToggle` que la section Tournois) et les filtres sont MÉMORISÉS d'une
// session à l'autre (localStorage, `DISCOVER_PARTIES_FILTERS_KEY`). Pur côté données —
// `matches`/`location`/`coords`/`now` arrivent en props, l'état de date/niveau est local à
// ce composant. `onCount` (optionnel) reporte au parent le nombre de cartes affichées après
// filtrage — pas appelé tant que `matches`/`now` ne sont pas chargés (compteur inconnu).
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [datePreset, setDatePreset] = useState<DatePreset | null>(null);
  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const [dateTo, setDateTo] = useState<string | null>(null);
  const [kind, setKind] = useState<PartiesKind>('all');
  const [gender, setGender] = useState<PartiesGender>('all');
  const [levelOn, setLevelOn] = useState(false);
  const [rating, setRating] = useState<MyRating | null>(null);

  useEffect(() => {
    if (!token) { setRating(null); return; }
    api.getMyRating(token, 'padel').then(setRating).catch(() => setRating(null));
  }, [token]);

  // Restauration des filtres (une fois, au montage) — mémoire de session.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DISCOVER_PARTIES_FILTERS_KEY);
      if (raw) {
        const s = storedToPartiesState(JSON.parse(raw));
        setDatePreset(s.quand); setDateFrom(s.from); setDateTo(s.to);
        setKind(s.type); setGender(s.genre); setLevelOn(s.niveau);
      }
    } catch { /* stockage indisponible (mode privé/quota) : état par défaut */ }
  }, []);

  // Mémorisation (après restauration — le 1ᵉʳ passage est sauté, sinon on écrirait l'état
  // par défaut avant que la restauration n'ait pris effet).
  const wroteFiltersOnce = useRef(false);
  useEffect(() => {
    if (!wroteFiltersOnce.current) { wroteFiltersOnce.current = true; return; }
    try {
      localStorage.setItem(DISCOVER_PARTIES_FILTERS_KEY, JSON.stringify(
        partiesStateToStored({ datePreset, dateFrom, dateTo, kind, gender, levelOn }),
      ));
    } catch { /* stockage indisponible */ }
  }, [datePreset, dateFrom, dateTo, kind, gender, levelOn]);

  const levelChipVisible = Boolean(token) && rating?.level != null;
  const myLevel = levelChipVisible && levelOn ? rating!.level : null;

  // `ranked` reste `null` tant que `matches`/`now` ne sont pas chargés (compteur inconnu) —
  // calculé AVANT les hooks ci-dessous pour respecter les règles des hooks (ils doivent être
  // appelés à chaque rendu, jamais conditionnellement, donc avant l'early return plus bas).
  const ranked = matches != null && now != null
    ? sortMatchesByDistance(filterNationalMatches(matches, { datePreset, dateFrom, dateTo, kind, gender, location, myLevel }, now), coords).slice(0, MAX_VISIBLE)
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
  const count = `${list.length} partie${list.length > 1 ? 's' : ''}`;
  const filterCount = partiesFilterCount({ datePreset, dateFrom, dateTo, kind, gender, levelOn, levelChipVisible });
  const resetFilters = () => {
    setDatePreset(null); setDateFrom(null); setDateTo(null); setKind('all'); setGender('all'); setLevelOn(false);
  };

  return (
    <>
      <FiltersToggle count={filterCount} open={filtersOpen} onToggle={() => setFiltersOpen((o) => !o)} onClear={resetFilters} controlsId="parties-facets" />
      {filtersOpen && (
        <div id="parties-facets" style={{ padding: '4px 20px 0' }}>
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
              <FacetGroup label="Type de partie" tint={FILTER_TINTS.typePartie}>
                <FacetChip label="Toutes" tint={FILTER_TINTS.typePartie} active={kind === 'all'} onClick={() => setKind('all')} />
                <FacetChip label="Pour de vrai" tint={FILTER_TINTS.typePartie} active={kind === 'competitive'} onClick={() => setKind('competitive')} />
                <FacetChip label="Pour le fun" tint={FILTER_TINTS.typePartie} active={kind === 'friendly'} onClick={() => setKind('friendly')} />
              </FacetGroup>
              <FacetGroup label="Genre" tint={FILTER_TINTS.genre}>
                <FacetChip label="Tous" tint={FILTER_TINTS.genre} active={gender === 'all'} onClick={() => setGender('all')} />
                <FacetChip label="Féminine" tint={FILTER_TINTS.genre} active={gender === 'WOMEN'} onClick={() => setGender('WOMEN')} />
                <FacetChip label="Mixte" tint={FILTER_TINTS.genre} active={gender === 'MIXED'} onClick={() => setGender('MIXED')} />
              </FacetGroup>
              {levelChipVisible && (
                <FacetGroup label="Niveau" tint={FILTER_TINTS.niveau}>
                  <FacetChip label="À mon niveau" tint={FILTER_TINTS.niveau} active={levelOn} onClick={() => setLevelOn((v) => !v)} />
                </FacetGroup>
              )}
            </div>
          </div>
        </div>
      )}

      <div style={{ padding: '8px 20px 0' }}>
        {list.length === 0 ? (
          <div style={{ padding: '18px 0 6px', textAlign: 'center', fontFamily: th.fontUI, color: th.textMute }}>
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
          <AgendaRail countLabel={count} desktopColumns="272px" mobileColumns="272px" desktopRows={1}
            prevLabel="Parties précédentes" nextLabel="Parties suivantes">
            {list.map((r) => (
              <OpenMatchRailCard key={r.match.id} match={r.match} club={r.match.club} distanceKm={r.distanceKm}
                timezone={r.match.club.timezone} href={clubUrl(r.match.club.slug, `/parties/${r.match.id}`)} />
            ))}
          </AgendaRail>
        )}
      </div>
    </>
  );
}
