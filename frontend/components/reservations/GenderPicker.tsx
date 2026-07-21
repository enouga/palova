'use client';
import { useTheme } from '@/lib/ThemeProvider';
import type { OpenMatchGender } from '@/lib/api';

const OPTIONS: Array<{ value: OpenMatchGender | null; label: string; sub: string }> = [
  { value: null,    label: 'Ouverte à tous', sub: 'Tout le monde peut rejoindre' },
  { value: 'WOMEN', label: 'Féminine',       sub: 'Réservée aux femmes' },
  { value: 'MIXED', label: 'Mixte',          sub: 'Un homme et une femme par équipe' },
];

// Sélecteur de genre d'une partie ouverte padel — 3 chips segmentées, partagé par
// OpenMatchToggle et OpenMatchQuickSwitch. Contrôlé (value/onChange), pur.
export function GenderPicker({ value, onChange, disabled }: {
  value: OpenMatchGender | null;
  onChange: (v: OpenMatchGender | null) => void;
  disabled?: boolean;
}) {
  const { th } = useTheme();
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
      {OPTIONS.map((o) => {
        const active = o.value === value;
        return (
          <button key={o.label} type="button" aria-pressed={active} aria-label={o.label} disabled={disabled}
            onClick={() => onChange(o.value)}
            style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3, textAlign: 'left',
              cursor: disabled ? 'not-allowed' : 'pointer', borderRadius: 12,
              padding: '9px 12px', border: `1.5px solid ${active ? th.accent : th.line}`,
              background: active ? `${th.accent}14` : 'transparent', opacity: disabled ? 0.6 : 1 }}>
            <div style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, lineHeight: 1.25, color: active ? th.accent : th.text }}>{o.label}</div>
            {/* 2 lignes réservées (minHeight 2.6em = 2 × lineHeight) : les 3 chips gardent la même
                hauteur de sous-texte quel que soit le nombre de lignes réel → contenu aligné. */}
            <div style={{ fontFamily: th.fontUI, fontSize: 10.5, color: th.textFaint, lineHeight: 1.3, minHeight: '2.6em' }}>{o.sub}</div>
          </button>
        );
      })}
    </div>
  );
}
