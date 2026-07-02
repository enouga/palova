import { PLAYER_COLORS, colorForSeed } from '../playerColors';

describe('colorForSeed (miroir de frontend/lib/playerColors.ts)', () => {
  it('renvoie une couleur de la palette, stable pour un même seed', () => {
    const c = colorForSeed('user-42');
    expect(PLAYER_COLORS).toContain(c);
    expect(colorForSeed('user-42')).toBe(c);
  });

  it('seed vide → première couleur', () => {
    expect(colorForSeed('')).toBe(PLAYER_COLORS[0]);
  });

  it('distribue : au moins 2 couleurs distinctes sur 20 seeds', () => {
    const set = new Set(Array.from({ length: 20 }, (_, i) => colorForSeed(`seed-${i}`)));
    expect(set.size).toBeGreaterThan(1);
  });
});
