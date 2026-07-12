import type { ReservationType } from '@/lib/api';

export const TYPE_META: Record<ReservationType, { label: string; color: string }> = {
  COURT:      { label: 'Terrain',   color: '#5e93da' },
  COACHING:   { label: 'Coaching',  color: '#34b888' },
  TOURNAMENT: { label: 'Tournoi',   color: '#f0913c' },
  EVENT:      { label: 'Événement', color: '#a98bf0' },
};

export const TYPE_ORDER: ReservationType[] = ['COURT', 'COACHING', 'TOURNAMENT', 'EVENT'];
