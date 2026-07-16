import { emptyGrid, applyDigit, backspace, gridToSets, setWinner, nextCursor } from '@/lib/scoreGrid';

// Enchaîne des chiffres depuis le curseur 0 et renvoie l'état final.
function typeAll(digits: number[]) {
  let grid = emptyGrid();
  let cursor = 0;
  for (const d of digits) { const r = applyDigit(grid, cursor, d); grid = r.grid; cursor = r.cursor; }
  return { grid, cursor };
}

it('applyDigit remplit la case active et avance le curseur', () => {
  const r = applyDigit(emptyGrid(), 0, 6);
  expect(r.grid[0]).toBe(6);
  expect(r.cursor).toBe(1);
});

it('gridToSets ne renvoie que les sets aux deux cases remplies', () => {
  let g = applyDigit(emptyGrid(), 0, 6).grid; // s0 Éq.1 = 6, Éq.2 vide
  expect(gridToSets(g)).toEqual([]);
  g = applyDigit(g, 1, 4).grid;
  expect(gridToSets(g)).toEqual([[6, 4]]);
});

it('un score 6-4 6-3 remplit deux sets et saute le set 3 (2-0)', () => {
  const { grid, cursor } = typeAll([6, 4, 6, 3]);
  expect(gridToSets(grid)).toEqual([[6, 4], [6, 3]]);
  expect(cursor).toBe(-1);
});

it('à 1-1 le curseur avance vers le set 3', () => {
  const { cursor } = typeAll([6, 4, 4, 6]);
  expect(cursor).toBe(4); // set 3, Éq.1
});

it('setWinner donne le vainqueur d\'un set complet', () => {
  const { grid } = typeAll([6, 4]);
  expect(setWinner(grid, 0)).toBe(1);
  expect(setWinner(grid, 1)).toBeNull();
});

it('nextCursor plafonne à -1 en fin de grille', () => {
  const g = emptyGrid();
  expect(nextCursor(g, 5)).toBe(-1);
});

it('backspace efface la case active si elle est remplie', () => {
  const r = backspace([6, null, null, null, null, null], 0);
  expect(r.grid[0]).toBeNull();
  expect(r.cursor).toBe(0);
});

it('backspace recule et efface la dernière case remplie si la case active est vide', () => {
  const { grid, cursor } = typeAll([6, 4]); // curseur 2 (vide)
  const r = backspace(grid, cursor);
  expect(r.grid[1]).toBeNull(); // s0 Éq.2 effacée
  expect(r.cursor).toBe(1);
});
