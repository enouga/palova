import { darkenHex } from '../lib/theme';

describe('darkenHex', () => {
  it('assombrit chaque canal par le facteur', () => {
    expect(darkenHex('#ffffff', 0.5)).toBe('#808080');
    expect(darkenHex('#000000', 0.5)).toBe('#000000');
  });

  it('facteur 1 = couleur inchangée', () => {
    expect(darkenHex('#ef9f6a', 1)).toBe('#ef9f6a');
  });
});
