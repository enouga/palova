// Helpers purs pour le matchmaking par niveau (fourchette des parties ouvertes).
export function inRange(level: number | null, min: number | null, max: number | null): boolean {
  if (level == null) return true;
  if (min != null && level < min) return false;
  if (max != null && level > max) return false;
  return true;
}
/** Format français d'un niveau : entier tel quel, sinon un dixième avec virgule (3,2). */
export function fmtLevel(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1).replace('.', ',');
}
export function rangeLabel(min: number | null, max: number | null): string {
  if (min != null && max != null) return `Niveau ${fmtLevel(min)} à ${fmtLevel(max)}`;
  if (min != null) return `Niveau ${fmtLevel(min)} et +`;
  if (max != null) return `Niveau ${fmtLevel(max)} et -`;
  return 'Tous niveaux';
}
/** Deux fourchettes se chevauchent-elles ? Une borne null = non bornée de ce côté (miroir back). */
export function rangesOverlap(aMin: number | null, aMax: number | null, bMin: number | null, bMax: number | null): boolean {
  if (aMax != null && bMin != null && aMax < bMin) return false; // A entièrement sous B
  if (aMin != null && bMax != null && aMin > bMax) return false; // A entièrement au-dessus de B
  return true;
}
/** Distance d'un niveau à une cible (tri « à mon niveau »). Niveau inconnu = Infinity. */
export function levelDistance(level: number | null, target: number | null): number {
  if (level == null || target == null) return Infinity;
  return Math.abs(level - target);
}
