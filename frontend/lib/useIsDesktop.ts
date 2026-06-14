'use client';
import { useEffect, useState } from 'react';

/**
 * Vrai sur écran large (desktop). Init `false` puis mis à jour en effet (jamais
 * pendant le rendu) → pas de mismatch d'hydration. `matchMedia` est stubé dans
 * jest.setup.ts pour les tests. Sert à élargir/aérer certaines modales en desktop.
 */
export function useIsDesktop(minWidth = 768): boolean {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${minWidth}px)`);
    const apply = () => setIsDesktop(mql.matches);
    apply();
    mql.addEventListener('change', apply);
    return () => mql.removeEventListener('change', apply);
  }, [minWidth]);
  return isDesktop;
}
