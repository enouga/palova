import { IconName } from '@/components/ui/Icon';

export type Coverage = 'indoor' | 'outdoor' | 'semi';

/** Couverture du terrain (attributes.coverage). Absent ⇒ Extérieur (rétrocompat). */
export function coverageType(coverage?: Coverage): { label: string; icon: IconName; color: string } {
  switch (coverage) {
    case 'indoor': return { label: 'Intérieur', icon: 'indoor', color: '#5e93da' };
    case 'semi':   return { label: 'Semi-couvert', icon: 'home', color: '#7aa889' };
    default:       return { label: 'Extérieur', icon: 'sun', color: '#ef9f6a' };
  }
}

export const COVERAGE_OPTIONS = [
  { value: 'indoor',  label: 'Intérieur' },
  { value: 'outdoor', label: 'Extérieur' },
  { value: 'semi',    label: 'Semi-couvert' },
] as const;

/** Badge éclairage (attributes.lighting). */
export const LIGHTING_BADGE = { label: 'Éclairage', icon: 'bolt' as IconName, color: '#e6b84d' };

/** Format du terrain (attributes.format) : double (standard) / single (2 joueurs). */
export function courtFormat(format?: string): string | null {
  return format === 'single' ? 'Single' : null; // on n'affiche un badge que pour les single
}

/** Couleur du badge format « single » (violet). */
export const SINGLE_COLOR = '#bda6ff';

/** Nombre de joueurs selon le format du terrain (attributes.format). */
export function playerCount(format?: string): number {
  return format === 'single' ? 2 : 4;
}

export const COURT_FORMATS = [
  { value: 'double', label: 'Double' },
  { value: 'single', label: 'Single' },
] as const;
