'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useClub } from '@/lib/ClubProvider';
import { useAuth } from '@/lib/useAuth';
import { useTheme } from '@/lib/ThemeProvider';
import { api, ClubEventDetail, MyEventRegistration } from '@/lib/api';
import { eventPlacesLabel, KIND_LABEL } from '@/lib/events';
import { Screen } from '@/components/ui/Screen';
import { Btn } from '@/components/ui/atoms';
import { ClubNav } from '@/components/ClubNav';

const ERROR_LABEL: Record<string, string> = {
  MEMBERSHIP_REQUIRED: 'Cet event est réservé aux membres du club.',
  MEMBERSHIP_BLOCKED: 'Votre compte est bloqué dans ce club — rapprochez-vous de l’accueil.',
  ALREADY_REGISTERED: 'Vous êtes déjà inscrit.',
  REGISTRATION_CLOSED: 'Les inscriptions sont closes.',
  REGISTRATION_LOCKED: 'La date limite est passée, la désinscription se fait à l’accueil.',
  EVENT_NOT_OPEN: 'Cet event n’est pas ouvert aux inscriptions.',
};

function fmt(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso)).replace(':', 'h');
}

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { club, loading } = useClub();
  const { token, ready } = useAuth();
  const { th } = useTheme();
  const router = useRouter();
  const [event, setEvent] = useState<ClubEventDetail | null>(null);
  const [myReg, setMyReg] = useState<MyEventRegistration | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(() => {
    api.getEvent(id).then(setEvent).catch(() => setNotFound(true));
    if (token) api.getMyEvents(token).then((regs) => setMyReg(regs.find((r) => r.event.id === id) ?? null)).catch(() => setMyReg(null));
  }, [id, token]);

  useEffect(() => { if (ready) load(); }, [ready, load]);

  if (loading || !club || (!event && !notFound)) {
    return <div style={{ minHeight: '100vh', background: th.bg, color: th.textFaint, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI }}>Chargement…</div>;
  }

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); load(); }
    catch (e) { const code = (e as Error).message; setError(ERROR_LABEL[code] ?? code); }
    finally { setBusy(false); }
  };

  const deadlinePassed = event ? new Date(event.registrationDeadline) <= new Date() : false;
  const full = event ? event.capacity != null && event.confirmedCount >= event.capacity : false;
  const places = event ? eventPlacesLabel(event) : null;

  return (
    <Screen>
      <div style={{ paddingBottom: 40 }}>
        <ClubNav club={club} />

        {notFound || !event ? (
          <div style={{ padding: '40px 20px', fontFamily: th.fontUI, color: th.textMute }}>Cet event n’existe pas ou n’est plus visible.</div>
        ) : (
          <div style={{ padding: '18px 20px 0', maxWidth: 640 }}>
            <span style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute }}>
              {KIND_LABEL[event.kind]}{event.memberOnly ? ' · réservé aux membres' : ''}
            </span>
            <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 30, color: th.text, letterSpacing: -0.5, margin: '6px 0 0' }}>{event.name}</h1>

            <div style={{ marginTop: 16, background: th.surface, borderRadius: 16, padding: '16px 18px', boxShadow: `inset 0 0 0 1px ${th.line}`, display: 'flex', flexDirection: 'column', gap: 8, fontFamily: th.fontUI, fontSize: 14.5, color: th.text }}>
              <div>📅 {fmt(event.startTime, event.club.timezone)}{event.endTime ? ` → ${fmt(event.endTime, event.club.timezone)}` : ''}</div>
              <div>✍️ Inscriptions jusqu’au {fmt(event.registrationDeadline, event.club.timezone)}</div>
              {event.price != null && Number(event.price) > 0 && <div>💶 {Number(event.price)} € — règlement au club</div>}
              {places && <div style={{ color: places.urgent ? '#e05656' : th.text, fontWeight: places.urgent ? 700 : 400 }}>👥 {places.text}</div>}
            </div>

            {event.description && (
              <p style={{ fontFamily: th.fontUI, fontSize: 14.5, color: th.textMute, marginTop: 16, whiteSpace: 'pre-wrap' }}>{event.description}</p>
            )}

            {error && <div style={{ marginTop: 16, background: th.accent, color: th.onAccent, borderRadius: 12, padding: '11px 14px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>{error}</div>}

            <div style={{ marginTop: 20 }}>
              {!token && ready && (
                <Btn onClick={() => router.push('/login')} icon="user">Se connecter pour s’inscrire</Btn>
              )}
              {token && !myReg && !deadlinePassed && (
                <Btn onClick={() => act(() => api.registerEvent(event.id, token))} disabled={busy} icon="check">
                  {busy ? '…' : full ? 'Rejoindre la liste d’attente' : 'S’inscrire'}
                </Btn>
              )}
              {token && myReg && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <span style={{ fontFamily: th.fontUI, fontSize: 14.5, fontWeight: 700, color: th.text }}>
                    {myReg.status === 'CONFIRMED' ? '✅ Vous êtes inscrit.' : '⏳ Vous êtes en liste d’attente.'}
                  </span>
                  {!deadlinePassed && (
                    <Btn onClick={() => act(() => api.cancelEventRegistration(event.id, token))} disabled={busy} icon="x" variant="ghost">
                      {busy ? '…' : 'Se désinscrire'}
                    </Btn>
                  )}
                </div>
              )}
              {deadlinePassed && !myReg && (
                <span style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute }}>Les inscriptions sont closes.</span>
              )}
            </div>
          </div>
        )}
      </div>
    </Screen>
  );
}
