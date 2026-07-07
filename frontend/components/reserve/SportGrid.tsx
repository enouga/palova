'use client';
import { useTheme } from '@/lib/ThemeProvider';
import type { ClubAvailability, TimeSlot } from '@/lib/api';
import { gridColumns } from '@/lib/reserveView';

function fmtHour(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: tz })
    .format(new Date(iso)).replace(':', 'h');
}

// Vue « grille » d'une section sport : lignes = terrains, colonnes = heures à venir.
// Colonne terrain figée (sticky), la table défile horizontalement (.sp-scroll-x).
// Mêmes données et même onSlot que la vue cartes → clic d'une cellule libre = même confirmation.
export function SportGrid({ items, nowMs, timezone, slotAllowed, onSlot, sportKey, duration }: {
  items: ClubAvailability[];
  nowMs: number;
  timezone: string;
  slotAllowed: (iso: string) => boolean;
  onSlot: (resourceId: string, price: string, slot: TimeSlot, duration: number,
           format: string | undefined, sportKey: string, resourceName: string) => void;
  sportKey: string;
  duration: number;
}) {
  const { th } = useTheme();
  const cols = gridColumns(items, nowMs);
  const dark = th.mode === 'floodlit';
  const freeBg = `${th.accent}${dark ? '4d' : '2e'}`;        // accent translucide (libre), plus dense en thème sombre
  const offPeakBg = `${th.accentWarm}${dark ? '4d' : '33'}`; // ambré translucide (heures creuses)
  const takenFill = dark ? 'rgba(255,255,255,0.06)' : th.takenBg; // pris : discret mais visible
  const takenBorder = `inset 0 0 0 1px ${th.line}`;               // contour → distingue « pris » d'une case vide (pas de créneau)

  if (cols.length === 0) {
    return <div style={{ padding: '12px 0', fontFamily: th.fontUI, fontSize: 13, color: th.textFaint }}>Aucun créneau à venir ce jour.</div>;
  }

  return (
    <div>
      <div className="sp-scroll-x">
        <table style={{ borderCollapse: 'separate', borderSpacing: 4 }}>
          <thead>
            <tr>
              <th style={{ position: 'sticky', left: 0, background: th.bg, zIndex: 1 }} />
              {cols.map((c) => (
                <th key={c} style={{ fontFamily: th.fontMono, fontSize: 11, fontWeight: 500,
                  color: th.textMute, padding: '0 2px', whiteSpace: 'nowrap' }}>{fmtHour(c, timezone)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map(({ resource, slots }) => {
              const format = typeof resource.attributes?.format === 'string' ? resource.attributes.format : undefined;
              return (
                <tr key={resource.id}>
                  <td style={{ position: 'sticky', left: 0, background: th.bg, zIndex: 1, paddingRight: 10, whiteSpace: 'nowrap' }}>
                    <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 12.5, color: th.text }}>{resource.name}</span>
                    <span style={{ display: 'block', fontFamily: th.fontUI, fontSize: 11, color: th.textMute }}>
                      {Number(resource.price)}€
                      {resource.offPeakPrice && <span style={{ color: th.accentWarm }}> · {Number(resource.offPeakPrice)}€ creux</span>}
                    </span>
                  </td>
                  {cols.map((c) => {
                    const slot = slots.find((s) => s.startTime === c);
                    const isPast = slot ? new Date(slot.startTime).getTime() <= nowMs : false;
                    const free = !!slot && slot.available && !isPast && slotAllowed(slot.startTime);
                    if (free && slot) {
                      return (
                        <td key={c}>
                          <button type="button" aria-label={`${resource.name} ${fmtHour(c, timezone)}`}
                            title={slot.offPeak ? 'Heures creuses' : undefined}
                            onClick={() => onSlot(resource.id, slot.price, slot, duration, format, sportKey, resource.name)}
                            style={{ border: 'none', cursor: 'pointer', width: '100%', minWidth: 44, height: 34,
                              borderRadius: 7, background: slot.offPeak ? offPeakBg : freeBg }} />
                        </td>
                      );
                    }
                    return (
                      <td key={c}>
                        <div aria-hidden="true" style={{ minWidth: 44, height: 34, borderRadius: 7,
                          background: slot ? takenFill : 'transparent', boxShadow: slot ? takenBorder : 'none' }} />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8, fontFamily: th.fontUI, fontSize: 11.5, color: th.textMute }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 11, height: 11, borderRadius: 3, background: freeBg }} /> libre</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 11, height: 11, borderRadius: 3, background: offPeakBg }} /> heures creuses</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 11, height: 11, borderRadius: 3, background: takenFill, boxShadow: takenBorder }} /> pris</span>
      </div>
    </div>
  );
}
