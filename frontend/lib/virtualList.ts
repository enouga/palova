// Fenêtrage pur d'une liste à hauteur de ligne fixe (virtualisation) — aucune dépendance
// React, testé isolément. Le composant appelant transforme le résultat en tranche
// `items.slice(start, end)` + deux spaceurs (paddingTop/paddingBottom) pour préserver
// la hauteur totale de scroll.

export interface VirtualRange {
  start: number;
  end: number;
  paddingTop: number;
  paddingBottom: number;
}

export function computeVirtualRange(opts: {
  itemCount: number;
  itemHeight: number;
  scrollTop: number;
  viewportHeight: number;
  overscan?: number;
}): VirtualRange {
  const { itemCount, itemHeight, viewportHeight, overscan = 6 } = opts;
  if (itemCount === 0) return { start: 0, end: 0, paddingTop: 0, paddingBottom: 0 };

  // Un scrollTop hérité d'une liste plus longue (ex. filtre appliqué après un scroll) ne doit
  // jamais produire une fenêtre vide : on le ramène dans les bornes du contenu actuel.
  const maxScrollTop = Math.max(0, itemCount * itemHeight - viewportHeight);
  const scrollTop = Math.min(Math.max(0, opts.scrollTop), maxScrollTop);

  const firstVisible = Math.floor(scrollTop / itemHeight);
  const visibleCount = Math.ceil(viewportHeight / itemHeight);
  const start = Math.max(0, firstVisible - overscan);
  const end = Math.min(itemCount, firstVisible + visibleCount + overscan);

  return { start, end, paddingTop: start * itemHeight, paddingBottom: (itemCount - end) * itemHeight };
}
