import { reliability, RD_RELIABLE } from '../reliability';
import { isProvisional, DEFAULT_RD, PROVISIONAL_RD_THRESHOLD } from '../level';

describe('reliability(rd) — % de fiabilité dérivé du RD Glicko', () => {
  it('RD max (350) → ~50 % (joueur tout neuf)', () => {
    expect(reliability(350)).toBe(50);
  });
  it('RD au seuil provisoire (110) → ~85 % (« fiabilisé »)', () => {
    expect(reliability(110)).toBe(85);
  });
  it('RD plancher (50) → 100 %', () => {
    expect(reliability(50)).toBe(100);
  });

  it('borne au-dessus de 350 → reste 50 %', () => {
    expect(reliability(1000)).toBe(50);
  });
  it('borne en dessous de 50 → reste 100 %', () => {
    expect(reliability(0)).toBe(100);
  });

  it('renvoie un entier dans [50,100]', () => {
    for (const rd of [350, 300, 230, 150, 110, 80, 50, 20]) {
      const r = reliability(rd);
      expect(Number.isInteger(r)).toBe(true);
      expect(r).toBeGreaterThanOrEqual(50);
      expect(r).toBeLessThanOrEqual(100);
    }
  });

  it('décroît quand le RD augmente (monotonie)', () => {
    const rds = [40, 50, 80, 110, 150, 230, 300, 350, 400];
    for (let i = 1; i < rds.length; i++) {
      expect(reliability(rds[i])).toBeLessThanOrEqual(reliability(rds[i - 1]));
    }
  });

  it('cohérent avec isProvisional (clairement provisoire vs clairement fiable)', () => {
    expect(isProvisional(DEFAULT_RD)).toBe(true);
    expect(reliability(DEFAULT_RD)).toBe(50);
    expect(isProvisional(80)).toBe(false);
    expect(reliability(80)).toBeGreaterThanOrEqual(85);
  });

  it('RD_RELIABLE = seuil provisoire de level.ts (source unique)', () => {
    expect(RD_RELIABLE).toBe(PROVISIONAL_RD_THRESHOLD);
  });
});
