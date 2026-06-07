'use client';
import { TimeSlot } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';

interface CourtCalendarProps {
  slots: TimeSlot[];
  onSelectSlot: (slot: TimeSlot) => void;
  selectedSlot: TimeSlot | null;
  timezone?: string;
}

function formatHour(isoString: string, timezone = 'Europe/Paris'): string {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: timezone })
    .format(new Date(isoString))
    .replace(':', 'h');
}

export default function CourtCalendar({ slots, onSelectSlot, selectedSlot, timezone }: CourtCalendarProps) {
  const { th } = useTheme();

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))', gap: 9 }}>
      {slots.map((slot) => {
        const isSelected = selectedSlot?.startTime === slot.startTime;
        const time = formatHour(slot.startTime, timezone);
        const taken = !slot.available;

        let bg = th.surface2, fg = th.text, sub = 'Libre', subColor = th.textMute, ring = 'none';
        if (taken)      { bg = th.takenBg; fg = th.takenText; sub = 'Réservé'; subColor = th.takenText; }
        if (!taken && slot.offPeak) { sub = 'Creux'; subColor = th.accentWarm; }
        if (isSelected) { bg = th.accent;  fg = th.onAccent;  sub = 'Sélection'; subColor = th.onAccent; }

        const content = (
          <>
            <span style={{ fontFamily: th.fontMono, fontWeight: 500, fontSize: 15, color: fg, letterSpacing: -0.3, textDecoration: taken ? `line-through ${th.takenText}` : 'none' }}>{time}</span>
            <span style={{ fontFamily: th.fontUI, fontWeight: 600, fontSize: 10.5, letterSpacing: 0.3, textTransform: 'uppercase', color: subColor }}>{sub}</span>
          </>
        );

        const cellStyle: React.CSSProperties = {
          border: 'none', borderRadius: 13, padding: '11px 6px',
          background: bg, boxShadow: ring, overflow: 'hidden',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
        };

        if (taken) {
          return <div key={slot.startTime} style={{ ...cellStyle, cursor: 'default' }}>{content}</div>;
        }

        return (
          <button
            key={slot.startTime}
            onClick={() => onSelectSlot(slot)}
            aria-label={`Réserver ${time}`}
            aria-pressed={isSelected}
            className={isSelected ? 'ring-2' : undefined}
            style={{ ...cellStyle, cursor: 'pointer', transition: 'background .2s' }}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}
