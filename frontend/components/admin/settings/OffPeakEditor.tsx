'use client';
import { useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { offPeakChipLabel } from '@/lib/adminSettings';
import { OffPeakRangeSheet } from './OffPeakRangeSheet';
import type { OffPeakHours, OffPeakRange } from '@/lib/api';

const DAYS: [number, string][] = [
  [1, 'Lundi'], [2, 'Mardi'], [3, 'Mercredi'], [4, 'Jeudi'], [5, 'Vendredi'], [6, 'Samedi'], [7, 'Dimanche'],
];

interface Props {
  value: OffPeakHours | null;
  onChange: (v: OffPeakHours) => void;
}

/** Éditeur d'heures creuses : chips de plages par jour + « + plage » (feuille) + « × » (supprime). */
export function OffPeakEditor({ value, onChange }: Props) {
  const { th } = useTheme();
  // Feuille ouverte : { day, idx | null }. idx null = ajout.
  const [sheet, setSheet] = useState<{ day: number; idx: number | null } | null>(null);

  const clone = (): OffPeakHours =>
    Object.fromEntries(Object.entries(value ?? {}).map(([d, r]) => [d, [...r]]));

  const saveRange = (day: number, idx: number | null, r: OffPeakRange) => {
    const oph = clone();
    const ranges = oph[day] ?? [];
    if (idx == null) oph[day] = [...ranges, r];
    else { ranges[idx] = r; oph[day] = ranges; }
    onChange(oph);
    setSheet(null);
  };

  const removeRange = (day: number, idx: number) => {
    const oph = clone();
    const ranges = (oph[day] ?? []).filter((_, i) => i !== idx);
    if (ranges.length) oph[day] = ranges; else delete oph[day];
    onChange(oph);
  };

  const dayName = (d: number) => DAYS.find(([n]) => n === d)![1];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {DAYS.map(([day, name]) => {
        const ranges = value?.[day] ?? [];
        return (
          <div key={day} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '6px 0', borderBottom: `1px dashed ${th.line}` }}>
            <span style={{ fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, color: th.text, width: 92 }}>{name}</span>
            {ranges.length === 0 && (
              <span style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textFaint }}>tout en heures pleines</span>
            )}
            {ranges.map((r, idx) => (
              <span key={idx} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: `${th.accentWarm}22`, color: th.text, border: `1px solid ${th.accentWarm}55`, borderRadius: 999, padding: '5px 6px 5px 12px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600 }}>
                <button type="button" onClick={() => setSheet({ day, idx })}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', font: 'inherit', padding: 0 }}>
                  {offPeakChipLabel(r)}
                </button>
                <button type="button" aria-label={`Supprimer la plage ${offPeakChipLabel(r)} de ${name}`} onClick={() => removeRange(day, idx)}
                  style={{ width: 22, height: 22, borderRadius: 7, background: 'transparent', border: 'none', color: th.textMute, cursor: 'pointer', fontSize: 15, lineHeight: 1 }}>×</button>
              </span>
            ))}
            <button type="button" onClick={() => setSheet({ day, idx: null })}
              style={{ padding: '5px 11px', borderRadius: 999, background: 'transparent', color: th.textMute, border: `1px dashed ${th.line}`, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600 }}>
              + plage
            </button>
          </div>
        );
      })}
      {sheet && (
        <OffPeakRangeSheet
          dayLabel={dayName(sheet.day)}
          initial={sheet.idx == null ? null : (value?.[sheet.day]?.[sheet.idx] ?? null)}
          onClose={() => setSheet(null)}
          onSave={(r) => saveRange(sheet.day, sheet.idx, r)}
        />
      )}
    </div>
  );
}
