'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useClub } from '@/lib/ClubProvider';
import { useAuth } from '@/lib/useAuth';
import { useTheme } from '@/lib/ThemeProvider';
import { api, ClubEventDetail, EventParticipant, MyEventRegistration } from '@/lib/api';
import StripePaymentStep from '@/components/StripePaymentStep';
import { eventPlacesLabel, KIND_LABEL } from '@/lib/events';
import { fillRatio, formatDateTime, formatDateTimeRange, timelineSteps, waitlistPosition } from '@/lib/tournament';
import { Screen } from '@/components/ui/Screen';
import { Btn } from '@/components/ui/atoms';
import { Icon } from '@/components/ui/Icon';
import { ClubNav } from '@/components/ClubNav';
import { AgendaHero, MetaCardsRow, MetaCard } from '@/components/agenda/AgendaHero';
import { clubIsMultiSport } from '@/lib/sportBadge';
import { AboutCard, RegistrationStatus, LeaveButton } from '@/components/agenda/RegistrationUI';
import { TournamentTimeline } from '@/components/tournament/TournamentTimeline';
import { ShareActions } from '@/components/tournament/ShareActions';
import { ParticipantsGrid } from '@/components/event/ParticipantsGrid';

const ERROR_LABEL: Record<string, string> = {
  MEMBERSHIP_REQUIRED: 'Cet event est réservé aux membres du club.',
  MEMBERSHIP_BLOCKED: "Votre compte est bloqué dans ce club — rapprochez-vous de l'accueil.",
  ALREADY_REGISTERED: 'Vous êtes déjà inscrit.',
  REGISTRATION_CLOSED: 'Les inscriptions sont closes.',
  REGISTRATION_LOCKED: "La date limite est passée, la désinscription se fait à l'accueil.",
  EVENT_NOT_OPEN: "Cet event n'est pas ouvert aux inscriptions.",
};

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { club, loading } = useClub();
  const { token, ready } = useAuth();
  const { th } = useTheme();
  const router = useRouter();
  const [event, setEvent] = useState<ClubEventDetail | null>(null);
  const [participants, setParticipants] = useState<EventParticipant[] | null>(null);
  const [myReg, setMyReg] = useState<MyEventRegistration | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  // Horloge unique : null au premier rendu (hydration-safe), pour hero et timeline.
  const [now, setNow] = useState<Date | null>(null);
  // Étape de paiement Stripe en cours (non-null après inscription payante).
  const [payStep, setPayStep] = useState<{ regId: string; mode: 'payment' | 'setup' } | null>(null);

  const load = useCallback(() => {
    api.getEvent(id).then(setEvent).catch(() => setNotFound(true));
    api.getEventParticipants(id).then(setParticipants).catch(() => setParticipants([]));
    if (token) api.getMyEvents(token).then((regs) => setMyReg(regs.find((r) => r.event.id === id) ?? null)).catch(() => setMyReg(null));
  }, [id, token]);

  useEffect(() => { if (ready) load(); }, [ready, load]);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const t = setTimeout(tick, 0);
    const h = setInterval(tick, 60_000);
    return () => { clearTimeout(t); clearInterval(h); };
  }, []);

  if (loading || !club || (!event && !notFound)) {
    return <div style={{ minHeight: '100vh', background: th.bg, color: th.textFaint, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI }}>Chargement…</div>;
  }

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); load(); }
    catch (e) { const code = (e as Error).message; setError(ERROR_LABEL[code] ?? code); }
    finally { setBusy(false); }
  };

  /** Inscription à un event — gère le cas payant (Stripe) et le cas gratuit (flux actuel). */
  const doRegister = async () => {
    if (!token) return;
    setBusy(true); setError(null);
    try {
      const res = await api.registerEvent(event!.id, token);
      if (res.payment) {
        setPayStep({ regId: res.registration.id, mode: res.payment.mode });
      } else {
        load();
      }
    } catch (e) {
      const code = (e as Error).message;
      setError(ERROR_LABEL[code] ?? code);
    } finally {
      setBusy(false);
    }
  };

  if (notFound || !event) {
    return (
      <Screen>
        <div style={{ paddingBottom: 40 }}>
          <ClubNav club={club} />
          <div style={{ padding: '40px 20px', fontFamily: th.fontUI, color: th.textMute }}>Cet event n'existe pas ou n'est plus visible.</div>
        </div>
      </Screen>
    );
  }

  const tz = event.club.timezone;
  const deadlinePassed = new Date(event.registrationDeadline) <= new Date();
  const full = event.capacity != null && event.confirmedCount >= event.capacity;
  const places = eventPlacesLabel(event);
  const myWaitlistPos = myReg && participants ? waitlistPosition(participants, myReg.id) : null;

  const metaCards: MetaCard[] = [
    { icon: 'calendar', label: event.endTime ? 'Horaire' : 'Début', value: formatDateTimeRange(event.startTime, event.endTime, tz) },
    { icon: 'clock', label: 'Clôture des inscriptions', value: formatDateTime(event.registrationDeadline, tz) },
    ...(event.price != null && Number(event.price) > 0 ? [{
      icon: 'euro',
      label: 'Prix',
      value: `${Number(event.price)} € — ${event.requirePrepayment ? 'à régler en ligne' : 'règlement au club'}`,
    } as MetaCard] : []),
  ];

  return (
    <Screen>
      <div style={{ paddingBottom: 48 }}>
        <ClubNav club={club} />

        <div style={{ padding: '14px 20px 0' }}>
          <button onClick={() => router.push('/events')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.textMute, padding: 0 }}>
            <Icon name="chevL" size={16} color={th.textMute} />Tous les events
          </button>
        </div>

        <AgendaHero
          pills={[
            ...(clubIsMultiSport(club) && event.sport ? [{ label: event.sport.name }] : []),
            { label: KIND_LABEL[event.kind], strong: true },
            ...(event.memberOnly ? [{ label: 'Réservé aux membres' }] : []),
          ]}
          title={event.name}
          subtitle={event.club.name}
          deadline={event.registrationDeadline}
          now={now}
          ratio={fillRatio({ confirmedCount: event.confirmedCount, maxTeams: event.capacity })}
          counter={
            (event.capacity != null ? `${event.confirmedCount}/${event.capacity} inscrits` : `${event.confirmedCount} inscrit${event.confirmedCount > 1 ? 's' : ''}`)
            + (event.waitlistCount > 0 ? ` · ${event.waitlistCount} en attente` : '')
          }
          places={places}
        />
        <MetaCardsRow cards={metaCards} />
        <ShareActions item={event} uidPrefix="event" />
        {now && <TournamentTimeline steps={timelineSteps(event, now)} tz={tz} />}

        {event.description && <AboutCard text={event.description} />}

        <div style={{ padding: '24px 20px 0' }}>
          {error && <div style={{ background: '#3a1d1d', color: '#ff6b6b', borderRadius: 11, padding: '11px 13px', fontFamily: th.fontUI, fontSize: 13.5, marginBottom: 14 }}>{error}</div>}

          {!token && ready && (
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <Btn onClick={() => router.push('/login')} icon="user">Se connecter pour s'inscrire</Btn>
            </div>
          )}
          {/* Étape Stripe — paiement ou enregistrement carte (liste d'attente) */}
          {payStep && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {payStep.mode === 'setup' && (
                <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, lineHeight: 1.5 }}>
                  Votre carte sera débitée seulement si une place se libère.
                </div>
              )}
              <StripePaymentStep
                type={payStep.mode}
                amountLabel={`${Number(event.price ?? 0)} €`}
                createIntent={async () => {
                  const r = await api.createRegistrationIntent('events', event.id, payStep.regId, token!);
                  return { clientSecret: r.clientSecret, stripeAccountId: r.stripeAccountId };
                }}
                confirm={payStep.mode === 'payment'
                  ? async (ids) => { await api.confirmRegistrationPayment('events', event.id, payStep.regId, ids.stripePaymentIntentId ?? '', token!); }
                  : async () => {}}
                onSuccess={() => { setPayStep(null); load(); }}
                onCancel={() => setPayStep(null)}
              />
            </div>
          )}

          {token && !myReg && !deadlinePassed && !payStep && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              {full && <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, textAlign: 'center' }}>Event complet : vous serez placé en liste d&apos;attente.</div>}
              <Btn onClick={doRegister} disabled={busy} icon="check">
                {busy ? '…' : full ? "Rejoindre la liste d'attente" : "S'inscrire"}
              </Btn>
            </div>
          )}
          {token && myReg && (
            <div style={{ background: th.surface, borderRadius: 16, padding: '16px 18px', boxShadow: `inset 0 0 0 1px ${th.line}`, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <RegistrationStatus confirmed={myReg.status === 'CONFIRMED'} waitlistPos={myWaitlistPos} />
              {!deadlinePassed ? (
                <>
                  <div style={{ height: 1, background: th.line }} />
                  <LeaveButton onClick={() => act(() => api.cancelEventRegistration(event.id, token))} disabled={busy} label={busy ? '…' : 'Se désinscrire'} />
                </>
              ) : (
                <span style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textFaint }}>Inscriptions closes : la désinscription se fait à l'accueil.</span>
              )}
            </div>
          )}
          {deadlinePassed && !myReg && token && (
            <span style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute }}>Les inscriptions sont closes.</span>
          )}
        </div>

        {/* Liste publique des inscrits */}
        <div style={{ padding: '28px 0 0' }}>
          <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 18, color: th.text, marginBottom: 12, padding: '0 20px' }}>Inscrits</div>
          <ParticipantsGrid participants={participants} myRegId={myReg?.id} />
        </div>
      </div>
    </Screen>
  );
}
