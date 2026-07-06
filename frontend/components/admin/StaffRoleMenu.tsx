'use client';
import { useEffect, useRef, CSSProperties } from 'react';
import { useTheme } from '@/lib/ThemeProvider';

export type StaffRole = 'ADMIN' | 'STAFF' | null;

const OPTIONS: { value: StaffRole; label: string; hint: string }[] = [
  { value: null,    label: 'Aucun', hint: "Membre simple, pas d'accès au back-office" },
  { value: 'STAFF', label: 'Staff', hint: 'Accès au back-office du club' },
  { value: 'ADMIN', label: 'Admin', hint: 'Back-office + gestion du staff et des niveaux' },
];

// Petit menu contextuel de rôle staff (clic extérieur / Échap ferment). Position fixed
// ancrée sur le rect du déclencheur : échappe au clipping overflow du wrapper du tableau.
export function StaffRoleMenu({ current, anchor, onPick, onClose }: {
  current: StaffRole;
  anchor: { top: number; bottom: number; right: number };
  onPick: (role: StaffRole) => void;
  onClose: () => void;
}) {
  const { th } = useTheme();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    // position: fixed → un scroll (page OU wrapper du tableau) désancrerait le menu : on ferme.
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const MENU_W = 240;
  const MENU_H = 170; // approx : 3 options
  const openUp = typeof window !== 'undefined' && anchor.bottom + MENU_H > window.innerHeight;
  const pos: CSSProperties = {
    position: 'fixed',
    left: Math.max(8, anchor.right - MENU_W),
    ...(openUp ? { bottom: Math.max(8, window.innerHeight - anchor.top + 6) } : { top: anchor.bottom + 6 }),
  };

  return (
    <div ref={ref} role="menu" aria-label="Rôle staff"
      style={{ ...pos, zIndex: 50, minWidth: MENU_W, background: th.surface, border: `1px solid ${th.line}`, borderRadius: 13, boxShadow: th.shadow, padding: 6 }}>
      {OPTIONS.map((o) => {
        const on = current === o.value;
        return (
          <button key={o.label} type="button" role="menuitemradio" aria-checked={on} onClick={() => onPick(o.value)}
            style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, background: on ? `${th.accent}18` : 'none', border: 'none', cursor: 'pointer', padding: '8px 10px', borderRadius: 9, fontFamily: th.fontUI, textAlign: 'left' }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: th.text }}>{o.label}{on ? ' ✓' : ''}</span>
            <span style={{ fontSize: 12, color: th.textMute }}>{o.hint}</span>
          </button>
        );
      })}
    </div>
  );
}
