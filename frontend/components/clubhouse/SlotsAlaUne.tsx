'use client';
import Link from 'next/link';
import { UpcomingSlot } from '@/lib/clubhouse';
import { useTheme } from '@/lib/ThemeProvider';
import { Icon } from '@/components/ui/Icon';
import { cardStyle } from '@/components/clubhouse/SectionHeader';

// Jour + heure au fuseau du club (les créneaux peuvent être sur plusieurs jours).
function formatWhen(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso)).replace(':', 'h');
}

// « Prochains créneaux libres » : les prochains créneaux disponibles (aujourd'hui ou jours
// suivants), lien profond vers la réservation.
export function SlotsAlaUne({ slots, timezone }: { slots: UpcomingSlot[]; timezone: string }) {
  const { th } = useTheme();
  if (slots.length === 0) return null;
  return (
    <div style={{ ...cardStyle(th), padding: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
        <span aria-hidden="true" style={{ width: 28, height: 28, borderRadius: 9, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: th.mode === 'floodlit' ? `${th.accentWarm}26` : `${th.accentWarm}40` }}>
          <Icon name="bolt" size={15} color={th.mode === 'floodlit' ? th.accentWarm : th.ink} />
        </span>
        <span style={{ fontFamily: th.fontUI, fontWeight: 800, fontSize: 14, color: th.text }}>Prochains créneaux libres</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {slots.map((s) => (
          <div key={`${s.resourceId}-${s.slot.startTime}`} style={{ background: th.surface2, borderRadius: 12, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ flex: 1, minWidth: 0, fontFamily: th.fontUI, fontSize: 14, color: th.text }}>
              <span style={{ display: 'block', fontWeight: 700 }}>{formatWhen(s.slot.startTime, timezone)}</span>
              <span style={{ display: 'block', fontSize: 12.5, color: th.textMute, marginTop: 1 }}>
                {s.resourceName} · <span style={{ fontFamily: th.fontMono }}>{Number(s.slot.price)} €</span>
              </span>
            </span>
            <Link href={`/reserver?resource=${s.resourceId}&start=${encodeURIComponent(s.slot.startTime)}`}
              style={{ background: th.accent, color: th.onAccent, borderRadius: 10, padding: '8px 14px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}>
              Réserver
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
