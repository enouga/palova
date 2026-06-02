import { IconName } from '@/components/ui/Icon';

/** Surface du terrain (attributes.surface) : indoor / outdoor. */
export function courtType(surface?: string): { label: string; icon: IconName } {
  return surface === 'outdoor'
    ? { label: 'Outdoor', icon: 'sun' }
    : { label: 'Indoor', icon: 'indoor' };
}

/** Format du terrain (attributes.format) : double (standard) / single (2 joueurs). */
export function courtFormat(format?: string): string | null {
  return format === 'single' ? 'Single' : null; // on n'affiche un badge que pour les single
}

export const SURFACE_TYPES = [
  { value: 'indoor', label: 'Indoor' },
  { value: 'outdoor', label: 'Outdoor' },
] as const;

export const COURT_FORMATS = [
  { value: 'double', label: 'Double' },
  { value: 'single', label: 'Single' },
] as const;
