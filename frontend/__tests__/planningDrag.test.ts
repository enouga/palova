import { dragDeltaMinutes, moveTarget, resizeTarget, createTarget } from '@/lib/planningDrag';

const HOUR_H = 68; // 15 min = 17px pile (68/4)

describe('dragDeltaMinutes', () => {
  it('convertit un déplacement en px en minutes, aligné sur le pas de 15', () => {
    expect(dragDeltaMinutes(17, HOUR_H)).toBe(15);
    expect(dragDeltaMinutes(34, HOUR_H)).toBe(30);
    expect(dragDeltaMinutes(-17, HOUR_H)).toBe(-15);
  });
  it('arrondit vers le pas le plus proche', () => {
    expect(dragDeltaMinutes(8, HOUR_H)).toBe(0); // ~7 min, plus proche de 0 que de 15
  });
});

describe('moveTarget — déplacer (span fixe)', () => {
  const openMin = 8 * 60, closeMin = 22 * 60;

  it('décale début ET fin du même delta (durée inchangée)', () => {
    const r = moveTarget(17 * 60, 90, 34, HOUR_H, openMin, closeMin);
    expect(r).toEqual({ startMin: 17 * 60 + 30, endMin: 19 * 60 });
  });

  it('clampe au début à l\'heure d\'ouverture', () => {
    const r = moveTarget(8 * 60 + 5, 60, -34, HOUR_H, openMin, closeMin);
    expect(r.startMin).toBe(openMin);
  });

  it('clampe la fin à l\'heure de fermeture (le début recule pour garder la durée)', () => {
    const r = moveTarget(21 * 60, 90, 68, HOUR_H, openMin, closeMin);
    expect(r.endMin).toBe(closeMin);
    expect(r.startMin).toBe(closeMin - 90);
  });
});

describe('resizeTarget — étirer (début fixe)', () => {
  const closeMin = 22 * 60;

  it('avance la fin du delta', () => {
    expect(resizeTarget(17 * 60, 18 * 60, 17, HOUR_H, closeMin)).toBe(18 * 60 + 15);
  });

  it('durée minimale 30 min (ne descend jamais sous début+30)', () => {
    expect(resizeTarget(17 * 60, 17 * 60 + 45, -68, HOUR_H, closeMin)).toBe(17 * 60 + 30);
  });

  it('clampe à l\'heure de fermeture', () => {
    expect(resizeTarget(21 * 60, 21 * 60 + 30, 200, HOUR_H, closeMin)).toBe(closeMin);
  });
});

describe('createTarget — créer en glissant (début = ancre fixe)', () => {
  const closeMin = 22 * 60;

  it('la fin suit le delta positif', () => {
    expect(createTarget(17 * 60, 68, HOUR_H, closeMin)).toBe(18 * 60);
  });

  it('un delta négatif ou nul reste plafonné à ancre+30 (jamais en dessous)', () => {
    expect(createTarget(17 * 60, -34, HOUR_H, closeMin)).toBe(17 * 60 + 30);
  });

  it('clampe à l\'heure de fermeture', () => {
    expect(createTarget(21 * 60 + 45, 200, HOUR_H, closeMin)).toBe(closeMin);
  });
});
