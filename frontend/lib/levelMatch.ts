// Helpers purs pour le matchmaking par niveau (fourchette des parties ouvertes).
export function inRange(level: number | null, min: number | null, max: number | null): boolean {
  if (level == null) return true;
  if (min != null && level < min) return false;
  if (max != null && level > max) return false;
  return true;
}
export function rangeLabel(min: number | null, max: number | null): string {
  if (min != null && max != null) return `Niveau ${min} à ${max}`;
  if (min != null) return `Niveau ${min} et +`;
  if (max != null) return `Niveau ${max} et -`;
  return 'Tous niveaux';
}
/** Distance d'un niveau à une cible (tri « à mon niveau »). Niveau inconnu = Infinity. */
export function levelDistance(level: number | null, target: number | null): number {
  if (level == null || target == null) return Infinity;
  return Math.abs(level - target);
}
