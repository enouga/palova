'use client';
import { Children, ReactNode } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { useScrollRail } from '@/lib/useScrollRail';
import { RailArrows } from '@/components/ui/RailArrows';

// Rail d'agenda partagé — LA règle responsive unique des régions d'events (spec 2026-07-24) :
// mobile < 700px = une carte pleinement visible + liseré ~14px de la suivante (jamais de
// contenu coupé à moitié), snap obligatoire, points de pagination cliquables ; desktop =
// étagère (colonnes réglables par surface, 1 rangée ≤ 4 enfants sinon 2 en 'auto'), flèches.
// Possède le scroller, PAS l'en-tête de section (chaque surface garde son kicker/titre).
// Points masqués au-delà de 12 cartes (annuaire clubs non plafonné). Les media queries
// vivent dans un <style> de composant (pattern des rails historiques) — display des points
// et flèches PAR CSS uniquement, jamais en inline (l'inline gagnerait sur la media query).
const RAIL_CSS = `
.ag-rail{display:grid;grid-auto-flow:column;gap:12px;align-items:stretch;grid-auto-columns:var(--ag-cols);grid-template-rows:var(--ag-rows);scroll-snap-type:x proximity;scroll-padding-left:20px}
.ag-rail>*{scroll-snap-align:start}
.ag-dots{display:flex;gap:6px;justify-content:center;padding-top:10px}
@media (max-width:699.98px){.ag-rail{grid-auto-columns:calc(100% - 6px);grid-template-rows:auto;scroll-snap-type:x mandatory}.ag-arrows{display:none}}
@media (min-width:700px){.ag-dots{display:none}}
`;

export function AgendaRail({ countLabel, desktopColumns = 'calc(50% - 6px)', desktopRows = 'auto', prevLabel, nextLabel, children }: {
  /** « 8 tournois » — rangée discrète alignée à droite au-dessus du rail. */
  countLabel?: string | null;
  /** grid-auto-columns ≥ 700px — '270px' (parties), 'calc((100% - 24px) / 3)' (clubs)… */
  desktopColumns?: string;
  /** 'auto' = 1 rangée si ≤ 4 enfants, sinon 2 (règle des étagères tournois/events). */
  desktopRows?: 1 | 2 | 'auto';
  prevLabel: string;
  nextLabel: string;
  children: ReactNode;
}) {
  const { th } = useTheme();
  const items = Children.toArray(children);
  const rows = desktopRows === 'auto' ? (items.length <= 4 ? 1 : 2) : desktopRows;
  const { railRef, edges, scrollByPage, activeIndex, scrollToIndex } = useScrollRail([items.length]);

  return (
    <div>
      <style>{RAIL_CSS}</style>
      {countLabel && (
        <div style={{ textAlign: 'right', fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, color: th.text, marginBottom: 4 }}>{countLabel}</div>
      )}
      <div style={{ position: 'relative', margin: '0 -20px' }}>
        {/* scrollPaddingLeft (dans RAIL_CSS) = padding-left : sans lui le snap mandatory mange le padding au montage. */}
        <div ref={railRef} className="sp-scroll-x ag-rail" style={{
          ...({ '--ag-cols': desktopColumns, '--ag-rows': `repeat(${rows}, auto)` } as React.CSSProperties),
          padding: '4px 20px 8px',
        }}>
          {children}
        </div>
        <span className="ag-arrows">
          <RailArrows edges={edges} onPrev={() => scrollByPage(-1)} onNext={() => scrollByPage(1)} prevLabel={prevLabel} nextLabel={nextLabel} fadeBottom={8} />
        </span>
      </div>
      {items.length > 1 && items.length <= 12 && (
        <div className="ag-dots">
          {items.map((_, i) => (
            <button key={i} type="button" aria-label={`Aller à la carte ${i + 1}`}
              aria-current={i === activeIndex ? 'true' : undefined}
              onClick={() => scrollToIndex(i)}
              style={{
                border: 'none', cursor: 'pointer', padding: 0, height: 6, borderRadius: 999,
                width: i === activeIndex ? 18 : 6, transition: 'width .2s ease',
                background: i === activeIndex ? th.accent : th.lineStrong,
              }} />
          ))}
        </div>
      )}
    </div>
  );
}
