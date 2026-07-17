// Modèle pur de la grille de score de la feuille de saisie (MatchResultModal).
// La grille = 6 cases : index = set*2 + team (team 0 = Éq.1, team 1 = Éq.2). Une case null
// est « pas encore saisie » (à distinguer d'un 0 réel). Aucune dépendance React.
import type { SetScore } from './match';

export type Cell = number | null;
export type Grid = [Cell, Cell, Cell, Cell, Cell, Cell];

export function emptyGrid(): Grid {
  return [null, null, null, null, null, null];
}

/** Vainqueur d'un set complet (deux cases remplies, distinctes), sinon null. */
export function setWinner(grid: Grid, setIndex: number): 1 | 2 | null {
  const a = grid[setIndex * 2];
  const b = grid[setIndex * 2 + 1];
  if (a == null || b == null || a === b) return null;
  return a > b ? 1 : 2;
}

/** Sets complets (deux cases remplies) → SetScore[] pour validation / vainqueur / payload. */
export function gridToSets(grid: Grid): SetScore[] {
  const out: SetScore[] = [];
  for (let s = 0; s < 3; s++) {
    const a = grid[s * 2];
    const b = grid[s * 2 + 1];
    if (a != null && b != null) out.push([a, b]);
  }
  return out;
}

/**
 * Prochaine case à éditer après `from`. -1 = plus de case (fin de grille, ou match déjà
 * décidé 2-0 après le 2e set → le 3e set reste facultatif et vide).
 */
export function nextCursor(grid: Grid, from: number): number {
  if (from === 3) {
    const w1 = setWinner(grid, 0);
    const w2 = setWinner(grid, 1);
    if (w1 && w1 === w2) return -1;
  }
  return from >= 5 ? -1 : from + 1;
}

/** Écrit `digit` dans la case active et renvoie le curseur avancé. No-op si curseur hors grille. */
export function applyDigit(grid: Grid, cursor: number, digit: number): { grid: Grid; cursor: number } {
  if (cursor < 0 || cursor > 5) return { grid, cursor };
  const next = [...grid] as Grid;
  next[cursor] = digit;
  return { grid: next, cursor: nextCursor(next, cursor) };
}

/**
 * ⌫ : efface la case active si elle porte une valeur ; sinon recule jusqu'à la dernière
 * case remplie et l'efface. Le curseur suit la case effacée.
 */
export function backspace(grid: Grid, cursor: number): { grid: Grid; cursor: number } {
  const next = [...grid] as Grid;
  if (cursor >= 0 && cursor <= 5 && next[cursor] != null) {
    next[cursor] = null;
    return { grid: next, cursor };
  }
  const start = cursor < 0 ? 5 : cursor - 1;
  for (let i = start; i >= 0; i--) {
    if (next[i] != null) { next[i] = null; return { grid: next, cursor: i }; }
  }
  return { grid: next, cursor: cursor < 0 ? 0 : cursor };
}
