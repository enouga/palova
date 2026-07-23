import { useCallback, useEffect, useRef, useState } from 'react';

export type ScrollRailEdges = { left: boolean; right: boolean };

/** Factorise le suivi de bord gauche/droite + le défilement par page d'un rail
 *  horizontal scrollable (`.sp-scroll-x`). `deps` redéclenche la mesure quand le
 *  contenu change (ex. le nombre de cartes). Extrait de la logique historique
 *  d'`OffersShowcase` — même calcul, même seuil de 4px, même ratio de page (80%). */
export function useScrollRail(deps: readonly unknown[]) {
  const railRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<ScrollRailEdges>({ left: false, right: false });

  const measure = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft < max - 4 });
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

  return { railRef, edges, scrollByPage };
}
