'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useClub } from '@/lib/ClubProvider';
import { useAuth } from '@/lib/useAuth';
import { useTheme } from '@/lib/ThemeProvider';
import { api, LessonDetail, LessonParticipant, MyLessonEnrollment, EventParticipant } from '@/lib/api';
import { lessonKindLabel, capacityLabel, fillRatioLesson } from '@/lib/lessons';
import { formatDateTimeRange } from '@/lib/tournament';
import { Screen } from '@/components/ui/Screen';
import { Btn } from '@/components/ui/atoms';
import { Icon } from '@/components/ui/Icon';
import { ClubNav } from '@/components/ClubNav';
import { AgendaHero, MetaCardsRow, MetaCard } from '@/components/agenda/AgendaHero';
import { RegistrationStatus, LeaveButton } from '@/components/agenda/RegistrationUI';
import { ParticipantsGrid } from '@/components/event/ParticipantsGrid';
import { dangerBanner } from '@/lib/theme';

const ERROR_LABEL: Record<string, string> = {
  SELF_ENROLL_DISABLED: "L’inscription directe n’est pas disponible — contactez le club.",
  ENROLLMENT_LOCKED: "Trop tard pour se désinscrire — rapprochez-vous de l’accueil.",
  ALREADY_ENROLLED: "Vous êtes déjà inscrit à ce cours.",
  MEMBERSHIP_BLOCKED: "Votre compte est bloqué dans ce club — rapprochez-vous de l’accueil.",
};

/** Mappe un LessonParticipant vers la forme EventParticipant attendue par ParticipantsGrid. */
function toEventParticipant(p: LessonParticipant): EventParticipant {
  return {
    id: p.id,
    status: p.status as 'CONFIRMED' | 'WAITLISTED',
    user: { firstName: p.firstName, lastName: p.lastName, avatarUrl: p.avatarUrl },
  };
}

export default function LessonDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { club, loading } = useClub();
  const { token, ready } = useAuth();
  const { th } = useTheme();
  const router = useRouter();

  const [lesson, setLesson] = useState<LessonDetail | null>(null);
  const [participants, setParticipants] = useState<LessonParticipant[] | null>(null);
  const [myReg, setMyReg] = useState<MyLessonEnrollment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  // Horloge unique : null au premier rendu (hydration-safe).
  const [now, setNow] = useState<Date | null>(null);

  const load = useCallback(() => {
    const lessonPromise = api.getLesson(id).catch(() => null);
    lessonPromise.then((l) => { if (l) setLesson(l); else setNotFound(true); });
    api.getLessonParticipants(id).then(setParticipants).catch(() => setParticipants([]));
    if (token) {
      // Load lesson and enrollments in parallel, then match by lessonId (or seriesId in SERIES mode only)
      Promise.all([lessonPromise, api.getMyLessons(token).catch(() => [])])
        .then(([loadedLesson, list]) => {
          const found = list.find(
            (x) =>
              x.lesson.id === id ||
              (loadedLesson?.series?.enrollmentMode === 'SERIES' &&
                loadedLesson?.seriesId &&
                x.lesson.seriesId === loadedLesson.seriesId)
          ) ?? null;
          setMyReg(found);
        });
    }
  }, [id, token]);

  useEffect(() => { if (ready) load(); }, [ready, load]);

  useEffect(() => {
    const tick = () => setNow(new Date());
    const t = setTimeout(tick, 0);
    const h = setInterval(tick, 60_000);
    return () => { clearTimeout(t); clearInterval(h); };
  }, []);

  if (loading || !club || (!lesson && !notFound)) {
    return (
      <div style={{ minHeight: '100vh', background: th.bg, color: th.textFaint, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI }}>
        Chargement…
      </div>
    );
  }

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try { await fn(); load(); }
    catch (e) { const code = (e as Error).message; setError(ERROR_LABEL[code] ?? code); }
    finally { setBusy(false); }
  };

  if (notFound || !lesson) {
    return (
      <Screen>
        <div style={{ paddingBottom: 40 }}>
          <ClubNav club={club} />
          <div style={{ padding: '40px 20px', fontFamily: th.fontUI, color: th.textMute }}>
            Ce cours n'existe pas ou n'est plus visible.
          </div>
        </div>
      </Screen>
    );
  }

  const tz = lesson.club.timezone;
  const lessonStarted = new Date(lesson.reservation.startTime) <= new Date();
  const full = lesson.confirmedCount >= lesson.capacity;
  const left = lesson.capacity - lesson.confirmedCount;
  const places = left <= 0
    ? { text: "Complet · liste d'attente possible", urgent: false }
    : left <= 3
      ? { text: `Plus que ${left} place${left > 1 ? 's' : ''}`, urgent: true }
      : { text: `${left} places restantes`, urgent: false };

  const counter =
    capacityLabel(lesson.confirmedCount, lesson.capacity) + ' inscrits'
    + (lesson.waitlistCount > 0 ? ` · ${lesson.waitlistCount} en attente` : '');

  const metaCards: MetaCard[] = [
    { icon: 'calendar', label: 'Horaire', value: formatDateTimeRange(lesson.reservation.startTime, lesson.reservation.endTime, tz) },
    { icon: 'user', label: 'Coach', value: lesson.coach.name },
    { icon: 'pin', label: 'Terrain', value: lesson.reservation.resource.name },
  ];

  const enrolled = myReg !== null;
  const waitlistPos = enrolled && participants
    ? (participants.filter((p) => p.status === 'WAITLISTED').findIndex((p) => p.id === myReg!.enrollmentId) + 1) || null
    : null;

  const mappedParticipants: EventParticipant[] | null = participants
    ? participants.map(toEventParticipant)
    : null;

  return (
    <Screen>
      <div style={{ paddingBottom: 48 }}>
        <ClubNav club={club} />

        <div style={{ padding: '14px 20px 0' }}>
          <button
            onClick={() => router.push('/events')}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.textMute, padding: 0 }}
          >
            <Icon name="chevL" size={16} color={th.textMute} />Tous les events
          </button>
        </div>

        <AgendaHero
          pills={[{ label: lessonKindLabel(lesson.lessonKind), strong: true }]}
          title={lesson.series?.title ?? 'Cours'}
          subtitle={lesson.club.name}
          deadline={lesson.reservation.startTime}
          now={now}
          ratio={fillRatioLesson(lesson.confirmedCount, lesson.capacity)}
          counter={counter}
          places={places}
        />
        <MetaCardsRow cards={metaCards} />

        {/* CTA */}
        <div style={{ padding: '24px 20px 0' }}>
          {error && (
            <div style={{ ...dangerBanner(th), marginBottom: 14 }}>
              {error}
            </div>
          )}

          {/* Pas d'auto-inscription */}
          {!lesson.allowSelfEnroll && (
            <div style={{ background: th.surface, borderRadius: 14, padding: '14px 16px', boxShadow: `inset 0 0 0 1px ${th.line}`, fontFamily: th.fontUI, fontSize: 14, color: th.textMute, display: 'flex', alignItems: 'center', gap: 10 }}>
              <Icon name="info" size={16} color={th.textFaint} />
              Inscription gérée par le club — contactez-nous pour vous inscrire.
            </div>
          )}

          {/* Non connecté */}
          {lesson.allowSelfEnroll && !token && ready && (
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <Btn onClick={() => router.push('/login')} icon="user">Se connecter pour s'inscrire</Btn>
            </div>
          )}

          {/* Connecté, pas encore inscrit */}
          {lesson.allowSelfEnroll && token && !enrolled && !lessonStarted && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              {full && (
                <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, textAlign: 'center' }}>
                  Cours complet : vous serez placé en liste d'attente.
                </div>
              )}
              <Btn onClick={() => act(() => api.enrollLesson(id, token))} disabled={busy} icon="check">
                {busy ? '…' : full ? "Rejoindre la liste d'attente" : "S'inscrire"}
              </Btn>
            </div>
          )}

          {/* Cours déjà passé et non inscrit */}
          {lesson.allowSelfEnroll && token && !enrolled && lessonStarted && (
            <span style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute }}>
              Ce cours est passé — l'inscription n'est plus possible.
            </span>
          )}

          {/* Inscrit */}
          {lesson.allowSelfEnroll && token && enrolled && (
            <div style={{ background: th.surface, borderRadius: 16, padding: '16px 18px', boxShadow: `inset 0 0 0 1px ${th.line}`, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <RegistrationStatus
                confirmed={myReg!.status === 'CONFIRMED'}
                waitlistPos={waitlistPos}
              />
              {!lessonStarted ? (
                <>
                  <div style={{ height: 1, background: th.line }} />
                  <LeaveButton
                    onClick={() => act(() => api.cancelLessonEnrollment(id, token))}
                    disabled={busy}
                    label={busy ? '…' : 'Se désinscrire'}
                  />
                </>
              ) : (
                <span style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textFaint }}>
                  Le cours a commencé — la désinscription se fait à l'accueil.
                </span>
              )}
            </div>
          )}
        </div>

        {/* Liste publique des inscrits */}
        <div style={{ padding: '28px 0 0' }}>
          <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 18, color: th.text, marginBottom: 12, padding: '0 20px' }}>
            Inscrits
          </div>
          <ParticipantsGrid participants={mappedParticipants} myRegId={myReg?.enrollmentId} />
        </div>
      </div>
    </Screen>
  );
}
