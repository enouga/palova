// Tarification heures pleines / creuses.
// peakHours = plages d'heures PLEINES par jour de semaine (clé = weekday Luxon 1=lundi..7=dimanche).
export type PeakHours = Record<number, { start: number; end: number }>;

/** true si (weekday, hour) tombe en heures PLEINES. Jour non configuré → pleines (pas de remise). */
export function isPeakHour(peak: PeakHours | null | undefined, weekday: number, hour: number): boolean {
  const w = peak?.[weekday];
  if (!w) return true;
  return hour >= w.start && hour < w.end;
}

/** €/h effectif pour un créneau commençant à (weekday, hour) en heure locale du club. */
export function effectiveRate(
  peak: PeakHours | null | undefined,
  weekday: number,
  hour: number,
  pricePerHour: number,
  offPeakPricePerHour: number | null,
): { rate: number; offPeak: boolean } {
  if (isPeakHour(peak, weekday, hour)) return { rate: pricePerHour, offPeak: false };
  return { rate: offPeakPricePerHour ?? pricePerHour, offPeak: true };
}
