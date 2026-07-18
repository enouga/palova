'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useTheme } from '@/lib/ThemeProvider';

interface DateSelectorProps {
  /** date sélectionnée, format 'YYYY-MM-DD' */
  value: string;
  onChange: (date: string) => void;
  /** jours encore ouverts (point apricot). Si omis : tous les jours futurs. */
  openDates?: Set<string>;
  /** nombre minimum de jours affichés. Défaut 7. La bande s'étend jusqu'à `maxKey`. */
  days?: number;
  /** dernier jour sélectionnable 'YYYY-MM-DD' (fenêtre de réservation). Optionnel. */
  maxKey?: string;
  /** Jour « bientôt ouvert » (cadenas 🔒, cliquable) affiché APRÈS maxKey. Optionnel. */
  lockedKey?: string;
  /** Tap sur le jour verrouillé (affiche le compte à rebours côté parent). */
  onSelectLocked?: () => void;
}

const WEEKDAYS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

// Géométrie de la bande : cellules à largeur fixe confortable (lisibles sur mobile),
// la rangée défile horizontalement au lieu de s'écraser.
const CELL_W = 62;
const GAP = 8;
const STEP = CELL_W + GAP;
const MS_PER_DAY = 86400000;

function toKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function keyToDate(key: string): Date {
  const [y, m, dd] = key.split('-').map(Number);
  return new Date(y, m - 1, dd);
}

/** Sélecteur de dates « bande défilante » : cellules à largeur fixe confortable,
 *  scroll-snap horizontal (swipe sur mobile, la semaine tient sur web), flèches pour
 *  défiler d'une page. Jour actif en pastille accent, point apricot = jour ouvert. */
export default function DateSelector({ value, onChange, openDates, days = 7, maxKey, lockedKey, onSelectLocked }: DateSelectorProps) {
  const { th } = useTheme();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayKey = toKey(today);

  // Nombre de cellules : au moins `days`, étendu pour couvrir toute la fenêtre réservable
  // (et le jour verrouillé, s'il est plus loin que maxKey — cas normal).
  const lastKey = lockedKey && (!maxKey || lockedKey > maxKey) ? lockedKey : maxKey;
  const windowDays = lastKey ? Math.round((keyToDate(lastKey).getTime() - today.getTime()) / MS_PER_DAY) + 1 : 0;
  const count = Math.min(Math.max(days, windowDays), 90);
  const list = Array.from({ length: count }, (_, i) => addDays(today, i));

  const scrollRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [visibleIdx, setVisibleIdx] = useState(0); // 1er jour visible → libellé du mois
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);

  // Recalcule l'état des flèches + le mois affiché en fonction du défilement.
  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 2);
    setAtEnd(el.scrollWidth - el.clientWidth - el.scrollLeft <= 2);
    setVisibleIdx(Math.round(el.scrollLeft / STEP));
  }, []);

  useEffect(() => { measure(); }, [measure, count]);

  const scrollPage = (dir: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = Math.max(el.clientWidth * 0.8, STEP * 3);
    el.scrollBy?.({ left: dir * amount, behavior: 'smooth' });
  };

  const headDate = list[Math.min(visibleIdx, list.length - 1)] ?? today;
  const headLabel = headDate.getFullYear() === today.getFullYear()
    ? MONTHS[headDate.getMonth()]
    : `${MONTHS[headDate.getMonth()]} ${headDate.getFullYear()}`;

  const arrowStyle = (enabled: boolean): React.CSSProperties => ({
    width: 34, height: 34, borderRadius: 10, border: `1px solid ${th.line}`, background: 'transparent',
    color: th.textMute, cursor: enabled ? 'pointer' : 'not-allowed', opacity: enabled ? 1 : 0.3,
    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, lineHeight: 1, flexShrink: 0,
  });

  return (
    <div>
      {/* Masque la scrollbar de la bande (Firefox / WebKit) sans gêner le swipe. */}
      <style>{`.ds-strip{scrollbar-width:none;-ms-overflow-style:none}.ds-strip::-webkit-scrollbar{display:none}`}</style>

      {/* En-tête mois + navigation par page */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 22, color: th.text, textTransform: 'capitalize' }}>{headLabel}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => scrollPage(-1)} disabled={atStart} aria-label="Jours précédents" style={arrowStyle(!atStart)}>‹</button>
          <button type="button" onClick={() => scrollPage(1)} disabled={atEnd} aria-label="Jours suivants" style={arrowStyle(!atEnd)}>›</button>
        </div>
      </div>

      {/* Bande de jours défilante — cellules à largeur fixe, scroll-snap horizontal */}
      <div
        ref={scrollRef}
        className="ds-strip"
        onScroll={measure}
        role="group"
        aria-label="Choisir une date"
        style={{ display: 'flex', gap: GAP, overflowX: 'auto', scrollSnapType: 'x proximity', paddingBottom: 2, WebkitOverflowScrolling: 'touch' }}
      >
        {list.map((d) => {
          const key = toKey(d);
          const isPast = key < todayKey;
          const isSel = key === value;
          const isLocked = lockedKey === key;
          const tooFar = maxKey ? key > maxKey : false;
          const disabled = isPast || (tooFar && !isLocked);
          const isOpen = !disabled && (openDates ? openDates.has(key) : true);
          const isHover = hover === key && !disabled && !isSel;
          const isToday = key === todayKey;

          return (
            <button
              key={key}
              type="button"
              onClick={() => { if (isLocked) { onSelectLocked?.(); return; } if (!disabled) onChange(key); }}
              onMouseEnter={() => setHover(key)}
              onMouseLeave={() => setHover((h) => (h === key ? null : h))}
              disabled={disabled}
              aria-pressed={isSel}
              aria-label={isLocked ? `${WEEKDAYS[d.getDay()]} ${d.getDate()} (ouvre bientôt)` : `${WEEKDAYS[d.getDay()]} ${d.getDate()}`}
              style={{
                flexShrink: 0, width: CELL_W, scrollSnapAlign: 'start', cursor: disabled ? 'not-allowed' : 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                padding: '10px 0 9px', borderRadius: 14,
                border: `1px solid ${isSel ? th.accent : isHover ? th.lineStrong : th.line}`,
                background: isSel ? th.accent : isHover ? th.surface2 : th.surface,
                opacity: disabled ? 0.4 : isLocked ? 0.75 : 1,
                transition: 'background .16s, border-color .16s, box-shadow .18s, transform .14s, filter .15s',
                boxShadow: isSel ? (th.neon ? `0 0 0 1px ${th.accent}, 0 5px 14px ${th.accent}55` : `0 4px 12px ${th.accent}40`) : 'none',
              }}
            >
              <span style={{
                fontFamily: th.fontMono, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4,
                color: isSel ? th.onAccent : isToday ? th.accent : th.textMute,
              }}>{isToday ? 'AUJ' : WEEKDAYS[d.getDay()]}</span>
              <span style={{
                fontFamily: th.fontDisplay, fontSize: 19, fontWeight: 600, lineHeight: 1,
                color: isSel ? th.onAccent : disabled ? th.textFaint : th.text,
              }}>{String(d.getDate()).padStart(2, '0')}</span>
              {isLocked
                ? <span aria-hidden style={{ fontSize: 10, lineHeight: '5px' }}>🔒</span>
                : (
                  <span style={{
                    width: 5, height: 5, borderRadius: '50%',
                    background: isSel ? th.onAccent : th.accentWarm,
                    opacity: isOpen ? (isSel ? 0.9 : 1) : 0, transition: 'opacity .15s',
                  }} />
                )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
