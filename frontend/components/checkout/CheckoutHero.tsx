'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { courtFormat } from '@/lib/courtType';
import { formatHour } from '@/lib/bookingErrors';
import { HERO_GRADIENT } from '@/components/agenda/AgendaHero';

export interface CheckoutHeroProps {
  slot: { startTime: string; endTime: string; offPeak?: boolean };
  timezone?: string;
  resourceName?: string;
  format?: string;
  sportKey?: string;
  totalPrice: string;   // e.g. "25" or "24,50"
  perPerson: string;    // e.g. "6,25"
  capacity: number;
  durLabel: string;
  phase: 'holding' | 'held' | 'error';
  mm: string; ss: string; urgent: boolean;   // timer
  secondsLeft: number; holdSeconds: number;   // for the progress bar width
}

/** Libellé lisible du sport à partir de sa clé technique (padel, tennis…). */
function sportLabel(sportKey?: string): string {
  switch (sportKey) {
    case 'padel':  return 'Padel';
    case 'tennis': return 'Tennis';
    default:       return sportKey ? sportKey.charAt(0).toUpperCase() + sportKey.slice(1) : 'Sport';
  }
}

/**
 * Hero de la page checkout — brume bleue claire, texte encre (fort contraste).
 * Regroupe court + sport/format + date/horaire + prix + timer de hold en un
 * seul bloc immersif, distinct du hero sombre `AgendaHero` (tournois/events).
 */
export function CheckoutHero({
  slot, timezone, resourceName, format, sportKey,
  totalPrice, perPerson, capacity, durLabel,
  phase, mm, ss, urgent, secondsLeft, holdSeconds,
}: CheckoutHeroProps) {
  const { th } = useTheme();
  const dateLabel = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: timezone }).format(new Date(slot.startTime));

  return (
    <div
      data-testid="checkout-hero"
      style={{
        borderRadius: 18,
        padding: '18px',
        color: '#181510',
        background: HERO_GRADIENT,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: th.fontUI, fontWeight: 700,
          fontSize: 12, color: '#181510', background: 'rgba(255,255,255,0.65)', borderRadius: 999, padding: '5px 11px',
        }}>
          🎾 {sportLabel(sportKey)} · {courtFormat(format) ?? 'Double'}
        </span>
        {phase !== 'error' && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: th.fontMono, fontWeight: 700,
            fontSize: 12.5, color: urgent ? ACCENTS.coral : '#181510', background: '#fff', borderRadius: 999,
            padding: '5px 11px', boxShadow: '0 1px 3px rgba(24,21,14,0.15)', whiteSpace: 'nowrap',
          }}>
            ⏱ {mm}:{ss}
          </span>
        )}
      </div>

      <div style={{ fontFamily: th.fontDisplay, fontSize: 21, fontWeight: 700, letterSpacing: -0.4, color: '#181510', marginTop: 14 }}>
        {resourceName ?? 'Court'}
      </div>
      <div style={{ fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, color: 'rgba(24,21,14,0.65)', marginTop: 4, textTransform: 'capitalize' }}>
        {dateLabel}
      </div>
      <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: 'rgba(24,21,14,0.65)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
        {formatHour(slot.startTime, timezone)} → {formatHour(slot.endTime, timezone)} · {durLabel}
        {slot.offPeak && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 700, color: '#b45309', background: '#fde9c8', borderRadius: 6, padding: '2px 7px' }}>
            heures creuses
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: th.fontDisplay, fontSize: 28, fontWeight: 800, letterSpacing: -0.9, color: '#181510' }}>{totalPrice}€</span>
        <span style={{ fontFamily: th.fontUI, fontSize: 12.5, color: 'rgba(24,21,14,0.65)' }}>soit {perPerson} € / joueur · {capacity} j.</span>
      </div>

      {phase !== 'error' && (
        <div style={{ marginTop: 16, height: 4, borderRadius: 999, background: 'rgba(24,21,14,0.10)', overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: 999,
            width: `${Math.max(0, Math.min(100, (secondsLeft / holdSeconds) * 100))}%`,
            background: urgent ? ACCENTS.coral : ACCENTS.blue,
            transition: 'width 1s linear',
          }} />
        </div>
      )}
    </div>
  );
}
