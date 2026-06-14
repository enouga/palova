'use client';

import { useTheme } from '@/lib/ThemeProvider';
import { splitLocal, joinLocal } from '@/lib/datetimeLocal';
import { TimePicker } from './TimePicker';
import { DateField } from './DateField';

const pad = (n: number) => String(n).padStart(2, '0');

/** Date du jour au format YYYY-MM-DD (heure locale du navigateur). */
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

interface DateTimeFieldProps {
  /** Valeur datetime-local "YYYY-MM-DDTHH:MM" (chaîne vide = non renseignée). */
  value: string;
  onChange: (value: string) => void;
  /** Heure adoptée quand on choisit une date sans heure encore posée. */
  defaultTime?: string;
  /** Affiche un « Effacer » et autorise le retour à vide (champ optionnel). */
  clearable?: boolean;
  /** Transmis au TimePicker. */
  minuteStep?: number;
  minuteChips?: number[];
  presets?: string[];
}

// Édite un instant en deux temps : la DATE via l'input natif (calendrier connu de
// tous) et l'HEURE via le TimePicker maison. Recompose la valeur datetime-local
// attendue par les formulaires admin (events/tournois) — donc localInputToISO en aval
// reste inchangé.
export function DateTimeField({
  value, onChange, defaultTime = '18:00', clearable,
  minuteStep, minuteChips, presets,
}: DateTimeFieldProps) {
  const { th } = useTheme();
  const { date, time } = splitLocal(value);

  const onDate = (d: string) => {
    if (!d) { onChange(clearable ? '' : joinLocal('', time)); return; }
    onChange(joinLocal(d, time || defaultTime));
  };
  const onTime = (t: string) => onChange(joinLocal(date || todayLocal(), t));

  // La date est posée à gauche des tuiles HH:MM (slot `leading`) via le calendrier
  // maison DateField (popup aux couleurs du thème) — un seul bloc « jour + heure ».
  const dateField = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <DateField value={date} onChange={onDate} />
      {clearable && value && (
        <button type="button" onClick={() => onChange('')}
          style={{ border: 'none', background: 'transparent', color: th.textMute, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, whiteSpace: 'nowrap' }}>
          Effacer
        </button>
      )}
    </div>
  );

  return (
    <TimePicker
      value={time} onChange={onTime} defaultTime={defaultTime}
      minuteStep={minuteStep} minuteChips={minuteChips} presets={presets}
      leading={dateField}
    />
  );
}
