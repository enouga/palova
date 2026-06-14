'use client';

import { CSSProperties, useEffect, useRef, useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { Icon } from './Icon';
import { addMonths, monthGrid, monthLabel, todayKey } from '@/lib/calendar';

const DOW = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];

/** "YYYY-MM-DD" → "DD/MM/YYYY" (sans passer par Date : aucun décalage de fuseau). */
function frLabel(key: string): string {
  const [y, m, d] = key.split('-');
  return `${d}/${m}/${y}`;
}

interface DateFieldProps {
  /** Valeur "YYYY-MM-DD" (chaîne vide = non renseignée). */
  value: string;
  onChange: (key: string) => void;
  placeholder?: string;
  /** Gabarit du champ : 'md' (défaut, formulaires) ou 'sm' (filtres compacts). */
  size?: 'sm' | 'md';
  /** Largeur du déclencheur (défaut selon size) — number = px, ou '100%'. */
  width?: number | string;
  /** Nom accessible du champ (sinon le déclencheur n'a que la date pour libellé). */
  ariaLabel?: string;
}

// Sélecteur de date « maison » : champ déclencheur + popup calendrier aux couleurs
// du thème (remplace le picker natif non stylable). Réutilise les helpers purs de
// lib/calendar (monthGrid/monthLabel/addMonths/todayKey).
export function DateField({ value, onChange, placeholder = 'jj/mm/aaaa', size = 'md', width, ariaLabel }: DateFieldProps) {
  const { th } = useTheme();
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Mois affiché : déduit de la valeur (ou du jour courant) à chaque ouverture.
  const initial = value || todayKey();
  const [view, setView] = useState(() => ({ year: Number(initial.slice(0, 4)), month: Number(initial.slice(5, 7)) }));

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const openPicker = () => {
    const base = value || todayKey();
    setView({ year: Number(base.slice(0, 4)), month: Number(base.slice(5, 7)) });
    setOpen((o) => !o);
  };

  const pick = (key: string) => { onChange(key); setOpen(false); };
  const today = todayKey();

  const sm = size === 'sm';
  const trigger: CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: sm ? 6 : 9,
    width: width ?? (sm ? 150 : 200), boxSizing: 'border-box',
    background: th.surface2, border: `1px solid ${open ? th.accent : th.line}`,
    borderRadius: sm ? 9 : 12, padding: sm ? '7px 10px' : '12px 14px',
    fontFamily: th.fontUI, fontSize: sm ? 13 : 16, fontWeight: 600,
    color: value ? th.text : th.textFaint, cursor: 'pointer', outline: 'none', textAlign: 'left',
    boxShadow: open ? `0 0 0 3px ${th.accent}33` : 'none',
    transition: 'border-color 120ms, box-shadow 120ms',
  };

  const navBtn = (label: string, icon: 'chevL' | 'chevR', delta: 1 | -1) => (
    <button type="button" onClick={() => setView((v) => addMonths(v.year, v.month, delta))} aria-label={label}
      style={{
        width: 34, height: 34, borderRadius: 10, border: 'none', cursor: 'pointer', flexShrink: 0,
        background: th.surface2, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
      <Icon name={icon} size={18} color={th.text} />
    </button>
  );

  const footBtn: CSSProperties = {
    border: 'none', background: 'transparent', color: th.accent, cursor: 'pointer',
    fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, padding: '4px 2px',
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button type="button" onClick={openPicker} style={trigger}
        aria-label={ariaLabel} aria-haspopup="dialog" aria-expanded={open}>
        <Icon name="calendar" size={sm ? 15 : 18} color={value ? th.textMute : th.textFaint} />
        <span style={{ flex: 1 }}>{value ? frLabel(value) : placeholder}</span>
        <Icon name="chevR" size={sm ? 13 : 15} color={th.textFaint}
          style={{ transform: open ? 'rotate(-90deg)' : 'rotate(90deg)', transition: 'transform 120ms' }} />
      </button>

      {open && (
        <div role="dialog" aria-label="Choisir une date"
          style={{
            position: 'absolute', top: 'calc(100% + 8px)', left: 0, zIndex: 50, width: 296,
            background: th.surface, border: `1px solid ${th.line}`, borderRadius: 16,
            boxShadow: '0 16px 40px rgba(0,0,0,0.18)', padding: 14,
          }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {navBtn('Mois précédent', 'chevL', -1)}
            <div style={{ flex: 1, textAlign: 'center', fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 16, color: th.text, textTransform: 'capitalize' }}>
              {monthLabel(view.year, view.month)}
            </div>
            {navBtn('Mois suivant', 'chevR', 1)}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3, marginTop: 12 }}>
            {DOW.map((d) => (
              <div key={d} style={{ textAlign: 'center', fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: th.textFaint, paddingBottom: 4 }}>
                {d}
              </div>
            ))}
            {monthGrid(view.year, view.month).flat().map((cell) => {
              const isToday = cell.key === today;
              const isSelected = cell.key === value;
              const isHover = cell.key === hovered;
              return (
                <button key={cell.key} type="button" onClick={() => pick(cell.key)}
                  onMouseEnter={() => setHovered(cell.key)} onMouseLeave={() => setHovered(null)}
                  aria-pressed={isSelected} aria-label={frLabel(cell.key)}
                  style={{
                    height: 36, borderRadius: 10, border: 'none', cursor: 'pointer',
                    fontFamily: th.fontUI, fontSize: 14, fontWeight: isToday || isSelected ? 700 : 500,
                    background: isSelected ? th.ink : isHover ? th.surface2 : 'transparent',
                    color: isSelected ? (th.mode === 'floodlit' ? th.text : '#f7f5ee')
                      : !cell.inMonth ? th.textFaint : isToday ? th.accent : th.text,
                    boxShadow: isToday && !isSelected ? `inset 0 0 0 1.5px ${th.accent}` : 'none',
                    WebkitTapHighlightColor: 'transparent',
                  }}>
                  {cell.day}
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, borderTop: `1px solid ${th.line}`, paddingTop: 10 }}>
            <button type="button" onClick={() => pick('')} style={footBtn}>Effacer</button>
            <button type="button" onClick={() => pick(today)} style={footBtn}>Aujourd&apos;hui</button>
          </div>
        </div>
      )}
    </div>
  );
}
