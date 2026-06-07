import { isPeakHour, effectiveRate } from '../pricing';

const PEAK = { 1: { start: 18, end: 22 } }; // lundi 18h–22h pleines

describe('isPeakHour', () => {
  it('jour non configuré → heures pleines', () => {
    expect(isPeakHour(null, 3, 10)).toBe(true);
    expect(isPeakHour(PEAK, 2, 10)).toBe(true); // mardi non configuré
  });
  it('dans la fenêtre = pleines, hors = creuses', () => {
    expect(isPeakHour(PEAK, 1, 19)).toBe(true);
    expect(isPeakHour(PEAK, 1, 22)).toBe(false); // borne haute exclue
    expect(isPeakHour(PEAK, 1, 10)).toBe(false);
  });
});

describe('effectiveRate', () => {
  it('heures pleines → pricePerHour', () => {
    expect(effectiveRate(PEAK, 1, 19, 25, 18)).toEqual({ rate: 25, offPeak: false });
  });
  it('heures creuses → offPeakPricePerHour', () => {
    expect(effectiveRate(PEAK, 1, 10, 25, 18)).toEqual({ rate: 18, offPeak: true });
  });
  it('heures creuses sans tarif creux → retombe sur pricePerHour', () => {
    expect(effectiveRate(PEAK, 1, 10, 25, null)).toEqual({ rate: 25, offPeak: true });
  });
});
