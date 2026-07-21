'use client';
import { useEffect, useRef, useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { inkOn } from '@/lib/theme';
import { Icon } from '@/components/ui/Icon';
import { addMonths, monthGrid, monthLabel, todayKey } from '@/lib/calendar';
import { rangeChipLabel } from '@/lib/tournamentCalendar';

const DOW = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];

/** "YYYY-MM-DD" → "DD/MM/YYYY" (aria-label des jours, idiome DateField). */
function frLabel(key: string): string {
  const [y, m, d] = key.split('-');
  return `${d}/${m}/${y}`;
}

// Chip « 📅 Dates » du FacetPanel : ouvre un calendrier maison en mode PLAGE — 1ᵉʳ tap = début,
// 2ᵉ tap = fin (bornes échangées si tapées à l'envers) puis fermeture ; plage re-tapée = on
// repart sur un nouveau début. Autonome : mêmes helpers purs que DateField (monthGrid/monthLabel/
// addMonths/todayKey) mais SANS toucher DateField (mono-date, consommé partout — la grille
// dupliquée est le prix de sa stabilité). Valeurs YYYY-MM-DD, le format de CalendarFilterState.
export function DateRangeChip({ from, to, onChange, tint }: {
  from: string | null;
  to: string | null;
  onChange: (from: string | null, to: string | null) => void;
  /** Teinte du groupe hôte (défaut th.accent — rétro-compatible). */
  tint?: string;
}) {
  const { th } = useTheme();
  const [open, setOpen] = useState(false);
  // Décalage horizontal de la popup : ancrée à la chip mais CLAMPÉE au viewport (sur mobile,
  // une chip en milieu de rangée ferait déborder les 296px à droite — colonne dim. coupée).
  const [popLeft, setPopLeft] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const base = from || todayKey();
  const [view, setView] = useState(() => ({ year: Number(base.slice(0, 4)), month: Number(base.slice(5, 7)) }));

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
    const b = from || todayKey();
    setView({ year: Number(b.slice(0, 4)), month: Number(b.slice(5, 7)) });
    const rect = wrapRef.current?.getBoundingClientRect();
    if (rect) {
      const MARGIN = 12, WIDTH = 296;
      const desired = Math.min(Math.max(MARGIN, rect.left), Math.max(MARGIN, window.innerWidth - WIDTH - MARGIN));
      setPopLeft(desired - rect.left);
    }
    setOpen((o) => !o);
  };

  const pick = (key: string) => {
    if (!from || to) { onChange(key, null); return; } // 1ᵉʳ tap, ou plage complète → nouveau début
    if (key < from) onChange(key, from); else onChange(from, key); // 2ᵉ tap : fin (swap si besoin)
    setOpen(false);
  };

  const clear = () => { onChange(null, null); setOpen(false); };

  const label = rangeChipLabel(from, to);
  const active = label != null;
  const today = todayKey();
  const inkText = th.mode === 'floodlit' ? th.text : '#f7f5ee';
  const pill = tint ?? th.accent;
  const pillInk = inkOn(pill);

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', borderRadius: 999,
        background: active ? pill : th.surface,
        boxShadow: active ? 'none' : `inset 0 0 0 1px ${th.line}`,
      }}>
        <button type="button" onClick={openPicker} aria-haspopup="dialog" aria-expanded={open}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', cursor: 'pointer',
            background: 'transparent', borderRadius: 999, padding: active ? '7px 4px 7px 13px' : '7px 13px',
            fontFamily: th.fontUI, fontSize: 13, fontWeight: 700,
            color: active ? pillInk : th.text,
          }}>
          <Icon name="calendar" size={14} color={active ? pillInk : th.textMute} />
          {label ?? 'Dates'}
        </button>
        {active && (
          <button type="button" onClick={clear} aria-label="Effacer les dates"
            style={{ border: 'none', cursor: 'pointer', background: 'transparent', color: pillInk,
              fontFamily: th.fontUI, fontSize: 13, fontWeight: 800, padding: '7px 11px 7px 4px' }}>
            ✕
          </button>
        )}
      </span>

      {open && (
        <div role="dialog" aria-label="Choisir des dates"
          style={{
            position: 'absolute', top: 'calc(100% + 8px)', left: popLeft, zIndex: 50, width: 296,
            background: th.surface, border: `1px solid ${th.line}`, borderRadius: 16,
            boxShadow: '0 16px 40px rgba(0,0,0,0.18)', padding: 14,
          }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" onClick={() => setView((v) => addMonths(v.year, v.month, -1))} aria-label="Mois précédent"
              style={navBtnStyle(th)}><Icon name="chevL" size={18} color={th.text} /></button>
            <div style={{ flex: 1, textAlign: 'center', fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 16, color: th.text, textTransform: 'capitalize' }}>
              {monthLabel(view.year, view.month)}
            </div>
            <button type="button" onClick={() => setView((v) => addMonths(v.year, v.month, 1))} aria-label="Mois suivant"
              style={navBtnStyle(th)}><Icon name="chevR" size={18} color={th.text} /></button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0, rowGap: 3, marginTop: 12 }}>
            {DOW.map((d) => (
              <div key={d} style={{ textAlign: 'center', fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: th.textFaint, paddingBottom: 4 }}>
                {d}
              </div>
            ))}
            {monthGrid(view.year, view.month).flat().map((cell) => {
              const isEdge = cell.key === from || cell.key === to;
              const isBetween = !!from && !!to && cell.key > from && cell.key < to;
              const isToday = cell.key === today;
              return (
                <button key={cell.key} type="button" onClick={() => pick(cell.key)} aria-label={frLabel(cell.key)}
                  style={{
                    height: 36, border: 'none', cursor: 'pointer',
                    borderRadius: isEdge ? 10 : 0,
                    fontFamily: th.fontUI, fontSize: 14, fontWeight: isEdge || isToday ? 700 : 500,
                    background: isEdge ? th.ink : isBetween ? `${th.accent}26` : 'transparent',
                    color: isEdge ? inkText : !cell.inMonth ? th.textFaint : isToday ? th.accent : th.text,
                    boxShadow: isToday && !isEdge ? `inset 0 0 0 1.5px ${th.accent}` : 'none',
                    WebkitTapHighlightColor: 'transparent',
                  }}>
                  {cell.day}
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, borderTop: `1px solid ${th.line}`, paddingTop: 10 }}>
            <span style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textFaint }}>Début → fin, en 2 taps</span>
            <button type="button" onClick={clear}
              style={{ border: 'none', background: 'transparent', color: th.accent, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, padding: '4px 2px' }}>
              Effacer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function navBtnStyle(th: ReturnType<typeof useTheme>['th']): React.CSSProperties {
  return {
    width: 34, height: 34, borderRadius: 10, border: 'none', cursor: 'pointer', flexShrink: 0,
    background: th.surface2, display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
}
