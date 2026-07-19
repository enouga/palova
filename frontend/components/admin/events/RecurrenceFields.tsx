'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { DateField } from '@/components/ui/DateField';
import { CANCEL_PRESETS } from '@/lib/onboarding';

export interface RecurrenceState {
  weekday: number;            // 1–7 (1=lundi)
  endDate: string;             // "YYYY-MM-DD"
  deadlineLeadHours: number;
}

const WEEKDAYS = [
  { value: 1, label: 'Lundi' }, { value: 2, label: 'Mardi' }, { value: 3, label: 'Mercredi' },
  { value: 4, label: 'Jeudi' }, { value: 5, label: 'Vendredi' }, { value: 6, label: 'Samedi' },
  { value: 7, label: 'Dimanche' },
];

interface RecurrenceFieldsProps {
  state: RecurrenceState;
  onChange: (next: RecurrenceState) => void;
}

/** Champs de récurrence hebdomadaire (jour, date de fin, délai de clôture) — création d'une série d'animations. */
export function RecurrenceFields({ state, onChange }: RecurrenceFieldsProps) {
  const { th } = useTheme();
  const label = { fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginBottom: 5, marginTop: 12 } as const;
  const input = { width: '100%', boxSizing: 'border-box' as const, background: th.surface2, border: `1px solid ${th.line}`, borderRadius: 10, padding: '9px 11px', fontFamily: th.fontUI, fontSize: 14, color: th.text };

  return (
    <div style={{ background: th.surface2, borderRadius: 12, padding: 14, marginTop: 12 }}>
      <div style={label}>
        <label htmlFor="rf-weekday">Jour de la semaine</label>
      </div>
      <select
        id="rf-weekday"
        aria-label="Jour de la semaine"
        style={input}
        value={state.weekday}
        onChange={(e) => onChange({ ...state, weekday: Number(e.target.value) })}
      >
        {WEEKDAYS.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
      </select>

      <div style={label}>Date de fin de la série</div>
      <DateField
        value={state.endDate}
        onChange={(v) => onChange({ ...state, endDate: v })}
        placeholder="date de fin"
        ariaLabel="Date de fin de la série"
      />

      <div style={label}>Clôture des inscriptions</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {CANCEL_PRESETS.map((p) => {
          const active = state.deadlineLeadHours === p.hours;
          return (
            <button
              key={p.hours}
              type="button"
              onClick={() => onChange({ ...state, deadlineLeadHours: p.hours })}
              style={{
                border: 'none', cursor: 'pointer', borderRadius: 999, padding: '7px 13px',
                fontFamily: th.fontUI, fontSize: 13, fontWeight: 700,
                background: active ? th.accent : th.surface, color: active ? th.onAccent : th.textMute,
              }}
            >
              {p.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
