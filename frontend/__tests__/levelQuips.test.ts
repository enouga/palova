import { LEVEL_QUIPS, pickQuip } from '@/lib/levelQuips';

describe('levelQuips', () => {
  it('8 paliers, chacun avec plusieurs propositions', () => {
    expect(LEVEL_QUIPS).toHaveLength(8);
    for (const pool of LEVEL_QUIPS) expect(pool.length).toBeGreaterThanOrEqual(3);
  });

  it('pickQuip renvoie une phrase du bon palier', () => {
    for (let lvl = 1; lvl <= 8; lvl++) {
      expect(LEVEL_QUIPS[lvl - 1]).toContain(pickQuip(lvl, 0));
      expect(LEVEL_QUIPS[lvl - 1]).toContain(pickQuip(lvl, 0.99));
    }
  });

  it('niveau décimal → arrondi au palier', () => {
    expect(LEVEL_QUIPS[2]).toContain(pickQuip(3.2, 0.5)); // 3,2 → palier 3
    expect(LEVEL_QUIPS[4]).toContain(pickQuip(5.4, 0.5)); // 5,4 → palier 5
  });

  it('borne les niveaux hors plage', () => {
    expect(LEVEL_QUIPS[0]).toContain(pickQuip(-3, 0.5));
    expect(LEVEL_QUIPS[7]).toContain(pickQuip(99, 0.5));
  });

  it('exclude évite de retomber sur la même phrase', () => {
    const first = LEVEL_QUIPS[4][0];
    const got = pickQuip(5, 0, first); // rand 0 viserait l'index 0, mais on l'exclut
    expect(got).not.toBe(first);
    expect(LEVEL_QUIPS[4]).toContain(got);
  });
});
