// Helpers PURS des stats plateforme (géométrie de graphiques d'entiers, ponts vers les
// composants existants, écart de jours). Aucune dépendance DOM, aucun `new Date()` au
// rendu — la fonction daysSince prend `nowIso` en paramètre (hydration-safe).
import { monthShort } from '@/lib/memberStats';

export interface CountBar { month: string; label: string; value: number; x: number; y: number; w: number; h: number; }
export interface CountBarsModel { max: number; bars: CountBar[]; width: number; height: number; }

/**
 * Géométrie des barres d'un compteur mensuel (nouveaux clubs, réservations…). Miroir
 * entier de revenueChartModel : auto-zoom [0, max], barres réparties sur la largeur.
 */
export function countBarsModel(
  series: ReadonlyArray<{ month: string; count: number }>,
  width = 320, height = 120, gap = 6,
): CountBarsModel {
  const values = series.map((s) => Math.max(0, Math.round(s.count)));
  const max = values.reduce((m, v) => Math.max(m, v), 0);
  const n = series.length;
  const barW = n > 0 ? Math.max(2, (width - gap * (n - 1)) / n) : 0;
  const bars: CountBar[] = series.map((s, i) => {
    const value = values[i];
    const h = max > 0 ? (value / max) * height : 0;
    return { month: s.month, label: monthShort(s.month), value, x: i * (barW + gap), y: height - h, w: barW, h };
  });
  return { max, bars, width, height };
}

/**
 * Pont vers MonthlyRevenueChart (qui attend des montants en strings décimales) depuis
 * une série de centimes — évite de dupliquer le code du chart de CA.
 */
export function centsSeriesToDecimal(
  series: ReadonlyArray<{ month: string; amountCents: number }>,
): { month: string; net: string }[] {
  return series.map((s) => ({ month: s.month, net: (s.amountCents / 100).toFixed(2) }));
}

/** Nombre de jours pleins entre `iso` et `nowIso` (≥ 0), ou null si iso absente. */
export function daysSince(iso: string | null | undefined, nowIso: string): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  const now = new Date(nowIso).getTime();
  if (Number.isNaN(then) || Number.isNaN(now)) return null;
  return Math.max(0, Math.floor((now - then) / (24 * 60 * 60 * 1000)));
}
