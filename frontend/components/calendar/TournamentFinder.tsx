'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { api, NationalTournament, TournamentGender } from '@/lib/api';
import { clubUrl } from '@/lib/clubUrl';
import { ACCENTS } from '@/lib/theme';
import { AgendaCard } from '@/components/agenda/AgendaCard';
import { AgendaRail } from '@/components/agenda/AgendaRail';
import { FacetPanel } from '@/components/calendar/FacetPanel';
import { FiltersToggle } from '@/components/ui/FiltersToggle';
import { tournamentPlacesLabel } from '@/lib/clubhouse';
import { setSpansMultipleSports } from '@/lib/sportBadge';
import { fillRatio, formatDateTimeRange } from '@/lib/tournament';
import { norm } from '@/lib/members';
import {
  CalendarFilterState, DatePreset, emptyCalendarState, applyFilters, calendarFacets,
  DATE_PRESET_KEYS, activeFilterCount, calendarStateToStored, storedToCalendarState,
  DISCOVER_TOURNOIS_FILTERS_KEY,
} from '@/lib/tournamentCalendar';

const GENDER_LABEL: Record<string, string> = { MEN: 'Messieurs', WOMEN: 'Dames', MIXED: 'Mixte' };

// Plafond d'affichage quand le calendrier est embarqué (page /decouvrir, `hideTitle`) : ce
// n'est pas un flux exhaustif là-bas, contrairement à la page /tournois autonome (filtres +
// « Effacer » restent le bon outil pour aller plus loin). Étagère 2 lignes : ce plafond ne
// limite plus le nombre de colonnes visibles, juste le total chargé dans l'étagère.
const MAX_VISIBLE = 8;

// Clés propres à writeUrl (préservées à la lecture, purgées puis réécrites — le reste de la
// query string de la page hôte, ex. ?tab=, doit survivre intact).
const OWN_URL_KEYS = ['quand', 'du', 'au', 'dept', 'cat', 'genre', 'near'] as const;

export interface TournamentFinderProps {
  /** Coordonnées fournies par une barre de localisation externe (page hôte) : active « Autour
   * de moi » sans jamais solliciter navigator.geolocation (déjà obtenues ailleurs). */
  coords?: { lat: number; lng: number } | null;
  /** Filtre libre par ville OU département du club (recherche insensible accents/casse), posé
   * AVANT le calcul des facettes — les compteurs reflètent donc le sous-ensemble filtré. */
  city?: string;
  /** Codes département (ex. ['75','69']) fournis par une barre de localisation externe — filtre
   * additif à `city`, posé lui aussi avant le calcul des facettes. */
  deptCodes?: string[];
  /** Masque le titre H1 « Calendrier des tournois » (embarqué sous un onglet d'une page hôte
   * qui porte déjà son propre titre). */
  hideTitle?: boolean;
  /** Tournois préchargés par le parent (évite un double fetch, pattern `UpcomingTournaments`) ;
   * `undefined` = le composant fetch lui-même (comportement historique). */
  items?: NationalTournament[] | null;
  /** Rappelé avec le nombre de résultats affichés (page hôte : compteur d'onglet). */
  onCount?: (n: number) => void;
}

export function TournamentFinder({
  coords = null, city = '', deptCodes = [], hideTitle = false, items: preloaded, onCount,
}: TournamentFinderProps = {}) {
  const { th } = useTheme();
  const [fetched, setFetched] = useState<NationalTournament[] | null>(null);
  const selfFetch = preloaded === undefined;
  const [state, setState] = useState<CalendarFilterState>(emptyCalendarState());
  // Panneau de facettes replié par défaut (mémoire de session = badge « Filtres · N », pas
  // l'ouverture) : sur /decouvrir la barre de localisation en haut couvre déjà le lieu, le
  // reste (Quand/Catégorie/Genre) tient derrière ce bouton pour ne pas manger l'écran.
  const [filtersOpen, setFiltersOpen] = useState(false);
  // coords stored in a ref (not state) so that setting coords and nearMe=true
  // happen in a single state update, avoiding ordering races in the test environment.
  const coordsRef = useRef<{ lat: number; lng: number } | null>(null);
  const [nearBusy, setNearBusy] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  const urlReady = useRef(false);

  // Chargement (sauté si `items` préchargé par le parent)
  useEffect(() => {
    if (!selfFetch) return;
    api.listNationalTournaments().then(setFetched).catch(() => setFetched([]));
  }, [selfFetch]);
  const items = selfFetch ? fetched : (preloaded ?? null);

  // Horloge (hydration-safe : null au 1er rendu)
  useEffect(() => {
    const tick = () => setNow(new Date());
    const t = setTimeout(tick, 0);
    const h = setInterval(tick, 60_000);
    return () => { clearTimeout(t); clearInterval(h); };
  }, []);

  // État initial : l'URL prime (lien partageable ?quand=&du=&au=&dept=&cat=&genre=&near=),
  // sinon repli sur la mémoire de session (localStorage) — la géoloc n'est jamais rejouée
  // (nearMe absent du stockage). Aucun des deux → état vide.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const hasUrlFilters = OWN_URL_KEYS.some((k) => q.get(k) != null);
    if (hasUrlFilters) {
      const split = (k: string) => (q.get(k) ? q.get(k)!.split(',').filter(Boolean) : []);
      const preset = q.get('quand');
      setState((s) => ({
        ...s,
        datePreset: (DATE_PRESET_KEYS as string[]).includes(preset ?? '') ? (preset as DatePreset) : null,
        from: q.get('du') || null,
        to: q.get('au') || null,
        deptCodes: new Set(split('dept')),
        categories: new Set(split('cat')),
        genders: new Set(split('genre') as TournamentGender[]),
        nearMe: q.get('near') === '1',
      }));
    } else {
      try {
        const raw = localStorage.getItem(DISCOVER_TOURNOIS_FILTERS_KEY);
        if (raw) setState((s) => ({ ...storedToCalendarState(JSON.parse(raw)), nearMe: s.nearMe }));
      } catch { /* stockage indisponible (mode privé/quota) : on reste sur l'état vide */ }
    }
    urlReady.current = true;
  }, []);

  // Écriture de l'URL (replaceState : lien partageable). Part de la query string ACTUELLE
  // (pas d'une neuve) pour préserver les paramètres étrangers de la page hôte (ex. ?tab=) —
  // seules les 7 clés propres à ce composant sont purgées puis réécrites.
  useEffect(() => {
    if (!urlReady.current) return;
    const q = new URLSearchParams(window.location.search);
    for (const k of OWN_URL_KEYS) q.delete(k);
    if (state.datePreset && !state.from && !state.to) q.set('quand', state.datePreset);
    if (state.from) q.set('du', state.from);
    if (state.to) q.set('au', state.to);
    if (state.deptCodes.size) q.set('dept', [...state.deptCodes].join(','));
    if (state.categories.size) q.set('cat', [...state.categories].join(','));
    if (state.genders.size) q.set('genre', [...state.genders].join(','));
    if (state.nearMe) q.set('near', '1');
    const qs = q.toString();
    window.history.replaceState(null, '', (qs ? `?${qs}` : window.location.pathname) + window.location.hash);
    // Miroir en mémoire de session (nearMe exclu par calendarStateToStored).
    try { localStorage.setItem(DISCOVER_TOURNOIS_FILTERS_KEY, JSON.stringify(calendarStateToStored(state))); } catch { /* stockage indisponible */ }
  }, [state]);

  // Coordonnées fournies par la page hôte (barre de localisation partagée) : seed le ref puis
  // active nearMe, sans jamais appeler navigator.geolocation (déjà obtenues ailleurs). Sur [coords]
  // pour couvrir le cas où la prop arrive après le montage (géoloc résolue en différé côté hôte).
  useEffect(() => {
    if (!coords) return;
    coordsRef.current = coords;
    setState((s) => (s.nearMe ? s : { ...s, nearMe: true }));
  }, [coords]);

  // Toggle d'une valeur dans un Set d'une dimension
  function toggleIn(key: 'deptCodes' | 'categories' | 'genders', value: string) {
    setState((s) => {
      const next = new Set(s[key] as Set<string>);
      if (next.has(value)) next.delete(value); else next.add(value);
      return { ...s, [key]: next };
    });
  }

  const toggleNearMe = () => {
    if (state.nearMe) { setState((s) => ({ ...s, nearMe: false })); return; }
    // If coords already cached (user toggled off then on), re-enable directly.
    if (coordsRef.current) { setState((s) => ({ ...s, nearMe: true })); return; }
    setNearBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // Write coords to ref BEFORE the state update so the memo sees them
        // at the next render without a separate coords-state render cycle.
        coordsRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setState((s) => ({ ...s, nearMe: true }));
        setNearBusy(false);
      },
      () => { setNearBusy(false); },
      { timeout: 8000 },
    );
  };

  // Filtre localisation (props externes, ex. barre de localisation partagée) : posé AVANT le
  // calcul des facettes et des résultats, pour que compteurs ET liste reflètent le même
  // sous-ensemble. `deptCodes` filtre par code département exact, `city` matche ville OU nom
  // de département (recherche libre insensible accents/casse).
  const locItems = useMemo(() => {
    if (!items) return items;
    let out = items;
    if (deptCodes.length) out = out.filter((t) => t.club.departmentCode != null && deptCodes.includes(t.club.departmentCode.toUpperCase()));
    if (city.trim()) {
      const needle = norm(city.trim());
      out = out.filter((t) => (t.club.city != null && norm(t.club.city).includes(needle))
        || (t.club.department != null && norm(t.club.department).includes(needle)));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, city, deptCodes.join(',')]);

  const facets = useMemo(() => (locItems && now ? calendarFacets(locItems, state, now) : null), [locItems, state, now]);
  // results: pass coords only when nearMe active; coordsRef.current is always
  // current at render time because it is written before setState.
  const results = useMemo(
    () => (locItems && now
      ? applyFilters(locItems, state, now, state.nearMe ? coordsRef.current ?? undefined : undefined)
      : null),
    [locItems, state, now],
  );
  // Embarqué (Où jouer) : grille plafonnée à MAX_VISIBLE — la page /tournois autonome
  // reste un flux complet (results non tronqué).
  const visibleResults = useMemo(
    () => (results && hideTitle ? results.slice(0, MAX_VISIBLE) : results),
    [results, hideTitle],
  );

  // Vue cross-club : chip sport seulement si l'ensemble affiché couvre plusieurs sports.
  const showSport = setSpansMultipleSports((visibleResults ?? []).map((r) => r.tournament.sport?.key));

  // Notifie la page hôte du nombre de résultats affichés (ex. compteur d'onglet).
  useEffect(() => { if (visibleResults) onCount?.(visibleResults.length); }, [visibleResults?.length, onCount]);

  const clearFilters = () => setState((s) => ({ ...emptyCalendarState(), nearMe: s.nearMe }));
  const filterCount = activeFilterCount(state);
  const hasActiveFilters = filterCount > 0;

  return (
    // Le 100vh ne vaut que pour la page /tournois autonome — embarquée dans /decouvrir
    // (hideTitle), la section reprend sa hauteur naturelle (fini l'écran vide sans tournoi).
    <div style={{ paddingBottom: hideTitle ? 0 : 48, background: th.bg, minHeight: hideTitle ? undefined : '100vh' }}>
      {!hideTitle && (
        <div style={{ padding: '22px 20px 0' }}>
          <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 30, color: th.text, letterSpacing: -0.5 }}>Calendrier des tournois</div>
          <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, marginTop: 6 }}>Toutes les épreuves des clubs Palova, partout en France.</p>
        </div>
      )}

      {facets && (
        <>
          {/* Barre repliable : le panneau de facettes est fermé par défaut (le lieu vit dans la
              pilule de /decouvrir). Un badge « Filtres · N » signale les filtres mémorisés,
              sinon on ne comprend pas pourquoi la liste est réduite alors qu'aucun filtre n'est
              visible ; « Effacer » vide sans avoir à déplier. */}
          <FiltersToggle count={filterCount} open={filtersOpen} onToggle={() => setFiltersOpen((o) => !o)} onClear={clearFilters} controlsId="tournois-facets" />
          {filtersOpen && (
            <div id="tournois-facets">
              <FacetPanel
                facets={facets}
                state={state}
                onToggleDept={(c) => toggleIn('deptCodes', c)}
                onToggleCategory={(c) => toggleIn('categories', c)}
                onToggleGender={(g) => toggleIn('genders', g)}
                onSetPreset={(p) => setState((s) => ({ ...s, datePreset: p, from: null, to: null }))}
                onSetRange={(from, to) => setState((s) => ({ ...s, from, to, datePreset: null }))}
                onToggleNearMe={toggleNearMe}
                onClear={clearFilters}
                nearMeBusy={nearBusy}
              />
            </div>
          )}
        </>
      )}

      {hideTitle ? (
        <div style={{ padding: '18px 20px 0' }}>
          {visibleResults === null && <div style={{ fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>}
          {visibleResults?.length === 0 && (
            <div style={{ textAlign: 'center', padding: '18px 0 6px' }}>
              <div style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute }}>
                {hasActiveFilters ? 'Aucun tournoi ne correspond à votre recherche.' : 'Aucun tournoi à venir pour le moment.'}
              </div>
              {hasActiveFilters && (
                <button onClick={clearFilters} style={{
                  marginTop: 12, border: 'none', cursor: 'pointer', borderRadius: 999, padding: '9px 18px',
                  fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700, background: th.accent, color: th.onAccent,
                }}>
                  Effacer les filtres
                </button>
              )}
            </div>
          )}
          {visibleResults != null && visibleResults.length > 0 && (
            <AgendaRail
              countLabel={`${visibleResults.length} tournoi${visibleResults.length > 1 ? 's' : ''}`}
              prevLabel="Tournois précédents" nextLabel="Tournois suivants"
            >
              {visibleResults.map(({ tournament: t, distanceKm }) => {
                const subtitle = [t.club.name, t.club.city, distanceKm != null ? `${Math.round(distanceKm)} km` : null].filter(Boolean).join(' · ');
                return (
                  <AgendaCard
                    key={t.id}
                    icon="trophy"
                    accent={ACCENTS.apricot}
                    tag={`${t.category} · ${GENDER_LABEL[t.gender]}`}
                    title={t.name}
                    subtitle={subtitle}
                    dateLabel={formatDateTimeRange(t.startTime, t.endTime, t.club.timezone)}
                    deadline={t.registrationDeadline}
                    now={now}
                    ratio={fillRatio(t)}
                    places={tournamentPlacesLabel(t)}
                    price={t.entryFee ? `${t.entryFee} €` : null}
                    sportLabel={showSport ? (t.sport?.name ?? null) : null}
                    onClick={() => { window.location.href = clubUrl(t.club.slug, `/tournois/${t.id}`); }}
                  />
                );
              })}
            </AgendaRail>
          )}
        </div>
      ) : (
        <div style={{ padding: '18px 20px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {visibleResults === null && <div style={{ fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>}
          {visibleResults?.length === 0 && (
            <div style={{ textAlign: 'center', padding: '18px 0 6px' }}>
              <div style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute }}>
                {hasActiveFilters ? 'Aucun tournoi ne correspond à votre recherche.' : 'Aucun tournoi à venir pour le moment.'}
              </div>
              {hasActiveFilters && (
                <button onClick={clearFilters} style={{
                  marginTop: 12, border: 'none', cursor: 'pointer', borderRadius: 999, padding: '9px 18px',
                  fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700, background: th.accent, color: th.onAccent,
                }}>
                  Effacer les filtres
                </button>
              )}
            </div>
          )}
          {visibleResults?.map(({ tournament: t, distanceKm }) => {
            const subtitle = [t.club.name, t.club.city, distanceKm != null ? `${Math.round(distanceKm)} km` : null].filter(Boolean).join(' · ');
            return (
              <AgendaCard
                key={t.id}
                icon="trophy"
                accent={ACCENTS.apricot}
                tag={`${t.category} · ${GENDER_LABEL[t.gender]}`}
                title={t.name}
                subtitle={subtitle}
                dateLabel={formatDateTimeRange(t.startTime, t.endTime, t.club.timezone)}
                deadline={t.registrationDeadline}
                now={now}
                ratio={fillRatio(t)}
                places={tournamentPlacesLabel(t)}
                price={t.entryFee ? `${t.entryFee} €` : null}
                sportLabel={showSport ? (t.sport?.name ?? null) : null}
                onClick={() => { window.location.href = clubUrl(t.club.slug, `/tournois/${t.id}`); }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
