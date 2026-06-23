// Logique pure de l'historique de niveau (testable, séparée du rendu).
import { RatingPoint } from '@/lib/api';

// Amplitude minimale (en points de niveau) pour tracer une courbe plutôt que l'état « stable ».
export const FLAT_THRESHOLD = 0.15;

export interface HistorySummary {
  state: 'empty' | 'flat' | 'trend';
  count: number;   // nombre de points
  delta: number;   // dernier.level - premier.level
  min: number;
  max: number;
}

export function summarizeHistory(points: RatingPoint[]): HistorySummary {
  const count = points.length;
  if (count === 0) return { state: 'empty', count, delta: 0, min: 0, max: 0 };
  const levels = points.map((p) => p.level);
  const min = Math.min(...levels);
  const max = Math.max(...levels);
  const delta = points[count - 1].level - points[0].level;
  const state = count < 2 || max - min < FLAT_THRESHOLD ? 'flat' : 'trend';
  return { state, count, delta, min, max };
}

/** Delta signé en virgule française à 1 décimale : "+0,3", "−0,2" (U+2212), "0,0". */
export function fmtDelta(delta: number): string {
  const text = Math.abs(delta).toFixed(1).replace('.', ',');
  const sign = text === '0,0' ? '' : delta > 0 ? '+' : '−';
  return `${sign}${text}`;
}
