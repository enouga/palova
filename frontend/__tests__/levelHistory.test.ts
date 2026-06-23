import { summarizeHistory, fmtDelta } from '@/lib/levelHistory';
import { RatingPoint } from '@/lib/api';

const pt = (level: number, day = 1): RatingPoint => ({ playedAt: `2026-06-0${day}T00:00:00Z`, level });

describe('summarizeHistory', () => {
  it('aucun point → empty', () => {
    expect(summarizeHistory([]).state).toBe('empty');
  });

  it('un seul point → flat', () => {
    expect(summarizeHistory([pt(3)]).state).toBe('flat');
  });

  it('amplitude sous le seuil → flat', () => {
    // 3,00 → 3,10 : amplitude 0,1 < 0,15
    expect(summarizeHistory([pt(3.0, 1), pt(3.05, 2), pt(3.1, 3)]).state).toBe('flat');
  });

  it('amplitude au seuil ou au-dessus → trend', () => {
    expect(summarizeHistory([pt(3.0, 1), pt(3.6, 2), pt(4.0, 3)]).state).toBe('trend');
  });

  it('delta = dernier - premier (signé)', () => {
    expect(summarizeHistory([pt(3.0, 1), pt(4.0, 2)]).delta).toBeCloseTo(1.0, 5);
    expect(summarizeHistory([pt(4.0, 1), pt(3.0, 2)]).delta).toBeCloseTo(-1.0, 5);
  });

  it('min / max / count corrects', () => {
    const s = summarizeHistory([pt(3.2, 1), pt(2.8, 2), pt(4.1, 3)]);
    expect(s.min).toBeCloseTo(2.8, 5);
    expect(s.max).toBeCloseTo(4.1, 5);
    expect(s.count).toBe(3);
  });
});

describe('fmtDelta', () => {
  it('positif → "+0,3"', () => { expect(fmtDelta(0.3)).toBe('+0,3'); });
  it('négatif → "−0,2" (signe moins U+2212)', () => { expect(fmtDelta(-0.2)).toBe('−0,2'); });
  it('nul → "0,0" sans signe', () => { expect(fmtDelta(0)).toBe('0,0'); });
  it('quasi-nul arrondi à 0 → "0,0" sans signe', () => { expect(fmtDelta(0.04)).toBe('0,0'); });
});
