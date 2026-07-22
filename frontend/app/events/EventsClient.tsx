'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { api, Tournament, ClubEvent, TournamentGender, ClubEventKind, LessonSummary } from '@/lib/api';
import {
  mergeAgenda, applyAgendaFilters, agendaFacets, agendaCounts, emptyFilterState,
  eventPlacesLabel, EventFilterState, GENDER_LABEL, KIND_LABEL,
} from '@/lib/events';
import { tournamentPlacesLabel } from '@/lib/clubhouse';
import { clubIsMultiSport } from '@/lib/sportBadge';
import { fillRatio, formatDateTimeRange } from '@/lib/tournament';
import { lessonKindLabel } from '@/lib/lessons';
import { fillRatioLesson } from '@/lib/lessons';
import { ACCENTS } from '@/lib/theme';
import { Screen } from '@/components/ui/Screen';
import { ClubNav } from '@/components/ClubNav';
import { AgendaCard } from '@/components/agenda/AgendaCard';
import { EventsFilterBar } from '@/components/events/EventsFilterBar';

export function EventsClient() {
  const { club, loading } = useClub();
  const { th } = useTheme();
  const router = useRouter();
  // État de filtre unifié : source + facettes multi-sélection + fenêtre « Quand ».
  const [fstate, setFstate] = useState<EventFilterState>(emptyFilterState);
  const [tournaments, setTournaments] = useState<Tournament[] | null>(null);
  const [events, setEvents] = useState<ClubEvent[] | null>(null);
  const [lessons, setLessons] = useState<LessonSummary[]>([]);
  // Horloge unique : null au premier rendu (hydration-safe), pour countdowns, jauges et « Quand ».
  const [now, setNow] = useState<Date | null>(null);

  // Synchro URL : on n'écrit qu'après avoir lu l'état initial (évite d'effacer les params au montage).
  const urlReady = useRef(false);

  // État initial lu via window.location (convention du projet — pas de useSearchParams/Suspense) :
  // source ?filtre= + facettes ?cat=&genre=&type=&membres=&quand=, séparées par des virgules.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const next = emptyFilterState();
    const initial = q.get('filtre');
    if (initial === 'competitions' || initial === 'animations' || initial === 'tout' || initial === 'cours') next.source = initial;
    const split = (k: string) => (q.get(k) ? q.get(k)!.split(',').filter(Boolean) : []);
    next.categories = new Set(split('cat'));
    next.genders = new Set(split('genre') as TournamentGender[]);
    next.kinds = new Set(split('type') as ClubEventKind[]);
    next.memberOnly = q.get('membres') === '1';
    const quand = q.get('quand');
    if (quand === 'weekend' || quand === 'thisMonth' || quand === 'days30') next.when = quand;
    setFstate(next);
    urlReady.current = true;
  }, []);

  // Reflète l'état des filtres dans l'URL (replaceState : pas d'entrée d'historique, lien partageable).
  useEffect(() => {
    if (!urlReady.current) return;
    const q = new URLSearchParams();
    if (fstate.source !== 'tout') q.set('filtre', fstate.source);
    if (fstate.categories.size) q.set('cat', [...fstate.categories].join(','));
    if (fstate.genders.size) q.set('genre', [...fstate.genders].join(','));
    if (fstate.kinds.size) q.set('type', [...fstate.kinds].join(','));
    if (fstate.memberOnly) q.set('membres', '1');
    if (fstate.when) q.set('quand', fstate.when);
    const qs = q.toString();
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
  }, [fstate]);

  useEffect(() => {
    const tick = () => setNow(new Date());
    const t = setTimeout(tick, 0);
    const h = setInterval(tick, 60_000);
    return () => { clearTimeout(t); clearInterval(h); };
  }, []);

  useEffect(() => {
    if (!club) return;
    api.getClubTournaments(club.slug).then(setTournaments).catch(() => setTournaments([]));
    api.getClubEvents(club.slug).then(setEvents).catch(() => setEvents([]));
    api.getClubLessons(club.slug).then(setLessons).catch(() => setLessons([]));
  }, [club?.slug]);

  // Agenda complet (toutes sources) pour dériver facettes et compteurs ; puis filtrage.
  const allItems = useMemo(
    () => (tournaments && events ? mergeAgenda(tournaments, events, lessons, new Date()) : null),
    [tournaments, events, lessons],
  );
  const facets = useMemo(() => (allItems ? agendaFacets(allItems) : null), [allItems]);
  const counts = useMemo(
    () => (allItems && facets ? agendaCounts(allItems, fstate, now, facets) : null),
    [allItems, facets, fstate, now],
  );
  const items = useMemo(
    () => (allItems ? applyAgendaFilters(allItems, fstate, now ?? undefined) : null),
    [allItems, fstate, now],
  );
  const hasActive = fstate.when != null || fstate.categories.size > 0 || fstate.genders.size > 0 || fstate.kinds.size > 0 || fstate.memberOnly;

  if (loading || !club) {
    return <div style={{ minHeight: '100vh', background: th.bg, color: th.textFaint, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI }}>Chargement…</div>;
  }

  // Badge sport sur les cartes uniquement si le club propose plusieurs sports.
  const multiSport = clubIsMultiSport(club);

  return (
    <Screen>
      <div style={{ paddingBottom: 40 }}>
        <ClubNav club={club} />

        <div style={{ padding: '18px 20px 0' }}>
          <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 30, color: th.text, letterSpacing: -0.5 }}>Events</div>
        </div>

        {facets && counts && (
          <div style={{ padding: '16px 20px 0' }}>
            <EventsFilterBar
              state={fstate}
              onChange={setFstate}
              facets={facets}
              counts={counts}
              resultCount={items?.length ?? null}
            />
          </div>
        )}

        <div style={{ padding: '18px 20px 0' }}>
          {items === null && <div style={{ fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>}
          {items?.length === 0 && (
            hasActive ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10, fontFamily: th.fontUI, color: th.textMute }}>
                Aucun event ne correspond à vos filtres.
                <button
                  onClick={() => setFstate({ ...fstate, categories: new Set(), genders: new Set(), kinds: new Set(), memberOnly: false, when: null })}
                  style={{
                    border: 'none', cursor: 'pointer', borderRadius: 999, padding: '7px 15px',
                    background: th.ink, color: th.mode === 'floodlit' ? th.text : '#f7f5ee',
                    fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600,
                  }}>
                  Effacer les filtres
                </button>
              </div>
            ) : (
              <div style={{ fontFamily: th.fontUI, color: th.textMute }}>Rien de prévu pour le moment.</div>
            )
          )}
          {items && items.length > 0 && (
            <>
              {/* Grille CSS pure : 1 colonne en mobile, 2 colonnes ≥ 700px (pattern .ch-grid du Club-house). */}
              <style>{`.ev-grid{display:grid;grid-template-columns:1fr;gap:12px;align-items:start}@media(min-width:700px){.ev-grid{grid-template-columns:1fr 1fr}}`}</style>
              <div className="ev-grid">
                {items.map((item) => {
                  if (item.source === 'tournament') {
                    return (
                      <AgendaCard
                        key={`tournament-${item.tournament.id}`}
                        icon="trophy"
                        accent={ACCENTS.apricot}
                        tag={`${item.tournament.category} · ${GENDER_LABEL[item.tournament.gender]}`}
                        title={item.tournament.name}
                        dateLabel={formatDateTimeRange(item.startTime, item.endTime, club.timezone)}
                        deadline={item.tournament.registrationDeadline}
                        now={now}
                        ratio={fillRatio(item.tournament)}
                        places={tournamentPlacesLabel(item.tournament)}
                        extra={item.tournament.entryFee ? `${item.tournament.entryFee} €` : null}
                        sportLabel={multiSport ? (item.tournament.sport?.name ?? null) : null}
                        onClick={() => router.push(`/tournois/${item.tournament.id}`)}
                      />
                    );
                  }
                  if (item.source === 'event') {
                    return (
                      <AgendaCard
                        key={`event-${item.event.id}`}
                        icon="bolt"
                        accent={ACCENTS.violet}
                        tag={KIND_LABEL[item.event.kind]}
                        title={item.event.name}
                        dateLabel={formatDateTimeRange(item.startTime, item.endTime, club.timezone)}
                        deadline={item.event.registrationDeadline}
                        now={now}
                        ratio={fillRatio({ confirmedCount: item.event.confirmedCount, maxTeams: item.event.capacity })}
                        places={eventPlacesLabel(item.event)}
                        extra={[item.event.price != null && Number(item.event.price) > 0 ? `${Number(item.event.price)} €` : null, item.event.memberOnly ? 'Membres' : null].filter(Boolean).join(' · ') || null}
                        sportLabel={multiSport ? (item.event.sport?.name ?? null) : null}
                        onClick={() => router.push(`/events/${item.event.id}`)}
                      />
                    );
                  }
                  // source === 'lesson'
                  return (
                    <AgendaCard
                      key={`lesson-${item.lesson.id}`}
                      icon="user"
                      accent={ACCENTS.blue}
                      tag={lessonKindLabel(item.lesson.lessonKind)}
                      title={item.lesson.series?.title ?? 'Cours'}
                      dateLabel={formatDateTimeRange(item.startTime, item.endTime, club.timezone)}
                      deadline={item.startTime}
                      now={now}
                      ratio={fillRatioLesson(item.lesson.confirmedCount, item.lesson.capacity)}
                      places={{ text: `${item.lesson.confirmedCount} / ${item.lesson.capacity} inscrits`, urgent: item.lesson.confirmedCount >= item.lesson.capacity }}
                      extra={`Coach : ${item.lesson.coach.name}`}
                      sportLabel={multiSport ? (item.lesson.sport?.name ?? null) : null}
                      onClick={() => router.push(`/cours/${item.lesson.id}`)}
                    />
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </Screen>
  );
}
