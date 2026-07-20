'use client';
import type { CSSProperties } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import type { ClubAvailability, TimeSlot } from '@/lib/api';
import { gridColumns } from '@/lib/reserveView';

function fmtHour(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: tz })
    .format(new Date(iso)).replace(':', 'h');
}

// Largeur d'une colonne horaire : bornée [44,96]. CSS Grid (contrairement à un <table>, qui force
// toujours la largeur du conteneur même à width:'auto') répartit l'espace dispo jusqu'à ce plafond
// puis s'arrête — remplit bien quand il y a assez de créneaux, sans jamais étirer une colonne isolée.
const COL_MIN = 44;
const COL_MAX = 96;

// Vue « grille » d'une section sport : lignes = terrains, colonnes = heures à venir.
// Colonne terrain figée (sticky), la grille défile horizontalement (.sp-scroll-x).
// Mêmes données et même onSlot que la vue cartes → clic d'une cellule libre = même confirmation.
export function SportGrid({ items, nowMs, timezone, slotAllowed, onSlot, sportKey, duration, onTakenSlot }: {
  items: ClubAvailability[];
  nowMs: number;
  timezone: string;
  slotAllowed: (iso: string) => boolean;
  onSlot: (resourceId: string, price: string, slot: TimeSlot, duration: number,
           format: string | undefined, sportKey: string, resourceName: string) => void;
  sportKey: string;
  duration: number;
  // Créneau padel « pris » (à venir) : ouvre la feuille d'alerte. Absent = cellules inertes.
  onTakenSlot?: (startIso: string, endIso: string) => void;
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

  const stickyCol: CSSProperties = { position: 'sticky', left: 0, background: th.bg, zIndex: 1 };

  return (
    <div>
      <div className="sp-scroll-x">
        <div role="table" aria-label="Créneaux disponibles" style={{ display: 'grid',
          gridTemplateColumns: `max-content repeat(${cols.length}, minmax(${COL_MIN}px, ${COL_MAX}px))`, gap: 4 }}>
          {/* display:contents « efface » la rangée de la boîte : ses cellules deviennent des items
              directs de la grille (mêmes colonnes que le reste), tout en gardant le rôle sémantique row. */}
          <div role="row" style={{ display: 'contents' }}>
            <div role="columnheader" style={stickyCol} />
            {cols.map((c) => (
              <div key={c} role="columnheader" style={{ fontFamily: th.fontMono, fontSize: 11, fontWeight: 500,
                color: th.textMute, padding: '0 2px', whiteSpace: 'nowrap', textAlign: 'center' }}>{fmtHour(c, timezone)}</div>
            ))}
          </div>
          {items.map(({ resource, slots }) => {
            const format = typeof resource.attributes?.format === 'string' ? resource.attributes.format : undefined;
            return (
              <div role="row" key={resource.id} style={{ display: 'contents' }}>
                <div role="rowheader" style={{ ...stickyCol, paddingRight: 10, whiteSpace: 'nowrap' }}>
                  <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 12.5, color: th.text }}>{resource.name}</span>
                  <span style={{ display: 'block', fontFamily: th.fontUI, fontSize: 11, color: th.textMute }}>
                    {Number(resource.price)}€
                    {resource.offPeakPrice && <span style={{ color: th.accentWarm }}> · {Number(resource.offPeakPrice)}€ creux</span>}
                  </span>
                </div>
                {cols.map((c) => {
                  const slot = slots.find((s) => s.startTime === c);
                  const isPast = slot ? new Date(slot.startTime).getTime() <= nowMs : false;
                  const free = !!slot && slot.available && !isPast && slotAllowed(slot.startTime);
                  if (free && slot) {
                    return (
                      <div role="cell" key={c}>
                        <button type="button" aria-label={`${resource.name} ${fmtHour(c, timezone)}`}
                          title={slot.offPeak ? 'Heures creuses' : undefined}
                          onClick={() => onSlot(resource.id, slot.price, slot, duration, format, sportKey, resource.name)}
                          style={{ border: 'none', cursor: 'pointer', width: '100%', height: 34,
                            borderRadius: 7, background: slot.offPeak ? offPeakBg : freeBg }} />
                      </div>
                    );
                  }
                  // Cellule vraiment PRISE (à venir, padel, connecté) : cliquable pour créer une alerte.
                  // Parité avec la vue cartes. Passé / non-padel / libre-non-réservable / anonyme restent inertes.
                  if (slot && !isPast && !slot.available && sportKey === 'padel' && onTakenSlot) {
                    return (
                      <div role="cell" key={c}>
                        <button type="button" aria-label={`${resource.name} ${fmtHour(c, timezone)} — pris, être alerté`}
                          title="Créneau pris — être alerté si une partie s'ouvre"
                          onClick={() => onTakenSlot(slot.startTime, slot.endTime)}
                          style={{ border: 'none', cursor: 'pointer', width: '100%', height: 34,
                            borderRadius: 7, background: takenFill, boxShadow: takenBorder }} />
                      </div>
                    );
                  }
                  return (
                    <div role="cell" key={c}>
                      <div aria-hidden="true" style={{ height: 34, borderRadius: 7,
                        background: slot ? takenFill : 'transparent', boxShadow: slot ? takenBorder : 'none' }} />
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8, fontFamily: th.fontUI, fontSize: 11.5, color: th.textMute }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 11, height: 11, borderRadius: 3, background: freeBg }} /> libre</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 11, height: 11, borderRadius: 3, background: offPeakBg }} /> heures creuses</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 11, height: 11, borderRadius: 3, background: takenFill, boxShadow: takenBorder }} /> pris</span>
      </div>
    </div>
  );
}
