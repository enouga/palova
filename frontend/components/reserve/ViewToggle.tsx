'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { Icon } from '@/components/ui/Icon';
import type { ReserveView } from '@/lib/reserveView';

// Interrupteur d'affichage des créneaux : liste (cartes par terrain) ↔ grille (matrice).
// Segmented compact, pastille pleine sur l'option active (même langage que les autres toggles).
export function ViewToggle({ value, onChange }: {
  value: ReserveView; onChange: (v: ReserveView) => void;
}) {
  const { th } = useTheme();
  const opts: { v: ReserveView; icon: 'menu' | 'grid'; label: string }[] = [
    { v: 'cards', icon: 'menu', label: 'Vue liste' },
    { v: 'grid', icon: 'grid', label: 'Vue grille' },
  ];
  return (
    <div role="group" aria-label="Affichage des créneaux"
      style={{ display: 'inline-flex', gap: 2, background: th.surface2, borderRadius: 10, padding: 2 }}>
      {opts.map((o) => {
        const on = value === o.v;
        return (
          <button key={o.v} type="button" aria-label={o.label} aria-pressed={on}
            onClick={() => onChange(o.v)}
            style={{ border: 'none', cursor: 'pointer', borderRadius: 8, padding: '5px 9px',
              display: 'inline-flex', alignItems: 'center', background: on ? th.text : 'transparent' }}>
            <Icon name={o.icon} size={16} color={on ? th.bg : th.textMute} stroke={2} />
          </button>
        );
      })}
    </div>
  );
}
