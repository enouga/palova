import { useCallback, useEffect, useRef, useState } from 'react';

export type ScrollRailEdges = { left: boolean; right: boolean };

/** Factorise le suivi de bord gauche/droite + le défilement par page d'un rail
 *  horizontal scrollable (`.sp-scroll-x`). `deps` redéclenche la mesure quand le
 *  contenu change (ex. le nombre de cartes). Extrait de la logique historique
 *  d'`OffersShowcase` — même calcul, même seuil de 4px, même ratio de page (80%).
 *  Expose aussi `activeIndex` (carte actuellement « en vue », pour des points de
 *  pagination) et `scrollToIndex` (saut ciblé vers une carte, pour les mêmes points). */
export function useScrollRail(deps: readonly unknown[]) {
  const railRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<ScrollRailEdges>({ left: false, right: false });
  const [activeIndex, setActiveIndex] = useState(0);

  const measure = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft < max - 4 });
    // Index de snap (points de pagination) : l'enfant dont l'offsetLeft est le plus proche
    // du bord gauche visible. offsetLeft est du layout (insensible au scroll), d'où le
    // décalage par kids[0].offsetLeft (= padding gauche du rail).
    const kids = Array.from(el.children) as HTMLElement[];
    if (kids.length === 0) return;
    const target = el.scrollLeft + kids[0].offsetLeft;
    let best = 0;
    for (let i = 1; i < kids.length; i++) {
      if (Math.abs(kids[i].offsetLeft - target) < Math.abs(kids[best].offsetLeft - target)) best = i;
    }
    setActiveIndex(best);
  }, []);

  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => { el.removeEventListener('scroll', measure); window.removeEventListener('resize', measure); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const scrollByPage = (dir: 1 | -1) => {
    const el = railRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' });
  };

  const scrollToIndex = (i: number) => {
    const el = railRef.current;
    const kids = el ? (Array.from(el.children) as HTMLElement[]) : [];
    if (!el || !kids[i]) return;
    el.scrollTo({ left: kids[i].offsetLeft - kids[0].offsetLeft, behavior: 'smooth' });
  };

  return { railRef, edges, scrollByPage, activeIndex, scrollToIndex };
}
