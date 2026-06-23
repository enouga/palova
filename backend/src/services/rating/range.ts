// Helper pur pour le matchmaking par niveau (fourchette des parties ouvertes).
// Miroir exact de frontend/lib/levelMatch.ts → inRange : un niveau inconnu (null)
// passe (on ne pénalise pas un joueur non calibré), sinon on borne par min/max.
export function inRange(level: number | null, min: number | null, max: number | null): boolean {
  if (level == null) return true;
  if (min != null && level < min) return false;
  if (max != null && level > max) return false;
  return true;
}
