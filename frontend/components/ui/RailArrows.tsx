'use client';
import { CSSProperties } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { inkOn } from '@/lib/theme';
import type { ScrollRailEdges } from '@/lib/useScrollRail';

/** Flèches de défilement superposées au bord d'un rail de cartes horizontal — rond
 *  plein accent, dégradé de fondu, visibles seulement quand il reste du contenu caché
 *  de ce côté (pas de grisé : la flèche disparaît à l'extrémité). Style repris pixel
 *  pour pixel de l'implémentation historique d'`OffersShowcase` (validé par Eric sur
 *  capture). À poser en enfant d'un conteneur `position:'relative'` qui NE défile PAS
 *  lui-même (sibling du rail `.sp-scroll-x`, pas son parent direct scrollable) —
 *  sinon les boutons défileraient avec le contenu. `fadeBottom` = inset bas du
 *  dégradé, à aligner sur le padding bas de la rangée hôte (chaque rail a le sien). */
export function RailArrows({ edges, onPrev, onNext, prevLabel, nextLabel, fadeBottom = 14 }: {
  edges: ScrollRailEdges;
  onPrev: () => void;
  onNext: () => void;
  prevLabel: string;
  nextLabel: string;
  fadeBottom?: number;
}) {
  const { th } = useTheme();
  const navBtn = (side: 'left' | 'right'): CSSProperties => ({
    position: 'absolute', [side]: 8, top: '50%', transform: 'translateY(-50%)', width: 38, height: 38,
    borderRadius: 99, border: `2px solid ${th.surface}`, background: th.accent, color: inkOn(th.accent),
    boxShadow: '0 3px 12px rgba(0,0,0,0.28)', fontSize: 20, fontWeight: 800, lineHeight: 1, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2, fontFamily: th.fontUI,
  });
  const fade = (side: 'left' | 'right'): CSSProperties => ({
    position: 'absolute', [side]: 0, top: 0, bottom: fadeBottom, width: 48, pointerEvents: 'none',
    background: `linear-gradient(to ${side === 'left' ? 'right' : 'left'}, ${th.bg}, transparent)`,
  });
  return (
    <>
      {edges.left && <span aria-hidden style={fade('left')} />}
      {edges.right && <span aria-hidden style={fade('right')} />}
      {edges.left && <button type="button" aria-label={prevLabel} onClick={onPrev} style={navBtn('left')}>‹</button>}
      {edges.right && <button type="button" aria-label={nextLabel} onClick={onNext} style={navBtn('right')}>›</button>}
    </>
  );
}
