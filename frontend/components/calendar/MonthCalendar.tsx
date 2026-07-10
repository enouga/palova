'use client';

import { Fragment } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { inkOn } from '@/lib/theme';
import { Icon } from '@/components/ui/Icon';
import { CalendarEntry, monthGrid, monthLabel, agendaKindMeta } from '@/lib/calendar';

const DOW = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
const GAP = 4;
const RIBBON_H = 7;

export function MonthCalendar({
  year, month, byDay, selected, todayKey, onSelect, onNavigate,
}: {
  year: number;
  month: number;
  byDay: Map<string, CalendarEntry[]>;
  selected: string | null;
  todayKey: string;
  onSelect: (key: string) => void;
  onNavigate: (delta: 1 | -1) => void;
}) {
  const { th } = useTheme();
  const weeks = monthGrid(year, month);
  // Couleurs par type, source de vérité unique (et non th.accent, surchargé par la couleur du club).
  const resaColor = agendaKindMeta('reservation').color;
  const tournamentColor = agendaKindMeta('tournament').color;
  const eventColor = agendaKindMeta('event').color;

  const navBtn = (label: string, icon: 'chevL' | 'chevR', delta: 1 | -1) => (
    <button onClick={() => onNavigate(delta)} aria-label={label}
      style={{
        width: 38, height: 38, borderRadius: 12, border: 'none', cursor: 'pointer', flexShrink: 0,
        background: th.surface2, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
      <Icon name={icon} size={18} color={th.text} />
    </button>
  );

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {navBtn('Mois précédent', 'chevL', -1)}
        <div style={{ flex: 1, textAlign: 'center', fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 18, color: th.text, textTransform: 'capitalize' }}>
          {monthLabel(year, month)}
        </div>
        {navBtn('Mois suivant', 'chevR', 1)}
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '6px 16px', marginTop: 10, fontFamily: th.fontUI, fontSize: 11.5, color: th.textMute }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 12, height: 12, borderRadius: 999, background: resaColor }} />Réservation
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 16, height: RIBBON_H, borderRadius: RIBBON_H / 2, background: tournamentColor }} />Tournoi
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 16, height: RIBBON_H, borderRadius: RIBBON_H / 2, background: eventColor }} />Event
        </span>
      </div>

      <div className="pl-cal-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: GAP, marginTop: 12 }}>
        {DOW.map((d) => (
          <div key={d} style={{ textAlign: 'center', fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: th.textFaint, paddingBottom: 2 }}>
            {d}
          </div>
        ))}
        {weeks.flat().map((cell) => {
          const entries = byDay.get(cell.key) ?? [];
          const reservations = entries.filter((e) => e.kind === 'reservation');
          const tournament = entries.find((e) => e.kind === 'tournament');
          const event = entries.find((e) => e.kind === 'event');
          const barCount = (tournament ? 1 : 0) + (event ? 1 : 0);
          // La pastille-compteur se pose au-dessus des rubans (0, 1 ou 2 empilés).
          // Positions/tailles = variables CSS de .pl-cal-grid (compactées ≤520px).
          const chipBottom = barCount >= 2 ? 'var(--cal-cb2)' : barCount === 1 ? 'var(--cal-cb1)' : 'var(--cal-cb0)';
          const isToday = cell.key === todayKey;
          const isSelected = cell.key === selected;
          const dim = !cell.inMonth;
          // Anneau du « bouton de départ » d'un ruban : couleur du fond de la cellule pour le détacher.
          const knobRing = isSelected ? th.accent : dim ? 'transparent' : th.surface;
          // Ruban continu multi-jours (tournoi/event) : déborde sur le gap, arrondi aux extrémités,
          // + petit bouton à icône posé sur le jour de début pour identifier le type.
          const multiDayBar = (
            e: Extract<CalendarEntry, { dayKeys: string[] }>, bottom: string, color: string,
            marker: string, icon: 'trophy' | 'bolt',
          ) => (
            <Fragment key={marker}>
              <span data-marker={marker}
                style={{
                  position: 'absolute', bottom, height: 'var(--cal-ribbon)', background: color, opacity: e.past ? 0.4 : 1,
                  left: cell.key === e.startKey ? 6 : -(GAP / 2),
                  right: cell.key === e.endKey ? 6 : -(GAP / 2),
                  borderTopLeftRadius: cell.key === e.startKey ? 999 : 0,
                  borderBottomLeftRadius: cell.key === e.startKey ? 999 : 0,
                  borderTopRightRadius: cell.key === e.endKey ? 999 : 0,
                  borderBottomRightRadius: cell.key === e.endKey ? 999 : 0,
                }} />
              {cell.key === e.startKey && (
                <span aria-hidden
                  style={{
                    position: 'absolute', left: 4, bottom: `calc(${bottom} - 4px)`,
                    width: 'var(--cal-knob)', height: 'var(--cal-knob)', borderRadius: '50%',
                    background: color, opacity: e.past ? 0.4 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: `0 0 0 1.5px ${knobRing}`,
                  }}>
                  <Icon name={icon} size={9} color={inkOn(color)} />
                </span>
              )}
            </Fragment>
          );
          return (
            <button key={cell.key} data-day-key={cell.key} data-today={isToday ? 'true' : undefined}
              aria-pressed={isSelected} aria-label={`Jour ${cell.key}`}
              onClick={() => onSelect(cell.key)}
              style={{
                position: 'relative', borderRadius: 12, border: 'none', cursor: 'pointer',
                minHeight: 'var(--cal-h-min)', maxHeight: 'var(--cal-h-max)', aspectRatio: 'var(--cal-ar)',
                padding: 'var(--cal-pad)', textAlign: 'var(--cal-align)' as 'left', verticalAlign: 'top',
                background: isSelected ? th.accent : dim ? 'transparent' : th.surface,
                boxShadow: isSelected ? 'none' : dim ? 'none' : `inset 0 0 0 1px ${th.line}`,
                WebkitTapHighlightColor: 'transparent',
              }}>
              <span style={{
                fontFamily: th.fontUI, fontSize: 12.5, fontWeight: isToday ? 700 : 500,
                color: isSelected ? inkOn(th.accent) : dim ? th.textFaint : isToday ? th.accent : th.text,
              }}>
                {cell.day}
              </span>
              {isToday && !isSelected && (
                <span aria-hidden style={{ position: 'absolute', top: 8, right: 8, width: 6, height: 6, borderRadius: '50%', background: th.accent }} />
              )}
              {reservations.length > 0 && (
                <span data-marker="reservation"
                  style={{
                    position: 'absolute', bottom: chipBottom,
                    left: 'var(--cal-chip-left)', right: 'var(--cal-chip-right)',
                    transform: 'translateX(var(--cal-chip-tx))',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    minWidth: 'var(--cal-chip)', height: 'var(--cal-chip)', padding: '0 var(--cal-chip-pad)', borderRadius: 999,
                    background: resaColor, color: inkOn(resaColor),
                    fontFamily: th.fontUI, fontSize: 'var(--cal-chip-fs)', fontWeight: 700, lineHeight: 1,
                    boxShadow: `0 0 0 1.5px ${knobRing}`,
                    opacity: reservations.every((e) => e.past) ? 0.4 : 1,
                  }}>
                  {reservations.length}
                </span>
              )}
              {tournament && multiDayBar(tournament, 'var(--cal-rb1)', tournamentColor, 'tournament', 'trophy')}
              {event && multiDayBar(event, tournament ? 'var(--cal-rb2)' : 'var(--cal-rb1)', eventColor, 'event', 'bolt')}
            </button>
          );
        })}
      </div>
    </div>
  );
}
