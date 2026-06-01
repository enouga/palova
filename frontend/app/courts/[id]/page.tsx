'use client';
import { useState, useCallback, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, TimeSlot, Reservation, SSEEvent, PublicResource } from '@/lib/api';
import CourtCalendar from '@/components/CourtCalendar';
import BookingModal from '@/components/BookingModal';
import { useCourtSSE } from '@/lib/useCourtSSE';
import { ThemeProvider, useTheme } from '@/lib/ThemeProvider';
import { Screen } from '@/components/ui/Screen';
import { TopBar, Chip, LiveDot, Placeholder, Segmented } from '@/components/ui/atoms';
import { Icon } from '@/components/ui/Icon';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function nextDays(count: number) {
  const out: { key: string; dow: string; day: string }[] = [];
  const base = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    out.push({
      key: d.toISOString().slice(0, 10),
      dow: new Intl.DateTimeFormat('fr-FR', { weekday: 'short' }).format(d).replace('.', ''),
      day: new Intl.DateTimeFormat('fr-FR', { day: 'numeric' }).format(d),
    });
  }
  return out;
}

function CourtBooking() {
  const params = useParams();
  const router = useRouter();
  const { th } = useTheme();
  const resourceId = typeof params.id === 'string' ? params.id : '';

  const [token, setToken]               = useState<string | null>(null);
  const [resource, setResource]         = useState<PublicResource | null>(null);
  const [date, setDate]                 = useState(todayISO());
  const [duration, setDuration]         = useState<60 | 90 | 120>(60);
  const [slots, setSlots]               = useState<TimeSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [showModal, setShowModal]       = useState(false);
  const [confirmed, setConfirmed]       = useState<Reservation | null>(null);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);

  const days = nextDays(9);
  const tz = resource?.club.timezone;

  useEffect(() => {
    const t = localStorage.getItem('token');
    if (!t) { router.replace('/login'); return; }
    setToken(t);
  }, [router]);

  useEffect(() => {
    if (!resourceId) return;
    api.getResource(resourceId).then(setResource).catch(() => setResource(null));
  }, [resourceId]);

  const loadSlots = useCallback(async (d: string, dur: 60 | 90 | 120) => {
    if (!resourceId) return;
    setLoading(true);
    setSelectedSlot(null);
    try {
      setError(null);
      setSlots(await api.getAvailability(resourceId, d, dur));
    } catch (e) {
      setSlots([]);
      setError((e as Error).message || 'Impossible de charger les créneaux.');
    } finally {
      setLoading(false);
    }
  }, [resourceId]);

  useEffect(() => { loadSlots(date, duration); }, [loadSlots, date, duration]);

  const handleSSE = useCallback((event: SSEEvent) => {
    if (!event.startTime || event.type === 'connected') return;
    setSlots((prev) => prev.map((slot) =>
      slot.startTime !== event.startTime ? slot : { ...slot, available: event.type === 'slot_released' },
    ));
  }, []);

  useCourtSSE(resourceId || null, handleSSE);

  const freeCount = slots.filter((s) => s.available).length;
  const indoor = resource ? resource.attributes?.surface !== 'outdoor' : true;
  const backTo = resource?.club.slug ? `/c/${resource.club.slug}` : '/clubs';

  return (
    <Screen>
      <div style={{ paddingBottom: 30 }}>
        <TopBar
          title={resource ? resource.name : 'Réservation'}
          onBack={() => router.push(backTo)}
          right={resource ? <Chip tone="accent" icon={indoor ? 'indoor' : 'sun'}>{indoor ? 'Indoor' : 'Plein air'}</Chip> : undefined}
        />

        <div style={{ padding: '0 16px' }}>
          <Placeholder label={`photo · ${resource?.name ?? 'terrain'}`} height={132} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <LiveDot />
              <span style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.text }}>Disponibilités en direct</span>
            </div>
            <span style={{ fontFamily: th.fontMono, fontSize: 12, color: th.textFaint }}>maj. en direct</span>
          </div>
        </div>

        {confirmed && (
          <div style={{ margin: '16px 16px 0', display: 'flex', alignItems: 'center', gap: 10, background: th.accent, color: th.onAccent, borderRadius: 14, padding: '12px 14px' }}>
            <Icon name="check" size={18} color={th.onAccent} stroke={2.4} />
            <span style={{ fontFamily: th.fontUI, fontSize: 14, fontWeight: 600 }}>Réservation confirmée !</span>
          </div>
        )}

        <div className="sp-noscroll" style={{ display: 'flex', gap: 9, overflowX: 'auto', padding: '18px 16px 4px' }}>
          {days.map((d) => {
            const on = d.key === date;
            return (
              <button key={d.key} onClick={() => setDate(d.key)} style={{
                border: 'none', cursor: 'pointer', flexShrink: 0, width: 58, padding: '11px 0', borderRadius: 16,
                background: on ? th.ink : th.surface2, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
              }}>
                <span style={{ fontFamily: th.fontUI, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, color: on ? (th.mode === 'floodlit' ? th.textMute : '#cfccc0') : th.textMute }}>{d.dow}</span>
                <span style={{ fontFamily: th.fontDisplay, fontSize: 24, fontWeight: 600, lineHeight: 1, color: on ? (th.mode === 'floodlit' ? th.text : '#f7f5ee') : th.text }}>{d.day}</span>
              </button>
            );
          })}
        </div>

        <div style={{ padding: '16px 16px 0' }}>
          <Segmented<60 | 90 | 120> value={duration} onChange={setDuration}
            options={[{ value: 60, label: '1 h' }, { value: 90, label: '1 h 30' }, { value: 120, label: '2 h' }]} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 16px 12px' }}>
          <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 14, color: th.text }}>
            Créneaux <span style={{ color: th.textMute, fontWeight: 500 }}>· {freeCount} libres</span>
          </span>
          <div style={{ display: 'flex', gap: 14 }}>
            {([['Libre', th.surface2], ['Réservé', th.takenBg]] as const).map(([l, c]) => (
              <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: th.fontUI, fontSize: 11.5, color: th.textMute }}>
                <span style={{ width: 11, height: 11, borderRadius: 4, background: c }} />{l}
              </span>
            ))}
          </div>
        </div>

        <div style={{ padding: '0 16px' }}>
          {error && (
            <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.onAccent, background: th.accent, padding: '11px 14px', borderRadius: 12, fontWeight: 600, marginBottom: 12 }}>{error}</div>
          )}
          {loading ? (
            <div style={{ padding: '40px 0', textAlign: 'center', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>
          ) : (
            <CourtCalendar
              slots={slots}
              onSelectSlot={(slot) => { setSelectedSlot(slot); setShowModal(true); }}
              selectedSlot={selectedSlot}
              timezone={tz}
            />
          )}
        </div>
      </div>

      {showModal && selectedSlot && (
        <BookingModal
          slot={selectedSlot}
          resourceId={resourceId}
          pricePerHour={resource?.pricePerHour ?? '0'}
          duration={duration}
          token={token ?? ''}
          timezone={tz}
          onClose={() => { setShowModal(false); setSelectedSlot(null); }}
          onConfirmed={(reservation) => { setShowModal(false); setConfirmed(reservation); loadSlots(date, duration); }}
        />
      )}
    </Screen>
  );
}

// Applique l'accent du club autour du parcours de réservation (branding).
export default function CourtPage() {
  const params = useParams();
  const resourceId = typeof params.id === 'string' ? params.id : '';
  const [accent, setAccent] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!resourceId) return;
    api.getResource(resourceId).then((r) => setAccent(r.club.accentColor)).catch(() => {});
  }, [resourceId]);

  return (
    <ThemeProvider accent={accent}>
      <CourtBooking />
    </ThemeProvider>
  );
}
