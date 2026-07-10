'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { api, MyReservation, MyTournamentRegistration, MyEventRegistration, MyLessonEnrollment, CancelledWithRefund, MyMatch, MyQuotaStatus } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { Screen } from '@/components/ui/Screen';
import { BackButton, Segmented, ThemeToggle } from '@/components/ui/atoms';
import { ProfileMenu } from '@/components/ProfileMenu';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Icon } from '@/components/ui/Icon';
import { ClubNav } from '@/components/ClubNav';
import { MonthCalendar } from '@/components/calendar/MonthCalendar';
import { DayPanel } from '@/components/calendar/DayPanel';
import { MyAgendaListItem } from '@/components/calendar/MyAgendaListItem';
import { buildCalendarEntries, entriesByDay, buildAgendaList, agendaEntrySportKey, todayKey, addMonths } from '@/lib/calendar';
import { setSpansMultipleSports } from '@/lib/sportBadge';
import { toCents, fmtEuros } from '@/lib/caisse';
import { MatchResultModal } from '@/components/match/MatchResultModal';
import { QuotaStatus } from '@/components/quota/QuotaStatus';
import { canRecordResult } from '@/lib/match';
import { OpenMatchChatSheet } from '@/components/openmatch/OpenMatchChatSheet';
import { useIsDesktop } from '@/lib/useIsDesktop';

function fmtDate(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).format(new Date(iso));
}
function fmtHour(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso)).replace(':', 'h');
}

export default function MyReservationsPage() {
  const router = useRouter();
  const { th } = useTheme();
  const isDesktop = useIsDesktop(700);
  const { token, ready } = useAuth();
  const { slug, club } = useClub();
  const levelEnabled = club?.levelSystemEnabled !== false;
  // Sur un sous-domaine club, réserver dans CE club (même host) ; sur la plateforme, l'annuaire.
  const reserveHref = slug ? '/reserver' : '/clubs';
  const [items, setItems]     = useState<MyReservation[]>([]);
  const [regs, setRegs]       = useState<MyTournamentRegistration[]>([]);
  const [evts, setEvts]       = useState<MyEventRegistration[]>([]);
  const [lessons, setLessons] = useState<MyLessonEnrollment[]>([]);
  const [tab, setTab]         = useState<'upcoming' | 'past' | 'calendar'>('calendar');
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<MyReservation | null>(null);
  const [cancelling, setCancelling]       = useState(false);
  const [refundMsg, setRefundMsg] = useState<string | null>(null);
  const [matches, setMatches] = useState<MyMatch[]>([]);
  const [recordingFor, setRecordingFor] = useState<MyReservation | null>(null);
  const [chatFor, setChatFor] = useState<MyReservation | null>(null);
  const [ym, setYm] = useState(() => {
    const [y, m] = todayKey().split('-').map(Number);
    return { year: y, month: m };
  });
  const [selectedDay, setSelectedDay] = useState(() => todayKey());
  // Quotas du joueur sur le club courant (sous-domaine club uniquement) — null si pas de quota.
  const [quotaStatus, setQuotaStatus] = useState<MyQuotaStatus | null>(null);

  useEffect(() => { if (ready && !token) router.replace('/login'); }, [ready, token, router]);

  useEffect(() => {
    if (!token || !slug) { setQuotaStatus(null); return; }
    api.getMyQuotaStatus(slug, token).then(setQuotaStatus).catch(() => setQuotaStatus(null));
  }, [token, slug]);

  const load = useCallback(async (t: string) => {
    setLoading(true);
    try {
      setError(null);
      const [reservations, tournaments, events, myLessons] = await Promise.all([
        api.getMyReservations(t),
        api.getMyTournaments(t).catch(() => []), // agenda sans tournois si l'appel échoue
        api.getMyEvents(t).catch(() => []),      // agenda sans events si l'appel échoue
        api.getMyLessons(t).catch(() => []),     // agenda sans cours si l'appel échoue
      ]);
      setItems(reservations);
      setRegs(tournaments);
      setEvts(events);
      setLessons(myLessons);
    }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (token) {
      load(token);
      api.getMyMatches(token).then(setMatches).catch(() => {});
    }
  }, [token, load]);

  // Horloge posée en effet (jamais new Date() au rendu → pas de mismatch d'hydration).
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const h = setInterval(tick, 60_000);
    return () => clearInterval(h);
  }, []);
  const nowDate = useMemo(() => new Date(now ?? 0), [now]);

  // Cloisonnement par club : sur l'app d'un club (slug défini), on ne montre que CE club
  // sauf si le club a ouvert la vision des autres. Sur la plateforme (pas de slug), vue globale.
  const showAll = !slug || !!club?.showOtherClubsReservations;
  const fItems   = useMemo(() => (showAll ? items : items.filter((r) => r.resource.club.slug === slug)), [showAll, items, slug]);
  const fRegs    = useMemo(() => (showAll ? regs  : regs.filter((r) => r.tournament.club.slug === slug)), [showAll, regs, slug]);
  const fEvts    = useMemo(() => (showAll ? evts  : evts.filter((e) => e.event.club.slug === slug)), [showAll, evts, slug]);
  const fLessons = useMemo(() => (showAll ? lessons : lessons.filter((l) => l.lesson.club.slug === slug)), [showAll, lessons, slug]);

  const agenda   = useMemo(() => buildAgendaList(fItems, fRegs, fEvts, fLessons, nowDate), [fItems, fRegs, fEvts, fLessons, nowDate]);
  const upcoming = useMemo(() => agenda.filter((i) => !i.past), [agenda]);
  const past     = useMemo(() => agenda.filter((i) =>  i.past), [agenda]);
  const list = tab === 'past' ? past : upcoming;

  const entries = useMemo(
    () => buildCalendarEntries(fItems, fRegs, fEvts, fLessons, nowDate),
    [fItems, fRegs, fEvts, fLessons, nowDate],
  );
  const byDay = useMemo(() => entriesByDay(entries), [entries]);
  // Vue cross-club / multi-sport : préfixe le sport au sous-titre quand l'agenda couvre plusieurs sports.
  const showSport = useMemo(() => setSpansMultipleSports(entries.map(agendaEntrySportKey)), [entries]);
  const matchFor = (rid: string) => matches.find((m) => m.reservationId === rid);

  const cancel = async (r: MyReservation) => {
    if (!token) return;
    setCancelling(true);
    try {
      setError(null);
      setRefundMsg(null);
      const result = await api.cancelReservation(r.id, token) as CancelledWithRefund;
      setConfirmCancel(null);
      if (result.refunded && result.refunded.length > 0) {
        const totalCents = result.refunded.reduce((sum, x) => sum + toCents(x.amount), 0);
        setRefundMsg(`Remboursé : ${fmtEuros(totalCents)}`);
      }
      await load(token);
    }
    catch (e) { setError((e as Error).message); }
    finally { setCancelling(false); }
  };

  return (
    <Screen>
      <div style={{ paddingBottom: 40 }}>
        {slug && club ? (
          <ClubNav club={club} />
        ) : (
          <div style={{ padding: '28px 20px 6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <BackButton href="/clubs" />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button onClick={() => router.push('/clubs')}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, border: 'none', cursor: 'pointer', borderRadius: 12, padding: '8px 13px', background: th.accent, color: th.onAccent, fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700 }}>
                  <Icon name="plus" size={16} color={th.onAccent} />Réserver
                </button>
                <ThemeToggle />
                <ProfileMenu />
              </div>
            </div>
          </div>
        )}
        <div style={{ padding: '18px 20px 0', fontFamily: th.fontDisplay, fontWeight: 500, fontSize: 38, lineHeight: 1.05, color: th.text, letterSpacing: -0.5 }}>
          Mes réservations
        </div>

        {quotaStatus && (
          // Quotas : rendu IDENTIQUE à Réserver (pastilles à largeur naturelle dans une rangée
          // défilante pleine largeur + fondu au bord droit) → même taille sur les deux pages.
          // (Le mode `compact` reste réservé au conteneur étroit de BookingModal.)
          <div style={{ margin: '14px 0 0', position: 'relative' }}>
            <div className="sp-scroll-x" style={{ display: 'flex', gap: 10, padding: '0 20px' }}>
              <QuotaStatus status={quotaStatus} inline />
            </div>
            <div aria-hidden="true" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 28, background: `linear-gradient(90deg, ${th.bg}00, ${th.bg})`, pointerEvents: 'none' }} />
          </div>
        )}

        <div style={{ padding: '16px 20px 0' }}>
          <Segmented<'upcoming' | 'past' | 'calendar'> value={tab} onChange={setTab}
            options={[
              { value: 'calendar', label: 'Calendrier', icon: 'calendar' },
              { value: 'upcoming', label: 'À venir', icon: 'clock', count: upcoming.length },
              { value: 'past', label: 'Passées', icon: 'check', count: past.length },
            ]} />
        </div>

        {error && <div style={{ margin: '14px 20px 0', background: th.accent, color: th.onAccent, borderRadius: 12, padding: '11px 14px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>{error}</div>}
        {refundMsg && <div style={{ margin: '14px 20px 0', background: th.surface, color: th.text, border: `1px solid ${th.line}`, borderRadius: 12, padding: '11px 14px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>{refundMsg}</div>}

        {tab === 'calendar' ? (
          <div style={{ padding: '18px 20px 0' }}>
            {loading ? (
              <div style={{ padding: '30px 0', textAlign: 'center', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>
            ) : (
              <>
                <MonthCalendar
                  year={ym.year} month={ym.month} byDay={byDay}
                  selected={selectedDay} todayKey={todayKey()}
                  onSelect={setSelectedDay}
                  onNavigate={(delta) => setYm((v) => addMonths(v.year, v.month, delta))}
                />
                <DayPanel
                  dayKey={selectedDay}
                  entries={byDay.get(selectedDay) ?? []}
                  localSlug={slug ?? null}
                  token={token}
                  now={now ?? Date.now()}
                  onCancel={setConfirmCancel}
                  onPlayersChanged={() => { if (token) load(token); }}
                  onOpenChat={setChatFor}
                  onReserve={() => router.push(reserveHref)}
                  reserveLabel={slug ? 'Réserver un créneau' : 'Trouver un club'}
                  canRecord={(r) => now != null && canRecordResult(r, new Date(now)) && !matchFor(r.id)}
                  onRecordResult={levelEnabled ? (r) => setRecordingFor(r) : undefined}
                  matchStatusFor={(rid) => matchFor(rid)?.status}
                  showSport={showSport}
                />
              </>
            )}
          </div>
        ) : (
        <div style={{ display: 'grid', gridTemplateColumns: isDesktop ? '1fr 1fr' : '1fr', gap: 13, alignItems: 'start', padding: '18px 20px 0' }}>
          {loading ? (
            <div style={{ gridColumn: '1 / -1', padding: '30px 0', textAlign: 'center', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>
          ) : list.length === 0 ? (
            <div style={{ gridColumn: '1 / -1', padding: '24px 0', textAlign: 'center', fontFamily: th.fontUI, color: th.textMute }}>
              {tab === 'upcoming' ? 'Rien à venir.' : 'Rien de passé.'}
              {tab === 'upcoming' && (
                <div style={{ marginTop: 12 }}>
                  <button onClick={() => router.push(reserveHref)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 14, fontWeight: 700, color: th.text, textDecoration: 'underline', textUnderlineOffset: 3 }}>{slug ? 'Réserver un créneau' : 'Trouver un club'}</button>
                </div>
              )}
            </div>
          ) : (
            list.map((it) => (
              <MyAgendaListItem
                key={`${it.kind}-${it.id}`}
                item={it}
                now={now ?? Date.now()}
                localSlug={slug ?? null}
                token={token}
                onCancel={setConfirmCancel}
                onPlayersChanged={() => { if (token) load(token); }}
                onOpenChat={setChatFor}
                canRecord={(r) => now != null && canRecordResult(r, new Date(now)) && !matchFor(r.id)}
                onRecordResult={levelEnabled ? (r) => setRecordingFor(r) : undefined}
                existingMatchStatus={it.kind === 'reservation' ? matchFor(it.r.id)?.status : undefined}
                showSport={showSport}
              />
            ))
          )}
        </div>
        )}
      </div>

      {confirmCancel && (
        <ConfirmDialog
          title="Annuler la réservation ?"
          detail={
            <>
              {confirmCancel.resource.name} · {fmtDate(confirmCancel.startTime, confirmCancel.resource.club.timezone)}
              {' · '}
              {fmtHour(confirmCancel.startTime, confirmCancel.resource.club.timezone)}–{fmtHour(confirmCancel.endTime, confirmCancel.resource.club.timezone)}
            </>
          }
          message="Cette action est définitive : le créneau sera remis à disposition des autres joueurs."
          confirmLabel="Annuler la réservation"
          cancelLabel="Retour"
          busy={cancelling}
          onConfirm={() => cancel(confirmCancel)}
          onCancel={() => setConfirmCancel(null)}
        />
      )}
      {recordingFor && token && (
        <MatchResultModal
          reservationId={recordingFor.id}
          players={recordingFor.participants ?? []}
          initialTeams={Object.fromEntries(
            (recordingFor.participants ?? [])
              .filter((p) => p.team === 1 || p.team === 2)
              .map((p) => [p.userId, p.team as 1 | 2]),
          )}
          token={token}
          context={{ whenIso: recordingFor.startTime, tz: recordingFor.resource.club.timezone, courtName: recordingFor.resource.name }}
          onClose={() => setRecordingFor(null)}
          onSaved={() => { setRecordingFor(null); api.getMyMatches(token).then(setMatches).catch(() => {}); }}
        />
      )}
      {chatFor && token && (
        <OpenMatchChatSheet
          slug={chatFor.resource.club.slug} token={token} reservationId={chatFor.id}
          viewerUserId={chatFor.participants.find((p) => p.isOrganizer)?.userId ?? ''}
          viewerIsOrganizer
          title={`${chatFor.resource.name} · ${fmtDate(chatFor.startTime, chatFor.resource.club.timezone)} · ${fmtHour(chatFor.startTime, chatFor.resource.club.timezone)}`}
          timezone={chatFor.resource.club.timezone}
          onClose={() => setChatFor(null)}
        />
      )}
    </Screen>
  );
}
