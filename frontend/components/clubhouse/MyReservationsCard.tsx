'use client';
import Link from 'next/link';
import { MyReservation } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Icon } from '@/components/ui/Icon';
import { cardStyle } from '@/components/clubhouse/SectionHeader';

const fmt = (iso: string, tz: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('fr-FR', { ...opts, timeZone: tz }).format(new Date(iso));
const hour = (iso: string, tz: string) =>
  fmt(iso, tz, { hour: '2-digit', minute: '2-digit' }).replace(':', 'h');

// Carte « Vos réservations » du Club-house : tuile-date + plage horaire + terrain,
// même langage que la carte Prochains events (posées côte à côte dans la grille agenda).
// Clic sur une ligne → gestion (dialog d'annulation portée par ClubHouse).
export function MyReservationsCard({ reservations, onManage }: {
  reservations: MyReservation[]; onManage: (r: MyReservation) => void;
}) {
  const { th } = useTheme();
  if (reservations.length === 0) return null;
  return (
    <div style={{ ...cardStyle(th), padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
        <span aria-hidden="true" style={{ width: 28, height: 28, borderRadius: 9, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: th.mode === 'floodlit' ? `${th.accent}26` : `${th.accent}40` }}>
          <Icon name="ticket" size={15} color={th.mode === 'floodlit' ? th.accent : th.ink} />
        </span>
        <span style={{ fontFamily: th.fontUI, fontWeight: 800, fontSize: 14, color: th.text }}>Vos réservations</span>
        <Link href="/me/reservations" style={{ marginLeft: 'auto', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, color: th.accent, textDecoration: 'none', whiteSpace: 'nowrap' }}>
          Tout voir →
        </Link>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {reservations.map((r) => {
          const tz = r.resource.club.timezone;
          return (
            <button key={r.id} onClick={() => onManage(r)}
              aria-label={`Gérer la réservation ${r.resource.name} du ${fmt(r.startTime, tz, { weekday: 'long', day: 'numeric', month: 'long' })}`}
              style={{
                border: 'none', cursor: 'pointer', textAlign: 'left', width: '100%',
                background: th.surface2, borderRadius: 12, padding: '10px 12px',
                display: 'flex', alignItems: 'center', gap: 12,
              }}>
              <span aria-hidden="true" style={{
                width: 44, flexShrink: 0, borderRadius: 10, padding: '6px 0', textAlign: 'center',
                background: th.mode === 'floodlit' ? `${th.accent}22` : `${th.accent}36`,
              }}>
                <span style={{ display: 'block', fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 17, lineHeight: 1.1, color: th.mode === 'floodlit' ? th.accent : th.ink }}>
                  {fmt(r.startTime, tz, { day: 'numeric' })}
                </span>
                <span style={{ display: 'block', fontFamily: th.fontUI, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: th.textMute }}>
                  {fmt(r.startTime, tz, { month: 'short' }).replace('.', '')}
                </span>
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontFamily: th.fontUI, fontSize: 14, fontWeight: 700, color: th.text }}>
                  {fmt(r.startTime, tz, { weekday: 'short' })} {hour(r.startTime, tz)} → {hour(r.endTime, tz)}
                </span>
                <span style={{ display: 'block', fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.resource.name}
                </span>
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, color: th.textMute, whiteSpace: 'nowrap' }}>
                Gérer<Icon name="arrowR" size={14} color={th.textMute} />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
