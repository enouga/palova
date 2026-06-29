'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { api, NationalTournament, TournamentGender } from '@/lib/api';
import { clubUrl } from '@/lib/clubUrl';
import { ACCENTS } from '@/lib/theme';
import { AgendaCard } from '@/components/agenda/AgendaCard';
import { FacetPanel } from '@/components/calendar/FacetPanel';
import { tournamentPlacesLabel } from '@/lib/clubhouse';
import { setSpansMultipleSports } from '@/lib/sportBadge';
import { fillRatio, formatDateTimeRange } from '@/lib/tournament';
import {
  CalendarFilterState, DatePreset, emptyCalendarState, applyFilters, calendarFacets,
} from '@/lib/tournamentCalendar';

const GENDER_LABEL: Record<string, string> = { MEN: 'Messieurs', WOMEN: 'Dames', MIXED: 'Mixte' };

export function TournamentFinder() {
  const { th } = useTheme();
  const [items, setItems] = useState<NationalTournament[] | null>(null);
  const [state, setState] = useState<CalendarFilterState>(emptyCalendarState());
  // coords stored in a ref (not state) so that setting coords and nearMe=true
  // happen in a single state update, avoiding ordering races in the test environment.
  const coordsRef = useRef<{ lat: number; lng: number } | null>(null);
  const [nearBusy, setNearBusy] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  const urlReady = useRef(false);

  // Chargement
  useEffect(() => { api.listNationalTournaments().then(setItems).catch(() => setItems([])); }, []);

  // Horloge (hydration-safe : null au 1er rendu)
  useEffect(() => {
    const tick = () => setNow(new Date());
    const t = setTimeout(tick, 0);
    const h = setInterval(tick, 60_000);
    return () => { clearTimeout(t); clearInterval(h); };
  }, []);

  // Lecture initiale de l'URL : ?quand=&du=&au=&dept=&cat=&genre=&near=
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const split = (k: string) => (q.get(k) ? q.get(k)!.split(',').filter(Boolean) : []);
    const preset = q.get('quand') as DatePreset | null;
    setState((s) => ({
      ...s,
      datePreset: (['weekend', 'thisMonth', 'days30', 'months3'] as string[]).includes(preset ?? '') ? preset : null,
      from: q.get('du') || null,
      to: q.get('au') || null,
      deptCodes: new Set(split('dept')),
      categories: new Set(split('cat')),
      genders: new Set(split('genre') as TournamentGender[]),
      nearMe: q.get('near') === '1',
    }));
    urlReady.current = true;
  }, []);

  // Écriture de l'URL (replaceState : lien partageable)
  useEffect(() => {
    if (!urlReady.current) return;
    const q = new URLSearchParams();
    if (state.datePreset && !state.from && !state.to) q.set('quand', state.datePreset);
    if (state.from) q.set('du', state.from);
    if (state.to) q.set('au', state.to);
    if (state.deptCodes.size) q.set('dept', [...state.deptCodes].join(','));
    if (state.categories.size) q.set('cat', [...state.categories].join(','));
    if (state.genders.size) q.set('genre', [...state.genders].join(','));
    if (state.nearMe) q.set('near', '1');
    const qs = q.toString();
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
  }, [state]);

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

  const facets = useMemo(() => (items && now ? calendarFacets(items, state, now) : null), [items, state, now]);
  // results: pass coords only when nearMe active; coordsRef.current is always
  // current at render time because it is written before setState.
  const results = useMemo(
    () => (items && now
      ? applyFilters(items, state, now, state.nearMe ? coordsRef.current ?? undefined : undefined)
      : null),
    [items, state, now],
  );
  // Vue cross-club : chip sport seulement si l'ensemble affiché couvre plusieurs sports.
  const showSport = setSpansMultipleSports((results ?? []).map((r) => r.tournament.sport?.key));

  return (
    <div style={{ paddingBottom: 48, background: th.bg, minHeight: '100vh' }}>
      <div style={{ padding: '22px 20px 0' }}>
        <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 30, color: th.text, letterSpacing: -0.5 }}>Calendrier des tournois</div>
        <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, marginTop: 6 }}>Toutes les épreuves des clubs Palova, partout en France.</p>
      </div>

      {facets && (
        <FacetPanel
          facets={facets}
          state={state}
          onToggleDept={(c) => toggleIn('deptCodes', c)}
          onToggleCategory={(c) => toggleIn('categories', c)}
          onToggleGender={(g) => toggleIn('genders', g)}
          onSetPreset={(p) => setState((s) => ({ ...s, datePreset: p, from: null, to: null }))}
          onSetRange={(from, to) => setState((s) => ({ ...s, from, to, datePreset: null }))}
          onToggleNearMe={toggleNearMe}
          onClear={() => setState((s) => ({ ...emptyCalendarState(), nearMe: s.nearMe }))}
          nearMeBusy={nearBusy}
        />
      )}

      <div style={{ padding: '18px 20px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {results === null && <div style={{ fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>}
        {results?.length === 0 && <div style={{ fontFamily: th.fontUI, color: th.textMute }}>Aucun tournoi ne correspond à votre recherche.</div>}
        {results?.map(({ tournament: t, distanceKm }) => {
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
              extra={t.entryFee ? `${t.entryFee} €` : null}
              sportLabel={showSport ? (t.sport?.name ?? null) : null}
              onClick={() => { window.location.href = clubUrl(t.club.slug, `/tournois/${t.id}`); }}
            />
          );
        })}
      </div>
    </div>
  );
}
