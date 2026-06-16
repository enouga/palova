'use client';
import { useTheme } from '@/lib/ThemeProvider';

// Bouton pointillé « + Ajouter un joueur », partagé entre Parties ouvertes et Mes réservations.
export function AddPlayerPill({
  onClick, disabled = false, size = 'md', label = 'Ajouter un joueur', ariaLabel,
}: {
  onClick: () => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
  label?: string;
  ariaLabel?: string;
}) {
  const { th } = useTheme();
  const circle = size === 'sm' ? 20 : 22;
  return (
    <button type="button" disabled={disabled} aria-label={ariaLabel ?? label} onClick={onClick}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 999, padding: '4px 12px 4px 4px', border: `1.5px dashed ${th.accent}`, background: 'transparent', cursor: disabled ? 'default' : 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.accent }}>
      <span aria-hidden="true" style={{ width: circle, height: circle, borderRadius: '50%', flexShrink: 0, border: `1.5px dashed ${th.accent}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, lineHeight: 1 }}>+</span>
      {label}
    </button>
  );
}
